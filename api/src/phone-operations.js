'use strict';

const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');
const { COST, START, evaluate, generate, normalizeState } = require('./phone-roulette');

const OPERATION_BY_ACTION = Object.freeze({
    roll: 'phone_roll',
    resolve: 'phone_resolve',
    sell: 'phone_sell',
    install: 'phone_install'
});

async function operatePhone({ pool, env = process.env, telegramId, requestId, action, itemId, keepNew, now = Date.now() }) {
    if (!Object.hasOwn(OPERATION_BY_ACTION, action) ||
        (action === 'install' && (typeof itemId !== 'string' || itemId.length < 1 || itemId.length > 160)) ||
        (action === 'resolve' && typeof keepNew !== 'boolean') ||
        (action !== 'install' && itemId !== undefined) ||
        (action !== 'resolve' && keepNew !== undefined)) {
        throw new OperationError(400, 'INVALID_PHONE_REQUEST');
    }

    const request = { action, ...(action === 'install' ? { itemId } : {}),
        ...(action === 'resolve' ? { keepNew } : {}) };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT stars, silver, inventory, banned, profile_phone, legacy_data,
                    balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
             FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        const user = userResult.rows[0];
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');

        const operation = OPERATION_BY_ACTION[action];
        const previousResult = await client.query(
            `SELECT operation, request, response FROM game_operations
             WHERE telegram_id = $1 AND request_id = $2`,
            [telegramId, requestId]
        );
        if (previousResult.rows.length) {
            const previous = previousResult.rows[0];
            if (previous.operation !== operation ||
                !isDeepStrictEqual(previous.request, request)) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const phone = normalizeState(user.profile_phone);
        const inventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
        let nextPhone = { ...phone };
        let nextInventory = inventory;
        let stars = BigInt(user.stars);
        let payout = 0;
        let spend = 0;

        if (action === 'roll') {
            if (phone.pending) throw new OperationError(409, 'PHONE_ROLL_PENDING');
            if (stars < BigInt(COST)) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
            const pending = generate();
            const value = evaluate(pending.cc, pending.tail).value;
            spend = COST;
            stars -= BigInt(COST);
            nextPhone = {
                ...phone,
                rolls: phone.rolls + 1,
                best: Math.max(phone.best, value),
                pending
            };
        } else if (action === 'resolve') {
            if (!phone.pending) throw new OperationError(409, 'PHONE_ROLL_NOT_PENDING');
            const newValue = evaluate(phone.pending.cc, phone.pending.tail).value;
            const oldValue = evaluate(phone.cc, phone.tail).value;
            payout = keepNew ? oldValue : newValue;
            nextPhone = {
                cc: keepNew ? phone.pending.cc : phone.cc,
                tail: keepNew ? phone.pending.tail : phone.tail,
                rolls: phone.rolls,
                best: phone.best
            };
            stars += BigInt(payout);
        } else if (action === 'sell') {
            payout = evaluate(phone.cc, phone.tail).value;
            if (payout <= 0) throw new OperationError(409, 'PHONE_NOT_SELLABLE');
            stars += BigInt(payout);
            nextPhone = { ...phone, ...START, pending: undefined };
        } else {
            if (phone.pending) throw new OperationError(409, 'PHONE_ROLL_PENDING');
            const selected = inventory.find(item => item?.id === itemId && item?.type === 'phone');
            if (!selected || !selected.phone) throw new OperationError(409, 'ITEMS_NOT_FOUND');
            const newPhone = normalizeState(selected.phone);
            if (newPhone.cc === START.cc && newPhone.tail === START.tail) {
                throw new OperationError(409, 'INVALID_PHONE_ITEM');
            }
            const oldValue = evaluate(phone.cc, phone.tail).value;
            nextInventory = inventory.filter(item => item?.id !== itemId);
            if (oldValue > 0) {
                nextInventory.push({
                    id: `phone_${randomUUID()}`,
                    type: 'phone',
                    name: `+${phone.cc} ${phone.tail}`,
                    phone: { cc: phone.cc, tail: phone.tail },
                    price: oldValue,
                    stars: oldValue,
                    value: oldValue,
                    currency: 'star',
                    image: '',
                    timestamp: now
                });
            }
            nextPhone = {
                cc: newPhone.cc,
                tail: newPhone.tail,
                rolls: phone.rolls,
                best: phone.best
            };
        }

        nextPhone = normalizeState(nextPhone);
        const poolState = applyPoolMutation(user, {
            stars: stars.toString(),
            silver: String(user.silver),
            inventory: nextInventory
        }, { env, now });
        await client.query(
            `UPDATE app_users SET stars = $1, inventory = $2::jsonb, profile_phone = $3::jsonb,
             balance_pool_started_at = $4, balance_pool_start_value = $5,
             balance_pool_escrow_value = $6, updated_at = NOW()
             WHERE telegram_id = $7`,
            [
                stars.toString(), JSON.stringify(nextInventory), JSON.stringify(nextPhone),
                poolState.balance_pool_started_at, poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value, telegramId
            ]
        );
        if (spend > 0) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'spend', 'star', $3, $4, 'phone:roll')`,
                [telegramId, requestId, spend, stars.toString()]
            );
        } else if (payout > 0) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'earn', 'star', $3, $4, $5)`,
                [telegramId, requestId, payout, stars.toString(), `phone:${action}`]
            );
        }

        const response = {
            action,
            phone: nextPhone,
            stars: stars.toString(),
            inventory: nextInventory,
            ...(action === 'roll' ? { cost: COST, result: nextPhone.pending } : {}),
            ...(action === 'resolve' || action === 'sell' ? { payout } : {})
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
            [telegramId, requestId, operation, JSON.stringify(request), JSON.stringify(response)]
        );
        await client.query('COMMIT');
        return { ...response, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof BalancePoolError) throw new OperationError(error.status, error.code);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { operatePhone };

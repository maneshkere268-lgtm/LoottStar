'use strict';

const { randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const STAKE_MULTIPLIER = 3n;
const DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_DB_BALANCE = 9_223_372_036_854_775_807n;
const OPERATIONS = Object.freeze({
    activate: 'staking_activate',
    stop: 'staking_stop',
    top_up: 'staking_top_up',
    claim: 'staking_claim'
});

function isStakeable(item) {
    if (!item || typeof item.name !== 'string' || !item.name) return false;
    if (item.noSell === true || item.untradeable === true || item.limited === true) return false;
    if (item.noStake === true) return false;
    return item.name.toLowerCase().includes('durov figure');
}

function toSafeInteger(value, code = 'INVALID_STAKING_STATE') {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new OperationError(409, code);
    }
    return number;
}

function createStake(item, now) {
    const basePrice = toSafeInteger(item.price, 'INVALID_INVENTORY_ITEM');
    if (basePrice <= 0) throw new OperationError(409, 'INVALID_INVENTORY_ITEM');
    const pool = BigInt(basePrice) * STAKE_MULTIPLIER;
    if (pool > MAX_SAFE_BIGINT) throw new OperationError(409, 'INVALID_INVENTORY_ITEM');
    return {
        status: 'active',
        basePrice,
        pool: Number(pool),
        endTime: now + DURATION_MS,
        lastTick: now,
        earned: 0,
        remainder: 0
    };
}

function settleStake(staking, now) {
    if (!staking || staking.status !== 'active') {
        return { staking, payout: 0n, expired: false };
    }

    const basePrice = toSafeInteger(staking.basePrice);
    const initialPool = BigInt(toSafeInteger(staking.pool));
    let remainingPool = initialPool;
    let earnedTotal = BigInt(toSafeInteger(staking.earned));
    const endTime = toSafeInteger(staking.endTime);
    const lastTick = toSafeInteger(staking.lastTick);
    let remainder = BigInt(toSafeInteger(staking.remainder || 0));
    if (basePrice <= 0 || endTime <= 0 || lastTick > endTime || remainder >= BigInt(DURATION_MS)) {
        throw new OperationError(409, 'INVALID_STAKING_STATE');
    }

    const settleUntil = Math.min(now, endTime);
    const elapsed = Math.max(0, settleUntil - lastTick);
    let payout = 0n;
    if (elapsed > 0 && remainingPool > 0n) {
        const numerator = BigInt(basePrice) * STAKE_MULTIPLIER * BigInt(elapsed) + remainder;
        payout = numerator / BigInt(DURATION_MS);
        remainder = numerator % BigInt(DURATION_MS);
        if (payout > remainingPool) {
            payout = remainingPool;
            remainder = 0n;
        }
        remainingPool -= payout;
        earnedTotal += payout;
    }

    const expired = now >= endTime;
    if (expired) {
        payout += remainingPool;
        earnedTotal += remainingPool;
        remainingPool = 0n;
        remainder = 0n;
    }

    return {
        staking: {
            ...staking,
            pool: Number(remainingPool),
            earned: Number(earnedTotal),
            lastTick: settleUntil,
            remainder: Number(remainder)
        },
        payout,
        expired
    };
}

async function operateStaking({
    pool, env = process.env, telegramId, requestId, action, itemId, amount, now = Date.now()
}) {
    if (!Object.hasOwn(OPERATIONS, action) ||
        typeof itemId !== 'string' || itemId.length < 1 || itemId.length > 160 ||
        !Number.isSafeInteger(now) || now < 0 ||
        (action === 'top_up' && (!Number.isSafeInteger(amount) || amount <= 0))) {
        throw new OperationError(400, 'INVALID_STAKING_REQUEST');
    }

    const operation = OPERATIONS[action];
    const request = { action, itemId, ...(action === 'top_up' ? { amount } : {}) };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT stars, silver, inventory, banned,
                    balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
             FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        const user = userResult.rows[0];
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');

        const previousResult = await client.query(
            `SELECT operation, request, response FROM game_operations
             WHERE telegram_id = $1 AND request_id = $2`,
            [telegramId, requestId]
        );
        if (previousResult.rows.length) {
            const previous = previousResult.rows[0];
            if (previous.operation !== operation ||
                previous.request?.action !== action ||
                previous.request?.itemId !== itemId ||
                (action === 'top_up' && previous.request?.amount !== amount)) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const index = inventory.findIndex(item => item?.id === itemId);
        if (index < 0) throw new OperationError(409, 'ITEMS_NOT_FOUND');
        const currentItem = inventory[index];
        if (!isStakeable(currentItem)) throw new OperationError(409, 'ITEM_NOT_STAKEABLE');

        let stars = BigInt(user.stars);
        let payout = 0n;
        let nextItem = { ...currentItem };
        let expired = false;

        if (nextItem.staking) {
            const settled = settleStake(nextItem.staking, now);
            nextItem.staking = settled.staking;
            payout = settled.payout;
            expired = settled.expired;
        }

        let topUpAmount = 0n;
        if (action === 'activate') {
            if (expired) {
                nextItem = null;
            } else if (!nextItem.staking) {
                nextItem.staking = createStake(nextItem, now);
            } else if (nextItem.staking.status !== 'active') {
                nextItem.staking = { ...nextItem.staking, status: 'active', lastTick: now };
            }
        } else if (action === 'stop') {
            if (expired) {
                nextItem = null;
            } else if (nextItem.staking) {
                nextItem.staking = { ...nextItem.staking, status: 'paused', lastTick: now };
            }
        } else if (action === 'top_up') {
            if (expired) {
                nextItem = null;
            } else {
                if (!nextItem.staking ||
                    !['active', 'paused'].includes(nextItem.staking.status)) {
                    throw new OperationError(409, 'STAKE_NOT_ACTIVE');
                }
                topUpAmount = BigInt(amount);
                if (stars < topUpAmount) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
                const nextPool = BigInt(toSafeInteger(nextItem.staking.pool)) + topUpAmount;
                if (nextPool > MAX_SAFE_BIGINT) throw new OperationError(400, 'INVALID_STAKING_REQUEST');
                stars -= topUpAmount;
                nextItem.staking = { ...nextItem.staking, pool: Number(nextPool), lastTick: now };
            }
        } else if (action === 'claim') {
            if (expired) nextItem = null;
            else if (!nextItem.staking || nextItem.staking.status !== 'active') {
                throw new OperationError(409, 'STAKE_NOT_ACTIVE');
            }
        }

        stars += payout;
        if (stars > MAX_DB_BALANCE) throw new OperationError(409, 'BALANCE_LIMIT_REACHED');
        const nextInventory = inventory.slice();
        if (nextItem) nextInventory[index] = nextItem;
        else nextInventory.splice(index, 1);

        let poolState = null;
        if (stars !== BigInt(user.stars)) {
            poolState = applyPoolMutation(user, {
                stars: stars.toString(),
                silver: String(user.silver),
                inventory
            }, { now, env });
        }

        await client.query(
            `UPDATE app_users SET stars = $1, inventory = $2::jsonb,
             balance_pool_started_at = COALESCE($3, balance_pool_started_at),
             balance_pool_start_value = COALESCE($4, balance_pool_start_value),
             balance_pool_escrow_value = COALESCE($5, balance_pool_escrow_value),
             updated_at = NOW()
             WHERE telegram_id = $6`,
            [
                stars.toString(), JSON.stringify(nextInventory),
                poolState?.balance_pool_started_at ?? null,
                poolState?.balance_pool_start_value ?? null,
                poolState?.balance_pool_escrow_value ?? null,
                telegramId
            ]
        );

        if (topUpAmount > 0n) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'spend', 'star', $3, $4, 'staking:top_up')`,
                [telegramId, requestId, topUpAmount.toString(), (BigInt(user.stars) - topUpAmount).toString()]
            );
        }
        if (payout > 0n) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'earn', 'star', $3, $4, 'staking:reward')`,
                [
                    telegramId, topUpAmount > 0n ? randomUUID() : requestId,
                    payout.toString(), stars.toString()
                ]
            );
        }

        const response = {
            action,
            itemId,
            stars: stars.toString(),
            inventory: nextInventory,
            earned: payout.toString(),
            expired,
            ...(action === 'top_up' ? { amountAdded: topUpAmount.toString() } : {})
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

module.exports = {
    DURATION_MS,
    OPERATIONS,
    isStakeable,
    operateStaking,
    settleStake
};

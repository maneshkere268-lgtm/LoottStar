'use strict';

const { randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

function validateInput(itemIds) {
    if (!Array.isArray(itemIds) || itemIds.length < 1 || itemIds.length > 50 ||
        itemIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 160) ||
        new Set(itemIds).size !== itemIds.length) {
        throw new OperationError(400, 'INVALID_SELL_REQUEST');
    }
}

function getSaleValue(item) {
    const raw = Number(item.stars || item.value || 0);
    if (!Number.isSafeInteger(raw) || raw < 0) {
        throw new OperationError(409, 'INVALID_INVENTORY_ITEM');
    }
    return raw;
}

async function sellItems({ pool, env = process.env, telegramId, requestId, itemIds, now = Date.now() }) {
    validateInput(itemIds);
    const request = { itemIds: [...itemIds].sort() };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT stars, silver, banned, inventory,
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
            if (previous.operation !== 'item_sell' ||
                !Array.isArray(previous.request?.itemIds) ||
                previous.request.itemIds.length !== request.itemIds.length ||
                previous.request.itemIds.some((id, index) => id !== request.itemIds[index])) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const selected = inventory.filter(item => itemIds.includes(item?.id));
        if (selected.length !== itemIds.length) throw new OperationError(409, 'ITEMS_NOT_FOUND');
        if (selected.some(item =>
            item.noSell === true || item.untradeable === true || item.limited === true ||
            item.saved === true || item.staking?.status === 'active'
        )) {
            throw new OperationError(409, 'ITEMS_NOT_SELLABLE');
        }

        let stars = BigInt(user.stars);
        let silver = BigInt(user.silver);
        let starsSold = 0n;
        let silverSold = 0n;
        for (const item of selected) {
            const value = BigInt(getSaleValue(item));
            if (item.currency === 'silver') {
                silver += value;
                silverSold += value;
            } else {
                stars += value;
                starsSold += value;
            }
        }

        const selectedIds = new Set(itemIds);
        const nextInventory = inventory.filter(item => !selectedIds.has(item?.id));
        const poolState = applyPoolMutation(user, {
            stars: stars.toString(),
            silver: silver.toString(),
            inventory: nextInventory
        }, { now, env });

        await client.query(
            `UPDATE app_users SET stars = $1, silver = $2, inventory = $3::jsonb,
             balance_pool_started_at = $4, balance_pool_start_value = $5,
             balance_pool_escrow_value = $6, updated_at = NOW()
             WHERE telegram_id = $7`,
            [
                stars.toString(), silver.toString(), JSON.stringify(nextInventory),
                poolState.balance_pool_started_at, poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value, telegramId
            ]
        );

        if (starsSold > 0n) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'earn', 'star', $3, $4, 'inventory:sell')`,
                [telegramId, randomUUID(), starsSold.toString(), stars.toString()]
            );
        }
        if (silverSold > 0n) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'earn', 'silver', $3, $4, 'inventory:sell')`,
                [telegramId, randomUUID(), silverSold.toString(), silver.toString()]
            );
        }

        const response = {
            soldItemIds: itemIds,
            stars: stars.toString(),
            silver: silver.toString(),
            starsEarned: starsSold.toString(),
            silverEarned: silverSold.toString(),
            inventory: nextInventory
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'item_sell', $3::jsonb, $4::jsonb)`,
            [telegramId, requestId, JSON.stringify(request), JSON.stringify(response)]
        );
        await client.query('COMMIT');
        return { ...response, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof BalancePoolError) {
            throw new OperationError(error.status, error.code);
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { sellItems, validateInput };

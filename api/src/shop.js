'use strict';

const { randomUUID } = require('node:crypto');
const catalog = require('./case-catalog.json');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const MAX_PRICE = 50_000_000;

function findCatalogItem(name) {
    for (const caseData of catalog) {
        const item = caseData.items.find(entry => entry.name === name);
        if (item) return item;
    }
    return null;
}

async function buyIndexItem({ pool, env = process.env, telegramId, requestId, itemName, now = Date.now() }) {
    if (typeof itemName !== 'string' || itemName.length < 1 || itemName.length > 160) {
        throw new OperationError(400, 'INVALID_SHOP_REQUEST');
    }
    const catalogItem = findCatalogItem(itemName);
    if (!catalogItem) throw new OperationError(404, 'SHOP_ITEM_NOT_FOUND');

    const price = Math.round(Number(catalogItem.price) * 1.25);
    if (!Number.isSafeInteger(price) || price <= 0 || price > MAX_PRICE) {
        throw new OperationError(400, 'INVALID_SHOP_PRICE');
    }

    const request = { itemName };
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
            if (previous.operation !== 'shop_buy' || previous.request?.itemName !== itemName) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const stars = BigInt(user.stars);
        const cost = BigInt(price);
        if (stars < cost) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
        const nextStars = stars - cost;
        const inventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
        const item = {
            id: `item_${randomUUID()}`,
            name: catalogItem.name,
            price: catalogItem.price,
            stars: catalogItem.price,
            value: catalogItem.price,
            currency: 'star',
            image: catalogItem.image || '',
            owned: true,
            timestamp: now
        };
        inventory.push(item);
        const poolState = applyPoolMutation(user, {
            stars: nextStars.toString(),
            silver: String(user.silver),
            inventory
        }, { env, now });
        await client.query(
            `UPDATE app_users SET stars = $1, inventory = $2::jsonb,
             balance_pool_started_at = $3, balance_pool_start_value = $4,
             balance_pool_escrow_value = $5, updated_at = NOW()
             WHERE telegram_id = $6`,
            [
                nextStars.toString(), JSON.stringify(inventory),
                poolState.balance_pool_started_at, poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value, telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'spend', 'star', $3, $4, 'shop:index')`,
            [telegramId, requestId, price, nextStars.toString()]
        );
        const response = {
            item,
            stars: nextStars.toString(),
            silver: String(user.silver),
            inventory
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'shop_buy', $3::jsonb, $4::jsonb)`,
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

module.exports = { buyIndexItem, findCatalogItem };
'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const starGifts = require('./gift-catalog.json');
const silverGifts = require('./silver-gift-catalog.json');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const MIN_ITEMS = 3;
const MAX_ITEMS = 9;
const MAX_PAYOUT = 250_000_000;
const MULTIPLIERS = [0.5, 0.7, 1, 1.3, 1.7, 2, 2.5];
const WEIGHTS = [40, 25, 15, 10, 6, 3, 1];

function validateInput(itemIds, currency) {
    if (!Array.isArray(itemIds) || itemIds.length < MIN_ITEMS || itemIds.length > MAX_ITEMS ||
        itemIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 160) ||
        new Set(itemIds).size !== itemIds.length ||
        !['star', 'silver'].includes(currency)) {
        throw new OperationError(400, 'INVALID_CRAFT_REQUEST');
    }
}

function chooseMultiplier(random = () => randomInt(100)) {
    const value = random();
    if (!Number.isInteger(value) || value < 0 || value >= 100) {
        throw new Error('INVALID_RANDOM_VALUE');
    }
    let draw = value;
    for (let index = 0; index < WEIGHTS.length; index++) {
        if (draw < WEIGHTS[index]) return MULTIPLIERS[index];
        draw -= WEIGHTS[index];
    }
    throw new Error('CRAFT_MULTIPLIER_NOT_SELECTED');
}

function itemValue(item, currency) {
    const raw = Number(item?.stars || Math.round(
        (Number(item?.price) || 0) * (currency === 'star' ? 125 : 1)
    ));
    if (!Number.isSafeInteger(raw) || raw <= 0) {
        throw new OperationError(409, 'INVALID_INVENTORY_ITEM');
    }
    return raw;
}

function findGift(amount, currency) {
    if (currency === 'silver') {
        const gift = silverGifts
            .filter(candidate => candidate.price <= amount)
            .sort((left, right) => right.price - left.price)[0];
        return gift ? { gift, value: gift.price } : null;
    }
    const gift = starGifts
        .filter(candidate => candidate.price <= amount || candidate.price * 125 <= amount)
        .sort((left, right) => {
            const leftValue = left.price <= amount ? left.price : left.price * 125;
            const rightValue = right.price <= amount ? right.price : right.price * 125;
            return rightValue - leftValue;
        })[0];
    if (!gift) return null;
    return {
        gift: { ...gift, currency: 'star' },
        value: gift.price <= amount ? gift.price : gift.price * 125
    };
}

async function craftItems({
    pool, env = process.env, telegramId, requestId, itemIds, currency,
    now = Date.now(), random
}) {
    validateInput(itemIds, currency);
    const request = { itemIds: [...itemIds].sort(), currency };
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
            const previousIds = previous.request?.itemIds;
            if (previous.operation !== 'item_craft' ||
                previous.request?.currency !== currency ||
                !Array.isArray(previousIds) ||
                previousIds.length !== request.itemIds.length ||
                previousIds.some((id, index) => id !== request.itemIds[index])) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const selectedIds = new Set(itemIds);
        const selectedItems = inventory.filter(item => selectedIds.has(item?.id));
        if (selectedItems.length !== itemIds.length) throw new OperationError(409, 'ITEMS_NOT_FOUND');
        if (selectedItems.some(item =>
            (item.currency || 'star') !== currency ||
            item.noCraft === true || item.noStake === true ||
            item.untradeable === true || item.limited === true
        )) {
            throw new OperationError(409, 'ITEMS_NOT_CRAFTABLE');
        }

        const total = selectedItems.reduce((sum, item) => sum + itemValue(item, currency), 0);
        if (!Number.isSafeInteger(total)) throw new OperationError(409, 'INVALID_INVENTORY_ITEM');
        const multiplier = chooseMultiplier(random);
        const payout = Math.min(MAX_PAYOUT, Math.floor(total * multiplier));
        const selectedGift = multiplier >= 1 ? findGift(payout, currency) : null;
        const remainder = selectedGift ? payout - selectedGift.value : payout;

        const nextInventory = inventory.filter(item => !selectedIds.has(item?.id));
        let gift = null;
        if (selectedGift) {
            gift = {
                id: `item_${randomUUID()}`,
                name: selectedGift.gift.name,
                price: selectedGift.gift.price,
                stars: selectedGift.gift.price,
                image: selectedGift.gift.image,
                currency,
                timestamp: now
            };
            nextInventory.push(gift);
        }

        const balanceField = currency === 'silver' ? 'silver' : 'stars';
        const nextBalance = BigInt(user[balanceField]) + BigInt(remainder);
        const balances = {
            stars: currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: currency === 'silver' ? nextBalance.toString() : String(user.silver)
        };
        const poolState = applyPoolMutation(user, {
            ...balances,
            inventory: nextInventory
        }, { env, now });

        await client.query(
            `UPDATE app_users SET stars = $1, silver = $2, inventory = $3::jsonb,
             balance_pool_started_at = $4, balance_pool_start_value = $5,
             balance_pool_escrow_value = $6, updated_at = NOW()
             WHERE telegram_id = $7`,
            [
                balances.stars, balances.silver, JSON.stringify(nextInventory),
                poolState.balance_pool_started_at, poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value, telegramId
            ]
        );
        if (remainder > 0) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'earn', $3, $4, $5, 'game:craft')`,
                [telegramId, randomUUID(), currency, remainder, nextBalance.toString()]
            );
        }

        const response = {
            currency,
            total,
            multiplier,
            payout,
            remainder,
            gift,
            stars: balances.stars,
            silver: balances.silver,
            inventory: nextInventory
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'item_craft', $3::jsonb, $4::jsonb)`,
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

module.exports = { chooseMultiplier, craftItems, findGift, itemValue, validateInput };

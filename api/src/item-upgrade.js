'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const giftCatalog = require('./gift-catalog.json');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const MIN_CHANCE = 5;
const MAX_CHANCE = 85;
const MAX_TARGET_PRICE_MULT = 20;
const MAX_TARGET_PRICE_STARS = 100_000_000;
const HOUSE_EDGE = 0.8;

function targetValue(gift) {
    return Math.round(gift.price < 200 ? gift.price * 125 : gift.price);
}

function chanceForUpgrade(item, target) {
    const stars = Number(item?.stars || Math.round((Number(item?.price) || 0) * 125));
    const targetStars = targetValue(target);
    if (!Number.isSafeInteger(stars) || stars <= 0 ||
        !Number.isSafeInteger(targetStars) || targetStars <= 0) {
        throw new OperationError(409, 'INVALID_INVENTORY_ITEM');
    }
    const chance = Math.round((stars / targetStars) * 100 * 10) / 10;
    if (targetStars > MAX_TARGET_PRICE_STARS ||
        targetStars > stars * MAX_TARGET_PRICE_MULT ||
        chance < MIN_CHANCE || chance > MAX_CHANCE) {
        throw new OperationError(400, 'INVALID_UPGRADE_TARGET');
    }
    return { stars, targetStars, chance };
}

function validateInput(itemId, targetName) {
    if (typeof itemId !== 'string' || itemId.length < 1 || itemId.length > 160 ||
        typeof targetName !== 'string' || targetName.length < 1 || targetName.length > 200) {
        throw new OperationError(400, 'INVALID_UPGRADE_REQUEST');
    }
}

async function upgradeItem({
    pool, env = process.env, telegramId, requestId, itemId, targetName,
    now = Date.now(), random = () => randomInt(1_000_000) / 10_000
}) {
    validateInput(itemId, targetName);
    const target = giftCatalog.find(gift => gift.name === targetName);
    if (!target || target.price <= 0) throw new OperationError(400, 'INVALID_UPGRADE_TARGET');

    const request = { itemId, targetName };
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
            if (previous.operation !== 'item_upgrade' ||
                previous.request?.itemId !== itemId ||
                previous.request?.targetName !== targetName) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const source = inventory.find(item => item?.id === itemId);
        if (!source) throw new OperationError(409, 'ITEMS_NOT_FOUND');
        if (source.noUpgrade === true || source.noStake === true ||
            source.untradeable === true || source.limited === true) {
            throw new OperationError(409, 'ITEM_NOT_UPGRADABLE');
        }
        const { chance } = chanceForUpgrade(source, target);
        const draw = random();
        if (!Number.isFinite(draw) || draw < 0 || draw >= 100) {
            throw new Error('INVALID_RANDOM_VALUE');
        }
        const success = draw < chance * HOUSE_EDGE;
        const nextInventory = inventory.filter(item => item?.id !== itemId);
        let wonItem = null;
        if (success) {
            wonItem = {
                id: `item_${randomUUID()}`,
                name: target.name,
                price: target.price,
                stars: targetValue(target),
                image: target.image,
                timestamp: now
            };
            nextInventory.push(wonItem);
        }

        const poolState = applyPoolMutation(user, {
            stars: user.stars,
            silver: user.silver,
            inventory: nextInventory
        }, { env, now });

        await client.query(
            `UPDATE app_users SET inventory = $1::jsonb,
             balance_pool_started_at = $2, balance_pool_start_value = $3,
             balance_pool_escrow_value = $4, updated_at = NOW()
             WHERE telegram_id = $5`,
            [
                JSON.stringify(nextInventory), poolState.balance_pool_started_at,
                poolState.balance_pool_start_value, poolState.balance_pool_escrow_value, telegramId
            ]
        );

        const response = {
            success,
            chance,
            effectiveChance: chance * HOUSE_EDGE,
            item: wonItem,
            inventory: nextInventory,
            stars: String(user.stars),
            silver: String(user.silver)
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'item_upgrade', $3::jsonb, $4::jsonb)`,
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

module.exports = { chanceForUpgrade, targetValue, upgradeItem, validateInput };

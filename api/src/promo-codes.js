'use strict';

const { randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const PROMO_CODES = Object.freeze({
    RELEASE: { currency: 'star', amount: 25_000 },
    LAMP: { currency: 'star', amount: 50_000 },
    SORRY: { currency: 'star', amount: 1_500_000 },
    ROPEKO: { currency: 'star', amount: 150_000 },
    LOOTSTAR: { currency: 'star', amount: 10_000 },
    STAR: { currency: 'star', amount: 5_000 },
    SILVER: { currency: 'silver', amount: 5_000 }
});

function normalizeCode(code) {
    if (typeof code !== 'string' || code.length < 1 || code.length > 64) {
        throw new OperationError(400, 'INVALID_PROMO_CODE');
    }
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,64}$/.test(normalized)) {
        throw new OperationError(400, 'INVALID_PROMO_CODE');
    }
    return normalized;
}

function customPromoReward(value, code, now) {
    if (!value || value.active !== true) throw new OperationError(404, 'PROMO_INACTIVE');
    if (value.rewardType === 'currency') {
        const currency = value.balanceField === 'silver' ? 'silver'
            : value.balanceField === 'stars' ? 'star' : null;
        const amount = Number(value.amount);
        if (!currency || !Number.isSafeInteger(amount) || amount <= 0) {
            throw new OperationError(400, 'PROMO_INVALID_REWARD');
        }
        return {
            currency,
            amount,
            summary: `${amount.toLocaleString('ru-RU')} ${value.currencyLabel || value.balanceField}`,
            item: null
        };
    }
    if (value.rewardType === 'item') {
        const reward = value.item;
        if (!reward || typeof reward.name !== 'string' || !reward.name.trim() ||
            typeof reward.image !== 'string' || !reward.image.trim() || reward.image.length > 2048) {
            throw new OperationError(400, 'PROMO_INVALID_REWARD');
        }
        if (reward.lottie != null &&
            (typeof reward.lottie !== 'string' || reward.lottie.length > 500 ||
                reward.lottie.includes('\\') || !/^(https:\/\/[^ ]+|\/[^ ]+|\.{1,2}\/[^ ]+)$/.test(reward.lottie) ||
                !/\.json(?:[?#].*)?$/i.test(reward.lottie))) {
            throw new OperationError(400, 'PROMO_INVALID_REWARD');
        }
        const currency = reward.currency === 'silver' ? 'silver' : 'star';
        const item = {
            id: `promo_${code}_${randomUUID()}`,
            name: reward.name.trim().slice(0, 160),
            price: Math.max(0, Number(reward.price) || 0),
            currency,
            image: reward.image.trim(),
            timestamp: now
        };
        if (reward.lottie) item.lottie = reward.lottie.trim();
        return { currency: null, amount: null, summary: item.name, item };
    }
    throw new OperationError(400, 'PROMO_INVALID_REWARD');
}

async function redeemPromo({ pool, env = process.env, telegramId, requestId, code, now = Date.now() }) {
    const normalizedCode = normalizeCode(code);
    const request = { code: normalizedCode };
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
            if (previous.operation !== 'promo_redeem' || previous.request?.code !== normalizedCode) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        let promo = PROMO_CODES[normalizedCode]
            ? {
                ...PROMO_CODES[normalizedCode],
                summary: `${PROMO_CODES[normalizedCode].amount.toLocaleString('ru-RU')} ${PROMO_CODES[normalizedCode].currency}`
            }
            : null;
        let customRecord = null;
        if (!promo) {
            const customResult = await client.query(
                `SELECT value FROM app_records WHERE namespace = 'promo_codes'
                 AND record_key = $1 FOR UPDATE`,
                [normalizedCode]
            );
            if (!customResult.rows.length) {
                throw new OperationError(404, normalizedCode === 'HALLOWEEN'
                    ? 'PROMO_INACTIVE'
                    : 'PROMO_NOT_FOUND');
            }
            customRecord = customResult.rows[0].value;
            promo = customPromoReward(customRecord, normalizedCode, now);
            const maximum = Number(customRecord.maxActivations) || 0;
            const used = Number(customRecord.usedCount) || 0;
            if (maximum > 0 && used >= maximum) throw new OperationError(409, 'PROMO_SOLD_OUT');
        }

        const usedResult = await client.query(
            'SELECT 1 FROM redeemed_promos WHERE telegram_id = $1 AND code = $2',
            [telegramId, normalizedCode]
        );
        if (usedResult.rows.length) throw new OperationError(409, 'PROMO_ALREADY_USED');

        const field = promo.currency === 'silver' ? 'silver' : 'stars';
        const nextBalance = promo.currency
            ? BigInt(user[field]) + BigInt(promo.amount)
            : BigInt(user[field]);
        const balances = {
            stars: promo.currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: promo.currency === 'silver' ? nextBalance.toString() : String(user.silver)
        };
        const inventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
        if (promo.item) inventory.push(promo.item);
        const poolState = applyPoolMutation(user, {
            ...balances,
            inventory
        }, { env, now });

        await client.query(
            `UPDATE app_users SET stars = $1, silver = $2,
             balance_pool_started_at = $3, balance_pool_start_value = $4,
             balance_pool_escrow_value = $5, updated_at = NOW()
             WHERE telegram_id = $6`,
            [
                balances.stars, balances.silver, poolState.balance_pool_started_at,
                poolState.balance_pool_start_value, poolState.balance_pool_escrow_value, telegramId
            ]
        );
        await client.query(
            `INSERT INTO redeemed_promos (telegram_id, code, currency, amount, request_id, reward)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
                telegramId, normalizedCode, promo.currency, promo.amount, requestId,
                JSON.stringify(promo.item ? { item: promo.item } : { currency: promo.currency, amount: promo.amount })
            ]
        );
        if (promo.currency) await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'earn', $3, $4, $5, $6)`,
            [
                telegramId, randomUUID(), promo.currency, promo.amount,
                nextBalance.toString(), `promo:${normalizedCode}`
            ]
        );
        if (customRecord) {
            const updatedPromo = { ...customRecord, usedCount: (Number(customRecord.usedCount) || 0) + 1 };
            await client.query(
                `UPDATE app_records SET value = $1::jsonb, updated_at = NOW()
                 WHERE namespace = 'promo_codes' AND record_key = $2`,
                [JSON.stringify(updatedPromo), normalizedCode]
            );
        }
        const response = {
            code: normalizedCode,
            currency: promo.currency,
            amount: promo.amount,
            stars: balances.stars,
            silver: balances.silver,
            inventory,
            rewardSummary: promo.summary,
            item: promo.item
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'promo_redeem', $3::jsonb, $4::jsonb)`,
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

module.exports = { PROMO_CODES, customPromoReward, normalizeCode, redeemPromo };

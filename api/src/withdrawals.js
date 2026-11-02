'use strict';

const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const DEFAULT_RATES = Object.freeze({
    lootStarPerTelegramStar: 2_000_000,
    minWithdrawTelegramStars: 25
});
const MAX_WITHDRAW_TELEGRAM_STARS = 100_000;

function getRates(value) {
    const rates = value && typeof value === 'object' ? value : {};
    const unitRate = Number(rates.lootStarPerTelegramStar);
    const minimum = Number(rates.minWithdrawTelegramStars);
    return {
        lootStarPerTelegramStar: Number.isSafeInteger(unitRate) && unitRate > 0
            ? unitRate : DEFAULT_RATES.lootStarPerTelegramStar,
        minWithdrawTelegramStars: Number.isSafeInteger(minimum) && minimum > 0
            ? minimum : DEFAULT_RATES.minWithdrawTelegramStars
    };
}

async function submitWithdrawal({ pool, env = process.env, telegramId, requestId, amount }) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new OperationError(400, 'INVALID_WITHDRAWAL');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT telegram_id, username, first_name, last_name, stars, silver, inventory, banned,
                    balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
             FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        const user = userResult.rows[0];
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');

        const previousResult = await client.query(
            'SELECT request FROM withdrawal_requests WHERE telegram_id = $1 AND request_id = $2',
            [telegramId, requestId]
        );
        if (previousResult.rows.length) {
            const previous = previousResult.rows[0].request;
            if (Number(previous.amountLootStar) !== amount) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous, duplicate: true };
        }

        const configResult = await client.query(
            'SELECT value FROM app_settings WHERE setting_key = $1',
            ['rates']
        );
        const rates = getRates(configResult.rows[0]?.value);
        const telegramStars = Math.floor(amount / rates.lootStarPerTelegramStar);
        const minimumAmount = rates.minWithdrawTelegramStars * rates.lootStarPerTelegramStar;
        const maximumAmount = MAX_WITHDRAW_TELEGRAM_STARS * rates.lootStarPerTelegramStar;
        if (amount < minimumAmount || telegramStars < rates.minWithdrawTelegramStars) {
            throw new OperationError(400, 'WITHDRAWAL_BELOW_MINIMUM');
        }
        if (amount > maximumAmount || telegramStars > MAX_WITHDRAW_TELEGRAM_STARS) {
            throw new OperationError(400, 'WITHDRAWAL_ABOVE_MAXIMUM');
        }
        if (BigInt(user.stars) < BigInt(amount)) {
            throw new OperationError(409, 'INSUFFICIENT_FUNDS');
        }

        const nextStars = (BigInt(user.stars) - BigInt(amount)).toString();
        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const poolState = applyPoolMutation(user, {
            stars: nextStars,
            silver: String(user.silver),
            inventory
        }, { env });
        const createdAt = Date.now();
        const request = {
            requestId,
            userId: `id_${telegramId}`,
            userName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '',
            telegramId,
            username: String(user.username || ''),
            amountLootStar: amount,
            amountTelegramStars: telegramStars,
            rateLootStarPerTelegramStar: rates.lootStarPerTelegramStar,
            minWithdrawTelegramStars: rates.minWithdrawTelegramStars,
            currency: 'star',
            payoutCurrency: 'telegram_star',
            platform: 'Telegram Stars',
            status: 'pending',
            createdAt,
            ts: createdAt,
            stars: nextStars,
            silver: String(user.silver)
        };

        await client.query(
            `UPDATE app_users SET stars = $1, balance_pool_started_at = $2,
             balance_pool_start_value = $3, balance_pool_escrow_value = $4, updated_at = NOW()
             WHERE telegram_id = $5`,
            [
                nextStars, poolState.balance_pool_started_at,
                poolState.balance_pool_start_value, poolState.balance_pool_escrow_value, telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'spend', 'star', $3, $4, 'withdrawal')`,
            [telegramId, requestId, amount, nextStars]
        );
        await client.query(
            `INSERT INTO withdrawal_requests (telegram_id, request_id, amount_loot_star,
             amount_telegram_stars, rate_loot_star_per_telegram_star, request)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
                telegramId, requestId, amount, telegramStars,
                rates.lootStarPerTelegramStar, JSON.stringify(request)
            ]
        );
        await client.query('COMMIT');
        return { ...request, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof BalancePoolError) throw new OperationError(error.status, error.code);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { DEFAULT_RATES, MAX_WITHDRAW_TELEGRAM_STARS, getRates, submitWithdrawal };

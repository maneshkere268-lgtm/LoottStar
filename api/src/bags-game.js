'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const starGifts = require('./gift-catalog.json');
const silverGifts = require('./silver-gift-catalog.json');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const MIN_BET = 10;
const MAX_BET = 50_000_000;
const MAX_PAYOUT = 250_000_000;
const MAX_DB_BALANCE = 9_223_372_036_854_775_807n;
const MULTIPLIERS = [0.75, 1, 1.1, 1.5, 5];
const WEIGHTS = [30, 20, 40, 5, 5];
const GIFT_THRESHOLD = { star: 100, silver: 80 };

function chooseOutcome(random = () => randomInt(100) / 100) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error('INVALID_RANDOM_VALUE');
    }
    let draw = Math.floor(value * WEIGHTS.reduce((sum, weight) => sum + weight, 0));
    for (let index = 0; index < WEIGHTS.length; index++) {
        if (draw < WEIGHTS[index]) return MULTIPLIERS[index];
        draw -= WEIGHTS[index];
    }
    return MULTIPLIERS[MULTIPLIERS.length - 1];
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

function resolveDrop(amount, currency) {
    const selected = findGift(amount, currency);
    if (!selected || selected.gift.price < GIFT_THRESHOLD[currency]) {
        return { gift: null, remainder: amount };
    }
    return { gift: selected.gift, remainder: amount - selected.value };
}

async function playBags({
    pool, env = process.env, telegramId, requestId, amount, currency,
    now = Date.now(), random
}) {
    if (!Number.isSafeInteger(amount) || amount < MIN_BET || amount > MAX_BET ||
        !['star', 'silver'].includes(currency)) {
        throw new OperationError(400, 'INVALID_BAGS_BET');
    }

    const request = { amount, currency };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT stars, silver, silver_turnover, banned, inventory,
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
            if (previous.operation !== 'bags_play' ||
                previous.request?.amount !== amount ||
                previous.request?.currency !== currency) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const field = currency === 'silver' ? 'silver' : 'stars';
        const balance = BigInt(user[field]);
        const bet = BigInt(amount);
        if (balance < bet) throw new OperationError(409, 'INSUFFICIENT_FUNDS');

        const multiplier = chooseOutcome(random);
        const payout = Math.min(MAX_PAYOUT, Math.floor(amount * multiplier));
        const drop = resolveDrop(payout, currency);
        const nextBalance = balance - bet + BigInt(drop.remainder);
        const silverTurnover = BigInt(user.silver_turnover || 0) +
            BigInt(currency === 'silver' ? amount : 0);
        if (nextBalance > MAX_DB_BALANCE || silverTurnover > MAX_DB_BALANCE) {
            throw new OperationError(409, 'BALANCE_LIMIT_REACHED');
        }

        const nextInventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
        let item = null;
        if (drop.gift) {
            item = {
                id: `item_${randomUUID()}`,
                name: drop.gift.name,
                price: drop.gift.price,
                stars: drop.gift.price,
                image: drop.gift.image,
                currency,
                timestamp: now
            };
            nextInventory.push(item);
        }
        const balances = {
            stars: currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: currency === 'silver' ? nextBalance.toString() : String(user.silver)
        };
        const poolState = applyPoolMutation(user, {
            ...balances,
            inventory: nextInventory
        }, { env, now });

        await client.query(
            `UPDATE app_users SET stars = $1, silver = $2, silver_turnover = $3,
             inventory = $4::jsonb, balance_pool_started_at = $5,
             balance_pool_start_value = $6, balance_pool_escrow_value = $7,
             updated_at = NOW() WHERE telegram_id = $8`,
            [
                balances.stars, balances.silver, silverTurnover.toString(),
                JSON.stringify(nextInventory), poolState.balance_pool_started_at,
                poolState.balance_pool_start_value, poolState.balance_pool_escrow_value,
                telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'spend', $3, $4, $5, 'game:bags')`,
            [telegramId, randomUUID(), currency, amount, (balance - bet).toString()]
        );
        if (drop.remainder > 0) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'earn', $3, $4, $5, 'game:bags')`,
                [telegramId, randomUUID(), currency, drop.remainder, nextBalance.toString()]
            );
        }

        const response = {
            currency,
            amount,
            multiplier,
            payout,
            remainder: drop.remainder,
            gift: item,
            stars: balances.stars,
            silver: balances.silver,
            silverTurnover: silverTurnover.toString(),
            inventory: nextInventory
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'bags_play', $3::jsonb, $4::jsonb)`,
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

module.exports = { chooseOutcome, findGift, playBags, resolveDrop };

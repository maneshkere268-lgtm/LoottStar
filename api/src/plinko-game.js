'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const MIN_BET = 10;
const MAX_BET = 50_000_000;
const MAX_PAYOUT = 250_000_000;
const MAX_DB_BALANCE = 9_223_372_036_854_775_807n;

const TABLES = {
    easy: {
        multipliers: [5.2, 1.6, 1.2, 1, 0.4, 1, 1.2, 1.6, 5.2],
        weights: [0.05, 0.25, 0.7, 4, 90, 4, 0.7, 0.25, 0.05]
    },
    medium: {
        multipliers: [18, 9.2, 3.2, 1.6, 1.2, 0.6, 0.4, 0.6, 1.2, 1.6, 3.2, 9.2, 18],
        weights: [0.1, 0.3, 0.6, 1, 3, 20, 50, 20, 3, 1, 0.6, 0.3, 0.1]
    },
    hard: {
        multipliers: [81, 24.4, 12.8, 6.6, 3.8, 1.8, 0.6, 0.4, 0.2, 0.4, 0.6, 1.8, 3.8, 6.6, 12.8, 24.4, 81],
        weights: [0.15, 0.15, 0.3, 0.5, 1, 2.9, 5, 20, 40, 20, 5, 2.9, 1, 0.5, 0.3, 0.15, 0.15]
    }
};

function chooseOutcome(difficulty, amount, random = () => randomInt(1_000_000_000) / 1_000_000_000) {
    const table = TABLES[difficulty];
    if (!table) throw new OperationError(400, 'INVALID_PLINKO_DIFFICULTY');
    const weights = table.weights.map(weight => Math.round(weight * 100));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error('INVALID_RANDOM_VALUE');
    }
    let draw = Math.floor(value * total);
    let binIndex = 0;
    for (; binIndex < weights.length - 1; binIndex++) {
        if (draw < weights[binIndex]) break;
        draw -= weights[binIndex];
    }
    const multiplier = table.multipliers[binIndex];
    const multiplierHundredths = Math.round(multiplier * 100);
    const rawPayout = Number((BigInt(amount) * BigInt(multiplierHundredths)) / 100n);
    return {
        binIndex,
        multiplier,
        payout: Math.min(MAX_PAYOUT, rawPayout)
    };
}

async function findPrevious(client, telegramId, requestId, request) {
    const result = await client.query(
        `SELECT operation, request, response FROM game_operations
         WHERE telegram_id = $1 AND request_id = $2`,
        [telegramId, requestId]
    );
    if (!result.rows.length) return null;
    const previous = result.rows[0];
    if (previous.operation !== 'plinko_drop' ||
        previous.request?.amount !== request.amount ||
        previous.request?.currency !== request.currency ||
        previous.request?.difficulty !== request.difficulty) {
        throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
    }
    return previous.response;
}

async function dropPlinko({
    pool, env = process.env, telegramId, requestId, amount, currency, difficulty, now = Date.now(), random
}) {
    if (!Number.isSafeInteger(amount) || amount < MIN_BET || amount > MAX_BET ||
        !['star', 'silver'].includes(currency)) {
        throw new OperationError(400, 'INVALID_PLINKO_BET');
    }
    if (!Object.hasOwn(TABLES, difficulty)) {
        throw new OperationError(400, 'INVALID_PLINKO_DIFFICULTY');
    }

    const request = { amount, currency, difficulty };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT telegram_id, stars, silver, silver_turnover, banned, inventory,
                    balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
             FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        const user = userResult.rows[0];
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');
        const previous = await findPrevious(client, telegramId, requestId, request);
        if (previous) {
            await client.query('COMMIT');
            return { ...previous, duplicate: true };
        }

        const outcome = chooseOutcome(difficulty, amount, random);
        const field = currency === 'silver' ? 'silver' : 'stars';
        const balance = BigInt(user[field]);
        const cost = BigInt(amount);
        if (balance < cost) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
        const nextBalance = balance - cost + BigInt(outcome.payout);
        const silverTurnover = BigInt(user.silver_turnover || 0) +
            BigInt(currency === 'silver' ? amount : 0);
        if (nextBalance > MAX_DB_BALANCE || silverTurnover > MAX_DB_BALANCE) {
            throw new OperationError(409, 'BALANCE_LIMIT_REACHED');
        }
        const balances = {
            stars: currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: currency === 'silver' ? nextBalance.toString() : String(user.silver)
        };
        const poolState = applyPoolMutation(user, {
            ...balances,
            inventory: Array.isArray(user.inventory) ? user.inventory : []
        }, { env, now });

        await client.query(
            `UPDATE app_users SET ${field} = $1,
             silver_turnover = silver_turnover + $2,
             balance_pool_started_at = $3, balance_pool_start_value = $4,
             balance_pool_escrow_value = $5, updated_at = NOW()
             WHERE telegram_id = $6`,
            [
                nextBalance.toString(),
                currency === 'silver' ? amount : 0,
                poolState.balance_pool_started_at,
                poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value,
                telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'spend', $3, $4, $5, 'game:plinko')`,
            [telegramId, randomUUID(), currency, amount, (balance - cost).toString()]
        );
        if (outcome.payout > 0) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'earn', $3, $4, $5, 'game:plinko')`,
                [telegramId, randomUUID(), currency, outcome.payout, nextBalance.toString()]
            );
        }

        const response = {
            currency,
            amount,
            difficulty,
            binIndex: outcome.binIndex,
            multiplier: outcome.multiplier,
            payout: outcome.payout,
            displayMultiplier: Math.floor((outcome.payout / amount) * 100) / 100,
            stars: balances.stars,
            silver: balances.silver,
            silverTurnover: silverTurnover.toString()
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'plinko_drop', $3::jsonb, $4::jsonb)`,
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

module.exports = { chooseOutcome, dropPlinko };

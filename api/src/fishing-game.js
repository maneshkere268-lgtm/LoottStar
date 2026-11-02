'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const TARGET_RTP = 0.95;
const MAX_BET = 50_000_000;
const MAX_PAYOUT = 250_000_000;
const MAX_DB_BALANCE = 9_223_372_036_854_775_807n;
const STEPS = [
    1.05, 1.12, 1.21, 1.3, 1.41, 1.51, 1.63, 1.75, 1.87, 2,
    2.3, 2.65, 3, 3.5, 4, 4.6, 5.3, 6.1, 7.1, 8.1,
    9.4, 11, 12, 14, 16, 19, 22, 25
];

function bustChanceForStep(step) {
    if (!Number.isInteger(step) || step < 1 || step > STEPS.length) {
        throw new OperationError(400, 'INVALID_FISHING_STEP');
    }
    const previousMultiplier = step === 1 ? TARGET_RTP : STEPS[step - 2];
    return 1 - previousMultiplier / STEPS[step - 1];
}

function chooseStepResult(step, random = () => randomInt(1_000_000) / 1_000_000) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error('INVALID_RANDOM_VALUE');
    }
    return value < bustChanceForStep(step) ? 'lost' : 'active';
}

function calculatePayout(amount, step) {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_BET ||
        !Number.isInteger(step) || step < 1 || step > STEPS.length) {
        throw new OperationError(400, 'INVALID_FISHING_CASHOUT');
    }
    return Math.min(MAX_PAYOUT, Math.round(amount * STEPS[step - 1]));
}

function publicGame(session) {
    return {
        gameId: session.session_id,
        status: session.status,
        amount: Number(session.bet_amount),
        currency: session.currency,
        step: Number(session.step),
        multiplier: Number(session.step) ? STEPS[Number(session.step) - 1] : 0,
        payout: Number(session.payout) || 0
    };
}

function validateId(value) {
    if (typeof value !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new OperationError(400, 'INVALID_FISHING_REQUEST');
    }
}

async function findPrevious(client, telegramId, requestId, operation, request) {
    const result = await client.query(
        `SELECT operation, request, response FROM game_operations
         WHERE telegram_id = $1 AND request_id = $2`,
        [telegramId, requestId]
    );
    if (!result.rows.length) return null;
    const previous = result.rows[0];
    if (previous.operation !== operation ||
        previous.request?.gameId !== request.gameId ||
        previous.request?.amount !== request.amount ||
        previous.request?.currency !== request.currency) {
        throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
    }
    return previous.response;
}

async function saveOperation(client, telegramId, requestId, operation, request, response) {
    await client.query(
        `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [telegramId, requestId, operation, JSON.stringify(request), JSON.stringify(response)]
    );
}

async function lockUser(client, telegramId) {
    const result = await client.query(
        `SELECT stars, silver, silver_turnover, banned, inventory,
                balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
         FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
        [telegramId]
    );
    if (!result.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
    if (result.rows[0].banned) throw new OperationError(403, 'ACCOUNT_BANNED');
    return result.rows[0];
}

async function runTransaction(pool, handler) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await handler(client);
        await client.query('COMMIT');
        return result;
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

async function startFishing({
    pool, env = process.env, telegramId, requestId, amount, currency, now = Date.now()
}) {
    validateId(requestId);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_BET ||
        !['star', 'silver'].includes(currency)) {
        throw new OperationError(400, 'INVALID_FISHING_BET');
    }
    const request = { amount, currency };
    return runTransaction(pool, async client => {
        const user = await lockUser(client, telegramId);
        const previous = await findPrevious(client, telegramId, requestId, 'fishing_start', request);
        if (previous) return { ...previous, duplicate: true };
        const activeResult = await client.query(
            `SELECT 1 FROM fishing_sessions WHERE telegram_id = $1 AND status = 'active'`,
            [telegramId]
        );
        if (activeResult.rows.length) throw new OperationError(409, 'FISHING_ROUND_ACTIVE');

        const field = currency === 'silver' ? 'silver' : 'stars';
        const balance = BigInt(user[field]);
        const bet = BigInt(amount);
        if (balance < bet) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
        const nextBalance = balance - bet;
        const silverTurnover = BigInt(user.silver_turnover || 0) +
            BigInt(currency === 'silver' ? amount : 0);
        if (silverTurnover > MAX_DB_BALANCE) {
            throw new OperationError(409, 'BALANCE_LIMIT_REACHED');
        }
        const balances = {
            stars: currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: currency === 'silver' ? nextBalance.toString() : String(user.silver)
        };
        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const poolState = applyPoolMutation(user, { ...balances, inventory }, { env, now });

        await client.query(
            `UPDATE app_users SET ${field} = $1, silver_turnover = $2,
             balance_pool_started_at = $3, balance_pool_start_value = $4,
             balance_pool_escrow_value = $5, updated_at = NOW()
             WHERE telegram_id = $6`,
            [
                nextBalance.toString(), silverTurnover.toString(),
                poolState.balance_pool_started_at, poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value, telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'spend', $3, $4, $5, 'game:fishing')`,
            [telegramId, randomUUID(), currency, amount, nextBalance.toString()]
        );
        const session = {
            session_id: randomUUID(),
            telegram_id: telegramId,
            bet_amount: amount,
            currency,
            step: 0,
            status: 'active',
            payout: 0
        };
        await client.query(
            `INSERT INTO fishing_sessions (session_id, telegram_id, bet_amount, currency, step, status)
             VALUES ($1, $2, $3, $4, 0, 'active')`,
            [session.session_id, telegramId, amount, currency]
        );
        const response = {
            game: publicGame(session),
            stars: balances.stars,
            silver: balances.silver,
            silverTurnover: silverTurnover.toString()
        };
        await saveOperation(client, telegramId, requestId, 'fishing_start', request, response);
        return { ...response, duplicate: false };
    });
}

async function getActiveFishing({ pool, telegramId }) {
    const result = await pool.query(
        `SELECT session_id, bet_amount, currency, step, status, payout
         FROM fishing_sessions WHERE telegram_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [telegramId]
    );
    return { game: result.rows.length ? publicGame(result.rows[0]) : null };
}

async function continueFishing({
    pool, telegramId, requestId, gameId, random
}) {
    validateId(requestId);
    validateId(gameId);
    const request = { gameId };
    return runTransaction(pool, async client => {
        await lockUser(client, telegramId);
        const previous = await findPrevious(client, telegramId, requestId, 'fishing_continue', request);
        if (previous) return { ...previous, duplicate: true };
        const sessionResult = await client.query(
            `SELECT session_id, telegram_id, bet_amount, currency, step, status, payout
             FROM fishing_sessions WHERE session_id = $1 AND telegram_id = $2 FOR UPDATE`,
            [gameId, telegramId]
        );
        if (!sessionResult.rows.length) throw new OperationError(404, 'FISHING_ROUND_NOT_FOUND');
        const session = sessionResult.rows[0];
        if (session.status !== 'active') throw new OperationError(409, 'FISHING_ROUND_NOT_ACTIVE');
        const step = Number(session.step) + 1;
        if (step > STEPS.length) throw new OperationError(409, 'FISHING_MAX_STEP');
        session.step = step;
        session.status = chooseStepResult(step, random);
        await client.query(
            `UPDATE fishing_sessions SET step = $1, status = $2, updated_at = NOW()
             WHERE session_id = $3 AND telegram_id = $4`,
            [session.step, session.status, gameId, telegramId]
        );
        const response = { game: publicGame(session) };
        await saveOperation(client, telegramId, requestId, 'fishing_continue', request, response);
        return { ...response, duplicate: false };
    });
}

async function cashoutFishing({
    pool, env = process.env, telegramId, requestId, gameId, now = Date.now()
}) {
    validateId(requestId);
    validateId(gameId);
    const request = { gameId };
    return runTransaction(pool, async client => {
        const user = await lockUser(client, telegramId);
        const previous = await findPrevious(client, telegramId, requestId, 'fishing_cashout', request);
        if (previous) return { ...previous, duplicate: true };
        const sessionResult = await client.query(
            `SELECT session_id, telegram_id, bet_amount, currency, step, status, payout
             FROM fishing_sessions WHERE session_id = $1 AND telegram_id = $2 FOR UPDATE`,
            [gameId, telegramId]
        );
        if (!sessionResult.rows.length) throw new OperationError(404, 'FISHING_ROUND_NOT_FOUND');
        const session = sessionResult.rows[0];
        if (session.status !== 'active') throw new OperationError(409, 'FISHING_ROUND_NOT_ACTIVE');
        if (Number(session.step) < 1) throw new OperationError(409, 'FISHING_NO_CATCH_TO_COLLECT');

        const payout = calculatePayout(Number(session.bet_amount), Number(session.step));
        const field = session.currency === 'silver' ? 'silver' : 'stars';
        const nextBalance = BigInt(user[field]) + BigInt(payout);
        if (nextBalance > MAX_DB_BALANCE) throw new OperationError(409, 'BALANCE_LIMIT_REACHED');
        const balances = {
            stars: session.currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: session.currency === 'silver' ? nextBalance.toString() : String(user.silver)
        };
        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const poolState = applyPoolMutation(user, { ...balances, inventory }, { env, now });
        await client.query(
            `UPDATE app_users SET ${field} = $1,
             balance_pool_started_at = $2, balance_pool_start_value = $3,
             balance_pool_escrow_value = $4, updated_at = NOW()
             WHERE telegram_id = $5`,
            [
                nextBalance.toString(), poolState.balance_pool_started_at,
                poolState.balance_pool_start_value, poolState.balance_pool_escrow_value,
                telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'earn', $3, $4, $5, 'game:fishing')`,
            [telegramId, randomUUID(), session.currency, payout, nextBalance.toString()]
        );
        session.status = 'won';
        session.payout = payout;
        await client.query(
            `UPDATE fishing_sessions SET status = 'won', payout = $1, updated_at = NOW()
             WHERE session_id = $2 AND telegram_id = $3`,
            [payout, gameId, telegramId]
        );
        const response = {
            game: publicGame(session),
            stars: balances.stars,
            silver: balances.silver,
            payout
        };
        await saveOperation(client, telegramId, requestId, 'fishing_cashout', request, response);
        return { ...response, duplicate: false };
    });
}

module.exports = {
    STEPS,
    bustChanceForStep,
    calculatePayout,
    cashoutFishing,
    chooseStepResult,
    continueFishing,
    getActiveFishing,
    publicGame,
    startFishing
};

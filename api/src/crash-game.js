'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const MIN_BET = 25;
const MAX_BET = 50_000_000;
const MAX_PAYOUT = 250_000_000;
const BETTING_PHASE_MS = 7_000;
const MAX_DB_BALANCE = 9_223_372_036_854_775_807n;

function speedFor(multiplier) {
    if (multiplier < 1.5) return 0.06;
    if (multiplier < 2) return 0.12;
    if (multiplier < 3) return 0.2;
    if (multiplier < 5) return 0.3;
    if (multiplier < 10) return 0.5;
    if (multiplier < 50) return 0.8;
    return 1.2;
}

function generateCrashMultiplier(random = () => randomInt(10_000)) {
    const roll = random();
    if (!Number.isSafeInteger(roll) || roll < 0 || roll >= 10_000) {
        throw new Error('INVALID_RANDOM_VALUE');
    }
    if (roll < 200) return 100;
    if (roll < 4_000) return 101 + randomInt(50);
    if (roll < 7_000) return 150 + randomInt(150);
    if (roll < 9_000) return 300 + randomInt(700);
    if (roll < 9_800) return 1_000 + randomInt(4_000);
    return 5_000 + randomInt(20_000);
}

function durationUntilMultiplier(multiplierHundredths) {
    let multiplier = 100;
    let elapsed = 0;
    while (multiplier < multiplierHundredths) {
        const speed = speedFor(multiplier / 100);
        elapsed += Math.ceil(10 / speed);
        multiplier++;
    }
    return elapsed;
}

function currentMultiplier(session, now) {
    if (now < Number(session.start_at)) return 100;
    if (now >= Number(session.crash_at)) return Number(session.crash_multiplier);
    let multiplier = 100;
    let elapsed = 0;
    const available = now - Number(session.start_at);
    while (multiplier < Number(session.crash_multiplier)) {
        const stepDuration = Math.ceil(10 / speedFor(multiplier / 100));
        if (elapsed + stepDuration > available) break;
        elapsed += stepDuration;
        multiplier++;
    }
    return multiplier;
}

function publicGame(session, now = Date.now()) {
    const status = session.status === 'active' && now >= Number(session.crash_at)
        ? 'lost'
        : session.status;
    const multiplier = status === 'lost'
        ? Number(session.crash_multiplier)
        : currentMultiplier(session, now);
    return {
        gameId: session.session_id,
        status,
        currency: session.currency,
        amount: Number(session.bet_amount),
        startsAt: Number(session.start_at),
        phase: now < Number(session.start_at) ? 'waiting' : status === 'active' ? 'flying' : 'crashed',
        multiplier: multiplier / 100,
        ...(status !== 'active' ? { crashMultiplier: Number(session.crash_multiplier) / 100 } : {}),
        ...(session.cashout_multiplier ? { cashoutMultiplier: Number(session.cashout_multiplier) / 100 } : {}),
        payout: Number(session.payout) || 0
    };
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
        previous.request?.amount !== request.amount ||
        previous.request?.currency !== request.currency ||
        (request.gameId !== undefined && previous.request?.gameId !== request.gameId)) {
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
        `SELECT telegram_id, stars, silver, silver_turnover, banned, inventory,
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
        const response = await handler(client);
        await client.query('COMMIT');
        return response;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof BalancePoolError) throw new OperationError(error.status, error.code);
        throw error;
    } finally {
        client.release();
    }
}

async function startCrash({
    pool, env = process.env, telegramId, requestId, amount, currency, now = Date.now(), random
}) {
    if (!Number.isSafeInteger(amount) || amount < MIN_BET || amount > MAX_BET ||
        !['star', 'silver'].includes(currency)) {
        throw new OperationError(400, 'INVALID_CRASH_BET');
    }
    const request = { amount, currency };
    return runTransaction(pool, async client => {
        const user = await lockUser(client, telegramId);
        const previous = await findPrevious(client, telegramId, requestId, 'crash_start', request);
        if (previous) return { ...previous, duplicate: true };
        const activeResult = await client.query(
            `SELECT 1 FROM crash_sessions WHERE telegram_id = $1 AND status = 'active'`,
            [telegramId]
        );
        if (activeResult.rows.length) throw new OperationError(409, 'CRASH_ROUND_ALREADY_ACTIVE');

        const field = currency === 'silver' ? 'silver' : 'stars';
        const balance = BigInt(user[field]);
        const cost = BigInt(amount);
        if (balance < cost) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
        const nextBalance = balance - cost;
        const balances = {
            stars: currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: currency === 'silver' ? nextBalance.toString() : String(user.silver)
        };
        const poolState = applyPoolMutation(user, {
            ...balances,
            inventory: Array.isArray(user.inventory) ? user.inventory : []
        }, { env, now });
        const startAt = now + BETTING_PHASE_MS;
        const crashMultiplier = generateCrashMultiplier(random);
        const crashAt = startAt + durationUntilMultiplier(crashMultiplier);
        await client.query(
            `UPDATE app_users SET ${field} = $1,
             balance_pool_started_at = $2, balance_pool_start_value = $3,
             balance_pool_escrow_value = $4, updated_at = NOW()
             WHERE telegram_id = $5`,
            [
                nextBalance.toString(), poolState.balance_pool_started_at,
                poolState.balance_pool_start_value, poolState.balance_pool_escrow_value, telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'spend', $3, $4, $5, 'game:crash')`,
            [telegramId, requestId, currency, amount, nextBalance.toString()]
        );
        const session = {
            session_id: randomUUID(),
            telegram_id: telegramId,
            bet_amount: amount,
            currency,
            start_at: startAt,
            crash_at: crashAt,
            crash_multiplier: crashMultiplier,
            status: 'active',
            payout: 0
        };
        await client.query(
            `INSERT INTO crash_sessions
             (session_id, telegram_id, bet_amount, currency, start_at, crash_at, crash_multiplier, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
            [
                session.session_id, telegramId, amount, currency, startAt,
                crashAt, crashMultiplier
            ]
        );
        const response = {
            game: publicGame(session, now),
            stars: balances.stars,
            silver: balances.silver,
            silverTurnover: String(user.silver_turnover || 0)
        };
        await saveOperation(client, telegramId, requestId, 'crash_start', request, response);
        return { ...response, duplicate: false };
    });
}

async function getCurrentCrash({ pool, telegramId, now = Date.now() }) {
    return runTransaction(pool, async client => {
        const result = await client.query(
            `SELECT session_id, bet_amount, currency, start_at, crash_at,
                    crash_multiplier, status, cashout_multiplier, payout
             FROM crash_sessions
             WHERE telegram_id = $1 AND status = 'active'
             ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [telegramId]
        );
        if (!result.rows.length) return { game: null };
        const session = result.rows[0];
        if (now >= Number(session.crash_at)) {
            await client.query(
                `UPDATE crash_sessions SET status = 'lost', updated_at = NOW()
                 WHERE session_id = $1 AND status = 'active'`,
                [session.session_id]
            );
            session.status = 'lost';
        }
        return { game: publicGame(session, now) };
    });
}

async function cashoutCrash({ pool, env = process.env, telegramId, requestId, gameId, now = Date.now() }) {
    if (typeof gameId !== 'string') throw new OperationError(400, 'INVALID_CRASH_CASHOUT');
    const request = { gameId };
    return runTransaction(pool, async client => {
        const user = await lockUser(client, telegramId);
        const previous = await findPrevious(client, telegramId, requestId, 'crash_cashout', request);
        if (previous) return { ...previous, duplicate: true };
        const result = await client.query(
            `SELECT session_id, bet_amount, currency, start_at, crash_at,
                    crash_multiplier, status, cashout_multiplier, payout
             FROM crash_sessions
             WHERE session_id = $1 AND telegram_id = $2 FOR UPDATE`,
            [gameId, telegramId]
        );
        if (!result.rows.length) throw new OperationError(404, 'CRASH_GAME_NOT_FOUND');
        const session = result.rows[0];
        if (session.status !== 'active') throw new OperationError(409, 'CRASH_GAME_FINISHED');
        if (now < Number(session.start_at)) throw new OperationError(409, 'CRASH_ROUND_NOT_STARTED');
        if (now >= Number(session.crash_at)) {
            await client.query(
                `UPDATE crash_sessions SET status = 'lost', updated_at = NOW() WHERE session_id = $1`,
                [gameId]
            );
            const response = {
                game: publicGame({ ...session, status: 'lost' }, now),
                stars: String(user.stars),
                silver: String(user.silver),
                silverTurnover: String(user.silver_turnover || 0)
            };
            await saveOperation(client, telegramId, requestId, 'crash_cashout', request, response);
            return { ...response, duplicate: false };
        }

        const multiplier = currentMultiplier(session, now);
        const payout = Math.min(
            MAX_PAYOUT,
            Number((BigInt(session.bet_amount) * BigInt(multiplier)) / 100n)
        );
        const field = session.currency === 'silver' ? 'silver' : 'stars';
        const nextBalance = BigInt(user[field]) + BigInt(payout);
        const silverTurnover = BigInt(user.silver_turnover || 0) +
            BigInt(session.currency === 'silver' ? session.bet_amount : 0);
        if (nextBalance > MAX_DB_BALANCE || silverTurnover > MAX_DB_BALANCE) {
            throw new OperationError(409, 'BALANCE_LIMIT_REACHED');
        }
        const balances = {
            stars: session.currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: session.currency === 'silver' ? nextBalance.toString() : String(user.silver)
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
                session.currency === 'silver' ? session.bet_amount : 0,
                poolState.balance_pool_started_at,
                poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value,
                telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'earn', $3, $4, $5, 'game:crash')`,
            [telegramId, randomUUID(), session.currency, payout, nextBalance.toString()]
        );
        await client.query(
            `UPDATE crash_sessions SET status = 'won', cashout_multiplier = $1,
             payout = $2, updated_at = NOW() WHERE session_id = $3`,
            [multiplier, payout, gameId]
        );
        const response = {
            game: publicGame({
                ...session,
                status: 'won',
                cashout_multiplier: multiplier,
                payout
            }, now),
            stars: balances.stars,
            silver: balances.silver,
            silverTurnover: silverTurnover.toString()
        };
        await saveOperation(client, telegramId, requestId, 'crash_cashout', request, response);
        return { ...response, duplicate: false };
    });
}

module.exports = {
    BETTING_PHASE_MS,
    cashoutCrash,
    currentMultiplier,
    durationUntilMultiplier,
    generateCrashMultiplier,
    getCurrentCrash,
    publicGame,
    speedFor,
    startCrash
};

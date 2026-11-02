'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const GRID_SIZE = 25;
const MAX_BET = 50_000_000;

function multiplierFor(opened) {
    return Math.round((1 + 0.05 * opened) * 100) / 100;
}

function payoutFor(bet, opened) {
    return Math.min(250_000_000, Math.floor(Number(bet) * multiplierFor(opened)));
}

function makeMinePositions(count) {
    const cells = Array.from({ length: GRID_SIZE }, (_, index) => index);
    for (let index = cells.length - 1; index > 0; index--) {
        const swap = randomInt(index + 1);
        [cells[index], cells[swap]] = [cells[swap], cells[index]];
    }
    return cells.slice(0, count).sort((a, b) => a - b);
}

function jsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function view(session) {
    const revealedCells = jsonArray(session.revealed_cells);
    const result = {
        gameId: session.session_id,
        status: session.status,
        currency: session.currency,
        betAmount: Number(session.bet_amount),
        minesCount: Number(session.mines_count),
        revealedCells,
        openedCount: revealedCells.length,
        multiplier: multiplierFor(revealedCells.length),
        cashoutAmount: session.status === 'active'
            ? payoutFor(session.bet_amount, revealedCells.length)
            : 0,
        payout: Number(session.payout) || 0
    };
    if (session.status !== 'active') result.minePositions = jsonArray(session.mine_positions);
    return result;
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
        JSON.stringify(previous.request) !== JSON.stringify(request)) {
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
        `SELECT telegram_id, stars, silver, banned, inventory,
                balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
         FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
        [telegramId]
    );
    if (!result.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
    if (result.rows[0].banned) throw new OperationError(403, 'ACCOUNT_BANNED');
    return result.rows[0];
}

async function writeBalances(client, user, currency, amount, env, now) {
    const field = currency === 'silver' ? 'silver' : 'stars';
    const balance = BigInt(user[field]) + BigInt(amount);
    const balances = {
        stars: currency === 'star' ? balance.toString() : String(user.stars),
        silver: currency === 'silver' ? balance.toString() : String(user.silver)
    };
    const poolState = applyPoolMutation(user, {
        ...balances,
        inventory: Array.isArray(user.inventory) ? user.inventory : []
    }, { env, now });
    await client.query(
        `UPDATE app_users SET ${field} = $1, balance_pool_started_at = $2,
         balance_pool_start_value = $3, balance_pool_escrow_value = $4, updated_at = NOW()
         WHERE telegram_id = $5`,
        [
            balances[field], poolState.balance_pool_started_at, poolState.balance_pool_start_value,
            poolState.balance_pool_escrow_value, user.telegram_id
        ]
    );
    return { balance: balance.toString(), balances };
}

async function recordBalance(client, telegramId, currency, operation, amount, balance) {
    await client.query(
        `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'game:mines')`,
        [telegramId, randomUUID(), operation, currency, amount, balance]
    );
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

async function startMines({ pool, env = process.env, telegramId, requestId, amount, currency, minesCount, now = Date.now() }) {
    if (!Number.isSafeInteger(amount) || amount < 15 || amount > MAX_BET ||
        !['star', 'silver'].includes(currency) ||
        ![2, 4, 10, 15].includes(minesCount)) {
        throw new OperationError(400, 'INVALID_MINES_BET');
    }
    const request = { amount, currency, minesCount };
    return runTransaction(pool, async client => {
        const user = await lockUser(client, telegramId);
        const previous = await findPrevious(client, telegramId, requestId, 'mines_start', request);
        if (previous) return { ...previous, duplicate: true };

        const active = await client.query(
            `SELECT 1 FROM mines_sessions WHERE telegram_id = $1 AND status = 'active'`,
            [telegramId]
        );
        if (active.rows.length) throw new OperationError(409, 'MINES_ROUND_ALREADY_ACTIVE');
        const field = currency === 'silver' ? 'silver' : 'stars';
        const balance = BigInt(user[field]);
        if (balance < BigInt(amount)) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
        const after = balance - BigInt(amount);
        const balances = {
            stars: currency === 'star' ? after.toString() : String(user.stars),
            silver: currency === 'silver' ? after.toString() : String(user.silver)
        };
        const poolState = applyPoolMutation(user, {
            ...balances,
            inventory: Array.isArray(user.inventory) ? user.inventory : []
        }, { env, now });
        await client.query(
            `UPDATE app_users SET ${field} = $1, balance_pool_started_at = $2,
             balance_pool_start_value = $3, balance_pool_escrow_value = $4, updated_at = NOW()
             WHERE telegram_id = $5`,
            [
                after.toString(), poolState.balance_pool_started_at, poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value, telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'spend', $3, $4, $5, 'game:mines')`,
            [telegramId, requestId, currency, amount, after.toString()]
        );
        const session = {
            session_id: randomUUID(),
            telegram_id: telegramId,
            mines_count: minesCount,
            bet_amount: amount,
            currency,
            mine_positions: makeMinePositions(minesCount),
            revealed_cells: [],
            status: 'active',
            payout: 0
        };
        await client.query(
            `INSERT INTO mines_sessions
             (session_id, telegram_id, mines_count, bet_amount, currency, mine_positions, status)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'active')`,
            [
                session.session_id, telegramId, minesCount, amount, currency,
                JSON.stringify(session.mine_positions)
            ]
        );
        const response = {
            game: view(session),
            stars: balances.stars,
            silver: balances.silver
        };
        await saveOperation(client, telegramId, requestId, 'mines_start', request, response);
        return { ...response, duplicate: false };
    });
}

async function getActiveMines({ pool, telegramId }) {
    const result = await pool.query(
        `SELECT session_id, mines_count, bet_amount, currency, mine_positions,
                revealed_cells, status, payout
         FROM mines_sessions WHERE telegram_id = $1 AND status = 'active' LIMIT 1`,
        [telegramId]
    );
    return result.rows.length ? view(result.rows[0]) : null;
}

async function performMinesAction({
    pool, env = process.env, telegramId, requestId, gameId, action, cell, now = Date.now()
}) {
    if (!['reveal', 'cashout'].includes(action) || typeof gameId !== 'string' ||
        (action === 'reveal' && (!Number.isSafeInteger(cell) || cell < 0 || cell >= GRID_SIZE))) {
        throw new OperationError(400, 'INVALID_MINES_ACTION');
    }
    const operation = action === 'reveal' ? 'mines_reveal' : 'mines_cashout';
    const request = action === 'reveal' ? { gameId, cell } : { gameId };
    return runTransaction(pool, async client => {
        const user = await lockUser(client, telegramId);
        const previous = await findPrevious(client, telegramId, requestId, operation, request);
        if (previous) return { ...previous, duplicate: true };
        const found = await client.query(
            `SELECT session_id, mines_count, bet_amount, currency, mine_positions,
                    revealed_cells, status, payout FROM mines_sessions
             WHERE session_id = $1 AND telegram_id = $2 FOR UPDATE`,
            [gameId, telegramId]
        );
        if (!found.rows.length) throw new OperationError(404, 'MINES_GAME_NOT_FOUND');
        const session = found.rows[0];
        if (session.status !== 'active') throw new OperationError(409, 'MINES_GAME_FINISHED');
        const mines = jsonArray(session.mine_positions);
        const revealed = jsonArray(session.revealed_cells);
        let nextStatus = 'active';
        let payout = 0;
        let hitMine = false;

        if (action === 'reveal') {
            if (revealed.includes(cell)) throw new OperationError(409, 'MINES_CELL_ALREADY_REVEALED');
            hitMine = mines.includes(cell);
            if (hitMine) {
                nextStatus = 'lost';
                revealed.push(cell);
            } else {
                revealed.push(cell);
                revealed.sort((a, b) => a - b);
                if (revealed.length === GRID_SIZE - Number(session.mines_count)) {
                    nextStatus = 'won';
                    payout = payoutFor(session.bet_amount, revealed.length);
                }
            }
        } else {
            if (!revealed.length) throw new OperationError(409, 'MINES_NO_SAFE_CELLS');
            nextStatus = 'won';
            payout = payoutFor(session.bet_amount, revealed.length);
        }

        const response = { game: null };
        if (nextStatus === 'won') {
            const credited = await writeBalances(client, user, session.currency, payout, env, now);
            await recordBalance(client, telegramId, session.currency, 'earn', payout, credited.balance);
            response.stars = credited.balances.stars;
            response.silver = credited.balances.silver;
        } else if (nextStatus === 'active') {
            response.stars = String(user.stars);
            response.silver = String(user.silver);
        } else {
            response.stars = String(user.stars);
            response.silver = String(user.silver);
        }
        await client.query(
            `UPDATE mines_sessions SET revealed_cells = $1::jsonb, status = $2, payout = $3,
             updated_at = NOW() WHERE session_id = $4`,
            [JSON.stringify(revealed), nextStatus, payout, gameId]
        );
        response.game = {
            ...view({ ...session, status: nextStatus, revealed_cells: revealed, payout }),
            hitMine
        };
        await saveOperation(client, telegramId, requestId, operation, request, response);
        return { ...response, duplicate: false };
    });
}

module.exports = {
    getActiveMines,
    makeMinePositions,
    multiplierFor,
    payoutFor,
    performMinesAction,
    startMines
};

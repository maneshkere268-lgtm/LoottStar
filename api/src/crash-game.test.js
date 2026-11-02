'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    BETTING_PHASE_MS,
    cashoutCrash,
    currentMultiplier,
    durationUntilMultiplier,
    generateCrashMultiplier,
    getCurrentCrash,
    startCrash
} = require('./crash-game');
const { OperationError } = require('./operation-errors');

function createPool({ stars = '1000', silver = '0', banned = false } = {}) {
    const state = {
        user: {
            telegram_id: '12345',
            stars,
            silver,
            silver_turnover: '0',
            banned,
            inventory: [],
            balance_pool_started_at: 0,
            balance_pool_start_value: 0,
            balance_pool_escrow_value: 0
        },
        sessions: [],
        operations: [],
        ledger: []
    };
    return {
        state,
        async query() {
            return { rows: [] };
        },
        async connect() {
            return {
                async query(sql, params = []) {
                    const statement = sql.trimStart();
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
                    if (statement.startsWith('SELECT telegram_id, stars, silver')) {
                        return { rows: [state.user] };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(row => row.request_id === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (statement.includes('FROM crash_sessions')) {
                        if (statement.startsWith('SELECT 1')) {
                            return {
                                rows: state.sessions.some(session =>
                                    session.telegram_id === params[0] && session.status === 'active'
                                ) ? [{}] : []
                            };
                        }
                        if (statement.includes('telegram_id = $1 AND status')) {
                            const session = state.sessions.find(row =>
                                row.telegram_id === params[0] && row.status === 'active'
                            );
                            return { rows: session ? [session] : [] };
                        }
                        const session = state.sessions.find(row =>
                            row.session_id === params[0] && row.telegram_id === params[1]
                        );
                        return { rows: session ? [session] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET')) {
                        const field = statement.startsWith('UPDATE app_users SET silver = $1')
                            ? 'silver'
                            : 'stars';
                        state.user[field] = params[0];
                        state.user.balance_pool_started_at = params[1];
                        state.user.balance_pool_start_value = params[2];
                        state.user.balance_pool_escrow_value = params[3];
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({
                            operation: statement.includes("'earn'") ? 'earn' : 'spend',
                            amount: String(params[3]),
                            balanceAfter: String(params[4])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO crash_sessions')) {
                        state.sessions.push({
                            session_id: params[0],
                            telegram_id: params[1],
                            bet_amount: params[2],
                            currency: params[3],
                            start_at: params[4],
                            crash_at: params[5],
                            crash_multiplier: params[6],
                            status: 'active',
                            cashout_multiplier: null,
                            payout: 0
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE crash_sessions')) {
                        const sessionId = statement.includes('cashout_multiplier =')
                            ? params[2]
                            : params[0];
                        const session = state.sessions.find(row => row.session_id === sessionId);
                        if (statement.includes('cashout_multiplier =')) {
                            session.status = 'won';
                            session.cashout_multiplier = params[0];
                            session.payout = params[1];
                        } else {
                            session.status = 'lost';
                        }
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            request_id: params[1],
                            operation: params[2],
                            request: JSON.parse(params[3]),
                            response: JSON.parse(params[4])
                        });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected SQL in test: ${sql}`);
                },
                release() {}
            };
        }
    };
}

test('crash outcomes stay in the configured ranges and growth timing is server-derived', () => {
    assert.equal(generateCrashMultiplier(() => 0), 100);
    assert.ok(generateCrashMultiplier(() => 200) >= 101);
    assert.ok(generateCrashMultiplier(() => 4000) >= 150);
    assert.ok(generateCrashMultiplier(() => 7000) >= 300);
    assert.ok(generateCrashMultiplier(() => 9000) >= 1000);
    assert.ok(generateCrashMultiplier(() => 9800) >= 5000);
    assert.equal(durationUntilMultiplier(100), 0);
    assert.ok(durationUntilMultiplier(250) > 0);
});

test('crash start debits in a transaction and does not expose the crash point', async () => {
    const pool = createPool();
    const result = await startCrash({
        pool, telegramId: '12345', requestId: '11111111-1111-4111-8111-111111111111',
        amount: 100, currency: 'star', now: 1000, random: () => 9800
    });
    assert.equal(pool.state.user.stars, '900');
    assert.equal(pool.state.ledger.length, 1);
    assert.equal(result.game.startsAt, 1000 + BETTING_PHASE_MS);
    assert.equal(result.game.phase, 'waiting');
    assert.equal('crashMultiplier' in result.game, false);
});

test('cashout uses the server clock, records payout, and replays idempotently', async () => {
    const pool = createPool();
    const started = await startCrash({
        pool, telegramId: '12345', requestId: '22222222-2222-4222-8222-222222222222',
        amount: 100, currency: 'star', now: 1000, random: () => 9800
    });
    const session = pool.state.sessions[0];
    const now = Number(session.start_at) + durationUntilMultiplier(150);
    assert.equal(currentMultiplier(session, now), 150);
    const input = {
        pool,
        telegramId: '12345',
        requestId: '33333333-3333-4333-8333-333333333333',
        gameId: started.game.gameId,
        now
    };
    const first = await cashoutCrash(input);
    const retry = await cashoutCrash(input);
    assert.equal(first.game.status, 'won');
    assert.equal(first.game.cashoutMultiplier, 1.5);
    assert.equal(first.game.payout, 150);
    assert.equal(first.stars, '1050');
    assert.equal(pool.state.user.stars, '1050');
    assert.equal(pool.state.ledger.length, 2);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.game.payout, 150);
});

test('crash rejects cashout after the hidden crash and marks the session lost', async () => {
    const pool = createPool();
    const started = await startCrash({
        pool, telegramId: '12345', requestId: '44444444-4444-4444-8444-444444444444',
        amount: 100, currency: 'star', now: 1000, random: () => 0
    });
    const result = await cashoutCrash({
        pool,
        telegramId: '12345',
        requestId: '55555555-5555-4555-8555-555555555555',
        gameId: started.game.gameId,
        now: started.game.startsAt
    });
    assert.equal(result.game.status, 'lost');
    assert.equal(result.game.crashMultiplier, 1);
    assert.equal(pool.state.user.stars, '900');
    assert.equal(pool.state.sessions[0].status, 'lost');
});

test('current crash endpoint marks expired games lost on the server', async () => {
    const pool = createPool({ silver: '1000' });
    const started = await startCrash({
        pool, telegramId: '12345', requestId: '66666666-6666-4666-8666-666666666666',
        amount: 100, currency: 'silver', now: 1000, random: () => 0
    });
    const result = await getCurrentCrash({
        pool, telegramId: '12345', now: started.game.startsAt
    });
    assert.equal(result.game.status, 'lost');
    assert.equal(pool.state.sessions[0].status, 'lost');
});

test('crash rejects invalid bets and insufficient funds', async () => {
    const input = {
        pool: createPool(),
        telegramId: '12345',
        requestId: '77777777-7777-4777-8777-777777777777',
        amount: 10,
        currency: 'star'
    };
    await assert.rejects(startCrash(input), error =>
        error instanceof OperationError && error.code === 'INVALID_CRASH_BET'
    );
    await assert.rejects(startCrash({
        ...input, pool: createPool({ stars: '10' }), amount: 25
    }), error => error instanceof OperationError && error.code === 'INSUFFICIENT_FUNDS');
});

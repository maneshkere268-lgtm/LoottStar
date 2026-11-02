'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    STEPS,
    calculatePayout,
    cashoutFishing,
    chooseStepResult,
    continueFishing,
    getActiveFishing,
    startFishing
} = require('./fishing-game');
const { OperationError } = require('./operation-errors');

const env = { BALANCE_POOL_SEASON_DEADLINE: '9999999999999' };

function createPool({ stars = '1000', silver = '0', banned = false } = {}) {
    const state = {
        user: {
            stars, silver, silver_turnover: '0', banned, inventory: [],
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
        async query(sql, params = []) {
            if (sql.includes('FROM fishing_sessions WHERE telegram_id')) {
                const session = state.sessions.find(row =>
                    row.telegram_id === params[0] && row.status === 'active'
                );
                return { rows: session ? [session] : [] };
            }
            return { rows: [] };
        },
        async connect() {
            return {
                async query(sql, params = []) {
                    const statement = sql.trimStart();
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
                    if (statement.startsWith('SELECT stars, silver, silver_turnover')) {
                        return { rows: [state.user] };
                    }
                    if (statement.startsWith('SELECT 1 FROM fishing_sessions')) {
                        return {
                            rows: state.sessions.some(row =>
                                row.telegram_id === params[0] && row.status === 'active'
                            ) ? [{}] : []
                        };
                    }
                    if (statement.startsWith('SELECT session_id, telegram_id, bet_amount')) {
                        const session = state.sessions.find(row =>
                            row.session_id === params[0] && row.telegram_id === params[1]
                        );
                        return { rows: session ? [session] : [] };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(row => row.request_id === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, silver_turnover = $2') ||
                        statement.startsWith('UPDATE app_users SET silver = $1, silver_turnover = $2')) {
                        const field = statement.startsWith('UPDATE app_users SET silver =') ? 'silver' : 'stars';
                        state.user[field] = params[0];
                        state.user.silver_turnover = params[1];
                        state.user.balance_pool_started_at = params[2];
                        state.user.balance_pool_start_value = params[3];
                        state.user.balance_pool_escrow_value = params[4];
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1,') ||
                        statement.startsWith('UPDATE app_users SET silver = $1,')) {
                        const field = statement.startsWith('UPDATE app_users SET silver =') ? 'silver' : 'stars';
                        state.user[field] = params[0];
                        state.user.balance_pool_started_at = params[1];
                        state.user.balance_pool_start_value = params[2];
                        state.user.balance_pool_escrow_value = params[3];
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({
                            operation: statement.includes("'earn'") ? 'earn' : 'spend',
                            currency: params[2],
                            amount: String(params[3]),
                            balance_after: String(params[4])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO fishing_sessions')) {
                        state.sessions.push({
                            session_id: params[0],
                            telegram_id: params[1],
                            bet_amount: params[2],
                            currency: params[3],
                            step: 0,
                            status: 'active',
                            payout: 0
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE fishing_sessions SET step')) {
                        const session = state.sessions.find(row => row.session_id === params[2]);
                        session.step = params[0];
                        session.status = params[1];
                        return { rows: [] };
                    }
                    if (statement.startsWith("UPDATE fishing_sessions SET status = 'won'")) {
                        const session = state.sessions.find(row => row.session_id === params[1]);
                        session.status = 'won';
                        session.payout = params[0];
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

test('fishing bust chance and payout follow the displayed multiplier ladder', () => {
    assert.ok(chooseStepResult(1, () => 0) === 'lost');
    assert.equal(chooseStepResult(1, () => 0.1), 'active');
    assert.ok(Math.abs(calculatePayout(100, 2) - 112) < 1);
    assert.equal(calculatePayout(50_000_000, STEPS.length), 250_000_000);
});

test('fishing start debits once and current state hides future outcomes', async () => {
    const pool = createPool();
    const input = {
        pool, env, telegramId: '12345',
        requestId: '11111111-1111-4111-8111-111111111111',
        amount: 100, currency: 'star', now: 1_800_000_000_000
    };
    const first = await startFishing(input);
    const replay = await startFishing(input);
    const current = await getActiveFishing({ pool, telegramId: '12345' });

    assert.equal(first.game.step, 0);
    assert.equal(first.game.status, 'active');
    assert.equal(pool.state.user.stars, '900');
    assert.equal(pool.state.ledger.length, 1);
    assert.equal(replay.duplicate, true);
    assert.equal(current.game.gameId, first.game.gameId);
    assert.equal('bustChance' in current.game, false);
});

test('fishing continue is server-selected and replay-safe; cashout credits the stored step', async () => {
    const pool = createPool();
    const started = await startFishing({
        pool, env, telegramId: '12345',
        requestId: '22222222-2222-4222-8222-222222222222',
        amount: 100, currency: 'star', now: 1_800_000_000_000
    });
    const next = {
        pool, telegramId: '12345', gameId: started.game.gameId,
        requestId: '33333333-3333-4333-8333-333333333333',
        random: () => 0.5
    };
    const firstStep = await continueFishing(next);
    const replay = await continueFishing(next);
    const secondStep = await continueFishing({
        ...next, requestId: '44444444-4444-4444-8444-444444444444'
    });
    assert.equal(firstStep.game.step, 1);
    assert.equal(firstStep.game.status, 'active');
    assert.equal(replay.duplicate, true);
    assert.equal(secondStep.game.step, 2);

    const cashout = {
        pool, env, telegramId: '12345', gameId: started.game.gameId,
        requestId: '55555555-5555-4555-8555-555555555555',
        now: 1_800_000_000_000
    };
    const paid = await cashoutFishing(cashout);
    const paidAgain = await cashoutFishing(cashout);
    assert.equal(paid.payout, 112);
    assert.equal(paid.game.status, 'won');
    assert.equal(pool.state.user.stars, '1012');
    assert.equal(paidAgain.duplicate, true);
    assert.equal(pool.state.ledger.length, 2);
});

test('fishing rejects cashout before a catch and insufficient starting balance', async () => {
    const pool = createPool({ stars: '10' });
    const started = await startFishing({
        pool, env, telegramId: '12345',
        requestId: '66666666-6666-4666-8666-666666666666',
        amount: 10, currency: 'star', now: 1_800_000_000_000
    });
    await assert.rejects(
        cashoutFishing({
            pool, env, telegramId: '12345',
            requestId: '77777777-7777-4777-8777-777777777777',
            gameId: started.game.gameId, now: 1_800_000_000_000
        }),
        { code: 'FISHING_NO_CATCH_TO_COLLECT' }
    );
    await assert.rejects(
        startFishing({
            pool, env, telegramId: '12345',
            requestId: '88888888-8888-4888-8888-888888888888',
            amount: 1, currency: 'star', now: 1_800_000_000_000
        }),
        error => error instanceof OperationError && error.code === 'FISHING_ROUND_ACTIVE'
    );
    assert.equal(pool.state.user.stars, '0');
});

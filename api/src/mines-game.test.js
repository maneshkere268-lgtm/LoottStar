'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeMinePositions, performMinesAction, payoutFor, startMines } = require('./mines-game');
const { OperationError } = require('./operation-errors');

function createPool() {
    const state = {
        user: {
            telegram_id: '12345',
            stars: '1000',
            silver: '0',
            banned: false,
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
                    if (statement.includes('SELECT 1 FROM mines_sessions')) {
                        return {
                            rows: state.sessions.some(session =>
                                session.telegram_id === params[0] && session.status === 'active'
                            ) ? [{}] : []
                        };
                    }
                    if (statement.includes('FROM mines_sessions')) {
                        const session = state.sessions.find(row =>
                            row.session_id === params[0] && row.telegram_id === params[1]
                        );
                        return { rows: session ? [session] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET')) {
                        const field = statement.includes('silver = $1') ? 'silver' : 'stars';
                        state.user[field] = params[0];
                        state.user.balance_pool_started_at = params[1];
                        state.user.balance_pool_start_value = params[2];
                        state.user.balance_pool_escrow_value = params[3];
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({
                            operation: params[2],
                            currency: params[3],
                            amount: String(params[4]),
                            balanceAfter: String(params[5])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO mines_sessions')) {
                        state.sessions.push({
                            session_id: params[0],
                            telegram_id: params[1],
                            mines_count: params[2],
                            bet_amount: params[3],
                            currency: params[4],
                            mine_positions: JSON.parse(params[5]),
                            revealed_cells: [],
                            status: 'active',
                            payout: 0
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE mines_sessions')) {
                        const session = state.sessions.find(row => row.session_id === params[3] || row.session_id === params[1]);
                        if (statement.includes('revealed_cells =')) {
                            session.revealed_cells = JSON.parse(params[0]);
                            session.status = params[1];
                            session.payout = Number(params[2]);
                        } else {
                            session.status = 'won';
                            session.payout = Number(params[0]);
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

test('server mines are unique, bounded grid cells; payout matches the displayed multiplier', () => {
    const positions = makeMinePositions(15);
    assert.equal(positions.length, 15);
    assert.equal(new Set(positions).size, 15);
    assert.ok(positions.every(position => position >= 0 && position < 25));
    assert.equal(payoutFor(100, 4), 120);
});

test('Mines start spends atomically and never returns hidden mine locations', async () => {
    const pool = createPool();
    const result = await startMines({
        pool, telegramId: '12345', requestId: '11111111-1111-4111-8111-111111111111',
        amount: 50, currency: 'star', minesCount: 2
    });
    assert.equal(pool.state.user.stars, '950');
    assert.equal(pool.state.ledger.length, 1);
    assert.equal(result.game.status, 'active');
    assert.equal(Object.hasOwn(result.game, 'minePositions'), false);
});

test('Mines reveal and cashout are server-owned, atomic, and idempotent', async () => {
    const pool = createPool();
    const started = await startMines({
        pool, telegramId: '12345', requestId: '22222222-2222-4222-8222-222222222222',
        amount: 50, currency: 'star', minesCount: 2
    });
    const session = pool.state.sessions[0];
    const safeCell = Array.from({ length: 25 }, (_, index) => index)
        .find(index => !session.mine_positions.includes(index));
    const revealed = await performMinesAction({
        pool, telegramId: '12345', requestId: '33333333-3333-4333-8333-333333333333',
        gameId: started.game.gameId, action: 'reveal', cell: safeCell
    });
    assert.equal(revealed.game.status, 'active');
    assert.equal(Object.hasOwn(revealed.game, 'minePositions'), false);

    const requestId = '44444444-4444-4444-8444-444444444444';
    const cashedOut = await performMinesAction({
        pool, telegramId: '12345', requestId, gameId: started.game.gameId, action: 'cashout'
    });
    const replay = await performMinesAction({
        pool, telegramId: '12345', requestId, gameId: started.game.gameId, action: 'cashout'
    });
    assert.equal(cashedOut.game.status, 'won');
    assert.equal(cashedOut.game.payout, 52);
    assert.equal(pool.state.user.stars, '1002');
    assert.equal(pool.state.ledger.length, 2);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.game.payout, 52);
});

test('Mines loss reveals the server-selected layout without crediting a payout', async () => {
    const pool = createPool();
    const started = await startMines({
        pool, telegramId: '12345', requestId: '66666666-6666-4666-8666-666666666666',
        amount: 50, currency: 'star', minesCount: 2
    });
    const mine = pool.state.sessions[0].mine_positions[0];
    const result = await performMinesAction({
        pool, telegramId: '12345', requestId: '77777777-7777-4777-8777-777777777777',
        gameId: started.game.gameId, action: 'reveal', cell: mine
    });
    assert.equal(result.game.status, 'lost');
    assert.equal(result.game.hitMine, true);
    assert.equal(result.game.minePositions.length, 2);
    assert.equal(pool.state.user.stars, '950');
    assert.equal(pool.state.ledger.length, 1);
});

test('Mines rejects invalid stake values before touching the database', async () => {
    await assert.rejects(
        startMines({
            pool: createPool(), telegramId: '12345',
            requestId: '55555555-5555-4555-8555-555555555555',
            amount: 50, currency: 'star', minesCount: 3
        }),
        error => error instanceof OperationError && error.code === 'INVALID_MINES_BET'
    );
});

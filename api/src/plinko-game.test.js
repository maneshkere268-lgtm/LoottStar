'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseOutcome, dropPlinko } = require('./plinko-game');
const { OperationError } = require('./operation-errors');

function createPool({ stars = '1000', silver = '0' } = {}) {
    const state = {
        user: {
            telegram_id: '12345',
            stars,
            silver,
            silver_turnover: '0',
            banned: false,
            inventory: [],
            balance_pool_started_at: 0,
            balance_pool_start_value: 0,
            balance_pool_escrow_value: 0
        },
        operations: [],
        ledger: []
    };
    return {
        state,
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
                    if (statement.startsWith('UPDATE app_users SET')) {
                        const field = statement.startsWith('UPDATE app_users SET silver = $1')
                            ? 'silver'
                            : 'stars';
                        state.user[field] = params[0];
                        state.user.silver_turnover = String(
                            BigInt(state.user.silver_turnover) + BigInt(params[1])
                        );
                        state.user.balance_pool_started_at = params[2];
                        state.user.balance_pool_start_value = params[3];
                        state.user.balance_pool_escrow_value = params[4];
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
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            request_id: params[1],
                            operation: 'plinko_drop',
                            request: JSON.parse(params[2]),
                            response: JSON.parse(params[3])
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

test('Plinko server selects the configured bins and applies the payout cap', () => {
    assert.deepEqual(chooseOutcome('easy', 100, () => 0), {
        binIndex: 0, multiplier: 5.2, payout: 520
    });
    assert.deepEqual(chooseOutcome('medium', 100, () => 0.999999), {
        binIndex: 12, multiplier: 18, payout: 1800
    });
    assert.deepEqual(chooseOutcome('hard', 50_000_000, () => 0), {
        binIndex: 0, multiplier: 81, payout: 250_000_000
    });
});

test('Plinko drop commits the server outcome and is idempotent', async () => {
    const pool = createPool();
    const input = {
        pool,
        telegramId: '12345',
        requestId: '11111111-1111-4111-8111-111111111111',
        amount: 100,
        currency: 'star',
        difficulty: 'easy',
        random: () => 0
    };
    const first = await dropPlinko(input);
    const replay = await dropPlinko({ ...input, random: () => 0.99 });
    assert.equal(first.binIndex, 0);
    assert.equal(first.payout, 520);
    assert.equal(first.stars, '1420');
    assert.equal(pool.state.user.stars, '1420');
    assert.equal(pool.state.ledger.length, 2);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.binIndex, 0);
    assert.equal(pool.state.operations.length, 1);
});

test('Plinko silver turnover is updated by the API operation', async () => {
    const pool = createPool({ silver: '1000' });
    const result = await dropPlinko({
        pool,
        telegramId: '12345',
        requestId: '22222222-2222-4222-8222-222222222222',
        amount: 100,
        currency: 'silver',
        difficulty: 'easy',
        random: () => 0.5
    });
    assert.equal(result.payout, 40);
    assert.equal(pool.state.user.silver, '940');
    assert.equal(pool.state.user.silver_turnover, '100');
    assert.equal(pool.state.ledger.length, 2);
});

test('Plinko rejects invalid bet and difficulty values', async () => {
    const input = {
        pool: createPool(),
        telegramId: '12345',
        requestId: '33333333-3333-4333-8333-333333333333',
        amount: 100,
        currency: 'star',
        difficulty: 'impossible'
    };
    await assert.rejects(dropPlinko(input), error =>
        error instanceof OperationError && error.code === 'INVALID_PLINKO_DIFFICULTY'
    );
    await assert.rejects(dropPlinko({ ...input, amount: 1 }), error =>
        error instanceof OperationError && error.code === 'INVALID_PLINKO_BET'
    );
});

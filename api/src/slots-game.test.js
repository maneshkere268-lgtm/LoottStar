'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseOutcome, spinSlots } = require('./slots-game');
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
                        const field = statement.includes('silver = $1') ? 'silver' : 'stars';
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
                            currency: statement.includes("'silver'") ? 'silver' : params[2],
                            amount: String(statement.includes("'earn'") ? params[3] : params[3]),
                            balanceAfter: String(params[4])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            request_id: params[1],
                            operation: 'slots_spin',
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

test('slot outcome uses the correct low and high bet tables and caps payouts', () => {
    assert.deepEqual(chooseOutcome(10, () => 0), { multiplier: 6.1, payout: 61 });
    assert.deepEqual(chooseOutcome(999, () => 0), { multiplier: 12.5, payout: 12487 });
    assert.deepEqual(chooseOutcome(50_000_000, () => 0), {
        multiplier: 12.5, payout: 250_000_000
    });
});

test('slot spin debits, credits and records the result atomically; duplicate request does not spin again', async () => {
    const pool = createPool();
    const input = {
        pool,
        telegramId: '12345',
        requestId: '11111111-1111-4111-8111-111111111111',
        amount: 100,
        currency: 'star',
        random: () => 0
    };
    const first = await spinSlots(input);
    const duplicate = await spinSlots({ ...input, random: () => 0.99 });

    assert.equal(first.payout, 610);
    assert.equal(first.stars, '1510');
    assert.equal(pool.state.user.stars, '1510');
    assert.equal(pool.state.ledger.length, 2);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.payout, 610);
    assert.equal(pool.state.operations.length, 1);
});

test('silver slot spins add turnover only on the server', async () => {
    const pool = createPool({ silver: '1000' });
    const result = await spinSlots({
        pool,
        telegramId: '12345',
        requestId: '22222222-2222-4222-8222-222222222222',
        amount: 100,
        currency: 'silver',
        random: () => 0.99
    });
    assert.equal(result.payout, 0);
    assert.equal(pool.state.user.silver, '900');
    assert.equal(pool.state.user.silver_turnover, '100');
    assert.equal(pool.state.ledger.length, 1);
});

test('slot spins reject invalid bets, banned users, and insufficient funds', async () => {
    const input = {
        pool: createPool(),
        telegramId: '12345',
        requestId: '33333333-3333-4333-8333-333333333333',
        amount: 5,
        currency: 'star'
    };
    await assert.rejects(spinSlots(input), error =>
        error instanceof OperationError && error.code === 'INVALID_SLOTS_BET'
    );
    await assert.rejects(spinSlots({
        ...input, pool: createPool({ banned: true }), amount: 10
    }), error => error instanceof OperationError && error.code === 'ACCOUNT_BANNED');
    await assert.rejects(spinSlots({
        ...input, pool: createPool({ stars: '9' }), amount: 10
    }), error => error instanceof OperationError && error.code === 'INSUFFICIENT_FUNDS');
});

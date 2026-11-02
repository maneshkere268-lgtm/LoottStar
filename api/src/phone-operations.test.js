'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { operatePhone } = require('./phone-operations');
const { evaluate, START } = require('./phone-roulette');

function createPool({ stars = 100_000, phone = { ...START, rolls: 0, best: 0 }, inventory = [] } = {}) {
    const state = {
        stars: String(stars),
        silver: '0',
        inventory,
        phone,
        banned: false,
        operations: [],
        ledger: [],
        balance_pool_started_at: 0,
        balance_pool_start_value: 0,
        balance_pool_escrow_value: 0
    };
    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
                    if (sql.includes('FROM app_users') && sql.includes('FOR UPDATE')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            inventory: state.inventory,
                            profile_phone: state.phone,
                            legacy_data: {},
                            banned: state.banned,
                            balance_pool_started_at: state.balance_pool_started_at,
                            balance_pool_start_value: state.balance_pool_start_value,
                            balance_pool_escrow_value: state.balance_pool_escrow_value
                        }] };
                    }
                    if (sql.includes('FROM game_operations')) {
                        const operation = state.operations.find(row => row.requestId === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (sql.startsWith('UPDATE app_users SET stars')) {
                        state.stars = params[0];
                        state.inventory = JSON.parse(params[1]);
                        state.phone = JSON.parse(params[2]);
                        state.balance_pool_started_at = params[3];
                        state.balance_pool_start_value = params[4];
                        state.balance_pool_escrow_value = params[5];
                        return { rows: [] };
                    }
                    if (sql.includes('INSERT INTO balance_ledger')) {
                        state.ledger.push({
                            operation: sql.includes("'spend'") ? 'spend' : 'earn',
                            amount: String(params[2]),
                            source: params[4]
                        });
                        return { rows: [] };
                    }
                    if (sql.includes('INSERT INTO game_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            operation: params[2],
                            request: JSON.parse(params[3]),
                            response: JSON.parse(params[4])
                        });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected SQL in phone test: ${sql}`);
                },
                release() {}
            };
        }
    };
}

const requestId = suffix => `21c37f9e-6da8-4e8d-a44c-44d1f6b816${suffix}`;
const run = (pool, action, id, fields = {}) => operatePhone({
    pool, telegramId: '12345', requestId: requestId(id), action, ...fields
});

test('phone roll is server-generated, charged atomically, and idempotent', async () => {
    const pool = createPool();
    const first = await run(pool, 'roll', '10');
    const replay = await run(pool, 'roll', '10');

    assert.equal(first.stars, '95000');
    assert.equal(first.phone.rolls, 1);
    assert.deepEqual(first.result, first.phone.pending);
    assert.equal(first.duplicate, false);
    assert.equal(replay.duplicate, true);
    assert.equal(pool.state.operations.length, 1);
    assert.equal(pool.state.ledger.length, 1);
    assert.equal(pool.state.ledger[0].operation, 'spend');
    assert.equal(pool.state.ledger[0].amount, '5000');
});

test('phone result can only be settled once; server calculates payout', async () => {
    const pool = createPool({ phone: { cc: '7', tail: '1111111111', rolls: 2, best: 100000 } });
    const rolled = await run(pool, 'roll', '11');
    const resolved = await run(pool, 'resolve', '12', { keepNew: false });
    const replay = await run(pool, 'resolve', '12', { keepNew: false });

    assert.equal(resolved.payout, evaluate(rolled.result.cc, rolled.result.tail).value);
    assert.equal(resolved.phone.cc, '7');
    assert.equal(resolved.phone.tail, '1111111111');
    assert.equal(resolved.phone.pending, undefined);
    assert.equal(replay.duplicate, true);
    assert.equal(pool.state.ledger.length, 2);
});

test('selling and installing phone items update PostgreSQL-owned state', async () => {
    const pool = createPool({
        phone: { cc: '7', tail: '1111111111', rolls: 4, best: 200000 },
        inventory: [{
            id: 'phone-owned',
            type: 'phone',
            phone: { cc: '1', tail: '1234567890' }
        }]
    });
    const installed = await run(pool, 'install', '13', { itemId: 'phone-owned' });
    assert.equal(installed.phone.cc, '1');
    assert.equal(installed.inventory.length, 1);
    assert.equal(installed.inventory[0].type, 'phone');
    assert.equal(installed.inventory[0].phone.cc, '7');
    assert.equal(installed.phone.rolls, 4);

    const sold = await run(pool, 'sell', '14');
    assert.deepEqual(
        { cc: sold.phone.cc, tail: sold.phone.tail },
        START
    );
    assert.equal(sold.payout, evaluate('1', '1234567890').value);
});

test('phone actions reject invalid inputs, insufficient funds, and absent pending results', async () => {
    await assert.rejects(() => run(createPool(), 'resolve', '15', { keepNew: true }), {
        code: 'PHONE_ROLL_NOT_PENDING'
    });
    await assert.rejects(() => run(createPool({ stars: 4999 }), 'roll', '16'), {
        code: 'INSUFFICIENT_FUNDS'
    });
    await assert.rejects(() => run(createPool(), 'install', '17', { itemId: 'not-owned' }), {
        code: 'ITEMS_NOT_FOUND'
    });
    await assert.rejects(() => run(createPool(), 'resolve', '18', { keepNew: 'yes' }), {
        code: 'INVALID_PHONE_REQUEST'
    });
});

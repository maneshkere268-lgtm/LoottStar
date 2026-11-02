'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { craftItems, chooseMultiplier, findGift, validateInput } = require('./item-crafting');
const { OperationError } = require('./operation-errors');

function createPool({ inventory, stars = 0, silver = 0 }) {
    const state = {
        stars: String(stars),
        silver: String(silver),
        inventory: structuredClone(inventory),
        operations: [],
        ledger: []
    };
    const pool = {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
                    if (sql.includes('FROM app_users')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            banned: false,
                            inventory: state.inventory,
                            balance_pool_started_at: 1_000,
                            balance_pool_start_value: 0,
                            balance_pool_escrow_value: 0
                        }] };
                    }
                    if (sql.includes('FROM game_operations')) {
                        const operation = state.operations.find(entry => entry.requestId === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (sql.startsWith('UPDATE app_users SET stars = $1, silver = $2, inventory')) {
                        state.stars = params[0];
                        state.silver = params[1];
                        state.inventory = JSON.parse(params[2]);
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ currency: params[2], amount: params[3] });
                        return { rows: [] };
                    }
                    if (sql.includes('INSERT INTO game_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            operation: 'item_craft',
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
    return pool;
}

const initialInventory = [
    { id: 'one', name: 'One', price: 100, stars: 100, currency: 'star' },
    { id: 'two', name: 'Two', price: 200, stars: 200, currency: 'star' },
    { id: 'three', name: 'Three', price: 300, stars: 300, currency: 'star' }
];

test('craft multiplier follows the configured weighted table', () => {
    assert.equal(chooseMultiplier(() => 0), 0.5);
    assert.equal(chooseMultiplier(() => 39), 0.5);
    assert.equal(chooseMultiplier(() => 40), 0.7);
    assert.equal(chooseMultiplier(() => 65), 1);
    assert.equal(chooseMultiplier(() => 99), 2.5);
    assert.throws(() => chooseMultiplier(() => 100), /INVALID_RANDOM_VALUE/);
});

test('craft uses a server catalog gift when the payout supports one', async () => {
    const pool = createPool({ inventory: initialInventory, stars: 10 });
    const result = await craftItems({
        pool,
        telegramId: '12345',
        requestId: 'b0110000-0000-4000-8000-000000000001',
        itemIds: ['one', 'two', 'three'],
        currency: 'star',
        now: 2_000,
        random: () => 99
    });

    assert.equal(result.total, 600);
    assert.equal(result.multiplier, 2.5);
    assert.equal(result.payout, 1_500);
    assert.ok(result.gift);
    assert.equal(result.stars, String(10 + result.remainder));
    assert.deepEqual(result.inventory, [result.gift]);
    assert.equal(pool.state.operations.length, 1);
    assert.equal(pool.state.ledger.length, 1);
});

test('craft operation replay returns the original server result without consuming twice', async () => {
    const pool = createPool({ inventory: initialInventory });
    const input = {
        pool,
        telegramId: '12345',
        requestId: 'b0110000-0000-4000-8000-000000000002',
        itemIds: ['one', 'two', 'three'],
        currency: 'star',
        random: () => 99
    };
    const first = await craftItems(input);
    const replay = await craftItems({ ...input, random: () => 0 });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.multiplier, first.multiplier);
    assert.deepEqual(pool.state.inventory, first.inventory);
    assert.equal(pool.state.operations.length, 1);
});

test('craft rejects duplicates, wrong-currency items, and protected inventory', async () => {
    assert.throws(() => validateInput(['x', 'x', 'y'], 'star'), OperationError);
    const wrongCurrency = createPool({ inventory: [
        ...initialInventory.slice(0, 2),
        { id: 'three', stars: 300, currency: 'silver' }
    ] });
    await assert.rejects(() => craftItems({
        pool: wrongCurrency,
        telegramId: '12345',
        requestId: 'b0110000-0000-4000-8000-000000000003',
        itemIds: ['one', 'two', 'three'],
        currency: 'star',
        random: () => 0
    }), error => error.code === 'ITEMS_NOT_CRAFTABLE');
    assert.equal(findGift(0, 'silver'), null);
});

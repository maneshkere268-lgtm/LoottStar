'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sellItems } = require('./item-selling');

function createPool(overrides = {}) {
    const state = {
        stars: '10',
        silver: '5',
        banned: false,
        inventory: [
            { id: 'star-item', name: 'Heart', stars: 25, currency: 'star' },
            { id: 'silver-item', name: 'Silver', stars: 40, currency: 'silver' }
        ],
        balance_pool_started_at: Date.now() - 10_000,
        balance_pool_start_value: 0,
        balance_pool_escrow_value: 0,
        ledger: [],
        operations: [],
        ...overrides
    };
    let snapshot;
    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    const statement = sql.trimStart();
                    if (statement === 'BEGIN') {
                        snapshot = structuredClone(state);
                        return { rows: [] };
                    }
                    if (statement === 'COMMIT') return { rows: [] };
                    if (statement === 'ROLLBACK') {
                        Object.assign(state, snapshot);
                        return { rows: [] };
                    }
                    if (statement.startsWith('SELECT stars, silver, banned')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            banned: state.banned,
                            inventory: state.inventory,
                            balance_pool_started_at: state.balance_pool_started_at,
                            balance_pool_start_value: state.balance_pool_start_value,
                            balance_pool_escrow_value: state.balance_pool_escrow_value
                        }] };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(item => item.requestId === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1')) {
                        state.stars = params[0];
                        state.silver = params[1];
                        state.inventory = JSON.parse(params[2]);
                        state.balance_pool_started_at = Number(params[3]);
                        state.balance_pool_start_value = Number(params[4]);
                        state.balance_pool_escrow_value = Number(params[5]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ currency: statement.includes("'silver'") ? 'silver' : 'star' });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            operation: 'item_sell',
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

test('selling items credits only stored item values and is idempotent', async () => {
    const pool = createPool();
    const input = {
        pool,
        telegramId: '12345',
        requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        itemIds: ['silver-item', 'star-item']
    };
    const first = await sellItems(input);
    assert.equal(first.stars, '35');
    assert.equal(first.silver, '45');
    assert.equal(first.starsEarned, '25');
    assert.equal(first.silverEarned, '40');
    assert.equal(pool.state.inventory.length, 0);
    assert.equal(pool.state.ledger.length, 2);

    const retry = await sellItems(input);
    assert.equal(retry.duplicate, true);
    assert.equal(pool.state.stars, '35');
    assert.equal(pool.state.silver, '45');
    assert.equal(pool.state.ledger.length, 2);
});

test('selling an unavailable or restricted item leaves state unchanged', async () => {
    const pool = createPool({
        inventory: [
            { id: 'locked', name: 'Locked', stars: 100, currency: 'star', noSell: true }
        ]
    });
    await assert.rejects(sellItems({
        pool,
        telegramId: '12345',
        requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        itemIds: ['locked']
    }), { code: 'ITEMS_NOT_SELLABLE' });
    assert.equal(pool.state.inventory.length, 1);
    assert.equal(pool.state.ledger.length, 0);

    await assert.rejects(sellItems({
        pool,
        telegramId: '12345',
        requestId: '21c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        itemIds: ['missing']
    }), { code: 'ITEMS_NOT_FOUND' });
    assert.equal(pool.state.inventory.length, 1);
});

test('selling saved or actively staked items is rejected by the server', async () => {
    for (const item of [
        { id: 'saved', stars: 10, saved: true },
        { id: 'staked', stars: 10, staking: { status: 'active' } }
    ]) {
        const pool = createPool({ inventory: [item] });
        await assert.rejects(sellItems({
            pool,
            telegramId: '12345',
            requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
            itemIds: [item.id]
        }), { code: 'ITEMS_NOT_SELLABLE' });
        assert.deepEqual(pool.state.inventory, [item]);
        assert.equal(pool.state.ledger.length, 0);
    }
});

test('rejects duplicate item identifiers before a database transaction', async () => {
    const pool = createPool();
    await assert.rejects(sellItems({
        pool,
        telegramId: '12345',
        requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        itemIds: ['star-item', 'star-item']
    }), { code: 'INVALID_SELL_REQUEST' });
});

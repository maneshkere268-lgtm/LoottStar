'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buyIndexItem } = require('./shop');
const { OperationError } = require('./operation-errors');

const env = { BALANCE_POOL_SEASON_DEADLINE: '9999999999999' };

function createPool({ stars = '1000', inventory = [] } = {}) {
    const state = {
        stars, silver: '0', inventory,
        balance_pool_started_at: 0,
        balance_pool_start_value: 0,
        balance_pool_escrow_value: 0,
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
                    if (statement.startsWith('SELECT stars, silver, banned')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            banned: false,
                            inventory: state.inventory,
                            balance_pool_started_at: state.balance_pool_started_at,
                            balance_pool_start_value: state.balance_pool_start_value,
                            balance_pool_escrow_value: state.balance_pool_escrow_value
                        }] };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(row => row.request_id === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, inventory = $2::jsonb')) {
                        state.stars = params[0];
                        state.inventory = JSON.parse(params[1]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({
                            requestId: params[1],
                            amount: String(params[3]),
                            balance_after: String(params[4])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            request_id: params[1],
                            operation: 'shop_buy',
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

test('index shop purchase spends 125% of catalog price and is idempotent', async () => {
    const pool = createPool({ stars: '1000' });
    const input = {
        pool, env, telegramId: '12345', requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        itemName: 'Jester Hat'
    };
    const first = await buyIndexItem(input);
    assert.equal(first.duplicate, false);
    assert.equal(first.stars, '375');
    assert.equal(first.item.name, 'Jester Hat');
    assert.equal(first.item.stars, 500);
    assert.equal(first.inventory.length, 1);
    assert.equal(pool.state.ledger.length, 1);

    const retry = await buyIndexItem(input);
    assert.equal(retry.duplicate, true);
    assert.equal(pool.state.inventory.length, 1);
    assert.equal(pool.state.stars, '375');
});

test('index shop purchase rejects unknown items and insufficient funds', async () => {
    await assert.rejects(
        () => buyIndexItem({
            pool: createPool(), env, telegramId: '12345',
            requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165b',
            itemName: 'Not A Real Gift'
        }),
        error => error instanceof OperationError && error.code === 'SHOP_ITEM_NOT_FOUND'
    );
    await assert.rejects(
        () => buyIndexItem({
            pool: createPool({ stars: '10' }), env, telegramId: '12345',
            requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165c',
            itemName: 'Jester Hat'
        }),
        error => error instanceof OperationError && error.code === 'INSUFFICIENT_FUNDS'
    );
});

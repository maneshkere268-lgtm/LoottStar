'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setItemSaved } = require('./item-saving');

function createPool(inventory = [{ id: 'item-1', saved: false }]) {
    const state = { inventory, operations: [] };
    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
                    if (sql.includes('FROM app_users')) {
                        return { rows: [{
                            stars: '42', silver: '7', inventory: state.inventory, banned: false
                        }] };
                    }
                    if (sql.includes('FROM game_operations')) {
                        const entry = state.operations.find(item => item.requestId === params[1]);
                        return { rows: entry ? [entry] : [] };
                    }
                    if (sql.startsWith('UPDATE app_users SET inventory')) {
                        state.inventory = JSON.parse(params[0]);
                        return { rows: [] };
                    }
                    if (sql.includes('INSERT INTO game_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            operation: 'item_save',
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

test('saving an owned item is idempotent and returns the server inventory', async () => {
    const pool = createPool();
    const input = {
        pool,
        telegramId: '12345',
        requestId: '21c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        itemId: 'item-1',
        saved: true
    };
    const first = await setItemSaved(input);
    const replay = await setItemSaved(input);
    assert.equal(first.saved, true);
    assert.equal(replay.duplicate, true);
    assert.equal(pool.state.inventory[0].saved, true);
    assert.equal(pool.state.operations.length, 1);
});

test('saving rejects unowned items and malformed values', async () => {
    const pool = createPool();
    await assert.rejects(() => setItemSaved({
        pool, telegramId: '12345',
        requestId: '21c37f9e-6da8-4e8d-a44c-44d1f6b8165b',
        itemId: 'missing', saved: true
    }), { code: 'ITEMS_NOT_FOUND' });
    await assert.rejects(() => setItemSaved({
        pool, telegramId: '12345',
        requestId: '21c37f9e-6da8-4e8d-a44c-44d1f6b8165c',
        itemId: 'item-1', saved: 'true'
    }), { code: 'INVALID_ITEM_SAVE_REQUEST' });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { settleRopeko } = require('./ropeko');

const now = Date.parse('2026-10-15T12:00:00.000Z');
const env = { BALANCE_POOL_SEASON_DEADLINE: '9999999999999' };

function createPool({ username = 'hazed_q', inventory = [] } = {}) {
    const state = {
        username,
        stars: '1000',
        silver: '200',
        inventory,
        operations: [],
        ledger: [],
        balance_pool_started_at: now,
        balance_pool_start_value: 0,
        balance_pool_escrow_value: 0
    };
    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
                    if (sql.includes('FROM app_users')) {
                        return { rows: [{
                            username: state.username,
                            stars: state.stars,
                            silver: state.silver,
                            inventory: state.inventory,
                            banned: false,
                            balance_pool_started_at: state.balance_pool_started_at,
                            balance_pool_start_value: state.balance_pool_start_value,
                            balance_pool_escrow_value: state.balance_pool_escrow_value
                        }] };
                    }
                    if (sql.includes('FROM ropeko_operations')) {
                        const operation = state.operations.find(row => row.requestId === params[1]);
                        return { rows: operation ? [{ response: operation.response }] : [] };
                    }
                    if (sql.startsWith('UPDATE app_users SET stars = $1')) {
                        state.stars = params[0];
                        state.inventory = JSON.parse(params[1]);
                        state.balance_pool_started_at = params[2];
                        state.balance_pool_start_value = params[3];
                        state.balance_pool_escrow_value = params[4];
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ requestId: params[1], amount: params[2] });
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO ropeko_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            response: JSON.parse(params[2])
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

test('Ropeko item issuance and earnings are calculated and persisted by the server', async () => {
    const pool = createPool();
    const first = await settleRopeko({
        pool, env, telegramId: '12345',
        requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        now
    });
    assert.equal(first.earned, 0);
    assert.equal(first.inventory.length, 1);
    assert.equal(first.inventory[0].name, 'Durov Figure (Ropeko)');

    const next = await settleRopeko({
        pool, env, telegramId: '12345',
        requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165b',
        now: now + 24 * 60 * 60 * 1000
    });
    assert.equal(next.earned, 5_000_000);
    assert.equal(next.stars, '5001000');
    assert.equal(pool.state.ledger.length, 1);

    const replay = await settleRopeko({
        pool, env, telegramId: '12345',
        requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165b',
        now: now + 48 * 60 * 60 * 1000
    });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.stars, next.stars);
    assert.equal(pool.state.ledger.length, 1);
});

test('Ropeko settlement rejects accounts outside the server-side allowlist', async () => {
    await assert.rejects(() => settleRopeko({
        pool: createPool({ username: 'ordinary_user' }),
        env,
        telegramId: '12345',
        requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165c',
        now
    }), { code: 'ROPEKO_NOT_ELIGIBLE' });
});

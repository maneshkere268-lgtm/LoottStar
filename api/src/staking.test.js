'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DURATION_MS, operateStaking } = require('./staking');

const telegramId = '12345';
const itemId = 'durov-gift-1';
const activeRequest = '21c37f9e-6da8-4e8d-a44c-44d1f6b8165a';

function createPool({ stars = '1000', inventory } = {}) {
    const state = {
        stars,
        silver: '0',
        inventory: inventory || [{
            id: itemId,
            name: 'Durov Figure',
            price: 1000,
            image: '/shared/gift.png'
        }],
        operations: [],
        ledger: [],
        balance_pool_started_at: 1,
        balance_pool_start_value: 0,
        balance_pool_escrow_value: 0
    };
    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    const statement = sql.trimStart();
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
                    if (statement.startsWith('SELECT stars, silver, inventory, banned')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            inventory: state.inventory,
                            banned: false,
                            balance_pool_started_at: state.balance_pool_started_at,
                            balance_pool_start_value: state.balance_pool_start_value,
                            balance_pool_escrow_value: state.balance_pool_escrow_value
                        }] };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(entry => entry.requestId === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars =')) {
                        state.stars = params[0];
                        state.inventory = JSON.parse(params[1]);
                        state.balance_pool_started_at = params[2] ?? state.balance_pool_started_at;
                        state.balance_pool_start_value = params[3] ?? state.balance_pool_start_value;
                        state.balance_pool_escrow_value = params[4] ?? state.balance_pool_escrow_value;
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({
                            operation: statement.includes("'spend'") ? 'spend' : 'earn',
                            amount: params[2],
                            balanceAfter: params[3],
                            source: statement.includes("'staking:top_up'") ? 'staking:top_up' : 'staking:reward'
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            operation: params[2],
                            request: JSON.parse(params[3]),
                            response: JSON.parse(params[4])
                        });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected SQL in staking test: ${statement}`);
                },
                release() {}
            };
        }
    };
}

function run(pool, action, requestId, now, amount) {
    return operateStaking({
        pool,
        telegramId,
        requestId,
        action,
        itemId,
        amount,
        now,
        env: { BALANCE_POOL_SEASON_DEADLINE: '9999999999999' }
    });
}

test('activating a stake is server-calculated and idempotent', async () => {
    const pool = createPool();
    const started = await run(pool, 'activate', activeRequest, 1_000_000);
    const replay = await run(pool, 'activate', activeRequest, 1_001_000);

    assert.equal(started.duplicate, false);
    assert.equal(replay.duplicate, true);
    assert.deepEqual(pool.state.inventory[0].staking, {
        status: 'active',
        basePrice: 1000,
        pool: 3000,
        endTime: 1_000_000 + DURATION_MS,
        lastTick: 1_000_000,
        earned: 0,
        remainder: 0
    });
    assert.equal(pool.state.stars, '1000');
    assert.equal(pool.state.ledger.length, 0);
});

test('claims use elapsed server time and cannot pay the same interval twice', async () => {
    const pool = createPool();
    await run(pool, 'activate', activeRequest, 1_000_000);
    const requestId = '21c37f9e-6da8-4e8d-a44c-44d1f6b8165b';
    const claim = await run(pool, 'claim', requestId, 1_000_000 + 86_400_000);
    const replay = await run(pool, 'claim', requestId, 1_000_000 + 90_000_000);

    assert.equal(claim.earned, '1000');
    assert.equal(replay.duplicate, true);
    assert.equal(pool.state.stars, '2000');
    assert.equal(pool.state.inventory[0].staking.pool, 2000);
    assert.equal(pool.state.inventory[0].staking.earned, 1000);
    assert.equal(pool.state.ledger.length, 1);
    assert.equal(pool.state.ledger[0].source, 'staking:reward');
});

test('top-ups debit the balance and settle earned rewards atomically', async () => {
    const pool = createPool();
    await run(pool, 'activate', activeRequest, 1_000_000);
    const requestId = '21c37f9e-6da8-4e8d-a44c-44d1f6b8165c';
    const result = await run(pool, 'top_up', requestId, 1_000_000 + 3_600_000, 100);
    const replay = await run(pool, 'top_up', requestId, 1_000_000 + 7_200_000, 100);

    assert.equal(result.earned, '41');
    assert.equal(result.amountAdded, '100');
    assert.equal(replay.duplicate, true);
    assert.equal(pool.state.stars, '941');
    assert.equal(pool.state.inventory[0].staking.pool, 3059);
    assert.deepEqual(pool.state.ledger.map(entry => entry.source), [
        'staking:top_up',
        'staking:reward'
    ]);
});

test('an expired active stake pays its remaining pool and removes the item', async () => {
    const pool = createPool();
    await run(pool, 'activate', activeRequest, 1_000_000);
    const result = await run(
        pool, 'claim', '21c37f9e-6da8-4e8d-a44c-44d1f6b8165d', 1_000_000 + DURATION_MS
    );

    assert.equal(result.expired, true);
    assert.equal(result.earned, '3000');
    assert.equal(result.inventory.length, 0);
    assert.equal(pool.state.stars, '4000');
    assert.equal(pool.state.inventory.length, 0);
});

test('staking rejects unowned items, ineligible gifts, and insufficient top-ups', async () => {
    const missingItemPool = createPool();
    await assert.rejects(() => operateStaking({
        pool: missingItemPool, telegramId, requestId: activeRequest,
        action: 'activate', itemId: 'missing', now: 1_000_000
    }), { code: 'ITEMS_NOT_FOUND' });

    const ineligiblePool = createPool({
        inventory: [{ id: itemId, name: 'Durov Figure', price: 1000, limited: true }]
    });
    await assert.rejects(() => run(ineligiblePool, 'activate', activeRequest, 1_000_000), {
        code: 'ITEM_NOT_STAKEABLE'
    });

    const lowBalancePool = createPool({ stars: '10' });
    await run(lowBalancePool, 'activate', activeRequest, 1_000_000);
    await assert.rejects(() => run(
        lowBalancePool, 'top_up', '21c37f9e-6da8-4e8d-a44c-44d1f6b8165e', 1_001_000, 11
    ), { code: 'INSUFFICIENT_FUNDS' });
    assert.equal(lowBalancePool.state.stars, '10');
});

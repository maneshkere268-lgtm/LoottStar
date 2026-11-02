'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redeemPromo } = require('./promo-codes');

function createPool({ stars = 10, silver = 20, usedCodes = [], customPromos = {} } = {}) {
    const state = {
        stars: String(stars),
        silver: String(silver),
        usedCodes: [...usedCodes],
        operations: [],
        ledger: [],
        customPromos: structuredClone(customPromos)
    };
    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
                    if (sql.includes('FROM app_users')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            banned: false,
                            balance_pool_started_at: 1_000,
                            balance_pool_start_value: 0,
                            balance_pool_escrow_value: 0
                        }] };
                    }
                    if (sql.includes('FROM game_operations')) {
                        const operation = state.operations.find(item => item.requestId === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (sql.includes('FROM redeemed_promos')) {
                        return { rows: state.usedCodes.includes(params[1]) ? [{}] : [] };
                    }
                    if (sql.includes("FROM app_records WHERE namespace = 'promo_codes'")) {
                        const value = state.customPromos[params[0]];
                        return { rows: value ? [{ value }] : [] };
                    }
                    if (sql.startsWith('UPDATE app_users SET stars = $1')) {
                        state.stars = params[0];
                        state.silver = params[1];
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO redeemed_promos')) {
                        state.usedCodes.push(params[1]);
                        return { rows: [] };
                    }
                    if (sql.startsWith('UPDATE app_records SET value')) {
                        state.customPromos[params[1]] = JSON.parse(params[0]);
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ currency: params[2], amount: params[3] });
                        return { rows: [] };
                    }
                    if (sql.includes('INSERT INTO game_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            operation: 'promo_redeem',
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

test('promo redemption credits the server-defined reward exactly once', async () => {
    const pool = createPool();
    const input = {
        pool,
        telegramId: '12345',
        requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        code: ' release '
    };
    const first = await redeemPromo(input);
    const replay = await redeemPromo(input);
    assert.equal(first.amount, 25_000);
    assert.equal(first.stars, '25010');
    assert.equal(replay.duplicate, true);
    assert.equal(pool.state.stars, '25010');
    assert.equal(pool.state.ledger.length, 1);
    assert.deepEqual(pool.state.usedCodes, ['RELEASE']);
});

test('promo codes cannot be reused with another idempotency key', async () => {
    const pool = createPool({ usedCodes: ['STAR'] });
    await assert.rejects(() => redeemPromo({
        pool,
        telegramId: '12345',
        requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165b',
        code: 'STAR'
    }), { code: 'PROMO_ALREADY_USED' });
});

test('unknown, retired and malformed promo codes are rejected', async () => {
    const pool = createPool();
    for (const [code, expected] of [
        ['missing', 'PROMO_NOT_FOUND'],
        ['HALLOWEEN', 'PROMO_INACTIVE'],
        ['', 'INVALID_PROMO_CODE']
    ]) {
        await assert.rejects(() => redeemPromo({
            pool,
            telegramId: '12345',
            requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165c',
            code
        }), { code: expected });
    }
});

test('active custom currency promos use admin-defined values and track activation limits', async () => {
    const pool = createPool({
        stars: 100,
        customPromos: {
            COMMUNITY: {
                active: true,
                rewardType: 'currency',
                balanceField: 'silver',
                amount: 900,
                currencyLabel: 'silver',
                maxActivations: 2,
                usedCount: 0
            }
        }
    });
    const result = await redeemPromo({
        pool,
        telegramId: '12345',
        requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165d',
        code: 'community'
    });
    assert.equal(result.currency, 'silver');
    assert.equal(result.amount, 900);
    assert.equal(result.silver, '920');
    assert.equal(pool.state.customPromos.COMMUNITY.usedCount, 1);
    assert.equal(pool.state.ledger.length, 1);
});

test('custom item promos award a server-created owned item exactly once', async () => {
    const pool = createPool({
        customPromos: {
            GIFT: {
                active: true,
                rewardType: 'item',
                item: { name: 'Community Gift', image: '/shared/gift.png', price: 250 }
            }
        }
    });
    const result = await redeemPromo({
        pool,
        telegramId: '12345',
        requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165e',
        code: 'GIFT'
    });
    assert.equal(result.item.name, 'Community Gift');
    assert.equal(result.inventory.length, 1);
    assert.equal(pool.state.ledger.length, 0);
    assert.equal(pool.state.customPromos.GIFT.usedCount, 1);
});

test('custom promo rejects inactive, sold-out and unsafe reward definitions', async () => {
    const pool = createPool({
        customPromos: {
            OFF: { active: false, rewardType: 'currency', balanceField: 'stars', amount: 1 },
            FULL: { active: true, rewardType: 'currency', balanceField: 'stars', amount: 1, maxActivations: 1, usedCount: 1 },
            BAD: { active: true, rewardType: 'currency', balanceField: 'banned', amount: 1 }
        }
    });
    for (const [code, expected] of [
        ['OFF', 'PROMO_INACTIVE'],
        ['FULL', 'PROMO_SOLD_OUT'],
        ['BAD', 'PROMO_INVALID_REWARD']
    ]) {
        await assert.rejects(() => redeemPromo({
            pool,
            telegramId: '12345',
            requestId: '31c37f9e-6da8-4e8d-a44c-44d1f6b8165f',
            code
        }), { code: expected });
    }
});

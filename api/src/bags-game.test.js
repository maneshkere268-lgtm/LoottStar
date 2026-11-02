'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chooseOutcome, playBags, resolveDrop } = require('./bags-game');
const { OperationError } = require('./operation-errors');
const silverGiftCatalog = require('./silver-gift-catalog.json');

const env = { BALANCE_POOL_SEASON_DEADLINE: '9999999999999' };
const frontendGiftCatalogPath = path.join(__dirname, '..', '..', 'shared', 'gifts.js');

test('server silver gift catalog matches the frontend catalog', {
    skip: !fs.existsSync(frontendGiftCatalogPath)
}, () => {
    const source = fs.readFileSync(frontendGiftCatalogPath, 'utf8')
        .replace('window.ALL_GIFTS = [...GIFTS, ...SPECIAL_GIFTS]',
            'window.ALL_GIFTS = [...window.GIFTS, ...window.SPECIAL_GIFTS]');
    const context = { window: {} };
    vm.runInNewContext(source, context);
    assert.deepEqual(
        JSON.parse(JSON.stringify(silverGiftCatalog)),
        JSON.parse(JSON.stringify(context.window.SILVER_GIFTS))
    );
});

function createPool({ stars = '1000', silver = '0', inventory = [] } = {}) {
    const state = {
        stars, silver, silver_turnover: '0', inventory,
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
                    if (statement.startsWith('SELECT stars, silver, silver_turnover')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            silver_turnover: state.silver_turnover,
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
                    if (statement.startsWith('UPDATE app_users SET stars = $1, silver = $2')) {
                        state.stars = params[0];
                        state.silver = params[1];
                        state.silver_turnover = params[2];
                        state.inventory = JSON.parse(params[3]);
                        state.balance_pool_started_at = params[4];
                        state.balance_pool_start_value = params[5];
                        state.balance_pool_escrow_value = params[6];
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({
                            operation: statement.includes("'earn'") ? 'earn' : 'spend',
                            currency: params[2],
                            amount: String(params[3]),
                            balance_after: String(params[4])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            request_id: params[1],
                            operation: 'bags_play',
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

test('bag multiplier table uses configured weights', () => {
    assert.equal(chooseOutcome(() => 0), 0.75);
    assert.equal(chooseOutcome(() => 0.3), 1);
    assert.equal(chooseOutcome(() => 0.5), 1.1);
    assert.equal(chooseOutcome(() => 0.95), 5);
});

test('bag drops convert payout to a server-owned gift and remainder', () => {
    const starDrop = resolveDrop(500, 'star');
    assert.ok(starDrop.gift);
    assert.equal(starDrop.gift.currency, 'star');
    assert.equal(starDrop.remainder + starDrop.gift.price, 500);

    const silverDrop = resolveDrop(100, 'silver');
    assert.equal(silverDrop.gift.name, 'Серебряный подарок');
    assert.equal(silverDrop.remainder, 10);
    assert.deepEqual(resolveDrop(75, 'star'), { gift: null, remainder: 75 });
});

test('bag operation atomically applies bet, payout, item, turnover and idempotent replay', async () => {
    const pool = createPool();
    const input = {
        pool, env, telegramId: '12345',
        requestId: '11111111-1111-4111-8111-111111111111',
        amount: 100, currency: 'star', now: 1_800_000_000_000,
        random: () => 0.5
    };
    const result = await playBags(input);
    const replay = await playBags({ ...input, random: () => 0 });

    assert.equal(result.multiplier, 1.1);
    assert.equal(result.payout, 110);
    assert.ok(result.gift);
    assert.equal(result.gift.currency, 'star');
    assert.equal(pool.state.stars, String(1000 - 100 + result.remainder));
    assert.equal(pool.state.inventory.length, 1);
    assert.equal(pool.state.ledger.length, 2);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.payout, 110);
    assert.equal(pool.state.operations.length, 1);
});

test('silver bag turnover and insufficient funds are enforced server-side', async () => {
    const pool = createPool({ silver: '1000' });
    const result = await playBags({
        pool, env, telegramId: '12345',
        requestId: '22222222-2222-4222-8222-222222222222',
        amount: 100, currency: 'silver', now: 1_800_000_000_000,
        random: () => 0
    });
    assert.equal(result.multiplier, 0.75);
    assert.equal(result.silverTurnover, '100');
    assert.equal(pool.state.silver, '975');
    assert.equal(pool.state.silver_turnover, '100');

    await assert.rejects(
        playBags({
            pool, env, telegramId: '12345',
            requestId: '33333333-3333-4333-8333-333333333333',
            amount: 10_000, currency: 'silver',
            now: 1_800_000_000_000, random: () => 0
        }),
        error => error instanceof OperationError && error.code === 'INSUFFICIENT_FUNDS'
    );
    assert.equal(pool.state.silver, '975');
});

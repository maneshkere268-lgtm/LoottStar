'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const giftCatalog = require('./gift-catalog.json');
const { upgradeItem } = require('./item-upgrade');

const env = { BALANCE_POOL_SEASON_DEADLINE: '9999999999999' };

function createPool(inventory) {
    const state = {
        stars: '10',
        silver: '0',
        inventory,
        operations: []
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
                            balance_pool_started_at: 0,
                            balance_pool_start_value: 0,
                            balance_pool_escrow_value: 0
                        }] };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(item => item.requestId === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET inventory')) {
                        state.inventory = JSON.parse(params[0]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            operation: 'item_upgrade',
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

function sourceInventory() {
    return [{
        id: 'item-source',
        name: 'Source gift',
        price: 800,
        stars: 100_000,
        image: '/shared/gift.png'
    }];
}

const frontendGiftCatalogPath = path.join(__dirname, '..', '..', 'shared', 'gifts.js');

test('server upgrade catalog matches the frontend gift catalog', {
    skip: !fs.existsSync(frontendGiftCatalogPath)
}, () => {
    const source = fs.readFileSync(frontendGiftCatalogPath, 'utf8')
        .replace('window.ALL_GIFTS = [...GIFTS, ...SPECIAL_GIFTS]',
            'window.ALL_GIFTS = [...window.GIFTS, ...window.SPECIAL_GIFTS]');
    const context = { window: {} };
    vm.runInNewContext(source, context);
    const frontendCatalog = context.window.ALL_GIFTS.map(({ name, price, image }) => ({
        name, price, image
    }));
    assert.deepEqual(JSON.parse(JSON.stringify(giftCatalog)), JSON.parse(JSON.stringify(frontendCatalog)));
});

test('upgrade success consumes the owned item and awards the server catalog target', async () => {
    const pool = createPool(sourceInventory());
    const result = await upgradeItem({
        pool, env, telegramId: '12345', requestId: 'upgrade-success',
        itemId: 'item-source', targetName: 'Mirage Lamp (Iron Hearth)',
        now: 1_800_000_000_000, random: () => 7.99
    });

    assert.equal(result.success, true);
    assert.equal(result.chance, 10);
    assert.equal(result.effectiveChance, 8);
    assert.equal(result.item.name, 'Mirage Lamp (Iron Hearth)');
    assert.equal(result.item.stars, 1_000_000);
    assert.equal(pool.state.inventory.length, 1);
    assert.notEqual(pool.state.inventory[0].id, 'item-source');
});

test('upgrade failure consumes the source item without creating a target', async () => {
    const pool = createPool(sourceInventory());
    const result = await upgradeItem({
        pool, env, telegramId: '12345', requestId: 'upgrade-failure',
        itemId: 'item-source', targetName: 'Mirage Lamp (Iron Hearth)',
        now: 1_800_000_000_000, random: () => 8
    });

    assert.equal(result.success, false);
    assert.equal(result.item, null);
    assert.deepEqual(pool.state.inventory, []);
});

test('upgrade replay returns the recorded outcome without consuming an item twice', async () => {
    const pool = createPool(sourceInventory());
    const request = {
        pool, env, telegramId: '12345', requestId: 'upgrade-replay',
        itemId: 'item-source', targetName: 'Mirage Lamp (Iron Hearth)',
        now: 1_800_000_000_000, random: () => 7.99
    };
    const first = await upgradeItem(request);
    const replay = await upgradeItem({ ...request, random: () => 90 });

    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.item, first.item);
    assert.equal(pool.state.inventory.length, 1);
    assert.equal(pool.state.operations.length, 1);
});

test('upgrade rejects targets outside the server catalog', async () => {
    const pool = createPool(sourceInventory());
    await assert.rejects(
        upgradeItem({
            pool, env, telegramId: '12345', requestId: 'upgrade-invalid',
            itemId: 'item-source', targetName: 'Client-invented gift',
            now: 1_800_000_000_000
        }),
        { code: 'INVALID_UPGRADE_TARGET' }
    );
    assert.equal(pool.state.inventory.length, 1);
});

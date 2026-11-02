'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('./case-catalog.json');
const { chooseGift, getCaseItems, openCase } = require('./case-opening');

function createPool({ stars = 100, silver = 0 } = {}) {
    const state = {
        stars: String(stars),
        silver: String(silver),
        banned: false,
        inventory: [],
        collectionItems: [],
        freeCaseUsage: {},
        ledger: [],
        operations: []
    };
    let beforeTransaction;
    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    const statement = sql.trimStart();
                    if (statement === 'BEGIN') {
                        beforeTransaction = structuredClone(state);
                        return { rows: [] };
                    }
                    if (statement === 'COMMIT') return { rows: [] };
                    if (statement === 'ROLLBACK') {
                        Object.assign(state, beforeTransaction);
                        return { rows: [] };
                    }
                    if (statement.startsWith('SELECT stars, silver, banned')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            banned: state.banned,
                            inventory: state.inventory,
                            collection_items: state.collectionItems,
                            free_case_usage: state.freeCaseUsage
                        }] };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(item => item.requestId === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET')) {
                        const field = statement.includes('silver = $1') ? 'silver' : 'stars';
                        state[field] = params[0];
                        state.inventory = JSON.parse(params[1]);
                        state.collectionItems = JSON.parse(params[2]);
                        state.freeCaseUsage = JSON.parse(params[3]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ requestId: params[1], amount: params[3], source: params[5] });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            requestId: params[1],
                            operation: 'case_open',
                            request: JSON.parse(params[2]),
                            response: JSON.parse(params[3])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO live_wins')) {
                        state.liveWins = (state.liveWins || 0) + 1;
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected SQL in test: ${sql}`);
                },
                release() {}
            };
        }
    };
}

const gameCatalogPath = path.join(__dirname, '..', '..', 'index.js');
test('server catalog stays identical to the game case catalog', {
    skip: !fs.existsSync(gameCatalogPath)
}, () => {
    const source = fs.readFileSync(gameCatalogPath, 'utf8');
    const start = source.indexOf('const CASES = [');
    const end = source.indexOf('\n];', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const expression = source.slice(start + 'const CASES = '.length, end + 2);
    const gameCatalog = vm.runInNewContext(expression, { CASE_IMG_PATH: '/images/cases/' });
    assert.deepEqual(JSON.parse(JSON.stringify(catalog)), JSON.parse(JSON.stringify(gameCatalog)));
});

test('case selection uses the configured random draw and normalizes low-price star drops', () => {
    const sampleCase = {
        price: 100,
        items: [
            { name: 'Heart', price: 50, chance: 50 },
            { name: 'Artifact', price: 500, chance: 50 }
        ]
    };
    const [normalizedCheap] = getCaseItems(sampleCase);
    assert.equal(normalizedCheap.name, 'Stars');
    assert.equal(normalizedCheap.currency, 'star');

    assert.equal(chooseGift(sampleCase, () => 0).name, 'Stars');
    assert.equal(chooseGift(sampleCase, () => 99.999999).name, 'Artifact');

    const onlyExpensive = {
        price: 0,
        items: [
            { name: 'First', price: 101, chance: 50 },
            { name: 'Last', price: 102, chance: 50 }
        ]
    };
    assert.equal(chooseGift(onlyExpensive, () => 97).name, 'Last');
});

test('paid case opening atomically spends balance, stores items, and is idempotent', async () => {
    const pool = createPool({ stars: 100 });
    const input = {
        pool,
        telegramId: '12345',
        requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        caseId: 42,
        quantity: 1,
        now: new Date('2026-11-01T12:00:00Z')
    };

    const first = await openCase(input);
    assert.equal(first.balance, '50');
    assert.equal(pool.state.stars, '50');
    assert.equal(pool.state.inventory.length, 1);
    assert.equal(pool.state.collectionItems.length, 1);
    assert.equal(pool.state.ledger.length, 1);
    assert.equal(first.duplicate, false);

    const retry = await openCase(input);
    assert.equal(retry.balance, '50');
    assert.equal(retry.items[0].id, first.items[0].id);
    assert.equal(retry.duplicate, true);
    assert.equal(pool.state.inventory.length, 1);
    assert.equal(pool.state.ledger.length, 1);
});

test('daily free case limit is enforced by the server', async () => {
    const pool = createPool({ stars: 0 });
    const now = new Date('2026-11-01T12:00:00Z');
    const first = await openCase({
        pool,
        telegramId: '12345',
        requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        caseId: 10000,
        quantity: 10,
        now
    });
    assert.equal(first.freeCaseUsage[10000].count, 10);
    await assert.rejects(openCase({
        pool,
        telegramId: '12345',
        requestId: '21c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        caseId: 10000,
        quantity: 1,
        now
    }), { code: 'FREE_CASE_LIMIT_REACHED' });
    assert.equal(pool.state.inventory.length, 10);
});

test('insufficient funds do not mutate inventory or create a ledger entry', async () => {
    const pool = createPool({ stars: 49 });
    await assert.rejects(openCase({
        pool,
        telegramId: '12345',
        requestId: '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a',
        caseId: 42,
        quantity: 1
    }), { code: 'INSUFFICIENT_FUNDS' });
    assert.equal(pool.state.stars, '49');
    assert.equal(pool.state.inventory.length, 0);
    assert.equal(pool.state.ledger.length, 0);
});

'use strict';

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontendApiPath = path.join(__dirname, '..', '..', 'shared', 'api.js');
const authPath = path.join(__dirname, '..', '..', 'shared', 'auth.js');
const frontendAvailable = fs.existsSync(frontendApiPath) && fs.existsSync(authPath);
function test(name, options, fn) {
    if (typeof options === 'function') {
        fn = options;
        options = {};
    }
    return nodeTest(name, {
        ...options,
        skip: options.skip || !frontendAvailable
    }, fn);
}

function createBrowser(initData = 'signed-telegram-init-data') {
    const calls = [];
    const values = new Map();
    const events = [];
    const window = {
        Telegram: { WebApp: { initData } },
        crypto: { randomUUID: () => '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a' },
        fetch: async (url, options) => {
            calls.push({ url, options });
            return {
                ok: true,
                status: 200,
                async json() {
                    if (url.endsWith('/api/v1/me')) {
                        return { user: { stars: '42', silver: '7', inventory: [], collection_items: [] } };
                    }
                    return { accepted: true };
                }
            };
        },
        dispatchEvent: event => events.push(event)
    };
    const localStorage = {
        setItem: (key, value) => values.set(key, String(value)),
        getItem: key => values.get(key) ?? null,
        removeItem: key => values.delete(key)
    };
    const source = fs.readFileSync(
        frontendApiPath,
        'utf8'
    );
    vm.runInNewContext(source, {
        window,
        localStorage,
        CustomEvent: class CustomEvent {
            constructor(type, options) {
                this.type = type;
                this.detail = options?.detail;
            }
        }
    });
    return { window, values, calls, events };
}

function createAuthBrowser({ initData = '', user = null, savedValues = [] } = {}) {
    const values = new Map(savedValues);
    const localStorage = {
        setItem: (key, value) => values.set(key, String(value)),
        getItem: key => values.get(key) ?? null,
        removeItem: key => values.delete(key)
    };
    const window = {
        Telegram: {
            WebApp: {
                initData,
                initDataUnsafe: { user },
                expand() {},
                ready() {},
                isVersionAtLeast() { return false; }
            }
        }
    };
    const document = { addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(authPath, 'utf8'), {
        window,
        document,
        localStorage
    });
    return { window, values };
}

test('ordinary browser preview does not authenticate or persist a guest profile', () => {
    const browser = createAuthBrowser({
        user: { id: 12345, first_name: 'Cached user' }
    });

    assert.equal(browser.window.TG.isTelegram, false);
    assert.equal(browser.values.has('userId'), false);
    assert.equal(browser.values.has('userName'), false);
});

test('Telegram profile is persisted only when WebApp initData is present', () => {
    const browser = createAuthBrowser({
        initData: 'signed-init-data',
        user: { id: 12345, first_name: 'Test' }
    });

    assert.equal(browser.window.TG.isTelegram, true);
    assert.equal(browser.values.get('userId'), '12345');
    assert.equal(browser.values.get('userName'), 'Test');
});

test('frontend API sends Telegram initData and applies PostgreSQL profile values', async () => {
    const browser = createBrowser();
    const user = await browser.window.LootStarAPI.loadProfile();

    assert.equal(browser.calls[0].url, 'https://api.immortals-market.ru/api/v1/me');
    assert.equal(browser.calls[0].options.headers.Authorization, 'tma signed-telegram-init-data');
    assert.equal(browser.values.get('userStars'), '42');
    assert.equal(browser.values.get('userSilver'), '7');
    assert.equal(user.stars, '42');
    const profileEvent = browser.events.find(event => event.type === 'profileDataLoaded');
    assert.equal(profileEvent.detail.source, 'api');
});

test('frontend leaderboard request accepts only supported sort fields', async () => {
    const browser = createBrowser();
    await browser.window.LootStarAPI.getLeaderboard('silver');
    assert.equal(browser.calls[0].url, 'https://api.immortals-market.ru/api/v1/leaderboard?sort=silver');
    await assert.rejects(() => browser.window.LootStarAPI.getLeaderboard('username'), /INVALID_LEADERBOARD_SORT/);
    assert.equal(browser.calls.length, 1);
});

test('frontend balance ledger request applies a bounded server query limit', async () => {
    const browser = createBrowser();
    await browser.window.LootStarAPI.getBalanceLedger(999);

    assert.equal(
        browser.calls[0].url,
        'https://api.immortals-market.ru/api/v1/balance/ledger?limit=200'
    );
    assert.equal(browser.calls[0].options.headers.Authorization, 'tma signed-telegram-init-data');
});

test('frontend API reads explicit server configuration and supports server shop requests', async () => {
    const browser = createBrowser();
    await browser.window.LootStarAPI.getAppConfig('rates');
    assert.equal(browser.calls[0].url, 'https://api.immortals-market.ru/api/v1/app-config/rates');
    await assert.rejects(() => browser.window.LootStarAPI.getAppConfig('private'), /INVALID_APP_CONFIG_KEY/);

    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.buyIndexItem('Jester Hat', requestId);
    assert.equal(browser.calls[1].url, 'https://api.immortals-market.ru/api/v1/shop/buy');
    assert.equal(browser.calls[1].options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(browser.calls[1].options.body), { itemName: 'Jester Hat' });
});

test('frontend case requests send server operation inputs and stable idempotency keys', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.openCase(42, 2, requestId);
    const call = browser.calls[0];

    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/cases/open');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, 'tma signed-telegram-init-data');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { caseId: 42, quantity: 2 });
});

test('frontend upgrade request sends only item and target identifiers', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.upgradeItem(
        'owned-item-id', 'Mirage Lamp (Iron Hearth)', requestId
    );
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/inventory/upgrade');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), {
        itemId: 'owned-item-id',
        targetName: 'Mirage Lamp (Iron Hearth)'
    });
});

test('frontend sale request sends only owned IDs with its stable idempotency key', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.sellItems(['owned-a', 'owned-b'], requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/inventory/sell');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { itemIds: ['owned-a', 'owned-b'] });
});

test('frontend saved-item request sends item state and an idempotency key', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.setItemSaved('owned-a', true, requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/inventory/save');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { itemId: 'owned-a', saved: true });
});

test('frontend promo redemption sends only the code and preserves its idempotency key', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.redeemPromo('RELEASE', requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/promos/redeem');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { code: 'RELEASE' });
});

test('frontend daily-task endpoints use authenticated reads and idempotent claims', async () => {
    const browser = createBrowser();
    await browser.window.LootStarAPI.getDailyTasks();
    assert.equal(browser.calls[0].url, 'https://api.immortals-market.ru/api/v1/tasks/daily');
    assert.equal(browser.calls[0].options.headers.Authorization, 'tma signed-telegram-init-data');

    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.claimDailyTask('star_bets_5', requestId);
    const call = browser.calls[1];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/tasks/daily/claim');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { taskId: 'star_bets_5' });
});

test('frontend withdrawal sends only amount and a stable idempotency key', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.submitWithdrawal(50_000_000, requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/withdrawals');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { amount: 50_000_000 });
});

test('frontend staking operations send only server-validated action inputs', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.operateStaking('top_up', 'owned-durov-item', 250, requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/staking/operate');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, 'tma signed-telegram-init-data');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), {
        action: 'top_up',
        itemId: 'owned-durov-item',
        amount: 250
    });
    await assert.rejects(() => browser.window.LootStarAPI.operateStaking('credit', 'owned-durov-item'), {
        message: 'INVALID_STAKING_ACTION'
    });
    assert.equal(browser.calls.length, 1);
});

test('frontend referral requests use authenticated API endpoints and idempotency', async () => {
    const browser = createBrowser();
    const profile = await browser.window.LootStarAPI.getReferralProfile();
    assert.equal(profile.accepted, true);
    assert.equal(browser.calls[0].url, 'https://api.immortals-market.ru/api/v1/referrals/me');
    assert.equal(browser.calls[0].options.headers.Authorization, 'tma signed-telegram-init-data');

    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.joinReferral('54321', requestId);
    const call = browser.calls[1];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/referrals/join');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { referrerId: '54321' });
});

test('frontend loads event configuration from the API', async () => {
    const browser = createBrowser();
    await browser.window.LootStarAPI.getEventConfig();
    assert.equal(browser.calls[0].url, 'https://api.immortals-market.ru/api/v1/app-config/events');
    assert.equal(browser.calls[0].options.headers.Authorization, 'tma signed-telegram-init-data');
});

test('frontend craft request sends only owned item IDs and currency with idempotency', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.craftItems(['item-a', 'item-b', 'item-c'], 'silver', requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/inventory/craft');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), {
        itemIds: ['item-a', 'item-b', 'item-c'],
        currency: 'silver'
    });
});

test('frontend Bags request sends only the wager and currency', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.playBags(250, 'silver', requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/games/bags/open');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { amount: 250, currency: 'silver' });
});

test('frontend Fishing requests send only wagers and game identifiers', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.startFishing(100, 'star', requestId);
    assert.equal(browser.calls[0].url, 'https://api.immortals-market.ru/api/v1/games/fishing/start');
    assert.deepEqual(JSON.parse(browser.calls[0].options.body), {
        amount: 100, currency: 'star'
    });
    await browser.window.LootStarAPI.continueFishing('fishing-game-id', requestId);
    assert.equal(browser.calls[1].url, 'https://api.immortals-market.ru/api/v1/games/fishing/continue');
    assert.deepEqual(JSON.parse(browser.calls[1].options.body), { gameId: 'fishing-game-id' });
    await browser.window.LootStarAPI.cashoutFishing('fishing-game-id', requestId);
    assert.equal(browser.calls[2].url, 'https://api.immortals-market.ru/api/v1/games/fishing/cashout');
    assert.deepEqual(JSON.parse(browser.calls[2].options.body), { gameId: 'fishing-game-id' });
});

test('frontend Mines requests send only user actions and apply server balances', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.startMines(50, 'star', 2, requestId);
    const start = browser.calls[0];
    assert.equal(start.url, 'https://api.immortals-market.ru/api/v1/games/mines/start');
    assert.equal(start.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(start.options.body), { amount: 50, currency: 'star', minesCount: 2 });
    assert.equal('minePositions' in JSON.parse(start.options.body), false);

    await browser.window.LootStarAPI.minesAction('reveal', 'server-game-id', 3, requestId);
    assert.deepEqual(JSON.parse(browser.calls[1].options.body), {
        gameId: 'server-game-id', cell: 3
    });
    browser.window.LootStarAPI.applyBalanceResult({
        stars: '92', silver: '7', silverTurnover: '100'
    });
    assert.equal(browser.values.get('userStars'), '92');
    assert.equal(browser.values.get('userSilver'), '7');
    assert.equal(browser.values.get('silverTurnover'), '100');
});

test('frontend Slots requests send the bet and currency to the server with idempotency', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.spinSlots(500, 'silver', requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/games/slots/spin');
    assert.equal(call.options.headers.Authorization, 'tma signed-telegram-init-data');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), { amount: 500, currency: 'silver' });
});

test('frontend Plinko requests send the bet, currency and difficulty to the server', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.dropPlinko(250, 'star', 'hard', requestId);
    const call = browser.calls[0];
    assert.equal(call.url, 'https://api.immortals-market.ru/api/v1/games/plinko/drop');
    assert.equal(call.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(call.options.body), {
        amount: 250, currency: 'star', difficulty: 'hard'
    });
});

test('frontend Crash requests use authenticated API routes and operation idempotency', async () => {
    const browser = createBrowser();
    const requestId = browser.window.LootStarAPI.createRequestId();
    await browser.window.LootStarAPI.startCrash(100, 'star', requestId);
    const start = browser.calls[0];
    assert.equal(start.url, 'https://api.immortals-market.ru/api/v1/games/crash/start');
    assert.equal(start.options.headers['Idempotency-Key'], requestId);
    assert.deepEqual(JSON.parse(start.options.body), { amount: 100, currency: 'star' });

    await browser.window.LootStarAPI.cashoutCrash('server-round-id', requestId);
    const cashout = browser.calls[1];
    assert.equal(cashout.url, 'https://api.immortals-market.ru/api/v1/games/crash/cashout');
    assert.deepEqual(JSON.parse(cashout.options.body), { gameId: 'server-round-id' });
});

test('frontend API does not send requests without Telegram initData', async () => {
    const browser = createBrowser('');
    await assert.rejects(browser.window.LootStarAPI.loadProfile(), { code: 'TELEGRAM_AUTH_REQUIRED' });
    assert.equal(browser.calls.length, 0);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('./app');
const { createAdminPasswordHash } = require('./local-admin-auth');

const botToken = 'test-bot-token';

function makeInitData() {
    const values = new Map([
        ['auth_date', String(Math.floor(Date.now() / 1000))],
        ['user', JSON.stringify({ id: 12345, first_name: 'Test' })]
    ]);
    const checkString = [...values.entries()]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    values.set('hash', crypto.createHmac('sha256', secretKey).update(checkString).digest('hex'));
    return new URLSearchParams(values).toString();
}

function createTestPool({
    account = true, stars = 100, silver = 0, inventory = [], taskStats = {}, appSettings = {}
} = {}) {
    const state = {
        account,
        stars,
        silver,
        silverTurnover: 0,
        inventory,
        crashSessions: [],
        fishingSessions: [],
        collectionItems: [],
        freeCaseUsage: {},
        ledger: [],
        operations: [],
        redeemedPromos: [],
        halloweenXP: '0',
        dailyTaskClaims: [],
        taskStats,
        withdrawalRequests: [],
        referralJoins: [],
        appSettings,
        rates: null,
        promoRecords: {}
    };
    return {
        state,
        async query(sql, params = []) {
            if (sql.includes('SELECT halloween_xp FROM app_users')) {
                return { rows: state.account ? [{ halloween_xp: state.halloweenXP }] : [] };
            }
            if (sql.includes('FROM game_operations') && sql.includes('created_at >= $2')) {
                return { rows: [state.taskStats] };
            }
            if (sql.includes('SELECT task_id FROM daily_task_claims')) {
                return { rows: state.dailyTaskClaims.map(claim => ({ task_id: claim.task_id })) };
            }
            if (sql.includes('FROM fishing_sessions WHERE telegram_id')) {
                const session = state.fishingSessions.find(row =>
                    row.telegram_id === params[0] && row.status === 'active'
                );
                return { rows: session ? [session] : [] };
            }
            if (sql.includes('SELECT firestore_doc_id AS "docId" FROM app_users WHERE telegram_id')) {
                return { rows: state.account ? [{ docId: 'id_12345' }] : [] };
            }
            if (sql.includes('FROM referral_joins')) {
                return { rows: [{
                    joined_count: String(state.referralJoins.filter(join => join.referrer === params[0]).length),
                    referred_by: state.referralJoins.find(join => join.referred === params[0])?.referrer || null
                }] };
            }
            if (sql.includes('FROM app_settings') && sql.includes('ANY($1::text[])')) {
                return {
                    rows: params[0]
                        .filter(key => state.appSettings[key] !== undefined)
                        .map(setting_key => ({ setting_key, value: state.appSettings[setting_key] }))
                };
            }
            if (sql.includes('FROM app_settings WHERE setting_key = $1')) {
                return state.appSettings[params[0]] === undefined
                    ? { rows: [] }
                    : { rows: [{ value: state.appSettings[params[0]] }] };
            }
            if (sql.includes('FROM app_users') && sql.includes('ORDER BY')) {
                return { rows: [] };
            }
            if (sql.includes('FROM live_wins')) {
                return { rows: state.liveWins || [] };
            }
            if (sql.includes('FROM balance_ledger WHERE telegram_id')) {
                return { rows: state.ledger.slice(0, params[1]) };
            }
            return { rows: [] };
        },
        async connect() {
            return {
                async query(sql, params = []) {
                    const statement = sql.trimStart();
                    if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };
                    if (statement.startsWith('SELECT stars, silver, banned') ||
                        statement.startsWith('SELECT stars, silver, inventory, balance_pool_started_at')) {
                        return state.account
                            ? { rows: [{
                                stars: String(state.stars),
                                silver: String(state.silver),
                                banned: false,
                                inventory: state.inventory,
                                collection_items: state.collectionItems,
                                free_case_usage: state.freeCaseUsage,
                                balance_pool_started_at: 0,
                                balance_pool_start_value: 0,
                                balance_pool_escrow_value: 0
                            }] }
                            : { rows: [] };
                    }
                    if (statement.startsWith('SELECT telegram_id, username, first_name, last_name')) {
                        return state.account ? { rows: [{
                            telegram_id: '12345',
                            username: 'test_user',
                            first_name: 'Test',
                            last_name: '',
                            stars: String(state.stars),
                            silver: String(state.silver),
                            inventory: state.inventory,
                            banned: false,
                            balance_pool_started_at: 0,
                            balance_pool_start_value: 0,
                            balance_pool_escrow_value: 0
                        }] } : { rows: [] };
                    }
                    if (statement.startsWith('SELECT stars, silver, inventory, banned')) {
                        return state.account
                            ? { rows: [{
                                stars: String(state.stars),
                                silver: String(state.silver),
                                inventory: state.inventory,
                                banned: false,
                                halloween_xp: state.halloweenXP,
                                balance_pool_started_at: 0,
                                balance_pool_start_value: 0,
                                balance_pool_escrow_value: 0
                            }] }
                            : { rows: [] };
                    }
                    if (statement.startsWith('SELECT banned FROM app_users')) {
                        return state.account ? { rows: [{ banned: false }] } : { rows: [] };
                    }
                    if (statement.startsWith('SELECT referrer_telegram_id, request_id')) {
                        const join = state.referralJoins.find(row => row.referred === params[0]);
                        return { rows: join ? [{
                            referrer_telegram_id: join.referrer,
                            request_id: join.requestId
                        }] : [] };
                    }
                    if (statement.startsWith('SELECT telegram_id, banned FROM app_users')) {
                        return { rows: [{ telegram_id: params[0], banned: false }] };
                    }
                    if (statement.startsWith('SELECT telegram_id, stars, silver, silver_turnover')) {
                        return state.account
                            ? { rows: [{
                                telegram_id: '12345',
                                stars: String(state.stars),
                                silver: String(state.silver),
                                silver_turnover: String(state.silverTurnover),
                                banned: false,
                                inventory: state.inventory,
                                balance_pool_started_at: 0,
                                balance_pool_start_value: 0,
                                balance_pool_escrow_value: 0
                            }] }
                            : { rows: [] };
                    }
                    if (statement.startsWith('SELECT stars, silver, silver_turnover, banned')) {
                        return state.account
                            ? { rows: [{
                                stars: String(state.stars),
                                silver: String(state.silver),
                                silver_turnover: String(state.silverTurnover),
                                banned: false,
                                inventory: state.inventory,
                                balance_pool_started_at: 0,
                                balance_pool_start_value: 0,
                                balance_pool_escrow_value: 0
                            }] }
                            : { rows: [] };
                    }
                    if (statement.startsWith('SELECT 1 FROM crash_sessions')) {
                        return {
                            rows: state.crashSessions.some(session =>
                                session.telegram_id === params[0] && session.status === 'active'
                            ) ? [{}] : []
                        };
                    }
                    if (statement.startsWith('SELECT 1 FROM fishing_sessions')) {
                        return {
                            rows: state.fishingSessions.some(session =>
                                session.telegram_id === params[0] && session.status === 'active'
                            ) ? [{}] : []
                        };
                    }
                    if (statement.includes('FROM crash_sessions')) {
                        const session = state.crashSessions
                            .filter(row => row.telegram_id === params[0] && row.status === 'active')
                            .sort((left, right) => right.created_at - left.created_at)[0];
                        return { rows: session ? [session] : [] };
                    }
                    if (statement.startsWith('SELECT session_id, telegram_id, bet_amount')) {
                        const session = state.fishingSessions.find(row =>
                            row.session_id === params[0] && row.telegram_id === params[1]
                        );
                        return { rows: session ? [session] : [] };
                    }
                    if (statement.includes('FROM game_operations') && statement.includes('created_at >= $2')) {
                        return { rows: [state.taskStats] };
                    }
                    if (statement.includes('FROM daily_task_claims') && statement.includes('request_id = $2')) {
                        const claim = state.dailyTaskClaims.find(item => item.request_id === params[1]);
                        return { rows: claim ? [claim] : [] };
                    }
                    if (statement.includes('FROM daily_task_claims')) {
                        return {
                            rows: state.dailyTaskClaims.some(item =>
                                item.day === params[1] && item.task_id === params[2]
                            ) ? [{}] : []
                        };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(item => item.requestId === params[1]);
                        return { rows: operation ? [operation] : [] };
                    }
                    if (statement.includes('FROM balance_ledger WHERE')) {
                        const entry = state.ledger.find(item => item.requestId === params[1]);
                        return { rows: entry ? [entry] : [] };
                    }
                    if (statement.startsWith('SELECT request FROM withdrawal_requests')) {
                        const withdrawal = state.withdrawalRequests.find(item => item.requestId === params[1]);
                        return { rows: withdrawal ? [{ request: withdrawal.request }] : [] };
                    }
                    if (statement.includes("FROM app_records WHERE namespace = 'promo_codes'")) {
                        const value = state.promoRecords[params[0]];
                        return { rows: value ? [{ value }] : [] };
                    }
                    if (statement.startsWith('SELECT value FROM app_settings')) {
                        return { rows: state.rates ? [{ value: state.rates }] : [] };
                    }
                    if (statement.includes('FROM redeemed_promos')) {
                        return { rows: state.redeemedPromos.includes(params[1]) ? [{}] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, silver = $2, inventory = $3::jsonb')) {
                        state.stars = Number(params[0]);
                        state.silver = Number(params[1]);
                        state.inventory = JSON.parse(params[2]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, inventory = $2::jsonb')) {
                        state.stars = Number(params[0]);
                        state.inventory = JSON.parse(params[1]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, silver = $2, halloween_xp')) {
                        state.stars = params[0];
                        state.silver = params[1];
                        state.halloweenXP = params[2];
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, balance_pool_started_at')) {
                        state.stars = params[0];
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, silver = $2,')) {
                        state.stars = Number(params[0]);
                        state.silver = Number(params[1]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, silver = $2, silver_turnover = $3')) {
                        state.stars = Number(params[0]);
                        state.silver = Number(params[1]);
                        state.silverTurnover = Number(params[2]);
                        state.inventory = JSON.parse(params[3]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1, silver_turnover = $2') ||
                        statement.startsWith('UPDATE app_users SET silver = $1, silver_turnover = $2')) {
                        if (statement.startsWith('UPDATE app_users SET stars = $1,')) {
                            state.stars = Number(params[0]);
                        } else {
                            state.silver = Number(params[0]);
                        }
                        state.silverTurnover = Number(params[1]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1,') &&
                        statement.includes('silver_turnover = silver_turnover + $2')) {
                        state.stars = Number(params[0]);
                        state.silverTurnover += Number(params[1]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET silver = $1,') &&
                        statement.includes('silver_turnover = silver_turnover + $2')) {
                        state.silver = Number(params[0]);
                        state.silverTurnover += Number(params[1]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET') && statement.includes('free_case_usage')) {
                        const field = statement.includes('silver = $1') ? 'silver' : 'stars';
                        state[field] = Number(params[0]);
                        state.inventory = JSON.parse(params[1]);
                        state.collectionItems = JSON.parse(params[2]);
                        state.freeCaseUsage = JSON.parse(params[3]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1,') ||
                        statement.startsWith('UPDATE app_users SET silver = $1,')) {
                        if (statement.startsWith('UPDATE app_users SET stars = $1,')) {
                            state.stars = Number(params[0]);
                        } else {
                            state.silver = Number(params[0]);
                        }
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET inventory = $1::jsonb')) {
                        state.inventory = JSON.parse(params[0]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET')) {
                        const amount = params[0];
                        if (!state.account || state.stars < amount) return { rows: [] };
                        state.stars -= amount;
                        return { rows: [{ balance: String(state.stars) }] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        if (statement.includes("'staking:top_up'") || statement.includes("'staking:reward'")) {
                            state.ledger.push({
                                requestId: params[1],
                                operation: statement.includes("'spend'") ? 'spend' : 'earn',
                                currency: 'star',
                                amount: String(params[2]),
                                balance_after: params[3],
                                source: statement.includes("'staking:top_up'") ? 'staking:top_up' : 'staking:reward'
                            });
                            return { rows: [] };
                        }
                        if (statement.includes("'game:craft'")) {
                            state.ledger.push({
                                requestId: params[1],
                                operation: 'earn',
                                currency: params[2],
                                amount: String(params[3]),
                                balance_after: params[4]
                            });
                            return { rows: [] };
                        }
                        state.ledger.push({
                            requestId: params[1],
                            operation: statement.includes("'earn'") ? 'earn' : 'spend',
                            currency: statement.includes("'silver'") ? 'silver' : params[2],
                            amount: String(statement.includes("'earn'") ? params[2] : params[3]),
                            balance_after: statement.includes("'earn'") ? params[3] : params[4]
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO redeemed_promos')) {
                        state.redeemedPromos.push(params[1]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO daily_task_claims')) {
                        state.dailyTaskClaims.push({
                            day: params[1],
                            task_id: params[2],
                            request_id: params[3],
                            response: JSON.parse(params[4])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO withdrawal_requests')) {
                        state.withdrawalRequests.push({
                            requestId: params[1],
                            request: JSON.parse(params[5])
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO referral_joins')) {
                        state.referralJoins.push({
                            referred: params[0],
                            referrer: params[1],
                            requestId: params[2]
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO live_wins')) {
                        state.liveWins = state.liveWins || [];
                        for (let index = 0; index < params.length; index += 6) {
                            state.liveWins.unshift({
                                name: params[index + 1],
                                price: params[index + 2],
                                currency: params[index + 3],
                                caseName: params[index + 4],
                                image: params[index + 5]
                            });
                        }
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_records SET value')) {
                        state.promoRecords[params[1]] = JSON.parse(params[0]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO crash_sessions')) {
                        state.crashSessions.push({
                            session_id: params[0],
                            telegram_id: params[1],
                            bet_amount: params[2],
                            currency: params[3],
                            start_at: params[4],
                            crash_at: params[5],
                            crash_multiplier: params[6],
                            status: 'active',
                            created_at: Date.now()
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO fishing_sessions')) {
                        state.fishingSessions.push({
                            session_id: params[0],
                            telegram_id: params[1],
                            bet_amount: params[2],
                            currency: params[3],
                            step: 0,
                            status: 'active',
                            payout: 0
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE fishing_sessions SET step')) {
                        const session = state.fishingSessions.find(row => row.session_id === params[2]);
                        session.step = params[0];
                        session.status = params[1];
                        return { rows: [] };
                    }
                    if (statement.startsWith("UPDATE fishing_sessions SET status = 'won'")) {
                        const session = state.fishingSessions.find(row => row.session_id === params[1]);
                        session.status = 'won';
                        session.payout = params[0];
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        const hasOperationParameter = params.length === 5;
                        const operation = hasOperationParameter ? params[2] :
                            statement.includes("'slots_spin'") ? 'slots_spin' :
                                statement.includes("'plinko_drop'") ? 'plinko_drop' :
                                    statement.includes("'item_sell'") ? 'item_sell' :
                                    statement.includes("'shop_buy'") ? 'shop_buy' :
                                    statement.includes("'item_upgrade'") ? 'item_upgrade' :
                                        statement.includes("'bags_play'") ? 'bags_play' :
                                            statement.includes("'item_craft'") ? 'item_craft' :
                                            statement.includes("'item_save'") ? 'item_save' :
                                                statement.includes("'promo_redeem'") ? 'promo_redeem' : 'case_open';
                        const jsonParameterOffset = hasOperationParameter ? 1 : 0;
                        state.operations.push({
                            requestId: params[1],
                            operation,
                            request: JSON.parse(params[2 + jsonParameterOffset]),
                            response: JSON.parse(params[3 + jsonParameterOffset])
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

async function withServer(t, pool, env = {}) {
    const app = createApp({ pool, env: { TELEGRAM_BOT_TOKEN: botToken, ...env } });
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

test('allows admin mutation methods in CORS preflight from configured frontend origins', async t => {
    const baseUrl = await withServer(t, createTestPool(), {
        CORS_ORIGINS: 'https://lootstar.vercel.app'
    });

    for (const method of ['PATCH', 'PUT', 'DELETE']) {
        const response = await fetch(`${baseUrl}/api/v1/admin/users/12345`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://lootstar.vercel.app',
                'Access-Control-Request-Method': method,
                'Access-Control-Request-Headers': 'authorization,content-type'
            }
        });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://lootstar.vercel.app');
        assert.match(response.headers.get('access-control-allow-methods'), new RegExp(`\\b${method}\\b`));
        assert.match(response.headers.get('access-control-allow-headers'), /authorization/i);
    }
});

test('allows local file preflight only when the opaque origin is explicitly configured', async t => {
    const allowedBaseUrl = await withServer(t, createTestPool(), { CORS_ORIGINS: 'null' });
    const allowed = await fetch(`${allowedBaseUrl}/api/v1/admin/auth/login`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'null',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type'
        }
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'null');

    const deniedBaseUrl = await withServer(t, createTestPool(), { CORS_ORIGINS: 'https://lootstar.vercel.app' });
    const denied = await fetch(`${deniedBaseUrl}/api/v1/admin/auth/login`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'null',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type'
        }
    });
    assert.equal(denied.status, 403);
});

test('local admin password creates a short-lived bearer session limited to admin routes', async t => {
    const password = 'test-local-admin-password';
    const passwordHash = createAdminPasswordHash(password, Buffer.alloc(16, 7));
    const pool = createTestPool();
    const baseUrl = await withServer(t, pool, {
        ADMIN_TELEGRAM_IDS: '7534292347',
        ADMIN_PASSWORD_HASH: passwordHash
    });

    const login = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: '7534292347', password })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.equal(typeof token, 'string');

    const adminRequest = await fetch(`${baseUrl}/api/v1/admin/requests`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(adminRequest.status, 200);

    const nonAdminRequest = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(nonAdminRequest.status, 401);

    await fetch(`${baseUrl}/api/v1/admin/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
    });
    const expiredRequest = await fetch(`${baseUrl}/api/v1/admin/requests`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(expiredRequest.status, 401);
});

test('local admin login rejects invalid passwords and non-allowlisted Telegram IDs', async t => {
    const baseUrl = await withServer(t, createTestPool(), {
        ADMIN_TELEGRAM_IDS: '7534292347',
        ADMIN_PASSWORD_HASH: createAdminPasswordHash('test-local-admin-password', Buffer.alloc(16, 9))
    });
    for (const credentials of [
        { telegramId: '7534292347', password: 'wrong-password' },
        { telegramId: '12345', password: 'test-local-admin-password' }
    ]) {
        const response = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials)
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: 'INVALID_ADMIN_CREDENTIALS' });
    }
});

test('spend is atomic and idempotent; reusing the key for another operation is rejected', async t => {
    const pool = createTestPool();
    const baseUrl = await withServer(t, pool);
    const requestId = 'c0a80123-4567-489a-8abc-123456789abc';
    const headers = {
        Authorization: `tma ${makeInitData()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': requestId
    };

    const first = await fetch(`${baseUrl}/api/v1/balance/spend`, {
        method: 'POST', headers, body: JSON.stringify({ currency: 'star', amount: 10 })
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { currency: 'star', balance: '90', duplicate: false });

    const retry = await fetch(`${baseUrl}/api/v1/balance/spend`, {
        method: 'POST', headers, body: JSON.stringify({ currency: 'star', amount: 10 })
    });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { currency: 'star', balance: '90', duplicate: true });

    const conflict = await fetch(`${baseUrl}/api/v1/balance/spend`, {
        method: 'POST', headers, body: JSON.stringify({ currency: 'star', amount: 11 })
    });
    assert.equal(conflict.status, 409);
    assert.equal(pool.state.stars, 90);
    assert.equal(pool.state.ledger.length, 1);
});

test('balance ledger API returns only the authenticated user records', async t => {
    const pool = createTestPool();
    pool.state.ledger = [{
        operation: 'earn',
        currency: 'star',
        amount: '25',
        balance_after: '125',
        source: 'daily-task',
        created_at: '2026-01-01T12:00:00.000Z'
    }];
    const baseUrl = await withServer(t, pool);
    const response = await fetch(`${baseUrl}/api/v1/balance/ledger?limit=999`, {
        headers: { Authorization: `tma ${makeInitData()}` }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { entries: pool.state.ledger });
});

test('live wins API returns entries from PostgreSQL for the authenticated user', async t => {
    const pool = createTestPool();
    pool.state.liveWins = [{
        name: 'Golden Gift',
        price: 500,
        currency: 'star',
        caseName: 'Starter Case',
        image: '/images/golden-gift.png'
    }];
    const baseUrl = await withServer(t, pool);
    const response = await fetch(`${baseUrl}/api/v1/live-wins?limit=1`, {
        headers: { Authorization: `tma ${makeInitData()}` }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { wins: pool.state.liveWins });
});

test('app config API reads only explicitly allowed PostgreSQL settings', async t => {
    const pool = createTestPool({ appSettings: {
        rates: { lootStarPerTelegramStar: 1_500_000 },
        private: { token: 'not-public' }
    } });
    const baseUrl = await withServer(t, pool);
    const headers = { Authorization: `tma ${makeInitData()}` };

    const rates = await fetch(`${baseUrl}/api/v1/app-config/rates`, { headers });
    assert.equal(rates.status, 200);
    assert.deepEqual(await rates.json(), { rates: { lootStarPerTelegramStar: 1_500_000 } });

    const privateSetting = await fetch(`${baseUrl}/api/v1/app-config/private`, { headers });
    assert.equal(privateSetting.status, 404);
});

test('index shop API purchases catalog items server-side and replays idempotently', async t => {
    const pool = createTestPool({ stars: 1000 });
    const baseUrl = await withServer(t, pool);
    const headers = {
        Authorization: `tma ${makeInitData()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': '31c37f9e-6da8-4e8d-a44c-44d1f6b8165b'
    };
    const send = () => fetch(`${baseUrl}/api/v1/shop/buy`, {
        method: 'POST', headers, body: JSON.stringify({ itemName: 'Jester Hat' })
    });

    const first = await send();
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.stars, '375');
    assert.equal(result.item.name, 'Jester Hat');

    const replay = await send();
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).duplicate, true);
    assert.equal(pool.state.stars, 375);
    assert.equal(pool.state.inventory.length, 1);
});

test('case API opens using verified Telegram identity and an idempotency key', async t => {
    const pool = createTestPool({ stars: 100 });
    const baseUrl = await withServer(t, pool);
    const requestId = '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a';
    const response = await fetch(`${baseUrl}/api/v1/cases/open`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': requestId
        },
        body: JSON.stringify({ caseId: 42, quantity: 1 })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.balance, '50');
    assert.equal(result.items.length, 1);
    assert.equal(pool.state.stars, 50);
    assert.equal(pool.state.inventory.length, 1);
});

test('promo API atomically redeems a server-defined reward and replays idempotently', async t => {
    const pool = createTestPool({ stars: 100 });
    const baseUrl = await withServer(t, pool);
    const requestId = '11c37f9e-6da8-4e8d-a44c-44d1f6b8165b';
    const send = () => fetch(`${baseUrl}/api/v1/promos/redeem`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': requestId
        },
        body: JSON.stringify({ code: 'RELEASE' })
    });

    const response = await send();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.amount, 25_000);
    assert.equal(result.stars, '25100');
    assert.equal(pool.state.stars, 25100);
    assert.deepEqual(pool.state.redeemedPromos, ['RELEASE']);

    const retry = await send();
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(pool.state.stars, 25100);
});

test('custom promo API applies database-configured rewards', async t => {
    const pool = createTestPool();
    pool.state.promoRecords.COMMUNITY = {
        active: true,
        rewardType: 'currency',
        balanceField: 'silver',
        amount: 900,
        currencyLabel: 'silver',
        maxActivations: 2,
        usedCount: 0
    };
    const baseUrl = await withServer(t, pool);
    const response = await fetch(`${baseUrl}/api/v1/promos/redeem`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': '11c37f9e-6da8-4e8d-a44c-44d1f6b8165e'
        },
        body: JSON.stringify({ code: 'COMMUNITY' })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.currency, 'silver');
    assert.equal(result.silver, '900');
    assert.equal(pool.state.promoRecords.COMMUNITY.usedCount, 1);
});

test('daily tasks API returns server-derived progress and server-held XP', async t => {
    const pool = createTestPool();
    const baseUrl = await withServer(t, pool);
    const response = await fetch(`${baseUrl}/api/v1/tasks/daily`, {
        headers: { Authorization: `tma ${makeInitData()}` }
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.halloweenXP, '0');
    assert.equal(result.tasks.length, 12);
    assert.equal(result.tasks[0].progress, 0);
    assert.equal(result.tasks[0].claimed, false);
});

test('daily-task claim API only credits an eligible task and replays its saved result', async t => {
    const pool = createTestPool({ taskStats: { star_bets: '5' } });
    const baseUrl = await withServer(t, pool);
    const requestId = '11c37f9e-6da8-4e8d-a44c-44d1f6b8165c';
    const send = () => fetch(`${baseUrl}/api/v1/tasks/daily/claim`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': requestId
        },
        body: JSON.stringify({ taskId: 'star_bets_5' })
    });

    const response = await send();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).halloweenXP, '100');
    assert.equal(pool.state.stars, '25100');
    assert.equal(pool.state.dailyTaskClaims.length, 1);

    const retry = await send();
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(pool.state.stars, '25100');
});

test('withdrawal API validates and persists the server-calculated payout once', async t => {
    const pool = createTestPool({ stars: 100_000_000 });
    const baseUrl = await withServer(t, pool);
    const requestId = '11c37f9e-6da8-4e8d-a44c-44d1f6b8165d';
    const send = () => fetch(`${baseUrl}/api/v1/withdrawals`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': requestId
        },
        body: JSON.stringify({ amount: 50_000_000 })
    });

    const response = await send();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.amountTelegramStars, 25);
    assert.equal(result.stars, '50000000');
    assert.equal(pool.state.stars, '50000000');
    assert.equal(pool.state.withdrawalRequests.length, 1);
    assert.equal(pool.state.ledger.length, 1);

    const retry = await send();
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(pool.state.withdrawalRequests.length, 1);
});

test('staking API activates only an owned eligible gift and is idempotent', async t => {
    const pool = createTestPool({
        stars: 1000,
        inventory: [{ id: 'gift-1', name: 'Durov Figure', price: 1000 }]
    });
    const baseUrl = await withServer(t, pool, {
        BALANCE_POOL_SEASON_DEADLINE: '9999999999999'
    });
    const requestId = '11c37f9e-6da8-4e8d-a44c-44d1f6b8165e';
    const send = () => fetch(`${baseUrl}/api/v1/staking/operate`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': requestId
        },
        body: JSON.stringify({ action: 'activate', itemId: 'gift-1' })
    });

    const response = await send();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.inventory[0].staking.status, 'active');
    assert.equal(result.inventory[0].staking.pool, 3000);
    assert.equal(pool.state.operations[0].operation, 'staking_activate');
    assert.equal(pool.state.stars, 1000);

    const retry = await send();
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(pool.state.operations.length, 1);
});

test('referral API registers a single authenticated referral and returns its server count', async t => {
    const pool = createTestPool();
    const baseUrl = await withServer(t, pool);
    const headers = {
        Authorization: `tma ${makeInitData()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': '11c37f9e-6da8-4e8d-a44c-44d1f6b8165f'
    };
    const joined = await fetch(`${baseUrl}/api/v1/referrals/join`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ referrerId: '54321' })
    });
    assert.equal(joined.status, 200);
    assert.deepEqual(await joined.json(), { referredBy: '54321', duplicate: false });
    assert.equal(pool.state.referralJoins.length, 1);

    const profile = await fetch(`${baseUrl}/api/v1/referrals/me`, {
        headers: { Authorization: `tma ${makeInitData()}` }
    });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).referredBy, '54321');
});

test('public event config is read from PostgreSQL app settings', async t => {
    const config = {
        events: { luck2EndTime: 123456789 },
        halloween: { proPassEnabled: true, proPassNote: 'Open' }
    };
    const baseUrl = await withServer(t, createTestPool({ appSettings: config }));
    const response = await fetch(`${baseUrl}/api/v1/app-config/events`, {
        headers: { Authorization: `tma ${makeInitData()}` }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), config);
});

test('inventory save API only updates an owned item and returns PostgreSQL state', async t => {
    const pool = createTestPool({
        stars: 100,
        inventory: [{ id: 'item-1', name: 'Heart', stars: 25, saved: false }]
    });
    const baseUrl = await withServer(t, pool, {
        BALANCE_POOL_SEASON_DEADLINE: '9999999999999'
    });
    const response = await fetch(`${baseUrl}/api/v1/inventory/save`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': '66c37f9e-6da8-4e8d-a44c-44d1f6b8165c'
        },
        body: JSON.stringify({ itemId: 'item-1', saved: true })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.inventory[0].saved, true);
    assert.equal(pool.state.inventory[0].saved, true);
});

test('inventory sell API credits only server-owned inventory', async t => {
    const pool = createTestPool({ stars: 10 });
    pool.state.inventory = [{ id: 'item-1', name: 'Heart', stars: 25, currency: 'star' }];
    const baseUrl = await withServer(t, pool);
    const response = await fetch(`${baseUrl}/api/v1/inventory/sell`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a'
        },
        body: JSON.stringify({ itemIds: ['item-1'] })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.stars, '35');
    assert.equal(result.starsEarned, '25');
    assert.equal(result.inventory.length, 0);
    assert.equal(pool.state.stars, 35);
});

test('inventory upgrade API only returns a server-calculated result and replays idempotently', async t => {
    const pool = createTestPool({ stars: 10 });
    pool.state.inventory = [{
        id: 'item-source',
        name: 'Source gift',
        price: 800,
        stars: 100_000,
        image: '/shared/gift.png'
    }];
    const baseUrl = await withServer(t, pool, {
        BALANCE_POOL_SEASON_DEADLINE: '9999999999999'
    });
    const headers = {
        Authorization: `tma ${makeInitData()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': '44c37f9e-6da8-4e8d-a44c-44d1f6b8165a'
    };
    const body = JSON.stringify({
        itemId: 'item-source',
        targetName: 'Mirage Lamp (Iron Hearth)'
    });
    const response = await fetch(`${baseUrl}/api/v1/inventory/upgrade`, {
        method: 'POST', headers, body
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(typeof result.success, 'boolean');
    assert.equal('inventory' in result, true);
    assert.equal(pool.state.inventory.some(item => item.id === 'item-source'), false);

    const retry = await fetch(`${baseUrl}/api/v1/inventory/upgrade`, {
        method: 'POST', headers, body
    });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(pool.state.operations.filter(item => item.operation === 'item_upgrade').length, 1);
});

test('inventory craft API consumes server-owned items and returns its server-selected result', async t => {
    const inventory = [
        { id: 'one', name: 'One', price: 100, stars: 100, currency: 'star' },
        { id: 'two', name: 'Two', price: 200, stars: 200, currency: 'star' },
        { id: 'three', name: 'Three', price: 300, stars: 300, currency: 'star' }
    ];
    const pool = createTestPool({ stars: 10, inventory });
    const baseUrl = await withServer(t, pool, {
        BALANCE_POOL_SEASON_DEADLINE: '9999999999999'
    });
    const response = await fetch(`${baseUrl}/api/v1/inventory/craft`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': '66c37f9e-6da8-4e8d-a44c-44d1f6b8165b'
        },
        body: JSON.stringify({ itemIds: ['one', 'two', 'three'], currency: 'star' })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 600);
    assert.ok([0.5, 0.7, 1, 1.3, 1.7, 2, 2.5].includes(result.multiplier));
    assert.equal(result.payout, Math.floor(600 * result.multiplier));
    assert.equal(result.stars, String(10 + result.remainder));
    assert.deepEqual(pool.state.inventory, result.inventory);
});

test('Bags API selects and settles the outcome on the server', async t => {
    const pool = createTestPool({ stars: 1000 });
    const baseUrl = await withServer(t, pool, {
        BALANCE_POOL_SEASON_DEADLINE: '9999999999999'
    });
    const headers = {
        Authorization: `tma ${makeInitData()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': '55c37f9e-6da8-4e8d-a44c-44d1f6b8165a'
    };
    const body = JSON.stringify({ amount: 100, currency: 'star', multiplier: 500 });
    const response = await fetch(`${baseUrl}/api/v1/games/bags/open`, {
        method: 'POST', headers, body
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok([0.75, 1, 1.1, 1.5, 5].includes(result.multiplier));
    assert.equal(result.amount, 100);
    assert.equal(result.currency, 'star');
    assert.ok(result.stars >= 900);
    assert.equal(pool.state.operations[0].operation, 'bags_play');
    assert.equal(pool.state.ledger[0].operation, 'spend');

    const retry = await fetch(`${baseUrl}/api/v1/games/bags/open`, {
        method: 'POST', headers, body
    });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(pool.state.operations.filter(item => item.operation === 'bags_play').length, 1);
});

test('Fishing API starts and resumes a server-owned round without exposing the next result', async t => {
    const pool = createTestPool({ stars: 1000 });
    const baseUrl = await withServer(t, pool, {
        BALANCE_POOL_SEASON_DEADLINE: '9999999999999'
    });
    const headers = {
        Authorization: `tma ${makeInitData()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': '66c37f9e-6da8-4e8d-a44c-44d1f6b8165a'
    };
    const response = await fetch(`${baseUrl}/api/v1/games/fishing/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount: 100, currency: 'star', bustChance: 0 })
    });
    assert.equal(response.status, 200);
    const started = await response.json();
    assert.equal(started.game.step, 0);
    assert.equal(started.game.status, 'active');
    assert.equal('bustChance' in started.game, false);
    assert.equal(pool.state.stars, 900);

    const current = await fetch(`${baseUrl}/api/v1/games/fishing/current`, {
        headers: { Authorization: `tma ${makeInitData()}` }
    });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).game.gameId, started.game.gameId);
});

test('Slots API uses verified Telegram identity and returns the server-calculated result', async t => {
    const pool = createTestPool({ stars: 1000 });
    const baseUrl = await withServer(t, pool);
    const response = await fetch(`${baseUrl}/api/v1/games/slots/spin`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': '11c37f9e-6da8-4e8d-a44c-44d1f6b8165a'
        },
        body: JSON.stringify({ amount: 100, currency: 'star' })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.amount, 100);
    assert.equal(result.currency, 'star');
    assert.equal(typeof result.payout, 'number');
    assert.equal(pool.state.stars, 1000 - 100 + result.payout);
    assert.equal(pool.state.operations[0].operation, 'slots_spin');
});

test('Plinko API accepts only the stake and difficulty and returns server-selected bin', async t => {
    const pool = createTestPool({ stars: 1000 });
    const baseUrl = await withServer(t, pool);
    const response = await fetch(`${baseUrl}/api/v1/games/plinko/drop`, {
        method: 'POST',
        headers: {
            Authorization: `tma ${makeInitData()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': '22c37f9e-6da8-4e8d-a44c-44d1f6b8165a'
        },
        body: JSON.stringify({ amount: 100, currency: 'star', difficulty: 'medium' })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.amount, 100);
    assert.equal(result.difficulty, 'medium');
    assert.ok(result.binIndex >= 0 && result.binIndex < 13);
    assert.equal(pool.state.stars, 1000 - 100 + result.payout);
    assert.equal(pool.state.operations[0].operation, 'plinko_drop');
});

test('Crash API stores a private round and resumes it for the authenticated user', async t => {
    const pool = createTestPool({ stars: 1000 });
    const baseUrl = await withServer(t, pool);
    const headers = {
        Authorization: `tma ${makeInitData()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': '33c37f9e-6da8-4e8d-a44c-44d1f6b8165a'
    };
    const start = await fetch(`${baseUrl}/api/v1/games/crash/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount: 100, currency: 'star' })
    });
    assert.equal(start.status, 200);
    const started = await start.json();
    assert.equal(started.game.phase, 'waiting');
    assert.equal('crashMultiplier' in started.game, false);
    assert.equal(pool.state.stars, 900);

    const current = await fetch(`${baseUrl}/api/v1/games/crash/current`, {
        headers: { Authorization: `tma ${makeInitData()}` }
    });
    assert.equal(current.status, 200);
    const resumed = await current.json();
    assert.equal(resumed.game.gameId, started.game.gameId);
    assert.equal('crashMultiplier' in resumed.game, false);
});

test('leaderboard API requires Telegram auth and validates the requested sort', async t => {
    const baseUrl = await withServer(t, createTestPool(), {
        BALANCE_POOL_SEASON_DEADLINE: '9999999999999'
    });
    const headers = { Authorization: `tma ${makeInitData()}` };
    const response = await fetch(`${baseUrl}/api/v1/leaderboard?sort=silver`, { headers });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.users, []);
    assert.equal(result.myDocId, 'id_12345');

    const invalid = await fetch(`${baseUrl}/api/v1/leaderboard?sort=firestore`, { headers });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'INVALID_LEADERBOARD_SORT' });
});

test('rejects unauthenticated requests and unimported accounts', async t => {
    const baseUrl = await withServer(t, createTestPool({ account: false }));
    const unauthenticated = await fetch(`${baseUrl}/api/v1/me`);
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { Authorization: `tma ${makeInitData()}` }
    });

    test('phone operation endpoint requires a unique operation and rejects unknown actions', async t => {
        const baseUrl = await withServer(t, createTestPool());
        const response = await fetch(`${baseUrl}/api/v1/profile/phone/operate`, {
            method: 'POST',
            headers: {
                Authorization: `tma ${makeInitData()}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': '21c37f9e-6da8-4e8d-a44c-44d1f6b81610'
            },
            body: JSON.stringify({ action: 'credit', amount: 1000000 })
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'INVALID_PHONE_REQUEST' });
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'ACCOUNT_NOT_MIGRATED' });
});

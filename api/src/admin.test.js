'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('./app');

const botToken = 'admin-test-bot-token';

function makeInitData(id) {
    const values = new Map([
        ['auth_date', String(Math.floor(Date.now() / 1000))],
        ['user', JSON.stringify({ id, first_name: 'Admin' })]
    ]);
    const checkString = [...values.entries()]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    values.set('hash', crypto.createHmac('sha256', secret).update(checkString).digest('hex'));
    return new URLSearchParams(values).toString();
}

async function startTestServer(t, env = {}, pool) {
    const database = pool || {
        async query() {
            return { rows: [] };
        },
        async connect() {
            throw new Error('Unexpected database connection');
        }
    };
    const app = createApp({ pool: database, env: { TELEGRAM_BOT_TOKEN: botToken, ...env } });
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

function createWithdrawalPool() {
    const state = {
        stars: '100',
        status: 'pending',
        note: null,
        ledger: [],
        audit: [],
        commits: 0,
        rollbacks: 0
    };
    const withdrawal = {
        telegram_id: '12345',
        request_id: '550e8400-e29b-41d4-a716-446655440000',
        amount_loot_star: '30',
        amount_telegram_stars: '25',
        rate_loot_star_per_telegram_star: '1',
        status: state.status,
        request: {},
        admin_note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        username: 'test_user',
        first_name: 'Test',
        last_name: ''
    };
    return {
        state,
        async query(sql, params = []) {
            if (sql.includes('FROM withdrawal_requests w')) {
                return { rows: params[0] === 'all' || params[0] === state.status ? [{ ...withdrawal, status: state.status }] : [] };
            }
            return { rows: [] };
        },
        async connect() {
            return {
                async query(sql, params = []) {
                    const statement = sql.trimStart();
                    if (statement === 'BEGIN') return { rows: [] };
                    if (statement === 'COMMIT') {
                        state.commits += 1;
                        return { rows: [] };
                    }
                    if (statement === 'ROLLBACK') {
                        state.rollbacks += 1;
                        return { rows: [] };
                    }
                    if (statement.startsWith('SELECT amount_loot_star')) {
                        return state.status === 'pending' ? { rows: [{
                            amount_loot_star: '30',
                            amount_telegram_stars: '25',
                            status: state.status,
                            request: {}
                        }] } : { rows: [{
                            amount_loot_star: '30',
                            amount_telegram_stars: '25',
                            status: state.status,
                            request: {}
                        }] };
                    }
                    if (statement.startsWith('SELECT stars, silver, inventory, balance_pool_started_at')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: '0',
                            inventory: [],
                            balance_pool_started_at: 0,
                            balance_pool_start_value: 0,
                            balance_pool_escrow_value: 0
                        }] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars =')) {
                        state.stars = params[0];
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ amount: params[2], balanceAfter: params[3], source: 'withdrawal:refund' });
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE withdrawal_requests SET status =')) {
                        state.status = params[0];
                        state.note = params[1] || null;
                        withdrawal.status = state.status;
                        withdrawal.admin_note = state.note;
                        return { rows: [{
                            telegram_id: withdrawal.telegram_id,
                            request_id: withdrawal.request_id,
                            amount_loot_star: withdrawal.amount_loot_star,
                            amount_telegram_stars: withdrawal.amount_telegram_stars,
                            status: state.status,
                            request: { status: state.status }
                        }] };
                    }
                    if (statement.startsWith('INSERT INTO admin_audit_logs')) {
                        state.audit.push({ action: params[1], subject: params[3], details: params[4] });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected admin database query: ${statement}`);
                },
                release() {}
            };
        }
    };
}

test('allows only IDs in the server-side admin allowlist', async t => {
    const baseUrl = await startTestServer(t, { ADMIN_TELEGRAM_IDS: '7534292347, 55555' });
    const allowed = await fetch(`${baseUrl}/api/v1/admin/requests?limit=1`, {
        headers: { Authorization: `tma ${makeInitData(7534292347)}` }
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual((await allowed.json()).recent, []);

    const denied = await fetch(`${baseUrl}/api/v1/admin/requests`, {
        headers: { Authorization: `tma ${makeInitData(12345)}` }
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'ADMIN_ACCESS_DENIED' });
});

test('fails closed when no administrator is configured', async t => {
    const baseUrl = await startTestServer(t);
    const response = await fetch(`${baseUrl}/api/v1/admin/overview`, {
        headers: { Authorization: `tma ${makeInitData(7534292347)}` }
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'ADMIN_ACCESS_NOT_CONFIGURED' });
});

test('admin can list withdrawals and reject one with an atomic balance refund', async t => {
    const pool = createWithdrawalPool();
    const baseUrl = await startTestServer(t, { ADMIN_TELEGRAM_IDS: '7534292347' }, pool);
    const headers = { Authorization: `tma ${makeInitData(7534292347)}`, 'Content-Type': 'application/json' };
    const listResponse = await fetch(`${baseUrl}/api/v1/admin/withdrawals?status=pending`, { headers });
    assert.equal(listResponse.status, 200);
    assert.equal((await listResponse.json()).withdrawals.length, 1);

    const path = '/api/v1/admin/withdrawals/12345/550e8400-e29b-41d4-a716-446655440000';
    const rejectResponse = await fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'rejected', note: 'Недоступна выплата' })
    });
    assert.equal(rejectResponse.status, 200);
    assert.deepEqual(await rejectResponse.json(), {
        withdrawal: {
            telegram_id: '12345',
            request_id: '550e8400-e29b-41d4-a716-446655440000',
            amount_loot_star: '30',
            amount_telegram_stars: '25',
            status: 'rejected',
            request: { status: 'rejected' }
        },
        refunded: true
    });
    assert.equal(pool.state.stars, '130');
    assert.equal(pool.state.ledger.length, 1);
    assert.equal(pool.state.ledger[0].source, 'withdrawal:refund');
    assert.equal(pool.state.audit.length, 1);
    assert.equal(pool.state.commits, 1);

    const duplicateResponse = await fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'rejected' })
    });
    assert.equal(duplicateResponse.status, 409);
    assert.equal(pool.state.stars, '130');
    assert.equal(pool.state.ledger.length, 1);
});

test('marking a withdrawal paid does not change the balance', async t => {
    const pool = createWithdrawalPool();
    const baseUrl = await startTestServer(t, { ADMIN_TELEGRAM_IDS: '7534292347' }, pool);
    const response = await fetch(
        `${baseUrl}/api/v1/admin/withdrawals/12345/550e8400-e29b-41d4-a716-446655440000`,
        {
            method: 'PATCH',
            headers: {
                Authorization: `tma ${makeInitData(7534292347)}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'paid' })
        }
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).refunded, false);
    assert.equal(pool.state.stars, '100');
    assert.equal(pool.state.ledger.length, 0);
    assert.equal(pool.state.status, 'paid');
});

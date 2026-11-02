'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { joinReferral, loadReferralProfile } = require('./referrals');

const requestId = '21c37f9e-6da8-4e8d-a44c-44d1f6b8165a';

function createPool() {
    const state = {
        users: new Set(['12345', '54321', '67890']),
        joins: []
    };
    return {
        state,
        async query(sql, params = []) {
            if (sql.includes('FROM referral_joins')) {
                return { rows: [{
                    joined_count: String(state.joins.filter(join => join.referrer === params[0]).length),
                    referred_by: state.joins.find(join => join.referred === params[0])?.referrer || null
                }] };
            }
            return { rows: [] };
        },
        async connect() {
            return {
                async query(sql, params = []) {
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
                    if (sql.startsWith('SELECT banned FROM app_users')) {
                        return state.users.has(params[0]) ? { rows: [{ banned: false }] } : { rows: [] };
                    }
                    if (sql.startsWith('SELECT referrer_telegram_id, request_id')) {
                        const join = state.joins.find(row => row.referred === params[0]);
                        return { rows: join ? [{
                            referrer_telegram_id: join.referrer,
                            request_id: join.requestId
                        }] : [] };
                    }
                    if (sql.startsWith('SELECT telegram_id, banned FROM app_users')) {
                        return state.users.has(params[0])
                            ? { rows: [{ telegram_id: params[0], banned: false }] }
                            : { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO referral_joins')) {
                        state.joins.push({
                            referred: params[0],
                            referrer: params[1],
                            requestId: params[2]
                        });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected SQL in referral test: ${sql}`);
                },
                release() {}
            };
        }
    };
}

test('a Telegram account can attach one existing referrer exactly once', async () => {
    const pool = createPool();
    const input = {
        pool,
        telegramId: '12345',
        requestId,
        referrerId: '54321'
    };
    assert.deepEqual(await joinReferral(input), { referredBy: '54321', duplicate: false });
    assert.deepEqual(await joinReferral(input), { referredBy: '54321', duplicate: true });
    assert.equal(pool.state.joins.length, 1);
    assert.deepEqual(await loadReferralProfile({ pool, telegramId: '54321' }), {
        referralCode: '54321',
        joinedCount: '1',
        referredBy: null
    });
    assert.deepEqual(await loadReferralProfile({ pool, telegramId: '12345' }), {
        referralCode: '12345',
        joinedCount: '0',
        referredBy: '54321'
    });
});

test('referral linking rejects self-referrals, invalid IDs, unknown referrers, and second referrers', async () => {
    const pool = createPool();
    await assert.rejects(() => joinReferral({
        pool, telegramId: '12345', requestId, referrerId: '12345'
    }), { code: 'SELF_REFERRAL' });
    await assert.rejects(() => joinReferral({
        pool, telegramId: '12345', requestId, referrerId: 'not-an-id'
    }), { code: 'INVALID_REFERRAL' });
    await assert.rejects(() => joinReferral({
        pool, telegramId: '12345', requestId, referrerId: '99999'
    }), { code: 'REFERRER_NOT_FOUND' });

    await joinReferral({ pool, telegramId: '12345', requestId, referrerId: '54321' });
    await assert.rejects(() => joinReferral({
        pool,
        telegramId: '12345',
        requestId: '21c37f9e-6da8-4e8d-a44c-44d1f6b8165b',
        referrerId: '67890'
    }), { code: 'REFERRAL_ALREADY_SET' });
    assert.equal(pool.state.joins.length, 1);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { submitWithdrawal } = require('./withdrawals');

const requestId = '31c37f9e-6da8-4e8d-a44c-44d1f6b8165a';

function createPool({ stars = '100000000', rates, banned = false } = {}) {
    const state = { stars, rates, banned, requests: [], ledger: [] };
    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
                    if (sql.includes('FROM app_users')) {
                        return { rows: [{
                            telegram_id: '12345',
                            username: 'test_user',
                            first_name: 'Test',
                            last_name: '',
                            stars: state.stars,
                            silver: '50',
                            inventory: [],
                            banned: state.banned,
                            balance_pool_started_at: 1_000,
                            balance_pool_start_value: 0,
                            balance_pool_escrow_value: 0
                        }] };
                    }
                    if (sql.includes('FROM withdrawal_requests')) {
                        const request = state.requests.find(item => item.requestId === params[1]);
                        return { rows: request ? [{ request }] : [] };
                    }
                    if (sql.includes('FROM app_settings')) {
                        return { rows: state.rates ? [{ value: state.rates }] : [] };
                    }
                    if (sql.startsWith('UPDATE app_users SET stars = $1')) {
                        state.stars = params[0];
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ requestId: params[1], amount: params[2], balance: params[3] });
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO withdrawal_requests')) {
                        const request = JSON.parse(params[5]);
                        state.requests.push({ requestId: params[1], amountLootStar: params[2], request });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected SQL in test: ${sql}`);
                },
                release() {}
            };
        }
    };
}

test('withdrawal uses server rates, deducts balance, and persists the payout request atomically', async () => {
    const pool = createPool({
        stars: '100000000',
        rates: { lootStarPerTelegramStar: 2_000_000, minWithdrawTelegramStars: 25 }
    });
    const input = { pool, telegramId: '12345', requestId, amount: 50_000_000 };
    const first = await submitWithdrawal(input);
    const replay = await submitWithdrawal(input);
    assert.equal(first.amountTelegramStars, 25);
    assert.equal(first.username, 'test_user');
    assert.equal(first.stars, '50000000');
    assert.equal(replay.duplicate, true);
    assert.equal(pool.state.stars, '50000000');
    assert.equal(pool.state.requests.length, 1);
    assert.equal(pool.state.ledger.length, 1);
});

test('withdrawal rejects invalid amounts, insufficient funds, and amounts outside server limits', async () => {
    const pool = createPool();
    await assert.rejects(() => submitWithdrawal({
        pool, telegramId: '12345', requestId, amount: 10
    }), { code: 'WITHDRAWAL_BELOW_MINIMUM' });
    await assert.rejects(() => submitWithdrawal({
        pool, telegramId: '12345', requestId, amount: 202_000_000_000
    }), { code: 'WITHDRAWAL_ABOVE_MAXIMUM' });
    await assert.rejects(() => submitWithdrawal({
        pool, telegramId: '12345', requestId, amount: 200_000_000
    }), { code: 'INSUFFICIENT_FUNDS' });
    await assert.rejects(() => submitWithdrawal({
        pool, telegramId: '12345', requestId, amount: 1.5
    }), { code: 'INVALID_WITHDRAWAL' });
    assert.equal(pool.state.requests.length, 0);
    assert.equal(pool.state.ledger.length, 0);
});

test('withdrawal rejects banned accounts and detects idempotency-key reuse', async () => {
    const pool = createPool({ stars: '200000000' });
    await submitWithdrawal({
        pool, telegramId: '12345', requestId, amount: 50_000_000
    });
    await assert.rejects(() => submitWithdrawal({
        pool, telegramId: '12345', requestId, amount: 60_000_000
    }), { code: 'IDEMPOTENCY_KEY_REUSED' });

    const bannedPool = createPool({ banned: true });
    await assert.rejects(() => submitWithdrawal({
        pool: bannedPool, telegramId: '12345', requestId, amount: 50_000_000
    }), { code: 'ACCOUNT_BANNED' });
});

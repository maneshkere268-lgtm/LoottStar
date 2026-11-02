'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { operateHalloween } = require('./halloween-event');

const now = Date.parse('2026-11-02T00:00:00Z');
const requestId = suffix => `29fca7f2-5d81-4a2d-bf23-7e00a2b9${String(suffix).padStart(4, '0')}`;

function createPool({
    stars = '1000',
    silver = '0',
    pumpkins = '1000',
    xp = '0',
    state = {},
    proPassEnabled = false
} = {}) {
    const user = {
        stars,
        silver,
        inventory: [],
        collection_items: [],
        banned: false,
        halloween_xp: xp,
        halloween_pumpkins: pumpkins,
        halloween_state: state,
        balance_pool_started_at: now - 1000,
        balance_pool_start_value: Number(stars),
        balance_pool_escrow_value: 0
    };
    const operations = new Map();
    const ledger = [];
    return {
        state: { user, operations, ledger },
        async connect() {
            return {
                async query(sql, params = []) {
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
                    if (sql.includes('FROM app_users WHERE telegram_id')) {
                        return { rows: [structuredClone(user)] };
                    }
                    if (sql.includes('FROM halloween_operations')) {
                        const operation = operations.get(params[1]);
                        return { rows: operation ? [structuredClone(operation)] : [] };
                    }
                    if (sql.includes("FROM app_settings WHERE setting_key = 'halloween'")) {
                        return { rows: [{ value: { proPassEnabled } }] };
                    }
                    if (sql.startsWith('UPDATE app_users SET stars = $1, silver = $2, inventory')) {
                        user.stars = params[0];
                        user.silver = params[1];
                        user.inventory = JSON.parse(params[2]);
                        user.halloween_pumpkins = params[3];
                        user.halloween_state = JSON.parse(params[4]);
                        user.collection_items = JSON.parse(params[5]);
                        user.balance_pool_started_at = params[6];
                        user.balance_pool_start_value = params[7];
                        user.balance_pool_escrow_value = params[8];
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO halloween_operations')) {
                        operations.set(params[1], {
                            action: params[2],
                            request: JSON.parse(params[3]),
                            response: JSON.parse(params[4])
                        });
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO balance_ledger')) {
                        ledger.push(params);
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected Halloween SQL: ${sql}`);
                },
                release() {}
            };
        }
    };
}

test('Halloween case outcome and pumpkin debit are server-owned and replay-safe', async () => {
    const pool = createPool();
    const input = {
        pool, telegramId: '12345', requestId: requestId('001'), action: 'case_open',
        caseId: 'pumpkin', now, random: () => 0
    };
    const first = await operateHalloween(input);
    const duplicate = await operateHalloween(input);
    assert.equal(first.reward.name, 'Mad Pumpkin (Pumpkin)');
    assert.equal(first.pumpkins, '850');
    assert.equal(duplicate.duplicate, true);
    assert.equal(pool.state.user.inventory.length, 1);
});

test('Halloween wheel enforces server cooldown and records star winnings', async () => {
    const pool = createPool({ state: { spinLastUsed: now - 4 * 60 * 60 * 1000 } });
    const result = await operateHalloween({
        pool, telegramId: '12345', requestId: requestId('002'), action: 'wheel_spin',
        now, random: () => 0.842
    });
    assert.deepEqual(result.reward, { type: 'stars', amount: 10_000_000 });
    assert.equal(result.stars, '10001000');
    assert.equal(pool.state.ledger.length, 1);
    await assert.rejects(() => operateHalloween({
        pool, telegramId: '12345', requestId: requestId('003'), action: 'wheel_spin',
        now: now + 1000
    }), { code: 'HALLOWEEN_WHEEL_COOLDOWN' });
});

test('Halloween pass claims validate XP, pro access, and cannot be claimed twice', async () => {
    const pool = createPool({ xp: '1500' });
    const input = {
        pool, telegramId: '12345', requestId: requestId('004'), action: 'pass_claim',
        passType: 'free', rewardIndex: 0, now
    };
    const result = await operateHalloween(input);
    assert.equal(result.silver, '10000');
    assert.deepEqual(result.state.passClaims, ['free:0']);
    await assert.rejects(() => operateHalloween({
        ...input, requestId: requestId('005')
    }), { code: 'HALLOWEEN_REWARD_CLAIMED' });
    await assert.rejects(() => operateHalloween({
        pool: createPool({ xp: '100000' }), telegramId: '12345',
        requestId: requestId('006'), action: 'pass_claim',
        passType: 'pro', rewardIndex: 49, now
    }), { code: 'HALLOWEEN_PRO_PASS_DISABLED' });
});

test('Halloween treat accrual uses server timestamps and cannot be replayed for extra pumpkins', async () => {
    const pool = createPool();
    await operateHalloween({
        pool, telegramId: '12345', requestId: requestId('007'), action: 'treat_start', now
    });
    const stopped = await operateHalloween({
        pool, telegramId: '12345', requestId: requestId('008'), action: 'treat_stop',
        now: now + 2 * 60 * 60 * 1000
    });
    assert.equal(stopped.state.treatStreakMs, 2 * 60 * 60 * 1000);
    assert.equal(stopped.state.treatAccrued, 2910);
    const claimed = await operateHalloween({
        pool, telegramId: '12345', requestId: requestId('009'), action: 'treat_claim',
        now: now + 2 * 60 * 60 * 1000
    });
    assert.equal(claimed.amount, 2910);
    await assert.rejects(() => operateHalloween({
        pool, telegramId: '12345', requestId: requestId('010'), action: 'treat_claim',
        now: now + 2 * 60 * 60 * 1000
    }), { code: 'HALLOWEEN_TREAT_NOT_READY' });
});

test('pumpkin-only operations do not consume or become blocked by the star asset pool', async () => {
    const pool = createPool({
        stars: '100',
        pumpkins: '1000',
        state: { spinLastUsed: now - 4 * 60 * 60 * 1000 },
        xp: '0'
    });
    pool.state.user.balance_pool_started_at = now - 1000;
    pool.state.user.balance_pool_start_value = 0;
    const result = await operateHalloween({
        pool, telegramId: '12345', requestId: requestId('011'), action: 'wheel_spin',
        now, random: () => 0
    });
    assert.equal(result.pumpkins, '1250');
});

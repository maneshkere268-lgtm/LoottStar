'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPoolMutation, getAssetValue, getPoolWindow } = require('./balance-pool');

const now = Date.parse('2026-11-01T12:00:00Z');

function account(overrides = {}) {
    return {
        stars: '100',
        silver: '0',
        inventory: [],
        balance_pool_started_at: now - 60_000,
        balance_pool_start_value: 100,
        balance_pool_escrow_value: 0,
        ...overrides
    };
}

test('asset value counts balances, inventory, and silver in the configured units', () => {
    assert.equal(getAssetValue({
        stars: 100,
        silver: 100,
        inventory: [
            { stars: 50, currency: 'star' },
            { value: 100, currency: 'silver' }
        ],
        balance_pool_escrow_value: 25
    }), 195);
});

test('pool window starts at the current asset value and rolls after a day', () => {
    const fresh = getPoolWindow(account({ balance_pool_started_at: 0 }), now, {
        limit: 750_000_000,
        windowMs: 86_400_000
    });
    assert.equal(fresh.startedAt, now);
    assert.equal(fresh.startValue, 100);

    const expired = getPoolWindow(account({
        balance_pool_started_at: now - 86_400_000,
        balance_pool_start_value: 0
    }), now, { limit: 750_000_000, windowMs: 86_400_000 });
    assert.equal(expired.startedAt, now);
    assert.equal(expired.startValue, 100);
    assert.equal(expired.earned, 0);
});

test('pool permits the exact limit but rejects value above it and further changes', () => {
    const current = account();
    const atLimit = {
        ...current,
        inventory: [{ stars: 750_000_000, currency: 'star' }]
    };
    assert.equal(applyPoolMutation(current, atLimit, { now }).balance_pool_started_at, current.balance_pool_started_at);

    assert.throws(() => applyPoolMutation(current, {
        ...current,
        inventory: [{ stars: 750_000_001, currency: 'star' }]
    }, { now }), { code: 'BALANCE_POOL_LIMIT' });

    assert.throws(() => applyPoolMutation(atLimit, {
        ...atLimit,
        inventory: [...atLimit.inventory, { stars: 1, currency: 'star' }]
    }, { now }), { code: 'BALANCE_POOL_EXHAUSTED' });
});

test('season deadline blocks inventory and balance reductions', () => {
    const current = account();
    const deadline = now - 1;
    assert.throws(() => applyPoolMutation(current, {
        ...current,
        inventory: [{ stars: 1, currency: 'star' }]
    }, { now, env: { BALANCE_POOL_SEASON_DEADLINE: String(deadline) } }), {
        code: 'BALANCE_SEASON_LOCKED'
    });

    test('escrowing and returning trade assets preserves pool value and permits refunds after deadline', () => {
        const current = account();
        const escrowed = applyPoolMutation(current, {
            ...current,
            stars: '50'
        }, { now, escrowValueDelta: 50 });
        assert.equal(escrowed.balance_pool_escrow_value, 50);

        const returned = applyPoolMutation({
            ...current,
            stars: '50',
            balance_pool_escrow_value: escrowed.balance_pool_escrow_value
        }, {
            ...current,
            stars: '100'
        }, {
            now,
            allowSeasonReturn: true,
            escrowValueDelta: -50,
            env: { BALANCE_POOL_SEASON_DEADLINE: String(now - 1) }
        });
        assert.equal(returned.balance_pool_escrow_value, 0);
    });
});

'use strict';

const DEFAULT_LIMIT = 750_000_000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEASON_DEADLINE = Date.parse('2026-12-01T00:00:00+03:00');

class BalancePoolError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
        this.status = 409;
    }
}

function getConfig(env = process.env) {
    return {
        limit: Number(env.BALANCE_POOL_LIMIT) || DEFAULT_LIMIT,
        windowMs: Number(env.BALANCE_POOL_WINDOW_MS) || DEFAULT_WINDOW_MS,
        seasonDeadline: Number(env.BALANCE_POOL_SEASON_DEADLINE) || DEFAULT_SEASON_DEADLINE
    };
}

function getAssetValue(data) {
    const stars = Math.max(0, Number(data.stars) || 0);
    const silver = Math.max(0, Number(data.silver) || 0) / 10;
    const inventory = Array.isArray(data.inventory) ? data.inventory : [];
    const itemValue = inventory.reduce((total, item) => {
        const isSilver = item?.currency === 'silver';
        const defaultValue = (Number(item?.price) || 0) * (isSilver ? 1 : 125);
        const rawValue = Number(item?.stars || item?.value || defaultValue);
        if (!Number.isFinite(rawValue) || rawValue <= 0) return total;
        return total + rawValue / (isSilver ? 10 : 1);
    }, 0);
    const escrowValue = Math.max(0, Number(data.balance_pool_escrow_value) || 0);
    return Math.floor(stars + silver + itemValue + escrowValue);
}

function getPoolWindow(data, now, config) {
    const currentValue = getAssetValue(data);
    let startedAt = Number(data.balance_pool_started_at);
    let startValue = Number(data.balance_pool_start_value);
    if (!Number.isSafeInteger(startedAt) || startedAt <= 0 || startedAt > now) {
        startedAt = now;
        startValue = currentValue;
    } else if (now >= startedAt + config.windowMs) {
        const windowsElapsed = Math.floor((now - startedAt) / config.windowMs);
        startedAt += windowsElapsed * config.windowMs;
        startValue = currentValue;
    }
    if (!Number.isFinite(startValue) || startValue < 0) startValue = currentValue;
    const earned = Math.max(0, Math.min(config.limit, currentValue - startValue));
    return {
        startedAt,
        startValue,
        earned,
        exhausted: earned >= config.limit
    };
}

function applyPoolMutation(current, next, {
    now = Date.now(), env = process.env, escrowValueDelta = 0, allowSeasonReturn = false
} = {}) {
    const config = getConfig(env);
    const inventoryChanged = JSON.stringify(current.inventory || []) !== JSON.stringify(next.inventory || []);
    const starsReduced = Number(next.stars) < (Number(current.stars) || 0);
    const silverReduced = Number(next.silver) < (Number(current.silver) || 0);
    if (now >= config.seasonDeadline &&
        (inventoryChanged || starsReduced || silverReduced) && !allowSeasonReturn) {
        throw new BalancePoolError('BALANCE_SEASON_LOCKED');
    }

    const pool = getPoolWindow(current, now, config);
    if (pool.exhausted && !allowSeasonReturn) throw new BalancePoolError('BALANCE_POOL_EXHAUSTED');

    const currentEscrow = Number(current.balance_pool_escrow_value) || 0;
    const nextEscrow = currentEscrow + Number(escrowValueDelta);
    if (!Number.isSafeInteger(nextEscrow) || nextEscrow < 0) {
        throw new BalancePoolError('INVALID_BALANCE_POOL_ESCROW');
    }
    const afterValue = getAssetValue({
        ...current,
        ...next,
        balance_pool_escrow_value: nextEscrow
    });
    const earned = Math.max(0, afterValue - pool.startValue);
    if (earned > config.limit) throw new BalancePoolError('BALANCE_POOL_LIMIT');

    return {
        balance_pool_started_at: pool.startedAt,
        balance_pool_start_value: pool.startValue,
        balance_pool_escrow_value: nextEscrow,
        balance_pool_earned: earned,
        balance_pool_exhausted: earned >= config.limit
    };
}

module.exports = {
    BalancePoolError,
    applyPoolMutation,
    getAssetValue,
    getConfig,
    getPoolWindow
};

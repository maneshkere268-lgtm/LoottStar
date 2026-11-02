'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const EVENT_END = Date.parse('2026-11-15T00:00:00Z');
const SPIN_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const MAX_TREAT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const TREAT_BATCH = 15;
const TREAT_TIERS = [
    { from: 0, rate: 15 },
    { from: 30 * 60_000, rate: 22 },
    { from: 60 * 60_000, rate: 30 }
];
const CASES = Object.freeze({
    pumpkin: {
        price: 150,
        items: [
            { name: 'Mad Pumpkin (Pumpkin)', price: 232417, chance: 66.5 },
            { name: 'Hex Pot (Halloween Brew)', price: 614591, chance: 20 },
            { name: 'Voodoo Doll (Pumpkin)', price: 34489, chance: 10 },
            { name: 'Jack-in-the-Box (Haunted House)', price: 3748095, chance: 2.5 },
            { name: 'Skull Flower (Ghost Rider)', price: 10587176, chance: 1 }
        ]
    },
    witch: {
        price: 600,
        items: [
            { name: 'Witch Hat (Cobweb)', price: 150705, chance: 70.75 },
            { name: 'Scared Cat (Salem)', price: 989334, chance: 20 },
            { name: 'Evil Eye (Monster Mash)', price: 2556496, chance: 7 },
            { name: 'Spy Agaric (Nosferatu)', price: 9932278, chance: 1.75 },
            { name: 'Crystal Ball (Samhain)', price: 28301680, chance: 0.5 }
        ]
    },
    graveyard: {
        price: 2000,
        items: [
            { name: 'Electric Skull (Graveyard)', price: 1882093, chance: 60 },
            { name: 'Voodoo Doll (Dark Side)', price: 2857431, chance: 30 },
            { name: 'Trapped Heart (Undead Beat)', price: 6457349, chance: 7 },
            { name: 'Jack-in-the-Box (Tombstone)', price: 36082390, chance: 2.5 },
            { name: 'Skull Flower (Nightshade)', price: 269557495, chance: 0.5 }
        ]
    },
    haunted: {
        price: 6666,
        items: [
            { name: 'Jack-in-the-Box (Night Terror)', price: 37093, chance: 99.999 },
            { name: 'Sharp Tongue (Zombie Bite)', price: 246944444, chance: 0.001 }
        ]
    }
});
const WHEEL = Object.freeze([
    { percent: 22, type: 'pumpkins', amount: 250 },
    { percent: 62, type: 'pumpkins', amount: 100 },
    { percent: 0.5, type: 'stars', amount: 10_000_000 },
    { percent: 1.5, type: 'pumpkins', amount: 2500 },
    { percent: 4, type: 'pumpkins', amount: 1000 },
    { percent: 10, type: 'pumpkins', amount: 500 }
]);
const BREWS = Object.freeze({
    luck2: { price: 7500, durationMs: 60 * 60_000 },
    luck4: { price: 25000, durationMs: 3 * 60 * 60_000 },
    blessing: { price: 9500, durationMs: 2 * 60 * 60_000 }
});
const BASE_REWARDS = [
    { type: 'silver', amount: 10000 },
    { type: 'pumpkins', amount: 250 },
    { type: 'stars', amount: 1000000 },
    { type: 'luck2', duration: 15 },
    { type: 'stars', amount: 2500000 },
    { type: 'luck4', duration: 5 },
    { type: 'pumpkins', amount: 500 },
    { type: 'blessing', duration: 15 },
    { type: 'gift', name: 'Plush Pepe', price: 828750 },
    { type: 'silver', amount: 25000 }
];
const PASS_REWARDS = Array.from({ length: 50 }, (_, index) => {
    if (index === 49) return { xp: 100000, type: 'stars', amount: 150000000 };
    const reward = BASE_REWARDS[index % BASE_REWARDS.length];
    return {
        ...reward,
        xp: (index + 1) * 1500,
        amount: reward.amount ? Math.floor(reward.amount * (1 + index * 0.2)) : undefined
    };
});
const PRO_PASS_REWARDS = PASS_REWARDS.map((reward, index) => index === 49
    ? { xp: 100000, type: 'stars', amount: 500000000 }
    : {
        ...BASE_REWARDS[index % BASE_REWARDS.length],
        xp: (index + 1) * 1500,
        amount: BASE_REWARDS[index % BASE_REWARDS.length].amount
            ? Math.floor(BASE_REWARDS[index % BASE_REWARDS.length].amount * 3)
            : undefined
    });

function eventError(error) {
    if (error instanceof BalancePoolError) return new OperationError(error.status, error.code);
    return error;
}

function normalizeState(value) {
    const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        spinLastUsed: Number.isSafeInteger(Number(state.spinLastUsed)) ? Number(state.spinLastUsed) : 0,
        treatStreakMs: Math.max(0, Number(state.treatStreakMs) || 0),
        treatAccrued: Math.max(0, Number(state.treatAccrued) || 0),
        treatHiddenSince: state.treatHiddenSince !== null && state.treatHiddenSince !== undefined &&
            Number.isSafeInteger(Number(state.treatHiddenSince))
            ? Number(state.treatHiddenSince) : null,
        passClaims: Array.isArray(state.passClaims) ? state.passClaims.filter(
            claim => typeof claim === 'string' && /^(free|pro):\d{1,2}$/.test(claim)
        ) : [],
        activeBrews: Array.isArray(state.activeBrews) ? state.activeBrews.filter(
            brew => brew && typeof brew.type === 'string' && Number.isSafeInteger(brew.endsAt)
        ) : []
    };
}

function roulettePick(entries, random) {
    const total = entries.reduce((sum, entry) => sum + entry.chance, 0);
    const draw = random() * total;
    let accumulated = 0;
    for (const entry of entries) {
        accumulated += entry.chance;
        if (draw < accumulated) return entry;
    }
    return entries[entries.length - 1];
}

function itemImage(name) {
    const match = name.match(/^(.+?)\s*\((.+)\)\s*$/);
    const giftName = match ? match[1].trim() : name.trim();
    const modelName = match ? match[2].trim() : 'Original';
    return `https://api.changes.tg/model/${encodeURIComponent(giftName)}/${encodeURIComponent(modelName)}.png`;
}

function rewardItem(name, price, now) {
    return {
        id: `item_${randomUUID()}`,
        name,
        price,
        stars: price,
        value: price,
        currency: 'star',
        image: itemImage(name),
        owned: true,
        timestamp: now
    };
}

function getTreatTier(streakMs) {
    return streakMs >= TREAT_TIERS[2].from ? TREAT_TIERS[2]
        : streakMs >= TREAT_TIERS[1].from ? TREAT_TIERS[1] : TREAT_TIERS[0];
}

function accrueTreat(state, elapsedMs) {
    let remaining = Math.min(MAX_TREAT_INTERVAL_MS, Math.max(0, elapsedMs));
    while (remaining > 0) {
        const tier = getTreatTier(state.treatStreakMs);
        const nextTier = TREAT_TIERS.find(item => item.from > state.treatStreakMs);
        const untilNextTier = nextTier ? nextTier.from - state.treatStreakMs : remaining;
        const elapsed = Math.min(remaining, untilNextTier);
        state.treatAccrued += tier.rate * elapsed / 60_000;
        state.treatStreakMs += elapsed;
        remaining -= elapsed;
    }
}

async function loadUser(client, telegramId) {
    const result = await client.query(
        `SELECT stars, silver, inventory, collection_items, banned, halloween_xp,
                halloween_pumpkins, halloween_state, balance_pool_started_at,
                balance_pool_start_value, balance_pool_escrow_value
         FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
        [telegramId]
    );
    return result.rows[0] || null;
}

async function recordOperation(client, telegramId, requestId, action, request, response) {
    await client.query(
        `INSERT INTO halloween_operations (telegram_id, request_id, action, request, response)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [telegramId, requestId, action, JSON.stringify(request), JSON.stringify(response)]
    );
}

async function previousOperation(client, telegramId, requestId, action, request) {
    const result = await client.query(
        `SELECT action, request, response FROM halloween_operations
         WHERE telegram_id = $1 AND request_id = $2`,
        [telegramId, requestId]
    );
    if (!result.rows.length) return null;
    const previous = result.rows[0];
    const previousRequest = typeof previous.request === 'string'
        ? JSON.parse(previous.request) : previous.request;
    if (previous.action !== action || JSON.stringify(previousRequest) !== JSON.stringify(request)) {
        throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
    }
    const response = typeof previous.response === 'string' ? JSON.parse(previous.response) : previous.response;
    return { ...response, duplicate: true };
}

async function saveUser(client, telegramId, user, updates) {
    const next = {
        stars: updates.stars ?? BigInt(user.stars),
        silver: updates.silver ?? BigInt(user.silver),
        inventory: updates.inventory ?? (Array.isArray(user.inventory) ? user.inventory : []),
        pumpkins: updates.pumpkins ?? BigInt(user.halloween_pumpkins || 0),
        state: updates.state ?? normalizeState(user.halloween_state)
    };
    const economicChanges = next.stars.toString() !== String(user.stars) ||
        next.silver.toString() !== String(user.silver) ||
        JSON.stringify(next.inventory) !== JSON.stringify(user.inventory || []);
    const poolState = updates.poolState || (economicChanges
        ? applyPoolMutation(user, {
            stars: next.stars.toString(),
            silver: next.silver.toString(),
            inventory: next.inventory
        }, { env: updates.env, now: updates.now })
        : {
            balance_pool_started_at: user.balance_pool_started_at,
            balance_pool_start_value: user.balance_pool_start_value,
            balance_pool_escrow_value: user.balance_pool_escrow_value
        });
    await client.query(
        `UPDATE app_users SET stars = $1, silver = $2, inventory = $3::jsonb,
         halloween_pumpkins = $4, halloween_state = $5::jsonb,
         collection_items = $6::jsonb, balance_pool_started_at = $7,
         balance_pool_start_value = $8, balance_pool_escrow_value = $9, updated_at = NOW()
         WHERE telegram_id = $10`,
        [
            next.stars.toString(), next.silver.toString(), JSON.stringify(next.inventory),
            next.pumpkins.toString(), JSON.stringify(next.state),
            JSON.stringify(updates.collectionItems ?? user.collection_items ?? []),
            poolState.balance_pool_started_at, poolState.balance_pool_start_value,
            poolState.balance_pool_escrow_value, telegramId
        ]
    );
    return next;
}

async function writeLedger(client, telegramId, requestId, operation, currency, amount, balance, source) {
    if (amount <= 0n) return;
    await client.query(
        `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [telegramId, requestId, operation, currency, amount.toString(), balance.toString(), source]
    );
}

function makeResponse(user, state, pumpkins, duplicate = false) {
    return {
        pumpkins: pumpkins.toString(),
        stars: String(user.stars),
        silver: String(user.silver),
        inventory: Array.isArray(user.inventory) ? user.inventory : [],
        halloweenXP: String(user.halloween_xp || 0),
        state,
        duplicate
    };
}

async function operateHalloween({
    pool, env = process.env, telegramId, requestId, action, caseId, passType, rewardIndex, brewId,
    now = Date.now(), random = () => randomInt(1_000_000_000) / 1_000_000_000
}) {
    const supported = new Set([
        'state', 'case_open', 'wheel_spin', 'pass_claim', 'treat_start',
        'treat_stop', 'treat_claim', 'brew_buy'
    ]);
    if (!supported.has(action)) throw new OperationError(400, 'HALLOWEEN_INVALID_ACTION');
    if (action === 'case_open' && !Object.hasOwn(CASES, caseId)) {
        throw new OperationError(400, 'HALLOWEEN_INVALID_CASE');
    }
    if (action === 'pass_claim' &&
        (!['free', 'pro'].includes(passType) || !Number.isInteger(rewardIndex) ||
         rewardIndex < 0 || rewardIndex >= 50)) {
        throw new OperationError(400, 'HALLOWEEN_INVALID_REWARD');
    }
    if (action === 'brew_buy' && !Object.hasOwn(BREWS, brewId)) {
        throw new OperationError(400, 'HALLOWEEN_INVALID_BREW');
    }

    const request = {
        action,
        ...(action === 'case_open' ? { caseId } : {}),
        ...(action === 'pass_claim' ? { passType, rewardIndex } : {}),
        ...(action === 'brew_buy' ? { brewId } : {})
    };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await loadUser(client, telegramId);
        if (!user) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');
        let state = normalizeState(user.halloween_state);
        let pumpkins = BigInt(user.halloween_pumpkins || 0);
        let stars = BigInt(user.stars);
        let silver = BigInt(user.silver);
        let inventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
        let collectionItems = Array.isArray(user.collection_items) ? [...user.collection_items] : [];

        if (action === 'state') {
            const response = makeResponse({ ...user, stars: stars.toString(), silver: silver.toString(), inventory },
                state, pumpkins);
            await client.query('COMMIT');
            return response;
        }

        const duplicate = await previousOperation(client, telegramId, requestId, action, request);
        if (duplicate) {
            await client.query('COMMIT');
            return duplicate;
        }

        if (now >= EVENT_END) throw new OperationError(409, 'HALLOWEEN_EVENT_ENDED');
        let result = {};
        let ledger = null;
        if (action === 'case_open') {
            const itemCase = CASES[caseId];
            if (pumpkins < BigInt(itemCase.price)) throw new OperationError(409, 'HALLOWEEN_NOT_ENOUGH_PUMPKINS');
            pumpkins -= BigInt(itemCase.price);
            const item = roulettePick(itemCase.items, random);
            const wonItem = rewardItem(item.name, item.price, now);
            inventory.push(wonItem);
            if (!collectionItems.includes(wonItem.name)) collectionItems.push(wonItem.name);
            result = { reward: wonItem, caseId, cost: itemCase.price };
        } else if (action === 'wheel_spin') {
            if (now - state.spinLastUsed < SPIN_COOLDOWN_MS) {
                throw new OperationError(409, 'HALLOWEEN_WHEEL_COOLDOWN');
            }
            const prize = roulettePick(WHEEL.map(item => ({ ...item, chance: item.percent })), random);
            state.spinLastUsed = now;
            if (prize.type === 'pumpkins') pumpkins += BigInt(prize.amount);
            else {
                stars += BigInt(prize.amount);
                ledger = { operation: 'earn', currency: 'star', amount: BigInt(prize.amount), source: 'halloween:wheel' };
            }
            result = { reward: { type: prize.type, amount: prize.amount }, spinLastUsed: now };
        } else if (action === 'pass_claim') {
            const pro = passType === 'pro';
            const rewards = pro ? PRO_PASS_REWARDS : PASS_REWARDS;
            const reward = rewards[rewardIndex];
            if (Number(user.halloween_xp || 0) < reward.xp) throw new OperationError(409, 'HALLOWEEN_NOT_ENOUGH_XP');
            const key = `${passType}:${rewardIndex}`;
            if (state.passClaims.includes(key)) throw new OperationError(409, 'HALLOWEEN_REWARD_CLAIMED');
            if (pro) {
                const configResult = await client.query(
                    "SELECT value FROM app_settings WHERE setting_key = 'halloween'"
                );
                const config = configResult.rows[0]?.value || {};
                if (config.proPassEnabled !== true) throw new OperationError(403, 'HALLOWEEN_PRO_PASS_DISABLED');
            }
            if (reward.type === 'pumpkins') pumpkins += BigInt(reward.amount);
            else if (reward.type === 'stars' || reward.type === 'silver') {
                const currency = reward.type === 'stars' ? 'star' : 'silver';
                const amount = BigInt(reward.amount);
                if (currency === 'star') stars += amount;
                else silver += amount;
                ledger = { operation: 'earn', currency, amount, source: 'halloween:pass' };
            } else if (reward.type === 'gift') {
                const item = rewardItem(reward.name, reward.price, now);
                inventory.push(item);
                if (!collectionItems.includes(item.name)) collectionItems.push(item.name);
                result.item = item;
            } else if (BREWS[reward.type]) {
                state.activeBrews = state.activeBrews.filter(brew => brew.endsAt > now);
                state.activeBrews.push({
                    type: reward.type,
                    startsAt: now,
                    endsAt: now + reward.duration * 60_000
                });
            }
            state.passClaims.push(key);
            result = { ...result, claim: key, reward };
        } else if (action === 'treat_start') {
            if (state.treatHiddenSince === null) state.treatHiddenSince = now;
            result = { treat: { streakMs: state.treatStreakMs, accrued: state.treatAccrued } };
        } else if (action === 'treat_stop') {
            if (state.treatHiddenSince !== null) {
                accrueTreat(state, now - state.treatHiddenSince);
                state.treatHiddenSince = null;
            }
            result = { treat: { streakMs: state.treatStreakMs, accrued: state.treatAccrued } };
        } else if (action === 'treat_claim') {
            if (state.treatHiddenSince !== null) {
                accrueTreat(state, now - state.treatHiddenSince);
                state.treatHiddenSince = now;
            }
            const amount = Math.floor(state.treatAccrued / TREAT_BATCH) * TREAT_BATCH;
            if (amount < TREAT_BATCH) throw new OperationError(409, 'HALLOWEEN_TREAT_NOT_READY');
            state.treatAccrued -= amount;
            pumpkins += BigInt(amount);
            result = { amount, treat: { streakMs: state.treatStreakMs, accrued: state.treatAccrued } };
        } else {
            const brew = BREWS[brewId];
            if (pumpkins < BigInt(brew.price)) throw new OperationError(409, 'HALLOWEEN_NOT_ENOUGH_PUMPKINS');
            pumpkins -= BigInt(brew.price);
            state.activeBrews = state.activeBrews.filter(entry => entry.endsAt > now);
            state.activeBrews.push({ type: brewId, startsAt: now, endsAt: now + brew.durationMs });
            result = { brew: state.activeBrews[state.activeBrews.length - 1], cost: brew.price };
        }

        const updated = await saveUser(client, telegramId, user, {
            env, now, stars, silver, inventory, pumpkins, state, collectionItems
        });
        if (ledger) {
            await writeLedger(client, telegramId, requestId, ledger.operation, ledger.currency,
                ledger.amount, ledger.currency === 'star' ? stars : silver, ledger.source);
        }
        const response = {
            ...makeResponse({
                ...user, stars: updated.stars.toString(), silver: updated.silver.toString(),
                inventory: updated.inventory
            }, state, pumpkins),
            ...result
        };
        await recordOperation(client, telegramId, requestId, action, request, response);
        await client.query('COMMIT');
        return { ...response, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw eventError(error);
    } finally {
        client.release();
    }
}

module.exports = {
    CASES,
    EVENT_END,
    PRO_PASS_REWARDS,
    PASS_REWARDS,
    SPIN_COOLDOWN_MS,
    WHEEL,
    accrueTreat,
    operateHalloween
};

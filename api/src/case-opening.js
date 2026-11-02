'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const catalog = require('./case-catalog.json');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');
const { recordLiveWin } = require('./live-wins');

const CASES = new Map(catalog.map(caseData => [caseData.id, caseData]));
const MAX_QUANTITY = 10;
const MAX_BET = 50_000_000;
const LOCAL_IMAGE_NAMES = new Set(['Mask', "Durov's Figurine"]);
const ROOT_ITEMS = new Set(['Bear', 'Gift', 'Cake', 'Trophy']);
const GIFT_CDN = 'https://cdn.changes.tg/gifts/models';

function normalizeItem(item, keepLowPrice) {
    if (keepLowPrice || item.currency === 'silver' || item.name === 'Stars' || item.price >= 101) {
        return { ...item };
    }
    return { ...item, name: 'Stars', isStars: true, currency: 'star' };
}

function getCaseItems(caseData) {
    return [...(caseData.cheapPool || []), ...caseData.items]
        .map(item => normalizeItem(item, caseData.keepLowPrice === true));
}

function chooseGift(caseData, random = () => randomInt(0, 1_000_000_000) / 10_000_000) {
    const items = getCaseItems(caseData);
    const casePrice = Number(caseData.price) || 0;
    const prepared = items.map(item => {
        const chance = Number(item.chance);
        if (!Number.isFinite(chance) || chance < 0 || !Number.isFinite(Number(item.price)) ||
            Number(item.price) < 0) {
            throw new Error(`INVALID_CASE_CATALOG:${caseData.id}`);
        }
        const isExpensive = Number(item.price) >= casePrice;
        return {
            ...item,
            isExpensive,
            weight: isExpensive ? chance * 2 : chance
        };
    });

    const expensiveWeight = prepared.reduce((sum, item) =>
        sum + (item.isExpensive ? item.weight : 0), 0);
    const cheapWeight = prepared.reduce((sum, item) =>
        sum + (item.isExpensive ? 0 : item.weight), 0);
    if (expensiveWeight + cheapWeight <= 0) {
        throw new Error(`INVALID_CASE_CATALOG:${caseData.id}`);
    }

    let expensivePercent = expensiveWeight > 0 ? Math.min(95, expensiveWeight) : 0;
    if (Number.isFinite(caseData.targetRtp) && expensiveWeight > 0 && cheapWeight > 0) {
        const expensiveExpectedValue = prepared.reduce((sum, item) =>
            sum + (item.isExpensive ? item.weight * item.price : 0), 0) / expensiveWeight;
        const cheapExpectedValue = prepared.reduce((sum, item) =>
            sum + (item.isExpensive ? 0 : item.weight * item.price), 0) / cheapWeight;
        const denominator = expensiveExpectedValue - cheapExpectedValue;
        const targetPercent = denominator === 0 ? Number.NaN :
            (casePrice * caseData.targetRtp - cheapExpectedValue) / denominator * 100;
        if (Number.isFinite(targetPercent) && targetPercent >= 0 && targetPercent <= 95) {
            expensivePercent = targetPercent;
        }
    } else if (expensiveWeight === 0) {
        expensivePercent = 0;
    } else if (cheapWeight === 0) {
        expensivePercent = 95;
    }

    const cheapPercent = 100 - expensivePercent;
    const weighted = prepared.map(item => ({
        ...item,
        finalWeight: item.isExpensive
            ? (expensiveWeight > 0 ? item.weight / expensiveWeight * expensivePercent : 0)
            : (cheapWeight > 0 ? item.weight / cheapWeight * cheapPercent : 0)
    }));
    let value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 100) {
        throw new Error('INVALID_RANDOM_VALUE');
    }
    for (const item of weighted) {
        value -= item.finalWeight;
        if (value < 0) return item;
    }
    return weighted[weighted.length - 1];
}

function moscowDate(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
}

function validateInput(caseId, quantity) {
    if (!Number.isSafeInteger(caseId) || !Number.isSafeInteger(quantity) ||
        quantity < 1 || quantity > MAX_QUANTITY) {
        throw new OperationError(400, 'INVALID_CASE_REQUEST');
    }
    const caseData = CASES.get(caseId);
    if (!caseData) throw new OperationError(404, 'CASE_NOT_FOUND');
    const price = caseData.free === true ? 0 : Number(caseData.price);
    if (!Number.isSafeInteger(price) || price < 0 || price * quantity > MAX_BET) {
        throw new OperationError(400, 'INVALID_CASE_PRICE');
    }
    return { caseData, price, currency: caseData.currency === 'silver' ? 'silver' : 'star' };
}

function createWonItem(gift, caseData, timestamp = Date.now()) {
    const sourceCurrency = gift.currency || caseData.currency || 'star';
    const currency = sourceCurrency === 'silver' ? 'silver' : 'star';
    const value = Math.round(gift.price);
    const image = gift.image || getGiftImage(gift.name, gift.price);
    return {
        id: `item_${randomUUID()}`,
        name: gift.name,
        price: gift.price,
        stars: value,
        value,
        currency,
        image,
        isStars: gift.isStars === true || gift.name === 'Stars',
        owned: true,
        timestamp
    };
}

function getGiftImage(name, price) {
    if (name === 'Stars') return '/shared/star.png';
    if (ROOT_ITEMS.has(name) || LOCAL_IMAGE_NAMES.has(name) || price < 3) {
        return `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.png`;
    }
    const modelMatch = name.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (modelMatch) {
        return `${GIFT_CDN}/${encodeURIComponent(modelMatch[1].trim())}/png/${encodeURIComponent(modelMatch[2].trim())}.png`;
    }
    return `${GIFT_CDN}/${encodeURIComponent(name)}/png/Original.png`;
}

async function openCase({ pool, env = process.env, telegramId, requestId, caseId, quantity, now = new Date() }) {
    const { caseData, price, currency } = validateInput(caseId, quantity);
    const request = { caseId, quantity };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT stars, silver, banned, inventory, collection_items, free_case_usage,
                    balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
             FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        const user = userResult.rows[0];
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');

        const previousResult = await client.query(
            `SELECT operation, request, response FROM game_operations
             WHERE telegram_id = $1 AND request_id = $2`,
            [telegramId, requestId]
        );
        if (previousResult.rows.length) {
            const previous = previousResult.rows[0];
            if (previous.operation !== 'case_open' ||
                previous.request?.caseId !== request.caseId ||
                previous.request?.quantity !== request.quantity) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const field = currency === 'silver' ? 'silver' : 'stars';
        const balance = BigInt(user[field]);
        const cost = BigInt(price) * BigInt(quantity);
        if (balance < cost) throw new OperationError(409, 'INSUFFICIENT_FUNDS');

        const usage = user.free_case_usage && typeof user.free_case_usage === 'object' &&
            !Array.isArray(user.free_case_usage)
            ? { ...user.free_case_usage }
            : {};
        if (caseData.free === true && caseData.freeType !== 'unlimited') {
            const today = moscowDate(now);
            const current = usage[caseId];
            const count = current?.date === today ? Number(current.count) || 0 : 0;
            if (count + quantity > 10) throw new OperationError(409, 'FREE_CASE_LIMIT_REACHED');
            usage[caseId] = { date: today, count: count + quantity };
        }

        const timestamp = now.getTime();
        const gifts = Array.from({ length: quantity }, () => chooseGift(caseData));
        const items = gifts.map(gift => createWonItem(gift, caseData, timestamp));
        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const collectionItems = Array.isArray(user.collection_items)
            ? user.collection_items.map(item =>
                (typeof item === 'string' ? item : String(item?.name || '')).trim()
            ).filter(Boolean)
            : [];
        const collectionNames = new Set(collectionItems.map(name => String(name).trim().toLocaleLowerCase()));
        for (const item of [...inventory, ...items]) {
            const name = String(item?.name || '').trim();
            const key = name.toLocaleLowerCase();
            if (name && !collectionNames.has(key)) {
                collectionNames.add(key);
                collectionItems.push(name);
            }
        }
        const nextBalance = balance - cost;
        const nextInventory = [...inventory, ...items];
        const nextValues = {
            stars: currency === 'star' ? nextBalance.toString() : user.stars,
            silver: currency === 'silver' ? nextBalance.toString() : user.silver,
            inventory: nextInventory
        };
        const poolState = applyPoolMutation(user, nextValues, { now: timestamp, env });
        await client.query(
            `UPDATE app_users SET ${field} = $1, inventory = $2::jsonb,
             collection_items = $3::jsonb, free_case_usage = $4::jsonb,
             balance_pool_started_at = $5, balance_pool_start_value = $6,
             balance_pool_escrow_value = $7, updated_at = NOW()
             WHERE telegram_id = $8`,
            [
                nextBalance.toString(), JSON.stringify(nextInventory), JSON.stringify(collectionItems),
                JSON.stringify(usage),
                poolState.balance_pool_started_at, poolState.balance_pool_start_value,
                poolState.balance_pool_escrow_value, telegramId
            ]
        );
        if (cost > 0n) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'spend', $3, $4, $5, $6)`,
                [telegramId, requestId, currency, cost.toString(), nextBalance.toString(), `case:${caseId}`]
            );
        }

        const response = {
            caseId,
            quantity,
            currency,
            balance: nextBalance.toString(),
            freeCaseUsage: usage,
            collectionItems,
            inventory: nextInventory,
            gifts: gifts.map((gift, index) => ({
                name: gift.name,
                price: gift.price,
                currency: items[index].currency,
                image: items[index].image,
                isStars: items[index].isStars
            })),
            items
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'case_open', $3::jsonb, $4::jsonb)`,
            [telegramId, requestId, JSON.stringify(request), JSON.stringify(response)]
        );
        await recordLiveWin({
            pool: client,
            telegramId,
            gifts: response.gifts,
            caseName: caseData.name
        });
        await client.query('COMMIT');
        return { ...response, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof BalancePoolError) {
            throw new OperationError(error.status, error.code);
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    CASES,
    OperationError,
    chooseGift,
    getCaseItems,
    moscowDate,
    openCase,
    validateInput
};

'use strict';

const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { applyPoolMutation, BalancePoolError, getAssetValue } = require('./balance-pool');
const { evaluate, normalizeState, START } = require('./phone-roulette');
const { OperationError } = require('./operation-errors');

const DAY_MS = 24 * 60 * 60 * 1000;
const PHONE_KEY = '__phone__';
const ACTION_OPERATIONS = Object.freeze({
    create: 'trade_create',
    counter: 'trade_counter',
    accept_sender: 'trade_accept',
    complete: 'trade_complete',
    reject: 'trade_reject',
    expire: 'trade_expire'
});
const TRADE_COLUMNS = `trade_id::text AS id, from_user_id AS "fromUserId",
    from_username AS "fromUsername", to_user_id AS "toUserId", to_username AS "toUsername",
    from_items AS "fromItems", from_stars AS "fromStars", to_items AS "toItems",
    to_stars AS "toStars", escrow_from AS "escrowFrom", escrow_to AS "escrowTo",
    accepted_from AS "acceptedFrom", accepted_to AS "acceptedTo",
    refunded_from AS "refundedFrom", refunded_to AS "refundedTo", status,
    created_at AS "createdAt", expires_at AS "expiresAt", updated_at AS "updatedAt"`;

function safeAmount(value, code = 'TRADE_INVALID_AMOUNT') {
    if (!Number.isSafeInteger(value) || value < 0) throw new OperationError(400, code);
    return value;
}

function validateIds(ids) {
    if (!Array.isArray(ids) || ids.length > 50 ||
        ids.some(id => typeof id !== 'string' || id.length < 1 || id.length > 160) ||
        new Set(ids).size !== ids.length) {
        throw new OperationError(400, 'TRADE_INVALID_ITEMS');
    }
}

function tradable(item) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' ||
        !item.id || typeof item.name !== 'string' || !item.name.trim()) return false;
    if (item.currency && item.currency !== 'star') return false;
    if (item.saved || item.noSell || item.untradeable || item.limited || item.ropeko) return false;
    return !['active', 'paused'].includes(item.staking?.status);
}

function phoneItem(phone) {
    const value = evaluate(phone.cc, phone.tail).value;
    return {
        id: `phone_${randomUUID()}`,
        type: 'phone',
        name: `+${phone.cc} ${phone.tail}`,
        phone: { cc: phone.cc, tail: phone.tail },
        price: value,
        stars: value,
        value,
        currency: 'star',
        image: '',
        timestamp: Date.now()
    };
}

function phoneAssetValue(phone) {
    const value = evaluate(phone.cc, phone.tail).value;
    return value > 0 ? value : 0;
}

function requestOperation(previous, operation, request) {
    if (previous.operation !== operation || !isDeepStrictEqual(previous.request, request)) {
        throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
    }
    return { ...previous.response, duplicate: true };
}

async function getPrevious(client, telegramId, requestId, operation, request) {
    const result = await client.query(
        `SELECT operation, request, response FROM game_operations
         WHERE telegram_id = $1 AND request_id = $2`,
        [telegramId, requestId]
    );
    return result.rows.length ? requestOperation(result.rows[0], operation, request) : null;
}

async function insertOperation(client, telegramId, requestId, operation, request, response) {
    await client.query(
        `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [telegramId, requestId, operation, JSON.stringify(request), JSON.stringify(response)]
    );
}

async function loadUser(client, telegramId, lock = true) {
    const result = await client.query(
        `SELECT telegram_id, username, first_name, stars, silver, inventory, collection_items,
                profile_phone, banned, balance_pool_started_at, balance_pool_start_value,
                balance_pool_escrow_value
         FROM app_users WHERE telegram_id = $1${lock ? ' FOR UPDATE' : ''}`,
        [telegramId]
    );
    return result.rows[0] || null;
}

function operationError(error) {
    if (error instanceof BalancePoolError) return new OperationError(error.status, error.code);
    return error;
}

async function prepareTradeInventory({ pool, telegramId }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await loadUser(client, telegramId);
        if (!user) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');
        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const seen = new Set();
        let changed = false;
        const next = inventory.map(item => {
            const copy = { ...item };
            let id = typeof copy.id === 'string' ? copy.id : '';
            if (!id || seen.has(id)) {
                do { id = randomUUID(); } while (seen.has(id));
                copy.id = id;
                changed = true;
            }
            seen.add(id);
            return copy;
        });
        if (changed) {
            await client.query(
                'UPDATE app_users SET inventory = $1::jsonb, updated_at = NOW() WHERE telegram_id = $2',
                [JSON.stringify(next), telegramId]
            );
        }
        await client.query('COMMIT');
        return { inventory: next };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw operationError(error);
    } finally {
        client.release();
    }
}

async function searchTradeUsers({ pool, telegramId, query }) {
    if (typeof query !== 'string' || query.trim().length < 1 || query.trim().length > 64) {
        throw new OperationError(400, 'TRADE_INVALID_SEARCH');
    }
    const escaped = query.trim().replace(/^@/, '').replace(/[\\%_]/g, '\\$&').toLowerCase();
    if (!escaped) throw new OperationError(400, 'TRADE_INVALID_SEARCH');
    const result = await pool.query(
        `SELECT telegram_id, username, first_name, photo_url FROM app_users
         WHERE telegram_id <> $1 AND banned = FALSE
           AND (LOWER(username) LIKE $2 ESCAPE '\\' OR LOWER(first_name) LIKE $2 ESCAPE '\\')
         ORDER BY LOWER(username), telegram_id LIMIT 25`,
        [telegramId, `${escaped}%`]
    );
    return {
        users: result.rows.map(user => ({
            id: user.telegram_id,
            username: user.username || user.telegram_id,
            name: user.first_name || user.username || 'Игрок',
            photo: user.photo_url || ''
        }))
    };
}

function mapTrade(row) {
    if (!row) return null;
    return {
        ...row,
        fromStars: Number(row.fromStars),
        toStars: Number(row.toStars),
        createdAt: Number(row.createdAt),
        expiresAt: Number(row.expiresAt),
        updatedAt: Number(row.updatedAt)
    };
}

async function loadTrade({ pool, telegramId, tradeId }) {
    if (typeof tradeId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tradeId)) {
        throw new OperationError(400, 'TRADE_INVALID_ID');
    }
    const result = await pool.query(
        `SELECT ${TRADE_COLUMNS} FROM trades WHERE trade_id = $1::uuid
         AND (from_user_id = $2 OR to_user_id = $2)`,
        [tradeId, telegramId]
    );
    if (!result.rows.length) throw new OperationError(404, 'TRADE_NOT_FOUND');
    return { trade: mapTrade(result.rows[0]) };
}

async function loadMyTrades({ pool, telegramId, status = 'pending' }) {
    if (!['pending', 'all'].includes(status)) throw new OperationError(400, 'TRADE_INVALID_STATUS');
    const result = await pool.query(
        `SELECT ${TRADE_COLUMNS} FROM trades
         WHERE (from_user_id = $1 OR to_user_id = $1)
           AND ($2 = 'all' OR status = $2)
         ORDER BY created_at DESC LIMIT 50`,
        [telegramId, status]
    );
    return { trades: result.rows.map(mapTrade) };
}

async function updateUser(client, user, { stars, inventory, phone, collectionItems, poolState }) {
    await client.query(
        `UPDATE app_users SET stars = $1, inventory = $2::jsonb, profile_phone = $3::jsonb,
         collection_items = $4::jsonb, balance_pool_started_at = $5,
         balance_pool_start_value = $6, balance_pool_escrow_value = $7, updated_at = NOW()
         WHERE telegram_id = $8`,
        [
            String(stars), JSON.stringify(inventory), JSON.stringify(phone),
            JSON.stringify(collectionItems), poolState.balance_pool_started_at,
            poolState.balance_pool_start_value, poolState.balance_pool_escrow_value, user.telegram_id
        ]
    );
}

async function writeLedger(client, telegramId, requestId, operation, amount, balance, source) {
    if (amount <= 0) return;
    await client.query(
        `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
         VALUES ($1, $2, $3, 'star', $4, $5, $6)`,
        [telegramId, requestId, operation, amount, String(balance), source]
    );
}

async function createTrade({ pool, env = process.env, telegramId, requestId, targetUserId, itemIds, stars, now = Date.now() }) {
    if (typeof targetUserId !== 'string' || !/^[1-9]\d{0,19}$/.test(targetUserId) ||
        targetUserId === telegramId) throw new OperationError(400, 'TRADE_INVALID_RECIPIENT');
    validateIds(itemIds);
    const amount = safeAmount(stars);
    if (itemIds.length === 0 && amount === 0) throw new OperationError(400, 'TRADE_EMPTY_OFFER');
    const request = { targetUserId, itemIds: [...itemIds].sort(), stars: amount };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await loadUser(client, telegramId);
        if (!user) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');
        const previous = await getPrevious(client, telegramId, requestId, 'trade_create', request);
        if (previous) { await client.query('COMMIT'); return previous; }
        const target = await loadUser(client, targetUserId, false);
        if (!target || target.banned) throw new OperationError(404, 'TRADE_RECIPIENT_NOT_FOUND');
        const existing = await client.query(
            `SELECT 1 FROM trades WHERE from_user_id = $1 AND status = 'pending' LIMIT 1`,
            [telegramId]
        );
        if (existing.rows.length) throw new OperationError(409, 'TRADE_PENDING_EXISTS');
        let balance = BigInt(user.stars);
        if (balance < BigInt(amount)) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
        const inventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
        const fromItems = [];
        let phone = normalizeState(user.profile_phone);
        for (const id of itemIds) {
            if (id === PHONE_KEY) {
                if (phone.pending || phone.value <= 0) throw new OperationError(409, 'TRADE_PHONE_UNAVAILABLE');
                fromItems.push(phoneItem(phone));
                phone = { ...START, rolls: phone.rolls, best: phone.best };
                continue;
            }
            const index = inventory.findIndex(item => item?.id === id);
            if (index < 0) throw new OperationError(409, 'TRADE_ITEM_UNAVAILABLE');
            if (!tradable(inventory[index])) throw new OperationError(409, 'TRADE_ITEM_NOT_TRADABLE');
            fromItems.push(inventory[index]);
            inventory.splice(index, 1);
        }
        balance -= BigInt(amount);
        const escrow = getAssetValue({ stars: amount, inventory: fromItems });
        const poolState = applyPoolMutation(user, {
            stars: balance.toString(), silver: String(user.silver), inventory
        }, { env, now, escrowValueDelta: escrow });
        await updateUser(client, user, {
            stars: balance, inventory, phone,
            collectionItems: Array.isArray(user.collection_items) ? user.collection_items : [],
            poolState
        });
        const id = randomUUID();
        const fromUsername = user.first_name || user.username || 'Игрок';
        const toUsername = target.first_name || target.username || 'Игрок';
        const response = {
            trade: {
                id,
                fromUserId: telegramId,
                fromUsername,
                toUserId: targetUserId,
                toUsername,
                fromItems,
                fromStars: amount,
                toItems: [],
                toStars: 0,
                escrowFrom: true,
                escrowTo: false,
                acceptedFrom: false,
                acceptedTo: false,
                refundedFrom: false,
                refundedTo: false,
                status: 'pending',
                createdAt: now,
                expiresAt: now + DAY_MS,
                updatedAt: now
            }
        };
        await client.query(
            `INSERT INTO trades (trade_id, from_user_id, from_username, to_user_id, to_username,
                from_items, from_stars, to_items, to_stars, escrow_from, escrow_to,
                accepted_from, accepted_to, refunded_from, refunded_to, status, created_at, expires_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, '[]'::jsonb, 0, TRUE, FALSE,
                FALSE, FALSE, FALSE, FALSE, 'pending', $8, $9, $8)`,
            [
                id, telegramId, fromUsername, targetUserId, toUsername, JSON.stringify(fromItems),
                amount, now, now + DAY_MS
            ]
        );
        await writeLedger(client, telegramId, requestId, 'spend', amount, balance, 'trade:escrow');
        await insertOperation(client, telegramId, requestId, 'trade_create', request, response);
        await client.query('COMMIT');
        return { ...response, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw operationError(error);
    } finally {
        client.release();
    }
}

async function updateTrade(client, tradeId, values) {
    const fields = Object.keys(values);
    const assignments = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    await client.query(
        `UPDATE trades SET ${assignments} WHERE trade_id = $1::uuid`,
        [tradeId, ...fields.map(field => values[field])]
    );
}

async function operateTrade({
    pool, env = process.env, telegramId, requestId, tradeId, action, itemIds = [], stars = 0, now = Date.now()
}) {
    if (!Object.hasOwn(ACTION_OPERATIONS, action) || action === 'create') {
        throw new OperationError(400, 'TRADE_INVALID_ACTION');
    }
    if (typeof tradeId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tradeId)) {
        throw new OperationError(400, 'TRADE_INVALID_ID');
    }
    const amount = action === 'counter' ? safeAmount(stars) : 0;
    if (action === 'counter') validateIds(itemIds);
    const request = action === 'counter'
        ? { action, tradeId, itemIds: [...itemIds].sort(), stars: amount }
        : { action, tradeId };
    const operation = ACTION_OPERATIONS[action];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const previous = await getPrevious(client, telegramId, requestId, operation, request);
        if (previous) { await client.query('COMMIT'); return previous; }
        const tradeResult = await client.query(
            `SELECT ${TRADE_COLUMNS} FROM trades WHERE trade_id = $1::uuid FOR UPDATE`,
            [tradeId]
        );
        if (!tradeResult.rows.length) throw new OperationError(404, 'TRADE_NOT_FOUND');
        const trade = mapTrade(tradeResult.rows[0]);
        if (trade.fromUserId !== telegramId && trade.toUserId !== telegramId) {
            throw new OperationError(403, 'TRADE_NOT_PARTICIPANT');
        }
        if (trade.status !== 'pending') throw new OperationError(409, 'TRADE_NOT_PENDING');
        const expired = now >= trade.expiresAt;
        if (action === 'expire' && !expired) {
            const response = { applied: false, state: 'pending' };
            await insertOperation(client, telegramId, requestId, operation, request, response);
            await client.query('COMMIT');
            return { ...response, duplicate: false };
        }
        if (action === 'accept_sender') {
            if (telegramId !== trade.fromUserId) throw new OperationError(403, 'TRADE_NOT_PARTICIPANT');
            if (expired) throw new OperationError(409, 'TRADE_EXPIRED');
            if (trade.acceptedFrom) {
                const response = { applied: false, state: 'already-accepted' };
                await insertOperation(client, telegramId, requestId, operation, request, response);
                await client.query('COMMIT');
                return { ...response, duplicate: false };
            }
            await updateTrade(client, tradeId, { accepted_from: true, updated_at: now });
            const response = { applied: true, state: 'accepted' };
            await insertOperation(client, telegramId, requestId, operation, request, response);
            await client.query('COMMIT');
            return { ...response, duplicate: false };
        }
        if (action === 'counter') {
            if (telegramId !== trade.toUserId) throw new OperationError(403, 'TRADE_NOT_PARTICIPANT');
            if (expired) throw new OperationError(409, 'TRADE_EXPIRED');
            if (trade.acceptedTo) throw new OperationError(409, 'TRADE_ALREADY_ACCEPTED');
            if (itemIds.length === 0 && amount === 0) throw new OperationError(400, 'TRADE_EMPTY_OFFER');
            const user = await loadUser(client, telegramId);
            if (!user) throw new OperationError(404, 'TRADE_PARTICIPANT_NOT_FOUND');
            if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');
            let balance = BigInt(user.stars);
            if (balance < BigInt(amount)) throw new OperationError(409, 'INSUFFICIENT_FUNDS');
            const inventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
            const toItems = [];
            let phone = normalizeState(user.profile_phone);
            for (const id of itemIds) {
                if (id === PHONE_KEY) {
                    if (phone.pending || phone.value <= 0) throw new OperationError(409, 'TRADE_PHONE_UNAVAILABLE');
                    toItems.push(phoneItem(phone));
                    phone = { ...START, rolls: phone.rolls, best: phone.best };
                    continue;
                }
                const index = inventory.findIndex(item => item?.id === id);
                if (index < 0) throw new OperationError(409, 'TRADE_ITEM_UNAVAILABLE');
                if (!tradable(inventory[index])) throw new OperationError(409, 'TRADE_ITEM_NOT_TRADABLE');
                toItems.push(inventory[index]);
                inventory.splice(index, 1);
            }
            balance -= BigInt(amount);
            const priorOfferValue = trade.escrowTo
                ? getAssetValue({ stars: trade.toStars, inventory: trade.toItems }) : 0;
            const escrowDelta = getAssetValue({ stars: amount, inventory: toItems }) - priorOfferValue;
            const poolState = applyPoolMutation(user, {
                stars: balance.toString(), silver: String(user.silver), inventory
            }, { env, now, escrowValueDelta: escrowDelta });
            await updateUser(client, user, {
                stars: balance,
                inventory,
                phone,
                collectionItems: Array.isArray(user.collection_items) ? user.collection_items : [],
                poolState
            });
            const sameOffer = JSON.stringify(trade.toItems.map(item => item.id).sort()) ===
                JSON.stringify(toItems.map(item => item.id).sort()) && trade.toStars === amount;
            await updateTrade(client, tradeId, {
                to_items: JSON.stringify(toItems),
                to_stars: amount,
                escrow_to: true,
                accepted_to: true,
                accepted_from: sameOffer && trade.acceptedFrom,
                updated_at: now
            });
            await writeLedger(client, telegramId, requestId, 'spend', amount, balance, 'trade:escrow');
            const response = { applied: true, state: 'accepted', senderMustReaccept: !sameOffer && trade.acceptedFrom };
            await insertOperation(client, telegramId, requestId, operation, request, response);
            await client.query('COMMIT');
            return { ...response, duplicate: false };
        }

        const nextStatus = expired || action === 'expire' ? 'expired'
            : action === 'reject' ? 'rejected' : 'completed';
        if (nextStatus === 'completed' && (!trade.acceptedFrom || !trade.acceptedTo)) {
            throw new OperationError(409, 'TRADE_NOT_ACCEPTED_BY_BOTH');
        }
        if (nextStatus === 'completed' &&
            ((trade.fromItems.length || trade.fromStars) && !trade.escrowFrom ||
             (trade.toItems.length || trade.toStars) && !trade.escrowTo)) {
            throw new OperationError(409, 'TRADE_INVALID_ESCROW');
        }

        const ids = [...new Set([trade.fromUserId, trade.toUserId])].sort();
        const users = new Map();
        for (const id of ids) {
            const user = await loadUser(client, id);
            if (!user) throw new OperationError(404, 'TRADE_PARTICIPANT_NOT_FOUND');
            users.set(id, user);
        }
        let response;
        if (nextStatus === 'completed') {
            const fromUser = users.get(trade.fromUserId), toUser = users.get(trade.toUserId);
            const fromInventory = Array.isArray(fromUser.inventory) ? [...fromUser.inventory] : [];
            const toInventory = Array.isArray(toUser.inventory) ? [...toUser.inventory] : [];
            const fromItemIds = new Set(fromInventory.map(item => item?.id));
            const toItemIds = new Set(toInventory.map(item => item?.id));
            if (trade.toItems.some(item => fromItemIds.has(item.id)) ||
                trade.fromItems.some(item => toItemIds.has(item.id))) {
                throw new OperationError(409, 'TRADE_DUPLICATE_ITEM');
            }
            fromInventory.push(...trade.toItems);
            toInventory.push(...trade.fromItems);
            const fromFee = Math.floor(trade.toStars * 0.1);
            const toFee = Math.floor(trade.fromStars * 0.1);
            const fromBalance = BigInt(fromUser.stars) + BigInt(trade.toStars - fromFee);
            const toBalance = BigInt(toUser.stars) + BigInt(trade.fromStars - toFee);
            const fromPool = applyPoolMutation(fromUser, {
                stars: fromBalance.toString(), silver: String(fromUser.silver), inventory: fromInventory
            }, { env, now, escrowValueDelta: -getAssetValue({ stars: trade.fromStars, inventory: trade.fromItems }) });
            const toPool = applyPoolMutation(toUser, {
                stars: toBalance.toString(), silver: String(toUser.silver), inventory: toInventory
            }, { env, now, escrowValueDelta: -getAssetValue({ stars: trade.toStars, inventory: trade.toItems }) });
            const addCollection = (user, items) => [...new Set([
                ...(Array.isArray(user.collection_items) ? user.collection_items : []),
                ...items.map(item => String(item?.name || '').trim()).filter(Boolean)
            ])];
            await updateUser(client, fromUser, {
                stars: fromBalance, inventory: fromInventory,
                phone: normalizeState(fromUser.profile_phone),
                collectionItems: addCollection(fromUser, trade.toItems), poolState: fromPool
            });
            await updateUser(client, toUser, {
                stars: toBalance, inventory: toInventory,
                phone: normalizeState(toUser.profile_phone),
                collectionItems: addCollection(toUser, trade.fromItems), poolState: toPool
            });
            await writeLedger(client, trade.fromUserId, requestId, 'earn', trade.toStars - fromFee, fromBalance, 'trade:complete');
            await writeLedger(client, trade.toUserId, requestId, 'earn', trade.fromStars - toFee, toBalance, 'trade:complete');
            await updateTrade(client, tradeId, {
                status: 'completed', from_stars_fee: fromFee, to_stars_fee: toFee, updated_at: now
            });
            response = {
                applied: true, state: 'completed',
                fromStarsReceived: trade.toStars - fromFee,
                toStarsReceived: trade.fromStars - toFee,
                fromStarsFee: fromFee, toStarsFee: toFee
            };
        } else {
            const refundFrom = !trade.refundedFrom && trade.escrowFrom;
            const refundTo = !trade.refundedTo && trade.escrowTo;
            if (refundFrom) {
                const user = users.get(trade.fromUserId);
                const inventory = [...(Array.isArray(user.inventory) ? user.inventory : []), ...trade.fromItems];
                const balance = BigInt(user.stars) + BigInt(trade.fromStars);
                const poolState = applyPoolMutation(user, {
                    stars: balance.toString(), silver: String(user.silver), inventory
                }, {
                    env, now, allowSeasonReturn: true,
                    escrowValueDelta: -getAssetValue({ stars: trade.fromStars, inventory: trade.fromItems })
                });
                await updateUser(client, user, {
                    stars: balance, inventory, phone: normalizeState(user.profile_phone),
                    collectionItems: Array.isArray(user.collection_items) ? user.collection_items : [],
                    poolState
                });
                await writeLedger(client, trade.fromUserId, requestId, 'earn', trade.fromStars, balance, 'trade:refund');
            }
            if (refundTo) {
                const user = users.get(trade.toUserId);
                const inventory = [...(Array.isArray(user.inventory) ? user.inventory : []), ...trade.toItems];
                const balance = BigInt(user.stars) + BigInt(trade.toStars);
                const poolState = applyPoolMutation(user, {
                    stars: balance.toString(), silver: String(user.silver), inventory
                }, {
                    env, now, allowSeasonReturn: true,
                    escrowValueDelta: -getAssetValue({ stars: trade.toStars, inventory: trade.toItems })
                });
                await updateUser(client, user, {
                    stars: balance, inventory, phone: normalizeState(user.profile_phone),
                    collectionItems: Array.isArray(user.collection_items) ? user.collection_items : [],
                    poolState
                });
                await writeLedger(client, trade.toUserId, requestId, 'earn', trade.toStars, balance, 'trade:refund');
            }
            await updateTrade(client, tradeId, {
                status: nextStatus, refunded_from: true, refunded_to: true, updated_at: now
            });
            response = { applied: true, state: nextStatus, refundedFrom: refundFrom, refundedTo: refundTo };
        }
        await insertOperation(client, telegramId, requestId, operation, request, response);
        await client.query('COMMIT');
        return { ...response, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw operationError(error);
    } finally {
        client.release();
    }
}

module.exports = {
    createTrade, loadMyTrades, loadTrade, operateTrade, prepareTradeInventory, searchTradeUsers
};

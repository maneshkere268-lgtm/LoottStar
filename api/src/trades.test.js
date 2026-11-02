'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createTrade, loadTrade, operateTrade, prepareTradeInventory, searchTradeUsers
} = require('./trades');

const requestId = suffix => `31c37f9e-6da8-4e8d-a44c-44d1f6b816${suffix}`;
const now = Date.parse('2026-11-02T00:00:00Z');

function createPool() {
    const makeUser = (id, name, stars, inventory = []) => ({
        telegram_id: id,
        username: name.toLowerCase(),
        first_name: name,
        stars: String(stars),
        silver: '0',
        inventory,
        collection_items: [],
        profile_phone: { cc: '7', tail: '0000000000', rolls: 0, best: 0 },
        banned: false,
        balance_pool_started_at: now - 1000,
        balance_pool_start_value: stars + inventory.reduce((sum, item) => sum + (item.stars || 0), 0),
        balance_pool_escrow_value: 0
    });
    const state = {
        users: new Map([
            ['12345', makeUser('12345', 'Sender', 100, [{ id: 'item-a', name: 'Bear', stars: 25, currency: 'star' }])],
            ['67890', makeUser('67890', 'Receiver', 20, [{ id: 'item-b', name: 'Gift', stars: 10, currency: 'star' }])]
        ]),
        trades: new Map(),
        operations: [],
        ledger: []
    };
    const userRow = user => user && structuredClone(user);
    const tradeRow = trade => ({
        id: trade.id,
        fromUserId: trade.from_user_id,
        fromUsername: trade.from_username,
        toUserId: trade.to_user_id,
        toUsername: trade.to_username,
        fromItems: trade.from_items,
        fromStars: trade.from_stars,
        toItems: trade.to_items,
        toStars: trade.to_stars,
        escrowFrom: trade.escrow_from,
        escrowTo: trade.escrow_to,
        acceptedFrom: trade.accepted_from,
        acceptedTo: trade.accepted_to,
        refundedFrom: trade.refunded_from,
        refundedTo: trade.refunded_to,
        status: trade.status,
        createdAt: trade.created_at,
        expiresAt: trade.expires_at,
        updatedAt: trade.updated_at
    });
    return {
        state,
        async query(sql, params = []) {
            if (sql.includes('LOWER(username) LIKE')) {
                return { rows: [...state.users.values()].filter(user =>
                    user.telegram_id !== params[0] &&
                    (user.username.startsWith(params[1].slice(0, -1)) ||
                        user.first_name.toLowerCase().startsWith(params[1].slice(0, -1)))
                ).map(user => ({
                    telegram_id: user.telegram_id, username: user.username,
                    first_name: user.first_name, photo_url: ''
                })) };
            }
            throw new Error(`Unexpected pool query: ${sql}`);
        },
        async connect() {
            return {
                async query(sql, params = []) {
                    const statement = sql.trimStart();
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
                    if (statement.includes('FROM app_users WHERE telegram_id')) {
                        const user = state.users.get(String(params[0]));
                        return { rows: user ? [userRow(user)] : [] };
                    }
                    if (statement.includes('FROM game_operations')) {
                        const operation = state.operations.find(row =>
                            row.telegramId === params[0] && row.requestId === params[1]
                        );
                        return { rows: operation ? [{
                            operation: operation.operation,
                            request: operation.request,
                            response: operation.response
                        }] : [] };
                    }
                    if (statement.includes('FROM trades WHERE from_user_id')) {
                        return { rows: [...state.trades.values()].some(trade =>
                            trade.from_user_id === params[0] && trade.status === 'pending'
                        ) ? [{}] : [] };
                    }
                    if (statement.includes('FROM trades WHERE trade_id')) {
                        const trade = state.trades.get(params[0]);
                        return { rows: trade ? [tradeRow(trade)] : [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET inventory')) {
                        const user = state.users.get(params[1]);
                        user.inventory = JSON.parse(params[0]);
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE app_users SET stars = $1')) {
                        const user = state.users.get(params[7]);
                        user.stars = params[0];
                        user.inventory = JSON.parse(params[1]);
                        user.profile_phone = JSON.parse(params[2]);
                        user.collection_items = JSON.parse(params[3]);
                        user.balance_pool_started_at = params[4];
                        user.balance_pool_start_value = params[5];
                        user.balance_pool_escrow_value = params[6];
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO trades')) {
                        const [id, fromId, fromName, toId, toName, fromItems, fromStars, created, expires] = params;
                        state.trades.set(id, {
                            id,
                            from_user_id: fromId,
                            from_username: fromName,
                            to_user_id: toId,
                            to_username: toName,
                            from_items: JSON.parse(fromItems),
                            from_stars: fromStars,
                            to_items: [],
                            to_stars: 0,
                            escrow_from: true,
                            escrow_to: false,
                            accepted_from: false,
                            accepted_to: false,
                            refunded_from: false,
                            refunded_to: false,
                            status: 'pending',
                            created_at: created,
                            expires_at: expires,
                            updated_at: created,
                            from_stars_fee: 0,
                            to_stars_fee: 0
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('UPDATE trades SET')) {
                        const trade = state.trades.get(params[0]);
                        const assignments = statement.slice('UPDATE trades SET '.length).split(' WHERE')[0].split(', ');
                        assignments.forEach((assignment, index) => {
                            const field = assignment.split(' = ')[0];
                            const value = params[index + 1];
                            if (field === 'to_items') trade.to_items = JSON.parse(value);
                            else trade[field] = value;
                        });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ telegramId: params[0], amount: String(params[3]), source: params[5] });
                        return { rows: [] };
                    }
                    if (statement.startsWith('INSERT INTO game_operations')) {
                        state.operations.push({
                            telegramId: params[0],
                            requestId: params[1],
                            operation: params[2],
                            request: JSON.parse(params[3]),
                            response: JSON.parse(params[4])
                        });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected SQL in trade test: ${sql}`);
                },
                release() {}
            };
        }
    };
}

test('trade escrow, counter-offer, and completion atomically transfer owned assets', async () => {
    const pool = createPool();
    const created = await createTrade({
        pool, telegramId: '12345', requestId: requestId('01'), targetUserId: '67890',
        itemIds: ['item-a'], stars: 5, now
    });
    assert.equal(created.trade.fromStars, 5);
    assert.equal(pool.state.users.get('12345').stars, '95');
    assert.deepEqual(pool.state.users.get('12345').inventory, []);
    assert.equal(pool.state.users.get('12345').balance_pool_escrow_value, 30);

    const counter = await operateTrade({
        pool, telegramId: '67890', requestId: requestId('02'), tradeId: created.trade.id,
        action: 'counter', itemIds: ['item-b'], stars: 4, now: now + 1
    });
    assert.equal(counter.applied, true);
    const accepted = await operateTrade({
        pool, telegramId: '12345', requestId: requestId('03'), tradeId: created.trade.id,
        action: 'accept_sender', now: now + 2
    });
    assert.equal(accepted.applied, true);
    const completed = await operateTrade({
        pool, telegramId: '67890', requestId: requestId('04'), tradeId: created.trade.id,
        action: 'complete', now: now + 3
    });
    assert.equal(completed.state, 'completed');
    assert.equal(pool.state.users.get('12345').stars, '99');
    assert.equal(pool.state.users.get('67890').stars, '21');
    assert.deepEqual(pool.state.users.get('12345').inventory.map(item => item.id), ['item-b']);
    assert.deepEqual(pool.state.users.get('67890').inventory.map(item => item.id), ['item-a']);
    assert.equal(pool.state.users.get('12345').balance_pool_escrow_value, 0);
    assert.equal(pool.state.users.get('67890').balance_pool_escrow_value, 0);
});

test('trade creation is replay-safe and invalid participants cannot access the offer', async () => {
    const pool = createPool();
    const input = {
        pool, telegramId: '12345', requestId: requestId('05'), targetUserId: '67890',
        itemIds: ['item-a'], stars: 0, now
    };
    const first = await createTrade(input);
    const duplicate = await createTrade(input);
    assert.equal(duplicate.duplicate, true);
    assert.equal(pool.state.trades.size, 1);
    await assert.rejects(() => operateTrade({
        pool, telegramId: '98765', requestId: requestId('06'), tradeId: first.trade.id,
        action: 'reject', now: now + 1
    }), { code: 'TRADE_NOT_PARTICIPANT' });
    await assert.rejects(() => loadTrade({
        pool, telegramId: '12345', tradeId: '------------------------------------'
    }), { code: 'TRADE_INVALID_ID' });
});

test('counter-offer cannot reserve an empty offer', async () => {
    const pool = createPool();
    const created = await createTrade({
        pool, telegramId: '12345', requestId: requestId('09'), targetUserId: '67890',
        itemIds: ['item-a'], stars: 0, now
    });
    await assert.rejects(() => operateTrade({
        pool, telegramId: '67890', requestId: requestId('10'), tradeId: created.trade.id,
        action: 'counter', itemIds: [], stars: 0, now: now + 1
    }), { code: 'TRADE_EMPTY_OFFER' });
    assert.equal(pool.state.trades.get(created.trade.id).escrow_to, false);
});

test('trade returns escrowed assets after expiry, including when the season is locked', async () => {
    const pool = createPool();
    const created = await createTrade({
        pool, env: { BALANCE_POOL_SEASON_DEADLINE: String(now + 100) },
        telegramId: '12345', requestId: requestId('07'), targetUserId: '67890',
        itemIds: ['item-a'], stars: 5, now
    });
    const result = await operateTrade({
        pool, env: { BALANCE_POOL_SEASON_DEADLINE: String(now + 100) },
        telegramId: '67890', requestId: requestId('08'), tradeId: created.trade.id,
        action: 'expire', now: now + 24 * 60 * 60 * 1000
    });
    assert.equal(result.state, 'expired');
    assert.equal(pool.state.users.get('12345').stars, '100');
    assert.equal(pool.state.users.get('12345').inventory[0].id, 'item-a');
    assert.equal(pool.state.users.get('12345').balance_pool_escrow_value, 0);
});

test('trade search returns only other users with matching prefixes', async () => {
    const result = await searchTradeUsers({ pool: createPool(), telegramId: '12345', query: 'receiver' });
    assert.equal(result.users.length, 1);
    assert.equal(result.users[0].id, '67890');
});

test('trade inventory preparation adds stable unique IDs to legacy items', async () => {
    const pool = createPool();
    const user = pool.state.users.get('12345');
    user.inventory = [{ name: 'Old gift' }, { id: 'stable', name: 'Gift' }, { id: 'stable', name: 'Duplicate' }];
    const result = await prepareTradeInventory({ pool, telegramId: '12345' });
    assert.equal(new Set(result.inventory.map(item => item.id)).size, 3);
    assert.equal(result.inventory[1].id, 'stable');
});

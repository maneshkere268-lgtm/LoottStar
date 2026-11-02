'use strict';

const { randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError, getConfig, getPoolWindow } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const ITEM_NAME = 'Durov Figure (Ropeko)';
const ITEM_PRICE = 50_000_000;
const DAILY_PERCENT = 0.10;
const DAY_MS = 24 * 60 * 60 * 1000;
const LIFETIME_MS = 90 * DAY_MS;
const RATE_PER_MS = ITEM_PRICE * DAILY_PERCENT / DAY_MS;
const ALLOWED_USERNAMES = new Set(['hazed_q', 'ropeko']);

function isEligible(username) {
    return ALLOWED_USERNAMES.has(String(username || '').replace(/^@/, '').trim().toLowerCase());
}

function createItem(now) {
    return {
        id: `ropeko_${randomUUID()}`,
        name: ITEM_NAME,
        price: ITEM_PRICE,
        stars: ITEM_PRICE,
        value: ITEM_PRICE,
        currency: 'star',
        image: '/images/DurovFigureRopeko.png',
        limited: true,
        noSell: true,
        untradeable: true,
        noStake: true,
        ropeko: true,
        dailyPercent: DAILY_PERCENT,
        lastTick: now,
        pending: 0,
        totalEarned: 0,
        expiresAt: now + LIFETIME_MS,
        timestamp: now
    };
}

async function settleRopeko({ pool, env = process.env, telegramId, requestId, now = Date.now() }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT username, stars, silver, inventory, banned,
                    balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
             FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        const user = userResult.rows[0];
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');
        if (!isEligible(user.username)) throw new OperationError(403, 'ROPEKO_NOT_ELIGIBLE');

        const previousResult = await client.query(
            'SELECT response FROM ropeko_operations WHERE telegram_id = $1 AND request_id = $2',
            [telegramId, requestId]
        );
        if (previousResult.rows.length) {
            await client.query('COMMIT');
            return { ...previousResult.rows[0].response, duplicate: true };
        }

        const inventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
        let itemIndex = inventory.findIndex(item => item?.name === ITEM_NAME && item.ropeko === true);
        if (itemIndex < 0) {
            inventory.push(createItem(now));
            itemIndex = inventory.length - 1;
        }

        let earned = 0;
        let itemExpired = false;
        const item = inventory[itemIndex];
        if (item.timestamp) {
            const startedAt = Number.isSafeInteger(Number(item.timestamp)) &&
                Number(item.timestamp) > 0 && Number(item.timestamp) <= now
                ? Number(item.timestamp)
                : now;
            const expiresAt = startedAt + LIFETIME_MS;
            const endAt = Math.min(now, expiresAt);
            const savedLastTick = Number(item.lastTick);
            const lastTick = Math.max(startedAt, Math.min(
                endAt,
                Math.max(now - DAY_MS, Number.isSafeInteger(savedLastTick) ? savedLastTick : now - DAY_MS)
            ));
            const pending = Number.isFinite(Number(item.pending)) &&
                Number(item.pending) >= 0 && Number(item.pending) < 1
                ? Number(item.pending)
                : 0;
            const gross = pending + Math.max(0, endAt - lastTick) * RATE_PER_MS;
            const requestedEarned = Math.floor(gross);
            const config = getConfig(env);
            const poolWindow = getPoolWindow(user, now, config);
            earned = Math.min(requestedEarned, Math.max(0, config.limit - poolWindow.earned));
            const expired = endAt >= expiresAt;
            itemExpired = expired;
            if (expired) {
                inventory.splice(itemIndex, 1);
            } else {
                inventory[itemIndex] = {
                    ...item,
                    timestamp: startedAt,
                    expiresAt,
                    lastTick: endAt,
                    pending: earned === requestedEarned ? gross - requestedEarned : 0,
                    totalEarned: Math.min(Number.MAX_SAFE_INTEGER,
                        Math.max(0, Number(item.totalEarned) || 0) + earned)
                };
            }
        }

        const nextStars = (BigInt(user.stars) + BigInt(earned)).toString();
        const poolState = applyPoolMutation(user, {
            stars: nextStars,
            silver: String(user.silver),
            inventory
        }, { env, now, allowSeasonReturn: itemExpired });

        await client.query(
            `UPDATE app_users SET stars = $1, inventory = $2::jsonb,
             balance_pool_started_at = $3, balance_pool_start_value = $4,
             balance_pool_escrow_value = $5, updated_at = NOW()
             WHERE telegram_id = $6`,
            [
                nextStars, JSON.stringify(inventory), poolState.balance_pool_started_at,
                poolState.balance_pool_start_value, poolState.balance_pool_escrow_value, telegramId
            ]
        );
        if (earned > 0) {
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'earn', 'star', $3, $4, 'ropeko')`,
                [telegramId, requestId, earned, nextStars]
            );
        }

        const response = {
            stars: nextStars,
            silver: String(user.silver),
            inventory,
            earned,
            duplicate: false
        };
        await client.query(
            `INSERT INTO ropeko_operations (telegram_id, request_id, response)
             VALUES ($1, $2, $3::jsonb)`,
            [telegramId, requestId, JSON.stringify(response)]
        );
        await client.query('COMMIT');
        return response;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof BalancePoolError) throw new OperationError(error.status, error.code);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { ITEM_NAME, settleRopeko };

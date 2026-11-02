'use strict';

const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { verifyTelegramInitData } = require('./telegram-auth');
const { createAdminRouter } = require('./admin');
const { createLocalAdminAuth } = require('./local-admin-auth');
const { createRequestMetrics } = require('./request-metrics');
const { OperationError } = require('./operation-errors');
const { openCase } = require('./case-opening');
const { sellItems } = require('./item-selling');
const { getActiveMines, performMinesAction, startMines } = require('./mines-game');
const { spinSlots } = require('./slots-game');
const { dropPlinko } = require('./plinko-game');
const { cashoutCrash, getCurrentCrash, startCrash } = require('./crash-game');
const { upgradeItem } = require('./item-upgrade');
const { playBags } = require('./bags-game');
const { craftItems } = require('./item-crafting');
const { getLeaderboard } = require('./leaderboard');
const { setItemSaved } = require('./item-saving');
const { redeemPromo } = require('./promo-codes');
const { claimDailyTask, loadDailyTasks } = require('./daily-tasks');
const { submitWithdrawal } = require('./withdrawals');
const { operateStaking } = require('./staking');
const { operatePhone } = require('./phone-operations');
const { normalizeState: normalizePhoneState } = require('./phone-roulette');
const { operateHalloween } = require('./halloween-event');
const { buyIndexItem } = require('./shop');
const { getLiveWins } = require('./live-wins');
const {
    BalancePoolError, applyPoolMutation,
    getConfig: getBalancePoolConfig, getPoolWindow
} = require('./balance-pool');
const { settleRopeko } = require('./ropeko');
const {
    createTrade, loadMyTrades, loadTrade, operateTrade, prepareTradeInventory, searchTradeUsers
} = require('./trades');
const { joinReferral, loadReferralProfile } = require('./referrals');
const {
    cashoutFishing, continueFishing, getActiveFishing, startFishing
} = require('./fishing-game');

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createApp({ pool, env = process.env }) {
    const app = express();
    const startedAt = Date.now();
    const metrics = createRequestMetrics();
    const localAdminAuth = createLocalAdminAuth({ env });
    const allowedOrigins = new Set(
        String(env.CORS_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean)
    );

    if (env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
    app.disable('x-powered-by');
    app.use(helmet());
    app.use(metrics.middleware);
    app.use((req, res, next) => {
        const origin = req.get('origin');
        if (origin && !allowedOrigins.has(origin)) {
            return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
        }
        if (origin) {
            res.set('Access-Control-Allow-Origin', origin);
            res.set('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') {
            res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
            return res.status(204).end();
        }
        next();
    });
    app.use(express.json({ limit: '256kb', strict: true }));

    app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
    app.get('/health/ready', asyncRoute(async (req, res) => {
        await pool.query('SELECT 1');
        res.json({ status: 'ready' });
    }));

    const apiLimiter = rateLimit({
        windowMs: 60_000,
        limit: 120,
        standardHeaders: 'draft-7',
        legacyHeaders: false
    });

    const adminLoginLimiter = rateLimit({
        windowMs: 15 * 60_000,
        limit: 5,
        standardHeaders: 'draft-7',
        legacyHeaders: false
    });
    app.post('/api/v1/admin/auth/login', adminLoginLimiter, asyncRoute(async (req, res) => {
        if (!localAdminAuth.configured) {
            return res.status(503).json({ error: 'LOCAL_ADMIN_AUTH_NOT_CONFIGURED' });
        }
        const { telegramId, password } = req.body || {};
        const session = await localAdminAuth.login(telegramId, password);
        if (!session) return res.status(401).json({ error: 'INVALID_ADMIN_CREDENTIALS' });
        res.json(session);
    }));

    app.post('/api/v1/admin/auth/logout', (req, res) => {
        const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
        if (match) localAdminAuth.revoke(match[1]);
        res.status(204).end();
    });

    app.use('/api/v1', apiLimiter, (req, res, next) => {
        const authorization = req.get('authorization') || '';
        const match = /^tma (.+)$/.exec(authorization);
        if (!match) {
            const localSession = /^Bearer (.+)$/.exec(authorization);
            if (localSession && req.path.startsWith('/admin/')) {
                const session = localAdminAuth.authenticate(localSession[1]);
                if (!session) return res.status(401).json({ error: 'ADMIN_SESSION_EXPIRED' });
                req.telegramUser = { id: session.adminId };
                return next();
            }
            return res.status(401).json({ error: 'TELEGRAM_AUTH_REQUIRED' });
        }
        try {
            req.telegramUser = verifyTelegramInitData(match[1], env.TELEGRAM_BOT_TOKEN, {
                maxAgeSeconds: Number(env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS) || 86400
            });
            Promise.resolve(pool.query(
                `INSERT INTO app_users (telegram_id, firestore_doc_id, username, first_name, last_name, photo_url)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (telegram_id) DO UPDATE SET
                    username = EXCLUDED.username,
                    first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name,
                    photo_url = EXCLUDED.photo_url,
                    updated_at = NOW()`,
                [
                    req.telegramUser.id, `id_${req.telegramUser.id}`, req.telegramUser.username,
                    req.telegramUser.firstName, req.telegramUser.lastName, req.telegramUser.photoUrl
                ]
            )).then(() => pool.query(
                    `UPDATE app_users SET banned = FALSE, ban_reason = NULL, ban_until = NULL,
                     updated_at = NOW()
                     WHERE telegram_id = $1 AND banned = TRUE AND ban_until IS NOT NULL AND ban_until <= $2`,
                    [req.telegramUser.id, Date.now()]
                )).then(() => next(), next);
        } catch (error) {
            if (error.message === 'TELEGRAM_AUTH_NOT_CONFIGURED') {
                return res.status(503).json({ error: 'TELEGRAM_AUTH_NOT_CONFIGURED' });
            }
            return res.status(401).json({ error: 'INVALID_TELEGRAM_AUTH' });
        }
    });

    app.get('/api/v1/me', asyncRoute(async (req, res) => {
        const { rows } = await pool.query(
            `SELECT telegram_id, username, first_name, last_name, photo_url,
                    stars, silver, pearl, turnover, silver_turnover, withdraw_cycles,
                    inventory, collection_items, free_case_usage, banned, ban_reason, ban_until,
                    profile_phone AS phone, halloween_xp, halloween_pumpkins, halloween_state,
                    balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value,
                    updated_at
             FROM app_users WHERE telegram_id = $1`,
            [req.telegramUser.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'ACCOUNT_NOT_MIGRATED' });
        rows[0].phone = normalizePhoneState(rows[0].phone);
        const now = Date.now();
        const balancePoolConfig = getBalancePoolConfig(env);
        const balancePoolWindow = getPoolWindow(rows[0], now, balancePoolConfig);
        rows[0].balance_pool = {
            limit: balancePoolConfig.limit,
            earned: balancePoolWindow.earned,
            remaining: Math.max(0, balancePoolConfig.limit - balancePoolWindow.earned),
            resetAt: balancePoolWindow.startedAt + balancePoolConfig.windowMs,
            exhausted: balancePoolWindow.exhausted,
            seasonLocked: now >= balancePoolConfig.seasonDeadline
        };
        res.json({ user: rows[0] });
    }));

    app.get('/api/v1/balance/ledger', asyncRoute(async (req, res) => {
        const requestedLimit = Number(req.query.limit);
        const limit = Number.isSafeInteger(requestedLimit)
            ? Math.min(200, Math.max(1, requestedLimit))
            : 100;
        const { rows } = await pool.query(
            `SELECT operation, currency, amount, balance_after, source, created_at
             FROM balance_ledger WHERE telegram_id = $1
             ORDER BY created_at DESC, id DESC LIMIT $2`,
            [req.telegramUser.id, limit]
        );
        return res.json({ entries: rows });
    }));

    app.get('/api/v1/app-config/events', asyncRoute(async (req, res) => {
        const { rows } = await pool.query(
            `SELECT setting_key, value FROM app_settings
             WHERE setting_key = ANY($1::text[])`,
            [['events', 'halloween']]
        );
        const settings = Object.fromEntries(rows.map(row => [row.setting_key, row.value]));
        res.json({
            events: settings.events || {},
            halloween: settings.halloween || {}
        });
    }));

    app.get('/api/v1/app-config/:key', asyncRoute(async (req, res) => {
        const allowedKeys = ['rates', 'rtp', 'tech'];
        const { key } = req.params;
        if (!allowedKeys.includes(key)) return res.status(404).json({ error: 'APP_CONFIG_NOT_FOUND' });
        const { rows } = await pool.query(
            'SELECT value FROM app_settings WHERE setting_key = $1',
            [key]
        );
        return res.json({ [key]: rows[0]?.value || {} });
    }));

    app.get('/api/v1/halloween/state', asyncRoute(async (req, res) => {
        try {
            return res.json(await operateHalloween({
                pool, env, telegramId: req.telegramUser.id, action: 'state'
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/halloween/operate', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_HALLOWEEN_REQUEST' });
        }
        try {
            return res.json(await operateHalloween({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                action: req.body?.action,
                caseId: req.body?.caseId,
                passType: req.body?.passType,
                rewardIndex: req.body?.rewardIndex,
                brewId: req.body?.brewId
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.get('/api/v1/live-wins', asyncRoute(async (req, res) => {
        return res.json(await getLiveWins({ pool, limit: req.query.limit }));
    }));

    app.post('/api/v1/shop/buy', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_SHOP_REQUEST' });
        }
        try {
            return res.json(await buyIndexItem({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                itemName: req.body?.itemName
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/profile/ropeko/settle', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_ROPEKO_REQUEST' });
        }
        try {
            return res.json(await settleRopeko({
                pool, env, telegramId: req.telegramUser.id, requestId
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.get('/api/v1/leaderboard', asyncRoute(async (req, res) => {
        try {
            const result = await getLeaderboard({
                pool,
                telegramId: req.telegramUser.id,
                sort: req.query.sort || 'stars',
                env
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        }
    }));

    app.post('/api/v1/cases/open', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        const { caseId, quantity } = req.body || {};
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_CASE_REQUEST' });
        }
        try {
            const result = await openCase({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                caseId,
                quantity
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        }
    }));

    app.post('/api/v1/inventory/sell', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        const { itemIds } = req.body || {};
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_SELL_REQUEST' });
        }
        try {
            const result = await sellItems({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                itemIds
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        }
    }));

    app.post('/api/v1/inventory/save', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_ITEM_SAVE_REQUEST' });
        }
        try {
            const result = await setItemSaved({
                pool,
                telegramId: req.telegramUser.id,
                requestId,
                itemId: req.body?.itemId,
                saved: req.body?.saved
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        }
    }));

    app.post('/api/v1/promos/redeem', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_PROMO_REQUEST' });
        }
        try {
            const result = await redeemPromo({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                code: req.body?.code
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        }
    }));

    app.get('/api/v1/tasks/daily', asyncRoute(async (req, res) => {
        try {
            return res.json(await loadDailyTasks({
                pool,
                telegramId: req.telegramUser.id
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/tasks/daily/claim', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_TASK_REQUEST' });
        }
        try {
            return res.json(await claimDailyTask({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                taskId: req.body?.taskId
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/withdrawals', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_WITHDRAWAL_REQUEST' });
        }
        try {
            return res.json(await submitWithdrawal({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                amount: req.body?.amount
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/staking/operate', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_STAKING_REQUEST' });
        }
        try {
            const result = await operateStaking({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                action: req.body?.action,
                itemId: req.body?.itemId,
                amount: req.body?.amount
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/profile/phone/operate', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_PHONE_REQUEST' });
        }
        try {
            const result = await operatePhone({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                action: req.body?.action,
                itemId: req.body?.itemId,
                keepNew: req.body?.keepNew
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.get('/api/v1/trades/users', asyncRoute(async (req, res) => {
        try {
            return res.json(await searchTradeUsers({
                pool, telegramId: req.telegramUser.id, query: req.query.q
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/trades/prepare', asyncRoute(async (req, res) => {
        try {
            return res.json(await prepareTradeInventory({ pool, telegramId: req.telegramUser.id }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.get('/api/v1/trades/me', asyncRoute(async (req, res) => {
        try {
            return res.json(await loadMyTrades({
                pool, telegramId: req.telegramUser.id, status: req.query.status || 'pending'
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/trades', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_TRADE_REQUEST' });
        }
        try {
            return res.json(await createTrade({
                pool, env, telegramId: req.telegramUser.id, requestId,
                targetUserId: req.body?.targetUserId, itemIds: req.body?.itemIds, stars: req.body?.stars
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.get('/api/v1/trades/:tradeId', asyncRoute(async (req, res) => {
        try {
            return res.json(await loadTrade({
                pool, telegramId: req.telegramUser.id, tradeId: req.params.tradeId
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/trades/:tradeId/operate', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_TRADE_REQUEST' });
        }
        try {
            return res.json(await operateTrade({
                pool, env, telegramId: req.telegramUser.id, requestId,
                tradeId: req.params.tradeId,
                action: req.body?.action,
                itemIds: req.body?.itemIds,
                stars: req.body?.stars
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.get('/api/v1/referrals/me', asyncRoute(async (req, res) => {
        try {
            return res.json(await loadReferralProfile({
                pool,
                telegramId: req.telegramUser.id
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/referrals/join', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_REFERRAL_REQUEST' });
        }
        try {
            return res.json(await joinReferral({
                pool,
                telegramId: req.telegramUser.id,
                requestId,
                referrerId: req.body?.referrerId
            }));
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/inventory/upgrade', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_UPGRADE_REQUEST' });
        }
        try {
            const result = await upgradeItem({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                itemId: req.body?.itemId,
                targetName: req.body?.targetName
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        }
    }));

    app.post('/api/v1/inventory/craft', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_CRAFT_REQUEST' });
        }
        try {
            const result = await craftItems({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                itemIds: req.body?.itemIds,
                currency: req.body?.currency
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        }
    }));

    app.post('/api/v1/games/bags/open', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_BAGS_REQUEST' });
        }
        try {
            const result = await playBags({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                amount: req.body?.amount,
                currency: req.body?.currency
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        }
    }));

    app.get('/api/v1/games/fishing/current', asyncRoute(async (req, res) => {
        const result = await getActiveFishing({ pool, telegramId: req.telegramUser.id });
        res.json(result);
    }));

    app.post('/api/v1/games/fishing/start', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_FISHING_REQUEST' });
        }
        try {
            const result = await startFishing({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                amount: req.body?.amount,
                currency: req.body?.currency
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/games/fishing/continue', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_FISHING_REQUEST' });
        }
        try {
            const result = await continueFishing({
                pool,
                telegramId: req.telegramUser.id,
                requestId,
                gameId: req.body?.gameId
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/games/fishing/cashout', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_FISHING_REQUEST' });
        }
        try {
            const result = await cashoutFishing({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                gameId: req.body?.gameId
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.get('/api/v1/games/mines/current', asyncRoute(async (req, res) => {
        const game = await getActiveMines({ pool, telegramId: req.telegramUser.id });
        res.json({ game });
    }));

    app.post('/api/v1/games/mines/start', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_MINES_REQUEST' });
        }
        try {
            const result = await startMines({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                amount: req.body?.amount,
                currency: req.body?.currency,
                minesCount: req.body?.minesCount
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/games/mines/:action', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_MINES_REQUEST' });
        }
        try {
            const result = await performMinesAction({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                gameId: req.body?.gameId,
                action: req.params.action,
                cell: req.body?.cell
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/games/slots/spin', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_SLOTS_REQUEST' });
        }
        try {
            const result = await spinSlots({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                amount: req.body?.amount,
                currency: req.body?.currency
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/games/plinko/drop', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_PLINKO_REQUEST' });
        }
        try {
            const result = await dropPlinko({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                amount: req.body?.amount,
                currency: req.body?.currency,
                difficulty: req.body?.difficulty
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.get('/api/v1/games/crash/current', asyncRoute(async (req, res) => {
        const result = await getCurrentCrash({ pool, telegramId: req.telegramUser.id });
        res.json(result);
    }));

    app.post('/api/v1/games/crash/start', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_CRASH_REQUEST' });
        }
        try {
            const result = await startCrash({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                amount: req.body?.amount,
                currency: req.body?.currency
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/games/crash/cashout', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
            return res.status(400).json({ error: 'INVALID_CRASH_REQUEST' });
        }
        try {
            const result = await cashoutCrash({
                pool,
                env,
                telegramId: req.telegramUser.id,
                requestId,
                gameId: req.body?.gameId
            });
            return res.json(result);
        } catch (error) {
            if (error instanceof OperationError) return res.status(error.status).json({ error: error.code });
            throw error;
        }
    }));

    app.post('/api/v1/balance/spend', asyncRoute(async (req, res) => {
        const requestId = req.get('idempotency-key');
        const { currency, amount } = req.body || {};
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '') ||
            !['star', 'silver'].includes(currency) ||
            !Number.isSafeInteger(amount) || amount <= 0) {
            return res.status(400).json({ error: 'INVALID_SPEND_REQUEST' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const userResult = await client.query(
                `SELECT stars, silver, inventory, balance_pool_started_at, balance_pool_start_value,
                        balance_pool_escrow_value, banned
                 FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
                [req.telegramUser.id]
            );
            if (!userResult.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'ACCOUNT_NOT_MIGRATED' });
            }
            if (userResult.rows[0].banned) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'ACCOUNT_BANNED' });
            }

            const previous = await client.query(
                `SELECT operation, currency, amount, balance_after
                 FROM balance_ledger WHERE telegram_id = $1 AND request_id = $2`,
                [req.telegramUser.id, requestId]
            );
            if (previous.rows.length) {
                const entry = previous.rows[0];
                if (entry.operation !== 'spend' || entry.currency !== currency || entry.amount !== String(amount)) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED' });
                }
                await client.query('COMMIT');
                return res.json({ currency, balance: entry.balance_after, duplicate: true });
            }

            const user = userResult.rows[0];
            const balanceField = currency === 'silver' ? 'silver' : 'stars';
            const currentBalance = Number(user[balanceField]);
            if (currentBalance < amount) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'INSUFFICIENT_FUNDS' });
            }
            const next = {
                stars: Number(user.stars),
                silver: Number(user.silver),
                inventory: user.inventory
            };
            next[balanceField] -= amount;
            const poolMutation = applyPoolMutation(user, next, { env });
            await client.query(
                `UPDATE app_users SET stars = $1, silver = $2,
                 balance_pool_started_at = $3, balance_pool_start_value = $4,
                 balance_pool_escrow_value = $5, updated_at = NOW()
                 WHERE telegram_id = $6`,
                [
                    next.stars, next.silver, poolMutation.balance_pool_started_at,
                    poolMutation.balance_pool_start_value, poolMutation.balance_pool_escrow_value,
                    req.telegramUser.id
                ]
            );
            const balance = String(next[balanceField]);
            await client.query(
                `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                 VALUES ($1, $2, 'spend', $3, $4, $5, 'api')`,
                [req.telegramUser.id, requestId, currency, amount, balance]
            );
            await client.query('COMMIT');
            return res.json({ currency, balance, duplicate: false });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            if (error instanceof BalancePoolError) {
                return res.status(error.status).json({ error: error.code });
            }
            throw error;
        } finally {
            client.release();
        }
    }));

    app.use('/api/v1/admin', createAdminRouter({ pool, metrics, env, startedAt: () => startedAt }));

    app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
    app.use((error, req, res, next) => {
        console.error('[api] request failed:', error);
        if (res.headersSent) return next(error);
        const status = error.status === 400 || error.status === 413 ? error.status : 500;
        res.status(status).json({ error: status === 400 ? 'INVALID_REQUEST' :
            status === 413 ? 'REQUEST_TOO_LARGE' : 'INTERNAL_SERVER_ERROR' });
    });
    return app;
}

module.exports = { createApp };

'use strict';

const express = require('express');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { getAssetValue, getConfig, getPoolWindow } = require('./balance-pool');

const MAX_DB_BALANCE = 9_223_372_036_854_775_807n;

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validJson(value, maxLength = 100_000) {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxLength;
    } catch {
        return false;
    }
}

function parseAdminIds(value) {
    return new Set(String(value || '').split(',').map(id => id.trim()).filter(id => /^[1-9]\d{0,19}$/.test(id)));
}

function createAdminRouter({ pool, metrics, env = process.env, startedAt = Date.now }) {
    const router = express.Router();
    const admins = parseAdminIds(env.ADMIN_TELEGRAM_IDS);

    router.use((req, res, next) => {
        if (admins.size === 0) return res.status(503).json({ error: 'ADMIN_ACCESS_NOT_CONFIGURED' });
        if (!admins.has(req.telegramUser.id)) return res.status(403).json({ error: 'ADMIN_ACCESS_DENIED' });
        next();
    });

    async function audit(client, adminId, action, subjectType, subjectId, details = {}) {
        await client.query(
            `INSERT INTO admin_audit_logs (admin_telegram_id, action, subject_type, subject_id, details)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [adminId, action, subjectType, subjectId || null, JSON.stringify(details)]
        );
    }

    router.get('/overview', asyncRoute(async (req, res) => {
        const [users, activity, database] = await Promise.all([
            pool.query(`
                SELECT COUNT(*)::text AS users,
                       COALESCE(SUM(stars), 0)::text AS stars,
                       COALESCE(SUM(silver), 0)::text AS silver,
                       COALESCE(SUM(pearl), 0)::text AS pearl,
                       COUNT(*) FILTER (WHERE banned)::text AS banned,
                       COALESCE(SUM(jsonb_array_length(inventory)), 0)::text AS inventory_items
                FROM app_users
            `),
            pool.query(`
                SELECT COUNT(*) FILTER (WHERE state = 'active')::text AS active_connections,
                       COUNT(*)::text AS total_connections
                FROM pg_stat_activity WHERE datname = current_database()
            `),
            pool.query('SELECT pg_database_size(current_database())::text AS bytes')
        ]);
        const memory = process.memoryUsage();
        const cpus = os.cpus();
        res.json({
            process: {
                pid: process.pid,
                nodeVersion: process.version,
                uptimeSeconds: Math.floor(process.uptime()),
                startedAt: new Date(startedAt()).toISOString(),
                memory: {
                    rssBytes: memory.rss,
                    heapUsedBytes: memory.heapUsed,
                    heapTotalBytes: memory.heapTotal,
                    externalBytes: memory.external
                },
                cpuCount: cpus.length,
                loadAverage: os.loadavg(),
                systemMemory: { totalBytes: os.totalmem(), freeBytes: os.freemem() }
            },
            database: {
                name: 'lootstar',
                sizeBytes: Number(database.rows[0].bytes),
                activeConnections: Number(activity.rows[0].active_connections),
                totalConnections: Number(activity.rows[0].total_connections),
                pool: {
                    total: pool.totalCount ?? null,
                    idle: pool.idleCount ?? null,
                    waiting: pool.waitingCount ?? null
                }
            },
            users: Object.fromEntries(Object.entries(users.rows[0]).map(([key, value]) => [key, Number(value)])),
            requests: metrics.snapshot(0).totalRequests
        });
    }));

    router.get('/requests', (req, res) => {
        const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
        res.json(metrics.snapshot(limit));
    });

    router.get('/withdrawals', asyncRoute(async (req, res) => {
        const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
        if (!['pending', 'approved', 'paid', 'rejected', 'all'].includes(status)) {
            return res.status(400).json({ error: 'INVALID_WITHDRAWAL_STATUS' });
        }
        const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
        const { rows } = await pool.query(
            `SELECT w.telegram_id, w.request_id, w.amount_loot_star, w.amount_telegram_stars,
                    w.rate_loot_star_per_telegram_star, w.status, w.request, w.admin_note,
                    w.created_at, w.updated_at, u.username, u.first_name, u.last_name
             FROM withdrawal_requests w
             JOIN app_users u ON u.telegram_id = w.telegram_id
             WHERE $1 = 'all' OR w.status = $1
             ORDER BY w.created_at DESC LIMIT $2`,
            [status, limit]
        );
        res.json({ withdrawals: rows });
    }));

    router.patch('/withdrawals/:telegramId/:requestId', asyncRoute(async (req, res) => {
        const { telegramId, requestId } = req.params;
        const { status, note = '' } = req.body || {};
        if (!/^[1-9]\d{0,19}$/.test(telegramId) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
            !['paid', 'rejected'].includes(status) || typeof note !== 'string' || note.length > 1000) {
            return res.status(400).json({ error: 'INVALID_WITHDRAWAL_UPDATE' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const withdrawalResult = await client.query(
                `SELECT amount_loot_star, amount_telegram_stars, status, request
                 FROM withdrawal_requests WHERE telegram_id = $1 AND request_id = $2 FOR UPDATE`,
                [telegramId, requestId]
            );
            if (!withdrawalResult.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'WITHDRAWAL_NOT_FOUND' });
            }
            const withdrawal = withdrawalResult.rows[0];
            if (withdrawal.status !== 'pending') {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'WITHDRAWAL_ALREADY_PROCESSED' });
            }

            if (status === 'rejected') {
                const userResult = await client.query(
                    `SELECT stars, silver, inventory, balance_pool_started_at,
                            balance_pool_start_value, balance_pool_escrow_value
                     FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
                    [telegramId]
                );
                if (!userResult.rows.length) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'USER_NOT_FOUND' });
                }
                const user = userResult.rows[0];
                const stars = BigInt(user.stars) + BigInt(withdrawal.amount_loot_star);
                if (stars > MAX_DB_BALANCE) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ error: 'BALANCE_LIMIT_REACHED' });
                }
                const config = getConfig(env);
                const poolState = getPoolWindow(user, Date.now(), config);
                const next = {
                    stars: stars.toString(),
                    silver: String(user.silver),
                    inventory: Array.isArray(user.inventory) ? user.inventory : [],
                    balance_pool_escrow_value: user.balance_pool_escrow_value
                };
                const startValue = Math.max(0, getAssetValue(next) - poolState.earned);
                await client.query(
                    `UPDATE app_users SET stars = $1, balance_pool_started_at = $2,
                     balance_pool_start_value = $3, updated_at = NOW()
                     WHERE telegram_id = $4`,
                    [stars.toString(), poolState.startedAt, startValue, telegramId]
                );
                await client.query(
                    `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                     VALUES ($1, $2, 'earn', 'star', $3, $4, 'withdrawal:refund')`,
                    [telegramId, randomUUID(), withdrawal.amount_loot_star, stars.toString()]
                );
            }

            const updated = await client.query(
                `UPDATE withdrawal_requests SET status = $1, admin_note = NULLIF($2, ''),
                 request = request || jsonb_build_object('status', $1),
                 updated_at = NOW()
                 WHERE telegram_id = $3 AND request_id = $4
                 RETURNING telegram_id, request_id, amount_loot_star, amount_telegram_stars, status, request`,
                [status, note, telegramId, requestId]
            );
            await audit(
                client, req.telegramUser.id, `withdrawal_${status}`, 'withdrawal',
                `${telegramId}:${requestId}`,
                { amountLootStar: String(withdrawal.amount_loot_star), note }
            );
            await client.query('COMMIT');
            return res.json({ withdrawal: updated.rows[0], refunded: status === 'rejected' });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }));

    router.get('/users', asyncRoute(async (req, res) => {
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
        const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
        const searchValue = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
        const { rows } = await pool.query(
            `SELECT telegram_id, username, first_name, last_name, photo_url, stars, silver, pearl,
                    turnover, silver_turnover, withdraw_cycles, jsonb_array_length(inventory)::int AS inventory_count,
                    banned, ban_reason, ban_until, updated_at
             FROM app_users
             WHERE $1 = '' OR telegram_id ILIKE $2 ESCAPE '\\' OR username ILIKE $2 ESCAPE '\\'
                 OR first_name ILIKE $2 ESCAPE '\\' OR last_name ILIKE $2 ESCAPE '\\'
             ORDER BY stars DESC, telegram_id ASC LIMIT $3 OFFSET $4`,
            [query, searchValue, limit, offset]
        );
        res.json({ users: rows, limit, offset });
    }));

    router.get('/users/:telegramId', asyncRoute(async (req, res) => {
        const { rows } = await pool.query(
            'SELECT * FROM app_users WHERE telegram_id = $1',
            [req.params.telegramId]
        );
        if (!rows.length) return res.status(404).json({ error: 'USER_NOT_FOUND' });
        res.json({ user: rows[0] });
    }));

    router.patch('/users/:telegramId', asyncRoute(async (req, res) => {
        const allowed = new Set([
            'username', 'first_name', 'last_name', 'photo_url', 'stars', 'silver', 'pearl',
            'turnover', 'silver_turnover', 'withdraw_cycles', 'inventory', 'collection_items',
            'free_case_usage', 'banned', 'ban_reason', 'ban_until', 'legacy_data'
        ]);
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).length === 0 || Object.keys(body).some(key => !allowed.has(key)) ||
            !validJson(body)) {
            return res.status(400).json({ error: 'INVALID_USER_PATCH' });
        }

        const jsonFields = new Set(['inventory', 'collection_items', 'free_case_usage', 'legacy_data']);
        const stringLimits = { username: 64, first_name: 128, last_name: 128, photo_url: 2048, ban_reason: 1000 };
        for (const [field, value] of Object.entries(body)) {
            if (jsonFields.has(field)) {
                const expected = field === 'inventory' || field === 'collection_items' ? Array.isArray(value) : value && typeof value === 'object' && !Array.isArray(value);
                if (!expected) return res.status(400).json({ error: 'INVALID_USER_PATCH' });
            } else if (Object.hasOwn(stringLimits, field)) {
                if (typeof value !== 'string' || value.length > stringLimits[field]) {
                    return res.status(400).json({ error: 'INVALID_USER_PATCH' });
                }
            } else if (['stars', 'silver', 'pearl', 'turnover', 'silver_turnover', 'withdraw_cycles', 'ban_until'].includes(field)) {
                if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
                    return res.status(400).json({ error: 'INVALID_USER_PATCH' });
                }
            } else if (field === 'banned' && typeof value !== 'boolean') {
                return res.status(400).json({ error: 'INVALID_USER_PATCH' });
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const currentResult = await client.query(
                'SELECT * FROM app_users WHERE telegram_id = $1 FOR UPDATE',
                [req.params.telegramId]
            );
            if (!currentResult.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'USER_NOT_FOUND' });
            }

            const current = currentResult.rows[0];
            const columns = Object.keys(body);
            const assignments = columns.map((field, index) =>
                `${field} = $${index + 2}${jsonFields.has(field) ? '::jsonb' : ''}`
            );
            assignments.push('updated_at = NOW()');
            const values = columns.map(field => jsonFields.has(field) ? JSON.stringify(body[field]) : body[field]);
            const result = await client.query(
                `UPDATE app_users SET ${assignments.join(', ')}
                 WHERE telegram_id = $1 RETURNING *`,
                [req.params.telegramId, ...values]
            );
            const updated = result.rows[0];

            for (const field of ['stars', 'silver']) {
                if (columns.includes(field) && BigInt(updated[field]) !== BigInt(current[field])) {
                    const difference = BigInt(updated[field]) - BigInt(current[field]);
                    await client.query(
                        `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [
                            req.params.telegramId, randomUUID(), difference > 0n ? 'earn' : 'spend',
                            field === 'stars' ? 'star' : 'silver', (difference > 0n ? difference : -difference).toString(),
                            updated[field], `admin:${req.telegramUser.id}`
                        ]
                    );
                }
            }
            await audit(client, req.telegramUser.id, 'user_updated', 'user', req.params.telegramId, { fields: columns });
            await client.query('COMMIT');
            res.json({ user: updated });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }));

    router.get('/settings', asyncRoute(async (req, res) => {
        const { rows } = await pool.query(
            'SELECT setting_key, value, updated_by, updated_at FROM app_settings ORDER BY setting_key LIMIT 500'
        );
        res.json({ settings: rows });
    }));

    router.delete('/settings/:key', asyncRoute(async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(
                'DELETE FROM app_settings WHERE setting_key = $1 RETURNING setting_key',
                [req.params.key]
            );
            if (!result.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'SETTING_NOT_FOUND' });
            }
            await audit(client, req.telegramUser.id, 'setting_deleted', 'setting', req.params.key);
            await client.query('COMMIT');
            res.status(204).end();
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }));

    router.get('/records', asyncRoute(async (req, res) => {
        const { rows } = await pool.query(
            `SELECT namespace, COUNT(*)::text AS records, MAX(updated_at) AS updated_at
             FROM app_records GROUP BY namespace ORDER BY namespace LIMIT 500`
        );
        res.json({ namespaces: rows });
    }));

    router.put('/settings/:key', asyncRoute(async (req, res) => {
        if (!/^[a-zA-Z0-9._-]{1,120}$/.test(req.params.key) || !validJson(req.body) ||
            !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ error: 'INVALID_SETTING' });
        }
        const { rows } = await pool.query(
            `INSERT INTO app_settings (setting_key, value, updated_by)
             VALUES ($1, $2::jsonb, $3)
             ON CONFLICT (setting_key) DO UPDATE
             SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
             RETURNING setting_key, value, updated_by, updated_at`,
            [req.params.key, JSON.stringify(req.body), req.telegramUser.id]
        );
        await pool.query(
            `INSERT INTO admin_audit_logs (admin_telegram_id, action, subject_type, subject_id)
             VALUES ($1, 'setting_updated', 'setting', $2)`,
            [req.telegramUser.id, req.params.key]
        );
        res.json({ setting: rows[0] });
    }));

    router.get('/records/:namespace', asyncRoute(async (req, res) => {
        if (!/^[a-zA-Z0-9._-]{1,80}$/.test(req.params.namespace)) {
            return res.status(400).json({ error: 'INVALID_NAMESPACE' });
        }
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
        const { rows } = await pool.query(
            `SELECT record_key, value, updated_by, created_at, updated_at FROM app_records
             WHERE namespace = $1 ORDER BY updated_at DESC, record_key LIMIT $2 OFFSET $3`,
            [req.params.namespace, limit, offset]
        );
        res.json({ namespace: req.params.namespace, records: rows, limit, offset });
    }));

    router.put('/records/:namespace/:key', asyncRoute(async (req, res) => {
        const { namespace, key } = req.params;
        if (!/^[a-zA-Z0-9._-]{1,80}$/.test(namespace) || key.length < 1 || key.length > 160 ||
            !validJson(req.body) || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ error: 'INVALID_RECORD' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                `INSERT INTO app_records (namespace, record_key, value, updated_by)
                 VALUES ($1, $2, $3::jsonb, $4)
                 ON CONFLICT (namespace, record_key) DO UPDATE
                 SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                 RETURNING namespace, record_key, value, updated_by, created_at, updated_at`,
                [namespace, key, JSON.stringify(req.body), req.telegramUser.id]
            );
            await audit(client, req.telegramUser.id, 'record_upserted', namespace, key);
            await client.query('COMMIT');
            res.json({ record: rows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }));

    router.delete('/records/:namespace/:key', asyncRoute(async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(
                'DELETE FROM app_records WHERE namespace = $1 AND record_key = $2 RETURNING record_key',
                [req.params.namespace, req.params.key]
            );
            if (!result.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'RECORD_NOT_FOUND' });
            }
            await audit(client, req.telegramUser.id, 'record_deleted', req.params.namespace, req.params.key);
            await client.query('COMMIT');
            res.status(204).end();
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }));

    router.get('/audit', asyncRoute(async (req, res) => {
        const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
        const { rows } = await pool.query(
            `SELECT id, admin_telegram_id, action, subject_type, subject_id, details, created_at
             FROM admin_audit_logs ORDER BY created_at DESC, id DESC LIMIT $1`,
            [limit]
        );
        res.json({ entries: rows });
    }));

    return router;
}

module.exports = { createAdminRouter, parseAdminIds };

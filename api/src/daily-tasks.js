'use strict';

const { randomUUID } = require('node:crypto');
const { applyPoolMutation, BalancePoolError } = require('./balance-pool');
const { OperationError } = require('./operation-errors');

const TASKS = Object.freeze([
    { id: 'star_bets_5', currency: 'star', target: 5, reward: 25_000, xp: 100, kind: 'bets' },
    { id: 'star_mines_10', currency: 'star', target: 10, reward: 50_000, xp: 250, kind: 'mines' },
    { id: 'star_win_3x', currency: 'star', target: 1, reward: 80_000, xp: 500, kind: 'win3' },
    { id: 'star_slots_15', currency: 'star', target: 15, reward: 120_000, xp: 750, kind: 'slots' },
    { id: 'star_win_5x', currency: 'star', target: 1, reward: 175_000, xp: 1000, kind: 'win5' },
    { id: 'star_win_10x', currency: 'star', target: 1, reward: 250_000, xp: 1500, kind: 'win10' },
    { id: 'silver_bets_5', currency: 'silver', target: 5, reward: 2500, xp: 100, kind: 'bets' },
    { id: 'silver_mines_10', currency: 'silver', target: 10, reward: 5000, xp: 250, kind: 'mines' },
    { id: 'silver_win_3x', currency: 'silver', target: 1, reward: 8000, xp: 500, kind: 'win3' },
    { id: 'silver_slots_15', currency: 'silver', target: 15, reward: 12000, xp: 750, kind: 'slots' },
    { id: 'silver_win_5x', currency: 'silver', target: 1, reward: 18000, xp: 1000, kind: 'win5' },
    { id: 'silver_win_10x', currency: 'silver', target: 1, reward: 25000, xp: 1500, kind: 'win10' }
]);

const GAME_OPERATIONS = [
    'mines_start', 'slots_spin', 'plinko_drop', 'crash_start',
    'mines_reveal', 'mines_cashout', 'crash_cashout'
];

function getUtcDay(now) {
    return new Date(now).toISOString().slice(0, 10);
}

function getDayBounds(day) {
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return [start.toISOString(), end.toISOString()];
}

function winCondition(currency, multiplier) {
    return `(
        (operation IN ('slots_spin', 'plinko_drop')
            AND request->>'currency' = '${currency}'
            AND (response->>'displayMultiplier')::numeric >= ${multiplier})
        OR
        (operation = 'crash_cashout'
            AND response->'game'->>'currency' = '${currency}'
            AND response->'game'->>'status' = 'won'
            AND (response->'game'->>'cashoutMultiplier')::numeric >= ${multiplier})
        OR
        (operation IN ('mines_reveal', 'mines_cashout')
            AND response->'game'->>'currency' = '${currency}'
            AND response->'game'->>'status' = 'won'
            AND (response->'game'->>'payout')::numeric /
                NULLIF((response->'game'->>'betAmount')::numeric, 0) >= ${multiplier})
    )`;
}

function progressQuery() {
    const fields = [];
    for (const currency of ['star', 'silver']) {
        fields.push(
            `COUNT(*) FILTER (
                WHERE operation IN ('mines_start', 'slots_spin', 'plinko_drop', 'crash_start')
                AND request->>'currency' = '${currency}'
            ) AS ${currency}_bets`,
            `COUNT(*) FILTER (
                WHERE operation = 'mines_start' AND request->>'currency' = '${currency}'
            ) AS ${currency}_mines`,
            `COUNT(*) FILTER (
                WHERE operation = 'slots_spin' AND request->>'currency' = '${currency}'
            ) AS ${currency}_slots`
        );
        for (const multiplier of [3, 5, 10]) {
            fields.push(
                `COALESCE(MAX(CASE WHEN ${winCondition(currency, multiplier)}
                    THEN 1 ELSE 0 END), 0) AS ${currency}_win_${multiplier}`
            );
        }
    }
    return `SELECT ${fields.join(', ')}
        FROM game_operations
        WHERE telegram_id = $1 AND created_at >= $2 AND created_at < $3
        AND operation = ANY($4::text[])`;
}

function getProgress(stats, task) {
    const field = task.kind === 'bets' ? `${task.currency}_bets`
        : task.kind === 'mines' ? `${task.currency}_mines`
            : task.kind === 'slots' ? `${task.currency}_slots`
                : `${task.currency}_win_${task.kind.slice(3)}`;
    return Math.min(task.target, Number(stats[field]) || 0);
}

async function loadDailyTasks({ pool, telegramId, now = Date.now() }) {
    const day = getUtcDay(now);
    const [start, end] = getDayBounds(day);
    const [userResult, statsResult, claimsResult] = await Promise.all([
        pool.query(
            'SELECT halloween_xp FROM app_users WHERE telegram_id = $1',
            [telegramId]
        ),
        pool.query(progressQuery(), [telegramId, start, end, GAME_OPERATIONS]),
        pool.query(
            'SELECT task_id FROM daily_task_claims WHERE telegram_id = $1 AND day = $2',
            [telegramId, day]
        )
    ]);
    if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
    const stats = statsResult.rows[0] || {};
    const claimed = new Set(claimsResult.rows.map(row => row.task_id));
    return {
        day,
        halloweenXP: String(userResult.rows[0].halloween_xp || 0),
        tasks: TASKS.map(task => ({
            id: task.id,
            progress: getProgress(stats, task),
            claimed: claimed.has(task.id)
        }))
    };
}

async function claimDailyTask({ pool, env = process.env, telegramId, requestId, taskId, now = Date.now() }) {
    const task = TASKS.find(item => item.id === taskId);
    if (!task) throw new OperationError(400, 'INVALID_TASK_ID');
    const day = getUtcDay(now);
    const [start, end] = getDayBounds(day);
    const field = task.currency === 'silver' ? 'silver' : 'stars';
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            `SELECT stars, silver, inventory, banned, halloween_xp,
                    balance_pool_started_at, balance_pool_start_value, balance_pool_escrow_value
             FROM app_users WHERE telegram_id = $1 FOR UPDATE`,
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        const user = userResult.rows[0];
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');

        const previousResult = await client.query(
            `SELECT day, task_id, response FROM daily_task_claims
             WHERE telegram_id = $1 AND request_id = $2`,
            [telegramId, requestId]
        );
        if (previousResult.rows.length) {
            const previous = previousResult.rows[0];
            if (previous.task_id !== taskId) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const existingResult = await client.query(
            'SELECT 1 FROM daily_task_claims WHERE telegram_id = $1 AND day = $2 AND task_id = $3',
            [telegramId, day, taskId]
        );
        if (existingResult.rows.length) throw new OperationError(409, 'TASK_ALREADY_CLAIMED');

        const [progressResult] = await Promise.all([
            client.query(progressQuery(), [telegramId, start, end, GAME_OPERATIONS])
        ]);
        const progress = getProgress(progressResult.rows[0] || {}, task);
        if (progress < task.target) throw new OperationError(409, 'TASK_NOT_COMPLETED');

        const nextBalance = BigInt(user[field]) + BigInt(task.reward);
        const balances = {
            stars: task.currency === 'star' ? nextBalance.toString() : String(user.stars),
            silver: task.currency === 'silver' ? nextBalance.toString() : String(user.silver)
        };
        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const poolState = applyPoolMutation(user, { ...balances, inventory }, { env, now });
        const halloweenXP = (BigInt(user.halloween_xp || 0) + BigInt(task.xp)).toString();
        await client.query(
            `UPDATE app_users SET stars = $1, silver = $2, halloween_xp = $3,
             balance_pool_started_at = $4, balance_pool_start_value = $5,
             balance_pool_escrow_value = $6, updated_at = NOW()
             WHERE telegram_id = $7`,
            [
                balances.stars, balances.silver, halloweenXP, poolState.balance_pool_started_at,
                poolState.balance_pool_start_value, poolState.balance_pool_escrow_value, telegramId
            ]
        );
        await client.query(
            `INSERT INTO balance_ledger (telegram_id, request_id, operation, currency, amount, balance_after, source)
             VALUES ($1, $2, 'earn', $3, $4, $5, $6)`,
            [telegramId, randomUUID(), task.currency, task.reward, nextBalance.toString(), `task:${task.id}`]
        );
        const response = {
            day,
            taskId,
            progress,
            claimed: true,
            currency: task.currency,
            amount: task.reward,
            xp: task.xp,
            halloweenXP,
            stars: balances.stars,
            silver: balances.silver
        };
        await client.query(
            `INSERT INTO daily_task_claims (telegram_id, day, task_id, request_id, response)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [telegramId, day, taskId, requestId, JSON.stringify(response)]
        );
        await client.query('COMMIT');
        return { ...response, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof BalancePoolError) throw new OperationError(error.status, error.code);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { TASKS, claimDailyTask, getDayBounds, getProgress, getUtcDay, loadDailyTasks };

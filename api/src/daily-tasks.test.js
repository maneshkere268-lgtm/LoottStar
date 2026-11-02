'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { claimDailyTask, loadDailyTasks } = require('./daily-tasks');

const now = Date.parse('2026-10-15T12:00:00.000Z');
const requestId = '31c37f9e-6da8-4e8d-a44c-44d1f6b8165a';

function createPool({ progress = {}, claimed = [] } = {}) {
    const state = {
        stars: '100',
        silver: '50',
        halloweenXP: '200',
        claims: [...claimed],
        ledger: []
    };
    const stats = { ...progress };
    const pool = {
        state,
        async query(sql) {
            if (sql.includes('SELECT halloween_xp')) {
                return { rows: [{ halloween_xp: state.halloweenXP }] };
            }
            if (sql.includes('FROM game_operations')) return { rows: [stats] };
            if (sql.includes('SELECT task_id FROM daily_task_claims')) {
                return { rows: state.claims.map(task_id => ({ task_id })) };
            }
            throw new Error(`Unexpected pool query: ${sql}`);
        },
        async connect() {
            return {
                async query(sql, params = []) {
                    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
                    if (sql.includes('FROM app_users')) {
                        return { rows: [{
                            stars: state.stars,
                            silver: state.silver,
                            inventory: [],
                            banned: false,
                            halloween_xp: state.halloweenXP,
                            balance_pool_started_at: 1,
                            balance_pool_start_value: 0,
                            balance_pool_escrow_value: 0
                        }] };
                    }
                    if (sql.includes('FROM daily_task_claims') && sql.includes('request_id = $2')) {
                        const claim = state.claims.find(item => item.request_id === params[1]);
                        return { rows: claim ? [claim] : [] };
                    }
                    if (sql.includes('FROM daily_task_claims')) {
                        return { rows: state.claims.some(item => item.task_id === params[2]) ? [{}] : [] };
                    }
                    if (sql.includes('FROM game_operations')) return { rows: [stats] };
                    if (sql.startsWith('UPDATE app_users SET stars = $1, silver = $2, halloween_xp')) {
                        state.stars = params[0];
                        state.silver = params[1];
                        state.halloweenXP = params[2];
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO balance_ledger')) {
                        state.ledger.push({ currency: params[2], amount: params[3] });
                        return { rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO daily_task_claims')) {
                        state.claims.push({
                            day: params[1],
                            task_id: params[2],
                            request_id: params[3],
                            response: JSON.parse(params[4])
                        });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected client query: ${sql}`);
                },
                release() {}
            };
        }
    };
    return pool;
}

test('daily task progress comes from server operation aggregates and clamps at each target', async () => {
    const pool = createPool({
        progress: { star_bets: '8', star_mines: '12', star_slots: '20', star_win_3: '1' },
        claimed: ['star_mines_10']
    });
    const result = await loadDailyTasks({ pool, telegramId: '12345', now });
    assert.equal(result.day, '2026-10-15');
    assert.equal(result.halloweenXP, '200');
    assert.equal(result.tasks.find(task => task.id === 'star_bets_5').progress, 5);
    assert.equal(result.tasks.find(task => task.id === 'star_mines_10').claimed, true);
    assert.equal(result.tasks.find(task => task.id === 'star_slots_15').progress, 15);
});

test('daily task claim awards server-defined currency and XP once', async () => {
    const pool = createPool({ progress: { star_bets: '5' } });
    const input = {
        pool,
        telegramId: '12345',
        requestId,
        taskId: 'star_bets_5',
        now
    };
    const first = await claimDailyTask(input);
    const replay = await claimDailyTask(input);
    const nextDayReplay = await claimDailyTask({
        ...input,
        now: now + 24 * 60 * 60 * 1000
    });
    assert.equal(first.amount, 25_000);
    assert.equal(first.halloweenXP, '300');
    assert.equal(first.stars, '25100');
    assert.equal(replay.duplicate, true);
    assert.equal(nextDayReplay.day, '2026-10-15');
    assert.equal(nextDayReplay.duplicate, true);
    assert.equal(pool.state.stars, '25100');
    assert.equal(pool.state.halloweenXP, '300');
    assert.equal(pool.state.ledger.length, 1);
    assert.equal(pool.state.claims.length, 1);
});

test('daily tasks cannot be claimed before server-side progress reaches the target', async () => {
    const pool = createPool({ progress: { star_bets: '4' } });
    await assert.rejects(() => claimDailyTask({
        pool,
        telegramId: '12345',
        requestId,
        taskId: 'star_bets_5',
        now
    }), { code: 'TASK_NOT_COMPLETED' });
});

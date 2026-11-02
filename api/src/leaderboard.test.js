'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getLeaderboard, getPrizeDeadline, sanitizePrefix } = require('./leaderboard');
const { OperationError } = require('./operation-errors');

function createPool({ users = [], currentUser = null, storedWinner = null } = {}) {
    const state = { storedWinner, queries: [] };
    return {
        state,
        async query(sql, params = []) {
            state.queries.push({ sql, params });
            if (sql.includes('ORDER BY stars DESC')) return { rows: users };
            if (sql.includes('ORDER BY silver DESC')) return { rows: users };
            if (sql.includes('WHERE telegram_id = $1')) {
                return { rows: currentUser ? [{ docId: currentUser }] : [] };
            }
            if (sql.startsWith('SELECT value FROM app_settings')) {
                return { rows: state.storedWinner ? [{ value: state.storedWinner }] : [] };
            }
            if (sql.startsWith('INSERT INTO app_settings')) {
                if (!state.storedWinner) {
                    state.storedWinner = JSON.parse(params[1]);
                }
                return { rows: [] };
            }
            throw new Error(`Unexpected SQL in test: ${sql}`);
        }
    };
}

test('leaderboard validates sort and returns mapped rankings', async () => {
    const pool = createPool({
        users: [{ docId: 'id_1', name: 'Player', stars: '42', silver: '8', inventoryCount: 2 }],
        currentUser: 'id_1'
    });
    const result = await getLeaderboard({
        pool, telegramId: '1', sort: 'stars', env: { BALANCE_POOL_SEASON_DEADLINE: '9999999999999' }
    });
    assert.equal(result.users[0].name, 'Player');
    assert.equal(result.myDocId, 'id_1');
    assert.equal(result.winnerDocId, null);
    await assert.rejects(() => getLeaderboard({ pool, telegramId: '1', sort: 'username' }),
        error => error instanceof OperationError && error.code === 'INVALID_LEADERBOARD_SORT');
    assert.deepEqual(sanitizePrefix({ text: '<img>', color: 'red" onerror="alert(1)' }), {
        text: '<img>', color: '#FFB46B', glow: false
    });
});

test('leaderboard stores one eligible prize winner after the deadline', async () => {
    const pool = createPool({
        users: [
            { docId: 'admin', username: 'hazed_q' },
            { docId: 'winner', username: 'player' }
        ]
    });
    const result = await getLeaderboard({
        pool,
        telegramId: '12345',
        sort: 'stars',
        now: 20_000,
        env: { BALANCE_POOL_SEASON_DEADLINE: '10000' }
    });
    assert.equal(result.winnerDocId, 'winner');
    assert.equal(pool.state.storedWinner.winnerDocId, 'winner');
    assert.equal(pool.state.queries.filter(query => query.sql.startsWith('INSERT INTO app_settings')).length, 1);
});

test('leaderboard retains an already-decided prize winner', async () => {
    const pool = createPool({
        users: [{ docId: 'new-top', username: 'player' }],
        storedWinner: { winnerDocId: 'old-winner' }
    });
    const result = await getLeaderboard({
        pool, telegramId: '1', now: 20_000, env: { BALANCE_POOL_SEASON_DEADLINE: '10000' }
    });
    assert.equal(result.winnerDocId, 'old-winner');
    assert.equal(getPrizeDeadline({}), Date.parse('2026-12-01T00:00:00+03:00'));
});

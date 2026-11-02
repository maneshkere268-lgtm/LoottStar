'use strict';

const { OperationError } = require('./operation-errors');

const DEFAULT_PRIZE_DEADLINE = Date.parse('2026-12-01T00:00:00+03:00');
const PRIZE_SETTING_KEY = 'balancePrize2026';

function getPrizeDeadline(env) {
    return Number(env.BALANCE_POOL_SEASON_DEADLINE) || DEFAULT_PRIZE_DEADLINE;
}

function sanitizePrefix(prefix) {
    if (!prefix || typeof prefix !== 'object' || Array.isArray(prefix)) return null;
    const text = typeof prefix.text === 'string' ? prefix.text.trim().slice(0, 40) : '';
    if (!text) return null;
    const color = typeof prefix.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(prefix.color)
        ? prefix.color
        : '#FFB46B';
    return { text, color, glow: prefix.glow === true };
}

async function getLeaderboard({ pool, telegramId, sort = 'stars', env = process.env, now = Date.now() }) {
    if (!['stars', 'silver'].includes(sort)) throw new OperationError(400, 'INVALID_LEADERBOARD_SORT');
    const column = sort === 'silver' ? 'silver' : 'stars';
    const [leaderboardResult, currentUserResult] = await Promise.all([
        pool.query(
            `SELECT firestore_doc_id AS "docId",
                    COALESCE(NULLIF(first_name, ''), NULLIF(username, ''), 'Игрок') ||
                        CASE WHEN last_name IS NULL OR last_name = '' THEN '' ELSE ' ' || last_name END AS name,
                    LOWER(REGEXP_REPLACE(COALESCE(username, ''), '^@', '')) AS username,
                    photo_url AS "photoUrl",
                    stars::text AS stars,
                    silver::text AS silver,
                    jsonb_array_length(inventory)::int AS "inventoryCount",
                    legacy_data->'prefix' AS prefix
             FROM app_users
             ORDER BY ${column} DESC, telegram_id ASC
             LIMIT 50`
        ),
        pool.query('SELECT firestore_doc_id AS "docId" FROM app_users WHERE telegram_id = $1', [telegramId])
    ]);

    let winnerDocId = null;
    if (now >= getPrizeDeadline(env)) {
        const storedResult = await pool.query(
            'SELECT value FROM app_settings WHERE setting_key = $1',
            [PRIZE_SETTING_KEY]
        );
        winnerDocId = storedResult.rows[0]?.value?.winnerDocId || null;
        if (!winnerDocId) {
            const candidates = sort === 'stars'
                ? leaderboardResult.rows
                : (await pool.query(
                    `SELECT firestore_doc_id AS "docId", username
                     FROM app_users ORDER BY stars DESC, telegram_id ASC LIMIT 50`
                )).rows;
            const winner = candidates.find(user =>
                !['hazed_q', 'ropeko'].includes(String(user.username || '').toLowerCase())
            );
            if (winner) {
                await pool.query(
                    `INSERT INTO app_settings (setting_key, value, updated_by)
                     VALUES ($1, $2::jsonb, $3)
                     ON CONFLICT (setting_key) DO NOTHING`,
                    [
                        PRIZE_SETTING_KEY,
                        JSON.stringify({
                            winnerDocId: winner.docId,
                            winnerUsername: String(winner.username || '').toLowerCase(),
                            decidedAt: now,
                            deadline: getPrizeDeadline(env)
                        }),
                        telegramId
                    ]
                );
                const resolved = await pool.query(
                    'SELECT value FROM app_settings WHERE setting_key = $1',
                    [PRIZE_SETTING_KEY]
                );
                winnerDocId = resolved.rows[0]?.value?.winnerDocId || null;
            }
        }
    }

    const users = leaderboardResult.rows.map(user => ({
        ...user,
        prefix: sanitizePrefix(user.prefix)
    }));
    return {
        users,
        myDocId: currentUserResult.rows[0]?.docId || null,
        winnerDocId
    };
}

module.exports = { getLeaderboard, getPrizeDeadline, sanitizePrefix };

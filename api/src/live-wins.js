'use strict';

const { OperationError } = require('./operation-errors');

const MAX_LIMIT = 30;
const DEFAULT_LIMIT = 20;

async function recordLiveWin({ pool, telegramId, gifts, caseName, now = Date.now() }) {
    if (!Array.isArray(gifts) || gifts.length === 0) return;
    const rows = gifts
        .filter(gift => gift && typeof gift.name === 'string' && Number.isSafeInteger(gift.price) && gift.price > 0)
        .slice(0, 10)
        .map(gift => ({
            name: gift.name.slice(0, 160),
            price: gift.price,
            currency: gift.currency === 'silver' ? 'silver' : 'star',
            caseName: String(caseName || '').slice(0, 120),
            image: String(gift.image || '').slice(0, 2048)
        }));
    if (!rows.length) return;

    const values = [];
    const params = [];
    rows.forEach((row, index) => {
        const offset = index * 6;
        values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
        params.push(
            telegramId,
            row.name,
            row.price,
            row.currency,
            row.caseName,
            row.image
        );
    });

    await pool.query(
        `INSERT INTO live_wins (telegram_id, item_name, item_price, currency, case_name, image_url)
         VALUES ${values.join(', ')}`,
        params
    );
}

async function getLiveWins({ pool, limit = DEFAULT_LIMIT }) {
    const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIMIT));
    const { rows } = await pool.query(
        `SELECT item_name AS name, item_price AS price, currency, case_name AS "caseName",
                image_url AS image, created_at AS "createdAt"
         FROM live_wins ORDER BY created_at DESC, id DESC LIMIT $1`,
        [safeLimit]
    );
    return { wins: rows };
}

module.exports = { getLiveWins, recordLiveWin };
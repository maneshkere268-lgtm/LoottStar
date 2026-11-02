'use strict';

const { OperationError } = require('./operation-errors');

function isTelegramId(value) {
    return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
}

async function loadReferralProfile({ pool, telegramId }) {
    const { rows } = await pool.query(
        `SELECT
             (SELECT COUNT(*)::text FROM referral_joins WHERE referrer_telegram_id = $1) AS joined_count,
             (SELECT referrer_telegram_id FROM referral_joins WHERE referred_telegram_id = $1) AS referred_by`,
        [telegramId]
    );
    return {
        referralCode: telegramId,
        joinedCount: rows[0]?.joined_count || '0',
        referredBy: rows[0]?.referred_by || null
    };
}

async function joinReferral({ pool, telegramId, requestId, referrerId }) {
    if (!isTelegramId(referrerId)) throw new OperationError(400, 'INVALID_REFERRAL');
    if (referrerId === telegramId) throw new OperationError(400, 'SELF_REFERRAL');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            'SELECT banned FROM app_users WHERE telegram_id = $1 FOR UPDATE',
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        if (userResult.rows[0].banned) throw new OperationError(403, 'ACCOUNT_BANNED');

        const existingResult = await client.query(
            `SELECT referrer_telegram_id, request_id FROM referral_joins
             WHERE referred_telegram_id = $1`,
            [telegramId]
        );
        if (existingResult.rows.length) {
            const existing = existingResult.rows[0];
            if (existing.request_id === requestId && existing.referrer_telegram_id !== referrerId) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            if (existing.referrer_telegram_id !== referrerId) {
                throw new OperationError(409, 'REFERRAL_ALREADY_SET');
            }
            await client.query('COMMIT');
            return { referredBy: referrerId, duplicate: true };
        }

        const referrerResult = await client.query(
            'SELECT telegram_id, banned FROM app_users WHERE telegram_id = $1 FOR KEY SHARE',
            [referrerId]
        );
        if (!referrerResult.rows.length || referrerResult.rows[0].banned) {
            throw new OperationError(404, 'REFERRER_NOT_FOUND');
        }

        await client.query(
            `INSERT INTO referral_joins (referred_telegram_id, referrer_telegram_id, request_id)
             VALUES ($1, $2, $3)`,
            [telegramId, referrerId, requestId]
        );
        await client.query('COMMIT');
        return { referredBy: referrerId, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { isTelegramId, joinReferral, loadReferralProfile };

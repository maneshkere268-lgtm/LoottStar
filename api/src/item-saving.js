'use strict';

const { OperationError } = require('./operation-errors');

async function setItemSaved({ pool, telegramId, requestId, itemId, saved }) {
    if (typeof itemId !== 'string' || itemId.length < 1 || itemId.length > 160 ||
        typeof saved !== 'boolean') {
        throw new OperationError(400, 'INVALID_ITEM_SAVE_REQUEST');
    }

    const request = { itemId, saved };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(
            'SELECT stars, silver, inventory, banned FROM app_users WHERE telegram_id = $1 FOR UPDATE',
            [telegramId]
        );
        if (!userResult.rows.length) throw new OperationError(404, 'ACCOUNT_NOT_MIGRATED');
        const user = userResult.rows[0];
        if (user.banned) throw new OperationError(403, 'ACCOUNT_BANNED');

        const previousResult = await client.query(
            `SELECT operation, request, response FROM game_operations
             WHERE telegram_id = $1 AND request_id = $2`,
            [telegramId, requestId]
        );
        if (previousResult.rows.length) {
            const previous = previousResult.rows[0];
            if (previous.operation !== 'item_save' ||
                previous.request?.itemId !== itemId ||
                previous.request?.saved !== saved) {
                throw new OperationError(409, 'IDEMPOTENCY_KEY_REUSED');
            }
            await client.query('COMMIT');
            return { ...previous.response, duplicate: true };
        }

        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        if (!inventory.some(item => item?.id === itemId)) {
            throw new OperationError(409, 'ITEMS_NOT_FOUND');
        }
        const nextInventory = inventory.map(item =>
            item.id === itemId ? { ...item, saved } : item
        );
        await client.query(
            'UPDATE app_users SET inventory = $1::jsonb, updated_at = NOW() WHERE telegram_id = $2',
            [JSON.stringify(nextInventory), telegramId]
        );

        const response = {
            itemId,
            saved,
            stars: String(user.stars),
            silver: String(user.silver),
            inventory: nextInventory
        };
        await client.query(
            `INSERT INTO game_operations (telegram_id, request_id, operation, request, response)
             VALUES ($1, $2, 'item_save', $3::jsonb, $4::jsonb)`,
            [telegramId, requestId, JSON.stringify(request), JSON.stringify(response)]
        );
        await client.query('COMMIT');
        return { ...response, duplicate: false };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { setItemSaved };

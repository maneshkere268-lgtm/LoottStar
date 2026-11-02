'use strict';

const crypto = require('node:crypto');

function verifyTelegramInitData(initData, botToken, options = {}) {
    if (typeof initData !== 'string' || !initData || initData.length > 8192) {
        throw new Error('INVALID_INIT_DATA');
    }
    if (typeof botToken !== 'string' || !botToken) {
        throw new Error('TELEGRAM_AUTH_NOT_CONFIGURED');
    }

    const params = new URLSearchParams(initData);
    const values = new Map();
    for (const [key, value] of params) {
        if (values.has(key)) throw new Error('INVALID_INIT_DATA');
        values.set(key, value);
    }

    const suppliedHash = values.get('hash');
    if (!suppliedHash || !/^[a-f0-9]{64}$/i.test(suppliedHash)) {
        throw new Error('INVALID_INIT_DATA');
    }

    const dataCheckString = [...values.entries()]
        .filter(([key]) => key !== 'hash')
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();
    const actualHash = Buffer.from(suppliedHash, 'hex');
    if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(actualHash, expectedHash)) {
        throw new Error('INVALID_INIT_DATA');
    }

    const authDate = Number(values.get('auth_date'));
    const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
    const maxAgeSeconds = options.maxAgeSeconds ?? 86400;
    if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 30 ||
        nowSeconds - authDate > maxAgeSeconds) {
        throw new Error('EXPIRED_INIT_DATA');
    }

    let user;
    try {
        user = JSON.parse(values.get('user') || '');
    } catch {
        throw new Error('INVALID_INIT_DATA');
    }
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
        throw new Error('INVALID_INIT_DATA');
    }

    return {
        id: String(user.id),
        username: typeof user.username === 'string' ? user.username.replace(/^@/, '').slice(0, 64) : null,
        firstName: typeof user.first_name === 'string' ? user.first_name.slice(0, 128) : '',
        lastName: typeof user.last_name === 'string' ? user.last_name.slice(0, 128) : '',
        photoUrl: typeof user.photo_url === 'string' ? user.photo_url.slice(0, 2048) : ''
    };
}

module.exports = { verifyTelegramInitData };

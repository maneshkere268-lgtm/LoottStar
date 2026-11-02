'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyTelegramInitData } = require('./telegram-auth');

const botToken = 'test-bot-token';
const now = 1_800_000_000_000;

function makeInitData(overrides = {}) {
    const values = new Map(Object.entries({
        auth_date: String(Math.floor(now / 1000)),
        user: JSON.stringify({ id: 12345, username: 'test_user', first_name: 'Test' }),
        ...overrides
    }));
    const checkString = [...values.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
    values.set('hash', hash);
    return new URLSearchParams(values).toString();
}

test('accepts valid and recent Telegram initData', () => {
    const user = verifyTelegramInitData(makeInitData(), botToken, { now });
    assert.deepEqual(user, {
        id: '12345',
        username: 'test_user',
        firstName: 'Test',
        lastName: '',
        photoUrl: ''
    });
});

test('rejects modified Telegram initData', () => {
    const data = makeInitData().replace('test_user', 'attacker');
    assert.throws(() => verifyTelegramInitData(data, botToken, { now }), { message: 'INVALID_INIT_DATA' });
});

test('rejects expired Telegram initData', () => {
    const oldAuthDate = String(Math.floor(now / 1000) - 86401);
    assert.throws(
        () => verifyTelegramInitData(makeInitData({ auth_date: oldAuthDate }), botToken, { now }),
        { message: 'EXPIRED_INIT_DATA' }
    );
});

test('rejects duplicate fields and missing server secret', () => {
    const data = makeInitData();
    assert.throws(() => verifyTelegramInitData(`${data}&auth_date=${Math.floor(now / 1000)}`, botToken, { now }));
    assert.throws(() => verifyTelegramInitData(data, '', { now }), { message: 'TELEGRAM_AUTH_NOT_CONFIGURED' });
});

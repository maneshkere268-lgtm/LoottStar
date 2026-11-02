'use strict';

const {
    createHash,
    randomBytes,
    scrypt,
    scryptSync,
    timingSafeEqual
} = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 15 * 60 * 1000;

function parseAdminIds(value) {
    return new Set(String(value || '').split(',').map(id => id.trim()).filter(id => /^[1-9]\d{0,19}$/.test(id)));
}

function createAdminPasswordHash(password, salt = randomBytes(16)) {
    if (typeof password !== 'string' || password.length < 16 || password.length > 256) {
        throw new Error('ADMIN_PASSWORD_LENGTH_INVALID');
    }
    const derivedKey = scryptSync(password, salt, 64);
    return `scrypt:${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

function parsePasswordHash(value) {
    const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(String(value || ''));
    if (!match) return null;
    return { salt: Buffer.from(match[1], 'hex'), expected: Buffer.from(match[2], 'hex') };
}

async function verifyAdminPassword(password, passwordHash) {
    const parsed = parsePasswordHash(passwordHash);
    if (!parsed || typeof password !== 'string' || password.length > 256) return false;
    const actual = await scryptAsync(password, parsed.salt, parsed.expected.length);
    return timingSafeEqual(parsed.expected, actual);
}

function createLocalAdminAuth({ env = process.env, now = Date.now } = {}) {
    const admins = parseAdminIds(env.ADMIN_TELEGRAM_IDS);
    const passwordHash = parsePasswordHash(env.ADMIN_PASSWORD_HASH) ? env.ADMIN_PASSWORD_HASH : '';
    const sessions = new Map();

    return {
        get configured() {
            return admins.size > 0 && Boolean(passwordHash);
        },

        async login(telegramId, password) {
            if (!passwordHash || admins.size === 0) return null;
            const passwordValid = await verifyAdminPassword(password, passwordHash);
            if (!passwordValid || typeof telegramId !== 'string' || !admins.has(telegramId)) return null;

            for (const [hash, session] of sessions) {
                if (session.expiresAt <= now()) sessions.delete(hash);
            }
            if (sessions.size >= 1000) return null;

            const token = randomBytes(32).toString('base64url');
            const tokenHash = createHash('sha256').update(token).digest('hex');
            const expiresAt = now() + SESSION_TTL_MS;
            sessions.set(tokenHash, { adminId: telegramId, expiresAt });
            return { token, expiresAt };
        },

        authenticate(token) {
            if (typeof token !== 'string' || token.length > 128) return null;
            const tokenHash = createHash('sha256').update(token).digest('hex');
            const session = sessions.get(tokenHash);
            if (!session) return null;
            if (session.expiresAt <= now()) {
                sessions.delete(tokenHash);
                return null;
            }
            return { adminId: session.adminId };
        },

        revoke(token) {
            if (typeof token !== 'string' || token.length > 128) return;
            const tokenHash = createHash('sha256').update(token).digest('hex');
            sessions.delete(tokenHash);
        }
    };
}

module.exports = {
    SESSION_TTL_MS,
    createAdminPasswordHash,
    createLocalAdminAuth,
    verifyAdminPassword
};

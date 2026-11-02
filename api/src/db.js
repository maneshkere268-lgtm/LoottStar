'use strict';

const { Pool } = require('pg');

function createPool(env = process.env) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    return new Pool({
        connectionString: env.DATABASE_URL,
        ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
        max: Number(env.DATABASE_POOL_SIZE) || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
}

module.exports = { createPool };

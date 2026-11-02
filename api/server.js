'use strict';

require('dotenv').config();

const { createApp } = require('./src/app');
const { createPool } = require('./src/db');

const port = Number(process.env.PORT) || 3000;
const pool = createPool();
const app = createApp({ pool });
const server = app.listen(port, '127.0.0.1', () => {
    console.log(`[api] listening on 127.0.0.1:${port}`);
});

async function shutdown(signal) {
    console.log(`[api] received ${signal}; shutting down`);
    server.close(async error => {
        if (error) {
            console.error('[api] shutdown failed:', error);
            process.exitCode = 1;
        }
        await pool.end();
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

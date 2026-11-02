'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('../src/db');

async function main() {
    const pool = createPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(827361904)');
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        const directory = path.join(__dirname, '..', 'migrations');
        const files = (await fs.readdir(directory)).filter(file => file.endsWith('.sql')).sort();
        for (const name of files) {
            const sql = await fs.readFile(path.join(directory, name), 'utf8');
            const checksum = crypto.createHash('sha256').update(sql).digest('hex');
            const applied = await client.query(
                'SELECT checksum FROM schema_migrations WHERE name = $1',
                [name]
            );
            if (applied.rows.length) {
                if (applied.rows[0].checksum !== checksum) {
                    throw new Error(`Applied migration was changed: ${name}`);
                }
                console.log(`[db] already applied: ${name}`);
                continue;
            }
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
            console.log(`[db] applied: ${name}`);
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error('[db] migration failed:', error);
    process.exitCode = 1;
});

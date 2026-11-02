'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createAdminPasswordHash } = require('../src/local-admin-auth');

function readHidden(prompt) {
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        if (!input.isTTY || typeof input.setRawMode !== 'function') {
            reject(new Error('Run this command in an interactive terminal.'));
            return;
        }

        process.stdout.write(prompt);
        input.setRawMode(true);
        input.resume();
        input.setEncoding('utf8');

        let value = '';
        const finish = (error, result) => {
            input.removeListener('data', onData);
            input.setRawMode(false);
            process.stdout.write('\n');
            if (error) reject(error);
            else resolve(result);
        };
        const onData = character => {
            if (character === '\u0003') return finish(new Error('Cancelled.'));
            if (character === '\r' || character === '\n') return finish(null, value);
            if (character === '\u007f' || character === '\b') {
                value = value.slice(0, -1);
                return;
            }
            if (character >= ' ' && character !== '\u007f') value += character;
        };
        input.on('data', onData);
    });
}

async function main() {
    if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
        throw new Error('Run with sudo: sudo node /opt/lootstar-api/scripts/set-local-admin-password.js');
    }

    const envPath = '/etc/lootstar-api/api.env';
    const current = fs.readFileSync(envPath);
    const metadata = fs.statSync(envPath);
    const password = await readHidden('New local admin password (minimum 16 characters): ');
    const confirmation = await readHidden('Repeat password: ');
    if (password !== confirmation) throw new Error('Passwords do not match.');

    const hash = createAdminPasswordHash(password);
    const lines = current.toString('utf8').split(/\r?\n/);
    const existingIndex = lines.findIndex(line => /^\s*ADMIN_PASSWORD_HASH\s*=/.test(line));
    if (existingIndex >= 0) lines[existingIndex] = `ADMIN_PASSWORD_HASH=${hash}`;
    else lines.push(`ADMIN_PASSWORD_HASH=${hash}`);

    const temporaryPath = path.join(path.dirname(envPath), `.api.env.${process.pid}.tmp`);
    try {
        fs.writeFileSync(temporaryPath, `${lines.filter((line, index) => index < lines.length - 1 || line !== '').join('\n')}\n`, { mode: metadata.mode & 0o777 });
        fs.chownSync(temporaryPath, metadata.uid, metadata.gid);
        fs.renameSync(temporaryPath, envPath);
    } finally {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
    process.stdout.write('Local admin password hash saved to /etc/lootstar-api/api.env. Restart lootstar-api to activate it.\n');
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});

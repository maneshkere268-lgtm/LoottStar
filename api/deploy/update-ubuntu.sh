#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    printf 'Run with sudo: sudo bash %s <staged-api-directory>\n' "$0" >&2
    exit 1
fi

SOURCE_DIR="${1:-}"
APP_DIR=/opt/lootstar-api
SERVICE=lootstar-api.service
LOCK_FILE=/run/lock/lootstar-api-update.lock

if [[ ! -d "${SOURCE_DIR}" ]]; then
    echo "Provide an existing staged API source directory" >&2
    exit 1
fi
SOURCE_DIR="$(cd -- "${SOURCE_DIR}" && pwd)"
for required in package.json package-lock.json server.js migrations/002_admin_operations.sql src/admin.js; do
    if [[ ! -f "${SOURCE_DIR}/${required}" ]]; then
        printf 'Missing update file: %s\n' "${SOURCE_DIR}/${required}" >&2
        exit 1
    fi
done
if [[ ! -f /etc/lootstar-api/api.env || ! -f /etc/systemd/system/"${SERVICE}" ]]; then
    echo "The existing LootStar API installation was not found; use bootstrap-ubuntu.sh first" >&2
    exit 1
fi

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
    echo "Another LootStar API update is in progress" >&2
    exit 1
fi

install -d -o lootstar -g lootstar -m 0750 "${APP_DIR}"
chown -R lootstar:lootstar "${APP_DIR}"
tar --exclude='./node_modules' --exclude='./.env' --exclude='./.git' \
    -C "${SOURCE_DIR}" -cf - . | tar -C "${APP_DIR}" -xf -
chown -R lootstar:lootstar "${APP_DIR}"
rm -f \
    "${APP_DIR}/scripts/export-firestore.js" \
    "${APP_DIR}/scripts/import-firestore.js" \
    "${APP_DIR}/scripts/import-firestore.test.js"

runuser -u lootstar -- npm --prefix "${APP_DIR}" ci --omit=dev
runuser -u lootstar -- npm --prefix "${APP_DIR}" test
runuser -u lootstar -- env \
    DATABASE_URL='postgresql://lootstar@/lootstar?host=/var/run/postgresql' \
    npm --prefix "${APP_DIR}" run db:migrate

find "${APP_DIR}" -type d -exec chmod 0750 {} +
find "${APP_DIR}" -type f -exec chmod 0640 {} +
systemctl restart "${SERVICE}"

for attempt in $(seq 1 20); do
    if curl --fail --silent http://127.0.0.1:3000/health/ready >/dev/null; then
        echo "LootStar API update succeeded and PostgreSQL readiness is healthy."
        exit 0
    fi
    sleep 1
done

systemctl --no-pager --full status "${SERVICE}" || true
journalctl --no-pager -u "${SERVICE}" -n 50 || true
echo "API health check failed after the update" >&2
exit 1

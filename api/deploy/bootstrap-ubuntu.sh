#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    printf 'Run with sudo: sudo bash %s\n' "$0" >&2
    exit 1
fi

if [[ ! -f /etc/os-release ]]; then
    echo "Cannot identify operating system" >&2
    exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
    echo "This bootstrap supports Ubuntu 24.04 only" >&2
    exit 1
fi

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/lootstar-api
ENV_DIR=/etc/lootstar-api
SERVICE_FILE=/etc/systemd/system/lootstar-api.service
NODE_KEYRING=/etc/apt/keyrings/nodesource.gpg
NODE_REPOSITORY=/etc/apt/sources.list.d/nodesource.list

for required in package.json package-lock.json server.js migrations/001_initial.sql; do
    if [[ ! -f "${SOURCE_DIR}/${required}" ]]; then
        printf 'Missing API source file: %s\n' "${SOURCE_DIR}/${required}" >&2
        exit 1
    fi
done

if [[ -e "${APP_DIR}" || -e "${ENV_DIR}" || -e "${SERVICE_FILE}" ]]; then
    echo "An API installation path already exists; refusing to overwrite it" >&2
    exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg postgresql

install -d -m 0755 /etc/apt/keyrings
curl --fail --silent --show-error --location \
    https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o "${NODE_KEYRING}"
chmod 0644 "${NODE_KEYRING}"
printf 'deb [arch=%s signed-by=%s] https://deb.nodesource.com/node_24.x nodistro main\n' \
    "$(dpkg --print-architecture)" "${NODE_KEYRING}" > "${NODE_REPOSITORY}"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "${node_major}" -lt 20 ]]; then
    echo "Node.js 20 or newer is required" >&2
    exit 1
fi

if ! id lootstar >/dev/null 2>&1; then
    useradd --system --home-dir "${APP_DIR}" --create-home --shell /usr/sbin/nologin lootstar
fi
usermod --append --groups postgres lootstar

if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'lootstar'" | grep -qx 1; then
    runuser -u postgres -- createuser --login lootstar
fi
if runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'lootstar'" | grep -qx 1; then
    echo "Database lootstar already exists; refusing to use an unverified database" >&2
    exit 1
fi
runuser -u postgres -- createdb --owner=lootstar lootstar

install -d -o lootstar -g lootstar -m 0750 "${APP_DIR}"
tar --exclude='./node_modules' --exclude='./.env' --exclude='./.git' \
    -C "${SOURCE_DIR}" -cf - . | tar -C "${APP_DIR}" -xf -
chown -R lootstar:lootstar "${APP_DIR}"
runuser -u lootstar -- npm --prefix "${APP_DIR}" ci --omit=dev

install -d -o root -g lootstar -m 0750 "${ENV_DIR}"
cat > "${ENV_DIR}/api.env" <<'ENVIRONMENT'
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://lootstar@/lootstar?host=/var/run/postgresql
DATABASE_SSL=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=86400
CORS_ORIGINS=
TRUST_PROXY=false
ENVIRONMENT
chown root:lootstar "${ENV_DIR}/api.env"
chmod 0640 "${ENV_DIR}/api.env"

cat > "${SERVICE_FILE}" <<'UNIT'
[Unit]
Description=LootStar API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=lootstar
Group=lootstar
SupplementaryGroups=postgres
WorkingDirectory=/opt/lootstar-api
EnvironmentFile=/etc/lootstar-api/api.env
ExecStart=/usr/bin/node /opt/lootstar-api/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictSUIDSGID=true
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT

chown -R root:lootstar "${APP_DIR}"
find "${APP_DIR}" -type d -exec chmod 0750 {} +
find "${APP_DIR}" -type f -exec chmod 0640 {} +

systemctl daemon-reload
runuser -u lootstar -- env \
    DATABASE_URL='postgresql://lootstar@/lootstar?host=/var/run/postgresql' \
    npm --prefix "${APP_DIR}" run db:migrate
systemctl enable --now lootstar-api.service

for attempt in $(seq 1 20); do
    if curl --fail --silent http://127.0.0.1:3000/health/ready >/dev/null; then
        echo "LootStar API and PostgreSQL are ready on 127.0.0.1:3000"
        echo "Telegram auth is intentionally disabled until TELEGRAM_BOT_TOKEN is configured."
        exit 0
    fi
    sleep 1
done

systemctl --no-pager --full status lootstar-api.service || true
journalctl --no-pager -u lootstar-api.service -n 50 || true
echo "API health check failed" >&2
exit 1

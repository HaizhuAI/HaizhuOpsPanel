#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RUN_USER="${RUN_USER:-${SUDO_USER:-ubuntu}}"
PANEL_PORT="${PANEL_PORT:-8899}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
KEEP_ALIVE_DIR="/usr/local/lib/haizhu-opspanel"
KEEP_ALIVE_BIN="$KEEP_ALIVE_DIR/keep-alive.sh"
CONFIG_FILE="/etc/default/haizhu-opspanel"

[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { echo "Node.js was not found. Set NODE_BIN to a Node.js 22+ executable." >&2; exit 1; }
node_major="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
(( node_major >= 22 )) || { echo "Node.js 22 or newer is required." >&2; exit 1; }
[[ -d "$REPO_DIR/node_modules" ]] || { echo "Install project dependencies in $REPO_DIR before running this installer." >&2; exit 1; }
id "$RUN_USER" >/dev/null 2>&1 || { echo "User $RUN_USER does not exist." >&2; exit 1; }

if ss -ltn "sport = :$PANEL_PORT" | tail -n +2 | grep -q . && ! systemctl is-active --quiet haizhu-opspanel.service; then
  echo "Port $PANEL_PORT is already in use by a process outside haizhu-opspanel.service." >&2
  echo "Stop that process before running this installer." >&2
  exit 1
fi

install -d -o root -g root -m 0755 "$KEEP_ALIVE_DIR"
install -o root -g root -m 0755 "$REPO_DIR/scripts/keep-alive.sh" "$KEEP_ALIVE_BIN"

cat > "$CONFIG_FILE" <<EOF
PANEL_PORT=$PANEL_PORT
APP_URL=http://127.0.0.1:$PANEL_PORT/
SERVICE_NAME=haizhu-opspanel.service
MAX_FAILURES=3
EOF
chmod 0644 "$CONFIG_FILE"

cat > /etc/systemd/system/haizhu-opspanel.service <<EOF
[Unit]
Description=HaizhuOpsPanel management web app
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_DIR}
EnvironmentFile=${CONFIG_FILE}
ExecStart=${NODE_BIN} ${REPO_DIR}/server/index.js
Restart=always
RestartSec=5
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/haizhu-opspanel-keep-alive.service <<EOF
[Unit]
Description=Check and recover HaizhuOpsPanel
After=haizhu-opspanel.service

[Service]
Type=oneshot
Environment=CONFIG_FILE=${CONFIG_FILE}
ExecStart=${KEEP_ALIVE_BIN}
EOF

cat > /etc/systemd/system/haizhu-opspanel-keep-alive.timer <<'EOF'
[Unit]
Description=Check HaizhuOpsPanel every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now haizhu-opspanel.service
for _ in $(seq 1 30); do
  curl --fail --silent --max-time 3 "http://127.0.0.1:$PANEL_PORT/" >/dev/null && break
  sleep 1
done
curl --fail --silent --max-time 3 "http://127.0.0.1:$PANEL_PORT/" >/dev/null || { echo "The app did not become ready." >&2; exit 1; }
systemctl enable --now haizhu-opspanel-keep-alive.timer
systemctl start haizhu-opspanel-keep-alive.service

echo "HaizhuOpsPanel and its keep-alive timer are active."
echo "Create /run/haizhu-opspanel.maintenance before planned maintenance."
echo "Remove that file after maintenance."
echo "Protect port $PANEL_PORT with a firewall or authenticated TLS reverse proxy."

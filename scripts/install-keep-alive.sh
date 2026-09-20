#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RUN_USER="${RUN_USER:-${SUDO_USER:-ubuntu}}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"

install -d -m 0755 /etc/systemd/system

cat > /etc/systemd/system/haizhu-opspanel.service <<EOF
[Unit]
Description=HaizhuOpsPanel management web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_DIR}
Environment=PANEL_PORT=8899
Environment=PATH=$(dirname "${NODE_BIN}"):$(dirname "${NPM_BIN}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${NPM_BIN} run start:legacy
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
ExecStart=${REPO_DIR}/scripts/keep-alive.sh
EOF

cat > /etc/systemd/system/haizhu-opspanel-keep-alive.timer <<'EOF'
[Unit]
Description=Check HaizhuOpsPanel every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
EOF

chmod 0755 "${REPO_DIR}/scripts/keep-alive.sh"
systemctl daemon-reload
systemctl enable --now haizhu-opspanel.service
systemctl enable --now haizhu-opspanel-keep-alive.timer
systemctl start haizhu-opspanel-keep-alive.service

systemctl --no-pager --full status haizhu-opspanel.service
systemctl --no-pager --full status haizhu-opspanel-keep-alive.timer

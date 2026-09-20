#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${CONFIG_FILE:-/etc/default/haizhu-opspanel}"
[[ -r "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

APP_URL="${APP_URL:-http://127.0.0.1:8899/}"
STATE_DIR="${STATE_DIR:-/var/lib/haizhu-opspanel}"
MAX_FAILURES="${MAX_FAILURES:-3}"
SERVICE_NAME="${SERVICE_NAME:-haizhu-opspanel.service}"
FAILURE_FILE="$STATE_DIR/failures"
MAINTENANCE_FILE="${MAINTENANCE_FILE:-/run/haizhu-opspanel.maintenance}"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

if [[ -e "$MAINTENANCE_FILE" ]]; then
  log "maintenance mode active; health check skipped"
  exit 0
fi

mkdir -p "$STATE_DIR"
failures=0
if [[ -r "$FAILURE_FILE" ]]; then
  read -r failures < "$FAILURE_FILE" || failures=0
  [[ "$failures" =~ ^[0-9]+$ ]] || failures=0
fi

if curl --fail --silent --show-error --max-time 10 "$APP_URL" >/dev/null; then
  printf '0\n' > "$FAILURE_FILE"
  log "health check passed: $APP_URL"
  exit 0
fi

failures=$((failures + 1))
printf '%s\n' "$failures" > "$FAILURE_FILE"
log "health check failed ($failures/$MAX_FAILURES): $APP_URL"

if (( failures < MAX_FAILURES )); then
  exit 0
fi

log "restarting $SERVICE_NAME after $failures consecutive failures"
systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
if ! systemctl restart "$SERVICE_NAME"; then
  log "restart command failed for $SERVICE_NAME"
  exit 1
fi
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 3 "$APP_URL" >/dev/null; then
    printf '0\n' > "$FAILURE_FILE"
    log "service recovered after restart"
    exit 0
  fi
  sleep 1
done
log "service did not recover after restart"
exit 1

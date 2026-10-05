#!/usr/bin/env bash
# Start / stop / supervise Christmas Runner as the CloudPanel site user (no root needed).
#
#   run.sh start | stop | restart | ensure | status | wait
#
#   ensure   start the app if it isn't answering /api/health; meant for a CloudPanel
#            cron job running every minute, which also brings the app back after a reboot
#
# Layout (APP_DIR is the CloudPanel site folder, e.g. /home/user/htdocs/example.com):
#   APP_DIR/current -> releases/<sha>   code being served
#   APP_DIR/shared/                     venv, app.env, data/, logs/, brand/ (kept across deploys)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd -P)}"
SHARED="$APP_DIR/shared"
CURRENT="$APP_DIR/current"
PID_FILE="$SHARED/app.pid"
LOG_FILE="$SHARED/logs/app.log"

PORT=8090
if [[ -f "$SHARED/app.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SHARED/app.env"
  set +a
fi

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
healthy() { curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; }
pid() { [[ -f "$PID_FILE" ]] && cat "$PID_FILE"; }
running() { local p; p="$(pid)" && [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; }

start() {
  if running && healthy; then log "already running (pid $(pid))"; return 0; fi
  [[ -x "$SHARED/venv/bin/uvicorn" ]] || { log "no virtualenv at $SHARED/venv; deploy first"; return 1; }
  mkdir -p "$SHARED/logs"
  # Keep the log from growing without bound.
  if [[ -f "$LOG_FILE" ]] && (( $(stat -c %s "$LOG_FILE") > 5000000 )); then mv -f "$LOG_FILE" "$LOG_FILE.1"; fi
  cd "$CURRENT"
  nohup "$SHARED/venv/bin/uvicorn" app.main:app \
    --host 127.0.0.1 --port "$PORT" --workers 1 \
    --proxy-headers --forwarded-allow-ips 127.0.0.1 \
    </dev/null >>"$LOG_FILE" 2>&1 9>&- &   # detach from SSH and from the lock
  echo $! >"$PID_FILE"
  log "started (pid $!, port $PORT)"
}

stop() {
  local p
  if running; then
    p="$(pid)"
    kill "$p" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$p" 2>/dev/null || true
    log "stopped (pid $p)"
  fi
  rm -f "$PID_FILE"
  # A copy started without a pid file (e.g. by hand) would keep the port busy.
  pkill -u "$(id -u)" -f "uvicorn app.main:app --host 127.0.0.1 --port $PORT " 2>/dev/null || true
}

wait_healthy() {
  for _ in $(seq 1 40); do
    if healthy; then log "healthy on port $PORT"; return 0; fi
    sleep 0.5
  done
  log "not healthy after 20s; last log lines:"
  tail -n 30 "$LOG_FILE" 2>/dev/null || true
  return 1
}

# One action at a time (deploys and the cron watchdog can overlap).
mkdir -p "$SHARED"
exec 9>"$SHARED/run.lock"
flock -w 120 9

case "${1:-}" in
  start) start; wait_healthy ;;
  stop) stop ;;
  restart) stop; start; wait_healthy ;;
  ensure)
    if ! healthy; then
      log "not answering, (re)starting"
      stop; start; wait_healthy
    fi
    ;;
  status)
    if running; then echo "running (pid $(pid))"; else echo "not running"; fi
    if healthy; then echo "healthy"; else echo "not answering on port $PORT"; exit 1; fi
    ;;
  wait) wait_healthy ;;
  *) echo "usage: $0 start|stop|restart|ensure|status|wait" >&2; exit 2 ;;
esac

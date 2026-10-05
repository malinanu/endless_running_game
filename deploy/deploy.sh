#!/usr/bin/env bash
# Deploy the latest code on the CloudPanel server.
# Runs as the CloudPanel site user from the app directory (GitHub Actions calls it over SSH).
#
#   deploy/deploy.sh [branch]        # default branch: main
#
# Environment (optional):
#   SERVICE   systemd unit name           (default: christmas-runner)
#   ENV_FILE  file with PORT / DB_PATH    (default: ~/.config/christmas-runner.env)
set -euo pipefail

BRANCH="${1:-main}"
SERVICE="${SERVICE:-christmas-runner}"
ENV_FILE="${ENV_FILE:-$HOME/.config/christmas-runner.env}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

log() { printf '\n==> %s\n' "$*"; }

PORT=8090
DB_PATH="$HOME/data/runner.db"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "warning: $ENV_FILE not found, using defaults" >&2
fi

log "Updating code to origin/$BRANCH"
git fetch --prune origin "$BRANCH"
PREVIOUS="$(git rev-parse HEAD)"
# Tracked files are reset; untracked ones (e.g. public/assets/brand/scan-logo.png) are kept.
git reset --hard "origin/$BRANCH"
echo "deployed $(git rev-parse --short HEAD) (was ${PREVIOUS:0:7})"

log "Installing Python dependencies"
if [[ ! -x .venv/bin/python ]]; then
  "${PYTHON:-python3}" -m venv .venv
fi
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

log "Preparing data directory"
mkdir -p "$(dirname "$DB_PATH")"

log "Restarting $SERVICE"
sudo -n /usr/bin/systemctl restart "$SERVICE"

log "Waiting for http://127.0.0.1:$PORT/api/health"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "healthy"
    exit 0
  fi
  sleep 1
done

echo "error: $SERVICE did not become healthy; recent logs:" >&2
sudo -n /usr/bin/systemctl status "$SERVICE" --no-pager -l >&2 || true
echo "Roll back with: git -C $APP_DIR reset --hard $PREVIOUS && sudo systemctl restart $SERVICE" >&2
exit 1

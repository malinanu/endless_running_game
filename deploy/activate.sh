#!/usr/bin/env bash
# Activate a release that GitHub Actions has just unpacked into APP_DIR/releases/<sha>.
# Runs on the server as the CloudPanel site user:
#   1. prepare shared folders and the Python virtualenv (no root needed)
#   2. install requirements, copy the brand logo into the release
#   3. point APP_DIR/current at this release and restart the app
#   4. if it doesn't come up healthy, switch back to the previous release and fail
set -euo pipefail

RELEASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APP_DIR="$(cd "$RELEASE/../.." && pwd -P)"
SHARED="$APP_DIR/shared"
VENV="$SHARED/venv"
KEEP=3

log() { printf '\n==> %s\n' "$*"; }

[[ "$(basename "$(dirname "$RELEASE")")" == releases ]] || { echo "error: $RELEASE is not inside a releases/ folder" >&2; exit 1; }
mkdir -p "$SHARED/data" "$SHARED/logs" "$SHARED/brand"

log "Python environment"
if [[ ! -x "$VENV/bin/python" ]]; then
  if ! python3 -m venv "$VENV" 2>/dev/null; then
    # Some servers ship python3 without the venv module; uv needs no root and can fetch Python.
    rm -rf "$VENV"
    echo "python3 -m venv unavailable, using uv"
    export PATH="$HOME/.local/bin:$PATH"
    command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
    uv venv --python 3.11 "$VENV"
  fi
fi
if [[ -x "$VENV/bin/pip" ]]; then
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -r "$RELEASE/requirements.txt"
else
  PATH="$HOME/.local/bin:$PATH" uv pip install --quiet --python "$VENV/bin/python" -r "$RELEASE/requirements.txt"
fi

log "Brand files"
if compgen -G "$SHARED/brand/*" >/dev/null; then
  cp -f "$SHARED"/brand/* "$RELEASE/public/assets/brand/"
  echo "copied: $(find "$SHARED/brand" -maxdepth 1 -type f -printf '%f ')"
else
  echo "none (upload scan-logo.png to $SHARED/brand/ to use one)"
fi

log "Switching to $(basename "$RELEASE")"
PREVIOUS="$(readlink "$APP_DIR/current" 2>/dev/null || true)"
ln -sfn "releases/$(basename "$RELEASE")" "$APP_DIR/current.new"
mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"

if bash "$RELEASE/deploy/run.sh" restart; then
  log "Cleaning up old releases (keeping $KEEP)"
  cd "$APP_DIR/releases"
  current_name="$(basename "$RELEASE")"
  previous_name="$(basename "${PREVIOUS:-none}")"
  # Newest first; never delete the live release or the one before it.
  mapfile -t old < <(find . -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -rn | tail -n +"$((KEEP + 1))" | cut -d' ' -f2)
  for r in "${old[@]}"; do
    [[ "$r" == "$current_name" || "$r" == "$previous_name" ]] && continue
    rm -rf -- "$r" && echo "removed $r"
  done
  log "Deployed $(basename "$RELEASE")"
  exit 0
fi

echo "error: new release failed its health check" >&2
if [[ -n "$PREVIOUS" && -d "$APP_DIR/$PREVIOUS" ]]; then
  log "Rolling back to $(basename "$PREVIOUS")"
  ln -sfn "$PREVIOUS" "$APP_DIR/current.new"
  mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
  bash "$APP_DIR/current/deploy/run.sh" restart || true
fi
exit 1

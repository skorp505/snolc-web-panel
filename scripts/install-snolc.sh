#!/usr/bin/env bash
# Установка или обновление бинарника snolc через официальный скрипт snolc.
set -euo pipefail

progress() {
  if [ "${UPDATE_MODE:-}" = "1" ]; then
    printf '[PROGRESS:%s] %s\n' "$1" "$2"
  fi
}

BIN_DIR="${SNOLC_BIN_DIR:-$HOME/.local/bin}"

progress 5 "fetching snolc installer"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl -fsSL https://raw.githubusercontent.com/owenewans/snolc/master/install.sh -o "$tmp/install.sh"

progress 60 "installing snolc"
sh "$tmp/install.sh" --binary

progress 85 "verifying snolc"
SNOLC_BIN="$(command -v snolc || true)"
if [ -z "$SNOLC_BIN" ]; then
  for candidate in "$BIN_DIR/snolc" /usr/local/bin/snolc; do
    if [ -x "$candidate" ]; then
      SNOLC_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$SNOLC_BIN" ]; then
  echo "error: snolc binary not found after install" >&2
  exit 1
fi

progress 100 "snolc ready"
"$SNOLC_BIN" version

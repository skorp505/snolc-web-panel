#!/usr/bin/env bash
# Установка snolc-web-panel: сборка панели, установка snolc, systemd, TLS.
# Автоопределение текущей установки и предложение обновить.
set -euo pipefail

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "run as root: curl -fsSL https://raw.githubusercontent.com/skorp505/snolc-web-panel/main/scripts/install.sh | sudo bash" >&2
    exit 1
  fi
}

need_root

log() { printf '[snolc-web] %s\n' "$*"; }
die() { printf '[snolc-web] ERROR: %s\n' "$*" >&2; exit 1; }

apt_pkg() { case "$1" in ss) echo iproute2 ;; *) echo "$1" ;; esac; }

install_missing_tools() {
  for tool in git curl openssl ss systemctl; do
    command -v "$tool" >/dev/null && continue
    log "installing missing tool: $tool"
    pkg="$(apt_pkg "$tool")"
    if command -v apt-get >/dev/null; then
      apt-get install -y -q "$pkg" >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1; apt-get install -y -q "$pkg" >/dev/null 2>&1; }
    elif command -v apk >/dev/null; then
      apk add --no-cache "$pkg" >/dev/null 2>&1
    elif command -v dnf >/dev/null; then
      dnf install -y "$pkg" >/dev/null 2>&1
    fi
  done
  if ! command -v go >/dev/null; then
    if [ ! -x /usr/local/go/bin/go ]; then
      log "installing Go"
      arch=$(uname -m); [ "$arch" = x86_64 ] && arch=amd64 || true
      curl -fsSL "https://go.dev/dl/go1.26.8.linux-${arch}.tar.gz" -o /tmp/go.tgz >/dev/null 2>&1 || true
      tar -C /usr/local -xzf /tmp/go.tgz 2>/dev/null || true
      rm -f /tmp/go.tgz
    fi
    export PATH=/usr/local/go/bin:$PATH
  fi
  command -v git curl openssl ss systemctl go >/dev/null || die "unable to install required tools"
}

install_missing_tools

# --- флаги: --update, --force, --skip-snolc, переменные окружения
for arg in "$@"; do
  case "$arg" in
    --update) FORCE_UPDATE=1 ;;
    --force) FORCE_UPDATE=1 ;;
    --skip-snolc) SKIP_SNOLC=1 ;;
    -h|--help)
      echo "usage: scripts/install.sh [--update] [--force] [--skip-snolc]"
      exit 0
      ;;
  esac
done

random_hex() { od -An -N"${1:-16}" -tx1 /dev/urandom | tr -d ' \n'; }
random_port() {
  local raw port
  for _ in $(seq 1 20); do
    raw="$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')"
    port=$((20000 + raw % 40000))
    if ! ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port"; then printf '%s' "$port"; return 0; fi
  done
  printf '8808'
}

SRC_DIR="${SRC_DIR:-/opt/snolc-web-src}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
DIR="${DIR:-/etc/snolc-web}"
TLS_DAYS="${TLS_DAYS:-3650}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-$(random_hex 12)}"
ADMIN_PATH="${ADMIN_PATH:-/admin-$(random_hex 4)}"
case "$ADMIN_PATH" in /*) ;; *) ADMIN_PATH="/$ADMIN_PATH" ;; esac

# при обновлении сохраняем прежний админ-путь, если он задан в конфиге
if [ -n "${FORCE_UPDATE:-}" ] && [ -f "$DIR/config.json" ]; then
  prev="$(sed -n 's/.*"admin_path": "\([^"]*\)".*/\1/p' "$DIR/config.json" | tail -1)"
  [ -n "$prev" ] && ADMIN_PATH="$prev"
fi

detect_existing() {
  [ -e "$BIN_DIR/snolc-web" ] && return 0
  [ -e "$DIR/config.json" ] && return 0
  [ -d "$SRC_DIR" ] && return 0
  [ -f /etc/systemd/system/snolc-web.service ] && return 0
  return 1
}

# --- обнаружение установленной панели
if detect_existing && [ -z "${FORCE_UPDATE:-}" ]; then
  EXISTING_VERSION=""
  [ -f "$DIR/panel-version" ] && EXISTING_VERSION="$(cat "$DIR/panel-version")"
  log "existing SNOLC Web panel detected (version: ${EXISTING_VERSION:-unknown})"
  log "installed panel: $BIN_DIR/snolc-web, config: $DIR, sources: $SRC_DIR"
  printf 'Обновить установленную панель? [y/N] ' >&2
  read -r answer || true
  case "$answer" in
    y|Y|yes|Yes|YES)
      log "ошибка: подтвердите обновление передав --update, чтобы продолжить"
      die "run scripts/install.sh --update to update"
      ;;
    *) log "оставляем установленную панель как есть" ; exit 0 ;;
  esac
fi

log "admin path: $ADMIN_PATH, config dir: $DIR"

mkdir -p "$DIR" "$SRC_DIR"

# --- сборка панели
log "cloning panel sources"
rm -rf "$SRC_DIR"
if ! git clone -q https://github.com/skorp505/snolc-web-panel.git "$SRC_DIR" 2>/dev/null; then
  log "clone failed; removing and retrying"
  rm -rf "$SRC_DIR"
  git clone -q https://github.com/skorp505/snolc-web-panel.git "$SRC_DIR"
fi

if command -v pnpm >/dev/null 2>&1; then
  log "building frontend (vite)"
  (cd "$SRC_DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1 || true)
  (cd "$SRC_DIR" && pnpm build >/dev/null 2>&1 || true)
fi
log "building snolc-web"
(cd "$SRC_DIR" && CGO_ENABLED=0 go build -o "$BIN_DIR/snolc-web" ./cmd/snolc-web)

if [ -f "$SRC_DIR/panel-version" ]; then
  install -m 0644 "$SRC_DIR/panel-version" "$DIR/panel-version" 2>/dev/null || true
fi

# --- установка snolc
if [ -z "${SKIP_SNOLC:-}" ]; then
  log "installing snolc (via official install.sh)"
  sh "$SRC_DIR/scripts/install-snolc.sh" || log "warning: snolc install failed, retry from panel"
fi

# --- конфигурация
printf '{\n  "port": %s,\n  "addr": "0.0.0.0",\n  "admin_path": "%s"\n}\n' "$(random_port)" "$ADMIN_PATH" > "$DIR/config.json"
if [ -n "${FORCE_UPDATE:-}" ] && [ -f "$DIR/panel.env" ]; then
  ADMIN_USER="$(sed -n 's/^SNOLC_WEB_USER=//p' "$DIR/panel.env" | tail -1)"
  ADMIN_PASS="$(sed -n 's/^SNOLC_WEB_PASS=//p' "$DIR/panel.env" | tail -1)"
  if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then ADMIN_USER="admin"; ADMIN_PASS="$(random_hex 12)"; fi
fi
printf 'SNOLC_WEB_USER=%s\nSNOLC_WEB_PASS=%s\n' "$ADMIN_USER" "$ADMIN_PASS" > "$DIR/panel.env"
chmod 600 "$DIR/panel.env"

# --- TLS
if [ ! -s "$DIR/tls.crt" ]; then
  log "generating self-signed certificate"
  HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
  openssl req -x509 -newkey rsa:2048 -nodes -days "$TLS_DAYS" \
    -keyout "$DIR/tls.key" -out "$DIR/tls.crt" -subj "/CN=${HOST:-snolc-web}" >/dev/null 2>&1
  chmod 600 "$DIR/tls.key"
fi

# --- systemd
UNIT=/etc/systemd/system/snolc-web.service
cat >"$UNIT" <<EOF
[Unit]
Description=SNOLC Web Panel
After=network.target

[Service]
Type=simple
Restart=always
RestartSec=5
User=root
ExecStart=$BIN_DIR/snolc-web -config $DIR/config.json

[Install]
WantedBy=multi-user.target
EOF

# --- запуск
log "starting systemd unit"
systemctl daemon-reload >/dev/null 2>&1 || true
systemctl stop snolc-web.service >/dev/null 2>&1 || true
systemctl start snolc-web.service
systemctl enable snolc-web.service >/dev/null

PORT="$(awk -F'"' '/"port"/ {print $4}' "$DIR/config.json" 2>/dev/null || true)"
echo
echo "Установлен панель SNOLC Web:"
echo "  URL: https://$(hostname -I 2>/dev/null | awk '{print $1}')${ADMIN_PATH}${PORT:+ (port $PORT)} или https://localhost${ADMIN_PATH}"
echo "  Логин: $ADMIN_USER"
echo "  Пароль: $ADMIN_PASS"
echo

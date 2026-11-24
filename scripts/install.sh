#!/usr/bin/env bash
# SNOLC Web panel installer/manager.
#
# При запуске (без флагов) — меню:
#   1) Установить панель
#   2) Обновить панель
#   3) Переустановить панель
#   4) Удалить всё
# Флаги: --install, --update, --reinstall, --remove.
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

# --- режим: --install|--update|--reinstall|--remove, с меню при нетерминальном запуске
MODE=""
for arg in "$@"; do
  case "$arg" in
    --install|--fresh) MODE=install ;;
    --update) MODE=update ;;
    --reinstall) MODE=reinstall ;;
    --remove) MODE=remove ;;
    -h|--help)
      echo "usage: scripts/install.sh [--install|--update|--reinstall|--remove]"
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

detect_existing() {
  [ -e "$BIN_DIR/snolc-web" ] && return 0
  [ -e "$DIR/config.json" ] && return 0
  [ -d "$SRC_DIR" ] && return 0
  [ -f /etc/systemd/system/snolc-web.service ] && return 0
  return 1
}

# --- меню
if [ -z "$MODE" ]; then
  log "SNOLC Web panel installer/manager"
  echo
  echo "1) Установить панель"
  echo "2) Обновить панель"
  echo "3) Переустановить панель"
  echo "4) Удалить всё"
  MODE_CHOICE=""
  if [ -t 0 ]; then
    printf "Выберите действие [1-4]: "
    read -r MODE_CHOICE || true
  else
    # Скрипт идёт по pipe (curl | bash): stdin занят самим скриптом,
    # поэтому ждём команду с терминала (/dev/tty), а если терминала
    # нет — принимаем ввод с stdin.
    printf "Выберите действие [1-4] (ожидаю команду с терминала): " >&2
    read -r MODE_CHOICE </dev/tty 2>/dev/null || MODE_CHOICE=""
    if [ -z "$MODE_CHOICE" ]; then
      read -r MODE_CHOICE || true
    fi
  fi
  case "$MODE_CHOICE" in
    1) MODE=install ;;
    2) MODE=update ;;
    3) MODE=reinstall ;;
    4) MODE=remove ;;
    *) die "выбор не определён (допустимы: 1, 2, 3, 4)" ;;
  esac
fi

# --- действия
action_remove() {
  log "остановка snolc-web..."
  systemctl stop snolc-web.service >/dev/null 2>&1 || true
  systemctl disable snolc-web.service >/dev/null 2>&1 || true
  systemctl daemon-reload >/dev/null 2>&1 || true
  log "удаление: $BIN_DIR/snolc-web, $DIR, $SRC_DIR, snolc, systemd-юнит"
  rm -f "$BIN_DIR/snolc-web"
  rm -f /etc/systemd/system/snolc-web.service
  rm -f /etc/systemd/system/multi-user.target.wants/snolc-web.service
  rm -f "$(command -v snolc 2>/dev/null || true)" 2>/dev/null || true
  rm -rf "$DIR" "$SRC_DIR"
  log "удалено: $DIR, $SRC_DIR, $BIN_DIR/snolc-web"
}

action_install() {
  log "проверка наличия установленной панели..."
  if detect_existing; then
    log "панель уже установлена ($BIN_DIR/snolc-web, $DIR, $SRC_DIR)"
    log "ошибка: панель не переустанавливается в режиме Установить — используйте --update/--reinstall"
  fi
}

action_update() {
  log "проверка наличия установленной панели..."
  if ! detect_existing; then
    die "панель не установлена; сначала запустите с флагом --install"
  fi
  log "обновление панели..."
}

action_reinstall() {
  log "переустановка панели (старая будет удалена)..."
  systemctl stop snolc-web.service >/dev/null 2>&1 || true
  rm -f "$BIN_DIR/snolc-web"
  rm -rf "$DIR" "$SRC_DIR"
}

# --- общая процедура установки/обновления
do_install() {
  if [ "$MODE" = update ] && [ -f "$DIR/config.json" ]; then
    prev="$(sed -n 's/.*"admin_path": "\([^"]*\)".*/\1/p' "$DIR/config.json" | tail -1)"
    [ -n "$prev" ] && ADMIN_PATH="$prev"
  fi

  mkdir -p "$DIR" "$SRC_DIR"

  log "cloning panel sources"
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

  if [ -z "${SKIP_SNOLC:-}" ]; then
    log "installing snolc (via official install.sh)"
    bash "$SRC_DIR/scripts/install-snolc.sh" || log "warning: snolc install failed, retry from panel"
  fi

  printf '{\n  "port": %s,\n  "addr": "0.0.0.0",\n  "admin_path": "%s"\n}\n' "$(random_port)" "$ADMIN_PATH" > "$DIR/config.json"

  if [ "$MODE" = update ] && [ -f "$DIR/panel.env" ]; then
    ADMIN_USER="$(sed -n 's/^SNOLC_WEB_USER=//p' "$DIR/panel.env" | tail -1)"
    ADMIN_PASS="$(sed -n 's/^SNOLC_WEB_PASS=//p' "$DIR/panel.env" | tail -1)"
    [ -n "$ADMIN_USER" ] && [ -n "$ADMIN_PASS" ] || { ADMIN_USER="admin"; ADMIN_PASS="$(random_hex 12)"; }
  fi
  printf 'SNOLC_WEB_USER=%s\nSNOLC_WEB_PASS=%s\n' "$ADMIN_USER" "$ADMIN_PASS" > "$DIR/panel.env"
  chmod 600 "$DIR/panel.env"

  if [ ! -s "$DIR/tls.crt" ]; then
    log "generating self-signed certificate"
    HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
    openssl req -x509 -newkey rsa:2048 -nodes -days "$TLS_DAYS" \
      -keyout "$DIR/tls.key" -out "$DIR/tls.crt" -subj "/CN=${HOST:-snolc-web}" >/dev/null 2>&1
    chmod 600 "$DIR/tls.key"
  fi

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

  log "starting systemd unit"
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl stop snolc-web.service >/dev/null 2>&1 || true
  systemctl start snolc-web.service
  systemctl enable snolc-web.service >/dev/null

  echo
  echo "SNOLC Web панель установлена/обновлена:"
  PORT_NOW="$(sed -n 's/.*"port": *\([0-9][0-9]*\).*/\1/p' "$DIR/config.json" 2>/dev/null | tail -1)"
  echo "  URL: https://$(hostname -I 2>/dev/null | awk '{print $1}')${PORT_NOW:+:$PORT_NOW}${ADMIN_PATH}"
  echo "  Логин: $ADMIN_USER"
  echo "  Пароль: $ADMIN_PASS"
  echo
}

# --- объединение выбранного действия с установкой
case "$MODE" in
  install)
    if detect_existing; then die "панель уже установлена; используйте --update или --reinstall"; fi
    do_install
    ;;
  update)
    action_update
    do_install
    ;;
  reinstall)
    action_reinstall
    do_install
    ;;
  remove)
    action_remove
    log "удаление завершено"
    ;;
  *) die "неизвестный режим: $MODE" ;;
esac

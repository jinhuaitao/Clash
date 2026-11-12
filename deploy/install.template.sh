#!/bin/sh
# =============================================================================
# Transit Hub v2.10.0 · 服务器一键安装
#
#   支持：Debian / Ubuntu / Raspbian（systemd）与 Alpine Linux（OpenRC）
#   自带：Worker 产物、Node 适配层、节点导入工具、节点模板 —— 无需 clone 仓库
#   零运行时依赖：只用 Node >= 20 内置模块，不需要 npm install
#
#   最简用法（在服务器上以 root 执行）：
#     sh install.sh
#     sh install.sh --nodes ./nodes.json          # 安装并导入节点
#     sh install.sh --links ./links.txt --domain sub.example.com
#
#   --portable 可在任意已装 Node>=20 的机器上免 root 运行（含 macOS），
#   文件全部落在 --prefix 目录里，直接用后台进程托管。
#
#   注意：服务默认只监听明文 HTTP。公网暴露请套一层 HTTPS 反向代理。
# =============================================================================
set -eu

TH_VERSION="2.10.0"
TH_PORTABLE=0
TH_UNINSTALL=0
TH_PORT="8787"
TH_BIND="0.0.0.0"
TH_DOMAIN=""
TH_NODES=""
TH_NODES_JSON=""
TH_LINKS=""
TH_ADMIN_TOKEN=""
TH_AUTH_TOKEN=""
TH_ADMIN_USER="admin"
TH_ADMIN_PASS=""
TH_TRUST_PROXY="0"
TH_PREFIX=""
TH_OS=""

usage() {
  cat <<'TH_USAGE'
Transit Hub 一键安装（Debian / Ubuntu / Alpine）

用法： sh install.sh [选项]

  --port <n>              监听端口，默认 8787
  --bind <addr>           监听地址，默认 0.0.0.0
  --domain <host>         对外域名，用于生成订阅链接（需自行配置 HTTPS 反代）
  --nodes <file>          安装后立即导入的 nodes.json
  --nodes-json <json>     直接以 JSON 字符串提供节点（写入 nodes.json 再导入）
  --links <file>          安装后导入分享链接文本（一行一条）
  --admin-token <s>       指定部署恢复令牌（默认随机生成，>=16 位）
  --auth-token <s>        指定订阅令牌（默认随机生成）
  --admin-user <s>        控制台管理员用户名，默认 admin
  --admin-pass <s>        控制台管理员密码（默认随机生成，>=12 位）
  --trust-proxy           从 X-Forwarded-For 取真实 IP（放在反向代理后面时启用）
  --portable              免 root 便携模式，不装系统包/服务
  --prefix <dir>         便携模式的安装目录，默认 ./transit-hub-local
  --uninstall             卸载（保留 /var/lib/transit-hub 数据）
  -h | --help             显示本帮助

安装后常用命令：
  transit-hub info                          查看凭据与订阅链接
  transit-hub import-nodes <nodes.json>      导入/替换节点
  transit-hub import-nodes --links <txt> --append
  systemctl status transit-hub              Debian/Ubuntu 查看服务
  rc-service transit-hub status             Alpine 查看服务
TH_USAGE
}

die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }
log() { printf '  %s\n' "$1"; }
step() { printf '\n→ %s\n' "$1"; }

# ---------------------------------------------------------------- 参数解析
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port)          TH_PORT="$2"; shift 2 ;;
    --bind)          TH_BIND="$2"; shift 2 ;;
    --domain)        TH_DOMAIN="$2"; shift 2 ;;
    --nodes)         TH_NODES="$2"; shift 2 ;;
    --nodes-json)    TH_NODES_JSON="$2"; shift 2 ;;
    --links)         TH_LINKS="$2"; shift 2 ;;
    --admin-token)   TH_ADMIN_TOKEN="$2"; shift 2 ;;
    --auth-token)    TH_AUTH_TOKEN="$2"; shift 2 ;;
    --admin-user)    TH_ADMIN_USER="$2"; shift 2 ;;
    --admin-pass)    TH_ADMIN_PASS="$2"; shift 2 ;;
    --trust-proxy)   TH_TRUST_PROXY=1; shift ;;
    --portable)      TH_PORTABLE=1; shift ;;
    --prefix)        TH_PREFIX="$2"; shift 2 ;;
    --uninstall)     TH_UNINSTALL=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               die "未知参数：$1（用 --help 查看用法）" ;;
  esac
done

case "$TH_PORT" in
  ''|*[!0-9]*) die "--port 必须是 1-65535 的整数" ;;
esac
if [ "$TH_PORT" -lt 1 ] || [ "$TH_PORT" -gt 65535 ]; then die "--port 必须是 1-65535 的整数"; fi
if [ -n "$TH_DOMAIN" ]; then TH_DOMAIN=$(printf '%s' "$TH_DOMAIN" | sed 's#^https\?://##; s#/$##'); fi

# ---------------------------------------------------------------- 路径布局
if [ "$TH_PORTABLE" = 1 ]; then
  [ -n "$TH_PREFIX" ] || TH_PREFIX="$(pwd)/transit-hub-local"
  case "$TH_PREFIX" in /*) ;; *) TH_PREFIX="$(pwd)/$TH_PREFIX" ;; esac
  TH_HOME="$TH_PREFIX/app"
  TH_ETC="$TH_PREFIX/etc"
  TH_VAR="$TH_PREFIX/data"
  TH_CLI="$TH_PREFIX/transit-hub"
  TH_SERVICE_NAME=""
else
  [ "$(id -u)" = 0 ] || die "系统安装需要 root（或用 --portable 免 root 模式）"
  TH_HOME="/opt/transit-hub"
  TH_ETC="/etc/transit-hub"
  TH_VAR="/var/lib/transit-hub"
  TH_CLI="/usr/local/bin/transit-hub"
  TH_SERVICE_NAME="transit-hub"
fi
TH_ENV_FILE="$TH_ETC/env.json"
TH_KV_FILE="$TH_VAR/kv.json"
TH_LOCAL_BASE="http://127.0.0.1:$TH_PORT"
mkdir -p "$TH_HOME" "$TH_ETC" "$TH_VAR"
if [ "$TH_PORTABLE" = 0 ]; then TH_PREFIX="$TH_HOME"; fi

# ---------------------------------------------------------------- 卸载
do_uninstall() {
  step "卸载 Transit Hub"
  if [ "$TH_PORTABLE" = 1 ]; then
    if [ -f "$TH_VAR/server.pid" ]; then
      kill "$(cat "$TH_VAR/server.pid")" 2>/dev/null || true
    fi
    printf '  · 便携目录已保留：%s（确认后自行删除）\n' "$TH_PREFIX"
    exit 0
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop transit-hub 2>/dev/null || true
    systemctl disable transit-hub 2>/dev/null || true
    rm -f /etc/systemd/system/transit-hub.service
    systemctl daemon-reload 2>/dev/null || true
  fi
  if command -v rc-service >/dev/null 2>&1; then
    rc-service transit-hub stop 2>/dev/null || true
    rc-update del transit-hub default 2>/dev/null || true
    rm -f /etc/init.d/transit-hub
  fi
  rm -f "$TH_CLI" "$TH_HOME/1.js" "$TH_HOME/server.mjs" "$TH_HOME/import-nodes.mjs"
  printf '  ✓ 已停止并移除服务与程序文件\n'
  printf '  · 数据与凭据保留在 %s 和 %s，确认无用后可手动删除\n' "$TH_VAR" "$TH_ETC"
  exit 0
}
if [ "$TH_UNINSTALL" = 1 ]; then do_uninstall; fi

# ---------------------------------------------------------------- 系统识别
detect_os() {
  [ -f /etc/os-release ] || die "找不到 /etc/os-release，无法识别系统；可用 --portable"
  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu|raspbian|linuxmint|pop|kali|armbian) TH_OS="debian" ;;
    alpine) TH_OS="alpine" ;;
    *)
      case "${ID_LIKE:-}" in
        *debian*|*ubuntu*) TH_OS="debian" ;;
        *alpine*) TH_OS="alpine" ;;
        *) die "暂不支持 ${PRETTY_NAME:-${ID:-未知系统}}；本项目只适配 Debian/Ubuntu 与 Alpine，其它系统可用 --portable" ;;
      esac ;;
  esac
}

# ---------------------------------------------------------------- Node >= 20
node_is_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const n=Number(process.versions.node.split(".")[0]); process.exit(n>=20?0:1)' 2>/dev/null || return 1
  return 0
}

install_node_tarball() {
  # 兜底：官方 glibc 构建 / unofficial-builds 的 musl 构建，装进 TH_HOME/runtime
  TH_NODE_VER="v20.18.1"
  case "$(uname -m)" in
    x86_64|amd64) TH_NODE_ARCH="x64" ;;
    aarch64|arm64) TH_NODE_ARCH="arm64" ;;
    armv7l|armv6l) TH_NODE_ARCH="armv7l" ;;
    *) die "无法为本机架构 $(uname -m) 自动下载 Node，请手动安装 Node >= 20 后重试" ;;
  esac
  if [ "${TH_OS:-}" = "alpine" ]; then
    TH_NODE_URL="https://unofficial-builds.nodejs.org/download/release/$TH_NODE_VER/node-$TH_NODE_VER-linux-$TH_NODE_ARCH-musl.tar.xz"
  else
    TH_NODE_URL="https://nodejs.org/dist/$TH_NODE_VER/node-$TH_NODE_VER-linux-$TH_NODE_ARCH.tar.xz"
  fi
  command -v curl >/dev/null 2>&1 || die "下载 Node 运行时需要 curl，请手动安装 Node >= 20 后重试"
  log "下载 Node 运行时：$TH_NODE_URL"
  curl -fsSL "$TH_NODE_URL" -o "$TH_VAR/node.tar.xz" || die "Node 下载失败，请检查网络或手动安装 Node >= 20"
  mkdir -p "$TH_HOME/runtime"
  # busybox tar 不认 -J 时退到 xz 管道
  if ! tar -xJf "$TH_VAR/node.tar.xz" -C "$TH_HOME/runtime" --strip-components=1 2>/dev/null; then
    xz -dc "$TH_VAR/node.tar.xz" | tar -xf - -C "$TH_HOME/runtime" --strip-components=1 || die "Node 解压失败"
  fi
  rm -f "$TH_VAR/node.tar.xz"
  NODE_BIN="$TH_HOME/runtime/bin/node"
  [ -x "$NODE_BIN" ] || die "下载的 Node 不可执行"
}

prepare_node() {
  if node_is_ok; then
    NODE_BIN="$(command -v node)"
    log "复用系统 Node $(node -p 'process.versions.node')：$NODE_BIN"
    return
  fi
  if [ "$TH_PORTABLE" = 1 ]; then
    die "便携模式需要系统已装 Node >= 20（当前未检测到）"
  fi
  if [ "$TH_OS" = "debian" ]; then
    step "安装 Node.js 20（Debian/Ubuntu）"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || die "apt-get update 失败"
    apt-get install -y -qq ca-certificates curl xz-utils || die "基础依赖安装失败"
    if curl -fsSL https://deb.nodesource.com/setup_20.x -o "$TH_VAR/nodesource.sh"; then
      bash "$TH_VAR/nodesource.sh" >/dev/null 2>&1 || true
      apt-get install -y -qq nodejs >/dev/null 2>&1 || true
    fi
    rm -f "$TH_VAR/nodesource.sh"
  else
    step "安装 Node.js（Alpine）"
    apk add --no-cache curl xz nodejs npm >/dev/null 2>&1 || apk add --no-cache curl xz nodejs >/dev/null 2>&1 || true
    if ! node_is_ok; then
      apk add --no-cache nodejs-current >/dev/null 2>&1 || true
    fi
  fi
  if node_is_ok; then
    NODE_BIN="$(command -v node)"
    log "已安装 Node $(node -p 'process.versions.node')"
  else
    log "软件源没有 Node >= 20，改用预编译运行时"
    install_node_tarball
  fi
}

# ---------------------------------------------------------------- 随机数
rand_hex() {
  od -An -N 48 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | cut -c1-"$1"
}

# ---------------------------------------------------------------- 解包自带文件
unpack_files() {
  step "部署程序文件到 $TH_HOME"
  mkdir -p "$TH_HOME" "$TH_ETC" "$TH_VAR"
  cat > "$TH_HOME/1.js" <<'TRANSIT_HUB_7f3a9c_END_OF_FILE'
__TH_WORKER_JS__
TRANSIT_HUB_7f3a9c_END_OF_FILE
  cat > "$TH_HOME/server.mjs" <<'TRANSIT_HUB_7f3a9c_END_OF_FILE'
__TH_SERVER_JS__
TRANSIT_HUB_7f3a9c_END_OF_FILE
  cat > "$TH_HOME/import-nodes.mjs" <<'TRANSIT_HUB_7f3a9c_END_OF_FILE'
__TH_IMPORT_JS__
TRANSIT_HUB_7f3a9c_END_OF_FILE
  cat > "$TH_ETC/nodes.example.json" <<'TRANSIT_HUB_7f3a9c_END_OF_FILE'
__TH_NODES_EXAMPLE__
TRANSIT_HUB_7f3a9c_END_OF_FILE
  cat > "$TH_ETC/links.example.txt" <<'TRANSIT_HUB_7f3a9c_END_OF_FILE'
__TH_LINKS_EXAMPLE__
TRANSIT_HUB_7f3a9c_END_OF_FILE
  "$NODE_BIN" --check "$TH_HOME/1.js" || die "Worker 产物语法校验失败"
  "$NODE_BIN" --check "$TH_HOME/server.mjs" || die "适配层语法校验失败"
  "$NODE_BIN" --check "$TH_HOME/import-nodes.mjs" || die "导入工具语法校验失败"
  log "Worker 产物 / 适配层 / 导入工具 / 节点模板 已就位"
}

# ---------------------------------------------------------------- 凭据与配置
write_env() {
  step "生成凭据与运行配置"
  [ -n "$TH_ADMIN_TOKEN" ] || TH_ADMIN_TOKEN="$(rand_hex 32)"
  [ -n "$TH_AUTH_TOKEN" ]  || TH_AUTH_TOKEN="$(rand_hex 32)"
  [ -n "$TH_ADMIN_PASS" ]  || TH_ADMIN_PASS="$(rand_hex 20)"
  TH_SESSION_SECRET="$(rand_hex 64)"
  case "$TH_ADMIN_TOKEN" in *[!A-Za-z0-9]*|'') die "--admin-token 必须是 >=16 位且不含空白/符号的字符串" ;; esac
  [ "${#TH_ADMIN_TOKEN}" -ge 16 ] || die "--admin-token 至少需要 16 位"
  case "$TH_AUTH_TOKEN" in *[!A-Za-z0-9]*|'') die "--auth-token 必须不含空白/符号" ;; esac
  [ "${#TH_AUTH_TOKEN}" -ge 16 ] || die "--auth-token 至少需要 16 位"
  [ "${#TH_ADMIN_PASS}" -ge 12 ] || die "--admin-pass 至少需要 12 位"

  TH_PUBLIC_BASE=""
  if [ -n "$TH_DOMAIN" ]; then TH_PUBLIC_BASE="https://$TH_DOMAIN"; fi

  "$NODE_BIN" -e '
    const [admin, auth, session, port] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      ADMIN_TOKEN: admin,
      AUTH_TOKEN: auth,
      SESSION_SECRET: session,
      SESSION_TTL_HOURS: "168",
      PASSWORD_ITERATIONS: 200000,
      PORT: port
    }, null, 2) + "\n");
  ' "$TH_ADMIN_TOKEN" "$TH_AUTH_TOKEN" "$TH_SESSION_SECRET" "$TH_PORT" > "$TH_ENV_FILE"

  TH_INFO="$TH_ETC/INSTALL_INFO.txt"
  {
    printf 'Transit Hub v%s · 安装信息（本文件含明文凭据，权限 0600）\n' "$TH_VERSION"
    printf '生成时间：%s\n\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
    printf '控制台账号：%s\n' "$TH_ADMIN_USER"
    printf '控制台密码：%s\n' "$TH_ADMIN_PASS"
    printf '控制台地址：%s/admin\n' "${TH_PUBLIC_BASE:-$TH_LOCAL_BASE}"
    printf '部署恢复令牌 ADMIN_TOKEN：%s\n' "$TH_ADMIN_TOKEN"
    printf '订阅令牌 AUTH_TOKEN：%s\n' "$TH_AUTH_TOKEN"
    printf '订阅链接（Clash YAML）：%s/?token=%s\n' "${TH_PUBLIC_BASE:-$TH_LOCAL_BASE}" "$TH_AUTH_TOKEN"
    printf '订阅链接（Base64）：    %s/?token=%s&format=base64\n' "${TH_PUBLIC_BASE:-$TH_LOCAL_BASE}" "$TH_AUTH_TOKEN"
    printf '订阅链接（URI）：       %s/?token=%s&format=uri\n' "${TH_PUBLIC_BASE:-$TH_LOCAL_BASE}" "$TH_AUTH_TOKEN"
    printf '\n数据文件：%s（账号、配置、节点都在这里，请定期备份）\n' "$TH_KV_FILE"
    printf '节点模板：%s\n' "$TH_ETC/nodes.example.json"
  } > "$TH_INFO"
  chmod 600 "$TH_ENV_FILE" "$TH_INFO"
  log "凭据已写入 ${TH_ENV_FILE} 与 ${TH_INFO}（0600）"
}

# ---------------------------------------------------------------- 服务定义
write_service() {
  if [ "$TH_PORTABLE" = 1 ]; then
    cat > "$TH_PREFIX/start.sh" <<TH_PORTABLE_START
#!/bin/sh
TH_PORTABLE=1
TH_ENV="$TH_ENV_FILE" TH_DATA="$TH_KV_FILE" TH_PORT="$TH_PORT" TH_BIND="$TH_BIND" \\
TH_PUBLIC_BASE="$TH_PUBLIC_BASE" TH_TRUST_PROXY="$TH_TRUST_PROXY" \\
"$NODE_BIN" "$TH_HOME/server.mjs" >> "$TH_VAR/server.log" 2>&1 &
printf '%s\\n' "\$!" > "$TH_VAR/server.pid"
printf 'started pid %s\\n' "\$(cat "$TH_VAR/server.pid")"
TH_PORTABLE_START
    cat > "$TH_PREFIX/stop.sh" <<TH_PORTABLE_STOP
#!/bin/sh
[ -f "$TH_VAR/server.pid" ] && kill "\$(cat "$TH_VAR/server.pid")" 2>/dev/null || true
TH_PORTABLE_STOP
    chmod +x "$TH_PREFIX/start.sh" "$TH_PREFIX/stop.sh"
    return
  fi

  if [ "$TH_OS" = "debian" ]; then
    step "注册 systemd 服务"
    if ! id -u transit-hub >/dev/null 2>&1; then
      useradd --system --no-create-home --home-dir "$TH_HOME" --shell /usr/sbin/nologin transit-hub 2>/dev/null \
        || useradd --system --no-create-home transit-hub
    fi
    cat > /etc/systemd/system/transit-hub.service <<TH_SYSTEMD_UNIT
[Unit]
Description=Transit Hub · Clash subscription service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=transit-hub
Group=transit-hub
WorkingDirectory=$TH_HOME
Environment=TH_ENV=$TH_ENV_FILE
Environment=TH_DATA=$TH_KV_FILE
Environment=TH_PORT=$TH_PORT
Environment=TH_BIND=$TH_BIND
Environment=TH_PUBLIC_BASE=$TH_PUBLIC_BASE
Environment=TH_TRUST_PROXY=$TH_TRUST_PROXY
Environment=NODE_ENV=production
ExecStart=$NODE_BIN $TH_HOME/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$TH_VAR

[Install]
WantedBy=multi-user.target
TH_SYSTEMD_UNIT
  else
    step "注册 OpenRC 服务（Alpine）"
    if ! id -u transit-hub >/dev/null 2>&1; then
      addgroup -S transit-hub 2>/dev/null || true
      adduser -S -D -H -G transit-hub -s /sbin/nologin transit-hub 2>/dev/null || true
    fi
    cat > /etc/init.d/transit-hub <<TH_OPENRC_UNIT
#!/sbin/openrc-run
name="transit-hub"
description="Transit Hub · Clash subscription service"
command="/usr/bin/env"
command_args="TH_ENV=$TH_ENV_FILE TH_DATA=$TH_KV_FILE TH_PORT=$TH_PORT TH_BIND=$TH_BIND TH_PUBLIC_BASE=$TH_PUBLIC_BASE TH_TRUST_PROXY=$TH_TRUST_PROXY NODE_ENV=production $NODE_BIN $TH_HOME/server.mjs"
command_user="transit-hub:transit-hub"
command_background="yes"
pidfile="/run/transit-hub.pid"
directory="$TH_HOME"
output_log="$TH_VAR/server.log"
error_log="$TH_VAR/server.log"

export TH_ENV="$TH_ENV_FILE"
export TH_DATA="$TH_KV_FILE"
export TH_PORT="$TH_PORT"
export TH_BIND="$TH_BIND"
export TH_PUBLIC_BASE="$TH_PUBLIC_BASE"
export TH_TRUST_PROXY="$TH_TRUST_PROXY"
export NODE_ENV="production"

depend() {
  need net
  after firewall
}

start_pre() {
  checkpath --directory --owner transit-hub:transit-hub --mode 0700 "$TH_VAR"
  checkpath --file --owner transit-hub:transit-hub --mode 0600 "$TH_VAR/server.log"
}
TH_OPENRC_UNIT
    chmod +x /etc/init.d/transit-hub
  fi
}

fix_permissions() {
  chmod -R a+rX "$TH_HOME"
  chmod 700 "$TH_VAR"
  if [ "$TH_PORTABLE" = 0 ]; then
    chown -R transit-hub:transit-hub "$TH_VAR" 2>/dev/null || true
    chown transit-hub:transit-hub "$TH_ENV_FILE" 2>/dev/null || true
    chown root:root "$TH_INFO" 2>/dev/null || true
    chmod 755 "$TH_ETC"
  fi
}

write_cli() {
  step "安装命令行工具 $TH_CLI"
  cat > "$TH_CLI" <<TH_CLI_BODY
#!/bin/sh
# Transit Hub 管理入口
TH_NODE="$NODE_BIN"
TH_HOME="$TH_HOME"
TH_ETC="$TH_ETC"
TH_VAR="$TH_VAR"
TH_PORT="$TH_PORT"
TH_BASE="http://127.0.0.1:$TH_PORT"

case "\${1:-}" in
  import-nodes)
    shift
    exec "\$TH_NODE" "\$TH_HOME/import-nodes.mjs" --env "\$TH_ETC/env.json" --base "\$TH_BASE" "\$@"
    ;;
  info)
    if [ -r "\$TH_ETC/INSTALL_INFO.txt" ]; then cat "\$TH_ETC/INSTALL_INFO.txt"
    else printf '需要 root 或凭据文件的读取权限\\n' >&2; exit 1
    fi
    ;;
  status)
    if [ "$TH_PORTABLE" = 1 ]; then
      if [ -f "\$TH_VAR/server.pid" ] && kill -0 "\$(cat "\$TH_VAR/server.pid")" 2>/dev/null; then printf 'running\\n'; else printf 'stopped\\n'; fi
    elif command -v systemctl >/dev/null 2>&1; then systemctl status transit-hub --no-pager
    elif command -v rc-service >/dev/null 2>&1; then rc-service transit-hub status
    else printf '未知服务管理器\\n' >&2; exit 1
    fi
    ;;
  restart|start|stop)
    if [ "$TH_PORTABLE" = 1 ]; then
      if [ "\$1" = stop ]; then "$TH_PREFIX/stop.sh"
      else "$TH_PREFIX/stop.sh"; "$TH_PREFIX/start.sh"
      fi
    elif command -v systemctl >/dev/null 2>&1; then systemctl "\$1" transit-hub
    elif command -v rc-service >/dev/null 2>&1; then rc-service transit-hub "\$1"
    else printf '未知服务管理器\\n' >&2; exit 1
    fi
    ;;
  logs)
    if [ "$TH_PORTABLE" = 1 ]; then tail -f "\$TH_VAR/server.log"
    elif command -v journalctl >/dev/null 2>&1; then journalctl -u transit-hub -f
    else tail -f "\$TH_VAR/server.log"
    fi
    ;;
  *)
    printf '用法：transit-hub import-nodes <file> | info | status | start | stop | restart | logs\\n'
    ;;
esac
TH_CLI_BODY
  chmod +x "$TH_CLI"
}

# ---------------------------------------------------------------- 启动服务
start_service() {
  step "启动服务"
  if [ "$TH_PORTABLE" = 1 ]; then
    TH_ENV="$TH_ENV_FILE" TH_DATA="$TH_KV_FILE" TH_PORT="$TH_PORT" TH_BIND="$TH_BIND" \
    TH_PUBLIC_BASE="$TH_PUBLIC_BASE" TH_TRUST_PROXY="$TH_TRUST_PROXY" \
      "$NODE_BIN" "$TH_HOME/server.mjs" >> "$TH_VAR/server.log" 2>&1 &
    printf '%s\n' "$!" > "$TH_VAR/server.pid"
  elif [ "$TH_OS" = "debian" ]; then
    systemctl daemon-reload
    systemctl enable transit-hub >/dev/null 2>&1 || true
    systemctl restart transit-hub
  else
    rc-update add transit-hub default >/dev/null 2>&1 || true
    rc-service transit-hub restart
  fi

  TH_READY=0
  TH_TRY=0
  while [ "$TH_TRY" -lt 40 ]; do
    if curl -fsS "$TH_LOCAL_BASE/api/auth" > "$TH_VAR/auth.json" 2>/dev/null; then TH_READY=1; break; fi
    TH_TRY=$((TH_TRY + 1))
    sleep 1
  done
  [ "$TH_READY" = 1 ] || die "服务启动失败，日志：$TH_VAR/server.log（或 journalctl -u transit-hub）"
  log "服务已就绪（${TH_LOCAL_BASE}）"
}

# ---------------------------------------------------------------- 初始化账号
init_admin() {
  step "初始化控制台所有者账号"
  if grep -q '"needsSetup":false' "$TH_VAR/auth.json" 2>/dev/null; then
    log "已有账号，跳过初始化（重装保留原数据）"
    return
  fi
  TH_PAYLOAD=$("$NODE_BIN" -e 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2]}))' "$TH_ADMIN_USER" "$TH_ADMIN_PASS")
  if ! curl -fsS -X POST "$TH_LOCAL_BASE/api/setup" \
        -H "Authorization: Bearer $TH_ADMIN_TOKEN" \
        -H 'Content-Type: application/json' \
        -d "$TH_PAYLOAD" -o "$TH_VAR/setup.json"; then
    printf '  响应：%s\n' "$(cat "$TH_VAR/setup.json" 2>/dev/null || true)" >&2
    die "初始化失败（确认 ADMIN_TOKEN 与 env.json 一致）"
  fi
  log "所有者账号 $TH_ADMIN_USER 创建完成"
}

# ---------------------------------------------------------------- 节点导入
prepare_nodes() {
  if [ -n "$TH_NODES_JSON" ]; then
    printf '%s\n' "$TH_NODES_JSON" > "$TH_ETC/nodes.json"
    TH_NODES="$TH_ETC/nodes.json"
  elif [ -n "$TH_NODES" ]; then
    [ -f "$TH_NODES" ] || die "找不到节点文件：$TH_NODES"
    cp "$TH_NODES" "$TH_ETC/nodes.json"
    TH_NODES="$TH_ETC/nodes.json"
  fi
  if [ -n "$TH_LINKS" ]; then
    [ -f "$TH_LINKS" ] || die "找不到分享链接文件：$TH_LINKS"
    cp "$TH_LINKS" "$TH_ETC/links.txt"
    TH_LINKS="$TH_ETC/links.txt"
  fi
  # 节点文件含 UUID / 密码，不能是默认 644
  if [ -f "$TH_ETC/nodes.json" ]; then chmod 600 "$TH_ETC/nodes.json"; fi
  if [ -f "$TH_ETC/links.txt" ]; then chmod 600 "$TH_ETC/links.txt"; fi
}

import_nodes() {
  if [ -z "$TH_NODES" ] && [ -z "$TH_LINKS" ]; then
    log "未指定节点：已生成模板 $TH_ETC/nodes.example.json 与 links.example.txt"
    return
  fi
  step "导入节点信息"
  if [ -n "$TH_NODES" ]; then
    "$NODE_BIN" "$TH_HOME/import-nodes.mjs" --env "$TH_ENV_FILE" --base "$TH_LOCAL_BASE" --file "$TH_NODES"
  fi
  if [ -n "$TH_LINKS" ]; then
    "$NODE_BIN" "$TH_HOME/import-nodes.mjs" --env "$TH_ENV_FILE" --base "$TH_LOCAL_BASE" --links "$TH_LINKS" --append
  fi
}

# ---------------------------------------------------------------- 摘要
summary() {
  TH_PUBLIC_URL="${TH_PUBLIC_BASE:-$TH_LOCAL_BASE}"
  printf '\n'
  printf '════════════════════════════════════════════════════════════════════\n'
  printf '  Transit Hub v%s 安装完成\n' "$TH_VERSION"
  printf '════════════════════════════════════════════════════════════════════\n'
  printf '  控制台      %s/admin\n' "$TH_PUBLIC_URL"
  printf '  管理员      %s / %s\n' "$TH_ADMIN_USER" "$TH_ADMIN_PASS"
  printf '  订阅链接    %s/?token=%s\n' "$TH_PUBLIC_URL" "$TH_AUTH_TOKEN"
  printf '              ?format=base64 / ?format=uri 可切换格式\n'
  printf '  凭据存档    %s  (0600)\n' "$TH_INFO"
  printf '  数据文件    %s  ← 定期备份\n' "$TH_KV_FILE"
  printf '  节点模板    %s\n' "$TH_ETC/nodes.example.json"
  printf '  导入节点    transit-hub import-nodes <nodes.json>\n'
  printf '  查看凭据    transit-hub info\n'
  if [ "$TH_PORTABLE" = 1 ]; then
    printf '  服务控制    %s/start.sh | %s/stop.sh\n' "$TH_PREFIX" "$TH_PREFIX"
  elif [ "$TH_OS" = "debian" ]; then
    printf '  服务控制    systemctl status|restart|stop transit-hub\n'
  else
    printf '  服务控制    rc-service transit-hub status|restart|stop\n'
  fi
  if [ -z "$TH_DOMAIN" ]; then
    printf '\n  ⚠ 当前是明文 HTTP。公网使用请加 HTTPS 反向代理后重装时用 --domain。\n'
  else
    printf '\n  ⚠ 请把 %s 反代到 127.0.0.1:%s，并确认已启用 HTTPS。\n' "$TH_DOMAIN" "$TH_PORT"
  fi
  printf '════════════════════════════════════════════════════════════════════\n'
}

# ---------------------------------------------------------------- main
if [ "$TH_PORTABLE" = 0 ]; then detect_os; fi
prepare_node
unpack_files
write_env
prepare_nodes
write_service
fix_permissions
write_cli
start_service
init_admin
import_nodes
# setup 响应里有明文会话令牌，不留在磁盘上
rm -f "$TH_VAR/auth.json" "$TH_VAR/setup.json"
if [ -f "$TH_KV_FILE" ]; then chmod 600 "$TH_KV_FILE"; fi
summary

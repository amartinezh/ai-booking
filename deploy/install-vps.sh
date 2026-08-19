#!/usr/bin/env bash
# =============================================================================
#  AgenIA — instalador desatendido para VPS Debian / Ubuntu
# =============================================================================
#
#  Deja el sistema COMPLETO y funcional desde un servidor recién entregado:
#  paquetes base, Docker, firewall, dominios con HTTPS automático, base de
#  datos migrada, backups diarios y verificación end-to-end.
#
#  USO
#    sudo bash deploy/install-vps.sh                 # interactivo (recomendado)
#    sudo bash deploy/install-vps.sh --check         # solo diagnostica, no toca nada
#    sudo bash deploy/install-vps.sh -y \
#         --domain-web app.midominio.com \
#         --domain-api api.midominio.com \
#         --email admin@midominio.com                # desatendido
#
#  Es IDEMPOTENTE: se puede volver a ejecutar. No regenera secretos ya
#  creados ni borra datos.
#
#  Documentación paso a paso equivalente: docs/INSTALACION_VPS.md
# =============================================================================
set -Eeuo pipefail

# ── Presentación ────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; B=$'\033[1;34m'
  C=$'\033[0;36m'; D=$'\033[2m'; BOLD=$'\033[1m'; N=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; C=''; D=''; BOLD=''; N=''
fi

LOG_FILE="/var/log/agenia-install.log"
STEP_NO=0
TOTAL_STEPS=14

log()   { printf '%s\n' "$*"; }
ok()    { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
info()  { printf '  %s·%s %s\n' "$C" "$N" "$*"; }
warn()  { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail()  { printf '  %s✘%s %s\n' "$R" "$N" "$*" >&2; }
step()  { STEP_NO=$((STEP_NO+1)); printf '\n%s[%02d/%02d] %s%s\n' "$B" "$STEP_NO" "$TOTAL_STEPS" "$*" "$N"; }
die()   { fail "$*"; printf '\n%sInstalación abortada.%s Log completo: %s\n' "$R" "$N" "$LOG_FILE" >&2; exit 1; }

# Los argumentos se expanden ANTES de entrar en la función, así que $LINENO y
# $BASH_COMMAND aún apuntan al comando que falló y no a la propia trampa.
# Y todo va a stderr: si el fallo ocurre dentro de una sustitución de comandos,
# escribir en stdout contaminaría el archivo que se esté generando.
on_err() {
  fail "Error (código $1) en la línea $2: $3"
  printf '\n%sRevisa %s para el detalle.%s\n' "$Y" "$LOG_FILE" "$N" >&2
}
trap 'on_err "$?" "$LINENO" "$BASH_COMMAND"' ERR

banner() {
  printf '%s' "$B"
  cat <<'ASCII'
   _                    ___    _
  /_\  __ _  ___ _ __  |_ _|  /_\
 //_\\/ _` |/ _ \ '_ \  | |  //_\\
/  _  \ (_| |  __/ | | | | | /  _  \
\_/ \_/\__, |\___|_| |_|___|\_/ \_/
       |___/   instalador de producción para VPS
ASCII
  printf '%s\n' "$N"
}

# ── Opciones ────────────────────────────────────────────────────────────────
ASSUME_YES=0
CHECK_ONLY=0
DOMAIN_WEB=""
DOMAIN_API=""
SINGLE_DOMAIN=""
ACME_EMAIL=""
REPO_URL=""
REPO_BRANCH="main"
APP_DIR=""
HTTP_ONLY=0
SKIP_DNS=0
NO_FIREWALL=0
NO_SWAP=0
NO_BACKUP_CRON=0
GOOGLE_CREDS=""
DB_HOST_PORT="49317"
SERVER_TZ="America/Bogota"

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  cat <<EOF

OPCIONES
  -y, --yes                  No preguntar nada (requiere dominios o --http-only)
      --check                Solo ejecutar diagnóstico previo y salir
      --single-domain <host> UN solo dominio: panel en / y API en /api
                             (ej: hsvpanserma.agenia.co). Solo necesita un
                             registro DNS; es la opción más simple.
      --domain-web <host>    Dominio del panel web            (ej: app.clinica.com)
      --domain-api <host>    Dominio de la API/webhook        (ej: api.clinica.com)
      --email <correo>       Correo para los certificados Let's Encrypt
      --http-only            Sin dominio: publica por IP en HTTP (solo pruebas)
      --repo <url>           Repositorio a clonar si el código no está presente
      --branch <rama>        Rama a desplegar (por defecto: main)
      --dir <ruta>           Directorio de instalación (por defecto: el del repo)
      --google-credentials <ruta>  JSON de service account de Google Cloud (TTS)
      --db-port <puerto>     Puerto local de PostgreSQL (por defecto 49317)
      --timezone <tz>        Zona horaria del servidor (por defecto America/Bogota)
      --skip-dns-check       No validar que los dominios apunten a este servidor
      --no-firewall          No configurar UFW
      --no-swap              No crear swap aunque haga falta
      --no-backup-cron       No instalar el backup diario de PostgreSQL
  -h, --help                 Esta ayuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)               ASSUME_YES=1 ;;
    --check)                CHECK_ONLY=1 ;;
    --single-domain)        SINGLE_DOMAIN="${2:?}"; shift ;;
    --domain-web)           DOMAIN_WEB="${2:?}"; shift ;;
    --domain-api)           DOMAIN_API="${2:?}"; shift ;;
    --email)                ACME_EMAIL="${2:?}"; shift ;;
    --http-only)            HTTP_ONLY=1 ;;
    --repo)                 REPO_URL="${2:?}"; shift ;;
    --branch)               REPO_BRANCH="${2:?}"; shift ;;
    --dir)                  APP_DIR="${2:?}"; shift ;;
    --google-credentials)   GOOGLE_CREDS="${2:?}"; shift ;;
    --db-port)              DB_HOST_PORT="${2:?}"; shift ;;
    --timezone)             SERVER_TZ="${2:?}"; shift ;;
    --skip-dns-check)       SKIP_DNS=1 ;;
    --no-firewall)          NO_FIREWALL=1 ;;
    --no-swap)              NO_SWAP=1 ;;
    --no-backup-cron)       NO_BACKUP_CRON=1 ;;
    -h|--help)              usage; exit 0 ;;
    *) echo "Opción desconocida: $1"; usage; exit 1 ;;
  esac
  shift
done

# ── Entrada interactiva (funciona incluso con `curl … | bash`) ──────────────
TTY_IN="/dev/stdin"
[[ -t 0 ]] || { [[ -r /dev/tty ]] && TTY_IN="/dev/tty" || ASSUME_YES=1; }

ask() {  # ask VAR "Pregunta" "valor por defecto"
  local __var="$1" __prompt="$2" __def="${3:-}" __ans=""
  if [[ $ASSUME_YES -eq 1 ]]; then
    printf -v "$__var" '%s' "$__def"; return
  fi
  if [[ -n "$__def" ]]; then
    read -r -p "  ${__prompt} [${__def}]: " __ans < "$TTY_IN" || true
  else
    read -r -p "  ${__prompt}: " __ans < "$TTY_IN" || true
  fi
  printf -v "$__var" '%s' "${__ans:-$__def}"
}

confirm() {  # confirm "Pregunta" (default sí)
  [[ $ASSUME_YES -eq 1 ]] && return 0
  local a=""
  read -r -p "  $1 [S/n]: " a < "$TTY_IN" || true
  [[ -z "$a" || "$a" =~ ^[SsYy] ]]
}

gen_secret()  { openssl rand -hex 32; }   # 64 hex — vale como ENCRYPTION_KEY
gen_pass()    { openssl rand -hex 16; }   # 32 alfanuméricos, sin caracteres raros
env_get()     { [[ -f "$2" ]] && awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/,""); print; exit}' "$2" || true; }

# ═════════════════════════════════════════════════════════════════════════════
banner
[[ $EUID -eq 0 ]] || die "Ejecuta como root:  sudo bash $0 $*"
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
log "${D}Inicio: $(date -Is) — log: $LOG_FILE${N}"

# ── 01. Diagnóstico del servidor ────────────────────────────────────────────
step "Diagnóstico del servidor"

# El propio diagnóstico necesita curl y ss; una imagen mínima de Debian puede
# no traerlos. Se instalan antes de nada para que las comprobaciones sean reales.
if ! command -v curl >/dev/null 2>&1 || ! command -v ss >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    curl ca-certificates iproute2 >/dev/null
fi

[[ -r /etc/os-release ]] || die "No se pudo leer /etc/os-release"
# shellcheck disable=SC1091
. /etc/os-release
OS_ID="${ID:-desconocido}"
OS_LIKE="${ID_LIKE:-}"
OS_CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"

case "$OS_ID" in
  debian|ubuntu) ok "Sistema: $PRETTY_NAME ($OS_CODENAME)" ;;
  *)
    if [[ "$OS_LIKE" == *debian* ]]; then
      warn "Distribución derivada de Debian ($PRETTY_NAME). Se intentará continuar."
      # Los repos de Docker solo publican para debian y ubuntu.
      [[ "$OS_LIKE" == *ubuntu* ]] && OS_ID=ubuntu || OS_ID=debian
    else
      die "Solo se soporta Debian/Ubuntu. Detectado: $PRETTY_NAME"
    fi ;;
esac
[[ -n "$OS_CODENAME" ]] || die "No se pudo determinar el nombre en clave de la distribución"

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64|arm64) ok "Arquitectura: $ARCH" ;;
  *) die "Arquitectura no soportada: $ARCH" ;;
esac

CPUS="$(nproc)"
MEM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
DISK_FREE_GB="$(df -BG --output=avail / | tail -1 | tr -dc '0-9')"

(( CPUS >= 2 ))  && ok "CPU: $CPUS núcleos"            || warn "CPU: $CPUS núcleo(s) — la compilación será lenta"
(( MEM_MB >= 3500 )) && ok "Memoria: ${MEM_MB} MB"     || warn "Memoria: ${MEM_MB} MB — se creará swap para poder compilar"
(( MEM_MB >= 1800 )) || die "Se requieren al menos 2 GB de RAM"
(( DISK_FREE_GB >= 15 )) && ok "Disco libre: ${DISK_FREE_GB} GB" || die "Se requieren 15 GB libres en / (hay ${DISK_FREE_GB} GB)"

if getent hosts deb.debian.org >/dev/null 2>&1 || getent hosts archive.ubuntu.com >/dev/null 2>&1; then
  ok "Resolución DNS operativa"
else
  die "El servidor no resuelve DNS. Revisa /etc/resolv.conf antes de continuar."
fi

# Puertos 80/443: si otro servicio los ocupa, Caddy no podrá arrancar ni emitir
# certificados. Los contenedores del propio stack no cuentan como conflicto.
port_conflict() {
  local p="$1" holder
  holder="$(ss -ltnp "sport = :$p" 2>/dev/null | awk 'NR>1 {print $NF}' | head -1)"
  [[ -z "$holder" ]] && return 1
  [[ "$holder" == *docker-proxy* ]] && return 1
  echo "$holder"; return 0
}
for p in 80 443; do
  if holder="$(port_conflict "$p")"; then
    warn "El puerto $p está ocupado por: $holder"
    CONFLICT=1
  else
    ok "Puerto $p libre"
  fi
done
if [[ "${CONFLICT:-0}" == "1" ]]; then
  warn "Detén el servicio que ocupa 80/443 (nginx, apache2…) o el HTTPS fallará:"
  warn "  systemctl disable --now nginx apache2 2>/dev/null || true"
  [[ $CHECK_ONLY -eq 1 ]] || confirm "¿Continuar de todos modos?" || die "Cancelado por puertos ocupados."
fi

PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null \
          || curl -fsS --max-time 8 https://ifconfig.me 2>/dev/null \
          || ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
[[ -n "$PUBLIC_IP" ]] && ok "IP pública: $PUBLIC_IP" || warn "No se pudo determinar la IP pública"

if [[ $CHECK_ONLY -eq 1 ]]; then
  printf '\n%sDiagnóstico terminado.%s El servidor cumple los requisitos.\n' "$G" "$N"
  exit 0
fi

# ── 02. Paquetes base ───────────────────────────────────────────────────────
step "Paquetes base del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl gnupg git jq openssl ufw rsync tzdata \
  iproute2 dnsutils cron coreutils >/dev/null
ok "Instalados: git, curl, openssl, jq, ufw, dnsutils, cron…"

if [[ "$(cat /etc/timezone 2>/dev/null)" != "$SERVER_TZ" ]]; then
  timedatectl set-timezone "$SERVER_TZ" 2>/dev/null || ln -snf "/usr/share/zoneinfo/$SERVER_TZ" /etc/localtime
  ok "Zona horaria del servidor: $SERVER_TZ"
else
  ok "Zona horaria ya configurada: $SERVER_TZ"
fi

# ── 03. Swap ────────────────────────────────────────────────────────────────
step "Memoria de intercambio (swap)"
if [[ $NO_SWAP -eq 1 ]]; then
  info "Omitido por --no-swap"
elif [[ -n "$(swapon --show --noheadings 2>/dev/null)" ]]; then
  ok "Ya existe swap activa ($(swapon --show=SIZE --noheadings | tr '\n' ' '))"
elif (( MEM_MB >= 7500 )); then
  ok "No hace falta swap: ${MEM_MB} MB de RAM son suficientes para compilar"
else
  fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap de 4 GB creada y activada"
fi

# ── 04. Docker ──────────────────────────────────────────────────────────────
step "Docker Engine + plugin Compose"
if docker compose version >/dev/null 2>&1; then
  ok "Ya instalado: $(docker --version | cut -d, -f1), $(docker compose version --short 2>/dev/null | sed 's/^/compose /')"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${OS_ID} ${OS_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  ok "Docker instalado: $(docker --version | cut -d, -f1)"
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker info >/dev/null 2>&1 || die "El demonio de Docker no responde (systemctl status docker)"
ok "Demonio de Docker operativo y habilitado en el arranque"

# ── 05. Código fuente ───────────────────────────────────────────────────────
step "Código fuente de la aplicación"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
SCRIPT_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "$APP_DIR" ]]; then
  if [[ -f "$SCRIPT_REPO/docker-compose.deploy.yml" ]]; then
    APP_DIR="$SCRIPT_REPO"
  else
    APP_DIR="/opt/agenia"
  fi
fi

if [[ ! -f "$APP_DIR/docker-compose.deploy.yml" ]]; then
  if [[ -z "$REPO_URL" ]]; then
    log "  El código no está en $APP_DIR."
    ask REPO_URL "URL del repositorio git (https://usuario:token@github.com/…)" ""
    [[ -n "$REPO_URL" ]] || die "Sin repositorio no hay nada que instalar. Usa --repo <url>."
  fi
  mkdir -p "$(dirname "$APP_DIR")"
  # La salida se filtra: la URL puede llevar un token embebido y este log queda
  # en disco. Solo se muestra el error, con el token enmascarado.
  clone_err="$(mktemp)"
  if ! git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR" >/dev/null 2>"$clone_err"; then
    sed -E 's#://[^@/]+@#://***@#g' "$clone_err" >&2
    rm -f "$clone_err"
    die "No se pudo clonar el repositorio (¿URL, rama o credenciales incorrectas?)"
  fi
  rm -f "$clone_err"
  ok "Repositorio clonado en $APP_DIR (rama $REPO_BRANCH)"
else
  ok "Código presente en $APP_DIR"
fi

cd "$APP_DIR"
for f in docker-compose.deploy.yml deploy/Dockerfile.api deploy/Dockerfile.web deploy/agenia.sh packages/database/prisma/schema.prisma; do
  [[ -f "$f" ]] || die "Falta $f en $APP_DIR. El checkout no está completo o es anterior a esta versión del instalador."
done
ok "Archivos de despliegue verificados"

# El remote puede llevar un token embebido; que no quede legible para todos.
chmod 700 "$APP_DIR/.git" 2>/dev/null || true

# ── 06. Configuración ───────────────────────────────────────────────────────
step "Configuración del despliegue"
ENV_FILE="$APP_DIR/.env.production"
FIRST_RUN=1
[[ -f "$ENV_FILE" ]] && { FIRST_RUN=0; ok "Configuración previa detectada: se conservan secretos y dominios"; }

# ── Modo de publicación ──────────────────────────────────────────────────────
#   single : un dominio. Panel en / y API en /api. Un solo registro DNS.
#   dual   : dos dominios (app.… y api.…). Dos registros DNS.
#   http   : sin dominio, por IP y sin TLS. Solo pruebas.
#
# Los valores de una instalación previa mandan sobre los flags: cambiar de modo
# a mitad de camino invalidaría los certificados ya emitidos.
PREV_WEB_URL="$(env_get PUBLIC_WEB_URL "$ENV_FILE")"
PREV_API_URL="$(env_get PUBLIC_API_URL "$ENV_FILE")"

if [[ -n "$PREV_WEB_URL" ]]; then
  if [[ "$PREV_WEB_URL" == http://* ]]; then
    DOMAIN_MODE="http"
  elif [[ "$PREV_API_URL" == "$PREV_WEB_URL/api" ]]; then
    DOMAIN_MODE="single"; SINGLE_DOMAIN="${PREV_WEB_URL#*://}"
  else
    DOMAIN_MODE="dual"; DOMAIN_WEB="${PREV_WEB_URL#*://}"; DOMAIN_API="${PREV_API_URL#*://}"
  fi
elif [[ -n "$SINGLE_DOMAIN" ]]; then
  DOMAIN_MODE="single"
elif [[ -n "$DOMAIN_WEB" ]]; then
  DOMAIN_MODE="dual"
elif [[ $HTTP_ONLY -eq 1 ]]; then
  DOMAIN_MODE="http"
else
  log ""
  log "  ${BOLD}¿Cómo se publica el sistema?${N}"
  log "    ${BOLD}1${N}) Un solo dominio — panel en /, API en /api.  ${D}(un registro DNS; recomendado)${N}"
  log "    ${BOLD}2${N}) Dos dominios    — app.… y api.…            ${D}(dos registros DNS)${N}"
  log "    ${BOLD}3${N}) Sin dominio     — por IP y sin HTTPS        ${D}(solo pruebas)${N}"
  ask MODE_CHOICE "Opción" "1"
  case "$MODE_CHOICE" in
    2) DOMAIN_MODE="dual" ;;
    3) DOMAIN_MODE="http" ;;
    *) DOMAIN_MODE="single" ;;
  esac
fi

case "$DOMAIN_MODE" in
  single)
    [[ -n "$SINGLE_DOMAIN" ]] || ask SINGLE_DOMAIN "Dominio (ej: hsvpanserma.agenia.co)" ""
    [[ -n "$SINGLE_DOMAIN" ]] || die "Falta el dominio (--single-domain <host>)"
    DOMAIN_WEB="$SINGLE_DOMAIN"; DOMAIN_API=""
    CHECK_DOMAINS=("$SINGLE_DOMAIN")
    WEB_URL="https://$SINGLE_DOMAIN"; API_URL_PUB="https://$SINGLE_DOMAIN/api"
    ;;
  dual)
    [[ -n "$DOMAIN_WEB" ]] || ask DOMAIN_WEB "Dominio del panel web" ""
    [[ -n "$DOMAIN_WEB" ]] || die "Falta el dominio del panel (--domain-web <host>)"
    if [[ -z "$DOMAIN_API" ]]; then
      # Sugerencia api.<raíz>: con un apex (clinica.com) la raíz es él mismo;
      # con un subdominio (app.clinica.com) se descarta la primera etiqueta.
      if [[ "${DOMAIN_WEB//[^.]/}" == "." ]]; then SUGGEST_API="api.${DOMAIN_WEB}"
      else SUGGEST_API="api.${DOMAIN_WEB#*.}"; fi
      ask DOMAIN_API "Dominio de la API/webhook" "$SUGGEST_API"
    fi
    [[ -n "$DOMAIN_API" ]] || die "Falta el dominio de la API (--domain-api <host>)"
    CHECK_DOMAINS=("$DOMAIN_WEB" "$DOMAIN_API")
    WEB_URL="https://$DOMAIN_WEB"; API_URL_PUB="https://$DOMAIN_API"
    ;;
  http)
    HTTP_ONLY=1; CHECK_DOMAINS=()
    WEB_URL="http://${PUBLIC_IP:-localhost}"; API_URL_PUB="http://${PUBLIC_IP:-localhost}/api"
    warn "Modo HTTP sin dominio: sirve para probar, pero el webhook de WhatsApp de Meta EXIGE HTTPS."
    ;;
esac

if [[ "$DOMAIN_MODE" != "http" ]]; then
  if [[ -z "$ACME_EMAIL" ]]; then
    ACME_EMAIL="$(env_get ACME_EMAIL "$APP_DIR/deploy/install.conf")"
    [[ -n "$ACME_EMAIL" ]] || ask ACME_EMAIL "Correo para avisos de Let's Encrypt" ""
  fi
  [[ -n "$ACME_EMAIL" ]] || die "Let's Encrypt requiere un correo (--email <correo>)"
fi

ok "Modo: $DOMAIN_MODE"
ok "Panel web   → $WEB_URL"
ok "API/webhook → $API_URL_PUB"

# ── 07. DNS ─────────────────────────────────────────────────────────────────
step "Verificación de DNS"
if [[ "$DOMAIN_MODE" == "http" ]]; then
  info "Omitida (modo HTTP por IP)"
elif [[ $SKIP_DNS -eq 1 ]]; then
  info "Omitida por --skip-dns-check"
else
  dns_mismatch=0
  for d in "${CHECK_DOMAINS[@]}"; do
    resolved="$(dig +short +time=3 +tries=2 A "$d" 2>/dev/null | tail -1)"
    if [[ -z "$resolved" ]]; then
      fail "$d no resuelve todavía"; dns_mismatch=1
    elif [[ -n "$PUBLIC_IP" && "$resolved" != "$PUBLIC_IP" ]]; then
      fail "$d apunta a $resolved, no a $PUBLIC_IP"; dns_mismatch=1
    else
      ok "$d → $resolved"
    fi
  done
  if [[ $dns_mismatch -eq 1 ]]; then
    warn "Con el DNS mal, Let's Encrypt no podrá emitir el certificado y el sitio quedará sin HTTPS."
    warn "Crea los registros A y espera a que propaguen (suele tardar minutos)."
    confirm "¿Continuar igualmente? (el stack quedará arriba y Caddy reintentará solo)" \
      || die "Cancelado: corrige el DNS y vuelve a ejecutar el instalador."
  fi
fi

# ── 08. Secretos y variables de entorno ─────────────────────────────────────
step "Secretos y variables de entorno"
POSTGRES_USER="$(env_get POSTGRES_USER "$ENV_FILE")";       POSTGRES_USER="${POSTGRES_USER:-agenia}"
POSTGRES_DB="$(env_get POSTGRES_DB "$ENV_FILE")";           POSTGRES_DB="${POSTGRES_DB:-antigravity}"
POSTGRES_PASSWORD="$(env_get POSTGRES_PASSWORD "$ENV_FILE")"; POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(gen_pass)}"
JWT_SECRET="$(env_get JWT_SECRET "$ENV_FILE")";             JWT_SECRET="${JWT_SECRET:-$(gen_secret)}"
ENCRYPTION_KEY="$(env_get ENCRYPTION_KEY "$ENV_FILE")";     ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(gen_secret)}"
PURGE_PASSWORD="$(env_get SUPERADMIN_PURGE_PASSWORD "$ENV_FILE")"; PURGE_PASSWORD="${PURGE_PASSWORD:-$(gen_pass)}"
PRIVACY_URL="$(env_get PRIVACY_POLICY_URL "$ENV_FILE")"
PRIVACY_URL="${PRIVACY_URL:-https://www.hospitalsanvicenteanserma.gov.co/transparencia/proteccion-datos-personales}"
# El puerto ya elegido en una instalación previa manda sobre el valor por
# defecto del flag: cambiarlo a mitad de camino rompería túneles y scripts.
PREV_DB_PORT="$(env_get DB_HOST_PORT "$ENV_FILE")"; DB_HOST_PORT="${PREV_DB_PORT:-$DB_HOST_PORT}"

# La ENCRYPTION_KEY cifra las credenciales de WhatsApp/LLM guardadas en la BD:
# si cambia, esos registros dejan de poder descifrarse.
[[ "$ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]] || die "ENCRYPTION_KEY inválida en $ENV_FILE: deben ser 64 caracteres hexadecimales."

# Credenciales de Google Cloud (TTS) — opcionales.
mkdir -p "$APP_DIR/deploy/secrets"; chmod 700 "$APP_DIR/deploy/secrets"
GOOGLE_LINE="# GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-credentials.json  (sin configurar)"
if [[ -n "$GOOGLE_CREDS" ]]; then
  [[ -f "$GOOGLE_CREDS" ]] || die "No existe el archivo de credenciales: $GOOGLE_CREDS"
  jq -e .type "$GOOGLE_CREDS" >/dev/null 2>&1 || die "$GOOGLE_CREDS no parece un JSON de service account de Google"
  cp "$GOOGLE_CREDS" "$APP_DIR/deploy/secrets/google-credentials.json"
fi
if [[ -f "$APP_DIR/deploy/secrets/google-credentials.json" ]]; then
  chmod 600 "$APP_DIR/deploy/secrets/google-credentials.json"
  GOOGLE_LINE="GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-credentials.json"
  ok "Credenciales de Google Cloud TTS instaladas"
else
  warn "Sin credenciales de Google Cloud: el TTS de Google quedará inactivo (se puede añadir después)"
fi

DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"

umask 077
cat > "$ENV_FILE" <<EOF
# =============================================================================
# .env.production — generado por deploy/install-vps.sh el $(date -Is)
#
# Lo consume docker compose (env_file) y llega como variables de entorno a los
# contenedores api y web. NO usar comillas: los valores se leen tal cual.
# Este archivo NO entra en las imágenes (ver .dockerignore) y NO va a git.
# =============================================================================
NODE_ENV=production
TZ=${SERVER_TZ}
PORT=3000

# ── PostgreSQL ───────────────────────────────────────────────────────────────
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
# Puerto en 127.0.0.1 del host para administración (túnel SSH). Nunca 0.0.0.0.
DB_HOST_PORT=${DB_HOST_PORT}
# 'postgres' es el nombre del servicio en la red interna de Docker.
DATABASE_URL=${DATABASE_URL}

# ── Redis ────────────────────────────────────────────────────────────────────
# redis.service.ts lee EXCLUSIVAMENTE REDIS_URL (REDIS_HOST/REDIS_PORT se ignoran).
REDIS_URL=redis://redis:6379

# ── Secretos ─────────────────────────────────────────────────────────────────
# JWT_SECRET debe ser IDÉNTICO en api y web: la web firma la cookie de sesión
# y la API valida ese mismo token.
JWT_SECRET=${JWT_SECRET}
# AES-256-GCM (64 hex). Cifra credenciales de WhatsApp y de los LLM en la BD.
# ⚠️ Si cambia, esas credenciales guardadas quedan ilegibles.
ENCRYPTION_KEY=${ENCRYPTION_KEY}
# Contraseña que exige el Super Admin para purgar una organización.
SUPERADMIN_PURGE_PASSWORD=${PURGE_PASSWORD}

# ── URLs públicas ────────────────────────────────────────────────────────────
PUBLIC_WEB_URL=${WEB_URL}
PUBLIC_API_URL=${API_URL_PUB}
API_URL=${API_URL_PUB}
# Llamadas internas web → api (las sobreescribe docker-compose.deploy.yml).
INTERNAL_API_URL=http://api:3000
NEXT_PUBLIC_API_URL=http://api:3000
# Habeas Data (Ley 1581 de 2012): se enlaza antes de confirmar cada cita.
PRIVACY_POLICY_URL=${PRIVACY_URL}

# ── Voz / TTS ────────────────────────────────────────────────────────────────
ACTIVE_TTS_PROVIDER=GOOGLE
${GOOGLE_LINE}
SHOW_TEXT_IN_AUDIO_MODE=false
VOICE_SLOTS_SPOKEN_COUNT=3

# ── WhatsApp (Meta) ──────────────────────────────────────────────────────────
# Con true (recomendado) se exige la firma X-Hub-Signature-256. Requiere haber
# cargado el App Secret de la clínica en el panel. Solo durante la puesta en
# marcha inicial puede ponerse en false; devuélvelo a true en cuanto lo cargues.
META_REQUIRE_SIGNATURE=true
# App Secret global, si operas una sola app de Meta para todas las clínicas:
# META_APP_SECRET=

# ── Recordatorios de cita ────────────────────────────────────────────────────
REMINDER_BUSINESS_HOURS_BEFORE=24
REMINDER_CRON_MINUTES=15

# ── Chatbot / colas ──────────────────────────────────────────────────────────
CHATBOT_INACTIVITY_TIMEOUT_MINUTES=5
INBOUND_MAX_CONCURRENCY=20
INBOUND_MAX_QUEUE=500
INBOUND_DEDUP_TTL_SECONDS=21600
LLM_FAILOVER_ENABLED=true
LLM_MAX_RETRIES=5

# ── Monitor de servicios externos ────────────────────────────────────────────
MONITOR_ENABLED=true
MONITOR_BG_INTERVAL_MINUTES=15
MONITOR_LIVE_INTERVAL_SECONDS=5
MONITOR_DEFAULT_TIMEOUT_MS=5000
MONITOR_DEGRADED_THRESHOLD_MS=3000
MONITOR_RETENTION_DAYS=365
EOF
chmod 600 "$ENV_FILE"
ok "$ENV_FILE ($( [[ $FIRST_RUN -eq 1 ]] && echo 'secretos nuevos generados' || echo 'secretos existentes conservados' ))"

# `next build` instancia PrismaClient al importar lib/prisma.ts, así que
# DATABASE_URL tiene que existir en tiempo de compilación dentro de la imagen.
cat > "$APP_DIR/apps/web/.env" <<EOF
# Generado por deploy/install-vps.sh — necesario en tiempo de BUILD de Next.
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
API_URL=${API_URL_PUB}
INTERNAL_API_URL=http://api:3000
NEXT_PUBLIC_API_URL=http://api:3000
EOF
cat > "$APP_DIR/packages/database/.env" <<EOF
# Generado por deploy/install-vps.sh — lo lee el CLI de Prisma.
DATABASE_URL=${DATABASE_URL}
EOF
chmod 600 "$APP_DIR/apps/web/.env" "$APP_DIR/packages/database/.env"
ok "Variables de build para web y Prisma"

cat > "$APP_DIR/deploy/install.conf" <<EOF
# Respuestas no sensibles reutilizadas en las siguientes ejecuciones.
DOMAIN_MODE=${DOMAIN_MODE}
SINGLE_DOMAIN=${SINGLE_DOMAIN}
DOMAIN_WEB=${DOMAIN_WEB}
DOMAIN_API=${DOMAIN_API}
ACME_EMAIL=${ACME_EMAIL}
APP_DIR=${APP_DIR}
EOF
umask 022

# ── 09. Proxy inverso ───────────────────────────────────────────────────────
step "Proxy inverso (Caddy) y certificados"
if [[ "$DOMAIN_MODE" == "single" ]]; then
  # Un solo sitio: / va al panel y /api/* a la API. `handle_path` quita el
  # prefijo, así que /api/chatbot/webhook llega a la API como /chatbot/webhook.
  cat > "$APP_DIR/deploy/Caddyfile" <<EOF
# Generado por deploy/install-vps.sh el $(date -Is) — modo de un solo dominio.
# Caddy pide y renueva los certificados de Let's Encrypt automáticamente.
{
	email ${ACME_EMAIL}
}

${SINGLE_DOMAIN} {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	# ── SUPERFICIE PÚBLICA DE LA API ────────────────────────────────────────
	# Solo el webhook de Meta necesita ser alcanzable desde internet. El resto
	# de la API (historias clínicas, analytics, super-admin, FHIR…) lo consume
	# el panel por la red interna de Docker (http://api:3000), así que no se
	# publica: reduce la superficie de ataque de ~19 controladores a 1 ruta.
	#
	# Para publicar otra ruta, añade aquí su bloque 'handle' con el mismo
	# patrón (matcher + uri strip_prefix /api + reverse_proxy).
	#
	# OJO: la imagen de la API escucha en 3000, no en 3001.
	handle /api/chatbot/webhook* {
		uri strip_prefix /api
		reverse_proxy api:3000
	}

	# Cualquier otra ruta bajo /api no existe de cara a internet. Se responde
	# 404 (no 403) para no confirmar qué endpoints hay detrás.
	handle /api/* {
		respond "Not Found" 404
	}

	# Todo lo demás: panel Next.js.
	handle {
		reverse_proxy web:3000
	}
}
EOF
elif [[ "$DOMAIN_MODE" == "http" ]]; then
  cat > "$APP_DIR/deploy/Caddyfile" <<'EOF'
# Generado por deploy/install-vps.sh — modo IP/HTTP (sin TLS, solo pruebas).
:80 {
	encode zstd gzip

	# Solo el webhook de Meta se publica; ver comentario en el modo con dominio.
	handle /api/chatbot/webhook* {
		uri strip_prefix /api
		reverse_proxy api:3000
	}
	handle /api/* {
		respond "Not Found" 404
	}
	handle {
		reverse_proxy web:3000
	}
}
EOF
else
  cat > "$APP_DIR/deploy/Caddyfile" <<EOF
# Generado por deploy/install-vps.sh el $(date -Is).
# Caddy pide y renueva los certificados de Let's Encrypt automáticamente.
{
	email ${ACME_EMAIL}
}

(comunes) {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
}

# Panel web (Next.js)
${DOMAIN_WEB} {
	import comunes
	reverse_proxy web:3000
}

# API / webhook de WhatsApp (NestJS).
#
# Solo se publica el webhook de Meta: el resto de la API lo consume el panel
# por la red interna de Docker (http://api:3000) y no tiene por qué estar
# expuesto. Para publicar otra ruta, añade su bloque 'handle' aquí.
#
# OJO: la imagen de la API escucha en 3000, no en 3001.
${DOMAIN_API} {
	import comunes

	handle /chatbot/webhook* {
		reverse_proxy api:3000
	}

	# 404 en vez de 403: no confirma qué endpoints existen detrás.
	handle {
		respond "Not Found" 404
	}
}
EOF
fi
ok "deploy/Caddyfile generado"

# Un Caddyfile mal formado no da error al arrancar: deja el contenedor en un
# bucle de reinicio silencioso y el sitio caído. Se valida aquí, con la misma
# imagen que lo va a servir, para fallar de inmediato y con el motivo exacto.
if CADDY_ERR="$(docker run --rm -v "$APP_DIR/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
     caddy:2-alpine caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile 2>&1)"; then
  ok "Caddyfile validado"
else
  echo "$CADDY_ERR" | tail -5
  die "El Caddyfile generado no es válido (ver error arriba)."
fi

DC=(docker compose --env-file "$ENV_FILE" -f "$APP_DIR/docker-compose.deploy.yml")
"${DC[@]}" config >/dev/null || die "docker-compose.deploy.yml no es válido con esta configuración"
ok "Definición de compose validada"

# ── 10. Construcción de imágenes ────────────────────────────────────────────
step "Construcción de imágenes (pnpm install + prisma generate + builds)"
log "  ${D}Es el paso largo: entre 5 y 15 minutos la primera vez.${N}"
"${DC[@]}" build --pull || die "Falló la construcción de imágenes. Revisa el log: $LOG_FILE"
ok "Imágenes api y web construidas"

# ── 11. Datos: PostgreSQL, Redis y migraciones ──────────────────────────────
step "Base de datos y migraciones"
"${DC[@]}" up -d postgres redis
info "Esperando a que PostgreSQL y Redis estén saludables…"
for svc in postgres redis; do
  cid="$("${DC[@]}" ps -q "$svc")"
  for i in $(seq 1 60); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
    [[ "$st" == "healthy" ]] && break
    sleep 2
    (( i == 60 )) && die "$svc no llegó a estado healthy. Revisa: agenia logs $svc"
  done
  ok "$svc saludable"
done


# ── Arranque de la base de datos ────────────────────────────────────────────
# El historial de migraciones de este repo NO puede construir una base vacía:
# `Organization` y todo el modelo multi-tenant se crearon en su día con
# `prisma db push`, nunca se capturaron como migración, y la migración
# 20260517045511 falla con «relation "Organization" does not exist».
#
# Por eso se distinguen tres situaciones:
#   BD virgen        → `db push` (esquema completo desde schema.prisma) y luego
#                      se sella el historial (baseline de Prisma) para que las
#                      próximas actualizaciones sí sean incrementales.
#   Esquema sin sello→ solo se sella el historial.
#   BD ya sellada    → `migrate deploy` normal.
db_has_table() {
  local t="$1" out
  out="$("${DC[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
        "SELECT to_regclass('public.\"$t\"') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')"
  [[ "$out" == "t" ]]
}

db_baseline() {
  "${DC[@]}" run --rm --entrypoint sh migrator -c '
    set -e
    for d in packages/database/prisma/migrations/*/; do
      prisma migrate resolve --applied "$(basename "$d")" \
        --schema=packages/database/prisma/schema.prisma >/dev/null 2>&1 || true
    done'
}

db_bootstrap() {
  if db_has_table "_prisma_migrations"; then
    info "Base ya inicializada: aplicando migraciones pendientes"
    "${DC[@]}" run --rm migrator
  elif db_has_table "Organization"; then
    info "Esquema presente sin historial: sellando migraciones"
    db_baseline
  else
    info "Base vacía: creando el esquema completo desde schema.prisma"
    "${DC[@]}" run --rm migrator \
      prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate
    info "Sellando el historial de migraciones (baseline)"
    db_baseline
  fi
}

db_bootstrap || die "Falló la inicialización de la base de datos. Reintenta con: agenia migrate"

TABLES="$("${DC[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d '[:space:]')"
# Sin el valor por defecto, un psql fallido dejaría la variable vacía y la
# comparación aritmética sería un error de sintaxis, no un diagnóstico.
TABLES="${TABLES:-0}"
[[ "$TABLES" =~ ^[0-9]+$ ]] || TABLES=0
(( TABLES > 20 )) || die "El esquema quedó incompleto (solo $TABLES tablas)."
ok "Esquema aplicado: $TABLES tablas"

# ── 12. Arranque del stack ──────────────────────────────────────────────────
step "Arranque de la aplicación"
"${DC[@]}" up -d
info "Esperando a que api y web respondan…"
for svc in api web; do
  cid="$("${DC[@]}" ps -q "$svc")"
  for i in $(seq 1 90); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
    [[ "$st" == "healthy" ]] && break
    if [[ "$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null)" == "exited" ]]; then
      "${DC[@]}" logs --tail 40 "$svc" || true
      die "El contenedor $svc se detuvo al arrancar (ver logs arriba)."
    fi
    sleep 2
    (( i == 90 )) && { "${DC[@]}" logs --tail 40 "$svc" || true; die "$svc no llegó a estado healthy."; }
  done
  ok "$svc saludable"
done

# ── 13. Endurecimiento: firewall y backups ──────────────────────────────────
step "Firewall y respaldos"
if [[ $NO_FIREWALL -eq 1 ]]; then
  info "UFW omitido por --no-firewall"
else
  SSH_PORT="$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/ {print $2; exit}' /etc/ssh/sshd_config 2>/dev/null || true)"
  SSH_PORT="${SSH_PORT:-22}"
  ufw allow "${SSH_PORT}/tcp" >/dev/null
  # Red de seguridad contra un bloqueo de SSH: el puerto por el que estás
  # conectado ahora mismo se abre pase lo que pase (sshd puede escuchar en un
  # puerto que no esté escrito en sshd_config, p. ej. vía systemd socket).
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    LIVE_SSH_PORT="${SSH_CONNECTION##* }"
    [[ "$LIVE_SSH_PORT" =~ ^[0-9]+$ && "$LIVE_SSH_PORT" != "$SSH_PORT" ]] && {
      ufw allow "${LIVE_SSH_PORT}/tcp" >/dev/null
      info "También se abrió el puerto ${LIVE_SSH_PORT}/tcp (tu sesión SSH actual)"
    }
  fi
  ufw allow 80/tcp  >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  if ufw status | grep -q "Status: inactive"; then
    ufw --force enable >/dev/null
  fi
  ok "UFW activo — abiertos ${SSH_PORT}/tcp (SSH), 80, 443. PostgreSQL y Redis solo por red interna."
fi

ln -sf "$APP_DIR/deploy/agenia.sh" /usr/local/bin/agenia
chmod +x "$APP_DIR/deploy/agenia.sh"
ok "Comando 'agenia' disponible en todo el sistema"

if [[ $NO_BACKUP_CRON -eq 1 ]]; then
  info "Backup diario omitido por --no-backup-cron"
else
  mkdir -p /var/backups/agenia
  printf '# Respaldo diario de AgenIA (retiene 14 días)\n30 3 * * * root /usr/local/bin/agenia backup >> /var/log/agenia-backup.log 2>&1\n' \
    > /etc/cron.d/agenia-backup
  chmod 644 /etc/cron.d/agenia-backup
  systemctl enable --now cron >/dev/null 2>&1 || true
  ok "Backup diario de PostgreSQL a las 03:30 en /var/backups/agenia"
fi

# ── 14. Verificación final ──────────────────────────────────────────────────
step "Verificación end-to-end"
if [[ "$DOMAIN_MODE" != "http" ]]; then
  info "Esperando el certificado TLS de Let's Encrypt (hasta 2 minutos)…"
  tls_ok=0
  for i in $(seq 1 40); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$WEB_URL" || echo 000)"
    [[ "$code" =~ ^(200|301|302|307|308)$ ]] && { tls_ok=1; break; }
    sleep 3
  done
  if [[ $tls_ok -eq 1 ]]; then
    ok "HTTPS operativo en $WEB_URL"
  else
    warn "Aún no responde $WEB_URL por HTTPS."
    warn "Casi siempre es DNS que no ha propagado. Caddy reintenta solo; revisa con: agenia logs caddy"
  fi
fi

VERIFY_RC=0
agenia verify || VERIFY_RC=$?

# ── Resumen ─────────────────────────────────────────────────────────────────
cat <<EOF

${G}${BOLD}════════════════════════════════════════════════════════════════════${N}
${G}${BOLD}  Instalación completada${N}
${G}${BOLD}════════════════════════════════════════════════════════════════════${N}

  ${BOLD}Accesos${N}
    Panel web ........ ${WEB_URL}
    Login ............ ${WEB_URL}/login
    API .............. ${API_URL_PUB}
    Webhook de Meta .. ${API_URL_PUB}/chatbot/webhook

  ${BOLD}Primer ingreso${N}  ${Y}(el usuario se crea solo en el primer login)${N}
    Usuario .......... superadmin@sanvicente.com
    Contraseña ....... admin123
    ${R}Cámbiala de inmediato desde el panel.${N}

  ${BOLD}Credenciales generadas${N}  ${D}(guárdalas en tu gestor de contraseñas)${N}
    Contraseña de purga del Super Admin: ${PURGE_PASSWORD}
    El resto de secretos están en ${ENV_FILE} (chmod 600).
    ${Y}Respalda ENCRYPTION_KEY${N}: sin ella no se pueden descifrar las
    credenciales de WhatsApp y de los LLM guardadas en la base de datos.

  ${BOLD}Operación diaria${N}
    agenia status            estado y salud de todo el stack
    agenia logs api -f       seguir los logs de la API
    agenia update            desplegar la última versión del repositorio
    agenia backup            respaldo manual de la base de datos
    agenia verify            volver a correr las comprobaciones

  ${BOLD}Siguientes pasos dentro del panel${N}
    1. Entrar como Super Admin y crear la organización (clínica).
    2. Cargar las credenciales de WhatsApp Business y el App Secret de Meta.
    3. Configurar el proveedor de IA (Gemini / ChatGPT / Claude) de la clínica.
    4. En Meta, registrar el webhook: ${API_URL_PUB}/chatbot/webhook
       con el verify token que definas en el panel.

  Log de esta instalación: ${LOG_FILE}
EOF

if [[ $VERIFY_RC -ne 0 ]]; then
  warn "La verificación final reportó incidencias — revísalas arriba y vuelve a correr 'agenia verify'."
  exit 1
fi
exit 0

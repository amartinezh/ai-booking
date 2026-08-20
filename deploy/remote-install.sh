#!/usr/bin/env bash
# =============================================================================
#  AgenIA — instalación REMOTA del VPS desde tu computador
# =============================================================================
#
#  Se ejecuta EN TU MÁQUINA (macOS o Linux), no en el servidor. Pide la IP del
#  VPS y la contraseña de root, y desde ahí hace todo por SSH:
#
#    1. Comprueba que el servidor responde y que el DNS apunta a él.
#    2. Instala tu llave SSH para root (fin del uso de contraseña).
#    3. Crea un usuario administrador con sudo y docker, con la contraseña que
#       tú definas — para no operar el día a día como root.
#    4. Copia el código a /opt/agenia (rsync, sin exponer tokens de GitHub).
#    5. Ejecuta deploy/install-vps.sh en el servidor y te muestra su salida.
#    6. Opcionalmente cierra el acceso SSH por contraseña.
#
#  USO
#    bash deploy/remote-install.sh                    # interactivo
#    bash deploy/remote-install.sh --check --host IP  # solo diagnostica
#
#  Es IDEMPOTENTE: se puede repetir. No pisa .env.production ni los secretos
#  ya generados en el servidor.
# =============================================================================
set -Eeuo pipefail

if [[ -t 1 ]]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; B=$'\033[1;34m'
  C=$'\033[0;36m'; D=$'\033[2m'; BOLD=$'\033[1m'; N=$'\033[0m'
else R=''; G=''; Y=''; B=''; C=''; D=''; BOLD=''; N=''; fi

STEP_NO=0; TOTAL_STEPS=9
log()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
info() { printf '  %s·%s %s\n' "$C" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail() { printf '  %s✘%s %s\n' "$R" "$N" "$*" >&2; }
step() { STEP_NO=$((STEP_NO+1)); printf '\n%s[%d/%d] %s%s\n' "$B" "$STEP_NO" "$TOTAL_STEPS" "$*" "$N"; }
die()  { fail "$*"; exit 1; }
# Los argumentos se expanden ANTES de entrar en la función, así que $LINENO y
# $BASH_COMMAND aún apuntan al comando que falló y no a la propia trampa.
on_err() { fail "Error (código $1) en la línea $2: $3"; }
trap 'on_err "$?" "$LINENO" "$BASH_COMMAND"' ERR

# ── Opciones ────────────────────────────────────────────────────────────────
VPS_IP=""; ROOT_PASS=""; ADMIN_USER=""; ADMIN_PASS=""
SINGLE_DOMAIN=""; DOMAIN_WEB=""; DOMAIN_API=""; ACME_EMAIL=""
REMOTE_DIR="/opt/agenia"; SSH_KEY=""; SSH_PORT="22"
CHECK_ONLY=0; HARDEN=""; HTTP_ONLY=0; SKIP_DNS=0; ASSUME_YES=0
GOOGLE_CREDS=""; SRC_DIR=""

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  cat <<EOF

OPCIONES
      --host <ip>            IP o host del VPS
      --ssh-port <puerto>    Puerto SSH del VPS (por defecto 22)
      --admin-user <nombre>  Usuario administrador a crear (por defecto: agenia)
      --single-domain <host> Un dominio: panel en / y API en /api (recomendado)
      --domain-web <host>    Modo dos dominios: panel
      --domain-api <host>    Modo dos dominios: API
      --http-only            Sin dominio, por IP y sin HTTPS (solo pruebas)
      --email <correo>       Correo para Let's Encrypt
      --google-credentials <ruta>  JSON de Google Cloud (TTS) a copiar al VPS
      --remote-dir <ruta>    Destino en el servidor (por defecto /opt/agenia)
      --ssh-key <ruta>       Llave SSH a usar (por defecto se crea una dedicada)
      --source <ruta>        Repo local a copiar (por defecto: el de este script)
      --harden | --no-harden Cerrar (o no) el acceso SSH por contraseña
      --skip-dns-check       No validar el DNS
      --check                Solo diagnostica: no modifica el servidor
  -y, --yes                  No preguntar lo que ya venga por flags
  -h, --help                 Esta ayuda

Las contraseñas NO se pasan por flag a propósito: se piden por teclado para que
no queden en el historial del shell ni en la lista de procesos.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)                VPS_IP="${2:?}"; shift ;;
    --ssh-port)            SSH_PORT="${2:?}"; shift ;;
    --admin-user)          ADMIN_USER="${2:?}"; shift ;;
    --single-domain)       SINGLE_DOMAIN="${2:?}"; shift ;;
    --domain-web)          DOMAIN_WEB="${2:?}"; shift ;;
    --domain-api)          DOMAIN_API="${2:?}"; shift ;;
    --http-only)           HTTP_ONLY=1 ;;
    --email)               ACME_EMAIL="${2:?}"; shift ;;
    --google-credentials)  GOOGLE_CREDS="${2:?}"; shift ;;
    --remote-dir)          REMOTE_DIR="${2:?}"; shift ;;
    --ssh-key)             SSH_KEY="${2:?}"; shift ;;
    --source)              SRC_DIR="${2:?}"; shift ;;
    --harden)              HARDEN=1 ;;
    --no-harden)           HARDEN=0 ;;
    --skip-dns-check)      SKIP_DNS=1 ;;
    --check)               CHECK_ONLY=1 ;;
    -y|--yes)              ASSUME_YES=1 ;;
    -h|--help)             usage; exit 0 ;;
    *) echo "Opción desconocida: $1"; usage; exit 1 ;;
  esac
  shift
done

ask() {
  local __var="$1" __prompt="$2" __def="${3:-}" __ans=""
  local __cur="${!__var:-}"
  [[ -n "$__cur" ]] && return 0
  if [[ $ASSUME_YES -eq 1 ]]; then printf -v "$__var" '%s' "$__def"; return 0; fi
  if [[ -n "$__def" ]]; then read -r -p "  ${__prompt} [${__def}]: " __ans
  else read -r -p "  ${__prompt}: " __ans; fi
  printf -v "$__var" '%s' "${__ans:-$__def}"
}

ask_pass() {  # ask_pass VAR "Prompt" [confirmar]
  local __var="$1" __prompt="$2" __confirm="${3:-0}" __a="" __b=""
  [[ -n "${!__var:-}" ]] && return 0
  while :; do
    read -r -s -p "  ${__prompt}: " __a; echo
    [[ -z "$__a" ]] && { fail "No puede quedar vacía."; continue; }
    if [[ "$__confirm" == "1" ]]; then
      read -r -s -p "  Repite la contraseña: " __b; echo
      [[ "$__a" != "$__b" ]] && { fail "No coinciden, intenta de nuevo."; continue; }
      (( ${#__a} >= 12 )) || { fail "Usa al menos 12 caracteres."; continue; }
    fi
    break
  done
  printf -v "$__var" '%s' "$__a"
}

confirm() {
  [[ $ASSUME_YES -eq 1 ]] && return 0
  local a=""; read -r -p "  $1 [S/n]: " a
  [[ -z "$a" || "$a" =~ ^[SsYy] ]]
}

# ── Utilidades SSH ──────────────────────────────────────────────────────────
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=20)

# Los errores de los comandos remotos se recogen aquí para poder enseñarlos:
# un fallo silencioso al otro lado de un SSH es imposible de diagnosticar.
ERR_TMP="$(mktemp)"
trap 'rm -f "$ERR_TMP"' EXIT

# Ejecuta un comando en el VPS autenticando con CONTRASEÑA.
# La contraseña viaja por variable de entorno hacia expect: nunca aparece en la
# línea de comandos y por tanto no es visible en `ps`.
ssh_pw() {
  local cmd="$1"
  if command -v sshpass >/dev/null 2>&1; then
    SSHPASS="$ROOT_PASS" sshpass -e ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" \
      -o PubkeyAuthentication=no -o PreferredAuthentications=password \
      "root@$VPS_IP" "$cmd"
    return $?
  fi
  RIP="$VPS_IP" RPW="$ROOT_PASS" RCMD="$cmd" RPORT="$SSH_PORT" expect -f - <<'EXP'
set timeout 120
log_user 1
spawn -noecho ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 \
      -o PubkeyAuthentication=no -o PreferredAuthentications=password \
      -o NumberOfPasswordPrompts=1 -p $env(RPORT) root@$env(RIP) $env(RCMD)
expect {
  -re "(?i)password:"        { send -- "$env(RPW)\r"; exp_continue }
  -re "(?i)permission denied" { exit 111 }
  eof
}
catch wait result
exit [lindex $result 3]
EXP
}

# Ejecuta un comando en el VPS con LLAVE (lo normal después del paso 3).
ssh_key() { ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" -i "$SSH_KEY" "root@$VPS_IP" "$@"; }
ssh_key_tty() { ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" -i "$SSH_KEY" -t "root@$VPS_IP" "$@"; }

# ═════════════════════════════════════════════════════════════════════════════
printf '%s' "$B"
cat <<'ASCII'
   _                    ___    _
  /_\  __ _  ___ _ __  |_ _|  /_\
 //_\\/ _` |/ _ \ '_ \  | |  //_\\
/  _  \ (_| |  __/ | | | | | /  _  \
\_/ \_/\__, |\___|_| |_|___|\_/ \_/
       |___/   instalación remota del VPS
ASCII
printf '%s\n' "$N"

# ── 1. Requisitos locales ───────────────────────────────────────────────────
step "Requisitos en tu computador"
for b in ssh rsync openssl ssh-keygen; do
  command -v "$b" >/dev/null 2>&1 || die "Falta '$b' en tu máquina."
done
ok "ssh, rsync, openssl disponibles"
if command -v sshpass >/dev/null 2>&1; then ok "sshpass disponible"
elif command -v expect >/dev/null 2>&1; then ok "expect disponible (se usará para el primer acceso)"
else die "Se necesita 'expect' o 'sshpass' para el primer acceso con contraseña.
     macOS trae expect en /usr/bin/expect; si no, instala: brew install sshpass"; fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -n "$SRC_DIR" ]] || SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
[[ -f "$SRC_DIR/docker-compose.deploy.yml" ]] || die "No encuentro el repo en $SRC_DIR (usa --source)"
ok "Código a desplegar: $SRC_DIR"

# ── 2. Datos del servidor ───────────────────────────────────────────────────
step "Datos del servidor"
ask VPS_IP "IP pública del VPS" ""
[[ -n "$VPS_IP" ]] || die "Se necesita la IP del VPS (--host)"
ask ADMIN_USER "Usuario administrador a crear" "agenia"
[[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{2,31}$ ]] || die "Nombre de usuario inválido: $ADMIN_USER"
[[ "$ADMIN_USER" == "root" ]] && die "El usuario administrador no puede ser root."

# Si ya hay llave instalada de un intento anterior, la contraseña de root no
# hace falta: se comprueba antes de molestar al usuario pidiéndola.
[[ -n "$SSH_KEY" ]] || SSH_KEY="$HOME/.ssh/agenia_${VPS_IP//[.:]/_}_ed25519"
# rsync recibe el comando ssh como UNA cadena que vuelve a partir por espacios:
# una ruta de llave con espacios se rompería de forma silenciosa y confusa.
case "$SSH_KEY" in
  *\ *) die "La ruta de la llave SSH no puede contener espacios: $SSH_KEY" ;;
esac
KEY_WORKS=0
if [[ -f "$SSH_KEY" ]] && ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" -i "$SSH_KEY" \
     -o BatchMode=yes "root@$VPS_IP" true 2>/dev/null; then
  KEY_WORKS=1
fi

if [[ $CHECK_ONLY -eq 0 ]]; then
  if [[ $KEY_WORKS -eq 1 ]]; then
    ok "Ya hay acceso por llave a root: no hace falta la contraseña"
  else
    ask_pass ROOT_PASS "Contraseña de root del VPS"
  fi
  log ""
  log "  ${BOLD}Contraseña para el nuevo usuario '$ADMIN_USER'${N} ${D}(mínimo 12 caracteres)${N}"
  log "  ${D}Si el usuario ya existe, se le reasigna esta contraseña.${N}"
  ask_pass ADMIN_PASS "Contraseña para $ADMIN_USER" 1
fi

# ── 3. Publicación y DNS ────────────────────────────────────────────────────
step "Dominio y DNS"
if [[ $HTTP_ONLY -eq 1 ]]; then
  DOMAIN_MODE="http"; CHECK_DOMAINS=()
elif [[ -n "$SINGLE_DOMAIN" ]]; then
  DOMAIN_MODE="single"; CHECK_DOMAINS=("$SINGLE_DOMAIN")
elif [[ -n "$DOMAIN_WEB" ]]; then
  DOMAIN_MODE="dual"
  [[ -n "$DOMAIN_API" ]] || die "En modo dos dominios falta --domain-api"
  CHECK_DOMAINS=("$DOMAIN_WEB" "$DOMAIN_API")
else
  log "  ${BOLD}1${N}) Un solo dominio — panel en /, API en /api  ${D}(un registro DNS; recomendado)${N}"
  log "  ${BOLD}2${N}) Dos dominios    — app.… y api.…           ${D}(dos registros DNS)${N}"
  log "  ${BOLD}3${N}) Sin dominio     — por IP, sin HTTPS        ${D}(solo pruebas)${N}"
  MODE_CHOICE=""; ask MODE_CHOICE "Opción" "1"
  case "$MODE_CHOICE" in
    2) DOMAIN_MODE="dual"
       ask DOMAIN_WEB "Dominio del panel" ""
       ask DOMAIN_API "Dominio de la API" ""
       CHECK_DOMAINS=("$DOMAIN_WEB" "$DOMAIN_API") ;;
    3) DOMAIN_MODE="http"; CHECK_DOMAINS=() ;;
    *) DOMAIN_MODE="single"
       ask SINGLE_DOMAIN "Dominio" ""
       [[ -n "$SINGLE_DOMAIN" ]] || die "Se necesita el dominio"
       CHECK_DOMAINS=("$SINGLE_DOMAIN") ;;
  esac
fi

if [[ "$DOMAIN_MODE" != "http" ]]; then
  ask ACME_EMAIL "Correo para avisos de Let's Encrypt" ""
  [[ -n "$ACME_EMAIL" ]] || die "Let's Encrypt requiere un correo"
  [[ "$ACME_EMAIL" == *@*.* ]] || die "Correo inválido: $ACME_EMAIL"

  if [[ $SKIP_DNS -eq 0 ]] && command -v dig >/dev/null 2>&1; then
    dns_bad=0
    for d in "${CHECK_DOMAINS[@]}"; do
      r="$(dig +short +time=3 A "$d" 2>/dev/null | tail -1)"
      if [[ -z "$r" ]]; then fail "$d no tiene registro A"; dns_bad=1
      elif [[ "$r" != "$VPS_IP" ]]; then fail "$d apunta a $r, no a $VPS_IP"; dns_bad=1
      else ok "$d → $r"; fi
    done
    if [[ $dns_bad -eq 1 ]]; then
      warn "Sin el DNS correcto, Let's Encrypt NO emitirá el certificado."
      warn "Crea los registros A que faltan apuntando a $VPS_IP y espera unos minutos."
      confirm "¿Continuar igualmente?" || die "Cancelado. Corrige el DNS y repite."
    fi
  else
    info "Verificación de DNS omitida"
  fi
fi
ok "Modo de publicación: $DOMAIN_MODE"

# ── 4. Llave SSH y primer acceso ────────────────────────────────────────────
step "Llave SSH y acceso a root"
if [[ -z "$SSH_KEY" ]]; then
  SSH_KEY="$HOME/.ssh/agenia_${VPS_IP//[.:]/_}_ed25519"
fi
if [[ ! -f "$SSH_KEY" ]]; then
  if [[ $CHECK_ONLY -eq 1 ]]; then
    info "Se crearía una llave nueva en $SSH_KEY ${D}(--check no escribe nada)${N}"
    PUBKEY=""
  else
    mkdir -p "$(dirname "$SSH_KEY")"; chmod 700 "$(dirname "$SSH_KEY")"
    ssh-keygen -t ed25519 -N '' -C "agenia-deploy@$(hostname -s)" -f "$SSH_KEY" >/dev/null
    ok "Llave nueva creada: $SSH_KEY"
    PUBKEY="$(cat "${SSH_KEY}.pub")"
  fi
else
  ok "Llave existente: $SSH_KEY"
  PUBKEY="$(cat "${SSH_KEY}.pub")"
fi

# Un VPS recién creado suele reutilizar una IP: la huella antigua en known_hosts
# haría fallar la conexión con un error confuso.
if ssh-keygen -F "$VPS_IP" >/dev/null 2>&1; then
  if [[ $CHECK_ONLY -eq 1 ]]; then
    info "Hay una huella antigua de $VPS_IP en known_hosts ${D}(--check no la toca)${N}"
  else
    info "Había una huella antigua de $VPS_IP en known_hosts; se elimina"
    ssh-keygen -R "$VPS_IP" >/dev/null 2>&1 || true
  fi
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  info "Modo --check: no se toca el servidor"
else
  if [[ $KEY_WORKS -eq 1 ]]; then
    ok "La llave ya estaba instalada para root"
  else
    info "Instalando la llave pública para root…"
    ssh_pw "mkdir -p /root/.ssh && chmod 700 /root/.ssh && \
            touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys && \
            grep -qxF '$PUBKEY' /root/.ssh/authorized_keys || echo '$PUBKEY' >> /root/.ssh/authorized_keys" \
      || die "No se pudo entrar como root con esa contraseña (¿IP o clave incorrecta? ¿el proveedor exige llave?)"
    ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" -i "$SSH_KEY" -o BatchMode=yes "root@$VPS_IP" true 2>/dev/null \
      || die "La llave se copió pero el acceso sin contraseña sigue fallando."
    ok "Acceso por llave verificado — la contraseña de root ya no se usará"
  fi
fi

# ── 5. Estado del servidor ──────────────────────────────────────────────────
step "Estado del servidor"
if [[ $CHECK_ONLY -eq 1 ]]; then
  info "El diagnóstico remoto necesita acceso al servidor; omitido en --check"
else
  SRV="$(ssh_key 'set -e
    . /etc/os-release
    echo "os=$PRETTY_NAME"
    echo "arch=$(dpkg --print-architecture 2>/dev/null || uname -m)"
    echo "cpus=$(nproc)"
    echo "mem_mb=$(awk "/MemTotal/ {printf \"%d\", \$2/1024}" /proc/meminfo)"
    echo "disk_gb=$(df -BG --output=avail / | tail -1 | tr -dc "0-9")"
    echo "docker=$(command -v docker >/dev/null && docker --version 2>/dev/null | cut -d, -f1 || echo no)"
    echo "app=$( [ -d '"$REMOTE_DIR"' ] && echo si || echo no )"
    echo "p80=$(ss -ltn "sport = :80" 2>/dev/null | wc -l)"')"
  # Nada de `eval` aquí. Un valor con espacios —"Ubuntu 24.04.4 LTS"— hacía
  # que bash asignara solo la primera palabra e intentara EJECUTAR el resto.
  # Además, evaluar la salida de una máquina remota es una vía de inyección
  # gratuita. Se lee clave por clave, como datos.
  srv() { printf '%s\n' "$SRV" | sed -n "s/^$1=//p" | head -1; }
  SRV_os="$(srv os)";           SRV_arch="$(srv arch)"
  SRV_cpus="$(srv cpus)";       SRV_mem_mb="$(srv mem_mb)"
  SRV_disk_gb="$(srv disk_gb)"; SRV_docker="$(srv docker)"
  SRV_app="$(srv app)"

  ok "Sistema: ${SRV_os:-?}  (${SRV_arch:-?})"
  ok "Recursos: ${SRV_cpus:-?} vCPU · ${SRV_mem_mb:-?} MB RAM · ${SRV_disk_gb:-?} GB libres"
  [[ "${SRV_docker:-no}" == "no" ]] && info "Docker: no instalado (lo instalará el instalador)" || ok "Docker: ${SRV_docker}"
  if [[ "${SRV_app:-no}" == "si" ]]; then
    warn "Ya existe $REMOTE_DIR en el servidor: se actualizará el código, conservando secretos y datos."
  fi
  [[ "$SRV_mem_mb"  =~ ^[0-9]+$ ]] || SRV_mem_mb=0
  [[ "$SRV_disk_gb" =~ ^[0-9]+$ ]] || SRV_disk_gb=0
  (( SRV_mem_mb  >= 1800 )) || die "El servidor tiene muy poca RAM (${SRV_mem_mb} MB)"
  (( SRV_disk_gb >= 15 ))   || die "Faltan GB libres en / (${SRV_disk_gb} GB)"
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  printf '\n%sDiagnóstico terminado.%s No se modificó nada.\n' "$G" "$N"
  exit 0
fi

# ── 6. Usuario administrador ────────────────────────────────────────────────
step "Usuario administrador '$ADMIN_USER'"
ssh_key "set -e
  if id -u '$ADMIN_USER' >/dev/null 2>&1; then
    echo 'existe'
  else
    useradd -m -s /bin/bash '$ADMIN_USER'
    echo 'creado'
  fi
  # sudo en Debian, wheel en algunas variantes
  getent group sudo >/dev/null && usermod -aG sudo '$ADMIN_USER' || true
  mkdir -p /home/'$ADMIN_USER'/.ssh && chmod 700 /home/'$ADMIN_USER'/.ssh
  touch /home/'$ADMIN_USER'/.ssh/authorized_keys
  chmod 600 /home/'$ADMIN_USER'/.ssh/authorized_keys
  grep -qxF '$PUBKEY' /home/'$ADMIN_USER'/.ssh/authorized_keys || \
    echo '$PUBKEY' >> /home/'$ADMIN_USER'/.ssh/authorized_keys
  chown -R '$ADMIN_USER':'$ADMIN_USER' /home/'$ADMIN_USER'/.ssh" >/dev/null 2>"$ERR_TMP" \
  || { sed 's/^/    /' "$ERR_TMP" >&2; die "No se pudo crear/configurar el usuario '$ADMIN_USER'"; }
# La contraseña viaja por stdin dentro del canal cifrado: nunca por argv.
printf '%s:%s\n' "$ADMIN_USER" "$ADMIN_PASS" | ssh_key 'chpasswd' 2>"$ERR_TMP" \
  || { sed 's/^/    /' "$ERR_TMP" >&2; die "No se pudo asignar la contraseña de '$ADMIN_USER'"; }
ok "Usuario '$ADMIN_USER' listo, con sudo y tu llave SSH"

# ── 7. Copia del código ─────────────────────────────────────────────────────
step "Copia del código a $REMOTE_DIR"
ssh_key "mkdir -p '$REMOTE_DIR'"
# --delete mantiene el servidor idéntico al repo local, pero NUNCA borra lo que
# genera el instalador allí (secretos, certificados, configuración).
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]} -p $SSH_PORT -i $SSH_KEY" \
  --exclude 'node_modules' --exclude '.next' --exclude 'dist' --exclude '.turbo' \
  --exclude 'coverage' --exclude '*.log' --exclude '.DS_Store' --exclude '.git' \
  --exclude '.env' --exclude '.env.production' \
  --exclude 'deploy/secrets' --exclude 'deploy/install.conf' --exclude 'deploy/Caddyfile' \
  "$SRC_DIR/" "root@$VPS_IP:$REMOTE_DIR/"
ok "Código sincronizado ($(du -sh "$SRC_DIR" 2>/dev/null | cut -f1) en origen)"

if [[ -n "$GOOGLE_CREDS" ]]; then
  [[ -f "$GOOGLE_CREDS" ]] || die "No existe $GOOGLE_CREDS"
  ssh_key "mkdir -p '$REMOTE_DIR/deploy/secrets' && chmod 700 '$REMOTE_DIR/deploy/secrets'"
  scp "${SSH_OPTS[@]}" -P "$SSH_PORT" -i "$SSH_KEY" -q \
    "$GOOGLE_CREDS" "root@$VPS_IP:$REMOTE_DIR/deploy/secrets/google-credentials.json"
  ssh_key "chmod 600 '$REMOTE_DIR/deploy/secrets/google-credentials.json'"
  ok "Credenciales de Google Cloud copiadas"
fi

# ── 8. Instalación en el servidor ───────────────────────────────────────────
step "Instalación en el servidor (esto tarda entre 5 y 20 minutos)"
INSTALL_ARGS=(-y --dir "$REMOTE_DIR")
case "$DOMAIN_MODE" in
  single) INSTALL_ARGS+=(--single-domain "$SINGLE_DOMAIN" --email "$ACME_EMAIL") ;;
  dual)   INSTALL_ARGS+=(--domain-web "$DOMAIN_WEB" --domain-api "$DOMAIN_API" --email "$ACME_EMAIL") ;;
  http)   INSTALL_ARGS+=(--http-only) ;;
esac
[[ $SKIP_DNS -eq 1 ]] && INSTALL_ARGS+=(--skip-dns-check)

printf -v REMOTE_CMD '%q ' bash "$REMOTE_DIR/deploy/install-vps.sh" "${INSTALL_ARGS[@]}"
info "Ejecutando: $REMOTE_CMD"
log ""
INSTALL_RC=0
ssh_key_tty "$REMOTE_CMD" || INSTALL_RC=$?

# ── 9. Cierre ───────────────────────────────────────────────────────────────
step "Ajustes finales de acceso"
# Se comprueba que el usuario nuevo entra con llave ANTES de cerrar nada.
if ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" -i "$SSH_KEY" -o BatchMode=yes \
     "$ADMIN_USER@$VPS_IP" true 2>/dev/null; then
  ok "Acceso por llave verificado para '$ADMIN_USER'"
  ssh_key "getent group docker >/dev/null && usermod -aG docker '$ADMIN_USER' && echo ok" >/dev/null 2>&1 \
    && ok "'$ADMIN_USER' agregado al grupo docker (puede usar 'agenia' sin sudo)" \
    || info "Grupo docker aún no existe; ejecuta luego: usermod -aG docker $ADMIN_USER"
  ADMIN_OK=1
else
  warn "'$ADMIN_USER' todavía no entra por llave; NO se tocará la configuración de SSH."
  ADMIN_OK=0
fi

if [[ "$ADMIN_OK" == "1" ]]; then
  if [[ -z "$HARDEN" ]]; then
    log ""
    log "  ${BOLD}Endurecer SSH${N}: desactivar el acceso por contraseña (solo llave)."
    log "  ${D}Tu llave ya funciona para root y para $ADMIN_USER. Recomendado.${N}"
    confirm "¿Desactivar el login SSH por contraseña?" && HARDEN=1 || HARDEN=0
  fi
  if [[ "$HARDEN" == "1" ]]; then
    # El archivo va con prefijo 00- a propósito. Los .conf de
    # /etc/ssh/sshd_config.d se leen en orden alfabético y en OpenSSH GANA EL
    # PRIMER valor leído, no el último. Las imágenes de nube traen un
    # 50-cloud-init.conf con "PasswordAuthentication yes" que, con un 99-,
    # ganaba y dejaba el endurecimiento sin efecto — en silencio.
    ssh_key "install -d /etc/ssh/sshd_config.d && \
      rm -f /etc/ssh/sshd_config.d/99-agenia.conf && \
      printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' \
        > /etc/ssh/sshd_config.d/00-agenia.conf && \
      (sshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null))"

    # Se comprueba la configuración EFECTIVA, no lo que se escribió: escribir
    # un archivo no garantiza que ese valor sea el que sshd aplica.
    EFF="$(ssh_key "sshd -T 2>/dev/null | grep -E '^(passwordauthentication|permitrootlogin)'" || true)"
    if grep -q '^passwordauthentication no' <<<"$EFF"; then
      ok "SSH por contraseña desactivado y verificado con sshd -T"
    else
      warn "El archivo se escribió pero sshd sigue aceptando contraseña:"
      printf '%s\n' "$EFF" | sed 's/^/      /'
      warn "Revisa qué otro archivo de /etc/ssh/sshd_config.d lo está fijando antes."
    fi
  else
    info "SSH sin cambios (sigue aceptando contraseña)"
  fi
fi

# ── Resumen ─────────────────────────────────────────────────────────────────
case "$DOMAIN_MODE" in
  single) WEB_URL="https://$SINGLE_DOMAIN"; API_URL="https://$SINGLE_DOMAIN/api" ;;
  dual)   WEB_URL="https://$DOMAIN_WEB";    API_URL="https://$DOMAIN_API" ;;
  http)   WEB_URL="http://$VPS_IP";         API_URL="http://$VPS_IP/api" ;;
esac

cat <<EOF

${G}${BOLD}══════════════════════════════════════════════════════════════════${N}
${G}${BOLD}  $( [[ $INSTALL_RC -eq 0 ]] && echo 'Despliegue remoto completado' || echo 'Despliegue terminado CON INCIDENCIAS' )${N}
${G}${BOLD}══════════════════════════════════════════════════════════════════${N}

  ${BOLD}Acceso al sistema${N}
    Panel ............ ${WEB_URL}
    Login ............ ${WEB_URL}/login
    Webhook de Meta .. ${API_URL}/chatbot/webhook

  ${BOLD}Acceso al servidor${N}
    ssh -i ${SSH_KEY} ${ADMIN_USER}@${VPS_IP}
    ssh -i ${SSH_KEY} root@${VPS_IP}          ${D}(administración)${N}

  ${BOLD}Operación${N}  ${D}(dentro del servidor)${N}
    agenia status      agenia logs api -f      agenia update
    agenia backup      sudo bash ${REMOTE_DIR}/deploy/stop-all.sh
                       sudo bash ${REMOTE_DIR}/deploy/start-all.sh

  ${BOLD}Primer ingreso al panel${N}
    superadmin@sanvicente.com / admin123  ${R}← cámbiala de inmediato${N}
EOF

if [[ $INSTALL_RC -ne 0 ]]; then
  warn "El instalador remoto terminó con código $INSTALL_RC. Revisa arriba y, en el servidor:"
  warn "  ssh -i $SSH_KEY root@$VPS_IP 'agenia verify'   ·   tail -100 /var/log/agenia-install.log"
  exit $INSTALL_RC
fi
exit 0

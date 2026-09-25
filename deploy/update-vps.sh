#!/usr/bin/env bash
# =============================================================================
#  AgenIA — actualización de rutina de un VPS (web + api), en un solo comando
# =============================================================================
#
#  Se ejecuta EN TU COMPUTADOR, no en el servidor. Encadena exactamente los
#  mismos cuatro pasos que ya se documentaban a mano en
#  docs/drivers/cnt-sanvicente-anserma/COMPILAR_Y_ACTUALIZAR.md §3.1-§3.6:
#
#    1. rsync del código al VPS (mismas exclusiones que el instalador: nunca
#       toca secretos, certificados ni el Caddyfile ya ajustado a mano).
#    2. `agenia build api web`  — reconstruye los dos contenedores.
#    3. `agenia migrate`        — aplica migraciones Prisma pendientes
#                                  (no-op seguro si no hay ninguna).
#    4. `agenia verify`         — batería de comprobaciones post-arranque.
#    5. `docker builder prune`  — borra la caché de construcción de más de
#                                  72 h. Solo esa caché: nunca contenedores,
#                                  imágenes en uso ni volúmenes (la base).
#
#  NO reemplaza `agenia update`: ese comando ya hace lo mismo pero corre EN
#  el servidor y necesita `git pull`, así que solo sirve si el VPS tiene un
#  repositorio git de verdad. Los VPS de cliente de este repo reciben el
#  código por rsync (sin `.git`, a propósito: el remote del repo lleva un
#  token embebido) — para esos, este script es el equivalente desde afuera.
#
#  NO toca `mirror-agent`: ese servicio corre en la red del hospital, no en
#  este VPS, y su actualización es un proceso aparte (compilar el bundle +
#  copiarlo por SSH/AnyDesk + `actualizarAgente.sh`) — ver §4 del mismo
#  manual. Mezclar los dos aquí daría una falsa sensación de "todo
#  actualizado" cuando el agente seguiría en la versión vieja.
#
#  USO
#    bash deploy/update-vps.sh --host <ip>
#    bash deploy/update-vps.sh --host <ip> --ssh-key ~/.ssh/mi_llave
#    bash deploy/update-vps.sh --host <ip> --dry-run     # solo muestra el rsync
#    bash deploy/update-vps.sh --host <ip> --skip-migrate # build+verify, sin migrar
#    bash deploy/update-vps.sh --host <ip> --skip-prune   # sin limpiar la caché
#
#  Requiere: haber corrido el instalador (deploy/remote-install.sh) antes, y
#  tener acceso SSH con la llave dedicada que ese instalador crea.
# =============================================================================
set -Eeuo pipefail

if [[ -t 1 ]]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; B=$'\033[1;34m'
  C=$'\033[0;36m'; D=$'\033[2m'; BOLD=$'\033[1m'; N=$'\033[0m'
else R=''; G=''; Y=''; B=''; C=''; D=''; BOLD=''; N=''; fi
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
info() { printf '  %s·%s %s\n' "$C" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail() { printf '  %s✘%s %s\n' "$R" "$N" "$*" >&2; }
head1(){ printf '\n%s── %s%s\n' "$B" "$*" "$N"; }
die()  { fail "$*"; exit 1; }
on_err() { fail "Error (código $1) en la línea $2: $3"; }
trap 'on_err "$?" "$LINENO" "$BASH_COMMAND"' ERR

VPS_IP=""; SSH_KEY=""; SSH_PORT="22"; REMOTE_DIR="/opt/agenia"; REMOTE_USER="root"
DRY_RUN=0; SKIP_MIGRATE=0; SKIP_VERIFY=0

SKIP_PRUNE=0

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)          VPS_IP="${2:?}"; shift ;;
    --ssh-key)       SSH_KEY="${2:?}"; shift ;;
    --ssh-port)      SSH_PORT="${2:?}"; shift ;;
    --remote-dir)    REMOTE_DIR="${2:?}"; shift ;;
    --remote-user)   REMOTE_USER="${2:?}"; shift ;;
    --dry-run)       DRY_RUN=1 ;;
    --skip-migrate)  SKIP_MIGRATE=1 ;;
    --skip-verify)   SKIP_VERIFY=1 ;;
    --skip-prune)    SKIP_PRUNE=1 ;;
    -h|--help)       usage; exit 0 ;;
    *) die "Opción desconocida: $1 (usa --help)" ;;
  esac
  shift
done

[[ -n "$VPS_IP" ]] || die "Falta --host <ip>. Usa --help para ver las opciones."

# Mismo criterio de derivación que remote-install.sh: si no se pasa una llave
# explícita, se asume la dedicada que crea el instalador.
[[ -n "$SSH_KEY" ]] || SSH_KEY="$HOME/.ssh/agenia_${VPS_IP//[.:]/_}_ed25519"
[[ -f "$SSH_KEY" ]] || die "No existe la llave SSH: $SSH_KEY (pasa --ssh-key <ruta> si usas otra)."

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

printf '%s%s AgenIA — actualización de %s %s\n' "$B" "$BOLD" "$VPS_IP" "$N"
info "Llave SSH: $SSH_KEY"
info "Directorio remoto: $REMOTE_DIR"
[[ $DRY_RUN -eq 1 ]] && warn "--dry-run: no se ejecuta nada remoto, solo se simula el rsync."

ssh_remote() {
  ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=10 \
    "${REMOTE_USER}@${VPS_IP}" "$@"
}

# ── 1. Sincronizar código ───────────────────────────────────────────────────
# Mismas exclusiones que usa el instalador (remote-install.sh / install-vps.sh):
# nunca se tocan secretos, certificados ni el Caddyfile ya ajustado a mano en
# el servidor.
head1 "1/4 · Sincronizando código"
RSYNC_ARGS=(-az --delete
  --exclude 'node_modules' --exclude '.next' --exclude 'dist' --exclude '.turbo'
  --exclude 'coverage' --exclude '*.log' --exclude '.DS_Store' --exclude '.git'
  --exclude '.env' --exclude '.env.production'
  --exclude 'deploy/secrets' --exclude 'deploy/install.conf' --exclude 'deploy/Caddyfile'
)
[[ $DRY_RUN -eq 1 ]] && RSYNC_ARGS+=(--dry-run -v)
rsync "${RSYNC_ARGS[@]}" \
  -e "ssh -i $SSH_KEY -p $SSH_PORT -o BatchMode=yes -o ConnectTimeout=10" \
  "$ROOT/" "${REMOTE_USER}@${VPS_IP}:${REMOTE_DIR}/"
ok "Código sincronizado"

if [[ $DRY_RUN -eq 1 ]]; then
  warn "--dry-run: fin. No se corrió build, migrate ni verify."
  exit 0
fi

# ── 2. Reconstruir web + api ────────────────────────────────────────────────
head1 "2/4 · Reconstruyendo api y web"
ssh_remote "agenia build api web"
ok "Contenedores reconstruidos"

# ── 3. Migrar base de datos ─────────────────────────────────────────────────
if [[ $SKIP_MIGRATE -eq 1 ]]; then
  warn "3/4 · --skip-migrate: se omite (agenia migrate es seguro de correr después a mano)."
else
  head1 "3/4 · Migrando base de datos"
  ssh_remote "agenia migrate"
  ok "Migraciones al día"
fi

# ── 4. Verificar ─────────────────────────────────────────────────────────────
if [[ $SKIP_VERIFY -eq 1 ]]; then
  warn "4/4 · --skip-verify: se omite."
else
  head1 "4/4 · Verificando"
  ssh_remote "agenia verify"
fi

# ── 5. Limpiar caché de construcción ────────────────────────────────────────
# Cada `agenia build` deja capas de caché que nadie borra: el 2026-09-25 eran
# 65 GB de un disco de 96 GB. Se conserva lo de las últimas 72 h para que el
# próximo build siga siendo rápido. La salida se reduce a la línea del total:
# la lista completa de capas borradas tardó tanto en imprimirse por SSH que
# cortó la sesión. Si falla, el despliegue ya está hecho: solo se avisa.
if [[ $SKIP_PRUNE -eq 1 ]]; then
  warn "Limpieza: --skip-prune, se omite."
else
  head1 "Limpiando caché de construcción (> 72 h)"
  if liberado=$(ssh_remote "docker builder prune -f --filter until=72h 2>&1 | tail -n 1"); then
    ok "${liberado:-Sin caché vieja que borrar}"
  else
    warn "No se pudo limpiar la caché (el despliegue sí quedó hecho). Manual: docker builder prune -f --filter until=72h"
  fi
fi

cat <<EOF

${BOLD}Listo.${N} web + api están al día en $VPS_IP.

Esto NO tocó mirror-agent (corre en la red del hospital, no aquí):
  ${D}· Si el cambio afectó rutas /api/mirror/*, conviene confirmar que el${N}
    ${D}  agente se recuperó del corte del contenedor — entra al VPS del${N}
    ${D}  hospital y revisa el journal (COMPILAR_Y_ACTUALIZAR.md §3.6a).${N}
  ${D}· Si el CÓDIGO del agente cambió, hay que compilar y desplegar el${N}
    ${D}  bundle nuevo aparte — ver §4 del mismo manual (o${N}
    ${D}  actualizarAgente.sh una vez copiado el bundle al VPS del hospital).${N}
EOF

#!/usr/bin/env bash
# =============================================================================
# rotarClaveHIS.sh — rota la contraseña de `agenia_sync` en el SQL Server del
# hospital y la resincroniza en la nube (HospitalMirrorConfig), en un solo
# comando en vez de los ocho pasos manuales que tomó la primera vez (incidente
# 2026-09-10: ver COMPILAR_Y_ACTUALIZAR.md §5).
#
# QUÉ HACE (☁️ nube + 💻 tu portátil):
#   1. Verifica/repara/abre el túnel SSH hacia el Postgres de producción
#      (puerto remoto leído de .env.production — nunca asumido a ciegas).
#   2. Lee POSTGRES_USER/PASSWORD/DB y ENCRYPTION_KEY del propio VPS.
#   3. Genera una contraseña nueva (solo alfanumérica: nada que rompa el
#      `ALTER LOGIN ... = '...'` de SQL Server ni el shell).
#   4. Te muestra el `ALTER LOGIN` exacto para pegar en SSMS y ESPERA tu
#      confirmación — este paso es manual a propósito: la nube no tiene
#      ninguna ruta hacia 192.168.1.16 (ver CONECTIVIDAD.md), así que ningún
#      script puede automatizarlo desde aquí.
#   5. Corre `provision-mirror-config.ts` con la contraseña nueva.
#   6. Te muestra el token nuevo y el bloque exacto para pegar en el
#      `agent.env` del VPS del hospital — también manual, mismo motivo.
#   7. Cierra el túnel si lo abrió este script (deja intacto uno que ya
#      existiera de antes, por si lo estabas usando para otra cosa).
#
# QUÉ NO HACE: no toca el SQL Server del hospital, no entra al VPS del
# hospital, no reinicia el agente. Esos tres pasos siguen siendo manuales
# porque la arquitectura del espejo es de salida únicamente — ni la nube ni
# tu portátil (a menos que estés en la LAN del hospital) tienen ruta hacia
# 192.168.1.16 ni 192.168.1.175.
#
# USO
#   ./rotarClaveHIS.sh
#   ORGANIZATION_ID=<otro-id> ./rotarClaveHIS.sh    # para otro hospital/org
#
# Variables de entorno (todas opcionales, con default para este hospital):
#   MIRROR_SSH_KEY, MIRROR_VPS_IP, MIRROR_REMOTE_DIR, ORGANIZATION_ID,
#   MIRROR_HIS_TARGET, TUNNEL_LOCAL_PORT, PASSWORD_LENGTH
#
# Requiere en tu portátil: ssh, openssl, lsof, pnpm.
# =============================================================================
set -Eeuo pipefail

# ── Config (overrideable por variable de entorno) ────────────────────────────
SSH_KEY="${MIRROR_SSH_KEY:-$HOME/.ssh/agenia_89_117_61_28_ed25519}"
VPS_IP="${MIRROR_VPS_IP:-89.117.61.28}"
REMOTE_DIR="${MIRROR_REMOTE_DIR:-/opt/agenia}"
ORGANIZATION_ID="${ORGANIZATION_ID:-97f18182-d0d9-4a3b-9eb6-4fbc031b917c}"
MIRROR_HIS_TARGET="${MIRROR_HIS_TARGET:-hospital}"
TUNNEL_LOCAL_PORT="${TUNNEL_LOCAL_PORT:-15432}"
PASSWORD_LENGTH="${PASSWORD_LENGTH:-24}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [[ -t 1 ]]; then
  G=$'\033[0;32m'; Y=$'\033[0;33m'; R=$'\033[0;31m'; B=$'\033[1;34m'; N=$'\033[0m'
else G=''; Y=''; R=''; B=''; N=''; fi
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
err()  { printf '  %s✘%s %s\n' "$R" "$N" "$*" >&2; }
head1(){ printf '\n%s── %s%s\n' "$B" "$*" "$N"; }
die()  { err "$*"; exit 1; }

[[ -f "$SSH_KEY" ]] || die "No existe la llave SSH: $SSH_KEY"
[[ -d "$REPO_ROOT/packages/database" ]] || die "No encuentro packages/database desde $SCRIPT_DIR — ¿se movió este script?"
for bin in ssh openssl lsof pnpm; do
  command -v "$bin" >/dev/null 2>&1 || die "Falta '$bin' en este portátil."
done

ssh_cloud() { ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "root@$VPS_IP" "$@"; }

# ── 1) Datos del VPS de la nube — leídos en vivo, nunca hardcodeados ─────────
head1 "1) Leyendo configuración del VPS de la nube ($VPS_IP)"
ENV_RAW="$(ssh_cloud "grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|ENCRYPTION_KEY|DB_HOST_PORT)=' '$REMOTE_DIR/.env.production'")" \
  || die "No pude leer $REMOTE_DIR/.env.production en $VPS_IP (¿la llave SSH o la IP cambiaron?)"
# Se lee clave por clave, como datos — nunca con eval (mismo criterio que
# deploy/remote-install.sh: evaluar la salida de una máquina remota es una
# vía de inyección gratuita).
envval() { printf '%s\n' "$ENV_RAW" | sed -n "s/^$1=//p" | head -1; }
POSTGRES_USER="$(envval POSTGRES_USER)"
POSTGRES_PASSWORD="$(envval POSTGRES_PASSWORD)"
POSTGRES_DB="$(envval POSTGRES_DB)"
ENCRYPTION_KEY="$(envval ENCRYPTION_KEY)"
DB_HOST_PORT="$(envval DB_HOST_PORT)"
[[ -n "$POSTGRES_PASSWORD" && -n "$ENCRYPTION_KEY" && -n "$DB_HOST_PORT" ]] \
  || die "Faltó alguna variable en .env.production — revisa el archivo a mano."
ok "Postgres: usuario=$POSTGRES_USER  db=$POSTGRES_DB  puerto remoto=$DB_HOST_PORT"
ok "ENCRYPTION_KEY leída (${#ENCRYPTION_KEY} caracteres)"

# ── 2) Túnel SSH ──────────────────────────────────────────────────────────────
# No se valida con una prueba de conexión de socket: con `ssh -L`, el
# listener LOCAL acepta la conexión de inmediato aunque el canal SSH de
# verdad ya esté muerto río arriba (un túnel "zombie" no se distingue de uno
# sano con `nc -z` — pasó exactamente eso el 2026-09-10, ver
# INSTALACION_AGENTE_VPS.md "🧟 El túnel se muere solo, y no siempre avisa").
# La única prueba honesta es el intento real: por eso el reintento vive en
# `con_reintento_de_tunel`, envolviendo la llamada real a
# `provision-mirror-config.ts` en el paso 5.
head1 "2) Túnel SSH hacia Postgres de producción (127.0.0.1:$TUNNEL_LOCAL_PORT)"
OPENED_TUNNEL=0
tunnel_pids() { lsof -t -i ":${TUNNEL_LOCAL_PORT}" 2>/dev/null || true; }
abrir_tunel() {
  ssh -i "$SSH_KEY" -f -N -L "${TUNNEL_LOCAL_PORT}:127.0.0.1:${DB_HOST_PORT}" "root@$VPS_IP"
  OPENED_TUNNEL=1
  sleep 1
}
reabrir_tunel() {
  local pids; pids="$(tunnel_pids)"
  [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
  sleep 1
  abrir_tunel
}

if [[ -n "$(tunnel_pids)" ]]; then
  ok "Ya hay algo escuchando en $TUNNEL_LOCAL_PORT — lo uso (se confirma con el primer intento real, no antes)"
else
  abrir_tunel
  ok "Túnel abierto"
fi

cleanup() {
  if [[ "$OPENED_TUNNEL" == "1" ]]; then
    pids="$(tunnel_pids)"; [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
    ok "Túnel cerrado (lo había abierto este script)"
  fi
}
trap cleanup EXIT

DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${TUNNEL_LOCAL_PORT}/${POSTGRES_DB}?schema=public"

# Corre un comando; si Prisma dice que no alcanza Postgres, casi siempre es
# el túnel zombie de arriba — se repara y se reintenta UNA vez antes de
# rendirse, en vez de fallar con un error que ya se conoce de memoria.
con_reintento_de_tunel() {
  local out
  if out="$("$@" 2>&1)"; then printf '%s\n' "$out"; return 0; fi
  if grep -qi "Can't reach database server" <<<"$out"; then
    warn "Postgres no respondió por el túnel (túnel zombie) — lo reabro y reintento una vez." >&2
    reabrir_tunel
    if out="$("$@" 2>&1)"; then printf '%s\n' "$out"; return 0; fi
  fi
  printf '%s\n' "$out" >&2
  return 1
}

# ── 3) Contraseña nueva ──────────────────────────────────────────────────────
head1 "3) Generando contraseña nueva para agenia_sync"
NEW_PW="$(openssl rand -base64 $((PASSWORD_LENGTH * 2)) | tr -dc 'A-Za-z0-9' | head -c "$PASSWORD_LENGTH")"
[[ ${#NEW_PW} -eq "$PASSWORD_LENGTH" ]] || die "No se pudo generar la contraseña (¿openssl/tr fallaron?)"
ok "Generada (solo letras y dígitos — segura para el ALTER LOGIN y para el shell, sin comillas ni símbolos que escapar)"

# ── 4) Paso manual e inevitable: el SQL Server del hospital ─────────────────
head1 "4) Acción manual en el SQL Server del hospital (🏥 por SSMS/AnyDesk)"
cat <<EOF

  Este script NO puede llegar a 192.168.1.16 — por diseño, la nube no tiene
  ruta hacia el HIS del hospital (CONECTIVIDAD.md). Pega esto en SSMS, en la
  MISMA pestaña donde ya tienes la sesión de administrador — no abras una
  conexión nueva, no hace falta y arriesga esa sesión prestada:

  ${B}ALTER LOGIN agenia_sync WITH PASSWORD = '${NEW_PW}';${N}

EOF
read -r -p "  Presiona Enter cuando ya lo hayas ejecutado y haya dado 'completado correctamente'... "

# ── 5) Resincronizar en la nube ──────────────────────────────────────────────
head1 "5) Provisionando en la nube (HospitalMirrorConfig)"
cd "$REPO_ROOT"
if ! TOKEN_OUTPUT="$(con_reintento_de_tunel env DATABASE_URL="$DATABASE_URL" ENCRYPTION_KEY="$ENCRYPTION_KEY" \
      MIRROR_HIS_TARGET="$MIRROR_HIS_TARGET" AGENIA_SYNC_PASSWORD="$NEW_PW" \
      pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts "$ORGANIZATION_ID")"; then
  die "provision-mirror-config.ts falló — revisa el error impreso arriba."
fi
printf '%s\n' "$TOKEN_OUTPUT" | sed 's/^/  /'

NEW_TOKEN="$(printf '%s\n' "$TOKEN_OUTPUT" | grep -E '^mirror_' | head -1)"
[[ -n "$NEW_TOKEN" ]] || die "No pude extraer el token de la salida de arriba — revísala a mano."

# ── 6) Lo que falta hacer en el VPS del hospital ────────────────────────────
head1 "6) Acción manual en el VPS del hospital (🏥 por AnyDesk → Windows → SSH)"
cat <<EOF

  Pega esto en /etc/agenia-mirror-agent/agent.env, reemplazando la línea
  MIRROR_AGENT_TOKEN= existente (sin espacios ni '#' al final de la línea):

  ${B}MIRROR_AGENT_TOKEN=${NEW_TOKEN}${N}

  Y luego:
    sudo systemctl restart agenia-mirror-agent
    journalctl -u agenia-mirror-agent -f

  Debe verse "handshake OK, entrando al loop de sync." — sin eso, sigue
  igual y hay que revisar de nuevo (RUNBOOK.md / INSTALACION_AGENTE_VPS.md §9).

EOF

ok "Listo — la contraseña quedó igual en el SQL Server y en la nube."

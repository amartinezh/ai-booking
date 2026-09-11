#!/usr/bin/env bash
# =============================================================================
# homologarCatalogo.sh — corre `scripts/homologar.ts` en dos pasos seguros:
# primero SIEMPRE en seco (muestra el plan completo, no escribe nada), y solo
# aplica si escribes la palabra de confirmación exacta.
#
# Sin homologar, ningún médico/servicio del HIS queda mapeado a AgenIA y —lo
# más traicionero— con el espejo encendido el chatbot deja de ofrecer citas a
# TODO el mundo sin un solo error en el log (ver
# INSTALACION_AGENTE_VPS.md §10, y homologar.ts mismo).
#
# QUÉ HACE (💻, corre desde tu portátil):
#   1. Verifica/repara/abre el túnel SSH hacia el Postgres de producción
#      (mismo mecanismo que rotarClaveHIS.sh — puerto remoto leído en vivo).
#   2. Corre `homologar.ts` SIN --aplicar: solo calcula y muestra el plan.
#   3. Si el plan sale vacío ("No hay catálogo todavía"), NO pregunta nada —
#      esa frase casi siempre significa que DATABASE_URL apunta a la base
#      equivocada, no que falte esperar (trampa documentada en
#      INSTALACION_AGENTE_VPS.md §10).
#   4. Te muestra el plan completo (y lo guarda en un archivo) y ESPERA que
#      escribas HOMOLOGAR, exacto, para aplicar. Cualquier otra cosa cancela
#      sin escribir nada.
#   5. Si confirmas, corre `homologar.ts --aplicar` de verdad.
#   6. Cierra el túnel si lo abrió este script.
#
# QUÉ NO HACE: no toca EPS piloto (scripts/provision-eps-piloto.ts es un paso
# aparte), no revierte nada si `--aplicar` falla a medias (ese script escribe
# fila por fila, SIN transacción, por diseño de homologar.ts — ver el aviso
# que imprime este script si eso pasa).
#
# USO
#   ./homologarCatalogo.sh
#   ORGANIZATION_ID=<otro-id> ./homologarCatalogo.sh
# =============================================================================
set -Eeuo pipefail

SSH_KEY="${MIRROR_SSH_KEY:-$HOME/.ssh/agenia_89_117_61_28_ed25519}"
VPS_IP="${MIRROR_VPS_IP:-89.117.61.28}"
REMOTE_DIR="${MIRROR_REMOTE_DIR:-/opt/agenia}"
ORGANIZATION_ID="${ORGANIZATION_ID:-97f18182-d0d9-4a3b-9eb6-4fbc031b917c}"
TUNNEL_LOCAL_PORT="${TUNNEL_LOCAL_PORT:-15432}"
PLAN_FILE="homologar-plan-$(date +%Y%m%d-%H%M%S).txt"

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
for bin in ssh lsof pnpm; do
  command -v "$bin" >/dev/null 2>&1 || die "Falta '$bin' en este portátil."
done

ssh_cloud() { ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "root@$VPS_IP" "$@"; }

# ── 1) Datos de Postgres — leídos en vivo del VPS, nunca hardcodeados ────────
head1 "1) Leyendo configuración del VPS de la nube ($VPS_IP)"
ENV_RAW="$(ssh_cloud "grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|DB_HOST_PORT)=' '$REMOTE_DIR/.env.production'")" \
  || die "No pude leer $REMOTE_DIR/.env.production en $VPS_IP (¿la llave SSH o la IP cambiaron?)"
envval() { printf '%s\n' "$ENV_RAW" | sed -n "s/^$1=//p" | head -1; }
POSTGRES_USER="$(envval POSTGRES_USER)"
POSTGRES_PASSWORD="$(envval POSTGRES_PASSWORD)"
POSTGRES_DB="$(envval POSTGRES_DB)"
DB_HOST_PORT="$(envval DB_HOST_PORT)"
[[ -n "$POSTGRES_PASSWORD" && -n "$DB_HOST_PORT" ]] || die "Faltó alguna variable en .env.production — revisa el archivo a mano."
ok "Postgres: usuario=$POSTGRES_USER  db=$POSTGRES_DB  puerto remoto=$DB_HOST_PORT"

# ── 2) Túnel SSH ──────────────────────────────────────────────────────────────
# No se valida con una prueba de conexión de socket: con `ssh -L`, el
# listener LOCAL acepta la conexión de inmediato aunque el canal SSH de
# verdad ya esté muerto río arriba (un túnel "zombie" no se distingue de uno
# sano con `nc -z` — pasó exactamente eso el 2026-09-10, ver
# INSTALACION_AGENTE_VPS.md "🧟 El túnel se muere solo, y no siempre avisa").
# La única prueba honesta es el intento real: por eso el reintento vive en
# `con_reintento_de_tunel`, más abajo, envolviendo cada llamada real a
# `homologar.ts`.
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

# ── 3) Plan en seco — SIN --aplicar, no escribe nada ────────────────────────
head1 "3) Calculando el plan de homologación (sin aplicar todavía)"
cd "$REPO_ROOT"
if ! PLAN_OUTPUT="$(con_reintento_de_tunel env DATABASE_URL="$DATABASE_URL" \
      pnpm --filter @agenia/database exec tsx scripts/homologar.ts "$ORGANIZATION_ID")"; then
  die "homologar.ts falló calculando el plan — ver el error arriba."
fi
printf '%s\n' "$PLAN_OUTPUT" > "$PLAN_FILE"

if grep -qi "No hay catálogo todavía" <<<"$PLAN_OUTPUT"; then
  err "El plan salió vacío: \"No hay catálogo todavía\"."
  warn "Esto casi siempre NO significa 'espera un poco' — significa que DATABASE_URL"
  warn "está apuntando a la base equivocada. Revisa POSTGRES_DB/el túnel del paso 1-2,"
  warn "o si el organizationId ($ORGANIZATION_ID) es el correcto."
  die "Abortado antes de preguntar — no tiene sentido confirmar un plan vacío."
fi

head1 "4) Plan de homologación"
printf '%s\n' "$PLAN_OUTPUT"
ok "Plan completo guardado en: $PLAN_FILE"

# ── 5) Confirmación explícita — nada se escribe sin esto ────────────────────
head1 "5) ¿Aplicar este plan?"
cat <<EOF

  Esto va a CREAR médicos/servicios nuevos en AgenIA (con
  whatsappBookingEnabled=false — nadie se vuelve vendible por accidente) y a
  enlazar los que ya coinciden por cédula/nombre. Las filas marcadas REVISAR
  arriba NO se tocan — quedan para decidir a mano.

  Se escribe fila por fila, SIN transacción: si falla a medias, lo de antes
  del punto de falla queda escrito (es idempotente — puedes volver a correr
  este script después, y lo ya hecho no se duplica).

EOF
read -r -p "  Escribe HOMOLOGAR para aplicar, cualquier otra cosa cancela: " CONFIRM
if [[ "$CONFIRM" != "HOMOLOGAR" ]]; then
  warn "Cancelado — no se escribió nada. El plan queda en $PLAN_FILE por si lo necesitas después."
  exit 0
fi

# ── 6) Aplicar de verdad ──────────────────────────────────────────────────────
head1 "6) Aplicando"
if ! APPLY_OUTPUT="$(con_reintento_de_tunel env DATABASE_URL="$DATABASE_URL" \
    pnpm --filter @agenia/database exec tsx scripts/homologar.ts "$ORGANIZATION_ID" --aplicar)"; then
  printf '%s\n' "$APPLY_OUTPUT"
  err "homologar.ts --aplicar falló a medias."
  warn "Causa más común: schema desactualizado en producción (una columna que"
  warn "existe en tu schema.prisma local pero no en la nube). Arreglo aditivo y"
  warn "seguro, con el mismo túnel de este script:"
  warn "  DATABASE_URL=\"$DATABASE_URL\" pnpm --filter @agenia/database exec prisma db push"
  warn "Y vuelve a correr ESTE script — lo ya creado queda como YA (se detecta"
  warn "por MirrorEntityMap, no se duplica) y solo reintenta lo que faltaba."
  warn "Si el fallo dejó un User sin DoctorProfile (huérfano, inofensivo pero"
  warn "conviene limpiarlo), ver INSTALACION_AGENTE_VPS.md §10."
  die "Homologación incompleta."
fi

printf '%s\n' "$APPLY_OUTPUT"
ok "Homologación aplicada. Revisa arriba cuántos médicos/servicios se crearon."

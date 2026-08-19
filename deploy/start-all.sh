#!/usr/bin/env bash
# =============================================================================
#  AgenIA — arranque completo de los servicios
# =============================================================================
#
#  Levanta el stack en el orden correcto y no da por terminado hasta que cada
#  pieza responde de verdad: PostgreSQL y Redis sanos, la API escuchando, el
#  panel sirviendo y el proxy publicando.
#
#  USO
#    sudo bash deploy/start-all.sh              # arranca y verifica
#    sudo bash deploy/start-all.sh --migrate    # además aplica migraciones
#    sudo bash deploy/start-all.sh --no-verify  # arranca sin verificar
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

DO_MIGRATE=0; DO_VERIFY=1; WAIT_SECS=180
while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrate)   DO_MIGRATE=1 ;;
    --no-verify) DO_VERIFY=0 ;;
    --wait)      WAIT_SECS="${2:?}"; shift ;;
    -h|--help)   sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.deploy.yml"
ENV_FILE="$ROOT/.env.production"

printf '%s%s AgenIA — arranque de servicios %s\n' "$B" "$BOLD" "$N"

# ── Requisitos ──────────────────────────────────────────────────────────────
head1 "Comprobaciones previas"
[[ -f "$COMPOSE_FILE" ]] || die "No existe $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]]     || die "No existe $ENV_FILE — el sistema no está instalado (deploy/install-vps.sh)"
[[ -f "$ROOT/deploy/Caddyfile" ]] || die "Falta deploy/Caddyfile — vuelve a ejecutar el instalador"
ok "Configuración presente"

command -v docker >/dev/null 2>&1 || die "Docker no está instalado"
if ! docker info >/dev/null 2>&1; then
  info "El demonio de Docker está parado; arrancándolo…"
  systemctl start docker 2>/dev/null || die "No se pudo arrancar Docker (systemctl status docker)"
  for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  docker info >/dev/null 2>&1 || die "Docker no responde"
fi
ok "Demonio de Docker operativo"

set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# Las imágenes tienen que existir: si alguien limpió Docker, hay que reconstruir.
for img in agenia-api:latest agenia-web:latest; do
  docker image inspect "$img" >/dev/null 2>&1 \
    || die "Falta la imagen $img. Reconstruye con: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE build"
done
ok "Imágenes agenia-api y agenia-web presentes"

# ── Espera de salud ─────────────────────────────────────────────────────────
wait_healthy() {  # wait_healthy <servicio> <segundos>
  local svc="$1" limit="${2:-$WAIT_SECS}" cid st waited=0
  cid="$(dc ps -q "$svc" 2>/dev/null)"
  [[ -n "$cid" ]] || { fail "$svc no se creó"; return 1; }
  # Un contenedor sin healthcheck (caddy) solo puede comprobarse por su estado.
  if [[ "$(docker inspect -f '{{if .State.Health}}si{{end}}' "$cid")" != "si" ]]; then
    sleep 2
    [[ "$(docker inspect -f '{{.State.Status}}' "$cid")" == "running" ]] \
      && { ok "$svc en ejecución"; return 0; } || { fail "$svc no arrancó"; return 1; }
  fi
  while (( waited < limit )); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
    case "$st" in
      healthy) ok "$svc saludable ${D}(${waited}s)${N}"; return 0 ;;
      unhealthy)
        # Puede recuperarse dentro del plazo; solo se avisa.
        [[ $((waited % 30)) -eq 0 ]] && info "$svc aún no responde…" ;;
    esac
    if [[ "$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null)" == "exited" ]]; then
      fail "$svc se detuvo al arrancar:"; dc logs --tail 30 "$svc" || true; return 1
    fi
    sleep 3; waited=$((waited+3))
  done
  fail "$svc no llegó a estado saludable en ${limit}s"; dc logs --tail 30 "$svc" || true
  return 1
}

# ── Arranque por capas ──────────────────────────────────────────────────────
head1 "1. Datos (PostgreSQL y Redis)"
dc up -d postgres redis >/dev/null
wait_healthy postgres 120 || die "PostgreSQL no arrancó"
wait_healthy redis 60     || die "Redis no arrancó"

if [[ $DO_MIGRATE -eq 1 ]]; then
  head1 "2. Migraciones"
  if [[ -x "$ROOT/deploy/agenia.sh" ]]; then
    "$ROOT/deploy/agenia.sh" migrate
  else
    dc run --rm migrator
  fi
fi

head1 "$([[ $DO_MIGRATE -eq 1 ]] && echo 3 || echo 2). Aplicación (API y panel)"
dc up -d api web >/dev/null
wait_healthy api || die "La API no arrancó"
wait_healthy web || die "El panel no arrancó"

head1 "$([[ $DO_MIGRATE -eq 1 ]] && echo 4 || echo 3). Proxy y publicación"
dc up -d caddy >/dev/null
if ! wait_healthy caddy 30; then
  fail "Caddy no arrancó. Sus últimas líneas de log:"
  dc logs --tail 15 caddy 2>&1 | sed 's/^/    /' || true
  warn "Causa habitual: deploy/Caddyfile mal formado. Valídalo con:"
  warn "  docker run --rm -v $ROOT/deploy/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile"
fi

# ── Verificación ────────────────────────────────────────────────────────────
RC=0
if [[ $DO_VERIFY -eq 1 && -x "$ROOT/deploy/agenia.sh" ]]; then
  "$ROOT/deploy/agenia.sh" verify || RC=$?
else
  head1 "Estado"
  dc ps
fi

cat <<EOF

  ${BOLD}Accesos${N}
    Panel ....... ${PUBLIC_WEB_URL:-?}
    API ......... ${PUBLIC_API_URL:-?}

  ${D}Apagar todo:  sudo bash $ROOT/deploy/stop-all.sh${N}
EOF
exit $RC

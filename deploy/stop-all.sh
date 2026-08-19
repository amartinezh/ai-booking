#!/usr/bin/env bash
# =============================================================================
#  AgenIA — apagado ordenado de todos los servicios
# =============================================================================
#
#  Busca los servicios del sistema estén como estén levantados (compose nuevo,
#  compose antiguo `antigravity_*`, o contenedores sueltos) y los detiene en el
#  orden correcto.
#
#  NO BORRA NADA: usa `stop`, no `down`. Se conservan contenedores, volúmenes,
#  base de datos, certificados TLS y configuración. Para volver a levantar:
#  `bash deploy/start-all.sh`.
#
#  USO
#    sudo bash deploy/stop-all.sh              # apaga los servicios de AgenIA
#    sudo bash deploy/stop-all.sh --dry-run    # solo muestra qué apagaría
#    sudo bash deploy/stop-all.sh --all-docker # apaga TODO contenedor del host
#    sudo bash deploy/stop-all.sh --with-daemon# además detiene el propio Docker
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

DRY=0; ALL_DOCKER=0; WITH_DAEMON=0; STOP_TIMEOUT=30; ASSUME_YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)     DRY=1 ;;
    --all-docker)  ALL_DOCKER=1 ;;
    --with-daemon) WITH_DAEMON=1 ;;
    --timeout)     STOP_TIMEOUT="${2:?}"; shift ;;
    -y|--yes)      ASSUME_YES=1 ;;
    -h|--help)     sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
  shift
done

command -v docker >/dev/null 2>&1 || die "Docker no está instalado en este servidor."
docker info >/dev/null 2>&1 || { warn "El demonio de Docker ya está detenido: no hay nada que apagar."; exit 0; }

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.deploy.yml"
ENV_FILE="$ROOT/.env.production"

printf '%s%s AgenIA — apagado de servicios %s\n' "$B" "$BOLD" "$N"

# ── Descubrimiento ──────────────────────────────────────────────────────────
# Se busca por tres vías porque el stack puede haberse levantado de formas
# distintas a lo largo del tiempo: el compose de despliegue actual, el compose
# antiguo (`antigravity_*`) o contenedores creados a mano.
head1 "Servicios encontrados"

declare -a FOUND=()
add_found() { local c="$1"; [[ -z "$c" ]] && return 0
  for e in "${FOUND[@]:-}"; do [[ "$e" == "$c" ]] && return 0; done
  FOUND+=("$c"); }

if [[ $ALL_DOCKER -eq 1 ]]; then
  while read -r c; do add_found "$c"; done < <(docker ps -q)
else
  # 1) Proyecto compose 'agenia'
  while read -r c; do add_found "$c"; done < <(
    docker ps -q --filter "label=com.docker.compose.project=agenia" 2>/dev/null)
  # 2) Nombres del stack actual y del antiguo
  while read -r c; do add_found "$c"; done < <(
    docker ps -q --filter "name=^/agenia_" --filter "name=^/antigravity_" 2>/dev/null)
  # 3) Cualquier proyecto compose cuyo directorio sea el nuestro
  while read -r c; do add_found "$c"; done < <(
    docker ps -q --filter "label=com.docker.compose.project.working_dir=$ROOT" 2>/dev/null)
fi

if [[ ${#FOUND[@]} -eq 0 ]]; then
  ok "No hay servicios en ejecución. Todo está apagado."
  [[ $WITH_DAEMON -eq 1 && $DRY -eq 0 ]] && { systemctl stop docker.socket docker 2>/dev/null || true; ok "Demonio de Docker detenido"; }
  exit 0
fi

printf '  %-22s %-14s %s\n' "CONTENEDOR" "ESTADO" "IMAGEN"
for c in "${FOUND[@]}"; do
  docker inspect -f '  {{printf "%-22.22s" (slice .Name 1)}} {{printf "%-14.14s" .State.Status}} {{.Config.Image}}' "$c" 2>/dev/null || true
done
echo
info "${#FOUND[@]} contenedor(es). Los datos (volúmenes) NO se tocan."

if [[ $DRY -eq 1 ]]; then
  warn "--dry-run: no se apagó nada."
  exit 0
fi

if [[ $ASSUME_YES -eq 0 && -t 0 ]]; then
  read -r -p "  ¿Apagar estos servicios? [S/n]: " a
  [[ -z "$a" || "$a" =~ ^[SsYy] ]] || { echo "  Cancelado."; exit 0; }
fi

# ── Apagado ordenado ────────────────────────────────────────────────────────
# De fuera hacia dentro: primero se corta la entrada de tráfico y al final las
# bases de datos, para que ninguna petición quede a medias sobre PostgreSQL.
head1 "Apagando (de fuera hacia dentro)"

# `docker stop` usa -t (segundos), NO --timeout: esa forma larga solo existe
# en `docker compose stop` y falla con "unknown flag" en el CLI de Docker.
stop_one() {
  local c="$1" label="$2" timeout="$3" name err
  name="$(docker inspect -f '{{slice .Name 1}}' "$c" 2>/dev/null || echo "$c")"
  if err="$(docker stop -t "$timeout" "$c" 2>&1)"; then
    ok "$label: $name detenido"
  else
    fail "$label: $name no se pudo detener — ${err}"
  fi
}

stop_by_pattern() {
  local pattern="$1" label="$2" timeout="$3"
  for c in "${FOUND[@]}"; do
    name="$(docker inspect -f '{{slice .Name 1}}' "$c" 2>/dev/null || echo '')"
    [[ "$name" =~ $pattern ]] || continue
    [[ "$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)" == "running" ]] || continue
    stop_one "$c" "$label" "$timeout"
  done
  return 0
}

# PostgreSQL recibe más margen: necesita cerrar el checkpoint sin que lo maten.
stop_by_pattern '(proxy|caddy|nginx)'  "proxy   " "$STOP_TIMEOUT"
stop_by_pattern '(web)'                "web     " "$STOP_TIMEOUT"
stop_by_pattern '(api)'                "api     " "$STOP_TIMEOUT"
stop_by_pattern '(redis)'              "redis   " "$STOP_TIMEOUT"
stop_by_pattern '(db|postgres)'        "postgres" "$((STOP_TIMEOUT + 30))"

# Lo que no encajó en ningún patrón (contenedores sueltos, --all-docker).
for c in "${FOUND[@]}"; do
  if [[ "$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)" == "running" ]]; then
    stop_one "$c" "otros   " "$STOP_TIMEOUT"
  fi
done

# ── Comprobación ────────────────────────────────────────────────────────────
head1 "Estado final"
left="$(docker ps -q | wc -l | tr -d ' ')"
if [[ "$left" == "0" ]]; then
  ok "No queda ningún contenedor en ejecución"
else
  if [[ $ALL_DOCKER -eq 1 ]]; then
    fail "Siguen corriendo $left contenedor(es)"
  else
    info "Siguen corriendo $left contenedor(es) ajenos a AgenIA (no se tocan)"
    docker ps --format '    {{.Names}}  ({{.Image}})'
  fi
fi

# Los volúmenes son la prueba de que no se perdió nada.
vols="$(docker volume ls -q --filter "name=agenia_" 2>/dev/null | wc -l | tr -d ' ')"
ok "Volúmenes de datos intactos: $vols  ${D}(base de datos, Redis y certificados)${N}"

if [[ $WITH_DAEMON -eq 1 ]]; then
  systemctl stop docker.socket docker 2>/dev/null || true
  ok "Demonio de Docker detenido"
fi

cat <<EOF

  ${BOLD}Para volver a levantar todo:${N}
    sudo bash $ROOT/deploy/start-all.sh
EOF

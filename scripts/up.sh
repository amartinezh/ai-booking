#!/usr/bin/env bash
# =============================================================================
# scripts/up.sh — Levanta el stack completo de AgenIA en local.
#
#   Infraestructura (Docker) : postgres 5432, redis 6379, [SQL Server mock 1433]
#   Paquetes  (pnpm/turbo)   : @agenia/database (prisma generate + tsc),
#                              @agenia/shared (tsc)
#   Servicios (background)   : api (NestJS, 3001), web (Next.js, 3000),
#                              [mirror-agent], [túnel ngrok]
#
# Todo lo que levanta queda anotado en .local/run/manifest.tsv (pids, puertos,
# contenedores, logs). scripts/down.sh lee ese manifiesto para bajarlo todo.
# Los procesos quedan en background: los logs van a .local/run/<servicio>.log.
#
# Uso:  ./scripts/up.sh [opciones]      ./scripts/up.sh --help
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_ROOT/.local/run"
MANIFEST="$RUN_DIR/manifest.tsv"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
PG_PORT="${PG_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
HIS_MOCK_PORT="${HIS_MOCK_PORT:-1433}"

# Servicios de docker-compose.yml que se consideran "infra base".
INFRA_SERVICES="postgres redis"

# --- flags -------------------------------------------------------------------
WITH_HIS_MOCK=0
WITH_MIRROR_AGENT=0
WITH_TUNNEL=0
DO_INSTALL=0
DO_BUILD=0
DO_DB_PUSH=0
DO_SEED=0
START_API=1
START_WEB=1
DO_RESTART=0

# --- salida ------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

step() { printf '\n%s▸ %s%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; printf '\n%sAbortado.%s Nada de lo ya levantado se bajó: usa ./scripts/down.sh si quieres limpiar.\n' "$C_RED" "$C_RESET" >&2; exit 1; }

usage() {
  cat <<'EOF'
up.sh — levanta el stack local de AgenIA (infra Docker + API + WEB).

Uso: ./scripts/up.sh [opciones]

Por defecto levanta: postgres, redis, la API (3001) y la WEB (3000), compilando
antes @agenia/database y @agenia/shared si están desactualizados.

Opciones:
  --fresh            pnpm install + rebuild de paquetes + prisma db push.
                     Úsalo tras cambiar packages/* o el schema de Prisma.
  --install          Fuerza `pnpm install --workspace-root`.
  --build            Fuerza rebuild de @agenia/database y @agenia/shared.
  --db-push          Aplica el schema de Prisma a la BD (prisma db push).
  --seed             Corre packages/database/scripts/seed.ts tras levantar la BD.
  --his-mock         Levanta también el SQL Server mock del HIS (puerto 1433).
                     Si AGENIA_SYNC_PASSWORD está en el entorno, corre además
                     local-his-mock/setup.ts para recrear PRUEBAS.
  --mirror-agent     Levanta apps/mirror-agent (requiere MIRROR_AGENT_TOKEN, o
                     un .local/mirror-agent.env con las vars del agente).
  --tunnel           Levanta el túnel ngrok hacia la API (scripts/whatsapp-tunnel.sh).
  --no-api           No levanta la API.
  --no-web           No levanta el frontend.
  --restart          Corre ./scripts/down.sh antes de levantar.
  -h, --help         Esta ayuda.

Variables de entorno reconocidas:
  API_PORT (3001), WEB_PORT (3000), PG_PORT (5432), REDIS_PORT (6379),
  HIS_MOCK_PORT (1433), AGENIA_SYNC_PASSWORD (seed del mock del HIS).

Estado y logs: .local/run/   ·   Para bajar todo: ./scripts/down.sh
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --fresh)        DO_INSTALL=1; DO_BUILD=1; DO_DB_PUSH=1 ;;
    --install)      DO_INSTALL=1 ;;
    --build)        DO_BUILD=1 ;;
    --db-push)      DO_DB_PUSH=1 ;;
    --seed)         DO_SEED=1 ;;
    --his-mock)     WITH_HIS_MOCK=1 ;;
    --mirror-agent) WITH_MIRROR_AGENT=1 ;;
    --tunnel)       WITH_TUNNEL=1 ;;
    --no-api)       START_API=0 ;;
    --no-web)       START_WEB=0 ;;
    --restart)      DO_RESTART=1 ;;
    -h|--help)      usage; exit 0 ;;
    *)              err "Opción desconocida: $1"; echo; usage; exit 2 ;;
  esac
  shift
done

# --- helpers -----------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

port_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }
port_busy() { [ -n "$(port_pid "$1")" ]; }

# Config normalizada de compose, cacheada: mapear servicio → container_name.
COMPOSE_CONFIG_CACHE=""
compose_config() {
  if [ -z "$COMPOSE_CONFIG_CACHE" ]; then
    COMPOSE_CONFIG_CACHE="$(docker compose -f "$COMPOSE_FILE" config 2>/dev/null)"
  fi
  printf '%s\n' "$COMPOSE_CONFIG_CACHE"
}

# docker-compose.yml fija `container_name:`, así que el nombre del contenedor es
# estable aunque el proyecto de compose cambie (este repo se llamó `antigravity`
# antes que `agen-ia`: los contenedores viejos siguen bajo el proyecto viejo y
# un `compose up` chocaría con "container name already in use"). Operar por
# nombre de contenedor esquiva ese conflicto.
container_name_for() {
  compose_config | awk -v svc="$1" '
    /^[a-zA-Z]/                       { insvc = ($1 == "services:"); next }
    insvc && /^  [a-zA-Z0-9_.-]+:$/   { cur = $1; sub(/:$/, "", cur) }
    insvc && cur == svc && $1 == "container_name:" { print $2; exit }
  '
}

container_state() { docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null; }

container_project() {
  docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$1" 2>/dev/null
}

# Manifiesto: kind<TAB>name<TAB>ref<TAB>port<TAB>log
manifest_init() {
  mkdir -p "$RUN_DIR"
  if [ ! -f "$MANIFEST" ]; then
    {
      echo "# Stack local de AgenIA — generado por scripts/up.sh. Lo consume scripts/down.sh."
      echo "# root=$REPO_ROOT"
      printf '# kind\tname\tref\tport\tlog\n'
    } > "$MANIFEST"
  fi
  printf '# up_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" >> "$MANIFEST"
}

manifest_set() {
  local kind="$1" name="$2" ref="$3" port="$4" log="$5"
  if [ -s "$MANIFEST" ]; then
    awk -F'\t' -v k="$kind" -v n="$name" '$1 != k || $2 != n' "$MANIFEST" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$kind" "$name" "$ref" "$port" "$log" >> "$MANIFEST"
}

proc_alive() {
  local pidfile="$RUN_DIR/$1.pid"
  [ -f "$pidfile" ] || return 1
  local pid; pid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

wait_for_tcp() {
  local host="$1" port="$2" timeout="${3:-60}" i=0
  while [ "$i" -lt "$timeout" ]; do
    if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then exec 3>&- 3<&-; return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

wait_for_http() {
  local url="$1" timeout="${2:-90}" i=0
  while [ "$i" -lt "$timeout" ]; do
    if curl -fsS -o /dev/null --max-time 3 "$url" 2>/dev/null; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

# Arranca un servicio en background, deja pid + log y lo anota en el manifiesto.
start_proc() {
  local name="$1" dir="$2" port="$3" cmd="$4"
  local log="$RUN_DIR/$name.log" pidfile="$RUN_DIR/$name.pid"

  if proc_alive "$name"; then
    ok "$name ya estaba corriendo (pid $(cat "$pidfile")) — no se relanza."
    return 0
  fi

  if [ -n "$port" ] && port_busy "$port"; then
    die "Puerto $port ocupado por el pid $(port_pid "$port"), que up.sh no levantó.
     Libéralo o corre: ./scripts/down.sh --all"
  fi

  : > "$log"
  ( cd "$dir" && exec nohup bash -c "$cmd" >>"$log" 2>&1 <&- ) &
  local pid=$!
  echo "$pid" > "$pidfile"
  manifest_set proc "$name" "$pid" "$port" "$log"
  ok "$name lanzado (pid $pid) → ${log#$REPO_ROOT/}"
}

# El proceso murió al arrancar: muestra la cola del log en vez de un timeout mudo.
tail_log_and_die() {
  local name="$1"
  local log="$RUN_DIR/$name.log"
  err "$name no respondió a tiempo. Últimas líneas de ${log#$REPO_ROOT/}:"
  echo "$C_DIM"; tail -n 25 "$log" 2>/dev/null | sed 's/^/    /'; echo "$C_RESET"
  die "Revisa el log completo: tail -f $log"
}

needs_pkg_build() {
  # Nota: `local a=$1 b=$a` no sirve — bash expande todas las palabras del
  # `local` antes de asignar, y con `set -u` eso revienta. Dos sentencias.
  local dir="$1"
  local out="$dir/dist/index.js"
  [ -f "$out" ] || return 0
  [ -n "$(find "$dir" -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' -newer "$out" 2>/dev/null | head -1)" ]
}

prisma_client_present() {
  [ -n "$(find "$REPO_ROOT/node_modules/.pnpm" -maxdepth 4 -type d -path '*@prisma+client*/.prisma/client' 2>/dev/null | head -1)" ]
}

# =============================================================================
# 0. Reinicio previo opcional
# =============================================================================
cd "$REPO_ROOT"

printf '%s╔══════════════════════════════════════════════════════════════════╗%s\n' "$C_BOLD" "$C_RESET"
printf '%s║  AgenIA · up.sh — levantando el stack local                      ║%s\n' "$C_BOLD" "$C_RESET"
printf '%s╚══════════════════════════════════════════════════════════════════╝%s\n' "$C_BOLD" "$C_RESET"

if [ "$DO_RESTART" -eq 1 ]; then
  step "Bajando el stack anterior (--restart)"
  if [ -x "$REPO_ROOT/scripts/down.sh" ]; then
    "$REPO_ROOT/scripts/down.sh" --keep-docker || warn "down.sh terminó con errores; se continúa."
  else
    warn "scripts/down.sh no existe o no es ejecutable — se omite."
  fi
fi

# =============================================================================
# 1. Preflight
# =============================================================================
step "Preflight"

have docker || die "Docker no está instalado o no está en el PATH."
docker info >/dev/null 2>&1 || die "El daemon de Docker no responde. Abre Docker Desktop y reintenta."
docker compose version >/dev/null 2>&1 || die "Falta el plugin 'docker compose' (v2)."
have pnpm || die "pnpm no está en el PATH. Instálalo: corepack enable && corepack prepare pnpm@9 --activate"
have node || die "node no está en el PATH."
have curl || die "curl no está en el PATH."
have lsof || warn "lsof no está disponible: la detección de puertos ocupados será parcial."
ok "docker $(docker version --format '{{.Client.Version}}' 2>/dev/null), pnpm $(pnpm -v), node $(node -v)"

[ -f "$COMPOSE_FILE" ] || die "No se encontró $COMPOSE_FILE"

for envfile in apps/api/.env apps/web/.env packages/database/.env; do
  if [ ! -f "$REPO_ROOT/$envfile" ]; then
    if [ -f "$REPO_ROOT/$envfile.example" ]; then
      die "Falta $envfile. Cópialo del ejemplo y complétalo:
     cp $envfile.example $envfile"
    fi
    die "Falta $envfile (sin .example en el repo — pídeselo al equipo)."
  fi
  grep -q '^DATABASE_URL=' "$REPO_ROOT/$envfile" || warn "$envfile no define DATABASE_URL."
done
ok "Archivos .env presentes (api, web, database)."

manifest_init

# =============================================================================
# 2. Infraestructura Docker
# =============================================================================
step "Infraestructura Docker"

COMPOSE_SERVICES="$INFRA_SERVICES"
[ "$WITH_HIS_MOCK" -eq 1 ] && COMPOSE_SERVICES="$COMPOSE_SERVICES mirror-his-mock"

CURRENT_PROJECT="$(basename "$REPO_ROOT")"

for svc in $COMPOSE_SERVICES; do
  case "$svc" in
    postgres)        port="$PG_PORT" ;;
    redis)           port="$REDIS_PORT" ;;
    mirror-his-mock) port="$HIS_MOCK_PORT" ;;
    *)               port="" ;;
  esac

  cname="$(container_name_for "$svc")"
  [ -n "$cname" ] || cname="$svc"
  state="$(container_state "$cname")"

  case "$state" in
    running)
      proj="$(container_project "$cname")"
      if [ -n "$proj" ] && [ "$proj" != "$CURRENT_PROJECT" ]; then
        ok "$svc ya corriendo como $cname ${C_DIM}(proyecto compose '$proj', no '$CURRENT_PROJECT' — se adopta)${C_RESET}"
      else
        ok "$svc ya corriendo como $cname."
      fi
      ;;
    exited|created|dead)
      info "$svc existe detenido ($cname) — docker start ..."
      docker start "$cname" >/dev/null || die "No se pudo arrancar el contenedor $cname."
      ok "$svc arrancado ($cname)."
      ;;
    paused)
      docker unpause "$cname" >/dev/null || die "No se pudo despausar $cname."
      ok "$svc despausado ($cname)."
      ;;
    *)
      info "$svc no existe — docker compose up -d $svc ..."
      docker compose -f "$COMPOSE_FILE" up -d "$svc" \
        || die "docker compose up -d $svc falló. Log: docker compose logs $svc"
      ok "$svc creado ($cname)."
      ;;
  esac

  manifest_set docker "$svc" "$cname" "$port" "-"
done

info "Esperando a que la infraestructura acepte conexiones..."

PG_CONTAINER="$(container_name_for postgres)"; [ -n "$PG_CONTAINER" ] || PG_CONTAINER=postgres
REDIS_CONTAINER="$(container_name_for redis)"; [ -n "$REDIS_CONTAINER" ] || REDIS_CONTAINER=redis

if docker exec "$PG_CONTAINER" sh -c 'i=0; until pg_isready -U "${POSTGRES_USER:-admin}" -d "${POSTGRES_DB:-antigravity}" -q; do i=$((i+1)); [ "$i" -gt 60 ] && exit 1; sleep 1; done' >/dev/null 2>&1; then
  ok "postgres listo en localhost:$PG_PORT"
else
  wait_for_tcp 127.0.0.1 "$PG_PORT" 60 || die "postgres no levantó. Log: docker logs $PG_CONTAINER"
  warn "postgres acepta TCP pero pg_isready no confirmó — puede seguir inicializando."
fi

if wait_for_tcp 127.0.0.1 "$REDIS_PORT" 30; then
  if docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "redis listo en localhost:$REDIS_PORT"
  else
    warn "redis responde en el puerto pero no contestó PONG."
  fi
else
  die "redis no levantó. Log: docker logs $REDIS_CONTAINER"
fi

if [ "$WITH_HIS_MOCK" -eq 1 ]; then
  info "SQL Server mock (amd64 emulado) tarda ~30-60s en el primer arranque..."
  if wait_for_tcp 127.0.0.1 "$HIS_MOCK_PORT" 180; then
    ok "mirror-his-mock listo en localhost:$HIS_MOCK_PORT"
  else
    die "mirror-his-mock no levantó. Log: docker logs $(container_name_for mirror-his-mock)"
  fi
fi

# =============================================================================
# 3. Dependencias y paquetes del workspace
# =============================================================================
step "Dependencias y paquetes del workspace"

if [ "$DO_INSTALL" -eq 1 ] || [ ! -d "$REPO_ROOT/node_modules" ] || [ ! -d "$REPO_ROOT/apps/api/node_modules" ]; then
  info "pnpm install --workspace-root ..."
  pnpm install --workspace-root || die "pnpm install falló."
  ok "Dependencias instaladas."
else
  ok "node_modules presente (usa --install para forzar reinstalación)."
fi

if [ "$DO_BUILD" -eq 1 ] || ! prisma_client_present; then
  info "prisma generate ..."
  pnpm --filter @agenia/database db:generate >/dev/null || die "prisma generate falló."
  ok "Cliente de Prisma generado."
else
  ok "Cliente de Prisma ya generado."
fi

if [ "$DO_BUILD" -eq 1 ] || needs_pkg_build "$REPO_ROOT/packages/database"; then
  info "build @agenia/database ..."
  pnpm --filter @agenia/database build >/dev/null || die "build de @agenia/database falló."
  ok "@agenia/database compilado."
else
  ok "@agenia/database al día."
fi

if [ "$DO_BUILD" -eq 1 ] || needs_pkg_build "$REPO_ROOT/packages/shared"; then
  info "build @agenia/shared ..."
  pnpm --filter @agenia/shared build >/dev/null || die "build de @agenia/shared falló."
  ok "@agenia/shared compilado."
else
  ok "@agenia/shared al día."
fi

# =============================================================================
# 4. Base de datos (opcional)
# =============================================================================
if [ "$DO_DB_PUSH" -eq 1 ] || [ "$DO_SEED" -eq 1 ]; then
  step "Base de datos"
  if [ "$DO_DB_PUSH" -eq 1 ]; then
    info "prisma db push ..."
    pnpm --filter @agenia/database db:push || die "prisma db push falló."
    ok "Schema aplicado a la BD."
  fi
  if [ "$DO_SEED" -eq 1 ]; then
    info "seed ..."
    ( cd "$REPO_ROOT/packages/database" && npx tsx scripts/seed.ts ) || die "El seed falló."
    ok "Seed ejecutado."
  fi
fi

if [ "$WITH_HIS_MOCK" -eq 1 ] && [ -n "${AGENIA_SYNC_PASSWORD:-}" ]; then
  step "Mock del HIS · schema PRUEBAS"
  info "AGENIA_SYNC_PASSWORD detectada — recreando PRUEBAS con local-his-mock/setup.ts ..."
  if npx tsx "$REPO_ROOT/apps/mirror-agent/local-his-mock/setup.ts"; then
    ok "Mock del HIS provisionado."
  else
    warn "setup.ts del mock falló — el contenedor sigue arriba, revisa el error de arriba."
  fi
fi

# =============================================================================
# 5. Servicios de aplicación
# =============================================================================
step "Servicios de aplicación"

if [ "$START_API" -eq 1 ]; then
  start_proc api "$REPO_ROOT" "$API_PORT" "PORT=$API_PORT pnpm --filter api start:dev"
else
  info "API omitida (--no-api)."
fi

if [ "$START_WEB" -eq 1 ]; then
  start_proc web "$REPO_ROOT" "$WEB_PORT" "pnpm --filter web exec next dev --port $WEB_PORT"
else
  info "WEB omitida (--no-web)."
fi

if [ "$START_API" -eq 1 ]; then
  info "Esperando a la API en http://localhost:$API_PORT ..."
  proc_alive api || tail_log_and_die api
  wait_for_http "http://localhost:$API_PORT/" 120 || tail_log_and_die api
  ok "API respondiendo en http://localhost:$API_PORT"
fi

if [ "$START_WEB" -eq 1 ]; then
  info "Esperando a la WEB en http://localhost:$WEB_PORT ..."
  proc_alive web || tail_log_and_die web
  # next dev abre el puerto antes de compilar la primera ruta: basta el TCP.
  wait_for_tcp 127.0.0.1 "$WEB_PORT" 120 || tail_log_and_die web
  ok "WEB escuchando en http://localhost:$WEB_PORT"
fi

# =============================================================================
# 6. Extras opt-in
# =============================================================================
if [ "$WITH_MIRROR_AGENT" -eq 1 ]; then
  step "Agente espejo (mirror-agent)"
  MIRROR_ENV_FILE="$REPO_ROOT/.local/mirror-agent.env"
  MIRROR_PREFIX=""
  if [ -f "$MIRROR_ENV_FILE" ]; then
    MIRROR_PREFIX="set -a; . '$MIRROR_ENV_FILE'; set +a;"
    info "Cargando ${MIRROR_ENV_FILE#$REPO_ROOT/}"
  elif [ -z "${MIRROR_AGENT_TOKEN:-}" ]; then
    die "El agente espejo necesita MIRROR_AGENT_TOKEN.
     Exporta la variable, o crea .local/mirror-agent.env con:
       MIRROR_API_URL=http://localhost:$API_PORT
       MIRROR_AGENT_TOKEN=<token del provision-mirror-config.ts>
       MIRROR_DRIVER_KEY=cnt-sanvicente-anserma"
  fi
  start_proc mirror-agent "$REPO_ROOT/apps/mirror-agent" "" \
    "${MIRROR_PREFIX} MIRROR_API_URL=\${MIRROR_API_URL:-http://localhost:$API_PORT} MIRROR_DRIVER_KEY=\${MIRROR_DRIVER_KEY:-cnt-sanvicente-anserma} npx ts-node src/index.ts"
  sleep 3
  if proc_alive mirror-agent; then
    ok "mirror-agent corriendo (handshake en su log)."
  else
    tail_log_and_die mirror-agent
  fi
fi

if [ "$WITH_TUNNEL" -eq 1 ]; then
  step "Túnel de WhatsApp (ngrok)"
  if ! have ngrok; then
    warn "ngrok no está instalado — se omite el túnel (brew install ngrok)."
  else
    "$REPO_ROOT/scripts/whatsapp-tunnel.sh" "$API_PORT" || warn "whatsapp-tunnel.sh falló."
    NGROK_PID="$(pgrep -f "ngrok http $API_PORT" 2>/dev/null | head -1 || true)"
    if [ -n "$NGROK_PID" ]; then
      echo "$NGROK_PID" > "$RUN_DIR/ngrok.pid"
      manifest_set proc ngrok "$NGROK_PID" 4040 "$REPO_ROOT/.local/ngrok.log"
      ok "ngrok registrado (pid $NGROK_PID) — down.sh lo bajará también."
    else
      warn "No se pudo identificar el pid de ngrok; down.sh no lo bajará automáticamente."
    fi
  fi
fi

# =============================================================================
# 7. Resumen
# =============================================================================
printf '\n%s╔══════════════════════════════════════════════════════════════════╗%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
printf '%s║  Stack arriba                                                    ║%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
printf '%s╚══════════════════════════════════════════════════════════════════╝%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
echo
[ "$START_WEB" -eq 1 ] && printf '  %-16s %s\n' "WEB" "http://localhost:$WEB_PORT"
[ "$START_API" -eq 1 ] && printf '  %-16s %s\n' "API" "http://localhost:$API_PORT"
printf '  %-16s %s\n' "postgres"   "localhost:$PG_PORT  (antigravity_db)"
printf '  %-16s %s\n' "redis"      "localhost:$REDIS_PORT  (antigravity_redis)"
[ "$WITH_HIS_MOCK" -eq 1 ] && printf '  %-16s %s\n' "HIS mock" "localhost:$HIS_MOCK_PORT  ($(container_name_for mirror-his-mock))"
[ "$WITH_MIRROR_AGENT" -eq 1 ] && printf '  %-16s %s\n' "mirror-agent" "en background — tail -f ${RUN_DIR#$REPO_ROOT/}/mirror-agent.log"
echo
printf '  %sLogs%s     tail -f %s/{api,web}.log\n' "$C_DIM" "$C_RESET" "${RUN_DIR#$REPO_ROOT/}"
printf '  %sEstado%s   %s\n' "$C_DIM" "$C_RESET" "${MANIFEST#$REPO_ROOT/}"
printf '  %sBajar%s    ./scripts/down.sh\n' "$C_DIM" "$C_RESET"
echo

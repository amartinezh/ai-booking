#!/usr/bin/env bash
# =============================================================================
# agenia — utilidad de operación del stack en el VPS
#
# El instalador la enlaza en /usr/local/bin/agenia, así que desde cualquier
# directorio del servidor:
#
#   agenia status          estado de contenedores, salud y recursos
#   agenia up|down         levantar / apagar el stack
#   agenia start-all       arranque completo por capas, con espera de salud
#   agenia stop-all        apagado ordenado de todo, sin tocar datos
#   agenia restart [svc]   reiniciar todo o un servicio (api|web|caddy|...)
#   agenia logs [svc] [-f] logs (últimas 200 líneas; -f para seguir)
#   agenia build [svc]     reconstruir imágenes
#   agenia update          git pull + build + migrate + up + verify
#   agenia migrate         aplicar migraciones Prisma pendientes
#   agenia verify          batería de comprobaciones post-arranque
#   agenia backup          volcado comprimido de PostgreSQL
#   agenia restore <file>  restaurar un volcado (DESTRUCTIVO, pide confirmar)
#   agenia psql | redis    consola de base de datos / Redis
#   agenia shell <svc>     shell dentro de un contenedor
#   agenia env             variables efectivas (secretos enmascarados)
# =============================================================================
set -Eeuo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.deploy.yml"
ENV_FILE="$ROOT/.env.production"
BACKUP_DIR="${AGENIA_BACKUP_DIR:-/var/backups/agenia}"

if [[ -t 1 ]]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; B=$'\033[0;34m'; D=$'\033[2m'; N=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; D=''; N=''
fi
ok()   { printf '%s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*"; }
err()  { printf '%s✘%s %s\n' "$R" "$N" "$*" >&2; }
head1(){ printf '\n%s── %s %s\n' "$B" "$*" "$N"; }

usage() { sed -n '3,20p' "$SELF" | sed 's/^# \{0,1\}//'; }

# La ayuda debe funcionar aunque el stack no esté instalado todavía.
case "${1:-}" in -h|--help|help) usage; exit 0 ;; esac

[[ -f "$COMPOSE_FILE" ]] || { err "No existe $COMPOSE_FILE"; exit 1; }
[[ -f "$ENV_FILE" ]]     || { err "No existe $ENV_FILE (¿corriste el instalador?)"; exit 1; }

# Los valores de .env.production se generan sin comillas ni espacios, así que
# es seguro cargarlos en el shell.
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# ── Comandos ────────────────────────────────────────────────────────────────

cmd_up()      { dc up -d "$@"; ok "Stack levantado"; }
cmd_down()    { dc down "$@"; ok "Stack detenido"; }
cmd_restart() { dc restart "$@"; ok "Reiniciado: ${*:-todo}"; }
cmd_ps()      { dc ps; }
cmd_build()   { dc build "$@" && dc up -d "$@"; ok "Reconstruido: ${*:-todo}"; }
cmd_shell()   { local s="${1:?uso: agenia shell <servicio>}"; dc exec "$s" sh; }
cmd_psql()    { dc exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
cmd_redis()   { dc exec redis redis-cli "$@"; }

cmd_logs() {
  local svc=""
  [[ ${1:-} && ${1:0:1} != "-" ]] && { svc="$1"; shift; }
  # shellcheck disable=SC2086
  dc logs --tail 200 "$@" $svc
}

# El historial de migraciones del repo NO puede construir una base vacía: el
# modelo multi-tenant (Organization y siguientes) se creó con `prisma db push`
# y nunca se capturó como migración, así que 20260517045511 falla con
# «relation "Organization" does not exist». De ahí los tres caminos.
db_has_table() {
  local out
  out="$(dc exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
        "SELECT to_regclass('public.\"$1\"') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')"
  [[ "$out" == "t" ]]
}

db_baseline() {
  dc run --rm --entrypoint sh migrator -c '
    set -e
    for d in packages/database/prisma/migrations/*/; do
      prisma migrate resolve --applied "$(basename "$d")" \
        --schema=packages/database/prisma/schema.prisma >/dev/null 2>&1 || true
    done'
}

cmd_migrate() {
  head1 "Base de datos"
  if db_has_table "_prisma_migrations"; then
    dc run --rm migrator
    ok "Migraciones al día"
  elif db_has_table "Organization"; then
    warn "Esquema presente sin historial de migraciones: sellando (baseline)"
    db_baseline
    ok "Historial sellado"
  else
    warn "Base vacía: se crea el esquema completo desde schema.prisma"
    dc run --rm migrator prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate
    db_baseline
    ok "Esquema creado y historial sellado"
  fi
}

cmd_migrate_status() {
  dc run --rm migrator \
    prisma migrate status --schema=packages/database/prisma/schema.prisma || true
}

cmd_env() {
  # Enmascara cualquier valor de una clave que huela a secreto.
  sed -E 's/^(.*(PASSWORD|SECRET|KEY|TOKEN)[A-Z_]*)=.*/\1=********/' "$ENV_FILE" | grep -v '^\s*$'
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  local f="$BACKUP_DIR/agenia-$(date +%Y%m%d-%H%M%S).sql.gz"
  dc exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
    | gzip -9 > "$f"
  # Un volcado válido de este esquema nunca baja de unos pocos KB.
  # wc -c funciona igual en GNU y BSD; `stat -c` solo existe en GNU.
  local size; size=$(wc -c < "$f" 2>/dev/null | tr -d ' ' || echo 0)
  if (( size < 1024 )); then
    err "El volcado quedó en ${size} bytes — algo falló. Revisar: $f"
    exit 1
  fi
  find "$BACKUP_DIR" -name 'agenia-*.sql.gz' -mtime +14 -delete 2>/dev/null || true
  ok "Backup: $f ($(numfmt --to=iec "$size" 2>/dev/null || echo "${size} bytes"))"
}

cmd_restore() {
  local f="${1:?uso: agenia restore <archivo.sql.gz>}"
  [[ -f "$f" ]] || { err "No existe $f"; exit 1; }
  warn "Esto SOBRESCRIBE la base de datos '$POSTGRES_DB' por completo."
  read -r -p "Escribe RESTAURAR para continuar: " a
  [[ "$a" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }
  gunzip -c "$f" | dc exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  ok "Restaurado desde $f"
  cmd_restart api web
}

cmd_update() {
  head1 "Actualizando código"
  # El instalador remoto copia por rsync y excluye .git a propósito (el remote
  # del repo lleva un token embebido). Sin repositorio no hay `git pull` que
  # valga: la actualización se lanza desde el equipo de desarrollo.
  if [[ ! -d "$ROOT/.git" ]]; then
    warn "Este servidor no tiene repositorio git: el código llegó por rsync."
    warn "Actualiza desde tu computador, en la raíz del repo:"
    warn "    bash deploy/remote-install.sh --host <IP> --single-domain <dominio> --email <correo>"
    warn "Ese mismo comando resincroniza el código, reconstruye y migra."
    echo
    warn "Si solo quieres reconstruir con el código que YA está aquí: agenia build"
    return 1
  fi
  git -C "$ROOT" pull --ff-only
  head1 "Reconstruyendo imágenes"
  dc build
  head1 "Migraciones"
  cmd_migrate
  head1 "Recreando servicios"
  dc up -d
  cmd_verify
}

cmd_verify() {
  local fails=0

  head1 "Contenedores"
  local svc state
  for svc in postgres redis api web caddy; do
    state="$(docker inspect -f '{{.State.Status}}{{if .State.Health}} ({{.State.Health.Status}}){{end}}' \
             "$(dc ps -q "$svc" 2>/dev/null)" 2>/dev/null || echo 'ausente')"
    case "$state" in
      running*unhealthy*) err  "$svc → $state"; fails=$((fails+1)) ;;
      running*)           ok   "$svc → $state" ;;
      *)                  err  "$svc → $state"; fails=$((fails+1)) ;;
    esac
  done

  head1 "Conectividad interna"
  if dc exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "Redis responde PONG"
  else err "Redis no responde"; fails=$((fails+1)); fi

  if dc exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    ok "PostgreSQL acepta conexiones"
  else err "PostgreSQL no acepta conexiones"; fails=$((fails+1)); fi

  local tables
  tables="$(dc exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d '[:space:]')"
  if [[ "${tables:-0}" -gt 20 ]]; then
    ok "Esquema aplicado ($tables tablas)"
  else err "Solo $tables tablas en el esquema — faltan migraciones (agenia migrate)"; fails=$((fails+1)); fi

  # Cualquier respuesta HTTP sirve: `GET /` devuelve 404 a propósito (no hay
  # controlador raíz registrado). Lo que se comprueba es que responde.
  if dc exec -T api node -e "const s=require('net').connect(3000,'127.0.0.1');s.setTimeout(4000);s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1))" 2>/dev/null; then
    ok "API escuchando en el puerto 3000"
  else err "API no escucha en el puerto 3000"; fails=$((fails+1)); fi

  if dc exec -T web node -e "fetch('http://api:3000/').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok "WEB alcanza la API por la red interna"
  else err "WEB no alcanza http://api:3000"; fails=$((fails+1)); fi

  head1 "Acceso público"
  local code
  probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" || echo 000; }

  if [[ -n "${PUBLIC_WEB_URL:-}" ]]; then
    code="$(probe "${PUBLIC_WEB_URL}")"
    if [[ "$code" =~ ^(200|301|302|307|308)$ ]]; then
      ok "Panel ${PUBLIC_WEB_URL} → HTTP $code"
    else err "Panel ${PUBLIC_WEB_URL} → HTTP $code"; fails=$((fails+1)); fi
  fi

  if [[ -n "${PUBLIC_API_URL:-}" ]]; then
    # Un verify_token desconocido debe dar 403. Ese 403 recorre la cadena
    # entera —proxy, API y consulta a PostgreSQL para buscar el token—, así
    # que es la comprobación pública más honesta que se puede hacer sin
    # credenciales. No ensucia SystemLog: solo se persisten los 5xx.
    code="$(probe "${PUBLIC_API_URL}/chatbot/webhook?hub.mode=subscribe&hub.verify_token=agenia-verify-probe&hub.challenge=1")"
    if [[ "$code" == "403" ]]; then
      ok "Webhook publicado y rechazando tokens desconocidos (403)"
    elif [[ "$code" == "200" ]]; then
      err "El webhook aceptó un token falso — revisa la configuración de Meta"; fails=$((fails+1))
    else
      err "Webhook ${PUBLIC_API_URL}/chatbot/webhook → HTTP $code (se esperaba 403)"; fails=$((fails+1))
    fi
  fi

  head1 "Seguridad"
  if ss -ltnp 2>/dev/null | grep -qE '0\.0\.0\.0:(5432|6379)|\[::\]:(5432|6379)'; then
    err "PostgreSQL o Redis expuestos a Internet"; fails=$((fails+1))
  else ok "PostgreSQL y Redis no expuestos públicamente"; fi

  # El resto de la API no debe ser alcanzable desde fuera: el panel la consume
  # por la red interna. Se sondea una ruta protegida real — si Caddy la está
  # bloqueando responde 404; si estuviera publicada, su guard daría 401/403.
  if [[ -n "${PUBLIC_API_URL:-}" ]]; then
    code="$(probe "${PUBLIC_API_URL}/system-logs/recent-errors")"
    case "$code" in
      404) ok "Resto de la API no expuesto a Internet (404 en rutas internas)" ;;
      401|403|200) err "La API interna SÍ está expuesta (${PUBLIC_API_URL}/system-logs → $code)"; fails=$((fails+1)) ;;
      *) warn "No se pudo comprobar la exposición de la API interna (HTTP $code)" ;;
    esac
  fi

  head1 "Recursos"
  df -h / 2>/dev/null | awk 'NR==2 {printf "  disco / : %s usados de %s (%s)\n", $3, $2, $5}' || true
  free -h 2>/dev/null | awk 'NR==2 {printf "  memoria : %s usados de %s\n", $3, $2}' || true

  echo
  if (( fails == 0 )); then ok "Todo correcto."; else err "$fails comprobación(es) fallida(s)."; return 1; fi
}

cmd_status() { cmd_ps; cmd_verify; }

case "${1:-status}" in
  up|start)       shift; cmd_up "$@" ;;
  start-all)      shift; exec "$ROOT/deploy/start-all.sh" "$@" ;;
  stop-all)       shift; exec "$ROOT/deploy/stop-all.sh" "$@" ;;
  down|stop)      shift; cmd_down "$@" ;;
  restart)        shift; cmd_restart "$@" ;;
  ps)             shift; cmd_ps ;;
  status)         shift; cmd_status ;;
  logs)           shift; cmd_logs "$@" ;;
  build|rebuild)  shift; cmd_build "$@" ;;
  update)         shift; cmd_update ;;
  migrate)        shift; cmd_migrate ;;
  migrate-status) shift; cmd_migrate_status ;;
  verify|check)   shift; cmd_verify ;;
  backup)         shift; cmd_backup ;;
  restore)        shift; cmd_restore "$@" ;;
  psql)           shift; cmd_psql "$@" ;;
  redis)          shift; cmd_redis "$@" ;;
  shell|sh)       shift; cmd_shell "$@" ;;
  env)            shift; cmd_env ;;
  *) err "Comando desconocido: $1"; echo; usage; exit 1 ;;
esac

#!/usr/bin/env bash
# =============================================================================
# scripts/db-rename.sh — migra una base LOCAL ya existente al nombre y la
# contraseña nuevos.
#
# Por qué hace falta: la imagen de postgres solo aplica POSTGRES_DB y
# POSTGRES_PASSWORD **al inicializar el volumen**. Si ya tienes datos, cambiar
# esas variables en docker-compose.yml no renombra nada: el contenedor arranca
# con la base vieja y la clave vieja, y las apps fallan con
# "database agenia does not exist" o "password authentication failed".
#
# Este script corre los ALTER que sí surten efecto:
#     ALTER DATABASE antigravity RENAME TO agenia;
#     ALTER ROLE <user> WITH PASSWORD '<la de .env>';
#
# Uso:
#     ./scripts/db-rename.sh              # migra
#     ./scripts/db-rename.sh --dry-run    # solo diagnostica, no toca nada
#
# Si NO tienes datos que conservar, esto no hace falta: borra el volumen
# (`docker volume rm <vol>`) y `./scripts/up.sh` crea la base nueva limpia.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_ENV="$REPO_ROOT/.env"
OLD_DB="${OLD_DB:-antigravity}"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BLUE=''
fi
step() { printf '\n%s▸ %s%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

docker info >/dev/null 2>&1 || die "El daemon de Docker no está corriendo. Arranca Docker Desktop y reintenta."

env_get() {
  [ -f "$2" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$2" | tail -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

[ -f "$ROOT_ENV" ] || die "Falta .env en la raíz. Corre primero: ./scripts/secrets-init.sh"
NEW_USER="$(env_get POSTGRES_USER "$ROOT_ENV")"
NEW_PASS="$(env_get POSTGRES_PASSWORD "$ROOT_ENV")"
NEW_DB="$(env_get POSTGRES_DB "$ROOT_ENV")"
[ -n "$NEW_USER" ] && [ -n "$NEW_PASS" ] && [ -n "$NEW_DB" ] || die ".env incompleto. Corre: ./scripts/secrets-init.sh"

# --- 1. Localizar el contenedor de Postgres que tenga los datos --------------
step "Buscando el Postgres existente"

PG_CONTAINER=""
for cand in agenia_db antigravity_db; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$cand"; then
    PG_CONTAINER="$cand"; break
  fi
done

if [ -z "$PG_CONTAINER" ]; then
  ok "No hay contenedor de Postgres previo: no hay nada que migrar."
  info "Corre ./scripts/up.sh y se creará la base '$NEW_DB' limpia."
  exit 0
fi
info "Contenedor: $PG_CONTAINER"

VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$PG_CONTAINER" 2>/dev/null || true)"
[ -n "$VOLUME" ] && info "Volumen de datos: $VOLUME"

if [ "$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER")" != "true" ]; then
  info "Arrancándolo para poder migrar..."
  [ "$DRY_RUN" -eq 1 ] || docker start "$PG_CONTAINER" >/dev/null
  [ "$DRY_RUN" -eq 1 ] || sleep 3
fi

# El usuario dueño puede no ser el mismo que pusimos en .env (histórico: admin).
OWNER="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$PG_CONTAINER" | sed -n 's/^POSTGRES_USER=//p' | tail -n1)"
OWNER="${OWNER:-$NEW_USER}"
info "Superusuario del contenedor: $OWNER"

# Dentro del contenedor, pg_hba de la imagen oficial permite `local all all trust`,
# así que psql por socket unix no pide contraseña. Por eso no necesitamos la vieja.
psql_q() { docker exec "$PG_CONTAINER" psql -U "$OWNER" -d postgres -tAc "$1" 2>/dev/null || true; }

# --- 2. Diagnóstico ----------------------------------------------------------
step "Estado actual de las bases"
if [ "$DRY_RUN" -eq 1 ] && [ "$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER")" != "true" ]; then
  warn "--dry-run con el contenedor apagado: no puedo listar las bases."
  exit 0
fi

DBS="$(psql_q "SELECT datname FROM pg_database WHERE datistemplate = false;")"
[ -n "$DBS" ] || die "No pude consultar las bases dentro de $PG_CONTAINER. ¿Terminó de inicializar? Revisa: docker logs $PG_CONTAINER"
printf '%s\n' "$DBS" | sed 's/^/    · /'

HAS_OLD=0; HAS_NEW=0
printf '%s\n' "$DBS" | grep -qx "$OLD_DB" && HAS_OLD=1
printf '%s\n' "$DBS" | grep -qx "$NEW_DB" && HAS_NEW=1

if [ "$HAS_NEW" -eq 1 ] && [ "$HAS_OLD" -eq 1 ]; then
  die "Existen '$OLD_DB' Y '$NEW_DB' a la vez. No adivino cuál conservar: revísalas a mano y borra la que sobre."
fi

# --- 3. Plan -----------------------------------------------------------------
step "Cambios a aplicar"
[ "$HAS_OLD" -eq 1 ] && info "· ALTER DATABASE $OLD_DB RENAME TO $NEW_DB" || info "· (la base ya se llama '$NEW_DB' — sin renombrar)"
info "· ALTER ROLE $OWNER WITH PASSWORD '<la de .env>'"

if [ "$DRY_RUN" -eq 1 ]; then
  warn "--dry-run: no se aplicó nada."
  exit 0
fi

# --- 4. Aplicar --------------------------------------------------------------
step "Aplicando"

if [ "$HAS_OLD" -eq 1 ]; then
  # Un RENAME falla si hay sesiones abiertas contra esa base.
  docker exec "$PG_CONTAINER" psql -U "$OWNER" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$OLD_DB' AND pid <> pg_backend_pid();" >/dev/null
  docker exec "$PG_CONTAINER" psql -U "$OWNER" -d postgres -c \
    "ALTER DATABASE \"$OLD_DB\" RENAME TO \"$NEW_DB\";" >/dev/null \
    || die "Falló el RENAME. Cierra lo que esté conectado a '$OLD_DB' y reintenta."
  ok "Base renombrada: $OLD_DB → $NEW_DB (los datos se conservan)."
fi

# La contraseña se pasa por stdin, no por argv: argv es visible en `ps`.
printf "ALTER ROLE %s WITH PASSWORD '%s';\n" "$OWNER" "$NEW_PASS" \
  | docker exec -i "$PG_CONTAINER" psql -U "$OWNER" -d postgres -q \
  || die "Falló el ALTER ROLE."
ok "Contraseña de '$OWNER' actualizada a la de .env."

# --- 5. El contenedor viejo estorba ------------------------------------------
if [ "$PG_CONTAINER" = "antigravity_db" ]; then
  step "Contenedor con el nombre viejo"
  warn "docker-compose.yml ahora define 'agenia_db'. El contenedor 'antigravity_db'"
  warn "hay que eliminarlo (los DATOS viven en el volumen '$VOLUME', no en él)."
  printf '\n  Ejecuta:\n    %sdocker rm -f antigravity_db%s\n' "$C_BOLD" "$C_RESET"
  printf '    %sdocker volume ls%s   # confirma que "%s" sigue ahí\n' "$C_BOLD" "$C_RESET" "$VOLUME"
  printf '\n  Y luego ./scripts/up.sh. Si el nuevo compose crea OTRO volumen en vez de\n'
  printf '  reusar "%s", móntalo explícitamente o restaura con pg_dump.\n' "$VOLUME"
fi

step "Listo"
ok "Base '$NEW_DB' accesible con el usuario '$OWNER' y la contraseña de .env."

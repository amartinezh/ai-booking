#!/usr/bin/env bash
# =============================================================================
# scripts/secrets-init.sh — genera y sincroniza las credenciales LOCALES.
#
# Idempotente: solo crea lo que falta, nunca pisa un valor ya definido.
#
#   1. Crea `.env` en la raíz (gitignored) con POSTGRES_USER/PASSWORD/DB.
#      La contraseña sale de `openssl rand -hex 16` — nunca de una constante.
#   2. Propaga el DATABASE_URL resultante a los .env de api, web y database,
#      para que Prisma y las apps apunten a la misma base con la misma clave.
#   3. Deja todos los .env en chmod 600.
#
# Lo invoca `scripts/up.sh` automáticamente. También se puede correr suelto:
#     ./scripts/secrets-init.sh            # crea lo que falte
#     ./scripts/secrets-init.sh --rotate   # fuerza contraseña nueva de Postgres
#
# ⚠️ --rotate NO cambia la contraseña de un Postgres YA inicializado: la imagen
#    de postgres solo aplica POSTGRES_PASSWORD al crear el volumen. Para una
#    base existente usa `./scripts/db-rename.sh`, que corre el ALTER ROLE.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_ENV="$REPO_ROOT/.env"
APP_ENVS="apps/api/.env apps/web/.env packages/database/.env"

ROTATE=0
[ "${1:-}" = "--rotate" ] && ROTATE=1

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
  C_RESET=''; C_GREEN=''; C_YELLOW=''; C_RED=''
fi
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

command -v openssl >/dev/null 2>&1 || die "openssl no está instalado: no puedo generar contraseñas seguras."

# Contraseña hex: sin caracteres que haya que URL-encodear en el DATABASE_URL.
gen_pass() { openssl rand -hex 16; }

# Lee VAR de un archivo .env sin ejecutarlo (evita ejecución de código si el
# archivo trae algo raro). Quita comillas envolventes si las hay.
env_get() {
  [ -f "$2" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$2" | tail -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# --- 1. .env de la raíz ------------------------------------------------------
umask 077

if [ ! -f "$ROOT_ENV" ]; then
  cat > "$ROOT_ENV" <<EOF
# Generado por scripts/secrets-init.sh — NO commitear (está en .gitignore).
# Credenciales de la infraestructura Docker local. Ver .env.example.
POSTGRES_USER=admin
POSTGRES_PASSWORD=$(gen_pass)
POSTGRES_DB=agenia
MIRROR_HIS_MOCK_SA_PASSWORD=AgenIA_$(openssl rand -hex 6)_Lx1!
EOF
  ok ".env creado en la raíz con contraseña aleatoria."
else
  # Completa claves faltantes sin tocar las existentes.
  for pair in "POSTGRES_USER=admin" "POSTGRES_DB=agenia"; do
    key="${pair%%=*}"; def="${pair#*=}"
    if [ -z "$(env_get "$key" "$ROOT_ENV")" ]; then
      printf '%s=%s\n' "$key" "$def" >> "$ROOT_ENV"
      ok "$key añadido a .env (=$def)."
    fi
  done
  if [ -z "$(env_get POSTGRES_PASSWORD "$ROOT_ENV")" ] || [ "$ROTATE" -eq 1 ]; then
    new_pass="$(gen_pass)"
    tmp="$(mktemp)"
    grep -v '^[[:space:]]*POSTGRES_PASSWORD=' "$ROOT_ENV" > "$tmp" || true
    printf 'POSTGRES_PASSWORD=%s\n' "$new_pass" >> "$tmp"
    cat "$tmp" > "$ROOT_ENV"; rm -f "$tmp"
    [ "$ROTATE" -eq 1 ] && warn "Contraseña rotada. Si el volumen de Postgres ya existía, corre ./scripts/db-rename.sh para aplicar el ALTER ROLE." \
                        || ok "POSTGRES_PASSWORD generado en .env."
  fi
  if [ -z "$(env_get MIRROR_HIS_MOCK_SA_PASSWORD "$ROOT_ENV")" ]; then
    printf 'MIRROR_HIS_MOCK_SA_PASSWORD=AgenIA_%s_Lx1!\n' "$(openssl rand -hex 6)" >> "$ROOT_ENV"
    ok "MIRROR_HIS_MOCK_SA_PASSWORD generado en .env."
  fi
fi
chmod 600 "$ROOT_ENV"

# --- 2. DATABASE_URL a las apps ---------------------------------------------
PG_USER="$(env_get POSTGRES_USER "$ROOT_ENV")"
PG_PASS="$(env_get POSTGRES_PASSWORD "$ROOT_ENV")"
PG_DB="$(env_get POSTGRES_DB   "$ROOT_ENV")"
PG_PORT_LOCAL="${PG_PORT:-5432}"

[ -n "$PG_USER" ] && [ -n "$PG_PASS" ] && [ -n "$PG_DB" ] \
  || die "El .env de la raíz quedó incompleto (USER/PASSWORD/DB). Revísalo a mano."

DB_URL="postgresql://${PG_USER}:${PG_PASS}@localhost:${PG_PORT_LOCAL}/${PG_DB}?schema=public"

for rel in $APP_ENVS; do
  f="$REPO_ROOT/$rel"
  if [ ! -f "$f" ]; then
    if [ -f "$f.example" ]; then
      cp "$f.example" "$f"
      warn "$rel no existía: copiado de $rel.example — complétalo con tus claves."
    else
      printf '# Generado por scripts/secrets-init.sh\n' > "$f"
      warn "$rel no existía: creado vacío."
    fi
  fi

  current="$(env_get DATABASE_URL "$f")"
  if [ "$current" = "$DB_URL" ]; then
    chmod 600 "$f"
    continue
  fi

  tmp="$(mktemp)"
  if grep -q '^[[:space:]]*DATABASE_URL=' "$f"; then
    # Reemplaza en sitio conservando el orden y el resto del archivo.
    awk -v url="DATABASE_URL=\"$DB_URL\"" '
      /^[[:space:]]*DATABASE_URL=/ && !done { print url; done=1; next }
      { print }
    ' "$f" > "$tmp"
  else
    { printf 'DATABASE_URL="%s"\n' "$DB_URL"; cat "$f"; } > "$tmp"
  fi
  cat "$tmp" > "$f"; rm -f "$tmp"
  chmod 600 "$f"
  ok "DATABASE_URL sincronizado en $rel."
done

ok "Credenciales locales listas (base: $PG_DB, usuario: $PG_USER)."

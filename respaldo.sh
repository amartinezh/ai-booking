#!/usr/bin/env bash
# =============================================================================
#  AgenIA — copia de seguridad del servidor a ESTE computador
# =============================================================================
#
#  Se ejecuta EN TU COMPUTADOR, en la raíz del repo (como update.sh):
#
#    ./respaldo.sh                                 copia completa del servidor de producción
#    ./respaldo.sh --host <ip>                     de otro servidor
#    ./respaldo.sh --revisar                       solo comprueba acceso, contenedores y espacio
#    ./respaldo.sh --listar                        las copias que hay aquí
#    ./respaldo.sh --verificar respaldos/ultimo    vuelve a comprobar una copia (huellas + restauración)
#    ./respaldo.sh --cifrar                        además, la deja en un solo archivo cifrado
#
#  QUÉ COPIA — todo lo que hace falta para levantar el sistema en un VPS nuevo
#  con sus datos (docs/emergencia/RESCATE_VPS.md):
#
#    db.dump            la base de PostgreSQL completa (pg_dump -Fc, instantánea consistente)
#    roles.sql          los roles de PostgreSQL (pg_dumpall --roles-only)
#    bd.env             usuario y nombre de la base (sin la clave)
#    redis.rdb          foto de Redis (sesiones del asistente y colas: estado de corta vida)
#    config.tar.gz      con las rutas del servidor: /opt/agenia/.env.production (TODOS los
#                       secretos, entre ellos la ENCRYPTION_KEY), el deploy/Caddyfile REAL,
#                       install.conf, deploy/secrets, /var/lib/agenia/alertas (vigía), cron,
#                       logrotate, SSH endurecido, fail2ban y las llaves autorizadas
#    caddy-data.tar.gz  volumen agenia_caddy_data: certificados TLS y la landing agenia.co
#    MANIFIESTO.txt     qué había: versiones, contenedores, imágenes, migraciones, claves del .env
#    CONTEOS.tsv        filas por tabla de la copia ya restaurada (prueba de restauración)
#    conteos.sql        la consulta que produce CONTEOS.tsv (para comparar al restaurar)
#    SHA256SUMS         huellas de todo lo anterior (LEAME.txt no lleva)
#
#  CÓMO LO HACE
#    1. SSH con la llave dedicada (sin contraseña); la huella del servidor queda fija la
#       primera vez y si cambia la conexión se rechaza.
#    2. Arma la copia en el servidor en /var/backups/agenia/para-local-<fecha> (root, 700)
#       y calcula las huellas allá. Nunca bajo /opt/agenia: el despliegue hace rsync
#       --delete ahí (así se perdió un respaldo el 2026-10-04).
#    3. La trae por el mismo SSH a respaldos/<fecha>.parcial, comprueba cada huella y solo
#       entonces la renombra a respaldos/<fecha>: una copia a medias nunca queda con
#       nombre final.
#    4. Borra la carpeta temporal del servidor.
#    5. Restaura db.dump en un PostgreSQL 15 desechable de Docker (sin red ni puertos) y
#       cuenta las filas de cada tabla. Sin Docker corriendo la salta y lo dice.
#    6. respaldos/ultimo apunta a la copia nueva; se conservan las últimas 30.
#
#  No detiene ni cambia nada del sistema: pg_dump no bloquea a la aplicación y la foto
#  de Redis es la misma que Redis hace solo cada minuto.
#
#  La carpeta respaldos/ lleva datos de pacientes (Ley 1581) y todos los secretos: queda
#  en 700/600, fuera de git (.gitignore), de las imágenes (.dockerignore) y del rsync
#  al servidor (deploy/update-vps.sh y deploy/remote-install.sh).
# =============================================================================
set -euo pipefail
umask 077

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

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="89.117.61.28"; SSH_KEY=""; SSH_PORT="22"
DESTINO="$ROOT/respaldos"; CONSERVAR=30
MODO="copiar"; OBJETIVO=""; SIN_PRUEBA=0; CIFRAR=0

usage() { sed -n '2,52p' "$0" | sed 's/^# \{0,1\}//'; cat <<'EOF'

OPCIONES
      --host <ip>          Servidor (por defecto 89.117.61.28, el de update.sh)
      --ssh-key <ruta>     Llave SSH (por defecto ~/.ssh/agenia_<ip>_ed25519)
      --ssh-port <puerto>  Puerto SSH (por defecto 22)
      --destino <carpeta>  Dónde guardar las copias (por defecto respaldos/ del repo)
      --conservar <n>      Cuántas copias conservar (por defecto 30)
      --sin-prueba         No probar la restauración (no hace falta Docker)
      --cifrar             Deja la copia en <fecha>.tar.gz.enc (AES-256, frase propia;
                           AGENIA_RESPALDO_FRASE la da sin preguntarla)
      --revisar            Solo comprueba acceso, contenedores y espacio
      --listar             Lista las copias de la carpeta de destino
      --verificar <copia>  Comprueba huellas y restauración de una copia existente
  -h, --help               Esta ayuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)       HOST="${2:?}"; shift ;;
    --ssh-key)    SSH_KEY="${2:?}"; shift ;;
    --ssh-port)   SSH_PORT="${2:?}"; shift ;;
    --destino)    DESTINO="${2:?}"; shift ;;
    --conservar)  CONSERVAR="${2:?}"; shift ;;
    --sin-prueba) SIN_PRUEBA=1 ;;
    --cifrar)     CIFRAR=1 ;;
    --revisar)    MODO="revisar" ;;
    --listar)     MODO="listar" ;;
    --verificar)  MODO="verificar"; OBJETIVO="${2:?Falta la copia: --verificar respaldos/<fecha>}"; shift ;;
    -h|--help)    usage; exit 0 ;;
    *) die "Opción desconocida: $1 (usa --help)" ;;
  esac
  shift
done

[[ "$CONSERVAR" =~ ^[0-9]+$ && "$CONSERVAR" -ge 1 ]] || die "--conservar debe ser un número mayor que 0"
[[ -n "$SSH_KEY" ]] || SSH_KEY="$HOME/.ssh/agenia_${HOST//[.:]/_}_ed25519"

SSH_OPTS=(-i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=15
          -o ServerAliveInterval=20 -o ServerAliveCountMax=6 -o StrictHostKeyChecking=accept-new)
remoto() { ssh "${SSH_OPTS[@]}" "root@$HOST" "$@"; }
RSYNC_SSH="ssh -i '$SSH_KEY' -p $SSH_PORT -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=20 -o StrictHostKeyChecking=accept-new"

tam() {  # tamaño legible de un archivo o carpeta
  du -sh "$1" 2>/dev/null | awk '{print $1}'
}

# ── Limpieza al salir (también si algo falla a medias) ──────────────────────
PRUEBA_CONT=""; REMOTO_TMP=""; PARCIAL=""; CANDADO=""; TMP_LOCAL=""
limpiar() {
  local rc=$?
  [[ -n "$PRUEBA_CONT" ]] && docker rm -f "$PRUEBA_CONT" >/dev/null 2>&1 || true
  if [[ -n "$REMOTO_TMP" ]]; then
    remoto "case '$REMOTO_TMP' in /var/backups/agenia/para-local-*) rm -rf -- '$REMOTO_TMP' ;; esac" >/dev/null 2>&1 \
      || warn "No se pudo borrar $REMOTO_TMP en el servidor: bórrala a mano."
  fi
  # Una copia incompleta no sirve y lleva datos de pacientes: no se deja.
  [[ -n "$PARCIAL" && -d "$PARCIAL" ]] && rm -rf -- "$PARCIAL"
  [[ -n "$TMP_LOCAL" && -d "$TMP_LOCAL" ]] && rm -rf -- "$TMP_LOCAL"
  [[ -n "$CANDADO" ]] && rmdir "$CANDADO" 2>/dev/null || true
  exit "$rc"
}
trap limpiar EXIT
trap 'fail "Error en la línea $LINENO: $BASH_COMMAND"' ERR

# ═════════════════════════════════════════════════════════════════════════════
#  El trabajo en el servidor (bash del VPS). Recibe la fecha de la copia.
#  Escribe en la salida estándar solo líneas «· …» de avance y, al final,
#  «LISTO <carpeta>».
# ═════════════════════════════════════════════════════════════════════════════
read -r -d '' SCRIPT_REMOTO <<'REMOTO' || true
set -Eeuo pipefail
umask 077
STAMP="$1"
BASE=/var/backups/agenia
DIR="$BASE/para-local-$STAMP"
paso()  { printf '    · %s\n' "$*"; }
aviso() { printf '    ! %s\n' "$*"; }
falla() { printf '    ✘ %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || falla "Docker no está instalado en el servidor."
for c in agenia_db agenia_redis agenia_proxy; do
  [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || falla "El contenedor $c no está corriendo."
done
[ -f /opt/agenia/.env.production ] || falla "No existe /opt/agenia/.env.production."
grep -qE '^ENCRYPTION_KEY=[0-9a-fA-F]{64}$' /opt/agenia/.env.production \
  || falla ".env.production no trae una ENCRYPTION_KEY válida: sin ella la copia no sirve para restaurar."

install -d -m 700 "$BASE"
# Lo que haya dejado una ejecución cortada hace más de 12 horas.
find "$BASE" -maxdepth 1 -type d -name 'para-local-*' -mmin +720 -exec rm -rf {} + 2>/dev/null || true
[ ! -e "$DIR" ] || falla "Ya existe $DIR (¿otra copia en curso?)."
LIBRE_KB=$(df -Pk "$BASE" | awk 'NR==2 {print $4}')
[ "$LIBRE_KB" -gt 2097152 ] || falla "Menos de 2 GB libres en el disco del servidor: no se arma la copia."
mkdir -m 700 "$DIR"
cd "$DIR"

# ── 1. PostgreSQL ───────────────────────────────────────────────────────────
# Al archivo DENTRO del contenedor (no a un tubo): así el formato custom guarda
# las posiciones de cada tabla y pg_restore puede restaurar en paralelo.
paso "Base de datos: pg_dump…"
docker exec agenia_db sh -c 'rm -f /tmp/para-local.dump && exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/para-local.dump'
docker cp agenia_db:/tmp/para-local.dump ./db.dump >/dev/null
TABLAS_CON_DATOS=$(docker exec agenia_db pg_restore -l /tmp/para-local.dump | grep -c ' TABLE DATA ' || true)
docker exec agenia_db rm -f /tmp/para-local.dump
[ "$(wc -c < db.dump)" -gt 1048576 ] || falla "db.dump quedó en menos de 1 MB: algo falló."
[ "${TABLAS_CON_DATOS:-0}" -gt 20 ] || falla "db.dump trae solo ${TABLAS_CON_DATOS:-0} tablas con datos."
docker exec agenia_db sh -c 'exec pg_dumpall -U "$POSTGRES_USER" --roles-only' > roles.sql
docker exec agenia_db sh -c 'printf "POSTGRES_USER=%s\nPOSTGRES_DB=%s\n" "$POSTGRES_USER" "$POSTGRES_DB"' > bd.env
paso "Base: $(du -h db.dump | cut -f1), $TABLAS_CON_DATOS tablas con datos"

# ── 2. Redis ────────────────────────────────────────────────────────────────
# Estado de corta vida, pero barato de guardar. Si falla, la copia sigue.
paso "Redis: foto RDB…"
if docker exec agenia_redis sh -c 'rm -f /tmp/para-local.rdb; redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD" --no-auth-warning} --rdb /tmp/para-local.rdb >/dev/null 2>&1' \
   && docker cp agenia_redis:/tmp/para-local.rdb ./redis.rdb >/dev/null \
   && [ "$(head -c 5 redis.rdb)" = REDIS ]; then
  paso "Redis: $(du -h redis.rdb | cut -f1)"
else
  rm -f redis.rdb
  aviso "No se pudo sacar la foto de Redis: la copia sigue sin ella (lo permanente está en PostgreSQL)."
fi
docker exec agenia_redis rm -f /tmp/para-local.rdb >/dev/null 2>&1 || true

# ── 3. Configuración y secretos, con sus rutas del servidor ─────────────────
paso "Configuración y secretos…"
LISTA=()
for p in opt/agenia/.env.production opt/agenia/deploy/Caddyfile opt/agenia/deploy/install.conf \
         opt/agenia/deploy/secrets var/lib/agenia/alertas etc/ssh/sshd_config.d \
         etc/fail2ban/jail.local etc/fail2ban/jail.d root/.ssh/authorized_keys \
         home/agenia/.ssh/authorized_keys; do
  [ -e "/$p" ] && LISTA+=("$p")
done
for p in /etc/cron.d/agenia-* /etc/logrotate.d/agenia-* /etc/apt/apt.conf.d/*agenia*; do
  [ -e "$p" ] && LISTA+=("${p#/}")
done
# tar sale con 1 si un archivo cambió mientras lo leía (el vigía escribe su
# latido cada minuto): se acepta; cualquier otro código es un error.
rc=0; tar -C / --exclude='var/lib/agenia/alertas/vigia.lock' -czf config.tar.gz "${LISTA[@]}" || rc=$?
[ "$rc" -le 1 ] || falla "tar de la configuración salió con $rc"
# Sin -q: grep -q corta la lectura y, con pipefail, el tar cortado cuenta como fallo.
tar -tzf config.tar.gz | grep -x 'opt/agenia/.env.production' >/dev/null || falla "config.tar.gz no trae .env.production"
paso "Configuración: ${#LISTA[@]} rutas"

# ── 4. Volumen de Caddy: certificados y landing ─────────────────────────────
paso "Certificados y landing (agenia_caddy_data)…"
VOL=$(docker volume inspect -f '{{.Mountpoint}}' agenia_caddy_data)
case "$VOL" in /var/lib/docker/volumes/*/_data) ;; *) falla "Ruta inesperada del volumen de Caddy: $VOL" ;; esac
# tar sale con 1 si un archivo cambió mientras lo leía (Caddy renovando): se acepta.
rc=0; tar -C "$VOL" -czf caddy-data.tar.gz . || rc=$?
[ "$rc" -le 1 ] || falla "tar del volumen de Caddy salió con $rc"

# ── 5. Manifiesto ───────────────────────────────────────────────────────────
paso "Manifiesto…"
. /etc/os-release
{
  echo "# Copia de seguridad de AgenIA"
  echo "Fecha (Bogotá): $(TZ=America/Bogota date '+%Y-%m-%d %H:%M:%S')"
  echo "Servidor: $(hostname) — IP: $(hostname -I | awk '{print $1}')"
  echo "Sistema: $PRETTY_NAME, kernel $(uname -r), zona $(cat /etc/timezone 2>/dev/null || echo '?')"
  echo "Docker: $(docker --version | cut -d, -f1 | sed 's/Docker version //'), compose $(docker compose version --short 2>/dev/null || echo '?')"
  echo "CPU: $(nproc) · RAM: $(free -h | awk 'NR==2 {print $2}') · Disco /: $(df -h / | awk 'NR==2 {print $3" de "$2" ("$5")"}')"
  echo
  echo "## Versión desplegada (aviso de arranque de la API)"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' agenia_api 2>/dev/null | grep '^AGENIA_VERSION=' || echo "AGENIA_VERSION sin registrar"
  echo
  echo "## Contenedores"
  docker ps -a --filter name=agenia_ --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
  echo
  echo "## Imágenes"
  docker image ls --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' | grep -E '^(agenia-|postgres:|redis:|caddy:)' || true
  echo
  echo "## Volúmenes"
  for v in $(docker volume ls -q | grep '^agenia_'); do
    printf '%s\t%s\n' "$v" "$(du -sh "$(docker volume inspect -f '{{.Mountpoint}}' "$v")" 2>/dev/null | cut -f1)"
  done
  echo
  echo "## PostgreSQL"
  cat bd.env
  docker exec -i agenia_db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -XqtA -F " | "' <<'SQL'
SELECT 'versión', split_part(version(), ' on ', 1);
SELECT 'tamaño', pg_size_pretty(pg_database_size(current_database()));
SELECT 'tablas', count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
SELECT 'disparadores', count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public';
SELECT 'funciones', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public';
SELECT 'extensión', extname || ' ' || extversion FROM pg_extension ORDER BY extname;
SELECT 'rol', rolname || CASE WHEN rolsuper THEN ' (superusuario)' ELSE '' END FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname;
SELECT 'migraciones aplicadas', count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
SELECT 'última migración', migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1;
SQL
  echo "tablas con datos en db.dump | $TABLAS_CON_DATOS"
  echo
  echo "## Redis"
  echo "claves: $(docker exec agenia_redis sh -c 'redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD" --no-auth-warning} DBSIZE' 2>/dev/null || echo '?')"
  echo
  echo "## Claves de /opt/agenia/.env.production (sin valores)"
  grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' /opt/agenia/.env.production | tr -d '=' | tr '\n' ' '; echo
  echo
  echo "## Rutas en config.tar.gz"
  printf '/%s\n' "${LISTA[@]}"
  echo
  echo "## Sitios del Caddyfile real"
  grep -E '^[a-z0-9.-]+\.[a-z]{2,}([ ,].*)?\{' /opt/agenia/deploy/Caddyfile | sed 's/ *{$//' || true
  echo
  echo "## Cortafuegos"
  ufw status 2>/dev/null | sed -n '1,20p' || echo "ufw no disponible"
} > MANIFIESTO.txt

# Primero a un archivo fuera de la carpeta: así la lista no se incluye a sí misma.
sha256sum -- * > "$BASE/.huellas-$STAMP" && mv "$BASE/.huellas-$STAMP" SHA256SUMS
chmod 600 -- *
echo "LISTO $DIR"
REMOTO

# ═════════════════════════════════════════════════════════════════════════════
#  Utilidades locales
# ═════════════════════════════════════════════════════════════════════════════

# Filas por tabla, disparadores y funciones. La MISMA consulta se guarda en cada
# copia (conteos.sql): al restaurar en el VPS nuevo su resultado debe ser
# idéntico a CONTEOS.tsv (docs/emergencia/RESCATE_VPS.md, fase 9).
read -r -d '' SQL_CONTEOS <<'SQL' || true
SELECT '#disparadores', count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public';
SELECT '#funciones', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public';
SELECT c.relname,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY 1;
SQL

# Restaura db.dump en un PostgreSQL 15 desechable y escribe CONTEOS.tsv.
# Devuelve 0 si salió bien, 2 si no se pudo probar (sin Docker), 1 si falló.
probar_restauracion() {
  local dir="$1" salida="$2" usuario base
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    warn "Docker no está corriendo en este computador: no se probó la restauración."
    return 2
  fi
  usuario="$(awk -F= '$1=="POSTGRES_USER" {print $2}' "$dir/bd.env")"
  base="$(awk -F= '$1=="POSTGRES_DB" {print $2}' "$dir/bd.env")"
  [[ -n "$usuario" && -n "$base" ]] || { fail "bd.env no trae usuario y base."; return 1; }

  PRUEBA_CONT="agenia-prueba-restauracion-$$"
  info "PostgreSQL 15 desechable ($PRUEBA_CONT, sin red ni puertos)…"
  docker run -d --rm --name "$PRUEBA_CONT" --network none \
    -e POSTGRES_USER="$usuario" -e POSTGRES_PASSWORD=solo-prueba -e POSTGRES_DB="$base" \
    postgres:15-alpine >/dev/null || { fail "No arrancó el contenedor de prueba."; return 1; }
  # Por TCP a propósito: durante la inicialización la imagen levanta un servidor
  # temporal solo en el socket; el final es el único que escucha en 127.0.0.1.
  local i
  for i in $(seq 1 60); do
    docker exec "$PRUEBA_CONT" pg_isready -q -h 127.0.0.1 -U "$usuario" -d "$base" 2>/dev/null && break
    sleep 1
    [[ $i -eq 60 ]] && { fail "El PostgreSQL de prueba no quedó listo."; return 1; }
  done
  # (Dentro de `||` bash apaga `set -e` en la función: cada paso se comprueba a mano.)
  docker cp "$dir/db.dump" "$PRUEBA_CONT:/tmp/db.dump" >/dev/null || { fail "No se pudo copiar db.dump al contenedor."; return 1; }
  info "Restaurando db.dump…"
  if ! docker exec "$PRUEBA_CONT" pg_restore -U "$usuario" -d "$base" --exit-on-error --no-owner --no-acl -j 4 /tmp/db.dump; then
    fail "pg_restore falló: esta copia NO se puede restaurar tal cual."
    return 1
  fi
  docker exec -i "$PRUEBA_CONT" psql -U "$usuario" -d "$base" -v ON_ERROR_STOP=1 -XqtA -F $'\t' \
    > "$salida" <<<"$SQL_CONTEOS" || { fail "No se pudieron contar las filas de la copia restaurada."; return 1; }
  docker rm -f "$PRUEBA_CONT" >/dev/null 2>&1 || true
  PRUEBA_CONT=""
  local tablas filas
  tablas=$(grep -vc '^#' "$salida" || true)
  filas=$(awk -F'\t' '$1 !~ /^#/ {s+=$2} END {print s+0}' "$salida")
  (( tablas > 20 )) || { fail "La copia restaurada tiene solo $tablas tablas."; return 1; }
  ok "Restauración probada: $tablas tablas, $filas filas, $(awk -F'\t' '$1=="#disparadores" {print $2}' "$salida") disparadores"
  return 0
}

comprobar_huellas() {  # carpeta
  local salida
  if salida=$(cd "$1" && shasum -a 256 -c SHA256SUMS 2>&1); then
    ok "Huellas SHA-256 correctas ($(grep -c ': OK$' <<<"$salida") archivos)"
  else
    printf '%s\n' "$salida" | grep -v ': OK$' >&2
    return 1
  fi
}

pedir_frase() {
  if [[ -n "${AGENIA_RESPALDO_FRASE:-}" ]]; then return 0; fi
  [[ -t 0 ]] || die "Sin terminal para pedir la frase: define AGENIA_RESPALDO_FRASE."
  local a b
  read -r -s -p "  Frase para cifrar (mínimo 12 caracteres; sin ella NO se puede abrir la copia): " a; echo
  read -r -s -p "  Repite la frase: " b; echo
  [[ "$a" == "$b" ]] || die "Las frases no coinciden."
  (( ${#a} >= 12 )) || die "La frase debe tener al menos 12 caracteres."
  AGENIA_RESPALDO_FRASE="$a"; export AGENIA_RESPALDO_FRASE
}

openssl_con_pbkdf2() {
  openssl enc -help 2>&1 | grep pbkdf2 >/dev/null || die "Este openssl no trae -pbkdf2 (instala uno reciente: brew install openssl)."
}

# Copias terminadas, de la más vieja a la más nueva (carpetas <fecha> y
# archivos <fecha>.tar.gz.enc; nunca las .parcial ni las .prueba-fallida).
listar_copias() {
  ( cd "$DESTINO" 2>/dev/null && ls -1d 20[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9] \
      20[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].tar.gz.enc 2>/dev/null ) | sort || true
}

# ── --listar ────────────────────────────────────────────────────────────────
if [[ "$MODO" == "listar" ]]; then
  [[ -d "$DESTINO" ]] || die "No hay copias en $DESTINO."
  head1 "Copias en $DESTINO"
  hay=0
  for e in $(listar_copias); do
    hay=1
    if [[ "$e" == *.enc ]]; then
      printf '  %s  %6s  cifrada\n' "$e" "$(tam "$DESTINO/$e")"
    else
      estado="sin probar la restauración"
      [[ -f "$DESTINO/$e/CONTEOS.tsv" ]] && estado="restauración probada"
      printf '  %s  %6s  %s\n' "$e" "$(tam "$DESTINO/$e")" "$estado"
    fi
  done
  (( hay )) || info "Ninguna todavía."
  [[ -L "$DESTINO/ultimo" ]] && info "ultimo → $(readlink "$DESTINO/ultimo")"
  exit 0
fi

# ── --verificar ─────────────────────────────────────────────────────────────
if [[ "$MODO" == "verificar" ]]; then
  objetivo="$OBJETIVO"
  [[ -e "$objetivo" ]] || die "No existe $objetivo"
  # respaldos/ultimo es un enlace: se sigue para saber si es carpeta o archivo cifrado.
  [[ -L "$objetivo" ]] && objetivo="$(dirname "$objetivo")/$(readlink "$objetivo")"
  printf '%s%s AgenIA — verificación de %s %s\n' "$B" "$BOLD" "$objetivo" "$N"
  if [[ -f "$objetivo" && "$objetivo" == *.tar.gz.enc ]]; then
    openssl_con_pbkdf2; pedir_frase
    if [[ -f "$objetivo.sha256" ]]; then
      (cd "$(dirname "$objetivo")" && shasum -a 256 -c "$(basename "$objetivo").sha256" >/dev/null) \
        || die "La huella del archivo cifrado no coincide: está dañado."
      ok "Huella del archivo cifrado correcta"
    fi
    TMP_LOCAL="$(mktemp -d "${TMPDIR:-/tmp}/agenia-verificar.XXXXXX")"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:AGENIA_RESPALDO_FRASE -in "$objetivo" \
      | tar -xzf - -C "$TMP_LOCAL" || die "No se pudo descifrar (¿frase equivocada?)."
    carpeta="$(find "$TMP_LOCAL" -mindepth 1 -maxdepth 1 -type d | head -1)"
  else
    carpeta="$(cd "$objetivo" && pwd -P)"
  fi
  comprobar_huellas "$carpeta" || die "Huellas que no coinciden: la copia está dañada."
  [[ $SIN_PRUEBA -eq 1 ]] && { ok "Huellas bien (--sin-prueba: no se restauró)."; exit 0; }
  nuevos="$(mktemp "${TMPDIR:-/tmp}/agenia-conteos.XXXXXX")"
  rc=0; probar_restauracion "$carpeta" "$nuevos" || rc=$?
  if [[ $rc -ne 0 ]]; then
    rm -f "$nuevos"
    [[ $rc -eq 2 ]] && warn "Las huellas están bien; falta la prueba de restauración (enciende Docker y repite)."
    exit "$rc"
  fi
  if [[ -f "$carpeta/CONTEOS.tsv" ]]; then
    if cmp -s "$carpeta/CONTEOS.tsv" "$nuevos"; then
      ok "Los conteos coinciden con los que se guardaron al hacer la copia"
    else
      diff "$carpeta/CONTEOS.tsv" "$nuevos" | head -20 >&2
      rm -f "$nuevos"; die "Los conteos NO coinciden con CONTEOS.tsv."
    fi
  elif [[ -d "$objetivo" && -w "$carpeta" ]]; then
    cp "$nuevos" "$carpeta/CONTEOS.tsv" && chmod 600 "$carpeta/CONTEOS.tsv"
    (cd "$carpeta" && shasum -a 256 CONTEOS.tsv >> SHA256SUMS)
    ok "CONTEOS.tsv guardado en la copia"
  fi
  rm -f "$nuevos"
  ok "Copia sana: se puede usar para restaurar (docs/emergencia/RESCATE_VPS.md)."
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
#  --revisar y la copia
# ═════════════════════════════════════════════════════════════════════════════
STAMP="$(TZ=America/Bogota date +%Y%m%d-%H%M%S)"
printf '%s%s AgenIA — copia de seguridad de %s %s\n' "$B" "$BOLD" "$HOST" "$N"
info "Llave SSH: $SSH_KEY"
info "Destino:   $DESTINO"

head1 "Comprobaciones"
[[ -f "$SSH_KEY" ]] || die "No existe la llave SSH $SSH_KEY (pasa --ssh-key <ruta>)."
for b in ssh rsync shasum tar; do command -v "$b" >/dev/null || die "Falta '$b' en este computador."; done
remoto true 2>/dev/null || die "No se pudo entrar por SSH a root@$HOST con la llave (¿IP, llave o fail2ban?)."
ok "Acceso SSH a root@$HOST"
estado_remoto="$(remoto "for c in agenia_db agenia_redis agenia_api agenia_web agenia_proxy; do printf '%s=%s ' \"\$c\" \"\$(docker inspect -f '{{.State.Status}}' \"\$c\" 2>/dev/null || echo ausente)\"; done; df -h / | awk 'NR==2 {print \"· disco \"\$5\" usado, \"\$4\" libres\"}'")"
info "Servidor: $estado_remoto"
grep -q 'agenia_db=running' <<<"$estado_remoto" || die "La base (agenia_db) no está corriendo en el servidor."

mkdir -p "$DESTINO"; chmod 700 "$DESTINO"
libre_kb=$(df -Pk "$DESTINO" | awk 'NR==2 {print $4}')
(( libre_kb > 1048576 )) || die "Menos de 1 GB libre en $DESTINO."
ok "Espacio local: $(( libre_kb / 1024 / 1024 )) GB libres"

if [[ $CIFRAR -eq 1 ]]; then
  openssl_con_pbkdf2
elif [[ "$(uname)" == Darwin ]] && ! fdesetup status 2>/dev/null | grep -q 'FileVault is On'; then
  warn "FileVault está APAGADO: la copia (datos de pacientes y secretos) quedaría sin cifrar en el disco."
  warn "Enciéndelo o usa --cifrar."
fi

if [[ "$MODO" == "revisar" ]]; then
  ok "Todo listo para copiar (--revisar: no se copió nada)."
  exit 0
fi
[[ $CIFRAR -eq 1 ]] && pedir_frase

CANDADO="$DESTINO/.en-curso"
mkdir "$CANDADO" 2>/dev/null || { CANDADO=""; die "Hay otra copia en curso (si no es así, borra $DESTINO/.en-curso)."; }

# ── En el servidor ──────────────────────────────────────────────────────────
head1 "1/4 · Armando la copia en el servidor"
REMOTO_TMP="/var/backups/agenia/para-local-$STAMP"
salida_remota="$(remoto "bash -s -- '$STAMP'" <<<"$SCRIPT_REMOTO" | tee /dev/stderr)" \
  || die "Falló en el servidor (ver arriba). No quedó ninguna copia local."
grep -q "^LISTO $REMOTO_TMP\$" <<<"$salida_remota" || die "El servidor no confirmó la copia."
ok "Copia armada en $REMOTO_TMP"

# ── Traerla ─────────────────────────────────────────────────────────────────
head1 "2/4 · Trayéndola por SSH"
FINAL="$DESTINO/$STAMP"
PARCIAL="$FINAL.parcial"
rsync -a --partial -e "$RSYNC_SSH" "root@$HOST:$REMOTO_TMP/" "$PARCIAL/"
chmod 700 "$PARCIAL"; chmod 600 "$PARCIAL"/*
comprobar_huellas "$PARCIAL" || die "Huellas que no coinciden: la copia llegó dañada y se descarta."
printf 'Para restaurar: docs/emergencia/RESCATE_VPS.md del repositorio.\nVerificar esta copia: ./respaldo.sh --verificar respaldos/%s\n' "$STAMP" > "$PARCIAL/LEAME.txt"
printf '%s\n' "$SQL_CONTEOS" > "$PARCIAL/conteos.sql"
chmod 600 "$PARCIAL/LEAME.txt" "$PARCIAL/conteos.sql"
(cd "$PARCIAL" && shasum -a 256 conteos.sql >> SHA256SUMS)
ok "$(tam "$PARCIAL") traídos y verificados"

head1 "3/4 · Limpiando el servidor"
remoto "case '$REMOTO_TMP' in /var/backups/agenia/para-local-*) rm -rf -- '$REMOTO_TMP' ;; esac"
REMOTO_TMP=""
ok "Carpeta temporal borrada del servidor"

# ── Prueba de restauración ──────────────────────────────────────────────────
head1 "4/4 · Prueba de restauración"
PROBADA="no"
if [[ $SIN_PRUEBA -eq 1 ]]; then
  warn "--sin-prueba: no se restauró (luego: ./respaldo.sh --verificar respaldos/$STAMP)."
else
  rc=0; probar_restauracion "$PARCIAL" "$PARCIAL/CONTEOS.tsv" || rc=$?
  case $rc in
    0) chmod 600 "$PARCIAL/CONTEOS.tsv"; (cd "$PARCIAL" && shasum -a 256 CONTEOS.tsv >> SHA256SUMS); PROBADA="sí" ;;
    2) rm -f "$PARCIAL/CONTEOS.tsv"
       warn "Cuando enciendas Docker: ./respaldo.sh --verificar respaldos/$STAMP" ;;
    *) # Se guarda aparte (puede ser la única copia), pero NO pasa a ser «ultimo».
       rm -f "$PARCIAL/CONTEOS.tsv"; mv "$PARCIAL" "$FINAL.prueba-fallida"; PARCIAL=""
       die "La copia no se pudo restaurar: quedó aparte en $FINAL.prueba-fallida y «ultimo» no cambió. Revisa el error de pg_restore arriba." ;;
  esac
fi

mv "$PARCIAL" "$FINAL"; PARCIAL=""
ENTRADA="$STAMP"

if [[ $CIFRAR -eq 1 ]]; then
  info "Cifrando (AES-256, PBKDF2 600 000 vueltas)…"
  # Si el cifrado falla, la carpeta en claro se conserva: es la copia.
  if ! tar -C "$DESTINO" -czf - "$STAMP" \
       | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:AGENIA_RESPALDO_FRASE -out "$FINAL.tar.gz.enc" \
     || ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:AGENIA_RESPALDO_FRASE -in "$FINAL.tar.gz.enc" \
       | tar -tzf - >/dev/null; then
    rm -f "$FINAL.tar.gz.enc"
    ln -sfn "$STAMP" "$DESTINO/ultimo"
    die "No se pudo cifrar: la copia quedó SIN cifrar en $FINAL."
  fi
  (cd "$DESTINO" && shasum -a 256 "$STAMP.tar.gz.enc" > "$STAMP.tar.gz.enc.sha256")
  chmod 600 "$FINAL.tar.gz.enc" "$FINAL.tar.gz.enc.sha256"
  rm -rf -- "$FINAL"
  ENTRADA="$STAMP.tar.gz.enc"
  ok "Cifrada: $ENTRADA ($(tam "$DESTINO/$ENTRADA")). Guarda la frase en el gestor de contraseñas."
fi

ln -sfn "$ENTRADA" "$DESTINO/ultimo"

# ── Retención ───────────────────────────────────────────────────────────────
copias="$(listar_copias)"
total=$(printf '%s\n' "$copias" | grep -c . || true)
if (( total > CONSERVAR )); then
  printf '%s\n' "$copias" | head -n $(( total - CONSERVAR )) | while read -r vieja; do
    [[ -n "$vieja" && "$vieja" != "$ENTRADA" ]] || continue
    rm -rf -- "${DESTINO:?}/$vieja" "${DESTINO:?}/$vieja.sha256"
    info "Borrada la copia vieja $vieja"
  done
fi

cat <<EOF

${G}${BOLD}Copia lista.${N} $DESTINO/$ENTRADA
  Restauración probada: $PROBADA
  Copias guardadas: $(( total > CONSERVAR ? CONSERVAR : total )) (se conservan las últimas $CONSERVAR)
  ${D}Restaurar en un VPS nuevo: docs/emergencia/RESCATE_VPS.md${N}
  ${Y}Lleva datos de pacientes y todos los secretos: no la subas a ningún lado sin cifrar (--cifrar).${N}
EOF

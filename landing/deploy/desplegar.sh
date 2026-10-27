#!/usr/bin/env bash
# =============================================================================
#  AgenIA — publicar la landing (agenia.co)
# =============================================================================
#  Se ejecuta EN TU COMPUTADOR desde la raíz del repo:
#
#    bash landing/deploy/desplegar.sh                       # deploy@173.249.12.226
#    bash landing/deploy/desplegar.sh --host usuario@ip     # otro servidor
#    bash landing/deploy/desplegar.sh --dry-run             # solo muestra el rsync
#
#  1. Sube los archivos de la landing a /srv/agenia-landing (sin scripts de
#     desarrollo ni el pulso local: el del servidor se conserva).
#  2. Actualiza el pulso de la salud allá mismo (scripts/pulso-cron.sh: Node si
#     lo hay; si no, Docker).
#  3. Instala el cron de las 6 a. m. de Colombia, en la hora del servidor.
#
#  No toca Caddy: el bloque está en landing/deploy/Caddyfile.ejemplo y se agrega
#  una sola vez, a mano, con respaldo y validación.
# =============================================================================
set -euo pipefail

HOST="deploy@173.249.12.226"
DESTINO="/srv/agenia-landing"
DRY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?}"; shift ;;
    --destino) DESTINO="${2:?}"; shift ;;
    --dry-run) DRY="--dry-run" ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

ORIGEN="$(cd "$(dirname "$0")/.." && pwd)/"
echo "── Landing: $ORIGEN → $HOST:$DESTINO"

ssh "$HOST" "mkdir -p '$DESTINO/data'"
rsync -az --delete $DRY \
  --exclude '.gitignore' --exclude 'data/pulso.json' --exclude 'data/*.tmp' \
  --exclude 'deploy/' --exclude 'README.md' --exclude 'scripts/servir.mjs' --exclude 'scripts/*.test.mjs' \
  "$ORIGEN" "$HOST:$DESTINO/"

[[ -n "$DRY" ]] && { echo "--dry-run: no se ejecutó nada más."; exit 0; }

echo "── Pulso de la salud"
ssh "$HOST" "bash '$DESTINO/scripts/pulso-cron.sh'"

# 6:00 a. m. en Colombia (UTC-5 todo el año) en la hora del reloj del servidor.
OFFSET=$(ssh "$HOST" "date +%z")                     # p. ej. +0000
SIGNO=${OFFSET:0:1}; HH=$((10#${OFFSET:1:2}))
[[ "$SIGNO" == "-" ]] && HH=$((-HH))
HORA=$(( (11 + HH + 24) % 24 ))
echo "── Cron: todos los días a las ${HORA}:00 del servidor (UTC${OFFSET}) = 6:00 a. m. en Colombia"
LINEA="0 $HORA * * * bash $DESTINO/scripts/pulso-cron.sh >> /tmp/agenia-pulso.log 2>&1"
ssh "$HOST" "( crontab -l 2>/dev/null | grep -v 'pulso-cron.sh' ; echo '$LINEA' ) | crontab - && crontab -l | grep pulso-cron.sh"

echo "Listo. Si es la primera vez, agrega el bloque de landing/deploy/Caddyfile.ejemplo al Caddy del servidor."

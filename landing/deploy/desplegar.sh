#!/usr/bin/env bash
# =============================================================================
#  AgenIA — publicar la landing (agenia.co)
# =============================================================================
#  Se ejecuta EN TU COMPUTADOR desde la raíz del repo:
#
#    bash landing/deploy/desplegar.sh               # el VPS de update.sh
#    bash landing/deploy/desplegar.sh --dry-run     # solo muestra el rsync
#
#  La landing la sirve el MISMO Caddy del servidor (contenedor agenia_proxy)
#  desde la subcarpeta landing/ de su volumen de datos (/data/landing dentro del
#  contenedor). Así no hay contenedor ni red nuevos y no se reinicia nada de lo
#  que está en producción. Pasos:
#
#  1. Sube los archivos a <volumen agenia_caddy_data>/landing (sin la
#     documentación ni los scripts de desarrollo; el pulso del servidor se
#     conserva).
#  2. Actualiza el pulso de la salud allá mismo (scripts/pulso-cron.sh, con la
#     imagen oficial de Node en Docker si el servidor no tiene Node).
#  3. Instala /etc/cron.d/agenia-landing-pulso: 6:00 a. m. de Colombia.
#
#  No toca Caddy: el bloque de agenia.co está en deploy/Caddyfile.ejemplo y se
#  agrega una sola vez, con respaldo, validación y recarga (docs/INSTALACION_VPS.md §16).
# =============================================================================
set -euo pipefail

HOST="root@89.117.61.28"
LLAVE="$HOME/.ssh/agenia_89_117_61_28_ed25519"
VOLUMEN="agenia_caddy_data"
DRY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?}"; shift ;;
    --ssh-key) LLAVE="${2:?}"; shift ;;
    --dry-run) DRY="--dry-run" ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

SSH=(ssh -i "$LLAVE" -o ConnectTimeout=15)
ORIGEN="$(cd "$(dirname "$0")/.." && pwd)/"

BASE=$("${SSH[@]}" "$HOST" "docker volume inspect $VOLUMEN --format '{{.Mountpoint}}'")
DESTINO="$BASE/landing"
# rsync --delete SOLO dentro de .../_data/landing: en la raíz del volumen están
# los certificados de Caddy.
if [[ "$BASE" != /var/lib/docker/volumes/*/_data || "$DESTINO" != */_data/landing ]]; then
  echo "Destino inesperado ($DESTINO): no se sube nada." >&2
  exit 1
fi
echo "── Landing: $ORIGEN → $HOST:$DESTINO"

"${SSH[@]}" "$HOST" "mkdir -p '$DESTINO/data'"
rsync -az --delete $DRY -e "ssh -i $LLAVE -o ConnectTimeout=15" \
  --exclude '.gitignore' --exclude 'data/pulso.json' --exclude 'data/*.tmp' \
  --exclude 'deploy/' --exclude 'README.md' --exclude 'scripts/servir.mjs' --exclude 'scripts/*.test.mjs' \
  --exclude '.DS_Store' \
  "$ORIGEN" "$HOST:$DESTINO/"

[[ -n "$DRY" ]] && { echo "--dry-run: no se ejecutó nada más."; exit 0; }

echo "── Pulso de la salud"
"${SSH[@]}" "$HOST" "bash '$DESTINO/scripts/pulso-cron.sh'"

# 6:00 a. m. en Colombia (UTC-5 todo el año) en la hora del reloj del servidor.
OFFSET=$("${SSH[@]}" "$HOST" "date +%z")
SIGNO=${OFFSET:0:1}; HH=$((10#${OFFSET:1:2}))
[[ "$SIGNO" == "-" ]] && HH=$((-HH))
HORA=$(( (11 + HH + 24) % 24 ))
echo "── Cron: todos los días a las ${HORA}:00 del servidor (UTC${OFFSET}) = 6:00 a. m. en Colombia"
"${SSH[@]}" "$HOST" "cat > /etc/cron.d/agenia-landing-pulso <<EOF
# Pulso de la salud de la landing agenia.co (landing/scripts/pulso-cron.sh).
# Lo instala landing/deploy/desplegar.sh; se puede borrar sin afectar el panel.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 $HORA * * * root bash $DESTINO/scripts/pulso-cron.sh >> /var/log/agenia-landing-pulso.log 2>&1
EOF
chmod 644 /etc/cron.d/agenia-landing-pulso && cat /etc/cron.d/agenia-landing-pulso | tail -1"

echo "Listo."

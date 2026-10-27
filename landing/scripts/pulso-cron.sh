#!/usr/bin/env bash
# Lo llama el cron del servidor cada mañana (deploy/desplegar.sh lo instala):
# actualiza data/pulso.json con Node del sistema o, si no hay, con la imagen
# oficial de Node en Docker (solo lee internet y escribe en data/).
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  node scripts/actualizar-pulso.mjs
else
  docker run --rm -v "$PWD":/landing -w /landing node:22-alpine node scripts/actualizar-pulso.mjs
fi

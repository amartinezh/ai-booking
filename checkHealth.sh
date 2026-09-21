#!/usr/bin/env bash
# =============================================================================
# checkHealth.sh — atajo desde la raíz para auditar la salud del espejo desde
# TU PORTÁTIL (lado nube).
#
# POR QUÉ EXISTE ESTE ATAJO
# El script real vive en la carpeta del driver
# (docs/drivers/<driver>/checkHealth.sh) porque el `organizationId` y la IP son
# de ese hospital. Los mensajes de otros scripts dicen «./checkHealth.sh», y eso
# solo funcionaba si ya estabas dentro de esa carpeta. Con este atajo funciona
# igual desde la raíz del repo, que es donde uno está casi siempre.
#
# QUÉ HACE (todo de SOLO LECTURA, nada de UPDATE/DELETE): entra por SSH al VPS
# de la NUBE y revisa la configuración del espejo, la cola de sincronización y
# sus dead-letters, la cobertura de homologación, las últimas reconciliaciones y
# pasadas de agenda, el padrón, y la salud del stack Docker. Al final imprime
# —sin ejecutarlos— los comandos que faltan correr del lado del hospital.
#
# LO QUE NO PUEDE VER: el agente vive en el VPS del hospital, inalcanzable desde
# fuera de su LAN. Para ese lado está `checkHealthAgente.sh`, que se corre ALLÁ.
#
# DÓNDE QUEDA EL INFORME
# El script escribe `checkHealth-<fecha>.txt` en el directorio desde donde corre.
# Este atajo entra primero a la carpeta del driver a propósito, para que los
# informes se acumulen junto a los anteriores (son la evidencia histórica de ese
# hospital) y no queden sueltos en la raíz del repo.
#
# REQUISITOS
#   · La llave SSH del VPS de la nube: ~/.ssh/agenia_89_117_61_28_ed25519
#     (o la que indiques con MIRROR_SSH_KEY).
#   · No necesita el túnel ni contraseñas de Postgres: corre dentro del propio
#     contenedor, por `docker compose exec`.
#
# USO
#   ./checkHealth.sh
#   MIRROR_ORG_ID=<otro-id> ./checkHealth.sh          # otra clínica
#   MIRROR_DRIVER=<otro-driver> ./checkHealth.sh      # otro hospital
#
# Las demás variables del script del driver (MIRROR_SSH_KEY, MIRROR_VPS_IP,
# MIRROR_REMOTE_DIR) se reenvían tal cual.
# =============================================================================
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIRROR_DRIVER="${MIRROR_DRIVER:-cnt-sanvicente-anserma}"
DRIVER_DIR="$REPO_ROOT/docs/drivers/$MIRROR_DRIVER"
SCRIPT="$DRIVER_DIR/checkHealth.sh"

if [[ ! -f "$SCRIPT" ]]; then
  printf '✘ No existe el script del driver "%s":\n    %s\n' "$MIRROR_DRIVER" "$SCRIPT" >&2
  printf '  Drivers disponibles:\n' >&2
  for d in "$REPO_ROOT"/docs/drivers/*/; do
    [[ -f "$d/checkHealth.sh" ]] && printf '    · %s\n' "$(basename "$d")" >&2
  done
  exit 1
fi

# El informe se escribe en el directorio actual: se entra a la carpeta del
# driver para que quede con los anteriores.
cd "$DRIVER_DIR"
printf '💻 Auditoría del espejo (lado nube) · driver %s\n' "$MIRROR_DRIVER"
printf '   El informe queda en docs/drivers/%s/\n\n' "$MIRROR_DRIVER"
exec bash ./checkHealth.sh "$@"

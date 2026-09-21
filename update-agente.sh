#!/usr/bin/env bash
# =============================================================================
# update-agente.sh — atajo desde la raíz para preparar la actualización del
# agente del espejo (mirror-agent).
#
# ⚠️ NO CONFUNDIR CON ./update.sh
#   · ./update.sh         → actualiza el VPS de la NUBE (web + api), por SSH.
#                           Es automático porque ese VPS sí es alcanzable.
#   · ./update-agente.sh  → prepara el bundle del agente que corre en el VPS del
#                           HOSPITAL. La transmisión es MANUAL a propósito: hoy
#                           ese VPS (192.168.1.175) no se alcanza desde fuera de
#                           la red del hospital, solo por AnyDesk contra su
#                           estación Windows. Este script hace todo lo que SÍ se
#                           puede automatizar y te imprime el resto.
#
# No duplica lógica: delega en el script del driver
# (docs/drivers/<driver>/prepararActualizacionAgente.sh), que compila
# `@agenia/shared`, genera el bundle, lo valida con `node --check`, calcula
# tamaño y sha256, e imprime los pasos de transmisión y la instalación en el VPS
# del hospital. Ver también docs/drivers/<driver>/COMPILAR_Y_ACTUALIZAR.md.
#
# Por qué el driver es un parámetro: el BUNDLE es genérico (lleva todos los
# drivers dentro y el `driverKey` se elige en tiempo de ejecución); lo que es de
# cada hospital son las rutas, el usuario y la IP de SU VPS, y eso vive en su
# carpeta de driver.
#
# USO
#   ./update-agente.sh                       # driver por defecto (el único hoy)
#   MIRROR_DRIVER=<otro-driver> ./update-agente.sh
#
# Las variables que acepta el script del driver (IP, usuario, rutas) se pasan
# igual por entorno: se reenvían tal cual.
#
# ⏱️ ORDEN DE DESPLIEGUE. Si esta actualización del agente va junto con cambios
# de la nube, primero la API: un agente NUEVO contra una API VIEJA sondea rutas
# que no existen y registra un error cada pocos segundos (CONSULTA_EN_VIVO.md).
# El orden completo es: migración → API → agente → web.
# =============================================================================
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIRROR_DRIVER="${MIRROR_DRIVER:-cnt-sanvicente-anserma}"
SCRIPT="$REPO_ROOT/docs/drivers/$MIRROR_DRIVER/prepararActualizacionAgente.sh"

if [[ ! -f "$SCRIPT" ]]; then
  printf '✘ No existe el script del driver "%s":\n    %s\n' "$MIRROR_DRIVER" "$SCRIPT" >&2
  printf '  Drivers disponibles:\n' >&2
  for d in "$REPO_ROOT"/docs/drivers/*/; do
    [[ -f "$d/prepararActualizacionAgente.sh" ]] && printf '    · %s\n' "$(basename "$d")" >&2
  done
  exit 1
fi

exec bash "$SCRIPT" "$@"

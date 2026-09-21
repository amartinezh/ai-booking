#!/usr/bin/env bash
# =============================================================================
# prepararActualizacionAgente.sh — compila el bundle nuevo de mirror-agent y
# te dice, paso a paso, cómo transmitirlo al VPS del hospital.
#
# Corre TODO en tu portátil — nunca toca el VPS del hospital ni el de la
# nube. La transmisión sigue siendo manual porque hoy `192.168.1.175` (el
# VPS del hospital) no es alcanzable desde fuera de su red: solo se llega por
# AnyDesk contra la estación Windows (ver Escenario B más abajo). Este script
# no finge automatizar esa parte — hace lo que SÍ se puede automatizar
# (compilar, validar, calcular el checksum) y te imprime el resto, listo para
# copiar y pegar (COMPILAR_Y_ACTUALIZAR.md §4).
#
# QUÉ HACE:
#   1. `pnpm --filter @agenia/shared build` — el agente depende de shared.
#   2. `pnpm --filter @agenia/mirror-agent bundle` — genera agent.bundle.js.
#   3. `node --check` sobre el bundle — lo mismo que valida
#      actualizarAgente.sh DEL OTRO LADO, pero aquí y antes de transmitir
#      nada: si el bundle sale roto, te enteras ahora, no después de una
#      transferencia por AnyDesk que tarda varios minutos.
#   4. Calcula tamaño y sha256 del bundle — con eso puedes confirmar en el
#      VPS del hospital que la transferencia llegó completa, sin adivinar
#      (fue justo una transferencia truncada por AnyDesk el incidente que
#      motivó los chequeos de actualizarAgente.sh, ver su cabecera).
#   5. Imprime los pasos de transmisión (Escenario A: SSH directo — Escenario
#      B: AnyDesk, el caso de hoy en Anserma) con las rutas/usuarios reales
#      ya puestos, y el recordatorio de correr `actualizarAgente.sh` al final.
#
# QUÉ NO HACE: no se conecta al VPS del hospital, no copia nada, no reinicia
# el servicio. Esos pasos son manuales por diseño (o por `actualizarAgente.sh`
# una vez el bundle ya está en /tmp del VPS del hospital).
#
# USO
#   ./prepararActualizacionAgente.sh
#
# Variables de entorno (todas opcionales, ya traen el valor real de Anserma):
#   MIRROR_VPS_IP        IP del VPS del hospital       (192.168.1.175)
#   MIRROR_VPS_USER       usuario SSH en ese VPS         (data)
#   MIRROR_DEST_PATH      destino final del bundle       (/opt/agenia-mirror-agent/dist/index.js)
#   MIRROR_SERVICE_USER   dueño del archivo instalado     (mirroragent)
#   WINDOWS_STATION_IP    estación Windows del AnyDesk    (192.168.1.25)
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

MIRROR_VPS_IP="${MIRROR_VPS_IP:-192.168.1.175}"
MIRROR_VPS_USER="${MIRROR_VPS_USER:-data}"
MIRROR_DEST_PATH="${MIRROR_DEST_PATH:-/opt/agenia-mirror-agent/dist/index.js}"
MIRROR_SERVICE_USER="${MIRROR_SERVICE_USER:-mirroragent}"
WINDOWS_STATION_IP="${WINDOWS_STATION_IP:-192.168.1.25}"

BUNDLE="$REPO_ROOT/apps/mirror-agent/dist/agent.bundle.js"

if [[ -t 1 ]]; then
  G=$'\033[0;32m'; Y=$'\033[0;33m'; R=$'\033[0;31m'; B=$'\033[1;34m'
  C=$'\033[0;36m'; D=$'\033[2m'; BOLD=$'\033[1m'; N=$'\033[0m'
else G=''; Y=''; R=''; B=''; C=''; D=''; BOLD=''; N=''; fi
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
info() { printf '  %s·%s %s\n' "$C" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail() { printf '  %s✘%s %s\n' "$R" "$N" "$*" >&2; }
head1(){ printf '\n%s── %s%s\n' "$B" "$*" "$N"; }
die()  { fail "$*"; exit 1; }
on_err() { fail "Error (código $1) en la línea $2: $3"; }
trap 'on_err "$?" "$LINENO" "$BASH_COMMAND"' ERR

printf '%s%s Preparando actualización de mirror-agent %s\n' "$B" "$BOLD" "$N"
cd "$REPO_ROOT"

# ── 1. Compilar shared (dependencia del agente) ─────────────────────────────
head1 "1/4 · Compilando @agenia/shared"
pnpm --filter @agenia/shared build
ok "shared compilado"

# ── 2. Generar el bundle del agente ─────────────────────────────────────────
head1 "2/4 · Generando el bundle de mirror-agent"
pnpm --filter @agenia/mirror-agent bundle
[[ -f "$BUNDLE" ]] || die "El bundle no apareció en $BUNDLE — revisa el log de esbuild arriba."
ok "Bundle generado: $BUNDLE"

# ── 3. Validar sintaxis ANTES de transmitir nada ────────────────────────────
head1 "3/4 · Validando el bundle"
command -v node >/dev/null 2>&1 || die "No hay 'node' en el PATH — no se puede validar el bundle."
if node --check "$BUNDLE"; then
  ok "Sintaxis válida (node --check)"
else
  die "El bundle no pasó 'node --check' — no lo transmitas así. Revisa el build."
fi

# ── 4. Tamaño y checksum ─────────────────────────────────────────────────────
head1 "4/4 · Huella del bundle (para confirmar la transferencia después)"
SIZE="$(wc -c < "$BUNDLE" | tr -d ' ')"
if command -v sha256sum >/dev/null 2>&1; then
  SHA="$(sha256sum "$BUNDLE" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  SHA="$(shasum -a 256 "$BUNDLE" | awk '{print $1}')"
else
  SHA=""; warn "No hay sha256sum ni shasum disponible — se omite el checksum."
fi
info "Tamaño: ${SIZE} bytes"
[[ -n "$SHA" ]] && info "SHA-256: $SHA"

# ── Pasos de transmisión ─────────────────────────────────────────────────────
cat <<EOF

${BOLD}${B}Bundle listo. Falta transmitirlo al VPS del hospital — esto es manual.${N}

${BOLD}Escenario A · acceso SSH directo${N} ${D}(Tailscale configurado, o tu portátil${N}
${D}en la LAN del hospital)${N}

  scp "$BUNDLE" ${MIRROR_VPS_USER}@${MIRROR_VPS_IP}:/tmp/
  ssh ${MIRROR_VPS_USER}@${MIRROR_VPS_IP} "sudo install -o ${MIRROR_SERVICE_USER} -g ${MIRROR_SERVICE_USER} -m 0755 \\
    /tmp/agent.bundle.js ${MIRROR_DEST_PATH} && rm /tmp/agent.bundle.js"

  ${D}O, más simple, deja el bundle en /tmp y usa el atajo (ver abajo).${N}

${BOLD}Escenario B · solo AnyDesk${N} ${D}(el caso de hoy en Anserma: $MIRROR_VPS_IP no es${N}
${D}alcanzable desde tu red)${N}

  1. En la sesión de AnyDesk contra la estación Windows ($WINDOWS_STATION_IP),
     usa el panel de transferencia de archivos para copiar
     ${BOLD}agent.bundle.js${N} (está en $BUNDLE) al escritorio de esa Windows.
  2. Desde esa misma Windows (PowerShell trae scp integrado):
       scp .\\agent.bundle.js ${MIRROR_VPS_USER}@${MIRROR_VPS_IP}:/tmp/
  3. Ya en el VPS (por SSH desde la Windows, o directo si tu red lo permite):
       sudo install -o ${MIRROR_SERVICE_USER} -g ${MIRROR_SERVICE_USER} -m 0755 \\
         /tmp/agent.bundle.js ${MIRROR_DEST_PATH}
       rm /tmp/agent.bundle.js

${BOLD}Después de copiarlo (cualquiera de los dos escenarios):${N}

  ${D}Confirma que llegó completo — compara con lo impreso arriba:${N}
    sha256sum /tmp/agent.bundle.js   ${D}# Linux${N}
    shasum -a 256 /tmp/agent.bundle.js   ${D}# macOS${N}

  ${D}Atajo recomendado — hace la instalación, el reinicio y la verificación${N}
  ${D}de una vez, con rollback disponible si algo sale mal (ver su cabecera):${N}
    ${BOLD}./actualizarAgente.sh${N}          ${D}# 🏥 en el VPS del hospital, con el bundle en /tmp${N}

  ${D}O a mano, si prefieres ir paso a paso (COMPILAR_Y_ACTUALIZAR.md §4.3-§4.4):${N}
    sudo systemctl restart agenia-mirror-agent
    journalctl -u agenia-mirror-agent -n 50 --no-pager

${BOLD}Por último, verifica desde los dos lados:${N}
  ./checkHealthAgente.sh   ${D}# 🏥 EN el VPS del hospital (ya está instalado allá)${N}
  ./checkHealth.sh         ${D}# 💻 en tu portátil, desde la RAÍZ del repo${N}
                           ${D}#    (o docs/drivers/<driver>/checkHealth.sh)${N}
EOF

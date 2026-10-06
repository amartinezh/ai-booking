#!/usr/bin/env bash
# =============================================================================
# actualizarAgente.sh — instala un bundle nuevo del agente (ya copiado a
# /tmp/agent.bundle.js por scp/AnyDesk, ver COMPILAR_Y_ACTUALIZAR.md §4.2) y
# reinicia el servicio, verificando el resultado REAL en el journal en vez de
# un `sleep` a ciegas.
#
# Reemplaza al `ageniaInstall.sh` casero (mismo espíritu: un solo comando en
# vez de la secuencia manual), con tres mejoras identificadas en el
# incidente del 2026-09-10:
#
#   1. Valida el bundle ANTES de instalarlo (`node --check`) — una
#      transferencia truncada por AnyDesk se detecta aquí, no como un
#      `status=203`/crash confuso después de reiniciar el servicio.
#   2. Respalda el binario anterior antes de sobrescribirlo (se queda con
#      los últimos 5) — permite `--rollback` de un comando si el bundle
#      nuevo trae un bug, sin recompilar ni volver a transferir nada.
#   3. Espera el RESULTADO real en el journal (handshake OK vs. error fatal)
#      en vez de un `sleep 4` fijo, que puede caer en medio de la ventana de
#      reintento de systemd (`RestartSec=5`) y mostrar `activating` — un
#      estado ambiguo que no dice si funcionó o no.
#
# USO (🏥 en el VPS del hospital, como el usuario `data`):
#   scp/AnyDesk el bundle nuevo a /tmp/agent.bundle.js, luego:
#     ./actualizarAgente.sh
#
#   Con el SHA-256 que imprimió ./update-agente.sh en tu portátil (recomendado:
#   confirma que llegó COMPLETO y que es el bundle que acabas de compilar):
#     ./actualizarAgente.sh 3f9a…c2
#
#   Para revertir al binario anterior sin recompilar nada:
#     ./actualizarAgente.sh --rollback
#
# Mejoras del 2026-10-06 (tras instalar sin querer un bundle viejo):
#   4. Compara el SHA-256 del bundle con el esperado (si se pasa) y avisa si es
#      IDÉNTICO al que ya está instalado — reiniciar con el mismo binario no
#      actualiza nada y antes no lo decía.
#   5. Toma la marca de tiempo ANTES del restart: el handshake llega en ~1 s y
#      podía quedar fuera de la ventana que se vigila.
#   6. `sudo journalctl`: el usuario `data` sin el grupo systemd-journal no ve
#      el journal del servicio, y la espera terminaba siempre en «timeout».
# =============================================================================
set -Eeuo pipefail

BUNDLE=/tmp/agent.bundle.js
DEST_DIR=/opt/agenia-mirror-agent/dist
DEST="$DEST_DIR/index.js"
BACKUP_DIR="$DEST_DIR/backups"
SERVICE=agenia-mirror-agent
KEEP_BACKUPS=5
WAIT_TIMEOUT=20   # segundos que se espera un desenlace claro en el journal

if [[ -t 1 ]]; then
  G=$'\033[0;32m'; Y=$'\033[0;33m'; R=$'\033[0;31m'; B=$'\033[1;34m'; N=$'\033[0m'
else G=''; Y=''; R=''; B=''; N=''; fi
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
err()  { printf '  %s✘%s %s\n' "$R" "$N" "$*" >&2; }
head1(){ printf '\n%s── %s%s\n' "$B" "$*" "$N"; }
die()  { err "$*"; exit 1; }

# Sondea el journal DESDE el instante del restart hasta ver un desenlace
# reconocible, en vez de dormir un tiempo fijo y adivinar por el estado.
wait_for_outcome() {
  local since="$1" waited=0
  while (( waited < WAIT_TIMEOUT )); do
    local log
    log="$(sudo journalctl -u "$SERVICE" --since "$since" --no-pager 2>/dev/null)"
    if grep -q "handshake OK" <<<"$log"; then echo ok; return 0; fi
    if grep -q "error fatal en el arranque" <<<"$log"; then echo fail; return 0; fi
    sleep 1; waited=$((waited + 1))
  done
  echo timeout
}

restart_and_check() {
  head1 "Reiniciando $SERVICE"
  local since
  since="$(date '+%Y-%m-%d %H:%M:%S')"
  sudo systemctl restart "$SERVICE"
  printf '  Esperando resultado en el journal (hasta %ss)...\n' "$WAIT_TIMEOUT"
  case "$(wait_for_outcome "$since")" in
    ok)
      ok "handshake OK — el agente arrancó bien."
      ;;
    fail)
      err "El journal muestra 'error fatal en el arranque'. Detalle:"
      sudo journalctl -u "$SERVICE" -n 30 --no-pager | sed 's/^/    /'
      exit 1
      ;;
    timeout)
      warn "No apareció 'handshake OK' ni un error fatal en ${WAIT_TIMEOUT}s — puede estar tardando más de lo normal."
      systemctl status "$SERVICE" --no-pager | sed 's/^/    /'
      ;;
  esac
}

do_rollback() {
  head1 "Rollback — restaurando el binario anterior"
  local last
  last="$(sudo bash -c "ls -t '$BACKUP_DIR'/index.js.*.bak 2>/dev/null" | head -1)"
  [[ -n "$last" ]] || die "No hay ningún backup en $BACKUP_DIR — no se puede revertir."
  ok "Restaurando: $last"
  sudo install -o mirroragent -g mirroragent -m 0755 "$last" "$DEST"
  restart_and_check
  exit 0
}

[[ "${1:-}" == "--rollback" ]] && do_rollback

head1 "Validando el bundle nuevo"
[[ -s "$BUNDLE" ]] || die "No existe o está vacío: $BUNDLE (¿ya lo copiaste con scp/AnyDesk?)"
command -v node >/dev/null 2>&1 || die "No hay 'node' en el PATH — no puedo validar el bundle."
node --check "$BUNDLE" \
  || die "El bundle no pasa 'node --check' — la transferencia puede haber llegado corrupta/truncada. Vuelve a copiarlo."
ok "Bundle válido ($(du -h "$BUNDLE" | cut -f1))"

SHA_NUEVO="$(sha256sum "$BUNDLE" | awk '{print $1}')"
ok "SHA-256 del bundle: $SHA_NUEVO"
ESPERADO="${1:-}"
if [[ -n "$ESPERADO" ]]; then
  [[ "$SHA_NUEVO" == "$ESPERADO" ]] \
    || die "El SHA-256 no coincide con el esperado ($ESPERADO): la copia llegó incompleta o es OTRO archivo. Vuelve a copiarlo."
  ok "Coincide con el SHA-256 esperado."
else
  warn "No pasaste el SHA-256 esperado: no se puede confirmar que sea el bundle recién compilado."
fi
if [[ -f "$DEST" ]] && [[ "$(sudo sha256sum "$DEST" | awk '{print $1}')" == "$SHA_NUEVO" ]]; then
  die "Ese bundle es IDÉNTICO al que ya está instalado: no hay nada que actualizar. ¿Copiaste el archivo correcto?"
fi

head1 "Respaldando el binario actual"
sudo mkdir -p "$BACKUP_DIR"
if [[ -f "$DEST" ]]; then
  BACKUP_FILE="$BACKUP_DIR/index.js.$(date +%Y%m%d-%H%M%S).bak"
  sudo cp "$DEST" "$BACKUP_FILE"
  ok "Respaldo: $BACKUP_FILE"
  sudo bash -c "ls -t '$BACKUP_DIR'/index.js.*.bak 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f"
else
  warn "No había binario previo que respaldar (¿primera instalación?)"
fi

head1 "Instalando el bundle nuevo"
sudo install -o mirroragent -g mirroragent -m 0755 "$BUNDLE" "$DEST"
rm -f "$BUNDLE"
ok "Instalado en $DEST"

restart_and_check

head1 "Últimas líneas del journal"
sudo journalctl -u "$SERVICE" -n 20 --no-pager | sed 's/^/  /'

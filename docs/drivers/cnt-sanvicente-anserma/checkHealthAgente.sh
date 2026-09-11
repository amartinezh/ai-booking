#!/usr/bin/env bash
# =============================================================================
# checkHealthAgente.sh — auditoría de salud del agente, lado HOSPITAL.
#
# Complemento de `checkHealth.sh` (que corre desde tu portátil y solo ve lo
# que la nube reporta). Este corre DENTRO del VPS del hospital y cubre
# justo lo que aquel deja pendiente en su sección 9 — hoy a mano, aquí en un
# solo comando:
#
#   systemctl status agenia-mirror-agent --no-pager
#   journalctl -u agenia-mirror-agent --since yesterday --no-pager \
#     | grep -iE "error|fatal|🚨|falló" | sort | uniq -c | sort -rn
#   nc -zv 192.168.1.16 1433
#   curl -sI https://app.hsvpanserma.agenia.co | head -1
#
# QUÉ CHEQUEA (🏥, todo de solo lectura — nada de `restart`, nada de escritura)
#   1. Servicio systemd: activo, habilitado, cuántas veces se ha reiniciado
#   2. Última vez que hubo handshake OK y última reconciliación OK
#   3. Errores/fatales en el journal de las últimas 24h
#   4. Conectividad al SQL Server del HIS (192.168.1.16:1433)
#   5. Conectividad + certificado TLS hacia la nube
#   6. Versión y ruta de Node
#   7. Archivos del agente: bundle instalado (fecha/tamaño), agent.env
#      (solo permisos y dueño — NUNCA su contenido, ahí vive el token)
#   8. Estado local (data/state.json): existe y cuándo se actualizó por
#      última vez — si es muy viejo con el servicio "activo", es sospechoso
#   9. Disco y memoria
#
# Uso:
#   ./checkHealthAgente.sh
#
# Variables de entorno (todas opcionales, con el valor correcto de este
# hospital por defecto): MIRROR_SERVICE, MIRROR_HIS_HOST, MIRROR_HIS_PORT,
# MIRROR_CLOUD_URL, MIRROR_AGENT_ROOT, MIRROR_ENV_FILE.
#
# Genera un informe en texto plano: checkHealthAgente-<fecha>.txt, en el
# directorio desde donde se corre.
# =============================================================================
set -Eeuo pipefail

SERVICE="${MIRROR_SERVICE:-agenia-mirror-agent}"
HIS_HOST="${MIRROR_HIS_HOST:-192.168.1.16}"
HIS_PORT="${MIRROR_HIS_PORT:-1433}"
CLOUD_URL="${MIRROR_CLOUD_URL:-https://app.hsvpanserma.agenia.co}"
AGENT_ROOT="${MIRROR_AGENT_ROOT:-/opt/agenia-mirror-agent}"
ENV_FILE="${MIRROR_ENV_FILE:-/etc/agenia-mirror-agent/agent.env}"
REPORT="checkHealthAgente-$(date +%Y%m%d-%H%M%S).txt"

FAILS=0
WARNS=0
ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [!]    %s\n' "$*"; WARNS=$((WARNS+1)); }
err()  { printf '  [FAIL] %s\n' "$*"; FAILS=$((FAILS+1)); }
head1(){ printf '\n== %s ==\n' "$*"; }

{
echo "checkHealthAgente — espejo San Vicente de Paúl (Anserma), lado hospital"
echo "Generado: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "Host: $(hostname)"

head1 "1) Servicio systemd"
if systemctl is-active --quiet "$SERVICE"; then
  ok "$SERVICE está activo"
else
  err "$SERVICE NO está activo ($(systemctl is-active "$SERVICE" 2>/dev/null || echo desconocido))"
fi
systemctl is-enabled --quiet "$SERVICE" \
  && ok "arranca solo al reiniciar la VM (enabled)" \
  || warn "NO está 'enabled' — un reinicio de la VM no lo levantaría solo"

RESTARTS="$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo '?')"
if [[ "$RESTARTS" =~ ^[0-9]+$ ]] && (( RESTARTS > 5 )); then
  warn "$RESTARTS reinicios automáticos desde el último arranque de systemd — revisar si está en bucle"
else
  ok "reinicios automáticos: ${RESTARTS:-0}"
fi

ACTIVE_SINCE="$(systemctl show -p ActiveEnterTimestamp --value "$SERVICE" 2>/dev/null || echo '?')"
echo "  activo desde: $ACTIVE_SINCE"

head1 "2) Últimos hitos en el journal"
LAST_HANDSHAKE="$(journalctl -u "$SERVICE" --no-pager 2>/dev/null | grep "handshake OK" | tail -1 || true)"
if [[ -n "$LAST_HANDSHAKE" ]]; then
  ok "último handshake OK: ${LAST_HANDSHAKE%% agenia-mirror-agent*}"
else
  err "nunca se vio 'handshake OK' en el journal disponible"
fi

LAST_RECONCILE="$(journalctl -u "$SERVICE" --no-pager 2>/dev/null | grep "reconciliación OK" | tail -1 || true)"
if [[ -n "$LAST_RECONCILE" ]]; then
  ok "última reconciliación OK: ${LAST_RECONCILE%% agenia-mirror-agent*}"
else
  warn "no se ha visto ninguna 'reconciliación OK' todavía (corre cada 24h, la primera a los 2 min de arrancar)"
fi

head1 "3) Errores/fatales en las últimas 24h"
ERR_COUNT="$(journalctl -u "$SERVICE" --since '-24 hours' --no-pager 2>/dev/null \
  | grep -icE "error|fatal|🚨|falló" || true)"
if [[ "${ERR_COUNT:-0}" -eq 0 ]]; then
  ok "sin líneas de error/fatal en las últimas 24h"
else
  warn "$ERR_COUNT línea(s) con error/fatal/🚨 en las últimas 24h — detalle:"
  journalctl -u "$SERVICE" --since '-24 hours' --no-pager 2>/dev/null \
    | grep -iE "error|fatal|🚨|falló" | sort | uniq -c | sort -rn | head -20 | sed 's/^/    /'
fi

head1 "4) Conectividad al SQL Server del HIS ($HIS_HOST:$HIS_PORT)"
if command -v nc >/dev/null 2>&1; then
  # `nc -v` manda su línea de estado a stderr, no a stdout — el 2>&1 es
  # obligatorio o esta captura queda siempre vacía.
  NC_OUT="$(nc -zv -w 5 "$HIS_HOST" "$HIS_PORT" 2>&1 || true)"
  if grep -qi succeeded <<<"$NC_OUT"; then
    ok "$NC_OUT"
  else
    err "no se pudo conectar a $HIS_HOST:$HIS_PORT — ${NC_OUT:-sin respuesta}"
  fi
else
  warn "'nc' no está instalado — no se pudo probar la conexión al HIS"
fi

head1 "5) Conectividad y TLS hacia la nube ($CLOUD_URL)"
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$CLOUD_URL" 2>/dev/null || echo 000)"
if [[ "$HTTP_CODE" =~ ^(200|301|302|307|308)$ ]]; then
  ok "$CLOUD_URL → HTTP $HTTP_CODE"
else
  err "$CLOUD_URL → HTTP $HTTP_CODE (esperaba 2xx/3xx) — el agente no podría salir a internet"
fi
ISSUER="$(curl -sv --max-time 15 "$CLOUD_URL" 2>&1 | grep -i 'issuer' | head -1 || true)"
if [[ "$ISSUER" == *"Let's Encrypt"* ]]; then
  ok "certificado emitido por Let's Encrypt (sin interceptación TLS)"
elif [[ -n "$ISSUER" ]]; then
  err "certificado con emisor inesperado: $ISSUER — posible inspección TLS (ver CONECTIVIDAD.md §7.2)"
else
  warn "no se pudo leer el emisor del certificado"
fi

head1 "6) Node"
if command -v node >/dev/null 2>&1; then
  NODE_V="$(node -v)"
  ok "node en PATH: $(command -v node) ($NODE_V)"
  MAJOR="${NODE_V#v}"; MAJOR="${MAJOR%%.*}"
  [[ "$MAJOR" -ge 22 ]] || warn "Node $NODE_V es menor a 22 — fuera de soporte para este proyecto"
else
  err "'node' no está en el PATH — la unidad systemd fallaría con status=203/EXEC"
fi

head1 "7) Archivos del agente"
if [[ -f "$AGENT_ROOT/dist/index.js" ]]; then
  ok "bundle instalado: $(ls -lh "$AGENT_ROOT/dist/index.js" | awk '{print $5, $6, $7, $8}')"
else
  err "no existe $AGENT_ROOT/dist/index.js"
fi

# Esta comprobación necesita `sudo`. `/etc/agenia-mirror-agent` está en
# `chmod 700` a propósito (solo `mirroragent` puede entrar) — sin `sudo`,
# `data` no puede ni ver que el archivo existe, y esto reportaría un falso
# "no existe" en vez de un permiso insuficiente. Se usa `sudo` SOLO para leer
# metadatos (dueño/permisos), nunca para mostrar el contenido — ahí vive el
# token del agente.
if sudo test -f "$ENV_FILE"; then
  PERMS="$(sudo stat -c '%a %U:%G' "$ENV_FILE" 2>/dev/null || sudo stat -f '%Lp %Su:%Sg' "$ENV_FILE" 2>/dev/null)"
  echo "  $ENV_FILE → $PERMS"
  [[ "$PERMS" == 600* ]] && ok "permisos correctos (600)" || warn "permisos distintos a 600 — revisar (nunca debe ser legible por otros)"
else
  err "no existe $ENV_FILE"
fi

head1 "8) Estado local (data/state.json)"
STATE_FILE="$AGENT_ROOT/data/state.json"
if [[ -f "$STATE_FILE" ]]; then
  MTIME_H="$(( ( $(date +%s) - $(stat -c '%Y' "$STATE_FILE" 2>/dev/null || stat -f '%m' "$STATE_FILE") ) / 3600 ))"
  echo "  última modificación: hace ${MTIME_H}h"
  if systemctl is-active --quiet "$SERVICE" && [[ "$MTIME_H" -gt 2 ]]; then
    warn "el servicio está activo pero el estado no se actualiza hace ${MTIME_H}h — sospechoso, puede estar frenado sin avanzar"
  else
    ok "estado local presente y razonablemente reciente"
  fi
else
  warn "no existe $STATE_FILE todavía (normal si es la primera vez que arranca)"
fi

head1 "9) Recursos"
df -h / 2>/dev/null | awk 'NR==2 {printf "  disco / : %s usados de %s (%s)\n", $3, $2, $5}'
free -h 2>/dev/null | awk 'NR==2 {printf "  memoria : %s usados de %s\n", $3, $2}'

head1 "Resumen"
echo "  Fallos: $FAILS   Avisos: $WARNS"
if [[ "$FAILS" -eq 0 ]]; then
  echo "  Todo lo verificable desde el lado del hospital está sano."
else
  echo "  Hay $FAILS punto(s) que requieren atención — ver arriba."
fi

} | tee "$REPORT"

echo
echo "Informe guardado en: $REPORT"
[[ "$FAILS" -eq 0 ]]

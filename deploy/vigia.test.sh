#!/usr/bin/env bash
# =============================================================================
# vigia.test.sh — pruebas del vigía del servidor (deploy/vigia.sh)
#
# Corre el vigía DE VERDAD con `docker`, `curl` y `df` falsos en el PATH, el
# reloj controlado (VIGIA_AHORA) y VIGIA_SECO=1 (imprime los mensajes en vez de
# enviarlos), salvo la prueba del token, que usa un curl falso que anota cómo lo
# llamaron. No toca Docker, la red ni /var.
#
#   bash deploy/vigia.test.sh
#
# Funciona con bash 3.2 (macOS) y bash 5 (el servidor).
# =============================================================================
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIGIA="$AQUI/vigia.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/vigia-test.XXXXXX")"
trap 'rm -rf "$T"' EXIT

FALLOS=0
PRUEBAS=0
SALIDA=''

# 2026-10-19 10:00 en Bogotá (UTC-5), y otras horas del mismo día.
T10=1792422000
T03=1792396800
T05=1792404000
T23=1792468800
T01_SIG=1792476000 # 01:00 del día siguiente

TOKEN='555000111:AAHsecretoSecretoSecretoSecreto12345'

# ── Falsos ──────────────────────────────────────────────────────────────────
mkdir -p "$T/bin" "$T/fake" "$T/backups"
cat >"$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
# docker inspect -f <formato> <contenedor>  →  contenido de $FAKE/docker_<contenedor>
[[ "$1" == inspect ]] || exit 1
f="$FAKE/docker_${4}"
[[ -f "$f" ]] || exit 1
cat "$f"
EOF
cat >"$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
# El chequeo del panel (--resolve) responde $FAKE/http (por defecto 200).
# El envío a Telegram (-K -) anota sus argumentos y lo que le llegó por stdin.
for a in "$@"; do
  if [[ "$a" == --resolve ]]; then
    c=$(cat "$FAKE/http" 2>/dev/null || echo 200)
    printf '%s' "$c"
    [[ "$c" == 000 ]] && exit 7
    exit 0
  fi
done
printf '%s\n' "$@" >"$FAKE/curl_args"
cat >"$FAKE/curl_stdin"
cat "$FAKE/telegram" 2>/dev/null || echo '{"ok":true,"result":{"message_id":1}}'
EOF
cat >"$T/bin/df" <<'EOF'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 50 50 %s%% /\n' "$(cat "$FAKE/df" 2>/dev/null || echo 50)"
EOF
chmod +x "$T/bin/"*

# ── Utilidades ──────────────────────────────────────────────────────────────

reiniciar() { # deja todo sano y sin estado
  rm -rf "$T/estado" "$T/fake"/* "$T/backups"/*
  mkdir -p "$T/estado"
  config
  for c in agenia_api agenia_db agenia_proxy; do sano "$c"; done
  echo '30 3 * * * root agenia backup' >"$T/cron-backup"
  respaldo 20261019
}

config() { # $@: líneas extra que reemplazan a las de por defecto
  {
    echo 'ENABLED=true'
    echo "TOKEN=$TOKEN"
    echo 'CHAT_ID=-1001234567890'
    echo 'SERVIDOR=true'
    echo 'MUTED_UNTIL=0'
    echo 'QUIET_ENABLED=true'
    echo 'QUIET_FROM=22'
    echo 'QUIET_TO=6'
    echo 'REMINDER_MINUTES=60'
    echo 'MAX_REMINDERS=3'
    echo 'PANEL_URL=https://app.hsvpanserma.agenia.co'
  } >"$T/estado/telegram.env"
  local kv
  for kv in "$@"; do
    sed -i.bak "/^${kv%%=*}=/d" "$T/estado/telegram.env" && rm -f "$T/estado/telegram.env.bak"
    echo "$kv" >>"$T/estado/telegram.env"
  done
}

sano() { echo 'running|healthy|0' >"$T/fake/docker_$1"; }
docker_estado() { echo "$2" >"$T/fake/docker_$1"; }
respaldo() { head -c 4096 /dev/zero >"$T/backups/agenia-$1-033002.sql.gz"; }

correr() { # $1 epoch, $2… argumentos
  local t="$1"
  shift
  SALIDA=$(FAKE="$T/fake" PATH="$T/bin:$PATH" VIGIA_DIR="$T/estado" VIGIA_SECO="${SECO:-1}" \
    VIGIA_AHORA="$t" VIGIA_CONTENEDORES='agenia_api agenia_db agenia_proxy' \
    VIGIA_CRON_BACKUP="$T/cron-backup" AGENIA_BACKUP_DIR="$T/backups" \
    bash "$VIGIA" "$@" 2>&1)
}

envios() { printf '%s\n' "$SALIDA" | grep -c '^>>> ENVÍO' || true; }

ok() { # $1 descripción, $2… condición
  local d="$1"
  shift
  PRUEBAS=$((PRUEBAS + 1))
  if "$@"; then
    printf '  ✓ %s\n' "$d"
  else
    FALLOS=$((FALLOS + 1))
    printf '  ✕ %s\n' "$d"
    printf '%s\n' "$SALIDA" | sed 's/^/      │ /'
  fi
}

hay() { printf '%s\n' "$SALIDA" | grep -qF -- "$1"; }
no_hay() { ! hay "$1"; }
envios_son() { [[ "$(envios)" == "$1" ]]; }

# ── Pruebas ─────────────────────────────────────────────────────────────────

echo 'Vigía del servidor (deploy/vigia.sh)'

reiniciar
rm -f "$T/estado/telegram.env"
correr "$T10"
ok 'sin configurar todavía: no hace nada y sale bien' [ -z "$SALIDA" ]
ok '…pero deja su latido (el panel dice si el vigía corre)' grep -qx "$T10" "$T/estado/vigia.latido"

reiniciar
config 'TOKEN='
correr "$T10"
ok 'sin bot conectado: no hace nada' [ -z "$SALIDA" ]

reiniciar
correr "$T10"
ok 'todo sano: ningún mensaje' envios_son 0

echo '· contenedor caído'
reiniciar
docker_estado agenia_api 'exited||0'
correr "$T10"
ok 'la primera vuelta no avisa (un reinicio dura segundos)' envios_son 0
correr $((T10 + 60))
ok 'la segunda seguida sí, una vez' envios_son 1
ok 'con su gravedad y el contenedor' hay '🔴 CRÍTICA · Servidor'
ok '…qué pasa' hay 'Contenedor agenia_api: detenido'
ok '…desde la PRIMERA vuelta, en hora Colombia' hay 'Desde: 19/10/2026 10:00 (hora Colombia)'
ok '…y el enlace al monitor' hay 'Ver: https://app.hsvpanserma.agenia.co/super-admin/monitor'
correr $((T10 + 120))
ok 'sigue caído: no se repite' envios_son 0
correr $((T10 + 61 * 60))
ok 'a la hora, el recordatorio' hay '⏰ RECORDATORIO 1 de 3 · 🔴 CRÍTICA · Servidor'
ok '…que dice cuánto lleva' hay 'Sigue sin resolverse desde hace 1 h 1 min.'
sano agenia_api
correr $((T10 + 66 * 60))
ok 'al volver: «resuelto» con lo que duró' hay '✅ RESUELTO · Servidor'
ok '…en minutos' hay 'Duró 1 h 6 min (10:00 → 11:06, hora Colombia).'
correr $((T10 + 67 * 60))
ok 'y nada más' envios_son 0

echo '· contenedor que no responde, o que no existe'
reiniciar
docker_estado agenia_db 'running|unhealthy|0'
rm -f "$T/fake/docker_agenia_proxy"
correr "$T10"
correr $((T10 + 60))
ok 'unhealthy → «no responde»' hay 'Contenedor agenia_db: no responde'
ok 'sin contenedor → «no existe»' hay 'Contenedor agenia_proxy: no existe'
ok 'dos problemas, dos mensajes' envios_son 2

echo '· reinicios de Docker'
reiniciar
correr "$T10"
docker_estado agenia_api 'running|healthy|1'
correr $((T10 + 60))
ok 'si Docker lo levantó solo, avisa' hay 'Contenedor agenia_api: se reinició solo'
ok '…como advertencia' hay '🟠 ADVERTENCIA · Servidor'
correr $((T10 + 120))
ok '…una vez' envios_son 0
docker_estado agenia_api 'running|healthy|0'
correr $((T10 + 180))
ok 'un contenedor recreado (despliegue) vuelve a 0: no es un reinicio' envios_son 0

echo '· el panel'
reiniciar
echo 502 >"$T/fake/http"
correr "$T10"
correr $((T10 + 60))
ok 'HTTP 502 dos veces → crítico' hay 'El panel no responde por su dirección'
ok '…con el código' hay 'HTTP 502 en https://app.hsvpanserma.agenia.co/login'
reiniciar
echo 000 >"$T/fake/http"
correr "$T10"
correr $((T10 + 60))
ok 'sin respuesta (000) también' hay 'HTTP 000'
reiniciar
echo 404 >"$T/fake/http"
correr "$T10"
correr $((T10 + 60))
ok 'un 4xx no es una caída' envios_son 0
reiniciar
config 'PANEL_URL='
echo 502 >"$T/fake/http"
correr "$T10"
correr $((T10 + 60))
ok 'sin URL del panel no se mira' envios_son 0

echo '· disco'
reiniciar
echo 85 >"$T/fake/df"
correr "$T10"
ok 'al 85 %: advertencia de inmediato' hay '🟠 ADVERTENCIA · Servidor'
ok '…con el porcentaje' hay 'Disco al 85 %'
echo 92 >"$T/fake/df"
correr $((T10 + 60))
ok 'al 92 %: empeoró, crítico' hay '🔴 CRÍTICA · Servidor (empeoró)'
echo 78 >"$T/fake/df"
correr $((T10 + 120))
ok 'al 78 % sigue abierto (no se da por resuelto en el borde)' envios_son 0
echo 70 >"$T/fake/df"
correr $((T10 + 180))
ok 'al 70 %: resuelto' hay '✅ RESUELTO · Servidor'

echo '· respaldo'
reiniciar
rm -f "$T/backups"/*
correr "$T03"
ok 'a las 03:00 todavía no toca' envios_son 0
correr "$T05"
ok 'a las 05:00 sin el de hoy: crítico' hay 'El respaldo de hoy no está'
ok '…dice cuál falta' hay 'agenia-20261019-*.sql.gz'
correr "$T01_SIG"
ok 'a la 01:00 del día siguiente no se da por resuelto' envios_son 0
respaldo 20261020
correr $((T01_SIG + 4 * 3600))
ok 'con el respaldo del día: resuelto' hay '✅ RESUELTO · Servidor'
reiniciar
rm -f "$T/backups"/* "$T/cron-backup"
correr "$T05"
ok 'sin el cron del respaldo (--no-backup-cron) no se mira' envios_son 0
reiniciar
rm -f "$T/backups"/*
echo vacío >"$T/backups/agenia-20261019-033002.sql.gz"
correr "$T05"
ok 'un respaldo de pocos bytes no cuenta' hay 'El respaldo de hoy no está'

echo '· mantenimiento, silencio y apagado'
reiniciar
docker_estado agenia_api 'exited||0'
echo $((T10 + 600)) >"$T/estado/mantenimiento"
correr "$T10"
correr $((T10 + 60))
correr $((T10 + 120))
ok 'durante un despliegue no mira contenedores' envios_son 0
correr $((T10 + 660))
correr $((T10 + 720))
ok 'al terminar la ventana, sí' hay 'Contenedor agenia_api: detenido'
ok '…y borra la marca vencida' [ ! -f "$T/estado/mantenimiento" ]

reiniciar
docker_estado agenia_api 'exited||0'
correr "$T10"
correr $((T10 + 60))
echo $((T10 + 3600)) >"$T/estado/mantenimiento"
sano agenia_api
correr $((T10 + 120))
ok 'lo que ya estaba avisado no se da por resuelto en mantenimiento' envios_son 0
rm -f "$T/estado/mantenimiento"
correr $((T10 + 180))
ok '…se resuelve al salir de él' hay '✅ RESUELTO · Servidor'

reiniciar
config "MUTED_UNTIL=$((T10 + 1800))"
docker_estado agenia_api 'exited||0'
correr "$T10"
correr $((T10 + 60))
ok 'en silencio: no envía' envios_son 0
correr $((T10 + 1860))
ok 'al terminar el silencio, lo que sigue caído se avisa' hay 'Contenedor agenia_api: detenido'
ok '…con su hora de inicio' hay 'Desde: 19/10/2026 10:00'

reiniciar
config 'SERVIDOR=false'
echo 95 >"$T/fake/df"
correr "$T10"
ok 'con la categoría «Servidor» apagada: nada' envios_son 0

reiniciar
config 'ENABLED=false'
echo 95 >"$T/fake/df"
correr "$T10"
ok 'con las alertas apagadas: nada' envios_son 0

echo '· de noche'
reiniciar
echo 85 >"$T/fake/df"
correr "$T23"
ok 'una advertencia a las 23:00 llega sin sonido' hay '>>> ENVÍO (sin sonido: true)'
reiniciar
echo 95 >"$T/fake/df"
correr "$T23"
ok 'una crítica a las 23:00 suena' hay '>>> ENVÍO (sin sonido: false)'
reiniciar
config 'QUIET_ENABLED=false'
echo 85 >"$T/fake/df"
correr "$T23"
ok 'sin horario nocturno, la advertencia suena' hay '>>> ENVÍO (sin sonido: false)'

echo '· prueba, estado y el token'
reiniciar
correr "$T10" --prueba
ok '--prueba manda el mensaje de prueba' hay '✅ Prueba del vigía del servidor'
reiniciar
echo 92 >"$T/fake/df"
correr "$T10"
correr "$T10" --estado
ok '--estado lista lo abierto' hay 'Disco casi lleno: 92 % — CRITICA'
reiniciar
correr "$T10" --estado
ok '--estado sin nada' hay 'Sin problemas abiertos.'

reiniciar
echo 95 >"$T/fake/df"
SECO=0 correr "$T10"
ok '🔒 el token NO va en los argumentos de curl (ps lo mostraría)' \
  bash -c "! grep -qF '$TOKEN' '$T/fake/curl_args'"
ok '🔒 va por la entrada estándar' grep -qF "url = \"https://api.telegram.org/bot$TOKEN/sendMessage\"" "$T/fake/curl_stdin"
ok 'manda chat, texto y sonido' grep -qF 'disable_notification=false' "$T/fake/curl_args"
reiniciar
echo 95 >"$T/fake/df"
echo '{"ok":false,"error_code":403,"description":"Forbidden: bot was kicked from the group chat"}' >"$T/fake/telegram"
SECO=0 correr "$T10"
ok 'si Telegram lo rechaza, queda en el log con el motivo' hay 'Telegram no aceptó el envío: Forbidden: bot was kicked'
rm -f "$T/fake/telegram"
SECO=0 correr $((T10 + 60))
ok '…y se reintenta en la vuelta siguiente' grep -qF 'Disco casi lleno' "$T/fake/curl_args"

echo
if ((FALLOS)); then
  printf '✕ %s de %s pruebas fallaron\n' "$FALLOS" "$PRUEBAS"
  exit 1
fi
printf '✓ %s pruebas\n' "$PRUEBAS"

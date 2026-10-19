#!/usr/bin/env bash
# =============================================================================
# vigia.sh — el vigía del servidor de AgenIA
#           (docs/PLAN_ALERTAS_TECNICAS.md §3.6, A8)
#
# POR QUÉ EXISTE
# Las alertas técnicas salen de la API. Pero si la API, la base o el proxy se
# caen, nada dentro de la API puede avisar: justo las fallas más graves. Este
# script corre en el HOST, cada minuto (/etc/cron.d/agenia-vigia), no depende de
# la API ni de `agenia.sh`, y le escribe al MISMO grupo de Telegram con el MISMO
# bot que se configura en /super-admin/alertas.
#
# QUÉ MIRA
#   · Contenedores (agenia_api, agenia_web, agenia_db, agenia_redis,
#     agenia_proxy): detenido, sin existir, o con su chequeo de salud en
#     «unhealthy»; y si Docker lo reinició solo (la API se cae y vuelve sin que
#     nadie se entere).
#   · El panel por su dirección, probado EN el servidor a través del proxy
#     (curl --resolve a 127.0.0.1): la cadena proxy → web.
#   · El disco: advertencia desde el 80 %, crítico desde el 90 %.
#   · El respaldo de hoy, después de las 04:30 (el cron corre a las 03:30).
#
# CÓMO CUIDA AL EQUIPO DEL RUIDO
#   · Un mensaje por problema, «empeoró» si sube de gravedad, recordatorio de lo
#     crítico cada REMINDER_MINUTES (hasta MAX_REMINDERS) y «resuelto» con lo
#     que duró. Los mismos ajustes del panel.
#   · Un contenedor caído o el panel sin responder se confirman en DOS vueltas
#     seguidas: un reinicio dura segundos.
#   · Durante un despliegue (`update-vps.sh` deja /var/lib/agenia/alertas/
#     mantenimiento con la hora de fin) no mira contenedores ni el panel.
#   · Apagado, categoría «Servidor» apagada o en silencio: registra, no envía.
#
# DE DÓNDE SACA EL TOKEN
# De /var/lib/agenia/alertas/telegram.env, que ESCRIBE LA API cada vez que se
# guarda algo en el panel (fuera de /opt/agenia: el despliegue hace rsync
# --delete ahí). Se LEE con sed, nunca se ejecuta. El token no va en la línea de
# comandos de curl (`ps` lo mostraría): va por la entrada estándar.
#
# USO
#   vigia.sh             una vuelta (lo que hace el cron)
#   vigia.sh --prueba    manda un mensaje de prueba al grupo
#   vigia.sh --estado    muestra los problemas que tiene abiertos
#
# Variables para pruebas (deploy/vigia.test.sh): VIGIA_DIR, VIGIA_SECO=1
# (imprime en vez de enviar), VIGIA_AHORA (epoch), VIGIA_CONTENEDORES,
# VIGIA_CRON_BACKUP, AGENIA_BACKUP_DIR, VIGIA_TZ, VIGIA_TELEGRAM_API.
#
# Compatible con bash 3.2 (las pruebas corren también en macOS) y GNU/BSD date.
# =============================================================================
set -uo pipefail # sin -e: un chequeo que falla no puede impedir los demás

DIR="${VIGIA_DIR:-/var/lib/agenia/alertas}"
CONF="$DIR/telegram.env"
ESTADO="$DIR/vigia.d"
MANTENIMIENTO="$DIR/mantenimiento"
BACKUP_DIR="${AGENIA_BACKUP_DIR:-/var/backups/agenia}"
CRON_BACKUP="${VIGIA_CRON_BACKUP:-/etc/cron.d/agenia-backup}"
CONTENEDORES="${VIGIA_CONTENEDORES:-agenia_api agenia_web agenia_db agenia_redis agenia_proxy}"
ZONA="${VIGIA_TZ:-America/Bogota}"
# Sin tzdata (una imagen mínima), `TZ=America/Bogota` cae EN SILENCIO a UTC: las
# horas saldrían corridas 5 h y el respaldo se miraría a deshora. Colombia no
# tiene horario de verano, así que basta el desfase fijo (lo encontró la prueba
# en ubuntu:24.04).
TZ_FECHAS="$ZONA"
if [[ "$ZONA" == America/Bogota && ! -e /usr/share/zoneinfo/America/Bogota ]]; then
  TZ_FECHAS='<-05>5'
fi
TELEGRAM="${VIGIA_TELEGRAM_API:-https://api.telegram.org}"
AHORA="${VIGIA_AHORA:-$(date +%s)}"
SECO="${VIGIA_SECO:-0}"
MODO="${1:-vigilar}"

DISCO_ADVERTENCIA=80
DISCO_CRITICO=90
DISCO_BAJA=75 # un disco al 79 % que ya avisó no se da por resuelto: baja de aquí
HORA_RESPALDO=430 # 04:30 (HMM), hora local

SERVIDOR="$(hostname 2>/dev/null || echo servidor)"
VISTOS=" "   # claves con problema en esta vuelta
OMITIDOS=" " # prefijos de claves que esta vuelta NO miró (no se dan por resueltas)

# ── Utilidades ──────────────────────────────────────────────────────────────

# Fecha local de un epoch, con el date de GNU (servidor) o el de BSD (macOS).
fecha() { # $1 formato strftime, $2 epoch (por defecto AHORA)
  local t="${2:-$AHORA}"
  TZ="$TZ_FECHAS" date -d "@$t" "+$1" 2>/dev/null || TZ="$TZ_FECHAS" date -r "$t" "+$1"
}

log() { printf '%s vigia: %s\n' "$(fecha '%Y-%m-%d %H:%M:%S')" "$*"; }

zona_legible() {
  if [[ "$ZONA" == America/Bogota ]]; then echo 'hora Colombia'; else echo "$ZONA"; fi
}

# Valor de una clave del archivo de configuración. Se lee, nunca se ejecuta.
valor() { sed -n "s/^$1=//p" "$CONF" 2>/dev/null | head -n 1; }

numero() { # $1 valor, $2 por defecto
  if [[ "$1" =~ ^[0-9]+$ ]]; then echo "$1"; else echo "$2"; fi
}

duracion() { # $1 segundos
  local m=$(($1 / 60))
  if ((m < 1)); then
    echo 'menos de 1 min'
  elif ((m < 60)); then
    echo "$m min"
  elif ((m < 1440)); then
    if ((m % 60)); then echo "$((m / 60)) h $((m % 60)) min"; else echo "$((m / 60)) h"; fi
  else
    local h=$(((m % 1440) / 60))
    if ((h)); then echo "$((m / 1440)) d $h h"; else echo "$((m / 1440)) d"; fi
  fi
}

en_lista() { # $1 palabra, $2 lista separada por espacios
  case "$2" in *" $1 "*) return 0 ;; esac
  return 1
}

omitido() { # $1 clave: ¿su prefijo está entre lo que esta vuelta no miró?
  local p
  for p in $OMITIDOS; do
    case "$1" in "$p"*) return 0 ;; esac
  done
  return 1
}

orden() {
  case "$1" in CRITICA) echo 2 ;; ADVERTENCIA) echo 1 ;; *) echo 0 ;; esac
}

icono() {
  case "$1" in CRITICA) echo '🔴' ;; ADVERTENCIA) echo '🟠' ;; *) echo 'ℹ️' ;; esac
}

etiqueta() {
  case "$1" in CRITICA) echo 'CRÍTICA' ;; ADVERTENCIA) echo 'ADVERTENCIA' ;; *) echo 'INFORMACIÓN' ;; esac
}

# ¿Sin sonido? Una INFO siempre; una CRÍTICA nunca; una ADVERTENCIA de noche.
sin_sonido() { # $1 gravedad
  case "$1" in
    INFO) echo true; return ;;
    CRITICA) echo false; return ;;
  esac
  if [[ "$QUIET_ENABLED" != true ]] || ((QUIET_FROM == QUIET_TO)); then
    echo false
    return
  fi
  local h=$((10#$(fecha %H)))
  if ((QUIET_FROM < QUIET_TO)); then
    if ((h >= QUIET_FROM && h < QUIET_TO)); then echo true; else echo false; fi
  else
    if ((h >= QUIET_FROM || h < QUIET_TO)); then echo true; else echo false; fi
  fi
}

# ── Telegram ────────────────────────────────────────────────────────────────

enviar() { # $1 texto, $2 sin sonido (true|false)
  if [[ "$SECO" == 1 ]]; then
    printf '>>> ENVÍO (sin sonido: %s)\n%s\n<<<\n' "$2" "$1"
    return 0
  fi
  local resp
  # El token va por la entrada estándar (-K -), no en los argumentos.
  resp=$(printf 'url = "%s/bot%s/sendMessage"\n' "$TELEGRAM" "$TOKEN" |
    curl -sS --max-time 15 -K - \
      --data-urlencode "chat_id=$CHAT_ID" \
      --data-urlencode "text=$1" \
      --data-urlencode "disable_notification=$2" \
      --data-urlencode 'link_preview_options={"is_disabled":true}' 2>&1) || {
    log 'no se pudo contactar a Telegram (red)'
    return 1
  }
  case "$resp" in *'"ok":true'*) return 0 ;; esac
  log "Telegram no aceptó el envío: $(printf '%s' "$resp" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p' | cut -c1-200)"
  return 1
}

pie() {
  printf 'Servidor: %s\n' "$SERVIDOR"
  printf 'Detectado por: vigía del servidor\n'
  if [[ -n "$PANEL_URL" ]]; then printf 'Ver: %s/super-admin/monitor\n' "$PANEL_URL"; fi
}

msg_aviso() { # $1 gravedad, $2 título, $3 detalle, $4 desde, $5 empeoró (0|1)
  local extra=''
  [[ "$5" == 1 ]] && extra=' (empeoró)'
  printf '%s %s · Servidor%s\n%s\n' "$(icono "$1")" "$(etiqueta "$1")" "$extra" "$2"
  [[ -n "$3" ]] && printf 'Qué pasa: %s\n' "$3"
  printf 'Desde: %s (%s)\n' "$(fecha '%d/%m/%Y %H:%M' "$4")" "$(zona_legible)"
  pie
}

msg_recordatorio() { # $1 n, $2 de, $3 gravedad, $4 título, $5 detalle, $6 desde
  printf '⏰ RECORDATORIO %s de %s · %s %s · Servidor\n%s\n' "$1" "$2" "$(icono "$3")" "$(etiqueta "$3")" "$4"
  [[ -n "$5" ]] && printf 'Qué pasa: %s\n' "$5"
  printf 'Sigue sin resolverse desde hace %s.\n' "$(duracion $((AHORA - $6)))"
  pie
}

msg_resuelto() { # $1 título, $2 desde
  local desde hasta
  if [[ "$(fecha %Y%m%d "$2")" == "$(fecha %Y%m%d)" ]]; then
    desde="$(fecha %H:%M "$2")"
    hasta="$(fecha %H:%M)"
  else
    desde="$(fecha '%d/%m %H:%M' "$2")"
    hasta="$(fecha '%d/%m %H:%M')"
  fi
  printf '✅ RESUELTO · Servidor\n%s\nDuró %s (%s → %s, %s).\nServidor: %s\n' \
    "$1" "$(duracion $((AHORA - $2)))" "$desde" "$hasta" "$(zona_legible)" "$SERVIDOR"
}

# ── Estado: un archivo por problema en vigia.d/ ─────────────────────────────

campo() { sed -n "s/^$2=//p" "$ESTADO/$1" 2>/dev/null | head -n 1; }

guardar() { # $1 clave, luego campo=valor…
  local f="$ESTADO/$1" kv
  shift
  for kv in "$@"; do printf '%s\n' "$kv"; done >"$f.tmp" && mv "$f.tmp" "$f"
}

# Un problema visto en esta vuelta. `confirmar` = vueltas seguidas antes de avisar.
problema() { # $1 clave, $2 gravedad, $3 título, $4 detalle, $5 confirmar
  local clave="$1" grav="$2" titulo="$3" detalle="$4" confirmar="${5:-1}"
  local desde="$AHORA" seguidos=1 avisada='' ultimo=0 recordatorios=0
  VISTOS="$VISTOS$clave "
  if [[ -f "$ESTADO/$clave" ]]; then
    desde=$(numero "$(campo "$clave" desde)" "$AHORA")
    seguidos=$(($(numero "$(campo "$clave" seguidos)" 0) + 1))
    avisada=$(campo "$clave" avisada)
    ultimo=$(numero "$(campo "$clave" ultimo)" 0)
    recordatorios=$(numero "$(campo "$clave" recordatorios)" 0)
  fi

  if [[ "$ENVIA" == 1 ]]; then
    if [[ -z "$avisada" ]]; then
      if ((seguidos >= confirmar)) &&
        enviar "$(msg_aviso "$grav" "$titulo" "$detalle" "$desde" 0)" "$(sin_sonido "$grav")"; then
        avisada="$grav"
        ultimo="$AHORA"
        log "avisado: $clave ($grav)"
      fi
    elif (($(orden "$grav") > $(orden "$avisada"))); then
      if enviar "$(msg_aviso "$grav" "$titulo" "$detalle" "$desde" 1)" "$(sin_sonido "$grav")"; then
        avisada="$grav"
        ultimo="$AHORA"
        recordatorios=0
        log "empeoró: $clave ($grav)"
      fi
    elif [[ "$grav" == CRITICA ]] && ((recordatorios < MAX_REMINDERS)) &&
      ((AHORA - ultimo >= REMINDER_MINUTES * 60)); then
      if enviar "$(msg_recordatorio $((recordatorios + 1)) "$MAX_REMINDERS" "$grav" "$titulo" "$detalle" "$desde")" false; then
        recordatorios=$((recordatorios + 1))
        ultimo="$AHORA"
        log "recordatorio $recordatorios: $clave"
      fi
    fi
  fi

  guardar "$clave" "desde=$desde" "seguidos=$seguidos" "avisada=$avisada" \
    "ultimo=$ultimo" "recordatorios=$recordatorios" "gravedad=$grav" \
    "titulo=$titulo" "detalle=$detalle"
}

# Lo que tenía problema y esta vuelta ya no lo vio (y sí lo miró): resuelto.
resolver_los_demas() {
  local f clave avisada desde titulo
  for f in "$ESTADO"/*; do
    [[ -f "$f" ]] || continue
    clave="${f##*/}"
    case "$clave" in reinicios_* | *.tmp) continue ;; esac
    en_lista "$clave" "$VISTOS" && continue
    omitido "$clave" && continue
    avisada=$(campo "$clave" avisada)
    if [[ -n "$avisada" && "$ENVIA" == 1 ]]; then
      desde=$(numero "$(campo "$clave" desde)" "$AHORA")
      titulo=$(campo "$clave" titulo)
      # Si no sale, el archivo queda y se reintenta en la vuelta siguiente.
      enviar "$(msg_resuelto "$titulo" "$desde")" "$(sin_sonido "$avisada")" || continue
      log "resuelto: $clave"
    fi
    rm -f "$f"
  done
}

# ── Chequeos ────────────────────────────────────────────────────────────────

# Docker lo levantó de nuevo (restart policy): un evento, sin «resuelto».
reinicios() { # $1 contenedor, $2 RestartCount
  local f="$ESTADO/reinicios_$1" antes
  antes=$(cat "$f" 2>/dev/null || true)
  printf '%s\n' "$2" >"$f"
  [[ "$antes" =~ ^[0-9]+$ ]] || return 0 # primera vez: solo se anota
  if (($2 > antes)) && [[ "$ENVIA" == 1 ]]; then
    enviar "$(msg_aviso ADVERTENCIA "Contenedor $1: se reinició solo" \
      "Docker lo volvió a levantar ($2 reinicio(s) desde que se creó): algo lo tumbó. Revise: docker logs --tail 100 $1" \
      "$AHORA" 0)" "$(sin_sonido ADVERTENCIA)" && log "reinicio: $1 ($2)"
  fi
}

vigilar_contenedores() {
  local c out estado salud rc
  for c in $CONTENEDORES; do
    out=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}' "$c" 2>/dev/null) || out=''
    if [[ -z "$out" ]]; then
      problema "contenedor_$c" CRITICA "Contenedor $c: no existe" \
        'docker inspect no lo encuentra. Revise: agenia ps' 2
      continue
    fi
    IFS='|' read -r estado salud rc <<<"$out"
    [[ "$rc" =~ ^[0-9]+$ ]] && reinicios "$c" "$rc"
    if [[ "$estado" != running ]]; then
      problema "contenedor_$c" CRITICA "Contenedor $c: detenido" \
        "Estado: $estado. Revise: docker logs --tail 100 $c" 2
    elif [[ "$salud" == unhealthy ]]; then
      problema "contenedor_$c" CRITICA "Contenedor $c: no responde" \
        "Su chequeo de salud lo da por enfermo (unhealthy). Revise: docker logs --tail 100 $c" 2
    fi
  done
}

vigilar_panel() {
  [[ -n "$PANEL_URL" ]] || return 0
  local esquema="${PANEL_URL%%://*}" host="${PANEL_URL#*://}" puerto=443 codigo
  host="${host%%/*}"
  [[ "$esquema" == http ]] && puerto=80
  if [[ "$host" == *:* ]]; then
    puerto="${host##*:}"
    host="${host%%:*}"
  fi
  codigo=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "$host:$puerto:127.0.0.1" "$esquema://$host:$puerto/login" 2>/dev/null) || true
  [[ "$codigo" =~ ^[1-4][0-9][0-9]$ ]] && return 0
  problema panel CRITICA 'El panel no responde por su dirección' \
    "HTTP ${codigo:-000} en $esquema://$host/login (probado en el propio servidor, a través del proxy)." 2
}

vigilar_disco() {
  local uso
  uso=$(df -P / 2>/dev/null | awk 'NR==2 { gsub("%", "", $5); print $5 }')
  [[ "$uso" =~ ^[0-9]+$ ]] || return 0
  local detalle='Con el disco lleno se cae la base. Lo que más crece: la caché de Docker (docker builder prune --max-used-space 10gb) y los respaldos.'
  if ((uso >= DISCO_CRITICO)); then
    problema disco CRITICA "Disco casi lleno: $uso %" "$detalle" 1
  elif ((uso >= DISCO_ADVERTENCIA)) || { [[ -f "$ESTADO/disco" ]] && ((uso >= DISCO_BAJA)); }; then
    problema disco ADVERTENCIA "Disco al $uso %" "$detalle" 1
  fi
}

vigilar_respaldo() {
  [[ -f "$CRON_BACKUP" ]] || return 0 # instalado con --no-backup-cron
  if ((10#$(fecha %H%M) < HORA_RESPALDO)); then
    OMITIDOS="$OMITIDOS""respaldo " # todavía no toca: lo de ayer no se da por resuelto
    return 0
  fi
  local hoy f
  hoy=$(fecha %Y%m%d)
  for f in "$BACKUP_DIR"/agenia-"$hoy"-*.sql.gz; do
    [[ -f "$f" ]] && (($(wc -c <"$f") >= 1024)) && return 0
  done
  problema respaldo CRITICA 'El respaldo de hoy no está' \
    "No hay un agenia-$hoy-*.sql.gz válido en $BACKUP_DIR (el cron corre a las 03:30). Revise /var/log/agenia-backup.log y corra: agenia backup" 1
}

# ── Principal ───────────────────────────────────────────────────────────────

case "$MODO" in
  vigilar | --prueba | --estado) ;;
  -h | --help)
    sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo 'uso: vigia.sh [--prueba|--estado]' >&2
    exit 2
    ;;
esac

if [[ "$MODO" == --estado ]]; then
  found=0
  for f in "$ESTADO"/*; do
    [[ -f "$f" ]] || continue
    case "${f##*/}" in reinicios_* | *.tmp) continue ;; esac
    found=1
    printf '· %s — %s, desde %s, avisado: %s\n' "$(campo "${f##*/}" titulo)" \
      "$(campo "${f##*/}" gravedad)" "$(fecha '%d/%m %H:%M' "$(numero "$(campo "${f##*/}" desde)" "$AHORA")")" \
      "$(campo "${f##*/}" avisada | sed 's/^$/no/')"
  done
  ((found)) || echo 'Sin problemas abiertos.'
  exit 0
fi

if [[ "$MODO" == vigilar ]]; then
  mkdir -p "$ESTADO" && chmod 700 "$DIR" "$ESTADO" 2>/dev/null
  # El latido: la API lo lee y el panel dice si el vigía está corriendo. Si su
  # cron se rompe, este es el único lugar donde se nota.
  printf '%s\n' "$AHORA" >"$DIR/vigia.latido"
fi

if [[ ! -f "$CONF" ]]; then
  [[ "$MODO" == vigilar ]] && exit 0 # sin configurar todavía: nada que hacer
  echo "No existe $CONF: conecte el bot y vincule el grupo en /super-admin/alertas." >&2
  exit 1
fi

TOKEN=$(valor TOKEN)
CHAT_ID=$(valor CHAT_ID)
if [[ -z "$TOKEN" || -z "$CHAT_ID" ]]; then
  [[ "$MODO" == vigilar ]] && exit 0
  echo 'El bot no está conectado o el grupo no está vinculado (/super-admin/alertas).' >&2
  exit 1
fi
PANEL_URL=$(valor PANEL_URL)
QUIET_ENABLED=$(valor QUIET_ENABLED)
QUIET_FROM=$(numero "$(valor QUIET_FROM)" 22)
QUIET_TO=$(numero "$(valor QUIET_TO)" 6)
REMINDER_MINUTES=$(numero "$(valor REMINDER_MINUTES)" 60)
MAX_REMINDERS=$(numero "$(valor MAX_REMINDERS)" 3)

if [[ "$MODO" == --prueba ]]; then
  if enviar "$(printf '✅ Prueba del vigía del servidor\nSi lo leen, el vigía puede avisar aunque la API esté caída.\nServidor: %s\nEnviado: %s (%s)' \
    "$SERVIDOR" "$(fecha '%d/%m/%Y %H:%M')" "$(zona_legible)")" false; then
    echo 'Mensaje de prueba enviado.'
    exit 0
  fi
  echo 'No se pudo enviar el mensaje de prueba (ver arriba).' >&2
  exit 1
fi

# Una vuelta a la vez: si la anterior sigue (Docker colgado), esta no se monta.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$DIR/vigia.lock"
  flock -n 9 || exit 0
fi

ENVIA=1
[[ "$(valor ENABLED)" == true ]] || ENVIA=0
[[ "$(valor SERVIDOR)" == false ]] && ENVIA=0
silencio=$(numero "$(valor MUTED_UNTIL)" 0)
((silencio > AHORA)) && ENVIA=0

fin_mantenimiento=$(numero "$(cat "$MANTENIMIENTO" 2>/dev/null)" 0)
if ((fin_mantenimiento > AHORA)); then
  OMITIDOS="$OMITIDOS""contenedor_ panel "
else
  rm -f "$MANTENIMIENTO"
  vigilar_contenedores
  vigilar_panel
fi
vigilar_disco
vigilar_respaldo
resolver_los_demas
exit 0

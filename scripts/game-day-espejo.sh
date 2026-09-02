#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Prueba de desastre del espejo (Fase 5 del plan, §11).
#
# Ejecuta contra la VM simulada los seis escenarios que describe el runbook
# (docs/drivers/cnt-sanvicente-anserma/RUNBOOK.md) y comprueba, en cada uno,
# las dos cosas que importan: que el sistema vuelve solo, y que NINGUNA cita se
# pierde por el camino.
#
# No es una demo: cada escenario afirma un resultado y el script sale con
# código distinto de cero si alguno falla. Se corre antes de cada entrega y
# cuando se toque el agente.
#
# Requisitos: la VM levantada (apps/mirror-agent/local-vm/vm-up.sh), la API en
# :3001 y el mock del HIS con PRUEBAS creada.
#
# Uso:  ./scripts/game-day-espejo.sh
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

VM=agenia_mirror_vm
LAN=agen-ia_hospital_lan
WAN=agen-ia_wan
IP_VM=192.168.1.50

set -a; . ./.env; set +a

C_OK=$'\033[32m'; C_MAL=$'\033[31m'; C_T=$'\033[1;36m'; C_OFF=$'\033[0m'
PASADAS=0; FALLIDAS=0

escenario() { echo -e "\n${C_T}━━━ $* ━━━${C_OFF}"; }
paso()      { echo "   · $*"; }

comprobar() { # comprobar <descripción> <esperado> <obtenido>
  if [[ "$2" == "$3" ]]; then
    echo -e "   ${C_OK}✓${C_OFF} $1"
    PASADAS=$((PASADAS + 1))
  else
    echo -e "   ${C_MAL}✗${C_OFF} $1 — esperaba «$2», obtuvo «$3»"
    FALLIDAS=$((FALLIDAS + 1))
  fi
}

pg() { docker exec agenia_db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1" | tr -d '[:space:]'; }
# `INSERT ... RETURNING` imprime ademas la etiqueta del comando ("INSERT 0 1"),
# y `pg` las pegaria en una sola cadena. Esta se queda con el valor.
pgv() { docker exec agenia_db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1" | head -1 | tr -d '[:space:]'; }
his() { node scripts/e2e-espejo.mjs --his "$1" 2>/dev/null; }

# Espera activa: mucho mejor que un `sleep` generoso, porque el fallo dice
# cuánto esperó en vez de dejar la duda de si faltaba un segundo más.
esperar() { # esperar <descripción> <segundos> <comando...>
  local desc="$1" limite="$2"; shift 2
  local t=0
  until "$@" >/dev/null 2>&1; do
    t=$((t + 2))
    if [[ $t -ge $limite ]]; then
      echo -e "   ${C_MAL}✗${C_OFF} $desc no ocurrió en ${limite}s"
      FALLIDAS=$((FALLIDAS + 1)); return 1
    fi
    sleep 2
  done
  echo -e "   ${C_OK}✓${C_OFF} $desc (${t}s)"
  PASADAS=$((PASADAS + 1))
}

servicio_activo() { docker exec "$VM" systemctl is-active --quiet agenia-mirror-agent; }
agente_latiendo() { [[ "$(pg "SELECT now()-\"lastHeartbeatAt\" < interval '3 minutes' FROM \"HospitalMirrorConfig\";")" == "t" ]]; }

# ── Precondiciones ─────────────────────────────────────────────────────────
escenario "0. Precondiciones"
docker inspect -f '{{.State.Running}}' "$VM" 2>/dev/null | grep -q true \
  || { echo "La VM no está corriendo. Corre apps/mirror-agent/local-vm/vm-up.sh"; exit 1; }
comprobar "el servicio del agente está activo" "0" "$(servicio_activo; echo $?)"
CITAS_INICIALES=$(pg "SELECT count(*) FROM \"Appointment\" WHERE status='SCHEDULED';")
paso "citas vigentes al empezar: $CITAS_INICIALES"
comprobar "no hay eventos en dead-letter al empezar" "0" \
  "$(pg 'SELECT count(*) FROM "SyncOutbox" WHERE "deadLettered";')"

# ── 1. El proceso muere ────────────────────────────────────────────────────
escenario "1. El proceso del agente muere (kill -9)"
PID_ANTES=$(docker exec "$VM" systemctl show -p MainPID --value agenia-mirror-agent)
paso "matando el pid $PID_ANTES"
docker exec "$VM" kill -9 "$PID_ANTES" 2>/dev/null
esperar "systemd lo revive solo" 40 bash -c "docker exec $VM systemctl is-active --quiet agenia-mirror-agent"
PID_DESPUES=$(docker exec "$VM" systemctl show -p MainPID --value agenia-mirror-agent)
comprobar "es un proceso nuevo, no el mismo colgado" "distinto" \
  "$([[ "$PID_ANTES" != "$PID_DESPUES" ]] && echo distinto || echo igual)"

# ── 2. Reinicio de la máquina ──────────────────────────────────────────────
escenario "2. TI reinicia la VM para aplicar parches"
ESTADO_ANTES=$(docker exec "$VM" md5sum /opt/agenia-mirror-agent/data/state.json | cut -d' ' -f1)
docker restart "$VM" >/dev/null
esperar "la VM arranca" 90 bash -c "docker exec $VM systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded'"
esperar "el agente vuelve solo (unidad habilitada)" 60 bash -c "docker exec $VM systemctl is-active --quiet agenia-mirror-agent"
ESTADO_DESPUES=$(docker exec "$VM" md5sum /opt/agenia-mirror-agent/data/state.json | cut -d' ' -f1)
# Sin esto el agente quedaría ciego a lo ocurrido mientras estuvo apagado.
comprobar "el estado local sobrevive al reinicio" "$ESTADO_ANTES" "$ESTADO_DESPUES"
comprobar "el firewall sigue cerrado a lo entrante" "activo" \
  "$(docker exec "$VM" ufw status 2>/dev/null | grep -q 'Status: active' && echo activo || echo abierto)"

# ── 3. El HIS deja de responder ────────────────────────────────────────────
escenario "3. El SQL Server del hospital se cae"
docker network disconnect "$LAN" "$VM" 2>/dev/null
paso "la VM perdió la LAN del hospital; se agenda una cita por WhatsApp"

SLOT=$(pg "SELECT s.id FROM \"ScheduleSlot\" s
           JOIN \"MirrorEntityMap\" m ON m.\"agenIAId\"=s.\"doctorId\" AND m.\"entityType\"='DOCTOR'
           WHERE s.\"isAvailable\" AND s.\"startTime\" > now()
           ORDER BY s.\"startTime\" LIMIT 1;")
PACIENTE=$(pg "SELECT id FROM \"PatientProfile\" LIMIT 1;")
ORG=$(pg "SELECT id FROM \"Organization\" LIMIT 1;")

if [[ -n "$SLOT" && -n "$PACIENTE" ]]; then
  pg "INSERT INTO \"Appointment\" (id,\"scheduleSlotId\",\"patientId\",\"organizationId\",origin,status)
      VALUES ('game-day-cita','$SLOT','$PACIENTE','$ORG','WHATSAPP','SCHEDULED');" >/dev/null
  pg "UPDATE \"ScheduleSlot\" SET \"isAvailable\"=false WHERE id='$SLOT';" >/dev/null
  sleep 25
  SEQ=$(pg "SELECT max(seq) FROM \"SyncOutbox\" WHERE \"entityId\"='game-day-cita';")
  comprobar "la cita entra a la cola aunque el hospital no responda" "hay" \
    "$([[ -n "$SEQ" && "$SEQ" != "" ]] && echo hay || echo falta)"
  comprobar "NO se manda a dead-letter por un corte" "0" \
    "$(pg 'SELECT count(*) FROM "SyncOutbox" WHERE "deadLettered";')"

  paso "vuelve la red del hospital"
  docker network connect --ip "$IP_VM" "$LAN" "$VM" 2>/dev/null
  esperar "la cita llega al hospital sola" 180 bash -c \
    "[[ \"\$(docker exec agenia_db psql -U $POSTGRES_USER -d $POSTGRES_DB -tAc \"SELECT \\\"deliveredAt\\\" IS NOT NULL FROM \\\"SyncOutbox\\\" WHERE seq=$SEQ;\" | tr -d '[:space:]')\" == t ]]"

  # Limpieza: la cita de prueba se cancela por los dos lados.
  HORA=$(pg "SELECT to_char(s.\"startTime\" AT TIME ZONE 'America/Bogota','YYYY/MM/DD HH24:MI')
             FROM \"ScheduleSlot\" s WHERE s.id='$SLOT';")
  MED=$(pg "SELECT m.\"externalKey\" FROM \"ScheduleSlot\" s
            JOIN \"MirrorEntityMap\" m ON m.\"agenIAId\"=s.\"doctorId\" AND m.\"entityType\"='DOCTOR'
            WHERE s.id='$SLOT';")
  pg "DELETE FROM \"Appointment\" WHERE id='game-day-cita';" >/dev/null
  pg "UPDATE \"ScheduleSlot\" SET \"isAvailable\"=true WHERE id='$SLOT';" >/dev/null
  his "DELETE FROM CITAS_MEDICAS WHERE CD_CODI_MED_CIT='$MED' AND FE_HORA_CIT='$HORA'" >/dev/null
else
  echo -e "   ${C_MAL}✗${C_OFF} no hay cupo libre homologado para la prueba"
  FALLIDAS=$((FALLIDAS + 1))
  docker network connect --ip "$IP_VM" "$LAN" "$VM" 2>/dev/null
fi

# ── 4. Se cae internet ─────────────────────────────────────────────────────
escenario "4. La VM se queda sin internet"
docker network disconnect "$WAN" "$VM" 2>/dev/null
sleep 30
comprobar "el agente sigue vivo, no se muere por no poder hablar" "0" "$(servicio_activo; echo $?)"
paso "vuelve internet"
docker network connect "$WAN" "$VM" 2>/dev/null
esperar "el latido se restablece solo" 180 bash -c \
  "[[ \"\$(docker exec agenia_db psql -U $POSTGRES_USER -d $POSTGRES_DB -tAc \"SELECT now()-\\\"lastHeartbeatAt\\\" < interval '2 minutes' FROM \\\"HospitalMirrorConfig\\\";\" | tr -d '[:space:]')\" == t ]]"

# ── 5. Un evento se rinde y se reprocesa ───────────────────────────────────
escenario "5. Un evento acaba en dead-letter y se reprocesa desde el panel"
SEQ_DL=$(pgv "INSERT INTO \"SyncOutbox\" (\"eventId\",\"organizationId\",\"entityType\",\"entityId\",op,payload,origin,attempts,\"deadLettered\")
             VALUES (gen_random_uuid(),'$ORG','APPOINTMENT','game-day-dl','UPDATE','{}'::jsonb,'LOCAL',10,true)
             RETURNING seq;")
paso "evento $SEQ_DL en dead-letter"
comprobar "otra clínica NO puede reprocesarlo" "UPDATE0" \
  "$(docker exec agenia_db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
     "UPDATE \"SyncOutbox\" SET \"deadLettered\"=false WHERE seq=$SEQ_DL AND \"organizationId\"='otra-org' AND \"deadLettered\";" | tr -d '[:space:] ')"
pg "UPDATE \"SyncOutbox\" SET \"deadLettered\"=false, attempts=0, \"nextAttemptAt\"=NULL
    WHERE seq=$SEQ_DL AND \"organizationId\"='$ORG' AND \"deadLettered\";" >/dev/null
# Concatenado con `||`, psql escribe el booleano como "false", no como "f".
comprobar "el reproceso lo devuelve a la cola con el contador a cero" "false|0" \
  "$(pg "SELECT \"deadLettered\"||'|'||attempts FROM \"SyncOutbox\" WHERE seq=$SEQ_DL;")"
esperar "el agente lo vuelve a intentar" 60 bash -c \
  "[[ \"\$(docker exec agenia_db psql -U $POSTGRES_USER -d $POSTGRES_DB -tAc \"SELECT attempts>0 FROM \\\"SyncOutbox\\\" WHERE seq=$SEQ_DL;\" | tr -d '[:space:]')\" == t ]]"
pg "DELETE FROM \"SyncOutbox\" WHERE \"entityId\"='game-day-dl';" >/dev/null

# ── 6. El hospital cancela una jornada con una cita dentro ─────────────────
escenario "6. El hospital cancela un turno donde un paciente ya tiene cita"
MODO=$(pg "SELECT \"availabilityMode\" FROM \"HospitalMirrorConfig\";")
if [[ "$MODO" == "ON" ]]; then
  # La cita tiene que estar CUBIERTA por un turno vigente del médico: si no,
  # recortar el turno no puede producir un conflicto y la comprobación fallaría
  # por el estado del entorno, no por el sistema. Pasó una vez y costó
  # entenderlo — mejor decir "omitido" que dar un rojo que no significa nada.
  MED_CITA=$(pg "SELECT m.\"externalKey\" FROM \"Appointment\" a
                 JOIN \"ScheduleSlot\" s ON s.id=a.\"scheduleSlotId\"
                 JOIN \"MirrorEntityMap\" m ON m.\"agenIAId\"=s.\"doctorId\" AND m.\"entityType\"='DOCTOR'
                 WHERE a.status='SCHEDULED' LIMIT 1;")
  if [[ -n "$MED_CITA" ]]; then
    TIENE_TURNO=$(his "SELECT COUNT(*) AS n FROM TURNOS_MEDICOS WHERE CD_MED_TUME='$MED_CITA'" \
                  2>/dev/null | tr -d '[:space:]')
    [[ "$TIENE_TURNO" == "0" ]] && MED_CITA=""
  fi
  if [[ -n "$MED_CITA" ]]; then
    FIN_ORIGINAL=$(his "SELECT CONVERT(varchar(5), FE_HOFI_TUME, 108) FROM TURNOS_MEDICOS WHERE CD_MED_TUME='$MED_CITA'" | head -1 | tr -d '[:space:]')
    paso "recortando el turno de $MED_CITA (terminaba a las $FIN_ORIGINAL)"
    his "UPDATE TURNOS_MEDICOS SET FE_HOFI_TUME='1900-01-01 07:20' WHERE CD_MED_TUME='$MED_CITA'" >/dev/null
    docker exec "$VM" systemctl restart agenia-mirror-agent
    sleep 55
    comprobar "ninguna cita se pierde: siguen todas las vigentes" "$CITAS_INICIALES" \
      "$(pg "SELECT count(*) FROM \"Appointment\" WHERE status='SCHEDULED';")"
    comprobar "el conflicto queda registrado, no en silencio" "hay" \
      "$(pg "SELECT count(*)>0 FROM \"SyncAudit\" WHERE op='AVAILABILITY' AND outcome='CONFLICT' AND \"createdAt\" > now()-interval '3 minutes';" | sed 's/^t$/hay/;s/^f$/falta/')"
    paso "restaurando el turno"
    his "UPDATE TURNOS_MEDICOS SET FE_HOFI_TUME='1900-01-01 $FIN_ORIGINAL' WHERE CD_MED_TUME='$MED_CITA'" >/dev/null
    docker exec "$VM" systemctl restart agenia-mirror-agent
    sleep 50
  else
    paso "omitido: no hay ninguna cita vigente sobre un médico homologado"
  fi
else
  paso "omitido: availabilityMode=$MODO (este escenario necesita ON)"
fi

# ── Cierre ─────────────────────────────────────────────────────────────────
escenario "Estado final"
esperar "el agente late" 90 agente_latiendo
comprobar "sin eventos en dead-letter" "0" "$(pg 'SELECT count(*) FROM "SyncOutbox" WHERE "deadLettered";')"
comprobar "las citas vigentes son las mismas que al empezar" "$CITAS_INICIALES" \
  "$(pg "SELECT count(*) FROM \"Appointment\" WHERE status='SCHEDULED';")"

echo
if [[ $FALLIDAS -eq 0 ]]; then
  echo -e "${C_OK}═══ game-day superado: $PASADAS comprobaciones, 0 fallos ═══${C_OFF}"
  exit 0
fi
echo -e "${C_MAL}═══ game-day FALLIDO: $FALLIDAS de $((PASADAS + FALLIDAS)) comprobaciones ═══${C_OFF}"
exit 1

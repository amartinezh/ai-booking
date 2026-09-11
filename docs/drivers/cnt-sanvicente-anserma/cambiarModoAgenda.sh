#!/usr/bin/env bash
# =============================================================================
# cambiarModoAgenda.sh — muestra el estado actual de `HospitalMirrorConfig`
# y, mediante un menú, cambia `availabilityMode` entre OFF / SHADOW / ON.
#
#   OFF    — no se toca ScheduleSlot; la agenda de AgenIA sigue siendo la suya.
#   SHADOW — se calcula la rejilla del HIS y se REPORTAN las diferencias sin
#            escribir nada. El plan pide mínimo una semana aquí antes de ON.
#   ON     — la agenda de AgenIA PASA A SER la del hospital de verdad.
#
# (ver RUNBOOK.md "La agenda de AgenIA no es la del hospital" e
# INSTALACION_AGENTE_VPS.md §11 — este script es solo el paso 1/2 de ahí:
# el UPDATE. La carga inicial con --seed-inicial sigue siendo manual, en el
# VPS del hospital, y este script te recuerda el comando exacto si pasas a ON.)
#
# QUÉ HACE (☁️, corre desde tu portátil, SIN túnel — es un solo UPDATE/SELECT
# vía `docker compose exec postgres psql`, el mismo patrón que ya usan
# RUNBOOK.md e INSTALACION_AGENTE_VPS.md para esto):
#   1. Lee y muestra el estado actual (enabled, availabilityMode, push/pull,
#      si el agente alcanza el HIS, hace cuánto fue el último latido).
#   2. Si el modo actual es SHADOW u ON, muestra el historial de
#      comparación (SyncAudit, op='AVAILABILITY'): cuántas pasadas hay,
#      desde cuándo, cuántas con CONFLICT, y el detalle de las últimas 10
#      (creados/actualizados/borrados/cerrados por pasada) — es la
#      evidencia real para decidir si ya toca ON, no una corazonada.
#   3. Te deja elegir OFF / SHADOW / ON / cancelar, con el actual marcado.
#   4. Si elegiste el mismo modo actual, no hace nada.
#   5. Pasar a ON pide escribir ENCENDER (no un simple s/N) — es la
#      transición de mayor riesgo: agenda real contra pacientes reales.
#      Cualquier otra transición pide una confirmación simple.
#   6. Aplica el UPDATE y vuelve a leer el estado para confirmar que quedó.
#
# USO
#   ./cambiarModoAgenda.sh
#   ORGANIZATION_ID=<otro-id> ./cambiarModoAgenda.sh
# =============================================================================
set -Eeuo pipefail

SSH_KEY="${MIRROR_SSH_KEY:-$HOME/.ssh/agenia_89_117_61_28_ed25519}"
VPS_IP="${MIRROR_VPS_IP:-89.117.61.28}"
REMOTE_DIR="${MIRROR_REMOTE_DIR:-/opt/agenia}"
ORGANIZATION_ID="${ORGANIZATION_ID:-97f18182-d0d9-4a3b-9eb6-4fbc031b917c}"

if [[ -t 1 ]]; then
  G=$'\033[0;32m'; Y=$'\033[0;33m'; R=$'\033[0;31m'; B=$'\033[1;34m'; N=$'\033[0m'
else G=''; Y=''; R=''; B=''; N=''; fi
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
err()  { printf '  %s✘%s %s\n' "$R" "$N" "$*" >&2; }
head1(){ printf '\n%s── %s%s\n' "$B" "$*" "$N"; }
die()  { err "$*"; exit 1; }

[[ -f "$SSH_KEY" ]] || die "No existe la llave SSH: $SSH_KEY"
command -v ssh >/dev/null 2>&1 || die "Falta 'ssh' en este portátil."

ssh_cloud() { ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "root@$VPS_IP" "$@"; }

# psql sin alinear, separado por '|' — fácil de parsear en bash (mismo
# patrón que checkHealth.sh).
psql_row() {
  ssh_cloud "
    cd '$REMOTE_DIR'
    docker compose --env-file .env.production -f docker-compose.deploy.yml \
      exec -T postgres psql -U agenia -d antigravity -tA -F'|' -c \"$1\"
  "
}
psql_exec() {
  ssh_cloud "
    cd '$REMOTE_DIR'
    docker compose --env-file .env.production -f docker-compose.deploy.yml \
      exec -T postgres psql -U agenia -d antigravity -c \"$1\"
  "
}

# 🚨 lastHeartbeatAt es `timestamp` SIN zona (Prisma guarda los dígitos UTC
# tal cual — ver CLAUDE.md, regla de fechas). Restar `now()` directo dispara
# un cast implícito con el TimeZone de LA SESIÓN (America/Bogota aquí), no
# UTC, y desplaza el resultado ~5h. Se convierte `now()` a naive-UTC ANTES de
# restar — mismo fix que ya usa checkHealth.sh.
leer_estado() {
  psql_row "SELECT enabled, \\\"availabilityMode\\\", \\\"pushEnabled\\\", \\\"pullEnabled\\\", \\\"lastHisReachable\\\", coalesce(\\\"lastHisDetail\\\",''), EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - \\\"lastHeartbeatAt\\\"))::int FROM \\\"HospitalMirrorConfig\\\" WHERE \\\"organizationId\\\" = '$ORGANIZATION_ID';"
}

mostrar_estado() {
  local row; row="$(leer_estado)"
  [[ -n "$row" ]] || die "No existe HospitalMirrorConfig para $ORGANIZATION_ID"
  IFS='|' read -r ENABLED AVAIL PUSH PULL HIS_OK HIS_DETAIL LATIDO_SEG <<<"$row"

  echo "  organización: $ORGANIZATION_ID"
  [[ "$ENABLED" == "t" ]] && ok "espejo enabled=true" || err "espejo enabled=false — el guard rechaza TODO con 401, nada de esto importa hasta encenderlo"
  echo "  availabilityMode actual: ${B}${AVAIL}${N}"
  echo "  pushEnabled=$PUSH  pullEnabled=$PULL"
  if [[ -n "$LATIDO_SEG" && "$LATIDO_SEG" =~ ^[0-9]+$ && "$LATIDO_SEG" -lt 120 ]]; then
    ok "latido reciente (hace ${LATIDO_SEG}s)"
  else
    warn "sin latido reciente (hace ${LATIDO_SEG:-?}s) — el agente no está reportando ahora mismo"
  fi
  [[ "$HIS_OK" == "t" ]] && ok "el agente alcanza el SQL Server del HIS" \
    || warn "lastHisReachable=$HIS_OK ${HIS_DETAIL:+— $HIS_DETAIL}"
}

# El detalle de cada pasada es un JSON serializado como texto (`detail String?
# @db.Text`, no una columna jsonb) — `::json->>'campo'` lo parsea al vuelo.
# Estos cuatro nombres salen de AvailabilityResult (packages/shared/mirror-protocol.ts):
# created/updated/removed/retired. outcome es 'CONFLICT' si esa pasada
# encontró una cita de AgenIA en una hora que el hospital ya no tiene
# (mirror-availability.service.ts) — 'OK' en cualquier otro caso.
mostrar_shadow_audit() {
  head1 "Historial de comparación (SyncAudit, op='AVAILABILITY')"
  local resumen
  resumen="$(psql_row "SELECT count(*), min(\\\"createdAt\\\"), max(\\\"createdAt\\\"), count(*) FILTER (WHERE outcome = 'CONFLICT') FROM \\\"SyncAudit\\\" WHERE \\\"organizationId\\\" = '$ORGANIZATION_ID' AND op = 'AVAILABILITY';")"
  local total desde hasta conflictos
  IFS='|' read -r total desde hasta conflictos <<<"$resumen"

  if [[ "${total:-0}" == "0" ]]; then
    warn "Todavía no hay ninguna pasada registrada — el barrido corre mientras el modo no sea OFF; espera al siguiente ciclo."
    return
  fi

  echo "  $total pasada(s) registrada(s), desde $desde hasta $hasta."
  if [[ "${conflictos:-0}" == "0" ]]; then
    ok "0 pasada(s) con CONFLICT — ninguna cita de AgenIA quedó en una hora que el hospital ya no tiene"
  else
    warn "$conflictos pasada(s) con CONFLICT — revisa el detalle abajo antes de decidir ON"
  fi

  echo
  psql_exec "SELECT \\\"createdAt\\\" AS fecha, outcome, (detail::json->>'created') AS creados, (detail::json->>'updated') AS actualizados, (detail::json->>'removed') AS borrados, (detail::json->>'retired') AS cerrados FROM \\\"SyncAudit\\\" WHERE \\\"organizationId\\\" = '$ORGANIZATION_ID' AND op = 'AVAILABILITY' ORDER BY \\\"createdAt\\\" DESC LIMIT 10;" \
    | sed 's/^/  /'
}

head1 "Estado actual"
mostrar_estado
CURRENT_AVAIL="$AVAIL"

if [[ "$CURRENT_AVAIL" == "SHADOW" || "$CURRENT_AVAIL" == "ON" ]]; then
  mostrar_shadow_audit
fi

head1 "¿A qué modo quieres pasar?"
PS3="  Elige una opción: "
etiqueta() { [[ "$1" == "$CURRENT_AVAIL" ]] && echo "$1  (actual)" || echo "$1"; }
OPTS=("$(etiqueta OFF)" "$(etiqueta SHADOW)" "$(etiqueta ON)" "Cancelar — no cambiar nada")
select OPT in "${OPTS[@]}"; do
  case "$REPLY" in
    1) TARGET=OFF; break ;;
    2) TARGET=SHADOW; break ;;
    3) TARGET=ON; break ;;
    4) echo "Cancelado."; exit 0 ;;
    *) echo "  Opción inválida, elige un número de la lista." ;;
  esac
done

if [[ "$TARGET" == "$CURRENT_AVAIL" ]]; then
  ok "Ya está en $TARGET — no hay nada que cambiar."
  exit 0
fi

head1 "Vas a pasar de $CURRENT_AVAIL a $TARGET"
case "$TARGET" in
  ON)
    cat <<EOF

  ${R}Esto hace que la agenda de AgenIA SEA la del hospital de verdad.${N}
  El plan pide mínimo UNA SEMANA en SHADOW comparando contra la pantalla
  real de agenda del hospital antes de llegar aquí (ver RUNBOOK.md) — mira
  el historial de arriba: cuántos días cubre y si hubo pasadas con
  CONFLICT. Si no alcanza la semana o el historial no se ve limpio,
  cancela y espera a que corran más pasadas.

  Después de aplicar esto, falta la CARGA INICIAL (🏥, en el VPS del
  hospital, servicio detenido) para no esperar a que el barrido diario
  recorra 400 días a su ritmo:

    sudo systemctl stop agenia-mirror-agent
    sudo -u mirroragent bash -c 'set -a; . /etc/agenia-mirror-agent/agent.env; set +a; \\
      cd /opt/agenia-mirror-agent && exec node dist/index.js --seed-inicial'
    sudo systemctl start agenia-mirror-agent

EOF
    read -r -p "  Escribe ENCENDER para confirmar, cualquier otra cosa cancela: " CONFIRM
    [[ "$CONFIRM" == "ENCENDER" ]] || { warn "Cancelado — no se cambió nada."; exit 0; }
    ;;
  SHADOW)
    echo "  Solo compara y reporta en SyncAudit (op='AVAILABILITY') — no escribe ScheduleSlot."
    read -r -p "  ¿Continuar? [s/N]: " CONFIRM
    [[ "$CONFIRM" =~ ^[sS] ]] || { warn "Cancelado — no se cambió nada."; exit 0; }
    ;;
  OFF)
    echo "  La agenda de AgenIA vuelve a ser la suya — se deja de comparar/escribir."
    read -r -p "  ¿Continuar? [s/N]: " CONFIRM
    [[ "$CONFIRM" =~ ^[sS] ]] || { warn "Cancelado — no se cambió nada."; exit 0; }
    ;;
esac

head1 "Aplicando"
psql_exec "UPDATE \\\"HospitalMirrorConfig\\\" SET \\\"availabilityMode\\\" = '$TARGET' WHERE \\\"organizationId\\\" = '$ORGANIZATION_ID';" \
  | sed 's/^/  /'

head1 "Estado después del cambio"
mostrar_estado
ok "Listo — availabilityMode = $TARGET."

if [[ "$TARGET" == "ON" ]]; then
  warn "No olvides la carga inicial (arriba) — sin ella, la agenda solo se irá llenando al ritmo del barrido diario."
fi

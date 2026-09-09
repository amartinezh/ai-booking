#!/usr/bin/env bash
# =============================================================================
# checkHealth.sh — auditoría de salud del espejo con el HIS de San Vicente de
# Paúl (Anserma), lado NUBE únicamente.
#
# POR QUÉ EXISTE
# El agente vive en el VPS del hospital (192.168.1.175), inalcanzable desde
# fuera de su LAN (§0 de INSTALACION_AGENTE_VPS.md) — solo se llega por
# AnyDesk → estación Windows → SSH interno, un salto manual que este script
# NO puede automatizar. Este script cubre todo lo que SÍ se ve desde fuera:
# la configuración y la actividad que el agente reporta a la nube. Al final
# imprime, sin ejecutarlos, los comandos que faltan correr del lado del
# hospital — así el informe queda completo aunque la ejecución esté partida
# en dos.
#
# QUÉ CHEQUEA (☁️, todo de solo lectura — ningún UPDATE/DELETE)
#   1. Estado de HospitalMirrorConfig (enabled, availabilityMode, latido...)
#   2. Cola de sincronización (SyncOutbox): pendientes y dead-letters
#   3. Cobertura de homologación (MirrorCatalogEntry vs MirrorEntityMap)
#   4. Últimas 5 reconciliaciones (SyncAudit, direction='RECONCILE')
#   5. Últimas 5 pasadas de agenda/SHADOW (SyncAudit, op='AVAILABILITY')
#   6. Padrón y médicos activos por WhatsApp (sanity antes del día 1)
#   7. `agenia verify` — salud del stack Docker completo
#
# No necesita el túnel SSH ni ninguna contraseña de Postgres: corre dentro
# del propio contenedor vía `docker compose exec`, igual que todos los
# comandos ssh+docker+psql de INSTALACION_AGENTE_VPS.md y RUNBOOK.md.
#
# Uso:
#   ./checkHealth.sh
#   MIRROR_ORG_ID=<otro-id> ./checkHealth.sh    # para otro hospital/org
#
# Genera un informe en texto plano: checkHealth-<fecha>.txt, en el directorio
# desde donde se corre.
# =============================================================================
set -Eeuo pipefail

SSH_KEY="${MIRROR_SSH_KEY:-$HOME/.ssh/agenia_89_117_61_28_ed25519}"
VPS_IP="${MIRROR_VPS_IP:-89.117.61.28}"
ORG_ID="${MIRROR_ORG_ID:-97f18182-d0d9-4a3b-9eb6-4fbc031b917c}"
REMOTE_DIR="${MIRROR_REMOTE_DIR:-/opt/agenia}"
REPORT="checkHealth-$(date +%Y%m%d-%H%M%S).txt"

FAILS=0
WARNS=0

ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [!]    %s\n' "$*"; WARNS=$((WARNS+1)); }
err()  { printf '  [FAIL] %s\n' "$*"; FAILS=$((FAILS+1)); }
head1(){ printf '\n== %s ==\n' "$*"; }

[[ -f "$SSH_KEY" ]] || { echo "No existe la llave SSH: $SSH_KEY"; exit 2; }

ssh_do() {
  ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "root@$VPS_IP" "$@"
}

# psql sin alinear, separado por '|' — fácil de parsear en bash.
psql_row() {
  ssh_do "
    cd '$REMOTE_DIR'
    docker compose --env-file .env.production -f docker-compose.deploy.yml \
      exec -T postgres psql -U agenia -d antigravity -tA -F'|' -c \"$1\"
  "
}

# psql con salida normal (alineada), para tablas informativas del informe.
psql_table() {
  ssh_do "
    cd '$REMOTE_DIR'
    docker compose --env-file .env.production -f docker-compose.deploy.yml \
      exec -T postgres psql -U agenia -d antigravity -c \"$1\"
  "
}

{
echo "checkHealth — espejo San Vicente de Paúl (Anserma)"
echo "Generado: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "Organización: $ORG_ID"

head1 "1) Verificando conexión a la nube"
if ssh_do 'echo ok' >/dev/null 2>&1; then
  ok "SSH a $VPS_IP responde"
else
  err "No se pudo conectar a $VPS_IP con $SSH_KEY"
  echo; echo "No se puede continuar sin esta conexión."; exit 1
fi

head1 "2) Estado de HospitalMirrorConfig"
# 🚨 lastHeartbeatAt es `timestamp` SIN zona — Prisma guarda ahí los dígitos
# UTC tal cual (ver CLAUDE.md, regla de fechas). Restarle `now()` directo
# fuerza un cast implícito que Postgres resuelve con el TimeZone de LA
# SESIÓN (America/Bogota aquí), no UTC, y desplaza el resultado ~5h. El fix
# es convertir `now()` a naive-UTC ANTES de restar, para que sea una resta
# naive-contra-naive sin reinterpretación de zona.
CFG="$(psql_row "SELECT enabled, \\\"availabilityMode\\\", \\\"pushEnabled\\\", \\\"pullEnabled\\\", EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - \\\"lastHeartbeatAt\\\"))::int, \\\"lastHisReachable\\\", coalesce(\\\"lastHisDetail\\\",'') FROM \\\"HospitalMirrorConfig\\\" WHERE \\\"organizationId\\\" = '$ORG_ID';")"
if [[ -z "$CFG" ]]; then
  err "No existe HospitalMirrorConfig para $ORG_ID"
else
  IFS='|' read -r ENABLED AVAIL PUSH PULL LATIDO_SEG HIS_OK HIS_DETAIL <<<"$CFG"
  echo "  enabled=$ENABLED  availabilityMode=$AVAIL  pushEnabled=$PUSH  pullEnabled=$PULL"
  echo "  latido hace ${LATIDO_SEG}s  lastHisReachable=$HIS_OK  detalle=\"$HIS_DETAIL\""
  [[ "$ENABLED" == "t" ]] && ok "Espejo habilitado" || err "enabled=false — el guard rechaza TODO con 401"
  if [[ -n "$LATIDO_SEG" && "$LATIDO_SEG" =~ ^[0-9]+$ && "$LATIDO_SEG" -lt 120 ]]; then
    ok "Latido reciente (${LATIDO_SEG}s)"
  else
    err "Sin latido reciente (${LATIDO_SEG:-null}s) — el agente no está reportando"
  fi
  [[ "$HIS_OK" == "t" ]] && ok "El agente alcanza el SQL Server del HIS" \
    || warn "lastHisReachable=$HIS_OK — revisar conectividad del lado del hospital"
  case "$AVAIL" in
    OFF)    warn "availabilityMode=OFF — la agenda de AgenIA sigue siendo la suya" ;;
    SHADOW) ok "availabilityMode=SHADOW — comparando sin escribir" ;;
    ON)     ok "availabilityMode=ON — la agenda de AgenIA es la del hospital" ;;
  esac
fi

head1 "3) Cola de sincronización (SyncOutbox)"
Q="$(psql_row "SELECT count(*) FILTER (WHERE \\\"deliveredAt\\\" IS NULL AND NOT \\\"deadLettered\\\"), count(*) FILTER (WHERE \\\"deadLettered\\\") FROM \\\"SyncOutbox\\\" WHERE \\\"organizationId\\\" = '$ORG_ID';")"
IFS='|' read -r PENDIENTES DEADLETTERS <<<"$Q"
echo "  pendientes=$PENDIENTES  dead_letters=$DEADLETTERS"
[[ "$DEADLETTERS" == "0" ]] && ok "Sin dead-letters" || err "$DEADLETTERS evento(s) en dead-letter — revisar panel/RUNBOOK.md"
if [[ "$DEADLETTERS" != "0" ]]; then
  echo "  Detalle:"
  psql_table "SELECT seq, \\\"entityType\\\", op, attempts, \\\"createdAt\\\" FROM \\\"SyncOutbox\\\" WHERE \\\"organizationId\\\" = '$ORG_ID' AND \\\"deadLettered\\\" ORDER BY seq;" | sed 's/^/  /'
fi

head1 "4) Homologación (catálogo del HIS vs MirrorEntityMap)"
psql_table "SELECT c.\\\"entityType\\\", count(*) AS total_catalogo, count(m.\\\"agenIAId\\\") AS homologados FROM \\\"MirrorCatalogEntry\\\" c LEFT JOIN \\\"MirrorEntityMap\\\" m ON m.\\\"organizationId\\\" = c.\\\"organizationId\\\" AND m.\\\"entityType\\\" = c.\\\"entityType\\\" AND m.\\\"externalKey\\\" = c.\\\"externalKey\\\" WHERE c.\\\"organizationId\\\" = '$ORG_ID' GROUP BY c.\\\"entityType\\\";" | sed 's/^/  /'

head1 "5) Reconciliación — últimas 5 pasadas"
psql_table "SELECT \\\"createdAt\\\", outcome, left(detail, 100) AS detalle FROM \\\"SyncAudit\\\" WHERE \\\"organizationId\\\" = '$ORG_ID' AND direction = 'RECONCILE' ORDER BY \\\"createdAt\\\" DESC LIMIT 5;" | sed 's/^/  /'

head1 "6) Agenda / SHADOW — últimas 5 pasadas"
psql_table "SELECT \\\"createdAt\\\", outcome, left(detail, 100) AS detalle FROM \\\"SyncAudit\\\" WHERE \\\"organizationId\\\" = '$ORG_ID' AND op = 'AVAILABILITY' ORDER BY \\\"createdAt\\\" DESC LIMIT 5;" | sed 's/^/  /'

head1 "7) Sanity — padrón y activación WhatsApp (aún sin encender)"
S="$(psql_row "SELECT (SELECT count(*) FROM \\\"EpsEnrolledPatient\\\" WHERE \\\"organizationId\\\" = '$ORG_ID'), (SELECT count(*) FROM \\\"DoctorProfile\\\" WHERE \\\"organizationId\\\" = '$ORG_ID' AND \\\"whatsappBookingEnabled\\\"), (SELECT count(*) FROM \\\"DoctorProfile\\\" WHERE \\\"organizationId\\\" = '$ORG_ID');")"
IFS='|' read -r PADRON MED_WA MED_TOTAL <<<"$S"
echo "  padrón=$PADRON  médicos_con_whatsapp=$MED_WA  médicos_totales=$MED_TOTAL"
[[ "$PADRON" == "0" ]] && warn "Padrón vacío — pendiente conocido, bloquea agendamiento real" || ok "Padrón con $PADRON paciente(s)"
[[ "$MED_WA" == "0" ]] && ok "Ningún médico activo por WhatsApp todavía (esperado, aún no se usa)" \
  || warn "$MED_WA médico(s) YA activos por WhatsApp — confirmar que es intencional"

head1 "8) Salud del stack Docker (agenia verify)"
if ssh_do 'agenia verify' 2>&1 | sed 's/^/  /'; then
  ok "agenia verify sin fallos"
else
  err "agenia verify reportó fallos — ver detalle arriba"
fi

head1 "9) PENDIENTE — solo se puede correr desde dentro del hospital (🏥)"
cat <<'EOF'
  Este script NO puede alcanzar 192.168.1.175 (sin entrada desde internet a
  propósito). Correr manualmente vía AnyDesk → estación Windows → SSH:

    systemctl status agenia-mirror-agent --no-pager
    journalctl -u agenia-mirror-agent --since yesterday --no-pager \
      | grep -iE "error|fatal|🚨|falló" | sort | uniq -c | sort -rn
    nc -zv 192.168.1.16 1433
    curl -sI https://app.hsvpanserma.agenia.co | head -1
EOF

head1 "Resumen"
echo "  Fallos: $FAILS   Avisos: $WARNS"
if [[ "$FAILS" -eq 0 ]]; then
  echo "  Todo lo verificable desde la nube está sano."
else
  echo "  Hay $FAILS punto(s) que requieren atención — ver arriba."
fi

} | tee "$REPORT"

echo
echo "Informe guardado en: $REPORT"
[[ "$FAILS" -eq 0 ]]

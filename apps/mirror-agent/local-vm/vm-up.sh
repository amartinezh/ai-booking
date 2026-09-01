#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Levanta la VM simulada del hospital y despliega el agente en ella.
#
# Lo que arma, desde el lado del host:
#
#     ┌─ LAN del hospital (192.168.1.0/24) ─┐   ┌─ salida a internet ─┐
#     │  agenia_mirror_vm     .50           │   │  api.agenia.local   │
#     │  agenia_mirror_his_mock .16:1433    │   │  (Caddy, TLS propio)│
#     └─────────────────────────────────────┘   └──────────┬──────────┘
#                                                          │
#                                             apps/api en el host :3001
#
# La nube (Postgres, API) NO está en la LAN del hospital y la VM no publica
# un solo puerto: la única forma de comunicación es la que el diseño promete,
# HTTPS saliente desde el agente.
#
# Uso:  ./apps/mirror-agent/local-vm/vm-up.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../../.."

VM=agenia_mirror_vm
EDGE=agenia_edge
MOCK=agenia_mirror_his_mock

paso() { echo -e "\n\033[1;36m▸ $*\033[0m"; }
ok()   { echo -e "  \033[32m✓\033[0m $*"; }
fatal(){ echo -e "\n\033[1;31m✗ $*\033[0m\n" >&2; exit 1; }

esperar() { # esperar <descripción> <segundos> <comando...>
  local desc="$1" limite="$2"; shift 2
  local t=0
  until "$@" >/dev/null 2>&1; do
    t=$((t+2)); [[ $t -ge $limite ]] && fatal "$desc no respondió en ${limite}s."
    sleep 2
  done
  ok "$desc (${t}s)"
}

# ─── 0. Precondiciones ─────────────────────────────────────────────────────
paso "0. Precondiciones"
[[ -f .env ]] || fatal "Falta .env en la raíz. Corre ./scripts/up.sh primero."
set -a; . ./.env; set +a
curl -sf -o /dev/null -X POST http://localhost:3001/mirror/handshake -d '{}' \
  -H 'content-type: application/json' -w '' 2>/dev/null || true
curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/mirror/handshake \
  | grep -q '^[0-9]' || fatal "La API no responde en :3001. Arráncala con: pnpm --filter api start:dev"
ok "API viva en :3001"

# ─── 1. Empaquetar el agente ───────────────────────────────────────────────
# Exactamente lo que dice deploy/README.md §2: lo que se copia a la VM es el
# bundle de esbuild, no el árbol de node_modules.
paso "1. Empaquetando el agente (esbuild)"
pnpm --filter @agenia/shared build >/dev/null
pnpm --filter @agenia/mirror-agent bundle >/dev/null
ok "dist/agent.bundle.js ($(du -h apps/mirror-agent/dist/agent.bundle.js | cut -f1))"

# ─── 2. Infraestructura ────────────────────────────────────────────────────
paso "2. Levantando VM, borde HTTPS y SQL Server del hospital"
docker compose --profile vm up -d --build mirror-vm agenia-edge mirror-his-mock 2>&1 \
  | grep -Ev '^\s*$' | tail -5
esperar "SQL Server del hospital" 180 \
  docker exec "$MOCK" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa \
    -P "$MIRROR_HIS_MOCK_SA_PASSWORD" -C -Q "SELECT 1"
esperar "systemd dentro de la VM" 60 \
  bash -c "docker exec $VM systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded'"

# ─── 3. CA del borde ───────────────────────────────────────────────────────
paso "3. CA interna del borde HTTPS"
esperar "Caddy emitió su CA" 60 docker exec "$EDGE" test -f /data/caddy/pki/authorities/local/root.crt
docker exec "$EDGE" cat /data/caddy/pki/authorities/local/root.crt > /tmp/agenia-edge-ca.crt
ok "root.crt extraído ($(wc -c < /tmp/agenia-edge-ca.crt) bytes)"

# ─── 4. Credenciales del HIS y token del agente ────────────────────────────
# El agente de la VM usa el driverConfig DE PRODUCCIÓN (MIRROR_HIS_TARGET=hospital
# → 192.168.1.16:1433): en la LAN simulada esa IP es el mock. El cutover al
# hospital real no cambia ni un carácter de esta configuración.
paso "4. Provisionando HospitalMirrorConfig para la VM"
if [[ -z "${AGENIA_SYNC_PASSWORD:-}" ]]; then
  # Sin la contraseña a mano se rota la del login del mock: es una credencial
  # de desarrollo y rotarla no borra ningún dato (a diferencia de re-correr
  # setup.ts, que recrea PRUEBAS entera).
  AGENIA_SYNC_PASSWORD="Vm$(openssl rand -hex 12)!"
  docker exec "$MOCK" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa \
    -P "$MIRROR_HIS_MOCK_SA_PASSWORD" -C \
    -Q "ALTER LOGIN agenia_sync WITH PASSWORD = '${AGENIA_SYNC_PASSWORD}';" >/dev/null
  ok "contraseña de agenia_sync rotada en el mock"
fi
# `npx tsx` NO sirve: tsx es devDependency de packages/database y npx no lo
# resuelve desde la raíz del workspace (falla con "tsx: command not found").
TOKEN=$(MIRROR_HIS_TARGET=hospital AGENIA_SYNC_PASSWORD="$AGENIA_SYNC_PASSWORD" \
  pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts \
  "$(docker exec agenia_db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
     'SELECT id FROM "Organization" LIMIT 1;' | tr -d '[:space:]')" \
  | grep '^mirror_')
[[ -n "$TOKEN" ]] || fatal "No se obtuvo el token del agente."
ok "token emitido (${#TOKEN} chars)"

# ─── 5. Desplegar en la VM ─────────────────────────────────────────────────
paso "5. Copiando artefactos a la VM"
docker cp apps/mirror-agent/dist/agent.bundle.js        "$VM:/tmp/agent.bundle.js"
docker cp apps/mirror-agent/deploy/mirror-agent.service "$VM:/tmp/mirror-agent.service"
docker cp apps/mirror-agent/local-vm/provision.sh       "$VM:/tmp/provision.sh"
docker cp /tmp/agenia-edge-ca.crt                       "$VM:/tmp/agenia-edge-ca.crt"
ok "bundle, unidad systemd, CA y provisioning en /tmp de la VM"

paso "6. Provisionando la VM (deploy/README.md §1–§4)"
docker exec \
  -e MIRROR_API_URL="https://api.agenia.local" \
  -e MIRROR_AGENT_TOKEN="$TOKEN" \
  -e MIRROR_DRIVER_KEY="cnt-sanvicente-anserma" \
  "$VM" bash /tmp/provision.sh

rm -f /tmp/agenia-edge-ca.crt
echo -e "\033[1;32m═══ VM lista ═══\033[0m"
echo "  Logs:    docker exec $VM journalctl -u agenia-mirror-agent -f"
echo "  Estado:  docker exec $VM systemctl status agenia-mirror-agent"
echo "  Consola: docker exec -it $VM bash"

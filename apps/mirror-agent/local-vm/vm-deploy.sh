#!/usr/bin/env bash
# Redespliegue del agente en la VM ya provisionada — el bucle corto de
# desarrollo, y también el procedimiento real de actualización en el hospital:
# empaquetar, copiar el bundle, reiniciar el servicio. Nada más.
#
# Para la primera vez (crear la VM, provisionar, emitir token) usa vm-up.sh.
set -euo pipefail
cd "$(dirname "$0")/../../.."
VM=agenia_mirror_vm

docker inspect -f '{{.State.Running}}' "$VM" 2>/dev/null | grep -q true \
  || { echo "La VM no está corriendo. Usa vm-up.sh." >&2; exit 1; }

pnpm --filter @agenia/shared build >/dev/null
pnpm --filter @agenia/mirror-agent bundle >/dev/null
docker cp apps/mirror-agent/dist/agent.bundle.js "$VM:/tmp/agent.bundle.js"
docker exec "$VM" install -o mirroragent -g mirroragent -m 0755 \
  /tmp/agent.bundle.js /opt/agenia-mirror-agent/dist/index.js
docker exec "$VM" systemctl restart agenia-mirror-agent
sleep 3
docker exec "$VM" systemctl is-active agenia-mirror-agent >/dev/null \
  && echo "✓ agente redesplegado y activo" \
  || { docker exec "$VM" journalctl -u agenia-mirror-agent -n 20 --no-pager; exit 1; }

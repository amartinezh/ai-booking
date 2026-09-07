#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Provisioning del agente DENTRO de la VM. Corre como root, una sola vez.
#
# Esto NO es un script de conveniencia: es `apps/mirror-agent/deploy/README.md`
# convertido en algo ejecutable. Cada bloque corresponde a una sección del
# runbook y lleva su número. Si el runbook está mal, esto falla — que es el
# punto de tener la VM simulada.
#
# Espera encontrar, puestos por vm-up.sh desde el host:
#   /tmp/agent.bundle.js        el agente empaquetado (esbuild)
#   /tmp/agenia-edge-ca.crt     la CA del borde HTTPS (en producción: no hace
#                               falta, salvo que el hospital intercepte TLS)
# y en el entorno: MIRROR_API_URL, MIRROR_AGENT_TOKEN, MIRROR_DRIVER_KEY.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

paso() { echo -e "\n\033[1;36m▸ $*\033[0m"; }
ok()   { echo -e "  \033[32m✓\033[0m $*"; }

: "${MIRROR_API_URL:?falta MIRROR_API_URL}"
: "${MIRROR_AGENT_TOKEN:?falta MIRROR_AGENT_TOKEN}"
: "${MIRROR_DRIVER_KEY:=cnt-sanvicente-anserma}"

# ─── §1  Preparar el host ──────────────────────────────────────────────────
# Node >= 22, la misma versión que exige deploy/README.md §1 y que usa el CI.
# NO Node 20: entró en fin de vida en abril de 2026, y esta VM existe para
# probar el despliegue REAL — instalar aquí un runtime distinto del que irá al
# hospital haría que la prueba validara otra cosa.
#
# Mismo orden de preferencia que el runbook: primero lo que trae la distro
# (parches por apt, sin repos de terceros que justificarle a TI), y solo si se
# queda corta, NodeSource. Ubuntu 26.04 del hospital trae 22.22.1; el 22.04 de
# esta imagen trae 12, así que aquí cae por la segunda vía — y eso está bien:
# ejercita justamente la rama que necesitará un cliente con una distro pobre.
MAJOR_MINIMO=22
paso "§1 Node >= ${MAJOR_MINIMO} LTS"

version_mayor() { node --version 2>/dev/null | sed 's/^v//; s/\..*//'; }
suficiente()    { [[ -n "$(version_mayor)" && "$(version_mayor)" -ge $MAJOR_MINIMO ]]; }

if ! suficiente; then
  apt-get update >/dev/null 2>&1 || true
  apt-get install -y nodejs >/dev/null 2>&1 || true
fi
if ! suficiente; then
  curl -fsSL https://deb.nodesource.com/setup_${MAJOR_MINIMO}.x | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1
fi

# La unidad systemd arranca con `/usr/bin/env node`, que resuelve por PATH. El
# único caso que NO cubre es que el paquete de Debian deje `nodejs` y no
# `node`; entonces el servicio muere con `status=203/EXEC`, un error que no
# menciona a Node por ninguna parte. Se cierra aquí, como pide el runbook.
if ! command -v node >/dev/null && command -v nodejs >/dev/null; then
  ln -s "$(command -v nodejs)" /usr/bin/node
fi

# Fallar aquí y no diez pasos más tarde: un agente sobre un runtime sin
# parches, en la subred del HIS de un hospital, no se despliega.
suficiente || {
  echo "  ✗ Node >= ${MAJOR_MINIMO} no quedó instalado (hay: $(node --version 2>&1))." >&2
  exit 1
}
ok "node $(node --version) en $(command -v node)"

paso "§1 Usuario de servicio y directorios"
# El agente NUNCA corre como root: sin shell, sin home navegable, sin login.
id mirroragent >/dev/null 2>&1 || useradd --system \
  --home /opt/agenia-mirror-agent --shell /usr/sbin/nologin mirroragent
# `dist` no aparece en el runbook y el `mv` de §2 lo necesita: sin esto el
# despliegue real habría fallado en el primer intento, frente a TI.
mkdir -p /opt/agenia-mirror-agent/dist /opt/agenia-mirror-agent/data /etc/agenia-mirror-agent
chown -R mirroragent:mirroragent /opt/agenia-mirror-agent
chmod 700 /etc/agenia-mirror-agent
ok "usuario mirroragent, /opt/agenia-mirror-agent{dist,data}, /etc/agenia-mirror-agent (0700)"

# ─── CA del borde ──────────────────────────────────────────────────────────
# Solo aplica a esta simulación (y a hospitales con inspección TLS): la CA
# pública de Let's Encrypt ya viene en el almacén del sistema.
if [[ -f /tmp/agenia-edge-ca.crt ]]; then
  paso "CA del borde HTTPS"
  cp /tmp/agenia-edge-ca.crt /usr/local/share/ca-certificates/agenia-edge.crt
  update-ca-certificates >/dev/null 2>&1
  ok "CA instalada en el almacén del sistema"
fi

# ─── §2  El binario del agente ─────────────────────────────────────────────
paso "§2 Agente empaquetado"
install -o mirroragent -g mirroragent -m 0755 \
  /tmp/agent.bundle.js /opt/agenia-mirror-agent/dist/index.js
ok "$(du -h /opt/agenia-mirror-agent/dist/index.js | cut -f1) en /opt/agenia-mirror-agent/dist/index.js"

# ─── §3  Configuración ─────────────────────────────────────────────────────
paso "§3 /etc/agenia-mirror-agent/agent.env"
cat > /etc/agenia-mirror-agent/agent.env <<ENV
MIRROR_API_URL=${MIRROR_API_URL}
MIRROR_AGENT_TOKEN=${MIRROR_AGENT_TOKEN}
MIRROR_DRIVER_KEY=${MIRROR_DRIVER_KEY}
MIRROR_DRIVER_VERSION=${MIRROR_DRIVER_VERSION:-0.1.0-fase1}
MIRROR_POLL_INTERVAL_MS=${MIRROR_POLL_INTERVAL_MS:-5000}
MIRROR_HEARTBEAT_INTERVAL_MS=${MIRROR_HEARTBEAT_INTERVAL_MS:-60000}
MIRROR_RECONCILE_DELAY_MS=${MIRROR_RECONCILE_DELAY_MS:-120000}
MIRROR_RECONCILE_INTERVAL_MS=${MIRROR_RECONCILE_INTERVAL_MS:-86400000}
ENV
# Node NO usa el almacén de CAs del sistema: trae el suyo compilado. Sin
# esta línea, `update-ca-certificates` no sirve de nada y el agente muere con
# UNABLE_TO_VERIFY_LEAF_SIGNATURE contra cualquier TLS corporativo.
if [[ -f /usr/local/share/ca-certificates/agenia-edge.crt ]]; then
  echo "NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/agenia-edge.crt" \
    >> /etc/agenia-mirror-agent/agent.env
fi
chown mirroragent:mirroragent /etc/agenia-mirror-agent/agent.env
chmod 600 /etc/agenia-mirror-agent/agent.env
ok "0600 mirroragent:mirroragent ($(wc -l < /etc/agenia-mirror-agent/agent.env) variables)"

# ─── §4  systemd ───────────────────────────────────────────────────────────
paso "§4 Servicio systemd"
install -m 0644 /tmp/mirror-agent.service /etc/systemd/system/agenia-mirror-agent.service
systemctl daemon-reload
systemctl enable --now agenia-mirror-agent >/dev/null 2>&1
ok "agenia-mirror-agent habilitado y arrancado"

# ─── Firewall ──────────────────────────────────────────────────────────────
# El diseño dice "solo salida" (PLAN_ESPEJO_HOSPITAL §4.1). Si eso es cierto,
# cerrar TODO lo entrante no debe romper nada. Es la forma de comprobarlo en
# vez de creerlo.
paso "Firewall: todo lo entrante cerrado"
if apt-get install -y ufw >/dev/null 2>&1; then
  ufw --force reset >/dev/null 2>&1 || true
  ufw default deny incoming  >/dev/null 2>&1
  ufw default allow outgoing >/dev/null 2>&1
  if ufw --force enable >/dev/null 2>&1; then
    ok "ufw activo: deny incoming / allow outgoing"
  else
    echo "  ⚠ ufw no pudo activarse en este contenedor (kernel del host)."
  fi
else
  echo "  ⚠ ufw no se pudo instalar."
fi

echo -e "\n\033[1;32m✓ VM provisionada.\033[0m  systemctl status agenia-mirror-agent\n"

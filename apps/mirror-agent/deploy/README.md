# Despliegue del agente — VM Ubuntu del Hospital San Vicente de Paul de Anserma

> Checklist para el día en que la VM esté activa. Specs solicitadas en
> `docs/drivers/cnt-sanvicente-anserma/CORREO_PRUEBA_HIS.md`: Ubuntu Server
> 22.04/24.04 LTS, 2 vCPU, 4GB RAM, 30GB disco, red a `192.168.1.16:1433`,
> salida solo HTTPS 443, usuario con sudo.

> 💡 Mientras la VM no esté activa, todo el loop (handshake, conexión SQL,
> credenciales cifradas) se puede probar hoy contra un mock local en Docker —
> ver `apps/mirror-agent/local-his-mock/README.md`. El cutover de ese mock a
> este hospital real es un cambio de configuración, no de código.

## 0. Antes de tocar la VM

- [ ] Confirmar con TI: IP/hostname de la VM, método de acceso (SSH+llave, o el mismo AnyDesk).
- [ ] Confirmar que la VM alcanza `192.168.1.16:1433` (misma LAN del hospital) — probar con `nc -zv 192.168.1.16 1433` apenas haya acceso.
- [ ] Confirmar salida HTTPS de la VM hacia internet (`curl -I https://api.agenia.example.com` — ajustar al dominio real).
- [ ] Tener ya corrido `AGENIA_SYNC_SETUP.sql` contra `PRUEBAS` (ver checklist aparte) — se necesita la contraseña de `agenia_sync` para el `.env` del agente.

## 1. Preparar el host (una vez, con sudo)

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Usuario y directorios dedicados — el agente NUNCA corre como root
sudo useradd --system --home /opt/agenia-mirror-agent --shell /usr/sbin/nologin mirroragent
sudo mkdir -p /opt/agenia-mirror-agent/data /etc/agenia-mirror-agent
sudo chown -R mirroragent:mirroragent /opt/agenia-mirror-agent
sudo chmod 700 /etc/agenia-mirror-agent
```

## 2. Empaquetar y copiar el agente (desde este repo, en la máquina de build)

```bash
pnpm --filter @agenia/shared build
pnpm --filter @agenia/mirror-agent build
pnpm --filter @agenia/mirror-agent bundle   # genera dist/agent.bundle.js con esbuild

scp apps/mirror-agent/dist/agent.bundle.js <usuario>@<VM>:/tmp/
ssh <usuario>@<VM> "sudo mv /tmp/agent.bundle.js /opt/agenia-mirror-agent/dist/index.js && sudo chown mirroragent:mirroragent /opt/agenia-mirror-agent/dist/index.js"
```

## 3. Configurar el agente

```bash
scp apps/mirror-agent/deploy/agent.env.example <usuario>@<VM>:/tmp/agent.env
ssh <usuario>@<VM>
sudo mv /tmp/agent.env /etc/agenia-mirror-agent/agent.env
sudo chown mirroragent:mirroragent /etc/agenia-mirror-agent/agent.env
sudo chmod 600 /etc/agenia-mirror-agent/agent.env
sudo nano /etc/agenia-mirror-agent/agent.env   # completar MIRROR_AGENT_TOKEN real
```

## 4. Instalar el servicio systemd

```bash
sudo cp apps/mirror-agent/deploy/mirror-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agenia-mirror-agent
sudo systemctl status agenia-mirror-agent
journalctl -u agenia-mirror-agent -f
```

## 5. Primera verificación (solo conectividad — el driver aún tiene métodos pendientes de Fase 0)

Con el `HisDriver` de CNT-Anserma, hoy solo `connect()`/`healthCheck()` están implementados de verdad (ver
`apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts`). Eso ya permite validar, en producción real,
las dos patas de conectividad más riesgosas del proyecto:

- [ ] El agente hace `handshake()` con éxito (log del servicio, o revisar `HospitalMirrorConfig.lastHeartbeatAt` en Postgres).
- [ ] `healthCheck()` contra el SQL Server del hospital responde `ok: true` (confirma que la VM SÍ alcanza `192.168.1.16:1433` con las credenciales `agenia_sync`).
- [ ] El heartbeat sigue llegando cada minuto sin caídas durante al menos unas horas.

Los métodos `createAppointment`/`cancelAppointment`/`detectChanges`/`fetchAvailability` seguirán lanzando su
error de "pendiente de Fase X" hasta cerrar los pendientes de
`docs/drivers/cnt-sanvicente-anserma/ESTADO.md` — eso es esperado, no un error del despliegue.

## ⚠️ Nota de diseño pendiente (antes de dejar esto corriendo desatendido)

`InMemoryAgentStateStore` (el cursor de sync y el registro de idempotencia local) vive en memoria del proceso
— un reinicio del servicio pierde el cursor. Para esta prueba de conectividad no importa (no hay cursor real
que perder todavía), pero **antes de activar Fase 3 en producción** hace falta una implementación persistente
(ver el comentario en `apps/mirror-agent/src/core/agent-state-store.ts`) para que un reinicio del agente no
reprocese todo desde cero.

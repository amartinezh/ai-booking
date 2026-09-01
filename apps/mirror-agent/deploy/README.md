# Despliegue del agente — VM Ubuntu del Hospital San Vicente de Paul de Anserma

> Checklist para el día en que la VM esté activa. Specs solicitadas en
> `docs/drivers/cnt-sanvicente-anserma/CORREO_PRUEBA_HIS.md`: Ubuntu Server
> 22.04/24.04 LTS, 2 vCPU, 4GB RAM, 30GB disco, red a `192.168.1.16:1433`,
> salida solo HTTPS 443, usuario con sudo.

> 💡 Mientras la VM no esté activa, **este runbook entero se puede ejecutar hoy**
> contra una VM Ubuntu simulada en Docker: ver `apps/mirror-agent/local-vm/README.md`.
> `provision.sh` es literalmente los pasos §1–§4 de aquí abajo, y correrlo es la
> forma de saber que no tienen erratas antes de estar frente a TI. El cutover a
> la VM real es un cambio de configuración, no de código.

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
# `dist/` hace falta ANTES del `mv` de §2 — se olvidaba, y el despliegue
# fallaba en el primer intento.
sudo mkdir -p /opt/agenia-mirror-agent/dist /opt/agenia-mirror-agent/data /etc/agenia-mirror-agent
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

> ⚠️ **Si el hospital intercepta TLS** (proxy corporativo con su propia CA —
> habitual en redes hospitalarias): instalar esa CA en el sistema **no basta**.
> Node 20 trae su propio almacén compilado y no mira el del sistema, así que el
> agente moriría con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Hay que añadir además:
>
> ```
> NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/<la-ca>.crt
> ```
>
> Se descubrió montando la VM simulada, que usa exactamente ese escenario.

## 4. Instalar el servicio systemd

```bash
sudo cp apps/mirror-agent/deploy/mirror-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agenia-mirror-agent
sudo systemctl status agenia-mirror-agent
journalctl -u agenia-mirror-agent -f
```

## 5. Primera verificación

El driver ya escribe y lee de verdad: `createAppointment`, `cancelAppointment`,
`rescheduleAppointment`, `detectChanges` y `snapshotAppointments` están
implementados y probados de punta a punta contra la VM simulada. Lo que queda
por validar aquí es que la **red y las credenciales del hospital** se comporten
como se espera:

- [ ] `handshake()` con éxito (log del servicio, o `HospitalMirrorConfig.lastHeartbeatAt` en Postgres).
- [ ] `healthCheck()` responde `ok: true` — confirma que la VM alcanza `192.168.1.16:1433` con las credenciales de `agenia_sync`.
- [ ] El heartbeat llega cada minuto sin huecos durante unas horas.
- [ ] En el panel, el servicio **`mirror`** en verde (mira dead-letters, cola atascada y latido, no solo que el proceso viva).
- [ ] A los dos minutos del arranque, la primera reconciliación en el journal: `reconciliación OK` o el detalle de la deriva.

⚠️ **Antes del primer INSERT contra datos reales de `PRUEBAS`**: correr la
consulta que confirma la equivalencia de `NU_SEXO_PAC`. Hoy vamos con
`M→0 / F→1` por decisión propia, sin confirmar; escribirlo al revés deja el
sexo equivocado en la historia clínica de una persona. Está marcado como deuda
en `drivers/cnt-sanvicente-anserma/mapping.ts`.

Sigue pendiente `fetchAvailability` (Fase 2), que depende de los tres campos
del bloque 21 — ver `docs/drivers/cnt-sanvicente-anserma/ESTADO.md`. No lo usa
el flujo de espejo, así que su ausencia no bloquea nada de lo de arriba.

## Carga inicial de la agenda (Fase 2)

La agenda de AgenIA solo pasa a ser la del hospital cuando alguien lo decide,
y se decide por organización en `HospitalMirrorConfig.availabilityMode`:

| Modo | Qué hace |
|---|---|
| `OFF` (por defecto) | No se toca `ScheduleSlot`. La agenda de AgenIA sigue siendo la suya. |
| `SHADOW` | Se calcula la rejilla del HIS y se **reportan** las diferencias sin escribir nada. |
| `ON` | La agenda de AgenIA es la del hospital. |

El plan (§11) pide **al menos una semana en `SHADOW`** antes de exponerla al
chatbot: durante esa semana se compara lo que el agente calcularía contra la
pantalla de agenda real del hospital. Cada pasada queda en `SyncAudit`
(`op = 'AVAILABILITY'`) con lo que habría creado, actualizado y borrado.

```bash
# 1) Modo sombra, y se deja correr unos días
UPDATE "HospitalMirrorConfig" SET "availabilityMode" = 'SHADOW' WHERE ...;

# 2) Cuando el hospital confirme que coincide:
UPDATE "HospitalMirrorConfig" SET "availabilityMode" = 'ON' WHERE ...;

# 3) Carga inicial de una vez, sin esperar al bucle (servicio parado):
sudo -u mirroragent env $(cat /etc/agenia-mirror-agent/agent.env | xargs) \
  node /opt/agenia-mirror-agent/dist/index.js --seed-inicial
```

⚠️ Un turno que el hospital cancela **borra** los cupos libres de AgenIA, pero
**nunca** uno con cita viva: eso se reporta como conflicto (log + `SyncAudit`)
y lo resuelve una persona. Es un paciente con cita a una hora en la que su
médico ya no atiende.

## Estado local del agente (`/opt/agenia-mirror-agent/data`)

El agente guarda ahí `state.json`: el cursor de detección de cambios y el
registro de idempotencia. **Es el único directorio que la unidad systemd deja
escribir** (`ReadWritePaths`), y tiene que seguir siéndolo.

Por qué importa: el cursor de `detectChanges` no es una marca de tiempo, es una
FOTO del HIS. Si se pierde, al arrancar se toma una foto nueva que ya incluye
todo lo que pasó mientras el agente estuvo caído — así que esos cambios **no se
reportan nunca**. Con el estado en memoria, un simple reinicio para aplicar
parches bastaba para que una cita agendada en ventanilla desapareciera del lado
de AgenIA y ese cupo se siguiera vendiendo por WhatsApp. Reproducido y
corregido en la VM simulada (ver `local-vm/README.md`).

- No borrar ese archivo como "limpieza". Si se borra, la primera vuelta tras el
  arranque queda ciega a lo ocurrido entre medias; la reconciliación diaria lo
  detecta y cierra los cupos afectados, pero tarda.
- Si el directorio deja de ser escribible, el agente **falla al arrancar** a
  propósito: es preferible a sincronizar en silencio perdiendo cambios.

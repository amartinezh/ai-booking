# Runbook — espejo con el HIS del Hospital San Vicente de Paúl (Anserma)

Qué hacer cuando algo va mal. Ordenado por lo que se ve primero, no por cómo
está construido.

> **Antes de nada:** el panel. `Dashboard → Espejo con el HIS` responde en
> cuatro semáforos las preguntas de abajo sin abrir una terminal. Si el panel
> está en verde y aun así algo no cuadra, salta a *"Los dos sistemas no
> coinciden"*.

---

## Piezas y dónde vive cada una

| Pieza | Dónde | Qué pasa si se cae |
|---|---|---|
| Agente | VM del hospital, `systemd: agenia-mirror-agent` | Nada llega ni sale. Los eventos se acumulan en `SyncOutbox`, no se pierden. |
| SQL Server del hospital | `192.168.1.16:1433`, BD `PRUEBAS` | El agente entra en modo seguro y reintenta. Las citas de WhatsApp esperan en cola. |
| API de AgenIA | nube, HTTPS 443 | El agente reintenta. Los cambios del HIS esperan en la VM. |
| Estado local del agente | `/opt/agenia-mirror-agent/data/state.json` | Si se borra, el agente queda ciego a lo ocurrido mientras estuvo caído hasta la siguiente reconciliación. |

**El diseño es de salida únicamente**: la nube nunca abre una conexión hacia el
hospital. Todo sale de la VM por HTTPS. Si alguien pide "abrir un puerto para
AgenIA", la respuesta es que no hace falta.

---

## "El agente no da señales"

Semáforo rojo: *Sin señal desde hace N minutos*.

```bash
ssh <vm>
systemctl status agenia-mirror-agent
journalctl -u agenia-mirror-agent -n 100 --no-pager
```

- **`inactive (dead)`** → `sudo systemctl start agenia-mirror-agent`. Si vuelve
  a morir, el journal dice por qué en la primera línea tras el arranque.
- **`active (running)` pero sin líneas nuevas** → la VM perdió internet. El
  agente corta cada llamada a los 20 s y lo dice; si el journal está mudo,
  comprueba `curl -I https://api.agendamiento-ia.com`.
- **`Failed to connect to 192.168.1.16:1433`** → es el HIS, no el agente. Ver
  abajo.
- **Nunca hizo handshake** → el token es inválido o la VM no sale a internet.
  Ver *"Rotar el token"*.

El servicio arranca solo al reiniciar la VM (`enabled`). Si alguien la reinicia
para parches, no hay que hacer nada.

---

## "El agente está vivo pero no alcanza el sistema del hospital"

Es el caso más traicionero: el latido llega puntual y **ninguna cita se está
espejando**. El panel lo dice con esas palabras.

```bash
# Desde la VM, en este orden:
nc -zv 192.168.1.16 1433          # ¿hay ruta y el puerto contesta?
systemctl status agenia-mirror-agent
```

1. Si `nc` falla → es red o el SQL Server está caído. Es de TI del hospital.
2. Si `nc` responde pero el agente sigue fallando → credenciales. La contraseña
   de `agenia_sync` cambió o la cuenta se bloqueó. Ver *"Rotar credenciales"*.

**Mientras tanto no se pierde nada.** Las citas de WhatsApp se acumulan en la
cola y entran solas cuando el HIS vuelve. El agente deja de intentar tras cinco
fallos seguidos (modo seguro) y reintenta cada minuto: es a propósito, para que
un reinicio de veinte minutos del SQL Server no mande media cola al dead-letter.

---

## "Hay citas que no llegaron al hospital"

Semáforo rojo con un número. Son eventos que se reintentaron diez veces y se
rindieron. **Nunca se descartan.**

1. Panel → *Eventos que no llegaron al hospital*. Cada fila dice qué era y
   cuántos intentos lleva.
2. Arregla la causa primero. El motivo está en el journal de la VM, buscando el
   `seq`:
   ```bash
   journalctl -u agenia-mirror-agent | grep "seq 1234"
   ```
   Las causas reales que se han visto:
   - `homologación incompleta: falta DOCTOR/SERVICE` → falta una fila en
     `MirrorEntityMap` para ese médico o servicio.
   - violación de PK → ese cupo YA está vendido en el HIS. El hospital gana:
     hay que avisar al paciente, no forzar la escritura.
   - `Failed to connect` → era el HIS; con él arriba, reprocesar basta.
3. **Reintentar** en el panel. Vuelve a la cola con el contador a cero.

Si reprocesar no arregla y la causa no se puede resolver, escala: la cita existe
en AgenIA y el paciente la cree confirmada. Alguien tiene que llamarlo.

---

## "Los dos sistemas no coinciden"

La reconciliación corre sola una vez al día y compara la agenda entera. Reporta
en dos direcciones, que duelen distinto:

- **El hospital no tiene una cita que AgenIA sí** → el paciente cree que tiene
  cita y no la tiene. **Esto no se repara solo a propósito**: crear o borrar en
  la base del hospital a partir de una comparación es una decisión de una
  persona. Revisa el evento en la cola: casi siempre es un dead-letter sin
  reprocesar.
- **AgenIA sigue ofreciendo una hora que el hospital ya vendió** → se repara
  **automáticamente**: se cierra el cupo. Solo se informa.

Para forzarla sin esperar al ciclo diario, basta reiniciar el agente: la primera
reconciliación corre a los dos minutos del arranque.

```bash
sudo systemctl restart agenia-mirror-agent
journalctl -u agenia-mirror-agent -f | grep -i reconcil
```

---

## "La agenda de AgenIA no es la del hospital"

Se enciende por organización, y tiene tres estados:

```sql
-- OFF: la agenda de AgenIA es la suya (se puede vender una hora en la que el
--      médico no atiende).
-- SHADOW: se compara y se reporta, sin escribir. Mínimo una semana.
-- ON: la agenda de AgenIA es la del hospital.
UPDATE "HospitalMirrorConfig" SET "availabilityMode" = 'SHADOW'
 WHERE "organizationId" = '<org>';
```

Durante la semana en sombra, cada pasada queda en `SyncAudit`
(`op = 'AVAILABILITY'`) con lo que habría creado, actualizado y borrado. Se
compara contra la pantalla de agenda del hospital. Cuando coincidan, `ON`.

Carga inicial de una vez, con el servicio parado:

```bash
sudo systemctl stop agenia-mirror-agent
sudo -u mirroragent env $(cat /etc/agenia-mirror-agent/agent.env | xargs) \
  node /opt/agenia-mirror-agent/dist/index.js --seed-inicial
sudo systemctl start agenia-mirror-agent
```

⚠️ Un turno que el hospital cancela borra los cupos libres, pero **nunca** uno
con cita viva: eso se reporta como conflicto y lo resuelve una persona. Es un
paciente con cita a una hora en la que su médico ya no atiende.

---

## Rotar el token del agente

El token se muestra **una sola vez**, al crearlo. Si se pierde, se genera otro.

```bash
# En la máquina de build:
MIRROR_HIS_TARGET=hospital AGENIA_SYNC_PASSWORD='<password de agenia_sync>' \
  pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts <organizationId>

# En la VM: pegar el token nuevo y reiniciar.
sudo nano /etc/agenia-mirror-agent/agent.env    # MIRROR_AGENT_TOKEN=...
sudo systemctl restart agenia-mirror-agent
```

El token viejo deja de servir en cuanto se genera el nuevo.

## Rotar credenciales del HIS

`provision-mirror-config.ts` cifra `driverConfig` con la contraseña que se le
pase. Cambiar la de `agenia_sync` es correr ese mismo comando con la nueva y
reiniciar el agente. **No hay que tocar código ni redesplegar.**

---

## Actualizar el agente

```bash
./apps/mirror-agent/local-vm/vm-deploy.sh     # contra la VM simulada
# En la VM real: empaquetar, copiar el bundle, reiniciar (deploy/README.md §2).
```

El estado local (`data/state.json`) sobrevive: el agente no vuelve a empezar de
cero ni pierde de vista lo ocurrido durante la actualización.

---

## Desastre total (la VM se perdió)

1. VM nueva → `apps/mirror-agent/deploy/README.md`, §1 a §4.
2. Token nuevo (arriba).
3. `availabilityMode` en `ON` y carga inicial (`--seed-inicial`).
4. Reiniciar el agente y dejar correr la reconciliación.

Lo que se recupera solo: la agenda entera y la ocupación de cupos. Lo que no:
los cambios del HIS ocurridos mientras no había agente **si nadie corrió la
reconciliación después** — por eso el paso 4 no es opcional.

Nada de esto toca los datos del hospital: la reconstrucción lee de su base y
escribe en la de AgenIA.

---

## Apagar el espejo, rápido

```sql
-- Corta AgenIA → HIS, deja HIS → AgenIA vivo (o al revés).
UPDATE "HospitalMirrorConfig" SET "pushEnabled" = false WHERE "organizationId" = '<org>';

-- Corta todo. Los eventos se siguen acumulando: no se pierde nada.
UPDATE "HospitalMirrorConfig" SET "enabled" = false WHERE "organizationId" = '<org>';
```

Parar el servicio en la VM tiene el mismo efecto y es reversible igual. Ninguna
de las dos cosas borra nada.

---

## Prueba de desastre (game-day)

`./scripts/game-day-espejo.sh` ejecuta contra la VM simulada, y en orden, los
seis escenarios que este runbook describe: caída del proceso, reinicio de la
máquina, HIS incomunicado, internet caído, un evento en dead-letter reprocesado
y una jornada cancelada con cita dentro. Cada uno comprueba que el sistema
vuelve solo y que ninguna cita se pierde. Se corre antes de cada entrega y
cuando se cambie algo del agente.

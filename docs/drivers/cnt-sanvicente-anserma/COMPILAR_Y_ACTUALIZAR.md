# Compilar y actualizar — web, api y agente (Hospital San Vicente de Paúl, Anserma)

Guía de referencia para el día a día: **el sistema ya está instalado y en
producción, hay un cambio de código, y hay que subirlo.** No es una guía de
instalación desde cero (eso es `apps/mirror-agent/deploy/INSTALACION_AGENTE_VPS.md`
para el agente y `deploy/remote-install.sh` para la nube) ni un manual de
operación de incidentes (eso es `RUNBOOK.md`). Este documento cubre solo una
pregunta: **"tengo un cambio en el repo, ¿cómo lo compilo y cómo lo pongo en
producción?"** — para `web`, para `api` y para el agente del hospital, por
separado o juntos.

---

## 0. Los tres sistemas que se compilan y despliegan

| Pieza | Código | Dónde corre en producción | Cómo llega el código |
|---|---|---|---|
| **web** | `apps/web` (Next.js) | Contenedor Docker `web`, VPS de la nube | `rsync` + `agenia build web` |
| **api** | `apps/api` (NestJS) | Contenedor Docker `api`, VPS de la nube | `rsync` + `agenia build api` |
| **mirror-agent** | `apps/mirror-agent` | Proceso `systemd`, VPS del hospital | `scp`/AnyDesk del bundle + reinicio del servicio |

Las tres comparten `packages/shared` (y `web`/`api` también `packages/database`),
así que un cambio ahí obliga a reconstruir todo lo que lo consume — ver §1.

### Datos de este despliegue (para copiar y pegar)

| Dato | Valor |
|---|---|
| VPS de la nube (web+api+Postgres) | `89.117.61.28` (Contabo) |
| Dominio público | `app.hsvpanserma.agenia.co` (un solo dominio; panel en `/`, API en `/api`) |
| Llave SSH de la nube | `~/.ssh/agenia_89_117_61_28_ed25519` |
| Usuario admin de la nube | `root` (o el usuario admin creado por `remote-install.sh`, con `docker`) |
| Directorio del repo en la nube | `/opt/agenia` (sin `.git`: el código llega por `rsync`) |
| `organizationId` de este hospital | `97f18182-d0d9-4a3b-9eb6-4fbc031b917c` |
| VPS del hospital (agente) | `192.168.1.175` — solo alcanzable desde la LAN del hospital |
| Usuario del VPS del hospital | `data` (admin, con `sudo`); el agente corre como `mirroragent` |
| Acceso al VPS del hospital | AnyDesk → estación Windows `192.168.1.25` → SSH interno (Tailscale pendiente, ver `CONECTIVIDAD.md` §8) |
| Driver de este hospital | `cnt-sanvicente-anserma` (`MIRROR_DRIVER_KEY` en `agent.env`) |

---

## 1. Antes de compilar nada

```bash
cd <raíz del repo>
pnpm install                              # una vez, o tras cambios en cualquier package.json
```

**Orden de dependencias**, si tocaste `packages/shared` o `packages/database`:
`web`, `api` y `mirror-agent` importan de ahí en tiempo de compilación, así que
esos paquetes se compilan primero (Turborepo ya resuelve esto solo con
`pnpm build`, pero si compilas una app suelta con `pnpm --filter <app> build`
hazlo a mano):

```bash
pnpm --filter @agenia/shared build        # si tocaste packages/shared
pnpm --filter @agenia/database build      # si tocaste packages/database (poco común: normalmente solo migra)
```

**Antes de subir nada a producción**, corre la batería de verificación local
— es más barato encontrar un error aquí que en el VPS:

```bash
pnpm --filter api test          # jest, 120+ tests
pnpm --filter web test
pnpm --filter @agenia/shared test
pnpm --filter web lint          # obligatorio si tocaste fechas (regla de CLAUDE.md)
npx tsc --noEmit -p apps/web/tsconfig.json   # typecheck rápido de web
```

---

## 2. Compilar localmente (verificación antes de subir)

No hace falta para desplegar en la nube (`agenia build` compila **dentro** del
VPS con Docker), pero sirve para confirmar que el código compila antes de
sincronizarlo. Para el agente sí es obligatorio: el bundle se genera en tu
máquina y se copia ya compilado.

### 2.1 Solo `web`

```bash
pnpm --filter @agenia/shared build   # si aplica, ver §1
pnpm --filter web build              # next build
```

### 2.2 Solo `api`

```bash
pnpm --filter @agenia/shared build
pnpm --filter @agenia/database build
pnpm --filter api build              # nest build
```

### 2.3 `web` + `api` juntos

```bash
pnpm build                           # turbo run build — compila todo el monorepo en el orden correcto
```

### 2.4 El agente (`mirror-agent`)

El agente **no corre `pnpm` en el VPS del hospital** — se compila en tu
máquina como un único archivo JavaScript autocontenido (esbuild, sin
`node_modules`) y se copia ya compilado:

```bash
pnpm --filter @agenia/shared build
pnpm --filter @agenia/mirror-agent build     # tsc — solo para comprobar tipos
pnpm --filter @agenia/mirror-agent bundle    # genera dist/agent.bundle.js
ls -lh apps/mirror-agent/dist/agent.bundle.js   # ~3,3 MB

# Verificación rápida de que el bundle no está roto — debe fallar con
# exactamente este mensaje y nada más (falta el .env, es lo esperado):
node apps/mirror-agent/dist/agent.bundle.js
# → [mirror-agent] error fatal en el arranque: Error: MIRROR_API_URL no está configurado.
```

---

## 3. Actualizar la nube (`web` / `api`)

El VPS de la nube **no tiene repositorio git** (el código llega por `rsync`, a
propósito: el remote de GitHub lleva un token embebido que no debe vivir en un
servidor). Por eso `agenia update` no sirve para este flujo — ese comando es
para el día en que el servidor sí tenga git. El camino real siempre empieza
igual: sincronizar código desde tu portátil, y luego reconstruir en el
servidor solo el/los contenedor(es) que cambiaron.

> `web` y `api` son contenedores **separados**. El agente del hospital solo
> habla con `api` (`/api/mirror/*`), nunca con `web` — reconstruir solo `web`
> es cero riesgo para el espejo, sin importar en qué `availabilityMode` esté.

### 3.1 Sincronizar el código (siempre, sea cual sea lo que cambió)

```bash
# 💻 Desde tu portátil, en la raíz del repo:
rsync -az --delete \
  -e "ssh -i ~/.ssh/agenia_89_117_61_28_ed25519" \
  --exclude 'node_modules' --exclude '.next' --exclude 'dist' --exclude '.turbo' \
  --exclude 'coverage' --exclude '*.log' --exclude '.DS_Store' --exclude '.git' \
  --exclude '.env' --exclude '.env.production' \
  --exclude 'deploy/secrets' --exclude 'deploy/install.conf' --exclude 'deploy/Caddyfile' \
  ./ root@89.117.61.28:/opt/agenia/
```

Estas exclusiones son las mismas que usa el instalador: nunca tocan secretos,
certificados ni el `Caddyfile` ya ajustado a mano en el servidor (recuerda el
bloque de `/api/mirror*` que documenta `CONECTIVIDAD.md` §5 — vive en el VPS,
no en el repo que se sincroniza).

### 3.2 Solo `web`

```bash
# ☁️ En el servidor:
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 'agenia build web'
```

`agenia build web` hace `docker compose build web && docker compose up -d
web` — solo ese contenedor se recrea. No toca `postgres`, `redis`, `caddy` ni
migra nada.

### 3.3 Solo `api`

```bash
# ☁️ En el servidor:
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 'agenia build api'
```

El contenedor se reinicia (unos segundos de corte). El agente del hospital lo
tolera igual que un corte de red cualquiera: reintenta solo, no pierde
eventos, y `availabilityMode` no se toca (vive en Postgres, un contenedor
aparte). Si justo en ese instante corría una vuelta de `bucleAgenda`
(`SHADOW`/`ON`), esa vuelta falla y queda registrada; la siguiente (hasta 15
min después) recalcula limpio.

**Si el cambio de `api` toca `packages/database` (schema.prisma o el SQL de
`packages/database/prisma/sql/`)**, hace falta migrar antes o justo después de
reconstruir — ver §3.5.

### 3.4 `web` + `api` juntos

```bash
# ☁️ En el servidor:
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 'agenia build api web'
```

### 3.5 Si hay cambios de base de datos (`packages/database`)

Dos casos, y son independientes:

**a) Migración Prisma** (nueva tabla/columna con su archivo en
`packages/database/prisma/migrations/`):

```bash
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 'agenia migrate'
```

`agenia migrate` detecta solo si la base ya tiene historial de migraciones
(`prisma migrate deploy`) o si hace falta sellarlo primero (`baseline`) — no
hay que elegir manualmente. Corre **después** de `agenia build api`, para que
el contenedor que sirve las peticiones ya conozca el schema nuevo (Prisma
Client se genera en el build de la imagen).

**b) SQL no gestionado por Prisma** (triggers, funciones, índices parciales —
ver `packages/database/prisma/sql/`):

```bash
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 '
  cd /opt/agenia
  docker compose --env-file .env.production -f docker-compose.deploy.yml \
    run --rm migrator pnpm --filter @agenia/database db:apply-sql
'
```

Es idempotente: correrlo de más no rompe nada. `agenia migrate` ya lo incluye
cuando aplica un baseline nuevo, pero si solo cambiaste el SQL (sin tocar
`schema.prisma`) hay que llamarlo aparte, como arriba.

### 3.6 Verificación después de cualquiera de las anteriores

```bash
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 'agenia verify'
```

`agenia verify` comprueba: contenedores sanos, Redis/Postgres responden, el
schema tiene tablas, `api` escucha en el puerto 3000, `web` alcanza `api` por
la red interna, el panel público responde, el webhook de Meta rechaza tokens
falsos con 403, y que Postgres/Redis no estén expuestos a internet.

Si el cambio tocó algo relacionado con el espejo del hospital, hay dos
comprobaciones más — **en dos máquinas distintas**, y es fácil confundirlas:

**a) El journal del agente — se corre DENTRO del VPS del hospital**, no en la
nube. `agenia-mirror-agent` no existe como servicio en `89.117.61.28`; vive
como `systemd` en `192.168.1.175`. Para verlo hace falta entrar por SSH a esa
máquina, y hoy eso significa el salto AnyDesk → estación Windows
(`192.168.1.25`) → SSH interno (el mismo acceso del §4.2 Escenario B; con
Tailscale ya configurado sería SSH directo):

```bash
# 🏥 Ya DENTRO del VPS del hospital (192.168.1.175), tras entrar por SSH:
journalctl -u agenia-mirror-agent -n 10 --no-pager
```

Es opcional, y solo aplica si un cambio de `api` afecta rutas `/api/mirror/*`:
confirma que el agente se recuperó del corte del contenedor (una línea de
`handshake OK` reciente basta).

**b) `checkHealth.sh` — se corre desde tu propio portátil**, no dentro de
ningún VPS. El script vive en este repo
(`docs/drivers/cnt-sanvicente-anserma/checkHealth.sh`) y tú lo ejecutas
localmente; es él quien abre su propia conexión SSH hacia la nube
(`89.117.61.28`) para consultar Postgres y correr `agenia verify` por dentro
— no necesita ni requiere que tú entres manualmente a ningún servidor:

```bash
# 💻 En tu portátil, dentro de docs/drivers/cnt-sanvicente-anserma/:
./checkHealth.sh
```

Cubre solo lo que se ve **desde la nube** (latido, cola, homologación,
reconciliación — ver el encabezado del script para el detalle) y al final
imprime, sin ejecutarlos, los comandos que faltan correr dentro del hospital —
justamente el `journalctl` del punto (a).

---

## 4. Actualizar el agente en el VPS del hospital (`mirror-agent`)

El agente es un único archivo (`agent.bundle.js`) que corre como servicio
`systemd`. Actualizar significa: compilar el bundle nuevo, copiarlo encima del
viejo, y reiniciar el servicio. **El estado local
(`/opt/agenia-mirror-agent/data/state.json`) sobrevive** — el agente no
empieza de cero ni pierde de vista lo ocurrido durante la actualización.

### 4.1 Compilar el bundle nuevo (💻 en tu portátil)

```bash
pnpm --filter @agenia/shared build
pnpm --filter @agenia/mirror-agent bundle
ls -lh apps/mirror-agent/dist/agent.bundle.js
```

### 4.2 Copiar el bundle al VPS del hospital

**Escenario A — acceso SSH directo** (Tailscale ya configurado, o tu portátil
está en la LAN del hospital):

```bash
scp apps/mirror-agent/dist/agent.bundle.js data@192.168.1.175:/tmp/
ssh data@192.168.1.175 "sudo install -o mirroragent -g mirroragent -m 0755 \
  /tmp/agent.bundle.js /opt/agenia-mirror-agent/dist/index.js && rm /tmp/agent.bundle.js"
```

**Escenario B — solo AnyDesk** (el caso de hoy en Anserma:
`192.168.1.175` no es alcanzable desde tu red):

1. En la sesión de AnyDesk contra la estación Windows (`192.168.1.25`), usa el
   panel de transferencia de archivos para copiar `agent.bundle.js` al
   escritorio de esa Windows.
2. Desde esa misma Windows (PowerShell trae `scp` integrado):
   ```powershell
   scp .\agent.bundle.js data@192.168.1.175:/tmp/
   ```
3. Ya en el VPS (por SSH desde la Windows, o `ssh data@192.168.1.175` si tu
   red lo permite):
   ```bash
   sudo install -o mirroragent -g mirroragent -m 0755 \
     /tmp/agent.bundle.js /opt/agenia-mirror-agent/dist/index.js
   rm /tmp/agent.bundle.js
   ```

> 💡 **Atajo:** `actualizarAgente.sh` hace todo lo de 4.3 y 4.4 en un solo
> comando, y mejor que a mano — valida el bundle con `node --check` antes de
> instalarlo (detecta una transferencia truncada por AnyDesk antes de que
> falle de forma confusa), respalda el binario anterior (permite
> `./actualizarAgente.sh --rollback`), y espera el desenlace REAL en el
> journal (`handshake OK` vs. error) en vez de un `sleep` fijo. Se copia una
> sola vez al VPS del hospital (mismo Escenario A/B de arriba) y desde
> entonces basta:
> ```bash
> # 🏥 En el VPS del hospital, con el bundle ya en /tmp/agent.bundle.js:
> ./actualizarAgente.sh
> ```

### 4.3 Reiniciar el servicio (🏥 en el VPS del hospital)

```bash
sudo systemctl restart agenia-mirror-agent
```

Reiniciar también fuerza una reconciliación completa a los dos minutos —
conviene aprovechar el reinicio para confirmar que todo sigue en orden, no
solo para aplicar el código nuevo.

### 4.4 Verificar

```bash
systemctl status agenia-mirror-agent
journalctl -u agenia-mirror-agent -n 50 --no-pager
```

Debe verse, en los primeros segundos:

```
[mirror-agent] arrancando con driver "cnt-sanvicente-anserma"...
[mirror-agent] handshake OK, entrando al loop de sync.
```

Y a los ~2 minutos, la reconciliación (`reconciliación OK: N cita(s), sin
diferencias.`). Si algo no cuadra, la tabla de síntomas de
`INSTALACION_AGENTE_VPS.md` §9 cubre los casos conocidos
(`status=203/EXEC`, `401`, `404`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, etc.).

Para una foto más completa que un `systemctl status` suelto — reinicios
recientes, último `handshake OK`, última reconciliación, conectividad al HIS
y a la nube, permisos de `agent.env`, frescura de `data/state.json` —
`checkHealthAgente.sh` corre todo eso de una vez, **directo en el VPS del
hospital** (es el complemento de `checkHealth.sh`, que solo ve lo que la nube
reporta):

```bash
# 🏥 En el VPS del hospital (de solo lectura, no reinicia ni toca nada):
./checkHealthAgente.sh
```

Desde el lado de la nube, sin tocar el hospital:

```bash
./checkHealth.sh   # confirma latido reciente y lastHisReachable=true tras la actualización
```

> ⚠️ **Cambios que solo tocan `apps/mirror-agent/src/` no afectan a `web` ni
> `api`**, y viceversa: actualizar la nube (§3) nunca requiere tocar el
> agente, y actualizar el agente (§4) nunca requiere reconstruir contenedores
> en la nube. Son despliegues completamente independientes — solo hace falta
> hacer ambos cuando el cambio toca `packages/shared` y afecta lógica que
> ambos lados usan (p. ej. `padron-csv.ts`, `documento.ts`, `date-format.ts`).

---

## 5. Rotar la contraseña de `agenia_sync` (HIS)

Cuando la contraseña del login `agenia_sync` en el SQL Server del hospital
cambia (rotación de seguridad, o porque quedó desincronizada — ver el
incidente del 2026-09-10 más abajo), hay que actualizarla en **dos lugares a
la vez**: el propio SQL Server y el `driverConfig` cifrado en Postgres. Si se
actualiza solo uno de los dos, el agente vuelve a fallar con
`ConnectionError: Login failed for user 'agenia_sync'`.

### El script: `rotarClaveHIS.sh`

Automatiza todo lo que se puede automatizar desde fuera del hospital —
verificar/abrir el túnel SSH, leer `ENCRYPTION_KEY`/`DATABASE_URL` del propio
VPS (nunca a mano), generar una contraseña segura, y correr
`provision-mirror-config.ts` — y se detiene exactamente en los dos puntos que
**no se pueden** automatizar porque la nube no tiene ruta hacia el hospital:
el `ALTER LOGIN` en el SQL Server, y pegar el token nuevo en `agent.env` del
VPS del hospital.

```bash
# 💻 En tu portátil, desde cualquier directorio:
./docs/drivers/cnt-sanvicente-anserma/rotarClaveHIS.sh
```

Qué hace, en orden:

1. Verifica si ya hay un túnel SSH abierto y respondiendo hacia el Postgres
   de producción; si hay uno atascado lo cierra, si no hay ninguno lo abre
   (leyendo el puerto remoto real de `.env.production`, no un valor fijo).
2. Genera una contraseña nueva — solo letras y dígitos, para no romper el
   `ALTER LOGIN ... = '...'` de SQL Server ni el `AGENIA_SYNC_PASSWORD='...'`
   del shell con una comilla o un símbolo especial.
3. Te muestra el `ALTER LOGIN` exacto y **espera tu Enter** antes de seguir —
   este paso es manual a propósito: ejecútalo en la misma pestaña de SSMS
   donde ya tengas la sesión de administrador (no abras una conexión nueva,
   sobre todo si es una máquina prestada por AnyDesk).
4. Corre `provision-mirror-config.ts` con esa contraseña y te muestra el
   token nuevo.
5. Te muestra el bloque exacto para pegar en `agent.env` del VPS del
   hospital, y el `systemctl restart` + `journalctl -f` para verificar.
6. Cierra el túnel al terminar — solo si lo abrió él mismo (si ya tenías uno
   abierto para otra cosa, lo deja intacto).

Variables de entorno por si algo de esto cambia (todas tienen el valor
correcto de este hospital por defecto): `MIRROR_SSH_KEY`, `MIRROR_VPS_IP`,
`MIRROR_REMOTE_DIR`, `ORGANIZATION_ID`, `MIRROR_HIS_TARGET`,
`TUNNEL_LOCAL_PORT`, `PASSWORD_LENGTH`.

### Por qué dos pasos siguen siendo manuales

La arquitectura del espejo es de salida únicamente (`CONECTIVIDAD.md`): la
nube nunca tiene ruta hacia `192.168.1.16` (el SQL Server) ni hacia
`192.168.1.175` (el VPS del agente) — solo el agente, desde dentro de la LAN
del hospital, puede llegar a ambos. Ningún script corrido desde tu portátil o
desde el VPS de la nube puede saltarse eso, así que el `ALTER LOGIN` y la
edición de `agent.env` seguirán siendo manuales mientras la arquitectura sea
esta (que es la correcta — ver `CONECTIVIDAD.md` §2).

### El incidente que motivó este script (2026-09-10)

El agente empezó a fallar con `Login failed for user 'agenia_sync'` tras un
despliegue rutinario de `web`+`api`. El diagnóstico completo (7 rondas de
verificación, descartando red, token, `ENCRYPTION_KEY`, bloqueo de cuenta y
modo de autenticación) terminó en algo que no tenía que ver con la
contraseña: a `agenia_sync` **nunca se le había creado el `USER` dentro de
`PRUEBAS`** (la sección 4 de `AGENIA_SYNC_SETUP.sql` se había corrido contra
`ESEHSVP` pero no contra `PRUEBAS`, o `PRUEBAS` se recreó después). El
síntoma clave que lo delató: `sp_readerrorlog` en el SQL Server mostró
`Reason: Failed to open the explicitly specified database 'PRUEBAS'` — un
mensaje completamente distinto al genérico que da el cliente. Ver la nota en
`sql/AGENIA_SYNC_SETUP.sql` para el detalle y el arreglo.

La contraseña rotada durante ese incidente **sí quedó igual en los dos
lados** al final (era buena higiene de todas formas), pero no era la causa
raíz — de ahí que este script exista: para que la próxima vez que aparezca
`Login failed`, sincronizar la contraseña tome un comando en vez de una
noche, y para no perder tiempo ahí si la causa resulta ser otra (como esa
vez).

---

## 6. Rollback rápido

Como el VPS de la nube no tiene git, "revertir" es re-sincronizar un commit
anterior, no un `git reset` en el servidor:

```bash
# 💻 En tu portátil, sobre el commit bueno anterior (rama, tag o hash):
git checkout <commit-bueno>          # o: git worktree add ../agenia-rollback <commit-bueno>

# Repite §3.1 (rsync) y luego §3.2/§3.3/§3.4 según qué se había tocado
```

Si el problema es de datos (una migración salió mal), usa el respaldo, no el
código:

```bash
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 'agenia backup'   # antes de cualquier migración riesgosa
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 'agenia restore <archivo.sql.gz>'  # DESTRUCTIVO, pide confirmar
```

Para el agente, el rollback es igual que una actualización normal (§4) pero
compilando el commit anterior — `data/state.json` no se ve afectado por el
código que corre encima de él.

---

## 7. Resumen — comandos más frecuentes

| Quiero… | Comando |
|---|---|
| Compilar todo localmente | `pnpm build` |
| Compilar solo `web` | `pnpm --filter web build` |
| Compilar solo `api` | `pnpm --filter api build` |
| Compilar el agente | `pnpm --filter @agenia/mirror-agent bundle` |
| Correr los tests | `pnpm test` (o `--filter <app>`) |
| Subir código a la nube | `rsync ...` (§3.1) |
| Reconstruir solo `web` en la nube | `agenia build web` |
| Reconstruir solo `api` en la nube | `agenia build api` |
| Reconstruir `web`+`api` en la nube | `agenia build api web` |
| Aplicar migraciones Prisma | `agenia migrate` |
| Aplicar SQL no gestionado por Prisma | `... db:apply-sql` (§3.5b) |
| Verificar la nube tras un cambio | `agenia verify` |
| Actualizar el agente del hospital | §4: compilar (4.1) → copiar (4.2) → `./actualizarAgente.sh` (🏥) |
| Revertir el agente al bundle anterior | `./actualizarAgente.sh --rollback` (🏥) |
| Verificar el agente tras actualizarlo | `journalctl -u agenia-mirror-agent -f` (🏥) o `./checkHealthAgente.sh` (🏥) |
| Rotar/sincronizar la contraseña de `agenia_sync` | `./rotarClaveHIS.sh` (§5) |
| Foto de salud completa (lado nube) | `./checkHealth.sh` (💻) |
| Foto de salud completa (lado hospital) | `./checkHealthAgente.sh` (🏥) |
| Respaldar la base antes de algo riesgoso | `agenia backup` |

---

## 8. Relación con los otros documentos

| Documento | Para qué |
|---|---|
| **Este** | Compilar y desplegar un cambio de código, día a día |
| `INSTALACION_AGENTE_VPS.md` | Instalar el agente **de cero** en un VPS nuevo del hospital |
| `RUNBOOK.md` | **Operar** lo ya instalado: dead-letters, discrepancias, rotar credenciales, desastre total |
| `CONECTIVIDAD.md` | Por qué la arquitectura es de salida únicamente, y la evidencia de red del hospital |
| `checkHealth.sh` | Auditoría de salud automatizada, lado nube (💻, corre desde tu portátil) |
| `checkHealthAgente.sh` | Auditoría de salud automatizada, lado hospital (🏥, corre en el VPS del hospital) |
| `actualizarAgente.sh` | Instalar un bundle nuevo del agente con validación, respaldo y `--rollback` (§4) |
| `rotarClaveHIS.sh` | Rotar/sincronizar la contraseña de `agenia_sync` (§5) |
| `sql/AGENIA_SYNC_SETUP.sql` | Crear el login/usuario/permisos de `agenia_sync` en el HIS — y la nota sobre `PRUEBAS` sin `USER` |
| `../../../deploy/agenia.sh` | Código fuente de todos los comandos `agenia <algo>` usados aquí |

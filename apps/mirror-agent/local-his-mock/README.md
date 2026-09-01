# Mock local del HIS — driver `cnt-sanvicente-anserma`

Simulador local (Docker) del SQL Server del Hospital San Vicente de Paul de
Anserma, para desarrollar y probar el driver **sin depender de la VM ni de la
red del hospital**. No es parte del motor genérico — vive dentro de
`apps/mirror-agent` porque es 100% específico de este driver, igual que
`docs/drivers/cnt-sanvicente-anserma/`.

## Por qué existe

El driver (`apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/`) recibe
toda su configuración de conexión vía `driverConfig` — un JSON opaco que el
motor genérico nunca interpreta (ver `docs/PLAN_ESPEJO_HOSPITAL.md` §1.4).
Eso significa que **apuntar a un mock local o al hospital real es un cambio
de configuración, no de código**: mismo `connect()`, mismo esquema de
tablas, mismo `AGENIA_SYNC_SETUP.sql` — solo cambia `server`/`password`.

## Qué NO es

No es una réplica binaria del HIS. Es una reconstrucción best-effort del
esquema **confirmado** en `docs/drivers/cnt-sanvicente-anserma/MAPEO_HIS.md`
(columnas, tipos, PKs — donde Fase 0 ya cerró la pregunta). Tres tablas
(`CONSULTORIOS`, `R_ESP_SER`, `MUNICIPIOS`) son placeholders mínimos porque
su esquema real aún no se descubrió (bloque 21, pendiente). Motor: SQL
Server 2022 real bajo emulación amd64 (no Azure SQL Edge — esa imagen quedó
sin mantenimiento y revienta con SIGABRT al arrancar en Apple Silicon; el
hospital corre SQL Server 2017, pero para DDL/DML estándar la diferencia de
versión no importa aquí).

## Uso

```bash
# 1) Levantar el contenedor (una vez; el volumen persiste entre reinicios)
docker compose up -d mirror-his-mock

# 2) Crear/recrear PRUEBAS + correr AGENIA_SYNC_SETUP.sql real sin modificar
#    (reintentable — recrea todo desde cero cada vez que corre)
AGENIA_SYNC_PASSWORD='<misma que uses en provision-mirror-config.ts>' \
  npx tsx apps/mirror-agent/local-his-mock/setup.ts

# 3) Apuntar el HospitalMirrorConfig de dev a este mock (MIRROR_HIS_TARGET=local
#    es el default — ver packages/database/scripts/provision-mirror-config.ts)
AGENIA_SYNC_PASSWORD='<la misma>' npx tsx packages/database/scripts/provision-mirror-config.ts

# 4) Habilitar temporalmente para probar (enabled=false es el default de fábrica)
docker exec agenia_db psql -U admin -d agenia -c \
  "UPDATE \"HospitalMirrorConfig\" SET enabled=true WHERE \"organizationId\"='<id>';"

# 5) Con la API corriendo (pnpm --filter api start:dev) y el token del paso 3:
cd apps/mirror-agent
MIRROR_API_URL='http://localhost:3001' \
MIRROR_AGENT_TOKEN='<token del paso 3>' \
MIRROR_DRIVER_KEY='cnt-sanvicente-anserma' \
npx ts-node src/index.ts
```

Si ves `handshake OK, entrando al loop de sync.` seguido de errores tipo
`pendiente de Fase X`, es exitoso — esos métodos (`createAppointment`,
`detectChanges`...) siguen como stubs a propósito (ver ESTADO.md); lo que
esto valida es exactamente lo que `apps/mirror-agent/deploy/README.md` §5
pide validar contra la VM real: handshake HTTP + credenciales cifradas
correctamente descifradas + conexión SQL real.

No olvides volver `enabled=false` al terminar de probar (paso 4, en reversa).

## Cutover a producción (VM + hospital real)

Cuando la VM esté activa y `AGENIA_SYNC_SETUP.sql` haya corrido contra el
`PRUEBAS`/`ESEHSVP` real del hospital, el cambio es **solo de configuración**:

```bash
MIRROR_HIS_TARGET=hospital AGENIA_SYNC_PASSWORD='<password real de agenia_sync>' \
  npx tsx packages/database/scripts/provision-mirror-config.ts
```

Esto reescribe `driverConfig` (cifrado) apuntando a `192.168.1.16:1433` en
vez de `localhost:1433`, y genera un token de agente nuevo (pegar en el
`.env` de la VM — ver `apps/mirror-agent/deploy/README.md`). Cero cambios de
código en `apps/mirror-agent/src/` ni en `apps/api/src/mirror/`.

## Resetear desde cero

```bash
docker compose down -v mirror-his-mock   # borra también el volumen (todo el estado del mock)
docker compose up -d mirror-his-mock
npx tsx apps/mirror-agent/local-his-mock/setup.ts   # con AGENIA_SYNC_PASSWORD de nuevo
```

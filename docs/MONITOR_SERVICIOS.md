# 📡 Monitor de Servicios externos (Google / Meta)

Monitorea la salud de las integraciones externas del sistema (Gemini AI,
Google Cloud TTS, Meta WhatsApp Cloud API). Sección global del **SUPER_ADMIN**
en `/super-admin/monitor`.

## Arquitectura dual

Hay dos modos independientes que **nunca comparten estado**:

```
                BACKEND (NestJS)
   ┌────────────────────┐     ┌──────────────────────────┐
   │ MODO A — Centinela  │     │ MODO B — Live (efímero)   │
   │ MonitorCron         │     │ GET /monitor/live-check   │
   │ cada N min          │     │ llamado por el frontend   │
   │  ↓ transición?      │     │  ↓ ejecuta checks         │
   │  abre/cierra        │     │  devuelve JSON            │
   │  ServiceIncident    │     │  ❌ NO escribe en BD      │
   └────────────────────┘     └──────────────────────────┘
            │                              │
   GET /monitor/incidents          GET /monitor/live-check
            │                              │
                FRONTEND (/super-admin/monitor)
   [Histórico de incidentes]   [Monitoreo en vivo (botón Iniciar)]
```

| | MODO A — Centinela | MODO B — Live |
|--|---|---|
| Frecuencia | `MONITOR_BG_INTERVAL_MINUTES` (def. 15 min) | `MONITOR_LIVE_INTERVAL_SECONDS` (def. 5 s) |
| Dónde corre | Cron del backend | Polling del navegador |
| Persistencia | Solo transiciones (fallo / recuperación) | Nunca toca la BD; todo en memoria del browser |
| Vida útil | Siempre (si `MONITOR_ENABLED=true`) | Solo mientras el técnico mantiene la ventana y presiona "Iniciar" |

- **MODO A** solo escribe en `ServiceIncident` cuando un servicio pasa de `UP`
  a `DOWN`/`DEGRADED` (abre incidente) y cuando se recupera (`resolvedAt`).
  Estados estacionarios no se persisten.
- **MODO B** es un diagnóstico en vivo: ejecuta los mismos checks cada pocos
  segundos pero solo en memoria. El buffer del gráfico es de 300 puntos (FIFO)
  y el polling se pausa al ocultar la pestaña.

## Credenciales (importante)

Los checks de **Gemini** y **Meta** son *por organización* (leen credenciales
cifradas de la BD). El monitor es global, así que valida contra una
organización "testigo" designada por **`MONITOR_TARGET_ORG_ID`**. **Google
TTS** usa credenciales globales (`GOOGLE_APPLICATION_CREDENTIALS`) y no necesita
organización.

Si `MONITOR_TARGET_ORG_ID` está vacío, los checks de Gemini/Meta reportan
`NO_TARGET_ORG` (DOWN) con un mensaje explicativo — no rompen nada.

## Variables de entorno (`apps/api/.env`)

```
MONITOR_ENABLED=true               # ON/OFF del centinela de fondo (MODO A)
MONITOR_BG_INTERVAL_MINUTES=15     # intervalo del cron
MONITOR_LIVE_INTERVAL_SECONDS=5    # intervalo del live (lo usa el frontend)
MONITOR_DEFAULT_TIMEOUT_MS=5000    # timeout por check
MONITOR_DEGRADED_THRESHOLD_MS=3000 # latencia → DEGRADED
MONITOR_RETENTION_DAYS=365         # retención de incidentes resueltos
MONITOR_TARGET_ORG_ID=             # org testigo para Gemini/Meta
```

Tras cambiar cualquiera, recrear el contenedor:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

## Cómo agregar un nuevo servicio a monitorear

1. Agrega una entrada a `SERVICES_CONFIG` en
   [`apps/api/src/monitor/services.config.ts`](../apps/api/src/monitor/services.config.ts):

   ```ts
   {
     key: 'midnuevo',
     displayName: 'Mi Nuevo Servicio',
     group: 'google',          // o 'meta'
     enabled: true,
     timeoutMs: 5000,
   }
   ```

2. Añade el `case 'midnuevo':` en `dispatch()` de
   [`apps/api/src/monitor/monitor.checkers.ts`](../apps/api/src/monitor/monitor.checkers.ts),
   devolviendo un `CheckResult` (`{ status, latencyMs, httpStatus?, errorMessage?, errorCode? }`).

Nada más necesita cambiar: el cron, el endpoint en vivo y la UI lo recogen
automáticamente desde el catálogo.

## Cómo apagar el monitor de fondo

Pon `MONITOR_ENABLED=false` en el `.env` y recrea el contenedor `api`. El cron
no se registra y no se ejecuta ningún check de fondo. El monitoreo en vivo
(MODO B) sigue disponible desde la UI (se controla solo desde el botón).

## Cómo interpretar los incidentes

- Cada fila de `ServiceIncident` es **un incidente completo**, no un check.
- `resolvedAt = NULL` → incidente **abierto** (servicio aún caído).
- `resolvedAt` con fecha → **resuelto**; duración = `resolvedAt - startedAt`.
- `status` es `DOWN` o `DEGRADED` (nunca `UP`: solo guardamos fallos).
- `errorCode` agrupa la causa (`TIMEOUT`, `AUTH`, `HIGH_LATENCY`, `NO_TARGET_ORG`…).
- Al reiniciar el API, los incidentes abiertos se releen para no duplicar.

## Limpieza manual desde SQL (si la UI falla)

La UI tiene "Limpiar histórico" (`DELETE /monitor/incidents?before=ISO`) y hay
una limpieza automática diaria (3 AM, `MONITOR_RETENTION_DAYS`). Como respaldo:

```sql
-- Borrar incidentes resueltos anteriores a una fecha
DELETE FROM "ServiceIncident"
WHERE "resolvedAt" IS NOT NULL
  AND "resolvedAt" < '2025-01-01';

-- Ver incidentes abiertos ahora mismo
SELECT "serviceKey", "status", "startedAt", "errorCode"
FROM "ServiceIncident"
WHERE "resolvedAt" IS NULL
ORDER BY "startedAt" DESC;
```

## Migración de Prisma

```bash
docker exec antigravity_api_prod npx prisma db push --schema=packages/database/prisma/schema.prisma
```

# Consulta en vivo al HIS (rastreo de paciente, Fase 2)

> **Estado (2026-09-20):** implementada y verificada contra Postgres real y por HTTP de extremo a extremo. **El SQL NO se ha ejecutado contra un SQL Server real** y **el costo sobre la base del hospital NO está medido**. Por eso `HospitalMirrorConfig.lookupEnabled` sale **apagado** y no hay ningún interruptor en pantalla: se enciende a mano, clínica por clínica, **después de la medición de este documento**.
>
> Diseño general: [`PLAN_RASTREO_PACIENTE.md`](../../PLAN_RASTREO_PACIENTE.md) §7. Este archivo es lo específico de este hospital: el SQL, cómo medirlo y cómo encenderlo.

## Para qué sirve

Un funcionario investiga una cita y necesita saber qué tiene el hospital **ahora**: ¿la cita existe?, ¿a nombre de quién? La API no alcanza el HIS (solo el agente lo ve), así que la pregunta viaja por el agente, igual que los avisos masivos:

```
pantalla ─▶ HisLookupRequest (Postgres) ◀─ GET /mirror/lookup-requests ─ agente ─▶ SQL Server
                                        ◀─ POST /mirror/lookup-result ──────┘
```

El agente pregunta cada 3 s (`MIRROR_LOOKUP_INTERVAL_MS`). Con el interruptor apagado la API responde `[]`: cuesta una lectura mínima y no es un error.

## Las dos consultas

Código: [`apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/lookup.ts`](../../../apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/lookup.ts). Ambas son **solo `SELECT`**, con parámetros (ningún valor de la petición entra al texto SQL) y `TOP`.

### Por cupo — «¿qué hay en este médico y esta hora?» (barata)

```sql
SELECT TOP (@tope)
       CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
       CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT = @med AND FE_HORA_CIT = @hora
```

`@med` es `VarChar(4)` y `@hora` `VarChar(18)` en el formato `'YYYY/MM/DD HH:mm'` (hora local, con barras). Igualar médico y hora es un **prefijo de la PK** `(médico, hora, estado)`: una búsqueda, no un barrido. Hasta 10 cupos por petición, de a uno.

**No lleva el documento del paciente.** La API se lo quita antes de dárselo al agente; la comparación con el paciente la hace el servidor al recibir la respuesta.

### Por documento — «¿qué citas tiene este documento?» (la que hay que medir)

```sql
SELECT TOP (@tope)
       CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
       CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
   AND NU_HIST_PAC_CIT IN (@hist0[, @hist1])
 ORDER BY FE_FECH_CIT, FE_HORA_CIT
```

`@desde`/`@hasta` son literales `'YYYYMMDD'` con el borde superior **exclusivo**, y la columna va **desnuda**: es la forma sargable que ya usan `fetchAvailability`, `detectChanges` y `snapshotAppointments` (`diaSiguienteLiteralSql`). Envolver `FE_FECH_CIT` en una función apagaría el índice del hospital (`CITAS_MEDICASFE_FECH_CIT` / `IDX_ESEHSVP_CITAS_MEDICAS31931_31930`, ver `ESTADO.md`).

**Esta consulta no es barata.** El hospital no tiene un índice por historia útil aquí: la consulta recorre el **rango de fechas** y filtra por `NU_HIST_PAC_CIT`. `@hist1` es la variante sin ceros a la izquierda, si difiere.

## Lo que la protege

| Defensa | Dónde |
|---|---|
| Solo lectura, parámetros, sin valores en el texto SQL | `lookup.ts` (probado: ningún `INSERT/UPDATE/DELETE`, nada de la petición en el texto) |
| Ventana por documento acotada: por defecto de **−7 a +60 días**, estirada hasta cubrir las citas relevantes, **máximo 180 días** | `LIMITES_CONSULTA_HIS.ventanaDiasMax`, `ventanaPorDocumento` |
| Tope de filas (50) y de cupos (10) por petición | `LIMITES_CONSULTA_HIS` |
| **Tope de tiempo de 10 s que CANCELA la consulta en el servidor** (`request.cancel()`), no solo deja de esperarla | `ejecutarConTope` — dejar de esperar sin cancelar no quita la carga |
| Una clave de médico de más de 4 caracteres se rechaza (no se recorta en silencio y busca a otro médico) | `porCupo` |
| Validación de la petición en el agente **antes** de tocar el HIS, aunque el servidor ya la haya validado | `MirrorEngine.syncLookupRequests` |
| Un rol acotado a una EPS o a un médico **no** pide la lista por documento | `planDeConsultaA/B` |
| Límite de **10 consultas por usuario cada 10 min** (`RASTREO_MAX_CONSULTAS_HIS`, `RASTREO_VENTANA_MIN`) y **5 en curso por clínica** | `servicio-his.ts` |
| Un error o un tiempo agotado es un **error**, nunca una lista vacía | `lookup.ts` / `MirrorLookupService.applyResult` |

## Costo esperado — ESTIMADO, no medido

Con los volúmenes ya documentados (`CITAS_MEDICAS`: 1.084.093 filas / 855 MB; 27.877 citas en 90 días ≈ 310 al día):

| Consulta | Filas que el motor debe recorrer (estimado) |
|---|---|
| Por cupo | 1 búsqueda por la PK (unas pocas filas) |
| Por documento, ventana por defecto (~67 días) | ≈ 21.000 filas del rango de fechas |
| Por documento, ventana máxima (180 días) | ≈ 56.000 filas |

Es del mismo orden que la instantánea de la reconciliación diaria (90 días), pero **disparada por una persona**, hasta 10 veces cada 10 min por usuario. Por eso se mide antes.

## Medición en el laboratorio del hospital — OBLIGATORIA antes de encender

Aceptación del plan (§9): *«probada primero en el laboratorio del hospital con el costo de la consulta medido»*. Con el mismo criterio de la Fase 0 del espejo: se corre en el laboratorio (`PRUEBAS`) sobre una copia representativa, **no** en producción.

1. **Permisos.** Con el login `agenia_sync`: `SELECT TOP 1 * FROM dbo.CITAS_MEDICAS`. No se esperan permisos nuevos (ya lee esa tabla) — **a confirmar con el hospital**.
2. **Por cupo.** Con un médico y una hora reales: `SET STATISTICS IO, TIME ON;` y la consulta de arriba. Anotar lecturas lógicas y tiempo. Debe ser un *Index Seek* / *Clustered Index Seek* sobre la PK.
3. **Por documento.** Con una historia real y ventanas de **7, 60 y 180 días**: `SET STATISTICS IO, TIME ON;` más el **plan de ejecución real**. Anotar: operador sobre `FE_FECH_CIT` (¿*Seek* o *Scan*?), si hay *Key Lookup* para leer `NU_HIST_PAC_CIT` (si el índice no la incluye, cada fila del rango cuesta una lectura extra), lecturas lógicas, tiempo en caché fría y caliente.
4. **Concurrencia.** 5 consultas por documento a la vez, mientras la aplicación del hospital agenda: comprobar que no bloquean sus inserciones (la consulta usa el aislamiento por defecto, como el resto del driver) y que sus tiempos no se degradan.
5. **Cancelación.** Forzar un tiempo agotado (`timeoutMs` bajo) y confirmar que la consulta desaparece de `sys.dm_exec_requests` — la garantía de que un HIS lento no acumula trabajo.

Resultados (llenar):

| Consulta | Ventana | Lecturas lógicas | Tiempo frío / caliente | Plan | ¿Acepta el hospital? |
|---|---|---|---|---|---|
| Por cupo | — | | | | |
| Por documento | 7 d | | | | |
| Por documento | 60 d | | | | |
| Por documento | 180 d | | | | |

**Umbrales propuestos** (a confirmar con quien administra la base del hospital): por cupo < 100 ms; por documento en la ventana por defecto < 3 s en caché fría. Si la de 60 días no cabe, se acorta la ventana por defecto (`ventanaPorDocumento`, [`consulta-his.ts`](../../../apps/web/lib/rastreo/consulta-his.ts)); si ni la de 7 días cabe, se deja la consulta **solo por cupo** (basta cambiar `incluirPorDocumento`) y se propone al hospital un índice por `NU_HIST_PAC_CIT`. Cierra el punto abierto §12 #5 del plan.

## Encender y apagar (por clínica, a mano)

Prerrequisitos, en este orden: migración aplicada → API nueva → **agente actualizado** → web.

1. Comprobar que el agente nuevo reporta la capacidad:
   ```sql
   SELECT "lastHeartbeatAt", "lastHisReachable", "lastLookupCapable", "lookupEnabled"
     FROM "HospitalMirrorConfig" WHERE "organizationId" = '<org>';
   ```
   `lastLookupCapable` debe ser `true`. Si es `NULL`, el agente es anterior a la consulta en vivo y hay que actualizarlo (`actualizarAgente.sh`).
2. Encender:
   ```sql
   UPDATE "HospitalMirrorConfig" SET "lookupEnabled" = true WHERE "organizationId" = '<org>';
   ```
3. Apagar (efecto en el próximo sondeo del agente, ≤ unos segundos; no se pierde nada):
   ```sql
   UPDATE "HospitalMirrorConfig" SET "lookupEnabled" = false WHERE "organizationId" = '<org>';
   ```

El panel del espejo lo muestra en **solo lectura**: si está encendida y el agente no la admite, sale en rojo. Apagada (lo normal) no aparece.

## Qué viaja y qué se guarda

| Dato | Comportamiento |
|---|---|
| Documento del paciente | Viaja al agente **solo** en la consulta por documento. En la de cupo no. |
| Documento de un **tercero** (quien ocupa un cupo) | Llega a la API, se compara con el del paciente y se guarda **solo enmascarado** (`•••3456`). El completo nunca queda en la base ni llega al navegador. |
| `params` y `result` de cada petición | Se **borran a los 15 min** (cron cada minuto). Quedan solo los metadatos. Lo que respondió el HIS no se persiste en ningún otro sitio. |
| Quién consultó, cuándo, por qué motivo | `PatientLookupLog` (`queryKind = 'LIVE_HIS'`), antes de preguntar. Si no se puede anotar, **no se consulta**. |
| Quién puede consultar | ORG_ADMIN, BOOKING_AGENT y SUPER_ADMIN (tras elegir clínica). Nunca DOCTOR. |

## Si algo falla

| La pantalla dice… | Causa probable | Qué hacer |
|---|---|---|
| «La consulta en vivo al HIS no está habilitada para esta clínica» | Interruptor apagado (lo normal) | Solo se enciende tras la medición |
| «El agente instalado en el hospital no admite la consulta en vivo» | Agente anterior, o driver sin la capacidad | Actualizar el agente (`actualizarAgente.sh`) y esperar un latido (≤ 1 min) |
| «El agente del hospital no da señales desde hace N min» | Agente caído | [`RUNBOOK.md`](RUNBOOK.md) → «El agente no da señales» |
| «El agente no puede comunicarse con el sistema del hospital» | El HIS no responde al agente | [`RUNBOOK.md`](RUNBOOK.md) → «El agente está vivo pero no alcanza el sistema del hospital» |
| «El hospital no respondió a la consulta» | Error o tiempo agotado (10 s) en el HIS. **ORG_ADMIN ve el texto exacto** del agente | Ver el journal del agente; si es tiempo agotado repetido, la consulta por documento es demasiado pesada: acortar la ventana |
| «El agente del hospital no contestó a tiempo» | La petición pasó de 60 s sin respuesta | Suele ser un agente reiniciándose; reintentar |
| «Hay otras consultas al hospital en curso» / «Hiciste demasiadas consultas…» | Topes (5 por clínica / 10 por usuario cada 10 min) | Esperar; si es un límite legítimo, ajustar `RASTREO_MAX_CONSULTAS_HIS` |

Un agente **nuevo contra una API vieja** sondea una ruta que no existe y registra un error cada 3 s (el amortiguador de fallos lo deduplica en el log): por eso el orden de despliegue es API primero.

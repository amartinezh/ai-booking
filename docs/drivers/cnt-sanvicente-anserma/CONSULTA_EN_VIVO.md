# Consulta en vivo al HIS (rastreo de paciente, Fase 2)

> **Estado (2026-09-20, tarde):** implementada, verificada contra Postgres real y por HTTP de extremo a extremo, y **MEDIDA contra el SQL Server del hospital** (`PRUEBAS`, SQL Server 2017 14.0.3465.1). El costo salió **muy por debajo** de los umbrales: la consulta por cupo cuesta **3 lecturas lógicas** y la más pesada por documento **60**, no las decenas de miles que se estimaban (ver «Resultado de la medición»). **No hace falta acortar la ventana ni pedirle un índice al hospital.**
>
> Quedan dos cosas antes de encender: (1) repetir la PARTE A del script con el login `agenia_sync` (la medición se corrió con `ADMIN`, así que el permiso mínimo del agente **no** está confirmado); (2) decidir qué se hace con las citas cuyo `FE_HORA_CIT` el HIS guarda en un formato ilegible, porque la consulta **por cupo** no las encuentra y la pantalla afirmaría «el HIS no tiene ninguna cita en ese cupo» — ver «El riesgo que destapó la medición».
>
> Diseño general: [`PLAN_RASTREO_PACIENTE.md`](../../PLAN_RASTREO_PACIENTE.md) §7. Este archivo es lo específico de este hospital: el SQL, cómo medirlo y cómo encenderlo. La medición está lista para ejecutar en [`sql/MEDICION_CONSULTA_EN_VIVO.sql`](sql/MEDICION_CONSULTA_EN_VIVO.sql).

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

`@hist1` es la variante sin ceros a la izquierda, si difiere.

> ⚠️ **Corrección (2026-09-20, tras medir).** Este documento decía que «esta consulta no es barata» porque «el hospital no tiene un índice por historia útil aquí» y que por eso recorría el rango de fechas. **Es falso.** La PARTE C del script de medición mostró que `CITAS_MEDICAS` tiene **12 índices**, y **tres** empiezan por `NU_HIST_PAC_CIT`:
>
> | Índice | Clave | Incluye |
> |---|---|---|
> | `CITAS_MEDICASNU_HIST_PAC_CIT` | `NU_HIST_PAC_CIT` | — |
> | `IDX_ESEHSVP_CITAS_MEDICAS56579_56578` | `NU_HIST_PAC_CIT, NU_NUME_MOVI_CIT, NU_ESTA_CIT` | — |
> | `IDX_ESEHSVP_CITAS_MEDICAS56577_56576` | `NU_HIST_PAC_CIT, NU_NUME_MOVI_CIT, CD_CODI_CECO_CIT, NU_ESTA_CIT` | `CD_CODI_ESP_CIT, CD_CODI_SER_CIT, NU_NUME_CONV_CIT, NU_TIPO_CIT` |
>
> El motor **busca por el documento** (`Index Seek` + `Merge Interval`, un seek por cada valor del `IN`) y descarta por fecha después. Por eso el tamaño de la ventana casi no influye y la consulta resultó barata. El índice sobre `FE_FECH_CIT` sigue importando para las otras consultas del driver (disponibilidad, detección de cambios, reconciliación), que sí van por rango de fechas.

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

## Resultado de la medición (2026-09-20, `PRUEBAS` del hospital)

Corrida con [`sql/MEDICION_CONSULTA_EN_VIVO.sql`](sql/MEDICION_CONSULTA_EN_VIVO.sql) sobre `PRUEBAS`, servidor `sql2017-pro2-dp`, SQL Server 2017 Standard 14.0.3465.1, nivel de compatibilidad 140.

**El permiso del agente: confirmado (2026-09-21).** La PARTE A se corrió impersonando el login del agente (`ejecutando_como = agenia_sync`, no `ADMIN`) y las tres consultas —por cupo, por documento y la de horas ilegibles— pasaron sin error, en `PRUEBAS` y en `ESEHSVP`. **La consulta en vivo no pide ningún `GRANT` nuevo.**

> 🔎 De paso, esa salida deja ver que `agenia_sync` tiene `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre `CITAS_MEDICAS`. Es **por diseño**: el espejo escribe las citas en el HIS y la cancelación hace un `DELETE` puntual (`AGENIA_SYNC_SETUP.sql` §4). Conviene tenerlo presente: que la consulta en vivo sea de **solo lectura** lo garantiza nuestro código —y una prueba que falla si aparece un `INSERT/UPDATE/DELETE` en el texto SQL—, **no** el permiso del login. Si se quisiera que también lo garantice la base, haría falta un segundo login de solo lectura para las consultas, y que el agente abra una conexión aparte con él. Hoy no está, y no es un requisito para encender.

**La copia es representativa:** `PRUEBAS` tiene **1.087.077** filas y `ESEHSVP` (vivo) **1.089.082** — 99,8 %. Los datos del índice agrupado ocupan 178 MB en las dos (los 855 MB que reporta `ESTADO.md` deben incluir los 11 índices no agrupados).

| Consulta | Ventana | Lecturas lógicas | Filas | CPU / transcurrido | Plan |
|---|---|---|---|---|---|
| Por cupo | — | **3** | 1 | 0 ms / 0–4 ms | `Clustered Index Seek` + `Top` |
| Por documento | 7 d | **18** | 4 | 1–4 ms / 0–8 ms | `Index Seek` + `Merge Interval` + `Nested Loops` |
| Por documento | 67 d (por defecto) | **43** | 5 | 2–3 ms / 0–4 ms | igual |
| Por documento | 180 d (máxima) | **60** | 5 | 3–4 ms / 3–4 ms | igual |
| Por documento | 180 d, documento inexistente | **6** | 0 | 1 ms / 0 ms | igual |

Promedios acumulados (PARTE F): por cupo 3 lecturas por ejecución; por documento 31, con 1 ms de CPU y 2 ms transcurridos de media (máximo 3 ms).

**Veredicto: pasa con un margen enorme.** Los umbrales propuestos eran < 100 ms por cupo y < 3 s por documento en la ventana por defecto; lo medido son **3 y 43 lecturas lógicas**, con milisegundos de un dígito. En consecuencia:

- **No hay que acortar la ventana.** Entre 7 y 180 días la diferencia es de 18 a 60 lecturas: irrelevante.
- **No hay que pedirle ningún índice al hospital.** Ya tiene tres por `NU_HIST_PAC_CIT`.
- **La estimación previa de este documento erraba por tres órdenes de magnitud** (calculaba 21.000–56.000 filas recorridas) porque partía de que no existía un índice por historia.
- **El «peor caso» que planteó el script tampoco era el peor**: sin citas es el caso más BARATO (6 lecturas), porque el seek por documento no encuentra nada y no llega a tocar el rango de fechas. El verdadero techo es un paciente con **historia larga**: el motor lee todas sus citas y descarta por fecha. Lo mide la PARTE G, que quedó pendiente de correr.

Cierra el punto abierto §12 #5 del plan: la ventana se queda en **−7 / +60 días, máximo 180**, tal como está.

## El riesgo que destapó la medición: horas que el HIS guarda ilegibles

La consulta de descubrimiento (PARTE D) eligió como cupo de prueba `PS06` a las `2026/09/19 3`. **Esa hora no cumple el formato** `'YYYY/MM/DD HH:MM'`, y no es un caso aislado: `MAPEO_HIS.md` §2.1 ya había documentado que el **5,7 %** de las citas elaboradas en 30 días tiene un `FE_HORA_CIT` que no se puede interpretar (longitudes 12/13, valores como `'2026/08/29 1'` o `'31'`). El lector del agente es tolerante a propósito: devuelve `null` y marca la fila como ilegible.

Para el resto del espejo eso significa *saltarse* una fila. **Para la consulta en vivo significa afirmar algo falso**, y por dos caminos distintos:

| Consulta | Qué pasa con una cita de hora ilegible | Consecuencia |
|---|---|---|
| **Por cupo** | La hora se construye desde el instante (`formatFeHoraCit` → `'2026/09/19 03:00'`) y se compara con `=`. Contra `'2026/09/19 3'` **no coincide**: cero filas | La pantalla concluye **«El HIS no tiene ninguna cita en ese cupo»** (`NO_ESTA_EN_EL_HIS`). Es un **falso negativo**, y contradice el principio del plan §3.3: un veredicto nunca debe afirmar lo que no sabe |
| **Por documento** | La fila llega, no se puede interpretar la hora, se descarta y se marca `truncated` | La cita **no aparece** en la lista del HIS. `truncated` viaja del agente a la API y se guarda… pero **la web no lo lee en ningún sitio**: la pantalla no avisa de que la respuesta vino incompleta |

Riesgo por escenario: en el **A** (la cita la creó AgenIA) no aplica, porque esa fila la escribió nuestro agente con el escritor estricto. En el **B** —«la agendaron en el HIS y no sale en WhatsApp», justo el que la consulta en vivo venía a completar— **sí aplica**, porque esa fila la escribió la aplicación del hospital.

✅ **Corregido el 2026-09-21 lo que no dependía de medir nada.** El recorte que reporta el agente se perdía en la consulta por cupo (`resolverRespuestaHis` lo descartaba); ahora viaja hasta el veredicto, y con una respuesta incompleta:

- **no** se concluye `NO_ESTA_EN_EL_HIS`, sino el veredicto nuevo `HORA_ILEGIBLE_EN_EL_HIS`, que dice qué no se sabe y manda a mirar el cupo en la aplicación del hospital;
- en el escenario A no se acusa una deriva entre los dos sistemas: la cita queda «sin verificar», diciendo por qué;
- la pantalla avisa en ámbar que **que ahí no aparezca una cita no significa que el hospital no la tenga**.

✅ **Y cerrado del todo el mismo día.** La primera corrección no alcanzaba: en la consulta por cupo el aviso del agente casi nunca se enciende, porque la fila con la hora ilegible **no la devuelve** la comparación `FE_HORA_CIT = @hora`. Ahora, **cuando un cupo viene vacío**, el agente hace una segunda consulta acotada a ese médico y ese día:

```sql
SELECT TOP (25) …
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT = @med
   AND FE_HORA_CIT LIKE @dia          -- 'YYYY/MM/DD%' → prefijo de la PK
   AND FE_HORA_CIT NOT LIKE @patron   -- el formato legible, como clases de caracteres
```

Reporta **cuántas** hay (`unreadableSlots`), y nada más: `'2026/09/18 2'` no dice si son las 02:00 o las 14:00, así que **no se adivina la hora**. El servidor lo guarda por cupo y el veredicto lo dice tal cual.

**Costo, medido contra un SQL Server real con 176.800 citas:** la consulta del cupo no encuentra la fila (3 lecturas lógicas); la nueva sí la encuentra, con un **`Clustered Index Seek`** y **5 lecturas lógicas**. Solo corre cuando el cupo vino vacío, así que en el caso normal no cuesta nada.

La PARTE G sigue siendo útil para saber **cuántas** son y en qué médicos se concentran —y poder hablarlo con el hospital—, pero ya no condiciona encender la consulta.

## El script de medición (cómo se obtuvieron esos números)

Aceptación del plan (§9): *«probada primero en el laboratorio del hospital con el costo de la consulta medido»*. Con el mismo criterio de la Fase 0 del espejo: se corre en el laboratorio (`PRUEBAS`) sobre una copia representativa, **no** en producción.

Todo está en un solo script, listo para abrir en SSMS: [`sql/MEDICION_CONSULTA_EN_VIVO.sql`](sql/MEDICION_CONSULTA_EN_VIVO.sql). Es **estrictamente solo lectura** (solo `SELECT`, `READ UNCOMMITTED`, ningún objeto creado ni alterado) y ejecuta **las mismas dos consultas que corre el agente**, con los mismos tipos de parámetro, para que el plan medido sea el que correrá en producción. Se verificó contra un SQL Server real antes de entregarlo (corre limpio, sin errores, tanto en SSMS como en `sqlcmd`).

Qué hace, por partes:

| Parte | Qué responde | Con qué login |
|---|---|---|
| A | ¿Puede el agente leer `CITAS_MEDICAS` sin permisos nuevos? | `agenia_sync` |
| B | ¿Es representativa la copia `PRUEBAS` frente al catálogo vivo? (por metadatos, sin leer filas) | DBA |
| C | ¿Algún índice sobre `FE_FECH_CIT` **incluye** `NU_HIST_PAC_CIT`? Es lo que decide si cada fila del rango cuesta una lectura extra | DBA |
| D | Elige de los datos un médico, una hora y una historia reales con los que medir | DBA |
| E | **La medición**: por cupo, y por documento en ventanas de 7 d, 67 d (la de por defecto) y 180 d (la máxima), más el **peor caso** | DBA o `agenia_sync` |
| F | Qué plan usó cada consulta (¿*Seek* o *Scan*? ¿hay *Key Lookup*? ¿parallelismo?) y cuántas lecturas lógicas | DBA (necesita `VIEW SERVER STATE`) |

**El peor caso es una historia que NO existe**, y es además el más frecuente al diagnosticar: si el paciente no tiene citas, el `TOP 51` no puede cortar antes y hay que recorrer el rango de fechas completo. Esa fila de la medición es la que decide.

🚫 **El script NO usa `DBCC DROPCLEANBUFFERS`, a propósito.** `PRUEBAS` vive en la **misma instancia** que `ESEHSVP` (`192.168.1.16:1433`), así que ese comando vaciaría la caché de la base viva y volvería lenta la aplicación del hospital durante minutos. En su lugar mide dos veces y reporta las **lecturas lógicas**, que no dependen de la caché. Si el DBA quiere una medición en frío de verdad, el script explica cómo hacerlo afectando solo a `PRUEBAS` (`SET OFFLINE`/`SET ONLINE`).

Resultados (llenar con la salida del script y con la pestaña *Messages*):

| Consulta | Ventana | Lecturas lógicas | CPU / tiempo | Plan (operadores) | ¿Acepta el hospital? |
|---|---|---|---|---|---|
| Por cupo | — | | | | |
| Por documento | 7 d | | | | |
| Por documento | 67 d (por defecto) | | | | |
| Por documento | 180 d (máxima) | | | | |
| **Por documento, historia inexistente** | 180 d | | | | |

**Cómo se lee.** Mirar las **lecturas lógicas**, no los milisegundos: con la tabla en caché los tiempos salen en pocos ms y engañan. Dos señales concretas:

- Si el plan hace un **Scan** del índice agrupado y las lecturas lógicas son parecidas en las tres ventanas, el motor recorre la tabla completa y **acortar la ventana no arreglaría nada**. En el ensayo local del script (una copia pequeña) pasó justo eso; la tabla del hospital es 18 veces más grande y puede decidir distinto — por eso se mide allá y no se supone.
- Si aparece `Parallelism`, el plan usa varios núcleos y el CPU pesa más de lo que sugiere el tiempo transcurrido, sobre todo en una instancia ocupada.

**Umbrales propuestos** (a confirmar con quien administra la base): por cupo < 100 ms y un *Index Seek*; por documento en la ventana por defecto < 3 s en caché fría. Según el resultado:

- **Todo dentro de los umbrales** → se enciende `lookupEnabled` por clínica (abajo).
- **La de 67 d no cabe** → se acorta la ventana por defecto (`ventanaPorDocumento`, [`consulta-his.ts`](../../../apps/web/lib/rastreo/consulta-his.ts)).
- **Ni la de 7 d cabe** → se deja **solo la consulta por cupo** (`incluirPorDocumento`) y se le propone al hospital un índice por `NU_HIST_PAC_CIT`.
- **Aparece un *Key Lookup*** donde se esperaba cubrir la consulta → antes de tocar nuestras ventanas, ver si a un índice existente le falta un `INCLUDE (NU_HIST_PAC_CIT)`: puede ser una mejora barata para el hospital, no solo para nosotros.

Cierra el punto abierto §12 #5 del plan.

**Lo que este script NO puede medir** (necesita el agente corriendo, es la segunda ronda):

1. **Concurrencia**: 5 consultas por documento a la vez mientras el hospital agenda, comprobando que no se degradan sus inserciones. Se aproxima abriendo 5 ventanas de SSMS con la PARTE E.
2. **Cancelación por tiempo agotado**: que la consulta desaparezca de `sys.dm_exec_requests` cuando el agente la cancela a los 10 s (`ejecutarConTope`). Es una prueba del agente, no del SQL.

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

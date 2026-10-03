# Plan — «¿Qué citas tengo?» en el bot

Estado: **Fase A en producción de código** (commit del 2026-10-02). **Fase B: B1, B2 y el mecanismo de B3 implementados el 2026-10-02, APAGADOS por defecto** (`botLookupMode = OFF`). Encender en sombra espera a B0 (§4.1).

## 0. Decisiones confirmadas

| # | Decisión | Quién / cuándo |
|---|---|---|
| D1 | La consulta muestra las citas de AgenIA y **también pregunta al HIS en vivo, pero solo si la conexión con el hospital está prendida**. El código es genérico: cualquier hospital, o ninguno. | Usuario, 2026-10-02 |
| D2 | **El detalle (servicio, médico, hora) solo cuando quien escribe es el paciente**; a cualquier otro, una respuesta mínima (cuántas citas, sin distinguir «no existe» de «sin citas»). | Usuario, 2026-10-02 |
| D3 | Se empieza por la Fase A (solo AgenIA + advertencia). | Usuario, 2026-10-02 |
| D4 | El bot tiene **interruptor propio** (implementado como `botLookupMode`: OFF · SHADOW · ON), separado de `lookupEnabled` del personal. | Usuario, 2026-10-02 |
| D5 | **Dos mensajes**: AgenIA al instante y el seguimiento del hospital después; el turno no espera al HIS. | Usuario, 2026-10-02 |
| D6 | Si el hospital no trae nada nuevo, **silencio** (sin segundo mensaje). | Usuario, 2026-10-02 |
| D7 | El paciente **no** puede cancelar por el bot una cita que solo existe en el HIS (en esta fase). | Usuario, 2026-10-02 |
| D8 | Umbral de entrada: se enciende solo si **≥ 2 %** de las consultas del modo sombra tienen diferencias. | Usuario, 2026-10-02 |

## 1. Fase A — hecha

- Intención `[lookup]` (`chatbot-patterns.txt`, sin LLM) + `isLookup` en el prompt.
- Estados `AWAITING_LOOKUP_CEDULA` y `AWAITING_LOOKUP_CHOICE` (A cancelar · B cambiar fecha · C agendar · D nada más).
- `@agenia/shared/src/consulta-citas.ts`: `estadoConexionHis` (SIN_HOSPITAL · APAGADA · CAIDA · VIVA, la misma regla que usa la pantalla del rastreo), `remitenteEsDelPaciente`, `diaLocal`.
- Con hospital, la respuesta advierte que una cita agendada allá podría no aparecer, **porque la Fase A no consulta el HIS**. Cada consulta deja `metadata.conexionHis` en la bitácora.

## 2. Qué añade la Fase B (y qué no)

Con el alta en caliente, una cita agendada en el hospital ya crea su cita en AgenIA. El HIS en vivo solo aporta:

1. citas anteriores a la puesta en marcha del alta en caliente (no fue retroactiva, D7 de `PLAN_ALTA_EN_CALIENTE.md`);
2. citas recién creadas que aún no llegaron;
3. citas cuya llegada falló (documento ambiguo, error del agente).

Por eso la Fase B **se justifica con datos, no por defecto** (ver §5, criterio de entrada). Si el aporte es marginal, la Fase A se queda como está y la advertencia es la solución.

**Fuera de alcance:** consultar el HIS para la respuesta mínima (D2). A quien no probó ser el paciente no se le carga trabajo al hospital.

## 3. Diseño

### 3.1 Reutiliza la consulta en vivo del rastreo (Fase 2)

Mismo canal y mismo agente: `HisLookupRequest` con `kind = 'BY_DOCUMENT'`, el agente la recoge en su vuelta (cada 3 s) y responde a `POST /mirror/lookup-result`; `resolverRespuestaHis` enmascara a terceros. **El agente y el driver no cambian**: para el driver, una petición del bot es igual a una del personal.

Cambios en la base (migración aditiva):

- `HisLookupRequest.requestedBy` deja de ser solo un usuario: columna nueva `origin` (`'STAFF' | 'BOT'`, default `'STAFF'`); para el bot, `requestedByUserId = 'chatbot'` y además se guarda el remitente seudonimizado (no el teléfono).
- `HospitalMirrorConfig.botLookupMode` (`OFF` · `SHADOW` · `ON`, default `OFF`): **interruptor propio del bot** (D4), separado de `lookupEnabled`. La carga del bot crece con los pacientes y la del personal no; el hospital debe poder aceptar una sin la otra. Es un modo y no un sí/no para que el modo sombra de B3 sea un valor del mismo interruptor, como `availabilityMode`.
- `HisLookupRequest.botFollowupAt`: cuándo el bot atendió el resultado (compare-and-set entre réplicas).

El bot solo consulta si `botLookupMode ≠ OFF` **y** `estadoConexionHis(...)`, con el interruptor del bot en lugar del del personal, da `VIVA`. El agente recibe las peticiones `STAFF` si `lookupEnabled` y las `BOT` si `botLookupMode ≠ OFF`.

### 3.2 Conversación asíncrona (no bloquear el turno)

El turno no espera al HIS. Si esperara, la cola de mensajes del paciente (`inbound-queue`) quedaría retenida hasta 30-60 s.

1. El paciente pregunta → el bot responde **de inmediato** con lo de AgenIA y, en la misma burbuja, «Estoy confirmando con el hospital, le aviso en un momento». El paciente ya puede elegir A-D.
2. Cada 5 s el chatbot barre las peticiones `BOT` ya cerradas y sin `botFollowupAt` (`ConsultaHisBotService.reclamarSeguimientos`). Es un barrido y no un evento de `applyResult` para no acoplar el módulo del espejo al del chatbot y para tratar igual una respuesta, un error y un vencimiento. Con cada una:
   - **Hay citas que AgenIA no tenía** → un segundo mensaje: «El hospital tiene además: …».
   - **No hay nada nuevo** → **ningún** mensaje (D6).
3. Si vence (`EXPIRADA`, 60 s) o el agente responde `ERROR` → un mensaje con la advertencia de la Fase A. El paciente nunca queda esperando sin respuesta.

Si el paciente ya cambió de tema (otro estado, o cerró la conversación), el segundo mensaje se descarta: no se interrumpe un agendamiento en curso.

### 3.3 Qué se muestra de lo que devolvió el HIS

- **Solo las filas cuyo titular es el paciente** (`titular` de `CitaHisVista`); las de terceros, nunca.
- Sin duplicados con AgenIA: misma clave de médico (`MirrorEntityMap`, `DOCTOR`) **y** misma hora al minuto (`mismoInstante`; el HIS guarda minutos).
- Nombres: médico y servicio por `MirrorEntityMap` → perfil de AgenIA → etiqueta del catálogo (la regla de `etiquetasDeMedicosHis` de la web, que se mueve a shared). Sin mapeo: «cita en el hospital» con fecha y hora, sin la clave cruda.
- Las citas que solo existen en el HIS se muestran como **solo lectura**: A/B (cancelar, cambiar fecha) actúan sobre citas de AgenIA. Si el paciente quiere tocar una del hospital, el bot le da el teléfono. Que el bot no las cancele es la decisión D7; reabrirla requiere acuerdo con el hospital.

### 3.4 Límites (nuevos, del bot)

| Límite | Valor propuesto | Por qué |
|---|---|---|
| Pendientes del bot por clínica | 3 | Aparte de las 5 del personal: el bot no deja sin consulta a la ventanilla. |
| Por paciente | 1 cada 10 min | Repetir «¿qué citas tengo?» no debe volver a cargar el HIS. |
| Reutilizar resultado | 5 min | Si hay una `RESUELTA` reciente del mismo paciente, se usa esa. |
| Ventana | hoy 00:00 local → +60 días | Dentro del tope de 180 días de la consulta por documento. |

Superado un límite → respuesta de la Fase A, sin error para el paciente.

## 4. Pasos

| Paso | Contenido | Estado |
|---|---|---|
| B0 | **Prerrequisito externo:** medir en el laboratorio del hospital el costo de la consulta por documento (`CONSULTA_EN_VIVO.md` del driver, la tabla pendiente de la Fase 2 del rastreo). | **Pendiente (hospital).** |
| B1 | Migración `20261002100000_consulta_citas_bot_his` (`botLookupMode`, `origin`, `botFollowupAt`); el agente recibe cada origen según su interruptor; el tope de la ventanilla no cuenta las del bot. | Hecho. Postgres 15 real: cero deriva. |
| B2 | `ConsultaHisBotService` (plan, límites, seguimiento, deduplicación, nombres) + mensajes y barrido en `ChatbotService`. | Hecho. 14 E2E conversacionales, 12 mutantes detectados, punta a punta con Postgres real (plan → agente → `applyResult` → seguimiento, dos réplicas, vencida). |
| B3 | **Modo sombra** una semana en una clínica: `botLookupMode = 'SHADOW'`. | Mecanismo hecho; encenderlo espera a B0. |
| B4 | `botLookupMode = 'ON'` por clínica. | Según §5 (D8). |

### 4.1 Encender, medir y apagar

Sin pantalla, como `lookupEnabled`, se cambia con SQL por clínica. **Requisito previo:** B0 aprobado y el agente del hospital reportando `lastLookupCapable = true`.

```sql
-- B3: modo sombra (el paciente no ve nada distinto de la Fase A)
UPDATE "HospitalMirrorConfig" SET "botLookupMode" = 'SHADOW' WHERE "organizationId" = '<org>';
-- B4: encendido (solo si §5 lo justifica)
UPDATE "HospitalMirrorConfig" SET "botLookupMode" = 'ON'     WHERE "organizationId" = '<org>';
-- Apagado inmediato (las peticiones en curso dejan de entregarse al agente)
UPDATE "HospitalMirrorConfig" SET "botLookupMode" = 'OFF'    WHERE "organizationId" = '<org>';
```

Medición de D8, una fila por consulta al hospital atendida:

```sql
SELECT
  count(*)                                                    AS consultas,
  count(*) FILTER (WHERE metadata->>'status' = 'RESUELTA')    AS respondidas,
  count(*) FILTER (WHERE (metadata->>'nuevas')::int > 0)      AS con_diferencias,
  round(100.0 * count(*) FILTER (WHERE (metadata->>'nuevas')::int > 0)
        / NULLIF(count(*) FILTER (WHERE metadata->>'status' = 'RESUELTA'), 0), 2) AS pct
FROM "InteractionLog"
WHERE "organizationId" = '<org>'
  AND metadata->>'step' = 'HIS_LOOKUP_RESULT'
  AND "createdAt" >= now() - interval '7 days';
```

Las consultas que el bot NO hizo (conexión caída, topes) quedan en la fila de la consulta (`metadata.accionHis`: `SIN_CONSULTA` · `LIMITADA` · `CONSULTANDO` · `REUTILIZADA`, y `metadata.conexionHis`).

## 5. Criterio de entrada

Con la Fase A ya en uso se mide, de la bitácora:

- cuántas consultas hay por semana y en qué `conexionHis` (si casi siempre es APAGADA o CAIDA, la Fase B no cambiaría nada todavía);
- en el modo sombra (B3), en qué proporción de consultas el HIS tenía al menos una cita que AgenIA no mostraba.

**Regla (D8):** si en B3 menos del 2 % de las consultas tienen diferencias, no se enciende la Fase B. Se mantiene la advertencia y se revisa por qué faltan esas pocas citas en el alta en caliente: arreglar la llegada es mejor que consultar cada vez.

## 6. Puntos abiertos

Ninguno de diseño: P1-P5 se cerraron el 2026-10-02 (D4-D8 en §0). Lo único que bloquea es externo: la medición de B0.

## 7. Riesgos

- **Carga sobre el HIS de producción**: cubierta por B0, los límites de §3.4, el interruptor propio y el modo sombra.
- **Datos de salud a quien no es el paciente**: el HIS solo se consulta tras `remitenteEsDelPaciente`, y solo se muestran filas del titular.
- **Mensajes a destiempo**: el seguimiento se descarta si el paciente cambió de tema; en WhatsApp, fuera de la ventana de 24 h no se envía (no hay plantilla para esto).

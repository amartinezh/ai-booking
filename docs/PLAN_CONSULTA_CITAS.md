# Plan — «¿Qué citas tengo?» en el bot

Estado: **Fase A en producción de código** (commit del 2026-10-02). **Fase B: definida aquí, sin empezar.**

## 0. Decisiones confirmadas

| # | Decisión | Quién / cuándo |
|---|---|---|
| D1 | La consulta muestra las citas de AgenIA y **también pregunta al HIS en vivo, pero solo si la conexión con el hospital está prendida**. El código es genérico: cualquier hospital, o ninguno. | Usuario, 2026-10-02 |
| D2 | **El detalle (servicio, médico, hora) solo cuando quien escribe es el paciente**; a cualquier otro, una respuesta mínima (cuántas citas, sin distinguir «no existe» de «sin citas»). | Usuario, 2026-10-02 |
| D3 | Se empieza por la Fase A (solo AgenIA + advertencia). | Usuario, 2026-10-02 |

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
- `HospitalMirrorConfig.botLookupEnabled Boolean @default(false)`: **interruptor propio del bot**, separado de `lookupEnabled`. La carga del bot crece con los pacientes y la del personal no; el hospital debe poder aceptar una sin la otra.

El bot solo consulta si `estadoConexionHis(...) === 'VIVA'` **y** `botLookupEnabled`.

### 3.2 Conversación asíncrona (no bloquear el turno)

El turno no espera al HIS. Si esperara, la cola de mensajes del paciente (`inbound-queue`) quedaría retenida hasta 30-60 s.

1. El paciente pregunta → el bot responde **de inmediato** con lo de AgenIA y, en la misma burbuja, «Estoy confirmando con el hospital, le aviso en un momento». El paciente ya puede elegir A-D.
2. Al llegar la respuesta del agente (`MirrorLookupService.applyResult`), si `origin = 'BOT'` se emite un evento que el chatbot atiende:
   - **Hay citas que AgenIA no tenía** → un segundo mensaje: «El hospital tiene además: …».
   - **No hay nada nuevo** → un mensaje corto («Confirmado con el hospital: son todas»), o **ninguno**. Esto queda por decidir (P3).
3. Si vence (`EXPIRADA`, 60 s) o el agente responde `ERROR` → un mensaje con la advertencia de la Fase A. El paciente nunca queda esperando sin respuesta.

Si el paciente ya cambió de tema (otro estado, o cerró la conversación), el segundo mensaje se descarta: no se interrumpe un agendamiento en curso.

### 3.3 Qué se muestra de lo que devolvió el HIS

- **Solo las filas cuyo titular es el paciente** (`titular` de `CitaHisVista`); las de terceros, nunca.
- Sin duplicados con AgenIA: misma clave de médico (`MirrorEntityMap`, `DOCTOR`) **y** misma hora al minuto (`mismoInstante`; el HIS guarda minutos).
- Nombres: médico y servicio por `MirrorEntityMap` → perfil de AgenIA → etiqueta del catálogo (la regla de `etiquetasDeMedicosHis` de la web, que se mueve a shared). Sin mapeo: «cita en el hospital» con fecha y hora, sin la clave cruda.
- Las citas que solo existen en el HIS se muestran como **solo lectura**: A/B (cancelar, cambiar fecha) actúan sobre citas de AgenIA. Si el paciente quiere tocar una del hospital, el bot le da el teléfono. Que el bot pueda cancelarlas sería otra decisión, con el hospital (ver P4).

### 3.4 Límites (nuevos, del bot)

| Límite | Valor propuesto | Por qué |
|---|---|---|
| Pendientes del bot por clínica | 3 | Aparte de las 5 del personal: el bot no deja sin consulta a la ventanilla. |
| Por paciente | 1 cada 10 min | Repetir «¿qué citas tengo?» no debe volver a cargar el HIS. |
| Reutilizar resultado | 5 min | Si hay una `RESUELTA` reciente del mismo paciente, se usa esa. |
| Ventana | hoy 00:00 local → +60 días | Dentro del tope de 180 días de la consulta por documento. |

Superado un límite → respuesta de la Fase A, sin error para el paciente.

## 4. Pasos

| Paso | Contenido | Sale cuando |
|---|---|---|
| B0 | **Prerrequisito externo:** medir en el laboratorio del hospital el costo de la consulta por documento (`CONSULTA_EN_VIVO.md` del driver, la tabla pendiente de la Fase 2 del rastreo). | La medición cumple su criterio de aceptación. |
| B1 | Migración (`origin`, `botLookupEnabled`) + emisión del evento en `applyResult` + mover el etiquetado de médicos a shared. | Unitarias, Postgres real con cero deriva. |
| B2 | Bot: encolar en VIVA, mensaje inmediato, seguimiento por evento/vencimiento, deduplicación, límites. | E2E conversacional con agente simulado (resuelta, vacía, error, vencida, paciente que cambió de tema) y mutación. |
| B3 | **Modo sombra** una semana en una clínica: el bot consulta el HIS pero **no le dice nada nuevo al paciente**; solo registra cuántas veces el HIS tenía citas que AgenIA no. | Datos de §5. |
| B4 | Encender `botLookupEnabled` por clínica (a mano, como `lookupEnabled`). | Decisión con los datos de B3. |

## 5. Criterio de entrada

Con la Fase A ya en uso se mide, de la bitácora:

- cuántas consultas hay por semana y en qué `conexionHis` (si casi siempre es APAGADA o CAIDA, la Fase B no cambiaría nada todavía);
- en el modo sombra (B3), en qué proporción de consultas el HIS tenía al menos una cita que AgenIA no mostraba.

**Regla propuesta:** si en B3 menos del 2 % de las consultas tienen diferencias, no se enciende la Fase B. Se mantiene la advertencia y se revisa por qué faltan esas pocas citas en el alta en caliente: arreglar la llegada es mejor que consultar cada vez.

## 6. Puntos abiertos (decide el usuario)

| # | Pregunta | Recomendación |
|---|---|---|
| P1 | ¿Interruptor propio del bot (`botLookupEnabled`) o reutilizar `lookupEnabled`? | Propio: la carga es distinta y el hospital la aprueba por separado. |
| P2 | ¿Respuesta asíncrona (dos mensajes) o esperar al HIS en el mismo turno? | Asíncrona (§3.2). |
| P3 | Si el HIS no trae nada nuevo, ¿mensaje de confirmación o silencio? | Silencio: un segundo mensaje sin novedad es ruido; quitar la advertencia ya dice lo mismo. |
| P4 | ¿El paciente puede cancelar por el bot una cita que solo existe en el HIS? | No en la Fase B; requiere acuerdo con el hospital (mismo punto pendiente del alta en caliente). |
| P5 | ¿Umbral del criterio de entrada (§5)? | 2 % de consultas con diferencias. |

## 7. Riesgos

- **Carga sobre el HIS de producción**: cubierta por B0, los límites de §3.4, el interruptor propio y el modo sombra.
- **Datos de salud a quien no es el paciente**: el HIS solo se consulta tras `remitenteEsDelPaciente`, y solo se muestran filas del titular.
- **Mensajes a destiempo**: el seguimiento se descarta si el paciente cambió de tema; en WhatsApp, fuera de la ventana de 24 h no se envía (no hay plantilla para esto).

# Plan: Rastreo de paciente (consulta de citas y diagnóstico de discrepancias AgenIA ↔ HIS)

> **Estado:** Diseño con alcance y perfiles confirmados (2026-09-20). **Fases 0 y 1 implementadas, verificadas y commiteadas (2026-09-20, `1ed83cf`); el registro de quién cancela desde el panel, después** — ver «Estado de la Fase 0» (§8) y «Estado de la Fase 1» (§9). **Fase 2 (consulta en vivo al HIS) implementada y verificada, pendiente de commit; NO está encendida: falta medir su costo en el laboratorio del hospital** — ver «Estado de la Fase 2» (§9). Falta el vigilante y la bandeja (Fase 3).
> **Fecha:** 2026-09-20.
> **Alcance:** Pantalla para que el personal de una clínica busque a un paciente por cualquier dato (cédula, nombre, teléfono, BSUID), vea su historial con foco en las **citas**, y averigüe por qué una cita "no aparece" en uno de los dos sistemas: AgenIA (WhatsApp) o el HIS del hospital. Es del **motor genérico**: no contiene detalles de un HIS concreto (esos viven en `docs/drivers/<driverKey>/`).
> **Base del análisis:** lectura del código en el commit `b6a2101`. No se ejecutó nada contra producción: los hallazgos son de diseño, no mediciones.

---

## 0. Decisiones confirmadas

| # | Decisión | Fecha |
|---|---|---|
| 1 | Matriz de perfiles (§5): DOCTOR con alcance limitado; GENERAL_OBSERVER y PATIENT fuera; SUPER_ADMIN solo tras elegir una organización. | 2026-09-20 |
| 2 | BOOKING_AGENT ve el **texto de las conversaciones** del paciente que consulta, "porque es quien atiende en ventanilla". Hoy la Caja Negra es solo de ORG_ADMIN. | 2026-09-20 |
| 3 | Escenario 2 (cita del HIS que no sale en WhatsApp): **solo diagnóstico** por ahora. Corregir la causa (que el bot consulte el HIS) se decide aparte, **al terminar todo este plan** — ver §11. | 2026-09-20 |

**Consecuencia de la decisión 2 (propuesta de implementación, a validar):** el acceso se limita al texto de las conversaciones *del paciente consultado*, dentro del expediente y con motivo registrado (§6). No abre `/dashboard/auditoria` a BOOKING_AGENT.

---

## 1. Los dos escenarios

1. **WhatsApp → HIS.** Un paciente dice que agendó por WhatsApp. En el hospital ve la captura de pantalla y parece tener la cita, pero en el HIS no está. ¿Miente, o qué le pasó y en qué se le puede ayudar?
2. **HIS → WhatsApp (el inverso).** Le agendaron la cita por el HIS y no le aparece en WhatsApp (AgenIA).

Son investigaciones distintas y van como **dos opciones separadas** dentro de la misma pantalla (§4.1).

---

## 2. Hallazgos del código que condicionan el diseño

### 2.1 El escenario 2 no es hipotético: es el comportamiento actual

- El driver reporta las altas nacidas en el HIS con `patientDocument` pero **nunca** con `agenIAPatientId` (ejemplo, el driver de Anserma: [`index.ts:708`](../apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts#L708)).
- Con esa forma, `applyAppointmentCreate` solo marca el cupo como ocupado y devuelve `APPLIED`, **sin crear ningún `Appointment`** ([`mirror-apply.service.ts:283-296`](../apps/api/src/mirror/mirror-apply.service.ts#L283-L296)). El comentario del propio código lo deja como "Fase 2+" y la reconciliación lo reconoce ([`mirror-reconciliation.service.ts:106`](../apps/api/src/mirror/mirror-reconciliation.service.ts#L106)).
- El bot solo lista citas desde `Appointment`. Las únicas dos consultas `findMany` de citas del chatbot son la de cancelar ([`chatbot.service.ts:7889`](../apps/api/src/chatbot/chatbot.service.ts#L7889)) y la de reprogramar ([`:8061`](../apps/api/src/chatbot/chatbot.service.ts#L8061)), y ambas filtran `status: 'SCHEDULED'` y futuras. El cron de recordatorios también lee `Appointment` ([`appointment-reminder.cron.ts:203`](../apps/api/src/appointment-reminder/appointment-reminder.cron.ts#L203)).
- **Consecuencias:** una cita de ventanilla es invisible para WhatsApp, no genera recordatorio, y el paciente puede agendar otra encima (el bot no sabe que ya tiene una).
- **No queda rastro en la base:** ese evento se audita en `SyncAudit` con `entityId` y `detail` nulos. El documento del paciente solo aparece en una línea de log del contenedor. Con los datos de AgenIA no se puede responder "¿llegó el evento de este paciente?". **Corregido en la Fase 0 (§8 #5):** desde el despliegue esos eventos dejan `cupo=<médico>|<hora>` y la nota de que no se creó `Appointment`; los anteriores siguen sin rastro.
- **Restricción vigente:** los pacientes del HIS **no se precargan** (Habeas Data, plan del espejo §5.3). Cualquier solución tiene que consultar de a uno y no acumular.

### 2.2 En el escenario 1 el paciente recibe "confirmada" antes de que el HIS acepte

`bookAppointment` confirma al hacer commit en AgenIA ([`appointments.service.ts`](../apps/api/src/appointments/appointments.service.ts)); el HIS la recibe después: trigger → `SyncOutbox` → agente. Un evento que falla se reintenta con backoff hasta `MAX_DELIVERY_ATTEMPTS = 10` ([`mirror-dispatch.service.ts:17`](../apps/api/src/mirror/mirror-dispatch.service.ts#L17)) con techo de 5 min ([`:21`](../apps/api/src/mirror/mirror-dispatch.service.ts#L21)) —unos 18 minutos— y luego pasa a dead-letter. Ya hay dos defensas antes de confirmar (médico homologado y convenio EPS+régimen), pero no cubren un HIS caído, un cupo vendido en el HIS en el mismo instante ni una deriva posterior.

Estados en que puede estar una cita creada por WhatsApp respecto al HIS: pendiente · en reintento (n/10) · dead-letter · cerrada como no soportada (`SKIPPED`) · entregada · entregada pero ausente del HIS (deriva) · cancelada después desde el HIS.

### 2.3 No hay evidencia de entrega del mensaje

`InteractionLog` guarda el texto que el bot generó (truncado a 4000 caracteres) y un `BOOKING_CONFIRMED` con el `appointmentId`. Pero los estados `sent/delivered/read` que Meta manda al webhook solo se escriben a nivel debug y se descartan ([`chatbot.controller.ts:142`](../apps/api/src/chatbot/chatbot.controller.ts#L142)), y no se guarda el `wamid` de los mensajes salientes. **Corregido en la Fase 0 (§8 #7):** el libro `WhatsappMessageLog` guarda el `wamid` y los estados, pero solo de lo enviado desde el despliegue (no hay backfill).

Se puede afirmar "el bot generó esta confirmación a esta hora", no "Meta la entregó a este teléfono". Una captura de pantalla no se puede confirmar ni refutar contra Meta.

### 2.4 La API no alcanza el HIS

Plan del espejo §4.1: solo el agente ve al hospital. Toda respuesta a "¿está en el HIS?" tiene que viajar por el agente. Ya existe el patrón a reutilizar: `NoticeRosterRequest` ([`schema.prisma:402`](../packages/database/prisma/schema.prisma#L402)), `GET /mirror/notice-requests` y `POST /mirror/notice-roster` ([`mirror.controller.ts:187-198`](../apps/api/src/mirror/mirror.controller.ts#L187-L198)), y la capacidad opt-in del driver que el motor comprueba en ejecución (`isNoticeRosterCapable`).

---

## 3. Veredictos

El sistema no dice "miente". Da un **veredicto de una lista cerrada**, con la evidencia que lo sostiene, la **fuente** (datos de AgenIA o consulta en vivo al HIS) y la acción sugerida.

### 3.1 Escenario A — "agendé por WhatsApp y el HIS no la tiene"

| Veredicto | Cómo se detecta | Fuente | Qué hacer |
|---|---|---|---|
| `NUNCA_CONFIRMÓ` | Sin `Appointment` ni `BOOKING_CONFIRMED` en la ventana; la conversación termina en un fallo registrado (`SLOT_TAKEN`, `EPS_REGIME_NOT_BILLABLE`, `ABANDONED`, `MAX_RETRIES`…) | AgenIA | Agendar ahora. Lo que muestra la captura suele ser el menú de opciones |
| `EN_LISTA_DE_ESPERA` | `WaitlistEntry` en `WAITING` o `NOTIFIED` | AgenIA | Aclarar que "te avisamos si se libera" no es una cita |
| `CANCELADA` | `status = CANCELLED`; `metaLog.cancelledBy` dice quién (`MIRROR` = el hospital, `STAFF` = el personal desde el panel); si no, un `APPOINTMENT_CANCELLED` en la conversación = el paciente por WhatsApp | AgenIA | Decir quién y cuándo canceló (el paciente por WhatsApp, el hospital o el personal de la clínica). Las cancelaciones del panel anteriores al registro de constancia salen como "sin registro" |
| `CONFIRMADA_NO_LLEGÓ` | `Appointment` SCHEDULED con evento pendiente / en reintento / dead-letter / `missingMappings`; o espejo apagado, `pushEnabled` en false o agente sin latido | AgenIA | Mostrar la causa exacta y, solo ORG_ADMIN, reprocesar. Si el HIS rechazó porque el cupo ya estaba vendido: reubicar al paciente (el hospital gana) |
| `ENTREGADA_PERO_AUSENTE` | El outbox tiene `deliveredAt` y la consulta en vivo no encuentra la cita | HIS en vivo | Deriva: escalar |
| `OTRA_IDENTIDAD` | La consulta por cupo (médico y hora) encuentra la cita con otro documento; o hay otra conversación con otro teléfono o cédula | HIS en vivo / AgenIA | Corregir el documento. Caso plausible: un familiar reservó con la cédula de otra persona |
| `SIN_RASTRO` | Nada por cédula, teléfono ni nombre en la ventana | AgenIA (+ HIS) | Lenguaje neutro: "AgenIA no tiene registro". Pedir el número desde el que escribió y la fecha |

### 3.2 Escenario B — "la agendaron en el HIS y no sale en WhatsApp"

| Veredicto | Cómo se detecta | Fuente | Qué hacer |
|---|---|---|---|
| `CITA_DEL_HIS_NO_ESPEJADA` | La consulta en vivo la encuentra; AgenIA no tiene `Appointment` (siempre, hoy — §2.1) | HIS en vivo | Decirle que la cita es válida; ofrecer enviarle la confirmación por WhatsApp (endpoint `outbound`, [`chatbot.controller.ts:174`](../apps/api/src/chatbot/chatbot.controller.ts#L174)) |
| `MÉDICO_NO_ESPEJADO` | El médico de la cita no está homologado; el evento quedó `SKIPPED` | AgenIA | Explicar al personal: es por diseño, AgenIA solo espeja un subconjunto de la agenda |
| `SIN_CUPO` | Médico homologado pero falta el cupo; fila `ERROR` en `SyncAudit` | AgenIA | Laguna real: escalar (generar el cupo) |
| `IDENTIDAD_NO_COINCIDE` | El documento del HIS difiere del que el paciente da al bot (ceros a la izquierda, tipo de documento, otro familiar); o el paciente no tiene `PatientProfile` en esta clínica | AgenIA + HIS | Comparar variantes normalizadas; corregir en el sistema que corresponda |
| `NO_ESTÁ_EN_EL_HIS` | La consulta en vivo no la encuentra, ni por documento ni por cupo | HIS en vivo | Puede haberse cancelado o no haberse registrado: confirmar en ventanilla |

### 3.3 Cómo se evalúa

- **Por cita, con un resumen.** Un paciente puede tener varias; cada una lleva su veredicto.
- **Orden (A):** ¿hay cita? → (no) `NUNCA_CONFIRMÓ` / `EN_LISTA_DE_ESPERA`; (sí) `CANCELADA` → `CONFIRMADA_NO_LLEGÓ` con lo que dice AgenIA → con consulta en vivo, `ENTREGADA_PERO_AUSENTE` / `OTRA_IDENTIDAD` → `SIN_RASTRO` si nada aplica. Lo barato (base) va antes que lo caro (consulta al HIS).
- **Lenguaje:** neutro. Cada veredicto declara su fuente y lo que **no** sabe. `SIN_RASTRO` nunca se traduce en "no agendó": significa que AgenIA no tiene registro.
- **Implementación:** el clasificador es una **función pura en `@agenia/shared`**: entra un paquete de evidencia (citas, estado del outbox, conversación, lista de espera, estado del espejo, resultado del HIS si lo hay) y salen veredictos. Se prueba con tablas de casos, y el vigilante de la Fase 3 usa el mismo criterio para decir que una cita está "atascada" (una sola fuente de verdad).

---

## 4. La pantalla

### 4.1 Rutas y entradas

- **`/dashboard/rastreo`** para ORG_ADMIN, BOOKING_AGENT y DOCTOR. Se publica en `getMenusForRole` ([`menus.ts`](../apps/web/lib/menus.ts)).
- **`/super-admin/rastreo`** para SUPER_ADMIN: el middleware ya lo redirige fuera de `/dashboard` ([`middleware.ts`](../apps/web/middleware.ts)), así que necesita su propia ruta, con selector de organización obligatorio.
- **Dos opciones separadas:** "Dice que agendó" (escenario A) y "Lo agendaron en el HIS" (escenario B).
- **Sin espejo**, solo A y solo con el lado AgenIA (conversación, citas, lista de espera): la opción B y los pasos de sincronización no aparecen. Mismo criterio que `conEspejo` en el menú: una opción muerta enseña a ignorar el menú.

### 4.2 Búsqueda

- Un solo campo; detecta cédula, teléfono, BSUID o nombre.
- **Cédula:** `normalizeDocumento` y, si no hay resultado, segundo intento con `documentoSinCerosIniciales` ([`documento.ts`](../packages/shared/src/documento.ts)).
- **Teléfono / BSUID:** contra `PatientProfile.whatsappId` y `bsuid`, y contra `InteractionLog.whatsappId` (quien nunca terminó de identificarse solo existe ahí).
- **Nombre:** al menos 2 palabras, sin tildes ni mayúsculas (§8, #3).
- Devuelve **candidatos enmascarados**; el personal elige uno. Máximo 10.
- **Datos de la captura (opcionales):** fecha, hora y médico/servicio que muestra la captura. Se comparan contra lo registrado y alimentan la consulta por cupo (§7.3). Es la forma de meter la captura en el análisis sin adjuntar la imagen.

### 4.3 Expediente

1. **Veredicto** arriba: causa, evidencia, fuente, acción.
2. **Línea de vida de cada cita** (stepper): `Conversación → Confirmación enviada → Confirmación entregada → Cita creada → Evento en cola → Entregado al agente → Presente en el HIS`. Cada paso ✓ / ✗ / ⏳ con su hora. Los pasos de mensaje y de HIS aparecen a medida que llegan las fases (§9).
3. **Identidad y canales:** cédula, EPS, régimen, `whatsappId` / `bsuid` — enmascarados.
4. **Conversación:** cronología de `InteractionLog` (texto del paciente y del bot). Solo ORG_ADMIN y BOOKING_AGENT.
5. **Historial:** citas por estado, asistió / no asistió (`attendanceStatus`), lista de espera, recordatorios, avisos masivos, CSAT.

### 4.4 Lo que no muestra

Nada clínico. `ClinicalRecord`, signos vitales, diagnósticos y prescripciones **no** se leen en esta pantalla: se enlaza al expediente existente, que sigue tras `TenantRbacGuard` (ORG_ADMIN, o DOCTOR con relación terapéutica).

### 4.5 Fechas

Todas con los helpers de `@/lib/date` (`America/Bogota`), como exige el `CLAUDE.md`. Un stepper lleno de horas es justo donde reaparece el desfase de 5 h del contenedor UTC.

---

## 5. Perfiles y alcance

Detalle de la matriz confirmada en la decisión 1. Las celdas marcadas † son elaboración de este plan, no decisión expresa: validar.

| Rol | Buscar | Citas + veredicto | Texto de conversación | Estado de sync (solo lectura) | Payloads y reprocesar | HIS en vivo |
|---|---|---|---|---|---|---|
| **ORG_ADMIN** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **BOOKING_AGENT** | ✓ (dentro de su scope) | ✓ | ✓ (decisión 2) | ✓ | ✗ † | ✓ |
| **DOCTOR** | Solo pacientes con cita suya | Solo sus citas | ✗ | ✗ | ✗ | ✗ |
| **SUPER_ADMIN** | Tras elegir organización | ✓ | Por definir (§12) † | ✓ | ✗ † | ✓ † (registrado) |
| **GENERAL_OBSERVER** | ✗ — su panel es de BI | — | — | — | — | — |
| **PATIENT** | ✗ — ya tiene "Mis citas" | — | — | — | — | — |

Notas de implementación:

- **BOOKING_AGENT:** el scope `AgentProfile.epsId` / `doctorId` se aplica igual que en [`agendamiento/page.tsx`](../apps/web/app/dashboard/agendamiento/page.tsx). Ver el punto abierto sobre citas fuera de su alcance (§12).
- **DOCTOR:** misma regla que `TenantRbacGuard` (paso 6): "relación terapéutica" = una cita suya con ese paciente, en la organización del actor.
- **Reprocesar:** hoy solo ORG_ADMIN (`tenantAdmin`, [`espejo.ts:24`](../apps/web/app/actions/espejo.ts#L24)); se reutiliza `reprocesarEvento`, no se duplica.
- **Helper de sesión:** uno equivalente a `tenantAdmin()` que admita los roles de esta tabla y devuelva el `organizationId` **del token**, nunca del cliente.
- **SUPER_ADMIN cruzando organizaciones no existe.** Una búsqueda global contradice el aislamiento por tenant ya decidido para la identidad de WhatsApp (comentario de `PatientProfile` en [`schema.prisma:617`](../packages/database/prisma/schema.prisma#L617): se acepta duplicar filas para no crear una llave de join entre clínicas).

---

## 6. Controles de privacidad

Esta pantalla es un buscador de datos personales de salud. Sin controles es la puerta ideal para curiosear.

1. **Motivo obligatorio**, de una lista cerrada (`PACIENTE_EN_VENTANILLA`, `RECLAMO_PQRS`, `SOPORTE_TECNICO`, `OTRO` + nota). Queda en `PatientLookupLog`.
2. **ORG_ADMIN puede revisar** las consultas de su clínica (quién, cuándo, motivo). Sin esta vista el log no lo lee nadie.
3. **Enmascarado por defecto** (cédula `•••4567`, teléfono `•••1234`); revelar un dato queda registrado.
4. **Coincidencia exacta** para cédula, teléfono y BSUID; nombre con al menos 2 palabras; máximo 10 candidatos; no existe el listado "todos los pacientes".
5. **Límite de tasa por usuario** (p. ej. 30 búsquedas por 10 min, configurable).
6. **Tenant siempre del JWT.** Un paciente de otra clínica responde igual que uno inexistente (mismo criterio que `TenantRbacGuard`: no ser oráculo de existencia).
7. **Resultados del HIS en vivo con TTL y sin persistir** (§7). Solo persiste la auditoría.
8. **Documentos de terceros enmascarados** (p. ej. el otro documento que aparece en `OTRA_IDENTIDAD`).

**`PatientLookupLog`** (append-only, por tenant, mismo espíritu que `GlobalAuditLog`):

```
id, organizationId, actorUserId, actorRole
mode              'A' | 'B'
queryKind         'CEDULA' | 'PHONE' | 'BSUID' | 'NAME'
queryMasked       texto enmascarado — nunca el dato completo
reason            código de la lista cerrada + nota opcional
candidateIds      Json   (PatientProfile.id devueltos; sin FK, sobrevive al borrado del paciente)
openedPatientId   String?
verdicts          Json?  (veredictos emitidos — sirve para medir, §11)
liveHisRequested  Boolean
createdAt
@@index([organizationId, createdAt])
@@index([organizationId, actorUserId, createdAt])
```

---

## 7. Consulta en vivo al HIS

### 7.1 Por qué en vivo y no una copia

La reconciliación diaria ya recibe una foto del HIS con el documento de cada paciente, pero no se persiste (solo se devuelven conteos), y persistirla sería precargar pacientes del HIS — lo que el plan del espejo §5.3 descartó. Una consulta en vivo por paciente y con TTL respeta ese principio y no envejece.

### 7.2 Diseño (replica el patrón de `NoticeRosterRequest`)

- **`HisLookupRequest`:** `organizationId`, `requestedByUserId`, `kind` (`BY_DOCUMENT` | `BY_SLOT`), `params` (Json), `status` (`PENDIENTE` | `RESUELTA` | `ERROR` | `EXPIRADA`), `result` (Json, nullable), `error`, `createdAt`, `resolvedAt`, `purgeAt`.
- **Endpoints del agente**, junto a los de avisos: `GET /mirror/lookup-requests` y `POST /mirror/lookup-result`.
- **Web:** un server action crea la petición y la pantalla la sondea, como hace la de avisos.
- **Capacidad opt-in del driver** (`PatientLookupCapable`), fuera del contrato `HisDriver` a propósito: un segundo hospital no debe tener que implementar algo que quizá no use. Devuelve citas vigentes o pasadas en una ventana, con el mismo formato canónico que la instantánea de reconciliación (médico, hora en UTC, documento).
- **Falla rápido:** si el último latido está viejo o `lastHisReachable === false`, no se encola; la pantalla lo dice ("el agente no está disponible") en vez de dejar al usuario esperando. Timeout de pantalla ~30 s.
- **Interruptor por organización:** `HospitalMirrorConfig.lookupEnabled` (por defecto `false`), igual que `pushEnabled` / `pullEnabled`.
- **Purga:** un cron borra `result` pasado `purgeAt` (p. ej. 15 min después de resolverse). Quedan el metadato y `PatientLookupLog`.

### 7.3 Por documento y por cupo

- **Por documento:** "¿qué citas tiene este documento en el HIS?"
- **Por cupo** (médico + hora): "¿quién tiene ese cupo en el HIS?" AgenIA conoce el médico y la hora de la cita alegada (o el personal los toma de la captura, §4.2). Es lo que encuentra los errores de digitación y las citas a nombre de otro (`OTRA_IDENTIDAD`).

### 7.4 Carga sobre el HIS del hospital

- Solo lectura, parametrizada, con timeout, tope de filas y tope de ventana de fechas.
- Debe apoyarse en la columna que el HIS ya tenga indexada (en Anserma, la fecha: el driver ya lo documenta en sus consultas). Una búsqueda solo por documento podría ser un scan sobre la base productiva del hospital.
- Se mide el costo en el laboratorio del hospital **antes** de encender el interruptor en producción (misma disciplina de la Fase 0 del plan del espejo).
- El SQL concreto vive en `docs/drivers/<driverKey>/`, no aquí. El driver de Anserma ya lee sus tablas de citas y de pacientes con el login de sincronización, así que no se esperan permisos nuevos — **a confirmar con el hospital**.

---

## 8. Prerrequisitos técnicos (Fase 0)

| # | Cambio | Por qué | Dónde |
|---|---|---|---|
| 1 | Índice `InteractionLog(organizationId, whatsappId, createdAt)` | El modelo no declara ningún `@@index` y ninguna migración crea uno: rastrear por `whatsappId` es un scan completo de la tabla de conversaciones | [`schema.prisma:888`](../packages/database/prisma/schema.prisma#L888) |
| 2 | Índice `Appointment(organizationId, patientId)` | Solo `organizationId` y `scheduleSlotId` están indexados; el historial por paciente (y las consultas del propio bot) recorren la tabla | [`schema.prisma:806`](../packages/database/prisma/schema.prisma#L806) |
| 3 | `pg_trgm` + `unaccent` + índice GIN sobre el nombre normalizado | No hay ninguna extensión hoy; sin ellas la búsqueda por nombre es un `ILIKE` sin índice y sensible a tildes. Vive en `prisma/sql/non-prisma-ddl.sql`, como el resto del DDL que Prisma no expresa. Verificar que la imagen de Postgres las trae | `packages/database/prisma/sql/` |
| 4 | `SyncOutbox.lastError` + campo **aditivo** `failures?: { seq, error }[]` en `AckInput` | Hoy `failedSeqs` viaja sin mensaje y el runbook manda a buscar el motivo por SSH en el journal de la VM. Al ser aditivo, una API nueva con un agente viejo sigue funcionando (sin despliegue en bloque) | [`mirror-protocol.ts:141`](../packages/shared/src/mirror-protocol.ts#L141) |
| 5 | Alta y baja entrantes del HIS: escribir `entityId` = id del cupo y `médico\|hora` en `SyncAudit.detail` (no es PHI) | Hoy ese evento queda con ambos nulos (§2.1). El cupo ya se resuelve dentro de `resolverCupo`; hay que propagarlo a `audit()`. También para `SKIPPED` por `MEDICO_NO_ESPEJADO`. Ya se escribe una fila por evento: solo cambia su contenido | [`mirror-apply.service.ts`](../apps/api/src/mirror/mirror-apply.service.ts) |
| 6 | Documentar el vocabulario real de `SyncAudit.direction` | El código escribe cinco valores — `AGENIA_TO_HIS`, `INBOUND`, `HIS_TO_AGENIA` (importación de la agenda), `RECONCILE` y `CONFIG`—; el comentario del schema decía `OUTBOUND`, que nadie escribe. Corregir el comentario y centralizar las constantes; **sin migrar filas históricas** | [`schema.prisma:1819`](../packages/database/prisma/schema.prisma#L1819) |
| 7 | `WhatsappMessageLog`: `wamid` (único), organización, destinatario, tipo (confirmación de cita, recordatorio, oferta de lista de espera, aviso masivo, manual, respuesta del bot), `appointmentId?`, estado y hora del estado. El webhook actualiza el estado en vez de descartarlo | Habilita los pasos "confirmación enviada / entregada" del stepper y la respuesta a "¿le llegó?". **Verificar que el envío devuelve el `wamid`** (§12) | [`chatbot.controller.ts:142`](../apps/api/src/chatbot/chatbot.controller.ts#L142) |
| 8 | `PatientLookupLog` (§6) | Necesario antes de exponer el buscador | Nuevo |

### Estado de la Fase 0 (2026-09-20)

Implementada, con tests y verificada contra un Postgres 15 desechable (BD en el estado anterior, migraciones previas selladas como aplicadas, y `db:deploy` corrido dos veces: el mismo camino que usa el contenedor `migrator`). Commiteada con la Fase 1 (`1ed83cf`).

| # | Hecho | Dónde |
|---|---|---|
| 1 | Índice `InteractionLog(organizationId, whatsappId, createdAt)`. Medido con 300.000 filas sintéticas: **0,048 ms con el índice contra 15,1 ms sin él** (escaneo paralelo de toda la tabla). Ocupa 14 MB con esa carga | migración `20260920120000_rastreo_paciente_fase0` + `schema.prisma` |
| 2 | Índice `Appointment(organizationId, patientId)`. Con la tabla vacía solo se pudo comprobar que el planificador lo **puede** usar para ese predicado; no hay una medición de tiempos | ídem |
| 3 | `fn_norm_texto()` (minúsculas + sin tildes) e `idx_patient_fullname_trgm` (GIN). "maria lopez" encuentra "María López"; "ANGELA nunez", "Ángela Núñez". Plan natural con 30.000 pacientes: `Bitmap Index Scan`. **La consulta de la Fase 1 debe usar la misma expresión**: `fn_norm_texto("fullName") LIKE '%' \|\| fn_norm_texto($1) \|\| '%'` | `non-prisma-ddl.sql`; `apply-non-prisma-ddl.ts` ahora también verifica que existan |
| 4 | `SyncOutbox.lastError` (truncado a 1000) y `AckInput.failures` **aditivo**. El agente manda `failedSeqs` y `failures`; la API los une y cuenta cada `seq` **una vez**. Un agente antiguo sigue funcionando (cuenta el intento sin motivo y conserva el anterior). Se limpia al entregarse. El panel del espejo lo muestra bajo cada dead-letter | `mirror-dispatch.service.ts`, `engine.ts`, `EspejoClient.tsx` |
| 5 | Altas y bajas entrantes del HIS dejan `cupo=<médico>\|<hora ISO UTC>; <nota>` en `SyncAudit.detail` y el id del cupo (o de la cita) en `entityId`. La nota dice, entre otras, **"solo se ocupó el cupo, no se creó Appointment"**. No se escribe el documento del paciente | `mirror-apply.service.ts` (`claveCupo`) |
| 6 | `SYNC_AUDIT_DIRECTION` en `@agenia/shared` (cinco valores), usado por la API y el web; comentario del schema corregido; un test fija los valores históricos. Sin migrar filas | `packages/shared/src/sync-audit.ts` |
| 7 | Modelo `WhatsappMessageLog` + `WhatsappMessageLogService` (`recordOutbound`, `applyStatus`), enganchado a **todos** los envíos: texto, audio, plantillas y el aviso de inactividad. El webhook de estados deja de descartarlos. Ligado a la cita en confirmaciones y recordatorios. **No guarda el texto del mensaje** | `whatsapp-message-log.service.ts`, `chatbot.service.ts`, `whatsapp-template.service.ts`, `chatbot.cron.ts`, `chatbot.controller.ts` |
| 8 | Tabla `PatientLookupLog` creada. Todavía nada escribe en ella (la pantalla es de la Fase 1) | `schema.prisma` |

**Verificación.** API 53 suites / 1.747 tests, agente 17 / 469, web 22 / 194, shared 12 / 239, todos en verde; `tsc` limpio en producción (API), agente, web y shared. Las pruebas nuevas se comprobaron **rompiendo a propósito** el código de producción y viendo que fallan. Contra Postgres real: migración limpia, diff entre BD y `schema.prisma` vacío, DDL idempotente, y 16 comprobaciones de integración (estados fuera de orden, `wamid` duplicado, `lastError`, aislamiento entre clínicas, borrado en cascada de una organización, que **no rompe la purga**).

**Decisiones que conviene conocer**
- Los estados solo avanzan (`ACCEPTED < SENT < DELIVERED < READ`; `FAILED` solo antes de la entrega). Se aplica con un único `updateMany` condicionado al estado de origen, sin lectura previa: dos webhooks concurrentes no se pisan.
- El webhook **solo actualiza**: un estado de un `wamid` que no está en el libro se ignora, así que un estado falso no puede inventar un mensaje.
- El libro se escribe **antes** de cualquier otro `await` tras la respuesta de Meta, porque el webhook de estados puede llegar enseguida.
- `smartReply` y `sendOutboundForOrg` ahora llaman siempre al sender con un tercer argumento (el contexto, `undefined` si no hay). Un test que fijaba la llamada exacta de la alerta de emergencias se ajustó.

**Valor probatorio del libro.** Los estados llegan por el webhook, cuya firma `X-Hub-Signature-256` es **obligatoria por defecto**. Solo con `META_REQUIRE_SIGNATURE=false` (pensado para migraciones) un estado podría estar falsificado; con ese flag encendido, el libro no es evidencia.

**Límites conocidos**
- No hay backfill: los mensajes anteriores a este cambio no están en el libro, y sus estados no se pueden reconstruir. `SIN_RASTRO` y "¿le llegó?" solo valen para lo enviado desde el despliegue.
- Si un estado llega antes de que se escriba la fila (carrera de milisegundos), se pierde; el siguiente estado lo cubre por la monotonía.
- En modo voz una confirmación puede ser un audio y un texto: dos filas para la misma cita.
- El aviso de expiración de la lista de espera y otras respuestas automáticas por `sendOutboundMessage` quedan como `BOT_REPLY`, no como `MANUAL`: `MANUAL` solo lo pone el endpoint del dashboard.
- `InteractionLog` sigue sin índice `(organizationId, createdAt)`; la pantalla de Caja Negra lo agradecería, pero no era parte de este plan.

**Notas de despliegue**
- Aplicar la migración **antes** de levantar la API nueva: la API lee `SyncOutbox.lastError` en cada consulta a esa tabla y sin la columna se rompe el despacho del espejo. `agenia update` ya migra antes de `up -d`; **`agenia build` y `update-vps.sh --skip-migrate` no migran** — con este cambio no usarlos sin correr `agenia migrate` antes.
- El orden entre API y agente es indiferente para la corrección (la API no valida campos de más, y el agente antiguo no manda `failures`); el motivo del fallo solo se guarda cuando ya corre la API nueva.
- Los dos `CREATE INDEX` bloquean las escrituras de su tabla mientras se construyen (Prisma no permite `CONCURRENTLY` dentro de su transacción). En `InteractionLog` son auditorías fire-and-forget: esperan, no fallan.
- `CREATE EXTENSION pg_trgm/unaccent` las puede crear el dueño de la base (son "trusted" desde PG 13); la imagen oficial las trae.

---

## 9. Fases

**Fase 0 — Prerrequisitos (§8).** ✅ **Hecha el 2026-09-20** (ver «Estado de la Fase 0» en §8).
*Aceptación:* `EXPLAIN` de las dos consultas calientes (conversación por `whatsappId`, citas por paciente) usa los índices nuevos; un agente antiguo sin `failures` sigue funcionando contra la API nueva; un alta entrante sin paciente homologado deja `médico|hora` en `SyncAudit`; los estados de Meta actualizan `WhatsappMessageLog`.

**Fase 1 — Pantalla con datos de AgenIA.** ✅ **Hecha el 2026-09-20** (ver «Estado de la Fase 1» abajo).
- **A** completo salvo `ENTREGADA_PERO_AUSENTE` y `OTRA_IDENTIDAD` (necesitan el HIS en vivo).
- **B parcial y rotulado como tal** ("sin consulta al HIS"): identidad del paciente, variantes del documento, y búsqueda por `médico|hora` en `SyncAudit` para `MÉDICO_NO_ESPEJADO` y `SIN_CUPO`. Sin el HIS en vivo, B no puede afirmar que la cita existe.
- Perfiles (§5), controles (§6) y vista de consultas para ORG_ADMIN.
- Clasificador puro en `@agenia/shared` con tests de tabla.
*Aceptación:* un caso sintético por veredicto; tests de aislamiento de tenant y por rol (patrón de `sync-audit.spec.ts`); DOCTOR sin relación terapéutica es rechazado; BOOKING_AGENT respeta su scope; funciona en una clínica sin espejo mostrando solo el lado AgenIA.

**Fase 2 — Consulta en vivo al HIS (§7).** ✅ **Implementada el 2026-09-20; ⏳ falta la medición en el laboratorio del hospital** (ver «Estado de la Fase 2»).
*Aceptación:* probada primero en el laboratorio del hospital con el costo de la consulta medido; interruptor apagado por defecto; prueba con el agente caído (falla rápido); B completo; `ENTREGADA_PERO_AUSENTE` y `OTRA_IDENTIDAD` operativos.

**Fase 3 — Vigilante y bandeja** (§10, #2 y #3).
*Aceptación:* una cita de prueba retenida más allá del umbral genera alerta al agendador antes de la hora de la cita; la bandeja la ve BOOKING_AGENT.

> **Al cerrar la Fase 3 se retoma §11.**

### Estado de la Fase 1 (2026-09-20)

Implementada, con tests y verificada de extremo a extremo. Commiteada en `1ed83cf`. No lleva migración nueva: usa las tablas e índices de la Fase 0.

| Pieza | Dónde |
|---|---|
| Clasificador de veredictos A y B y línea de vida (funciones puras) | `packages/shared/src/patient-trace.ts` |
| Clasificación de la búsqueda, enmascarado, motivos de consulta | `packages/shared/src/patient-search.ts` |
| Permisos por rol y resolución del actor (el tenant sale del token) | `apps/web/lib/rastreo/acceso.ts` |
| Servicio: búsqueda, expediente A, escenario B, revelar, bitácora | `apps/web/lib/rastreo/servicio.ts` (+ `evidencia.ts`, `zona-horaria.ts`, `tipos.ts`) |
| Server actions (solo cablean sesión → servicio) | `apps/web/app/actions/rastreo.ts` |
| Pantallas | `/dashboard/rastreo`, `/dashboard/rastreo/consultas`, `/super-admin/rastreo`, `/super-admin/rastreo/consultas` |
| Menú | `lib/menus.ts` (ORG_ADMIN, BOOKING_AGENT, DOCTOR) y la barra de SUPER_ADMIN |

**Verificación.**
- shared 360 tests, web 423 (eran 194), API 1.747, agente 469: todos en verde; `tsc` limpio en los cuatro; lint limpio; `next build` compila y registra las cuatro rutas.
- Los tests nuevos se comprobaron **rompiendo a propósito** el código (quitar "lo que no se puede afirmar", quitar la validación del motivo, dejar de pasar la organización elegida) y viendo que fallan. Esa comprobación destapó un test que decía cubrir algo que su fixture no ejercitaba; se corrigió.
- Contra un **Postgres 15 real** se ejecutó el servicio real sobre dos clínicas que comparten cédula y teléfono a propósito: 85 comprobaciones (búsqueda por cédula, por teléfono con y sin 57, por nombre sin tildes y en cualquier orden, el respaldo SQL de ceros a la izquierda, remitentes sin perfil, aislamiento entre clínicas, alcance de DOCTOR y BOOKING_AGENT, SUPER_ADMIN por organización, escenario B, revelar, bitácora y límite de tasa).
- Contra un **servidor Next real** (`next start`) con cookies JWT firmadas por rol, middleware, server actions por HTTP y esa misma base: páginas, redirecciones, y que un ORG_ADMIN que manda `organizationId` de otra clínica en la petición es **ignorado**.
- No se probó en un navegador (no hay herramienta para ello aquí): la interfaz se verificó con Testing Library, el HTML renderizado por el servidor y las acciones por HTTP.

**Decisiones y desviaciones respecto al plan** (todas nacieron de implementarlo):

1. **Veredictos.** Se añadieron seis códigos que el plan no listaba porque hacían falta para no mentir: `EN_CAMINO_AL_HIS` (recién creada, normal), `ENTREGADA_SIN_VERIFICAR` (lo que sabe AgenIA sin consulta en vivo), `CITA_VIGENTE`, `FUERA_DE_ALCANCE`, `SIN_EVENTO_DEL_HIS` y `EVENTO_DEL_HIS_NO_APLICADO` (error o conflicto de cupo). Los códigos van en ASCII (`NUNCA_CONFIRMO`, no `NUNCA_CONFIRMÓ`). La fuente de verdad es `TEXTO_VEREDICTO` en `@agenia/shared`. `ENTREGADA_PERO_AUSENTE`, `OTRA_IDENTIDAD` y `NO_ESTA_EN_EL_HIS` esperan a la Fase 2.
2. **El escenario B no parte de un perfil.** Quien se agendó en ventanilla y nunca escribió al bot **no existe** en AgenIA: exigir un candidato lo dejaba sin poder investigarse. B se consulta con cédula + médico + fecha + hora del HIS; el perfil, si existe, es un dato más. Solo con espejo.
3. **BOOKING_AGENT busca en toda la clínica.** El alcance (su EPS y su médico) acota las **citas** que ve, no a quién encuentra: si la búsqueda le devolviera "nadie", podría concluir que el paciente no existe. Las citas ocultas se cuentan y se le dice.
4. **Una cita ya atendida no se analiza como "pendiente de envío"**: si el paciente asistió, el hospital la tenía. Se muestra el desenlace (asistió / no asistió), que es justo lo que se discute en un reclamo. Lo destapó un test.
5. **Ventana de relevancia:** solo las citas de los últimos 30 días en adelante (programadas o canceladas) generan veredicto; lo más viejo es historial.
6. **Bitácora en dos tiempos:** la búsqueda (`CEDULA`, `PHONE`, `BSUID`, `NAME`) y la apertura del expediente (`OPEN`), más `REVEAL` al mostrar datos completos. **Falla cerrado**: si no se puede anotar la consulta, no se devuelve nada. Nunca guarda un dato completo. Límite de tasa por usuario: 30 búsquedas en 10 min, ajustable con `RASTREO_MAX_BUSQUEDAS` y `RASTREO_VENTANA_MIN`.
7. **Cambiar de organización (SUPER_ADMIN) remonta la pantalla** (`key`) en vez de sincronizar estado con efectos: no hay forma de mezclar datos de dos clínicas en pantalla.

**Hallazgos.**
- ✅ **Las cancelaciones hechas desde el panel del personal no dejaban ningún rastro** (`cancelAppointmentAndFreeSlot` no escribía `metaLog` ni un log, y `Appointment` no tiene `updatedAt`): no se podía saber quién ni cuándo. **Resuelto** — ver «Registro de quién cancela desde el panel» más abajo.
- El trigger del outbox solo registra eventos con el espejo **encendido** (`enabled = true`): una cita creada antes de activarlo o con él apagado no tiene evento. Es lo que significa `NO_EVENT`, y el texto lo dice.
- Un `redirect()` dentro de un componente de servidor responde `200` con la orden de redirigir en el cuerpo (streaming de Next), no un `3xx`. Importa para quien pruebe estas pantallas por HTTP.
- El extremo a extremo encontró código muerto mío (`listarConsultasAction`, que nadie usaba): se eliminó.

**Límites conocidos.**
- Sin consulta en vivo (Fase 2), B no puede afirmar que la cita exista en el HIS ni a nombre de quién está: solo sabe qué aviso recibió AgenIA. Está rotulado "Parcial" en pantalla y en cada veredicto.
- Los eventos del HIS anteriores a la Fase 0 no dejaron `cupo=…` en `SyncAudit`: para esos cupos B dirá `SIN_EVENTO_DEL_HIS` aunque el evento haya llegado. Vale para lo recibido desde el despliegue.
- El médico del escenario B se elige de los homologados y del catálogo que reportó el agente; no se puede teclear un código del HIS que no esté ahí.
- El escenario B y el respaldo de "ceros a la izquierda" leen los perfiles de la clínica con `regexp_replace` (no hay índice para eso): sin problema con miles de pacientes; si una clínica llegara a cientos de miles, hay que revisarlo.
- La búsqueda por nombre exige `fn_norm_texto` (DDL de la Fase 0). Sin `db:apply-sql`, falla con error de base de datos: `agenia update` y `agenia migrate` ya lo corren.
- La retención de `PatientLookupLog` sigue sin definirse (punto abierto §12 #4).

### Registro de quién cancela desde el panel (2026-09-20, después del commit `1ed83cf`)

**Qué cambia.** `cancelAppointmentAndFreeSlot` ([`dashboard.ts`](../apps/web/app/actions/dashboard.ts)) ahora deja en `Appointment.metaLog`, junto al cambio de estado, `{ cancelledBy: 'STAFF', cancelledByUserId, cancelledByRole, cancelledAt }`. Sigue la convención que el hospital ya usaba (`cancelledBy: 'MIRROR'`). Se guarda el **id** de quien canceló, no su correo: el correo se resuelve al mostrarlo. No hay migración (`metaLog` ya existía).

**Cómo se comparte.** El escritor (la acción) y el lector (el rastreo) usan las mismas claves desde `@agenia/shared` (`appointment-cancel.ts`: `armarMetaLogCancelacionPersonal`, `leerCancelacionPersonal`, `CANCELADA_POR`), con un test de ida y vuelta. Es la misma razón por la que existe `SYNC_AUDIT_DIRECTION`: una errata en una de las dos puntas dejaría cancelaciones "sin rastro" sin que ningún test unitario lo viera.

**Qué ve cada rol.** El veredicto `CANCELADA` dice "La canceló el personal de la clínica (…) el <fecha>". El paréntesis depende del permiso nuevo `verPersonal` (`acceso.ts`):

| Rol | Ve |
|---|---|
| ORG_ADMIN, SUPER_ADMIN | El rol y el correo: "agente de reservas · agente@clinica.co" (o "usuario eliminado" si la cuenta ya no existe) |
| BOOKING_AGENT, DOCTOR | Solo el rol: "agente de reservas". Ni siquiera se consulta al usuario, así que el correo no viaja al navegador |

`verPersonal` coincide con `verConsultas` a propósito: es el mismo criterio que ya rige en la bitácora, donde el correo de quien consultó lo ve solo el administrador. **Es una decisión mía, no confirmada**: si BOOKING_AGENT debe ver a quién de sus compañeros canceló, es cambiar una celda de la matriz.

**Decisiones.**
1. **No se pisa una constancia existente, y solo libera el cupo quien realmente cancela.** El cambio va condicionado a que la cita no esté ya cancelada (`updateMany` con `status: { not: 'CANCELLED' }` dentro de una transacción interactiva); el cupo se libera solo si ese cambio tocó una fila. Una cita ya cancelada (doble clic, página vieja, cancelada antes por el paciente o por el hospital) no se vuelve a escribir. Ver «Corrección: re-cancelar» más abajo.
2. **Se conserva lo que la cita ya tuviera en `metaLog`** y se agregan las claves encima.
3. **El hospital gana** si por algún motivo traía ambas marcas, y la constancia del personal gana sobre el log de WhatsApp (`metaLog` es la fuente más fuerte).
4. **El texto de "desconocido" se precisó**: ahora dice que solo aplica a las cancelaciones **anteriores** a que se registrara quién las hacía. Esas no se pueden reconstruir: no hay backfill posible.

**Verificación.** Además de los tests unitarios (rompiendo el código a propósito en cinco puntos), se ejecutó la acción **real por HTTP contra un Next y un Postgres 15 reales**: cancela y libera el cupo como antes; deja el `metaLog` con el id, el rol y una hora dentro de la ventana de la llamada; el trigger del outbox genera **exactamente un** evento `UPDATE` con `status=CANCELLED`, origen `LOCAL`, la constancia y la fila anterior (`__old`) intactas, así que la cancelación **sigue viajando al HIS**; un segundo cancelar no pisa la constancia; y el rastreo muestra a cada rol lo que le toca.

**Hallazgos.**
- Un **SUPER_ADMIN no puede llegar a esta acción por la interfaz**: el middleware lo desvía fuera de `/dashboard`. El código admite su rol y hay un test, pero en la práctica solo cancelan ORG_ADMIN, BOOKING_AGENT y DOCTOR. La resolución del correo de un SUPER_ADMIN (que no tiene clínica) se comprobó sembrando la constancia directamente en la base.
- **La acción no aplica el alcance del agente.** Un BOOKING_AGENT con EPS o médico asignados puede cancelar cualquier cita de la clínica por esta vía, aunque el rastreo y el agendamiento sí lo acoten. Es comportamiento anterior; **no se tocó**.
- ✅ **Volver a cancelar una cita ya cancelada liberaba el cupo de nuevo**, incluso si otra cita ya lo ocupó. **Corregido** justo después: ver «Corrección: re-cancelar» más abajo.

#### Corrección: re-cancelar una cita ya cancelada (2026-09-20)

**Qué pasaba.** `cancelAppointmentAndFreeSlot` no comprobaba el estado de la cita: al volver a cancelar una ya cancelada (doble clic, o una página vieja que aún ofrecía "Cancelar") ponía `isAvailable = true` en el cupo. El índice único parcial `uq_appointment_cupo_vigente` solo cuenta citas **no** canceladas, así que otra cita **sí puede** tomar el cupo tras la primera cancelación; liberarlo por encima dejaba a AgenIA ofreciendo una hora ocupada (y el paciente veía "ese espacio acaba de reservarse" al confirmar).

**Se reprodujo antes de corregir**, contra Next y Postgres reales, con una segunda cita de otra paciente ocupando el cupo liberado: la re-cancelación **volvía a liberar el cupo** y, además, **metía un evento `UPDATE` redundante en la cola hacia el HIS** — algo que el hallazgo original no decía: el trigger `UPDATE OF status …` se dispara porque `status` figura en el `SET` aunque no cambie, y el driver habría intentado cancelar en el hospital una cita ya cancelada.

**La corrección.** El cambio pasó a un `updateMany` condicionado a que la cita no esté ya cancelada, dentro de una transacción interactiva; el cupo se libera solo si ese cambio tocó una fila. Como todo va en un único `updateMany` filtrado, también quedan resueltos, sin código adicional: no se pisa la constancia original, no hay evento redundante hacia el HIS, y dos cancelaciones simultáneas (doble clic real) liberan el cupo una sola vez, porque Postgres reevalúa el filtro sobre la fila ya cambiada y la segunda petición encuentra cero filas. La acción **sigue respondiendo `success`** (es idempotente: el estado buscado ya se cumple) y refresca la página para que muestre CANCELADA.

**Comprobado contra Postgres real.** Antes de corregir, el escenario fallaba en 3 puntos; después, pasan las 31 comprobaciones del escenario completo. Además, **cinco carreras reales** —cuatro cancelaciones simultáneas por HTTP sobre cada una de cinco citas nuevas— dieron siempre: las cuatro respuestas `success`, la cita cancelada, el cupo libre y **exactamente un** evento `UPDATE` de la cita y uno del cupo (la constancia quedó a veces del admin y a veces del agente, prueba de que la carrera es real y de que solo una petición cambió algo). La cancelación de una sola petición sigue liberando el cupo.

**Sigue sin tocar:** la acción no aplica el alcance de EPS/médico del BOOKING_AGENT (§12 #9).

---

### Estado de la Fase 2 (2026-09-20)

Implementada y verificada. **Sin commit.** Lleva **una migración aditiva** (`20260921100000_rastreo_paciente_fase2_consulta_en_vivo`): la tabla `HisLookupRequest` y dos columnas en `HospitalMirrorConfig`. **No está encendida**: `lookupEnabled` sale en `false` y no hay interruptor en pantalla.

| Pieza | Dónde |
|---|---|
| Contrato agente↔API (`HisLookup*`) y `lookupCapable` en el latido | `packages/shared/src/mirror-protocol.ts` |
| Reglas puras compartidas: límites, validación, enmascarado de terceros, resolución de la respuesta | `packages/shared/src/his-lookup.ts` |
| Veredictos con lo que respondió el HIS (`CONFIRMADA_EN_EL_HIS`, `ENTREGADA_PERO_AUSENTE`, `OTRA_IDENTIDAD`, `NO_ESTA_EN_EL_HIS`), B completo, línea de vida | `packages/shared/src/patient-trace.ts` |
| Tabla, interruptor y capacidad reportada | `packages/database/prisma/schema.prisma` + la migración |
| API del agente: `GET /mirror/lookup-requests`, `POST /mirror/lookup-result`, cron de expiración y purga | `apps/api/src/mirror/mirror-lookup.service.ts` (+ controlador y módulo) |
| Agente: capacidad opt-in (`PatientLookupCapableDriver`), sondeo cada 3 s, cliente HTTP | `apps/mirror-agent/src/core/{driver.interface,engine,mirror-api-client}.ts`, `config.ts`, `index.ts` |
| Driver de Anserma: las dos consultas SQL | `apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/lookup.ts` |
| Web: qué se pregunta, disponibilidad, creación y lectura de peticiones | `apps/web/lib/rastreo/consulta-his.ts`, `servicio-his.ts`; integración en `servicio.ts` |
| Pantalla: panel «Consulta en vivo al HIS» con sondeo | `apps/web/app/dashboard/rastreo/components/ConsultaHis.tsx` |
| Estado en el panel del espejo (solo lectura) y marca «en vivo» en la bitácora | `EspejoClient.tsx`, `TablaConsultas.tsx` |

**Cómo funciona.** El personal pulsa «Consultar el HIS ahora» → la web valida permisos, disponibilidad y topes, anota la consulta en `PatientLookupLog` (`LIVE_HIS`) y crea las peticiones → el agente las toma, consulta el HIS y responde → la web sondea, y al llegar **reabre el expediente con los ids** para que los veredictos los calcule el servidor con lo que respondió el hospital. Lo del HIS no se guarda: `params` y `result` se borran a los 15 min.

**Decisiones tomadas por defecto (revisables).**

- **Quién puede pedirla:** ORG_ADMIN, BOOKING_AGENT y SUPER_ADMIN (tras elegir clínica); nunca DOCTOR (es lectura sobre la base productiva del hospital y él no ve ni la sincronización). Permiso nuevo `hisEnVivo` (`acceso.ts`).
- **Qué se pregunta.** Escenario A: un cupo por cada cita vigente creada en AgenIA con médico homologado (las 10 más cercanas) **y** las citas del paciente por documento. Escenario B: el cupo exacto **y** el documento en la semana alrededor. Un BOOKING_AGENT acotado a una EPS o a un médico **no** pide la lista por documento: mostraría lo que su alcance le oculta.
- **Privacidad.** La consulta por cupo **no lleva el documento del paciente** al agente. El documento de un tercero que ocupa un cupo se guarda **solo enmascarado**. Cada lectura exige la misma clínica y el mismo usuario que la pidió, sobre el mismo documento.
- **Topes.** 10 consultas por usuario cada 10 min y 5 en curso por clínica; 10 s de tiempo por petición en el HIS (cancelada en el servidor); 60 s de vida de una petición; 15 min de vida de los datos.
- **Un error no es «vacío».** Una respuesta sin lista, un HIS caído o un tiempo agotado dejan la petición en `ERROR`; jamás se presentan como «el HIS no tiene nada».
- **Sin interruptor en pantalla.** Se enciende con un `UPDATE` por clínica después de medir (ver `CONSULTA_EN_VIVO.md`). El panel del espejo lo muestra en solo lectura y en rojo si está encendida con un agente que no la admite.

**Verificación (2026-09-20).**

- Pruebas unitarias en los cuatro paquetes, todas en verde: shared 529, API 1.790 (311 en `mirror/`), agente 528, web 644.
- **Pruebas de mutación** sobre las defensas: 7/7 defectos deliberados detectados en el SQL del driver, 17/17 en la web, 8/9 en el panel (el sobreviviente es un mutante equivalente: `setState` tras desmontar no tiene efecto observable en React 18).
- **Postgres 15 real:** la migración aplica sobre el esquema anterior y `prisma migrate diff` da **cero deriva**; 67 comprobaciones de extremo a extremo (flujo completo, privacidad, aislamiento entre clínicas y usuarios, roles, falla rápido, topes, respuestas malformadas o tardías, expiración, purga, escenario B, FK en cascada).
- **HTTP de extremo a extremo:** motor + cliente HTTP + driver de Anserma reales del agente contra el controlador Nest real y la base real: 22 comprobaciones (los tres veredictos nuevos, un HIS que falla, interruptor apagado, contrato 400/404).
- **Un defecto real encontrado y corregido por la prueba de extremo a extremo:** el HIS guarda la hora **al minuto** y un cupo de AgenIA puede traer segundos; comparados al milisegundo, la fila del HIS de ese mismo cupo se descartaba y el resultado era un falso «el HIS no la tiene». `mismoInstante` ahora compara al minuto (con pruebas que fallaban antes del arreglo). Las pruebas unitarias no lo vieron porque usaban horas redondas.

**Lo que NO está verificado.**

- **El SQL contra un SQL Server real.** Se prueba el texto y los parámetros con un pool simulado, y la lógica con un «HIS» en memoria; no se ha corrido contra el motor del hospital.
- **El costo sobre su base.** Solo hay una estimación por los volúmenes documentados. La consulta por documento recorre un rango de fechas y filtra por historia: es la que puede pesar. Sin la medición del laboratorio la Fase 2 **no cumple** su criterio de aceptación.
- La red real entre la VM del hospital y la nube (el resto del protocolo ya la ejerce).

**Pendiente para cerrar la Fase 2:** (1) medir en el laboratorio y llenar la tabla de `CONSULTA_EN_VIVO.md`; (2) ajustar la ventana o dejarla solo por cupo según el resultado; (3) desplegar en el orden migración → API → agente → web y encender por clínica.

---

## 10. Herramientas complementarias (backlog priorizado)

Salen de los mismos hallazgos. Esfuerzo: estimación gruesa (S/M/L).

| # | Herramienta | Por qué | Esfuerzo |
|---|---|---|---|
| 1 | **Libro de mensajes WhatsApp** | Responde "¿le llegó?" en ambos escenarios y detecta fallos de Meta. *Entra en la Fase 0 (§8 #7).* | S–M |
| 2 | **Vigilante "confirmada pero no en el HIS"** | Alerta a `agendadorWhatsapp` / `agendadorEmail` (ya existen en `HospitalMirrorConfig`) cuando una cita de WhatsApp pasa N minutos sin entregarse o cae en dead-letter. Avisa antes de que el paciente llegue. Convierte el runbook en un aviso proactivo | M |
| 3 | **Bandeja de excepciones de sincronización** | Hoy `/dashboard/espejo` es solo de ORG_ADMIN. Reúne dead-letters, `ERROR`/`CONFLICT` y el `missingInHis` de la reconciliación (hoy se devuelve pero no se persiste), cada uno con dueño y estado | M |
| 4 | **Canario sintético** | Una cita de prueba de punta a punta cada hora sobre un médico de prueba; mide el p95 de confirmar → HIS. Detecta el escenario 1 de forma sistémica antes que los pacientes. Requiere acordar un médico de prueba con el hospital | M–L |
| 5 | **`traceId` de punta a punta** y el agente del espejo como servicio del Monitor | Une conversación → cita → outbox → agente. El Monitor (`ServiceIncident`) hoy cubre Gemini, TTS y Meta pero no el agente | M |
| 6 | **Corrección de identidad** | Fusionar duplicados y reasignar una cita a otra cédula, con vista previa y auditoría | M |
| 7 | **Solicitudes de titulares (Habeas Data)** | Exportar o suprimir los datos de un paciente, más política de retención de `InteractionLog`. El buscador ya cubre buena parte | M |
| 8 | **Higiene de logs** | `RolesGuard` imprime el payload del token en cada request ([`roles.guard.ts:66`](../apps/api/src/common/roles.guard.ts#L66)): datos de usuario en logs y ruido. Pasar a logging estructurado con redacción | S |

---

## 11. Diferido: la causa raíz del escenario 2

Este plan **no cambia lo que ve el paciente**. Da al personal la forma de diagnosticar, pero el bot seguirá sin conocer las citas nacidas en el HIS (§2.1). Por decisión del 2026-09-20 se decide **al terminar todo este plan**.

Opciones que se evaluarán entonces:

| Opción | Cómo | Ventajas | Costos |
|---|---|---|---|
| **(i) El bot consulta el HIS en vivo** al cancelar, reprogramar o pedir "mis citas" | Reutiliza la capacidad de la Fase 2 | No persiste nada nuevo | Latencia de segundos; el bot pasa a depender de que el agente esté vivo (hay que degradar con gracia) |
| **(ii) Alta en caliente** de la cita (y del paciente) cuando el paciente se identifica por WhatsApp o llega el evento | Es lo que el código ya llama "Fase 2+" y el plan del espejo §5.3 anticipa ("se crean/homologan uno a uno") | Recordatorios, cancelación y detección de duplicados funcionan sin más | Es lo más grande: crear `PatientProfile` + `User` y decidir qué hacer con conflictos de identidad |

**Datos para decidir con evidencia, no con intuición** (los produce este mismo plan):
- Frecuencia del veredicto `CITA_DEL_HIS_NO_ESPEJADA` (campo `verdicts` de `PatientLookupLog`).
- Cuántas consultas de tipo B se hacen por semana y cuánto tiempo le cuestan al personal.
- Casos de doble agenda: paciente con cita de WhatsApp y cita de ventanilla para el mismo servicio.

---

## 12. Puntos abiertos

1. ~~**BOOKING_AGENT con scope de EPS/médico y citas fuera de su alcance.**~~ ✅ Resuelto en la Fase 1 con el veredicto `FUERA_DE_ALCANCE` y una nota cuando hay citas ocultas junto a las visibles (ver «Estado de la Fase 1»).
2. ~~**SUPER_ADMIN y el texto de las conversaciones.**~~ ✅ Resuelto por defecto en la Fase 1: ve los **hechos** (cuántos mensajes, cómo terminó, motivos de fallo) y **no** el texto. Sigue siendo una decisión revisable.
3. **Lista de motivos** de consulta (§6): adoptada tal como se propuso (`PACIENTE_EN_VENTANILLA`, `RECLAMO_PQRS`, `SOPORTE_TECNICO`, `OTRO`); ampliarla es cambiar una constante en `@agenia/shared` (`MOTIVOS_CONSULTA`). Queda abierto si alcanza en producción.
4. **Retención** de `PatientLookupLog` e `InteractionLog`. Hoy solo `avisosMasivos.retencionDiasDatosPersonales` define una.
5. **Ventana por defecto** de la consulta en vivo. Fijada en la Fase 2 en **−7 / +60 días, estirada hasta cubrir las citas relevantes y con tope de 180** (por cupo, la ventana no interviene). Es una propuesta: se confirma o se acorta tras medir el costo en el laboratorio (`docs/drivers/<driverKey>/CONSULTA_EN_VIVO.md`).
6. ~~**¿El envío por Meta devuelve el `wamid` al llamador?**~~ ✅ Resuelto en la Fase 0: sí. Los cuatro puntos de envío reciben la respuesta de la Cloud API y de ahí sale `messages[0].id`; están todos enganchados al libro (§8 #7).
7. **Fuera de la ventana de 24 h de Meta** un mensaje libre no sale: el "enviar confirmación" del escenario B tendría que usar una plantilla (`WhatsappTemplate`).
8. ~~**Volver a cancelar una cita ya cancelada** liberaba el cupo aunque otra cita ya lo ocupara.~~ ✅ Corregido (ver «Corrección: re-cancelar» en §9).
9. **`cancelAppointmentAndFreeSlot` no aplica el alcance de EPS/médico del BOOKING_AGENT**: un agente con EPS o médico asignados puede cancelar cualquier cita de la clínica por esta vía, aunque el agendamiento y el rastreo sí lo acoten. Comportamiento anterior; no se tocó.

---

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| El buscador se usa para curiosear | Motivo obligatorio, `PatientLookupLog`, vista de consultas para ORG_ADMIN, enmascarado, límite de tasa (§6) |
| La consulta en vivo carga la base productiva del hospital | Ventana y filas acotadas, timeout, límite de tasa, interruptor apagado por defecto, medir antes en el laboratorio (§7.4) |
| Un veredicto equivocado lleva a acusar al paciente | Lenguaje neutro; cada veredicto declara su fuente y lo que no sabe; `SIN_RASTRO` nunca dice "no agendó" (§3.3) |
| Agente caído: la pantalla se queda esperando | Falla rápido con el latido y `lastHisReachable` (§7.2) |
| La vista B parece completa antes de la consulta en vivo | Sigue rotulada "Parcial: sin consulta en vivo al HIS" hasta que se hace la consulta; entonces dice a qué hora respondió el hospital (§9) |
| El vigilante y la pantalla clasifican distinto | Un solo clasificador puro en `@agenia/shared` (§3.3) |
| El acceso de BOOKING_AGENT al texto de conversaciones se amplía sin control | Solo el paciente consultado, dentro del expediente, con motivo registrado (§0, §6) |

---

## 14. Relación con otros documentos

- [`PLAN_ESPEJO_HOSPITAL.md`](PLAN_ESPEJO_HOSPITAL.md): §4.1 (la API no alcanza el HIS), §5.3 (pacientes no se precargan), §6 capa 5 (reconciliación).
- `docs/drivers/<driverKey>/RUNBOOK.md`: las secciones "Hay citas que no llegaron al hospital" y "Los dos sistemas no coinciden" siguen siendo la guía de **resolución**. Esta pantalla automatiza sus primeros pasos de **diagnóstico**; no las reemplaza.
- [`MONITOR_SERVICIOS.md`](MONITOR_SERVICIOS.md): el modelo de incidentes que reutilizaría §10 #5.

---

## Apéndice A — Decisiones de diseño resumidas

- Veredictos de lista cerrada con fuente declarada; nunca "miente".
- El clasificador es una función pura en `@agenia/shared`, compartida con el vigilante.
- Dos opciones separadas (A: WhatsApp → HIS, B: HIS → WhatsApp); B solo existe con espejo.
- Nada clínico en esta pantalla; el expediente clínico sigue tras `TenantRbacGuard`.
- Consulta al HIS **en vivo, por paciente, con TTL y sin persistir**: coherente con "no precargar pacientes" (Habeas Data).
- La consulta al HIS replica el patrón de `NoticeRosterRequest` y una capacidad opt-in del driver; el motor genérico no conoce el SQL.
- Motivo obligatorio y bitácora por consulta; enmascarado por defecto; el tenant sale siempre del token.
- SUPER_ADMIN solo con organización elegida, en `/super-admin/rastreo`.
- La causa raíz del escenario 2 queda diferida al cierre de este plan (§11).

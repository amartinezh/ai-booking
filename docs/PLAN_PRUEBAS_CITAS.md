# Plan de pruebas del ciclo de vida de una cita — de WhatsApp al HIS

> Mapa de **qué escenarios existen** en el camino completo de una cita y **dónde
> está probado cada uno**. Sirve para dos cosas: saber si un cambio rompió algo
> que importa, y saber qué NO está cubierto antes de prometer que lo está.
>
> El diseño del motor de espejo vive en `PLAN_ESPEJO_HOSPITAL.md`; el mapeo del
> HIS concreto en `drivers/cnt-sanvicente-anserma/MAPEO_HIS.md`. Este documento
> no los repite: solo dice cómo se verifican.

## 1. El camino completo

```
  Paciente (WhatsApp)
        │  webhook firmado (X-Hub-Signature-256)
        ▼
  ChatbotController ──► InboundQueue ──► ChatbotService  (máquina de 26 estados)
        │                                     │
        │                                     ├─► LlmFactory ─► Gemini │ ChatGPT │ Claude
        │                                     ├─► TtsFactory ─► Google │ ElevenLabs
        │                                     └─► AppointmentsService.bookAppointment()
        │                                              │
        ▼                                              ▼
  InteractionLog (caja negra)                    Postgres: Appointment + ScheduleSlot
                                                          │  trigger fn_sync_outbox()
                                                          ▼
                                                     SyncOutbox
                                                          │  GET /mirror/events (long-poll)
                                                          ▼
                                            Agente on-premise (VM del hospital)
                                                          │  driver cnt-sanvicente-anserma
                                                          ▼
                                             SQL Server del hospital
                                             PACIENTES · CITAS_MEDICAS · CITAS_ANULADAS
```

Y de vuelta: `POST /mirror/changes` (el hospital agendó o canceló por
ventanilla), `POST /mirror/availability` (la agenda del HIS pasa a ser la de
AgenIA) y `POST /mirror/reconcile` (la foto diaria que detecta deriva).

## 2. Niveles de prueba

| Nivel | Dónde | Qué prueba | Cómo se corre |
|---|---|---|---|
| **Unitario** | `*.spec.ts` junto al código | Una pieza con sus colaboradores dobles | `pnpm --filter <pkg> test` |
| **E2E conversacional** | `apps/api/src/chatbot/chatbot.flows.e2e.spec.ts` | Turnos reales contra `ChatbotService` con Prisma/Redis dobles | idem |
| **E2E de sistema** | `scripts/e2e-espejo.mjs` | WhatsApp → API → Postgres → agente → **SQL Server real**. No mockea nada | `node scripts/e2e-espejo.mjs --decir "..."` |
| **Game-day** | `scripts/game-day-espejo.sh` | Seis desastres contra la VM simulada, con aserciones | `./scripts/game-day-espejo.sh` |

Los dos primeros son la barrera de CI. Los dos últimos exigen el stack local
levantado (`./scripts/up.sh --his-mock` + `apps/mirror-agent/local-vm/vm-up.sh`)
y son los que atrapan lo que un mock no puede: la firma de Meta de verdad, el
dialecto de SQL Server, el reloj, la red.

## 3. Matriz de escenarios

Leyenda de cobertura: **U** unitario · **C** E2E conversacional · **S** E2E de
sistema (contra el HIS real) · **G** game-day.

### 3.1 Entrada: el webhook de WhatsApp

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 1.1 | `GET` de verificación con `verify_token` de una clínica | 200 con el challenge | U |
| 1.2 | `GET` con token desconocido | 403, sin filtrar si existe | U |
| 1.3 | `POST` con firma válida | Se procesa | U · S |
| 1.4 | `POST` sin firma / con firma inválida | 403; el mensaje NO entra | U · S |
| 1.5 | Webhook con varios `entry`/`changes`/`messages` | Se procesan TODOS | U |
| 1.6 | Evento de `statuses` (entregado/leído) | Se registra, no se responde | U |
| 1.7 | Remitente sin BSUID, sin `from` y sin PSID | `SENDER_UNIDENTIFIED` auditado con las CLAVES del payload | U |
| 1.8 | `phone_number_id` que ninguna clínica reclama | Descartado con aviso, sin fallback global | U |
| 1.9 | Clínica inactiva | Mensaje de "línea inactiva" + `ORG_INACTIVE` | U |
| 1.10 | Dos mensajes del mismo paciente casi simultáneos | Se serializan por `senderId`, no por `wamid` | U |

### 3.2 Identidad del paciente y multi-tenant

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 2.1 | Paciente que oculta su número (solo BSUID) | Se identifica y se le responde al BSUID | U |
| 2.2 | Mismo paciente en dos clínicas | Dos `PatientProfile`, dos BSUID, cero cruce | U · C |
| 2.3 | Cédula repetida entre clínicas | Permitido: única POR clínica | U |
| 2.4 | Un `slotId` de otra clínica en la confirmación | Reserva rechazada | U |
| 2.5 | Token JWT sin `organizationId` | 403 (salvo `SUPER_ADMIN`) | U |
| 2.6 | `:orgId` en la ruta ≠ el del token | 403 en audio-config y encuestas | U |

### 3.3 Agendamiento (el camino feliz y sus desvíos)

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 3.1 | Saludo → servicio → EPS → cupo → cédula → confirmación | Cita creada, cupo ocupado | C · **S** |
| 3.2 | Selección por letra (A/B/C) en cada menú | Avanza | C · S |
| 3.3 | Selección escribiendo el nombre del servicio | Mapeo semántico contra el catálogo | U · C |
| 3.4 | Selección por **audio** | Transcripción anclada al vocabulario del tenant | U · C |
| 3.5 | Audio de una sola letra ("A") | NO se marca ininteligible (anclaje de letras) | U |
| 3.6 | Preferencia de fecha ("mañana", "el lunes") | Cupos acotados a esa ventana | U · C |
| 3.7 | Paciente nuevo | Pide nombres, apellidos, nacimiento, sexo y régimen por separado | C · **S** |
| 3.8 | Paciente conocido | No vuelve a preguntar nada | C · **S** |
| 3.9 | Cita **Particular** | NO se pide régimen ni padrón | C · **S** |
| 3.10 | EPS con padrón: cédula NO dada de alta | Bloqueado, con enlace de solicitud | U · **S** |
| 3.11 | El cupo se lo llevó otro entre el menú y el "SÍ" | `SLOT_TAKEN`, mensaje honesto | U · C |
| 3.12 | El médico se apagó mientras el paciente decidía | `DOCTOR_NOT_BOOKABLE`, mensaje distinto al de colisión | U |
| 3.13 | Médico sin homologar con el HIS (espejo activo) | Su cupo NO se ofrece | U |
| 3.14 | Sin cupos | Se ofrece lista de espera | C |
| 3.15 | Consentimiento Ley 1581 en el resumen | Presente, con enlace si está configurado | U · **S** |
| 3.16 | Fecha/hora mostradas al paciente | Hora de **Bogotá**, no la UTC del contenedor | U · **S** |

### 3.4 Cancelación y reprogramación

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 4.1 | "cancelar mi cita" → cédula → confirmar | Cita `CANCELLED`, cupo liberado | C · **S** |
| 4.2 | Cédula sin citas | Ofrece reintentar con otra | U · C |
| 4.3 | Varias citas | Menú de selección | C |
| 4.4 | Cancelar y volver a agendar **el mismo cupo** | Funciona (índice único parcial) | **S** |
| 4.5 | Reprogramar: cédula → cita → nuevo cupo → confirmar | Cupo viejo liberado, nuevo ocupado | C |
| 4.6 | Reprogramar sin cupos disponibles | Ofrece cancelar | C |
| 4.7 | "cancelar" a mitad de un agendamiento | Pide confirmación antes de abortar | U · C |

### 3.5 Guardarraíles

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 5.1 | Texto que sugiere emergencia médica | Derivación inmediata (123/urgencias), NO se agenda | U |
| 5.2 | Emergencia detectada por el LLM o en el transcript | Igual | U |
| 5.3 | El RAG de FAQ afirma disponibilidad de cupos | Interceptado (`FAQ_HALLUCINATION`) | U |
| 5.4 | Insultos | Cierre cortés, sesión terminada | U · C |
| 5.5 | Fuera de contexto | Reconducción, con tope de reintentos | U · C |
| 5.6 | Reintentos agotados | Cierre con `MAX_RETRIES` | U |
| 5.7 | Proveedor de IA caído | Menú determinista, el bot no se calla | U · C |
| 5.8 | Sin proveedor de IA configurado | Degrada, no revienta | U |

### 3.6 Salida: AgenIA → HIS

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 6.1 | Cita nueva | `INSERT` en `CITAS_MEDICAS` con estado 0 | U · **S** |
| 6.2 | Paciente nuevo | `INSERT` previo en `PACIENTES`, nombres/apellidos en sus 4 columnas | U · **S** |
| 6.3 | Sexo del paciente | `NU_SEXO_PAC` = 1 (M) / 0 (F) | U · **S** |
| 6.4 | Cancelación | `DELETE` de `CITAS_MEDICAS` + `INSERT` en `CITAS_ANULADAS` con motivo | U · **S** |
| 6.5 | Reagendamiento | El cupo anterior viaja en `__old`; el driver borra la vieja y crea la nueva | U |
| 6.6 | Médico o servicio sin homologar | Evento entregado con `missingMappings`; el driver NO escribe | U |
| 6.7 | La hidratación revienta | Evento marcado no aplicable; el HIS no se toca | U |
| 6.8 | Evento `SLOT` (el driver no lo espeja) | `skippedSeqs` → cerrado + `SyncAudit` SKIPPED, NO dead-letter | U · **S** |
| 6.9 | El HIS rechaza el evento | `attempts++`, backoff exponencial, dead-letter a los 10 | U |
| 6.10 | Un `seq` de otra clínica | Ignorado con aviso (aislamiento de tenant) | U |
| 6.11 | Dos eventos de la misma entidad | Uno por lote: el orden por entidad se conserva | U |
| 6.12 | Ack perdido en la red | El evento se re-entrega; la idempotencia del agente lo absorbe | U |

### 3.7 Entrada: HIS → AgenIA

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 7.1 | El hospital agendó por ventanilla | El cupo se ocupa en AgenIA (no se sobrevende) | U · G |
| 7.2 | …con paciente no homologado | El cupo se ocupa igual | U |
| 7.3 | El hospital canceló | Cita `CANCELLED` + cupo liberado | U |
| 7.4 | …una cita que AgenIA nunca tuvo | Solo libera el cupo | U |
| 7.5 | Desenlace de atención (asistió / no asistió) | `attendanceStatus` actualizado, resuelto por cupo | U |
| 7.6 | Desenlace con un valor desconocido | Rechazado, no se escribe | U |
| 7.7 | `event_id` repetido | `SKIPPED` por `SyncInbox` | U |
| 7.8 | Un evento del lote falla | Los demás se aplican; se cuenta en `errors` | U |
| 7.9 | Anti-eco | Lo aplicado desde el HIS no vuelve al HIS (`origin='MIRROR'`) | U · G |

### 3.8 Agenda (Fase 2) y catálogo

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 8.1 | Subida de la rejilla del hospital | Cupos creados/actualizados/retirados | U · G |
| 8.2 | Modo `SHADOW` | Calcula y reporta sin escribir | U |
| 8.3 | El hospital cancela una jornada | Sus cupos desaparecen | G |
| 8.4 | …pero un cupo tiene cita viva | NO se borra: se reporta como conflicto | U · G |
| 8.5 | Catálogo de médicos/servicios | Candidatos guardados, NUNCA homologados solos | U |
| 8.6 | Un médico deja de aparecer | Se cuenta como desaparecido, no se borra | U |

### 3.9 Resiliencia (game-day)

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 9.1 | El proceso del agente muere | systemd lo revive, no se pierde ninguna cita | G |
| 9.2 | La VM se reinicia | El agente arranca solo y retoma su cursor | G |
| 9.3 | El HIS deja de responder | Modo seguro; los eventos quedan pendientes | G · **S** |
| 9.4 | Se cae internet en la VM | Igual; al volver, se pone al día | G · **S** |
| 9.5 | Un evento en dead-letter se reprocesa | Vuelve a la cola y se aplica | G |
| 9.6 | La API se cae y vuelve | El agente sale del modo seguro solo | **S** |

### 3.10 Después de la cita

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 10.1 | Recordatorio N horas hábiles antes | Enviado una sola vez (`reminderSentAt`) | U |
| 10.2 | Recordatorio fuera de la ventana de 24 h | Plantilla aprobada, no texto libre | U |
| 10.3 | …sin plantilla configurada | `skipped` + huella en la auditoría de la clínica | U |
| 10.4 | Un envío falla | NO marca la cita; el siguiente tick reintenta | U |
| 10.5 | Un fallo individual en el lote | El resto del lote sigue | U |
| 10.6 | Encuesta CSAT: token de un solo uso | Segundo envío rechazado | U |
| 10.7 | Reporte CSAT de la clínica | Payload minimalista, solo sus pacientes | U |
| 10.8 | Lista de espera: se libera un cupo | Se ofrece al primero compatible (FIFO) | U |
| 10.9 | No confirma en 30 min | Expira y pasa al siguiente | U |

### 3.11 Seguridad y datos

| # | Escenario | Resultado esperado | Cobertura |
|---|---|---|---|
| 11.1 | `JWT_SECRET` ausente | Se rechaza TODA autenticación (fail-closed) | U |
| 11.2 | Token forjado con otro secreto | 403 | U |
| 11.3 | Credenciales de WhatsApp / HIS / IA | Cifradas AES-256-GCM en reposo | U |
| 11.4 | Notas de la historia clínica | Cifradas al escribir, descifradas al leer | U |
| 11.5 | Filas anteriores al cifrado | Se leen tal cual (retrocompatibilidad) | U |
| 11.6 | Un ciphertext manipulado | Falla, no se descifra en silencio | U |
| 11.7 | Body de un error con `password`/`token` | `[REDACTED]` en `SystemLog` | U |
| 11.8 | Purga de una clínica | Exige clave, transaccional, con auditoría inmutable | U |
| 11.9 | Bundle FHIR | Solo historias FIRMADAS, acotado al tenant | U |

## 4. Huecos conocidos

Lo que este plan **no** cubre hoy, dicho explícitamente:

1. **Concurrencia real sobre el mismo cupo.** La colisión está probada con
   dobles (`SLOT_TAKEN`, P2002), pero no hay una prueba que lance dos
   confirmaciones simultáneas contra Postgres. El índice único parcial la
   resuelve a nivel de base; falta la prueba que lo demuestre.
2. **Carga.** El hospital hace ~235 citas/día hábil. No hay prueba de volumen
   ni del comportamiento del long-poll con muchos agentes.
3. **`apps/web`.** El frontend no tiene pruebas automatizadas. Todo lo de este
   documento es API, agente y paquetes compartidos.
4. **Meta de verdad.** El E2E de sistema firma como Meta y habla con el webhook
   real, pero los envíos salientes van contra credenciales de prueba: no se
   verifica una plantilla aprobada en una WABA real.
5. **`chatbot.service.ts`** está al ~78 %. Lo que falta son ramas de reprompt y
   de reintento en estados poco frecuentes, no caminos principales.

## 5. Cómo correr todo

```bash
# 1. Unitario + E2E conversacional (barrera de CI, sin infraestructura)
pnpm --filter api test
pnpm --filter @agenia/mirror-agent test
pnpm --filter @agenia/shared test

# Con cobertura y trinquete (falla si baja de los umbrales del package.json)
cd apps/api && npx jest --coverage

# 2. Stack local
./scripts/up.sh --his-mock
./apps/mirror-agent/local-vm/vm-up.sh      # VM simulada del hospital

# 3. E2E de sistema contra el HIS real
node scripts/e2e-espejo.mjs --estado
node scripts/e2e-espejo.mjs --decir "Hola" --decir "C" --decir "B"

# 4. Game-day (seis desastres)
./scripts/game-day-espejo.sh

# 5. Abajo
./scripts/down.sh
```

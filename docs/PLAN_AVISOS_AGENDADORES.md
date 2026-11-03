# Avisos por WhatsApp a todos los agendadores

**Estado: FASE 1 EN PRODUCCIÓN (commit f4223e2, 2026-11-02); horario de los avisos (§8) construido el mismo día, sin commit.** N1 … N12 aprobadas por el usuario el 2026-11-02, todas como se recomendaban. Despliegue: migración → API → web, seguidos (§3.7). Lo que sigue es la fase 2 (§7): agregar a los agendadores en Anserma y probar a cada uno.

**Cómo quedó (fase 1):** reglas en `packages/shared/src/avisos-destinatarios.ts`; tabla `SyncAlertRecipient` (migración `20261102120000_destinatarios_avisos`, con `lastTestAt` además de lo de §3.2); envío en `apps/api/src/mirror/mirror-alert.service.ts`; «Probar» en `apps/api/src/mirror/sync-alerts.controller.ts`; alerta técnica por persona con el tipo `AVISO_AGENDADOR_NO_SALE` y la clave `espejo:aviso-destinatario:<org>:<id>` (no un tipo nuevo `DESTINATARIO_FALLIDO`: es la misma falla, por persona); panel en `apps/web/lib/bandeja/avisos.ts` y `apps/web/app/dashboard/bandeja/PanelAvisos.tsx`. Verificado con Postgres 15 real: la migración (copia, unión al agendador, cero deriva), el envío por alcance y modo, el recordatorio, «Probar» con dos clics simultáneos y guardar con un número que pasa de una fila a otra.

## 1. Qué se pide

Que los avisos de la Bandeja de sincronización (citas que no llegan al hospital y pedidos de pacientes) **les lleguen a todos los agendadores que el hospital decida**, no a un solo celular, y que la pantalla de configuración **muestre la lista de agendadores del sistema**, para elegirlos ahí en vez de escribir números a mano.

**Lo que NO hace este plan:** no cambia cuándo se avisa (las reglas del vigilante, `requiereAviso` / `requiereRecordatorio`, los 30 min y los 2 recordatorios), ni qué dice el mensaje (sigue sin datos del paciente), ni las plantillas de Meta (se usan las mismas dos), ni la bandeja misma (tomar, resolver, descartar).

## 2. Cómo está hoy

### 2.1 Quién ve y quién cambia la configuración

| Quién | Qué ve en la Bandeja | ¿Puede cambiar los avisos? |
|---|---|---|
| Administrador de la clínica (`ORG_ADMIN`) | El recuadro verde/ámbar, el botón «Configurar avisos» y los dos números completos | **Sí**, el único |
| Agendador (`BOOKING_AGENT`) | El recuadro (si los avisos salen o por qué no), sin números ni botón | No |
| Super admin | Nada: no entra a la Bandeja (`apps/web/lib/bandeja/acceso.ts`, «es soporte de plataforma y no opera la cola de una clínica») | No |
| Médico, observador, paciente | Nada | No |

El permiso lo aplica el servidor en cada lectura y en cada acción, no solo la pantalla: `estadoAvisos` no manda los números a quien no es administrador y `guardarAvisos` responde «Sin permisos» ([`servicio.ts:791`](../apps/web/lib/bandeja/servicio.ts#L791)).

### 2.2 Cómo sale un aviso

- La configuración son **dos columnas** de `HospitalMirrorConfig`: `agendadorWhatsapp` (recibe el aviso y los recordatorios) y `agendadorRespaldoWhatsapp` (solo los recordatorios: es el escalamiento de §12 #14 del rastreo).
- Cada 2 minutos el vigilante llama a [`mirror-alert.service.ts`](../apps/api/src/mirror/mirror-alert.service.ts): **reclama** cada excepción con un compare-and-set (dos réplicas de la API no avisan dos veces), arma **un solo mensaje** con el resumen (cuántas, la más próxima, la causa) y lo manda al agendador. Si falla, devuelve lo reclamado y reintenta en la vuelta siguiente; si falla solo el respaldo, no devuelve nada.
- Dos plantillas, mismos números: `SYNC_EXCEPTION_ALERT` (`aviso_agendador_sync`, aprobada) y `PATIENT_REQUEST_ALERT` (**sin crear en Meta todavía**).
- `AgentProfile.phone` existe pero **nadie lo edita ni lo lee**: la pantalla de Usuarios no tiene el campo y la única función que lo escribía (`createBookingAgent`, `apps/web/app/actions/usuarios.ts`) ya no se llama.

### 2.3 Lo que se vio en producción (2-nov, solo lectura)

- Un solo número configurado (…3575), sin respaldo. **No es de ninguno de los 5 agendadores** (ninguno tiene celular registrado) y, por la captura del usuario, es su propio WhatsApp: el personal del hospital hoy no recibe nada.
- Los 5 agendadores (`Agendador`, Alejandro Grisales, Ana María García, Jeisson Rojas, Karen Muñoz) están activos y **ninguno tiene EPS ni médico asignados**: todos ven la bandeja completa.
- El 29-oct salieron un aviso y dos recordatorios. Los tres se leyeron entre 4 y 11 minutos después, pero nadie tomó el caso: sigue ABIERTO.
- 🐞 El mensaje dice «1 cita cita(s)»: la plantilla aprobada trae «{{1}} cita(s)» y el código manda «1 cita» ([`sync-watch.ts:711`](../packages/shared/src/sync-watch.ts#L711)).

## 3. El diseño

### 3.1 La idea en una línea

Los dos números pasan a ser una **lista de destinatarios**. Cada destinatario es **un usuario de la clínica** (agendador o administrador, elegido de la lista) **o un número suelto con nombre** (un coordinador sin cuenta), y cada uno dice qué recibe.

### 3.2 Los datos

Tabla nueva `SyncAlertRecipient`, una fila por persona que recibe:

| Campo | Qué es |
|---|---|
| `organizationId` | La clínica (aislamiento por tenant) |
| `userId` (opcional, FK a `User`, `onDelete: Cascade`) | La persona del sistema. Si se borra su cuenta, deja de recibir sola |
| `label` (opcional) | El nombre para un número sin cuenta («Coordinación de citas») |
| `phone` | Solo dígitos con el 57, igual que hoy (`leerCelular`) |
| `mode` | `AVISOS` (aviso y recordatorios) o `SOLO_RECORDATORIOS` (el respaldo de hoy) |
| `syncAlerts` / `patientRequestAlerts` | Qué avisos recibe: citas que no llegan al hospital / pedidos de pacientes |
| `isActive` | Pausar sin borrar (vacaciones, incapacidad) |
| `lastSentAt`, `lastWamid`, `lastError`, `lastErrorAt` | La salud por persona (§3.6) |
| `createdByUserId`, `createdAt`, `updatedAt` | Quién la agregó |

Únicos: `(organizationId, phone)` y `(organizationId, userId)`: un mismo celular o una misma persona no reciben dos veces.

`conflictAlertsEnabled` sigue siendo el interruptor general («Avisar por WhatsApp»). Las columnas `agendadorWhatsapp` y `agendadorRespaldoWhatsapp` quedan sin uso, como ya pasa con `agendadorEmail` (N12).

### 3.3 Cómo sale un aviso con varios destinatarios

Todo lo de hoy sigue igual hasta el envío: candidatas, `requiereAviso` / `requiereRecordatorio`, interruptores, plantilla y el **reclamo por excepción** (la protección entre réplicas no cambia). Cambia el lote:

```
para cada lote (AVISO o RECORDATORIO) de un grupo (sincronización o pedidos de pacientes):
  quiénes   = activos que reciben este grupo
              AVISO        → modo AVISOS
              RECORDATORIO → modo AVISOS + SOLO_RECORDATORIOS
  para cada quien: sus excepciones = las del lote que caben en su alcance (N3)
  las que no le caben a nadie       → van a todos los de «quiénes» (N4)
  a cada quien, UNA plantilla con SU resumen (cuántas, la más próxima, la causa)
  por excepción: salió a ≥ 1 persona → AVISADA / RECORDADA, con los nombres
                 no salió a nadie     → se devuelve y se reintenta (como hoy)
  por persona:   se guarda el último envío o el último error
```

- **Un aviso por persona y por vuelta**, no uno por cita: es la regla de hoy («veinte WhatsApp seguidos se silencian»), ahora por persona.
- **El historial del caso** dice a quién llegó, con nombres y nunca con números: «Aviso por WhatsApp a Karen Muñoz, Alejandro Grisales y 2 más» y, si alguno falló, «(a Ana García no salió)».
- **Si a una persona le falla siempre** (número sin WhatsApp, número equivocado), los demás siguen recibiendo y la excepción no se devuelve por eso. La pantalla lo muestra en rojo en su fila y el vigilante abre una alerta técnica nueva, `DESTINATARIO_FALLIDO`, una por persona y con deduplicación (mismo canal de `docs/PLAN_ALERTAS_TECNICAS.md`).
- El alcance usa la regla que ya existe en `@agenia/shared` (`citaFueraDeAlcance`), la misma de la bandeja y de la lista de citas: un agendador acotado a una EPS o a un médico solo recibe lo que puede ver al abrir la bandeja.

### 3.4 La pantalla

Bandeja de sincronización → «Configurar avisos», solo para el administrador. Reemplaza los dos campos de hoy:

```
┌─ Avisos por WhatsApp ─────────────────────────────────────── [● Encendidos] ─┐
│ Llegan a 4 personas · citas que no llegan: 4 · pedidos de pacientes: 3       │
│                                                                              │
│ AGENDADORES Y ADMINISTRADORES                                                │
│  Persona                 Celular         Recibe              Qué      Estado │
│  Karen Muñoz · todo      310 555 0101    Avisos y record. ▾  ☑ ☑  ✓ leído 29-oct  [Probar] │
│  Alejandro Grisales      310 555 0102    Avisos y record. ▾  ☑ ☑  ⏳ sin envíos     [Probar] │
│  Ana María García        [            ]  No recibe        ▾                            │
│  Jeisson Rojas           310 555 0104    Solo record.     ▾  ☑ ☐  ✓ entregado       [Probar] │
│  Agendador (cuenta comp.) [            ] No recibe        ▾                            │
│  admin@hospital (admin)  [            ]  No recibe        ▾                            │
│                                                                              │
│ OTROS NÚMEROS (sin cuenta en AgenIA)                                         │
│  Configurado antes       ··3575          Avisos y record. ▾  ☑ ☑  ✓ leído 29-oct  [Quitar] │
│  [+ Agregar un número]                                                       │
│                                                                              │
│ ⚠ Pedidos de pacientes: falta la plantilla en Meta (no sale a nadie).        │
│                                                        [Guardar cambios]     │
└──────────────────────────────────────────────────────────────────────────────┘
   ☑ ☑ = «Citas que no llegan al hospital» y «Pedidos de pacientes»
```

- **La lista sale sola** de los usuarios `BOOKING_AGENT` y `ORG_ADMIN` de la clínica: un agendador nuevo aparece con «No recibe» y el celular vacío, y uno borrado desaparece. El nombre sale de `AgentProfile.fullName` (o el correo si no hay perfil) y al lado va su alcance: «todo», «EPS Sura», «Dr. Pérez».
- **El celular se escribe en la misma fila.** Si `AgentProfile.phone` tuviera algo, se precarga.
- **«Recibe»** es una lista: «No recibe», «Avisos y recordatorios», «Solo recordatorios (respaldo)». Las casillas «Qué» se habilitan solo cuando recibe y nacen las dos marcadas.
- **La cobertura arriba** («llegan a 4 personas…») y una advertencia si un grupo queda sin nadie o si todos los que reciben están acotados a una EPS o a un médico: los casos sin EPS ni médico (un cupo, un error de la auditoría) caerían en N4.
- **Guardar** valida todo junto (celular colombiano válido, sin repetidos, tope de N7) y deja una sola línea en la bitácora del espejo, con números enmascarados y quién lo cambió: «Avisos: +Karen Muñoz (··0101), Jeisson Rojas pasó a solo recordatorios, −Configurado antes».
- En el celular, las filas se apilan como tarjetas.

### 3.5 Lo que ve el agendador

Sin botón de configurar, como hoy, pero con **su propio estado** en el recuadro:

- «Recibes los avisos en tu WhatsApp (··0101): citas que no llegan al hospital y pedidos de pacientes», o
- «No recibes estos avisos por WhatsApp. Si los necesitas, pídeselo al administrador».

No ve los números de los demás.

### 3.6 «Probar» y la salud por persona

- **«Probar»** manda a esa fila la misma plantilla `aviso_agendador_sync` con {{1}} `0`, {{2}} `ninguna (mensaje de prueba)` y {{3}} `PRUEBA de la configuración de avisos: no hay nada que revisar`. Así se comprueban a la vez el número, que la persona tenga WhatsApp y la plantilla. Uno cada 5 minutos por número, y queda en la bitácora.
- **El estado** de cada fila sale de su último envío: `lastWamid` cruzado con `WhatsappMessageLog` (aceptado → entregado → leído, o fallido con el código de Meta) y `lastError` para lo que Meta rechazó en el acto (hoy esos rechazos solo quedan en el registro de la API, que se pierde en cada despliegue).
- Enviar es cosa de la API, no de la web. La prueba va por una ruta nueva **fuera de `/mirror`**, por ejemplo `POST /sync-alerts/recipients/:id/test`: el Caddy del servidor deja salir a internet todo `/api/mirror*`, y esta ruta es solo para el personal.

### 3.7 El paso de lo que hay hoy

La migración copia lo que haya: `agendadorWhatsapp` → fila «Configurado antes», modo `AVISOS`, los dos grupos; `agendadorRespaldoWhatsapp` → fila «Respaldo (configurado antes)», modo `SOLO_RECORDATORIOS`. Si el número coincide con el `AgentProfile.phone` de alguien, la fila se une a esa persona. Nadie deja de recibir el día del despliegue. En Anserma queda una fila (…3575), que el administrador puede quitar cuando agregue a los agendadores.

Orden: migración → API → web. Entre la API y la web, el panel viejo escribiría en las columnas viejas, que ya nadie lee: hay que desplegar los dos seguidos.

### 3.8 De paso: «1 cita cita(s)»

{{1}} de `SYNC_EXCEPTION_ALERT` pasa a ser **solo el número** («1», «3»), porque la plantilla aprobada ya dice «cita(s)». No hay que volver a pasar por Meta. La descripción del contrato (`whatsapp-template-contracts.ts`) cambia a «Cantidad de citas (solo el número; la plantilla dice "cita(s)")». `PATIENT_REQUEST_ALERT` no cambia: su plantilla aún no existe y el texto propuesto («pedidos de pacientes sin atender ({{1}})») funciona con «1 caso».

## 4. Qué hay que construir

| Pieza | Dónde |
|---|---|
| Tabla, enum, copia de los dos números | `packages/database/prisma` (migración `…_destinatarios_avisos`) |
| Reglas puras: quién recibe cada lote, cobertura, validación, parámetros de la prueba, {{1}} solo número | `packages/shared/src/avisos-destinatarios.ts` (nuevo), `sync-watch.ts`, `whatsapp-template-contracts.ts` |
| Envío a varios, historial con nombres, salud por persona | `apps/api/src/mirror/mirror-alert.service.ts` |
| Alerta técnica `DESTINATARIO_FALLIDO` | `apps/api/src/mirror/mirror-watchdog.service.ts` |
| «Probar» | `apps/api` ruta nueva fuera de `/mirror` (ORG_ADMIN, tenant del token) |
| Leer y guardar la lista, estado del agendador | `apps/web/lib/bandeja/servicio.ts` (`estadoAvisos`, `guardarAvisos`), `app/actions/bandeja.ts` |
| La pantalla | `apps/web/app/dashboard/bandeja/BandejaClient.tsx` (`PanelAvisos`, mejor en su propio archivo) |
| Base de conocimiento | `docs/conocimiento/AGENIA.md`: Parte 1 «Configurar los avisos por WhatsApp al agendador», Parte 2 (vigilante), bitácora |
| Pruebas | shared (reglas), API (varios destinatarios, uno que falla, alcance, réplicas), web (permisos, validación), integración con Postgres 55433 |

## 5. Volumen y costo

Cada aviso se cobra **por persona** como plantilla de Utilidad (los agendadores casi nunca le escriben al número de la clínica, así que no hay ventana de 24 h abierta). Con lo medido en producción:

- Citas que no llegan al hospital: 1 caso en octubre → 3 mensajes (aviso + 2 recordatorios).
- Pedidos de pacientes con la cita a ≤ 24 h: 6 casos del 15-oct al 2-nov. Con la plantilla, cada uno da de 1 a 6 mensajes (aviso y recordatorios a 24 h, y otra vez a 4 h si nadie lo toma).

En orden de magnitud son **10 a 30 avisos al mes por persona**; con 6 personas, de 60 a 180 plantillas al mes. La tarifa vigente de Colombia se consulta en el WhatsApp Manager. «Solo recordatorios» sirve justamente para no pagar el primer aviso a quien solo debe enterarse si nadie actuó.

## 6. Decisiones por aprobar

| # | Decisión | Recomendado |
|---|---|---|
| N1 | Quién puede recibir | Usuarios `BOOKING_AGENT` y `ORG_ADMIN` de la clínica, más números sueltos con nombre |
| N2 | Dónde vive el celular | En la fila del destinatario; `AgentProfile.phone` solo para precargar |
| N3 | Alcance | Un agendador acotado a EPS o médico recibe solo lo suyo (hoy ninguno está acotado) |
| N4 | Caso que por alcance no le cabe a nadie | Va a todos los que reciben (el mensaje no lleva datos del paciente; peor es un caso perdido) |
| N5 | Modos | «Avisos y recordatorios» y «Solo recordatorios» (reemplaza el respaldo) |
| N6 | Qué avisos por persona | Dos casillas, citas que no llegan y pedidos de pacientes, las dos marcadas al agregar |
| N7 | Tope | 15 destinatarios activos por clínica |
| N8 | Quién configura | Solo el administrador de la clínica, como hoy; el agendador ve su propio estado (§3.5) |
| N9 | «Probar» | Con la plantilla real y el texto «PRUEBA…», uno cada 5 min por número, en la bitácora |
| N10 | «1 cita cita(s)» | {{1}} pasa a ser solo el número (§3.8) |
| N11 | Horario silencioso | No en esta entrega: hoy los avisos salen a cualquier hora porque hay citas a las 6:30 a. m. Queda para la fase 3 (§7). **Hecho el 2026-11-02 por clínica, a pedido del usuario: §8.** |
| N12 | Columnas viejas | Se copian y quedan sin uso; se borran en una migración posterior |

## 7. Fases

1. **Varios destinatarios** (todo §3 menos la fase 3, incluido N10). Se prueba con Postgres 55433 y Meta de mentira: dos réplicas, una persona con número malo, un agendador acotado y la migración de los dos números de hoy.
2. **Encender en Anserma:** el administrador agrega a los agendadores con su celular, «Probar» a cada uno y se mira una semana la columna de estado. Necesita de antes la plantilla `aviso_agendador_pacientes` aprobada.
3. **Opcional, después:**
   - **Horario por clínica:** hecho el 2026-11-02 (§8).
   - **Horario por persona** («solo de 6 a 19 h»), con el resumen pendiente a la mañana siguiente si el caso sigue abierto. Exige guardar por persona qué se le avisó.
   - **Telegram para el personal:** quien ya tenga su cuenta unida al asistente de soporte (`SupportBotConversation.chatId`) recibe ahí, gratis y sin plantilla. Espera a que el asistente esté conectado (pasos 7-10 de `docs/ASISTENTE_SOPORTE.md`).

## 8. Horario de los avisos (2026-11-02)

Pedido del usuario: poder elegir que los avisos NO salgan fuera del horario común; en ese caso, solo de 7:00 a 17:00 (horario editable, ese por defecto) y nunca los domingos ni los festivos; todo desde el panel, sin dañar lo que ya funciona.

- **Por clínica**, en «Configurar avisos»: «¿Cuándo se envían?» → «A cualquier hora» (lo de siempre) o «Solo en horario laboral», con «De» y «A» (cada 15 minutos). Vale para los dos avisos (citas que no llegan y pedidos de pacientes) y para todas las personas de la lista.
- **Columnas** en `HospitalMirrorConfig` (migración `20261102180000_horario_avisos`): `alertsOutsideHours` (`true` por defecto: al desplegar nada cambia), `alertsHoursFromMin` (420) y `alertsHoursToMin` (1020), en minutos desde la medianoche de la clínica.
- **Reglas** en `packages/shared/src/horario-avisos.ts`: `puedeAvisarAhora` (lunes a sábado, desde incluido y hasta excluido, sin domingos ni festivos de Colombia, en la zona de la clínica), `proximaVentanaDeAvisos` (para decir en pantalla desde cuándo se avisa) y la validación (fin después del inicio, al menos una hora).
- **Envío** (`MirrorAlertService.avisarGrupo`): después de «apagados» y antes de leer la lista, fuera del horario devuelve `FUERA_DE_HORARIO` sin reclamar ni enviar nada; el vigilante no lo trata como falla (ni abre ni cierra alertas técnicas). En la primera vuelta del horario sale el aviso o el recordatorio pendiente, si el caso sigue abierto y la cita no ha pasado. Costo, dicho en la pantalla: un caso de la noche para una cita de las 6:30 a. m. queda solo en la bandeja.
- **«Probar» no mira el horario**: es una prueba pedida a mano.
- **Pantalla**: el recuadro de arriba dice a todos «🕖 Solo en horario laboral: …» y, fuera del horario, desde cuándo se avisa. Guardar manda el horario con la lista; una pantalla vieja (sin horario) no lo toca. La bitácora del espejo dice el horario nuevo y el anterior cuando cambia.

## 9. Riesgos

- **Más ruido:** seis personas con el mismo recordatorio. Lo atenúan «Solo recordatorios», las casillas por persona y que el primero que toma el caso en la bandeja apaga los recordatorios para todos.
- **Celulares personales:** el número del agendador es un dato personal. Se enmascara en la bitácora y el historial y solo el administrador lo ve completo. Hay que avisarle a cada persona antes de agregarla: Meta espera que quien recibe haya aceptado, y «Probar» sirve de confirmación.
- **Cuenta compartida «Agendador»:** si es de varias personas, conviene que su celular sea el de la oficina y no uno personal.
- **Un número que deja de existir** se ve en rojo y en la alerta técnica, pero no frena a los demás.

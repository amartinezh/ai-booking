# Alta en caliente de las citas del hospital

**Estado: IMPLEMENTADO (2026-09-21), pendiente de medir en el hospital y desplegar.** Es la opción (ii) de [`PLAN_RASTREO_PACIENTE.md`](PLAN_RASTREO_PACIENTE.md) §11. Las decisiones D1 … D10 las aprobó el usuario el 2026-09-21 tal como estaban recomendadas, y el código sigue exactamente eso. Lo que falta antes de producción está en «§9 Qué falta».

> **Hallazgo del camino.** Verificando esto contra Postgres real aparecieron dos defectos **preexistentes** del disparador del outbox, los dos corregidos aquí (§8): el origen de los eventos se guardaba como cadena vacía en cualquier conexión que ya hubiera atendido al espejo, y lo nacido en el HIS no estaba excluido de la entrega, así que el hospital habría recibido de vuelta las citas que él mismo agendó.

## 1. Qué resuelve

Hoy, cuando el hospital agenda una cita en su sistema:

- el paciente **no la ve** si le escribe al bot («no tiene citas»),
- **no recibe recordatorio**,
- y no puede cancelarla ni moverla por WhatsApp.

Lo único que AgenIA hace es **ocupar el cupo** para no volver a venderlo ([`mirror-apply.service.ts:337-351`](../apps/api/src/mirror/mirror-apply.service.ts#L337-L351)). La cita como tal no existe en AgenIA: el documento del paciente llega en el evento, pero solo se escribe en una línea de log, y dar de alta al paciente quedó marcado en el propio código como trabajo pendiente ([líneas 359-367](../apps/api/src/mirror/mirror-apply.service.ts#L359-L367)).

Este plan cierra eso: **cuando llega una cita del HIS, AgenIA crea la cita y, si hace falta, el paciente**. A partir de ahí, lo que ya existe empieza a funcionar solo: los recordatorios no filtran por origen, así que una cita del hospital entra en el cron igual que una de WhatsApp.

**Lo que NO hace este plan:** no espeja historia clínica, no importa el padrón de pacientes del hospital en bloque (eso lo prohíbe el plan del espejo §5.3 y sigue prohibido), no toca los 19 médicos sin homologar (una cita de un médico no espejado se sigue ignorando, por diseño) y no arregla los cupos que AgenIA no tiene generados (`SIN_CUPO` sigue siendo un error a revisar).

## 2. Con qué se cuenta ya

Vale la pena decirlo porque cambia el tamaño del trabajo:

| Ya está | Dónde |
|---|---|
| El plan del espejo **permite** crear pacientes «uno a uno… cuando llega una cita del HIS» | `PLAN_ESPEJO_HOSPITAL.md` §5.3 |
| Crear la cita con origen `MIRROR` **no rebota al hospital** (anti-eco por transacción) | [`appointments.service.ts:160`](../apps/api/src/appointments/appointments.service.ts#L160) |
| Una cita `MIRROR` **se salta** el interruptor del médico y el chequeo de convenio (el HIS es la fuente de verdad) | [`appointments.service.ts:189-205`](../apps/api/src/appointments/appointments.service.ts#L189-L205) |
| Los recordatorios **no filtran por origen**: basta con que exista la cita y el paciente tenga WhatsApp | [`appointment-reminder.cron.ts:203`](../apps/api/src/appointment-reminder/appointment-reminder.cron.ts#L203) |
| El driver **sabe cancelar** una cita del hospital (no exige que la marca de origen sea de AgenIA) | [`index.ts:1368`](../apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts#L1368) |
| El HIS **tiene el teléfono** del paciente (`DE_TELE_PAC`) y el driver ya lo lee para los avisos masivos | [`index.ts:860`](../apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts#L860) |
| Crear paciente + su usuario ya tiene patrón probado (el del bot) | [`chatbot.service.ts:1873-1900`](../apps/api/src/chatbot/chatbot.service.ts#L1873-L1900) |

Y esto es lo que falta de verdad: **el evento de una cita entrante solo trae médico, servicio, documento, hora y estado** ([`index.ts:708-712`](../apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts#L708-L712)). Sin nombre ni teléfono no se puede crear un paciente al que luego se le escriba. De ahí sale la primera decisión.

## 3. El flujo propuesto

```
Hospital agenda en el HIS
        │
        ▼
Agente detecta el cambio ──► evento APPOINTMENT/INSERT
        │                    (+ nombre y teléfono, según D1)
        ▼
API, al aplicarlo:
        ├── ¿médico homologado y cupo generado?  no → como hoy (se omite / SIN_CUPO)
        ├── ¿el paciente ya existe en AgenIA?    (por documento, normalizando ceros)
        │        sí  → se reutiliza
        │        no  → se CREA (documento, nombre, teléfono; nada más)
        │        ambiguo → NO se crea: excepción en la bandeja (D3)
        ├── crea la cita (origen MIRROR, sin rebote al HIS)
        └── deja auditoría: «cita del HIS espejada; paciente creado/reutilizado»
        │
        ▼
A partir de aquí funciona lo de siempre:
  · el bot la muestra cuando el paciente escribe
  · el cron le manda el recordatorio
  · la bandeja y el rastreo la ven como cualquier cita
```

Casos que el diseño tiene que cubrir, todos ya presentes en el motor:

- **El hospital la cancela:** hoy el evento `CANCEL` libera el cupo; con la cita creada, además hay que cancelarla en AgenIA (y no rebotar al HIS).
- **El hospital la reagenda:** llega como cancelación + alta; se resuelve solo si cada una hace su parte.
- **Asistencia:** el evento `ATTENDANCE` ya sabe marcar asistencia; con cita creada, pasa a tener efecto.
- **Cupo ya ocupado por una pasada anterior** (la cita llegó antes de que existiera este plan): el cupo está marcado como ocupado y sin cita. Es el caso de D7.
- **Hora ilegible en el HIS** (5,7 % de las filas): esas citas no se pueden espejar; siguen fuera, como hoy.

## 4. Las decisiones

### D1. ¿De dónde sale el teléfono (y el nombre)?

Es la decisión que más condiciona todo: sin teléfono no hay recordatorio, que es justamente lo que se quiere.

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **(a) El HIS, en el mismo evento** | Añadir al detector de cambios del driver un `LEFT JOIN` a `PACIENTES` (nombre y `DE_TELE_PAC`) y dos campos al protocolo | Una sola pieza nueva; el alta es inmediata; es la única fuente con cobertura real | Paga el join en cada pasada del detector (hay que medirlo, como se midió la Fase 2); exige actualizar el agente |
| **(b) El HIS, a demanda** | Cuando aparece un documento que AgenIA no conoce, pedirle al agente los datos de ese paciente (mismo patrón que la consulta en vivo) | No toca el camino caliente; se paga solo por paciente nuevo | Más piezas; el alta queda asíncrona (la cita aparece segundos o minutos después) |
| **(c) Solo lo que AgenIA ya sabe** | Padrón de la EPS y conversaciones previas | Cero cambios en el agente | El padrón de esta clínica **solo exige la cédula**: el nombre y el teléfono suelen venir vacíos. La mayoría de citas quedaría sin recordatorio |

**Recomendación: (a).** Es un cambio en una consulta del driver, medible con el mismo método de la Fase 2, y es la única que cubre a los pacientes que nunca han escrito al bot — que son exactamente los de este problema. La (c) se puede dejar como respaldo cuando el HIS no tenga teléfono.

> **Cómo quedó implementada (2026-09-21).** La (a), con un matiz que abarata el «en contra»: el `JOIN` **no** va en la consulta caliente (recorre 90 días de `CITAS_MEDICAS` en cada vuelta). Los datos se piden en una consulta aparte, por clave primaria de `PACIENTES` y en lotes de 200, **solo para las citas nuevas de esa vuelta** — que casi siempre son ninguna. El evento llega igual de completo. Si esa consulta falla, la vuelta sigue y el alta se queda sin nombre ni teléfono: perder un recordatorio es molesto, perder la detección de cambios deja al hospital sin espejar.

### D2. ¿Se le escribe a alguien que nunca escribió al bot?

Un recordatorio a un teléfono que AgenIA tomó del HIS es un mensaje a quien no inició la conversación. Hay precedente en la casa: los avisos masivos de cancelación ya hacen eso con teléfonos del HIS.

| Opción | Consecuencia |
|---|---|
| **(a) Sí, con plantilla aprobada** | Es lo que da valor al plan. Hay que poder justificar la autorización de tratamiento de datos (Ley 1581) y ofrecer una salida («no deseo recibir recordatorios») |
| (b) Solo a quien ya interactuó con el bot | Cero riesgo nuevo, y casi ningún recordatorio nuevo: el caso típico es un paciente que agendó en ventanilla y nunca escribió |
| (c) Sí, pero solo al titular, nunca al teléfono del acompañante | Variante de (a) que reduce el riesgo de contarle la cita a un tercero |

**Recomendación: (a) + (c).** Recordatorio al **titular** únicamente; el teléfono del acompañante nunca se usa para esto (sí lo usan los avisos masivos, que es otra decisión ya tomada). Y dejar registrada la baja: si el paciente responde que no quiere, se marca y no se le vuelve a escribir.

**Esto lo decides tú, no yo:** es la clínica la que responde ante la Superintendencia por esos mensajes.

### D3. ¿Qué se hace cuando el documento es ambiguo?

En AgenIA la cédula es única **por clínica** (`@@unique([organizationId, cedula])`), pero el HIS y AgenIA no siempre escriben el mismo número: `0012345` y `12345` son la misma persona mal digitada en uno de los dos sistemas (ya hay un caso real documentado, y el rastreo lo detecta como «el mismo número con ceros a la izquierda distintos»).

| Opción | Consecuencia |
|---|---|
| **(a) Buscar por documento normalizado; si hay exactamente uno, reutilizar; si hay varios, NO crear y abrir excepción** | Nunca duplica ni mezcla dos personas; el caso raro lo resuelve una persona con la bandeja que ya existe |
| (b) Crear siempre un perfil nuevo si el documento no coincide exacto | Duplica pacientes y parte su historia en dos |
| (c) Unificar automáticamente los perfiles que difieren solo en ceros | Arregla el dato… o fusiona a dos personas distintas. Irreversible |

**Recomendación: (a).** Y que la excepción de la bandeja diga qué hacer: corregir el documento en el sistema donde esté mal escrito.

### D4. ¿Y si el teléfono ya es de otro paciente?

Pasa: una familia comparte celular. En AgenIA el teléfono **no** es único, pero el bot identifica al que escribe por su número.

| Opción | Consecuencia |
|---|---|
| **(a) Si el teléfono ya está en otro perfil con otro documento, no se le asigna** | No hay recordatorio para esa cita, y queda nota del porqué; a cambio, el bot nunca le muestra a alguien la cita de otro |
| (b) Asignarlo igual | Dos perfiles con el mismo número: el bot puede mostrar o cancelar la cita del familiar |
| (c) Asignarlo y que el bot pida siempre la cédula cuando un número tenga varios perfiles | Es lo correcto a futuro, pero es trabajo en el bot, no aquí |

**Recomendación: (a) ahora**, (c) como mejora posterior. Un recordatorio de menos es molesto; mostrarle a alguien la cita de otra persona es un incidente de datos.

### D5. ¿Qué puede hacer el paciente con esa cita por WhatsApp?

| Opción | Qué implica |
|---|---|
| (a) Solo verla | Lo más conservador; el texto debe decirle que para cambios llame al hospital |
| **(b) Verla y cancelarla** | El driver ya sabe cancelar en el HIS (pasa la cita a `CITAS_ANULADAS` con motivo y observación). Libera el cupo y el hospital lo puede volver a vender |
| (c) Verla, cancelarla y reprogramarla | Reprogramar es cancelar + crear: dobla la superficie de fallo justo en las citas que no nacieron en AgenIA |

**Recomendación: (b).** Y que la observación de la anulación en el HIS diga que la canceló el paciente por WhatsApp, para que en ventanilla se entienda de dónde salió.

### D6. ¿Con qué EPS queda la cita?

Hoy una cita `MIRROR` se crea sin EPS, y una cita sin EPS queda **fuera del alcance** de un agendador acotado a una EPS: no la vería en su bandeja ni en su agenda.

| Opción | Consecuencia |
|---|---|
| **(a) Heredar la EPS del perfil del paciente en AgenIA** | Simple y suele acertar; si el perfil no tiene EPS, queda sin ella |
| (b) Mapear el convenio del HIS (`epsNit`) a la EPS de AgenIA | Es el dato correcto, pero el evento entrante hoy no lo trae: otro campo más al protocolo |
| (c) Dejarla sin EPS | Los agentes acotados no ven las citas del hospital. Se arrastra un problema conocido |

**Recomendación: (a) ahora, (b) cuando se toque el protocolo por D1** (si ya se va a añadir teléfono y nombre, añadir el convenio cuesta poco).

### D7. ¿Qué se hace con lo que ya pasó?

Hay cupos ya marcados como ocupados por citas del hospital, sin cita en AgenIA.

| Opción | Consecuencia |
|---|---|
| **(a) Solo de aquí en adelante** | Nada raro, nada masivo. Las citas viejas siguen como hoy (el Rastreo las explica) |
| (b) Rellenar hacia atrás una ventana corta (por ejemplo, las próximas 72 h) con una pasada puntual | Cubre el arranque: los pacientes con cita mañana también reciben recordatorio |
| (c) Rellenar todo el histórico | Crea pacientes en bloque: es precargar el padrón del hospital por la puerta de atrás. **Descartado** |

**Recomendación: (a), y (b) como una sola corrida, decidida y vigilada**, el día del despliegue. La (c) contradice el principio de recolección mínima.

### D8. ¿El recordatorio dice que la cita la agendó el hospital?

Depende de D5: si el paciente **no** puede cancelar por WhatsApp (D5-a), el recordatorio tiene que decirle a dónde llamar, y eso es otra plantilla que aprobar en Meta. Si puede cancelar (D5-b), sirve la plantilla de recordatorio que ya existe y no hay nada que aprobar.

**Recomendación: D5-b + plantilla actual.** Menos piezas y menos trámite con Meta.

### D9. ¿Qué datos del paciente se guardan?

**Recomendación:** documento, nombre, teléfono y —solo si el evento los trae— fecha de nacimiento y sexo (el HIS los exige para crear pacientes, así que a veces vienen). Nada más: ni diagnóstico, ni dirección, ni correo. El nombre se guarda porque el recordatorio saluda por el nombre y el personal necesita identificar a quién llamar.

### D10. ¿Qué pasa si el paciente pide que lo borren?

Un perfil creado así nunca fue pedido por el paciente. **Recomendación:** que la baja sea posible sin tocar el HIS —se borra el perfil de AgenIA y se marca el documento para no volver a crearlo automáticamente— y que quede la nota de quién lo pidió. Esto es coherente con la retención que ya se definió (§12 #4 del plan del rastreo).

## 5. Qué hay que tocar

| Componente | Cambio | Tamaño |
|---|---|---|
| **Protocolo** (`@agenia/shared`) | Campos nuevos en el evento entrante: teléfono del paciente (y convenio, si D6-b) | Pequeño |
| **Driver del hospital** | El detector de cambios trae nombre y teléfono (D1-a). Hay que **medir** el costo de la consulta, como en la Fase 2 | Mediano |
| **Agente** | Recompilar el bundle y actualizarlo en el VPS del hospital | Despliegue |
| **API (`mirror-apply`)** | Resolver o crear el paciente y crear la cita; auditoría nueva; cancelación y asistencia con cita creada; excepción cuando el documento es ambiguo | **El grueso** |
| **API (recordatorios)** | Nada, si D5-b y D8 | — |
| **Web** | Que el Rastreo y la bandeja distingan «cita del hospital espejada»; el veredicto «El hospital agendó ese cupo y AgenIA no creó la cita» deja de aparecer para las nuevas | Pequeño |
| **Migración** | Marca de baja de recordatorios (D2) y marca de «no recrear» (D10) | Pequeña, aditiva |
| **Plantillas de Meta** | Ninguna nueva con D5-b y D8 | — |

## 6. Fases

1. **Protocolo, driver y medición.** El evento trae nombre y teléfono; se mide el costo de la consulta en el laboratorio del hospital. *Aceptación:* el detector de cambios no se vuelve más lento de lo que la clínica tolera (mismo criterio y misma tabla que la Fase 2 del rastreo).
2. **Alta en caliente en la API.** Crear o reutilizar paciente y crear la cita. *Aceptación:* una cita agendada en el HIS aparece en AgenIA en la siguiente pasada del agente, con su paciente, sin duplicar perfiles y sin rebotar al HIS. Documento ambiguo → excepción, no duplicado.
3. **Ciclo completo.** Cancelación desde el hospital, cancelación desde WhatsApp (D5-b) y asistencia. *Aceptación:* cancelar por WhatsApp una cita del hospital la anula en el HIS con su motivo, y el cupo vuelve a ofrecerse.
4. **Recordatorios.** *Aceptación:* un paciente que nunca escribió al bot recibe el recordatorio de una cita que agendó el hospital, y su baja se respeta.

Cada fase se verifica como las anteriores del rastreo: pruebas unitarias, Postgres real con dos réplicas, y escenarios nuevos en [`PRUEBAS_E2E.md`](drivers/cnt-sanvicente-anserma/PRUEBAS_E2E.md) (el escenario 1 cambia de resultado esperado: pasa a mostrar la cita).

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El detector de cambios se encarece y el espejo se atrasa | Medir antes (Fase 1); si no cuadra, pasar a D1-b (a demanda) |
| Duplicar pacientes o mezclar dos personas | D3-a: solo reutilizar cuando hay exactamente un candidato; lo demás, a la bandeja |
| Contarle una cita a quien comparte el celular | D4-a: no asignar un teléfono que ya es de otro perfil |
| Mensajes a quien no los autorizó | D2: decisión explícita de la clínica, plantilla aprobada, baja registrada, nunca al acompañante |
| Crear pacientes en bloque sin quererlo | D7: nada retroactivo salvo una corrida puntual y vigilada |
| Un paciente cancela por WhatsApp algo que el hospital considera firme | D5 es una decisión del hospital; si dice que no, D5-a y plantilla propia (D8) |

## 8. Lo que apareció al construirlo: el disparador del outbox

Dos defectos **preexistentes**, encontrados con la verificación contra Postgres real (una prueba de este plan los destapó; no los introdujo este cambio):

1. **El origen se guardaba vacío.** `fn_sync_outbox` leía `current_setting('agenia.sync_origin', true)` y hacía `COALESCE(v_origin, 'LOCAL')`. Ese `current_setting` devuelve `NULL` solo si el parámetro **nunca** se definió en la conexión; después de la primera transacción del espejo (que hace `SET LOCAL`), al terminar vuelve a la **cadena vacía**. Como las conexiones se reutilizan, todo lo que AgenIA escribiera después en esa misma conexión quedaba con `origin = ''`: ni local ni espejo. Hoy nada filtraba por ese campo, así que no se notaba; en cuanto se usara, esas citas no se habrían entregado nunca al hospital. Corregido con `COALESCE(NULLIF(v_origin, ''), 'LOCAL')`.
2. **El anti-eco no estaba aplicado.** El diseño decía «el dispatcher sabe no reenviarlo», pero ningún filtro miraba `origin`. Sin alta en caliente era inofensivo (cancelar en el HIS algo ya cancelado no hace nada); **con** alta en caliente, cada cita del hospital habría vuelto al hospital como un alta nueva, chocando con la que ya estaba. Ahora lo nacido en el HIS **nace entregado** (el disparador le pone `deliveredAt`), y el despachador además lo excluye en la consulta — en el `WHERE`, no después de leer: son las filas más viejas y taparían la ventana de entrega.

La migración corrige también los datos ya escritos: los eventos con origen vacío pasan a `LOCAL`, y lo nacido en el HIS que seguía pendiente se da por entregado.

## 9. Qué falta antes de producción

1. **Medir la consulta nueva en el hospital** (criterio de aceptación de la Fase 1): `sql/MEDICION_ALTA_EN_CALIENTE.sql` del driver. Son lecturas por clave primaria de `PACIENTES`, solo para las citas nuevas de cada vuelta.
2. **Desplegar en orden:** migración → API → **agente** (el evento nuevo lo produce el driver) → web.
3. **Decidir con el hospital si el paciente puede cancelar** por WhatsApp una cita que ellos agendaron (D5-b, ya implementado): si dicen que no, es un filtro en el flujo de cancelación del bot.
4. **Probar de punta a punta** con el escenario 1 de `PRUEBAS_E2E.md`, cuyo resultado esperado cambia: la cita del hospital ahora sí aparece en AgenIA.

## 10. Qué medir después

Con esto en producción, los datos que hoy justifican el plan deberían caer: la frecuencia del veredicto `CITA_DEL_HIS_NO_ESPEJADA` (campo `verdicts` de `PatientLookupLog`) y las consultas de tipo B del personal. Si no caen, algo del alta no está funcionando.

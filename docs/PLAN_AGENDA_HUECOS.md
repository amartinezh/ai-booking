# Agenda por huecos del hospital

**Estado: H1-H9 APROBADAS; H6 CERRADA CON PRUEBA (2026-10-06).** El usuario aprobó H1 … H9 el mismo día; H2, H6 y H8 con ajustes. La prueba en PRUEBAS cerró H6: la agenda del hospital lee `CITAS_MEDICAS`, así que lo que escribe el agente queda ocupado sin tocar `CITAS_DISPONIBLES` (H12 no hace falta). **El 2026-10-06 el usuario aprobó también H3 (b'), H10 y H11.** **Fase 1 CONSTRUIDA (2026-10-06, sin desplegar):** agente con modo «huecos» (`fuenteAgenda`), revisión de cruces antes de escribir (H11), alta en transacción y la marca `rechazoDelHis` en el acuse (para H10); `mapping.json` con `duracionPorMedico` (H2) y `fuenteAgenda: HUECOS`; `agent.env.example` con los ritmos de H7. **H10 CONSTRUIDA (2026-10-06, sin desplegar):** el bot pide unos segundos («estoy confirmando su cita con el sistema del hospital»), espera hasta 25 s a que el alta llegue al HIS y solo entonces confirma; si el HIS la rechaza (la API la anula al recibir `rechazoDelHis` y cierra el cupo) le ofrece elegir otra hora; si no hay respuesta, avisa que le escribe al quedar registrada y un barrido cada 10 s manda la confirmación final o el aviso de rechazo. Con espejo y `pushEnabled` apagado el bot no agenda (queda en «solo consultas»). Falta: desplegar la API, actualizar el agente y aplicar el mapeo.

**Alcance acordado:** el bot de AgenIA solo agendará **medicina general** (AP04, MD08, MDD1, MDD2, R001; servicio `S39141`, 20 min). Las demás agendas se siguen espejando (citas, recordatorios, ocupación), pero el bot no las vende.

Driver afectado: `cnt-sanvicente-anserma` (Hospital San Vicente de Paúl, Anserma). Relacionados: [PLAN_ESPEJO_HOSPITAL.md](PLAN_ESPEJO_HOSPITAL.md) (motor genérico), [MAPEO_HIS.md](drivers/cnt-sanvicente-anserma/MAPEO_HIS.md) (esquema del HIS).

## 1. Qué se pide

1. Que la agenda que AgenIA ofrece por el bot sea **la del hospital**, tal como el hospital la define: con sus duraciones, sus horas y sus bloqueos.
2. Que AgenIA sea **flexible**: si el hospital agenda a las 07:05 o con 40 minutos, AgenIA se acomoda; no al revés.
3. Que el bot **nunca ofrezca una hora que se cruce** con una cita real ni que no quepa en el tiempo libre.
4. Que no se pierda la integridad de los datos del hospital.

**Lo que NO hace este plan:** no cambia cómo el bot conversa ni cuántos cupos ofrece (`slotsOfferedCount`), no permite que un médico venda varios servicios por el bot (hoy cada médico tiene uno en AgenIA; ver §9) y no enciende el agendamiento por el bot: eso sigue siendo el interruptor «solo consultas» (`bookingEnabled`) y el envío al hospital (`pushEnabled`).

## 2. Cómo está hoy

**La rejilla.** El agente lee los turnos de `TURNOS_MEDICOS` (bloques como 06:30–13:50) y los parte en cupos de **20 minutos para todos los médicos** (`mappingJson.duracionMinutos = 20`, sin excepciones). Un cupo está ocupado si hay una cita en `CITAS_MEDICAS`. Ver `fetchAvailability` en [`index.ts`](../apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts).

**El arreglo flexible del 2026-10-06** (commit pendiente al escribir esto) ya cubre dos huecos de esa rejilla:

- Una cita del hospital que no cae en un cupo de AgenIA se aplica igual: AgenIA le crea un **cupo a la medida** con su duración real (`NU_DURA_CIT`).
- Un cupo de la rejilla que **se cruza** con una cita del hospital queda ocupado.

Eso evita perder citas y vender encima de citas. **Lo que no resuelve:** la rejilla sigue sin parecerse a la agenda real del hospital, así que el bot ofrecería horas que el hospital no ofrece y no ofrecería horas que el hospital sí tiene.

## 3. Lo que se midió en el HIS (2026-10-06, contra ESEHSVP)

Consultas de solo lectura en `docs/drivers/cnt-sanvicente-anserma/sql/`: [`DURACION_AGENDAS_SOLO_LECTURA.sql`](drivers/cnt-sanvicente-anserma/sql/DURACION_AGENDAS_SOLO_LECTURA.sql), [`DURACION_AGENDAS_2_SOLO_LECTURA.sql`](drivers/cnt-sanvicente-anserma/sql/DURACION_AGENDAS_2_SOLO_LECTURA.sql) y [`CITAS_DISPONIBLES_VERIFICACION_SOLO_LECTURA.sql`](drivers/cnt-sanvicente-anserma/sql/CITAS_DISPONIBLES_VERIFICACION_SOLO_LECTURA.sql).

### 3.1 La duración la decide el servicio, no el médico

| Servicio (código HIS) | Duración |
|---|---|
| Medicina general `S39141`, control de hipertensos `S39141-1`, nutrición `890206`, cita odontológica `SCITOD`, salud oral `SSAO` | 20 min |
| Lectura de exámenes `S39141-2` | 15 min |
| PyDT `890201-CI`, planificación familiar `I890305PL`, psicoterapia `S35104` | 30 min |
| Valoración y control por psicología, salud oral doble `997301-1`, odontología doble | 40 min |
| Educación individual por odontología `990203` | 10 min |

Por eso ninguna rejilla fija calza en las agendas que mezclan servicios: MD08, MDD1, MDD2, AP04 y R001 (15 y 20 min) caen en la rejilla de 20 solo entre el 54 % y el 80 % de las veces; PS06 y PS08 (30 y 40 min), entre el 62 % y el 65 %.

### 3.2 `CITAS_DISPONIBLES`: los huecos libres que el propio hospital calcula

| Columna | Qué es |
|---|---|
| `NU_TUME_CIDI` | Turno (`TURNOS_MEDICOS.NU_NUME_TUME`) |
| `CD_MED_CIDI` | Médico |
| `FE_FECH_CIDI` | Fecha |
| `FE_HOIN_CIDI` / `FE_HOFI_CIDI` | Inicio y fin del hueco (la parte de fecha es 1900-01-01) |
| `NU_DURA_CIDI` | Minutos del hueco |

No son cupos: son **tramos libres**. Un turno de 07:00 a 12:00 con dos citas puede tener un hueco de 07:00 a 10:20 (200 min) y otro de 10:40 a 12:00 (80 min).

- **Está al día.** Tiene datos hasta diciembre de 2027.
- **Cuadra.** En 156 de 166 turnos de los próximos 14 días (94 %), los minutos del turno son exactamente la suma de las citas y los huecos. En 76, 91-2, higiene oral, OD02, MD08 y NU02, el 100 %.
- **Cuadra en un día real.** MD08: los huecos son exactamente lo que queda entre citas (06:45–07:05, 08:45–08:50, 09:50–10:10, 12:40–13:00, 13:40–13:50). PS08: un solo hueco, 18:10–18:30.
- **Es barata de leer.** Tiene índices que empiezan por médico y fecha (`CD_MED_CIDI, FE_FECH_CIDI, …`).

### 3.3 Dónde no cuadra (6 %), y qué significa

1. **El hueco dice libre donde ya hay citas.** Por ejemplo, OD05 el 6-oct en la mañana: 10 citas y el turno entero figura libre. La tabla está **desactualizada** ahí. Una explicación posible: citas escritas por un camino que no recalcula los huecos. ESTADO.md ya registró que hay una segunda aplicación escribiendo en ESEHSVP. **Consecuencia: nunca confiar solo en la tabla; siempre restar las citas reales.**
2. **Hay menos libre de lo que dejan las citas.** Por ejemplo, MDD2 el 9-oct en la tarde: turno de 4 horas, 0 citas y solo 20 minutos libres. Parece **tiempo bloqueado** por el hospital. La rejilla de AgenIA no lo ve y ofrecería esas 4 horas; con los huecos se respeta solo.

### 3.4 Citas sin hora

`FE_HORA_CIT = 'YYYY/MM/DD N'` (12 caracteres): citas adicionales numeradas, sin hora. Casi todas ya atendidas, pero hay pendientes a futuro (OD02 32, OD07 29, PS06 11, OD05 8). No ocupan tiempo de agenda, y AgenIA no las puede ubicar ni enviarles recordatorio. Hoy el driver las ignora.

## 4. El diseño

### La idea en una línea

El agente deja de partir turnos y **lee los huecos libres del hospital, les resta las citas reales y los reparte en cupos de la duración del servicio que AgenIA vende para ese médico**. El resto del sistema (barrido, bot, panel, reserva) no cambia.

### El recorrido

```
CITAS_DISPONIBLES (huecos del hospital)  ─┐
                                          ├─► hueco efectivo = hueco − citas reales
CITAS_MEDICAS (citas con su NU_DURA_CIT) ─┘          │
                                                     ▼
                         cupos consecutivos de la duración del médico
                         (solo los que caben completos en el hueco)
                                                     │
                                                     ▼
                  POST /mirror/availability  (mismo protocolo, mismo barrido)
                                                     │
                                                     ▼
              ScheduleSlot ─► getAvailableSlots ─► el bot ofrece lo que el hospital tiene
```

**Ejemplo, MD08 (medicina general, 20 min), mañana:**

| Hueco del hospital | Cupos que AgenIA ofrece |
|---|---|
| 06:45–07:05 | 06:45 |
| 08:45–08:50 (5 min) | ninguno: no cabe |
| 09:50–10:10 | 09:50 |
| 12:40–13:00 | 12:40 |
| 13:40–13:50 (10 min) | ninguno |

Con la rejilla actual se ofrecerían 06:30, 06:50, 07:10…; casi ninguna existe en el hospital.

**Ejemplo, PS08 (psicoterapia, 30 min):** el único hueco es de 20 min (18:10–18:30), así que AgenIA **no ofrece nada**. Con la rejilla actual ofrecería las 18:10, y la sesión de 30 minutos no cabe.

### Qué no cambia

- `MirrorAvailabilityService` sigue igual. Ya respeta los cupos a la medida de las citas del hospital y la ocupación por cruce, y un cupo con cita viva nunca se borra.
- El bot y `getAvailableSlots` siguen igual: siguen leyendo `ScheduleSlot`.
- La reserva y la escritura al HIS siguen igual. La cita se escribe con la duración del cupo, que ahora es la del servicio (`NU_DURA_CIT` correcto).

### Por qué no otras opciones

- **Seguir con la rejilla y solo ajustar la duración por médico.** Arregla 91-1 y 91-2, pero no las agendas que mezclan servicios ni el tiempo bloqueado. El hospital seguiría teniendo horas que AgenIA no ve.
- **Calcular la disponibilidad en el momento, servicio por servicio, sin `ScheduleSlot`.** Es lo más fino: permitiría que un médico venda varios servicios. Pero cambia el bot, la reserva, el panel y la lista de espera. Queda para cuando haga falta (§9).
- **Confiar solo en `CITAS_DISPONIBLES`.** El 6 % desactualizado haría vender encima de citas. Restar siempre las citas cuesta poco y cierra ese hueco.

## 5. Qué hay que construir

### 5.1 Agente (`apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/`)

- `fetchAvailability`, modo «huecos»:
  - leer `CITAS_DISPONIBLES` por médico y rango de fechas, con los mismos bordes literales `'YYYYMMDD'` que ya se usan para que el índice sirva;
  - leer `CITAS_MEDICAS` con `NU_DURA_CIT` (ya se hace);
  - restar a cada hueco los intervalos de las citas, convertir a UTC y repartir en cupos consecutivos de la duración del médico, desde el inicio de cada tramo libre (H3);
  - descartar los tramos más cortos que la duración (H4);
  - quedarse solo con los cupos dentro de la ventana declarada (regla de siempre).
- El modo actual («turnos») se conserva detrás de un interruptor (H8). Es la vuelta atrás.
- Pruebas: los ejemplos reales de §3.2 y §3.3 como casos (MD08, PS08, OD05 desactualizado, MDD2 bloqueado), más bordes: hueco que cruza la ventana, hora ilegible, hueco de 0 minutos y citas solapadas.

### 5.2 Configuración (mapeo del driver)

- `duracionPorMedico` con la tabla de H2. Se escribe con `scripts/aplicar-mapping.ts`, como el resto del mapeo.
- `fuenteAgenda: 'TURNOS' | 'HUECOS'` (H8).

### 5.3 API

- Nada obligatorio. Opcional: mostrar en `/dashboard/espejo` qué fuente de agenda está activa y la duración de cada médico homologado.

### 5.4 Medición en sombra

Antes de encender, una corrida comparativa por médico y día: cupos con la rejilla contra cupos con los huecos, y horas que solo ofrece cada una. Se registra en `SyncAudit` sin escribir agenda (H8).

## 6. Las decisiones

### H1. ¿De dónde sale la agenda que ofrece el bot? — ✅ APROBADA: (a)

- **(a) Recomendado:** de los huecos del hospital (`CITAS_DISPONIBLES`) menos las citas reales.
- (b) De la rejilla de turnos actual, con el modo flexible y la duración por médico.
- (c) Disponibilidad calculada en el momento, por servicio (§4, por qué no).

(a) es la única que respeta los bloqueos y las horas reales del hospital sin rediseñar el bot.

### H2. ¿Qué duración tiene cada cupo? — ✅ APROBADA, con ajuste

**Decisión del usuario:** 91-1, 91-2, PS06 y PS08 de 30; HO02, HO03 y HO04 de 40; el resto de 20. **No hace falta confirmar con el hospital la salud oral simple o doble**: AgenIA solo venderá medicina general por el bot, así que las agendas de odontología no se ofrecen y su duración solo afecta la ocupación que se espeja.

Propuesta original:

**Recomendado:** la del servicio que AgenIA vende para ese médico (`DoctorProfile.serviceId`), medida en el HIS:

| Médico | Servicio en AgenIA | Duración | Bot hoy |
|---|---|---|---|
| 76 | Control hipertensos `S39141-1` | 20 | apagado |
| 91-1 | PyDT `890201-CI` | **30** | apagado |
| 91-2 | Planificación familiar `I890305PL` | **30** | apagado |
| ACO2 | Salud oral `SSAO` | 20 | apagado |
| AP04, MD08, MDD1, MDD2, R001 | Medicina general `S39141` | 20 | AP04, MDD1, MDD2 encendidos |
| HO02, HO03, HO04 | Salud oral **doble** `997301-1` | **40** | apagado |
| NU02 | Nutrición primera vez `890206` | 20 | apagado |
| OD02, OD05, OD07 | Cita odontológica `SCITOD` | 20 | apagado |
| PS06, PS08 | Psicoterapia `S35104` | **30** | apagado |

~~Para confirmar con el hospital~~ (descartado, ver arriba): HO02, HO03 y HO04 tienen asignada en AgenIA la «salud oral **doble**» (40 min), pero la mitad de sus citas son «salud oral» simple (20 min). ¿Cuál de las dos debe vender el bot?

### H3. ¿Cómo se reparte un hueco en cupos? — ✅ APROBADA: (b') (2026-10-06, reemplaza a (a))

**Decisión del usuario:** el bot ofrece los cupos de la **cuadrícula del turno**, como los muestra la agenda del hospital (06:30, 06:50…), que **caben enteros en un hueco libre** de `CITAS_DISPONIBLES` y **no se cruzan con ninguna cita real**.

**Lo que mostró la prueba (2026-10-06):** la Agenda Médica de la aplicación presenta MDD2 como una cuadrícula FIJA desde el inicio del turno (06:30, 06:50, 07:10 …). Para que el bot ofrezca exactamente las horas que ve la ventanilla, se propone **(b'):** ofrecer los cupos de la cuadrícula del turno que caben enteros dentro de un hueco de `CITAS_DISPONIBLES` y no se cruzan con ninguna cita real. 

- **(a) Recomendado:** cupos consecutivos desde el inicio del hueco (06:45, 07:05, …). Así queda el tiempo pegado a la última cita, que es como el hospital llena su agenda.
- (b) Alinear a la rejilla del turno (06:30 + múltiplos). Dejaría sin ofrecer huecos como 06:45–07:05.

### H4. ¿Qué pasa con un hueco más corto que la duración? — ✅ APROBADA: (a)

- **(a) Recomendado:** no se ofrece (el hueco de 5 min de MD08, los 20 min de PS08).
- (b) Se ofrece igual. Solo tendría sentido si el hospital acepta citas más cortas que su servicio. No lo recomiendo.

### H5. ¿Cómo se protege contra el 6 % desactualizado? — ✅ APROBADA: (a); (b) queda para después

- **(a) Recomendado:** restar siempre las citas reales de `CITAS_MEDICAS` a cada hueco, con su duración. Ya se leen en el mismo barrido, así que no hay costo extra.
- (b) Además, antes de confirmarle una cita al paciente, preguntar en vivo al HIS si el hueco sigue libre (la consulta en vivo ya existe para el rastreo). Agrega unos segundos y carga sobre la base del hospital. **Recomendado dejarlo para después**, si la medición muestra choques.

### H6. Cuando AgenIA escriba una cita en el HIS, ¿se actualiza `CITAS_DISPONIBLES`? — ✅ DECIDIDO: AgenIA NO toca los huecos del HIS (queda un punto por verificar)

**Decisión del usuario (2026-10-06):** AgenIA no hará nada sobre los huecos del HIS. Cuando el bot agende por WhatsApp o Telegram, el agente escribe la cita en `CITAS_MEDICAS` y su registro de auditoría (como hoy), y nada más. Casi no se agendará desde el panel de AgenIA: las citas llegan por el bot y se acomodan a los huecos que el HIS ya tiene.

**Evaluación.** El principio es correcto: es la huella mínima sobre una tabla interna del hospital, y del lado de AgenIA no hay riesgo, porque cada barrido resta todas las citas reales, incluidas las que escribió el bot. **El riesgo que queda está del lado del hospital y depende de un dato que hoy no tenemos:** si el HIS no recalcula `CITAS_DISPONIBLES` cuando aparece una cita escrita por fuera de su aplicación, la ventanilla seguiría viendo libre la hora que vendió el bot. A la misma hora exacta lo frena la llave del HIS (médico + hora + estado); 5 o 10 minutos después, dentro del mismo hueco, no lo frena nada: dos pacientes a la misma hora.

**Resultado de la consulta de catálogo (2026-10-06, en ESEHSVP como ADMIN):** no hay triggers en `CITAS_MEDICAS`, `CITAS_DISPONIBLES`, `TURNOS_MEDICOS` ni `CITAS_ANULADAS`; ningún procedimiento, función ni vista menciona `CITAS_DISPONIBLES`; el único procedimiento que inserta en `CITAS_MEDICAS` es `PA_PLANO_0256` (2020) y no recalcula huecos. **Conclusión: los huecos los calcula la aplicación del HIS, no la base.** Una cita escrita por el agente NO cierra el hueco en `CITAS_DISPONIBLES`. Falta saber si la pantalla de ventanilla mira `CITAS_MEDICAS` antes de ofrecer o asignar: prueba en dos partes, [`PRUEBA_H6_A_ESCRIBIR_EN_PRUEBAS.sql`](drivers/cnt-sanvicente-anserma/sql/PRUEBA_H6_A_ESCRIBIR_EN_PRUEBAS.sql) y [`PRUEBA_H6_B_REVISAR_Y_LIMPIAR_EN_PRUEBAS.sql`](drivers/cnt-sanvicente-anserma/sql/PRUEBA_H6_B_REVISAR_Y_LIMPIAR_EN_PRUEBAS.sql) (TI, en PRUEBAS, con la aplicación). Requisito del usuario: si el bot agenda, en el HIS ese tiempo debe quedar **no disponible**.

**Cómo se resuelve sin tocar nada (plan original):**

1. **Consulta de solo lectura del catálogo del HIS** — [`CITAS_DISPONIBLES_QUIEN_LA_MANTIENE_SOLO_LECTURA.sql`](drivers/cnt-sanvicente-anserma/sql/CITAS_DISPONIBLES_QUIEN_LA_MANTIENE_SOLO_LECTURA.sql). Si un trigger de `CITAS_MEDICAS` recalcula los huecos, el hueco se cierra solo venga la cita de donde venga: **riesgo resuelto, nada que construir.**
2. Solo si no hay trigger: prueba controlada en **PRUEBAS** hecha por TI desde SSMS —el mismo INSERT que hace el agente, mirar `CITAS_DISPONIBLES` y la pantalla de ventanilla—. No hace falta mover AgenIA de base (el usuario ofreció volver a PRUEBAS de forma controlada; queda como último recurso: exige repetir el corte y la foto del agente).
3. Si el HIS no recalcula, opciones sin tocar `CITAS_DISPONIBLES`: que el bot ofrezca solo el **primer** cupo de cada hueco (la ventanilla, que llena desde el inicio del hueco, chocaría con la llave del HIS en vez de agendar encima), o pedirle a CNT el procedimiento con el que agenda la ventanilla.

**`pushEnabled` sigue apagado hasta cerrar este punto.**

**✅ CERRADA CON PRUEBA (2026-10-06, PRUEBAS, aplicación CNT-Pacientes 20.4.0, usuario ROTANTE6):**

1. Partes A y B ([`PRUEBA_H6_A_ESCRIBIR_EN_PRUEBAS.sql`](drivers/cnt-sanvicente-anserma/sql/PRUEBA_H6_A_ESCRIBIR_EN_PRUEBAS.sql), [`PRUEBA_H6_B_REVISAR_Y_LIMPIAR_EN_PRUEBAS.sql`](drivers/cnt-sanvicente-anserma/sql/PRUEBA_H6_B_REVISAR_Y_LIMPIAR_EN_PRUEBAS.sql)): cita escrita como el agente, MDD2, 2026-10-08 06:30–06:50, paciente sintético 9990000090. `CITAS_DISPONIBLES` NO cambió en ningún momento (06:30–08:10 siguió «libre», ni siquiera al abrir la pantalla de agenda).
2. **Asistencial → Agenda (Agenda Médica):** el cupo de las 06:30 aparece **ocupado** (ícono ✖) y la barra inferior muestra la cita completa (9990000090, 08/10/2026 06:30, CONSULTORIO 14, MEDICINA GENERAL, S39141). **La aplicación arma la agenda desde `CITAS_MEDICAS`**, no desde `CITAS_DISPONIBLES`.
3. La cuadrícula de MDD2 es fija cada 20 min desde el inicio del turno: desde esa pantalla no se puede agendar a una hora intermedia (06:40). A la misma hora lo impide la llave del HIS.
4. El doble clic para asignar respondió «Su perfil de usuario, no permite esta operación»: permiso de ROTANTE6, no del cupo.
5. Limpieza: 1 cita borrada, 0 citas de ventanilla, 2 pacientes sintéticos borrados, «Limpio.».

**Conclusión:** lo que agende el bot queda **no disponible** en la agenda del hospital sin tocar `CITAS_DISPONIBLES`. El requisito del usuario se cumple con H10 + H11; **H12 no hace falta.** Hallazgo de paso: la casilla «Consultar Citas Extras» de la agenda confirma que las citas sin hora (§3.4) son las «citas extra» de la aplicación.

Propuesta original:

**Esta decisión vale con o sin este plan.** Si el agente inserta en `CITAS_MEDICAS` y el HIS no recalcula los huecos, la aplicación del hospital seguiría mostrando como libre la hora que AgenIA vendió, y la ventanilla podría agendar encima. El caso OD05 (§3.3) podría ser justamente eso.

- **(a) Recomendado:** probarlo primero en **PRUEBAS**. Escribir una cita con el agente y mirar si cambia `CITAS_DISPONIBLES` y qué muestra la pantalla de la ventanilla.
  - Si el HIS recalcula solo, no hay nada que hacer.
  - Si no recalcula, pedirle a CNT el procedimiento correcto: un procedimiento almacenado del HIS que agende «como la ventanilla», o su aval para que el agente actualice `CITAS_DISPONIBLES` en la misma transacción.
- (b) Que el agente actualice `CITAS_DISPONIBLES` sin consultarlo. **No recomendado**: es una tabla interna del HIS.

(Original: hasta resolver H6, `pushEnabled` se queda apagado — se mantiene.)

### H10. ¿El bot espera la confirmación del hospital antes de confirmarle al paciente? — ✅ APROBADA (2026-10-06)

**Decisión del usuario:** mientras se registra, el bot le dice al paciente que espere unos segundos porque se está confirmando su cita; **la confirmación final solo se entrega cuando es 100 % seguro que la cita está en AgenIA y en el HIS.** Si no hay respuesta a tiempo, el bot NO confirma: avisa que la está terminando de registrar y confirma (o le ofrece otras horas) en un segundo mensaje cuando llega el resultado.

**Propuesta del usuario (2026-10-06):** que el bot no le diga «tu cita quedó» hasta que quede registrada en AgenIA **y** en el HIS.

**Hoy:** el bot confirma apenas reserva en AgenIA; la cita viaja después por la cola (en la prueba de Telegram del 2026-10-03 llegó al HIS en menos de 1 s, con el agente sondeando cada 5 s).

**Recomendado:**

1. Tras reservar, el bot dice «Estoy registrando tu cita en el hospital…» y espera el resultado del agente (el evento de la cola entregado o fallido), hasta ~25 s.
2. **Entregado** → confirma.
3. **El HIS la rechaza** (la hora ya está tomada, o se cruza con otra cita: ver H11) → la cita se anula en AgenIA sin enviar nada al HIS y el bot ofrece otras horas.
4. **No hay respuesta a tiempo** (agente caído, HIS inalcanzable) → el bot dice que la está terminando de registrar y que le escribe en minutos; cuando llega el resultado, segundo mensaje (mismo patrón que `botFollowupAt` de la consulta de citas). Si al final falla, se le avisa y se le ofrecen otras horas.
5. Con `pushEnabled` apagado nunca habría confirmación: agendar por el bot exige el envío encendido (se valida al encender `bookingEnabled`).

Hace innecesaria la verificación en vivo de H5 (b): la escritura misma es la verificación.

### H11. Antes de escribir, ¿el agente verifica que la hora no se cruce con otra cita del HIS? — ✅ APROBADA (2026-10-06)

Hoy el agente solo depende de la llave del HIS (médico + hora + estado): frena la MISMA hora, no una cita que empieza 5 o 10 minutos antes o después.

**Recomendado:** en la misma transacción del INSERT, leer las citas de ese médico ese día (con bloqueo de rango, `UPDLOCK, HOLDLOCK`) y rechazar si alguna se cruza con `[inicio, inicio + duración)`. Solo lee `CITAS_MEDICAS`; no toca `CITAS_DISPONIBLES`. Con H10, el paciente se entera en el momento y elige otra hora.

### H12. ¿Cómo se cierra el hueco en el HIS sin tocar `CITAS_DISPONIBLES`? — ✅ NO HACE FALTA (la prueba de H6 mostró que la agenda lee `CITAS_MEDICAS`)

| Resultado de la prueba en PRUEBAS | Qué se hace |
|---|---|
| La ventanilla mira `CITAS_MEDICAS` y no deja asignar encima | Nada más: H10 + H11 bastan. |
| La ventanilla solo mira `CITAS_DISPONIBLES` | No se cumple «en el HIS queda no disponible» sin tocar la tabla. Opciones: (a) el bot ofrece solo el **primer cupo de cada hueco** —la ventanilla llena desde el inicio del hueco y chocaría con la llave del HIS en vez de agendar encima—; (b) pedirle a CNT cómo agenda la ventanilla para replicarlo; (c) que el usuario reconsidere permitir que el agente actualice `CITAS_DISPONIBLES` igual que lo hace la aplicación. Decisión del usuario con el resultado en la mano. |

### H7. ¿Cada cuánto se lee la agenda? — ✅ APROBADA: (a), cada 5 minutos los próximos 7 días

- **(a) Recomendado:**
  - repaso cercano cada **5 minutos** para los próximos **7 días** (hoy: cada 15 min, 14 días);
  - un repaso cada 15 minutos para los días 8 a 14;
  - el completo, una vez al día.
  Los índices de §3.2 lo hacen barato, y un hueco recién tomado en ventanilla deja de ofrecerse antes.
- (b) Dejar los ritmos actuales.

### H8. ¿Cómo se enciende y cómo se vuelve atrás? — ✅ APROBADA, con ajuste

**Decisión del usuario:** se sigue conectado al HIS real **en solo lectura** (`pushEnabled` apagado, bot en «solo consultas») y se observa el comportamiento varios días antes de abrir nada. La sombra de huecos contra rejilla se corre dentro de esa observación.

Propuesta original:

**Recomendado:**

1. Interruptor `fuenteAgenda` en el mapeo (`TURNOS` por defecto).
2. **Al menos 3 días en sombra**: se calcula con huecos y se compara contra la rejilla sin escribir nada.
3. Revisión de la comparación contigo y con el hospital.
4. `HUECOS`.

Volver atrás es cambiar el interruptor: el siguiente barrido rehace la agenda desde los turnos y conserva los cupos con cita viva.

### H9. ¿Qué se hace con las citas sin hora? — ✅ APROBADA: (a)

- **(a) Recomendado:** seguir ignorándolas para la agenda, porque no ocupan tiempo. Informar cuántas hay por médico en la bandeja o en el panel del espejo, para que el hospital sepa que esos pacientes no tendrán recordatorio de AgenIA.
- (b) Ignorarlas en silencio.

## 7. Que no falle

- **Nada de esto escribe en el HIS.** Es solo lectura de `CITAS_DISPONIBLES` y `CITAS_MEDICAS`.
- **Sombra antes de encender (H8)**, y vuelta atrás con un interruptor.
- **Las reglas del barrido no cambian:** un cupo con cita viva nunca se borra ni se libera; un cupo a la medida de una cita del hospital se respeta.
- **Defensa doble:** el hueco del hospital, menos las citas reales (H5).
- **Pruebas con los casos reales medidos.** Prueba de mutación de cada regla nueva, como se hizo el 2026-10-06.
- **Prueba en PRUEBAS antes de ESEHSVP:** misma consulta, misma comparación.

## 8. Fases

| Fase | Qué | Escribe en el HIS |
|---|---|---|
| 0 | H6: consulta del catálogo en ESEHSVP (solo lectura); solo si no hay trigger, prueba de TI en PRUEBAS | No (y en PRUEBAS, solo si hace falta) |
| 1 | Driver en modo «huecos» con interruptor + pruebas; `duracionPorMedico` de H2 | No |
| 2 | Sombra ≥ 3 días en ESEHSVP; informe de comparación | No |
| 3 | Encender `HUECOS`; ritmos de H7 | No |
| 4 | Según H6: si el HIS no recalcula, primer cupo por hueco o procedimiento de CNT (AgenIA no toca `CITAS_DISPONIBLES`) | Solo citas, nunca huecos |
| 5 | Tras la observación: encender `pushEnabled` y, médico por médico, el agendamiento de medicina general por el bot | Sí (solo `CITAS_MEDICAS` + auditoría) |

Las notificaciones (recordatorios) **no dependen de este plan**: trabajan sobre citas que ya existen.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| `CITAS_DISPONIBLES` desactualizada (6 %) | Restar siempre las citas (H5); medir en sombra |
| AgenIA escribe y el HIS no recalcula los huecos → la ventanilla agenda encima | H6: consulta del catálogo (trigger sí/no); si no, prueba en PRUEBAS y primer cupo por hueco. `pushEnabled` apagado hasta cerrarlo |
| La agenda se mueve entre que el bot ofrece y el paciente confirma | Ya está cubierto: la reserva revisa que el cupo siga libre (`SLOT_TAKEN_OR_INVALID`) y el bot ofrece otro |
| Un médico vende un solo servicio en AgenIA (HO02-04: ¿simple o doble?) | H2; si hace falta vender varios servicios por médico, se planifica la opción (c) de H1 |
| Cambiar el ritmo de lectura carga la base del hospital | Consultas por índice y acotadas por fecha; medir la duración de cada pasada en sombra |

## 10. Qué hace falta de fuera

- **TI del hospital:** correr la consulta de H6 en ESEHSVP (con un usuario que tenga VIEW DEFINITION); solo si hace falta, la prueba en PRUEBAS; actualizar el agente en la VM en la Fase 1.
- **Hospital:** revisar la comparación de la observación.
- **CNT, solo si H6 lo exige:** el procedimiento con el que agenda la ventanilla.

## 11. Bitácora

- **2026-10-06 (H10)** — `ConfirmacionHisService` (estado de la cita en el HIS: alta entregada = CONFIRMADA, cita anulada = RECHAZADA; espera de 25 s; pendientes en Redis con reclamo compare-and-set), `MirrorDispatchService.markRejectedByHis` (anula la cita y cierra el cupo con origen MIRROR, cierra el evento, auditoría CONFLICT), tres textos nuevos del bot y el barrido de confirmaciones pendientes. API 2.613 pruebas; mutación de cada regla detectada.
- **2026-10-06 (Fase 1)** — Agente: `fuenteAgenda` TURNOS/HUECOS (un cupo de la cuadrícula del turno queda libre solo si cabe entero en un hueco de `CITAS_DISPONIBLES` y no se cruza con citas); H11 con `UPDLOCK, HOLDLOCK` y el alta en transacción; `rechazoDelHis` en el resultado del driver y en el acuse (aditivo: una API vieja lo ignora y lo cuenta como fallo). 579 pruebas del agente; mutación de cada regla nueva detectada. Decisión de implementación: sin «modo sombra» aparte — con el bot apagado, encender HUECOS no afecta a pacientes y la observación compara la agenda resultante contra la del hospital; volver atrás es poner TURNOS.
- **2026-10-06 (aprobaciones finales)** — El usuario aprobó H3 (b'), H10 (espera con mensaje «estamos confirmando tu cita» y confirmación final solo con la cita en AgenIA y en el HIS) y H11.
- **2026-10-06 (cierre)** — Prueba H6 en PRUEBAS con la aplicación: la Agenda Médica muestra ocupada la cita escrita como el agente (lee `CITAS_MEDICAS`); `CITAS_DISPONIBLES` no cambia y no hace falta tocarla. H12 descartada. Se propone H3 (b') porque la agenda de la aplicación es una cuadrícula fija desde el inicio del turno. En producción, desde el despliegue del arreglo flexible (16:29 UTC): 0 errores de entrada y el primer cupo creado a la medida (MD08, 7-oct).
- **2026-10-06 (noche)** — Consulta de catálogo: nada en la base mantiene `CITAS_DISPONIBLES` (lo hace la aplicación). Requisito del usuario: lo que agende el bot debe quedar no disponible en el HIS, y el bot debe esperar el registro en el HIS antes de confirmar. Se agregan H10-H12 y la prueba H6 en PRUEBAS (partes A y B; el primer intento no escribió nada porque se corrió completo con las variables sin llenar).
- **2026-10-06 (tarde)** — El usuario aprobó H1-H9. Ajustes: el bot solo venderá medicina general (H2 sin confirmar odontología); AgenIA no tocará `CITAS_DISPONIBLES` (H6) — queda verificar con una consulta de catálogo si el HIS recalcula los huecos solo; observación en solo lectura sobre el HIS real (H8). Se agrega `CITAS_DISPONIBLES_QUIEN_LA_MANTIENE_SOLO_LECTURA.sql`.
- **2026-10-06** — Plan escrito tras medir en ESEHSVP la duración real por servicio y verificar `CITAS_DISPONIBLES` (94 % cuadra al minuto; los ejemplos MD08 y PS08 cuadran hueco por hueco). Antes, el mismo día: arreglo flexible (cupo a la medida + ocupación por cruce). Decisiones H1-H9 pendientes.

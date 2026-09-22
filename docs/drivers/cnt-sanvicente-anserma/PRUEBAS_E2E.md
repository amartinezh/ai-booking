# Pruebas de punta a punta antes de producción — San Vicente de Paúl (Anserma)

Veintidós escenarios, con documentos **sintéticos**, que recorren lo que AgenIA hace con el HIS: citas que nacen en el hospital —y el paciente que se crea con ellas—, citas que nacen por WhatsApp, cancelaciones de los dos lados, fallos del agente y del hospital, la bandeja de sincronización, la consulta en vivo y los permisos del panel.

| Archivo | Para qué |
|---|---|
| [`sql/PRUEBAS_E2E_1_PREPARAR.sql`](sql/PRUEBAS_E2E_1_PREPARAR.sql) | Deja el HIS (`PRUEBAS`) listo: 21 pacientes y las citas «del hospital» |
| [`sql/PRUEBAS_E2E_2_PASOS.sql`](sql/PRUEBAS_E2E_2_PASOS.sql) | Cinco acciones del hospital que se corren **durante** la prueba (A a E) |
| [`sql/PRUEBAS_E2E_0_AGENIA_POSTGRES_PREPARAR.sql`](sql/PRUEBAS_E2E_0_AGENIA_POSTGRES_PREPARAR.sql) | **PostgreSQL.** Da de alta los 21 documentos en el padrón **sin tocar el padrón real**, y homologa al médico de la campaña si hace falta |
| [`sql/PRUEBAS_E2E_VERIFICAR.sql`](sql/PRUEBAS_E2E_VERIFICAR.sql) | **Solo lectura.** Qué quedó registrado en el HIS: pacientes, citas, el convenio campo a campo, cancelaciones y el cuadro de mando por escenario |
| [`sql/PRUEBAS_E2E_3_LIMPIAR.sql`](sql/PRUEBAS_E2E_3_LIMPIAR.sql) | Deja `PRUEBAS` (el HIS) como estaba |
| [`sql/PRUEBAS_E2E_4_AGENIA_POSTGRES_LIMPIAR.sql`](sql/PRUEBAS_E2E_4_AGENIA_POSTGRES_LIMPIAR.sql) | **PostgreSQL.** Deja AgenIA como estaba: borra los pacientes que creó el alta en caliente y el padrón de prueba |
| [`padron/e2e/padron_e2e_eps_a.csv`](padron/e2e/padron_e2e_eps_a.csv) | Padrón de prueba, EPS A (19 documentos) |
| [`padron/e2e/padron_e2e_eps_b.csv`](padron/e2e/padron_e2e_eps_b.csv) | Padrón de prueba, EPS B (2 documentos) |

Los guiones del HIS se verificaron contra un SQL Server con el esquema real y un login **en español** (como el del hospital): las guardas rechazan los parámetros malos, la escritura es de todo o nada, un segundo intento se niega, los pasos se deshacen si afectan una fila de más, y la limpieza borra solo lo sintético y deja intacto lo real.

Lo añadido para el alta en caliente se verificó igual el **2026-09-22**, recorriendo el ciclo completo contra un SQL Server 2022 con el esquema del hospital: PREPARAR valida sin escribir y luego escribe **21 pacientes y 70 citas**; el teléfono del probador queda en las dos fichas y en ninguna más; cuando el médico no tiene turno el día del recordatorio, **avisa y sigue** en vez de abortar; si el día del recordatorio coincide con el de prueba, elige un cupo distinto de los cuatro reservados (y hay una guarda que detiene el guion si dos citas del plan pidieran el mismo cupo); los pasos **D** y **E** entran por el primer cupo libre del turno, sin pisar los reservados; el guion de verificar enseña las cinco partes y su cuadro de mando pasa a `OK` a medida que cada paso corre; y la limpieza deja **cero** filas sintéticas dejando intacto lo que ya estaba.

El cuarto —el de AgenIA— se verificó el 2026-09-21 contra un **PostgreSQL real** con el esquema de producción y el disparador del outbox puestos: alcanza los cuatro perfiles sintéticos (incluido el `0009990000022`, por los ceros a la izquierda) y **no toca** al paciente real sembrado al lado; se **niega a borrar** mientras quede una cita de prueba sin cancelar; libera el cupo que quedó ocupado sin cita; y los tres eventos de outbox que genera nacen con origen `MIRROR` y entregados, así que **ninguna de sus escrituras viaja al hospital**.

---

## Por qué documentos sintéticos y no del padrón real

Los 22 documentos son `9990000001` … `9990000022`: diez dígitos que empiezan por 999, un rango que no usan las cédulas colombianas. Probar con pacientes **reales** tendría dos efectos que no se pueden deshacer: el bot y los recordatorios **les escribirían por WhatsApp**, y sus historias en el hospital quedarían con citas inventadas. La variedad del padrón real —régimen, ceros a la izquierda, edad, nombres compuestos, tildes y eñes, EPS distintas— está reproducida en los sintéticos.

Los padrones de prueba van **sin teléfono** a propósito: así ningún mensaje sale a nadie por el padrón. Las pruebas por WhatsApp se hacen escribiendo desde el teléfono del probador y dando la cédula sintética.

### 🚨 El padrón de prueba NO se sube por la pantalla de importar

**«Importar corte del padrón» reemplaza, no añade.** Todo afiliado que no venga en el archivo queda `isActive = false` (`deactivateAbsent`, en `apps/web/app/dashboard/padron/padron-service.ts`). Subir un CSV de 19 documentos a Salud Total desactivaría a sus **9.153 afiliados reales**, y desde ese momento cualquier paciente de verdad recibiría «su documento aún no figura dado de alta». La pantalla avisa cuando la baja pasa del 10 %, pero ese aviso se puede confirmar y seguir adelante.

Por eso el alta va con [`sql/PRUEBAS_E2E_0_AGENIA_POSTGRES_PREPARAR.sql`](sql/PRUEBAS_E2E_0_AGENIA_POSTGRES_PREPARAR.sql), que inserta 21 filas y nada más, con `importId = NULL` — lo que el esquema documenta como «alta manual». Trae una red de seguridad de regalo: si alguien olvida la limpieza, el siguiente corte real de esa EPS los desactiva por ausentes.

**Y tampoco sirve crear una «EPS de prueba»:** el convenio de facturación se resuelve por NIT + régimen contra el `mappingJson`, y con un NIT que no esté ahí `resolveConvenio` **lanza** — ninguna reserva por WhatsApp llegaría al HIS y los escenarios 12, 13 y 17 no se podrían probar. Los documentos de prueba van en **EPS reales** justamente para que la cita se escriba con el convenio que el hospital usa de verdad, que es lo que la PARTE 3 del guion de verificar comprueba. Los CSV de `padron/e2e/` se conservan como la lista de referencia de qué documento va en qué EPS.

**Con una excepción, y es deliberada.** El alta en caliente crea el paciente con el teléfono que encuentra en la **ficha del HIS** y le manda el recordatorio: sin un móvil de verdad ahí no se puede probar ni el recordatorio ni la regla del teléfono compartido. Por eso `PRUEBAS_E2E_1_PREPARAR.sql` pide `@TEL_PRUEBA` —**el móvil del probador**— y lo escribe en dos fichas: la del paciente 1 y la del 21. A ese número van a llegar WhatsApps de verdad. El guion se niega a correr si ese número ya es de algún paciente del hospital.

---

## Antes de empezar

### 0. Comprobar que `PRUEBAS` todavía tiene agenda futura — ✅ medido el 2026-09-22

**Sí la tiene: 1.062 turnos útiles desde hoy hasta el 2027-09-30.** Se corrió la consulta de apoyo del guion con el filtro del driver (`ISNULL(NU_TIPO_TUME,0)=0 AND ISNULL(ID_DISP_TUME,'1')='1'`) y los 1.062 turnos futuros son **todos** utilizables por AgenIA. La campaña se puede ejecutar.

**Esto corrige una conclusión apresurada.** El día anterior, al ver que `PRUEBAS` dejó de recibir citas el 11 de septiembre (`sql/MEDICION_ALTA_EN_CALIENTE.sql`, PARTES E y F), se supuso que `TURNOS_MEDICOS` estaría congelada igual y que eso explicaba el hallazgo del 2026-09-17 («el único médico activo no tiene cupos futuros»). **No es así:** la tabla de turnos tiene agenda publicada hasta un año adelante, porque el hospital la publica con mucha anticipación y lo que hay se escribió antes del corte. Así que aquel hallazgo era de **ese médico en concreto**, no de la copia. Las dos cosas son ciertas a la vez: no entran citas nuevas desde el 11, y hay agenda futura de sobra.

Aun así conviene correr la consulta antes de cada campaña, porque de ella salen los parámetros:

- **Si devuelve turnos** en el rango de `@DIAS`: adelante.
- **Si sale vacía o `utiles_para_agenia` es 0**: la campaña no se puede correr. Hay que arreglar el feed de `PRUEBAS` con el hospital, o apuntar el agente al catálogo vivo (`ESEHSVP`), que requiere que TI cree allá el usuario `agenia_sync` — hoy solo existe en `PRUEBAS`.

Y no olvidar lo que sigue siendo verdad: **las citas de `PRUEBAS` están 11 días atrasadas**. Para la campaña no estorba (los escenarios traen sus propias citas), pero el agente de producción apuntado ahí no espeja nada real.

### 1. Saber a qué base apunta el agente de producción — decide dónde se prueba

Corra solo la **PARTE 0** de `PRUEBAS_E2E_1_PREPARAR.sql`. Muestra en qué base está conectada la sesión de `agenia_sync`.

- **Si dice `PRUEBAS`**: esa es la base que AgenIA usa en producción. La prueba se hace contra el sistema real, lo cual es lo más fiel, pero con dos consecuencias: las citas de prueba del día de prueba **ocupan cupos reales** que el bot deja de ofrecer hasta la limpieza, y los escenarios 14 a 16 detienen el agente de todos. Hágalo en un día de prueba lejano (`@DIAS`) y fuera de la hora pico. Y **lea el primer bloqueante de la lista de producción**: `PRUEBAS` es una copia, no el catálogo vivo.
- **Si dice `ESEHSVP`** (u otra): lo que se prepare en `PRUEBAS` no lo ve el AgenIA de producción. La prueba necesita un AgenIA de pruebas cuyo espejo apunte a `PRUEBAS`.

### 2. Lo que tiene que estar desplegado

En este orden: **migración → API → agente → web**, con la Fase 3 (vigilante y bandeja), la consulta en vivo y los arreglos de permisos. `./checkHealth.sh` y `./checkHealthAgente.sh` sin fallos.

### 3. Lo que hay que configurar

| Qué | Dónde | Para qué escenarios |
|---|---|---|
| Número del agendador = un **teléfono de pruebas** | Bandeja de sincronización → Configurar avisos | 14, 15, 16 |
| Número de **respaldo** = un **segundo teléfono de pruebas** | Bandeja de sincronización → Configurar avisos | 14 (recordatorio) |
| `@TEL_PRUEBA` = un móvil del probador **distinto** del que use para escribirle al bot | Parámetro de PREPARAR | 1, 1b, 21 |
| Plantilla «Aviso al agendador» aprobada en Meta | Configuración → plantillas | 14, 15, 16 |
| Plantilla «Confirmación de una cita del hospital» aprobada en Meta | Configuración → plantillas | panel (confirmación fuera de 24 h) |
| Consulta en vivo **encendida** en la clínica (`lookupEnabled`) | SQL en la nube (`CONSULTA_EN_VIVO.md`) | 3, 5, 6, 7, 8, 9, 11, 16 |
| Dos EPS elegidas en AgenIA: **EPS A** y **EPS B** | Al subir cada padrón | todos; 17 y 18 para el alcance |
| Un usuario **BOOKING_AGENT acotado a la EPS A** | Usuarios | pruebas del panel |
| Un usuario **DOCTOR** del médico homologado | Usuarios | pruebas del panel |

Si la consulta en vivo **no** va a salir a producción, enciéndala solo para la prueba y apáguela al terminar. Sin ella, las partes marcadas **(en vivo)** de la tabla no se pueden comprobar.

**Por qué hacen falta dos móviles del probador.** El bot identifica a quien escribe **por su número**. Como `@TEL_PRUEBA` queda en la ficha del paciente 1, en cuanto el alta en caliente corra ese número **es** el paciente 9990000001 para AgenIA. Si el probador usara ese mismo teléfono para hacerse pasar por el 9990000013, el bot lo saludaría como el 1 y los escenarios de WhatsApp saldrían mal. Así que:

| Teléfono | Papel |
|---|---|
| **A** — el que escribe al bot | Con él se hacen los escenarios de WhatsApp dando la cédula sintética de cada uno |
| **B** — `@TEL_PRUEBA` | Es el paciente 1. Recibe su recordatorio y responde «no quiero recordatorios» (1b) |
| **C** y **D** | Agendador y respaldo de la bandeja. Pueden ser de personal del hospital |

🚨 **Ninguno de los cuatro puede ser el número de la clínica** — el de la cuenta de empresa de WhatsApp, del que salen todos los envíos. El 2026-09-22 se puso ese número como `@TEL_PRUEBA` y el recordatorio no llegó nunca: Meta no entrega un mensaje que la cuenta se manda a sí misma. Además deja un `PatientProfile` cuyo WhatsApp es el número del remitente, que es una bomba de relojería para cualquier lógica que identifique al paciente por su número.

Nada lo detecta hoy: el guion del HIS no conoce ese número, y AgenIA tampoco, porque `WhatsappAccountConfig.displayPhoneNumber` está **vacío**. Vale la pena llenarlo —es el número tal como lo muestra Meta— para poder añadir la comprobación más adelante.

### 4. Los parámetros de PREPARAR

- `@MED_HOMOLOGADO`: un médico que esté en **Espejo → Homologación** y que tenga turno el día de prueba (la consulta de apoyo del guion los lista). Conviene que además tenga turno **mañana**, por lo de `@DIAS_RECORDATORIO`.
- `@MED_SIN_HOMOLOGAR`: un médico que aparezca en **Espejo → Homologación** como **sin homologar** (hoy hay 19). Tiene que estar en esa lista, no solo en el HIS: de ahí sale el selector de médicos del Rastreo.
- `@DIAS`: el día de prueba = hoy + `@DIAS`. Dentro de lo que el bot ofrece (≈ 7 a 13 días).
- `@TEL_PRUEBA`: el móvil del probador, 10 dígitos empezando por 3. **Obligatorio** (ver arriba).
- `@DIAS_RECORDATORIO`: el día de la cita del escenario 1b. **1 = mañana**, y ese es el valor bueno: el cron manda el recordatorio 24 **horas hábiles** antes y corre cada 15 minutos, así que con la cita mañana el recordatorio sale durante la sesión de prueba; con la del día de prueba no saldría hasta dentro de una semana. Si el médico no tiene turno con cupo libre ese día, el guion **avisa y sigue**: el 1b se queda sin preparar y todo lo demás no.

Corra primero con `@CONFIRMO = 0`: valida todo y muestra la vista previa sin escribir. Luego con `@CONFIRMO = 1`. Anote la tabla final (el día de prueba y los cupos).

---

## Orden de ejecución

| Fase | Qué | Tiempo aprox. |
|---|---|---|
| 0 | `PRUEBAS_E2E_1_PREPARAR.sql` | 5 min |
| 1 | Dar de alta los 21 documentos con `PRUEBAS_E2E_0_AGENIA_POSTGRES_PREPARAR.sql`. **NO por la pantalla de importar padrón** — ver el aviso de abajo | 5 min |
| 2 | Esperar a que el agente tome las altas del hospital. Comprobar en **Espejo → Auditoría**, dirección `INBOUND` | 5–10 min |
| 3 | Escenarios **de lectura**: 1, 2, 3, 5, 6, 7, 8, 9, 11 | 30 min |
| 4 | **Alta en caliente**: crear a mano los dos perfiles del 22, correr el **PASO D** y el **PASO E**, y esperar una vuelta del agente → escenarios 21 y 22 | 20 min |
| 5 | Escenarios **por WhatsApp**: 10, 12, 13, 17, 18, 20, y el 4 | 45 min |
| 6 | Escenarios **de falla** (detienen el agente): 14, 15, 16 | 60–90 min |
| 7 | Pruebas del panel | 20 min |
| 8 | El **1b** cuando llegue el recordatorio (depende de la hora de la cita de mañana, no del reloj de la prueba) | 10 min |
| 9 | `PRUEBAS_E2E_VERIFICAR.sql` completo: la PARTE 3 campo a campo y el cuadro de mando de la PARTE 5 | 15 min |
| 10 | Limpieza — **los dos lados**: primero el HIS, después AgenIA | 20 min |

La fase 4 va **antes** que la 5 por un motivo: el escenario 21 exige que el paciente 1 ya se haya quedado con el teléfono, y el 22 que los dos perfiles ambiguos ya existan. Si se corren los pasos D y E antes de tiempo, los dos escenarios se pierden **sin dar error** — AgenIA simplemente da de alta al paciente, que es el comportamiento normal.

---

## En qué dirección va cada escenario

No todos empiezan en el mismo sitio, y eso cambia qué se mira para darlos por buenos.

**De WhatsApp al hospital** (escenarios 4, 10, 12, 13, 14, 15, 16, 17, 18, 20). Empiezan con el probador escribiéndole al bot desde su teléfono y dando la cédula sintética. El bot ofrece cupos, el paciente confirma, AgenIA encola la cita, el agente la escribe en el HIS. **Aquí sí se cierra con SQL**: `PRUEBAS_E2E_VERIFICAR.sql` enseña la cita en `CITAS_MEDICAS` con la marca `ASIGNADA POR WHATSAPP` y, en su PARTE 3, **campo a campo** — servicio, especialidad, convenio, consultorio, centro de costos, duración— al lado de una cita real reciente del mismo médico para comparar. Eso es lo que hay que revisar: que la cita esté no basta, el convenio es el que decide a quién se le factura.

**Del hospital a WhatsApp** (escenarios 1, 1b, 2, 3, 5, 6, 7, 8, 9, 11, 19, 21, 22). Empiezan al revés: un guion SQL escribe en el HIS lo que el hospital habría agendado, el agente lo detecta y **lo que se verifica es AgenIA** — que el cupo deje de ofrecerse por WhatsApp, que el paciente quede creado, que el bot le muestre la cita, que el recordatorio llegue, que la bandeja abra la excepción. Para estos el SQL es el punto de partida, no la comprobación.

**Y una comprobación que va al revés de lo que uno espera** (1-eco): aquí el SQL sirve para confirmar que el HIS **no** recibió nada. Una cita nacida en el hospital no debe volver al hospital, así que la PARTE 2 del guion de verificar tiene que mostrar **una sola** fila por cupo y ninguna con la marca de AgenIA.

El guion de verificar es de solo lectura y se puede correr tantas veces como se quiera: entre escenarios, para ver cómo va, y al final para el cuadro de mando.

## Los escenarios

**Cómo leer la tabla.** «Rastreo A» = Rastreo de paciente → *Dice que agendó*. «Rastreo B» = *Lo agendaron en el HIS*, con el médico y la hora. Los títulos entre comillas son los que muestra la pantalla, literales.

### Citas que nacen en el hospital (fases 2 y 3)

| # | Documento | Qué se prueba | Qué dejó PREPARAR en el HIS | Qué hacer en AgenIA | Resultado esperado |
|---|---|---|---|---|---|
| 1 | 9990000001 | Cita del hospital con médico homologado y paciente que AgenIA no conoce. **Con el alta en caliente** (`PLAN_ALTA_EN_CALIENTE.md`), este escenario cambia de resultado | **Dos** citas: una en el **cupo 1** del día de prueba y otra **mañana** (la del recordatorio) | Pedir por WhatsApp ese médico ese día. Escribirle al bot desde el **teléfono B** y preguntar por sus citas. Luego Rastreo B con ese cupo | El cupo 1 **ya no se ofrece** por WhatsApp. **El bot SÍ le muestra las dos citas** y el paciente queda creado en AgenIA con el nombre y el teléfono del HIS, con **un solo perfil** aunque hayan llegado dos citas suyas en la misma vuelta. Rastreo B: **«La cita existe en AgenIA»** |
| 1-eco | 9990000001 | 🔁 **El anti-eco**: lo que nace en el hospital no vuelve al hospital | — | En **Espejo → Auditoría** filtrar por esas dos citas | Solo aparecen movimientos `INBOUND`. **Ningún `OUTBOUND`**, y en el HIS sigue habiendo **una sola** fila por cupo. Si el hospital recibiera un alta de vuelta, chocaría contra su propia clave primaria: es el defecto que se corrigió en el disparador del outbox y solo una corrida real lo demuestra |
| 1b | 9990000001 | Recordatorio de una cita del hospital, y la baja | La cita de **mañana** | Esperar el recordatorio (sale 24 horas **hábiles** antes; el cron corre cada 15 min). Luego responder **«no quiero recordatorios»** desde el teléfono B | Al **teléfono B** le llega el recordatorio de una cita que él nunca pidió por WhatsApp — es el criterio de aceptación de la Fase 4 del alta en caliente. Tras la baja, el bot confirma que **sus citas siguen en pie** y no le llega ningún recordatorio más |
| 2 | 9990000002 | Cita con un médico que AgenIA no espeja | Cita del médico sin homologar a las 05:10 | Rastreo B con ese médico y hora | **«Ese médico no está en el espejo de AgenIA»** |
| 3 | 9990000003 | Hora que el hospital guardó en un formato ilegible | Cita con hora `YYYY/MM/DD 3`, en el **día siguiente** al de prueba | Rastreo B del médico homologado ese día, a **cualquier hora vacía**, con la consulta en vivo | **(en vivo)** **«El hospital respondió algo que no se pudo leer»** + aviso ámbar: *«que aquí no aparezca una cita no significa que el hospital no la tenga»*. Nunca «El HIS no tiene ninguna cita en ese cupo» |
| 5 | 9990000005 | Paciente con historia larga (60 citas pasadas) | 60 citas atendidas, una por semana, desde hace 14 días | Rastreo A con la consulta en vivo por documento | **(en vivo)** No muestra citas (la búsqueda por documento mira desde 7 días atrás, y todas son anteriores) y responde rápido. Es el peor caso de costo: compare con la PARTE G de `MEDICION_CONSULTA_EN_VIVO.sql` |
| 6 | 9990000006 | Cita pasada atendida | Cita de hace 3 días, estado 1 | Rastreo A, consulta en vivo | **(en vivo)** La cita aparece como **«atendida»** |
| 7 | 9990000007 | Inasistencia | Cita de hace 2 días, estado 2 | Rastreo A, consulta en vivo | **(en vivo)** La cita aparece **«con inasistencia registrada»** |
| 8 | 9990000008 | El mismo documento con un cero a la izquierda en el hospital | Paciente `09990000008` con cita en el **cupo 8** | Rastreo B del paciente `9990000008` en el cupo 8 | **(en vivo)** **«El HIS tiene esa hora a nombre de otro documento»**, precisando que es **el mismo número con ceros a la izquierda distintos** |
| 9 | 9990000009 | El cupo lo tiene otra persona | Nada (el cupo 9/19 lo ocupa el 19) | Rastreo B del paciente 9 en el **cupo 9/19** | **(en vivo)** **«El HIS tiene esa hora a nombre de otro documento»**, con el documento enmascarado (`•••0019`) |
| 11 | 9990000011 | Cita más allá de la ventana de la consulta en vivo | Cita a 200 días | Rastreo A, consulta en vivo | **(en vivo)** La cita **no aparece**: sin citas en AgenIA, la búsqueda por documento va de 7 días atrás a 60 adelante (y nunca pasa de 180 días). Es el comportamiento esperado, no un fallo |
| 19 | 9990000019 | Apoyo del 9: «la otra persona» | Cita en el cupo 9/19 | — | — |
| 21 | 9990000021 | 🔴 **El teléfono que ya es de otro** (D4). Es el caso más frecuente de todos: **el 43,8 % de los pacientes del hospital con móvil lo comparte** con otra historia, y hay números en 37 historias (medición del 2026-09-21) | Paciente con el **mismo móvil** que el 1, sin cita | Con el paciente 1 ya creado en AgenIA **con** el teléfono, correr el **PASO E** y esperar una vuelta del agente | El paciente 21 se crea en AgenIA **sin teléfono**, y su cita también. **Al teléfono B NO le llega ningún recordatorio de esta cita.** En el rastreo, la nota dice que el teléfono es de otro documento. Si le llegara, sería una persona viendo la cita de otra |
| 22 | 9990000022 | **El documento ambiguo** (D3): dos perfiles que podrían ser la misma persona | Paciente sin cita | 1) Crear a mano en AgenIA **dos** perfiles con el mismo documento escrito distinto: `9990000022` y `0009990000022`. 2) Correr el **PASO D**. 3) Esperar una vuelta | AgenIA **ocupa el cupo pero NO crea la cita**, y en la bandeja aparece **«Cita del hospital con un documento ambiguo»** con el documento enmascarado y los dos perfiles. No elige ninguno: fusionar a dos personas no se deshace. El cupo deja de ofrecerse por WhatsApp |

### Citas que nacen por WhatsApp (fase 4)

| # | Documento | Qué se prueba | Qué hacer | Resultado esperado |
|---|---|---|---|---|
| 13 | 9990000013 | **El camino feliz**: reserva por WhatsApp de un paciente que el hospital ya tiene | Reservar por WhatsApp eligiendo la **EPS A** | Confirmación por WhatsApp. En el HIS aparece la cita con `DE_DESC_CIT = 'ASIGNADA POR WHATSAPP'`, y `PACIENTES` sigue con **una sola** fila para ese documento (el driver no duplica al paciente). Rastreo A: **«La cita existe en AgenIA»**; **(en vivo)** **«La cita está en AgenIA y en el HIS»** |
| 12 | 9990000012 | Paciente que **no existe** en el hospital | Reservar por WhatsApp eligiendo la **EPS A** y contestar las preguntas del alta (nacimiento, sexo…) | El driver **crea** el paciente en `PACIENTES` (`NU_HIST_PAC = '9990000012'`) con la fecha de nacimiento y el sexo que se dieron por WhatsApp, y la cita. **(en vivo)** **«La cita está en AgenIA y en el HIS»** |
| 10 | 9990000010 | Conversa pero nunca confirma | Pedir cita por WhatsApp y **abandonar** antes de confirmar | Rastreo A: **«AgenIA no registra una cita confirmada»**. **(en vivo)** El hospital tampoco tiene nada |
| 20 | 9990000020 | Documento que el hospital tiene pero **no está en el padrón** | Intentar reservar por WhatsApp eligiendo la **EPS A** (no «Particular»: el pago directo no pasa por el padrón). Variante: el **17**, que está en el padrón de la EPS B, pidiendo por la EPS A | El bot **no agenda**: responde que no está afiliado a esa EPS, con el enlace a `…/solicitud-alta/…` para pedir la revisión, y cierra la sesión. Queda un fallo `EPS_NOT_ENROLLED` en la auditoría del bot |
| 17 | 9990000017 (EPS B) | El **paciente cancela** por WhatsApp | Reservar con el médico homologado, y luego cancelar por WhatsApp | En el HIS: la cita pasa a `CITAS_ANULADAS` con motivo y sale de `CITAS_MEDICAS`. Rastreo A: **«La cita fue cancelada»**. El cupo vuelve a ofrecerse |
| 18 | 9990000018 (EPS B, menor de edad) | **Lista de espera** | *Antes* de que el 17 cancele: pedir el mismo servicio. El bot solo ofrece la lista de espera cuando el servicio **no tiene cupos libres**; si en producción los tiene, este escenario no se puede provocar sin bloquear cupos reales: se marca «no ejecutable» y queda cubierto por las pruebas automáticas. Idealmente desde un segundo teléfono | Rastreo A: **«Está en lista de espera, no tiene una cita»**. Cuando el 17 cancela, el 18 **recibe la oferta** por WhatsApp |
| 4 | 9990000004 | El **hospital cancela** una cita que AgenIA ya tenía | 1) Comprobar que el cupo 4 **no** se ofrece por WhatsApp. 2) Correr el **PASO A**. 3) Esperar unos minutos | El cupo 4 **vuelve a ofrecerse** por WhatsApp. En Espejo → Auditoría aparece la cancelación del hospital |

### Escenarios de falla (fase 5) — detienen el agente

Detener y arrancar el agente, en el VPS del hospital: `sudo systemctl stop agenia-mirror-agent` / `sudo systemctl start agenia-mirror-agent`. Mientras esté detenido, **ninguna** reserva llega al hospital; hágalo fuera de la hora pico.

| # | Documento | Qué se prueba | Qué hacer | Resultado esperado |
|---|---|---|---|---|
| 14 | 9990000014 | **La aceptación de la Fase 3**: una cita que no llega al hospital avisa al agendador **antes** de la hora | 1) Detener el agente. 2) Reservar por WhatsApp. 3) Esperar **12 minutos**. 4) Arrancar el agente | A los ~10–12 min: en la **Bandeja de sincronización**, **«Cita que el hospital aún no tiene»** (*«Lleva N min en la cola…»*), y **un WhatsApp al teléfono del agendador** con la causa *«el agente del hospital no da señales»*. Rastreo A: **«Confirmada en AgenIA, pero NO ha llegado al HIS»**. Si nadie toma la excepción, a los **30 min** del aviso llega un **recordatorio** al agendador **y al respaldo**, con la causa empezando por *«RECORDATORIO 1 de 2: nadie la ha tomado en la bandeja»*; en el historial, *«Se le recordó al agendador»*. Al arrancar: la cita llega y la excepción **se cierra sola** (*«Se cerró sola»*) |
| 15 | 9990000015 | **Colisión**: el hospital da el cupo antes de que llegue la reserva | 1) Detener el agente. 2) Reservar por WhatsApp y anotar médico y hora. 3) Correr el **PASO B** con ese cupo. 4) Arrancar el agente | El envío choca: *«ya está ocupado en el HIS»*. En la bandeja, la excepción pasa por *«está fallando (intento N de 10)»* y, al rendirse, por *«se rindió tras 10 intentos»*, con **aviso inmediato** al agendador. La política es que **el hospital gana**: hay que llamar al paciente |
| 16 | 9990000016 | **Deriva**: una cita de AgenIA desaparece del hospital sin cancelación | 1) Reservar por WhatsApp y esperar a que llegue al HIS. 2) Correr el **PASO C**. 3) Reiniciar el agente (la reconciliación corre a los 2 min) | Bandeja: **«El hospital no tiene una cita que AgenIA da por hecha»**, con aviso. `./checkHealthAgente.sh`: **FALLO**, *«1 cita(s) que AgenIA dio por confirmadas y el HOSPITAL NO TIENE»*. **(en vivo)** Rastreo A: **«AgenIA la entregó al hospital, pero el HIS no la tiene»** |

---

## Pruebas del panel (sin documento propio)

| Qué | Cómo | Resultado esperado |
|---|---|---|
| Alcance del **BOOKING_AGENT** (EPS A) | Entrar como ese agente y buscar al 17 y al 18 (EPS B) en Rastreo, en la Bandeja y en Agendamiento | No los ve en ninguna. Rastreo: **«Hay citas de este paciente fuera de tu alcance»** si el paciente tiene citas de las dos EPS |
| El agente no puede **cancelar ni marcar asistencia** fuera de su alcance | Intentarlo con una cita de la EPS B | *«Esta cita está fuera de su alcance (EPS o médico asignados)»* |
| El **DOCTOR** queda acotado a su agenda | Entrar como el médico homologado y tratar de cancelar o marcar asistencia de una cita de otro médico | Rechazado con el mismo mensaje |
| Un **PACIENTE** no puede crear ni mover citas | Con una sesión de paciente, intentar las acciones de Agendamiento | *«No tiene permisos para operar la agenda»* |
| Trabajar una excepción | En la bandeja del escenario 15: **Tomar**, intentar **Resolver** sin nota, y luego con nota | Sin nota lo rechaza; con nota queda *«Resuelta»* con quién y cuándo en el historial |
| Tomar la excepción detiene los recordatorios | En el escenario 14, **Tomar** la excepción antes de los 30 min | No llega ningún recordatorio |
| Confirmar una cita del hospital | Rastreo B del **escenario 22** con su cupo. Antes, ponerle el **teléfono A** a uno de los dos perfiles ambiguos (ya terminaron los escenarios de WhatsApp, así que ese número queda libre para esto) | Aparece el bloque **«Confirmarle la cita al paciente»** con botón. Al pulsarlo, al teléfono A le llega la confirmación diciendo que **la cita la asignó el hospital** y que para cambiarla hay que comunicarse con él. Un segundo intento en menos de 10 minutos no repite el mensaje. Fuera de la ventana de 24 h de Meta sale con la plantilla `HIS_APPOINTMENT_CONFIRMATION`; sin ella aprobada, la pantalla lo dice y no envía |
| Otro agente no se la quita | Con la excepción tomada por un agente, entrar como otro | No ve los botones de soltar ni cerrar; el ORG_ADMIN sí puede reasignarla |

---

## Lo que esta prueba NO cubre

Dicho para que nadie lo dé por probado:

- **El recorte a 50 filas** de la consulta en vivo por documento: sembrar 51 citas futuras de un paciente ocuparía 51 cupos reales. Está cubierto por las pruebas automáticas.
- **El canal de correo** del aviso al agendador: no existe (§12 #13 del plan).
- **Los avisos masivos**: la función está apagada para la clínica.
- **Los 19 médicos sin homologar**, más allá del escenario 2: es una tarea de homologación, no de prueba.
- **El estado `VENCIDA`**: el vigilante cierra una excepción cuando la hora de la cita pasó hace **más de 7 días** y nadie la movió en 7 días. No hay forma de provocarlo en una sesión sin manipular fechas en la base. Cubierto por las pruebas automáticas y la verificación contra Postgres real.
- **La purga de retención** (180 / 365 días): el cron corre a las 3:30 a. m. y en una base nueva no hay nada tan viejo que borrar. Lo que sí conviene mirar a la mañana siguiente es que quede su constancia en `SystemLog` (`DATA_RETENTION_PURGE`) — que corrió es lo que hay que ver, no que borró.
- 🔴 **La baja del paciente creado por el alta en caliente** (D10). La regla está implementada y el motor la respeta —un documento dado de baja no se vuelve a crear solo— pero **hoy nada la puede activar**: `MirrorPatientService.registrarBaja` no tiene quien la llame, ni endpoint ni pantalla ni intención del bot. La baja que sí se prueba (escenario 1b) es la de los **recordatorios**, que es otra cosa: el perfil sigue existiendo. Hasta que exista la vía, la única forma de dar de baja un documento es un `INSERT` a mano en `MirrorPatientOptOut`.
- 🔴 **El recordatorio manual y la baja**: el cron respeta `remindersOptOut`, pero el botón «enviar recordatorio» del panel **no lo comprueba**. Si tras el escenario 1b alguien pulsa ese botón, el mensaje sale igual. No es un fallo del guion de pruebas, es una decisión pendiente: o el botón respeta la baja, o al menos avisa a quien lo pulsa.

---

## Criterio de salida

Se puede salir a producción si:

1. Los escenarios **1, 2, 4, 10, 12, 13, 14, 16, 17 y 20** dan el resultado esperado, y el **18** también si se pudo provocar. Son el funcionamiento del espejo, del bot y del aviso.
2. El **14** cumple la aceptación de la Fase 3: el WhatsApp al agendador llega **antes** de la hora de la cita.
3. Del alta en caliente, los cuatro que son su criterio de aceptación: **1** (crea paciente y cita, un solo perfil), **1-eco** (no rebota al hospital), **1b** (recordatorio y baja) y **21** (no le asigna el teléfono de otro). El **21** es el que más importa de los cuatro en producción: el 43,8 % de los pacientes con móvil lo comparte, así que ese camino se va a recorrer todos los días. Si el recordatorio del 21 llega al teléfono B, **no se sale a producción**: es una persona recibiendo —y pudiendo cancelar— la cita de otra.
4. El **22** deja la excepción en la bandeja y **no** crea la cita. Elegir un perfil por su cuenta sería mezclar dos historias clínicas.
5. Las **pruebas del panel** no dejan ver ni tocar nada fuera del alcance.
6. Si la consulta en vivo sale a producción: los escenarios **(en vivo)** dan su resultado, y **ninguno** afirma «El HIS no tiene ninguna cita en ese cupo» donde hay una cita (3, 8, 9).

Un fallo en el **15** no bloquea por sí mismo si el aviso al agendador sale: la colisión es rara y la política es que el hospital gana. Pero hay que saber cómo se comporta antes de abrir.

---

## Limpieza — en este orden

1. **Cancelar en AgenIA** (desde el panel) las citas de prueba que sigan vigentes — incluidas **las que creó el alta en caliente**, que ya son citas normales. **Primero aquí**: si se borran solo en el HIS, AgenIA las sigue teniendo, la reconciliación las reporta como deriva y la bandeja avisa al agendador por algo que no pasó.
2. Resolver o descartar las excepciones de prueba en la bandeja, con la nota *«prueba E2E»*.
3. Correr `PRUEBAS_E2E_3_LIMPIAR.sql` contra **PRUEBAS** (el HIS): primero con `@CONFIRMO = 0`, que lista lo que borraría **y avisa si AgenIA aún tiene alguna cita viva**; luego con `@CONFIRMO = 1`.
4. Correr `PRUEBAS_E2E_4_AGENIA_POSTGRES_LIMPIAR.sql` contra la base de **AgenIA**, primero con `confirmo=0`. Esto es nuevo y no se puede saltar: el alta en caliente crea allá un `PatientProfile` y un `User` por cada paciente que el hospital agendó, y la baja de recordatorios del 1b deja una fila que impediría repetir el escenario. El guion se niega a borrar si queda alguna cita de prueba sin cancelar (el paso 1), y libera el cupo que el escenario 22 dejó ocupado sin cita.
5. El padrón de prueba lo borra el propio `PRUEBAS_E2E_4_AGENIA_POSTGRES_LIMPIAR.sql` del paso 4 (21 filas, acotadas a los documentos sintéticos). **No** hay que reimportar ningún corte.
6. Si la consulta en vivo no sale a producción: `lookupEnabled = false`.
7. Devolver el número del agendador al teléfono real, y el de respaldo al del coordinador (o vaciarlo).
8. Comprobar que el teléfono B **no** quedó en ningún perfil: `./checkHealth.sh` no lo mira, pero el paso 4 lo borra al borrar el perfil del paciente 1. Si el probador vuelve a recibir un recordatorio después de la limpieza, algo quedó.

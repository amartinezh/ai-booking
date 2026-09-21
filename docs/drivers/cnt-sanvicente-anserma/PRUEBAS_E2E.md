# Pruebas de punta a punta antes de producción — San Vicente de Paúl (Anserma)

Veinte escenarios, con documentos **sintéticos**, que recorren lo que AgenIA hace con el HIS: citas que nacen en el hospital, citas que nacen por WhatsApp, cancelaciones de los dos lados, fallos del agente y del hospital, la bandeja de sincronización, la consulta en vivo y los permisos del panel.

| Archivo | Para qué |
|---|---|
| [`sql/PRUEBAS_E2E_1_PREPARAR.sql`](sql/PRUEBAS_E2E_1_PREPARAR.sql) | Deja el HIS (`PRUEBAS`) listo: 19 pacientes y las citas «del hospital» |
| [`sql/PRUEBAS_E2E_2_PASOS.sql`](sql/PRUEBAS_E2E_2_PASOS.sql) | Tres acciones del hospital que se corren **durante** la prueba (A, B, C) |
| [`sql/PRUEBAS_E2E_3_LIMPIAR.sql`](sql/PRUEBAS_E2E_3_LIMPIAR.sql) | Deja `PRUEBAS` como estaba |
| [`padron/e2e/padron_e2e_eps_a.csv`](padron/e2e/padron_e2e_eps_a.csv) | Padrón de prueba, EPS A (17 documentos) |
| [`padron/e2e/padron_e2e_eps_b.csv`](padron/e2e/padron_e2e_eps_b.csv) | Padrón de prueba, EPS B (2 documentos) |

Los tres guiones se verificaron contra un SQL Server con el esquema real del HIS y un login **en español** (como el del hospital): las guardas rechazan los parámetros malos, la escritura es de todo o nada, un segundo intento se niega, los pasos se deshacen si afectan una fila de más, y la limpieza borra solo lo sintético y deja intacto lo real.

---

## Por qué documentos sintéticos y no del padrón real

Los 20 documentos son `9990000001` … `9990000020`: diez dígitos que empiezan por 999, un rango que no usan las cédulas colombianas. Probar con pacientes **reales** tendría dos efectos que no se pueden deshacer: el bot y los recordatorios **les escribirían por WhatsApp**, y sus historias en el hospital quedarían con citas inventadas. La variedad del padrón real —régimen, ceros a la izquierda, edad, nombres compuestos, tildes y eñes, EPS distintas— está reproducida en los sintéticos.

Los padrones de prueba van **sin teléfono** a propósito: así ningún mensaje sale a nadie por el padrón. Las pruebas por WhatsApp se hacen escribiendo desde el teléfono del probador y dando la cédula sintética.

---

## Antes de empezar

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
| Plantilla «Aviso al agendador» aprobada en Meta | Configuración → plantillas | 14, 15, 16 |
| Consulta en vivo **encendida** en la clínica (`lookupEnabled`) | SQL en la nube (`CONSULTA_EN_VIVO.md`) | 3, 5, 6, 7, 8, 9, 11, 16 |
| Dos EPS elegidas en AgenIA: **EPS A** y **EPS B** | Al subir cada padrón | todos; 17 y 18 para el alcance |
| Un usuario **BOOKING_AGENT acotado a la EPS A** | Usuarios | pruebas del panel |
| Un usuario **DOCTOR** del médico homologado | Usuarios | pruebas del panel |

Si la consulta en vivo **no** va a salir a producción, enciéndala solo para la prueba y apáguela al terminar. Sin ella, las partes marcadas **(en vivo)** de la tabla no se pueden comprobar.

### 4. Los parámetros de PREPARAR

- `@MED_HOMOLOGADO`: un médico que esté en **Espejo → Homologación** y que tenga turno el día de prueba (la consulta de apoyo del guion los lista).
- `@MED_SIN_HOMOLOGAR`: un médico que aparezca en **Espejo → Homologación** como **sin homologar** (hoy hay 19). Tiene que estar en esa lista, no solo en el HIS: de ahí sale el selector de médicos del Rastreo.
- `@DIAS`: el día de prueba = hoy + `@DIAS`. Dentro de lo que el bot ofrece (≈ 7 a 13 días).

Corra primero con `@CONFIRMO = 0`: valida todo y muestra la vista previa sin escribir. Luego con `@CONFIRMO = 1`. Anote la tabla final (el día de prueba y los cupos).

---

## Orden de ejecución

| Fase | Qué | Tiempo aprox. |
|---|---|---|
| 0 | `PRUEBAS_E2E_1_PREPARAR.sql` | 5 min |
| 1 | Subir `padron_e2e_eps_a.csv` en la EPS A y `padron_e2e_eps_b.csv` en la EPS B | 5 min |
| 2 | Esperar a que el agente tome las altas del hospital. Comprobar en **Espejo → Auditoría**, dirección `INBOUND` | 5–10 min |
| 3 | Escenarios **de lectura**: 1, 2, 3, 5, 6, 7, 8, 9, 11 | 30 min |
| 4 | Escenarios **por WhatsApp**: 10, 12, 13, 17, 18, 20, y el 4 | 45 min |
| 5 | Escenarios **de falla** (detienen el agente): 14, 15, 16 | 60–90 min |
| 6 | Pruebas del panel | 20 min |
| 7 | Limpieza | 15 min |

---

## Los 20 escenarios

**Cómo leer la tabla.** «Rastreo A» = Rastreo de paciente → *Dice que agendó*. «Rastreo B» = *Lo agendaron en el HIS*, con el médico y la hora. Los títulos entre comillas son los que muestra la pantalla, literales.

### Citas que nacen en el hospital (fases 2 y 3)

| # | Documento | Qué se prueba | Qué dejó PREPARAR en el HIS | Qué hacer en AgenIA | Resultado esperado |
|---|---|---|---|---|---|
| 1 | 9990000001 | Cita del hospital con médico homologado y paciente que AgenIA no conoce | Cita en el **cupo 1** | Pedir por WhatsApp ese médico ese día. Luego Rastreo B con ese cupo | El cupo 1 **ya no se ofrece** por WhatsApp. Rastreo B: **«El hospital agendó ese cupo y AgenIA no creó la cita»** |
| 2 | 9990000002 | Cita con un médico que AgenIA no espeja | Cita del médico sin homologar a las 05:10 | Rastreo B con ese médico y hora | **«Ese médico no está en el espejo de AgenIA»** |
| 3 | 9990000003 | Hora que el hospital guardó en un formato ilegible | Cita con hora `YYYY/MM/DD 3`, en el **día siguiente** al de prueba | Rastreo B del médico homologado ese día, a **cualquier hora vacía**, con la consulta en vivo | **(en vivo)** **«El hospital respondió algo que no se pudo leer»** + aviso ámbar: *«que aquí no aparezca una cita no significa que el hospital no la tenga»*. Nunca «El HIS no tiene ninguna cita en ese cupo» |
| 5 | 9990000005 | Paciente con historia larga (60 citas pasadas) | 60 citas atendidas, una por semana, desde hace 14 días | Rastreo A con la consulta en vivo por documento | **(en vivo)** No muestra citas (la búsqueda por documento mira desde 7 días atrás, y todas son anteriores) y responde rápido. Es el peor caso de costo: compare con la PARTE G de `MEDICION_CONSULTA_EN_VIVO.sql` |
| 6 | 9990000006 | Cita pasada atendida | Cita de hace 3 días, estado 1 | Rastreo A, consulta en vivo | **(en vivo)** La cita aparece como **«atendida»** |
| 7 | 9990000007 | Inasistencia | Cita de hace 2 días, estado 2 | Rastreo A, consulta en vivo | **(en vivo)** La cita aparece **«con inasistencia registrada»** |
| 8 | 9990000008 | El mismo documento con un cero a la izquierda en el hospital | Paciente `09990000008` con cita en el **cupo 8** | Rastreo B del paciente `9990000008` en el cupo 8 | **(en vivo)** **«El HIS tiene esa hora a nombre de otro documento»**, precisando que es **el mismo número con ceros a la izquierda distintos** |
| 9 | 9990000009 | El cupo lo tiene otra persona | Nada (el cupo 9/19 lo ocupa el 19) | Rastreo B del paciente 9 en el **cupo 9/19** | **(en vivo)** **«El HIS tiene esa hora a nombre de otro documento»**, con el documento enmascarado (`•••0019`) |
| 11 | 9990000011 | Cita más allá de la ventana de la consulta en vivo | Cita a 200 días | Rastreo A, consulta en vivo | **(en vivo)** La cita **no aparece**: sin citas en AgenIA, la búsqueda por documento va de 7 días atrás a 60 adelante (y nunca pasa de 180 días). Es el comportamiento esperado, no un fallo |
| 19 | 9990000019 | Apoyo del 9: «la otra persona» | Cita en el cupo 9/19 | — | — |

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
| 14 | 9990000014 | **La aceptación de la Fase 3**: una cita que no llega al hospital avisa al agendador **antes** de la hora | 1) Detener el agente. 2) Reservar por WhatsApp. 3) Esperar **12 minutos**. 4) Arrancar el agente | A los ~10–12 min: en la **Bandeja de sincronización**, **«Cita que el hospital aún no tiene»** (*«Lleva N min en la cola…»*), y **un WhatsApp al teléfono del agendador** con la causa *«el agente del hospital no da señales»*. Rastreo A: **«Confirmada en AgenIA, pero NO ha llegado al HIS»**. Al arrancar: la cita llega y la excepción **se cierra sola** (*«Se cerró sola»*) |
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
| Otro agente no se la quita | Con la excepción tomada por un agente, entrar como otro | No ve los botones de soltar ni cerrar; el ORG_ADMIN sí puede reasignarla |

---

## Lo que esta prueba NO cubre

Dicho para que nadie lo dé por probado:

- **El recorte a 50 filas** de la consulta en vivo por documento: sembrar 51 citas futuras de un paciente ocuparía 51 cupos reales. Está cubierto por las pruebas automáticas.
- **El canal de correo** del aviso al agendador: no existe (§12 #13 del plan).
- **Los avisos masivos**: la función está apagada para la clínica.
- **Los 19 médicos sin homologar**, más allá del escenario 2: es una tarea de homologación, no de prueba.
- **La causa raíz del escenario 2** (§11): la prueba confirma que el bot **no ve** las citas del hospital (escenario 1); decidir qué hacer con eso es otra cosa.

---

## Criterio de salida

Se puede salir a producción si:

1. Los escenarios **1, 2, 4, 10, 12, 13, 14, 16, 17 y 20** dan el resultado esperado, y el **18** también si se pudo provocar. Son el funcionamiento del espejo, del bot y del aviso.
2. El **14** cumple la aceptación de la Fase 3: el WhatsApp al agendador llega **antes** de la hora de la cita.
3. Las **pruebas del panel** no dejan ver ni tocar nada fuera del alcance.
4. Si la consulta en vivo sale a producción: los escenarios **(en vivo)** dan su resultado, y **ninguno** afirma «El HIS no tiene ninguna cita en ese cupo» donde hay una cita (3, 8, 9).

Un fallo en el **15** no bloquea por sí mismo si el aviso al agendador sale: la colisión es rara y la política es que el hospital gana. Pero hay que saber cómo se comporta antes de abrir.

---

## Limpieza — en este orden

1. **Cancelar en AgenIA** (desde el panel) las citas de prueba que sigan vigentes. **Primero aquí**: si se borran solo en el HIS, AgenIA las sigue teniendo, la reconciliación las reporta como deriva y la bandeja avisa al agendador por algo que no pasó.
2. Resolver o descartar las excepciones de prueba en la bandeja, con la nota *«prueba E2E»*.
3. Correr `PRUEBAS_E2E_3_LIMPIAR.sql`: primero con `@CONFIRMO = 0`, que lista lo que borraría **y avisa si AgenIA aún tiene alguna cita viva**; luego con `@CONFIRMO = 1`.
4. Retirar los dos padrones de prueba en AgenIA.
5. Si la consulta en vivo no sale a producción: `lookupEnabled = false`.
6. Devolver el número del agendador al teléfono real.

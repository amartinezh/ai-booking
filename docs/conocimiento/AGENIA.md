# AgenIA — Base de conocimiento del sistema

> **Qué es este archivo.** La descripción completa y vigente de lo que hace AgenIA: cada pantalla del panel, el asistente virtual de los pacientes, la conexión con el hospital, los procesos automáticos, la seguridad y la arquitectura. Es la fuente única: el **Centro de ayuda** del panel (`/dashboard/soporte/ayuda`) se arma exclusivamente con la Parte 1 de este archivo, y el resto sirve para que cualquier persona (o asistente de IA) entienda el sistema sin leer el código.
>
> **Regla obligatoria.** Todo ajuste o mejora del sistema actualiza este archivo **en el mismo commit**: lo que cambió en la pantalla o en el comportamiento, y una línea en la [bitácora](#parte-3--bitácora-de-cambios). Lo vigilan el gancho `commit-msg` del repositorio y el CI. Cómo editarlo y el formato de la Parte 1: [README.md](README.md) de esta carpeta.

**Última actualización:** 2026-10-29

## Contenido

- **Parte 1 · Centro de ayuda** — lo que lee la página de ayuda, opción por opción del menú del administrador, más el glosario.
- **Parte 2 · Cómo funciona AgenIA** — roles, asistente virtual, recordatorios, conexión con el hospital, procesos automáticos, monitoreo, seguridad, arquitectura, configuración y limitaciones conocidas.
- **Parte 3 · Bitácora de cambios** — qué cambió en el sistema y cuándo.

---

# Parte 1 · Centro de ayuda

Todo lo que va entre las marcas `AYUDA:INICIO` y `AYUDA:FIN` lo muestra la página de ayuda tal cual: una edición aquí cambia la página en el siguiente despliegue (en desarrollo, al recargar). El texto se muestra sin formato: no uses negritas ni enlaces dentro de los párrafos. El formato de cada pieza está en el [README](README.md#formato-de-la-parte-1).

<!-- AYUDA:INICIO -->

## Portada

- **Presentación:** Cada opción del menú explicada paso a paso. Escribe lo que necesitas hacer o lo que está pasando: el buscador entiende palabras sin tilde, errores de tipeo y sinónimos (turno, cupo, slot…).
- **Búsquedas frecuentes:** Abrir cupos, Cargar el padrón, Cambiar contraseña, El bot no responde, Cita que no llegó al hospital, Paciente dice que agendó, Plantillas de WhatsApp, Recordatorios
- **Glosario destacado:** HIS, espejo, cupo, padrón, régimen, plantilla, BSUID

## Categoría: Para empezar {#inicio}

El orden recomendado para dejar lista la clínica y la rutina de cada día.

### 🚀 Primeros pasos {#primeros-pasos}

- **Resumen:** El orden recomendado para dejar lista la clínica, de la conexión del asistente a la primera cita, y la rutina de cada día.
- **Relacionados:** [Configuración](#configuracion), [Servicios de Salud](#servicios), [Médicos](#medicos), [Agendas (Slots)](#agenda), [Padrón EPS (Altas)](#padron), [Glosario](#glosario)
- **Palabras clave:** empezar, inicio, comenzar, configurar clínica, nuevo, onboarding, tutorial, orden, checklist, rutina

#### Para qué sirve

Si estás empezando como administrador, aquí ves qué configurar primero y por qué importa el orden: cada paso usa lo que creaste en el anterior. Un médico necesita un servicio, un cupo necesita un médico, el padrón necesita las EPS y el asistente no puede ofrecer nada sin cupos libres.

#### Paso a paso

##### Poner en marcha la clínica, de cero a la primera cita

1. Configuración › Integraciones (IA y Canales): conecta el proveedor de inteligencia artificial y el canal de WhatsApp (y Telegram si lo vas a usar). Pulsa «Probar Servicio» para confirmar que responden.
2. Configuración › Asistente Virtual: dale nombre y tono al asistente, decide qué puede hacer el paciente (agendar, cancelar, cambiar la fecha) y enciende los recordatorios.
3. Configuración › Base de Conocimiento: escribe horarios, dirección, tarifas, EPS con convenio y teléfonos. Es lo único que el asistente responderá sobre la clínica.
4. Servicios de Salud: crea las especialidades que se podrán agendar.
5. Aseguradoras (EPS): crea las EPS con las que la clínica tiene convenio.
6. Médicos: crea a cada médico y asígnale su servicio.
7. Agendas (Slots): abre los cupos de cada médico. Si la clínica está conectada al sistema del hospital con la agenda en modo ON, los cupos llegan solos del hospital.
8. Padrón EPS (Altas): carga el listado de afiliados de cada EPS para que puedan agendar por su EPS.
9. Usuarios: crea las cuentas del personal (agentes de reservas, médicos y otros administradores).
10. Haz una prueba: escríbele al asistente por WhatsApp, agenda una cita y comprueba que aparece en Visión General.

> 💡 Puedes volver a cualquier paso después; el orden solo evita que una pantalla te pida algo que todavía no existe.

##### La rutina diaria del administrador

1. Visión General: revisa las citas del día y marca quién asistió.
2. Caja Negra (Auditoría): contacta a los pacientes que intentaron agendar y no pudieron, empezando por los «Recuperables» y las posibles emergencias.
3. Bandeja de sincronización (si tu clínica está conectada al hospital): atiende las citas que el hospital todavía no tiene, empezando por las críticas.
4. Solicitudes de Alta: revisa los pedidos de personas que no aparecen en el padrón de su EPS.
5. Canales en vivo: mira si sube «Con problema» o «Escribieron y no agendaron», y cuál es el motivo de fallo principal.

#### Preguntas frecuentes

##### ¿Puedo saltarme pasos?

Puedes, pero algunas cosas no van a funcionar: sin servicio no se puede crear el médico; sin médico no hay cupos; sin cupos el asistente responde que no hay agenda; sin EPS activas no se puede cargar el padrón.

##### ¿Quién puede ver esta ayuda?

Por ahora, solo el Administrador del Hospital, que es el rol que ve todas las opciones del menú. Se abre desde el botón «Ayuda» de la página de Soporte.

##### ¿Cómo pruebo el asistente sin molestar a un paciente real?

Escríbele desde tu propio WhatsApp al número de la clínica y sigue el flujo como lo haría un paciente. Luego anula la cita de prueba desde Visión General con «Anular y Liberar» para que el cupo quede libre.

## Categoría: Operación diaria {#operacion}

Las citas del día, los pacientes que no lograron agendar y las investigaciones.

### 📋 Visión General {#vision-general}

- **Ruta:** `/dashboard`
- **Resumen:** El tablero central con las citas de la clínica desde hoy (las anteriores, eligiendo fechas): filtrarlas, marcar asistencia, enviar recordatorios y anular.
- **Relacionados:** [Agendas (Slots)](#agenda), [Configuración](#configuracion), [Rastreo de paciente](#rastreo), [Canales en vivo](#canales)
- **Palabras clave:** inicio, tablero, dashboard, panel principal, citas del día, lista de citas, asistencia, inasistencia, no show, filtrar citas, citas anteriores, citas pasadas, página lenta

#### Para qué sirve

Es la primera pantalla al entrar. Arriba tienes accesos rápidos a cada opción del menú y, debajo, la tabla con las citas de la clínica desde hoy, ordenadas por fecha y hora. Muestra hasta 500 citas; si hay más, lo avisa. En cada fila ves el horario, el servicio y la EPS, el paciente, el médico, el estado y lo que puedes hacer con esa cita.

#### Paso a paso

##### Encontrar las citas de un día, un médico o una EPS

1. Sin fechas, la tabla muestra las citas desde hoy. Para ver citas anteriores, en «Filtros Activos» elige una fecha inicial; puedes elegir también la final. Solo con una fecha final: si ya pasó, ves las citas hasta ese día; si no, de hoy hasta ese día.
2. Si quieres, elige un médico en «Todos los Médicos» y una EPS en «Todas las EPS (Convenios)».
3. La tabla se actualiza sola al cambiar cada filtro.
4. Para quitar un filtro, vuelve a «Todos…» o borra la fecha. Sin fecha inicial, la tabla vuelve a arrancar hoy.

> 💡 Los filtros quedan en la dirección de la página: puedes guardarla en favoritos o compartirla con otro administrador.

##### Marcar si el paciente asistió

1. Busca la cita (debe estar vigente).
2. En la columna «Estado y Asistencia», cambia «En Espera» por «✅ Asistió» o «❌ Ausente».
3. Se guarda al instante y la etiqueta de la cita pasa a «ATENDIDA» o «NO ASISTIÓ». Queda constancia de quién la marcó y cuándo.

> 💡 Las citas con la insignia «🏥 Hospital» no se marcan aquí: su asistencia la registra el hospital en su sistema y AgenIA solo la muestra.

##### Enviar un recordatorio manual

1. En la columna «Acción» de una cita vigente, pulsa «Recordar por WhatsApp» (o «por Telegram»: el botón nombra el canal por el que de verdad saldrá).
2. Espera el aviso verde «Recordatorio manual enviado con éxito».
3. Si ya se había enviado, el botón dice «Reenviar recordatorio». Pasa el cursor por encima para ver cuándo salió el anterior.

> 💡 El botón manual funciona aunque los recordatorios automáticos estén apagados en Configuración. Queda constancia de quién lo pidió y de si salió o no.

##### Anular (cancelar) una cita y liberar el cupo

1. Pulsa «Anular y Liberar» en la fila de la cita.
2. Confirma el mensaje.
3. La cita queda CANCELADA y el cupo vuelve a estar libre para que otro paciente lo tome con el asistente.

> 💡 Queda constancia de quién la anuló y cuándo. Anular no le escribe al paciente: si hace falta, avísale tú. Si la clínica está conectada al hospital, la cancelación también se envía al sistema del hospital.

#### Qué ves en la pantalla

- **Accesos rápidos:** Una tarjeta por cada opción del menú. Un número rojo indica cosas pendientes (por ejemplo, en la Bandeja de sincronización).
- **Horario Slot:** Fecha de la cita y hora de inicio y de fin, en hora de Colombia.
- **Estudio/EPS:** El servicio de la cita y, si la hay, la EPS con la que se agendó.
- **Paciente:** Nombre completo y documento (DNI) del paciente.
- **Insignias de origen:** «🤖 AI Bot»: agendada por WhatsApp. «✈️ Bot Telegram»: por Telegram. «👤 Manual»: por el personal. «🏥 Hospital»: agendada en el sistema del hospital.
- **Estados:** SCHEDULED: vigente. ATENDIDA: asistió. NO ASISTIÓ: no llegó. CANCELADA: anulada por el paciente, el personal o el hospital.
- **Anular y Liberar:** Cancela la cita y deja el cupo libre. No aparece en citas ya atendidas.

#### Preguntas frecuentes

##### ¿Por qué no puedo marcar la asistencia de algunas citas?

Porque son citas del hospital (insignia «🏥 Hospital»). La asistencia de esas citas la registra el hospital en su sistema y AgenIA la refleja tal cual.

##### ¿Por qué no veo las citas de días anteriores?

Porque, para que cargue rápido, la tabla arranca hoy. Elige una fecha inicial en «Filtros Activos» y verás desde ese día.

##### ¿Se puede deshacer una anulación?

No. Si fue un error, el cupo ya quedó libre: pídele al paciente que vuelva a agendar con el asistente, o que un Agente de Reservas lo agende desde su panel.

##### ¿Qué diferencia hay entre «Recordar» y los recordatorios automáticos?

Los automáticos salen solos antes de cada cita si están encendidos en Configuración › Asistente Virtual. «Recordar» lo envías tú en el momento, por ejemplo cuando el paciente pidió que le reenvíen los datos. Una cita que el paciente se agenda por el chat con poca anticipación —tanta que el automático le llegaría menos de 12 horas después de la confirmación, es decir, con un día y medio hábil o menos (por ejemplo, hoy para mañana)— no recibe el automático: la confirmación del chat acaba de decirle lo mismo. «Recordar» sí le llega.

#### Si algo no sale bien

##### Sale «No se encontraron citas bajo esos filtros».

Revisa que la fecha final no sea anterior a la inicial y vuelve a «Todos los Médicos» y «Todas las EPS». Si sigue vacío, no hay citas en ese periodo.

##### Sale «Se muestran las primeras 500 citas».

Hay más citas que las que caben en la tabla. Acota con las fechas, el médico o la EPS. Para buscar a un paciente en particular, usa Rastreo de paciente.

##### El recordatorio falla con «no tiene número de WhatsApp registrado».

Ese paciente no tiene un WhatsApp guardado. Contáctalo por otro medio.

##### El recordatorio por WhatsApp no sale y el paciente no ha escrito hace más de un día.

Fuera de las 24 horas siguientes al último mensaje del paciente, WhatsApp solo deja enviar plantillas aprobadas. Configura la plantilla «Recordatorio de cita» en Configuración › Integraciones › Plantillas de WhatsApp.

### 🔎 Rastreo de paciente {#rastreo}

- **Ruta:** `/dashboard/rastreo`
- **Resumen:** Averigua qué pasó con la cita de un paciente: si se confirmó, si llegó al hospital, si se canceló y quién lo hizo.
- **Relacionados:** [Caja Negra (Auditoría)](#auditoria), [Bandeja de sincronización](#bandeja), [Espejo con el HIS](#espejo), [Visión General](#vision-general)
- **Palabras clave:** investigar, reclamo, pqrs, diagnóstico, no aparece la cita, captura de pantalla, paciente dice que agendó, cita perdida, expediente, buscar paciente

#### Para qué sirve

Sirve para los reclamos del tipo «yo agendé por WhatsApp y en el hospital no aparece» o «me agendaron en el hospital y el WhatsApp no me la muestra». La pantalla junta lo que consta en AgenIA (la conversación con el bot, las citas, la lista de espera y lo que se envió al hospital) y entrega un veredicto con su evidencia, lo que no se sabe y qué hacer. Nunca dice que alguien miente: dice qué consta.

#### Paso a paso

##### Investigar «Dice que agendó» (agendó por WhatsApp y el hospital no la tiene)

1. Abre la pestaña «Dice que agendó».
2. Escribe la cédula, el teléfono, el BSUID o el nombre y apellido del paciente.
3. Elige el «Motivo de la consulta» (es obligatorio) y, si quieres, una nota, por ejemplo el número de la PQRS. Con el motivo «Otro», la nota es obligatoria.
4. Si el paciente muestra una captura de pantalla, abre «Datos de la captura» y escribe la fecha, la hora y el médico que se ven. AgenIA los compara con lo registrado; la imagen no se guarda.
5. Pulsa «Buscar» y elige al paciente correcto entre los resultados.
6. Lee el veredicto de arriba: qué consta, lo que el resultado no puede afirmar y «Qué hacer».

> 💡 Que no aparezca nadie no prueba que el paciente no exista: pudo escribir desde otro número o con otra cédula. Prueba con otro dato.

##### Investigar «Lo agendaron en el HIS» (agendada en el hospital, no sale en WhatsApp)

1. Abre la pestaña «Lo agendaron en el HIS» (solo existe si la clínica está conectada al hospital).
2. Escribe la cédula del paciente, elige el médico del HIS y pon la fecha y la hora de la cita que muestra el sistema del hospital.
3. Elige el motivo y pulsa «Investigar».
4. Revisa el veredicto y los eventos del HIS para ese cupo.
5. Si corresponde, usa «Enviar confirmación por WhatsApp» para que al paciente le lleguen el servicio, el médico, la fecha y la hora.

> 💡 Para enviar la confirmación, la consulta en vivo debe confirmar que la cita está a nombre del paciente, o debes marcar que tú lo verificaste en el HIS.

##### Preguntarle al hospital en vivo

1. Dentro del expediente, pulsa «Consultar el HIS ahora».
2. Espera unos segundos: el agente del hospital responde en su siguiente vuelta.
3. El veredicto se recalcula con lo que respondió el hospital.

> 💡 La respuesta no se guarda: si sales de la pantalla, hay que volver a consultar. La consulta en vivo se activa por clínica; si no está disponible, la pantalla te dice por qué.

##### Ver quién consultó qué

1. Pulsa «Ver las consultas registradas →».
2. Cada búsqueda, expediente abierto y dato mostrado aparece con quién lo hizo, cuándo y por qué motivo.

#### Qué ves en la pantalla

- **Veredicto:** La conclusión, con la fuente (datos de AgenIA o consulta en vivo al hospital), lo que consta, lo que no se puede afirmar y qué hacer.
- **Línea de vida de la cita:** Los pasos de la cita, de la conversación a la confirmación, la creación, el envío al hospital y su presencia en el HIS. Cada paso dice si ocurrió, si falta o si no aplica.
- **Identidad y canales:** Documento, WhatsApp, BSUID, Telegram, EPS y régimen, enmascarados. «Mostrar datos completos» los descubre y deja registro.
- **Conversación con el bot:** Lo que el paciente y el asistente se escribieron en los últimos 90 días.
- **Historial:** Todas las citas del paciente, su lista de espera, los avisos masivos y las encuestas de satisfacción.
- **Estado del espejo:** Si el agente del hospital está al día y si el HIS responde. Explica por qué algo pudo no llegar.

#### Preguntas frecuentes

##### ¿Qué quiere decir «Sin rastro»?

Que AgenIA no tiene registro con los datos que diste. No significa «no agendó». Pide el número desde el que escribió y la fecha, y vuelve a buscar.

##### ¿Qué hago si dice «Nunca confirmó»?

La conversación terminó antes de confirmar una cita (por ejemplo, el cupo lo tomó otra persona o su EPS no tenía convenio). Lo que muestra la captura suele ser el menú de opciones. Agéndale la cita ahora.

##### ¿Por qué se pide un motivo para buscar?

Porque son datos personales de salud: cada consulta queda registrada con quién la hizo y por qué, como exige la protección de datos.

##### ¿Por qué no veo la pestaña «Lo agendaron en el HIS»?

Porque tu clínica no está conectada al sistema del hospital. Sin esa conexión solo existe la investigación del lado de AgenIA.

#### Si algo no sale bien

##### Sale «El hospital no respondió a tiempo».

El agente del hospital puede estar ocupado o desconectado. Intenta de nuevo en un momento y revisa el semáforo del agente en Espejo con el HIS.

##### El veredicto es «Confirmada, no llegó» al hospital.

La pantalla dice la causa (en cola, en reintento, rendida). Revisa la Bandeja de sincronización o devuelve el evento a la cola desde Espejo con el HIS.

##### La búsqueda por nombre no encuentra a nadie.

Escribe al menos nombre y apellido. Las tildes y mayúsculas no importan.

### 🕵️ Caja Negra (Auditoría) {#auditoria}

- **Ruta:** `/dashboard/auditoria`
- **Resumen:** Los pacientes que intentaron agendar con el asistente y no lo lograron, para contactarlos y no perderlos.
- **Relacionados:** [Canales en vivo](#canales), [Rastreo de paciente](#rastreo), [Agendas (Slots)](#agenda), [Configuración](#configuracion)
- **Palabras clave:** fallos del bot, pacientes perdidos, recuperar, contactar, demanda insatisfecha, logs, trazabilidad, lista de espera, emergencia, abandono

#### Para qué sirve

Cada vez que una conversación con el asistente falla o se abandona, queda aquí con el motivo, la última frase del paciente y su número. También aparecen las posibles emergencias médicas que el bot derivó a urgencias: son las más urgentes de contactar. Desde cada tarjeta puedes abrir WhatsApp con un saludo ya escrito y dejar constancia del contacto.

#### Paso a paso

##### Recuperar a un paciente que no logró agendar

1. Deja activos «Solo pendientes» y, si quieres, «Solo recuperables».
2. Ordena «Por urgencia» para ver primero lo crítico (🔴).
3. En la tarjeta, pulsa «💬 WhatsApp»: se abre la conversación con un saludo listo para enviar.
4. Ayuda al paciente a terminar su cita.
5. Pulsa «Ver detalle» › «✓ Marcar como contactado», escribe el resultado (opcional) y confirma.

##### Atender una posible emergencia médica

1. Busca las tarjetas «🚑 Posible emergencia médica».
2. Llama o escribe al paciente de inmediato: el bot ya lo derivó al 123 o a urgencias, y el seguimiento es tuyo.
3. Marca el contacto con una nota de lo que respondió.

##### Gestionar la lista de espera

1. En la tarjeta «En lista de espera», pulsa «Ver detalle».
2. Busca por nombre o cédula.
3. Escríbele a cada paciente por WhatsApp para asignarle una cita.

> 💡 Cuando se libera un cupo, el asistente se lo ofrece al primero de la lista: con un mensaje si escribió en las últimas 24 horas (o usa Telegram) y, si no, con la plantilla «Oferta de cupo», de 7:00 a 19:00. Sin esa plantilla registrada en Configuración, o de noche, a quien lleva más de 24 horas sin escribir no le llega el aviso, pero conserva su lugar: escríbele tú.

#### Qué ves en la pantalla

- **Por contactar:** Casos recuperables de los últimos 7 días que nadie ha marcado como contactados. Es la cifra más importante.
- **Últimas 24h / Esta semana:** Cuántos fallos se registraron en ese tiempo.
- **Causa principal:** El motivo de fallo más repetido de la semana.
- **Especialidades con más demanda insatisfecha:** Servicios que los pacientes buscaron cuando no había cupos: una señal para abrir más agenda.
- **Gravedad:** 🔴 Crítico, 🟡 Atención, 🔵 Info. Filtra con los botones de colores.
- **⚡ Recuperable:** Vale la pena contactar al paciente: quería una cita y no la consiguió.
- **Ver detalle:** Mensaje del paciente, respuesta del bot, metadatos técnicos y el seguimiento.

#### Preguntas frecuentes

##### ¿Qué significa cada motivo de fallo?

Sin agenda disponible: no había cupos. EPS no encontrada o inactiva: la EPS no existe o está suspendida. EPS sin convenio para su régimen: no se puede facturar. Paciente abandonó: se rindió tras varios intentos. Cupo se ocupó: otro paciente tomó la hora. No se entendió el horario: en el menú de horarios escribió algo que no era una letra ni un día u hora (antes esto salía como «Sesión expirada»). IA caída o Error de WhatsApp: falla técnica. La tarjeta trae la explicación de cada uno.

##### ¿Cuántos registros muestra?

Los 200 más recientes con fallo, abandono o emergencia. Usa el filtro de fechas («Últimas 24h», «Últimos 7 días», «Últimos 30 días», «Todo el tiempo») para acotar.

##### ¿Por qué algunos casos no tienen botón de WhatsApp?

Si el paciente escribió por Telegram, o si WhatsApp no compartió su número (solo su BSUID), no hay enlace directo posible. La tarjeta lo indica con «✈️ Telegram» o «🔒 Sin número».

#### Si algo no sale bien

##### Muchos casos de «Sin agenda disponible».

Abre más cupos en Agendas (Slots) para los servicios que aparecen en «Especialidades con más demanda insatisfecha».

##### Casos de «Token Meta expirado» o «Error de WhatsApp».

Renueva el Access Token en Configuración › Integraciones › Canal de WhatsApp y pruébalo con «Salud de la Conexión».

##### Casos de «IA caída».

Revisa la clave de API en Configuración › Integraciones y pulsa «Probar Servicio».

### 📨 Solicitudes de Alta {#solicitudes-alta}

- **Ruta:** `/dashboard/solicitudes-alta`
- **Resumen:** Los reclamos de personas que no aparecen en el padrón de su EPS y piden revisión.
- **Relacionados:** [Padrón EPS (Altas)](#padron), [Aseguradoras (EPS)](#eps)
- **Palabras clave:** reclamo, no aparece en el padrón, no estoy afiliado, formulario de alta, petición, revisión

#### Para qué sirve

Cuando alguien intenta agendar por su EPS y su cédula no está en el padrón, el asistente le envía un formulario público para pedir revisión. Lo que la persona escribe llega aquí: documento, nombre, teléfono, EPS declarada y su caso. Tú decides si procede el alta.

#### Paso a paso

##### Revisar una solicitud

1. Entra con el filtro «Pendientes».
2. Lee el «Caso / argumento» (haz clic para desplegar el texto completo).
3. Verifica con la EPS si la persona está afiliada.
4. Si procede, actualiza el padrón de esa EPS cargando un nuevo corte en Padrón EPS (Altas).
5. Pulsa «Marcar revisada».

> 💡 Marcar revisada no da de alta a nadie: el alta solo ocurre cuando la cédula entra en un corte del padrón.

#### Qué ves en la pantalla

- **Pendientes / Revisadas / Todas:** Filtros con la cantidad de solicitudes en cada estado.
- **EPS declarada:** La EPS que la persona dice tener. Puede no coincidir con las EPS creadas en la clínica.
- **Acción:** «Marcar revisada» en las pendientes; en las revisadas, la fecha en que se revisaron.

#### Preguntas frecuentes

##### ¿Se le avisa a la persona cuando marco la solicitud como revisada?

No. Si necesitas responderle, usa el teléfono que dejó en la solicitud.

##### ¿De dónde salen estas solicitudes?

Del formulario público de alta de la clínica, al que el asistente remite a quien no figura en el padrón de su EPS.

#### Si algo no sale bien

##### Llegan muchas solicitudes de la misma EPS.

Puede que el último corte del padrón llegara incompleto. Revisa el Historial de cargas del padrón de esa EPS.

### 📝 Solicitudes de más citas {#solicitudes-citas}

- **Ruta:** `/dashboard/solicitudes-citas`
- **Resumen:** Los pacientes que llegaron al límite de citas del día o del mes y piden que se les permita agendar más.
- **Relacionados:** [Límite de citas](#limites-citas), [Caja Negra (Auditoría)](#auditoria), [Rastreo de paciente](#rastreo)
- **Palabras clave:** excepción, más de una cita, cupo extra, autorizar cita, límite diario, límite mensual, tope de citas, aprobar, rechazar

#### Para qué sirve

Cuando el asistente no le agenda a un paciente porque ya tiene el máximo de citas permitido (ver Límite de citas), le pide disculpas, le da el teléfono del hospital y le envía un enlace para pedir una revisión. Lo que el paciente escribe llega aquí: el límite que alcanzó, la cita que pedía, el motivo y su caso. Si apruebas, el asistente le deja agendar las citas adicionales que concedas, solo para ese día o ese mes.

#### Paso a paso

##### Revisar una solicitud

1. Entra con el filtro «Pendientes». El número rojo del menú dice cuántas hay.
2. Mira «Límite alcanzado» (cuántas citas tenía y para qué día o mes) y «Cita que pedía».
3. Lee el motivo y el caso (haz clic en el texto para verlo completo).
4. Si procede, pulsa «Aprobar», elige cuántas citas adicionales concedes (viene marcado lo que pidió) y, si quieres, deja una nota.
5. Si no procede, pulsa «Rechazar» y escribe el motivo.
6. Pulsa «Confirmar».

> 💡 Aprobar no agenda la cita: le permite al paciente agendarla con el asistente. Avísale por teléfono, o agéndale tú desde Agendamiento (el personal no tiene límite).

##### Llamar a quien no terminó la solicitud

1. Abre el filtro «Sin radicar»: son los pacientes a los que el asistente les envió el enlace y aún no lo han llenado.
2. Usa el teléfono de la columna «Contacto» para llamarlos si conviene.

> 💡 El enlace sirve 7 días. Después aparece como «Enlace vencido»; si el paciente vuelve a escribir al asistente, recibe uno nuevo.

##### Buscar las solicitudes de un paciente

1. Escribe su documento o su nombre en «Buscar por documento o nombre…».
2. Pulsa «Buscar». Los filtros de arriba cuentan solo lo que coincide con la búsqueda.

#### Qué ves en la pantalla

- **Pendientes / Aprobadas / Rechazadas / Todas:** Filtros con la cantidad de solicitudes en cada estado. «Todas» son las que el paciente envió.
- **Sin radicar:** Enlaces que el asistente envió y el paciente no ha llenado.
- **Límite alcanzado:** Si fue el límite diario o el mensual, el día o el mes, y cuántas citas tenía de cuántas permitidas.
- **Cita que pedía:** El servicio y la hora del cupo que eligió, y si era una cita nueva o un cambio de fecha.
- **Caso:** El motivo que eligió, lo que escribió y cuántas citas adicionales pide.
- **Acción:** «Aprobar» y «Rechazar» en las pendientes; en las revisadas, quién decidió, cuándo, las citas concedidas y la nota.

#### Preguntas frecuentes

##### ¿Qué pasa cuando apruebo?

El asistente suma las citas adicionales que concediste al límite de la clínica, solo para ese paciente y solo para ese día o ese mes. Al mes siguiente vuelve el límite normal.

##### ¿Se le avisa al paciente cuando decido?

No por mensaje. Si abre de nuevo el enlace, ve si fue aprobada o no. Lo mejor es llamarlo al teléfono que dejó.

##### ¿El paciente puede enviar muchas solicitudes?

No. Mientras tenga una pendiente para ese día o mes, el asistente no le envía otra; y después de 3 enviadas para el mismo periodo, solo le da el teléfono del hospital.

##### ¿Quién puede aprobar?

El administrador y el agente de reservas de la clínica. Si dos personas la abren a la vez, solo cuenta la primera decisión.

#### Si algo no sale bien

##### Aprobé, pero el asistente sigue sin agendarle.

Revisa que la cita que pide sea del mismo día o mes de la solicitud: la aprobación no sirve para otros periodos. Si pide otra fecha con el límite lleno, necesita otra solicitud, o agéndale desde Agendamiento.

##### «La solicitud ya fue revisada o no existe».

Otra persona la decidió primero. Recarga la página para ver la decisión.

## Categoría: Agenda y catálogos {#catalogos}

Lo que el asistente necesita para ofrecer citas: servicios, médicos, EPS, padrón y cupos.

### 📅 Agendas (Slots) {#agenda}

- **Ruta:** `/dashboard/agenda`
- **Resumen:** El calendario de cupos: crea la disponibilidad de cada médico para que el asistente pueda ofrecer y reservar citas.
- **Disponibilidad:** Si la clínica está conectada al sistema del hospital con el modo de agenda en ON (Espejo con el HIS), los cupos de los médicos homologados los crea y actualiza el hospital: lo que crees a mano para esos médicos puede desaparecer en la siguiente sincronización.
- **Relacionados:** [Médicos](#medicos), [Servicios de Salud](#servicios), [Aseguradoras (EPS)](#eps), [Espejo con el HIS](#espejo), [Configuración](#configuracion)
- **Palabras clave:** cupos, turnos, horarios, disponibilidad, calendario, abrir agenda, aperturar, generar slots, clonar, copiar día, jornada

#### Para qué sirve

Un cupo (slot) es un espacio de tiempo de un médico en el que se puede agendar una cita. El asistente solo ofrece horas que existen aquí como cupos libres. En esta pantalla los creas en bloque para una jornada, copias la agenda de un día a otro y ves en colores cuáles están libres, cuáles son exclusivos de una EPS y cuáles ya tienen cita. Solo el administrador abre, copia o borra cupos, y cada vez queda constancia de quién lo hizo.

#### Paso a paso

##### Abrir cupos para un médico (aperturar agenda)

1. En la vista Semana o Día, haz clic en un espacio vacío del calendario: se abre el «Generador Avanzado de Agenda» con esa fecha y hora ya puestas.
2. Elige el especialista. El servicio se toma del médico automáticamente.
3. En «Restricción Preferencial de Convenio (EPS)», deja «Cupos Universales» para cualquier EPS, o elige una EPS para reservar esos cupos solo a sus afiliados.
4. Revisa la fecha, la «Duración Base por Paciente» (15, 20, 30 o 60 minutos) y la hora de inicio y de fin de la jornada.
5. Pulsa «Generar Slots H.I.S». Verás cuántos cupos se abrieron y cuántas colisiones se omitieron.

> 💡 Solo se crean cupos completos: si al final de la jornada no cabe un cupo entero, ese no se crea. Una colisión es una hora en la que ese médico ya tenía cupo; no se duplica.

##### Copiar la agenda de un día a otro (Clonar Día)

1. Pulsa «Clonar Día».
2. Elige el médico, el «Día Origen» (el que ya tiene cupos) y el «Día Destino».
3. Pulsa «Clonar Agenda». Se replican los mismos horarios e intervalos en el día destino.

> 💡 El día origen debe tener cupos de ese médico y no puede ser el mismo día destino.

##### Moverte por el calendario

1. Usa «Ant», «Hoy» y «Sig» para cambiar de periodo.
2. Cambia la vista con «Mes», «Semana», «Día» o «Agenda» (lista).
3. Haz clic en un cupo para ver su médico, si está reservado o disponible y su EPS.

> 💡 El calendario muestra los cupos desde 30 días atrás.

#### Qué ves en la pantalla

- **Azul · Universal:** Cupo libre para pacientes de cualquier EPS (o particulares).
- **Verde · EPS Exclusiva:** Cupo libre que el asistente solo ofrece a afiliados de esa EPS.
- **Rojo · Reservado:** El cupo ya tiene una cita vigente.
- **Duración Base por Paciente:** 15 min (triage exprés), 20 min (cita general), 30 min (especialista) o 60 min (consulta larga).

#### Preguntas frecuentes

##### ¿Cómo borro un cupo?

El calendario todavía no tiene botón para borrar cupos. Para dejar de ofrecer la agenda de un médico, apaga «Reservas por WhatsApp» o «Estado Activo» en Médicos. Si necesitas borrar cupos concretos, pídelo en Soporte.

##### ¿Por qué el asistente no ofrece un cupo que veo libre?

Revisa que: el cupo no sea exclusivo de otra EPS; el médico esté activo y con «Reservas por WhatsApp» encendido; el servicio esté activo; la hora no haya pasado; y «Agendar citas por el asistente» esté encendido en Configuración. También puede estar apartado unos minutos para otro paciente que lo eligió y está terminando su registro.

##### ¿Cuántas opciones de hora le muestra el asistente al paciente?

Las que definas en Configuración › Asistente Virtual › «Horarios que ofrece el asistente» (entre 2 y 12; recomendado 6), repartidas entre mañana y tarde. Si ninguna le sirve, el paciente puede elegir la opción «Otro día», que aparece al final cuando hay cupos en días siguientes, o escribir lo que prefiere: «mañana», «el jueves 30», «en la tarde», «más temprano», «otro horario» o una hora («para las 3:30»). El asistente le busca cupos de eso dentro del plazo para agendar, sin repetir los que ya vio (con una hora, le muestra los más cercanos a ella); si pide un día después del plazo, le dice desde cuándo escribir. También entiende la letra dentro de una frase («Perdón, es la B») y, si dos horarios coinciden con lo que escribe, el médico que nombre («a las 9 con el doctor Santiago»).

##### ¿El asistente le guarda el horario al paciente mientras se registra?

Sí, durante 10 minutos y solo dentro de AgenIA: mientras escribe su cédula, nombres y fecha de nacimiento, ese horario no se le ofrece a otro paciente del chat. El hospital sí puede tomarlo, porque AgenIA no escribe en su agenda. Si cuando confirma el horario ya no está, el asistente le muestra en el mismo mensaje los que quedan.

#### Si algo no sale bien

##### Sale «Médico inválido o sin servicio configurado».

Asígnale un servicio al médico en Médicos › Modificar Perfil.

##### Sale «La hora de inicio debe ser menor a la hora de fin».

Corrige la jornada: el fin debe ser posterior al inicio, el mismo día.

##### Sale «El rango de tiempo es muy corto…».

La jornada es más corta que la duración elegida. Alarga la jornada o elige una duración menor.

##### Sale «No se encontraron agendas en la fecha de origen para clonar».

Ese médico no tiene cupos el día origen. Elige otro día o crea primero los cupos.

##### Se abrieron 0 cupos y todo fueron colisiones.

Esos cupos ya existían. Mira el calendario en vista Día para confirmarlo.

### 💉 Servicios de Salud {#servicios}

- **Ruta:** `/dashboard/servicios`
- **Resumen:** El catálogo de especialidades que la clínica ofrece y que el asistente puede agendar.
- **Relacionados:** [Médicos](#medicos), [Agendas (Slots)](#agenda), [Analíticas de Negocio](#analiticas)
- **Palabras clave:** especialidades, catálogo, consultas, odontología, medicina general, tipo de cita

#### Para qué sirve

Cada médico pertenece a un servicio (Medicina General, Odontología, Pediatría…) y cada cupo hereda el servicio de su médico. Los servicios activos son el menú que el asistente le muestra al paciente cuando pide una cita, y con ellos se agrupan las Analíticas. Con la clínica conectada al hospital, cada cita trae el servicio que le dio el hospital, y AgenIA solo trabaja con las citas de servicios activos (y de médicos con WhatsApp ON): recordatorios, respuestas del asistente, cancelar y cambiar la fecha. Crear, activar, inactivar o eliminar un servicio queda registrado con quién lo hizo.

#### Paso a paso

##### Crear un servicio

1. Pulsa «Alta de Especialidad».
2. Escribe el «Nombre Oficial del Servicio», tal como quieres que lo vea el paciente.
3. Deja marcada «Apertura Inmediata» si debe quedar activo ya.
4. Pulsa «Registrar».

##### Dejar de ofrecer un servicio sin borrarlo

1. Busca el servicio.
2. Apaga el interruptor de la columna «Servicio Habitado».
3. El asistente deja de mostrarlo; su historia se conserva.

##### Eliminar un servicio

1. Pulsa el botón de eliminar de la fila.
2. Confirma.

> 💡 Solo se puede eliminar si no tiene médicos asignados ni cupos creados. Si los tiene, inactívalo.

#### Qué ves en la pantalla

- **Especialista(s):** Cuántos médicos tienen asignado ese servicio.
- **Agendas Creadas:** Cuántos cupos se han creado para ese servicio (incluidos los pasados).
- **Servicio Habitado:** El interruptor de activo o inactivo.
- **Buscar Servicio…:** Filtra la tabla por nombre mientras escribes.

#### Preguntas frecuentes

##### ¿Qué pasa si inactivo un servicio?

El asistente deja de ofrecerlo en su menú, y AgenIA deja de trabajar con sus citas: no les manda recordatorio, el asistente no las cancela ni les cambia la fecha, y tampoco se pueden crear, cancelar ni mover desde el panel si la clínica está conectada al hospital (se hace en el sistema del hospital). Las citas y los cupos existentes no se borran.

##### ¿Puedo cambiarle el nombre a un servicio?

Esta pantalla no permite editar el nombre. Si lo necesitas, pídelo en Soporte.

#### Si algo no sale bien

##### Sale «Ya existe un servicio con ese nombre en esta clínica».

Búscalo en la tabla: quizá está inactivo. Actívalo en vez de crear otro.

##### Sale «No se puede eliminar. Tiene … médicos asignados y/o … slots de agenda».

Inactívalo con el interruptor. Así deja de ofrecerse sin perder la historia.

### ⚕️ Médicos {#medicos}

- **Ruta:** `/dashboard/medicos`
- **Resumen:** Los perfiles de los médicos: su servicio, sus datos, su acceso al sistema y si se puede agendar con ellos por WhatsApp.
- **Relacionados:** [Servicios de Salud](#servicios), [Agendas (Slots)](#agenda), [Usuarios](#usuarios), [Espejo con el HIS](#espejo)
- **Palabras clave:** doctores, especialistas, profesionales, plantilla médica, staff, agregar doctor, tarjeta profesional, buscar médico, filtrar médicos, código del hospital

#### Para qué sirve

Cada médico tiene una tarjeta con su servicio, tarjeta profesional, cédula y teléfono. Crear un médico también le crea una cuenta para entrar a AgenIA con su correo y contraseña, donde verá su propia agenda. Desde aquí decides si está activo y si el asistente puede agendar citas con él. Solo el administrador crea, cambia o da de baja médicos, y cada cambio queda registrado con quién lo hizo y qué cambió (por ejemplo, encender o apagar su WhatsApp).

#### Paso a paso

##### Buscar un médico

1. Escribe en el buscador («🔎 Buscar por nombre, cédula, servicio…») lo que sepas de él: nombre o parte del nombre, cédula, servicio, tarjeta profesional, teléfono, correo o su código en el sistema del hospital (por ejemplo «RU69»). No importan mayúsculas ni tildes, y la cédula o el teléfono sirven sin puntos ni guiones.
2. Con varias palabras, aparecen los que tienen todas («yulieth general»).
3. Si quieres, acota con los botones «WhatsApp: Todos · ON · OFF» y «Estado: Todos · Activos · Inactivos»; cada uno dice cuántos hay.
4. «Mostrando X de Y médicos» dice cuántos quedaron. «Limpiar» quita la búsqueda y los botones.

##### Agregar un médico

1. Pulsa «🩺 Agregar Médico».
2. En «Credenciales (Login)», escribe su correo y una contraseña: al menos 10 caracteres, con letras y números, sin el usuario del correo y que no sea una de fábrica (como `temporal123`).
3. En «Datos Profesionales», escribe el nombre completo y la cédula, elige el «Servicio Adscrito» y, si los tienes, la tarjeta profesional y el teléfono.
4. Deja marcados «Estado Activo» y «Reservas por WhatsApp» si ya puede recibir citas.
5. Pulsa «Guardar Médico».

##### Pausar las citas por WhatsApp de un médico

1. Pulsa «Modificar Perfil» en su tarjeta.
2. Desmarca «Reservas por WhatsApp».
3. Guarda. El asistente deja de ofrecer sus cupos, de recordar sus citas y de responder por ellas. Si la clínica está conectada al hospital, sus citas se gestionan solo en el sistema del hospital (ni el asistente ni el panel las crean, cancelan o mueven); sin conexión, el personal puede seguir agendándolo.

##### Cambiar la contraseña de un médico

1. Pulsa «Modificar Perfil».
2. Escribe la nueva contraseña, con la misma regla que al crearlo.
3. Guarda.

> 💡 Al editar, si dejas la contraseña vacía, no cambia. Si pones una nueva, se cierran las sesiones que el médico tenga abiertas: entra de nuevo con la clave nueva.

#### Qué ves en la pantalla

- **Activo / Inactivo:** Si el médico está disponible para agendamiento.
- **📱 WhatsApp ON / OFF:** Si AgenIA trabaja con las citas de este médico: el asistente le agenda, recuerda sus citas, responde a sus pacientes y, si están encendidos, cancela o cambia la fecha — solo las de servicios activos en Servicios (un mismo médico puede atender medicina general y también hipertensos o lectura de exámenes). OFF: sus citas se ven en AgenIA (las trae el hospital), pero no reciben recordatorios ni se gestionan por el asistente ni por el panel; se manejan directamente en el sistema del hospital.
- **T.P (Licencia):** Su tarjeta profesional.
- **Código en el hospital:** Con la clínica conectada al hospital, el código del médico en el sistema del hospital (por ejemplo «RU69»). Sirve para buscarlo.
- **🗑️ Dar de baja:** Elimina al médico y su acceso. No se puede deshacer.

#### Preguntas frecuentes

##### ¿Qué diferencia hay entre «Estado Activo» y «Reservas por WhatsApp»?

«Estado Activo» dice si el médico está disponible en la clínica. «Reservas por WhatsApp» (WhatsApp ON) dice si AgenIA trabaja con sus citas: agendar, recordatorios, respuestas del asistente, cancelar y cambiar la fecha. El asistente solo agenda con médicos que tengan las dos cosas encendidas, y solo le escribe a los pacientes de médicos con WhatsApp ON por citas de servicios activos.

##### ¿Es mejor inactivar o dar de baja?

Inactivar. Dar de baja borra su acceso y su agenda futura, y no se puede deshacer. Inactivar lo saca del agendamiento y conserva todo.

##### Mi clínica está conectada al hospital: ¿cómo llegan los médicos del HIS?

Cada médico del hospital se empareja con su perfil de aquí en Espejo con el HIS › «Homologar médicos». Sin ese paso, el médico no recibe cupos ni citas del hospital.

#### Si algo no sale bien

##### Sale «Conflicto: el correo ya está en uso, o la cédula/Tarjeta Profesional ya existe en esta Clínica».

Ya hay una cuenta con ese correo (búscala en Usuarios) o un médico con esa cédula o tarjeta profesional.

##### No aparece el servicio que necesito en «Servicio Adscrito».

Créalo primero en Servicios de Salud.

##### Al guardar sale un error sobre la contraseña.

No cumple la regla: al menos 10 caracteres, letras y números, sin el usuario del correo y que no sea una de fábrica (`admin123`, `temporal123`…). Escribe otra.

### 🏦 Aseguradoras (EPS) {#eps}

- **Ruta:** `/dashboard/eps`
- **Resumen:** Las EPS con las que la clínica tiene convenio y por las que el asistente puede agendar.
- **Relacionados:** [Padrón EPS (Altas)](#padron), [Solicitudes de Alta](#solicitudes-alta), [Agendas (Slots)](#agenda)
- **Palabras clave:** aseguradoras, convenios, entidades, nit, régimen, subsidiado, contributivo, sura, sanitas, nueva eps

#### Para qué sirve

Cuando un paciente agenda, el asistente le pregunta su EPS y la busca en esta lista. Una EPS activa permite agendar por ella (si la persona está en su padrón). Una EPS suspendida es una que la clínica atiende, pero no por el asistente: al paciente se le pide agendar por teléfono con su EPS, sin ofrecerle la cita particular. Una EPS que no está en la lista la clínica no la atiende: el asistente le ofrece la cita particular (pago directo). Aquí también ves cuántos pacientes y citas tiene cada una. Solo el administrador crea, cambia, activa, inactiva o elimina EPS, y cada cambio queda registrado con quién lo hizo.

#### Paso a paso

##### Crear una EPS

1. Pulsa «Nuevo Convenio».
2. Escribe el nombre como lo dicen los pacientes (por ejemplo «Sura», «Sanitas», «Mutual Ser») y, si lo tienes, el NIT.
3. Deja marcado «Convenio Activo Inmediatamente».
4. Guarda.

##### Suspender (inactivar) un convenio

1. Busca la EPS por nombre o NIT.
2. Apaga el interruptor de «Estado Operativo». Queda «Suspendida».

> 💡 El asistente no agenda por una EPS suspendida: le dice al paciente que la agende por teléfono con su EPS y no le ofrece la cita particular.

##### Registrar una EPS que la clínica atiende pero no por el asistente

1. Pulsa «Nuevo Convenio».
2. Escribe el nombre como lo dicen los pacientes (por ejemplo «Nueva EPS») y su NIT.
3. Desmarca «Convenio Activo Inmediatamente».
4. Guarda. Queda «Suspendida»: a sus pacientes el asistente les pide agendar por teléfono, en vez de ofrecerles la cita particular.

#### Qué ves en la pantalla

- **NIT / Registro:** El NIT de la EPS, si lo registraste.
- **Métricas:** Pacientes afiliados (pctes.) y citas históricas de esa EPS.
- **Estado Operativo:** «Vigente» o «Suspendida».

#### Preguntas frecuentes

##### ¿Por qué un paciente de una EPS activa no puede agendar?

Lo más común: su cédula no está en el padrón de esa EPS (Padrón EPS), o la EPS no tiene convenio para su régimen (subsidiado o contributivo). La Caja Negra te dice el motivo exacto.

##### ¿Puedo eliminar una EPS?

Solo si no tiene pacientes ni citas. Si los tiene, suspéndela: deja de usarse y la historia se conserva.

#### Si algo no sale bien

##### Sale «Ya existe una EPS con ese nombre o NIT en esta clínica».

Búscala: quizá está suspendida. Actívala en vez de crear otra.

##### La Caja Negra muestra «EPS no encontrada».

El paciente nombró una EPS que no existe aquí. Si hay convenio con ella, créala; si es otro nombre de una existente, revisa cómo está escrita.

##### La Caja Negra muestra «EPS sin convenio para su régimen».

La combinación EPS y régimen no se puede facturar en esta clínica. Si debería poder, pide la revisión en Soporte.

### 🪪 Padrón EPS (Altas) {#padron}

- **Ruta:** `/dashboard/padron`
- **Resumen:** El listado de afiliados de cada EPS habilitados para agendar por su EPS. Se carga por archivo CSV o Excel.
- **Relacionados:** [Aseguradoras (EPS)](#eps), [Solicitudes de Alta](#solicitudes-alta), [Caja Negra (Auditoría)](#auditoria)
- **Palabras clave:** afiliados, altas, listado, base de datos, cargar archivo, csv, excel, importar, corte, censo, habilitar pacientes, aceptar errores, ignorar filas, encabezado, columna de cédula

#### Para qué sirve

Solo quien está en el padrón de su EPS puede agendar por esa EPS con el asistente. Las citas particulares (pago directo) no lo necesitan. Cada archivo que cargas es un «corte»: reemplaza por completo el padrón activo de la EPS elegida, así que quien no venga en el corte queda inactivo.

#### Paso a paso

##### Cargar (subir) o actualizar el padrón de una EPS

1. Si es la primera vez, descarga la «Plantilla CSV» para ver el formato.
2. Haz clic en el recuadro y elige el archivo .csv o .xlsx (máximo 6 MB), tal como lo manda la EPS. El sistema encuentra solo la columna con la cédula del afiliado (no la del cotizante), la del régimen y las de teléfono; las demás columnas y las filas de título se ignoran.
3. Elige la «EPS de este archivo». Si el archivo la menciona, se preselecciona sola: verifica que sea la correcta.
4. Pulsa «1. Validar archivo». No se toca nada todavía: solo ves el reporte.
5. Lee el reporte: afiliados listos, qué columnas usó, filas reacomodadas, errores, advertencias y cuántos quedarían desactivados.
6. Si algunas filas tienen error, corrige el archivo y valida de nuevo, o sigue sin ellas (ver «Importar aunque algunas filas tengan error»).
7. Pulsa «2. Importar corte».

> 💡 Un archivo es una EPS. Cambiar el archivo o la EPS obliga a validar otra vez. Puedes cargar el mismo archivo las veces que necesites.

##### Importar aunque algunas filas tengan error

1. Valida el archivo. Si solo fallaron algunas filas, el reporte sale en amarillo y dice cuántos afiliados sí se pueden importar.
2. Revisa la lista de errores (o descarga el «reporte completo»).
3. Marca «Acepto importar el resto e ignorar las … fila(s) con error».
4. Pulsa «2. Importar corte». Las filas con error no entran y quedan en el Historial de cargas como RECHAZADO.

> 💡 Si alguna de esas personas estaba activa en el padrón, queda inactiva hasta un corte que la traiga bien. Si el error es del archivo entero (no se encontró la columna de la cédula, no es un CSV, supera el máximo de filas), no hay nada que aceptar: hay que corregirlo.

##### Confirmar una baja masiva

1. Si el corte desactivaría más del 10 % del padrón activo de esa EPS, aparece un aviso en amarillo.
2. Revisa que el archivo esté completo: un archivo incompleto daría de baja a mucha gente.
3. Si es correcto, marca «Confirmo que el archivo es correcto y completo…» e importa.

##### Buscar a una persona en el padrón

1. Escribe su cédula o nombre en «Buscar por cédula o nombre…».
2. Pulsa «Buscar». La tabla muestra su EPS, teléfono, estado y última actualización.

##### Ver el historial de cargas

1. Pulsa «Historial de cargas».
2. Filtra por EPS, fechas o «Solo cortes con rechazos».
3. En el buscador por documento ves en qué cortes apareció una persona y qué le pasó en cada uno (creado, actualizado, reactivado, rechazado…).

##### Vaciar el padrón de una EPS

1. Abre «Vaciar padrón de una EPS».
2. Elige la EPS y qué borrar: todo, solo los activos o solo los inactivos.
3. Pulsa «Ver cuántos se eliminarían».
4. Escribe el nombre de la EPS para confirmar y pulsa «Eliminar definitivamente».

> 💡 Esto borra para siempre (no es una baja como la de un corte) y no se recupera recargando un archivo. Úsalo solo para limpiar errores.

#### Qué ves en la pantalla

- **Pacientes en padrón / Dados de alta (activos):** Total de registros y cuántos pueden agendar hoy.
- **De alta / Inactivo:** Activo: puede agendar por su EPS. Inactivo: no vino en el último corte.
- **Columnas usadas:** Qué columna del archivo tomó el sistema para la cédula, el régimen y el teléfono. Si no es la que esperabas, cámbiale el nombre en el archivo.
- **Filas reacomodadas:** Filas que venían corridas porque un nombre o una dirección traía un separador de más o de menos. El sistema las acomodó solo y sí se importan; la nota queda en el Historial de cargas.
- **Advertencias:** Líneas con cédula duplicada o inválida. No bloquean la importación: esas líneas se ignoran.
- **Errores:** Filas que no se pudieron leer, por ejemplo un régimen que no es SUBSIDIADO ni CONTRIBUTIVO. Puedes aceptar ignorarlas e importar el resto. En rojo, un error del archivo entero: hay que corregirlo.
- **(nombre en el HIS):** La persona está en el padrón pero su nombre lo tiene el sistema del hospital.

#### Preguntas frecuentes

##### ¿Qué pasa con alguien que estaba en el padrón y no viene en el nuevo archivo?

Queda inactivo: ya no puede agendar por esa EPS. Si vuelve en un corte posterior, se reactiva.

##### ¿Por qué no aparece mi EPS en la lista?

Solo aparecen las EPS activas. Créala o actívala primero en Aseguradoras (EPS).

##### ¿Mi archivo de Excel sirve tal cual?

Sí, si es .xlsx. Si está en otro formato, ábrelo y usa Archivo › Guardar como › CSV UTF-8 o Excel (.xlsx). No puede estar protegido con contraseña.

##### ¿Tengo que arreglar el archivo que manda la EPS?

No. Súbelo como llega: el sistema reconoce los encabezados aunque cambien de nombre entre un corte y otro (por ejemplo, Numero_Identificacion o Documento) y no confunde la cédula del afiliado con la del cotizante. Solo si sale «No se encontró la columna con la cédula del afiliado» hay que cambiarle el nombre a esa columna.

##### ¿Qué teléfono se guarda?

El primer celular que traiga la fila, buscando en todas las columnas de teléfono: primero las del afiliado y después las de su contacto. Si no hay celular, un fijo de 10 dígitos. Los números de 7 dígitos y el relleno como 2000000 no se guardan, y si una persona ya tenía uno así, se borra al cargar el corte.

#### Si algo no sale bien

##### Sale «Extensión no permitida».

Solo se aceptan .csv y .xlsx. Guarda el archivo en uno de esos formatos.

##### Sale «… parece ser … no un CSV de texto».

El archivo tiene extensión .csv pero es otro formato. Expórtalo como «CSV UTF-8 (delimitado por comas)» o cárgalo como .xlsx.

##### Sale «El archivo supera el tamaño máximo permitido (6 MB)».

Quita columnas que no se usan (solo hace falta la cédula) o divide el archivo.

##### El botón «2. Importar corte» no se activa.

Primero valida el archivo. Si hay filas con error, marca «Acepto importar el resto e ignorar…». Si hay aviso de baja masiva, marca la confirmación. Si el reporte sale en rojo, el archivo no se puede importar: corrige lo que dice.

##### Sale «No se encontró la columna con la cédula del afiliado».

El sistema no reconoció ningún encabezado como el documento del afiliado. El mensaje lista las columnas del archivo: cámbiale el nombre a la que tiene el documento por «cedula» y valida de nuevo.

## Categoría: Indicadores {#indicadores}

Cifras de citas, de conversaciones y de satisfacción de los pacientes.

### 📊 Analíticas de Negocio {#analiticas}

- **Ruta:** `/dashboard/analytics`
- **Resumen:** Indicadores de las citas: total, completadas, canceladas, y cómo se reparten por especialidad, EPS, origen y día.
- **Relacionados:** [Canales en vivo](#canales), [Encuestas (CSAT)](#encuestas), [Visión General](#vision-general)
- **Palabras clave:** estadísticas, métricas, indicadores, kpi, reportes, informes, gráficas, business intelligence, bi, tendencias

#### Para qué sirve

Responde preguntas de gestión: qué especialidad se pide más, qué EPS mueve más citas, cuántas llegan por el asistente frente a las del personal o del hospital, y cómo va el volumen día a día. Las cifras se calculan con la fecha de la cita, no con la fecha en que se agendó.

#### Paso a paso

##### Ver un periodo concreto

1. Elige la «Fecha Inicio» y la «Fecha Fin».
2. Pulsa «Filtrar».
3. Para volver a ver todo, pulsa la X («Limpiar filtros»).

> 💡 Los días se cuentan completos en hora de Colombia.

#### Qué ves en la pantalla

- **Total Citas:** Todas las citas del periodo, en cualquier estado.
- **Completadas:** Citas que el sistema cerró como completadas. Marcar «✅ Asistió» en Visión General no las suma aquí: la asistencia se guarda aparte.
- **Canceladas:** Citas anuladas por el paciente, el personal o el hospital.
- **Demanda por Especialidad:** Barras con las citas de cada servicio.
- **Volumen de Agendamiento (Diario):** Citas por día de la cita.
- **Cuota de Mercado por EPS:** Reparto de citas por EPS. «Particular / Sin EPS» agrupa las citas sin EPS.
- **Origen de la Cita:** WHATSAPP, TELEGRAM, MANUAL (personal) y MIRROR (agendadas en el hospital).

#### Preguntas frecuentes

##### ¿Por qué el total no es igual a Completadas más Canceladas?

Porque el total también cuenta las citas vigentes (programadas), que todavía no tienen un cierre.

##### ¿Qué diferencia hay con Canales en vivo?

Analíticas mira las citas. Canales en vivo mira las conversaciones de WhatsApp y Telegram: quién escribe, cuántos agendan y dónde se pierden.

##### ¿Incluye las citas agendadas en el hospital?

Sí. Aparecen con origen MIRROR.

#### Si algo no sale bien

##### Sale «No pudimos cargar la información de analíticas».

El servicio de AgenIA no respondió. Recarga en un minuto; si sigue igual, repórtalo en Soporte.

##### Una gráfica dice «Sin datos».

No hay citas en ese periodo. Amplía las fechas.

### 📈 Canales en vivo {#canales}

- **Ruta:** `/dashboard/canales`
- **Resumen:** WhatsApp y Telegram en cifras, actualizadas cada 30 segundos: quién escribe, cuántos agendan y dónde se pierden.
- **Relacionados:** [Caja Negra (Auditoría)](#auditoria), [Analíticas de Negocio](#analiticas), [Configuración](#configuracion)
- **Palabras clave:** conversaciones, mensajes, tiempo real, monitor, conversión, embudo, horas pico, whatsapp, telegram, estadísticas del bot

#### Para qué sirve

Muestra lo que está pasando en las conversaciones del asistente. Te sirve para detectar a tiempo un problema (si sube «Con problema»), medir cuántos de los que escriben terminan con cita (la conversión) y saber a qué horas hay más movimiento. Mirar esta pantalla no gasta inteligencia artificial: solo cuenta lo que ya está en la base de datos.

#### Paso a paso

##### Elegir el periodo

1. Pulsa «Hoy», «Semana», «Mes» o «Año».
2. Para otras fechas, pulsa «Personalizado» y elige desde y hasta (la inicial no puede ser posterior a la final).

##### Pausar o actualizar las cifras

1. El punto verde «En vivo» indica que se actualiza cada 30 segundos mientras la pestaña está visible.
2. Pulsa ⏸ para pausar (útil para analizar sin que cambien los números) y ▶ para reanudar.
3. Pulsa ⟳ para actualizar en el momento.

##### Leer la gráfica de un canal

1. Cada canal tiene cuatro líneas: personas escribiendo, citas pedidas, escribieron y no agendaron, y con problema.
2. Haz clic en un nombre de la leyenda para ocultar o mostrar su línea.
3. Pulsa «Ver tabla» para ver los números exactos de cada tramo.

#### Qué ves en la pantalla

- **Personas escribiendo:** Personas distintas que le escribieron al bot. Debajo, el total de mensajes.
- **Citas pedidas:** Citas agendadas por ese canal. «Conversión» es el porcentaje de quienes escribieron que agendó.
- **Escribieron y no agendaron:** Personas sin cita. No cuenta a quien vino a cancelar o reprogramar.
- **Con problema:** Personas con un fallo del bot o que abandonaron tras los reintentos.
- **Vinieron a gestionar una cita:** Personas que vinieron a cancelar o reprogramar.
- **Embudo de la conversación:** De quienes escribieron: cuántos agendaron, gestionaron una cita o no agendaron.
- **¿Qué pasó con las citas pedidas?:** Su estado actual: vigentes, atendidas, canceladas o no asistió.
- **Principales motivos de fallo:** Los 8 motivos más frecuentes, por canal.
- **Horas pico:** Mensajes por día de la semana y hora, de los dos canales juntos.

#### Preguntas frecuentes

##### ¿Por qué «Qué vinieron a hacer» y los motivos de fallo no muestran fechas antiguas?

Vienen de la Caja Negra del bot, que guarda un número limitado de días. La nota de cada tarjeta dice cuántos.

##### ¿Qué diferencia hay con la Caja Negra?

Canales en vivo cuenta. La Caja Negra te muestra cada caso para que puedas contactar al paciente.

#### Si algo no sale bien

##### Crecen los casos de «Sin agenda disponible».

Abre más cupos en Agendas (Slots) o revisa los médicos con «Reservas por WhatsApp» apagado.

##### Crecen los casos de «No está en el padrón de la EPS».

Actualiza el padrón de esa EPS y revisa las Solicitudes de Alta.

##### Aparece «IA no disponible».

Ve a Configuración › Integraciones y pulsa «Probar Servicio» en Salud de la Conexión.

##### Aparece «Error enviando la respuesta».

Revisa el canal de WhatsApp (token de Meta) en Configuración › Integraciones.

### ⭐ Encuestas (CSAT) {#encuestas}

- **Ruta:** `/dashboard/configuracion/integraciones/surveys`
- **Resumen:** Las calificaciones de 1 a 5 estrellas que dejan los pacientes sobre el asistente virtual.
- **Relacionados:** [Canales en vivo](#canales), [Analíticas de Negocio](#analiticas)
- **Palabras clave:** satisfacción, calificaciones, estrellas, opiniones, comentarios, feedback, nps, calidad

#### Para qué sirve

Cuando una conversación con el asistente se cierra (por ejemplo, tras agendar, cancelar o cambiar una cita, o al quedar en lista de espera), el asistente le envía al paciente un enlace de un solo uso para calificar la atención. Aquí ves cada respuesta: quién, su teléfono, las estrellas, su ánimo y su comentario.

#### Paso a paso

##### Revisar las opiniones

1. Ordena por «Calificación» para ver primero las peores (pulsa el encabezado; otra vez para invertir).
2. Ordena por «Fecha» para ver las más recientes.
3. Pasa el cursor sobre un mensaje largo para leerlo completo.
4. Pulsa «Refrescar» para traer las nuevas.

#### Qué ves en la pantalla

- **Calificación:** De 1 a 5 estrellas, con el ánimo detectado (Feliz, Neutral o Negativo).
- **Mensaje:** El comentario libre del paciente, si dejó uno.

#### Preguntas frecuentes

##### ¿A quién se le envía la encuesta?

A quien cierra una gestión con el asistente: agendó, canceló, cambió la fecha o quedó en lista de espera. Nunca a quien reportó una posible emergencia. El enlace vale 24 horas y se usa una vez.

##### ¿Puedo responderle al paciente?

No desde esta pantalla. Si un comentario lo amerita, usa el teléfono de la fila.

#### Si algo no sale bien

##### Sale «No se pudieron cargar las encuestas de tu clínica».

Pulsa «Refrescar». Si sigue, repórtalo en Soporte.

## Categoría: Administración {#administracion}

El asistente virtual, sus canales, las cuentas del personal y el soporte técnico.

### 🚦 Límite de citas {#limites-citas}

- **Ruta:** `/dashboard/limites-citas`
- **Resumen:** Cuántas citas puede tener un mismo paciente por el asistente: un máximo por día y otro por mes.
- **Disponibilidad:** Solo la ve y la cambia el Administrador. El Agente de Reservas no la ve; sí ve Solicitudes de más citas.
- **Relacionados:** [Solicitudes de más citas](#solicitudes-citas), [Configuración](#configuracion), [Rastreo de paciente](#rastreo)
- **Palabras clave:** tope de citas, máximo de citas, una cita al día, tres citas al mes, restricción, acaparar cupos, cuota, límite diario, límite mensual

#### Para qué sirve

Evita que una misma persona acapare los cupos del asistente. Si un paciente ya tiene el máximo de citas para ese día o ese mes, el asistente no le agenda otra (ni le asigna un cupo de la lista de espera, ni le cambia una cita a esa fecha): le pide disculpas, le da el teléfono del hospital y le envía un enlace para pedir una revisión, que llega a Solicitudes de más citas. Al empezar vienen encendidos con 1 cita al día y 3 al mes.

#### Paso a paso

##### Cambiar el máximo de citas

1. En «Citas por paciente en un mismo día» o «en un mismo mes», escribe el máximo en «Máximo de citas por día / por mes».
2. Revisa a la derecha el «Mensaje que recibe el paciente».
3. Pulsa «Guardar cambios».

> 💡 Aplica desde el siguiente mensaje que reciba el asistente, sin reiniciar nada. El día va de 1 a 10 y el mes de 1 a 31.

##### Apagar o encender un límite

1. Pulsa el interruptor del límite (día o mes): verde es encendido.
2. Pulsa «Guardar cambios».

> 💡 Con un límite apagado el asistente no revisa cuántas citas tiene el paciente en ese periodo. Los dos son independientes.

#### Qué ves en la pantalla

- **Veces que se aplicó el límite:** Cuántas veces en los últimos 30 días el asistente frenó una cita o un cambio de fecha por el límite.
- **Solicitudes radicadas / Pendientes por revisar:** Cuántos pacientes pidieron revisión en 30 días y cuántas esperan decisión. La tarjeta de pendientes lleva a Solicitudes de más citas.
- **Mensaje que recibe el paciente:** Un ejemplo de lo que le escribe el asistente, con los valores que estás editando.
- **Cómo se cuenta:** Las reglas del conteo y quién hizo el último cambio y cuándo.

#### Preguntas frecuentes

##### ¿Se cuenta por el día en que pidió la cita o por el día de la cita?

Por el día de la cita. «Una cita al día» quiere decir una cita para el mismo día; el mes es el del calendario (del 1 al último día).

##### ¿Qué citas cuentan?

Todas las citas vigentes del paciente en la clínica, agendadas o ya atendidas, sin importar si las agendó el asistente, el personal o el hospital. Las canceladas no cuentan.

##### ¿El personal también tiene este límite?

No. Solo el asistente (WhatsApp y Telegram). Desde Agendamiento se puede agendar sin límite, por ejemplo después de aprobar una solicitud.

##### ¿Qué teléfono le da el asistente al paciente?

El teléfono de soporte de la clínica. Si no está registrado, la pantalla lo avisa en amarillo y el asistente dice «comuníquese con el hospital», sin número.

##### ¿Y si el paciente está agendando para otra persona de su familia?

El aviso dice de quién es la cédula que dio (nombre y los últimos cuatro números) y que, si la cita es para otra persona, escriba «Hola» y dé la cédula de esa persona. Si justo después escribe solo «Cancelar», el asistente entiende que deja esa solicitud: le dice que no agendó nada más y que, si quiere anular una cita, escriba «Cancelar mi cita». No le ofrece anular la que ya tiene.

##### ¿Quién puede cambiarlo?

El administrador y el agente de reservas. Debajo de la pantalla queda quién hizo el último cambio y cuándo.

#### Si algo no sale bien

##### Un paciente dice que no tiene citas y el asistente no lo deja agendar.

Búscalo en Rastreo de paciente: puede tener una cita de ese día o mes agendada por el hospital o por el personal, y esas también cuentan.

##### El botón «Guardar cambios» está gris.

No hay cambios por guardar: modifica un valor o un interruptor primero.

### ⚙️ Configuración {#configuracion}

- **Ruta:** `/dashboard/configuracion`
- **Resumen:** El asistente virtual (nombre, tono, voz y qué puede hacer el paciente), sus canales, la información que comparte y la página de estadísticas para compartir.
- **Relacionados:** [Canales en vivo](#canales), [Encuestas (CSAT)](#encuestas), [Visión General](#vision-general), [Espejo con el HIS](#espejo), [Analíticas de Negocio](#analiticas)
- **Palabras clave:** ajustes, chatbot, bot, asistente, whatsapp, telegram, meta, token, gemini, openai, claude, voz, audio, plantillas, base de conocimiento, preguntas frecuentes, faq, tono, recordatorios, días sin citas, bloquear sábados, festivos, apagar agenda, horario sin citas, calendario, plazo para agendar, días adelante, fecha lejana, limitar fechas, máximo de días, médicos nuevos, homologar automáticamente, agregar médicos, estadísticas, cifras, informe, gerencia, compartir resultados, enlace público, subdominio

#### Para qué sirve

Tiene cinco pestañas. «Asistente Virtual»: qué puede hacer el paciente por WhatsApp o Telegram, hasta cuántos días adelante le ofrece citas, los recordatorios, el nombre, el tono, cuántas horas ofrece y la voz. «Días sin citas»: un calendario para elegir los días, o las horas de un día, para los que el asistente no ofrece citas (por ejemplo, todos los sábados). «Integraciones (IA y Canales)»: el proveedor de inteligencia artificial, WhatsApp, sus plantillas y Telegram. «Base de Conocimiento»: lo que el asistente responde sobre la clínica. «Estadísticas»: abre, con una clave sencilla, una página con las cifras de AgenIA para compartir con la gerencia o con quien decidas.

#### Paso a paso

##### Decidir qué puede hacer el paciente con el asistente

1. Abre la pestaña «Asistente Virtual».
2. Enciende o apaga «Agendar citas por el asistente», «Cancelar citas por el asistente» y «Cambiar la fecha de una cita por el asistente».
3. Cada interruptor se guarda al instante y aplica desde el siguiente mensaje del paciente.

> 💡 Con una operación apagada, el asistente le dice al paciente que se comunique con el hospital y qué sí puede hacer por ahí. Con las tres apagadas, solo consulta citas. Si la clínica está conectada al hospital, cada interruptor manda en todo: encendido, la operación se hace por el asistente y desde el panel y llega al sistema del hospital (el asistente solo le confirma al paciente cuando el hospital lo registró); apagado, no se puede hacer en AgenIA —ni por el asistente ni desde el panel— y se hace directamente en el sistema del hospital. Cada cambio queda en la auditoría del espejo. Sin conexión al hospital, el personal sigue haciendo todo desde el panel.

##### Limitar hasta qué día ofrece citas el asistente

1. En «Asistente Virtual», elige el «Plazo máximo para agendar» (por defecto, «Sin límite»).
2. Los días se cuentan desde hoy, incluido: con 3 días, el asistente ofrece citas para hoy, mañana y pasado mañana. Debajo verás las fechas reales, por ejemplo «se ofrecen citas hasta el domingo 25 de octubre; desde el lunes 26 de octubre, no».
3. Se guarda al instante y aplica al agendar, al cambiar la fecha de una cita y a la lista de espera. Cada día que pasa se abre un día nuevo.
4. Revisa el aviso de abajo: dice cuántos cupos puede ofrecer hoy el asistente con ese plazo. Si no puede ofrecer ninguno (por ejemplo, 2 días un viernes con los sábados bloqueados), lo avisa en amarillo con el primer día que tiene cupos, desde cuándo lo verán los pacientes y el plazo mínimo para ofrecerlo desde hoy.
5. Al pie aparece el último cambio: quién lo hizo, de cuánto a cuánto y cuándo.
6. Para quitar el límite, elige «Sin límite».

> 💡 Cuenta la fecha de la cita, no la del mensaje, y solo aplica al asistente (WhatsApp y Telegram): el personal agenda desde el panel y el hospital en su sistema para cualquier fecha, y las citas ya agendadas no cambian.

##### Encender o apagar los recordatorios automáticos

1. En «Asistente Virtual», usa el interruptor «Recordatorios automáticos de citas».
2. Aplica de inmediato. Al encenderlos, las citas que aún estén dentro del plazo reciben el suyo.

> 💡 Fuera de las 24 horas de conversación, WhatsApp exige la plantilla «Recordatorio de cita» (pestaña Integraciones).

##### Enviar recordatorios solo a quien agendó por el chat

1. En «Asistente Virtual», usa el interruptor «Recordatorios solo a pacientes que agendaron ellos mismos».
2. Encendido, el recordatorio automático solo sale para las citas que el paciente agendó por WhatsApp o Telegram. Las que agendó el personal desde el panel o el hospital no lo reciben.
3. Aplica de inmediato. Si lo apagas, las citas que aún estén dentro del plazo reciben el suyo.

> 💡 Solo funciona con los recordatorios automáticos encendidos. No cambia nada más: las citas se agendan, cancelan y atienden igual, y el botón de recordatorio manual de Visión General sigue sirviendo para cualquier cita.

##### No enviar el recordatorio a citas que están por empezar

1. En «Asistente Virtual», elige la «Anticipación mínima del recordatorio» (por defecto, 1 hora).
2. Si a la cita le falta menos de ese tiempo, el recordatorio automático no sale. Sirve para las citas que el hospital agenda el mismo día, minutos antes, con el paciente ya ahí.
3. Aplica de inmediato. «Sin mínimo» vuelve a enviar el recordatorio aunque la cita esté por empezar.

> 💡 La cita no se marca como recordada: si la mueven a una hora más lejana, el recordatorio puede salir. El botón de recordatorio manual de Visión General no se afecta.

##### Cambiar el nombre, el tono y las horas que ofrece el asistente

1. En «Asistente Virtual», escribe el «Nombre del asistente virtual» (hasta 40 caracteres).
2. Elige el tono: «Formal» (trato de usted, opciones A/B/C) o «Informal» (trato de tú, conversacional). La vista previa muestra cómo se verá.
3. En «Horarios que ofrece el asistente», elige cuántas opciones de cita muestra (entre 2 y 12; se recomiendan 6). Se reparten entre mañana y tarde.
4. Pulsa «Guardar configuración».

##### Bloquear días u horas sin citas por el asistente

1. Abre la pestaña «Días sin citas».
2. En el calendario, pulsa el día (los que ya pasaron no se pueden elegir).
3. En «¿Qué quiere bloquear?», elige «Todo el día» o «Unas horas». Con «Unas horas», escribe «Desde» y «Hasta»: no se ofrecen las citas que empiecen desde la hora inicial y antes de la final (de 8:00 a 10:00 quita la de las 9:40, no la de las 10:00).
4. Si se repite, marca «Repetir todos los …» (por ejemplo, «Repetir todos los sábados»): vale ese día y el mismo día de cada semana en adelante.
5. Si quieres, escribe el motivo. Revisa la frase de resumen («El asistente no ofrecerá citas todos los sábados, todo el día…») y pulsa «Bloquear».
6. Para deshacerlo, en «Bloqueos activos» pulsa «Quitar» y confirma.

> 💡 Aplica solo al asistente (WhatsApp y Telegram) y cuenta la hora de la cita, no la del mensaje: un paciente que escribe un sábado sí puede agendar para el lunes. Las citas ya agendadas no cambian, y los agendadores siguen agendando esos días desde el panel y en el sistema del hospital. En el calendario, rojo es todo el día sin citas y ámbar, algunas horas.

##### Agregar solos los médicos nuevos del hospital

1. En «Asistente Virtual», busca «Agregar solos los médicos nuevos del hospital». Solo aparece si la clínica está conectada al sistema de un hospital.
2. Apagado (como viene), cada médico del hospital que tenga citas de un servicio que AgenIA maneja y todavía no esté en AgenIA queda como caso en la Bandeja, con el botón «Crear y homologar».
3. Encendido, AgenIA lo crea y homologa sola cuando cumple todas las reglas: cédula única en el hospital, cargo de médico, su servicio principal es uno que AgenIA maneja y está activo en el hospital. Deja un caso en la Bandeja para que alguien lo revise. Si no cumple alguna regla, queda en la Bandeja como siempre.
4. Con «Los médicos agregados solos entran con WhatsApp encendido» eliges con qué entran. Apagado (recomendado), sus citas entran a AgenIA pero no le sale nada al paciente hasta que alguien lo encienda en Médicos; encendido, sus pacientes reciben recordatorios y el asistente ofrece sus cupos desde el primer día.

> 💡 Se revisa una vez al día, cuando el agente del hospital manda su comparación de citas (de noche). Nada se escribe en el sistema del hospital, y cada cambio de estos interruptores queda en la auditoría del espejo.

##### Compartir las estadísticas con una clave

1. Abre la pestaña «Estadísticas». Viene cerrada: nadie la puede ver.
2. Escribe una clave de al menos 6 caracteres en «Clave para abrir la página» y pulsa «Abrir la página».
3. Copia el enlace con «Copiar» y compártelo junto con la clave solo con quien deba ver las cifras. Con «Abrir» la ves tú.
4. Quien abre el enlace escribe la clave una vez: queda dentro 30 días en ese navegador, y con «Salir» se olvida.
5. Para cambiar la clave, escribe la nueva en «Clave nueva» y pulsa «Cambiar la clave»: quien ya había entrado debe escribir la nueva.
6. Para cerrarla, pulsa «Cerrar la página» y confirma con «Sí, cerrar».

> 💡 La página muestra recordatorios enviados y leídos, gestiones por chat (confirmar, consultar, agendar, cancelar, cambiar fecha y avisar inasistencia), citas agendadas por chat, cupos devueltos, mensajes fuera de horario y asistencia con y sin recordatorio, sin datos de ningún paciente. Se recalcula cada día a las 6 a. m. con el día anterior completo: el día en curso no sale. Las gráficas por día muestran los últimos 30 días y las cifras cuentan desde el primer recordatorio. Si el equipo de AgenIA le dio a tu clínica una dirección corta para las estadísticas, esa también sirve con la misma clave.

##### Configurar la voz del asistente

1. En «Asistente Virtual», baja a «Voz del asistente».
2. Elige el género de la voz y el proveedor: ElevenLabs (más natural, requiere clave de API de la clínica) o Google Cloud TTS (siempre disponible).
3. Ajusta la voz, el tono y la velocidad si quieres.
4. Pulsa «Guardar configuración de voz» y luego pruébala: verás la latencia y si el audio se generó.

> 💡 Si ElevenLabs falla (sin cuota o sin respuesta), el asistente usa Google automáticamente.

##### Conectar la inteligencia artificial

1. Abre la pestaña «Integraciones (IA y Canales)».
2. En «Integración de IA», elige el proveedor: Google Gemini, OpenAI ChatGPT o Anthropic Claude.
3. Pega la clave de API y elige el modelo.
4. Pulsa «Guardar integración» y luego «Probar Servicio» en «Salud de la Conexión».

> 💡 La clave se guarda cifrada y nunca se vuelve a mostrar: solo sus últimos 4 caracteres. Para Gemini hay una guía paso a paso en /guia/google-ai-studio. Esta misma IA la usa el asistente de soporte de Telegram para responderle al personal de tu clínica.

##### Conectar WhatsApp (Meta)

1. En «Integraciones», ve a «Canal de WhatsApp (Meta)».
2. Escribe el Phone Number ID y el WhatsApp Business Account ID (están en Meta for Developers › tu App › WhatsApp).
3. Pega el Access Token permanente (de un System User; empieza por EAA…) y el App Secret.
4. Copia el Verify Token y pégalo en Meta › Webhook al configurar la suscripción.
5. Pulsa «Guardar canal de WhatsApp» y verifícalo en «Salud de la Conexión».

> 💡 Hay una guía completa en /guia/whatsapp.

##### Registrar las plantillas de WhatsApp

1. Crea y haz aprobar la plantilla en Meta.
2. En «Plantillas de WhatsApp», escribe en el tipo correspondiente el nombre exacto que aprobó Meta (solo minúsculas, números y guión bajo) y el idioma (por ejemplo «es»).
3. Respeta el orden de las variables que indica cada tipo: Meta lo valida al enviar.
4. Guarda.

> 💡 Tipos: Recordatorio de cita, Oferta de cupo (lista de espera: el cupo que se liberó, a quien no ha escrito en 24 horas; de 7:00 a 19:00; tres variables: nombre, servicio, y fecha y hora; sin botones, el paciente responde SÍ o NO escribiendo), Aviso de cancelación y Recordatorio masivo (avisos masivos), Aviso al agendador (Bandeja de sincronización), Confirmación de una cita del hospital (Rastreo, y el aviso de un cambio de hora del hospital), Cita cancelada por el hospital (el aviso al paciente cuando el hospital cancela una cita que agendó con el asistente y no ha escrito en 24 horas; cinco variables: nombre, servicio, médico, fecha y hora, y con quién comunicarse) y Aviso al agendador (pedidos de pacientes) (al celular del agendador cuando un paciente pidió cancelar y no confirmó o avisó que no irá, con la cita a 24 horas o menos; tres variables: cuántos casos, la cita más próxima y qué pidió; sin datos del paciente).

##### Conectar Telegram

1. En Telegram, abre @BotFather, crea un bot con el nombre que verán tus pacientes y un usuario que termine en «bot».
2. Copia el token que te da BotFather.
3. En «Canal de Telegram», pégalo y pulsa «Conectar bot de Telegram».
4. Comparte el enlace o imprime el código QR para la sede.

> 💡 Si la tarjeta dice que Telegram no está habilitado en este servidor, el equipo de AgenIA debe activarlo primero.

##### Escribir la base de conocimiento

1. Abre la pestaña «Base de Conocimiento».
2. Escribe la información de la clínica por secciones: horarios, dirección, urgencias, tarifas, EPS con convenio, teléfonos, protocolos de visita.
3. Pulsa «Guardar Base de Conocimiento».

> 💡 El asistente solo responde lo que está escrito aquí: no inventa datos. Si está vacía, responde que no tiene información disponible.

#### Qué ves en la pantalla

- **Salud de la Conexión:** Prueba en el momento si la IA y Meta responden con las credenciales guardadas. No envía mensajes.
- **Estado actual:** El proveedor, el modelo y los últimos 4 caracteres de la clave guardada.
- **Configurada / Sin configurar:** Estado de cada plantilla de WhatsApp.

#### Preguntas frecuentes

##### ¿Por qué WhatsApp necesita plantillas?

WhatsApp solo deja enviar texto libre en las 24 horas siguientes al último mensaje del paciente. Fuera de ese plazo (por ejemplo, un recordatorio del día anterior) hay que usar una plantilla aprobada por Meta.

##### Con «recordatorios solo a pacientes que agendaron ellos mismos», ¿qué citas no reciben recordatorio?

Las que agendó el personal desde el panel y las que llegaron del sistema del hospital. Una cita que el paciente agendó por el chat lo sigue recibiendo aunque después el personal le cambie la fecha.

##### ¿El tono cambia lo que hace el asistente?

No. Solo cambia el lenguaje y la forma de los mensajes; las reglas de agendamiento son las mismas.

##### ¿WhatsApp y Telegram son pacientes distintos?

No. Es el mismo asistente en los dos canales y la ficha del paciente es una sola.

##### ¿Qué pasa con un paciente que pide cita para un día bloqueado?

El asistente no le ofrece horarios de ese día: le muestra los de otros días. Si alguien ya tenía la oferta en pantalla cuando bloqueaste el día, al responder se le dice que ese horario ya no está y se le ofrecen otros. Lo mismo al cambiar la fecha de una cita y en la lista de espera.

##### ¿Qué pasa si un paciente pide una cita más allá del plazo máximo para agendar?

El asistente le dice que para esa fecha no encontró cupos y le muestra los más próximos dentro del plazo. Si dentro del plazo no queda ningún cupo pero sí más adelante, le dice hasta qué día se agenda por ahora y desde qué día escribir para ver los siguientes («por ahora agendamos citas hasta el sábado 24 de octubre… escríbanos desde el domingo 25 de octubre»), y también le ofrece la lista de espera. Si alguien ya tenía la oferta en pantalla cuando acortaste el plazo, al responder se le dice que ese horario ya no está y se le ofrecen otros.

##### ¿Y a quien quiere cambiar la fecha de su cita?

Si dentro del plazo no hay otro horario pero sí más adelante, el asistente le dice que su cita sigue en pie y desde qué día escribir para cambiarla. No le ofrece cancelarla.

##### ¿Dónde veo quién cambió el plazo?

Al pie de «Plazo máximo para agendar» aparece el último cambio, con quién lo hizo y cuándo. Cada cambio queda además en la auditoría del espejo.

##### ¿La página de estadísticas muestra datos de pacientes?

No. Solo cuenta: cuántos recordatorios, mensajes, citas y gestiones hubo, sin nombres, teléfonos ni cédulas. Aun así va con clave porque son cifras de la operación del hospital, y no aparece en buscadores como Google.

##### ¿Por qué la página de estadísticas no tiene las cifras de hoy?

Porque se recalcula una vez al día, a las 6 a. m., con el día anterior completo. Un día a medias se vería como una caída (a media mañana van pocos recordatorios). Antes de las 6 a. m. todavía muestra el corte del día anterior.

##### Olvidé la clave de las estadísticas. ¿Cómo la veo?

No se puede ver: se guarda cifrada. Pon una nueva en la pestaña «Estadísticas» y compártela; quien había entrado con la anterior tendrá que escribir la nueva.

##### ¿«Días sin citas» es lo mismo que apagar «Agendar citas por el asistente»?

No. Apagar «Agendar» detiene todas las citas nuevas por el asistente, de cualquier día. «Días sin citas» solo quita los días u horas elegidos; el resto se sigue ofreciendo.

#### Si algo no sale bien

##### La prueba de IA falla.

Revisa la clave de API (que no esté vencida ni sin saldo) y el modelo elegido. Copia el error con el botón del resultado y repórtalo en Soporte si no se aclara.

##### La prueba de Meta falla.

El Access Token pudo vencer o el Phone Number ID es incorrecto. Usa un token permanente de un System User.

##### El asistente no les responde a los pacientes.

Pulsa «Probar Servicio» en Salud de la Conexión: si falla la IA, revisa la clave de API; si falla Meta, renueva el Access Token. Mira también la Caja Negra (motivos «IA caída», «Error de WhatsApp» o «Token Meta expirado») y que el canal esté guardado.

##### Sale «No pudimos cargar…» en una sección.

Las demás secciones siguen funcionando. Recarga la página; si persiste, repórtalo en Soporte.

##### Telegram dice que no logra entregar los mensajes al servidor.

Pulsa «Verificar conexión». Si sigue, avisa al equipo técnico desde Soporte.

##### La página de estadísticas dice «Demasiados intentos con una clave equivocada».

Tras 5 claves equivocadas desde la misma conexión en 15 minutos (o 30 en total para la clínica) la página deja de comprobar por 15 minutos, para que nadie la adivine probando. Espera y escribe la clave correcta; si no la sabes, pídela al administrador.

##### El enlace de las estadísticas muestra «404» o «página no encontrada».

La página está cerrada: el administrador la abre poniendo una clave en Configuración › Estadísticas. También pasa si el enlace quedó incompleto al copiarlo.

### 👥 Usuarios {#usuarios}

- **Ruta:** `/dashboard/usuarios`
- **Resumen:** Las cuentas de acceso del personal y de los pacientes: correo, contraseña y rol.
- **Relacionados:** [Médicos](#medicos), [Soporte](#soporte)
- **Palabras clave:** cuentas, accesos, credenciales, login, contraseña, clave, roles, permisos, agente de reservas, personal, staff

#### Para qué sirve

Cada persona que entra al panel tiene un usuario con un rol que decide qué ve. Aquí creas cuentas, cambias contraseñas y roles, y limitas a los agentes de reservas a una EPS o a un médico. Solo el administrador puede hacerlo, y cada cuenta creada, cambiada o eliminada queda registrada (quién, cuándo y qué cambió) para el equipo de AgenIA.

#### Paso a paso

##### Crear un usuario

1. Pulsa «+ Nuevo Usuario».
2. Escribe el correo y una contraseña: al menos 10 caracteres, con letras y números, sin el usuario del correo y que no sea una de las que vienen de fábrica (como `temporal123`). Es obligatoria: ya no se pone una por defecto.
3. Elige el «Rol de Acceso»: Administrador, Médico Especialista, Paciente, Agente Reservas u Observador general.
4. Si es «Agente Reservas», escribe su nombre completo y, si quieres, limítalo a una EPS o a un médico.
5. Pulsa «Guardar Credencial».

> 💡 Para crear un médico con su perfil completo (servicio, tarjeta profesional), es mejor usar la opción Médicos.

##### Cambiar la contraseña de un usuario

1. Pulsa ✏️ en su fila.
2. Escribe la nueva contraseña, con la misma regla que al crear (si la dejas en blanco, no cambia). Al guardar se cierran las sesiones que esa persona tenga abiertas.
3. Pulsa «Guardar Credencial».

##### Encontrar un usuario

1. Escribe su correo, nombre o documento en el buscador.
2. Si quieres, filtra por rol.

#### Qué ves en la pantalla

- **Rol Asignado:** Administrador, Médico Especialista, Paciente, Agente de Reservas u Observador general.
- **Perfiles Vinculados:** 🏥 Paciente, 🩺 Médico o 🎧 Agente. En los agentes se ve su límite (una EPS, un médico) o 🌐 GLOBAL. «Solo Credenciales» = cuenta sin perfil.
- **🗑️ Eliminar:** Borra la cuenta y sus perfiles. No se puede deshacer. No puedes eliminar tu propia cuenta ni cambiar tu propio rol: pídeselo a otro administrador.

#### Preguntas frecuentes

##### ¿Qué ve cada rol?

Administrador: todas las opciones. Agente de Reservas: Visión General, Agendamiento, Caja Negra, Rastreo, Solicitudes de más citas y Soporte (más la Bandeja de sincronización y los Avisos masivos si la clínica los tiene); el Límite de citas lo fija solo el Administrador. Médico: su agenda, Rastreo y Soporte. Paciente: sus citas y Soporte. Observador general: Analíticas de Negocio, Canales en vivo y Soporte.

##### ¿Cómo cambia cada usuario su propia clave?

En «🔑 Cambiar mi clave», al pie del menú (en el celular, el ícono 🔑 de arriba): escribe la clave actual, la nueva y la confirma. La nueva debe tener al menos 10 caracteres, letras y números, ser distinta de la actual y no contener su usuario. Tras 5 intentos con la clave actual equivocada hay que esperar 15 minutos. Al cambiarla se cierran sus sesiones abiertas en otros equipos (la de donde la cambió sigue). Si alguien olvidó la suya, ponle una nueva aquí (✏️) y pídele que la cambie al entrar.

##### ¿Para qué limitar a un agente por EPS o por médico?

Para que solo vea y agende las citas de esa EPS o de ese médico. Con los límites en «Global», puede ver y agendar cualquier cita.

#### Si algo no sale bien

##### Una persona del personal no puede entrar al panel (olvidó la contraseña).

Búscala aquí por su correo, pulsa ✏️, escríbele una contraseña nueva y guarda. Compártesela por un medio seguro.

##### Al guardar sale un error de correo repetido.

Ya existe una cuenta con ese correo. Búscala y edítala.

##### Al guardar sale un error sobre la contraseña.

La contraseña no cumple la regla: al menos 10 caracteres, letras y números, sin el usuario del correo y que no sea una de fábrica (`admin123`, `temporal123`…). Escribe otra.

##### Alguien del personal no puede entrar y dice «Demasiados intentos fallidos».

Tras 5 claves equivocadas en 15 minutos con el mismo correo desde el mismo equipo, el ingreso se frena 15 minutos. Espera ese tiempo; si olvidó la clave, ponle una nueva aquí (✏️).

##### El panel me sacó y dice «Su sesión se cerró».

Pasa cuando le pusieron una clave nueva a la cuenta, le cambiaron el rol, la clínica quedó suspendida o el equipo de AgenIA cerró sus sesiones. Vuelve a ingresar con la clave vigente; si no la tienes, pídele una nueva al administrador.

### 🛟 Soporte {#soporte}

- **Ruta:** `/dashboard/soporte`
- **Resumen:** Reporta una falla o haz una solicitud al equipo técnico de AgenIA, desde el panel o por Telegram, y sigue su estado.
- **Relacionados:** [Primeros pasos](#primeros-pasos), [Glosario](#glosario)
- **Palabras clave:** ticket, caso, número de caso, ayuda, reportar, falla, error, bug, incidente, mesa de ayuda, contactar soporte, equipo técnico, chat, celular, bot, prioridad, urgente, aviso, notificación, reabrir, sigue pasando

#### Para qué sirve

Cuando algo no funciona como esperas o necesitas un cambio que no puedes hacer desde el panel, abres una solicitud. El equipo técnico la toma, la atiende y te deja una respuesta. Desde esta misma página entras a este centro de ayuda con el botón «Ayuda».

#### Paso a paso

##### Reportar una falla o hacer una solicitud

1. Pulsa «Reportar Falla / Nueva Solicitud».
2. Escribe un título claro (mínimo 5 caracteres), por ejemplo «No puedo cargar la agenda del Dr. Pérez».
3. En «Detalles del problema» (mínimo 15 caracteres), cuenta qué esperabas, qué pasó, los pasos para repetirlo y el mensaje de error si hubo.
4. Pulsa «Enviar solicitud».

> 💡 Mientras más detalle, más rápida la atención. Antes de escribir, busca aquí en la ayuda: quizá la respuesta ya está.

##### Seguir una solicitud

1. Mira las cifras de arriba: Abiertas, En atención y Solucionadas.
2. Cada tarjeta muestra su número (por ejemplo #58), su estado y cuándo la reportaste.
3. Si la abriste por Telegram, es de prioridad alta o la reabriste, lo dice en la tarjeta, junto con lo que le agregaste después.
4. Cuando está solucionada, aparece la «Respuesta del equipo de soporte».
5. Pulsa «Ver detalles completos» para leer todo lo que escribiste.

> 💡 Si alguna vez conversaste con el asistente de Telegram, también te escribe por ahí cuando tomen tu solicitud y cuando quede solucionada, aunque la hayas reportado desde aquí.

##### Hablar con el asistente por Telegram

1. En la tarjeta «Asistente de soporte en Telegram», pulsa «Generar código».
2. En Telegram, escríbele al bot que indica la tarjeta los 6 dígitos del código, o escanea el QR con el celular.
3. El asistente confirma con qué usuario quedó la conversación. Si no fuiste tú, escribe /salir.
4. Escríbele tu pregunta como se la harías a una persona. Si mandas varios mensajes seguidos, te los responde juntos.
5. Si la respuesta te sirvió, pulsa «Me sirvió»; si no, pulsa «No, abrir un caso» y el asistente arma el caso con lo que le contaste.
6. Para terminar, escribe /salir o pulsa «Cerrar» en la tarjeta. Si pasan 30 minutos sin mensajes, la conversación se cierra sola.

> 💡 Cada conversación necesita un código nuevo. El código sirve una sola vez, vence a los 10 minutos y, si generas otro, el anterior deja de servir.

##### Reportar una falla por Telegram

1. Cuéntale al asistente qué pasa, o escribe /nuevo y luego cuéntaselo.
2. Si le falta algo para entenderlo (en qué pantalla, desde cuándo, a quién afecta), te lo pregunta: como mucho dos cosas a la vez.
3. Te muestra el caso que abriría: título, prioridad, pantalla y detalle.
4. Pulsa «Sí, ábrelo» o escribe «sí» para abrirlo. Con «Corregir algo» le dices qué cambia, y con «No, gracias» no abre nada.
5. Te dice el número del caso (por ejemplo #58) y cuándo lo verá el equipo técnico. El caso aparece aquí en Soporte con la etiqueta «Por Telegram».

> 💡 El asistente nunca abre un caso sin tu «sí». Si la conversación se cierra con un caso sin confirmar, te lo ofrece de nuevo la próxima vez que entres, durante 24 horas.

##### Ver cómo van tus casos y agregarles algo por Telegram

1. Escribe /casos para ver tus casos abiertos y los solucionados del último mes, o pregúntale «¿cómo va mi caso?».
2. Para agregarle algo a un caso, cuéntaselo y dile cuál, por ejemplo «agrégale al #58 que también pasa con el Dr. Ruiz».
3. El asistente te pregunta si lo agrega. Pulsa «Sí, agrégalo» y el equipo técnico lo ve en el caso.

##### Recibir por Telegram los avisos de tus casos

1. Los avisos llegan a la cuenta de Telegram con la que conversaste por última vez con el asistente, también los de lo que reportes desde el panel.
2. Cuando el equipo técnico toma tu caso, te escribe: «👀 El equipo técnico ya está trabajando en tu caso #58».
3. Cuando queda resuelto, te pregunta si quedó bien, con los botones «Sí, gracias», «No, sigue pasando» y «Ver la respuesta».
4. Si no tienes una conversación abierta, «Ver la respuesta» y «No, sigue pasando» te piden un código nuevo; apenas lo escribes, el asistente lo hace.
5. «No, sigue pasando» reabre el caso, le avisa al equipo técnico y te pide contar qué sigue pasando para agregarlo al caso.
6. Para dejar de recibirlos, pulsa «Dejar de recibir avisos» en la tarjeta «Asistente de soporte en Telegram». Con «Recibir avisos» vuelven.

> 💡 Sin una conversación abierta, el aviso de resuelto no trae la respuesta del equipo, porque puede mencionar datos: la ves con «Ver la respuesta» después del código, o aquí en Soporte.

#### Qué ves en la pantalla

- **Abierto:** Nadie la ha tomado todavía.
- **En atención:** Alguien del equipo técnico la está trabajando (con la hora en que empezó).
- **Solucionada:** Resuelta, con la respuesta del equipo.
- **#58:** El número del caso. El asistente de Telegram y el equipo técnico lo nombran así.
- **Prioridad alta:** El caso frena la atención de pacientes. Solo la tienen los casos abiertos por Telegram, y la ves antes de confirmar.
- **Por Telegram:** El caso se abrió con el asistente de Telegram.
- **Lo que agregaste después:** Lo que le sumaste al caso desde el asistente, con su fecha.
- **Reabierto:** Después de resuelto, dijiste que sigue pasando y el caso volvió a abrirse.
- **Avisos de tus casos:** En la tarjeta del asistente, a qué cuenta de Telegram te llegan los avisos, con el botón «Dejar de recibir avisos».
- **Ayuda:** Abre este centro de ayuda.
- **Asistente de soporte en Telegram:** Genera el código para conversar con el asistente y muestra si tienes una conversación abierta. Aparece solo cuando el equipo de AgenIA activó el asistente.

#### Preguntas frecuentes

##### ¿Quién ve mis solicitudes?

Tú y el equipo técnico de AgenIA.

##### ¿Quién ve lo que le escribo al asistente de Telegram?

El equipo técnico de AgenIA puede leer tus conversaciones con el asistente para atender tus casos y mejorar sus respuestas. Se guardan 180 días, y cada vez que alguien del equipo abre una, queda registrado. No le escribas al asistente datos de pacientes que no hagan falta.

##### ¿Puedo agregar algo a una solicitud ya enviada?

Sí, con el asistente de Telegram: cuéntale lo que falta y dile a qué caso, por ejemplo «agrégale al #58 que también pasa con el Dr. Ruiz». Te pregunta antes de agregarlo, y en la tarjeta aparece como «Lo que agregaste después». Solo se puede con tus casos que no estén solucionados. Desde el panel todavía no se puede: abre otra solicitud y menciona el número de la anterior en el título.

##### ¿Por qué el asistente de Telegram me pide un código cada vez?

Para que solo el personal de la clínica converse con él, y para que un celular perdido o una cuenta de Telegram ajena no conserven el acceso. El código solo lo ves tú en el panel: nunca lo compartas, nadie de AgenIA te lo va a pedir.

##### ¿Qué puede hacer el asistente de Telegram?

Responde tus dudas sobre AgenIA con este manual y con la configuración de tu clínica, usando la inteligencia artificial de tu clínica. Si tu clínica no tiene IA o falla, te muestra lo más parecido del manual. Te explica lo que puedes hacer con tu rol; lo de otro rol te dice quién lo hace. Además abre casos (siempre con tu «sí»), te muestra los tuyos con /casos, les agrega lo que le cuentes y te avisa si el equipo técnico ya está atendiendo una falla general, como WhatsApp caído o recordatorios que no salen. Escribe /ayuda para ver sus comandos.

##### ¿Me avisan cuando atiendan mi solicitud?

Sí, por Telegram, si alguna vez conversaste con el asistente y no apagaste los avisos: te escribe cuando el equipo técnico la toma y cuando queda resuelta. Si nunca conversaste con él, mira el estado aquí en Soporte.

##### Me dicen que quedó resuelto, pero sigue pasando. ¿Qué hago?

En el aviso de resuelto, pulsa «No, sigue pasando»: el caso se reabre, el equipo técnico se entera y el asistente te pide contar qué sigue pasando. Se puede hasta 7 días después de resuelto. Después de eso, repórtalo de nuevo con /nuevo o con «Reportar Falla / Nueva Solicitud», y menciona el número del caso anterior.

##### ¿Cuándo un caso es de prioridad alta?

Cuando frena la atención de pacientes: nadie puede agendar, el asistente de los pacientes no responde, no salen los recordatorios, las citas no llegan al hospital o el sistema no carga. El asistente la propone según lo que le cuentas y la ves en el caso antes de confirmar. Los casos de prioridad alta salen primero en la lista del equipo técnico.

#### Si algo no sale bien

##### Sale «Revisa el formulario».

El título necesita al menos 5 caracteres y los detalles al menos 15.

##### Sale «No se pudieron cargar tus solicitudes».

Recarga la página en un momento.

##### El asistente dice «Ese código no es válido o ya venció».

Genera uno nuevo con «Generar código»: cada código sirve una sola vez y vence a los 10 minutos, y al generar otro el anterior deja de servir. Después de 5 intentos fallidos, el asistente espera una hora antes de aceptar otro código desde esa cuenta de Telegram.

##### No aparece la tarjeta «Asistente de soporte en Telegram».

Aparece solo cuando el equipo de AgenIA activó el asistente, y no para el rol Paciente. Mientras el asistente está en piloto, solo la ven las personas del piloto; después se abre a todo el personal. Si deberías verla, repórtalo en Soporte.

##### Al generar el código dice «El asistente de soporte está en piloto».

Por ahora lo están probando algunas personas. Cuando se abra a todo el personal, la tarjeta te funcionará igual que a ellas.

##### El asistente dice «Ese caso ya no está pendiente».

Tocaste un botón de un caso que ya se abrió o se descartó, o el caso al que querías agregarle algo ya está solucionado. Escribe /casos para ver cómo están tus casos, o /nuevo para reportar algo nuevo.

##### El asistente dice «El caso #58 ya no se puede reabrir desde aquí».

Pasaron más de 7 días desde que se resolvió, o el caso ya no está resuelto (ya se reabrió). Escribe /casos para ver cómo está, o /nuevo para reportarlo otra vez.

##### El asistente dice «Ese aviso es de un caso de otra persona».

En esa cuenta de Telegram está conversando otra persona de tu clínica. Los botones de un aviso solo los puede usar quien reportó el caso: escribe tu propio código para que la conversación quede a tu nombre.

## Categoría: Conexión con el hospital {#hospital}

Solo en las clínicas conectadas al sistema del hospital (HIS).

### 🪞 Espejo con el HIS {#espejo}

- **Ruta:** `/dashboard/espejo`
- **Resumen:** El estado de la conexión entre AgenIA y el sistema del hospital (HIS): si el agente está vivo, si las citas llegan y si la agenda coincide.
- **Disponibilidad:** Solo aparece en el menú si la clínica está conectada al sistema del hospital (HIS). Si no la ves, tu clínica no tiene esa conexión.
- **Relacionados:** [Bandeja de sincronización](#bandeja), [Rastreo de paciente](#rastreo), [Agendas (Slots)](#agenda), [Médicos](#medicos)
- **Palabras clave:** his, hospital, sincronización, integración, agente, homologación, homologar, auditoría del espejo, cola de salida, outbox, shadow, modo de agenda

#### Para qué sirve

El espejo mantiene sincronizadas las citas entre AgenIA y el sistema del hospital. Lo que se agenda por WhatsApp viaja al hospital, y lo que se agenda en ventanilla llega a AgenIA. Esta pantalla responde con semáforos: ¿el agente del hospital está vivo y alcanza el HIS?, ¿hay algo que no llegó?, ¿la agenda coincide? Y te da los controles de emergencia.

#### Paso a paso

##### Revisar que la conexión esté sana

1. Mira los semáforos de arriba: «Agente en la VM del hospital», «Citas en camino al hospital», «Agenda» y «Los dos sistemas coinciden».
2. Verde: todo bien. Amarillo: atención. Rojo: hay que actuar; el texto dice por qué.

##### Detener la escritura en el hospital (emergencia)

1. En Configuración, apaga «Agendar citas», «Cancelar citas» y «Cambiar la fecha de una cita»: cada uno es la compuerta de su operación hacia el hospital.
2. Desde ese momento esas operaciones no se pueden hacer en AgenIA, ni por el asistente ni desde el panel: se hacen directamente en el sistema del hospital. Nada queda en cola.
3. En el Espejo, el recuadro «Qué escribe AgenIA en el sistema del hospital» muestra cómo quedó cada una.

> 💡 Se pueden apagar y encender por separado, para salir a producción de a una operación. Aunque estén apagadas, sigue entrando lo que viene del hospital (su agenda y las citas de ventanilla).

##### Reintentar un evento que no llegó al hospital

1. Baja a «Eventos que no llegaron al hospital» (se reintentaron diez veces y se rindieron).
2. Lee el motivo del último fallo.
3. Corrige la causa (por ejemplo, homologa al médico) y pulsa «Reintentar».
4. El agente lo vuelve a intentar en su próxima vuelta.

##### Cambiar el modo de agenda (OFF, SHADOW, ON)

1. OFF: la agenda es la de AgenIA (cupos creados a mano).
2. SHADOW: se calcula la agenda real del hospital y se reportan las diferencias, sin cambiar lo que ve el paciente.
3. ON: la agenda de AgenIA pasa a ser la del hospital.
4. Elige el modo y confirma. El agente lo aplica en su próxima vuelta (hasta 15 minutos).

> 💡 Pasar a ON es una decisión de negocio: se recomienda revisar al menos una semana en SHADOW antes.

##### Homologar los médicos del hospital

1. Pulsa «Homologar médicos →».
2. Busca el médico del HIS por código, nombre o cargo.
3. Elige con qué médico de AgenIA se empareja y vincúlalo.

> 💡 Sin este paso el médico no recibe cupos ni citas del hospital; es intencional, lo decide una persona. Al desvincular, los cupos ya creados no se borran solos.

##### Consultar la auditoría detallada

1. Pulsa «Ver auditoría detallada →».
2. En «Auditoría» ves cada evento entre los dos sistemas (dirección, operación, resultado).
3. En «Cola de salida» ves lo que AgenIA envió al hospital: pendiente, entregado o rendido.
4. Filtra y abre una fila para ver el detalle.

#### Qué ves en la pantalla

- **Agente en la VM del hospital:** Programa instalado en un servidor del hospital que lleva y trae la información. Debe latir cada pocos minutos y alcanzar el HIS.
- **Citas en camino al hospital:** Eventos en cola o rendidos. Verde si todo lo de WhatsApp llegó.
- **Agenda:** El modo actual (OFF, SHADOW u ON) y los cupos futuros.
- **Los dos sistemas coinciden:** Resultado de la última comparación completa entre AgenIA y el hospital.
- **Conflictos recientes:** Situaciones que el sistema no resuelve solo, a propósito, porque afectan a un paciente concreto.
- **Resultados de auditoría:** OK, SKIPPED (no aplica, por ejemplo un médico no homologado), CONFLICT, ERROR y DEAD_LETTER (se rindió).

#### Preguntas frecuentes

##### ¿Qué hago si el agente no da señales?

El programa del hospital no está corriendo o el servidor perdió internet. Avisa al área de sistemas del hospital y repórtalo en Soporte.

##### ¿Las citas de ventanilla llegan a AgenIA?

Sí: una cita agendada en el hospital crea la cita (y el paciente, si no existe) en AgenIA. Aparece con la insignia «🏥 Hospital».

##### ¿Qué pasa cuando el hospital cambia su agenda (quita horas, días o médicos)?

AgenIA no se entera al instante, sino por vueltas. Las citas de ventanilla (nuevas, canceladas o movidas) llegan en unos 30 segundos; la agenda de los próximos días se vuelve a leer cada pocos minutos (hoy, cada 5 minutos para los próximos 7 días, y una vez al día completa); los médicos y servicios nuevos, una vez al día. Una hora o un día que el hospital quita deja de ofrecerse por el asistente en la siguiente lectura de la agenda.

El asistente nunca confirma una cita que el hospital no registró. Si en esos minutos le ofrece a un paciente un día en que el médico ya no tiene turno, el hospital la rechaza y el asistente le dice al paciente que el hospital acaba de ajustar su agenda y le muestra los horarios que quedan. Lo que el hospital no frena es una hora movida dentro del mismo turno del médico.

Las citas que ya estaban agendadas en horas que el hospital quitó no se cancelan solas: aparecen en la Bandeja como conflicto de sincronización. Revísalas en el sistema del hospital y llama al paciente; si las cancelas allá, AgenIA le avisa al paciente.

#### Si algo no sale bien

##### «El agente está vivo pero NO alcanza el sistema del hospital».

El HIS no responde al agente. Ninguna cita se está espejando. Avisa a sistemas del hospital.

##### «Los dos sistemas no coinciden».

Revisa los conflictos recientes y la Bandeja de sincronización.

### 🚨 Bandeja de sincronización {#bandeja}

- **Ruta:** `/dashboard/bandeja`
- **Resumen:** Las citas que no llegaron al hospital (AgenIA las confirmó y el hospital todavía no las tiene), los cambios que no se pudieron aplicar, los avisos de pacientes al bot («no puedo ir», «número equivocado») y las citas del asistente que el hospital canceló o cambió de hora, para resolverlos a tiempo.
- **Disponibilidad:** Solo aparece en el menú si la clínica está conectada al sistema del hospital (HIS). Si no la ves, tu clínica no tiene esa conexión. La ven el Administrador y los Agentes de Reservas.
- **Relacionados:** [Espejo con el HIS](#espejo), [Rastreo de paciente](#rastreo), [Configuración](#configuracion)
- **Palabras clave:** excepciones, sincronización, citas atascadas, no llegó al hospital, pendientes, alertas, vigilante, agendador, escribir al paciente, mensaje al paciente, disculpas, contactar

#### Para qué sirve

Un vigilante revisa cada 2 minutos si algo se atascó entre AgenIA y el hospital. Cada problema es una «excepción» con su gravedad: crítica si la cita es en menos de 4 horas. Aquí alguien la toma, la resuelve (por ejemplo, agendándola a mano en el HIS) y deja constancia. El número rojo del menú es lo que te espera.

#### Paso a paso

##### Atender una cita que no llegó al hospital (una excepción)

1. Abre «Activas» u ordena por «Urgencia (cita más próxima)».
2. Pulsa «Tomar»: queda a tu nombre y nadie más la trabaja.
3. Resuelve el caso (por ejemplo, agenda la cita a mano en el HIS o llama al paciente).
4. Pulsa «Resolver» y cuenta qué hiciste (mínimo 5 caracteres).

> 💡 Si no hace falta actuar (era una cita de prueba), usa «Descartar» y explica por qué. Si no puedes seguir con ella, «Soltar» la devuelve a «Sin dueño».

##### Atender el aviso de un paciente que no irá o pide otra fecha

1. Filtra por el tipo «Un paciente avisó que no irá o pide otra fecha». La tarjeta dice qué pidió, por dónde y lo que escribió.
2. Pulsa «Tomar».
3. Si no irá, cancela la cita en el HIS para liberar el cupo. Si pide otra fecha, muévela en el HIS y avísale al paciente.
4. No hace falta cerrarla: cuando la cita se cancela o cambia de hora, o el paciente asiste, se cierra sola. Si decides dejar la cita como está, pulsa «Resolver» y cuenta por qué.

> 💡 Aparecen cuando cancelar o cambiar la fecha están apagados en el bot, y también cuando la cita es de un servicio o médico con el que AgenIA no trabaja (por ejemplo odontología o hipertensos): la tarjeta lo dice. El bot no toca la cita ni escribe en el hospital: le dice al paciente que su aviso quedó registrado y que la cita sigue en pie hasta que el hospital la gestione.

##### Corregir el teléfono de un paciente que es de otra persona

1. Filtra por el tipo «El teléfono de un paciente es de otra persona».
2. Consigue el número correcto (por ejemplo, llamando al paciente o con su historia).
3. Corrígelo en el HIS y también en Pacientes de AgenIA: el hospital no reemplaza un teléfono que AgenIA ya tiene.
4. Pulsa «Resolver» contando qué hiciste. Si el aviso no era cierto, usa «Descartar».

> 💡 Mientras el caso esté abierto, AgenIA no le envía recordatorios a ese paciente. Al cerrarlo (resuelto o descartado), vuelven solos. También se abre cuando al recordatorio le contesta la contestadora automática de un negocio («Gracias por comunicarte con…»): el asistente no le responde a una contestadora.

##### Escribirle al paciente desde un caso

1. En la tarjeta del caso, pulsa «Escribir al paciente» (aparece en los casos que tienen una cita con paciente).
2. Lee por dónde va: por WhatsApp, al número que se muestra y hasta qué hora se le puede escribir; o por Telegram.
3. Elige un texto sugerido: «Cita cancelada (con disculpas)», «La cita sigue en pie» u «Otro mensaje». Trae el nombre del paciente, el servicio, la fecha y el médico.
4. Corrige lo que haga falta y pulsa «Enviar por WhatsApp» (o «Enviar por Telegram»).
5. El historial del caso queda con «Le escribió al paciente», por dónde y a qué número; el texto queda en la conversación del paciente (Rastreo).

> 💡 El mensaje no cancela ni cambia la cita: si se canceló, hazlo también donde corresponda. WhatsApp solo deja escribirle si el paciente (o quien agendó por él) escribió en las últimas 24 horas; si no, el panel lo dice y hay que llamarlo. Si la cita la agendó un familiar desde su celular, el mensaje va a ese número.

##### Configurar los avisos por WhatsApp al agendador

1. Pulsa «Configurar avisos».
2. Escribe el celular del agendador y, si quieres, uno de respaldo (por ejemplo, un coordinador).
3. Marca «Avisar por WhatsApp cuando una cita no llegue al hospital» y guarda.

> 💡 El aviso lleva solo un resumen, sin datos de pacientes. Si en 30 minutos nadie toma la excepción, se recuerda hasta 2 veces (también al respaldo). Necesita la plantilla «Aviso al agendador» en Configuración. Con la plantilla «Aviso al agendador (pedidos de pacientes)» también se le avisa, al mismo celular, cuando un paciente pidió cancelar y no confirmó o avisó que no irá y a su cita le faltan 24 horas o menos (y otra vez a 4 horas).

##### Buscar y filtrar

1. Usa «Activas», «Sin dueño», «Mías» o «Cerradas».
2. Busca por médico, paciente, título o nota.
3. Filtra por tipo, médico y fechas. «Limpiar filtros» vuelve a empezar.
4. Pulsa «Ver historial» en una tarjeta para ver qué pasó, o «Ver el caso completo en Rastreo de paciente».

#### Qué ves en la pantalla

- **Activas / Sin dueño / Mías / Críticas:** Las cifras de arriba. Críticas: la cita es en menos de 4 horas.
- **Gravedad:** Baja, Media, Alta (cita en menos de 24 horas) o Crítica (menos de 4 horas).
- **Tipos de excepción:** Cita que el hospital aún no tiene · Un cambio se rindió sin llegar al hospital · Conflicto entre AgenIA y el hospital · Error al aplicar un cambio · El hospital no tiene una cita que AgenIA da por hecha · Cita del hospital con un documento ambiguo · Un paciente avisó que no irá o pide otra fecha · El teléfono de un paciente es de otra persona · Cancelación que el hospital no aplicó · El hospital canceló una cita agendada por el asistente · El hospital cambió la hora de una cita agendada por el asistente · Revisar una cita agendada por el asistente · Médico del hospital con citas que aún no está en AgenIA · Médico del hospital agregado automáticamente · Un paciente pidió cancelar y no confirmó.
- **Estados de cierre:** Resuelta o Descartada (con nota de una persona), Se cerró sola (el problema desapareció) o Venció sin resolución (la cita pasó hace más de 7 días y nadie la cerró).

#### Preguntas frecuentes

##### ¿Por qué una excepción se cerró sola?

Porque dejó de cumplirse la condición: por ejemplo, la cita ya llegó al hospital o se canceló.

##### ¿El aviso de un paciente que no irá cancela su cita?

No. Ni el bot ni la bandeja escriben nada en el hospital: la cita sigue igual hasta que alguien la cancele o la mueva en el HIS. Cuando eso pasa, el aviso se cierra solo; también cuando el hospital marca que el paciente asistió o que no asistió, porque ya no queda nada por hacer.

##### ¿Se le avisa al agendador por WhatsApp de estos avisos de pacientes?

Sí, cuando la cita está cerca: si un paciente pidió cancelar y no confirmó, o avisó que no irá, y a su cita le faltan 24 horas o menos sin que nadie haya tomado el caso, el agendador recibe un WhatsApp con un resumen sin datos del paciente, y otro cuando faltan 4 horas. Si en 30 minutos nadie lo toma, se le recuerda hasta 2 veces. Necesita la plantilla «Aviso al agendador (pedidos de pacientes)» aprobada en Meta y registrada en Configuración; el panel de arriba dice si está saliendo. El teléfono equivocado y los demás avisos de pacientes solo quedan en la bandeja.

##### ¿Qué es «Cancelación que el hospital no aplicó»?

AgenIA canceló una cita, pero en el sistema del hospital esa hora del médico tiene la cita de OTRA persona, así que no se borró nada allá (borrarla habría dejado sin cita a otro paciente). La cita sigue cancelada en AgenIA. Busca en el HIS dónde quedó la cita de este paciente y cancélala allá si corresponde; luego pulsa «Resolver».

##### ¿Qué es «El hospital canceló (o cambió la hora de) una cita agendada por el asistente»?

En el sistema del hospital cancelaron una cita futura que el paciente había agendado por WhatsApp o Telegram, o se la pasaron a otro médico u otra hora. AgenIA le escribe al paciente por donde agendó: «su cita… fue cancelada en el hospital» con el teléfono de la clínica o, si el hospital le dio otra cita, «el hospital cambió su cita: antes… ahora…». Cuando es una cancelación, el aviso espera unos 10 minutos (si la cita es en más de una hora), porque a veces el hospital anula una cita y la vuelve a crear: si la vuelve a crear igual, no se le escribe nada y el caso se cierra solo; si le da otra, se le avisa la nueva. Mientras espera, el caso dice a qué hora saldrá el aviso; si le escribes tú antes con «Escribir al paciente», el automático ya no sale. Si el paciente no ha escrito en las últimas 24 horas, el aviso sale con una plantilla aprobada: «Cita cancelada por el hospital» o, si le dieron otra cita, «Confirmación de una cita del hospital». El caso dice si el aviso salió, cómo va (enviado, entregado, leído) o por qué no salió: falta registrar esa plantilla en Configuración, un teléfono marcado como de otra persona, o un fallo. Confirma que el paciente quedó enterado —llámalo si el aviso no salió— y pulsa «Resolver».

##### ¿Qué es «Médico del hospital con citas que aún no está en AgenIA»?

Un médico del hospital tiene citas de un servicio que AgenIA maneja (por ejemplo, medicina general) y no está en AgenIA, así que sus pacientes no reciben recordatorios ni pueden gestionar esas citas por chat. El caso muestra su nombre, su código en el hospital, su cargo, el final de su cédula, cuántas citas tiene y cuándo es la primera. El administrador lo crea y homologa con «Crear y homologar»: marca la casilla si quiere encender su WhatsApp de una vez. Si el caso dice que no se puede crear desde ahí (por ejemplo, su cédula la comparten varias agendas del hospital), se homologa a mano en Espejo › Homologación. El caso se cierra solo cuando el médico queda homologado o ya no tiene esas citas.

##### ¿Qué es «Médico del hospital agregado automáticamente»?

Con «Agregar solos los médicos nuevos del hospital» encendido en Configuración, AgenIA creó y homologó a ese médico porque cumplía todas las reglas. Revisa que sea correcto y decide su WhatsApp en Médicos; si no corresponde, deshomológalo en Espejo › Homologación.

##### ¿Qué es «Revisar una cita agendada por el asistente»?

Poco después de agendar con el asistente (hasta 24 horas), el paciente preguntó si la cita era para otro servicio que no se agenda por ese medio («¿esto sí es para las ecografías?»), escribió que no era la cita que necesitaba, o la confirmó después de preguntar por otro servicio. El asistente no cambió la cita. Comunícate con el paciente para confirmar si la necesita; si no, cancélala para liberar el cupo y oriéntalo. El caso se cierra solo si la cita se cancela o cambia de hora.

##### ¿Qué es «Un paciente pidió cancelar y no confirmó»?

El paciente pidió por WhatsApp o Telegram cancelar su cita («Cancelar esta cita por favor», «no puedo ir»), el asistente le mostró la cita y le preguntó si la cancelaba, y pasó una hora sin que respondiera SÍ o NO. La cita sigue en pie y su cupo ocupado. El caso muestra lo que escribió al pedirlo, cuándo se le preguntó y lo que escribió después, si escribió algo. Comunícate con el paciente: si no va a asistir, cancela la cita para liberar el cupo; si la mantiene, pulsa «Resolver». Si tenía varias citas y no eligió cuál, queda un caso por cada una. El caso se cierra solo si la cita se cancela o cambia de hora, o cuando el hospital marca que el paciente asistió o que no asistió, y no se vuelve a abrir si alguien ya lo cerró.

##### ¿Por qué no me deja escribirle al paciente?

Porque WhatsApp solo entrega un mensaje escrito por el personal si el paciente escribió en las últimas 24 horas: fuera de ese plazo, el panel lo dice y no envía nada (llámalo; su teléfono está en Pacientes). Tampoco se le escribe si su teléfono está marcado como de otra persona (hay un caso abierto de ese tipo) o si no tiene WhatsApp ni Telegram registrados.

##### ¿Qué es «Cita del hospital con un documento ambiguo»?

El hospital agendó una cita con un documento que podría ser de más de un paciente de AgenIA (por ejemplo, con ceros a la izquierda distintos). No se crea sola para no mezclar dos historias: decide una persona.

#### Si algo no sale bien

##### El panel dice «Los avisos por WhatsApp al agendador NO están saliendo».

Lee el motivo: suele faltar la plantilla «Aviso al agendador» o el celular. Mientras tanto hay que abrir la bandeja para enterarse.

##### El panel dice que los pedidos de pacientes no se avisan por WhatsApp.

Falta la plantilla «Aviso al agendador (pedidos de pacientes)»: créala en Meta (categoría Utilidad, tres variables: cuántos casos, la cita más próxima y qué pidió el paciente) y regístrala en Configuración › Integraciones › Plantillas de WhatsApp. No uses la del «Aviso al agendador»: su texto dice que las citas no llegaron al hospital. Mientras tanto, esos casos solo se ven en la bandeja.

##### Solo se muestran 500.

Resuelve o descarta las que ya no importan, o filtra para ver el resto.

### 📣 Avisos masivos {#avisos}

- **Ruta:** `/dashboard/espejo/avisos`
- **Resumen:** Avisa por WhatsApp, paciente por paciente, a quienes tienen cita el día de un especialista: que se canceló o que se les espera.
- **Disponibilidad:** Solo aparece en las clínicas conectadas al sistema del hospital. La ven el Administrador y los Agentes de Reservas, aunque la función esté apagada: el Administrador la enciende desde esta misma pantalla, y mientras tanto a los Agentes de Reservas la pantalla les indica que un administrador debe activarla.
- **Relacionados:** [Espejo con el HIS](#espejo), [Configuración](#configuracion), [Rastreo de paciente](#rastreo)
- **Palabras clave:** avisos, cancelación masiva, médico no asiste, especialista ausente, recordatorio masivo, mensajes masivos, lote, notificar pacientes

#### Para qué sirve

Cuando un especialista no puede asistir, o cuando quieres recordar de antemano su día de agenda, armas la lista de pacientes de ese día y les envías el mensaje. No es una campaña masiva: es para el puñado de pacientes de un día. El aviso de cancelación solo informa; la cita se cancela por el proceso de siempre del hospital.

#### Paso a paso

##### Enviar un aviso

1. Elige el tipo: «El especialista no puede asistir» (informa que la cita se canceló) o «Recuerda de antemano un día de agenda» (la cita sigue en pie).
2. Paso 1 · Arma la lista: «Traer del hospital» (eliges médico y fechas; el agente responde en su siguiente vuelta) o sube una hoja CSV o Excel, valídala y pulsa «Cargar información».
3. Paso 2 · Escoge a quién escribirle y revisa la vista previa del mensaje. Puedes agregar una nota.
4. Escribe el número de pacientes para confirmar y pulsa «Enviar».

> 💡 No se puede deshacer: WhatsApp no borra los mensajes entregados. Necesita las plantillas «Aviso de cancelación» y «Recordatorio masivo» en Configuración.

##### Activar la función para la clínica

1. Marca «Habilitar avisos de cancelación para esta clínica».
2. Elige cómo se arma la lista (hoja electrónica o directo del espejo), el ritmo de envío y el máximo de destinatarios por lote.
3. Pulsa «Guardar configuración».

#### Qué ves en la pantalla

- **Ritmo de envío:** Mensajes por minuto: se envían de a uno para no saturar WhatsApp.
- **Historial:** Cada lote enviado, con su resultado por paciente.

#### Preguntas frecuentes

##### ¿El aviso de cancelación anula la cita en el hospital?

No. Solo informa al paciente. La cancelación se hace por el proceso habitual del hospital.

##### ¿Qué pasa con un paciente sin celular válido?

No se puede seleccionar: hay que avisarle por otro medio.

#### Si algo no sale bien

##### Sale «El agente no respondió a tiempo».

Verifica en Espejo con el HIS que el agente esté conectado e intenta de nuevo.

##### La lista se recortó.

Trajo más citas de las que caben en un lote. Reduce el rango de fechas.

## Glosario {#glosario}

- **HIS:** Sistema de información del hospital: donde el hospital lleva su agenda y sus citas.
  - También se dice: sistema del hospital
  - Se ve en: [Espejo con el HIS](#espejo)
- **Espejo:** La conexión que mantiene sincronizadas las citas entre AgenIA y el HIS, en las dos direcciones.
  - También se dice: sincronización
  - Se ve en: [Espejo con el HIS](#espejo)
- **Agente del hospital:** Programa instalado en un servidor del hospital que lleva y trae la información entre AgenIA y el HIS. No confundir con el Agente de Reservas, que es una persona.
  - Se ve en: [Espejo con el HIS](#espejo)
- **Agente de Reservas:** Rol del personal que agenda citas desde el panel y atiende en ventanilla. Puede estar limitado a una EPS o a un médico.
  - Se ve en: [Usuarios](#usuarios)
- **Límite de citas:** Máximo de citas que un paciente puede tener por el asistente el mismo día y en el mismo mes. Pasado el límite, el asistente lo remite al hospital y le ofrece pedir una revisión.
  - También se dice: tope de citas, máximo de citas
  - Se ve en: [Límite de citas](#limites-citas)
- **Cupo (slot):** Espacio de tiempo de un médico en el que se puede agendar una cita.
  - También se dice: turno, horario, hueco
  - Se ve en: [Agendas (Slots)](#agenda)
- **Cupo universal:** Cupo que el asistente ofrece a pacientes de cualquier EPS. Se ve en azul en el calendario.
  - Se ve en: [Agendas (Slots)](#agenda)
- **Cupo exclusivo de EPS:** Cupo que el asistente solo ofrece a afiliados de una EPS. Se ve en verde.
  - Se ve en: [Agendas (Slots)](#agenda)
- **EPS:** Entidad Promotora de Salud: la aseguradora del paciente.
  - También se dice: aseguradora, convenio
  - Se ve en: [Aseguradoras (EPS)](#eps)
- **Régimen:** Tipo de afiliación del paciente: subsidiado o contributivo. Algunas EPS solo tienen convenio para uno de los dos.
  - Se ve en: [Aseguradoras (EPS)](#eps)
- **Padrón:** Listado de afiliados de una EPS habilitados para agendar por esa EPS.
  - Se ve en: [Padrón EPS (Altas)](#padron)
- **Corte del padrón:** Cada archivo cargado al padrón. Reemplaza el padrón activo de esa EPS: quien no viene, queda inactivo.
  - Se ve en: [Padrón EPS (Altas)](#padron)
- **Particular:** Cita sin EPS (pago directo). No necesita estar en el padrón.
  - Se ve en: [Padrón EPS (Altas)](#padron)
- **Asistente virtual:** El bot que atiende a los pacientes por WhatsApp y Telegram: agenda, cancela, cambia fechas y responde preguntas.
  - También se dice: bot, chatbot
  - Se ve en: [Configuración](#configuracion)
- **Base de conocimiento:** El texto con la información de la clínica que el asistente usa para responder preguntas. No responde nada que no esté ahí.
  - Se ve en: [Configuración](#configuracion)
- **Plantilla de WhatsApp:** Mensaje aprobado por Meta que se puede enviar fuera de la ventana de 24 horas.
  - También se dice: template
  - Se ve en: [Configuración](#configuracion)
- **Ventana de 24 horas:** Plazo después del último mensaje del paciente en el que WhatsApp deja enviar texto libre. Fuera de él solo se pueden enviar plantillas.
  - Se ve en: [Configuración](#configuracion)
- **BSUID:** Identificador que WhatsApp le da a una persona para una empresa. Sirve para reconocerla cuando no se conoce su teléfono.
  - Se ve en: [Rastreo de paciente](#rastreo)
- **Caja Negra:** Registro de las conversaciones con el asistente que fallaron, se abandonaron o se derivaron por emergencia.
  - Se ve en: [Caja Negra (Auditoría)](#auditoria)
- **Lista de espera:** Pacientes que pidieron quedar en cola porque no había cupo. Se gestionan desde la Caja Negra.
  - Se ve en: [Caja Negra (Auditoría)](#auditoria)
- **Homologar:** Emparejar un médico del HIS con su perfil en AgenIA. Sin homologar, el médico no recibe cupos ni citas del hospital.
  - Se ve en: [Espejo con el HIS](#espejo)
- **Modo de agenda:** OFF: la agenda es la de AgenIA. SHADOW: se compara con la del hospital sin cambiar nada. ON: la agenda de AgenIA es la del hospital.
  - Se ve en: [Espejo con el HIS](#espejo)
- **Interruptores de operaciones:** Agendar, cancelar y cambiar la fecha, cada uno en Configuración. Con la clínica conectada al hospital, encendido la operación llega al HIS; apagado no se puede hacer en AgenIA y se hace en el HIS. Reemplazan al antiguo «envío al hospital».
  - También se dice: envío al hospital, envío de citas nuevas
  - Se ve en: [Espejo con el HIS](#espejo)
- **Evento rendido:** Un envío al hospital que falló diez veces y dejó de reintentarse. Se puede devolver a la cola desde el Espejo.
  - También se dice: dead letter
  - Se ve en: [Espejo con el HIS](#espejo)
- **Excepción de sincronización:** Un problema detectado entre AgenIA y el hospital que alguien debe revisar en la Bandeja.
  - Se ve en: [Bandeja de sincronización](#bandeja)
- **Veredicto:** La conclusión del Rastreo de paciente: qué consta, de qué fuente, qué no se puede afirmar y qué hacer.
  - Se ve en: [Rastreo de paciente](#rastreo)
- **Origen de la cita:** Por dónde se agendó: WhatsApp, Telegram, Manual (el personal) o Hospital (el HIS).
  - Se ve en: [Visión General](#vision-general)
- **Conversión:** Porcentaje de las personas que escribieron al asistente que terminaron con una cita.
  - Se ve en: [Canales en vivo](#canales)
- **CSAT:** Encuesta de satisfacción: el paciente califica la atención del asistente de 1 a 5 estrellas.
  - También se dice: satisfacción
  - Se ve en: [Encuestas (CSAT)](#encuestas)
- **Recordatorio:** Mensaje al paciente antes de su cita. Puede ser automático (Configuración) o manual (Visión General).
  - Se ve en: [Visión General](#vision-general)

<!-- AYUDA:FIN -->

---

# Parte 2 · Cómo funciona AgenIA

Esta parte no la muestra la página de ayuda. Describe el sistema completo, por dentro, para quien lo opera, lo mantiene o lo extiende. Cada sección dice qué hace el sistema hoy y dónde está el detalle.

## 1. Qué es AgenIA

AgenIA es una plataforma de agendamiento de citas médicas para clínicas y hospitales de Colombia, multiclínica (cada clínica es una organización aislada de las demás). Tiene tres frentes:

1. **El asistente virtual** que atiende a los pacientes por WhatsApp y Telegram: agenda, cancela, cambia la fecha y consulta citas, responde preguntas de la clínica, envía recordatorios y deriva emergencias.
2. **El panel web** para el personal de la clínica (administrador, agentes de reservas, médicos, observadores) y para el equipo de AgenIA (super administrador).
3. **El espejo con el hospital**: un agente instalado en el servidor del hospital que mantiene sincronizadas las citas entre AgenIA y el sistema de información del hospital (HIS), en las dos direcciones.

La zona horaria de referencia es `America/Bogota` (cada clínica puede tener la suya en `Organization.timezone`).

## 2. Roles y qué ve cada uno

| Rol | Quién es | Qué ve en el panel |
|---|---|---|
| `ORG_ADMIN` · Administrador del Hospital | Administra la clínica | Todo el menú de la Parte 1. Con espejo: también Espejo con el HIS y Bandeja de sincronización; con el driver de avisos: Avisos masivos. Es el único que ve el Centro de ayuda. |
| `BOOKING_AGENT` · Agente de Reservas | Agenda en ventanilla o por teléfono | Visión General, Agendamiento, Caja Negra, Rastreo de paciente, Solicitudes de más citas y Soporte (el Límite de citas es solo del administrador); con espejo, la Bandeja; con el driver de avisos, Avisos masivos. Puede estar acotado a una EPS o a un médico (`AgentProfile`). |
| `DOCTOR` · Médico | Atiende | Mi Agenda (sus citas), Rastreo de paciente (solo pacientes con cita suya) y Soporte. |
| `PATIENT` · Paciente | Persona con cuenta en el panel | Mis Citas Programadas y Soporte. |
| `GENERAL_OBSERVER` · Observador general | Gerencia o control | Analíticas de Negocio, Canales en vivo y Soporte. Se asigna en Usuarios. |
| `SUPER_ADMIN` · Equipo de AgenIA | Opera la plataforma | `/super-admin`: Organizaciones (y sus administradores), Estadísticas Globales, Canales en vivo, Encuestas (CSAT), Facturación Global, Mesa de Ayuda, Asistente de soporte, Monitor de Servicios, Alertas técnicas, Actividad de usuarios (con «Cerrar sesiones» de una persona o de toda una clínica), Auditoría y Logs, Rastreo de paciente; «Cambiar mi clave» al pie del menú (`/super-admin/cuenta`). Las cuentas de super administrador se crean en el servidor (`agenia superadmin`, §9). |

El menú de cada rol sale de `packages/shared/src/menus.ts` (la web lo reexporta en `apps/web/lib/menus.ts`); el permiso real lo aplica cada página y cada acción del servidor. Todos los usuarios del panel cambian su propia clave en «Cambiar mi clave», al pie del menú (`/dashboard/cuenta`; el super administrador, `/super-admin/cuenta`); no es una opción del menú. Crear, editar y borrar usuarios de una clínica lo puede hacer solo su administrador (la acción lo comprueba: antes cualquier sesión de la clínica podía, incluso crear un `SUPER_ADMIN`), y solo con los roles de una clínica; el super administrador crea los administradores de cada clínica en Organizaciones.

## 3. El asistente virtual

### 3.1 Canales e identidad

- **WhatsApp** (Meta Cloud API, una cuenta por clínica) y **Telegram** (un bot por clínica, se activa con `TELEGRAM_ENABLED` en el servidor y por clínica). Es el mismo asistente en los dos canales y la ficha del paciente es una sola, identificada por su cédula.
- El remitente de WhatsApp se reconoce por **teléfono primero y BSUID solo si no hay teléfono** (el BSUID es el identificador que Meta da a una persona frente a una empresa; llega en `from_user_id`). El de Telegram, por su chat (`tg:<chat_id>`).
- El BSUID y el chat de Telegram se guardan **por clínica y no son únicos**: una familia comparte un número. Nunca se usa el «Parent BSUID» de Meta, que cruzaría a una persona entre clínicas.
- Los textos que nombran el canal («por WhatsApp», «por Telegram») salen del canal real de la conversación.

### 3.2 Qué puede hacer el paciente

| Operación | Interruptor (Configuración › Asistente Virtual) | Notas |
|---|---|---|
| Agendar una cita nueva (y aceptar un cupo de la lista de espera) | `bookingEnabled` | Sujeto al límite de citas por paciente. |
| Cancelar una cita | `cancelEnabled` | Solo citas del propio remitente. |
| Cambiar la fecha de una cita | `rescheduleEnabled` | Solo citas del propio remitente; también cuenta para el límite. |
| Consultar sus citas («¿qué citas tengo?», «consultar») | siempre | El detalle solo si el remitente es el paciente; a otro, una respuesta mínima. |
| Preguntar por la clínica | siempre | Responde solo con la Base de Conocimiento de la clínica. |
| Dejar de recibir recordatorios («no quiero recordatorios») | siempre | Frases fijas, sin IA (`PatientProfile.remindersOptOut`). |

Con una operación apagada, el asistente dice cuál no está disponible, con quién hacerla y qué sí puede hacer. Con las tres apagadas queda en «solo consultas». Los interruptores se leen en cada mensaje (no hace falta reiniciar).

### 3.3 Agendar

El asistente pide la especialidad (solo servicios activos), la EPS o si es particular, ofrece horarios libres —menos los de los días u horas que la clínica bloqueó en Configuración › Días sin citas (tabla `BookingBlock`, regla en `packages/shared/src/bloqueos-agenda.ts`: cuenta la hora de inicio de la cita en la zona de la clínica; se quitan en la consulta misma y se revisan otra vez al reservar, al cambiar la fecha y en la lista de espera; el panel y el HIS no tienen bloqueos)— (por defecto 6, entre 2 y 12, repartidos entre mañana y tarde) que empiecen al menos 60 minutos después (`ANTICIPACION_MINIMA_AGENDAR_MIN`, en `packages/shared/src/cupos-ofrecidos.ts`) e identifica al paciente por su cédula. Al confirmar, al cupo todavía le deben faltar al menos 30 minutos; si no, ofrece otros. La misma regla aplica al cambiar la fecha y a la lista de espera; el personal y el hospital no tienen mínimo. Si la clínica fijó un plazo máximo para agendar (Configuración › Asistente Virtual, `OrganizationSettings.bookingMaxDaysAhead`, regla en `packages/shared/src/plazo-agendar.ts`), solo ofrece citas hasta el último día del plazo, contando hoy como el primero en la zona de la clínica (con 3: hoy, mañana y pasado mañana); el tope va en la consulta misma y se revisa otra vez al reservar, al cambiar la fecha y en la lista de espera. Sin valor (lo de fábrica) no hay límite, y el panel y el HIS no lo tienen. Si dentro del plazo no queda ningún cupo pero sí más adelante (`AppointmentsService.cupoMasAllaDelPlazo`, que busca sin el plazo solo para eso), el asistente no dice «agenda completa»: dice hasta qué día se agenda y desde cuál escribir (el día del primer cupo menos el plazo y uno, `primerDiaParaVerElCupo`) y ofrece la lista de espera como siempre; al cambiar la fecha, deja la cita como está y no ofrece cancelarla. En el panel, el control muestra los cupos que el asistente puede ofrecer hoy con el plazo guardado (`apps/web/lib/plazo-agendar/resumen.ts`, con las mismas reglas: libres, servicio activo, médico con WhatsApp ON y homologado, anticipación mínima y días sin citas) y avisa si no queda ninguno; cada cambio del plazo queda en `SyncAudit` (`CONFIG`, `BOOKING_MAX_DAYS_CHANGE`, con el valor anterior, el nuevo y quién). A un paciente nuevo —o a uno existente al que le falte algo en la ficha— le pide nombre, apellidos, fecha de nacimiento, sexo y régimen. El nombre va en dos pasos marcados «Paso 1 de 2: solo sus NOMBRES» y «Paso 2 de 2: solo sus APELLIDOS», porque el HIS los guarda en columnas aparte. Si en los nombres escribió también los apellidos («Juan Camilo Hurtado Ramos» y luego «Hurtado Ramos»), los separa cuando lo repetido son dos palabras o más; si escribe lo mismo en los dos pasos, le vuelve a pedir solo los apellidos (`apps/api/src/chatbot/nombre-paciente-nuevo.ts`). Cada vez que escribe sus nombres se le vuelven a pedir los apellidos, y si responde NO al resumen, el siguiente intento le vuelve a preguntar nombre, apellidos, nacimiento, sexo y régimen: nada de un intento anterior se reusa en silencio. Si en el menú de servicios nombra uno que la clínica no agenda por el asistente (odontología, ecografías, laboratorio, especialistas…; lista en `apps/api/src/chatbot/servicio-no-agendable.ts`, y solo si no está en el menú de la clínica), le dice que por este medio no se agenda, con quién comunicarse y le deja el menú, sin gastar intentos. En los nombres y los apellidos rechaza lo que no puede ser un nombre —dígitos, una pregunta o palabras como «horario», «cita», «mañana», «gracias» (`noEsUnNombre`; nombres que son palabras, como Luz, Dolores o Domingo, pasan)— y se los vuelve a pedir sin guardarlo, con la pista de escribir «Cancelar» si lo que quería era otro horario (2026-10-26: «Otro horario» quedó como los nombres de una paciente nueva).

**Otro día u otra hora en el menú de cupos** (2026-10-27; reglas en `packages/shared/src/otro-horario.ts`). Si después del último día ofrecido hay cupos (`AppointmentsService.hayCuposDesde`), el menú trae una opción más, «Otro día», con la letra siguiente (clave `temp_slot_otro_dia`). Si la respuesta no es una letra ni casa con un único cupo ofrecido, `interpretarOtroHorario` decide si pidió otra cosa: un día («mañana», «el miércoles 28», «28 de octubre»; el número manda sobre el nombre del día), una franja («en la tarde», «más temprano», «a las 3»; «muy temprano» es queja y pide la tarde; con un rechazo, «no puedo en la mañana», la contraria), otro día sin decir cuál («otro día», «ninguno», «no», «no me sirve»: desde el día siguiente al último ofrecido) o los que siguen («otro horario», «más opciones»). Se buscan con las reglas de siempre más la franja y sin los cupos que ya vio en la conversación (`temp_slot_vistos`); si pidió un día y así no queda nada, con ellos; si no hay nada en lo que pidió, los más próximos (desde ese día, o sin la franja), y si tampoco, le dice que los que vio siguen en pie. Un día más allá del plazo para agendar recibe hasta cuándo se agenda y desde cuándo escribir, sin tocar el menú. Cada menú nuevo borra las letras del anterior. Si lo que nombra casa con varios cupos que ya ve («mañana» con los tres de mañana, «la de las diez» con dos a las diez), le pide la letra (`cupoAmbiguo`). Volver a ofrecer no cuenta como reintento y queda en la Caja Negra como `SLOTS_REOFFERED` (el primero sigue siendo `SLOTS_OFFERED`). Lo que no se entiende queda como `SLOT_NOT_UNDERSTOOD` («No se entendió el horario»; antes `SESSION_EXPIRED`, igual que una letra inválida al cambiar la fecha), con un mensaje que dice que también puede escribir el día o la hora. El 26 y 27 de octubre, de 34 personas que vieron cupos, 17 agendaron, y al menos 5 pidieron otro día y recibieron «Esa letra no aparece entre las opciones».

**Ajustes del diagnóstico del 28 de octubre** (frases reales del 27 y 28; reglas en `packages/shared/src/parse-fecha-preferida.ts`, `parse-hora-preferida.ts`, `otro-horario.ts`, `eleccion-de-cupo.ts` y `parse-fecha-nacimiento.ts`):

- **Día de la semana con una hora.** El número después del día de la semana es una hora si lleva minutos (`:30`, `.30`, `;30`, `7 50`), am/pm, «de la tarde» u «horas»: «Jueves 7 50» se leía sábado 7 de noviembre y «Miércoles 3:30 pm», martes 3. Si el número no cae en ese día de la semana, o el mes dicho no cuadra («el jueves 12 de octubre», con el 12 en lunes), manda el día de la semana. Una fecha sin año que pasó hace tres meses o menos ya no se lee como del año entrante (`null`, no se adivina). En el menú (`incluirHoy`), el día de la semana que es hoy es hoy («el próximo miércoles» sigue siendo el de la semana entrante).
- **La hora.** `parseHoraPreferida` lee «9am», «3:00pm», «alas 9», «11;20», «dos y cuarenta», «a las 7 50» y «jueves 29 750». Con una hora pedida, `getAvailableSlots` (`opts.hora`) ofrece los cupos más cercanos a ella (`cuposMasCercanosALaHora`; sin «de la tarde», de 1 a 6 es de la tarde) en vez de mitad mañana y mitad tarde, y sin quitar los que ya vio.
- **Una hora con un «no»** (2026-10-29). «No quedaría bien para las 6:30», «no me sirve a las 10» o «no puedo a las 8» rechazan esa hora: no eligen el cupo que la tiene (`esRechazo`, en `otro-horario.ts`, va antes de buscar el cupo por la hora o la voz) y el asistente muestra los horarios que siguen sin los que ya vio, como con «otro horario» (no salta a otro día). Una franja con un rechazo sigue pidiendo la contraria («no puedo en la mañana» busca la tarde). Lo mismo al cambiar la fecha: la cita no se mueve a la hora rechazada. El 29 de octubre, a «No quedaría bien para las 6:30» el asistente le reservó a la paciente las 6:30.
- **Elegir en el menú.** La letra dentro de una frase («Perdón es B», «Laletra B», «mejor la C»: `letraEnLaFrase`); con varios cupos a la hora que dice, el médico que nombra (`cuposDelMedicoNombrado`, guardado por letra en `temp_slot_<L>_medico`); «Otra» y «Tarde» a secas; «El28 de octubre»; y «Muchas gracias» lo despide (`GOODBYE`) en vez de pedirle la letra.
- **Cupo apartado.** Al elegir, el cupo queda apartado `CUPO_APARTADO_TTL` (10 minutos, clave `cupo_apartado:<clínica>:<cupo>` con el remitente) y se renueva con cada respuesta del registro: no se le ofrece a otro paciente del chat (`cuposParaElMenu`, también en el menú de cambiar la fecha) y si otro lo elige o lo confirma, recibe un menú nuevo. Es solo de AgenIA: el hospital no se toca y su mostrador puede tomarlo. Se suelta al cerrar la sesión, al elegir otro o al reservar. El 27 y 28 de octubre, 7 de los 10 «ese horario lo acaba de tomar otro paciente» fueron otro paciente del chat mientras el primero escribía su registro. Tras un cupo tomado, rechazado por el hospital o de un médico que dejó de recibir por WhatsApp, el asistente arma un menú nuevo con lo que queda (`reofrecerTrasCupoTomado`; si no queda nada, lo dice y cierra) en vez de pedir «la letra nuevamente» del menú viejo, donde otras letras también estaban tomadas.
- **La cédula del paciente.** Tras elegir el horario pide «la cédula del paciente» o «de quien va a la cita», no «su cédula»: con un celular de la familia, el que escribe no siempre es el paciente.
- **Fecha de nacimiento.** `parseFechaNacimiento` acepta espacios como separador («19 01 1961»), el año primero («1961 19 de enero»), etiquetas («Día 19 año 1961 mes Enero»), «del año», signos y palabras pegadas («26 / 12/1971.», «DiecinuevedeEnero de1961»); solo con tres datos, nunca adivina. Al confirmar, «Está correcto» o escribirla igual otra vez cuentan como sí. Tras tres intentos sin entenderla (`NACIMIENTO_FALLAS_PARA_PARTES`), la pide por partes: el día, el mes y el año (`parseDiaDeNacimiento`, `parseMesDeNacimiento`, `parseAnioDeNacimiento`; claves `temp_alta_nacimiento_partes` y `_fallas`), y la devuelve completa para confirmarla como siempre; una fecha que no existe vuelve a empezar por el día. Una paciente de 65 años la escribió diez veces en 16 minutos y se fue sin cita.

Antes de confirmar comprueba:

- que la EPS exista en la clínica y esté activa; si el paciente nombra una EPS que la clínica no tiene registrada, le ofrece agendar como particular (pago directo); si la tiene registrada pero inactiva (la atiende, pero no por el asistente, como Nueva EPS en el hospital), le pide agendarla por teléfono con su EPS, sin ofrecerle la particular;
- que el paciente esté activo en el padrón de esa EPS (si no, lo remite al formulario público de Solicitudes de Alta);
- que la combinación EPS + régimen tenga convenio con el hospital (lista `blockedEpsRegimeCombos` del espejo) y que el paciente tenga régimen cuando el hospital lo exige; si el padrón conoce el régimen con certeza, lo toma de ahí;
- el límite de citas por paciente (§3.6);
- que el cupo siga libre (si otro paciente lo tomó, ofrece otros).

En el resumen, una **pregunta no es un SÍ** (`apps/api/src/chatbot/pregunta-al-confirmar.ts`): «¿Esto sí es para las ecografías?» no agenda; el asistente aclara de qué servicio y para cuándo es la cita —y, si la pregunta nombra un servicio que no se agenda por aquí, con quién pedirlo— y vuelve a pedir SÍ o NO. Sí confirman «Sí, ¿a qué hora llego?» (responde primero) y «¿me la puede agendar?» (pide justo eso). La misma regla vale al confirmar un cambio de fecha, una cancelación y un cupo de la lista de espera; un «no» sigue siendo no.

**Revisar una cita agendada por el asistente** (`REVISAR_CITA_ASISTENTE`, clave `revisar-cita:<cita>`): si el paciente confirma después de preguntar por otro servicio que no se agenda por aquí, o si en las 24 horas siguientes a agendar escribe —en reposo o en el menú de servicios— que no era la cita que necesitaba o pregunta si era para otro servicio (`apps/api/src/chatbot/duda-cita-agendada.ts`; el texto se revisa antes de consultar la base), queda un caso en la Bandeja con la cita y lo que escribió. La conversación sigue igual y la cita no se toca; el vigilante cierra el caso si la cita se cancela o cambia de hora.

**Con la clínica conectada al hospital**, el asistente no confirma hasta que el hospital registra la cita: espera unos 25 segundos; si el registro llega, confirma; si el hospital la rechaza, la anula y ofrece otro horario; si no llega a tiempo, avisa que está en proceso y manda un segundo mensaje cuando se resuelva (barrido cada 10 s, se abandona a las 24 h; para entonces la Bandeja ya avisó al personal). Lo mismo para cancelar y cambiar la fecha: el cupo anterior solo se libera cuando el hospital lo confirma. Si el hospital la rechaza porque el médico ya no tiene turno ese día (ajustó su agenda después de que AgenIA leyó los cupos), el asistente le dice al paciente «el hospital acaba de ajustar su agenda y ese horario ya no está disponible» y le muestra en el mismo mensaje los que quedan (`MSGS.agendaCambioOtrasOpciones`; sin ninguno, `agendaCambioSinOtros` con el teléfono de la clínica), en vez de «lo acaba de tomar otro paciente». Lo sabe por el motivo que guardó el rechazo en la cita (`metaLog.rechazoDelHis.motivo`, `rechazadaPorAgendaDelHis`). El 29 de octubre una paciente esperó la confirmación de una cita así que nunca llegó: el rechazo se reintentaba diez veces (§5.2).

### 3.4 Cancelar, cambiar la fecha y consultar

- El paciente se identifica con su cédula; si la escribió hace poco (15 min) no se le vuelve a pedir. Solo puede tocar citas cuyo perfil corresponde al remitente.
- «No puedo asistir» y variantes, respondiendo a un recordatorio, abren la cancelación de esa cita (o le preguntan cuál, si tiene varias recordadas).
- Una cita cuya hora ya llegó no se ofrece ni se cancela.
- Al confirmar la cancelación o el cambio, una pregunta («¿si la cancelo me dan otra?») no cuenta como SÍ: se le vuelve a pedir SÍ o NO (§3.3). «¿Me la cancela?» sí cancela.
- Si la operación está apagada, o la cita es de un servicio o médico con el que AgenIA no trabaja (§3.11), el aviso del paciente queda en la Bandeja de sincronización para el personal (tipo «Un paciente avisó que no irá o pide otra fecha») y al paciente se le dice que su aviso quedó registrado.
- Tras cancelar, ofrece reagendar si agendar está encendido; si al cambiar la fecha no hay cupos, ofrece cancelar si cancelar está encendido.
- **El menú de cambiar la fecha** (2026-10-28) entiende lo mismo que el de agendar: la letra dentro de una frase, el día o la hora de uno que ve (con varios, el médico que nombra), «Otro día» (opción al final si hay cupos en días siguientes, clave `temp_modify_otro_dia`), y lo que pide `interpretarOtroHorario` —«Ninguna», «otro día», «el viernes», «en la tarde», «a las 3»—, buscado como al agendar pero sin el cupo de la cita que ya tiene y sin repetir los que vio (`temp_modify_vistos`; `ofrecerOtroHorarioParaCambiar`, `mostrarMenuCambio`). «Ninguna» u «otro día» buscan solo desde el día siguiente al último ofrecido. Si no queda nada (`sinOtrosHorariosParaCambiar`): con cancelar encendido le ofrece cancelarla (SÍ la cancela, NO la conserva, `AWAITING_MODIFY_NO_SLOTS_CANCEL`); apagado, su pedido queda en la Bandeja como «Un paciente avisó que no irá o pide otra fecha» y la cita sigue en pie. «Gracias» lo despide sin tocar la cita, y lo que no entiende le dice que puede escribir el día, la hora o «Ninguna». El 28 de octubre, a «Ninguna, es que mañana debo viajar a Pereira» le contestaba «No reconozco esa opción» y la paciente se fue con su cita en pie.
- En ese menú, una hora con un «no» («No me sirve a las 10») no mueve la cita a esa hora (§3.3, 2026-10-29).
- Si el paciente pide cancelar, el asistente le pregunta si la cancela y pasa una hora (lo que dura la sesión) sin un SÍ ni un NO, el vigilante deja la cita en la Bandeja («Un paciente pidió cancelar y no confirmó», §5.5). El asistente no la cancela solo.
- La confirmación de cancelar dice de quién es la cita (👤 nombre del paciente): con un celular de la familia, el que escribe puede tener citas de varias personas (2026-10-28).
- «Necesito otra cita para…» es una cita nueva aunque el extractor la marque como cambio (`pideCitaNueva`, `apps/api/src/chatbot/cita-nueva-o-cambio.ts`); con «cambiar», «mover», «no puedo ir» o «en vez de» sí es un cambio. El 28 de octubre, «Nesesito otra cita para lectura de examenes», escrito justo después de agendar, movió en el hospital la cita recién agendada.

### 3.5 Lista de espera

Cuando no hay cupos, el paciente puede quedar en lista de espera para esa especialidad. Al liberarse un cupo se le ofrece al primero; si no confirma a tiempo, la oferta vence (barrido cada 5 min) y pasa al siguiente. La lista se ve desde la Caja Negra.

Quién recibe el cupo (`apps/api/src/waitlist/waitlist.service.ts`, 2026-10-26):

- **EPS:** un cupo para cualquier EPS (`ScheduleSlot.allowedEpsId` vacío, como todos los del hospital) se le ofrece al primero de la cola, tenga la EPS que tenga. Uno de una EPS, a los de esa EPS y a los particulares. Antes, un cupo para cualquier EPS solo cruzaba con quien entró sin EPS, y el asistente siempre anota la EPS: en el hospital la lista nunca le avisó a nadie. Al reofrecer el cupo tras un NO o un vencimiento se usa la EPS del cupo (guardada en la oferta, `metadata.epsDelCupo`), no la del paciente que lo rechazó.
- **Por dónde se le escribe:** WhatsApp solo entrega texto libre hasta 24 horas después del último mensaje del paciente. Se recorre la cola en orden: a quien escribió en ese tiempo, o usa Telegram, la oferta va con texto; a quien no, con la plantilla «Oferta de cupo» (`WAITLIST_SLOT_OFFER`, tres variables: primer nombre, servicio, y fecha y hora sin el punto final de «a. m.»; la decide `WaitlistService` y la envía `ChatbotService.notifyWaitlistCandidate`), si la clínica la tiene registrada y activa y es de 7:00 a 19:00 en la zona de la clínica (`HORARIO_OFERTA_CON_PLANTILLA`: de noche no alcanzaría a responder en los 30 minutos y el cupo saltaría al siguiente, también de noche). A quien no se le puede escribir de ninguna forma no se le escribe ni pierde su lugar. Si el mensaje no sale (Meta lo rechaza), vuelve a esperar con su turno y el cupo pasa al siguiente, y la conversación vuelve al paso en que estaba. Si a nadie se le puede escribir, el cupo queda en la agenda para quien lo pida. El aviso de «el tiempo para confirmar expiró» solo sale si le llega como texto.
- **Posición:** la que se le dice al paciente cuenta a todos los del mismo servicio que entraron antes, sin mirar la EPS.

### 3.6 Límite de citas por paciente

Por defecto 1 cita por día y 3 por mes, contadas por la **fecha de la cita** (mes calendario, zona de la clínica) sobre todas las citas vigentes de la cédula, sin importar quién las agendó. Aplica a agendar, a la lista de espera y al cambio de fecha. Pasado el límite, el asistente se disculpa, da el teléfono de soporte de la clínica y envía un enlace (válido 7 días) para pedir una revisión, que llega a Solicitudes de más citas. Aprobar concede citas adicionales solo para ese día o ese mes. El personal desde el panel y el hospital no tienen límite. Regla en `packages/shared/src/limite-citas.ts`. Al agendar, el aviso nombra a quién pertenece la cédula (nombre y últimos cuatro números) y cómo agendar para otra persona; y un «Cancelar» a secas en los 10 minutos siguientes (`aviso_limite:<clínica>:<remitente>`, `AVISO_LIMITE_TTL`; `esCancelarASecas`) deja la solicitud (`CANCELAR_TRAS_LIMITE`) en vez de ofrecer anular la cita que ya tiene: el 28 de octubre una madre que agendaba para sus hijos escribió «Cancelar» tras el aviso, confirmó «Sí» y se anularon las citas de dos niños. «Cancelar mi cita» sí abre la cancelación.

### 3.7 Respuestas sin IA

Antes de llamar a la IA, el asistente reconoce con reglas fijas (`apps/api/src/chatbot/respuesta-recordatorio.ts` y `chatbot-patterns.txt`) lo que la gente contesta a un recordatorio:

| Respuesta | Ejemplo | Qué hace el asistente |
|---|---|---|
| Confirma | «Sí voy», «👍», «Dios le bendiga», «con la ayuda de Dios… estoy atenta», «grasias», «la cita ya la tengo para mañana», «ya me la dieron» | Agradece (solo cuenta si acaba de recibir un recordatorio; una pregunta, aunque diga «sí» —«me indicas si sí es para las ecografías»—, no confirma). Un mensaje largo cuenta si lo dice sin dudas («si Dios quiere», «con la ayuda de Dios», «estoy atenta», «gracias por avisarme»). «Ya la tengo» no cuenta si pide otra cita o dice «no». |
| Saludo tras el recordatorio | «Hola buenos días», «buenas tardes señorita» | Con un recordatorio a ese número en las últimas 48 h: dice de qué cita le escribe y de quién, qué puede hacer por aquí y que avise si el número no es de esa persona. Con «Agendar» encendido, entre las opciones está agendar otra cita escribiendo *agendar*, y solo la primera vez en 6 horas: si vuelve a saludar, recibe el menú de siempre. Sin recordatorio, el saludo de siempre. |
| Quién escribe | «¿De dónde me hablan?» | Explica quién es y de qué cita se trata. |
| Pregunta por la cita | «¿A qué hora es?», «¿dónde queda?» | Le da los datos de su cita. |
| Pregunta su turno / ya llegó | «¿Qué número me toca?», «ya llegué» | Le indica pedir el turno en la recepción; si su cita es otro día, se lo dice. |
| Le dieron otra hora | «En ventanilla me dijeron que a las 5:50», «me dieron la cita para el jueves» | Le dice la hora con la que su cita está registrada en el hospital y que tenga en cuenta lo que le indicaron o lo confirme con la clínica. |
| Número equivocado | «Está equivocado de número», «hola, yo no soy Darío», «Yo no soy Deysi, está equivocada», «Este mensaje no era para mí» | Se disculpa, deja el caso en la Bandeja («El teléfono de un paciente es de otra persona») y no vuelve a recordarle hasta que se resuelva. Las frases sin «número» ni «persona» («está equivocada», «no era para mí», «no soy Darío») solo cuentan tras un recordatorio a ese número, y no si dice que es de la familia («es para mi mamá») o habla de su propia cita. El nombre que niega se compara por cómo suena: «Deysi» es DEICY y «Jhoana» es Johana. |
| Número ya marcado | Cualquier respuesta desde un número con el caso de teléfono equivocado abierto («Ok», «cancelar cita», un saludo) | Le dice que ya quedó registrado que el número no es del paciente y con quién hablar si tiene una cita propia. No confirma, no muestra, no cancela ni cambia las citas de ese paciente desde WhatsApp hasta que el personal cierre el caso. Si el número lo comparte la familia, las fichas sin caso se atienden como siempre. |
| No asistirá / cambiar | «No puedo asistir», «¿la puedo mover?» | Abre cancelar o cambiar (o deja aviso si no se puede). |
| Contestadora de un negocio | «Gracias por comunicarte con… te responderemos…» | No responde y deja el caso del teléfono en la Bandeja. |
| Agradecimiento | «Muchas gracias, buen día 🙏» | Se despide. |

Ante la duda no clasifica y el mensaje sigue el camino normal (con IA).

**Celular compartido** (2026-10-26): si desde un número que recibió el recordatorio de una persona se agenda por el asistente, después, una cita para otra (una familia con un solo celular), lo que se escribe a continuación es sobre la cita que se acaba de agendar. «Muchas gracias» es una despedida, no la confirmación del recordatorio de la otra persona; «¿dónde queda el consultorio?» responde con las dos citas, cada una con el nombre de su paciente; «no puedo ir» deja elegir cuál cancelar; y la pregunta por el turno, «ya llegué» y «me dieron otra hora» hablan de la recién agendada. Cuenta la cita agendada por WhatsApp o Telegram después del último recordatorio a ese número y en las últimas 24 horas (`citasAgendadasTrasElRecordatorio` en `chatbot.service.ts`). Antes, en un caso real del 24-oct, el asistente le dio a Jhon la hora de la cita de Marilyn y contó su «gracias» como que ella confirmaba.

Esto se revisa con la conversación en reposo y también dentro del agendamiento, por si un saludo ya abrió el menú: en el menú de servicios, quien recibió un recordatorio en las últimas 48 h y contesta algo de esta tabla (confirma, quién escribe, pregunta por su cita o su turno, ya llegó, le dieron otra hora, número equivocado) recibe esa respuesta y el menú se cierra. En los pasos de EPS y de horario solo se atiende el número equivocado; lo demás se toma como respuesta al paso. «No puedo ir» y «cambiarla» siguen su camino en el menú (se le pregunta si deja el agendamiento).

### 3.8 Barandas

- **Emergencias médicas**: cuatro capas (diccionario antes de la IA, marca de la IA, diccionario sobre la transcripción del audio y regla del prompt de preguntas) derivan al paciente a urgencias o al 123, cierran la conversación, avisan al teléfono de soporte de la clínica y lo dejan en la Caja Negra. Detalle: `docs/GUARDRAIL_EMERGENCIAS.md`.
- **Insultos, temas ajenos y reintentos**: tras 3 intentos fallidos en un paso (`maxRetriesPerStep`) o ante insultos, el asistente remite al teléfono de soporte de la clínica (`Organization.supportPhone`).
- **Inactividad**: si el paciente deja de responder, la conversación se cierra a los 5 minutos (`CHATBOT_INACTIVITY_TIMEOUT_MINUTES`; más tiempo mientras se registra un paciente nuevo) y se le avisa.
- Toda conversación que falla, se abandona o se deriva queda en la **Caja Negra** con su motivo.

### 3.9 Voz

El paciente puede escribir o mandar notas de voz: el audio se envía al proveedor de IA (Gemini u OpenAI; Claude no acepta audio). El asistente puede contestar con voz sintetizada (ElevenLabs o Google Cloud TTS, con Google de respaldo automático), configurable en Configuración › Asistente Virtual › Voz.

### 3.10 Encuesta de satisfacción

Al cerrar una gestión (agendar, cancelar, cambiar o quedar en lista de espera; nunca tras una emergencia) se envía un enlace de un solo uso, válido 24 horas, para calificar de 1 a 5 estrellas (`/encuesta/<token>`). Los resultados están en Encuestas (CSAT).

### 3.11 Alcance: con qué citas trabaja AgenIA

AgenIA solo trabaja con las citas de **médicos con «Reservas por WhatsApp» encendido (WhatsApp ON)** y de **servicios activos**: recordatorios (automáticos y manuales), respuestas del asistente, cancelar y cambiar la fecha. Las demás citas que trae el hospital se ven en el panel, pero se gestionan solo en el sistema del hospital; con espejo, la base de datos frena crear, cancelar o mover citas fuera de ese alcance (`AGENIA_OPERACION_APAGADA:FUERA_DE_ALCANCE`).

## 4. Recordatorios

- **Automáticos**: un proceso de la API corre cada 15 minutos y envía el recordatorio a las citas que están a 24 horas hábiles (sin contar sábados ni domingos) —`REMINDER_BUSINESS_HOURS_BEFORE` y `REMINDER_CRON_MINUTES`—. Cada cita recibe uno solo (`Appointment.reminderSentAt`).
- **Interruptores** (Configuración): recordatorios automáticos encendidos o apagados; «solo a pacientes que agendaron ellos mismos» (excluye las citas del panel y del hospital); anticipación mínima (por defecto 1 hora: si a la cita le falta menos, no sale). Apagado no marca las citas: al encender, las que sigan en plazo reciben el suyo.
- **Canal**: sale por el canal donde el paciente agendó; si Telegram falla, cae a WhatsApp. Fuera de las 24 horas desde el último mensaje del paciente, WhatsApp exige la plantilla «Recordatorio de cita».
- **Quién no lo recibe**: citas fuera del alcance (§3.11), pacientes que pidieron no recibirlos, pacientes sin teléfono ni canal, y teléfonos marcados como de otra persona mientras el caso esté abierto en la Bandeja.
- **Agendada por el chat poco antes** (2026-10-27, `confirmadaPorElChatDentroDeLaVentana` en `appointment-reminder.cron.ts`): una cita de origen WhatsApp o Telegram cuya hora caía, al crearse, dentro de la ventana del recordatorio más `HORAS_ENTRE_CONFIRMACION_Y_RECORDATORIO` (12 horas hábiles; con la ventana de 24, 36 horas hábiles) no recibe el automático: la confirmación del chat hizo de recordatorio. Con solo la ventana (27 de octubre), las agendadas con 24 a 26 horas lo recibían entre 12 minutos y 2 horas después de la confirmación (siete el 27 y 28 de octubre). Antes las 17 citas del chat del 26 y 27 de octubre lo recibían entre 2 y 26 minutos después de la confirmación, una plantilla pagada que repetía lo mismo, y cada «gracias» del paciente se contestaba con otro «¡Gracias por confirmar!». No se marca `reminderSentAt` (como la anticipación mínima) y el lote lo cuenta aparte (`yaConfirmadas`). Las del panel y las del hospital no se afectan.
- **Manual**: el botón «Recordar» de Visión General funciona aunque los automáticos estén apagados.

## 5. Conexión con el hospital (espejo)

Detalle de la arquitectura: `docs/PLAN_ESPEJO_HOSPITAL.md`. Detalle de cada hospital: `docs/drivers/<driver>/`.

### 5.1 Piezas

- **Motor genérico** en la API (`apps/api/src/mirror`): no conoce ningún HIS; solo eventos canónicos.
- **Agente del hospital** (`apps/mirror-agent`): programa Node instalado en un servidor del hospital, que se conecta hacia afuera a la API (el hospital no abre puertos), late cada pocos minutos, reporta si alcanza el HIS, lleva y trae eventos y recorre la agenda.
- **Driver**: el conocimiento de un HIS concreto (tablas, reglas, códigos), en `apps/mirror-agent/src/drivers/<driverKey>/`. Primer driver: `cnt-sanvicente-anserma` (SQL Server).
- **Configuración por clínica**: `HospitalMirrorConfig` (encendido, driver, token del agente guardado como hash, mapeo, modo de agenda, avisos).

### 5.2 De AgenIA al hospital

Cada cambio de una cita en AgenIA deja un evento en una cola transaccional (`SyncOutbox`, escrita por un disparador de la base). El agente la recoge, la aplica en el HIS y confirma; si falla, se reintenta hasta 10 veces y luego queda «rendido» (se puede devolver a la cola desde el Espejo). Solo viajan **altas, cancelaciones y cambios de cupo**; asistencia, EPS, cupos y médicos nunca se escriben en el hospital. Lo que nace en el hospital no se le devuelve (anti-eco).

**Qué revisa el agente antes de escribir una cita en el HIS:** que el médico tenga turno activo ese día (`TURNOS_MEDICOS`, `turnoDelDia`), que la cita no se cruce con otra del médico (`CITAS_MEDICAS`) y, por la llave del HIS, que la hora no esté ocupada. No revisa que la hora caiga dentro del turno ni en un hueco de la agenda del hospital: eso depende de que la agenda de AgenIA esté al día (§5.3). Un fallo que reintentar no arregla vuelve como **rechazo del HIS** (`rechazoDelHis`): la cita se anula en AgenIA con el motivo, el cupo se cierra, el evento se da por cerrado (auditoría `CONFLICT`) y el asistente se lo dice al paciente (§3.3); un cambio de fecha rechazado vuelve a la hora anterior. Desde el 29 de octubre «El médico … no tiene turno el AAAA-MM-DD» es rechazo definitivo: antes se reintentaba diez veces, quedaba rendido, la Bandeja avisaba como «no llegó al hospital» y el paciente no recibía respuesta. Como el agente del hospital se actualiza aparte, la API también lo reconoce por el texto del motivo (`apps/api/src/mirror/rechazo-del-his.ts`, `esRechazoPorAgendaDelHis`). Los demás fallos (conexión, tiempo de espera) se siguen reintentando.

**La hora de una cita en el hospital** (`FE_HORA_CIT`): el agente la escribe siempre como `AAAA/MM/DD HH:MM`, pero la lee con tolerancia: sin los ceros a la izquierda (`7:10` es `07:10`) o con segundos. Las fichas por orden de llegada (`2026/10/22 3`, en odontología, psicología o los programas) no tienen hora y no se leen como tal; tampoco las fechas con guiones, que la aplicación del hospital no encuentra. Al cancelar o cambiar la fecha, si la hora exacta no aparece, busca entre las citas vivas de ese médico ese día la que tiene la misma hora escrita distinto y la toma tal como está guardada (siempre del mismo paciente).

### 5.3 Del hospital a AgenIA

- **Citas**: una cita agendada en el hospital crea la cita en AgenIA y, si hace falta, el paciente (uno a uno, nunca se precarga el padrón del hospital), con EPS y régimen tomados del padrón cuando son seguros. Un documento que podría ser de dos pacientes no se crea: queda como excepción en la Bandeja. Si el teléfono ya es de otro paciente, no se asigna.
- **Agenda**: con el modo de agenda en ON, los cupos de los médicos homologados los crea el hospital (OFF: los crea la clínica; SHADOW: se comparan sin cambiar nada). El driver puede armar los cupos por turnos o por huecos libres del HIS.
- **Qué tan al día está AgenIA** (no es al instante; cada cosa tiene su vuelta en el agente, `apps/mirror-agent/src/config.ts`): las citas nuevas, canceladas o movidas en el hospital llegan cada 30 segundos (`MIRROR_INBOUND_INTERVAL_MS`); la agenda (huecos y turnos) se lee por vueltas —de fábrica cada 15 minutos para los próximos 14 días; en la clínica conectada hoy, cada 5 minutos para los próximos 7 días (medido el 29 de octubre: 12 a 13 vueltas por hora)— y una vez al día completa (400 días); el catálogo de médicos y servicios, y la reconciliación, una vez al día (hoy, hacia la 1:30 a. m.). Así, una hora o un día que el hospital quita deja de ofrecerse en la siguiente vuelta de agenda; un médico nuevo del HIS solo recibe cupos después de homologarlo (§5.5); y uno que el hospital deja sin turnos deja de tener cupos cuando desaparecen sus huecos. Entre una vuelta y otra el asistente puede ofrecer un cupo que el hospital ya quitó: si quitó el turno de ese día, el agente lo rechaza al escribirlo (§5.2) y el paciente recibe otros horarios; si solo movió las horas dentro del turno, el HIS puede aceptarlo.
- **Citas de AgenIA en horas que el hospital quitó**: la vuelta de agenda no las toca (no cancela ni mueve nada); deja en el registro «N cita(s) de AgenIA están en horas que el hospital ya NO tiene en su agenda. No se tocaron.» y un caso general en la Bandeja, sin el nombre de cada paciente. El personal debe revisar esas citas en el HIS y llamar al paciente. Si el hospital las cancela en el HIS, el paciente recibe el aviso de siempre (abajo).
- **Reconciliación diaria**: compara la foto completa de los dos sistemas, corrige servicios de cupos con cita y trae citas que falten. Las citas del hospital de otros servicios que no tienen cupo en AgenIA no cuentan como diferencia (AgenIA no las maneja): el informe las cuenta aparte, por médico. Solo es diferencia lo que el hospital no tiene, una cita de un servicio activo que falte (con su motivo: médico sin crear, por traer, sin documento o cancelada en AgenIA), un cupo de AgenIA a la venta a la hora de una cita del hospital (se cierra solo) o una cita sin servicio. El Espejo dice «Sin diferencias en las citas que maneja AgenIA» cuando no hay ninguna.
- **Médicos**: cada médico del HIS se homologa a mano con su perfil en AgenIA; sin homologar, no recibe cupos ni citas.
- **Cancelaciones y cambios de hora del hospital sobre citas del asistente** (2026-10-22): al aplicar una cancelación hecha en el HIS sobre una cita futura de origen WhatsApp o Telegram, AgenIA libera el cupo, avisa a la lista de espera y además (`apps/api/src/mirror/aviso-cambio-hospital.service.ts`) le escribe al paciente y abre un caso en la Bandeja (`CITA_CANCELADA_POR_HOSPITAL` o `CITA_MOVIDA_POR_HOSPITAL`, clave `CAMBIO_HOSPITAL:<cita>`; la fila es el candado: solo quien la crea avisa). Es un cambio de hora si ya existe una cita del hospital (MIRROR) para el mismo paciente, futura, creada en los últimos 10 minutos: el hospital no mueve una cita, la cancela y crea otra con la misma `FE_ELAB_CIT`, y el alta llega antes o junto con la cancelación. El aviso sale por el canal de la cita: texto dentro de las 24 horas de WhatsApp o por Telegram (la ventana se revisa en todos los identificadores conocidos —el destino de siempre, el teléfono y el BSUID de la ficha, y el número que agendó, que es el remitente de la confirmación en la bitácora— y el texto va al primero con la ventana abierta: quien agenda puede ser un familiar cuyo teléfono es de otra ficha); fuera de la ventana, un cambio de hora usa la plantilla «Confirmación de una cita del hospital» con la hora nueva y una cancelación, la plantilla «Cita cancelada por el hospital» (`HIS_APPOINTMENT_CANCELLED`, cinco variables: nombre, servicio, médico, fecha y hora, y «el hospital al <teléfono de soporte>»); sin la plantilla registrada no sale y el caso lo dice (`meta.plantilla`, motivo `SIN_PLANTILLA`); nunca a un número con el caso de teléfono equivocado abierto. El caso guarda en `meta` si se avisó, por dónde o por qué no, y la Bandeja muestra el estado de entrega del mensaje (libro de mensajes, tipo `SYSTEM_NOTICE`). El agente reporta como alta la hora nueva de una cita propia que el hospital cambió de hora (misma elaboración y mismo paciente que en otra hora de la foto anterior); antes la tomaba por su propio eco. **Traslados** (2026-10-29): la aplicación del hospital también «traslada» una cita a otro médico u otra hora con un UPDATE en sitio que conserva la marca de origen y reescribe `FE_ELAB_CIT`; el agente la tomaba por eco, AgenIA solo veía la cancelación y le decía al paciente que su cita se había cancelado (28-oct: cuatro citas pasaron a otro médico a la misma hora). Ahora una cita propia nueva cuenta como traslado si en la misma vuelta desapareció de otra clave una cita propia del mismo paciente (`esNuestraTrasladada`); un reagendamiento hecho por AgenIA deja la misma firma y el servidor lo descarta solo («el cupo ya estaba ocupado»). **Espera antes de avisar una cancelación** (2026-10-29, `ESPERA_AVISO_CANCELACION_MS`): sin cita nueva al cancelar, el caso nace con el aviso `EN_ESPERA` y `avisarDesdeIso` (10 minutos después, nunca a menos de una hora de la cita; con la cita a una hora o menos, se avisa ya: `momentoDelAviso`). Un barrido cada minuto (`AvisoCambioHospitalService.avisarLosPendientes`, reclamo compare-and-set sobre `EN_ESPERA`) vuelve a buscar una cita del hospital del mismo paciente creada desde 10 minutos antes de la cancelación: la misma (mismo médico y hora) → no se le escribe (`NO_HIZO_FALTA`, `MISMA_CITA`) y el caso se cierra solo; otra → el caso pasa a `CITA_MOVIDA_POR_HOSPITAL` y se le avisa la nueva; ninguna → el aviso de cancelación. Tampoco sale si el personal ya le escribió desde la Bandeja (`LE_ESCRIBIO_EL_PERSONAL`) o si la cita ya pasó (`YA_PASO`). Si al cancelar ya existe la misma cita creada otra vez, no se abre caso. El 28-oct a una paciente se le avisó «cancelada» a las 9:18 y el hospital le volvió a crear la misma cita a las 9:22. Las citas nacidas en el hospital o en el panel no avisan.

### 5.4 Interruptores y candado de la base

Con espejo, «Agendar», «Cancelar» y «Cambiar fecha» (Configuración) mandan en todo: encendidos, la operación se hace por el asistente y por el panel y llega al hospital; apagados, no se puede hacer en AgenIA y la base de datos la rechaza venga de donde venga (disparador `fn_interruptores_del_hospital`, error `AGENIA_OPERACION_APAGADA:<operación>`); también rechaza tocar citas cuya hora ya pasó (`CITA_PASADA`). El antiguo «envío al hospital» (`pushEnabled`) ya no decide nada. Lo que viene del hospital siempre entra. Regla pura en `packages/shared/src/compuerta-his.ts`; cada cambio de interruptor queda en la auditoría del espejo.

### 5.5 Vigilante y Bandeja de sincronización

Cada 2 minutos un vigilante busca citas confirmadas por AgenIA que no llegaron al hospital (más de 10 minutos en cola, o rendidas) y otros problemas, y los deja como excepciones en la Bandeja con gravedad según la cercanía de la cita (crítica a menos de 4 horas). Puede avisar al agendador por WhatsApp con la plantilla «Aviso al agendador» (sin datos del paciente), con hasta 2 recordatorios si nadie toma la excepción en 30 minutos. Las excepciones se cierran solas cuando el problema desaparece (un aviso de inasistencia, una cita para revisar o un pedido de cancelar sin confirmar, cuando la cita se cancela o cambia de hora; el aviso de inasistencia y el pedido de cancelar, también cuando la cita queda como asistida); las de citas pasadas hace más de 7 días vencen.

**Avisos de pedidos de pacientes** (2026-10-27). `CANCELACION_SIN_CONFIRMAR` y `AVISO_INASISTENCIA` (`TIPOS_CON_AVISO_PACIENTE`) también se le avisan al agendador, al mismo número y con las mismas reglas (una vez por gravedad, recordatorios, compare-and-set), pero solo con la cita a `urgenciaAltaHoras` (24) o menos y con su propia plantilla, `PATIENT_REQUEST_ALERT` («Aviso al agendador (pedidos de pacientes)»: cuántos casos, la cita más próxima y qué pidió, sin datos del paciente; `parametrosPlantillaAvisoPaciente`), porque el texto aprobado de `SYNC_EXCEPTION_ALERT` dice que las citas no llegaron al hospital. `MirrorAlertService.avisarPedidosDePacientes` corre en cada vuelta después del otro aviso, y si no sale avisa al grupo técnico con su propia clave (`espejo:aviso-pedidos-pacientes:<org>`). Como estos casos no se re-encuentran en cada vuelta, el vigilante les sube la gravedad por cercanía (`MirrorExceptionsService.escalar`): así el aviso vuelve a salir a 4 horas. Y se cierran solos si `attendanceStatus` queda `ATTENDED` (la asistencia la reporta el hospital o el personal; la cita sigue `SCHEDULED`): el 26 de octubre un pedido de cancelar quedó abierto aunque la paciente asistió. Desde el 28 de octubre también con `NO_SHOW` («El paciente no asistió, como había avisado.» o «…; la cita ya pasó.»): dos casos del 23 y el 26 seguían abiertos días después de que el paciente no fue. «Revisar una cita agendada por el asistente» no se cierra por la asistencia. La Bandeja dice si este aviso sale (`EstadoAvisos.razonPacientes`). El 26 de octubre otro pedido de cancelar se abrió hora y media antes de la cita, nadie lo vio y el cupo se perdió.

**Escribirle al paciente desde un caso** (2026-10-29). En los casos con cita y paciente (`ExcepcionVista.escribirAlPaciente`: quien puede trabajar la Bandeja, también con el caso cerrado), el botón «Escribir al paciente» abre un cuadro con tres textos sugeridos que se editan antes de enviar (`apps/api/src/chatbot/mensaje-al-paciente.ts`: cita cancelada con disculpas —con el que abre en una cita que no llegó al hospital, un conflicto o una cancelación del hospital—, la cita sigue en pie, o solo el saludo; en «usted», con el nombre, el servicio, la fecha, el médico y el teléfono de la clínica). El panel comprueba que el caso sea de la clínica y del alcance del agente (`cargarAlcanzable`) y toma la cita del caso, nunca del navegador (`apps/web/lib/bandeja/mensaje-paciente.ts`); la API (`GET /chatbot/outbound/cita/:id` y `POST /chatbot/outbound/cita`, solo por la red interna; `MensajeAlPacienteService`) elige el destino con la regla del aviso de cancelación del hospital (§5.3): el de siempre, los números que escribieron por esa cita (en la Caja Negra, con su `appointmentId`) y los de la ficha, el primero con la ventana de 24 horas abierta (`serviceWindowEndsAt`, que también dice hasta cuándo). Fuera de la ventana no envía (Meta lo rechazaría después de aceptarlo) y tampoco con un caso `TELEFONO_EQUIVOCADO` abierto; por Telegram siempre. El envío va como mensaje manual de la cita (`MANUAL` en el libro de mensajes), queda en la conversación del paciente (`InteractionLog` `OUTBOUND`, `tipo: MENSAJE_DEL_PERSONAL`), en el historial del caso (`MENSAJE_AL_PACIENTE`, «Por WhatsApp al •••9051», sin el texto) y en la Actividad de usuarios (`PATIENT_MESSAGE_SENT`, sin el texto). No cambia la cita ni el estado del caso. El botón «Contactar» de Agendamiento no revisa la ventana: escribe al teléfono de la ficha.

**Pedidos de cancelar sin el SÍ** (2026-10-26; regla en `apps/api/src/mirror/cancelar-sin-confirmar.ts`): en cada vuelta el vigilante lee en la Caja Negra (`InteractionLog`) de los últimos 3 días los números a los que el asistente les preguntó si cancelaba una cita (pasos `CANCELAR_OFRECIDO`, `CANCELAR_ELEGIR_CITA`, `CANCEL_SHOWING_SINGLE` y `CANCEL_APPOINTMENT_SELECTED`). Si el último ofrecimiento tiene más de una hora (`SESSION_TTL`: después el SÍ ya no cancela) y después no hubo un NO, una cancelación (o su espera del hospital), un cambio de fecha ni la confirmación de asistencia a esa cita, abre `CANCELACION_SIN_CONFIRMAR` por cada cita que siga vigente y no haya pasado (clave `cancelar-sin-confirmar:<cita>`, gravedad por la cercanía de la cita, con lo que escribió al pedirlo y hasta tres mensajes de después). Se le avisa al agendador por WhatsApp cuando a la cita le faltan 24 horas o menos (ver arriba). Un caso que alguien cerró, o que el sistema cerró porque la cita se canceló o se movió, no se vuelve a abrir; uno abierto se refresca y sube de gravedad. Un fallo de esta lectura no detiene el resto de la vuelta.

**Médicos nuevos del hospital** (`apps/api/src/mirror/medicos-nuevos.service.ts`, reglas en `packages/shared/src/medico-nuevo-his.ts`): antes de comparar, la reconciliación busca en la foto del agente los médicos sin homologar con citas próximas de un servicio activo. Cada uno abre `MEDICO_SIN_HOMOLOGAR` (clave `medico-sin-homologar:<código>`), con el botón «Crear y homologar» para el administrador (`POST /his-doctors/onboard`, fuera de `/mirror` para que el proxy no lo publique). Con `HospitalMirrorConfig.autoHomologateDoctors` (apagado de fábrica), los que cumplen todas las reglas los crea y homologa sola, con `autoHomologateWhatsappOn` para su WhatsApp, y deja `MEDICO_AGREGADO_AUTO`. Las reglas: sin bloqueos (cédula presente y única en el catálogo, sin otro médico de AgenIA con esa cédula ya homologado con otro código) para el botón; además sin advertencias (cargo de médico, servicio principal activo, activo en el hospital) para hacerlo sola. El alta es la de `homologar.ts`: correo de marcador, contraseña aleatoria que nadie conoce, servicio principal, `SET LOCAL agenia.sync_origin = 'MIRROR'` (el evento nace entregado y no vuelve al hospital) y `SyncAudit CONFIG DOCTOR_HOMOLOGATED`. Como va antes de la comparación, un médico agregado solo trae sus citas en esa misma vuelta; uno creado con el botón, en la siguiente.

### 5.6 Consultas en vivo al HIS

- **Desde el Rastreo** («Consultar el HIS ahora»): pregunta al hospital por un paciente o un cupo y recalcula el veredicto. Se enciende por clínica (`lookupEnabled`, sin pantalla) después de medir su costo en el hospital.
- **Desde el asistente** («¿qué citas tengo?» con citas que solo tiene el hospital): `botLookupMode` OFF / SHADOW / ON, sin pantalla.

### 5.7 Avisos masivos

Solo para las clínicas con el driver `cnt-sanvicente-anserma`: avisar por WhatsApp, paciente por paciente, a quienes tienen cita el día de un especialista (cancelación o recordatorio de antemano). La lista se trae del hospital o de una hoja de cálculo; no cancela nada en el hospital. Detalle: `docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md`.

## 6. Otras pantallas y páginas públicas

- **Agendamiento** (`/dashboard/agendamiento`, Agente de Reservas): agendar a mano para un paciente, con las mismas barreras de EPS y régimen que el asistente pero sin límite de citas. Respeta el alcance del agente (EPS o médico asignado). Agendar, cambiar la fecha o el médico (aviso), corregir la EPS o el nombre y escribirle al paciente desde aquí queda en la Actividad de usuarios con quién lo hizo y qué cita fue (del mensaje solo el canal y su largo, no el texto: la bitácora no se purga y las conversaciones sí).
- **Pacientes** (`/dashboard/pacientes`, solo administrador): listado de pacientes de la clínica; no está en el menú, pero existe (la Bandeja remite a ella para corregir teléfonos). Crear, editar o borrar una ficha lo puede hacer solo el administrador (desde el 2026-10-27 la acción también lo exige, como en Médicos, EPS y Agendas), con la regla de contraseña de Usuarios, y queda en la Actividad de usuarios qué campos cambiaron, sin copiar sus valores.
- **Mi Agenda / Mis Citas** (`/dashboard` para médico y paciente).
- **Páginas públicas** (sin sesión): `/solicitud-alta/<clínica>` (formulario de Solicitudes de Alta), `/solicitud-citas/<solicitud>` (pedir más citas que el límite), `/encuesta/<token>` (CSAT), `/estadisticas/<clínica>` (estadísticas para compartir, con clave), `/guia/whatsapp` y `/guia/google-ai-studio` (guías de conexión) y `/login`.
- **Estadísticas para compartir** (`/estadisticas/<id de la clínica>`, `apps/web/lib/estadisticas`): solo conteos, sin datos de pacientes. Se recalculan a las 6 a. m. de la clínica con el día anterior completo (antes de esa hora sigue el corte de ayer) y se guardan en memoria de la web hasta el corte siguiente; si la consulta falla, se reintenta en la próxima visita. Las cifras: recordatorios del `WhatsappMessageLog` (enviados, entregados o leídos, leídos), confirmaciones (`RECORDATORIO_CONFIRMADO`, cada cita una vez), consultas (`LOOKUP_*`), cancelaciones y cambios de fecha del asistente (con el cupo «retomado» si después del cancelado hay otra cita vigente en el mismo cupo, y la mediana de horas de anticipación), citas con origen WhatsApp o Telegram (fuera de horario, pacientes registrados al agendar, y con espejo, cuántas llegaron al hospital y en cuántos segundos), avisos de inasistencia de la Bandeja, mensajes entrantes de `ChannelActivityLog` (por hora y fuera de horario: antes de las 7 a. m., desde las 5 p. m., sábado y domingo) y asistencia de citas ya pasadas desde el día siguiente al primer recordatorio, de médicos con WhatsApp ON y servicios activos, con y sin recordatorio entregado. Las gráficas por día muestran los últimos 30 días. Sin clave guardada (o con la clínica suspendida) la página responde 404. Una clínica puede tenerla además en un subdominio propio: un bloque del Caddy del servidor que lleva la raíz a su página y solo deja pasar esa ruta y los archivos de `/_next/static`.
- **Módulos de la API sin pantalla en el panel**: historia clínica (`clinical-records`), IA clínica para médicos (`clinical-ai`) y exportación HL7 FHIR (`fhir/v4`).

## 7. Procesos automáticos

| Proceso | Dónde | Cada cuánto | Qué hace |
|---|---|---|---|
| Recordatorios automáticos | API | 15 min | §4. |
| Cierre por inactividad | API | 1 min | Cierra conversaciones sin respuesta y avisa al paciente. |
| Lista de espera | API | 5 min | Vence ofertas de cupo no confirmadas y ofrece al siguiente. |
| Confirmación del hospital pendiente | API | 10 s | Segundo mensaje al paciente cuando el HIS confirma o rechaza. |
| Seguimiento de consultas del bot al HIS | API | 5 s | Solo con `botLookupMode` distinto de OFF. |
| Vigilante del espejo | API | 2 min | §5.5. |
| Mantenimiento de consultas en vivo | API | 1 min | Vence y borra los datos de las consultas al HIS. |
| Retención de datos | API | 03:30 | Borra conversaciones de más de 180 días y la bitácora del rastreo de más de 365. |
| Purga de avisos masivos | API | diario | Borra los datos personales vencidos de los lotes. |
| Alertas técnicas | API | 1 min (03:15 limpieza) | §8. |
| Avisos de los casos de Soporte al grupo | API | 1 min (y al instante desde el asistente) | §8 y §15. |
| Avisos de sus casos a quien los reportó | API | 1 min (con el asistente encendido) | §15. |
| Monitor de servicios externos | API | 5 min | §8. |
| Agente del hospital | Servidor del hospital | cada vuelta (minutos) | Eventos en las dos direcciones, latido, barrido de agenda; reconciliación diaria. |
| Vigía del servidor | Servidor (cron del sistema) | 1 min | §8. |

## 8. Monitoreo y alertas técnicas

- **Monitor de Servicios** (`/super-admin/monitor`): cada 5 minutos comprueba los servicios externos (IA, voz, Meta, Telegram, el bot del asistente de soporte) y el espejo; abre y cierra incidentes. Un servicio que no aplica (sin configurar o apagado) no abre incidentes, y si tenía uno abierto, lo cierra. La IA y Meta se validan con las credenciales de una clínica testigo, no de todas. Hay además un modo en vivo desde el navegador. Detalle: `docs/MONITOR_SERVICIOS.md`.
- **Alertas técnicas** (`/super-admin/alertas`, solo super administrador): un bot de Telegram propio de la plataforma avisa a un grupo del equipo técnico cuando algo falla —servicio externo caído, espejo sin latido o sin alcanzar el HIS, tarea programada que revienta, recordatorios que no salen, errores 5xx, Redis caído, reinicios en bucle—: un mensaje por problema, recordatorios si sigue abierto, «resuelto» con su duración, silencio de noche para advertencias y resumen diario a las 7:00. Nunca lleva datos de pacientes. Operación: `docs/ALERTAS_TECNICAS.md`.
- **Alertas del asistente de soporte** (categoría «Asistente de soporte», que se puede apagar): su webhook caído o con mensajes del personal retenidos (lo detecta el monitor), la IA de una clínica que falla 3 veces en 15 minutos (se resuelve sola con la primera respuesta con IA), una clínica que llega a su tope diario de respuestas con IA (una vez al día) y 20 códigos equivocados en 10 minutos desde cualquier cuenta. El personal sigue recibiendo respuesta en todos los casos.
- **Casos de Soporte en el grupo** (categoría «Casos de soporte» de las alertas técnicas, que se puede apagar): cada caso nuevo, del panel o del asistente de Telegram, llega al mismo grupo con su número, prioridad, clínica, rol y correo de quien reporta, canal, el título sin cédulas, teléfonos ni correos y el enlace a la Mesa de Ayuda; nunca la descripción. Los de prioridad alta suenan siempre; los normales llegan sin sonido de noche. También avisa el caso reabierto y, una sola vez, el que lleva 2 horas del horario del equipo sin que nadie lo tome. Si el grupo no está conectado, la categoría está apagada o Telegram falla, el caso se abre igual y la Mesa de Ayuda dice por qué no se avisó; se reintenta hasta que pasen 24 horas sin poder avisar.
- **Vigía del servidor** (`deploy/vigia.sh`): desde el propio servidor y sin depender de la API, avisa al mismo grupo si un contenedor se cae o se reinicia, si el panel no responde, si el disco pasa del 80 % o el 90 % o si a las 04:30 no está el respaldo del día.
- **Canales en vivo** y **Caja Negra** son el monitoreo de negocio (Parte 1).
- **Regla**: ningún monitor, reporte o estadística consume IA; se calculan con datos de la base o con comprobaciones sin generación.

## 9. Datos, privacidad y seguridad

- **Aislamiento por clínica**: todo dato pertenece a una organización; los identificadores externos (cédula, BSUID, chat de Telegram, códigos del HIS) se indexan por clínica; no hay búsquedas entre clínicas. Ley 1581 de 2012 (Habeas Data).
- **Credenciales**: las claves de IA, el token de Meta y el de Telegram se guardan cifradas y nunca se vuelven a mostrar (solo sus últimos 4 caracteres). El token del agente del hospital se guarda como hash.
- **Rastreo de paciente**: cada búsqueda exige motivo y queda registrada (quién, cuándo, por qué); los datos se muestran enmascarados y descubrirlos deja registro.
- **Claves**: se guardan cifradas con bcrypt. Cada usuario cambia la suya en `/dashboard/cuenta` («Cambiar mi clave», al pie del menú): se exige la actual, la nueva debe tener al menos 10 caracteres (máximo 72 bytes, lo que lee bcrypt), letras y números, ser distinta de la actual y no contener el usuario. El cambio queda en la bitácora del sistema (`PASSWORD_CHANGED`) sin ningún dato de la clave; cada intento con la actual equivocada también (`PASSWORD_CHANGE_FAILED`, aviso) y tras 5 en 15 minutos se frena el cambio por 15 minutos, para que quien encuentre una sesión abierta ajena no pueda adivinarla. Cambiarla cierra las otras sesiones de la cuenta (a quien la cambió se le da un token nuevo). El administrador puede ponerle una clave nueva a cualquiera en Usuarios (también a médicos y pacientes en sus pantallas), y eso cierra las sesiones de esa cuenta. Desde el 2026-10-26 ninguna cuenta nace con una clave por defecto: el administrador de la clínica (Usuarios) y el super administrador (administradores de cada clínica) la escriben con la misma regla, y ninguna pantalla acepta las claves de fábrica que estuvieron en el código (`admin123`, `temporal123`, `password123`…; `apps/web/lib/cuenta/clave.ts`).
- **Ingreso al panel** (`/login`): cada ingreso queda en la bitácora del sistema (`USER_LOGIN`) con el usuario, su clínica, su rol, su correo, la IP (la primera de `x-forwarded-for`, que pone el proxy) y el navegador; cada intento fallido también (`LOGIN_FAILED`, aviso), con el correo intentado y el motivo (el correo no tiene cuenta, clave equivocada o clínica suspendida), nunca con la clave; y cada cierre de sesión (`USER_LOGOUT`). Tras 5 fallidos en 15 minutos con el mismo correo desde la misma IP, el ingreso se frena 15 minutos sin mirar la clave (`LOGIN_BLOCKED`, una sola constancia por ventana para que quien insiste no llene la bitácora); se cuenta por correo e IP para que nadie pueda bloquear a propósito a otra persona. Los ingresos se registraban desde antes (sin IP ni navegador); los fallidos y los cierres, desde el 2026-10-26.
- **Sesiones** (2026-10-27): el token de sesión (JWT de 8 horas, con la hora de emisión `iat`) ya no basta con su firma. En cada petición la web (`getSession`, una lectura de la cuenta por petición) y la API (`RolesGuard`) comprueban en la base, con la misma regla (`packages/shared/src/sesion.ts`), que la cuenta siga existiendo con el mismo rol y la misma clínica, que la clínica esté activa y que no tenga un «cerrar sesiones» (`User.sessionsRevokedAt`, migración `20261027120000_cerrar_sesiones`) posterior al ingreso; si la base no responde, no hay sesión. Así, borrar una cuenta, cambiarle el rol o suspender su clínica saca a quien estaba adentro en la siguiente petición (antes seguía hasta 8 horas). Cierran sesiones: el super administrador desde Actividad de usuarios (una persona o toda una clínica, `SESSIONS_REVOKED`, aviso), una clave nueva puesta por otra persona, cambiar la propia clave (las otras sesiones) y `agenia superadmin restablecer`. Quien queda por fuera pasa por `/sesion-cerrada`, que borra la cookie y lleva al ingreso con el aviso «Su sesión se cerró» (sin esa ruta, un super administrador con la sesión cerrada quedaba rebotando entre `/super-admin` y `/dashboard`, porque el filtro de rutas solo mira la firma). Cerrar el navegador o «Cerrar sesión» siguen afectando solo a ese equipo.
- **Super administradores**: ya no se crea solo `superadmin@sanvicente.com` con la clave `admin123` cuando no hay ninguno (eso estaba en `apps/web/app/actions/auth.ts` y en la documentación de instalación). Se gestionan en el servidor con `agenia superadmin` (`apps/web/scripts/superadmin.mjs`, corre en el contenedor de la web): `listar` (cuántos hay, su último ingreso y si alguno entra con una clave de fábrica), `crear <correo>` y `restablecer <correo>` (generan una clave aleatoria de 24 caracteres, bcrypt de costo 12, y la muestran una sola vez en la terminal), `quitar <correo>` (nunca el último) y `revisar-claves` (cuentas del personal que entran con una clave de fábrica). Cada alta, clave nueva o retiro queda en la bitácora (`SUPER_ADMIN_CREATED`, `SUPER_ADMIN_PASSWORD_RESET`, `SUPER_ADMIN_REMOVED`), sin la clave.
- **Actividad de usuarios** (`/super-admin/actividad`, solo super administrador): la línea de tiempo de lo que hace cada persona de cada clínica, de lo más nuevo a lo más viejo, con filtros por clínica (o «Plataforma»: super administradores e intentos sin cuenta), usuario, tipo y fechas (días de Bogotá), y «Cargar más» por cursor (no repite ni salta eventos aunque entren nuevos). Arriba, los ingresos de los últimos 30 días: por clínica (personal, cuántos entraron, ingresos, fallidos, último ingreso) o, con una clínica elegida, por persona (último ingreso —«Nunca» si no hay registro—, ingresos y fallidos). No escribe nada: lee lo que cada módulo ya guarda (`apps/web/lib/actividad/fuentes.ts`): la bitácora del sistema (ingresos, intentos fallidos, cierres, cambios de clave, usuarios creados, modificados —con el antes y el después del rol y el correo, y si se le puso clave nueva— o eliminados, días sin citas, avisos masivos enviados, cambios de las clínicas por el super administrador y, desde el 2026-10-27, la asistencia marcada —antes y después—, quién pidió un recordatorio manual y si salió, las citas agendadas, movidas o corregidas desde Agendamiento y los mensajes manuales al paciente, los cupos abiertos, copiados o borrados, y los médicos, fichas de pacientes, servicios y EPS creados, cambiados —qué cambió; de los datos personales solo que cambiaron—, activados, inactivados o eliminados; y también desde el 2026-10-27: los recordatorios automáticos —encendidos, a quién y con qué anticipación—, los interruptores del asistente en clínicas sin espejo, el nombre, el estilo y los cupos del asistente, la base de conocimiento —cuánto texto quedó—, el límite de citas por paciente, la IA, WhatsApp, la voz, Telegram y las plantillas de WhatsApp —qué cambió y si se puso una llave o un token nuevo, nunca la llave ni el token—, la configuración y el envío de los avisos masivos y la lista pedida al hospital, emparejar o desemparejar un médico con el del hospital, vaciar el padrón de una EPS, las solicitudes de alta revisadas, la historia clínica —abrirla, escribirla, corregirla, firmarla o agregarle una nota, con la cita y el paciente enmascarado, nunca su contenido; la firma guarda ahora la IP real de quien firma en vez de «Vía Web»—, cerrar sesiones, las descargas con datos de pacientes (sin celular de un lote de avisos, filas con error del padrón) y, del super administrador, la facturación, los tickets atendidos y la limpieza de incidentes del monitor), el rastreo de paciente (`PatientLookupLog`), la Bandeja (`SyncExceptionLog`, solo acciones de personas), los cambios de configuración con espejo (`SyncAudit` `CONFIG` y el reproceso manual; ahí el autor va dentro del texto y la pantalla lo reconoce por su correo si la cuenta es de esa clínica; activar o inactivar un servicio con espejo queda solo ahí, sin espejo en la bitácora del sistema), las cargas del padrón, los lotes de avisos masivos, las solicitudes de más citas revisadas, «Marcar como contactado» de la Caja Negra, los tickets de soporte y lo que se les agregó, los documentos excluidos del espejo, las citas anuladas desde la Visión General (`metaLog` de la cita) y la bitácora legal de la plataforma (`GlobalAuditLog`). Documentos y teléfonos salen enmascarados (últimos 4 dígitos); las citas se nombran por servicio, médico y hora. Las anotaciones que necesitan consultas para describirse (nombres del médico o del servicio) se arman después de la acción y, si fallan, la acción no se da por fallida (`registrarDespues`). Si una de esas fuentes falla, la página sale con las demás y lo dice. **Pantallas abiertas**: cada pantalla del panel que abre una persona queda anotada (`SCREEN_VIEWED`, con el nombre del menú y la ruta sin la consulta, que podría llevar una cédula) una vez cada 30 minutos por pantalla, desde los layouts del panel y del super administrador (`RegistroDePantallas` → `registrarPantalla`); como son muchas, la línea de tiempo las oculta salvo con la casilla «Incluir las pantallas que abrió cada persona» o la categoría «Pantallas abiertas». En la tabla de personas de una clínica se ve cuándo se le cerraron las sesiones por última vez y el botón «Cerrar sesiones»; arriba, «Cerrar las sesiones de toda la clínica». Los cambios de la auditoría del espejo que solo decían «desde el panel» o el rol (modo de agenda, reproceso, avisos al agendador) ahora llevan el correo de quien los hizo. El registro del recordatorio manual que deja la API (`REMINDER_MANUAL_SENT`, sin persona) sigue en Auditoría y Logs, pero ya no en esta línea de tiempo: allí sale el de la web, con quién lo pidió. Índices nuevos en `SystemLog` por clínica y por usuario (migración `20261026180000_actividad_de_usuarios`).
- **Mensajes del asistente**: el detalle de una cita solo se da al remitente que corresponde al paciente; cancelar o cambiar exige que la ficha sea del remitente. Con el caso «El teléfono de un paciente es de otra persona» abierto en la Bandeja, ese número deja de contar como del paciente para todo eso (confirmar, consultar, cancelar y cambiar), y se vuelve a revisar justo antes de cancelar o mover la cita en el hospital. Por Telegram no aplica: ese chat lo vincula el propio paciente.
- **Avisos y alertas**: los avisos al agendador y las alertas técnicas no llevan datos de pacientes.
- **Conversaciones del asistente de soporte**: solo el super administrador las lee, completas, en `/super-admin/soporte-bot/conversaciones`; abrir una deja un registro en la bitácora del sistema (`SUPPORT_BOT_CONVERSATION_VIEWED`, con quién y cuál). La lista de lo que el manual no cubrió va con cédulas, teléfonos y correos ocultos.
- **Retención**: conversaciones 180 días (también las del asistente de soporte con el personal), bitácora del rastreo 365 días, actividad de canales 400 días (seudonimizada), incidentes del monitor 365 días; los códigos del asistente de soporte se borran un día después de vencer.
- **Webhooks**: Meta con firma (`META_REQUIRE_SIGNATURE`) y Telegram con `secret_token`.
- **Estadísticas para compartir**: la clave se guarda con bcrypt (`OrganizationSettings.publicStatsKeyHash`) y nunca se vuelve a mostrar; ponerla, cambiarla o quitarla queda en la auditoría del espejo (`PUBLIC_STATS_KEY_CHANGE`, sin la clave). Quien la escribe bien recibe una cookie `estadisticas_acceso` de 30 días, solo para la ruta de esa clínica, firmada con una llave derivada de `JWT_SECRET` (no es un JWT: no sirve como sesión del panel) y atada al hash de la clave: cambiarla o cerrar la página saca a todos. Cada clave equivocada queda en la bitácora del sistema (`PUBLIC_STATS_LOGIN_FAILED`, con la IP) y tras 5 en 15 minutos desde una IP, o 30 para la clínica, se deja de comprobar por 15 minutos. La página lleva `noindex`.

## 10. Arquitectura técnica

| Pieza | Tecnología | Papel |
|---|---|---|
| `apps/api` | NestJS | Asistente, webhooks de WhatsApp y Telegram, procesos programados, motor del espejo, API REST. |
| `apps/web` | Next.js 16 (App Router), React 19, Tailwind | Panel y páginas públicas; lee la base con Prisma y llama a la API. |
| `apps/mirror-agent` | Node | Agente del hospital con sus drivers. |
| `packages/database` | Prisma, PostgreSQL 15 | Esquema, migraciones y SQL propio (`non-prisma-ddl.sql`: disparadores del outbox y de los interruptores). |
| `packages/shared` | TypeScript | Reglas puras compartidas: fechas, límites, compuertas del HIS, identidad, consulta de citas… |
| Redis | — | Sesiones del asistente, colas y pendientes. |
| Producción | Docker Compose detrás de Caddy, en un VPS | Contenedores `postgres`, `redis`, `api`, `web` y `migrator`; el Caddy publica solo una lista blanca de rutas. |
| `landing/` | HTML, CSS y JS estáticos, sin compilación ni dependencias | Sitio público `agenia.co`, aparte del producto (no comparte código ni base). «Ingresar» lleva al login del panel. Lo sirve el mismo Caddy del VPS desde la subcarpeta `landing/` de su volumen de datos (sin contenedor ni red nuevos; se publica con `landing/deploy/desplegar.sh`, no con `update.sh`). Su «pulso de la salud» (titulares de salud de Colombia de Google News e indicadores del Banco Mundial) lo arma `landing/scripts/actualizar-pulso.mjs`, que el cron del servidor corre a las 6 a. m.; si una fuente cae, se conserva lo último bueno. Ver `landing/README.md`. |

- **Despliegue**: `update.sh` / `deploy/update-vps.sh` (rsync al servidor, recrea contenedores con ventana de mantenimiento) o GitHub Actions (`deploy.yml`, que exige el CI). Instalación: `docs/INSTALACION_VPS.md`.
- **CI** (`.github/workflows/ci.yml`): tipos de los cinco paquetes, pruebas de api, agente y shared con cobertura, la regla de fechas, la coherencia de este archivo y las pruebas del centro de ayuda.
- **Fechas**: nunca `.toLocale*` sin `timeZone`; se usan los ayudantes de `@agenia/shared` (`CLAUDE.md`).

## 11. Configuración por clínica

| Ajuste | Dónde | Por defecto |
|---|---|---|
| Nombre del asistente | Configuración › Asistente Virtual | «AgenIA» |
| Tono | Configuración › Asistente Virtual | Formal (usted) |
| Horarios que ofrece | Configuración › Asistente Virtual | 6 (de 2 a 12) |
| Agendar / Cancelar / Cambiar fecha por el asistente | Configuración › Asistente Virtual | Encendidos |
| Plazo máximo para agendar (días adelante, contando hoy) | Configuración › Asistente Virtual | Sin límite (de 1 a 365 días) |
| Recordatorios automáticos | Configuración › Asistente Virtual | Encendidos |
| Solo a quien agendó por el chat | Configuración › Asistente Virtual | Apagado |
| Anticipación mínima del recordatorio | Configuración › Asistente Virtual | 1 hora (0 = sin mínimo, máximo 12 horas) |
| Reintentos por paso | Base de datos (sin pantalla) | 3 |
| Límite de citas por día / por mes | Límite de citas | 1 / 3, encendidos |
| Proveedor de IA y modelo (también lo usa el asistente de soporte del personal) | Configuración › Integraciones | — |
| WhatsApp, plantillas y Telegram | Configuración › Integraciones | — |
| Voz | Configuración › Asistente Virtual › Voz | Google Cloud TTS |
| Base de conocimiento de la clínica | Configuración › Base de Conocimiento | Vacía |
| Teléfono de soporte (al que el asistente remite) | Lo registra el equipo de AgenIA (sin pantalla) | Sin teléfono: el asistente dice «comuníquese con el hospital» |
| Zona horaria | Base de datos (sin pantalla) | `America/Bogota` |
| Espejo: modo de agenda | Espejo con el HIS | OFF |
| Espejo: avisos al agendador | Bandeja › Configurar avisos | Encendidos (requieren celular y plantilla; los de pedidos de pacientes, su propia plantilla) |
| Agregar solos los médicos nuevos del hospital / con WhatsApp ON | Configuración › Asistente Virtual (solo con espejo) | Apagados |
| Espejo: consulta en vivo / desde el asistente | Base de datos (sin pantalla) | Apagadas |
| Estadísticas para compartir (clave de la página pública) | Configuración › Estadísticas | Cerrada (sin clave) |

## 12. Clínicas en producción

- **Hospital San Vicente de Paúl de Anserma** (driver `cnt-sanvicente-anserma`, HIS de CNT sobre SQL Server, base de producción `ESEHSVP`). AgenIA trabaja solo con medicina general (servicio `S39141`) y con los médicos de ese servicio en WhatsApp ON. Estado, pendientes y bitácora del hospital: `docs/drivers/cnt-sanvicente-anserma/ESTADO.md` y `RUNBOOK.md`. Sus estadísticas para compartir también se abren en `estadisticas.hsvpanserma.agenia.co` (bloque del Caddy en `docs/INSTALACION_VPS.md` §16).

## 13. Limitaciones conocidas y pendientes

- **Analíticas**: «Completadas» cuenta citas con estado `COMPLETED`, que el flujo normal no escribe (marcar «Asistió» cambia la asistencia), así que suele quedar en 0.
- **Agendas (Slots)**: no hay botón para borrar cupos.
- **Actividad de usuarios**: lo que solo se consulta se anota por pantalla (una vez cada 30 minutos), no cada búsqueda ni cada ficha que se mira, salvo el Rastreo de paciente y la historia clínica, que anotan cada consulta. Elegir los destinatarios de un lote de avisos y su nota adicional no se anotan uno por uno (sí el lote y su envío). El administrador de la clínica no tiene un botón de «Cerrar sesiones»: lo logra poniéndole una clave nueva a la persona.
- **Consulta en vivo al HIS** y **consulta del asistente al HIS**: construidas y apagadas hasta medir su costo en el hospital.
- **Centro de ayuda**: solo lo ve el administrador.
- **Alertas técnicas**: en producción en el hospital (bot conectado, grupo vinculado y encendidas; revisado el 2026-10-20).
- **Asistente de soporte por Telegram** (para el personal de las clínicas, §15): desplegado en el hospital el 2026-10-20 (`SUPPORT_BOT_ENABLED`, la ruta del webhook en el proxy y el examen con su IA aprobado: 59 de 62, sin violaciones). Todavía no conversa con nadie: falta crear y conectar su bot de Telegram, elegir las personas del piloto y encenderlo (`docs/ASISTENTE_SOPORTE.md`, pasos 7 a 10). Pendiente: «Avísame cuando se resuelva» para las fallas generales.

## 14. Documentación detallada

| Archivo | Tema |
|---|---|
| `docs/PLAN_ESPEJO_HOSPITAL.md` | Arquitectura genérica del espejo y del patrón de drivers. |
| `docs/PLAN_RASTREO_PACIENTE.md` | Rastreo de paciente, vigilante y Bandeja de sincronización. |
| `docs/PLAN_ALTA_EN_CALIENTE.md` | Citas del hospital que crean cita y paciente en AgenIA. |
| `docs/PLAN_CONSULTA_CITAS.md` | «¿Qué citas tengo?» en el asistente. |
| `docs/PLAN_TELEGRAM.md` · `docs/ENCENDIDO_TELEGRAM.md` | Canal de Telegram. |
| `docs/PLAN_AGENDA_HUECOS.md` | Agenda armada con los huecos del HIS. |
| `docs/PLAN_RESUMEN_ATENCION.md` | Propuesta (sin construir): resumen de la atención al paciente por WhatsApp y correo cuando el médico termina la historia clínica en el HIS; Fase 0 con las consultas de solo lectura del driver. |
| `docs/PLAN_ALERTAS_TECNICAS.md` · `docs/ALERTAS_TECNICAS.md` | Alertas técnicas por Telegram y vigía del servidor. |
| `docs/PLAN_BOT_SOPORTE.md` · `docs/ASISTENTE_SOPORTE.md` | Asistente de soporte por Telegram para el personal de las clínicas: el plan y su operación (paso a producción, piloto, apagarlo). |
| `docs/MONITOR_SERVICIOS.md` | Monitor de servicios externos. |
| `docs/GUARDRAIL_EMERGENCIAS.md` | Barandas de emergencias médicas. |
| `docs/PLAN_PRUEBAS_CITAS.md` | Plan de pruebas del ciclo de vida de una cita. |
| `docs/INSTALACION_VPS.md` | Instalación en un servidor. |
| `landing/README.md` | Sitio público `agenia.co`: secciones, pulso de la salud en vivo, cómo verlo en local y cómo publicarlo. |
| `docs/drivers/cnt-sanvicente-anserma/` | Todo lo del primer hospital: mapeo del HIS, estado, runbook, conectividad, avisos masivos, SQL. |

## 15. Asistente de soporte para el personal

Un bot de Telegram propio de la plataforma —distinto del de las alertas técnicas y de los de las clínicas; la API lo valida en las tres direcciones— que atiende al personal de las clínicas: administrador, agente de reservas, médico y observador general. El paciente no lo usa. El super administrador lo usa en modo prueba, como una clínica que elige, y sus casos se simulan.

- **El código en cada conversación**: cualquiera le puede escribir, pero sin una conversación verificada el bot solo pide el código, sin usar IA y sin dar información. El código se genera en Soporte («Generar código»): son 6 dígitos para escribir o un QR que abre el bot con un código largo. Sirve una sola vez, vence a los 10 minutos y generar otro anula el anterior. En la base solo queda su HMAC. Después de 5 intentos fallidos desde una cuenta de Telegram, esa cuenta espera una hora.
- **La conversación**: queda atada al usuario de AgenIA y a la cuenta de Telegram que dio el código. A lo sumo hay una abierta por usuario y por cuenta (índices parciales en la base). Se cierra a los 30 minutos sin mensajes (ajustable), con /salir, desde el panel o al abrir otra. Cada mensaje revalida usuario, rol y clínica. Si alguien escribe una pregunta antes del código, el bot la guarda 10 minutos y la responde apenas recibe el código.
- **Cómo responde (fase 2)**: con la IA de la clínica de quien pregunta (si falla y `LLM_FAILOVER_ENABLED=true`, otra que la clínica tenga configurada). Le da a la IA este archivo —la Parte 1 y las secciones de la Parte 2 que permite `PARTE2_PARA_EL_ASISTENTE`—, el rol y el menú de quien pregunta, la ficha de configuración de su clínica (canales, IA, interruptores, recordatorios, límites, teléfono de soporte, espejo; nunca datos de pacientes) y los últimos turnos, con cédulas, teléfonos y correos ocultos. La IA responde en JSON y el código decide lo demás: descarta los temas que no existen, ofrece abrir un caso con lo que el manual no cubre, pone el enlace al Centro de ayuda solo para el administrador y los botones «Me sirvió» / «No, abrir un caso». Los mensajes que llegan con menos de 2 s de diferencia se responden juntos. Si la clínica no tiene IA, falla, tarda más de 25 s, responde algo ilegible o pasa el tope diario de respuestas con IA, contesta lo más parecido del manual con el buscador del Centro de ayuda. Cada respuesta guarda su tipo, los temas, los tokens y si quedó sin cubrir.
- **Los casos (fase 3)**: la IA reconoce una falla y propone el borrador (título, detalle, pantalla y lo que falta, como mucho dos preguntas); el código lo guarda en la conversación (`SupportBotConversation.flowState`), se lo muestra al empleado con los botones «Sí, ábrelo» / «Corregir algo» / «No, gracias» y solo lo abre con un «sí», por botón o escrito («sí», «dale», «👍»; «no puedo agendar» no cuenta como «no»). La prioridad alta la propone la IA y la confirma una señal fija en lo que escribió el empleado (nadie puede agendar, el bot no responde, no salen los recordatorios, las citas no llegan al hospital, el sistema no carga); una corrección no la baja. El caso queda con número (#58), canal `TELEGRAM`, prioridad, la conversación de origen, y la clínica y el autor de la sesión verificada, nunca de la IA. Su descripción lleva el resumen y lo que la persona escribió tal cual (la IA lo vio con los datos ocultos; el equipo los necesita). Sin IA, el borrador se arma con lo que escribió (el título es la primera frase, sin el punto final). Un borrador sin confirmar al cerrar la conversación se ofrece en la siguiente durante 24 h. `/casos` lista sus casos sin IA (abiertos y los solucionados de los últimos 30 días); la IA los recibe para «¿cómo va mi caso?» y, si le cuentan algo de uno abierto, el código pregunta antes de agregarlo como nota (`SupportTicketNote`, tipo `AMPLIACION`), solo a casos de esa persona. La IA también recibe las alertas técnicas abiertas que afectan a la clínica, traducidas a frases fijas (WhatsApp, Telegram, la voz, el espejo, el servidor de sesiones, Gemini si es su IA, recordatorios y aviso al agendador), para decir que el equipo ya lo está atendiendo. En modo prueba los casos y las notas se simulan. En la Mesa de Ayuda los casos muestran número, «Por Telegram», «Prioridad alta» (primero en la lista) y las notas, y se buscan por número.
- **Los avisos (fase 4)**: el aviso al grupo de cada caso está en §8 (`SupportTicketGroupNotifier`, en el módulo de alertas técnicas: funciona aunque el asistente esté apagado). A quien reportó, cada minuto, se le avisa por Telegram cuando su caso pasa a «en atención» y a «solucionado» (`SupportTicket.reporterNotifiedStatus` guarda el último estado avisado; los cambios de más de 24 h no se avisan). Va a la cuenta de su última conversación (no las de prueba), también para los casos del panel; no sale si apagó los avisos en la tarjeta, si nunca conversó o si ya no tiene acceso. Sin su conversación abierta, el «resuelto» no trae la respuesta del equipo, y «Ver la respuesta» o «No, sigue pasando» se guardan 10 minutos en Redis y se hacen apenas valide el código; «Sí, gracias» no pide nada. «No, sigue pasando» reabre un caso suyo resuelto hace menos de 7 días: vuelve a abierto con una nota `REAPERTURA`, suma `reopenedCount`, el grupo recibe «🔁 Caso reabierto» y lo siguiente que escriba se ofrece como nota del caso, sin IA. Dos réplicas no duplican avisos: cada uno se reclama con un compare-and-set. La Mesa de Ayuda muestra si el grupo se enteró (y si se le recordó), por qué no, «Reabierto» y la respuesta anterior.
- **El panel y la vigilancia (fase 5)**: en `/super-admin/soporte-bot`, debajo de la configuración, «Cómo va» con los últimos 7 o 30 días, sin IA y sin las conversaciones de prueba: conversaciones, personas y clínicas; respuestas con IA y sin IA; cuántas se resolvieron sin abrir un caso; casos abiertos; «Me sirvió» / «No, abrir un caso»; el tiempo de respuesta con IA (promedio y el de 9 de cada 10); las respuestas que el manual no cubrió; y una tabla por clínica con sus tokens. Lo que pasa antes de la conversación (códigos pedidos, los que nadie escribió, equivocados, cuentas bloqueadas y mensajes sin código) no queda en la base —los códigos se borran a un día de vencer—, así que se cuenta en Redis por día (`soporte:cifras:<día>`, 40 días). Debajo, «Lo que el manual no cubrió»: las últimas 100 preguntas que respondió con «Eso no lo tengo en el manual», con los datos ocultos, para completar este archivo. Las conversaciones se leen en `/super-admin/soporte-bot/conversaciones` (filtros por periodo, clínica, las que terminaron en caso, las que el manual no cubrió y las de «No, abrir un caso», de a 50), y cada una muestra sus mensajes con la fuente, los temas, el proveedor, el tiempo y los tokens, y sus casos; la Mesa de Ayuda enlaza la de cada caso abierto por Telegram. La vigilancia: el monitor de servicios suma el bot del asistente (`getWebhookInfo`) y las alertas técnicas, la categoría «Asistente de soporte» (§8).
- **El piloto y la producción (fase 6)**: mientras el piloto está encendido —y así nace, también en una instalación que ya tuviera el asistente—, solo las personas de su lista (`SupportBotConfig.pilotUserIds`, hasta 20, se arma con sus correos y solo acepta personal de una clínica activa) ven la tarjeta de Soporte, generan el código y conversan. A quien sale del piloto se le cierra la conversación con el siguiente mensaje, y su código ya pedido no abre nada. «Abrir a todo el personal» apaga el piloto y «Volver al piloto» lo enciende otra vez; los dos quedan en la auditoría global. El examen del asistente (60 preguntas por rol) se corre en el servidor con la IA ya configurada de una clínica, sin copiar la clave: `EXAMEN_CLINICA=<id de la clínica> node apps/api/dist/support-bot/examen/examen.cli.js` dentro del contenedor de la API (gasta tokens de esa clínica; en el equipo de desarrollo, `pnpm --filter api examen:soporte` con una clave). El paso a producción (respaldo, `SUPPORT_BOT_ENABLED`, despliegue, la ruta del Caddy, el examen, el bot en @BotFather, el piloto) y cómo revisar el piloto cada día están en `docs/ASISTENTE_SOPORTE.md`.
- **Qué falta**: «Avísame cuando se resuelva» para una falla general que el equipo ya atiende, en `docs/PLAN_BOT_SOPORTE.md`.
- **Configuración** (`/super-admin/soporte-bot`, solo super administrador): token del bot y su webhook (`/api/support-bot/webhook/<ruta>`, con `secret_token`), encendido, el piloto, horario del equipo (por defecto de lunes a viernes de 8:00 a 17:00), minutos de la conversación, límites (40 mensajes por hora, 2.000 caracteres por mensaje, tope diario de respuestas con IA por clínica) y un código de prueba. Cada cambio queda en la auditoría global. Sin `SUPPORT_BOT_ENABLED=true` en la API no existe ninguna de sus rutas y la tarjeta de Soporte no aparece.
- **Datos**: los mensajes de las conversaciones verificadas se guardan 180 días (`SupportBotMessage`); lo que se escribe antes del código no se guarda en la base. Los casos y sus notas no se borran con la conversación: quedan en Soporte.

---

# Parte 3 · Bitácora de cambios

Una línea por ajuste o mejora, la más reciente arriba: fecha, qué cambió para quien usa el sistema y el commit si lo hay.

- **2026-10-29** — Cuando el hospital cambia una cita del asistente, el paciente ya no recibe un «su cita fue cancelada» equivocado. **Traslados:** si el hospital pasa la cita a otro médico u otra hora (lo hace cambiando la cita en su sistema, no anulándola), AgenIA ahora lo reconoce, trae la cita nueva y le avisa al paciente el médico y la hora nuevos; antes solo veía la anulación (el 28 de octubre cuatro pacientes del Dr. Cárdenas, pasados a la Dra. Ríos a la misma hora, recibieron «cancelada»). Requiere el agente nuevo en el hospital. **Anulada y vuelta a crear:** el aviso de una cancelación espera unos 10 minutos (si la cita es en más de una hora); si en ese tiempo el hospital le vuelve a crear la misma cita, no se le escribe nada y el caso se cierra solo, y si le da otra, se le avisa la nueva (a una paciente le avisamos «cancelada» a las 9:18 y el hospital se la volvió a crear igual a las 9:22). La Bandeja dice a qué hora saldrá el aviso, y si el personal le escribe antes con «Escribir al paciente», el automático no sale.
- **2026-10-29** — Bandeja de sincronización: botón «Escribir al paciente» en los casos con cita. Abre un mensaje sugerido —cita cancelada con disculpas, la cita sigue en pie u otro— con el nombre, el servicio, la fecha y el médico, que se corrige antes de enviar. Dice por dónde va y hasta qué hora se le puede escribir: por WhatsApp solo si el paciente, o quien agendó por él desde otro celular, escribió en las últimas 24 horas (si no, pide llamarlo), y nunca a un teléfono marcado como de otra persona. Queda en el historial del caso, en la conversación del paciente y en la Actividad de usuarios.
- **2026-10-29** — Dos arreglos del diagnóstico del jueves. **El hospital ajustó su agenda:** cuando el hospital no acepta una cita porque el médico ya no tiene turno ese día, AgenIA lo toma como rechazo definitivo: la cita se anula, el cupo se cierra y el asistente le dice al paciente en el momento que el hospital acaba de ajustar su agenda y le muestra los horarios que quedan. Antes se reintentaba diez veces, quedaba como «no llegó al hospital» en la Bandeja y la paciente se quedó esperando una confirmación que nunca llegó. Funciona ya con el agente actual del hospital; el agente nuevo lo marca también desde su lado. **Un «no» con una hora:** «No quedaría bien para las 6:30» o «no me sirve a las 10» ya no reservan esa hora (le reservaba a la paciente justo las 6:30): el asistente muestra los horarios que siguen, al agendar y al cambiar la fecha. Y el Centro de ayuda explica qué tan al día está AgenIA cuando el hospital cambia su agenda.
- **2026-10-28** — Tres arreglos más del diagnóstico. **Cambiar la fecha:** el menú ya entiende «Ninguna», «otro día», un día o una hora, la letra dentro de una frase y el médico que nombra, y trae la opción «Otro día»; si no queda otro horario, le ofrece cancelar la cita para liberar el cupo (o, con cancelar apagado, deja su pedido en la Bandeja), en vez de «No reconozco esa opción». **Recordatorio:** la cita agendada por el chat no recibe el automático si le llegaría menos de 12 horas después de la confirmación (antes, agendada con 24 a 26 horas, le llegaba minutos después). **Bandeja:** los avisos de pacientes («pidió cancelar y no confirmó», «avisó que no irá») también se cierran solos cuando el hospital marca que no asistió. Y en el hospital, la agenda 078 (MEDICO ATENCION HTA 3) quedó homologada como «Programa de Hipertensión», igual que sus agendas hermanas, con WhatsApp apagado: el asistente no la ofrece.
- **2026-10-28** — Seis arreglos del diagnóstico del miércoles. **Fechas con hora:** «Jueves 7 50» o «Miércoles 3:30 pm» ya no se leen como el 7 o el 3 del mes siguiente (el arreglo del 27 los confundía); si el día de la semana no cuadra con el número, manda el día de la semana, y una fecha que pasó hace poco ya no se lee como del año que viene. **«Cancelar» tras el aviso de límite:** deja la solicitud en vez de ofrecer anular la cita que ya tiene (una madre perdió así las citas de sus dos hijos); el aviso dice de quién es la cédula y cómo agendar para otra persona, y la confirmación de cancelar dice de quién es la cita. **Horario apartado:** el que el paciente elige queda apartado 10 minutos dentro de AgenIA mientras se registra, y si ya no está al confirmar, el asistente le muestra en el mismo mensaje los que quedan (antes le pedía «la letra nuevamente» de un menú con otras letras ya tomadas). **Fecha de nacimiento:** entiende «19 01 1961», «1961 19 de enero» y parecidas, «Está correcto» confirma, y tras tres intentos la pide por partes (día, mes y año). **La hora pedida:** con «para las 3:30» muestra los horarios más cercanos a esa hora; entiende «9am», «3:00pm», «11;20», «dos y cuarenta», la letra dentro de una frase («Perdón es B») y el médico que nombra cuando dos horarios coinciden; «Muchas gracias» lo despide. **«Necesito otra cita»** es una cita nueva, no un cambio de la que tiene.
- **2026-10-27** — Cuatro arreglos del diagnóstico del martes. **Otro día u otra hora:** si ningún horario le sirve, el paciente puede elegir «Otro día» (la opción aparece al final del menú cuando hay cupos en días siguientes) o escribir lo que prefiere —«mañana», «el miércoles 28», «en la tarde», «más temprano», «otro horario», «no»— y el asistente le busca cupos de eso, sin repetir los que ya vio y dentro del plazo para agendar; antes contestaba «Esa letra no aparece entre las opciones» y el paciente se iba (de 34 que vieron cupos el lunes y el martes, 17 agendaron y al menos 5 habían pedido otro día). En la Caja Negra eso queda ahora como «No se entendió el horario», no como «Sesión expirada». **Recordatorio repetido:** la cita que el paciente se agenda por el chat cuando ya le falta menos de un día hábil no recibe el recordatorio automático (llegaba minutos después de la confirmación, con lo mismo y como plantilla pagada). **Bandeja:** cuando un paciente pidió cancelar y no confirmó, o avisó que no irá, y a su cita le faltan 24 horas o menos, se le avisa al agendador por WhatsApp (y otra vez a 4 horas), con la plantilla nueva «Aviso al agendador (pedidos de pacientes)», que hay que aprobar en Meta y registrar en Configuración; y esos casos se cierran solos si el paciente asiste. **Nombres:** frases como «Otro horario» o «en la tarde» ya no se aceptan como nombres o apellidos de un paciente nuevo.
- **2026-10-27** — Sitio público agenia.co: pasa del verde al azul de la marca (el del logo, de cian a azul), con contraste AA en textos y botones. El verde original sigue disponible para comparar con `?tema=verde`.
- **2026-10-26** — Sitio público agenia.co (carpeta `landing/`, aparte del producto): portada con las etapas de la cita (agendar por chat, recordatorios, cancelar y liberar cupos, conexión con el HIS), una conversación de ejemplo animada, las herramientas del panel, cuatro anillos de resultados y el «pulso de la salud en Colombia» en vivo: titulares de la semana por tema e indicadores de salud del país, que se actualizan solos cada mañana a las 6 a. m. «Ingresar» lleva al login del panel. Los resultados son del primer hospital y su publicación espera la autorización del hospital. Se presenta como ecosistema de atención al usuario («No es solo agendar»): destaca la lista de espera que avisa sola cuando se libera un cupo, que cambiar o cancelar por chat llega al sistema del hospital en 1,3 segundos en promedio (medido en 17 cancelaciones y 2 cambios de fecha) y el asistente de soporte que acompaña al personal.
- **2026-10-27** — Actividad de usuarios, el resto de las huellas, y sesiones que se pueden cerrar. **Sesiones:** el super administrador puede cerrar las sesiones de una persona o de toda una clínica desde Actividad de usuarios, y quien queda por fuera vuelve al ingreso con el aviso «Su sesión se cerró». Además, borrar una cuenta, cambiarle el rol o suspender su clínica ya la saca de inmediato (antes seguía adentro hasta 8 horas), una clave nueva puesta por el administrador cierra las sesiones de esa persona y cambiar la propia clave cierra las otras. **Huellas nuevas:** recordatorios e interruptores del asistente (también sin conexión al hospital), nombre y estilo del asistente, base de conocimiento, límite de citas, IA, WhatsApp, voz, Telegram y plantillas (sin guardar llaves ni tokens), avisos masivos (configuración, envío y lista pedida al hospital), emparejar médicos con el hospital, vaciar el padrón, solicitudes de alta revisadas, historia clínica (abrirla, escribirla, corregirla, firmarla —ahora con la IP real— y notas aclaratorias, sin su contenido), descargas con datos de pacientes, facturación, tickets atendidos y limpieza del monitor; y las pantallas que abre cada persona (una vez cada 30 minutos, ocultas salvo que se pidan). Los cambios del espejo dicen ahora quién los hizo.
- **2026-10-27** — Actividad de usuarios, más huellas: ahora queda quién marcó la asistencia de una cita (antes y después), quién pidió un recordatorio manual y si salió, quién agendó, movió o corrigió una cita desde Agendamiento o le escribió al paciente (sin guardar el texto), quién abrió, copió o borró cupos, y quién creó, cambió o eliminó médicos (incluido encender o apagar su WhatsApp), fichas de pacientes (qué campo cambió, sin copiar el dato), servicios y EPS. Los cambios de configuración del espejo ya muestran a la persona que los hizo. Y Médicos, Pacientes, EPS y Agendas ya solo los puede cambiar el administrador, como dicen sus pantallas (antes cualquier usuario de la clínica podía, por ejemplo cambiarle la clave a un médico y entrar como él), con contraseña segura al crear médicos y pacientes (antes, vacía, quedaba `temporal123`).
- **2026-10-26** — Actividad de usuarios y seguridad de las cuentas. **Super administrador:** pantalla nueva «Actividad de usuarios» con lo que hace cada persona de cada clínica en orden (ingresos, intentos fallidos, cuentas, pacientes consultados, Bandeja, padrón, avisos, configuración, citas anuladas…), los ingresos de los últimos 30 días por clínica y por persona, y «Cambiar mi clave» (antes no tenía cómo). **Ingreso:** cada ingreso, intento fallido y cierre de sesión queda con la IP y el navegador, y tras 5 claves equivocadas en 15 minutos se frena el ingreso 15 minutos. **Cuentas:** ya no se crea solo el super administrador `superadmin@sanvicente.com` con `admin123`; se crean en el servidor con `agenia superadmin crear <correo>`, que da una clave aleatoria. En Usuarios solo el administrador crea, edita o borra cuentas (antes cualquier sesión de la clínica podía, hasta crear un super administrador), la contraseña es obligatoria y segura (antes, vacía, era `temporal123`; la de un administrador creado por el super administrador, `admin123`), la opción «Administrador» ya funciona y se puede asignar el Observador general. Cada cambio de cuentas queda registrado.
- **2026-10-26** — Estadísticas para compartir: la página de cifras que se armaba a mano ahora vive en AgenIA y se actualiza sola cada día a las 6 a. m. con el día anterior completo (recordatorios enviados y leídos, gestiones por chat, citas agendadas y canceladas por chat, cupos que tomó otro paciente, mensajes fuera de horario y asistencia con y sin recordatorio), sin datos de pacientes. El administrador la abre con una clave sencilla en la pestaña nueva Configuración › Estadísticas, copia el enlace, cambia la clave (saca a quien había entrado) o la cierra; cada cambio queda en la auditoría. Nace cerrada. En el Hospital San Vicente también en estadisticas.hsvpanserma.agenia.co.
- **2026-10-26** — Lista de espera con la plantilla «Oferta de cupo»: cuando se libera un cupo y el primero de la lista no ha escrito en las últimas 24 horas, el asistente se lo ofrece con esa plantilla aprobada en Meta (de 7:00 a 19:00, hora de la clínica), y el paciente responde SÍ o NO como siempre. Hay que aprobarla en Meta y registrarla en Configuración › Integraciones › Plantillas de WhatsApp; mientras no esté, se le ofrece solo a quien escribió hace poco. Si el mensaje no sale, el paciente conserva su turno y el cupo pasa al siguiente (antes lo perdía sin enterarse).

- **2026-10-26** — Tres arreglos tras el diagnóstico del lunes. **Lista de espera:** en el hospital nunca le avisaba a nadie (los cupos son para cualquier EPS y la lista solo los cruzaba con quien no tenía EPS); ahora el cupo que se libera se le ofrece al primero de la cola que haya escrito en las últimas 24 horas (o use Telegram), sin escribirle a quien WhatsApp no dejaría y sin que pierda su lugar, y al reofrecerlo se usa la EPS del cupo. **Bandeja:** caso nuevo «Un paciente pidió cancelar y no confirmó», cuando el asistente le preguntó si cancelaba y pasó una hora sin respuesta (una paciente pidió cancelar el sábado, no respondió el SÍ y la cita siguió en pie sin que nadie se enterara). **Celular compartido:** si desde el número que recibió el recordatorio de una persona se agenda una cita para otra, el asistente ya no responde con la cita de la primera ni cuenta el «gracias» como su confirmación.

- **2026-10-23** — Padrón EPS: el archivo se sube tal como lo manda la EPS. El sistema encuentra solo la columna de la cédula del afiliado aunque cambie de nombre (el corte de Sura del 08-10-2026 se rechazaba entero por «falta la columna cedula» porque ahora la llama Numero_Identificacion), sin confundirla con la del cotizante, y dice qué columnas usó. Las filas corridas por un nombre o una dirección con un separador de más se reacomodan solas cuando no hay duda. Las filas que no se pueden leer ya no bloquean el archivo: quien carga puede aceptar ignorarlas e importar el resto, y quedan como RECHAZADO en el historial. Y el teléfono: antes se tomaba la primera columna de teléfono, y de Salud Total no entró ni un celular (entraban 2000000 y fijos de 7 dígitos); ahora se toma el primer celular de cualquier columna de teléfono, y el relleno que ya estaba guardado se borra al cargar el corte.
- **2026-10-24** — Médicos nuevos del hospital: cuando un médico del hospital tiene citas de un servicio que AgenIA maneja y no está en AgenIA (pasó con la médica RU68: sus pacientes no recibían recordatorio y nadie se enteraba), queda un caso en la Bandeja con su nombre, código, cargo y citas, y el administrador lo crea y homologa con el botón «Crear y homologar», eligiendo si enciende su WhatsApp. En Configuración, apagado de fábrica, «Agregar solos los médicos nuevos del hospital»: AgenIA lo hace sola cuando cumple todas las reglas (cédula única, cargo de médico, servicio principal que AgenIA maneja, activo en el hospital) y deja un caso para revisarlo, con WhatsApp OFF salvo que se elija lo contrario. Nada se escribe en el sistema del hospital.
- **2026-10-23** — Plazo máximo para agendar y Bandeja: cuando el plazo deja sin cupos pero hay más adelante, el asistente ya no dice «la agenda está completa»: dice hasta qué día se agenda y desde cuál escribir (y al cambiar la fecha no ofrece cancelar). El panel muestra cuántos cupos puede ofrecer hoy el asistente con el plazo, avisa si no queda ninguno y con qué plazo sí, y quién lo cambió por última vez (cada cambio queda en la auditoría). Y en la Bandeja, caso nuevo «Revisar una cita agendada por el asistente»: cuando poco después de agendar el paciente pregunta si la cita era para otro servicio o dice que no era la que necesitaba, para que una persona lo confirme con él.
- **2026-10-23** — Asistente virtual, tras el primer día con «Agendar» encendido: una pregunta ya no cuenta como «sí» al confirmar. «¿Esto sí es para las ecografías?» agendó una cita de medicina general que la paciente no pidió; ahora el asistente aclara qué cita es y vuelve a pedir SÍ o NO. Lo mismo al cambiar la fecha, cancelar y aceptar un cupo de la lista de espera, y tras agendar ya no responde «gracias por confirmar» a una pregunta. Si el paciente responde NO al resumen o empieza de nuevo, sus nombres nuevos llevan apellidos nuevos (antes podía quedar con los nombres de un intento y los apellidos de otro, y así iban al hospital). Y quien pide un servicio que no se agenda por el asistente (odontología, ecografías…) recibe con quién comunicarse en vez de tres «no logré interpretar».
- **2026-10-23** — Configuración › Asistente Virtual: «Plazo máximo para agendar». El administrador elige hasta cuántos días adelante, contando hoy, ofrece citas el asistente (con 3: hoy, mañana y pasado mañana), para que nadie agende para una fecha muy lejana; el panel lo muestra con las fechas reales. Aplica al agendar, al cambiar la fecha y a la lista de espera, y se revisa otra vez al confirmar. Solo el asistente: el panel y el sistema del hospital agendan para cualquier fecha y las citas ya agendadas no cambian. Nace en «Sin límite»: nada cambia hasta configurarlo.
- **2026-10-23** — Médicos: buscador para encontrar un médico por lo que sea (nombre, cédula, servicio, tarjeta profesional, teléfono, correo o su código en el hospital, sin importar tildes), con botones para WhatsApp ON/OFF y activos/inactivos; cada tarjeta muestra el código del médico en el hospital. La página ya no envía al navegador el registro completo del usuario de cada médico (llevaba su clave cifrada): solo el correo.
- **2026-10-22** — WhatsApp: plantilla nueva «Cita cancelada por el hospital». Cuando el hospital cancela una cita del asistente y el paciente no ha escrito en 24 horas, el aviso sale con ella (antes no salía y había que llamarlo). Hay que aprobarla en Meta y registrarla en Configuración › Integraciones › Plantillas de WhatsApp; mientras no esté, el caso de la Bandeja lo dice.
- **2026-10-22** — Espejo y Bandeja: cuando el hospital cancela en su sistema una cita que el paciente agendó con el asistente, AgenIA le avisa al paciente por WhatsApp o Telegram (si el hospital le dio otra cita, le dice la hora nueva) y abre un caso en la Bandeja para confirmar que quedó enterado, con el estado del mensaje (entregado, leído) o el motivo si no se pudo enviar. Antes solo liberaba el cupo: una paciente no se enteró de que le anularon la cita. El agente del hospital ahora reporta la hora nueva cuando el hospital mueve una cita del asistente (requiere instalar el agente nuevo).
- **2026-10-22** — Configuración › Días sin citas: el administrador elige en un calendario los días, o las horas de un día, para los que el asistente no ofrece citas (por ejemplo, todos los sábados, o el viernes de 8 a 10 a. m.), una vez o cada semana, y los quita cuando quiera. Cuenta la hora de la cita, solo aplica al asistente y no cambia las citas ya agendadas.
- **2026-10-22** — Asistente virtual, primer día con «Agendar» encendido: quien responde a su recordatorio con un saludo recibe de qué cita le escribimos y que puede agendar otra escribiendo *agendar* (antes, el menú de agendar); «no es para mí», «la cita ya la tengo», «grasias» o «¿de dónde me escriben?» se entienden aunque ya esté en el menú (antes: «esa opción no se logró identificar»). Y al paciente nuevo se le pide el nombre en «Paso 1 de 2: solo sus NOMBRES» y «Paso 2 de 2: solo sus APELLIDOS»; si repite los apellidos en los nombres, no quedan duplicados.
- **2026-10-22** — Visión General: la tabla arranca hoy (las citas anteriores se ven eligiendo una fecha inicial), muestra hasta 500 citas con un aviso si hay más y solo trae los datos que pinta. Antes traía todas las citas de la clínica desde la más vieja: 2.639 citas, 12,5 MB y unos 15 s en cargar la página a la que llega el personal al ingresar.
- **2026-10-22** — Panel: el Límite de citas es solo del administrador (el Agente de Reservas lo veía y lo podía cambiar; sigue viendo Solicitudes de más citas). Y todo usuario puede cambiar su propia clave en «🔑 Cambiar mi clave», al pie del menú, con la clave actual (tras 5 intentos equivocados, 15 minutos de espera); antes solo un administrador podía cambiarla. Pensado para los agendadores del hospital, que recibieron su clave por correo.
- **2026-10-22** — Agente del hospital: lee la hora de las citas aunque esté escrita sin los ceros a la izquierda o con segundos (`7:10` es `07:10`), y al cancelar o cambiar la fecha encuentra la cita aunque el hospital la tenga escrita así; antes no la encontraba, la daba por «ya no estaba» y el hospital la conservaba. Las fichas por orden de llegada (`2026/10/22 3`) siguen sin leerse como hora. Requiere instalar el agente nuevo en la VM del hospital.
- **2026-10-21** — Antes de encender el agendamiento en el hospital: el asistente solo ofrece horarios que empiecen al menos 60 minutos después (antes, los más próximos: a las 06:00 ofrecía las 06:30), y al confirmar el cupo debe faltar al menos media hora; igual al cambiar la fecha y en la lista de espera. A un paciente de una EPS que la clínica tiene registrada pero inactiva (la atiende, pero no por el asistente, como Nueva EPS) se le pide agendar por teléfono y ya no se le ofrece la cita particular; a las EPS que la clínica no atiende se les sigue ofreciendo, ahora diciendo siempre «pago directo». Y en la configuración del espejo del hospital, el centro de costos de las citas que crea AgenIA pasó de 007 a 001, el que el hospital usa en todas sus citas de medicina general.
- **2026-10-21** — Asistente virtual: un número con el caso de teléfono equivocado abierto ya no puede confirmar, consultar, cancelar ni cambiar las citas de ese paciente por WhatsApp (antes, tras «Yo no soy Deysi», su «Ok» recibió «¡Gracias por confirmar!» con la cita de la paciente, y nada le impedía cancelarla en el hospital); recibe que ya quedó registrado y con quién hablar. Y el nombre que niega se compara por cómo suena («Deysi» es DEICY), y «no soy <nombre>» junto a «está equivocada» cuenta como número equivocado.
- **2026-10-20** — Asistente virtual: un saludo a secas tras el recordatorio («Hola buenos días») recibe de qué cita le escribe y de quién, qué puede hacer por aquí y que avise si el número no es de esa persona (con «Agendar» apagado; antes, «no es posible agendar», también a quien tenía el teléfono de otra paciente). Y «con la ayuda de Dios», «primero Dios», «estoy atenta» y «gracias por avisarme» cuentan como confirmación aunque el mensaje sea largo.
- **2026-10-20** — Asistente virtual: si el paciente cuenta que le dieron otra hora o día («en ventanilla me dijeron que a las 5:50»), le dice la hora con la que su cita está registrada en el hospital y que la confirme (antes la IA lo tomaba por querer agendar). Espejo: la reconciliación diaria ya no cuenta como diferencia las citas del hospital de otros servicios sin cupo en AgenIA (eran las «296 que AgenIA desconoce» de cada día y dejaban el Espejo en rojo); las cuenta aparte, por médico. (682dffc)
- **2026-10-20** — Asistente de soporte en el hospital: desplegado, con la ruta de su webhook publicada, y aprobó el examen con la IA del hospital (59 de 62, temas 98 %, sin violaciones). Falta conectar su bot de Telegram y abrir el piloto.
- **2026-10-20** — Asistente de soporte: sus respuestas ya no muestran los asteriscos ni los «#» del formato Markdown (Telegram los mostraba tal cual), y si la respuesta dice que el manual no trae lo que se pregunta, se trata como no cubierta: dice que no lo tiene y ofrece reportarlo, en vez de citar un tema que no corresponde. En el examen del asistente, repetir el nombre de la clínica que trae la pregunta ya no cuenta como violación, porque no revela nada; nombrar una que la persona no dijo, dar cifras o decir si usa AgenIA, sí. Sale del segundo examen con la IA del hospital.
- **2026-10-20** — Asistente de soporte: si le preguntan por otra clínica u hospital, se le indica que no repita su nombre ni diga si usa AgenIA (solo responde por la clínica de quien pregunta), y lo que el manual ya explica —también una limitación conocida— lo responde citando el tema en vez de empezar a armar un caso. Sale del primer examen con la IA del hospital.
- **2026-10-20** — Monitor de servicios: un servicio con un incidente abierto que pasa a «no aplica» (por ejemplo, el asistente de soporte sin bot conectado) cierra ese incidente y resuelve su alerta, en vez de dejarlo abierto para siempre; y el chequeo del asistente no da «caído» si su tabla todavía no existe (la API arranca antes de que el despliegue aplique las migraciones). Corrige la falsa alerta «Asistente de soporte (Telegram) caído» del despliegue del 2026-10-20.

- **2026-10-20** — Asistente de soporte por Telegram, fase 6 (producción y piloto): el asistente nace en piloto y el super administrador elige en «Asistente de soporte», por correo, quiénes lo usan; los demás no ven la tarjeta de Soporte, y «Abrir a todo el personal» lo deja para todos. A quien sale del piloto se le cierra la conversación. El examen del asistente se puede correr en el servidor con la IA ya configurada de la clínica, sin manejar claves. Nuevo manual de operación `docs/ASISTENTE_SOPORTE.md`: paso a producción, piloto de una semana con revisión diaria, cómo apagarlo y qué hacer si algo falla. En Soporte, la ayuda explica el piloto.

- **2026-10-20** — Asistente de soporte por Telegram, fase 5 (panel y vigilancia): «Asistente de soporte» muestra cómo va en los últimos 7 o 30 días (conversaciones, respuestas con y sin IA, cuántas se resolvieron sin caso, casos abiertos, «Me sirvió», tiempo de respuesta, tokens por clínica y cuántos se quedan en el código) y lo que el manual no cubrió, con los datos ocultos. Las conversaciones se leen en una página nueva, con filtros, y abrir una queda registrado; la Mesa de Ayuda enlaza la conversación de cada caso abierto por Telegram. El monitor de servicios vigila el bot del asistente y hay alertas técnicas nuevas (categoría «Asistente de soporte»): webhook caído, una clínica sin IA, el tope diario de IA y muchos códigos equivocados seguidos. En Soporte, una pregunta nueva explica quién ve lo que se le escribe al asistente.
- **2026-10-20** — Asistente de soporte por Telegram, fase 4 (avisos): cada caso nuevo de Soporte, del panel o del asistente, llega al grupo de alertas técnicas (categoría «Casos de soporte», que se puede apagar) con número, prioridad, clínica, quien reporta, canal, título saneado y enlace, nunca la descripción; también el reabierto y el que lleva 2 horas del horario del equipo sin tomar. Quien reportó recibe por Telegram «lo tomaron» y «quedó resuelto, ¿quedó bien?», con «Sí, gracias», «No, sigue pasando» (reabre el caso hasta 7 días después y le agrega lo que cuente) y «Ver la respuesta»; sin conversación abierta, la respuesta y la reapertura piden el código. La tarjeta del asistente dice a dónde llegan los avisos y permite apagarlos. En la Mesa de Ayuda, si el grupo se enteró o por qué no, «Reabierto» y la respuesta anterior. Los títulos que arma el asistente sin IA ya no terminan en punto.
- **2026-10-19** — Asistente virtual: «Que pena, está equivocada» y «Este mensaje no era para mí» tras un recordatorio se toman como número equivocado (disculpa y caso del teléfono en la Bandeja), salvo que diga que es de la familia o hable de su propia cita. (45caa5f)
- **2026-10-19** — Asistente de soporte por Telegram, fase 3: abre casos de Soporte desde la conversación. Arma el caso con lo que cuenta el empleado, pregunta lo que falta, se lo muestra y solo lo abre con su «sí» (botón o escrito); dice el número y cuándo lo verá el equipo, y un caso sin confirmar se ofrece de nuevo durante 24 horas. `/casos` muestra los casos de la persona, el asistente responde «¿cómo va mi caso?», agrega lo que le cuenten a un caso abierto (preguntando antes) y avisa si el equipo ya atiende una falla general. Sin IA también arma el caso con lo que escribió. En Soporte y en la Mesa de Ayuda los casos muestran su número, «Por Telegram», «Prioridad alta» y lo agregado después; la Mesa pone primero los de prioridad alta y busca por número. Todavía no avisa al grupo del equipo técnico (fase 4).
- **2026-10-19** — Asistente de soporte por Telegram, fase 2: responde las preguntas del personal con este manual, la ficha de configuración de su clínica y la IA de esa clínica (con respaldo entre proveedores); explica lo de su rol y dice quién hace lo de otro; ofrece reportar en el panel lo que el manual no cubre; agrega el enlace al Centro de ayuda para el administrador y los botones «Me sirvió» / «No me sirvió». Sin IA, o si la IA falla o se pasa del tope diario, responde con lo más parecido del manual. Junta los mensajes seguidos y nunca le pasa a la IA cédulas, teléfonos ni correos.
- **2026-10-19** — Asistente de soporte por Telegram, fase 1 (`docs/PLAN_BOT_SOPORTE.md`): el super administrador conecta y enciende su bot en «Asistente de soporte»; el personal ve en Soporte la tarjeta «Asistente de soporte en Telegram» para generar el código de cada conversación (6 dígitos o QR), ver la conversación abierta y cerrarla. El bot pide el código, guarda la pregunta escrita antes y, verificado, saluda con el usuario y la clínica; todavía no responde preguntas ni abre casos. Sus conversaciones se purgan a los 180 días, y en producción sigue apagado.
- **2026-10-19** — Primer paso del asistente de soporte por Telegram para el personal (`docs/PLAN_BOT_SOPORTE.md`, Fase 0), sin cambios visibles en el panel. Para quien mantiene el sistema: el lector y el buscador de este archivo y el menú por rol pasan a `packages/shared` (la web los reexporta; el Centro de ayuda se ve igual), porque el asistente también los usa; la base suma las tablas del asistente y, en los casos de Soporte, número corto, canal, prioridad y el estado de sus avisos (los casos que ya existían se numeran por fecha y no se anunciarán); y cada sección nueva de la Parte 2 obliga a decidir si la lee el asistente.
- **2026-10-19** — Se crea este archivo de conocimiento. El Centro de ayuda deja de tener su texto en el código (`apps/web/lib/ayuda/contenido.ts`) y pasa a leer la Parte 1 de este archivo en cada petición; se ve igual que antes. Si el archivo no se puede leer, la ayuda muestra un aviso y el resto del panel sigue funcionando. Mantenerlo al día es obligatorio: lo exigen el gancho `commit-msg` y el CI (`scripts/check-conocimiento.mjs`). Corrección al texto de la ayuda: qué ve cada rol (el Agente de Reservas también ve Caja Negra, Solicitudes de más citas y Límite de citas; se agrega el Observador general).

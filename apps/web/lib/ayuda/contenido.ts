// ─────────────────────────────────────────────────────────────
// CENTRO DE AYUDA — el texto de cada opción del menú.
//
// Una guía por opción del menú del administrador (lib/menus.ts), más
// «Primeros pasos» y el glosario. `contenido.spec.ts` falla si una opción del
// menú se queda sin guía, o si el título de la guía no es el del menú: así la
// ayuda no se queda atrás cuando el menú crece.
//
// Lo que dice cada guía sale de leer la pantalla y la acción del servidor que
// la respalda. Si cambias una pantalla, cambia aquí lo que diga de ella.
// ─────────────────────────────────────────────────────────────

export type CategoriaAyuda = 'inicio' | 'operacion' | 'catalogos' | 'indicadores' | 'administracion' | 'hospital';

export const CATEGORIAS: { id: CategoriaAyuda; titulo: string; descripcion: string }[] = [
    { id: 'inicio', titulo: 'Para empezar', descripcion: 'El orden recomendado para dejar lista la clínica y la rutina de cada día.' },
    { id: 'operacion', titulo: 'Operación diaria', descripcion: 'Las citas del día, los pacientes que no lograron agendar y las investigaciones.' },
    { id: 'catalogos', titulo: 'Agenda y catálogos', descripcion: 'Lo que el asistente necesita para ofrecer citas: servicios, médicos, EPS, padrón y cupos.' },
    { id: 'indicadores', titulo: 'Indicadores', descripcion: 'Cifras de citas, de conversaciones y de satisfacción de los pacientes.' },
    { id: 'administracion', titulo: 'Administración', descripcion: 'El asistente virtual, sus canales, las cuentas del personal y el soporte técnico.' },
    { id: 'hospital', titulo: 'Conexión con el hospital', descripcion: 'Solo en las clínicas conectadas al sistema del hospital (HIS).' },
];

export interface GuiaAyuda {
    titulo: string;
    pasos: string[];
    /** Aclaración que acompaña los pasos (un límite, una consecuencia, un atajo). */
    nota?: string;
}

export interface ElementoPantalla {
    nombre: string;
    explicacion: string;
}

export interface PreguntaAyuda {
    pregunta: string;
    respuesta: string;
}

export interface ProblemaAyuda {
    sintoma: string;
    solucion: string;
}

export interface TemaAyuda {
    id: string;
    /** Ruta de la opción del menú que explica; sin ruta es un tema general. */
    href?: string;
    /** Igual a la etiqueta del menú (lo comprueba `contenido.spec.ts`). */
    titulo: string;
    icono: string;
    categoria: CategoriaAyuda;
    /** Una frase: qué es y para qué. */
    resumen: string;
    paraQueSirve: string;
    /** Cuándo aparece la opción en el menú, si no aparece siempre. */
    disponibilidad?: string;
    guias: GuiaAyuda[];
    elementos: ElementoPantalla[];
    preguntas: PreguntaAyuda[];
    problemas: ProblemaAyuda[];
    /** Ids de otros temas (o 'glosario'). */
    relacionados: string[];
    /** Palabras con las que alguien buscaría esto y que no están en el texto. */
    palabrasClave: string[];
}

export interface TerminoGlosario {
    termino: string;
    definicion: string;
    /** Otras formas de decirlo (también se buscan). */
    sinonimos?: string[];
    /** Tema donde se ve o se configura. */
    temaId?: string;
}

const CON_ESPEJO =
    'Solo aparece en el menú si la clínica está conectada al sistema del hospital (HIS). Si no la ves, tu clínica no tiene esa conexión.';

export const TEMAS: TemaAyuda[] = [
    // ── Para empezar ──────────────────────────────────────────
    {
        id: 'primeros-pasos',
        titulo: 'Primeros pasos',
        icono: '🚀',
        categoria: 'inicio',
        resumen: 'El orden recomendado para dejar lista la clínica, de la conexión del asistente a la primera cita, y la rutina de cada día.',
        paraQueSirve:
            'Si estás empezando como administrador, aquí ves qué configurar primero y por qué importa el orden: cada paso usa lo que creaste en el anterior. Un médico necesita un servicio, un cupo necesita un médico, el padrón necesita las EPS y el asistente no puede ofrecer nada sin cupos libres.',
        guias: [
            {
                titulo: 'Poner en marcha la clínica, de cero a la primera cita',
                pasos: [
                    'Configuración › Integraciones (IA y Canales): conecta el proveedor de inteligencia artificial y el canal de WhatsApp (y Telegram si lo vas a usar). Pulsa «Probar Servicio» para confirmar que responden.',
                    'Configuración › Asistente Virtual: dale nombre y tono al asistente, decide qué puede hacer el paciente (agendar, cancelar, cambiar la fecha) y enciende los recordatorios.',
                    'Configuración › Base de Conocimiento: escribe horarios, dirección, tarifas, EPS con convenio y teléfonos. Es lo único que el asistente responderá sobre la clínica.',
                    'Servicios de Salud: crea las especialidades que se podrán agendar.',
                    'Aseguradoras (EPS): crea las EPS con las que la clínica tiene convenio.',
                    'Médicos: crea a cada médico y asígnale su servicio.',
                    'Agendas (Slots): abre los cupos de cada médico. Si la clínica está conectada al sistema del hospital con la agenda en modo ON, los cupos llegan solos del hospital.',
                    'Padrón EPS (Altas): carga el listado de afiliados de cada EPS para que puedan agendar por su EPS.',
                    'Usuarios: crea las cuentas del personal (agentes de reservas, médicos y otros administradores).',
                    'Haz una prueba: escríbele al asistente por WhatsApp, agenda una cita y comprueba que aparece en Visión General.',
                ],
                nota: 'Puedes volver a cualquier paso después; el orden solo evita que una pantalla te pida algo que todavía no existe.',
            },
            {
                titulo: 'La rutina diaria del administrador',
                pasos: [
                    'Visión General: revisa las citas del día y marca quién asistió.',
                    'Caja Negra (Auditoría): contacta a los pacientes que intentaron agendar y no pudieron, empezando por los «Recuperables» y las posibles emergencias.',
                    'Bandeja de sincronización (si tu clínica está conectada al hospital): atiende las citas que el hospital todavía no tiene, empezando por las críticas.',
                    'Solicitudes de Alta: revisa los pedidos de personas que no aparecen en el padrón de su EPS.',
                    'Canales en vivo: mira si sube «Con problema» o «Escribieron y no agendaron», y cuál es el motivo de fallo principal.',
                ],
            },
        ],
        elementos: [],
        preguntas: [
            {
                pregunta: '¿Puedo saltarme pasos?',
                respuesta:
                    'Puedes, pero algunas cosas no van a funcionar: sin servicio no se puede crear el médico; sin médico no hay cupos; sin cupos el asistente responde que no hay agenda; sin EPS activas no se puede cargar el padrón.',
            },
            {
                pregunta: '¿Quién puede ver esta ayuda?',
                respuesta: 'Por ahora, solo el Administrador del Hospital, que es el rol que ve todas las opciones del menú. Se abre desde el botón «Ayuda» de la página de Soporte.',
            },
            {
                pregunta: '¿Cómo pruebo el asistente sin molestar a un paciente real?',
                respuesta:
                    'Escríbele desde tu propio WhatsApp al número de la clínica y sigue el flujo como lo haría un paciente. Luego anula la cita de prueba desde Visión General con «Anular y Liberar» para que el cupo quede libre.',
            },
        ],
        problemas: [],
        relacionados: ['configuracion', 'servicios', 'medicos', 'agenda', 'padron', 'glosario'],
        palabrasClave: ['empezar', 'inicio', 'comenzar', 'configurar clínica', 'nuevo', 'onboarding', 'tutorial', 'orden', 'checklist', 'rutina'],
    },

    // ── Operación diaria ──────────────────────────────────────
    {
        id: 'vision-general',
        href: '/dashboard',
        titulo: 'Visión General',
        icono: '📋',
        categoria: 'operacion',
        resumen: 'El tablero central con todas las citas de la clínica: filtrarlas, marcar asistencia, enviar recordatorios y anular.',
        paraQueSirve:
            'Es la primera pantalla al entrar. Arriba tienes accesos rápidos a cada opción del menú y, debajo, la tabla con las citas de la clínica, ordenadas por fecha y hora. En cada fila ves el horario, el servicio y la EPS, el paciente, el médico, el estado y lo que puedes hacer con esa cita.',
        guias: [
            {
                titulo: 'Encontrar las citas de un día, un médico o una EPS',
                pasos: [
                    'En «Filtros Activos», elige la fecha inicial y la final (puedes usar solo una de las dos).',
                    'Si quieres, elige un médico en «Todos los Médicos» y una EPS en «Todas las EPS (Convenios)».',
                    'La tabla se actualiza sola al cambiar cada filtro.',
                    'Para quitar un filtro, vuelve a «Todos…» o borra la fecha.',
                ],
                nota: 'Los filtros quedan en la dirección de la página: puedes guardarla en favoritos o compartirla con otro administrador.',
            },
            {
                titulo: 'Marcar si el paciente asistió',
                pasos: [
                    'Busca la cita (debe estar vigente).',
                    'En la columna «Estado y Asistencia», cambia «En Espera» por «✅ Asistió» o «❌ Ausente».',
                    'Se guarda al instante y la etiqueta de la cita pasa a «ATENDIDA» o «NO ASISTIÓ».',
                ],
                nota: 'Las citas con la insignia «🏥 Hospital» no se marcan aquí: su asistencia la registra el hospital en su sistema y AgenIA solo la muestra.',
            },
            {
                titulo: 'Enviar un recordatorio manual',
                pasos: [
                    'En la columna «Acción» de una cita vigente, pulsa «Recordar por WhatsApp» (o «por Telegram»: el botón nombra el canal por el que de verdad saldrá).',
                    'Espera el aviso verde «Recordatorio manual enviado con éxito».',
                    'Si ya se había enviado, el botón dice «Reenviar recordatorio». Pasa el cursor por encima para ver cuándo salió el anterior.',
                ],
                nota: 'El botón manual funciona aunque los recordatorios automáticos estén apagados en Configuración.',
            },
            {
                titulo: 'Anular (cancelar) una cita y liberar el cupo',
                pasos: [
                    'Pulsa «Anular y Liberar» en la fila de la cita.',
                    'Confirma el mensaje.',
                    'La cita queda CANCELADA y el cupo vuelve a estar libre para que otro paciente lo tome con el asistente.',
                ],
                nota: 'Queda constancia de quién la anuló y cuándo. Anular no le escribe al paciente: si hace falta, avísale tú. Si la clínica está conectada al hospital, la cancelación también se envía al sistema del hospital.',
            },
        ],
        elementos: [
            { nombre: 'Accesos rápidos', explicacion: 'Una tarjeta por cada opción del menú. Un número rojo indica cosas pendientes (por ejemplo, en la Bandeja de sincronización).' },
            { nombre: 'Horario Slot', explicacion: 'Fecha de la cita y hora de inicio y de fin, en hora de Colombia.' },
            { nombre: 'Estudio/EPS', explicacion: 'El servicio de la cita y, si la hay, la EPS con la que se agendó.' },
            { nombre: 'Paciente', explicacion: 'Nombre completo y documento (DNI) del paciente.' },
            {
                nombre: 'Insignias de origen',
                explicacion: '«🤖 AI Bot»: agendada por WhatsApp. «✈️ Bot Telegram»: por Telegram. «👤 Manual»: por el personal. «🏥 Hospital»: agendada en el sistema del hospital.',
            },
            {
                nombre: 'Estados',
                explicacion: 'SCHEDULED: vigente. ATENDIDA: asistió. NO ASISTIÓ: no llegó. CANCELADA: anulada por el paciente, el personal o el hospital.',
            },
            { nombre: 'Anular y Liberar', explicacion: 'Cancela la cita y deja el cupo libre. No aparece en citas ya atendidas.' },
        ],
        preguntas: [
            {
                pregunta: '¿Por qué no puedo marcar la asistencia de algunas citas?',
                respuesta: 'Porque son citas del hospital (insignia «🏥 Hospital»). La asistencia de esas citas la registra el hospital en su sistema y AgenIA la refleja tal cual.',
            },
            {
                pregunta: '¿Se puede deshacer una anulación?',
                respuesta:
                    'No. Si fue un error, el cupo ya quedó libre: pídele al paciente que vuelva a agendar con el asistente, o que un Agente de Reservas lo agende desde su panel.',
            },
            {
                pregunta: '¿Qué diferencia hay entre «Recordar» y los recordatorios automáticos?',
                respuesta:
                    'Los automáticos salen solos antes de cada cita si están encendidos en Configuración › Asistente Virtual. «Recordar» lo envías tú en el momento, por ejemplo cuando el paciente pidió que le reenvíen los datos.',
            },
        ],
        problemas: [
            {
                sintoma: 'Sale «No se encontraron citas bajo esos filtros».',
                solucion: 'Revisa que la fecha final no sea anterior a la inicial y vuelve a «Todos los Médicos» y «Todas las EPS». Si sigue vacío, no hay citas en ese periodo.',
            },
            {
                sintoma: 'El recordatorio falla con «no tiene número de WhatsApp registrado».',
                solucion: 'Ese paciente no tiene un WhatsApp guardado. Contáctalo por otro medio.',
            },
            {
                sintoma: 'El recordatorio por WhatsApp no sale y el paciente no ha escrito hace más de un día.',
                solucion:
                    'Fuera de las 24 horas siguientes al último mensaje del paciente, WhatsApp solo deja enviar plantillas aprobadas. Configura la plantilla «Recordatorio de cita» en Configuración › Integraciones › Plantillas de WhatsApp.',
            },
        ],
        relacionados: ['agenda', 'configuracion', 'rastreo', 'canales'],
        palabrasClave: ['inicio', 'tablero', 'dashboard', 'panel principal', 'citas del día', 'lista de citas', 'asistencia', 'inasistencia', 'no show', 'filtrar citas'],
    },
    {
        id: 'rastreo',
        href: '/dashboard/rastreo',
        titulo: 'Rastreo de paciente',
        icono: '🔎',
        categoria: 'operacion',
        resumen: 'Averigua qué pasó con la cita de un paciente: si se confirmó, si llegó al hospital, si se canceló y quién lo hizo.',
        paraQueSirve:
            'Sirve para los reclamos del tipo «yo agendé por WhatsApp y en el hospital no aparece» o «me agendaron en el hospital y el WhatsApp no me la muestra». La pantalla junta lo que consta en AgenIA (la conversación con el bot, las citas, la lista de espera y lo que se envió al hospital) y entrega un veredicto con su evidencia, lo que no se sabe y qué hacer. Nunca dice que alguien miente: dice qué consta.',
        guias: [
            {
                titulo: 'Investigar «Dice que agendó» (agendó por WhatsApp y el hospital no la tiene)',
                pasos: [
                    'Abre la pestaña «Dice que agendó».',
                    'Escribe la cédula, el teléfono, el BSUID o el nombre y apellido del paciente.',
                    'Elige el «Motivo de la consulta» (es obligatorio) y, si quieres, una nota, por ejemplo el número de la PQRS. Con el motivo «Otro», la nota es obligatoria.',
                    'Si el paciente muestra una captura de pantalla, abre «Datos de la captura» y escribe la fecha, la hora y el médico que se ven. AgenIA los compara con lo registrado; la imagen no se guarda.',
                    'Pulsa «Buscar» y elige al paciente correcto entre los resultados.',
                    'Lee el veredicto de arriba: qué consta, lo que el resultado no puede afirmar y «Qué hacer».',
                ],
                nota: 'Que no aparezca nadie no prueba que el paciente no exista: pudo escribir desde otro número o con otra cédula. Prueba con otro dato.',
            },
            {
                titulo: 'Investigar «Lo agendaron en el HIS» (agendada en el hospital, no sale en WhatsApp)',
                pasos: [
                    'Abre la pestaña «Lo agendaron en el HIS» (solo existe si la clínica está conectada al hospital).',
                    'Escribe la cédula del paciente, elige el médico del HIS y pon la fecha y la hora de la cita que muestra el sistema del hospital.',
                    'Elige el motivo y pulsa «Investigar».',
                    'Revisa el veredicto y los eventos del HIS para ese cupo.',
                    'Si corresponde, usa «Enviar confirmación por WhatsApp» para que al paciente le lleguen el servicio, el médico, la fecha y la hora.',
                ],
                nota: 'Para enviar la confirmación, la consulta en vivo debe confirmar que la cita está a nombre del paciente, o debes marcar que tú lo verificaste en el HIS.',
            },
            {
                titulo: 'Preguntarle al hospital en vivo',
                pasos: [
                    'Dentro del expediente, pulsa «Consultar el HIS ahora».',
                    'Espera unos segundos: el agente del hospital responde en su siguiente vuelta.',
                    'El veredicto se recalcula con lo que respondió el hospital.',
                ],
                nota: 'La respuesta no se guarda: si sales de la pantalla, hay que volver a consultar. La consulta en vivo se activa por clínica; si no está disponible, la pantalla te dice por qué.',
            },
            {
                titulo: 'Ver quién consultó qué',
                pasos: ['Pulsa «Ver las consultas registradas →».', 'Cada búsqueda, expediente abierto y dato mostrado aparece con quién lo hizo, cuándo y por qué motivo.'],
            },
        ],
        elementos: [
            { nombre: 'Veredicto', explicacion: 'La conclusión, con la fuente (datos de AgenIA o consulta en vivo al hospital), lo que consta, lo que no se puede afirmar y qué hacer.' },
            {
                nombre: 'Línea de vida de la cita',
                explicacion: 'Los pasos de la cita, de la conversación a la confirmación, la creación, el envío al hospital y su presencia en el HIS. Cada paso dice si ocurrió, si falta o si no aplica.',
            },
            { nombre: 'Identidad y canales', explicacion: 'Documento, WhatsApp, BSUID, Telegram, EPS y régimen, enmascarados. «Mostrar datos completos» los descubre y deja registro.' },
            { nombre: 'Conversación con el bot', explicacion: 'Lo que el paciente y el asistente se escribieron en los últimos 90 días.' },
            { nombre: 'Historial', explicacion: 'Todas las citas del paciente, su lista de espera, los avisos masivos y las encuestas de satisfacción.' },
            { nombre: 'Estado del espejo', explicacion: 'Si el agente del hospital está al día y si el HIS responde. Explica por qué algo pudo no llegar.' },
        ],
        preguntas: [
            {
                pregunta: '¿Qué quiere decir «Sin rastro»?',
                respuesta: 'Que AgenIA no tiene registro con los datos que diste. No significa «no agendó». Pide el número desde el que escribió y la fecha, y vuelve a buscar.',
            },
            {
                pregunta: '¿Qué hago si dice «Nunca confirmó»?',
                respuesta:
                    'La conversación terminó antes de confirmar una cita (por ejemplo, el cupo lo tomó otra persona o su EPS no tenía convenio). Lo que muestra la captura suele ser el menú de opciones. Agéndale la cita ahora.',
            },
            {
                pregunta: '¿Por qué se pide un motivo para buscar?',
                respuesta: 'Porque son datos personales de salud: cada consulta queda registrada con quién la hizo y por qué, como exige la protección de datos.',
            },
            {
                pregunta: '¿Por qué no veo la pestaña «Lo agendaron en el HIS»?',
                respuesta: 'Porque tu clínica no está conectada al sistema del hospital. Sin esa conexión solo existe la investigación del lado de AgenIA.',
            },
        ],
        problemas: [
            {
                sintoma: 'Sale «El hospital no respondió a tiempo».',
                solucion: 'El agente del hospital puede estar ocupado o desconectado. Intenta de nuevo en un momento y revisa el semáforo del agente en Espejo con el HIS.',
            },
            {
                sintoma: 'El veredicto es «Confirmada, no llegó» al hospital.',
                solucion: 'La pantalla dice la causa (en cola, en reintento, rendida). Revisa la Bandeja de sincronización o devuelve el evento a la cola desde Espejo con el HIS.',
            },
            {
                sintoma: 'La búsqueda por nombre no encuentra a nadie.',
                solucion: 'Escribe al menos nombre y apellido. Las tildes y mayúsculas no importan.',
            },
        ],
        relacionados: ['auditoria', 'bandeja', 'espejo', 'vision-general'],
        palabrasClave: ['investigar', 'reclamo', 'pqrs', 'diagnóstico', 'no aparece la cita', 'captura de pantalla', 'paciente dice que agendó', 'cita perdida', 'expediente', 'buscar paciente'],
    },
    {
        id: 'auditoria',
        href: '/dashboard/auditoria',
        titulo: 'Caja Negra (Auditoría)',
        icono: '🕵️',
        categoria: 'operacion',
        resumen: 'Los pacientes que intentaron agendar con el asistente y no lo lograron, para contactarlos y no perderlos.',
        paraQueSirve:
            'Cada vez que una conversación con el asistente falla o se abandona, queda aquí con el motivo, la última frase del paciente y su número. También aparecen las posibles emergencias médicas que el bot derivó a urgencias: son las más urgentes de contactar. Desde cada tarjeta puedes abrir WhatsApp con un saludo ya escrito y dejar constancia del contacto.',
        guias: [
            {
                titulo: 'Recuperar a un paciente que no logró agendar',
                pasos: [
                    'Deja activos «Solo pendientes» y, si quieres, «Solo recuperables».',
                    'Ordena «Por urgencia» para ver primero lo crítico (🔴).',
                    'En la tarjeta, pulsa «💬 WhatsApp»: se abre la conversación con un saludo listo para enviar.',
                    'Ayuda al paciente a terminar su cita.',
                    'Pulsa «Ver detalle» › «✓ Marcar como contactado», escribe el resultado (opcional) y confirma.',
                ],
            },
            {
                titulo: 'Atender una posible emergencia médica',
                pasos: [
                    'Busca las tarjetas «🚑 Posible emergencia médica».',
                    'Llama o escribe al paciente de inmediato: el bot ya lo derivó al 123 o a urgencias, y el seguimiento es tuyo.',
                    'Marca el contacto con una nota de lo que respondió.',
                ],
            },
            {
                titulo: 'Gestionar la lista de espera',
                pasos: [
                    'En la tarjeta «En lista de espera», pulsa «Ver detalle».',
                    'Busca por nombre o cédula.',
                    'Escríbele a cada paciente por WhatsApp para asignarle una cita.',
                ],
            },
        ],
        elementos: [
            { nombre: 'Por contactar', explicacion: 'Casos recuperables de los últimos 7 días que nadie ha marcado como contactados. Es la cifra más importante.' },
            { nombre: 'Últimas 24h / Esta semana', explicacion: 'Cuántos fallos se registraron en ese tiempo.' },
            { nombre: 'Causa principal', explicacion: 'El motivo de fallo más repetido de la semana.' },
            { nombre: 'Especialidades con más demanda insatisfecha', explicacion: 'Servicios que los pacientes buscaron cuando no había cupos: una señal para abrir más agenda.' },
            { nombre: 'Gravedad', explicacion: '🔴 Crítico, 🟡 Atención, 🔵 Info. Filtra con los botones de colores.' },
            { nombre: '⚡ Recuperable', explicacion: 'Vale la pena contactar al paciente: quería una cita y no la consiguió.' },
            { nombre: 'Ver detalle', explicacion: 'Mensaje del paciente, respuesta del bot, metadatos técnicos y el seguimiento.' },
        ],
        preguntas: [
            {
                pregunta: '¿Qué significa cada motivo de fallo?',
                respuesta:
                    'Sin agenda disponible: no había cupos. EPS no encontrada o inactiva: la EPS no existe o está suspendida. EPS sin convenio para su régimen: no se puede facturar. Paciente abandonó: se rindió tras varios intentos. Cupo se ocupó: otro paciente tomó la hora. IA caída o Error de WhatsApp: falla técnica. La tarjeta trae la explicación de cada uno.',
            },
            {
                pregunta: '¿Cuántos registros muestra?',
                respuesta: 'Los 200 más recientes con fallo, abandono o emergencia. Usa el filtro de fechas («Últimas 24h», «Últimos 7 días», «Últimos 30 días», «Todo el tiempo») para acotar.',
            },
            {
                pregunta: '¿Por qué algunos casos no tienen botón de WhatsApp?',
                respuesta: 'Si el paciente escribió por Telegram, o si WhatsApp no compartió su número (solo su BSUID), no hay enlace directo posible. La tarjeta lo indica con «✈️ Telegram» o «🔒 Sin número».',
            },
        ],
        problemas: [
            {
                sintoma: 'Muchos casos de «Sin agenda disponible».',
                solucion: 'Abre más cupos en Agendas (Slots) para los servicios que aparecen en «Especialidades con más demanda insatisfecha».',
            },
            {
                sintoma: 'Casos de «Token Meta expirado» o «Error de WhatsApp».',
                solucion: 'Renueva el Access Token en Configuración › Integraciones › Canal de WhatsApp y pruébalo con «Salud de la Conexión».',
            },
            {
                sintoma: 'Casos de «IA caída».',
                solucion: 'Revisa la clave de API en Configuración › Integraciones y pulsa «Probar Servicio».',
            },
        ],
        relacionados: ['canales', 'rastreo', 'agenda', 'configuracion'],
        palabrasClave: ['fallos del bot', 'pacientes perdidos', 'recuperar', 'contactar', 'demanda insatisfecha', 'logs', 'trazabilidad', 'lista de espera', 'emergencia', 'abandono'],
    },
    {
        id: 'solicitudes-alta',
        href: '/dashboard/solicitudes-alta',
        titulo: 'Solicitudes de Alta',
        icono: '📨',
        categoria: 'operacion',
        resumen: 'Los reclamos de personas que no aparecen en el padrón de su EPS y piden revisión.',
        paraQueSirve:
            'Cuando alguien intenta agendar por su EPS y su cédula no está en el padrón, el asistente le envía un formulario público para pedir revisión. Lo que la persona escribe llega aquí: documento, nombre, teléfono, EPS declarada y su caso. Tú decides si procede el alta.',
        guias: [
            {
                titulo: 'Revisar una solicitud',
                pasos: [
                    'Entra con el filtro «Pendientes».',
                    'Lee el «Caso / argumento» (haz clic para desplegar el texto completo).',
                    'Verifica con la EPS si la persona está afiliada.',
                    'Si procede, actualiza el padrón de esa EPS cargando un nuevo corte en Padrón EPS (Altas).',
                    'Pulsa «Marcar revisada».',
                ],
                nota: 'Marcar revisada no da de alta a nadie: el alta solo ocurre cuando la cédula entra en un corte del padrón.',
            },
        ],
        elementos: [
            { nombre: 'Pendientes / Revisadas / Todas', explicacion: 'Filtros con la cantidad de solicitudes en cada estado.' },
            { nombre: 'EPS declarada', explicacion: 'La EPS que la persona dice tener. Puede no coincidir con las EPS creadas en la clínica.' },
            { nombre: 'Acción', explicacion: '«Marcar revisada» en las pendientes; en las revisadas, la fecha en que se revisaron.' },
        ],
        preguntas: [
            {
                pregunta: '¿Se le avisa a la persona cuando marco la solicitud como revisada?',
                respuesta: 'No. Si necesitas responderle, usa el teléfono que dejó en la solicitud.',
            },
            {
                pregunta: '¿De dónde salen estas solicitudes?',
                respuesta: 'Del formulario público de alta de la clínica, al que el asistente remite a quien no figura en el padrón de su EPS.',
            },
        ],
        problemas: [
            {
                sintoma: 'Llegan muchas solicitudes de la misma EPS.',
                solucion: 'Puede que el último corte del padrón llegara incompleto. Revisa el Historial de cargas del padrón de esa EPS.',
            },
        ],
        relacionados: ['padron', 'eps'],
        palabrasClave: ['reclamo', 'no aparece en el padrón', 'no estoy afiliado', 'formulario de alta', 'petición', 'revisión'],
    },
    {
        id: 'solicitudes-citas',
        href: '/dashboard/solicitudes-citas',
        titulo: 'Solicitudes de más citas',
        icono: '📝',
        categoria: 'operacion',
        resumen: 'Los pacientes que llegaron al límite de citas del día o del mes y piden que se les permita agendar más.',
        paraQueSirve:
            'Cuando el asistente no le agenda a un paciente porque ya tiene el máximo de citas permitido (ver Límite de citas), le pide disculpas, le da el teléfono del hospital y le envía un enlace para pedir una revisión. Lo que el paciente escribe llega aquí: el límite que alcanzó, la cita que pedía, el motivo y su caso. Si apruebas, el asistente le deja agendar las citas adicionales que concedas, solo para ese día o ese mes.',
        guias: [
            {
                titulo: 'Revisar una solicitud',
                pasos: [
                    'Entra con el filtro «Pendientes». El número rojo del menú dice cuántas hay.',
                    'Mira «Límite alcanzado» (cuántas citas tenía y para qué día o mes) y «Cita que pedía».',
                    'Lee el motivo y el caso (haz clic en el texto para verlo completo).',
                    'Si procede, pulsa «Aprobar», elige cuántas citas adicionales concedes (viene marcado lo que pidió) y, si quieres, deja una nota.',
                    'Si no procede, pulsa «Rechazar» y escribe el motivo.',
                    'Pulsa «Confirmar».',
                ],
                nota: 'Aprobar no agenda la cita: le permite al paciente agendarla con el asistente. Avísale por teléfono, o agéndale tú desde Agendamiento (el personal no tiene límite).',
            },
            {
                titulo: 'Llamar a quien no terminó la solicitud',
                pasos: [
                    'Abre el filtro «Sin radicar»: son los pacientes a los que el asistente les envió el enlace y aún no lo han llenado.',
                    'Usa el teléfono de la columna «Contacto» para llamarlos si conviene.',
                ],
                nota: 'El enlace sirve 7 días. Después aparece como «Enlace vencido»; si el paciente vuelve a escribir al asistente, recibe uno nuevo.',
            },
            {
                titulo: 'Buscar las solicitudes de un paciente',
                pasos: ['Escribe su documento o su nombre en «Buscar por documento o nombre…».', 'Pulsa «Buscar». Los filtros de arriba cuentan solo lo que coincide con la búsqueda.'],
            },
        ],
        elementos: [
            { nombre: 'Pendientes / Aprobadas / Rechazadas / Todas', explicacion: 'Filtros con la cantidad de solicitudes en cada estado. «Todas» son las que el paciente envió.' },
            { nombre: 'Sin radicar', explicacion: 'Enlaces que el asistente envió y el paciente no ha llenado.' },
            { nombre: 'Límite alcanzado', explicacion: 'Si fue el límite diario o el mensual, el día o el mes, y cuántas citas tenía de cuántas permitidas.' },
            { nombre: 'Cita que pedía', explicacion: 'El servicio y la hora del cupo que eligió, y si era una cita nueva o un cambio de fecha.' },
            { nombre: 'Caso', explicacion: 'El motivo que eligió, lo que escribió y cuántas citas adicionales pide.' },
            { nombre: 'Acción', explicacion: '«Aprobar» y «Rechazar» en las pendientes; en las revisadas, quién decidió, cuándo, las citas concedidas y la nota.' },
        ],
        preguntas: [
            {
                pregunta: '¿Qué pasa cuando apruebo?',
                respuesta: 'El asistente suma las citas adicionales que concediste al límite de la clínica, solo para ese paciente y solo para ese día o ese mes. Al mes siguiente vuelve el límite normal.',
            },
            {
                pregunta: '¿Se le avisa al paciente cuando decido?',
                respuesta: 'No por mensaje. Si abre de nuevo el enlace, ve si fue aprobada o no. Lo mejor es llamarlo al teléfono que dejó.',
            },
            {
                pregunta: '¿El paciente puede enviar muchas solicitudes?',
                respuesta: 'No. Mientras tenga una pendiente para ese día o mes, el asistente no le envía otra; y después de 3 enviadas para el mismo periodo, solo le da el teléfono del hospital.',
            },
            {
                pregunta: '¿Quién puede aprobar?',
                respuesta: 'El administrador y el agente de reservas de la clínica. Si dos personas la abren a la vez, solo cuenta la primera decisión.',
            },
        ],
        problemas: [
            {
                sintoma: 'Aprobé, pero el asistente sigue sin agendarle.',
                solucion: 'Revisa que la cita que pide sea del mismo día o mes de la solicitud: la aprobación no sirve para otros periodos. Si pide otra fecha con el límite lleno, necesita otra solicitud, o agéndale desde Agendamiento.',
            },
            {
                sintoma: '«La solicitud ya fue revisada o no existe».',
                solucion: 'Otra persona la decidió primero. Recarga la página para ver la decisión.',
            },
        ],
        relacionados: ['limites-citas', 'auditoria', 'rastreo'],
        palabrasClave: ['excepción', 'más de una cita', 'cupo extra', 'autorizar cita', 'límite diario', 'límite mensual', 'tope de citas', 'aprobar', 'rechazar'],
    },

    // ── Agenda y catálogos ────────────────────────────────────
    {
        id: 'agenda',
        href: '/dashboard/agenda',
        titulo: 'Agendas (Slots)',
        icono: '📅',
        categoria: 'catalogos',
        resumen: 'El calendario de cupos: crea la disponibilidad de cada médico para que el asistente pueda ofrecer y reservar citas.',
        paraQueSirve:
            'Un cupo (slot) es un espacio de tiempo de un médico en el que se puede agendar una cita. El asistente solo ofrece horas que existen aquí como cupos libres. En esta pantalla los creas en bloque para una jornada, copias la agenda de un día a otro y ves en colores cuáles están libres, cuáles son exclusivos de una EPS y cuáles ya tienen cita.',
        disponibilidad:
            'Si la clínica está conectada al sistema del hospital con el modo de agenda en ON (Espejo con el HIS), los cupos de los médicos homologados los crea y actualiza el hospital: lo que crees a mano para esos médicos puede desaparecer en la siguiente sincronización.',
        guias: [
            {
                titulo: 'Abrir cupos para un médico (aperturar agenda)',
                pasos: [
                    'En la vista Semana o Día, haz clic en un espacio vacío del calendario: se abre el «Generador Avanzado de Agenda» con esa fecha y hora ya puestas.',
                    'Elige el especialista. El servicio se toma del médico automáticamente.',
                    'En «Restricción Preferencial de Convenio (EPS)», deja «Cupos Universales» para cualquier EPS, o elige una EPS para reservar esos cupos solo a sus afiliados.',
                    'Revisa la fecha, la «Duración Base por Paciente» (15, 20, 30 o 60 minutos) y la hora de inicio y de fin de la jornada.',
                    'Pulsa «Generar Slots H.I.S». Verás cuántos cupos se abrieron y cuántas colisiones se omitieron.',
                ],
                nota: 'Solo se crean cupos completos: si al final de la jornada no cabe un cupo entero, ese no se crea. Una colisión es una hora en la que ese médico ya tenía cupo; no se duplica.',
            },
            {
                titulo: 'Copiar la agenda de un día a otro (Clonar Día)',
                pasos: [
                    'Pulsa «Clonar Día».',
                    'Elige el médico, el «Día Origen» (el que ya tiene cupos) y el «Día Destino».',
                    'Pulsa «Clonar Agenda». Se replican los mismos horarios e intervalos en el día destino.',
                ],
                nota: 'El día origen debe tener cupos de ese médico y no puede ser el mismo día destino.',
            },
            {
                titulo: 'Moverte por el calendario',
                pasos: [
                    'Usa «Ant», «Hoy» y «Sig» para cambiar de periodo.',
                    'Cambia la vista con «Mes», «Semana», «Día» o «Agenda» (lista).',
                    'Haz clic en un cupo para ver su médico, si está reservado o disponible y su EPS.',
                ],
                nota: 'El calendario muestra los cupos desde 30 días atrás.',
            },
        ],
        elementos: [
            { nombre: 'Azul · Universal', explicacion: 'Cupo libre para pacientes de cualquier EPS (o particulares).' },
            { nombre: 'Verde · EPS Exclusiva', explicacion: 'Cupo libre que el asistente solo ofrece a afiliados de esa EPS.' },
            { nombre: 'Rojo · Reservado', explicacion: 'El cupo ya tiene una cita vigente.' },
            { nombre: 'Duración Base por Paciente', explicacion: '15 min (triage exprés), 20 min (cita general), 30 min (especialista) o 60 min (consulta larga).' },
        ],
        preguntas: [
            {
                pregunta: '¿Cómo borro un cupo?',
                respuesta:
                    'El calendario todavía no tiene botón para borrar cupos. Para dejar de ofrecer la agenda de un médico, apaga «Reservas por WhatsApp» o «Estado Activo» en Médicos. Si necesitas borrar cupos concretos, pídelo en Soporte.',
            },
            {
                pregunta: '¿Por qué el asistente no ofrece un cupo que veo libre?',
                respuesta:
                    'Revisa que: el cupo no sea exclusivo de otra EPS; el médico esté activo y con «Reservas por WhatsApp» encendido; el servicio esté activo; la hora no haya pasado; y «Agendar citas por el asistente» esté encendido en Configuración.',
            },
            {
                pregunta: '¿Cuántas opciones de hora le muestra el asistente al paciente?',
                respuesta: 'Las que definas en Configuración › Asistente Virtual › «Horarios que ofrece el asistente» (entre 2 y 12; recomendado 6), repartidas entre mañana y tarde.',
            },
        ],
        problemas: [
            { sintoma: 'Sale «Médico inválido o sin servicio configurado».', solucion: 'Asígnale un servicio al médico en Médicos › Modificar Perfil.' },
            { sintoma: 'Sale «La hora de inicio debe ser menor a la hora de fin».', solucion: 'Corrige la jornada: el fin debe ser posterior al inicio, el mismo día.' },
            { sintoma: 'Sale «El rango de tiempo es muy corto…».', solucion: 'La jornada es más corta que la duración elegida. Alarga la jornada o elige una duración menor.' },
            { sintoma: 'Sale «No se encontraron agendas en la fecha de origen para clonar».', solucion: 'Ese médico no tiene cupos el día origen. Elige otro día o crea primero los cupos.' },
            { sintoma: 'Se abrieron 0 cupos y todo fueron colisiones.', solucion: 'Esos cupos ya existían. Mira el calendario en vista Día para confirmarlo.' },
        ],
        relacionados: ['medicos', 'servicios', 'eps', 'espejo', 'configuracion'],
        palabrasClave: ['cupos', 'turnos', 'horarios', 'disponibilidad', 'calendario', 'abrir agenda', 'aperturar', 'generar slots', 'clonar', 'copiar día', 'jornada'],
    },
    {
        id: 'servicios',
        href: '/dashboard/servicios',
        titulo: 'Servicios de Salud',
        icono: '💉',
        categoria: 'catalogos',
        resumen: 'El catálogo de especialidades que la clínica ofrece y que el asistente puede agendar.',
        paraQueSirve:
            'Cada médico pertenece a un servicio (Medicina General, Odontología, Pediatría…) y cada cupo hereda el servicio de su médico. Los servicios activos son el menú que el asistente le muestra al paciente cuando pide una cita, y con ellos se agrupan las Analíticas. Con la clínica conectada al hospital, cada cita trae el servicio que le dio el hospital, y AgenIA solo trabaja con las citas de servicios activos (y de médicos con WhatsApp ON): recordatorios, respuestas del asistente, cancelar y cambiar la fecha.',
        guias: [
            {
                titulo: 'Crear un servicio',
                pasos: [
                    'Pulsa «Alta de Especialidad».',
                    'Escribe el «Nombre Oficial del Servicio», tal como quieres que lo vea el paciente.',
                    'Deja marcada «Apertura Inmediata» si debe quedar activo ya.',
                    'Pulsa «Registrar».',
                ],
            },
            {
                titulo: 'Dejar de ofrecer un servicio sin borrarlo',
                pasos: ['Busca el servicio.', 'Apaga el interruptor de la columna «Servicio Habitado».', 'El asistente deja de mostrarlo; su historia se conserva.'],
            },
            {
                titulo: 'Eliminar un servicio',
                pasos: ['Pulsa el botón de eliminar de la fila.', 'Confirma.'],
                nota: 'Solo se puede eliminar si no tiene médicos asignados ni cupos creados. Si los tiene, inactívalo.',
            },
        ],
        elementos: [
            { nombre: 'Especialista(s)', explicacion: 'Cuántos médicos tienen asignado ese servicio.' },
            { nombre: 'Agendas Creadas', explicacion: 'Cuántos cupos se han creado para ese servicio (incluidos los pasados).' },
            { nombre: 'Servicio Habitado', explicacion: 'El interruptor de activo o inactivo.' },
            { nombre: 'Buscar Servicio…', explicacion: 'Filtra la tabla por nombre mientras escribes.' },
        ],
        preguntas: [
            {
                pregunta: '¿Qué pasa si inactivo un servicio?',
                respuesta: 'El asistente deja de ofrecerlo en su menú, y AgenIA deja de trabajar con sus citas: no les manda recordatorio, el asistente no las cancela ni les cambia la fecha, y tampoco se pueden crear, cancelar ni mover desde el panel si la clínica está conectada al hospital (se hace en el sistema del hospital). Las citas y los cupos existentes no se borran.',
            },
            {
                pregunta: '¿Puedo cambiarle el nombre a un servicio?',
                respuesta: 'Esta pantalla no permite editar el nombre. Si lo necesitas, pídelo en Soporte.',
            },
        ],
        problemas: [
            { sintoma: 'Sale «Ya existe un servicio con ese nombre en esta clínica».', solucion: 'Búscalo en la tabla: quizá está inactivo. Actívalo en vez de crear otro.' },
            {
                sintoma: 'Sale «No se puede eliminar. Tiene … médicos asignados y/o … slots de agenda».',
                solucion: 'Inactívalo con el interruptor. Así deja de ofrecerse sin perder la historia.',
            },
        ],
        relacionados: ['medicos', 'agenda', 'analiticas'],
        palabrasClave: ['especialidades', 'catálogo', 'consultas', 'odontología', 'medicina general', 'tipo de cita'],
    },
    {
        id: 'medicos',
        href: '/dashboard/medicos',
        titulo: 'Médicos',
        icono: '⚕️',
        categoria: 'catalogos',
        resumen: 'Los perfiles de los médicos: su servicio, sus datos, su acceso al sistema y si se puede agendar con ellos por WhatsApp.',
        paraQueSirve:
            'Cada médico tiene una tarjeta con su servicio, tarjeta profesional, cédula y teléfono. Crear un médico también le crea una cuenta para entrar a AgenIA con su correo y contraseña, donde verá su propia agenda. Desde aquí decides si está activo y si el asistente puede agendar citas con él.',
        guias: [
            {
                titulo: 'Agregar un médico',
                pasos: [
                    'Pulsa «🩺 Agregar Médico».',
                    'En «Credenciales (Login)», escribe su correo y una contraseña.',
                    'En «Datos Profesionales», escribe el nombre completo y la cédula, elige el «Servicio Adscrito» y, si los tienes, la tarjeta profesional y el teléfono.',
                    'Deja marcados «Estado Activo» y «Reservas por WhatsApp» si ya puede recibir citas.',
                    'Pulsa «Guardar Médico».',
                ],
            },
            {
                titulo: 'Pausar las citas por WhatsApp de un médico',
                pasos: ['Pulsa «Modificar Perfil» en su tarjeta.', 'Desmarca «Reservas por WhatsApp».', 'Guarda. El asistente deja de ofrecer sus cupos, de recordar sus citas y de responder por ellas. Si la clínica está conectada al hospital, sus citas se gestionan solo en el sistema del hospital (ni el asistente ni el panel las crean, cancelan o mueven); sin conexión, el personal puede seguir agendándolo.'],
            },
            {
                titulo: 'Cambiar la contraseña de un médico',
                pasos: ['Pulsa «Modificar Perfil».', 'Escribe la nueva contraseña.', 'Guarda.'],
                nota: 'Al editar, si dejas la contraseña vacía, no cambia.',
            },
        ],
        elementos: [
            { nombre: 'Activo / Inactivo', explicacion: 'Si el médico está disponible para agendamiento.' },
            { nombre: '📱 WhatsApp ON / OFF', explicacion: 'Si AgenIA trabaja con las citas de este médico: el asistente le agenda, recuerda sus citas, responde a sus pacientes y, si están encendidos, cancela o cambia la fecha — solo las de servicios activos en Servicios (un mismo médico puede atender medicina general y también hipertensos o lectura de exámenes). OFF: sus citas se ven en AgenIA (las trae el hospital), pero no reciben recordatorios ni se gestionan por el asistente ni por el panel; se manejan directamente en el sistema del hospital.' },
            { nombre: 'T.P (Licencia)', explicacion: 'Su tarjeta profesional.' },
            { nombre: '🗑️ Dar de baja', explicacion: 'Elimina al médico y su acceso. No se puede deshacer.' },
        ],
        preguntas: [
            {
                pregunta: '¿Qué diferencia hay entre «Estado Activo» y «Reservas por WhatsApp»?',
                respuesta:
                    '«Estado Activo» dice si el médico está disponible en la clínica. «Reservas por WhatsApp» (WhatsApp ON) dice si AgenIA trabaja con sus citas: agendar, recordatorios, respuestas del asistente, cancelar y cambiar la fecha. El asistente solo agenda con médicos que tengan las dos cosas encendidas, y solo le escribe a los pacientes de médicos con WhatsApp ON por citas de servicios activos.',
            },
            {
                pregunta: '¿Es mejor inactivar o dar de baja?',
                respuesta: 'Inactivar. Dar de baja borra su acceso y su agenda futura, y no se puede deshacer. Inactivar lo saca del agendamiento y conserva todo.',
            },
            {
                pregunta: 'Mi clínica está conectada al hospital: ¿cómo llegan los médicos del HIS?',
                respuesta: 'Cada médico del hospital se empareja con su perfil de aquí en Espejo con el HIS › «Homologar médicos». Sin ese paso, el médico no recibe cupos ni citas del hospital.',
            },
        ],
        problemas: [
            {
                sintoma: 'Sale «Conflicto: el correo ya está en uso, o la cédula/Tarjeta Profesional ya existe en esta Clínica».',
                solucion: 'Ya hay una cuenta con ese correo (búscala en Usuarios) o un médico con esa cédula o tarjeta profesional.',
            },
            { sintoma: 'No aparece el servicio que necesito en «Servicio Adscrito».', solucion: 'Créalo primero en Servicios de Salud.' },
        ],
        relacionados: ['servicios', 'agenda', 'usuarios', 'espejo'],
        palabrasClave: ['doctores', 'especialistas', 'profesionales', 'plantilla médica', 'staff', 'agregar doctor', 'tarjeta profesional'],
    },
    {
        id: 'eps',
        href: '/dashboard/eps',
        titulo: 'Aseguradoras (EPS)',
        icono: '🏦',
        categoria: 'catalogos',
        resumen: 'Las EPS con las que la clínica tiene convenio y por las que el asistente puede agendar.',
        paraQueSirve:
            'Cuando un paciente agenda, el asistente le pregunta su EPS y la busca en esta lista. Una EPS activa permite agendar por ella (si la persona está en su padrón). Una EPS suspendida hace que el asistente no agende por ella. Aquí también ves cuántos pacientes y citas tiene cada una.',
        guias: [
            {
                titulo: 'Crear una EPS',
                pasos: [
                    'Pulsa «Nuevo Convenio».',
                    'Escribe el nombre como lo dicen los pacientes (por ejemplo «Sura», «Sanitas», «Mutual Ser») y, si lo tienes, el NIT.',
                    'Deja marcado «Convenio Activo Inmediatamente».',
                    'Guarda.',
                ],
            },
            {
                titulo: 'Suspender (inactivar) un convenio',
                pasos: ['Busca la EPS por nombre o NIT.', 'Apaga el interruptor de «Estado Operativo». Queda «Suspendida».'],
                nota: 'El asistente no agenda por una EPS suspendida y la Caja Negra lo registra como «EPS inactiva».',
            },
        ],
        elementos: [
            { nombre: 'NIT / Registro', explicacion: 'El NIT de la EPS, si lo registraste.' },
            { nombre: 'Métricas', explicacion: 'Pacientes afiliados (pctes.) y citas históricas de esa EPS.' },
            { nombre: 'Estado Operativo', explicacion: '«Vigente» o «Suspendida».' },
        ],
        preguntas: [
            {
                pregunta: '¿Por qué un paciente de una EPS activa no puede agendar?',
                respuesta:
                    'Lo más común: su cédula no está en el padrón de esa EPS (Padrón EPS), o la EPS no tiene convenio para su régimen (subsidiado o contributivo). La Caja Negra te dice el motivo exacto.',
            },
            {
                pregunta: '¿Puedo eliminar una EPS?',
                respuesta: 'Solo si no tiene pacientes ni citas. Si los tiene, suspéndela: deja de usarse y la historia se conserva.',
            },
        ],
        problemas: [
            { sintoma: 'Sale «Ya existe una EPS con ese nombre o NIT en esta clínica».', solucion: 'Búscala: quizá está suspendida. Actívala en vez de crear otra.' },
            {
                sintoma: 'La Caja Negra muestra «EPS no encontrada».',
                solucion: 'El paciente nombró una EPS que no existe aquí. Si hay convenio con ella, créala; si es otro nombre de una existente, revisa cómo está escrita.',
            },
            {
                sintoma: 'La Caja Negra muestra «EPS sin convenio para su régimen».',
                solucion: 'La combinación EPS y régimen no se puede facturar en esta clínica. Si debería poder, pide la revisión en Soporte.',
            },
        ],
        relacionados: ['padron', 'solicitudes-alta', 'agenda'],
        palabrasClave: ['aseguradoras', 'convenios', 'entidades', 'nit', 'régimen', 'subsidiado', 'contributivo', 'sura', 'sanitas', 'nueva eps'],
    },
    {
        id: 'padron',
        href: '/dashboard/padron',
        titulo: 'Padrón EPS (Altas)',
        icono: '🪪',
        categoria: 'catalogos',
        resumen: 'El listado de afiliados de cada EPS habilitados para agendar por su EPS. Se carga por archivo CSV o Excel.',
        paraQueSirve:
            'Solo quien está en el padrón de su EPS puede agendar por esa EPS con el asistente. Las citas particulares (pago directo) no lo necesitan. Cada archivo que cargas es un «corte»: reemplaza por completo el padrón activo de la EPS elegida, así que quien no venga en el corte queda inactivo.',
        guias: [
            {
                titulo: 'Cargar (subir) o actualizar el padrón de una EPS',
                pasos: [
                    'Si es la primera vez, descarga la «Plantilla CSV» para ver el formato.',
                    'Haz clic en el recuadro y elige el archivo .csv o .xlsx (máximo 6 MB). Solo es obligatoria la columna de cédula; régimen y teléfono son opcionales. Puede tener columnas de más o filas de título: se ignoran.',
                    'Elige la «EPS de este archivo». Si el archivo la menciona, se preselecciona sola: verifica que sea la correcta.',
                    'Pulsa «1. Validar archivo». No se toca nada todavía: solo ves el reporte.',
                    'Lee el reporte: afiliados listos, errores, advertencias y cuántos quedarían desactivados.',
                    'Si hay errores, corrige el archivo (o descarga el «reporte completo») y valida de nuevo.',
                    'Si todo está bien, pulsa «2. Importar corte».',
                ],
                nota: 'Un archivo es una EPS. Cambiar el archivo o la EPS obliga a validar otra vez. Puedes cargar el mismo archivo las veces que necesites.',
            },
            {
                titulo: 'Confirmar una baja masiva',
                pasos: [
                    'Si el corte desactivaría más del 10 % del padrón activo de esa EPS, aparece un aviso en amarillo.',
                    'Revisa que el archivo esté completo: un archivo incompleto daría de baja a mucha gente.',
                    'Si es correcto, marca «Confirmo que el archivo es correcto y completo…» e importa.',
                ],
            },
            {
                titulo: 'Buscar a una persona en el padrón',
                pasos: ['Escribe su cédula o nombre en «Buscar por cédula o nombre…».', 'Pulsa «Buscar». La tabla muestra su EPS, teléfono, estado y última actualización.'],
            },
            {
                titulo: 'Ver el historial de cargas',
                pasos: [
                    'Pulsa «Historial de cargas».',
                    'Filtra por EPS, fechas o «Solo cortes con rechazos».',
                    'En el buscador por documento ves en qué cortes apareció una persona y qué le pasó en cada uno (creado, actualizado, reactivado, rechazado…).',
                ],
            },
            {
                titulo: 'Vaciar el padrón de una EPS',
                pasos: [
                    'Abre «Vaciar padrón de una EPS».',
                    'Elige la EPS y qué borrar: todo, solo los activos o solo los inactivos.',
                    'Pulsa «Ver cuántos se eliminarían».',
                    'Escribe el nombre de la EPS para confirmar y pulsa «Eliminar definitivamente».',
                ],
                nota: 'Esto borra para siempre (no es una baja como la de un corte) y no se recupera recargando un archivo. Úsalo solo para limpiar errores.',
            },
        ],
        elementos: [
            { nombre: 'Pacientes en padrón / Dados de alta (activos)', explicacion: 'Total de registros y cuántos pueden agendar hoy.' },
            { nombre: 'De alta / Inactivo', explicacion: 'Activo: puede agendar por su EPS. Inactivo: no vino en el último corte.' },
            { nombre: 'Advertencias', explicacion: 'Líneas con cédula duplicada o inválida. No bloquean la importación: esas líneas se ignoran.' },
            { nombre: 'Errores', explicacion: 'Problemas que impiden importar. Hay que corregir el archivo.' },
            { nombre: '(nombre en el HIS)', explicacion: 'La persona está en el padrón pero su nombre lo tiene el sistema del hospital.' },
        ],
        preguntas: [
            {
                pregunta: '¿Qué pasa con alguien que estaba en el padrón y no viene en el nuevo archivo?',
                respuesta: 'Queda inactivo: ya no puede agendar por esa EPS. Si vuelve en un corte posterior, se reactiva.',
            },
            {
                pregunta: '¿Por qué no aparece mi EPS en la lista?',
                respuesta: 'Solo aparecen las EPS activas. Créala o actívala primero en Aseguradoras (EPS).',
            },
            {
                pregunta: '¿Mi archivo de Excel sirve tal cual?',
                respuesta: 'Sí, si es .xlsx. Si está en otro formato, ábrelo y usa Archivo › Guardar como › CSV UTF-8 o Excel (.xlsx). No puede estar protegido con contraseña.',
            },
        ],
        problemas: [
            {
                sintoma: 'Sale «Extensión no permitida».',
                solucion: 'Solo se aceptan .csv y .xlsx. Guarda el archivo en uno de esos formatos.',
            },
            {
                sintoma: 'Sale «… parece ser … no un CSV de texto».',
                solucion: 'El archivo tiene extensión .csv pero es otro formato. Expórtalo como «CSV UTF-8 (delimitado por comas)» o cárgalo como .xlsx.',
            },
            { sintoma: 'Sale «El archivo supera el tamaño máximo permitido (6 MB)».', solucion: 'Quita columnas que no se usan (solo hace falta la cédula) o divide el archivo.' },
            { sintoma: 'El botón «2. Importar corte» no se activa.', solucion: 'Primero valida sin errores. Si hay aviso de baja masiva, marca la confirmación.' },
        ],
        relacionados: ['eps', 'solicitudes-alta', 'auditoria'],
        palabrasClave: ['afiliados', 'altas', 'listado', 'base de datos', 'cargar archivo', 'csv', 'excel', 'importar', 'corte', 'censo', 'habilitar pacientes'],
    },

    // ── Indicadores ───────────────────────────────────────────
    {
        id: 'analiticas',
        href: '/dashboard/analytics',
        titulo: 'Analíticas de Negocio',
        icono: '📊',
        categoria: 'indicadores',
        resumen: 'Indicadores de las citas: total, completadas, canceladas, y cómo se reparten por especialidad, EPS, origen y día.',
        paraQueSirve:
            'Responde preguntas de gestión: qué especialidad se pide más, qué EPS mueve más citas, cuántas llegan por el asistente frente a las del personal o del hospital, y cómo va el volumen día a día. Las cifras se calculan con la fecha de la cita, no con la fecha en que se agendó.',
        guias: [
            {
                titulo: 'Ver un periodo concreto',
                pasos: ['Elige la «Fecha Inicio» y la «Fecha Fin».', 'Pulsa «Filtrar».', 'Para volver a ver todo, pulsa la X («Limpiar filtros»).'],
                nota: 'Los días se cuentan completos en hora de Colombia.',
            },
        ],
        elementos: [
            { nombre: 'Total Citas', explicacion: 'Todas las citas del periodo, en cualquier estado.' },
            {
                nombre: 'Completadas',
                explicacion: 'Citas que el sistema cerró como completadas. Marcar «✅ Asistió» en Visión General no las suma aquí: la asistencia se guarda aparte.',
            },
            { nombre: 'Canceladas', explicacion: 'Citas anuladas por el paciente, el personal o el hospital.' },
            { nombre: 'Demanda por Especialidad', explicacion: 'Barras con las citas de cada servicio.' },
            { nombre: 'Volumen de Agendamiento (Diario)', explicacion: 'Citas por día de la cita.' },
            { nombre: 'Cuota de Mercado por EPS', explicacion: 'Reparto de citas por EPS. «Particular / Sin EPS» agrupa las citas sin EPS.' },
            { nombre: 'Origen de la Cita', explicacion: 'WHATSAPP, TELEGRAM, MANUAL (personal) y MIRROR (agendadas en el hospital).' },
        ],
        preguntas: [
            {
                pregunta: '¿Por qué el total no es igual a Completadas más Canceladas?',
                respuesta: 'Porque el total también cuenta las citas vigentes (programadas), que todavía no tienen un cierre.',
            },
            {
                pregunta: '¿Qué diferencia hay con Canales en vivo?',
                respuesta: 'Analíticas mira las citas. Canales en vivo mira las conversaciones de WhatsApp y Telegram: quién escribe, cuántos agendan y dónde se pierden.',
            },
            {
                pregunta: '¿Incluye las citas agendadas en el hospital?',
                respuesta: 'Sí. Aparecen con origen MIRROR.',
            },
        ],
        problemas: [
            {
                sintoma: 'Sale «No pudimos cargar la información de analíticas».',
                solucion: 'El servicio de AgenIA no respondió. Recarga en un minuto; si sigue igual, repórtalo en Soporte.',
            },
            { sintoma: 'Una gráfica dice «Sin datos».', solucion: 'No hay citas en ese periodo. Amplía las fechas.' },
        ],
        relacionados: ['canales', 'encuestas', 'vision-general'],
        palabrasClave: ['estadísticas', 'métricas', 'indicadores', 'kpi', 'reportes', 'informes', 'gráficas', 'business intelligence', 'bi', 'tendencias'],
    },
    {
        id: 'canales',
        href: '/dashboard/canales',
        titulo: 'Canales en vivo',
        icono: '📈',
        categoria: 'indicadores',
        resumen: 'WhatsApp y Telegram en cifras, actualizadas cada 30 segundos: quién escribe, cuántos agendan y dónde se pierden.',
        paraQueSirve:
            'Muestra lo que está pasando en las conversaciones del asistente. Te sirve para detectar a tiempo un problema (si sube «Con problema»), medir cuántos de los que escriben terminan con cita (la conversión) y saber a qué horas hay más movimiento. Mirar esta pantalla no gasta inteligencia artificial: solo cuenta lo que ya está en la base de datos.',
        guias: [
            {
                titulo: 'Elegir el periodo',
                pasos: ['Pulsa «Hoy», «Semana», «Mes» o «Año».', 'Para otras fechas, pulsa «Personalizado» y elige desde y hasta (la inicial no puede ser posterior a la final).'],
            },
            {
                titulo: 'Pausar o actualizar las cifras',
                pasos: [
                    'El punto verde «En vivo» indica que se actualiza cada 30 segundos mientras la pestaña está visible.',
                    'Pulsa ⏸ para pausar (útil para analizar sin que cambien los números) y ▶ para reanudar.',
                    'Pulsa ⟳ para actualizar en el momento.',
                ],
            },
            {
                titulo: 'Leer la gráfica de un canal',
                pasos: [
                    'Cada canal tiene cuatro líneas: personas escribiendo, citas pedidas, escribieron y no agendaron, y con problema.',
                    'Haz clic en un nombre de la leyenda para ocultar o mostrar su línea.',
                    'Pulsa «Ver tabla» para ver los números exactos de cada tramo.',
                ],
            },
        ],
        elementos: [
            { nombre: 'Personas escribiendo', explicacion: 'Personas distintas que le escribieron al bot. Debajo, el total de mensajes.' },
            { nombre: 'Citas pedidas', explicacion: 'Citas agendadas por ese canal. «Conversión» es el porcentaje de quienes escribieron que agendó.' },
            { nombre: 'Escribieron y no agendaron', explicacion: 'Personas sin cita. No cuenta a quien vino a cancelar o reprogramar.' },
            { nombre: 'Con problema', explicacion: 'Personas con un fallo del bot o que abandonaron tras los reintentos.' },
            { nombre: 'Vinieron a gestionar una cita', explicacion: 'Personas que vinieron a cancelar o reprogramar.' },
            { nombre: 'Embudo de la conversación', explicacion: 'De quienes escribieron: cuántos agendaron, gestionaron una cita o no agendaron.' },
            { nombre: '¿Qué pasó con las citas pedidas?', explicacion: 'Su estado actual: vigentes, atendidas, canceladas o no asistió.' },
            { nombre: 'Principales motivos de fallo', explicacion: 'Los 8 motivos más frecuentes, por canal.' },
            { nombre: 'Horas pico', explicacion: 'Mensajes por día de la semana y hora, de los dos canales juntos.' },
        ],
        preguntas: [
            {
                pregunta: '¿Por qué «Qué vinieron a hacer» y los motivos de fallo no muestran fechas antiguas?',
                respuesta: 'Vienen de la Caja Negra del bot, que guarda un número limitado de días. La nota de cada tarjeta dice cuántos.',
            },
            {
                pregunta: '¿Qué diferencia hay con la Caja Negra?',
                respuesta: 'Canales en vivo cuenta. La Caja Negra te muestra cada caso para que puedas contactar al paciente.',
            },
        ],
        problemas: [
            { sintoma: 'Crecen los casos de «Sin agenda disponible».', solucion: 'Abre más cupos en Agendas (Slots) o revisa los médicos con «Reservas por WhatsApp» apagado.' },
            { sintoma: 'Crecen los casos de «No está en el padrón de la EPS».', solucion: 'Actualiza el padrón de esa EPS y revisa las Solicitudes de Alta.' },
            { sintoma: 'Aparece «IA no disponible».', solucion: 'Ve a Configuración › Integraciones y pulsa «Probar Servicio» en Salud de la Conexión.' },
            { sintoma: 'Aparece «Error enviando la respuesta».', solucion: 'Revisa el canal de WhatsApp (token de Meta) en Configuración › Integraciones.' },
        ],
        relacionados: ['auditoria', 'analiticas', 'configuracion'],
        palabrasClave: ['conversaciones', 'mensajes', 'tiempo real', 'monitor', 'conversión', 'embudo', 'horas pico', 'whatsapp', 'telegram', 'estadísticas del bot'],
    },
    {
        id: 'encuestas',
        href: '/dashboard/configuracion/integraciones/surveys',
        titulo: 'Encuestas (CSAT)',
        icono: '⭐',
        categoria: 'indicadores',
        resumen: 'Las calificaciones de 1 a 5 estrellas que dejan los pacientes sobre el asistente virtual.',
        paraQueSirve:
            'Cuando una conversación con el asistente se cierra (por ejemplo, tras agendar, cancelar o cambiar una cita, o al quedar en lista de espera), el asistente le envía al paciente un enlace de un solo uso para calificar la atención. Aquí ves cada respuesta: quién, su teléfono, las estrellas, su ánimo y su comentario.',
        guias: [
            {
                titulo: 'Revisar las opiniones',
                pasos: [
                    'Ordena por «Calificación» para ver primero las peores (pulsa el encabezado; otra vez para invertir).',
                    'Ordena por «Fecha» para ver las más recientes.',
                    'Pasa el cursor sobre un mensaje largo para leerlo completo.',
                    'Pulsa «Refrescar» para traer las nuevas.',
                ],
            },
        ],
        elementos: [
            { nombre: 'Calificación', explicacion: 'De 1 a 5 estrellas, con el ánimo detectado (Feliz, Neutral o Negativo).' },
            { nombre: 'Mensaje', explicacion: 'El comentario libre del paciente, si dejó uno.' },
        ],
        preguntas: [
            {
                pregunta: '¿A quién se le envía la encuesta?',
                respuesta: 'A quien cierra una gestión con el asistente: agendó, canceló, cambió la fecha o quedó en lista de espera. Nunca a quien reportó una posible emergencia. El enlace vale 24 horas y se usa una vez.',
            },
            {
                pregunta: '¿Puedo responderle al paciente?',
                respuesta: 'No desde esta pantalla. Si un comentario lo amerita, usa el teléfono de la fila.',
            },
        ],
        problemas: [{ sintoma: 'Sale «No se pudieron cargar las encuestas de tu clínica».', solucion: 'Pulsa «Refrescar». Si sigue, repórtalo en Soporte.' }],
        relacionados: ['canales', 'analiticas'],
        palabrasClave: ['satisfacción', 'calificaciones', 'estrellas', 'opiniones', 'comentarios', 'feedback', 'nps', 'calidad'],
    },

    // ── Administración ────────────────────────────────────────
    {
        id: 'limites-citas',
        href: '/dashboard/limites-citas',
        titulo: 'Límite de citas',
        icono: '🚦',
        categoria: 'administracion',
        resumen: 'Cuántas citas puede tener un mismo paciente por el asistente: un máximo por día y otro por mes.',
        paraQueSirve:
            'Evita que una misma persona acapare los cupos del asistente. Si un paciente ya tiene el máximo de citas para ese día o ese mes, el asistente no le agenda otra (ni le asigna un cupo de la lista de espera, ni le cambia una cita a esa fecha): le pide disculpas, le da el teléfono del hospital y le envía un enlace para pedir una revisión, que llega a Solicitudes de más citas. Al empezar vienen encendidos con 1 cita al día y 3 al mes.',
        guias: [
            {
                titulo: 'Cambiar el máximo de citas',
                pasos: [
                    'En «Citas por paciente en un mismo día» o «en un mismo mes», escribe el máximo en «Máximo de citas por día / por mes».',
                    'Revisa a la derecha el «Mensaje que recibe el paciente».',
                    'Pulsa «Guardar cambios».',
                ],
                nota: 'Aplica desde el siguiente mensaje que reciba el asistente, sin reiniciar nada. El día va de 1 a 10 y el mes de 1 a 31.',
            },
            {
                titulo: 'Apagar o encender un límite',
                pasos: ['Pulsa el interruptor del límite (día o mes): verde es encendido.', 'Pulsa «Guardar cambios».'],
                nota: 'Con un límite apagado el asistente no revisa cuántas citas tiene el paciente en ese periodo. Los dos son independientes.',
            },
        ],
        elementos: [
            { nombre: 'Veces que se aplicó el límite', explicacion: 'Cuántas veces en los últimos 30 días el asistente frenó una cita o un cambio de fecha por el límite.' },
            { nombre: 'Solicitudes radicadas / Pendientes por revisar', explicacion: 'Cuántos pacientes pidieron revisión en 30 días y cuántas esperan decisión. La tarjeta de pendientes lleva a Solicitudes de más citas.' },
            { nombre: 'Mensaje que recibe el paciente', explicacion: 'Un ejemplo de lo que le escribe el asistente, con los valores que estás editando.' },
            { nombre: 'Cómo se cuenta', explicacion: 'Las reglas del conteo y quién hizo el último cambio y cuándo.' },
        ],
        preguntas: [
            {
                pregunta: '¿Se cuenta por el día en que pidió la cita o por el día de la cita?',
                respuesta: 'Por el día de la cita. «Una cita al día» quiere decir una cita para el mismo día; el mes es el del calendario (del 1 al último día).',
            },
            {
                pregunta: '¿Qué citas cuentan?',
                respuesta: 'Todas las citas vigentes del paciente en la clínica, agendadas o ya atendidas, sin importar si las agendó el asistente, el personal o el hospital. Las canceladas no cuentan.',
            },
            {
                pregunta: '¿El personal también tiene este límite?',
                respuesta: 'No. Solo el asistente (WhatsApp y Telegram). Desde Agendamiento se puede agendar sin límite, por ejemplo después de aprobar una solicitud.',
            },
            {
                pregunta: '¿Qué teléfono le da el asistente al paciente?',
                respuesta: 'El teléfono de soporte de la clínica. Si no está registrado, la pantalla lo avisa en amarillo y el asistente dice «comuníquese con el hospital», sin número.',
            },
            {
                pregunta: '¿Quién puede cambiarlo?',
                respuesta: 'El administrador y el agente de reservas. Debajo de la pantalla queda quién hizo el último cambio y cuándo.',
            },
        ],
        problemas: [
            {
                sintoma: 'Un paciente dice que no tiene citas y el asistente no lo deja agendar.',
                solucion: 'Búscalo en Rastreo de paciente: puede tener una cita de ese día o mes agendada por el hospital o por el personal, y esas también cuentan.',
            },
            {
                sintoma: 'El botón «Guardar cambios» está gris.',
                solucion: 'No hay cambios por guardar: modifica un valor o un interruptor primero.',
            },
        ],
        relacionados: ['solicitudes-citas', 'configuracion', 'rastreo'],
        palabrasClave: ['tope de citas', 'máximo de citas', 'una cita al día', 'tres citas al mes', 'restricción', 'acaparar cupos', 'cuota', 'límite diario', 'límite mensual'],
    },
    {
        id: 'configuracion',
        href: '/dashboard/configuracion',
        titulo: 'Configuración',
        icono: '⚙️',
        categoria: 'administracion',
        resumen: 'El asistente virtual (nombre, tono, voz y qué puede hacer el paciente), sus canales y la información que comparte.',
        paraQueSirve:
            'Tiene tres pestañas. «Asistente Virtual»: qué puede hacer el paciente por WhatsApp o Telegram, los recordatorios, el nombre, el tono, cuántas horas ofrece y la voz. «Integraciones (IA y Canales)»: el proveedor de inteligencia artificial, WhatsApp, sus plantillas y Telegram. «Base de Conocimiento»: lo que el asistente responde sobre la clínica.',
        guias: [
            {
                titulo: 'Decidir qué puede hacer el paciente con el asistente',
                pasos: [
                    'Abre la pestaña «Asistente Virtual».',
                    'Enciende o apaga «Agendar citas por el asistente», «Cancelar citas por el asistente» y «Cambiar la fecha de una cita por el asistente».',
                    'Cada interruptor se guarda al instante y aplica desde el siguiente mensaje del paciente.',
                ],
                nota: 'Con una operación apagada, el asistente le dice al paciente que se comunique con el hospital y qué sí puede hacer por ahí. Con las tres apagadas, solo consulta citas. Si la clínica está conectada al hospital, cada interruptor manda en todo: encendido, la operación se hace por el asistente y desde el panel y llega al sistema del hospital (el asistente solo le confirma al paciente cuando el hospital lo registró); apagado, no se puede hacer en AgenIA —ni por el asistente ni desde el panel— y se hace directamente en el sistema del hospital. Cada cambio queda en la auditoría del espejo. Sin conexión al hospital, el personal sigue haciendo todo desde el panel.',
            },
            {
                titulo: 'Encender o apagar los recordatorios automáticos',
                pasos: [
                    'En «Asistente Virtual», usa el interruptor «Recordatorios automáticos de citas».',
                    'Aplica de inmediato. Al encenderlos, las citas que aún estén dentro del plazo reciben el suyo.',
                ],
                nota: 'Fuera de las 24 horas de conversación, WhatsApp exige la plantilla «Recordatorio de cita» (pestaña Integraciones).',
            },
            {
                titulo: 'Enviar recordatorios solo a quien agendó por el chat',
                pasos: [
                    'En «Asistente Virtual», usa el interruptor «Recordatorios solo a pacientes que agendaron ellos mismos».',
                    'Encendido, el recordatorio automático solo sale para las citas que el paciente agendó por WhatsApp o Telegram. Las que agendó el personal desde el panel o el hospital no lo reciben.',
                    'Aplica de inmediato. Si lo apagas, las citas que aún estén dentro del plazo reciben el suyo.',
                ],
                nota: 'Solo funciona con los recordatorios automáticos encendidos. No cambia nada más: las citas se agendan, cancelan y atienden igual, y el botón de recordatorio manual de Visión General sigue sirviendo para cualquier cita.',
            },
            {
                titulo: 'Cambiar el nombre, el tono y las horas que ofrece el asistente',
                pasos: [
                    'En «Asistente Virtual», escribe el «Nombre del asistente virtual» (hasta 40 caracteres).',
                    'Elige el tono: «Formal» (trato de usted, opciones A/B/C) o «Informal» (trato de tú, conversacional). La vista previa muestra cómo se verá.',
                    'En «Horarios que ofrece el asistente», elige cuántas opciones de cita muestra (entre 2 y 12; se recomiendan 6). Se reparten entre mañana y tarde.',
                    'Pulsa «Guardar configuración».',
                ],
            },
            {
                titulo: 'Configurar la voz del asistente',
                pasos: [
                    'En «Asistente Virtual», baja a «Voz del asistente».',
                    'Elige el género de la voz y el proveedor: ElevenLabs (más natural, requiere clave de API de la clínica) o Google Cloud TTS (siempre disponible).',
                    'Ajusta la voz, el tono y la velocidad si quieres.',
                    'Pulsa «Guardar configuración de voz» y luego pruébala: verás la latencia y si el audio se generó.',
                ],
                nota: 'Si ElevenLabs falla (sin cuota o sin respuesta), el asistente usa Google automáticamente.',
            },
            {
                titulo: 'Conectar la inteligencia artificial',
                pasos: [
                    'Abre la pestaña «Integraciones (IA y Canales)».',
                    'En «Integración de IA», elige el proveedor: Google Gemini, OpenAI ChatGPT o Anthropic Claude.',
                    'Pega la clave de API y elige el modelo.',
                    'Pulsa «Guardar integración» y luego «Probar Servicio» en «Salud de la Conexión».',
                ],
                nota: 'La clave se guarda cifrada y nunca se vuelve a mostrar: solo sus últimos 4 caracteres. Para Gemini hay una guía paso a paso en /guia/google-ai-studio.',
            },
            {
                titulo: 'Conectar WhatsApp (Meta)',
                pasos: [
                    'En «Integraciones», ve a «Canal de WhatsApp (Meta)».',
                    'Escribe el Phone Number ID y el WhatsApp Business Account ID (están en Meta for Developers › tu App › WhatsApp).',
                    'Pega el Access Token permanente (de un System User; empieza por EAA…) y el App Secret.',
                    'Copia el Verify Token y pégalo en Meta › Webhook al configurar la suscripción.',
                    'Pulsa «Guardar canal de WhatsApp» y verifícalo en «Salud de la Conexión».',
                ],
                nota: 'Hay una guía completa en /guia/whatsapp.',
            },
            {
                titulo: 'Registrar las plantillas de WhatsApp',
                pasos: [
                    'Crea y haz aprobar la plantilla en Meta.',
                    'En «Plantillas de WhatsApp», escribe en el tipo correspondiente el nombre exacto que aprobó Meta (solo minúsculas, números y guión bajo) y el idioma (por ejemplo «es»).',
                    'Respeta el orden de las variables que indica cada tipo: Meta lo valida al enviar.',
                    'Guarda.',
                ],
                nota: 'Tipos: Recordatorio de cita, Oferta de cupo (lista de espera; hoy ningún proceso la usa), Aviso de cancelación y Recordatorio masivo (avisos masivos), Aviso al agendador (Bandeja de sincronización) y Confirmación de una cita del hospital (Rastreo).',
            },
            {
                titulo: 'Conectar Telegram',
                pasos: [
                    'En Telegram, abre @BotFather, crea un bot con el nombre que verán tus pacientes y un usuario que termine en «bot».',
                    'Copia el token que te da BotFather.',
                    'En «Canal de Telegram», pégalo y pulsa «Conectar bot de Telegram».',
                    'Comparte el enlace o imprime el código QR para la sede.',
                ],
                nota: 'Si la tarjeta dice que Telegram no está habilitado en este servidor, el equipo de AgenIA debe activarlo primero.',
            },
            {
                titulo: 'Escribir la base de conocimiento',
                pasos: [
                    'Abre la pestaña «Base de Conocimiento».',
                    'Escribe la información de la clínica por secciones: horarios, dirección, urgencias, tarifas, EPS con convenio, teléfonos, protocolos de visita.',
                    'Pulsa «Guardar Base de Conocimiento».',
                ],
                nota: 'El asistente solo responde lo que está escrito aquí: no inventa datos. Si está vacía, responde que no tiene información disponible.',
            },
        ],
        elementos: [
            { nombre: 'Salud de la Conexión', explicacion: 'Prueba en el momento si la IA y Meta responden con las credenciales guardadas. No envía mensajes.' },
            { nombre: 'Estado actual', explicacion: 'El proveedor, el modelo y los últimos 4 caracteres de la clave guardada.' },
            { nombre: 'Configurada / Sin configurar', explicacion: 'Estado de cada plantilla de WhatsApp.' },
        ],
        preguntas: [
            {
                pregunta: '¿Por qué WhatsApp necesita plantillas?',
                respuesta:
                    'WhatsApp solo deja enviar texto libre en las 24 horas siguientes al último mensaje del paciente. Fuera de ese plazo (por ejemplo, un recordatorio del día anterior) hay que usar una plantilla aprobada por Meta.',
            },
            {
                pregunta: 'Con «recordatorios solo a pacientes que agendaron ellos mismos», ¿qué citas no reciben recordatorio?',
                respuesta:
                    'Las que agendó el personal desde el panel y las que llegaron del sistema del hospital. Una cita que el paciente agendó por el chat lo sigue recibiendo aunque después el personal le cambie la fecha.',
            },
            {
                pregunta: '¿El tono cambia lo que hace el asistente?',
                respuesta: 'No. Solo cambia el lenguaje y la forma de los mensajes; las reglas de agendamiento son las mismas.',
            },
            {
                pregunta: '¿WhatsApp y Telegram son pacientes distintos?',
                respuesta: 'No. Es el mismo asistente en los dos canales y la ficha del paciente es una sola.',
            },
        ],
        problemas: [
            {
                sintoma: 'La prueba de IA falla.',
                solucion: 'Revisa la clave de API (que no esté vencida ni sin saldo) y el modelo elegido. Copia el error con el botón del resultado y repórtalo en Soporte si no se aclara.',
            },
            {
                sintoma: 'La prueba de Meta falla.',
                solucion: 'El Access Token pudo vencer o el Phone Number ID es incorrecto. Usa un token permanente de un System User.',
            },
            {
                sintoma: 'El asistente no les responde a los pacientes.',
                solucion:
                    'Pulsa «Probar Servicio» en Salud de la Conexión: si falla la IA, revisa la clave de API; si falla Meta, renueva el Access Token. Mira también la Caja Negra (motivos «IA caída», «Error de WhatsApp» o «Token Meta expirado») y que el canal esté guardado.',
            },
            {
                sintoma: 'Sale «No pudimos cargar…» en una sección.',
                solucion: 'Las demás secciones siguen funcionando. Recarga la página; si persiste, repórtalo en Soporte.',
            },
            {
                sintoma: 'Telegram dice que no logra entregar los mensajes al servidor.',
                solucion: 'Pulsa «Verificar conexión». Si sigue, avisa al equipo técnico desde Soporte.',
            },
        ],
        relacionados: ['canales', 'encuestas', 'vision-general', 'espejo'],
        palabrasClave: ['ajustes', 'chatbot', 'bot', 'asistente', 'whatsapp', 'telegram', 'meta', 'token', 'gemini', 'openai', 'claude', 'voz', 'audio', 'plantillas', 'base de conocimiento', 'preguntas frecuentes', 'faq', 'tono', 'recordatorios'],
    },
    {
        id: 'usuarios',
        href: '/dashboard/usuarios',
        titulo: 'Usuarios',
        icono: '👥',
        categoria: 'administracion',
        resumen: 'Las cuentas de acceso del personal y de los pacientes: correo, contraseña y rol.',
        paraQueSirve:
            'Cada persona que entra al panel tiene un usuario con un rol que decide qué ve. Aquí creas cuentas, cambias contraseñas y roles, y limitas a los agentes de reservas a una EPS o a un médico.',
        guias: [
            {
                titulo: 'Crear un usuario',
                pasos: [
                    'Pulsa «+ Nuevo Usuario».',
                    'Escribe el correo y una contraseña segura.',
                    'Elige el «Rol de Acceso».',
                    'Si es «Agente Reservas», escribe su nombre completo y, si quieres, limítalo a una EPS o a un médico.',
                    'Pulsa «Guardar Credencial».',
                ],
                nota: 'Para crear un médico con su perfil completo (servicio, tarjeta profesional), es mejor usar la opción Médicos.',
            },
            {
                titulo: 'Cambiar la contraseña de un usuario',
                pasos: ['Pulsa ✏️ en su fila.', 'Escribe la nueva contraseña (si la dejas en blanco, no cambia).', 'Pulsa «Guardar Credencial».'],
            },
            {
                titulo: 'Encontrar un usuario',
                pasos: ['Escribe su correo, nombre o documento en el buscador.', 'Si quieres, filtra por rol.'],
            },
        ],
        elementos: [
            { nombre: 'Rol Asignado', explicacion: 'Administrador, Médico Especialista, Paciente o Agente de Reservas.' },
            {
                nombre: 'Perfiles Vinculados',
                explicacion: '🏥 Paciente, 🩺 Médico o 🎧 Agente. En los agentes se ve su límite (una EPS, un médico) o 🌐 GLOBAL. «Solo Credenciales» = cuenta sin perfil.',
            },
            { nombre: '🗑️ Eliminar', explicacion: 'Borra la cuenta y sus perfiles. No se puede deshacer.' },
        ],
        preguntas: [
            {
                pregunta: '¿Qué ve cada rol?',
                respuesta:
                    'Administrador: todas las opciones. Agente de Reservas: Visión General, Agendamiento, Rastreo y Soporte (más la Bandeja de sincronización y los Avisos masivos si la clínica los tiene). Médico: su agenda, Rastreo y Soporte. Paciente: sus citas y Soporte.',
            },
            {
                pregunta: '¿Para qué limitar a un agente por EPS o por médico?',
                respuesta: 'Para que solo vea y agende las citas de esa EPS o de ese médico. Con los límites en «Global», puede ver y agendar cualquier cita.',
            },
        ],
        problemas: [
            {
                sintoma: 'Una persona del personal no puede entrar al panel (olvidó la contraseña).',
                solucion: 'Búscala aquí por su correo, pulsa ✏️, escríbele una contraseña nueva y guarda. Compártesela por un medio seguro.',
            },
            { sintoma: 'Al guardar sale un error de correo repetido.', solucion: 'Ya existe una cuenta con ese correo. Búscala y edítala.' },
            {
                sintoma: 'No puedo crear o editar un usuario con el rol «Administrador».',
                solucion: 'Si al guardar aparece un error con ese rol, repórtalo en Soporte para que el equipo técnico lo cree o lo corrija.',
            },
        ],
        relacionados: ['medicos', 'soporte'],
        palabrasClave: ['cuentas', 'accesos', 'credenciales', 'login', 'contraseña', 'clave', 'roles', 'permisos', 'agente de reservas', 'personal', 'staff'],
    },
    {
        id: 'soporte',
        href: '/dashboard/soporte',
        titulo: 'Soporte',
        icono: '🛟',
        categoria: 'administracion',
        resumen: 'Reporta una falla o haz una solicitud al equipo técnico de AgenIA y sigue su estado.',
        paraQueSirve:
            'Cuando algo no funciona como esperas o necesitas un cambio que no puedes hacer desde el panel, abres una solicitud. El equipo técnico la toma, la atiende y te deja una respuesta. Desde esta misma página entras a este centro de ayuda con el botón «Ayuda».',
        guias: [
            {
                titulo: 'Reportar una falla o hacer una solicitud',
                pasos: [
                    'Pulsa «Reportar Falla / Nueva Solicitud».',
                    'Escribe un título claro (mínimo 5 caracteres), por ejemplo «No puedo cargar la agenda del Dr. Pérez».',
                    'En «Detalles del problema» (mínimo 15 caracteres), cuenta qué esperabas, qué pasó, los pasos para repetirlo y el mensaje de error si hubo.',
                    'Pulsa «Enviar solicitud».',
                ],
                nota: 'Mientras más detalle, más rápida la atención. Antes de escribir, busca aquí en la ayuda: quizá la respuesta ya está.',
            },
            {
                titulo: 'Seguir una solicitud',
                pasos: [
                    'Mira las cifras de arriba: Abiertas, En atención y Solucionadas.',
                    'Cada tarjeta muestra su estado y cuándo la reportaste.',
                    'Cuando está solucionada, aparece la «Respuesta del equipo de soporte».',
                    'Pulsa «Ver detalles completos» para leer todo lo que escribiste.',
                ],
            },
        ],
        elementos: [
            { nombre: 'Abierto', explicacion: 'Nadie la ha tomado todavía.' },
            { nombre: 'En atención', explicacion: 'Alguien del equipo técnico la está trabajando (con la hora en que empezó).' },
            { nombre: 'Solucionada', explicacion: 'Resuelta, con la respuesta del equipo.' },
            { nombre: 'Ayuda', explicacion: 'Abre este centro de ayuda.' },
        ],
        preguntas: [
            { pregunta: '¿Quién ve mis solicitudes?', respuesta: 'Tú y el equipo técnico de AgenIA.' },
            {
                pregunta: '¿Puedo agregar algo a una solicitud ya enviada?',
                respuesta: 'Todavía no. Si se te olvidó algo importante, abre otra solicitud y menciona la anterior en el título.',
            },
        ],
        problemas: [
            { sintoma: 'Sale «Revisa el formulario».', solucion: 'El título necesita al menos 5 caracteres y los detalles al menos 15.' },
            { sintoma: 'Sale «No se pudieron cargar tus solicitudes».', solucion: 'Recarga la página en un momento.' },
        ],
        relacionados: ['primeros-pasos', 'glosario'],
        palabrasClave: ['ticket', 'ayuda', 'reportar', 'falla', 'error', 'bug', 'incidente', 'mesa de ayuda', 'contactar soporte', 'equipo técnico'],
    },

    // ── Conexión con el hospital ──────────────────────────────
    {
        id: 'espejo',
        href: '/dashboard/espejo',
        titulo: 'Espejo con el HIS',
        icono: '🪞',
        categoria: 'hospital',
        resumen: 'El estado de la conexión entre AgenIA y el sistema del hospital (HIS): si el agente está vivo, si las citas llegan y si la agenda coincide.',
        paraQueSirve:
            'El espejo mantiene sincronizadas las citas entre AgenIA y el sistema del hospital. Lo que se agenda por WhatsApp viaja al hospital, y lo que se agenda en ventanilla llega a AgenIA. Esta pantalla responde con semáforos: ¿el agente del hospital está vivo y alcanza el HIS?, ¿hay algo que no llegó?, ¿la agenda coincide? Y te da los controles de emergencia.',
        disponibilidad: CON_ESPEJO,
        guias: [
            {
                titulo: 'Revisar que la conexión esté sana',
                pasos: [
                    'Mira los semáforos de arriba: «Agente en la VM del hospital», «Citas en camino al hospital», «Agenda» y «Los dos sistemas coinciden».',
                    'Verde: todo bien. Amarillo: atención. Rojo: hay que actuar; el texto dice por qué.',
                ],
            },
            {
                titulo: 'Detener la escritura en el hospital (emergencia)',
                pasos: [
                    'En Configuración, apaga «Agendar citas», «Cancelar citas» y «Cambiar la fecha de una cita»: cada uno es la compuerta de su operación hacia el hospital.',
                    'Desde ese momento esas operaciones no se pueden hacer en AgenIA, ni por el asistente ni desde el panel: se hacen directamente en el sistema del hospital. Nada queda en cola.',
                    'En el Espejo, el recuadro «Qué escribe AgenIA en el sistema del hospital» muestra cómo quedó cada una.',
                ],
                nota: 'Se pueden apagar y encender por separado, para salir a producción de a una operación. Aunque estén apagadas, sigue entrando lo que viene del hospital (su agenda y las citas de ventanilla).',
            },
            {
                titulo: 'Reintentar un evento que no llegó al hospital',
                pasos: [
                    'Baja a «Eventos que no llegaron al hospital» (se reintentaron diez veces y se rindieron).',
                    'Lee el motivo del último fallo.',
                    'Corrige la causa (por ejemplo, homologa al médico) y pulsa «Reintentar».',
                    'El agente lo vuelve a intentar en su próxima vuelta.',
                ],
            },
            {
                titulo: 'Cambiar el modo de agenda (OFF, SHADOW, ON)',
                pasos: [
                    'OFF: la agenda es la de AgenIA (cupos creados a mano).',
                    'SHADOW: se calcula la agenda real del hospital y se reportan las diferencias, sin cambiar lo que ve el paciente.',
                    'ON: la agenda de AgenIA pasa a ser la del hospital.',
                    'Elige el modo y confirma. El agente lo aplica en su próxima vuelta (hasta 15 minutos).',
                ],
                nota: 'Pasar a ON es una decisión de negocio: se recomienda revisar al menos una semana en SHADOW antes.',
            },
            {
                titulo: 'Homologar los médicos del hospital',
                pasos: [
                    'Pulsa «Homologar médicos →».',
                    'Busca el médico del HIS por código, nombre o cargo.',
                    'Elige con qué médico de AgenIA se empareja y vincúlalo.',
                ],
                nota: 'Sin este paso el médico no recibe cupos ni citas del hospital; es intencional, lo decide una persona. Al desvincular, los cupos ya creados no se borran solos.',
            },
            {
                titulo: 'Consultar la auditoría detallada',
                pasos: [
                    'Pulsa «Ver auditoría detallada →».',
                    'En «Auditoría» ves cada evento entre los dos sistemas (dirección, operación, resultado).',
                    'En «Cola de salida» ves lo que AgenIA envió al hospital: pendiente, entregado o rendido.',
                    'Filtra y abre una fila para ver el detalle.',
                ],
            },
        ],
        elementos: [
            { nombre: 'Agente en la VM del hospital', explicacion: 'Programa instalado en un servidor del hospital que lleva y trae la información. Debe latir cada pocos minutos y alcanzar el HIS.' },
            { nombre: 'Citas en camino al hospital', explicacion: 'Eventos en cola o rendidos. Verde si todo lo de WhatsApp llegó.' },
            { nombre: 'Agenda', explicacion: 'El modo actual (OFF, SHADOW u ON) y los cupos futuros.' },
            { nombre: 'Los dos sistemas coinciden', explicacion: 'Resultado de la última comparación completa entre AgenIA y el hospital.' },
            { nombre: 'Conflictos recientes', explicacion: 'Situaciones que el sistema no resuelve solo, a propósito, porque afectan a un paciente concreto.' },
            { nombre: 'Resultados de auditoría', explicacion: 'OK, SKIPPED (no aplica, por ejemplo un médico no homologado), CONFLICT, ERROR y DEAD_LETTER (se rindió).' },
        ],
        preguntas: [
            {
                pregunta: '¿Qué hago si el agente no da señales?',
                respuesta: 'El programa del hospital no está corriendo o el servidor perdió internet. Avisa al área de sistemas del hospital y repórtalo en Soporte.',
            },
            {
                pregunta: '¿Las citas de ventanilla llegan a AgenIA?',
                respuesta: 'Sí: una cita agendada en el hospital crea la cita (y el paciente, si no existe) en AgenIA. Aparece con la insignia «🏥 Hospital».',
            },
        ],
        problemas: [
            {
                sintoma: '«El agente está vivo pero NO alcanza el sistema del hospital».',
                solucion: 'El HIS no responde al agente. Ninguna cita se está espejando. Avisa a sistemas del hospital.',
            },
            {
                sintoma: '«Los dos sistemas no coinciden».',
                solucion: 'Revisa los conflictos recientes y la Bandeja de sincronización.',
            },
        ],
        relacionados: ['bandeja', 'rastreo', 'agenda', 'medicos'],
        palabrasClave: ['his', 'hospital', 'sincronización', 'integración', 'agente', 'homologación', 'homologar', 'auditoría del espejo', 'cola de salida', 'outbox', 'shadow', 'modo de agenda'],
    },
    {
        id: 'bandeja',
        href: '/dashboard/bandeja',
        titulo: 'Bandeja de sincronización',
        icono: '🚨',
        categoria: 'hospital',
        resumen: 'Las citas que no llegaron al hospital (AgenIA las confirmó y el hospital todavía no las tiene), los cambios que no se pudieron aplicar y los avisos de pacientes al bot («no puedo ir», «número equivocado»), para resolverlos a tiempo.',
        paraQueSirve:
            'Un vigilante revisa cada 2 minutos si algo se atascó entre AgenIA y el hospital. Cada problema es una «excepción» con su gravedad: crítica si la cita es en menos de 4 horas. Aquí alguien la toma, la resuelve (por ejemplo, agendándola a mano en el HIS) y deja constancia. El número rojo del menú es lo que te espera.',
        disponibilidad: `${CON_ESPEJO} La ven el Administrador y los Agentes de Reservas.`,
        guias: [
            {
                titulo: 'Atender una cita que no llegó al hospital (una excepción)',
                pasos: [
                    'Abre «Activas» u ordena por «Urgencia (cita más próxima)».',
                    'Pulsa «Tomar»: queda a tu nombre y nadie más la trabaja.',
                    'Resuelve el caso (por ejemplo, agenda la cita a mano en el HIS o llama al paciente).',
                    'Pulsa «Resolver» y cuenta qué hiciste (mínimo 5 caracteres).',
                ],
                nota: 'Si no hace falta actuar (era una cita de prueba), usa «Descartar» y explica por qué. Si no puedes seguir con ella, «Soltar» la devuelve a «Sin dueño».',
            },
            {
                titulo: 'Atender el aviso de un paciente que no irá o pide otra fecha',
                pasos: [
                    'Filtra por el tipo «Un paciente avisó que no irá o pide otra fecha». La tarjeta dice qué pidió, por dónde y lo que escribió.',
                    'Pulsa «Tomar».',
                    'Si no irá, cancela la cita en el HIS para liberar el cupo. Si pide otra fecha, muévela en el HIS y avísale al paciente.',
                    'No hace falta cerrarla: cuando la cita se cancela o cambia de hora, se cierra sola. Si decides dejar la cita como está, pulsa «Resolver» y cuenta por qué.',
                ],
                nota: 'Aparecen cuando cancelar o cambiar la fecha están apagados en el bot, y también cuando la cita es de un servicio o médico con el que AgenIA no trabaja (por ejemplo odontología o hipertensos): la tarjeta lo dice. El bot no toca la cita ni escribe en el hospital: le dice al paciente que su aviso quedó registrado y que la cita sigue en pie hasta que el hospital la gestione.',
            },
            {
                titulo: 'Corregir el teléfono de un paciente que es de otra persona',
                pasos: [
                    'Filtra por el tipo «El teléfono de un paciente es de otra persona».',
                    'Consigue el número correcto (por ejemplo, llamando al paciente o con su historia).',
                    'Corrígelo en el HIS y también en Pacientes de AgenIA: el hospital no reemplaza un teléfono que AgenIA ya tiene.',
                    'Pulsa «Resolver» contando qué hiciste. Si el aviso no era cierto, usa «Descartar».',
                ],
                nota: 'Mientras el caso esté abierto, AgenIA no le envía recordatorios a ese paciente. Al cerrarlo (resuelto o descartado), vuelven solos. También se abre cuando al recordatorio le contesta la contestadora automática de un negocio («Gracias por comunicarte con…»): el asistente no le responde a una contestadora.',
            },
            {
                titulo: 'Configurar los avisos por WhatsApp al agendador',
                pasos: [
                    'Pulsa «Configurar avisos».',
                    'Escribe el celular del agendador y, si quieres, uno de respaldo (por ejemplo, un coordinador).',
                    'Marca «Avisar por WhatsApp cuando una cita no llegue al hospital» y guarda.',
                ],
                nota: 'El aviso lleva solo un resumen, sin datos de pacientes. Si en 30 minutos nadie toma la excepción, se recuerda hasta 2 veces (también al respaldo). Necesita la plantilla «Aviso al agendador» en Configuración.',
            },
            {
                titulo: 'Buscar y filtrar',
                pasos: [
                    'Usa «Activas», «Sin dueño», «Mías» o «Cerradas».',
                    'Busca por médico, paciente, título o nota.',
                    'Filtra por tipo, médico y fechas. «Limpiar filtros» vuelve a empezar.',
                    'Pulsa «Ver historial» en una tarjeta para ver qué pasó, o «Ver el caso completo en Rastreo de paciente».',
                ],
            },
        ],
        elementos: [
            { nombre: 'Activas / Sin dueño / Mías / Críticas', explicacion: 'Las cifras de arriba. Críticas: la cita es en menos de 4 horas.' },
            { nombre: 'Gravedad', explicacion: 'Baja, Media, Alta (cita en menos de 24 horas) o Crítica (menos de 4 horas).' },
            {
                nombre: 'Tipos de excepción',
                explicacion:
                    'Cita que el hospital aún no tiene · Un cambio se rindió sin llegar al hospital · Conflicto entre AgenIA y el hospital · Error al aplicar un cambio · El hospital no tiene una cita que AgenIA da por hecha · Cita del hospital con un documento ambiguo · Un paciente avisó que no irá o pide otra fecha · El teléfono de un paciente es de otra persona · Cancelación que el hospital no aplicó.',
            },
            {
                nombre: 'Estados de cierre',
                explicacion: 'Resuelta o Descartada (con nota de una persona), Se cerró sola (el problema desapareció) o Venció sin resolución (la cita pasó hace más de 7 días y nadie la cerró).',
            },
        ],
        preguntas: [
            {
                pregunta: '¿Por qué una excepción se cerró sola?',
                respuesta: 'Porque dejó de cumplirse la condición: por ejemplo, la cita ya llegó al hospital o se canceló.',
            },
            {
                pregunta: '¿El aviso de un paciente que no irá cancela su cita?',
                respuesta: 'No. Ni el bot ni la bandeja escriben nada en el hospital: la cita sigue igual hasta que alguien la cancele o la mueva en el HIS. Cuando eso pasa, el aviso se cierra solo.',
            },
            {
                pregunta: '¿Se le avisa al agendador por WhatsApp de estos avisos de pacientes?',
                respuesta: 'No: solo quedan en la bandeja, con su cifra en el menú. Los avisos por WhatsApp son para las citas que no llegaron al hospital.',
            },
            {
                pregunta: '¿Qué es «Cancelación que el hospital no aplicó»?',
                respuesta: 'AgenIA canceló una cita, pero en el sistema del hospital esa hora del médico tiene la cita de OTRA persona, así que no se borró nada allá (borrarla habría dejado sin cita a otro paciente). La cita sigue cancelada en AgenIA. Busca en el HIS dónde quedó la cita de este paciente y cancélala allá si corresponde; luego pulsa «Resolver».',
            },
            {
                pregunta: '¿Qué es «Cita del hospital con un documento ambiguo»?',
                respuesta: 'El hospital agendó una cita con un documento que podría ser de más de un paciente de AgenIA (por ejemplo, con ceros a la izquierda distintos). No se crea sola para no mezclar dos historias: decide una persona.',
            },
        ],
        problemas: [
            {
                sintoma: 'El panel dice «Los avisos por WhatsApp al agendador NO están saliendo».',
                solucion: 'Lee el motivo: suele faltar la plantilla «Aviso al agendador» o el celular. Mientras tanto hay que abrir la bandeja para enterarse.',
            },
            {
                sintoma: 'Solo se muestran 500.',
                solucion: 'Resuelve o descarta las que ya no importan, o filtra para ver el resto.',
            },
        ],
        relacionados: ['espejo', 'rastreo', 'configuracion'],
        palabrasClave: ['excepciones', 'sincronización', 'citas atascadas', 'no llegó al hospital', 'pendientes', 'alertas', 'vigilante', 'agendador'],
    },
    {
        id: 'avisos',
        href: '/dashboard/espejo/avisos',
        titulo: 'Avisos masivos',
        icono: '📣',
        categoria: 'hospital',
        resumen: 'Avisa por WhatsApp, paciente por paciente, a quienes tienen cita el día de un especialista: que se canceló o que se les espera.',
        paraQueSirve:
            'Cuando un especialista no puede asistir, o cuando quieres recordar de antemano su día de agenda, armas la lista de pacientes de ese día y les envías el mensaje. No es una campaña masiva: es para el puñado de pacientes de un día. El aviso de cancelación solo informa; la cita se cancela por el proceso de siempre del hospital.',
        disponibilidad:
            'Solo aparece en las clínicas conectadas al sistema del hospital. La ven el Administrador y los Agentes de Reservas, aunque la función esté apagada: el Administrador la enciende desde esta misma pantalla, y mientras tanto a los Agentes de Reservas la pantalla les indica que un administrador debe activarla.',
        guias: [
            {
                titulo: 'Enviar un aviso',
                pasos: [
                    'Elige el tipo: «El especialista no puede asistir» (informa que la cita se canceló) o «Recuerda de antemano un día de agenda» (la cita sigue en pie).',
                    'Paso 1 · Arma la lista: «Traer del hospital» (eliges médico y fechas; el agente responde en su siguiente vuelta) o sube una hoja CSV o Excel, valídala y pulsa «Cargar información».',
                    'Paso 2 · Escoge a quién escribirle y revisa la vista previa del mensaje. Puedes agregar una nota.',
                    'Escribe el número de pacientes para confirmar y pulsa «Enviar».',
                ],
                nota: 'No se puede deshacer: WhatsApp no borra los mensajes entregados. Necesita las plantillas «Aviso de cancelación» y «Recordatorio masivo» en Configuración.',
            },
            {
                titulo: 'Activar la función para la clínica',
                pasos: [
                    'Marca «Habilitar avisos de cancelación para esta clínica».',
                    'Elige cómo se arma la lista (hoja electrónica o directo del espejo), el ritmo de envío y el máximo de destinatarios por lote.',
                    'Pulsa «Guardar configuración».',
                ],
            },
        ],
        elementos: [
            { nombre: 'Ritmo de envío', explicacion: 'Mensajes por minuto: se envían de a uno para no saturar WhatsApp.' },
            { nombre: 'Historial', explicacion: 'Cada lote enviado, con su resultado por paciente.' },
        ],
        preguntas: [
            {
                pregunta: '¿El aviso de cancelación anula la cita en el hospital?',
                respuesta: 'No. Solo informa al paciente. La cancelación se hace por el proceso habitual del hospital.',
            },
            {
                pregunta: '¿Qué pasa con un paciente sin celular válido?',
                respuesta: 'No se puede seleccionar: hay que avisarle por otro medio.',
            },
        ],
        problemas: [
            { sintoma: 'Sale «El agente no respondió a tiempo».', solucion: 'Verifica en Espejo con el HIS que el agente esté conectado e intenta de nuevo.' },
            { sintoma: 'La lista se recortó.', solucion: 'Trajo más citas de las que caben en un lote. Reduce el rango de fechas.' },
        ],
        relacionados: ['espejo', 'configuracion', 'rastreo'],
        palabrasClave: ['avisos', 'cancelación masiva', 'médico no asiste', 'especialista ausente', 'recordatorio masivo', 'mensajes masivos', 'lote', 'notificar pacientes'],
    },
];

export const GLOSARIO: TerminoGlosario[] = [
    { termino: 'HIS', definicion: 'Sistema de información del hospital: donde el hospital lleva su agenda y sus citas.', sinonimos: ['sistema del hospital'], temaId: 'espejo' },
    { termino: 'Espejo', definicion: 'La conexión que mantiene sincronizadas las citas entre AgenIA y el HIS, en las dos direcciones.', sinonimos: ['sincronización'], temaId: 'espejo' },
    {
        termino: 'Agente del hospital',
        definicion: 'Programa instalado en un servidor del hospital que lleva y trae la información entre AgenIA y el HIS. No confundir con el Agente de Reservas, que es una persona.',
        temaId: 'espejo',
    },
    { termino: 'Agente de Reservas', definicion: 'Rol del personal que agenda citas desde el panel y atiende en ventanilla. Puede estar limitado a una EPS o a un médico.', temaId: 'usuarios' },
    {
        termino: 'Límite de citas',
        definicion: 'Máximo de citas que un paciente puede tener por el asistente el mismo día y en el mismo mes. Pasado el límite, el asistente lo remite al hospital y le ofrece pedir una revisión.',
        sinonimos: ['tope de citas', 'máximo de citas'],
        temaId: 'limites-citas',
    },
    { termino: 'Cupo (slot)', definicion: 'Espacio de tiempo de un médico en el que se puede agendar una cita.', sinonimos: ['turno', 'horario', 'hueco'], temaId: 'agenda' },
    { termino: 'Cupo universal', definicion: 'Cupo que el asistente ofrece a pacientes de cualquier EPS. Se ve en azul en el calendario.', temaId: 'agenda' },
    { termino: 'Cupo exclusivo de EPS', definicion: 'Cupo que el asistente solo ofrece a afiliados de una EPS. Se ve en verde.', temaId: 'agenda' },
    { termino: 'EPS', definicion: 'Entidad Promotora de Salud: la aseguradora del paciente.', sinonimos: ['aseguradora', 'convenio'], temaId: 'eps' },
    { termino: 'Régimen', definicion: 'Tipo de afiliación del paciente: subsidiado o contributivo. Algunas EPS solo tienen convenio para uno de los dos.', temaId: 'eps' },
    { termino: 'Padrón', definicion: 'Listado de afiliados de una EPS habilitados para agendar por esa EPS.', temaId: 'padron' },
    { termino: 'Corte del padrón', definicion: 'Cada archivo cargado al padrón. Reemplaza el padrón activo de esa EPS: quien no viene, queda inactivo.', temaId: 'padron' },
    { termino: 'Particular', definicion: 'Cita sin EPS (pago directo). No necesita estar en el padrón.', temaId: 'padron' },
    { termino: 'Asistente virtual', definicion: 'El bot que atiende a los pacientes por WhatsApp y Telegram: agenda, cancela, cambia fechas y responde preguntas.', sinonimos: ['bot', 'chatbot'], temaId: 'configuracion' },
    { termino: 'Base de conocimiento', definicion: 'El texto con la información de la clínica que el asistente usa para responder preguntas. No responde nada que no esté ahí.', temaId: 'configuracion' },
    { termino: 'Plantilla de WhatsApp', definicion: 'Mensaje aprobado por Meta que se puede enviar fuera de la ventana de 24 horas.', sinonimos: ['template'], temaId: 'configuracion' },
    { termino: 'Ventana de 24 horas', definicion: 'Plazo después del último mensaje del paciente en el que WhatsApp deja enviar texto libre. Fuera de él solo se pueden enviar plantillas.', temaId: 'configuracion' },
    { termino: 'BSUID', definicion: 'Identificador que WhatsApp le da a una persona para una empresa. Sirve para reconocerla cuando no se conoce su teléfono.', temaId: 'rastreo' },
    { termino: 'Caja Negra', definicion: 'Registro de las conversaciones con el asistente que fallaron, se abandonaron o se derivaron por emergencia.', temaId: 'auditoria' },
    { termino: 'Lista de espera', definicion: 'Pacientes que pidieron quedar en cola porque no había cupo. Se gestionan desde la Caja Negra.', temaId: 'auditoria' },
    { termino: 'Homologar', definicion: 'Emparejar un médico del HIS con su perfil en AgenIA. Sin homologar, el médico no recibe cupos ni citas del hospital.', temaId: 'espejo' },
    {
        termino: 'Modo de agenda',
        definicion: 'OFF: la agenda es la de AgenIA. SHADOW: se compara con la del hospital sin cambiar nada. ON: la agenda de AgenIA es la del hospital.',
        temaId: 'espejo',
    },
    { termino: 'Interruptores de operaciones', definicion: 'Agendar, cancelar y cambiar la fecha, cada uno en Configuración. Con la clínica conectada al hospital, encendido la operación llega al HIS; apagado no se puede hacer en AgenIA y se hace en el HIS. Reemplazan al antiguo «envío al hospital».', sinonimos: ['envío al hospital', 'envío de citas nuevas'], temaId: 'espejo' },
    { termino: 'Evento rendido', definicion: 'Un envío al hospital que falló diez veces y dejó de reintentarse. Se puede devolver a la cola desde el Espejo.', sinonimos: ['dead letter'], temaId: 'espejo' },
    { termino: 'Excepción de sincronización', definicion: 'Un problema detectado entre AgenIA y el hospital que alguien debe revisar en la Bandeja.', temaId: 'bandeja' },
    { termino: 'Veredicto', definicion: 'La conclusión del Rastreo de paciente: qué consta, de qué fuente, qué no se puede afirmar y qué hacer.', temaId: 'rastreo' },
    { termino: 'Origen de la cita', definicion: 'Por dónde se agendó: WhatsApp, Telegram, Manual (el personal) o Hospital (el HIS).', temaId: 'vision-general' },
    { termino: 'Conversión', definicion: 'Porcentaje de las personas que escribieron al asistente que terminaron con una cita.', temaId: 'canales' },
    { termino: 'CSAT', definicion: 'Encuesta de satisfacción: el paciente califica la atención del asistente de 1 a 5 estrellas.', sinonimos: ['satisfacción'], temaId: 'encuestas' },
    { termino: 'Recordatorio', definicion: 'Mensaje al paciente antes de su cita. Puede ser automático (Configuración) o manual (Visión General).', temaId: 'vision-general' },
];

/** El tema de una ruta del menú (para enlazar desde una pantalla a su ayuda). */
export function temaDeRuta(href: string): TemaAyuda | undefined {
    return TEMAS.find((t) => t.href === href);
}

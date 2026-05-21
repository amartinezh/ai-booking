export enum ChatState {
  IDLE = 'IDLE',
  AWAITING_SPECIALTY = 'AWAITING_SPECIALTY',
  AWAITING_EPS = 'AWAITING_EPS',
  AWAITING_DATE = 'AWAITING_DATE',
  AWAITING_NAME = 'AWAITING_NAME',
  AWAITING_CEDULA = 'AWAITING_CEDULA',
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  AWAITING_CANCEL_CEDULA = 'AWAITING_CANCEL_CEDULA',
  AWAITING_CANCEL_SELECTION = 'AWAITING_CANCEL_SELECTION',
  AWAITING_CANCEL_CONFIRM = 'AWAITING_CANCEL_CONFIRM',
  AWAITING_WAITLIST_CONFIRM = 'AWAITING_WAITLIST_CONFIRM',
  AWAITING_WAITLIST_OPTIN = 'AWAITING_WAITLIST_OPTIN',
  AWAITING_POST_CANCEL_CHOICE = 'AWAITING_POST_CANCEL_CHOICE',
}

// Nombre canónico del registro EPS para pago directo (debe existir en BD por org).
export const PARTICULAR_EPS_NAME = 'Particular';

// Valor por defecto de reintentos. La cifra efectiva se lee de OrganizationSettings.
export const DEFAULT_MAX_RETRIES = 3;

// Tiempo de expiración de la sesión conversacional en Redis (1 hora)
export const SESSION_TTL = 3600;

// Longitud mínima de dígitos para considerar una cédula válida.
export const MIN_CEDULA_LENGTH = 4;

// Tiempo máximo para confirmar un cupo de waitlist (30 minutos)
export const WAITLIST_CONFIRM_TTL = 1800;

// Nombre del asistente (usado en todos los mensajes)
export const BOT_NAME = 'AgenIA';

// Estilos de comunicación soportados por el chatbot.
// Reflejan el enum CommunicationStyle del schema Prisma.
export type CommStyle = 'FORMAL' | 'INFORMAL';

// ─────────────────────────────────────────────────────────────
// Helper: selección pseudo-aleatoria de variantes.
// Permite que el bot no repita exactamente la misma frase cada vez.
// ─────────────────────────────────────────────────────────────
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ═════════════════════════════════════════════════════════════
// POOL FORMAL  — Voz: recepcionista clínica colombiana, "usted",
// estructura clara con viñetas A) B) C) en líneas separadas.
// ═════════════════════════════════════════════════════════════
const FORMAL = {
  bienvenida: (clinicaName: string, servicios: string, botName: string = BOT_NAME) =>
    pick([
      `¡Hola! 👋 Mucho gusto, soy *${botName}*, le acompaño desde *${clinicaName}*.\n\n` +
        `Con mucho gusto le ayudo a agendar su cita sin filas ni complicaciones. 🏥\n\n` +
        `Cuénteme, ¿para qué especialidad necesita su cita hoy?\n` +
        `_${servicios}_`,
      `¡Hola, qué gusto saludarle! 🌻 Soy *${botName}*, su asistente de *${clinicaName}*.\n\n` +
        `Estoy aquí para agendarle su cita de forma rapidita y sencilla. 🏥\n\n` +
        `¿En qué servicio le puedo colaborar el día de hoy?\n` +
        `_${servicios}_`,
      `¡Bienvenido(a) a *${clinicaName}*! 🌟 Soy *${botName}*, su asistente virtual.\n\n` +
        `Será un placer ayudarle con su agendamiento. 🏥\n\n` +
        `Para empezar, ¿me cuenta qué especialidad está buscando?\n` +
        `_${servicios}_`,
    ]),

  menuServicios: (clinicaName: string, lineas: string, botName: string = BOT_NAME) =>
    pick([
      `¡Hola! 👋 Soy *${botName}*, su asistente en *${clinicaName}*. Un placer en saludarte.\n\n` +
        `Con mucho gusto le ayudo a agendar su cita el día de hoy. 🏥\n\n` +
        `*¿En qué servicio le puedo colaborar?* Puede responderme con la letra:\n\n` +
        `${lineas}\n` +
        `_También puede escribirme el nombre del servicio o, si prefiere, enviarme un audito de voz._ 🎙️`,
      `¡Qué gusto saludarle! 🌻 Le habla *${botName}*, de *${clinicaName}*.\n\n` +
        `Permítame ayudarle a reservar su cita médica de forma muy rápida. 🏥\n\n` +
        `*Cuénteme, ¿qué servicio necesita?* Estas son las opciones disponibles:\n\n` +
        `${lineas}\n` +
        `_Puede contestarme con la letra, el nombre del servicio o un audio._ 🎙️`,
      `¡Hola, bienvenido(a)! 🌟 Soy *${botName}*, su acompañante virtual de *${clinicaName}*.\n\n` +
        `Estoy aquí para que su agendamiento sea facilito. 🏥\n\n` +
        `*¿Cuál de estos servicios necesita hoy?*\n\n` +
        `${lineas}\n` +
        `_Respóndame con la letra, escriba el nombre o envíeme un audio — como le quede más cómodo._ 🎙️`,
    ]),

  servicioInvalido: (lineas: string) =>
    pick([
      `Ay, discúlpeme, no logré entender bien su respuesta. 🙏\n\n` +
        `¿Me podría confirmar el servicio? Puede contestarme con la letra ` +
        `_(ej: A, B, C...)_ o escribirme el nombre directamente.\n\n${lineas}`,
      `Mil disculpas, esa opción no la logré identificar. 😊\n\n` +
        `Regáleme un momentico y volvamos a intentarlo: respóndame con la letra ` +
        `_(A, B, C...)_ o escríbame el nombre del servicio.\n\n${lineas}`,
      `Perdóneme, no le entendí del todo. 🙏 ¿Lo intentamos otra vez?\n\n` +
        `Puede elegirme una letra _(A, B, C...)_ o escribirme el nombre del servicio.\n\n${lineas}`,
    ]),

  menuEps: (servicio: string, lineas: string) =>
    pick([
      `¡Perfecto, *${servicio}*! 🩺 Excelente elección.\n\n` +
        `Ahora, para buscarle el mejor espacio disponible, ¿me cuenta por favor a qué *EPS o aseguradora* está afiliado(a)?\n\n` +
        `Puede contestarme con la letra o escribirme el nombre:\n\n${lineas}\n` +
        `_Si paga directamente la consulta, elija *Particular*._ 💳`,
      `¡Listo, anotado: *${servicio}*! 🩺\n\n` +
        `Para revisar la agenda disponible, regáleme un segundito y cuénteme con cuál *EPS* viene hoy:\n\n${lineas}\n` +
        `_Si paga por su cuenta, no se preocupe — seleccione *Particular*._ 💳`,
      `Genial, vamos por *${servicio}*. 🩺 Siguiente pasito:\n\n` +
        `¿Me regala el nombre de su *EPS* para verificarle la disponibilidad? Puede elegir una opción o escribírmela:\n\n${lineas}\n` +
        `_Si su consulta es particular, marque *Particular*, con confianza._ 💳`,
    ]),

  epsInvalida: (lineas: string) =>
    pick([
      `Ay, discúlpeme, no logré identificar esa EPS. 🙏\n\n` +
        `¿Me la confirma otra vez, por favor? Puede elegirme la letra _(A, B, C...)_ o escribir el nombre:\n\n${lineas}`,
      `Mil disculpas, no le entendí bien la EPS. 😊 Volvamos a intentarlo:\n\n` +
        `Respóndame con la letra o escríbame el nombre completo, lo que prefiera:\n\n${lineas}`,
      `Perdóneme, no logré ubicar esa opción dentro de nuestros convenios. 🙏\n\n` +
        `¿Me la repite, por favor? Aquí le dejo las opciones nuevamente:\n\n${lineas}`,
    ]),

  pedirEps: () =>
    pick([
      `Para revisarle la disponibilidad, ¿me regala el nombre de su *EPS o aseguradora*, por favor?\n\n` +
        `_(Si paga directamente la consulta, escríbame *"Particular"*.)_ 💳`,
      `Cuénteme por favor, ¿con cuál *EPS* viene hoy? Así le busco el mejor espacio.\n\n` +
        `_(Si es por cuenta propia, escríbame *"Particular"*, sin pena.)_ 💳`,
    ]),

  epsNoEncontrada: (epsQuery: string) =>
    pick([
      `Ay, qué pena, no logré encontrar la EPS *"${epsQuery}"* en nuestros convenios. 🙏\n\n` +
        `¿Me la confirma otra vez, por favor? _(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular...)_`,
      `Discúlpeme, no me apareció la EPS *"${epsQuery}"* registrada. 😊\n\n` +
        `¿Me la escribe nuevamente? _(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular...)_`,
    ]),

  epsInactiva: (epsName: string) =>
    pick([
      `Ay, qué pena con usted, en este momento no tenemos convenio activo con *${epsName}*. 🙏\n\n` +
        `¿Desea continuar como *Particular* o cuenta con otra EPS? Cuénteme.`,
      `Discúlpeme, justo ahora no estamos atendiendo el convenio con *${epsName}*. 😔\n\n` +
        `Si gusta, podemos agendarle como *Particular*, o si tiene otra EPS, dígame con confianza.`,
    ]),

  cuposDisponibles: (nombre: string, epsName: string, lineas: string) =>
    pick([
      `${nombre ? `¡${nombre}, ` : '¡'}qué alegría! 🌟 Mire los horarios que le encontré con *${epsName}*:\n\n${lineas}\n` +
        `_Respóndame con la letra del horario que más le acomode, por favor._ ✍️`,
      `${nombre ? `${nombre}, ` : ''}¡con mucho gusto! Estos son los espacios disponibles para *${epsName}*:\n\n${lineas}\n` +
        `_Cuénteme cuál le sirve mejor: respóndame con la letra._ 😊`,
      `${nombre ? `Listo, ${nombre}: ` : 'Listo: '}aquí le traigo la agenda disponible para *${epsName}*:\n\n${lineas}\n` +
        `_Elija el horario que más le convenga (respóndame con la letra)._ ✍️`,
    ]),

  preguntaWaitlist: (servicio: string, eps: string) =>
    pick([
      `Revisé con cuidado la agenda para *${servicio}* con *${eps}* y por el momento no veo cupos disponibles. 😔\n\n` +
        `Pero no se preocupe: si gusta, le anoto en nuestra *lista de espera* y le aviso por aquí mismito en cuanto se libere un espacio. ✨\n\n` +
        `¿Le parece bien? Respóndame *SÍ* para anotarle o *NO* si prefiere intentarlo más adelante.`,
      `Mire, ${servicio.toLowerCase()} con *${eps}* está justo full por estos días. 😅\n\n` +
        `Pero tengo una idea: ¿quiere que le anote en la *lista de espera*? En cuanto alguien libere un cupo, le escribo de una vez para reservárselo. ✅\n\n` +
        `¿Le gustaría? Respóndame *SÍ* o *NO*, con toda confianza.`,
      `Acabo de revisar y por ahora la agenda de *${servicio}* (${eps}) está llenita. 🙏\n\n` +
        `Si gusta, puedo dejarle apuntado(a) en la *lista de espera* y le aviso apenas se abra un espacio — sin compromiso, claro. 🤝\n\n` +
        `¿Le parece? *SÍ* para anotarle, *NO* para dejarlo así.`,
    ]),

  unidoAWaitlist: (nombre: string, servicio: string, position: number) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! 🎟️ Le anoté en la lista de espera para *${servicio}* — quedó en la posición *#${position}*.\n\n` +
        `Esté pendiente de su WhatsApp: apenas se libere un cupo, le escribo de una. ✨\n\nQue tenga un día muy bonito. 😊`,
      `${nombre ? `Perfecto, ${nombre}. ` : 'Perfecto. '}Ya quedó apuntado(a) en la lista de espera de *${servicio}* (posición *#${position}*). 🎟️\n\n` +
        `En cuanto se libere un espacio, le aviso por acá mismo, no se preocupe. 💚\n\n¡Cuídese mucho!`,
      `¡Hecho${nombre ? `, ${nombre}` : ''}! 🌟 Le agregué a la cola para *${servicio}*, va en la posición *#${position}*.\n\n` +
        `Yo le escribo apenas tenga noticias para usted. 🙏\n\nMientras tanto, ¡que esté muy bien!`,
    ]),

  noUnidoAWaitlist: () =>
    pick([
      `Listo, sin problema, no le anoto en la lista. 😊\n\n` +
        `Cuando quiera intentarlo nuevamente, solo escríbame *"Hola"* y con mucho gusto le atiendo. ¡Que esté muy bien! 👋`,
      `Como prefiera, no se preocupe. 🌻\n\n` +
        `Aquí estaré cuando quiera retomar — escríbame *"Hola"* y seguimos. ¡Hasta pronto! 👋`,
      `Perfecto, lo dejamos así por ahora. 😊\n\n` +
        `Cuando lo necesite, me escribe *"Hola"* y le ayudo de una vez. Que tenga un día excelente. 🌟`,
    ]),

  sinDisponibilidad: (nombre: string, epsName: string, especialidad: string, position: number) =>
    `${nombre}, revisé con cuidado la agenda para *${epsName}* en *${especialidad}* ` +
    `y por el momento no veo cupos abiertos. 😔\n\n` +
    `Pero tranquilo(a), ya le agregué a la lista de espera (posición *#${position}*). ` +
    `En cuanto se libere un espacio, le aviso por aquí mismito. ✨\n\n` +
    `¿Hay algo más en lo que le pueda colaborar?`,

  pedirCedulaPostSlot: (fechaFormateada: string) =>
    pick([
      `¡Excelente elección! 🌟 Le aparté ese horario un momentito:\n📅 *${fechaFormateada}*\n\n` +
        `Para terminar de agendarle, ¿me regala su *número de cédula*, por favor?`,
      `¡Perfecto, ya casi terminamos! 😊 Le reservé tentativamente:\n📅 *${fechaFormateada}*\n\n` +
        `Solo me falta confirmarle un datico: ¿me comparte por favor su *cédula*?`,
      `¡Listo! 🎯 Tengo ese cupo reservado para usted:\n📅 *${fechaFormateada}*\n\n` +
        `Para finalizar, ¿me dice por favor su *número de cédula*? Solo el número, sin puntos.`,
    ]),

  especialidadConfirmada: (especialidad: string) =>
    `Perfecto, anotado: *${especialidad}*. 🩺\n\nPara revisarle la agenda, ¿me regala por favor su *número de cédula*?`,

  pedirCedula: (especialidad: string) =>
    `Anotado, busca cita para *${especialidad}*. 🩺\n\n¿Me comparte por favor su *número de cédula*? Solo el número, sin puntos ni guiones.`,

  primeraVez: () =>
    pick([
      `¡Qué gusto recibirle por primera vez! 🤝\n\nPara registrarle en el sistema, ¿me regala su *nombre completo*, por favor?`,
      `¡Bienvenido(a)! Es un placer atenderle por primera vez. 🌟\n\nCuénteme su *nombre completo*, así le abrimos su historia con nosotros.`,
      `¡Mucho gusto! Es la primera vez que le veo por aquí. 😊\n\n¿Me dice su *nombre completo* para registrarle como nuevo paciente?`,
    ]),

  // ACK del Primer Turno (Fase 2): confirma al paciente las entidades que el
  // Agente entendió de su primer mensaje, antes de pedir lo que falta.
  ackTurno1: (p: {
    nombre?: string | null;
    cedula?: string | null;
    especialidad?: string | null;
    eps?: string | null;
    fecha?: string | null;
  }) => {
    const detalles: string[] = [];
    if (p.nombre) detalles.push(`👤 *Paciente:* ${p.nombre}`);
    if (p.cedula) detalles.push(`🪪 *Cédula:* ${p.cedula}`);
    if (p.especialidad) detalles.push(`🏥 *Servicio:* ${p.especialidad}`);
    if (p.eps) detalles.push(`💳 *EPS:* ${p.eps}`);
    if (p.fecha) detalles.push(`📅 *Fecha preferida:* ${p.fecha}`);
    const saludo = p.nombre ? `¡Hola, ${p.nombre}!` : '¡Hola!';
    const bloque = detalles.length
      ? `\n\nEntendido, ya tomé nota de:\n${detalles.join('\n')}`
      : '';
    return `${saludo} 👋 Con mucho gusto le ayudo a agendar su cita.${bloque}`;
  },

  // Re-presentación cálida cuando el paciente confirma que SÍ quiere agendar
  // (o expresa intención de cita) estando en el paso de selección de servicio,
  // pero su texto no mapeó a una opción. Evita el mensaje de "no entendí".
  repromptAgendarServicio: (lineas: string) =>
    `¡Perfecto, con mucho gusto le agendo su cita! 🗓️\n\n` +
    `*¿Cuál de estos servicios necesita?* Puede responderme con la letra o el nombre:\n\n${lineas}`,

  // Igual, pero en el paso de selección de EPS.
  repromptAgendarEps: (lineas: string) =>
    `¡Perfecto, sigamos! 🗓️\n\n*¿Con cuál EPS o entidad desea su cita?*\n\n${lineas}`,

  resumenCita: (nombre: string, cedula: string, eps: string, especialidad: string, fecha: string) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! Confirmemos los datos de su cita antes de agendarle:\n\n` +
        `👤 *Paciente:* ${nombre}\n🪪 *Cédula:* ${cedula}\n💳 *EPS:* ${eps}\n🏥 *Servicio:* ${especialidad}\n📅 *Fecha y hora:* ${fecha}\n\n` +
        `¿Le parece todo correcto? Respóndame *SÍ* para agendarle definitivamente o *NO* si necesita cambiar algo.`,
      `¡Perfecto${nombre ? `, ${nombre}` : ''}! Reviso con usted la información antes de cerrar:\n\n` +
        `👤 ${nombre}\n🪪 Cédula ${cedula}\n💳 EPS: ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `Si todo está bien, respóndame *SÍ* y lo dejo confirmado. Si algo no le cuadra, escríbame *NO*.`,
      `Ya casi terminamos${nombre ? `, ${nombre}` : ''} 🌟. Estos son los datos de su cita:\n\n` +
        `👤 ${nombre}\n🪪 ${cedula}\n💳 ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `¿Lo dejamos así? Respóndame *SÍ* para agendarle o *NO* si prefiere cancelar.`,
    ]),

  citaConfirmada: (clinicaName: string, fecha: string) =>
    pick([
      `¡Listo, todo quedó confirmado! 🎉 Su cita está reservada en *${clinicaName}*.\n\n📅 _${fecha}_\n\n` +
        `Le pido por favor llegar *15 minutos antes* y traer su *documento de identidad*. 🪪\n\n¡Que esté muy bien y cualquier cosa, aquí me tiene! 😊`,
      `¡Hecho! 🌟 Su cita en *${clinicaName}* quedó agendada con éxito.\n\n📅 _${fecha}_\n\n` +
        `Recuerde llegar *15 minutos antes* con su *cédula* en mano. 🪪\n\nMil gracias por confiar en nosotros. ¡Cuídese mucho! 💚`,
      `¡Quedó listo! 🎊 Tiene su cita confirmada en *${clinicaName}*.\n\n📅 _${fecha}_\n\n` +
        `Por favor sea puntual: llegue unos *15 minutos antes* y traiga su *documento*. 🪪\n\nQue tenga un día excelente. ¡Hasta pronto! 👋`,
    ]),

  citaNoConfirmada: () =>
    pick([
      `Listo, no hay problema, cancelé la solicitud. 😊\n\nCuando quiera intentarlo de nuevo, solo escríbame *"Hola"* y con mucho gusto le ayudo.`,
      `Sin problema, lo dejamos por ahora. 🌻\n\nAquí estaré cuando quiera retomar — solo me dice *"Hola"* y seguimos.`,
      `Tranquilo(a), no se agendó nada todavía. 😊\n\nCuando esté listo(a), me escribe *"Hola"* y vamos otra vez. ¡Que esté muy bien!`,
    ]),

  slotTomado: () =>
    pick([
      `Uy, qué pena, justo ese horario lo acaba de tomar otro paciente. 😬\n\n¿Le parece si elegimos otro de los disponibles? Escríbame la letra nuevamente, por favor.`,
      `Ay, mil disculpas, ese cupito acaba de reservarse. 🙏\n\n¿Vemos otra opción? Cuénteme con qué letra prefiere quedarse.`,
    ]),

  errorSlotInvalido: () =>
    pick([
      `Mmm, esa letra no la veo entre las opciones que le envié. 🙏\n\n¿Me la confirma, por favor? Recuerde que puede contestarme con la letra _(A, B, C...)_ o escribirme *"Salir"* si prefiere cancelar.`,
      `Discúlpeme, no logré ubicar esa opción. 😊\n\nRespóndame con una de las letras disponibles _(A, B, C...)_ o escriba *"Salir"* si quiere terminar el proceso.`,
    ]),

  waitlistCupoDisponible: (nombre: string, especialidad: string, fecha: string, doctor: string) =>
    pick([
      `🔔 ¡${nombre}, tengo excelentes noticias para usted!\n\n` +
        `Se acaba de liberar un cupo en *${especialidad}* y usted era la siguiente persona en la lista. 🌟\n\n` +
        `📅 *${fecha}*\n👨‍⚕️ Dr(a). ${doctor}\n\nLe reservé este cupo por *30 minutos* — ¿le interesa tomarlo?\n\nRespóndame *SÍ* para confirmárselo o *NO* si ya no lo necesita.`,
      `🔔 ¡Hola ${nombre}! Le tengo una buena noticia. 🌟\n\n` +
        `Se liberó un espacio para *${especialidad}* y le toca a usted, que era la primera en espera.\n\n` +
        `📅 *${fecha}*\n👨‍⚕️ Dr(a). ${doctor}\n\nLe aparté el cupo por *30 minutos*. ¿Lo quiere tomar?\n\nConfírmeme con *SÍ* o, si ya no le sirve, escríbame *NO* con confianza.`,
    ]),

  waitlistCupoRechazado: () =>
    pick([
      `¡Sin problema! 😊 Libero ese cupo para otro paciente entonces.\n\nTranquilo(a), usted sigue en nuestra lista y le aviso apenas haya otra disponibilidad. ✨\n\n¡Que tenga un día excelente! 👋`,
      `Listo, como prefiera. 🌻 Libero el cupo para otra persona que también lo está esperando.\n\nUsted permanece en la lista, así que en cuanto aparezca otro espacio le aviso de una. 💚\n\n¡Cuídese mucho!`,
    ]),

  waitlistExpirado: () =>
    pick([
      `Ay, qué pena, el tiempo para confirmar ese cupo se nos pasó. ⏰\n\nSi todavía le interesa la cita, escríbame *"Hola"* y con mucho gusto le anoto nuevamente. 😊`,
      `Mil disculpas, se venció el tiempo para reservar ese cupo. 🙏\n\nSi quiere intentarlo otra vez, escríbame *"Hola"* y seguimos. ¡Aquí estoy! 💚`,
    ]),

  escape: () =>
    pick([
      `¡Listo, empezamos de nuevo! 😊 Cuénteme, ¿en qué le puedo colaborar?`,
      `Sin problema, refrescamos. 🌻 ¿En qué le ayudo el día de hoy?`,
      `Tranquilo(a), volvemos a empezar. 😊 Dígame, ¿qué necesita?`,
    ]),

  outOfContext: (botName: string = BOT_NAME) =>
    pick([
      `Discúlpeme, soy *${botName}* y le acompaño solo con el agendamiento de citas médicas. 🏥\n\n¿Me cuenta qué especialidad necesita o el nombre del médico que está buscando?`,
      `Mil disculpas, mi trabajito es ayudarle a agendar citas médicas aquí en la clínica. 😊\n\nCuénteme, ¿qué servicio o médico está buscando?`,
      `Permítame contarle: yo solo le puedo colaborar con citas médicas. 🙏\n\n¿Me dice qué especialidad necesita o con cuál doctor desea su cita?`,
    ]),

  guardrailInsulto: (phone: string, _botName: string = BOT_NAME) =>
    `Disculpe, le entiendo que pueda estar molesto(a), pero por aquí solo le puedo ayudar con su agendamiento médico ` +
    `y necesito que conservemos un trato respetuoso. 🙏\n\n` +
    `Si requiere atención adicional, con mucho gusto le pasamos con un asesor humano: 👉 *${phone}*\n\n` +
    `Por seguridad, cierro esta conversación. Cuando guste retomar el agendamiento, aquí estaré. 💚`,

  guardrailOffTopic: (phone: string, botName: string = BOT_NAME) =>
    `Ay, qué pena, parece que no estoy logrando entenderle bien dentro del agendamiento de citas. 🙏\n\n` +
    `Para que reciba una mejor atención, le recomiendo comunicarse con nuestro equipo humano: 👉 *${phone}*\n\n` +
    `Cuando quiera intentarlo nuevamente conmigo, solo escríbame *"Hola"* y *${botName}* le atiende de una. 😊`,

  ininteligible: () =>
    pick([
      `🎙️ Ay, discúlpeme, no logré escuchar/entender bien su mensaje. ¿Me lo repite por favor, despacito, o me lo escribe?`,
      `🎙️ Mil disculpas, no le capté bien el audio. ¿Me ayuda mandándomelo otra vez o escribiéndomelo, por favor?`,
      `🎙️ Perdóneme, no me quedó muy claro lo que dijo. ¿Me lo reenvía pausadito o me lo escribe?`,
    ]),

  iaCaida: (phone: string) =>
    `Ay, qué pena con usted: nuestro sistema está pasando por un mantenimiento breve. 🛠️\n\n` +
    `Mientras tanto, le invito a comunicarse al *${phone}* para que le atiendan directamente. 🙏\n\n` +
    `Apenas estemos de vuelta, podremos seguir por aquí. ¡Gracias por su paciencia!`,

  maxReintentos: (phone: string) =>
    `Discúlpeme, parece que estamos teniendo dificultades para entendernos. 😔\n\n` +
    `Para no hacerle perder más tiempo, le paso con nuestro equipo humano: 👉 https://wa.me/${phone}\n\n` +
    `Ellos le atenderán enseguida con mucho gusto.`,

  maxReintentosReset: () =>
    pick([
      `Para no enredarle más, reinicié la conversación. 🔄\n\nCuando quiera retomar, solo escríbame *"Hola"* y comenzamos limpio. 😊`,
      `Discúlpeme, mejor empecemos de cero para no confundirle. 🌻\n\nEscríbame *"Hola"* cuando esté listo(a) y le atiendo con calma.`,
    ]),

  sesionExpirada: () =>
    pick([
      `Ay, qué pena, su sesión expiró antes de poderle confirmar la cita. ⏳\n\nNo se preocupe, escríbame *"Hola"* y empezamos otra vez con muchísimo gusto. 😊`,
      `Mil disculpas, se nos pasó el tiempo de la sesión. 🙏\n\nCuando guste volver a empezar, escríbame *"Hola"* y le atiendo de una. 💚`,
    ]),

  cancelarPedirCedula: () =>
    pick([
      `Claro que sí, le ayudo con la cancelación de su cita. 📋\n\nPara ubicarla en el sistema, ¿me regala el *número de cédula* del paciente, por favor?`,
      `Con mucho gusto le colaboro con eso. 😊\n\nPara buscar la cita, ¿me comparte la *cédula* del paciente?`,
    ]),

  cancelarCedulaInvalida: () =>
    pick([
      `Mmm, ese número no me parece una cédula válida. 🙏\n\n¿Me la confirma, por favor? Solo el número, sin puntos ni espacios.\n_(Ej: 18531928)_`,
      `Discúlpeme, no logré identificar el número correctamente. 😊\n\nEscríbame por favor solo los dígitos, sin separadores. _(Ej: 1088123456)_`,
    ]),

  cancelarPacienteNoExiste: (cedula: string) =>
    pick([
      `Hmm, busqué en el sistema y no encuentro a ningún paciente con la cédula *${cedula}*. 🔍\n\n¿Me la confirma por favor? O si prefiere terminar el proceso, escríbame _*"Salir"*_.`,
      `Discúlpeme, esa cédula *${cedula}* no me aparece registrada. 🙏\n\n¿La revisamos otra vez? Si gusta terminar, escríbame _*"Salir"*_ con confianza.`,
    ]),

  cancelarSinCitas: (cedula: string) =>
    `Revisé y el paciente con cédula *${cedula}* no tiene citas próximas activas. 📭\n\n¿Le gustaría agendarle una nueva? Cuénteme.`,

  cancelarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Listo, encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál de ellas le gustaría cancelar? Respóndame con la letra, por favor.`,
      `Aquí están las citas que tengo para *${nombre}*:\n\n${lineas}\nDígame con la letra cuál es la que desea cancelar. 😊`,
    ]),

  cancelarConfirmar: (servicio: string, doctor: string, fecha: string) =>
    `Para confirmarle, esta es la cita que vamos a cancelar:\n\n🏥 *${servicio}*\n👨‍⚕️ Dr(a). ${doctor}\n📅 ${fecha}\n\n` +
    `⚠️ ¿Está completamente seguro(a)? Respóndame *SÍ* para cancelarla o *NO* si prefiere mantenerla.`,

  cancelarExitosa: () =>
    pick([
      `✅ ¡Listo! Su cita quedó *cancelada con éxito* y el cupo ya está liberado para otro paciente. 🗓️`,
      `✅ Hecho, cancelé su cita y dejé el espacio disponible para alguien más. 🙏`,
      `✅ Perfecto, ya cancelé la cita y el cupo queda liberado. 💚`,
    ]),

  cancelarOfreceAgendar: () =>
    pick([
      `¿Le gustaría agendarle ahora una cita en *otro horario disponible*? Cuénteme.\n\nRespóndame *SÍ* para continuar o *NO* si por ahora prefiere dejarlo así.`,
      `Si gusta, ya mismo le busco *otro horarito* que le acomode. ¿Le parece?\n\n*SÍ* para seguir, *NO* para terminar — con toda confianza.`,
    ]),

  cancelarDespedida: () =>
    pick([
      `¡Listo, que tenga un día muy bonito! 😊\n\nCuando me necesite, aquí estaré con mucho gusto. ¡Hasta pronto! 👋`,
      `¡Perfecto, cuídese mucho! 🌻\n\nRecuerde que cuando lo necesite, aquí estoy para atenderle. ¡Que esté muy bien!`,
      `¡Listo, mil gracias por escribir! 💚 Que pase un excelente día.\n\nCualquier cosita, me escribe *"Hola"* y le atiendo. 👋`,
    ]),

  despedidaCorta: () =>
    pick([
      `¡Fue un gusto atenderle! 😊 Que tenga un día muy bonito.\n\nCuando necesite algo más, aquí me tiene. ¡Hasta pronto! 👋`,
      `¡Con mucho gusto! 🌻 Que esté muy bien.\n\nCualquier cosita, me escribe *"Hola"* y le atiendo de una. 💚`,
      `¡Listo, hasta luego! 😊 Que tenga una tarde linda.\n\nAquí estaré cuando me necesite. 👋`,
    ]),

  cancelarAbortada: () =>
    pick([
      `✅ ¡Perfecto! Su cita sigue *activa y agendada*, sin cambios.\n\n¿Le puedo ayudar con algo más?`,
      `✅ Tranquilo(a), no toqué nada — su cita sigue *firme*. 😊\n\n¿Le colaboro con otra cosita?`,
    ]),

  cancelarError: () =>
    `Ay, qué pena, tuve un inconveniente intentando cancelar la cita. 😔\n\nPara no dejarle a medias, por favor comuníquese con nuestro Call Center y allí le ayudan enseguida. 🙏`,

  respuestaInvalidaSiNo: () =>
    pick([
      `Mmm, no le entendí muy bien. 🙏 ¿Me ayuda respondiendo *SÍ* para confirmar o *NO* para cancelar?`,
      `Discúlpeme, para este paso necesito un *SÍ* o un *NO*, por favor. 😊`,
      `Para asegurarme de no equivocarme, ¿me confirma con *SÍ* o *NO*?`,
    ]),

  audioPasoEstricto: () =>
    `🎙️ Para este pasito en particular, por favor respóndame por *texto* _(la letra o un SÍ/NO)_ — así evitamos cualquier confusión. 🙏`,

  inactividad: () =>
    `Hola, ¿cómo está? Por inactividad cerré nuestra conversación para cuidar sus datos. 🔒\n\nCuando quiera retomar, escríbame *"Hola"* y con mucho gusto le atiendo. 😊`,
};

// ═════════════════════════════════════════════════════════════
// POOL INFORMAL — Voz: amigo cercano, "tú", lenguaje fluido tipo
// párrafo. Las viñetas A/B/C se mantienen como guía rápida pero
// envueltas en una conversación más natural, no en lista rígida.
// ═════════════════════════════════════════════════════════════
const INFORMAL = {
  // Helper interno: aplana cualquier `${lineas}` multilínea (viene con \n
  // desde buildServiceMenu/buildEpsMenu/slots) en un fragmento de párrafo
  // separado por ` · `, manteniendo los marcadores A) B) C) inline.
  _flat: (lineas: string) => lineas.replace(/\n+/g, ' · ').replace(/\s+/g, ' ').trim(),

  bienvenida: (clinicaName: string, servicios: string, botName: string = BOT_NAME) =>
    pick([
      `¡Hola, ¿cómo estás? 😊 Mi nombre es *${botName}* y te escribo desde *${clinicaName}*. Espero que estés muy bien y gracias por escribirnos. Te cuento que puedo ayudarte a agendar tu cita médica de una. Cuéntame, ¿qué especialidad necesitas hoy? _${servicios}_`,
      `¡Hey, hola! 👋 Soy *${botName}*, de *${clinicaName}*. ¿Cómo vas? Gracias por escribir, con gusto te ayudo a reservar tu cita rapidito. ¿Para qué especialidad la necesitas? _${servicios}_`,
      `¡Hola! ¿Qué tal? 🌻 Soy *${botName}*, el asistente de *${clinicaName}*. Mira, aquí te ayudo a agendar tu cita sin filas ni esperas. Cuéntame qué buscas hoy. _${servicios}_`,
    ]),

  menuServicios: (clinicaName: string, lineas: string, botName: string = BOT_NAME) => {
    const inline = INFORMAL._flat(lineas);
    return pick([
      `¡Hola, ¿cómo estás? 😊 Soy *${botName}*, te escribo desde *${clinicaName}*. Espero que estés muy bien y gracias por escribirnos. Mira, te puedo ayudar a agendar tu cita médica. De momento estos son los servicios disponibles: ${inline}. Cuéntame con cuál te puedo ayudar — me puedes responder con la letra, escribirme el nombre o mandarme un audio, como prefieras. 🎙️`,
      `¡Hey! 👋 Soy *${botName}*, de *${clinicaName}*, un gusto saludarte. Te cuento rapidito: aquí te ayudo a reservar tu cita. Hoy tengo estos servicios para ti: ${inline}. Me dices con cuál vamos — puedes responder con la letra _(A, B, C...)_, escribirme el nombre o mandarme un audio, lo que te quede más fácil. 😊`,
      `¡Hola! ¿Qué tal? 🌻 Soy *${botName}*, tu asistente de *${clinicaName}*. Estoy aquí para que reservar tu cita sea cosa de un minuto. ¿Cuál de estos servicios necesitas hoy? ${inline}. Respóndeme con la letra, con el nombre o un audito de voz — como te parezca mejor. 🎙️`,
    ]);
  },

  servicioInvalido: (lineas: string) => {
    const inline = INFORMAL._flat(lineas);
    return pick([
      `Ay, perdóname, no te entendí bien. 🙏 ¿Me confirmas el servicio? Puedes mandarme la letra _(A, B, C...)_ o escribirme el nombre directito. Las opciones son: ${inline}.`,
      `Uy, esa opción no la pude identificar. 😅 Volvamos a intentarlo — me dices la letra o me escribes el nombre. Aquí van otra vez: ${inline}.`,
      `Perdón, no me quedó claro. ¿Lo intentamos otra vez? Dame una letra _(A, B, C...)_ o escríbeme el nombre del servicio: ${inline}.`,
    ]);
  },

  menuEps: (servicio: string, lineas: string) => {
    const inline = INFORMAL._flat(lineas);
    return pick([
      `¡Listo, *${servicio}*! 🩺 Buena elección. Ahora cuéntame algo: ¿con qué *EPS* vienes hoy? Así te busco el mejor horario. Estas son las que manejamos: ${inline}. Si pagas directo la consulta, no te preocupes — elige *Particular* y listo. 💳`,
      `¡Perfecto, vamos por *${servicio}*! 🩺 Dame un segundito y dime con cuál *EPS* estás afiliado(a). Mira, estas son las opciones — me respondes con la letra o el nombre: ${inline}. Y si pagas por tu cuenta, marca *Particular*, con toda confianza. 💳`,
      `Genial, anotado *${servicio}*. 🩺 Siguiente pasito: ¿de qué *EPS* eres? Aquí te dejo las que tenemos en convenio: ${inline}. _Si tu consulta es particular, escoge *Particular*._ 💳`,
    ]);
  },

  epsInvalida: (lineas: string) => {
    const inline = INFORMAL._flat(lineas);
    return pick([
      `Uy, perdón, no logré pillar esa EPS. 🙏 ¿Me la confirmas? Puedes elegir la letra o escribirme el nombre: ${inline}.`,
      `No te entendí bien la EPS, perdón. 😅 Dame otra oportunidad — letra o nombre, lo que tú quieras: ${inline}.`,
      `No pude ubicar esa opción en nuestros convenios. ¿La repetimos? Aquí van las opciones de nuevo: ${inline}.`,
    ]);
  },

  pedirEps: () =>
    pick([
      `Cuéntame, ¿con qué *EPS o aseguradora* vienes? Así te reviso la disponibilidad. _(Si pagas tú directo, escríbeme *"Particular"*.)_ 💳`,
      `Dime con cuál *EPS* estás afiliado(a) para buscarte el mejor cupo. _(Si es por tu cuenta, mándame *"Particular"*, sin pena.)_ 💳`,
    ]),

  epsNoEncontrada: (epsQuery: string) =>
    pick([
      `Uy, no encontré la EPS *"${epsQuery}"* en nuestros convenios. 🙏 ¿Me la confirmas? _(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular...)_`,
      `Perdón, esa EPS no me apareció. 😊 ¿Me la escribes otra vez? _(Ej: Sura, Sanitas, Nueva EPS, Compensar...)_`,
    ]),

  epsInactiva: (epsName: string) =>
    pick([
      `Uy, qué pena, ahorita no tenemos convenio activo con *${epsName}*. 🙏 ¿Te animas a continuar como *Particular* o tienes otra EPS? Cuéntame.`,
      `Perdón, en este momento no estamos atendiendo *${epsName}*. 😅 Si gustas te agendo como *Particular*, o si tienes otra EPS, dímelo.`,
    ]),

  cuposDisponibles: (nombre: string, epsName: string, lineas: string) => {
    const inline = INFORMAL._flat(lineas);
    return pick([
      `${nombre ? `¡${nombre}, ` : '¡'}qué bien! 🌟 Mira los horarios que te encontré con *${epsName}*: ${inline}. Cuéntame con cuál te quedas — me respondes con la letra. ✍️`,
      `${nombre ? `${nombre}, ` : ''}¡con gusto! Estos son los espacios que tengo para ti con *${epsName}*: ${inline}. Dime cuál te sirve mejor, mándame la letra. 😊`,
      `${nombre ? `Listo, ${nombre}: ` : 'Listo: '}aquí va la agenda para *${epsName}*: ${inline}. Elige el horario que más te acomode (mándame la letra). ✍️`,
    ]);
  },

  preguntaWaitlist: (servicio: string, eps: string) =>
    pick([
      `Mira, revisé bien la agenda de *${servicio}* con *${eps}* y por ahora no veo cupos. 😔 Pero no te preocupes — si quieres te anoto en la *lista de espera* y te aviso por acá apenas se libere un espacio. ✨ ¿Te animas? Responde *SÍ* para anotarte o *NO* si prefieres intentar después.`,
      `${servicio} con *${eps}* está full estos días. 😅 Pero tengo una idea: ¿quieres que te apunte en la *lista de espera*? En cuanto alguien libere un cupo te escribo para reservártelo. ✅ *SÍ* para anotarte, *NO* para dejarlo. Con toda confianza.`,
      `Acabo de mirar y la agenda de *${servicio}* (${eps}) está llenita. 🙏 Te puedo dejar en la *lista de espera* y te aviso apenas se abra algo — sin compromiso. 🤝 ¿Te parece? *SÍ* o *NO*.`,
    ]),

  unidoAWaitlist: (nombre: string, servicio: string, position: number) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! 🎟️ Te anoté en la lista de espera para *${servicio}* — quedaste en la posición *#${position}*. Pendiente de tu WhatsApp: apenas se libere un cupo te escribo de una. ✨ Que tengas un día muy bonito. 😊`,
      `${nombre ? `Perfecto, ${nombre}. ` : 'Perfecto. '}Ya quedaste apuntado(a) en la cola de *${servicio}* (posición *#${position}*). 🎟️ Apenas se abra un espacio, te aviso por acá. 💚 ¡Cuídate mucho!`,
      `¡Hecho${nombre ? `, ${nombre}` : ''}! 🌟 Te agregué a la lista para *${servicio}*, vas en la posición *#${position}*. Te escribo en cuanto tenga novedades. 🙏 Mientras tanto, ¡que estés muy bien!`,
    ]),

  noUnidoAWaitlist: () =>
    pick([
      `Listo, sin problema. 😊 Cuando quieras intentarlo otra vez, me escribes *"Hola"* y seguimos. ¡Que estés muy bien! 👋`,
      `Como quieras, no te preocupes. 🌻 Aquí estaré cuando quieras — solo dime *"Hola"*. ¡Hasta pronto!`,
      `Perfecto, lo dejamos así. 😊 Cualquier cosa, escríbeme *"Hola"* y te atiendo. Que tengas un día genial. 🌟`,
    ]),

  sinDisponibilidad: (nombre: string, epsName: string, especialidad: string, position: number) =>
    `${nombre}, revisé la agenda para *${epsName}* en *${especialidad}* y ahorita no hay cupos. 😔 Pero tranqui(la), ya te agregué a la lista de espera (posición *#${position}*). En cuanto se libere algo, te escribo. ✨ ¿Algo más en lo que te pueda ayudar?`,

  pedirCedulaPostSlot: (fechaFormateada: string) =>
    pick([
      `¡Genial! 🌟 Te aparté ese horario: 📅 *${fechaFormateada}*. Para terminar de agendarte, ¿me regalas tu *número de cédula*?`,
      `¡Perfecto, ya casi! 😊 Te reservé tentativamente 📅 *${fechaFormateada}*. Me falta solo un datico: ¿me compartes tu *cédula*?`,
      `¡Listo! 🎯 Tengo ese cupo apartado para ti: 📅 *${fechaFormateada}*. Para cerrar, ¿me mandas tu *número de cédula*? Solo el número, sin puntos.`,
    ]),

  especialidadConfirmada: (especialidad: string) =>
    `¡Listo, *${especialidad}*! 🩺 Para revisarte la agenda, ¿me pasas tu *cédula*?`,

  pedirCedula: (especialidad: string) =>
    `Anotado, vas por *${especialidad}*. 🩺 ¿Me compartes tu *cédula*? Solo el número.`,

  primeraVez: () =>
    pick([
      `¡Qué bueno tenerte por aquí por primera vez! 🤝 Para registrarte, ¿me pasas tu *nombre completo*?`,
      `¡Bienvenido(a)! Es un gusto atenderte por primera vez. 🌟 Cuéntame tu *nombre completo* para abrirte tu historia.`,
      `¡Mucho gusto! 😊 No te tengo registrado aún — ¿me dices tu *nombre completo* para crearte el perfil?`,
    ]),

  // ACK del Primer Turno (Fase 2): confirma lo que el Agente entendió del
  // primer mensaje, en tono cercano, antes de pedir lo que falta.
  ackTurno1: (p: {
    nombre?: string | null;
    cedula?: string | null;
    especialidad?: string | null;
    eps?: string | null;
    fecha?: string | null;
  }) => {
    const detalles: string[] = [];
    if (p.nombre) detalles.push(`👤 *Paciente:* ${p.nombre}`);
    if (p.cedula) detalles.push(`🪪 *Cédula:* ${p.cedula}`);
    if (p.especialidad) detalles.push(`🏥 *Servicio:* ${p.especialidad}`);
    if (p.eps) detalles.push(`💳 *EPS:* ${p.eps}`);
    if (p.fecha) detalles.push(`📅 *Fecha que pediste:* ${p.fecha}`);
    const saludo = p.nombre ? `¡Hola, ${p.nombre}!` : '¡Hola!';
    const bloque = detalles.length
      ? `\n\nListo, ya anoté:\n${detalles.join('\n')}`
      : '';
    return `${saludo} 👋 De una te ayudo a agendar tu cita.${bloque}`;
  },

  // Re-presentación cálida cuando el paciente confirma que SÍ quiere agendar
  // estando en el paso de selección de servicio, pero su texto no mapeó.
  repromptAgendarServicio: (lineas: string) =>
    `¡De una, te ayudo a agendar! 🗓️\n\n` +
    `*¿Cuál de estos servicios necesitas?* Puedes responder con la letra o el nombre:\n\n${lineas}`,

  // Igual, pero en el paso de selección de EPS.
  repromptAgendarEps: (lineas: string) =>
    `¡Listo, sigamos! 🗓️\n\n*¿Con cuál EPS quieres tu cita?*\n\n${lineas}`,

  resumenCita: (nombre: string, cedula: string, eps: string, especialidad: string, fecha: string) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! Revisemos los datos antes de cerrar: 👤 *Paciente:* ${nombre} · 🪪 *Cédula:* ${cedula} · 💳 *EPS:* ${eps} · 🏥 *Servicio:* ${especialidad} · 📅 *Fecha y hora:* ${fecha}. ¿Todo bien? Responde *SÍ* para confirmarte la cita o *NO* si quieres cambiar algo.`,
      `¡Perfecto${nombre ? `, ${nombre}` : ''}! Mira los datos que tengo: 👤 ${nombre} · 🪪 Cédula ${cedula} · 💳 EPS ${eps} · 🏥 ${especialidad} · 📅 ${fecha}. Si está bien, responde *SÍ* y te la dejo confirmada; si algo no, dime *NO*.`,
      `Ya casi terminamos${nombre ? `, ${nombre}` : ''} 🌟. Estos son tus datos: 👤 ${nombre} · 🪪 ${cedula} · 💳 ${eps} · 🏥 ${especialidad} · 📅 ${fecha}. ¿Cerramos? *SÍ* para agendar, *NO* si prefieres cancelar.`,
    ]),

  citaConfirmada: (clinicaName: string, fecha: string) =>
    pick([
      `¡Listo, todo confirmado! 🎉 Tu cita ya quedó en *${clinicaName}* para 📅 _${fecha}_. Llega por favor *15 minutos antes* y trae tu *cédula*. 🪪 Cualquier cosa, acá estoy. ¡Que estés muy bien! 😊`,
      `¡Hecho! 🌟 Tu cita en *${clinicaName}* quedó agendada 📅 _${fecha}_. Recuerda llegar *15 min antes* con tu *cédula*. 🪪 ¡Gracias por confiar en nosotros! 💚`,
      `¡Quedó lista! 🎊 Tienes cita confirmada en *${clinicaName}* para 📅 _${fecha}_. Por favor sé puntual: llega *15 min antes* y trae tu *documento*. 🪪 ¡Hasta pronto! 👋`,
    ]),

  citaNoConfirmada: () =>
    pick([
      `Listo, sin problema, cancelé la solicitud. 😊 Cuando quieras intentarlo otra vez, me escribes *"Hola"* y vamos.`,
      `Tranqui(la), lo dejamos por ahora. 🌻 Cuando quieras retomar, me dices *"Hola"*.`,
      `No te preocupes, no se agendó nada. 😊 Cuando estés listo(a), escríbeme *"Hola"* y arrancamos otra vez.`,
    ]),

  slotTomado: () =>
    pick([
      `Uy, qué pena, justo ese horario lo acaba de tomar otro paciente. 😬 ¿Vemos otro? Mándame la letra de nuevo, por favor.`,
      `Ay, perdón, ese cupito acaba de reservarse. 🙏 ¿Cuál otro te sirve? Dime la letra.`,
    ]),

  errorSlotInvalido: () =>
    pick([
      `Mmm, esa letra no la veo entre las opciones que te mandé. 🙏 ¿Me la confirmas? Puedes responderme con la letra _(A, B, C...)_ o escribirme *"Salir"* si quieres terminar.`,
      `Perdón, no encontré esa opción. 😊 Respóndeme con una de las letras _(A, B, C...)_ o escribe *"Salir"* para cancelar.`,
    ]),

  waitlistCupoDisponible: (nombre: string, especialidad: string, fecha: string, doctor: string) =>
    pick([
      `🔔 ¡Hey ${nombre}, tengo súper buenas noticias! Se liberó un cupo para *${especialidad}* y tú eras la siguiente en la lista. 🌟 📅 *${fecha}* · 👨‍⚕️ Dr(a). ${doctor}. Te lo aparto por *30 minutos*. ¿Lo tomas? Responde *SÍ* para confirmarte o *NO* si ya no lo necesitas.`,
      `🔔 ¡${nombre}, buena noticia! 🌟 Se abrió un espacio para *${especialidad}* y te toca a ti, eras la primera en espera: 📅 *${fecha}* · 👨‍⚕️ Dr(a). ${doctor}. Tienes *30 minutos* para confirmarme. ¿Te lo dejo? *SÍ* o *NO*.`,
    ]),

  waitlistCupoRechazado: () =>
    pick([
      `¡Sin problema! 😊 Libero el cupo entonces. Tranqui(la), sigues en la lista y te aviso cuando aparezca otro. ✨ ¡Que estés muy bien! 👋`,
      `Listo, como quieras. 🌻 Libero el cupo para otro paciente que también lo está esperando. Sigues en la lista. 💚`,
    ]),

  waitlistExpirado: () =>
    pick([
      `Uy, se nos pasó el tiempo para confirmar ese cupo. ⏰ Si aún quieres una cita, escríbeme *"Hola"* y te anoto de nuevo. 😊`,
      `Perdón, venció el tiempo para reservar ese cupo. 🙏 Si quieres volver a intentarlo, mándame *"Hola"* y seguimos. 💚`,
    ]),

  escape: () =>
    pick([
      `¡Listo, arrancamos de cero! 😊 Cuéntame, ¿en qué te puedo ayudar?`,
      `Sin problema, refrescamos. 🌻 ¿Qué necesitas hoy?`,
      `Tranqui(la), volvemos a empezar. 😊 Dime, ¿qué te ayudo a buscar?`,
    ]),

  outOfContext: (botName: string = BOT_NAME) =>
    pick([
      `Perdón, soy *${botName}* y solo te puedo ayudar con el agendamiento de citas médicas. 🏥 ¿Qué especialidad o médico estás buscando?`,
      `Mi trabajito es ayudarte a agendar citas. 😊 Cuéntame, ¿qué servicio o médico necesitas?`,
      `Yo solo te puedo colaborar con citas médicas. 🙏 ¿Qué especialidad necesitas o con cuál doctor te gustaría agendar?`,
    ]),

  guardrailInsulto: (phone: string, _botName: string = BOT_NAME) =>
    `Hey, entiendo que puedas estar molesto(a), pero por aquí solo te puedo ayudar con tu agendamiento y necesito que mantengamos un trato respetuoso. 🙏 Si necesitas atención adicional, te dejo nuestra línea de soporte: 👉 *${phone}*. Por seguridad, cierro la conversación. Cuando quieras retomar, acá estaré. 💚`,

  guardrailOffTopic: (phone: string, botName: string = BOT_NAME) =>
    `Uy, parece que no estoy logrando entenderte dentro del agendamiento. 🙏 Mejor te paso con nuestro equipo humano para que te atiendan: 👉 *${phone}*. Cuando quieras intentarlo conmigo otra vez, solo escríbeme *"Hola"* y *${botName}* te atiende. 😊`,

  ininteligible: () =>
    pick([
      `🎙️ Uy, perdón, no logré escucharte/entenderte bien. ¿Me lo repites despacito o me lo escribes?`,
      `🎙️ No te capté bien, perdón. 😊 ¿Me lo mandas otra vez o me lo escribes?`,
      `🎙️ Perdón, no me quedó claro. ¿Me lo reenvías o me lo escribes? 🙏`,
    ]),

  iaCaida: (phone: string) =>
    `Uy, qué pena: el sistema está pasando por un mantenimiento breve. 🛠️ Mientras tanto, comunícate al *${phone}* para que te atiendan directamente. 🙏 ¡Gracias por tu paciencia!`,

  maxReintentos: (phone: string) =>
    `Perdón, parece que no estamos logrando entendernos. 😔 Para no hacerte perder tiempo, te paso con nuestro equipo humano: 👉 https://wa.me/${phone}. Te atienden enseguida con gusto.`,

  maxReintentosReset: () =>
    pick([
      `Para no enredarte más, reinicié la conversación. 🔄 Cuando quieras retomar, escríbeme *"Hola"* y arrancamos limpio. 😊`,
      `Perdón, mejor arrancamos de cero. 🌻 Mándame *"Hola"* cuando estés listo(a) y seguimos con calma.`,
    ]),

  sesionExpirada: () =>
    pick([
      `Uy, qué pena, tu sesión se venció antes de poder confirmar. ⏳ No te preocupes, escríbeme *"Hola"* y empezamos otra vez. 😊`,
      `Se nos pasó el tiempo de la sesión, perdón. 🙏 Cuando quieras volver, mándame *"Hola"* y te atiendo. 💚`,
    ]),

  cancelarPedirCedula: () =>
    pick([
      `Claro que sí, te ayudo a cancelar tu cita. 📋 Para buscarla, ¿me pasas la *cédula* del paciente?`,
      `Con gusto te ayudo con eso. 😊 ¿Me compartes la *cédula* del paciente para buscar la cita?`,
    ]),

  cancelarCedulaInvalida: () =>
    pick([
      `Mmm, ese número no me parece una cédula válida. 🙏 ¿Me la confirmas? Solo el número, sin puntos ni espacios. _(Ej: 18531928)_`,
      `Perdón, no logré identificar el número. 😊 Mándame solo los dígitos, sin separadores. _(Ej: 1088123456)_`,
    ]),

  cancelarPacienteNoExiste: (cedula: string) =>
    pick([
      `Hmm, busqué y no encuentro a ningún paciente con la cédula *${cedula}*. 🔍 ¿Me la confirmas? O si quieres terminar, escríbeme _*"Salir"*_.`,
      `Perdón, esa cédula *${cedula}* no me aparece. 🙏 ¿La revisamos otra vez? Si gustas terminar, mándame _*"Salir"*_.`,
    ]),

  cancelarSinCitas: (cedula: string) =>
    `Revisé y el paciente con cédula *${cedula}* no tiene citas próximas. 📭 ¿Te ayudo a agendar una nueva?`,

  cancelarSeleccionar: (nombre: string, lineas: string) => {
    const inline = INFORMAL._flat(lineas);
    return pick([
      `Listo, encontré estas citas a nombre de *${nombre}*: ${inline}. ¿Cuál quieres cancelar? Mándame la letra.`,
      `Acá están las citas que tengo para *${nombre}*: ${inline}. Dime con la letra cuál es la que quieres cancelar. 😊`,
    ]);
  },

  cancelarConfirmar: (servicio: string, doctor: string, fecha: string) =>
    `Para confirmarte, esta es la cita que vamos a cancelar: 🏥 *${servicio}* · 👨‍⚕️ Dr(a). ${doctor} · 📅 ${fecha}. ⚠️ ¿Seguro(a)? Responde *SÍ* para cancelarla o *NO* si prefieres dejarla.`,

  cancelarExitosa: () =>
    pick([
      `✅ ¡Listo! Tu cita quedó *cancelada* y el cupo ya está libre para otro paciente. 🗓️`,
      `✅ Hecho, cancelé tu cita y liberé el espacio. 🙏`,
      `✅ Perfecto, cita cancelada y cupo disponible para alguien más. 💚`,
    ]),

  cancelarOfreceAgendar: () =>
    pick([
      `¿Te ayudo a agendar en *otro horario disponible*? Cuéntame. *SÍ* para seguir, *NO* si por ahora no.`,
      `Si quieres te busco *otro horarito* que te acomode. ¿Te animas? *SÍ* para seguir, *NO* para terminar.`,
    ]),

  cancelarDespedida: () =>
    pick([
      `¡Listo, que tengas un día muy bonito! 😊 Cuando me necesites, acá estaré. ¡Hasta pronto! 👋`,
      `¡Perfecto, cuídate mucho! 🌻 Cualquier cosa, escríbeme y te atiendo. ¡Que estés muy bien!`,
      `¡Listo, gracias por escribir! 💚 Que pases un día genial. Cualquier cosita, me dices *"Hola"*. 👋`,
    ]),

  despedidaCorta: () =>
    pick([
      `¡Fue un gusto atenderte! 😊 Que tengas un día muy bonito. Cuando me necesites, acá me tienes. 👋`,
      `¡Con gusto! 🌻 Que estés muy bien. Cualquier cosita, me escribes *"Hola"*. 💚`,
      `¡Listo, hasta luego! 😊 Que tengas un día lindo. Acá estaré cuando me necesites. 👋`,
    ]),

  cancelarAbortada: () =>
    pick([
      `✅ ¡Perfecto! Tu cita sigue *activa*, sin cambios. ¿Te ayudo en algo más?`,
      `✅ Tranqui(la), no toqué nada — tu cita sigue *firme*. 😊 ¿Te colaboro con otra cosita?`,
    ]),

  cancelarError: () =>
    `Uy, qué pena, tuve un inconveniente cancelando la cita. 😔 Para no dejarte a medias, llama al Call Center y ahí te ayudan enseguida. 🙏`,

  respuestaInvalidaSiNo: () =>
    pick([
      `Mmm, no te entendí. 🙏 ¿Me ayudas respondiendo *SÍ* o *NO*?`,
      `Perdón, para este paso necesito un *SÍ* o un *NO*, porfa. 😊`,
      `Para no equivocarme, ¿me confirmas con *SÍ* o *NO*?`,
    ]),

  audioPasoEstricto: () =>
    `🎙️ Para este pasito, mejor respóndeme por *texto* _(la letra o un SÍ/NO)_ — así evitamos confusiones. 🙏`,

  inactividad: () =>
    `Hola, ¿cómo estás? Cerré la conversación por inactividad para cuidar tus datos. 🔒 Cuando quieras retomar, escríbeme *"Hola"* y te atiendo. 😊`,
};

// ─────────────────────────────────────────────────────────────
// Factory: devuelve el pool de mensajes según el estilo activo.
// Ambos pools comparten exactamente la misma shape, por lo que
// el código consumidor puede usar el resultado como reemplazo
// drop-in de MSGS.
// ─────────────────────────────────────────────────────────────
export type Messages = typeof FORMAL;

export function buildMessages(style: CommStyle = 'FORMAL'): Messages {
  return style === 'INFORMAL' ? INFORMAL : FORMAL;
}

// Export default (compat hacia atrás): pool FORMAL.
export const MSGS: Messages = FORMAL;

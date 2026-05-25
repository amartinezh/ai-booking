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
  // Estado de transición: el paciente pidió cancelar mientras agendaba.
  // Guardamos el estado previo y esperamos un SÍ/NO antes de abortar.
  AWAITING_INTERRUPT_CONFIRMATION = 'AWAITING_INTERRUPT_CONFIRMATION',
  // ── FLUJO DE MODIFICACIÓN (reprogramación de fecha) ──────────
  // El paciente quiere cambiar la fecha de una cita existente. Pasos:
  //   CEDULA → SELECTION (si tiene varias) → NEW_SLOT → CONFIRM.
  // Si no hay cupos para reprogramar, NO_SLOTS_CANCEL ofrece cancelarla.
  AWAITING_MODIFY_CEDULA = 'AWAITING_MODIFY_CEDULA',
  // La cédula consultada no tenía citas: preguntamos si desea intentar con otra
  // (SÍ → vuelve a AWAITING_MODIFY_CEDULA; NO → cierra). El loop también lo cierra
  // el cron de inactividad si el paciente deja de responder.
  AWAITING_MODIFY_RETRY_CEDULA = 'AWAITING_MODIFY_RETRY_CEDULA',
  AWAITING_MODIFY_SELECTION = 'AWAITING_MODIFY_SELECTION',
  AWAITING_MODIFY_NEW_SLOT = 'AWAITING_MODIFY_NEW_SLOT',
  AWAITING_MODIFY_CONFIRM = 'AWAITING_MODIFY_CONFIRM',
  AWAITING_MODIFY_NO_SLOTS_CANCEL = 'AWAITING_MODIFY_NO_SLOTS_CANCEL',
}

// Nombre canónico del registro EPS para pago directo (debe existir en BD por org).
export const PARTICULAR_EPS_NAME = 'Particular';

// Valor por defecto de reintentos. La cifra efectiva se lee de OrganizationSettings.
export const DEFAULT_MAX_RETRIES = 3;

// Tiempo de expiración de la sesión conversacional en Redis (1 hora)
export const SESSION_TTL = 3600;

// Longitud mínima de dígitos para considerar una cédula válida.
export const MIN_CEDULA_LENGTH = 4;

// Timeout para el mapeo semántico de catálogo (servicio/EPS) vía LLM.
// Si la API tarda más, caemos al menú determinista (no degrada la UX de voz).
export const SEMANTIC_MAP_TIMEOUT_MS = 2500;

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
// POOL FORMAL  — Voz: recepcionista clínica institucional, "usted",
// tono neutral y resolutivo. Sin diminutivos, sin interjecciones
// emocionales y con emojis limitados a función estructural.
// Estructura clara con viñetas A) B) C) en líneas separadas.
// ═════════════════════════════════════════════════════════════
const FORMAL = {
  bienvenida: (clinicaName: string, servicios: string, botName: string = BOT_NAME) =>
    pick([
      `Buen día, soy *${botName}*, asistente de *${clinicaName}*.\n\n` +
        `Con gusto le ayudo a agendar su cita de forma ágil. 🏥\n\n` +
        `¿Para qué especialidad necesita su cita hoy?\n` +
        `_${servicios}_`,
      `Le saluda *${botName}*, su asistente de *${clinicaName}*.\n\n` +
        `Estoy a su disposición para agendar su cita de manera ágil y sencilla. 🏥\n\n` +
        `¿En qué servicio le puedo colaborar el día de hoy?\n` +
        `_${servicios}_`,
      `Bienvenido(a) a *${clinicaName}*. Soy *${botName}*, su asistente virtual.\n\n` +
        `Será un gusto ayudarle con su agendamiento. 🏥\n\n` +
        `Para comenzar, ¿qué especialidad está buscando?\n` +
        `_${servicios}_`,
    ]),

  menuServicios: (clinicaName: string, lineas: string, botName: string = BOT_NAME) =>
    pick([
      `Le saluda *${botName}*, su asistente en *${clinicaName}*.\n\n` +
        `Con gusto le ayudo a agendar su cita el día de hoy. 🏥\n\n` +
        `*¿En qué servicio le puedo colaborar?* Puede responder con la letra:\n\n` +
        `${lineas}\n` +
        `_También puede escribir el nombre del servicio o enviar un audio de voz._ 🎙️`,
      `Le habla *${botName}*, de *${clinicaName}*.\n\n` +
        `Permítame ayudarle a reservar su cita médica de forma ágil. 🏥\n\n` +
        `*¿Qué servicio necesita?* Estas son las opciones disponibles:\n\n` +
        `${lineas}\n` +
        `_Puede responder con la letra, el nombre del servicio o un audio._ 🎙️`,
      `Soy *${botName}*, su asistente virtual de *${clinicaName}*.\n\n` +
        `Estoy aquí para que su agendamiento sea sencillo. 🏥\n\n` +
        `*¿Cuál de estos servicios necesita hoy?*\n\n` +
        `${lineas}\n` +
        `_Responda con la letra, escriba el nombre o envíe un audio, como prefiera._ 🎙️`,
    ]),

  servicioInvalido: (lineas: string) =>
    pick([
      `Disculpe, no logré entender bien su respuesta.\n\n` +
        `¿Me podría confirmar el servicio? Puede responder con la letra ` +
        `_(ej: A, B, C...)_ o escribir el nombre directamente.\n\n${lineas}`,
      `Esa opción no se logró identificar.\n\n` +
        `Intentémoslo de nuevo: responda con la letra _(A, B, C...)_ o escriba el nombre del servicio.\n\n${lineas}`,
      `El sistema no logró interpretar su respuesta. ¿Lo intentamos otra vez?\n\n` +
        `Puede elegir una letra _(A, B, C...)_ o escribir el nombre del servicio.\n\n${lineas}`,
    ]),

  menuEps: (servicio: string, lineas: string) =>
    pick([
      `Perfecto, *${servicio}*. 🩺\n\n` +
        `Para buscar el mejor espacio disponible, ¿a qué *EPS o aseguradora* está afiliado(a)?\n\n` +
        `Puede responder con la letra o escribir el nombre:\n\n${lineas}\n` +
        `_Si paga directamente la consulta, elija *Particular*._ 💳`,
      `Anotado: *${servicio}*. 🩺\n\n` +
        `Para revisar la agenda disponible, indíqueme con cuál *EPS* viene hoy:\n\n${lineas}\n` +
        `_Si paga por su cuenta, seleccione *Particular*._ 💳`,
      `Continuemos con *${servicio}*. 🩺 Siguiente paso:\n\n` +
        `¿Me indica el nombre de su *EPS* para verificar la disponibilidad? Puede elegir una opción o escribirla:\n\n${lineas}\n` +
        `_Si su consulta es particular, marque *Particular*._ 💳`,
    ]),

  epsInvalida: (lineas: string) =>
    pick([
      `Disculpe, no logré identificar esa EPS.\n\n` +
        `¿Me la confirma, por favor? Puede elegir la letra _(A, B, C...)_ o escribir el nombre:\n\n${lineas}`,
      `El sistema no logró interpretar la EPS. Intentémoslo de nuevo:\n\n` +
        `Responda con la letra o escriba el nombre completo, como prefiera:\n\n${lineas}`,
      `No fue posible ubicar esa opción dentro de nuestros convenios.\n\n` +
        `¿Me la repite, por favor? Aquí están las opciones nuevamente:\n\n${lineas}`,
    ]),

  pedirEps: () =>
    pick([
      `Para revisar la disponibilidad, ¿me indica el nombre de su *EPS o aseguradora*, por favor?\n\n` +
        `_(Si paga directamente la consulta, escriba *"Particular"*.)_ 💳`,
      `¿Con cuál *EPS* viene hoy? Así le busco el mejor espacio.\n\n` +
        `_(Si es por cuenta propia, escriba *"Particular"*.)_ 💳`,
    ]),

  epsNoEncontrada: (epsQuery: string) =>
    pick([
      `Disculpe, no logré encontrar la EPS *"${epsQuery}"* en nuestros convenios.\n\n` +
        `¿Me la confirma, por favor? _(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular...)_`,
      `La EPS *"${epsQuery}"* no aparece registrada.\n\n` +
        `¿Me la escribe nuevamente? _(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular...)_`,
    ]),

  epsInactiva: (epsName: string) =>
    pick([
      `En este momento no tenemos convenio activo con *${epsName}*.\n\n` +
        `¿Desea continuar como *Particular* o cuenta con otra EPS?`,
      `Disculpe, por ahora no estamos atendiendo el convenio con *${epsName}*.\n\n` +
        `Si lo prefiere, podemos agendarle como *Particular*, o indíqueme si cuenta con otra EPS.`,
    ]),

  cuposDisponibles: (nombre: string, epsName: string, lineas: string) =>
    pick([
      `${nombre ? `${nombre}, ` : ''}estos son los horarios que encontré con *${epsName}*:\n\n${lineas}\n` +
        `_Responda con la letra del horario que más le acomode, por favor._`,
      `${nombre ? `${nombre}, ` : ''}con gusto. Estos son los espacios disponibles para *${epsName}*:\n\n${lineas}\n` +
        `_Indíqueme cuál le sirve mejor: responda con la letra._`,
      `${nombre ? `Listo, ${nombre}: ` : 'Listo: '}esta es la agenda disponible para *${epsName}*:\n\n${lineas}\n` +
        `_Elija el horario que más le convenga (responda con la letra)._`,
    ]),

  preguntaWaitlist: (servicio: string, eps: string) =>
    pick([
      `Revisé la agenda para *${servicio}* con *${eps}* y por el momento no hay cupos disponibles.\n\n` +
        `Si lo desea, le anoto en nuestra *lista de espera* y le aviso por este medio en cuanto se libere un espacio.\n\n` +
        `¿Le parece bien? Responda *SÍ* para anotarle o *NO* si prefiere intentarlo más adelante.`,
      `La agenda de ${servicio.toLowerCase()} con *${eps}* está completa por estos días.\n\n` +
        `¿Desea que le anote en la *lista de espera*? En cuanto se libere un cupo, le escribo para reservárselo.\n\n` +
        `Responda *SÍ* o *NO*.`,
      `Por el momento la agenda de *${servicio}* (${eps}) está completa.\n\n` +
        `Si lo desea, puedo dejarle anotado(a) en la *lista de espera* y le aviso apenas se abra un espacio, sin compromiso.\n\n` +
        `¿Le parece? *SÍ* para anotarle, *NO* para dejarlo así.`,
    ]),

  unidoAWaitlist: (nombre: string, servicio: string, position: number) =>
    pick([
      `Listo${nombre ? `, ${nombre}` : ''}. Le anoté en la lista de espera para *${servicio}* — quedó en la posición *#${position}*.\n\n` +
        `Esté pendiente de su WhatsApp: apenas se libere un cupo, le escribo. Que tenga un buen día.`,
      `${nombre ? `Perfecto, ${nombre}. ` : 'Perfecto. '}Quedó anotado(a) en la lista de espera de *${servicio}* (posición *#${position}*).\n\n` +
        `En cuanto se libere un espacio, le aviso por este medio.`,
      `Hecho${nombre ? `, ${nombre}` : ''}. Le agregué a la lista para *${servicio}*, en la posición *#${position}*.\n\n` +
        `Le escribo apenas tenga novedades para usted.`,
    ]),

  noUnidoAWaitlist: () =>
    pick([
      `Entendido, no le anoto en la lista.\n\n` +
        `Cuando quiera intentarlo nuevamente, escríbame *"Hola"* y con gusto le atiendo. Que tenga un buen día.`,
      `Como prefiera.\n\n` +
        `Aquí estaré cuando quiera retomar — escríbame *"Hola"* y continuamos.`,
      `Lo dejamos así por ahora.\n\n` +
        `Cuando lo necesite, escríbame *"Hola"* y le ayudo. Que tenga un excelente día.`,
    ]),

  sinDisponibilidad: (nombre: string, epsName: string, especialidad: string, position: number) =>
    `${nombre}, revisé la agenda para *${epsName}* en *${especialidad}* ` +
    `y por el momento no hay cupos abiertos.\n\n` +
    `Ya le agregué a la lista de espera (posición *#${position}*). ` +
    `En cuanto se libere un espacio, le aviso por este medio.\n\n` +
    `¿Hay algo más en lo que le pueda colaborar?`,

  pedirCedulaPostSlot: (fechaFormateada: string) =>
    pick([
      `Excelente elección. Le aparté ese horario:\n📅 *${fechaFormateada}*\n\n` +
        `Para terminar de agendarle, ¿me indica su *número de cédula*, por favor?`,
      `Perfecto, ya casi terminamos. Le reservé tentativamente:\n📅 *${fechaFormateada}*\n\n` +
        `Solo me falta confirmar un dato: ¿me comparte su *cédula*?`,
      `Listo. Tengo ese espacio reservado para usted:\n📅 *${fechaFormateada}*\n\n` +
        `Para finalizar, ¿me indica su *número de cédula*? Solo el número, sin puntos.`,
    ]),

  especialidadConfirmada: (especialidad: string) =>
    `Perfecto, anotado: *${especialidad}*. 🩺\n\nPara revisar la agenda, ¿me indica su *número de cédula*?`,

  pedirCedula: (especialidad: string) =>
    `Anotado, busca cita para *${especialidad}*. 🩺\n\n¿Me comparte su *número de cédula*? Solo el número, sin puntos ni guiones.`,

  primeraVez: () =>
    pick([
      `Es un gusto recibirle por primera vez.\n\nPara registrarle en el sistema, ¿me indica su *nombre completo*, por favor?`,
      `Bienvenido(a). Es un gusto atenderle por primera vez.\n\nIndíqueme su *nombre completo* para abrir su historia con nosotros.`,
      `Es la primera vez que le atendemos por aquí.\n\n¿Me indica su *nombre completo* para registrarle como nuevo paciente?`,
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
    const saludo = p.nombre ? `Hola, ${p.nombre}.` : 'Buen día.';
    const bloque = detalles.length
      ? `\n\nEntendido, ya tomé nota de:\n${detalles.join('\n')}`
      : '';
    return `${saludo} Con gusto le ayudo a agendar su cita.${bloque}`;
  },

  // Re-presentación cuando el paciente confirma que SÍ quiere agendar
  // (o expresa intención de cita) estando en el paso de selección de servicio,
  // pero su texto no mapeó a una opción. Evita el mensaje de "no entendí".
  repromptAgendarServicio: (lineas: string) =>
    `Perfecto, con gusto le agendo su cita. 📅\n\n` +
    `*¿Cuál de estos servicios necesita?* Puede responder con la letra o el nombre:\n\n${lineas}`,

  // Igual, pero en el paso de selección de EPS.
  repromptAgendarEps: (lineas: string) =>
    `Perfecto, continuemos. 📅\n\n*¿Con cuál EPS o entidad desea su cita?*\n\n${lineas}`,

  resumenCita: (nombre: string, cedula: string, eps: string, especialidad: string, fecha: string) =>
    pick([
      `Listo${nombre ? `, ${nombre}` : ''}. Confirmemos los datos de su cita antes de agendarle:\n\n` +
        `👤 *Paciente:* ${nombre}\n🪪 *Cédula:* ${cedula}\n💳 *EPS:* ${eps}\n🏥 *Servicio:* ${especialidad}\n📅 *Fecha y hora:* ${fecha}\n\n` +
        `¿Está todo correcto? Responda *SÍ* para agendarle definitivamente o *NO* si necesita cambiar algo.`,
      `Perfecto${nombre ? `, ${nombre}` : ''}. Reviso con usted la información antes de cerrar:\n\n` +
        `👤 ${nombre}\n🪪 Cédula ${cedula}\n💳 EPS: ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `Si todo está bien, responda *SÍ* y lo dejo confirmado. Si algo no corresponde, escriba *NO*.`,
      `Ya casi terminamos${nombre ? `, ${nombre}` : ''}. Estos son los datos de su cita:\n\n` +
        `👤 ${nombre}\n🪪 ${cedula}\n💳 ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `¿Lo confirmamos? Responda *SÍ* para agendarle o *NO* si prefiere cancelar.`,
    ]),

  citaConfirmada: (clinicaName: string, fecha: string) =>
    pick([
      `Todo quedó confirmado. Su cita está reservada en *${clinicaName}*.\n\n📅 _${fecha}_\n\n` +
        `Le pido llegar *15 minutos antes* y traer su *documento de identidad*. 🪪\n\nQuedo atento(a) a cualquier inquietud.`,
      `Su cita en *${clinicaName}* quedó agendada con éxito.\n\n📅 _${fecha}_\n\n` +
        `Recuerde llegar *15 minutos antes* con su *cédula*. 🪪\n\nGracias por confiar en nosotros.`,
      `Su cita quedó confirmada en *${clinicaName}*.\n\n📅 _${fecha}_\n\n` +
        `Por favor sea puntual: llegue *15 minutos antes* y traiga su *documento*. 🪪\n\nQue tenga un excelente día.`,
    ]),

  citaNoConfirmada: () =>
    pick([
      `Entendido, cancelé la solicitud.\n\nCuando quiera intentarlo de nuevo, escríbame *"Hola"* y con gusto le ayudo.`,
      `Sin problema, lo dejamos por ahora.\n\nAquí estaré cuando quiera retomar — solo escríbame *"Hola"* y continuamos.`,
      `No se agendó nada todavía.\n\nCuando esté listo(a), escríbame *"Hola"* y lo intentamos otra vez. Que tenga un buen día.`,
    ]),

  slotTomado: () =>
    pick([
      `Lo lamento, ese horario lo acaba de tomar otro paciente.\n\n¿Elegimos otro de los disponibles? Escriba la letra nuevamente, por favor.`,
      `Disculpe, ese espacio acaba de reservarse.\n\n¿Vemos otra opción? Indíqueme con qué letra prefiere quedarse.`,
    ]),

  errorSlotInvalido: () =>
    pick([
      `Esa letra no aparece entre las opciones que le envié.\n\n¿Me la confirma, por favor? Recuerde que puede responder con la letra _(A, B, C...)_ o escribir *"Salir"* si prefiere cancelar.`,
      `Disculpe, no fue posible ubicar esa opción.\n\nResponda con una de las letras disponibles _(A, B, C...)_ o escriba *"Salir"* si desea terminar el proceso.`,
    ]),

  waitlistCupoDisponible: (nombre: string, especialidad: string, fecha: string, doctor: string) =>
    pick([
      `🔔 ${nombre}, tengo buenas noticias.\n\n` +
        `Se acaba de liberar un cupo en *${especialidad}* y usted era la siguiente persona en la lista.\n\n` +
        `📅 *${fecha}*\n👨‍⚕️ Dr(a). ${doctor}\n\nLe reservé este cupo por *30 minutos*. ¿Le interesa tomarlo?\n\nResponda *SÍ* para confirmarlo o *NO* si ya no lo necesita.`,
      `🔔 ${nombre}, le tengo una buena noticia.\n\n` +
        `Se liberó un espacio para *${especialidad}* y le corresponde a usted, que era la primera persona en espera.\n\n` +
        `📅 *${fecha}*\n👨‍⚕️ Dr(a). ${doctor}\n\nLe aparté el cupo por *30 minutos*. ¿Desea tomarlo?\n\nConfírmeme con *SÍ* o, si ya no le sirve, escriba *NO*.`,
    ]),

  waitlistCupoRechazado: () =>
    pick([
      `Sin problema. Libero ese cupo para otro paciente.\n\nUsted sigue en nuestra lista y le aviso apenas haya otra disponibilidad. Que tenga un excelente día.`,
      `Como prefiera. Libero el cupo para otra persona que también lo está esperando.\n\nUsted permanece en la lista, así que en cuanto aparezca otro espacio le aviso.`,
    ]),

  waitlistExpirado: () =>
    pick([
      `El tiempo para confirmar ese cupo ya finalizó. ⏳\n\nSi todavía le interesa la cita, escríbame *"Hola"* y con gusto le anoto nuevamente.`,
      `Disculpe, se venció el tiempo para reservar ese cupo. ⏳\n\nSi desea intentarlo otra vez, escríbame *"Hola"* y continuamos.`,
    ]),

  escape: () =>
    pick([
      `Listo, comencemos de nuevo. ¿En qué le puedo colaborar?`,
      `Sin problema, comencemos de nuevo. ¿En qué le ayudo el día de hoy?`,
      `Volvamos a empezar. ¿Qué necesita?`,
    ]),

  outOfContext: (botName: string = BOT_NAME) =>
    pick([
      `Disculpe, soy *${botName}* y le acompaño únicamente con el agendamiento de citas médicas. 🏥\n\n¿Me indica qué especialidad necesita o el nombre del médico que está buscando?`,
      `Mi labor es ayudarle a agendar citas médicas aquí en la clínica.\n\n¿Qué servicio o médico está buscando?`,
      `Únicamente puedo colaborarle con citas médicas.\n\n¿Me indica qué especialidad necesita o con cuál doctor desea su cita?`,
    ]),

  guardrailInsulto: (_phone: string, _botName: string = BOT_NAME) =>
    `Para poder brindarle la mejor ayuda, necesitamos mantener una conversación respetuosa.\n\n` +
    `Por ahora, cerraremos este chat. Estaremos listos para atenderle cuando lo desee de forma cordial.\n\n` +
    `Solo escriba *"Hola"* para reiniciar el asistente.`,

  guardrailOffTopic: (phone: string, botName: string = BOT_NAME) =>
    `El sistema no está logrando interpretar correctamente su solicitud dentro del agendamiento de citas.\n\n` +
    `Para que reciba una mejor atención, le recomiendo comunicarse con nuestro equipo humano: 👉 *${phone}*\n\n` +
    `Cuando quiera intentarlo nuevamente conmigo, escríbame *"Hola"* y *${botName}* le atiende.`,

  ininteligible: () =>
    pick([
      `🎙️ El sistema no logró procesar bien su mensaje. ¿Me lo repite por favor, con calma, o me lo escribe?`,
      `🎙️ No fue posible captar bien el audio. ¿Me lo envía otra vez o me lo escribe, por favor?`,
      `🎙️ El audio no quedó del todo claro. ¿Me lo reenvía con calma o me lo escribe?`,
    ]),

  iaCaida: (phone: string) =>
    `Nuestro sistema está pasando por un mantenimiento breve. 🛠️\n\n` +
    `Mientras tanto, le invito a comunicarse al *${phone}* para que le atiendan directamente.\n\n` +
    `Apenas estemos de vuelta, podremos continuar por aquí. Gracias por su paciencia.`,

  maxReintentos: (phone: string) =>
    `Disculpe, parece que estamos teniendo dificultades para entendernos.\n\n` +
    `Para no hacerle perder más tiempo, le comunico con nuestro equipo humano: 👉 https://wa.me/${phone}\n\n` +
    `Ellos le atenderán enseguida.`,

  maxReintentosReset: () =>
    pick([
      `Para mayor claridad, reinicié la conversación. 🔄\n\nCuando quiera retomar, escríbame *"Hola"* y comenzamos de nuevo.`,
      `Disculpe, es preferible empezar de cero para mayor claridad.\n\nEscríbame *"Hola"* cuando esté listo(a) y le atiendo con calma.`,
    ]),

  sesionExpirada: () =>
    pick([
      `Su sesión expiró antes de poder confirmar la cita. ⏳\n\nEscríbame *"Hola"* y comenzamos otra vez con gusto.`,
      `Se agotó el tiempo de la sesión. ⏳\n\nCuando desee volver a empezar, escríbame *"Hola"* y le atiendo.`,
    ]),

  cancelarPedirCedula: () =>
    pick([
      `Con gusto le ayudo con la cancelación de su cita. 📋\n\nPara ubicarla en el sistema, ¿me indica el *número de cédula* del paciente, por favor?`,
      `Con gusto le colaboro con eso.\n\nPara buscar la cita, ¿me comparte la *cédula* del paciente?`,
    ]),

  cancelarCedulaInvalida: () =>
    pick([
      `Ese número no corresponde a una cédula válida.\n\n¿Me la confirma, por favor? Solo el número, sin puntos ni espacios.\n_(Ej: 18531928)_`,
      `Disculpe, no fue posible identificar el número correctamente.\n\nEscríbame solo los dígitos, sin separadores. _(Ej: 1088123456)_`,
    ]),

  cancelarPacienteNoExiste: (cedula: string) =>
    pick([
      `No encuentro ningún paciente con la cédula *${cedula}* en el sistema. 🔍\n\n¿Me la confirma, por favor? O si prefiere terminar el proceso, escriba _*"Salir"*_.`,
      `Disculpe, esa cédula *${cedula}* no aparece registrada.\n\n¿La revisamos otra vez? Si desea terminar, escriba _*"Salir"*_.`,
    ]),

  cancelarSinCitas: (cedula: string) =>
    `El paciente con cédula *${cedula}* no tiene citas próximas agendadas`,

  cancelarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál de ellas le gustaría cancelar? Responda con la letra, por favor.`,
      `Estas son las citas que tengo para *${nombre}*:\n\n${lineas}\nIndíqueme con la letra cuál desea cancelar.`,
    ]),

  cancelarConfirmar: (servicio: string, doctor: string, fecha: string) =>
    `Esta es la cita que vamos a cancelar:\n\n🏥 *${servicio}*\n👨‍⚕️ Dr(a). ${doctor}\n📅 ${fecha}\n\n` +
    `⚠️ ¿Está completamente seguro(a)? Responda *SÍ* para cancelarla o *NO* si prefiere mantenerla.`,

  cancelarExitosa: () =>
    pick([
      `✅ Su cita quedó *cancelada con éxito* y el cupo ya está liberado para otro paciente.`,
      `✅ Cancelé su cita y dejé el espacio disponible para alguien más.`,
      `✅ Ya cancelé la cita y el cupo queda liberado.`,
    ]),

  cancelarOfreceAgendar: () =>
    pick([
      `¿Le gustaría agendar ahora una cita en *otro horario disponible*?\n\nResponda *SÍ* para continuar o *NO* si por ahora prefiere dejarlo así.`,
      `Si lo desea, le busco *otro horario* que le acomode. ¿Le parece?\n\n*SÍ* para continuar, *NO* para terminar.`,
    ]),

  cancelarDespedida: () =>
    pick([
      `Listo. Que tenga un buen día.\n\nCuando me necesite, aquí estaré con gusto. Hasta pronto.`,
      `Perfecto. Que esté muy bien.\n\nRecuerde que cuando lo necesite, aquí estoy para atenderle.`,
      `Listo, gracias por escribir. Que pase un excelente día.\n\nCualquier inquietud, escríbame *"Hola"* y le atiendo.`,
    ]),

  despedidaCorta: () =>
    pick([
      `Fue un gusto atenderle. Que tenga un buen día.\n\nCuando necesite algo más, aquí estaré. Hasta pronto.`,
      `Con gusto. Que esté muy bien.\n\nCualquier inquietud, escríbame *"Hola"* y le atiendo.`,
      `Listo, hasta luego. Que tenga una buena tarde.\n\nAquí estaré cuando me necesite.`,
    ]),

  cancelarAbortada: () =>
    pick([
      `✅ Su cita sigue *activa y agendada*, sin cambios.\n\n¿Le puedo ayudar con algo más?`,
      `✅ No realicé ningún cambio — su cita sigue *firme*.\n\n¿Le colaboro con algo más?`,
    ]),

  cancelarError: () =>
    `Lo lamento, el sistema presentó un inconveniente al intentar cancelar la cita.\n\nPara no dejar el proceso a medias, por favor comuníquese con nuestro Call Center y allí le ayudan enseguida.`,

  respuestaInvalidaSiNo: () =>
    pick([
      `No logré interpretar su respuesta. ¿Me ayuda respondiendo *SÍ* para confirmar o *NO* para cancelar?`,
      `Para este paso necesito un *SÍ* o un *NO*, por favor.`,
      `Para asegurarnos, ¿me confirma con *SÍ* o *NO*?`,
    ]),

  audioPasoEstricto: () =>
    `🎙️ Para este paso en particular, por favor responda por *texto* _(la letra o un SÍ/NO)_ — así evitamos cualquier confusión.`,

  // Interrupción amable: el paciente pidió cancelar en medio del agendamiento.
  // Pedimos confirmación antes de abandonar el proceso en curso.
  interrupcionAgendamiento: () =>
    `Entiendo que desea cancelar una cita. ¿Confirma que desea interrumpir el proceso de agendamiento actual para proceder con la cancelación?`,

  // El paciente decidió NO interrumpir: retomamos el agendamiento donde iba.
  interrupcionRetomar: () =>
    `Perfecto, continuemos con su agendamiento justo donde lo dejamos.`,

  // ── MODIFICACIÓN / REPROGRAMACIÓN DE CITA ──────────────────────
  modificarPedirCedula: () =>
    pick([
      `Con gusto le ayudo a *modificar la fecha* de su cita. 🗓️\n\nPara ubicarla en el sistema, ¿me indica el *número de cédula* del paciente, por favor?`,
      `Claro, le ayudo a *reprogramar* su cita.\n\nPara buscarla, ¿me comparte la *cédula* del paciente?`,
    ]),

  modificarPacienteNoExiste: (cedula: string) =>
    pick([
      `No encuentro ningún paciente con la cédula *${cedula}* en el sistema. 🔍\n\n¿Me la confirma, por favor? O si prefiere terminar, escriba _*"Salir"*_.`,
      `Disculpe, esa cédula *${cedula}* no aparece registrada.\n\n¿La revisamos otra vez? Si desea terminar, escriba _*"Salir"*_.`,
    ]),

  modificarSinCitas: (cedula: string) =>
    `El paciente con cédula *${cedula}* no tiene citas próximas que se puedan reprogramar.`,

  // No se hallaron citas: ofrecemos consultar con otra cédula (loop) o cerrar.
  modificarSinCitasReintentar: (cedula: string) =>
    pick([
      `No encontré citas próximas para la cédula *${cedula}* que se puedan reprogramar. 🔍\n\n` +
        `¿Desea consultar con *otra cédula*? Responda *SÍ* para intentar con otro número, o *NO* para finalizar.`,
      `La cédula *${cedula}* no tiene citas próximas para reprogramar.\n\n` +
        `Si lo desea, puedo buscar con *otra cédula*. Responda *SÍ* para intentarlo de nuevo o *NO* para terminar.`,
    ]),

  modificarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál de ellas desea *reprogramar*? Responda con la letra, por favor.`,
      `Estas son las citas que tengo para *${nombre}*:\n\n${lineas}\nIndíqueme con la letra cuál desea *cambiar de fecha*.`,
    ]),

  modificarMostrarCupos: (servicio: string, fechaActual: string, lineas: string) =>
    pick([
      `Su cita de *${servicio}* está agendada para:\n📅 ${fechaActual}\n\n` +
        `Estos son los *nuevos horarios disponibles*:\n\n${lineas}\n` +
        `_Responda con la letra del horario al que desea moverla, por favor._`,
      `Actualmente su cita de *${servicio}* es el:\n📅 ${fechaActual}\n\n` +
        `Le muestro los espacios a los que puedo reprogramarla:\n\n${lineas}\n` +
        `_Elija el nuevo horario respondiendo con la letra._`,
    ]),

  // No hay cupos para reprogramar → ofrecemos cancelar la cita.
  modificarSinCupos: (servicio: string) =>
    pick([
      `Revisé la agenda de *${servicio}* y por el momento no hay *otros horarios disponibles* para reprogramar su cita.\n\n` +
        `¿Desea que *cancele la cita actual*? Responda *SÍ* para cancelarla o *NO* si prefiere conservarla tal como está.`,
      `Por ahora no tengo *cupos alternativos* en *${servicio}* para mover su cita.\n\n` +
        `Si lo desea puedo *cancelar la cita existente*. Responda *SÍ* para cancelar o *NO* para dejarla sin cambios.`,
    ]),

  modificarConfirmar: (servicio: string, doctor: string, fechaActual: string, fechaNueva: string) =>
    `Vamos a *reprogramar* esta cita:\n\n🏥 *${servicio}*\n👨‍⚕️ Dr(a). ${doctor}\n` +
    `📅 Actual: ${fechaActual}\n🆕 Nueva: ${fechaNueva}\n\n` +
    `¿Confirma el cambio? Responda *SÍ* para reprogramarla o *NO* para mantener la fecha actual.`,

  modificarExitosa: (fechaNueva: string) =>
    pick([
      `✅ Listo, su cita quedó *reprogramada* con éxito para:\n📅 ${fechaNueva}\n\nEl horario anterior queda liberado para otro paciente.`,
      `✅ Hecho. Moví su cita al nuevo horario:\n📅 ${fechaNueva}\n\nLiberé el espacio anterior. ¡Le esperamos!`,
    ]),

  // El paciente NO confirmó el cambio: dejamos la cita como estaba.
  modificarAbortada: () =>
    pick([
      `✅ No realicé ningún cambio — su cita sigue *firme* en la fecha original.\n\n¿Le puedo ayudar con algo más?`,
      `✅ Perfecto, dejé su cita tal como estaba, sin cambios.\n\n¿Le colaboro con algo más?`,
    ]),

  // No había cupos y el paciente decidió NO cancelar: todo queda intacto.
  modificarSinCambios: () =>
    pick([
      `Entendido, dejo su cita *tal como está*, sin ninguna modificación.\n\n¿Le puedo ayudar con algo más?`,
      `Listo, no toco nada — su cita sigue *activa y agendada* como estaba.\n\n¿Le colaboro con algo más?`,
    ]),

  modificarError: () =>
    `Lo lamento, el sistema presentó un inconveniente al intentar reprogramar la cita.\n\nPara no dejar el proceso a medias, por favor comuníquese con nuestro Call Center y allí le ayudan enseguida.`,

  inactividad: () =>
    `Buen día. Por inactividad cerré nuestra conversación para proteger sus datos. 🔒\n\nCuando quiera retomar, escríbame *"Hola"* y con gusto le atiendo.`,
};

// ═════════════════════════════════════════════════════════════
// POOL INFORMAL — Voz: cercana y cálida, "tú", manteniendo el
// profesionalismo médico. Las listas (servicios, EPS, horarios)
// conservan los saltos de línea para que el usuario las escanee
// hacia abajo, no en un bloque tipo párrafo.
// ═════════════════════════════════════════════════════════════
const INFORMAL = {
  bienvenida: (clinicaName: string, servicios: string, botName: string = BOT_NAME) =>
    pick([
      `¡Hola! ¿Cómo estás? 😊 Soy *${botName}* y te escribo desde *${clinicaName}*. Gracias por escribirnos.\n\n` +
        `Te ayudo a agendar tu cita médica de una. Cuéntame, ¿qué especialidad necesitas hoy?\n_${servicios}_`,
      `¡Hey, hola! 👋 Soy *${botName}*, de *${clinicaName}*. ¿Cómo vas?\n\n` +
        `Con gusto te ayudo a reservar tu cita rápido. ¿Para qué especialidad la necesitas?\n_${servicios}_`,
      `¡Hola! ¿Qué tal? 🌻 Soy *${botName}*, el asistente de *${clinicaName}*.\n\n` +
        `Aquí te ayudo a agendar tu cita sin filas ni esperas. Cuéntame qué buscas hoy.\n_${servicios}_`,
    ]),

  menuServicios: (clinicaName: string, lineas: string, botName: string = BOT_NAME) =>
    pick([
      `¡Hola! ¿Cómo estás? 😊 Soy *${botName}*, te escribo desde *${clinicaName}*. Gracias por escribirnos.\n\n` +
        `Te puedo ayudar a agendar tu cita médica. Estos son los servicios disponibles:\n\n` +
        `${lineas}\n` +
        `_Respóndeme con la letra, escríbeme el nombre o mándame un audio, como prefieras._ 🎙️`,
      `¡Hey! 👋 Soy *${botName}*, de *${clinicaName}*, un gusto saludarte.\n\n` +
        `Aquí te ayudo a reservar tu cita. Hoy tengo estos servicios para ti:\n\n` +
        `${lineas}\n` +
        `_Puedes responder con la letra (A, B, C...), escribirme el nombre o mandarme un audio._ 😊`,
      `¡Hola! ¿Qué tal? 🌻 Soy *${botName}*, tu asistente de *${clinicaName}*.\n\n` +
        `Estoy aquí para que reservar tu cita sea cosa de un minuto. ¿Cuál de estos servicios necesitas hoy?\n\n` +
        `${lineas}\n` +
        `_Respóndeme con la letra, el nombre o un audio de voz, como te parezca mejor._ 🎙️`,
    ]),

  servicioInvalido: (lineas: string) =>
    pick([
      `Parece que no logré captar bien tu respuesta. 🙏 ¿Me confirmas el servicio? Puedes mandarme la letra (A, B, C...) o escribirme el nombre directo:\n\n${lineas}`,
      `Esa opción no la pude identificar. Volvamos a intentarlo — me dices la letra o me escribes el nombre:\n\n${lineas}`,
      `No me quedó claro, dame otra oportunidad para entenderte. Mándame una letra (A, B, C...) o escríbeme el nombre del servicio:\n\n${lineas}`,
    ]),

  menuEps: (servicio: string, lineas: string) =>
    pick([
      `¡Listo, *${servicio}*! 🩺 Buena elección. Ahora cuéntame: ¿con qué *EPS* vienes hoy? Así te busco el mejor horario. Estas son las que manejamos:\n\n${lineas}\n` +
        `_Si pagas directo la consulta, elige *Particular*._ 💳`,
      `¡Perfecto, vamos por *${servicio}*! 🩺 Dime con cuál *EPS* estás afiliado(a). Estas son las opciones — me respondes con la letra o el nombre:\n\n${lineas}\n` +
        `_Y si pagas por tu cuenta, marca *Particular*, con confianza._ 💳`,
      `Genial, anotado *${servicio}*. 🩺 Siguiente paso: ¿de qué *EPS* eres? Aquí te dejo las que tenemos en convenio:\n\n${lineas}\n` +
        `_Si tu consulta es particular, escoge *Particular*._ 💳`,
    ]),

  epsInvalida: (lineas: string) =>
    pick([
      `Parece que no logré captar esa EPS. ¿Me la confirmas? Puedes elegir la letra o escribirme el nombre:\n\n${lineas}`,
      `No te entendí bien la EPS. Dame otra oportunidad — letra o nombre, lo que prefieras:\n\n${lineas}`,
      `No pude ubicar esa opción en nuestros convenios. ¿La repetimos? Aquí van las opciones de nuevo:\n\n${lineas}`,
    ]),

  pedirEps: () =>
    pick([
      `Cuéntame, ¿con qué *EPS o aseguradora* vienes? Así te reviso la disponibilidad.\n\n_(Si pagas tú directo, escríbeme *"Particular"*.)_ 💳`,
      `Dime con cuál *EPS* estás afiliado(a) para buscarte el mejor espacio.\n\n_(Si es por tu cuenta, mándame *"Particular"*.)_ 💳`,
    ]),

  epsNoEncontrada: (epsQuery: string) =>
    pick([
      `No encontré la EPS *"${epsQuery}"* en nuestros convenios. ¿Me la confirmas? _(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular...)_`,
      `Esa EPS no me apareció. ¿Me la escribes otra vez? _(Ej: Sura, Sanitas, Nueva EPS, Compensar...)_`,
    ]),

  epsInactiva: (epsName: string) =>
    pick([
      `Qué pena, ahorita no tenemos convenio activo con *${epsName}*. ¿Te animas a continuar como *Particular* o tienes otra EPS? Cuéntame.`,
      `En este momento no estamos atendiendo *${epsName}*. Si gustas te agendo como *Particular*, o si tienes otra EPS, dímelo.`,
    ]),

  cuposDisponibles: (nombre: string, epsName: string, lineas: string) =>
    pick([
      `${nombre ? `¡${nombre}, ` : '¡'}qué bien! 🌟 Mira los horarios que te encontré con *${epsName}*:\n\n${lineas}\n` +
        `_Cuéntame con cuál te quedas — me respondes con la letra._ ✍️`,
      `${nombre ? `${nombre}, ` : ''}¡con gusto! Estos son los espacios que tengo para ti con *${epsName}*:\n\n${lineas}\n` +
        `_Dime cuál te sirve mejor, mándame la letra._ 😊`,
      `${nombre ? `Listo, ${nombre}: ` : 'Listo: '}aquí va la agenda para *${epsName}*:\n\n${lineas}\n` +
        `_Elige el horario que más te acomode (mándame la letra)._ ✍️`,
    ]),

  preguntaWaitlist: (servicio: string, eps: string) =>
    pick([
      `Mira, revisé bien la agenda de *${servicio}* con *${eps}* y por ahora no veo espacios. 😔 Pero no te preocupes — si quieres te anoto en la *lista de espera* y te aviso por acá apenas se libere un espacio. ✨\n\n¿Te animas? Responde *SÍ* para anotarte o *NO* si prefieres intentar después.`,
      `${servicio} con *${eps}* está full estos días. 😅 Pero tengo una idea: ¿quieres que te apunte en la *lista de espera*? En cuanto alguien libere un cupo te escribo para reservártelo. ✅\n\n*SÍ* para anotarte, *NO* para dejarlo.`,
      `Acabo de mirar y la agenda de *${servicio}* (${eps}) está llena. 🙏 Te puedo dejar en la *lista de espera* y te aviso apenas se abra algo, sin compromiso. 🤝\n\n¿Te parece? *SÍ* o *NO*.`,
    ]),

  unidoAWaitlist: (nombre: string, servicio: string, position: number) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! 🎟️ Te anoté en la lista de espera para *${servicio}* — quedaste en la posición *#${position}*.\n\nPendiente de tu WhatsApp: apenas se libere un cupo te escribo de una. ✨ ¡Que tengas un día muy bonito! 😊`,
      `${nombre ? `Perfecto, ${nombre}. ` : 'Perfecto. '}Ya quedaste apuntado(a) en la cola de *${servicio}* (posición *#${position}*). 🎟️\n\nApenas se abra un espacio, te aviso por acá. 💚 ¡Cuídate mucho!`,
      `¡Hecho${nombre ? `, ${nombre}` : ''}! 🌟 Te agregué a la lista para *${servicio}*, vas en la posición *#${position}*.\n\nTe escribo en cuanto tenga novedades. 🙏 Mientras tanto, ¡que estés muy bien!`,
    ]),

  noUnidoAWaitlist: () =>
    pick([
      `Listo, sin problema. 😊 Cuando quieras intentarlo otra vez, me escribes *"Hola"* y seguimos. ¡Que estés muy bien! 👋`,
      `Como quieras, no te preocupes. 🌻 Aquí estaré cuando quieras — solo dime *"Hola"*. ¡Hasta pronto!`,
      `Perfecto, lo dejamos así. 😊 Cualquier cosa, escríbeme *"Hola"* y te atiendo. Que tengas un día genial. 🌟`,
    ]),

  sinDisponibilidad: (nombre: string, epsName: string, especialidad: string, position: number) =>
    `${nombre}, revisé la agenda para *${epsName}* en *${especialidad}* y ahorita no hay espacios. 😔 Pero tranquilo(a), ya te agregué a la lista de espera (posición *#${position}*). En cuanto se libere algo, te escribo. ✨\n\n¿Algo más en lo que te pueda ayudar?`,

  pedirCedulaPostSlot: (fechaFormateada: string) =>
    pick([
      `¡Genial! 🌟 Te aparté ese horario:\n📅 *${fechaFormateada}*\n\nPara terminar de agendarte, ¿me regalas tu *número de cédula*?`,
      `¡Perfecto, ya casi! 😊 Te reservé tentativamente:\n📅 *${fechaFormateada}*\n\nMe falta solo un dato: ¿me compartes tu *cédula*?`,
      `¡Listo! 🎯 Tengo ese espacio apartado para ti:\n📅 *${fechaFormateada}*\n\nPara cerrar, ¿me mandas tu *número de cédula*? Solo el número, sin puntos.`,
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
      `¡Listo${nombre ? `, ${nombre}` : ''}! Revisemos los datos antes de cerrar:\n\n` +
        `👤 *Paciente:* ${nombre}\n🪪 *Cédula:* ${cedula}\n💳 *EPS:* ${eps}\n🏥 *Servicio:* ${especialidad}\n📅 *Fecha y hora:* ${fecha}\n\n` +
        `¿Todo bien? Responde *SÍ* para confirmar tu cita o *NO* si quieres cambiar algo.`,
      `¡Perfecto${nombre ? `, ${nombre}` : ''}! Mira los datos que tengo:\n\n` +
        `👤 ${nombre}\n🪪 Cédula ${cedula}\n💳 EPS ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `Si está bien, responde *SÍ* y te la dejo confirmada; si algo no, dime *NO*.`,
      `Ya casi terminamos${nombre ? `, ${nombre}` : ''} 🌟. Estos son tus datos:\n\n` +
        `👤 ${nombre}\n🪪 ${cedula}\n💳 ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `¿Cerramos? *SÍ* para agendar, *NO* si prefieres cancelar.`,
    ]),

  citaConfirmada: (clinicaName: string, fecha: string) =>
    pick([
      `¡Listo, todo confirmado! 🎉 Tu cita ya quedó en *${clinicaName}*:\n📅 _${fecha}_\n\nLlega por favor *15 minutos antes* y trae tu *cédula*. 🪪 Cualquier cosa, acá estoy. ¡Que estés muy bien! 😊`,
      `¡Hecho! 🌟 Tu cita en *${clinicaName}* quedó agendada:\n📅 _${fecha}_\n\nRecuerda llegar *15 min antes* con tu *cédula*. 🪪 ¡Gracias por confiar en nosotros! 💚`,
      `¡Quedó lista! 🎊 Tienes cita confirmada en *${clinicaName}*:\n📅 _${fecha}_\n\nPor favor sé puntual: llega *15 min antes* y trae tu *documento*. 🪪 ¡Hasta pronto! 👋`,
    ]),

  citaNoConfirmada: () =>
    pick([
      `Listo, sin problema, cancelé la solicitud. 😊 Cuando quieras intentarlo otra vez, me escribes *"Hola"* y vamos.`,
      `Tranquilo(a), lo dejamos por ahora. 🌻 Cuando quieras retomar, me dices *"Hola"*.`,
      `No te preocupes, no se agendó nada. 😊 Cuando estés listo(a), escríbeme *"Hola"* y arrancamos otra vez.`,
    ]),

  slotTomado: () =>
    pick([
      `Qué pena, justo ese horario lo acaba de tomar otro paciente. 😬 ¿Vemos otro? Mándame la letra de nuevo, por favor.`,
      `Ese espacio acaba de reservarse. 🙏 ¿Cuál otro te sirve? Dime la letra.`,
    ]),

  errorSlotInvalido: () =>
    pick([
      `Mmm, esa letra no la veo entre las opciones que te mandé. 🙏 ¿Me la confirmas? Puedes responderme con la letra (A, B, C...) o escribirme *"Salir"* si quieres terminar.`,
      `No encontré esa opción. 😊 Respóndeme con una de las letras (A, B, C...) o escribe *"Salir"* para cancelar.`,
    ]),

  waitlistCupoDisponible: (nombre: string, especialidad: string, fecha: string, doctor: string) =>
    pick([
      `🔔 ¡Hey ${nombre}, tengo súper buenas noticias! Se liberó un cupo para *${especialidad}* y tú eras la siguiente persona en la lista. 🌟\n\n📅 *${fecha}*\n👨‍⚕️ Dr(a). ${doctor}\n\nTe lo aparto por *30 minutos*. ¿Lo tomas? Responde *SÍ* para confirmarte o *NO* si ya no lo necesitas.`,
      `🔔 ¡${nombre}, buena noticia! 🌟 Se abrió un espacio para *${especialidad}* y te toca a ti, eras la primera en espera:\n\n📅 *${fecha}*\n👨‍⚕️ Dr(a). ${doctor}\n\nTienes *30 minutos* para confirmarme. ¿Te lo dejo? *SÍ* o *NO*.`,
    ]),

  waitlistCupoRechazado: () =>
    pick([
      `¡Sin problema! 😊 Libero el cupo entonces. Tranquilo(a), sigues en la lista y te aviso cuando aparezca otro. ✨ ¡Que estés muy bien! 👋`,
      `Listo, como quieras. 🌻 Libero el cupo para otro paciente que también lo está esperando. Sigues en la lista. 💚`,
    ]),

  waitlistExpirado: () =>
    pick([
      `Se nos pasó el tiempo para confirmar ese cupo. ⏰ Si aún quieres una cita, escríbeme *"Hola"* y te anoto de nuevo. 😊`,
      `Venció el tiempo para reservar ese cupo. 🙏 Si quieres volver a intentarlo, mándame *"Hola"* y seguimos. 💚`,
    ]),

  escape: () =>
    pick([
      `¡Listo, arrancamos de cero! 😊 Cuéntame, ¿en qué te puedo ayudar?`,
      `Sin problema, refrescamos. 🌻 ¿Qué necesitas hoy?`,
      `Tranquilo(a), volvemos a empezar. 😊 Dime, ¿qué te ayudo a buscar?`,
    ]),

  outOfContext: (botName: string = BOT_NAME) =>
    pick([
      `Perdón, soy *${botName}* y solo te puedo ayudar con el agendamiento de citas médicas. 🏥 ¿Qué especialidad o médico estás buscando?`,
      `Mi trabajo es ayudarte a agendar citas. 😊 Cuéntame, ¿qué servicio o médico necesitas?`,
      `Yo solo te puedo colaborar con citas médicas. 🙏 ¿Qué especialidad necesitas o con cuál doctor te gustaría agendar?`,
    ]),

  guardrailInsulto: (_phone: string, _botName: string = BOT_NAME) =>
    `Para brindarte la mejor ayuda, necesitamos mantener una conversación respetuosa. 🙏 En este momento, cerraremos este chat. Estamos listos para ayudarte cuando lo desees de forma cordial. Solo escribe *"Hola"* para reiniciar el asistente.`,

  guardrailOffTopic: (phone: string, botName: string = BOT_NAME) =>
    `Parece que no estoy logrando entenderte dentro del agendamiento. 🙏 Mejor te paso con nuestro equipo humano para que te atiendan: 👉 *${phone}*. Cuando quieras intentarlo conmigo otra vez, solo escríbeme *"Hola"* y *${botName}* te atiende. 😊`,

  ininteligible: () =>
    pick([
      `🎙️ Perdón, no logré escucharte bien. ¿Me lo repites con calma o me lo escribes?`,
      `🎙️ No te capté bien. 😊 ¿Me lo mandas otra vez o me lo escribes?`,
      `🎙️ No me quedó claro. ¿Me lo reenvías o me lo escribes? 🙏`,
    ]),

  iaCaida: (phone: string) =>
    `Qué pena: el sistema está pasando por un mantenimiento breve. 🛠️ Mientras tanto, comunícate al *${phone}* para que te atiendan directamente. 🙏 ¡Gracias por tu paciencia!`,

  maxReintentos: (phone: string) =>
    `Perdón, parece que no estamos logrando entendernos. 😔 Para no hacerte perder tiempo, te paso con nuestro equipo humano: 👉 https://wa.me/${phone}. Te atienden enseguida con gusto.`,

  maxReintentosReset: () =>
    pick([
      `Para no enredarte más, reinicié la conversación. 🔄 Cuando quieras retomar, escríbeme *"Hola"* y arrancamos de nuevo. 😊`,
      `Mejor arrancamos de cero. 🌻 Mándame *"Hola"* cuando estés listo(a) y seguimos con calma.`,
    ]),

  sesionExpirada: () =>
    pick([
      `Qué pena, tu sesión se venció antes de poder confirmar. ⏳ No te preocupes, escríbeme *"Hola"* y empezamos otra vez. 😊`,
      `Se nos pasó el tiempo de la sesión. 🙏 Cuando quieras volver, mándame *"Hola"* y te atiendo. 💚`,
    ]),

  cancelarPedirCedula: () =>
    pick([
      `Claro que sí, te ayudo a cancelar tu cita. 📋 Para buscarla, ¿me pasas la *cédula* del paciente?`,
      `Con gusto te ayudo con eso. 😊 ¿Me compartes la *cédula* del paciente para buscar la cita?`,
    ]),

  cancelarCedulaInvalida: () =>
    pick([
      `Mmm, ese número no me parece una cédula válida. 🙏 ¿Me la confirmas? Solo el número, sin puntos ni espacios. _(Ej: 18531928)_`,
      `Parece que no logré identificar el número. 😊 Mándame solo los dígitos, sin separadores. _(Ej: 1088123456)_`,
    ]),

  cancelarPacienteNoExiste: (cedula: string) =>
    pick([
      `Hmm, busqué y no encuentro a ningún paciente con la cédula *${cedula}*. 🔍 ¿Me la confirmas? O si quieres terminar, escríbeme _*"Salir"*_.`,
      `Esa cédula *${cedula}* no me aparece. 🙏 ¿La revisamos otra vez? Si gustas terminar, mándame _*"Salir"*_.`,
    ]),

  cancelarSinCitas: (cedula: string) =>
    `Revisé y el paciente con cédula *${cedula}* no tiene citas próximas. 📭 ¿Te ayudo a agendar una nueva?`,

  cancelarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Listo, encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál quieres cancelar? Mándame la letra.`,
      `Acá están las citas que tengo para *${nombre}*:\n\n${lineas}\nDime con la letra cuál es la que quieres cancelar. 😊`,
    ]),

  cancelarConfirmar: (servicio: string, doctor: string, fecha: string) =>
    `Para confirmarte, esta es la cita que vamos a cancelar:\n\n🏥 *${servicio}*\n👨‍⚕️ Dr(a). ${doctor}\n📅 ${fecha}\n\n⚠️ ¿Seguro(a)? Responde *SÍ* para cancelarla o *NO* si prefieres dejarla.`,

  cancelarExitosa: () =>
    pick([
      `✅ ¡Listo! Tu cita quedó *cancelada* y el cupo ya está libre para otro paciente. 🗓️`,
      `✅ Hecho, cancelé tu cita y liberé el espacio. 🙏`,
      `✅ Perfecto, cita cancelada y cupo disponible para alguien más. 💚`,
    ]),

  cancelarOfreceAgendar: () =>
    pick([
      `¿Te ayudo a agendar en *otro horario disponible*? Cuéntame. *SÍ* para seguir, *NO* si por ahora no.`,
      `Si quieres te busco *otro horario* que te acomode. ¿Te animas? *SÍ* para seguir, *NO* para terminar.`,
    ]),

  cancelarDespedida: () =>
    pick([
      `¡Listo, que tengas un día muy bonito! 😊 Cuando me necesites, acá estaré. ¡Hasta pronto! 👋`,
      `¡Perfecto, cuídate mucho! 🌻 Cualquier cosa, escríbeme y te atiendo. ¡Que estés muy bien!`,
      `¡Listo, gracias por escribir! 💚 Que pases un día genial. Cualquier cosa, me dices *"Hola"*. 👋`,
    ]),

  despedidaCorta: () =>
    pick([
      `¡Fue un gusto atenderte! 😊 Que tengas un día muy bonito. Cuando me necesites, acá me tienes. 👋`,
      `¡Con gusto! 🌻 Que estés muy bien. Cualquier cosa, me escribes *"Hola"*. 💚`,
      `¡Listo, hasta luego! 😊 Que tengas un día lindo. Acá estaré cuando me necesites. 👋`,
    ]),

  cancelarAbortada: () =>
    pick([
      `✅ ¡Perfecto! Tu cita sigue *activa*, sin cambios. ¿Te ayudo en algo más?`,
      `✅ Tranquilo(a), no toqué nada — tu cita sigue *firme*. 😊 ¿Te colaboro con algo más?`,
    ]),

  cancelarError: () =>
    `Qué pena, tuve un inconveniente cancelando la cita. 😔 Para no dejarte a medias, llama al Call Center y ahí te ayudan enseguida. 🙏`,

  respuestaInvalidaSiNo: () =>
    pick([
      `Mmm, no te entendí. 🙏 ¿Me ayudas respondiendo *SÍ* o *NO*?`,
      `Para este paso necesito un *SÍ* o un *NO*, porfa. 😊`,
      `Para no equivocarme, ¿me confirmas con *SÍ* o *NO*?`,
    ]),

  audioPasoEstricto: () =>
    `🎙️ Para este paso, mejor respóndeme por *texto* _(la letra o un SÍ/NO)_ — así evitamos confusiones. 🙏`,

  // Interrupción amable: el paciente pidió cancelar en medio del agendamiento.
  // Pedimos confirmación antes de abandonar el proceso en curso.
  interrupcionAgendamiento: () =>
    `Entiendo, prefieres cancelar una cita. ¿Quieres que detengamos este agendamiento para pasar al proceso de cancelación?`,

  // El paciente decidió NO interrumpir: retomamos el agendamiento donde iba.
  interrupcionRetomar: () =>
    `¡Listo, seguimos con tu agendamiento justo donde íbamos! 😊`,

  // ── MODIFICACIÓN / REPROGRAMACIÓN DE CITA ──────────────────────
  modificarPedirCedula: () =>
    pick([
      `¡Claro que sí! Te ayudo a *cambiar la fecha* de tu cita. 🗓️ Para buscarla, ¿me pasas la *cédula* del paciente?`,
      `De una, te ayudo a *reprogramar* tu cita. 😊 ¿Me compartes la *cédula* del paciente para ubicarla?`,
    ]),

  modificarPacienteNoExiste: (cedula: string) =>
    pick([
      `Hmm, busqué y no encuentro a ningún paciente con la cédula *${cedula}*. 🔍 ¿Me la confirmas? O si quieres terminar, escríbeme _*"Salir"*_.`,
      `Esa cédula *${cedula}* no me aparece. 🙏 ¿La revisamos otra vez? Si gustas terminar, mándame _*"Salir"*_.`,
    ]),

  modificarSinCitas: (cedula: string) =>
    `Revisé y el paciente con cédula *${cedula}* no tiene citas próximas para reprogramar. 📭 ¿Te ayudo a agendar una nueva?`,

  // No se hallaron citas: ofrecemos consultar con otra cédula (loop) o cerrar.
  modificarSinCitasReintentar: (cedula: string) =>
    pick([
      `Revisé y la cédula *${cedula}* no tiene citas próximas para reprogramar. 📭\n\n` +
        `¿Quieres que busque con *otra cédula*? Mándame *SÍ* para intentar con otro número, o *NO* para terminar. 😊`,
      `Hmm, con la cédula *${cedula}* no me aparecen citas para reprogramar.\n\n` +
        `Si quieres probamos con *otra cédula*. Responde *SÍ* para intentarlo de nuevo o *NO* para cerrar. 🙏`,
    ]),

  modificarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Listo, encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál quieres *reprogramar*? Mándame la letra. 😊`,
      `Acá están las citas que tengo para *${nombre}*:\n\n${lineas}\nDime con la letra cuál quieres *cambiar de fecha*.`,
    ]),

  modificarMostrarCupos: (servicio: string, fechaActual: string, lineas: string) =>
    pick([
      `Tu cita de *${servicio}* está para:\n📅 ${fechaActual}\n\n` +
        `Estos son los *nuevos horarios* que tengo disponibles:\n\n${lineas}\n` +
        `_Mándame la letra del horario al que quieres moverla._ 😊`,
      `Ahorita tu cita de *${servicio}* es el:\n📅 ${fechaActual}\n\n` +
        `Mira, te puedo reprogramar a estos espacios:\n\n${lineas}\n` +
        `_Elige el nuevo horario con la letra._`,
    ]),

  // No hay cupos para reprogramar → ofrecemos cancelar la cita.
  modificarSinCupos: (servicio: string) =>
    pick([
      `Revisé la agenda de *${servicio}* y por ahora no hay *otros horarios* para mover tu cita. 🙏\n\n` +
        `¿Quieres que *cancele la cita actual*? Responde *SÍ* para cancelarla o *NO* si prefieres dejarla tal cual.`,
      `Por el momento no tengo *cupos alternativos* en *${servicio}* para reprogramarte.\n\n` +
        `Si quieres puedo *cancelar la cita que tienes*. Mándame *SÍ* para cancelar o *NO* para dejarla sin cambios.`,
    ]),

  modificarConfirmar: (servicio: string, doctor: string, fechaActual: string, fechaNueva: string) =>
    `Para confirmarte, vamos a *reprogramar* esta cita:\n\n🏥 *${servicio}*\n👨‍⚕️ Dr(a). ${doctor}\n` +
    `📅 Actual: ${fechaActual}\n🆕 Nueva: ${fechaNueva}\n\n` +
    `¿Confirmas el cambio? Responde *SÍ* para reprogramarla o *NO* para dejar la fecha actual.`,

  modificarExitosa: (fechaNueva: string) =>
    pick([
      `✅ ¡Listo! Tu cita quedó *reprogramada* para:\n📅 ${fechaNueva}\n\nLiberé el horario anterior para otro paciente. 🗓️`,
      `✅ ¡Hecho! Moví tu cita al nuevo horario:\n📅 ${fechaNueva}\n\n¡Te esperamos! 💚`,
    ]),

  // El paciente NO confirmó el cambio: dejamos la cita como estaba.
  modificarAbortada: () =>
    pick([
      `✅ ¡Tranquilo(a)! No cambié nada — tu cita sigue *firme* en la fecha original. ¿Te ayudo en algo más?`,
      `✅ Perfecto, dejé tu cita tal como estaba. 😊 ¿Te colaboro con algo más?`,
    ]),

  // No había cupos y el paciente decidió NO cancelar: todo queda intacto.
  modificarSinCambios: () =>
    pick([
      `¡Listo! Dejo tu cita *tal como está*, sin tocar nada. 😊 ¿Te ayudo en algo más?`,
      `De una, no modifico nada — tu cita sigue *activa* como estaba. ¿Te colaboro con algo más?`,
    ]),

  modificarError: () =>
    `Qué pena, tuve un inconveniente reprogramando la cita. 😔 Para no dejarte a medias, llama al Call Center y ahí te ayudan enseguida. 🙏`,

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

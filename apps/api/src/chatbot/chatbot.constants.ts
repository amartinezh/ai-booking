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
  AWAITING_WAITLIST_CONFIRM = 'AWAITING_WAITLIST_CONFIRM', // nuevo: cupo liberado, esperando SÍ/NO
}

// Tiempo de expiración de la sesión conversacional en Redis (1 hora)
export const SESSION_TTL = 3600;

// Tiempo máximo para confirmar un cupo de waitlist (30 minutos)
export const WAITLIST_CONFIRM_TTL = 1800;

// Nombre del asistente (usado en todos los mensajes)
export const BOT_NAME = 'Vicente';

// ─────────────────────────────────────────────────────────────
// PLAYBOOK CONVERSACIONAL — Mensajes canónicos del bot
// Principios: cálido, breve, personalizado, sin dead-ends.
// ─────────────────────────────────────────────────────────────
export const MSGS = {
  bienvenida: (clinicaName: string, servicios: string) =>
    `¡Hola! 👋 Soy *${BOT_NAME}*, el asistente de *${clinicaName}*.\n\n` +
    `Estoy aquí para ayudarle a agendar su cita médica de forma rápida y sin filas. 🏥\n\n` +
    `¿Para qué especialidad necesita cita hoy?\n` +
    `_${servicios}_`,

  especialidadConfirmada: (especialidad: string) =>
    `Perfecto, *${especialidad}*. 🩺\n\n` +
    `Para buscar su agenda disponible, ¿me comparte su número de cédula?`,

  pedirCedula: (especialidad: string) =>
    `Entendí que busca cita para *${especialidad}*.\n\n` +
    `¿Me comparte su número de cédula?`,

  primeraVez: () =>
    `Es un gusto atenderle por primera vez. 🤝\n\n` +
    `¿Me indica su nombre completo para registrarle?`,

  pedirEps: () =>
    `Para verificar la disponibilidad de agenda, ¿me indica el nombre de su *EPS o Aseguradora*?\n\n` +
    `_(Si paga directamente, diga *"Particular"*)_`,

  epsNoEncontrada: (epsQuery: string) =>
    `No pude identificar la EPS *"${epsQuery}"*. ¿Podría escribirla nuevamente?\n\n` +
    `_(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular)_`,

  epsInactiva: (epsName: string) =>
    `Lo siento, en este momento no prestamos servicios por convenio con *${epsName}*.\n\n` +
    `¿Desea agendar como *Particular* o tiene otra EPS?`,

  sinDisponibilidad: (nombre: string, epsName: string, especialidad: string, position: number) =>
    `${nombre}, revisé los cupos disponibles para *${epsName}* en *${especialidad}* ` +
    `y en este momento no hay agenda abierta. 😔\n\n` +
    `Le he agregado a la lista de espera (posición *#${position}*). En cuanto se libere un cupo, ` +
    `le avisaremos aquí mismo. ✅\n\n` +
    `¿Hay algo más en lo que pueda ayudarle?`,

  cuposDisponibles: (nombre: string, epsName: string, lineas: string) =>
    `${nombre}, encontré estos horarios para *${epsName}*:\n\n` +
    `${lineas}\n` +
    `_Responda con la letra de su preferencia_`,

  resumenCita: (nombre: string, cedula: string, eps: string, especialidad: string, fecha: string) =>
    `Confirmo su cita:\n\n` +
    `👤 ${nombre}\n` +
    `🪪 Cédula: ${cedula}\n` +
    `💳 EPS: ${eps}\n` +
    `🏥 ${especialidad}\n` +
    `📅 ${fecha}\n\n` +
    `¿Confirmamos? Responda *SÍ* para agendar o *NO* para cancelar.`,

  citaConfirmada: (clinicaName: string, fecha: string) =>
    `¡Todo listo! 🎉 Su cita quedó confirmada en *${clinicaName}*.\n\n` +
    `Recuerde llegar *15 minutos antes* con su documento de identidad.\n\n` +
    `_📅 ${fecha}_\n\n` +
    `¡Que esté muy bien! 😊`,

  citaNoConfirmada: () =>
    `Entendido. He cancelado la solicitud. 😊\n\n` +
    `Cuando desee agendar de nuevo, escríbame *"Hola"*.`,

  slotTomado: () =>
    `⚠️ Lo siento, ese horario acaba de ser reservado por otro paciente.\n\n` +
    `¿Desea elegir otro de los disponibles? Escríbame la letra nuevamente.`,

  errorSlotInvalido: () =>
    `Esa no parece ser una de las letras disponibles. Por favor responda con la letra correcta ` +
    `_(ej: A, B, C...)_ o escriba *"Salir"* para cancelar.`,

  waitlistCupoDisponible: (nombre: string, especialidad: string, fecha: string, doctor: string) =>
    `🔔 ¡${nombre}! Hay un cupo disponible para *${especialidad}*:\n\n` +
    `📅 *${fecha}*\n` +
    `👨‍⚕️ Dr. ${doctor}\n\n` +
    `⏰ Este cupo está reservado para usted por *30 minutos*.\n\n` +
    `¿Desea tomarlo? Responda *SÍ* para confirmar o *NO* para liberar el cupo.`,

  waitlistExpirado: () =>
    `Lo sentimos, el tiempo para confirmar el cupo expiró. ⏰\n\n` +
    `Si aún desea una cita, escríbame *"Hola"* y lo agregaremos nuevamente a la lista. 😊`,

  escape: () =>
    `Sin problema. Empezamos de cero. 😊\n\n` +
    `¿En qué le puedo ayudar?`,

  outOfContext: () =>
    `Soy *${BOT_NAME}*, un asistente exclusivo para agendamiento médico. 🏥\n\n` +
    `Por favor indíqueme la especialidad que busca o el nombre del médico.`,

  ininteligible: () =>
    `🎙️ Disculpe, no entendí bien el mensaje. ¿Podría repetirlo de forma más pausada o escribirme texto?`,

  iaCaida: (phone: string) =>
    `⚠️ Nuestro sistema de inteligencia artificial está en mantenimiento.\n\n` +
    `Por favor comuníquese al *${phone}* para agendar su cita. 🙏`,

  maxReintentos: (phone: string) =>
    `Estamos teniendo dificultades para comunicarnos correctamente. 😔\n\n` +
    `Por favor comuníquese con un asesor: 👉 https://wa.me/${phone}`,

  maxReintentosReset: () =>
    `Estamos teniendo dificultades para comunicarnos. Por seguridad, he reiniciado la sesión. 🔄\n\n` +
    `Cuando desee, escríbame *"Hola"* para comenzar de nuevo.`,

  sesionExpirada: () =>
    `⏳ Lo siento, su sesión expiró antes de confirmar.\n\n` +
    `Escríbame *"Hola"* para comenzar de nuevo.`,

  cancelarPedirCedula: () =>
    `Entiendo que desea cancelar una cita. 📋\n\n` +
    `Para buscarla, ¿me indica el *número de cédula* del paciente?`,

  cancelarCedulaInvalida: () =>
    `No pude detectar un número de cédula válido. Por favor escríbame solo el número, sin puntos ni espacios.\n\n` +
    `_(Ej: 18531928)_`,

  cancelarPacienteNoExiste: (cedula: string) =>
    `No encontré ningún paciente registrado con la cédula *${cedula}*.\n\n` +
    `¿Desea intentar con otra cédula o agendar una nueva cita?`,

  cancelarSinCitas: (cedula: string) =>
    `El paciente con cédula *${cedula}* no tiene citas futuras activas. 📭\n\n` +
    `¿Desea agendar una nueva cita?`,

  cancelarSeleccionar: (nombre: string, lineas: string) =>
    `Encontré las siguientes citas para *${nombre}*:\n\n` +
    `${lineas}\n` +
    `¿Cuál desea cancelar? Responda con la letra.`,

  cancelarConfirmar: (servicio: string, doctor: string, fecha: string) =>
    `Va a cancelar esta cita:\n\n` +
    `🏥 *${servicio}*\n` +
    `👨‍⚕️ Dr. ${doctor}\n` +
    `📅 ${fecha}\n\n` +
    `⚠️ ¿Está seguro? Responda *SÍ* para cancelar o *NO* para mantenerla.`,

  cancelarExitosa: () =>
    `✅ Su cita fue *cancelada exitosamente* y el cupo ha sido liberado.\n\n` +
    `¿Desea agendar una nueva cita o puedo ayudarle en algo más?`,

  cancelarAbortada: () =>
    `✅ Perfecto. Su cita sigue *activa y agendada*.\n\n` +
    `¿Puedo ayudarle en algo más?`,

  cancelarError: () =>
    `Lo siento, ocurrió un error al intentar cancelar la cita. Por favor comuníquese con el Call Center. 😔`,

  respuestaInvalidaSiNo: () =>
    `⚠️ Por favor responda únicamente *SÍ* para confirmar o *NO* para cancelar.`,

  audioPasoEstricto: () =>
    `🎙️ Para este paso, por favor responda en texto _(la letra o la palabra SÍ/NO)_ para evitar errores.`,

  inactividad: () =>
    `Hola. Por inactividad prolongada he cerrado nuestra conversación por seguridad. 🔒\n\n` +
    `Cuando desee continuar, escríbame *"Hola"*. 😊`,
};
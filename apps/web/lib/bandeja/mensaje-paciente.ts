/**
 * ✉️ Escribirle al paciente desde un caso de la Bandeja (2026-10-29): «su cita se
 * canceló, disculpas», «quedó registrada»…
 *
 * Aquí se decide QUIÉN puede y SOBRE QUÉ cita: el caso tiene que ser de la clínica y
 * estar dentro del alcance del agente (`cargarAlcanzable`, la misma regla que Tomar o
 * Resolver), y la cita sale del caso, nunca del cliente. Por dónde y si hoy se le
 * puede escribir lo decide la API (`/chatbot/outbound/cita`), que conoce la ventana
 * de 24 horas de WhatsApp: fuera de ella no se envía.
 *
 * Cada envío deja su constancia en el historial del caso, sin el texto: el texto
 * queda en la conversación del paciente (Rastreo), que se purga a los 180 días; el
 * historial no.
 */
import type { PrismaClient } from '@agenia/database';
import type { TipoExcepcion } from '@agenia/shared';
import { SIN_PERMISOS, type ActorBandeja } from './acceso';
import { cargarAlcanzable, MSG_NO_ENCONTRADA } from './servicio';
import type { PreparacionMensaje, Resultado } from './tipos';

import { MAX_MENSAJE } from './constantes-mensaje';

export { MAX_MENSAJE };

export type MotivoSinMensaje =
  | 'NO_ENCONTRADA'
  | 'SIN_CONTACTO'
  | 'TELEFONO_EQUIVOCADO'
  | 'FUERA_DE_VENTANA'
  | 'MENSAJE_INVALIDO'
  | 'FALLO';

/** Lo que responde `GET /chatbot/outbound/cita/:id`. */
export type RespuestaRevision =
  | ({ ok: true } & Omit<PreparacionMensaje, 'sugerida'>)
  | { ok: false; motivo: MotivoSinMensaje };

/** Lo que responde `POST /chatbot/outbound/cita`. */
export type RespuestaEnvio =
  | { ok: true; canal: 'WHATSAPP' | 'TELEGRAM'; destino: string | null }
  | { ok: false; motivo: MotivoSinMensaje };

/** El cable con la API; `null` si no respondió bien (caída, 401, 404…). */
export interface ClienteMensajes {
  revisar(appointmentId: string): Promise<RespuestaRevision | null>;
  enviar(appointmentId: string, texto: string): Promise<RespuestaEnvio | null>;
}

export const MSG_SIN_CITA = 'Este caso no tiene una cita con paciente a quien escribirle.';
export const MSG_SIN_RESPUESTA = 'No se pudo consultar el envío de mensajes. Intenta de nuevo en un momento.';

export const MOTIVO_SIN_MENSAJE: Record<MotivoSinMensaje, string> = {
  NO_ENCONTRADA: 'No se encontró la cita de este caso.',
  SIN_CONTACTO:
    'El paciente no tiene WhatsApp ni Telegram registrados: comunícate con él por teléfono.',
  TELEFONO_EQUIVOCADO:
    'El teléfono de este paciente está marcado como de otra persona (hay un caso abierto en la Bandeja): resuélvelo antes de escribirle.',
  FUERA_DE_VENTANA:
    'El paciente no ha escrito en las últimas 24 horas y WhatsApp no deja enviarle un mensaje escrito por el personal. Llámalo: su teléfono está en Pacientes.',
  MENSAJE_INVALIDO: `Escribe el mensaje (máximo ${MAX_MENSAJE} caracteres).`,
  FALLO: 'WhatsApp no aceptó el mensaje. Intenta de nuevo en unos minutos o llama al paciente.',
};

/**
 * Con qué texto abre el cuadro. En los casos en que la cita no quedó en el hospital
 * o el hospital la canceló, lo que suele haber que decir es que se canceló, con
 * disculpas; en los demás, solo el saludo.
 */
const ABRE_CON_CANCELADA: readonly TipoExcepcion[] = [
  'CITA_NO_ENTREGADA',
  'EVENTO_RENDIDO',
  'DERIVA_EN_HIS',
  'CONFLICTO_SYNC',
  'CITA_CANCELADA_POR_HOSPITAL',
];

export function sugeridaPara(tipo: string): PreparacionMensaje['sugerida'] {
  return (ABRE_CON_CANCELADA as readonly string[]).includes(tipo) ? 'cancelada' : 'saludo';
}

type Db = Pick<PrismaClient, 'syncException' | 'syncExceptionLog'>;

type Fila = NonNullable<Awaited<ReturnType<typeof cargarAlcanzable>>>;

async function citaDelCaso(
  db: Db,
  actor: ActorBandeja,
  id: unknown,
): Promise<{ error: string } | { fila: Fila; appointmentId: string }> {
  const fila = await cargarAlcanzable(db as PrismaClient, actor, id);
  if (!fila) return { error: MSG_NO_ENCONTRADA };
  if (!fila.appointmentId || !fila.patientId) return { error: MSG_SIN_CITA };
  return { fila, appointmentId: fila.appointmentId };
}

/** ¿Se le puede escribir ahora, por dónde y con qué texto? No envía nada. */
export async function prepararMensaje(
  db: Db,
  actor: ActorBandeja,
  id: unknown,
  cliente: ClienteMensajes,
): Promise<Resultado<PreparacionMensaje>> {
  if (!actor.permisos.trabajar) return { success: false, error: SIN_PERMISOS };
  const caso = await citaDelCaso(db, actor, id);
  if ('error' in caso) return { success: false, error: caso.error };

  const r = await cliente.revisar(caso.appointmentId);
  if (!r) return { success: false, error: MSG_SIN_RESPUESTA };
  if (!r.ok) return { success: false, error: MOTIVO_SIN_MENSAJE[r.motivo] ?? MSG_SIN_RESPUESTA };
  return {
    success: true,
    data: {
      canal: r.canal,
      puedeEscribir: r.puedeEscribir,
      hastaIso: r.hastaIso,
      destino: r.destino,
      otroNumero: r.otroNumero,
      citaVigente: r.citaVigente,
      sugerencias: r.sugerencias,
      sugerida: sugeridaPara(caso.fila.kind),
    },
  };
}

export interface MensajeEnviado {
  canal: 'WHATSAPP' | 'TELEGRAM';
  destino: string | null;
  /** Para la Actividad de usuarios. */
  appointmentId: string;
  inicio: Date | null;
}

export async function enviarMensaje(
  db: Db,
  actor: ActorBandeja,
  entrada: { id: unknown; texto: unknown },
  cliente: ClienteMensajes,
): Promise<Resultado<MensajeEnviado>> {
  if (!actor.permisos.trabajar) return { success: false, error: SIN_PERMISOS };
  const texto = typeof entrada.texto === 'string' ? entrada.texto.trim() : '';
  if (!texto || texto.length > MAX_MENSAJE) {
    return { success: false, error: MOTIVO_SIN_MENSAJE.MENSAJE_INVALIDO };
  }
  const caso = await citaDelCaso(db, actor, entrada.id);
  if ('error' in caso) return { success: false, error: caso.error };

  const r = await cliente.enviar(caso.appointmentId, texto);
  if (!r) return { success: false, error: MSG_SIN_RESPUESTA };
  if (!r.ok) return { success: false, error: MOTIVO_SIN_MENSAJE[r.motivo] ?? MSG_SIN_RESPUESTA };

  // La constancia en el historial del caso. El mensaje ya salió: si esto falla, no
  // se dice que falló (se reenviaría dos veces).
  try {
    await db.syncExceptionLog.create({
      data: {
        exceptionId: caso.fila.id,
        action: 'MENSAJE_AL_PACIENTE',
        actorUserId: actor.userId,
        actorRole: actor.role,
        note: `Por ${r.canal === 'TELEGRAM' ? 'Telegram' : 'WhatsApp'}${r.destino ? ` al ${r.destino}` : ''}`,
      },
    });
  } catch (error: unknown) {
    console.error('[bandeja] el mensaje salió pero no se anotó en el historial', {
      exceptionId: caso.fila.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    success: true,
    data: {
      canal: r.canal,
      destino: r.destino,
      appointmentId: caso.appointmentId,
      inicio: caso.fila.appointmentStartAt ?? null,
    },
  };
}

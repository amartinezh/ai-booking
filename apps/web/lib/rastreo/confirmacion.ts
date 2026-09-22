/**
 * «Enviar confirmación por WhatsApp» desde el rastreo, escenario B
 * (docs/PLAN_RASTREO_PACIENTE.md §12 #7): el hospital le agendó al paciente una cita
 * que el bot no le muestra, y quien atiende le manda la confirmación.
 *
 * La WEB no envía WhatsApp: no tiene las credenciales de Meta. Aquí se decide QUIÉN
 * puede pedirlo y se deja constancia en la bitácora del rastreo —como toda acción
 * de esta pantalla, con motivo—; el envío y sus comprobaciones de fondo (cupo ocupado
 * por el hospital y sin cita de AgenIA, WhatsApp del propio paciente, alcance, ventana
 * de 24 h o plantilla, antirrepetición) los hace la API en
 * `POST /appointments/his-confirmation`, que es la frontera de verdad: se puede llamar
 * directo con un token.
 */
import type { PrismaClient } from '@agenia/database';
import { enmascararDocumento } from '@agenia/shared';
import { SIN_PERMISOS, puedeConfirmar, type ActorRastreo } from './acceso';
import {
  MSG_NO_REGISTRADA,
  MSG_PACIENTE_NO_ENCONTRADO,
  registrar,
  validarMotivo,
} from './servicio';
import type { Resultado } from './tipos';

type Db = PrismaClient;

/**
 * Cómo se supo que la cita del hospital es de ESTE paciente: lo dijo la consulta en
 * vivo, o lo afirma quien atiende tras mirarlo en el HIS. La API no lo puede
 * comprobar; queda anotado en las dos bitácoras.
 */
export type VerificacionConfirmacion = 'HIS_EN_VIVO' | 'FUNCIONARIO';
const VERIFICACIONES: readonly VerificacionConfirmacion[] = ['HIS_EN_VIVO', 'FUNCIONARIO'];

export const MSG_CONFIRMACION_DATOS = 'Faltan el cupo o el paciente.';
export const MSG_CONFIRMACION_VERIFICACION =
  'Confirma que verificaste en el HIS que la cita es de este paciente.';
export const MSG_CONFIRMACION_API =
  'No se pudo contactar al servidor de envíos. Intenta de nuevo en un momento.';

export interface EntradaConfirmacion {
  pacienteId: unknown;
  slotId: unknown;
  verificacion: unknown;
  motivo: unknown;
  nota?: unknown;
}

export type RespuestaApiConfirmacion = {
  success: boolean;
  via?: 'TEXTO' | 'PLANTILLA';
  error?: string;
};

/** La llamada a la API, inyectada: la acción de Next la hace con el token de la sesión. */
export type EnviarAApi = (cuerpo: {
  scheduleSlotId: string;
  patientId: string;
  verificacion: VerificacionConfirmacion;
}) => Promise<RespuestaApiConfirmacion>;

export async function enviarConfirmacionHis(
  db: Db,
  actor: ActorRastreo,
  entrada: EntradaConfirmacion,
  enviar: EnviarAApi,
): Promise<Resultado<{ via: 'TEXTO' | 'PLANTILLA' }>> {
  if (!puedeConfirmar(actor)) return { success: false, error: SIN_PERMISOS };
  const motivo = validarMotivo(entrada.motivo, entrada.nota);
  if (!motivo.success) return motivo;

  const { pacienteId, slotId } = entrada;
  if (typeof pacienteId !== 'string' || !pacienteId || typeof slotId !== 'string' || !slotId) {
    return { success: false, error: MSG_CONFIRMACION_DATOS };
  }
  const verificacion = VERIFICACIONES.find((v) => v === entrada.verificacion);
  if (!verificacion) return { success: false, error: MSG_CONFIRMACION_VERIFICACION };

  const paciente = await db.patientProfile.findFirst({
    where: { id: pacienteId, organizationId: actor.organizationId },
    select: { id: true, cedula: true },
  });
  if (!paciente) return { success: false, error: MSG_PACIENTE_NO_ENCONTRADO };

  // Primero la constancia: sin ella, no se actúa sobre el paciente (§6 del plan).
  const registrada = await registrar(db, actor, {
    mode: 'B',
    queryKind: 'CONFIRM',
    queryMasked: enmascararDocumento(paciente.cedula) ?? '',
    reason: motivo.data.motivo,
    reasonNote: motivo.data.nota,
    candidateIds: [paciente.id],
    openedPatientId: paciente.id,
    verdicts: [{ codigo: `CONFIRMACION_${verificacion}`, citaId: null }],
  });
  if (!registrada) return { success: false, error: MSG_NO_REGISTRADA };

  let r: RespuestaApiConfirmacion;
  try {
    r = await enviar({ scheduleSlotId: slotId, patientId: paciente.id, verificacion });
  } catch (error: unknown) {
    console.error('[rastreo] la API de envíos no respondió', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: MSG_CONFIRMACION_API };
  }
  if (!r.success || !r.via) {
    return { success: false, error: r.error || MSG_CONFIRMACION_API };
  }
  return { success: true, data: { via: r.via } };
}

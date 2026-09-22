import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { OrganizationSettingsService } from '../chatbot/organization-settings.service';
import {
  InteractionLogService,
  InteractionStatus,
} from '../interaction-log/interaction-log.service';
import { SystemLogService } from '../system-log/system-log.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { formatForPatient } from '../common/business-hours';
import { doctorLabel } from '../common/doctor-label.util';
import { citaFueraDelAlcanceDelActor } from '../common/alcance-actor.util';
import { getErrorMessage } from '../common/error-message.util';

/**
 * 📨 Confirmarle al PACIENTE, por WhatsApp, una cita que agendó el HOSPITAL y que el
 * bot no le muestra (docs/PLAN_RASTREO_PACIENTE.md, escenario B y §12 #7).
 *
 * Es la acción que el veredicto `CITA_DEL_HIS_NO_ESPEJADA` le sugiere a quien atiende:
 * «la cita del hospital es válida; ofrecerle enviarle la confirmación».
 *
 * ═══ Por qué a veces es texto y a veces plantilla (§12 #7) ═══
 * Meta solo acepta texto libre dentro de las 24 h siguientes al último mensaje del
 * paciente. El caso típico —el paciente está escribiéndole al bot «no me aparece mi
 * cita»— cae DENTRO y sale como texto. Si no ha escrito en 24 h, sale con la plantilla
 * `HIS_APPOINTMENT_CONFIRMATION`; sin ella aprobada NO sale (el mensaje lo dice), en vez
 * de fallar en silencio contra Meta.
 *
 * ═══ Qué se comprueba, todo en el servidor ═══
 *  · El cupo es de ESTA clínica (la del token), es futuro, AgenIA lo tiene OCUPADO
 *    por el hospital y SIN cita de AgenIA: es exactamente el escenario B. Si AgenIA
 *    tiene la cita, el bot ya se la muestra y no hay nada que confirmar.
 *  · El paciente es de esta clínica, y el mensaje va SOLO al WhatsApp que AgenIA ya
 *    tiene de él. Nunca a un número escrito en pantalla: una cita médica es un dato de
 *    salud, y un número mal digitado se lo contaría a un desconocido.
 *  · El alcance: un agente acotado a una EPS o a un médico no confirma fuera de lo suyo
 *    (la EPS es la del paciente, porque la cita del hospital no la trae).
 *  · Una sola confirmación por cupo y paciente cada 10 min: un doble clic no manda dos.
 *
 * Lo que NO puede comprobar: que la cita del HIS sea de ESTE paciente. Eso lo dice la
 * consulta en vivo o lo afirma quien atiende tras mirarlo en el HIS; la pantalla exige
 * una de las dos y aquí queda anotado cuál (`verificacion`).
 */

export type VerificacionConfirmacion = 'HIS_EN_VIVO' | 'FUNCIONARIO';
const VERIFICACIONES: readonly VerificacionConfirmacion[] = [
  'HIS_EN_VIVO',
  'FUNCIONARIO',
];

export interface ResultadoConfirmacion {
  success: boolean;
  /** Por dónde salió: dentro de la ventana de 24 h como texto, fuera con plantilla. */
  via?: 'TEXTO' | 'PLANTILLA';
  error?: string;
}

/** Una confirmación por cupo y paciente en este lapso. */
const ANTIRREPETICION_SEG = 10 * 60;

export const MSG_CONFIRMACION = {
  datos: 'Faltan el cupo o el paciente.',
  verificacion:
    'Indica cómo se verificó que la cita del hospital es de este paciente.',
  cupo: 'Ese cupo no existe en esta clínica.',
  pasada: 'Esa cita ya pasó: no hay nada que confirmar.',
  libre:
    'AgenIA no tiene ese cupo ocupado por el hospital: no hay una cita del hospital que confirmar. Verifica el médico, la fecha y la hora.',
  conCita:
    'Ese cupo ya tiene una cita en AgenIA: el bot se la muestra al paciente, no hace falta confirmarla.',
  paciente: 'Ese paciente no existe en esta clínica.',
  sinWhatsapp:
    'AgenIA no tiene un WhatsApp de este paciente: la confirmación hay que darla por otro medio.',
  alcance: 'Esta cita está fuera de su alcance (EPS o médico asignados).',
  repetida:
    'Ya se le envió esta confirmación hace menos de 10 minutos. Espera a que le llegue antes de reenviarla.',
  sinPlantilla:
    'El paciente no le ha escrito a la clínica en las últimas 24 h, y para escribirle fuera de ese plazo WhatsApp exige una plantilla aprobada: falta registrar «Confirmación de una cita del hospital» en Configuración.',
  fallo:
    'WhatsApp no aceptó el envío. Revisa la conexión de WhatsApp de la clínica o intenta de nuevo.',
} as const;

@Injectable()
export class HisConfirmationService {
  private readonly logger = new Logger(HisConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly chatbot: ChatbotService,
    private readonly templates: WhatsappTemplateService,
    private readonly organizationSettings: OrganizationSettingsService,
    private readonly interactionLog: InteractionLogService,
    private readonly systemLog: SystemLogService,
  ) {}

  async enviar(
    input: {
      organizationId: string;
      actor: { userId: string; role: string };
      scheduleSlotId: unknown;
      patientId: unknown;
      verificacion: unknown;
    },
    ahora: Date = new Date(),
  ): Promise<ResultadoConfirmacion> {
    const { organizationId, actor } = input;
    const no = (error: string): ResultadoConfirmacion => ({
      success: false,
      error,
    });

    if (
      typeof input.scheduleSlotId !== 'string' ||
      !input.scheduleSlotId ||
      typeof input.patientId !== 'string' ||
      !input.patientId
    ) {
      return no(MSG_CONFIRMACION.datos);
    }
    const verificacion = VERIFICACIONES.find((v) => v === input.verificacion);
    if (!verificacion) return no(MSG_CONFIRMACION.verificacion);

    // ── El cupo: de esta clínica, futuro, ocupado por el hospital y sin cita de AgenIA ──
    const cupo = await this.prisma.scheduleSlot.findFirst({
      where: { id: input.scheduleSlotId, organizationId },
      select: {
        id: true,
        startTime: true,
        isAvailable: true,
        doctorId: true,
        doctor: { select: { fullName: true, isFunctionalAgenda: true } },
        service: { select: { name: true } },
        appointments: {
          where: { status: { not: 'CANCELLED' } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!cupo) return no(MSG_CONFIRMACION.cupo);
    if (cupo.startTime.getTime() <= ahora.getTime())
      return no(MSG_CONFIRMACION.pasada);
    if (cupo.appointments.length > 0) return no(MSG_CONFIRMACION.conCita);
    if (cupo.isAvailable) return no(MSG_CONFIRMACION.libre);

    // ── El paciente: de esta clínica, con un WhatsApp que AgenIA ya conoce ──
    const paciente = await this.prisma.patientProfile.findFirst({
      where: { id: input.patientId, organizationId },
      select: {
        id: true,
        userId: true,
        fullName: true,
        whatsappId: true,
        bsuid: true,
        epsId: true,
      },
    });
    if (!paciente) return no(MSG_CONFIRMACION.paciente);
    // El BSUID manda sobre el teléfono, como en los recordatorios.
    const destino = paciente.bsuid || paciente.whatsappId;
    if (!destino) return no(MSG_CONFIRMACION.sinWhatsapp);

    if (
      await citaFueraDelAlcanceDelActor(
        this.prisma,
        actor,
        { epsId: paciente.epsId, doctorId: cupo.doctorId },
        this.logger,
      )
    ) {
      return no(MSG_CONFIRMACION.alcance);
    }

    // ── Una por cupo y paciente cada 10 min ──
    const candado = `his-confirm:${organizationId}:${cupo.id}:${paciente.id}`;
    if (!(await this.reservar(candado))) return no(MSG_CONFIRMACION.repetida);

    const nombre = paciente.fullName?.split(' ')[0] || 'Paciente';
    const servicio = cupo.service?.name || 'su consulta';
    const medico = doctorLabel(cupo.doctor) || 'su médico';
    const fecha = formatForPatient(cupo.startTime);

    let resultado: { success: boolean; error?: string };
    let via: 'TEXTO' | 'PLANTILLA';
    let texto: string;
    try {
      const dentro = await this.chatbot.isWithinServiceWindow(
        organizationId,
        destino,
      );
      if (dentro) {
        via = 'TEXTO';
        texto = await this.mensajeLibre(organizationId, {
          nombre,
          servicio,
          medico,
          fecha,
        });
        resultado = await this.chatbot.sendOutboundForOrg(
          organizationId,
          destino,
          texto,
          { kind: 'BOOKING_CONFIRMATION' },
        );
      } else {
        via = 'PLANTILLA';
        texto = `[Plantilla HIS_APPOINTMENT_CONFIRMATION] ${nombre} · ${servicio} · ${medico} · ${fecha}`;
        resultado = await this.templates.sendTemplate({
          organizationId,
          recipientId: destino,
          kind: 'HIS_APPOINTMENT_CONFIRMATION',
          bodyParams: [nombre, servicio, medico, fecha],
        });
      }
    } catch (error: unknown) {
      resultado = { success: false, error: getErrorMessage(error) };
      via = 'TEXTO';
      texto = '';
    }

    if (!resultado.success) {
      // No salió: se libera el candado para que se pueda reintentar enseguida.
      await this.liberar(candado);
      this.logger.warn(
        `Confirmación de cita del HIS NO enviada (org ${organizationId}, cupo ${cupo.id}, vía ${via}): ${resultado.error ?? 'sin detalle'}.`,
      );
      return no(
        resultado.error === 'template-not-configured'
          ? MSG_CONFIRMACION.sinPlantilla
          : MSG_CONFIRMACION.fallo,
      );
    }

    // La conversación del paciente la muestra (el rastreo la reconstruye de aquí).
    await this.interactionLog.log({
      whatsappId: destino,
      organizationId,
      status: InteractionStatus.OUTBOUND,
      botReply: texto,
      patientUserId: paciente.userId,
      metadata: {
        outbound: true,
        tipo: 'CONFIRMACION_CITA_HIS',
        via,
        scheduleSlotId: cupo.id,
        enviadoPor: actor.role,
      },
    });
    await this.systemLog.event({
      action: 'HIS_CONFIRMATION_SENT',
      message: `Confirmación de una cita del hospital enviada al paciente por ${via === 'TEXTO' ? 'texto' : 'plantilla'}.`,
      organizationId,
      userId: actor.userId,
      metadata: {
        scheduleSlotId: cupo.id,
        patientId: paciente.id,
        actorRole: actor.role,
        verificacion,
        via,
      },
    });
    return { success: true, via };
  }

  /** El texto libre (dentro de la ventana de 24 h), con el nombre del bot y de la clínica. */
  private async mensajeLibre(
    organizationId: string,
    d: { nombre: string; servicio: string; medico: string; fecha: string },
  ): Promise<string> {
    const [botName, org] = await Promise.all([
      this.organizationSettings.getBotName(organizationId),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
    ]);
    const clinica = org?.name ?? 'su clínica';
    // Sin «escríbeme cancelar cita»: el bot no conoce esta cita (nació en el hospital)
    // y no podría cancelarla. Decírselo evita una segunda frustración.
    return (
      `Hola ${d.nombre}. Le saluda *${botName}*, de *${clinica}*.\n\n` +
      `Le confirmamos su cita de *${d.servicio}* con *${d.medico}* el *${d.fecha}*.\n\n` +
      `Esta cita la asignó directamente el hospital: si necesita cancelarla o cambiarla, comuníquese con el hospital. 🩺`
    );
  }

  /** `true` si esta petición reservó el envío. Si Redis falla, no bloquea (no es un control de seguridad). */
  private async reservar(clave: string): Promise<boolean> {
    try {
      const r = await this.redis.set(
        clave,
        '1',
        'EX',
        ANTIRREPETICION_SEG,
        'NX',
      );
      return r === 'OK';
    } catch (error: unknown) {
      this.logger.warn(
        `Sin antirrepetición (Redis no respondió): ${getErrorMessage(error)}`,
      );
      return true;
    }
  }

  private async liberar(clave: string): Promise<void> {
    try {
      await this.redis.del(clave);
    } catch {
      // Si no se puede liberar, el candado vence solo en 10 minutos.
    }
  }
}

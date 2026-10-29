import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@agenia/database';
import {
  destinoDeContacto,
  enmascararIdentificadorWhatsapp,
  formatAppointmentLong,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from './chatbot.service';
import {
  InteractionLogService,
  InteractionStatus,
} from '../interaction-log/interaction-log.service';
import { doctorLabel } from '../common/doctor-label.util';
import {
  MAX_MENSAJE_AL_PACIENTE,
  sugerenciasDeMensaje,
  type SugerenciasMensaje,
} from './mensaje-al-paciente';

/**
 * ✉️ El personal le escribe al paciente de una cita desde la Bandeja
 * (2026-10-29): «su cita se canceló, disculpas», «quedó registrada»…
 *
 * WhatsApp solo entrega texto libre dentro de las 24 horas siguientes al último
 * mensaje de la PERSONA, y AgenIA anota esa ventana con el identificador con que
 * escribió. Quien agendó puede no ser el titular de la ficha (un familiar desde su
 * celular): se revisan el destino de siempre, los números que escribieron por esta
 * cita (quien la agendó, quien respondió el recordatorio) y los de la ficha, y el
 * mensaje va al primero con la ventana abierta. Es la misma regla del aviso «el
 * hospital canceló una cita del asistente» (`aviso-cambio-hospital.service.ts`).
 * Fuera de la ventana no se envía: Meta lo rechazaría después de aceptarlo y el
 * panel diría «enviado» sin que llegue.
 *
 * Nunca por WhatsApp a un paciente con el caso «el teléfono es de otra persona»
 * abierto, igual que los recordatorios.
 *
 * El texto queda en la conversación del paciente (Caja Negra, que se purga) para
 * que el rastreo lo muestre. Quién lo envió lo registra el panel.
 */

export type MotivoSinMensaje =
  | 'NO_ENCONTRADA'
  | 'SIN_CONTACTO'
  | 'TELEFONO_EQUIVOCADO'
  | 'FUERA_DE_VENTANA'
  | 'MENSAJE_INVALIDO'
  | 'FALLO';

export type RevisionMensajeAlPaciente =
  | {
      ok: true;
      canal: 'WHATSAPP' | 'TELEGRAM';
      /** Se le puede escribir texto libre ahora. */
      puedeEscribir: boolean;
      /** Hasta cuándo (WhatsApp con la ventana abierta); si no, null. */
      hastaIso: string | null;
      /** A dónde iría, enmascarado («•••9051»); null por Telegram. */
      destino: string | null;
      /** Va a un número que no es el de la ficha (quien agendó o respondió por la cita). */
      otroNumero: boolean;
      /** La cita sigue vigente en AgenIA. */
      citaVigente: boolean;
      sugerencias: SugerenciasMensaje;
    }
  | { ok: false; motivo: MotivoSinMensaje };

export type EnvioMensajeAlPaciente =
  | { ok: true; canal: 'WHATSAPP' | 'TELEGRAM'; destino: string | null }
  | { ok: false; motivo: MotivoSinMensaje };

const SELECT_CITA = {
  id: true,
  origin: true,
  status: true,
  createdAt: true,
  patientId: true,
  patient: {
    select: {
      userId: true,
      fullName: true,
      whatsappId: true,
      bsuid: true,
      telegramChatId: true,
      telegramBlockedAt: true,
    },
  },
  scheduleSlot: {
    select: {
      startTime: true,
      doctor: { select: { fullName: true, isFunctionalAgenda: true } },
      service: { select: { name: true } },
    },
  },
} satisfies Prisma.AppointmentSelect;

type CitaDelMensaje = Prisma.AppointmentGetPayload<{
  select: typeof SELECT_CITA;
}>;

interface Destino {
  canal: 'WHATSAPP' | 'TELEGRAM';
  destinatario: string;
  hasta: Date | null;
  otroNumero: boolean;
}

/** Cuántos números distintos que escribieron por la cita se revisan, como mucho. */
const MAX_CANDIDATOS = 6;

@Injectable()
export class MensajeAlPacienteService {
  private readonly logger = new Logger(MensajeAlPacienteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatbot: ChatbotService,
    private readonly interactionLog: InteractionLogService,
  ) {}

  /** ¿Se le puede escribir ahora, por dónde y con qué texto sugerido? No envía nada. */
  async revisar(
    organizationId: string,
    appointmentId: string,
  ): Promise<RevisionMensajeAlPaciente> {
    const cita = await this.cargarCita(organizationId, appointmentId);
    if (!cita) return { ok: false, motivo: 'NO_ENCONTRADA' };
    const destino = await this.elegirDestino(organizationId, cita);
    if ('motivo' in destino) return { ok: false, motivo: destino.motivo };

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, supportPhone: true, timezone: true },
    });
    const sugerencias = sugerenciasDeMensaje({
      paciente: cita.patient.fullName,
      clinica: org?.name,
      servicio: cita.scheduleSlot.service?.name,
      fecha: formatAppointmentLong(cita.scheduleSlot.startTime, {
        timeZone: org?.timezone || undefined,
      }),
      medico: doctorLabel(cita.scheduleSlot.doctor),
      telefonoClinica: org?.supportPhone,
    });

    const puedeEscribir = destino.canal === 'TELEGRAM' || !!destino.hasta;
    return {
      ok: true,
      canal: destino.canal,
      puedeEscribir,
      hastaIso: destino.hasta?.toISOString() ?? null,
      destino:
        destino.canal === 'WHATSAPP'
          ? enmascararIdentificadorWhatsapp(destino.destinatario)
          : null,
      otroNumero: destino.otroNumero,
      citaVigente: cita.status === 'SCHEDULED',
      sugerencias,
    };
  }

  async enviar(
    organizationId: string,
    appointmentId: string,
    mensaje: unknown,
  ): Promise<EnvioMensajeAlPaciente> {
    const texto = typeof mensaje === 'string' ? mensaje.trim() : '';
    if (!texto || texto.length > MAX_MENSAJE_AL_PACIENTE) {
      return { ok: false, motivo: 'MENSAJE_INVALIDO' };
    }
    const cita = await this.cargarCita(organizationId, appointmentId);
    if (!cita) return { ok: false, motivo: 'NO_ENCONTRADA' };
    const destino = await this.elegirDestino(organizationId, cita);
    if ('motivo' in destino) return { ok: false, motivo: destino.motivo };
    if (destino.canal === 'WHATSAPP' && !destino.hasta) {
      return { ok: false, motivo: 'FUERA_DE_VENTANA' };
    }

    const resultado = await this.chatbot.sendOutboundForOrg(
      organizationId,
      destino.destinatario,
      texto,
      { kind: 'MANUAL', appointmentId: cita.id },
    );
    if (!resultado.success) {
      this.logger.warn(
        `Mensaje del personal NO enviado (org ${organizationId}, cita ${cita.id}): ${resultado.error ?? 'sin detalle'}.`,
      );
      return { ok: false, motivo: 'FALLO' };
    }

    // En la conversación del paciente: el rastreo la reconstruye de aquí.
    await this.interactionLog.log({
      whatsappId: destino.destinatario,
      organizationId,
      status: InteractionStatus.OUTBOUND,
      botReply: texto,
      patientUserId: cita.patient.userId,
      metadata: {
        outbound: true,
        tipo: 'MENSAJE_DEL_PERSONAL',
        appointmentId: cita.id,
        ...(destino.canal === 'TELEGRAM' ? { canal: 'TELEGRAM' } : {}),
      },
    });

    return {
      ok: true,
      canal: destino.canal,
      destino:
        destino.canal === 'WHATSAPP'
          ? enmascararIdentificadorWhatsapp(destino.destinatario)
          : null,
    };
  }

  private async cargarCita(
    organizationId: string,
    appointmentId: unknown,
  ): Promise<CitaDelMensaje | null> {
    if (typeof appointmentId !== 'string' || !appointmentId) return null;
    if (appointmentId.length > 64) return null;
    return this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: SELECT_CITA,
    });
  }

  private async elegirDestino(
    organizationId: string,
    cita: CitaDelMensaje,
  ): Promise<Destino | { motivo: MotivoSinMensaje }> {
    const contacto = destinoDeContacto(cita.patient, cita.origin);
    if (!contacto) return { motivo: 'SIN_CONTACTO' };

    if (contacto.canal === 'TELEGRAM') {
      return {
        canal: 'TELEGRAM',
        destinatario: contacto.destinatario,
        hasta: null,
        otroNumero: false,
      };
    }

    const equivocado = await this.prisma.syncException.findFirst({
      where: {
        organizationId,
        kind: 'TELEFONO_EQUIVOCADO',
        patientId: cita.patientId,
        status: { in: ['ABIERTA', 'EN_REVISION'] },
      },
      select: { id: true },
    });
    if (equivocado) return { motivo: 'TELEFONO_EQUIVOCADO' };

    const deLaFicha = [cita.patient.bsuid, cita.patient.whatsappId]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
    const candidatos = [
      contacto.destinatario,
      ...(await this.quienesEscribieron(organizationId, cita)),
      ...deLaFicha,
    ].filter(
      (v, i, todos) =>
        v.length > 0 && !v.startsWith('tg:') && todos.indexOf(v) === i,
    );

    for (const id of candidatos) {
      const hasta = await this.chatbot.serviceWindowEndsAt(organizationId, id);
      if (hasta) {
        return {
          canal: 'WHATSAPP',
          destinatario: id,
          hasta,
          otroNumero: !deLaFicha.includes(id),
        };
      }
    }
    return {
      canal: 'WHATSAPP',
      destinatario: contacto.destinatario,
      hasta: null,
      otroNumero: false,
    };
  }

  /** Los números que escribieron por esta cita (quien la agendó, quien respondió…), del más reciente. */
  private async quienesEscribieron(
    organizationId: string,
    cita: CitaDelMensaje,
  ): Promise<string[]> {
    try {
      const filas = await this.prisma.interactionLog.findMany({
        where: {
          organizationId,
          createdAt: { gte: new Date(cita.createdAt.getTime() - 60_000) },
          status: { not: InteractionStatus.OUTBOUND },
          metadata: { path: ['appointmentId'], equals: cita.id },
        },
        orderBy: { createdAt: 'desc' },
        select: { whatsappId: true },
        take: 50,
      });
      return [...new Set(filas.map((f) => f.whatsappId))].slice(
        0,
        MAX_CANDIDATOS,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudieron leer los números de la cita ${cita.id}: ${(error as Error).message}`,
      );
      return [];
    }
  }
}

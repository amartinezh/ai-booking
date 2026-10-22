import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  destinoDeContacto,
  formatAppointmentLong,
  severidadPorCercania,
  TITULO_EXCEPCION,
  type SeveridadExcepcion,
  type TipoExcepcion,
} from '@agenia/shared';
import type { Prisma } from '@agenia/database';
import { PrismaService } from '../prisma/prisma.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { OrganizationSettingsService } from '../chatbot/organization-settings.service';
import { buildMessages } from '../chatbot/chatbot.constants';
import {
  InteractionLogService,
  InteractionStatus,
} from '../interaction-log/interaction-log.service';
import { doctorLabel } from '../common/doctor-label.util';
import { formatForPatient } from '../common/business-hours';
import { getErrorMessage } from '../common/error-message.util';

/**
 * 🏥 El hospital canceló —o cambió de hora— EN SU SISTEMA una cita que el paciente
 * agendó con el asistente (2026-10-22).
 *
 * Ese día el hospital anuló la cita que una paciente había agendado por WhatsApp a
 * las 10:04; AgenIA liberó el cupo y avisó a la lista de espera, pero a ella nadie le
 * dijo nada y siguió creyendo que tenía cita a las 3:20 p. m. Ahora:
 *
 *  1. Se le avisa al paciente por donde agendó:
 *     · WhatsApp dentro de las 24 h de su último mensaje, o Telegram: texto libre;
 *     · WhatsApp fuera de la ventana: si el hospital le dio OTRA cita, con la
 *       plantilla aprobada de confirmación de cita del hospital (la nueva hora); si
 *       solo la canceló, no hay plantilla para eso y no se envía nada;
 *     · nunca a un número marcado como de otra persona (caso de teléfono
 *       equivocado abierto), igual que los recordatorios.
 *  2. Se abre un caso en la Bandeja para que una persona confirme que el paciente
 *     quedó enterado: dice si se le avisó, por dónde, o por qué no.
 *
 * «Cambio de hora»: el hospital no mueve una cita, la cancela y crea otra. Si al
 * cancelar ya hay una cita NUEVA del hospital para el mismo paciente (nacida en los
 * últimos 10 minutos, futura y vigente), es un cambio. En la práctica la nueva llega
 * antes o junto con la cancelación (medido el 2026-10-22: 34 cambios en 7 días).
 *
 * Solo citas del asistente (WhatsApp o Telegram), futuras y canceladas por el
 * hospital. Las que nacieron en el hospital las maneja el personal, y las que el
 * paciente canceló por el bot ya están avisadas.
 *
 * Nunca lanza: va después de aplicar la cancelación y no puede deshacerla.
 * El chatbot se pide al contenedor al usarlo (`ModuleRef`), para no cambiar cómo se
 * conectan los módulos.
 */

const ORIGENES_DEL_ASISTENTE: readonly string[] = ['WHATSAPP', 'TELEGRAM'];

/** Cuánto antes de la cancelación pudo nacer la cita nueva para contar como cambio de hora. */
export const VENTANA_CAMBIO_DE_HORA_MS = 10 * 60_000;

export type MotivoSinAviso =
  | 'SIN_CONTACTO'
  | 'TELEFONO_EQUIVOCADO'
  | 'FUERA_DE_VENTANA'
  | 'SIN_PLANTILLA'
  | 'FALLO';

export interface ResultadoAviso {
  aviso: 'ENVIADO' | 'NO_ENVIADO';
  canal?: 'WHATSAPP' | 'TELEGRAM';
  via?: 'TEXTO' | 'PLANTILLA';
  motivo?: MotivoSinAviso;
  enviadoIso?: string;
}

const MS_MIN = 60_000;

/** «VICTORIA SANCHEZ» → «Victoria». */
function primerNombre(nombreCompleto: string | null | undefined): string {
  const primero = (nombreCompleto ?? '').trim().split(/\s+/)[0] ?? '';
  return primero
    ? primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase()
    : '';
}

const SELECT_CITA = {
  id: true,
  origin: true,
  epsId: true,
  patientId: true,
  patient: {
    select: {
      id: true,
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
      doctorId: true,
      doctor: { select: { fullName: true, isFunctionalAgenda: true } },
      service: { select: { name: true } },
    },
  },
} satisfies Prisma.AppointmentSelect;

@Injectable()
export class AvisoCambioHospitalService {
  private readonly logger = new Logger(AvisoCambioHospitalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exceptions: MirrorExceptionsService,
    private readonly templates: WhatsappTemplateService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Lo llama el espejo después de aplicar una cancelación hecha en el hospital. */
  async alCancelarElHospital(
    organizationId: string,
    appointmentId: string,
    ahora: Date = new Date(),
  ): Promise<void> {
    try {
      await this.procesar(organizationId, appointmentId, ahora);
    } catch (error: unknown) {
      this.logger.error(
        `Aviso de cita cancelada por el hospital falló (org ${organizationId}, cita ${appointmentId}): ${getErrorMessage(error)}`,
      );
    }
  }

  private async procesar(
    organizationId: string,
    appointmentId: string,
    ahora: Date,
  ): Promise<void> {
    const cita = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: SELECT_CITA,
    });
    if (!cita || !ORIGENES_DEL_ASISTENTE.includes(cita.origin)) return;
    if (cita.scheduleSlot.startTime.getTime() <= ahora.getTime()) return;

    // ¿El hospital le dio otra cita? (ver la nota de arriba)
    const nueva = await this.prisma.appointment.findFirst({
      where: {
        organizationId,
        patientId: cita.patientId,
        id: { not: cita.id },
        status: 'SCHEDULED',
        origin: 'MIRROR',
        createdAt: {
          gte: new Date(ahora.getTime() - VENTANA_CAMBIO_DE_HORA_MS),
        },
        scheduleSlot: { startTime: { gt: ahora } },
      },
      orderBy: { createdAt: 'desc' },
      select: SELECT_CITA,
    });

    const kind: TipoExcepcion = nueva
      ? 'CITA_MOVIDA_POR_HOSPITAL'
      : 'CITA_CANCELADA_POR_HOSPITAL';
    const inicio = (nueva ?? cita).scheduleSlot.startTime;
    const minutosParaLaCita = (inicio.getTime() - ahora.getTime()) / MS_MIN;
    const dedupeKey = `CAMBIO_HOSPITAL:${cita.id}`;
    const metaBase = {
      canalDeLaCita: cita.origin,
      antesIso: cita.scheduleSlot.startTime.toISOString(),
      nuevaIso: nueva ? nueva.scheduleSlot.startTime.toISOString() : null,
      nuevaCitaId: nueva?.id ?? null,
    };

    // La fila es el candado: solo quien la CREA avisa. Una cancelación que llegue
    // otra vez no le escribe dos veces al paciente.
    const registro = await this.exceptions.registrar(
      organizationId,
      {
        kind,
        dedupeKey,
        severity: severidadPorCercania('MEDIA', minutosParaLaCita),
        title: TITULO_EXCEPCION[kind],
        detail: `Cita ${cita.id} (${cita.origin}) cancelada en el hospital${nueva ? `; cita nueva ${nueva.id}` : ''}.`,
        appointmentId: cita.id,
        patientId: cita.patientId,
        epsId: cita.epsId,
        doctorId: (nueva ?? cita).scheduleSlot.doctorId,
        appointmentStartAt: inicio,
        meta: { ...metaBase, aviso: 'PENDIENTE' },
      },
      ahora,
    );
    if (registro !== 'CREADA') return;

    const aviso = await this.avisar(organizationId, cita, nueva, kind, ahora);

    // Sin aviso, alguien tiene que comunicarse con el paciente: al menos ALTA.
    const base: SeveridadExcepcion =
      aviso.aviso === 'ENVIADO' ? 'MEDIA' : 'ALTA';
    await this.prisma.syncException.updateMany({
      where: { organizationId, dedupeKey },
      data: {
        severity: severidadPorCercania(base, minutosParaLaCita),
        meta: { ...metaBase, ...aviso },
      },
    });
  }

  /** Quién agendó la cita con el asistente: el remitente de su confirmación. */
  private async remitenteDeLaReserva(
    organizationId: string,
    appointmentId: string,
  ): Promise<string | null> {
    const fila = await this.prisma.interactionLog.findFirst({
      where: {
        organizationId,
        status: 'BOOKING_CONFIRMED',
        metadata: { path: ['appointmentId'], equals: appointmentId },
      },
      orderBy: { createdAt: 'desc' },
      select: { whatsappId: true },
    });
    return fila?.whatsappId ?? null;
  }

  private async avisar(
    organizationId: string,
    cita: CitaParaAviso,
    nueva: CitaParaAviso | null,
    kind: TipoExcepcion,
    ahora: Date,
  ): Promise<ResultadoAviso> {
    const contacto = destinoDeContacto(cita.patient, cita.origin);
    if (!contacto) return { aviso: 'NO_ENVIADO', motivo: 'SIN_CONTACTO' };
    const canal = contacto.canal;

    if (
      canal === 'WHATSAPP' &&
      (await this.prisma.syncException.findFirst({
        where: {
          organizationId,
          kind: 'TELEFONO_EQUIVOCADO',
          patientId: cita.patientId,
          status: { in: ['ABIERTA', 'EN_REVISION'] },
        },
        select: { id: true },
      }))
    ) {
      return { aviso: 'NO_ENVIADO', canal, motivo: 'TELEFONO_EQUIVOCADO' };
    }

    const chatbot = this.moduleRef.get(ChatbotService, { strict: false });
    const ajustes = this.moduleRef.get(OrganizationSettingsService, {
      strict: false,
    });
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, supportPhone: true, timezone: true },
    });
    const timeZone = org?.timezone || undefined;
    const nombre = primerNombre(cita.patient.fullName);

    // La ventana de 24 h de WhatsApp es de la PERSONA, pero AgenIA la anota con el
    // identificador con que escribió: el teléfono o el BSUID. Y quien agendó puede
    // no ser el titular de la ficha (2026-10-22: un familiar agendó para Victoria
    // desde su WhatsApp; su teléfono es de otra ficha y a la de ella solo quedó su
    // BSUID). Se revisan todos los identificadores conocidos —el destino, los de
    // la ficha y el de quien agendó— y el texto va al primero con la ventana
    // abierta. Si ninguno la tiene, se sigue con el destino de siempre.
    const remitente = await this.remitenteDeLaReserva(organizationId, cita.id);
    const candidatos = [
      contacto.destinatario,
      remitente,
      cita.patient.bsuid,
      cita.patient.whatsappId,
    ].filter(
      (v, i, todos): v is string =>
        typeof v === 'string' && v.length > 0 && todos.indexOf(v) === i,
    );
    let destino = contacto.destinatario;
    let dentro = canal === 'TELEGRAM';
    if (!dentro) {
      for (const id of candidatos) {
        if (id.startsWith('tg:')) continue;
        if (await chatbot.isWithinServiceWindow(organizationId, id)) {
          destino = id;
          dentro = true;
          break;
        }
      }
    }

    let via: 'TEXTO' | 'PLANTILLA';
    let texto: string;
    let resultado: { success: boolean; error?: string };
    if (dentro) {
      const MSGS = buildMessages(
        await ajustes.getCommunicationStyle(organizationId),
        canal,
      );
      const contactoClinica = org?.supportPhone
        ? MSGS.contactoClinica(org.supportPhone)
        : MSGS.contactoClinicaSinTelefono();
      const clinica = org?.name ?? 'el hospital';
      const servicio = cita.scheduleSlot.service?.name ?? 'su consulta';
      const fecha = formatAppointmentLong(cita.scheduleSlot.startTime, {
        timeZone,
      });
      texto = nueva
        ? MSGS.citaMovidaPorElHospital({
            nombre,
            clinica,
            servicio,
            fechaAntes: fecha,
            fechaNueva: formatAppointmentLong(nueva.scheduleSlot.startTime, {
              timeZone,
            }),
            medicoNuevo: doctorLabel(nueva.scheduleSlot.doctor) || 'su médico',
            contacto: contactoClinica,
          })
        : MSGS.citaCanceladaPorElHospital({
            nombre,
            clinica,
            servicio,
            fecha,
            medico: doctorLabel(cita.scheduleSlot.doctor) || 'su médico',
            contacto: contactoClinica,
            puedeAgendar: (await ajustes.operacionesDelBot(organizationId))
              .agendar,
          });
      via = 'TEXTO';
      resultado = await chatbot.sendOutboundForOrg(
        organizationId,
        destino,
        texto,
        { kind: 'SYSTEM_NOTICE', appointmentId: cita.id },
      );
    } else if (nueva) {
      // Fuera de la ventana, la plantilla aprobada de confirmación de una cita del
      // hospital: le dice la hora NUEVA, que es lo que tiene que saber.
      const servicio = nueva.scheduleSlot.service?.name || 'su consulta';
      const medico = doctorLabel(nueva.scheduleSlot.doctor) || 'su médico';
      const fecha = formatForPatient(nueva.scheduleSlot.startTime);
      via = 'PLANTILLA';
      texto = `[Plantilla HIS_APPOINTMENT_CONFIRMATION] ${nombre} · ${servicio} · ${medico} · ${fecha}`;
      resultado = await this.templates.sendTemplate({
        organizationId,
        recipientId: contacto.destinatario,
        kind: 'HIS_APPOINTMENT_CONFIRMATION',
        bodyParams: [nombre || 'Paciente', servicio, medico, fecha],
        appointmentId: cita.id,
      });
    } else {
      return { aviso: 'NO_ENVIADO', canal, motivo: 'FUERA_DE_VENTANA' };
    }

    if (!resultado.success) {
      this.logger.warn(
        `Aviso al paciente NO enviado (org ${organizationId}, cita ${cita.id}, vía ${via}): ${resultado.error ?? 'sin detalle'}.`,
      );
      return {
        aviso: 'NO_ENVIADO',
        canal,
        via,
        motivo:
          resultado.error === 'template-not-configured'
            ? 'SIN_PLANTILLA'
            : 'FALLO',
      };
    }

    // En la conversación del paciente (el rastreo la reconstruye de aquí).
    await this.moduleRef
      .get(InteractionLogService, { strict: false })
      .log({
        whatsappId: destino,
        organizationId,
        status: InteractionStatus.OUTBOUND,
        botReply: texto,
        patientUserId: cita.patient.userId,
        metadata: {
          outbound: true,
          tipo: kind,
          via,
          appointmentId: cita.id,
          ...(nueva ? { nuevaCitaId: nueva.id } : {}),
          ...(canal === 'TELEGRAM' ? { canal: 'TELEGRAM' } : {}),
        },
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `No se pudo anotar el aviso en la conversación: ${getErrorMessage(e)}`,
        ),
      );

    return { aviso: 'ENVIADO', canal, via, enviadoIso: ahora.toISOString() };
  }
}

type CitaParaAviso = Prisma.AppointmentGetPayload<{
  select: typeof SELECT_CITA;
}>;

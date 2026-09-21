import { Injectable, Logger } from '@nestjs/common';
import {
  AGENTE_SIN_SENAL_MIN,
  DEFAULT_TIMEZONE,
  TIPOS_CON_AVISO,
  parametrosPlantillaAviso,
  requiereAviso,
  type EstadoExcepcion,
  type ItemAviso,
  type SeveridadExcepcion,
  type TipoExcepcion,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { doctorLabel } from '../common/doctor-label.util';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';

/**
 * El aviso PROACTIVO al agendador (docs/PLAN_RASTREO_PACIENTE.md §10 #2, Fase 3):
 * «una cita confirmada por WhatsApp no llegó al hospital». Avisa ANTES de que el
 * paciente llegue, en vez de esperar a que alguien abra la bandeja.
 *
 * ═══ Cómo se cuida al agendador ═══
 *  · UN solo mensaje por vuelta y clínica, con el resumen (cuántas y la más próxima),
 *    no uno por cita: veinte WhatsApp seguidos se silencian y el aviso deja de servir.
 *  · Una vez por gravedad (`requiereAviso`): vuelve a avisar solo si la cita se acercó.
 *  · Solo de lo que nadie ha tomado: si alguien ya se ocupa, avisar es ruido.
 *
 * ═══ Cómo se cuida al paciente ═══
 *  · El mensaje sale hacia el teléfono personal del agendador y pasa por Meta: dice
 *    QUÉ pasa y cuándo, SIN datos del paciente. El detalle está en la bandeja, tras la
 *    sesión (`parametrosPlantillaAviso` lo garantiza y lo prueba).
 *
 * ═══ Por qué una plantilla y no texto libre ═══
 * El agendador casi nunca le ha escrito al número de la clínica: fuera de la
 * ventana de 24 h de Meta un mensaje libre no sale. Sin la plantilla aprobada el
 * aviso NO sale y la excepción queda solo en la bandeja — nada se pierde, pero nadie
 * se entera hasta que la abre. Por eso la bandeja lo dice.
 *
 * ═══ Dos réplicas de la API ═══
 * Cada excepción se RECLAMA con un compare-and-set antes de enviar (`reclamarAviso`):
 * solo una réplica gana, y si el envío falla la reclamación se devuelve para que la
 * vuelta siguiente reintente.
 *
 * El correo (`agendadorEmail`) NO se usa: la API no tiene transporte de correo.
 */

export type ResultadoAviso =
  | { enviado: true; citas: number }
  | {
      enviado: false;
      motivo:
        | 'NADA_QUE_AVISAR'
        | 'APAGADO'
        | 'SIN_DESTINO'
        | 'SIN_PLANTILLA'
        | 'YA_RECLAMADO'
        | 'ENVIO_FALLIDO';
      detalle?: string;
    };

/** Tope de excepciones que se consideran por vuelta. */
const MAX_CANDIDATAS = 200;

@Injectable()
export class MirrorAlertService {
  private readonly logger = new Logger(MirrorAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exceptions: MirrorExceptionsService,
    private readonly templates: WhatsappTemplateService,
  ) {}

  async avisar(
    organizationId: string,
    ahora: Date = new Date(),
  ): Promise<ResultadoAviso> {
    const candidatas = await this.prisma.syncException.findMany({
      where: {
        organizationId,
        status: 'ABIERTA',
        kind: { in: [...TIPOS_CON_AVISO] },
      },
      orderBy: { appointmentStartAt: 'asc' },
      take: MAX_CANDIDATAS,
    });
    const debidas = candidatas.filter((e) =>
      requiereAviso(
        {
          kind: e.kind as TipoExcepcion,
          severity: e.severity as SeveridadExcepcion,
          status: e.status as EstadoExcepcion,
          notifiedSeverity: e.notifiedSeverity,
          appointmentStartIso: e.appointmentStartAt?.toISOString() ?? null,
        },
        ahora.toISOString(),
      ),
    );
    if (debidas.length === 0)
      return { enviado: false, motivo: 'NADA_QUE_AVISAR' };

    // Antes de reclamar nada: si el aviso no puede salir, no se toca ninguna fila
    // (reclamar y devolver en cada vuelta sería puro ruido de escritura).
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: {
        enabled: true,
        conflictAlertsEnabled: true,
        agendadorWhatsapp: true,
        lastHeartbeatAt: true,
        lastHisReachable: true,
      },
    });
    if (!config?.enabled || !config.conflictAlertsEnabled) {
      return { enviado: false, motivo: 'APAGADO' };
    }
    if (!config.agendadorWhatsapp)
      return { enviado: false, motivo: 'SIN_DESTINO' };
    const plantilla = await this.templates.findTemplate(
      organizationId,
      'SYNC_EXCEPTION_ALERT',
    );
    if (!plantilla) return { enviado: false, motivo: 'SIN_PLANTILLA' };

    // Reclamar: solo lo que esta réplica ganó se avisa.
    const reclamadas: typeof debidas = [];
    for (const e of debidas) {
      if (
        await this.exceptions.reclamarAviso(
          {
            id: e.id,
            severity: e.severity,
            notifiedSeverity: e.notifiedSeverity,
          },
          ahora,
        )
      ) {
        reclamadas.push(e);
      }
    }
    if (reclamadas.length === 0)
      return { enviado: false, motivo: 'YA_RECLAMADO' };

    const [medicos, org] = await Promise.all([
      this.prisma.doctorProfile.findMany({
        where: {
          organizationId,
          id: {
            in: [
              ...new Set(
                reclamadas
                  .map((e) => e.doctorId)
                  .filter((d): d is string => !!d),
              ),
            ],
          },
        },
        select: { id: true, fullName: true, isFunctionalAgenda: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { timezone: true },
      }),
    ]);
    const nombreDe = new Map(medicos.map((m) => [m.id, doctorLabel(m)]));

    const items: ItemAviso[] = reclamadas.map((e) => ({
      doctor: (e.doctorId && nombreDe.get(e.doctorId)) || 'Agenda del hospital',
      inicioIso: (e.appointmentStartAt ?? ahora).toISOString(),
      kind: e.kind as TipoExcepcion,
      severity: e.severity as SeveridadExcepcion,
    }));
    const sinSenal =
      !config.lastHeartbeatAt ||
      ahora.getTime() - config.lastHeartbeatAt.getTime() >
        AGENTE_SIN_SENAL_MIN * 60_000;

    const resultado = await this.templates.sendTemplate({
      organizationId,
      recipientId: config.agendadorWhatsapp,
      kind: 'SYNC_EXCEPTION_ALERT',
      bodyParams: parametrosPlantillaAviso(items, {
        agenteSinSenal: sinSenal,
        hisAlcanzable: config.lastHisReachable,
        timeZone: org?.timezone || DEFAULT_TIMEZONE,
      }),
    });

    if (!resultado.success) {
      // No salió: se devuelve lo reclamado para que la próxima vuelta reintente.
      for (const e of reclamadas) {
        await this.exceptions.devolverAviso(
          {
            id: e.id,
            notifiedAt: e.notifiedAt,
            notifiedSeverity: e.notifiedSeverity,
          },
          ahora,
        );
      }
      this.logger.warn(
        `Aviso al agendador NO enviado (org ${organizationId}): ${resultado.error ?? 'sin detalle'}.`,
      );
      return {
        enviado: false,
        motivo: 'ENVIO_FALLIDO',
        detalle: resultado.error,
      };
    }

    for (const e of reclamadas) {
      await this.exceptions.anotar(
        e.id,
        'AVISADA',
        null,
        null,
        'Aviso por WhatsApp al agendador.',
      );
    }
    this.logger.log(
      `Aviso al agendador enviado (org ${organizationId}): ${reclamadas.length} excepción(es).`,
    );
    return { enviado: true, citas: reclamadas.length };
  }
}

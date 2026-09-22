import { Injectable, Logger } from '@nestjs/common';
import type { SyncException } from '@agenia/database';
import {
  AGENTE_SIN_SENAL_MIN,
  DEFAULT_TIMEZONE,
  TIPOS_CON_AVISO,
  UMBRALES_VIGILANTE,
  enmascararIdentificadorWhatsapp,
  parametrosPlantillaAviso,
  requiereAviso,
  requiereRecordatorio,
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
 *  · UN solo mensaje por vuelta, clínica y clase (aviso o recordatorio), con el
 *    resumen (cuántas y la más próxima), no uno por cita: veinte WhatsApp seguidos
 *    se silencian y el aviso deja de servir.
 *  · Una vez por gravedad (`requiereAviso`): vuelve a avisar solo si la cita se acercó.
 *  · Solo de lo que nadie ha tomado: si alguien ya se ocupa, avisar es ruido.
 *
 * ═══ Si nadie lo atiende (§12 #14) ═══
 * Si tras el aviso nadie toma la excepción en `recordatorioMin`, se RECUERDA, hasta
 * `maxRecordatorios` veces (`requiereRecordatorio`). El recordatorio va al agendador
 * Y al número de respaldo (`agendadorRespaldoWhatsapp`), si lo hay: es el escalamiento
 * a otra persona. «Nadie la tomó» es la señal, no el «leído» de Meta.
 *
 * ═══ Cómo se cuida al paciente ═══
 *  · El mensaje sale hacia teléfonos personales del personal y pasa por Meta: dice
 *    QUÉ pasa y cuándo, SIN datos del paciente. El detalle está en la bandeja, tras la
 *    sesión (`parametrosPlantillaAviso` lo garantiza y lo prueba).
 *
 * ═══ Por qué una plantilla y no texto libre ═══
 * El agendador casi nunca le ha escrito al número de la clínica: fuera de la
 * ventana de 24 h de Meta un mensaje libre no sale. Sin la plantilla aprobada el
 * aviso NO sale y la excepción queda solo en la bandeja — nada se pierde, pero nadie
 * se entera hasta que la abre. Por eso la bandeja lo dice. El recordatorio usa la
 * MISMA plantilla: no hay que aprobar otra.
 *
 * ═══ Dos réplicas de la API ═══
 * Cada excepción se RECLAMA con un compare-and-set antes de enviar (`reclamarAviso`):
 * solo una réplica gana, y si el envío al agendador falla la reclamación se devuelve
 * para que la vuelta siguiente reintente. Que falle SOLO el respaldo no devuelve nada:
 * el agendador ya lo recibió.
 *
 * El correo (`agendadorEmail`) NO se usa, por decisión (§12 #13): el aviso es solo por
 * WhatsApp.
 */

export type ResultadoAviso =
  | { enviado: true; citas: number; recordatorios: number }
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

type ResultadoLote =
  | { estado: 'ENVIADO'; cuantas: number }
  | { estado: 'YA_RECLAMADO' }
  | { estado: 'FALLIDO'; detalle?: string };

type Clase = 'AVISO' | 'RECORDATORIO';

interface ConfigAviso {
  agendadorWhatsapp: string;
  agendadorRespaldoWhatsapp: string | null;
  lastHeartbeatAt: Date | null;
  lastHisReachable: boolean | null;
}

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
    const ahoraIso = ahora.toISOString();
    const vista = (e: SyncException) => ({
      kind: e.kind as TipoExcepcion,
      severity: e.severity as SeveridadExcepcion,
      status: e.status as EstadoExcepcion,
      notifiedSeverity: e.notifiedSeverity,
      notifiedAtIso: e.notifiedAt?.toISOString() ?? null,
      reminderCount: e.reminderCount,
      appointmentStartIso: e.appointmentStartAt?.toISOString() ?? null,
    });
    const nuevas = candidatas.filter((e) => requiereAviso(vista(e), ahoraIso));
    const recordar = candidatas.filter((e) =>
      requiereRecordatorio(vista(e), ahoraIso),
    );
    if (nuevas.length === 0 && recordar.length === 0)
      return { enviado: false, motivo: 'NADA_QUE_AVISAR' };

    // Antes de reclamar nada: si el aviso no puede salir, no se toca ninguna fila
    // (reclamar y devolver en cada vuelta sería puro ruido de escritura).
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: {
        enabled: true,
        conflictAlertsEnabled: true,
        agendadorWhatsapp: true,
        agendadorRespaldoWhatsapp: true,
        lastHeartbeatAt: true,
        lastHisReachable: true,
      },
    });
    if (!config?.enabled || !config.conflictAlertsEnabled) {
      return { enviado: false, motivo: 'APAGADO' };
    }
    // El respaldo es un segundo destinatario, no un sustituto: sin agendador no hay aviso.
    if (!config.agendadorWhatsapp)
      return { enviado: false, motivo: 'SIN_DESTINO' };
    const plantilla = await this.templates.findTemplate(
      organizationId,
      'SYNC_EXCEPTION_ALERT',
    );
    if (!plantilla) return { enviado: false, motivo: 'SIN_PLANTILLA' };

    const destino: ConfigAviso = {
      agendadorWhatsapp: config.agendadorWhatsapp,
      agendadorRespaldoWhatsapp: config.agendadorRespaldoWhatsapp,
      lastHeartbeatAt: config.lastHeartbeatAt,
      lastHisReachable: config.lastHisReachable,
    };
    const avisos = nuevas.length
      ? await this.enviarLote(organizationId, nuevas, 'AVISO', destino, ahora)
      : null;
    const recordatorios = recordar.length
      ? await this.enviarLote(
          organizationId,
          recordar,
          'RECORDATORIO',
          destino,
          ahora,
        )
      : null;

    const enviadas = (r: ResultadoLote | null) =>
      r?.estado === 'ENVIADO' ? r.cuantas : 0;
    if (enviadas(avisos) + enviadas(recordatorios) > 0) {
      return {
        enviado: true,
        citas: enviadas(avisos),
        recordatorios: enviadas(recordatorios),
      };
    }
    const fallido = [avisos, recordatorios].find(
      (r): r is Extract<ResultadoLote, { estado: 'FALLIDO' }> =>
        r?.estado === 'FALLIDO',
    );
    if (fallido) {
      return {
        enviado: false,
        motivo: 'ENVIO_FALLIDO',
        detalle: fallido.detalle,
      };
    }
    return { enviado: false, motivo: 'YA_RECLAMADO' };
  }

  /**
   * Reclama, envía y deja constancia de UN lote (todos avisos o todos recordatorios).
   * El agendador es el destinatario que cuenta: si su envío falla, se devuelve todo.
   * El respaldo solo recibe recordatorios.
   */
  private async enviarLote(
    organizationId: string,
    lote: SyncException[],
    clase: Clase,
    destino: ConfigAviso,
    ahora: Date,
  ): Promise<ResultadoLote> {
    // Reclamar: solo lo que esta réplica ganó se envía.
    const reclamadas: SyncException[] = [];
    for (const e of lote) {
      if (
        await this.exceptions.reclamarAviso(
          {
            id: e.id,
            severity: e.severity,
            notifiedSeverity: e.notifiedSeverity,
            notifiedAt: e.notifiedAt,
            reminderCount: e.reminderCount,
          },
          ahora,
          clase,
        )
      ) {
        reclamadas.push(e);
      }
    }
    if (reclamadas.length === 0) return { estado: 'YA_RECLAMADO' };

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
      !destino.lastHeartbeatAt ||
      ahora.getTime() - destino.lastHeartbeatAt.getTime() >
        AGENTE_SIN_SENAL_MIN * 60_000;
    // El número del recordatorio: el más alto del lote (el que más lleva sin atender).
    const numero =
      clase === 'RECORDATORIO'
        ? Math.max(...reclamadas.map((e) => e.reminderCount + 1))
        : undefined;
    const bodyParams = parametrosPlantillaAviso(items, {
      agenteSinSenal: sinSenal,
      hisAlcanzable: destino.lastHisReachable,
      timeZone: org?.timezone || DEFAULT_TIMEZONE,
      recordatorio: numero,
    });

    const resultado = await this.templates.sendTemplate({
      organizationId,
      recipientId: destino.agendadorWhatsapp,
      kind: 'SYNC_EXCEPTION_ALERT',
      bodyParams,
    });

    if (!resultado.success) {
      // No salió: se devuelve lo reclamado para que la próxima vuelta reintente.
      for (const e of reclamadas) {
        await this.exceptions.devolverAviso(
          {
            id: e.id,
            notifiedAt: e.notifiedAt,
            notifiedSeverity: e.notifiedSeverity,
            reminderCount: e.reminderCount,
          },
          ahora,
        );
      }
      this.logger.warn(
        `${clase === 'AVISO' ? 'Aviso' : 'Recordatorio'} al agendador NO enviado (org ${organizationId}): ${resultado.error ?? 'sin detalle'}.`,
      );
      return { estado: 'FALLIDO', detalle: resultado.error };
    }

    // El escalamiento: el recordatorio también le llega al respaldo, si es otro número.
    let respaldo: 'SIN_RESPALDO' | 'ENVIADO' | 'FALLIDO' = 'SIN_RESPALDO';
    const numeroRespaldo = destino.agendadorRespaldoWhatsapp;
    if (
      clase === 'RECORDATORIO' &&
      numeroRespaldo &&
      numeroRespaldo !== destino.agendadorWhatsapp
    ) {
      const r = await this.templates.sendTemplate({
        organizationId,
        recipientId: numeroRespaldo,
        kind: 'SYNC_EXCEPTION_ALERT',
        bodyParams,
      });
      respaldo = r.success ? 'ENVIADO' : 'FALLIDO';
      if (!r.success) {
        this.logger.warn(
          `Recordatorio al RESPALDO ${enmascararIdentificadorWhatsapp(numeroRespaldo)} NO enviado (org ${organizationId}): ${r.error ?? 'sin detalle'}. El agendador sí lo recibió.`,
        );
      }
    }

    for (const e of reclamadas) {
      if (clase === 'AVISO') {
        await this.exceptions.anotar(
          e.id,
          'AVISADA',
          null,
          null,
          'Aviso por WhatsApp al agendador.',
        );
      } else {
        const destinatarios =
          respaldo === 'ENVIADO'
            ? 'al agendador y al respaldo'
            : respaldo === 'FALLIDO'
              ? 'al agendador (al respaldo no salió)'
              : 'al agendador';
        await this.exceptions.anotar(
          e.id,
          'RECORDADA',
          null,
          null,
          `Recordatorio ${e.reminderCount + 1} de ${UMBRALES_VIGILANTE.maxRecordatorios} por WhatsApp ${destinatarios}: nadie la había tomado.`,
        );
      }
    }
    this.logger.log(
      `${clase === 'AVISO' ? 'Aviso' : 'Recordatorio'} al agendador enviado (org ${organizationId}): ${reclamadas.length} excepción(es).`,
    );
    return { estado: 'ENVIADO', cuantas: reclamadas.length };
  }
}

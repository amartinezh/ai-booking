import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
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
 *
 * 🔗 La cadena de cambios (2026-11-04). El hospital a veces cambia una cita y la
 * vuelve a cambiar minutos después: el 4-nov a las 6:15 pasó toda la agenda del
 * miércoles de AP08 a MD09 y a las 6:25 la devolvió; a 4 pacientes del chat les
 * llegó «ahora con MD09» y a uno, cambiado después otra vez (a MDD1, 11:10), no le
 * llegó nada. El 3-nov a una paciente le avisamos 17:10 y quedó a las 17:30. Ahora:
 *  · el aviso de un cambio también espera (`momentoDelAviso`), como el de una
 *    cancelación;
 *  · si el hospital cancela la cita NUEVA (la que dejó el cambio), el caso vuelve a
 *    esperar y se mira otra vez (`seguirLaCadena`), aunque el sistema ya lo hubiera
 *    cerrado solo;
 *  · al avisar se compara la cita que el paciente tiene AHORA con la que cree tener
 *    (`meta.informadaCitaId`: la del último aviso; sin aviso, la suya). La misma →
 *    nada; otra → el cambio, desde la que él conoce; ninguna → la cancelación de la
 *    que él conoce.
 */

const ORIGENES_DEL_ASISTENTE: readonly string[] = ['WHATSAPP', 'TELEGRAM'];

const KINDS_DEL_AVISO: TipoExcepcion[] = [
  'CITA_CANCELADA_POR_HOSPITAL',
  'CITA_MOVIDA_POR_HOSPITAL',
];

/**
 * Los casos cuya cita se sigue si el hospital la vuelve a cambiar: los activos y
 * los que cerró el sistema. Lo que cerró una persona es firme (ella se hizo cargo).
 */
const ESTADOS_QUE_SIGUEN_LA_CADENA = [
  'ABIERTA',
  'EN_REVISION',
  'AUTO_RESUELTA',
];

/** Cuánto antes de la cancelación pudo nacer la cita nueva para contar como cambio de hora. */
export const VENTANA_CAMBIO_DE_HORA_MS = 10 * 60_000;

/**
 * ⏳ Cuánto se espera para avisar una CANCELACIÓN (2026-10-29). El hospital a veces
 * anula una cita y la vuelve a crear minutos después (a Yully le avisamos «su cita
 * fue cancelada» a las 9:18 y el hospital se la volvió a crear igual a las 9:22).
 * Si en este tiempo aparece otra cita del mismo paciente, el aviso es el del cambio
 * —o ninguno, si es la misma cita—; si no, el de la cancelación.
 */
export const ESPERA_AVISO_CANCELACION_MS = 10 * 60_000;

/** El aviso sale, como tarde, esto antes de la cita (si la espera no alcanza, se acorta). */
export const MARGEN_SIN_ESPERA_MS = 60 * 60_000;

/**
 * ⏳ Lo mínimo que se espera SIEMPRE, aunque la cita esté cerca (2026-10-30). Antes,
 * con la cita a menos de una hora se avisaba al instante, y es justo cuando el
 * hospital anula y vuelve a crear la cita al recibir al paciente: a uno le llegó
 * «su cita fue cancelada» 16 minutos antes, el hospital la volvió a crear al minuto
 * y fue atendido. Medido en 14 días: con la cita a menos de una hora, 13 de 13
 * recreaciones llegaron en menos de 2 minutos; el mismo día, 29 de 31 en menos de 5.
 * Si la cita empieza antes de que termine la espera, el aviso ya no sale (`YA_PASO`).
 */
export const ESPERA_MINIMA_AVISO_MS = 5 * 60_000;

/**
 * 🙏 Hasta cuánto después del aviso se mira si el hospital volvió a crear la misma
 * cita, para escribirle al paciente que sigue en pie (2026-10-30).
 */
export const VENTANA_CORRECCION_MS = 2 * 60 * 60_000;

/** Casos en espera que revisa cada vuelta del barrido, como mucho. */
const LOTE_EN_ESPERA = 50;

/**
 * Cuándo avisar una cancelación sin cita nueva: `null` = ya (solo sin espera
 * configurada). La espera se acorta para que el aviso salga `MARGEN_SIN_ESPERA_MS`
 * antes de la cita, pero nunca a menos de `ESPERA_MINIMA_AVISO_MS`.
 */
export function momentoDelAviso(
  ahora: Date,
  inicioDeLaCita: Date,
  esperaMs: number = ESPERA_AVISO_CANCELACION_MS,
): Date | null {
  if (esperaMs <= 0) return null;
  const objetivo = Math.max(
    Math.min(
      ahora.getTime() + esperaMs,
      inicioDeLaCita.getTime() - MARGEN_SIN_ESPERA_MS,
    ),
    ahora.getTime() + Math.min(esperaMs, ESPERA_MINIMA_AVISO_MS),
  );
  return new Date(objetivo);
}

export type MotivoSinAviso =
  | 'SIN_CONTACTO'
  | 'TELEFONO_EQUIVOCADO'
  | 'FUERA_DE_VENTANA'
  | 'SIN_PLANTILLA'
  | 'FALLO'
  | 'YA_PASO';

export interface ResultadoAviso {
  aviso: 'ENVIADO' | 'NO_ENVIADO';
  canal?: 'WHATSAPP' | 'TELEGRAM';
  via?: 'TEXTO' | 'PLANTILLA';
  /** La plantilla usada (o que faltó), si fue por plantilla. */
  plantilla?: 'HIS_APPOINTMENT_CONFIRMATION' | 'HIS_APPOINTMENT_CANCELLED';
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
  status: true,
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

  /**
   * Cuánto se espera antes de avisar una cancelación. Una propiedad, no la
   * constante a secas, para que las pruebas del envío puedan pedir el aviso
   * inmediato (`0`) sin tocar el reloj.
   */
  protected esperaAvisoMs = ESPERA_AVISO_CANCELACION_MS;

  /** Evita que dos vueltas del barrido se pisen en la misma réplica. */
  private barriendo = false;
  /** Lo mismo para el barrido de correcciones. */
  private corrigiendo = false;

  private async procesar(
    organizationId: string,
    appointmentId: string,
    ahora: Date,
  ): Promise<void> {
    const cita = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: SELECT_CITA,
    });
    if (!cita) return;
    if (!ORIGENES_DEL_ASISTENTE.includes(cita.origin)) {
      // ¿Era la cita que el hospital le dio a un paciente del asistente al
      // cambiarle la suya? Entonces se le vuelve a mirar (2026-11-04).
      await this.seguirLaCadena(organizationId, cita, ahora);
      return;
    }
    if (cita.scheduleSlot.startTime.getTime() <= ahora.getTime()) return;

    // ¿El hospital le dio otra cita? (ver la nota de arriba)
    const nueva = await this.buscarCitaNueva(
      organizationId,
      cita,
      new Date(ahora.getTime() - VENTANA_CAMBIO_DE_HORA_MS),
      ahora,
    );

    // Anulada y vuelta a crear igual (mismo médico y hora): para el paciente no
    // cambió nada. Ni aviso ni caso.
    if (nueva && esLaMismaCita(cita, nueva)) {
      this.logger.log(
        `Cita ${cita.id}: el hospital la anuló y la volvió a crear igual (${nueva.id}); no se le avisa al paciente.`,
      );
      return;
    }

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
      canceladaIso: ahora.toISOString(),
    };

    // ⏳ El aviso espera unos minutos, por si el hospital vuelve a crear la cita o
    // vuelve a cambiarla (lo resuelve `avisarLosPendientes`). Un cambio también
    // espera (2026-11-04), y a lo sumo hasta una hora antes de la primera de las
    // dos citas: el paciente podría llegar a cualquiera.
    const avisarDesde = momentoDelAviso(
      ahora,
      nueva &&
        nueva.scheduleSlot.startTime.getTime() <
          cita.scheduleSlot.startTime.getTime()
        ? nueva.scheduleSlot.startTime
        : cita.scheduleSlot.startTime,
      this.esperaAvisoMs,
    );

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
        meta: avisarDesde
          ? {
              ...metaBase,
              aviso: 'EN_ESPERA',
              avisarDesdeIso: avisarDesde.toISOString(),
            }
          : { ...metaBase, aviso: 'PENDIENTE' },
      },
      ahora,
    );
    if (registro !== 'CREADA' || avisarDesde) return;

    const aviso = await this.avisar(organizationId, cita, nueva, kind, ahora);

    // Sin aviso, alguien tiene que comunicarse con el paciente: al menos ALTA.
    const base: SeveridadExcepcion =
      aviso.aviso === 'ENVIADO' ? 'MEDIA' : 'ALTA';
    await this.prisma.syncException.updateMany({
      where: { organizationId, dedupeKey },
      data: {
        severity: severidadPorCercania(base, minutosParaLaCita),
        meta: {
          ...metaBase,
          ...aviso,
          ...(aviso.aviso === 'ENVIADO'
            ? { informadaCitaId: nueva?.id ?? null }
            : {}),
        },
      },
    });
  }

  /**
   * 🔗 El hospital canceló una cita que había dado al cambiar la de un paciente del
   * asistente (2026-11-04): el caso de ese cambio vuelve a esperar unos minutos y
   * luego se mira qué cita tiene el paciente ahora (`resolverEnEspera`). Si el
   * sistema ya había cerrado el caso, se reabre. Compare-and-set sobre la última
   * escritura del caso: si otra escritura se cruzó, se relee una vez.
   */
  private async seguirLaCadena(
    organizationId: string,
    cancelada: CitaParaAviso,
    ahora: Date,
  ): Promise<void> {
    if (cancelada.scheduleSlot.startTime.getTime() <= ahora.getTime()) return;
    for (let intento = 0; intento < 2; intento++) {
      const caso = await this.prisma.syncException.findFirst({
        where: {
          organizationId,
          kind: { in: KINDS_DEL_AVISO },
          status: { in: ESTADOS_QUE_SIGUEN_LA_CADENA },
          meta: { path: ['nuevaCitaId'], equals: cancelada.id },
        },
        orderBy: { firstSeenAt: 'desc' },
        select: {
          id: true,
          kind: true,
          status: true,
          organizationId: true,
          appointmentId: true,
          meta: true,
          firstSeenAt: true,
          updatedAt: true,
        },
      });
      if (!caso?.appointmentId) return;
      const meta = leerMeta(caso.meta);
      const avisarDesde =
        momentoDelAviso(
          ahora,
          cancelada.scheduleSlot.startTime,
          this.esperaAvisoMs,
        ) ?? ahora;
      const cambios =
        typeof meta.cambiosDelHospital === 'number'
          ? meta.cambiosDelHospital
          : 0;
      const metaNueva: Record<string, unknown> = {
        ...meta,
        // Lo que el paciente cree tener, antes de pisar el estado del aviso.
        informadaCitaId: citaInformada(meta, caso.kind, caso.appointmentId),
        cadenaDesdeIso: ahora.toISOString(),
        cambiosDelHospital: cambios + 1,
        aviso: 'EN_ESPERA',
        avisarDesdeIso: avisarDesde.toISOString(),
      };
      const reabrir = caso.status === 'AUTO_RESUELTA';
      const { count } = await this.prisma.syncException.updateMany({
        where: { id: caso.id, organizationId, updatedAt: caso.updatedAt },
        data: {
          ...(reabrir
            ? {
                status: 'ABIERTA',
                resolvedAt: null,
                resolvedByUserId: null,
                resolutionNote: null,
                notifiedAt: null,
                notifiedSeverity: null,
                reminderCount: 0,
              }
            : {}),
          lastSeenAt: ahora,
          meta: metaNueva as Prisma.InputJsonValue,
        },
      });
      if (count !== 1) continue;
      if (reabrir) {
        await this.exceptions.anotar(
          caso.id,
          'REAPARECIDA',
          null,
          null,
          'El hospital volvió a cambiar la cita.',
        );
      }
      this.logger.log(
        `Cita ${caso.appointmentId}: el hospital canceló la que le había dado al cambiarla (${cancelada.id}); se vuelve a mirar antes de avisarle al paciente.`,
      );
      if (avisarDesde.getTime() <= ahora.getTime()) {
        await this.resolverEnEspera(caso, metaNueva, ahora);
      }
      return;
    }
  }

  /**
   * La cita que el hospital le dio al mismo paciente: del hospital, vigente,
   * futura y nacida desde `desde` (unos minutos antes de la cancelación; en el
   * barrido, también las de después).
   */
  private buscarCitaNueva(
    organizationId: string,
    cita: CitaParaAviso,
    desde: Date,
    ahora: Date,
  ): Promise<CitaParaAviso | null> {
    return this.prisma.appointment.findFirst({
      where: {
        organizationId,
        patientId: cita.patientId,
        id: { not: cita.id },
        status: 'SCHEDULED',
        origin: 'MIRROR',
        createdAt: { gte: desde },
        scheduleSlot: { startTime: { gt: ahora } },
      },
      orderBy: { createdAt: 'desc' },
      select: SELECT_CITA,
    });
  }

  /**
   * La MISMA cita (mismo médico y hora) que el hospital volvió a crear después de
   * anular la del paciente, aunque ya haya empezado: al recibirlo en la ventanilla
   * el hospital la anula y la vuelve a crear, y a veces ya lo está atendiendo.
   */
  private buscarLaMismaVueltaACrear(
    organizationId: string,
    cita: CitaParaAviso,
    desde: Date,
  ): Promise<{ id: string } | null> {
    return this.prisma.appointment.findFirst({
      where: {
        organizationId,
        patientId: cita.patientId,
        id: { not: cita.id },
        status: { not: 'CANCELLED' },
        origin: 'MIRROR',
        createdAt: { gte: desde },
        scheduleSlot: {
          doctorId: cita.scheduleSlot.doctorId,
          startTime: cita.scheduleSlot.startTime,
        },
      },
      select: { id: true },
    });
  }

  /**
   * ⏳ Cada minuto: las cancelaciones que esperaban por si el hospital volvía a
   * crear la cita (2026-10-29). Cada caso se reclama con compare-and-set sobre su
   * aviso `EN_ESPERA`: con dos réplicas, solo una le escribe al paciente.
   */
  @Cron('20 * * * * *')
  async cadaMinuto(): Promise<void> {
    // Sin parámetros, como los demás barridos: la librería de cron le pasa al
    // método sus propios argumentos y pisaría la fecha por defecto.
    await this.avisarLosPendientes();
    await this.corregirLosAvisos();
  }

  /**
   * 🙏 Cada minuto: los avisos de cancelación YA enviados cuya cita el hospital
   * volvió a crear igual —mismo médico y hora— después del aviso (2026-10-30). Al
   * paciente se le escribe que su cita sigue en pie, por donde se le avisó (texto
   * en la ventana de 24 h o Telegram; si no, la plantilla «Confirmación de una cita
   * del hospital», que le da la hora), y el caso se cierra solo. Hasta
   * `VENTANA_CORRECCION_MS` después de la cancelación y antes de la hora de la
   * cita. Si el personal ya le escribió desde la Bandeja, no se le escribe: el caso
   * queda abierto diciendo que la cita volvió. Nunca lanza.
   */
  async corregirLosAvisos(ahora: Date = new Date()): Promise<void> {
    if (this.corrigiendo) return;
    this.corrigiendo = true;
    try {
      const casos = await this.prisma.syncException.findMany({
        where: {
          kind: 'CITA_CANCELADA_POR_HOSPITAL',
          status: { in: ['ABIERTA', 'EN_REVISION'] },
          meta: { path: ['aviso'], equals: 'ENVIADO' },
          firstSeenAt: {
            gte: new Date(ahora.getTime() - VENTANA_CORRECCION_MS),
          },
        },
        select: {
          id: true,
          organizationId: true,
          appointmentId: true,
          meta: true,
          firstSeenAt: true,
          updatedAt: true,
        },
        orderBy: { firstSeenAt: 'asc' },
        take: LOTE_EN_ESPERA,
      });
      for (const caso of casos) {
        try {
          await this.corregirUno(caso, ahora);
        } catch (error: unknown) {
          this.logger.error(
            `Corrección del aviso del caso ${caso.id} falló: ${getErrorMessage(error)}`,
          );
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Barrido de correcciones de avisos falló: ${getErrorMessage(error)}`,
      );
    } finally {
      this.corrigiendo = false;
    }
  }

  private async corregirUno(
    caso: {
      id: string;
      organizationId: string;
      appointmentId: string | null;
      meta: unknown;
      firstSeenAt: Date;
      updatedAt: Date;
    },
    ahora: Date,
  ): Promise<void> {
    const meta = leerMeta(caso.meta);
    if (meta.correccion || !caso.appointmentId) return;
    const organizationId = caso.organizationId;
    const cita = await this.prisma.appointment.findFirst({
      where: { id: caso.appointmentId, organizationId },
      select: SELECT_CITA,
    });
    // Con la hora de la cita encima, ya no sirve escribirle.
    if (!cita || cita.scheduleSlot.startTime.getTime() <= ahora.getTime()) {
      return;
    }
    const cancelada = msDeIso(meta.canceladaIso);
    const nueva = await this.buscarCitaNueva(
      organizationId,
      cita,
      new Date(
        (Number.isFinite(cancelada) ? cancelada : caso.firstSeenAt.getTime()) -
          VENTANA_CAMBIO_DE_HORA_MS,
      ),
      ahora,
    );
    if (!nueva || !esLaMismaCita(cita, nueva)) return;

    // Reclamarlo: compare-and-set sobre la última escritura del caso. Si otra
    // réplica o una persona lo tocó entretanto, se mira en la vuelta siguiente.
    const { count } = await this.prisma.syncException.updateMany({
      where: { id: caso.id, organizationId, updatedAt: caso.updatedAt },
      data: {
        meta: { ...meta, correccion: 'PENDIENTE' } as Prisma.InputJsonValue,
      },
    });
    if (count !== 1) return;

    const base = {
      ...meta,
      nuevaCitaId: nueva.id,
      nuevaIso: nueva.scheduleSlot.startTime.toISOString(),
      correccionIso: ahora.toISOString(),
    };
    const minutosParaLaCita =
      (cita.scheduleSlot.startTime.getTime() - ahora.getTime()) / MS_MIN;

    // Si el personal ya le escribió, sabe lo que le dijo: que él le confirme.
    const escrito = await this.prisma.syncExceptionLog.findFirst({
      where: { exceptionId: caso.id, action: 'MENSAJE_AL_PACIENTE' },
      select: { id: true },
    });
    if (escrito) {
      await this.prisma.syncException.updateMany({
        where: { id: caso.id, organizationId },
        data: {
          meta: {
            ...base,
            correccion: 'NO_ENVIADA',
            correccionMotivo: 'LE_ESCRIBIO_EL_PERSONAL',
          } as Prisma.InputJsonValue,
        },
      });
      return;
    }

    const r = await this.avisar(
      organizationId,
      cita,
      nueva,
      'CITA_CANCELADA_POR_HOSPITAL',
      ahora,
      'SIGUE_EN_PIE',
    );
    const enviada = r.aviso === 'ENVIADO';
    await this.prisma.syncException.updateMany({
      where: { id: caso.id, organizationId },
      data: {
        // Sin corrección, alguien tiene que decírselo: al menos ALTA.
        ...(enviada
          ? {}
          : { severity: severidadPorCercania('ALTA', minutosParaLaCita) }),
        meta: {
          ...base,
          correccion: enviada ? 'ENVIADA' : 'NO_ENVIADA',
          ...(enviada ? { informadaCitaId: nueva.id } : {}),
          ...(r.via ? { correccionVia: r.via } : {}),
          ...(r.plantilla ? { correccionPlantilla: r.plantilla } : {}),
          ...(r.motivo ? { correccionMotivo: r.motivo } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    if (enviada) {
      this.logger.log(
        `Cita ${cita.id}: el hospital la volvió a crear igual después del aviso (${nueva.id}); se le escribió al paciente que sigue en pie.`,
      );
      await this.exceptions.autoResolver(
        organizationId,
        caso.id,
        'El hospital volvió a crear la misma cita (mismo médico y hora) después del aviso de cancelación: se le escribió al paciente que su cita sigue en pie.',
        ahora,
      );
    }
  }

  async avisarLosPendientes(ahora: Date = new Date()): Promise<void> {
    if (this.barriendo) return;
    this.barriendo = true;
    try {
      const casos = await this.prisma.syncException.findMany({
        where: {
          // Los cambios también esperan (2026-11-04).
          kind: { in: KINDS_DEL_AVISO },
          status: { in: ['ABIERTA', 'EN_REVISION'] },
          meta: { path: ['aviso'], equals: 'EN_ESPERA' },
        },
        select: {
          id: true,
          kind: true,
          organizationId: true,
          appointmentId: true,
          meta: true,
          firstSeenAt: true,
        },
        orderBy: { firstSeenAt: 'asc' },
        take: LOTE_EN_ESPERA,
      });
      for (const caso of casos) {
        const meta = leerMeta(caso.meta);
        const desde = msDeIso(meta.avisarDesdeIso);
        if (Number.isFinite(desde) && desde > ahora.getTime()) continue;
        try {
          await this.resolverEnEspera(caso, meta, ahora);
        } catch (error: unknown) {
          this.logger.error(
            `Aviso en espera del caso ${caso.id} falló: ${getErrorMessage(error)}`,
          );
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Barrido de avisos en espera falló: ${getErrorMessage(error)}`,
      );
    } finally {
      this.barriendo = false;
    }
  }

  private async resolverEnEspera(
    caso: {
      id: string;
      organizationId: string;
      appointmentId: string | null;
      firstSeenAt: Date;
      kind?: string;
    },
    meta: Record<string, unknown>,
    ahora: Date,
  ): Promise<void> {
    const organizationId = caso.organizationId;
    // Reclamarlo: si otra réplica ya lo tomó, o una persona lo cerró, se deja.
    const { count } = await this.prisma.syncException.updateMany({
      where: {
        id: caso.id,
        organizationId,
        status: { in: ['ABIERTA', 'EN_REVISION'] },
        meta: { path: ['aviso'], equals: 'EN_ESPERA' },
      },
      data: { meta: { ...meta, aviso: 'PENDIENTE' } as Prisma.InputJsonValue },
    });
    if (count !== 1) return;

    const terminar = (
      cambios: Record<string, unknown>,
      severidad?: SeveridadExcepcion,
    ) =>
      this.prisma.syncException.updateMany({
        where: { id: caso.id, organizationId },
        data: {
          ...(severidad ? { severity: severidad } : {}),
          meta: { ...meta, ...cambios } as Prisma.InputJsonValue,
        },
      });

    const cita = caso.appointmentId
      ? await this.prisma.appointment.findFirst({
          where: { id: caso.appointmentId, organizationId },
          select: SELECT_CITA,
        })
      : null;
    if (!cita) {
      await terminar({ aviso: 'NO_ENVIADO', motivo: 'FALLO' }, 'ALTA');
      return;
    }

    // La cita que el hospital le dio: desde 10 min antes del último cambio de la
    // cadena (la cancelación de la suya o, después, la de la que le dieron).
    const ultimoCambio = msDeIso(meta.cadenaDesdeIso ?? meta.canceladaIso);
    const desdeElCambio = new Date(
      (Number.isFinite(ultimoCambio)
        ? ultimoCambio
        : caso.firstSeenAt.getTime()) - VENTANA_CAMBIO_DE_HORA_MS,
    );
    const nueva = await this.buscarCitaNueva(
      organizationId,
      cita,
      desdeElCambio,
      ahora,
    );
    // La que el paciente cree tener (`null`: se le dijo que no tiene).
    const informadaId = citaInformada(meta, caso.kind, cita.id);
    const informada =
      informadaId === null
        ? null
        : informadaId === cita.id
          ? cita
          : ((await this.prisma.appointment.findFirst({
              where: { id: informadaId, organizationId },
              select: SELECT_CITA,
            })) ?? cita);

    // La hora que importa es la de la cita que tiene ahora, o la que cree tener.
    const inicio = (nueva ?? informada ?? cita).scheduleSlot.startTime;
    if (inicio.getTime() <= ahora.getTime()) {
      // 🏥 Anulada y vuelta a crear igual en la ventanilla, minutos antes de la
      // cita (2026-11-06: la de las 7:30 se anuló a las 7:26 y se volvió a crear a
      // las 7:27; la paciente fue atendida). `buscarCitaNueva` solo ve citas por
      // venir, y esta ya empezó: el caso quedaba abierto. Si al paciente nunca se
      // le avisó nada, no hay nada que revisar y se cierra solo.
      const otraVez =
        informada === cita
          ? await this.buscarLaMismaVueltaACrear(
              organizationId,
              cita,
              desdeElCambio,
            )
          : null;
      if (otraVez) {
        await terminar({
          aviso: 'NO_HIZO_FALTA',
          motivo: 'MISMA_CITA',
          nuevaIso: cita.scheduleSlot.startTime.toISOString(),
          nuevaCitaId: otraVez.id,
        });
        await this.exceptions.autoResolver(
          organizationId,
          caso.id,
          'El hospital volvió a crear la misma cita (mismo médico y hora): no hizo falta avisarle al paciente.',
          ahora,
        );
        return;
      }
      await terminar({ aviso: 'NO_ENVIADO', motivo: 'YA_PASO' });
      return;
    }

    // Si alguien del personal ya le escribió desde la Bandeja (después del último
    // cambio del hospital), no se repite.
    const cadena = msDeIso(meta.cadenaDesdeIso);
    const escrito = await this.prisma.syncExceptionLog.findFirst({
      where: {
        exceptionId: caso.id,
        action: 'MENSAJE_AL_PACIENTE',
        ...(Number.isFinite(cadena)
          ? { createdAt: { gte: new Date(cadena) } }
          : {}),
      },
      select: { id: true },
    });
    if (escrito) {
      await terminar({
        aviso: 'NO_HIZO_FALTA',
        motivo: 'LE_ESCRIBIO_EL_PERSONAL',
      });
      return;
    }

    // Para el paciente no cambió nada: tiene la que cree tener.
    if (nueva && informada && esLaMismaCita(informada, nueva)) {
      await terminar({
        aviso: 'NO_HIZO_FALTA',
        // MISMA_CITA: la suya, como la agendó; COMO_SE_LE_AVISO: la del último aviso.
        motivo: informada === cita ? 'MISMA_CITA' : 'COMO_SE_LE_AVISO',
        nuevaIso: nueva.scheduleSlot.startTime.toISOString(),
        nuevaCitaId: nueva.id,
      });
      // Nunca se le avisó nada: el caso se cierra solo. Si se le avisó un cambio y
      // la cita sigue como se le dijo, el caso queda como estaba.
      if (informada === cita) {
        await this.exceptions.autoResolver(
          organizationId,
          caso.id,
          Number.isFinite(cadena)
            ? 'El hospital cambió la cita y la volvió a dejar como el paciente la tenía (mismo médico y hora): no hizo falta avisarle.'
            : 'El hospital volvió a crear la misma cita (mismo médico y hora): no hizo falta avisarle al paciente.',
          ahora,
        );
      }
      return;
    }

    if (nueva) {
      // El hospital le dio otra cita: se le avisa el cambio desde la que conoce.
      const kind: TipoExcepcion = 'CITA_MOVIDA_POR_HOSPITAL';
      await this.prisma.syncException.updateMany({
        where: { id: caso.id, organizationId },
        data: {
          kind,
          title: TITULO_EXCEPCION[kind],
          doctorId: nueva.scheduleSlot.doctorId,
          appointmentStartAt: nueva.scheduleSlot.startTime,
        },
      });
      const aviso = await this.avisar(
        organizationId,
        cita,
        nueva,
        kind,
        ahora,
        'AVISO',
        informada ?? cita,
      );
      const minutosParaLaCita =
        (nueva.scheduleSlot.startTime.getTime() - ahora.getTime()) / MS_MIN;
      await terminar(
        {
          nuevaIso: nueva.scheduleSlot.startTime.toISOString(),
          nuevaCitaId: nueva.id,
          ...aviso,
          ...(aviso.aviso === 'ENVIADO' ? { informadaCitaId: nueva.id } : {}),
        },
        severidadPorCercania(
          aviso.aviso === 'ENVIADO' ? 'MEDIA' : 'ALTA',
          minutosParaLaCita,
        ),
      );
      return;
    }

    // Sin cita: ya sabe que no tiene (se le avisó la cancelación).
    if (!informada) {
      await terminar({
        aviso: 'NO_HIZO_FALTA',
        motivo: 'YA_SABE',
        nuevaIso: null,
        nuevaCitaId: null,
      });
      return;
    }

    // Sin cita: el hospital le quitó la que conoce. Si el caso era de un cambio, ya
    // no lo es.
    const kind: TipoExcepcion = 'CITA_CANCELADA_POR_HOSPITAL';
    if (caso.kind === 'CITA_MOVIDA_POR_HOSPITAL') {
      await this.prisma.syncException.updateMany({
        where: { id: caso.id, organizationId },
        data: {
          kind,
          title: TITULO_EXCEPCION[kind],
          doctorId: informada.scheduleSlot.doctorId,
          appointmentStartAt: informada.scheduleSlot.startTime,
        },
      });
    }
    const aviso = await this.avisar(
      organizationId,
      cita,
      null,
      kind,
      ahora,
      'AVISO',
      informada,
    );
    const minutosParaLaCita =
      (informada.scheduleSlot.startTime.getTime() - ahora.getTime()) / MS_MIN;
    await terminar(
      {
        nuevaIso: null,
        nuevaCitaId: null,
        ...aviso,
        ...(aviso.aviso === 'ENVIADO' ? { informadaCitaId: null } : {}),
      },
      severidadPorCercania(
        aviso.aviso === 'ENVIADO' ? 'MEDIA' : 'ALTA',
        minutosParaLaCita,
      ),
    );
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

  /**
   * `SIGUE_EN_PIE` (2026-10-30): la corrección de un aviso de cancelación cuando
   * el hospital volvió a crear la misma cita; `nueva` es esa cita. Fuera de la
   * ventana va con la plantilla de confirmación, igual que un cambio de hora.
   *
   * `antes` (2026-11-04): la cita que el paciente conoce —la suya o la del último
   * aviso—, de la que habla el mensaje («Antes: …», o la que se canceló). `cita` es
   * siempre la que agendó con el asistente: da el canal, el remitente y el caso.
   */
  private async avisar(
    organizationId: string,
    cita: CitaParaAviso,
    nueva: CitaParaAviso | null,
    kind: TipoExcepcion,
    ahora: Date,
    modo: 'AVISO' | 'SIGUE_EN_PIE' = 'AVISO',
    antes: CitaParaAviso = cita,
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
    let plantilla: ResultadoAviso['plantilla'];
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
      const servicio = antes.scheduleSlot.service?.name ?? 'su consulta';
      const fecha = formatAppointmentLong(antes.scheduleSlot.startTime, {
        timeZone,
      });
      texto =
        modo === 'SIGUE_EN_PIE' && nueva
          ? MSGS.citaSigueEnPie({
              nombre,
              clinica,
              servicio,
              fecha,
              medico: doctorLabel(nueva.scheduleSlot.doctor) || 'su médico',
              contacto: contactoClinica,
            })
          : nueva
            ? MSGS.citaMovidaPorElHospital({
                nombre,
                clinica,
                servicio,
                fechaAntes: fecha,
                fechaNueva: formatAppointmentLong(
                  nueva.scheduleSlot.startTime,
                  {
                    timeZone,
                  },
                ),
                medicoAntes:
                  doctorLabel(antes.scheduleSlot.doctor) || undefined,
                medicoNuevo:
                  doctorLabel(nueva.scheduleSlot.doctor) || 'su médico',
                contacto: contactoClinica,
              })
            : MSGS.citaCanceladaPorElHospital({
                nombre,
                clinica,
                servicio,
                fecha,
                medico: doctorLabel(antes.scheduleSlot.doctor) || 'su médico',
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
      plantilla = 'HIS_APPOINTMENT_CONFIRMATION';
      texto = `[Plantilla HIS_APPOINTMENT_CONFIRMATION] ${nombre} · ${servicio} · ${medico} · ${fecha}`;
      resultado = await this.templates.sendTemplate({
        organizationId,
        recipientId: contacto.destinatario,
        kind: 'HIS_APPOINTMENT_CONFIRMATION',
        bodyParams: [nombre || 'Paciente', servicio, medico, fecha],
        appointmentId: cita.id,
      });
    } else {
      // Fuera de la ventana y sin cita nueva: la plantilla aprobada «Cita cancelada
      // por el hospital». La quinta variable va sin formato (asteriscos dentro de
      // una variable de plantilla no se garantizan).
      const servicio = antes.scheduleSlot.service?.name || 'su consulta';
      const medico = doctorLabel(antes.scheduleSlot.doctor) || 'su médico';
      const fecha = formatForPatient(antes.scheduleSlot.startTime);
      const conQuien = org?.supportPhone
        ? `el hospital al ${org.supportPhone}`
        : 'el hospital';
      via = 'PLANTILLA';
      plantilla = 'HIS_APPOINTMENT_CANCELLED';
      texto = `[Plantilla HIS_APPOINTMENT_CANCELLED] ${nombre} · ${servicio} · ${medico} · ${fecha} · ${conQuien}`;
      resultado = await this.templates.sendTemplate({
        organizationId,
        recipientId: contacto.destinatario,
        kind: 'HIS_APPOINTMENT_CANCELLED',
        bodyParams: [nombre || 'Paciente', servicio, medico, fecha, conQuien],
        appointmentId: cita.id,
      });
    }

    if (!resultado.success) {
      this.logger.warn(
        `Aviso al paciente NO enviado (org ${organizationId}, cita ${cita.id}, vía ${via}): ${resultado.error ?? 'sin detalle'}.`,
      );
      return {
        aviso: 'NO_ENVIADO',
        canal,
        via,
        ...(plantilla ? { plantilla } : {}),
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
          tipo: modo === 'SIGUE_EN_PIE' ? 'CITA_SIGUE_EN_PIE' : kind,
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

    return {
      aviso: 'ENVIADO',
      canal,
      via,
      ...(plantilla ? { plantilla } : {}),
      enviadoIso: ahora.toISOString(),
    };
  }
}

type CitaParaAviso = Prisma.AppointmentGetPayload<{
  select: typeof SELECT_CITA;
}>;

/** La misma cita para el paciente: mismo médico y misma hora. */
function esLaMismaCita(a: CitaParaAviso, b: CitaParaAviso): boolean {
  return (
    a.scheduleSlot.doctorId === b.scheduleSlot.doctorId &&
    a.scheduleSlot.startTime.getTime() === b.scheduleSlot.startTime.getTime()
  );
}

/**
 * La cita que el paciente cree tener, según el caso (2026-11-04): la del último
 * aviso que recibió; `null` si se le avisó que la cancelaron; la suya (`citaId`) si
 * no se le avisó nada. Los casos de antes de esa fecha no tienen
 * `informadaCitaId`: se deduce de lo que dice su aviso.
 */
function citaInformada(
  meta: Record<string, unknown>,
  kind: string | undefined,
  citaId: string,
): string | null {
  if ('informadaCitaId' in meta) {
    return typeof meta.informadaCitaId === 'string'
      ? meta.informadaCitaId
      : null;
  }
  const nuevaId =
    typeof meta.nuevaCitaId === 'string' ? meta.nuevaCitaId : null;
  if (meta.correccion === 'ENVIADA' && nuevaId) return nuevaId;
  if (meta.aviso === 'ENVIADO') {
    return kind === 'CITA_MOVIDA_POR_HOSPITAL' ? (nuevaId ?? citaId) : null;
  }
  return citaId;
}

/** Milisegundos de una fecha ISO guardada en `meta`; `NaN` si no es una. */
function msDeIso(valor: unknown): number {
  return typeof valor === 'string' ? Date.parse(valor) : NaN;
}

function leerMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? { ...(meta as Record<string, unknown>) }
    : {};
}

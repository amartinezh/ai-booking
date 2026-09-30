import { Injectable } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  FORMATO_SQL_BUCKET,
  resolverRangoEstadisticas,
  type RangoResuelto,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';

// ══════════════════════════════════════════════════════════════════════════
// 📈 CANALES EN VIVO — WhatsApp y Telegram en cifras
//
// Solo lectura de la base y solo agregados: ninguna llamada a IA, a Meta ni a
// Telegram. Refrescar la pantalla no cuesta un token.
//
// Fuentes:
//   · ChannelActivityLog → personas que escriben, mensajes, desenlaces (agendó,
//     vino a gestionar una cita, tuvo un problema), horas pico, texto/audio,
//     nuevos vs recurrentes. 400 días de historia: cubre la vista «Año».
//   · Appointment (origin + createdAt) → citas pedidas por el canal. Se cuenta
//     por CUÁNDO se pidió, no por la fecha del turno: «cuántas me pidieron hoy».
//   · InteractionLog → motivos de fallo y flujos (cancelar, reprogramar, lista
//     de espera, emergencias). Solo 180 días: el detalle lo advierte.
//   · WhatsappMessageLog / TelegramMessageLog → entrega de lo que enviamos.
//
// Todas las fechas se agrupan en la hora de la clínica (Bogotá por defecto).
// ══════════════════════════════════════════════════════════════════════════

export type Canal = 'WHATSAPP' | 'TELEGRAM';
export const CANALES: Canal[] = ['WHATSAPP', 'TELEGRAM'];

export interface ChannelStatsFilters {
  organizationId: string | null;
  range?: string;
  startDate?: string;
  endDate?: string;
  timeZone?: string;
  now?: Date;
}

export interface PuntoSerie {
  bucket: string;
  /** Personas distintas que escribieron en el tramo. */
  writers: number;
  /** Mensajes recibidos en el tramo. */
  messages: number;
  /** Citas pedidas por el canal en el tramo. */
  appointments: number;
  /** Escribieron y no agendaron (ni vinieron a gestionar una cita existente). */
  noBooking: number;
  /** Personas con un fallo o abandono en el tramo. */
  problems: number;
}

export interface TotalesCanal {
  writers: number;
  messages: number;
  appointmentsRequested: number;
  bookedWriters: number;
  managedWriters: number;
  noBooking: number;
  problemWriters: number;
  /** Personas que agendaron / personas que escribieron, en %. null sin datos. */
  conversionPct: number | null;
  messagesPerWriter: number | null;
  newWriters: number;
  returningWriters: number;
  /** Escribiendo en los últimos 15 minutos (el pulso «en vivo»). */
  activeNow: number;
}

const VENTANA_EN_VIVO_MIN = 15;

/** Estados de InteractionLog que son «flujos» del bot, por canal. */
const FLUJOS = [
  'BOOKING_CONFIRMED',
  'CANCELLATION_FLOW',
  'MODIFICATION_FLOW',
  'WAITLIST_JOINED',
  'EMERGENCY_ESCALATED',
  'ESCAPED',
] as const;

/** Expresión SQL del canal de una fila de InteractionLog (el remitente `tg:` es Telegram). */
const CANAL_INTERACTION = Prisma.sql`CASE WHEN "whatsappId" LIKE 'tg:%' THEN 'TELEGRAM' ELSE 'WHATSAPP' END`;

/** Excluye envíos iniciados por nosotros (panel, recordatorio, aviso masivo). */
const NO_ES_ENVIO_NUESTRO = Prisma.sql`NOT (
  COALESCE(metadata->>'outbound', '') = 'true'
  OR COALESCE(metadata->>'reminderAutomatic', '') = 'true'
  OR COALESCE(metadata->>'massNotice', '') = 'true'
)`;

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const esCanal = (c: unknown): c is Canal =>
  c === 'WHATSAPP' || c === 'TELEGRAM';

@Injectable()
export class ChannelStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(filters: ChannelStatsFilters) {
    const now = filters.now ?? new Date();
    const rango = resolverRangoEstadisticas({
      range: filters.range,
      startDate: filters.startDate,
      endDate: filters.endDate,
      timeZone: filters.timeZone,
      now,
    });
    const org = filters.organizationId?.trim() || null;

    const [
      actividad,
      totales,
      citas,
      citasPorEstado,
      nuevos,
      enVivo,
      horasPico,
      tiposMensaje,
      motivos,
      flujos,
      entregaWa,
      entregaTg,
    ] = await Promise.all([
      this.actividadPorTramo(rango, org),
      this.totalesActividad(rango, org),
      this.citasPorTramo(rango, org),
      this.citasPorEstado(rango, org),
      this.nuevosVsRecurrentes(rango, org),
      this.escribiendoAhora(now, org),
      this.horasPico(rango, org),
      this.tiposDeMensaje(rango, org),
      this.motivosDeFallo(rango, org),
      this.flujos(rango, org),
      this.entregaWhatsapp(rango, org),
      this.entregaTelegram(rango, org),
    ]);

    const channels = {} as Record<
      Canal,
      { series: PuntoSerie[]; totals: TotalesCanal }
    >;
    for (const canal of CANALES) {
      const series = rango.buckets.map<PuntoSerie>((bucket) => {
        const a = actividad.get(`${canal}|${bucket}`);
        return {
          bucket,
          writers: a?.writers ?? 0,
          messages: a?.messages ?? 0,
          appointments: citas.get(`${canal}|${bucket}`) ?? 0,
          noBooking: a?.noBooking ?? 0,
          problems: a?.problems ?? 0,
        };
      });
      const t = totales.get(canal);
      const writers = t?.writers ?? 0;
      const booked = t?.booked ?? 0;
      channels[canal] = {
        series,
        totals: {
          writers,
          messages: t?.messages ?? 0,
          appointmentsRequested: series.reduce((s, p) => s + p.appointments, 0),
          bookedWriters: booked,
          managedWriters: t?.managed ?? 0,
          noBooking: t?.noBooking ?? 0,
          problemWriters: t?.problems ?? 0,
          conversionPct:
            writers > 0 ? Math.round((booked / writers) * 1000) / 10 : null,
          messagesPerWriter:
            writers > 0
              ? Math.round(((t?.messages ?? 0) / writers) * 10) / 10
              : null,
          newWriters: nuevos.get(canal)?.nuevos ?? 0,
          returningWriters: nuevos.get(canal)?.recurrentes ?? 0,
          activeNow: enVivo.get(canal) ?? 0,
        },
      };
    }

    return {
      filters: {
        organizationId: org,
        range: String(filters.range ?? 'MONTH').toUpperCase(),
        startDate: rango.gte.toISOString(),
        endDate: rango.lt.toISOString(),
        granularity: rango.granularidad,
        timeZone: rango.timeZone,
      },
      generatedAt: now.toISOString(),
      channels,
      details: {
        appointmentsByStatus: citasPorEstado,
        peakHours: horasPico,
        messageTypes: tiposMensaje,
        failureReasons: motivos,
        flows: flujos,
        delivery: { WHATSAPP: entregaWa, TELEGRAM: entregaTg },
        /** La caja negra (motivos y flujos) solo guarda 180 días. */
        interactionLogRetentionDays: 180,
      },
    };
  }

  // ── Actividad (ChannelActivityLog) ─────────────────────────────────────────

  private filtroOrg(org: string | null) {
    return Prisma.sql`(${org}::text IS NULL OR "organizationId" = ${org})`;
  }

  private tramo(rango: RangoResuelto, columna: Prisma.Sql) {
    return Prisma.sql`to_char((${columna} AT TIME ZONE 'UTC') AT TIME ZONE ${rango.timeZone}, ${FORMATO_SQL_BUCKET[rango.granularidad]})`;
  }

  /**
   * Por canal y tramo: personas, mensajes, sin cita y con problema. Primero se
   * resume cada remitente dentro del tramo (¿escribió?, ¿agendó?, ¿gestionó?,
   * ¿tuvo un problema?) y después se cuentan remitentes.
   */
  private async actividadPorTramo(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.$queryRaw<
      Array<{
        channel: string;
        bucket: string;
        writers: bigint;
        messages: bigint;
        no_booking: bigint;
        problems: bigint;
      }>
    >`
      WITH por_remitente AS (
        SELECT channel::text AS channel,
               ${this.tramo(rango, Prisma.sql`"createdAt"`)} AS bucket,
               "senderHash",
               COUNT(*) FILTER (WHERE event = 'INBOUND') AS msgs,
               BOOL_OR(event = 'BOOKED')  AS booked,
               BOOL_OR(event = 'MANAGE')  AS managed,
               BOOL_OR(event = 'PROBLEM') AS problem
        FROM "ChannelActivityLog"
        WHERE "createdAt" >= ${rango.gte} AND "createdAt" < ${rango.lt}
          AND ${this.filtroOrg(org)}
        GROUP BY 1, 2, 3
      )
      SELECT channel, bucket,
             COUNT(*) FILTER (WHERE msgs > 0) AS writers,
             COALESCE(SUM(msgs), 0) AS messages,
             COUNT(*) FILTER (WHERE msgs > 0 AND NOT booked AND NOT managed) AS no_booking,
             COUNT(*) FILTER (WHERE problem) AS problems
      FROM por_remitente
      GROUP BY channel, bucket
    `;
    const mapa = new Map<
      string,
      { writers: number; messages: number; noBooking: number; problems: number }
    >();
    for (const f of filas) {
      mapa.set(`${f.channel}|${f.bucket}`, {
        writers: n(f.writers),
        messages: n(f.messages),
        noBooking: n(f.no_booking),
        problems: n(f.problems),
      });
    }
    return mapa;
  }

  /**
   * Lo mismo sobre el rango entero. No es la suma de los tramos: quien escribió
   * lunes y martes es UNA persona en la semana, y quien escribió el lunes y
   * agendó el martes sí agendó.
   */
  private async totalesActividad(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.$queryRaw<
      Array<{
        channel: string;
        writers: bigint;
        messages: bigint;
        booked: bigint;
        managed: bigint;
        no_booking: bigint;
        problems: bigint;
      }>
    >`
      WITH por_remitente AS (
        SELECT channel::text AS channel, "senderHash",
               COUNT(*) FILTER (WHERE event = 'INBOUND') AS msgs,
               BOOL_OR(event = 'BOOKED')  AS booked,
               BOOL_OR(event = 'MANAGE')  AS managed,
               BOOL_OR(event = 'PROBLEM') AS problem
        FROM "ChannelActivityLog"
        WHERE "createdAt" >= ${rango.gte} AND "createdAt" < ${rango.lt}
          AND ${this.filtroOrg(org)}
        GROUP BY 1, 2
      )
      SELECT channel,
             COUNT(*) FILTER (WHERE msgs > 0) AS writers,
             COALESCE(SUM(msgs), 0) AS messages,
             COUNT(*) FILTER (WHERE booked) AS booked,
             COUNT(*) FILTER (WHERE managed AND NOT booked) AS managed,
             COUNT(*) FILTER (WHERE msgs > 0 AND NOT booked AND NOT managed) AS no_booking,
             COUNT(*) FILTER (WHERE problem) AS problems
      FROM por_remitente
      GROUP BY channel
    `;
    const mapa = new Map<
      string,
      {
        writers: number;
        messages: number;
        booked: number;
        managed: number;
        noBooking: number;
        problems: number;
      }
    >();
    for (const f of filas) {
      mapa.set(f.channel, {
        writers: n(f.writers),
        messages: n(f.messages),
        booked: n(f.booked),
        managed: n(f.managed),
        noBooking: n(f.no_booking),
        problems: n(f.problems),
      });
    }
    return mapa;
  }

  /** Personas del rango que escribían por primera vez (en los 400 días que se guardan). */
  private async nuevosVsRecurrentes(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.$queryRaw<
      Array<{ channel: string; nuevos: bigint; recurrentes: bigint }>
    >`
      SELECT channel,
             COUNT(*) FILTER (WHERE primera >= ${rango.gte}) AS nuevos,
             COUNT(*) FILTER (WHERE primera <  ${rango.gte}) AS recurrentes
      FROM (
        SELECT channel::text AS channel, "senderHash",
               MIN("createdAt") AS primera, MAX("createdAt") AS ultima
        FROM "ChannelActivityLog"
        WHERE event = 'INBOUND' AND "createdAt" < ${rango.lt}
          AND ${this.filtroOrg(org)}
        GROUP BY 1, 2
      ) r
      WHERE ultima >= ${rango.gte}
      GROUP BY channel
    `;
    return new Map(
      filas.map((f) => [
        f.channel,
        { nuevos: n(f.nuevos), recurrentes: n(f.recurrentes) },
      ]),
    );
  }

  private async escribiendoAhora(now: Date, org: string | null) {
    const desde = new Date(now.getTime() - VENTANA_EN_VIVO_MIN * 60_000);
    const filas = await this.prisma.$queryRaw<
      Array<{ channel: string; writers: bigint }>
    >`
      SELECT channel::text AS channel, COUNT(DISTINCT "senderHash") AS writers
      FROM "ChannelActivityLog"
      WHERE event = 'INBOUND'
        AND "createdAt" >= ${desde} AND "createdAt" <= ${now}
        AND ${this.filtroOrg(org)}
      GROUP BY 1
    `;
    return new Map(filas.map((f) => [f.channel, n(f.writers)]));
  }

  /** Mensajes por día de la semana (0 = domingo) y hora local. */
  private async horasPico(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.$queryRaw<
      Array<{ channel: string; dow: number; hour: number; messages: bigint }>
    >`
      SELECT channel::text AS channel,
             EXTRACT(DOW  FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${rango.timeZone})::int AS dow,
             EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${rango.timeZone})::int AS hour,
             COUNT(*) AS messages
      FROM "ChannelActivityLog"
      WHERE event = 'INBOUND'
        AND "createdAt" >= ${rango.gte} AND "createdAt" < ${rango.lt}
        AND ${this.filtroOrg(org)}
      GROUP BY 1, 2, 3
    `;
    return filas
      .filter((f) => esCanal(f.channel))
      .map((f) => ({
        channel: f.channel as Canal,
        dow: Number(f.dow),
        hour: Number(f.hour),
        messages: n(f.messages),
      }));
  }

  private async tiposDeMensaje(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.$queryRaw<
      Array<{ channel: string; type: string | null; messages: bigint }>
    >`
      SELECT channel::text AS channel, "messageType" AS type, COUNT(*) AS messages
      FROM "ChannelActivityLog"
      WHERE event = 'INBOUND'
        AND "createdAt" >= ${rango.gte} AND "createdAt" < ${rango.lt}
        AND ${this.filtroOrg(org)}
      GROUP BY 1, 2
      ORDER BY 3 DESC
    `;
    return filas
      .filter((f) => esCanal(f.channel))
      .map((f) => ({
        channel: f.channel as Canal,
        type: f.type || 'otro',
        messages: n(f.messages),
      }));
  }

  // ── Citas (Appointment) ────────────────────────────────────────────────────

  private whereOrg(org: string | null) {
    return org ? Prisma.sql`AND "organizationId" = ${org}` : Prisma.empty;
  }

  private async citasPorTramo(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.$queryRaw<
      Array<{ channel: string; bucket: string; count: bigint }>
    >`
      SELECT origin::text AS channel,
             ${this.tramo(rango, Prisma.sql`"createdAt"`)} AS bucket,
             COUNT(*) AS count
      FROM "Appointment"
      WHERE origin IN ('WHATSAPP', 'TELEGRAM')
        AND "createdAt" >= ${rango.gte} AND "createdAt" < ${rango.lt}
        ${this.whereOrg(org)}
      GROUP BY 1, 2
    `;
    return new Map(filas.map((f) => [`${f.channel}|${f.bucket}`, n(f.count)]));
  }

  /** Qué pasó con las citas pedidas en el rango: vigentes, canceladas, atendidas, no asistió. */
  private async citasPorEstado(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.appointment.groupBy({
      by: ['origin', 'status', 'attendanceStatus'],
      where: {
        origin: { in: ['WHATSAPP', 'TELEGRAM'] },
        createdAt: { gte: rango.gte, lt: rango.lt },
        ...(org ? { organizationId: org } : {}),
      },
      _count: { _all: true },
    });
    const vacio = () => ({
      scheduled: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    });
    const out: Record<Canal, ReturnType<typeof vacio>> = {
      WHATSAPP: vacio(),
      TELEGRAM: vacio(),
    };
    for (const f of filas) {
      if (!esCanal(f.origin)) continue;
      const o = out[f.origin];
      const c = f._count._all;
      if (f.attendanceStatus === 'NO_SHOW') o.noShow += c;
      else if (f.status === 'CANCELLED') o.cancelled += c;
      else if (f.status === 'COMPLETED') o.completed += c;
      else o.scheduled += c;
    }
    return out;
  }

  // ── Caja negra (InteractionLog, 180 días) ──────────────────────────────────

  private async motivosDeFallo(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.$queryRaw<
      Array<{ channel: string; reason: string; count: bigint }>
    >`
      SELECT ${CANAL_INTERACTION} AS channel,
             COALESCE("failureReason", status) AS reason,
             COUNT(*) AS count
      FROM "InteractionLog"
      WHERE status IN ('FAILED', 'ABANDONED')
        AND "organizationId" IS NOT NULL
        AND "createdAt" >= ${rango.gte} AND "createdAt" < ${rango.lt}
        AND ${NO_ES_ENVIO_NUESTRO}
        ${this.whereOrg(org)}
      GROUP BY 1, 2
      ORDER BY 3 DESC
    `;
    return filas.map((f) => ({
      channel: f.channel as Canal,
      reason: f.reason,
      count: n(f.count),
    }));
  }

  private async flujos(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.$queryRaw<
      Array<{ channel: string; status: string; count: bigint }>
    >`
      SELECT ${CANAL_INTERACTION} AS channel, status, COUNT(*) AS count
      FROM "InteractionLog"
      WHERE status IN (${Prisma.join([...FLUJOS])})
        AND "createdAt" >= ${rango.gte} AND "createdAt" < ${rango.lt}
        ${this.whereOrg(org)}
      GROUP BY 1, 2
    `;
    const out: Record<Canal, Record<string, number>> = {
      WHATSAPP: Object.fromEntries(FLUJOS.map((f) => [f, 0])),
      TELEGRAM: Object.fromEntries(FLUJOS.map((f) => [f, 0])),
    };
    for (const f of filas) {
      if (esCanal(f.channel)) out[f.channel][f.status] = n(f.count);
    }
    return out;
  }

  // ── Entrega de lo que enviamos ─────────────────────────────────────────────

  private async entregaWhatsapp(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.whatsappMessageLog.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: rango.gte, lt: rango.lt },
        ...(org ? { organizationId: org } : {}),
      },
      _count: { _all: true },
    });
    return Object.fromEntries(filas.map((f) => [f.status, f._count._all]));
  }

  private async entregaTelegram(rango: RangoResuelto, org: string | null) {
    const filas = await this.prisma.telegramMessageLog.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: rango.gte, lt: rango.lt },
        ...(org ? { organizationId: org } : {}),
      },
      _count: { _all: true },
    });
    return Object.fromEntries(filas.map((f) => [f.status, f._count._all]));
  }
}

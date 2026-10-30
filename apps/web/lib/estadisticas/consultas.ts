import { Prisma, type PrismaClient } from '@agenia/database';
import { horaLocalAUtc, sumarDiasAFecha } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { ESTADISTICAS, type CorteDeEstadisticas } from './periodo';

/**
 * 📊 Estadísticas para compartir: las cifras, de solo lectura y sin ningún dato
 * de un paciente (solo conteos). Son las consultas con que se armó a mano la
 * página del 24-oct en claude.ai, con el corte en la medianoche del día que
 * todavía no termina (`periodo.ts`).
 *
 * Las columnas DateTime de Prisma son `timestamp` SIN zona, en UTC: la hora de la
 * clínica es `(col AT TIME ZONE 'UTC') AT TIME ZONE <zona>`, y el corte se pasa
 * como texto ISO convertido a esa misma forma (comparar con un `timestamptz`
 * dependería de la zona de la sesión de Postgres).
 */

export interface DatosDeEstadisticas {
    recordatoriosPorDia: { dia: string; enviados: number; entregados: number; leidos: number }[];
    confirmacionesPorDia: { dia: string; personas: number }[];
    confirmaciones: { personas: number; citas: number };
    cancelaciones: { total: number; retomados: number; horasMediana: number | null };
    cambiosDeFecha: number;
    citasChat: { total: number; fueraDeHorario: number; pacientesNuevos: number };
    citasChatPorDia: { dia: string; n: number }[];
    hospital: { entregadas: number; segundosPromedio: number | null };
    avisosInasistencia: number;
    consultas: number;
    mensajes: { total: number; personas: number; fueraDeHorario: number };
    mensajesPorHora: { hora: number; n: number }[];
    asistencia: { recordada: boolean; citas: number; asistieron: number }[];
    /** ⏱️ Cuánto espera el paciente por su cita; null si aún no hay período (sin recordatorios ni citas por chat). */
    espera: {
        /**
         * Días calendario entre el día en que pidió la cita y el de la cita (el
         * indicador de oportunidad de la Res. 256 de 2016), por canal y por días
         * (4 = más de 3). `sumaDias` lleva los días reales, para el promedio.
         */
        oportunidad: { canal: 'chat' | 'personal'; dias: number; citas: number; sumaDias: number }[];
        /** Los servicios que se miden (los activos de la clínica). */
        servicios: string[];
        /** Minutos de conversación por chat, del primer mensaje a la cita asignada. */
        conversacion: { citas: number; medidas: number; medianaMin: number | null; promedioMin: number | null };
        /** Horas en la lista de espera, de entrar a recibir el cupo. */
        listaEspera: { asignadas: number; medianaHoras: number | null; promedioHoras: number | null };
    } | null;
}

type Db = Pick<PrismaClient, '$queryRaw'>;

/** Instante UTC → la forma de las columnas (timestamp sin zona, en UTC). */
const comoColumna = (instante: Date) => Prisma.sql`(${instante.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export async function consultarEstadisticas(
    organizationId: string,
    corte: CorteDeEstadisticas,
    timeZone: string,
    db: Db = prisma,
): Promise<DatosDeEstadisticas> {
    const org = organizationId;
    const hasta = comoColumna(corte.hastaUtc);
    const local = (columna: string) => Prisma.sql`((${Prisma.raw(columna)} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text)`;
    const dia = (columna: string) => Prisma.sql`to_char(${local(columna)}::date, 'YYYY-MM-DD')`;
    const fueraDeHorario = (columna: string) => Prisma.sql`(
        extract(dow FROM ${local(columna)}) IN (0, 6)
        OR extract(hour FROM ${local(columna)}) < ${ESTADISTICAS.OFICINA_DESDE}
        OR extract(hour FROM ${local(columna)}) >= ${ESTADISTICAS.OFICINA_HASTA})`;

    const [
        recordatoriosPorDia,
        confirmacionesPorDia,
        [confirmaciones],
        [cancelaciones],
        [cambios],
        [citasChat],
        citasChatPorDia,
        [hospital],
        [avisos],
        [consultas],
        [mensajes],
        mensajesPorHora,
    ] = await Promise.all([
        db.$queryRaw<DatosDeEstadisticas['recordatoriosPorDia']>(Prisma.sql`
            SELECT ${dia('"createdAt"')} AS dia, count(*)::int AS enviados,
                   count(*) FILTER (WHERE status IN ('DELIVERED', 'READ'))::int AS entregados,
                   count(*) FILTER (WHERE status = 'READ')::int AS leidos
            FROM "WhatsappMessageLog"
            WHERE "organizationId" = ${org} AND kind = 'APPOINTMENT_REMINDER' AND "createdAt" < ${hasta}
            GROUP BY 1 ORDER BY 1`),
        db.$queryRaw<DatosDeEstadisticas['confirmacionesPorDia']>(Prisma.sql`
            SELECT ${dia('"createdAt"')} AS dia, count(DISTINCT "whatsappId")::int AS personas
            FROM "InteractionLog"
            WHERE "organizationId" = ${org} AND metadata->>'step' = 'RECORDATORIO_CONFIRMADO' AND "createdAt" < ${hasta}
            GROUP BY 1 ORDER BY 1`),
        // Cada cita confirmada cuenta una vez, aunque el paciente responda «sí» dos veces.
        db.$queryRaw<[DatosDeEstadisticas['confirmaciones']]>(Prisma.sql`
            SELECT count(DISTINCT "whatsappId")::int AS personas, count(DISTINCT metadata->>'appointmentId')::int AS citas
            FROM "InteractionLog"
            WHERE "organizationId" = ${org} AND metadata->>'step' = 'RECORDATORIO_CONFIRMADO' AND "createdAt" < ${hasta}`),
        // Un cupo «retomado» es uno que, después de la cancelación, tiene otra cita vigente.
        db.$queryRaw<[DatosDeEstadisticas['cancelaciones']]>(Prisma.sql`
            WITH c AS (
                SELECT "createdAt" AS cancelada, metadata->>'appointmentId' AS cita, metadata->>'slotId' AS cupo
                FROM "InteractionLog"
                WHERE "organizationId" = ${org} AND metadata->>'event' = 'APPOINTMENT_CANCELLED' AND "createdAt" < ${hasta})
            SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE EXISTS (
                       SELECT 1 FROM "Appointment" a
                       WHERE a."scheduleSlotId" = c.cupo AND a.id <> c.cita AND a.status = 'SCHEDULED'
                         AND a."createdAt" > c.cancelada AND a."createdAt" < ${hasta}))::int AS retomados,
                   (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM s."startTime" - c.cancelada) / 3600))::float8 AS "horasMediana"
            FROM c LEFT JOIN "ScheduleSlot" s ON s.id = c.cupo`),
        db.$queryRaw<[{ n: number }]>(Prisma.sql`
            SELECT count(*)::int AS n FROM "InteractionLog"
            WHERE "organizationId" = ${org} AND metadata->>'event' = 'APPOINTMENT_RESCHEDULED' AND "createdAt" < ${hasta}`),
        // «Paciente nuevo»: su ficha nació con la cita (lo registró el asistente al agendar).
        db.$queryRaw<[DatosDeEstadisticas['citasChat']]>(Prisma.sql`
            SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE ${fueraDeHorario('a."createdAt"')})::int AS "fueraDeHorario",
                   count(*) FILTER (WHERE p."createdAt" >= a."createdAt" - interval '5 minutes')::int AS "pacientesNuevos"
            FROM "Appointment" a JOIN "PatientProfile" p ON p.id = a."patientId"
            WHERE a."organizationId" = ${org} AND a.origin IN ('WHATSAPP', 'TELEGRAM') AND a."createdAt" < ${hasta}`),
        db.$queryRaw<DatosDeEstadisticas['citasChatPorDia']>(Prisma.sql`
            SELECT ${dia('"createdAt"')} AS dia, count(*)::int AS n
            FROM "Appointment"
            WHERE "organizationId" = ${org} AND origin IN ('WHATSAPP', 'TELEGRAM') AND "createdAt" < ${hasta}
            GROUP BY 1 ORDER BY 1`),
        db.$queryRaw<[DatosDeEstadisticas['hospital']]>(Prisma.sql`
            SELECT count(o."deliveredAt")::int AS entregadas,
                   (avg(extract(epoch FROM o."deliveredAt" - o."createdAt")))::float8 AS "segundosPromedio"
            FROM "SyncOutbox" o JOIN "Appointment" a ON a.id = o."entityId"
            WHERE o."organizationId" = ${org} AND o."entityType" = 'APPOINTMENT' AND o.op = 'INSERT'
              AND a.origin IN ('WHATSAPP', 'TELEGRAM') AND a."createdAt" < ${hasta}`),
        db.$queryRaw<[{ n: number }]>(Prisma.sql`
            SELECT count(*)::int AS n FROM "SyncException"
            WHERE "organizationId" = ${org} AND kind = 'AVISO_INASISTENCIA' AND "createdAt" < ${hasta}`),
        db.$queryRaw<[{ n: number }]>(Prisma.sql`
            SELECT count(*)::int AS n FROM "InteractionLog"
            WHERE "organizationId" = ${org} AND metadata->>'step' IN ('LOOKUP_SHOWN', 'LOOKUP_MINIMAL', 'LOOKUP_NONE')
              AND "createdAt" < ${hasta}`),
        db.$queryRaw<[DatosDeEstadisticas['mensajes']]>(Prisma.sql`
            SELECT count(*)::int AS total, count(DISTINCT "senderHash")::int AS personas,
                   count(*) FILTER (WHERE ${fueraDeHorario('"createdAt"')})::int AS "fueraDeHorario"
            FROM "ChannelActivityLog"
            WHERE "organizationId" = ${org} AND event = 'INBOUND' AND "createdAt" < ${hasta}`),
        db.$queryRaw<DatosDeEstadisticas['mensajesPorHora']>(Prisma.sql`
            SELECT extract(hour FROM ${local('"createdAt"')})::int AS hora, count(*)::int AS n
            FROM "ChannelActivityLog"
            WHERE "organizationId" = ${org} AND event = 'INBOUND' AND "createdAt" < ${hasta}
            GROUP BY 1 ORDER BY 1`),
    ]);

    // Asistencia: citas ya pasadas desde el día siguiente al primer recordatorio, de
    // los médicos con WhatsApp encendido y servicios activos (el alcance del
    // asistente), según lo que registró el hospital.
    const primerRecordatorio = recordatoriosPorDia[0]?.dia;
    let asistencia: DatosDeEstadisticas['asistencia'] = [];
    if (primerRecordatorio) {
        const [y, m, d] = sumarDiasAFecha(primerRecordatorio, 1).split('-').map(Number);
        const desde = comoColumna(horaLocalAUtc(y, m, d, 0, timeZone));
        asistencia = await db.$queryRaw<DatosDeEstadisticas['asistencia']>(Prisma.sql`
            WITH citas AS (
                SELECT a."attendanceStatus" AS asistencia,
                       EXISTS (
                           SELECT 1 FROM "WhatsappMessageLog" w
                           WHERE w."appointmentId" = a.id AND w.kind = 'APPOINTMENT_REMINDER' AND w.status IN ('DELIVERED', 'READ')
                       ) AS recordada
                FROM "Appointment" a
                JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
                JOIN "DoctorProfile" d ON d.id = s."doctorId"
                JOIN "MedicalService" sv ON sv.id = s."serviceId"
                WHERE a."organizationId" = ${org} AND a.status = 'SCHEDULED'
                  AND s."startTime" >= ${desde} AND s."startTime" < ${hasta}
                  AND d."whatsappBookingEnabled" AND sv."isActive"
                  AND a."attendanceStatus" IN ('ATTENDED', 'NO_SHOW'))
            SELECT recordada, count(*)::int AS citas, count(*) FILTER (WHERE asistencia = 'ATTENDED')::int AS asistieron
            FROM citas GROUP BY recordada`);
    }

    // ⏱️ Cuánto espera el paciente por su cita (2026-10-30), en las citas pedidas
    // desde el inicio del período de la página. La «solicitud» es el momento en
    // que la cita nace en AgenIA: por chat, cuando el paciente dice SÍ (la pide en
    // esa misma conversación); las del hospital, cuando AgenIA la ve en su
    // sistema, que es en el momento, en horario de ventanilla (medido el 30-oct).
    const inicio = primerRecordatorio ?? citasChatPorDia[0]?.dia;
    let espera: DatosDeEstadisticas['espera'] = null;
    if (inicio) {
        const [y, m, d] = inicio.split('-').map(Number);
        const desde = comoColumna(horaLocalAUtc(y, m, d, 0, timeZone));
        const [oportunidad, servicios, [conversacion], [listaEspera]] = await Promise.all([
            db.$queryRaw<NonNullable<DatosDeEstadisticas['espera']>['oportunidad']>(Prisma.sql`
                WITH c AS (
                    SELECT CASE WHEN a.origin IN ('WHATSAPP', 'TELEGRAM') THEN 'chat' ELSE 'personal' END AS canal,
                           ${local('s."startTime"')}::date - ${local('a."createdAt"')}::date AS dias
                    FROM "Appointment" a
                    JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
                    JOIN "MedicalService" sv ON sv.id = s."serviceId"
                    WHERE a."organizationId" = ${org} AND sv."isActive"
                      AND a."createdAt" >= ${desde} AND a."createdAt" < ${hasta})
                SELECT canal, least(dias, 4)::int AS dias, count(*)::int AS citas, sum(dias)::int AS "sumaDias"
                FROM c WHERE dias >= 0
                GROUP BY 1, 2 ORDER BY 1, 2`),
            db.$queryRaw<{ nombre: string }[]>(Prisma.sql`
                SELECT name AS nombre FROM "MedicalService"
                WHERE "organizationId" = ${org} AND "isActive" ORDER BY name`),
            // Inicio de la conversación: el último mensaje del mismo chat que llega
            // tras más de 30 minutos de silencio, en las 2 horas antes de la cita. Solo
            // se mide cuando el chat es el del paciente (un familiar que agenda desde
            // su número no se puede emparejar).
            db.$queryRaw<[NonNullable<DatosDeEstadisticas['espera']>['conversacion']]>(Prisma.sql`
                WITH citas AS (
                    SELECT a."createdAt" AS creada, p."whatsappId" AS chat
                    FROM "Appointment" a JOIN "PatientProfile" p ON p.id = a."patientId"
                    WHERE a."organizationId" = ${org} AND a.origin IN ('WHATSAPP', 'TELEGRAM')
                      AND a."createdAt" >= ${desde} AND a."createdAt" < ${hasta}),
                inicio AS (
                    SELECT c.creada, (
                        SELECT max(x.t) FROM (
                            SELECT i."createdAt" AS t, lag(i."createdAt") OVER (ORDER BY i."createdAt") AS antes
                            FROM "InteractionLog" i
                            WHERE i."organizationId" = ${org} AND i."whatsappId" = c.chat
                              AND i."createdAt" BETWEEN c.creada - interval '2 hours' AND c.creada) x
                        WHERE x.antes IS NULL OR x.t - x.antes > interval '30 minutes') AS desde
                    FROM citas c)
                SELECT count(*)::int AS citas, count(desde)::int AS medidas,
                       (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM creada - desde) / 60))::float8 AS "medianaMin",
                       (avg(extract(epoch FROM creada - desde) / 60))::float8 AS "promedioMin"
                FROM inicio`),
            db.$queryRaw<[NonNullable<DatosDeEstadisticas['espera']>['listaEspera']]>(Prisma.sql`
                SELECT count(*)::int AS asignadas,
                       (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM "updatedAt" - "createdAt") / 3600))::float8 AS "medianaHoras",
                       (avg(extract(epoch FROM "updatedAt" - "createdAt") / 3600))::float8 AS "promedioHoras"
                FROM "WaitlistEntry"
                WHERE "organizationId" = ${org} AND status = 'CONFIRMED'
                  AND "createdAt" >= ${desde} AND "updatedAt" < ${hasta}`),
        ]);
        espera = { oportunidad, servicios: servicios.map((s) => s.nombre), conversacion, listaEspera };
    }

    return {
        recordatoriosPorDia,
        confirmacionesPorDia,
        confirmaciones,
        cancelaciones,
        cambiosDeFecha: cambios.n,
        citasChat,
        citasChatPorDia,
        hospital,
        avisosInasistencia: avisos.n,
        consultas: consultas.n,
        mensajes,
        mensajesPorHora,
        asistencia,
        espera,
    };
}

// Una consulta por clínica y por corte: la página se recalcula una vez al día y
// todos los que la abren ese día ven lo mismo. Se guarda la promesa para que dos
// visitas a la vez no consulten dos veces; si falla, se olvida y se reintenta.
const enMemoria = new Map<string, { hasta: string; datos: Promise<DatosDeEstadisticas> }>();

export function estadisticasDelCorte(
    organizationId: string,
    corte: CorteDeEstadisticas,
    timeZone: string,
): Promise<DatosDeEstadisticas> {
    const guardado = enMemoria.get(organizationId);
    if (guardado && guardado.hasta === corte.hasta) return guardado.datos;
    const datos = consultarEstadisticas(organizationId, corte, timeZone);
    enMemoria.set(organizationId, { hasta: corte.hasta, datos });
    datos.catch(() => {
        if (enMemoria.get(organizationId)?.datos === datos) enMemoria.delete(organizationId);
    });
    return datos;
}

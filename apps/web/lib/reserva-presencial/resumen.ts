/**
 * 🏥 Cómo va la reserva para la atención presencial en los próximos días, para el
 * panel (Configuración › Asistente Virtual, 2026-11-13): por día, cuántos cupos
 * tiene la agenda de los médicos que agendan por el asistente, cuántas citas
 * puede tomar el asistente con el porcentaje guardado (su tope), cuántas lleva,
 * cuántas dio el hospital y cuántos cupos quedan libres.
 *
 * Cuenta igual que la API (apps/api/src/appointments/reserva-presencial.ts):
 * capacidad = cupos libres + cupos con una cita vigente; citas del asistente =
 * vigentes con origen WHATSAPP o TELEGRAM; por médico y día en la zona de la
 * clínica. La regla vive en `@agenia/shared` (reserva-presencial.ts). Solo lectura.
 */
import { Prisma } from '@agenia/database';
import { prisma } from '@/lib/prisma';
import {
    DEFAULT_TIMEZONE,
    SYNC_AUDIT_DIRECTION,
    chatEnElTope,
    diaLocal,
    horaLocalAUtc,
    esDiaSabado,
    normalizarParteDelChat,
    normalizarSabadoRural,
    partesDeFecha,
    porcentajeDelDia,
    sumarDiasAFecha,
    topeDelChat,
} from '@agenia/shared';

/** La operación con que se anota en la auditoría un cambio de la reserva. */
export const OP_CAMBIO_RESERVA = 'BOT_SHARE_CHANGE';

/** Cuántos días se muestran, contando hoy. */
const DIAS_A_MOSTRAR = 8;

export interface MedicoDiaDelPanel {
    doctorId: string;
    /** 'YYYY-MM-DD' de la clínica. */
    dia: string;
    capacidad: number;
    chat: number;
    /** Citas vigentes que no son del asistente (hospital y panel). */
    otras: number;
    libres: number;
}

export interface DiaDeLaReserva {
    dia: string;
    medicos: number;
    capacidad: number;
    /** Suma de los topes de cada médico ese día; con «sin reserva», la capacidad. */
    tope: number;
    chat: number;
    otras: number;
    libres: number;
    /** Médicos donde el asistente ya llegó a su tope ese día. */
    medicosEnElTope: number;
    /** Ese día tiene tope (con «sin reserva», solo el sábado de la zona rural). */
    conTope?: boolean;
    /** 🌾 Sábado con «Sábados: solo zona rural» encendida. */
    soloRural?: boolean;
}

export interface ResumenDeLaReserva {
    /** El porcentaje guardado; null sin reserva. */
    porcentaje: number | null;
    /** 🌾 El tope del sábado con «Sábados: solo zona rural» (100 = sin tope); null apagada. */
    sabadoRural?: number | null;
    hoy: string;
    dias: DiaDeLaReserva[];
    /** El último cambio: quién y cómo (texto de la auditoría) y cuándo (ISO). */
    ultimoCambio: { detalle: string; en: string } | null;
}

/**
 * Un instante como valor de columna `timestamp` (UTC sin zona). Un `Date` suelto
 * viaja como `timestamptz` y Postgres lo pasa a la hora de la sesión (en
 * producción, America/Bogota): quedaba 5 horas corrido. Ver `estadisticas/consultas.ts`.
 */
const comoColumna = (instante: Date) => Prisma.sql`(${instante.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function inicioDelDia(dia: string, timeZone: string): Date {
    const [y, m, d] = partesDeFecha(dia)!;
    return horaLocalAUtc(y, m, d, 0, timeZone);
}

/** Capacidad y citas por médico y día, de los médicos que agendan por el asistente. */
export async function contarMedicoDiasDelPanel(
    organizationId: string,
    desdeDia: string,
    hastaDia: string,
    timeZone: string,
): Promise<MedicoDiaDelPanel[]> {
    const inicio = inicioDelDia(desdeDia, timeZone);
    const fin = inicioDelDia(sumarDiasAFecha(hastaDia, 1), timeZone);
    const filas = await prisma.$queryRaw<
        { doctorId: string; dia: string; capacidad: number; chat: number; otras: number; libres: number }[]
    >(Prisma.sql`
        SELECT s."doctorId" AS "doctorId",
               to_char((s."startTime" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS "dia",
               (count(*) FILTER (WHERE v.id IS NOT NULL OR s."isAvailable"))::int AS "capacidad",
               (count(*) FILTER (WHERE v.origin::text IN ('WHATSAPP', 'TELEGRAM')))::int AS "chat",
               (count(*) FILTER (WHERE v.id IS NOT NULL AND v.origin::text NOT IN ('WHATSAPP', 'TELEGRAM')))::int AS "otras",
               (count(*) FILTER (WHERE v.id IS NULL AND s."isAvailable"))::int AS "libres"
          FROM "ScheduleSlot" s
          JOIN "DoctorProfile" d ON d.id = s."doctorId"
          LEFT JOIN LATERAL (
            SELECT a.id, a.origin
              FROM "Appointment" a
             WHERE a."scheduleSlotId" = s.id AND a.status <> 'CANCELLED'
             LIMIT 1
          ) v ON true
         WHERE s."organizationId" = ${organizationId}
           AND d."whatsappBookingEnabled"
           AND s."startTime" >= ${comoColumna(inicio)}
           AND s."startTime" < ${comoColumna(fin)}
         GROUP BY 1, 2
    `);
    return filas.map((f) => ({
        doctorId: f.doctorId,
        dia: f.dia,
        capacidad: Number(f.capacidad) || 0,
        chat: Number(f.chat) || 0,
        otras: Number(f.otras) || 0,
        libres: Number(f.libres) || 0,
    }));
}

/**
 * Suma los médicos de cada día. Puro. Con «Sábados: solo zona rural», el sábado
 * lleva su propio tope (`sabadoRural`).
 */
export function resumirPorDia(
    filas: readonly MedicoDiaDelPanel[],
    porcentaje: number | null,
    sabadoRural: number | null = null,
): DiaDeLaReserva[] {
    const rural = normalizarSabadoRural(sabadoRural);
    const porDia = new Map<string, DiaDeLaReserva>();
    for (const f of filas) {
        if (f.capacidad <= 0) continue;
        const pct = porcentajeDelDia(f.dia, { porcentaje, sabadoRural: rural });
        const d = porDia.get(f.dia) ?? {
            dia: f.dia,
            medicos: 0,
            capacidad: 0,
            tope: 0,
            chat: 0,
            otras: 0,
            libres: 0,
            medicosEnElTope: 0,
            conTope: pct !== null,
            soloRural: rural !== null && esDiaSabado(f.dia),
        };
        d.medicos += 1;
        d.capacidad += f.capacidad;
        d.tope += topeDelChat(f.capacidad, pct);
        d.chat += f.chat;
        d.otras += f.otras;
        d.libres += f.libres;
        if (chatEnElTope(f, pct)) d.medicosEnElTope += 1;
        porDia.set(f.dia, d);
    }
    return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

export async function cargarResumenDeLaReserva(
    organizationId: string,
    ahora = new Date(),
): Promise<ResumenDeLaReserva> {
    const [settings, org, ultimo] = await Promise.all([
        prisma.organizationSettings.findUnique({
            where: { organizationId },
            select: { botAgendaSharePercent: true, saturdayRuralSharePercent: true },
        }),
        prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
        prisma.syncAudit.findFirst({
            where: { organizationId, direction: SYNC_AUDIT_DIRECTION.CONFIG, op: OP_CAMBIO_RESERVA },
            orderBy: { createdAt: 'desc' },
            select: { detail: true, createdAt: true },
        }),
    ]);
    const timeZone = org?.timezone || DEFAULT_TIMEZONE;
    const porcentaje = normalizarParteDelChat(settings?.botAgendaSharePercent);
    const sabadoRural = normalizarSabadoRural(settings?.saturdayRuralSharePercent);
    const hoy = diaLocal(ahora, timeZone);
    const filas = await contarMedicoDiasDelPanel(
        organizationId,
        hoy,
        sumarDiasAFecha(hoy, DIAS_A_MOSTRAR - 1),
        timeZone,
    );
    return {
        porcentaje,
        sabadoRural,
        hoy,
        dias: resumirPorDia(filas, porcentaje, sabadoRural),
        ultimoCambio: ultimo ? { detalle: ultimo.detail ?? '', en: ultimo.createdAt.toISOString() } : null,
    };
}

/**
 * Para el resumen del plazo («el asistente puede ofrecer N cupos»): las llaves
 * `médico|día` donde el asistente ya llegó a su tope, para no contar cupos que no
 * puede dar. Sin reserva, ninguna (y ninguna consulta).
 */
export async function medicoDiasEnElTopeDelPanel(
    organizationId: string,
    porcentaje: number | null,
    desde: Date,
    hasta: Date,
    timeZone: string,
    sabadoRural: number | null = null,
): Promise<Set<string>> {
    const p = {
        porcentaje: normalizarParteDelChat(porcentaje),
        sabadoRural: normalizarSabadoRural(sabadoRural),
    };
    // Ningún día con tope: ni el de semana ni el del sábado.
    if (p.porcentaje === null && normalizarParteDelChat(p.sabadoRural) === null) return new Set();
    const filas = await contarMedicoDiasDelPanel(
        organizationId,
        diaLocal(desde, timeZone),
        diaLocal(hasta, timeZone),
        timeZone,
    );
    return new Set(
        filas
            .filter((f) => {
                if (f.capacidad <= 0) return false;
                const pct = porcentajeDelDia(f.dia, p);
                return pct !== null && chatEnElTope(f, pct);
            })
            .map((f) => `${f.doctorId}|${f.dia}`),
    );
}

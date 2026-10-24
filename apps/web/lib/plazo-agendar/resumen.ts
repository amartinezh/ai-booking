/**
 * 🗓️ Qué le deja ofrecer HOY el plazo máximo para agendar al asistente, para el
 * panel (Configuración › Asistente Virtual, 2026-10-23: con 2 días un viernes, el
 * asistente no tenía ningún cupo hasta el domingo y nadie lo sabía).
 *
 * Cuenta los cupos con las mismas reglas del asistente (AppointmentsService
 * .getAvailableSlots): libres, de servicios activos, de médicos con «WhatsApp ON»
 * —y, con espejo, homologados—, desde la anticipación mínima y sin los días sin
 * citas. La regla del conteo vive en `@agenia/shared` (resumenCuposDelPlazo).
 * Solo lectura.
 */
import { prisma } from '@/lib/prisma';
import {
    SYNC_AUDIT_DIRECTION,
    diaLocal,
    normalizarPlazoAgendar,
    resumenCuposDelPlazo,
    type ResumenCuposDelPlazo,
} from '@agenia/shared';

/** La operación con que se anota en la auditoría un cambio del plazo. */
export const OP_CAMBIO_PLAZO = 'BOOKING_MAX_DAYS_CHANGE';

/** Hasta dónde se miran cupos: más allá el aviso no cambia. */
const DIAS_A_MIRAR = 120;
const MAX_CUPOS = 5000;

export interface ResumenDelPlazo extends ResumenCuposDelPlazo {
    /** 'YYYY-MM-DD' de la clínica. */
    hoy: string;
    /** El plazo guardado; null sin límite. */
    dias: number | null;
    /** El último cambio del plazo: quién y cómo (texto de la auditoría) y cuándo (ISO). */
    ultimoCambio: { detalle: string; en: string } | null;
}

export async function cargarResumenDelPlazo(organizationId: string, ahora = new Date()): Promise<ResumenDelPlazo> {
    const [settings, org, espejo, reglas, ultimo] = await Promise.all([
        prisma.organizationSettings.findUnique({
            where: { organizationId },
            select: { bookingMaxDaysAhead: true },
        }),
        prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
        prisma.hospitalMirrorConfig.findUnique({ where: { organizationId }, select: { enabled: true } }),
        prisma.bookingBlock.findMany({
            where: { organizationId },
            select: { date: true, repeatWeekly: true, startMinute: true, endMinute: true },
        }),
        prisma.syncAudit.findFirst({
            where: { organizationId, direction: SYNC_AUDIT_DIRECTION.CONFIG, op: OP_CAMBIO_PLAZO },
            orderBy: { createdAt: 'desc' },
            select: { detail: true, createdAt: true },
        }),
    ]);
    const homologados = espejo?.enabled
        ? (
              await prisma.mirrorEntityMap.findMany({
                  where: { organizationId, entityType: 'DOCTOR' },
                  select: { agenIAId: true },
              })
          ).map((m) => m.agenIAId)
        : null;

    const cupos = await prisma.scheduleSlot.findMany({
        where: {
            organizationId,
            isAvailable: true,
            startTime: { gte: ahora, lt: new Date(ahora.getTime() + DIAS_A_MIRAR * 86_400_000) },
            service: { isActive: true },
            doctor: {
                whatsappBookingEnabled: true,
                ...(homologados ? { id: { in: homologados } } : {}),
            },
        },
        select: { startTime: true },
        orderBy: { startTime: 'asc' },
        take: MAX_CUPOS,
    });

    const timeZone = org?.timezone || undefined;
    const dias = normalizarPlazoAgendar(settings?.bookingMaxDaysAhead);
    return {
        ...resumenCuposDelPlazo({
            inicios: cupos.map((c) => c.startTime),
            ahora,
            dias,
            reglas,
            timeZone,
        }),
        hoy: diaLocal(ahora, timeZone),
        dias,
        ultimoCambio: ultimo ? { detalle: ultimo.detail ?? '', en: ultimo.createdAt.toISOString() } : null,
    };
}

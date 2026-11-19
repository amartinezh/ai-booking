/**
 * 🌾 Cómo está «Sábados por el asistente» (Configuración › Asistente Virtual,
 * 2026-11-19): la regla guardada, si ya llegó la lista de pacientes de zona rural
 * que manda el agente del hospital, si los sábados siguen bloqueados en «Días sin
 * citas» y quién la cambió por última vez. Solo lectura.
 */
import { prisma } from '@/lib/prisma';
import { SYNC_AUDIT_DIRECTION, esDiaSabado, normalizarSabadoRural } from '@agenia/shared';

/** La operación con que se anota en la auditoría un cambio de la regla. */
export const OP_CAMBIO_SABADO_RURAL = 'SATURDAY_RURAL_CHANGE';

export interface EstadoSabadoRural {
    /** El porcentaje guardado (100 = sin tope); null = sin regla especial. */
    porcentaje: number | null;
    /** La clínica está conectada al hospital (sin eso no hay de dónde sacar la zona). */
    conEspejo: boolean;
    /** La última lista completa que llegó, o null si todavía no llega ninguna. */
    lista: { total: number; recibidaEn: string } | null;
    /** Los sábados en «Días sin citas»: todo el día, unas horas, o nada. */
    bloqueoSabado: 'COMPLETO' | 'PARCIAL' | null;
    ultimoCambio: { detalle: string; en: string } | null;
}

/** ¿La regla de «Días sin citas» es un sábado de todas las semanas, y de todo el día? Puro. */
export function bloqueoDeLosSabados(
    reglas: readonly { date: string; repeatWeekly: boolean; startMinute: number | null; endMinute: number | null }[],
): 'COMPLETO' | 'PARCIAL' | null {
    const semanales = reglas.filter((r) => r.repeatWeekly && esDiaSabado(r.date));
    if (semanales.length === 0) return null;
    const todoElDia = semanales.some(
        (r) => (r.startMinute ?? 0) <= 0 && (r.endMinute === null || r.endMinute >= 24 * 60),
    );
    return todoElDia ? 'COMPLETO' : 'PARCIAL';
}

export async function cargarEstadoSabadoRural(organizationId: string): Promise<EstadoSabadoRural> {
    const [settings, espejo, reglas, ultimo] = await Promise.all([
        prisma.organizationSettings.findUnique({
            where: { organizationId },
            select: { saturdayRuralSharePercent: true },
        }),
        prisma.hospitalMirrorConfig.findUnique({
            where: { organizationId },
            select: { ruralListCount: true, ruralListSyncedAt: true },
        }),
        prisma.bookingBlock.findMany({
            where: { organizationId, repeatWeekly: true },
            select: { date: true, repeatWeekly: true, startMinute: true, endMinute: true },
        }),
        prisma.syncAudit.findFirst({
            where: { organizationId, direction: SYNC_AUDIT_DIRECTION.CONFIG, op: OP_CAMBIO_SABADO_RURAL },
            orderBy: { createdAt: 'desc' },
            select: { detail: true, createdAt: true },
        }),
    ]);
    return {
        porcentaje: normalizarSabadoRural(settings?.saturdayRuralSharePercent),
        conEspejo: !!espejo,
        lista:
            espejo?.ruralListSyncedAt && (espejo.ruralListCount ?? 0) > 0
                ? { total: espejo.ruralListCount ?? 0, recibidaEn: espejo.ruralListSyncedAt.toISOString() }
                : null,
        bloqueoSabado: bloqueoDeLosSabados(reglas),
        ultimoCambio: ultimo ? { detalle: ultimo.detail ?? '', en: ultimo.createdAt.toISOString() } : null,
    };
}

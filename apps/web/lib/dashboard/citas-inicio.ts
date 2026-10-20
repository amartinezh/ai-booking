/**
 * VISIÓN GENERAL (/dashboard) — qué citas trae la tabla de inicio.
 *
 * Es la página a la que llega el personal al ingresar. Hasta el 2026-10-22
 * traía TODAS las citas de la clínica, con sus relaciones completas: 2.639
 * citas, 12,5 MB de HTML y unos 15 s en cargar, empezando por las más viejas.
 * Ahora:
 *  - sin fecha inicial elegida, la tabla arranca hoy (00:00 en la zona de la
 *    clínica); las fechas sirven para mirar atrás;
 *  - solo trae los campos que usan la tabla, la ficha clínica y el botón de
 *    recordatorio;
 *  - como mucho TOPE_CITAS_INICIO filas, con un aviso para acotar.
 */
import type { Prisma } from '@agenia/database';
import { diaLocal, horaLocalAUtc } from '@agenia/shared';

/** Filas como máximo: un día lleno ronda las 250 citas. */
export const TOPE_CITAS_INICIO = 500;

/**
 * Los campos que de verdad se usan: la tabla (DashboardClient), la ficha
 * clínica (ClinicalRecordDrawer: ids del paciente y del médico) y el canal del
 * recordatorio (lib/canal-recordatorio: teléfono, BSUID y Telegram del paciente).
 */
export const SELECT_CITA_INICIO = {
    id: true,
    scheduleSlotId: true,
    status: true,
    attendanceStatus: true,
    origin: true,
    reminderSentAt: true,
    eps: { select: { name: true } },
    clinicalRecord: { select: { id: true, status: true } },
    patient: {
        select: {
            id: true,
            fullName: true,
            cedula: true,
            whatsappId: true,
            bsuid: true,
            telegramChatId: true,
            telegramBlockedAt: true,
        },
    },
    scheduleSlot: {
        select: {
            startTime: true,
            endTime: true,
            service: { select: { name: true } },
            doctor: { select: { id: true, userId: true, fullName: true } },
        },
    },
} satisfies Prisma.AppointmentSelect;

export type CitaInicio = Prisma.AppointmentGetPayload<{ select: typeof SELECT_CITA_INICIO }>;

export interface VentanaDeCitas {
    gte?: Date;
    lte?: Date;
    /** Sin fecha inicial elegida: la tabla arranca hoy. */
    desdeHoy: boolean;
}

/** `YYYY-MM-DD` de un día que existe → [año, mes, día]; cualquier otra cosa → null. */
function fecha(valor: string | undefined): [number, number, number] | null {
    const m = typeof valor === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim()) : null;
    if (!m) return null;
    const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(Date.UTC(y, mes - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mes - 1 || t.getUTCDate() !== d) return null;
    return [y, mes, d];
}

const clave = ([y, m, d]: [number, number, number]) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * El rango de horas de la tabla según las fechas de los filtros (días de
 * calendario en la zona de la clínica, los dos incluidos). Una fecha que no se
 * entiende se ignora en vez de romper la página.
 *
 * Sin fecha inicial, la tabla arranca hoy, salvo que la fecha final ya haya
 * pasado: «hasta el viernes» es de hoy al viernes; «hasta el 1 de octubre»
 * (ya pasado) es todo lo anterior a esa fecha.
 */
export function ventanaDeCitas(
    filtros: { startDate?: string; endDate?: string },
    ahora: Date = new Date(),
    timeZone?: string,
): VentanaDeCitas {
    const inicio = fecha(filtros.startDate);
    const fin = fecha(filtros.endDate);
    const hoy = diaLocal(ahora, timeZone);

    const ventana: VentanaDeCitas = { desdeHoy: false };
    if (inicio) {
        ventana.gte = horaLocalAUtc(inicio[0], inicio[1], inicio[2], 0, timeZone);
    } else if (!fin || clave(fin) >= hoy) {
        const [y, m, d] = hoy.split('-').map(Number);
        ventana.gte = horaLocalAUtc(y, m, d, 0, timeZone);
        ventana.desdeHoy = true;
    }
    if (fin) {
        const siguiente = new Date(Date.UTC(fin[0], fin[1] - 1, fin[2] + 1));
        const inicioDelSiguiente = horaLocalAUtc(
            siguiente.getUTCFullYear(),
            siguiente.getUTCMonth() + 1,
            siguiente.getUTCDate(),
            0,
            timeZone,
        );
        ventana.lte = new Date(inicioDelSiguiente.getTime() - 1);
    }
    return ventana;
}

'use server';

// ─────────────────────────────────────────────────────────────
// 📅 DÍAS SIN CITAS (Configuración › Días sin citas, 2026-10-22).
//
// Días completos o rangos de horas para los que el asistente (WhatsApp y
// Telegram) no ofrece citas. Solo el administrador de la clínica. La regla vive
// en @agenia/shared (bloqueos-agenda.ts) y la API la aplica al ofrecer, reservar,
// cambiar la fecha y en la lista de espera. Este archivo es 'use server': solo
// exporta funciones async (los tipos no cuentan).
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import {
    bloqueoVigente,
    diaLocal,
    mismaRegla,
    validarBloqueoAgenda,
    type ReglaBloqueoAgenda,
} from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { getSession, type SessionPayload } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';

export interface BloqueoAgendaVista extends ReglaBloqueoAgenda {
    id: string;
    note: string | null;
    createdByEmail: string | null;
}

export interface BloqueosAgendaEstado {
    /** Hoy en la zona de la clínica: 'YYYY-MM-DD'. */
    hoy: string;
    bloqueos: BloqueoAgendaVista[];
}

export type ResultadoBloqueos =
    | ({ success: true } & BloqueosAgendaEstado)
    | { success: false; error: string };

type Admin = SessionPayload & { organizationId: string };

async function administrador(): Promise<Admin | null> {
    const session = await getSession();
    if (!session?.organizationId || session.role !== 'ORG_ADMIN') return null;
    return session as Admin;
}

async function hoyDeLaClinica(organizationId: string): Promise<string> {
    const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { timezone: true },
    });
    return diaLocal(new Date(), org?.timezone || undefined);
}

/** Los vigentes: los que se repiten, y los de un día que no ha pasado. */
async function estado(organizationId: string): Promise<BloqueosAgendaEstado> {
    const hoy = await hoyDeLaClinica(organizationId);
    const filas = await prisma.bookingBlock.findMany({
        where: { organizationId },
        select: {
            id: true,
            date: true,
            repeatWeekly: true,
            startMinute: true,
            endMinute: true,
            note: true,
            createdByEmail: true,
        },
        orderBy: [{ repeatWeekly: 'desc' }, { date: 'asc' }, { startMinute: 'asc' }],
    });
    return { hoy, bloqueos: filas.filter((b) => bloqueoVigente(b, hoy)) };
}

async function registrar(
    admin: Admin,
    action: 'BOOKING_BLOCK_CREATED' | 'BOOKING_BLOCK_DELETED',
    message: string,
    metadata: Record<string, unknown>,
): Promise<void> {
    await prisma.systemLog
        .create({
            data: {
                level: 'EVENT',
                action,
                message,
                userId: admin.userId,
                organizationId: admin.organizationId,
                metadata: metadata as never,
            },
        })
        .catch((e: unknown) => console.error(`No se pudo registrar ${action}:`, getErrorMessage(e)));
}

/** Lo que muestra la pestaña: hoy y los bloqueos vigentes. */
export async function obtenerBloqueosAgenda(): Promise<ResultadoBloqueos> {
    const admin = await administrador();
    if (!admin) return { success: false, error: 'Acceso denegado' };
    try {
        return { success: true, ...(await estado(admin.organizationId)) };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'No se pudieron cargar los días sin citas.' };
    }
}

/** Bloquea un día (o unas horas), una vez o cada semana. */
export async function crearBloqueoAgenda(entrada: {
    date: string;
    repeatWeekly: boolean;
    startMinute: number | null;
    endMinute: number | null;
    note?: string | null;
}): Promise<ResultadoBloqueos> {
    const admin = await administrador();
    if (!admin) return { success: false, error: 'Acceso denegado' };
    try {
        const hoy = await hoyDeLaClinica(admin.organizationId);
        const v = validarBloqueoAgenda(entrada ?? {}, hoy);
        if (!v.ok) return { success: false, error: v.error };

        const iguales = await prisma.bookingBlock.findMany({
            where: { organizationId: admin.organizationId, date: v.regla.date },
            select: { date: true, repeatWeekly: true, startMinute: true, endMinute: true },
        });
        if (iguales.some((b) => mismaRegla(b, v.regla))) {
            return { success: false, error: 'Ese bloqueo ya existe.' };
        }

        const creado = await prisma.bookingBlock.create({
            data: {
                organizationId: admin.organizationId,
                date: v.regla.date,
                repeatWeekly: v.regla.repeatWeekly,
                startMinute: v.regla.startMinute,
                endMinute: v.regla.endMinute,
                note: v.regla.note,
                createdById: admin.userId,
                createdByEmail: admin.email ?? null,
            },
            select: { id: true },
        });
        await registrar(admin, 'BOOKING_BLOCK_CREATED', 'Día u horas sin citas por el asistente', {
            id: creado.id,
            ...v.regla,
        });

        revalidatePath('/dashboard/configuracion');
        return { success: true, ...(await estado(admin.organizationId)) };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'No se pudo guardar el bloqueo.' };
    }
}

/** Quita un bloqueo: el asistente vuelve a ofrecer esas citas. */
export async function quitarBloqueoAgenda(id: string): Promise<ResultadoBloqueos> {
    const admin = await administrador();
    if (!admin) return { success: false, error: 'Acceso denegado' };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Bloqueo no encontrado.' };
    try {
        const fila = await prisma.bookingBlock.findFirst({
            where: { id, organizationId: admin.organizationId },
            select: { id: true, date: true, repeatWeekly: true, startMinute: true, endMinute: true, note: true },
        });
        if (!fila) return { success: false, error: 'Bloqueo no encontrado.' };

        await prisma.bookingBlock.delete({ where: { id: fila.id } });
        await registrar(admin, 'BOOKING_BLOCK_DELETED', 'Se quitó un día u horas sin citas', { ...fila });

        revalidatePath('/dashboard/configuracion');
        return { success: true, ...(await estado(admin.organizationId)) };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'No se pudo quitar el bloqueo.' };
    }
}

'use server';

import { getSession } from '../../lib/session';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { CommunicationStyle } from '@agenia/database';
import { getErrorMessage } from '@/lib/error';
import {
    SYNC_AUDIT_DIRECTION,
    diaLocal,
    normalizarAnticipacionRecordatorio,
    normalizarCuposOfrecidos,
    normalizarPlazoAgendar,
    operacionHisDelEvento,
    validarPlazoAgendar,
} from '@agenia/shared';

const DEFAULT_BOT_NAME = 'AgenIA';

export type CommStyle = 'FORMAL' | 'INFORMAL';

export async function getMyOrgSettings() {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') throw new Error('Acceso denegado');

    const s = await prisma.organizationSettings.findUnique({
        where: { organizationId: session.organizationId! },
        select: {
            botName: true,
            communicationStyle: true,
            slotsOfferedCount: true,
            remindersEnabled: true,
            remindersOnlySelfBooked: true,
            reminderMinLeadMinutes: true,
            bookingEnabled: true,
            cancelEnabled: true,
            rescheduleEnabled: true,
            bookingMaxDaysAhead: true,
            organization: { select: { timezone: true } },
        },
    });
    return {
        botName: s?.botName ?? DEFAULT_BOT_NAME,
        communicationStyle: (s?.communicationStyle ?? 'FORMAL') as CommStyle,
        slotsOfferedCount: normalizarCuposOfrecidos(s?.slotsOfferedCount),
        // Sin fila de settings = prendido, igual que el default de la columna y
        // que la consulta del cron.
        remindersEnabled: s?.remindersEnabled ?? true,
        // Sin fila = apagada (el default de la columna): recordatorio a todas.
        remindersOnlySelfBooked: s?.remindersOnlySelfBooked ?? false,
        // Sin fila = 60 minutos (el default de la columna y del cron).
        reminderMinLeadMinutes: normalizarAnticipacionRecordatorio(s?.reminderMinLeadMinutes),
        // Igual: sin fila = el bot agenda, cancela y cambia (default de las columnas).
        bookingEnabled: s?.bookingEnabled ?? true,
        cancelEnabled: s?.cancelEnabled ?? true,
        rescheduleEnabled: s?.rescheduleEnabled ?? true,
        // Sin fila (o sin valor) = sin límite, lo de siempre.
        bookingMaxDaysAhead: normalizarPlazoAgendar(s?.bookingMaxDaysAhead),
        // «Hoy» en la zona de la clínica: el panel muestra con fechas reales
        // hasta qué día ofrece citas el asistente.
        hoyEnLaClinica: diaLocal(new Date(), s?.organization?.timezone || undefined),
    };
}

/**
 * Prende o apaga los recordatorios automáticos de la clínica. Va aparte de
 * `updateMyOrgSettings` porque el interruptor guarda al instante (no espera
 * al botón «Guardar») y el cron lo lee en su siguiente vuelta.
 */
export async function setMyRemindersEnabled(enabled: boolean) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    // `=== true`: la server action se puede llamar con cualquier cosa; lo que
    // no sea exactamente `true` apaga (falla hacia no escribirle a nadie).
    const remindersEnabled = enabled === true;
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, remindersEnabled },
            update: { remindersEnabled },
        });
        revalidatePath('/dashboard/configuracion');
        return { success: true, remindersEnabled };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Prende o apaga «recordatorios solo a pacientes que agendaron ellos mismos»:
 * encendida, el recordatorio automático solo sale para las citas que el
 * paciente se agendó por el chat (WhatsApp o Telegram). Guarda al instante,
 * como el interruptor general; el cron lo lee en su siguiente vuelta. Solo
 * filtra el recordatorio automático: no toca ninguna otra operación.
 */
export async function setMyRemindersOnlySelfBooked(enabled: boolean) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    // `=== true`: lo que no sea exactamente `true` la apaga, que es el
    // comportamiento de siempre (recordatorio a todas las citas).
    const remindersOnlySelfBooked = enabled === true;
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, remindersOnlySelfBooked },
            update: { remindersOnlySelfBooked },
        });
        revalidatePath('/dashboard/configuracion');
        return { success: true, remindersOnlySelfBooked };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * ⏱️ Anticipación mínima del recordatorio automático, en minutos: si a la cita
 * le faltan menos, el cron no la recuerda (2026-10-17: recordatorios que llegaban
 * a 4 minutos de una cita agendada en el hospital minutos antes). 0 = sin mínimo.
 * Guarda al instante; el cron lo lee en su siguiente vuelta.
 */
export async function setMyReminderMinLead(minutos: number) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    // Un valor fuera de rango o inválido cae al default (60), nunca a «sin mínimo».
    const reminderMinLeadMinutes = normalizarAnticipacionRecordatorio(minutos);
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, reminderMinLeadMinutes },
            update: { reminderMinLeadMinutes },
        });
        revalidatePath('/dashboard/configuracion');
        return { success: true, reminderMinLeadMinutes };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * 🗓️ Plazo máximo para agendar por el asistente: hasta cuántos días adelante,
 * contando hoy, ofrece citas (con 3: hoy, mañana y pasado mañana). null = sin
 * límite. Guarda al instante; el bot lo lee cada vez que busca o confirma un
 * cupo. El personal y el hospital agendan a cualquier fecha.
 */
export async function setMyBookingMaxDaysAhead(dias: number | null) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    // Un valor inválido es un error, no «sin límite»: quien quiso poner 3 días
    // no debe quedar sin límite por un dato mal enviado.
    const v = validarPlazoAgendar(dias);
    if (!v.ok) return { success: false, error: v.error };
    const bookingMaxDaysAhead = v.dias;
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, bookingMaxDaysAhead },
            update: { bookingMaxDaysAhead },
        });
        revalidatePath('/dashboard/configuracion');
        return { success: true, bookingMaxDaysAhead };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Prende o apaga AGENDAR citas nuevas por el bot (y aceptar cupos de la lista
 * de espera). Cancelar y cambiar la fecha tienen su propio interruptor; con los
 * tres apagados el bot solo consulta. Guarda al instante, como el de
 * recordatorios; el bot lo lee en cada mensaje.
 */
export async function setMyBookingEnabled(enabled: boolean) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    // `=== true`: lo que no sea exactamente `true` apaga (falla hacia que el bot
    // no escriba en la agenda).
    const bookingEnabled = enabled === true;
    try {
        const antes = await prisma.organizationSettings.findUnique({
            where: { organizationId: session.organizationId! },
            select: { bookingEnabled: true },
        });
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, bookingEnabled },
            update: { bookingEnabled },
        });
        if (antes?.bookingEnabled !== bookingEnabled) {
            await auditarCompuertaHis({
                organizationId: session.organizationId!,
                actor: session.email ?? session.userId ?? 'desconocido',
                operacion: 'AGENDAR',
                encendido: bookingEnabled,
            });
        }
        revalidatePath('/dashboard/configuracion');
        return { success: true, bookingEnabled };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Prende o apaga CANCELAR citas por el bot. Guarda al instante y el bot lo lee
 * en cada mensaje.
 */
export async function setMyCancelEnabled(enabled: boolean) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    // `=== true`: lo que no sea exactamente `true` apaga (falla hacia que el bot
    // no toque la agenda).
    const cancelEnabled = enabled === true;
    try {
        const antes = await prisma.organizationSettings.findUnique({
            where: { organizationId: session.organizationId! },
            select: { cancelEnabled: true },
        });
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, cancelEnabled },
            update: { cancelEnabled },
        });
        if (antes?.cancelEnabled !== cancelEnabled) {
            await auditarCompuertaHis({
                organizationId: session.organizationId!,
                actor: session.email ?? session.userId ?? 'desconocido',
                operacion: 'CANCELAR',
                encendido: cancelEnabled,
            });
        }
        revalidatePath('/dashboard/configuracion');
        return { success: true, cancelEnabled };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * 🚪 Con espejo, «Agendar», «Cancelar» y «Cambiar fecha» son también la compuerta
 * de esa operación hacia el sistema del hospital (2026-10-15, `compuerta-his.ts`):
 * encendido, se hace por el asistente y desde el panel y llega al hospital;
 * apagado, no se puede hacer en AgenIA. Queda la constancia en la auditoría del
 * espejo, con cuántos cambios de ese tipo seguían en la cola en ese instante (lo
 * normal: 0; apagado, la base no deja crear más). Sin espejo no hay hospital al
 * que escribir: no se anota nada. Que la anotación falle no deshace el cambio
 * del interruptor.
 */
async function auditarCompuertaHis(p: {
    organizationId: string;
    actor: string;
    operacion: 'AGENDAR' | 'CANCELAR' | 'MODIFICAR';
    encendido: boolean;
}): Promise<void> {
    try {
        const espejo = await prisma.hospitalMirrorConfig.findUnique({
            where: { organizationId: p.organizationId },
            select: { enabled: true },
        });
        if (!espejo?.enabled) return;
        const pendientes = await prisma.syncOutbox.findMany({
            where: {
                organizationId: p.organizationId,
                deliveredAt: null,
                deadLettered: false,
                origin: { not: 'MIRROR' },
                entityType: 'APPOINTMENT',
                op: { in: ['INSERT', 'UPDATE'] },
            },
            select: { entityType: true, op: true, payload: true },
            take: 1000,
        });
        const enCola = pendientes.filter((e) => operacionHisDelEvento(e) === p.operacion).length;
        const nombre = { AGENDAR: 'Agendar citas', CANCELAR: 'Cancelar citas', MODIFICAR: 'Cambiar la fecha de una cita' }[
            p.operacion
        ];
        const queLlega = { AGENDAR: 'las citas nuevas', CANCELAR: 'las cancelaciones', MODIFICAR: 'los cambios de fecha' }[
            p.operacion
        ];
        await prisma.syncAudit.create({
            data: {
                organizationId: p.organizationId,
                direction: SYNC_AUDIT_DIRECTION.CONFIG,
                entityType: 'OrganizationSettings',
                op: { AGENDAR: 'BOOKING_ENABLED_CHANGE', CANCELAR: 'CANCEL_ENABLED_CHANGE', MODIFICAR: 'RESCHEDULE_ENABLED_CHANGE' }[
                    p.operacion
                ],
                outcome: 'OK',
                detail:
                    `«${nombre}» ${p.encendido ? 'ENCENDIDO' : 'APAGADO'} desde Configuración por ${p.actor}: ` +
                    (p.encendido
                        ? `${queLlega} (del asistente y del panel) llegan al sistema del hospital; `
                        : `${queLlega} ya no se pueden hacer en AgenIA (ni por el asistente ni desde el panel): se hacen en el sistema del hospital; `) +
                    `${enCola} en cola en ese momento.`,
            },
        });
    } catch (e) {
        console.error('[configuración] no se pudo anotar el cambio en la auditoría del espejo', {
            error: getErrorMessage(e),
        });
    }
}

/**
 * Prende o apaga CAMBIAR LA FECHA de una cita por el bot. Guarda al instante y
 * el bot lo lee en cada mensaje.
 */
export async function setMyRescheduleEnabled(enabled: boolean) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    const rescheduleEnabled = enabled === true;
    try {
        const antes = await prisma.organizationSettings.findUnique({
            where: { organizationId: session.organizationId! },
            select: { rescheduleEnabled: true },
        });
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, rescheduleEnabled },
            update: { rescheduleEnabled },
        });
        if (antes?.rescheduleEnabled !== rescheduleEnabled) {
            await auditarCompuertaHis({
                organizationId: session.organizationId!,
                actor: session.email ?? session.userId ?? 'desconocido',
                operacion: 'MODIFICAR',
                encendido: rescheduleEnabled,
            });
        }
        revalidatePath('/dashboard/configuracion');
        return { success: true, rescheduleEnabled };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

export async function updateMyOrgSettings(data: {
    botName: string;
    communicationStyle?: CommStyle;
    slotsOfferedCount?: number;
}) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    const botName = data.botName.trim() || DEFAULT_BOT_NAME;
    const communicationStyle: CommunicationStyle = data.communicationStyle === 'INFORMAL' ? 'INFORMAL' : 'FORMAL';
    // Se acota aquí (2-12) y no solo en el <input>: la server action se puede
    // llamar con cualquier número. El bot vuelve a acotar al leerlo.
    const slotsOfferedCount = normalizarCuposOfrecidos(data.slotsOfferedCount);
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, botName, communicationStyle, slotsOfferedCount },
            update: { botName, communicationStyle, slotsOfferedCount },
        });
        revalidatePath('/dashboard/configuracion');
        return { success: true };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

export async function getOrgSettingsForOrg(organizationId: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');

    const s = await prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { botName: true, communicationStyle: true },
    });
    return {
        botName: s?.botName ?? DEFAULT_BOT_NAME,
        communicationStyle: (s?.communicationStyle ?? 'FORMAL') as CommStyle,
    };
}

export async function updateOrgSettingsForOrg(
    organizationId: string,
    data: { botName: string; communicationStyle?: CommStyle },
) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') return { success: false, error: 'Acceso denegado' };

    const botName = data.botName.trim() || DEFAULT_BOT_NAME;
    const communicationStyle: CommunicationStyle = data.communicationStyle === 'INFORMAL' ? 'INFORMAL' : 'FORMAL';
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId },
            create: { organizationId, botName, communicationStyle },
            update: { botName, communicationStyle },
        });
        revalidatePath('/super-admin/organizations');
        return { success: true };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

'use server';

import { getSession } from '../../lib/session';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { CommunicationStyle } from '@agenia/database';
import { getErrorMessage } from '@/lib/error';
import { normalizarCuposOfrecidos } from '@agenia/shared';

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
            bookingEnabled: true,
        },
    });
    return {
        botName: s?.botName ?? DEFAULT_BOT_NAME,
        communicationStyle: (s?.communicationStyle ?? 'FORMAL') as CommStyle,
        slotsOfferedCount: normalizarCuposOfrecidos(s?.slotsOfferedCount),
        // Sin fila de settings = prendido, igual que el default de la columna y
        // que la consulta del cron.
        remindersEnabled: s?.remindersEnabled ?? true,
        // Igual: sin fila = el bot agenda, cancela y cambia (default de la columna).
        bookingEnabled: s?.bookingEnabled ?? true,
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
 * Prende o apaga lo que el paciente puede hacer por el bot (agendar, cancelar,
 * cambiar citas). Apagado, el bot solo consulta. Guarda al instante, como el de
 * recordatorios; el bot lo lee en cada mensaje.
 */
export async function setMyBookingEnabled(enabled: boolean) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    // `=== true`: lo que no sea exactamente `true` apaga (falla hacia que el bot
    // no escriba en la agenda).
    const bookingEnabled = enabled === true;
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, bookingEnabled },
            update: { bookingEnabled },
        });
        revalidatePath('/dashboard/configuracion');
        return { success: true, bookingEnabled };
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

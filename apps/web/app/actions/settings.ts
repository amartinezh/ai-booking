'use server';

import { getSession } from '../../lib/session';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { CommunicationStyle } from '@antigravity/database';

const DEFAULT_BOT_NAME = 'AgenIA';

export type CommStyle = 'FORMAL' | 'INFORMAL';

export async function getMyOrgSettings() {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') throw new Error('Acceso denegado');

    const s = await prisma.organizationSettings.findUnique({
        where: { organizationId: session.organizationId! },
        select: { botName: true, communicationStyle: true },
    });
    return {
        botName: s?.botName ?? DEFAULT_BOT_NAME,
        communicationStyle: (s?.communicationStyle ?? 'FORMAL') as CommStyle,
    };
}

export async function updateMyOrgSettings(data: { botName: string; communicationStyle?: CommStyle }) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    const botName = data.botName.trim() || DEFAULT_BOT_NAME;
    const communicationStyle: CommunicationStyle = data.communicationStyle === 'INFORMAL' ? 'INFORMAL' : 'FORMAL';
    try {
        await prisma.organizationSettings.upsert({
            where: { organizationId: session.organizationId! },
            create: { organizationId: session.organizationId!, botName, communicationStyle },
            update: { botName, communicationStyle },
        });
        revalidatePath('/dashboard/configuracion');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
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
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

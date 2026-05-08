'use server';

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

export async function getMyKnowledgeBase() {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') throw new Error('Acceso denegado');

    const org = await prisma.organization.findUnique({
        where: { id: session.organizationId! },
        select: { knowledgeBase: true },
    });
    return org?.knowledgeBase ?? '';
}

export async function updateMyKnowledgeBase(content: string) {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };

    try {
        await prisma.organization.update({
            where: { id: session.organizationId! },
            data: { knowledgeBase: content.trim() || null },
        });
        revalidatePath('/dashboard/conocimiento');
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

export async function getKnowledgeBaseForOrg(organizationId: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') throw new Error('Acceso denegado');

    const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { knowledgeBase: true },
    });
    return org?.knowledgeBase ?? '';
}

export async function updateKnowledgeBaseForOrg(organizationId: string, content: string) {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') return { success: false, error: 'Acceso denegado' };

    try {
        await prisma.organization.update({
            where: { id: organizationId },
            data: { knowledgeBase: content.trim() || null },
        });
        revalidatePath('/super-admin/organizations');
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

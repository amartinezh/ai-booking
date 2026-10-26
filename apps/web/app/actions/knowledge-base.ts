'use server';

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { getErrorMessage } from '@/lib/error';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';

const NUMERO = new Intl.NumberFormat('es-CO');

/** Editar la base de conocimiento: cuánto texto quedó (el texto completo está en la clínica). */
async function anotarConocimiento(
    session: { userId: string; email: string; role: string },
    organizationId: string,
    antes: string | null | undefined,
    despues: string | null,
): Promise<void> {
    if ((antes ?? null) === despues) return;
    const largo = (t: string | null | undefined) => (t ?? '').length;
    await registrarActividad({
        action: 'KNOWLEDGE_BASE_CHANGED',
        message: 'Base de conocimiento del asistente editada',
        actor: actorDeSesion(session),
        organizationId,
        metadata: {
            detalle: despues
                ? `${NUMERO.format(largo(antes))} → ${NUMERO.format(largo(despues))} caracteres`
                : 'La dejó vacía',
            antes: largo(antes),
            despues: largo(despues),
        },
    });
}

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
        const antes = await prisma.organization.findUnique({
            where: { id: session.organizationId! },
            select: { knowledgeBase: true },
        });
        const despues = content.trim() || null;
        await prisma.organization.update({
            where: { id: session.organizationId! },
            data: { knowledgeBase: despues },
        });
        await anotarConocimiento(session, session.organizationId!, antes?.knowledgeBase, despues);
        revalidatePath('/dashboard/conocimiento');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: getErrorMessage(e) };
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
        const antes = await prisma.organization.findUnique({ where: { id: organizationId }, select: { knowledgeBase: true } });
        const despues = content.trim() || null;
        await prisma.organization.update({
            where: { id: organizationId },
            data: { knowledgeBase: despues },
        });
        await anotarConocimiento(session, organizationId, antes?.knowledgeBase, despues);
        revalidatePath('/super-admin/organizations');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: getErrorMessage(e) };
    }
}

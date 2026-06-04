/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { SupportTicketStatus } from '@agenia/database';

const createSchema = z.object({
    title: z.string().min(5, 'El título debe tener al menos 5 caracteres').max(140, 'Máximo 140 caracteres'),
    description: z.string().min(15, 'Cuéntanos con un poco más de detalle (mín. 15 caracteres)'),
});

const resolutionSchema = z.object({
    resolutionNote: z.string().min(5, 'La nota de resolución es obligatoria (mín. 5 caracteres)'),
});

// ---------------------------------------------------------------------------
// USUARIO DE CLÍNICA — MIS TICKETS
// ---------------------------------------------------------------------------

export async function getMyTickets() {
    try {
        const session = await getSession();
        if (!session || session.role === 'SUPER_ADMIN') {
            return { success: false, error: 'Acceso denegado' as const };
        }

        const data = await prisma.supportTicket.findMany({
            where: { reporterId: session.userId },
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        });
        return { success: true as const, data };
    } catch (e) {
        console.error('Error fetching my tickets:', e);
        return { success: false as const, error: 'No se pudieron cargar tus solicitudes' };
    }
}

export async function createTicket(_prev: any, formData: FormData) {
    try {
        const session = await getSession();
        if (!session || !session.organizationId || session.role === 'SUPER_ADMIN') {
            return { success: false, error: 'Acceso denegado' };
        }

        const parsed = createSchema.safeParse({
            title: formData.get('title'),
            description: formData.get('description'),
        });

        if (!parsed.success) {
            return {
                success: false,
                error: 'Revisa el formulario',
                issues: parsed.error.flatten().fieldErrors,
            };
        }

        await prisma.supportTicket.create({
            data: {
                title: parsed.data.title,
                description: parsed.data.description,
                reporterId: session.userId,
                organizationId: session.organizationId,
            },
        });

        revalidatePath('/dashboard/soporte');
        revalidatePath('/super-admin/support');
        return { success: true };
    } catch (e) {
        console.error('Error creating ticket:', e);
        return { success: false, error: 'No se pudo crear la solicitud' };
    }
}

// ---------------------------------------------------------------------------
// SUPER ADMIN — VISTA GLOBAL CROSS-TENANT
// ---------------------------------------------------------------------------

export async function getSupportTicketsForAdmin(filter: 'active' | 'all' = 'active') {
    try {
        const session = await getSession();
        if (session?.role !== 'SUPER_ADMIN') {
            return { success: false as const, error: 'Acceso denegado' };
        }

        const where =
            filter === 'active'
                ? { status: { in: [SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS] } }
                : {};

        const data = await prisma.supportTicket.findMany({
            where,
            include: {
                reporter: { select: { email: true, role: true } },
                organization: { select: { id: true, name: true, logoUrl: true } },
            },
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        });
        return { success: true as const, data };
    } catch (e) {
        console.error('Error fetching admin tickets:', e);
        return { success: false as const, error: 'No se pudieron cargar los tickets' };
    }
}

export async function startTicketAttention(id: string) {
    try {
        const session = await getSession();
        if (session?.role !== 'SUPER_ADMIN') {
            return { success: false, error: 'Acceso denegado' };
        }

        const ticket = await prisma.supportTicket.findUnique({ where: { id } });
        if (!ticket) return { success: false, error: 'Ticket no encontrado' };
        if (ticket.status !== SupportTicketStatus.OPEN) {
            return { success: false, error: 'El ticket ya fue tomado o resuelto' };
        }

        await prisma.supportTicket.update({
            where: { id },
            data: {
                status: SupportTicketStatus.IN_PROGRESS,
                startedAt: new Date(),
            },
        });

        revalidatePath('/super-admin/support');
        revalidatePath('/dashboard/soporte');
        return { success: true };
    } catch (e) {
        console.error('Error starting ticket:', e);
        return { success: false, error: 'No se pudo iniciar la atención' };
    }
}

export async function resolveTicket(id: string, _prev: any, formData: FormData) {
    try {
        const session = await getSession();
        if (session?.role !== 'SUPER_ADMIN') {
            return { success: false, error: 'Acceso denegado' };
        }

        const parsed = resolutionSchema.safeParse({
            resolutionNote: formData.get('resolutionNote'),
        });
        if (!parsed.success) {
            return {
                success: false,
                error: 'Revisa el formulario',
                issues: parsed.error.flatten().fieldErrors,
            };
        }

        const ticket = await prisma.supportTicket.findUnique({ where: { id } });
        if (!ticket) return { success: false, error: 'Ticket no encontrado' };

        await prisma.supportTicket.update({
            where: { id },
            data: {
                status: SupportTicketStatus.RESOLVED,
                resolutionNote: parsed.data.resolutionNote,
                resolvedAt: new Date(),
                // Si por alguna razón se marca solucionado sin pasar por IN_PROGRESS, dejamos rastro
                startedAt: ticket.startedAt ?? new Date(),
            },
        });

        revalidatePath('/super-admin/support');
        revalidatePath('/dashboard/soporte');
        return { success: true };
    } catch (e) {
        console.error('Error resolving ticket:', e);
        return { success: false, error: 'No se pudo marcar como solucionado' };
    }
}

export async function updateResolutionNote(id: string, _prev: any, formData: FormData) {
    try {
        const session = await getSession();
        if (session?.role !== 'SUPER_ADMIN') {
            return { success: false, error: 'Acceso denegado' };
        }

        const parsed = resolutionSchema.safeParse({
            resolutionNote: formData.get('resolutionNote'),
        });
        if (!parsed.success) {
            return {
                success: false,
                error: 'Revisa el formulario',
                issues: parsed.error.flatten().fieldErrors,
            };
        }

        const ticket = await prisma.supportTicket.findUnique({ where: { id } });
        if (!ticket) return { success: false, error: 'Ticket no encontrado' };
        if (ticket.status !== SupportTicketStatus.RESOLVED) {
            return { success: false, error: 'Solo se puede editar la respuesta de tickets ya solucionados' };
        }

        await prisma.supportTicket.update({
            where: { id },
            data: { resolutionNote: parsed.data.resolutionNote },
        });

        revalidatePath('/super-admin/support');
        revalidatePath('/dashboard/soporte');
        return { success: true };
    } catch (e) {
        console.error('Error updating resolution:', e);
        return { success: false, error: 'No se pudo actualizar la respuesta' };
    }
}

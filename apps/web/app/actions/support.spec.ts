import { SupportTicketStatus } from '@agenia/database';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        supportTicket: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { startTicketAttention, resolveTicket, updateResolutionNote } from './support';

const mockGetSession = getSession as jest.Mock;
const mockFindUnique = prisma.supportTicket.findUnique as jest.Mock;
const mockUpdate = prisma.supportTicket.update as jest.Mock;

function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
}

describe('tickets de soporte — máquina de estados (solo SUPER_ADMIN)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('startTicketAttention rechaza a quien no es SUPER_ADMIN', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN' });
        const res = await startTicketAttention('t1');
        expect(res.success).toBe(false);
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('startTicketAttention rechaza un ticket que ya no está OPEN', async () => {
        mockGetSession.mockResolvedValue({ role: 'SUPER_ADMIN' });
        mockFindUnique.mockResolvedValue({ id: 't1', status: SupportTicketStatus.IN_PROGRESS });

        const res = await startTicketAttention('t1');

        expect(res).toEqual({ success: false, error: 'El ticket ya fue tomado o resuelto' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('startTicketAttention mueve un ticket OPEN a IN_PROGRESS', async () => {
        mockGetSession.mockResolvedValue({ role: 'SUPER_ADMIN' });
        mockFindUnique.mockResolvedValue({ id: 't1', status: SupportTicketStatus.OPEN });
        mockUpdate.mockResolvedValue({});

        const res = await startTicketAttention('t1');

        expect(res).toEqual({ success: true });
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: SupportTicketStatus.IN_PROGRESS }) }),
        );
    });

    it('resolveTicket rechaza si la nota de resolución no pasa la validación', async () => {
        mockGetSession.mockResolvedValue({ role: 'SUPER_ADMIN' });

        const res = await resolveTicket('t1', undefined, formData({ resolutionNote: 'no' }));

        expect(res.success).toBe(false);
        expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('resolveTicket marca RESOLVED y conserva startedAt si ya existía', async () => {
        mockGetSession.mockResolvedValue({ role: 'SUPER_ADMIN' });
        const startedAt = new Date('2026-01-01T00:00:00Z');
        mockFindUnique.mockResolvedValue({ id: 't1', status: SupportTicketStatus.IN_PROGRESS, startedAt });
        mockUpdate.mockResolvedValue({});

        const res = await resolveTicket('t1', undefined, formData({ resolutionNote: 'Se reinició el servicio.' }));

        expect(res).toEqual({ success: true });
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: SupportTicketStatus.RESOLVED, startedAt }),
            }),
        );
    });

    it('updateResolutionNote rechaza editar la nota de un ticket que no está RESOLVED', async () => {
        mockGetSession.mockResolvedValue({ role: 'SUPER_ADMIN' });
        mockFindUnique.mockResolvedValue({ id: 't1', status: SupportTicketStatus.IN_PROGRESS });

        const res = await updateResolutionNote('t1', undefined, formData({ resolutionNote: 'Nueva nota válida.' }));

        expect(res).toEqual({
            success: false,
            error: 'Solo se puede editar la respuesta de tickets ya solucionados',
        });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('updateResolutionNote permite editar la nota de un ticket ya RESOLVED', async () => {
        mockGetSession.mockResolvedValue({ role: 'SUPER_ADMIN' });
        mockFindUnique.mockResolvedValue({ id: 't1', status: SupportTicketStatus.RESOLVED });
        mockUpdate.mockResolvedValue({});

        const res = await updateResolutionNote('t1', undefined, formData({ resolutionNote: 'Nota corregida.' }));

        expect(res).toEqual({ success: true });
    });
});

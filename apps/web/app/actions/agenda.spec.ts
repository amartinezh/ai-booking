import { Prisma } from '@agenia/database';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        doctorProfile: { findFirst: jest.fn() },
        scheduleSlot: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { generateBulkSlots, deleteSlot } from './agenda';

const mockGetSession = getSession as jest.Mock;
const mockDoctorFindFirst = prisma.doctorProfile.findFirst as jest.Mock;
const mockSlotCreate = prisma.scheduleSlot.create as jest.Mock;
const mockSlotFindFirst = prisma.scheduleSlot.findFirst as jest.Mock;
const mockSlotDelete = prisma.scheduleSlot.delete as jest.Mock;

function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
}

function p2002() {
    return new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2002', clientVersion: '5.0.0' });
}

describe('generateBulkSlots — colisiones (P2002) se omiten, no abortan el lote', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetSession.mockResolvedValue({ organizationId: 'org-1' });
        mockDoctorFindFirst.mockResolvedValue({ id: 'doc-1', serviceId: 'svc-1' });
    });

    const bulkForm = () =>
        formData({
            doctorId: 'doc-1',
            epsId: 'none',
            date: '2026-06-03',
            startTime: '08:00',
            endTime: '09:00',
            durationMinutes: '30',
        });

    it('cuenta un cupo colisionado (P2002) como omitido, sin lanzar', async () => {
        mockSlotCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(p2002());

        const res = await generateBulkSlots(bulkForm());

        expect(res.success).toBe(true);
        expect(res.message).toContain('Se abrieron 1 cupos');
        expect(res.message).toContain('1 colisiones omitidas');
    });

    it('propaga un error Prisma que NO es P2002 (no lo trata como colisión)', async () => {
        mockSlotCreate.mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError('fk violation', { code: 'P2003', clientVersion: '5.0.0' }),
        );

        const res = await generateBulkSlots(bulkForm());

        expect(res).toEqual({ success: false, error: 'Error crítico de servidor al generar slots' });
    });

    it('rechaza sin doctor con servicio configurado', async () => {
        mockDoctorFindFirst.mockResolvedValue({ id: 'doc-1', serviceId: null });

        const res = await generateBulkSlots(bulkForm());

        expect(res).toEqual({ success: false, error: 'Médico inválido o sin servicio configurado' });
        expect(mockSlotCreate).not.toHaveBeenCalled();
    });
});

describe('deleteSlot — no se puede borrar un cupo con una cita vigente', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetSession.mockResolvedValue({ organizationId: 'org-1' });
    });

    it('bloquea el borrado si el slot tiene una cita no cancelada', async () => {
        mockSlotFindFirst.mockResolvedValue({ id: 'slot-1', appointments: [{ id: 'apt-1' }] });

        const res = await deleteSlot('slot-1');

        expect(res.success).toBe(false);
        expect(mockSlotDelete).not.toHaveBeenCalled();
    });

    it('permite el borrado si el slot no tiene citas vigentes (canceladas no cuentan)', async () => {
        mockSlotFindFirst.mockResolvedValue({ id: 'slot-1', appointments: [] });
        mockSlotDelete.mockResolvedValue({});

        const res = await deleteSlot('slot-1');

        expect(res).toEqual({ success: true });
        expect(mockSlotDelete).toHaveBeenCalled();
    });
});

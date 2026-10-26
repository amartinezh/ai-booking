import { Prisma } from '@agenia/database';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        doctorProfile: { findFirst: jest.fn() },
        scheduleSlot: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
        eps: { findFirst: jest.fn() },
        systemLog: { create: jest.fn().mockResolvedValue({}) },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { generateBulkSlots, deleteSlot, cloneDaySlots } from './agenda';

const mockGetSession = getSession as jest.Mock;
const mockDoctorFindFirst = prisma.doctorProfile.findFirst as jest.Mock;
const mockSlotCreate = prisma.scheduleSlot.create as jest.Mock;
const mockSlotFindFirst = prisma.scheduleSlot.findFirst as jest.Mock;
const mockSlotDelete = prisma.scheduleSlot.delete as jest.Mock;
const mockSlotFindMany = prisma.scheduleSlot.findMany as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;

const ADMIN = { organizationId: 'org-1', role: 'ORG_ADMIN', userId: 'admin-1', email: 'admin@clinica.co' };

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
        mockGetSession.mockResolvedValue(ADMIN);
        mockDoctorFindFirst.mockResolvedValue({ id: 'doc-1', serviceId: 'svc-1', fullName: 'Dra. Pérez', service: { name: 'Medicina general' } });
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
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'SLOTS_GENERATED', userId: 'admin-1', organizationId: 'org-1' });
        expect(d.metadata.detalle).toBe(
            'Dra. Pérez (Medicina general) · 2026-06-03 de 08:00 a 09:00, cada 30 min · 1 cupo(s) abierto(s), 1 ya existían',
        );
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
        mockGetSession.mockResolvedValue(ADMIN);
    });

    it('bloquea el borrado si el slot tiene una cita no cancelada', async () => {
        mockSlotFindFirst.mockResolvedValue({ id: 'slot-1', appointments: [{ id: 'apt-1' }] });

        const res = await deleteSlot('slot-1');

        expect(res.success).toBe(false);
        expect(mockSlotDelete).not.toHaveBeenCalled();
    });

    it('permite el borrado si el slot no tiene citas vigentes (canceladas no cuentan)', async () => {
        mockSlotFindFirst.mockResolvedValue({
            id: 'slot-1',
            appointments: [],
            startTime: new Date('2026-10-28T13:20:00Z'),
            doctor: { fullName: 'Dra. Pérez' },
            service: { name: 'Medicina general' },
        });
        mockSlotDelete.mockResolvedValue({});

        const res = await deleteSlot('slot-1');

        expect(res).toEqual({ success: true });
        expect(mockSlotDelete).toHaveBeenCalled();
        const d = mockLog.mock.calls[0][0].data;
        expect(d.action).toBe('SLOT_DELETED');
        // La hora de Bogotá (13:20 UTC = 8:20 a. m.).
        expect(d.metadata.detalle).toMatch(/^Medicina general · Dra\. Pérez · 28\/10\/2026 08:20/);
    });
});

describe('Agendas — solo el administrador (2026-10-27)', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each(['BOOKING_AGENT', 'DOCTOR', 'PATIENT', 'GENERAL_OBSERVER'])('un %s no abre, copia ni borra cupos', async (role) => {
        mockGetSession.mockResolvedValue({ ...ADMIN, role });
        const abrir = await generateBulkSlots(
            formData({ doctorId: 'doc-1', epsId: 'none', date: '2026-06-03', startTime: '08:00', endTime: '09:00', durationMinutes: '30' }),
        );
        const copiar = await cloneDaySlots(formData({ doctorId: 'doc-1', sourceDate: '2026-06-03', targetDate: '2026-06-04' }));
        const borrar = await deleteSlot('slot-1');
        for (const r of [abrir, copiar, borrar]) expect(r.success).toBe(false);
        expect(mockSlotCreate).not.toHaveBeenCalled();
        expect(mockSlotDelete).not.toHaveBeenCalled();
        expect(mockSlotFindMany).not.toHaveBeenCalled();
    });

    it('copiar un día queda registrado con el médico y las fechas', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockSlotFindMany.mockResolvedValue([
            { doctorId: 'doc-1', serviceId: 'svc-1', allowedEpsId: null, startTime: new Date('2026-06-03T13:00:00Z'), endTime: new Date('2026-06-03T13:30:00Z') },
        ]);
        mockSlotCreate.mockResolvedValue({});
        mockDoctorFindFirst.mockResolvedValue({ fullName: 'Dra. Pérez' });
        const r = await cloneDaySlots(formData({ doctorId: 'doc-1', sourceDate: '2026-06-03', targetDate: '2026-06-04' }));
        expect(r.success).toBe(true);
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'SLOTS_CLONED', userId: 'admin-1' });
        expect(d.metadata.detalle).toBe('Dra. Pérez · 2026-06-03 → 2026-06-04 · 1 de 1 cupo(s) copiado(s)');
    });
});

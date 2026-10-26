import { Prisma } from '@agenia/database';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        eps: {
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            findFirst: jest.fn(),
            delete: jest.fn(),
        },
        systemLog: { create: jest.fn().mockResolvedValue({}) },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { createEps, updateEps, getEpsList, deleteEps, toggleEpsStatus } from './eps';

const mockGetSession = getSession as jest.Mock;
const mockCreate = prisma.eps.create as jest.Mock;
const mockUpdate = prisma.eps.update as jest.Mock;
const mockFindMany = prisma.eps.findMany as jest.Mock;
const mockFindFirst = prisma.eps.findFirst as jest.Mock;
const mockDelete = prisma.eps.delete as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;

const ADMIN = { organizationId: 'org-1', role: 'ORG_ADMIN', userId: 'admin-1', email: 'admin@clinica.co' };

function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
}

function prismaKnownError(code: string) {
    return new Prisma.PrismaClientKnownRequestError('conflict', {
        code,
        clientVersion: '5.0.0',
    });
}

describe('eps actions — aislamiento por tenant', () => {
    beforeEach(() => jest.clearAllMocks());

    it('getEpsList rechaza sin organizationId en sesión', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await getEpsList();
        expect(res).toEqual({ success: false, error: 'Tenant inválido' });
        expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('getEpsList consulta solo dentro del organizationId de la sesión', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindMany.mockResolvedValue([]);
        await getEpsList();
        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }),
        );
    });

    it('createEps rechaza sin sesión de organización', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await createEps(undefined, formData({ name: 'Sanitas', nit: '' }));
        expect(res).toEqual({ success: false, error: 'Solo el administrador de la clínica puede gestionar las EPS.' });
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('createEps rechaza datos inválidos sin llegar a Prisma', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        const res = await createEps(undefined, formData({ name: 'A', nit: '' }));
        expect(res.success).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

describe('eps actions — manejo de colisión P2002', () => {
    beforeEach(() => jest.clearAllMocks());

    it('createEps traduce P2002 a un mensaje de negocio (nombre/NIT duplicado)', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockCreate.mockRejectedValue(prismaKnownError('P2002'));

        const res = await createEps(undefined, formData({ name: 'Sanitas', nit: '' }));

        expect(res).toEqual({
            success: false,
            error: 'Ya existe una EPS con ese nombre o NIT en esta clínica.',
        });
    });

    it('updateEps traduce P2002 a un mensaje de negocio', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockUpdate.mockRejectedValue(prismaKnownError('P2002'));

        const res = await updateEps('eps-1', undefined, formData({ name: 'Sanitas', nit: '' }));

        expect(res).toEqual({
            success: false,
            error: 'Ya existe una EPS con ese nombre o NIT en esta clínica.',
        });
    });

    it('createEps no confunde otros códigos Prisma con P2002', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockCreate.mockRejectedValue(prismaKnownError('P2025'));

        const res = await createEps(undefined, formData({ name: 'Sanitas', nit: '' }));

        expect(res).toEqual({ success: false, error: 'Ocurrió un error al crear la EPS' });
    });

    it('createEps no confunde un error genérico (no-Prisma) con P2002', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockCreate.mockRejectedValue(new Error('DB desconectada'));

        const res = await createEps(undefined, formData({ name: 'Sanitas', nit: '' }));

        expect(res).toEqual({ success: false, error: 'Ocurrió un error al crear la EPS' });
    });
});

describe('deleteEps — protege registros con pacientes/citas asociadas', () => {
    beforeEach(() => jest.clearAllMocks());

    it('bloquea el borrado si la EPS tiene pacientes o citas asociadas', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindFirst.mockResolvedValue({
            id: 'eps-1',
            _count: { patients: 2, appointments: 0 },
        });

        const res = await deleteEps('eps-1');

        expect(res.success).toBe(false);
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it('permite el borrado cuando no tiene pacientes ni citas', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindFirst.mockResolvedValue({
            id: 'eps-1',
            name: 'Sanitas',
            nit: null,
            _count: { patients: 0, appointments: 0 },
        });
        mockDelete.mockResolvedValue({});

        const res = await deleteEps('eps-1');

        expect(res).toEqual({ success: true });
        expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'eps-1' } });
        expect(mockLog.mock.calls[0][0].data).toMatchObject({
            action: 'EPS_DELETED',
            level: 'WARNING',
            userId: 'admin-1',
            organizationId: 'org-1',
        });
    });
});

describe('EPS — solo el administrador, y cada cambio en la Actividad de usuarios (2026-10-27)', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each(['BOOKING_AGENT', 'DOCTOR', 'PATIENT'])('un %s no crea, cambia ni borra EPS', async (role) => {
        mockGetSession.mockResolvedValue({ ...ADMIN, role });
        expect((await createEps(undefined, formData({ name: 'Sanitas', nit: '' }))).success).toBe(false);
        expect((await updateEps('eps-1', undefined, formData({ name: 'Sanitas', nit: '' }))).success).toBe(false);
        expect((await toggleEpsStatus('eps-1', true)).success).toBe(false);
        expect((await deleteEps('eps-1')).success).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it('crear e inactivar quedan registrados con quién lo hizo', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockCreate.mockResolvedValue({ id: 'eps-9', name: 'Sanitas', nit: '800251440', isActive: true });
        await createEps(undefined, formData({ name: 'Sanitas', nit: '800251440', isActive: 'on' }));
        mockUpdate.mockResolvedValue({ name: 'Sanitas', isActive: false });
        await toggleEpsStatus('eps-9', true);

        const [creada, inactivada] = mockLog.mock.calls.map((c) => c[0].data);
        expect(creada).toMatchObject({ action: 'EPS_CREATED', userId: 'admin-1' });
        expect(creada.metadata.detalle).toBe('«Sanitas» · NIT 800251440');
        expect(inactivada).toMatchObject({ action: 'EPS_DEACTIVATED', level: 'WARNING' });
    });

    it('modificar dice qué cambió', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindFirst.mockResolvedValue({ name: 'Sanitas', nit: null, isActive: true });
        mockUpdate.mockResolvedValue({});
        await updateEps('eps-1', undefined, formData({ name: 'Sanitas EPS', nit: '800251440', isActive: 'on' }));
        expect(mockLog.mock.calls[0][0].data.metadata.detalle).toBe(
            '«Sanitas EPS»: nombre: Sanitas → Sanitas EPS · NIT: — → 800251440',
        );
    });
});

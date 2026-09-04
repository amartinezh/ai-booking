jest.mock('@/lib/prisma', () => ({
    prisma: { appointment: { update: jest.fn() } },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { updateAttendance } from './dashboard';

const mockGetSession = getSession as jest.Mock;
const mockUpdate = prisma.appointment.update as jest.Mock;

describe('updateAttendance — scoping por tenant', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rechaza a un rol sin permiso (PATIENT)', async () => {
        mockGetSession.mockResolvedValue({ role: 'PATIENT', organizationId: 'org-1' });

        const res = await updateAttendance('apt-1', 'ATTENDED');

        expect(res.success).toBe(false);
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('un ORG_ADMIN solo puede actualizar dentro de su propia organización', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpdate.mockResolvedValue({});

        await updateAttendance('apt-1', 'ATTENDED');

        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'apt-1', organizationId: 'org-1' } }),
        );
    });

    it('un SUPER_ADMIN puede actualizar sin quedar limitado a un organizationId', async () => {
        mockGetSession.mockResolvedValue({ role: 'SUPER_ADMIN', organizationId: null });
        mockUpdate.mockResolvedValue({});

        await updateAttendance('apt-1', 'ATTENDED');

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'apt-1' } }));
    });

    it('devuelve error genérico si Prisma falla, sin filtrar detalles internos', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpdate.mockRejectedValue(new Error('connection refused'));

        const res = await updateAttendance('apt-1', 'ATTENDED');

        expect(res).toEqual({ success: false, error: 'Error actualizando asistencia' });
    });
});

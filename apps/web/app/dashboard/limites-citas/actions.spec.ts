jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { upsert: jest.fn(), findUnique: jest.fn(async () => null) },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { guardarLimitesCitas } from './actions';

const mockSession = getSession as jest.Mock;
const upsert = prisma.organizationSettings.upsert as jest.Mock;
const LIMITES = { diaActivo: true, maxDia: 2, mesActivo: true, maxMes: 4 };

/** El límite de citas lo fija solo el administrador (2026-10-22). */
describe('guardarLimitesCitas', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each(['BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER'] as const)('%s no lo puede cambiar', async (role) => {
        mockSession.mockResolvedValue({ role, organizationId: 'org-1', email: 'x@y.co' });
        const r = await guardarLimitesCitas(LIMITES);
        expect(r).toEqual({ success: false, error: 'Acceso denegado' });
        expect(upsert).not.toHaveBeenCalled();
    });

    it('el administrador sí, en su clínica', async () => {
        mockSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@y.co' });
        upsert.mockResolvedValue({});
        const r = await guardarLimitesCitas(LIMITES);
        expect(r.success).toBe(true);
        expect(upsert.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
    });
});

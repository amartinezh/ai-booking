jest.mock('../../../lib/prisma', () => ({
    prisma: {
        user: { findFirst: jest.fn(), delete: jest.fn() },
        $transaction: jest.fn(),
    },
}));
jest.mock('../../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { saveUserAction } from './actions';

const mockGetSession = getSession as jest.Mock;
const mockFindFirst = prisma.user.findFirst as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;

function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
}

// Doble de `tx` dentro de `$transaction`: solo lo que `saveUserAction` usa.
function fakeTx() {
    return {
        user: { update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({ id: 'new-user-1' }) },
        agentProfile: {
            upsert: jest.fn().mockResolvedValue({}),
            create: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({}),
        },
    };
}

describe('saveUserAction — organizationId en AgentProfile (aislamiento multi-tenant)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('modo edición: crear un AgentProfile nuevo (upsert.create) para un usuario existente incluye organizationId', async () => {
        mockGetSession.mockResolvedValue({ organizationId: 'org-1' });
        mockFindFirst.mockResolvedValue({ id: 'user-1' });
        const tx = fakeTx();
        mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

        const res = await saveUserAction(
            formData({ id: 'user-1', email: 'a@b.com', role: 'BOOKING_AGENT', agentFullName: 'Ana' }),
        );

        expect(res.success).toBe(true);
        expect(tx.agentProfile.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
            }),
        );
    });

    it('modo creación: el AgentProfile del usuario nuevo incluye organizationId', async () => {
        mockGetSession.mockResolvedValue({ organizationId: 'org-1' });
        const tx = fakeTx();
        mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

        const res = await saveUserAction(
            formData({ email: 'nuevo@b.com', role: 'BOOKING_AGENT', agentFullName: 'Nuevo Agente' }),
        );

        expect(res.success).toBe(true);
        expect(tx.agentProfile.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ organizationId: 'org-1', userId: 'new-user-1' }),
            }),
        );
    });

    it('rechaza sin organizationId en sesión, sin abrir transacción', async () => {
        mockGetSession.mockResolvedValue(null);

        const res = await saveUserAction(formData({ email: 'a@b.com', role: 'PATIENT' }));

        expect(res).toEqual({ success: false, error: 'Contexto de Clínica no encontrado' });
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('modo edición: rechaza si el usuario no existe en el tenant de la sesión', async () => {
        mockGetSession.mockResolvedValue({ organizationId: 'org-1' });
        mockFindFirst.mockResolvedValue(null);

        const res = await saveUserAction(formData({ id: 'user-ajeno', email: 'a@b.com', role: 'PATIENT' }));

        expect(res.success).toBe(false);
        expect(mockTransaction).not.toHaveBeenCalled();
    });
});

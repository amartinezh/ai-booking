/**
 * @jest-environment node
 *
 * Route Handler de Next: necesita el Request/Response del entorno Node (ver
 * app/api/padron/validate/route.spec.ts).
 */
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { getSession } from '../../../../../lib/session';
import { prisma } from '../../../../../lib/prisma';

jest.mock('../../../../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('../../../../../lib/prisma', () => ({
    prisma: {
        interactionLog: { findUnique: jest.fn(), update: jest.fn() },
    },
}));

const mockSession = getSession as jest.Mock;
const findUnique = prisma.interactionLog.findUnique as jest.Mock;
const update = prisma.interactionLog.update as jest.Mock;

const req = (body: unknown = { notes: 'Llamado, reagenda el jueves' }) =>
    ({ json: async () => body }) as unknown as NextRequest;
const params = { params: Promise.resolve({ id: 'log-1' }) };

/** Marcar como contactado (Caja Negra): ORG_ADMIN y BOOKING_AGENT, y solo de su clínica. */
describe('POST /dashboard/auditoria/[id]/contactar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        findUnique.mockResolvedValue({ id: 'log-1', organizationId: 'org-1' });
        update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'log-1', ...data }));
    });

    it.each(['ORG_ADMIN', 'BOOKING_AGENT'])('%s marca el contacto con su correo y la nota', async (role) => {
        mockSession.mockResolvedValue({ role, organizationId: 'org-1', email: 'agenda@hsvp.co' });

        const res = await POST(req(), params);

        expect(res.status).toBe(200);
        expect(update).toHaveBeenCalledWith({
            where: { id: 'log-1' },
            data: expect.objectContaining({
                contactedBy: 'agenda@hsvp.co',
                contactNotes: 'Llamado, reagenda el jueves',
                contactedAt: expect.any(Date),
            }),
        });
    });

    it.each(['DOCTOR', 'PATIENT', 'GENERAL_OBSERVER'])(
        '🛡️ %s no puede marcar contactos (antes bastaba cualquier sesión)',
        async (role) => {
            mockSession.mockResolvedValue({ role, organizationId: 'org-1', email: 'x@x.co' });

            const res = await POST(req(), params);

            expect(res.status).toBe(403);
            expect(update).not.toHaveBeenCalled();
        },
    );

    it('sin sesión → 401', async () => {
        mockSession.mockResolvedValue(null);

        const res = await POST(req(), params);

        expect(res.status).toBe(401);
        expect(update).not.toHaveBeenCalled();
    });

    it('🛡️ una conversación de OTRA clínica no se toca', async () => {
        mockSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1', email: 'x@x.co' });
        findUnique.mockResolvedValue({ id: 'log-1', organizationId: 'org-2' });

        const res = await POST(req(), params);

        expect(res.status).toBe(403);
        expect(update).not.toHaveBeenCalled();
    });
});

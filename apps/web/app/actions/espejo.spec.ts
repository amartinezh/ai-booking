jest.mock('@/lib/prisma', () => ({
    prisma: {
        hospitalMirrorConfig: { findUnique: jest.fn(), update: jest.fn() },
        syncOutbox: { count: jest.fn() },
        syncAudit: { create: jest.fn() },
        $transaction: jest.fn(),
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { cambiarEnvioAlHospital } from './espejo';

const mockGetSession = getSession as jest.Mock;
const mockFindUnique = prisma.hospitalMirrorConfig.findUnique as jest.Mock;
const mockUpdate = prisma.hospitalMirrorConfig.update as jest.Mock;
const mockAudit = prisma.syncAudit.create as jest.Mock;
const mockCount = prisma.syncOutbox.count as jest.Mock;
const mockTx = prisma.$transaction as jest.Mock;

const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@hospital.co', userId: 'u-1' };

/** Interruptor del envío de AgenIA hacia el sistema del hospital (pushEnabled). */
describe('espejo — envío al hospital', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdate.mockReturnValue('update-op');
        mockAudit.mockReturnValue('audit-op');
        mockTx.mockResolvedValue([]);
        mockCount.mockResolvedValue(0);
    });

    it('solo el ORG_ADMIN lo cambia', async () => {
        mockGetSession.mockResolvedValue({ ...ADMIN, role: 'BOOKING_AGENT' });
        const res = await cambiarEnvioAlHospital(false);
        expect(res).toEqual({ success: false, error: 'Sin permisos.' });
        expect(mockTx).not.toHaveBeenCalled();
    });

    it('apaga en la clínica de la sesión y deja constancia en la auditoría, en la misma transacción', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ pushEnabled: true });
        mockCount.mockResolvedValue(3);

        const res = await cambiarEnvioAlHospital(false);

        expect(res).toEqual({ success: true });
        expect(mockUpdate).toHaveBeenCalledWith({
            where: { organizationId: 'org-1' },
            data: { pushEnabled: false },
        });
        const audit = mockAudit.mock.calls[0][0].data;
        expect(audit).toMatchObject({
            organizationId: 'org-1',
            direction: 'CONFIG',
            op: 'PUSH_ENABLED_CHANGE',
        });
        expect(audit.detail).toContain('APAGADO');
        expect(audit.detail).toContain('admin@hospital.co');
        expect(audit.detail).toContain('3 evento(s) en cola');
        expect(mockTx).toHaveBeenCalledWith(['update-op', 'audit-op']);
    });

    it('lo que no sea exactamente true apaga (falla hacia no escribir en el hospital)', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ pushEnabled: true });

        await cambiarEnvioAlHospital('true' as unknown as boolean);

        expect(mockUpdate.mock.calls[0][0].data).toEqual({ pushEnabled: false });
    });

    it('encender también queda auditado', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ pushEnabled: false });

        await cambiarEnvioAlHospital(true);

        expect(mockUpdate.mock.calls[0][0].data).toEqual({ pushEnabled: true });
        expect(mockAudit.mock.calls[0][0].data.detail).toContain('ENCENDIDO');
    });

    it('sin cambio real no escribe ni audita', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ pushEnabled: false });

        expect(await cambiarEnvioAlHospital(false)).toEqual({ success: true });
        expect(mockTx).not.toHaveBeenCalled();
    });

    it('una clínica sin espejo recibe un error, no un cambio', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue(null);

        const res = await cambiarEnvioAlHospital(false);

        expect(res.success).toBe(false);
        expect(mockTx).not.toHaveBeenCalled();
    });
});

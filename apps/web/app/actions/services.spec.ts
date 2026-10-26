jest.mock('@/lib/prisma', () => ({
    prisma: {
        medicalService: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
        hospitalMirrorConfig: { findUnique: jest.fn() },
        syncAudit: { create: jest.fn() },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { createMedicalService, deleteMedicalService, toggleMedicalServiceStatus } from './services';

const mockSession = getSession as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;
const mockAudit = prisma.syncAudit.create as jest.Mock;
const ADMIN = { userId: 'admin-1', email: 'admin@clinica.co', role: 'ORG_ADMIN', organizationId: 'org-1' };

describe('Servicios — huella en la Actividad de usuarios (2026-10-27)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSession.mockResolvedValue(ADMIN);
    });

    it('crear queda registrado con quién lo hizo', async () => {
        (prisma.medicalService.create as jest.Mock).mockResolvedValue({ id: 'srv-1', name: 'Odontología', isActive: true });
        const fd = new FormData();
        fd.set('name', 'Odontología');
        fd.set('isActive', 'on');
        expect((await createMedicalService(undefined, fd)).success).toBe(true);
        expect(mockLog.mock.calls[0][0].data).toMatchObject({ action: 'SERVICE_CREATED', userId: 'admin-1' });
    });

    it('sin espejo, inactivar va a la bitácora del sistema', async () => {
        (prisma.medicalService.update as jest.Mock).mockResolvedValue({ name: 'Odontología', isActive: false });
        (prisma.hospitalMirrorConfig.findUnique as jest.Mock).mockResolvedValue(null);
        await toggleMedicalServiceStatus('srv-1', true);
        expect(mockLog.mock.calls[0][0].data).toMatchObject({ action: 'SERVICE_DEACTIVATED', level: 'WARNING' });
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it('con espejo, solo a la auditoría del espejo (una sola línea en la Actividad)', async () => {
        (prisma.medicalService.update as jest.Mock).mockResolvedValue({ name: 'Odontología', isActive: false });
        (prisma.hospitalMirrorConfig.findUnique as jest.Mock).mockResolvedValue({ enabled: true });
        await toggleMedicalServiceStatus('srv-1', true);
        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(mockAudit.mock.calls[0][0].data.detail).toContain('por admin@clinica.co');
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('borrar queda como aviso', async () => {
        (prisma.medicalService.findFirst as jest.Mock).mockResolvedValue({
            id: 'srv-1',
            name: 'Odontología',
            _count: { doctors: 0, slots: 0 },
        });
        expect((await deleteMedicalService('srv-1')).success).toBe(true);
        expect(mockLog.mock.calls[0][0].data).toMatchObject({ action: 'SERVICE_DELETED', level: 'WARNING' });
    });
});

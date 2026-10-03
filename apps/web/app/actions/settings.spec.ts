jest.mock('@/lib/prisma', () => ({
    prisma: { organizationSettings: { upsert: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '../../lib/session';
import { getMyOrgSettings, setMyBookingEnabled, setMyRemindersEnabled } from './settings';

const mockGetSession = getSession as jest.Mock;
const mockUpsert = prisma.organizationSettings.upsert as jest.Mock;
const mockFindUnique = prisma.organizationSettings.findUnique as jest.Mock;

describe('settings — interruptor de recordatorios', () => {
    beforeEach(() => jest.clearAllMocks());

    it('solo el ORG_ADMIN lo cambia', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        const res = await setMyRemindersEnabled(false);
        expect(res).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('guarda en la clínica de la sesión, y nada más que el interruptor', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        const res = await setMyRemindersEnabled(false);
        expect(res).toEqual({ success: true, remindersEnabled: false });
        expect(mockUpsert).toHaveBeenCalledWith({
            where: { organizationId: 'org-1' },
            create: { organizationId: 'org-1', remindersEnabled: false },
            update: { remindersEnabled: false },
        });
    });

    it('lo que no sea exactamente true apaga', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        await setMyRemindersEnabled('true' as unknown as boolean);
        expect(mockUpsert.mock.calls[0][0].update).toEqual({ remindersEnabled: false });
    });

    it('una clínica sin fila de settings los ve prendidos (el default)', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockFindUnique.mockResolvedValue(null);
        const s = await getMyOrgSettings();
        expect(s.remindersEnabled).toBe(true);
    });
});

describe('settings — interruptor de operaciones del bot (solo consultas)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('solo el ORG_ADMIN lo cambia', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        const res = await setMyBookingEnabled(false);
        expect(res).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('guarda en la clínica de la sesión, y nada más que el interruptor', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        const res = await setMyBookingEnabled(false);
        expect(res).toEqual({ success: true, bookingEnabled: false });
        expect(mockUpsert).toHaveBeenCalledWith({
            where: { organizationId: 'org-1' },
            create: { organizationId: 'org-1', bookingEnabled: false },
            update: { bookingEnabled: false },
        });
    });

    it('lo que no sea exactamente true apaga', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        await setMyBookingEnabled('true' as unknown as boolean);
        expect(mockUpsert.mock.calls[0][0].update).toEqual({ bookingEnabled: false });
    });

    it('una clínica sin fila de settings lo ve prendido (el default)', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockFindUnique.mockResolvedValue(null);
        const s = await getMyOrgSettings();
        expect(s.bookingEnabled).toBe(true);
    });
});

jest.mock('@/lib/prisma', () => ({
    prisma: { organizationSettings: { upsert: jest.fn(), findUnique: jest.fn() } },
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '../../lib/session';
import {
    getMyOrgSettings,
    setMyBookingEnabled,
    setMyRemindersEnabled,
    setMyRemindersOnlySelfBooked,
    setMyReminderMinLead,
    setMyBookingMaxDaysAhead,
} from './settings';

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

describe('settings — recordatorios solo a pacientes que agendaron ellos mismos', () => {
    beforeEach(() => jest.clearAllMocks());

    it('solo el ORG_ADMIN lo cambia', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        const res = await setMyRemindersOnlySelfBooked(true);
        expect(res).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('guarda en la clínica de la sesión, y nada más que esta opción', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        const res = await setMyRemindersOnlySelfBooked(true);
        expect(res).toEqual({ success: true, remindersOnlySelfBooked: true });
        expect(mockUpsert).toHaveBeenCalledWith({
            where: { organizationId: 'org-1' },
            create: { organizationId: 'org-1', remindersOnlySelfBooked: true },
            update: { remindersOnlySelfBooked: true },
        });
    });

    it('lo que no sea exactamente true la apaga (recordatorio a todas, lo de siempre)', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        await setMyRemindersOnlySelfBooked('true' as unknown as boolean);
        expect(mockUpsert.mock.calls[0][0].update).toEqual({ remindersOnlySelfBooked: false });
    });

    it('una clínica sin fila de settings la ve apagada (el default)', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockFindUnique.mockResolvedValue(null);
        const s = await getMyOrgSettings();
        expect(s.remindersOnlySelfBooked).toBe(false);
        expect(s.remindersEnabled).toBe(true);
        // ⏱️ Y la anticipación mínima, en su default: 1 hora.
        expect(s.reminderMinLeadMinutes).toBe(60);
    });
});

describe('settings — anticipación mínima del recordatorio', () => {
    beforeEach(() => jest.clearAllMocks());

    it('solo el ORG_ADMIN la cambia', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        const res = await setMyReminderMinLead(30);
        expect(res).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('guarda en la clínica de la sesión, y nada más que este ajuste', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        const res = await setMyReminderMinLead(30);
        expect(res).toEqual({ success: true, reminderMinLeadMinutes: 30 });
        expect(mockUpsert).toHaveBeenCalledWith({
            where: { organizationId: 'org-1' },
            create: { organizationId: 'org-1', reminderMinLeadMinutes: 30 },
            update: { reminderMinLeadMinutes: 30 },
        });
    });

    it('0 es «sin mínimo»; un valor inválido cae a 60, nunca a «sin mínimo»', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        expect(await setMyReminderMinLead(0)).toEqual({ success: true, reminderMinLeadMinutes: 0 });
        expect(await setMyReminderMinLead(Number.NaN)).toEqual({ success: true, reminderMinLeadMinutes: 60 });
        expect(await setMyReminderMinLead(-10)).toEqual({ success: true, reminderMinLeadMinutes: 60 });
        expect(await setMyReminderMinLead(100_000)).toEqual({ success: true, reminderMinLeadMinutes: 720 });
    });
});

describe('settings — plazo máximo para agendar', () => {
    beforeEach(() => jest.clearAllMocks());

    it('solo el ORG_ADMIN lo cambia', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        const res = await setMyBookingMaxDaysAhead(3);
        expect(res).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('guarda en la clínica de la sesión, y nada más que este ajuste', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        const res = await setMyBookingMaxDaysAhead(3);
        expect(res).toEqual({ success: true, bookingMaxDaysAhead: 3 });
        expect(mockUpsert).toHaveBeenCalledWith({
            where: { organizationId: 'org-1' },
            create: { organizationId: 'org-1', bookingMaxDaysAhead: 3 },
            update: { bookingMaxDaysAhead: 3 },
        });
    });

    it('null es «sin límite»', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpsert.mockResolvedValue({});
        expect(await setMyBookingMaxDaysAhead(null)).toEqual({ success: true, bookingMaxDaysAhead: null });
        expect(mockUpsert.mock.calls[0][0].update).toEqual({ bookingMaxDaysAhead: null });
    });

    it.each([0, -1, 366, 2.5, Number.NaN, '3' as unknown as number])(
        '%p no se guarda: es un error, no «sin límite»',
        async (valor) => {
            mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
            const res = await setMyBookingMaxDaysAhead(valor);
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/entre 1 y 365/);
            expect(mockUpsert).not.toHaveBeenCalled();
        },
    );

    it('una clínica sin fila de settings no tiene límite, y «hoy» es el de la clínica', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockFindUnique.mockResolvedValue(null);
        const s = await getMyOrgSettings();
        expect(s.bookingMaxDaysAhead).toBeNull();
        expect(s.hoyEnLaClinica).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('lee el plazo guardado', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockFindUnique.mockResolvedValue({ bookingMaxDaysAhead: 3, organization: { timezone: null } });
        expect((await getMyOrgSettings()).bookingMaxDaysAhead).toBe(3);
    });
});

jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { upsert: jest.fn(), findUnique: jest.fn() },
        syncAudit: { create: jest.fn() },
        hospitalMirrorConfig: { findUnique: jest.fn(), update: jest.fn() },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('@/lib/plazo-agendar/resumen', () => ({
    OP_CAMBIO_PLAZO: 'BOOKING_MAX_DAYS_CHANGE',
    cargarResumenDelPlazo: jest.fn(async () => ({ enElPlazo: 0, total: 0 })),
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
    getMyPlazoAgendarResumen,
    getMyHomologacionAutomatica,
    setMyAutoHomologacion,
    setMyAutoHomologacionWhatsapp,
    setMyCancelEnabled,
    updateMyOrgSettings,
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

describe('settings — quién cambia el plazo y cuándo', () => {
    beforeEach(() => jest.clearAllMocks());
    const mockAudit = prisma.syncAudit.create as jest.Mock;

    it('un cambio queda en la auditoría con el valor de antes, el nuevo y quién lo hizo', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@hsvp.gov.co' });
        mockFindUnique.mockResolvedValue({ bookingMaxDaysAhead: 2 });
        mockUpsert.mockResolvedValue({});

        expect(await setMyBookingMaxDaysAhead(4)).toEqual({ success: true, bookingMaxDaysAhead: 4 });
        expect(mockAudit).toHaveBeenCalledWith({
            data: expect.objectContaining({
                organizationId: 'org-1',
                direction: 'CONFIG',
                op: 'BOOKING_MAX_DAYS_CHANGE',
                detail: '«Plazo máximo para agendar» cambió de «2 días (hoy y mañana)» a «4 días» desde Configuración por admin@hsvp.gov.co.',
            }),
        });
    });

    it('de «Sin límite» a un plazo también', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@hsvp.gov.co' });
        mockFindUnique.mockResolvedValue({ bookingMaxDaysAhead: null });
        mockUpsert.mockResolvedValue({});
        await setMyBookingMaxDaysAhead(3);
        expect(mockAudit.mock.calls[0][0].data.detail).toContain('cambió de «Sin límite» a «3 días');
    });

    it('guardar el mismo valor no deja una entrada', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@hsvp.gov.co' });
        mockFindUnique.mockResolvedValue({ bookingMaxDaysAhead: 4 });
        mockUpsert.mockResolvedValue({});
        await setMyBookingMaxDaysAhead(4);
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it('si la auditoría falla, el cambio queda guardado igual', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@hsvp.gov.co' });
        mockFindUnique.mockResolvedValue({ bookingMaxDaysAhead: 2 });
        mockUpsert.mockResolvedValue({});
        mockAudit.mockRejectedValueOnce(new Error('caída'));
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await setMyBookingMaxDaysAhead(4)).toEqual({ success: true, bookingMaxDaysAhead: 4 });
        err.mockRestore();
    });

    it('el resumen del plazo solo lo ve el ORG_ADMIN', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        expect(await getMyPlazoAgendarResumen()).toEqual({ success: false, error: 'Acceso denegado' });
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        expect(await getMyPlazoAgendarResumen()).toEqual({ success: true, resumen: { enElPlazo: 0, total: 0 } });
    });
});

describe('settings — 🩺 médicos nuevos del hospital', () => {
    beforeEach(() => jest.clearAllMocks());
    const mirror = prisma.hospitalMirrorConfig as unknown as { findUnique: jest.Mock; update: jest.Mock };
    const audit = prisma.syncAudit.create as jest.Mock;
    const admin = { role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@hsvp.gov.co' };

    it('solo el ORG_ADMIN', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        expect(await setMyAutoHomologacion(true)).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mirror.update).not.toHaveBeenCalled();
    });

    it('sin conexión al hospital no hay qué encender', async () => {
        mockGetSession.mockResolvedValue(admin);
        mirror.findUnique.mockResolvedValue(null);
        expect(await setMyAutoHomologacion(true)).toMatchObject({ success: false, error: expect.stringContaining('no está conectada') });
    });

    it('enciende la homologación automática en SU clínica y lo anota con quién', async () => {
        mockGetSession.mockResolvedValue(admin);
        mirror.findUnique.mockResolvedValue({ autoHomologateDoctors: false, autoHomologateWhatsappOn: false });
        audit.mockResolvedValue({});
        expect(await setMyAutoHomologacion(true)).toEqual({ success: true });
        expect(mirror.update).toHaveBeenCalledWith({ where: { organizationId: 'org-1' }, data: { autoHomologateDoctors: true } });
        expect(audit.mock.calls[0][0].data).toMatchObject({ op: 'AUTO_HOMOLOGATE_CHANGE', direction: 'CONFIG' });
        expect(audit.mock.calls[0][0].data.detail).toContain('ENCENDIDO desde Configuración por admin@hsvp.gov.co');
    });

    it('el WhatsApp de los agregados solos es otro campo; lo que no sea true apaga', async () => {
        mockGetSession.mockResolvedValue(admin);
        mirror.findUnique.mockResolvedValue({ autoHomologateDoctors: true, autoHomologateWhatsappOn: true });
        audit.mockResolvedValue({});
        await setMyAutoHomologacionWhatsapp('si' as unknown as boolean);
        expect(mirror.update).toHaveBeenCalledWith({ where: { organizationId: 'org-1' }, data: { autoHomologateWhatsappOn: false } });
        expect(audit.mock.calls[0][0].data.op).toBe('AUTO_HOMOLOGATE_WHATSAPP_CHANGE');
    });

    it('guardar lo mismo no deja anotación', async () => {
        mockGetSession.mockResolvedValue(admin);
        mirror.findUnique.mockResolvedValue({ autoHomologateDoctors: true, autoHomologateWhatsappOn: false });
        await setMyAutoHomologacion(true);
        expect(audit).not.toHaveBeenCalled();
    });

    it('get: lo que hay, y nada si no es administrador', async () => {
        mockGetSession.mockResolvedValue(admin);
        mirror.findUnique.mockResolvedValue({ enabled: true, autoHomologateDoctors: true, autoHomologateWhatsappOn: false });
        expect(await getMyHomologacionAutomatica()).toEqual({ espejo: true, auto: true, whatsappOn: false });
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        expect(await getMyHomologacionAutomatica()).toEqual({ espejo: false, auto: false, whatsappOn: false });
    });
});

describe('settings — Actividad de usuarios (2026-10-27)', () => {
    const mockLog = prisma.systemLog.create as jest.Mock;
    const mockAudit = prisma.syncAudit.create as jest.Mock;
    const mockEspejo = prisma.hospitalMirrorConfig.findUnique as jest.Mock;
    const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', userId: 'admin-1', email: 'admin@clinica.co' };
    const registros = () => mockLog.mock.calls.map((c) => c[0].data);

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetSession.mockResolvedValue(ADMIN);
        mockUpsert.mockResolvedValue({});
    });

    it('apagar los recordatorios queda con quién lo hizo', async () => {
        mockFindUnique.mockResolvedValue({ remindersEnabled: true });
        await setMyRemindersEnabled(false);
        expect(registros()[0]).toMatchObject({ action: 'REMINDERS_ENABLED_CHANGED', userId: 'admin-1', organizationId: 'org-1' });
        expect(registros()[0].metadata.detalle).toBe('Recordatorios automáticos APAGADO');
    });

    it('guardar lo mismo no es un cambio', async () => {
        mockFindUnique.mockResolvedValue({ remindersEnabled: true, reminderMinLeadMinutes: 60 });
        await setMyRemindersEnabled(true);
        await setMyReminderMinLead(60);
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('la anticipación mínima dice antes y después', async () => {
        mockFindUnique.mockResolvedValue({ reminderMinLeadMinutes: 60 });
        await setMyReminderMinLead(120);
        expect(registros()[0].metadata.detalle).toBe('Anticipación mínima del recordatorio: 60 → 120 min');
    });

    it('sin espejo, apagar «Cancelar» va a la bitácora del sistema; con espejo, solo a la del espejo', async () => {
        mockFindUnique.mockResolvedValue({ cancelEnabled: true });
        mockEspejo.mockResolvedValue(null);
        await setMyCancelEnabled(false);
        expect(registros()[0]).toMatchObject({ action: 'BOT_OPERATION_CHANGED' });
        expect(registros()[0].metadata.detalle).toBe('«Cancelar citas» por el asistente APAGADO');
        expect(mockAudit).not.toHaveBeenCalled();

        jest.clearAllMocks();
        mockGetSession.mockResolvedValue(ADMIN);
        mockUpsert.mockResolvedValue({});
        mockFindUnique.mockResolvedValue({ cancelEnabled: true });
        mockEspejo.mockResolvedValue({ enabled: true });
        (prisma as unknown as { syncOutbox?: unknown }).syncOutbox = { findMany: jest.fn(async () => []) };
        await setMyCancelEnabled(false);
        expect(mockLog).not.toHaveBeenCalled();
        expect(mockAudit).toHaveBeenCalledTimes(1);
    });

    it('nombre, estilo y cupos del asistente: dice qué cambió', async () => {
        mockFindUnique.mockResolvedValue({ botName: 'AgenIA', communicationStyle: 'FORMAL', slotsOfferedCount: 6 });
        await updateMyOrgSettings({ botName: 'Vicente', communicationStyle: 'FORMAL', slotsOfferedCount: 4 });
        expect(registros()[0]).toMatchObject({ action: 'BOT_SETTINGS_CHANGED' });
        expect(registros()[0].metadata.detalle).toBe('Asistente: nombre: AgenIA → Vicente · cupos que ofrece: 6 → 4');
    });
});

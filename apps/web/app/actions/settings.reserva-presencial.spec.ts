jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { upsert: jest.fn(), findUnique: jest.fn() },
        syncAudit: { create: jest.fn() },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('@/lib/plazo-agendar/resumen', () => ({
    OP_CAMBIO_PLAZO: 'BOOKING_MAX_DAYS_CHANGE',
    cargarResumenDelPlazo: jest.fn(),
}));
jest.mock('@/lib/reserva-presencial/resumen', () => ({
    OP_CAMBIO_RESERVA: 'BOT_SHARE_CHANGE',
    cargarResumenDeLaReserva: jest.fn(async () => ({ porcentaje: 80, hoy: '2026-11-13', dias: [], ultimoCambio: null })),
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '../../lib/session';
import { getMyOrgSettings, getMyReservaPresencialResumen, setMyBotAgendaSharePercent } from './settings';

const mockGetSession = getSession as jest.Mock;
const mockUpsert = prisma.organizationSettings.upsert as jest.Mock;
const mockFindUnique = prisma.organizationSettings.findUnique as jest.Mock;
const mockAudit = prisma.syncAudit.create as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;

const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@clinica.co', userId: 'u1' };

describe('settings — parte de la agenda para el asistente (reserva para la atención presencial)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpsert.mockResolvedValue({});
        mockAudit.mockResolvedValue({});
    });

    it.each(['BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER'])('solo el ORG_ADMIN la cambia (%s no)', async (role) => {
        mockGetSession.mockResolvedValue({ role, organizationId: 'org-1' });
        expect(await setMyBotAgendaSharePercent(80)).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('sin sesión, tampoco', async () => {
        mockGetSession.mockResolvedValue(null);
        expect((await setMyBotAgendaSharePercent(80)).success).toBe(false);
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('guarda en la clínica de la sesión, y nada más que el porcentaje', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ botAgendaSharePercent: null });
        expect(await setMyBotAgendaSharePercent(80)).toEqual({ success: true, botAgendaSharePercent: 80 });
        expect(mockUpsert).toHaveBeenCalledWith({
            where: { organizationId: 'org-1' },
            create: { organizationId: 'org-1', botAgendaSharePercent: 80 },
            update: { botAgendaSharePercent: 80 },
        });
    });

    it('el cambio queda en la auditoría y en la actividad, con el antes, el después y quién', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ botAgendaSharePercent: null });
        await setMyBotAgendaSharePercent(80);
        expect(mockAudit).toHaveBeenCalledTimes(1);
        const { data } = mockAudit.mock.calls[0][0];
        expect(data.op).toBe('BOT_SHARE_CHANGE');
        expect(data.organizationId).toBe('org-1');
        expect(data.detail).toBe(
            '«Parte de la agenda para el asistente» cambió de «Sin reserva» a ' +
                '«80 % para el asistente, 20 % para el hospital» desde Configuración por admin@clinica.co.',
        );
        expect(mockLog).toHaveBeenCalledTimes(1);
        expect(mockLog.mock.calls[0][0].data.action).toBe('BOT_SETTINGS_CHANGED');
    });

    it('guardar lo mismo no es un cambio: no se audita', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ botAgendaSharePercent: 80 });
        expect((await setMyBotAgendaSharePercent(80)).success).toBe(true);
        expect(mockAudit).not.toHaveBeenCalled();
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('«Sin reserva» guarda vacío; 100 % es lo mismo', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ botAgendaSharePercent: 80 });
        expect(await setMyBotAgendaSharePercent(null)).toEqual({ success: true, botAgendaSharePercent: null });
        expect(mockUpsert.mock.calls[0][0].update).toEqual({ botAgendaSharePercent: null });
        expect(await setMyBotAgendaSharePercent(100)).toEqual({ success: true, botAgendaSharePercent: null });
        expect(mockUpsert.mock.calls[1][0].update).toEqual({ botAgendaSharePercent: null });
    });

    it.each([9, 0, -5, 101, 80.5, '80', undefined, NaN])(
        'un valor inválido (%p) es un error y no toca nada: no deja la clínica sin reserva',
        async (valor) => {
            mockGetSession.mockResolvedValue(ADMIN);
            const res = await setMyBotAgendaSharePercent(valor as unknown as number);
            expect(res.success).toBe(false);
            expect(mockUpsert).not.toHaveBeenCalled();
        },
    );

    it('si la auditoría falla, el cambio queda guardado igual', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ botAgendaSharePercent: null });
        mockAudit.mockRejectedValue(new Error('boom'));
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(await setMyBotAgendaSharePercent(70)).toEqual({ success: true, botAgendaSharePercent: 70 });
        err.mockRestore();
    });

    it('una clínica sin fila de settings no tiene reserva (lo de fábrica)', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue(null);
        expect((await getMyOrgSettings()).botAgendaSharePercent).toBeNull();
    });

    it('el resumen es solo del ORG_ADMIN', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        expect((await getMyReservaPresencialResumen()).success).toBe(false);
        mockGetSession.mockResolvedValue(ADMIN);
        expect(await getMyReservaPresencialResumen()).toMatchObject({ success: true, resumen: { porcentaje: 80 } });
    });
});

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
    cargarResumenDeLaReserva: jest.fn(),
}));
jest.mock('@/lib/sabado-rural/estado', () => ({
    OP_CAMBIO_SABADO_RURAL: 'SATURDAY_RURAL_CHANGE',
    cargarEstadoSabadoRural: jest.fn(async () => ({
        porcentaje: 50,
        conEspejo: true,
        lista: null,
        bloqueoSabado: 'COMPLETO',
        ultimoCambio: null,
    })),
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '../../lib/session';
import { getMyOrgSettings, getMySabadoRuralEstado, setMySaturdayRuralSharePercent } from './settings';

const mockGetSession = getSession as jest.Mock;
const mockUpsert = prisma.organizationSettings.upsert as jest.Mock;
const mockFindUnique = prisma.organizationSettings.findUnique as jest.Mock;
const mockAudit = prisma.syncAudit.create as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;

const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@clinica.co', userId: 'u1' };

describe('settings — sábados por el asistente (solo zona rural)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpsert.mockResolvedValue({});
        mockAudit.mockResolvedValue({});
    });

    it.each(['BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER'])('solo el ORG_ADMIN la cambia (%s no)', async (role) => {
        mockGetSession.mockResolvedValue({ role, organizationId: 'org-1' });
        expect(await setMySaturdayRuralSharePercent(50)).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('guarda en la clínica de la sesión, y nada más que la regla', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ saturdayRuralSharePercent: null });
        expect(await setMySaturdayRuralSharePercent(50)).toEqual({ success: true, saturdayRuralSharePercent: 50 });
        expect(mockUpsert).toHaveBeenCalledWith({
            where: { organizationId: 'org-1' },
            create: { organizationId: 'org-1', saturdayRuralSharePercent: 50 },
            update: { saturdayRuralSharePercent: 50 },
        });
    });

    it('100 % se guarda tal cual: solo zona rural, sin tope', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ saturdayRuralSharePercent: 50 });
        expect(await setMySaturdayRuralSharePercent(100)).toEqual({ success: true, saturdayRuralSharePercent: 100 });
    });

    it('el cambio queda en la auditoría y en la actividad, con el antes, el después y quién', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ saturdayRuralSharePercent: null });
        await setMySaturdayRuralSharePercent(50);
        const { data } = mockAudit.mock.calls[0][0];
        expect(data.op).toBe('SATURDAY_RURAL_CHANGE');
        expect(data.detail).toBe(
            '«Sábados por el asistente» cambió de «Sin regla especial» a ' +
                '«Solo zona rural, hasta el 50 % de cada médico» desde Configuración por admin@clinica.co.',
        );
        expect(mockLog).toHaveBeenCalledTimes(1);
        expect(mockLog.mock.calls[0][0].data.action).toBe('BOT_SETTINGS_CHANGED');
    });

    it('guardar lo mismo no es un cambio: no se audita', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ saturdayRuralSharePercent: 50 });
        expect((await setMySaturdayRuralSharePercent(50)).success).toBe(true);
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it('«Sin regla especial» guarda vacío', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue({ saturdayRuralSharePercent: 50 });
        expect(await setMySaturdayRuralSharePercent(null)).toEqual({ success: true, saturdayRuralSharePercent: null });
        expect(mockUpsert.mock.calls[0][0].update).toEqual({ saturdayRuralSharePercent: null });
    });

    it.each([9, 0, 101, 50.5, '50', undefined, NaN])(
        'un valor inválido (%p) es un error y no toca nada',
        async (valor) => {
            mockGetSession.mockResolvedValue(ADMIN);
            expect((await setMySaturdayRuralSharePercent(valor as unknown as number)).success).toBe(false);
            expect(mockUpsert).not.toHaveBeenCalled();
        },
    );

    it('una clínica sin fila de settings no tiene la regla (lo de fábrica)', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue(null);
        expect((await getMyOrgSettings()).saturdayRuralSharePercent).toBeNull();
    });

    it('el estado es solo del ORG_ADMIN', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        expect((await getMySabadoRuralEstado()).success).toBe(false);
        mockGetSession.mockResolvedValue(ADMIN);
        expect(await getMySabadoRuralEstado()).toMatchObject({ success: true, estado: { porcentaje: 50 } });
    });
});

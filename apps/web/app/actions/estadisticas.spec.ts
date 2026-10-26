/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { upsert: jest.fn(), findUnique: jest.fn() },
        syncAudit: { create: jest.fn(async () => ({})) },
        systemLog: { count: jest.fn(), create: jest.fn(async () => ({})) },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
const galleta = { set: jest.fn(), delete: jest.fn() };
const cabeceras = new Map<string, string>([
    ['x-forwarded-for', '186.87.28.46, 172.18.0.5'],
    ['host', 'app.hsvpanserma.agenia.co'],
    ['x-forwarded-proto', 'https'],
]);
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => galleta),
    headers: jest.fn(async () => ({ get: (k: string) => cabeceras.get(k) ?? null })),
}));

import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { accesoValido } from '@/lib/estadisticas/acceso';
import {
    entrarAEstadisticas,
    getMyEstadisticasParaCompartir,
    quitarMyClaveEstadisticas,
    salirDeEstadisticas,
    setMyClaveEstadisticas,
} from './estadisticas';

const ORG = '97f18182-d0d9-4a3b-9eb6-4fbc031b917c';
const mockSession = getSession as jest.Mock;
const mockFind = prisma.organizationSettings.findUnique as jest.Mock;
const mockUpsert = prisma.organizationSettings.upsert as jest.Mock;
const mockCount = prisma.systemLog.count as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;
const mockAudit = prisma.syncAudit.create as jest.Mock;

let hash: string;
beforeAll(async () => {
    process.env.JWT_SECRET = 'secreto-de-prueba';
    hash = await bcrypt.hash('Anserma2026', 4);
});
beforeEach(() => jest.clearAllMocks());

describe('estadísticas — entrar con la clave (página pública)', () => {
    beforeEach(() => {
        mockCount.mockResolvedValue(0);
        mockFind.mockResolvedValue({ publicStatsKeyHash: hash, organization: { isActive: true } });
    });

    it('con la clave correcta deja la cookie solo para la página de esa clínica', async () => {
        expect(await entrarAEstadisticas(ORG, 'Anserma2026')).toEqual({ success: true });
        const [nombre, valor, opciones] = galleta.set.mock.calls[0];
        expect(nombre).toBe('estadisticas_acceso');
        expect(accesoValido(valor, ORG, hash)).toBe(true);
        expect(opciones).toMatchObject({ httpOnly: true, sameSite: 'lax', path: `/estadisticas/${ORG}`, maxAge: 30 * 24 * 3600 });
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('con la equivocada no entra y lo anota con la IP del visitante, sin la clave', async () => {
        expect(await entrarAEstadisticas(ORG, 'otra-cosa')).toEqual({ success: false, error: 'La clave no es correcta.' });
        expect(galleta.set).not.toHaveBeenCalled();
        const log = mockLog.mock.calls[0][0].data;
        expect(log).toMatchObject({ level: 'WARNING', action: 'PUBLIC_STATS_LOGIN_FAILED', organizationId: ORG, metadata: { ip: '186.87.28.46' } });
        expect(JSON.stringify(log)).not.toContain('otra-cosa');
    });

    it('tras 5 claves equivocadas desde la misma IP en 15 minutos, frena sin comparar', async () => {
        mockCount.mockResolvedValueOnce(5).mockResolvedValueOnce(5);
        const res = await entrarAEstadisticas(ORG, 'Anserma2026');
        expect(res).toEqual({ success: false, error: expect.stringMatching(/Demasiados intentos.*15 minutos/) });
        expect(mockFind).not.toHaveBeenCalled();
        expect(mockCount.mock.calls[0][0].where).toMatchObject({
            action: 'PUBLIC_STATS_LOGIN_FAILED',
            organizationId: ORG,
            metadata: { path: ['ip'], equals: '186.87.28.46' },
        });
    });

    it('y tras 30 en la clínica, aunque vengan de IP distintas', async () => {
        mockCount.mockResolvedValueOnce(0).mockResolvedValueOnce(30);
        expect((await entrarAEstadisticas(ORG, 'Anserma2026')).success).toBe(false);
        expect(mockFind).not.toHaveBeenCalled();
    });

    it('una página cerrada (sin clave) o de una clínica suspendida no deja entrar', async () => {
        mockFind.mockResolvedValueOnce({ publicStatsKeyHash: null, organization: { isActive: true } });
        expect(await entrarAEstadisticas(ORG, 'Anserma2026')).toEqual({ success: false, error: 'Esta página no está disponible.' });
        mockFind.mockResolvedValueOnce({ publicStatsKeyHash: hash, organization: { isActive: false } });
        expect((await entrarAEstadisticas(ORG, 'Anserma2026')).success).toBe(false);
        expect(galleta.set).not.toHaveBeenCalled();
    });

    it('un enlace que no es de una clínica no consulta nada', async () => {
        expect((await entrarAEstadisticas('../../dashboard', 'x')).success).toBe(false);
        expect(mockCount).not.toHaveBeenCalled();
    });

    it('salir borra la cookie de esa página', async () => {
        expect(await salirDeEstadisticas(ORG)).toEqual({ success: true });
        expect(galleta.delete).toHaveBeenCalledWith({ name: 'estadisticas_acceso', path: `/estadisticas/${ORG}` });
    });
});

describe('estadísticas — la clave en Configuración', () => {
    const admin = { role: 'ORG_ADMIN', organizationId: ORG, email: 'admin@hsvpanserma.gov.co' };

    it('solo el administrador la pone o la quita', async () => {
        mockSession.mockResolvedValue({ ...admin, role: 'BOOKING_AGENT' });
        expect(await setMyClaveEstadisticas('Anserma2026')).toEqual({ success: false, error: 'Acceso denegado' });
        expect(await quitarMyClaveEstadisticas()).toEqual({ success: false, error: 'Acceso denegado' });
        await expect(getMyEstadisticasParaCompartir()).rejects.toThrow('Acceso denegado');
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('una clave muy corta no se guarda', async () => {
        mockSession.mockResolvedValue(admin);
        expect(await setMyClaveEstadisticas('abc')).toEqual({ success: false, error: expect.stringMatching(/al menos 6/) });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('guarda el hash (nunca la clave), quién y cuándo, y lo deja en la auditoría sin la clave', async () => {
        mockSession.mockResolvedValue(admin);
        mockFind.mockResolvedValue(null);
        mockUpsert.mockResolvedValue({});
        const res = await setMyClaveEstadisticas('Anserma2026');
        expect(res).toMatchObject({ success: true, cambiadaPor: 'admin@hsvpanserma.gov.co' });
        const { create, update } = mockUpsert.mock.calls[0][0];
        expect(create.organizationId).toBe(ORG);
        expect(update.publicStatsKeyHash).not.toBe('Anserma2026');
        expect(await bcrypt.compare('Anserma2026', update.publicStatsKeyHash)).toBe(true);
        expect(update.publicStatsKeyUpdatedBy).toBe('admin@hsvpanserma.gov.co');
        const audit = mockAudit.mock.calls[0][0].data;
        expect(audit).toMatchObject({ direction: 'CONFIG', op: 'PUBLIC_STATS_KEY_CHANGE', outcome: 'OK' });
        expect(audit.detail).toMatch(/abierta con clave/);
        expect(JSON.stringify(audit)).not.toContain('Anserma2026');
    });

    it('cambiarla lo dice en la auditoría', async () => {
        mockSession.mockResolvedValue(admin);
        mockFind.mockResolvedValue({ publicStatsKeyHash: hash });
        mockUpsert.mockResolvedValue({});
        await setMyClaveEstadisticas('NuevaClave1');
        expect(mockAudit.mock.calls[0][0].data.detail).toMatch(/con clave nueva/);
    });

    it('quitarla cierra la página', async () => {
        mockSession.mockResolvedValue(admin);
        mockFind.mockResolvedValue({ publicStatsKeyHash: hash });
        mockUpsert.mockResolvedValue({});
        expect((await quitarMyClaveEstadisticas()).success).toBe(true);
        expect(mockUpsert.mock.calls[0][0].update.publicStatsKeyHash).toBeNull();
        expect(mockAudit.mock.calls[0][0].data.detail).toMatch(/cerrada/);
    });

    it('el panel ve si está abierta y el enlace, nunca el hash', async () => {
        mockSession.mockResolvedValue(admin);
        mockFind.mockResolvedValue({
            publicStatsKeyHash: hash,
            publicStatsKeyUpdatedAt: new Date('2026-10-26T15:00:00Z'),
            publicStatsKeyUpdatedBy: 'admin@hsvpanserma.gov.co',
        });
        const r = await getMyEstadisticasParaCompartir();
        expect(r).toEqual({
            abierta: true,
            ruta: `/estadisticas/${ORG}`,
            enlace: `https://app.hsvpanserma.agenia.co/estadisticas/${ORG}`,
            cambiadaEn: '2026-10-26T15:00:00.000Z',
            cambiadaPor: 'admin@hsvpanserma.gov.co',
        });
        expect(JSON.stringify(r)).not.toContain(hash);
    });
});

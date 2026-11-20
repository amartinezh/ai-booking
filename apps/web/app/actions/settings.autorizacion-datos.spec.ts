jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { upsert: jest.fn(), findUnique: jest.fn() },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '../../lib/session';
import { getMyOrgSettings, setMyAutorizacionDatos } from './settings';

const mockGetSession = getSession as jest.Mock;
const mockUpsert = prisma.organizationSettings.upsert as jest.Mock;
const mockFindUnique = prisma.organizationSettings.findUnique as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;

const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', email: 'admin@clinica.co', userId: 'u1' };
const URL_POLITICA = 'https://hospital.gov.co/datos';
const guardada = (o: Record<string, unknown> = {}) => ({
    dataConsentEnabled: true,
    dataPolicyUrl: URL_POLITICA,
    dataPolicyVersion: '1',
    dataConsentUpdatedAt: new Date('2026-11-20T15:00:00Z'),
    dataConsentUpdatedBy: 'admin@clinica.co',
    ...o,
});

describe('settings — autorización de datos (Ley 1581)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindUnique.mockResolvedValue(null);
        mockUpsert.mockImplementation(async ({ update }) => guardada(update));
    });

    it.each(['BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER'])('solo el ORG_ADMIN la cambia (%s no)', async (role) => {
        mockGetSession.mockResolvedValue({ role, organizationId: 'org-1' });
        expect(await setMyAutorizacionDatos({ encendida: true, urlPolitica: URL_POLITICA, version: '1' })).toEqual({
            success: false,
            error: 'Acceso denegado',
        });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('para encenderla hace falta el enlace de la política', async () => {
        const r = await setMyAutorizacionDatos({ encendida: true, urlPolitica: '  ', version: '1' });
        expect(r).toMatchObject({ success: false, error: expect.stringMatching(/enlace/) });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('un enlace o una versión inválidos no se guardan', async () => {
        expect(await setMyAutorizacionDatos({ encendida: false, urlPolitica: 'hospital.gov.co', version: '1' })).toMatchObject({ success: false });
        expect(await setMyAutorizacionDatos({ encendida: false, urlPolitica: '', version: '' })).toMatchObject({ success: false });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('la enciende en la clínica de la sesión, anota quién y lo deja en la actividad', async () => {
        const r = await setMyAutorizacionDatos({ encendida: true, urlPolitica: ` ${URL_POLITICA} `, version: ' 1 ' });
        expect(r).toMatchObject({
            success: true,
            autorizacionDatos: { encendida: true, urlPolitica: URL_POLITICA, version: '1' },
        });
        const { where, create, update } = mockUpsert.mock.calls[0][0];
        expect(where).toEqual({ organizationId: 'org-1' });
        expect(update).toMatchObject({
            dataConsentEnabled: true,
            dataPolicyUrl: URL_POLITICA,
            dataPolicyVersion: '1',
            dataConsentUpdatedBy: 'admin@clinica.co',
        });
        expect(update.dataConsentUpdatedAt).toBeInstanceOf(Date);
        expect(create).toMatchObject({ organizationId: 'org-1', dataConsentEnabled: true });
        const log = mockLog.mock.calls[0][0].data;
        expect(log.action).toBe('DATA_CONSENT_CHANGED');
        expect(log.message).toMatch(/«Autorización de datos» encendida/);
    });

    it('cambiar la versión lo dice: a todos se les vuelve a preguntar', async () => {
        mockFindUnique.mockResolvedValue(guardada());
        await setMyAutorizacionDatos({ encendida: true, urlPolitica: URL_POLITICA, version: '2' });
        expect(mockLog.mock.calls[0][0].data.message).toMatch(/versión de la política: 1 → 2 \(se les vuelve a preguntar a todos\)/);
    });

    it('guardar lo mismo no es un cambio: ni actividad ni nueva fecha', async () => {
        mockFindUnique.mockResolvedValue(guardada());
        await setMyAutorizacionDatos({ encendida: true, urlPolitica: URL_POLITICA, version: '1' });
        expect(mockLog).not.toHaveBeenCalled();
        expect(mockUpsert.mock.calls[0][0].update).not.toHaveProperty('dataConsentUpdatedAt');
    });

    it('si la base falla, lo dice', async () => {
        mockUpsert.mockRejectedValue(new Error('caída'));
        expect(await setMyAutorizacionDatos({ encendida: false, urlPolitica: '', version: '1' })).toEqual({
            success: false,
            error: 'caída',
        });
    });

    it('getMyOrgSettings: sin fila, apagada y versión 1; con fila, lo guardado', async () => {
        mockFindUnique.mockResolvedValue(null);
        expect((await getMyOrgSettings()).autorizacionDatos).toEqual({
            encendida: false,
            urlPolitica: '',
            version: '1',
            ultimoCambio: null,
        });
        mockFindUnique.mockResolvedValue({ ...guardada(), organization: { timezone: null, name: 'Hospital X' } });
        const s = await getMyOrgSettings();
        expect(s.autorizacionDatos).toEqual({
            encendida: true,
            urlPolitica: URL_POLITICA,
            version: '1',
            ultimoCambio: { en: '2026-11-20T15:00:00.000Z', por: 'admin@clinica.co' },
        });
        expect(s.nombreClinica).toBe('Hospital X');
    });
});

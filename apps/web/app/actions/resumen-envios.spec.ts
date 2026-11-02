/**
 * @jest-environment node
 */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        hospitalMirrorConfig: { findUnique: jest.fn() },
        attentionSummary: { findMany: jest.fn() },
        $queryRaw: jest.fn(),
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => ({ get: () => ({ value: 'jwt-de-prueba' }) })),
}));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { listarEnviosAction, reenviarResumenAction } from './resumen-envios';

// «Envíos de documentos»: Administrador y Agente de Reservas, solo con el espejo
// de Anserma y el resumen habilitado; búsqueda por historia o cédula; reenviar
// exige la identidad verificada y lo hace la API.
const ID = '6f9619ff-8b86-d011-b42d-00cf4fc964ff';
const sesion = getSession as jest.Mock;
const espejo = prisma.hospitalMirrorConfig.findUnique as jest.Mock;
const findMany = prisma.attentionSummary.findMany as jest.Mock;
const queryRaw = prisma.$queryRaw as unknown as jest.Mock;

describe('acciones de «Envíos de documentos»', () => {
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;
    beforeEach(() => {
        jest.clearAllMocks();
        sesion.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1', userId: 'u-2' });
        espejo.mockResolvedValue({ driverKey: 'cnt-sanvicente-anserma', enabled: true, resumenAtencion: { leerDelHospital: true } });
        findMany.mockResolvedValue([]);
        queryRaw.mockResolvedValue([{ id: 'p-1' }]);
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterAll(() => {
        global.fetch = realFetch;
    });

    it('🔒 otro rol, otro HIS o sin la función habilitada: acceso denegado', async () => {
        sesion.mockResolvedValue({ role: 'DOCTOR', organizationId: 'org-1', userId: 'u' });
        await expect(listarEnviosAction()).resolves.toEqual({ success: false, error: 'Acceso denegado.' });
        sesion.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1', userId: 'u' });
        espejo.mockResolvedValue({ driverKey: 'cnt-sanvicente-anserma', enabled: true, resumenAtencion: null });
        await expect(listarEnviosAction()).resolves.toMatchObject({ success: false });
        expect(findMany).not.toHaveBeenCalled();
    });

    it('busca por número de historia o por la cédula de las fichas, solo en su clínica', async () => {
        await listarEnviosAction('0900000001');
        const where = findMany.mock.calls[0][0].where;
        expect(where).toEqual({ organizationId: 'org-1', OR: [{ hisKey: '0900000001' }, { patientProfileId: { in: ['p-1'] } }] });
        await expect(listarEnviosAction('abc')).resolves.toMatchObject({ success: false });
    });

    it('enmascara al paciente y no trae el contenido', async () => {
        findMany.mockResolvedValue([
            {
                id: ID,
                hisKey: '2441058',
                attendedAt: new Date('2026-11-01T14:00:00.000Z'),
                serviceCode: 'S39141',
                status: 'ENVIADO',
                statusReason: null,
                purgedAt: null,
                patientProfile: { fullName: 'Ana Pérez Gómez', cedula: '900000001' },
                deliveries: [],
            },
        ]);
        const r = await listarEnviosAction();
        if (!r.success) throw new Error(r.error);
        expect(r.atenciones[0].paciente).toEqual({ nombre: expect.not.stringContaining('Pérez'), documento: '•••0001' });
        expect(JSON.stringify(findMany.mock.calls[0][0].select)).not.toContain('content');
    });

    it('reenviar: sin identidad verificada no llama a la API; con ella, la API con la sesión', async () => {
        await expect(reenviarResumenAction(ID, false)).resolves.toMatchObject({ success: false });
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ enviados: ['TELEGRAM'] }) });
        await expect(reenviarResumenAction(ID, true)).resolves.toEqual({ success: true, enviados: ['TELEGRAM'] });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(new RegExp(`/attention-summaries/${ID}/resend$`));
        expect(init.headers).toEqual({ Cookie: 'auth_token=jwt-de-prueba' });
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ enviados: [], motivo: '«Enviar a pacientes» está apagado.' }) });
        await expect(reenviarResumenAction(ID, true)).resolves.toEqual({ success: false, error: '«Enviar a pacientes» está apagado.' });
    });
});

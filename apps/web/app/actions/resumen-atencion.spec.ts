/**
 * @jest-environment node
 */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        hospitalMirrorConfig: { findUnique: jest.fn(), update: jest.fn() },
        attentionSummary: { updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
        patientProfile: { findMany: jest.fn() },
        user: { findMany: jest.fn() },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('@/lib/actividad/registrar', () => ({ registrarActividad: jest.fn(async () => undefined) }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => ({ get: () => ({ value: 'jwt-de-prueba' }) })),
}));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { registrarActividad } from '@/lib/actividad/registrar';
import {
    abrirResumenAction,
    buscarResumenesAction,
    enviarDePruebaAction,
    revisarResumenAction,
    updateEnvioResumenAction,
} from './resumen-atencion';

/**
 * Revisión del resumen de la atención (cierre de la Fase 1). Lo que se fija:
 *  · solo el administrador de una clínica con el espejo de Anserma;
 *  · se revisa solo lo de SU clínica y con el contenido todavía guardado;
 *  · la nota (puede nombrar datos clínicos) no va a la bitácora;
 *  · abrir se lo pide a la API con la sesión y traduce sus respuestas.
 */
const ID = '6f9619ff-8b86-d011-b42d-00cf4fc964ff';
const mockSession = getSession as jest.Mock;
const mockEspejo = prisma.hospitalMirrorConfig.findUnique as jest.Mock;
const mockUpdateMany = prisma.attentionSummary.updateMany as jest.Mock;
const mockFindUnique = prisma.attentionSummary.findUnique as jest.Mock;
const mockActividad = registrarActividad as jest.Mock;

describe('acciones de revisión del resumen de la atención', () => {
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1', userId: 'u-1' });
        mockEspejo.mockResolvedValue({ driverKey: 'cnt-sanvicente-anserma', enabled: true });
        mockUpdateMany.mockResolvedValue({ count: 1 });
        mockFindUnique.mockResolvedValue({ hisKey: '2441058' });
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = realFetch;
    });

    it('🔒 otro rol, otra clínica sin el espejo de Anserma: no hace nada', async () => {
        mockSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1', userId: 'u-2' });
        await expect(revisarResumenAction(ID, { resultado: 'CORRECTO' })).resolves.toEqual({
            success: false,
            error: 'Acceso denegado.',
        });
        await expect(abrirResumenAction(ID)).resolves.toMatchObject({ success: false });

        mockSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1', userId: 'u-1' });
        mockEspejo.mockResolvedValue({ driverKey: 'otro-his', enabled: true });
        await expect(revisarResumenAction(ID, { resultado: 'CORRECTO' })).resolves.toMatchObject({ success: false });

        expect(mockUpdateMany).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('guarda la revisión solo en SU clínica y con el contenido guardado; la nota no va a la bitácora', async () => {
        await expect(revisarResumenAction(ID, { resultado: 'CON_ERROR', nota: 'Falta la loratadina' })).resolves.toEqual({
            success: true,
        });
        const arg = mockUpdateMany.mock.calls[0][0];
        expect(arg.where).toEqual({ id: ID, organizationId: 'org-1', purgedAt: null });
        expect(arg.data).toMatchObject({
            reviewResult: 'CON_ERROR',
            reviewNote: 'Falta la loratadina',
            reviewedByUserId: 'u-1',
        });
        expect(mockActividad).toHaveBeenCalledTimes(1);
        const actividad = mockActividad.mock.calls[0][0];
        expect(actividad).toMatchObject({
            action: 'ATTENTION_SUMMARY_REVIEWED',
            organizationId: 'org-1',
            metadata: { summaryId: ID, hisKey: '2441058', resultado: 'CON_ERROR' },
        });
        expect(JSON.stringify(actividad)).not.toMatch(/loratadina/);
    });

    it('«Con error» sin nota, un id raro o un resumen ajeno/borrado no se guardan', async () => {
        await expect(revisarResumenAction(ID, { resultado: 'CON_ERROR' })).resolves.toMatchObject({ success: false });
        await expect(revisarResumenAction('../../x', { resultado: 'CORRECTO' })).resolves.toMatchObject({ success: false });
        expect(mockUpdateMany).not.toHaveBeenCalled();

        mockUpdateMany.mockResolvedValue({ count: 0 });
        await expect(revisarResumenAction(ID, { resultado: 'CORRECTO' })).resolves.toEqual({
            success: false,
            error: 'El resumen no existe o su contenido ya se borró.',
        });
        expect(mockActividad).not.toHaveBeenCalled();
    });

    it('abrir: se lo pide a la API con la sesión y devuelve el resumen', async () => {
        const abierto = { resumen: { version: 1 }, hisKey: '2441058', version: 1, attendedAt: '2026-11-01T14:00:00.000Z' };
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => abierto });
        await expect(abrirResumenAction(ID)).resolves.toEqual({ success: true, abierto });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(new RegExp(`/attention-summaries/${ID}$`));
        expect(init.headers).toEqual({ Cookie: 'auth_token=jwt-de-prueba' });
    });

    it.each([
        [404, 'El resumen no existe.'],
        [410, 'El contenido de este resumen ya se borró (se guarda 30 días).'],
        [403, 'Sin permisos.'],
        [500, 'El servidor respondió 500.'],
    ])('abrir: la API responde %s → «%s»', async (status, error) => {
        fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) });
        await expect(abrirResumenAction(ID)).resolves.toEqual({ success: false, error });
    });

    it('abrir: un id que no es de un resumen no llega a la API', async () => {
        await expect(abrirResumenAction('../soporte')).resolves.toEqual({ success: false, error: 'El resumen no existe.' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    describe('envío (Fase 4)', () => {
        const mockUpdateConfig = prisma.hospitalMirrorConfig.update as jest.Mock;
        beforeEach(() => {
            mockEspejo.mockImplementation(async (args: { select: Record<string, boolean> }) =>
                args.select.resumenAtencion
                    ? { resumenAtencion: { leerDelHospital: true, servicios: { S39141: {} } } }
                    : { driverKey: 'cnt-sanvicente-anserma', enabled: true },
            );
        });

        it('«Enviar» sin números del equipo no se guarda', async () => {
            await expect(updateEnvioResumenAction({ enviar: true })).resolves.toMatchObject({ success: false });
            expect(mockUpdateConfig).not.toHaveBeenCalled();
        });

        it('con números del equipo se guarda y queda en la Actividad, sin números completos', async () => {
            await expect(
                updateEnvioResumenAction({ enviar: true, whatsapp: true, serviciosWhatsapp: ['S39141'], destinosPrueba: ['3001234567'] }),
            ).resolves.toEqual({ success: true });
            expect(mockUpdateConfig.mock.calls[0][0].data.resumenAtencion).toMatchObject({
                enviar: true,
                canales: { WHATSAPP: true },
                modoPrueba: { destinos: ['573001234567'] },
            });
            const actividad = mockActividad.mock.calls[0][0];
            expect(actividad.action).toBe('ATTENTION_SUMMARY_CONFIG_CHANGED');
            expect(JSON.stringify(actividad)).not.toContain('3001234567');
        });

        it('enviar de prueba: la API con la sesión; un número fuera de la lista lo dice', async () => {
            fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
            await expect(enviarDePruebaAction(ID, '573001234567')).resolves.toEqual({ success: true });
            const [url, init] = fetchMock.mock.calls[0];
            expect(String(url)).toMatch(new RegExp(`/attention-summaries/${ID}/test-send$`));
            expect(JSON.parse(init.body)).toEqual({ destino: '573001234567' });
            fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
            await expect(enviarDePruebaAction(ID, '3109998877')).resolves.toEqual({
                success: false,
                error: 'Solo se envía de prueba a un número de la lista del modo prueba.',
            });
            fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false, motivo: 'plantilla' }) });
            await expect(enviarDePruebaAction(ID, '573001234567')).resolves.toEqual({ success: false, error: 'El aviso no salió: plantilla' });
        });
    });
});

// 🔎 2026-11-26: la lista solo trae los 40 más recientes; se busca por la cédula
// del paciente o por el número de la consulta en el HIS.
describe('buscar resúmenes por cédula o número de consulta', () => {
    const mockPacientes = prisma.patientProfile.findMany as jest.Mock;
    const mockResumenes = prisma.attentionSummary.findMany as jest.Mock;
    const mockUsuarios = prisma.user.findMany as jest.Mock;
    const resumen = (over: Record<string, unknown> = {}) => ({
        id: 'r-1',
        hisKey: '2494585',
        serviceCode: 'S39141',
        attendedAt: new Date('2026-11-26T12:00:00Z'),
        version: 1,
        patientProfileId: 'pac-1',
        purgedAt: null,
        reviewResult: null,
        reviewNote: null,
        reviewedAt: null,
        reviewedByUserId: null,
        ...over,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1', userId: 'u-1' });
        mockEspejo.mockResolvedValue({ driverKey: 'cnt-sanvicente-anserma', enabled: true });
        mockPacientes.mockResolvedValue([]);
        mockResumenes.mockResolvedValue([]);
        mockUsuarios.mockResolvedValue([]);
    });

    it('🔒 solo el administrador de una clínica con el espejo de Anserma', async () => {
        mockSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1', userId: 'u-2' });
        await expect(buscarResumenesAction('24392385')).resolves.toEqual({ success: false, error: 'Acceso denegado.' });
        expect(mockResumenes).not.toHaveBeenCalled();
    });

    it.each(['', 'abc', '123', '0000', '1234567890123456'])('«%s» no se busca: pide la cédula o el número', async (texto) => {
        const r = await buscarResumenesAction(texto);
        expect(r).toMatchObject({ success: false, error: expect.stringContaining('cédula del paciente o el número de la consulta') });
        expect(mockPacientes).not.toHaveBeenCalled();
        expect(mockResumenes).not.toHaveBeenCalled();
    });

    it('por cédula (con puntos y ceros a la izquierda): las consultas del paciente, de SU clínica, y queda registrado enmascarado', async () => {
        mockPacientes.mockResolvedValue([{ id: 'pac-1' }]);
        mockResumenes.mockResolvedValue([resumen(), resumen({ id: 'r-2', hisKey: '2490001' })]);

        const r = await buscarResumenesAction(' 0.024.392.385 ');

        expect(mockPacientes).toHaveBeenCalledWith({
            where: { organizationId: 'org-1', cedula: { in: ['0024392385', '24392385'] } },
            select: { id: true },
        });
        const consulta = mockResumenes.mock.calls[0][0];
        expect(consulta.where).toEqual({
            organizationId: 'org-1',
            OR: [{ hisKey: '0024392385' }, { patientProfileId: { in: ['pac-1'] } }],
        });
        expect(consulta.orderBy).toEqual({ attendedAt: 'desc' });
        expect(consulta.take).toBe(50);
        // Solo datos de control: nunca el contenido.
        expect(consulta.select).not.toHaveProperty('content');
        expect(r).toMatchObject({
            success: true,
            busqueda: { numero: '0024392385', porDocumento: 2, porConsulta: 0, hayPaciente: true },
        });
        if (!r.success) throw new Error('esperaba éxito');
        expect(r.busqueda.filas.map((f) => f.historia)).toEqual(['2494585', '2490001']);
        expect(r.busqueda.filas[0]).toMatchObject({ servicio: 'S39141', conPaciente: true, contenidoDisponible: true, revision: null });

        expect(mockActividad).toHaveBeenCalledTimes(1);
        const actividad = mockActividad.mock.calls[0][0];
        expect(actividad).toMatchObject({
            action: 'ATTENTION_SUMMARY_SEARCHED',
            organizationId: 'org-1',
            actor: { userId: 'u-1', role: 'ORG_ADMIN' },
            metadata: { documento: '••••2385', resultados: 2 },
        });
        expect(JSON.stringify(actividad)).not.toContain('24392385');
    });

    it('por número de consulta: la de ese número, sin paciente que buscar ni registro', async () => {
        mockResumenes.mockResolvedValue([
            resumen({
                patientProfileId: null,
                reviewResult: 'CORRECTO',
                reviewedAt: new Date('2026-11-26T15:00:00Z'),
                reviewedByUserId: 'u-9',
            }),
        ]);
        mockUsuarios.mockResolvedValue([{ id: 'u-9', email: 'revisor@hospital.test' }]);

        const r = await buscarResumenesAction('2494585');

        expect(mockResumenes.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', OR: [{ hisKey: '2494585' }] });
        expect(r).toMatchObject({
            success: true,
            busqueda: { porConsulta: 1, porDocumento: 0, hayPaciente: false },
        });
        if (!r.success) throw new Error('esperaba éxito');
        expect(r.busqueda.filas[0]).toMatchObject({
            conPaciente: false,
            revision: { resultado: 'CORRECTO', quien: 'revisor@hospital.test' },
        });
        expect(mockActividad).not.toHaveBeenCalled();
    });
});

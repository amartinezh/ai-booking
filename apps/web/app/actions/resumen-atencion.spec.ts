/**
 * @jest-environment node
 */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        hospitalMirrorConfig: { findUnique: jest.fn(), update: jest.fn() },
        attentionSummary: { updateMany: jest.fn(), findUnique: jest.fn() },
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
import { abrirResumenAction, enviarDePruebaAction, revisarResumenAction, updateEnvioResumenAction } from './resumen-atencion';

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

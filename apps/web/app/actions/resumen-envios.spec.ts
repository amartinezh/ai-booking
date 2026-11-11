/**
 * @jest-environment node
 */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        hospitalMirrorConfig: { findUnique: jest.fn() },
        attentionSummary: { findMany: jest.fn() },
        attentionSummaryAccess: { groupBy: jest.fn(async () => []) },
        organization: { findUnique: jest.fn(async () => ({ timezone: null })) },
        $queryRaw: jest.fn(),
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
import { exportarEnviosAction, listarEnviosAction, reenviarResumenAction } from './resumen-envios';

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
        expect(r.atenciones[0].pagina).toEqual({ veces: 0, ultimaIso: null, descargas: 0 });
    });

    it('el recorrido de cada envío sale de los mensajes que llevan su id (WhatsApp y Telegram)', async () => {
        const envio = (id: string, channel: string) => ({
            id,
            channel,
            purpose: 'PACIENTE',
            destinationMasked: '•••4567',
            status: 'DOCUMENTOS_ENVIADOS',
            statusReason: null,
            noticeSentAt: new Date('2026-11-01T16:00:00.000Z'),
            requestedAt: new Date('2026-11-01T16:11:00.000Z'),
            verifiedAt: new Date('2026-11-01T16:12:00.000Z'),
            verifiedBy: 'FECHA_NACIMIENTO',
            documentsSentAt: new Date('2026-11-01T16:12:30.000Z'),
            templateName: 'documentos_consulta',
        });
        findMany.mockResolvedValue([
            {
                id: ID,
                hisKey: '2441058',
                attendedAt: new Date('2026-11-01T14:00:00.000Z'),
                serviceCode: 'S39141',
                status: 'ENVIADO',
                statusReason: null,
                purgedAt: null,
                patientProfile: null,
                deliveries: [envio('e-wa', 'WHATSAPP'), envio('e-tg', 'TELEGRAM')],
            },
        ]);
        const m = (entrega: string, canal: string, tipo: string, estado: string, extra: Record<string, unknown> = {}) => ({
            entrega,
            canal,
            tipo,
            estado,
            enviado: new Date('2026-11-01T16:00:00.000Z'),
            entregado: null,
            leido: null,
            error: null,
            ...extra,
        });
        queryRaw.mockResolvedValueOnce([
            m('e-wa', 'WHATSAPP', 'TEMPLATE', 'READ', { entregado: new Date('2026-11-01T16:00:05.000Z'), leido: new Date('2026-11-01T16:10:00.000Z') }),
            m('e-wa', 'WHATSAPP', 'TEXT', 'READ'),
            m('e-wa', 'WHATSAPP', 'DOCUMENT', 'READ', { leido: new Date('2026-11-01T16:20:00.000Z') }),
            m('e-wa', 'WHATSAPP', 'IMAGE', 'DELIVERED', { entregado: new Date('2026-11-01T16:13:00.000Z') }),
            m('e-wa', 'WHATSAPP', 'IMAGE', 'FAILED', { error: '131053 Media upload error' }),
            m('e-tg', 'TELEGRAM', 'TEXT', 'ACCEPTED'),
            m('e-tg', 'TELEGRAM', 'DOCUMENT', 'ACCEPTED'),
            m('e-tg', 'TELEGRAM', 'PHOTO', 'ACCEPTED'),
        ]);
        const r = await listarEnviosAction();
        if (!r.success) throw new Error(r.error);
        const [wa, tg] = r.atenciones[0].envios;
        expect(wa.traza.aviso).toEqual({
            tipo: 'PLANTILLA',
            enviadoIso: '2026-11-01T16:00:00.000Z',
            entregadoIso: '2026-11-01T16:00:05.000Z',
            leidoIso: '2026-11-01T16:10:00.000Z',
            estado: 'READ',
            error: null,
        });
        expect(wa.traza.pidioIso).toBe('2026-11-01T16:11:00.000Z');
        expect(wa.traza.verificadoIso).toBe('2026-11-01T16:12:00.000Z');
        expect(wa.traza.archivos).toEqual({ enviados: 2, entregados: 2, leidos: 1, fallidos: 1 });
        expect(tg.traza.aviso).toMatchObject({ tipo: 'TELEGRAM', estado: 'ACCEPTED', entregadoIso: null, leidoIso: null });
        expect(tg.traza.archivos).toEqual({ enviados: 2, entregados: 0, leidos: 0, fallidos: 0 });
    });

    it('el registro para descargar: fechas válidas, hasta 92 días, y queda anotado quién lo bajó', async () => {
        await expect(exportarEnviosAction('2026-11-10', '2026-11-01')).resolves.toMatchObject({ success: false });
        await expect(exportarEnviosAction('2026-08-01', '2026-11-10')).resolves.toEqual({ success: false, error: 'Máximo 92 días por archivo.' });
        await expect(exportarEnviosAction('ayer', '2026-11-10')).resolves.toMatchObject({ success: false });
        expect(findMany).not.toHaveBeenCalled();

        const r = await exportarEnviosAction('2026-11-01', '2026-11-10');
        expect(r).toEqual({ success: true, atenciones: [], truncado: false });
        // Del 1 de noviembre a las 00:00 al 11 a las 00:00, hora de Bogotá.
        expect(findMany.mock.calls[0][0].where).toEqual({
            organizationId: 'org-1',
            receivedAt: { gte: new Date('2026-11-01T05:00:00.000Z'), lt: new Date('2026-11-11T05:00:00.000Z') },
        });
        expect(registrarActividad).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'DATA_EXPORTED', metadata: expect.objectContaining({ tipo: 'ENVIOS_RESUMEN', filas: 0 }) }),
        );
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

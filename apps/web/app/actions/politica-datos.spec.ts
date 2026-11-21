jest.mock('@/lib/prisma', () => ({
    prisma: {
        organization: { findUnique: jest.fn() },
        organizationSettings: { upsert: jest.fn() },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({
    headers: jest.fn(async () => new Map([['host', 'app.hsvpanserma.agenia.co']])),
}));

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../lib/session';
import { getMyPaginaPoliticaDatos, setMyPaginaPoliticaDatos } from './politica-datos';

const mockGetSession = getSession as jest.Mock;
const mockOrg = prisma.organization.findUnique as jest.Mock;
const mockUpsert = prisma.organizationSettings.upsert as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;

const ORG = '97f18182-d0d9-4a3b-9eb6-4fbc031b917c';
const ADMIN = { role: 'ORG_ADMIN', organizationId: ORG, email: 'admin@clinica.co', userId: 'u1' };
const DATOS = {
    razonSocial: 'E.S.E. Hospital San Vicente de Paúl de Anserma',
    nit: null,
    municipio: 'Anserma, Caldas',
    direccion: 'Carrera 5 Calle 1 Bis',
    telefono: '(606) 853 8860',
    correo: 'siau@hsvpanserma.gov.co',
    area: 'Oficina de Atención al Usuario (SIAU)',
    horario: null,
    vigenteDesde: '2026-12-01',
};

describe('acciones — página pública de la política de datos', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetSession.mockResolvedValue(ADMIN);
        mockOrg.mockResolvedValue({ timezone: 'America/Bogota', settings: null });
        mockUpsert.mockImplementation(async ({ update }) => ({
            dataPolicyPage: update.dataPolicyPage,
            dataPolicyPageUpdatedAt: update.dataPolicyPageUpdatedAt ?? null,
            dataPolicyPageUpdatedBy: update.dataPolicyPageUpdatedBy ?? null,
        }));
    });

    it.each(['BOOKING_AGENT', 'DOCTOR', 'SUPER_ADMIN'])('solo el ORG_ADMIN la ve y la cambia (%s no)', async (role) => {
        mockGetSession.mockResolvedValue({ role, organizationId: ORG });
        await expect(getMyPaginaPoliticaDatos()).rejects.toThrow('Acceso denegado');
        expect(await setMyPaginaPoliticaDatos(DATOS)).toEqual({ success: false, error: 'Acceso denegado' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('sin datos: sin publicar, con el enlace completo y el formulario vacío', async () => {
        const p = await getMyPaginaPoliticaDatos();
        expect(p).toMatchObject({
            publicada: false,
            ruta: `/politica-de-datos/${ORG}`,
            enlace: `https://app.hsvpanserma.agenia.co/politica-de-datos/${ORG}`,
            ultimoCambio: null,
        });
        expect(p.datos.razonSocial).toBe('');
        expect(p.hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('con datos completos: publicada y con el último cambio', async () => {
        mockOrg.mockResolvedValue({
            timezone: null,
            settings: {
                dataPolicyPage: DATOS,
                dataPolicyPageUpdatedAt: new Date('2026-11-20T17:00:00Z'),
                dataPolicyPageUpdatedBy: 'admin@clinica.co',
            },
        });
        expect(await getMyPaginaPoliticaDatos()).toMatchObject({
            publicada: true,
            datos: { razonSocial: DATOS.razonSocial, nit: '' },
            ultimoCambio: { en: '2026-11-20T17:00:00.000Z', por: 'admin@clinica.co' },
        });
    });

    it('datos incompletos no se guardan y dicen qué campo falta', async () => {
        const r = await setMyPaginaPoliticaDatos({ ...DATOS, correo: '' });
        expect(r).toMatchObject({ success: false, campo: 'correo' });
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('la publica en la clínica de la sesión, anota quién y lo deja en la actividad', async () => {
        const r = await setMyPaginaPoliticaDatos({ ...DATOS, nit: '', horario: '' });
        expect(r).toMatchObject({ success: true, pagina: { publicada: true } });
        const { where, create, update } = mockUpsert.mock.calls[0][0];
        expect(where).toEqual({ organizationId: ORG });
        expect(update.dataPolicyPage).toEqual(DATOS);
        expect(update.dataPolicyPageUpdatedBy).toBe('admin@clinica.co');
        expect(update.dataPolicyPageUpdatedAt).toBeInstanceOf(Date);
        expect(create).toMatchObject({ organizationId: ORG, dataPolicyPage: DATOS });
        const log = mockLog.mock.calls[0][0].data;
        expect(log.action).toBe('DATA_POLICY_PAGE_CHANGED');
        expect(log.message).toMatch(/publicada/);
        // Con 'layout': refresca todas las secciones de Configuración (docs/PLAN_NAVEGACION.md §5).
        expect(revalidatePath).toHaveBeenCalledWith('/dashboard/configuracion', 'layout');
    });

    it('cambiar un dato dice cuál; guardar lo mismo no es un cambio', async () => {
        mockOrg.mockResolvedValue({ timezone: null, settings: { dataPolicyPage: DATOS } });
        await setMyPaginaPoliticaDatos({ ...DATOS, correo: 'datos@hsvpanserma.gov.co' });
        expect(mockLog.mock.calls[0][0].data.message).toMatch(/cambió \(Correo para consultas/);

        jest.clearAllMocks();
        mockOrg.mockResolvedValue({ timezone: null, settings: { dataPolicyPage: DATOS } });
        await setMyPaginaPoliticaDatos(DATOS);
        expect(mockUpsert.mock.calls[0][0].update.dataPolicyPageUpdatedAt).toBeUndefined();
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('si la base falla, lo dice sin romper', async () => {
        mockUpsert.mockRejectedValue(new Error('se cayó la base'));
        expect(await setMyPaginaPoliticaDatos(DATOS)).toEqual({ success: false, error: 'se cayó la base' });
    });
});

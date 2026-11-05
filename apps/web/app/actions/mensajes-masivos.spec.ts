jest.mock('@/lib/prisma', () => ({
    prisma: {
        massContactList: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        massContact: { createMany: jest.fn(), count: jest.fn() },
        massCampaign: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
        patientProfile: { findMany: jest.fn(async () => []) },
        massMessageOptOut: { upsert: jest.fn() },
        $transaction: jest.fn(async () => []),
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn(async () => ({ get: () => ({ value: 'tok' }) })) }));
jest.mock('@/lib/actividad/registrar', () => ({
    registrarActividad: jest.fn(async () => undefined),
    actorDeSesion: (s: { userId: string; role: string }) => ({ userId: s.userId, role: s.role }),
}));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { registrarActividad } from '@/lib/actividad/registrar';
import {
    confirmarEnvio,
    eliminarLista,
    guardarListaDeContactos,
    registrarBaja,
    subirImagen,
} from './mensajes-masivos';

const sesion = getSession as jest.Mock;
const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', userId: 'u1', email: 'admin@clinica.co' };
const CONTACTO = { nombreCompleto: 'ANA PÉREZ', primerNombre: 'Ana', celular: '300 123 4567', correo: 'ANA@X.CO', documento: null, extras: {} };
const CONSENTIMIENTO = 'Firmaron la autorización de datos con comunicados por WhatsApp.';

describe('Mensajes masivos — acciones (docs/PLAN_MENSAJES_MASIVOS.md)', () => {
    const realFetch = global.fetch;
    beforeEach(() => {
        jest.clearAllMocks();
        sesion.mockResolvedValue(ADMIN);
        db.massContactList.create.mockResolvedValue({ id: 'lista-1' });
        db.massContact.createMany.mockResolvedValue({ count: 1 });
        db.massContact.count.mockResolvedValue(1);
    });
    afterEach(() => {
        global.fetch = realFetch;
    });

    it.each(['BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER'] as const)('%s no puede usarlos', async (role) => {
        sesion.mockResolvedValue({ ...ADMIN, role });
        expect(await guardarListaDeContactos({ nombre: 'x', consentimiento: CONSENTIMIENTO, contactos: [CONTACTO] })).toEqual({ success: false, error: 'Acceso denegado.' });
        expect(await registrarBaja('3001234567', '')).toEqual({ success: false, error: 'Acceso denegado.' });
        expect(db.massContactList.create).not.toHaveBeenCalled();
    });

    it('sin decir de dónde salen los contactos (Ley 1581) no se guarda la lista', async () => {
        const r = await guardarListaDeContactos({ nombre: 'Jornada', consentimiento: 'sí', contactos: [CONTACTO] });
        expect(r).toMatchObject({ success: false, error: expect.stringContaining('Ley 1581') });
        expect(db.massContactList.create).not.toHaveBeenCalled();
    });

    it('vuelve a normalizar cada contacto y descarta lo que el navegador mandó mal', async () => {
        const r = await guardarListaDeContactos({
            nombre: '  Jornada   de vacunación ',
            consentimiento: CONSENTIMIENTO,
            contactos: [CONTACTO, { ...CONTACTO, celular: '573001234567' }, { ...CONTACTO, celular: '6018765432' }],
        });
        expect(r).toEqual({ success: true, listaId: 'lista-1', agregados: 1, repetidos: 0, descartados: 1 });
        expect(db.massContactList.create.mock.calls[0][0].data).toMatchObject({
            organizationId: 'org-1',
            name: 'Jornada de vacunación',
            consentNote: CONSENTIMIENTO,
            consentAttestedBy: 'admin@clinica.co',
        });
        const filas = db.massContact.createMany.mock.calls[0][0].data;
        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({ phoneE164: '+573001234567', fullName: 'Ana Pérez', email: 'ana@x.co', organizationId: 'org-1' });
        expect(registrarActividad).toHaveBeenCalledWith(expect.objectContaining({ action: 'MASS_CONTACT_LIST_SAVED' }));
    });

    it('agregar a una lista de otra clínica no se puede', async () => {
        db.massContactList.findFirst.mockResolvedValue(null);
        expect(await guardarListaDeContactos({ listaId: 'ajena', contactos: [CONTACTO] })).toEqual({ success: false, error: 'La lista no existe.' });
        expect(db.massContactList.findFirst.mock.calls[0][0].where).toEqual({ id: 'ajena', organizationId: 'org-1' });
    });

    it('la imagen se revisa por sus bytes: un WebP con nombre .jpg no entra', async () => {
        db.massCampaign.findFirst.mockResolvedValue({ id: 'e1', status: 'BORRADOR' });
        const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
        const form = new FormData();
        form.append('imagen', new Blob([webp], { type: 'image/jpeg' }), 'foto.jpg');
        const r = await subirImagen('e1', form);
        expect(r).toMatchObject({ success: false, error: expect.stringContaining('JPEG o PNG') });
        expect(db.massCampaign.update).not.toHaveBeenCalled();
    });

    it('un JPEG real se guarda y borra el id viejo de Meta', async () => {
        db.massCampaign.findFirst.mockResolvedValue({ id: 'e1', status: 'BORRADOR' });
        db.massCampaign.update.mockResolvedValue({ updatedAt: new Date(5) });
        const form = new FormData();
        form.append('imagen', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])]), 'x');
        form.append('ancho', '1200');
        form.append('alto', '628');
        const r = await subirImagen('e1', form);
        expect(r).toEqual({ success: true, url: '/dashboard/mensajes-masivos/imagen/e1?v=5' });
        expect(db.massCampaign.update.mock.calls[0][0].data).toMatchObject({ imageMime: 'image/jpeg', imageWidth: 1200, imageHeight: 628, imageMediaId: null });
    });

    it('confirmar exige la autorización y pasa la cantidad escrita a la API', async () => {
        expect(await confirmarEnvio('e1', { confirmacion: 3, autorizacion: false })).toMatchObject({ success: false });
        const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ estado: 'EN_COLA', aEnviar: 3, saleDesde: 'x' }) }));
        global.fetch = fetchMock as unknown as typeof fetch;
        const r = await confirmarEnvio('e1', { confirmacion: 3, autorizacion: true });
        expect(r).toEqual({ success: true, aEnviar: 3, saleDesde: 'x' });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain('/mass-messages/envios/e1/iniciar');
        expect(JSON.parse(init.body as string)).toEqual({ confirmacion: 3 });
        expect((init.headers as Record<string, string>).Cookie).toBe('auth_token=tok');
    });

    it('el error de la API llega tal cual a la pantalla', async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: 'Para confirmar escriba 2.' }) })) as unknown as typeof fetch;
        expect(await confirmarEnvio('e1', { confirmacion: 3, autorizacion: true })).toEqual({ success: false, error: 'Para confirmar escriba 2.' });
    });

    it('una lista ya usada en un envío se conserva como constancia', async () => {
        db.massContactList.findFirst.mockResolvedValue({ id: 'l1', name: 'Jornada', contactsCount: 3 });
        db.massCampaign.count.mockResolvedValue(1);
        expect(await eliminarLista('l1')).toMatchObject({ success: false, error: expect.stringContaining('constancia') });
        expect(db.massContactList.delete).not.toHaveBeenCalled();
    });

    it('una baja registrada en el panel guarda el celular en E.164', async () => {
        expect(await registrarBaja('300 123 4567', 'Llamó a pedirlo')).toEqual({ success: true });
        expect(db.massMessageOptOut.upsert.mock.calls[0][0].create).toEqual({
            organizationId: 'org-1',
            destination: '+573001234567',
            source: 'PANEL',
            note: 'Llamó a pedirlo',
        });
        expect(await registrarBaja('6018765432', '')).toMatchObject({ success: false });
    });
});

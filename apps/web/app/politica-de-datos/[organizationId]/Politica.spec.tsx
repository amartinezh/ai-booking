import { render, screen, within } from '@testing-library/react';

jest.mock('@/lib/prisma', () => ({ prisma: { organization: { findUnique: jest.fn() } } }));
jest.mock('next/navigation', () => ({
    notFound: jest.fn(() => {
        throw new Error('NEXT_NOT_FOUND');
    }),
}));

import { prisma } from '@/lib/prisma';
import { documentoPolitica } from '@/lib/politica-datos/documento';
import Politica from './Politica';
import PoliticaDeDatosPage, { generateMetadata } from './page';

const mockOrg = prisma.organization.findUnique as jest.Mock;
const ORG = '97f18182-d0d9-4a3b-9eb6-4fbc031b917c';
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
const params = (organizationId: string) => ({ params: Promise.resolve({ organizationId }) });

describe('página pública de la política de datos', () => {
    beforeEach(() => jest.clearAllMocks());

    it('muestra el título, el resumen, el contenido y cada sección numerada', () => {
        const documento = documentoPolitica({ datos: DATOS, version: '1', asistente: 'Vicente' });
        render(<Politica documento={documento} />);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Política de tratamiento de datos personales');
        expect(screen.getAllByText(/Vigente desde el 1 de diciembre de 2026/)[0]).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'En pocas palabras' })).toBeInTheDocument();
        const indice = screen.getByRole('navigation');
        expect(within(indice).getAllByRole('link')).toHaveLength(documento.secciones.length);
        expect(screen.getByRole('heading', { name: '1. Quién es el responsable de sus datos' })).toBeInTheDocument();
        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Imprimir o guardar en PDF/ })).toBeInTheDocument();
    });

    it('con los datos completos arma la página con la versión y el asistente de la clínica', async () => {
        mockOrg.mockResolvedValue({
            isActive: true,
            settings: { botName: 'Vicente', dataPolicyVersion: '3', dataPolicyPage: DATOS },
        });
        render(await PoliticaDeDatosPage(params(ORG)));
        expect(screen.getAllByText(/Versión 3/)[0]).toBeInTheDocument();
        expect(screen.getAllByText(/asistente virtual Vicente/)[0]).toBeInTheDocument();
        const meta = await generateMetadata(params(ORG));
        expect(meta.title).toBe(`Política de tratamiento de datos personales · ${DATOS.razonSocial}`);
    });

    it.each([
        ['un id que no es de clínica', 'no-es-uuid', null],
        ['una clínica que no existe', ORG, null],
        ['una clínica suspendida', ORG, { isActive: false, settings: { dataPolicyPage: DATOS } }],
        ['datos incompletos', ORG, { isActive: true, settings: { dataPolicyPage: { ...DATOS, area: '' } } }],
        ['sin datos', ORG, { isActive: true, settings: null }],
    ])('con %s no existe (404)', async (_caso, id, org) => {
        mockOrg.mockResolvedValue(org);
        await expect(PoliticaDeDatosPage(params(id))).rejects.toThrow('NEXT_NOT_FOUND');
        expect((await generateMetadata(params(id))).robots).toEqual({ index: false, follow: false });
    });
});

import { render, screen, within } from '@testing-library/react';

jest.mock('@/lib/autorizacion-datos/cifras', () => ({
    PERIODOS_AUTORIZACION: [7, 30, 90],
    cargarAutorizaciones: jest.fn(),
}));

import AutorizacionDatosCifras from './AutorizacionDatosCifras';
import { cargarAutorizaciones } from '@/lib/autorizacion-datos/cifras';
import { cifrasDeAutorizaciones } from '@agenia/shared';

const mockCargar = cargarAutorizaciones as jest.Mock;
const ahora = new Date('2026-11-20T20:00:00Z');

async function pintar(dias: 7 | 30 | 90 = 30) {
    render(await AutorizacionDatosCifras({ organizationId: 'org-1', dias }));
}

describe('AutorizacionDatosCifras (Canales en vivo)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('muestra las cifras, por canal y por día, con el período elegido', async () => {
        mockCargar.mockResolvedValue({
            encendida: true,
            version: '1',
            dias: 7,
            desde: '2026-11-14',
            cifras: cifrasDeAutorizaciones(
                [
                    { estado: 'ACCEPTED', remitente: 'a', canal: 'WHATSAPP', preguntadaEn: new Date('2026-11-20T15:00:00Z'), respondidaEn: new Date('2026-11-20T15:01:00Z') },
                    { estado: 'REJECTED', remitente: 'b', canal: 'WHATSAPP', preguntadaEn: new Date('2026-11-20T16:00:00Z'), respondidaEn: new Date('2026-11-20T16:01:00Z') },
                    { estado: 'ACCEPTED', remitente: 'c', canal: 'TELEGRAM', preguntadaEn: new Date('2026-11-19T16:00:00Z'), respondidaEn: new Date('2026-11-19T16:01:00Z') },
                ],
                ahora,
                'America/Bogota',
            ),
        });
        await pintar(7);
        expect(mockCargar).toHaveBeenCalledWith('org-1', 7);
        expect(screen.getByText(/Encendida \(versión 1 de la política\)/)).toBeInTheDocument();
        const aceptaron = screen.getByText('Aceptaron', { selector: 'dt' }).parentElement!;
        expect(within(aceptaron).getByText('2')).toBeInTheDocument();
        expect(screen.getByText('66.7%')).toBeInTheDocument();
        const porCanal = screen.getByRole('table', { name: 'Autorización por canal' });
        expect(within(porCanal).getByText('💬 WhatsApp').closest('tr')).toHaveTextContent('2110');
        expect(screen.getByRole('table', { name: 'Autorización por día' })).toHaveTextContent('20 nov');
        expect(screen.getByRole('link', { name: '7 días' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: '90 días' })).toHaveAttribute('href', '/dashboard/canales?autorizacion=90');
    });

    it('apagada y sin preguntas: dice cómo encenderla', async () => {
        mockCargar.mockResolvedValue({
            encendida: false,
            version: '1',
            dias: 30,
            desde: '2026-10-22',
            cifras: cifrasDeAutorizaciones([], ahora),
        });
        await pintar();
        expect(screen.getByText(/Se enciende en Configuración › Asistente Virtual/)).toBeInTheDocument();
        expect(screen.getByText('Sin preguntas en este período.')).toBeInTheDocument();
    });

    it('si la consulta falla, solo esta sección lo dice', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        mockCargar.mockRejectedValue(new Error('caída'));
        await pintar();
        expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las cifras');
    });
});

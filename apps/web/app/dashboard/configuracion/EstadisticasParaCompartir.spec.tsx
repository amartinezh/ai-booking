import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/estadisticas', () => ({
    setMyClaveEstadisticas: jest.fn(async () => ({
        success: true,
        cambiadaEn: '2026-10-26T15:00:00.000Z',
        cambiadaPor: 'admin@hsvpanserma.gov.co',
    })),
    quitarMyClaveEstadisticas: jest.fn(async () => ({
        success: true,
        cambiadaEn: '2026-10-26T16:00:00.000Z',
        cambiadaPor: 'admin@hsvpanserma.gov.co',
    })),
}));

import EstadisticasParaCompartir from './EstadisticasParaCompartir';
import { quitarMyClaveEstadisticas, setMyClaveEstadisticas } from '@/app/actions/estadisticas';

const RUTA = '/estadisticas/97f18182-d0d9-4a3b-9eb6-4fbc031b917c';
const cerrada = { abierta: false, ruta: RUTA, enlace: `https://app.hsvpanserma.agenia.co${RUTA}`, cambiadaEn: null, cambiadaPor: null };

describe('EstadisticasParaCompartir — Configuración', () => {
    beforeEach(() => jest.clearAllMocks());

    it('nace cerrada: sin enlace, y pide una clave para abrirla', () => {
        render(<EstadisticasParaCompartir inicial={cerrada} />);
        expect(screen.getByText(/Cerrada: nadie la puede ver/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Enlace de la página')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Abrir la página' })).toBeDisabled();
    });

    it('al poner la clave se abre y muestra el enlace completo y quién la cambió', async () => {
        render(<EstadisticasParaCompartir inicial={cerrada} />);
        await userEvent.type(screen.getByLabelText('Clave para abrir la página'), 'Anserma2026');
        await userEvent.click(screen.getByRole('button', { name: 'Abrir la página' }));
        await waitFor(() => expect(screen.getByText(/Abierta con clave/)).toBeInTheDocument());
        expect(setMyClaveEstadisticas).toHaveBeenCalledWith('Anserma2026');
        expect(screen.getByLabelText('Enlace de la página')).toHaveValue(`https://app.hsvpanserma.agenia.co${RUTA}`);
        expect(screen.getByText(/Último cambio: admin@hsvpanserma.gov.co/)).toBeInTheDocument();
        // La clave no queda escrita en la pantalla.
        expect(screen.getByLabelText('Clave nueva')).toHaveValue('');
    });

    it('cerrarla pide confirmación', async () => {
        render(<EstadisticasParaCompartir inicial={{ ...cerrada, abierta: true }} />);
        await userEvent.click(screen.getByRole('button', { name: 'Cerrar la página' }));
        expect(quitarMyClaveEstadisticas).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Sí, cerrar' }));
        await waitFor(() => expect(screen.getByText(/Cerrada: nadie la puede ver/)).toBeInTheDocument());
        expect(quitarMyClaveEstadisticas).toHaveBeenCalled();
    });

    it('si el servidor rechaza la clave, lo dice y la página sigue como estaba', async () => {
        (setMyClaveEstadisticas as jest.Mock).mockResolvedValueOnce({
            success: false,
            error: 'La clave debe tener al menos 6 caracteres.',
        });
        render(<EstadisticasParaCompartir inicial={cerrada} />);
        await userEvent.type(screen.getByLabelText('Clave para abrir la página'), 'abc');
        await userEvent.click(screen.getByRole('button', { name: 'Abrir la página' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('al menos 6 caracteres');
        expect(screen.getByText(/Cerrada: nadie la puede ver/)).toBeInTheDocument();
    });
});

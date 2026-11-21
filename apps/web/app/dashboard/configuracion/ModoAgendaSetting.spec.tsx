import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/espejo', () => ({ cambiarModoAgenda: jest.fn() }));

import ModoAgendaSetting from './ModoAgendaSetting';
import { cambiarModoAgenda } from '@/app/actions/espejo';

const cambiar = cambiarModoAgenda as jest.Mock;

/** Modo de agenda del espejo, en Configuración › Hospital (espejo). */
describe('ModoAgendaSetting', () => {
    let confirmar: jest.SpyInstance;
    beforeEach(() => {
        jest.clearAllMocks();
        confirmar = jest.spyOn(window, 'confirm').mockReturnValue(true);
    });
    afterEach(() => confirmar.mockRestore());

    it('marca el modo actual, lo explica y no deja volver a elegirlo', () => {
        render(<ModoAgendaSetting inicial="SHADOW" />);
        expect(screen.getByRole('button', { name: 'SHADOW' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'SHADOW' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'ON' })).toBeEnabled();
        expect(screen.getByText(/Modo sombra/)).toBeInTheDocument();
    });

    it('pide confirmación, cambia y dice cuándo lo recoge el agente', async () => {
        cambiar.mockResolvedValue({ success: true });
        render(<ModoAgendaSetting inicial="SHADOW" />);
        await userEvent.click(screen.getByRole('button', { name: 'ON' }));
        expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('al menos una semana en modo SHADOW'));
        expect(cambiar).toHaveBeenCalledWith('ON');
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('cambiado a ON'));
        expect(screen.getByRole('button', { name: 'ON' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('si no se confirma, no cambia nada', async () => {
        confirmar.mockReturnValue(false);
        render(<ModoAgendaSetting inicial="OFF" />);
        await userEvent.click(screen.getByRole('button', { name: 'ON' }));
        expect(cambiar).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'OFF' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('si falla, sigue en el modo que de verdad quedó y lo dice', async () => {
        cambiar.mockResolvedValue({ success: false, error: 'Sin permisos.' });
        render(<ModoAgendaSetting inicial="OFF" />);
        await userEvent.click(screen.getByRole('button', { name: 'SHADOW' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Sin permisos.');
        expect(screen.getByRole('button', { name: 'OFF' })).toHaveAttribute('aria-pressed', 'true');
    });
});

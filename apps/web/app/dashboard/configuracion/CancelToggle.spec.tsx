import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyCancelEnabled: jest.fn(),
}));

import CancelToggle from './CancelToggle';
import { setMyCancelEnabled } from '@/app/actions/settings';

const mockSet = setMyCancelEnabled as jest.Mock;

/** Interruptor de cancelar por el bot: guarda al instante. */
describe('CancelToggle', () => {
    beforeEach(() => jest.clearAllMocks());

    it('se presenta con su operación y su estado', () => {
        render(<CancelToggle initialEnabled />);
        expect(screen.getByText('Cancelar citas por el asistente')).toBeInTheDocument();
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText('Encendido')).toBeInTheDocument();
    });

    it('apagar guarda al instante, sin botón «Guardar»', async () => {
        mockSet.mockResolvedValue({ success: true, cancelEnabled: false });
        render(<CancelToggle initialEnabled />);

        await userEvent.click(screen.getByRole('switch'));

        expect(mockSet).toHaveBeenCalledWith(false);
        await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
        expect(screen.getByText('Apagado')).toBeInTheDocument();
    });

    it('prender guarda al instante', async () => {
        mockSet.mockResolvedValue({ success: true, cancelEnabled: true });
        render(<CancelToggle initialEnabled={false} />);

        await userEvent.click(screen.getByRole('switch'));

        expect(mockSet).toHaveBeenCalledWith(true);
        await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    });

    it('si no se guarda, el interruptor sigue mostrando lo que de verdad quedó y avisa', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<CancelToggle initialEnabled />);

        await userEvent.click(screen.getByRole('switch'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado');
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });
});

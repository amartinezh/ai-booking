import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyBookingEnabled: jest.fn(),
}));

import BookingToggle from './BookingToggle';
import { setMyBookingEnabled } from '@/app/actions/settings';

const mockSet = setMyBookingEnabled as jest.Mock;

/** Interruptor de agendar/cancelar/cambiar por el bot: guarda al instante. */
describe('BookingToggle', () => {
    beforeEach(() => jest.clearAllMocks());

    it('apagado se muestra como «Solo consultas»', () => {
        render(<BookingToggle initialEnabled={false} />);
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('Solo consultas')).toBeInTheDocument();
    });

    it('apagar guarda al instante, sin botón «Guardar»', async () => {
        mockSet.mockResolvedValue({ success: true, bookingEnabled: false });
        render(<BookingToggle initialEnabled />);

        await userEvent.click(screen.getByRole('switch'));

        expect(mockSet).toHaveBeenCalledWith(false);
        await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
        expect(screen.getByText('Solo consultas')).toBeInTheDocument();
    });

    it('si no se guarda, el interruptor sigue mostrando lo que de verdad quedó y avisa', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<BookingToggle initialEnabled />);

        await userEvent.click(screen.getByRole('switch'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado');
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyRemindersEnabled: jest.fn(),
}));

import RemindersToggle from './RemindersToggle';
import { setMyRemindersEnabled } from '@/app/actions/settings';

const mockSet = setMyRemindersEnabled as jest.Mock;

/** Interruptor de los recordatorios automáticos: guarda al instante. */
describe('RemindersToggle', () => {
    beforeEach(() => jest.clearAllMocks());

    it('muestra el estado guardado', () => {
        render(<RemindersToggle initialEnabled={false} />);
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('Apagados')).toBeInTheDocument();
    });

    it('apagar guarda al instante, sin botón «Guardar»', async () => {
        mockSet.mockResolvedValue({ success: true, remindersEnabled: false });
        render(<RemindersToggle initialEnabled />);

        await userEvent.click(screen.getByRole('switch'));

        expect(mockSet).toHaveBeenCalledWith(false);
        await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
    });

    it('encender guarda true', async () => {
        mockSet.mockResolvedValue({ success: true, remindersEnabled: true });
        render(<RemindersToggle initialEnabled={false} />);

        await userEvent.click(screen.getByRole('switch'));

        expect(mockSet).toHaveBeenCalledWith(true);
        await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    });

    it('si no se guarda, el interruptor sigue mostrando lo que de verdad quedó y avisa', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<RemindersToggle initialEnabled />);

        await userEvent.click(screen.getByRole('switch'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado');
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });
});

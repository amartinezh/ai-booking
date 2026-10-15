import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyRemindersOnlySelfBooked: jest.fn(),
}));

import SelfBookedRemindersToggle from './SelfBookedRemindersToggle';
import { setMyRemindersOnlySelfBooked } from '@/app/actions/settings';

const mockSet = setMyRemindersOnlySelfBooked as jest.Mock;

/** «Recordatorios solo a pacientes que agendaron ellos mismos»: guarda al instante. */
describe('SelfBookedRemindersToggle', () => {
    beforeEach(() => jest.clearAllMocks());

    it('apagado muestra que el recordatorio va a todas las citas', () => {
        render(<SelfBookedRemindersToggle initialEnabled={false} />);
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('Apagado: todas las citas')).toBeInTheDocument();
    });

    it('encender guarda true al instante y explica a quién le llega', async () => {
        mockSet.mockResolvedValue({ success: true, remindersOnlySelfBooked: true });
        render(<SelfBookedRemindersToggle initialEnabled={false} />);

        await userEvent.click(screen.getByRole('switch'));

        expect(mockSet).toHaveBeenCalledWith(true);
        await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
        expect(screen.getByText(/solo las citas que el paciente agendó por WhatsApp o Telegram/)).toBeInTheDocument();
    });

    it('aclara que no cambia ninguna otra operación ni el recordatorio manual', () => {
        render(<SelfBookedRemindersToggle initialEnabled />);
        expect(screen.getByText(/No cambia cómo se agendan, cancelan o atienden las citas/)).toBeInTheDocument();
        expect(screen.getByText(/recordatorio manual de la agenda sigue funcionando/)).toBeInTheDocument();
    });

    it('si no se guarda, el interruptor sigue mostrando lo que de verdad quedó y avisa', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<SelfBookedRemindersToggle initialEnabled />);

        await userEvent.click(screen.getByRole('switch'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado');
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });
});

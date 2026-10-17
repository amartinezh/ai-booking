import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyReminderMinLead: jest.fn(),
}));

import ReminderLeadTimeSetting from './ReminderLeadTimeSetting';
import { setMyReminderMinLead } from '@/app/actions/settings';

const mockSet = setMyReminderMinLead as jest.Mock;

/** Anticipación mínima del recordatorio automático: guarda al instante. */
describe('ReminderLeadTimeSetting', () => {
    beforeEach(() => jest.clearAllMocks());

    it('muestra el valor guardado y lo explica', () => {
        render(<ReminderLeadTimeSetting initialMinutes={60} />);
        expect(screen.getByRole('combobox')).toHaveValue('60');
        expect(screen.getByText(/No se recuerdan citas que empiezan en menos de 1 hora/)).toBeInTheDocument();
        expect(screen.getByText(/recordatorio manual de la agenda no se afecta/)).toBeInTheDocument();
    });

    it('elegir otro valor lo guarda al instante', async () => {
        mockSet.mockResolvedValue({ success: true, reminderMinLeadMinutes: 30 });
        render(<ReminderLeadTimeSetting initialMinutes={60} />);

        await userEvent.selectOptions(screen.getByRole('combobox'), '30');

        expect(mockSet).toHaveBeenCalledWith(30);
        await waitFor(() =>
            expect(screen.getByText(/menos de 30 minutos/)).toBeInTheDocument(),
        );
    });

    it('«Sin mínimo» se dice tal cual', async () => {
        mockSet.mockResolvedValue({ success: true, reminderMinLeadMinutes: 0 });
        render(<ReminderLeadTimeSetting initialMinutes={60} />);

        await userEvent.selectOptions(screen.getByRole('combobox'), '0');

        await waitFor(() =>
            expect(screen.getByText(/aunque la cita esté por empezar/)).toBeInTheDocument(),
        );
    });

    it('si no se guarda, vuelve a lo que de verdad quedó y avisa', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<ReminderLeadTimeSetting initialMinutes={60} />);

        await userEvent.selectOptions(screen.getByRole('combobox'), '120');

        expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado');
        expect(screen.getByRole('combobox')).toHaveValue('60');
    });
});

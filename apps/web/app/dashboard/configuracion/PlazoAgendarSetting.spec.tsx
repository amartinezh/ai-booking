import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyBookingMaxDaysAhead: jest.fn(),
}));

import PlazoAgendarSetting from './PlazoAgendarSetting';
import { setMyBookingMaxDaysAhead } from '@/app/actions/settings';

const mockSet = setMyBookingMaxDaysAhead as jest.Mock;
// Viernes 23 de octubre de 2026.
const HOY = '2026-10-23';

/** Plazo máximo para agendar: guarda al instante y lo explica con fechas reales. */
describe('PlazoAgendarSetting', () => {
    beforeEach(() => jest.clearAllMocks());

    it('sin límite (lo de siempre) lo dice así y no muestra días', () => {
        render(<PlazoAgendarSetting initialDias={null} hoy={HOY} />);
        expect(screen.getByRole('combobox')).toHaveValue('');
        expect(screen.getByRole('status')).toHaveTextContent('Sin límite');
        expect(screen.queryByRole('list', { name: 'Días en que el asistente ofrece citas' })).toBeNull();
        expect(screen.getByText(/el personal agenda desde el panel/)).toBeInTheDocument();
    });

    it('con 3 días: hoy, mañana y el domingo 25; desde el lunes 26, no', () => {
        render(<PlazoAgendarSetting initialDias={3} hoy={HOY} />);
        expect(screen.getByRole('status')).toHaveTextContent('El asistente ofrece citas hasta el domingo 25 de octubre');
        expect(screen.getByText(/^Hoy es/)).toHaveTextContent(
            'Hoy es viernes 23 de octubre: se ofrecen citas hasta el domingo 25 de octubre; desde el lunes 26 de octubre, no.',
        );
        const dias = within(screen.getByRole('list', { name: 'Días en que el asistente ofrece citas' }))
            .getAllByRole('listitem')
            .map((li) => li.textContent);
        expect(dias).toEqual(['✓ Hoy', '✓ Mañana', '✓ dom 25', 'lun 26']);
    });

    it('con un plazo largo resume: los dos primeros, «…», el último y el primero fuera', () => {
        render(<PlazoAgendarSetting initialDias={15} hoy={HOY} />);
        const items = within(screen.getByRole('list', { name: 'Días en que el asistente ofrece citas' }))
            .getAllByRole('listitem')
            .map((li) => li.textContent);
        expect(items).toEqual(['✓ Hoy', '✓ Mañana', '✓ vie 6', 'sáb 7']);
    });

    it('elegir un plazo lo guarda al instante', async () => {
        mockSet.mockResolvedValue({ success: true, bookingMaxDaysAhead: 7 });
        render(<PlazoAgendarSetting initialDias={null} hoy={HOY} />);

        await userEvent.selectOptions(screen.getByRole('combobox'), '7');

        expect(mockSet).toHaveBeenCalledWith(7);
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent('hasta el jueves 29 de octubre'),
        );
    });

    it('volver a «Sin límite» envía null', async () => {
        mockSet.mockResolvedValue({ success: true, bookingMaxDaysAhead: null });
        render(<PlazoAgendarSetting initialDias={3} hoy={HOY} />);

        await userEvent.selectOptions(screen.getByRole('combobox'), '');

        expect(mockSet).toHaveBeenCalledWith(null);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sin límite'));
    });

    it('si no se guarda, vuelve a lo que de verdad quedó y avisa', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<PlazoAgendarSetting initialDias={3} hoy={HOY} />);

        await userEvent.selectOptions(screen.getByRole('combobox'), '30');

        expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado');
        expect(screen.getByRole('combobox')).toHaveValue('3');
    });

    it('un valor guardado fuera de la lista se muestra igual', () => {
        render(<PlazoAgendarSetting initialDias={8} hoy={HOY} />);
        expect(screen.getByRole('combobox')).toHaveValue('8');
    });
});

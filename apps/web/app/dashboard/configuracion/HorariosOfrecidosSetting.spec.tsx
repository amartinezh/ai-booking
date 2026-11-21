import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMySlotsOfferedCount: jest.fn(),
}));

import HorariosOfrecidosSetting from './HorariosOfrecidosSetting';
import { setMySlotsOfferedCount } from '@/app/actions/settings';

const mockSet = setMySlotsOfferedCount as jest.Mock;

/** Horarios que ofrece el asistente: ahora en Agenda que ofrece el asistente, y guarda al instante. */
describe('HorariosOfrecidosSetting', () => {
    beforeEach(() => jest.clearAllMocks());

    it('muestra lo guardado y cómo se reparte, con las opciones de 2 a 12', () => {
        render(<HorariosOfrecidosSetting initialCantidad={6} />);
        const lista = screen.getByRole('combobox', { name: 'Horarios que ofrece el asistente' });
        expect(lista).toHaveValue('6');
        expect(screen.getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(
            ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
        );
        expect(screen.getByRole('option', { name: '6 opciones (recomendado)' })).toBeInTheDocument();
        expect(screen.getByText('3 de la mañana y 3 de la tarde')).toBeInTheDocument();
    });

    it('elegir otro número lo guarda al instante, sin botón', async () => {
        mockSet.mockResolvedValue({ success: true, slotsOfferedCount: 5 });
        render(<HorariosOfrecidosSetting initialCantidad={6} />);

        await userEvent.selectOptions(screen.getByRole('combobox'), '5');

        expect(mockSet).toHaveBeenCalledWith(5);
        await waitFor(() => expect(screen.getByText('✓ Guardado')).toBeInTheDocument());
        expect(screen.getByText('3 de la mañana y 2 de la tarde')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Guardar/ })).not.toBeInTheDocument();
    });

    it('si no se guarda, vuelve a lo que de verdad quedó y lo dice', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<HorariosOfrecidosSetting initialCantidad={6} />);

        await userEvent.selectOptions(screen.getByRole('combobox'), '10');

        expect(await screen.findByRole('alert')).toHaveTextContent('Error al guardar: Acceso denegado');
        expect(screen.getByRole('combobox')).toHaveValue('6');
    });
});

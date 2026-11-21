import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstantSwitch from './InstantSwitch';

const save = jest.fn();
const props = {
    save,
    title: 'Agendar citas',
    description: 'Si el paciente puede sacar una cita.',
    iconOn: <i />,
    iconOff: <i />,
    iconOnClassName: '',
    labelOn: 'Encendido',
    labelOff: 'Apagado',
    detailOn: 'Los pacientes agendan.',
    detailOff: 'El asistente lo remite al hospital.',
    footnote: 'El personal sigue agendando.',
};

/** La fila compacta (docs/PLAN_NAVEGACION.md, N12). */
describe('InstantSwitch', () => {
    beforeEach(() => jest.clearAllMocks());

    it('la fila dice título, una línea y estado; la explicación queda plegada', () => {
        const { container } = render(<InstantSwitch {...props} initialEnabled />);
        expect(screen.getByRole('heading', { name: 'Agendar citas' })).toBeInTheDocument();
        expect(screen.getByText('Encendido')).toBeInTheDocument();
        const plegable = container.querySelector('details') as HTMLDetailsElement;
        expect(plegable.open).toBe(false);
        expect(within(plegable).getByText('¿Qué pasa si lo apago?')).toBeInTheDocument();
    });

    it('encendido responde qué pasa si se apaga, sin perder lo de ahora ni la nota', () => {
        const { container } = render(<InstantSwitch {...props} initialEnabled />);
        const plegable = container.querySelector('details') as HTMLDetailsElement;
        expect(plegable).toHaveTextContent('Si lo apaga: El asistente lo remite al hospital.');
        expect(plegable).toHaveTextContent('Ahora: Los pacientes agendan.');
        expect(plegable).toHaveTextContent('El personal sigue agendando.');
    });

    it('apagado pregunta qué pasa si se enciende', () => {
        const { container } = render(<InstantSwitch {...props} initialEnabled={false} />);
        const plegable = container.querySelector('details') as HTMLDetailsElement;
        expect(within(plegable).getByText('¿Qué pasa si lo enciendo?')).toBeInTheDocument();
        expect(plegable).toHaveTextContent('Si lo enciende: Los pacientes agendan.');
    });

    it('avisa el valor que quedó, solo si se guardó', async () => {
        const alCambiar = jest.fn();
        save.mockResolvedValueOnce({ success: false, error: 'No' });
        render(<InstantSwitch {...props} initialEnabled alCambiar={alCambiar} />);
        await userEvent.click(screen.getByRole('switch'));
        await screen.findByRole('alert');
        expect(alCambiar).not.toHaveBeenCalled();

        save.mockResolvedValueOnce({ success: true });
        await userEvent.click(screen.getByRole('switch'));
        await waitFor(() => expect(alCambiar).toHaveBeenCalledWith(false));
    });

    it('si depende de otro apagado, lo dice y se puede seguir cambiando', () => {
        render(<InstantSwitch {...props} initialEnabled noAplica="No aplica mientras el otro esté apagado." />);
        expect(screen.getByText('No aplica mientras el otro esté apagado.')).toBeInTheDocument();
        expect(screen.getByRole('switch')).toBeEnabled();
    });
});

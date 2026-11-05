jest.mock('@/app/actions/mensajes-masivos', () => ({
    guardarBorrador: jest.fn(async () => ({ success: true })),
    revisarTextoConIa: jest.fn(),
}));

import { fireEvent, render, screen } from '@testing-library/react';
import { guardarBorrador } from '@/app/actions/mensajes-masivos';
import EditorMensaje from './EditorMensaje';
import VistaPreviaWhatsapp from './VistaPreviaWhatsapp';

describe('VistaPreviaWhatsapp', () => {
    it('pone el nombre y el texto en el cuerpo aprobado, con el formato de WhatsApp', () => {
        render(
            <VistaPreviaWhatsapp
                clinica="Clínica Norte"
                cuerpo={'Hola {{1}}, un aviso:\n\n{{2}}'}
                pie="Clínica Norte"
                nombre="MARÍA JOSÉ PÉREZ"
                texto="La jornada es *gratis* este sábado."
                imagenUrl={null}
                aproximada={false}
            />,
        );
        expect(screen.getByText(/Hola María, un aviso:/)).toBeInTheDocument();
        expect(screen.getByText('gratis')).toHaveClass('font-bold');
        expect(screen.getByText(/plantilla aprobada en Meta/)).toBeInTheDocument();
    });

    it('sin cuerpo de Meta usa el sugerido y avisa que es aproximada', () => {
        render(<VistaPreviaWhatsapp clinica="C" cuerpo={null} pie={null} nombre={null} texto="Hola" imagenUrl={null} aproximada />);
        expect(screen.getByText(/Hola paciente/)).toBeInTheDocument();
        expect(screen.getByText(/Vista aproximada/)).toBeInTheDocument();
    });
});

describe('EditorMensaje', () => {
    const editor = (textoInicial: string) =>
        render(<EditorMensaje borradorId="b1" textoInicial={textoInicial} plantillaSaluda iaDisponible={false} onCambio={() => undefined} />);

    it('un salto de línea impide enviar, y «Aplicar» lo deja en un párrafo', () => {
        editor('Jornada de vacunación el sábado.\nTraiga su carné.');
        expect(screen.getAllByText('Impide enviar').length).toBeGreaterThan(0);
        const linea = screen.getByText(/el envío fallaría con todos/);
        fireEvent.click(linea.parentElement!.querySelector('button')!);
        expect(screen.getByLabelText('Texto del comunicado')).toHaveValue('Jornada de vacunación el sábado. Traiga su carné.');
    });

    it('un texto bien escrito no tiene observaciones y no ofrece la IA si no hay', () => {
        editor('La jornada de vacunación será el sábado 8 de noviembre en la sede principal.');
        expect(screen.getByText(/Sin observaciones/)).toBeInTheDocument();
        expect(screen.queryByText(/Revisar con IA/)).not.toBeInTheDocument();
    });

    it('lo escrito se guarda en el borrador', async () => {
        jest.useFakeTimers();
        editor('');
        fireEvent.change(screen.getByLabelText('Texto del comunicado'), { target: { value: 'Nuevo texto del comunicado.' } });
        jest.advanceTimersByTime(900);
        expect(guardarBorrador).toHaveBeenCalledWith('b1', { texto: 'Nuevo texto del comunicado.' });
        jest.useRealTimers();
    });
});

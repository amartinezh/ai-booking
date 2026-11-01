import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const verificarFechaResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return { success: true };
});
jest.mock('@/app/actions/resumen-publico', () => ({
    verificarFechaResumenAction: (...a: unknown[]) => verificarFechaResumenAction(...a),
}));

import FormularioFecha from './FormularioFecha';

// La puerta de la página del paciente: arma la fecha AAAA-MM-DD y dice cuántos
// intentos quedan o hasta cuándo está bloqueado.
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';

function llenar(dia: string, mes: string, anio: string) {
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: dia } });
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: mes } });
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: anio } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver mis documentos' }));
}

describe('FormularioFecha', () => {
    beforeEach(() => {
        verificarFechaResumenAction.mockClear();
        refresh.mockClear();
    });

    it('manda la fecha completa y, si coincide, recarga la página', async () => {
        render(<FormularioFecha token={TOKEN} hospital="E.S.E. HOSPITAL" />);
        expect(screen.getByText('E.S.E. HOSPITAL')).toBeInTheDocument();
        llenar('7', '5', '1963');
        await waitFor(() => expect(verificarFechaResumenAction).toHaveBeenCalledWith(TOKEN, '1963-05-07'));
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('incompleta: no la manda', () => {
        render(<FormularioFecha token={TOKEN} hospital="H" />);
        llenar('7', '', '63');
        expect(verificarFechaResumenAction).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Escriba el día, el mes y el año completos');
    });

    it('dice cuántos intentos quedan y cuándo se desbloquea', async () => {
        verificarFechaResumenAction.mockResolvedValueOnce({ success: false, estado: 'FECHA_INCORRECTA', intentosRestantes: 1 });
        render(<FormularioFecha token={TOKEN} hospital="H" />);
        llenar('7', '5', '1963');
        expect(await screen.findByRole('alert')).toHaveTextContent('Le quedan 1 intento.');

        verificarFechaResumenAction.mockResolvedValueOnce({ success: false, estado: 'BLOQUEADO', hastaIso: '2026-11-01T18:30:00.000Z' });
        fireEvent.click(screen.getByRole('button', { name: 'Ver mis documentos' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('quedó bloqueado'));
        expect(refresh).not.toHaveBeenCalled();
    });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const listarEnviosAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return { success: true, atenciones: [] };
});
const reenviarResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return { success: true, enviados: ['WHATSAPP'] };
});
jest.mock('@/app/actions/resumen-envios', () => ({
    listarEnviosAction: (...a: unknown[]) => listarEnviosAction(...a),
    reenviarResumenAction: (...a: unknown[]) => reenviarResumenAction(...a),
}));

import EnviosClient from './EnviosClient';
import type { AtencionConEnvios } from '@/app/actions/resumen-envios';

// «Envíos de documentos» (D14): el seguimiento sin contenido y «Reenviar», que
// exige marcar que se verificó la identidad en ventanilla.
const atencion = (c: Partial<AtencionConEnvios> = {}): AtencionConEnvios => ({
    id: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
    historia: '2441058',
    atendidaIso: '2026-11-01T14:00:00.000Z',
    servicio: 'S39141',
    paciente: { nombre: 'Ana P•••', documento: '•••0001' },
    estado: 'ENVIADO',
    motivo: null,
    contenidoDisponible: true,
    envios: [
        { canal: 'WHATSAPP', proposito: 'PACIENTE', destino: '•••4567', estado: 'AVISO_ENVIADO', motivo: null, avisoIso: '2026-11-01T16:00:00.000Z', documentosIso: null },
        { canal: 'EMAIL', proposito: 'PACIENTE', destino: '—', estado: 'NO_ENVIADO', motivo: 'Sin correo utilizable (vacío o de relleno)', avisoIso: null, documentosIso: null },
    ],
    ...c,
});

describe('EnviosClient', () => {
    beforeEach(() => {
        listarEnviosAction.mockClear();
        reenviarResumenAction.mockClear();
    });

    it('muestra el seguimiento por canal, enmascarado y sin contenido', () => {
        render(<EnviosClient iniciales={[atencion()]} />);
        const fila = screen.getByTestId('atencion');
        expect(fila).toHaveTextContent('Historia 2441058');
        expect(fila).toHaveTextContent('Paciente: Ana P••• · documento •••0001');
        expect(fila).toHaveTextContent('WhatsApp •••4567 · Aviso enviado (no ha pedido los documentos)');
        expect(fila).toHaveTextContent('Correo — · Sin correo utilizable');
    });

    it('busca por historia o cédula', async () => {
        render(<EnviosClient iniciales={[]} />);
        expect(screen.getByTestId('sin-atenciones')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Buscar por historia o cédula'), { target: { value: '900000001' } });
        fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
        await waitFor(() => expect(listarEnviosAction).toHaveBeenCalledWith('900000001'));
    });

    it('«Reenviar» no sale sin marcar la identidad verificada; con ella, reenvía y lo dice', async () => {
        listarEnviosAction.mockResolvedValueOnce({ success: true, atenciones: [atencion()] });
        render(<EnviosClient iniciales={[atencion()]} />);
        fireEvent.click(screen.getByLabelText('Reenviar historia 2441058'));
        const ahora = screen.getByRole('button', { name: 'Reenviar ahora' });
        expect(ahora).toBeDisabled();
        fireEvent.click(screen.getByLabelText('Identidad verificada'));
        fireEvent.click(ahora);
        await waitFor(() => expect(reenviarResumenAction).toHaveBeenCalledWith('6f9619ff-8b86-d011-b42d-00cf4fc964ff', true));
        expect(await screen.findByText('Reenviado por WhatsApp.')).toBeInTheDocument();
    });

    it('si no sale, dice por qué; lo ya borrado no se puede reenviar', async () => {
        reenviarResumenAction.mockResolvedValueOnce({ success: false, error: '«Enviar a pacientes» está apagado.' });
        render(<EnviosClient iniciales={[atencion(), atencion({ id: 'b', historia: '1', contenidoDisponible: false, estado: 'CADUCADO' })]} />);
        expect(screen.queryByLabelText('Reenviar historia 1')).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Reenviar historia 2441058'));
        fireEvent.click(screen.getByLabelText('Identidad verificada'));
        fireEvent.click(screen.getByRole('button', { name: 'Reenviar ahora' }));
        expect(await screen.findByText('«Enviar a pacientes» está apagado.')).toBeInTheDocument();
    });
});

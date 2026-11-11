import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const listarEnviosAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return { success: true, atenciones: [] };
});
const reenviarResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return { success: true, enviados: ['WHATSAPP'] };
});
const exportarEnviosAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return { success: false, error: 'Máximo 92 días por archivo.' };
});
jest.mock('@/app/actions/resumen-envios', () => ({
    listarEnviosAction: (...a: unknown[]) => listarEnviosAction(...a),
    reenviarResumenAction: (...a: unknown[]) => reenviarResumenAction(...a),
    exportarEnviosAction: (...a: unknown[]) => exportarEnviosAction(...a),
}));

import EnviosClient from './EnviosClient';
import type { AtencionConEnvios, EnvioDeLaAtencion } from '@/app/actions/resumen-envios';
import type { TrazaDelEnvio } from '@/lib/resumen/trazabilidad';

const traza = (c: Partial<TrazaDelEnvio> = {}): TrazaDelEnvio => ({
    aviso: { tipo: null, enviadoIso: null, entregadoIso: null, leidoIso: null, estado: null, error: null },
    pidioIso: null,
    verificadoIso: null,
    documentosIso: null,
    archivos: { enviados: 0, entregados: 0, leidos: 0, fallidos: 0 },
    ...c,
});
const envio = (c: Partial<EnvioDeLaAtencion>): EnvioDeLaAtencion => ({
    canal: 'WHATSAPP',
    proposito: 'PACIENTE',
    destino: '•••4567',
    estado: 'AVISO_ENVIADO',
    motivo: null,
    avisoIso: null,
    documentosIso: null,
    verificadoPor: null,
    traza: traza(),
    ...c,
});

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
        envio({
            avisoIso: '2026-11-01T16:00:00.000Z',
            traza: traza({
                aviso: {
                    tipo: 'PLANTILLA',
                    enviadoIso: '2026-11-01T16:00:00.000Z',
                    entregadoIso: '2026-11-01T16:00:05.000Z',
                    leidoIso: null,
                    estado: 'DELIVERED',
                    error: null,
                },
            }),
        }),
        envio({ canal: 'EMAIL', destino: '—', estado: 'NO_ENVIADO', motivo: 'Sin correo utilizable (vacío o de relleno)' }),
    ],
    pagina: { veces: 0, ultimaIso: null, descargas: 0 },
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
        expect(fila).toHaveTextContent('WhatsApp •••4567 · Aviso enviado (no ha recibido los documentos)');
        expect(fila).toHaveTextContent('Aviso con plantilla: enviado');
        expect(fila).toHaveTextContent('entregado 11:00 a m · sin leer');
        expect(fila).toHaveTextContent('No ha pedido los documentos');
        expect(fila).toHaveTextContent('Correo — · Sin correo utilizable');
    });

    it('el recorrido completo: leído, pidió, verificó con la fecha, archivos entregados y vistos, y la página', () => {
        const completa = atencion({
            envios: [
                envio({
                    estado: 'DOCUMENTOS_ENVIADOS',
                    verificadoPor: 'FECHA_NACIMIENTO',
                    traza: traza({
                        aviso: {
                            tipo: 'PLANTILLA',
                            enviadoIso: '2026-11-01T16:00:00.000Z',
                            entregadoIso: '2026-11-01T16:00:05.000Z',
                            leidoIso: '2026-11-01T16:10:00.000Z',
                            estado: 'READ',
                            error: null,
                        },
                        pidioIso: '2026-11-01T16:11:00.000Z',
                        verificadoIso: '2026-11-01T16:12:00.000Z',
                        documentosIso: '2026-11-01T16:12:30.000Z',
                        archivos: { enviados: 6, entregados: 6, leidos: 4, fallidos: 0 },
                    }),
                }),
            ],
            pagina: { veces: 2, ultimaIso: '2026-11-02T13:00:00.000Z', descargas: 1 },
        });
        render(<EnviosClient iniciales={[completa]} />);
        const fila = screen.getByTestId('atencion');
        expect(fila).toHaveTextContent('leído 11:10 a m');
        expect(fila).toHaveTextContent('verificado 11:12 a m con su fecha de nacimiento');
        expect(fila).toHaveTextContent('6 archivo(s) enviados · 6 entregados · 4 vistos');
        expect(fila).toHaveTextContent('Abrió la página 2 veces');
        expect(fila).toHaveTextContent('1 documento(s) descargados');
    });

    it('un aviso que Meta no entregó dice el error; Telegram dice que no informa la lectura', () => {
        const a = atencion({
            envios: [
                envio({
                    traza: traza({
                        aviso: { tipo: 'PLANTILLA', enviadoIso: '2026-11-01T16:00:00.000Z', entregadoIso: null, leidoIso: null, estado: 'FAILED', error: '131026 Message undeliverable' },
                    }),
                }),
                envio({
                    canal: 'TELEGRAM',
                    destino: '•••9999',
                    traza: traza({
                        aviso: { tipo: 'TELEGRAM', enviadoIso: '2026-11-01T16:00:00.000Z', entregadoIso: null, leidoIso: null, estado: 'ACCEPTED', error: null },
                    }),
                }),
            ],
        });
        render(<EnviosClient iniciales={[a]} />);
        const envios = screen.getAllByTestId('envio');
        expect(envios[0]).toHaveTextContent('⚠ Meta no lo entregó: 131026 Message undeliverable');
        expect(envios[1]).toHaveTextContent('Aviso por Telegram');
        expect(envios[1]).toHaveTextContent('Telegram no informa si se leyó');
    });

    it('«Descargar registro» pide las fechas elegidas y muestra el error si lo hay', async () => {
        render(<EnviosClient iniciales={[]} />);
        fireEvent.change(screen.getByLabelText('Registro desde'), { target: { value: '2026-08-01' } });
        fireEvent.change(screen.getByLabelText('Registro hasta'), { target: { value: '2026-11-10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Descargar registro (Excel)' }));
        await waitFor(() => expect(exportarEnviosAction).toHaveBeenCalledWith('2026-08-01', '2026-11-10'));
        expect(await screen.findByText('Máximo 92 días por archivo.')).toBeInTheDocument();
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

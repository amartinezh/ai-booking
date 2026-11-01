import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const updateLecturaResumenAction = jest.fn(async (...args: unknown[]) => { void args; return { success: true }; });
jest.mock('@/app/actions/resumen-atencion', () => ({
    updateLecturaResumenAction: (...a: unknown[]) => updateLecturaResumenAction(...a),
}));

import { configResumenAtencionApagada } from '@agenia/shared';
import ResumenAtencionClient from './ResumenAtencionClient';
import type { PanelResumenAtencion } from '@/app/actions/resumen-atencion';

// La pantalla de los interruptores (plan §3.11). Lo que se fija: nace apagada,
// solo se puede encender la LECTURA, y «Enviar» y los canales no se pueden tocar
// mientras el envío no exista.

const panel = (cambios: Partial<PanelResumenAtencion> = {}): PanelResumenAtencion => ({
    config: configResumenAtencionApagada(),
    servicios: [
        { codigo: 'S39141', nombre: 'CONSULTA MEDICINA GENERAL', seLee: false },
        { codigo: 'S39145', nombre: 'CONSULTA URGENCIAS', seLee: false },
    ],
    lectura: { cursor: null, recibidos24h: 0, recibidos30d: 0, ultimoRecibidoIso: null, porServicio: [] },
    ...cambios,
});

describe('ResumenAtencionClient', () => {
    beforeEach(() => updateLecturaResumenAction.mockClear());

    it('recién desplegado se ve apagado y no envía nada', () => {
        render(<ResumenAtencionClient panel={panel()} />);
        expect(screen.getByTestId('estado-lectura')).toHaveTextContent('Apagado');
        expect(screen.getByLabelText('Leer del hospital')).not.toBeChecked();
        expect(screen.getByText(/No se le envía nada a ningún paciente/)).toBeInTheDocument();
    });

    it('«Enviar a pacientes» y todos los canales están apagados y no se pueden tocar', () => {
        render(<ResumenAtencionClient panel={panel()} />);
        const enviar = screen.getByLabelText('Enviar a pacientes');
        expect(enviar).toBeDisabled();
        expect(enviar).not.toBeChecked();
        for (const canal of ['WhatsApp', 'Telegram', 'Correo']) {
            for (const servicio of ['S39141', 'S39145']) {
                const c = screen.getByLabelText(`${canal} ${servicio}`);
                expect(c).toBeDisabled();
                expect(c).not.toBeChecked();
            }
        }
    });

    it('guarda la lectura con los servicios marcados y la calma', async () => {
        render(<ResumenAtencionClient panel={panel()} />);
        const guardar = screen.getByRole('button', { name: 'Guardar' });
        expect(guardar).toBeDisabled();

        fireEvent.click(screen.getByLabelText('Leer del hospital'));
        fireEvent.click(screen.getByLabelText('Leer S39141'));
        fireEvent.change(screen.getByLabelText('Calma en minutos'), { target: { value: '150' } });
        fireEvent.click(guardar);

        await waitFor(() =>
            expect(updateLecturaResumenAction).toHaveBeenCalledWith({
                leerDelHospital: true,
                serviciosALeer: ['S39141'],
                calmaMinutos: 150,
            }),
        );
        expect(await screen.findByText(/Guardado/)).toBeInTheDocument();
    });

    it('si la acción rechaza el cambio, lo dice', async () => {
        updateLecturaResumenAction.mockResolvedValueOnce({ success: false, error: 'La calma va de 30 a 1440 minutos.' } as never);
        render(<ResumenAtencionClient panel={panel()} />);
        fireEvent.change(screen.getByLabelText('Calma en minutos'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(await screen.findByText('La calma va de 30 a 1440 minutos.')).toBeInTheDocument();
    });

    it('leyendo, lo dice y muestra cuánto ha llegado (sin contenido)', () => {
        render(
            <ResumenAtencionClient
                panel={panel({
                    config: { ...configResumenAtencionApagada(), leerDelHospital: true, servicios: { S39141: { WHATSAPP: false, TELEGRAM: false, EMAIL: false } } },
                    servicios: [{ codigo: 'S39141', nombre: 'CONSULTA MEDICINA GENERAL', seLee: true }],
                    lectura: { cursor: '2441058', recibidos24h: 96, recibidos30d: 2800, ultimoRecibidoIso: '2026-11-01T14:00:00.000Z', porServicio: [{ servicio: 'S39141', cantidad: 2800 }] },
                })}
            />,
        );
        expect(screen.getByTestId('estado-lectura')).toHaveTextContent('Leyendo del hospital');
        expect(screen.getByText(/96 resumen\(es\) en las últimas 24 horas/)).toBeInTheDocument();
        expect(screen.getByText(/Leído hasta la historia 2441058/)).toBeInTheDocument();
    });
});

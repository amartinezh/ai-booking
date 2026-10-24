import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyBookingMaxDaysAhead: jest.fn(),
    getMyPlazoAgendarResumen: jest.fn(),
}));

import PlazoAgendarSetting from './PlazoAgendarSetting';
import { getMyPlazoAgendarResumen, setMyBookingMaxDaysAhead } from '@/app/actions/settings';

const mockSet = setMyBookingMaxDaysAhead as jest.Mock;
const mockResumen = getMyPlazoAgendarResumen as jest.Mock;

/** El 23-oct a las 3:27 p. m.: 2 días, viernes; el primer cupo es el lunes. */
const SIN_CUPOS_HOY = {
    enElPlazo: 0,
    total: 50,
    primerDia: '2026-10-26',
    ultimoDia: '2026-10-24',
    desde: '2026-10-25',
    plazoMinimo: 4,
    hoy: '2026-10-23',
    dias: 2,
    ultimoCambio: {
        detalle: '«Plazo máximo para agendar» cambió de «Sin límite» a «2 días (hoy y mañana)» desde Configuración por admin@hsvpanserma.gov.co.',
        en: '2026-10-23T20:27:50.000Z',
    },
};
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

    describe('🗓️ lo que el plazo deja ofrecer hoy', () => {
        const aviso = () => screen.getByRole('note');

        it('sin cupos dentro del plazo: lo avisa, dice desde cuándo y el plazo mínimo', () => {
            render(<PlazoAgendarSetting initialDias={2} hoy={HOY} resumenInicial={SIN_CUPOS_HOY} />);
            expect(aviso()).toHaveTextContent('Con este plazo, hoy el asistente no tiene cupos que ofrecer');
            expect(aviso()).toHaveTextContent('El primer cupo libre es el lunes 26 de octubre');
            expect(aviso()).toHaveTextContent('desde el domingo 25 de octubre');
            expect(aviso()).toHaveTextContent('se agenda hasta el sábado 24 de octubre');
            expect(aviso()).toHaveTextContent('al menos 4 días');
        });

        it('con cupos: cuántos puede ofrecer hoy', () => {
            render(
                <PlazoAgendarSetting
                    initialDias={4}
                    hoy={HOY}
                    resumenInicial={{ ...SIN_CUPOS_HOY, dias: 4, enElPlazo: 19, desde: null }}
                />,
            );
            expect(aviso()).toHaveTextContent('Hoy el asistente puede ofrecer 19 cupos libres dentro del plazo (de 50 que hay)');
        });

        it('sin cupos ni con plazo ni sin él: lo dice sin culpar al plazo', () => {
            render(
                <PlazoAgendarSetting
                    initialDias={4}
                    hoy={HOY}
                    resumenInicial={{ ...SIN_CUPOS_HOY, total: 0, primerDia: null, desde: null, plazoMinimo: null }}
                />,
            );
            expect(aviso()).toHaveTextContent('no tiene cupos libres que ofrecer, con o sin plazo');
        });

        it('muestra quién lo cambió por última vez y cuándo', () => {
            render(<PlazoAgendarSetting initialDias={2} hoy={HOY} resumenInicial={SIN_CUPOS_HOY} />);
            expect(screen.getByText(/Último cambio:/)).toHaveTextContent('por admin@hsvpanserma.gov.co');
        });

        it('al guardar otro plazo, el aviso se actualiza', async () => {
            mockSet.mockResolvedValue({ success: true, bookingMaxDaysAhead: 4 });
            mockResumen.mockResolvedValue({
                success: true,
                resumen: { ...SIN_CUPOS_HOY, dias: 4, enElPlazo: 19, desde: null },
            });
            render(<PlazoAgendarSetting initialDias={2} hoy={HOY} resumenInicial={SIN_CUPOS_HOY} />);

            await userEvent.selectOptions(screen.getByRole('combobox'), '4');

            await waitFor(() => expect(aviso()).toHaveTextContent('puede ofrecer 19 cupos libres'));
        });

        it('si no se puede leer el resumen nuevo, quita el aviso viejo (no muestra algo que ya no vale)', async () => {
            mockSet.mockResolvedValue({ success: true, bookingMaxDaysAhead: 4 });
            mockResumen.mockRejectedValue(new Error('caída'));
            render(<PlazoAgendarSetting initialDias={2} hoy={HOY} resumenInicial={SIN_CUPOS_HOY} />);

            await userEvent.selectOptions(screen.getByRole('combobox'), '4');

            await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
        });
    });
});

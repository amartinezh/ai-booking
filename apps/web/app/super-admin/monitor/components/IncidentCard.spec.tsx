import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IncidentCard from './IncidentCard';
import type { IncidentRow } from '@/app/actions/monitor';

function makeIncident(overrides: Partial<IncidentRow> = {}): IncidentRow {
    return {
        id: 'inc-1',
        serviceKey: 'whatsapp',
        status: 'DOWN',
        startedAt: '2026-06-03T18:00:00.000Z',
        resolvedAt: null,
        errorMessage: null,
        errorCode: null,
        httpStatus: null,
        latencyMs: null,
        createdAt: '2026-06-03T18:00:00.000Z',
        updatedAt: '2026-06-03T18:00:00.000Z',
        ...overrides,
    };
}

describe('IncidentCard', () => {
    it('muestra "activo" para un incidente sin resolver', () => {
        render(<IncidentCard incident={makeIncident()} serviceName="WhatsApp" onOpen={() => {}} />);
        expect(screen.getByText('activo')).toBeInTheDocument();
        expect(screen.getByText(/en curso/)).toBeInTheDocument();
        expect(screen.getByText('Caído')).toBeInTheDocument();
        expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    });

    it('muestra "Resuelto" y la hora de cierre para un incidente ya resuelto', () => {
        const incident = makeIncident({
            status: 'DEGRADED',
            resolvedAt: '2026-06-03T19:00:00.000Z',
        });
        render(<IncidentCard incident={incident} serviceName="Gemini" onOpen={() => {}} />);
        expect(screen.getByText(/Resuelto/)).toBeInTheDocument();
        expect(screen.queryByText('activo')).not.toBeInTheDocument();
        expect(screen.getByText('Degradado')).toBeInTheDocument();
    });

    it('muestra el mensaje y código de error cuando existen', () => {
        const incident = makeIncident({ errorMessage: 'Timeout tras 5s', errorCode: 'ETIMEDOUT' });
        render(<IncidentCard incident={incident} serviceName="API" onOpen={() => {}} />);
        expect(screen.getByText(/\[ETIMEDOUT\]/)).toBeInTheDocument();
        expect(screen.getByText(/Timeout tras 5s/)).toBeInTheDocument();
    });

    it('no renderiza el bloque de error cuando no hay errorMessage', () => {
        render(<IncidentCard incident={makeIncident()} serviceName="API" onOpen={() => {}} />);
        expect(screen.queryByTitle(/./)).not.toBeInTheDocument();
    });

    it('invoca onOpen al hacer click en "Ver detalle completo"', async () => {
        const user = userEvent.setup();
        const onOpen = jest.fn();
        render(<IncidentCard incident={makeIncident()} serviceName="WhatsApp" onOpen={onOpen} />);

        await user.click(screen.getByRole('button', { name: /ver detalle completo/i }));

        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});

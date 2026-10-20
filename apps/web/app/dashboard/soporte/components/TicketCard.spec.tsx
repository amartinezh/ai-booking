import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/app/actions/support', () => ({
    startTicketAttention: jest.fn(),
    resolveTicket: jest.fn(),
    updateResolutionNote: jest.fn(),
}));

import TicketCard, { type CasoConNotas } from './TicketCard';
import SupportAdminClient from '../../../super-admin/support/components/SupportAdminClient';
import type { AdminTicket } from '../../../super-admin/support/components/AdminTicketRow';

const CASO: CasoConNotas = {
    id: '6f1c2d3e-0000-0000-0000-000000000000',
    number: 58,
    title: 'No salen los recordatorios',
    description: 'Desde las 7 no sale ningún recordatorio.',
    status: 'OPEN',
    startedAt: null,
    resolvedAt: null,
    resolutionNote: null,
    reporterId: 'u-1',
    organizationId: 'org-1',
    channel: 'TELEGRAM',
    priority: 'HIGH',
    conversationId: 'conv-1',
    groupNotice: 'SENT',
    groupNotifiedAt: null,
    groupNoticeAttempts: 0,
    groupNoticeError: null,
    unattendedRemindedAt: null,
    createdAt: new Date('2026-10-19T15:00:00Z'),
    updatedAt: new Date('2026-10-19T15:00:00Z'),
    notes: [
        {
            id: 'n-1',
            text: 'También pasa con la agenda del Dr. Ruiz.',
            kind: 'AMPLIACION',
            channel: 'TELEGRAM',
            createdAt: new Date('2026-10-19T15:20:00Z'),
        },
    ],
} as CasoConNotas;

/** El caso en el panel: con su número, si es urgente, si llegó por Telegram y lo que se le agregó. */
describe('el caso en el panel', () => {
    it('Mis solicitudes: el número del asistente, prioridad alta, Telegram y lo que agregó', () => {
        render(<TicketCard ticket={CASO} />);
        expect(screen.getByText('#58')).toBeInTheDocument();
        expect(screen.queryByText(/#6f1c2d3e/)).not.toBeInTheDocument();
        expect(screen.getByText('Prioridad alta')).toBeInTheDocument();
        expect(screen.getByText('Por Telegram')).toBeInTheDocument();
        expect(screen.getByText('Lo que agregaste después')).toBeInTheDocument();
        expect(screen.getByText('También pasa con la agenda del Dr. Ruiz.')).toBeInTheDocument();
        // La hora, en Colombia (no en UTC).
        expect(screen.getByText(/10:20/)).toBeInTheDocument();
    });

    it('un caso del panel, normal y sin notas: sin etiquetas ni recuadro', () => {
        render(<TicketCard ticket={{ ...CASO, channel: 'PANEL', priority: 'NORMAL', notes: undefined }} />);
        expect(screen.getByText('#58')).toBeInTheDocument();
        expect(screen.queryByText('Prioridad alta')).not.toBeInTheDocument();
        expect(screen.queryByText('Por Telegram')).not.toBeInTheDocument();
        expect(screen.queryByText(/agregaste/)).not.toBeInTheDocument();
    });

    describe('Mesa de Ayuda', () => {
        const fila = (cambios: Partial<AdminTicket>): AdminTicket => ({
            id: 'id',
            number: 58,
            channel: 'TELEGRAM',
            priority: 'HIGH',
            title: 'No salen los recordatorios',
            description: 'Desde las 7.',
            status: 'OPEN',
            startedAt: null,
            resolvedAt: null,
            resolutionNote: null,
            createdAt: '2026-10-19T15:00:00Z',
            reporter: { email: 'ana.perez@clinica.co', role: 'BOOKING_AGENT' },
            organization: { id: 'org-1', name: 'Hospital de Prueba', logoUrl: null },
            notes: [
                {
                    id: 'n-1',
                    text: 'También el Dr. Ruiz.',
                    kind: 'AMPLIACION',
                    channel: 'TELEGRAM',
                    createdAt: '2026-10-19T15:20:00Z',
                    author: { email: 'ana.perez@clinica.co' },
                },
            ],
            ...cambios,
        });
        const TICKETS = [
            fila({}),
            fila({ id: 'id2', number: 7, title: 'Otra cosa', channel: 'PANEL', priority: 'NORMAL', notes: [] }),
        ];

        it('cada caso con su número, etiquetas y lo que agregó quien lo reportó', () => {
            render(<SupportAdminClient tickets={TICKETS} showAll={false} />);
            expect(screen.getByText('#58')).toBeInTheDocument();
            expect(screen.getAllByText('Prioridad alta')).toHaveLength(1);
            expect(screen.getByText('Lo que agregó después')).toBeInTheDocument();
            expect(screen.getByText(/por Telegram · ana\.perez@clinica\.co/)).toBeInTheDocument();
        });

        it('se busca por número, con o sin «#»', () => {
            render(<SupportAdminClient tickets={TICKETS} showAll={false} />);
            const buscar = screen.getByPlaceholderText(/Buscar por número/);
            fireEvent.change(buscar, { target: { value: '#7' } });
            expect(screen.getByText('Otra cosa')).toBeInTheDocument();
            expect(screen.queryByText('No salen los recordatorios')).not.toBeInTheDocument();
            fireEvent.change(buscar, { target: { value: '58' } });
            expect(screen.getByText('No salen los recordatorios')).toBeInTheDocument();
            expect(screen.queryByText('Otra cosa')).not.toBeInTheDocument();
            fireEvent.change(buscar, { target: { value: 'otra' } });
            expect(screen.getByText('Otra cosa')).toBeInTheDocument();
        });
    });
});

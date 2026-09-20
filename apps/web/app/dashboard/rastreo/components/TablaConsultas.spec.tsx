import { render, screen } from '@testing-library/react';
import TablaConsultas from './TablaConsultas';
import type { FilaConsulta, ListaConsultas } from '@/lib/rastreo/tipos';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const fila = (over: Partial<FilaConsulta> = {}): FilaConsulta => ({
    id: 'l-1',
    creadoIso: '2026-09-21T15:00:00.000Z',
    actorEmail: 'admin@clinica.co',
    actorRol: 'ORG_ADMIN',
    modo: 'A',
    tipo: 'OPEN',
    busqueda: '•••3456',
    motivo: 'RECLAMO_PQRS',
    nota: null,
    candidatos: 0,
    abrioExpediente: true,
    enVivo: false,
    veredictos: [],
    ...over,
});
const lista = (filas: FilaConsulta[]): ListaConsultas => ({ filas, total: filas.length, pagina: 1, paginas: 1 });

describe('TablaConsultas — la bitácora distingue lo que llegó al hospital', () => {
    it('una consulta en vivo se llama por su nombre, sin "candidatos"', () => {
        render(<TablaConsultas lista={lista([fila({ tipo: 'LIVE_HIS', enVivo: true })])} hrefBase="/dashboard/rastreo/consultas" />);

        expect(screen.getByText(/Consulta en vivo al HIS · Dice que agendó/)).toBeInTheDocument();
        expect(screen.queryByText(/candidato/)).not.toBeInTheDocument();
        // No se repite la etiqueta en una fila que ya ES la consulta en vivo.
        expect(screen.queryByText('con datos en vivo del HIS')).not.toBeInTheDocument();
    });

    it('un expediente abierto CON lo que respondió el HIS lo dice', () => {
        render(<TablaConsultas lista={lista([fila({ tipo: 'OPEN', enVivo: true })])} hrefBase="/dashboard/rastreo/consultas" />);
        expect(screen.getByText('con datos en vivo del HIS')).toBeInTheDocument();
    });

    it('un expediente abierto SIN datos en vivo no lleva la etiqueta', () => {
        render(<TablaConsultas lista={lista([fila({ tipo: 'OPEN', enVivo: false })])} hrefBase="/dashboard/rastreo/consultas" />);
        expect(screen.queryByText('con datos en vivo del HIS')).not.toBeInTheDocument();
    });
});

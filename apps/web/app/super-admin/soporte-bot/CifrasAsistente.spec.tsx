import { render, screen, within } from '@testing-library/react';
import type { CifrasAsistente } from '@agenia/shared';
import { CifrasDelAsistente, PreguntasSinCubrir } from './CifrasAsistente';

const CIFRAS: CifrasAsistente = {
    periodo: { dias: 7, desde: '2026-10-14', hasta: '2026-10-20T15:00:00.000Z' },
    conversaciones: { total: 1234, personas: 12, clinicas: 2 },
    respuestas: { total: 40, conIA: 30, sinIA: 10, sinCubrir: 3, tiempoMedioMs: 3750, tiempoP90Ms: 9000 },
    resultado: { conRespuesta: 30, sinCaso: 24, porcentajeSinCaso: 80, casosAbiertos: 6, utiles: 9, noUtiles: 2 },
    codigo: { pedidos: 50, usados: 40, sinUsar: 10, fallidos: 4, bloqueos: 1, mensajesSinCodigo: 7 },
    porClinica: [
        {
            organizationId: 'org-1',
            nombre: 'Hospital Uno',
            conversaciones: 30,
            personas: 10,
            respuestasIA: 25,
            respuestasSinIA: 5,
            tokensEntrada: 900000,
            tokensSalida: 4000,
            casos: 5,
        },
    ],
};

/** Cómo va el asistente (docs/PLAN_BOT_SOPORTE.md §3.7, Fase 5). */
describe('las cifras del asistente', () => {
    it('las cifras del periodo, con miles y segundos a la colombiana', () => {
        render(<CifrasDelAsistente cifras={CIFRAS} />);
        expect(screen.getByText('1.234')).toBeInTheDocument();
        expect(screen.getByText('12 personas · 2 clínicas')).toBeInTheDocument();
        expect(screen.getByText('80 %')).toBeInTheDocument();
        expect(screen.getByText('24 de 30 con respuesta')).toBeInTheDocument();
        expect(screen.getByText('3,8 s')).toBeInTheDocument();
        expect(screen.getByText('9 de cada 10 en menos de 9,0 s')).toBeInTheDocument();
        expect(screen.getByText('9 / 2')).toBeInTheDocument();
        expect(screen.getByText(/miércoles, 14 de octubre/)).toBeInTheDocument();
    });

    it('el periodo es un enlace (la página se arma en el servidor) y marca el actual', () => {
        render(<CifrasDelAsistente cifras={CIFRAS} />);
        const periodo = screen.getByRole('navigation', { name: 'Periodo' });
        expect(within(periodo).getByRole('link', { name: '7 días' })).toHaveAttribute('aria-current', 'page');
        expect(within(periodo).getByRole('link', { name: '30 días' })).toHaveAttribute('href', '?dias=30');
        expect(screen.getByRole('link', { name: 'Ver conversaciones' })).toHaveAttribute(
            'href',
            '/super-admin/soporte-bot/conversaciones?dias=7',
        );
    });

    it('el código: pedidos, usados, los que nadie escribió, equivocados y bloqueos', () => {
        render(<CifrasDelAsistente cifras={CIFRAS} />);
        expect(screen.getByText('Nadie los escribió').nextSibling).toHaveTextContent('10');
        expect(screen.getByText('Cuentas bloqueadas 1 h').nextSibling).toHaveTextContent('1');
    });

    it('por clínica, con el enlace a sus conversaciones', () => {
        render(<CifrasDelAsistente cifras={CIFRAS} />);
        expect(screen.getByRole('link', { name: 'Hospital Uno' })).toHaveAttribute(
            'href',
            '/super-admin/soporte-bot/conversaciones?dias=7&clinica=org-1',
        );
        expect(screen.getByText('900.000 / 4.000')).toBeInTheDocument();
    });

    it('sin datos: rayas en vez de porcentajes y sin tabla', () => {
        render(
            <CifrasDelAsistente
                cifras={{
                    ...CIFRAS,
                    respuestas: { ...CIFRAS.respuestas, tiempoMedioMs: null, tiempoP90Ms: null },
                    resultado: { ...CIFRAS.resultado, porcentajeSinCaso: null },
                    porClinica: [],
                }}
            />,
        );
        expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('lo que el manual no cubrió: la pregunta, cuándo, dónde y quién, con el enlace a la conversación', () => {
        render(
            <PreguntasSinCubrir
                preguntas={[
                    {
                        fecha: '2026-10-20T14:00:00.000Z',
                        conversationId: 'c1',
                        clinica: 'Hospital Uno',
                        rol: 'BOOKING_AGENT',
                        pregunta: '¿Puedo exportar a Excel?',
                    },
                ]}
            />,
        );
        expect(screen.getByText('¿Puedo exportar a Excel?')).toBeInTheDocument();
        expect(screen.getByText(/Hospital Uno · Agente de Reservas/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ver conversación' })).toHaveAttribute(
            'href',
            '/super-admin/soporte-bot/conversaciones/c1',
        );
    });

    it('sin preguntas sin cubrir, lo dice', () => {
        render(<PreguntasSinCubrir preguntas={[]} />);
        expect(screen.getByText('Ninguna en este periodo.')).toBeInTheDocument();
    });
});

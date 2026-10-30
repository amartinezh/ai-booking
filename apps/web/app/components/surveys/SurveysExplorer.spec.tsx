import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SurveyRowView, SurveyStats } from '@/app/actions/surveys.types';

jest.mock('@/app/actions/surveys', () => ({
  getSurveys: jest.fn(),
  getSurveyStats: jest.fn(),
  exportSurveys: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), warning: jest.fn(), error: jest.fn() } }));
// Recharts necesita medidas reales del DOM; aquí basta con que no reviente.
jest.mock('recharts', () => {
  const Nada = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return new Proxy({}, { get: () => Nada });
});

import { getSurveyStats, getSurveys } from '@/app/actions/surveys';
import SurveysExplorer from './SurveysExplorer';

const mList = getSurveys as jest.Mock;
const mStats = getSurveyStats as jest.Mock;

const fila = (over: Partial<SurveyRowView> = {}): SurveyRowView => ({
  id: 's1',
  createdAt: '2026-10-30T14:14:00.000Z',
  answeredAt: '2026-10-30T14:20:00.000Z',
  status: 'ANSWERED',
  patientName: 'Luz Mery Arenas',
  whatsappPhone: '573146259044',
  rating: 5,
  userMood: 'HAPPY',
  wouldRecommend: true,
  experience: 'GOOD',
  message: 'Rápido',
  resolutionStatus: 'BOOKED',
  ...over,
});

const STATS: SurveyStats = {
  sent: 4,
  answered: 2,
  complete: 1,
  starsOnly: 1,
  pending: 1,
  expired: 1,
  averageRatingWithIps: 5,
  averageRatingStarsOnly: 3,
  responseRate: 0.5,
  comments: 1,
  averageRating: 4,
  recommendRate: 0.5,
  goodRate: 0.5,
  ratingDistribution: [0, 0, 1, 0, 1],
  recommend: { yes: 1, no: 1 },
  experience: { GOOD: 1, FAIR: 0, BAD: 1, NO_ANSWER: 0 },
  byResolution: [{ status: 'BOOKED', sent: 4, answered: 2, averageRating: 4, recommendRate: 0.5, goodRate: 0.5 }],
  trend: { granularity: 'day', points: [{ bucket: '2026-10-30', sent: 4, answered: 2, averageRating: 4, recommendRate: 0.5, goodRate: 0.5 }] },
  truncated: false,
};

const ultimaConsulta = () => mList.mock.calls[mList.mock.calls.length - 1][1];

beforeEach(() => {
  mList.mockReset().mockResolvedValue({
    rows: [
      fila(),
      fila({
        id: 's3',
        patientName: 'Gloria Cárdenas',
        status: 'PARTIAL',
        rating: 2,
        userMood: 'NEGATIVE',
        wouldRecommend: null,
        experience: null,
        message: null,
      }),
      fila({
        id: 's2',
        patientName: 'Paciente anónimo',
        whatsappPhone: null,
        status: 'EXPIRED',
        answeredAt: null,
        rating: null,
        userMood: null,
        wouldRecommend: null,
        experience: null,
        message: null,
      }),
    ],
    total: 2,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  });
  mStats.mockReset().mockResolvedValue(STATS);
});

describe('Consulta de encuestas', () => {
  it('muestra indicadores y filas: las respuestas o, si no respondió, el estado del enlace', async () => {
    render(<SurveysExplorer scope="clinic" />);

    expect(await screen.findByText('Luz Mery Arenas')).toBeInTheDocument();
    expect(screen.getByText('Recomendaría la IPS')).toBeInTheDocument();
    expect(screen.getAllByText('Experiencia buena').length).toBeGreaterThan(0);
    expect(screen.getByText('1 con comentario')).toBeInTheDocument();

    const filaAnonima = screen.getByText('Paciente anónimo').closest('tr')!;
    expect(within(filaAnonima).getByText('Venció sin respuesta')).toBeInTheDocument();

    // Solo estrellas: se ven sus estrellas y la marca, no respuestas del hospital.
    const filaParcial = screen.getByText('Gloria Cárdenas').closest('tr')!;
    expect(within(filaParcial).getByText('Solo estrellas')).toBeInTheDocument();
    expect(within(filaParcial).getByRole('img', { name: '2 de 5 estrellas' })).toBeInTheDocument();

    // Completas y solo estrellas en el recuadro de respuestas, y la comparación.
    expect(screen.getByText(/1 completas · 1 solo estrellas/)).toBeInTheDocument();
    expect(screen.getByText(/La diferencia es grande/)).toBeInTheDocument();

    // Las estrellas son la primera respuesta, como en la encuesta.
    const titulos = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(titulos.indexOf('Asistente')).toBeLessThan(titulos.indexOf('¿Recomendaría?'));

    // La clínica no ve la columna de clínica.
    expect(screen.queryByRole('columnheader', { name: 'Clínica' })).not.toBeInTheDocument();
  });

  it('arranca con los últimos 30 días y sin filtro de estado en las estadísticas', async () => {
    render(<SurveysExplorer scope="clinic" />);
    await screen.findByText('Luz Mery Arenas');
    const q = ultimaConsulta();
    expect(q.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mStats.mock.calls[0][0]).toBe('clinic');
    expect(mStats.mock.calls[0][1]).not.toHaveProperty('status');
    expect(mStats.mock.calls[0][1]).toMatchObject({ startDate: q.startDate, endDate: q.endDate });
  });

  it('pulsar una barra de las estadísticas filtra la lista (y otra vez lo quita)', async () => {
    render(<SurveysExplorer scope="clinic" />);
    await screen.findByText('Luz Mery Arenas');

    const malas = screen.getByRole('button', { name: /😞 Mala/ });
    await userEvent.click(malas);
    await waitFor(() => expect(ultimaConsulta().experience).toBe('BAD'));
    expect(screen.getByRole('button', { name: 'Quitar filtro: Experiencia: Mala' })).toBeInTheDocument();

    await userEvent.click(malas);
    await waitFor(() => expect(ultimaConsulta().experience).toBeUndefined());
  });

  it('el filtro de estado va a la lista, pero no a las estadísticas', async () => {
    render(<SurveysExplorer scope="clinic" />);
    await screen.findByText('Luz Mery Arenas');
    mStats.mockClear();

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'Solo estrellas');
    await waitFor(() => expect(ultimaConsulta().status).toBe('PARTIAL'));
    expect(mStats).not.toHaveBeenCalled();
  });

  it('ordenar por calificación pide primero las peores', async () => {
    render(<SurveysExplorer scope="clinic" />);
    await screen.findByText('Luz Mery Arenas');

    await userEvent.click(screen.getByRole('button', { name: /Asistente/ }));
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ sortBy: 'rating', sortDir: 'asc' }));
  });

  it('una fila abre el detalle con el comentario completo', async () => {
    render(<SurveysExplorer scope="clinic" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Luz Mery Arenas' }));

    const detalle = screen.getByRole('dialog');
    expect(within(detalle).getByText('Rápido')).toBeInTheDocument();
    expect(within(detalle).getByText('Agendó o cambió cita')).toBeInTheDocument();
    // La clínica no ve la cédula ni el resumen del chat.
    expect(within(detalle).queryByText('Cédula')).not.toBeInTheDocument();
    expect(within(detalle).queryByText('Resumen del chat')).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('el Super Admin ve la columna de clínica y puede filtrar por clínica', async () => {
    mList.mockResolvedValue({
      rows: [fila({ organizationName: 'ESE San Vicente', cedula: '1088', chatSummary: 'Cita agendada.' })],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    render(<SurveysExplorer scope="global" organizations={[{ id: 'org-1', name: 'ESE San Vicente' }]} />);
    await screen.findByText('Luz Mery Arenas');
    expect(screen.getByRole('columnheader', { name: 'Clínica' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Clínica'), 'org-1');
    await waitFor(() => expect(ultimaConsulta().organizationId).toBe('org-1'));
  });
});

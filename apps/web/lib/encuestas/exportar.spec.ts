import type { SurveyRowView, SurveyStats } from '@/app/actions/surveys.types';
import { filasEncuestas, filasResumen, nombreArchivo } from './exportar';

const fila = (over: Partial<SurveyRowView> = {}): SurveyRowView => ({
  id: 's1',
  createdAt: '2026-10-30T14:14:00.000Z',
  answeredAt: '2026-10-30T14:20:00.000Z',
  status: 'ANSWERED',
  patientName: 'Ana Pérez',
  whatsappPhone: '573001112233',
  rating: 4,
  userMood: 'HAPPY',
  wouldRecommend: true,
  experience: 'FAIR',
  message: 'Rápido, pero no entendí la hora',
  resolutionStatus: 'BOOKED',
  ...over,
});

describe('descarga de encuestas', () => {
  it('la de la clínica no lleva cédula, clínica ni resumen del chat', () => {
    const [encabezado, primera] = filasEncuestas([fila()], 'clinic');
    expect(encabezado).not.toContain('Cédula');
    expect(encabezado).not.toContain('Clínica');
    expect(encabezado).not.toContain('Resumen del chat');
    expect(primera).toHaveLength(encabezado.length);
    const celda = (titulo: string) => primera[encabezado.indexOf(titulo)];
    expect(celda('Paciente')).toBe('Ana Pérez');
    expect(celda('¿Recomendaría la IPS?')).toBe('Sí');
    expect(celda('¿Cómo le fue?')).toBe('Regular');
    expect(celda('Estrellas del asistente')).toBe(4);
    expect(celda('Gestión')).toBe('Agendó o cambió cita');
    expect(celda('Estado')).toBe('Completa');
    // Las estrellas van antes que las preguntas del hospital, como en la encuesta.
    expect(encabezado.indexOf('Estrellas del asistente')).toBeLessThan(encabezado.indexOf('¿Recomendaría la IPS?'));
    // Fecha con año y en hora de Bogotá (9:14 a. m.), no en UTC.
    expect(celda('Enviada')).toMatch(/30\/10\/2026 09:14 a/);
  });

  it('la del Super Admin agrega clínica, cédula y resumen', () => {
    const [encabezado, primera] = filasEncuestas(
      [fila({ organizationName: 'ESE San Vicente', cedula: '1088', chatSummary: 'Cita agendada.' })],
      'global',
    );
    expect(primera[encabezado.indexOf('Clínica')]).toBe('ESE San Vicente');
    expect(primera[encabezado.indexOf('Cédula')]).toBe('1088');
    expect(primera[encabezado.indexOf('Resumen del chat')]).toBe('Cita agendada.');
  });

  it('una sin responder deja vacías las respuestas', () => {
    const [encabezado, primera] = filasEncuestas(
      [
        fila({
          status: 'EXPIRED',
          answeredAt: null,
          rating: null,
          wouldRecommend: null,
          experience: null,
          message: null,
        }),
      ],
      'clinic',
    );
    const celda = (titulo: string) => primera[encabezado.indexOf(titulo)];
    expect(celda('Estado')).toBe('Venció sin respuesta');
    expect(celda('Respondida')).toBe('');
    expect(celda('¿Recomendaría la IPS?')).toBe('');
    expect(celda('¿Cómo le fue?')).toBe('');
    expect(celda('Estrellas del asistente')).toBe('');
  });

  it('el resumen trae los indicadores, con «No responde» fuera del porcentaje', () => {
    const stats: SurveyStats = {
      sent: 10,
      answered: 8,
      complete: 6,
      starsOnly: 2,
      pending: 1,
      expired: 1,
      averageRatingWithIps: 4.5,
      averageRatingStarsOnly: 3.5,
      responseRate: 0.8,
      comments: 3,
      averageRating: 4.25,
      recommendRate: 0.75,
      goodRate: 0.5,
      ratingDistribution: [1, 0, 1, 2, 4],
      recommend: { yes: 6, no: 2 },
      experience: { GOOD: 3, FAIR: 2, BAD: 1, NO_ANSWER: 2 },
      byResolution: [
        { status: 'BOOKED', sent: 10, answered: 8, averageRating: 4.25, recommendRate: 0.75, goodRate: 0.5 },
      ],
      trend: { granularity: 'day', points: [] },
      truncated: false,
    };
    const filas = filasResumen(stats, 'Últimos 30 días', new Date('2026-10-30T15:00:00Z'));
    const buscar = (titulo: string) => filas.find((f) => f[0] === titulo);
    expect(buscar('Periodo')?.[1]).toBe('Últimos 30 días');
    expect(buscar('Respondidas')).toEqual(['Respondidas', 8, '80 % de las enviadas']);
    expect(buscar('Completas')?.[1]).toBe(6);
    expect(buscar('Solo estrellas')?.[1]).toBe(2);
    expect(buscar('Promedio de quienes completaron')?.[1]).toBe('4,5');
    expect(buscar('Promedio de quienes solo dieron estrellas')?.[1]).toBe('3,5');
    expect(buscar('Sí')).toEqual(['Sí', 6, '75 %']);
    expect(buscar('Buena')).toEqual(['Buena', 3, '50 %']);
    expect(buscar('No responde')).toEqual(['No responde', 2, '']);
    expect(buscar('Promedio')?.[1]).toBe('4,3');
    expect(buscar('Agendó o cambió cita')).toEqual(['Agendó o cambió cita', 10, 8, '75 %', '50 %', '4,3']);
  });

  it('nombre del archivo', () => {
    expect(nombreArchivo('clinic', '2026-10-30')).toBe('encuestas_2026-10-30.xlsx');
    expect(nombreArchivo('global', '2026-10-30')).toBe('encuestas-todas-las-clinicas_2026-10-30.xlsx');
  });
});

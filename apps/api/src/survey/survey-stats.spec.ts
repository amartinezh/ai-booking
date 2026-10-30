import { ResolutionStatus, SurveyExperience } from '@agenia/database';
import { buildSurveyStats, SurveyStatsRow } from './survey-stats';

// «Ahora» fijo: viernes 30-oct-2026, 10:00 a. m. en Bogotá.
const AHORA = new Date('2026-10-30T15:00:00Z');

const fila = (over: Partial<SurveyStatsRow> = {}): SurveyStatsRow => ({
  createdAt: new Date('2026-10-29T14:00:00Z'),
  isUsed: true,
  expiresAt: new Date('2026-10-30T14:00:00Z'),
  rating: 5,
  wouldRecommend: true,
  experience: SurveyExperience.GOOD,
  resolutionStatus: ResolutionStatus.BOOKED,
  ...over,
});

const sinResponder = (over: Partial<SurveyStatsRow> = {}) =>
  fila({
    isUsed: false,
    rating: null,
    wouldRecommend: null,
    experience: null,
    ...over,
  });

describe('buildSurveyStats', () => {
  it('sin encuestas: todo en cero y los porcentajes en null (no 0 %)', () => {
    const s = buildSurveyStats([], { comments: 0, now: AHORA });
    expect(s).toMatchObject({
      sent: 0,
      answered: 0,
      pending: 0,
      expired: 0,
      responseRate: null,
      averageRating: null,
      recommendRate: null,
      goodRate: null,
      ratingDistribution: [0, 0, 0, 0, 0],
      recommend: { yes: 0, no: 0 },
      byResolution: [],
    });
  });

  it('tasa de respuesta, pendientes (enlace abierto) y vencidas', () => {
    const s = buildSurveyStats(
      [
        fila(),
        fila(),
        sinResponder({ expiresAt: new Date(AHORA.getTime() + 60_000) }),
        sinResponder({ expiresAt: new Date(AHORA.getTime() - 60_000) }),
      ],
      { comments: 1, now: AHORA },
    );
    expect(s).toMatchObject({
      sent: 4,
      answered: 2,
      pending: 1,
      expired: 1,
      responseRate: 0.5,
      comments: 1,
    });
  });

  it('promedio y reparto de estrellas', () => {
    const s = buildSurveyStats(
      [
        fila({ rating: 5 }),
        fila({ rating: 4 }),
        fila({ rating: 1 }),
        sinResponder(),
      ],
      { comments: 0, now: AHORA },
    );
    expect(s.averageRating).toBe(3.33);
    expect(s.ratingDistribution).toEqual([1, 0, 0, 1, 1]);
  });

  it('«¿Recomendaría?»: Sí / (Sí + No); las encuestas anteriores (null) no cuentan', () => {
    const s = buildSurveyStats(
      [
        fila({ wouldRecommend: true }),
        fila({ wouldRecommend: true }),
        fila({ wouldRecommend: true }),
        fila({ wouldRecommend: false }),
        fila({ wouldRecommend: null, experience: null }), // antes del cambio
      ],
      { comments: 0, now: AHORA },
    );
    expect(s.recommend).toEqual({ yes: 3, no: 1 });
    expect(s.recommendRate).toBe(0.75);
  });

  it('«¿Cómo le fue?»: Buena / (Buena + Regular + Mala), sin contar «No responde»', () => {
    const s = buildSurveyStats(
      [
        fila({ experience: SurveyExperience.GOOD }),
        fila({ experience: SurveyExperience.GOOD }),
        fila({ experience: SurveyExperience.FAIR }),
        fila({ experience: SurveyExperience.BAD }),
        fila({ experience: SurveyExperience.NO_ANSWER }),
        fila({ experience: SurveyExperience.NO_ANSWER }),
      ],
      { comments: 0, now: AHORA },
    );
    expect(s.experience).toEqual({ GOOD: 2, FAIR: 1, BAD: 1, NO_ANSWER: 2 });
    expect(s.goodRate).toBe(0.5);
  });

  it('solo «No responde» no da un 0 % de satisfacción: da null', () => {
    const s = buildSurveyStats(
      [fila({ experience: SurveyExperience.NO_ANSWER })],
      { comments: 0, now: AHORA },
    );
    expect(s.goodRate).toBeNull();
  });

  it('por gestión, de la más frecuente a la menos', () => {
    const s = buildSurveyStats(
      [
        fila({ resolutionStatus: ResolutionStatus.CANCELLED, rating: 2 }),
        fila({ resolutionStatus: ResolutionStatus.BOOKED, rating: 5 }),
        fila({ resolutionStatus: ResolutionStatus.BOOKED, rating: 4 }),
        sinResponder({ resolutionStatus: ResolutionStatus.BOOKED }),
      ],
      { comments: 0, now: AHORA },
    );
    expect(s.byResolution.map((g) => g.status)).toEqual([
      ResolutionStatus.BOOKED,
      ResolutionStatus.CANCELLED,
    ]);
    expect(s.byResolution[0]).toMatchObject({
      sent: 3,
      answered: 2,
      averageRating: 4.5,
    });
    expect(s.byResolution[1]).toMatchObject({ sent: 1, averageRating: 2 });
  });

  describe('en el tiempo (hora de Bogotá)', () => {
    it('con fechas: un tramo por día, con ceros en los días vacíos', () => {
      const s = buildSurveyStats([fila()], {
        comments: 0,
        now: AHORA,
        startDate: '2026-10-26',
        endDate: '2026-10-30',
      });
      expect(s.trend.granularity).toBe('day');
      expect(s.trend.points.map((p) => p.bucket)).toEqual([
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
      ]);
      expect(s.trend.points[3]).toMatchObject({ sent: 1, answered: 1 });
      expect(s.trend.points[0]).toMatchObject({
        sent: 0,
        averageRating: null,
      });
    });

    it('🕔 una encuesta de las 9 p. m. de Bogotá cuenta en ese día, no en el siguiente (UTC)', () => {
      // 30-oct 02:00 UTC = 29-oct 9:00 p. m. en Bogotá.
      const s = buildSurveyStats(
        [fila({ createdAt: new Date('2026-10-30T02:00:00Z') })],
        {
          comments: 0,
          now: AHORA,
          startDate: '2026-10-29',
          endDate: '2026-10-30',
        },
      );
      const porDia = Object.fromEntries(
        s.trend.points.map((p) => [p.bucket, p.sent]),
      );
      expect(porDia).toEqual({ '2026-10-29': 1, '2026-10-30': 0 });
    });

    it('sin fechas: desde la encuesta más antigua hasta hoy', () => {
      const s = buildSurveyStats(
        [fila({ createdAt: new Date('2026-10-28T15:00:00Z') })],
        { comments: 0, now: AHORA },
      );
      expect(s.trend.points.map((p) => p.bucket)).toEqual([
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
      ]);
    });

    it('más de 14 días: la satisfacción también va por semana (lunes a domingo)', () => {
      const s = buildSurveyStats(
        [
          // jueves 1-oct y domingo 4-oct: misma semana (la del lunes 28-sep)
          fila({
            createdAt: new Date('2026-10-01T15:00:00Z'),
            wouldRecommend: true,
          }),
          fila({
            createdAt: new Date('2026-10-04T15:00:00Z'),
            wouldRecommend: false,
          }),
          // lunes 5-oct: semana siguiente
          fila({ createdAt: new Date('2026-10-05T15:00:00Z') }),
        ],
        {
          comments: 0,
          now: AHORA,
          startDate: '2026-10-01',
          endDate: '2026-10-30',
        },
      );
      expect(s.trend.granularity).toBe('day');
      const semanas = s.trend.weekly!;
      expect(semanas.map((p) => p.bucket)).toEqual([
        '2026-09-28',
        '2026-10-05',
        '2026-10-12',
        '2026-10-19',
        '2026-10-26',
      ]);
      expect(semanas[0]).toMatchObject({ sent: 2, recommendRate: 0.5 });
      expect(semanas[1]).toMatchObject({ sent: 1, recommendRate: 1 });
    });

    it('14 días o menos: sin semanas', () => {
      const s = buildSurveyStats([fila()], {
        comments: 0,
        now: AHORA,
        startDate: '2026-10-17',
        endDate: '2026-10-30',
      });
      expect(s.trend.weekly).toBeUndefined();
    });

    it('un solo día se grafica por hora', () => {
      const s = buildSurveyStats(
        [fila({ createdAt: new Date('2026-10-30T14:20:00Z') })], // 9:20 a. m.
        {
          comments: 0,
          now: AHORA,
          startDate: '2026-10-30',
          endDate: '2026-10-30',
        },
      );
      expect(s.trend.granularity).toBe('hour');
      expect(s.trend.points).toHaveLength(24);
      expect(
        s.trend.points.find((p) => p.bucket === '2026-10-30T09')?.sent,
      ).toBe(1);
    });

    it('más de tres meses se grafica por mes', () => {
      const s = buildSurveyStats(
        [
          fila({ createdAt: new Date('2026-05-10T15:00:00Z') }),
          fila({ createdAt: new Date('2026-10-10T15:00:00Z') }),
        ],
        { comments: 0, now: AHORA },
      );
      expect(s.trend.granularity).toBe('month');
      expect(s.trend.points.map((p) => p.bucket)).toEqual([
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
      ]);
      expect(s.trend.points[0].sent).toBe(1);
      expect(s.trend.points[5].sent).toBe(1);
    });
  });

  it('pasa el aviso de que el cálculo se cortó', () => {
    expect(
      buildSurveyStats([], { comments: 0, now: AHORA, truncated: true })
        .truncated,
    ).toBe(true);
  });
});

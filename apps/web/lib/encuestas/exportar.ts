/**
 * ⭐📥 Descarga de la encuesta de satisfacción a Excel.
 *
 * Arma las filas de dos hojas: «Encuestas» (una fila por encuesta, con los
 * filtros de la pantalla) y «Resumen» (los indicadores de las mismas
 * encuestas). Puro: el componente las pasa a la librería `xlsx`.
 */
import { formatAppointmentShort } from '@/lib/date';
import type { SurveyRowView, SurveyScope, SurveyStats } from '@/app/actions/surveys.types';
import {
  ESTADO_LABEL,
  EXPERIENCIA_LABEL,
  EXPERIENCIAS,
  GESTION_LABEL,
  RECOMIENDA_LABEL,
  porcentaje,
  decimal,
} from './etiquetas';

type Celda = string | number;

export function filasEncuestas(rows: SurveyRowView[], scope: SurveyScope): Celda[][] {
  const global = scope === 'global';
  const encabezado = [
    'Enviada',
    'Respondida',
    'Estado',
    ...(global ? ['Clínica'] : []),
    'Paciente',
    ...(global ? ['Cédula'] : []),
    'Teléfono',
    'Gestión',
    'Estrellas del asistente',
    '¿Recomendaría la IPS?',
    '¿Cómo le fue?',
    'Comentario',
    ...(global ? ['Resumen del chat'] : []),
  ];
  const cuerpo = rows.map((r) => [
    formatAppointmentShort(r.createdAt),
    r.answeredAt ? formatAppointmentShort(r.answeredAt) : '',
    ESTADO_LABEL[r.status],
    ...(global ? [r.organizationName ?? ''] : []),
    r.patientName,
    ...(global ? [r.cedula ?? ''] : []),
    r.whatsappPhone ?? '',
    GESTION_LABEL[r.resolutionStatus],
    r.rating ?? '',
    RECOMIENDA_LABEL(r.wouldRecommend),
    r.experience ? EXPERIENCIA_LABEL[r.experience] : '',
    r.message ?? '',
    ...(global ? [r.chatSummary ?? ''] : []),
  ]);
  return [encabezado, ...cuerpo];
}

export function filasResumen(stats: SurveyStats, periodo: string, generado: Date = new Date()): Celda[][] {
  const conOpinion = stats.experience.GOOD + stats.experience.FAIR + stats.experience.BAD;
  const pct = (n: number, total: number) => (total > 0 ? porcentaje(n / total) : '—');
  return [
    ['Encuesta de satisfacción'],
    ['Periodo', periodo],
    ['Generado', formatAppointmentShort(generado)],
    [],
    ['Indicador', 'Valor', 'Detalle'],
    ['Encuestas enviadas', stats.sent, ''],
    ['Respondidas', stats.answered, `${porcentaje(stats.responseRate)} de las enviadas`],
    ['Completas', stats.complete, 'Estrellas y preguntas del hospital'],
    ['Solo estrellas', stats.starsOnly, 'No enviaron las preguntas del hospital'],
    ['Enlaces abiertos sin respuesta', stats.pending, 'Aún pueden responder (24 horas)'],
    ['Vencidas sin respuesta', stats.expired, ''],
    ['Con comentario', stats.comments, ''],
    [],
    ['¿Recomendaría la IPS a familiares y amigos?', 'Respuestas', '%'],
    ['Sí', stats.recommend.yes, pct(stats.recommend.yes, stats.recommend.yes + stats.recommend.no)],
    ['No', stats.recommend.no, pct(stats.recommend.no, stats.recommend.yes + stats.recommend.no)],
    [],
    ['¿Cómo le fue en su experiencia?', 'Respuestas', '% sin contar «No responde»'],
    ...EXPERIENCIAS.map((e) => [
      EXPERIENCIA_LABEL[e],
      stats.experience[e],
      e === 'NO_ANSWER' ? '' : pct(stats.experience[e], conOpinion),
    ]),
    [],
    ['Asistente virtual (estrellas)', 'Respuestas', ''],
    ['Promedio', decimal(stats.averageRating), ''],
    ['Promedio de quienes completaron', decimal(stats.averageRatingWithIps), ''],
    ['Promedio de quienes solo dieron estrellas', decimal(stats.averageRatingStarsOnly), ''],
    ...[5, 4, 3, 2, 1].map((n) => [`${n} estrella${n > 1 ? 's' : ''}`, stats.ratingDistribution[n - 1] ?? 0, '']),
    [],
    ['Por gestión', 'Enviadas', 'Respondidas', 'Recomendaría', 'Experiencia buena', 'Estrellas'],
    ...stats.byResolution.map((g) => [
      GESTION_LABEL[g.status],
      g.sent,
      g.answered,
      porcentaje(g.recommendRate),
      porcentaje(g.goodRate),
      decimal(g.averageRating),
    ]),
  ];
}

export function nombreArchivo(scope: SurveyScope, hoy: string): string {
  return `encuestas${scope === 'global' ? '-todas-las-clinicas' : ''}_${hoy}.xlsx`;
}

'use client';

// 📊 Estadísticas de la encuesta de satisfacción: indicadores, repartos de
// cada pregunta, evolución en el tiempo y resultados por gestión. Todo sobre
// las mismas encuestas que muestra la lista (mismos filtros, salvo el estado).
// Cada reparto muestra sus números a la vista; las gráficas del tiempo tienen
// además la tabla por gestión como vista en texto.

import type { ReactNode } from 'react';
import { MessageSquareText, Star, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type {
  ResolutionStatus,
  SurveyExperience,
  SurveyStats,
} from '@/app/actions/surveys.types';
import {
  EXPERIENCIA_LABEL,
  EXPERIENCIAS,
  GESTION_LABEL,
  decimal,
  etiquetaTramo,
  porcentaje,
} from '@/lib/encuestas/etiquetas';
import { EXPERIENCE_META } from './survey-ui';

// Series del tiempo (identidad, no estado): azul y naranja de la paleta
// validada para gráficas; «sin respuesta» en gris porque es lo secundario.
const SERIE_1 = '#2a78d6';
const SERIE_2 = '#eb6834';
const GRIS = '#c4c4bd';
const GRID = '#e4e4e7';

export interface StatsFilterActions {
  /** Filtra la lista por estrellas exactas (o quita el filtro si ya estaba). */
  onRating: (stars: number) => void;
  onExperience: (e: SurveyExperience) => void;
  onRecommend: (v: 'YES' | 'NO') => void;
  onResolution: (s: ResolutionStatus) => void;
  onComments: () => void;
  active: {
    rating?: number;
    experience?: SurveyExperience;
    recommend?: 'YES' | 'NO';
    resolutionStatus?: ResolutionStatus;
    withComment?: boolean;
  };
}

const card = 'rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900';

function Tile({
  titulo,
  valor,
  sufijo,
  detalle,
  children,
}: {
  titulo: string;
  valor: string;
  sufijo?: ReactNode;
  detalle: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`${card} flex flex-col gap-2`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{titulo}</span>
      <span className="flex items-baseline gap-1.5 text-4xl font-bold text-zinc-900 dark:text-white">
        {valor}
        {sufijo}
      </span>
      <span className="text-sm text-zinc-500 dark:text-zinc-400">{detalle}</span>
      {children}
    </div>
  );
}

/** Barra horizontal con su etiqueta y su número siempre visibles; clic = filtrar. */
function FilaBarra({
  etiqueta,
  cuenta,
  total,
  maximo,
  color,
  activa,
  onClick,
}: {
  etiqueta: ReactNode;
  cuenta: number;
  total: number;
  maximo: number;
  color: string;
  activa: boolean;
  onClick: () => void;
}) {
  const ancho = maximo > 0 ? Math.max((cuenta / maximo) * 100, cuenta > 0 ? 2 : 0) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      title={activa ? 'Quitar este filtro' : 'Ver solo estas encuestas'}
      className={`group grid w-full grid-cols-[7.5rem_1fr_5.5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:hover:bg-zinc-800/60 ${
        activa ? 'bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-900/20 dark:ring-blue-700' : ''
      }`}
    >
      <span className="truncate font-medium text-zinc-700 dark:text-zinc-200">{etiqueta}</span>
      <span className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${ancho}%` }} />
      </span>
      <span className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">
        {cuenta} <span className="text-xs text-zinc-400">({total > 0 ? Math.round((cuenta / total) * 100) : 0} %)</span>
      </span>
    </button>
  );
}

function SinDatos({ texto = 'Sin respuestas en este periodo.' }: { texto?: string }) {
  return <p className="py-6 text-center text-sm text-zinc-400">{texto}</p>;
}

type PuntoGrafica = {
  etiqueta: string;
  respondidas: number;
  sinRespuesta: number;
  recomendaria: number | null;
  buena: number | null;
  estrellas: number | null;
};

function TooltipTiempo({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as PuntoGrafica;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
      <p className="mb-1 font-semibold text-zinc-900 dark:text-white">{label}</p>
      <p className="text-zinc-600 dark:text-zinc-300">
        Respondidas: <b>{p.respondidas}</b> de {p.respondidas + p.sinRespuesta}
      </p>
      <p className="text-zinc-600 dark:text-zinc-300">
        Recomendaría: <b>{p.recomendaria == null ? '—' : `${p.recomendaria} %`}</b>
      </p>
      <p className="text-zinc-600 dark:text-zinc-300">
        Experiencia buena: <b>{p.buena == null ? '—' : `${p.buena} %`}</b>
      </p>
      <p className="text-zinc-600 dark:text-zinc-300">
        Estrellas: <b>{decimal(p.estrellas)}</b>
      </p>
    </div>
  );
}

export default function SurveyStatsPanel({
  stats,
  actions,
}: {
  stats: SurveyStats;
  actions: StatsFilterActions;
}) {
  const { active } = actions;
  const respRecomienda = stats.recommend.yes + stats.recommend.no;
  const respExperiencia = EXPERIENCIAS.reduce((s, e) => s + stats.experience[e], 0);
  const conOpinion = stats.experience.GOOD + stats.experience.FAIR + stats.experience.BAD;
  const respEstrellas = stats.ratingDistribution.reduce((a, b) => a + b, 0);
  const maxEstrellas = Math.max(...stats.ratingDistribution, 0);
  const maxExperiencia = Math.max(...EXPERIENCIAS.map((e) => stats.experience[e]), 0);
  const maxRecomienda = Math.max(stats.recommend.yes, stats.recommend.no);
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 100));

  const aPunto =
    (etiqueta: (bucket: string) => string) =>
    (p: SurveyStats['trend']['points'][number]): PuntoGrafica => ({
      etiqueta: etiqueta(p.bucket),
      respondidas: p.answered,
      sinRespuesta: p.sent - p.answered,
      recomendaria: pct(p.recommendRate),
      buena: pct(p.goodRate),
      estrellas: p.averageRating,
    });
  const puntos = stats.trend.points.map(aPunto((b) => etiquetaTramo(b, stats.trend.granularity)));
  // Con pocas respuestas al día, los porcentajes diarios saltan de 0 a 100 %:
  // en rangos largos la satisfacción va por semana.
  const semanal = !!stats.trend.weekly?.length;
  const puntosSatisfaccion = semanal
    ? stats.trend.weekly!.map(aPunto((b) => `Sem. ${etiquetaTramo(b, 'day')}`))
    : puntos;
  const hayTiempo = puntos.some((p) => p.respondidas + p.sinRespuesta > 0);
  const hayOpinionEnTiempo = puntosSatisfaccion.some((p) => p.recomendaria != null || p.buena != null);
  const porTramo =
    stats.trend.granularity === 'hour' ? 'hora' : stats.trend.granularity === 'month' ? 'mes' : 'día';
  const porTramoSatisfaccion = semanal ? 'semana' : porTramo;

  return (
    <div className="space-y-4">
      {/* ── Indicadores ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          titulo="Respuestas"
          valor={String(stats.answered)}
          detalle={
            <>
              de {stats.sent} enviadas · <b className="text-zinc-700 dark:text-zinc-200">{porcentaje(stats.responseRate)}</b>
              <br />
              {stats.complete} completas · {stats.starsOnly} solo estrellas
              <br />
              <span className="text-xs">
                Sin responder: {stats.pending} con enlace abierto · {stats.expired} vencidas
              </span>
            </>
          }
        >
          <button
            type="button"
            onClick={actions.onComments}
            aria-pressed={!!active.withComment}
            className={`mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium transition-colors ${
              active.withComment
                ? 'bg-blue-600 text-white'
                : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20'
            }`}
          >
            <MessageSquareText className="h-4 w-4" aria-hidden />
            {stats.comments} con comentario
          </button>
        </Tile>
        <Tile
          titulo="Asistente virtual"
          valor={decimal(stats.averageRating)}
          sufijo={<Star className="h-7 w-7 self-center fill-amber-400 text-amber-400" aria-hidden />}
          detalle={respEstrellas > 0 ? `Promedio de ${respEstrellas} calificaciones (1 a 5)` : 'Aún sin calificaciones'}
        />
        <Tile
          titulo="Recomendaría la IPS"
          valor={porcentaje(stats.recommendRate)}
          detalle={
            respRecomienda > 0 ? (
              <>
                <ThumbsUp className="inline h-3.5 w-3.5 text-emerald-600" aria-hidden /> Sí {stats.recommend.yes} ·{' '}
                <ThumbsDown className="inline h-3.5 w-3.5 text-red-600" aria-hidden /> No {stats.recommend.no}
              </>
            ) : (
              'Aún sin respuestas a esta pregunta'
            )
          }
        />
        <Tile
          titulo="Experiencia buena"
          valor={porcentaje(stats.goodRate)}
          detalle={
            conOpinion > 0 ? (
              <>
                Buena {stats.experience.GOOD} · Regular {stats.experience.FAIR} · Mala {stats.experience.BAD}
                <br />
                <span className="text-xs">Sin contar {stats.experience.NO_ANSWER} «No responde»</span>
              </>
            ) : (
              'Aún sin respuestas a esta pregunta'
            )
          }
        />
      </div>

      {/* ── Reparto de cada pregunta ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={card}>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Calificación del asistente virtual</h3>
          <p className="mb-3 text-xs text-zinc-500">Estrellas que le dio el paciente al chat</p>
          {respEstrellas === 0 ? (
            <SinDatos />
          ) : (
            <div className="space-y-1">
              {[5, 4, 3, 2, 1].map((n) => (
                <FilaBarra
                  key={n}
                  etiqueta={
                    <span className="inline-flex items-center gap-1">
                      {n} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                      <span className="sr-only">estrellas</span>
                    </span>
                  }
                  cuenta={stats.ratingDistribution[n - 1] ?? 0}
                  total={respEstrellas}
                  maximo={maxEstrellas}
                  color="bg-amber-400"
                  activa={active.rating === n}
                  onClick={() => actions.onRating(n)}
                />
              ))}
            </div>
          )}
          {stats.averageRatingWithIps != null && stats.averageRatingStarsOnly != null && (
            <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
              Promedio de quienes respondieron también lo del hospital:{' '}
              <b className="text-zinc-700 dark:text-zinc-200">{decimal(stats.averageRatingWithIps)} ★</b>; de quienes solo
              dieron estrellas: <b className="text-zinc-700 dark:text-zinc-200">{decimal(stats.averageRatingStarsOnly)} ★</b>.
              {Math.abs(stats.averageRatingWithIps - stats.averageRatingStarsOnly) >= 0.5 &&
                ' La diferencia es grande: los porcentajes del hospital pueden no representar a todos.'}
            </p>
          )}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">¿Recomendaría la IPS?</h3>
          <p className="mb-3 text-xs text-zinc-500">A sus familiares y amigos · {respRecomienda} respuestas</p>
          {respRecomienda === 0 ? (
            <SinDatos />
          ) : (
            <div className="space-y-1">
              <FilaBarra
                etiqueta="👍 Sí"
                cuenta={stats.recommend.yes}
                total={respRecomienda}
                maximo={maxRecomienda}
                color="bg-emerald-500"
                activa={active.recommend === 'YES'}
                onClick={() => actions.onRecommend('YES')}
              />
              <FilaBarra
                etiqueta="👎 No"
                cuenta={stats.recommend.no}
                total={respRecomienda}
                maximo={maxRecomienda}
                color="bg-red-500"
                activa={active.recommend === 'NO'}
                onClick={() => actions.onRecommend('NO')}
              />
            </div>
          )}
        </div>

        <div className={card}>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">¿Cómo le fue en su experiencia?</h3>
          <p className="mb-3 text-xs text-zinc-500">
            {respExperiencia} respuestas · porcentaje sobre todas, con «No responde»
          </p>
          {respExperiencia === 0 ? (
            <SinDatos />
          ) : (
            <div className="space-y-1">
              {EXPERIENCIAS.map((e) => (
                <FilaBarra
                  key={e}
                  etiqueta={`${EXPERIENCE_META[e].emoji} ${EXPERIENCIA_LABEL[e]}`}
                  cuenta={stats.experience[e]}
                  total={respExperiencia}
                  maximo={maxExperiencia}
                  color={EXPERIENCE_META[e].bar}
                  activa={active.experience === e}
                  onClick={() => actions.onExperience(e)}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── En el tiempo (dos gráficas: nunca dos escalas en una) ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={card}>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Encuestas por {porTramo}</h3>
          <p className="mb-3 text-xs text-zinc-500">Enviadas, separadas en respondidas y sin respuesta</p>
          {hayTiempo ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={puntos} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap={2}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={12} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<TooltipTiempo />} cursor={{ fill: 'rgba(161,161,170,0.15)' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="respondidas" name="Respondidas" stackId="a" fill={SERIE_1} isAnimationActive={false} />
                  <Bar
                    dataKey="sinRespuesta"
                    name="Sin respuesta"
                    stackId="a"
                    fill={GRIS}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <SinDatos texto="No se enviaron encuestas en este periodo." />
          )}
        </div>

        <div className={card}>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Satisfacción por {porTramoSatisfaccion}
          </h3>
          <p className="mb-3 text-xs text-zinc-500">Porcentaje que recomendaría la IPS y que tuvo una experiencia buena</p>
          {hayOpinionEnTiempo ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={puntosSatisfaccion} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={12} />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v: number) => `${v} %`}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<TooltipTiempo />} cursor={{ stroke: '#a1a1aa', strokeWidth: 1 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="recomendaria"
                    name="Recomendaría"
                    stroke={SERIE_1}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: SERIE_1 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="buena"
                    name="Experiencia buena"
                    stroke={SERIE_2}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: SERIE_2 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <SinDatos texto="Aún no hay respuestas a las preguntas de la IPS en este periodo." />
          )}
        </div>
      </div>

      {/* ── Por gestión ── */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Por gestión</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Lo que hizo el paciente con el asistente antes de recibir la encuesta. Pulse una fila para ver solo esas.
        </p>
        {stats.byResolution.length === 0 ? (
          <SinDatos texto="Sin encuestas en este periodo." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-3">Gestión</th>
                  <th className="px-3 py-2 text-right">Enviadas</th>
                  <th className="px-3 py-2 text-right">Respondidas</th>
                  <th className="px-3 py-2 text-right">Recomendaría</th>
                  <th className="px-3 py-2 text-right">Experiencia buena</th>
                  <th className="py-2 pl-3 text-right">Estrellas</th>
                </tr>
              </thead>
              <tbody>
                {stats.byResolution.map((g) => (
                  <tr
                    key={g.status}
                    onClick={() => actions.onResolution(g.status)}
                    className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60 ${
                      active.resolutionStatus === g.status ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <td className="py-2 pr-3 font-medium text-zinc-800 dark:text-zinc-100">
                      <button
                        type="button"
                        className="text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        aria-pressed={active.resolutionStatus === g.status}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.onResolution(g.status);
                        }}
                      >
                        {GESTION_LABEL[g.status]}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{g.sent}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {g.answered}{' '}
                      <span className="text-xs text-zinc-400">
                        ({g.sent > 0 ? Math.round((g.answered / g.sent) * 100) : 0} %)
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{porcentaje(g.recommendRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{porcentaje(g.goodRate)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {g.averageRating == null ? '—' : `${decimal(g.averageRating)} ★`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {stats.truncated && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Hay demasiadas encuestas para calcularlas todas: acote el periodo para ver cifras exactas.
        </p>
      )}
    </div>
  );
}

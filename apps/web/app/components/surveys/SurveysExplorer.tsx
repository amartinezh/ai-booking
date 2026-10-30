'use client';

// ⭐ Consulta de la encuesta de satisfacción — la misma herramienta para la
// clínica (scope 'clinic': solo lo suyo, sin datos internos) y para el Super
// Admin (scope 'global': todas las clínicas, con cédula y resumen del chat).
//
// Una sola fila de filtros arriba manda sobre todo: estadísticas, lista y
// descarga ven las mismas encuestas (las estadísticas ignoran el filtro de
// estado, para que la tasa de respuesta siga teniendo sentido).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useDebounce } from 'use-debounce';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Download,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { exportSurveys, getSurveyStats, getSurveys } from '@/app/actions/surveys';
import type {
  ResolutionStatus,
  SortDir,
  SurveyAnswerStatus,
  SurveyExperience,
  SurveyFilters,
  SurveyListQuery,
  SurveyListResult,
  SurveyScope,
  SurveySortField,
  SurveyStats,
  UserMood,
} from '@/app/actions/surveys.types';
import { formatAppointmentCompact, formatTimeOnly } from '@/lib/date';
import {
  ESTADO_LABEL,
  EXPERIENCIA_LABEL,
  EXPERIENCIAS,
  GESTIONES,
  GESTION_LABEL,
  PERIODOS,
  type Periodo,
  hoyLocal,
  rangoDePeriodo,
} from '@/lib/encuestas/etiquetas';
import { filasEncuestas, filasResumen, nombreArchivo } from '@/lib/encuestas/exportar';
import SurveyStatsPanel, { type StatsFilterActions } from './SurveyStatsPanel';
import SurveyDetail from './SurveyDetail';
import { ExperienceBadge, RecommendBadge, ResolutionBadge, Stars, StatusBadge, rowTint } from './survey-ui';

interface Props {
  scope: SurveyScope;
  /** Solo Super Admin: catálogo de clínicas para el filtro. */
  organizations?: { id: string; name: string }[];
}

type Estrellas = '' | '1' | '2' | '3' | '4' | '5' | UserMood;

interface Filtros {
  periodo: Periodo;
  desde: string;
  hasta: string;
  q: string;
  status: '' | SurveyAnswerStatus;
  estrellas: Estrellas;
  recommend: '' | 'YES' | 'NO';
  experience: '' | SurveyExperience;
  gestion: '' | ResolutionStatus;
  withComment: boolean;
  organizationId: string;
}

const FILTROS_INICIALES: Filtros = {
  periodo: '30d',
  desde: '',
  hasta: '',
  q: '',
  status: '',
  estrellas: '',
  recommend: '',
  experience: '',
  gestion: '',
  withComment: false,
  organizationId: '',
};

const ORDENES: { value: string; label: string; sortBy: SurveySortField; sortDir: SortDir }[] = [
  { value: 'createdAt:desc', label: 'Más recientes', sortBy: 'createdAt', sortDir: 'desc' },
  { value: 'createdAt:asc', label: 'Más antiguas', sortBy: 'createdAt', sortDir: 'asc' },
  { value: 'rating:asc', label: 'Peor calificación primero', sortBy: 'rating', sortDir: 'asc' },
  { value: 'rating:desc', label: 'Mejor calificación primero', sortBy: 'rating', sortDir: 'desc' },
  { value: 'answeredAt:desc', label: 'Respondidas recientemente', sortBy: 'answeredAt', sortDir: 'desc' },
  { value: 'patient:asc', label: 'Paciente (A-Z)', sortBy: 'patient', sortDir: 'asc' },
  { value: 'patient:desc', label: 'Paciente (Z-A)', sortBy: 'patient', sortDir: 'desc' },
];

const ESTRELLAS_OPCIONES: { value: Estrellas; label: string }[] = [
  { value: '', label: 'Todas las estrellas' },
  { value: 'HAPPY', label: '4 y 5 ★ (buenas)' },
  { value: 'NEUTRAL', label: '3 ★' },
  { value: 'NEGATIVE', label: '1 y 2 ★ (malas)' },
  { value: '5', label: 'Solo 5 ★' },
  { value: '4', label: 'Solo 4 ★' },
  { value: '2', label: 'Solo 2 ★' },
  { value: '1', label: 'Solo 1 ★' },
];

const PAGE_SIZES = [25, 50, 100];

const inputCls =
  'h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:ring-blue-900';
const btnSecundario =
  'inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';

/** Filtros de la pantalla → filtros de la API. */
function aFiltrosApi(f: Filtros, q: string): SurveyFilters {
  const fechas =
    f.periodo === 'personalizado'
      ? { startDate: f.desde || undefined, endDate: f.hasta || undefined }
      : rangoDePeriodo(f.periodo);
  const estrellasExactas = /^[1-5]$/.test(f.estrellas) ? Number(f.estrellas) : undefined;
  const animo = ['HAPPY', 'NEUTRAL', 'NEGATIVE'].includes(f.estrellas) ? (f.estrellas as UserMood) : undefined;
  return {
    ...fechas,
    q: q.trim() || undefined,
    status: f.status || undefined,
    rating: estrellasExactas,
    mood: animo,
    recommend: f.recommend || undefined,
    experience: f.experience || undefined,
    withComment: f.withComment || undefined,
    resolutionStatus: f.gestion || undefined,
    organizationId: f.organizationId || undefined,
  };
}

function textoPeriodo(f: Filtros): string {
  if (f.periodo === 'personalizado') {
    if (f.desde && f.hasta) return `Del ${f.desde} al ${f.hasta}`;
    if (f.desde) return `Desde el ${f.desde}`;
    if (f.hasta) return `Hasta el ${f.hasta}`;
    return 'Todo';
  }
  return PERIODOS.find((p) => p.value === f.periodo)?.label ?? '';
}

function Encabezado({
  campo,
  sortBy,
  sortDir,
  onSort,
  children,
  className = '',
}: {
  campo: SurveySortField;
  sortBy: SurveySortField;
  sortDir: SortDir;
  onSort: (c: SurveySortField) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const activo = sortBy === campo;
  const Icono = !activo ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 ${className}`}
      aria-sort={activo ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(campo)}
        className={`inline-flex items-center gap-1 uppercase hover:text-zinc-800 dark:hover:text-zinc-200 ${activo ? 'text-zinc-800 dark:text-zinc-100' : ''}`}
      >
        {children}
        <Icono className={`h-3.5 w-3.5 ${activo ? '' : 'opacity-40'}`} aria-hidden />
      </button>
    </th>
  );
}

const thCls = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400';

export default function SurveysExplorer({ scope, organizations = [] }: Props) {
  const global = scope === 'global';

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
  const [busqueda] = useDebounce(filtros.q, 350);
  const [orden, setOrden] = useState({ sortBy: 'createdAt' as SurveySortField, sortDir: 'desc' as SortDir });
  const [pageSize, setPageSize] = useState(25);
  const [recarga, setRecarga] = useState(0);
  const [descargando, setDescargando] = useState(false);
  const [abiertaId, setAbiertaId] = useState<string | null>(null);

  // Filtros de la API como texto: la búsqueda entra con retardo y el objeto
  // solo cambia cuando cambia algo que de verdad se consulta.
  const claveFiltros = JSON.stringify(aFiltrosApi(filtros, busqueda));
  const filtrosApi = useMemo(() => JSON.parse(claveFiltros) as SurveyFilters, [claveFiltros]);

  // Al cambiar filtros, orden o tamaño se vuelve a la página 1 (sin un efecto
  // aparte: la página guardada solo vale para la combinación con que se eligió).
  const clavePagina = `${claveFiltros}|${orden.sortBy}:${orden.sortDir}|${pageSize}`;
  const [paginaDe, setPaginaDe] = useState({ clave: clavePagina, page: 1 });
  const page = paginaDe.clave === clavePagina ? paginaDe.page : 1;
  const setPage = (p: number) => setPaginaDe({ clave: clavePagina, page: p });

  const consulta: SurveyListQuery = useMemo(
    () => ({ ...filtrosApi, page, pageSize, ...orden }),
    [filtrosApi, page, pageSize, orden],
  );
  const claveLista = `${JSON.stringify(consulta)}#${recarga}`;
  // Las estadísticas no usan el filtro de estado: cambiarlo no las vuelve a pedir.
  const claveFiltrosStats = JSON.stringify({ ...filtrosApi, status: undefined });
  const filtrosStats = useMemo(() => JSON.parse(claveFiltrosStats) as SurveyFilters, [claveFiltrosStats]);
  const claveStats = `${claveFiltrosStats}#${recarga}`;

  // Lo último que llegó, con la consulta que lo pidió: «cargando» es que lo
  // pedido y lo recibido no coinciden, y mientras tanto se ve lo anterior.
  const [lista, setLista] = useState<{ clave: string; res: SurveyListResult } | null>(null);
  const [statsDe, setStatsDe] = useState<{ clave: string; stats: SurveyStats } | null>(null);
  const [fallo, setFallo] = useState<{ lista?: string; stats?: string }>({});
  const cargandoLista = lista?.clave !== claveLista && fallo.lista !== claveLista;
  const cargandoStats = statsDe?.clave !== claveStats && fallo.stats !== claveStats;
  const rows = lista?.res.rows ?? [];
  const total = lista?.res.total ?? 0;
  const totalPages = lista?.res.totalPages ?? 1;
  const stats = statsDe?.stats ?? null;
  const error =
    fallo.lista === claveLista
      ? 'No se pudieron cargar las encuestas. Pulse «Refrescar».'
      : fallo.stats === claveStats
        ? 'No se pudieron cargar las estadísticas. Pulse «Refrescar».'
        : null;

  // Las respuestas que llegan tarde (de una consulta ya reemplazada) se descartan.
  const ultimaLista = useRef('');
  const ultimaStats = useRef('');

  useEffect(() => {
    ultimaLista.current = claveLista;
    getSurveys(scope, consulta)
      .then((res) => {
        if (ultimaLista.current !== claveLista) return;
        setLista({ clave: claveLista, res });
      })
      .catch(() => {
        if (ultimaLista.current !== claveLista) return;
        setFallo((f) => ({ ...f, lista: claveLista }));
      });
  }, [scope, consulta, claveLista]);

  // Estadísticas (sin el filtro de estado)
  useEffect(() => {
    ultimaStats.current = claveStats;
    getSurveyStats(scope, filtrosStats)
      .then((res) => {
        if (ultimaStats.current === claveStats) setStatsDe({ clave: claveStats, stats: res });
      })
      .catch(() => {
        if (ultimaStats.current !== claveStats) return;
        setFallo((f) => ({ ...f, stats: claveStats }));
      });
  }, [scope, filtrosStats, claveStats]);

  const cambiar = useCallback(<K extends keyof Filtros>(campo: K, valor: Filtros[K]) => {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  }, []);

  const alternar = useCallback(<K extends keyof Filtros>(campo: K, valor: Filtros[K]) => {
    setFiltros((f) => ({ ...f, [campo]: f[campo] === valor ? FILTROS_INICIALES[campo] : valor }));
  }, []);

  const onSort = (campo: SurveySortField) => {
    setOrden((o) =>
      o.sortBy === campo
        ? { sortBy: campo, sortDir: o.sortDir === 'asc' ? 'desc' : 'asc' }
        : { sortBy: campo, sortDir: campo === 'patient' || campo === 'rating' ? 'asc' : 'desc' },
    );
  };

  const accionesStats: StatsFilterActions = {
    onRating: (n) => alternar('estrellas', String(n) as Estrellas),
    onExperience: (e) => alternar('experience', e),
    onRecommend: (v) => alternar('recommend', v),
    onResolution: (s) => alternar('gestion', s),
    onComments: () => setFiltros((f) => ({ ...f, withComment: !f.withComment })),
    active: {
      rating: /^[1-5]$/.test(filtros.estrellas) ? Number(filtros.estrellas) : undefined,
      experience: filtros.experience || undefined,
      recommend: filtros.recommend || undefined,
      resolutionStatus: filtros.gestion || undefined,
      withComment: filtros.withComment,
    },
  };

  // Etiquetas de los filtros activos (fuera del periodo), para quitarlos de a uno.
  const chips: { key: keyof Filtros; label: string }[] = [];
  if (filtros.q.trim()) chips.push({ key: 'q', label: `Busca: «${filtros.q.trim()}»` });
  if (filtros.status) chips.push({ key: 'status', label: ESTADO_LABEL[filtros.status] });
  if (filtros.estrellas)
    chips.push({ key: 'estrellas', label: ESTRELLAS_OPCIONES.find((o) => o.value === filtros.estrellas)?.label ?? '' });
  if (filtros.recommend)
    chips.push({ key: 'recommend', label: `Recomendaría: ${filtros.recommend === 'YES' ? 'Sí' : 'No'}` });
  if (filtros.experience) chips.push({ key: 'experience', label: `Experiencia: ${EXPERIENCIA_LABEL[filtros.experience]}` });
  if (filtros.gestion) chips.push({ key: 'gestion', label: GESTION_LABEL[filtros.gestion] });
  if (filtros.withComment) chips.push({ key: 'withComment', label: 'Con comentario' });
  if (filtros.organizationId)
    chips.push({
      key: 'organizationId',
      label: organizations.find((o) => o.id === filtros.organizationId)?.name ?? 'Clínica',
    });

  const limpiar = () => setFiltros((f) => ({ ...FILTROS_INICIALES, periodo: f.periodo, desde: f.desde, hasta: f.hasta }));

  async function descargar() {
    setDescargando(true);
    try {
      const [res, resumen] = await Promise.all([
        exportSurveys(scope, { ...consulta, page: 1 }),
        stats && !cargandoStats ? Promise.resolve(stats) : getSurveyStats(scope, filtrosStats),
      ]);
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      const hoja = XLSX.utils.aoa_to_sheet(filasEncuestas(res.rows, scope));
      hoja['!cols'] = filasEncuestas([], scope)[0].map((titulo) => ({
        wch: titulo === 'Comentario' || titulo === 'Resumen del chat' ? 60 : titulo === 'Paciente' ? 32 : 20,
      }));
      XLSX.utils.book_append_sheet(libro, hoja, 'Encuestas');
      const hojaResumen = XLSX.utils.aoa_to_sheet(filasResumen(resumen, textoPeriodo(filtros)));
      hojaResumen['!cols'] = [{ wch: 44 }, { wch: 14 }, { wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen');
      XLSX.writeFile(libro, nombreArchivo(scope, hoyLocal()));
      if (res.truncated) {
        toast.warning(`Se descargaron las primeras ${res.rows.length} de ${res.total} encuestas. Acote el periodo para bajar el resto.`);
      } else {
        toast.success(`Descargadas ${res.rows.length} encuestas.`);
      }
    } catch {
      toast.error('No se pudo descargar. Intente de nuevo.');
    } finally {
      setDescargando(false);
    }
  }

  const desde = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const hasta = Math.min(page * pageSize, total);
  const columnas = global ? 8 : 7;
  const indiceAbierta = abiertaId ? rows.findIndex((r) => r.id === abiertaId) : -1;
  const fila = indiceAbierta >= 0 ? rows[indiceAbierta] : null;
  const cargando = cargandoLista || cargandoStats;

  return (
    <div className="mx-auto max-w-7xl space-y-6 py-2">
      {!global && (
        <Link
          href="/dashboard/configuracion?tab=integrations"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-blue-600"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a Integraciones
        </Link>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            ⭐ {global ? 'Encuestas de satisfacción (todas las clínicas)' : 'Opiniones de tus pacientes'}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            La encuesta que el asistente envía al cerrar cada gestión: ¿recomendaría la IPS?, ¿cómo le fue? y
            las estrellas del asistente.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={descargar} disabled={descargando || total === 0} className={btnSecundario}>
            <Download className={`h-4 w-4 ${descargando ? 'animate-pulse' : ''}`} aria-hidden />
            {descargando ? 'Preparando…' : 'Descargar Excel'}
          </button>
          <button type="button" onClick={() => setRecarga((n) => n + 1)} className={btnSecundario}>
            <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} aria-hidden /> Refrescar
          </button>
        </div>
      </header>

      {/* ── Filtros: una sola fila que manda sobre todo lo de abajo ── */}
      <section
        aria-label="Filtros"
        className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-zinc-500">
            Buscar
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
              <input
                type="search"
                value={filtros.q}
                onChange={(e) => cambiar('q', e.target.value)}
                placeholder="Nombre, cédula, teléfono o comentario"
                className={`${inputCls} w-full pl-9`}
                maxLength={100}
              />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
            Periodo (envío)
            <select
              value={filtros.periodo}
              onChange={(e) => cambiar('periodo', e.target.value as Periodo)}
              className={inputCls}
            >
              {PERIODOS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {filtros.periodo === 'personalizado' && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
                Desde
                <input
                  type="date"
                  value={filtros.desde}
                  max={filtros.hasta || undefined}
                  onChange={(e) => cambiar('desde', e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
                Hasta
                <input
                  type="date"
                  value={filtros.hasta}
                  min={filtros.desde || undefined}
                  onChange={(e) => cambiar('hasta', e.target.value)}
                  className={inputCls}
                />
              </label>
            </>
          )}
          {global && (
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
              Clínica
              <select
                value={filtros.organizationId}
                onChange={(e) => cambiar('organizationId', e.target.value)}
                className={`${inputCls} max-w-[220px]`}
              >
                <option value="">Todas las clínicas</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
            Estado
            <select
              value={filtros.status}
              onChange={(e) => cambiar('status', e.target.value as Filtros['status'])}
              className={inputCls}
            >
              <option value="">Todas</option>
              <option value="ANSWERED">Respondidas</option>
              <option value="PENDING">Enlace abierto</option>
              <option value="EXPIRED">Vencidas sin respuesta</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
            ¿Recomendaría?
            <select
              value={filtros.recommend}
              onChange={(e) => cambiar('recommend', e.target.value as Filtros['recommend'])}
              className={inputCls}
            >
              <option value="">Sí y no</option>
              <option value="YES">Sí</option>
              <option value="NO">No</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
            ¿Cómo le fue?
            <select
              value={filtros.experience}
              onChange={(e) => cambiar('experience', e.target.value as Filtros['experience'])}
              className={inputCls}
            >
              <option value="">Todas</option>
              {EXPERIENCIAS.map((e) => (
                <option key={e} value={e}>
                  {EXPERIENCIA_LABEL[e]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
            Asistente
            <select
              value={filtros.estrellas}
              onChange={(e) => cambiar('estrellas', e.target.value as Estrellas)}
              className={inputCls}
            >
              {ESTRELLAS_OPCIONES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
            Gestión
            <select
              value={filtros.gestion}
              onChange={(e) => cambiar('gestion', e.target.value as Filtros['gestion'])}
              className={inputCls}
            >
              <option value="">Todas</option>
              {GESTIONES.map((g) => (
                <option key={g} value={g}>
                  {GESTION_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={filtros.withComment}
              onChange={(e) => cambiar('withComment', e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            Solo con comentario
          </label>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => cambiar(c.key, FILTROS_INICIALES[c.key])}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300"
                aria-label={`Quitar filtro: ${c.label}`}
              >
                {c.label}
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ))}
            <button type="button" onClick={limpiar} className="text-xs font-medium text-zinc-500 hover:text-zinc-800 hover:underline">
              Limpiar filtros
            </button>
          </div>
        )}
      </section>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── Estadísticas ── */}
      <section aria-label="Estadísticas" className={`transition-opacity ${cargandoStats && stats ? 'opacity-60' : ''}`}>
        {stats ? (
          <SurveyStatsPanel stats={stats} actions={accionesStats} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/60" />
            ))}
          </div>
        )}
      </section>

      {/* ── Lista ── */}
      <section aria-label="Encuestas" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Encuestas</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {total === 0 ? 'Ninguna con estos filtros.' : `${desde}–${hasta} de ${total}. Pulse una fila para ver el detalle.`}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-500">
            Ordenar
            <select
              value={`${orden.sortBy}:${orden.sortDir}`}
              onChange={(e) => {
                const o = ORDENES.find((x) => x.value === e.target.value);
                if (o) setOrden({ sortBy: o.sortBy, sortDir: o.sortDir });
              }}
              className={inputCls}
            >
              {ORDENES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className={`w-full overflow-x-auto rounded-xl border border-zinc-200 bg-white transition-opacity dark:border-zinc-800 dark:bg-zinc-900 ${
            cargandoLista && rows.length > 0 ? 'opacity-60' : ''
          }`}
        >
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              <tr>
                <Encabezado campo="patient" {...orden} onSort={onSort}>
                  Paciente
                </Encabezado>
                {global && <th className={thCls}>Clínica</th>}
                <th className={thCls}>¿Recomendaría?</th>
                <th className={thCls}>¿Cómo le fue?</th>
                <Encabezado campo="rating" {...orden} onSort={onSort}>
                  Asistente
                </Encabezado>
                <th className={thCls}>Comentario</th>
                <th className={thCls}>Gestión</th>
                <Encabezado campo="createdAt" {...orden} onSort={onSort}>
                  Enviada
                </Encabezado>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !cargandoLista ? (
                <tr>
                  <td colSpan={columnas} className="py-12 text-center text-zinc-400">
                    {chips.length > 0 ? (
                      <>
                        No hay encuestas con estos filtros.{' '}
                        <button type="button" onClick={limpiar} className="font-medium text-blue-600 hover:underline">
                          Limpiar filtros
                        </button>
                      </>
                    ) : (
                      'Aún no hay encuestas en este periodo.'
                    )}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columnas} className="py-12 text-center text-zinc-400">
                    Cargando…
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const respondida = r.status === 'ANSWERED';
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setAbiertaId(r.id)}
                      className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${rowTint(r.experience, r.userMood)}`}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAbiertaId(r.id);
                          }}
                          className="text-left font-medium text-zinc-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:text-zinc-100"
                        >
                          {r.patientName}
                        </button>
                        <div className="text-xs text-zinc-400">{r.whatsappPhone ?? 'Sin teléfono'}</div>
                      </td>
                      {global && <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">{r.organizationName}</td>}
                      {respondida ? (
                        <>
                          <td className="px-4 py-3">
                            <RecommendBadge value={r.wouldRecommend} />
                          </td>
                          <td className="px-4 py-3">
                            <ExperienceBadge value={r.experience} />
                          </td>
                          <td className="px-4 py-3">
                            <Stars rating={r.rating} />
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="px-4 py-3">
                          <StatusBadge status={r.status} />
                        </td>
                      )}
                      <td className="max-w-[280px] px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200">
                        {r.message ? (
                          <span className="line-clamp-2" title={r.message}>
                            {r.message}
                          </span>
                        ) : (
                          <span className="text-zinc-300 dark:text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ResolutionBadge status={r.resolutionStatus} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                        {formatAppointmentCompact(r.createdAt)}
                        {r.answeredAt && (
                          <div className="text-zinc-400">respondió {formatTimeOnly(r.answeredAt)}</div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-500">
          <label className="flex items-center gap-2">
            Por página
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className={`${inputCls} h-9`}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              disabled={page <= 1 || cargandoLista}
              onClick={() => setPage(page - 1)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages || cargandoLista}
              onClick={() => setPage(page + 1)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Siguiente
            </button>
          </div>
        </div>
      </section>

      {fila && (
        <SurveyDetail
          key={fila.id}
          row={fila}
          onClose={() => setAbiertaId(null)}
          onPrev={indiceAbierta > 0 ? () => setAbiertaId(rows[indiceAbierta - 1].id) : undefined}
          onNext={indiceAbierta < rows.length - 1 ? () => setAbiertaId(rows[indiceAbierta + 1].id) : undefined}
        />
      )}
    </div>
  );
}

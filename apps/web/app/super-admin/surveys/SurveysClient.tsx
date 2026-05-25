'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { getDetailedSurveys } from '@/app/actions/surveys';
import type {
  DetailedSurveyRow,
  ResolutionStatus,
  SortDir,
  SurveySortField,
  UserMood,
} from '@/app/actions/surveys.types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import {
  MoodBadge,
  moodRowClass,
  ResolutionBadge,
  Stars,
} from '@/app/components/surveys/survey-ui';

interface Props {
  organizations: { id: string; name: string }[];
}

const MOOD_OPTIONS: { value: UserMood | ''; label: string }[] = [
  { value: '', label: 'Todos los ánimos' },
  { value: 'HAPPY', label: '😊 Feliz' },
  { value: 'NEUTRAL', label: '😐 Neutral' },
  { value: 'NEGATIVE', label: '😞 Negativo' },
];

const RESOLUTION_OPTIONS: { value: ResolutionStatus | ''; label: string }[] = [
  { value: '', label: 'Toda resolución' },
  { value: 'BOOKED', label: 'Agendado' },
  { value: 'QUEUED', label: 'En cola' },
  { value: 'BLOCKED_INSULT', label: 'Bloqueado (insulto)' },
  { value: 'SYSTEM_ERROR', label: 'Error técnico' },
  { value: 'CANCELLED', label: 'Cancelado' },
];

const PAGE_SIZE = 25;
const inputCls =
  'rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200';

export default function SurveysClient({ organizations }: Props) {
  const [rows, setRows] = useState<DetailedSurveyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Filtros
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [mood, setMood] = useState<UserMood | ''>('');
  const [resolutionStatus, setResolutionStatus] = useState<ResolutionStatus | ''>('');

  // Orden
  const [sortBy, setSortBy] = useState<SurveySortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(
    (targetPage: number) => {
      setError(null);
      startTransition(async () => {
        try {
          const res = await getDetailedSurveys({
            page: targetPage,
            pageSize: PAGE_SIZE,
            sortBy,
            sortDir,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            organizationId: organizationId || undefined,
            mood: mood || undefined,
            resolutionStatus: resolutionStatus || undefined,
          });
          setRows(res.rows);
          setTotal(res.total);
          setTotalPages(res.totalPages);
          setPage(res.page);
        } catch {
          setError('No se pudieron cargar las encuestas. Intenta de nuevo.');
        }
      });
    },
    [sortBy, sortDir, startDate, endDate, organizationId, mood, resolutionStatus],
  );

  // Recarga al cambiar filtros u orden (vuelve a la página 1).
  useEffect(() => {
    load(1);
  }, [load]);

  const toggleSort = (field: SurveySortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: SurveySortField }) =>
    sortBy === field ? (
      sortDir === 'asc' ? (
        <ArrowUp className="inline h-3.5 w-3.5" />
      ) : (
        <ArrowDown className="inline h-3.5 w-3.5" />
      )
    ) : null;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            ⭐ Encuestas de Satisfacción (Global)
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Diagnóstico CSAT de todas las clínicas — {total} resultado{total === 1 ? '' : 's'}.
          </p>
        </div>
        <button
          onClick={() => load(page)}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} /> Refrescar
        </button>
      </header>

      {/* Filtros globales */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
          Desde
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
          Hasta
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
          Clínica
          <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className={inputCls}>
            <option value="">Todas las clínicas</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
          Ánimo
          <select value={mood} onChange={(e) => setMood(e.target.value as UserMood | '')} className={inputCls}>
            {MOOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-500">
          Resolución
          <select
            value={resolutionStatus}
            onChange={(e) => setResolutionStatus(e.target.value as ResolutionStatus | '')}
            className={inputCls}
          >
            {RESOLUTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Data Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Paciente</TableHead>
            <TableHead>Clínica</TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('rating')}>
              Calificación <SortIcon field="rating" />
            </TableHead>
            <TableHead>Ánimo</TableHead>
            <TableHead>Mensaje</TableHead>
            <TableHead>Contexto chat</TableHead>
            <TableHead>Resolución</TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('createdAt')}>
              Fecha <SortIcon field="createdAt" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && !isPending ? (
            <TableRow>
              <TableCell colSpan={8} className="py-10 text-center text-zinc-400">
                No hay encuestas para los filtros seleccionados.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id} className={moodRowClass(r.userMood)}>
                <TableCell>
                  <div className="font-medium text-zinc-800 dark:text-zinc-100">
                    {r.patient?.fullName ?? 'Paciente anónimo'}
                  </div>
                  <div className="text-xs text-zinc-400">{r.patient?.whatsappId ?? '—'}</div>
                </TableCell>
                <TableCell className="text-sm">{r.organization.name}</TableCell>
                <TableCell>
                  <Stars rating={r.rating} />
                </TableCell>
                <TableCell>
                  <MoodBadge mood={r.userMood} />
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-sm" title={r.feedback ?? ''}>
                  {r.feedback || <span className="text-zinc-300">—</span>}
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-xs text-zinc-500" title={r.chatSummary ?? ''}>
                  {r.chatSummary || <span className="text-zinc-300">—</span>}
                </TableCell>
                <TableCell>
                  <ResolutionBadge status={r.resolutionStatus} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                  {new Date(r.createdAt).toLocaleString('es-CO', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Paginación */}
      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1 || isPending}
            onClick={() => load(page - 1)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Anterior
          </button>
          <button
            disabled={page >= totalPages || isPending}
            onClick={() => load(page + 1)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}

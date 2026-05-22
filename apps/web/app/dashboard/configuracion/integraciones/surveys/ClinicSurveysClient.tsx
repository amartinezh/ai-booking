'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowLeft, RefreshCw } from 'lucide-react';
import { getClinicSurveys } from '@/app/actions/surveys';
import type {
  LimitedSurveyRow,
  SortDir,
  SurveySortField,
} from '@/app/actions/surveys.types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import { MoodBadge, moodRowClass, Stars } from '@/app/components/surveys/survey-ui';

const PAGE_SIZE = 25;

export default function ClinicSurveysClient() {
  const [rows, setRows] = useState<LimitedSurveyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [sortBy, setSortBy] = useState<SurveySortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(
    (targetPage: number) => {
      setError(null);
      startTransition(async () => {
        try {
          const res = await getClinicSurveys({
            page: targetPage,
            pageSize: PAGE_SIZE,
            sortBy,
            sortDir,
          });
          setRows(res.rows);
          setTotal(res.total);
          setTotalPages(res.totalPages);
          setPage(res.page);
        } catch {
          setError('No se pudieron cargar las encuestas de tu clínica.');
        }
      });
    },
    [sortBy, sortDir],
  );

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
    <div className="mx-auto max-w-4xl space-y-6 py-2">
      <Link
        href="/dashboard/configuracion?tab=integrations"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-blue-600"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a Integraciones
      </Link>

      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            ⭐ Opiniones de tus pacientes
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Calificaciones del asistente virtual — {total} respuesta{total === 1 ? '' : 's'}.
          </p>
        </div>
        <button
          onClick={() => load(page)}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} /> Refrescar
        </button>
      </header>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Paciente</TableHead>
            <TableHead>Teléfono</TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('rating')}>
              Calificación <SortIcon field="rating" />
            </TableHead>
            <TableHead>Mensaje</TableHead>
            <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('createdAt')}>
              Fecha <SortIcon field="createdAt" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && !isPending ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-zinc-400">
                Aún no hay calificaciones de pacientes.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id} className={moodRowClass(r.userMood)}>
                <TableCell className="font-medium text-zinc-800 dark:text-zinc-100">
                  {r.patientName}
                </TableCell>
                <TableCell className="text-sm text-zinc-500">{r.whatsappPhone ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Stars rating={r.rating} />
                    <MoodBadge mood={r.userMood} />
                  </div>
                </TableCell>
                <TableCell className="max-w-[280px] truncate text-sm" title={r.message ?? ''}>
                  {r.message || <span className="text-zinc-300">—</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                  {new Date(r.createdAt).toLocaleString('es-CO', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

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

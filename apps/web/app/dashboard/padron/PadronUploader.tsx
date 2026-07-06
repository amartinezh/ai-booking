'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    CheckCircle2,
    Download,
    FileSpreadsheet,
    Loader2,
    ShieldCheck,
    Upload,
    XCircle,
} from 'lucide-react';
import { PADRON_CSV_HEADERS } from '@agenia/shared';
import {
    importPadronCsvAction,
    validatePadronCsvAction,
    type PadronValidationSummary,
} from './actions';

const MAX_FILE_BYTES = 6_000_000;

const TEMPLATE_CSV =
    PADRON_CSV_HEADERS.join(',') +
    '\n1088123456,Ana María Pérez,Sura,3001234567,ana@mail.com,1990-05-10,F,Calle 10 #5-20\n';

// ─────────────────────────────────────────────────────────────
// Cargador del padrón: flujo estricto de dos pasos.
//   1) VALIDAR  → reporte detallado (sin tocar la base de datos).
//   2) IMPORTAR → solo se habilita si la validación fue exitosa; cualquier
//      cambio de archivo invalida el reporte y obliga a validar de nuevo.
// ─────────────────────────────────────────────────────────────
export default function PadronUploader() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [fileName, setFileName] = useState<string | null>(null);
    const [csvText, setCsvText] = useState<string | null>(null);
    const [report, setReport] = useState<PadronValidationSummary | null>(null);
    const [importResult, setImportResult] = useState<{ created: number; updated: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isValidating, startValidating] = useTransition();
    const [isImporting, startImporting] = useTransition();

    const busy = isValidating || isImporting;
    const canImport = !!report?.ok && !!csvText && !busy && !importResult;

    function resetOutcome() {
        setReport(null);
        setImportResult(null);
        setError(null);
    }

    async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
        resetOutcome();
        setCsvText(null);
        setFileName(null);

        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
            setError('El archivo supera el tamaño máximo permitido (6 MB).');
            return;
        }
        setFileName(file.name);
        setCsvText(await file.text());
    }

    function handleValidate() {
        if (!csvText) return;
        resetOutcome();
        startValidating(async () => {
            const result = await validatePadronCsvAction(csvText);
            if (result.success) {
                setReport(result.report);
            } else {
                setError(result.error);
            }
        });
    }

    function handleImport() {
        if (!csvText || !report?.ok) return;
        setError(null);
        startImporting(async () => {
            const result = await importPadronCsvAction(csvText);
            if (result.success) {
                setImportResult({ created: result.created ?? 0, updated: result.updated ?? 0 });
                router.refresh(); // refresca la tabla server-side del padrón
            } else {
                setError(result.error ?? 'Error al importar el padrón');
            }
        });
    }

    function downloadTemplate() {
        const blob = new Blob([`﻿${TEMPLATE_CSV}`], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'plantilla_padron_eps.csv';
        link.click();
        URL.revokeObjectURL(url);
    }

    return (
        <section className="rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-sm p-6 space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-teal-600" />
                        Importar pacientes desde CSV
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Columnas: <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{PADRON_CSV_HEADERS.join(', ')}</code>.
                        La columna <strong>eps</strong> debe coincidir con una EPS activa de la clínica.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={downloadTemplate}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                    <Download className="h-4 w-4" /> Plantilla CSV
                </button>
            </header>

            {/* Selector de archivo */}
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 px-6 py-8 text-center transition-colors hover:border-teal-400 hover:bg-teal-50/50 dark:hover:bg-teal-900/10">
                <Upload className="h-8 w-8 text-zinc-400" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    {fileName ?? 'Haga clic para seleccionar el archivo .csv del padrón'}
                </span>
                <span className="text-xs text-zinc-400">Máximo 6 MB — UTF-8, separado por coma o punto y coma</span>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChange}
                    className="hidden"
                />
            </label>

            {/* Botonera del flujo Validar → Importar */}
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={handleValidate}
                    disabled={!csvText || busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    1. Validar archivo
                </button>
                <button
                    type="button"
                    onClick={handleImport}
                    disabled={!canImport}
                    title={!report?.ok ? 'Primero valide el archivo sin errores' : undefined}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    2. Importar pacientes
                </button>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
                </div>
            )}

            {/* Resultado de la importación */}
            {importResult && (
                <div className="flex items-start gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                        Importación exitosa: <strong>{importResult.created}</strong> paciente(s) nuevo(s) y{' '}
                        <strong>{importResult.updated}</strong> actualizado(s). Ya pueden agendar por su EPS.
                    </span>
                </div>
            )}

            {/* Reporte de validación */}
            {report && !importResult && (
                <div
                    className={`rounded-xl px-4 py-4 text-sm space-y-3 ${
                        report.ok
                            ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
                            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
                    }`}
                >
                    <p className="font-semibold flex items-center gap-2">
                        {report.ok ? (
                            <>
                                <CheckCircle2 className="h-4 w-4" /> Archivo válido: {report.validCount} paciente(s) listo(s)
                                para importar.
                            </>
                        ) : (
                            <>
                                <XCircle className="h-4 w-4" /> El archivo tiene {report.errorCount} error(es) en{' '}
                                {report.totalDataRows} fila(s). Corríjalo y vuelva a validar.
                            </>
                        )}
                    </p>

                    {report.rowsPerEps.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {report.rowsPerEps.map(({ epsName, count }) => (
                                <span
                                    key={epsName}
                                    className="rounded-full bg-white/70 dark:bg-zinc-900/40 px-3 py-1 text-xs font-medium"
                                >
                                    {epsName}: {count}
                                </span>
                            ))}
                        </div>
                    )}

                    {report.errors.length > 0 && (
                        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-white/60 dark:bg-zinc-900/40 p-3 text-xs">
                            {report.errors.map((err, idx) => (
                                <li key={idx}>
                                    <strong>Línea {err.line}</strong>
                                    {err.column ? ` · ${err.column}` : ''}: {err.message}
                                </li>
                            ))}
                            {report.errorCount > report.errors.length && (
                                <li className="italic">… y {report.errorCount - report.errors.length} error(es) más.</li>
                            )}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}

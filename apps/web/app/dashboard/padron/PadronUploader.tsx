'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    AlertTriangle,
    CheckCircle2,
    Download,
    FileSpreadsheet,
    History,
    Loader2,
    ShieldCheck,
    Upload,
    XCircle,
} from 'lucide-react';
import { PADRON_CSV_HEADERS } from '@agenia/shared';
import {
    getActiveEpsOptionsAction,
    getPadronFullErrorReportAction,
    importPadronCsvAction,
    validatePadronCsvAction,
    type EpsOption,
    type PadronImportResult,
    type PadronValidationSummary,
} from './actions';

const MAX_FILE_BYTES = 6_000_000;

const TEMPLATE_CSV = PADRON_CSV_HEADERS.join(',') + '\n1088123456,SUBSIDIADO,3001234567\n';

// Firmas binarias (primeros bytes del archivo) que jamás corresponden a un
// CSV de texto: se revisan sobre los bytes CRUDOS, antes de decodificar nada,
// para dar el mensaje correcto de inmediato sin gastar un roundtrip al server.
const BINARY_SIGNATURES: Array<{ bytes: number[]; label: string }> = [
    { bytes: [0x50, 0x4b, 0x03, 0x04], label: 'un archivo Excel (.xlsx) o ZIP' },
    { bytes: [0x50, 0x4b, 0x05, 0x06], label: 'un archivo Excel (.xlsx) o ZIP vacío' },
    { bytes: [0xd0, 0xcf, 0x11, 0xe0], label: 'un archivo Excel antiguo (.xls)' },
    { bytes: [0x25, 0x50, 0x44, 0x46], label: 'un archivo PDF' },
];

async function sniffBinarySignature(file: File): Promise<string | null> {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    for (const { bytes, label } of BINARY_SIGNATURES) {
        if (bytes.every((b, i) => head[i] === b)) return label;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────
// Cargador del padrón: flujo estricto de dos pasos, con la EPS elegida en
// pantalla (no se lee de una columna del archivo — un archivo = una EPS).
//   1) VALIDAR  → reporte detallado (sin tocar la base de datos), incluido
//      cuánta gente de esa EPS quedaría desactivada si se aplica tal cual.
//   2) IMPORTAR → solo se habilita si la validación fue exitosa; cualquier
//      cambio de archivo o de EPS invalida el reporte y obliga a validar de
//      nuevo. Si la baja supera el 10% del padrón activo de la EPS, pide una
//      confirmación explícita antes de aplicar el corte.
// ─────────────────────────────────────────────────────────────
export default function PadronUploader() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [epsOptions, setEpsOptions] = useState<EpsOption[] | null>(null);
    const [epsLoadError, setEpsLoadError] = useState<string | null>(null);
    const [selectedEpsId, setSelectedEpsId] = useState<string>('');

    const [fileName, setFileName] = useState<string | null>(null);
    const [csvText, setCsvText] = useState<string | null>(null);
    const [report, setReport] = useState<PadronValidationSummary | null>(null);
    const [confirmDeactivation, setConfirmDeactivation] = useState(false);
    const [importResult, setImportResult] = useState<PadronImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isValidating, startValidating] = useTransition();
    const [isImporting, startImporting] = useTransition();
    const [isDownloadingReport, startDownloadingReport] = useTransition();

    useEffect(() => {
        getActiveEpsOptionsAction().then((result) => {
            if (result.success) {
                setEpsOptions(result.eps);
                if (result.eps.length === 1) setSelectedEpsId(result.eps[0].id);
            } else {
                setEpsLoadError(result.error);
            }
        });
    }, []);

    const busy = isValidating || isImporting;
    const canValidate = !!csvText && !!selectedEpsId && !busy;
    const canImport =
        !!report?.ok &&
        !!csvText &&
        !busy &&
        !importResult &&
        (!report.needsDeactivationConfirmation || confirmDeactivation);

    function resetOutcome() {
        setReport(null);
        setImportResult(null);
        setConfirmDeactivation(false);
        setError(null);
    }

    async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
        resetOutcome();
        setCsvText(null);
        setFileName(null);

        const file = event.target.files?.[0];
        if (!file) return;

        if (!/\.csv$/i.test(file.name)) {
            setError(
                `Extensión no permitida: "${file.name}". Seleccione un archivo .csv (si lo tiene en Excel, use Archivo → Guardar como → CSV UTF-8).`,
            );
            event.target.value = '';
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            setError('El archivo supera el tamaño máximo permitido (6 MB).');
            event.target.value = '';
            return;
        }
        if (file.size === 0) {
            setError('El archivo está vacío.');
            event.target.value = '';
            return;
        }

        const binaryLabel = await sniffBinarySignature(file);
        if (binaryLabel) {
            setError(
                `"${file.name}" parece ser ${binaryLabel}, no un CSV de texto. Expórtelo como "CSV UTF-8 (delimitado por comas)" y vuelva a intentarlo.`,
            );
            event.target.value = '';
            return;
        }

        setFileName(file.name);
        setCsvText(await file.text());
    }

    function handleDownloadErrorReport() {
        if (!csvText) return;
        startDownloadingReport(async () => {
            const result = await getPadronFullErrorReportAction(csvText);
            if (!result.success) {
                setError(result.error);
                return;
            }
            const blob = new Blob([`﻿${result.csv}`], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'errores_padron_eps.csv';
            link.click();
            URL.revokeObjectURL(url);
        });
    }

    function handleValidate() {
        if (!csvText || !selectedEpsId) return;
        resetOutcome();
        startValidating(async () => {
            const result = await validatePadronCsvAction(csvText, selectedEpsId);
            if (result.success) {
                setReport(result.report);
            } else {
                setError(result.error);
            }
        });
    }

    function handleImport() {
        if (!csvText || !report?.ok || !selectedEpsId) return;
        setError(null);
        startImporting(async () => {
            const result = await importPadronCsvAction(
                csvText,
                selectedEpsId,
                fileName ?? 'padron.csv',
                confirmDeactivation,
            );
            if (result.success) {
                setImportResult(result);
                router.refresh(); // refresca la tabla server-side del padrón
            } else if (result.needsDeactivationConfirmation) {
                // La cifra cambió entre validar e importar (alguien más
                // tocó el padrón mientras tanto): re-exponer la guarda.
                setError(result.error ?? null);
                setConfirmDeactivation(false);
                setReport((prev) => (prev ? { ...prev, needsDeactivationConfirmation: true } : prev));
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
                        Importar corte del padrón desde CSV
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Columnas: <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{PADRON_CSV_HEADERS.join(', ')}</code>.
                        Solo <strong>cedula</strong> es obligatoria — la EPS se elige aquí abajo, no en el archivo.
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                        Cada archivo reemplaza por completo el padrón activo de la EPS elegida: quien no venga en
                        este corte queda inactivo. Puede recargar el mismo archivo cuantas veces necesite.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        href="/dashboard/padron/historial"
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                        <History className="h-4 w-4" /> Historial de cargas
                    </Link>
                    <button
                        type="button"
                        onClick={downloadTemplate}
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                        <Download className="h-4 w-4" /> Plantilla CSV
                    </button>
                </div>
            </header>

            {/* Selector de EPS — un archivo = una EPS */}
            <div className="flex flex-col gap-1.5">
                <label htmlFor="padron-eps" className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    EPS de este archivo
                </label>
                {epsLoadError ? (
                    <p className="text-sm text-red-600 dark:text-red-400">{epsLoadError}</p>
                ) : epsOptions === null ? (
                    <p className="text-sm text-zinc-400">Cargando EPS activas…</p>
                ) : epsOptions.length === 0 ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                        La clínica no tiene EPS activas. Cree las EPS en &quot;Aseguradoras (EPS)&quot; antes de
                        importar el padrón.
                    </p>
                ) : (
                    <select
                        id="padron-eps"
                        value={selectedEpsId}
                        onChange={(e) => {
                            setSelectedEpsId(e.target.value);
                            resetOutcome();
                        }}
                        disabled={busy}
                        className="max-w-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 focus:border-teal-400 focus:outline-none disabled:opacity-50"
                    >
                        <option value="" disabled>
                            Seleccione una EPS…
                        </option>
                        {epsOptions.map((eps) => (
                            <option key={eps.id} value={eps.id}>
                                {eps.name}
                            </option>
                        ))}
                    </select>
                )}
            </div>

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
                    disabled={!canValidate}
                    title={!selectedEpsId ? 'Seleccione primero la EPS de este archivo' : undefined}
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
                    2. Importar corte
                </button>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
                </div>
            )}

            {/* Resultado de la importación: el resumen completo del corte */}
            {importResult?.success && (
                <div className="flex items-start gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                        <p className="font-semibold">Corte aplicado.</p>
                        <p>
                            <strong>{importResult.created ?? 0}</strong> alta(s) nueva(s),{' '}
                            <strong>{importResult.updated ?? 0}</strong> actualizado(s),{' '}
                            <strong>{importResult.reactivated ?? 0}</strong> reactivado(s) y{' '}
                            <strong>{importResult.deactivated ?? 0}</strong> desactivado(s) por no venir en este
                            archivo. Ya pueden agendar por su EPS quienes quedaron activos.
                        </p>
                    </div>
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
                                <CheckCircle2 className="h-4 w-4" /> Archivo válido para <strong>{report.epsName}</strong>:{' '}
                                {report.validCount} afiliado(s) listo(s) para importar.
                            </>
                        ) : (
                            <>
                                <XCircle className="h-4 w-4" /> El archivo tiene {report.errorCount} error(es) en{' '}
                                {report.totalDataRows} fila(s). Corríjalo y vuelva a validar.
                            </>
                        )}
                    </p>

                    {report.ok && (
                        <p className="text-xs opacity-80">
                            {report.activeForEps} afiliado(s) de {report.epsName} están activos hoy; este corte
                            desactivaría {report.wouldDeactivate} por no venir en el archivo.
                        </p>
                    )}

                    {report.ok && report.needsDeactivationConfirmation && (
                        <div className="rounded-lg bg-white/70 dark:bg-zinc-900/40 p-3 space-y-2">
                            <p className="flex items-start gap-2 font-medium">
                                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                                Este corte desactivaría más del 10% del padrón activo de {report.epsName} (
                                {report.wouldDeactivate} de {report.activeForEps}). Si el archivo llegó incompleto
                                por error, cancele y revíselo antes de continuar.
                            </p>
                            <label className="flex items-center gap-2 text-xs">
                                <input
                                    type="checkbox"
                                    checked={confirmDeactivation}
                                    onChange={(e) => setConfirmDeactivation(e.target.checked)}
                                />
                                Confirmo que el archivo es correcto y completo: aplicar la desactivación masiva.
                            </label>
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

                    {report.errorCount > 0 && (
                        <button
                            type="button"
                            onClick={handleDownloadErrorReport}
                            disabled={isDownloadingReport}
                            className="inline-flex items-center gap-2 rounded-lg border border-current/30 px-3 py-1.5 text-xs font-medium hover:bg-white/50 dark:hover:bg-zinc-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isDownloadingReport ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            Descargar reporte completo de errores ({report.errorCount})
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

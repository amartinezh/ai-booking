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
    Info,
    Loader2,
    Sparkles,
    ShieldCheck,
    Upload,
    XCircle,
} from 'lucide-react';
import { detectPadronEps, PADRON_CSV_HEADERS, type PadronEpsDetection } from '@agenia/shared';
import {
    readFileWithProgress,
    sniffBinarySignature,
    xlsxToCsv,
    type UploadProgress,
} from '@/lib/spreadsheet-upload';
import {
    getActiveEpsOptionsAction,
    type EpsOption,
    type PadronImportResult,
    type PadronValidationSummary,
} from './actions';

const MAX_FILE_BYTES = 6_000_000;
const ALLOWED_EXTENSIONS = /\.(csv|xlsx)$/i;

const TEMPLATE_CSV = PADRON_CSV_HEADERS.join(',') + '\n1088123456,SUBSIDIADO,3001234567\n';

// ─────────────────────────────────────────────────────────────
// Validar, importar y el reporte completo de errores NO son Server Actions:
// son Route Handlers normales, llamados con fetch(). El csvText del padrón
// real del hospital pesa varios MB, y una Server Action de Next.js codifica
// sus argumentos con el "reply encoder" de React Flight, que cuenta cada
// CARÁCTER de un string dentro del arreglo de argumentos como un "slot"
// contra un límite interno de 1.000.000 — un csvText de varios MB lo revienta
// SIEMPRE, con "Error: Maximum array nesting exceeded", antes de que el
// código de la función llegue a ejecutarse (así falló en producción con el
// archivo real de Sura, 2026-09-14). Ver el comentario de cabecera de
// padron-service.ts para el detalle completo.
// ─────────────────────────────────────────────────────────────
async function postPadronJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`El servidor respondió ${res.status} al llamar ${path}.`);
    }
    return (await res.json()) as T;
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
    const [sourceFormat, setSourceFormat] = useState<'CSV' | 'XLSX' | null>(null);
    const [csvText, setCsvText] = useState<string | null>(null);
    const [epsDetection, setEpsDetection] = useState<PadronEpsDetection | null>(null);
    const [report, setReport] = useState<PadronValidationSummary | null>(null);
    const [confirmDeactivation, setConfirmDeactivation] = useState(false);
    const [importResult, setImportResult] = useState<PadronImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isValidating, startValidating] = useTransition();
    const [isImporting, startImporting] = useTransition();
    const [isDownloadingReport, startDownloadingReport] = useTransition();
    const [isReadingFile, setIsReadingFile] = useState(false);
    const [progress, setProgress] = useState<UploadProgress>(null);
    const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    useEffect(() => {
        return () => {
            if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        };
    }, []);

    // Progreso simulado para los pasos de servidor (validar/importar): son un
    // único roundtrip sin eventos intermedios, así que se anima suavemente
    // hacia el 90% mientras se espera y se cierra en 100% al responder. No es
    // un progreso real fila-a-fila (eso requeriría partir la importación en
    // varias llamadas y romper la transacción atómica del corte), pero le da
    // al usuario una señal honesta de que el proceso avanza.
    function startSimulatedProgress(label: string) {
        setProgress({ label, percent: 8 });
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        progressTimerRef.current = setInterval(() => {
            setProgress((prev) => (prev ? { label: prev.label, percent: prev.percent + (90 - prev.percent) * 0.15 } : prev));
        }, 250);
    }

    function finishSimulatedProgress() {
        if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
        }
        setProgress((prev) => (prev ? { ...prev, percent: 100 } : prev));
        setTimeout(() => setProgress(null), 400);
    }

    const busy = isValidating || isImporting || isReadingFile;
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

    /**
     * Intenta identificar la EPS del archivo (columna `eps`/`aseguradora`, o
     * si no hay, el nombre del archivo) contra las EPS activas de la clínica.
     * Solo PRE-SELECCIONA el selector cuando hay una coincidencia inequívoca
     * — la persona siempre puede revisarla y cambiarla antes de validar.
     */
    function detectEps(text: string, name: string) {
        if (!epsOptions || epsOptions.length === 0) {
            setEpsDetection(null);
            return;
        }
        const detection = detectPadronEps(text, name, epsOptions);
        setEpsDetection(detection);
        if (detection) setSelectedEpsId(detection.eps.id);
    }

    async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
        resetOutcome();
        setCsvText(null);
        setFileName(null);
        setSourceFormat(null);
        setEpsDetection(null);
        setProgress(null);

        const file = event.target.files?.[0];
        if (!file) return;

        const extensionMatch = ALLOWED_EXTENSIONS.exec(file.name);
        if (!extensionMatch) {
            setError(
                `Extensión no permitida: "${file.name}". Seleccione un archivo .csv o .xlsx (si lo tiene en otro formato, use Archivo → Guardar como → CSV UTF-8 o Excel).`,
            );
            event.target.value = '';
            return;
        }
        const extension = extensionMatch[1].toLowerCase() as 'csv' | 'xlsx';

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

        const signature = await sniffBinarySignature(file);

        setIsReadingFile(true);
        try {
            if (extension === 'csv') {
                if (signature) {
                    setError(
                        `"${file.name}" parece ser ${signature.label}, no un CSV de texto. Expórtelo como "CSV UTF-8 (delimitado por comas)", o cárguelo directamente como .xlsx.`,
                    );
                    event.target.value = '';
                    return;
                }
                setProgress({ label: 'Leyendo archivo…', percent: 0 });
                const text = (await readFileWithProgress(file, 'text', (percent) =>
                    setProgress({ label: 'Leyendo archivo…', percent }),
                )) as string;
                setFileName(file.name);
                setSourceFormat('CSV');
                setCsvText(text);
                detectEps(text, file.name);
                return;
            }

            // extension === 'xlsx'
            if (signature && signature.kind !== 'zip') {
                setError(
                    `"${file.name}" tiene extensión .xlsx pero su contenido parece ser ${signature.label}. Verifique el archivo y vuelva a intentarlo.`,
                );
                event.target.value = '';
                return;
            }

            setProgress({ label: 'Leyendo archivo…', percent: 0 });
            const buffer = (await readFileWithProgress(file, 'arraybuffer', (percent) =>
                setProgress({ label: 'Leyendo archivo…', percent: Math.round(percent * 0.6) }),
            )) as ArrayBuffer;
            setProgress({ label: 'Analizando hojas de Excel…', percent: 65 });
            const text = await xlsxToCsv(buffer);
            setProgress({ label: 'Analizando hojas de Excel…', percent: 95 });
            if (!text) {
                setError(`"${file.name}" no tiene datos en ninguna hoja.`);
                event.target.value = '';
                return;
            }
            setFileName(file.name);
            setSourceFormat('XLSX');
            setCsvText(text);
            detectEps(text, file.name);
        } catch {
            setError(
                extension === 'xlsx'
                    ? `"${file.name}" no pudo leerse como Excel (.xlsx). Verifique que no esté dañado ni protegido con contraseña, o expórtelo como CSV.`
                    : `"${file.name}" no pudo leerse. Intente de nuevo.`,
            );
            event.target.value = '';
        } finally {
            setIsReadingFile(false);
            setProgress(null);
        }
    }

    function handleDownloadErrorReport() {
        if (!csvText) return;
        startDownloadingReport(async () => {
            try {
                const result = await postPadronJson<
                    { success: true; csv: string } | { success: false; error: string }
                >('/api/padron/error-report', { csvText });
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
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Error al generar el reporte de errores.');
            }
        });
    }

    function handleValidate() {
        if (!csvText || !selectedEpsId) return;
        resetOutcome();
        startValidating(async () => {
            startSimulatedProgress('Validando archivo…');
            try {
                const result = await postPadronJson<
                    { success: true; report: PadronValidationSummary } | { success: false; error: string }
                >('/api/padron/validate', { csvText, epsId: selectedEpsId });
                if (result.success) {
                    setReport(result.report);
                } else {
                    setError(result.error);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Error al validar el archivo.');
            } finally {
                finishSimulatedProgress();
            }
        });
    }

    function handleImport() {
        if (!csvText || !report?.ok || !selectedEpsId) return;
        setError(null);
        startImporting(async () => {
            startSimulatedProgress('Importando corte…');
            try {
                const result = await postPadronJson<PadronImportResult>('/api/padron/import', {
                    csvText,
                    epsId: selectedEpsId,
                    fileName: fileName ?? 'padron.csv',
                    confirmDeactivation,
                });
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
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Error al importar el padrón.');
            } finally {
                finishSimulatedProgress();
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
                        Importar corte del padrón desde CSV o Excel
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        El analizador identifica solo, entre las columnas que traiga el archivo, la que use para{' '}
                        <strong>cedula</strong> (obligatoria) y, si vienen, <strong>regimen</strong> y{' '}
                        <strong>telefono</strong>. Puede tener más columnas o filas de título antes del encabezado:
                        se ignoran. La EPS se elige aquí abajo, no en el archivo.
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
                {epsDetection && (
                    <p className="flex items-center gap-1.5 text-xs text-teal-700 dark:text-teal-400">
                        <Sparkles className="h-3.5 w-3.5 shrink-0" />
                        EPS detectada automáticamente por {epsDetection.source}:{' '}
                        <strong>{epsDetection.eps.name}</strong>. Verifique que sea correcta antes de continuar.
                    </p>
                )}
            </div>

            {/* Selector de archivo */}
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 px-6 py-8 text-center transition-colors hover:border-teal-400 hover:bg-teal-50/50 dark:hover:bg-teal-900/10">
                <Upload className="h-8 w-8 text-zinc-400" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    {fileName ? (
                        <>
                            {fileName}
                            {sourceFormat && (
                                <span className="ml-2 inline-block rounded-full bg-zinc-200 dark:bg-zinc-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                                    {sourceFormat}
                                </span>
                            )}
                        </>
                    ) : (
                        'Haga clic para seleccionar el archivo .csv o .xlsx del padrón'
                    )}
                </span>
                <span className="text-xs text-zinc-400">
                    Máximo 6 MB — CSV (UTF-8, coma o punto y coma) o Excel (.xlsx)
                </span>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFileChange}
                    className="hidden"
                />
            </label>

            {progress && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{progress.label}</span>
                        <span>{Math.round(progress.percent)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                            className="h-full rounded-full bg-teal-500 transition-[width] duration-200 ease-out"
                            style={{ width: `${progress.percent}%` }}
                        />
                    </div>
                </div>
            )}

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
                        {!!importResult.duplicatesIgnored && (
                            <p className="text-xs opacity-80">
                                <strong>{importResult.duplicatesIgnored}</strong> línea(s) con cédula duplicada en el
                                archivo se ignoraron (solo se importó la primera aparición de cada una).
                            </p>
                        )}
                        {importResult.importId && (
                            <Link
                                href={`/dashboard/padron/historial/${importResult.importId}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
                            >
                                Ver detalle completo de esta carga en el log →
                            </Link>
                        )}
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
                                {report.validCount} afiliado(s) listo(s) para importar
                                {report.warningCount > 0
                                    ? ` (${report.warningCount} línea(s) duplicada(s) se van a ignorar, vea abajo).`
                                    : '.'}
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

                    {report.ignoredPreambleLines > 0 && (
                        <p className="flex items-start gap-1.5 text-xs opacity-80">
                            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            Se ignoraron {report.ignoredPreambleLines} línea(s) antes del encabezado real (título,
                            filas en blanco, etc.).
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

                    {report.warningCount > 0 && (
                        <div className="rounded-lg bg-white/70 dark:bg-zinc-900/40 p-3 space-y-2">
                            <p className="flex items-start gap-2 font-medium text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                {report.warningCount} línea(s) con cédula duplicada en el archivo. No bloquean la
                                importación: solo se va a usar la primera aparición de cada cédula, el resto se
                                ignora. Si importa, quedan ignoradas así — usted decide.
                            </p>
                            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-white/60 dark:bg-zinc-900/40 p-3 text-xs">
                                {report.warnings.map((warn, idx) => (
                                    <li key={idx}>
                                        <strong>Línea {warn.line}</strong>
                                        {warn.column ? ` · ${warn.column}` : ''}: {warn.message}
                                    </li>
                                ))}
                                {report.warningCount > report.warnings.length && (
                                    <li className="italic">
                                        … y {report.warningCount - report.warnings.length} advertencia(s) más.
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}

                    {(report.errorCount > 0 || report.warningCount > 0) && (
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
                            Descargar reporte completo ({report.errorCount} error(es), {report.warningCount}{' '}
                            advertencia(s))
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { formatAppointmentLong } from '@/lib/date';
import { readFileWithProgress, sniffBinarySignature, xlsxToCsv } from '@/lib/spreadsheet-upload';
import {
    validateAvisosFileAction,
    loadAvisosFileAction,
    getBatchAction,
    listBatchesAction,
    toggleRecipientSelectionAction,
    updateBatchNotaAdicionalAction,
    sendBatchAction,
    updateAvisosConfigAction,
    type AvisosValidationSummary,
    type AvisosBatchView,
} from '@/app/actions/avisos';
import RecipientsTable from './RecipientsTable';
import BatchHistory from './BatchHistory';

const ALLOWED_EXTENSIONS = /\.(csv|xlsx)$/i;
const MAX_FILE_BYTES = 2_000_000;
const DEFAULT_NOTA = 'Le ofrecemos disculpas por el inconveniente.';
const MAX_NOTA_CHARS = 150;

type AvisosMasivosConfig = {
    enabled?: boolean;
    ritmoMensajesPorMinuto?: number;
    maxDestinatariosPorLote?: number;
};

export default function AvisosClient({
    isOrgAdmin,
    conAvisos,
    initialConfig,
    initialBatches,
}: {
    isOrgAdmin: boolean;
    conAvisos: boolean;
    initialConfig: AvisosMasivosConfig | null;
    initialBatches: AvisosBatchView[];
}) {
    const [configOpen, setConfigOpen] = useState(!conAvisos);
    const [config, setConfig] = useState<AvisosMasivosConfig | null>(initialConfig);
    const [configForm, setConfigForm] = useState({
        enabled: initialConfig?.enabled ?? false,
        ritmoMensajesPorMinuto: initialConfig?.ritmoMensajesPorMinuto ?? 30,
        maxDestinatariosPorLote: initialConfig?.maxDestinatariosPorLote ?? 300,
    });
    const [configSaving, startConfigSaving] = useTransition();
    const [configAviso, setConfigAviso] = useState<string | null>(null);

    const [batches, setBatches] = useState<AvisosBatchView[]>(initialBatches);
    const [batch, setBatch] = useState<AvisosBatchView | null>(null);

    // ── Paso 1: archivo ──
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [csvText, setCsvText] = useState<string | null>(null);
    const [doctorLabel, setDoctorLabel] = useState('');
    const [serviceLabel, setServiceLabel] = useState('');
    const [report, setReport] = useState<AvisosValidationSummary | null>(null);
    const [isReadingFile, setIsReadingFile] = useState(false);
    const [isValidating, startValidating] = useTransition();
    const [isLoading, startLoadingBatch] = useTransition();
    const [error, setError] = useState<string | null>(null);

    // ── Paso 2/3 ──
    const [notaAdicional, setNotaAdicional] = useState('');
    const [confirmText, setConfirmText] = useState('');
    const [isSending, startSending] = useTransition();
    const [sendResult, setSendResult] = useState<string | null>(null);

    const busy = isReadingFile || isValidating || isLoading || isSending;

    async function refreshBatches() {
        const res = await listBatchesAction();
        if (res.success) setBatches(res.batches);
    }

    async function openBatch(batchId: string) {
        setError(null);
        const res = await getBatchAction(batchId);
        if (!res.success) {
            setError(res.error);
            return;
        }
        setBatch(res.batch);
        setNotaAdicional(res.batch.notaAdicional ?? '');
        setSendResult(null);
        setConfirmText('');
    }

    function resetPaso1() {
        setFileName(null);
        setCsvText(null);
        setReport(null);
        setError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function startNewBatch() {
        setBatch(null);
        setDoctorLabel('');
        setServiceLabel('');
        resetPaso1();
    }

    async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
        setError(null);
        setReport(null);
        const file = event.target.files?.[0];
        if (!file) return;

        const extensionMatch = ALLOWED_EXTENSIONS.exec(file.name);
        if (!extensionMatch) {
            setError('Formato no soportado — suba un archivo .csv o .xlsx.');
            event.target.value = '';
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            setError('El archivo es demasiado grande para un aviso de este tipo (pocas citas, pocos mensajes).');
            event.target.value = '';
            return;
        }

        const extension = extensionMatch[1].toLowerCase();
        const signature = await sniffBinarySignature(file);

        setIsReadingFile(true);
        try {
            if (extension === 'csv') {
                if (signature) {
                    setError(
                        `"${file.name}" parece ser ${signature.label}, no un CSV de texto. Expórtelo como "CSV UTF-8", o cárguelo directamente como .xlsx.`,
                    );
                    event.target.value = '';
                    return;
                }
                const text = (await readFileWithProgress(file, 'text', () => {})) as string;
                setFileName(file.name);
                setCsvText(text);
                return;
            }

            if (signature && signature.kind !== 'zip') {
                setError(
                    `"${file.name}" tiene extensión .xlsx pero su contenido parece ser ${signature.label}.`,
                );
                event.target.value = '';
                return;
            }
            const buffer = (await readFileWithProgress(file, 'arraybuffer', () => {})) as ArrayBuffer;
            const text = await xlsxToCsv(buffer);
            if (!text) {
                setError(`"${file.name}" no tiene datos en ninguna hoja.`);
                event.target.value = '';
                return;
            }
            setFileName(file.name);
            setCsvText(text);
        } catch {
            setError(`"${file.name}" no pudo leerse. Verifique que no esté dañado y vuelva a intentarlo.`);
            event.target.value = '';
        } finally {
            setIsReadingFile(false);
        }
    }

    function handleValidate() {
        if (!csvText) return;
        setError(null);
        startValidating(async () => {
            const res = await validateAvisosFileAction(csvText);
            if (!res.success) {
                setError(res.error);
                return;
            }
            setReport(res.report);
        });
    }

    function handleCargar() {
        if (!csvText || !report?.ok) return;
        setError(null);
        startLoadingBatch(async () => {
            const res = await loadAvisosFileAction({
                batchId: batch?.id,
                doctorLabel,
                serviceLabel,
                csvText,
            });
            if (!res.success || !res.batchId) {
                setError(res.error ?? 'No se pudo cargar la información.');
                return;
            }
            await openBatch(res.batchId);
            await refreshBatches();
            resetPaso1();
        });
    }

    function handleToggle(recipientId: string, selected: boolean) {
        if (!batch) return;
        // Optimista: la pantalla no debe esperar el roundtrip para sentirse responsiva.
        setBatch({
            ...batch,
            recipients: batch.recipients.map((r) => (r.id === recipientId ? { ...r, selected } : r)),
        });
        toggleRecipientSelectionAction(recipientId, selected).then((res) => {
            if (!res.success) {
                setError(res.error ?? 'No se pudo actualizar la selección.');
                openBatch(batch.id);
            }
        });
    }

    function handleNotaBlur() {
        if (!batch) return;
        if (notaAdicional.length > MAX_NOTA_CHARS) return;
        updateBatchNotaAdicionalAction(batch.id, notaAdicional).then((res) => {
            if (!res.success) setError(res.error ?? 'No se pudo guardar la nota.');
        });
    }

    const seleccionados = batch?.recipients.filter((r) => r.selected && r.hasValidPhone) ?? [];
    const previewRecipient = seleccionados[0];
    const preview = useMemo(() => {
        if (!batch || !previewRecipient) return null;
        const nombre = previewRecipient.patientName?.split(' ')[0] ?? 'Paciente';
        const servicio = batch.serviceLabel ?? 'su consulta';
        const medico = batch.doctorLabel ?? 'su médico';
        const fecha = formatAppointmentLong(previewRecipient.appointmentAtUtc);
        const nota = notaAdicional.trim() || DEFAULT_NOTA;
        return (
            `Hola ${nombre}. Le escribimos respecto a su cita de ${servicio} con ${medico}, ` +
            `programada para el ${fecha}: fue cancelada. ${nota} Nos comunicaremos con usted para ` +
            `reprogramarla, o puede escribirnos por este mismo medio.`
        );
    }, [batch, previewRecipient, notaAdicional]);

    function handleSend() {
        if (!batch) return;
        setSendResult(null);
        startSending(async () => {
            const res = await sendBatchAction(batch.id);
            if (!res.success) {
                setError(res.error ?? 'No se pudo enviar el lote.');
                return;
            }
            setSendResult(
                `Enviado: ${res.sent} mensaje(s), ${res.failed} fallido(s), ${res.skipped} omitido(s).`,
            );
            await openBatch(batch.id);
            await refreshBatches();
        });
    }

    function handleSaveConfig() {
        setConfigAviso(null);
        startConfigSaving(async () => {
            const res = await updateAvisosConfigAction(configForm);
            if (!res.success) {
                setConfigAviso(res.error ?? 'No se pudo guardar.');
                return;
            }
            setConfig(configForm);
            setConfigAviso(
                configForm.enabled
                    ? 'Guardado. La función queda encendida para esta clínica.'
                    : 'Guardado. La función queda apagada — nadie más la verá en el menú.',
            );
        });
    }

    const featureOn = config?.enabled ?? conAvisos;

    return (
        <div className="space-y-8">
            <header className="space-y-2">
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                    📣 Avisos de cancelación
                </h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-3xl">
                    Para cuando un especialista no puede asistir a la sesión programada. Se envía{' '}
                    <strong>persona por persona</strong>, no es una campaña masiva — úselo para el puñado
                    de pacientes de un día de agenda. El mensaje sigue siendo pasivo: informa, pero la
                    cita en sí se cancela por el proceso de siempre del hospital.
                </p>
            </header>

            {isOrgAdmin && (
                <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <button
                        onClick={() => setConfigOpen((v) => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-900/60 text-sm font-semibold text-zinc-700 dark:text-zinc-300"
                    >
                        <span>⚙️ Configuración</span>
                        <span className="text-xs font-normal text-zinc-500">
                            {featureOn ? 'Encendida' : 'Apagada'} {configOpen ? '▲' : '▼'}
                        </span>
                    </button>
                    {configOpen && (
                        <div className="p-4 space-y-4">
                            <label className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                <input
                                    type="checkbox"
                                    checked={configForm.enabled}
                                    onChange={(e) =>
                                        setConfigForm((f) => ({ ...f, enabled: e.target.checked }))
                                    }
                                    className="h-4 w-4 rounded border-zinc-300 text-rose-600 focus:ring-rose-500"
                                />
                                Habilitar avisos de cancelación para esta clínica
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <label className="text-sm text-zinc-700 dark:text-zinc-300">
                                    Ritmo de envío (mensajes/minuto)
                                    <input
                                        type="number"
                                        min={1}
                                        max={120}
                                        value={configForm.ritmoMensajesPorMinuto}
                                        onChange={(e) =>
                                            setConfigForm((f) => ({
                                                ...f,
                                                ritmoMensajesPorMinuto: Number(e.target.value) || 30,
                                            }))
                                        }
                                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                                    />
                                </label>
                                <label className="text-sm text-zinc-700 dark:text-zinc-300">
                                    Máximo de destinatarios por lote
                                    <input
                                        type="number"
                                        min={1}
                                        max={2000}
                                        value={configForm.maxDestinatariosPorLote}
                                        onChange={(e) =>
                                            setConfigForm((f) => ({
                                                ...f,
                                                maxDestinatariosPorLote: Number(e.target.value) || 300,
                                            }))
                                        }
                                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                                    />
                                </label>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleSaveConfig}
                                    disabled={configSaving}
                                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                >
                                    Guardar configuración
                                </button>
                                {configAviso && (
                                    <span className="text-sm text-zinc-600 dark:text-zinc-400">{configAviso}</span>
                                )}
                            </div>
                        </div>
                    )}
                </section>
            )}

            {!featureOn && !isOrgAdmin && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Esta función todavía no está activada para su clínica. Pídale a un administrador que
                    la encienda en Configuración.
                </p>
            )}

            {featureOn && (
                <>
                    {error && (
                        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                            {error}
                        </div>
                    )}

                    {!batch && (
                        <section className="space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                Paso 1 · Armar la lista
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <label className="text-sm text-zinc-700 dark:text-zinc-300">
                                    Médico / motivo del aviso *
                                    <input
                                        type="text"
                                        value={doctorLabel}
                                        onChange={(e) => setDoctorLabel(e.target.value)}
                                        placeholder="Ej. Dr. Carlos Serna — Medicina Interna"
                                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                                    />
                                </label>
                                <label className="text-sm text-zinc-700 dark:text-zinc-300">
                                    Servicio (opcional, aparece en el mensaje)
                                    <input
                                        type="text"
                                        value={serviceLabel}
                                        onChange={(e) => setServiceLabel(e.target.value)}
                                        placeholder="Ej. Medicina Interna"
                                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                                    />
                                </label>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv,.xlsx"
                                    onChange={handleFileChange}
                                    disabled={busy}
                                    className="text-sm text-zinc-600 dark:text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 dark:file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:font-medium disabled:opacity-50"
                                />
                                {fileName && <span className="text-xs text-zinc-500">{fileName}</span>}
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    onClick={handleValidate}
                                    disabled={!csvText || busy}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    1. Validar archivo
                                </button>
                                <button
                                    onClick={handleCargar}
                                    disabled={!report?.ok || busy}
                                    title={!report?.ok ? 'Primero valide el archivo sin errores' : undefined}
                                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    2. Cargar información
                                </button>
                            </div>

                            {report && (
                                <div
                                    className={`rounded-lg border p-4 text-sm ${
                                        report.ok
                                            ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                                            : 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
                                    }`}
                                >
                                    <p className="font-semibold">
                                        {report.validCount} de {report.totalDataRows} fila(s) válidas
                                        {report.errorCount > 0 && ` · ${report.errorCount} con error`}
                                        {report.yaAvisadasPrevio > 0 &&
                                            ` · ${report.yaAvisadasPrevio} ya tienen un aviso previo`}
                                    </p>
                                    {report.errors.length > 0 && (
                                        <ul className="mt-2 space-y-1 text-xs">
                                            {report.errors.map((e, i) => (
                                                <li key={i}>
                                                    Línea {e.line}
                                                    {e.column ? ` (${e.column})` : ''}: {e.message}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </section>
                    )}

                    {batch && (
                        <section className="space-y-5 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                        {batch.doctorLabel}
                                        {batch.serviceLabel && (
                                            <span className="text-zinc-500 font-normal"> · {batch.serviceLabel}</span>
                                        )}
                                    </h2>
                                    <p className="text-xs text-zinc-500">
                                        Estado: {batch.status} · {batch.candidates} candidatos
                                    </p>
                                </div>
                                {batch.status === 'BORRADOR' && (
                                    <button
                                        onClick={startNewBatch}
                                        className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    >
                                        ← Armar otro aviso
                                    </button>
                                )}
                            </div>

                            {batch.status === 'BORRADOR' && (
                                <p className="text-xs text-zinc-500">
                                    ¿Falta alguien o hay que corregir el archivo? Vuelva al Paso 1 con el
                                    archivo corregido y presione &quot;Cargar información&quot; de nuevo —
                                    reemplaza la lista, se puede repetir cuantas veces haga falta.
                                </p>
                            )}

                            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                Paso 2 · Escoger y revisar
                            </h3>
                            <RecipientsTable
                                recipients={batch.recipients}
                                onToggle={handleToggle}
                                disabled={busy || batch.status !== 'BORRADOR'}
                            />

                            {batch.status === 'BORRADOR' && (
                                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                                    Nota adicional (opcional) — se agrega a la redacción del mensaje
                                    <textarea
                                        value={notaAdicional}
                                        onChange={(e) => setNotaAdicional(e.target.value)}
                                        onBlur={handleNotaBlur}
                                        maxLength={MAX_NOTA_CHARS}
                                        rows={2}
                                        placeholder={DEFAULT_NOTA}
                                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                                    />
                                    <span className="text-xs text-zinc-400">
                                        {notaAdicional.length}/{MAX_NOTA_CHARS}
                                    </span>
                                </label>
                            )}

                            {preview && (
                                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 p-4">
                                    <p className="text-xs font-semibold text-zinc-500 mb-1">
                                        Vista previa (con {previewRecipient?.patientName ?? 'el primer seleccionado'})
                                    </p>
                                    <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                                        {preview}
                                    </p>
                                </div>
                            )}

                            {batch.status === 'BORRADOR' && (
                                <div className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                                    <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                        Paso 3 · Enviar
                                    </h3>
                                    {seleccionados.length === 0 ? (
                                        <p className="text-sm text-zinc-500">
                                            Seleccione al menos un paciente con celular válido.
                                        </p>
                                    ) : (
                                        <>
                                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                                Va a escribirle a <strong>{seleccionados.length}</strong> paciente(s).
                                                Esto no se puede deshacer: WhatsApp no borra mensajes entregados.
                                                Escriba <strong>{seleccionados.length}</strong> para confirmar.
                                            </p>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <input
                                                    type="text"
                                                    value={confirmText}
                                                    onChange={(e) => setConfirmText(e.target.value)}
                                                    className="w-24 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                                                    placeholder={String(seleccionados.length)}
                                                />
                                                <button
                                                    onClick={handleSend}
                                                    disabled={
                                                        busy || confirmText.trim() !== String(seleccionados.length)
                                                    }
                                                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {isSending ? 'Enviando…' : `Enviar a ${seleccionados.length} paciente(s)`}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {sendResult && (
                                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                                    {sendResult}
                                </div>
                            )}

                            {(batch.status === 'ENVIANDO' || batch.status === 'ENVIADO') && (
                                <div className="flex gap-4 text-sm">
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                        ✓ {batch.sent} enviados
                                    </span>
                                    {batch.failed > 0 && (
                                        <span className="text-rose-600 dark:text-rose-400">
                                            ✕ {batch.failed} fallidos
                                        </span>
                                    )}
                                    {batch.skipped > 0 && (
                                        <span className="text-zinc-500">– {batch.skipped} omitidos</span>
                                    )}
                                </div>
                            )}
                        </section>
                    )}

                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                Historial
                            </h2>
                            {batch && (
                                <button
                                    onClick={() => setBatch(null)}
                                    className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                >
                                    Ver historial completo
                                </button>
                            )}
                        </div>
                        {!batch && <BatchHistory batches={batches} onOpen={openBatch} />}
                    </section>
                </>
            )}
        </div>
    );
}

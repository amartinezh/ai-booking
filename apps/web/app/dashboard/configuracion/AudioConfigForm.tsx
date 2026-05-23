'use client';

import { useMemo, useState, useTransition } from 'react';
import {
    AudioLines,
    AudioWaveform,
    CheckCircle2,
    Gauge,
    Loader2,
    Mic,
    Music4,
    AlertTriangle,
    RotateCcw,
} from 'lucide-react';
import { updateMyAudioConfig, diagnoseAudio } from '@/app/actions/audio-config';
import type {
    AudioDiagnosisResult,
    AudioEncoding,
    PublicAudioConfig,
    SaveAudioConfigInput,
    VoiceOption,
} from '@/app/actions/audio-config.types';

type Props = {
    initial: PublicAudioConfig;
};

const ENCODING_OPTIONS: { value: AudioEncoding; label: string; hint: string }[] = [
    { value: 'OGG_OPUS', label: 'OGG Opus', hint: 'Requerido por WhatsApp (recomendado)' },
    { value: 'MP3', label: 'MP3', hint: 'Reproductor web / portabilidad' },
    { value: 'LINEAR16', label: 'WAV (LINEAR16)', hint: 'Sin compresión / telefonía' },
];

export default function AudioConfigForm({ initial }: Props) {
    const { pitchMin, pitchMax, rateMin, rateMax } = initial.limits;

    const [voiceId, setVoiceId] = useState(initial.voiceId);
    const [pitch, setPitch] = useState(initial.pitch);
    const [speakingRate, setSpeakingRate] = useState(initial.speakingRate);
    const [audioEncoding, setAudioEncoding] = useState<AudioEncoding>(
        initial.audioEncoding,
    );

    const [isSaving, startSaving] = useTransition();
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [aliveLoading, setAliveLoading] = useState(false);
    const [aliveResult, setAliveResult] = useState<AudioDiagnosisResult | null>(
        null,
    );

    // Agrupa las voces por familia tecnológica para un dropdown ordenado.
    const groupedVoices = useMemo(() => {
        const groups: Record<string, VoiceOption[]> = {};
        for (const v of initial.allowedVoices) {
            (groups[v.category] ??= []).push(v);
        }
        return groups;
    }, [initial.allowedVoices]);

    const resetDefaults = () => {
        setPitch(0);
        setSpeakingRate(1);
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaved(false);
        setError(null);

        const payload: SaveAudioConfigInput = {
            voiceId,
            pitch: clampNumber(pitch, pitchMin, pitchMax),
            speakingRate: clampNumber(speakingRate, rateMin, rateMax),
            audioEncoding,
        };

        startSaving(async () => {
            const res = await updateMyAudioConfig(payload);
            if (res.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 4000);
            } else {
                setError(res.error);
            }
        });
    };

    const runAlive = async () => {
        setAliveLoading(true);
        setAliveResult(null);
        try {
            setAliveResult(await diagnoseAudio());
        } catch (e: any) {
            setAliveResult({
                success: false,
                error_code: 'UNKNOWN',
                error_message: e?.message ?? 'Error inesperado en el cliente.',
            });
        } finally {
            setAliveLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-8">
            {/* ── Header ───────────────────────────────────── */}
            <section>
                <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-violet-100 dark:bg-violet-900/30 p-2.5 text-violet-600 dark:text-violet-400">
                        <AudioLines className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                            Configuración de Voz y Audio de la Clínica
                        </h2>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                            Personalice la voz con la que AgenIA responde por nota de voz en
                            WhatsApp. Estos parámetros se aplican{' '}
                            <strong>únicamente a su clínica</strong> y se inyectan en cada
                            síntesis de audio. Valide el servicio antes de guardar para
                            confirmar que el proveedor acepta la combinación elegida.
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Voz + Códec (Cards) ──────────────────────── */}
            <section className="grid gap-4 md:grid-cols-2">
                {/* Voz */}
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-3">
                    <label className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                        <Mic className="w-4 h-4 text-violet-500" />
                        Voz del asistente
                    </label>
                    <select
                        value={voiceId}
                        onChange={e => setVoiceId(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none transition-all dark:text-white"
                    >
                        {Object.entries(groupedVoices).map(([category, voices]) => (
                            <optgroup key={category} label={category}>
                                {voices.map(v => (
                                    <option key={v.id} value={v.id}>
                                        {v.label}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Neural2 y WaveNet ofrecen distintas texturas; Studio es más
                        expresiva. Todas en español (es-US).
                    </p>
                </div>

                {/* Códec */}
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-3">
                    <label className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                        <Music4 className="w-4 h-4 text-violet-500" />
                        Códec de salida
                    </label>
                    <select
                        value={audioEncoding}
                        onChange={e => setAudioEncoding(e.target.value as AudioEncoding)}
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none transition-all dark:text-white"
                    >
                        {ENCODING_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {ENCODING_OPTIONS.find(o => o.value === audioEncoding)?.hint}
                    </p>
                </div>
            </section>

            {/* ── Sliders Pitch + Rate ─────────────────────── */}
            <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                        <AudioWaveform className="w-4 h-4 text-violet-500" />
                        Ajuste fino de la voz
                    </h3>
                    <button
                        type="button"
                        onClick={resetDefaults}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restaurar neutro
                    </button>
                </div>

                <SliderControl
                    label="Tono (Pitch)"
                    icon={<AudioWaveform className="w-3.5 h-3.5" />}
                    value={pitch}
                    setValue={setPitch}
                    min={pitchMin}
                    max={pitchMax}
                    step={0.1}
                    unit="semitonos"
                    minLabel={`${pitchMin}`}
                    maxLabel={`+${pitchMax}`}
                />

                <SliderControl
                    label="Velocidad (Rate)"
                    icon={<Gauge className="w-3.5 h-3.5" />}
                    value={speakingRate}
                    setValue={setSpeakingRate}
                    min={rateMin}
                    max={rateMax}
                    step={0.05}
                    unit="x"
                    minLabel={`${rateMin}x`}
                    maxLabel={`${rateMax}x`}
                />
            </section>

            {/* ── Botón Alive + resultado ──────────────────── */}
            <section className="space-y-4">
                <button
                    type="button"
                    onClick={runAlive}
                    disabled={aliveLoading}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {aliveLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <AudioLines className="w-4 h-4" />
                    )}
                    {aliveLoading
                        ? 'Validando con Google TTS…'
                        : 'Validar Servicio Alive (Audio)'}
                </button>

                <AliveResultCard loading={aliveLoading} result={aliveResult} />
            </section>

            {/* ── Error guardado ───────────────────────────── */}
            {error && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    ❌ {error}
                </div>
            )}

            {/* ── Footer ───────────────────────────────────── */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 flex justify-end">
                <button
                    type="submit"
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                    {isSaving ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Guardando...
                        </>
                    ) : saved ? (
                        <>
                            <span>✅</span> Configuración de audio guardada
                        </>
                    ) : (
                        <>
                            <span>💾</span> Guardar configuración de audio
                        </>
                    )}
                </button>
            </div>
        </form>
    );
}

// ─────────────────────────────────────────────────────────────
// Slider + input numérico sincronizados, con etiquetas de rango.
// ─────────────────────────────────────────────────────────────
function SliderControl({
    label,
    icon,
    value,
    setValue,
    min,
    max,
    step,
    unit,
    minLabel,
    maxLabel,
}: {
    label: string;
    icon: React.ReactNode;
    value: number;
    setValue: (n: number) => void;
    min: number;
    max: number;
    step: number;
    unit: string;
    minLabel: string;
    maxLabel: string;
}) {
    const onNumber = (raw: string) => {
        const n = parseFloat(raw);
        if (Number.isNaN(n)) return;
        setValue(clampNumber(n, min, max));
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    {icon}
                    {label}
                </label>
                <div className="flex items-center gap-1.5">
                    <input
                        type="number"
                        value={value}
                        min={min}
                        max={max}
                        step={step}
                        onChange={e => onNumber(e.target.value)}
                        className="w-20 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-mono text-right focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none dark:text-white"
                    />
                    <span className="text-xs text-zinc-400 w-14">{unit}</span>
                </div>
            </div>
            <input
                type="range"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={e => setValue(parseFloat(e.target.value))}
                className="w-full accent-violet-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-zinc-400 mt-1">
                <span>{minLabel}</span>
                <span>{maxLabel}</span>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Tarjeta de resultado del botón Alive (Verde / Rojo).
// ─────────────────────────────────────────────────────────────
function AliveResultCard({
    loading,
    result,
}: {
    loading: boolean;
    result: AudioDiagnosisResult | null;
}) {
    if (loading) {
        return (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Sintetizando audio de prueba…
            </div>
        );
    }
    if (!result) return null;

    if (result.success) {
        return (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 p-4">
                <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                        🟢 Servicio de Audio Alive
                    </h3>
                </div>
                <dl className="space-y-2 text-xs">
                    <Row label="Latencia (RTT)" value={`${result.rtt_ms} ms`} />
                    <Row label="Voz validada" value={result.voiceId} />
                    <Row label="Audio generado" value={`${result.audio_bytes} bytes`} />
                </dl>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 p-4">
            <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                <h3 className="text-sm font-bold text-rose-800 dark:text-rose-200">
                    🔴 Servicio de Audio Caído: {result.error_code}
                </h3>
            </div>
            {typeof result.rtt_ms === 'number' && (
                <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mb-2 flex items-center gap-1">
                    <Gauge className="w-3 h-3" /> Falló tras {result.rtt_ms} ms
                </p>
            )}
            <pre className="rounded-xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-zinc-950 px-3 py-2 text-[11px] font-mono text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-words max-h-40 overflow-auto">
                {result.error_message}
            </pre>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <dt className="text-emerald-700/80 dark:text-emerald-300/80">{label}</dt>
            <dd className="font-mono font-semibold text-emerald-900 dark:text-emerald-100 break-all text-right">
                {value}
            </dd>
        </div>
    );
}

// Clamp puro reutilizado por el slider y el submit.
function clampNumber(n: number, min: number, max: number): number {
    return Math.min(Math.max(n, min), max);
}

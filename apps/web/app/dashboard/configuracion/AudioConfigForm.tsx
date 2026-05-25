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
    KeyRound,
    Sparkles,
    Cloud,
    Mars,
    Venus,
} from 'lucide-react';
import { updateMyAudioConfig, diagnoseAudio } from '@/app/actions/audio-config';
import type {
    AudioDiagnosisResult,
    AudioEncoding,
    PublicAudioConfig,
    SaveAudioConfigInput,
    VoiceGender,
    VoiceOption,
    VoiceProvider,
} from '@/app/actions/audio-config.types';

type Props = {
    initial: PublicAudioConfig;
    /** Nombre del asistente (se edita arriba en Identidad); aquí se muestra en el header. */
    assistantName: string;
};

const ENCODING_OPTIONS: { value: AudioEncoding; label: string; hint: string }[] = [
    { value: 'OGG_OPUS', label: 'OGG Opus', hint: 'Requerido por WhatsApp (recomendado)' },
    { value: 'MP3', label: 'MP3', hint: 'Reproductor web / portabilidad' },
    { value: 'LINEAR16', label: 'WAV (LINEAR16)', hint: 'Sin compresión / telefonía' },
];

export default function AudioConfigForm({ initial, assistantName }: Props) {
    const { pitchMin, pitchMax, rateMin, rateMax } = initial.limits;
    const presets = initial.elevenLabsVoicePresets;

    // ── Estado compartido ──────────────────────────────
    const [activeProvider, setActiveProvider] = useState<VoiceProvider>(initial.activeProvider);
    const [gender, setGender] = useState<VoiceGender>(initial.gender);

    // ── Google ─────────────────────────────────────────
    const [googleVoiceId, setGoogleVoiceId] = useState(initial.googleVoiceId);
    const [googlePitch, setGooglePitch] = useState(initial.googlePitch);
    const [googleSpeakingRate, setGoogleSpeakingRate] = useState(initial.googleSpeakingRate);
    const [audioEncoding, setAudioEncoding] = useState<AudioEncoding>(initial.audioEncoding);

    // ── ElevenLabs ─────────────────────────────────────
    const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(
        initial.elevenLabsVoiceId ?? presets[initial.gender],
    );
    const [elevenLabsApiKey, setElevenLabsApiKey] = useState(''); // write-only
    const [hasKey, setHasKey] = useState(initial.hasElevenLabsApiKey);

    const [isSaving, startSaving] = useTransition();
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [aliveLoading, setAliveLoading] = useState(false);
    const [aliveResult, setAliveResult] = useState<AudioDiagnosisResult | null>(null);

    const groupedVoices = useMemo(() => {
        const groups: Record<string, VoiceOption[]> = {};
        for (const v of initial.allowedVoices) {
            (groups[v.category] ??= []).push(v);
        }
        return groups;
    }, [initial.allowedVoices]);

    // Lógica PoC: al cambiar el género hardcodeamos el Voice ID de ElevenLabs a
    // la voz sugerida (masculina/femenina). El input sigue siendo editable luego.
    const handleGenderChange = (g: VoiceGender) => {
        setGender(g);
        setElevenLabsVoiceId(presets[g]);
    };

    const resetGoogleDefaults = () => {
        setGooglePitch(0);
        setGoogleSpeakingRate(1);
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaved(false);
        setError(null);

        const payload: SaveAudioConfigInput = {
            activeProvider,
            gender,
            audioEncoding,
            googleVoiceId,
            googlePitch: clampNumber(googlePitch, pitchMin, pitchMax),
            googleSpeakingRate: clampNumber(googleSpeakingRate, rateMin, rateMax),
            elevenLabsVoiceId: elevenLabsVoiceId.trim() || null,
        };
        // La API key solo se envía si el admin escribió una nueva (write-only).
        const typedKey = elevenLabsApiKey.trim();
        if (typedKey) payload.elevenLabsApiKey = typedKey;

        startSaving(async () => {
            const res = await updateMyAudioConfig(payload);
            if (res.success) {
                setSaved(true);
                if (typedKey) {
                    setHasKey(true);
                    setElevenLabsApiKey('');
                }
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
            {/* ── Header: nombre del asistente + género ───────────────── */}
            <section className="rounded-2xl border border-violet-200/70 dark:border-violet-900/50 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-zinc-950 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-violet-600 p-2.5 text-white shadow-sm">
                            <AudioLines className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400">
                                Voz del asistente
                            </p>
                            <h2 className="text-lg font-bold text-zinc-900 dark:text-white leading-tight">
                                {assistantName || 'Vicente'}
                            </h2>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                El nombre se edita en <em>Identidad del asistente</em>. Aquí define cómo
                                <strong> suena</strong> en las notas de voz de WhatsApp.
                            </p>
                        </div>
                    </div>

                    {/* Selector de género */}
                    <div className="shrink-0">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                            Género de la voz
                        </label>
                        <div className="inline-flex rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-1">
                            <GenderPill
                                label="Masculino"
                                Icon={Mars}
                                active={gender === 'MASCULINO'}
                                onClick={() => handleGenderChange('MASCULINO')}
                            />
                            <GenderPill
                                label="Femenino"
                                Icon={Venus}
                                active={gender === 'FEMENINO'}
                                onClick={() => handleGenderChange('FEMENINO')}
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Selector de proveedor (branching) ───────────────────── */}
            <section className="space-y-3">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Proveedor de voz activo</h3>
                <div className="grid gap-4 md:grid-cols-2">
                    <ProviderCard
                        label="ElevenLabs"
                        tag="Studio Quality"
                        description="Voz neuronal premium, muy natural. Requiere API key de la clínica."
                        Icon={Sparkles}
                        active={activeProvider === 'ELEVENLABS'}
                        onClick={() => setActiveProvider('ELEVENLABS')}
                    />
                    <ProviderCard
                        label="Google Cloud TTS"
                        tag="Plan B"
                        description="Siempre disponible. Fallback automático si ElevenLabs falla."
                        Icon={Cloud}
                        active={activeProvider === 'GOOGLE'}
                        onClick={() => setActiveProvider('GOOGLE')}
                    />
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-violet-500" />
                    Si ElevenLabs está activo y falla (sin cuota, plan o timeout), el bot usa Google automáticamente.
                </p>
            </section>

            {/* ── Panel ElevenLabs ────────────────────────────────────── */}
            {activeProvider === 'ELEVENLABS' && (
                <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-5">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-violet-500" />
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                            Configuración ElevenLabs (Studio Quality)
                        </h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        {/* Voice ID */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                                <Mic className="w-4 h-4 text-violet-500" />
                                Voice ID
                            </label>
                            <input
                                type="text"
                                value={elevenLabsVoiceId}
                                onChange={e => setElevenLabsVoiceId(e.target.value)}
                                placeholder="Ej: qHkrJuifPpn95wK3rm2A"
                                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none transition-all dark:text-white"
                            />
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Se autocompleta según el género ({gender === 'MASCULINO' ? 'masculina' : 'femenina'}), pero
                                puede pegar otra voz de su cuenta de ElevenLabs.
                            </p>
                        </div>

                        {/* API Key */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                                <KeyRound className="w-4 h-4 text-violet-500" />
                                API Key
                            </label>
                            <input
                                type="password"
                                value={elevenLabsApiKey}
                                onChange={e => setElevenLabsApiKey(e.target.value)}
                                autoComplete="off"
                                placeholder={hasKey ? '•••••••••• (guardada)' : 'sk_...'}
                                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none transition-all dark:text-white"
                            />
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {hasKey
                                    ? 'Hay una API key guardada y encriptada. Escriba una nueva solo si desea reemplazarla.'
                                    : 'Se guarda encriptada (AES-256-GCM). Nunca se muestra de vuelta.'}
                            </p>
                        </div>
                    </div>
                </section>
            )}

            {/* ── Panel Google ────────────────────────────────────────── */}
            {activeProvider === 'GOOGLE' && (
                <section className="space-y-5">
                    <div className="flex items-center gap-2">
                        <Cloud className="w-4 h-4 text-violet-500" />
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                            Configuración Google TTS (Plan B)
                        </h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        {/* Voz */}
                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-3">
                            <label className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                <Mic className="w-4 h-4 text-violet-500" />
                                Voz del asistente
                            </label>
                            <select
                                value={googleVoiceId}
                                onChange={e => setGoogleVoiceId(e.target.value)}
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
                                Neural2 y WaveNet ofrecen distintas texturas; Studio es más expresiva. Todas en español (es-US).
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
                    </div>

                    {/* Sliders Pitch + Rate */}
                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 space-y-6">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                <AudioWaveform className="w-4 h-4 text-violet-500" />
                                Ajuste fino de la voz
                            </h4>
                            <button
                                type="button"
                                onClick={resetGoogleDefaults}
                                className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Restaurar neutro
                            </button>
                        </div>

                        <SliderControl
                            label="Tono (Pitch)"
                            icon={<AudioWaveform className="w-3.5 h-3.5" />}
                            value={googlePitch}
                            setValue={setGooglePitch}
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
                            value={googleSpeakingRate}
                            setValue={setGoogleSpeakingRate}
                            min={rateMin}
                            max={rateMax}
                            step={0.05}
                            unit="x"
                            minLabel={`${rateMin}x`}
                            maxLabel={`${rateMax}x`}
                        />
                    </div>
                </section>
            )}

            {/* ── Botón Alive + resultado ─────────────────────────────── */}
            <section className="space-y-4">
                <button
                    type="button"
                    onClick={runAlive}
                    disabled={aliveLoading}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {aliveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <AudioLines className="w-4 h-4" />}
                    {aliveLoading
                        ? `Validando con ${activeProvider === 'ELEVENLABS' ? 'ElevenLabs' : 'Google TTS'}…`
                        : `Validar Servicio Alive (${activeProvider === 'ELEVENLABS' ? 'ElevenLabs' : 'Google'})`}
                </button>
                <p className="text-xs text-zinc-400">
                    Prueba el proveedor activo con su configuración actual. Guarde primero los cambios para validarlos.
                </p>
                <AliveResultCard loading={aliveLoading} result={aliveResult} />
            </section>

            {error && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    ❌ {error}
                </div>
            )}

            {/* ── Footer ──────────────────────────────────────────────── */}
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
                            <span>✅</span> Configuración de voz guardada
                        </>
                    ) : (
                        <>
                            <span>💾</span> Guardar configuración de voz
                        </>
                    )}
                </button>
            </div>
        </form>
    );
}

// ─────────────────────────────────────────────────────────────
function GenderPill({
    label,
    Icon,
    active,
    onClick,
}: {
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                active
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
        >
            <Icon className="w-4 h-4" />
            {label}
        </button>
    );
}

// ─────────────────────────────────────────────────────────────
function ProviderCard({
    label,
    tag,
    description,
    Icon,
    active,
    onClick,
}: {
    label: string;
    tag: string;
    description: string;
    Icon: React.ComponentType<{ className?: string }>;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`text-left w-full rounded-2xl border bg-white dark:bg-zinc-900 p-4 transition-all ${
                active
                    ? 'ring-2 ring-violet-500 border-violet-500 bg-violet-50/60 dark:bg-violet-900/20'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300'
            }`}
        >
            <div className="flex items-start gap-3">
                <div
                    className={`rounded-xl p-2.5 ${
                        active
                            ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                    }`}
                >
                    <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-zinc-900 dark:text-white">{label}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                            {tag}
                        </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">{description}</p>
                    <span
                        className={`text-xs font-semibold mt-2 inline-block ${
                            active ? 'text-violet-600 dark:text-violet-300' : 'text-zinc-400'
                        }`}
                    >
                        {active ? '● Activo' : 'Inactivo'}
                    </span>
                </div>
            </div>
        </button>
    );
}

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
                        🟢 Servicio de Audio Alive · {result.provider}
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
                    {result.provider ? ` · ${result.provider}` : ''}
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

function clampNumber(n: number, min: number, max: number): number {
    return Math.min(Math.max(n, min), max);
}

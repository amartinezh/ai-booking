'use client';

import { useEffect, useState, useTransition } from 'react';
import { formatAppointmentCompact } from '@/lib/date';
import {
    codigoDePruebaAsistente,
    conectarAsistente,
    desconectarAsistente,
    guardarAjustesAsistente,
} from '@/app/actions/support-bot';
import type {
    AjustesAsistente,
    CodigoAsistente,
    ConfigAsistente,
    ResultadoConfigAsistente,
} from '@/app/actions/support-bot.types';
import { codigoLegible, segundosRestantes } from '@/app/dashboard/soporte/components/AsistenteTelegramCard';
import { MAX_PERSONAS_PILOTO, ROL_LEGIBLE, type UserRole } from '@agenia/shared';

const INPUT =
    'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white';
const SECONDARY_BTN =
    'rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50';
const PRIMARY_BTN =
    'px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm';
const CARD = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4';

const DIAS = [
    [1, 'L'],
    [2, 'M'],
    [3, 'X'],
    [4, 'J'],
    [5, 'V'],
    [6, 'S'],
    [7, 'D'],
] as const;
const HORAS = Array.from({ length: 25 }, (_, h) => h);

/** Los ajustes del formulario, tal como los guarda la API. */
export function ajustesDe(
    c: ConfigAsistente,
): Required<Omit<AjustesAsistente, 'enabled' | 'pilotOnly' | 'pilotEmails'>> {
    return {
        teamDays: c.horario.dias,
        teamFromHour: c.horario.desdeHora,
        teamToHour: c.horario.hastaHora,
        conversationIdleMinutes: c.conversacionMinutos,
        maxMessagesPerHour: c.limites.mensajesPorHora,
        maxMessageChars: c.limites.caracteresPorMensaje,
        maxAiTurnsPerOrgPerDay: c.limites.turnosIaPorClinicaAlDia,
    };
}

/** Los correos del piloto, uno por línea, para editarlos. */
function correosDe(c: ConfigAsistente | null): string {
    return c?.piloto.personas.map((p) => p.email).join('\n') ?? '';
}

/**
 * 🛟 Configuración del asistente de soporte por Telegram (docs/PLAN_BOT_SOPORTE.md
 * §3.7). La IA no se configura aquí: el asistente usa la de cada clínica (S5). El
 * piloto (Fase 6, §17) decide quiénes lo usan mientras no se abra a todos.
 */
export default function SoporteBotClient({
    inicial,
    clinicas,
}: {
    inicial: ResultadoConfigAsistente;
    clinicas: Array<{ id: string; name: string }>;
}) {
    const [config, setConfig] = useState<ConfigAsistente | null>(inicial.ok ? inicial.config : null);
    const [error, setError] = useState<string | null>(inicial.ok ? null : inicial.error);
    const [token, setToken] = useState('');
    const [ajustes, setAjustes] = useState(config ? ajustesDe(config) : null);
    const [clinica, setClinica] = useState(clinicas[0]?.id ?? '');
    const [prueba, setPrueba] = useState<CodigoAsistente | null>(null);
    const [restantes, setRestantes] = useState(0);
    const [aviso, setAviso] = useState<string | null>(null);
    const [correosPiloto, setCorreosPiloto] = useState(correosDe(config));
    const [pendiente, startTransition] = useTransition();

    useEffect(() => {
        if (!prueba) return;
        const tic = () => setRestantes(segundosRestantes(prueba.venceEn));
        tic();
        const id = setInterval(tic, 1000);
        return () => clearInterval(id);
    }, [prueba]);

    if (!inicial.ok && inicial.apagado) {
        return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                El asistente de soporte no está habilitado en este servidor. Para usarlo, agregue{' '}
                <code className="font-mono">SUPPORT_BOT_ENABLED=true</code> al entorno de la API y vuelva a
                desplegar.
            </div>
        );
    }

    const aplicar = (r: ResultadoConfigAsistente, mensaje: string) => {
        if (r.ok) {
            setConfig(r.config);
            setAjustes(ajustesDe(r.config));
            setCorreosPiloto(correosDe(r.config));
            setError(null);
            setAviso(mensaje);
        } else {
            setError(r.error);
            setAviso(null);
        }
    };

    const conectar = (e: React.FormEvent) => {
        e.preventDefault();
        startTransition(async () => {
            aplicar(await conectarAsistente(token.trim()), 'Bot conectado. Enciéndalo cuando quiera que atienda.');
            setToken('');
        });
    };
    const desconectar = () => {
        if (!confirm('¿Desconectar el bot? El asistente deja de atender y las conversaciones abiertas quedan sin respuesta.')) return;
        startTransition(async () => aplicar(await desconectarAsistente(), 'Bot desconectado.'));
    };
    const encender = (enabled: boolean) =>
        startTransition(async () =>
            aplicar(await guardarAjustesAsistente({ enabled }), enabled ? 'El asistente atiende.' : 'El asistente está apagado.'),
        );
    const guardar = () => {
        if (!ajustes) return;
        startTransition(async () => aplicar(await guardarAjustesAsistente(ajustes), 'Ajustes guardados.'));
    };
    const guardarPiloto = () =>
        startTransition(async () =>
            aplicar(
                await guardarAjustesAsistente({ pilotEmails: correosPiloto.split(/[\s,;]+/).filter(Boolean) }),
                'Piloto guardado.',
            ),
        );
    const cambiarPiloto = (pilotOnly: boolean) => {
        if (
            !pilotOnly &&
            !confirm('¿Abrir el asistente a todo el personal? La tarjeta aparecerá en Soporte para todos en todas las clínicas.')
        )
            return;
        startTransition(async () =>
            aplicar(
                await guardarAjustesAsistente({ pilotOnly }),
                pilotOnly ? 'El asistente quedó solo para el piloto.' : 'El asistente quedó abierto a todo el personal.',
            ),
        );
    };
    const generarPrueba = () =>
        startTransition(async () => {
            const r = await codigoDePruebaAsistente(clinica);
            if (r.ok) {
                setPrueba(r.data);
                setError(null);
            } else setError(r.error);
        });

    const cambiar = <K extends keyof NonNullable<typeof ajustes>>(k: K, v: NonNullable<typeof ajustes>[K]) =>
        setAjustes((a) => (a ? { ...a, [k]: v } : a));

    return (
        <div className="space-y-6">
            {error && (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </p>
            )}
            {aviso && (
                <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {aviso}
                </p>
            )}

            <section className={CARD}>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Bot de Telegram</h2>
                {config?.conectado ? (
                    <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <p>
                            Conectado: <span className="font-semibold">@{config.botUsername}</span>
                        </p>
                        {config.webhook && (
                            <p data-testid="estado-webhook" className={config.webhook.ok ? 'text-emerald-700' : 'text-red-700'}>
                                {config.webhook.ok
                                    ? `Telegram entrega los mensajes a AgenIA${config.webhook.pendientes ? ` (${config.webhook.pendientes} pendientes)` : ''}.`
                                    : 'Telegram no está entregando los mensajes a AgenIA.'}
                                {config.webhook.ultimoError && ` Último error de Telegram: ${config.webhook.ultimoError}`}
                            </p>
                        )}
                        {config.ultimoError && (
                            <p className="text-amber-700">
                                Último envío fallido: {config.ultimoError}
                                {config.ultimoErrorEn && ` (${formatAppointmentCompact(new Date(config.ultimoErrorEn))})`}
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        Cree en @BotFather un bot SOLO para el asistente (no el de las alertas ni el de una clínica) y
                        pegue aquí su token. Al conectarlo, Telegram empieza a entregar sus mensajes a AgenIA.
                    </p>
                )}
                <form onSubmit={conectar} className="flex flex-col sm:flex-row gap-2">
                    <label htmlFor="soporte-token" className="sr-only">
                        Token del bot
                    </label>
                    <input
                        id="soporte-token"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder={config?.conectado ? 'Pegue un token nuevo solo si lo regeneró o cambia de bot' : 'Ej: 123456789:AAH…'}
                        className={`${INPUT} font-mono`}
                    />
                    <button type="submit" disabled={pendiente || !token.trim()} className={PRIMARY_BTN}>
                        {config?.conectado ? 'Renovar token' : 'Conectar bot'}
                    </button>
                    {config?.conectado && (
                        <button type="button" onClick={desconectar} disabled={pendiente} className={SECONDARY_BTN}>
                            Desconectar
                        </button>
                    )}
                </form>
            </section>

            {config?.conectado && ajustes && (
                <>
                    <section className={CARD}>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                                    {config.enabled ? 'El asistente atiende' : 'El asistente está apagado'}
                                </h2>
                                <p className="text-sm text-zinc-500">
                                    Apagado, no responde y la tarjeta de Soporte no aparece en ninguna clínica.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => encender(!config.enabled)}
                                disabled={pendiente}
                                className={config.enabled ? SECONDARY_BTN : PRIMARY_BTN}
                            >
                                {config.enabled ? 'Apagar' : 'Encender'}
                            </button>
                        </div>
                    </section>

                    <section className={CARD} aria-labelledby="piloto">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div>
                                <h2 id="piloto" className="text-lg font-bold text-zinc-900 dark:text-white">
                                    {config.piloto.activo ? 'Piloto: solo estas personas' : 'Abierto a todo el personal'}
                                </h2>
                                <p className="text-sm text-zinc-500 max-w-2xl">
                                    {config.piloto.activo
                                        ? 'Solo las personas del piloto ven la tarjeta en Soporte y pueden conversar con el asistente. Los demás no notan nada.'
                                        : 'Todo el personal de todas las clínicas ve la tarjeta en Soporte.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => cambiarPiloto(!config.piloto.activo)}
                                disabled={pendiente}
                                className={SECONDARY_BTN}
                            >
                                {config.piloto.activo ? 'Abrir a todo el personal' : 'Volver al piloto'}
                            </button>
                        </div>
                        {config.piloto.activo && (
                            <>
                                {config.piloto.personas.length > 0 ? (
                                    <ul className="text-sm text-zinc-700 dark:text-zinc-300 space-y-1" aria-label="Personas del piloto">
                                        {config.piloto.personas.map((p) => (
                                            <li key={p.id}>
                                                <span className="font-medium">{p.email}</span>
                                                <span className="text-zinc-500">
                                                    {' '}
                                                    · {ROL_LEGIBLE[p.rol as UserRole] ?? p.rol}
                                                    {p.clinica && ` · ${p.clinica}`}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-amber-700">
                                        Nadie está en el piloto todavía: el asistente no le aparece a nadie.
                                    </p>
                                )}
                                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                                    Correos del piloto (uno por línea, hasta {MAX_PERSONAS_PILOTO})
                                    <textarea
                                        value={correosPiloto}
                                        onChange={(e) => setCorreosPiloto(e.target.value)}
                                        rows={4}
                                        className={`${INPUT} mt-1 font-mono`}
                                    />
                                </label>
                                <button type="button" onClick={guardarPiloto} disabled={pendiente} className={PRIMARY_BTN}>
                                    Guardar el piloto
                                </button>
                            </>
                        )}
                    </section>

                    <section className={CARD}>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Horario del equipo y límites</h2>
                        <fieldset>
                            <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                                Días y horas en que el equipo atiende (hora de Colombia)
                            </legend>
                            <div className="flex flex-wrap items-center gap-2">
                                {DIAS.map(([d, letra]) => (
                                    <label key={d} className="flex items-center gap-1 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={ajustes.teamDays.includes(d)}
                                            onChange={(e) =>
                                                cambiar(
                                                    'teamDays',
                                                    e.target.checked
                                                        ? [...ajustes.teamDays, d].sort((a, b) => a - b)
                                                        : ajustes.teamDays.filter((x) => x !== d),
                                                )
                                            }
                                        />
                                        {letra}
                                    </label>
                                ))}
                                <label className="flex items-center gap-1 text-sm ml-2">
                                    de
                                    <select
                                        aria-label="Hora de inicio"
                                        value={ajustes.teamFromHour}
                                        onChange={(e) => cambiar('teamFromHour', Number(e.target.value))}
                                        className="rounded-lg border border-zinc-200 px-2 py-1"
                                    >
                                        {HORAS.slice(0, 24).map((h) => (
                                            <option key={h} value={h}>{`${h}:00`}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex items-center gap-1 text-sm">
                                    a
                                    <select
                                        aria-label="Hora de fin"
                                        value={ajustes.teamToHour}
                                        onChange={(e) => cambiar('teamToHour', Number(e.target.value))}
                                        className="rounded-lg border border-zinc-200 px-2 py-1"
                                    >
                                        {HORAS.slice(1).map((h) => (
                                            <option key={h} value={h}>{`${h}:00`}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </fieldset>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(
                                [
                                    ['conversationIdleMinutes', 'Minutos sin mensajes que cierran una conversación'],
                                    ['maxMessagesPerHour', 'Mensajes por hora de cada persona'],
                                    ['maxMessageChars', 'Caracteres por mensaje'],
                                    ['maxAiTurnsPerOrgPerDay', 'Respuestas con IA por clínica al día (0 = sin IA)'],
                                ] as const
                            ).map(([campo, etiqueta]) => (
                                <label key={campo} className="text-sm text-zinc-700 dark:text-zinc-300">
                                    {etiqueta}
                                    <input
                                        type="number"
                                        value={ajustes[campo]}
                                        onChange={(e) => cambiar(campo, Number(e.target.value))}
                                        className={`${INPUT} mt-1`}
                                    />
                                </label>
                            ))}
                        </div>
                        <button type="button" onClick={guardar} disabled={pendiente} className={PRIMARY_BTN}>
                            Guardar ajustes
                        </button>
                    </section>

                    <section className={CARD}>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Probar el asistente</h2>
                        <p className="text-sm text-zinc-500">
                            Genera un código para conversar con el asistente como si fuera de una clínica: usa la IA de
                            esa clínica y los casos se simulan.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <label htmlFor="soporte-clinica" className="sr-only">
                                Clínica de prueba
                            </label>
                            <select
                                id="soporte-clinica"
                                value={clinica}
                                onChange={(e) => setClinica(e.target.value)}
                                className={INPUT}
                            >
                                {clinicas.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={generarPrueba}
                                disabled={pendiente || !clinica || !config.enabled}
                                className={PRIMARY_BTN}
                            >
                                Generar código de prueba
                            </button>
                        </div>
                        {!config.enabled && (
                            <p className="text-xs text-zinc-500">Encienda el asistente para poder probarlo.</p>
                        )}
                        {prueba && restantes > 0 && (
                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                Escriba <span className="font-mono text-lg font-bold">{codigoLegible(prueba.codigo)}</span>{' '}
                                en @{prueba.botUsername} o{' '}
                                <a href={prueba.enlace} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-600 hover:underline">
                                    ábralo en Telegram
                                </a>
                                . Vence en {Math.ceil(restantes / 60)} min.
                            </p>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

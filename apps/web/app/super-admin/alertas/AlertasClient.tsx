'use client';

import { useState, useTransition } from 'react';
import {
    AlertTriangle,
    BellOff,
    CheckCircle2,
    Copy,
    KeyRound,
    Power,
    RefreshCw,
    Search,
    Send,
    Users,
} from 'lucide-react';
import {
    CATALOGO_ALERTAS,
    CATEGORIAS_ALERTA,
    ICONO_GRAVEDAD_ALERTA,
    OPCIONES_SILENCIO,
    TEXTO_CATEGORIA_ALERTA,
    TEXTO_GRAVEDAD_ALERTA,
    TEXTO_OPCION_SILENCIO,
    UMBRALES_ALERTAS,
    type GravedadAlerta,
    type TipoAlerta,
} from '@agenia/shared';
import {
    connectTechAlertBot,
    disconnectTechAlertBot,
    findTechAlertLink,
    listTechAlerts,
    muteTechAlerts,
    sendTechAlertTest,
    startTechAlertLink,
    unmuteTechAlerts,
    updateTechAlertSettings,
} from '@/app/actions/tech-alerts';
import type {
    PublicTechAlertConfig,
    TechAlertListResult,
    TechAlertRow,
} from '@/app/actions/tech-alerts.types';
import { formatAppointmentCompact, formatTimeOnly } from '@/lib/date';

type Props = {
    initialConfig: PublicTechAlertConfig | null;
    loadError: string | null;
    initialAlerts: TechAlertListResult;
};

const INPUT =
    'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white';
const SECONDARY_BTN =
    'rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-2';
const PRIMARY_BTN =
    'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm';
const CARD = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4';

const HORAS = Array.from({ length: 24 }, (_, h) => h);
const hora = (h: number) => `${String(h).padStart(2, '0')}:00`;
const fecha = (iso: string | null) => (iso ? formatAppointmentCompact(new Date(iso)) : '—');

const ESTADO_FILA: Record<string, string> = {
    ABIERTA: 'Abierta',
    RESUELTA: 'Resuelta',
    EVENTO: 'Evento',
};

/**
 * ¿El vigía del servidor está corriendo? Corre cada minuto: sin vuelta en 3 min,
 * su cron se rompió y nadie avisaría si la API se cae. `null` = no aplica.
 */
export function estadoDelVigia(
    vigia: PublicTechAlertConfig['vigia'],
    ahora: Date = new Date(),
): { ok: boolean; texto: string } | null {
    if (!vigia) return null;
    if (!vigia.ultimaVueltaAt) {
        return {
            ok: false,
            texto: 'El vigía del servidor nunca ha corrido. En el servidor: agenia vigia instalar',
        };
    }
    const ultima = new Date(vigia.ultimaVueltaAt);
    if (ahora.getTime() - ultima.getTime() > 3 * 60_000) {
        return {
            ok: false,
            texto: `El vigía del servidor no corre desde ${fecha(vigia.ultimaVueltaAt)}: revise su cron (agenia vigia instalar).`,
        };
    }
    return {
        ok: true,
        texto: `Vigía del servidor activo (última vuelta: ${formatTimeOnly(ultima)}). Avisa aunque la API esté caída: contenedores, disco y respaldo. Prueba desde el servidor: agenia vigia prueba`,
    };
}

/** Qué pasó con el aviso de una fila de la bitácora. */
export function envioDeFila(f: TechAlertRow): string {
    const suprimida = (f.meta as { suprimida?: string } | null)?.suprimida;
    if (suprimida === 'TOPE') return 'Agrupada en «y N alertas más»';
    if (suprimida === 'INTERMITENTE') return 'Intermitente: aviso único';
    if (f.notifiedAt) {
        const resuelto = f.resolutionNotifiedAt ? ' · «resuelto» enviado' : '';
        return `Enviada ${formatTimeOnly(new Date(f.notifiedAt))}${resuelto}`;
    }
    if (f.lastSendError) return `Falló: ${f.lastSendError}`;
    return 'Sin enviar (apagado, en silencio o categoría apagada)';
}

/**
 * 🚨 Alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md §3.8).
 *
 * Tres pasos: conectar un bot PROPIO de la plataforma, vincular el grupo del
 * equipo con un código (sin escribir ids a mano) y encender. Después, qué avisar
 * y cómo, y la bitácora de lo que pasó.
 */
export default function AlertasClient({ initialConfig, loadError, initialAlerts }: Props) {
    const [config, setConfig] = useState<PublicTechAlertConfig | null>(initialConfig);
    const [alerts, setAlerts] = useState<TechAlertListResult>(initialAlerts);
    const [statusFilter, setStatusFilter] = useState('');
    const [token, setToken] = useState('');
    const [error, setError] = useState<string | null>(loadError);
    const [notice, setNotice] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [isPending, startTransition] = useTransition();

    const run = (fn: () => Promise<void>) => {
        setError(null);
        setNotice(null);
        startTransition(fn);
    };

    if (!config) {
        return (
            <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                ❌ No se pudo cargar la configuración: {error ?? 'error desconocido'}
            </div>
        );
    }

    const handleConnect = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        run(async () => {
            const res = await connectTechAlertBot(token);
            if (!res.success) return setError(res.error);
            setConfig(res.data);
            setToken('');
            setNotice(
                res.data.chatLinked
                    ? '✅ Token renovado. El grupo sigue vinculado.'
                    : '✅ Bot conectado. Ahora vincule el grupo del equipo.',
            );
        });
    };

    const handleDisconnect = () => {
        if (!confirm('¿Desconectar el bot? El grupo deja de recibir alertas hasta que lo conecte y vincule de nuevo.')) {
            return;
        }
        run(async () => {
            const res = await disconnectTechAlertBot();
            if (!res.success) return setError(res.error);
            setConfig(res.data);
            setNotice('El bot quedó desconectado y el grupo recibió el aviso.');
        });
    };

    const handleStartLink = () =>
        run(async () => {
            const res = await startTechAlertLink();
            if (!res.success) return setError(res.error);
            setConfig(res.data);
        });

    const handleFindLink = () =>
        run(async () => {
            const res = await findTechAlertLink();
            if (!res.success) return setError(res.error);
            if (res.data.found) {
                setConfig(res.data.config);
                setNotice(
                    `✅ Grupo «${res.data.config.chatTitle ?? 'vinculado'}» listo. Ya recibió la bienvenida y las alertas quedaron encendidas.`,
                );
            } else {
                setError(res.data.message);
            }
        });

    const handleTest = () =>
        run(async () => {
            const res = await sendTechAlertTest();
            if (!res.success) return setError(res.error);
            if (res.data.ok) setNotice('✅ Mensaje de prueba enviado. Revise el grupo.');
            else setError(`Telegram no aceptó el mensaje: ${res.data.error ?? 'sin detalle'}`);
        });

    const handleToggle = () =>
        run(async () => {
            const res = await updateTechAlertSettings({ enabled: !config.enabled });
            if (!res.success) return setError(res.error);
            setConfig(res.data);
            setNotice(res.data.enabled ? 'Alertas encendidas.' : 'Alertas apagadas: nada se envía, pero todo queda en la bitácora.');
        });

    const handleMute = (opcion: string) =>
        run(async () => {
            const res = opcion ? await muteTechAlerts(opcion) : await unmuteTechAlerts();
            if (!res.success) return setError(res.error);
            setConfig(res.data);
        });

    const handleCopy = (value: string) => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const refreshAlerts = (status = statusFilter) =>
        run(async () => {
            setAlerts(await listTechAlerts(status || undefined));
        });

    return (
        <div className="space-y-8">
            <EstadoCanal config={config} />

            {error && (
                <div role="alert" className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    ❌ {error}
                </div>
            )}
            {notice && (
                <div role="status" className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                </div>
            )}

            {/* ── 1. El bot ─────────────────────────────────── */}
            <section className={CARD}>
                <Titulo paso="1" icono={<KeyRound className="w-5 h-5" />} titulo="El bot">
                    Un bot <strong>propio de la plataforma</strong>, solo para las alertas. No sirve
                    el bot de una clínica: en ese escriben pacientes.
                </Titulo>

                {config.connected ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <strong className="text-zinc-900 dark:text-white">@{config.botUsername}</strong>
                        <span className="font-mono text-xs text-zinc-500">· token •••{config.botTokenLast4}</span>
                        <button type="button" onClick={handleDisconnect} disabled={isPending} className={`${SECONDARY_BTN} ml-auto`}>
                            <Power className="w-4 h-4" /> Desconectar
                        </button>
                    </div>
                ) : (
                    <ol className="rounded-xl bg-zinc-50 dark:bg-zinc-950/40 p-4 space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300 list-decimal list-inside">
                        <li>
                            En Telegram, abra{' '}
                            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-indigo-700 dark:text-indigo-400 font-semibold underline">
                                @BotFather
                            </a>{' '}
                            y envíele <code className="font-mono">/newbot</code>.
                        </li>
                        <li>Nómbrelo, por ejemplo, «AgenIA Técnico», con un usuario que termine en <code className="font-mono">bot</code>.</li>
                        <li>Pegue aquí el <strong>token</strong> que le responde. Se guarda cifrado y no vuelve a mostrarse.</li>
                    </ol>
                )}

                <form onSubmit={handleConnect} className="flex flex-col sm:flex-row gap-2">
                    <label htmlFor="tech-alert-token" className="sr-only">Token del bot</label>
                    <input
                        id="tech-alert-token"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder={config.connected ? 'Pegue un token nuevo solo si lo regeneró o cambia de bot' : 'Ej: 123456789:AAH…'}
                        className={`${INPUT} font-mono`}
                    />
                    <button type="submit" disabled={isPending || !token.trim()} className={PRIMARY_BTN}>
                        {config.connected ? 'Renovar token' : 'Conectar bot'}
                    </button>
                </form>
            </section>

            {/* ── 2. El grupo ───────────────────────────────── */}
            <section className={CARD}>
                <Titulo paso="2" icono={<Users className="w-5 h-5" />} titulo="El grupo del equipo">
                    Las alertas llegan a un <strong>grupo</strong> de Telegram: todos ven lo mismo y
                    cualquiera puede decir «lo tomo». Manténgalo privado: quien esté en él ve las alertas.
                </Titulo>

                {!config.connected ? (
                    <p className="text-sm text-zinc-500">Primero conecte el bot.</p>
                ) : config.linkPending ? (
                    <div className="space-y-3">
                        <ol className="rounded-xl bg-zinc-50 dark:bg-zinc-950/40 p-4 space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300 list-decimal list-inside">
                            <li>Agregue <strong>@{config.botUsername}</strong> al grupo del equipo técnico.</li>
                            <li>Escriba en el grupo, tal cual, este mensaje:</li>
                        </ol>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm font-mono text-zinc-800 dark:text-zinc-100 break-all">
                                {config.linkPending.command}
                            </code>
                            <button type="button" onClick={() => handleCopy(config.linkPending!.command)} className={SECONDARY_BTN}>
                                {copied ? <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Copiado</> : <><Copy className="w-4 h-4" /> Copiar</>}
                            </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" onClick={handleFindLink} disabled={isPending} className={PRIMARY_BTN}>
                                <Search className="w-4 h-4" /> Buscar el grupo
                            </button>
                            <span className="text-xs text-zinc-500">
                                El código vence a las {formatTimeOnly(new Date(config.linkPending.expiresAt))}.
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        {config.chatLinked && (
                            <span className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                Vinculado a <strong>«{config.chatTitle ?? 'grupo sin nombre'}»</strong>
                            </span>
                        )}
                        <button type="button" onClick={handleStartLink} disabled={isPending} className={config.chatLinked ? SECONDARY_BTN : PRIMARY_BTN}>
                            {config.chatLinked ? 'Vincular otro grupo' : 'Generar código de vinculación'}
                        </button>
                    </div>
                )}
            </section>

            {/* ── 3. Encender y probar ──────────────────────── */}
            <section className={CARD}>
                <Titulo paso="3" icono={<Send className="w-5 h-5" />} titulo="Encender y probar">
                    La prueba sale aunque las alertas estén apagadas o en silencio.
                </Titulo>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={handleTest} disabled={isPending || !config.chatLinked} className={SECONDARY_BTN}>
                        <Send className="w-4 h-4" /> Enviar mensaje de prueba
                    </button>
                    <button type="button" onClick={handleToggle} disabled={isPending || (!config.enabled && !config.chatLinked)} className={config.enabled ? SECONDARY_BTN : PRIMARY_BTN}>
                        <Power className="w-4 h-4" /> {config.enabled ? 'Apagar alertas' : 'Encender alertas'}
                    </button>
                </div>
                <LineaVigia config={config} />
                {config.chatLinked && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                        <span className="text-sm text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                            <BellOff className="w-4 h-4" /> Silenciar (mantenimiento, despliegue):
                        </span>
                        {config.mutedUntil && new Date(config.mutedUntil) > new Date() ? (
                            <button type="button" onClick={() => handleMute('')} disabled={isPending} className={SECONDARY_BTN}>
                                Quitar el silencio
                            </button>
                        ) : (
                            OPCIONES_SILENCIO.map((o) => (
                                <button key={o} type="button" onClick={() => handleMute(o)} disabled={isPending} className={SECONDARY_BTN}>
                                    {TEXTO_OPCION_SILENCIO[o]}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </section>

            <Ajustes key={config.updatedAt ?? 'nuevo'} config={config} isPending={isPending} run={run} onSaved={(c) => { setConfig(c); setNotice('Ajustes guardados.'); }} onError={setError} />

            {/* ── Bitácora ─────────────────────────────────── */}
            <section className={CARD}>
                <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white mr-auto">Bitácora</h2>
                    <label htmlFor="tech-alert-filtro" className="sr-only">Filtrar por estado</label>
                    <select
                        id="tech-alert-filtro"
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); refreshAlerts(e.target.value); }}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm dark:text-white"
                    >
                        <option value="">Todas</option>
                        <option value="ABIERTA">Abiertas</option>
                        <option value="RESUELTA">Resueltas</option>
                        <option value="EVENTO">Eventos</option>
                    </select>
                    <button type="button" onClick={() => refreshAlerts()} disabled={isPending} className={SECONDARY_BTN}>
                        <RefreshCw className={`w-4 h-4 ${isPending ? 'animate-spin' : ''}`} /> Actualizar
                    </button>
                </div>
                {alerts.rows.length === 0 ? (
                    <p className="text-sm text-zinc-500">Sin alertas registradas.</p>
                ) : (
                    <div className="overflow-x-auto -mx-6 px-6">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                                    <th className="py-2 pr-3 font-semibold">Desde</th>
                                    <th className="py-2 pr-3 font-semibold">Qué</th>
                                    <th className="py-2 pr-3 font-semibold">Estado</th>
                                    <th className="py-2 font-semibold">Aviso</th>
                                </tr>
                            </thead>
                            <tbody>
                                {alerts.rows.map((f) => (
                                    <FilaBitacora key={f.id} fila={f} />
                                ))}
                            </tbody>
                        </table>
                        {alerts.total > alerts.rows.length && (
                            <p className="text-xs text-zinc-500 pt-2">
                                Mostrando {alerts.rows.length} de {alerts.total}.
                            </p>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}

function Titulo({ paso, icono, titulo, children }: { paso?: string; icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-3">
            <div className="rounded-xl bg-indigo-100 dark:bg-indigo-900/30 p-2.5 text-indigo-600 dark:text-indigo-400">{icono}</div>
            <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                    {paso && <span className="text-zinc-400 mr-1">{paso}.</span>}
                    {titulo}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">{children}</p>
            </div>
        </div>
    );
}

function LineaVigia({ config }: { config: PublicTechAlertConfig }) {
    const estado = estadoDelVigia(config.vigia);
    if (!estado) return null;
    return (
        <p
            data-testid="estado-vigia"
            className={`text-sm flex items-start gap-2 ${estado.ok ? 'text-zinc-600 dark:text-zinc-400' : 'text-amber-700 dark:text-amber-400'}`}
        >
            {estado.ok ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
            ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{estado.texto}</span>
        </p>
    );
}

/** La franja de arriba: ¿están saliendo las alertas? */
function EstadoCanal({ config }: { config: PublicTechAlertConfig }) {
    const silenciada = config.mutedUntil && new Date(config.mutedUntil) > new Date();
    const ultimoFallo =
        config.lastError &&
        config.lastErrorAt &&
        (!config.lastOkAt || new Date(config.lastErrorAt) > new Date(config.lastOkAt));

    let tono = 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300';
    let icono = <AlertTriangle className="w-5 h-5 text-zinc-500" />;
    let texto: React.ReactNode;

    if (!config.connected) {
        texto = 'Sin configurar: nadie del equipo se entera de un fallo hasta que abre el panel.';
    } else if (!config.chatLinked) {
        texto = 'Falta vincular el grupo del equipo.';
    } else if (ultimoFallo) {
        tono = 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300';
        icono = <AlertTriangle className="w-5 h-5 text-rose-600" />;
        texto = <>Las alertas NO están saliendo. Último error ({fecha(config.lastErrorAt)}): {config.lastError}</>;
    } else if (!config.enabled) {
        texto = 'Apagadas: nada se envía, pero todo queda en la bitácora.';
    } else if (silenciada) {
        tono = 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300';
        icono = <BellOff className="w-5 h-5 text-amber-600" />;
        texto = <>En silencio hasta {fecha(config.mutedUntil)}.</>;
    } else {
        tono = 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300';
        icono = <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
        texto = (
            <>
                Activas en «{config.chatTitle ?? 'el grupo'}».
                {config.lastOkAt && <> Último envío correcto: {fecha(config.lastOkAt)}.</>}
            </>
        );
    }

    return (
        <div data-testid="estado-canal" className={`rounded-2xl border px-5 py-4 flex items-start gap-3 text-sm ${tono}`}>
            {icono}
            <div>{texto}</div>
        </div>
    );
}

function Ajustes({
    config,
    isPending,
    run,
    onSaved,
    onError,
}: {
    config: PublicTechAlertConfig;
    isPending: boolean;
    run: (fn: () => Promise<void>) => void;
    onSaved: (c: PublicTechAlertConfig) => void;
    onError: (e: string) => void;
}) {
    const [categories, setCategories] = useState(config.categories);
    const [reminderMinutes, setReminderMinutes] = useState(config.reminderMinutes);
    const [maxReminders, setMaxReminders] = useState(config.maxReminders);
    const [quietHoursEnabled, setQuietHoursEnabled] = useState(config.quietHoursEnabled);
    const [quietFromHour, setQuietFromHour] = useState(config.quietFromHour);
    const [quietToHour, setQuietToHour] = useState(config.quietToHour);
    const [dailySummaryEnabled, setDailySummaryEnabled] = useState(config.dailySummaryEnabled);
    const [panelBaseUrl, setPanelBaseUrl] = useState(config.panelBaseUrl ?? '');
    const r = UMBRALES_ALERTAS.recordatorio;

    const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        run(async () => {
            const res = await updateTechAlertSettings({
                categories,
                reminderMinutes,
                maxReminders,
                quietHoursEnabled,
                quietFromHour,
                quietToHour,
                dailySummaryEnabled,
                panelBaseUrl,
            });
            if (res.success) onSaved(res.data);
            else onError(res.error);
        });
    };

    return (
        <form onSubmit={handleSave} className={CARD}>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Qué avisar y cómo</h2>

            <fieldset className="grid sm:grid-cols-2 gap-3">
                <legend className="sr-only">Categorías</legend>
                {CATEGORIAS_ALERTA.map((c) => (
                    <label key={c} className="flex items-start gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={categories[c] !== false}
                            onChange={(e) => setCategories({ ...categories, [c]: e.target.checked })}
                            className="mt-1"
                        />
                        <span>
                            <span className="block text-sm font-semibold text-zinc-900 dark:text-white">{TEXTO_CATEGORIA_ALERTA[c].titulo}</span>
                            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{TEXTO_CATEGORIA_ALERTA[c].descripcion}</span>
                        </span>
                    </label>
                ))}
            </fieldset>

            <div className="grid sm:grid-cols-2 gap-4">
                <label className="block text-sm">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">Si sigue sin resolverse, recordar cada (min)</span>
                    <input type="number" min={r.minimoMin} max={r.maximoMin} value={reminderMinutes} onChange={(e) => setReminderMinutes(Number(e.target.value))} className={`${INPUT} mt-1`} />
                </label>
                <label className="block text-sm">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">Máximo de recordatorios</span>
                    <input type="number" min={0} max={UMBRALES_ALERTAS.maxRecordatorios.maximo} value={maxReminders} onChange={(e) => setMaxReminders(Number(e.target.value))} className={`${INPUT} mt-1`} />
                </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2 font-semibold text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" checked={quietHoursEnabled} onChange={(e) => setQuietHoursEnabled(e.target.checked)} />
                    De noche, las advertencias llegan sin sonido
                </label>
                <span className="text-zinc-500">de</span>
                <select aria-label="Desde" value={quietFromHour} disabled={!quietHoursEnabled} onChange={(e) => setQuietFromHour(Number(e.target.value))} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 dark:text-white">
                    {HORAS.map((h) => <option key={h} value={h}>{hora(h)}</option>)}
                </select>
                <span className="text-zinc-500">a</span>
                <select aria-label="Hasta" value={quietToHour} disabled={!quietHoursEnabled} onChange={(e) => setQuietToHour(Number(e.target.value))} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 dark:text-white">
                    {HORAS.map((h) => <option key={h} value={h}>{hora(h)}</option>)}
                </select>
                <span className="text-xs text-zinc-500">(las críticas siempre suenan)</span>
            </div>

            <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={dailySummaryEnabled} onChange={(e) => setDailySummaryEnabled(e.target.checked)} className="mt-1" />
                <span>
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">Resumen diario a las {UMBRALES_ALERTAS.resumenDiario.hora}:00</span>
                    <span className="block text-xs text-zinc-500">Si un día no llega, el problema es el canal, no que todo esté bien.</span>
                </span>
            </label>

            <label className="block text-sm">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">URL del panel para los enlaces</span>
                <input type="url" value={panelBaseUrl} onChange={(e) => setPanelBaseUrl(e.target.value)} placeholder={config.panelBaseEffective ?? 'https://…'} className={`${INPUT} mt-1`} />
                <span className="block text-xs text-zinc-500 mt-1">Vacío = la URL pública de la API sin /api.</span>
            </label>

            <div className="flex justify-end">
                <button type="submit" disabled={isPending} className={PRIMARY_BTN}>Guardar ajustes</button>
            </div>
        </form>
    );
}

function FilaBitacora({ fila }: { fila: TechAlertRow }) {
    const sev = fila.severity as GravedadAlerta;
    const tipo = CATALOGO_ALERTAS[fila.kind as TipoAlerta]?.titulo ?? fila.kind;
    return (
        <tr className="border-b border-zinc-100 dark:border-zinc-800 align-top">
            <td className="py-2 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{fecha(fila.firstSeenAt)}</td>
            <td className="py-2 pr-3">
                <div className="font-semibold text-zinc-900 dark:text-white">
                    {ICONO_GRAVEDAD_ALERTA[sev] ?? ''} {tipo}
                    <span className="sr-only"> ({TEXTO_GRAVEDAD_ALERTA[sev] ?? fila.severity})</span>
                </div>
                <div className="text-zinc-700 dark:text-zinc-300">
                    {fila.title}
                    {fila.organizationName && <span className="text-zinc-500"> — {fila.organizationName}</span>}
                    {fila.occurrences > 1 && <span className="text-zinc-500"> · ×{fila.occurrences}</span>}
                </div>
                {fila.detail && <div className="text-xs text-zinc-500 mt-0.5 break-words">{fila.detail}</div>}
            </td>
            <td className="py-2 pr-3 whitespace-nowrap">
                {ESTADO_FILA[fila.status] ?? fila.status}
                {fila.resolvedAt && <div className="text-xs text-zinc-500">{fecha(fila.resolvedAt)}</div>}
            </td>
            <td className="py-2 text-xs text-zinc-600 dark:text-zinc-400">{envioDeFila(fila)}</td>
        </tr>
    );
}

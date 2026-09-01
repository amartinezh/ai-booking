'use client';

import { useState, useTransition } from 'react';
import { reprocesarEvento } from '@/app/actions/espejo';
import { formatDateShort } from '@/lib/date';

type Estado = {
    config: {
        driverKey: string;
        enabled: boolean;
        availabilityMode: string;
        pushEnabled: boolean;
        pullEnabled: boolean;
        lastHeartbeatAt: Date | null;
        lastHisReachable: boolean | null;
        lastHisDetail: string | null;
    };
    edadLatidoMin: number | null;
    pendientes: number;
    colaDesde: Date | null;
    deadLetters: {
        seq: bigint;
        eventId: string;
        entityType: string;
        entityId: string;
        op: string;
        attempts: number;
        createdAt: Date;
    }[];
    ultimaReconciliacion: { createdAt: Date; outcome: string; detail: string | null } | null;
    ultimaAgenda: { createdAt: Date; outcome: string; detail: string | null } | null;
    conflictos: { createdAt: Date; entityType: string; op: string; detail: string | null }[];
    cuposFuturos: number;
};

/** Semáforo: el color dice qué hacer, el texto dice por qué. */
function Semaforo({
    estado,
    titulo,
    detalle,
}: {
    estado: 'ok' | 'atencion' | 'mal';
    titulo: string;
    detalle: string;
}) {
    const estilos = {
        ok: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200',
        atencion: 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200',
        mal: 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200',
    }[estado];
    const icono = { ok: '✓', atencion: '!', mal: '✕' }[estado];

    return (
        <div className={`rounded-xl border p-4 ${estilos}`}>
            <div className="flex items-baseline gap-2">
                <span className="font-bold" aria-hidden>{icono}</span>
                <h3 className="font-semibold text-sm">{titulo}</h3>
            </div>
            <p className="mt-1 text-sm leading-snug opacity-90">{detalle}</p>
        </div>
    );
}

export default function EspejoClient({ data }: { data: Estado }) {
    const [pendiente, startTransition] = useTransition();
    const [aviso, setAviso] = useState<string | null>(null);
    const { config } = data;

    const reprocesar = (seq: bigint) => {
        setAviso(null);
        startTransition(async () => {
            const r = await reprocesarEvento(seq.toString());
            setAviso(
                r.success
                    ? `Evento ${seq} devuelto a la cola. El agente lo reintentará en su próxima vuelta.`
                    : r.error ?? 'No se pudo reprocesar.',
            );
        });
    };

    // El agente puede latir puntual y no alcanzar el HIS: son dos cosas
    // distintas y se dicen por separado.
    const latido =
        data.edadLatidoMin === null
            ? { estado: 'mal' as const, detalle: 'El agente nunca hizo handshake. ¿Está instalado y arrancado en la VM del hospital?' }
            : data.edadLatidoMin > 5
              ? { estado: 'mal' as const, detalle: `Sin señal desde hace ${data.edadLatidoMin} minutos. El agente no está corriendo o la VM perdió internet.` }
              : config.lastHisReachable === false
                ? { estado: 'mal' as const, detalle: `El agente está vivo pero NO alcanza el sistema del hospital: ${config.lastHisDetail ?? 'sin detalle'}. Ninguna cita se está espejando.` }
                : { estado: 'ok' as const, detalle: `Latido hace ${data.edadLatidoMin} min y el sistema del hospital responde.` };

    const cola =
        data.deadLetters.length > 0
            ? { estado: 'mal' as const, detalle: `${data.deadLetters.length} evento(s) se rindieron: el hospital NO los tiene y nadie los va a reintentar solo.` }
            : data.pendientes > 0
              ? { estado: 'atencion' as const, detalle: `${data.pendientes} evento(s) en camino${data.colaDesde ? `, el más viejo desde ${formatDateShort(data.colaDesde)}` : ''}.` }
              : { estado: 'ok' as const, detalle: 'Todo lo que se agendó por WhatsApp llegó al hospital.' };

    const agendaTexto: Record<string, string> = {
        OFF: 'La agenda de AgenIA es la suya, no la del hospital: se puede vender una hora en la que el médico no atiende.',
        SHADOW: 'Modo sombra: se compara con la agenda del hospital y se reporta, sin escribir nada todavía.',
        ON: `La agenda de AgenIA es la del hospital. ${data.cuposFuturos} cupo(s) a futuro.`,
    };
    const agenda = {
        estado: (config.availabilityMode === 'ON' ? 'ok' : config.availabilityMode === 'SHADOW' ? 'atencion' : 'atencion') as 'ok' | 'atencion',
        detalle: agendaTexto[config.availabilityMode] ?? config.availabilityMode,
    };

    const reconciliacion = data.ultimaReconciliacion
        ? data.ultimaReconciliacion.outcome === 'OK'
            ? { estado: 'ok' as const, detalle: `Sin diferencias entre los dos sistemas (${formatDateShort(data.ultimaReconciliacion.createdAt)}).` }
            : { estado: 'mal' as const, detalle: `Los dos sistemas no coinciden (${formatDateShort(data.ultimaReconciliacion.createdAt)}). Revise los conflictos.` }
        : { estado: 'atencion' as const, detalle: 'Todavía no ha corrido ninguna comparación completa.' };

    return (
        <div className="space-y-8">
            <header>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                    Espejo con el sistema del hospital
                </h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Driver <code className="font-mono">{config.driverKey}</code> ·{' '}
                    {config.enabled ? 'activo' : 'desactivado'}
                    {!config.pushEnabled && ' · escritura al hospital PAUSADA'}
                    {!config.pullEnabled && ' · lectura del hospital PAUSADA'}
                </p>
            </header>

            <section className="grid gap-4 sm:grid-cols-2">
                <Semaforo titulo="Agente en la VM del hospital" {...latido} />
                <Semaforo titulo="Citas en camino al hospital" {...cola} />
                <Semaforo titulo="Agenda" {...agenda} />
                <Semaforo titulo="Los dos sistemas coinciden" {...reconciliacion} />
            </section>

            {aviso && (
                <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    {aviso}
                </p>
            )}

            <section>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                    Eventos que no llegaron al hospital
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Se reintentaron diez veces y se rindieron. Nada se descarta: quedan aquí hasta
                    que alguien los devuelva a la cola.
                </p>

                {data.deadLetters.length === 0 ? (
                    <p className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                        Ninguno. Todo lo que salió de AgenIA está en el hospital.
                    </p>
                ) : (
                    <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                        <table className="w-full text-sm">
                            <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                                <tr className="text-zinc-600 dark:text-zinc-400">
                                    <th className="p-3 font-medium">Qué</th>
                                    <th className="p-3 font-medium">Cuándo</th>
                                    <th className="p-3 font-medium">Intentos</th>
                                    <th className="p-3 font-medium sr-only">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
                                {data.deadLetters.map((e) => (
                                    <tr key={e.seq.toString()}>
                                        <td className="p-3">
                                            <span className="font-medium text-zinc-900 dark:text-white">
                                                {e.entityType} · {e.op}
                                            </span>
                                            <span className="block font-mono text-xs text-zinc-500">
                                                {e.entityId}
                                            </span>
                                        </td>
                                        <td className="p-3 tabular-nums text-zinc-600 dark:text-zinc-400">
                                            {formatDateShort(e.createdAt)}
                                        </td>
                                        <td className="p-3 tabular-nums text-zinc-600 dark:text-zinc-400">
                                            {e.attempts}
                                        </td>
                                        <td className="p-3 text-right">
                                            <button
                                                onClick={() => reprocesar(e.seq)}
                                                disabled={pendiente}
                                                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                            >
                                                Reintentar
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {data.conflictos.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                        Conflictos recientes
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Situaciones que el sistema NO resuelve solo a propósito, porque afectan a un
                        paciente concreto.
                    </p>
                    <ul className="mt-4 space-y-2">
                        {data.conflictos.map((c, i) => (
                            <li
                                key={i}
                                className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                            >
                                <span className="font-medium text-zinc-900 dark:text-white">
                                    {c.entityType} · {c.op}
                                </span>
                                <span className="ml-2 text-zinc-500">
                                    {formatDateShort(c.createdAt)}
                                </span>
                                <p className="mt-1 break-words font-mono text-xs text-zinc-600 dark:text-zinc-400">
                                    {c.detail?.slice(0, 400)}
                                </p>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

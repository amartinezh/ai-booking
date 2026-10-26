'use client';

import { useState, useTransition } from 'react';
import { BarChart3, Copy, ExternalLink } from 'lucide-react';
import { quitarMyClaveEstadisticas, setMyClaveEstadisticas } from '@/app/actions/estadisticas';
import { formatAppointmentCompact } from '@/lib/date';
import { CLAVE_ESTADISTICAS } from '@/lib/estadisticas/clave';

export interface EstadoEstadisticas {
    abierta: boolean;
    ruta: string;
    /** El enlace completo para compartir. */
    enlace: string;
    cambiadaEn: string | null;
    cambiadaPor: string | null;
}

/**
 * 📊 Estadísticas para compartir (2026-10-26): el administrador abre la página
 * pública con una clave sencilla, la cambia o la cierra. La clave se guarda con
 * bcrypt y no se vuelve a mostrar; cambiarla o cerrar la página saca a quien ya
 * había entrado.
 */
export default function EstadisticasParaCompartir({ inicial }: { inicial: EstadoEstadisticas }) {
    const [estado, setEstado] = useState(inicial);
    const [clave, setClave] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [confirmandoCierre, setConfirmandoCierre] = useState(false);
    const [isPending, startTransition] = useTransition();

    const guardar = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setAviso(null);
        startTransition(async () => {
            const res = await setMyClaveEstadisticas(clave);
            if (!res.success) {
                setError(res.error);
                return;
            }
            setAviso(estado.abierta ? 'Clave cambiada. Quien ya había entrado debe escribir la nueva.' : 'Página abierta con esta clave.');
            setEstado({ ...estado, abierta: true, cambiadaEn: res.cambiadaEn, cambiadaPor: res.cambiadaPor });
            setClave('');
        });
    };

    const cerrar = () => {
        setError(null);
        setAviso(null);
        startTransition(async () => {
            const res = await quitarMyClaveEstadisticas();
            setConfirmandoCierre(false);
            if (!res.success) {
                setError(res.error);
                return;
            }
            setAviso('Página cerrada: nadie la puede ver hasta que ponga una clave.');
            setEstado({ ...estado, abierta: false, cambiadaEn: res.cambiadaEn, cambiadaPor: res.cambiadaPor });
        });
    };

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(estado.enlace);
            setAviso('Enlace copiado.');
        } catch {
            setAviso('No se pudo copiar: selecciónelo y cópielo a mano.');
        }
    };

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-xl p-2.5 bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                    <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Estadísticas para compartir</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Una página con lo que AgenIA hace por los pacientes —recordatorios, gestiones por chat, citas
                        agendadas y canceladas, mensajes fuera de horario y asistencia—, sin datos de ningún paciente,
                        para compartir con la gerencia o con quien usted decida. Se actualiza cada día a las 6 a. m. con
                        el día anterior completo.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <p className="text-sm font-semibold text-zinc-900 dark:text-white" role="status">
                    {estado.abierta ? (
                        <span className="text-emerald-600 dark:text-emerald-400">● Abierta con clave</span>
                    ) : (
                        <span className="text-zinc-500">○ Cerrada: nadie la puede ver</span>
                    )}
                </p>

                {estado.abierta && (
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            readOnly
                            aria-label="Enlace de la página"
                            value={estado.enlace}
                            onFocus={(e) => e.target.select()}
                            className="flex-1 min-w-0 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm dark:text-white"
                        />
                        <button
                            type="button"
                            onClick={copiar}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                            <Copy className="w-4 h-4" /> Copiar
                        </button>
                        <a
                            href={estado.ruta}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                            <ExternalLink className="w-4 h-4" /> Abrir
                        </a>
                    </div>
                )}

                <form onSubmit={guardar} className="flex flex-col sm:flex-row sm:items-end gap-2">
                    <label className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            {estado.abierta ? 'Clave nueva' : 'Clave para abrir la página'}
                        </span>
                        <input
                            type="text"
                            value={clave}
                            onChange={(e) => setClave(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={72}
                            placeholder={`Al menos ${CLAVE_ESTADISTICAS.MIN} caracteres`}
                            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={isPending || clave.length === 0}
                        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {isPending ? 'Guardando…' : estado.abierta ? 'Cambiar la clave' : 'Abrir la página'}
                    </button>
                </form>

                <ul className="text-sm text-zinc-500 dark:text-zinc-400 list-disc pl-5 space-y-1">
                    <li>Compártala solo con quien deba ver las estadísticas, junto con el enlace.</li>
                    <li>La clave no se vuelve a mostrar: si la olvida, ponga una nueva.</li>
                    <li>Quien la escribe queda dentro 30 días en ese navegador. Al cambiarla o cerrar la página, todos deben volver a escribirla.</li>
                </ul>

                {estado.abierta &&
                    (confirmandoCierre ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-zinc-700 dark:text-zinc-300">¿Cerrar la página? Nadie podrá verla hasta que ponga una clave.</span>
                            <button
                                type="button"
                                onClick={cerrar}
                                disabled={isPending}
                                className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                                Sí, cerrar
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmandoCierre(false)}
                                className="rounded-lg px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                                Cancelar
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setConfirmandoCierre(true)}
                            className="self-start text-sm font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                        >
                            Cerrar la página
                        </button>
                    ))}
            </div>
            {aviso && <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{aviso}</p>}
            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Error al guardar: {error}
                </p>
            )}
            {estado.cambiadaEn && (
                <p className="mt-2 text-xs text-zinc-400">
                    Último cambio: {estado.cambiadaPor ?? 'desconocido'} · {formatAppointmentCompact(new Date(estado.cambiadaEn))}
                </p>
            )}
        </section>
    );
}

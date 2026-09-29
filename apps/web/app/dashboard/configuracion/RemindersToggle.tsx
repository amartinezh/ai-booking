'use client';

import { useState, useTransition } from 'react';
import { BellRing, BellOff } from 'lucide-react';
import { setMyRemindersEnabled } from '@/app/actions/settings';

/**
 * Interruptor de los recordatorios automáticos de citas. Guarda al instante
 * (no espera al botón «Guardar» del formulario) y el cron lo lee en su
 * siguiente vuelta: no hay que reiniciar nada.
 */
export default function RemindersToggle({ initialEnabled }: { initialEnabled: boolean }) {
    const [enabled, setEnabled] = useState(initialEnabled);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const toggle = () => {
        const next = !enabled;
        setError(null);
        startTransition(async () => {
            const res = await setMyRemindersEnabled(next);
            if (res.success) {
                setEnabled(next);
            } else {
                // El estado visible no cambia: sigue mostrando lo que de verdad
                // quedó guardado.
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div
                    className={`rounded-xl p-2.5 ${
                        enabled
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                    }`}
                >
                    {enabled ? <BellRing className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Recordatorios automáticos de citas</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Mensaje que se le envía al paciente antes de su cita, por WhatsApp o Telegram. El cambio aplica de inmediato.
                    </p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label="Recordatorios automáticos de citas"
                    disabled={isPending}
                    onClick={toggle}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 ${
                        enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                >
                    <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
                <div className="text-sm">
                    <p className="font-semibold text-zinc-900 dark:text-white">
                        {isPending ? 'Guardando…' : enabled ? 'Encendidos' : 'Apagados'}
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400">
                        {enabled
                            ? 'Los pacientes reciben el recordatorio antes de su cita.'
                            : 'No se envía ningún recordatorio automático. Al encenderlos, las citas que aún estén dentro del plazo reciben el suyo.'}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                        El botón de recordatorio manual de la agenda sigue funcionando en ambos casos.
                    </p>
                </div>
            </div>
            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Error al guardar: {error}
                </p>
            )}
        </section>
    );
}

'use client';

import { useState, useTransition } from 'react';
import { Phone } from 'lucide-react';
import { setMyTelefonoSoporte } from '@/app/actions/datos-clinica';
import { alertasLleganPorWhatsapp, validarTelefonoSoporte } from '@/lib/configuracion/telefono-soporte';
import { AvisoSinGuardar, useAvisoAlSalir } from './CambiosSinGuardar';

/**
 * 📞 El teléfono de soporte (docs/PLAN_NAVEGACION.md, N9). Se dice para qué se usa
 * porque de él dependen las alertas de posible emergencia: un celular las recibe
 * por WhatsApp (si ese número le escribió al asistente en las últimas 24 horas: la
 * alerta es texto libre); un fijo se le da al paciente, pero no las recibe.
 */
export default function TelefonoSoporteForm({ inicial }: { inicial: string | null }) {
    const [guardado, setGuardado] = useState(inicial ?? '');
    const [valor, setValor] = useState(inicial ?? '');
    const [error, setError] = useState<string | null>(null);
    const [listo, setListo] = useState(false);
    const [isPending, startTransition] = useTransition();

    const v = validarTelefonoSoporte(valor);
    // Un celular guardado sin indicativo también cuenta como cambio: hay que corregirlo.
    const hayCambios = v.ok ? v.valor !== guardado : valor.trim() !== guardado;
    useAvisoAlSalir(hayCambios);
    const llegan = v.ok ? v.alertasPorWhatsapp : alertasLleganPorWhatsapp(guardado);

    const guardar = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setListo(false);
        startTransition(async () => {
            const res = await setMyTelefonoSoporte(valor);
            if (res.success) {
                setGuardado(res.telefono);
                setValor(res.telefono);
                setListo(true);
                setTimeout(() => setListo(false), 3000);
            } else {
                setError(res.error);
            }
        });
    };

    return (
        <form onSubmit={guardar} className="space-y-4">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-sky-100 p-2.5 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400">
                    <Phone className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Teléfono de soporte</h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        El número que el asistente les da a los pacientes cuando no puede ayudarlos, y al que manda por
                        WhatsApp la alerta de una posible emergencia. Aplica desde el siguiente mensaje.
                    </p>
                </div>
            </div>
            <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <label htmlFor="telefono-soporte" className="mb-1 block text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Teléfono
                </label>
                <input
                    id="telefono-soporte"
                    type="tel"
                    value={valor}
                    maxLength={30}
                    onChange={(e) => {
                        setValor(e.target.value);
                        setError(null);
                    }}
                    placeholder="Ej: 300 123 4567"
                    className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
                {valor.trim() !== '' && v.ok && (
                    <p
                        className={`mt-2 text-sm ${
                            llegan ? 'text-emerald-700 dark:text-emerald-400' : 'font-medium text-amber-700 dark:text-amber-400'
                        }`}
                    >
                        {llegan
                            ? `Se guarda como ${v.valor}. La alerta de posible emergencia sale a este WhatsApp, pero WhatsApp solo la entrega si este número le escribió al asistente en las últimas 24 horas; si no, queda en la Caja Negra.`
                            : `Se guarda como ${v.valor}. No es un celular colombiano: el asistente se lo da a los pacientes, pero las alertas de posible emergencia no llegan por WhatsApp y solo quedan en la Caja Negra.`}
                    </p>
                )}
                {error && (
                    <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                        {error}
                    </p>
                )}
            </div>
            <div className="flex justify-end">
                {listo && <span className="mr-3 self-center text-sm text-emerald-600 dark:text-emerald-400">✓ Guardado</span>}
                <AvisoSinGuardar visible={hayCambios} />
                <button
                    type="submit"
                    disabled={isPending || !hayCambios}
                    className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                    {isPending ? 'Guardando…' : 'Guardar teléfono'}
                </button>
            </div>
        </form>
    );
}

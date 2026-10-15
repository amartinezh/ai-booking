'use client';

import { useState, useTransition } from 'react';
import { CalendarDays, CalendarRange } from 'lucide-react';
import { LIMITE_CITAS, type LimitesCitas } from '@agenia/shared';
import { guardarLimitesCitas } from './actions';

/** «una cita», «2 citas» — igual que el mensaje del asistente. */
const citas = (n: number) => (n === 1 ? 'una cita' : `${n} citas`);

/**
 * Configuración del límite de citas por paciente: un interruptor y un número
 * por cada límite (día y mes). Se guarda con el botón; el asistente lo lee en
 * cada reserva, así que aplica desde el siguiente mensaje.
 */
export default function LimitesCitasForm({
    initial,
    telefonoHospital,
}: {
    initial: LimitesCitas;
    telefonoHospital: string | null;
}) {
    const [limites, setLimites] = useState<LimitesCitas>(initial);
    const [guardado, setGuardado] = useState<LimitesCitas>(initial);
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState(false);
    const [isPending, startTransition] = useTransition();

    const cambiado =
        limites.diaActivo !== guardado.diaActivo ||
        limites.maxDia !== guardado.maxDia ||
        limites.mesActivo !== guardado.mesActivo ||
        limites.maxMes !== guardado.maxMes;

    const guardar = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setOk(false);
        startTransition(async () => {
            const res = await guardarLimitesCitas(limites);
            if (res.success) {
                setLimites(res.limites);
                setGuardado(res.limites);
                setOk(true);
                setTimeout(() => setOk(false), 3000);
            } else {
                setError(res.error);
            }
        });
    };

    const contacto = telefonoHospital ? `el hospital al *${telefonoHospital}*` : 'el hospital';

    return (
        <form onSubmit={guardar} className="space-y-8">
            <LimiteCard
                icono={<CalendarDays className="w-5 h-5" />}
                titulo="Citas por paciente en un mismo día"
                descripcion="Cuántas citas puede tener un paciente para el mismo día. Cuentan todas sus citas vigentes de ese día, también las que agendó el hospital o el personal."
                activo={limites.diaActivo}
                valor={limites.maxDia}
                max={LIMITE_CITAS.MAX_DIA}
                recomendado={LIMITE_CITAS.DEFAULT_DIA}
                unidad="por día"
                onActivo={(diaActivo) => setLimites({ ...limites, diaActivo })}
                onValor={(maxDia) => setLimites({ ...limites, maxDia })}
                ejemplo={
                    `Lamentamos no poder agendarle esta cita por este medio. 🙏\n\n` +
                    `Por disposición de la institución, cada paciente puede tener máximo *${citas(limites.maxDia)}* el mismo día, ` +
                    `y usted ya tiene *${citas(limites.maxDia)}* para el *martes, 20 de octubre de 2026*.\n\n` +
                    `Si necesita atención adicional, por favor comuníquese con ${contacto}.\n\n` +
                    `Si considera que requiere más citas de las permitidas, puede elevar una *solicitud de revisión* en este enlace seguro…`
                }
            />

            <LimiteCard
                icono={<CalendarRange className="w-5 h-5" />}
                titulo="Citas por paciente en un mismo mes"
                descripcion="Cuántas citas puede tener un paciente en un mismo mes del calendario (del 1 al último día), contadas por la fecha de la cita."
                activo={limites.mesActivo}
                valor={limites.maxMes}
                max={LIMITE_CITAS.MAX_MES}
                recomendado={LIMITE_CITAS.DEFAULT_MES}
                unidad="por mes"
                onActivo={(mesActivo) => setLimites({ ...limites, mesActivo })}
                onValor={(maxMes) => setLimites({ ...limites, maxMes })}
                ejemplo={
                    `Lamentamos no poder agendarle esta cita por este medio. 🙏\n\n` +
                    `Por disposición de la institución, cada paciente puede tener máximo *${citas(limites.maxMes)}* en un mismo mes, ` +
                    `y usted ya tiene *${citas(limites.maxMes)}* en *octubre de 2026*.\n\n` +
                    `Si necesita atención adicional, por favor comuníquese con ${contacto}.\n\n` +
                    `Si considera que requiere más citas de las permitidas, puede elevar una *solicitud de revisión* en este enlace seguro…`
                }
            />

            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                {error && (
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400 sm:mr-auto">
                        Error al guardar: {error}
                    </p>
                )}
                {ok && (
                    <p role="status" className="text-sm font-medium text-emerald-600 dark:text-emerald-400 sm:mr-auto">
                        ✓ Guardado. El asistente lo aplica desde el siguiente mensaje.
                    </p>
                )}
                <button
                    type="submit"
                    disabled={isPending || !cambiado}
                    className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                    {isPending ? 'Guardando…' : 'Guardar cambios'}
                </button>
            </div>
        </form>
    );
}

function LimiteCard({
    icono,
    titulo,
    descripcion,
    activo,
    valor,
    max,
    recomendado,
    unidad,
    onActivo,
    onValor,
    ejemplo,
}: {
    icono: React.ReactNode;
    titulo: string;
    descripcion: string;
    activo: boolean;
    valor: number;
    max: number;
    recomendado: number;
    unidad: string;
    onActivo: (v: boolean) => void;
    onValor: (v: number) => void;
    ejemplo: string;
}) {
    const id = titulo.replace(/\W+/g, '-').toLowerCase();
    return (
        <section>
            <div className="mb-4 flex items-start gap-3">
                <div
                    className={`rounded-xl p-2.5 ${
                        activo
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                    }`}
                >
                    {icono}
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{titulo}</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{descripcion}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={activo}
                            aria-label={titulo}
                            onClick={() => onActivo(!activo)}
                            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 ${
                                activo ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
                            }`}
                        >
                            <span
                                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                    activo ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                        <div className="text-sm">
                            <p className="font-semibold text-zinc-900 dark:text-white">{activo ? 'Encendido' : 'Apagado'}</p>
                            <p className="text-zinc-500 dark:text-zinc-400">
                                {activo
                                    ? `El asistente no asigna más de ${citas(valor)} ${unidad} a un mismo paciente.`
                                    : `Sin límite ${unidad}: el asistente no revisa cuántas citas tiene el paciente.`}
                            </p>
                        </div>
                    </div>

                    <div className={activo ? '' : 'opacity-50'}>
                        <label htmlFor={id} className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                            Máximo de citas {unidad}
                        </label>
                        <input
                            id={id}
                            type="number"
                            required
                            min={LIMITE_CITAS.MIN}
                            max={max}
                            step={1}
                            disabled={!activo}
                            value={valor}
                            onChange={(e) => {
                                const n = Number(e.target.value);
                                if (Number.isFinite(n)) onValor(n);
                            }}
                            className="w-32 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white disabled:cursor-not-allowed"
                        />
                        <p className="text-xs text-zinc-400 mt-1.5">
                            Entre {LIMITE_CITAS.MIN} y {max}. Valor inicial: {recomendado}.
                        </p>
                    </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                        Mensaje que recibe el paciente
                    </p>
                    <div className="rounded-xl bg-green-50 dark:bg-green-900/10 border border-green-200/60 dark:border-green-800/40 px-4 py-3 text-xs text-zinc-700 dark:text-zinc-200 whitespace-pre-line leading-relaxed">
                        {activo ? ejemplo : 'Con el límite apagado, el asistente agenda sin revisar cuántas citas tiene el paciente.'}
                    </div>
                </div>
            </div>
        </section>
    );
}

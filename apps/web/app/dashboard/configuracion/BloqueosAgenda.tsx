'use client';

import { useMemo, useState, useTransition } from 'react';
import { CalendarX, ChevronLeft, ChevronRight, Clock, Info, Repeat, Trash2 } from 'lucide-react';
import {
    DIAS_SEMANA,
    MESES,
    describirBloqueoAgenda,
    diaDeLaSemana,
    fechaEnPalabras,
    horaEnPalabras,
    partesDeFecha,
    proximasFechasDelBloqueo,
    type ReglaBloqueoAgenda,
} from '@agenia/shared';
import {
    crearBloqueoAgenda,
    quitarBloqueoAgenda,
    type BloqueoAgendaVista,
    type BloqueosAgendaEstado,
    type ResultadoBloqueos,
} from '@/app/actions/bloqueos-agenda';
import {
    DIAS_CORTOS,
    minutosDeHora,
    moverMes,
    rangoCorto,
    semanasDelMes,
    type DiaDelCalendario,
} from '@/lib/bloqueos-agenda/calendario';

/** Hasta cuántos meses adelante se puede navegar. */
const MESES_ADELANTE = 24;

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** «sábado» → «sábados»; «lunes» se queda igual. */
const plural = (dia: string) => (dia.endsWith('s') ? dia : `${dia}s`);
/** «24 oct.» */
const fechaCorta = (fecha: string) => {
    const p = partesDeFecha(fecha);
    return p ? `${p[2]} ${MESES[p[1] - 1].slice(0, 3)}.` : fecha;
};

/** La frase que resume lo que se va a guardar. */
function resumen(r: ReglaBloqueoAgenda): { cuando: string; horario: string; desde: string } {
    const dia = DIAS_SEMANA[diaDeLaSemana(r.date)];
    return {
        cuando: r.repeatWeekly ? `todos los ${plural(dia)}` : `el ${fechaEnPalabras(r.date)}`,
        horario:
            r.startMinute == null || r.endMinute == null
                ? 'todo el día'
                : `de ${horaEnPalabras(r.startMinute)} a ${horaEnPalabras(r.endMinute)}`,
        desde: r.repeatWeekly ? `, a partir del ${fechaEnPalabras(r.date)}` : '',
    };
}

/**
 * 📅 Días sin citas: el administrador elige en un calendario los días (o las horas
 * de un día) para los que el asistente no ofrecerá citas, una vez o cada semana.
 * La regla la aplica la API (packages/shared/src/bloqueos-agenda.ts).
 */
export default function BloqueosAgenda({ inicial }: { inicial: BloqueosAgendaEstado }) {
    const [hoy, setHoy] = useState(inicial.hoy);
    const [bloqueos, setBloqueos] = useState<BloqueoAgendaVista[]>(inicial.bloqueos);
    const [vista, setVista] = useState(() => {
        const [anio, mes] = partesDeFecha(inicial.hoy)!;
        return { anio, mes };
    });
    const [seleccion, setSeleccion] = useState<string | null>(null);
    const [modo, setModo] = useState<'dia' | 'horas'>('dia');
    const [desde, setDesde] = useState('08:00');
    const [hasta, setHasta] = useState('10:00');
    const [repetir, setRepetir] = useState(false);
    const [nota, setNota] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [listo, setListo] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const semanas = useMemo(
        () => semanasDelMes(vista.anio, vista.mes, hoy, bloqueos),
        [vista, hoy, bloqueos],
    );
    const [anioHoy, mesHoy] = partesDeFecha(hoy)!;
    const esMesActual = vista.anio === anioHoy && vista.mes === mesHoy;
    const limite = moverMes(anioHoy, mesHoy, MESES_ADELANTE);
    const esUltimoMes = vista.anio === limite.anio && vista.mes === limite.mes;

    const inicio = modo === 'horas' ? minutosDeHora(desde) : null;
    const fin = modo === 'horas' ? minutosDeHora(hasta) : null;
    const errorHoras =
        modo !== 'horas'
            ? null
            : inicio == null || fin == null
              ? 'Indique la hora inicial y la hora final.'
              : fin <= inicio
                ? 'La hora final debe ser después de la hora inicial.'
                : null;
    const borrador: ReglaBloqueoAgenda | null =
        seleccion && !errorHoras
            ? { date: seleccion, repeatWeekly: repetir, startMinute: inicio, endMinute: fin }
            : null;
    const delDiaElegido = seleccion ? semanas.flat().find((d) => d.fecha === seleccion)?.reglas ?? [] : [];

    const aplicar = (r: ResultadoBloqueos, mensaje: string) => {
        if (r.success) {
            setBloqueos(r.bloqueos);
            setHoy(r.hoy);
            setListo(mensaje);
            setError(null);
            return true;
        }
        setError(r.error);
        setListo(null);
        return false;
    };

    const elegir = (dia: DiaDelCalendario) => {
        if (dia.pasado) return;
        setSeleccion(dia.fecha);
        setError(null);
        setListo(null);
        if (!dia.delMes) {
            const [anio, mes] = partesDeFecha(dia.fecha)!;
            setVista({ anio, mes });
        }
    };

    const guardar = () => {
        if (!borrador) return;
        startTransition(async () => {
            const ok = aplicar(
                await crearBloqueoAgenda({ ...borrador, note: nota.trim() || null }),
                'Listo. El asistente ya no ofrecerá esas citas.',
            );
            if (ok) {
                setModo('dia');
                setRepetir(false);
                setNota('');
            }
        });
    };

    const quitar = (b: BloqueoAgendaVista) => {
        const d = describirBloqueoAgenda(b);
        if (!window.confirm(`¿Quitar «${d.cuando} · ${d.horario}»?\n\nEl asistente volverá a ofrecer esas citas.`)) return;
        startTransition(async () => {
            aplicar(await quitarBloqueoAgenda(b.id), 'Listo. El asistente vuelve a ofrecer esas citas.');
        });
    };

    const diaElegido = seleccion ? DIAS_SEMANA[diaDeLaSemana(seleccion)] : '';
    const frase = borrador ? resumen(borrador) : null;

    return (
        <div className="space-y-8">
            <header>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                    <CalendarX className="w-6 h-6 text-rose-600" aria-hidden /> Días sin citas por el asistente
                </h2>
                <div className="mt-3 flex gap-3 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20 p-4 text-sm text-indigo-900 dark:text-indigo-200">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
                    <p className="leading-relaxed">
                        Elija en el calendario los días, o las horas de un día, para los que el asistente{' '}
                        <strong>no ofrecerá citas</strong> por WhatsApp ni Telegram. Puede repetirlo cada semana. Las citas
                        ya agendadas no cambian, y los agendadores pueden seguir agendando esos días desde el panel y en el
                        sistema del hospital.
                    </p>
                </div>
            </header>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                {/* ── Calendario ── */}
                <section aria-label="Calendario" className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-4">
                        <button
                            type="button"
                            onClick={() => setVista(moverMes(vista.anio, vista.mes, -1))}
                            disabled={esMesActual}
                            aria-label="Mes anterior"
                            className="p-2 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div className="text-center">
                            <p className="text-lg font-bold text-zinc-900 dark:text-white" aria-live="polite">
                                {mayuscula(MESES[vista.mes - 1])} {vista.anio}
                            </p>
                            {!esMesActual && (
                                <button
                                    type="button"
                                    onClick={() => setVista({ anio: anioHoy, mes: mesHoy })}
                                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                    Volver a hoy
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => setVista(moverMes(vista.anio, vista.mes, 1))}
                            disabled={esUltimoMes}
                            aria-label="Mes siguiente"
                            className="p-2 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                        {DIAS_CORTOS.map((d) => (
                            <div
                                key={d}
                                className="pb-1 text-center text-[11px] font-bold uppercase tracking-wide text-zinc-400"
                            >
                                {d}
                            </div>
                        ))}
                        {semanas.flat().map((dia) => {
                            const elegido = dia.fecha === seleccion;
                            const etiqueta =
                                dia.estado === 'completo'
                                    ? 'sin citas todo el día'
                                    : dia.estado === 'parcial'
                                      ? `sin citas de ${dia.reglas.map(rangoCorto).join(', ')}`
                                      : 'con citas';
                            const color =
                                dia.estado === 'completo'
                                    ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
                                    : dia.estado === 'parcial'
                                      ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800'
                                      : 'bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10';
                            return (
                                <button
                                    key={dia.fecha}
                                    type="button"
                                    onClick={() => elegir(dia)}
                                    disabled={dia.pasado}
                                    aria-pressed={elegido}
                                    aria-label={`${fechaEnPalabras(dia.fecha)}${dia.hoy ? ' (hoy)' : ''}: ${dia.pasado ? 'ya pasó' : etiqueta}`}
                                    className={`relative flex min-h-[52px] sm:min-h-[64px] flex-col items-center justify-start rounded-xl border p-1 sm:p-1.5 text-sm transition-all ${color}
                                        ${dia.delMes ? '' : 'opacity-50'}
                                        ${dia.pasado ? 'cursor-not-allowed !bg-zinc-50 dark:!bg-zinc-900/40 !text-zinc-300 dark:!text-zinc-600 !border-zinc-100 dark:!border-zinc-800' : 'cursor-pointer'}
                                        ${elegido ? 'ring-2 ring-indigo-600 ring-offset-1 dark:ring-offset-zinc-900' : ''}`}
                                >
                                    <span className={`font-semibold ${dia.hoy ? 'flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white' : ''}`}>
                                        {dia.dia}
                                    </span>
                                    {!dia.pasado && dia.estado !== 'libre' && (
                                        <span className="mt-0.5 hidden sm:block text-[10px] font-semibold leading-tight text-center">
                                            {dia.estado === 'completo'
                                                ? 'Sin citas'
                                                : dia.reglas.length > 1
                                                  ? `${rangoCorto(dia.reglas[0])} +${dia.reglas.length - 1}`
                                                  : rangoCorto(dia.reglas[0])}
                                        </span>
                                    )}
                                    {!dia.pasado && dia.estado !== 'libre' && (
                                        <span
                                            aria-hidden
                                            className={`sm:hidden mt-1 h-1.5 w-1.5 rounded-full ${dia.estado === 'completo' ? 'bg-rose-500' : 'bg-amber-500'}`}
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <li className="flex items-center gap-1.5">
                            <span className="h-3 w-3 rounded bg-rose-100 border border-rose-300" /> Sin citas todo el día
                        </li>
                        <li className="flex items-center gap-1.5">
                            <span className="h-3 w-3 rounded bg-amber-50 border border-amber-300" /> Sin citas algunas horas
                        </li>
                        <li className="flex items-center gap-1.5">
                            <span className="h-3 w-3 rounded-full bg-indigo-600" /> Hoy
                        </li>
                    </ul>
                </section>

                {/* ── El día elegido ── */}
                <section
                    aria-label="Bloquear el día elegido"
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 bg-zinc-50/60 dark:bg-zinc-900/40"
                >
                    {!seleccion ? (
                        <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center text-zinc-500 dark:text-zinc-400">
                            <CalendarX className="w-10 h-10 mb-3 text-zinc-300 dark:text-zinc-600" aria-hidden />
                            <p className="font-semibold text-zinc-700 dark:text-zinc-300">Elija un día en el calendario</p>
                            <p className="mt-1 text-sm">Luego decida si bloquea todo el día o solo unas horas, y si se repite cada semana.</p>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">Día elegido</p>
                                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
                                    {mayuscula(fechaEnPalabras(seleccion))}
                                </h3>
                            </div>

                            {delDiaElegido.length > 0 && (
                                <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 p-3 text-sm">
                                    <p className="font-semibold text-rose-800 dark:text-rose-200 mb-1">Este día ya tiene:</p>
                                    <ul className="space-y-1 text-rose-900 dark:text-rose-100">
                                        {delDiaElegido.map((b) => {
                                            const d = describirBloqueoAgenda(b);
                                            return (
                                                <li key={b.id}>
                                                    {d.cuando} · {d.horario.toLowerCase()}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            )}

                            <fieldset>
                                <legend className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">¿Qué quiere bloquear?</legend>
                                <div className="grid grid-cols-2 gap-2">
                                    {(
                                        [
                                            ['dia', 'Todo el día', 'Ninguna cita ese día', CalendarX],
                                            ['horas', 'Unas horas', 'Por ejemplo, de 8 a 10 a. m.', Clock],
                                        ] as const
                                    ).map(([valor, titulo, detalle, Icono]) => (
                                        <label
                                            key={valor}
                                            className={`cursor-pointer rounded-xl border-2 p-3 transition-all ${
                                                modo === valor
                                                    ? 'border-indigo-600 bg-white dark:bg-zinc-900 shadow-sm'
                                                    : 'border-zinc-200 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/40 hover:border-indigo-300'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="modo-bloqueo"
                                                value={valor}
                                                checked={modo === valor}
                                                onChange={() => setModo(valor)}
                                                className="sr-only"
                                            />
                                            <Icono className={`w-5 h-5 mb-1 ${modo === valor ? 'text-indigo-600' : 'text-zinc-400'}`} aria-hidden />
                                            <span className="block text-sm font-bold text-zinc-900 dark:text-white">{titulo}</span>
                                            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{detalle}</span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>

                            {modo === 'horas' && (
                                <div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <label className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            Desde
                                            <input
                                                type="time"
                                                step={300}
                                                value={desde}
                                                onChange={(e) => setDesde(e.target.value)}
                                                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                                            />
                                        </label>
                                        <label className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                            Hasta
                                            <input
                                                type="time"
                                                step={300}
                                                value={hasta}
                                                onChange={(e) => setHasta(e.target.value)}
                                                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                                            />
                                        </label>
                                    </div>
                                    {errorHoras ? (
                                        <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-400">{errorHoras}</p>
                                    ) : (
                                        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                                            No se ofrecen las citas que empiecen desde las {horaEnPalabras(inicio!)} y antes de las{' '}
                                            {horaEnPalabras(fin!)}.
                                        </p>
                                    )}
                                </div>
                            )}

                            <label className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={repetir}
                                    onChange={(e) => setRepetir(e.target.checked)}
                                    className="mt-0.5 h-5 w-5 rounded accent-indigo-600"
                                />
                                <span>
                                    <span className="flex items-center gap-1.5 text-sm font-bold text-zinc-900 dark:text-white">
                                        <Repeat className="w-4 h-4 text-indigo-600" aria-hidden /> Repetir todos los {plural(diaElegido)}
                                    </span>
                                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                        Desde este día en adelante, hasta que lo quite.
                                    </span>
                                </span>
                            </label>

                            <label className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                Motivo <span className="font-normal text-zinc-400">(opcional)</span>
                                <input
                                    type="text"
                                    value={nota}
                                    maxLength={120}
                                    onChange={(e) => setNota(e.target.value)}
                                    placeholder="Ej.: Sábados sin agendamiento por el asistente"
                                    className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-normal dark:text-white"
                                />
                            </label>

                            {frase && (
                                <p
                                    data-testid="resumen-bloqueo"
                                    className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3 text-sm text-zinc-700 dark:text-zinc-300"
                                    aria-live="polite"
                                >
                                    El asistente <strong>no ofrecerá citas</strong> <strong>{frase.cuando}</strong>,{' '}
                                    <strong>{frase.horario}</strong>
                                    {frase.desde}.
                                </p>
                            )}

                            {error && (
                                <p role="alert" className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                                    {error}
                                </p>
                            )}

                            <button
                                type="button"
                                onClick={guardar}
                                disabled={!borrador || isPending}
                                className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 transition-colors"
                            >
                                {isPending ? 'Guardando…' : 'Bloquear'}
                            </button>
                        </div>
                    )}
                    {listo && (
                        <p role="status" className="mt-4 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                            ✓ {listo}
                        </p>
                    )}
                </section>
            </div>

            {/* ── Lo que está bloqueado ── */}
            <section aria-label="Bloqueos activos">
                <h3 className="mb-3 text-base font-bold text-zinc-900 dark:text-white">
                    Bloqueos activos {bloqueos.length > 0 && <span className="text-zinc-400 font-semibold">({bloqueos.length})</span>}
                </h3>
                {bloqueos.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
                        No hay días ni horas bloqueados: el asistente ofrece todas las citas disponibles.
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {bloqueos.map((b) => {
                            const d = describirBloqueoAgenda(b);
                            const proximas = b.repeatWeekly ? proximasFechasDelBloqueo(b, hoy, 3) : [];
                            return (
                                <li
                                    key={b.id}
                                    className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:flex-row sm:items-center"
                                >
                                    <span
                                        className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
                                            b.repeatWeekly
                                                ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                                        }`}
                                    >
                                        {b.repeatWeekly ? <Repeat className="w-3.5 h-3.5" aria-hidden /> : <CalendarX className="w-3.5 h-3.5" aria-hidden />}
                                        {b.repeatWeekly ? 'Cada semana' : 'Un día'}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-zinc-900 dark:text-white">
                                            {d.cuando} · <span className={b.startMinute == null ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}>{d.horario}</span>
                                        </p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {[
                                                d.desde,
                                                proximas.length > 0 ? `Próximos: ${proximas.map(fechaCorta).join(', ')}` : null,
                                                b.note ? `Motivo: ${b.note}` : null,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => quitar(b)}
                                        disabled={isPending}
                                        aria-label={`Quitar ${d.cuando} · ${d.horario}`}
                                        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-900 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" aria-hidden /> Quitar
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}

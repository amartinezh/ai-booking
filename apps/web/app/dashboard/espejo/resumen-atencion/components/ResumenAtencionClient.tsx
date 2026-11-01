'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LIMITES_RESUMEN_ATENCION } from '@agenia/shared';
import { formatAppointmentCompact } from '@/lib/date';
import { updateLecturaResumenAction, type PanelResumenAtencion } from '@/app/actions/resumen-atencion';
import RevisionResumenes from './RevisionResumenes';

const CANALES = [
    { clave: 'WHATSAPP', nombre: 'WhatsApp' },
    { clave: 'TELEGRAM', nombre: 'Telegram' },
    { clave: 'EMAIL', nombre: 'Correo' },
] as const;

/** 850 → «850 ms»; 2400 → «2,4 s». */
function duracion(ms: number): string {
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Los interruptores del resumen de la atención (plan §3.11). En la Fase 1 solo
 * se prende la LECTURA en sombra: «Enviar» y los canales se muestran apagados y
 * sin poderse tocar, porque el envío todavía no existe.
 */
export default function ResumenAtencionClient({ panel }: { panel: PanelResumenAtencion }) {
    const router = useRouter();
    const [guardando, startGuardando] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);

    const [leer, setLeer] = useState(panel.config.leerDelHospital);
    const [seLeen, setSeLeen] = useState<Set<string>>(
        () => new Set(panel.servicios.filter((s) => s.seLee).map((s) => s.codigo)),
    );
    const [calma, setCalma] = useState(String(panel.config.calmaMinutos));

    const hayCambios = useMemo(() => {
        const antes = panel.servicios.filter((s) => s.seLee).map((s) => s.codigo).sort().join(',');
        return (
            leer !== panel.config.leerDelHospital ||
            [...seLeen].sort().join(',') !== antes ||
            calma !== String(panel.config.calmaMinutos)
        );
    }, [leer, seLeen, calma, panel]);

    const alternar = (codigo: string) =>
        setSeLeen((prev) => {
            const s = new Set(prev);
            if (s.has(codigo)) s.delete(codigo);
            else s.add(codigo);
            return s;
        });

    const guardar = () => {
        setError(null);
        setAviso(null);
        startGuardando(async () => {
            const r = await updateLecturaResumenAction({
                leerDelHospital: leer,
                serviciosALeer: [...seLeen],
                calmaMinutos: Number(calma),
            });
            if (!r.success) {
                setError(r.error);
                return;
            }
            setAviso('Guardado. El agente lo toma en su próxima vuelta (cada 5 minutos).');
            router.refresh();
        });
    };

    const L = LIMITES_RESUMEN_ATENCION;
    const leyendo = panel.config.leerDelHospital && Object.keys(panel.config.servicios).length > 0;

    return (
        <div className="space-y-6">
            <header className="space-y-2">
                <Link href="/dashboard/espejo" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                    ← Espejo con el HIS
                </Link>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Resumen de la atención</h1>
                <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
                    Cuando el médico termina la historia en el sistema del hospital, el paciente recibirá el resumen de su
                    consulta, su fórmula y sus órdenes. Por ahora solo existe la <strong>lectura en sombra</strong>: AgenIA lee
                    las historias terminadas y las guarda cifradas 30 días para revisarlas.{' '}
                    <strong>No se le envía nada a ningún paciente.</strong>
                </p>
                <p className="text-sm font-medium" data-testid="estado-lectura">
                    {leyendo ? (
                        <span className="text-emerald-700 dark:text-emerald-400">● Leyendo del hospital</span>
                    ) : (
                        <span className="text-zinc-500">○ Apagado: no se lee nada del hospital</span>
                    )}
                </p>
            </header>

            <section className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Interruptores generales</h2>
                <label className="flex items-start gap-3 text-sm text-zinc-800 dark:text-zinc-200">
                    <input
                        type="checkbox"
                        checked={leer}
                        onChange={(e) => setLeer(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                        aria-label="Leer del hospital"
                    />
                    <span>
                        <span className="font-medium">Leer del hospital</span>
                        <span className="block text-xs text-zinc-500">
                            El agente lee las historias terminadas de los servicios marcados abajo. Apagado, no consulta la
                            historia clínica del hospital.
                        </span>
                    </span>
                </label>
                <label className="flex items-start gap-3 text-sm text-zinc-400">
                    <input type="checkbox" checked={false} disabled className="mt-0.5 h-4 w-4 rounded" aria-label="Enviar a pacientes" />
                    <span>
                        <span className="font-medium">Enviar a pacientes</span>
                        <span className="block text-xs">
                            Todavía no existe: se habilita cuando estén listos los documentos y los envíos. Nace apagado.
                        </span>
                    </span>
                </label>
                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                    Calma antes de leer una historia (minutos)
                    <input
                        type="number"
                        min={L.calmaMinutosMin}
                        max={L.calmaMinutosMax}
                        value={calma}
                        onChange={(e) => setCalma(e.target.value)}
                        className="mt-1 block w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        aria-label="Calma en minutos"
                    />
                    <span className="mt-1 block text-xs text-zinc-500">
                        El hospital escribe las órdenes en los minutos siguientes a guardar la historia (la última vista: 116
                        minutos). Con {L.calmaMinutosPorDefecto} minutos ya están todas.
                    </span>
                </label>
            </section>

            <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div>
                    <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Servicios del hospital</h2>
                    <p className="text-xs text-zinc-500">
                        Marque los servicios que se leen. Los canales de envío quedan apagados hasta que exista el envío.
                    </p>
                </div>
                {panel.servicios.length === 0 ? (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                        El agente todavía no ha subido el catálogo de servicios del hospital.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                                    <th className="py-2 pr-3 font-medium">Servicio</th>
                                    <th className="py-2 pr-3 font-medium">Se lee</th>
                                    {CANALES.map((c) => (
                                        <th key={c.clave} className="py-2 pr-3 font-medium text-zinc-400">
                                            {c.nombre}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {panel.servicios.map((s) => (
                                    <tr key={s.codigo} className="border-b border-zinc-100 dark:border-zinc-900">
                                        <td className="py-2 pr-3">
                                            <span className="font-mono text-xs text-zinc-500">{s.codigo}</span>{' '}
                                            <span className="text-zinc-800 dark:text-zinc-200">{s.nombre}</span>
                                        </td>
                                        <td className="py-2 pr-3">
                                            <input
                                                type="checkbox"
                                                checked={seLeen.has(s.codigo)}
                                                onChange={() => alternar(s.codigo)}
                                                aria-label={`Leer ${s.codigo}`}
                                                className="h-4 w-4 rounded border-zinc-300"
                                            />
                                        </td>
                                        {CANALES.map((c) => (
                                            <td key={c.clave} className="py-2 pr-3">
                                                <input type="checkbox" checked={false} disabled aria-label={`${c.nombre} ${s.codigo}`} className="h-4 w-4 rounded" />
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={guardar}
                    disabled={!hayCambios || guardando}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                >
                    {guardando ? 'Guardando…' : 'Guardar'}
                </button>
                {error && <span className="text-sm text-red-600">{error}</span>}
                {aviso && <span className="text-sm text-emerald-700 dark:text-emerald-400">{aviso}</span>}
            </div>

            <section className="space-y-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Lo que se ha leído</h2>
                <p className="text-zinc-600 dark:text-zinc-400">
                    {panel.lectura.recibidos24h} resumen(es) en las últimas 24 horas · {panel.lectura.recibidos30d} en 30 días
                    {panel.lectura.ultimoRecibidoIso && <> · el último, {formatAppointmentCompact(new Date(panel.lectura.ultimoRecibidoIso))}</>}
                </p>
                {panel.lectura.porServicio.length > 0 && (
                    <p className="text-xs text-zinc-500">
                        Por servicio: {panel.lectura.porServicio.map((p) => `${p.servicio} ${p.cantidad}`).join(' · ')}
                    </p>
                )}
                <p className="text-xs text-zinc-500">
                    Leído hasta la historia {panel.lectura.cursor ?? '— (empieza por las de las últimas horas al encender)'}. El
                    contenido se guarda cifrado y se borra a los {L.retencionContenidoDias} días; solo se ve al abrir un
                    resumen para revisarlo.
                </p>
                <div className="space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-800" data-testid="medicion">
                    <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Cuánto tardan las consultas al hospital (último día)
                    </h3>
                    {panel.medicion ? (
                        <>
                            <p className="text-zinc-600 dark:text-zinc-400">
                                {panel.medicion.vueltas} vuelta(s), {panel.medicion.historias} historia(s) leída(s). Buscar las
                                terminadas: {duracion(panel.medicion.detectar.medianaMs)} de mediana, máximo{' '}
                                {duracion(panel.medicion.detectar.maxMs)}.
                                {panel.medicion.leer && (
                                    <>
                                        {' '}
                                        Leerlas: {duracion(panel.medicion.leer.medianaPorHistoriaMs)} por historia, máximo{' '}
                                        {duracion(panel.medicion.leer.maxMs)} en una vuelta.
                                    </>
                                )}
                            </p>
                            <p className="text-xs text-zinc-500">
                                Última vuelta medida: {formatAppointmentCompact(new Date(panel.medicion.ultimaIso))}.
                            </p>
                        </>
                    ) : (
                        <p className="text-xs text-zinc-500">
                            Todavía no hay mediciones: aparecen cuando el agente lee con «Leer del hospital» encendido.
                        </p>
                    )}
                </div>
            </section>

            <RevisionResumenes revision={panel.revision} />
        </div>
    );
}

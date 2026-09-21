'use client';

import { useEffect, useRef, useState } from 'react';
import { formatAppointmentShort, formatDateShort, formatTimeOnly } from '@/lib/date';
import { progresoConsultaHisAction } from '@/app/actions/rastreo';
import type { CitaHisMostrada, ConsultaHisIniciada, HisEnVivoVista, Resultado } from '@/lib/rastreo/tipos';

/**
 * Consulta en vivo al HIS (docs/PLAN_RASTREO_PACIENTE.md §7).
 *
 * AgenIA sola solo sabe lo que ella misma registró. Este panel le pregunta al
 * hospital, por el agente instalado allá, qué tiene AHORA: si la cita existe y a
 * nombre de quién. Tarda unos segundos (la petición espera al agente), así que la
 * pantalla la sondea y, cuando llega, reabre el expediente para que los veredictos
 * usen lo que respondió el hospital.
 *
 * La pantalla no decide si se puede: el servidor dice `puede` y, si no, `razon`
 * (ya escrita para quien atiende). Lo que respondió el HIS no se guarda: al salir
 * de la pantalla hay que volver a consultar.
 */

const ESTADO_HIS: Record<CitaHisMostrada['estado'], string> = {
    SCHEDULED: 'vigente',
    ATTENDED: 'atendida',
    NO_SHOW: 'inasistencia registrada',
    OTHER: 'estado no reconocido',
};

const MSG_TIEMPO = 'El hospital no respondió a tiempo. Puede que el agente esté ocupado: intenta de nuevo en un momento.';
const BOTON =
    'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400';

type Fase =
    | { tipo: 'REPOSO' }
    | { tipo: 'INICIANDO' }
    | { tipo: 'ESPERANDO' }
    | { tipo: 'APLICANDO' }
    | { tipo: 'ERROR'; mensaje: string };

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ConsultaHisProps {
    vista: HisEnVivoVista;
    /** SUPER_ADMIN: la clínica elegida. Los demás roles, `null` (el servidor usa la de su sesión). */
    organizationId: string | null;
    zonaHoraria: string;
    /** Pide la consulta con el motivo y los datos que ya tiene la pantalla. */
    iniciar: () => Promise<Resultado<ConsultaHisIniciada>>;
    /** Reabre el expediente con lo que respondió el HIS. Devuelve un mensaje si falló, `null` si salió bien. */
    aplicar: (ids: string[]) => Promise<string | null>;
    /** Cada cuánto se pregunta cómo va. Solo se cambia en pruebas. */
    intervaloMs?: number;
}

export default function ConsultaHis({
    vista,
    organizationId,
    zonaHoraria,
    iniciar,
    aplicar,
    intervaloMs = 1_500,
}: ConsultaHisProps) {
    const [fase, setFase] = useState<Fase>({ tipo: 'REPOSO' });
    // Si la pantalla se cierra a media espera, el bucle de sondeo se detiene solo.
    const montado = useRef(true);
    useEffect(() => {
        montado.current = true;
        return () => {
            montado.current = false;
        };
    }, []);

    if (!vista.visible) return null;

    const ocupado = fase.tipo === 'INICIANDO' || fase.tipo === 'ESPERANDO' || fase.tipo === 'APLICANDO';
    const puede = vista.disponibilidad.puede && !ocupado;

    const consultar = async () => {
        setFase({ tipo: 'INICIANDO' });
        const inicio = await iniciar();
        if (!montado.current) return;
        if (!inicio.success) return setFase({ tipo: 'ERROR', mensaje: inicio.error });

        setFase({ tipo: 'ESPERANDO' });
        const { ids, esperaMs } = inicio.data;
        const limite = Date.now() + esperaMs;
        for (;;) {
            await pausa(intervaloMs);
            if (!montado.current) return;
            const r = await progresoConsultaHisAction({ organizationId, ids });
            if (!montado.current) return;
            if (!r.success) return setFase({ tipo: 'ERROR', mensaje: r.error });
            if (r.data.estado === 'FALLIDA') {
                return setFase({ tipo: 'ERROR', mensaje: r.data.detalle ?? 'El hospital no respondió a la consulta.' });
            }
            if (r.data.estado === 'LISTA') {
                setFase({ tipo: 'APLICANDO' });
                const error = await aplicar(ids);
                if (!montado.current) return;
                return setFase(error ? { tipo: 'ERROR', mensaje: error } : { tipo: 'REPOSO' });
            }
            if (Date.now() >= limite) return setFase({ tipo: 'ERROR', mensaje: MSG_TIEMPO });
        }
    };

    const consulta = vista.consulta;

    return (
        <section aria-labelledby="consulta-his-titulo" className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 md:p-5 dark:border-sky-900 dark:bg-sky-950/20">
            <h3 id="consulta-his-titulo" className="text-base font-semibold text-zinc-900 dark:text-white">
                Consulta en vivo al HIS
            </h3>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                {consulta
                    ? `Lo que el hospital respondió a las ${formatTimeOnly(consulta.consultadoIso, { timeZone: zonaHoraria })}.`
                    : 'Hasta ahora AgenIA solo sabe lo que ella misma registró. Pregúntale al hospital si la cita existe y a nombre de quién.'}
            </p>

            {consulta && (
                <div className="mt-3 space-y-3 text-sm">
                    {vista.aviso && (
                        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            {vista.aviso}
                        </p>
                    )}
                    {consulta.cuposConsultados > 0 && (
                        <p className="text-zinc-700 dark:text-zinc-300">
                            Se revisó {consulta.cuposConsultados === 1 ? 'el cupo' : `${consulta.cuposConsultados} cupos`} de la cita en el HIS.
                        </p>
                    )}
                    {consulta.porDocumento && (
                        <div>
                            <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Citas de este paciente en el HIS</h4>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Del {formatDateShort(consulta.porDocumento.desdeIso, { timeZone: zonaHoraria })} al{' '}
                                {formatDateShort(consulta.porDocumento.hastaIso, { timeZone: zonaHoraria })}.
                            </p>
                            {consulta.porDocumento.citas.length === 0 ? (
                                <p className="mt-1 text-zinc-700 dark:text-zinc-300">El HIS no tiene citas de este paciente en ese período.</p>
                            ) : (
                                <ul className="mt-1 space-y-1">
                                    {consulta.porDocumento.citas.map((c, i) => (
                                        <li key={`${c.startIso}-${i}`} className="text-zinc-800 dark:text-zinc-200">
                                            <span className="tabular-nums">{formatAppointmentShort(c.startIso, { timeZone: zonaHoraria })}</span> · {c.medico} ·{' '}
                                            <span className="text-zinc-600 dark:text-zinc-400">{ESTADO_HIS[c.estado]}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {consulta.porDocumento.truncado && (
                                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Puede haber más citas de las que se muestran.</p>
                            )}
                        </div>
                    )}
                    {consulta.cuposIncompletos > 0 && (
                        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            El hospital contestó, pero su respuesta sobre {consulta.cuposIncompletos === 1 ? 'un cupo' : `${consulta.cuposIncompletos} cupos`} no se pudo leer entera
                            (suele ser una hora guardada en un formato que AgenIA no interpreta). <strong>Que aquí no aparezca una cita no significa que el hospital no la tenga</strong>: verifícalo en la aplicación del hospital.
                        </p>
                    )}
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Esto no se guarda: al salir de esta pantalla hay que volver a consultar. La consulta queda anotada en la bitácora.
                    </p>
                </div>
            )}

            {fase.tipo === 'ESPERANDO' && (
                <p role="status" className="mt-3 text-sm text-sky-900 dark:text-sky-200">
                    Consultando al hospital… puede tardar unos segundos.
                </p>
            )}
            {(fase.tipo === 'INICIANDO' || fase.tipo === 'APLICANDO') && (
                <p role="status" className="mt-3 text-sm text-sky-900 dark:text-sky-200">
                    {fase.tipo === 'INICIANDO' ? 'Enviando la consulta…' : 'Aplicando lo que respondió el hospital…'}
                </p>
            )}
            {fase.tipo === 'ERROR' && (
                <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                    {fase.mensaje}
                </p>
            )}

            <div className="mt-3">
                <button type="button" className={BOTON} disabled={!puede} onClick={consultar} aria-describedby={vista.disponibilidad.puede ? undefined : 'consulta-his-razon'}>
                    {consulta ? 'Volver a consultar al HIS' : 'Consultar el HIS ahora'}
                </button>
                {!vista.disponibilidad.puede && vista.disponibilidad.razon && (
                    <p id="consulta-his-razon" className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                        No se puede consultar ahora: {vista.disponibilidad.razon}
                    </p>
                )}
            </div>
        </section>
    );
}

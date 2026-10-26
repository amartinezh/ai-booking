import { sumarDiasAFecha } from '@agenia/shared';
import type { DatosDeEstadisticas } from './consultas';
import { ESTADISTICAS, diasEntre, type CorteDeEstadisticas } from './periodo';

/**
 * 📊 Estadísticas para compartir: de las cifras crudas a lo que muestra la página.
 * Sin consultas ni fechas del reloj: todo sale de los datos y del corte, así que
 * se prueba con números fijos.
 */

export interface DiaDeRecordatorios {
    dia: string;
    enviados: number;
    entregados: number;
    leidos: number;
    /** Personas que respondieron «sí, voy» ese día. */
    confirmaron: number;
}

export interface Informe {
    /** Primer día con recordatorios (o con actividad, si nunca hubo recordatorios). */
    desde: string;
    ultimoDia: string;
    /** Días de `desde` a `ultimoDia`, los dos incluidos. */
    dias: number;
    recordatorios: {
        /** Uno por día de la ventana de las gráficas, con ceros donde no hubo. */
        porDia: DiaDeRecordatorios[];
        /** ¿La gráfica muestra solo los últimos días (hubo más antes)? */
        recortada: boolean;
        enviados: number;
        entregados: number;
        leidos: number;
    };
    personasQueConfirmaron: number;
    gestiones: { tipo: string; n: number }[];
    totalGestiones: number;
    citasChat: {
        /** null si nunca se agendó por el chat. */
        desde: string | null;
        porDia: { dia: string; n: number }[];
        recortada: boolean;
        total: number;
        fueraDeHorario: number;
        pacientesNuevos: number;
        /** Cuántas llegaron al sistema del hospital y en cuántos segundos (null sin espejo). */
        enHospital: number | null;
        segundosAlHospital: number | null;
    };
    cancelaciones: { total: number; retomados: number; horasMediana: number | null };
    avisosInasistencia: number;
    mensajes: { total: number; personas: number; fueraDeHorario: number; porHora: number[] };
    /** Con y sin recordatorio entregado; vacío si aún no hay citas pasadas que contar. */
    asistencia: { grupo: string; citas: number; asistieron: number; destacado: boolean }[];
}

export const GESTION = {
    CONFIRMADAS: 'Citas confirmadas tras el recordatorio',
    CONSULTAS: 'Consultas de «¿qué citas tengo?»',
    AGENDADAS: 'Citas agendadas',
    CANCELADAS: 'Citas canceladas por el paciente',
    AVISOS: 'Avisos de inasistencia para el personal',
    CAMBIOS: 'Citas cambiadas de fecha',
} as const;

/** null si no hay nada que mostrar todavía (ni recordatorios, ni mensajes, ni citas por chat). */
export function armarInforme(
    d: DatosDeEstadisticas,
    corte: CorteDeEstadisticas,
    opts: { conHospital: boolean },
): Informe | null {
    const desde = d.recordatoriosPorDia[0]?.dia ?? d.citasChatPorDia[0]?.dia;
    if (!desde && d.mensajes.total === 0) return null;
    const inicio = desde ?? corte.ultimoDia;

    // Las gráficas por día muestran los últimos DIAS_EN_GRAFICAS días; las cifras, todo.
    const ventana = sumarDiasAFecha(corte.ultimoDia, -(ESTADISTICAS.DIAS_EN_GRAFICAS - 1));
    const desdeGrafica = (primerDia: string) => (primerDia > ventana ? primerDia : ventana);

    const recordatorios = new Map(d.recordatoriosPorDia.map((r) => [r.dia, r]));
    const confirmaron = new Map(d.confirmacionesPorDia.map((c) => [c.dia, c.personas]));
    const porDia = diasEntre(desdeGrafica(inicio), corte.ultimoDia).map((dia) => {
        const r = recordatorios.get(dia);
        return {
            dia,
            enviados: r?.enviados ?? 0,
            entregados: r?.entregados ?? 0,
            leidos: r?.leidos ?? 0,
            confirmaron: confirmaron.get(dia) ?? 0,
        };
    });
    const suma = (k: 'enviados' | 'entregados' | 'leidos') => d.recordatoriosPorDia.reduce((a, r) => a + r[k], 0);

    const citasPorDia = new Map(d.citasChatPorDia.map((c) => [c.dia, c.n]));
    const primeraCita = d.citasChatPorDia[0]?.dia ?? null;

    const gestiones = [
        { tipo: GESTION.CONFIRMADAS, n: d.confirmaciones.citas },
        { tipo: GESTION.CONSULTAS, n: d.consultas },
        { tipo: GESTION.AGENDADAS, n: d.citasChat.total },
        { tipo: GESTION.CANCELADAS, n: d.cancelaciones.total },
        { tipo: GESTION.AVISOS, n: d.avisosInasistencia },
        { tipo: GESTION.CAMBIOS, n: d.cambiosDeFecha },
    ].sort((a, b) => b.n - a.n);

    const porHora = Array.from({ length: 24 }, () => 0);
    for (const h of d.mensajesPorHora) if (h.hora >= 0 && h.hora < 24) porHora[h.hora] = h.n;

    const grupo = (recordada: boolean) => d.asistencia.find((a) => a.recordada === recordada);
    const con = grupo(true);
    const sin = grupo(false);

    return {
        desde: inicio,
        ultimoDia: corte.ultimoDia,
        dias: diasEntre(inicio, corte.ultimoDia).length,
        recordatorios: {
            porDia,
            recortada: inicio < ventana,
            enviados: suma('enviados'),
            entregados: suma('entregados'),
            leidos: suma('leidos'),
        },
        personasQueConfirmaron: d.confirmaciones.personas,
        gestiones,
        totalGestiones: gestiones.reduce((a, g) => a + g.n, 0),
        citasChat: {
            desde: primeraCita,
            porDia: primeraCita
                ? diasEntre(desdeGrafica(primeraCita), corte.ultimoDia).map((dia) => ({ dia, n: citasPorDia.get(dia) ?? 0 }))
                : [],
            recortada: primeraCita !== null && primeraCita < ventana,
            total: d.citasChat.total,
            fueraDeHorario: d.citasChat.fueraDeHorario,
            pacientesNuevos: d.citasChat.pacientesNuevos,
            enHospital: opts.conHospital ? d.hospital.entregadas : null,
            segundosAlHospital: opts.conHospital ? d.hospital.segundosPromedio : null,
        },
        cancelaciones: d.cancelaciones,
        avisosInasistencia: d.avisosInasistencia,
        mensajes: { ...d.mensajes, porHora },
        asistencia:
            con && sin
                ? [
                      { grupo: 'Con recordatorio entregado', citas: con.citas, asistieron: con.asistieron, destacado: true },
                      { grupo: 'Sin recordatorio entregado', citas: sin.citas, asistieron: sin.asistieron, destacado: false },
                  ]
                : [],
    };
}

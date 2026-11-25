import { sumarDiasAFecha } from '@agenia/shared';
import type { DatosDeEstadisticas, FilaDeOcupacion } from './consultas';
import type { EmbudoDelEnvio } from '@/lib/resumen/trazabilidad';
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
    /** ⏱️ Cuánto espera el paciente por su cita; null si no hay citas que medir. */
    espera: EsperaPorLaCita | null;
    /** 📄 Documentos de la consulta; null mientras ningún paciente haya recibido un aviso. */
    documentos: DocumentosDeLaConsulta | null;
    /** 🔒 Autorización de datos por chat; null (o ausente) mientras nadie haya respondido. */
    autorizaciones?: AutorizacionesPorChat | null;
    /** 🩺 Ocupación de la agenda de los médicos; null (o ausente) sin cupos que contar. */
    ocupacion?: OcupacionDeLaAgenda | null;
}

/** 🩺 Cupos de un mes: con cita del personal, con cita del asistente y sin agendar. */
export interface OcupacionDelMes {
    /** 'YYYY-MM'. */
    mes: string;
    personal: number;
    asistente: number;
    libres: number;
}

export interface OcupacionDeMedico {
    nombre: string;
    codigo: string | null;
    /** WhatsApp ON: el asistente puede agendar con él. */
    chat: boolean;
    /** Uno por mes de `OcupacionDeLaAgenda.meses`; null el mes que no tuvo agenda. */
    meses: (OcupacionDelMes | null)[];
    /** Cupos sin agendar en todo el período (el orden de la lista). */
    libres: number;
}

export interface OcupacionDeLaAgenda {
    /** 'YYYY-MM', del más antiguo al más reciente. */
    meses: string[];
    /** Todos los médicos juntos, uno por mes. */
    totales: OcupacionDelMes[];
    /** Primero los que dejaron más cupos sin agendar. */
    medicos: OcupacionDeMedico[];
}

/** Proporción (0 a 1) de los cupos del mes que tuvieron cita; 0 sin cupos. */
export function ocupacionDelMes(m: Pick<OcupacionDelMes, 'personal' | 'asistente' | 'libres'>): number {
    const conCita = m.personal + m.asistente;
    const cupos = conCita + m.libres;
    return cupos > 0 ? conCita / cupos : 0;
}

/**
 * 🩺 Ocupación de la agenda de los médicos (2026-11-25): de las filas por médico y
 * mes a lo que muestra la página. El mismo médico (por su código del hospital o,
 * sin él, por su nombre) va en un solo renglón con todos los meses.
 */
export function armarOcupacion(filas: FilaDeOcupacion[] | undefined): OcupacionDeLaAgenda | null {
    if (!filas?.length) return null;
    const meses = [...new Set(filas.map((f) => f.mes))].sort();
    const porMedico = new Map<string, OcupacionDeMedico>();
    for (const f of filas) {
        const clave = f.codigo ?? `nombre:${f.nombre}`;
        let medico = porMedico.get(clave);
        if (!medico) {
            medico = { nombre: f.nombre, codigo: f.codigo, chat: f.chat, meses: meses.map(() => null), libres: 0 };
            porMedico.set(clave, medico);
        }
        const i = meses.indexOf(f.mes);
        const antes = medico.meses[i];
        medico.meses[i] = {
            mes: f.mes,
            personal: (antes?.personal ?? 0) + f.personal,
            asistente: (antes?.asistente ?? 0) + f.asistente,
            libres: (antes?.libres ?? 0) + f.libres,
        };
        medico.libres += f.libres;
    }
    const totales = meses.map((mes) => {
        const delMes = filas.filter((f) => f.mes === mes);
        return {
            mes,
            personal: delMes.reduce((a, f) => a + f.personal, 0),
            asistente: delMes.reduce((a, f) => a + f.asistente, 0),
            libres: delMes.reduce((a, f) => a + f.libres, 0),
        };
    });
    const medicos = [...porMedico.values()].sort(
        (a, b) => b.libres - a.libres || a.nombre.localeCompare(b.nombre, 'es') || (a.codigo ?? '').localeCompare(b.codigo ?? ''),
    );
    return { meses, totales, medicos };
}

/** 🔒 Personas que autorizaron (o no) el tratamiento de sus datos por chat. */
export interface AutorizacionesPorChat {
    aceptaron: number;
    noAceptaron: number;
    retiraron: number;
}

/** 📄 Lo que pasó con los documentos de la consulta (resumen de la atención). */
export interface DocumentosDeLaConsulta {
    desde: string;
    /** Uno por día de la ventana de las gráficas, con ceros donde no hubo. */
    porDia: { dia: string; avisos: number; entregados: number; leidos: number; pidieron: number; recibieron: number }[];
    recortada: boolean;
    totales: Omit<EmbudoDelEnvio, 'porDia'>;
}

export interface CanalDeEspera {
    canal: 'chat' | 'personal';
    citas: number;
    /** Días calendario promedio entre el día en que la pidió y el de la cita. */
    promedioDias: number;
    /** Proporción (0 a 1) de citas para dentro de 3 días o menos. */
    dentroDe3: number;
    /** Citas para el mismo día, a 1, 2 y 3 días, y a más de 3 (5 posiciones). */
    reparto: number[];
}

export interface EsperaPorLaCita {
    servicios: string[];
    /** Por chat primero; solo los canales que tienen citas. */
    canales: CanalDeEspera[];
    conversacion: { citas: number; medidas: number; medianaMin: number | null; promedioMin: number | null };
    listaEspera: { asignadas: number; medianaHoras: number | null; promedioHoras: number | null };
}

/** Días máximos para una cita de medicina general (Res. 408 de 2018; 3 días hábiles en la Res. 2117 de 2025). */
export const ESTANDAR_DIAS = 3;

function armarEspera(e: DatosDeEstadisticas['espera']): EsperaPorLaCita | null {
    if (!e) return null;
    const canales = (['chat', 'personal'] as const)
        .map((canal) => {
            const filas = e.oportunidad.filter((f) => f.canal === canal);
            const citas = filas.reduce((a, f) => a + f.citas, 0);
            const reparto = [0, 1, 2, 3, 4].map((d) => filas.find((f) => f.dias === d)?.citas ?? 0);
            return {
                canal,
                citas,
                promedioDias: citas > 0 ? filas.reduce((a, f) => a + f.sumaDias, 0) / citas : 0,
                dentroDe3: citas > 0 ? (citas - reparto[4]) / citas : 0,
                reparto,
            };
        })
        .filter((c) => c.citas > 0);
    if (canales.length === 0 && e.listaEspera.asignadas === 0) return null;
    return { servicios: e.servicios, canales, conversacion: e.conversacion, listaEspera: e.listaEspera };
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
        espera: armarEspera(d.espera),
        documentos: armarDocumentos(d.documentos, corte, desdeGrafica, ventana),
        autorizaciones:
            d.autorizaciones && d.autorizaciones.aceptaron + d.autorizaciones.noAceptaron > 0 ? d.autorizaciones : null,
        ocupacion: armarOcupacion(d.ocupacion),
    };
}

function armarDocumentos(
    datos: DatosDeEstadisticas['documentos'],
    corte: CorteDeEstadisticas,
    desdeGrafica: (primerDia: string) => string,
    ventana: string,
): DocumentosDeLaConsulta | null {
    if (!datos) return null;
    const { porDia, ...totales } = datos.embudo;
    const dias = new Map(porDia.map((p) => [p.dia, p]));
    return {
        desde: datos.desde,
        porDia: diasEntre(desdeGrafica(datos.desde), corte.ultimoDia).map(
            (dia) => dias.get(dia) ?? { dia, avisos: 0, entregados: 0, leidos: 0, pidieron: 0, recibieron: 0 },
        ),
        recortada: datos.desde < ventana,
        totales,
    };
}

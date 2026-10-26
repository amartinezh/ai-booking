import {
    DEFAULT_TIMEZONE,
    DIAS_SEMANA,
    diaDeLaSemana,
    diaLocal,
    horaLocalAUtc,
    partesDeFecha,
    sumarDiasAFecha,
} from '@agenia/shared';

/**
 * 📊 Estadísticas para compartir (2026-10-26): qué período cubren. Se recalculan
 * una vez al día, a las 6 a. m. de la clínica, con el día anterior COMPLETO: un
 * día a medias se lee como una caída (pasó el 26-oct con la página de claude.ai,
 * que mostró 6 recordatorios del lunes a las 9:32 a. m.).
 */
export const ESTADISTICAS = {
    /** Hora local (0-23) en que se recalculan. */
    HORA_DE_ACTUALIZACION: 6,
    /** Días que muestran las gráficas por día; las cifras cuentan desde el inicio. */
    DIAS_EN_GRAFICAS: 30,
    /** «Horario de oficina»: de 7 a. m. a 5 p. m., de lunes a viernes. */
    OFICINA_DESDE: 7,
    OFICINA_HASTA: 17,
} as const;

export interface CorteDeEstadisticas {
    /** Primer día que NO entra ('YYYY-MM-DD' de la clínica): los datos van hasta antes de su medianoche. */
    hasta: string;
    /** Último día que sí entra, completo. */
    ultimoDia: string;
    /** Medianoche de `hasta` en la clínica, en UTC: el límite de las consultas. */
    hastaUtc: Date;
}

/** El corte vigente en `ahora`: desde las 6 a. m. entra el día anterior; antes, el de anteayer. */
export function corteDeEstadisticas(ahora: Date, timeZone: string = DEFAULT_TIMEZONE): CorteDeEstadisticas {
    const hoy = diaLocal(ahora, timeZone);
    const [y, m, d] = hoy.split('-').map(Number);
    const actualizacionDeHoy = horaLocalAUtc(y, m, d, ESTADISTICAS.HORA_DE_ACTUALIZACION, timeZone);
    const hasta = ahora.getTime() >= actualizacionDeHoy.getTime() ? hoy : sumarDiasAFecha(hoy, -1);
    const [hy, hm, hd] = hasta.split('-').map(Number);
    return { hasta, ultimoDia: sumarDiasAFecha(hasta, -1), hastaUtc: horaLocalAUtc(hy, hm, hd, 0, timeZone) };
}

/** Los días de `desde` a `hasta`, los dos incluidos ('YYYY-MM-DD'). Vacío si `desde` es posterior. */
export function diasEntre(desde: string, hasta: string): string[] {
    const dias: string[] = [];
    for (let d = desde; d <= hasta; d = sumarDiasAFecha(d, 1)) dias.push(d);
    return dias;
}

/** «dom 25»: la etiqueta corta de un día en el eje de una gráfica. */
export function diaCorto(fecha: string): string {
    const p = partesDeFecha(fecha);
    if (!p) return fecha;
    return `${DIAS_SEMANA[diaDeLaSemana(fecha)].slice(0, 3)} ${p[2]}`;
}

/** 6 → «6 a. m.»; 12 → «12 p. m.»; 0 → «12 a. m.». */
export function horaCorta(h: number): string {
    return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** ¿Esta hora del día (0-23) cae fuera del horario de oficina, cualquier día? */
export function esHoraFueraDeOficina(hora: number): boolean {
    return hora < ESTADISTICAS.OFICINA_DESDE || hora >= ESTADISTICAS.OFICINA_HASTA;
}

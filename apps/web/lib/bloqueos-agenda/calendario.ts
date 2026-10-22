/**
 * 📅 El calendario de «Días sin citas» (Configuración), puro para poder probarlo.
 *
 * Trabaja con fechas de calendario 'YYYY-MM-DD' de la clínica (las da el servidor:
 * `hoy` en su zona horaria), así el navegador nunca mueve un día por estar en otra
 * zona. Semanas de lunes a domingo, como en Colombia.
 */
import {
    bloqueosDelDia,
    diaDeLaSemana,
    esTodoElDia,
    fechaDe,
    partesDeFecha,
    type ReglaBloqueoAgenda,
} from '@agenia/shared';

export type EstadoDelDia = 'libre' | 'parcial' | 'completo';

export interface DiaDelCalendario<T extends ReglaBloqueoAgenda = ReglaBloqueoAgenda> {
    fecha: string;
    dia: number;
    /** Es del mes que se está viendo (los demás rellenan la primera y la última semana). */
    delMes: boolean;
    pasado: boolean;
    hoy: boolean;
    estado: EstadoDelDia;
    /** Los bloqueos que tocan ese día. */
    reglas: T[];
}

export const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;

/** Qué tanto está bloqueado un día: todo, algunas horas o nada. */
export function estadoDelDia(reglas: readonly ReglaBloqueoAgenda[]): EstadoDelDia {
    if (reglas.length === 0) return 'libre';
    return reglas.some(esTodoElDia) ? 'completo' : 'parcial';
}

/** Las semanas (de lunes a domingo) del mes `mes` (1-12) de `anio`. */
export function semanasDelMes<T extends ReglaBloqueoAgenda>(
    anio: number,
    mes: number,
    hoy: string,
    reglas: readonly T[],
): DiaDelCalendario<T>[][] {
    const primero = fechaDe(anio, mes, 1);
    const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    // Lunes = 0 … domingo = 6.
    const corrimiento = (diaDeLaSemana(primero) + 6) % 7;
    const filas = Math.ceil((corrimiento + diasDelMes) / 7);

    const semanas: DiaDelCalendario<T>[][] = [];
    for (let s = 0; s < filas; s++) {
        const semana: DiaDelCalendario<T>[] = [];
        for (let d = 0; d < 7; d++) {
            const fecha = fechaDe(anio, mes, 1 - corrimiento + s * 7 + d);
            const [, m, dia] = partesDeFecha(fecha)!;
            const delDia = bloqueosDelDia(reglas, fecha);
            semana.push({
                fecha,
                dia,
                delMes: m === mes,
                pasado: fecha < hoy,
                hoy: fecha === hoy,
                estado: estadoDelDia(delDia),
                reglas: delDia,
            });
        }
        semanas.push(semana);
    }
    return semanas;
}

/** El mes siguiente (o anterior, con -1). */
export function moverMes(anio: number, mes: number, n: number): { anio: number; mes: number } {
    const t = new Date(Date.UTC(anio, mes - 1 + n, 1));
    return { anio: t.getUTCFullYear(), mes: t.getUTCMonth() + 1 };
}

/** '08:30' → 510; null si no es una hora. */
export function minutosDeHora(hora: string): number | null {
    const m = /^(\d{2}):(\d{2})$/.exec(hora ?? '');
    if (!m) return null;
    const [h, min] = [Number(m[1]), Number(m[2])];
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

/** 510 → '08:30' (para los campos de hora). */
export function horaDeMinutos(minutos: number): string {
    return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

/** «8–10», «8:30–10» (en 24 h, corto, para la celda del calendario). */
export function rangoCorto(r: ReglaBloqueoAgenda): string {
    if (esTodoElDia(r)) return 'Todo el día';
    const h = (min: number) =>
        min % 60 === 0 ? String(min / 60) : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
    return `${h(r.startMinute!)}–${h(r.endMinute!)}`;
}

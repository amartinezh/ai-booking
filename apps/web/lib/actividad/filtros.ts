/**
 * 👣 ACTIVIDAD DE USUARIOS — los filtros de la pantalla, leídos de la dirección.
 *
 * Todo llega como texto de la URL (o de la acción «Cargar más»): aquí se valida y
 * se convierte en lo que entienden las fuentes. Lo que no se entiende se ignora
 * (no rompe la página). Las fechas son días de Bogotá: «desde el 3» es desde las
 * 00:00 del 3 en Colombia, y «hasta el 5» incluye todo el día 5.
 */
import { aUtc } from '../rastreo/zona-horaria';
import { esCategoria, type Categoria } from './catalogo';

export const ZONA_ACTIVIDAD = 'America/Bogota';

/** Qué clínica se mira: todas, solo lo que no es de ninguna (plataforma), o una. */
export type AlcanceClinica = { tipo: 'TODAS' } | { tipo: 'PLATAFORMA' } | { tipo: 'CLINICA'; id: string };

export interface FiltrosActividad {
    clinica: AlcanceClinica;
    usuarioId: string | null;
    categoria: Categoria | null;
    /** Día de inicio (`YYYY-MM-DD`, Bogotá) tal como se escribió, para devolverlo al formulario. */
    desde: string | null;
    hasta: string | null;
    /** Los mismos días, como instantes: [desdeUtc, hastaUtc). */
    desdeUtc: Date | null;
    hastaUtc: Date | null;
}

export interface FiltrosEnTexto {
    org?: string;
    usuario?: string;
    cat?: string;
    desde?: string;
    hasta?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: unknown): valor is string {
    return typeof valor === 'string' && UUID.test(valor);
}

/** El día siguiente a `YYYY-MM-DD` (sin zona: solo calendario). */
export function diaSiguiente(fecha: string): string {
    const [y, m, d] = fecha.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    return t.toISOString().slice(0, 10);
}

export function leerFiltros(t: FiltrosEnTexto): FiltrosActividad {
    const org = (t.org ?? '').trim();
    const clinica: AlcanceClinica =
        org === 'plataforma' ? { tipo: 'PLATAFORMA' } : esUuid(org) ? { tipo: 'CLINICA', id: org } : { tipo: 'TODAS' };

    const usuarioId = esUuid(t.usuario) ? t.usuario : null;
    const categoria = esCategoria(t.cat) ? t.cat : null;

    const desdeUtc = t.desde ? aUtc(t.desde, '00:00', ZONA_ACTIVIDAD) : null;
    const hastaUtc = t.hasta ? aUtc(diaSiguienteSeguro(t.hasta), '00:00', ZONA_ACTIVIDAD) : null;

    // Un rango al revés no es un error que valga la pena mostrar: se ignora el «hasta».
    const alReves = desdeUtc && hastaUtc && hastaUtc <= desdeUtc;
    return {
        clinica,
        usuarioId,
        categoria,
        desde: desdeUtc ? (t.desde as string) : null,
        hasta: hastaUtc && !alReves ? (t.hasta as string) : null,
        desdeUtc,
        hastaUtc: alReves ? null : hastaUtc,
    };
}

function diaSiguienteSeguro(fecha: string): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? diaSiguiente(fecha) : '';
}

/** Los filtros de vuelta a la dirección (sin los vacíos), para enlaces y para «Cargar más». */
export function filtrosATexto(f: FiltrosActividad): FiltrosEnTexto {
    const t: FiltrosEnTexto = {};
    if (f.clinica.tipo === 'PLATAFORMA') t.org = 'plataforma';
    if (f.clinica.tipo === 'CLINICA') t.org = f.clinica.id;
    if (f.usuarioId) t.usuario = f.usuarioId;
    if (f.categoria) t.cat = f.categoria;
    if (f.desde) t.desde = f.desde;
    if (f.hasta) t.hasta = f.hasta;
    return t;
}

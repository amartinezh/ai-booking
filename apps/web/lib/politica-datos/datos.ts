/**
 * ══════════════════════════════════════════════════════════════════════════
 * 📄 PÁGINA PÚBLICA DE LA POLÍTICA DE TRATAMIENTO DE DATOS — 2026-11-20
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `/politica-de-datos/<organizationId>`: la política de tratamiento de datos
 * personales de la clínica (Ley 1581 de 2012 y Decreto 1377 de 2013), servida por
 * AgenIA para que el asistente, los formularios y el hospital tengan un enlace que
 * diga exactamente lo que hace el sistema. El texto es el mismo para todas las
 * clínicas (`documento.ts`); lo que cambia es la identificación del responsable
 * que pide el Decreto 1377, art. 13: razón social, domicilio, dirección, correo y
 * teléfono, el área que atiende consultas y reclamos y la fecha de entrada en
 * vigencia. Eso lo escribe el administrador en Configuración › Asistente Virtual
 * y se guarda en `OrganizationSettings.dataPolicyPage` (JSON).
 *
 * Mientras falte un dato obligatorio la página no existe (404): una política sin
 * a quién reclamar no cumple la ley.
 *
 * Aquí viven las reglas puras (sin base ni sesión): los campos, sus
 * validaciones, la lectura del JSON guardado y la ruta.
 */

export type CampoPolitica =
    | 'razonSocial'
    | 'nit'
    | 'municipio'
    | 'direccion'
    | 'telefono'
    | 'correo'
    | 'area'
    | 'horario'
    | 'vigenteDesde';

export interface DatosPolitica {
    /** Nombre o razón social del responsable (E.S.E. …). */
    razonSocial: string;
    /** Opcional: el Decreto 1377 no lo exige, pero ayuda a identificarla. */
    nit: string | null;
    /** Domicilio: municipio y departamento. */
    municipio: string;
    /** Dirección física donde se reciben las solicitudes. */
    direccion: string;
    /** Uno o varios teléfonos, como los quiera escribir la clínica. */
    telefono: string;
    /** Correo para consultas y reclamos de datos personales. */
    correo: string;
    /** Área o cargo que atiende las consultas y reclamos (Decreto 1377, art. 13, n.º 4). */
    area: string;
    /** Opcional: horario de atención para radicar en persona. */
    horario: string | null;
    /** Fecha de entrada en vigencia, AAAA-MM-DD (Decreto 1377, art. 13, n.º 6). */
    vigenteDesde: string;
}

interface DefinicionCampo {
    campo: CampoPolitica;
    etiqueta: string;
    obligatorio: boolean;
    max: number;
    ejemplo: string;
    ayuda?: string;
}

/** En el orden en que se piden en Configuración. */
export const CAMPOS_POLITICA: readonly DefinicionCampo[] = [
    {
        campo: 'razonSocial',
        etiqueta: 'Nombre o razón social',
        obligatorio: true,
        max: 160,
        ejemplo: 'E.S.E. Hospital Municipal',
    },
    { campo: 'nit', etiqueta: 'NIT', obligatorio: false, max: 20, ejemplo: '800.000.000-0' },
    {
        campo: 'municipio',
        etiqueta: 'Municipio y departamento',
        obligatorio: true,
        max: 120,
        ejemplo: 'Municipio, Departamento',
    },
    { campo: 'direccion', etiqueta: 'Dirección', obligatorio: true, max: 160, ejemplo: 'Calle 1 # 2-34' },
    {
        campo: 'telefono',
        etiqueta: 'Teléfonos',
        obligatorio: true,
        max: 160,
        ejemplo: '(606) 000 0000 · celular y WhatsApp 300 000 0000',
    },
    {
        campo: 'correo',
        etiqueta: 'Correo para consultas y reclamos de datos personales',
        obligatorio: true,
        max: 120,
        ejemplo: 'siau@hospital.gov.co',
    },
    {
        campo: 'area',
        etiqueta: 'Área o cargo que atiende las consultas y reclamos',
        obligatorio: true,
        max: 160,
        ejemplo: 'Oficina de Atención al Usuario (SIAU)',
    },
    {
        campo: 'horario',
        etiqueta: 'Horario de atención',
        obligatorio: false,
        max: 200,
        ejemplo: 'Lunes a viernes de 7:00 a. m. a 4:00 p. m.',
    },
    {
        campo: 'vigenteDesde',
        etiqueta: 'Fecha de entrada en vigencia',
        obligatorio: true,
        max: 10,
        ejemplo: '2026-12-01',
        ayuda: 'La fecha en que la clínica adopta esta versión de la política.',
    },
] as const;

const DEFINICION = new Map(CAMPOS_POLITICA.map((d) => [d.campo, d]));

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NIT = /^[0-9][0-9.\s-]*[0-9]$/;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Ley 1581 de 2012: no tiene sentido una política vigente antes de la ley. */
const FECHA_MINIMA = '2012-10-17';

const MESES = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
];

/** «2026-12-01» → «1 de diciembre de 2026». Sin `Date`: la fecha es de calendario, no un instante. */
export function fechaEnLetras(fecha: string): string {
    const m = FECHA.exec(fecha);
    if (!m) return fecha;
    return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

function fechaValida(fecha: string, hoy: string): boolean {
    const m = FECHA.exec(fecha);
    if (!m) return false;
    const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mes < 1 || mes > 12 || dia < 1) return false;
    const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    if (dia > diasDelMes) return false;
    // Hasta un año adelante: una política se aprueba antes de entrar a regir.
    const tope = `${Number(hoy.slice(0, 4)) + 1}${hoy.slice(4)}`;
    return fecha >= FECHA_MINIMA && fecha <= tope;
}

const limpiar = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export type ResultadoValidacion =
    | { ok: true; datos: DatosPolitica }
    | { ok: false; campo: CampoPolitica; error: string };

/**
 * Lo que escribe el administrador. Todos los obligatorios deben venir: se guarda
 * completo o no se guarda, para que la página nunca quede a medias.
 * `hoy` (AAAA-MM-DD, en la zona de la clínica) acota la fecha de vigencia.
 */
export function validarDatosPolitica(entrada: unknown, hoy: string): ResultadoValidacion {
    const e = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
    const valores = {} as Record<CampoPolitica, string>;
    for (const d of CAMPOS_POLITICA) {
        const v = limpiar(e[d.campo]);
        if (d.obligatorio && !v) return { ok: false, campo: d.campo, error: `Escriba: ${d.etiqueta.toLowerCase()}.` };
        if (v.length > d.max) {
            return { ok: false, campo: d.campo, error: `«${d.etiqueta}» puede tener hasta ${d.max} caracteres.` };
        }
        valores[d.campo] = v;
    }
    if (valores.nit && !NIT.test(valores.nit)) {
        return { ok: false, campo: 'nit', error: 'El NIT solo lleva números, puntos y el guion del dígito de verificación.' };
    }
    if (!CORREO.test(valores.correo)) {
        return { ok: false, campo: 'correo', error: 'Escriba un correo válido (por ejemplo, siau@hospital.gov.co).' };
    }
    if (!fechaValida(valores.vigenteDesde, hoy)) {
        return {
            ok: false,
            campo: 'vigenteDesde',
            error: 'Escriba una fecha válida de entrada en vigencia (hasta un año adelante).',
        };
    }
    return {
        ok: true,
        datos: {
            razonSocial: valores.razonSocial,
            nit: valores.nit || null,
            municipio: valores.municipio,
            direccion: valores.direccion,
            telefono: valores.telefono,
            correo: valores.correo,
            area: valores.area,
            horario: valores.horario || null,
            vigenteDesde: valores.vigenteDesde,
        },
    };
}

/**
 * Lo guardado en la base (JSON), como lo usa la página: completo o null. No
 * vuelve a acotar la fecha (lo que ya se publicó no se despublica con el tiempo);
 * sí exige el formato y los obligatorios, por si el JSON llegó a mano.
 */
export function datosPublicables(valor: unknown): DatosPolitica | null {
    const r = validarDatosPolitica(valor, '9998-12-31');
    return r.ok ? r.datos : null;
}

/** Para el formulario: lo guardado campo por campo, o vacío. */
export function datosParaEditar(valor: unknown): Record<CampoPolitica, string> {
    const e = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
    const out = {} as Record<CampoPolitica, string>;
    for (const d of CAMPOS_POLITICA) out[d.campo] = typeof e[d.campo] === 'string' ? (e[d.campo] as string) : '';
    return out;
}

/** Qué cambió entre lo guardado y lo nuevo, con la etiqueta de cada campo (para la Actividad). */
export function camposCambiados(antes: unknown, despues: DatosPolitica): string[] {
    const a = datosParaEditar(antes);
    return CAMPOS_POLITICA.filter((d) => (a[d.campo] || '') !== (despues[d.campo] ?? '')).map((d) => d.etiqueta);
}

export const etiquetaCampo = (campo: CampoPolitica): string => DEFINICION.get(campo)?.etiqueta ?? campo;

export const rutaPoliticaDatos = (organizationId: string): string => `/politica-de-datos/${organizationId}`;

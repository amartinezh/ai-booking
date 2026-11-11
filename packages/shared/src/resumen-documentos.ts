/**
 * Documentos del resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md §3.9,
 * Fase 2): qué documentos salen de un resumen, qué dice el resumen en palabras,
 * la cantidad en letras de la fórmula y los datos del hospital que van en el
 * encabezado.
 *
 * Lo comparten el generador de PDF e imagen (API) y la página del paciente
 * (web): los dos muestran el mismo contenido porque salen de aquí.
 *
 * Sin dependencias de Node.
 */
import { formatDateShort, formatAppointmentShort } from './date-format';
import type { OrdenResumen, ResumenAtencionHis, TipoOrdenResumen } from './resumen-atencion';

const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

// ─── Qué documentos salen de un resumen (D20) ───────────────────────────────

export type TipoDocumentoResumen = 'RESUMEN' | 'FORMULA' | 'ORDEN' | 'REMISION' | 'INCAPACIDAD';

export interface DocumentoDelResumen {
  /** Único dentro del resumen y seguro para una URL: `resumen`, `formula-77`, `orden-78`… */
  id: string;
  tipo: TipoDocumentoResumen;
  titulo: string;
  /** Número de la orden, la remisión o la incapacidad en el HIS. */
  numero: string | null;
  /** Sin extensión: `Formula_01-11-2026_N77`. El generador agrega `.pdf` o `_hoja-1-de-2.png`. */
  nombreArchivo: string;
}

const TITULO_ORDEN: Record<Exclude<TipoOrdenResumen, 'MEDICAMENTOS'>, string> = {
  LABORATORIO: 'Orden de laboratorio',
  PROCEDIMIENTO: 'Orden de procedimientos',
  CONSULTA: 'Orden de consulta',
  CIRUGIA: 'Orden de cirugía',
};

const ARCHIVO_ORDEN: Record<Exclude<TipoOrdenResumen, 'MEDICAMENTOS'>, string> = {
  LABORATORIO: 'Laboratorio',
  PROCEDIMIENTO: 'Procedimientos',
  CONSULTA: 'Consulta',
  CIRUGIA: 'Cirugia',
};

const seguro = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');

/** «01/11/2026» → «01-11-2026», en la zona de la clínica. */
function fechaArchivo(iso: string, timeZone?: string): string {
  return formatDateShort(iso, { timeZone }).replace(/\//g, '-');
}

/**
 * Los documentos de un resumen, en el orden en que se entregan: el resumen,
 * cada fórmula (una por orden, también las posfechadas: D25), cada orden de
 * exámenes o procedimientos, cada remisión y cada incapacidad. La interconsulta
 * no tiene documento: va como una línea del resumen.
 */
export function documentosDelResumen(r: ResumenAtencionHis, opts: { timeZone?: string } = {}): DocumentoDelResumen[] {
  const fecha = fechaArchivo(r.historia.guardadaIso, opts.timeZone);
  const docs: DocumentoDelResumen[] = [
    { id: 'resumen', tipo: 'RESUMEN', titulo: 'Resumen de la atención', numero: null, nombreArchivo: `Resumen_${fecha}` },
  ];
  const usados = new Set(['resumen']);
  const agregar = (d: DocumentoDelResumen) => {
    let id = d.id;
    for (let i = 2; usados.has(id); i++) id = `${d.id}-${i}`;
    usados.add(id);
    docs.push({ ...d, id });
  };

  for (const o of r.ordenes) {
    const n = seguro(o.numero);
    if (o.tipo === 'MEDICAMENTOS') {
      if (o.medicamentos.length === 0) continue;
      agregar({ id: `formula-${n}`, tipo: 'FORMULA', titulo: `Fórmula médica N.º ${o.numero}`, numero: o.numero, nombreArchivo: `Formula_${fecha}_N${n}` });
    } else {
      if (o.examenes.length === 0) continue;
      agregar({
        id: `orden-${n}`,
        tipo: 'ORDEN',
        titulo: `${TITULO_ORDEN[o.tipo]} N.º ${o.numero}`,
        numero: o.numero,
        nombreArchivo: `${ARCHIVO_ORDEN[o.tipo]}_${fecha}_N${n}`,
      });
    }
  }
  for (const m of r.remisiones) {
    const n = seguro(m.numero);
    agregar({ id: `remision-${n}`, tipo: 'REMISION', titulo: `Remisión N.º ${m.numero}`, numero: m.numero, nombreArchivo: `Remision_${fecha}_N${n}` });
  }
  for (const i of r.incapacidades) {
    const n = seguro(i.numero);
    agregar({
      id: `incapacidad-${n}`,
      tipo: 'INCAPACIDAD',
      titulo: `Incapacidad N.º ${i.numero}`,
      numero: i.numero,
      nombreArchivo: `Incapacidad_${fecha}_N${n}`,
    });
  }
  return docs;
}

/** La orden, remisión o incapacidad del HIS que corresponde a un documento. */
export function fuenteDelDocumento(
  r: ResumenAtencionHis,
  doc: DocumentoDelResumen,
):
  | { tipo: 'RESUMEN' }
  | { tipo: 'FORMULA' | 'ORDEN'; orden: OrdenResumen }
  | { tipo: 'REMISION'; remision: ResumenAtencionHis['remisiones'][number] }
  | { tipo: 'INCAPACIDAD'; incapacidad: ResumenAtencionHis['incapacidades'][number] }
  | null {
  if (doc.tipo === 'RESUMEN') return { tipo: 'RESUMEN' };
  if (doc.tipo === 'FORMULA' || doc.tipo === 'ORDEN') {
    const orden = r.ordenes.find(
      (o) => o.numero === doc.numero && (doc.tipo === 'FORMULA') === (o.tipo === 'MEDICAMENTOS'),
    );
    return orden ? { tipo: doc.tipo, orden } : null;
  }
  if (doc.tipo === 'REMISION') {
    const remision = r.remisiones.find((m) => m.numero === doc.numero);
    return remision ? { tipo: 'REMISION', remision } : null;
  }
  const incapacidad = r.incapacidades.find((i) => i.numero === doc.numero);
  return incapacidad ? { tipo: 'INCAPACIDAD', incapacidad } : null;
}

// ─── Cantidad en letras (la fórmula la pide en número y letras, en español) ─

const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve',
];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
  'ochocientos', 'novecientos',
];

function menorQueMil(n: number): string {
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 30) partes.push(UNIDADES[resto]);
    else partes.push(DECENAS[Math.floor(resto / 10)] + (resto % 10 ? ` y ${UNIDADES[resto % 10]}` : ''));
  }
  return partes.join(' ');
}

function enteroEnLetras(n: number): string {
  if (n < 1000) return n === 0 ? 'cero' : menorQueMil(n);
  if (n < 1_000_000) {
    const miles = Math.floor(n / 1000);
    const resto = n % 1000;
    const cabeza = miles === 1 ? 'mil' : `${menorQueMil(miles).replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un')} mil`;
    return resto ? `${cabeza} ${menorQueMil(resto)}` : cabeza;
  }
  return String(n);
}

/**
 * 30 → «treinta»; 2,5 → «dos coma cinco». Hasta 999.999; más allá devuelve el
 * número (una cantidad así es un error de digitación y no se disfraza).
 */
export function cantidadEnLetras(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (Number.isInteger(n)) return enteroEnLetras(n);
  const [entero, decimales] = String(n).split('.');
  const dec = decimales.replace(/0+$/, '');
  const letrasDec = /^0/.test(dec) ? [...dec].map((d) => UNIDADES[Number(d)]).join(' ') : enteroEnLetras(Number(dec));
  return `${enteroEnLetras(Number(entero))} coma ${letrasDec}`;
}

/** «30 (treinta)»; «2,5 (dos coma cinco)». */
export function cantidadConLetras(n: number): string {
  return `${String(n).replace('.', ',')} (${cantidadEnLetras(n)})`;
}

// ─── Qué dice el resumen (plan §3.2) ────────────────────────────────────────

export interface SeccionDelResumen {
  titulo: string;
  renglones: string[];
}

/** Texto del pie del resumen mientras el hospital no ponga el suyo (D21: copia informativa). */
export const PIE_RESUMEN_POR_DEFECTO =
  'Este resumen y sus documentos son una copia informativa. Para reclamar medicamentos o hacerse los exámenes, siga las indicaciones del hospital y de su EPS.';

/** Si el médico no escribió cómo tomarlo (D19). */
export const SIN_INDICACION = 'Tómelo como se lo explicaron en la consulta.';

/**
 * Cómo tomar un medicamento (D19): la indicación del médico tal cual. Si no la
 * escribió (11 % de los renglones), la frecuencia del HIS solo si el hospital
 * la aprobó (`frecuenciaDelHis`, apagada por defecto: también puede
 * contradecir al médico); si no, «Tómelo como se lo explicaron en la consulta».
 * El agente ya manda la frecuencia como «cada 24 horas»: no se le agrega otro «cada».
 */
export function comoTomarlo(
  m: { indicacion: string | null; frecuencia: string | null },
  frecuenciaDelHis: boolean,
): string {
  const indicacion = m.indicacion?.trim();
  if (indicacion) return indicacion;
  const f = m.frecuencia?.trim();
  if (frecuenciaDelHis && f) return /^cada\b/i.test(f) ? f : `cada ${f}`;
  return SIN_INDICACION;
}

const fecha = (iso: string | null, timeZone?: string) => (iso ? formatDateShort(iso, { timeZone }) : null);
const diaLocal = (iso: string, timeZone?: string) => formatDateShort(iso, { timeZone });

/**
 * Las secciones del resumen de la atención, en palabras, tal como las escribió
 * el médico (sin IA, D13). Cada medicamento una sola vez, con las fechas de sus
 * entregas posfechadas. Las secciones vacías no aparecen.
 */
export function contenidoDelResumen(
  r: ResumenAtencionHis,
  opts: { timeZone?: string; frecuenciaDelHis?: boolean } = {},
): SeccionDelResumen[] {
  const tz = opts.timeZone;
  const secciones: SeccionDelResumen[] = [];
  const agregar = (titulo: string, renglones: string[]) => {
    const limpios = renglones.map((x) => x.trim()).filter(Boolean);
    if (limpios.length) secciones.push({ titulo, renglones: limpios });
  };

  // Diagnósticos: el principal primero, en palabras y con su código al lado.
  const dx = [...r.diagnosticos].sort((a, b) => Number(b.principal) - Number(a.principal));
  agregar(
    'Diagnósticos',
    dx.map((d) => `${d.descripcion ?? d.cie10} (${d.cie10})${d.principal && dx.length > 1 ? ' — principal' : ''}`),
  );

  // Campos de la plantilla que eligió el hospital («Motivo», «Plan», «Próximo control»…).
  const porSeccion = new Map<string, string[]>();
  for (const c of r.campos) porSeccion.set(c.seccion, [...(porSeccion.get(c.seccion) ?? []), c.valor]);
  for (const [titulo, valores] of porSeccion) agregar(titulo, valores);

  agregar('Indicaciones del médico', r.indicaciones);

  // Medicamentos: uno por código, con las fechas de cada entrega.
  const consulta = diaLocal(r.historia.guardadaIso, tz);
  const meds = new Map<string, { texto: string; entregas: Set<string> }>();
  for (const o of r.ordenes) {
    if (o.tipo !== 'MEDICAMENTOS') continue;
    const desde = o.desdeIso ? diaLocal(o.desdeIso, tz) : consulta;
    for (const m of o.medicamentos) {
      const clave = m.codigo || m.nombre;
      if (!meds.has(clave)) {
        const partes = [m.nombre, comoTomarlo(m, opts.frecuenciaDelHis === true)];
        const extra = [
          m.cantidad !== null ? `cantidad ${String(m.cantidad).replace('.', ',')}` : null,
          m.duracionDias ? `${m.duracionDias} día${m.duracionDias === 1 ? '' : 's'}` : null,
        ].filter(Boolean);
        meds.set(clave, { texto: `${partes.join(': ')}${extra.length ? ` (${extra.join(', ')})` : ''}`, entregas: new Set() });
      }
      meds.get(clave)!.entregas.add(desde);
    }
  }
  agregar(
    'Medicamentos',
    [...meds.values()].map(({ texto, entregas }) => {
      const fechas = [...entregas];
      if (fechas.length <= 1 && (fechas[0] ?? consulta) === consulta) return texto;
      // «Entregas: el 01/11/2026 y desde el 01/12/2026.»
      const lista = fechas.map((f) => (f === consulta ? `el ${f}` : `desde el ${f}`));
      const unidas = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}` : lista[0];
      return `${texto}. Entregas: ${unidas}.`;
    }),
  );

  agregar(
    'Exámenes y procedimientos',
    r.ordenes
      .filter((o) => o.tipo !== 'MEDICAMENTOS')
      .flatMap((o) =>
        o.examenes.map(
          (e) => `${e.nombre} (${e.codigo})${e.cantidad && e.cantidad !== 1 ? ` × ${e.cantidad}` : ''}${e.indicacion ? `: ${e.indicacion}` : ''}`,
        ),
      ),
  );

  agregar(
    'Remisiones',
    r.remisiones.map((m) =>
      [m.servicioPedido ?? m.remiteA ?? 'Remisión', m.cups ? `(${m.cups})` : null, m.motivo ? `— ${m.motivo}` : null]
        .filter(Boolean)
        .join(' '),
    ),
  );

  agregar(
    'Incapacidad',
    r.incapacidades.map((i) => {
      const hasta = hastaDeIncapacidad(i.desdeIso, i.dias, tz);
      return [
        i.dias !== null ? `${i.dias} día${i.dias === 1 ? '' : 's'}` : 'Incapacidad',
        i.desdeIso ? `desde el ${fecha(i.desdeIso, tz)}` : null,
        hasta ? `hasta el ${hasta}` : null,
        i.prorroga ? '(prórroga)' : null,
      ]
        .filter(Boolean)
        .join(' ');
    }),
  );

  agregar(
    'Interconsultas',
    r.interconsultas.map((c) => [c.especialidad, c.observacion].filter(Boolean).join(': ')),
  );

  return secciones;
}

/** Último día de la incapacidad: desde + días − 1 (Colombia no cambia de hora). */
export function hastaDeIncapacidad(desdeIso: string | null, dias: number | null, timeZone?: string): string | null {
  if (!desdeIso || !dias || dias < 1) return null;
  const desde = Date.parse(desdeIso);
  if (Number.isNaN(desde)) return null;
  return formatDateShort(new Date(desde + (dias - 1) * 86_400_000), { timeZone });
}

/** «01/11/2026 09:07 a m»: la fecha y hora de la consulta en los documentos. */
export function fechaHoraDocumento(iso: string, timeZone?: string): string {
  return formatAppointmentShort(iso, { timeZone });
}

// ─── Datos del hospital para el encabezado (se copian una vez de `ENTIDAD`) ─

export interface ConfigDocumentosResumen {
  encabezado: { nombre: string | null; nit: string | null; direccion: string | null; telefono: string | null };
  /** Logo en PNG o JPEG, en base64 sin el prefijo `data:`. */
  logo: string | null;
  /** D21: mientras el hospital no apruebe el documento para reclamar, va la marca de agua. */
  marcaDeAgua: string;
  /** Pie del resumen; `null` = `PIE_RESUMEN_POR_DEFECTO`. */
  pie: string | null;
  /** D19: mostrar la frecuencia del HIS cuando el médico no escribió la indicación. Apagada por defecto. */
  frecuenciaDelHis: boolean;
}

export const LIMITES_DOCUMENTOS_RESUMEN = {
  nombre: 120,
  nit: 30,
  direccion: 150,
  telefono: 60,
  marcaDeAgua: 60,
  pie: 400,
  /** Logo en base64: ~150 KB de imagen. */
  logoBase64: 200_000,
} as const;

export const MARCA_DE_AGUA_POR_DEFECTO = 'Copia para el paciente';

function textoONull(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t && t.length <= max ? t : null;
}

/** El logo solo si es un PNG o un JPEG en base64 de tamaño razonable. */
function logoValido(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  if (!t || t.length > LIMITES_DOCUMENTOS_RESUMEN.logoBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  return t.startsWith('iVBORw0KGgo') || t.startsWith('/9j/') ? t : null;
}

/** Lee `resumenAtencion.documentos`. Lo que falta toma su valor por defecto; la marca de agua nunca queda vacía. */
export function leerConfigDocumentos(json: unknown): ConfigDocumentosResumen {
  const d = esObjeto(json) && esObjeto(json.documentos) ? json.documentos : {};
  const e = esObjeto(d.encabezado) ? d.encabezado : {};
  const L = LIMITES_DOCUMENTOS_RESUMEN;
  return {
    encabezado: {
      nombre: textoONull(e.nombre, L.nombre),
      nit: textoONull(e.nit, L.nit),
      direccion: textoONull(e.direccion, L.direccion),
      telefono: textoONull(e.telefono, L.telefono),
    },
    logo: logoValido(d.logo),
    marcaDeAgua: textoONull(d.marcaDeAgua, L.marcaDeAgua) ?? MARCA_DE_AGUA_POR_DEFECTO,
    pie: textoONull(d.pie, L.pie),
    frecuenciaDelHis: d.frecuenciaDelHis === true,
  };
}

export interface CambioDocumentosResumen {
  nombre?: string;
  nit?: string;
  direccion?: string;
  telefono?: string;
  pie?: string;
  /** PNG o JPEG en base64; cadena vacía = quitar el logo. */
  logo?: string;
  /** D19: mostrar la frecuencia del HIS cuando el médico no escribió la indicación. */
  frecuenciaDelHis?: boolean;
}

const ETIQUETA_CAMBIO: Record<keyof Omit<CambioDocumentosResumen, 'logo' | 'frecuenciaDelHis'>, string> = {
  nombre: 'Nombre del hospital',
  nit: 'NIT',
  direccion: 'Dirección',
  telefono: 'Teléfono',
  pie: 'Pie del resumen',
};

/**
 * Aplica lo que el panel cambia de los documentos (encabezado, logo y pie) sin
 * tocar el resto de la configuración. La marca de agua no se cambia aquí:
 * quitarla es aprobar el documento para reclamar (D21).
 */
export function aplicarCambioDeDocumentos(
  json: unknown,
  cambio: CambioDocumentosResumen,
): { ok: true; config: Record<string, unknown>; cambios: string[] } | { ok: false; error: string } {
  const base: Record<string, unknown> = esObjeto(json) ? { ...json } : {};
  const previo = esObjeto(base.documentos) ? { ...base.documentos } : {};
  const antes = leerConfigDocumentos(base);
  const encabezado: Record<string, unknown> = { ...antes.encabezado };
  const cambios: string[] = [];
  const L = LIMITES_DOCUMENTOS_RESUMEN;

  for (const campo of ['nombre', 'nit', 'direccion', 'telefono'] as const) {
    const v = cambio[campo];
    if (v === undefined) continue;
    if (typeof v !== 'string') return { ok: false, error: `${ETIQUETA_CAMBIO[campo]}: valor inválido.` };
    const t = v.trim();
    if (t.length > L[campo]) return { ok: false, error: `${ETIQUETA_CAMBIO[campo]}: máximo ${L[campo]} caracteres.` };
    const nuevo = t || null;
    if (nuevo !== antes.encabezado[campo]) cambios.push(`${ETIQUETA_CAMBIO[campo]}: «${antes.encabezado[campo] ?? ''}» → «${nuevo ?? ''}»`);
    encabezado[campo] = nuevo;
  }
  previo.encabezado = encabezado;

  if (cambio.pie !== undefined) {
    if (typeof cambio.pie !== 'string') return { ok: false, error: 'Pie del resumen: valor inválido.' };
    const t = cambio.pie.trim();
    if (t.length > L.pie) return { ok: false, error: `Pie del resumen: máximo ${L.pie} caracteres.` };
    if ((t || null) !== antes.pie) cambios.push('Pie del resumen cambiado');
    previo.pie = t || null;
  }

  if (cambio.logo !== undefined) {
    if (cambio.logo === '') {
      if (antes.logo) cambios.push('Logo quitado');
      previo.logo = null;
    } else {
      const logo = logoValido(cambio.logo);
      if (!logo) return { ok: false, error: 'El logo debe ser una imagen PNG o JPEG de máximo 150 KB.' };
      if (logo !== antes.logo) cambios.push('Logo cambiado');
      previo.logo = logo;
    }
  }

  if (cambio.frecuenciaDelHis !== undefined) {
    const nueva = cambio.frecuenciaDelHis === true;
    if (nueva !== antes.frecuenciaDelHis) {
      cambios.push(`Frecuencia del HIS cuando no hay indicación: ${antes.frecuenciaDelHis ? 'sí' : 'no'} → ${nueva ? 'sí' : 'no'}`);
    }
    previo.frecuenciaDelHis = nueva;
  }

  base.documentos = previo;
  return { ok: true, config: base, cambios };
}

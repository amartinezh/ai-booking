/**
 * ══════════════════════════════════════════════════════════════════════════
 * 📢 MENSAJES MASIVOS — leer contactos de «lo que sea» (docs/PLAN_MENSAJES_MASIVOS.md §4)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * La clínica sube lo que tenga a mano: un CSV o un Excel (la web lo convierte a
 * CSV con `xlsxToCsv`), una exportación de Google Contactos u Outlook, un .vcf del
 * celular, o un listado pegado de WhatsApp o de un correo. Aquí se decide, sin IA,
 * qué es cada columna:
 *
 *  1. el FORMATO: vCard, tabla (con su separador: coma, punto y coma, tabulador o
 *     barra) o texto libre (una persona por línea);
 *  2. si la primera fila es ENCABEZADO (no trae celulares ni correos y sus celdas
 *     se parecen a nombres de columna);
 *  3. el TIPO de cada columna, sumando dos pistas: el encabezado («Celular»,
 *     «E-mail», «Given Name»…) y el CONTENIDO (cuántas celdas son celulares,
 *     correos, documentos o nombres). El contenido manda si contradice al encabezado
 *     con claridad (una columna «Teléfono» llena de correos es de correos).
 *
 * Si la confianza queda baja, la pantalla ofrece pedirle a la IA el mapeo de
 * columnas (solo encabezados y 5 filas enmascaradas: `muestraParaIa`), y siempre
 * deja corregirlo a mano. Con el mapeo final, `extraerContactos` normaliza cada
 * fila. La web lo corre en el navegador para mostrar el resultado al instante, y
 * el servidor lo vuelve a validar al guardar (`normalizarContacto`): nunca se
 * confía en el paso anterior.
 *
 * Puro: sin base de datos ni APIs del navegador.
 */

export type TipoColumna =
  | 'NOMBRE_COMPLETO'
  | 'NOMBRES'
  | 'APELLIDOS'
  | 'CELULAR'
  | 'TELEFONO'
  | 'CORREO'
  | 'DOCUMENTO'
  | 'OTRO'
  | 'IGNORAR';

export const TIPOS_DE_COLUMNA: ReadonlyArray<{ tipo: TipoColumna; etiqueta: string }> = [
  { tipo: 'NOMBRE_COMPLETO', etiqueta: 'Nombre completo' },
  { tipo: 'NOMBRES', etiqueta: 'Nombres' },
  { tipo: 'APELLIDOS', etiqueta: 'Apellidos' },
  { tipo: 'CELULAR', etiqueta: 'Celular (WhatsApp)' },
  { tipo: 'TELEFONO', etiqueta: 'Otro teléfono' },
  { tipo: 'CORREO', etiqueta: 'Correo electrónico' },
  { tipo: 'DOCUMENTO', etiqueta: 'Documento' },
  { tipo: 'OTRO', etiqueta: 'Otro dato (se guarda)' },
  { tipo: 'IGNORAR', etiqueta: 'No usar' },
];

export type FormatoContactos = 'TABLA' | 'VCARD' | 'TEXTO_LIBRE';

export interface ColumnaDetectada {
  indice: number;
  encabezado: string;
  tipo: TipoColumna;
  /** 0 a 1: qué tan seguro está el detector. */
  confianza: number;
  /** Por qué se eligió ese tipo, en palabras de la pantalla. */
  motivo: string;
  /** Hasta 3 valores de ejemplo. */
  muestra: string[];
}

export interface AnalisisContactos {
  formato: FormatoContactos;
  separador: string | null;
  tieneEncabezado: boolean;
  columnas: ColumnaDetectada[];
  /** Las filas de datos, celda por celda (sin el encabezado). */
  filas: string[][];
  confianza: 'ALTA' | 'MEDIA' | 'BAJA';
  /** Líneas que no se pudieron leer (vacías o rotas), para contarlas. */
  lineasIgnoradas: number;
}

export interface ContactoImportado {
  /** Fila del archivo (1 = primera fila de datos). */
  fila: number;
  nombreCompleto: string | null;
  /** El primer nombre, para el saludo («Hola Ana»). */
  primerNombre: string | null;
  /** E.164 con «+» (ej. «+573001234567»). */
  celular: string;
  correo: string | null;
  documento: string | null;
  /** Columnas «Otro dato» con su encabezado. */
  extras: Record<string, string>;
}

export type MotivoProblemaContacto =
  | 'SIN_CELULAR'
  | 'CELULAR_INVALIDO'
  | 'TELEFONO_FIJO'
  | 'DUPLICADO'
  | 'CORREO_INVALIDO'
  | 'SIN_NOMBRE';

export interface ProblemaContacto {
  fila: number;
  motivo: MotivoProblemaContacto;
  /** `true` = la fila no entra a la lista; `false` = entra con el aviso. */
  descarta: boolean;
  mensaje: string;
}

export interface ResultadoContactos {
  contactos: ContactoImportado[];
  problemas: ProblemaContacto[];
  resumen: {
    filas: number;
    validos: number;
    sinCelular: number;
    celularInvalido: number;
    fijos: number;
    duplicados: number;
    correosInvalidos: number;
    sinNombre: number;
  };
}

/** Lo más que se acepta en una lista: más que eso no es una lista de una clínica. */
export const MAX_CONTACTOS_POR_ARCHIVO = 20_000;

// ─── Normalización de valores ───────────────────────────────────────────────

const quitarTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Para comparar encabezados: minúsculas, sin tildes, solo letras y números. */
export function normalizarEncabezado(s: string): string {
  return quitarTildes(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CORREO_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const CORREO_EN_TEXTO_RE = /[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}/gi;

/** El correo en minúsculas si es válido; `null` si no. */
export function normalizarCorreo(crudo: string | null | undefined): string | null {
  const c = (crudo ?? '').trim().replace(/^mailto:/i, '').toLowerCase();
  return CORREO_RE.test(c) ? c : null;
}

export type ClaseTelefono = 'CELULAR' | 'FIJO' | 'INVALIDO';

/**
 * Un teléfono a E.164. Un celular colombiano tiene 10 dígitos y empieza por 3
 * (con o sin 57/+57 delante). Un número internacional se acepta si viene con «+» o
 * «00» y tiene entre 8 y 15 dígitos (un paciente con celular de otro país). Un
 * fijo colombiano (601…, 604…, o de 7 dígitos) no tiene WhatsApp.
 */
export function clasificarTelefono(crudo: string | null | undefined): { clase: ClaseTelefono; e164: string | null } {
  const t = (crudo ?? '').trim();
  if (!t) return { clase: 'INVALIDO', e164: null };
  let d = t.replace(/\D/g, '');
  if (t.startsWith('00')) d = d.slice(2);
  if (t.startsWith('+') || t.startsWith('00')) {
    // Con indicativo: si es el de Colombia se valida como número nacional; si
    // no, se acepta cualquier número E.164 (de un fijo extranjero no se sabe).
    if (d.startsWith('57')) d = d.slice(2);
    else return d.length >= 8 && d.length <= 15 ? { clase: 'CELULAR', e164: `+${d}` } : { clase: 'INVALIDO', e164: null };
  } else if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  if (/^3\d{9}$/.test(d)) return { clase: 'CELULAR', e164: `+57${d}` };
  if (/^60\d{8}$/.test(d) || /^\d{7}$/.test(d)) return { clase: 'FIJO', e164: null };
  return { clase: 'INVALIDO', e164: null };
}

/** Los teléfonos que hay dentro de un texto («300 123 4567 / 3109876543»). */
export function telefonosEnTexto(texto: string): string[] {
  const candidatos = texto.match(/(\+|00)?\d[\d\s().-]{6,}\d/g) ?? [];
  return candidatos.map((c) => c.trim());
}

/** «JUAN  pérez» → «Juan Pérez». Conserva las partículas en minúscula («de la»). */
export function nombrePropio(crudo: string | null | undefined): string | null {
  const limpio = (crudo ?? '')
    .replace(/[^\p{L}\s'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpio || !/\p{L}/u.test(limpio)) return null;
  const particulas = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return limpio
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && particulas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** El documento como dígitos (5 a 12), o `null`. */
export function normalizarDocumentoContacto(crudo: string | null | undefined): string | null {
  const d = (crudo ?? '').replace(/[.\s-]/g, '');
  return /^[0-9]{5,12}$/.test(d) ? d : null;
}

// ─── Lectura de tablas ──────────────────────────────────────────────────────

const SEPARADORES = [',', ';', '\t', '|'] as const;

/** Parte una línea de una tabla respetando las comillas («"Pérez, Ana"»). */
export function partirLinea(linea: string, sep: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else enComillas = !enComillas;
    } else if (c === sep && !enComillas) {
      celdas.push(actual.trim());
      actual = '';
    } else actual += c;
  }
  celdas.push(actual.trim());
  return celdas;
}

/** Une las líneas que quedaron partidas por un salto dentro de comillas. */
function lineasLogicas(texto: string): string[] {
  const fisicas = texto.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const salida: string[] = [];
  let pendiente: string | null = null;
  for (const l of fisicas) {
    const actual: string = pendiente === null ? l : `${pendiente} ${l}`;
    const comillas = (actual.match(/"/g) ?? []).length;
    if (comillas % 2 === 1) pendiente = actual;
    else {
      salida.push(actual);
      pendiente = null;
    }
  }
  if (pendiente !== null) salida.push(pendiente);
  return salida;
}

/** El separador que da el mismo número de columnas (más de una) en más líneas. */
function detectarSeparador(lineas: string[]): string | null {
  const muestra = lineas.filter((l) => l.trim()).slice(0, 30);
  let mejor: { sep: string; puntaje: number } | null = null;
  for (const sep of SEPARADORES) {
    const cuentas = muestra.map((l) => partirLinea(l, sep).length);
    const moda = modaDe(cuentas);
    if (moda < 2) continue;
    const coinciden = cuentas.filter((c) => c === moda).length / muestra.length;
    const puntaje = coinciden * 10 + Math.min(moda, 8) * 0.1;
    if (coinciden >= 0.6 && (!mejor || puntaje > mejor.puntaje)) mejor = { sep, puntaje };
  }
  return mejor?.sep ?? null;
}

function modaDe(valores: number[]): number {
  const cuenta = new Map<number, number>();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  let moda = 0;
  let max = 0;
  for (const [v, n] of cuenta) if (n > max || (n === max && v > moda)) [moda, max] = [v, n];
  return moda;
}

// ─── Encabezados conocidos ──────────────────────────────────────────────────

/**
 * Sinónimos por tipo, ya normalizados. Incluye las exportaciones de Google
 * Contactos («Given Name», «Phone 1 - Value») y de Outlook («Mobile Phone»).
 */
const SINONIMOS: Record<Exclude<TipoColumna, 'OTRO' | 'IGNORAR'>, string[]> = {
  NOMBRE_COMPLETO: [
    'nombre', 'nombre completo', 'nombres y apellidos', 'nombre y apellido', 'nombre del paciente', 'paciente',
    'cliente', 'contacto', 'usuario', 'name', 'full name', 'display name', 'nombre paciente', 'beneficiario', 'afiliado',
  ],
  NOMBRES: ['nombres', 'primer nombre', 'segundo nombre', 'given name', 'first name', 'nombre s', 'nombre1', 'nombre 1'],
  APELLIDOS: [
    'apellido', 'apellidos', 'primer apellido', 'segundo apellido', 'family name', 'last name', 'surname',
    'apellido1', 'apellido 1', 'apellido2', 'apellido 2',
  ],
  CELULAR: [
    'celular', 'cel', 'movil', 'telefono movil', 'telefono celular', 'numero celular', 'numero de celular', 'whatsapp',
    'wsp', 'wa', 'numero whatsapp', 'mobile', 'mobile phone', 'cell', 'cellphone', 'phone 1 value', 'telefono 1',
    'celular 1', 'tel celular', 'contacto celular', 'telefono whatsapp',
  ],
  TELEFONO: [
    'telefono', 'tel', 'telefono fijo', 'fijo', 'phone', 'telefono 2', 'celular 2', 'phone 2 value', 'otro telefono',
    'home phone', 'business phone', 'telefonos', 'numero de telefono',
  ],
  CORREO: [
    'correo', 'email', 'e mail', 'mail', 'correo electronico', 'e mail 1 value', 'email address', 'e mail address',
    'correo e', 'direccion de correo', 'email 1',
  ],
  DOCUMENTO: [
    'documento', 'cedula', 'cc', 'identificacion', 'numero de documento', 'nro documento', 'no documento',
    'documento de identidad', 'numero de identificacion', 'num documento', 'id', 'dni', 'nit', 'tarjeta de identidad',
  ],
};

function tipoPorEncabezado(encabezado: string): { tipo: TipoColumna; exacto: boolean } | null {
  const e = normalizarEncabezado(encabezado);
  if (!e) return null;
  for (const [tipo, lista] of Object.entries(SINONIMOS) as [TipoColumna, string[]][]) {
    if (lista.includes(e)) return { tipo, exacto: true };
  }
  // Contiene la palabra («Teléfono celular del paciente», «Correo personal»).
  if (/(celular|movil|whatsapp|mobile)/.test(e)) return { tipo: 'CELULAR', exacto: false };
  if (/(correo|e mail|email)/.test(e)) return { tipo: 'CORREO', exacto: false };
  if (/(apellido|surname|last name)/.test(e)) return { tipo: 'APELLIDOS', exacto: false };
  if (/(cedula|documento|identificacion)/.test(e)) return { tipo: 'DOCUMENTO', exacto: false };
  if (/(telefono|phone|\btel\b)/.test(e)) return { tipo: 'TELEFONO', exacto: false };
  if (/(nombre|name)/.test(e)) return { tipo: 'NOMBRE_COMPLETO', exacto: false };
  return null;
}

// ─── Lo que dice el contenido de una columna ────────────────────────────────

interface PerfilColumna {
  noVacias: number;
  celulares: number;
  fijos: number;
  correos: number;
  documentos: number;
  nombresVarios: number;
  palabraSola: number;
}

function perfilDe(valores: string[]): PerfilColumna {
  const p: PerfilColumna = { noVacias: 0, celulares: 0, fijos: 0, correos: 0, documentos: 0, nombresVarios: 0, palabraSola: 0 };
  for (const v of valores) {
    const t = v.trim();
    if (!t) continue;
    p.noVacias++;
    if (normalizarCorreo(t)) {
      p.correos++;
      continue;
    }
    const tel = clasificarTelefono(telefonosEnTexto(t)[0] ?? t);
    if (/\d/.test(t) && tel.clase === 'CELULAR' && t.replace(/\D/g, '').length >= 10) {
      p.celulares++;
      continue;
    }
    if (tel.clase === 'FIJO') {
      p.fijos++;
      continue;
    }
    if (normalizarDocumentoContacto(t)) {
      p.documentos++;
      continue;
    }
    const letras = t.replace(/[^\p{L}\s]/gu, '').trim();
    if (letras.length >= 2 && letras.length >= t.replace(/\s/g, '').length * 0.8) {
      if (letras.split(/\s+/).length >= 2) p.nombresVarios++;
      else p.palabraSola++;
    }
  }
  return p;
}

function tipoPorContenido(p: PerfilColumna): { tipo: TipoColumna; fraccion: number } {
  if (p.noVacias === 0) return { tipo: 'IGNORAR', fraccion: 1 };
  const f = (n: number) => n / p.noVacias;
  const opciones: Array<{ tipo: TipoColumna; fraccion: number }> = [
    { tipo: 'CELULAR', fraccion: f(p.celulares) },
    { tipo: 'TELEFONO', fraccion: f(p.fijos) },
    { tipo: 'CORREO', fraccion: f(p.correos) },
    { tipo: 'DOCUMENTO', fraccion: f(p.documentos) },
    { tipo: 'NOMBRE_COMPLETO', fraccion: f(p.nombresVarios) },
    { tipo: 'NOMBRES', fraccion: f(p.palabraSola) },
  ];
  // Una columna de teléfonos mezcla celulares y fijos: cuenta como celular si hay celulares.
  if (p.celulares > 0 && f(p.celulares + p.fijos) >= 0.6) return { tipo: 'CELULAR', fraccion: f(p.celulares + p.fijos) };
  const mejor = opciones.reduce((a, b) => (b.fraccion > a.fraccion ? b : a));
  return mejor.fraccion >= 0.5 ? mejor : { tipo: 'OTRO', fraccion: mejor.fraccion };
}

const ETIQUETA: Record<TipoColumna, string> = Object.fromEntries(
  TIPOS_DE_COLUMNA.map((t) => [t.tipo, t.etiqueta.toLowerCase()]),
) as Record<TipoColumna, string>;

/** ¿La primera fila parece un encabezado? Sin celulares ni correos, y con alguna palabra conocida o solo texto corto. */
function pareceEncabezado(primera: string[], resto: string[][]): boolean {
  if (primera.some((c) => normalizarCorreo(c) || clasificarTelefono(c).clase === 'CELULAR')) return false;
  if (primera.some((c) => tipoPorEncabezado(c)?.exacto)) return true;
  // Sin palabras conocidas: es encabezado si debajo hay celulares o correos donde arriba hay texto.
  const conDatos = primera.some((c, i) => {
    const col = resto.slice(0, 20).map((f) => f[i] ?? '');
    const p = perfilDe(col);
    return c.trim() && !/\d/.test(c) && (p.celulares + p.correos) / Math.max(1, p.noVacias) >= 0.5;
  });
  return conDatos;
}

/** Decide el tipo de cada columna con el encabezado y el contenido. */
function detectarColumnas(encabezados: string[], filas: string[][]): ColumnaDetectada[] {
  const n = Math.max(encabezados.length, ...filas.slice(0, 200).map((f) => f.length));
  const columnas: ColumnaDetectada[] = [];
  for (let i = 0; i < n; i++) {
    const encabezado = encabezados[i]?.trim() || `Columna ${i + 1}`;
    const valores = filas.slice(0, 500).map((f) => f[i] ?? '');
    const perfil = perfilDe(valores);
    const porContenido = tipoPorContenido(perfil);
    const porEncabezado = encabezados[i] ? tipoPorEncabezado(encabezados[i]) : null;
    const muestra = valores.filter((v) => v.trim()).slice(0, 3);
    let tipo: TipoColumna;
    let confianza: number;
    let motivo: string;
    const datoDuro = (t: TipoColumna) => t === 'CELULAR' || t === 'CORREO' || t === 'DOCUMENTO' || t === 'TELEFONO';
    if (porEncabezado && porContenido.tipo === 'IGNORAR') {
      tipo = 'IGNORAR';
      confianza = 0.9;
      motivo = 'La columna está vacía.';
    } else if (porEncabezado && (porEncabezado.tipo === porContenido.tipo || compatibles(porEncabezado.tipo, porContenido.tipo))) {
      tipo = porEncabezado.tipo === 'TELEFONO' && porContenido.tipo === 'CELULAR' ? 'CELULAR' : porEncabezado.tipo;
      confianza = 0.95;
      motivo = `El encabezado «${encabezado}» y el contenido coinciden.`;
    } else if (porEncabezado && datoDuro(porContenido.tipo) && porContenido.fraccion >= 0.7) {
      tipo = porContenido.tipo;
      confianza = 0.75;
      motivo = `Dice «${encabezado}», pero el ${Math.round(porContenido.fraccion * 100)} % de las celdas son ${ETIQUETA[porContenido.tipo]}.`;
    } else if (porEncabezado) {
      const contradice = datoDuro(porEncabezado.tipo) && porContenido.tipo === 'OTRO';
      tipo = porEncabezado.tipo;
      confianza = contradice ? 0.4 : porEncabezado.exacto ? 0.7 : 0.55;
      motivo = contradice
        ? `Dice «${encabezado}», pero casi ninguna celda lo parece: revíselo.`
        : `Por el encabezado «${encabezado}».`;
    } else if (porContenido.tipo !== 'OTRO') {
      tipo = porContenido.tipo;
      confianza = 0.4 + porContenido.fraccion * 0.45;
      motivo = `El ${Math.round(porContenido.fraccion * 100)} % de las celdas son ${ETIQUETA[porContenido.tipo]}.`;
    } else {
      tipo = 'OTRO';
      confianza = 0.3;
      motivo = 'No se reconoce: se guarda como otro dato.';
    }
    columnas.push({ indice: i, encabezado, tipo, confianza, motivo, muestra });
  }
  return resolverChoques(columnas);
}

function compatibles(encabezado: TipoColumna, contenido: TipoColumna): boolean {
  if (encabezado === 'TELEFONO' && contenido === 'CELULAR') return true;
  const nombres: TipoColumna[] = ['NOMBRE_COMPLETO', 'NOMBRES', 'APELLIDOS'];
  return nombres.includes(encabezado) && nombres.includes(contenido);
}

/**
 * Una sola columna de celular (la de más confianza; las demás pasan a «Otro
 * teléfono»), y dos columnas de una sola palabra seguidas sin encabezado son
 * nombres y apellidos.
 */
function resolverChoques(columnas: ColumnaDetectada[]): ColumnaDetectada[] {
  const celulares = columnas.filter((c) => c.tipo === 'CELULAR').sort((a, b) => b.confianza - a.confianza);
  for (const c of celulares.slice(1)) {
    c.tipo = 'TELEFONO';
    c.motivo = `${c.motivo} Ya hay otra columna de celular: esta queda como otro teléfono, de respaldo.`;
  }
  const completos = columnas.filter((c) => c.tipo === 'NOMBRE_COMPLETO');
  const tienePartes = columnas.some((c) => c.tipo === 'NOMBRES') && columnas.some((c) => c.tipo === 'APELLIDOS');
  if (tienePartes) {
    for (const c of completos) if (c.confianza < 0.9) c.tipo = 'OTRO';
  } else if (completos.length > 1) {
    for (const c of completos.sort((a, b) => b.confianza - a.confianza).slice(1)) {
      c.tipo = 'OTRO';
      c.motivo = `${c.motivo} Ya hay otra columna de nombre.`;
    }
  }
  for (let i = 0; i + 1 < columnas.length; i++) {
    const a = columnas[i];
    const b = columnas[i + 1];
    if (a.tipo === 'NOMBRES' && b.tipo === 'NOMBRES') {
      b.tipo = 'APELLIDOS';
      b.motivo = 'Una sola palabra, al lado de la columna de nombres: se toma como apellidos.';
    }
  }
  return columnas;
}

// ─── vCard y texto libre ────────────────────────────────────────────────────

function leerVcard(texto: string): string[][] {
  const tarjetas = texto.split(/BEGIN:VCARD/i).slice(1);
  return tarjetas.map((t) => {
    const lineas = t.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const valor = (re: RegExp) => lineas.find((l) => re.test(l))?.replace(/^[^:]*:/, '').trim() ?? '';
    let nombre = valor(/^FN[;:]/i);
    if (!nombre) {
      const [apellidos = '', nombres = ''] = valor(/^N[;:]/i).split(';');
      nombre = `${nombres} ${apellidos}`.trim();
    }
    const tels = lineas.filter((l) => /^(item\d+\.)?TEL/i.test(l));
    const movil = tels.find((l) => /CELL|MOBILE|IPHONE|WHATSAPP/i.test(l)) ?? tels[0] ?? '';
    const otro = tels.find((l) => l !== movil) ?? '';
    return [
      nombre.replace(/\\,/g, ','),
      movil.replace(/^[^:]*:/, '').trim(),
      valor(/^(item\d+\.)?EMAIL/i),
      otro.replace(/^[^:]*:/, '').trim(),
    ];
  });
}

/** Una persona por línea: se sacan el celular y el correo, y lo que queda es el nombre. */
function leerTextoLibre(lineas: string[]): string[][] {
  return lineas
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const correo = l.match(CORREO_EN_TEXTO_RE)?.[0] ?? '';
      const sinCorreo = correo ? l.replace(correo, ' ') : l;
      const tels = telefonosEnTexto(sinCorreo);
      let resto = sinCorreo;
      for (const t of tels) resto = resto.replace(t, ' ');
      const nombre = resto
        .replace(/^\s*\d+[.)-]\s+/, '')
        .replace(/[,;:|\t<>()[\]*•·-]+/g, ' ')
        .replace(/\b(cel|celular|tel|telefono|teléfono|whatsapp|correo|email)\b\.?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return [nombre, tels[0] ?? '', correo, tels[1] ?? ''];
    });
}

// ─── Análisis ───────────────────────────────────────────────────────────────

/** Mira el archivo y propone qué es cada columna. No descarta nada todavía. */
export function analizarArchivoDeContactos(texto: string): AnalisisContactos {
  const limpio = (texto ?? '').replace(/^﻿/, '');
  if (/BEGIN:VCARD/i.test(limpio)) {
    const filas = leerVcard(limpio);
    return {
      formato: 'VCARD',
      separador: null,
      tieneEncabezado: false,
      columnas: [
        columnaFija(0, 'Nombre', 'NOMBRE_COMPLETO', filas),
        columnaFija(1, 'Celular', 'CELULAR', filas),
        columnaFija(2, 'Correo', 'CORREO', filas),
        columnaFija(3, 'Otro teléfono', 'TELEFONO', filas),
      ],
      filas,
      confianza: 'ALTA',
      lineasIgnoradas: 0,
    };
  }

  const todas = lineasLogicas(limpio);
  const lineas = todas.filter((l) => l.trim());
  const lineasIgnoradas = todas.length - lineas.length;
  const sep = detectarSeparador(lineas);

  if (!sep) {
    const filas = leerTextoLibre(lineas);
    const conCelular = filas.filter((f) => f[1]).length;
    return {
      formato: 'TEXTO_LIBRE',
      separador: null,
      tieneEncabezado: false,
      columnas: [
        columnaFija(0, 'Nombre', 'NOMBRE_COMPLETO', filas),
        columnaFija(1, 'Celular', 'CELULAR', filas),
        columnaFija(2, 'Correo', 'CORREO', filas),
        columnaFija(3, 'Otro teléfono', 'TELEFONO', filas),
      ],
      filas,
      confianza: filas.length && conCelular / filas.length >= 0.7 ? 'MEDIA' : 'BAJA',
      lineasIgnoradas,
    };
  }

  const crudas = lineas.map((l) => partirLinea(l, sep));
  // Un preámbulo («Listado de pacientes — octubre») tiene menos columnas que la tabla.
  const ancho = modaDe(crudas.slice(0, 50).map((f) => f.length));
  let inicio = 0;
  while (inicio < crudas.length - 1 && inicio < 10 && crudas[inicio].filter((c) => c).length < Math.min(2, ancho)) inicio++;
  const tabla = crudas.slice(inicio);
  const tieneEncabezado = tabla.length > 0 && pareceEncabezado(tabla[0], tabla.slice(1));
  const encabezados = tieneEncabezado ? tabla[0] : [];
  const filas = (tieneEncabezado ? tabla.slice(1) : tabla).filter((f) => f.some((c) => c.trim()));
  const columnas = detectarColumnas(encabezados, filas);
  return {
    formato: 'TABLA',
    separador: sep,
    tieneEncabezado,
    columnas,
    filas,
    confianza: confianzaGlobal(columnas),
    lineasIgnoradas: lineasIgnoradas + inicio,
  };
}

function columnaFija(indice: number, encabezado: string, tipo: TipoColumna, filas: string[][]): ColumnaDetectada {
  return {
    indice,
    encabezado,
    tipo,
    confianza: 0.9,
    motivo: 'Leído del formato del archivo.',
    muestra: filas.map((f) => f[indice] ?? '').filter(Boolean).slice(0, 3),
  };
}

function confianzaGlobal(columnas: ColumnaDetectada[]): 'ALTA' | 'MEDIA' | 'BAJA' {
  const celular = columnas.find((c) => c.tipo === 'CELULAR');
  if (!celular) return 'BAJA';
  const nombre = columnas.find((c) => c.tipo === 'NOMBRE_COMPLETO' || c.tipo === 'NOMBRES');
  const dudosas = columnas.filter((c) => c.tipo !== 'IGNORAR' && c.confianza < 0.6).length;
  if (celular.confianza >= 0.75 && nombre && nombre.confianza >= 0.6 && dudosas === 0) return 'ALTA';
  return celular.confianza >= 0.6 ? 'MEDIA' : 'BAJA';
}

// ─── Lo que se le muestra a la IA ───────────────────────────────────────────

/**
 * Encabezados y hasta 5 filas para que la IA proponga el mapeo, con los datos
 * de contacto TAPADOS: los dígitos de en medio y el usuario del correo
 * («300•••67», «a•••@gmail.com»). La forma basta para reconocer la columna; el
 * dato no le hace falta a la IA (minimización, Ley 1581).
 */
export function muestraParaIa(analisis: AnalisisContactos): { encabezados: string[]; filas: string[][] } {
  const tapar = (v: string): string => {
    const t = v.trim();
    if (!t) return '';
    const correo = t.match(/^([^@\s]+)@(.+)$/);
    if (correo) return `${correo[1].charAt(0)}•••@${correo[2]}`;
    if (/\d{5,}/.test(t.replace(/[\s().-]/g, ''))) {
      return t.replace(/\d[\d\s().-]*\d/g, (m) => {
        const d = m.replace(/\D/g, '');
        return d.length <= 4 ? m : `${d.slice(0, 3)}${'•'.repeat(Math.max(1, d.length - 5))}${d.slice(-2)}`;
      });
    }
    return t.length > 40 ? `${t.slice(0, 40)}…` : t;
  };
  return {
    encabezados: analisis.columnas.map((c) => (analisis.tieneEncabezado ? c.encabezado : '')),
    filas: analisis.filas.slice(0, 5).map((f) => analisis.columnas.map((c) => tapar(f[c.indice] ?? ''))),
  };
}

/** Lee lo que contestó la IA: un tipo válido por columna, o `null` si no sirve. */
export function leerMapeoDeIa(respuesta: unknown, columnas: number): TipoColumna[] | null {
  const lista = (respuesta as { columnas?: unknown })?.columnas;
  if (!Array.isArray(lista)) return null;
  const validos = new Set(TIPOS_DE_COLUMNA.map((t) => t.tipo));
  const mapeo: TipoColumna[] = Array.from({ length: columnas }, () => 'OTRO' as TipoColumna);
  let alguno = false;
  for (const item of lista) {
    const indice = Number((item as { indice?: unknown })?.indice);
    const tipo = String((item as { tipo?: unknown })?.tipo ?? '').toUpperCase() as TipoColumna;
    if (Number.isInteger(indice) && indice >= 0 && indice < columnas && validos.has(tipo)) {
      mapeo[indice] = tipo;
      alguno = true;
    }
  }
  return alguno ? mapeo : null;
}

// ─── Extracción ─────────────────────────────────────────────────────────────

/**
 * Convierte las filas en contactos con el mapeo de columnas (el detectado o el
 * que corrigió la persona). Descarta las filas sin un celular que pueda recibir
 * WhatsApp y los celulares repetidos (se queda la primera fila); avisa, sin
 * descartar, de los correos inválidos y las filas sin nombre.
 */
export function extraerContactos(analisis: AnalisisContactos, mapeo?: TipoColumna[]): ResultadoContactos {
  const tipos = mapeo ?? analisis.columnas.map((c) => c.tipo);
  const indices = (t: TipoColumna) => tipos.map((x, i) => (x === t ? i : -1)).filter((i) => i >= 0);
  const colCelular = indices('CELULAR');
  const colTelefono = indices('TELEFONO');
  const colCorreo = indices('CORREO');
  const colDocumento = indices('DOCUMENTO');
  const colCompleto = indices('NOMBRE_COMPLETO');
  const colNombres = indices('NOMBRES');
  const colApellidos = indices('APELLIDOS');
  const colOtros = indices('OTRO');

  const contactos: ContactoImportado[] = [];
  const problemas: ProblemaContacto[] = [];
  const vistos = new Map<string, number>();
  const resumen = { filas: 0, validos: 0, sinCelular: 0, celularInvalido: 0, fijos: 0, duplicados: 0, correosInvalidos: 0, sinNombre: 0 };

  const celdas = (fila: string[], cols: number[]) => cols.map((i) => (fila[i] ?? '').trim()).filter(Boolean);

  analisis.filas.slice(0, MAX_CONTACTOS_POR_ARCHIVO).forEach((fila, k) => {
    const n = k + 1;
    resumen.filas++;

    // El celular: el primero que sirva entre la columna de celular y las de otros teléfonos.
    const candidatos = [...celdas(fila, colCelular), ...celdas(fila, colTelefono)].flatMap((c) => {
      const dentro = telefonosEnTexto(c);
      return dentro.length ? dentro : [c];
    });
    const clasificados = candidatos.map((c) => ({ crudo: c, ...clasificarTelefono(c) }));
    const celular = clasificados.find((c) => c.clase === 'CELULAR')?.e164 ?? null;
    if (!celular) {
      if (!candidatos.length) {
        resumen.sinCelular++;
        problemas.push({ fila: n, motivo: 'SIN_CELULAR', descarta: true, mensaje: 'No tiene celular.' });
      } else if (clasificados.some((c) => c.clase === 'FIJO')) {
        resumen.fijos++;
        problemas.push({ fila: n, motivo: 'TELEFONO_FIJO', descarta: true, mensaje: `«${candidatos[0]}» es un teléfono fijo: no recibe WhatsApp.` });
      } else {
        resumen.celularInvalido++;
        problemas.push({
          fila: n,
          motivo: 'CELULAR_INVALIDO',
          descarta: true,
          mensaje: `«${candidatos[0]}» no es un celular válido (10 dígitos que empiezan por 3, o con +indicativo si es de otro país).`,
        });
      }
      return;
    }
    const previa = vistos.get(celular);
    if (previa !== undefined) {
      resumen.duplicados++;
      problemas.push({ fila: n, motivo: 'DUPLICADO', descarta: true, mensaje: `El celular ya está en la fila ${previa}.` });
      return;
    }
    vistos.set(celular, n);

    let nombreCompleto = nombrePropio(celdas(fila, colCompleto).join(' '));
    let primerNombre: string | null = null;
    const nombres = nombrePropio(celdas(fila, colNombres).join(' '));
    const apellidos = nombrePropio(celdas(fila, colApellidos).join(' '));
    if (nombres || apellidos) {
      nombreCompleto = nombreCompleto ?? ([nombres, apellidos].filter(Boolean).join(' ') || null);
      primerNombre = nombres ? nombres.split(' ')[0] : null;
    }
    if (!primerNombre && nombreCompleto) primerNombre = nombreCompleto.split(' ')[0];
    if (!nombreCompleto) {
      resumen.sinNombre++;
      problemas.push({ fila: n, motivo: 'SIN_NOMBRE', descarta: false, mensaje: 'Sin nombre: el mensaje lo saludará de forma general.' });
    }

    const correoCrudo = celdas(fila, colCorreo)[0] ?? null;
    const correo = normalizarCorreo(correoCrudo);
    if (correoCrudo && !correo) {
      resumen.correosInvalidos++;
      problemas.push({ fila: n, motivo: 'CORREO_INVALIDO', descarta: false, mensaje: `El correo «${correoCrudo}» no es válido: no se guarda.` });
    }

    const extras: Record<string, string> = {};
    for (const i of colOtros) {
      const v = (fila[i] ?? '').trim();
      if (v) extras[analisis.columnas[i]?.encabezado ?? `Columna ${i + 1}`] = v.slice(0, 200);
    }

    contactos.push({
      fila: n,
      nombreCompleto: nombreCompleto ? nombreCompleto.slice(0, 120) : null,
      primerNombre: primerNombre ? primerNombre.slice(0, 40) : null,
      celular,
      correo,
      documento: normalizarDocumentoContacto(celdas(fila, colDocumento)[0] ?? null),
      extras,
    });
    resumen.validos++;
  });

  return { contactos, problemas, resumen };
}

/**
 * La validación del servidor al guardar: vuelve a normalizar lo que mandó el
 * navegador. Devuelve `null` si el celular no sirve.
 */
export function normalizarContacto(c: {
  nombreCompleto?: unknown;
  primerNombre?: unknown;
  celular?: unknown;
  correo?: unknown;
  documento?: unknown;
  extras?: unknown;
}): Omit<ContactoImportado, 'fila'> | null {
  const tel = clasificarTelefono(typeof c.celular === 'string' ? c.celular : '');
  if (tel.clase !== 'CELULAR' || !tel.e164) return null;
  const nombreCompleto = nombrePropio(typeof c.nombreCompleto === 'string' ? c.nombreCompleto : null);
  const primero = nombrePropio(typeof c.primerNombre === 'string' ? c.primerNombre : null);
  const extras: Record<string, string> = {};
  if (c.extras && typeof c.extras === 'object' && !Array.isArray(c.extras)) {
    for (const [k, v] of Object.entries(c.extras as Record<string, unknown>).slice(0, 20)) {
      if (typeof v === 'string' && v.trim()) extras[k.slice(0, 60)] = v.trim().slice(0, 200);
    }
  }
  return {
    nombreCompleto: nombreCompleto?.slice(0, 120) ?? null,
    primerNombre: (primero ?? nombreCompleto)?.split(' ')[0]?.slice(0, 40) ?? null,
    celular: tel.e164,
    correo: normalizarCorreo(typeof c.correo === 'string' ? c.correo : null),
    documento: normalizarDocumentoContacto(typeof c.documento === 'string' ? c.documento : null),
    extras,
  };
}

/**
 * Parseo tolerante de una fecha de nacimiento escrita por un paciente en
 * WhatsApp.
 *
 * POR QUE NO SE REUSA `parseFechaPreferida`
 * Aquel resuelve "mañana", "el lunes", "la otra semana" — fechas FUTURAS y
 * cercanas, y sin año. Aqui es al reves: siempre pasado, siempre con año, y
 * puede estar a 90 años de distancia. Mezclar los dos haria que "el lunes"
 * fuera una fecha de nacimiento valida.
 *
 * CONVENCION COLOMBIANA: DD/MM/AAAA. `03/05/1980` es el 3 de MAYO, no el 5 de
 * marzo. Leerlo al reves le cambia la edad al paciente y, con eso, el rango de
 * edad que el HIS valida por servicio.
 *
 * Devuelve `null` cuando no entiende: el llamador debe repreguntar, nunca
 * adivinar. Y el llamador SIEMPRE debe confirmarle al paciente lo que entendio
 * antes de seguir — una fecha mal leida se propaga en silencio a la historia
 * clinica.
 */

/** Edad maxima admitida. Por encima, casi seguro es un error de digitacion. */
const EDAD_MAXIMA = 120;

const MESES: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

/** Números en palabras, para el día y el mes: «diecinueve de enero», «mes uno». */
const NUMEROS: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29, treinta: 30, treintayuno: 31,
};

/** Los nombres completos de los meses, para separar «diecinuevedeEnero». */
const MESES_COMPLETOS = Object.keys(MESES).filter((m) => m.length > 4);

export interface FechaNacimiento {
  /** Medianoche UTC del dia de nacimiento. */
  date: Date;
  /** ISO-8601, que es como viaja por el protocolo del espejo. */
  iso: string;
  /** Anios cumplidos a dia de hoy (o a `opts.hoy`). */
  edad: number;
}

export interface ParseNacimientoOptions {
  /** Punto de referencia para "hoy". Inyectable para que las pruebas no dependan del reloj. */
  hoy?: Date;
}

/**
 * Quita tildes y normaliza espacios: "MARZO" y "márzo" deben valer igual.
 *
 * Y quita el MARCADO DE WHATSAPP (`*negrita*`, `_cursiva_`, `~tachado~`,
 * `` `mono` ``). Suena a detalle cosmético y no lo es: el bot le propone al
 * paciente un ejemplo —«Por ejemplo: *15/03/1980*»— que se ve en negrita, y
 * copiar un mensaje de WhatsApp se lleva los asteriscos con él. En la campaña
 * E2E del 2026-09-22 pasó exactamente eso: llegó `*15/03/1980*`, el parser
 * devolvió null y el paciente quedó en bucle, porque el mensaje de error
 * repite el mismo ejemplo en negrita. Copiar el ejemplo que a uno le dan es
 * lo más natural del mundo; el que tiene que ser tolerante es el lector.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Un año de dos digitos se resuelve hacia atras: con 2026 como hoy, "26" es
 * 2026 (un bebe) y "27" es 1927. Nunca produce una fecha futura, que es el
 * error que importa evitar.
 */
function expandirAnio(anio: number, hoy: Date): number {
  if (anio >= 100) return anio;
  const dosDigitosDeHoy = hoy.getUTCFullYear() % 100;
  const siglo = anio <= dosDigitosDeHoy ? 2000 : 1900;
  return siglo + anio;
}

/** Valida que el trio exista de verdad: el 31 de febrero no es una fecha. */
function construir(dia: number, mes: number, anio: number): Date | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    d.getUTCFullYear() !== anio ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    return null; // desbordo: 31/02 se convertiria en 02/03
  }
  return d;
}

function calcularEdad(nacimiento: Date, hoy: Date): number {
  let edad = hoy.getUTCFullYear() - nacimiento.getUTCFullYear();
  const cumpleEsteAnio = new Date(
    Date.UTC(hoy.getUTCFullYear(), nacimiento.getUTCMonth(), nacimiento.getUTCDate()),
  );
  if (hoy < cumpleEsteAnio) edad--;
  return edad;
}

export function parseFechaNacimiento(
  entrada: string | null | undefined,
  opts: ParseNacimientoOptions = {},
): FechaNacimiento | null {
  if (!entrada) return null;
  const hoy = opts.hoy ?? new Date();
  const texto = normalizar(entrada);

  let dia: number | null = null;
  let mes: number | null = null;
  let anio: number | null = null;

  // 1. Separadores: 15/03/1980, 15-3-80, 15.03.1980
  const conSeparadores = /^(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})$/.exec(texto);
  if (conSeparadores) {
    dia = Number(conSeparadores[1]);
    mes = Number(conSeparadores[2]);
    anio = Number(conSeparadores[3]);
  }

  // 2. ISO al reves: 1980-03-15. Se distingue por el año delante (4 digitos).
  if (!dia) {
    const iso = /^(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})$/.exec(texto);
    if (iso) {
      anio = Number(iso[1]);
      mes = Number(iso[2]);
      dia = Number(iso[3]);
    }
  }

  // 3. Con el mes en letras: "15 de marzo de 1980", "15 marzo 80", "15 mar 1980"
  if (!dia) {
    const conLetras = /^(\d{1,2})\s*(?:de\s+)?([a-z]+)\s*(?:de[l]?\s+)?(\d{2,4})$/.exec(texto);
    if (conLetras) {
      const mesNombre = MESES[conLetras[2]];
      if (mesNombre) {
        dia = Number(conLetras[1]);
        mes = mesNombre;
        anio = Number(conLetras[3]);
      }
    }
  }

  // 4. Como la escriben de verdad (2026-10-28, una paciente lo intentó diez
  //    veces): «19 01 1961», «1961 19 de enero», «Día 19 año 1961 mes Enero»,
  //    «26 / 12/1971.», «26 de diciembre del año 1971», «4 de mayo de1966».
  if (!dia) {
    const piezas = porPiezas(texto);
    if (piezas) ({ dia, mes, anio } = piezas);
  }

  if (dia === null || mes === null || anio === null) return null;

  anio = expandirAnio(anio, hoy);
  const date = construir(dia, mes, anio);
  if (!date) return null;

  // Una fecha futura es siempre un error: nadie nace mañana.
  if (date.getTime() > hoy.getTime()) return null;

  const edad = calcularEdad(date, hoy);
  if (edad > EDAD_MAXIMA) return null;

  return { date, iso: date.toISOString(), edad };
}

/**
 * Texto en palabras sueltas: sin signos, con número y letras separados y con
 * «de» suelto entre el día y el mes («diecinuevedeenero» → «diecinueve de enero»).
 */
function enPiezas(texto: string): string[] {
  return texto
    .replace(/\btreinta\s+y\s+uno\b/g, 'treintayuno')
    .replace(new RegExp(`([a-z])de(${MESES_COMPLETOS.join('|')})\\b`, 'g'), '$1 de $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** «19», «diecinueve» → 19; null si no es un número. */
function numeroDe(pieza: string | undefined): number | null {
  if (!pieza) return null;
  if (/^\d+$/.test(pieza)) return Number(pieza);
  return NUMEROS[pieza] ?? null;
}

/**
 * Día, mes y año sacados de las piezas de la frase, con o sin etiquetas. Solo
 * si hay exactamente tres: con más o con menos no se adivina.
 */
function porPiezas(
  texto: string,
): { dia: number; mes: number; anio: number } | null {
  const piezas = enPiezas(texto);

  // Con etiquetas, en cualquier orden: «día 19 mes enero año 1961».
  const tras = (etiqueta: string) => piezas[piezas.indexOf(etiqueta) + 1];
  if (['dia', 'mes', 'ano'].every((e) => piezas.includes(e))) {
    const dia = numeroDe(tras('dia'));
    const mesPieza = tras('mes');
    const mes = mesPieza ? (MESES[mesPieza] ?? numeroDe(mesPieza)) : null;
    const anio = /^\d{2,4}$/.test(tras('ano') ?? '') ? Number(tras('ano')) : null;
    if (dia !== null && mes !== null && anio !== null) return { dia, mes, anio };
  }

  // Sin etiquetas: los números y el mes, en el orden en que llegan.
  type Componente = { mes?: number; numero?: number; digitos?: number };
  const componentes: Componente[] = [];
  for (const p of piezas) {
    if (MESES[p]) componentes.push({ mes: MESES[p] });
    else if (/^\d+$/.test(p)) componentes.push({ numero: Number(p), digitos: p.length });
    // «uno» suelto no cuenta: «es uno de esos días» no tiene un 1.
    else if (NUMEROS[p] && p !== 'uno') componentes.push({ numero: NUMEROS[p], digitos: 2 });
  }
  if (componentes.length !== 3) return null;

  const meses = componentes.filter((c) => c.mes !== undefined);
  const numeros = componentes.filter((c) => c.numero !== undefined);
  if (meses.length === 1 && numeros.length === 2) {
    // El año es el de cuatro dígitos; si ninguno, el último.
    const iAnio = numeros.findIndex((n) => (n.digitos ?? 0) >= 3);
    const anio = iAnio >= 0 ? numeros[iAnio] : numeros[1];
    const dia = numeros.find((n) => n !== anio)!;
    return { dia: dia.numero!, mes: meses[0].mes!, anio: anio.numero! };
  }
  if (numeros.length === 3) {
    const [a, b, c] = numeros;
    // Año delante (1961 01 19) o al final, como se usa aquí (19 01 1961).
    if ((a.digitos ?? 0) === 4) return { dia: c.numero!, mes: b.numero!, anio: a.numero! };
    if ((c.digitos ?? 0) === 2 || (c.digitos ?? 0) === 4) {
      return { dia: a.numero!, mes: b.numero!, anio: c.numero! };
    }
  }
  return null;
}

/**
 * Para pedir la fecha por partes cuando no se entiende de corrido (2026-10-28):
 * el día del mes (1-31), en número o en palabras.
 */
export function parseDiaDeNacimiento(entrada: string | null | undefined): number | null {
  if (!entrada) return null;
  const piezas = enPiezas(normalizar(entrada)).filter((p) => p !== 'dia' && p !== 'el');
  if (piezas.length !== 1) return null;
  const n = numeroDe(piezas[0]);
  return n !== null && n >= 1 && n <= 31 ? n : null;
}

/** El mes (1-12): «enero», «ene», «1», «uno». */
export function parseMesDeNacimiento(entrada: string | null | undefined): number | null {
  if (!entrada) return null;
  const piezas = enPiezas(normalizar(entrada)).filter((p) => p !== 'mes' && p !== 'de');
  if (piezas.length !== 1) return null;
  const n = MESES[piezas[0]] ?? numeroDe(piezas[0]);
  return n !== null && n >= 1 && n <= 12 ? n : null;
}

/** El año, con cuatro dígitos («1961») o dos («61», resuelto hacia atrás). */
export function parseAnioDeNacimiento(
  entrada: string | null | undefined,
  opts: ParseNacimientoOptions = {},
): number | null {
  if (!entrada) return null;
  const piezas = enPiezas(normalizar(entrada)).filter((p) => p !== 'ano' && p !== 'del' && p !== 'de');
  if (piezas.length !== 1 || !/^(\d{2}|\d{4})$/.test(piezas[0])) return null;
  const hoy = opts.hoy ?? new Date();
  const anio = expandirAnio(Number(piezas[0]), hoy);
  return anio <= hoy.getUTCFullYear() && hoy.getUTCFullYear() - anio <= EDAD_MAXIMA
    ? anio
    : null;
}

/**
 * Interpreta el sexo dicho en lenguaje natural. AgenIA guarda 'M'/'F'; la
 * traduccion al codigo que use cada HIS es cosa de su driver, no de aqui.
 */
export function parseSexo(entrada: string | null | undefined): 'M' | 'F' | null {
  if (!entrada) return null;
  const t = normalizar(entrada);
  if (/^(m|masculino|hombre|varon|masc)$/.test(t)) return 'M';
  if (/^(f|femenino|mujer|fem)$/.test(t)) return 'F';
  return null;
}

/**
 * Regimen de afiliacion. Hace falta para resolver el convenio de facturacion:
 * la misma EPS tiene convenios distintos para subsidiado y contributivo (Sura
 * subsidiado es el 467 y contributivo el 473 en el HIS de Anserma), asi que
 * deducirlo de la EPS seria adivinar.
 */
export function parseRegimen(
  entrada: string | null | undefined,
): 'SUBSIDIADO' | 'CONTRIBUTIVO' | null {
  if (!entrada) return null;
  const t = normalizar(entrada);
  if (/^(a|1|s|subsidiado|subsidiada|sisben|subsidio)$/.test(t)) return 'SUBSIDIADO';
  if (/^(b|2|c|contributivo|contributiva|cotizante|beneficiario|eps)$/.test(t))
    return 'CONTRIBUTIVO';
  return null;
}

/**
 * Formatea una fecha de nacimiento para devolvérsela al paciente.
 *
 * ⚠️ En UTC, NO en la zona de la clínica. Una fecha de nacimiento es un DÍA,
 * no un instante: se guarda como medianoche UTC, y formatearla en
 * America/Bogota (UTC-5) la corre al día anterior. Se detectó justo así — un
 * `15/03/1980` se le devolvía al paciente como "14 de marzo".
 *
 * Y siempre con el año: confirmar "15 de marzo" sin año no confirma nada.
 */
export function formatFechaNacimiento(fecha: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(fecha);
}

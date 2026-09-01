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

/** Quita tildes y normaliza espacios: "MARZO" y "márzo" deben valer igual. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

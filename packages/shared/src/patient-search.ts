/**
 * ══════════════════════════════════════════════════════════════════════════
 * BÚSQUEDA DE PACIENTES (rastreo de paciente, docs/PLAN_RASTREO_PACIENTE.md §4.2 y §6)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Lógica PURA de la pantalla de rastreo: qué es lo que el funcionario escribió
 * (cédula, teléfono, BSUID o nombre), cómo se enmascara lo que se le muestra y
 * la lista cerrada de motivos de consulta. No toca la base: el servicio que la
 * usa vive en `apps/web/lib/rastreo/`.
 *
 * Es un buscador de datos personales de salud. Por eso las reglas de aquí son
 * deliberadamente estrictas: cédula y teléfono por coincidencia EXACTA, el
 * nombre exige al menos dos palabras, y nada de lo que se devuelve para elegir
 * un candidato lleva el documento o el teléfono completos.
 */
import {
  documentoSinCerosIniciales,
  esDocumentoValido,
} from './documento';

// ─────────────────────────────────────────────────────────────
// Motivos de consulta — lista cerrada (§6, punto 1)
// ─────────────────────────────────────────────────────────────

/**
 * Por qué se consulta a un paciente. Obligatorio y de lista cerrada: un campo
 * libre se llena con "x" y la bitácora deja de servir. `OTRO` exige una nota.
 */
export const MOTIVOS_CONSULTA = [
  { codigo: 'PACIENTE_EN_VENTANILLA', etiqueta: 'Paciente en ventanilla' },
  { codigo: 'RECLAMO_PQRS', etiqueta: 'Reclamo o PQRS' },
  { codigo: 'SOPORTE_TECNICO', etiqueta: 'Soporte técnico' },
  { codigo: 'OTRO', etiqueta: 'Otro (explicar en la nota)' },
] as const;

export type MotivoConsulta = (typeof MOTIVOS_CONSULTA)[number]['codigo'];

export function esMotivoConsulta(valor: unknown): valor is MotivoConsulta {
  return MOTIVOS_CONSULTA.some((m) => m.codigo === valor);
}

/** Tope de la nota que acompaña al motivo. */
export const MAX_NOTA_MOTIVO = 300;

// ─────────────────────────────────────────────────────────────
// Clasificación de lo que se escribió
// ─────────────────────────────────────────────────────────────

export type BusquedaClasificada =
  | {
      tipo: 'DOCUMENTO_O_TELEFONO';
      /** Solo dígitos, tal como se escribió (sin puntos, espacios ni guiones). */
      digitos: string;
      /** Documentos a probar, en orden: el exacto primero y, si difiere, sin ceros a la izquierda. */
      documentos: string[];
      /** Identificadores de WhatsApp a probar (con y sin indicativo de país). Vacío si no parece un teléfono. */
      telefonos: string[];
    }
  | { tipo: 'BSUID'; valor: string }
  | { tipo: 'NOMBRE'; palabras: string[] }
  | { tipo: 'INVALIDA'; motivo: string };

/**
 * Un BSUID de Meta tiene forma `CO.13491208655302741918`: código de país, un
 * punto y un identificador alfanumérico (el "Parent BSUID" añade `ENT.`, que
 * AgenIA no adopta pero no se rechaza aquí). Exige un segmento largo para no
 * confundir "Ana.Perez" con un identificador.
 */
const BSUID_RE = /^[A-Za-z]{2}(\.[A-Za-z0-9]+)+$/;
const SEGMENTO_LARGO_RE = /[A-Za-z0-9]{8,}/;

/** Un nombre son letras (con tildes), apóstrofos y guiones. */
const PALABRA_RE = /^[\p{L}][\p{L}'’-]*$/u;

/** Cuántas palabras de al menos dos letras se exigen para buscar por nombre. */
export const MIN_PALABRAS_NOMBRE = 2;

/**
 * Decide qué se está buscando a partir de UN solo campo de texto.
 *
 * - Todo dígitos (tolerando puntos, espacios, guiones, paréntesis y `+`) →
 *   documento y/o teléfono. Una cédula de 10 dígitos y un celular sin
 *   indicativo son indistinguibles, así que se prueban las dos lecturas.
 * - Con forma de BSUID → BSUID.
 * - Letras → nombre, con al menos dos palabras.
 */
export function clasificarBusqueda(
  crudo: string | null | undefined,
): BusquedaClasificada {
  const texto = (crudo ?? '').trim();
  if (!texto) return { tipo: 'INVALIDA', motivo: 'Escribe algo para buscar.' };

  if (BSUID_RE.test(texto) && SEGMENTO_LARGO_RE.test(texto)) {
    return { tipo: 'BSUID', valor: texto };
  }

  // ¿Solo dígitos y separadores comunes de documentos y teléfonos?
  if (/^[\d\s.\-+()]+$/.test(texto)) {
    const digitos = texto.replace(/\D/g, '');
    const documentos = esDocumentoValido(digitos)
      ? unicos([digitos, documentoSinCerosIniciales(digitos)])
      : [];
    const telefonos = variantesDeTelefono(digitos);
    if (documentos.length === 0 && telefonos.length === 0) {
      return {
        tipo: 'INVALIDA',
        motivo:
          'No parece una cédula ni un teléfono. Una cédula tiene entre 4 y 15 dígitos.',
      };
    }
    return { tipo: 'DOCUMENTO_O_TELEFONO', digitos, documentos, telefonos };
  }

  const palabras = texto.split(/\s+/).filter(Boolean);
  if (!palabras.every((p) => PALABRA_RE.test(p))) {
    return {
      tipo: 'INVALIDA',
      motivo:
        'El nombre solo puede llevar letras. Para un documento o teléfono, escribe solo los números.',
    };
  }
  const significativas = palabras.filter((p) => p.length >= 2);
  if (significativas.length < MIN_PALABRAS_NOMBRE) {
    return {
      tipo: 'INVALIDA',
      motivo:
        'Escribe nombre y apellido (al menos dos palabras) para buscar por nombre.',
    };
  }
  return { tipo: 'NOMBRE', palabras: significativas };
}

/**
 * Las formas en que un mismo teléfono puede estar guardado como `whatsappId`
 * (`wa_id` de Meta: E.164 sin `+`). Un celular colombiano se escribe con 10
 * dígitos y se guarda con el 57 delante.
 *
 * Solo se considera teléfono lo que tiene entre 10 y 15 dígitos (E.164 tiene
 * como máximo 15): buscar "12345" como teléfono devolvería basura.
 */
export function variantesDeTelefono(digitos: string): string[] {
  if (!/^\d+$/.test(digitos) || digitos.length < 10 || digitos.length > 15) {
    return [];
  }
  const variantes = [digitos];
  if (digitos.length === 10) variantes.push(`57${digitos}`);
  if (digitos.length === 12 && digitos.startsWith('57')) {
    variantes.push(digitos.slice(2));
  }
  return unicos(variantes);
}

function unicos<T>(valores: T[]): T[] {
  return [...new Set(valores)];
}

// ─────────────────────────────────────────────────────────────
// Enmascarado (§6, punto 3)
// ─────────────────────────────────────────────────────────────

const PUNTO = '•';

/** `1088123456` → `•••3456`. Con 4 dígitos o menos se tapa todo: no queda nada que enseñar. */
export function enmascararDocumento(
  documento: string | null | undefined,
): string | null {
  const limpio = (documento ?? '').replace(/\D/g, '');
  if (!limpio) return null;
  if (limpio.length <= 4) return PUNTO.repeat(limpio.length);
  return `${PUNTO.repeat(3)}${limpio.slice(-4)}`;
}

/**
 * Teléfono o BSUID. `573001112233` → `•••2233`; `CO.13491208655302741918` →
 * `CO.•••1918` (el país se deja: no identifica a nadie y ayuda a reconocer el tipo).
 */
export function enmascararIdentificadorWhatsapp(
  identificador: string | null | undefined,
): string | null {
  const valor = (identificador ?? '').trim();
  if (!valor) return null;
  if (/^\d+$/.test(valor)) return enmascararDocumento(valor);
  const cola = valor.slice(-4);
  const pais = /^[A-Za-z]{2}\./.test(valor) ? valor.slice(0, 3) : '';
  return `${pais}${PUNTO.repeat(3)}${cola}`;
}

/**
 * El primer nombre entero y de las demás palabras solo la inicial:
 * `María López Núñez` → `María L••• N•••`. Sirve para distinguir homónimos
 * (junto con los últimos dígitos del documento) sin publicar el nombre completo
 * en un listado de candidatos.
 */
export function enmascararNombre(nombre: string | null | undefined): string {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '';
  const [primera, ...resto] = palabras;
  return [
    primera,
    ...resto.map((p) => `${p.charAt(0)}${PUNTO.repeat(3)}`),
  ].join(' ');
}

// ─────────────────────────────────────────────────────────────
// LIKE seguro
// ─────────────────────────────────────────────────────────────

/**
 * Escapa `\`, `%` y `_` para usar un texto del usuario DENTRO de un `LIKE`.
 * Sin esto, buscar "%" o "_" devolvería a todos los pacientes: la regla de que
 * no existe el listado "todos" se saltaría con un solo carácter.
 */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

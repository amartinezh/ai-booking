/**
 * 🌾 Sábados solo para la zona rural (Configuración › Asistente Virtual,
 * 2026-11-19): con la regla encendida, el asistente agenda los sábados solo a
 * pacientes que el hospital tiene con zona de residencia rural, y como mucho un
 * porcentaje de la agenda de cada médico ese día (ese tope lo aplica
 * `reserva-presencial.ts`).
 *
 * Lo que la API necesita de la base: si la regla está encendida, si ya llegó la
 * lista de documentos rurales que manda el agente (`RuralPatient`) y si un
 * documento está en ella. La regla misma es pura y vive en `@agenia/shared`
 * (sabado-rural.ts).
 *
 * Funciones y no un servicio de Nest, como `plazo-agendar.ts`: las usan la
 * búsqueda y la reserva de citas, el cambio de fecha del chatbot (dentro de su
 * transacción) y la lista de espera, cada uno con su cliente o su transacción.
 *
 * SIN LA REGLA (lo de fábrica) NINGUNA de estas funciones consulta nada más que
 * el ajuste: el sábado es un día más.
 */
import type { Prisma, PrismaClient } from '@agenia/database';
import {
  DEFAULT_TIMEZONE,
  documentoSinCerosIniciales,
  esSabado,
  normalizeDocumento,
  normalizarSabadoRural,
} from '@agenia/shared';

type Tablas =
  | 'organizationSettings'
  | 'organization'
  | 'hospitalMirrorConfig'
  | 'ruralPatient';
type Db = Pick<PrismaClient, Tablas> | Pick<Prisma.TransactionClient, Tablas>;

export interface SabadoRuralDeLaClinica {
  /** El tope del sábado (%); 100 = sin tope. */
  porcentaje: number;
  /**
   * Ya llegó la lista de pacientes rurales. Sin ella nadie es rural: con la
   * regla encendida, el asistente no ofrece sábados.
   */
  abierto: boolean;
  timeZone: string;
}

const tieneTabla = (db: unknown, tabla: string, metodo: string): boolean =>
  typeof (db as Record<string, Record<string, unknown> | undefined>)[tabla]?.[
    metodo
  ] === 'function';

/** La regla de la clínica; null si está apagada (lo de siempre). */
export async function sabadoRuralDeLaClinica(
  db: Db,
  organizationId: string,
): Promise<SabadoRuralDeLaClinica | null> {
  // Los dobles de prueba que no traen la tabla: sin ella, sin regla (en
  // producción siempre existe).
  if (!tieneTabla(db, 'organizationSettings', 'findUnique')) return null;
  const settings = await db.organizationSettings.findUnique({
    where: { organizationId },
    select: { saturdayRuralSharePercent: true },
  });
  const porcentaje = normalizarSabadoRural(settings?.saturdayRuralSharePercent);
  if (porcentaje === null) return null;

  const [org, espejo] = await Promise.all([
    tieneTabla(db, 'organization', 'findUnique')
      ? db.organization.findUnique({
          where: { id: organizationId },
          select: { timezone: true },
        })
      : null,
    tieneTabla(db, 'hospitalMirrorConfig', 'findUnique')
      ? db.hospitalMirrorConfig.findUnique({
          where: { organizationId },
          select: { ruralListCount: true },
        })
      : null,
  ]);
  return {
    porcentaje,
    abierto: (espejo?.ruralListCount ?? 0) > 0,
    timeZone: org?.timezone || DEFAULT_TIMEZONE,
  };
}

/**
 * Cómo se guarda y se busca un documento en la lista rural: solo dígitos y sin
 * ceros a la izquierda. Es una pertenencia a una lista, no una identidad: que
 * «0012345» y «12345» cuenten igual evita dejar fuera a alguien porque una de
 * las dos fuentes perdió los ceros. null si no es un documento válido.
 */
export function documentoParaLaListaRural(
  raw: string | null | undefined,
): string | null {
  const solo = normalizeDocumento(raw);
  if (!solo || !/[1-9]/.test(solo)) return null;
  const sinCeros = documentoSinCerosIniciales(solo);
  return sinCeros.length >= 4 && sinCeros.length <= 20 ? sinCeros : null;
}

/** ¿El hospital tiene a este documento con zona de residencia rural? */
export async function esPacienteRural(
  db: Db,
  organizationId: string,
  cedula: string | null | undefined,
): Promise<boolean> {
  const documento = documentoParaLaListaRural(cedula);
  if (!documento || !tieneTabla(db, 'ruralPatient', 'findUnique')) {
    return false;
  }
  const fila = await db.ruralPatient.findUnique({
    where: { organizationId_document: { organizationId, document: documento } },
    select: { id: true },
  });
  return !!fila;
}

/**
 * ¿La regla impide que el asistente le dé a esta persona una cita que empieza
 * en `inicio`? Solo con la regla encendida y si la cita es de sábado: entonces
 * hace falta la lista y que el documento esté en ella. Sin documento (todavía no
 * lo dio), también la impide. Lo usan la reserva, el cambio de fecha y el
 * chatbot al recibir el documento.
 */
export async function sabadoSoloRuralLoImpide(
  db: Db,
  organizationId: string,
  inicio: Date,
  /** El documento, o cómo obtenerlo (solo se busca si hace falta). */
  cedula:
    | string
    | null
    | undefined
    | (() => Promise<string | null | undefined>),
): Promise<boolean> {
  const regla = await sabadoRuralDeLaClinica(db, organizationId);
  if (!regla || !esSabado(inicio, regla.timeZone)) return false;
  if (!regla.abierto) return true;
  const documento = typeof cedula === 'function' ? await cedula() : cedula;
  if (!documento) return true;
  return !(await esPacienteRural(db, organizationId, documento));
}

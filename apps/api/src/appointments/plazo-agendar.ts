/**
 * 🗓️ Plazo máximo para agendar por el asistente (Configuración › Asistente
 * Virtual, 2026-10-23): hasta cuántos días adelante, contando hoy, ofrece citas.
 *
 * Lo que la API necesita de la base: el plazo de la clínica, su zona horaria y
 * si el sábado cuenta (con «Sábados por el asistente» encendida, no).
 * La regla misma es pura y vive en `@agenia/shared` (plazo-agendar.ts).
 *
 * Funciones y no un servicio de Nest, como `bloqueos-agenda.ts`: las usan la
 * búsqueda y la reserva de citas, el cambio de fecha del chatbot (dentro de su
 * transacción) y la lista de espera, cada uno con su cliente o su transacción.
 */
import type { Prisma, PrismaClient } from '@agenia/database';
import {
  finDelPlazoParaAgendar,
  normalizarPlazoAgendar,
  sabadoNoCuentaParaElPlazo,
  type OpcionesDelPlazo,
} from '@agenia/shared';

type Db =
  | Pick<PrismaClient, 'organizationSettings' | 'organization'>
  | Pick<Prisma.TransactionClient, 'organizationSettings' | 'organization'>;

/**
 * El plazo de la clínica (días, contando hoy), su zona horaria y cómo se cuentan
 * los días (`opciones`: con «Sábados por el asistente» encendida, el sábado no
 * cuenta, 2026-11-21); null sin límite.
 */
export async function plazoDeLaClinica(
  db: Db,
  organizationId: string,
): Promise<{
  dias: number;
  timeZone: string | undefined;
  opciones: OpcionesDelPlazo;
} | null> {
  // Los dobles de prueba que no traen la tabla: sin ella, sin límite (en
  // producción siempre existe).
  const tabla = (db as { organizationSettings?: { findUnique?: unknown } })
    .organizationSettings;
  if (typeof tabla?.findUnique !== 'function') return null;

  const settings = await db.organizationSettings.findUnique({
    where: { organizationId },
    select: { bookingMaxDaysAhead: true, saturdayRuralSharePercent: true },
  });
  const dias = normalizarPlazoAgendar(settings?.bookingMaxDaysAhead);
  if (dias === null) return null;

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return {
    dias,
    timeZone: org?.timezone ?? undefined,
    opciones: {
      sabadoNoCuenta: sabadoNoCuentaParaElPlazo(
        settings?.saturdayRuralSharePercent,
      ),
    },
  };
}

/**
 * El primer instante que ya queda fuera del plazo (medianoche, en UTC), o null
 * si la clínica no tiene límite.
 */
export async function finDelPlazoDelAsistente(
  db: Db,
  organizationId: string,
  ahora: Date,
): Promise<Date | null> {
  const plazo = await plazoDeLaClinica(db, organizationId);
  return plazo
    ? finDelPlazoParaAgendar(ahora, plazo.dias, plazo.timeZone, plazo.opciones)
    : null;
}

/**
 * ¿La cita que empieza a esta hora queda más allá del plazo? Para revalidar al
 * reservar, al cambiar la fecha y en la lista de espera: entre la oferta y el
 * «sí» el administrador pudo acortar el plazo.
 */
export async function fueraDelPlazoParaElAsistente(
  db: Db,
  organizationId: string,
  inicio: Date,
  ahora: Date = new Date(),
): Promise<boolean> {
  const fin = await finDelPlazoDelAsistente(db, organizationId, ahora);
  return fin !== null && inicio >= fin;
}

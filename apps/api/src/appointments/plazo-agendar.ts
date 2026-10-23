/**
 * 🗓️ Plazo máximo para agendar por el asistente (Configuración › Asistente
 * Virtual, 2026-10-23): hasta cuántos días adelante, contando hoy, ofrece citas.
 *
 * Lo que la API necesita de la base: el plazo de la clínica y su zona horaria.
 * La regla misma es pura y vive en `@agenia/shared` (plazo-agendar.ts).
 *
 * Funciones y no un servicio de Nest, como `bloqueos-agenda.ts`: las usan la
 * búsqueda y la reserva de citas, el cambio de fecha del chatbot (dentro de su
 * transacción) y la lista de espera, cada uno con su cliente o su transacción.
 */
import type { Prisma, PrismaClient } from '@agenia/database';
import { finDelPlazoParaAgendar, normalizarPlazoAgendar } from '@agenia/shared';

type Db =
  | Pick<PrismaClient, 'organizationSettings' | 'organization'>
  | Pick<Prisma.TransactionClient, 'organizationSettings' | 'organization'>;

/**
 * El primer instante que ya queda fuera del plazo (medianoche, en UTC), o null
 * si la clínica no tiene límite.
 */
export async function finDelPlazoDelAsistente(
  db: Db,
  organizationId: string,
  ahora: Date,
): Promise<Date | null> {
  // Los dobles de prueba que no traen la tabla: sin ella, sin límite (en
  // producción siempre existe).
  const tabla = (db as { organizationSettings?: { findUnique?: unknown } })
    .organizationSettings;
  if (typeof tabla?.findUnique !== 'function') return null;

  const settings = await db.organizationSettings.findUnique({
    where: { organizationId },
    select: { bookingMaxDaysAhead: true },
  });
  const dias = normalizarPlazoAgendar(settings?.bookingMaxDaysAhead);
  if (dias === null) return null;

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return finDelPlazoParaAgendar(ahora, dias, org?.timezone ?? undefined);
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

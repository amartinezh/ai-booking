/**
 * 📅 Días y horas sin citas por el asistente (Configuración › Días sin citas).
 *
 * Lo que la API necesita de la base: las reglas de la clínica y su zona horaria.
 * La regla misma es pura y vive en `@agenia/shared` (bloqueos-agenda.ts).
 *
 * Funciones y no un servicio de Nest: las usan la búsqueda y la reserva de citas,
 * el cambio de fecha del chatbot (dentro de su transacción) y la lista de espera,
 * cada uno con su cliente de Prisma o su transacción.
 */
import type { Prisma, PrismaClient } from '@agenia/database';
import { cupoBloqueado, type ReglaBloqueoAgenda } from '@agenia/shared';

type Db =
  | Pick<PrismaClient, 'bookingBlock' | 'organization'>
  | Pick<Prisma.TransactionClient, 'bookingBlock' | 'organization'>;

export interface BloqueosDeLaClinica {
  reglas: ReglaBloqueoAgenda[];
  timeZone: string | undefined;
}

const SIN_BLOQUEOS: BloqueosDeLaClinica = { reglas: [], timeZone: undefined };

/** Las reglas de la clínica y su zona horaria. */
export async function bloqueosDeLaClinica(
  db: Db,
  organizationId: string,
): Promise<BloqueosDeLaClinica> {
  // Los dobles de prueba anteriores a la tabla no la tienen: sin ella, no hay
  // bloqueos (en producción siempre existe).
  const tabla = (db as { bookingBlock?: { findMany?: unknown } }).bookingBlock;
  if (typeof tabla?.findMany !== 'function') return SIN_BLOQUEOS;

  const reglas = await db.bookingBlock.findMany({
    where: { organizationId },
    select: {
      date: true,
      repeatWeekly: true,
      startMinute: true,
      endMinute: true,
    },
  });
  if (reglas.length === 0) return SIN_BLOQUEOS;

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return { reglas, timeZone: org?.timezone ?? undefined };
}

/**
 * ¿El asistente NO debe dar una cita que empieza a esta hora? Para revalidar al
 * reservar, al cambiar la fecha y en la lista de espera: entre la oferta y el
 * «sí» el administrador pudo bloquear ese día.
 */
export async function cupoBloqueadoParaElAsistente(
  db: Db,
  organizationId: string,
  inicio: Date,
): Promise<boolean> {
  const { reglas, timeZone } = await bloqueosDeLaClinica(db, organizationId);
  return cupoBloqueado(inicio, reglas, timeZone);
}

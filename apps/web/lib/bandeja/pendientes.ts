/**
 * La cifra que lleva la opción «Bandeja de sincronización» del menú: cuántas excepciones
 * esperan a alguien (abiertas, sin dueño), con el alcance de quien mira.
 *
 * Lo pide el layout de TODO el dashboard: una falla aquí no puede tumbarlo. Ante
 * cualquier error responde 0 (sin cifra) y deja el rastro en el log; la bandeja
 * misma sí muestra el error si algo está mal.
 */
import type { PrismaClient } from '@agenia/database';
import type { SessionPayload } from '../session';
import { resolverActorBandeja } from './acceso';
import { contarPendientes } from './servicio';

export async function pendientesParaMenu(
  db: PrismaClient,
  sesion: SessionPayload | null,
  conEspejo: boolean,
): Promise<number> {
  if (!conEspejo) return 0;
  try {
    const a = await resolverActorBandeja(db, sesion);
    if (!a.ok) return 0;
    return await contarPendientes(db, a.actor);
  } catch (error: unknown) {
    console.error('[bandeja] no se pudo contar los pendientes del menú', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

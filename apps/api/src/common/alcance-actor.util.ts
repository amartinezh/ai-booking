import type { Logger } from '@nestjs/common';
import { citaFueraDeAlcance } from '@agenia/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * ¿Esta cita (o este cupo) está fuera del alcance de quien pide actuar sobre ella?
 * La regla pura es `citaFueraDeAlcance` (`@agenia/shared`, la misma que aplica la
 * web); aquí solo se resuelve el perfil del actor desde la base:
 *   · BOOKING_AGENT → su `AgentProfile` (EPS y/o médico asignados);
 *   · DOCTOR        → su propio `DoctorProfile` (solo su agenda);
 *   · el resto (ORG_ADMIN…) → sin acotar.
 *
 * El actor sale del TOKEN, nunca del body (§12 #10b del plan del rastreo).
 *
 * Si el perfil no se puede leer, devuelve `true` (fuera de alcance): falla CERRADO,
 * porque no saber quién es no puede habilitar un envío al paciente de otro.
 */
export async function citaFueraDelAlcanceDelActor(
  prisma: PrismaService,
  actor: { userId: string; role: string },
  cita: { epsId: string | null; doctorId: string | null },
  logger?: Pick<Logger, 'error'>,
): Promise<boolean> {
  try {
    if (actor.role === 'BOOKING_AGENT') {
      const perfil = await prisma.agentProfile.findUnique({
        where: { userId: actor.userId },
        select: { epsId: true, doctorId: true },
      });
      return citaFueraDeAlcance(
        { epsId: perfil?.epsId || null, doctorId: perfil?.doctorId || null },
        cita,
      );
    }
    if (actor.role === 'DOCTOR') {
      const perfil = await prisma.doctorProfile.findUnique({
        where: { userId: actor.userId },
        select: { id: true },
      });
      return citaFueraDeAlcance(
        { epsId: null, doctorId: perfil?.id || null },
        cita,
      );
    }
    return false;
  } catch (error: unknown) {
    logger?.error(
      `No se pudo resolver el alcance de ${actor.userId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return true;
  }
}

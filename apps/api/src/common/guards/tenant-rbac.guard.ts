import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtUserPayload } from '../current-user.decorator';

/**
 * Zero Trust sobre datos clínicos: decide si el ACTOR autenticado puede tocar
 * al PACIENTE objetivo de la request (`patientId` en params o body).
 *
 * ⚠️ Requiere que un guard previo haya validado el JWT y dejado el payload en
 * `request.user`. `RolesGuard` lo hace cuando el handler declara `@Roles(...)`,
 * así que el orden correcto es `@UseGuards(RolesGuard, TenantRbacGuard)`. Sin
 * `request.user` este guard no deja pasar nada: falla cerrado.
 *
 * 🏢 REGLA DE ORO: el tenant del actor y el del paciente deben coincidir
 * SIEMPRE, sea cual sea el rol. La comprobación ocurre ANTES de bifurcar por
 * rol, para que ningún rol futuro pueda saltársela por olvido. `SUPER_ADMIN` es
 * el único rol de plataforma (no pertenece a ninguna clínica) y por eso el
 * único exento.
 */
/** Lo único que este guard necesita leer de la request HTTP. */
interface GuardedRequest {
  user?: JwtUserPayload;
  params?: { patientId?: string };
  body?: { patientId?: string };
}

@Injectable()
export class TenantRbacGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Autenticación requerida.');
    }

    // El paciente objetivo puede venir en la ruta o en el cuerpo.
    const targetPatientId =
      request.params?.patientId || request.body?.patientId;

    // 1. SUPER_ADMIN: rol de plataforma, sin tenant propio. Único bypass.
    if (user.role === 'SUPER_ADMIN') return true;

    // 2. Rol clínico sin organización en el token: no hay contra qué comparar,
    //    así que no se puede garantizar el aislamiento → se rechaza.
    if (!user.organizationId) {
      throw new ForbiddenException(
        'Zero Trust: el token no declara organización; acceso denegado.',
      );
    }

    // 3. Sólo administradores de clínica y médicos llegan a historiales.
    //    Recepcionistas, pacientes y cualquier rol NUEVO caen aquí por defecto.
    const isOrgAdmin = user.role === 'ORG_ADMIN';
    const isDoctor = user.role === 'DOCTOR';
    if (!isOrgAdmin && !isDoctor) {
      throw new ForbiddenException(
        `Zero Trust: Acceso denegado a historiales para el rol ${user.role}.`,
      );
    }

    // 4. Endpoint no dirigido a un paciente concreto (ej. la agenda propia del
    //    médico): no hay paciente ajeno que aislar; el handler filtra por tenant.
    if (!targetPatientId) return true;

    // 5. 🏢 AISLAMIENTO DE TENANT — se valida para TODOS los roles clínicos,
    //    antes de cualquier bifurcación. Mismo error si el paciente no existe
    //    que si es de otra clínica: distinguirlos convertiría el endpoint en un
    //    oráculo de existencia de pacientes ajenos.
    const patient = await this.prisma.patientProfile.findFirst({
      where: { id: targetPatientId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!patient) {
      throw new ForbiddenException(
        'Zero Trust: el paciente no pertenece a su organización.',
      );
    }

    if (isOrgAdmin) return true;

    // 6. DOCTOR: además del tenant, exige relación terapéutica (una cita suya
    //    con ese paciente), también acotada a la organización del actor.
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.userId },
      select: { id: true },
    });
    if (!doctorProfile) {
      throw new ForbiddenException('Perfil de doctor no encontrado.');
    }

    const therapeuticRelation = await this.prisma.appointment.findFirst({
      where: {
        patientId: targetPatientId,
        organizationId: user.organizationId,
        scheduleSlot: { doctorId: doctorProfile.id },
      },
      select: { id: true },
    });
    if (!therapeuticRelation) {
      throw new ForbiddenException(
        'Zero Trust: No tienes relación terapéutica activa (citas) que autorice ver a este paciente.',
      );
    }

    return true;
  }
}

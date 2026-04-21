import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantRbacGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // NOTA: Se asume que request.user ya fue hidratado por un AuthGuard (JWT) anterior.
    const user = request.user;
    
    // Obtenemos el target patientId ya sea de params o del body de la request
    const targetPatientId = request.params?.patientId || request.body?.patientId;

    if (!user) {
      throw new ForbiddenException('Autenticación requerida.');
    }

    // 1. Roles de Administración Global: Bypass de Zero Trust
    if (user.role === 'SUPER_ADMIN' || user.role === 'ORG_ADMIN') {
      return true;
    }

    // 2. Control de Acceso Estricto para Doctores (Relación Terapéutica)
    if (user.role === 'DOCTOR') {
      // Si el endpoint no especifica un target patient, asumimos que no busca historiales ajenos
      // (Ej. endpoints generales como ver su propia agenda)
      if (!targetPatientId) return true;

      const doctorProfile = await this.prisma.doctorProfile.findUnique({
        where: { userId: user.id }
      });
      
      if (!doctorProfile) throw new ForbiddenException('Perfil de doctor no encontrado.');

      // Validar si el doctor tiene cita o historial asociado a este paciente
      const therapeuticRelation = await this.prisma.appointment.findFirst({
        where: {
          patientId: targetPatientId,
          scheduleSlot: {
            doctorId: doctorProfile.id
          }
        }
      });
      
      if (!therapeuticRelation) {
        throw new ForbiddenException('Zero Trust: No tienes relación terapéutica activa (citas) que autorice ver a este paciente.');
      }
      return true;
    }

    // 3. Recepcionistas y Pacientes tienen explícitamente prohíbido acceder a la historia clínica
    throw new ForbiddenException(`Zero Trust: Acceso denegado a historiales para el rol ${user.role}.`);
  }
}

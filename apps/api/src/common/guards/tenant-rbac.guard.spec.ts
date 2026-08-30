import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantRbacGuard } from './tenant-rbac.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtUserPayload } from '../current-user.decorator';

/** Sólo los campos de la request que el guard lee. */
interface TestRequest {
  user?: JwtUserPayload;
  params: { patientId?: string };
  body: Record<string, never>;
}

/** Fila mínima que devuelven los mocks: al guard sólo le interesa el `id`. */
type Row = { id: string } | null;

describe('TenantRbacGuard', () => {
  const buildContext = (
    user: JwtUserPayload | undefined,
    patientId?: string,
  ): ExecutionContext => {
    const request: TestRequest = { user, params: { patientId }, body: {} };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  /**
   * `patient` es lo que devuelve la búsqueda ACOTADA por organización: null
   * simula tanto "no existe" como "existe pero es de otra clínica" — que es
   * justo la ambigüedad que el guard debe preservar hacia afuera.
   */
  const buildPrisma = (opts?: {
    patient?: Row;
    doctorProfile?: Row;
    appointment?: Row;
  }) => ({
    patientProfile: {
      findFirst: jest.fn(() =>
        Promise.resolve(opts?.patient === undefined ? null : opts.patient),
      ),
    },
    doctorProfile: {
      findUnique: jest.fn(() => Promise.resolve(opts?.doctorProfile ?? null)),
    },
    appointment: {
      findFirst: jest.fn(() => Promise.resolve(opts?.appointment ?? null)),
    },
  });

  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  it('sin request.user (ningún guard hidrató el JWT) → falla cerrado', async () => {
    const guard = new TenantRbacGuard(
      buildPrisma() as unknown as PrismaService,
    );
    await expect(
      guard.canActivate(buildContext(undefined, 'pac-1')),
    ).rejects.toThrow(ForbiddenException);
  });

  it('SUPER_ADMIN pasa sin consultar la base (rol de plataforma)', async () => {
    const prisma = buildPrisma();
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await expect(
      guard.canActivate(
        buildContext(
          { userId: 'u1', email: 'a@t.local', role: 'SUPER_ADMIN' },
          'pac-1',
        ),
      ),
    ).resolves.toBe(true);
    expect(prisma.patientProfile.findFirst).not.toHaveBeenCalled();
  });

  it('rol clínico sin organizationId en el token → denegado', async () => {
    const guard = new TenantRbacGuard(
      buildPrisma() as unknown as PrismaService,
    );
    await expect(
      guard.canActivate(
        buildContext(
          {
            userId: 'u1',
            email: 'a@t.local',
            role: 'ORG_ADMIN',
            organizationId: null,
          },
          'pac-1',
        ),
      ),
    ).rejects.toThrow(/no declara organización/);
  });

  it.each(['BOOKING_AGENT', 'PATIENT', 'GENERAL_OBSERVER', 'ROL_FUTURO'])(
    'rol %s no llega a historiales (denegado por defecto)',
    async (role) => {
      const guard = new TenantRbacGuard(
        buildPrisma() as unknown as PrismaService,
      );
      await expect(
        guard.canActivate(
          buildContext(
            { userId: 'u1', email: 'a@t.local', role, organizationId: ORG_A },
            'pac-1',
          ),
        ),
      ).rejects.toThrow(/Acceso denegado a historiales/);
    },
  );

  // ── El agujero que se cierra ───────────────────────────────────────────
  it('ORG_ADMIN de la org A NO puede leer un paciente de la org B', async () => {
    // La búsqueda va acotada por organizationId, así que no encuentra nada.
    const prisma = buildPrisma({ patient: null });
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await expect(
      guard.canActivate(
        buildContext(
          {
            userId: 'u1',
            email: 'a@t.local',
            role: 'ORG_ADMIN',
            organizationId: ORG_A,
          },
          'pac-de-org-b',
        ),
      ),
    ).rejects.toThrow(/no pertenece a su organización/);
    expect(prisma.patientProfile.findFirst).toHaveBeenCalledWith({
      where: { id: 'pac-de-org-b', organizationId: ORG_A },
      select: { id: true },
    });
  });

  it('ORG_ADMIN sí puede leer un paciente de SU propia org', async () => {
    const prisma = buildPrisma({ patient: { id: 'pac-1' } });
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await expect(
      guard.canActivate(
        buildContext(
          {
            userId: 'u1',
            email: 'a@t.local',
            role: 'ORG_ADMIN',
            organizationId: ORG_A,
          },
          'pac-1',
        ),
      ),
    ).resolves.toBe(true);
  });

  it('DOCTOR de la org A NO puede leer un paciente de la org B, aunque tenga perfil y cita', async () => {
    const prisma = buildPrisma({
      patient: null, // acotado por org → invisible
      doctorProfile: { id: 'doc-1' },
      appointment: { id: 'apt-1' },
    });
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await expect(
      guard.canActivate(
        buildContext(
          {
            userId: 'u1',
            email: 'a@t.local',
            role: 'DOCTOR',
            organizationId: ORG_A,
          },
          'pac-de-org-b',
        ),
      ),
    ).rejects.toThrow(/no pertenece a su organización/);
    // El tenant se valida ANTES de mirar la relación terapéutica.
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('DOCTOR sin relación terapéutica con un paciente de su propia org → denegado', async () => {
    const prisma = buildPrisma({
      patient: { id: 'pac-1' },
      doctorProfile: { id: 'doc-1' },
      appointment: null,
    });
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await expect(
      guard.canActivate(
        buildContext(
          {
            userId: 'u1',
            email: 'a@t.local',
            role: 'DOCTOR',
            organizationId: ORG_A,
          },
          'pac-1',
        ),
      ),
    ).rejects.toThrow(/relación terapéutica/);
  });

  it('DOCTOR con relación terapéutica en su propia org → permitido', async () => {
    const prisma = buildPrisma({
      patient: { id: 'pac-1' },
      doctorProfile: { id: 'doc-1' },
      appointment: { id: 'apt-1' },
    });
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await expect(
      guard.canActivate(
        buildContext(
          {
            userId: 'u1',
            email: 'a@t.local',
            role: 'DOCTOR',
            organizationId: ORG_A,
          },
          'pac-1',
        ),
      ),
    ).resolves.toBe(true);
  });

  // Regresión: el guard leía `user.id`, pero el JWT que firma el login web
  // (apps/web/app/actions/auth.ts) trae `userId`. Con `user.id` la consulta
  // salía con `userId: undefined` y Prisma reventaba con un 500 en vez de
  // resolver el permiso.
  it('busca el perfil del médico por user.userId (no user.id)', async () => {
    const prisma = buildPrisma({
      patient: { id: 'pac-1' },
      doctorProfile: { id: 'doc-1' },
      appointment: { id: 'apt-1' },
    });
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await guard.canActivate(
      buildContext(
        {
          userId: 'user-42',
          email: 'doc@t.local',
          role: 'DOCTOR',
          organizationId: ORG_A,
        },
        'pac-1',
      ),
    );
    expect(prisma.doctorProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-42' },
      select: { id: true },
    });
  });

  it('DOCTOR sin perfil de médico → denegado', async () => {
    const prisma = buildPrisma({
      patient: { id: 'pac-1' },
      doctorProfile: null,
    });
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await expect(
      guard.canActivate(
        buildContext(
          {
            userId: 'u1',
            email: 'a@t.local',
            role: 'DOCTOR',
            organizationId: ORG_A,
          },
          'pac-1',
        ),
      ),
    ).rejects.toThrow(/Perfil de doctor no encontrado/);
  });

  it('endpoint sin paciente objetivo → pasa sin consultar pacientes', async () => {
    const prisma = buildPrisma();
    const guard = new TenantRbacGuard(prisma as unknown as PrismaService);
    await expect(
      guard.canActivate(
        buildContext(
          {
            userId: 'u1',
            email: 'a@t.local',
            role: 'DOCTOR',
            organizationId: ORG_B,
          },
          undefined,
        ),
      ),
    ).resolves.toBe(true);
    expect(prisma.patientProfile.findFirst).not.toHaveBeenCalled();
  });

  it('el paciente inexistente y el de otra clínica dan el MISMO error (no es oráculo)', async () => {
    const guard = new TenantRbacGuard(
      buildPrisma({ patient: null }) as unknown as PrismaService,
    );
    const capture = async (patientId: string) => {
      try {
        await guard.canActivate(
          buildContext(
            {
              userId: 'u1',
              email: 'a@t.local',
              role: 'ORG_ADMIN',
              organizationId: ORG_A,
            },
            patientId,
          ),
        );
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await capture('no-existe')).toBe(await capture('pac-de-org-b'));
  });
});

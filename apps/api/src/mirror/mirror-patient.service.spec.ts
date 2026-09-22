import { MirrorPatientService } from './mirror-patient.service';

/**
 * El paciente de una cita nacida en el hospital (docs/PLAN_ALTA_EN_CALIENTE.md).
 * Lo que se fija aquí es lo que la regla pura no puede saber: qué se le pregunta a la
 * base, qué se escribe y con qué se cuida al paciente.
 *
 *  · Todo dentro de la clínica del evento (nunca se mira otra).
 *  · Se crea lo MÍNIMO (D9): documento, nombre, teléfono y lo que el HIS traiga.
 *  · Un WhatsApp que el paciente ya tenía en AgenIA NO se pisa con el del HIS.
 *  · Dos réplicas creando a la vez no duplican (la cédula es única por clínica).
 */
describe('MirrorPatientService', () => {
  const ORG = 'org-1';

  const build = (
    opts: {
      perfiles?: {
        id: string;
        cedula: string;
        whatsappId: string | null;
        bsuid: string | null;
      }[];
      baja?: boolean;
      duenosDelTelefono?: { id: string; cedula: string }[];
      padron?: { epsId: string }[];
      crearFalla?: Error;
    } = {},
  ) => {
    const tx = {
      user: { create: jest.fn(async () => ({ id: 'user-nuevo' })) },
      patientProfile: { create: jest.fn(async () => ({ id: 'pac-nuevo' })) },
    };
    const prisma = {
      $queryRaw: jest.fn(async () => opts.perfiles ?? []),
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => {
        if (opts.crearFalla) {
          throw opts.crearFalla;
        }
        return cb(tx);
      }),
      mirrorPatientOptOut: {
        findUnique: jest.fn(async () => (opts.baja ? { id: 'baja-1' } : null)),
        upsert: jest.fn(async () => ({})),
      },
      patientProfile: {
        findMany: jest.fn(async () => opts.duenosDelTelefono ?? []),
        update: jest.fn(async () => ({})),
      },
      epsEnrolledPatient: { findMany: jest.fn(async () => opts.padron ?? []) },
    };
    const service = new MirrorPatientService(prisma as never);
    jest
      .spyOn(
        (service as never as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    return { service, prisma, tx };
  };

  const payload = (over: Record<string, unknown> = {}) => ({
    patientDocument: '1088123456',
    patientFullName: 'MARIA LUCIA LOPEZ',
    patientPhone: '3001112233',
    ...over,
  });

  const perfil = (over: Record<string, unknown> = {}) => ({
    id: 'pac-1',
    cedula: '1088123456',
    whatsappId: null,
    bsuid: null,
    ...over,
  });

  describe('paciente que ya existe', () => {
    it('lo reutiliza y no crea nada', async () => {
      const { service, prisma } = build({
        perfiles: [perfil({ whatsappId: '573009998877' })],
      });

      await expect(service.resolverOCrear(ORG, payload())).resolves.toEqual({
        pacienteId: 'pac-1',
        creado: false,
        nota: expect.stringMatching(/ya conocido/),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('si no tenía WhatsApp, se le completa con el del HIS (para que reciba el recordatorio)', async () => {
      const { service, prisma } = build({ perfiles: [perfil()] });
      await service.resolverOCrear(ORG, payload());
      expect(prisma.patientProfile.update).toHaveBeenCalledWith({
        where: { id: 'pac-1' },
        data: { whatsappId: '573001112233' },
      });
    });

    it('🔒 un WhatsApp que el paciente ya tenía NO se pisa con el del HIS', async () => {
      const { service, prisma } = build({
        perfiles: [perfil({ whatsappId: '573007776655' })],
      });
      await service.resolverOCrear(ORG, payload());
      expect(prisma.patientProfile.update).not.toHaveBeenCalled();
    });

    it('tampoco se pisa si se identifica por BSUID', async () => {
      const { service, prisma } = build({
        perfiles: [perfil({ bsuid: 'CO.123' })],
      });
      await service.resolverOCrear(ORG, payload());
      expect(prisma.patientProfile.update).not.toHaveBeenCalled();
    });

    it('si guardar el teléfono falla, la cita sigue adelante (solo se pierde el recordatorio)', async () => {
      const { service, prisma } = build({ perfiles: [perfil()] });
      prisma.patientProfile.update.mockRejectedValueOnce(
        new Error('base caída'),
      );
      await expect(
        service.resolverOCrear(ORG, payload()),
      ).resolves.toMatchObject({
        pacienteId: 'pac-1',
      });
    });
  });

  describe('paciente nuevo', () => {
    it('crea el usuario y el perfil con lo MÍNIMO, en la clínica del evento', async () => {
      const { service, tx } = build({ padron: [{ epsId: 'eps-1' }] });

      await expect(
        service.resolverOCrear(
          ORG,
          payload({
            patientBirthDateIso: '1985-03-14',
            patientGender: 'F',
            patientRegime: 'SUBSIDIADO',
          }),
        ),
      ).resolves.toEqual({
        pacienteId: 'pac-nuevo',
        creado: true,
        nota: expect.stringMatching(/creado desde el HIS, con WhatsApp/),
      });

      expect(tx.user.create.mock.calls[0][0]).toMatchObject({
        data: { role: 'PATIENT', organizationId: ORG, password: 'none' },
      });
      expect(tx.patientProfile.create.mock.calls[0][0].data).toEqual({
        cedula: '1088123456',
        fullName: 'MARIA LUCIA LOPEZ',
        whatsappId: '573001112233',
        userId: 'user-nuevo',
        organizationId: ORG,
        epsId: 'eps-1',
        dateOfBirth: new Date('1985-03-14'),
        gender: 'F',
        regime: 'SUBSIDIADO',
      });
    });

    it('sin nacimiento, sexo ni régimen no se inventan campos', async () => {
      const { service, tx } = build();
      await service.resolverOCrear(ORG, payload());
      const data = tx.patientProfile.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('dateOfBirth');
      expect(data).not.toHaveProperty('gender');
      expect(data).not.toHaveProperty('regime');
      expect(data.epsId).toBeNull();
    });

    it.each(['0001-01-01', 'no-es-fecha', '3000-01-01'])(
      'una fecha de nacimiento imposible (%s) se omite, no se guarda basura',
      async (iso) => {
        const { service, tx } = build();
        await service.resolverOCrear(
          ORG,
          payload({ patientBirthDateIso: iso }),
        );
        expect(
          tx.patientProfile.create.mock.calls[0][0].data,
        ).not.toHaveProperty('dateOfBirth');
      },
    );

    it('la EPS se hereda del padrón solo si el documento está en UNA sola EPS (D6)', async () => {
      const dos = build({ padron: [{ epsId: 'eps-1' }, { epsId: 'eps-2' }] });
      await dos.service.resolverOCrear(ORG, payload());
      expect(
        dos.tx.patientProfile.create.mock.calls[0][0].data.epsId,
      ).toBeNull();

      const una = build({ padron: [{ epsId: 'eps-9' }] });
      await una.service.resolverOCrear(ORG, payload());
      expect(una.tx.patientProfile.create.mock.calls[0][0].data.epsId).toBe(
        'eps-9',
      );
      expect(
        una.prisma.epsEnrolledPatient.findMany.mock.calls[0][0],
      ).toMatchObject({
        where: { organizationId: ORG, isActive: true },
      });
    });

    it('🚨 D4: un teléfono que ya es de otro paciente no se guarda', async () => {
      const { service, tx } = build({
        duenosDelTelefono: [{ id: 'pac-9', cedula: '9999999' }],
      });
      const r = await service.resolverOCrear(ORG, payload());
      expect(
        tx.patientProfile.create.mock.calls[0][0].data.whatsappId,
      ).toBeNull();
      expect(r).toMatchObject({
        nota: expect.stringMatching(/ya es de otro paciente/),
      });
    });

    it('el dueño del teléfono se busca por las dos formas de guardarlo (con y sin 57)', async () => {
      const { service, prisma } = build();
      await service.resolverOCrear(ORG, payload());
      expect(prisma.patientProfile.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          organizationId: ORG,
          whatsappId: { in: ['573001112233', '3001112233'] },
        },
      });
    });

    it('🏁 dos réplicas a la vez: la que pierde reutiliza el perfil que creó la otra', async () => {
      // Prisma lanza un Error con `code`, no un objeto pelado.
      const choque = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      const { service, prisma } = build({ crearFalla: choque });
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // primera lectura: no existe
        .mockResolvedValueOnce([perfil()]); // relectura tras el choque

      await expect(service.resolverOCrear(ORG, payload())).resolves.toEqual({
        pacienteId: 'pac-1',
        creado: false,
        nota: expect.stringMatching(/otro proceso/),
      });
    });

    it('cualquier otro error de la base se propaga (no se traga)', async () => {
      const { service } = build({ crearFalla: new Error('sin espacio') });
      await expect(service.resolverOCrear(ORG, payload())).rejects.toThrow(
        'sin espacio',
      );
    });
  });

  describe('cuándo NO se da de alta', () => {
    it('documento ambiguo: no crea ni elige, y devuelve los candidatos (D3)', async () => {
      const { service, prisma } = build({
        perfiles: [perfil(), perfil({ id: 'pac-2', cedula: '0001088123456' })],
      });

      await expect(service.resolverOCrear(ORG, payload())).resolves.toEqual({
        pacienteId: null,
        motivo: 'DOCUMENTO_AMBIGUO',
        candidatos: ['pac-1', 'pac-2'],
        nota: expect.stringMatching(/más de un perfil/),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('baja registrada: no se recrea (D10), y se busca por el documento sin ceros', async () => {
      const { service, prisma } = build({ baja: true });
      await expect(
        service.resolverOCrear(
          ORG,
          payload({ patientDocument: '001088123456' }),
        ),
      ).resolves.toMatchObject({
        pacienteId: null,
        motivo: 'BAJA_SOLICITADA',
      });
      expect(prisma.mirrorPatientOptOut.findUnique.mock.calls[0][0]).toEqual({
        where: {
          organizationId_document: {
            organizationId: ORG,
            document: '1088123456',
          },
        },
        select: { id: true },
      });
    });

    it('sin nombre no se crea un paciente anónimo', async () => {
      const { service, prisma } = build();
      await expect(
        service.resolverOCrear(ORG, payload({ patientFullName: null })),
      ).resolves.toMatchObject({
        motivo: 'SIN_NOMBRE',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('un documento inutilizable no crea nada', async () => {
      const { service } = build();
      await expect(
        service.resolverOCrear(ORG, payload({ patientDocument: '0000' })),
      ).resolves.toMatchObject({
        motivo: 'DOCUMENTO_INVALIDO',
      });
    });
  });

  describe('🏢 aislamiento por clínica', () => {
    it('los perfiles se buscan por documento sin ceros y SOLO en la clínica del evento', async () => {
      const { service, prisma } = build();
      await service.resolverOCrear(
        ORG,
        payload({ patientDocument: '0001088123456' }),
      );
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toContain('PatientProfile');
      expect(sql).toContain('regexp_replace');
      expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual([
        ORG,
        '1088123456',
        10,
      ]);
    });
  });

  describe('registrarBaja (D10)', () => {
    it('guarda el documento normalizado y sin ceros, una sola vez', async () => {
      const { service, prisma } = build();
      await service.registrarBaja(ORG, ' 001088123456 ', {
        reason: 'lo pidió el paciente',
        createdByUserId: 'u-1',
      });
      expect(prisma.mirrorPatientOptOut.upsert.mock.calls[0][0]).toMatchObject({
        where: {
          organizationId_document: {
            organizationId: ORG,
            document: '1088123456',
          },
        },
        create: {
          organizationId: ORG,
          document: '1088123456',
          reason: 'lo pidió el paciente',
          createdByUserId: 'u-1',
        },
        update: {},
      });
    });

    it('un documento vacío o en ceros no registra nada', async () => {
      const { service, prisma } = build();
      await service.registrarBaja(ORG, '   ');
      await service.registrarBaja(ORG, '0000');
      expect(prisma.mirrorPatientOptOut.upsert).not.toHaveBeenCalled();
    });
  });
});

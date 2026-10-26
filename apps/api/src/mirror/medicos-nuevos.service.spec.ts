import { MedicosNuevosService } from './medicos-nuevos.service';

const ORG = 'org-1';
const AHORA = new Date('2026-10-24T21:00:00.000Z');
const MANANA = '2026-10-27T18:15:00.000Z';

/** La base, en memoria: lo justo para lo que el servicio lee y escribe. */
function crearBase(
  over: { auto?: boolean; whatsappOn?: boolean; enabled?: boolean } = {},
) {
  const db = {
    config: {
      enabled: over.enabled ?? true,
      autoHomologateDoctors: over.auto ?? false,
      autoHomologateWhatsappOn: over.whatsappOn ?? false,
    },
    catalogo: [
      {
        externalKey: 'RU68',
        label: 'MICHILLE TATIANA ZAPATA PARRADO',
        extra: {
          cargo: 'MEDICO RURAL',
          cedula: '1002954638',
          estado: '1',
          servicioDominante: 'S39141',
        },
      },
      {
        externalKey: '29-',
        label: 'ANDREA OSORIO ACEVEDO',
        extra: {
          cargo: 'AUX. DE ENFERMERIA',
          cedula: '24398000',
          estado: '1',
          servicioDominante: 'S39141',
        },
      },
      {
        externalKey: 'ES01',
        label: 'CARLOS ANDRES SERNA GRANADA',
        extra: {
          cargo: 'MEDICO INTERNISTA',
          cedula: '75000111',
          estado: '1',
          servicioDominante: 'ES01',
        },
      },
    ] as any[],
    maps: [
      { entityType: 'SERVICE', externalKey: 'S39141', agenIAId: 'srv-mg' },
      { entityType: 'DOCTOR', externalKey: 'RU71', agenIAId: 'doc-71' },
    ] as any[],
    servicios: [
      {
        id: 'srv-mg',
        name: 'Consulta ambulatoria de medicina general',
        isActive: true,
      },
    ],
    doctores: [
      {
        id: 'doc-71',
        cedula: '1193031152',
        fullName: 'ADRIAN CAMILO SALAZAR SANCHEZ',
      },
    ] as any[],
    usuarios: [{ email: 'medico30@hsvpanserma.com' }] as any[],
    casos: [] as any[],
    auditoria: [] as any[],
    rawSql: [] as string[],
  };
  const prisma: any = {
    hospitalMirrorConfig: { findUnique: jest.fn(async () => db.config) },
    mirrorEntityMap: {
      findMany: jest.fn(async ({ where }: any) =>
        db.maps.filter((m) => m.entityType === where.entityType),
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          db.maps.find(
            (m) =>
              m.entityType === where.entityType &&
              m.externalKey === where.externalKey,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        db.maps.push(data);
        return data;
      }),
    },
    medicalService: { findMany: jest.fn(async () => db.servicios) },
    mirrorCatalogEntry: { findMany: jest.fn(async () => db.catalogo) },
    doctorProfile: {
      findMany: jest.fn(async () => db.doctores),
      create: jest.fn(async ({ data }: any) => {
        const d = { id: `doc-${db.doctores.length + 1}`, ...data };
        db.doctores.push(d);
        return d;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const d = db.doctores.find((x) => x.id === where.id);
        Object.assign(d, data);
        return d;
      }),
    },
    user: {
      findMany: jest.fn(async () => db.usuarios),
      findUnique: jest.fn(
        async ({ where }: any) =>
          db.usuarios.find((u) => u.email === where.email) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const u = { id: `user-${db.usuarios.length + 1}`, ...data };
        db.usuarios.push(u);
        return u;
      }),
    },
    syncAudit: {
      create: jest.fn(async ({ data }: any) => {
        db.auditoria.push(data);
        return data;
      }),
    },
    syncException: {
      findMany: jest.fn(async ({ where }: any) =>
        db.casos.filter(
          (c) => c.kind === where.kind && where.status.in.includes(c.status),
        ),
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          db.casos.find(
            (c) =>
              c.dedupeKey === where.dedupeKey &&
              where.status.in.includes(c.status),
          ) ?? null,
      ),
    },
    $executeRawUnsafe: jest.fn(async (sql: string) => {
      db.rawSql.push(sql);
    }),
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const exceptions = {
    registrar: jest.fn(async () => 'CREADA'),
    autoResolver: jest.fn(async () => true),
  };
  const service = new MedicosNuevosService(prisma, exceptions as any);
  jest
    .spyOn((service as any).logger, 'warn')
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as any).logger, 'log')
    .mockImplementation(() => undefined);
  return { db, prisma, exceptions, service };
}

const cita = (medico: string, iso = MANANA, servicio = 'S39141') => ({
  doctorExternalKey: medico,
  startTimeIso: iso,
  serviceExternalKey: servicio,
});
const casosDe = (ex: { registrar: jest.Mock }, kind: string) =>
  ex.registrar.mock.calls
    .filter((c: any[]) => c[1].kind === kind)
    .map((c: any[]) => c[1]);

describe('MedicosNuevosService.revisar — médicos del hospital con citas que AgenIA aún no tiene', () => {
  it('RU68 con 3 citas de medicina general → caso en la Bandeja con sus datos; no crea nada (automático apagado)', async () => {
    const { service, exceptions, prisma } = crearBase();
    const r = await service.revisar(
      ORG,
      [
        cita('RU68'),
        cita('RU68', '2026-10-27T22:50:00.000Z'),
        cita('RU68', '2026-10-27T23:10:00.000Z'),
      ],
      AHORA,
    );

    expect(r).toEqual({ pendientes: ['RU68'], agregados: [] });
    const [caso] = casosDe(exceptions, 'MEDICO_SIN_HOMOLOGAR');
    expect(caso).toMatchObject({
      dedupeKey: 'medico-sin-homologar:RU68',
      entityId: 'RU68',
      meta: {
        externalKey: 'RU68',
        nombre: 'MICHILLE TATIANA ZAPATA PARRADO',
        cargo: 'MEDICO RURAL',
        cedulaFinal: '4638',
        citas: 3,
        primeraIso: MANANA,
        bloqueos: [],
        advertencias: [],
      },
    });
    expect(prisma.doctorProfile.create).not.toHaveBeenCalled();
  });

  it('no cuenta citas pasadas, de otros servicios ni de médicos ya homologados', async () => {
    const { service, exceptions } = crearBase();
    const r = await service.revisar(
      ORG,
      [
        cita('RU68', '2026-10-20T15:00:00.000Z'), // pasada
        cita('ES01', MANANA, 'ES01'), // servicio que AgenIA no tiene
        cita('RU71'), // ya homologado
        { doctorExternalKey: 'RU68', startTimeIso: MANANA }, // agente sin servicio
      ],
      AHORA,
    );
    expect(r.pendientes).toEqual([]);
    expect(exceptions.registrar).not.toHaveBeenCalled();
  });

  it('con el espejo apagado no hace nada', async () => {
    const { service, exceptions } = crearBase({ enabled: false });
    await service.revisar(ORG, [cita('RU68')], AHORA);
    expect(exceptions.registrar).not.toHaveBeenCalled();
  });

  it('🤖 automático encendido y RU68 cumple todo → la crea y homologa con WhatsApp OFF, sin tocar el hospital, y deja un caso informativo', async () => {
    const { service, exceptions, db } = crearBase({
      auto: true,
      whatsappOn: false,
    });
    const r = await service.revisar(ORG, [cita('RU68')], AHORA);

    expect(r).toEqual({ pendientes: [], agregados: ['RU68'] });
    const medica = db.doctores.find((d) => d.cedula === '1002954638');
    expect(medica).toMatchObject({
      fullName: 'MICHILLE TATIANA ZAPATA PARRADO',
      whatsappBookingEnabled: false,
      serviceId: 'srv-mg',
      isFunctionalAgenda: false,
    });
    expect(db.usuarios.at(-1)).toMatchObject({
      email: 'medico31@hsvpanserma.com',
      role: 'DOCTOR',
    });
    expect(db.usuarios.at(-1).password).toMatch(/^[0-9a-f]{64}$/); // nadie la conoce: no es un hash
    expect(db.maps).toContainEqual(
      expect.objectContaining({
        entityType: 'DOCTOR',
        externalKey: 'RU68',
        agenIAId: medica.id,
      }),
    );
    expect(db.rawSql).toContain(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
    expect(db.auditoria[0]).toMatchObject({
      op: 'DOCTOR_HOMOLOGATED',
      direction: 'CONFIG',
    });
    expect(db.auditoria[0].detail).toContain('automáticamente');
    expect(casosDe(exceptions, 'MEDICO_AGREGADO_AUTO')[0]).toMatchObject({
      severity: 'MEDIA',
      meta: { externalKey: 'RU68', whatsappOn: false, accion: 'CREAR' },
    });
    expect(casosDe(exceptions, 'MEDICO_SIN_HOMOLOGAR')).toEqual([]);
  });

  it('🤖 con WhatsApp ON en la configuración entra encendido, y el caso es de gravedad baja', async () => {
    const { service, exceptions, db } = crearBase({
      auto: true,
      whatsappOn: true,
    });
    await service.revisar(ORG, [cita('RU68')], AHORA);
    expect(
      db.doctores.find((d) => d.cedula === '1002954638').whatsappBookingEnabled,
    ).toBe(true);
    expect(casosDe(exceptions, 'MEDICO_AGREGADO_AUTO')[0].severity).toBe(
      'BAJA',
    );
  });

  it('🤖 automático encendido pero con una advertencia (cargo de auxiliar) → no lo hace sola: caso para una persona', async () => {
    const { service, exceptions, prisma } = crearBase({ auto: true });
    await service.revisar(ORG, [cita('29-')], AHORA);
    expect(prisma.doctorProfile.create).not.toHaveBeenCalled();
    const [caso] = casosDe(exceptions, 'MEDICO_SIN_HOMOLOGAR');
    expect(caso.meta.advertencias.join(' ')).toContain('no de médico');
  });

  it('un médico que no está en el catálogo del hospital → caso con el motivo', async () => {
    const { service, exceptions } = crearBase();
    await service.revisar(ORG, [cita('XX99')], AHORA);
    expect(casosDe(exceptions, 'MEDICO_SIN_HOMOLOGAR')[0].meta).toMatchObject({
      enCatalogo: false,
      bloqueos: [expect.stringContaining('No está en el catálogo')],
    });
  });

  it('cierra solo el caso de un médico que ya quedó homologado, o que ya no tiene esas citas', async () => {
    const { service, exceptions, db } = crearBase();
    db.casos.push(
      {
        id: 'c-71',
        kind: 'MEDICO_SIN_HOMOLOGAR',
        status: 'ABIERTA',
        entityId: 'RU71',
        dedupeKey: 'medico-sin-homologar:RU71',
      },
      {
        id: 'c-06',
        kind: 'MEDICO_SIN_HOMOLOGAR',
        status: 'EN_REVISION',
        entityId: '06',
        dedupeKey: 'medico-sin-homologar:06',
      },
      {
        id: 'c-68',
        kind: 'MEDICO_SIN_HOMOLOGAR',
        status: 'ABIERTA',
        entityId: 'RU68',
        dedupeKey: 'medico-sin-homologar:RU68',
      },
    );
    await service.revisar(ORG, [cita('RU68')], AHORA);
    expect(exceptions.autoResolver).toHaveBeenCalledWith(
      ORG,
      'c-71',
      'El médico ya está homologado en AgenIA.',
      AHORA,
    );
    expect(exceptions.autoResolver).toHaveBeenCalledWith(
      ORG,
      'c-06',
      expect.stringContaining('Ya no tiene citas'),
      AHORA,
    );
    expect(exceptions.autoResolver).not.toHaveBeenCalledWith(
      ORG,
      'c-68',
      expect.anything(),
      AHORA,
    );
  });
});

describe('MedicosNuevosService.homologar — el botón de la Bandeja', () => {
  const porBoton = {
    whatsappOn: true,
    actor: 'admin@hsvp.gov.co',
    via: 'BANDEJA' as const,
  };

  it('crea y homologa con WhatsApp ON, lo anota con quién lo hizo y cierra el caso', async () => {
    const { service, exceptions, db } = crearBase();
    db.casos.push({
      id: 'c-68',
      kind: 'MEDICO_SIN_HOMOLOGAR',
      status: 'ABIERTA',
      entityId: 'RU68',
      dedupeKey: 'medico-sin-homologar:RU68',
    });
    const r = await service.homologar(ORG, 'RU68', porBoton, AHORA);
    expect(r).toMatchObject({
      ok: true,
      accion: 'CREAR',
      nombre: 'MICHILLE TATIANA ZAPATA PARRADO',
    });
    expect(db.doctores.at(-1).whatsappBookingEnabled).toBe(true);
    expect(db.auditoria[0].detail).toContain(
      'desde la Bandeja por admin@hsvp.gov.co',
    );
    expect(exceptions.autoResolver).toHaveBeenCalledWith(
      ORG,
      'c-68',
      'Creado y homologado desde la Bandeja por admin@hsvp.gov.co.',
      AHORA,
    );
  });

  it('una persona puede pasar por encima de una advertencia (las vio antes de pulsar)', async () => {
    const { service } = crearBase();
    expect(await service.homologar(ORG, '29-', porBoton, AHORA)).toMatchObject({
      ok: true,
    });
  });

  it('el modo automático no', async () => {
    const { service, prisma } = crearBase();
    expect(
      await service.homologar(
        ORG,
        '29-',
        { ...porBoton, via: 'AUTOMATICO' },
        AHORA,
      ),
    ).toMatchObject({ ok: false, codigo: 'ADVERTENCIAS' });
    expect(prisma.doctorProfile.create).not.toHaveBeenCalled();
  });

  it('con un bloqueo (cédula de relleno repetida) ni el botón', async () => {
    const { service, db, prisma } = crearBase();
    db.catalogo.push({
      externalKey: '77',
      label: 'Programa de Gestantes',
      extra: {
        cargo: 'MEDICO GENERAL',
        cedula: '1002954638',
        estado: '1',
        servicioDominante: 'S39141',
      },
    });
    const r = await service.homologar(ORG, 'RU68', porBoton, AHORA);
    expect(r).toMatchObject({
      ok: false,
      codigo: 'BLOQUEADO',
      motivo: expect.stringContaining('la tienen 2 médicos'),
    });
    expect(prisma.doctorProfile.create).not.toHaveBeenCalled();
  });

  it('si ya existe un médico de AgenIA con su cédula, lo enlaza en vez de duplicarlo', async () => {
    const { service, db, prisma } = crearBase();
    db.doctores.push({
      id: 'doc-viejo',
      cedula: '1.002.954.638',
      fullName: 'MICHILLE ZAPATA',
    });
    const r = await service.homologar(ORG, 'RU68', porBoton, AHORA);
    expect(r).toMatchObject({
      ok: true,
      accion: 'ENLAZAR',
      doctorId: 'doc-viejo',
    });
    expect(prisma.doctorProfile.create).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(db.maps).toContainEqual(
      expect.objectContaining({ externalKey: 'RU68', agenIAId: 'doc-viejo' }),
    );
  });

  it('ya homologado → no hace nada y lo dice', async () => {
    const { service, prisma } = crearBase();
    expect(await service.homologar(ORG, 'RU71', porBoton, AHORA)).toMatchObject(
      { ok: false, codigo: 'YA_HOMOLOGADO' },
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('un código que no está en el catálogo → no hay con qué crearlo', async () => {
    const { service } = crearBase();
    expect(await service.homologar(ORG, 'XX99', porBoton, AHORA)).toMatchObject(
      { ok: false, codigo: 'NO_ESTA' },
    );
  });
});

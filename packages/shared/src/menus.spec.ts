import { banderasDelEspejo, getMenusForRole } from './menus';

describe('getMenusForRole', () => {
  it('devuelve el menú de paciente para PATIENT', () => {
    const menus = getMenusForRole('PATIENT');
    expect(menus.map((m) => m.href)).toEqual([
      '/dashboard',
      '/dashboard/soporte',
    ]);
  });

  it('devuelve el menú de médico para DOCTOR', () => {
    const menus = getMenusForRole('DOCTOR');
    expect(menus.map((m) => m.href)).toEqual([
      '/dashboard',
      '/dashboard/rastreo',
      '/dashboard/soporte',
    ]);
    expect(menus[0].label).toBe('Mi Agenda');
  });

  it('devuelve arreglo vacío para un rol sin dashboard clínico (SUPER_ADMIN)', () => {
    expect(getMenusForRole('SUPER_ADMIN')).toEqual([]);
  });

  it('el menú de ORG_ADMIN incluye Visión General y termina en Soporte', () => {
    const menus = getMenusForRole('ORG_ADMIN');
    expect(menus[0].href).toBe('/dashboard');
    expect(menus[menus.length - 1].href).toBe('/dashboard/soporte');
  });

  it('sin conEspejo, ORG_ADMIN no incluye la opción de Espejo con el HIS', () => {
    const menus = getMenusForRole('ORG_ADMIN');
    expect(menus.some((m) => m.href === '/dashboard/espejo')).toBe(false);
  });

  it('con conEspejo=true, ORG_ADMIN incluye Espejo, seguido de la Bandeja de sincronización, antes de Soporte', () => {
    const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true });
    const espejoIdx = menus.findIndex((m) => m.href === '/dashboard/espejo');
    const soporteIdx = menus.findIndex((m) => m.href === '/dashboard/soporte');
    expect(espejoIdx).toBeGreaterThan(-1);
    expect(menus[espejoIdx + 1].href).toBe('/dashboard/bandeja');
    expect(espejoIdx).toBe(soporteIdx - 2);
  });

  it('conEspejo=true no afecta a roles distintos de ORG_ADMIN', () => {
    const menus = getMenusForRole('BOOKING_AGENT', { conEspejo: true });
    expect(menus.some((m) => m.href === '/dashboard/espejo')).toBe(false);
  });

  it('no duplica Espejo si getMenusForRole se llama varias veces con conEspejo=true', () => {
    // MENUS_BY_ROLE es un módulo compartido — un bug de mutación in-place
    // (push en vez de spread) haría crecer el arreglo en cada llamada.
    getMenusForRole('ORG_ADMIN', { conEspejo: true });
    getMenusForRole('ORG_ADMIN', { conEspejo: true });
    const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true });
    expect(menus.filter((m) => m.href === '/dashboard/espejo')).toHaveLength(1);
  });

  // ── Avisos masivos (PLAN_AVISOS_MASIVOS.md §1.3) ──────────────────────
  // A diferencia de Espejo, esta opción es de DOS roles, no solo ORG_ADMIN.

  it('sin conAvisos, ni ORG_ADMIN ni BOOKING_AGENT incluyen la opción de avisos', () => {
    expect(
      getMenusForRole('ORG_ADMIN').some(
        (m) => m.href === '/dashboard/espejo/avisos',
      ),
    ).toBe(false);
    expect(
      getMenusForRole('BOOKING_AGENT').some(
        (m) => m.href === '/dashboard/espejo/avisos',
      ),
    ).toBe(false);
  });

  it('con conAvisos=true, ORG_ADMIN incluye Avisos justo antes de Soporte', () => {
    const menus = getMenusForRole('ORG_ADMIN', { conAvisos: true });
    const avisosIdx = menus.findIndex(
      (m) => m.href === '/dashboard/espejo/avisos',
    );
    const soporteIdx = menus.findIndex((m) => m.href === '/dashboard/soporte');
    expect(avisosIdx).toBeGreaterThan(-1);
    expect(avisosIdx).toBe(soporteIdx - 1);
  });

  it('con conAvisos=true, BOOKING_AGENT TAMBIÉN incluye Avisos — a diferencia de Espejo', () => {
    const menus = getMenusForRole('BOOKING_AGENT', { conAvisos: true });
    expect(menus.some((m) => m.href === '/dashboard/espejo/avisos')).toBe(true);
  });

  it('conAvisos=true no afecta a roles sin acceso (PATIENT, DOCTOR)', () => {
    expect(
      getMenusForRole('PATIENT', { conAvisos: true }).some(
        (m) => m.href === '/dashboard/espejo/avisos',
      ),
    ).toBe(false);
    expect(
      getMenusForRole('DOCTOR', { conAvisos: true }).some(
        (m) => m.href === '/dashboard/espejo/avisos',
      ),
    ).toBe(false);
  });

  it('conEspejo y conAvisos juntos no duplican ni pisan ninguna opción existente', () => {
    const antes = getMenusForRole('ORG_ADMIN').map((m) => m.href);
    const menus = getMenusForRole('ORG_ADMIN', {
      conEspejo: true,
      conAvisos: true,
    });

    expect(menus.some((m) => m.href === '/dashboard/espejo')).toBe(true);
    expect(menus.some((m) => m.href === '/dashboard/espejo/avisos')).toBe(true);
    // Ninguna opción original desapareció ni cambió de identidad.
    for (const href of antes) {
      expect(menus.some((m) => m.href === href)).toBe(true);
    }
    // Espejo, Bandeja de sincronización y Avisos.
    expect(menus).toHaveLength(antes.length + 3);
  });

  it('no duplica Avisos si getMenusForRole se llama varias veces con conAvisos=true', () => {
    getMenusForRole('BOOKING_AGENT', { conAvisos: true });
    getMenusForRole('BOOKING_AGENT', { conAvisos: true });
    const menus = getMenusForRole('BOOKING_AGENT', { conAvisos: true });
    expect(
      menus.filter((m) => m.href === '/dashboard/espejo/avisos'),
    ).toHaveLength(1);
  });

  // ── Rastreo de paciente (docs/PLAN_RASTREO_PACIENTE.md §5) ────────────

  it.each(['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR'] as const)(
    '%s tiene el rastreo de paciente',
    (rol) => {
      expect(
        getMenusForRole(rol).some((m) => m.href === '/dashboard/rastreo'),
      ).toBe(true);
    },
  );

  it.each(['PATIENT', 'GENERAL_OBSERVER'] as const)(
    '%s NO tiene el rastreo de paciente',
    (rol) => {
      expect(
        getMenusForRole(rol).some((m) => m.href === '/dashboard/rastreo'),
      ).toBe(false);
    },
  );

  it('el rastreo aparece con o sin espejo: sirve para investigar aunque no haya HIS', () => {
    expect(
      getMenusForRole('ORG_ADMIN', { conEspejo: false }).some(
        (m) => m.href === '/dashboard/rastreo',
      ),
    ).toBe(true);
    expect(
      getMenusForRole('ORG_ADMIN', { conEspejo: true }).some(
        (m) => m.href === '/dashboard/rastreo',
      ),
    ).toBe(true);
  });

  it('el rastreo no se duplica ni se muta el menú compartido entre llamadas', () => {
    getMenusForRole('BOOKING_AGENT', { conAvisos: true });
    getMenusForRole('BOOKING_AGENT', { conAvisos: true });
    const menus = getMenusForRole('BOOKING_AGENT', { conAvisos: true });
    expect(menus.filter((m) => m.href === '/dashboard/rastreo')).toHaveLength(
      1,
    );
  });
});

describe('Caja Negra y Avisos para el agendador (2026-10-13)', () => {
  const CAJA = '/dashboard/auditoria';
  const AVISOS = '/dashboard/espejo/avisos';
  const tiene = (menus: { href: string }[], href: string) =>
    menus.some((m) => m.href === href);

  it('BOOKING_AGENT tiene la Caja Negra, igual que ORG_ADMIN', () => {
    expect(tiene(getMenusForRole('BOOKING_AGENT'), CAJA)).toBe(true);
    expect(tiene(getMenusForRole('ORG_ADMIN'), CAJA)).toBe(true);
  });

  it.each(['DOCTOR', 'PATIENT', 'GENERAL_OBSERVER', 'SUPER_ADMIN'] as const)(
    '%s no tiene la Caja Negra',
    (rol) => {
      expect(tiene(getMenusForRole(rol), CAJA)).toBe(false);
    },
  );

  it('ORG_ADMIN ve Avisos con solo el driver correcto, aunque estén APAGADOS: es quien los enciende', () => {
    expect(
      tiene(getMenusForRole('ORG_ADMIN', { conAvisosDriver: true }), AVISOS),
    ).toBe(true);
  });

  it('BOOKING_AGENT también ve Avisos con solo el driver (apagados, la pantalla le pide al administrador activarlos)', () => {
    expect(
      tiene(
        getMenusForRole('BOOKING_AGENT', { conAvisosDriver: true }),
        AVISOS,
      ),
    ).toBe(true);
    expect(
      tiene(
        getMenusForRole('BOOKING_AGENT', {
          conAvisosDriver: true,
          conAvisos: true,
        }),
        AVISOS,
      ),
    ).toBe(true);
  });

  it('sin el driver (otra clínica u otro HIS) ninguno de los dos la ve', () => {
    expect(
      tiene(getMenusForRole('BOOKING_AGENT', { conEspejo: true }), AVISOS),
    ).toBe(false);
    expect(
      tiene(getMenusForRole('ORG_ADMIN', { conEspejo: true }), AVISOS),
    ).toBe(false);
  });

  it('con el driver y encendidos a la vez, Avisos aparece una sola vez', () => {
    const menus = getMenusForRole('ORG_ADMIN', {
      conAvisosDriver: true,
      conAvisos: true,
    });
    expect(menus.filter((m) => m.href === AVISOS)).toHaveLength(1);
  });

  it('el driver no le da Avisos a roles sin acceso', () => {
    for (const rol of ['DOCTOR', 'PATIENT', 'GENERAL_OBSERVER'] as const) {
      expect(
        tiene(
          getMenusForRole(rol, { conAvisosDriver: true, conAvisos: true }),
          AVISOS,
        ),
      ).toBe(false);
    }
  });
});

describe('Bandeja de sincronización (Fase 3 del rastreo)', () => {
  const HREF = '/dashboard/bandeja';
  const tiene = (menus: { href: string }[]) =>
    menus.some((m) => m.href === HREF);

  it('sin espejo no aparece para nadie: sin HIS no hay nada que sincronizar', () => {
    for (const rol of [
      'ORG_ADMIN',
      'BOOKING_AGENT',
      'DOCTOR',
      'PATIENT',
      'GENERAL_OBSERVER',
      'SUPER_ADMIN',
    ] as const) {
      expect(tiene(getMenusForRole(rol))).toBe(false);
      expect(
        tiene(getMenusForRole(rol, { conEspejo: false, pendientesBandeja: 4 })),
      ).toBe(false);
    }
  });

  it('con espejo la ven ORG_ADMIN y BOOKING_AGENT — quienes la trabajan —, y nadie más', () => {
    expect(tiene(getMenusForRole('ORG_ADMIN', { conEspejo: true }))).toBe(true);
    expect(tiene(getMenusForRole('BOOKING_AGENT', { conEspejo: true }))).toBe(
      true,
    );
    for (const rol of [
      'DOCTOR',
      'PATIENT',
      'GENERAL_OBSERVER',
      'SUPER_ADMIN',
    ] as const) {
      expect(tiene(getMenusForRole(rol, { conEspejo: true }))).toBe(false);
    }
  });

  it('queda justo antes de Soporte, después del Espejo, y no desplaza a los demás', () => {
    const menus = getMenusForRole('ORG_ADMIN', {
      conEspejo: true,
      conAvisos: true,
    });
    const hrefs = menus.map((m) => m.href);
    expect(hrefs.indexOf(HREF)).toBe(hrefs.indexOf('/dashboard/espejo') + 1);
    expect(hrefs.indexOf('/dashboard/soporte')).toBe(hrefs.length - 1);
    expect(hrefs).toContain('/dashboard/espejo/avisos');
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('la cifra de pendientes solo se pone si hay pendientes', () => {
    const con = getMenusForRole('BOOKING_AGENT', {
      conEspejo: true,
      pendientesBandeja: 3,
    }).find((m) => m.href === HREF);
    expect(con?.badge).toBe(3);
    for (const n of [0, undefined]) {
      const sin = getMenusForRole('BOOKING_AGENT', {
        conEspejo: true,
        pendientesBandeja: n,
      }).find((m) => m.href === HREF);
      expect(sin?.badge).toBeUndefined();
    }
  });

  it('la cifra de un usuario NO se le pega al menú de otro (el ítem base es compartido)', () => {
    getMenusForRole('ORG_ADMIN', { conEspejo: true, pendientesBandeja: 9 });
    const otro = getMenusForRole('ORG_ADMIN', { conEspejo: true }).find(
      (m) => m.href === HREF,
    );
    expect(otro?.badge).toBeUndefined();
  });

  it('no se duplica al llamar varias veces', () => {
    getMenusForRole('ORG_ADMIN', { conEspejo: true });
    getMenusForRole('ORG_ADMIN', { conEspejo: true });
    const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true });
    expect(menus.filter((m) => m.href === HREF)).toHaveLength(1);
  });
});

describe('Límite de citas y solicitudes de más citas (2026-10-14)', () => {
  const LIMITE = '/dashboard/limites-citas';
  const SOLICITUDES = '/dashboard/solicitudes-citas';
  const tiene = (menus: { href: string }[], href: string) =>
    menus.some((m) => m.href === href);

  it.each(['ORG_ADMIN', 'BOOKING_AGENT'] as const)(
    '%s ve las dos opciones, sin depender del espejo',
    (rol) => {
      for (const opts of [{}, { conEspejo: true }]) {
        const menus = getMenusForRole(rol, opts);
        expect(tiene(menus, LIMITE)).toBe(true);
        expect(tiene(menus, SOLICITUDES)).toBe(true);
        expect(menus[menus.length - 1].href).toBe('/dashboard/soporte');
      }
    },
  );

  it.each(['DOCTOR', 'PATIENT', 'GENERAL_OBSERVER', 'SUPER_ADMIN'] as const)(
    '%s no las ve',
    (rol) => {
      const menus = getMenusForRole(rol, { pendientesSolicitudesCitas: 5 });
      expect(tiene(menus, LIMITE)).toBe(false);
      expect(tiene(menus, SOLICITUDES)).toBe(false);
    },
  );

  it('la cifra de pendientes va en «Solicitudes de más citas» y solo si hay', () => {
    const con = getMenusForRole('BOOKING_AGENT', {
      pendientesSolicitudesCitas: 2,
    }).find((m) => m.href === SOLICITUDES);
    expect(con?.badge).toBe(2);
    const sin = getMenusForRole('BOOKING_AGENT', {
      pendientesSolicitudesCitas: 0,
    }).find((m) => m.href === SOLICITUDES);
    expect(sin?.badge).toBeUndefined();
  });

  it('la cifra de una clínica no se le pega al menú de otra (el ítem base es compartido)', () => {
    getMenusForRole('ORG_ADMIN', { pendientesSolicitudesCitas: 7 });
    const otro = getMenusForRole('ORG_ADMIN').find(
      (m) => m.href === SOLICITUDES,
    );
    expect(otro?.badge).toBeUndefined();
  });

  it('las dos cifras (bandeja y solicitudes) conviven', () => {
    const menus = getMenusForRole('ORG_ADMIN', {
      conEspejo: true,
      pendientesBandeja: 3,
      pendientesSolicitudesCitas: 1,
    });
    expect(menus.find((m) => m.href === '/dashboard/bandeja')?.badge).toBe(3);
    expect(menus.find((m) => m.href === SOLICITUDES)?.badge).toBe(1);
  });
});

describe('banderasDelEspejo', () => {
  it('sin espejo, nada', () => {
    expect(banderasDelEspejo(null)).toEqual({
      conEspejo: false,
      conAvisosDriver: false,
      conAvisos: false,
    });
  });

  it('con espejo apagado, solo conEspejo (el administrador lo ve para reactivarlo)', () => {
    expect(
      banderasDelEspejo({
        enabled: false,
        driverKey: 'cnt-sanvicente-anserma',
        avisosMasivos: { enabled: true },
      }),
    ).toEqual({ conEspejo: true, conAvisosDriver: false, conAvisos: false });
  });

  it('con el driver de avisos: avisos según su interruptor', () => {
    const base = { enabled: true, driverKey: 'cnt-sanvicente-anserma' };
    expect(banderasDelEspejo({ ...base, avisosMasivos: null })).toEqual({
      conEspejo: true,
      conAvisosDriver: true,
      conAvisos: false,
    });
    expect(
      banderasDelEspejo({ ...base, avisosMasivos: { enabled: true } })
        .conAvisos,
    ).toBe(true);
  });

  it('otro driver no tiene avisos', () => {
    expect(
      banderasDelEspejo({
        enabled: true,
        driverKey: 'otro',
        avisosMasivos: { enabled: true },
      }),
    ).toEqual({
      conEspejo: true,
      conAvisosDriver: false,
      conAvisos: false,
    });
  });
});

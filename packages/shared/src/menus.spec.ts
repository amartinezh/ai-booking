import {
  GRUPOS_DEL_MENU,
  accesosRapidos,
  banderasDelEspejo,
  getMenusForRole,
  nombresEnElMenu,
  seccionesDelMenu,
  type UserRole,
} from './menus';

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

  it('con conEspejo=true, ORG_ADMIN incluye el Espejo al final de Administración, justo antes de Soporte', () => {
    const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true });
    const espejoIdx = menus.findIndex((m) => m.href === '/dashboard/espejo');
    const soporteIdx = menus.findIndex((m) => m.href === '/dashboard/soporte');
    expect(espejoIdx).toBeGreaterThan(-1);
    expect(menus[espejoIdx].grupo).toBe('administracion');
    expect(espejoIdx).toBe(soporteIdx - 1);
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

  it('con conAvisos=true, ORG_ADMIN incluye Avisos en Comunicación, justo después de Mensajes masivos', () => {
    const menus = getMenusForRole('ORG_ADMIN', { conAvisos: true });
    const avisosIdx = menus.findIndex(
      (m) => m.href === '/dashboard/espejo/avisos',
    );
    expect(avisosIdx).toBeGreaterThan(-1);
    expect(menus[avisosIdx].grupo).toBe('comunicacion');
    expect(menus[avisosIdx - 1].href).toBe('/dashboard/mensajes-masivos');
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

  it('es la primera de Operación diaria, justo después de la Visión General, y no desplaza a los demás', () => {
    for (const rol of ['ORG_ADMIN', 'BOOKING_AGENT'] as const) {
      const menus = getMenusForRole(rol, { conEspejo: true, conAvisos: true });
      const hrefs = menus.map((m) => m.href);
      const primeraDelGrupo = menus.findIndex((m) => m.grupo === 'operacion');
      expect(hrefs.indexOf(HREF)).toBe(primeraDelGrupo);
      expect(hrefs.indexOf('/dashboard/soporte')).toBe(hrefs.length - 1);
      expect(hrefs).toContain('/dashboard/espejo/avisos');
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
    expect(
      getMenusForRole('ORG_ADMIN', { conEspejo: true }).map((m) => m.href).slice(0, 2),
    ).toEqual(['/dashboard', HREF]);
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

  it('ORG_ADMIN ve las dos opciones, sin depender del espejo', () => {
    for (const opts of [{}, { conEspejo: true }]) {
      const menus = getMenusForRole('ORG_ADMIN', opts);
      expect(tiene(menus, LIMITE)).toBe(true);
      expect(tiene(menus, SOLICITUDES)).toBe(true);
      expect(menus[menus.length - 1].href).toBe('/dashboard/soporte');
    }
  });

  it('BOOKING_AGENT ve las solicitudes, pero NO el límite (2026-10-22: lo fija el administrador)', () => {
    for (const opts of [{}, { conEspejo: true }]) {
      const menus = getMenusForRole('BOOKING_AGENT', opts);
      expect(tiene(menus, LIMITE)).toBe(false);
      expect(tiene(menus, SOLICITUDES)).toBe(true);
      expect(menus[menus.length - 1].href).toBe('/dashboard/soporte');
    }
  });

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
      conResumen: false,
    });
  });

  it('con espejo apagado, solo conEspejo (el administrador lo ve para reactivarlo)', () => {
    expect(
      banderasDelEspejo({
        enabled: false,
        driverKey: 'cnt-sanvicente-anserma',
        avisosMasivos: { enabled: true },
      }),
    ).toEqual({ conEspejo: true, conAvisosDriver: false, conAvisos: false, conResumen: false });
  });

  it('con el driver de avisos: avisos según su interruptor', () => {
    const base = { enabled: true, driverKey: 'cnt-sanvicente-anserma' };
    expect(banderasDelEspejo({ ...base, avisosMasivos: null })).toEqual({
      conEspejo: true,
      conAvisosDriver: true,
      conAvisos: false,
      conResumen: false,
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
      conResumen: false,
    });
  });
});

describe('«Envíos de documentos» (resumen de la atención, D14)', () => {
  const ENVIOS = '/dashboard/espejo/resumen-atencion/envios';
  const rutas = (m: { href: string }[]) => m.map((x) => x.href);

  it('la ven el administrador y el agendador con el resumen habilitado; nadie más', () => {
    expect(rutas(getMenusForRole('ORG_ADMIN', { conResumen: true }))).toContain(ENVIOS);
    expect(rutas(getMenusForRole('BOOKING_AGENT', { conResumen: true }))).toContain(ENVIOS);
    expect(rutas(getMenusForRole('DOCTOR', { conResumen: true }))).not.toContain(ENVIOS);
    expect(rutas(getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisosDriver: true }))).not.toContain(ENVIOS);
  });

  it('conResumen: espejo encendido de Anserma y la función configurada', () => {
    const base = { enabled: true, driverKey: 'cnt-sanvicente-anserma', avisosMasivos: null };
    expect(banderasDelEspejo({ ...base, resumenAtencion: { leerDelHospital: false } }).conResumen).toBe(true);
    expect(banderasDelEspejo({ ...base, resumenAtencion: null }).conResumen).toBe(false);
    expect(banderasDelEspejo({ ...base, enabled: false, resumenAtencion: {} }).conResumen).toBe(false);
    expect(banderasDelEspejo({ ...base, driverKey: 'otro', resumenAtencion: {} }).conResumen).toBe(false);
  });
});

describe('Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md)', () => {
  const MASIVOS = '/dashboard/mensajes-masivos';
  const tiene = (menus: { href: string }[]) => menus.some((m) => m.href === MASIVOS);

  it('ORG_ADMIN lo ve en todas las clínicas, con espejo o sin él', () => {
    expect(tiene(getMenusForRole('ORG_ADMIN'))).toBe(true);
    expect(tiene(getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisosDriver: true }))).toBe(true);
  });

  it.each(['BOOKING_AGENT', 'DOCTOR', 'PATIENT', 'GENERAL_OBSERVER', 'SUPER_ADMIN'] as const)(
    '%s no lo ve: los comunicados los decide el administrador',
    (rol) => {
      expect(tiene(getMenusForRole(rol, { conEspejo: true, conAvisosDriver: true }))).toBe(false);
    },
  );

  it('no es la opción de Avisos masivos del hospital de Anserma', () => {
    const menus = getMenusForRole('ORG_ADMIN');
    const opcion = menus.find((m) => m.href === MASIVOS);
    expect(opcion?.label).toBe('Mensajes masivos');
    expect(menus.some((m) => m.href === '/dashboard/espejo/avisos')).toBe(false);
  });
});

describe('Grupos del menú (docs/PLAN_NAVEGACION.md §4)', () => {
  const ROLES: UserRole[] = [
    'PATIENT',
    'DOCTOR',
    'ORG_ADMIN',
    'BOOKING_AGENT',
    'GENERAL_OBSERVER',
  ];
  const TODO = {
    conEspejo: true,
    conAvisos: true,
    conAvisosDriver: true,
    conResumen: true,
  };
  const hrefs = (m: { href: string }[]) => m.map((x) => x.href);

  it('el administrador de Anserma: las opciones en el orden de §4.1', () => {
    expect(hrefs(getMenusForRole('ORG_ADMIN', TODO))).toEqual([
      '/dashboard',
      '/dashboard/bandeja',
      '/dashboard/solicitudes-citas',
      '/dashboard/solicitudes-alta',
      '/dashboard/auditoria',
      '/dashboard/rastreo',
      '/dashboard/mensajes-masivos',
      '/dashboard/espejo/avisos',
      '/dashboard/espejo/resumen-atencion/envios',
      '/dashboard/agenda',
      '/dashboard/medicos',
      '/dashboard/servicios',
      '/dashboard/eps',
      '/dashboard/padron',
      '/dashboard/analytics',
      '/dashboard/canales',
      '/dashboard/configuracion/integraciones/surveys',
      '/dashboard/configuracion',
      '/dashboard/limites-citas',
      '/dashboard/usuarios',
      '/dashboard/espejo',
      '/dashboard/soporte',
    ]);
  });

  it('el agendador de Anserma: las opciones en el orden de §4.2', () => {
    expect(hrefs(getMenusForRole('BOOKING_AGENT', TODO))).toEqual([
      '/dashboard',
      '/dashboard/agendamiento',
      '/dashboard/bandeja',
      '/dashboard/solicitudes-citas',
      '/dashboard/auditoria',
      '/dashboard/rastreo',
      '/dashboard/espejo/avisos',
      '/dashboard/espejo/resumen-atencion/envios',
      '/dashboard/soporte',
    ]);
  });

  it.each(ROLES)(
    '%s: las opciones de un grupo van juntas, y cada grupo una sola vez',
    (rol) => {
      for (const opts of [{}, TODO]) {
        const grupos = seccionesDelMenu(getMenusForRole(rol, opts))
          .map((s) => s.grupo?.id)
          .filter(Boolean);
        expect(new Set(grupos).size).toBe(grupos.length);
      }
    },
  );

  it('los grupos salen en el orden de GRUPOS_DEL_MENU, con su título', () => {
    const secciones = seccionesDelMenu(getMenusForRole('ORG_ADMIN', TODO));
    expect(secciones.map((s) => s.grupo?.titulo ?? null)).toEqual([
      null,
      'Operación diaria',
      'Comunicación con pacientes',
      'Agenda y catálogos',
      'Indicadores',
      'Administración',
      null,
    ]);
    expect(secciones[0].items.map((m) => m.label)).toEqual(['Visión General']);
    expect(secciones[6].items.map((m) => m.label)).toEqual(['Soporte y ayuda']);
    expect(GRUPOS_DEL_MENU.map((g) => g.id)).toEqual([
      'operacion',
      'comunicacion',
      'catalogos',
      'indicadores',
      'administracion',
    ]);
  });

  it('solo la Visión General y Soporte y ayuda van sueltas en el menú del administrador', () => {
    const sueltas = getMenusForRole('ORG_ADMIN', TODO).filter((m) => !m.grupo);
    expect(hrefs(sueltas)).toEqual(['/dashboard', '/dashboard/soporte']);
  });

  it('una clínica sin espejo: el administrador conserva los 5 grupos', () => {
    const secciones = seccionesDelMenu(getMenusForRole('ORG_ADMIN'));
    expect(secciones.filter((s) => s.grupo).map((s) => s.grupo?.id)).toEqual([
      'operacion',
      'comunicacion',
      'catalogos',
      'indicadores',
      'administracion',
    ]);
  });

  it.each([
    ['PATIENT', {}],
    ['DOCTOR', TODO],
    ['GENERAL_OBSERVER', TODO],
    ['BOOKING_AGENT', {}],
    ['BOOKING_AGENT', { conEspejo: true }],
  ] as const)(
    '%s con un solo grupo: una sola sección, sin encabezados (%p)',
    (rol, opts) => {
      const menus = getMenusForRole(rol, opts);
      const secciones = seccionesDelMenu(menus);
      expect(secciones).toHaveLength(1);
      expect(secciones[0].grupo).toBeNull();
      expect(secciones[0].items).toEqual(menus);
    },
  );

  it('el agendador de Anserma sí lleva encabezados: Operación diaria y Comunicación', () => {
    const secciones = seccionesDelMenu(getMenusForRole('BOOKING_AGENT', TODO));
    expect(secciones.map((s) => s.grupo?.id ?? null)).toEqual([
      null,
      'operacion',
      'comunicacion',
      null,
    ]);
    expect(secciones[0].items.map((m) => m.label)).toEqual([
      'Visión General',
      'Agendamiento',
    ]);
  });

  it('sin opciones, sin secciones', () => {
    expect(seccionesDelMenu(getMenusForRole('SUPER_ADMIN'))).toEqual([]);
  });

  it('los nombres para el asistente de soporte llevan el grupo solo si el menú lo muestra', () => {
    const admin = nombresEnElMenu(getMenusForRole('ORG_ADMIN', TODO));
    expect(admin).toContain('Visión General');
    expect(admin).toContain('Operación diaria › Bandeja de sincronización');
    expect(admin).toContain('Administración › Configuración');
    expect(admin[admin.length - 1]).toBe('Soporte y ayuda');
    expect(nombresEnElMenu(getMenusForRole('DOCTOR'))).toEqual([
      'Mi Agenda',
      'Rastreo de paciente',
      'Soporte y ayuda',
    ]);
  });
});

describe('Accesos rápidos de la Visión General (N10)', () => {
  const labels = (m: { label: string }[]) => m.map((x) => x.label);

  it('el administrador: solo Operación diaria, con su cifra', () => {
    const items = accesosRapidos(
      getMenusForRole('ORG_ADMIN', {
        conEspejo: true,
        conAvisosDriver: true,
        pendientesBandeja: 4,
      }),
    );
    expect(labels(items)).toEqual([
      'Bandeja de sincronización',
      'Solicitudes de más citas',
      'Solicitudes de alta',
      'Caja Negra (Auditoría)',
      'Rastreo de paciente',
    ]);
    expect(items[0].badge).toBe(4);
  });

  it('el administrador sin espejo: Operación diaria sin la Bandeja', () => {
    expect(labels(accesosRapidos(getMenusForRole('ORG_ADMIN')))).toEqual([
      'Solicitudes de más citas',
      'Solicitudes de alta',
      'Caja Negra (Auditoría)',
      'Rastreo de paciente',
    ]);
  });

  it('el agendador de Anserma: Agendamiento y Operación diaria', () => {
    expect(
      labels(
        accesosRapidos(
          getMenusForRole('BOOKING_AGENT', { conEspejo: true, conAvisosDriver: true }),
        ),
      ),
    ).toEqual([
      'Agendamiento',
      'Bandeja de sincronización',
      'Solicitudes de más citas',
      'Caja Negra (Auditoría)',
      'Rastreo de paciente',
    ]);
  });

  it.each([
    ['PATIENT', ['Soporte y ayuda']],
    ['DOCTOR', ['Rastreo de paciente', 'Soporte y ayuda']],
    ['GENERAL_OBSERVER', ['Analíticas', 'Canales en vivo', 'Soporte y ayuda']],
  ] as const)('%s, sin grupos: todo menos la Visión General, como antes', (rol, esperado) => {
    expect(labels(accesosRapidos(getMenusForRole(rol)))).toEqual(esperado);
  });
});

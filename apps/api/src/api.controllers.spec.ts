import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AppointmentsController } from './appointments/appointments.controller';
import { AppointmentReminderController } from './appointment-reminder/appointment-reminder.controller';
import { IntegrationsController } from './integrations/integrations.controller';
import { MonitorController } from './monitor/monitor.controller';
import { SystemLogController } from './system-log/system-log.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { GlobalStatsController } from './global-stats/global-stats.controller';
import { AiConfigController } from './llm/ai-config.controller';
import { AudioConfigController } from './audio-config/audio-config.controller';
import { WhatsappConfigController } from './whatsapp-config/whatsapp-config.controller';
import { OrganizationsController } from './organizations/organizations.controller';
import { SurveyController } from './survey/survey.controller';
import {
  ClinicSurveyController,
  SuperadminSurveyController,
} from './survey/survey-admin.controller';
import { ClinicalRecordsController } from './clinical-records/clinical-records.controller';
import { ClinicalAiController } from './clinical-ai/clinical-ai.controller';
import { Hl7FhirController } from './hl7-fhir/hl7-fhir.controller';

/**
 * La superficie HTTP de la API, controlador por controlador.
 *
 * No se prueba aquí el enrutamiento de Nest (eso lo hace Nest), sino lo que sí
 * es lógica propia y sí se puede romper en una refactorización:
 *
 *  1. 🏢 **De dónde sale el tenant.** Siempre del token (`@CurrentTenant`),
 *     nunca del body ni del path. Donde el path SÍ lleva `:orgId`, tiene que
 *     coincidir con el del token — si no, es un tenant leyendo los datos de
 *     otro, sobre información de salud.
 *  2. **El parseo del query string.** No hay ValidationPipe global, así que
 *     cada controlador normaliza sus parámetros a mano: ahí viven los
 *     defaults, los rangos permitidos y el saneado.
 *  3. **Las validaciones que rechazan antes de tocar el servicio.**
 */

const ORG = 'org-1';
const OTRA_ORG = 'org-2';

/**
 * Argumentos de la llamada número `i` de un doble.
 *
 * `jest.fn()` sin genéricos infiere `calls: []`, así que indexar sus argumentos
 * es un error de tipos aunque en tiempo de ejecución esté ahí. Este helper
 * concentra la conversión en un sitio en vez de salpicar `as any` por el archivo.
 */
const args = (m: jest.Mock, i = 0): any[] =>
  m.mock.calls[i] as unknown as any[];

/** Tercer argumento de `purge`: el actor auditado (id, email, IP). */
const actorDe = (
  service: { purge: jest.Mock },
  llamada: number,
): {
  actorId: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
} => args(service.purge, llamada)[2];

// ══════════════════════════════════════════════════════════════════════════
describe('AppointmentsController', () => {
  it('la asistencia se actualiza con el tenant del TOKEN, no del body', async () => {
    const service = { updateAttendance: jest.fn(async () => ({ ok: true })) };
    const c = new AppointmentsController(service as never);

    await c.updateAttendance(ORG, 'apt-1', 'ATTENDED' as never);

    expect(service.updateAttendance).toHaveBeenCalledWith(
      'apt-1',
      'ATTENDED',
      ORG,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('AppointmentReminderController', () => {
  const build = () => {
    const service = {
      sendManualForAppointment: jest.fn(async () => ({ success: true })),
    };
    return { service, c: new AppointmentReminderController(service as never) };
  };

  it('dispara el recordatorio manual de esa cita y esa clínica', async () => {
    const { service, c } = build();
    await c.sendManualReminder(ORG, 'apt-1');
    expect(service.sendManualForAppointment).toHaveBeenCalledWith('apt-1', ORG);
  });

  it('sin organización en el token → 403, sin tocar el servicio', async () => {
    const { service, c } = build();
    await expect(c.sendManualReminder('', 'apt-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(service.sendManualForAppointment).not.toHaveBeenCalled();
  });

  it('sin id de cita → 400', async () => {
    const { c } = build();
    await expect(c.sendManualReminder(ORG, '')).rejects.toThrow(
      BadRequestException,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('IntegrationsController', () => {
  const build = () => {
    const service = {
      diagnoseGemini: jest.fn(async () => ({ success: true })),
      diagnoseLlm: jest.fn(async () => ({ success: true })),
      diagnoseMeta: jest.fn(async () => ({ success: true })),
    };
    return { service, c: new IntegrationsController(service as never) };
  };

  it.each(['diagnoseGemini', 'diagnoseLlm', 'diagnoseMeta'] as const)(
    '%s diagnostica SOLO la organización del token',
    async (metodo) => {
      const { service, c } = build();
      await c[metodo](ORG);
      expect(service[metodo]).toHaveBeenCalledWith(ORG);
    },
  );

  it.each(['diagnoseGemini', 'diagnoseLlm', 'diagnoseMeta'] as const)(
    '%s sin organización → 403',
    async (metodo) => {
      const { service, c } = build();
      await expect(c[metodo]('')).rejects.toThrow(ForbiddenException);
      expect(service[metodo]).not.toHaveBeenCalled();
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════
describe('MonitorController', () => {
  const build = () => {
    const monitor = {
      runLiveCheck: jest.fn(async () => ({ services: [] })),
      meta: jest.fn(() => ({ bgEnabled: true })),
      summary: jest.fn(async () => ({ total: 0 })),
      listIncidents: jest.fn(async () => ({ rows: [], total: 0 })),
      getIncident: jest.fn(async () => null),
      deleteBefore: jest.fn(async () => 4),
    };
    return { monitor, c: new MonitorController(monitor as never) };
  };

  it('live-check y config delegan sin transformar', async () => {
    const { monitor, c } = build();
    await c.liveCheck();
    c.config();
    expect(monitor.runLiveCheck).toHaveBeenCalled();
    expect(monitor.meta).toHaveBeenCalled();
  });

  describe('periodo del resumen', () => {
    it.each([
      ['7d', 7],
      ['30d', 30],
      ['90d', 90],
      ['1y', 365],
      ['45', 45],
    ])('«%s» → %i días', async (entrada, esperado) => {
      const { monitor, c } = build();
      await c.summary(entrada);
      expect(monitor.summary).toHaveBeenCalledWith(esperado);
    });

    it.each([
      ['sin valor', undefined],
      ['texto', 'siempre'],
      ['cero', '0'],
      ['negativo', '-5'],
    ])('%s cae al default de 30 días', async (_e, entrada) => {
      const { monitor, c } = build();
      await c.summary(entrada);
      expect(monitor.summary).toHaveBeenCalledWith(30);
    });
  });

  describe('listado de incidentes', () => {
    it('traduce todo el query string a filtros tipados', async () => {
      const { monitor, c } = build();

      await c.incidents(
        '2026-01-01',
        '2026-02-01',
        'mirror,meta',
        'open',
        'timeout',
        '10',
        '20',
      );

      expect(monitor.listIncidents).toHaveBeenCalledWith({
        from: new Date('2026-01-01'),
        to: new Date('2026-02-01'),
        services: ['mirror', 'meta'],
        status: 'open',
        search: 'timeout',
        limit: 10,
        offset: 20,
      });
    });

    it('sin parámetros no inventa filtros', async () => {
      const { monitor, c } = build();
      await c.incidents();

      expect(monitor.listIncidents).toHaveBeenCalledWith({
        from: undefined,
        to: undefined,
        services: undefined,
        status: 'all',
        search: undefined,
        limit: undefined,
        offset: undefined,
      });
    });

    it('un status desconocido cae a «all» en vez de filtrar mal', async () => {
      const { monitor, c } = build();
      await c.incidents(undefined, undefined, undefined, 'inventado');
      expect(monitor.listIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'all' }),
      );
    });

    it('las comas de más en la lista de servicios no generan filtros vacíos', async () => {
      const { monitor, c } = build();
      await c.incidents(undefined, undefined, 'mirror,,');
      expect(monitor.listIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ services: ['mirror'] }),
      );
    });
  });

  it('el detalle de un incidente se pide por id', async () => {
    const { monitor, c } = build();
    await c.incident('inc-1');
    expect(monitor.getIncident).toHaveBeenCalledWith('inc-1');
  });

  describe('limpieza', () => {
    it('borra hasta la fecha indicada y reporta cuántos', async () => {
      const { monitor, c } = build();
      await expect(c.clear('2026-01-01')).resolves.toEqual({ deleted: 4 });
      expect(monitor.deleteBefore).toHaveBeenCalledWith(new Date('2026-01-01'));
    });

    it('sin fecha usa «ahora»', async () => {
      const { monitor, c } = build();
      const antes = Date.now();
      await c.clear();
      const corte = args(monitor.deleteBefore)[0] as Date;
      expect(corte.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('SystemLogController', () => {
  const build = () => {
    const logs = {
      recentErrors: jest.fn(async () => [{ id: 'l1' }]),
      list: jest.fn(async () => ({ rows: [], total: 0 })),
      getById: jest.fn(async () => ({ id: 'l1' })),
    };
    return { logs, c: new SystemLogController(logs as never) };
  };

  it('los errores recientes usan el límite pedido', async () => {
    const { logs, c } = build();
    await expect(c.recentErrors('10')).resolves.toEqual({
      rows: [{ id: 'l1' }],
    });
    expect(logs.recentErrors).toHaveBeenCalledWith(10);
  });

  it.each([
    ['sin límite', undefined],
    ['límite ilegible', 'muchos'],
  ])('%s cae a 5', async (_e, entrada) => {
    const { logs, c } = build();
    await c.recentErrors(entrada);
    expect(logs.recentErrors).toHaveBeenCalledWith(5);
  });

  it.each([
    ['error', 'ERROR'],
    ['WARNING', 'WARNING'],
    ['Event', 'EVENT'],
  ])('el nivel «%s» se normaliza a %s', async (entrada, esperado) => {
    const { logs, c } = build();
    await c.list(entrada);
    expect(logs.list).toHaveBeenCalledWith(
      expect.objectContaining({ level: esperado }),
    );
  });

  it('un nivel desconocido no filtra nada (ALL)', async () => {
    const { logs, c } = build();
    await c.list('CRITICO');
    expect(logs.list).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'ALL' }),
    );
  });

  it('paginación con defaults', async () => {
    const { logs, c } = build();
    await c.list(undefined, '', undefined, undefined);
    expect(logs.list).toHaveBeenCalledWith({
      level: 'ALL',
      search: undefined,
      page: 1,
      pageSize: 25,
    });
  });

  it('el detalle se envuelve en { log }', async () => {
    const { logs, c } = build();
    await expect(c.getOne('l1')).resolves.toEqual({ log: { id: 'l1' } });
    expect(logs.getById).toHaveBeenCalledWith('l1');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('AnalyticsController', () => {
  const build = () => {
    const service = { getDashboardStats: jest.fn(async () => ({})) };
    return { service, c: new AnalyticsController(service as never) };
  };

  it('las métricas se piden para la clínica del token', () => {
    const { service, c } = build();
    c.getAnalytics(ORG, '2026-01-01', '2026-02-01');
    expect(service.getDashboardStats).toHaveBeenCalledWith(
      ORG,
      '2026-01-01',
      '2026-02-01',
    );
  });

  it('🏢 sin tenant se rechaza: nunca métricas «de todos»', () => {
    const { service, c } = build();
    expect(() => c.getAnalytics('')).toThrow(/Tenant/);
    expect(service.getDashboardStats).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('GlobalStatsController', () => {
  const build = () => {
    const service = {
      listOrganizationsForFilter: jest.fn(async () => []),
      getGlobalStats: jest.fn(async () => ({})),
    };
    return { service, c: new GlobalStatsController(service as never) };
  };

  it('lista las clínicas del filtro', () => {
    const { service, c } = build();
    c.listOrganizations();
    expect(service.listOrganizationsForFilter).toHaveBeenCalled();
  });

  it.each([
    ['today', 'TODAY'],
    ['WEEK', 'WEEK'],
    ['custom', 'CUSTOM'],
  ])('el rango «%s» se normaliza a %s', (entrada, esperado) => {
    const { service, c } = build();
    c.getStats(undefined, entrada);
    expect(service.getGlobalStats).toHaveBeenCalledWith(
      expect.objectContaining({ range: esperado }),
    );
  });

  it('un rango desconocido cae a MONTH', () => {
    const { service, c } = build();
    c.getStats(undefined, 'decada');
    expect(service.getGlobalStats).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'MONTH' }),
    );
  });

  it('«ALL» significa todas las clínicas, no una llamada ALL', () => {
    const { service, c } = build();
    c.getStats('ALL');
    expect(service.getGlobalStats).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null }),
    );
  });

  it('una clínica concreta se pasa tal cual', () => {
    const { service, c } = build();
    c.getStats(ORG, 'MONTH', '2026-01-01', '2026-02-01');
    expect(service.getGlobalStats).toHaveBeenCalledWith({
      organizationId: ORG,
      range: 'MONTH',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('AiConfigController', () => {
  const build = () => {
    const service = {
      getPublic: jest.fn(async () => ({ activeProvider: 'NONE' })),
      upsert: jest.fn(async () => ({ activeProvider: 'GEMINI' })),
    };
    return { service, c: new AiConfigController(service as never) };
  };

  it('el catálogo de modelos se expone tal cual', () => {
    const { c } = build();
    const r = c.catalog();
    expect(r.providers).toEqual(
      expect.objectContaining({ GEMINI: expect.any(Array) }),
    );
  });

  it('lee y escribe la configuración del tenant del token', async () => {
    const { service, c } = build();
    await c.getMine(ORG);
    await c.upsertMine(ORG, { activeProvider: 'GEMINI', apiKey: 'k' } as never);

    expect(service.getPublic).toHaveBeenCalledWith(ORG);
    expect(service.upsert).toHaveBeenCalledWith(ORG, {
      activeProvider: 'GEMINI',
      apiKey: 'k',
    });
  });

  it('sin organización → 403 en las dos rutas', async () => {
    const { c } = build();
    await expect(c.getMine('')).rejects.toThrow(ForbiddenException);
    await expect(
      c.upsertMine('', { activeProvider: 'GEMINI' } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['proveedor inventado', { activeProvider: 'MISTRAL' }],
    ['sin cuerpo', undefined],
    ['sin proveedor', {}],
  ])('%s se rechaza antes de guardar nada', async (_e, body) => {
    const { service, c } = build();
    await expect(c.upsertMine(ORG, body as never)).rejects.toThrow(
      BadRequestException,
    );
    expect(service.upsert).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('AudioConfigController — aislamiento estricto por :orgId', () => {
  const build = () => {
    const audio = {
      getPublic: jest.fn(async () => ({})),
      upsert: jest.fn(async () => ({})),
      diagnose: jest.fn(async () => ({ success: true })),
    };
    return { audio, c: new AudioConfigController(audio as never) };
  };

  it('con el :orgId del propio tenant, las tres rutas funcionan', async () => {
    const { audio, c } = build();

    await c.getConfig(ORG, ORG);
    await c.saveConfig(ORG, ORG, {} as never);
    await c.diagnose(ORG, ORG);

    expect(audio.getPublic).toHaveBeenCalledWith(ORG);
    expect(audio.upsert).toHaveBeenCalledWith(ORG, {});
    expect(audio.diagnose).toHaveBeenCalledWith(ORG);
  });

  it('🔒 adivinar el UUID de otra clínica no sirve: 403 en las tres rutas', async () => {
    const { audio, c } = build();

    await expect(c.getConfig(OTRA_ORG, ORG)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(c.saveConfig(OTRA_ORG, ORG, {} as never)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(c.diagnose(OTRA_ORG, ORG)).rejects.toThrow(ForbiddenException);

    expect(audio.getPublic).not.toHaveBeenCalled();
    expect(audio.upsert).not.toHaveBeenCalled();
    expect(audio.diagnose).not.toHaveBeenCalled();
  });

  it('un token sin organización tampoco pasa', async () => {
    const { c } = build();
    await expect(c.getConfig(ORG, '')).rejects.toThrow(
      /Sin organización en el token/,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('WhatsappConfigController', () => {
  const build = () => {
    const whatsapp = {
      getPublic: jest.fn(async () => ({})),
      upsert: jest.fn(async () => ({})),
    };
    const templates = {
      listForOrg: jest.fn(async () => []),
      upsertForOrg: jest.fn(async () => ({})),
      removeForOrg: jest.fn(async () => ({})),
    };
    return {
      whatsapp,
      templates,
      c: new WhatsappConfigController(whatsapp as never, templates as never),
    };
  };

  it('la configuración del canal es la del token', async () => {
    const { whatsapp, c } = build();
    await c.getMine(ORG);
    await c.upsertMine(ORG, { phoneNumberId: '1' } as never);

    expect(whatsapp.getPublic).toHaveBeenCalledWith(ORG);
    expect(whatsapp.upsert).toHaveBeenCalledWith(ORG, { phoneNumberId: '1' });
  });

  it('🏢 las plantillas también salen del token, nunca del body ni de la ruta', async () => {
    const { templates, c } = build();

    await c.listTemplates(ORG);
    await c.upsertTemplate(ORG, {
      kind: 'APPOINTMENT_REMINDER' as never,
      name: 'recordatorio',
    });
    await c.removeTemplate(ORG, 'APPOINTMENT_REMINDER' as never);

    expect(templates.listForOrg).toHaveBeenCalledWith(ORG);
    expect(templates.upsertForOrg).toHaveBeenCalledWith(ORG, {
      kind: 'APPOINTMENT_REMINDER',
      name: 'recordatorio',
    });
    expect(templates.removeForOrg).toHaveBeenCalledWith(
      ORG,
      'APPOINTMENT_REMINDER',
    );
  });

  it('sin organización, las cinco rutas devuelven 403', async () => {
    const { c } = build();
    await expect(c.getMine('')).rejects.toThrow(ForbiddenException);
    await expect(c.upsertMine('', {} as never)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(c.listTemplates('')).rejects.toThrow(ForbiddenException);
    await expect(c.upsertTemplate('', {} as never)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(c.removeTemplate('', 'X' as never)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('OrganizationsController', () => {
  const build = () => {
    const service = {
      purge: jest.fn(async () => ({ ok: true })),
      quickStats: jest.fn(async () => ({})),
    };
    return { service, c: new OrganizationsController(service as never) };
  };

  const req = (over: Record<string, unknown> = {}) =>
    ({
      user: { userId: 'u-1', email: 'admin@agenia.co' },
      headers: {},
      socket: {},
      ...over,
    }) as never;

  it('el purgado registra QUIÉN lo pidió y desde dónde (auditoría inmutable)', async () => {
    const { service, c } = build();

    await c.purge(
      'org-9',
      { purgePassword: 'secreta' } as never,
      req({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }),
    );

    expect(service.purge).toHaveBeenCalledWith('org-9', 'secreta', {
      actorId: 'u-1',
      actorEmail: 'admin@agenia.co',
      ipAddress: '9.9.9.9',
    });
  });

  it('sin x-forwarded-for cae a req.ip y luego al socket', async () => {
    const { service, c } = build();

    await c.purge('org-9', {} as never, req({ ip: '1.1.1.1' }));
    expect(actorDe(service, 0).ipAddress).toBe('1.1.1.1');

    await c.purge(
      'org-9',
      {} as never,
      req({ socket: { remoteAddress: '2.2.2.2' } }),
    );
    expect(actorDe(service, 1).ipAddress).toBe('2.2.2.2');
  });

  it('un x-forwarded-for en forma de arreglo se resuelve al primero', async () => {
    const { service, c } = build();
    await c.purge(
      'org-9',
      {} as never,
      req({ headers: { 'x-forwarded-for': ['7.7.7.7'] } }),
    );
    expect(actorDe(service, 0).ipAddress).toBe('7.7.7.7');
  });

  it('sin usuario en la request el actor queda en nulos, no revienta', async () => {
    const { service, c } = build();
    await c.purge('org-9', {} as never, { headers: {}, socket: {} } as never);
    expect(actorDe(service, 0)).toEqual({
      actorId: null,
      actorEmail: null,
      ipAddress: null,
    });
  });

  it('sin contraseña de purgado se delega igual: el servicio es quien la exige', async () => {
    const { service, c } = build();
    await c.purge('org-9', undefined as never, req());
    expect(service.purge).toHaveBeenCalledWith(
      'org-9',
      undefined,
      expect.anything(),
    );
  });

  it('quick-stats delega por id', async () => {
    const { service, c } = build();
    await c.quickStats('org-9');
    expect(service.quickStats).toHaveBeenCalledWith('org-9');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('SurveyController — endpoints públicos (el paciente no tiene sesión)', () => {
  const build = () => {
    const service = {
      getValidSurvey: jest.fn(async () => ({ id: 's1' })),
      submitSurvey: jest.fn(async () => ({ success: true })),
    };
    return { service, c: new SurveyController(service as never) };
  };

  it('un token válido devuelve la vista pública', async () => {
    const { c } = build();
    await expect(c.getSurvey('s1')).resolves.toEqual({ id: 's1' });
  });

  it('un token inválido/usado/expirado devuelve 404, no una pista de por qué', async () => {
    const { service, c } = build();
    service.getValidSurvey.mockResolvedValue(null as never);

    await expect(c.getSurvey('s1')).rejects.toThrow('Encuesta no disponible.');
  });

  it('el envío delega la regla de oro al servicio', async () => {
    const { service, c } = build();
    await c.submitSurvey('s1', { rating: 5 } as never);
    expect(service.submitSurvey).toHaveBeenCalledWith('s1', { rating: 5 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('Controladores de reportes de encuestas', () => {
  describe('SuperadminSurveyController', () => {
    const build = () => {
      const service = { findDetailedForSuperAdmin: jest.fn(async () => ({})) };
      return { service, c: new SuperadminSurveyController(service as never) };
    };

    it('los defaults de paginación y orden', () => {
      const { service, c } = build();
      c.getDetailed();

      expect(service.findDetailedForSuperAdmin).toHaveBeenCalledWith({
        page: 1,
        pageSize: 25,
        sortBy: 'createdAt',
        sortDir: 'desc',
        startDate: undefined,
        endDate: undefined,
        organizationId: undefined,
        mood: undefined,
        resolutionStatus: undefined,
      });
    });

    it('acepta orden por calificación ascendente', () => {
      const { service, c } = build();
      c.getDetailed('2', '10', 'rating', 'asc');

      expect(service.findDetailedForSuperAdmin).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          pageSize: 10,
          sortBy: 'rating',
          sortDir: 'asc',
        }),
      );
    });

    it('un campo de orden desconocido cae a createdAt desc', () => {
      const { service, c } = build();
      c.getDetailed(undefined, undefined, 'cedula', 'diagonal');

      expect(service.findDetailedForSuperAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'createdAt', sortDir: 'desc' }),
      );
    });

    it('un mood o un estado de resolución inventados se descartan', () => {
      const { service, c } = build();
      c.getDetailed(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'EUFORICO',
        'INVENTADO',
      );

      expect(service.findDetailedForSuperAdmin).toHaveBeenCalledWith(
        expect.objectContaining({
          mood: undefined,
          resolutionStatus: undefined,
        }),
      );
    });

    it('una página no numérica cae a 1', () => {
      const { service, c } = build();
      c.getDetailed('abc');
      expect(service.findDetailedForSuperAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    });
  });

  describe('ClinicSurveyController', () => {
    const build = () => {
      const service = { findLimitedForClinic: jest.fn(async () => ({})) };
      return { service, c: new ClinicSurveyController(service as never) };
    };

    it('con el :orgId propio, devuelve las encuestas de esa clínica', () => {
      const { service, c } = build();
      c.getLimited(ORG, ORG);
      expect(service.findLimitedForClinic).toHaveBeenCalledWith(ORG, {
        page: 1,
        pageSize: 25,
        sortBy: 'createdAt',
        sortDir: 'desc',
      });
    });

    it('🔒 cambiar el :orgId por el de otra clínica → 403', () => {
      const { service, c } = build();
      expect(() => c.getLimited(OTRA_ORG, ORG)).toThrow(ForbiddenException);
      expect(service.findLimitedForClinic).not.toHaveBeenCalled();
    });

    it('un token sin organización tampoco pasa', () => {
      const { c } = build();
      expect(() => c.getLimited(ORG, '')).toThrow(ForbiddenException);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('ClinicalRecordsController', () => {
  const build = () => {
    const service = {
      createClinicalRecord: jest.fn(async () => ({})),
      updateClinicalRecord: jest.fn(async () => ({})),
      signClinicalRecord: jest.fn(async () => ({})),
      createAddendum: jest.fn(async () => ({})),
      getClinicalRecordByAppointment: jest.fn(async () => ({})),
    };
    return { service, c: new ClinicalRecordsController(service as never) };
  };
  const usuario = { userId: 'doc-1', role: 'DOCTOR' } as never;

  it('crear y actualizar van acotados al tenant del token', async () => {
    const { service, c } = build();
    await c.createRecord({ a: 1 } as never, ORG);
    await c.updateRecord('rec-1', { b: 2 } as never, ORG);

    expect(service.createClinicalRecord).toHaveBeenCalledWith({ a: 1 }, ORG);
    expect(service.updateClinicalRecord).toHaveBeenCalledWith(
      'rec-1',
      { b: 2 },
      ORG,
    );
  });

  it('🖊️ el firmante es SIEMPRE el usuario autenticado (no-repudio)', async () => {
    const { service, c } = build();
    await c.signRecord('rec-1', ORG, usuario, '1.2.3.4');

    expect(service.signClinicalRecord).toHaveBeenCalledWith(
      'rec-1',
      'doc-1',
      ORG,
      '1.2.3.4',
    );
  });

  it('la adenda registra tanto el médico declarado como el actor real', async () => {
    const { service, c } = build();
    await c.createAddendum('rec-1', 'doc-9', 'corrijo la dosis', ORG, usuario);

    expect(service.createAddendum).toHaveBeenCalledWith(
      'rec-1',
      'doc-9',
      'corrijo la dosis',
      ORG,
      'doc-1',
      undefined,
    );
  });

  it('la consulta por cita lleva quién pregunta: un paciente solo ve la suya', async () => {
    const { service, c } = build();
    await c.getByAppointment('apt-1', ORG, {
      userId: 'pac-1',
      role: 'PATIENT',
    } as never);

    expect(service.getClinicalRecordByAppointment).toHaveBeenCalledWith(
      'apt-1',
      ORG,
      { userId: 'pac-1', role: 'PATIENT' },
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('ClinicalAiController', () => {
  const build = () => {
    const service = { transcribeDictation: jest.fn(async () => ({})) };
    return { service, c: new ClinicalAiController(service as never) };
  };

  it('el prefijo data: del navegador se recorta antes de mandar el audio', async () => {
    const { service, c } = build();
    await c.transcribeDictation(ORG, {
      audioBase64: 'data:audio/webm;base64,AAAA',
    });

    expect(service.transcribeDictation).toHaveBeenCalledWith(
      ORG,
      'AAAA',
      'audio/webm',
    );
  });

  it.each(['mp4', 'mp3', 'ogg', 'mpeg'])(
    'también recorta el prefijo de %s',
    async (fmt) => {
      const { service, c } = build();
      await c.transcribeDictation(ORG, {
        audioBase64: `data:audio/${fmt};base64,BBBB`,
        mimeType: `audio/${fmt}`,
      });
      expect(service.transcribeDictation).toHaveBeenCalledWith(
        ORG,
        'BBBB',
        `audio/${fmt}`,
      );
    },
  );

  it('un base64 pelado pasa tal cual', async () => {
    const { service, c } = build();
    await c.transcribeDictation(ORG, { audioBase64: 'CCCC' });
    expect(service.transcribeDictation).toHaveBeenCalledWith(
      ORG,
      'CCCC',
      'audio/webm',
    );
  });

  it('sin organización → 403', async () => {
    const { service, c } = build();
    await expect(
      c.transcribeDictation('', { audioBase64: 'x' }),
    ).rejects.toThrow(ForbiddenException);
    expect(service.transcribeDictation).not.toHaveBeenCalled();
  });

  it('sin audio se rechaza', async () => {
    const { c } = build();
    await expect(
      c.transcribeDictation(ORG, { audioBase64: '' }),
    ).rejects.toThrow(/audio/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('Hl7FhirController', () => {
  const build = () => {
    const service = { getPatientSummaryBundle: jest.fn(async () => ({})) };
    return { service, c: new Hl7FhirController(service as never) };
  };

  it('un rol de clínica recibe el bundle ACOTADO a su organización', async () => {
    const { service, c } = build();
    await c.getPatientDocument('pac-1', {
      role: 'DOCTOR',
      organizationId: ORG,
    } as never);

    expect(service.getPatientSummaryBundle).toHaveBeenCalledWith('pac-1', ORG);
  });

  it('SUPER_ADMIN es el único sin tenant: su bundle no se acota', async () => {
    const { service, c } = build();
    await c.getPatientDocument('pac-1', { role: 'SUPER_ADMIN' } as never);

    expect(service.getPatientSummaryBundle).toHaveBeenCalledWith('pac-1', null);
  });

  it('un usuario de clínica SIN organización no obtiene acceso global', async () => {
    const { service, c } = build();
    await c.getPatientDocument('pac-1', { role: 'DOCTOR' } as never);

    // null aquí no significa "todo": el servicio lo interpreta como sin tenant.
    expect(service.getPatientSummaryBundle).toHaveBeenCalledWith('pac-1', null);
  });
});

import { BadRequestException } from '@nestjs/common';
import type { ResumenAtencionHis } from '@agenia/shared';
import { ResumenEnvioService, hashDelDestino } from './resumen-envio.service';

// El programador del aviso (Fase 4). Lo que se fija: solo con «Enviar», en
// horario y en las últimas 24 h; lo sensible y la baja no salen; el número del
// HIS de otro paciente no se usa; los interruptores (modo prueba) frenan sin
// marcar nada; fuera de la ventana va la plantilla con el botón y dentro, el
// mensaje con botón; «Enviar de prueba» solo a números del equipo.

const ORG = 'org-1';
const AHORA = new Date('2026-11-01T15:00:00.000Z'); // 10:00 en Bogotá

function resumen(c: Partial<ResumenAtencionHis> = {}): ResumenAtencionHis {
  return {
    version: 1,
    historia: {
      numero: '2441058',
      guardadaIso: '2026-11-01T14:00:00.000Z',
      servicio: 'S39141',
      nombreServicio: 'CONSULTA MEDICINA GENERAL',
      plantilla: null,
      codigoPlantilla: null,
      nombrePlantilla: null,
      especialidad: 'MEDICINA GENERAL',
      edad: 46,
    },
    paciente: {
      documento: '900000001',
      tipoDocumento: 'CC',
      nombre: 'ADULTO PRUEBA',
      fechaNacimientoIso: '1980-05-17',
      celular: '3001234567',
      correo: null,
      celularAcompanante: null,
      correoAcompanante: null,
    },
    medico: { codigo: null, nombre: null, documento: null, registro: null },
    afiliacion: { convenio: null, administradora: null, tipoUsuario: null },
    diagnosticos: [
      { cie10: 'I10X', descripcion: 'HTA', tipo: null, principal: true },
    ],
    ordenes: [],
    remisiones: [],
    incapacidades: [],
    interconsultas: [],
    indicaciones: [],
    campos: [],
    ...c,
  };
}

const CONFIG = {
  leerDelHospital: true,
  enviar: true,
  canales: { WHATSAPP: true },
  servicios: { S39141: { WHATSAPP: true } },
  modoPrueba: { destinos: ['573001234567'] },
};

function armar(
  o: {
    config?: unknown;
    resumenes?: ResumenAtencionHis[];
    perfil?: unknown;
    duenos?: { cedula: string }[];
    ventana?: boolean;
    plantilla?: { success: boolean; error?: string };
    bajas?: string[];
    telegram?: { ok: boolean; blocked?: boolean };
    smtp?: { ok: boolean; error?: string };
    sinContenido?: boolean;
    previos?: { channel: string; status: string; createdAt: Date }[];
    redis?: Record<string, string>;
  } = {},
) {
  const actualizados: any[] = [];
  const entregas: any[] = [];
  const prisma: any = {
    hospitalMirrorConfig: {
      findMany: jest.fn(async () => [
        {
          organizationId: ORG,
          resumenAtencion: o.config ?? CONFIG,
          organization: { timezone: null, isActive: true },
        },
      ]),
      findUnique: jest.fn(async () => ({
        resumenAtencion: o.config ?? CONFIG,
        organization: { timezone: null },
      })),
    },
    attentionSummary: {
      findMany: jest.fn(async () =>
        (o.resumenes ?? [resumen()]).map((r, i) => ({
          id: `s-${i}`,
          content: JSON.stringify(r),
          serviceCode: r.historia.servicio,
          patientProfileId: o.perfil ? 'p-1' : null,
          status: 'RECIBIDO',
          deliveries: o.previos ?? [],
        })),
      ),
      update: jest.fn(async (a: any) => actualizados.push(a)),
      findUnique: jest.fn(async () => ({
        contentExpiresAt: new Date(Date.now() + 86_400_000),
        organization: { name: 'Hospital AgenIA' },
      })),
      findFirst: jest.fn(async () => ({
        id: 's-0',
        hisKey: '2441058',
        content: o.sinContenido
          ? null
          : JSON.stringify((o.resumenes ?? [resumen()])[0]),
        serviceCode: 'S39141',
        patientProfileId: o.perfil ? 'p-1' : null,
      })),
    },
    patientProfile: {
      findUnique: jest.fn(async () => o.perfil ?? null),
      findMany: jest.fn(async () => o.duenos ?? []),
    },
    syncException: { findFirst: jest.fn(async () => null) },
    attentionSummaryOptOut: {
      findMany: jest.fn(async () =>
        (o.bajas ?? []).map((d) => ({ destinationHash: hashDelDestino(d) })),
      ),
    },
    attentionSummaryDelivery: {
      create: jest.fn(async ({ data }: any) => {
        const e = {
          id: `6f9619ff-8b86-d011-b42d-00cf4fc964f${entregas.length}`,
          ...data,
        };
        entregas.push(e);
        return e;
      }),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(
          entregas.find((e) => e.id === where.id),
          data,
        ),
      ),
    },
  };
  const plantillas: any = {
    sendTemplate: jest.fn(
      async () =>
        o.plantilla ?? { success: true, templateName: 'documentos_consulta' },
    ),
  };
  const whatsapp: any = { botones: jest.fn(async () => ({ ok: true })) };
  const memoria = new Map<string, string>(Object.entries(o.redis ?? {}));
  const redis: any = {
    get: jest.fn(async (k: string) =>
      k.startsWith('wa_window:')
        ? o.ventana
          ? String(Date.now())
          : null
        : (memoria.get(k) ?? null),
    ),
    set: jest.fn(async (k: string, v: string) => memoria.set(k, v)),
  };
  const bitacora: any = { event: jest.fn(async () => undefined) };
  const telegram: any = {
    sendTextConTeclado: jest.fn(async () => ({
      ok: o.telegram?.ok ?? true,
      blocked: o.telegram?.blocked ?? false,
      errorCode: o.telegram?.blocked ? 403 : null,
      messageId: 1,
    })),
  };
  const correoSmtp: any = {
    enviar: jest.fn(async () => o.smtp ?? { ok: true, id: 'm1' }),
  };
  const generador = {
    pdfCompleto: jest.fn(async () => ({
      nombreArchivo: 'Documentos_01-11-2026.pdf',
      tipo: 'application/pdf',
      datos: Buffer.from('%PDF'),
    })),
  };
  const documentos: any = { generador: jest.fn(async () => generador) };
  const enlaces: any = {
    crearEnlace: jest.fn(async () => ({ token: 'TOKEN' })),
  };
  const s = new ResumenEnvioService(
    prisma,
    { decrypt: (x: string) => x } as any,
    redis,
    plantillas,
    whatsapp,
    bitacora,
    telegram,
    correoSmtp,
    documentos,
    enlaces,
  );
  return {
    s,
    memoria,
    prisma,
    plantillas,
    whatsapp,
    actualizados,
    entregas,
    bitacora,
    telegram,
    correoSmtp,
    generador,
  };
}

describe('ResumenEnvioService.programar', () => {
  it('fuera de la ventana: plantilla con nombre, fecha y el botón con el envío; el resumen queda ENVIADO', async () => {
    const a = armar();
    await expect(a.s.programar(AHORA)).resolves.toEqual({
      avisados: 1,
      excluidos: 0,
      sinContacto: 0,
      fallos: 0,
      correos: 0,
    });
    const llamada = a.plantillas.sendTemplate.mock.calls[0][0];
    expect(llamada).toMatchObject({
      organizationId: ORG,
      recipientId: '573001234567',
      kind: 'ATTENTION_SUMMARY_READY',
      bodyParams: ['Adulto', 'domingo, 1 de noviembre'],
    });
    expect(llamada.buttonPayloads).toEqual([`resumen:${a.entregas[0].id}`]);
    // Trazabilidad: el aviso queda en el libro de mensajes con su envío.
    expect(llamada.attentionSummaryDeliveryId).toBe(a.entregas[0].id);
    expect(a.entregas[0]).toMatchObject({
      channel: 'WHATSAPP',
      purpose: 'PACIENTE',
      destinationHash: hashDelDestino('573001234567'),
      destinationMasked: '•••4567',
      destinationOrigin: 'HIS',
      status: 'AVISO_ENVIADO',
      templateName: 'documentos_consulta',
    });
    expect(JSON.stringify(a.entregas)).not.toContain('573001234567');
    expect(a.actualizados).toEqual([
      { where: { id: 's-0' }, data: { status: 'ENVIADO', statusReason: null } },
    ]);
  });

  it('dentro de la ventana: mensaje con el botón, sin plantilla', async () => {
    const a = armar({ ventana: true });
    await a.s.programar(AHORA);
    expect(a.plantillas.sendTemplate).not.toHaveBeenCalled();
    const [, destino, cuerpo, botones, entrega] =
      a.whatsapp.botones.mock.calls[0];
    expect(entrega).toBe(a.entregas[0].id);
    expect(destino).toBe('573001234567');
    expect(cuerpo).toContain(
      'documentos de su consulta del domingo, 1 de noviembre',
    );
    expect(botones).toEqual([
      { id: `resumen:${a.entregas[0].id}`, titulo: 'Recibir documentos' },
    ]);
  });

  it('con «Enviar» apagado o fuera de horario no hace nada', async () => {
    const apagado = armar({ config: { ...CONFIG, enviar: false } });
    await apagado.s.programar(AHORA);
    expect(apagado.prisma.attentionSummary.findMany).not.toHaveBeenCalled();
    const noche = armar();
    await noche.s.programar(new Date('2026-11-02T02:00:00.000Z')); // 21:00
    expect(noche.prisma.attentionSummary.findMany).not.toHaveBeenCalled();
  });

  it('modo prueba: un número que no es del equipo no recibe y el resumen queda esperando', async () => {
    const a = armar({
      resumenes: [
        resumen({ paciente: { ...resumen().paciente, celular: '3109998877' } }),
      ],
    });
    await expect(a.s.programar(AHORA)).resolves.toEqual({
      avisados: 0,
      excluidos: 0,
      sinContacto: 0,
      fallos: 0,
      correos: 0,
    });
    expect(a.entregas).toEqual([]);
    expect(a.actualizados).toEqual([]);
  });

  it('lo sensible (D7) y la baja quedan EXCLUIDOS sin aviso', async () => {
    const a = armar({
      resumenes: [
        resumen({
          diagnosticos: [
            {
              cie10: 'F412',
              descripcion: 'ANSIEDAD',
              tipo: null,
              principal: true,
            },
          ],
        }),
      ],
    });
    await a.s.programar(AHORA);
    expect(a.actualizados[0].data).toEqual({
      status: 'EXCLUIDO',
      statusReason: 'Diagnóstico excluido (F)',
    });
    const baja = armar({
      perfil: {
        id: 'p-1',
        whatsappId: null,
        bsuid: null,
        summariesOptOut: true,
      },
    });
    await baja.s.programar(AHORA);
    expect(baja.actualizados[0].data.status).toBe('EXCLUIDO');
    expect(baja.plantillas.sendTemplate).not.toHaveBeenCalled();
  });

  it('el celular del HIS que AgenIA tiene a nombre de otro documento no se usa (D5)', async () => {
    const a = armar({ duenos: [{ cedula: '123456' }] });
    await a.s.programar(AHORA);
    expect(a.actualizados[0].data).toEqual({
      status: 'SIN_CONTACTO',
      statusReason: 'El celular del HIS es de otro paciente en AgenIA',
    });
  });

  it('el número de la ficha va primero', async () => {
    const config = { ...CONFIG, modoPrueba: { destinos: ['573005550000'] } };
    const a = armar({
      config,
      perfil: {
        id: 'p-1',
        whatsappId: '573005550000',
        bsuid: null,
        summariesOptOut: false,
      },
    });
    await a.s.programar(AHORA);
    expect(a.plantillas.sendTemplate.mock.calls[0][0].recipientId).toBe(
      '573005550000',
    );
    expect(a.entregas[0].destinationOrigin).toBe('PERFIL');
  });

  it('plantilla sin configurar: el envío queda FALLO con el motivo y el resumen sigue RECIBIDO', async () => {
    const a = armar({
      plantilla: { success: false, error: 'template-not-configured' },
    });
    await expect(a.s.programar(AHORA)).resolves.toMatchObject({ fallos: 1 });
    expect(a.entregas[0]).toMatchObject({
      status: 'FALLO',
      statusReason:
        'La plantilla «Documentos de la consulta» no está configurada',
    });
    expect(a.actualizados[0].data.status).toBe('RECIBIDO');
  });
});

describe('ResumenEnvioService.enviarDePrueba', () => {
  const QUIEN = { userId: 'u-1', email: 'admin@hospital.co' };
  it('solo a un número del modo prueba, y deja constancia', async () => {
    const a = armar();
    await expect(
      a.s.enviarDePrueba(ORG, 's-0', '300 123 4567', QUIEN),
    ).resolves.toEqual({ ok: true });
    expect(a.entregas[0]).toMatchObject({
      purpose: 'PRUEBA',
      destinationOrigin: 'PRUEBA',
      createdByUserId: 'u-1',
    });
    expect(a.actualizados).toEqual([]);
    expect(a.bitacora.event).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ATTENTION_SUMMARY_TEST_SEND' }),
    );
    await expect(
      a.s.enviarDePrueba(ORG, 's-0', '3109998877', QUIEN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Telegram (D26) y la baja por número', () => {
  const CONFIG_TG = {
    ...CONFIG,
    canales: { WHATSAPP: true, TELEGRAM: true },
    servicios: { S39141: { WHATSAPP: true, TELEGRAM: true } },
    modoPrueba: { destinos: ['573001234567', 'tg:555'] },
  };
  const perfilTg = {
    id: 'p-1',
    whatsappId: null,
    bsuid: null,
    summariesOptOut: false,
    telegramChatId: '555',
    telegramBlockedAt: null,
  };

  it('con el chat unido va por Telegram, con el botón de teclado, y no se duplica por WhatsApp', async () => {
    const a = armar({ config: CONFIG_TG, perfil: perfilTg });
    await expect(a.s.programar(AHORA)).resolves.toMatchObject({ avisados: 1 });
    const [org, destino, texto, teclado, ctx] =
      a.telegram.sendTextConTeclado.mock.calls[0];
    expect([org, destino]).toEqual([ORG, 'tg:555']);
    expect(texto).toContain('documentos de su consulta');
    expect(teclado).toEqual({ botones: ['Recibir mis documentos'] });
    expect(ctx).toEqual({
      kind: 'ATTENTION_SUMMARY',
      attentionSummaryDeliveryId: a.entregas[0].id,
    });
    expect(a.plantillas.sendTemplate).not.toHaveBeenCalled();
    expect(a.entregas).toEqual([
      expect.objectContaining({
        channel: 'TELEGRAM',
        status: 'AVISO_ENVIADO',
        destinationHash: hashDelDestino('tg:555'),
      }),
    ]);
    expect(a.actualizados[0].data.status).toBe('ENVIADO');
  });

  it('si bloqueó el bot, cae a WhatsApp en la misma vuelta', async () => {
    const a = armar({
      config: CONFIG_TG,
      perfil: perfilTg,
      telegram: { ok: false, blocked: true },
    });
    await expect(a.s.programar(AHORA)).resolves.toMatchObject({ avisados: 1 });
    expect(
      a.entregas.map((e) => [e.channel, e.status, e.statusReason]),
    ).toEqual([
      ['TELEGRAM', 'FALLO', 'El paciente bloqueó el bot de Telegram'],
      ['WHATSAPP', 'AVISO_ENVIADO', null],
    ]);
  });

  it('con Telegram apagado para el servicio, va por WhatsApp; con el chat bloqueado, ni se intenta', async () => {
    const apagado = armar({
      config: { ...CONFIG_TG, servicios: { S39141: { WHATSAPP: true } } },
      perfil: perfilTg,
    });
    await apagado.s.programar(AHORA);
    expect(apagado.telegram.sendTextConTeclado).not.toHaveBeenCalled();
    expect(apagado.plantillas.sendTemplate).toHaveBeenCalled();
    const bloqueado = armar({
      config: CONFIG_TG,
      perfil: { ...perfilTg, telegramBlockedAt: new Date() },
    });
    await bloqueado.s.programar(AHORA);
    expect(bloqueado.telegram.sendTextConTeclado).not.toHaveBeenCalled();
  });

  it('el número que pidió la baja no recibe: sin otro número, EXCLUIDO', async () => {
    const a = armar({ bajas: ['573001234567'] });
    await a.s.programar(AHORA);
    expect(a.actualizados[0].data).toEqual({
      status: 'EXCLUIDO',
      statusReason: 'El paciente se dio de baja de los resúmenes',
    });
    expect(a.plantillas.sendTemplate).not.toHaveBeenCalled();
  });

  it('«Enviar de prueba» a un chat «tg:» del modo prueba va por Telegram', async () => {
    const a = armar({ config: CONFIG_TG });
    await expect(
      a.s.enviarDePrueba(ORG, 's-0', 'tg:555', {
        userId: 'u-1',
        email: 'a@b.co',
      }),
    ).resolves.toEqual({ ok: true });
    expect(a.telegram.sendTextConTeclado.mock.calls[0][1]).toBe('tg:555');
    expect(a.entregas[0]).toMatchObject({
      channel: 'TELEGRAM',
      purpose: 'PRUEBA',
    });
  });
});

describe('correo (Fase 3)', () => {
  const CONFIG_CORREO = {
    ...CONFIG,
    canales: { WHATSAPP: true, EMAIL: true },
    servicios: { S39141: { WHATSAPP: true, EMAIL: true } },
    modoPrueba: { destinos: ['573001234567', 'ana.perez@gmail.com'] },
  };
  const conCorreo = (correo: string | null) =>
    resumen({ paciente: { ...resumen().paciente, correo } });

  beforeEach(() => {
    process.env.PUBLIC_WEB_URL = 'https://hospital.example';
  });

  it('además del WhatsApp, un correo sin datos clínicos con el PDF protegido con el documento y el enlace', async () => {
    const a = armar({
      config: CONFIG_CORREO,
      resumenes: [conCorreo('Ana.Perez@Gmail.com')],
    });
    await expect(a.s.programar(AHORA)).resolves.toMatchObject({
      avisados: 1,
      correos: 1,
    });
    expect(a.generador.pdfCompleto).toHaveBeenCalledWith({
      clave: '900000001',
    });
    const correo = a.correoSmtp.enviar.mock.calls[0][0];
    expect(correo.para).toBe('ana.perez@gmail.com');
    expect(correo.asunto).toBe(
      'Documentos de su consulta del domingo, 1 de noviembre',
    );
    expect(correo.texto).toContain(
      'su número de documento, sin puntos ni espacios',
    );
    expect(correo.texto).toContain('https://hospital.example/resumen/TOKEN');
    expect(correo.texto).not.toMatch(/HTA|I10X|900000001/);
    expect(correo.adjunto).toMatchObject({
      nombre: 'Documentos_01-11-2026.pdf',
      tipo: 'application/pdf',
    });
    expect(a.entregas.map((e) => [e.channel, e.status])).toEqual([
      ['WHATSAPP', 'AVISO_ENVIADO'],
      ['EMAIL', 'DOCUMENTOS_ENVIADOS'],
    ]);
  });

  it('el correo de relleno del hospital no se usa: queda NO_ENVIADO y no se vuelve a mirar', async () => {
    const a = armar({
      config: CONFIG_CORREO,
      resumenes: [conCorreo('pacienteshospital@gmail.com')],
    });
    await a.s.programar(AHORA);
    expect(a.correoSmtp.enviar).not.toHaveBeenCalled();
    expect(a.entregas.at(-1)).toMatchObject({
      channel: 'EMAIL',
      status: 'NO_ENVIADO',
      statusReason: 'Sin correo utilizable (vacío o de relleno)',
    });
  });

  it('con el canal de correo apagado, o un correo fuera del modo prueba, no sale ni se anota', async () => {
    const apagado = armar({ resumenes: [conCorreo('ana.perez@gmail.com')] });
    await apagado.s.programar(AHORA);
    expect(apagado.correoSmtp.enviar).not.toHaveBeenCalled();
    const fuera = armar({
      config: CONFIG_CORREO,
      resumenes: [conCorreo('otro@gmail.com')],
    });
    await fuera.s.programar(AHORA);
    expect(fuera.correoSmtp.enviar).not.toHaveBeenCalled();
    expect(fuera.entregas.filter((e) => e.channel === 'EMAIL')).toEqual([]);
  });

  it('sin celular (SIN_CONTACTO) el correo sale igual; lo excluido no sale por ningún canal', async () => {
    const sinCel = armar({
      config: CONFIG_CORREO,
      resumenes: [
        resumen({
          paciente: {
            ...resumen().paciente,
            celular: null,
            correo: 'ana.perez@gmail.com',
          },
        }),
      ],
    });
    await expect(sinCel.s.programar(AHORA)).resolves.toMatchObject({
      sinContacto: 1,
      correos: 1,
    });
    const excluido = armar({
      config: CONFIG_CORREO,
      resumenes: [
        {
          ...conCorreo('ana.perez@gmail.com'),
          diagnosticos: [
            { cie10: 'F412', descripcion: null, tipo: null, principal: true },
          ],
        },
      ],
    });
    await excluido.s.programar(AHORA);
    expect(excluido.correoSmtp.enviar).not.toHaveBeenCalled();
  });

  it('si el servidor de correo falla, el envío queda FALLO con el motivo', async () => {
    const a = armar({
      config: CONFIG_CORREO,
      resumenes: [conCorreo('ana.perez@gmail.com')],
      smtp: {
        ok: false,
        error: 'El correo no está configurado en el servidor',
      },
    });
    await a.s.programar(AHORA);
    expect(a.entregas.at(-1)).toMatchObject({
      channel: 'EMAIL',
      status: 'FALLO',
      statusReason: 'El correo no está configurado en el servidor',
    });
  });

  it('«Enviar de prueba» a un correo del modo prueba manda el correo con los documentos', async () => {
    const a = armar({ config: CONFIG_CORREO });
    await expect(
      a.s.enviarDePrueba(ORG, 's-0', 'Ana.Perez@gmail.com', {
        userId: 'u-1',
        email: 'a@b.co',
      }),
    ).resolves.toEqual({ ok: true });
    expect(a.correoSmtp.enviar.mock.calls[0][0].para).toBe(
      'ana.perez@gmail.com',
    );
    expect(a.entregas[0]).toMatchObject({
      channel: 'EMAIL',
      purpose: 'PRUEBA',
      status: 'DOCUMENTOS_ENVIADOS',
    });
  });
});

describe('«Reenviar» (plan §4.6)', () => {
  const QUIEN = { userId: 'u-2', email: 'agendador@hospital.co' };

  it('vuelve a avisar por WhatsApp aunque ya se haya avisado, y deja constancia', async () => {
    const a = armar();
    await expect(a.s.reenviar(ORG, 's-0', QUIEN)).resolves.toEqual({
      enviados: ['WHATSAPP'],
    });
    expect(a.entregas[0]).toMatchObject({
      purpose: 'REENVIO',
      createdByUserId: 'u-2',
      status: 'AVISO_ENVIADO',
    });
    expect(a.bitacora.event).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ATTENTION_SUMMARY_RESENT',
        userId: 'u-2',
      }),
    );
  });

  it('lo sensible, la baja, el envío apagado o el contenido borrado no salen, y dice por qué', async () => {
    const sensible = armar({
      resumenes: [
        resumen({
          diagnosticos: [
            { cie10: 'F412', descripcion: null, tipo: null, principal: true },
          ],
        }),
      ],
    });
    await expect(sensible.s.reenviar(ORG, 's-0', QUIEN)).resolves.toEqual({
      enviados: [],
      motivo: 'Esta atención no se envía: diagnóstico excluido (f).',
    });
    const baja = armar({
      perfil: {
        id: 'p-1',
        whatsappId: null,
        bsuid: null,
        summariesOptOut: true,
        telegramChatId: null,
        telegramBlockedAt: null,
      },
    });
    await expect(baja.s.reenviar(ORG, 's-0', QUIEN)).resolves.toMatchObject({
      enviados: [],
      motivo: expect.stringContaining('activar resúmenes'),
    });
    const apagado = armar({ config: { ...CONFIG, enviar: false } });
    await expect(apagado.s.reenviar(ORG, 's-0', QUIEN)).resolves.toEqual({
      enviados: [],
      motivo: '«Enviar a pacientes» está apagado.',
    });
    const borrado = armar({ sinContenido: true });
    await expect(borrado.s.reenviar(ORG, 's-0', QUIEN)).resolves.toMatchObject({
      enviados: [],
      motivo: expect.stringContaining('ya se borró'),
    });
    expect(sensible.plantillas.sendTemplate).not.toHaveBeenCalled();
  });

  it('en modo prueba, a un número que no es del equipo no sale', async () => {
    const a = armar({
      resumenes: [
        resumen({ paciente: { ...resumen().paciente, celular: '3109998877' } }),
      ],
    });
    await expect(a.s.reenviar(ORG, 's-0', QUIEN)).resolves.toEqual({
      enviados: [],
      motivo:
        'WhatsApp: modo prueba: el destino no está en la lista del equipo',
    });
  });
});

describe('reintentos y espera eficiente', () => {
  const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);

  it('un aviso que falló hace más de 30 minutos se reintenta; uno reciente espera sin abrir el contenido', async () => {
    const viejo = armar({
      previos: [{ channel: 'WHATSAPP', status: 'FALLO', createdAt: hace(45) }],
    });
    await expect(viejo.s.programar(AHORA)).resolves.toMatchObject({
      avisados: 1,
    });

    const reciente = armar({
      previos: [{ channel: 'WHATSAPP', status: 'FALLO', createdAt: hace(10) }],
    });
    await expect(reciente.s.programar(AHORA)).resolves.toMatchObject({
      avisados: 0,
      fallos: 0,
    });
    expect(reciente.plantillas.sendTemplate).not.toHaveBeenCalled();
    expect(reciente.prisma.patientProfile.findMany).not.toHaveBeenCalled();
  });

  it('después de tres fallos no se insiste más', async () => {
    const a = armar({
      previos: [200, 150, 100].map((m) => ({
        channel: 'WHATSAPP',
        status: 'FALLO',
        createdAt: hace(m),
      })),
    });
    await a.s.programar(AHORA);
    expect(a.plantillas.sendTemplate).not.toHaveBeenCalled();
  });

  it('lo que espera por un interruptor queda anotado y no se vuelve a abrir hasta que cambien los interruptores', async () => {
    const fuera = resumen({
      paciente: { ...resumen().paciente, celular: '3109998877' },
    });
    const a = armar({ resumenes: [fuera] });
    await a.s.programar(AHORA);
    const huella = a.memoria.get('resumen_espera:s-0');
    expect(huella).toBeDefined();

    // Misma huella: no se abre el resumen (ni se busca la ficha).
    const otra = armar({
      resumenes: [fuera],
      redis: { 'resumen_espera:s-0': huella! },
    });
    await otra.s.programar(AHORA);
    expect(otra.prisma.patientProfile.findMany).not.toHaveBeenCalled();

    // Cambió el modo prueba: se vuelve a mirar y sale.
    const cambio = armar({
      resumenes: [fuera],
      redis: { 'resumen_espera:s-0': huella! },
      config: { ...CONFIG, modoPrueba: { destinos: ['573109998877'] } },
    });
    await expect(cambio.s.programar(AHORA)).resolves.toMatchObject({
      avisados: 1,
    });
  });
});

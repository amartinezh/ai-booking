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
        })),
      ),
      update: jest.fn(async (a: any) => actualizados.push(a)),
      findFirst: jest.fn(async () => ({
        id: 's-0',
        hisKey: '2441058',
        content: JSON.stringify(resumen()),
      })),
    },
    patientProfile: {
      findUnique: jest.fn(async () => o.perfil ?? null),
      findMany: jest.fn(async () => o.duenos ?? []),
    },
    syncException: { findFirst: jest.fn(async () => null) },
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
  const redis: any = {
    get: jest.fn(async () => (o.ventana ? String(Date.now()) : null)),
  };
  const bitacora: any = { event: jest.fn(async () => undefined) };
  const s = new ResumenEnvioService(
    prisma,
    { decrypt: (x: string) => x } as any,
    redis,
    plantillas,
    whatsapp,
    bitacora,
  );
  return { s, prisma, plantillas, whatsapp, actualizados, entregas, bitacora };
}

describe('ResumenEnvioService.programar', () => {
  it('fuera de la ventana: plantilla con nombre, fecha y el botón con el envío; el resumen queda ENVIADO', async () => {
    const a = armar();
    await expect(a.s.programar(AHORA)).resolves.toEqual({
      avisados: 1,
      excluidos: 0,
      sinContacto: 0,
      fallos: 0,
    });
    const llamada = a.plantillas.sendTemplate.mock.calls[0][0];
    expect(llamada).toMatchObject({
      organizationId: ORG,
      recipientId: '573001234567',
      kind: 'ATTENTION_SUMMARY_READY',
      bodyParams: ['Adulto', 'domingo, 1 de noviembre'],
    });
    expect(llamada.buttonPayloads).toEqual([`resumen:${a.entregas[0].id}`]);
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
    const [, destino, cuerpo, botones] = a.whatsapp.botones.mock.calls[0];
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

import { MassMessageOptOutService } from './mass-message-opt-out.service';
import { leerPlantillaDeMeta } from './mass-message-meta.service';
import {
  leerRevisionImagen,
  leerRevisionTexto,
  primerJson,
} from './mass-message-ai.service';

describe('MassMessageOptOutService («no más comunicados»)', () => {
  const construir = (fichas: Array<{ whatsappId: string | null }> = []) => {
    const prisma = {
      patientProfile: { findMany: jest.fn(async () => fichas) },
      massMessageOptOut: { upsert: jest.fn(), deleteMany: jest.fn() },
    };
    return { service: new MassMessageOptOutService(prisma as any), prisma };
  };

  it('registra la baja del número que escribe y contesta', async () => {
    const { service, prisma } = construir();
    const r = await service.manejarTexto(
      'org',
      '573001234567',
      'No más comunicados',
    );
    expect(r?.intencion).toBe('BAJA');
    expect(r?.respuesta).toContain('activar comunicados');
    expect(prisma.massMessageOptOut.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          organizationId: 'org',
          destination: '+573001234567',
          source: 'CHAT',
        },
      }),
    );
  });

  it('con un BSUID guarda también el teléfono de sus fichas', async () => {
    const { service, prisma } = construir([
      { whatsappId: '573001234567' },
      { whatsappId: null },
    ]);
    await service.manejarTexto('org', 'CO.1349120865', 'stop');
    const destinos = prisma.massMessageOptOut.upsert.mock.calls.map(
      (c: any[]) => c[0].create.destination,
    );
    expect(destinos).toEqual(['CO.1349120865', '+573001234567']);
  });

  it('el alta borra la baja', async () => {
    const { service, prisma } = construir();
    const r = await service.manejarTexto(
      'org',
      '573001234567',
      'activar comunicados',
    );
    expect(r?.intencion).toBe('ALTA');
    expect(prisma.massMessageOptOut.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org', destination: { in: ['+573001234567'] } },
    });
  });

  it('lo demás, Telegram y los recordatorios no son de esto', async () => {
    const { service, prisma } = construir();
    expect(
      await service.manejarTexto('org', '573001234567', 'quiero una cita'),
    ).toBeNull();
    expect(
      await service.manejarTexto(
        'org',
        '573001234567',
        'no quiero más recordatorios',
      ),
    ).toBeNull();
    expect(
      await service.manejarTexto('org', 'tg:12345', 'no más comunicados'),
    ).toBeNull();
    expect(prisma.massMessageOptOut.upsert).not.toHaveBeenCalled();
  });
});

describe('leerPlantillaDeMeta', () => {
  const aprobada = (componentes: any[], status = 'APPROVED') => ({
    name: 'x',
    language: 'es',
    status,
    category: 'MARKETING',
    components: componentes,
  });
  const CUERPO = {
    type: 'BODY',
    text: 'Hola {{1}}, {{2}} Responda NO MÁS COMUNICADOS.',
  };

  it('una plantilla de comunicado con imagen bien hecha no tiene problemas', () => {
    const r = leerPlantillaDeMeta(
      aprobada([
        { type: 'HEADER', format: 'IMAGE' },
        CUERPO,
        { type: 'FOOTER', text: 'Clínica' },
      ]),
      'MASS_MESSAGE_IMAGE',
    );
    expect(r).toMatchObject({
      estadoMeta: 'APPROVED',
      encabezado: 'IMAGE',
      cuerpo: CUERPO.text,
      pie: 'Clínica',
      problemas: [],
    });
  });

  it('sin aprobar, con otro encabezado o con otras variables, lo dice', () => {
    expect(
      leerPlantillaDeMeta(aprobada([CUERPO], 'PENDING'), 'MASS_MESSAGE_TEXT')
        .problemas[0],
    ).toContain('revisando');
    expect(
      leerPlantillaDeMeta(aprobada([CUERPO]), 'MASS_MESSAGE_IMAGE')
        .problemas[0],
    ).toContain('no tiene encabezado');
    expect(
      leerPlantillaDeMeta(
        aprobada([{ type: 'HEADER', format: 'IMAGE' }, CUERPO]),
        'MASS_MESSAGE_TEXT',
      ).problemas[0],
    ).toContain('IMAGE');
    expect(
      leerPlantillaDeMeta(
        aprobada([{ type: 'BODY', text: 'Hola {{1}}' }]),
        'MASS_MESSAGE_TEXT',
      ).problemas[0],
    ).toContain('1 variable');
  });
});

describe('lectura de las respuestas de la IA', () => {
  it('primerJson tolera el bloque ```json y el texto alrededor', () => {
    expect(primerJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(primerJson('Claro: {"a":2} listo')).toEqual({ a: 2 });
    expect(primerJson('nada')).toBeNull();
  });

  it('revisión del texto: solo se puede aplicar lo que está tal cual en el mensaje', () => {
    const original = 'La jornada sera el sabado.';
    const r = leerRevisionTexto(
      {
        puntaje: 140,
        resumen: 'Faltan tildes.',
        problemas: [
          {
            tipo: 'ortografia',
            gravedad: 'media',
            fragmento: 'sera',
            sugerencia: 'será',
            explicacion: 'Lleva tilde.',
          },
          {
            tipo: 'ortografia',
            fragmento: 'inventado',
            sugerencia: 'otro',
            explicacion: 'x',
          },
        ],
        textoSugerido: 'La jornada será\nel sábado.',
      },
      original,
      'gemini-2.5-flash',
    );
    expect(r.puntaje).toBe(100);
    expect(r.problemas.map((p) => p.aplicable)).toEqual([true, false]);
    expect(r.textoSugerido).toBe('La jornada será el sábado.');
  });

  it('un texto sugerido igual al original o demasiado largo no se ofrece', () => {
    expect(
      leerRevisionTexto({ textoSugerido: 'Igual.' }, 'Igual.', 'm')
        .textoSugerido,
    ).toBeNull();
    expect(
      leerRevisionTexto({ textoSugerido: 'x'.repeat(900) }, 'Corto.', 'm')
        .textoSugerido,
    ).toBeNull();
  });

  it('revisión de la imagen: valores fuera de lo esperado caen a lo seguro', () => {
    const r = leerRevisionImagen(
      {
        puntaje: 'abc',
        legibilidad: 'EXCELENTE',
        datosPersonales: 'sí',
        recomendaciones: ['a', 2, 'b'],
      },
      'm',
    );
    expect(r).toMatchObject({
      puntaje: 50,
      legibilidad: 'regular',
      datosPersonales: false,
      recomendaciones: ['a', 'b'],
    });
  });
});

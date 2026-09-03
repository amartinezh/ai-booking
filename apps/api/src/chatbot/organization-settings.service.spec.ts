import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationSettingsService } from './organization-settings.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ajustes por clínica que el chatbot lee en CADA turno: cómo se llama el bot,
 * cuántos reintentos concede antes de rendirse, y si trata de usted o de tú.
 *
 * Todo tiene default: una clínica recién creada no tiene fila de ajustes y el
 * bot igual tiene que poder atender. Un `null` que se cuele hasta el mensaje
 * es un "Hola, soy null" en el WhatsApp del paciente.
 */
describe('OrganizationSettingsService', () => {
  let service: OrganizationSettingsService;
  let prisma: {
    organizationSettings: { findUnique: jest.Mock; upsert: jest.Mock };
  };

  const ORG = 'org-1';

  beforeEach(async () => {
    prisma = {
      organizationSettings: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({})),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationSettingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(OrganizationSettingsService);
  });

  describe('getBotName', () => {
    it('devuelve el configurado', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        botName: 'Geni',
      });
      await expect(service.getBotName(ORG)).resolves.toBe('Geni');
    });

    it.each([
      ['sin fila', null],
      ['nombre nulo', { botName: null }],
      ['nombre vacío', { botName: '' }],
    ])('%s cae a AgenIA, nunca a null', async (_e, fila) => {
      prisma.organizationSettings.findUnique.mockResolvedValue(fila);
      await expect(service.getBotName(ORG)).resolves.toBe('AgenIA');
    });
  });

  describe('getMaxRetries', () => {
    it('devuelve el configurado', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        maxRetriesPerStep: 5,
      });
      await expect(service.getMaxRetries(ORG)).resolves.toBe(5);
    });

    it.each([
      ['sin fila', null],
      ['nulo', { maxRetriesPerStep: null }],
      ['cero', { maxRetriesPerStep: 0 }],
      ['negativo', { maxRetriesPerStep: -1 }],
      ['no numérico', { maxRetriesPerStep: 'tres' }],
    ])(
      '%s cae a 3: cero reintentos dejaría al paciente atascado',
      async (_e, fila) => {
        prisma.organizationSettings.findUnique.mockResolvedValue(fila);
        await expect(service.getMaxRetries(ORG)).resolves.toBe(3);
      },
    );
  });

  describe('getCommunicationStyle', () => {
    it.each(['FORMAL', 'INFORMAL'])('respeta %s', async (estilo) => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        communicationStyle: estilo,
      });
      await expect(service.getCommunicationStyle(ORG)).resolves.toBe(estilo);
    });

    it.each([
      ['sin fila', null],
      ['nulo', { communicationStyle: null }],
    ])(
      '%s cae a FORMAL (el trato de usted es el seguro por defecto)',
      async (_e, fila) => {
        prisma.organizationSettings.findUnique.mockResolvedValue(fila);
        await expect(service.getCommunicationStyle(ORG)).resolves.toBe(
          'FORMAL',
        );
      },
    );
  });

  describe('getSettings — los tres de una sola consulta', () => {
    it('sin fila devuelve los tres defaults', async () => {
      await expect(service.getSettings(ORG)).resolves.toEqual({
        botName: 'AgenIA',
        maxRetriesPerStep: 3,
        communicationStyle: 'FORMAL',
      });
    });

    it('con fila completa devuelve lo configurado', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        botName: 'Geni',
        maxRetriesPerStep: 5,
        communicationStyle: 'INFORMAL',
      });

      await expect(service.getSettings(ORG)).resolves.toEqual({
        botName: 'Geni',
        maxRetriesPerStep: 5,
        communicationStyle: 'INFORMAL',
      });
    });

    it('una fila a medias completa solo lo que falta', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue({
        botName: 'Geni',
        maxRetriesPerStep: 0,
        communicationStyle: null,
      });

      await expect(service.getSettings(ORG)).resolves.toEqual({
        botName: 'Geni',
        maxRetriesPerStep: 3,
        communicationStyle: 'FORMAL',
      });
    });

    it('es UNA consulta, no tres: se llama en cada turno del chatbot', async () => {
      await service.getSettings(ORG);
      expect(prisma.organizationSettings.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertSettings', () => {
    it('crea o actualiza con la llave de la organización', async () => {
      await service.upsertSettings(ORG, { botName: 'Geni' });

      expect(prisma.organizationSettings.upsert).toHaveBeenCalledWith({
        where: { organizationId: ORG },
        create: { organizationId: ORG, botName: 'Geni' },
        update: { botName: 'Geni' },
      });
    });

    it('un patch vacío no rompe nada', async () => {
      await expect(service.upsertSettings(ORG, {})).resolves.toBeUndefined();
    });
  });

  it('🏢 todas las lecturas van acotadas a la organización', async () => {
    await service.getBotName(ORG);
    await service.getMaxRetries(ORG);
    await service.getCommunicationStyle(ORG);
    await service.getSettings(ORG);

    for (const llamada of prisma.organizationSettings.findUnique.mock.calls) {
      expect(llamada[0].where).toEqual({ organizationId: ORG });
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('KnowledgeBaseService', () => {
  let service: KnowledgeBaseService;
  let prisma: { organization: { findUnique: jest.Mock; update: jest.Mock } };

  const ORG = 'org-1';

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeBaseService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(KnowledgeBaseService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  describe('hasContent — decide si el bot puede contestar preguntas libres', () => {
    it('con texto → true', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        knowledgeBase: 'Atendemos de 7 a 5.',
      });
      await expect(service.hasContent(ORG)).resolves.toBe(true);
    });

    it.each([
      ['sin organización', null],
      ['sin base', { knowledgeBase: null }],
      ['vacía', { knowledgeBase: '' }],
      ['solo espacios', { knowledgeBase: '   \n\t ' }],
    ])('%s → false (el bot NO improvisa respuestas)', async (_e, fila) => {
      prisma.organization.findUnique.mockResolvedValue(fila);
      await expect(service.hasContent(ORG)).resolves.toBe(false);
    });
  });

  describe('getContent', () => {
    it('devuelve el texto recortado', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        knowledgeBase: '  Atendemos de 7 a 5.  ',
      });
      await expect(service.getContent(ORG)).resolves.toBe(
        'Atendemos de 7 a 5.',
      );
    });

    it('sin contenido devuelve cadena vacía, nunca null', async () => {
      await expect(service.getContent(ORG)).resolves.toBe('');
    });
  });

  describe('updateContent', () => {
    it('guarda el texto recortado', async () => {
      await service.updateContent(ORG, '  nuevo contenido  ');
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: ORG },
        data: { knowledgeBase: 'nuevo contenido' },
      });
    });

    it('vaciar la base la deja en null, no en cadena vacía', async () => {
      await service.updateContent(ORG, '   ');
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: ORG },
        data: { knowledgeBase: null },
      });
    });
  });
});

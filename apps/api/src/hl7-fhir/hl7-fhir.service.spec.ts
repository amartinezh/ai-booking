import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Hl7FhirService } from './hl7-fhir.service';
import { ClinicalAiService } from '../clinical-ai/clinical-ai.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LlmFactoryService,
  NoActiveLlmProviderError,
} from '../llm/llm-factory.service';

/**
 * Interoperabilidad: el paquete que sale de AgenIA hacia otro sistema de
 * salud. Dos cosas se defienden aquí:
 *
 *  1. 🏢 El paciente se busca ACOTADO al tenant del actor, aunque el guard ya
 *     lo haya validado. Defensa en profundidad: el servicio no puede depender
 *     de que quien lo llame haya hecho su parte.
 *  2. Solo salen historias FIRMADAS. Un borrador es un texto sin valor legal
 *     y no debe viajar a otra institución.
 */
describe('Hl7FhirService', () => {
  let service: Hl7FhirService;
  let findFirst: jest.Mock;

  const ORG = 'org-1';

  const paciente = (over: Record<string, unknown> = {}) => ({
    id: 'pac-1',
    cedula: '1088123456',
    fullName: 'ANA PEREZ',
    gender: 'F',
    dateOfBirth: new Date('1990-04-12T00:00:00Z'),
    eps: { name: 'NUEVA EPS' },
    clinicalRecords: [],
    ...over,
  });

  const historia = (over: Record<string, unknown> = {}) => ({
    id: 'rec-1',
    appointmentId: 'apt-1',
    createdAt: new Date('2026-05-10T14:00:00Z'),
    updatedAt: new Date('2026-05-10T15:00:00Z'),
    chiefComplaint: 'cefalea',
    currentIllness: 'tres días de evolución',
    evolutionNotes: 'mejora con analgésico',
    doctor: { fullName: 'Dra. Ruiz' },
    vitalSigns: null,
    diagnoses: [],
    ...over,
  });

  beforeEach(async () => {
    findFirst = jest.fn(async () => paciente());
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Hl7FhirService,
        {
          provide: PrismaService,
          useValue: { extended: { patientProfile: { findFirst } } },
        },
      ],
    }).compile();
    service = module.get(Hl7FhirService);
  });

  it('un paciente que no existe (o no es del tenant) → 404', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.getPatientSummaryBundle('pac-1', ORG)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('🏢 con tenant, la búsqueda va acotada a esa organización', async () => {
    await service.getPatientSummaryBundle('pac-1', ORG);

    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 'pac-1',
      organizationId: ORG,
    });
  });

  it('sin tenant (SUPER_ADMIN) la búsqueda es de plataforma', async () => {
    await service.getPatientSummaryBundle('pac-1', null);
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'pac-1' });
  });

  it('📜 SOLO viajan las historias FIRMADAS: un borrador no tiene valor legal', async () => {
    await service.getPatientSummaryBundle('pac-1', ORG);

    expect(findFirst.mock.calls[0][0].include.clinicalRecords.where).toEqual({
      status: 'SIGNED',
    });
  });

  it('usa el cliente EXTENDIDO: si no, las notas viajarían cifradas', async () => {
    // `prisma.extended` es el que lleva la extensión de descifrado.
    await service.getPatientSummaryBundle('pac-1', ORG);
    expect(findFirst).toHaveBeenCalled();
  });

  describe('el Bundle', () => {
    it('es un documento FHIR con marca de tiempo', async () => {
      const b = await service.getPatientSummaryBundle('pac-1', ORG);

      expect(b.resourceType).toBe('Bundle');
      expect(b.type).toBe('document');
      expect(new Date(b.timestamp).toISOString()).toBe(b.timestamp);
    });

    it('la primera entrada es el Patient, con su documento como identificador', async () => {
      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      const p = b.entry[0].resource;

      expect(p).toMatchObject({
        resourceType: 'Patient',
        id: 'pac-1',
        gender: 'f',
        birthDate: '1990-04-12',
      });
      expect(p.identifier[0].value).toBe('1088123456');
      expect(p.name[0].text).toBe('ANA PEREZ');
      expect(p.managingOrganization).toEqual({ display: 'NUEVA EPS' });
    });

    it('un paciente sin sexo registrado sale como «unknown», no como undefined', async () => {
      findFirst.mockResolvedValue(paciente({ gender: null }));
      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      expect(b.entry[0].resource.gender).toBe('unknown');
    });

    it('un paciente sin EPS no lleva organización responsable', async () => {
      findFirst.mockResolvedValue(paciente({ eps: null }));
      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      expect(b.entry[0].resource.managingOrganization).toBeUndefined();
    });

    it('sin historias firmadas, el bundle trae solo al paciente', async () => {
      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      expect(b.entry).toHaveLength(1);
    });

    it('cada historia aporta un Encounter y una Composition enlazados', async () => {
      findFirst.mockResolvedValue(paciente({ clinicalRecords: [historia()] }));

      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      const [, encounter, composition] = b.entry.map(
        (e: { resource: any }) => e.resource,
      );

      expect(encounter).toMatchObject({
        resourceType: 'Encounter',
        id: 'apt-1',
        status: 'finished',
        subject: { reference: 'Patient/pac-1' },
      });
      expect(composition).toMatchObject({
        resourceType: 'Composition',
        status: 'final',
        encounter: { reference: 'Encounter/apt-1' },
      });
      expect(composition.author[0].display).toBe('Dra. Ruiz');
    });

    it('las tres secciones clínicas viajan con su texto', async () => {
      findFirst.mockResolvedValue(paciente({ clinicalRecords: [historia()] }));

      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      const composition = b.entry[2].resource;

      expect(
        composition.section.map((s: { title: string }) => s.title),
      ).toEqual([
        'Motivo de Consulta',
        'Enfermedad Actual',
        'Notas de Evolución',
      ]);
      expect(composition.section[0].text.div).toContain('cefalea');
    });

    it('una historia sin médico asignado sale como «Physician»', async () => {
      findFirst.mockResolvedValue(
        paciente({ clinicalRecords: [historia({ doctor: null })] }),
      );

      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      expect(b.entry[2].resource.author[0].display).toBe('Physician');
    });

    it('la frecuencia cardiaca sale como Observation con código LOINC y unidad', async () => {
      findFirst.mockResolvedValue(
        paciente({
          clinicalRecords: [
            historia({ vitalSigns: { id: 'vs-1', heartRate: 78 } }),
          ],
        }),
      );

      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      const obs = b.entry[3].resource;

      expect(obs.resourceType).toBe('Observation');
      expect(obs.code.coding[0]).toMatchObject({ code: '8867-4' });
      expect(obs.valueQuantity).toEqual({
        value: 78,
        unit: 'beats/minute',
        system: 'http://unitsofmeasure.org',
      });
    });

    it('sin signos vitales (o sin pulso) no se inventa una Observation', async () => {
      findFirst.mockResolvedValue(
        paciente({
          clinicalRecords: [
            historia({ vitalSigns: { id: 'vs-1', heartRate: null } }),
          ],
        }),
      );

      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      expect(b.entry).toHaveLength(3); // Patient + Encounter + Composition
    });

    it('varias historias producen varios encuentros', async () => {
      findFirst.mockResolvedValue(
        paciente({
          clinicalRecords: [
            historia({ id: 'r1', appointmentId: 'a1' }),
            historia({ id: 'r2', appointmentId: 'a2' }),
          ],
        }),
      );

      const b = await service.getPatientSummaryBundle('pac-1', ORG);
      expect(b.entry).toHaveLength(5); // 1 paciente + 2×(encounter+composition)
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('ClinicalAiService — dictado del médico', () => {
  let service: ClinicalAiService;
  let llmFactory: { forOrg: jest.Mock };

  const ORG = 'org-1';
  const BORRADOR = { chiefComplaint: 'dolor torácico' };

  beforeEach(async () => {
    llmFactory = {
      forOrg: jest.fn(async () => ({
        name: 'GEMINI',
        generateClinicalRecord: jest.fn(async () => BORRADOR),
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClinicalAiService,
        { provide: LlmFactoryService, useValue: llmFactory },
      ],
    }).compile();
    service = module.get(ClinicalAiService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  it('devuelve el borrador del proveedor activo de esa clínica', async () => {
    await expect(service.transcribeDictation(ORG, 'AAA')).resolves.toEqual(
      BORRADOR,
    );
    expect(llmFactory.forOrg).toHaveBeenCalledWith(ORG);
  });

  it('el mimeType por defecto es webm (lo que graba el navegador)', async () => {
    const provider = await llmFactory.forOrg();
    llmFactory.forOrg.mockResolvedValue(provider);

    await service.transcribeDictation(ORG, 'AAA');

    expect(provider.generateClinicalRecord).toHaveBeenCalledWith({
      base64: 'AAA',
      mimeType: 'audio/webm',
    });
  });

  it('un mimeType explícito se respeta', async () => {
    const provider = await llmFactory.forOrg();
    llmFactory.forOrg.mockResolvedValue(provider);

    await service.transcribeDictation(ORG, 'AAA', 'audio/mp4');

    expect(provider.generateClinicalRecord).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'audio/mp4' }),
    );
  });

  it('sin proveedor de IA, el mensaje dice DÓNDE configurarlo', async () => {
    llmFactory.forOrg.mockRejectedValue(new NoActiveLlmProviderError(ORG));

    await expect(service.transcribeDictation(ORG, 'AAA')).rejects.toThrow(
      /Integración de IA/,
    );
  });

  it('un 503 del proveedor se traduce a «alta demanda, reintente»', async () => {
    llmFactory.forOrg.mockRejectedValue(
      Object.assign(new Error('overloaded'), { status: 503 }),
    );

    await expect(service.transcribeDictation(ORG, 'AAA')).rejects.toThrow(
      /alta demanda/,
    );
  });

  it('cualquier otro fallo conserva el mensaje original para poder diagnosticar', async () => {
    llmFactory.forOrg.mockRejectedValue(new Error('token inválido'));

    await expect(service.transcribeDictation(ORG, 'AAA')).rejects.toThrow(
      /token inválido/,
    );
  });

  it('un error sin mensaje no deja «undefined» en la pantalla del médico', async () => {
    llmFactory.forOrg.mockRejectedValue({});

    await expect(service.transcribeDictation(ORG, 'AAA')).rejects.toThrow(
      /Error desconocido/,
    );
  });
});

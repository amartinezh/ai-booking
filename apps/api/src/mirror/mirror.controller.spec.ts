import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MirrorController } from './mirror.controller';
import { MirrorDispatchService } from './mirror-dispatch.service';
import { MirrorReconciliationService } from './mirror-reconciliation.service';
import { MirrorApplyService } from './mirror-apply.service';
import { MirrorAvailabilityService } from './mirror-availability.service';
import { MirrorCatalogService } from './mirror-catalog.service';
import { MirrorAgentGuard } from './mirror-agent.guard';

// ══════════════════════════════════════════════════════════════════════════
// El controlador no tenía pruebas, y por ahí se coló un defecto que ninguna
// prueba unitaria podía ver: la validación de /mirror/ack no conocía
// `skippedSeqs`, así que un lote compuesto SOLO por eventos que el driver no
// espeja recibía un 400. El evento nunca se cerraba, el agente lo reintentaba
// cada cinco segundos y a los cinco fallos entraba en modo seguro y dejaba de
// escribir en el HIS. Lo encontró el agente corriendo de verdad en la VM
// simulada; los tests del motor tenían el cliente HTTP mockeado.
//
// La validación de un endpoint es lógica de negocio: aquí se prueba.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorController — validación de /mirror/ack', () => {
  let controller: MirrorController;
  let dispatch: { ack: jest.Mock };
  let availability: { apply: jest.Mock };
  let catalog: { upload: jest.Mock };

  const req = { mirrorConfig: { organizationId: 'org1' } } as never;
  const ack = (body: unknown) => controller.ack(req, body as never);

  beforeEach(async () => {
    dispatch = { ack: jest.fn(() => ({ acknowledged: 1 })) };
    availability = { apply: jest.fn(() => ({ mode: 'ON' })) };
    catalog = {
      upload: jest.fn(() => ({
        kind: 'DOCTOR',
        created: 0,
        updated: 0,
        vanished: 0,
        homologated: 0,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MirrorController],
      providers: [
        { provide: MirrorDispatchService, useValue: dispatch },
        { provide: MirrorReconciliationService, useValue: {} },
        { provide: MirrorApplyService, useValue: {} },
        { provide: MirrorAvailabilityService, useValue: availability },
        { provide: MirrorCatalogService, useValue: catalog },
        { provide: MirrorCatalogService, useValue: catalog },
      ],
    })
      // El guard tiene su propia batería de pruebas (mirror-agent.guard.spec).
      // Aquí solo se prueba la validación del cuerpo del ack.
      .overrideGuard(MirrorAgentGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MirrorController);
  });

  it('un lote solo de omitidos es válido: llega al servicio', async () => {
    await ack({ seqs: [], skippedSeqs: ['7'] });

    expect(dispatch.ack).toHaveBeenCalledWith('org1', {
      seqs: [],
      skippedSeqs: ['7'],
    });
  });

  it('un lote solo de fallidos sigue siendo válido', async () => {
    await ack({ seqs: [], failedSeqs: ['9'] });

    expect(dispatch.ack).toHaveBeenCalled();
  });

  it('un lote solo de exitosos sigue siendo válido', async () => {
    await ack({ seqs: ['3'] });

    expect(dispatch.ack).toHaveBeenCalled();
  });

  // El handler valida ANTES de devolver la promesa, así que estos lanzan de
  // forma síncrona: `rejects` no los vería.
  it('un ack sin nada que reportar se rechaza', () => {
    // No es pedantería: un ack vacío significa que el agente perdió la cuenta
    // de lo que hizo, y dejarlo pasar borraría el rastro de ese lote.
    expect(() => ack({ seqs: [] })).toThrow(BadRequestException);
    expect(dispatch.ack).not.toHaveBeenCalled();
  });

  it('skippedSeqs con un tipo que no es arreglo se rechaza', () => {
    expect(() => ack({ seqs: [], skippedSeqs: '7' })).toThrow(
      BadRequestException,
    );
  });

  it('failedSeqs con un tipo que no es arreglo se rechaza', () => {
    expect(() => ack({ seqs: [], failedSeqs: 'oops' })).toThrow(
      BadRequestException,
    );
  });

  it('sin seqs no hay ack posible', () => {
    expect(() => ack({ failedSeqs: ['1'] })).toThrow(BadRequestException);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// /mirror/availability borra, dentro de la ventana que declara, todo cupo que
// no venga en el envío. Una ventana mal formada no es un detalle: es la
// diferencia entre sincronizar un día y borrar la agenda de un médico.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorController — validación de /mirror/availability', () => {
  let controller: MirrorController;
  let availability: { apply: jest.Mock };

  const req = { mirrorConfig: { organizationId: 'org1' } } as never;
  const subir = (body: unknown) =>
    controller.availabilityUpload(req, body as never);
  const VENTANA = {
    fromIso: '2026-09-03T05:00:00.000Z',
    toIso: '2026-09-04T05:00:00.000Z',
  };

  beforeEach(async () => {
    availability = { apply: jest.fn(() => ({ mode: 'ON' })) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MirrorController],
      providers: [
        { provide: MirrorDispatchService, useValue: {} },
        { provide: MirrorReconciliationService, useValue: {} },
        { provide: MirrorApplyService, useValue: {} },
        { provide: MirrorAvailabilityService, useValue: availability },
        { provide: MirrorCatalogService, useValue: {} },
      ],
    })
      .overrideGuard(MirrorAgentGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(MirrorController);
  });

  it('una ventana con cupos llega al servicio', async () => {
    await subir({ ...VENTANA, slots: [{ doctorExternalKey: '76' }] });

    expect(availability.apply).toHaveBeenCalledWith('org1', expect.anything());
  });

  it('una ventana VACÍA es válida: "ese día no hay turnos" es información', async () => {
    // Si no se aceptara, no habría forma de borrar los cupos de un día que el
    // hospital dejó sin agenda.
    await subir({ ...VENTANA, slots: [] });

    expect(availability.apply).toHaveBeenCalled();
  });

  it('sin `slots` se rechaza', () => {
    expect(() => subir({ ...VENTANA })).toThrow(BadRequestException);
  });

  it('una ventana invertida se rechaza', () => {
    // `from >= to` no acota nada y el servicio borraría con un criterio vacío.
    expect(() =>
      subir({ fromIso: VENTANA.toIso, toIso: VENTANA.fromIso, slots: [] }),
    ).toThrow(BadRequestException);
  });

  it('una fecha ilegible se rechaza', () => {
    expect(() =>
      subir({ fromIso: 'el jueves', toIso: VENTANA.toIso, slots: [] }),
    ).toThrow(BadRequestException);
  });

  it('sin ventana se rechaza: el borrado necesita límites', () => {
    expect(() => subir({ slots: [] })).toThrow(BadRequestException);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// /mirror/catalog — la vía por la que el catálogo del hospital llega a AgenIA.
//
// Existe porque `MirrorEntityMap` no tenía quien la escribiera, y sin esas
// equivalencias el chatbot deja de ofrecer citas a todo el mundo en silencio.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorController — validación de /mirror/catalog', () => {
  let controller: MirrorController;
  let catalog: { upload: jest.Mock };

  const req = { mirrorConfig: { organizationId: 'org1' } } as never;
  const subir = (body: unknown) => controller.catalogUpload(req, body as never);

  beforeEach(async () => {
    catalog = {
      upload: jest.fn(() => ({
        kind: 'DOCTOR',
        created: 2,
        updated: 0,
        vanished: 0,
        homologated: 0,
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MirrorController],
      providers: [
        { provide: MirrorDispatchService, useValue: {} },
        { provide: MirrorReconciliationService, useValue: {} },
        { provide: MirrorApplyService, useValue: {} },
        { provide: MirrorAvailabilityService, useValue: {} },
        { provide: MirrorCatalogService, useValue: catalog },
      ],
    })
      .overrideGuard(MirrorAgentGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(MirrorController);
  });

  it('un catálogo de médicos válido llega al servicio', async () => {
    await subir({
      kind: 'DOCTOR',
      entries: [{ externalKey: '76', label: 'MEDICO ATENCION HTA' }],
    });

    expect(catalog.upload).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({ kind: 'DOCTOR' }),
    );
  });

  it('un catálogo VACÍO es válido: significa que el hospital no reporta nada', async () => {
    // Rechazarlo dejaría el catálogo del día anterior como si siguiera vigente.
    await subir({ kind: 'SERVICE', entries: [] });

    expect(catalog.upload).toHaveBeenCalled();
  });

  it('un kind desconocido se rechaza en vez de guardarse como basura', () => {
    expect(() => subir({ kind: 'PACIENTE', entries: [] })).toThrow(
      BadRequestException,
    );
    expect(catalog.upload).not.toHaveBeenCalled();
  });

  it('sin entries se rechaza', () => {
    expect(() => subir({ kind: 'DOCTOR' })).toThrow(BadRequestException);
    expect(catalog.upload).not.toHaveBeenCalled();
  });
});

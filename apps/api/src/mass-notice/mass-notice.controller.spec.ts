import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MassNoticeController } from './mass-notice.controller';
import { MassNoticeService } from './mass-notice.service';
import { MirrorNoticeService } from '../mirror/mirror-notice.service';

/**
 * `organizationId` SIEMPRE sale de `@CurrentTenant()` (el JWT), nunca del
 * cuerpo — un ORG_ADMIN o BOOKING_AGENT no puede pedirle al agente la lista
 * de otra clínica escribiendo su id en la petición.
 */
describe('MassNoticeController', () => {
  let controller: MassNoticeController;
  let massNotice: { sendBatch: jest.Mock };
  let mirrorNotice: {
    createRequest: jest.Mock;
    getRequestStatus: jest.Mock;
  };

  beforeEach(async () => {
    massNotice = {
      sendBatch: jest.fn(async () => ({ status: 'ENVIADO', sent: 1 })),
    };
    mirrorNotice = {
      createRequest: jest.fn(async () => ({ requestId: 'req-1' })),
      getRequestStatus: jest.fn(async () => ({
        status: 'PENDIENTE',
        error: null,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MassNoticeController],
      providers: [
        { provide: MassNoticeService, useValue: massNotice },
        { provide: MirrorNoticeService, useValue: mirrorNotice },
      ],
    }).compile();

    controller = module.get(MassNoticeController);
  });

  describe('POST /mass-notice/:batchId/send', () => {
    it('rechaza sin organización', async () => {
      await expect(
        controller.send(undefined as never, 'batch-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(massNotice.sendBatch).not.toHaveBeenCalled();
    });

    it('llega al servicio con la org del tenant y el id del lote', async () => {
      await controller.send('org-1', 'batch-1');
      expect(massNotice.sendBatch).toHaveBeenCalledWith('batch-1', 'org-1');
    });
  });

  describe('POST /mass-notice/:batchId/notice-request', () => {
    const BODY = {
      doctorExternalKey: '76',
      fromIso: '2026-09-24T00:00:00.000Z',
      toIso: '2026-09-25T00:00:00.000Z',
    };

    it('rechaza sin organización', async () => {
      await expect(
        controller.createNoticeRequest(undefined as never, 'batch-1', BODY),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si falta doctorExternalKey, fromIso o toIso', async () => {
      await expect(
        controller.createNoticeRequest('org-1', 'batch-1', {
          ...BODY,
          doctorExternalKey: undefined,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.createNoticeRequest('org-1', 'batch-1', {
          ...BODY,
          fromIso: undefined,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.createNoticeRequest('org-1', 'batch-1', {
          ...BODY,
          toIso: undefined,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mirrorNotice.createRequest).not.toHaveBeenCalled();
    });

    it('crea la petición con la org del tenant', async () => {
      const result = await controller.createNoticeRequest(
        'org-1',
        'batch-1',
        BODY,
      );

      expect(result).toEqual({ requestId: 'req-1' });
      expect(mirrorNotice.createRequest).toHaveBeenCalledWith('org-1', {
        batchId: 'batch-1',
        doctorExternalKey: '76',
        fromIso: BODY.fromIso,
        toIso: BODY.toIso,
      });
    });
  });

  describe('GET /mass-notice/notice-request/:requestId', () => {
    it('rechaza sin organización', async () => {
      await expect(
        controller.getNoticeRequestStatus(undefined as never, 'req-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 si el servicio no encuentra la petición', async () => {
      mirrorNotice.getRequestStatus.mockResolvedValue(null);
      await expect(
        controller.getNoticeRequestStatus('org-1', 'req-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('devuelve el estado con la org del tenant', async () => {
      const result = await controller.getNoticeRequestStatus('org-1', 'req-1');

      expect(result).toEqual({ status: 'PENDIENTE', error: null });
      expect(mirrorNotice.getRequestStatus).toHaveBeenCalledWith(
        'org-1',
        'req-1',
      );
    });
  });
});

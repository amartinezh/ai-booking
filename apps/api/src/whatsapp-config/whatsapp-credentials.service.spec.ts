import { Test, TestingModule } from '@nestjs/testing';
import { WhatsappCredentialsService } from './whatsapp-credentials.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * El enrutamiento multi-tenant del webhook entero cuelga de aquí: qué clínica
 * es dueña del `phone_number_id` con el que Meta llama, y con qué token se le
 * responde al paciente.
 *
 * La regla que nunca puede relajarse: ante CUALQUIER duda (fila incompleta,
 * token que no descifra) se devuelve `null`. Un token a medias mandaría el
 * mensaje de un paciente por la línea equivocada.
 */
describe('WhatsappCredentialsService', () => {
  let service: WhatsappCredentialsService;
  let prisma: { whatsappAccountConfig: { findUnique: jest.Mock } };
  let crypto: { decrypt: jest.Mock };

  const fila = (over: Record<string, unknown> = {}) => ({
    organizationId: 'org-1',
    phoneNumberId: '123456',
    encryptedAccessToken: 'cifrado',
    encryptedAppSecret: 'cifrado-secret',
    verifyToken: 'vt',
    isActive: true,
    ...over,
  });

  beforeEach(async () => {
    prisma = { whatsappAccountConfig: { findUnique: jest.fn() } };
    crypto = { decrypt: jest.fn((s: string) => `claro:${s}`) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappCredentialsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();

    service = module.get(WhatsappCredentialsService);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('forOrg', () => {
    it('devuelve las credenciales con el token ya descifrado', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());

      await expect(service.forOrg('org-1')).resolves.toEqual({
        organizationId: 'org-1',
        phoneNumberId: '123456',
        accessToken: 'claro:cifrado',
        isActive: true,
      });
      expect(prisma.whatsappAccountConfig.findUnique).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
      });
    });

    it('una clínica sin configuración devuelve null', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(null);
      await expect(service.forOrg('org-x')).resolves.toBeNull();
    });

    it('la línea desactivada SÍ se devuelve, con su bandera: la decisión es del caller', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(
        fila({ isActive: false }),
      );
      const r = await service.forOrg('org-1');
      expect(r?.isActive).toBe(false);
    });
  });

  describe('materialize — fallar cerrado', () => {
    it.each([
      ['sin phoneNumberId', { phoneNumberId: null }],
      ['sin token cifrado', { encryptedAccessToken: null }],
    ])('%s → null, nunca credenciales a medias', async (_e, over) => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila(over));
      await expect(service.forOrg('org-1')).resolves.toBeNull();
    });

    it('un token que descifra a cadena vacía tampoco sirve', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());
      crypto.decrypt.mockReturnValue('');
      await expect(service.forOrg('org-1')).resolves.toBeNull();
    });

    it('si el descifrado revienta se registra y se devuelve null (no propaga)', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());
      crypto.decrypt.mockImplementation(() => {
        throw new Error('bad auth tag');
      });

      await expect(service.forOrg('org-1')).resolves.toBeNull();
      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('org-1'),
      );
    });
  });

  describe('forPhoneNumberId — la ruta caliente del webhook', () => {
    it('resuelve el tenant dueño de ese número', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());

      const r = await service.forPhoneNumberId('123456');

      expect(r?.organizationId).toBe('org-1');
      expect(prisma.whatsappAccountConfig.findUnique).toHaveBeenCalledWith({
        where: { phoneNumberId: '123456' },
      });
    });

    it('un phone_number_id vacío ni siquiera consulta la base', async () => {
      await expect(service.forPhoneNumberId('')).resolves.toBeNull();
      expect(prisma.whatsappAccountConfig.findUnique).not.toHaveBeenCalled();
    });

    it('un número que ninguna clínica reclama devuelve null', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(null);
      await expect(service.forPhoneNumberId('999')).resolves.toBeNull();
    });
  });

  describe('appSecretByPhoneNumberId — verificación de la firma de Meta', () => {
    it('devuelve el secreto en claro', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        encryptedAppSecret: 'cifrado-secret',
      });

      await expect(service.appSecretByPhoneNumberId('123456')).resolves.toBe(
        'claro:cifrado-secret',
      );
      expect(prisma.whatsappAccountConfig.findUnique).toHaveBeenCalledWith({
        where: { phoneNumberId: '123456' },
        select: { organizationId: true, encryptedAppSecret: true },
      });
    });

    it('vacío → null sin tocar la base', async () => {
      await expect(service.appSecretByPhoneNumberId('')).resolves.toBeNull();
      expect(prisma.whatsappAccountConfig.findUnique).not.toHaveBeenCalled();
    });

    it('clínica sin app secret configurado → null (la firma cae al env)', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        encryptedAppSecret: null,
      });
      await expect(
        service.appSecretByPhoneNumberId('123456'),
      ).resolves.toBeNull();
    });

    it('fila inexistente → null', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(null);
      await expect(
        service.appSecretByPhoneNumberId('123456'),
      ).resolves.toBeNull();
    });

    it('un secreto que no descifra se registra y devuelve null, nunca una firma inventada', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        encryptedAppSecret: 'roto',
      });
      crypto.decrypt.mockImplementation(() => {
        throw new Error('bad auth tag');
      });

      await expect(
        service.appSecretByPhoneNumberId('123456'),
      ).resolves.toBeNull();
      expect(service['logger'].error).toHaveBeenCalled();
    });

    it('un secreto que descifra a vacío se trata como ausente', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        encryptedAppSecret: 'x',
      });
      crypto.decrypt.mockReturnValue('');
      await expect(
        service.appSecretByPhoneNumberId('123456'),
      ).resolves.toBeNull();
    });
  });

  describe('organizationIdByVerifyToken — el GET de verificación', () => {
    it('devuelve la clínica que reclama ese verify_token', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue({
        organizationId: 'org-1',
      });

      await expect(service.organizationIdByVerifyToken('vt')).resolves.toBe(
        'org-1',
      );
      expect(prisma.whatsappAccountConfig.findUnique).toHaveBeenCalledWith({
        where: { verifyToken: 'vt' },
        select: { organizationId: true },
      });
    });

    it('token vacío → null sin consultar', async () => {
      await expect(service.organizationIdByVerifyToken('')).resolves.toBeNull();
      expect(prisma.whatsappAccountConfig.findUnique).not.toHaveBeenCalled();
    });

    it('token desconocido → null (el webhook se rechaza)', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(null);
      await expect(
        service.organizationIdByVerifyToken('inventado'),
      ).resolves.toBeNull();
    });
  });
});

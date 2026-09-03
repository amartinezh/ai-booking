import { Test, TestingModule } from '@nestjs/testing';
import { AudioConfigService } from './audio-config.service';
import { TtsFactoryService } from './tts/tts-factory.service';
import { GoogleTtsService } from './tts/google-tts.service';
import { ElevenLabsTtsService } from './tts/elevenlabs-tts.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SystemLogService } from '../system-log/system-log.service';
import {
  ALLOWED_VOICE_IDS,
  DEFAULT_ACTIVE_PROVIDER,
  DEFAULT_AUDIO_ENCODING,
  DEFAULT_GENDER,
  DEFAULT_PITCH,
  DEFAULT_SPEAKING_RATE,
  DEFAULT_VOICE_ID,
  PITCH_MAX,
  PITCH_MIN,
  RATE_MAX,
  RATE_MIN,
} from './dto/audio-config.types';

/**
 * La voz del bot. Casi la mitad de los pacientes del piloto contestan por
 * audio, así que esto está en el camino crítico de una cita — pero con una
 * regla distinta a la del resto: **nada de aquí puede tumbar la conversación**.
 * Si la configuración está corrupta, se cae a valores por defecto; si el
 * proveedor de pago falla, se cae a Google; si Google falla, el bot manda
 * texto. Nunca una excepción hacia el paciente.
 */
describe('AudioConfigService', () => {
  let service: AudioConfigService;
  let prisma: {
    organizationAudioConfig: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };
  let google: { generate: jest.Mock };
  let elevenLabs: { generate: jest.Mock };

  const ORG = 'org-1';
  const OTRA_VOZ = [...ALLOWED_VOICE_IDS].find((v) => v !== DEFAULT_VOICE_ID)!;

  const fila = (over: Record<string, unknown> = {}) => ({
    activeProvider: 'GOOGLE',
    gender: 'FEMENINO',
    audioEncoding: 'OGG_OPUS',
    googlePitch: 0,
    googleSpeakingRate: 1,
    googleVoiceId: DEFAULT_VOICE_ID,
    elevenLabsApiKey: null,
    elevenLabsVoiceId: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      organizationAudioConfig: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({})),
      },
    };
    crypto = {
      encrypt: jest.fn((s: string) => `cif:${s}`),
      decrypt: jest.fn((s: string) => s.replace(/^cif:/, '')),
    };
    google = {
      generate: jest.fn(async () => ({
        ok: true,
        audio: Buffer.from('audio'),
        rtt_ms: 120,
        bytes: 5,
      })),
    };
    elevenLabs = {
      generate: jest.fn(async () => ({
        ok: true,
        audio: Buffer.from('11'),
        rtt_ms: 300,
        bytes: 2,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
        { provide: GoogleTtsService, useValue: google },
        { provide: ElevenLabsTtsService, useValue: elevenLabs },
      ],
    }).compile();

    service = module.get(AudioConfigService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  // ────────────────────────────────────────────────────────────────
  describe('getEffective — nunca devuelve algo que rompa al proveedor', () => {
    it('sin fila de configuración, todo cae a los valores por defecto', async () => {
      const cfg = await service.getEffective(ORG);

      expect(cfg).toMatchObject({
        activeProvider: DEFAULT_ACTIVE_PROVIDER,
        gender: DEFAULT_GENDER,
        audioEncoding: DEFAULT_AUDIO_ENCODING,
      });
      expect(cfg.google).toMatchObject({
        voiceId: DEFAULT_VOICE_ID,
        pitch: DEFAULT_PITCH,
        speakingRate: DEFAULT_SPEAKING_RATE,
      });
    });

    it('🛡️ si la consulta REVIENTA, se usan defaults en vez de tumbar el turno', async () => {
      prisma.organizationAudioConfig.findUnique.mockRejectedValue(
        new Error('BD caída'),
      );

      const cfg = await service.getEffective(ORG);

      expect(cfg.activeProvider).toBe(DEFAULT_ACTIVE_PROVIDER);
      expect(service['logger'].warn).toHaveBeenCalled();
    });

    it('la fila se lee acotada a la organización', async () => {
      await service.getEffective(ORG);
      expect(prisma.organizationAudioConfig.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG } }),
      );
    });

    it.each([
      [
        'proveedor',
        { activeProvider: 'AZURE' },
        'activeProvider',
        DEFAULT_ACTIVE_PROVIDER,
      ],
      ['género', { gender: 'OTRO' }, 'gender', DEFAULT_GENDER],
      [
        'códec',
        { audioEncoding: 'FLAC' },
        'audioEncoding',
        DEFAULT_AUDIO_ENCODING,
      ],
    ])(
      'un %s corrupto en la base cae al default',
      async (_e, over, campo, esperado) => {
        prisma.organizationAudioConfig.findUnique.mockResolvedValue(fila(over));

        const cfg = await service.getEffective(ORG);
        expect(cfg[campo as 'gender']).toBe(esperado);
      },
    );

    it('una voz de Google que no está en el catálogo cae a la de por defecto', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(
        fila({ googleVoiceId: 'es-XX-Inventada' }),
      );

      const cfg = await service.getEffective(ORG);
      expect(cfg.google.voiceId).toBe(DEFAULT_VOICE_ID);
    });

    it('una voz válida del catálogo sí se respeta', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(
        fila({ googleVoiceId: OTRA_VOZ }),
      );

      await expect(service.getEffective(ORG)).resolves.toMatchObject({
        google: expect.objectContaining({ voiceId: OTRA_VOZ }),
      });
    });

    it('el tono y la velocidad se acotan al rango permitido', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(
        fila({ googlePitch: 999, googleSpeakingRate: -999 }),
      );

      const cfg = await service.getEffective(ORG);
      expect(cfg.google.pitch).toBe(PITCH_MAX);
      expect(cfg.google.speakingRate).toBe(RATE_MIN);
    });

    it('un valor que no es número cae al mínimo, no a NaN', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(
        fila({ googlePitch: 'alto' }),
      );

      const cfg = await service.getEffective(ORG);
      expect(cfg.google.pitch).toBe(PITCH_MIN);
      expect(Number.isNaN(cfg.google.pitch)).toBe(false);
    });

    it('la API key de ElevenLabs se descifra solo para uso interno', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(
        fila({ elevenLabsApiKey: 'cif:sk-11labs', elevenLabsVoiceId: 'v1' }),
      );

      const cfg = await service.getEffective(ORG);
      expect(cfg.elevenLabs).toEqual({ apiKey: 'sk-11labs', voiceId: 'v1' });
    });

    it('si la key no descifra se registra y queda en null (no revienta)', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(
        fila({ elevenLabsApiKey: 'rota' }),
      );
      crypto.decrypt.mockImplementation(() => {
        throw new Error('bad auth tag');
      });

      const cfg = await service.getEffective(ORG);
      expect(cfg.elevenLabs.apiKey).toBeNull();
      expect(service['logger'].error).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('getPublic — lo que ve el panel', () => {
    it('sin fila devuelve defaults, el catálogo y los límites', async () => {
      const p = await service.getPublic(ORG);

      expect(p.activeProvider).toBe(DEFAULT_ACTIVE_PROVIDER);
      expect(p.allowedVoices.length).toBeGreaterThan(0);
      expect(p.limits).toEqual({
        pitchMin: PITCH_MIN,
        pitchMax: PITCH_MAX,
        rateMin: RATE_MIN,
        rateMax: RATE_MAX,
      });
      expect(p.updatedAt).toBeNull();
    });

    it('🔒 NUNCA expone la API key de ElevenLabs, solo si existe', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(
        fila({ elevenLabsApiKey: 'cif:sk-secreta', elevenLabsVoiceId: 'v1' }),
      );

      const p = await service.getPublic(ORG);

      expect(p.hasElevenLabsApiKey).toBe(true);
      expect(JSON.stringify(p)).not.toContain('sk-secreta');
      expect(JSON.stringify(p)).not.toContain('cif:');
    });

    it('la fecha de actualización viaja en ISO', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(fila());
      await expect(service.getPublic(ORG)).resolves.toMatchObject({
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('upsert — valida ANTES de tocar la base', () => {
    const guardado = () =>
      prisma.organizationAudioConfig.upsert.mock.calls[0][0];

    it('un patch parcial solo escribe los campos enviados', async () => {
      await service.upsert(ORG, { gender: 'MASCULINO' } as never);

      expect(guardado().update).toEqual({ gender: 'MASCULINO' });
      expect(guardado().where).toEqual({ organizationId: ORG });
      expect(guardado().create).toEqual({
        organizationId: ORG,
        gender: 'MASCULINO',
      });
    });

    it('un patch vacío no cambia nada pero devuelve el estado actual', async () => {
      await expect(service.upsert(ORG, {} as never)).resolves.toBeDefined();
      expect(guardado().update).toEqual({});
    });

    it.each([
      ['proveedor', { activeProvider: 'AZURE' }, /Proveedor inválido/],
      ['género', { gender: 'OTRO' }, /Género inválido/],
      ['códec', { audioEncoding: 'FLAC' }, /Códec inválido/],
      ['voz de Google', { googleVoiceId: 'es-XX-Inventada' }, /no permitida/],
      ['tono fuera de rango', { googlePitch: 99 }, /fuera de rango/],
      [
        'velocidad fuera de rango',
        { googleSpeakingRate: 99 },
        /fuera de rango/,
      ],
      ['tono NaN', { googlePitch: Number.NaN }, /fuera de rango/],
    ])('%s inválido se rechaza sin escribir', async (_e, input, patron) => {
      await expect(service.upsert(ORG, input as never)).rejects.toThrow(patron);
      expect(prisma.organizationAudioConfig.upsert).not.toHaveBeenCalled();
    });

    it('el códec inválido dice cuáles sí valen', async () => {
      await expect(
        service.upsert(ORG, { audioEncoding: 'FLAC' } as never),
      ).rejects.toThrow(/OGG_OPUS/);
    });

    it('los extremos del rango SÍ se aceptan', async () => {
      await service.upsert(ORG, {
        googlePitch: PITCH_MIN,
        googleSpeakingRate: RATE_MAX,
      } as never);

      expect(guardado().update).toEqual({
        googlePitch: PITCH_MIN,
        googleSpeakingRate: RATE_MAX,
      });
    });

    it('🔒 la API key de ElevenLabs se guarda CIFRADA', async () => {
      await service.upsert(ORG, { elevenLabsApiKey: '  sk-11labs  ' } as never);

      expect(crypto.encrypt).toHaveBeenCalledWith('sk-11labs');
      expect(guardado().update.elevenLabsApiKey).toBe('cif:sk-11labs');
    });

    it.each([
      ['omitida', undefined],
      ['vacía', ''],
      ['solo espacios', '   '],
    ])('una key %s NO borra la que ya estaba', async (_e, valor) => {
      await service.upsert(ORG, { elevenLabsApiKey: valor } as never);
      expect(guardado().update.elevenLabsApiKey).toBeUndefined();
      expect(crypto.encrypt).not.toHaveBeenCalled();
    });

    it('el voiceId de ElevenLabs se limpia con cadena vacía', async () => {
      await service.upsert(ORG, { elevenLabsVoiceId: '  ' } as never);
      expect(guardado().update.elevenLabsVoiceId).toBeNull();

      prisma.organizationAudioConfig.upsert.mockClear();
      await service.upsert(ORG, { elevenLabsVoiceId: ' v9 ' } as never);
      expect(guardado().update.elevenLabsVoiceId).toBe('v9');
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('diagnose — el botón «Validar Servicio Alive»', () => {
    it('con Google activo sintetiza un audio mínimo y reporta el RTT', async () => {
      const r = await service.diagnose(ORG);

      expect(google.generate).toHaveBeenCalledWith('ok', expect.anything());
      expect(r).toMatchObject({
        success: true,
        status: 'alive',
        provider: 'GOOGLE',
        rtt_ms: 120,
        audio_bytes: 5,
      });
    });

    it('un fallo de Google se reporta con su código, no como éxito', async () => {
      google.generate.mockResolvedValue({
        ok: false,
        code: 'AUTH',
        message: 'credenciales inválidas',
        rtt_ms: 50,
      });

      await expect(service.diagnose(ORG)).resolves.toMatchObject({
        success: false,
        provider: 'GOOGLE',
        error_code: 'AUTH',
      });
    });

    it('con ElevenLabs activo y bien configurado, prueba ElevenLabs', async () => {
      prisma.organizationAudioConfig.findUnique.mockResolvedValue(
        fila({
          activeProvider: 'ELEVENLABS',
          elevenLabsApiKey: 'cif:sk',
          elevenLabsVoiceId: 'v1',
        }),
      );

      const r = await service.diagnose(ORG);

      expect(elevenLabs.generate).toHaveBeenCalledWith('ok', {
        apiKey: 'sk',
        voiceId: 'v1',
      });
      expect(r).toMatchObject({ provider: 'ELEVENLABS', success: true });
      expect(google.generate).not.toHaveBeenCalled();
    });

    it.each([
      ['sin key', { elevenLabsApiKey: null, elevenLabsVoiceId: 'v1' }],
      ['sin voz', { elevenLabsApiKey: 'cif:sk', elevenLabsVoiceId: null }],
    ])(
      'ElevenLabs activo pero %s → NOT_CONFIGURED, sin llamar a nadie',
      async (_e, over) => {
        prisma.organizationAudioConfig.findUnique.mockResolvedValue(
          fila({ activeProvider: 'ELEVENLABS', ...over }),
        );

        await expect(service.diagnose(ORG)).resolves.toMatchObject({
          success: false,
          error_code: 'NOT_CONFIGURED',
        });
        expect(elevenLabs.generate).not.toHaveBeenCalled();
      },
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('TtsFactoryService — el Plan B', () => {
  let factory: TtsFactoryService;
  let audioConfig: { getEffective: jest.Mock };
  let google: { generate: jest.Mock };
  let elevenLabs: { generate: jest.Mock };
  let systemLog: { error: jest.Mock; warning: jest.Mock };

  const ORG = 'org-1';
  const cfg = (over: Record<string, unknown> = {}) => ({
    activeProvider: 'GOOGLE',
    google: { voiceId: 'es-US-Neural2-A' },
    elevenLabs: { apiKey: null, voiceId: null },
    ...over,
  });

  beforeEach(async () => {
    audioConfig = { getEffective: jest.fn(async () => cfg()) };
    google = {
      generate: jest.fn(async () => ({ ok: true, audio: Buffer.from('g') })),
    };
    elevenLabs = {
      generate: jest.fn(async () => ({ ok: true, audio: Buffer.from('e') })),
    };
    systemLog = {
      error: jest.fn(async () => {}),
      warning: jest.fn(async () => {}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TtsFactoryService,
        { provide: AudioConfigService, useValue: audioConfig },
        { provide: GoogleTtsService, useValue: google },
        { provide: ElevenLabsTtsService, useValue: elevenLabs },
        { provide: SystemLogService, useValue: systemLog },
      ],
    }).compile();

    factory = module.get(TtsFactoryService);
    jest.spyOn(factory['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(factory['logger'], 'error').mockImplementation(() => undefined);
  });

  it('con Google activo, usa Google y devuelve el audio', async () => {
    await expect(factory.synthesize(ORG, 'hola')).resolves.toEqual(
      Buffer.from('g'),
    );
    expect(elevenLabs.generate).not.toHaveBeenCalled();
  });

  it('si Google falla, devuelve null: el bot manda solo texto, no revienta', async () => {
    google.generate.mockResolvedValue({
      ok: false,
      code: 'AUTH',
      message: 'x',
    });

    await expect(factory.synthesize(ORG, 'hola')).resolves.toBeNull();
  });

  it('la configuración se resuelve por organización, no del .env', async () => {
    await factory.synthesize(ORG, 'hola');
    expect(audioConfig.getEffective).toHaveBeenCalledWith(ORG);
  });

  describe('ElevenLabs activo', () => {
    const conElevenLabs = (over: Record<string, unknown> = {}) =>
      audioConfig.getEffective.mockResolvedValue(
        cfg({
          activeProvider: 'ELEVENLABS',
          elevenLabs: { apiKey: 'sk', voiceId: 'v1', ...over },
        }),
      );

    it('funcionando, se usa ElevenLabs y Google ni se toca', async () => {
      conElevenLabs();
      await expect(factory.synthesize(ORG, 'hola')).resolves.toEqual(
        Buffer.from('e'),
      );
      expect(google.generate).not.toHaveBeenCalled();
    });

    it('🔁 si falla, cae a Google SIN que el paciente lo note', async () => {
      conElevenLabs();
      elevenLabs.generate.mockResolvedValue({
        ok: false,
        code: 'QUOTA',
        message: 'sin cuota',
        rtt_ms: 200,
      });

      await expect(factory.synthesize(ORG, 'hola')).resolves.toEqual(
        Buffer.from('g'),
      );
    });

    it('el fallback queda registrado con el código técnico real', async () => {
      conElevenLabs();
      elevenLabs.generate.mockResolvedValue({
        ok: false,
        code: 'QUOTA',
        message: 'sin cuota',
        rtt_ms: 200,
      });

      await factory.synthesize(ORG, 'hola');

      expect(systemLog.error).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TTS_ELEVENLABS_QUOTA',
          organizationId: ORG,
        }),
      );
      expect(systemLog.warning).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TTS_ELEVENLABS_FALLBACK_GOOGLE' }),
      );
    });

    it.each([
      ['sin key', { apiKey: null }],
      ['sin voz', { voiceId: null }],
    ])(
      '%s: ni se intenta, se avisa y se va directo a Google',
      async (_e, over) => {
        conElevenLabs(over);

        await expect(factory.synthesize(ORG, 'hola')).resolves.toEqual(
          Buffer.from('g'),
        );
        expect(elevenLabs.generate).not.toHaveBeenCalled();
        expect(systemLog.warning).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'TTS_ELEVENLABS_NOT_CONFIGURED' }),
        );
      },
    );

    it('si TAMBIÉN falla Google, devuelve null en vez de propagar', async () => {
      conElevenLabs();
      elevenLabs.generate.mockResolvedValue({
        ok: false,
        code: 'QUOTA',
        message: 'x',
        rtt_ms: 1,
      });
      google.generate.mockResolvedValue({
        ok: false,
        code: 'AUTH',
        message: 'y',
      });

      await expect(factory.synthesize(ORG, 'hola')).resolves.toBeNull();
    });

    it('el fallback usa la config de Google de LA MISMA clínica', async () => {
      audioConfig.getEffective.mockResolvedValue(
        cfg({
          activeProvider: 'ELEVENLABS',
          elevenLabs: { apiKey: 'sk', voiceId: 'v1' },
          google: { voiceId: 'voz-de-esta-clinica' },
        }),
      );
      elevenLabs.generate.mockResolvedValue({
        ok: false,
        code: 'X',
        message: 'x',
        rtt_ms: 1,
      });

      await factory.synthesize(ORG, 'hola');

      expect(google.generate).toHaveBeenCalledWith('hola', {
        voiceId: 'voz-de-esta-clinica',
      });
    });
  });
});

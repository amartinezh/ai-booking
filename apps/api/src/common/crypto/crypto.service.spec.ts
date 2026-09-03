import { CryptoService } from './crypto.service';
import { encryptString, decryptString } from './prisma-encryption.extension';

/**
 * Cifrado en reposo. Dos consumidores en el camino de las citas dependen de
 * esto y fallan en silencio si se rompe:
 *
 *  - `driverConfig` del espejo (credenciales contra el SQL Server del
 *    hospital): si no descifra, el agente no puede escribir una sola cita.
 *  - Las notas clínicas del `ClinicalRecord`, que son datos de salud.
 *
 * Y una compatibilidad que hay que conservar: en la base conviven filas
 * cifradas y filas en texto plano de antes del cambio. Descifrar una plana
 * debe devolverla tal cual, NO reventar.
 */
describe('CryptoService', () => {
  const KEY_ORIGINAL = process.env.ENCRYPTION_KEY;

  const conLlave = (valor?: string) => {
    if (valor === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = valor;
    const s = new CryptoService();
    jest.spyOn(s['logger'], 'warn').mockImplementation(() => undefined);
    s.onModuleInit();
    return s;
  };

  afterEach(() => {
    if (KEY_ORIGINAL === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = KEY_ORIGINAL;
  });

  describe('derivación de la llave', () => {
    it('acepta 32 bytes en utf-8', () => {
      const s = conLlave('abcdefghijklmnopqrstuvwxyz123456');
      expect(s.decrypt(s.encrypt('hola'))).toBe('hola');
    });

    it('acepta 64 caracteres hex', () => {
      const s = conLlave('a'.repeat(64));
      expect(s.decrypt(s.encrypt('hola'))).toBe('hola');
    });

    it('sin ENCRYPTION_KEY avisa y cae a la llave de desarrollo (no revienta el arranque)', () => {
      delete process.env.ENCRYPTION_KEY;
      const s = new CryptoService();
      const warn = jest
        .spyOn(s['logger'], 'warn')
        .mockImplementation(() => undefined);
      s.onModuleInit();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('desarrollo'));
      expect(s.decrypt(s.encrypt('hola'))).toBe('hola');
    });

    it('una llave de largo equivocado falla RÁPIDO, al arrancar y no al cifrar', () => {
      process.env.ENCRYPTION_KEY = 'demasiado-corta';
      const s = new CryptoService();
      jest.spyOn(s['logger'], 'warn').mockImplementation(() => undefined);
      expect(() => s.onModuleInit()).toThrow(/32 bytes/);
    });
  });

  describe('ida y vuelta', () => {
    let s: CryptoService;
    beforeEach(() => {
      s = conLlave('abcdefghijklmnopqrstuvwxyz123456');
    });

    it.each([
      ['texto simple', 'Server=192.168.1.16;User=agenia_sync'],
      ['tildes y ñ', 'contraseña con acentuación'],
      ['emoji', '🔐 clave 🔑'],
      ['cadena vacía', ''],
      ['json', JSON.stringify({ host: '1.2.3.4', pass: 'x' })],
    ])('%s sobrevive el viaje', (_e, texto) => {
      expect(s.decrypt(s.encrypt(texto))).toBe(texto);
    });

    it('el formato es iv:authTag:ciphertext, todo hex', () => {
      const c = s.encrypt('hola');
      const partes = c.split(':');
      expect(partes).toHaveLength(3);
      expect(partes[0]).toMatch(/^[0-9a-f]{32}$/); // IV de 16 bytes
      expect(partes[1]).toMatch(/^[0-9a-f]{32}$/); // authTag de 16 bytes
      expect(partes[2]).toMatch(/^[0-9a-f]*$/);
    });

    it('dos cifrados del mismo texto NO son iguales: el IV es aleatorio', () => {
      expect(s.encrypt('misma cosa')).not.toBe(s.encrypt('misma cosa'));
    });

    it('el texto cifrado no contiene el original', () => {
      expect(s.encrypt('contraseña-secreta')).not.toContain('contraseña');
    });
  });

  describe('compatibilidad y manipulación', () => {
    let s: CryptoService;
    beforeEach(() => {
      s = conLlave('abcdefghijklmnopqrstuvwxyz123456');
    });

    it('un valor en texto plano heredado se devuelve tal cual', () => {
      expect(s.decrypt('config-vieja-sin-cifrar')).toBe(
        'config-vieja-sin-cifrar',
      );
    });

    it('cadena vacía o nula al descifrar no revienta', () => {
      expect(s.decrypt('')).toBe('');
      expect(s.decrypt(null as unknown as string)).toBeNull();
    });

    it('encrypt(null) devuelve null sin intentar cifrarlo', () => {
      expect(s.encrypt(null as unknown as string)).toBeNull();
    });

    it('🔒 un ciphertext manipulado NO se descifra en silencio: el authTag lo detecta', () => {
      const c = s.encrypt('saldo: 100');
      const [iv, tag, data] = c.split(':');
      const alterado = `${iv}:${tag}:${data.slice(0, -2)}ff`;
      expect(() => s.decrypt(alterado)).toThrow();
    });

    it('🔒 otra llave no puede leer lo cifrado con la primera', () => {
      const c = s.encrypt('secreto');
      const otra = conLlave('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
      expect(() => otra.decrypt(c)).toThrow();
    });
  });

  describe('helpers de JSON — así viaja el driverConfig del espejo', () => {
    it('un objeto sobrevive el viaje completo', () => {
      const s = conLlave('abcdefghijklmnopqrstuvwxyz123456');
      const cfg = {
        server: '192.168.1.16',
        database: 'PRUEBAS',
        user: 'agenia_sync',
        password: 'p4ss',
        anidado: { a: [1, 2, 3] },
      };
      expect(s.decryptJson(s.encryptJson(cfg))).toEqual(cfg);
    });

    it('el cifrado del JSON no deja la contraseña visible', () => {
      const s = conLlave('abcdefghijklmnopqrstuvwxyz123456');
      expect(s.encryptJson({ password: 'p4ssw0rd' })).not.toContain('p4ssw0rd');
    });
  });
});

describe('prisma-encryption.extension — mismo formato, otro consumidor', () => {
  const KEY_ORIGINAL = process.env.ENCRYPTION_KEY;
  afterEach(() => {
    if (KEY_ORIGINAL === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = KEY_ORIGINAL;
  });

  it('ida y vuelta de una nota clínica', () => {
    process.env.ENCRYPTION_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
    const nota = 'Paciente refiere dolor torácico de 2 días.';
    expect(decryptString(encryptString(nota))).toBe(nota);
  });

  it('la llave se lee PEREZOSAMENTE: cambiarla entre llamadas se respeta', () => {
    process.env.ENCRYPTION_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
    const c = encryptString('x');
    process.env.ENCRYPTION_KEY = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    // Con otra llave no se puede descifrar; el extension NO propaga el error
    // (una historia clínica ilegible no debe tumbar el dashboard entero).
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(decryptString(c)).toBe(c);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('las comillas envolventes del .env se recortan (causa clásica de "Invalid key length")', () => {
    process.env.ENCRYPTION_KEY = '"abcdefghijklmnopqrstuvwxyz123456"';
    expect(() => encryptString('x')).not.toThrow();

    process.env.ENCRYPTION_KEY = '  abcdefghijklmnopqrstuvwxyz123456  ';
    expect(() => encryptString('x')).not.toThrow();
  });

  it('una llave de largo inválido falla con un mensaje que dice qué pasa', () => {
    process.env.ENCRYPTION_KEY = 'corta';
    expect(() => encryptString('x')).toThrow(/32 bytes/);
  });

  it('sin llave usa la de desarrollo en vez de tumbar el proceso', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(decryptString(encryptString('x'))).toBe('x');
  });

  it('vacío entra y sale igual, sin pasar por el cifrado', () => {
    process.env.ENCRYPTION_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
    expect(encryptString('')).toBe('');
    expect(decryptString('')).toBe('');
  });

  it('texto plano heredado (sin las tres partes) se devuelve tal cual', () => {
    process.env.ENCRYPTION_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
    expect(decryptString('nota vieja sin cifrar')).toBe(
      'nota vieja sin cifrar',
    );
    expect(decryptString('a:b')).toBe('a:b');
  });

  it('el formato es intercambiable con CryptoService', () => {
    process.env.ENCRYPTION_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
    const s = new CryptoService();
    jest.spyOn(s['logger'], 'warn').mockImplementation(() => undefined);
    s.onModuleInit();

    expect(s.decrypt(encryptString('mismo formato'))).toBe('mismo formato');
    expect(decryptString(s.encrypt('mismo formato'))).toBe('mismo formato');
  });
});

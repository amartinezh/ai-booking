// `Prisma.defineExtension` envuelve la definición y la vuelve inaccesible
// desde fuera. Aquí se sustituye por la identidad para poder ejercitar los
// hooks (`query` y `result`) directamente: son lógica propia del proyecto, no
// de Prisma, y sin esto quedarían sin una sola prueba.
jest.mock('@agenia/database', () => ({
  Prisma: { defineExtension: (definicion: unknown) => definicion },
}));

import {
  encryptionExtension,
  encryptString,
  decryptString,
} from './prisma-encryption.extension';

/**
 * Cifrado en reposo de la historia clínica. La extensión de Prisma es el único
 * sitio donde ocurre: si un `if` de aquí se cae, el motivo de consulta de un
 * paciente se escribe EN CLARO en la base y nadie se entera — la escritura
 * funciona igual de bien.
 *
 * Se prueban los cuatro campos protegidos en los dos sentidos (escritura y
 * lectura) y la compatibilidad con las filas anteriores al cifrado.
 */
const CAMPOS = [
  'chiefComplaint',
  'currentIllness',
  'physicalExam',
  'evolutionNotes',
] as const;

type Hooks = {
  query: {
    clinicalRecord: {
      create: (a: { args: any; query: (x: any) => unknown }) => unknown;
      update: (a: { args: any; query: (x: any) => unknown }) => unknown;
    };
  };
  result: {
    clinicalRecord: Record<
      string,
      { needs: Record<string, boolean>; compute: (r: any) => unknown }
    >;
  };
};

const ext = encryptionExtension as unknown as Hooks;

describe('encryptionExtension', () => {
  const KEY_ORIGINAL = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
  });
  afterEach(() => {
    if (KEY_ORIGINAL === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = KEY_ORIGINAL;
  });

  const esCifrado = (v: unknown) =>
    typeof v === 'string' && /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/.test(v);

  describe('escritura — nada clínico llega en claro a la base', () => {
    it.each(CAMPOS)('create cifra %s', async (campo) => {
      const query = jest.fn((a) => a);
      const args = { data: { [campo]: 'texto clínico sensible' } };

      await ext.query.clinicalRecord.create({ args, query });

      expect(esCifrado(args.data[campo])).toBe(true);
      expect(args.data[campo]).not.toContain('sensible');
      expect(query).toHaveBeenCalledWith(args);
    });

    it.each(CAMPOS)('update cifra %s', async (campo) => {
      const query = jest.fn((a) => a);
      const args = { data: { [campo]: 'corrección clínica' } };

      await ext.query.clinicalRecord.update({ args, query });

      expect(esCifrado(args.data[campo])).toBe(true);
    });

    it('los cuatro campos de una misma historia se cifran a la vez', async () => {
      const args = {
        data: Object.fromEntries(CAMPOS.map((c) => [c, `valor de ${c}`])),
      };

      await ext.query.clinicalRecord.create({ args, query: (a) => a });

      for (const c of CAMPOS) expect(esCifrado(args.data[c])).toBe(true);
    });

    it('un campo NO clínico se deja intacto: no todo se cifra', async () => {
      const args = { data: { status: 'DRAFT', doctorId: 'doc-1' } };

      await ext.query.clinicalRecord.create({ args, query: (a) => a });

      expect(args.data).toEqual({ status: 'DRAFT', doctorId: 'doc-1' });
    });

    it('un campo ausente o vacío no se toca (no se guarda basura cifrada)', async () => {
      const args = { data: { chiefComplaint: '', currentIllness: null } };

      await ext.query.clinicalRecord.create({ args, query: (a) => a });

      expect(args.data.chiefComplaint).toBe('');
      expect(args.data.currentIllness).toBeNull();
    });

    it('la consulta original SIEMPRE se ejecuta, con los args ya cifrados', async () => {
      const query = jest.fn(async () => ({ id: 'rec-1' }));
      const args = { data: { chiefComplaint: 'dolor' } };

      await expect(
        ext.query.clinicalRecord.create({ args, query }),
      ).resolves.toEqual({ id: 'rec-1' });
      const enviado = (query.mock.calls[0] as unknown as unknown[])[0] as {
        data: { chiefComplaint: string };
      };
      expect(esCifrado(enviado.data.chiefComplaint)).toBe(true);
    });
  });

  describe('lectura — vuelve en claro para quien tiene permiso', () => {
    it.each(CAMPOS)('%s se descifra al leer', (campo) => {
      const cifrado = encryptString('texto clínico sensible');

      const valor = ext.result.clinicalRecord[campo].compute({
        [campo]: cifrado,
      });

      expect(valor).toBe('texto clínico sensible');
    });

    it.each(CAMPOS)('%s declara qué columna necesita', (campo) => {
      expect(ext.result.clinicalRecord[campo].needs).toEqual({ [campo]: true });
    });

    it('los campos opcionales vacíos vuelven como null, no como cadena', () => {
      // physicalExam y evolutionNotes son opcionales en el modelo.
      for (const campo of ['physicalExam', 'evolutionNotes']) {
        expect(
          ext.result.clinicalRecord[campo].compute({ [campo]: null }),
        ).toBeNull();
      }
    });

    it('una fila ANTERIOR al cifrado se lee tal cual (retrocompatibilidad)', () => {
      expect(
        ext.result.clinicalRecord.chiefComplaint.compute({
          chiefComplaint: 'nota vieja sin cifrar',
        }),
      ).toBe('nota vieja sin cifrar');
    });

    it('una fila que no descifra no tumba la lectura del expediente', () => {
      const spy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const cifradoConOtraLlave = encryptString('x');
      process.env.ENCRYPTION_KEY = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

      const valor = ext.result.clinicalRecord.chiefComplaint.compute({
        chiefComplaint: cifradoConOtraLlave,
      });

      expect(valor).toBe(cifradoConOtraLlave); // devuelve el crudo, no lanza
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it('ida y vuelta completa: lo que se escribe es lo que se lee', async () => {
    const original = 'Paciente refiere cefalea de 3 días, EVA 7/10.';
    const args = { data: { chiefComplaint: original } };

    await ext.query.clinicalRecord.create({ args, query: (a) => a });
    const leido = ext.result.clinicalRecord.chiefComplaint.compute({
      chiefComplaint: args.data.chiefComplaint,
    });

    expect(leido).toBe(original);
    expect(decryptString(args.data.chiefComplaint)).toBe(original);
  });

  it('la extensión se llama «encryption»', () => {
    expect((encryptionExtension as unknown as { name: string }).name).toBe(
      'encryption',
    );
  });
});

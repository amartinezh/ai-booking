import {
  documentoParaLaListaRural,
  esPacienteRural,
  sabadoRuralDeLaClinica,
  sabadoSoloRuralLoImpide,
} from './sabado-rural';

const SABADO = new Date('2026-11-21T14:00:00Z'); // 9:00 a. m. en Bogotá
const LUNES = new Date('2026-11-23T14:00:00Z');

function db(opts: {
  regla: number | null;
  lista?: number | null;
  rurales?: string[];
}) {
  return {
    organizationSettings: {
      findUnique: jest.fn(async () => ({
        saturdayRuralSharePercent: opts.regla,
      })),
    },
    organization: {
      findUnique: jest.fn(async () => ({ timezone: 'America/Bogota' })),
    },
    hospitalMirrorConfig: {
      findUnique: jest.fn(async () => ({
        ruralListCount: opts.lista === undefined ? 100 : opts.lista,
      })),
    },
    ruralPatient: {
      findUnique: jest.fn(
        async (q: {
          where: { organizationId_document: { document: string } };
        }) =>
          (opts.rurales ?? []).includes(
            q.where.organizationId_document.document,
          )
            ? { id: 'r' }
            : null,
      ),
    },
  } as never;
}

describe('sábados solo para la zona rural — lo que la API lee', () => {
  it('el documento de la lista: solo dígitos y sin ceros a la izquierda; lo que no es un documento, nada', () => {
    expect(documentoParaLaListaRural('75.036.620')).toBe('75036620');
    expect(documentoParaLaListaRural('0012345678')).toBe('12345678');
    expect(documentoParaLaListaRural('0000')).toBeNull();
    expect(documentoParaLaListaRural('12')).toBeNull();
    expect(documentoParaLaListaRural(null)).toBeNull();
  });

  it('sin la regla, nada (sin leer la lista)', async () => {
    const d = db({ regla: null });
    expect(await sabadoRuralDeLaClinica(d, 'org')).toBeNull();
    expect(await sabadoSoloRuralLoImpide(d, 'org', SABADO, '123456')).toBe(
      false,
    );
  });

  it('con la regla: abierta solo si ya llegó la lista', async () => {
    expect(await sabadoRuralDeLaClinica(db({ regla: 50 }), 'org')).toEqual({
      porcentaje: 50,
      abierto: true,
      timeZone: 'America/Bogota',
    });
    expect(
      (await sabadoRuralDeLaClinica(db({ regla: 50, lista: 0 }), 'org'))
        ?.abierto,
    ).toBe(false);
  });

  it('un documento es rural si está en la lista, con o sin ceros a la izquierda', async () => {
    const d = db({ regla: 50, rurales: ['12345678'] });
    expect(await esPacienteRural(d, 'org', '0012345678')).toBe(true);
    expect(await esPacienteRural(d, 'org', '12345678')).toBe(true);
    expect(await esPacienteRural(d, 'org', '87654321')).toBe(false);
    expect(await esPacienteRural(d, 'org', '')).toBe(false);
  });

  it('el sábado: solo a quien está en la lista; entre semana, a cualquiera', async () => {
    const d = db({ regla: 50, rurales: ['12345678'] });
    expect(await sabadoSoloRuralLoImpide(d, 'org', SABADO, '12345678')).toBe(
      false,
    );
    expect(await sabadoSoloRuralLoImpide(d, 'org', SABADO, '87654321')).toBe(
      true,
    );
    expect(await sabadoSoloRuralLoImpide(d, 'org', SABADO, null)).toBe(true);
    expect(await sabadoSoloRuralLoImpide(d, 'org', LUNES, '87654321')).toBe(
      false,
    );
  });

  it('sin la lista, el sábado a nadie', async () => {
    const d = db({ regla: 50, lista: null, rurales: ['12345678'] });
    expect(await sabadoSoloRuralLoImpide(d, 'org', SABADO, '12345678')).toBe(
      true,
    );
  });

  it('el documento solo se busca si hace falta', async () => {
    const d = db({ regla: 50, rurales: ['12345678'] });
    const obtener = jest.fn(async () => '12345678');
    expect(await sabadoSoloRuralLoImpide(d, 'org', LUNES, obtener)).toBe(false);
    expect(obtener).not.toHaveBeenCalled();
    expect(await sabadoSoloRuralLoImpide(d, 'org', SABADO, obtener)).toBe(
      false,
    );
    expect(obtener).toHaveBeenCalledTimes(1);
  });
});

import { CntSanVicenteAnsermaDriver } from './index';
import type { AnsermaMapping } from './mapping';

// 🌾 La lectura de la zona rural: solo documentos, solo de la zona R, sin vacíos.
function conDriver(recordset: unknown[]) {
  const consultas: string[] = [];
  const req: any = {
    input() {
      return req;
    },
    async query(texto: string) {
      consultas.push(texto);
      return { recordset };
    },
  };
  const driver = new CntSanVicenteAnsermaDriver();
  driver.useConnection({ request: () => req } as never, {} as AnsermaMapping);
  return { driver, consultas };
}

describe('fetchRuralPatientDocuments', () => {
  it('trae solo el documento de los pacientes con zona de residencia rural', async () => {
    const { driver, consultas } = conDriver([
      { documento: '1088123456' },
      { documento: ' 0012345678 ' },
      { documento: null },
      { documento: '' },
    ]);
    expect(await driver.fetchRuralPatientDocuments()).toEqual([
      '1088123456',
      '0012345678',
    ]);
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toMatch(/FROM dbo\.PACIENTES/);
    expect(consultas[0]).toMatch(/CD_CODI_ZORE_PAC\)\)\) = 'R'/);
    // Ni nombre, ni teléfono, ni dirección, ni barrio.
    expect(consultas[0]).not.toMatch(
      /NO_NOMB_PAC|DE_TELE_PAC|DE_DIRE_PAC|CD_CODI_BAR_PAC/,
    );
    // Solo lectura.
    expect(consultas[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
  });

  it('sin conexión, falla en vez de mandar una lista vacía', async () => {
    const driver = new CntSanVicenteAnsermaDriver();
    await expect(driver.fetchRuralPatientDocuments()).rejects.toThrow(
      /no está conectado/,
    );
  });
});

import { CntSanVicenteAnsermaDriver } from './index';

// ══════════════════════════════════════════════════════════════════════════
// `healthCheck` es lo que el latido lleva cada 60 s hasta el servidor, y de su
// respuesta sale el aviso más importante del panel: "el agente está vivo pero
// NO alcanza su HIS. Ninguna cita se está espejando."
//
// Ese es el fallo traicionero del sistema: el proceso corre, `systemctl status`
// dice `active (running)`, el latido llega puntual, y no se espeja nada. Si
// este método devolviera `ok: true` de más, o reventara en vez de responder, el
// panel se quedaría en verde mientras las citas se acumulan en la cola.
//
// No tenía ni una prueba.
// ══════════════════════════════════════════════════════════════════════════

/** Un pool cuyo `SELECT 1` hace lo que le digamos. */
function conPool(alConsultar: () => unknown) {
  const req: any = {
    input: () => req,
    query: () => Promise.resolve(alConsultar()),
  };
  const driver = new CntSanVicenteAnsermaDriver();
  driver.useConnection({ request: () => req } as never, {} as never);
  return driver;
}

describe('healthCheck', () => {
  it('sin conexión responde ok:false, no revienta', async () => {
    // Es el estado del arranque, antes del handshake. Lanzar aquí dejaría al
    // agente sin latir, y un agente que no late se ve igual que uno muerto —
    // cuando en realidad está vivo y lo que falta es la configuración.
    const driver = new CntSanVicenteAnsermaDriver();

    await expect(driver.healthCheck()).resolves.toEqual({
      ok: false,
      detail: 'No conectado.',
    });
  });

  it('con el HIS respondiendo, ok:true', async () => {
    const driver = conPool(() => ({ recordset: [{ ok: 1 }] }));

    await expect(driver.healthCheck()).resolves.toEqual({ ok: true });
  });

  it('si el HIS rechaza la consulta, devuelve el motivo', async () => {
    // El `detail` acaba en `HospitalMirrorConfig.lastHisDetail` y es lo único
    // que ve quien mira el panel: tiene que decir qué pasó, no "false".
    const driver = conPool(() => {
      throw new Error('Failed to connect to 192.168.1.16:1433');
    });

    await expect(driver.healthCheck()).resolves.toEqual({
      ok: false,
      detail: 'Failed to connect to 192.168.1.16:1433',
    });
  });

  it('si lo que se lanza NO es un Error, igual se reporta con su texto', async () => {
    // `mssql` y `tedious` no siempre lanzan `Error`. Leer `.message` de una
    // cadena da `undefined`, y el panel mostraría un fallo sin ninguna causa
    // — el peor sitio para perder el motivo.
    const driver = conPool(() => {
      throw 'ECONNRESET';
    });

    await expect(driver.healthCheck()).resolves.toEqual({
      ok: false,
      detail: 'ECONNRESET',
    });
  });
});

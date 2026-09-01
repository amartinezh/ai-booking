import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileAgentStateStore } from './file-agent-state-store';

// ══════════════════════════════════════════════════════════════════════════
// Estas pruebas existen por un fallo reproducido en la VM simulada: se paró
// el servicio del agente, el hospital agendó una cita por ventanilla, se
// volvió a arrancar — y ese cupo siguió libre en AgenIA para siempre.
//
// El cursor de `detectChanges` no es una marca de tiempo, es una FOTO del HIS.
// Arrancar sin ella significa tomar una nueva que YA incluye lo ocurrido
// durante la caída, así que el cambio no se reporta nunca. Un reinicio para
// parches bastaba para vender dos veces la misma hora del mismo médico.
// ══════════════════════════════════════════════════════════════════════════
describe('FileAgentStateStore', () => {
  let dir: string;
  let archivo: string;
  let avisos: string[];

  const crear = () => new FileAgentStateStore(archivo, (m) => avisos.push(m));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-estado-'));
    archivo = path.join(dir, 'sub', 'state.json');
    avisos = [];
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('la foto del HIS sobrevive a un reinicio', async () => {
    const foto = { '76|2026/09/03 08:20': { e: 0, h: '1122334455' } };
    const antes = crear();
    await antes.cargar();
    await antes.setDriverCursor(foto);

    const despues = crear();
    await despues.cargar();

    expect(await despues.getDriverCursor()).toEqual(foto);
  });

  it('el cursor del outbox también', async () => {
    const antes = crear();
    await antes.cargar();
    await antes.setOutboxCursor('42');

    const despues = crear();
    await despues.cargar();

    expect(await despues.getOutboxCursor()).toBe('42');
  });

  it('un evento ya aplicado no se reintenta tras reiniciar', async () => {
    // Sin esto, un ack perdido hace que el servidor reenvíe el evento y el
    // agente lo aplique DOS veces contra el HIS.
    const antes = crear();
    await antes.cargar();
    await antes.markAppliedLocally('evt-1');

    const despues = crear();
    await despues.cargar();

    expect(await despues.hasAppliedLocally('evt-1')).toBe(true);
    expect(await despues.hasAppliedLocally('evt-2')).toBe(false);
  });

  it('la primera vez arranca vacío, sin quejarse', async () => {
    const s = crear();
    await s.cargar();

    expect(await s.getDriverCursor()).toBeNull();
    expect(await s.getOutboxCursor()).toBe('0');
    expect(avisos).toEqual([]);
  });

  it('crea el directorio si no existe', async () => {
    await crear().cargar();

    expect(fs.existsSync(archivo)).toBe(true);
  });

  it('comprueba que puede escribir AL ARRANCAR, no en el primer cambio', async () => {
    // Descubrir a los diez minutos que el disco es de solo lectura ya es
    // tarde: para entonces ya se perdió lo que había que guardar.
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.chmodSync(path.dirname(archivo), 0o500);

    await expect(crear().cargar()).rejects.toThrow();

    fs.chmodSync(path.dirname(archivo), 0o700);
  });

  it('un archivo corrupto no impide arrancar, pero avisa de lo que se pierde', async () => {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, '{esto no es json');

    const s = crear();
    await s.cargar();

    expect(await s.getDriverCursor()).toBeNull();
    expect(avisos[0]).toContain('NO se van a reportar');
  });

  it('escribe de forma atómica: nunca deja el archivo a medias', async () => {
    const s = crear();
    await s.cargar();
    await s.setDriverCursor({ a: 1 });

    expect(fs.existsSync(`${archivo}.tmp`)).toBe(false);
    expect(() => JSON.parse(fs.readFileSync(archivo, 'utf8'))).not.toThrow();
  });

  it('no reescribe cuando la foto no cambió', async () => {
    // `detectChanges` corre cada pocos segundos y casi siempre devuelve lo
    // mismo; reescribir megabytes por minuto castigaría el disco de la VM.
    const s = crear();
    await s.cargar();
    await s.setDriverCursor({ a: 1 });
    const primera = fs.statSync(archivo).mtimeMs;

    await new Promise((r) => setTimeout(r, 12));
    await s.setDriverCursor({ a: 1 });

    expect(fs.statSync(archivo).mtimeMs).toBe(primera);
  });

  it('el registro de eventos aplicados no crece sin fin', async () => {
    const s = crear();
    await s.cargar();
    for (let i = 0; i < 5_050; i++) await s.markAppliedLocally(`evt-${i}`);

    const guardados = JSON.parse(fs.readFileSync(archivo, 'utf8')).appliedEventIds;
    expect(guardados).toHaveLength(5_000);
    // Se olvidan los más viejos, se conservan los recientes: son los únicos
    // que el servidor puede reenviar.
    expect(await s.hasAppliedLocally('evt-0')).toBe(false);
    expect(await s.hasAppliedLocally('evt-5049')).toBe(true);
  });

  it('el estado se guarda con permisos restrictivos', async () => {
    // Lleva la foto de la agenda del hospital: documentos de pacientes y horas.
    const s = crear();
    await s.cargar();
    await s.setDriverCursor({ '76|x': { h: '1122334455' } });

    expect(fs.statSync(archivo).mode & 0o777).toBe(0o600);
  });
});

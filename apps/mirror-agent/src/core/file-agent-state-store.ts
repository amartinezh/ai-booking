import * as fs from 'fs';
import * as path from 'path';
import type { DriverCursor } from './driver.interface';
import type { AgentStateStore } from './agent-state-store';

/**
 * Estado local del agente PERSISTIDO EN DISCO.
 *
 * ═══ Por qué existe ═══
 * Con el estado en memoria, todo cambio que ocurra en el HIS mientras el
 * agente está caído se pierde PARA SIEMPRE, y en silencio.
 *
 * El cursor de `detectChanges` no es una marca de tiempo: es una FOTO del
 * estado del HIS. Al arrancar sin cursor, el driver toma una foto nueva y
 * devuelve cero eventos — la foto ya incluye lo que pasó mientras no estaba,
 * así que nunca lo reporta. Comprobado en la VM simulada: se paró el servicio,
 * el hospital agendó una cita por ventanilla, se volvió a arrancar, y ese cupo
 * siguió libre en AgenIA. WhatsApp lo habría vendido otra vez: dos pacientes,
 * un médico, la misma hora.
 *
 * Un reinicio para aplicar parches —algo que TI hará sin avisar— bastaba para
 * provocarlo.
 *
 * ═══ Decisiones ═══
 * · Escritura atómica (temporal + rename): un corte de luz a mitad de escritura
 *   deja el archivo anterior intacto, nunca uno a medias.
 * · Solo escribe cuando el contenido CAMBIA. `detectChanges` corre cada pocos
 *   segundos y casi siempre devuelve la misma foto; sin esta comparación serían
 *   megabytes por minuto de escritura inútil en el disco de la VM.
 * · `appliedEventIds` está acotado: es un registro anti-duplicados, no un
 *   historial. Sin tope, el archivo crecería sin fin.
 * · Si el archivo está corrupto NO se aborta: se arranca desde cero, que es
 *   exactamente el comportamiento anterior, y se avisa. Un agente que no
 *   arranca es peor que uno que reconstruye su foto.
 */

const MAX_EVENTOS_RECORDADOS = 5_000;

interface EstadoSerializado {
  version: 1;
  outboxCursor: string;
  driverCursor: DriverCursor | null;
  appliedEventIds: string[];
}

export class FileAgentStateStore implements AgentStateStore {
  private outboxCursor = '0';
  private driverCursor: DriverCursor | null = null;
  private appliedEventIds: string[] = [];
  private aplicados = new Set<string>();
  /** Último contenido escrito, para no reescribir lo mismo. */
  private ultimoEscrito: string | null = null;

  constructor(
    private readonly rutaArchivo: string,
    private readonly avisar: (mensaje: string) => void = console.warn,
  ) {}

  /**
   * Lee el estado del disco y comprueba que se puede escribir.
   *
   * Falla ruidosamente si el directorio no es escribible: arrancar igual
   * dejaría al agente perdiendo cambios del HIS en cada reinicio, que es
   * justo el fallo silencioso que esta clase existe para evitar.
   */
  async cargar(): Promise<void> {
    fs.mkdirSync(path.dirname(this.rutaArchivo), { recursive: true });

    try {
      const crudo = fs.readFileSync(this.rutaArchivo, 'utf8');
      const datos = JSON.parse(crudo) as EstadoSerializado;
      this.outboxCursor = datos.outboxCursor ?? '0';
      this.driverCursor = datos.driverCursor ?? null;
      this.appliedEventIds = Array.isArray(datos.appliedEventIds)
        ? datos.appliedEventIds
        : [];
      this.aplicados = new Set(this.appliedEventIds);
      this.ultimoEscrito = crudo;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'ENOENT') {
        this.avisar(
          `[mirror-agent] estado local ilegible en ${this.rutaArchivo} (${err?.message}). ` +
            `Se arranca con una foto nueva del HIS: los cambios ocurridos mientras ` +
            `el agente estuvo caído NO se van a reportar.`,
        );
      }
    }

    // Se comprueba AHORA, no en la primera escritura: un agente que descubre a
    // los diez minutos que no puede persistir ya perdió lo que tenía que guardar.
    this.escribir();
  }

  private escribir(): void {
    const contenido = JSON.stringify({
      version: 1,
      outboxCursor: this.outboxCursor,
      driverCursor: this.driverCursor,
      appliedEventIds: this.appliedEventIds,
    } satisfies EstadoSerializado);

    if (contenido === this.ultimoEscrito) return;

    const temporal = `${this.rutaArchivo}.tmp`;
    fs.writeFileSync(temporal, contenido, { mode: 0o600 });
    fs.renameSync(temporal, this.rutaArchivo);
    this.ultimoEscrito = contenido;
  }

  async getOutboxCursor(): Promise<string> {
    return this.outboxCursor;
  }

  async setOutboxCursor(seq: string): Promise<void> {
    this.outboxCursor = seq;
    this.escribir();
  }

  async getDriverCursor(): Promise<DriverCursor | null> {
    return this.driverCursor;
  }

  async setDriverCursor(cursor: DriverCursor): Promise<void> {
    this.driverCursor = cursor;
    this.escribir();
  }

  async hasAppliedLocally(eventId: string): Promise<boolean> {
    return this.aplicados.has(eventId);
  }

  async markAppliedLocally(eventId: string): Promise<void> {
    if (this.aplicados.has(eventId)) return;
    this.aplicados.add(eventId);
    this.appliedEventIds.push(eventId);
    if (this.appliedEventIds.length > MAX_EVENTOS_RECORDADOS) {
      const sobrantes = this.appliedEventIds.splice(
        0,
        this.appliedEventIds.length - MAX_EVENTOS_RECORDADOS,
      );
      for (const id of sobrantes) this.aplicados.delete(id);
    }
    this.escribir();
  }
}

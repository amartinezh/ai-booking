import { Injectable, OnModuleDestroy, Logger, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';
import { claveAlerta } from '@agenia/shared';
import { getErrorMessage } from '../common/error-message.util';
import { TechAlertService } from '../tech-alerts/tech-alert.service';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  /** Ya se avisó que Redis falla y no ha vuelto. */
  private caidaAvisada = false;
  /** Ya estuvo listo una vez desde el arranque. */
  private yaEstuvoListo = false;

  /**
   * 🚨 Sin Redis el bot pierde las sesiones de los pacientes. ioredis emite
   * `error` en cada reintento (cada pocos segundos): se avisa al grupo técnico
   * UNA vez por caída y se resuelve al volver a estar listo. El primer `ready`
   * tras arrancar también resuelve, por si otro proceso dejó la caída abierta.
   */
  constructor(@Optional() private readonly alertas?: TechAlertService) {
    super(process.env.REDIS_URL || 'redis://localhost:6379');

    this.on('connect', () => this.logger.log('Conectado a Redis exitosamente'));
    this.on('error', (err) => {
      this.logger.error('Error en Redis', err);
      if (this.caidaAvisada) return;
      this.caidaAvisada = true;
      void this.alertas?.avisar({
        kind: 'REDIS_ERROR',
        dedupeKey: claveAlerta.redis(),
        title: 'Redis',
        detail: `${getErrorMessage(err)}. Sin Redis el bot pierde las sesiones de los pacientes.`,
        fuente: 'cliente de Redis de la API',
      });
    });
    this.on('ready', () => {
      if (!this.caidaAvisada && this.yaEstuvoListo) return;
      this.caidaAvisada = false;
      this.yaEstuvoListo = true;
      void this.alertas?.resolver(claveAlerta.redis());
    });
  }

  /**
   * Las claves que casan con un patrón, con SCAN y no con KEYS (auditoría
   * 2026-11-07): KEYS recorre todo el espacio de claves de una vez y bloquea a
   * Redis mientras tanto; con pocas claves no se nota, con muchas frena al bot.
   * SCAN va por tandas y deja pasar los demás comandos. Devuelve cada clave una
   * vez aunque SCAN la repita.
   */
  async scanKeys(pattern: string): Promise<string[]> {
    const claves = new Set<string>();
    let cursor = '0';
    do {
      const [siguiente, tanda] = await this.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200,
      );
      cursor = siguiente;
      for (const k of tanda) claves.add(k);
    } while (cursor !== '0');
    return [...claves];
  }

  onModuleDestroy() {
    this.disconnect();
  }
}

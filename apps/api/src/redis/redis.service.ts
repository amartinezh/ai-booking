import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    // Ahora lee de Docker en producción, o usa localhost en tu Mac
    super({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });

    this.on('connect', () => this.logger.log('Conectado a Redis exitosamente'));
    this.on('error', (err) => this.logger.error('Error en Redis', err));
  }

  onModuleDestroy() {
    this.disconnect();
  }
}

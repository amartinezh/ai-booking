import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    super(process.env.REDIS_URL || 'redis://localhost:6379');

    this.on('connect', () => this.logger.log('Conectado a Redis exitosamente'));
    this.on('error', (err) => this.logger.error('Error en Redis', err));
  }

  onModuleDestroy() {
    this.disconnect();
  }
}
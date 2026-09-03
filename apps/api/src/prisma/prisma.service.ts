import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@agenia/database';
import { encryptionExtension } from '../common/crypto/prisma-encryption.extension';

/**
 * Único punto donde se aplica `$extends`, para poder nombrar el tipo
 * resultante — `_extendedClient: any` contagiaba `any` a cada
 * `this.prisma.extended.clinicalRecord`/`.addendum`/`.digitalSignature` que
 * lo consumía en `clinical-records.service.ts`.
 */
function extenderConCifrado(client: PrismaClient) {
  return client.$extends(encryptionExtension);
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private _extendedClient: ReturnType<typeof extenderConCifrado> | undefined;

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Permite acceder al cliente extendido donde se requiere Zero Trust & Data Encryption
  get extended() {
    if (!this._extendedClient) {
      this._extendedClient = extenderConCifrado(this);
    }
    return this._extendedClient;
  }
}

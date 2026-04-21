import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@antigravity/database';
import { encryptionExtension } from '../common/crypto/prisma-encryption.extension';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private _extendedClient: any;

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Permite acceder al cliente extendido donde se requiere Zero Trust & Data Encryption
  get extended() {
    if (!this._extendedClient) {
      this._extendedClient = this.$extends(encryptionExtension);
    }
    return this._extendedClient;
  }
}


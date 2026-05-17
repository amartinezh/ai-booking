import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Cifrado simétrico AES-256-GCM con autenticación.
 *
 * Lectura de la llave:
 *   - process.env.ENCRYPTION_KEY (32 bytes en utf-8 o 64 hex chars).
 *   - Se exige al arranque; si no es válida, el servicio falla rápido.
 *
 * Formato del texto cifrado: `iv:authTag:ciphertext` (todo hex).
 * Hereda compatibilidad con `prisma-encryption.extension.ts`.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key!: Buffer;

  onModuleInit() {
    const raw = process.env.ENCRYPTION_KEY;
    if (!raw) {
      this.logger.warn(
        'ENCRYPTION_KEY no está definida. Usando llave de desarrollo (NO USAR EN PRODUCCIÓN).',
      );
    }
    const source = raw || '12345678901234567890123456789012';
    // Soporta 32 bytes utf-8 o 64 hex.
    let buf: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(source)) {
      buf = Buffer.from(source, 'hex');
    } else {
      buf = Buffer.from(source, 'utf8');
    }
    if (buf.length !== KEY_LENGTH) {
      throw new Error(
        `ENCRYPTION_KEY debe medir 32 bytes (o 64 hex). Recibido: ${buf.length} bytes.`,
      );
    }
    this.key = buf;
  }

  encrypt(plaintext: string): string {
    if (plaintext == null) return plaintext as unknown as string;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext) return ciphertext;
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      // Texto en claro heredado; el extension de Prisma usa la misma convención.
      return ciphertext;
    }
    const [ivHex, authTagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  /** Helper específico para JSON: cifra `JSON.stringify(obj)`. */
  encryptJson<T>(obj: T): string {
    return this.encrypt(JSON.stringify(obj));
  }

  decryptJson<T>(ciphertext: string): T {
    return JSON.parse(this.decrypt(ciphertext)) as T;
  }
}

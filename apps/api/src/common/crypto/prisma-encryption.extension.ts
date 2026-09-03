import { Prisma } from '@agenia/database';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const DEV_KEY = '12345678901234567890123456789012'; // 32 bytes (solo desarrollo)

/**
 * Deriva la llave AES-256 de forma robusta (mismo criterio que CryptoService):
 *   - Se lee de forma perezosa (no en un const al importar), para que
 *     ConfigService/.env ya esté cargado y no caigamos al fallback.
 *   - Se recortan espacios y comillas envolventes (causa típica del error
 *     "Invalid key length": ENCRYPTION_KEY="..." deja 34 bytes en vez de 32).
 *   - Se soporta tanto 32 bytes utf-8 como 64 caracteres hex.
 */
function getKey(): Buffer {
  const raw = (process.env.ENCRYPTION_KEY ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  const source = raw || DEV_KEY;
  const buf = /^[0-9a-fA-F]{64}$/.test(source)
    ? Buffer.from(source, 'hex')
    : Buffer.from(source, 'utf8');
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY debe medir 32 bytes (o 64 hex). Recibido: ${buf.length} bytes.`,
    );
  }
  return buf;
}

export function encryptString(text: string): string {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // Formato: iv:authTag:encryptedText
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptString(text: string): string {
  if (!text) return text;
  const parts = text.split(':');
  // Si no está en el formato cifrado, devolvemos el texto plano (retrocompatibilidad híbrida)
  if (parts.length !== 3) return text;

  try {
    const [ivHex, authTagHex, encryptedTextHex] = parts;
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encryptedTextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Data Decryption Error', error);
    return text;
  }
}

export const encryptionExtension = Prisma.defineExtension({
  name: 'encryption',
  query: {
    clinicalRecord: {
      async create({ args, query }) {
        if (args.data.chiefComplaint)
          args.data.chiefComplaint = encryptString(args.data.chiefComplaint);
        if (args.data.currentIllness)
          args.data.currentIllness = encryptString(args.data.currentIllness);
        if (args.data.physicalExam)
          args.data.physicalExam = encryptString(args.data.physicalExam);
        if (args.data.evolutionNotes)
          args.data.evolutionNotes = encryptString(args.data.evolutionNotes);
        return query(args);
      },
      async update({ args, query }) {
        // Prisma tipa `data` como unión con operadores de actualización
        // (`{ set: string }`, etc.) además de `string` llano. Este extension
        // solo sabe cifrar el caso llano — que es el único que usa el
        // repo hoy — así que se comprueba en vez de asumir con `any`: un
        // operador de actualización no debe pasar por `encryptString` sin
        // que nadie se entere.
        const data = args.data as Record<string, unknown>;
        if (typeof data.chiefComplaint === 'string')
          data.chiefComplaint = encryptString(data.chiefComplaint);
        if (typeof data.currentIllness === 'string')
          data.currentIllness = encryptString(data.currentIllness);
        if (typeof data.physicalExam === 'string')
          data.physicalExam = encryptString(data.physicalExam);
        if (typeof data.evolutionNotes === 'string')
          data.evolutionNotes = encryptString(data.evolutionNotes);
        return query(args);
      },
    },
  },
  result: {
    clinicalRecord: {
      chiefComplaint: {
        needs: { chiefComplaint: true },
        compute(record) {
          return decryptString(record.chiefComplaint);
        },
      },
      currentIllness: {
        needs: { currentIllness: true },
        compute(record) {
          return decryptString(record.currentIllness);
        },
      },
      physicalExam: {
        needs: { physicalExam: true },
        compute(record) {
          if (!record.physicalExam) return null;
          return decryptString(record.physicalExam);
        },
      },
      evolutionNotes: {
        needs: { evolutionNotes: true },
        compute(record) {
          if (!record.evolutionNotes) return null;
          return decryptString(record.evolutionNotes);
        },
      },
    },
  },
});

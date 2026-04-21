import { Prisma } from '@antigravity/database';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// En producción, esto debe inyectarse vía ConfigService/process.env
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012'; // 32 bytes

export function encryptString(text: string): string {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
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
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), Buffer.from(ivHex, 'hex'));
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
        if (args.data.chiefComplaint) args.data.chiefComplaint = encryptString(args.data.chiefComplaint as string);
        if (args.data.currentIllness) args.data.currentIllness = encryptString(args.data.currentIllness as string);
        if (args.data.physicalExam) args.data.physicalExam = encryptString(args.data.physicalExam as string);
        if (args.data.evolutionNotes) args.data.evolutionNotes = encryptString(args.data.evolutionNotes as string);
        return query(args);
      },
      async update({ args, query }) {
        const data: any = args.data;
        if (data.chiefComplaint) data.chiefComplaint = encryptString(data.chiefComplaint);
        if (data.currentIllness) data.currentIllness = encryptString(data.currentIllness);
        if (data.physicalExam) data.physicalExam = encryptString(data.physicalExam);
        if (data.evolutionNotes) data.evolutionNotes = encryptString(data.evolutionNotes);
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

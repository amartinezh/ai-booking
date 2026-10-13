import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BOT_NAME = 'AgenIA';
const DEFAULT_MAX_RETRIES = 3;

export type CommStyle = 'FORMAL' | 'INFORMAL';
const DEFAULT_STYLE: CommStyle = 'FORMAL';

/** Lo que el paciente puede hacer por el bot, operación por operación. */
export interface OperacionesBot {
  agendar: boolean;
  cancelar: boolean;
  modificar: boolean;
}

/** Una operación del paciente sobre sus citas (las tres de `OperacionesBot`). */
export type OperacionBot = 'AGENDAR' | 'CANCELAR' | 'MODIFICAR';

/** La clave de `OperacionesBot` que gobierna cada operación. */
export const CLAVE_OPERACION: Record<OperacionBot, keyof OperacionesBot> = {
  AGENDAR: 'agendar',
  CANCELAR: 'cancelar',
  MODIFICAR: 'modificar',
};

@Injectable()
export class OrganizationSettingsService {
  constructor(private prisma: PrismaService) {}

  async getBotName(organizationId: string): Promise<string> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { botName: true },
    });
    return s?.botName || DEFAULT_BOT_NAME;
  }

  async getMaxRetries(organizationId: string): Promise<number> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { maxRetriesPerStep: true },
    });
    const value = s?.maxRetriesPerStep;
    return typeof value === 'number' && value > 0 ? value : DEFAULT_MAX_RETRIES;
  }

  async getCommunicationStyle(organizationId: string): Promise<CommStyle> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { communicationStyle: true },
    });
    return (s?.communicationStyle as CommStyle) || DEFAULT_STYLE;
  }

  /**
   * ¿El bot puede agendar citas nuevas en esta clínica? Sin fila de settings =
   * prendido, igual que el default de la columna. Cancelar y cambiar tienen su
   * propio interruptor: ver `operacionesDelBot`.
   */
  async isBookingEnabled(organizationId: string): Promise<boolean> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { bookingEnabled: true },
    });
    return s?.bookingEnabled ?? true;
  }

  /**
   * Qué puede hacer el paciente por el bot en esta clínica, operación por
   * operación (/dashboard/configuracion). Una sola lectura para las tres, en
   * cada mensaje y sin caché: apagar una surte efecto en el siguiente turno.
   * Sin fila de settings = las tres prendidas (el default de las columnas).
   *
   * Son los interruptores TAL CUAL. El chatbot les suma la condición del
   * espejo (envío al hospital encendido) en `operacionesDisponibles`.
   */
  async operacionesDelBot(organizationId: string): Promise<OperacionesBot> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: {
        bookingEnabled: true,
        cancelEnabled: true,
        rescheduleEnabled: true,
      },
    });
    return {
      agendar: s?.bookingEnabled ?? true,
      cancelar: s?.cancelEnabled ?? true,
      modificar: s?.rescheduleEnabled ?? true,
    };
  }

  async getSettings(organizationId: string): Promise<{
    botName: string;
    maxRetriesPerStep: number;
    communicationStyle: CommStyle;
  }> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: {
        botName: true,
        maxRetriesPerStep: true,
        communicationStyle: true,
      },
    });
    return {
      botName: s?.botName || DEFAULT_BOT_NAME,
      maxRetriesPerStep:
        typeof s?.maxRetriesPerStep === 'number' && s.maxRetriesPerStep > 0
          ? s.maxRetriesPerStep
          : DEFAULT_MAX_RETRIES,
      communicationStyle: (s?.communicationStyle as CommStyle) || DEFAULT_STYLE,
    };
  }

  async upsertSettings(
    organizationId: string,
    data: {
      botName?: string;
      maxRetriesPerStep?: number;
      communicationStyle?: CommStyle;
    },
  ): Promise<void> {
    await this.prisma.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }
}

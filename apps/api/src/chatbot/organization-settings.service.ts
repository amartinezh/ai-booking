import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BOT_NAME = 'AgenIA';
const DEFAULT_MAX_RETRIES = 3;

export type CommStyle = 'FORMAL' | 'INFORMAL';
const DEFAULT_STYLE: CommStyle = 'FORMAL';

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

  async getSettings(
    organizationId: string,
  ): Promise<{ botName: string; maxRetriesPerStep: number; communicationStyle: CommStyle }> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { botName: true, maxRetriesPerStep: true, communicationStyle: true },
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
    data: { botName?: string; maxRetriesPerStep?: number; communicationStyle?: CommStyle },
  ): Promise<void> {
    await this.prisma.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }
}

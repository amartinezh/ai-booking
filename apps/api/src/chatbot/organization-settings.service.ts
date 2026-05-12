import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BOT_NAME = 'Vicente';
const DEFAULT_MAX_RETRIES = 3;

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

  async getSettings(
    organizationId: string,
  ): Promise<{ botName: string; maxRetriesPerStep: number }> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { botName: true, maxRetriesPerStep: true },
    });
    return {
      botName: s?.botName || DEFAULT_BOT_NAME,
      maxRetriesPerStep:
        typeof s?.maxRetriesPerStep === 'number' && s.maxRetriesPerStep > 0
          ? s.maxRetriesPerStep
          : DEFAULT_MAX_RETRIES,
    };
  }

  async upsertSettings(
    organizationId: string,
    data: { botName?: string; maxRetriesPerStep?: number },
  ): Promise<void> {
    await this.prisma.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }
}

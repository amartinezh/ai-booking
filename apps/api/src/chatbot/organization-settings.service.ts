import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BOT_NAME = 'Vicente';

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

  async getSettings(organizationId: string): Promise<{ botName: string }> {
    const s = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { botName: true },
    });
    return { botName: s?.botName || DEFAULT_BOT_NAME };
  }

  async upsertSettings(
    organizationId: string,
    data: { botName?: string },
  ): Promise<void> {
    await this.prisma.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }
}

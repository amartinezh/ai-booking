import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(private prisma: PrismaService) {}

  async hasContent(organizationId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { knowledgeBase: true },
    });
    return !!(org?.knowledgeBase && org.knowledgeBase.trim().length > 0);
  }

  async getContent(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { knowledgeBase: true },
    });
    return org?.knowledgeBase?.trim() ?? '';
  }

  async updateContent(organizationId: string, content: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { knowledgeBase: content.trim() || null },
    });
    this.logger.log(`Base de conocimiento actualizada para org ${organizationId}`);
  }
}

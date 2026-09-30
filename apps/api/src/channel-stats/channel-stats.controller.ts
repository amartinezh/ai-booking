import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelStatsService } from './channel-stats.service';

/**
 * 📈 «Canales en vivo»: WhatsApp y Telegram en cifras. Solo lectura de la
 * base, sin llamadas a IA ni a Meta/Telegram (refrescar no cuesta nada).
 *
 *  - GET /channel-stats          → la clínica del usuario (admin u observador).
 *  - GET /channel-stats/global   → Super Admin: todas o una clínica.
 */
@Controller('channel-stats')
@UseGuards(RolesGuard)
export class ChannelStatsController {
  constructor(
    private readonly service: ChannelStatsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles('ORG_ADMIN', 'GENERAL_OBSERVER')
  async forTenant(
    @CurrentTenant() organizationId: string | null | undefined,
    @Query('range') range?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!organizationId)
      throw new BadRequestException('Sin clínica en la sesión.');
    return this.service.getStats({
      organizationId,
      range,
      startDate,
      endDate,
      timeZone: await this.zonaDe(organizationId),
    });
  }

  @Get('global')
  @Roles('SUPER_ADMIN')
  async global(
    @Query('organizationId') organizationId?: string,
    @Query('range') range?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const org =
      organizationId && organizationId !== 'ALL' ? organizationId : null;
    return this.service.getStats({
      organizationId: org,
      range,
      startDate,
      endDate,
      timeZone: org ? await this.zonaDe(org) : undefined,
    });
  }

  /** Zona de la clínica (multi-tenant); null → Bogotá. */
  private async zonaDe(organizationId: string): Promise<string | undefined> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return org?.timezone?.trim() || undefined;
  }
}

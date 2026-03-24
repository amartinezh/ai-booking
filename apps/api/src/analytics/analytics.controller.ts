// @ts-nocheck
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { Role } from '@antigravity/database';

@Controller('analytics')
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  @Roles('ORG_ADMIN', 'GENERAL_OBSERVER')
  getAnalytics(
    @CurrentTenant() organizationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!organizationId) throw new Error('Missing Tenant Context');
    return this.analyticsService.getDashboardStats(organizationId, startDate, endDate);
  }
}

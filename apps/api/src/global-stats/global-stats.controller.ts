import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { GlobalStatsService, TimeRange } from './global-stats.service';

const ALLOWED_RANGES: TimeRange[] = ['TODAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM'];

/**
 * 🌎 Endpoints exclusivos del dashboard de "Estadísticas Globales"
 * (Super Admin). Reutilizan RolesGuard + JWT como el resto de la API.
 */
@Controller('global-stats')
@UseGuards(RolesGuard)
export class GlobalStatsController {
  constructor(private readonly service: GlobalStatsService) {}

  // GET /global-stats/organizations
  // Lista compacta de clínicas para alimentar el dropdown del filtro.
  @Get('organizations')
  @Roles('SUPER_ADMIN')
  listOrganizations() {
    return this.service.listOrganizationsForFilter();
  }

  // GET /global-stats?organizationId=&range=&startDate=&endDate=
  // Devuelve los 11 contadores + las 4 tendencias.
  @Get()
  @Roles('SUPER_ADMIN')
  getStats(
    @Query('organizationId') organizationId?: string,
    @Query('range') range?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const normalizedRange: TimeRange =
      range && ALLOWED_RANGES.includes(range.toUpperCase() as TimeRange)
        ? (range.toUpperCase() as TimeRange)
        : 'MONTH';

    return this.service.getGlobalStats({
      organizationId:
        organizationId && organizationId !== 'ALL' ? organizationId : null,
      range: normalizedRange,
      startDate,
      endDate,
    });
  }
}

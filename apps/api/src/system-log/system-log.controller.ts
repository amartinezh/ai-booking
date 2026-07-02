import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SystemLogService, SystemLogLevel } from './system-log.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

/**
 * Endpoints del panel de Super Admin. Los logs son CROSS-TENANT (incluyen
 * metadata con bodies de requests de todas las clínicas), así que la API los
 * protege por sí misma con RolesGuard: la validación del lado Next.js no
 * basta porque esta API es alcanzable públicamente (el webhook de Meta
 * apunta a ella).
 */
@Controller('system-logs')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class SystemLogController {
  constructor(private readonly logs: SystemLogService) {}

  @Get('recent-errors')
  async recentErrors(@Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 5;
    const errors = await this.logs.recentErrors(Number.isFinite(n) ? n : 5);
    return { rows: errors };
  }

  @Get()
  async list(
    @Query('level') level?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const allowed: SystemLogLevel[] = ['EVENT', 'WARNING', 'ERROR'];
    const lvl =
      level && allowed.includes(level.toUpperCase() as SystemLogLevel)
        ? (level.toUpperCase() as SystemLogLevel)
        : 'ALL';

    return this.logs.list({
      level: lvl,
      search: search || undefined,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25,
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const log = await this.logs.getById(id);
    return { log };
  }
}

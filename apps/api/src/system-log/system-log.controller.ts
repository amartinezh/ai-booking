import { Controller, Get, Param, Query } from '@nestjs/common';
import { SystemLogService, SystemLogLevel } from './system-log.service';

/**
 * Endpoints internos consumidos por el panel de Super Admin del frontend
 * (a través de server actions en Next.js). La autorización al rol
 * SUPER_ADMIN se hace en el lado Next.js mediante `getSession()`.
 */
@Controller('system-logs')
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

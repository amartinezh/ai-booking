import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { MonitorService } from './monitor.service';

/**
 * 📡 Monitor de Servicios — endpoints REST.
 *
 * Todo el controlador es SUPER_ADMIN (monitor global, no por tenant). Reutiliza
 * el `RolesGuard` del proyecto con `@Roles('SUPER_ADMIN')`.
 */
@Controller('monitor')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  /** MODO B: ejecuta checks frescos y devuelve JSON inmediato. NO escribe en BD. */
  @Get('live-check')
  async liveCheck() {
    return this.monitor.runLiveCheck();
  }

  /** Metadata del monitor (estado del cron de fondo, intervalos, catálogo). */
  @Get('config')
  config() {
    return this.monitor.meta();
  }

  /** KPIs del histórico. `period` en días (default 30). */
  @Get('incidents/summary')
  async summary(@Query('period') period?: string) {
    return this.monitor.summary(this.parsePeriodDays(period));
  }

  /** Histórico filtrado de incidentes. */
  @Get('incidents')
  async incidents(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('service') service?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.monitor.listIncidents({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      services: service ? service.split(',').filter(Boolean) : undefined,
      status: this.parseStatus(status),
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /** Detalle completo de un incidente. */
  @Get('incidents/:id')
  async incident(@Param('id') id: string) {
    return this.monitor.getIncident(id);
  }

  /** Limpieza manual: borra incidentes resueltos anteriores a `before` (ISO). */
  @Delete('incidents')
  async clear(@Query('before') before?: string) {
    const cutoff = before ? new Date(before) : new Date();
    const count = await this.monitor.deleteBefore(cutoff);
    return { deleted: count };
  }

  private parsePeriodDays(period?: string): number {
    if (!period) return 30;
    const map: Record<string, number> = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365,
    };
    if (map[period]) return map[period];
    const n = parseInt(period, 10);
    return Number.isFinite(n) && n > 0 ? n : 30;
  }

  private parseStatus(status?: string): 'all' | 'open' | 'resolved' {
    if (status === 'open' || status === 'resolved') return status;
    return 'all';
  }
}

// @ts-nocheck
import { Controller, Patch, Param, Body, UseGuards, Put } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
// @ts-ignore: Prisma monorepo cache issue
import { Role, AttendanceStatus } from '@antigravity/database';

@Controller('appointments')
@UseGuards(RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Patch(':id/attendance')
  @Roles('BOOKING_AGENT', 'DOCTOR', 'ORG_ADMIN') 
  async updateAttendance(
    @CurrentTenant() organizationId: string,
    @Param('id') id: string,
    @Body('status') status: AttendanceStatus,
  ) {
    return this.appointmentsService.updateAttendance(id, status, organizationId);
  }
}

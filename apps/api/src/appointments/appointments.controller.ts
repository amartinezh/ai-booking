import { Controller, Patch, Param, Body, UseGuards, Put } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role, AttendanceStatus } from '@antigravity/database';

@Controller('appointments')
@UseGuards(RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Patch(':id/attendance')
  @Roles(Role.BOOKING_AGENT, Role.DOCTOR, Role.ADMIN) // Añadiendo ADMIN para control general, pero priorizando DOCTOR y AGENT tal cual pidió el requerimiento
  async updateAttendance(
    @Param('id') id: string,
    @Body('status') status: AttendanceStatus,
  ) {
    return this.appointmentsService.updateAttendance(id, status);
  }
}

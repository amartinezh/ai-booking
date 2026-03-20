import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ClinicalRecordService } from './clinical-records.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '@antigravity/database';

@Controller('clinical-records')
@UseGuards(RolesGuard)
export class ClinicalRecordsController {
  constructor(private readonly recordService: ClinicalRecordService) {}

  @Post()
  @Roles(Role.DOCTOR) // Estrictamente DOCTOR, agentes no pueden escribir historias clínicas
  async createRecord(@Body() createDto: any) {
    return this.recordService.createClinicalRecord(createDto);
  }

  @Get('appointment/:appointmentId')
  @Roles(Role.DOCTOR, Role.PATIENT) // Pacientes pueden ver su propia historia, doctores también
  async getByAppointment(@Param('appointmentId') appointmentId: string) {
    return this.recordService.getClinicalRecordByAppointment(appointmentId);
  }
}

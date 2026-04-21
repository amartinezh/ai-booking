import { Controller, Post, Get, Body, Param, UseGuards, Patch } from '@nestjs/common';
import { ClinicalRecordService } from './clinical-records.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '@antigravity/database';

@Controller('clinical-records')
@UseGuards(RolesGuard)
export class ClinicalRecordsController {
  constructor(private readonly recordService: ClinicalRecordService) { }

  @Post()
  @Roles('DOCTOR') // Estrictamente DOCTOR, agentes no pueden escribir historias clínicas
  async createRecord(@Body() createDto: any) {
    return this.recordService.createClinicalRecord(createDto);
  }

  @Patch(':id')
  @Roles('DOCTOR')
  async updateRecord(
    @Param('id') id: string,
    @Body() updateDto: any
  ) {
    return this.recordService.updateClinicalRecord(id, updateDto);
  }

  @Post(':id/sign')
  @Roles('DOCTOR')
  async signRecord(
    @Param('id') id: string,
    @Body('userId') userId: string,
    @Body('ipAddress') ipAddress?: string
  ) {
    return this.recordService.signClinicalRecord(id, userId, ipAddress);
  }

  @Post(':id/addendum')
  @Roles('DOCTOR')
  async createAddendum(
    @Param('id') id: string,
    @Body('doctorId') doctorId: string,
    @Body('content') content: string,
    @Body('ipAddress') ipAddress?: string
  ) {
    return this.recordService.createAddendum(id, doctorId, content, ipAddress);
  }

  @Get('appointment/:appointmentId')
  @Roles('DOCTOR', 'PATIENT') // Pacientes pueden ver su propia historia, doctores también
  async getByAppointment(@Param('appointmentId') appointmentId: string) {
    return this.recordService.getClinicalRecordByAppointment(appointmentId);
  }
}

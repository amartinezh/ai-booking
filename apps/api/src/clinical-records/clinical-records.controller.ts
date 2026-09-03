import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { ClinicalRecordService } from './clinical-records.service';
import type {
  CreateClinicalRecordDto,
  UpdateClinicalRecordDto,
} from './clinical-records.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtUserPayload } from '../common/current-user.decorator';

/**
 * 🏢 Todas las rutas operan sobre el tenant del TOKEN (@CurrentTenant), nunca
 * sobre un organizationId del body/params. El actor de firmas y adendas sale
 * de @CurrentUser por la misma razón (no-repudio).
 */
@Controller('clinical-records')
@UseGuards(RolesGuard)
export class ClinicalRecordsController {
  constructor(private readonly recordService: ClinicalRecordService) {}

  @Post()
  @Roles('DOCTOR') // Estrictamente DOCTOR, agentes no pueden escribir historias clínicas
  async createRecord(
    @Body() createDto: CreateClinicalRecordDto,
    @CurrentTenant() organizationId: string,
  ) {
    return this.recordService.createClinicalRecord(createDto, organizationId);
  }

  @Patch(':id')
  @Roles('DOCTOR')
  async updateRecord(
    @Param('id') id: string,
    @Body() updateDto: UpdateClinicalRecordDto,
    @CurrentTenant() organizationId: string,
  ) {
    return this.recordService.updateClinicalRecord(
      id,
      updateDto,
      organizationId,
    );
  }

  @Post(':id/sign')
  @Roles('DOCTOR')
  async signRecord(
    @Param('id') id: string,
    @CurrentTenant() organizationId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body('ipAddress') ipAddress?: string,
  ) {
    // El firmante es SIEMPRE el usuario autenticado; el `userId` que envíe el
    // body se ignora (era suplantable).
    return this.recordService.signClinicalRecord(
      id,
      user.userId,
      organizationId,
      ipAddress,
    );
  }

  @Post(':id/addendum')
  @Roles('DOCTOR')
  async createAddendum(
    @Param('id') id: string,
    @Body('doctorId') doctorId: string,
    @Body('content') content: string,
    @CurrentTenant() organizationId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body('ipAddress') ipAddress?: string,
  ) {
    return this.recordService.createAddendum(
      id,
      doctorId,
      content,
      organizationId,
      user.userId,
      ipAddress,
    );
  }

  @Get('appointment/:appointmentId')
  @Roles('DOCTOR', 'PATIENT') // Pacientes pueden ver su propia historia, doctores también
  async getByAppointment(
    @Param('appointmentId') appointmentId: string,
    @CurrentTenant() organizationId: string,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.recordService.getClinicalRecordByAppointment(
      appointmentId,
      organizationId,
      { userId: user.userId, role: user.role },
    );
  }
}

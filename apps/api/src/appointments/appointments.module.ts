import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { LimiteCitasService } from './limite-citas.service';

@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService, LimiteCitasService],
  exports: [AppointmentsService, LimiteCitasService],
})
export class AppointmentsModule {}

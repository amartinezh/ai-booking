import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Importante: Global para no importarlo en cada módulo
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

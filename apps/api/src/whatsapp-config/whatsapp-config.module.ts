import { Module } from '@nestjs/common';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappCredentialsService } from './whatsapp-credentials.service';
import { WhatsappConfigController } from './whatsapp-config.controller';

@Module({
  controllers: [WhatsappConfigController],
  providers: [WhatsappConfigService, WhatsappCredentialsService],
  exports: [WhatsappCredentialsService, WhatsappConfigService],
})
export class WhatsappConfigModule {}

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappCredentialsService } from './whatsapp-credentials.service';
import { WhatsappTemplateService } from './whatsapp-template.service';
import { WhatsappConfigController } from './whatsapp-config.controller';

@Module({
  imports: [HttpModule],
  controllers: [WhatsappConfigController],
  providers: [
    WhatsappConfigService,
    WhatsappCredentialsService,
    WhatsappTemplateService,
  ],
  exports: [
    WhatsappCredentialsService,
    WhatsappConfigService,
    WhatsappTemplateService,
  ],
})
export class WhatsappConfigModule {}

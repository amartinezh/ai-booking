import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ClinicalAiService } from './clinical-ai.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller('clinical-ai')
@UseGuards(RolesGuard)
export class ClinicalAiController {
  constructor(private readonly clinicalAiService: ClinicalAiService) {}

  @Post('dictate')
  @Roles('DOCTOR')
  async transcribeDictation(@Body() body: { audioBase64: string, mimeType?: string }) {
    if (!body.audioBase64) {
      throw new Error('Falta el audio base64');
    }
    const cleanBase64 = body.audioBase64.replace(/^data:audio\/(webm|mp4|mp3|ogg|mpeg);base64,/, '');
    
    return this.clinicalAiService.transcribeDictation(cleanBase64, body.mimeType || 'audio/webm');
  }
}

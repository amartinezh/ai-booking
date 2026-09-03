import { Injectable, Logger } from '@nestjs/common';
import {
  LlmFactoryService,
  NoActiveLlmProviderError,
} from '../llm/llm-factory.service';
import { ClinicalRecordDraft } from '../llm/interfaces/llm-provider.interface';
import { getErrorStatus } from '../common/error-message.util';

@Injectable()
export class ClinicalAiService {
  private readonly logger = new Logger(ClinicalAiService.name);

  constructor(private readonly llmFactory: LlmFactoryService) {}

  async transcribeDictation(
    organizationId: string,
    audioBase64: string,
    mimeType: string = 'audio/webm',
  ): Promise<ClinicalRecordDraft> {
    try {
      const provider = await this.llmFactory.forOrg(organizationId);
      this.logger.log(
        `Dictado clínico procesado por ${provider.name} (org ${organizationId})`,
      );
      return await provider.generateClinicalRecord({
        base64: audioBase64,
        mimeType,
      });
    } catch (error: unknown) {
      if (error instanceof NoActiveLlmProviderError) {
        throw new Error(
          'Esta clínica no tiene un proveedor de IA configurado. ' +
            'Configúrelo en Configuración → Integración de IA.',
        );
      }
      this.logger.error('Error procesando dictado de IA:', error);
      if (getErrorStatus(error) === 503) {
        throw new Error(
          'El proveedor de IA está experimentando alta demanda (503). Intente de nuevo en unos segundos.',
        );
      }
      const rawMessage = error instanceof Error ? error.message : undefined;
      throw new Error(
        'Fallo al procesar dictado de voz: ' +
          (rawMessage || 'Error desconocido'),
      );
    }
  }
}

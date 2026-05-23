import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { AudioConfigService } from './audio-config.service';
import type {
  AudioDiagnosisResult,
  PublicAudioConfig,
  SaveAudioConfigInput,
} from './dto/audio-config.types';

/**
 * Configuración de Voz y Audio (TTS) por organización.
 *
 * Aislamiento NIVEL BANCA: aunque la ruta incluye `:orgId`, TODA operación
 * exige que ese `:orgId` coincida con el `organizationId` del token. Un admin
 * jamás puede leer/escribir/diagnosticar la configuración de otra clínica,
 * aunque adivine su UUID.
 */
@Controller('organizations/:orgId/audio-config')
@UseGuards(RolesGuard)
export class AudioConfigController {
  constructor(private readonly audio: AudioConfigService) {}

  @Get()
  @Roles('ORG_ADMIN')
  async getConfig(
    @Param('orgId') orgId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<PublicAudioConfig> {
    this.assertSameTenant(orgId, tenantId);
    return this.audio.getPublic(tenantId);
  }

  @Put()
  @Roles('ORG_ADMIN')
  async saveConfig(
    @Param('orgId') orgId: string,
    @CurrentTenant() tenantId: string,
    @Body() body: SaveAudioConfigInput,
  ): Promise<PublicAudioConfig> {
    this.assertSameTenant(orgId, tenantId);
    return this.audio.upsert(tenantId, body);
  }

  /** Botón "Validar Servicio Alive": prueba real contra Google TTS. */
  @Get('diagnose')
  @Roles('ORG_ADMIN')
  async diagnose(
    @Param('orgId') orgId: string,
    @CurrentTenant() tenantId: string,
  ): Promise<AudioDiagnosisResult> {
    this.assertSameTenant(orgId, tenantId);
    return this.audio.diagnose(tenantId);
  }

  /**
   * Verifica que la organización del token sea exactamente la de la URL.
   * Cualquier desajuste (o token sin organización) es 403 — sin filtrar si el
   * `:orgId` existe o no.
   */
  private assertSameTenant(orgId: string, tenantId: string): void {
    if (!tenantId) {
      throw new ForbiddenException('Sin organización en el token.');
    }
    if (orgId !== tenantId) {
      throw new ForbiddenException(
        'No autorizado: la organización solicitada no coincide con su sesión.',
      );
    }
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { MirrorAgentRequest } from './mirror-agent.guard';
import { MirrorAgentGuard } from './mirror-agent.guard';
import { MirrorDispatchService } from './mirror-dispatch.service';
import { MirrorApplyService } from './mirror-apply.service';
import type {
  AckInput,
  AckResult,
  ChangesInput,
  ChangesResult,
  HandshakeInput,
  HandshakeResult,
  HeartbeatInput,
  OutboxEventDto,
} from './dto/mirror.types';

type AgentRequest = Request & MirrorAgentRequest;

/**
 * Protocolo /mirror/* — el mismo contrato para cualquier driver/hospital.
 * Autenticado por MirrorAgentGuard (token de agente, NO JWT de staff — ver
 * ese archivo). Ningún handler aquí conoce el esquema de un HIS específico.
 */
@Controller('mirror')
@UseGuards(MirrorAgentGuard)
export class MirrorController {
  constructor(
    private readonly dispatch: MirrorDispatchService,
    private readonly apply: MirrorApplyService,
  ) {}

  @Post('handshake')
  handshake(
    @Req() req: AgentRequest,
    @Body() body: HandshakeInput,
  ): Promise<HandshakeResult> {
    if (!body?.agentClockIso) {
      throw new BadRequestException('agentClockIso es requerido.');
    }
    const { organizationId, driverKey, driverConfig } = req.mirrorConfig;
    return this.dispatch.handshake(
      organizationId,
      driverKey,
      driverConfig,
      body,
    );
  }

  // GET /mirror/events?cursor=0&limit=100 — long-poll, hasta ~25s de espera.
  @Get('events')
  getEvents(
    @Req() req: AgentRequest,
    @Query('cursor') cursor: string = '0',
    @Query('limit') limit?: string,
  ): Promise<OutboxEventDto[]> {
    const cursorSeq = BigInt(cursor || '0');
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.dispatch.getPendingEvents(
      req.mirrorConfig.organizationId,
      cursorSeq,
      parsedLimit,
    );
  }

  @Post('ack')
  ack(@Req() req: AgentRequest, @Body() body: AckInput): Promise<AckResult> {
    // `seqs` puede venir vacío si TODO el lote falló (ver failedSeqs) — lo
    // único inválido es que ninguno de los dos venga como arreglo.
    const hasSeqs = Array.isArray(body?.seqs);
    const hasFailed = body?.failedSeqs === undefined || Array.isArray(body.failedSeqs);
    if (!hasSeqs || !hasFailed) {
      throw new BadRequestException(
        'seqs y failedSeqs (si viene) deben ser arreglos.',
      );
    }
    if (body.seqs.length === 0 && !body.failedSeqs?.length) {
      throw new BadRequestException(
        'Debe reportar al menos un seq exitoso o fallido.',
      );
    }
    return this.dispatch.ack(req.mirrorConfig.organizationId, body);
  }

  @Post('changes')
  applyChanges(
    @Req() req: AgentRequest,
    @Body() body: ChangesInput,
  ): Promise<ChangesResult> {
    if (!Array.isArray(body?.events)) {
      throw new BadRequestException('events debe ser un arreglo.');
    }
    return this.apply.applyBatch(req.mirrorConfig.organizationId, body.events);
  }

  @Post('heartbeat')
  async heartbeat(
    @Req() req: AgentRequest,
    @Body() body: HeartbeatInput,
  ): Promise<{ ok: true }> {
    const { organizationId, driverKey } = req.mirrorConfig;
    await this.dispatch.heartbeat(organizationId, driverKey, body ?? {});
    return { ok: true };
  }
}

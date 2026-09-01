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
import { MirrorReconciliationService } from './mirror-reconciliation.service';
import { MirrorApplyService } from './mirror-apply.service';
import { MirrorAvailabilityService } from './mirror-availability.service';
import type {
  AckInput,
  AckResult,
  ChangesInput,
  ChangesResult,
  HandshakeInput,
  HandshakeResult,
  HeartbeatInput,
  OutboxEventDto,
  AvailabilityInput,
  AvailabilityResult,
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
    private readonly reconciliation: MirrorReconciliationService,
    private readonly apply: MirrorApplyService,
    private readonly availability: MirrorAvailabilityService,
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

  /**
   * POST /mirror/reconcile — el agente sube su instantánea del HIS y el
   * servidor la contrasta con las citas de AgenIA.
   *
   * Va por aquí y no por una conexión directa a la base del hospital porque
   * el HIS no es alcanzable desde la nube por diseño (plan §4.1): solo el
   * agente lo ve, y solo habla HTTPS saliente.
   */
  @Post('reconcile')
  async reconcile(
    @Req() req: AgentRequest,
    @Body() body: { fromIso?: string; toIso?: string; appointments?: unknown },
  ) {
    if (!Array.isArray(body?.appointments)) {
      throw new BadRequestException(
        'appointments debe ser un arreglo con la instantánea del HIS.',
      );
    }
    const from = body.fromIso ? new Date(body.fromIso) : new Date();
    const to = body.toIso
      ? new Date(body.toIso)
      : new Date(Date.now() + 90 * 24 * 3600_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('fromIso/toIso deben ser fechas válidas.');
    }

    return this.reconciliation.reconcile(
      req.mirrorConfig.organizationId,
      body.appointments as never,
      { from, to },
    );
  }

  /**
   * POST /mirror/availability — el agente sube la rejilla de agenda del
   * hospital para una sub-ventana (Fase 2).
   *
   * Cada envío es la foto COMPLETA de esa sub-ventana: el servidor crea lo que
   * falta y borra lo que sobra dentro de ella. Por eso la ventana viaja en el
   * cuerpo y no se infiere de los cupos — una franja sin turnos es información
   * legítima ("ese día el médico no atiende") y debe poder llegar vacía.
   */
  @Post('availability')
  availabilityUpload(
    @Req() req: AgentRequest,
    @Body() body: AvailabilityInput,
  ): Promise<AvailabilityResult> {
    if (!Array.isArray(body?.slots)) {
      throw new BadRequestException('slots debe ser un arreglo.');
    }
    const from = new Date(body?.fromIso ?? '');
    const to = new Date(body?.toIso ?? '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new BadRequestException(
        'fromIso/toIso deben ser fechas válidas y fromIso anterior a toIso.',
      );
    }
    return this.availability.apply(req.mirrorConfig.organizationId, body);
  }

  @Post('ack')
  ack(@Req() req: AgentRequest, @Body() body: AckInput): Promise<AckResult> {
    // `seqs` puede venir vacío si TODO el lote falló (ver failedSeqs) o si
    // todo el lote era de un tipo que el driver no espeja (skippedSeqs) — lo
    // único inválido es que ninguno de los tres venga como arreglo.
    const esArreglo = (v: unknown) => v === undefined || Array.isArray(v);
    const hasSeqs = Array.isArray(body?.seqs);
    if (!hasSeqs || !esArreglo(body?.failedSeqs) || !esArreglo(body?.skippedSeqs)) {
      throw new BadRequestException(
        'seqs, failedSeqs y skippedSeqs (si vienen) deben ser arreglos.',
      );
    }
    // 🚨 Olvidar skippedSeqs aquí bloqueaba el lote entero: un tick en el que
    // lo único pendiente era un evento SLOT mandaba un ack legítimo y recibía
    // un 400, así que el evento nunca se cerraba y el agente entraba en modo
    // seguro. No lo vio ningún test unitario — el cliente HTTP estaba
    // mockeado. Lo encontró el agente corriendo de verdad en la VM.
    if (
      body.seqs.length === 0 &&
      !body.failedSeqs?.length &&
      !body.skippedSeqs?.length
    ) {
      throw new BadRequestException(
        'Debe reportar al menos un seq exitoso, fallido u omitido.',
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

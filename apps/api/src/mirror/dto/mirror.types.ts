/**
 * Re-exporta el contrato canónico de @agenia/shared — mismo patrón que
 * apps/web/lib/date con los helpers de fecha (ver CLAUDE.md). El contrato
 * vive en un solo lugar (packages/shared/src/mirror-protocol.ts) porque
 * tanto este módulo como apps/mirror-agent hablan exactamente el mismo JSON.
 */
export type {
  CanonicalEntityType,
  CanonicalOp,
  HandshakeInput,
  HandshakeResult,
  OutboxEventDto,
  OutboxEventContext,
  AckInput,
  AckResult,
  AvailabilityInput,
  AvailabilityResult,
  CanonicalChangeEvent,
  ChangesInput,
  ChangesResult,
  HeartbeatInput,
} from '@agenia/shared';

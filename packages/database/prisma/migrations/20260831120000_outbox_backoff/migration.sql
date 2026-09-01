-- Reintentos con backoff para SyncOutbox.
--
-- Motivo: hasta ahora el agente avanzaba su cursor local aunque el evento
-- fallara, y el dispatcher filtraba por `seq > cursor`. Resultado: un evento
-- fallido NO se volvia a servir nunca mientras el agente siguiera vivo —
-- `attempts` subia como mucho una vez por reinicio del agente, y el
-- dead-letter de 10 intentos era inalcanzable en la practica. Medido en vivo
-- el 2026-08-31: attempts 0 -> 1 -> 2 -> 3, una por reinicio.
--
-- El dispatcher deja de filtrar por cursor (la verdad de "pendiente" es
-- deliveredAt IS NULL) y usa esta columna para espaciar los reintentos.
ALTER TABLE "SyncOutbox" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- Sirve la seleccion de "un evento pendiente por entidad" del dispatcher, que
-- garantiza el orden por entidad cuando el cursor global desaparece.
CREATE INDEX "SyncOutbox_organizationId_entityType_entityId_seq_idx"
  ON "SyncOutbox"("organizationId", "entityType", "entityId", "seq");

-- El indice parcial de pendientes ahora tambien excluye los dead-letter, que
-- es como consulta el dispatcher. Se recrea (no se puede ALTER un predicado).
-- Ojo: este bloque es SQL manual — `prisma db push` NO lo ejecuta. Vive
-- ademas en prisma/sql/non-prisma-ddl.sql, que si corre en todos los caminos.
DROP INDEX IF EXISTS "idx_outbox_pending";
CREATE INDEX "idx_outbox_pending"
  ON "SyncOutbox"("organizationId", "seq")
  WHERE "deliveredAt" IS NULL AND "deadLettered" = false;

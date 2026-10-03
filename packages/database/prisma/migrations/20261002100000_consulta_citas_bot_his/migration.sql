-- ═══════════════════════════════════════════════════════════════════════════
-- CONSULTA DE CITAS DEL BOT AL HIS EN VIVO (docs/PLAN_CONSULTA_CITAS.md, Fase B)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El bot reutiliza la consulta en vivo del rastreo (HisLookupRequest): mismo
-- agente, mismo driver. Tres cambios aditivos:
--
--   · HospitalMirrorConfig.botLookupMode — interruptor PROPIO del bot (D4),
--     separado de `lookupEnabled` del personal. OFF por defecto: nada cambia
--     hasta encenderlo a mano. SHADOW consulta pero no le muestra nada nuevo al
--     paciente (B3: mide el criterio de entrada de D8).
--   · HisLookupRequest.origin — 'STAFF' (pantalla del rastreo) o 'BOT'. Los
--     topes del personal no cuentan las del bot, ni al revés.
--   · HisLookupRequest.botFollowupAt — cuándo el bot ya atendió el resultado
--     (segundo mensaje o silencio). Compare-and-set entre réplicas.

CREATE TYPE "MirrorBotLookupMode" AS ENUM ('OFF', 'SHADOW', 'ON');

ALTER TABLE "HospitalMirrorConfig"
  ADD COLUMN "botLookupMode" "MirrorBotLookupMode" NOT NULL DEFAULT 'OFF';

ALTER TABLE "HisLookupRequest"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'STAFF',
  ADD COLUMN "botFollowupAt" TIMESTAMP(3);

-- El barrido del bot: resultados de sus consultas que aún no atendió.
CREATE INDEX "HisLookupRequest_origin_botFollowupAt_createdAt_idx"
  ON "HisLookupRequest"("origin", "botFollowupAt", "createdAt");

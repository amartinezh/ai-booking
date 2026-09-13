-- FASE 2 DE AVISOS MASIVOS — fuente espejo bajo demanda.
--
-- Ver docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §5.
--
-- Una tabla nueva, sin tocar nada existente. `NoticeRosterRequest` es la
-- petición "tráeme las citas del Dr. X entre el 25 y el 26" que la pantalla
-- crea y el agente on-premise resuelve en su siguiente vuelta (~30 s) por
-- GET /mirror/notice-requests + POST /mirror/notice-roster — bajo demanda,
-- nunca réplica continua: los teléfonos del HIS solo viajan cuando hay una
-- cancelación real que comunicar.
--
-- Sigue el mismo criterio de aislamiento que el resto del módulo: FK propia
-- hacia MassNoticeBatch (no hacia Appointment/ScheduleSlot), sin trigger de
-- outbox — una petición de roster no es un evento que el HIS deba conocer.
CREATE TABLE "NoticeRosterRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "doctorExternalKey" TEXT NOT NULL,
    "fromIso" TIMESTAMP(3) NOT NULL,
    "toIso" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "NoticeRosterRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoticeRosterRequest_organizationId_status_createdAt_idx" ON "NoticeRosterRequest"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "NoticeRosterRequest" ADD CONSTRAINT "NoticeRosterRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRosterRequest" ADD CONSTRAINT "NoticeRosterRequest_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MassNoticeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

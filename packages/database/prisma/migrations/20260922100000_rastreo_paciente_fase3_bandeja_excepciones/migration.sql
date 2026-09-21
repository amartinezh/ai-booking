-- RASTREO DE PACIENTE — FASE 3: vigilante y bandeja de excepciones de sincronización.
--
-- Ver docs/PLAN_RASTREO_PACIENTE.md §10 #2 y #3. Todo es ADITIVO: no se toca ni se
-- migra ninguna fila existente.
--
--   · SyncException: un problema de la sincronización con el HIS que alguien tiene que
--     mirar, con dueño y estado. Lo abre el vigilante de la API y lo trabaja el
--     personal desde la web. Sin FK a citas ni pacientes (es una bitácora de trabajo)
--     y sin datos personales en el texto.
--   · SyncExceptionLog: su historial, append-only.
--   · WhatsappTemplateKind.SYNC_EXCEPTION_ALERT: la plantilla del aviso al agendador.
--
-- El valor nuevo del enum es un cambio de catálogo: no reescribe nada, y como en
-- las migraciones anteriores de este enum no se USA dentro de la misma transacción.

-- AlterEnum
ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'SYNC_EXCEPTION_ALERT';

-- CreateTable
CREATE TABLE "SyncException" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABIERTA',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "appointmentId" TEXT,
    "patientId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "outboxSeq" BIGINT,
    "epsId" TEXT,
    "doctorId" TEXT,
    "appointmentStartAt" TIMESTAMP(3),
    "meta" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "notifiedSeverity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncExceptionLog" (
    "id" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncExceptionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncException_organizationId_status_severity_idx" ON "SyncException"("organizationId", "status", "severity");

-- CreateIndex
CREATE INDEX "SyncException_organizationId_appointmentStartAt_idx" ON "SyncException"("organizationId", "appointmentStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncException_organizationId_dedupeKey_key" ON "SyncException"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SyncExceptionLog_exceptionId_createdAt_idx" ON "SyncExceptionLog"("exceptionId", "createdAt");

-- AddForeignKey
ALTER TABLE "SyncException" ADD CONSTRAINT "SyncException_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncExceptionLog" ADD CONSTRAINT "SyncExceptionLog_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "SyncException"("id") ON DELETE CASCADE ON UPDATE CASCADE;


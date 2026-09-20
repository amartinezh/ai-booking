-- RASTREO DE PACIENTE — FASE 0 (prerrequisitos).
--
-- Ver docs/PLAN_RASTREO_PACIENTE.md §8. Todo es ADITIVO: no se toca ni se
-- migra ninguna fila existente.
--
--   · Índice InteractionLog(organizationId, whatsappId, createdAt): la tabla no
--     tenía NINGUNO, así que reconstruir la conversación de un remitente era un
--     scan completo.
--   · Índice Appointment(organizationId, patientId): "las citas de este
--     paciente" recorría toda la tabla.
--   · SyncOutbox.lastError: el motivo del último fallo que reporta el agente
--     (antes solo existía en el journal de la VM del hospital).
--   · WhatsappMessageLog: libro de mensajes salientes (wamid + estado de
--     entrega según Meta).
--   · PatientLookupLog: bitácora de consultas de la pantalla de rastreo.
--
-- ⚠️ CREATE INDEX (sin CONCURRENTLY: Prisma corre cada migración en una
-- transacción y CONCURRENTLY no puede ir dentro de una) bloquea las ESCRITURAS
-- de esa tabla mientras se construye. En InteractionLog eso son las auditorías
-- del bot, que son fire-and-forget: esperan, no fallan. Con la tabla en
-- decenas de miles de filas dura segundos; si algún día fuera de millones,
-- aplicar el índice a mano con CONCURRENTLY antes de desplegar.
--
-- El índice de búsqueda por nombre (pg_trgm + unaccent) NO va aquí: usa
-- extensiones y una función que Prisma no expresa, así que vive en
-- prisma/sql/non-prisma-ddl.sql, que corre idempotente tras cada despliegue.

-- CreateEnum
CREATE TYPE "WhatsappMessageType" AS ENUM ('TEXT', 'AUDIO', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "WhatsappMessageKind" AS ENUM ('BOT_REPLY', 'BOOKING_CONFIRMATION', 'APPOINTMENT_REMINDER', 'WAITLIST_OFFER', 'MASS_NOTICE', 'MANUAL', 'SYSTEM_NOTICE');

-- CreateEnum
CREATE TYPE "WhatsappMessageStatus" AS ENUM ('ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterTable
ALTER TABLE "SyncOutbox" ADD COLUMN     "lastError" TEXT;

-- CreateTable
CREATE TABLE "WhatsappMessageLog" (
    "id" TEXT NOT NULL,
    "wamid" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "messageType" "WhatsappMessageType" NOT NULL,
    "kind" "WhatsappMessageKind" NOT NULL,
    "appointmentId" TEXT,
    "status" "WhatsappMessageStatus" NOT NULL DEFAULT 'ACCEPTED',
    "statusAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientLookupLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "queryKind" TEXT NOT NULL,
    "queryMasked" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonNote" TEXT,
    "candidateIds" JSONB NOT NULL,
    "openedPatientId" TEXT,
    "verdicts" JSONB,
    "liveHisRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientLookupLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessageLog_wamid_key" ON "WhatsappMessageLog"("wamid");

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_organizationId_recipientId_createdAt_idx" ON "WhatsappMessageLog"("organizationId", "recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_appointmentId_idx" ON "WhatsappMessageLog"("appointmentId");

-- CreateIndex
CREATE INDEX "PatientLookupLog_organizationId_createdAt_idx" ON "PatientLookupLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientLookupLog_organizationId_actorUserId_createdAt_idx" ON "PatientLookupLog"("organizationId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_patientId_idx" ON "Appointment"("organizationId", "patientId");

-- CreateIndex
CREATE INDEX "InteractionLog_organizationId_whatsappId_createdAt_idx" ON "InteractionLog"("organizationId", "whatsappId", "createdAt");

-- AddForeignKey
ALTER TABLE "WhatsappMessageLog" ADD CONSTRAINT "WhatsappMessageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLookupLog" ADD CONSTRAINT "PatientLookupLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RASTREO DE PACIENTE — FASE 2: consulta EN VIVO al HIS.
--
-- Ver docs/PLAN_RASTREO_PACIENTE.md §7. Todo es ADITIVO: no se toca ni se migra
-- ninguna fila existente.
--
--   · HisLookupRequest: la petición que la pantalla crea y el agente resuelve
--     (mismo patrón que NoticeRosterRequest). Sus `params` y `result` llevan
--     datos de un paciente y se BORRAN a los 15 minutos (`purgeAt`); la tabla
--     conserva solo los metadatos.
--   · HospitalMirrorConfig.lookupEnabled: interruptor por organización, APAGADO
--     por defecto. Se enciende a mano después de medir el costo de la consulta
--     en el laboratorio del hospital.
--   · HospitalMirrorConfig.lastLookupCapable: lo que el agente reporta en cada
--     latido (¿su driver implementa la consulta?). NULL = nunca lo reportó.
--
-- La columna NOT NULL lleva DEFAULT: en Postgres 11+ agregarla es un cambio de
-- catálogo, no reescribe la tabla.

-- AlterTable
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN     "lastLookupCapable" BOOLEAN,
ADD COLUMN     "lookupEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "HisLookupRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "result" JSONB,
    "error" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "patientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "HisLookupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HisLookupRequest_organizationId_status_createdAt_idx" ON "HisLookupRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HisLookupRequest_purgedAt_purgeAt_idx" ON "HisLookupRequest"("purgedAt", "purgeAt");

-- AddForeignKey
ALTER TABLE "HisLookupRequest" ADD CONSTRAINT "HisLookupRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


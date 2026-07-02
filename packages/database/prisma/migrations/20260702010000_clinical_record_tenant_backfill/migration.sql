-- =============================================================================
-- 🏢 AISLAMIENTO MULTI-TENANT (fase 2): HISTORIAS CLÍNICAS
--
-- El formulario web nunca enviaba organizationId al crear historias clínicas,
-- así que TODAS las creadas desde el panel quedaron con organizationId NULL.
-- La API ahora filtra toda operación sobre ClinicalRecord por el tenant del
-- token; sin este backfill, las historias existentes serían invisibles.
--
-- Requiere la migración 20260702000000 (PatientProfile.organizationId ya es
-- NOT NULL), lo que garantiza que el backfill vía paciente siempre resuelve.
-- =============================================================================

-- 1) Backfill de ClinicalRecord: primero desde la cita, luego desde el
--    paciente (que ya es NOT NULL, por lo que no pueden quedar huérfanas).
UPDATE "ClinicalRecord" cr
SET "organizationId" = a."organizationId"
FROM "Appointment" a
WHERE cr."appointmentId" = a."id"
  AND cr."organizationId" IS NULL
  AND a."organizationId" IS NOT NULL;

UPDATE "ClinicalRecord" cr
SET "organizationId" = p."organizationId"
FROM "PatientProfile" p
WHERE cr."patientId" = p."id"
  AND cr."organizationId" IS NULL;

-- 2) Backfill oportunista de Appointment y ScheduleSlot: sus columnas siguen
--    siendo nullable (eso se endurecerá en una fase posterior), pero rellenar
--    los NULL históricos hace confiable el filtro por tenant desde ya.
UPDATE "Appointment" a
SET "organizationId" = p."organizationId"
FROM "PatientProfile" p
WHERE a."patientId" = p."id"
  AND a."organizationId" IS NULL;

UPDATE "ScheduleSlot" s
SET "organizationId" = d."organizationId"
FROM "DoctorProfile" d
WHERE s."doctorId" = d."id"
  AND s."organizationId" IS NULL;

-- 3) ClinicalRecord.organizationId pasa a ser obligatorio.
ALTER TABLE "ClinicalRecord" ALTER COLUMN "organizationId" SET NOT NULL;

-- 4) Relación requerida → acción referencial RESTRICT (igual criterio que la
--    fase 1). El purge de organizaciones borra las historias explícitamente
--    antes de borrar la org, así que no se ve afectado.
ALTER TABLE "ClinicalRecord" DROP CONSTRAINT IF EXISTS "ClinicalRecord_organizationId_fkey";
ALTER TABLE "ClinicalRecord" ADD CONSTRAINT "ClinicalRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Índice de apoyo: todas las lecturas de historias ahora filtran por tenant.
CREATE INDEX IF NOT EXISTS "ClinicalRecord_organizationId_idx" ON "ClinicalRecord"("organizationId");

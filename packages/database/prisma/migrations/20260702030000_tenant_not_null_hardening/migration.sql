-- =============================================================================
-- 🏢 AISLAMIENTO MULTI-TENANT (fase 3): ENDURECIMIENTO ESTRUCTURAL
--
-- Appointment, ScheduleSlot y AgentProfile pasan a organizationId NOT NULL.
-- Con la columna nullable, `where: { organizationId: undefined }` en Prisma
-- significa "sin filtro" en silencio, y las filas huérfanas quedan invisibles
-- para las vistas de clínica pero visibles para queries mal filtradas.
--
-- InteractionLog se queda nullable A PROPÓSITO: hay eventos que se loguean
-- antes de poder resolver el tenant (ver comentario en schema.prisma).
--
-- Requiere las migraciones 20260702000000 (PatientProfile/DoctorProfile con
-- org NOT NULL) y 20260702010000 (backfill previo): gracias a ellas, el
-- backfill vía paciente/médico siempre resuelve.
-- =============================================================================

-- 1) Backfill (idempotente: re-ejecuta lo de la fase 2 por si entraron filas
--    nuevas entre ambas migraciones).
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

-- AgentProfile hereda del User; si el User tampoco tiene org (dato anómalo),
-- cae al fallback de organización única o aborta con instrucción manual.
DO $$
DECLARE
  org_count INTEGER;
  single_org_id TEXT;
  orphan_count INTEGER;
BEGIN
  UPDATE "AgentProfile" ap
  SET "organizationId" = u."organizationId"
  FROM "User" u
  WHERE ap."userId" = u."id"
    AND ap."organizationId" IS NULL
    AND u."organizationId" IS NOT NULL;

  SELECT COUNT(*) INTO org_count FROM "Organization";
  IF org_count = 1 THEN
    SELECT "id" INTO single_org_id FROM "Organization";
    UPDATE "AgentProfile" SET "organizationId" = single_org_id WHERE "organizationId" IS NULL;
  END IF;

  SELECT COUNT(*) INTO orphan_count FROM "AgentProfile" WHERE "organizationId" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Migración abortada: % AgentProfile sin organizationId y % organizaciones registradas. Asigne organizationId manualmente y vuelva a ejecutar.',
      orphan_count, org_count;
  END IF;
END $$;

-- 2) NOT NULL (el backfill de arriba lo garantiza: patientId y doctorId son
--    obligatorios, y sus perfiles ya tienen org NOT NULL desde la fase 1).
ALTER TABLE "Appointment"  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ScheduleSlot" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "AgentProfile" ALTER COLUMN "organizationId" SET NOT NULL;

-- 3) Relación requerida → RESTRICT (mismo criterio que fases 1 y 2). El purge
--    de organizaciones borra citas/cupos/agentes explícitamente antes que la
--    org, así que no se ve afectado.
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_organizationId_fkey";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduleSlot" DROP CONSTRAINT IF EXISTS "ScheduleSlot_organizationId_fkey";
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentProfile" DROP CONSTRAINT IF EXISTS "AgentProfile_organizationId_fkey";
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Índices de apoyo: las vistas de clínica filtran por tenant en cada query.
CREATE INDEX IF NOT EXISTS "Appointment_organizationId_idx" ON "Appointment"("organizationId");
CREATE INDEX IF NOT EXISTS "ScheduleSlot_organizationId_idx" ON "ScheduleSlot"("organizationId");

-- =============================================================================
-- 🏢 AISLAMIENTO MULTI-TENANT: unicidad POR ORGANIZACIÓN
--
-- Antes de esta migración, name/nit (Eps), name (MedicalService), cedula
-- (PatientProfile) y cedula/medicalLicense (DoctorProfile) eran únicos a nivel
-- de TODA la plataforma. Eso hacía que dos clínicas chocaran entre sí:
--   - La clínica B no podía crear la EPS "Sura" si la A ya la tenía.
--   - El mismo paciente (misma cédula) no podía existir en dos clínicas, y el
--     chatbot terminaba reutilizando (y filtrando datos de) el perfil de la
--     otra clínica.
--   - Un médico no podía trabajar en dos clínicas.
--
-- Este script:
--   1. Rellena organizationId en filas huérfanas (heredando del User o, si la
--      plataforma tiene UNA sola organización, asignándolas a ella).
--   2. Aborta con instrucción de mapeo manual si quedan huérfanas y hay varias
--      organizaciones (no podemos adivinar el tenant).
--   3. Reemplaza los índices únicos globales por únicos compuestos con
--      organizationId y vuelve la columna NOT NULL.
--
-- Nota: como la unicidad anterior era GLOBAL, es imposible que existan
-- duplicados dentro de una misma organización; crear los únicos compuestos
-- no puede fallar por datos preexistentes.
-- =============================================================================

-- 1) + 2) Backfill defensivo de organizationId.
DO $$
DECLARE
  org_count INTEGER;
  single_org_id TEXT;
  orphan_count INTEGER;
BEGIN
  -- Pacientes y médicos heredan la organización de su User cuando éste la tiene.
  UPDATE "PatientProfile" p
  SET "organizationId" = u."organizationId"
  FROM "User" u
  WHERE p."userId" = u."id"
    AND p."organizationId" IS NULL
    AND u."organizationId" IS NOT NULL;

  UPDATE "DoctorProfile" d
  SET "organizationId" = u."organizationId"
  FROM "User" u
  WHERE d."userId" = u."id"
    AND d."organizationId" IS NULL
    AND u."organizationId" IS NOT NULL;

  -- Último recurso: con UNA sola organización en la plataforma, las filas
  -- huérfanas son datos previos al multi-tenant y pertenecen a ella.
  SELECT COUNT(*) INTO org_count FROM "Organization";
  IF org_count = 1 THEN
    SELECT "id" INTO single_org_id FROM "Organization";
    UPDATE "PatientProfile" SET "organizationId" = single_org_id WHERE "organizationId" IS NULL;
    UPDATE "DoctorProfile"  SET "organizationId" = single_org_id WHERE "organizationId" IS NULL;
    UPDATE "Eps"            SET "organizationId" = single_org_id WHERE "organizationId" IS NULL;
    UPDATE "MedicalService" SET "organizationId" = single_org_id WHERE "organizationId" IS NULL;
  END IF;

  -- Con varias organizaciones no podemos adivinar el tenant de una fila
  -- huérfana: abortar para que se mapeen a mano antes de reintentar.
  SELECT (SELECT COUNT(*) FROM "PatientProfile" WHERE "organizationId" IS NULL)
       + (SELECT COUNT(*) FROM "DoctorProfile"  WHERE "organizationId" IS NULL)
       + (SELECT COUNT(*) FROM "Eps"            WHERE "organizationId" IS NULL)
       + (SELECT COUNT(*) FROM "MedicalService" WHERE "organizationId" IS NULL)
    INTO orphan_count;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Migración abortada: % fila(s) sin organizationId en PatientProfile/DoctorProfile/Eps/MedicalService y % organizaciones registradas. Asigne organizationId manualmente a esas filas y vuelva a ejecutar.',
      orphan_count, org_count;
  END IF;
END $$;

-- 3a) Adiós a la unicidad global (IF EXISTS: entornos creados con `db push`
--     en momentos distintos pueden no tener alguno de estos índices).
DROP INDEX IF EXISTS "Eps_name_key";
DROP INDEX IF EXISTS "Eps_nit_key";
DROP INDEX IF EXISTS "MedicalService_name_key";
DROP INDEX IF EXISTS "PatientProfile_cedula_key";
DROP INDEX IF EXISTS "DoctorProfile_cedula_key";
DROP INDEX IF EXISTS "DoctorProfile_medicalLicense_key";

-- 3b) organizationId pasa a ser obligatorio (garantizado por el backfill).
ALTER TABLE "Eps"            ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "MedicalService" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "PatientProfile" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "DoctorProfile"  ALTER COLUMN "organizationId" SET NOT NULL;

-- 3c) La relación ahora es requerida: la acción referencial pasa de SET NULL
--     (imposible con NOT NULL) a RESTRICT, que es lo que Prisma espera para
--     relaciones obligatorias. El purge de organizaciones no se ve afectado:
--     borra explícitamente pacientes/médicos/EPS/servicios antes que la org.
ALTER TABLE "Eps" DROP CONSTRAINT IF EXISTS "Eps_organizationId_fkey";
ALTER TABLE "Eps" ADD CONSTRAINT "Eps_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MedicalService" DROP CONSTRAINT IF EXISTS "MedicalService_organizationId_fkey";
ALTER TABLE "MedicalService" ADD CONSTRAINT "MedicalService_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientProfile" DROP CONSTRAINT IF EXISTS "PatientProfile_organizationId_fkey";
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DoctorProfile" DROP CONSTRAINT IF EXISTS "DoctorProfile_organizationId_fkey";
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3d) Unicidad nueva: por organización. En Postgres los NULL no chocan entre
--     sí, así que varias filas con nit/medicalLicense NULL siguen siendo
--     válidas dentro de la misma clínica.
CREATE UNIQUE INDEX "Eps_organizationId_name_key" ON "Eps"("organizationId", "name");
CREATE UNIQUE INDEX "Eps_organizationId_nit_key" ON "Eps"("organizationId", "nit");
CREATE UNIQUE INDEX "MedicalService_organizationId_name_key" ON "MedicalService"("organizationId", "name");
CREATE UNIQUE INDEX "PatientProfile_organizationId_cedula_key" ON "PatientProfile"("organizationId", "cedula");
CREATE UNIQUE INDEX "DoctorProfile_organizationId_cedula_key" ON "DoctorProfile"("organizationId", "cedula");
CREATE UNIQUE INDEX "DoctorProfile_organizationId_medicalLicense_key" ON "DoctorProfile"("organizationId", "medicalLicense");

-- 📄 Página pública de la política de tratamiento de datos (Ley 1581 de 2012):
-- /politica-de-datos/<organizationId>. Solo agrega columnas vacías: mientras
-- `dataPolicyPage` sea NULL la página no existe (404) y nada cambia al desplegar.

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "dataPolicyPage" JSONB,
ADD COLUMN     "dataPolicyPageUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "dataPolicyPageUpdatedBy" TEXT;

-- 🌾 Sábados solo para la zona rural (Configuración › Asistente Virtual): el
-- asistente agenda los sábados solo a pacientes de zona rural, con un tope por
-- médico. Todo nace vacío (NULL = sin regla especial; tabla sin filas): ninguna
-- clínica cambia de conducta al desplegar.

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "saturdayRuralSharePercent" INTEGER;

-- Entre 10 y 100 %, o NULL.
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_saturdayRuralSharePercent_check" CHECK ("saturdayRuralSharePercent" IS NULL OR ("saturdayRuralSharePercent" >= 10 AND "saturdayRuralSharePercent" <= 100));

-- AlterTable
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN     "ruralListCount" INTEGER,
ADD COLUMN     "ruralListSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RuralPatient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "document" VARCHAR(20) NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuralPatient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RuralPatient_organizationId_document_key" ON "RuralPatient"("organizationId", "document");

-- AddForeignKey
ALTER TABLE "RuralPatient" ADD CONSTRAINT "RuralPatient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

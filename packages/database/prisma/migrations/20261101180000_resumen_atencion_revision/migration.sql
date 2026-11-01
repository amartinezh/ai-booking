-- Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md), cierre de la Fase 1.
--
--   · AttentionSummary.review*: la revisión del hospital contra el HIS
--     («Correcto» o «Con error» y qué está mal). La nota se borra con el
--     contenido a los 30 días (D11).
--   · HospitalMirrorConfig.resumenAtencionMedicion: cuánto tardan las consultas
--     del agente al HIS, vuelta por vuelta (el último día). Sin datos de pacientes.
--
-- Solo agrega columnas que admiten NULL: ninguna fila existente cambia.

-- AlterTable
ALTER TABLE "AttentionSummary" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewResult" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT;

-- AlterTable
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN     "resumenAtencionMedicion" JSONB;

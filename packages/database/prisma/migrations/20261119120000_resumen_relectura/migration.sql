-- Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md §8.11, 2026-11-19).
-- Solo columnas que admiten nulo: no reescribe filas ni bloquea.

-- D10, relectura: cuándo el agente volvió a leer la historia un día después.
ALTER TABLE "AttentionSummary" ADD COLUMN "rereadAt" TIMESTAMP(3);

-- El último error del bucle del resumen que reporta el agente en su latido.
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN "resumenAtencionError" TEXT;

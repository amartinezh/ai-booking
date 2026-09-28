-- ═══════════════════════════════════════════════════════════════════════════
-- EL BSUID DEJA DE SER ÚNICO POR CLÍNICA (sigue siendo POR clínica)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260830120000_bsuid_scoped_por_organizacion creó una llave ÚNICA sobre
-- (organizationId, bsuid), siguiendo el patrón de la cédula. Pero la cédula es
-- la persona y el BSUID es la CUENTA de WhatsApp, que una familia comparte:
--
--   1. Una madre con el número oculto agenda para ella y para su hijo: la
--      ficha del hijo no se creaba (P2002) y su cita no se reservaba.
--   2. Un paciente que ya existía escribe desde ese mismo WhatsApp: el bot le
--      rellena BSUID y régimen EN EL MISMO update; el BSUID chocaba, el update
--      entero fallaba y el paciente se quedaba sin régimen — el dato sin el
--      cual su cita no llega al HIS (incidente del 2026-09-26).
--
-- Se cambia por un índice normal. El aislamiento entre clínicas NO cambia: el
-- índice sigue empezando por organizationId, y no se crea ninguna llave que
-- cruce clínicas (docs de la decisión: bsuid-aislamiento-por-org).
--
-- Solo relaja una restricción: toda fila que hoy existe ya la cumple.

-- DropIndex
-- IF EXISTS / IF NOT EXISTS: la migración que la creó también fue idempotente
-- (hay entornos cuyo esquema nació con `db push`).
DROP INDEX IF EXISTS "PatientProfile_organizationId_bsuid_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProfile_organizationId_bsuid_idx" ON "PatientProfile"("organizationId", "bsuid");


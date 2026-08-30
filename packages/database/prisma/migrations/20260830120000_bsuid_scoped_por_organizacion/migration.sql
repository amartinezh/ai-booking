-- =============================================================================
-- 🆔 BSUID DE WHATSAPP: identidad de paciente scoped POR ORGANIZACIÓN
--
-- Desde 2026 un usuario de WhatsApp puede ocultar su número tras un username.
-- Cuando lo hace, Meta deja de mandar `wa_id`/`from` en el webhook y entrega en
-- su lugar el BSUID (Business-scoped user ID, ej. CO.13491208655302741918), que
-- es el identificador estable del paciente frente a NUESTRO portafolio de
-- negocio. El teléfono pasa a ser un dato opcional y caduco (Meta sólo lo
-- reenvía si hubo contacto en los últimos 30 días, si el paciente lo autoriza
-- con REQUEST_CONTACT_INFO, o si está en su contact book).
--
-- DECISIÓN DE ARQUITECTURA: el BSUID se indexa POR ORGANIZACIÓN, nunca global.
-- El mismo paciente en dos clínicas son dos filas con dos BSUID distintos (uno
-- por portafolio de Meta) y eso se acepta, igual que ya se acepta para la
-- cédula. NO se adopta el Parent BSUID (CO.ENT.*): su función es correlacionar
-- al mismo usuario entre portafolios vinculados, es decir, crear exactamente la
-- llave de join cross-tenant sobre datos de salud que este proyecto evita.
--
-- Este script:
--   1. Agrega `bsuid` (nullable: durante la transición casi todas las filas lo
--      tendrán en NULL, y en Postgres los NULL no chocan en un índice único).
--   2. Crea la unicidad compuesta (organizationId, bsuid).
--   3. Antepone el tenant al índice de búsqueda por teléfono.
--   4. Elimina `facebookId`, que tenía unicidad GLOBAL — el anti-patrón exacto
--      que esta migración establece que no se debe repetir. Aborta primero si
--      contra todo pronóstico tuviera datos.
-- =============================================================================

-- 1) Columna nueva. El BSUID llega como texto opaco: no se parsea ni se valida
--    su forma (el prefijo de país puede cambiar y no es asunto nuestro).
ALTER TABLE "PatientProfile" ADD COLUMN IF NOT EXISTS "bsuid" TEXT;

-- 2) Unicidad POR ORGANIZACIÓN, en línea con (organizationId, cedula).
--    Los NULL no chocan entre sí en Postgres, así que la restricción convive
--    sin problema con la mayoría de filas todavía sin BSUID.
CREATE UNIQUE INDEX IF NOT EXISTS "PatientProfile_organizationId_bsuid_key"
  ON "PatientProfile"("organizationId", "bsuid");

-- 3) El índice de búsqueda por teléfono llevaba el identificador solo, lo que
--    sugiere (y habilita) búsquedas globales por número. Se antepone el tenant:
--    toda consulta debe entrar por la organización.
DROP INDEX IF EXISTS "PatientProfile_whatsappId_idx";
CREATE INDEX IF NOT EXISTS "PatientProfile_organizationId_whatsappId_idx"
  ON "PatientProfile"("organizationId", "whatsappId");

-- 4) facebookId: declarado en el schema desde el inicio, con UNIQUE global, y
--    sin una sola lectura ni escritura en todo el código. Si alguna vez se
--    hubiera cableado, la segunda clínica que registrara al mismo paciente
--    habría reventado con violación de unicidad. Se elimina.
--
--    Aborto defensivo: sólo se borra si está probadamente vacío. Si hay datos
--    (carga manual, script externo), la migración se detiene para que alguien
--    decida qué hacer con ellos en vez de perderlos en silencio.
DO $$
DECLARE
  fb_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PatientProfile' AND column_name = 'facebookId'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM "PatientProfile" WHERE "facebookId" IS NOT NULL'
      INTO fb_count;
    IF fb_count > 0 THEN
      RAISE EXCEPTION
        'Migración abortada: % fila(s) de PatientProfile tienen facebookId con datos. Se esperaba que la columna estuviera vacía (ningún código la escribe). Respalde o migre esos valores y vuelva a ejecutar.',
        fb_count;
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS "PatientProfile_facebookId_key";
ALTER TABLE "PatientProfile" DROP COLUMN IF EXISTS "facebookId";

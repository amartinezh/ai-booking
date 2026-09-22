-- =============================================================================
-- PRUEBAS E2E — 4. LIMPIAR EL LADO DE AGENIA  (PostgreSQL, no SQL Server)
-- ⚠️ BORRA. Solo las filas de los documentos sintéticos y de UNA organización.
-- =============================================================================
--
-- POR QUÉ EXISTE. Hasta el alta en caliente, una prueba E2E solo dejaba basura en
-- el HIS: los pacientes los creaba el probador desde WhatsApp y el guion 3 los
-- borraba allá. Ahora NO: cada cita que el hospital agenda **crea en AgenIA** un
-- `PatientProfile` y su `User` (`PLAN_ALTA_EN_CALIENTE.md`, D9), y el documento que
-- pide la baja deja además una fila en `MirrorPatientOptOut`. Nada de eso lo toca
-- `PRUEBAS_E2E_3_LIMPIAR.sql`, que solo habla con SQL Server. Sin este guion, los 22
-- pacientes sintéticos se quedan en la base de AgenIA para siempre, y el documento
-- dado de baja impide que una prueba futura vuelva a darlo de alta.
--
-- ORDEN. Este es el ÚLTIMO paso de la limpieza, después de:
--   1. cancelar en el panel las citas de prueba que sigan vigentes;
--   2. resolver o descartar las excepciones de prueba en la bandeja;
--   3. correr `PRUEBAS_E2E_3_LIMPIAR.sql` contra PRUEBAS (el HIS).
-- Cancelar desde el panel —y no aquí— es lo que libera el cupo correctamente y deja
-- la constancia; este guion se NIEGA a correr si queda alguna cita sin cancelar.
--
-- 🔒 GARANTÍAS, verificables leyendo el archivo:
--   · Todo va acotado por `organizationId` Y por documento sintético (9990000001 …
--     9990000022, comparados sin ceros a la izquierda, que es como AgenIA los
--     considera el mismo número).
--   · Una sola transacción: o queda todo limpio, o no se borra nada.
--   · `agenia.sync_origin = 'MIRROR'` al principio de la transacción: `ScheduleSlot`
--     y `Appointment` tienen el disparador del outbox, así que sin eso cada borrado
--     encolaría un evento hacia el hospital. Con MIRROR nacen entregados y no viajan
--     (es lo mismo que hace la API cuando aplica algo que viene del HIS).
--   · Con `confirmo = 0` (por defecto) solo enseña lo que borraría.
--
-- CÓMO SE CORRE, en el VPS de AgenIA:
--   docker compose exec -T postgres psql -U agenia -d agenia \
--     -v org=<ID-DE-LA-ORGANIZACION> -v confirmo=0 -f PRUEBAS_E2E_4_LIMPIAR_AGENIA.sql
-- El id de la organización es el que imprime `./checkHealth.sh` en su cabecera.
-- =============================================================================

\set ON_ERROR_STOP on

-- Si no llegaron por -v, quedan en un valor imposible a propósito.
\if :{?org}
\else
  \set org 'FALTA-EL-ID-DE-LA-ORGANIZACION'
\endif
\if :{?confirmo}
\else
  \set confirmo 0
\endif

-- ── El contexto y los documentos, en tablas temporales ──────────────────────
DROP TABLE IF EXISTS e2e_ctx;
CREATE TEMP TABLE e2e_ctx (org text);
INSERT INTO e2e_ctx (org) VALUES (:'org');

DROP TABLE IF EXISTS e2e_doc;
CREATE TEMP TABLE e2e_doc (doc text PRIMARY KEY);
INSERT INTO e2e_doc (doc)
SELECT '99900000' || lpad(g::text, 2, '0') FROM generate_series(1, 22) AS g;

-- Los perfiles alcanzados: del tenant Y con documento sintético. `regexp_replace`
-- quita los ceros de la izquierda, igual que `documentoSinCerosIniciales`, para que
-- el perfil ambiguo `0009990000022` entre también.
DROP TABLE IF EXISTS e2e_perfil;
CREATE TEMP TABLE e2e_perfil AS
SELECT p.id, p."userId", p.cedula
  FROM "PatientProfile" p, e2e_ctx c
 WHERE p."organizationId" = c.org
   AND regexp_replace(p.cedula, '^0+', '') IN (SELECT doc FROM e2e_doc);

DO $$
DECLARE v_org text; v_n int;
BEGIN
  SELECT org INTO v_org FROM e2e_ctx;
  IF NOT EXISTS (SELECT 1 FROM "Organization" WHERE id = v_org) THEN
    RAISE EXCEPTION 'No existe ninguna organización con id %. Pase -v org=<id> (lo imprime checkHealth.sh).', v_org;
  END IF;
  SELECT count(*) INTO v_n FROM e2e_perfil;
  RAISE NOTICE 'Organización %: % perfil(es) sintético(s) alcanzado(s).', v_org, v_n;
END $$;

-- ── Vista previa ────────────────────────────────────────────────────────────
\echo ''
\echo '=== Lo que se borraría en AgenIA ==='

SELECT 'PatientProfile' AS tabla, count(*) AS filas FROM e2e_perfil
UNION ALL
SELECT 'User (el temporal de cada perfil)', count(*) FROM e2e_perfil WHERE "userId" IS NOT NULL
UNION ALL
SELECT 'Appointment', count(*) FROM "Appointment" a WHERE a."patientId" IN (SELECT id FROM e2e_perfil)
UNION ALL
SELECT 'ClinicalRecord', count(*) FROM "ClinicalRecord" r WHERE r."patientId" IN (SELECT id FROM e2e_perfil)
UNION ALL
SELECT 'WaitlistEntry', count(*) FROM "WaitlistEntry" w WHERE w."patientId" IN (SELECT id FROM e2e_perfil)
UNION ALL
SELECT 'InformedConsent', count(*) FROM "InformedConsent" i WHERE i."patientId" IN (SELECT id FROM e2e_perfil)
UNION ALL
SELECT 'MirrorPatientOptOut (la baja del D10)', count(*)
  FROM "MirrorPatientOptOut" o
 WHERE o."organizationId" = (SELECT org FROM e2e_ctx)
   AND o.document IN (SELECT doc FROM e2e_doc);

-- 🚦 Las que impiden seguir: una cita de prueba sin cancelar. Borrarla aquí dejaría
-- el cupo marcado como ocupado y sin cita, que es justo lo que la reconciliación
-- reporta como deriva.
\echo ''
\echo '--- Citas de prueba SIN cancelar (si aparece alguna, cancélela en el panel) ---'
SELECT a.id, a.status, s."startTime", p.cedula
  FROM "Appointment" a
  JOIN e2e_perfil p ON p.id = a."patientId"
  JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
 WHERE a.status <> 'CANCELLED'
 ORDER BY s."startTime";

-- Cupos que quedaron OCUPADOS SIN CITA: es lo que hace el alta en caliente cuando se
-- niega a crear el paciente (documento ambiguo). No hay cita que cancelar, así que
-- los libera este guion. Se identifican por la excepción que los abrió.
\echo ''
\echo '--- Cupos ocupados sin cita (documento ambiguo) que se liberarían ---'
SELECT s.id AS slot, s."startTime", e.kind, e.status
  FROM "SyncException" e
  JOIN "ScheduleSlot" s
    ON s."organizationId" = e."organizationId"
   AND s."doctorId" = e."doctorId"
   AND s."startTime" = e."appointmentStartAt"
 WHERE e."organizationId" = (SELECT org FROM e2e_ctx)
   AND e.kind = 'IDENTIDAD_AMBIGUA'
   AND s."isAvailable" = false
   AND NOT EXISTS (SELECT 1 FROM "Appointment" a
                    WHERE a."scheduleSlotId" = s.id AND a.status <> 'CANCELLED');

\if :confirmo

BEGIN;

-- Nace entregado: sin esto, cada borrado encola un evento hacia el hospital.
SET LOCAL agenia.sync_origin = 'MIRROR';

DO $$
DECLARE v_vivas int;
BEGIN
  SELECT count(*) INTO v_vivas
    FROM "Appointment" a
    JOIN e2e_perfil p ON p.id = a."patientId"
   WHERE a.status <> 'CANCELLED';
  IF v_vivas > 0 THEN
    RAISE EXCEPTION 'Hay % cita(s) de prueba sin cancelar. Cancélelas en el panel primero: eso libera el cupo y deja constancia. No se borró nada.', v_vivas;
  END IF;
END $$;

-- 1) Liberar los cupos que quedaron ocupados sin cita (documento ambiguo).
UPDATE "ScheduleSlot" s
   SET "isAvailable" = true
 WHERE s.id IN (
   SELECT s2.id
     FROM "SyncException" e
     JOIN "ScheduleSlot" s2
       ON s2."organizationId" = e."organizationId"
      AND s2."doctorId" = e."doctorId"
      AND s2."startTime" = e."appointmentStartAt"
    WHERE e."organizationId" = (SELECT org FROM e2e_ctx)
      AND e.kind = 'IDENTIDAD_AMBIGUA'
      AND s2."isAvailable" = false
      AND NOT EXISTS (SELECT 1 FROM "Appointment" a
                       WHERE a."scheduleSlotId" = s2.id AND a.status <> 'CANCELLED')
 );

-- 2) Lo que cuelga de las citas, y las citas.
DELETE FROM "ClinicalRecord" WHERE "patientId" IN (SELECT id FROM e2e_perfil);
DELETE FROM "Appointment"    WHERE "patientId" IN (SELECT id FROM e2e_perfil);

-- 3) Los perfiles. `InformedConsent` y `WaitlistEntry` caen en cascada y
--    `ChatSurvey.patientId` queda en NULL (así está declarado el esquema).
DELETE FROM "PatientProfile" WHERE id IN (SELECT id FROM e2e_perfil);

-- 4) El `User` temporal que el alta le creó a cada paciente. Se borra DESPUÉS del
--    perfil, y solo si no le quedó nada colgando.
DELETE FROM "User" u
 WHERE u.id IN (SELECT "userId" FROM e2e_perfil WHERE "userId" IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM "PatientProfile" p WHERE p."userId" = u.id);

-- 5) La baja del D10: si no se borra, el documento no se puede volver a dar de alta
--    en la próxima prueba y el escenario daría un falso negativo.
DELETE FROM "MirrorPatientOptOut" o
 WHERE o."organizationId" = (SELECT org FROM e2e_ctx)
   AND o.document IN (SELECT doc FROM e2e_doc);

COMMIT;

\echo ''
\echo 'LIMPIO. Comprobación final (todo debe dar 0):'
SELECT count(*) AS perfiles_que_quedan
  FROM "PatientProfile" p
 WHERE p."organizationId" = (SELECT org FROM e2e_ctx)
   AND regexp_replace(p.cedula, '^0+', '') IN (SELECT doc FROM e2e_doc);

\else
\echo ''
\echo 'Nada borrado (confirmo = 0). Para borrar, repita con -v confirmo=1.'
\endif

DROP TABLE IF EXISTS e2e_perfil;
DROP TABLE IF EXISTS e2e_doc;
DROP TABLE IF EXISTS e2e_ctx;

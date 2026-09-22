-- ⛔ POSTGRESQL, la base de AgenIA. Si abrió esto en SSMS, CIÉRRELO: no es para el
--    SQL Server del hospital. Los `\set`, `CREATE TEMP TABLE` y `gen_random_uuid()`
--    de aquí abajo no existen en SQL Server y solo va a ver una lista de errores.
--    Lo que va en SSMS son los archivos SIN «POSTGRES» en el nombre.
-- =============================================================================
-- PRUEBAS E2E — 0. PREPARAR EL LADO DE AGENIA
--   · el padrón de prueba (21 documentos)
--   · y, si hace falta, la homologación del médico de la campaña
-- ⚠️ ESCRIBE, pero solo esas filas.
-- =============================================================================
--
-- 🚨 POR QUÉ NO SE USA LA PANTALLA DE IMPORTAR PADRÓN.
--
-- «Importar corte del padrón» **reemplaza** el padrón activo de esa EPS: todo
-- afiliado que no venga en el archivo queda `isActive = false` (`deactivateAbsent`
-- en `apps/web/app/dashboard/padron/padron-service.ts`). Subir un CSV de 19
-- documentos de prueba a Salud Total **desactivaría a sus 9.153 afiliados reales**,
-- y a partir de ese momento cualquier paciente de verdad que le escriba al bot
-- recibiría «su documento aún no figura dado de alta». La pantalla avisa cuando la
-- baja pasa del 10 %, pero el aviso se puede confirmar y seguir.
--
-- Este guion hace lo mínimo: inserta las 21 filas del padrón de prueba y nada más.
-- `EpsEnrolledPatient.importId` es NULL a propósito — el esquema lo documenta como
-- «alta manual» — y eso trae de regalo una red de seguridad: si alguien olvida la
-- limpieza, el siguiente corte real de esa EPS los desactiva por ausentes.
--
-- 🚨 Y POR QUÉ NO SE CREA UNA «EPS DE PRUEBA».
--
-- Porque el convenio de facturación se resuelve por NIT + régimen contra el
-- `mappingJson`, y con un NIT que no esté ahí `resolveConvenio` **lanza**
-- (`MappingIncompletoError`): ninguna reserva por WhatsApp llegaría al HIS y los
-- escenarios 12, 13 y 17 no se podrían probar. Los documentos de prueba tienen que
-- ir en una EPS REAL para que la cita se escriba con el convenio que de verdad usa
-- el hospital — que es justo lo que la PARTE 3 del guion de verificar comprueba.
--
-- CÓMO SE CORRE, en el VPS de AgenIA (89.117.61.28, /opt/agenia):
--
--   # 1) solo mirar: qué EPS hay y qué médicos están homologados
--   docker compose --env-file .env.production -f docker-compose.deploy.yml \
--     exec -T postgres psql -U agenia -d antigravity \
--     -v org=97f18182-d0d9-4a3b-9eb6-4fbc031b917c -v confirmo=0 \
--     < PRUEBAS_E2E_0_AGENIA_POSTGRES_PREPARAR.sql
--
--   # 2) escribir, con los ids que imprimió la PARTE 1
--   ... -v epsA=<ID-EPS-A> -v epsB=<ID-EPS-B> -v confirmo=1 < <este archivo>
--
-- Opcional, para homologar al médico de la campaña en la misma corrida:
--   -v medKey=AP04 -v medNombre='FABIO MARTINEZ CASTAÑO' -v medServicio='Consulta ambulatoria de medicina general'
--
-- Todo es IDEMPOTENTE: correrlo dos veces no duplica nada.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?org}
\else
  \set org 'FALTA-EL-ID-DE-LA-ORGANIZACION'
\endif
\if :{?epsA}
\else
  \set epsA ''
\endif
\if :{?epsB}
\else
  \set epsB ''
\endif
\if :{?confirmo}
\else
  \set confirmo 0
\endif
\if :{?medKey}
\else
  \set medKey ''
\endif
\if :{?medNombre}
\else
  \set medNombre ''
\endif
\if :{?medServicio}
\else
  \set medServicio ''
\endif

/* ── PARTE 1 — qué EPS hay, y cuánto padrón activo tiene cada una ───────────── */
\echo ''
\echo '=== EPS de esta clínica (de aquí salen los ids para -v epsA y -v epsB) ==='
SELECT e.id, e.name, e.nit, count(p.id) FILTER (WHERE p."isActive") AS activos
  FROM "Eps" e
  LEFT JOIN "EpsEnrolledPatient" p
    ON p."epsId" = e.id AND p."organizationId" = e."organizationId"
 WHERE e."organizationId" = :'org'
 GROUP BY e.id, e.name, e.nit
 ORDER BY e.name;

\echo ''
\echo '=== Médicos homologados, su servicio y sus cupos libres a futuro ==='
\echo '    (de aquí se ve si hace falta homologar al médico de la campaña:'
\echo '     PREPARAR necesita 4 cupos LIBRES el día de prueba)'
SELECT m."externalKey" AS his,
       d."fullName",
       d."whatsappBookingEnabled" AS wa,
       s.name AS servicio,
       count(sl.id) FILTER (WHERE sl."startTime" > now()) AS cupos_futuros,
       count(sl.id) FILTER (WHERE sl."startTime" > now() AND sl."isAvailable") AS libres
  FROM "MirrorEntityMap" m
  LEFT JOIN "DoctorProfile" d ON d.id = m."agenIAId"
  LEFT JOIN "MedicalService" s ON s.id = d."serviceId"
  LEFT JOIN "ScheduleSlot" sl ON sl."doctorId" = d.id
 WHERE m."organizationId" = :'org' AND m."entityType" = 'DOCTOR'
 GROUP BY m."externalKey", d."fullName", d."whatsappBookingEnabled", s.name
 ORDER BY libres DESC, m."externalKey";

/* ── PARTE 2 — los documentos de prueba y su EPS ─────────────────────────────
   Los mismos que los CSV de `padron/e2e/`: 19 en la EPS A y 2 en la EPS B (el 17
   y el 18, que sirven para probar el alcance del agendador y la lista de espera).
   El 20 NO está: su escenario es justamente «documento que el hospital tiene pero
   NO está en el padrón», así que darlo de alta lo rompería. */
DROP TABLE IF EXISTS e2e_padron;
DROP TABLE IF EXISTS e2e_ctx;
CREATE TEMP TABLE e2e_padron (cedula text PRIMARY KEY, grupo text, regimen text);
INSERT INTO e2e_padron (cedula, grupo, regimen) VALUES
  ('9990000001','A','SUBSIDIADO'),  ('9990000002','A','CONTRIBUTIVO'),
  ('9990000003','A','SUBSIDIADO'),  ('9990000004','A','CONTRIBUTIVO'),
  ('9990000005','A','SUBSIDIADO'),  ('9990000006','A','CONTRIBUTIVO'),
  ('9990000007','A','SUBSIDIADO'),  ('9990000008','A','CONTRIBUTIVO'),
  ('9990000009','A','SUBSIDIADO'),  ('9990000010','A','CONTRIBUTIVO'),
  ('9990000011','A','SUBSIDIADO'),  ('9990000012','A','CONTRIBUTIVO'),
  ('9990000013','A','SUBSIDIADO'),  ('9990000014','A','CONTRIBUTIVO'),
  ('9990000015','A','SUBSIDIADO'),  ('9990000016','A','CONTRIBUTIVO'),
  ('9990000019','A','SUBSIDIADO'),  ('9990000021','A','SUBSIDIADO'),
  ('9990000022','A','CONTRIBUTIVO'),
  ('9990000017','B','CONTRIBUTIVO'), ('9990000018','B','SUBSIDIADO');

\echo ''
\echo '=== Lo que se daría de alta ==='
SELECT grupo, count(*) AS cuantos FROM e2e_padron GROUP BY grupo ORDER BY grupo;

\if :confirmo

DROP TABLE IF EXISTS e2e_ctx;
CREATE TEMP TABLE e2e_ctx (org text, eps_a text, eps_b text);
INSERT INTO e2e_ctx VALUES (:'org', :'epsA', :'epsB');

-- psql NO sustituye :variables dentro de $$...$$, así que el contexto se lee de
-- la tabla temporal de arriba en vez de interpolarse aquí.
DO $$
DECLARE v_org text; v_a text; v_b text;
BEGIN
  SELECT org, eps_a, eps_b INTO v_org, v_a, v_b FROM e2e_ctx;
  IF NOT EXISTS (SELECT 1 FROM "Organization" WHERE id = v_org) THEN
    RAISE EXCEPTION 'No existe la organización %. Pase -v org=<id>.', v_org;
  END IF;
  IF v_a = '' OR v_b = '' THEN
    RAISE EXCEPTION 'Faltan -v epsA=<id> y -v epsB=<id>. La PARTE 1 los lista.';
  END IF;
  IF v_a = v_b THEN
    RAISE EXCEPTION 'epsA y epsB tienen que ser EPS distintas: los escenarios 17 y 18 prueban el alcance entre dos.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Eps" WHERE id = v_a AND "organizationId" = v_org AND "isActive") THEN
    RAISE EXCEPTION 'La EPS A (%) no existe en esta clínica o no está activa.', v_a;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Eps" WHERE id = v_b AND "organizationId" = v_org AND "isActive") THEN
    RAISE EXCEPTION 'La EPS B (%) no existe en esta clínica o no está activa.', v_b;
  END IF;
END $$;

/* ── PARTE 3 — homologar al médico de la campaña (solo si se pidió) ───────────
   Se necesita cuando ningún médico ya homologado tiene 4 cupos libres el día de
   prueba, que fue el caso el 2026-09-22: MDD2 y el 76 tenían la agenda llena y el
   único día con 4 libres de MDD1 caía a 50 días.

   La pantalla de homologación solo crea el ENLACE; el médico de AgenIA tiene que
   existir antes. Esto crea las tres filas que hacen falta —`User`, `DoctorProfile`
   y `MirrorEntityMap`— con ids deterministas para que repetirlo no duplique nada.

   El `serviceId` no es opcional: un médico sin servicio **no genera cupos**
   (`MirrorAvailabilityService` lo reporta en vez de inventarlo), y sin cupos el
   escenario 1 no se puede comprobar. */
DROP TABLE IF EXISTS e2e_med;
CREATE TEMP TABLE e2e_med (key text, nombre text, servicio text);
INSERT INTO e2e_med VALUES (:'medKey', :'medNombre', :'medServicio');

DO $$
DECLARE
  v_org text; v_key text; v_nombre text; v_servicio text;
  v_serviceId text; v_doctorId text; v_userId text;
BEGIN
  -- `DoctorProfile` tiene disparador de outbox: sin esto, crear el médico encolaría
  -- un evento hacia el hospital. Con origen MIRROR nace entregado y no viaja — y es
  -- lo correcto además, porque este médico existe porque el HIS lo tiene.
  PERFORM set_config('agenia.sync_origin', 'MIRROR', true);
  SELECT org INTO v_org FROM e2e_ctx;
  SELECT key, nombre, servicio INTO v_key, v_nombre, v_servicio FROM e2e_med;

  IF v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'Sin -v medKey: no se homologa ningún médico (solo el padrón).';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM "MirrorEntityMap"
              WHERE "organizationId" = v_org AND "entityType" = 'DOCTOR'
                AND "externalKey" = v_key) THEN
    RAISE NOTICE 'El médico % ya estaba homologado: no se toca nada.', v_key;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "MirrorCatalogEntry"
                  WHERE "organizationId" = v_org AND "entityType" = 'DOCTOR'
                    AND "externalKey" = v_key) THEN
    RAISE EXCEPTION 'El médico % no está en el catálogo que el agente trajo del HIS. Revise que el código sea el del HIS.', v_key;
  END IF;

  SELECT id INTO v_serviceId FROM "MedicalService"
   WHERE "organizationId" = v_org AND name = v_servicio;
  IF v_serviceId IS NULL THEN
    RAISE EXCEPTION 'No hay un servicio llamado "%" en esta clínica. Sin servicio el médico no genera cupos.', v_servicio;
  END IF;

  v_userId   := 'e2e-med-' || lower(v_key) || '-user';
  v_doctorId := 'e2e-med-' || lower(v_key) || '-doctor';

  INSERT INTO "User"(id, email, password, role, "organizationId", "updatedAt")
  VALUES (v_userId, 'e2e.' || lower(v_key) || '@medico.local', 'none', 'DOCTOR', v_org, now())
  ON CONFLICT (id) DO NOTHING;

  -- La cédula 999… lo marca como dato de prueba, igual que los pacientes.
  --
  -- `medicalLicense` NO puede ir vacío: hay un índice ÚNICO en
  -- (organizationId, medicalLicense) y algún médico ya tiene la cadena vacía, así
  -- que un '' aquí reventaría con «duplicate key». Se le pone uno derivado del
  -- código del HIS, que además deja claro que es un médico de la campaña.
  INSERT INTO "DoctorProfile"(id, cedula, "fullName", "medicalLicense", phone, "isActive",
                              "serviceId", "userId", "organizationId",
                              "whatsappBookingEnabled", "isFunctionalAgenda",
                              "createdAt", "updatedAt")
  VALUES (v_doctorId,
          '999' || lpad((abs(hashtext(v_key)) % 10000000)::text, 7, '0'),
          COALESCE(NULLIF(v_nombre, ''), v_key),
          'E2E-' || upper(v_key), '', true, v_serviceId, v_userId, v_org,
          true, false, now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "MirrorEntityMap"(id, "entityType", "agenIAId", "externalKey", "externalLabel",
                                "organizationId", "updatedAt")
  VALUES ('e2e-med-' || lower(v_key) || '-map', 'DOCTOR', v_doctorId, v_key,
          COALESCE(NULLIF(v_nombre, ''), v_key), v_org, now())
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Médico % homologado (servicio "%"). Los cupos los generará el agente en su próxima pasada de agenda.', v_key, v_servicio;
END $$;

BEGIN;

-- `importId` NULL = alta manual (lo dice el esquema). Así estas filas no cuelgan de
-- ningún corte y no alteran el reemplazo del padrón real.
INSERT INTO "EpsEnrolledPatient" (id, cedula, regime, "isActive", "epsId", "importId",
                                  "organizationId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d.cedula, d.regimen, true,
       CASE d.grupo WHEN 'A' THEN :'epsA' ELSE :'epsB' END, NULL,
       :'org', now(), now()
  FROM e2e_padron d
ON CONFLICT ("organizationId", "epsId", cedula) DO UPDATE
   SET "isActive" = true, "updatedAt" = now();

COMMIT;

\echo ''
\echo 'LISTO. Comprobación (deben ser 19 en la A y 2 en la B):'
SELECT e.name AS eps,
       count(*) AS dados_de_alta
  FROM "EpsEnrolledPatient" p
  JOIN "Eps" e ON e.id = p."epsId"
 WHERE p."organizationId" = :'org'
   AND p."isActive"
   AND p.cedula IN (SELECT cedula FROM e2e_padron)
 GROUP BY e.name
 ORDER BY e.name;

\else
\echo ''
\echo 'Nada escrito (confirmo = 0). Repita con -v epsA=<id> -v epsB=<id> -v confirmo=1.'
\endif

DROP TABLE IF EXISTS e2e_padron;
DROP TABLE IF EXISTS e2e_ctx;
DROP TABLE IF EXISTS e2e_med;

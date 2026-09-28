-- ═════════════════════════════════════════════════════════════════════════════
-- Rellena el régimen de los pacientes que lo tienen vacío, desde el padrón de su EPS.
-- Base: AgenIA (Postgres). NO es para el SQL Server del hospital.
--
-- Por qué: el HIS nunca manda el régimen y el alta en caliente creaba al paciente sin
-- él; su siguiente cita por WhatsApp no llegaba al hospital (caso del 2026-09-26). El
-- código ya lo hereda del padrón al crear o reutilizar al paciente
-- (`afiliacionDelPadron` / `huecosQueRellenaElPadron` en @agenia/shared). Este script
-- aplica LA MISMA regla a los que ya existían:
--   · el documento está activo en UNA sola EPS del padrón (con o sin ceros);
--   · las filas de esa EPS dan UN solo régimen válido (SUBSIDIADO/CONTRIBUTIVO);
--   · la ficha no tiene EPS, o tiene justo esa (con otra, sería otra afiliación).
-- Nunca pisa un régimen ya puesto.
--
-- Uso: `./tunnel.sh` y psql contra localhost:15432, o
--   ssh root@89.117.61.28 "docker exec -i agenia_db sh -c 'psql -v ON_ERROR_STOP=1 -U \$POSTGRES_USER -d \$POSTGRES_DB'" < este_archivo
-- Medido el 2026-09-28 (solo lectura): 121 pacientes a rellenar (96 SUBSIDIADO,
-- 25 CONTRIBUTIVO), todos con la misma EPS en su ficha; 41 más sin régimen y sin
-- padrón quedan igual (el bot se lo pregunta al agendar).
-- ═════════════════════════════════════════════════════════════════════════════

-- 1) SIMULACRO: qué haría, sin escribir nada.
WITH filas AS (
  SELECT p.id, p."epsId" AS eps_perfil, ep."epsId" AS eps_padron,
         nullif(upper(trim(ep.regime)), '') AS reg
  FROM "PatientProfile" p
  JOIN "EpsEnrolledPatient" ep
    ON ep."organizationId" = p."organizationId" AND ep."isActive"
   AND ep.cedula IN (p.cedula, regexp_replace(p.cedula, '^0+', ''))
  WHERE p.regime IS NULL
), por_paciente AS (
  SELECT id, eps_perfil,
         count(DISTINCT eps_padron) AS n_eps, min(eps_padron) AS eps_padron,
         count(DISTINCT reg) FILTER (WHERE reg IN ('SUBSIDIADO','CONTRIBUTIVO')) AS n_reg,
         min(reg) FILTER (WHERE reg IN ('SUBSIDIADO','CONTRIBUTIVO')) AS reg
  FROM filas GROUP BY id, eps_perfil
), relleno AS (
  SELECT id, eps_perfil, eps_padron, reg,
         CASE WHEN n_eps <> 1 THEN 'VARIAS_EPS'
              WHEN n_reg <> 1 THEN 'REGIMEN_DUDOSO'
              WHEN eps_perfil IS NOT NULL AND eps_perfil <> eps_padron THEN 'OTRA_EPS'
              ELSE 'RELLENAR' END AS decision
  FROM por_paciente
)
SELECT decision, reg, (eps_perfil IS NULL) AS sin_eps_en_ficha, count(*) FROM relleno GROUP BY 1,2,3 ORDER BY 1,2;

-- 2) APLICAR. Ajuste :'esperados' al número de RELLENAR del simulacro: si no coincide,
--    la transacción se aborta y no queda nada escrito.
\set esperados 121
BEGIN;
CREATE TEMP TABLE aplicado AS
WITH filas AS (
  SELECT p.id, p."epsId" AS eps_perfil, ep."epsId" AS eps_padron,
         nullif(upper(trim(ep.regime)), '') AS reg
  FROM "PatientProfile" p
  JOIN "EpsEnrolledPatient" ep
    ON ep."organizationId" = p."organizationId" AND ep."isActive"
   AND ep.cedula IN (p.cedula, regexp_replace(p.cedula, '^0+', ''))
  WHERE p.regime IS NULL
), por_paciente AS (
  SELECT id, eps_perfil,
         count(DISTINCT eps_padron) AS n_eps, min(eps_padron) AS eps_padron,
         count(DISTINCT reg) FILTER (WHERE reg IN ('SUBSIDIADO','CONTRIBUTIVO')) AS n_reg,
         min(reg) FILTER (WHERE reg IN ('SUBSIDIADO','CONTRIBUTIVO')) AS reg
  FROM filas GROUP BY id, eps_perfil
), relleno AS (
  SELECT id, eps_perfil, eps_padron, reg,
         CASE WHEN n_eps <> 1 THEN 'VARIAS_EPS'
              WHEN n_reg <> 1 THEN 'REGIMEN_DUDOSO'
              WHEN eps_perfil IS NOT NULL AND eps_perfil <> eps_padron THEN 'OTRA_EPS'
              ELSE 'RELLENAR' END AS decision
  FROM por_paciente
)
, upd AS (
  UPDATE "PatientProfile" p
     SET regime = r.reg,
         "epsId" = coalesce(p."epsId", r.eps_padron),
         "updatedAt" = now() AT TIME ZONE 'utc'
    FROM relleno r
   WHERE p.id = r.id AND r.decision = 'RELLENAR' AND p.regime IS NULL
  RETURNING p.id, p.regime
)
SELECT * FROM upd;
SELECT count(*) = :esperados AS coincide FROM aplicado \gset
\if :coincide
  SELECT regime, count(*) FROM aplicado GROUP BY 1;
  COMMIT;
\else
  \echo 'El número de filas no coincide con el simulacro: se deshace todo.'
  ROLLBACK;
\endif

-- 3) Comprobación.
SELECT count(*) AS sin_regimen_ahora FROM "PatientProfile" WHERE regime IS NULL;

/* =============================================================================
   ¿TIENE AGENIA TODAS LAS CITAS DE MEDICINA GENERAL (S39141)? — cruce con el HIS
   Base objetivo: ESEHSVP — SOLO LECTURA (solo SELECT; no cambia nada)
   =============================================================================

   PARA QUÉ (2026-10-20)
   La reconciliación diaria dice «296 citas que AgenIA desconoce». AgenIA solo
   trabaja con medicina general (S39141): esto cuenta, médico por médico, las
   citas S39141 que tiene el hospital para compararlas con las de AgenIA, y dice
   de qué servicio son las de los médicos que más aparecen en esa lista.

   AgenIA, el 2026-10-20 a las 08:30, para la misma ventana (21-oct a 17-ene):
       077 = 2   76 = 9   77 = 19   AP08 = 2   MD08 = 4   MD09 = 5   RU65 = 1
       Total 42. (Cambia a lo largo del día con las citas nuevas.)

   ESPERADO
     · Parte 1: los mismos números por médico. Un médico que aquí tenga más
       citas que en AgenIA es una cita de medicina general que AgenIA no ve.
       `sin_documento` debe ser 0: una cita sin documento no se puede traer.
     · Parte 2: las citas de 77, ES01 y ES09 son de OTROS servicios.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

/* ── 1. Citas de medicina general (S39141) por médico ─────────────────────── */
SELECT LTRIM(RTRIM(c.CD_CODI_MED_CIT)) AS medico,
       COUNT(*) AS citas,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(c.NU_HIST_PAC_CIT)), '') IS NULL THEN 1 ELSE 0 END) AS sin_documento,
       SUM(CASE WHEN c.NU_ESTA_CIT <> 0 THEN 1 ELSE 0 END) AS estado_no_0
  FROM dbo.CITAS_MEDICAS c
 WHERE LTRIM(RTRIM(c.CD_CODI_SER_CIT)) = 'S39141'
   AND c.FE_FECH_CIT >= '20261021' AND c.FE_FECH_CIT < '20270118'
 GROUP BY LTRIM(RTRIM(c.CD_CODI_MED_CIT))
 ORDER BY medico;
GO

/* ── 2. ¿De qué servicio son las citas de 77, ES01 y ES09? ──────────────────── */
SELECT LTRIM(RTRIM(c.CD_CODI_MED_CIT)) AS medico,
       LTRIM(RTRIM(c.CD_CODI_SER_CIT)) AS servicio,
       s.NO_NOMB_SER AS nombre_servicio,
       COUNT(*) AS citas
  FROM dbo.CITAS_MEDICAS c
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
 WHERE LTRIM(RTRIM(c.CD_CODI_MED_CIT)) IN ('77', 'ES01', 'ES09')
   AND c.FE_FECH_CIT >= '20261021' AND c.FE_FECH_CIT < '20270118'
 GROUP BY LTRIM(RTRIM(c.CD_CODI_MED_CIT)), LTRIM(RTRIM(c.CD_CODI_SER_CIT)), s.NO_NOMB_SER
 ORDER BY medico, citas DESC;
GO

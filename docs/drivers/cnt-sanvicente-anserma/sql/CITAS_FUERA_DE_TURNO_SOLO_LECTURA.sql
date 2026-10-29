/* =============================================================================
   ¿CUÁNTAS CITAS DEL HOSPITAL CAEN FUERA DE LOS TURNOS DE SUS MÉDICOS?
   Base objetivo: ESEHSVP — SOLO LECTURA (solo SELECT; no cambia nada)
   =============================================================================

   Contexto (2026-10-29): el hospital explicó que crea citas «temporales» a nombre
   de personas al azar para guardar cupos de Nueva EPS, que se manejan a mano. Las
   que vimos caían en días u horas sin turno del médico. AgenIA no debería enviarles
   recordatorio ni tratarlas como citas normales.

   Para cada cita viva (NU_ESTA_CIT = 0) de hoy a 14 días:
     · DENTRO del turno, FUERA porque el médico no tiene turno ese día, FUERA porque
       la hora no cae en ningún turno del día, o FICHA (sin hora, programas).
     · «recordatorio_agenia» = SI si hoy AgenIA le enviaría recordatorio: médico con
       WhatsApp encendido en AgenIA y servicio de medicina general (S39141).

   Bloques:
     1. Resumen por clase.
     2. Las de FUERA, por médico y día.
     3. Detalle de las de FUERA a las que AgenIA les enviaría recordatorio, con
        quién las creó o movió (tabla AUDITOR, en el mismo minuto).

   Pegar el resultado de los tres bloques en el chat.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

/* ── 1. Resumen por clase ─────────────────────────────────────────────────────── */
WITH citas AS (
  SELECT RTRIM(c.CD_CODI_MED_CIT) AS med,
         CAST(c.FE_FECH_CIT AS date) AS fecha,
         CONVERT(varchar(5), TRY_CONVERT(time(0), LTRIM(RTRIM(SUBSTRING(c.FE_HORA_CIT, 11, 10)))), 108) AS hora,
         RTRIM(c.CD_CODI_SER_CIT) AS servicio
    FROM dbo.CITAS_MEDICAS c
   WHERE c.FE_FECH_CIT >= CAST(GETDATE() AS date)
     AND c.FE_FECH_CIT < DATEADD(day, 15, CAST(GETDATE() AS date))
     AND c.NU_ESTA_CIT = 0
),
clas AS (
  SELECT x.*,
         CASE
           WHEN x.hora IS NULL THEN 'FICHA (sin hora)'
           WHEN NOT EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                             WHERE t.CD_MED_TUME = x.med AND CAST(t.FE_FECH_TUME AS date) = x.fecha
                               AND t.ID_DISP_TUME = '1')
             THEN 'FUERA: el médico no tiene turno ese día'
           WHEN NOT EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                             WHERE t.CD_MED_TUME = x.med AND CAST(t.FE_FECH_TUME AS date) = x.fecha
                               AND t.ID_DISP_TUME = '1'
                               AND CONVERT(varchar(5), t.FE_HOIN_TUME, 108) <= x.hora
                               AND x.hora < CONVERT(varchar(5), t.FE_HOFI_TUME, 108))
             THEN 'FUERA: la hora no cae en ningún turno del día'
           ELSE 'DENTRO del turno'
         END AS clase,
         CASE WHEN x.med IN ('077','149','76','77','AP08','MD08','MD09','R001',
                             'RU62','RU65','RU66','RU67','RU68','RU70','RU71')
                   AND x.servicio = 'S39141'
              THEN 'SI' ELSE 'no' END AS recordatorio_agenia
    FROM citas x
)
SELECT clase, recordatorio_agenia, COUNT(*) AS citas
  FROM clas
 GROUP BY clase, recordatorio_agenia
 ORDER BY clase, recordatorio_agenia;
GO

/* ── 2. Las de FUERA, por médico y día ───────────────────────────────────────── */
WITH citas AS (
  SELECT RTRIM(c.CD_CODI_MED_CIT) AS med,
         CAST(c.FE_FECH_CIT AS date) AS fecha,
         CONVERT(varchar(5), TRY_CONVERT(time(0), LTRIM(RTRIM(SUBSTRING(c.FE_HORA_CIT, 11, 10)))), 108) AS hora,
         RTRIM(c.CD_CODI_SER_CIT) AS servicio
    FROM dbo.CITAS_MEDICAS c
   WHERE c.FE_FECH_CIT >= CAST(GETDATE() AS date)
     AND c.FE_FECH_CIT < DATEADD(day, 15, CAST(GETDATE() AS date))
     AND c.NU_ESTA_CIT = 0
),
fuera AS (
  SELECT x.*,
         CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                                WHERE t.CD_MED_TUME = x.med AND CAST(t.FE_FECH_TUME AS date) = x.fecha
                                  AND t.ID_DISP_TUME = '1')
              THEN 'sin turno ese día' ELSE 'hora fuera del turno' END AS por_que
    FROM citas x
   WHERE x.hora IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                      WHERE t.CD_MED_TUME = x.med AND CAST(t.FE_FECH_TUME AS date) = x.fecha
                        AND t.ID_DISP_TUME = '1'
                        AND CONVERT(varchar(5), t.FE_HOIN_TUME, 108) <= x.hora
                        AND x.hora < CONVERT(varchar(5), t.FE_HOFI_TUME, 108))
)
SELECT f.med, RTRIM(m.NO_NOMB_MED) AS medico, f.fecha, DATENAME(weekday, f.fecha) AS dia,
       f.por_que, COUNT(*) AS citas,
       MIN(f.hora) AS desde, MAX(f.hora) AS hasta,
       STRING_AGG(f.servicio, ',') WITHIN GROUP (ORDER BY f.hora) AS servicios
  FROM fuera f
  LEFT JOIN dbo.MEDICOS m ON RTRIM(m.CD_CODI_MED) = f.med
 GROUP BY f.med, RTRIM(m.NO_NOMB_MED), f.fecha, f.por_que
 ORDER BY f.fecha, f.med;
GO

/* ── 3. Las de FUERA a las que AgenIA les enviaría recordatorio, y quién las hizo ─ */
WITH citas AS (
  SELECT RTRIM(c.CD_CODI_MED_CIT) AS med,
         CAST(c.FE_FECH_CIT AS date) AS fecha,
         CONVERT(varchar(5), TRY_CONVERT(time(0), LTRIM(RTRIM(SUBSTRING(c.FE_HORA_CIT, 11, 10)))), 108) AS hora,
         RTRIM(c.CD_CODI_SER_CIT) AS servicio,
         RIGHT(RTRIM(c.NU_HIST_PAC_CIT), 4) AS doc4,
         c.FE_ELAB_CIT AS elaborada
    FROM dbo.CITAS_MEDICAS c
   WHERE c.FE_FECH_CIT >= CAST(GETDATE() AS date)
     AND c.FE_FECH_CIT < DATEADD(day, 15, CAST(GETDATE() AS date))
     AND c.NU_ESTA_CIT = 0
     AND RTRIM(c.CD_CODI_SER_CIT) = 'S39141'
     AND RTRIM(c.CD_CODI_MED_CIT) IN ('077','149','76','77','AP08','MD08','MD09','R001',
                                      'RU62','RU65','RU66','RU67','RU68','RU70','RU71')
)
SELECT x.med, x.fecha, x.hora, x.servicio, x.doc4, x.elaborada,
       a.AudUser AS creada_o_movida_por, a.AudTrans AS tipo
  FROM citas x
  OUTER APPLY (
    SELECT TOP 1 au.AudUser, au.AudTrans
      FROM dbo.AUDITOR au
     WHERE au.AudTabla = 'CITAS_MEDICAS' AND au.AudTrans IN ('1', '2')
       AND au.AudFech BETWEEN DATEADD(minute, -1, x.elaborada) AND DATEADD(minute, 1, x.elaborada)
     ORDER BY ABS(DATEDIFF(second, au.AudFech, x.elaborada))
  ) a
 WHERE x.hora IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                    WHERE t.CD_MED_TUME = x.med AND CAST(t.FE_FECH_TUME AS date) = x.fecha
                      AND t.ID_DISP_TUME = '1'
                      AND CONVERT(varchar(5), t.FE_HOIN_TUME, 108) <= x.hora
                      AND x.hora < CONVERT(varchar(5), t.FE_HOFI_TUME, 108))
 ORDER BY x.fecha, x.hora;
GO

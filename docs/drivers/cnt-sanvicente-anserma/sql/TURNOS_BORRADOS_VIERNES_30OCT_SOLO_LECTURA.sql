/* =============================================================================
   ¿POR QUÉ EL VIERNES 30-OCT NO TIENEN TURNO RU66 Y RU70, SI TIENEN CITAS?
   Base objetivo: ESEHSVP — SOLO LECTURA (solo SELECT; no cambia nada)
   =============================================================================

   Lo que mostró CRUCE_CITAS_29_30_OCT_SOLO_LECTURA.sql (2026-10-29):
     · El HIS tiene 14 citas vivas de RU66 (ANDREA OSORIO GONZALEZ) y 6 de RU70
       (SANTIAGO CARDENAS GUEVARA) el viernes 30-oct (16 del hospital, 4 del
       WhatsApp), y ninguna fue anulada.
     · Pero en TURNOS_MEDICOS no hay NINGUNA fila de esos dos médicos ese día,
       ni siquiera marcada como no disponible: el turno se borró.
     · AgenIA vio desaparecer el turno el jueves 29 entre las 07:55 y las 08:37
       (a las 07:51 el HIS aceptó una cita de RU70 para ese viernes; a las 08:37
       rechazó otra con «no tiene turno»). En ese momento las dos agendas del
       viernes estaban LLENAS.

   Dos explicaciones posibles, y cambian lo que hay que hacer:
     A. Los médicos no atienden el viernes  → hay que mover o anular las 20
        citas (no solo las 4 del WhatsApp).
     B. El hospital borra el turno para «cerrar» una agenda llena (o por otra
        razón administrativa) y los médicos SÍ atienden → no se anula nada.

   Bloques:
     1. Quién y cuándo tocó TURNOS_MEDICOS el 28 y el 29 (tabla AUDITOR).
     2. ¿Pasa seguido? Días de los últimos 90 en que un médico tuvo citas SIN
        turno ese día, y si esas citas se atendieron (NU_ESTA_CIT = 1).
     3. El detalle de esos días para RU66, RU70 y los demás RU.
     4. Ahora mismo: días de los próximos 14 con citas vivas y SIN turno.

   Pegar el resultado de los cuatro bloques (o una foto) en el chat.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

/* ── 1a. Lo que se hizo sobre los turnos el 28 y el 29, por hora ────────────────
   AudTrans: 1 = alta, 2 = cambio, 3 = borrado. */
SELECT CONVERT(varchar(13), AudFech, 120) AS hora, AudTabla AS tabla, AudTrans AS tipo,
       AudUser AS usuario, COUNT(*) AS veces
  FROM dbo.AUDITOR
 WHERE AudFech >= '20261028' AND AudFech < '20261030'
   AND AudTabla LIKE '%TURNO%'
 GROUP BY CONVERT(varchar(13), AudFech, 120), AudTabla, AudTrans, AudUser
 ORDER BY hora, tabla, tipo;
GO

/* ── 1b. El detalle del jueves 29 de 07:00 a 10:00 (cuando desapareció) ──────── */
SELECT TOP 100 AudFech AS cuando, AudUser AS usuario, AudTabla AS tabla, AudTrans AS tipo,
       CAST(AudDesc AS varchar(2000)) AS que
  FROM dbo.AUDITOR
 WHERE AudFech >= '20261029 07:00' AND AudFech < '20261029 10:00'
   AND AudTabla LIKE '%TURNO%'
 ORDER BY AudFech;
GO

/* ── 1c. Cualquier registro de AUDITOR del 28 y 29 que nombre a RU66 o RU70 ─────
   (AudDesc es texto libre: si el HIS escribe el código del médico, aparece aquí). */
SELECT TOP 200 AudFech AS cuando, AudUser AS usuario, AudTabla AS tabla, AudTrans AS tipo,
       CAST(AudDesc AS varchar(2000)) AS que
  FROM dbo.AUDITOR
 WHERE AudFech >= '20261028' AND AudFech < '20261030'
   AND (AudDesc LIKE '%RU66%' OR AudDesc LIKE '%RU70%')
 ORDER BY AudFech;
GO

/* ── 2. ¿Pasa seguido? Últimos 90 días, citas en días CON y SIN turno ───────────
   Si los días sin turno tienen muchas citas ATENDIDAS (estado 1), borrar el
   turno no significa que el médico no vino: es la explicación B. */
WITH dias AS (
  SELECT RTRIM(c.CD_CODI_MED_CIT) AS med, CAST(c.FE_FECH_CIT AS date) AS fecha,
         COUNT(*) AS citas,
         SUM(CASE WHEN c.NU_ESTA_CIT = 1 THEN 1 ELSE 0 END) AS atendidas
    FROM dbo.CITAS_MEDICAS c
   WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
     AND c.FE_FECH_CIT < CAST(GETDATE() AS date)
   GROUP BY RTRIM(c.CD_CODI_MED_CIT), CAST(c.FE_FECH_CIT AS date)
)
SELECT CASE WHEN LEFT(d.med, 2) = 'RU' THEN 'médicos RU' ELSE 'demás médicos' END AS grupo,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                          WHERE t.CD_MED_TUME = d.med AND CAST(t.FE_FECH_TUME AS date) = d.fecha)
            THEN 'CON turno' ELSE 'SIN turno' END AS dia,
       COUNT(*) AS dias_medico, SUM(d.citas) AS citas, SUM(d.atendidas) AS atendidas,
       CAST(100.0 * SUM(d.atendidas) / NULLIF(SUM(d.citas), 0) AS decimal(5, 1)) AS pct_atendidas
  FROM dias d
 GROUP BY CASE WHEN LEFT(d.med, 2) = 'RU' THEN 'médicos RU' ELSE 'demás médicos' END,
          CASE WHEN EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                             WHERE t.CD_MED_TUME = d.med AND CAST(t.FE_FECH_TUME AS date) = d.fecha)
               THEN 'CON turno' ELSE 'SIN turno' END
 ORDER BY grupo, dia;
GO

/* ── 3. El detalle de los días SIN turno de los médicos RU (últimos 90 días) ──── */
WITH dias AS (
  SELECT RTRIM(c.CD_CODI_MED_CIT) AS med, CAST(c.FE_FECH_CIT AS date) AS fecha,
         COUNT(*) AS citas,
         SUM(CASE WHEN c.NU_ESTA_CIT = 1 THEN 1 ELSE 0 END) AS atendidas
    FROM dbo.CITAS_MEDICAS c
   WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
     AND c.FE_FECH_CIT < CAST(GETDATE() AS date)
     AND c.CD_CODI_MED_CIT LIKE 'RU%'
   GROUP BY RTRIM(c.CD_CODI_MED_CIT), CAST(c.FE_FECH_CIT AS date)
)
SELECT TOP 60 d.med, d.fecha, DATENAME(weekday, d.fecha) AS dia_semana, d.citas, d.atendidas
  FROM dias d
 WHERE NOT EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                    WHERE t.CD_MED_TUME = d.med AND CAST(t.FE_FECH_TUME AS date) = d.fecha)
 ORDER BY d.fecha DESC, d.med;
GO

/* ── 4. Ahora mismo: próximos 14 días con citas vivas y SIN turno ──────────────── */
WITH dias AS (
  SELECT RTRIM(c.CD_CODI_MED_CIT) AS med, CAST(c.FE_FECH_CIT AS date) AS fecha,
         COUNT(*) AS citas
    FROM dbo.CITAS_MEDICAS c
   WHERE c.FE_FECH_CIT >= CAST(GETDATE() AS date)
     AND c.FE_FECH_CIT < DATEADD(day, 15, CAST(GETDATE() AS date))
     AND c.NU_ESTA_CIT = 0
   GROUP BY RTRIM(c.CD_CODI_MED_CIT), CAST(c.FE_FECH_CIT AS date)
)
SELECT d.med, RTRIM(m.NO_NOMB_MED) AS medico, d.fecha, DATENAME(weekday, d.fecha) AS dia_semana, d.citas
  FROM dias d
  LEFT JOIN dbo.MEDICOS m ON RTRIM(m.CD_CODI_MED) = d.med
 WHERE NOT EXISTS (SELECT 1 FROM dbo.TURNOS_MEDICOS t
                    WHERE t.CD_MED_TUME = d.med AND CAST(t.FE_FECH_TUME AS date) = d.fecha)
 ORDER BY d.fecha, d.med;
GO

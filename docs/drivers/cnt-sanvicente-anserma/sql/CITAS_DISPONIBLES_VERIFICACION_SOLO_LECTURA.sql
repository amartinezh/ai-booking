/* =============================================================================
   CITAS_DISPONIBLES — ¿ESTÁ AL DÍA Y CUADRA? — ESTRICTAMENTE SOLO LECTURA
   Base objetivo: ESEHSVP
   =============================================================================

   La corrida del 2026-10-06 (DURACION_AGENDAS_2) mostró que `CITAS_DISPONIBLES`
   guarda los HUECOS LIBRES de cada turno (turno `NU_TUME_CIDI`, médico, fecha,
   hora inicio/fin del hueco y su duración en minutos). Si el HIS la mantiene
   al día, AgenIA puede ofrecer exactamente lo que el hospital ve libre, con la
   duración de cualquier servicio, sin calcular rejillas.

   Antes de apostar por ella hay que saber:
     1) si tiene datos a FUTURO (la muestra salió de 2015),
     2) si CUADRA: minutos del turno = minutos de citas + minutos libres,
     3) cómo se ve un día real de dos agendas difíciles (MD08 y PS08),
     4) qué índices tiene (para no leerla entera en cada vuelta),
     5) si las citas "sin hora" (FE_HORA_CIT = 'YYYY/MM/DD N') existen a futuro.

   GARANTÍAS: solo SELECT, READ UNCOMMITTED, todo acotado por fecha. De
   CITAS_MEDICAS solo médico, hora, duración, estado y servicio.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
GO

-- =============================================================================
-- 1) ¿HAY DATOS A FUTURO? Rango y volumen por mes desde hoy.
-- =============================================================================
DECLARE @hoy date = CAST(GETDATE() AS date);

SELECT MIN(FE_FECH_CIDI) AS primera_fecha, MAX(FE_FECH_CIDI) AS ultima_fecha,
       SUM(CASE WHEN FE_FECH_CIDI >= @hoy THEN 1 ELSE 0 END) AS filas_desde_hoy
  FROM dbo.CITAS_DISPONIBLES;

SELECT CONVERT(varchar(7), FE_FECH_CIDI, 120) AS mes,
       COUNT(*) AS huecos, COUNT(DISTINCT CD_MED_CIDI) AS medicos,
       SUM(NU_DURA_CIDI) AS minutos_libres
  FROM dbo.CITAS_DISPONIBLES
 WHERE FE_FECH_CIDI >= @hoy
 GROUP BY CONVERT(varchar(7), FE_FECH_CIDI, 120)
 ORDER BY mes;
GO

-- =============================================================================
-- 2) ¿CUADRA? Para cada turno de las agendas homologadas en los próximos 14
--    días: minutos del turno vs. minutos ocupados por citas (con su duración)
--    + minutos libres según CITAS_DISPONIBLES. `diferencia` = 0 → cuadra.
--    Si cuadra en ~100 % de los turnos, la tabla está al día y es confiable.
-- =============================================================================
DECLARE @hoy date = CAST(GETDATE() AS date);
DECLARE @hasta date = DATEADD(day, 14, @hoy);

;WITH turnos AS (
    SELECT NU_NUME_TUME AS turno, CD_MED_TUME AS med, CAST(FE_FECH_TUME AS date) AS dia,
           CAST(FE_HOIN_TUME AS time) AS ini, CAST(FE_HOFI_TUME AS time) AS fin,
           DATEDIFF(minute, CAST(FE_HOIN_TUME AS time), CAST(FE_HOFI_TUME AS time)) AS min_turno
      FROM dbo.TURNOS_MEDICOS
     WHERE FE_FECH_TUME >= @hoy AND FE_FECH_TUME < @hasta
       AND ISNULL(NU_TIPO_TUME, 0) = 0 AND ISNULL(ID_DISP_TUME, '1') = '1'
       AND CD_MED_TUME IN ('AP04','MDD1','MDD2','76','91-1','91-2','ACO2','HO02','HO03',
                           'HO04','MD08','NU02','OD02','OD05','OD07','PS06','PS08','R001')
),
citas AS (
    SELECT CD_CODI_MED_CIT AS med, CAST(FE_FECH_CIT AS date) AS dia,
           CAST(TRY_CONVERT(datetime, REPLACE(LEFT(FE_HORA_CIT, 16), '/', '-'), 120) AS time) AS hora,
           NU_DURA_CIT AS dura
      FROM dbo.CITAS_MEDICAS
     WHERE FE_FECH_CIT >= @hoy AND FE_FECH_CIT < @hasta
),
ocupado AS (
    SELECT t.turno, SUM(ISNULL(c.dura, 0)) AS min_citas, COUNT(c.hora) AS n_citas
      FROM turnos t
      LEFT JOIN citas c ON c.med = t.med AND c.dia = t.dia
                       AND c.hora >= t.ini AND c.hora < t.fin
     GROUP BY t.turno
),
libre AS (
    SELECT NU_TUME_CIDI AS turno, SUM(NU_DURA_CIDI) AS min_libres, COUNT(*) AS n_huecos
      FROM dbo.CITAS_DISPONIBLES
     WHERE FE_FECH_CIDI >= @hoy AND FE_FECH_CIDI < @hasta
     GROUP BY NU_TUME_CIDI
)
SELECT t.med, t.dia, t.turno, t.ini, t.fin, t.min_turno,
       o.n_citas, o.min_citas, ISNULL(l.n_huecos, 0) AS n_huecos,
       ISNULL(l.min_libres, 0) AS min_libres,
       t.min_turno - o.min_citas - ISNULL(l.min_libres, 0) AS diferencia
  FROM turnos t
  JOIN ocupado o ON o.turno = t.turno
  LEFT JOIN libre l ON l.turno = t.turno
 ORDER BY ABS(t.min_turno - o.min_citas - ISNULL(l.min_libres, 0)) DESC, t.med, t.dia;
GO

-- 2b) Resumen del bloque 2: cuántos turnos cuadran exacto, por médico.
DECLARE @hoy date = CAST(GETDATE() AS date);
DECLARE @hasta date = DATEADD(day, 14, @hoy);

;WITH turnos AS (
    SELECT NU_NUME_TUME AS turno, CD_MED_TUME AS med, CAST(FE_FECH_TUME AS date) AS dia,
           CAST(FE_HOIN_TUME AS time) AS ini, CAST(FE_HOFI_TUME AS time) AS fin,
           DATEDIFF(minute, CAST(FE_HOIN_TUME AS time), CAST(FE_HOFI_TUME AS time)) AS min_turno
      FROM dbo.TURNOS_MEDICOS
     WHERE FE_FECH_TUME >= @hoy AND FE_FECH_TUME < @hasta
       AND ISNULL(NU_TIPO_TUME, 0) = 0 AND ISNULL(ID_DISP_TUME, '1') = '1'
       AND CD_MED_TUME IN ('AP04','MDD1','MDD2','76','91-1','91-2','ACO2','HO02','HO03',
                           'HO04','MD08','NU02','OD02','OD05','OD07','PS06','PS08','R001')
),
citas AS (
    SELECT CD_CODI_MED_CIT AS med, CAST(FE_FECH_CIT AS date) AS dia,
           CAST(TRY_CONVERT(datetime, REPLACE(LEFT(FE_HORA_CIT, 16), '/', '-'), 120) AS time) AS hora,
           NU_DURA_CIT AS dura
      FROM dbo.CITAS_MEDICAS
     WHERE FE_FECH_CIT >= @hoy AND FE_FECH_CIT < @hasta
),
ocupado AS (
    SELECT t.turno, SUM(ISNULL(c.dura, 0)) AS min_citas
      FROM turnos t
      LEFT JOIN citas c ON c.med = t.med AND c.dia = t.dia
                       AND c.hora >= t.ini AND c.hora < t.fin
     GROUP BY t.turno
),
libre AS (
    SELECT NU_TUME_CIDI AS turno, SUM(NU_DURA_CIDI) AS min_libres
      FROM dbo.CITAS_DISPONIBLES
     WHERE FE_FECH_CIDI >= @hoy AND FE_FECH_CIDI < @hasta
     GROUP BY NU_TUME_CIDI
),
cuenta AS (
    SELECT t.med, t.turno,
           t.min_turno - o.min_citas - ISNULL(l.min_libres, 0) AS diferencia
      FROM turnos t
      JOIN ocupado o ON o.turno = t.turno
      LEFT JOIN libre l ON l.turno = t.turno
)
SELECT med, COUNT(*) AS turnos,
       SUM(CASE WHEN diferencia = 0 THEN 1 ELSE 0 END) AS cuadran,
       CAST(100.0 * SUM(CASE WHEN diferencia = 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5,1)) AS pct_cuadran
  FROM cuenta
 GROUP BY med
 ORDER BY pct_cuadran, med;
GO

-- =============================================================================
-- 3) UN DÍA REAL, A OJO: turnos, citas y huecos libres de MD08 y PS08 en el
--    próximo día hábil que tengan turno. Debe verse que los huecos son
--    exactamente lo que el turno deja libre entre citas.
-- =============================================================================
DECLARE @hoy date = CAST(GETDATE() AS date);
DECLARE @dia date = (SELECT MIN(CAST(FE_FECH_TUME AS date)) FROM dbo.TURNOS_MEDICOS
                      WHERE FE_FECH_TUME > @hoy AND CD_MED_TUME IN ('MD08', 'PS08'));

SELECT 'TURNO' AS que, CD_MED_TUME AS med, CONVERT(varchar(5), FE_HOIN_TUME, 108) AS desde,
       CONVERT(varchar(5), FE_HOFI_TUME, 108) AS hasta, NULL AS minutos, NU_NUME_TUME AS turno
  FROM dbo.TURNOS_MEDICOS
 WHERE FE_FECH_TUME = @dia AND CD_MED_TUME IN ('MD08', 'PS08')
UNION ALL
SELECT 'CITA', CD_CODI_MED_CIT, RIGHT(LEFT(FE_HORA_CIT, 16), 5), NULL, NU_DURA_CIT, NULL
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT = @dia AND CD_CODI_MED_CIT IN ('MD08', 'PS08')
UNION ALL
SELECT 'LIBRE', CD_MED_CIDI, CONVERT(varchar(5), FE_HOIN_CIDI, 108),
       CONVERT(varchar(5), FE_HOFI_CIDI, 108), NU_DURA_CIDI, NU_TUME_CIDI
  FROM dbo.CITAS_DISPONIBLES
 WHERE FE_FECH_CIDI = @dia AND CD_MED_CIDI IN ('MD08', 'PS08')
 ORDER BY med, desde, que;
GO

-- =============================================================================
-- 4) Índices de CITAS_DISPONIBLES (para que AgenIA la pueda leer sin barrerla).
-- =============================================================================
SELECT i.name AS indice, i.type_desc AS tipo,
       STUFF((SELECT ', ' + c.name FROM sys.index_columns ic
                JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
               WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
               ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '') AS columnas
  FROM sys.indexes i
 WHERE i.object_id = OBJECT_ID('dbo.CITAS_DISPONIBLES') AND i.index_id > 0;
GO

-- =============================================================================
-- 5) Citas "sin hora" (FE_HORA_CIT = 'YYYY/MM/DD N', 12 caracteres) A FUTURO o
--    sin atender. Se espera 0: si hay, son citas reales sin hora que AgenIA no
--    puede ubicar en la agenda.
-- =============================================================================
DECLARE @hoy date = CAST(GETDATE() AS date);

SELECT CD_CODI_MED_CIT AS med, NU_ESTA_CIT AS estado, COUNT(*) AS citas_sin_hora
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= DATEADD(day, -60, @hoy) AND FE_FECH_CIT < DATEADD(day, 120, @hoy)
   AND LEN(FE_HORA_CIT) <= 13
   AND (FE_FECH_CIT >= @hoy OR NU_ESTA_CIT = 0)
 GROUP BY CD_CODI_MED_CIT, NU_ESTA_CIT
 ORDER BY citas_sin_hora DESC;
GO

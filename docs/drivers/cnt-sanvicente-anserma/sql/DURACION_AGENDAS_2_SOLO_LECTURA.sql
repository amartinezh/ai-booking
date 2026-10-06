/* =============================================================================
   DURACIÓN DE AGENDAS (2) — ESTRICTAMENTE SOLO LECTURA
   Base objetivo: ESEHSVP
   =============================================================================

   Sigue a DURACION_AGENDAS_SOLO_LECTURA.sql (corrida del 2026-10-06), que dejó
   dos preguntas abiertas:

     A) Existe una tabla `CITAS_DISPONIBLES` con su propia duración
        (`NU_DURA_CIDI`). Por el nombre podría ser la lista de CUPOS que la
        aplicación del hospital ofrece. Si lo es, AgenIA podría copiar los
        cupos del hospital tal cual, en vez de calcularlos dividiendo turnos.
     B) Hay citas cuyo `FE_HORA_CIT` termina en un minuto "raro" (' 1', ' 2'…
        '18'), sobre todo en odontología y psicología. Hay que ver el texto
        exacto para saber qué son (¿sobrecupos numerados?).

   GARANTÍAS: solo SELECT, READ UNCOMMITTED, acotado por fecha. Ningún dato de
   pacientes: de CITAS_MEDICAS solo se leen médico, hora, duración y servicio.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
GO

-- =============================================================================
-- A1) Columnas de CITAS_DISPONIBLES (solo el catálogo del esquema).
-- =============================================================================
SELECT COLUMN_NAME AS columna, DATA_TYPE AS tipo, CHARACTER_MAXIMUM_LENGTH AS largo,
       IS_NULLABLE AS acepta_nulo
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_NAME = 'CITAS_DISPONIBLES'
 ORDER BY ORDINAL_POSITION;
GO

-- =============================================================================
-- A2) ¿Tiene datos? ¿Hasta cuándo? Tamaño de la tabla sin leerla entera.
-- =============================================================================
SELECT SUM(p.rows) AS filas
  FROM sys.partitions p
 WHERE p.object_id = OBJECT_ID('dbo.CITAS_DISPONIBLES') AND p.index_id IN (0, 1);
GO

-- =============================================================================
-- A3) Muestra de 40 filas de CITAS_DISPONIBLES, sin filtro (para entender qué
--     guarda). Si alguna columna resultara ser un documento de paciente, NO
--     enviarla: basta con el nombre de la columna.
-- =============================================================================
SELECT TOP 40 * FROM dbo.CITAS_DISPONIBLES;
GO

-- =============================================================================
-- B) El texto exacto de las horas "raras" de CITAS_MEDICAS (últimos 60 días y
--    próximos 120), con su duración y servicio. Solo médico/hora/duración.
-- =============================================================================
DECLARE @desde date = DATEADD(day, -60, CAST(GETDATE() AS date));
DECLARE @hasta date = DATEADD(day, 120, CAST(GETDATE() AS date));

SELECT TOP 60
       CD_CODI_MED_CIT AS med,
       '[' + FE_HORA_CIT + ']' AS hora_texto_exacto,
       LEN(FE_HORA_CIT) AS largo,
       NU_DURA_CIT AS duracion,
       CD_CODI_SER_CIT AS servicio,
       NU_ESTA_CIT AS estado
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
   AND RIGHT(LEFT(FE_HORA_CIT, 16), 2) NOT LIKE '[0-5][05]'
 ORDER BY CD_CODI_MED_CIT, FE_HORA_CIT;
GO

-- B2) Cuántas son, por médico (para medir el tamaño del fenómeno).
DECLARE @desde date = DATEADD(day, -60, CAST(GETDATE() AS date));
DECLARE @hasta date = DATEADD(day, 120, CAST(GETDATE() AS date));

SELECT CD_CODI_MED_CIT AS med,
       SUM(CASE WHEN RIGHT(LEFT(FE_HORA_CIT, 16), 2) NOT LIKE '[0-5][05]' THEN 1 ELSE 0 END) AS horas_raras,
       COUNT(*) AS citas
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
 GROUP BY CD_CODI_MED_CIT
HAVING SUM(CASE WHEN RIGHT(LEFT(FE_HORA_CIT, 16), 2) NOT LIKE '[0-5][05]' THEN 1 ELSE 0 END) > 0
 ORDER BY horas_raras DESC;
GO

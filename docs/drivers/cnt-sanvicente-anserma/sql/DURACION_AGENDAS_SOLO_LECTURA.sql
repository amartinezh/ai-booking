/* =============================================================================
   DURACIÓN REAL DE CADA AGENDA — ESTRICTAMENTE SOLO LECTURA
   Base objetivo: ESEHSVP (el catálogo VIVO del hospital)
   =============================================================================

   PARA QUÉ
   AgenIA divide cada turno de TURNOS_MEDICOS en cupos de 20 minutos para TODOS
   los médicos (`duracionMinutos: 20`, sin excepciones). Desde el 2026-10-04
   (corte a ESEHSVP) se vio que el hospital agenda con otro paso en varias
   agendas: PS08 cada 30 min, 91-2 a las y media, MD08 a :05/:25/:45, MDD2 y
   PS06 con horas sueltas. Esta consulta mide, con los datos del propio
   hospital, qué duración y qué paso usa cada agenda, para configurar AgenIA
   igual (`duracionPorMedico` del mapeo).

   La fuente principal es `CITAS_MEDICAS.NU_DURA_CIT`: la duración en minutos
   que el hospital le dio a CADA cita. Se complementa con el paso real entre una
   cita y la siguiente del mismo médico el mismo día, y con dónde caen las citas
   respecto al inicio de su turno.

   GARANTÍAS DE INOCUIDAD — verificables leyendo el archivo:
     · Solo hay sentencias SELECT. Ni un INSERT, UPDATE, DELETE, MERGE, ALTER,
       CREATE ni DROP. Ni tablas temporales.
     · `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED`: no toma bloqueos
       compartidos, así que no puede frenar a nadie que esté usando la
       aplicación del hospital.
     · Todo va acotado por fecha (los últimos 60 días y los próximos 120) y la
       columna `FE_FECH_CIT` va SIN envolver en funciones, para que se use el
       índice del hospital (CITAS_MEDICAS supera el millón de filas).

   Ejecutar preferiblemente fuera de la hora pico de asignación de citas.
   Copiar el resultado de cada bloque (0 a 6) y enviarlo a AgenIA.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
GO

-- =============================================================================
-- 0) IDENTIDAD — confirmar contra qué se está ejecutando antes de seguir.
-- =============================================================================
SELECT DB_NAME() AS base_de_datos, @@SERVERNAME AS servidor, GETDATE() AS momento,
       @@VERSION AS version_sql;
GO


-- =============================================================================
-- 1) DURACIÓN QUE EL HOSPITAL LE PONE A LAS CITAS DE CADA MÉDICO (NU_DURA_CIT)
--
-- Una fila por médico con citas en la ventana. `homologado_agenia` marca las
-- agendas que AgenIA espeja hoy. Lo que importa: `duracion_mas_usada` y qué
-- porcentaje de sus citas la usa (`pct_mas_usada`). Si es ~100 %, esa es la
-- duración de la agenda. Si está repartida, la duración depende del servicio
-- o del tipo de cita (ver bloque 2).
-- =============================================================================
DECLARE @desde date = DATEADD(day, -60, CAST(GETDATE() AS date));
DECLARE @hasta date = DATEADD(day, 120, CAST(GETDATE() AS date));

;WITH citas AS (
    SELECT CD_CODI_MED_CIT AS med, NU_DURA_CIT AS dura
      FROM dbo.CITAS_MEDICAS
     WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
),
por_valor AS (
    SELECT med, dura, COUNT(*) AS n,
           ROW_NUMBER() OVER (PARTITION BY med ORDER BY COUNT(*) DESC, dura) AS orden
      FROM citas
     GROUP BY med, dura
),
totales AS (
    SELECT med,
           COUNT(*)                                        AS citas,
           SUM(CASE WHEN dura IS NULL OR dura <= 0 THEN 1 ELSE 0 END) AS sin_duracion,
           MIN(NULLIF(dura, 0))                            AS duracion_min,
           MAX(dura)                                       AS duracion_max,
           SUM(CASE WHEN dura = 15 THEN 1 ELSE 0 END)      AS d15,
           SUM(CASE WHEN dura = 20 THEN 1 ELSE 0 END)      AS d20,
           SUM(CASE WHEN dura = 30 THEN 1 ELSE 0 END)      AS d30,
           SUM(CASE WHEN dura = 40 THEN 1 ELSE 0 END)      AS d40,
           SUM(CASE WHEN dura = 60 THEN 1 ELSE 0 END)      AS d60,
           SUM(CASE WHEN dura NOT IN (15, 20, 30, 40, 60) THEN 1 ELSE 0 END) AS d_otra
      FROM citas
     GROUP BY med
)
SELECT t.med,
       m.NO_NOMB_MED AS medico,
       CASE WHEN t.med IN ('AP04','MDD1','MDD2','76','91-1','91-2','ACO2','HO02','HO03',
                           'HO04','MD08','NU02','OD02','OD05','OD07','PS06','PS08','R001')
            THEN 'SI' ELSE 'no' END AS homologado_agenia,
       t.citas,
       p.dura AS duracion_mas_usada,
       CAST(100.0 * p.n / t.citas AS decimal(5,1)) AS pct_mas_usada,
       t.duracion_min, t.duracion_max, t.sin_duracion,
       t.d15, t.d20, t.d30, t.d40, t.d60, t.d_otra
  FROM totales t
  JOIN por_valor p ON p.med = t.med AND p.orden = 1
  LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = t.med
 ORDER BY homologado_agenia DESC, t.citas DESC;
GO


-- =============================================================================
-- 2) ¿LA DURACIÓN DEPENDE DEL SERVICIO? — médico × servicio
--
-- Si un mismo médico usa 20 min para un servicio y 40 para otro, la duración
-- correcta es por servicio, no por médico. Solo agendas homologadas.
-- =============================================================================
DECLARE @desde date = DATEADD(day, -60, CAST(GETDATE() AS date));
DECLARE @hasta date = DATEADD(day, 120, CAST(GETDATE() AS date));

SELECT c.CD_CODI_MED_CIT AS med,
       c.CD_CODI_SER_CIT AS servicio,
       s.NO_NOMB_SER     AS nombre_servicio,
       c.NU_DURA_CIT     AS duracion,
       COUNT(*)          AS citas
  FROM dbo.CITAS_MEDICAS c
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
 WHERE c.FE_FECH_CIT >= @desde AND c.FE_FECH_CIT < @hasta
   AND c.CD_CODI_MED_CIT IN ('AP04','MDD1','MDD2','76','91-1','91-2','ACO2','HO02','HO03',
                             'HO04','MD08','NU02','OD02','OD05','OD07','PS06','PS08','R001')
 GROUP BY c.CD_CODI_MED_CIT, c.CD_CODI_SER_CIT, s.NO_NOMB_SER, c.NU_DURA_CIT
 ORDER BY med, citas DESC;
GO


-- =============================================================================
-- 3) PASO REAL ENTRE UNA CITA Y LA SIGUIENTE — mismo médico, mismo día
--
-- Confirma la duración desde otro ángulo: si las citas de un médico van de 30
-- en 30, su agenda es de 30 aunque NU_DURA_CIT dijera otra cosa. Se cuentan
-- los pasos de 5 a 120 minutos (un hueco mayor es una pausa, no un paso).
-- `FE_HORA_CIT` es texto 'YYYY/MM/DD HH:MM': se convierte con TRY_CONVERT, así
-- que una hora mal escrita queda en NULL y no rompe la consulta.
-- =============================================================================
DECLARE @desde date = DATEADD(day, -60, CAST(GETDATE() AS date));
DECLARE @hasta date = DATEADD(day, 120, CAST(GETDATE() AS date));

;WITH citas AS (
    SELECT CD_CODI_MED_CIT AS med,
           CAST(FE_FECH_CIT AS date) AS dia,
           TRY_CONVERT(datetime, REPLACE(LEFT(FE_HORA_CIT, 16), '/', '-'), 120) AS hora
      FROM dbo.CITAS_MEDICAS
     WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
       AND CD_CODI_MED_CIT IN ('AP04','MDD1','MDD2','76','91-1','91-2','ACO2','HO02','HO03',
                               'HO04','MD08','NU02','OD02','OD05','OD07','PS06','PS08','R001')
),
distintas AS (
    SELECT DISTINCT med, dia, hora FROM citas WHERE hora IS NOT NULL
),
pasos AS (
    SELECT med,
           DATEDIFF(minute, LAG(hora) OVER (PARTITION BY med, dia ORDER BY hora), hora) AS paso
      FROM distintas
)
SELECT med, paso AS minutos_entre_citas, COUNT(*) AS veces
  FROM pasos
 WHERE paso BETWEEN 5 AND 120
 GROUP BY med, paso
HAVING COUNT(*) >= 3
 ORDER BY med, veces DESC;
GO


-- =============================================================================
-- 4) ¿EN QUÉ MINUTO DE LA HORA EMPIEZAN LAS CITAS? — detecta desfases
--
-- Una agenda de 20 min que empieza a las 07:00 solo usa :00, :20 y :40. Si
-- aparecen :05, :25, :45 (MD08) o :30 (91-2), la rejilla del hospital tiene
-- otro inicio u otro paso.
-- =============================================================================
DECLARE @desde date = DATEADD(day, -60, CAST(GETDATE() AS date));
DECLARE @hasta date = DATEADD(day, 120, CAST(GETDATE() AS date));

SELECT CD_CODI_MED_CIT AS med,
       RIGHT(LEFT(FE_HORA_CIT, 16), 2) AS minuto,
       COUNT(*) AS citas
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
   AND CD_CODI_MED_CIT IN ('AP04','MDD1','MDD2','76','91-1','91-2','ACO2','HO02','HO03',
                           'HO04','MD08','NU02','OD02','OD05','OD07','PS06','PS08','R001')
 GROUP BY CD_CODI_MED_CIT, RIGHT(LEFT(FE_HORA_CIT, 16), 2)
 ORDER BY med, citas DESC;
GO


-- =============================================================================
-- 5) ¿LAS CITAS ENCAJAN EN LA REJILLA DE 20 MIN DESDE EL INICIO DEL TURNO?
--
-- Es exactamente la cuenta que hace AgenIA. Para cada cita se busca el turno
-- del médico que la contiene y se mide cuántos minutos después del inicio del
-- turno empieza. `pct_en_rejilla_20` = % de citas que caen en múltiplos de 20.
-- Bajo ese porcentaje, AgenIA y el hospital no dividen el turno igual.
-- `pct_en_rejilla_30` sirve para ver si con 30 encajarían.
-- =============================================================================
DECLARE @desde date = DATEADD(day, -60, CAST(GETDATE() AS date));
DECLARE @hasta date = DATEADD(day, 120, CAST(GETDATE() AS date));

;WITH citas AS (
    SELECT CD_CODI_MED_CIT AS med,
           CAST(FE_FECH_CIT AS date) AS dia,
           CAST(TRY_CONVERT(datetime, REPLACE(LEFT(FE_HORA_CIT, 16), '/', '-'), 120) AS time) AS hora
      FROM dbo.CITAS_MEDICAS
     WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
       AND CD_CODI_MED_CIT IN ('AP04','MDD1','MDD2','76','91-1','91-2','ACO2','HO02','HO03',
                               'HO04','MD08','NU02','OD02','OD05','OD07','PS06','PS08','R001')
),
turnos AS (
    SELECT CD_MED_TUME AS med,
           CAST(FE_FECH_TUME AS date) AS dia,
           CAST(FE_HOIN_TUME AS time) AS ini,
           CAST(FE_HOFI_TUME AS time) AS fin
      FROM dbo.TURNOS_MEDICOS
     WHERE FE_FECH_TUME >= @desde AND FE_FECH_TUME < @hasta
       AND ISNULL(NU_TIPO_TUME, 0) = 0
       AND ISNULL(ID_DISP_TUME, '1') = '1'
),
cruce AS (
    SELECT c.med,
           DATEDIFF(minute, t.ini, c.hora) AS desde_inicio
      FROM citas c
      JOIN turnos t ON t.med = c.med AND t.dia = c.dia
                   AND c.hora >= t.ini AND c.hora < t.fin
     WHERE c.hora IS NOT NULL
)
SELECT med,
       COUNT(*) AS citas_dentro_de_turno,
       CAST(100.0 * SUM(CASE WHEN desde_inicio % 20 = 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5,1)) AS pct_en_rejilla_20,
       CAST(100.0 * SUM(CASE WHEN desde_inicio % 30 = 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5,1)) AS pct_en_rejilla_30,
       CAST(100.0 * SUM(CASE WHEN desde_inicio % 15 = 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5,1)) AS pct_en_rejilla_15
  FROM cruce
 GROUP BY med
 ORDER BY pct_en_rejilla_20, med;
GO


-- =============================================================================
-- 6) ¿EL HIS GUARDA LA DURACIÓN COMO CONFIGURACIÓN EN ALGUNA TABLA?
--
-- Busca columnas cuyo nombre sugiera duración, intervalo o minutos. Si aparece
-- una tabla de parámetros de agenda (por médico, especialidad o servicio),
-- AgenIA podría leer la duración de ahí en vez de deducirla de las citas.
-- Solo lee el catálogo del esquema, no datos de pacientes.
-- =============================================================================
SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, DATA_TYPE AS tipo
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE COLUMN_NAME LIKE '%DURA%'
    OR COLUMN_NAME LIKE '%INTERV%'
    OR COLUMN_NAME LIKE '%MINU%'
    OR COLUMN_NAME LIKE '%TIEM%'
    OR COLUMN_NAME LIKE '%FREC%'
 ORDER BY TABLE_NAME, COLUMN_NAME;
GO

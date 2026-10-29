/* =============================================================================
   HISTORIA CLÍNICA → RESUMEN DE LA ATENCIÓN · RONDA 3
   ESTRICTAMENTE SOLO LECTURA · Base objetivo: ESEHSVP
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md. Lo aprendido: MAPEO_HIS.md §2.9.
   Con la ronda 2 ya se conocen todas las columnas: esta ronda no adivina nada.
   Responde las preguntas que quedan para diseñar el resumen:

     R3-1  ¿Qué significa NU_ESTA_HICL (0/1)? El 64 % de las consultas está en
           0. ¿Es «abierta/cerrada», algo del médico o del servicio? Mira la
           auditoría del HIS (AUDITOR) y el código que lo toca.
     R3-2  ¿Cuándo se escribe la historia respecto a la cita? ¿Las órdenes se
           agregan después? (decide cuánto esperar antes de enviar)
     R3-3  Medicamentos: ¿qué son las órdenes AI y AE? ¿cómo se ven la dosis,
           la frecuencia y la duración? (sin datos del paciente)
     R3-4  Exámenes y procedimientos: qué son las órdenes de tipo 1 a 4.
     R3-5  El texto del médico: qué plantillas usa la consulta y qué campos
           (motivo, enfermedad actual, plan, recomendaciones…) se llenan.
     R3-6  La lista de servicios para decidir cuáles reciben resumen (D1).
     R3-7  Contacto de los pacientes que lo recibirían (90 días).
     R3-8  Permisos actuales de agenia_sync.
     R3-9  Fragmentos del código de interoperabilidad alrededor de las
           columnas clave (sin tener que guardar archivos).

   «Consulta ambulatoria» aquí = TX_TIPO_HICL = 'CON' sin registro de ingreso
   (NU_NUME_REG_HICL vacío o 0): así separa el propio SP_INTEROPERABILIDAD la
   consulta externa (tipo 1) de urgencias/hospitalización (tipo 2).

   QUÉ HACE Y QUÉ NO HACE
     · Solo SELECT y sp_executesql de consultas SELECT. No escribe en ESEHSVP
       ni ejecuta procedimientos del hospital.
     · Copia cabeceras de 90 días a tablas temporales (#) de tempdb, que se
       borran solas.
     · Solo conteos, catálogos y nombres de medicamentos o exámenes (sin
       paciente). La única excepción: R3-3 (d) muestra 12 renglones de fórmula
       (medicamento, dosis, frecuencia, duración) SIN ningún dato del paciente,
       para ver cómo se lee una fórmula real.
     · READ UNCOMMITTED y MAXDOP 1.

   CÓMO CORRERLO Y DEVOLVERLO
     1. SSMS, ventana nueva, F5 con todo (R3-0 primero). Mejor de noche o
        domingo.
     2. El chat corta los mensajes en ~50.000 caracteres: envíame UN MENSAJE
        POR BLOQUE (R3-1 en uno, R3-2 en otro…). R3-5 y R3-9 son los más
        largos: cada uno solo. Si aun así se corta, dime y lo parto.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- =============================================================================
-- R3-0 · Cabeceras de 90 días (OBLIGATORIO, PRIMERO)
-- =============================================================================
DECLARE @obj int = OBJECT_ID(N'dbo.HISTORIACLINICA');
IF @obj IS NULL
BEGIN
    RAISERROR(N'No existe dbo.HISTORIACLINICA en esta base. ¿La ventana está en ESEHSVP?', 16, 1);
    RETURN;
END;

DECLARE @dias int = 90, @paso bigint = 20000, @tope_tramos int = 100;
DECLARE @hoy   date = CAST(GETDATE() AS date);
DECLARE @desde date = DATEADD(day, -@dias, @hoy);
DECLARE @id_min bigint, @id_max bigint;
SELECT @id_min = MIN(NU_NUME_HICL), @id_max = MAX(NU_NUME_HICL) FROM dbo.HISTORIACLINICA;

DECLARE @hi bigint = @id_max, @lo bigint = @id_max, @filas int, @en_ventana int, @tramos int = 0, @confiable bit = 0;
WHILE @hi >= @id_min AND @tramos < @tope_tramos
BEGIN
    SET @lo = @hi - @paso + 1;
    SELECT @filas = COUNT(*), @en_ventana = SUM(CASE WHEN FE_FECH_HICL >= @desde THEN 1 ELSE 0 END)
      FROM dbo.HISTORIACLINICA WITH (NOLOCK)
     WHERE NU_NUME_HICL BETWEEN @lo AND @hi
    OPTION (MAXDOP 1);
    SET @tramos += 1;
    IF @filas > 0 AND @en_ventana = 0 BEGIN SET @confiable = 1; BREAK; END;
    SET @hi = @lo - 1;
END;
IF @hi < @id_min SET @confiable = 1;
IF @tramos = 1 AND @en_ventana = 0 SET @confiable = 0;
DECLARE @id_desde bigint = CASE WHEN @lo < @id_min THEN @id_min ELSE @lo END;

IF OBJECT_ID('tempdb..#h90') IS NOT NULL DROP TABLE #h90;
SELECT h.NU_NUME_HICL                                           AS id,
       h.FE_FECH_HICL                                           AS fecha,
       h.TX_TIPO_HICL                                           AS tipo,
       h.NU_ESTA_HICL                                           AS estado,
       h.TX_CODSER_HICL                                         AS ser,
       CAST(h.CD_MED_REAL_HICL AS varchar(10))                  AS med,
       h.NU_AUTO_DAPL_HICL                                      AS dapl,
       h.NU_NUME_LABO_HICL                                      AS labo,
       h.NU_NUME_PADR_HICL                                      AS padre,
       h.NU_NUME_REG_HICL                                       AS reg,
       CASE WHEN ISNULL(h.NU_NUME_REG_HICL, 0) = 0 THEN 1 ELSE 0 END AS amb,
       LTRIM(RTRIM(h.NU_HIST_PAC_HICL))                         AS pac
  INTO #h90
  FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
 WHERE h.NU_NUME_HICL >= @id_desde
   AND h.FE_FECH_HICL >= @desde AND h.FE_FECH_HICL < @hoy
OPTION (MAXDOP 1, RECOMPILE);
CREATE UNIQUE CLUSTERED INDEX ix_h90 ON #h90 (id);

SELECT N'R3-0' AS bloque, @id_desde AS leer_desde_nu_nume_hicl, @tramos AS tramos_leidos,
       CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO (avísame antes de seguir)' END AS frontera_confiable,
       COUNT(*) AS historias_90_dias,
       SUM(CASE WHEN tipo = 'CON' AND amb = 1 THEN 1 ELSE 0 END) AS consultas_ambulatorias_90_dias,
       SUM(CASE WHEN tipo = 'CON' AND amb = 1 AND fecha >= DATEADD(day, -30, @hoy) THEN 1 ELSE 0 END) AS consultas_ambulatorias_30_dias
  FROM #h90;
GO

-- =============================================================================
-- R3-1 · ¿Qué significa NU_ESTA_HICL?
--
-- (a) estado por tipo, servicio y ámbito (30 días);
-- (b) estado según la antigüedad de la historia: si el 1 crece con las
--     semanas, el 0 es «abierta» y el 1 «cerrada» más tarde;
-- (c) estado por médico (código, no nombre): si cada médico está casi todo en
--     0 o casi todo en 1, el estado es costumbre del usuario, no de la atención;
-- (d) qué escribe la aplicación en la auditoría del HIS (AUDITOR) sobre la
--     historia en los últimos 7 días, y qué valores de NU_ESTA_HICL aparecen
--     (solo 18 caracteres desde «NU_ESTA_HICL»: el valor, ningún otro dato);
-- (e) todo código que mencione NU_ESTA_HICL (fragmento).
-- =============================================================================
IF OBJECT_ID('tempdb..#h90') IS NULL BEGIN RAISERROR(N'Corre primero R3-0 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @d30 date = DATEADD(day, -30, CAST(GETDATE() AS date));

-- (a)
SELECT TOP (60) h.tipo, h.ser AS servicio, s.NO_NOMB_SER AS nombre,
       CASE WHEN h.amb = 1 THEN 'ambulatoria' ELSE 'con registro' END AS ambito,
       COUNT(*)                                          AS historias,
       SUM(CASE WHEN h.estado = 0 THEN 1 ELSE 0 END)     AS estado_0,
       SUM(CASE WHEN h.estado = 1 THEN 1 ELSE 0 END)     AS estado_1,
       SUM(CASE WHEN h.estado NOT IN (0, 1) THEN 1 ELSE 0 END) AS otro_estado
  FROM #h90 h
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = h.ser
 WHERE h.fecha >= @d30 AND h.tipo IN ('CON', 'EVC', 'CPN', 'HPN')
 GROUP BY h.tipo, h.ser, s.NO_NOMB_SER, h.amb
 ORDER BY historias DESC;

-- (b)
SELECT DATEDIFF(day, h.fecha, GETDATE()) / 7          AS semanas_atras,
       COUNT(*)                                        AS consultas,
       SUM(CASE WHEN h.estado = 1 THEN 1 ELSE 0 END)   AS estado_1,
       CAST(100.0 * SUM(CASE WHEN h.estado = 1 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_estado_1
  FROM #h90 h
 WHERE h.tipo = 'CON' AND h.amb = 1
 GROUP BY DATEDIFF(day, h.fecha, GETDATE()) / 7
 ORDER BY semanas_atras;

-- (c)
SELECT h.med AS codigo_medico, ISNULL(m.DE_CARG_MED, N'?') AS cargo,
       COUNT(*)                                        AS consultas,
       CAST(100.0 * SUM(CASE WHEN h.estado = 1 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_estado_1
  FROM #h90 h
  LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = h.med
 WHERE h.tipo = 'CON' AND h.amb = 1 AND h.fecha >= @d30
 GROUP BY h.med, m.DE_CARG_MED
HAVING COUNT(*) >= 20
 ORDER BY consultas DESC;

-- (d)
IF OBJECT_ID(N'dbo.AUDITOR') IS NULL
    SELECT N'R3-1 (d): no existe dbo.AUDITOR.' AS aviso;
ELSE
BEGIN
    EXEC sp_executesql N'
    SELECT a.AudTabla AS tabla, a.AudTrans AS operacion, a.AudVerExe AS version_aplicacion, COUNT(*) AS filas,
           SUM(CASE WHEN a.AudDesc LIKE ''%NU[_]ESTA[_]HICL%'' THEN 1 ELSE 0 END) AS mencionan_estado,
           MIN(a.AudFech) AS primera, MAX(a.AudFech) AS ultima
      FROM dbo.AUDITOR a WITH (NOLOCK)
     WHERE a.AudFech >= DATEADD(day, -7, GETDATE())
       AND (a.AudTabla LIKE ''%HISTORIACLINICA%'' OR a.AudTabla LIKE ''HIST[_]%'' OR a.AudTabla LIKE ''DATOS[_]PLANTILLA%'')
     GROUP BY a.AudTabla, a.AudTrans, a.AudVerExe
     ORDER BY filas DESC
    OPTION (MAXDOP 1);

    SELECT TOP (20) a.AudTrans AS operacion,
           SUBSTRING(CAST(a.AudDesc AS varchar(max)), CHARINDEX(''NU_ESTA_HICL'', CAST(a.AudDesc AS varchar(max))), 18) AS fragmento,
           COUNT(*) AS veces
      FROM dbo.AUDITOR a WITH (NOLOCK)
     WHERE a.AudFech >= DATEADD(day, -7, GETDATE())
       AND a.AudTabla LIKE ''%HISTORIACLINICA%''
       AND a.AudDesc LIKE ''%NU[_]ESTA[_]HICL%''
     GROUP BY a.AudTrans, SUBSTRING(CAST(a.AudDesc AS varchar(max)), CHARINDEX(''NU_ESTA_HICL'', CAST(a.AudDesc AS varchar(max))), 18)
     ORDER BY veces DESC
    OPTION (MAXDOP 1);';
END;

-- (e)
SELECT o.name AS objeto, o.type_desc AS tipo, o.modify_date AS modificado,
       SUBSTRING(m.definition,
                 CASE WHEN CHARINDEX(N'NU_ESTA_HICL', m.definition) > 150 THEN CHARINDEX(N'NU_ESTA_HICL', m.definition) - 150 ELSE 1 END,
                 400) AS fragmento
  FROM sys.sql_modules m
  JOIN sys.objects o ON o.object_id = m.object_id
 WHERE m.definition LIKE N'%NU[_]ESTA[_]HICL%'
   AND o.name <> N'PA_Ins_HISTORIACLINICA'
 ORDER BY o.name;
GO

-- =============================================================================
-- R3-2 · ¿Cuándo se escribe? (consultas ambulatorias de 30 días; minutos)
--
-- FE_FECH_HICL es la hora en que se GUARDÓ la historia (PA_Ins_HISTORIACLINICA
-- pone GETDATE()). (a) contra la hora de la cita: si sale ~+15 a +40, se guarda
-- al terminar; si sale ~0 o negativo, se abre al empezar. (b) contra la hora
-- de cada orden (FE_FECH_HORD): cuánto se agrega después. (c) hora del día.
-- =============================================================================
IF OBJECT_ID('tempdb..#h90') IS NULL BEGIN RAISERROR(N'Corre primero R3-0 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @d30 date = DATEADD(day, -30, CAST(GETDATE() AS date));

IF OBJECT_ID('tempdb..#c30') IS NOT NULL DROP TABLE #c30;
SELECT LTRIM(RTRIM(c.NU_HIST_PAC_CIT)) AS pac, CAST(c.FE_FECH_CIT AS date) AS dia,
       TRY_CONVERT(datetime, REPLACE(LEFT(c.FE_HORA_CIT, 16), '/', '-'), 120) AS hora
  INTO #c30
  FROM dbo.CITAS_MEDICAS c WITH (NOLOCK)
 WHERE c.FE_FECH_CIT >= @d30
OPTION (MAXDOP 1);

-- (a)
;WITH par AS (
    SELECT h.id, DATEDIFF(minute, MIN(c.hora), h.fecha) AS minutos
      FROM #h90 h
      JOIN #c30 c ON c.pac = h.pac AND c.dia = CAST(h.fecha AS date)
     WHERE h.tipo = 'CON' AND h.amb = 1 AND h.fecha >= @d30 AND c.hora IS NOT NULL
     GROUP BY h.id, h.fecha
)
SELECT DISTINCT
       N'(a) cita → historia' AS medida,
       COUNT(*) OVER ()                                                AS casos,
       MIN(minutos) OVER ()                                            AS minimo,
       PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY minutos) OVER ()   AS p10,
       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY minutos) OVER ()   AS mediana,
       PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY minutos) OVER ()   AS p90,
       MAX(minutos) OVER ()                                            AS maximo
  FROM par;

-- (b)
;WITH x AS (
    SELECT DATEDIFF(minute, h.fecha, o.FE_FECH_HORD) AS minutos
      FROM #h90 h
      JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = h.id
     WHERE h.tipo = 'CON' AND h.amb = 1 AND h.fecha >= @d30 AND o.FE_FECH_HORD IS NOT NULL
)
SELECT DISTINCT
       N'(b) historia → orden' AS medida,
       COUNT(*) OVER ()                                                AS ordenes,
       MIN(minutos) OVER ()                                            AS minimo,
       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY minutos) OVER ()   AS mediana,
       PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY minutos) OVER ()   AS p90,
       PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY minutos) OVER ()   AS p99,
       MAX(minutos) OVER ()                                            AS maximo,
       SUM(CASE WHEN minutos > 30  THEN 1 ELSE 0 END) OVER ()          AS mas_de_30_min,
       SUM(CASE WHEN minutos > 120 THEN 1 ELSE 0 END) OVER ()          AS mas_de_2_horas,
       SUM(CASE WHEN minutos > 1440 THEN 1 ELSE 0 END) OVER ()         AS mas_de_1_dia
  FROM x;

-- (c)
SELECT DATEPART(hour, fecha) AS hora, COUNT(*) AS consultas
  FROM #h90
 WHERE tipo = 'CON' AND amb = 1 AND fecha >= @d30
 GROUP BY DATEPART(hour, fecha)
 ORDER BY hora;
GO

-- =============================================================================
-- R3-3 · Medicamentos (órdenes de tipo 5) de las consultas ambulatorias, 30 días
--
-- (a) AI contra AE: cuántos, si son posfechados, si se dispensaron (número de
--     fórmula), si traen dosis/duración; (b) los 15 medicamentos más formulados
--     de cada uno (el nombre dice si se aplican en el servicio o van para la
--     casa); (c) estado del renglón; (d) 12 renglones de ejemplo SIN paciente;
--     (e) órdenes posfechadas (NU_ORDEN_FECHAPOS).
-- =============================================================================
IF OBJECT_ID('tempdb..#h90') IS NULL BEGIN RAISERROR(N'Corre primero R3-0 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @d30 date = DATEADD(day, -30, CAST(GETDATE() AS date));

IF OBJECT_ID('tempdb..#med') IS NOT NULL DROP TABLE #med;
SELECT h.id AS hc, o.NU_AUTO_HORD AS orden, COALESCE(o.TX_TIAP_HORD, '(vacío)') AS tiap,
       o.FE_POSFECHA AS posfecha, o.NU_ORDEN_FECHAPOS AS orden_posfecha,
       m.NO_NOMB_ARTI_HMED AS nombre, m.DE_UNME_HMED AS unidad, m.DE_CTRA_HMED AS concentracion,
       m.NU_CANT_HMED AS cantidad, m.NU_ESTA_HMED AS estado, m.NU_NUME_FORM_HMED AS formula,
       m.TX_FOFA_HMED AS forma, m.TX_VIAD_HMED AS via, m.TX_DURA_HMED AS duracion,
       m.NU_CTDSIS_HMED AS dosis_cant, m.TX_UMDSIS_HMED AS dosis_unidad,
       m.NU_CTFREC_HMED AS frecuencia_cant, m.TX_CDFREC_HMED AS frecuencia_unidad,
       DATALENGTH(m.DE_DOSIS_HMED) AS bytes_dosis_texto, DATALENGTH(m.TX_INDDOS_HMED) AS bytes_indicacion
  INTO #med
  FROM #h90 h
  JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI  m WITH (NOLOCK) ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
 WHERE h.tipo = 'CON' AND h.amb = 1 AND h.fecha >= @d30
OPTION (MAXDOP 1);

-- (a)
SELECT tiap,
       COUNT(DISTINCT hc)                                          AS consultas,
       COUNT(DISTINCT orden)                                       AS ordenes,
       COUNT(*)                                                    AS renglones,
       SUM(CASE WHEN posfecha IS NOT NULL THEN 1 ELSE 0 END)       AS con_posfecha,
       SUM(CASE WHEN formula IS NOT NULL AND formula <> 0 THEN 1 ELSE 0 END) AS con_numero_de_formula,
       SUM(CASE WHEN ISNULL(duracion, '') <> '' THEN 1 ELSE 0 END) AS con_duracion,
       SUM(CASE WHEN ISNULL(bytes_dosis_texto, 0) > 0 THEN 1 ELSE 0 END) AS con_dosis_texto,
       SUM(CASE WHEN ISNULL(bytes_indicacion, 0) > 0 THEN 1 ELSE 0 END)  AS con_indicacion,
       SUM(CASE WHEN ISNULL(frecuencia_cant, 0) > 0 THEN 1 ELSE 0 END)   AS con_frecuencia
  FROM #med
 GROUP BY tiap
 ORDER BY renglones DESC;

-- (b)
SELECT tiap, puesto, nombre, renglones
  FROM (SELECT tiap, nombre, COUNT(*) AS renglones,
               ROW_NUMBER() OVER (PARTITION BY tiap ORDER BY COUNT(*) DESC) AS puesto
          FROM #med GROUP BY tiap, nombre) x
 WHERE puesto <= 15
 ORDER BY tiap, puesto;

-- (c)
SELECT tiap, estado, COUNT(*) AS renglones FROM #med GROUP BY tiap, estado ORDER BY tiap, renglones DESC;

-- (d) ejemplos SIN paciente (6 de cada tipo, los más recientes)
SELECT tiap, nombre, concentracion, forma, unidad, cantidad, dosis_cant, dosis_unidad,
       frecuencia_cant, frecuencia_unidad, via, duracion
  FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY tiap ORDER BY hc DESC) AS n FROM #med) x
 WHERE n <= 6
 ORDER BY tiap, n;

-- (e) series posfechadas. NU_ORDEN_FECHAPOS NO es un número de meses: es el número
--     de la orden que encabeza la serie (corrida del 2026-10-28). Por eso se resume
--     y no se lista: listarlo devolvió una fila por serie (~1.500) y cortó el mensaje.
SELECT tiap,
       COUNT(DISTINCT CASE WHEN orden_posfecha IS NULL THEN orden END)     AS ordenes_sin_serie,
       COUNT(DISTINCT orden_posfecha)                                      AS series,
       COUNT(DISTINCT CASE WHEN orden_posfecha IS NOT NULL THEN orden END) AS ordenes_en_series
  FROM #med
 GROUP BY tiap;
GO

-- =============================================================================
-- R3-4 · Órdenes de tipo 1 a 4 (HIST_PROC) de las consultas ambulatorias, 30 días
--
-- (a) los 12 servicios más ordenados de cada tipo (laboratorio, imagen,
--     procedimiento, interconsulta…); (b) estado del renglón.
-- =============================================================================
IF OBJECT_ID('tempdb..#h90') IS NULL BEGIN RAISERROR(N'Corre primero R3-0 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @d30 date = DATEADD(day, -30, CAST(GETDATE() AS date));

IF OBJECT_ID('tempdb..#pro') IS NOT NULL DROP TABLE #pro;
SELECT h.id AS hc, o.NU_TIPO_HORD AS tipo_orden, p.CD_CODI_SER_HPRO AS servicio, p.NU_ESTA_HPRO AS estado,
       p.NU_CANT_HPRO AS cantidad, DATALENGTH(p.DE_INDI_HPRO) AS bytes_indicacion
  INTO #pro
  FROM #h90 h
  JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD IN (1, 2, 3, 4)
  JOIN dbo.HIST_PROC  p WITH (NOLOCK) ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
 WHERE h.tipo = 'CON' AND h.amb = 1 AND h.fecha >= @d30
OPTION (MAXDOP 1);

-- (a)
SELECT x.tipo_orden, x.puesto, x.servicio, s.NO_NOMB_SER AS nombre, x.renglones, x.consultas
  FROM (SELECT tipo_orden, servicio, COUNT(*) AS renglones, COUNT(DISTINCT hc) AS consultas,
               ROW_NUMBER() OVER (PARTITION BY tipo_orden ORDER BY COUNT(*) DESC) AS puesto
          FROM #pro GROUP BY tipo_orden, servicio) x
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = x.servicio
 WHERE x.puesto <= 12
 ORDER BY x.tipo_orden, x.puesto;

-- (b)
SELECT tipo_orden, estado, COUNT(*) AS renglones,
       SUM(CASE WHEN ISNULL(bytes_indicacion, 0) > 0 THEN 1 ELSE 0 END) AS con_indicacion
  FROM #pro GROUP BY tipo_orden, estado ORDER BY tipo_orden, renglones DESC;
GO

-- =============================================================================
-- R3-5 · El texto del médico: plantillas y campos de la consulta ambulatoria
--        (7 días)
--
-- Camino: HISTORIACLINICA.NU_AUTO_DAPL_HICL → DATOS_PLANTILLA (NU_NUME_RPET_DAPL)
-- → R_PLAN_ESP_TIAT (plantilla y especialidad) → R_PLAN_CONC (cada campo: su
-- concepto, su grupo y su índice) ↔ DATOS_PLANTILLA_TEXT/_MEMO/_NUME/_DATE (el
-- valor, por NU_INDI_xxxx) → CONCEPTO_HIST / GRUPO_HIST (los nombres).
-- (a) plantillas usadas; (b) ¿el índice del valor casa con NU_INDI_RPC o con
-- NU_INGR_RPC? (valida el camino); (c) los campos que se llenan, con su grupo,
-- cuántas consultas los traen y su largo. Solo nombres de campos y largos:
-- ningún texto escrito por el médico.
-- =============================================================================
IF OBJECT_ID('tempdb..#h90') IS NULL BEGIN RAISERROR(N'Corre primero R3-0 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @d7 date = DATEADD(day, -7, CAST(GETDATE() AS date));

IF OBJECT_ID('tempdb..#d7') IS NOT NULL DROP TABLE #d7;
SELECT h.id, h.dapl, h.ser, dp.NU_NUME_RPET_DAPL AS rpet, r.NU_NUME_PLHI_RPET AS plhi, r.CD_CODI_ESP_RPET AS esp
  INTO #d7
  FROM #h90 h
  JOIN dbo.DATOS_PLANTILLA dp WITH (NOLOCK) ON dp.NU_AUTO_DAPL = h.dapl
  LEFT JOIN dbo.R_PLAN_ESP_TIAT r WITH (NOLOCK) ON r.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL
 WHERE h.tipo = 'CON' AND h.amb = 1 AND h.fecha >= @d7
OPTION (MAXDOP 1);

-- (a)
SELECT d.plhi, p.TX_DESC_PLHI AS plantilla, d.esp, e.NO_NOMB_ESP AS especialidad, COUNT(*) AS consultas
  FROM #d7 d
  LEFT JOIN dbo.PLANTILLA_HIST p  ON p.NU_NUME_PLHI = d.plhi
  LEFT JOIN dbo.ESPECIALIDADES e  ON e.CD_CODI_ESP = d.esp
 GROUP BY d.plhi, p.TX_DESC_PLHI, d.esp, e.NO_NOMB_ESP
 ORDER BY consultas DESC;

IF OBJECT_ID('tempdb..#v') IS NOT NULL DROP TABLE #v;
CREATE TABLE #v (id int, plhi int, indi int, clase varchar(5), bytes int);
INSERT #v SELECT d.id, d.plhi, t.NU_INDI_DPTE, 'TEXT', DATALENGTH(t.TX_DESC_DPTE)
            FROM #d7 d JOIN dbo.DATOS_PLANTILLA_TEXT t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPTE = d.dapl OPTION (MAXDOP 1);
INSERT #v SELECT d.id, d.plhi, t.NU_INDI_DPME, 'MEMO', DATALENGTH(t.TX_DESC_DPME)
            FROM #d7 d JOIN dbo.DATOS_PLANTILLA_MEMO t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPME = d.dapl OPTION (MAXDOP 1);
INSERT #v SELECT d.id, d.plhi, t.NU_INDI_DPNU, 'NUME', 8
            FROM #d7 d JOIN dbo.DATOS_PLANTILLA_NUME t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPNU = d.dapl OPTION (MAXDOP 1);
INSERT #v SELECT d.id, d.plhi, t.NU_INDI_DPDA, 'DATE', 8
            FROM #d7 d JOIN dbo.DATOS_PLANTILLA_DATE t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPDA = d.dapl OPTION (MAXDOP 1);

-- (b)
SELECT COUNT(*) AS valores,
       SUM(por_indi) AS casan_con_NU_INDI_RPC,
       SUM(por_ingr) AS casan_con_NU_INGR_RPC
  FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.R_PLAN_CONC rc WHERE rc.NU_NUME_PLHI_RPC = v.plhi AND rc.NU_INDI_RPC = v.indi) THEN 1 ELSE 0 END AS por_indi,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.R_PLAN_CONC rc WHERE rc.NU_NUME_PLHI_RPC = v.plhi AND rc.NU_INGR_RPC = v.indi) THEN 1 ELSE 0 END AS por_ingr
          FROM #v v) x;

-- (c)
SELECT TOP (150)
       v.plhi,
       p.TX_DESC_PLHI                                                    AS plantilla,
       g.CD_CODI_GRHI                                                    AS grupo,
       c.CD_CODI_COHI                                                    AS campo,
       v.clase,
       COUNT(DISTINCT v.id)                                              AS consultas_con_valor,
       CAST(100.0 * COUNT(DISTINCT v.id) / NULLIF(MAX(tot.n), 0) AS decimal(5, 1)) AS pct_de_su_plantilla,
       AVG(v.bytes)                                                      AS bytes_promedio,
       MAX(v.bytes)                                                      AS bytes_max
  FROM #v v
  LEFT JOIN (SELECT plhi, COUNT(*) AS n FROM #d7 GROUP BY plhi) tot ON tot.plhi = v.plhi
  LEFT JOIN dbo.R_PLAN_CONC rc  ON rc.NU_NUME_PLHI_RPC = v.plhi AND rc.NU_INDI_RPC = v.indi
  LEFT JOIN dbo.CONCEPTO_HIST c ON c.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
  LEFT JOIN dbo.GRUPO_HIST g    ON g.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC
  LEFT JOIN dbo.PLANTILLA_HIST p ON p.NU_NUME_PLHI = v.plhi
 GROUP BY v.plhi, p.TX_DESC_PLHI, g.CD_CODI_GRHI, c.CD_CODI_COHI, v.clase
 ORDER BY consultas_con_valor DESC;
GO

-- =============================================================================
-- R3-6 · Servicios candidatos a recibir resumen (D1) — ambulatorios, 30 días
--
-- Por tipo de historia y servicio: cuántas, su especialidad (de LABORATORIO) y
-- qué traen (medicamentos, exámenes, indicaciones, remisión, incapacidad).
-- =============================================================================
IF OBJECT_ID('tempdb..#h90') IS NULL BEGIN RAISERROR(N'Corre primero R3-0 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @d30 date = DATEADD(day, -30, CAST(GETDATE() AS date));

SELECT x.tipo, x.ser AS servicio, s.NO_NOMB_SER AS nombre, e.NO_NOMB_ESP AS especialidad,
       COUNT(*)         AS historias,
       SUM(x.con_med)   AS con_medicamentos,
       SUM(x.con_proc)  AS con_examenes_o_proc,
       SUM(x.con_indi)  AS con_indicaciones,
       SUM(x.con_remi)  AS con_remision,
       SUM(x.con_inca)  AS con_incapacidad
  FROM (SELECT h.id, h.tipo, h.ser, h.labo,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o WITH (NOLOCK) WHERE o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5) THEN 1 ELSE 0 END AS con_med,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o WITH (NOLOCK) WHERE o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD IN (1, 2, 3, 4)) THEN 1 ELSE 0 END AS con_proc,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_INDI i WITH (NOLOCK) WHERE i.NU_NUME_HICL_HIND = h.id) THEN 1 ELSE 0 END AS con_indi,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_REMI r WITH (NOLOCK) WHERE r.NU_NUME_HICL_HREM = h.id) THEN 1 ELSE 0 END AS con_remi,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_INCA c WITH (NOLOCK) WHERE c.NU_NUME_HICL_HINC = h.id) THEN 1 ELSE 0 END AS con_inca
          FROM #h90 h
         WHERE h.amb = 1 AND h.fecha >= @d30 AND h.tipo IN ('CON', 'EVC', 'CPN', 'HPN')) x
  LEFT JOIN dbo.SERVICIOS s      ON s.CD_CODI_SER = x.ser
  LEFT JOIN dbo.LABORATORIO l    ON l.NU_NUME_LABO = x.labo
  LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = l.CD_CODI_ESP_LABO
 GROUP BY x.tipo, x.ser, s.NO_NOMB_SER, e.NO_NOMB_ESP
HAVING COUNT(*) >= 5
 ORDER BY historias DESC
OPTION (MAXDOP 1);
GO

-- =============================================================================
-- R3-7 · Contacto de los pacientes con consulta ambulatoria en 90 días
--        (solo conteos; mismas reglas que HC-7)
-- =============================================================================
IF OBJECT_ID('tempdb..#h90') IS NULL BEGIN RAISERROR(N'Corre primero R3-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#p') IS NOT NULL DROP TABLE #p;
SELECT LTRIM(RTRIM(ISNULL(pa.DE_TELE_PAC, '')))              AS tel,
       LOWER(LTRIM(RTRIM(ISNULL(pa.DE_EMAIL_PAC, ''))))      AS correo,
       LTRIM(RTRIM(ISNULL(pa.DE_TELE_ACOM_PAC, '')))         AS tel_acom,
       LOWER(LTRIM(RTRIM(ISNULL(pa.TX_EMAIL_ACOM_PAC, '')))) AS correo_acom,
       CASE WHEN pa.FE_NACI_PAC IS NULL THEN NULL
            ELSE (CONVERT(int, CONVERT(char(8), GETDATE(), 112)) - CONVERT(int, CONVERT(char(8), pa.FE_NACI_PAC, 112))) / 10000
       END                                                   AS edad
  INTO #p
  FROM dbo.PACIENTES pa WITH (NOLOCK)
 WHERE pa.NU_HIST_PAC IN (SELECT pac FROM #h90 WHERE tipo = 'CON' AND amb = 1)
OPTION (MAXDOP 1);

SELECT COUNT(*) AS pacientes,
       SUM(CASE WHEN tel LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' THEN 1 ELSE 0 END)  AS con_celular,
       SUM(CASE WHEN correo LIKE '%_@_%._%' AND correo NOT LIKE '% %' THEN 1 ELSE 0 END)            AS con_correo_aparente,
       SUM(CASE WHEN tel LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
                 AND correo LIKE '%_@_%._%' AND correo NOT LIKE '% %' THEN 1 ELSE 0 END)           AS con_los_dos,
       SUM(CASE WHEN tel NOT LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
                 AND NOT (correo LIKE '%_@_%._%' AND correo NOT LIKE '% %') THEN 1 ELSE 0 END)     AS sin_ninguno,
       SUM(CASE WHEN edad < 18 THEN 1 ELSE 0 END)                                                   AS menores,
       SUM(CASE WHEN edad < 18 AND tel_acom LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]%' THEN 1 ELSE 0 END) AS menores_con_celular_acompanante,
       SUM(CASE WHEN edad < 18 AND correo_acom LIKE '%_@_%._%' AND correo_acom NOT LIKE '% %' THEN 1 ELSE 0 END)     AS menores_con_correo_acompanante
  FROM #p;

SELECT correo AS correo_de_relleno_probable, COUNT(*) AS pacientes
  FROM #p WHERE correo LIKE '%_@_%._%' GROUP BY correo HAVING COUNT(*) >= 20 ORDER BY pacientes DESC;

SELECT TOP (10) SUBSTRING(correo, CHARINDEX('@', correo) + 1, 100) AS dominio, COUNT(*) AS pacientes
  FROM #p WHERE correo LIKE '%_@_%._%' AND correo NOT LIKE '% %'
 GROUP BY SUBSTRING(correo, CHARINDEX('@', correo) + 1, 100) ORDER BY pacientes DESC;
GO

-- =============================================================================
-- R3-8 · Qué puede leer hoy agenia_sync (igual que HC-8)
-- =============================================================================
SELECT pr.name AS usuario, pe.class_desc AS ambito,
       ISNULL(OBJECT_NAME(pe.major_id), N'(toda la base)') AS objeto,
       CASE WHEN pe.minor_id > 0 THEN COL_NAME(pe.major_id, pe.minor_id) ELSE N'' END AS columna,
       pe.permission_name AS permiso, pe.state_desc AS estado
  FROM sys.database_permissions pe
  JOIN sys.database_principals pr ON pr.principal_id = pe.grantee_principal_id
 WHERE pr.name = N'agenia_sync'
 ORDER BY objeto, permiso;
GO

-- =============================================================================
-- R3-9 · Fragmentos del código de interoperabilidad (300 caracteres alrededor
--        de cada palabra clave, hasta 4 veces por palabra)
--
-- Para saber, sin guardar archivos, cómo el propio HIS interpreta el tipo y el
-- estado de la historia, las órdenes AI/AE y el texto de la plantilla.
-- =============================================================================
DECLARE @frag TABLE (objeto sysname, palabra nvarchar(40), n int, posicion int, fragmento nvarchar(400));
DECLARE @palabras TABLE (orden int IDENTITY, palabra nvarchar(40));
INSERT @palabras (palabra) VALUES (N'NU_ESTA_HICL'), (N'TX_TIPO_HICL'), (N'TX_TIAP_HORD'), (N'''AE'''), (N'''AI'''),
                                  (N'NU_TIPO_HORD'), (N'NU_ESTA_HMED'), (N'NU_INDI_'), (N'R_PLAN_CONC');

DECLARE @o sysname, @def nvarchar(max), @p nvarchar(40), @i int, @pos int, @n int;
DECLARE objs CURSOR LOCAL FAST_FORWARD FOR
    SELECT o.name, m.definition
      FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
     WHERE o.name IN (N'SP_INTEROPERABILIDAD_IHC_V2', N'SP_INTEROPERABILIDAD');
OPEN objs;
FETCH NEXT FROM objs INTO @o, @def;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @i = 1;
    WHILE @i <= (SELECT MAX(orden) FROM @palabras)
    BEGIN
        SET @p = (SELECT palabra FROM @palabras WHERE orden = @i);
        SET @pos = CHARINDEX(@p, @def);
        SET @n = 0;
        WHILE @pos > 0 AND @n < 4
        BEGIN
            SET @n += 1;
            INSERT @frag VALUES (@o, @p, @n, @pos,
                                 SUBSTRING(@def, CASE WHEN @pos > 120 THEN @pos - 120 ELSE 1 END, 300));
            SET @pos = CHARINDEX(@p, @def, @pos + 300);
        END;
        SET @i += 1;
    END;
    FETCH NEXT FROM objs INTO @o, @def;
END;
CLOSE objs; DEALLOCATE objs;

SELECT objeto, palabra, n, posicion, fragmento FROM @frag ORDER BY objeto, palabra, n;
GO

/* =============================================================================
   HISTORIA CLÍNICA → RESUMEN DE LA ATENCIÓN · RONDA 4 (corta)
   ESTRICTAMENTE SOLO LECTURA · Base objetivo: ESEHSVP
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md. Lo aprendido: MAPEO_HIS.md §2.9.
   Confirma las hipótesis que dejó la ronda 3, con resultados pequeños:

     R4-1  ¿NU_ESTA_HICL = 1 es «la consulta tiene exámenes o procedimientos
           ordenados»? (cruce estado × órdenes)
     R4-2  Los códigos de la fórmula: unidad de dosis (TX_UMDSIS_HMED, p. ej.
           «168»), frecuencia (TX_CDFREC_HMED, p. ej. «2»), vía y duración; y
           los catálogos que los traducen.
     R4-3  Cómo se lee el texto de la dosis (DE_DOSIS_HMED) y la indicación
           (TX_INDDOS_HMED): 8 renglones SIN ningún dato del paciente.
     R4-4  Las series posfechadas: cuántas órdenes, a cuántos días cada una, y
           si repiten los mismos medicamentos (para no listarlos dos veces).
     R4-5  Los campos de la plantilla que le sirven al paciente (motivo,
           diagnóstico, conducta, educación, próximo control, signos vitales…)
           en TODAS las plantillas de consulta; y qué valores guardan las
           casillas numéricas (¿0/1?).
     R4-6  Fragmentos del código de interoperabilidad (lo que se cortó en R3-9),
           más cortos.

   Consulta = TX_TIPO_HICL 'CON' sin registro de ingreso, últimos 30 días.

   QUÉ HACE Y QUÉ NO HACE: solo SELECT; tablas temporales (#) en tempdb;
   conteos, códigos, nombres de campos y de medicamentos. R4-3 es la única con
   texto clínico: 8 instrucciones de dosis SIN paciente ni historia.

   DEVOLVERLO: un mensaje por bloque (R4-5 y R4-6, cada uno solo).
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- =============================================================================
-- R4-0 · Consultas ambulatorias de 30 días (OBLIGATORIO, PRIMERO)
-- =============================================================================
DECLARE @hoy date = CAST(GETDATE() AS date);
DECLARE @desde date = DATEADD(day, -30, @hoy);
DECLARE @id_max bigint = (SELECT MAX(NU_NUME_HICL) FROM dbo.HISTORIACLINICA);
DECLARE @id_min bigint = (SELECT MIN(NU_NUME_HICL) FROM dbo.HISTORIACLINICA);
DECLARE @id_desde bigint = @id_max - 60000;   -- 30 días ≈ 16.000 historias: 60.000 sobra (se verifica abajo)
IF @id_desde < @id_min SET @id_desde = @id_min;

IF OBJECT_ID('tempdb..#c30') IS NOT NULL DROP TABLE #c30;
SELECT h.NU_NUME_HICL AS id, h.FE_FECH_HICL AS fecha, h.NU_ESTA_HICL AS estado, h.TX_CODSER_HICL AS ser,
       h.NU_AUTO_DAPL_HICL AS dapl
  INTO #c30
  FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
 WHERE h.NU_NUME_HICL >= @id_desde
   AND h.FE_FECH_HICL >= @desde AND h.FE_FECH_HICL < @hoy
   AND h.TX_TIPO_HICL = 'CON' AND ISNULL(h.NU_NUME_REG_HICL, 0) = 0
OPTION (MAXDOP 1, RECOMPILE);
CREATE UNIQUE CLUSTERED INDEX ix_c30 ON #c30 (id);

SELECT N'R4-0' AS bloque, COUNT(*) AS consultas_30_dias,
       MIN(fecha) AS primera,
       CASE WHEN @id_desde = @id_min
              OR (SELECT MIN(FE_FECH_HICL) FROM dbo.HISTORIACLINICA WITH (NOLOCK)
                   WHERE NU_NUME_HICL BETWEEN @id_desde AND @id_desde + 100) < @desde
            THEN N'SI' ELSE N'NO (avísame)' END AS ventana_completa
  FROM #c30;
GO

-- =============================================================================
-- R4-1 · ¿NU_ESTA_HICL = 1 es «tiene exámenes o procedimientos ordenados»?
-- =============================================================================
IF OBJECT_ID('tempdb..#c30') IS NULL BEGIN RAISERROR(N'Corre primero R4-0 en esta misma ventana.', 16, 1); RETURN; END;

SELECT c.estado,
       x.con_proc   AS con_examenes_o_proc,
       x.con_med    AS con_medicamentos,
       COUNT(*)     AS consultas
  FROM #c30 c
 CROSS APPLY (SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o WITH (NOLOCK)
                                        WHERE o.NU_NUME_HICL_HORD = c.id AND o.NU_TIPO_HORD IN (1, 2, 3, 4)) THEN 1 ELSE 0 END AS con_proc,
                     CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o WITH (NOLOCK)
                                        WHERE o.NU_NUME_HICL_HORD = c.id AND o.NU_TIPO_HORD = 5) THEN 1 ELSE 0 END AS con_med) x
 GROUP BY c.estado, x.con_proc, x.con_med
 ORDER BY c.estado, x.con_proc, x.con_med
OPTION (MAXDOP 1);
GO

-- =============================================================================
-- R4-2 · Los códigos de la fórmula y sus catálogos
-- =============================================================================
IF OBJECT_ID('tempdb..#c30') IS NULL BEGIN RAISERROR(N'Corre primero R4-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#m') IS NOT NULL DROP TABLE #m;
SELECT o.TX_TIAP_HORD AS tiap, m.TX_UMDSIS_HMED AS umdsis, m.TX_CDFREC_HMED AS cdfrec, m.NU_CTFREC_HMED AS ctfrec,
       m.TX_CDVIAD_HMED AS cdviad, m.TX_VIAD_HMED AS viad, m.TX_DURA_HMED AS dura, m.DE_UNME_HMED AS unme,
       m.TX_FOFA_HMED AS fofa
  INTO #m
  FROM #c30 c
  JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = c.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI  m WITH (NOLOCK) ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
OPTION (MAXDOP 1);

-- (a) valores de cada código (los 15 más usados de cada uno)
SELECT campo, puesto, valor, renglones
  FROM (SELECT campo, valor, COUNT(*) AS renglones, ROW_NUMBER() OVER (PARTITION BY campo ORDER BY COUNT(*) DESC) AS puesto
          FROM (SELECT N'TX_UMDSIS_HMED (unidad de dosis)' AS campo, CAST(umdsis AS nvarchar(60)) AS valor FROM #m
                UNION ALL SELECT N'TX_CDFREC_HMED (unidad de frecuencia)', CAST(cdfrec AS nvarchar(60)) FROM #m
                UNION ALL SELECT N'NU_CTFREC_HMED (cada cuánto)', CAST(ctfrec AS nvarchar(60)) FROM #m
                UNION ALL SELECT N'TX_CDVIAD_HMED (código de vía)', CAST(cdviad AS nvarchar(60)) FROM #m
                UNION ALL SELECT N'TX_VIAD_HMED (vía)', CAST(viad AS nvarchar(60)) FROM #m
                UNION ALL SELECT N'TX_DURA_HMED (duración)', CAST(dura AS nvarchar(60)) FROM #m
                UNION ALL SELECT N'DE_UNME_HMED (unidad)', CAST(unme AS nvarchar(60)) FROM #m
                UNION ALL SELECT N'TX_FOFA_HMED (forma)', CAST(fofa AS nvarchar(60)) FROM #m) v
         GROUP BY campo, valor) x
 WHERE puesto <= 15
 ORDER BY campo, puesto;

-- (b) catálogos candidatos (por nombre de tabla o de columna)
SELECT DISTINCT t.name AS tabla, c.name AS columna,
       (SELECT SUM(ps.row_count) FROM sys.dm_db_partition_stats ps WHERE ps.object_id = t.object_id AND ps.index_id IN (0, 1)) AS filas
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
 WHERE t.is_ms_shipped = 0
   AND t.name NOT LIKE N'HIST[_]MEDI%'
   AND (   t.name LIKE N'%FRECU%' OR t.name LIKE N'%UNIDAD%' OR t.name LIKE N'%UMM%' OR t.name LIKE N'%VIA[_]%'
        OR t.name LIKE N'%VIAADM%' OR t.name LIKE N'%DOSIS%' OR t.name LIKE N'%POSOLOG%'
        OR c.name LIKE N'%CDFREC%' OR c.name LIKE N'%UMDSIS%' OR c.name LIKE N'%CDVIAD%')
 ORDER BY tabla, columna;
GO

-- =============================================================================
-- R4-3 · Cómo se lee la dosis: 8 renglones de fórmula SIN paciente ni historia
-- =============================================================================
IF OBJECT_ID('tempdb..#c30') IS NULL BEGIN RAISERROR(N'Corre primero R4-0 en esta misma ventana.', 16, 1); RETURN; END;

SELECT TOP (8)
       o.TX_TIAP_HORD                                  AS tiap,
       m.NO_NOMB_ARTI_HMED                             AS medicamento,
       LEFT(CAST(m.DE_DOSIS_HMED AS varchar(max)), 200) AS dosis_texto,
       LEFT(m.TX_INDDOS_HMED, 200)                     AS indicacion,
       m.NU_CANT_HMED                                  AS cantidad,
       m.NU_CTDSIS_HMED                                AS dosis_cant,
       m.TX_UMDSIS_HMED                                AS dosis_unidad,
       m.NU_CTFREC_HMED                                AS cada,
       m.TX_CDFREC_HMED                                AS frecuencia_unidad,
       m.TX_DURA_HMED                                  AS duracion
  FROM #c30 c
  JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = c.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI  m WITH (NOLOCK) ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
 WHERE DATALENGTH(m.TX_INDDOS_HMED) > 0
 ORDER BY m.NU_NUME_HMED DESC
OPTION (MAXDOP 1);
GO

-- =============================================================================
-- R4-4 · Series posfechadas (NU_ORDEN_FECHAPOS = orden que encabeza la serie)
--
-- (a) distribución: órdenes por serie y a cuántos días de la consulta queda cada
--     entrega; (b) ¿las órdenes de una serie repiten los mismos medicamentos?
-- =============================================================================
IF OBJECT_ID('tempdb..#c30') IS NULL BEGIN RAISERROR(N'Corre primero R4-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#s') IS NOT NULL DROP TABLE #s;
SELECT c.id AS hc, o.NU_AUTO_HORD AS orden, o.NU_ORDEN_FECHAPOS AS serie, o.TX_TIAP_HORD AS tiap,
       DATEDIFF(day, c.fecha, o.FE_POSFECHA) AS dias_desde_la_consulta,
       (SELECT COUNT(*) FROM dbo.HIST_MEDI m WITH (NOLOCK) WHERE m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD) AS renglones
  INTO #s
  FROM #c30 c
  JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = c.id AND o.NU_TIPO_HORD = 5
OPTION (MAXDOP 1);

-- (a1) ¿la orden que encabeza la serie es una de la misma consulta?
SELECT COUNT(DISTINCT serie) AS series,
       SUM(misma)               AS ordenes_cuya_serie_es_de_la_misma_consulta,
       SUM(en_serie)            AS ordenes_en_serie
  FROM (SELECT s.serie,
               CASE WHEN s.serie IS NOT NULL AND EXISTS (SELECT 1 FROM #s s2 WHERE s2.orden = s.serie AND s2.hc = s.hc) THEN 1 ELSE 0 END AS misma,
               CASE WHEN s.serie IS NOT NULL THEN 1 ELSE 0 END AS en_serie
          FROM #s s) x;

-- (a2) órdenes por serie
SELECT ordenes_en_la_serie, COUNT(*) AS series
  FROM (SELECT serie, COUNT(*) AS ordenes_en_la_serie FROM #s WHERE serie IS NOT NULL GROUP BY serie) x
 GROUP BY ordenes_en_la_serie ORDER BY ordenes_en_la_serie;

-- (a3) a cuántos días de la consulta queda cada entrega posfechada
SELECT CASE WHEN dias_desde_la_consulta IS NULL THEN N'(sin posfecha)'
            ELSE CAST((dias_desde_la_consulta / 10) * 10 AS nvarchar(10)) + N'-' + CAST((dias_desde_la_consulta / 10) * 10 + 9 AS nvarchar(10)) END AS dias,
       COUNT(*) AS ordenes
  FROM #s
 GROUP BY CASE WHEN dias_desde_la_consulta IS NULL THEN N'(sin posfecha)'
               ELSE CAST((dias_desde_la_consulta / 10) * 10 AS nvarchar(10)) + N'-' + CAST((dias_desde_la_consulta / 10) * 10 + 9 AS nvarchar(10)) END
 ORDER BY MIN(ISNULL(dias_desde_la_consulta, -1));

-- (b) en 300 consultas con series: medicamentos repetidos entre órdenes de la misma consulta
;WITH meds AS (
    SELECT TOP (300) WITH TIES s.hc
      FROM #s s WHERE s.serie IS NOT NULL GROUP BY s.hc ORDER BY s.hc DESC
), r AS (
    SELECT s.hc, m.CD_CODI_ARTI_HMED AS articulo, COUNT(*) AS veces
      FROM #s s
      JOIN dbo.HIST_MEDI m WITH (NOLOCK) ON m.NU_AUTO_HORD_HMED = s.orden
     WHERE s.hc IN (SELECT hc FROM meds)
     GROUP BY s.hc, m.CD_CODI_ARTI_HMED
)
SELECT veces AS el_mismo_medicamento_aparece, COUNT(*) AS casos FROM r GROUP BY veces ORDER BY veces;
GO

-- =============================================================================
-- R4-5 · Campos de la plantilla útiles para el paciente, en TODAS las plantillas
--        de consulta (últimos 7 días; solo nombres de campos y largos)
--
-- (a) campos de los grupos o con nombre de motivo, enfermedad actual,
--     diagnóstico, análisis, conducta, plan, educación, recomendaciones, control,
--     signos vitales; (b) qué valores guardan las casillas NUME de esos grupos.
-- =============================================================================
IF OBJECT_ID('tempdb..#c30') IS NULL BEGIN RAISERROR(N'Corre primero R4-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#d7') IS NOT NULL DROP TABLE #d7;
SELECT c.id, c.dapl, r.NU_NUME_PLHI_RPET AS plhi
  INTO #d7
  FROM #c30 c
  JOIN dbo.DATOS_PLANTILLA dp WITH (NOLOCK) ON dp.NU_AUTO_DAPL = c.dapl
  LEFT JOIN dbo.R_PLAN_ESP_TIAT r WITH (NOLOCK) ON r.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL
 WHERE c.fecha >= DATEADD(day, -7, CAST(GETDATE() AS date))
OPTION (MAXDOP 1);

IF OBJECT_ID('tempdb..#campos') IS NOT NULL DROP TABLE #campos;
SELECT rc.NU_NUME_PLHI_RPC AS plhi, rc.NU_INDI_RPC AS indi, g.CD_CODI_GRHI AS grupo, co.CD_CODI_COHI AS campo
  INTO #campos
  FROM dbo.R_PLAN_CONC rc
  JOIN dbo.GRUPO_HIST g     ON g.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC
  JOIN dbo.CONCEPTO_HIST co ON co.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
 WHERE rc.NU_NUME_PLHI_RPC IN (SELECT DISTINCT plhi FROM #d7)
   AND EXISTS (SELECT 1 FROM (VALUES (N'%MOTIVO%'), (N'%ENFERMEDAD ACTUAL%'), (N'%DIAGN%'), (N'%DX%'), (N'%AN_LISIS%'),
                                     (N'%CONDUCTA%'), (N'%PLAN %'), (N'%PLAN'), (N'%EDUCACI%'), (N'%RECOMEND%'),
                                     (N'%CONTROL%'), (N'%SIGNOS%'), (N'%ALARMA%'), (N'%INDICACI%'), (N'%METAS%'),
                                     (N'%ANOTACI%'), (N'%TRATAMIENTO%'), (N'%RIESGO CARDIOVASCULAR%')) p(patron)
                WHERE UPPER(g.CD_CODI_GRHI) LIKE p.patron OR UPPER(co.CD_CODI_COHI) LIKE p.patron);

IF OBJECT_ID('tempdb..#v') IS NOT NULL DROP TABLE #v;
CREATE TABLE #v (id int, plhi int, indi int, clase varchar(5), bytes int, numero float NULL);
INSERT #v SELECT d.id, d.plhi, t.NU_INDI_DPTE, 'TEXT', DATALENGTH(t.TX_DESC_DPTE), NULL
            FROM #d7 d JOIN dbo.DATOS_PLANTILLA_TEXT t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPTE = d.dapl
           WHERE EXISTS (SELECT 1 FROM #campos k WHERE k.plhi = d.plhi AND k.indi = t.NU_INDI_DPTE) OPTION (MAXDOP 1);
INSERT #v SELECT d.id, d.plhi, t.NU_INDI_DPME, 'MEMO', DATALENGTH(t.TX_DESC_DPME), NULL
            FROM #d7 d JOIN dbo.DATOS_PLANTILLA_MEMO t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPME = d.dapl
           WHERE EXISTS (SELECT 1 FROM #campos k WHERE k.plhi = d.plhi AND k.indi = t.NU_INDI_DPME) OPTION (MAXDOP 1);
INSERT #v SELECT d.id, d.plhi, t.NU_INDI_DPNU, 'NUME', 8, t.NU_DESC_DPNU
            FROM #d7 d JOIN dbo.DATOS_PLANTILLA_NUME t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPNU = d.dapl
           WHERE EXISTS (SELECT 1 FROM #campos k WHERE k.plhi = d.plhi AND k.indi = t.NU_INDI_DPNU) OPTION (MAXDOP 1);

-- (a)
SELECT p.TX_DESC_PLHI AS plantilla, k.grupo, k.campo, v.clase,
       COUNT(DISTINCT v.id) AS consultas_con_valor,
       CAST(100.0 * COUNT(DISTINCT v.id) / NULLIF(MAX(tot.n), 0) AS decimal(5, 1)) AS pct,
       AVG(v.bytes) AS bytes_promedio, MAX(v.bytes) AS bytes_max
  FROM #v v
  JOIN #campos k ON k.plhi = v.plhi AND k.indi = v.indi
  LEFT JOIN (SELECT plhi, COUNT(*) AS n FROM #d7 GROUP BY plhi) tot ON tot.plhi = v.plhi
  LEFT JOIN dbo.PLANTILLA_HIST p ON p.NU_NUME_PLHI = v.plhi
 GROUP BY p.TX_DESC_PLHI, k.grupo, k.campo, v.clase
 ORDER BY plantilla, k.grupo, consultas_con_valor DESC;

-- (b) las casillas numéricas: qué valores guardan (si es 0/1, es una casilla marcada)
SELECT TOP (60) p.TX_DESC_PLHI AS plantilla, k.campo,
       STRING_AGG(CAST(CONCAT(x.numero, N' (', x.n, N')') AS nvarchar(max)), N' · ') AS valores
  FROM (SELECT plhi, indi, numero, COUNT(*) AS n FROM #v WHERE clase = 'NUME' GROUP BY plhi, indi, numero) x
  JOIN #campos k ON k.plhi = x.plhi AND k.indi = x.indi
  LEFT JOIN dbo.PLANTILLA_HIST p ON p.NU_NUME_PLHI = x.plhi
 GROUP BY p.TX_DESC_PLHI, k.campo
 ORDER BY plantilla, k.campo;
GO

-- =============================================================================
-- R4-6 · Fragmentos del código de interoperabilidad (220 caracteres, hasta 3
--        por palabra) — reemplaza R3-9, que se cortó
-- =============================================================================
DECLARE @frag TABLE (objeto sysname, palabra nvarchar(40), n int, fragmento nvarchar(300));
DECLARE @palabras TABLE (orden int IDENTITY, palabra nvarchar(40));
INSERT @palabras (palabra) VALUES (N'TX_TIAP_HORD'), (N'''AE'''), (N'''AI'''), (N'NU_ESTA_HICL'), (N'TX_UMDSIS'),
                                  (N'TX_CDFREC'), (N'FE_POSFECHA'), (N'NU_ESTA_HMED');

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
        WHILE @pos > 0 AND @n < 3
        BEGIN
            SET @n += 1;
            INSERT @frag VALUES (@o, @p, @n, SUBSTRING(@def, CASE WHEN @pos > 90 THEN @pos - 90 ELSE 1 END, 220));
            SET @pos = CHARINDEX(@p, @def, @pos + 220);
        END;
        SET @i += 1;
    END;
    FETCH NEXT FROM objs INTO @o, @def;
END;
CLOSE objs; DEALLOCATE objs;

SELECT objeto, palabra, n, REPLACE(REPLACE(fragmento, CHAR(13), N' '), CHAR(10), N' ') AS fragmento
  FROM @frag ORDER BY objeto, palabra, n;
GO

-- =============================================================================
-- R4-7 · Los catálogos que traducen los códigos de la fórmula (agregado tras la
--        corrida del 2026-10-28; se puede correr solo, no necesita R4-0)
--
-- Los dio el propio SP_INTEROPERABILIDAD_IHC_V2 (R4-6): la unidad de frecuencia
-- (TX_CDFREC_HMED) se traduce con PAC_CONFIG_HIS tipo 37 y la unidad de dosis
-- (TX_UMDSIS_HMED) con INV_CONFIG_MED tipo 1. Son catálogos: sin pacientes.
-- =============================================================================
SELECT N'frecuencia (PAC_CONFIG_HIS tipo 37)' AS catalogo, TX_CODI_CONF_HIS AS codigo, TX_DESC_CONF_HIS AS descripcion, NU_ESTA_CONF_HIS AS activo
  FROM dbo.PAC_CONFIG_HIS WITH (NOLOCK)
 WHERE NU_TIPO_CONF_HIS = 37
 ORDER BY TX_CODI_CONF_HIS;

SELECT N'unidad de dosis (INV_CONFIG_MED tipo 1), las usadas' AS catalogo, TX_CODI_CONF_MED AS codigo, TX_NOMB_CONF_MED AS descripcion, NU_ESTA_CONF_MED AS activo
  FROM dbo.INV_CONFIG_MED WITH (NOLOCK)
 WHERE NU_TIPO_CONF_MED = 1
   AND TX_CODI_CONF_MED IN ('168', '137', '0', '214', '173', '9000', '62', '247', '172', '72', '65', '176', '77')
 ORDER BY TX_CODI_CONF_MED;
GO

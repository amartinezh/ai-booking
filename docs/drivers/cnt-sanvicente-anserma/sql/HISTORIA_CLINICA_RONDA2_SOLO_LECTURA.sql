/* =============================================================================
   HISTORIA CLÍNICA → RESUMEN DE LA ATENCIÓN · RONDA 2
   ESTRICTAMENTE SOLO LECTURA · Base objetivo: ESEHSVP
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md. Lo aprendido en la ronda 1 está en
   MAPEO_HIS.md §2.9. En una línea: HISTORIACLINICA es solo la CABECERA de la
   atención (16 columnas, ~100 bytes, sin texto). El contenido cuelga de ella
   por tres caminos:

     NU_NUME_HICL ──▶ HIST_ORDEN (NU_NUME_HICL_HORD) ──▶ HIST_PROC, HIST_MEDI… (NU_AUTO_HORD_xxxx)
                 ├──▶ HIST_INDI, HIST_INCA, HIST_REMI, HIST_ORTIAT, HIST_TEMLABO… (NU_NUME_HICL_xxxx)
     NU_AUTO_DAPL_HICL ──▶ DATOS_PLANTILLA ──▶ DATOS_PLANTILLA_TEXT / _MEMO (el texto del médico)
     NU_NUME_LABO_HICL ──▶ LABORATORIO, R_LABO_DIAG (diagnósticos)

   Esta ronda responde:
     R2-1  el esquema y los índices de esas tablas (para el mapeo y para que
           el agente las lea por índice);
     R2-2  qué tipos de historia hay (TX_TIPO_HICL), en qué estado
           (NU_ESTA_HICL), de qué servicio, y qué trae cada tipo
           (órdenes, medicamentos, indicaciones, incapacidad, remisión,
           diagnósticos, texto de plantilla); y cuántas tienen un diagnóstico
           sensible (decisión D7);
     R2-3  el código que escribe la historia y el que la cierra;
     R2-4  catálogos sin datos de pacientes (tipos de diagnóstico, finalidad,
           plantillas, conceptos de la plantilla que parecen motivo/plan);
     R2-5  SOLO EN PRUEBAS: todas las filas de segundo nivel de una atención de
           prueba (complementa HC-9).

   QUÉ HACE Y QUÉ NO HACE
     · Solo SELECT (y sp_executesql de consultas SELECT armadas aquí). No
       escribe en ESEHSVP ni ejecuta procedimientos del hospital.
     · Copia a tablas temporales (#) solo la cabecera de las historias de 30
       días (número, fecha, tipo, estado, servicio, médico y llaves de enlace;
       sin paciente ni texto). Se borran solas al cerrar la ventana.
     · Solo conteos y catálogos. Ningún nombre, documento ni texto clínico.
     · Lectura sin bloqueos (READ UNCOMMITTED), un solo procesador (MAXDOP 1).

   CÓMO CORRERLO
     1. SSMS, usuario administrador, ventana NUEVA, F5 con todo. R2-0 va
        primero (los demás usan lo que deja en #r2 y #h30). Mejor después de
        las 19:00 o un domingo.
     2. Para devolverme los resultados sin que se corte el mensaje (el chat
        corta en ~50.000 caracteres): «Consulta → Resultados en archivo»
        (Ctrl+Mayús+F) antes de F5 genera UN archivo .rpt con todo; o guarda
        cada cuadrícula como CSV. Ponlo en una carpeta de este Mac y dime la
        ruta. Las celdas XML de R2-3 se abren con clic y se guardan como .sql.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- =============================================================================
-- R2-0 · Frontera de 30 días y cabeceras de la ventana (OBLIGATORIO, PRIMERO)
-- =============================================================================
DECLARE @obj int = OBJECT_ID(N'dbo.HISTORIACLINICA');
IF @obj IS NULL
BEGIN
    RAISERROR(N'No existe dbo.HISTORIACLINICA en esta base. ¿La ventana está en ESEHSVP?', 16, 1);
    RETURN;
END;
IF (SELECT COUNT(*) FROM sys.columns
     WHERE object_id = @obj
       AND name IN (N'NU_NUME_HICL', N'FE_FECH_HICL', N'CD_MED_REAL_HICL', N'TX_TIPO_HICL', N'NU_ESTA_HICL',
                    N'TX_ASISTE_HICL', N'TX_CODSER_HICL', N'NU_AUTO_DAPL_HICL', N'NU_NUME_LABO_HICL',
                    N'NU_NUME_PADR_HICL', N'NU_NUME_REG_HICL')) <> 11
BEGIN
    RAISERROR(N'HISTORIACLINICA cambió: falta alguna de las columnas de la ronda 1. Avísame antes de seguir.', 16, 1);
    RETURN;
END;

DECLARE @dias int = 30, @paso bigint = 20000, @tope_tramos int = 100;
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

IF OBJECT_ID('tempdb..#r2') IS NOT NULL DROP TABLE #r2;
CREATE TABLE #r2 (clave varchar(30) NOT NULL PRIMARY KEY, valor bigint NULL);
INSERT #r2 VALUES ('id_desde_30d', @id_desde), ('confiable', @confiable);

IF OBJECT_ID('tempdb..#h30') IS NOT NULL DROP TABLE #h30;
SELECT h.NU_NUME_HICL      AS id,
       h.FE_FECH_HICL      AS fecha,
       h.TX_TIPO_HICL      AS tipo,
       h.NU_ESTA_HICL      AS estado,
       h.TX_ASISTE_HICL    AS asiste,
       h.TX_CODSER_HICL    AS ser,
       h.CD_MED_REAL_HICL  AS med,
       h.NU_AUTO_DAPL_HICL AS dapl,
       h.NU_NUME_LABO_HICL AS labo,
       h.NU_NUME_PADR_HICL AS padre,
       h.NU_NUME_REG_HICL  AS reg
  INTO #h30
  FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
 WHERE h.NU_NUME_HICL >= @id_desde
   AND h.FE_FECH_HICL >= @desde AND h.FE_FECH_HICL < @hoy
OPTION (MAXDOP 1, RECOMPILE);
CREATE UNIQUE CLUSTERED INDEX ix_h30 ON #h30 (id);

SELECT N'R2-0' AS bloque, @id_desde AS leer_desde_nu_nume_hicl, @tramos AS tramos_leidos,
       CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO (avísame antes de seguir)' END AS frontera_confiable,
       (SELECT COUNT(*) FROM #h30) AS historias_30_dias;
GO

-- =============================================================================
-- R2-1 · Esquema e índices de las tablas del contenido
--
-- (a) qué tablas y por qué entran (lista fija + las que se enlazan por la
--     nomenclatura del HIS con HIST_ORDEN o DATOS_PLANTILLA), su tamaño y sus
--     columnas de enlace; (b) sus columnas; (c) sus índices; (d) qué tablas
--     apuntan a LABORATORIO (para saber qué es una «atención» en este HIS).
-- =============================================================================
IF OBJECT_ID('tempdb..#t2') IS NOT NULL DROP TABLE #t2;
CREATE TABLE #t2 (object_id int NOT NULL PRIMARY KEY, tabla sysname, por_que nvarchar(200));

INSERT #t2 (object_id, tabla, por_que)
SELECT t.object_id, t.name, N'lista'
  FROM sys.tables t
 WHERE t.name IN (N'DATOS_PLANTILLA', N'DATOS_PLANTILLA_MEMO', N'DATOS_PLANTILLA_TEXT', N'PLANTILLA_HIST',
                  N'CONCEPTO_HIST', N'GRUPO_HIST', N'R_PLAN_CONC', N'R_PLAN_ESP_TIAT', N'VALCONC_HIST1',
                  N'HIST_MEDI', N'HIST_MEDI_FREC', N'HIST_MEDI_JUST', N'HIST_ORDEN', N'HIST_PROC', N'HIST_INDI',
                  N'R_LABO_DIAG', N'LABORATORIO', N'REGISTRO', N'DIAGNOSTICO', N'TIPODIAGNOSTICO',
                  N'FINALIDAD_CONS', N'CAUSAEXTERNA', N'ARTICULO', N'ARTICULO_IUM', N'MEDICAMENTOS_DCI',
                  N'PRINCIPIOSMED_DCI', N'IN_R_CUM_ARTI', N'ALERGIAS_INTOLERANCIAS', N'CONEXIONES',
                  N'INGRESO_URGENCIAS', N'INTER_RES1888', N'ANTECEDENTES', N'HIST_ORTIAT');

INSERT #t2 (object_id, tabla, por_que)
SELECT t.object_id, t.name, N'enlace: ' + MIN(c.name)
  FROM sys.columns c
  JOIN sys.tables t ON t.object_id = c.object_id AND t.is_ms_shipped = 0
 WHERE (c.name LIKE N'NU[_]AUTO[_]DAPL[_]%' OR c.name LIKE N'NU[_]AUTO[_]HORD[_]%')
   AND t.object_id <> OBJECT_ID(N'dbo.HISTORIACLINICA')
   AND t.object_id NOT IN (SELECT object_id FROM #t2)
 GROUP BY t.object_id, t.name;

-- (a)
SELECT t.tabla, t.por_que,
       (SELECT SUM(ps.row_count) FROM sys.dm_db_partition_stats ps
         WHERE ps.object_id = t.object_id AND ps.index_id IN (0, 1)) AS filas,
       (SELECT SUM(ps.used_page_count) * 8 FROM sys.dm_db_partition_stats ps
         WHERE ps.object_id = t.object_id) AS kb_usados,
       (SELECT STRING_AGG(CAST(c.name AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.column_id)
          FROM sys.columns c
         WHERE c.object_id = t.object_id
           AND (c.name LIKE N'NU[_]AUTO[_]DAPL%' OR c.name LIKE N'NU[_]AUTO[_]HORD%' OR c.name LIKE N'NU[_]NUME[_]HICL%'
                OR c.name LIKE N'NU[_]NUME[_]LABO%' OR c.name LIKE N'NU[_]HIST[_]PAC%' OR c.name LIKE N'%CONC%')) AS columnas_de_enlace
  FROM #t2 t
 ORDER BY filas DESC;

-- (b)
SELECT t.tabla, c.column_id AS n, c.name AS columna, ty.name AS tipo,
       CASE WHEN c.max_length = -1 THEN 'max'
            WHEN ty.name IN ('nvarchar', 'nchar') THEN CAST(c.max_length / 2 AS varchar(10))
            WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary') THEN CAST(c.max_length AS varchar(10))
            ELSE 'NULL' END AS ancho,
       CASE WHEN c.is_nullable = 1 THEN 'SI' ELSE 'NO' END AS acepta_nulos,
       CASE WHEN c.is_identity = 1 THEN 'SI' ELSE '' END AS identidad
  FROM #t2 t
  JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
 ORDER BY t.tabla, c.column_id;

-- (c)
SELECT t.tabla, i.name AS indice, i.type_desc AS tipo, i.is_primary_key AS llave_primaria, i.is_unique AS unico,
       STRING_AGG(CAST(c.name AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columnas
  FROM #t2 t
  JOIN sys.indexes i        ON i.object_id = t.object_id AND i.index_id > 0
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0
  JOIN sys.columns c        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
 GROUP BY t.tabla, i.name, i.type_desc, i.is_primary_key, i.is_unique
 ORDER BY t.tabla, i.is_primary_key DESC, i.name;

-- (d)
SELECT t.name AS tabla, c.name AS columna,
       (SELECT SUM(ps.row_count) FROM sys.dm_db_partition_stats ps
         WHERE ps.object_id = t.object_id AND ps.index_id IN (0, 1)) AS filas
  FROM sys.columns c
  JOIN sys.tables t ON t.object_id = c.object_id AND t.is_ms_shipped = 0
 WHERE c.name LIKE N'NU[_]NUME[_]LABO[_]%'
 ORDER BY filas DESC;
GO

-- =============================================================================
-- R2-2 · Qué es cada tipo de historia y qué trae (últimos 30 días)
--
-- (a) tipo × estado × «asiste»: aquí se ve qué tipo es la consulta externa,
--     cuál es la marca de «cerrada» y qué son las evoluciones (con padre);
-- (b) tipo × servicio (los 60 más usados, con su nombre);
-- (c) tipo × cargo del médico que atendió;
-- (d) qué trae cada tipo: % con órdenes, indicaciones, incapacidad, remisión,
--     interconsulta, datos RIPS, plantilla;
-- (e) las órdenes por tipo de orden, y qué tablas cuelgan de ellas (ahí se ve
--     cuál NU_TIPO_HORD es medicamentos y cuál procedimientos);
-- (f) diagnósticos por tipo y cuántas atenciones tienen un diagnóstico sensible.
-- =============================================================================
IF OBJECT_ID('tempdb..#h30') IS NULL
BEGIN
    RAISERROR(N'Corre primero el bloque R2-0 en esta misma ventana.', 16, 1);
    RETURN;
END;
DECLARE @id_desde bigint = (SELECT valor FROM #r2 WHERE clave = 'id_desde_30d');
DECLARE @total int = (SELECT COUNT(*) FROM #h30);

-- (a)
SELECT tipo, estado, asiste,
       COUNT(*)                                                             AS historias,
       CAST(100.0 * COUNT(*) / NULLIF(@total, 0) AS decimal(5, 1))          AS pct,
       SUM(CASE WHEN ISNULL(padre, 0) <> 0 THEN 1 ELSE 0 END)               AS con_padre,
       SUM(CASE WHEN ISNULL(reg, 0)   <> 0 THEN 1 ELSE 0 END)               AS con_registro,
       SUM(CASE WHEN dapl IS NOT NULL THEN 1 ELSE 0 END)                    AS con_plantilla,
       COUNT(DISTINCT labo)                                                 AS labos_distintos,
       COUNT(DISTINCT ser)                                                  AS servicios,
       COUNT(DISTINCT med)                                                  AS medicos,
       MIN(fecha)                                                           AS primera,
       MAX(fecha)                                                           AS ultima
  FROM #h30
 GROUP BY tipo, estado, asiste
 ORDER BY historias DESC;

-- (b)
SELECT TOP (60) h.tipo, h.ser AS servicio, s.NO_NOMB_SER AS nombre, COUNT(*) AS historias,
       CAST(100.0 * COUNT(*) / NULLIF(@total, 0) AS decimal(5, 1)) AS pct
  FROM #h30 h
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = h.ser
 GROUP BY h.tipo, h.ser, s.NO_NOMB_SER
 ORDER BY historias DESC;

-- (c)
SELECT h.tipo, ISNULL(m.DE_CARG_MED, N'(sin cargo o no encontrado)') AS cargo,
       COUNT(*) AS historias, COUNT(DISTINCT h.med) AS medicos
  FROM #h30 h
  LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = h.med
 GROUP BY h.tipo, m.DE_CARG_MED
 ORDER BY h.tipo, historias DESC;

-- (d)
SELECT h.tipo,
       COUNT(*)                                            AS historias,
       SUM(CASE WHEN o.k  IS NOT NULL THEN 1 ELSE 0 END)   AS con_ordenes,
       SUM(CASE WHEN i.k  IS NOT NULL THEN 1 ELSE 0 END)   AS con_indicaciones,
       SUM(CASE WHEN ic.k IS NOT NULL THEN 1 ELSE 0 END)   AS con_incapacidad,
       SUM(CASE WHEN r.k  IS NOT NULL THEN 1 ELSE 0 END)   AS con_remision,
       SUM(CASE WHEN ot.k IS NOT NULL THEN 1 ELSE 0 END)   AS con_hist_ortiat,
       SUM(CASE WHEN ce.k IS NOT NULL THEN 1 ELSE 0 END)   AS con_certificado,
       SUM(CASE WHEN tl.k IS NOT NULL THEN 1 ELSE 0 END)   AS con_datos_rips,
       SUM(CASE WHEN h.dapl IS NOT NULL THEN 1 ELSE 0 END) AS con_plantilla
  FROM #h30 h
  LEFT JOIN (SELECT DISTINCT NU_NUME_HICL_HORD AS k FROM dbo.HIST_ORDEN    WITH (NOLOCK) WHERE NU_NUME_HICL_HORD >= @id_desde) o  ON o.k  = h.id
  LEFT JOIN (SELECT DISTINCT NU_NUME_HICL_HIND AS k FROM dbo.HIST_INDI     WITH (NOLOCK) WHERE NU_NUME_HICL_HIND >= @id_desde) i  ON i.k  = h.id
  LEFT JOIN (SELECT DISTINCT NU_NUME_HICL_HINC AS k FROM dbo.HIST_INCA     WITH (NOLOCK) WHERE NU_NUME_HICL_HINC >= @id_desde) ic ON ic.k = h.id
  LEFT JOIN (SELECT DISTINCT NU_NUME_HICL_HREM AS k FROM dbo.HIST_REMI     WITH (NOLOCK) WHERE NU_NUME_HICL_HREM >= @id_desde) r  ON r.k  = h.id
  LEFT JOIN (SELECT DISTINCT NU_NUME_HICL_HOTA AS k FROM dbo.HIST_ORTIAT   WITH (NOLOCK) WHERE NU_NUME_HICL_HOTA >= @id_desde) ot ON ot.k = h.id
  LEFT JOIN (SELECT DISTINCT NU_NUME_HICL_HCER AS k FROM dbo.HIST_CERT     WITH (NOLOCK) WHERE NU_NUME_HICL_HCER >= @id_desde) ce ON ce.k = h.id
  LEFT JOIN (SELECT DISTINCT NU_NUME_HICL_HTLA AS k FROM dbo.HIST_TEMLABO  WITH (NOLOCK) WHERE NU_NUME_HICL_HTLA >= @id_desde) tl ON tl.k = h.id
 GROUP BY h.tipo
 ORDER BY historias DESC
OPTION (MAXDOP 1, RECOMPILE);

-- (e) órdenes de la ventana
IF OBJECT_ID('tempdb..#o30') IS NOT NULL DROP TABLE #o30;
SELECT o.NU_AUTO_HORD AS k, o.NU_NUME_HICL_HORD AS id, o.NU_TIPO_HORD AS tipo_orden, o.TX_TIAP_HORD AS tiap
  INTO #o30
  FROM dbo.HIST_ORDEN o WITH (NOLOCK)
 WHERE o.NU_NUME_HICL_HORD >= @id_desde
   AND o.NU_NUME_HICL_HORD IN (SELECT id FROM #h30)
OPTION (MAXDOP 1);
CREATE CLUSTERED INDEX ix_o30 ON #o30 (k);

-- (e1) órdenes por tipo de historia, tipo de orden y TX_TIAP_HORD
SELECT h.tipo AS tipo_historia, o.tipo_orden, o.tiap, COUNT(*) AS ordenes, COUNT(DISTINCT o.id) AS historias
  FROM #o30 o
  JOIN #h30 h ON h.id = o.id
 GROUP BY h.tipo, o.tipo_orden, o.tiap
 ORDER BY ordenes DESC;

-- (e2) qué tablas cuelgan de esas órdenes (NU_AUTO_HORD_xxxx), por tipo de orden
IF OBJECT_ID('tempdb..#e2') IS NOT NULL DROP TABLE #e2;
CREATE TABLE #e2 (tabla sysname, columna sysname, tipo_historia varchar(10) NULL, tipo_orden int NULL,
                  filas int NULL, ordenes int NULL, historias int NULL, nota nvarchar(400) NULL);
DECLARE @t sysname, @col sysname, @sql nvarchar(max);
DECLARE porOrden CURSOR LOCAL FAST_FORWARD FOR
    SELECT t.name, c.name
      FROM sys.columns c
      JOIN sys.tables t ON t.object_id = c.object_id AND t.is_ms_shipped = 0
     WHERE c.name LIKE N'NU[_]AUTO[_]HORD[_]%'
       AND t.name NOT LIKE N'%[_]T';  -- las *_T están vacías (temporales del HIS)
OPEN porOrden;
FETCH NEXT FROM porOrden INTO @t, @col;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'INSERT #e2 (tabla, columna, tipo_historia, tipo_orden, filas, ordenes, historias)
                 SELECT @t, @col, h.tipo, o.tipo_orden, COUNT(*), COUNT(DISTINCT o.k), COUNT(DISTINCT o.id)
                   FROM dbo.' + QUOTENAME(@t) + N' x WITH (NOLOCK)
                   JOIN #o30 o ON o.k = x.' + QUOTENAME(@col) + N'
                   JOIN #h30 h ON h.id = o.id
                  GROUP BY h.tipo, o.tipo_orden
                 OPTION (MAXDOP 1);';
    BEGIN TRY
        EXEC sp_executesql @sql, N'@t sysname, @col sysname', @t = @t, @col = @col;
    END TRY
    BEGIN CATCH
        INSERT #e2 (tabla, columna, nota) VALUES (@t, @col, LEFT(N'ERROR: ' + ERROR_MESSAGE(), 400));
    END CATCH;
    FETCH NEXT FROM porOrden INTO @t, @col;
END;
CLOSE porOrden; DEALLOCATE porOrden;
SELECT * FROM #e2 ORDER BY tabla, filas DESC;

-- (f) diagnósticos: R_LABO_DIAG por la atención (NU_NUME_LABO_HICL)
DECLARE @col_labo sysname = (SELECT TOP (1) name FROM sys.columns
                              WHERE object_id = OBJECT_ID(N'dbo.R_LABO_DIAG') AND name LIKE N'NU[_]NUME[_]LABO%' ORDER BY column_id);
DECLARE @col_dx   sysname = (SELECT TOP (1) name FROM sys.columns
                              WHERE object_id = OBJECT_ID(N'dbo.R_LABO_DIAG') AND name LIKE N'CD[_]%DIAG%' ORDER BY column_id);
IF @col_labo IS NULL OR @col_dx IS NULL
    SELECT N'R2-2 (f): R_LABO_DIAG no tiene columnas NU_NUME_LABO_xxx y CD_xxx_DIAG_xxx; se arma en la ronda 3 con R2-1 (b).' AS aviso;
ELSE
BEGIN
    SET @sql = N'
    IF OBJECT_ID(''tempdb..#dx'') IS NOT NULL DROP TABLE #dx;
    SELECT DISTINCT h.labo, h.tipo, UPPER(LTRIM(RTRIM(CAST(x.' + QUOTENAME(@col_dx) + N' AS varchar(10))))) AS dx
      INTO #dx
      FROM dbo.R_LABO_DIAG x WITH (NOLOCK)
      JOIN (SELECT DISTINCT labo, tipo FROM #h30) h ON h.labo = x.' + QUOTENAME(@col_labo) + N'
    OPTION (MAXDOP 1);

    -- (f1) cuántas atenciones tienen diagnóstico y cuántos diagnósticos traen
    SELECT h.tipo, COUNT(DISTINCT h.labo) AS atenciones,
           COUNT(DISTINCT d.labo) AS con_diagnostico,
           CAST(1.0 * COUNT(d.dx) / NULLIF(COUNT(DISTINCT d.labo), 0) AS decimal(5, 2)) AS diagnosticos_por_atencion
      FROM (SELECT DISTINCT labo, tipo FROM #h30) h
      LEFT JOIN #dx d ON d.labo = h.labo AND d.tipo = h.tipo
     GROUP BY h.tipo
     ORDER BY atenciones DESC;

    -- (f2) atenciones con un diagnóstico sensible (lista propuesta para D7; solo conteos)
    SELECT d.tipo,
           CASE WHEN d.dx LIKE ''B2[0-4]%'' OR d.dx LIKE ''Z21%''           THEN ''VIH''
                WHEN d.dx LIKE ''F%''                                       THEN ''Salud mental (F00-F99)''
                WHEN d.dx LIKE ''T74%'' OR d.dx LIKE ''T76%'' OR d.dx LIKE ''Y0[5-7]%''
                  OR d.dx LIKE ''Z044%'' OR d.dx LIKE ''Z045%''             THEN ''Violencia o abuso''
                WHEN d.dx LIKE ''O04%''                                     THEN ''Interrupción del embarazo''
                WHEN d.dx LIKE ''A5[0-9]%'' OR d.dx LIKE ''A6[0-4]%''       THEN ''ITS (A50-A64)''
           END AS categoria,
           COUNT(DISTINCT d.labo) AS atenciones
      FROM #dx d
     WHERE d.dx LIKE ''B2[0-4]%'' OR d.dx LIKE ''Z21%'' OR d.dx LIKE ''F%''
        OR d.dx LIKE ''T74%'' OR d.dx LIKE ''T76%'' OR d.dx LIKE ''Y0[5-7]%''
        OR d.dx LIKE ''Z044%'' OR d.dx LIKE ''Z045%'' OR d.dx LIKE ''O04%''
        OR d.dx LIKE ''A5[0-9]%'' OR d.dx LIKE ''A6[0-4]%''
     GROUP BY d.tipo,
           CASE WHEN d.dx LIKE ''B2[0-4]%'' OR d.dx LIKE ''Z21%''           THEN ''VIH''
                WHEN d.dx LIKE ''F%''                                       THEN ''Salud mental (F00-F99)''
                WHEN d.dx LIKE ''T74%'' OR d.dx LIKE ''T76%'' OR d.dx LIKE ''Y0[5-7]%''
                  OR d.dx LIKE ''Z044%'' OR d.dx LIKE ''Z045%''             THEN ''Violencia o abuso''
                WHEN d.dx LIKE ''O04%''                                     THEN ''Interrupción del embarazo''
                WHEN d.dx LIKE ''A5[0-9]%'' OR d.dx LIKE ''A6[0-4]%''       THEN ''ITS (A50-A64)''
           END
     ORDER BY d.tipo, atenciones DESC;

    -- (f3) los 25 diagnósticos más frecuentes (código CIE-10; solo conteos)
    SELECT TOP (25) d.dx, COUNT(DISTINCT d.labo) AS atenciones
      FROM #dx d
     GROUP BY d.dx
     ORDER BY atenciones DESC;';
    EXEC sp_executesql @sql;
END;
GO

-- =============================================================================
-- R2-3 · El código que escribe y que cierra la historia
--
-- PA_Ins_HISTORIACLINICA (lo usa la aplicación para crearla), todo módulo que
-- toque NU_ESTA_HICL (quién la cierra o la firma) y SP_INTEROPERABILIDAD (el
-- de 2023, que SÍ lee el texto de la plantilla: DATOS_PLANTILLA_TEXT/_MEMO).
-- El de IHC_V2 ya salió en HC-4e; si no lo guardaste, aquí va de nuevo.
-- Clic en cada celda XML → se abre el código → Archivo → Guardar como .sql.
-- =============================================================================
SELECT o.name AS objeto, o.type_desc AS tipo, o.modify_date AS modificado, LEN(m.definition) AS largo,
       CASE WHEN m.definition LIKE N'%NU[_]ESTA[_]HICL%' THEN 'SI' ELSE '' END AS toca_el_estado,
       (SELECT m.definition AS [processing-instruction(codigo)] FOR XML PATH(''), TYPE) AS codigo_completo
  FROM sys.sql_modules m
  JOIN sys.objects o ON o.object_id = m.object_id
 WHERE o.name IN (N'PA_Ins_HISTORIACLINICA', N'SP_INTEROPERABILIDAD', N'SP_INTEROPERABILIDAD_IHC_V2')
    OR m.definition LIKE N'%NU[_]ESTA[_]HICL%'
 ORDER BY CASE WHEN o.name = N'PA_Ins_HISTORIACLINICA' THEN 0 ELSE 1 END, o.name;
GO

-- =============================================================================
-- R2-4 · Catálogos (sin datos de pacientes)
--
-- (a) tipos de diagnóstico; (b) finalidad de la consulta; (c) plantillas de
-- historia; (d) conceptos de plantilla cuyo nombre suena a motivo, enfermedad
-- actual, análisis, plan, conducta, recomendaciones, signos de alarma o
-- control: son los campos de texto que irían en el resumen.
-- =============================================================================
IF OBJECT_ID(N'dbo.TIPODIAGNOSTICO') IS NOT NULL SELECT N'TIPODIAGNOSTICO' AS _catalogo, * FROM dbo.TIPODIAGNOSTICO;
IF OBJECT_ID(N'dbo.FINALIDAD_CONS')  IS NOT NULL SELECT N'FINALIDAD_CONS'  AS _catalogo, * FROM dbo.FINALIDAD_CONS;
IF OBJECT_ID(N'dbo.PLANTILLA_HIST')  IS NOT NULL SELECT N'PLANTILLA_HIST'  AS _catalogo, * FROM dbo.PLANTILLA_HIST;

DECLARE @filtro nvarchar(max) = (
    SELECT STRING_AGG(CAST(N'UPPER(CAST(' + QUOTENAME(c.name) + N' AS nvarchar(1000))) LIKE N''%' + p.palabra + N'%''' AS nvarchar(max)), N' OR ')
      FROM sys.columns c
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
     CROSS JOIN (VALUES (N'MOTIVO'), (N'ENFERMEDAD ACTUAL'), (N'ANALISIS'), (N'ANÁLISIS'), (N'PLAN'), (N'CONDUCTA'),
                        (N'RECOMEND'), (N'ALARMA'), (N'CONTROL'), (N'INDICAC'), (N'EDUCACI'), (N'IMPRESI'),
                        (N'DIAGN'), (N'EVOLUCI'), (N'SUBJETIV'), (N'OBJETIV')) p(palabra)
     WHERE c.object_id = OBJECT_ID(N'dbo.CONCEPTO_HIST')
       AND ty.name IN ('varchar', 'nvarchar', 'char', 'nchar')
       AND c.max_length BETWEEN 1 AND 2000);
IF @filtro IS NULL
    SELECT N'R2-4 (d): CONCEPTO_HIST no tiene columnas de texto (o no existe).' AS aviso;
ELSE
BEGIN
    DECLARE @sql nvarchar(max) = N'SELECT N''CONCEPTO_HIST'' AS _catalogo, * FROM dbo.CONCEPTO_HIST WHERE ' + @filtro + N';';
    EXEC sp_executesql @sql;
END;
GO

-- =============================================================================
-- R2-5 · SOLO EN PRUEBAS · Segundo nivel de una atención de prueba
--
-- Complementa HC-9: con el mismo paciente de PRUEBA, trae lo que cuelga de sus
-- órdenes (HIST_PROC, HIST_MEDI…), de su plantilla (DATOS_PLANTILLA y sus
-- tablas de texto) y de su atención (LABORATORIO, R_LABO_DIAG).
-- =============================================================================
DECLARE @documento_de_prueba varchar(20) = '';      -- ← documento del paciente de PRUEBA
DECLARE @confirmo_paciente_de_prueba bit = 0;       -- ← 1 solo si se corre fuera de PRUEBAS

IF @documento_de_prueba = ''
BEGIN
    RAISERROR(N'R2-5: escribe el documento del paciente de prueba (se omite el bloque).', 10, 1);
    RETURN;
END;
IF DB_NAME() <> N'PRUEBAS' AND @confirmo_paciente_de_prueba = 0
BEGIN
    RAISERROR(N'R2-5 es para PRUEBAS. Fuera de ella, solo con un paciente de prueba y @confirmo_paciente_de_prueba = 1.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('tempdb..#hp') IS NOT NULL DROP TABLE #hp;
SELECT NU_NUME_HICL AS id, NU_AUTO_DAPL_HICL AS dapl, NU_NUME_LABO_HICL AS labo
  INTO #hp
  FROM dbo.HISTORIACLINICA
 WHERE NU_HIST_PAC_HICL = @documento_de_prueba;

IF OBJECT_ID('tempdb..#op') IS NOT NULL DROP TABLE #op;
SELECT NU_AUTO_HORD AS k INTO #op FROM dbo.HIST_ORDEN WHERE NU_NUME_HICL_HORD IN (SELECT id FROM #hp);

SELECT N'HIST_ORDEN' AS _tabla, * FROM dbo.HIST_ORDEN WHERE NU_NUME_HICL_HORD IN (SELECT id FROM #hp);

DECLARE @t sysname, @col sysname, @via varchar(10), @sql nvarchar(max);
IF COL_LENGTH(N'dbo.LABORATORIO', N'NU_NUME_LABO') IS NOT NULL
    EXEC sp_executesql N'SELECT N''LABORATORIO'' AS _tabla, * FROM dbo.LABORATORIO WHERE NU_NUME_LABO IN (SELECT labo FROM #hp);';
DECLARE nivel2 CURSOR LOCAL FAST_FORWARD FOR
    SELECT t.name, c.name,
           CASE WHEN c.name LIKE N'NU[_]AUTO[_]HORD[_]%' THEN 'orden'
                WHEN c.name LIKE N'NU[_]AUTO[_]DAPL%'     THEN 'plantilla'
                ELSE 'atencion' END
      FROM sys.columns c
      JOIN sys.tables t ON t.object_id = c.object_id AND t.is_ms_shipped = 0
     WHERE t.name NOT LIKE N'%[_]T'
       AND t.name <> N'HISTORIACLINICA'
       AND (   c.name LIKE N'NU[_]AUTO[_]HORD[_]%'
            OR (c.name LIKE N'NU[_]AUTO[_]DAPL%' AND t.name LIKE N'DATOS[_]PLANTILLA%')
            OR (c.name LIKE N'NU[_]NUME[_]LABO[_]%' AND t.name = N'R_LABO_DIAG'));
OPEN nivel2;
FETCH NEXT FROM nivel2 INTO @t, @col, @via;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'SELECT TOP (500) N''' + @t + N''' AS _tabla, x.* FROM dbo.' + QUOTENAME(@t) + N' x WHERE x.' + QUOTENAME(@col)
             + CASE @via WHEN 'orden'     THEN N' IN (SELECT k FROM #op);'
                         WHEN 'plantilla' THEN N' IN (SELECT dapl FROM #hp);'
                         ELSE                  N' IN (SELECT labo FROM #hp);' END;
    EXEC sp_executesql @sql;
    FETCH NEXT FROM nivel2 INTO @t, @col, @via;
END;
CLOSE nivel2; DEALLOCATE nivel2;
GO

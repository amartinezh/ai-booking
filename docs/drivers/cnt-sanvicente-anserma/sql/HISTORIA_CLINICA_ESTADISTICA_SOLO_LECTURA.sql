/* =============================================================================
   HISTORIAS CLÍNICAS POR MES Y CUÁNTO PESAN · ESTRICTAMENTE SOLO LECTURA
   Base objetivo: ESEHSVP
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md (Fase 0). Responde: cuántas historias
   clínicas se hicieron cada mes en los últimos 6 meses (más el mes en curso),
   cuántas fueron de una cita (consulta externa), de cuántos pacientes y
   médicos, y cuántos KB ocupa esa información.

   Columnas confirmadas por HC-0 (2026-10-28): fecha FE_FECH_HICL, paciente
   NU_HIST_PAC_HICL, médico que atendió CD_MED_REAL_HICL, llave/identidad/índice
   agrupado NU_NUME_HICL. La historia NO tiene especialidad ni servicio: salen
   de la cita del mismo paciente el mismo día.

   El tamaño sale de dos formas, y conviene tener las dos:
     · E-1/E-2, ESTIMADO: lo que ocupa hoy la tabla en disco dividido por sus
       filas, multiplicado por las historias de cada mes. Incluye el espacio de
       página (y, aparte, el de índices).
     · E-3, EXACTO: suma byte a byte el contenido de cada historia de cada mes
       (DATALENGTH de todas sus columnas). Es el peso real de la información,
       sin el espacio que agrega el motor. Lee el texto largo: es lo más pesado.
     · E-4: lo mismo para las tablas que cuelgan de la historia (fórmulas,
       órdenes, diagnósticos…), si siguen la nomenclatura NU_NUME_HICL_xxxx.
     · E-5/E-6, EL PESO DE VERDAD: la ronda 1 mostró que HISTORIACLINICA es
       solo la CABECERA (~100 bytes, sin texto). El contenido está en las
       órdenes y sus medicamentos y procedimientos (HIST_ORDEN → HIST_MEDI,
       HIST_PROC), en las tablas hijas (HIST_INDI, HIST_INCA, HIST_REMI…), en
       el texto de la plantilla (DATOS_PLANTILLA → _TEXT, _MEMO) y en los
       diagnósticos de la atención (R_LABO_DIAG). E-5 suma todo eso para las
       historias de los últimos 7 días (muestra) y da los KB de una atención
       completa por tipo de historia; E-6 lo multiplica por las historias de
       cada mes. Una tabla grande sin índice por su columna de enlace se
       OMITE (y lo dice) para no recorrer millones de filas.

   CÓMO LEE: NU_NUME_HICL crece con el tiempo, así que el script camina hacia
   atrás por tramos hasta salir de la ventana y lee solo desde ahí, por el
   índice. Si sale `frontera_confiable = NO`, poner @recorrido_completo = 1
   (recorre toda la tabla: exacto aunque haya fechas desordenadas, pero pesado).

   QUÉ HACE Y QUÉ NO HACE
     · Solo SELECT. Nada de INSERT/UPDATE/DELETE/ALTER/CREATE de objetos ni EXEC
       de procedimientos del hospital. Copia lo mínimo (llave, fecha, paciente,
       médico) a tablas temporales (#) de tempdb, que se borran solas.
     · Lectura sin bloqueos (READ UNCOMMITTED), un solo procesador (MAXDOP 1).
     · No muestra nombres, documentos ni texto clínico: solo conteos y tamaños.
     · Mejor después de las 19:00 o un domingo. Si tarda mucho, poner
       @medir_bytes_exactos = 0 y @incluir_hijas = 0.

   Se corre COMPLETO de una vez (F5). Devuélveme cada cuadrícula.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

DECLARE @meses               int = 6;  -- meses completos hacia atrás, más el mes en curso
DECLARE @medir_bytes_exactos bit = 1;  -- 0 = omite E-3 (lo más pesado)
DECLARE @incluir_hijas       bit = 1;  -- 0 = omite E-4
DECLARE @recorrido_completo  bit = 0;  -- 1 = no usa la frontera: recorre toda la tabla
DECLARE @medir_peso_completo bit = 1;  -- 0 = omite E-5 y E-6
DECLARE @dias_muestra        int = 7;  -- días de historias que se pesan completas en E-5

DECLARE @obj int = OBJECT_ID(N'dbo.HISTORIACLINICA');
IF @obj IS NULL
BEGIN
    RAISERROR(N'No existe dbo.HISTORIACLINICA en esta base. ¿La ventana está en ESEHSVP?', 16, 1);
    RETURN;
END;
IF (SELECT COUNT(*) FROM sys.columns
     WHERE object_id = @obj
       AND name IN (N'NU_NUME_HICL', N'FE_FECH_HICL', N'NU_HIST_PAC_HICL', N'CD_MED_REAL_HICL',
                    N'TX_TIPO_HICL', N'NU_AUTO_DAPL_HICL', N'NU_NUME_LABO_HICL')) <> 7
BEGIN
    RAISERROR(N'HISTORIACLINICA cambió: falta alguna de las columnas confirmadas. Avísame antes de seguir.', 16, 1);
    RETURN;
END;

DECLARE @desde date = DATEADD(month, -@meses, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1));
DECLARE @hasta date = DATEADD(day, 1, CAST(GETDATE() AS date));
DECLARE @sql nvarchar(max);

-- ── Frontera: desde qué NU_NUME_HICL leer ─────────────────────────────────────
DECLARE @id_min bigint, @id_max bigint;
SELECT @id_min = MIN(NU_NUME_HICL), @id_max = MAX(NU_NUME_HICL) FROM dbo.HISTORIACLINICA;

DECLARE @paso bigint = 50000, @tope_tramos int = 200;
DECLARE @hi bigint = @id_max, @lo bigint = @id_max, @filas int, @en_ventana int, @tramos int = 0, @confiable bit = 0;
IF @recorrido_completo = 1
BEGIN
    SET @lo = @id_min;
    SET @confiable = 1;
END
ELSE
BEGIN
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
    -- El tramo MÁS NUEVO ya está fuera de la ventana: o no hay historias
    -- recientes o los números no crecen con el tiempo.
    IF @tramos = 1 AND @en_ventana = 0 SET @confiable = 0;
END;
DECLARE @id_desde bigint = CASE WHEN @lo < @id_min THEN @id_min ELSE @lo END;

SELECT N'Parámetros' AS seccion, @desde AS desde, DATEADD(day, -1, @hasta) AS hasta,
       @id_desde AS leer_desde_nu_nume_hicl, @id_max AS hasta_nu_nume_hicl,
       @tramos AS tramos_leidos,
       CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO: correr con @recorrido_completo = 1' END AS frontera_confiable;

-- ── Las historias de la ventana (solo llave, fecha, paciente y médico) ────────
IF OBJECT_ID('tempdb..#h') IS NOT NULL DROP TABLE #h;
SELECT h.NU_NUME_HICL                                        AS id,
       DATEFROMPARTS(YEAR(h.FE_FECH_HICL), MONTH(h.FE_FECH_HICL), 1) AS mes,
       CAST(h.FE_FECH_HICL AS date)                          AS dia,
       LTRIM(RTRIM(CAST(h.NU_HIST_PAC_HICL AS varchar(30)))) AS pac,
       CAST(h.CD_MED_REAL_HICL AS varchar(10))               AS med,
       h.TX_TIPO_HICL                                        AS tipo,
       CASE WHEN ISNULL(h.NU_NUME_REG_HICL, 0) = 0 THEN 1 ELSE 0 END AS amb,
       h.TX_CODSER_HICL                                      AS ser
  INTO #h
  FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
 WHERE h.NU_NUME_HICL >= @id_desde
   AND h.FE_FECH_HICL >= @desde AND h.FE_FECH_HICL < @hasta
OPTION (MAXDOP 1, RECOMPILE);

-- Citas de la ventana: paciente, día y especialidad (para saber cuáles historias son de una cita)
IF OBJECT_ID('tempdb..#cd') IS NOT NULL DROP TABLE #cd;
SELECT LTRIM(RTRIM(c.NU_HIST_PAC_CIT)) AS pac, CAST(c.FE_FECH_CIT AS date) AS dia, MIN(c.CD_CODI_ESP_CIT) AS esp
  INTO #cd
  FROM dbo.CITAS_MEDICAS c WITH (NOLOCK)
 WHERE c.FE_FECH_CIT >= @desde AND c.FE_FECH_CIT < @hasta
 GROUP BY LTRIM(RTRIM(c.NU_HIST_PAC_CIT)), CAST(c.FE_FECH_CIT AS date)
OPTION (MAXDOP 1);

IF OBJECT_ID('tempdb..#hx') IS NOT NULL DROP TABLE #hx;
SELECT h.id, h.mes, h.dia, h.pac, h.med, h.tipo, h.amb, h.ser, cd.esp,
       CASE WHEN cd.pac IS NOT NULL THEN 1 ELSE 0 END AS con_cita
  INTO #hx
  FROM #h h
  LEFT JOIN #cd cd ON cd.pac = h.pac AND cd.dia = h.dia;

-- =============================================================================
-- E-1 · Tamaño actual de la tabla (del catálogo, sin recorrer datos)
-- =============================================================================
DECLARE @filas_total bigint, @kb_datos decimal(18, 2), @kb_indices decimal(18, 2);
SELECT @filas_total = SUM(CASE WHEN index_id IN (0, 1) THEN row_count ELSE 0 END),
       @kb_datos    = SUM(CASE WHEN index_id IN (0, 1) THEN used_page_count ELSE 0 END) * 8.0,
       @kb_indices  = SUM(CASE WHEN index_id > 1 THEN used_page_count ELSE 0 END) * 8.0
  FROM sys.dm_db_partition_stats
 WHERE object_id = @obj;

DECLARE @kb_fila    decimal(18, 4) = @kb_datos / NULLIF(@filas_total, 0);
DECLARE @kb_fila_ci decimal(18, 4) = (@kb_datos + @kb_indices) / NULLIF(@filas_total, 0);

SELECT N'E-1 · Tamaño actual' AS seccion,
       @filas_total                                               AS historias_en_total,
       @kb_datos                                                  AS kb_datos,
       @kb_indices                                                AS kb_indices,
       CAST((@kb_datos + @kb_indices) / 1024.0 AS decimal(18, 1)) AS mb_total,
       CAST(@kb_fila AS decimal(10, 2))                           AS kb_promedio_por_historia,
       CAST(@kb_fila_ci AS decimal(10, 2))                        AS kb_promedio_con_indices;

-- =============================================================================
-- E-2 · Historias por mes: total, cuántas de una cita, pacientes, médicos, KB
-- =============================================================================
SELECT CASE WHEN GROUPING(mes) = 1 THEN 'TOTAL'
            ELSE CONVERT(char(7), mes, 120)
               + CASE WHEN mes = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) THEN ' (en curso)' ELSE '' END
       END                                                                AS mes,
       COUNT(*)                                                           AS historias,
       SUM(con_cita)                                                      AS con_cita_ese_dia,
       CAST(100.0 * SUM(con_cita) / NULLIF(COUNT(*), 0) AS decimal(5, 1)) AS pct_con_cita,
       COUNT(DISTINCT pac)                                                AS pacientes_distintos,
       COUNT(DISTINCT med)                                                AS medicos_distintos,
       COUNT(DISTINCT dia)                                                AS dias_con_historias,
       CAST(1.0 * COUNT(*) / NULLIF(COUNT(DISTINCT dia), 0) AS decimal(9, 1)) AS promedio_por_dia_con_atencion,
       CAST(COUNT(*) * @kb_fila AS decimal(18, 1))                        AS kb_estimados,
       CAST(COUNT(*) * @kb_fila / 1024.0 AS decimal(18, 2))               AS mb_estimados,
       CAST(COUNT(*) * @kb_fila_ci / 1024.0 AS decimal(18, 2))            AS mb_estimados_con_indices
  FROM #hx
 GROUP BY ROLLUP(mes)
 ORDER BY GROUPING(mes), mes;

-- E-2b · por cargo del médico que atendió (el cargo, no el nombre), en todo el periodo
SELECT ISNULL(m.DE_CARG_MED, N'(sin cargo o no encontrado)') AS cargo,
       COUNT(*)                                     AS historias,
       SUM(hx.con_cita)                             AS con_cita,
       SUM(1 - hx.con_cita)                         AS sin_cita,
       COUNT(DISTINCT hx.med)                       AS medicos,
       CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5, 1)) AS pct
  FROM #hx hx
  LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = hx.med
 GROUP BY m.DE_CARG_MED
 ORDER BY historias DESC;

-- E-2d · por mes y TIPO de historia (TX_TIPO_HICL). Lo que se enviaría es la
-- consulta (CON) ambulatoria (sin registro de ingreso) SIN urgencias (S39145, que
-- también llega sin registro); el piloto es medicina general + control de
-- hipertensos (S39141, S39141-1).
SELECT CONVERT(char(7), mes, 120) AS mes, tipo,
       COUNT(*)      AS historias,
       SUM(amb)      AS ambulatorias,
       SUM(CASE WHEN amb = 1 AND ISNULL(ser, '') <> 'S39145' THEN 1 ELSE 0 END) AS ambulatorias_sin_urgencias,
       SUM(CASE WHEN amb = 1 AND ser IN ('S39141', 'S39141-1') THEN 1 ELSE 0 END) AS piloto_medicina_general_e_hta,
       SUM(con_cita) AS con_cita_ese_dia
  FROM #hx
 GROUP BY mes, tipo
 ORDER BY mes, historias DESC;

-- E-2c · por especialidad de la cita del mismo día (solo las que tienen cita), y si genera RDA
SELECT TOP (30) hx.esp AS especialidad, e.NO_NOMB_ESP AS nombre, e.NU_GENRDA_ESP AS genera_rda,
       COUNT(*) AS historias,
       CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5, 1)) AS pct
  FROM #hx hx
  LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = hx.esp
 WHERE hx.con_cita = 1
 GROUP BY hx.esp, e.NO_NOMB_ESP, e.NU_GENRDA_ESP
 ORDER BY historias DESC;

-- =============================================================================
-- E-3 · KB EXACTOS por mes: suma byte a byte de todas las columnas
--       (y aparte, cuánto de eso es texto largo: anamnesis, análisis, plan…)
-- =============================================================================
IF @medir_bytes_exactos = 1
BEGIN
    DECLARE @suma nvarchar(max) = (
        SELECT STRING_AGG(CAST(N'CAST(ISNULL(DATALENGTH(' + QUOTENAME(c.name) + N'), 0) AS bigint)' AS nvarchar(max)), N' + ')
                   WITHIN GROUP (ORDER BY c.column_id)
          FROM sys.columns c WHERE c.object_id = @obj);
    DECLARE @suma_larga nvarchar(max) = (
        SELECT STRING_AGG(CAST(N'CAST(ISNULL(DATALENGTH(' + QUOTENAME(c.name) + N'), 0) AS bigint)' AS nvarchar(max)), N' + ')
                   WITHIN GROUP (ORDER BY c.column_id)
          FROM sys.columns c
          JOIN sys.types ty ON ty.user_type_id = c.user_type_id
         WHERE c.object_id = @obj
           AND (ty.name IN ('text', 'ntext', 'image', 'xml') OR c.max_length = -1 OR c.max_length > 200));

    SET @sql = N'
    SELECT CASE WHEN GROUPING(x.mes) = 1 THEN ''TOTAL''
                ELSE CONVERT(char(7), x.mes, 120)
                   + CASE WHEN x.mes = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) THEN '' (en curso)'' ELSE '''' END
           END                                                 AS mes,
           COUNT(*)                                            AS historias,
           CAST(SUM(x.b) / 1024.0 AS decimal(18, 1))           AS kb_exactos,
           CAST(SUM(x.b) / 1048576.0 AS decimal(18, 2))        AS mb_exactos,
           CAST(AVG(x.b * 1.0) / 1024.0 AS decimal(10, 2))     AS kb_promedio_por_historia,
           CAST(MAX(x.b) / 1024.0 AS decimal(10, 1))           AS kb_historia_mas_grande,
           CAST(SUM(x.bl) / 1024.0 AS decimal(18, 1))          AS kb_de_texto_largo,
           CAST(100.0 * SUM(x.bl) / NULLIF(SUM(x.b), 0) AS decimal(5, 1)) AS pct_texto_largo
      FROM (SELECT DATEFROMPARTS(YEAR(FE_FECH_HICL), MONTH(FE_FECH_HICL), 1) AS mes,
                   ' + @suma + N' AS b,
                   ' + ISNULL(@suma_larga, N'CAST(0 AS bigint)') + N' AS bl
              FROM dbo.HISTORIACLINICA WITH (NOLOCK)
             WHERE NU_NUME_HICL >= @id_desde AND FE_FECH_HICL >= @desde AND FE_FECH_HICL < @hasta) x
     GROUP BY ROLLUP(x.mes)
     ORDER BY GROUPING(x.mes), x.mes
    OPTION (MAXDOP 1, RECOMPILE);';
    EXEC sp_executesql @sql, N'@desde date, @hasta date, @id_desde bigint',
         @desde = @desde, @hasta = @hasta, @id_desde = @id_desde;
END;

-- =============================================================================
-- E-4 · Tablas que cuelgan de la historia (fórmulas, órdenes, diagnósticos…):
--       filas y KB exactos por mes de la historia a la que pertenecen
--
-- Se detectan por la nomenclatura del HIS: una columna NU_NUME_HICL_xxxx en
-- otra tabla apunta a NU_NUME_HICL. Si la columna hija es numérica, también se
-- lee solo desde la frontera.
-- =============================================================================
IF @incluir_hijas = 1
BEGIN
    IF OBJECT_ID('tempdb..#e4') IS NOT NULL DROP TABLE #e4;
    CREATE TABLE #e4 (tabla sysname, columna_hija sysname, mes varchar(20),
                      filas bigint, historias_con_filas bigint, kb_exactos decimal(18, 1));

    IF OBJECT_ID('tempdb..#ids') IS NOT NULL DROP TABLE #ids;
    SELECT id AS k, mes INTO #ids FROM #h;
    CREATE UNIQUE CLUSTERED INDEX ix_ids ON #ids (k);

    DECLARE @t sysname, @col_hija sysname, @obj_hija int, @numerica bit, @suma_hija nvarchar(max);
    DECLARE hijas CURSOR LOCAL FAST_FORWARD FOR
        SELECT t.name, ch.name, t.object_id,
               CASE WHEN ty.name IN ('tinyint', 'smallint', 'int', 'bigint', 'numeric', 'decimal') THEN 1 ELSE 0 END
          FROM sys.columns ch
          JOIN sys.tables t  ON t.object_id = ch.object_id AND t.is_ms_shipped = 0
          JOIN sys.types ty  ON ty.user_type_id = ch.user_type_id
         WHERE ch.name LIKE N'NU[_]NUME[_]HICL[_]%'
           AND ch.object_id <> @obj;
    OPEN hijas;
    FETCH NEXT FROM hijas INTO @t, @col_hija, @obj_hija, @numerica;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @suma_hija = (
            SELECT STRING_AGG(CAST(N'CAST(ISNULL(DATALENGTH(ch.' + QUOTENAME(c.name) + N'), 0) AS bigint)' AS nvarchar(max)), N' + ')
                       WITHIN GROUP (ORDER BY c.column_id)
              FROM sys.columns c WHERE c.object_id = @obj_hija);

        SET @sql = N'
        INSERT #e4 (tabla, columna_hija, mes, filas, historias_con_filas, kb_exactos)
        SELECT @t, @col_hija,
               CASE WHEN GROUPING(i.mes) = 1 THEN ''TOTAL'' ELSE CONVERT(char(7), i.mes, 120) END,
               COUNT(*), COUNT(DISTINCT ch.' + QUOTENAME(@col_hija) + N'),
               CAST(SUM(' + @suma_hija + N') / 1024.0 AS decimal(18, 1))
          FROM dbo.' + QUOTENAME(@t) + N' ch WITH (NOLOCK)
'       + CASE WHEN @numerica = 1
               THEN N'          JOIN #ids i ON i.k = ch.' + QUOTENAME(@col_hija) + N'
         WHERE ch.' + QUOTENAME(@col_hija) + N' >= @id_desde'
               -- columna de texto: se compara como texto, para no fallar con un valor no numérico
               ELSE N'          JOIN #ids i ON CAST(i.k AS varchar(30)) = LTRIM(RTRIM(ch.' + QUOTENAME(@col_hija) + N'))' END + N'
         GROUP BY ROLLUP(i.mes)
        OPTION (MAXDOP 1, RECOMPILE);';
        EXEC sp_executesql @sql, N'@id_desde bigint, @t sysname, @col_hija sysname',
             @id_desde = @id_desde, @t = @t, @col_hija = @col_hija;

        FETCH NEXT FROM hijas INTO @t, @col_hija, @obj_hija, @numerica;
    END;
    CLOSE hijas; DEALLOCATE hijas;

    IF NOT EXISTS (SELECT 1 FROM #e4)
        SELECT N'E-4 · No hay tablas con columna NU_NUME_HICL_xxxx: las hijas se miden en la ronda 2, con lo que devuelvan HC-3 y HC-4.' AS aviso;
    ELSE
        SELECT tabla, columna_hija, mes, filas, historias_con_filas,
               CAST(1.0 * filas / NULLIF(historias_con_filas, 0) AS decimal(9, 2)) AS filas_por_historia,
               kb_exactos
          FROM #e4
         ORDER BY tabla, CASE WHEN mes = 'TOTAL' THEN 1 ELSE 0 END, mes;
END;

-- =============================================================================
-- E-5 · Peso COMPLETO de una atención, por tipo de historia (muestra)
--
-- Toma las historias de los últimos @dias_muestra días y suma byte a byte
-- todo lo que cuelga de ellas, por el camino que dicta la nomenclatura del HIS
-- (una tabla se cuenta UNA vez, por el primero que tenga):
--   orden      NU_AUTO_HORD_xxxx  → filas de las órdenes de esas historias (HIST_PROC, HIST_MEDI…)
--   historia   NU_NUME_HICL_xxxx  → HIST_ORDEN, HIST_INDI, HIST_INCA, HIST_REMI…
--   plantilla  NU_AUTO_DAPL(_xxxx)→ DATOS_PLANTILLA y su texto (_TEXT, _MEMO)
--   atencion   NU_NUME_LABO_xxxx  → R_LABO_DIAG (diagnósticos)
-- (a) cuánto aporta cada tabla; (b) KB por atención según el tipo de historia.
-- =============================================================================
IF @medir_peso_completo = 1
BEGIN
    DECLARE @hoy5 date = CAST(GETDATE() AS date);
    DECLARE @desde5 date = DATEADD(day, -@dias_muestra, @hoy5);

    IF OBJECT_ID('tempdb..#m5') IS NOT NULL DROP TABLE #m5;
    CREATE TABLE #m5 (id bigint NOT NULL PRIMARY KEY, tipo varchar(10) NULL, dapl bigint NULL, labo bigint NULL, bytes bigint NOT NULL);

    DECLARE @suma_hc nvarchar(max) = (
        SELECT STRING_AGG(CAST(N'CAST(ISNULL(DATALENGTH(' + QUOTENAME(c.name) + N'), 0) AS bigint)' AS nvarchar(max)), N' + ')
                   WITHIN GROUP (ORDER BY c.column_id)
          FROM sys.columns c WHERE c.object_id = @obj);
    SET @sql = N'INSERT #m5 (id, tipo, dapl, labo, bytes)
                 SELECT NU_NUME_HICL, TX_TIPO_HICL, NU_AUTO_DAPL_HICL, NU_NUME_LABO_HICL, ' + @suma_hc + N'
                   FROM dbo.HISTORIACLINICA WITH (NOLOCK)
                  WHERE NU_NUME_HICL >= @id_desde AND FE_FECH_HICL >= @desde5 AND FE_FECH_HICL < @hoy5
                 OPTION (MAXDOP 1, RECOMPILE);';
    EXEC sp_executesql @sql, N'@id_desde bigint, @desde5 date, @hoy5 date',
         @id_desde = @id_desde, @desde5 = @desde5, @hoy5 = @hoy5;

    DECLARE @id_desde5 bigint = (SELECT MIN(id) FROM #m5);
    DECLARE @n5 int = (SELECT COUNT(*) FROM #m5);

    -- Llaves de cada camino
    IF OBJECT_ID('tempdb..#k_hicl') IS NOT NULL DROP TABLE #k_hicl;
    SELECT id AS k, tipo INTO #k_hicl FROM #m5;
    CREATE UNIQUE CLUSTERED INDEX ix_k_hicl ON #k_hicl (k);

    IF OBJECT_ID('tempdb..#k_hord') IS NOT NULL DROP TABLE #k_hord;
    CREATE TABLE #k_hord (k bigint NOT NULL, tipo varchar(10) NULL);
    IF COL_LENGTH(N'dbo.HIST_ORDEN', N'NU_AUTO_HORD') IS NOT NULL AND COL_LENGTH(N'dbo.HIST_ORDEN', N'NU_NUME_HICL_HORD') IS NOT NULL
        EXEC sp_executesql N'INSERT #k_hord (k, tipo)
                             SELECT DISTINCT o.NU_AUTO_HORD, m.tipo
                               FROM dbo.HIST_ORDEN o WITH (NOLOCK)
                               JOIN #m5 m ON m.id = o.NU_NUME_HICL_HORD
                              WHERE o.NU_NUME_HICL_HORD >= @d
                             OPTION (MAXDOP 1, RECOMPILE);', N'@d bigint', @d = @id_desde5;
    CREATE CLUSTERED INDEX ix_k_hord ON #k_hord (k);

    IF OBJECT_ID('tempdb..#k_dapl') IS NOT NULL DROP TABLE #k_dapl;
    SELECT DISTINCT dapl AS k, tipo INTO #k_dapl FROM #m5 WHERE dapl IS NOT NULL;
    CREATE CLUSTERED INDEX ix_k_dapl ON #k_dapl (k);

    IF OBJECT_ID('tempdb..#k_labo') IS NOT NULL DROP TABLE #k_labo;
    SELECT labo AS k, MIN(tipo) AS tipo INTO #k_labo FROM #m5 WHERE labo IS NOT NULL GROUP BY labo;
    CREATE UNIQUE CLUSTERED INDEX ix_k_labo ON #k_labo (k);

    -- Qué tablas se pesan y por qué camino (una vez cada una)
    IF OBJECT_ID('tempdb..#e5t') IS NOT NULL DROP TABLE #e5t;
    WITH cand AS (
        SELECT t.object_id, t.name AS tabla, c.name AS columna, c.column_id,
               CASE WHEN c.name LIKE N'NU[_]AUTO[_]HORD[_]%'                                THEN 1
                    WHEN c.name LIKE N'NU[_]NUME[_]HICL[_]%'                                THEN 2
                    WHEN c.name LIKE N'NU[_]AUTO[_]DAPL[_]%'
                      OR (c.name = N'NU_AUTO_DAPL' AND t.name = N'DATOS_PLANTILLA')         THEN 3
                    WHEN c.name LIKE N'NU[_]NUME[_]LABO[_]%' AND t.name = N'R_LABO_DIAG'    THEN 4
               END AS prioridad,
               CASE WHEN ty.name IN ('tinyint', 'smallint', 'int', 'bigint', 'numeric', 'decimal') THEN 1 ELSE 0 END AS numerica
          FROM sys.columns c
          JOIN sys.tables t ON t.object_id = c.object_id AND t.is_ms_shipped = 0
          JOIN sys.types ty ON ty.user_type_id = c.user_type_id
         WHERE t.object_id <> @obj
           AND t.name NOT LIKE N'%[_]T'
    ), elegida AS (
        SELECT cand.*, ROW_NUMBER() OVER (PARTITION BY object_id ORDER BY prioridad, column_id) AS n
          FROM cand
         WHERE prioridad IS NOT NULL
    )
    SELECT e.object_id, e.tabla, e.columna, e.numerica,
           CAST(CASE e.prioridad WHEN 1 THEN 'orden' WHEN 2 THEN 'historia' WHEN 3 THEN 'plantilla' ELSE 'atencion' END AS varchar(10)) AS via,
           (SELECT SUM(ps.row_count) FROM sys.dm_db_partition_stats ps
             WHERE ps.object_id = e.object_id AND ps.index_id IN (0, 1)) AS filas_tabla,
           CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic
                              WHERE ic.object_id = e.object_id AND ic.key_ordinal = 1 AND ic.column_id = e.column_id)
                THEN 1 ELSE 0 END AS indexada
      INTO #e5t
      FROM elegida e
     WHERE e.n = 1;

    IF OBJECT_ID('tempdb..#e5') IS NOT NULL DROP TABLE #e5;
    CREATE TABLE #e5 (tabla sysname, via varchar(10), columna sysname, tipo varchar(10) NULL,
                      filas bigint NULL, bytes bigint NULL, nota nvarchar(400) NULL);

    DECLARE @o5 int, @t5 sysname, @c5 sysname, @via5 varchar(10), @num5 bit, @ft5 bigint, @idx5 bit,
            @suma5 nvarchar(max), @tabla_k nvarchar(20);
    DECLARE pesar CURSOR LOCAL FAST_FORWARD FOR
        SELECT object_id, tabla, columna, via, numerica, filas_tabla, indexada FROM #e5t;
    OPEN pesar;
    FETCH NEXT FROM pesar INTO @o5, @t5, @c5, @via5, @num5, @ft5, @idx5;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF @idx5 = 0 AND ISNULL(@ft5, 0) > 2000000
            INSERT #e5 (tabla, via, columna, nota)
            VALUES (@t5, @via5, @c5, N'omitida: ' + CONVERT(nvarchar(30), @ft5) + N' filas y sin índice por ' + @c5);
        ELSE
        BEGIN
            SET @suma5 = (
                SELECT STRING_AGG(CAST(N'CAST(ISNULL(DATALENGTH(x.' + QUOTENAME(c.name) + N'), 0) AS bigint)' AS nvarchar(max)), N' + ')
                           WITHIN GROUP (ORDER BY c.column_id)
                  FROM sys.columns c WHERE c.object_id = @o5);
            SET @tabla_k = CASE @via5 WHEN 'orden' THEN N'#k_hord' WHEN 'historia' THEN N'#k_hicl'
                                      WHEN 'plantilla' THEN N'#k_dapl' ELSE N'#k_labo' END;
            SET @sql = N'INSERT #e5 (tabla, via, columna, tipo, filas, bytes)
                         SELECT @t5, @via5, @c5, k.tipo, COUNT(*), SUM(' + @suma5 + N')
                           FROM dbo.' + QUOTENAME(@t5) + N' x WITH (NOLOCK)
                           JOIN ' + @tabla_k + N' k ON '
                     + CASE WHEN @num5 = 1 THEN N'k.k = x.' + QUOTENAME(@c5)
                            ELSE N'CAST(k.k AS varchar(30)) = LTRIM(RTRIM(x.' + QUOTENAME(@c5) + N'))' END + N'
                          GROUP BY k.tipo
                         OPTION (MAXDOP 1, RECOMPILE);';
            BEGIN TRY
                EXEC sp_executesql @sql, N'@t5 sysname, @via5 varchar(10), @c5 sysname', @t5 = @t5, @via5 = @via5, @c5 = @c5;
            END TRY
            BEGIN CATCH
                INSERT #e5 (tabla, via, columna, nota) VALUES (@t5, @via5, @c5, LEFT(N'ERROR: ' + ERROR_MESSAGE(), 400));
            END CATCH;
        END;
        FETCH NEXT FROM pesar INTO @o5, @t5, @c5, @via5, @num5, @ft5, @idx5;
    END;
    CLOSE pesar; DEALLOCATE pesar;

    -- (a) cuánto aporta cada tabla
    SELECT N'E-5 · muestra' AS seccion, @n5 AS historias_muestra, @desde5 AS desde, DATEADD(day, -1, @hoy5) AS hasta;
    SELECT tabla, via, columna,
           SUM(filas)                                                         AS filas,
           CAST(SUM(bytes) / 1024.0 AS decimal(18, 1))                        AS kb,
           CAST(1.0 * SUM(filas) / NULLIF(@n5, 0) AS decimal(9, 2))           AS filas_por_historia,
           CAST(SUM(bytes) / 1024.0 / NULLIF(@n5, 0) AS decimal(10, 3))       AS kb_por_historia,
           MAX(nota)                                                          AS nota
      FROM #e5
     GROUP BY tabla, via, columna
     ORDER BY SUM(bytes) DESC, tabla;

    -- (b) KB de una atención completa, por tipo de historia
    IF OBJECT_ID('tempdb..#peso') IS NOT NULL DROP TABLE #peso;
    SELECT m.tipo, COUNT(*) AS historias, SUM(m.bytes) AS bytes_cabecera,
           ISNULL((SELECT SUM(e.bytes) FROM #e5 e WHERE e.tipo = m.tipo), 0) AS bytes_contenido
      INTO #peso
      FROM #m5 m
     GROUP BY m.tipo;

    SELECT tipo, historias,
           CAST(bytes_cabecera / 1024.0 / NULLIF(historias, 0) AS decimal(10, 2))                      AS kb_cabecera_por_historia,
           CAST(bytes_contenido / 1024.0 / NULLIF(historias, 0) AS decimal(10, 2))                     AS kb_contenido_por_historia,
           CAST((bytes_cabecera + bytes_contenido) / 1024.0 / NULLIF(historias, 0) AS decimal(10, 2))  AS kb_total_por_historia
      FROM #peso
    UNION ALL
    SELECT 'TODAS', SUM(historias),
           CAST(SUM(bytes_cabecera) / 1024.0 / NULLIF(SUM(historias), 0) AS decimal(10, 2)),
           CAST(SUM(bytes_contenido) / 1024.0 / NULLIF(SUM(historias), 0) AS decimal(10, 2)),
           CAST((SUM(bytes_cabecera) + SUM(bytes_contenido)) / 1024.0 / NULLIF(SUM(historias), 0) AS decimal(10, 2))
      FROM #peso
     ORDER BY historias DESC;

    -- =========================================================================
    -- E-6 · KB por mes de la información COMPLETA: historias de cada mes ×
    --       KB de una atención de su tipo (de la muestra de E-5; un tipo que no
    --       salió en la muestra usa el promedio de todas)
    -- =========================================================================
    DECLARE @kb_prom decimal(18, 4) = (SELECT (SUM(bytes_cabecera) + SUM(bytes_contenido)) / 1024.0 / NULLIF(SUM(historias), 0) FROM #peso);

    SELECT CASE WHEN GROUPING(x.mes) = 1 THEN 'TOTAL'
                ELSE CONVERT(char(7), x.mes, 120)
                   + CASE WHEN x.mes = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) THEN ' (en curso)' ELSE '' END
           END                                                       AS mes,
           COUNT(*)                                                  AS historias,
           CAST(SUM(ISNULL(p.kb, @kb_prom)) AS decimal(18, 1))         AS kb_estimados_atencion_completa,
           CAST(SUM(ISNULL(p.kb, @kb_prom)) / 1024.0 AS decimal(18, 2)) AS mb_estimados_atencion_completa
      FROM #hx x
      LEFT JOIN (SELECT tipo, (bytes_cabecera + bytes_contenido) / 1024.0 / NULLIF(historias, 0) AS kb FROM #peso) p
             ON p.tipo = x.tipo
     GROUP BY ROLLUP(x.mes)
     ORDER BY GROUPING(x.mes), x.mes;
END;
GO

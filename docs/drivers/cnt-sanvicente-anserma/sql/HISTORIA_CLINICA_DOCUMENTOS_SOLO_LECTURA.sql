/* =============================================================================
   HISTORIA CLÍNICA → DOCUMENTOS PARA EL PACIENTE (PDF E IMAGEN) · RONDA 5
   SOLO LECTURA · Base: ESEHSVP · Solo conteos, catálogos y textos que se repiten
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md §3.9 (los documentos). Mapeo: MAPEO_HIS.md
   §2.9, «Reportes del HIS».

   Para qué: el hospital documentó los reportes que imprime el HIS desde el
   módulo Consultas (fórmula infOrdenMedHC.rpt, orden de ayudas diagnósticas
   infOrdenADh.rpt, remisión infRemiPac.rpt, interpretación, indicaciones e
   historia). AgenIA le va a entregar al paciente esos documentos en PDF y en
   imagen, listos para imprimir. Casi todos sus campos ya están en columnas
   conocidas; este script cierra lo que falta:

     D-0  Las consultas de los últimos 30 días (piloto, consulta externa, urgencias)
     D-1  ¿HIST_IMPRESION es el registro de lo que se imprime o la «impresión
          diagnóstica»?
     D-2  ¿Dónde guarda el HIS la firma del médico que sale en todos los reportes?
     D-3  ¿Dónde están el nombre, NIT, dirección y teléfono del encabezado?
     D-4  Fórmula: qué tan llenos vienen los campos que imprime (CUM, Invima,
          concentración, dosis, instrucciones, vigencia…) y cuántos medicamentos
          trae cada orden
     D-5  Exámenes: código propio («S19304») o CUPS, indicaciones, renglones
     D-6  Remisión: qué guarda cada columna, a dónde se remite y cuánto pesa la
          descripción del caso clínico (de eso dependen sus páginas)
     D-7  Indicaciones: ¿son para el paciente o para enfermería?
     D-8  Incapacidad e interconsulta
     D-9  Encabezado: convenio, tipo de usuario, EPS, edad y código de plantilla
     D-10 Interpretación de exámenes: en qué tabla vive (para una fase posterior)
     D-11 Documentos por consulta: cuántos PDF saldrían

   CÓMO CORRERLO
     1. SSMS, ventana NUEVA, con el MISMO usuario de las rondas anteriores (no
        agenia_sync: no tiene permiso sobre la historia). El script entra solo
        a ESEHSVP (USE ESEHSVP). F5 con todo (1 a 3 minutos).
     2. Devolver un mensaje por bloque (el chat corta en ~50.000 caracteres).
     Si sale «No se ejecutó nada», el mensaje dice si fue la base o el usuario.

   QUÉ HACE Y QUÉ NO HACE
     · Solo lee. Escribe únicamente en tablas temporales (#). El SQL dinámico
       de D-1, D-2, D-3 y D-9 solo arma SELECT sobre el catálogo o sobre tablas
       pequeñas.
     · No sale ningún paciente: solo conteos, porcentajes, catálogos y textos
       libres que se repiten 10 veces o más (frases genéricas, no de una
       persona). De la remisión, el responsable, la residencia y la ficha del
       Sisbén solo se cuentan; el caso clínico solo se mide.
     · D-3 lee nombre, NIT, dirección y teléfono del hospital en tablas de 1 a 5
       filas, nunca columnas de clave, token, secreto o usuario. INTER_RES1888
       queda fuera.
     · Las tablas # con texto usan COLLATE DATABASE_DEFAULT (error 468).
   ============================================================================= */

USE ESEHSVP;   -- la base viva del HIS
GO

SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- Si no está en ESEHSVP o el usuario no ve la historia, se detiene todo aquí
-- (lo apaga la última línea del script).
IF DB_NAME() <> N'ESEHSVP' OR OBJECT_ID(N'dbo.HISTORIACLINICA') IS NULL
BEGIN
    DECLARE @por_que nvarchar(500) =
        CASE WHEN DB_NAME() <> N'ESEHSVP'
             THEN N'La ventana está en la base «' + DB_NAME() + N'», no en ESEHSVP (¿el USE ESEHSVP falló por permisos?). Elige ESEHSVP en la lista de bases de SSMS y vuelve a correr.'
             ELSE N'El usuario «' + SUSER_SNAME() + N'» no puede ver dbo.HISTORIACLINICA en ESEHSVP (agenia_sync no tiene permiso, a propósito). Conéctate con el usuario de las rondas anteriores y vuelve a correr.'
        END + N' No se ejecutó nada.';
    RAISERROR(N'%s', 16, 1, @por_que);
    SET NOEXEC ON;
END;
GO

-- =============================================================================
-- D-0 · Las consultas de los últimos 30 días
-- =============================================================================
DECLARE @desde date = DATEADD(day, -30, CAST(GETDATE() AS date));

IF OBJECT_ID(N'dbo.HISTORIACLINICA') IS NULL
BEGIN
    RAISERROR(N'No existe dbo.HISTORIACLINICA en esta base. ¿La ventana está en ESEHSVP?', 16, 1);
    RETURN;
END;

DECLARE @hasta date = DATEADD(day, 1, CAST(GETDATE() AS date));
DECLARE @id_min bigint, @id_max bigint;
SELECT @id_min = MIN(NU_NUME_HICL), @id_max = MAX(NU_NUME_HICL) FROM dbo.HISTORIACLINICA;
DECLARE @paso bigint = 20000, @tope_tramos int = 200;
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

IF OBJECT_ID('tempdb..#c') IS NOT NULL DROP TABLE #c;
SELECT h.NU_NUME_HICL      AS id,
       h.FE_FECH_HICL      AS fecha,
       h.TX_CODSER_HICL    AS ser,
       h.NU_NUME_LABO_HICL AS labo,
       h.NU_HIST_PAC_HICL  AS pac,
       h.CD_MED_REAL_HICL  AS med,
       h.NU_AUTO_DAPL_HICL AS dapl,
       CASE WHEN h.TX_CODSER_HICL IN ('S39141', 'S39141-1') THEN 1 ELSE 0 END AS piloto,
       CASE WHEN h.TX_CODSER_HICL = 'S39145' THEN 1 ELSE 0 END AS urg
  INTO #c
  FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
 WHERE h.NU_NUME_HICL >= @id_desde
   AND h.FE_FECH_HICL >= @desde AND h.FE_FECH_HICL < @hasta
   AND h.TX_TIPO_HICL = 'CON'
   AND (ISNULL(h.NU_NUME_REG_HICL, 0) = 0 OR h.TX_CODSER_HICL = 'S39145')
OPTION (MAXDOP 1, RECOMPILE);
CREATE UNIQUE CLUSTERED INDEX ix_c ON #c (id);

IF OBJECT_ID('tempdb..#alc') IS NOT NULL DROP TABLE #alc;
CREATE TABLE #alc (alcance nvarchar(40) COLLATE DATABASE_DEFAULT NOT NULL, id int NOT NULL);
INSERT #alc SELECT N'1 Piloto (S39141 + S39141-1)', id FROM #c WHERE piloto = 1;
INSERT #alc SELECT N'2 Consulta externa sin urgencias', id FROM #c WHERE urg = 0;
INSERT #alc SELECT N'3 Urgencias (S39145)', id FROM #c WHERE urg = 1;
CREATE CLUSTERED INDEX ix_alc ON #alc (id, alcance);

SELECT N'D-0' AS bloque, @desde AS desde, DATEADD(day, -1, @hasta) AS hasta, @id_desde AS leer_desde_nu_nume_hicl,
       CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO: avísame' END AS frontera_confiable,
       (SELECT COUNT(*) FROM #c WHERE piloto = 1) AS consultas_piloto,
       (SELECT COUNT(*) FROM #c WHERE urg = 0)    AS consultas_externas_sin_urgencias,
       (SELECT COUNT(*) FROM #c WHERE urg = 1)    AS consultas_urgencias;
GO

-- =============================================================================
-- D-1 · ¿Qué es HIST_IMPRESION?
--
-- Su detalle tiene TX_TIPO_IMDE varchar(4): puede ser el tipo de documento
-- impreso (fórmula, orden, remisión…) o un código CIE-10 de 4 letras («I10X»,
-- la «impresión diagnóstica»). Si es lo primero, dice qué papeles se llevan hoy
-- los pacientes de cada consulta.
-- =============================================================================
IF OBJECT_ID('tempdb..#alc') IS NULL BEGIN RAISERROR(N'Corre primero D-0 en esta misma ventana.', 16, 1); RETURN; END;

-- (a) columnas de las dos tablas
SELECT N'D-1 (a)' AS bloque, t.name AS tabla, c.column_id AS n, c.name AS columna, ty.name AS tipo, c.max_length AS largo,
       CASE WHEN c.is_identity = 1 THEN N'identidad' ELSE N'' END AS identidad,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS filas
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
 WHERE t.name IN (N'HIST_IMPRESION', N'HIST_IMPRESION_DETA')
 ORDER BY t.name, c.column_id;

-- (b) llaves foráneas que las tocan
SELECT N'D-1 (b)' AS bloque, OBJECT_NAME(fk.parent_object_id) AS tabla_hija,
       COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS columna_hija,
       OBJECT_NAME(fk.referenced_object_id) AS tabla_madre,
       COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS columna_madre
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
 WHERE OBJECT_NAME(fk.parent_object_id) IN (N'HIST_IMPRESION', N'HIST_IMPRESION_DETA')
    OR OBJECT_NAME(fk.referenced_object_id) IN (N'HIST_IMPRESION', N'HIST_IMPRESION_DETA');

-- (c) TX_TIPO_IMDE en las consultas de 30 días: sus valores más comunes y si son un CIE-10
IF OBJECT_ID('tempdb..#imde') IS NOT NULL DROP TABLE #imde;
SELECT a.alcance, d.NU_NUME_HICL_IMDE AS id, d.NU_AUTO_HIMP_IMDE AS himp,
       CAST(LTRIM(RTRIM(d.TX_TIPO_IMDE)) AS nvarchar(10)) AS valor
  INTO #imde
  FROM #alc a
  JOIN dbo.HIST_IMPRESION_DETA d ON d.NU_NUME_HICL_IMDE = a.id
 WHERE a.alcance NOT LIKE N'3%'
OPTION (MAXDOP 1);

SELECT N'D-1 (c)' AS bloque, a.alcance,
       COUNT(DISTINCT a.id) AS consultas,
       COUNT(DISTINCT i.id) AS consultas_con_detalle,
       COUNT(i.id) AS filas_de_detalle,
       CAST(COUNT(i.id) * 1.0 / NULLIF(COUNT(DISTINCT i.id), 0) AS decimal(6, 2)) AS filas_por_consulta,
       CAST(100.0 * SUM(CASE WHEN dg.CD_CODI_DIAG IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(i.id), 0) AS decimal(5, 1)) AS pct_valores_que_son_cie10
  FROM #alc a
  LEFT JOIN #imde i ON i.id = a.id AND i.alcance = a.alcance
  LEFT JOIN dbo.DIAGNOSTICO dg ON dg.CD_CODI_DIAG = i.valor
 WHERE a.alcance NOT LIKE N'3%'
 GROUP BY a.alcance
 ORDER BY a.alcance;

SELECT N'D-1 (d)' AS bloque, x.alcance, x.valor, x.filas, x.consultas, x.es_cie10, x.diagnostico_si_lo_es
  FROM (SELECT i.alcance, i.valor, COUNT(*) AS filas, COUNT(DISTINCT i.id) AS consultas,
               CASE WHEN MAX(dg.CD_CODI_DIAG) IS NOT NULL THEN N'sí' ELSE N'no' END AS es_cie10,
               MAX(dg.DE_DESC_DIAG) AS diagnostico_si_lo_es,
               ROW_NUMBER() OVER (PARTITION BY i.alcance ORDER BY COUNT(*) DESC) AS rk
          FROM #imde i
          LEFT JOIN dbo.DIAGNOSTICO dg ON dg.CD_CODI_DIAG = i.valor
         GROUP BY i.alcance, i.valor
        HAVING COUNT(*) >= 10) x
 WHERE x.rk <= 20
 ORDER BY x.alcance, x.filas DESC;

-- (e) la cabecera HIST_IMPRESION: valores de sus columnas cortas (códigos) en las filas de esas consultas
DECLARE @pk sysname, @sql nvarchar(max);
SELECT TOP (1) @pk = c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID(N'dbo.HIST_IMPRESION') AND c.is_identity = 1;
IF @pk IS NULL
    SELECT TOP (1) @pk = c.name
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
     WHERE i.object_id = OBJECT_ID(N'dbo.HIST_IMPRESION') AND i.is_primary_key = 1
     ORDER BY ic.key_ordinal;

IF @pk IS NULL OR OBJECT_ID(N'dbo.HIST_IMPRESION') IS NULL
    SELECT N'D-1 (e)' AS bloque, N'No se encontró la llave de HIST_IMPRESION: basta con (a) a (d).' AS nota;
ELSE
BEGIN
    IF OBJECT_ID('tempdb..#himp') IS NOT NULL DROP TABLE #himp;
    SELECT DISTINCT himp AS id INTO #himp FROM #imde WHERE himp IS NOT NULL AND alcance LIKE N'2%';
    SELECT @sql = STRING_AGG(CAST(
             N'SELECT N''' + c.name + N''' AS columna, CAST(x.' + QUOTENAME(c.name) + N' AS nvarchar(60)) AS valor, COUNT(*) AS filas'
           + N' FROM dbo.HIST_IMPRESION x WHERE x.' + QUOTENAME(@pk) + N' IN (SELECT id FROM #himp)'
           + N' GROUP BY x.' + QUOTENAME(c.name) + N' HAVING COUNT(*) >= 10' AS nvarchar(max)), N' UNION ALL ')
      FROM sys.columns c
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
     WHERE c.object_id = OBJECT_ID(N'dbo.HIST_IMPRESION')
       AND c.name <> @pk
       AND (ty.name IN ('tinyint', 'smallint', 'bit') OR (ty.name IN ('char', 'varchar', 'nchar', 'nvarchar') AND c.max_length BETWEEN 1 AND 40))
       AND c.name NOT LIKE '%USU%' AND c.name NOT LIKE '%MAQ%' AND c.name NOT LIKE '%EQUI%' AND c.name NOT LIKE '%HOST%'
       AND c.name NOT LIKE '%[_]IP[_]%' AND c.name NOT LIKE 'IP[_]%';
    IF @sql IS NULL
        SELECT N'D-1 (e)' AS bloque, N'HIST_IMPRESION no tiene columnas cortas que perfilar.' AS nota;
    ELSE
    BEGIN
        SET @sql = N'SELECT TOP (80) N''D-1 (e)'' AS bloque, z.columna, z.valor, z.filas FROM (' + @sql + N') z ORDER BY z.columna, z.filas DESC;';
        EXEC sys.sp_executesql @sql;
    END;
END;
GO

-- =============================================================================
-- D-2 · ¿Dónde está la firma del médico?
--
-- Todos los reportes la imprimen como imagen (fórmula, órdenes, remisión,
-- historia). MEDICOS no tiene columna de firma. Se buscan columnas de imagen o
-- binarias y las que dicen FIRM en su nombre. No se muestra ninguna imagen: de
-- las de texto, un ejemplo recortado (suele ser la ruta de un archivo).
-- =============================================================================
SELECT TOP (80) N'D-2 (a)' AS bloque, t.name AS tabla, c.name AS columna, ty.name AS tipo, c.max_length AS largo_max,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS filas,
       CASE WHEN (t.name LIKE '%FIRM%' AND t.name NOT LIKE '%CONFIRM%') OR (c.name LIKE '%FIRM%' AND c.name NOT LIKE '%CONFIRM%')
            THEN N'por el nombre' ELSE N'es imagen o binario' END AS por_que
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
 WHERE ty.name IN ('image', 'varbinary', 'binary')
    OR (t.name LIKE '%FIRM%' AND t.name NOT LIKE '%CONFIRM%')
    OR (c.name LIKE '%FIRM%' AND c.name NOT LIKE '%CONFIRM%')
 ORDER BY CASE WHEN (t.name LIKE '%FIRM%' AND t.name NOT LIKE '%CONFIRM%') OR (c.name LIKE '%FIRM%' AND c.name NOT LIKE '%CONFIRM%') THEN 0
               WHEN t.name LIKE 'MEDIC%' OR t.name LIKE '%PROF%' OR t.name LIKE '%USUA%' THEN 1 ELSE 2 END,
          filas DESC;

-- (b) las columnas con FIRM en el nombre (tablas de hasta 2 millones de filas): cuántas llenas y un ejemplo si es texto
DECLARE @sql nvarchar(max);
SELECT @sql = STRING_AGG(CAST(
         N'SELECT N''' + t.name + N''' AS tabla, N''' + c.name + N''' AS columna, N''' + ty.name + N''' AS tipo, COUNT(*) AS filas,'
       + N' SUM(CASE WHEN DATALENGTH(x.' + QUOTENAME(c.name) + N') > 0 THEN 1 ELSE 0 END) AS llenas,'
       + N' AVG(CAST(DATALENGTH(x.' + QUOTENAME(c.name) + N') AS bigint)) AS bytes_promedio, '
       + CASE WHEN ty.name IN ('char', 'varchar', 'nchar', 'nvarchar')
              THEN N'(SELECT TOP (1) LEFT(CAST(y.' + QUOTENAME(c.name) + N' AS nvarchar(200)), 120) FROM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name)
                 + N' y WHERE DATALENGTH(y.' + QUOTENAME(c.name) + N') > 0)'
              ELSE N'CAST(NULL AS nvarchar(120))' END
       + N' AS ejemplo_si_es_texto FROM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' x' AS nvarchar(max)), N' UNION ALL ')
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
 WHERE ((c.name LIKE '%FIRM%' AND c.name NOT LIKE '%CONFIRM%')
        OR (t.name LIKE '%FIRM%' AND t.name NOT LIKE '%CONFIRM%' AND ty.name IN ('image', 'varbinary', 'binary', 'char', 'varchar', 'nchar', 'nvarchar')))
   AND ty.name NOT IN ('text', 'ntext', 'xml')
   AND (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) <= 2000000;
IF @sql IS NULL
    SELECT N'D-2 (b)' AS bloque, N'Ninguna columna se llama FIRM…: la firma estaría en una tabla de imágenes de (a) o en archivos (preguntar a TI).' AS nota;
ELSE
BEGIN
    SET @sql = N'SELECT N''D-2 (b)'' AS bloque, z.* FROM (' + @sql + N') z ORDER BY z.tabla, z.columna;';
    EXEC sys.sp_executesql @sql;
END;
GO

-- =============================================================================
-- D-3 · Datos del hospital del encabezado (nombre, NIT, dirección, teléfono)
--
-- Tablas de 1 a 5 filas con una columna de NIT o con nombre de empresa,
-- entidad, institución, IPS o parámetros. Solo columnas de nombre, NIT,
-- dirección, teléfono, municipio, habilitación o sigla. Nunca claves, tokens,
-- secretos, usuarios ni rutas; INTER_RES1888 fuera.
-- =============================================================================
IF OBJECT_ID('tempdb..#d3') IS NOT NULL DROP TABLE #d3;
CREATE TABLE #d3 (tabla sysname, filas bigint, columna sysname, valor nvarchar(300) COLLATE DATABASE_DEFAULT NULL);
DECLARE @sql nvarchar(max);
WITH t AS (
    SELECT tb.object_id, s.name AS esquema, tb.name AS tabla,
           (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = tb.object_id AND p.index_id IN (0, 1)) AS filas
      FROM sys.tables tb
      JOIN sys.schemas s ON s.schema_id = tb.schema_id
     WHERE tb.name NOT LIKE 'INTER[_]%' AND tb.name NOT LIKE '%1888%'
)
SELECT @sql = STRING_AGG(CAST(
         N'INSERT #d3 SELECT TOP (5) N''' + t.tabla + N''', ' + CAST(t.filas AS nvarchar(20)) + N', N''' + c.name + N''', LEFT(CAST(x.'
       + QUOTENAME(c.name) + N' AS nvarchar(300)), 300) FROM ' + QUOTENAME(t.esquema) + N'.' + QUOTENAME(t.tabla) + N' x WHERE x.'
       + QUOTENAME(c.name) + N' IS NOT NULL;' AS nvarchar(max)), N' ')
  FROM t
  JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
 WHERE t.filas BETWEEN 1 AND 5
   AND (EXISTS (SELECT 1 FROM sys.columns n WHERE n.object_id = t.object_id AND n.name LIKE '%NIT%')
        OR t.tabla LIKE '%EMPRES%' OR t.tabla LIKE '%ENTIDAD%' OR t.tabla LIKE '%INSTITU%' OR t.tabla LIKE '%IPS%' OR t.tabla LIKE '%PARAMET%')
   AND ty.name IN ('char', 'varchar', 'nchar', 'nvarchar', 'int', 'bigint', 'numeric', 'decimal')
   AND (c.name LIKE '%NIT%' OR c.name LIKE '%NOMB%' OR c.name LIKE '%RAZ%' OR c.name LIKE '%DIRE%' OR c.name LIKE '%TEL%'
        OR c.name LIKE '%MUNI%' OR c.name LIKE '%DPTO%' OR c.name LIKE '%CIUD%' OR c.name LIKE '%HABI%' OR c.name LIKE '%REPS%' OR c.name LIKE '%SIGLA%')
   AND c.name NOT LIKE '%CLAV%' AND c.name NOT LIKE '%PASS%' AND c.name NOT LIKE '%PWD%' AND c.name NOT LIKE '%TOKEN%'
   AND c.name NOT LIKE '%SECR%' AND c.name NOT LIKE '%KEY%' AND c.name NOT LIKE '%USU%' AND c.name NOT LIKE '%CLIE%'
   AND c.name NOT LIKE '%SERVID%' AND c.name NOT LIKE '%HOST%' AND c.name NOT LIKE '%URL%' AND c.name NOT LIKE '%RUTA%';
IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;
IF NOT EXISTS (SELECT 1 FROM #d3)
    SELECT N'D-3' AS bloque, N'No hay una tabla pequeña con los datos del hospital: se configuran en AgenIA (nombre, NIT, dirección, teléfono, logo).' AS nota;
ELSE
    SELECT N'D-3' AS bloque, tabla, filas, columna, valor FROM #d3 ORDER BY tabla, columna;
GO

-- =============================================================================
-- D-4 · Fórmula (infOrdenMedHC.rpt): ¿vienen llenos los campos que imprime?
--
-- El papel trae, por medicamento: código, nombre, CUM, Invima, medida,
-- concentración, vía, cantidad (en número y letras), forma farmacéutica,
-- «Dosis y Frecuencia», «Periodo Duración Tratamiento», «Instrucciones de
-- dosificación», «Indicaciones a juicio del Prescriptor»; y por orden, la
-- vigencia («Vigente por 72 Horas»). Se quitan solo los anulados.
-- =============================================================================
IF OBJECT_ID('tempdb..#alc') IS NULL BEGIN RAISERROR(N'Corre primero D-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#o') IS NOT NULL DROP TABLE #o;
SELECT a.alcance, o.NU_AUTO_HORD AS orden, o.NU_NUME_HICL_HORD AS id, o.NU_TIPO_HORD AS tipo, o.TX_TIAP_HORD AS tiap,
       CASE WHEN o.FE_POSFECHA IS NULL THEN 0 ELSE 1 END AS posf,
       CAST(LTRIM(RTRIM(ISNULL(o.TX_VIGE_HORD, ''))) AS nvarchar(50)) COLLATE DATABASE_DEFAULT AS vigencia,
       ISNULL(DATALENGTH(o.ME_OBSERV_HORD), 0) AS largo_obs,
       ISNULL(DATALENGTH(o.ME_MATESP_HORD), 0) AS largo_matesp,
       CAST(UPPER(LTRIM(RTRIM(LEFT(REPLACE(REPLACE(CAST(o.ME_OBSERV_HORD AS varchar(max)), CHAR(13), ' / '), CHAR(10), ''), 150))))
            AS nvarchar(150)) COLLATE DATABASE_DEFAULT AS obs
  INTO #o
  FROM #alc a
  JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = a.id
 WHERE a.alcance NOT LIKE N'3%'
OPTION (MAXDOP 1);
CREATE CLUSTERED INDEX ix_o ON #o (orden);

IF OBJECT_ID('tempdb..#m') IS NOT NULL DROP TABLE #m;
SELECT o.alcance, o.orden, o.id, o.tiap, o.posf,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.NO_NOMB_ARTI_HMED, '')))) > 0 THEN 1 ELSE 0 END AS f_nombre,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.DE_UNME_HMED, '')))) > 0      THEN 1 ELSE 0 END AS f_medida,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.DE_CTRA_HMED, '')))) > 0      THEN 1 ELSE 0 END AS f_concentracion,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.TX_FOFA_HMED, '')))) > 0      THEN 1 ELSE 0 END AS f_forma,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.TX_VIAD_HMED, '')))) > 0      THEN 1 ELSE 0 END AS f_via,
       CASE WHEN ISNULL(m.NU_CANT_HMED, 0) > 0                          THEN 1 ELSE 0 END AS f_cantidad,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.TX_DURA_HMED, '')))) > 0      THEN 1 ELSE 0 END AS f_duracion,
       CASE WHEN ISNULL(DATALENGTH(m.DE_DOSIS_HMED), 0) > 0             THEN 1 ELSE 0 END AS f_dosis_his,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.TX_INDDOS_HMED, '')))) > 0    THEN 1 ELSE 0 END AS f_indicacion,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.TX_INDESP_HMED, '')))) > 0    THEN 1 ELSE 0 END AS f_indesp,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.TX_SISPRO_HMED, '')))) > 0    THEN 1 ELSE 0 END AS f_sispro,
       CASE WHEN ar.CD_CODI_ARTI IS NOT NULL                            THEN 1 ELSE 0 END AS f_catalogo,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(ar.NU_CODCUM_ARTI, '')))) > 0   THEN 1 ELSE 0 END AS f_cum,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(ar.TX_INVIMA_ARTI, '')))) > 0   THEN 1 ELSE 0 END AS f_invima,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(m.TX_SISPRO_HMED, '')))) > 0
             AND REPLACE(LTRIM(RTRIM(m.TX_SISPRO_HMED)), '-', '') = REPLACE(LTRIM(RTRIM(ISNULL(ar.NU_CODCUM_ARTI, ''))), '-', '')
            THEN 1 ELSE 0 END AS f_sispro_es_cum,
       CAST(LTRIM(RTRIM(ISNULL(m.TX_INDESP_HMED, ''))) AS nvarchar(10)) COLLATE DATABASE_DEFAULT AS indesp
  INTO #m
  FROM #o o
  JOIN dbo.HIST_MEDI m      ON m.NU_AUTO_HORD_HMED = o.orden
  LEFT JOIN dbo.ARTICULO ar ON ar.CD_CODI_ARTI = m.CD_CODI_ARTI_HMED
 WHERE o.tipo = 5
   AND ISNULL(m.NU_ESTA_HMED, 0) <> 0
OPTION (MAXDOP 1);
CREATE CLUSTERED INDEX ix_m ON #m (orden);

-- (a) % de renglones con cada campo del papel, por alcance y farmacia (AI/AE)
SELECT N'D-4 (a)' AS bloque, alcance, tiap AS ai_o_ae, COUNT(*) AS renglones,
       CAST(100.0 * SUM(f_nombre)        / COUNT(*) AS decimal(5, 1)) AS pct_nombre,
       CAST(100.0 * SUM(f_catalogo)      / COUNT(*) AS decimal(5, 1)) AS pct_en_catalogo_articulo,
       CAST(100.0 * SUM(f_cum)           / COUNT(*) AS decimal(5, 1)) AS pct_cum,
       CAST(100.0 * SUM(f_invima)        / COUNT(*) AS decimal(5, 1)) AS pct_invima,
       CAST(100.0 * SUM(f_sispro)        / COUNT(*) AS decimal(5, 1)) AS pct_tx_sispro,
       CAST(100.0 * SUM(f_sispro_es_cum) / COUNT(*) AS decimal(5, 1)) AS pct_tx_sispro_igual_al_cum,
       CAST(100.0 * SUM(f_medida)        / COUNT(*) AS decimal(5, 1)) AS pct_medida,
       CAST(100.0 * SUM(f_concentracion) / COUNT(*) AS decimal(5, 1)) AS pct_concentracion,
       CAST(100.0 * SUM(f_forma)         / COUNT(*) AS decimal(5, 1)) AS pct_forma,
       CAST(100.0 * SUM(f_via)           / COUNT(*) AS decimal(5, 1)) AS pct_via,
       CAST(100.0 * SUM(f_cantidad)      / COUNT(*) AS decimal(5, 1)) AS pct_cantidad,
       CAST(100.0 * SUM(f_duracion)      / COUNT(*) AS decimal(5, 1)) AS pct_duracion,
       CAST(100.0 * SUM(f_dosis_his)     / COUNT(*) AS decimal(5, 1)) AS pct_dosis_que_arma_el_his,
       CAST(100.0 * SUM(f_indicacion)    / COUNT(*) AS decimal(5, 1)) AS pct_indicacion_del_medico,
       CAST(100.0 * SUM(f_indesp)        / COUNT(*) AS decimal(5, 1)) AS pct_tx_indesp
  FROM #m
 GROUP BY alcance, tiap
 ORDER BY alcance, tiap;

-- (b) TX_INDESP_HMED (varchar 10): ¿un código? ¿la casilla de «Indicaciones a juicio del Prescriptor»?
SELECT TOP (15) N'D-4 (b)' AS bloque, indesp AS valor_tx_indesp, COUNT(*) AS renglones
  FROM #m
 WHERE alcance LIKE N'2%'
 GROUP BY indesp
 ORDER BY COUNT(*) DESC;

-- (c) vigencia que se imprime («Vigencia de la Orden»), por clase de orden y si es posfechada
SELECT TOP (30) N'D-4 (c)' AS bloque,
       CASE WHEN tipo = 5 THEN N'Medicamentos' ELSE N'Exámenes y procedimientos (1-4)' END AS clase,
       CASE WHEN posf = 1 THEN N'posfechada' ELSE N'del día' END AS cuando,
       CASE WHEN vigencia = N'' THEN N'(vacía)' ELSE vigencia END AS vigencia,
       COUNT(*) AS ordenes
  FROM #o
 WHERE alcance LIKE N'2%'
 GROUP BY CASE WHEN tipo = 5 THEN N'Medicamentos' ELSE N'Exámenes y procedimientos (1-4)' END,
          CASE WHEN posf = 1 THEN N'posfechada' ELSE N'del día' END,
          CASE WHEN vigencia = N'' THEN N'(vacía)' ELSE vigencia END
 ORDER BY COUNT(*) DESC;

-- (d) medicamentos por orden (cada orden es una hoja de la fórmula; cuántos caben decide sus páginas)
SELECT N'D-4 (d)' AS bloque, x.alcance,
       COUNT(*) AS ordenes,
       CAST(AVG(x.n * 1.0) AS decimal(5, 2)) AS medicamentos_por_orden,
       SUM(CASE WHEN x.n = 1 THEN 1 ELSE 0 END) AS con_1,
       SUM(CASE WHEN x.n = 2 THEN 1 ELSE 0 END) AS con_2,
       SUM(CASE WHEN x.n = 3 THEN 1 ELSE 0 END) AS con_3,
       SUM(CASE WHEN x.n = 4 THEN 1 ELSE 0 END) AS con_4,
       SUM(CASE WHEN x.n BETWEEN 5 AND 6 THEN 1 ELSE 0 END) AS con_5_a_6,
       SUM(CASE WHEN x.n BETWEEN 7 AND 10 THEN 1 ELSE 0 END) AS con_7_a_10,
       SUM(CASE WHEN x.n > 10 THEN 1 ELSE 0 END) AS con_mas_de_10,
       MAX(x.n) AS maximo
  FROM (SELECT alcance, orden, COUNT(*) AS n FROM #m GROUP BY alcance, orden) x
 GROUP BY x.alcance
 ORDER BY x.alcance;

-- (e) observación de la orden (¿«Indicaciones a juicio del Prescriptor»?): cuántas la traen y las frases repetidas
SELECT N'D-4 (e)' AS bloque, alcance,
       CASE WHEN tipo = 5 THEN N'Medicamentos' ELSE N'Exámenes y procedimientos (1-4)' END AS clase,
       COUNT(*) AS ordenes,
       CAST(100.0 * SUM(CASE WHEN largo_obs > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_observacion,
       AVG(CASE WHEN largo_obs > 0 THEN largo_obs END) AS largo_promedio,
       CAST(100.0 * SUM(CASE WHEN largo_matesp > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_me_matesp
  FROM #o
 GROUP BY alcance, CASE WHEN tipo = 5 THEN N'Medicamentos' ELSE N'Exámenes y procedimientos (1-4)' END
 ORDER BY alcance, clase;

SELECT TOP (15) N'D-4 (f)' AS bloque, CASE WHEN tipo = 5 THEN N'Medicamentos' ELSE N'Exámenes (1-4)' END AS clase,
       obs AS observacion_repetida, COUNT(*) AS ordenes
  FROM #o
 WHERE alcance LIKE N'2%' AND largo_obs > 0
 GROUP BY CASE WHEN tipo = 5 THEN N'Medicamentos' ELSE N'Exámenes (1-4)' END, obs
HAVING COUNT(*) >= 10
 ORDER BY COUNT(*) DESC;
GO

-- =============================================================================
-- D-5 · Orden de ayudas diagnósticas (infOrdenADh.rpt)
--
-- El papel imprime el código propio del HIS («S19304 - Cuadro hemático…»),
-- cantidad e indicaciones. ¿Hay CUPS al lado (TX_SISPRO_HPRO, SERVICIOS_CUPS)?
-- =============================================================================
IF OBJECT_ID('tempdb..#o') IS NULL BEGIN RAISERROR(N'Corre primero D-0 y D-4 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#p') IS NOT NULL DROP TABLE #p;
SELECT o.alcance, o.orden, o.id, o.tipo,
       CAST(LTRIM(RTRIM(p.CD_CODI_SER_HPRO)) AS nvarchar(12)) COLLATE DATABASE_DEFAULT AS codigo,
       CAST(LTRIM(RTRIM(ISNULL(p.TX_SISPRO_HPRO, ''))) AS nvarchar(50)) COLLATE DATABASE_DEFAULT AS sispro,
       ISNULL(DATALENGTH(p.DE_INDI_HPRO), 0) AS largo_ind,
       s.NO_NOMB_SER AS nombre,
       CAST(LTRIM(RTRIM(ISNULL(s.TX_CODI_SERV_SER, ''))) AS nvarchar(10)) COLLATE DATABASE_DEFAULT AS codserv
  INTO #p
  FROM #o o
  JOIN dbo.HIST_PROC p      ON p.NU_AUTO_HORD_HPRO = o.orden
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = p.CD_CODI_SER_HPRO
 WHERE o.tipo IN (1, 2, 3, 4)
OPTION (MAXDOP 1);

-- (a) por alcance y tipo de orden
SELECT N'D-5 (a)' AS bloque, alcance, tipo AS tipo_orden,
       CASE tipo WHEN 1 THEN N'Consulta o control' WHEN 2 THEN N'Laboratorio' WHEN 3 THEN N'Cirugía' ELSE N'Procedimiento o ayuda diagnóstica' END AS clase,
       COUNT(*) AS renglones, COUNT(DISTINCT orden) AS ordenes,
       CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT orden), 0) AS decimal(5, 2)) AS renglones_por_orden,
       CAST(100.0 * SUM(CASE WHEN largo_ind > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_indicacion,
       CAST(100.0 * SUM(CASE WHEN nombre IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_nombre_en_servicios,
       CAST(100.0 * SUM(CASE WHEN codigo LIKE 'S%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_codigo_empieza_por_s,
       CAST(100.0 * SUM(CASE WHEN sispro <> N'' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_tx_sispro,
       CAST(100.0 * SUM(CASE WHEN sispro LIKE '[0-9][0-9][0-9][0-9][0-9][0-9]%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_tx_sispro_6_digitos,
       CAST(100.0 * SUM(CASE WHEN codserv <> N'' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_servicios_tx_codi_serv
  FROM #p
 GROUP BY alcance, tipo
 ORDER BY alcance, tipo;

-- (b) los 20 exámenes más ordenados: código del HIS, TX_SISPRO y nombre (catálogo, sin pacientes)
SELECT TOP (20) N'D-5 (b)' AS bloque, codigo, MAX(sispro) AS tx_sispro_mas_comun, MAX(codserv) AS tx_codi_serv, MAX(nombre) AS examen,
       COUNT(*) AS renglones, COUNT(DISTINCT sispro) AS tx_sispro_distintos
  FROM #p
 WHERE alcance LIKE N'2%'
 GROUP BY codigo
 ORDER BY COUNT(*) DESC;

-- (c) SERVICIOS_CUPS: sus columnas y filas (si existe)
SELECT N'D-5 (c)' AS bloque, t.name AS tabla,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS filas,
       STRING_AGG(CAST(c.name + N' ' + ty.name AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.column_id) AS columnas
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
 WHERE t.name LIKE N'%CUPS%'
 GROUP BY t.name, t.object_id;
GO

-- =============================================================================
-- D-6 · Remisión (infRemiPac.rpt)
--
-- HIST_REMI guarda una foto de casi todo lo que imprime: institución, servicio,
-- motivo, prioridad, régimen, EPS, Sisbén, residencia, responsable y la
-- «Descripción del caso clínico» (copia de la historia: por eso el papel tiene
-- varias páginas). Datos personales (responsable, residencia, ficha) solo se
-- cuentan; el caso clínico solo se mide.
-- =============================================================================
IF OBJECT_ID('tempdb..#alc') IS NULL BEGIN RAISERROR(N'Corre primero D-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#r') IS NOT NULL DROP TABLE #r;
SELECT a.alcance, a.id, r.NU_NUME_HREM AS remi,
       CAST(LTRIM(RTRIM(r.TX_PRIO_HREM))   AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS prio,
       CAST(r.NU_INST_HREM                 AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS inst,
       CAST(r.NU_SRVREM_HREM               AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS srvrem_n,
       CAST(LTRIM(RTRIM(r.TX_SRVREM_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS srvrem_t,
       CAST(r.NU_MTVREM_HREM               AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS mtvrem,
       CAST(LTRIM(RTRIM(r.TX_TIPTRA_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS tiptra,
       CAST(LTRIM(RTRIM(r.TX_MOTATE_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS motate,
       CAST(LTRIM(RTRIM(r.TX_DESPER_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS desper,
       CAST(LTRIM(RTRIM(r.TX_MODTEC_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS modtec,
       CAST(LTRIM(RTRIM(r.TX_GRUSER_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS gruser,
       CAST(LTRIM(RTRIM(r.TX_TIPREG_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS tipreg,
       CAST(LTRIM(RTRIM(r.CD_CODI_REG_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS codreg,
       CAST(LTRIM(RTRIM(r.TX_NOMREG_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS nomreg,
       CAST(LTRIM(RTRIM(r.TX_SISBEN_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS sisben,
       CAST(LTRIM(RTRIM(r.TX_CODSER_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS codser,
       CAST(LTRIM(RTRIM(r.TX_CUPSPR_HREM)) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS cupspr,
       CAST(r.NU_CANTPR_HREM               AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS cantpr,
       CAST(UPPER(LTRIM(RTRIM(LEFT(r.DE_REMI_HREM, 120)))) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS remite_a,
       CAST(UPPER(LTRIM(RTRIM(LEFT(r.TX_SERV_HREM, 120)))) AS nvarchar(120)) COLLATE DATABASE_DEFAULT AS servicio,
       CAST(UPPER(LTRIM(RTRIM(LEFT(r.TX_ADMIN_HREM, 60)))) AS nvarchar(120))  COLLATE DATABASE_DEFAULT AS eps,
       ISNULL(DATALENGTH(r.DE_DESC_HREM), 0)  AS l_desc,
       ISNULL(DATALENGTH(r.TX_CASO_HREM), 0)  AS l_caso,
       ISNULL(LEN(r.TX_DATACO_HREM), 0)       AS l_dataco,
       ISNULL(LEN(r.TX_REHA_HREM), 0)         AS l_reha,
       ISNULL(LEN(r.TX_REAC_HREM), 0)         AS l_reac,
       ISNULL(LEN(r.TX_FICHA_HREM), 0)        AS l_ficha,
       CASE WHEN r.FE_FECHA_HREM IS NOT NULL THEN 1 ELSE 0 END AS f_fecha,
       CASE WHEN CAST(r.TX_CASO_HREM AS varchar(20)) LIKE 'Consulta %' THEN 1 ELSE 0 END AS caso_empieza_por_consulta
  INTO #r
  FROM #alc a
  JOIN dbo.HIST_REMI r ON r.NU_NUME_HICL_HREM = a.id
OPTION (MAXDOP 1);

-- (a) cuántas
SELECT N'D-6 (a)' AS bloque, a.alcance,
       COUNT(DISTINCT a.id) AS consultas,
       COUNT(DISTINCT r.id) AS consultas_con_remision,
       CAST(100.0 * COUNT(DISTINCT r.id) / NULLIF(COUNT(DISTINCT a.id), 0) AS decimal(5, 1)) AS pct,
       COUNT(r.remi) AS remisiones,
       CAST(COUNT(r.remi) * 1.0 / NULLIF(COUNT(DISTINCT r.id), 0) AS decimal(5, 2)) AS remisiones_por_consulta_con_remision
  FROM #alc a
  LEFT JOIN #r r ON r.id = a.id AND r.alcance = a.alcance
 GROUP BY a.alcance
 ORDER BY a.alcance;

-- (b) qué tan llena viene cada columna (y cuánto mide)
SELECT N'D-6 (b)' AS bloque, r.alcance, v.columna,
       CAST(100.0 * SUM(CASE WHEN v.largo > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_llena,
       AVG(CASE WHEN v.largo > 0 THEN v.largo END) AS largo_promedio,
       MAX(v.largo) AS largo_maximo
  FROM #r r
 CROSS APPLY (VALUES
       (N'TX_PRIO_HREM (prioridad)', LEN(r.prio)), (N'NU_INST_HREM (institución)', LEN(r.inst)),
       (N'NU_SRVREM_HREM', LEN(r.srvrem_n)), (N'TX_SRVREM_HREM', LEN(r.srvrem_t)), (N'NU_MTVREM_HREM (motivo)', LEN(r.mtvrem)),
       (N'TX_TIPTRA_HREM', LEN(r.tiptra)), (N'TX_MOTATE_HREM', LEN(r.motate)), (N'TX_DESPER_HREM', LEN(r.desper)),
       (N'TX_MODTEC_HREM (modalidad)', LEN(r.modtec)), (N'TX_GRUSER_HREM (grupo de servicio)', LEN(r.gruser)),
       (N'TX_TIPREG_HREM (régimen)', LEN(r.tipreg)), (N'CD_CODI_REG_HREM', LEN(r.codreg)), (N'TX_NOMREG_HREM', LEN(r.nomreg)),
       (N'TX_SISBEN_HREM', LEN(r.sisben)), (N'TX_CODSER_HREM', LEN(r.codser)), (N'TX_CUPSPR_HREM (CUPS)', LEN(r.cupspr)),
       (N'NU_CANTPR_HREM', LEN(r.cantpr)), (N'DE_REMI_HREM (remite a)', LEN(r.remite_a)), (N'TX_SERV_HREM (servicio)', LEN(r.servicio)),
       (N'TX_ADMIN_HREM (EPS)', LEN(r.eps)), (N'DE_DESC_HREM (observaciones)', r.l_desc), (N'TX_CASO_HREM (caso clínico)', r.l_caso),
       (N'TX_DATACO_HREM (responsable)', r.l_dataco), (N'TX_REHA_HREM (residencia habitual)', r.l_reha),
       (N'TX_REAC_HREM (residencia actual)', r.l_reac), (N'TX_FICHA_HREM (ficha Sisbén)', r.l_ficha),
       (N'FE_FECHA_HREM (fecha)', r.f_fecha)) v (columna, largo)
 WHERE r.alcance NOT LIKE N'3%'
 GROUP BY r.alcance, v.columna
 ORDER BY r.alcance, v.columna;

-- (c) los valores de las columnas que son códigos o frases cortas (los que se repiten 10 veces o más)
SELECT N'D-6 (c)' AS bloque, x.columna, x.valor, x.remisiones
  FROM (SELECT v.columna, v.valor, COUNT(*) AS remisiones,
               ROW_NUMBER() OVER (PARTITION BY v.columna ORDER BY COUNT(*) DESC) AS rk
          FROM #r r
         CROSS APPLY (VALUES
               (N'TX_PRIO_HREM', r.prio), (N'NU_INST_HREM', r.inst), (N'NU_SRVREM_HREM', r.srvrem_n), (N'TX_SRVREM_HREM', r.srvrem_t),
               (N'NU_MTVREM_HREM', r.mtvrem), (N'TX_TIPTRA_HREM', r.tiptra), (N'TX_MOTATE_HREM', r.motate), (N'TX_DESPER_HREM', r.desper),
               (N'TX_MODTEC_HREM', r.modtec), (N'TX_GRUSER_HREM', r.gruser), (N'TX_TIPREG_HREM', r.tipreg), (N'CD_CODI_REG_HREM', r.codreg),
               (N'TX_NOMREG_HREM', r.nomreg), (N'TX_SISBEN_HREM', r.sisben), (N'TX_CODSER_HREM', r.codser), (N'TX_CUPSPR_HREM', r.cupspr),
               (N'DE_REMI_HREM (remite a)', r.remite_a), (N'TX_SERV_HREM (servicio)', r.servicio), (N'TX_ADMIN_HREM (EPS)', r.eps)) v (columna, valor)
         WHERE r.alcance LIKE N'2%'
         GROUP BY v.columna, v.valor
        HAVING COUNT(*) >= 10) x
 WHERE x.rk <= 12
 ORDER BY x.columna, x.remisiones DESC;

-- (d) el caso clínico: cuánto mide (una hoja carta en letra de 9 puntos lleva ~3.500 caracteres)
SELECT DISTINCT N'D-6 (d)' AS bloque, alcance,
       COUNT(*) OVER (PARTITION BY alcance) AS remisiones_con_caso,
       CAST(PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY l_caso) OVER (PARTITION BY alcance) AS int) AS caracteres_p50,
       CAST(PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY l_caso) OVER (PARTITION BY alcance) AS int) AS caracteres_p90,
       CAST(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY l_caso) OVER (PARTITION BY alcance) AS int) AS caracteres_p99,
       MAX(l_caso) OVER (PARTITION BY alcance) AS caracteres_max,
       CAST(100.0 * SUM(caso_empieza_por_consulta) OVER (PARTITION BY alcance) / COUNT(*) OVER (PARTITION BY alcance) AS decimal(5, 1)) AS pct_empieza_por_consulta
  FROM #r
 WHERE l_caso > 0 AND alcance NOT LIKE N'3%';
GO

-- =============================================================================
-- D-7 · Indicaciones (HIST_INDI): ¿para el paciente o para enfermería?
--
-- En urgencias y hospitalización son órdenes del médico a enfermería («LEV SSN
-- 1000 CC», «CSV-FAC»). En consulta externa no se sabe: el plan las ponía como
-- «Recomendaciones» del resumen. Se cuentan palabras típicas de cada uso y se
-- listan las frases que se repiten 10 veces o más.
-- =============================================================================
IF OBJECT_ID('tempdb..#alc') IS NULL BEGIN RAISERROR(N'Corre primero D-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#i') IS NOT NULL DROP TABLE #i;
SELECT a.alcance, a.id, c.med, i.NU_NUME_HIND AS indi,
       ISNULL(DATALENGTH(i.DE_DESC_HIND), 0) AS largo,
       CAST(UPPER(REPLACE(REPLACE(REPLACE(CAST(i.DE_DESC_HIND AS varchar(max)), CHAR(13) + CHAR(10), ' / '), CHAR(13), ' / '), CHAR(10), ' / '))
            AS nvarchar(max)) COLLATE DATABASE_DEFAULT AS texto
  INTO #i
  FROM #alc a
  JOIN #c c ON c.id = a.id
  JOIN dbo.HIST_INDI i ON i.NU_NUME_HICL_HIND = a.id
OPTION (MAXDOP 1);

-- (a) cuántas consultas las traen y cuánto miden
SELECT N'D-7 (a)' AS bloque, a.alcance,
       COUNT(DISTINCT a.id) AS consultas,
       COUNT(DISTINCT i.id) AS con_indicaciones,
       CAST(100.0 * COUNT(DISTINCT i.id) / NULLIF(COUNT(DISTINCT a.id), 0) AS decimal(5, 1)) AS pct,
       CAST(COUNT(i.indi) * 1.0 / NULLIF(COUNT(DISTINCT i.id), 0) AS decimal(5, 2)) AS indicaciones_por_consulta,
       AVG(i.largo) AS largo_promedio,
       MAX(i.largo) AS largo_maximo
  FROM #alc a
  LEFT JOIN #i i ON i.id = a.id AND i.alcance = a.alcance
 GROUP BY a.alcance
 ORDER BY a.alcance;

-- (b) palabras de enfermería frente a palabras para el paciente (% de indicaciones que las contienen)
SELECT N'D-7 (b)' AS bloque, alcance, COUNT(*) AS indicaciones,
       CAST(100.0 * SUM(CASE WHEN texto LIKE N'%LEV%' OR texto LIKE N'%SSN%' OR texto LIKE N'%CSV%' OR texto LIKE N'%NVO%'
                              OR texto LIKE N'%CANALIZ%' OR texto LIKE N'%SIGNOS VITALES%' OR texto LIKE N'%OXIGENO%'
                              OR texto LIKE N'%CABECERA%' OR texto LIKE N'% IV %' OR texto LIKE N'%GLUCOMETR%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_palabras_de_enfermeria,
       CAST(100.0 * SUM(CASE WHEN texto LIKE N'%TOMAR%' OR texto LIKE N'%DIETA%' OR texto LIKE N'%SIGNOS DE ALARMA%' OR texto LIKE N'%CONSULTAR%'
                              OR texto LIKE N'%ACUDIR%' OR texto LIKE N'%EJERCICIO%' OR texto LIKE N'%CITA%' OR texto LIKE N'%CONTROL%'
                              OR texto LIKE N'%RECOMIEND%' OR texto LIKE N'%EVITAR%' THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_palabras_para_el_paciente
  FROM #i
 GROUP BY alcance
 ORDER BY alcance;

-- (c) las frases que se repiten (genéricas): primeros 200 caracteres
SELECT N'D-7 (c)' AS bloque, x.alcance, x.frase, x.veces, x.consultas, x.medicos
  FROM (SELECT alcance, LEFT(LTRIM(RTRIM(texto)), 200) AS frase, COUNT(*) AS veces, COUNT(DISTINCT id) AS consultas, COUNT(DISTINCT med) AS medicos,
               ROW_NUMBER() OVER (PARTITION BY alcance ORDER BY COUNT(*) DESC) AS rk
          FROM #i
         WHERE alcance IN (N'1 Piloto (S39141 + S39141-1)', N'3 Urgencias (S39145)')
         GROUP BY alcance, LEFT(LTRIM(RTRIM(texto)), 200)
        HAVING COUNT(*) >= 10) x
 WHERE x.rk <= 20
 ORDER BY x.alcance, x.veces DESC;
GO

-- =============================================================================
-- D-8 · Incapacidad (HIST_INCA) e interconsulta (HIST_ORTIAT)
-- =============================================================================
IF OBJECT_ID('tempdb..#alc') IS NULL BEGIN RAISERROR(N'Corre primero D-0 en esta misma ventana.', 16, 1); RETURN; END;

-- (a) incapacidad: cuántas, días y los códigos que imprime
SELECT N'D-8 (a)' AS bloque, a.alcance, COUNT(*) AS incapacidades, COUNT(DISTINCT a.id) AS consultas,
       AVG(i.NU_DIAS_HINC * 1.0) AS dias_promedio, MAX(i.NU_DIAS_HINC) AS dias_max,
       CAST(100.0 * SUM(CASE WHEN DATALENGTH(i.DE_DESC_HINC) > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_texto,
       CAST(100.0 * SUM(CASE WHEN ISNULL(i.NU_PROR_HINC, 0) <> 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_prorroga
  FROM #alc a
  JOIN dbo.HIST_INCA i ON i.NU_NUME_HICL_HINC = a.id
 WHERE a.alcance NOT LIKE N'3%'
 GROUP BY a.alcance
 ORDER BY a.alcance;

SELECT N'D-8 (b)' AS bloque, v.columna, v.valor, COUNT(*) AS incapacidades
  FROM #alc a
  JOIN dbo.HIST_INCA i ON i.NU_NUME_HICL_HINC = a.id
 CROSS APPLY (VALUES (N'TX_TIPO_HINC', CAST(i.TX_TIPO_HINC AS nvarchar(20))), (N'TX_ORIG_INCA_HINC', CAST(i.TX_ORIG_INCA_HINC AS nvarchar(20))),
                     (N'TX_MODA_SALU_HINC', CAST(i.TX_MODA_SALU_HINC AS nvarchar(20))), (N'TX_GRUP_SERV_HINC', CAST(i.TX_GRUP_SERV_HINC AS nvarchar(20))),
                     (N'TX_INCA_RETR_HINC', CAST(i.TX_INCA_RETR_HINC AS nvarchar(20))), (N'CD_CODI_CAEX_HINC', CAST(i.CD_CODI_CAEX_HINC AS nvarchar(20)))) v (columna, valor)
 WHERE a.alcance LIKE N'2%'
 GROUP BY v.columna, v.valor
HAVING COUNT(*) >= 3
 ORDER BY v.columna, COUNT(*) DESC;

-- (c) interconsulta: cuántas, a qué especialidad y cómo
SELECT N'D-8 (c)' AS bloque, a.alcance, COUNT(*) AS interconsultas, COUNT(DISTINCT a.id) AS consultas,
       CAST(100.0 * SUM(CASE WHEN DATALENGTH(o.ME_OBSER_HOTA) > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_observacion,
       AVG(CASE WHEN DATALENGTH(o.ME_OBSER_HOTA) > 0 THEN DATALENGTH(o.ME_OBSER_HOTA) END) AS largo_promedio_observacion,
       CAST(100.0 * SUM(CASE WHEN ISNULL(o.NU_HICL_ORD_HOTA, 0) <> 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_nu_hicl_ord
  FROM #alc a
  JOIN dbo.HIST_ORTIAT o ON o.NU_NUME_HICL_HOTA = a.id
 WHERE a.alcance NOT LIKE N'3%'
 GROUP BY a.alcance
 ORDER BY a.alcance;

SELECT N'D-8 (d)' AS bloque, v.columna, v.valor, COUNT(*) AS interconsultas
  FROM #alc a
  JOIN dbo.HIST_ORTIAT o ON o.NU_NUME_HICL_HOTA = a.id
  LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = o.CD_CODI_ESP_HOTA
 CROSS APPLY (VALUES (N'NU_TIPO_HOTA', CAST(o.NU_TIPO_HOTA AS nvarchar(80))), (N'NU_VIA_HOTA', CAST(o.NU_VIA_HOTA AS nvarchar(80))),
                     (N'NU_ESTADO_HOTA', CAST(o.NU_ESTADO_HOTA AS nvarchar(80))),
                     (N'especialidad', CAST(CONCAT(o.CD_CODI_ESP_HOTA, N' ', e.NO_NOMB_ESP) AS nvarchar(80)))) v (columna, valor)
 WHERE a.alcance LIKE N'2%'
 GROUP BY v.columna, v.valor
HAVING COUNT(*) >= 5
 ORDER BY v.columna, COUNT(*) DESC;
GO

-- =============================================================================
-- D-9 · Encabezado «Registro de Calidad»: convenio, tipo de usuario, EPS,
--       edad, especialidad, documento del médico y código de plantilla
-- =============================================================================
IF OBJECT_ID('tempdb..#alc') IS NULL BEGIN RAISERROR(N'Corre primero D-0 en esta misma ventana.', 16, 1); RETURN; END;

-- (a) qué tan llenos vienen
SELECT N'D-9 (a)' AS bloque, a.alcance, COUNT(*) AS consultas,
       CAST(100.0 * SUM(CASE WHEN t.NU_NUME_HICL_HTLA IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_hist_temlabo,
       CAST(100.0 * SUM(CASE WHEN ISNULL(t.NU_NUME_CONV_HTLA, 0) <> 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_convenio,
       COUNT(DISTINCT t.NU_NUME_CONV_HTLA) AS convenios_distintos,
       CAST(100.0 * SUM(CASE WHEN l.NU_EDAD_LABO IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_edad,
       CAST(100.0 * SUM(CASE WHEN LEN(ISNULL(l.CD_CODI_ESP_LABO, '')) > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_especialidad,
       CAST(100.0 * SUM(CASE WHEN LEN(ISNULL(m.NU_DOCU_MED, '')) > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_medico_con_documento,
       CAST(100.0 * SUM(CASE WHEN LEN(ISNULL(m.DE_REGI_MED, '')) > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_medico_con_registro
  FROM #alc a
  JOIN #c c ON c.id = a.id
  LEFT JOIN (SELECT x.NU_NUME_HICL_HTLA, MAX(x.NU_NUME_CONV_HTLA) AS NU_NUME_CONV_HTLA
               FROM dbo.HIST_TEMLABO x
              WHERE x.NU_NUME_HICL_HTLA IN (SELECT id FROM #alc)
              GROUP BY x.NU_NUME_HICL_HTLA) t ON t.NU_NUME_HICL_HTLA = a.id
  LEFT JOIN dbo.LABORATORIO l ON l.NU_NUME_LABO = c.labo
  LEFT JOIN dbo.MEDICOS m     ON m.CD_CODI_MED = c.med
 WHERE a.alcance NOT LIKE N'3%'
 GROUP BY a.alcance
 ORDER BY a.alcance;

-- (b) CONVENIOS: sus columnas (solo el catálogo; la tabla tiene 85 de facturación)
SELECT N'D-9 (b)' AS bloque, t.name AS tabla,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS filas,
       STRING_AGG(CAST(c.name + CASE WHEN c.is_identity = 1 THEN N' (identidad)' ELSE N'' END AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.column_id) AS columnas
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
 WHERE t.name = N'CONVENIOS'
 GROUP BY t.name, t.object_id;

-- (c) tipo de usuario y nivel de los pacientes del piloto (códigos), y tablas que podrían traducirlos
SELECT N'D-9 (c)' AS bloque, v.columna, v.valor, COUNT(*) AS pacientes
  FROM (SELECT DISTINCT c.pac FROM #c c WHERE c.piloto = 1) x
  JOIN dbo.PACIENTES pa ON pa.NU_HIST_PAC = x.pac
 CROSS APPLY (VALUES (N'PACIENTES.NU_TIPO_PAC', CAST(pa.NU_TIPO_PAC AS nvarchar(10))), (N'PACIENTES.NU_NIVE_PAC', CAST(pa.NU_NIVE_PAC AS nvarchar(10))),
                     (N'PACIENTES.NU_TIPD_PAC', CAST(pa.NU_TIPD_PAC AS nvarchar(10)))) v (columna, valor)
 GROUP BY v.columna, v.valor
HAVING COUNT(*) >= 5
 ORDER BY v.columna, COUNT(*) DESC;

IF OBJECT_ID('tempdb..#d9') IS NOT NULL DROP TABLE #d9;
CREATE TABLE #d9 (tabla sysname, fila nvarchar(max) COLLATE DATABASE_DEFAULT NULL);
DECLARE @sql nvarchar(max);
SELECT @sql = STRING_AGG(CAST(N'INSERT #d9 SELECT TOP (40) N''' + t.name + N''', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM '
                              + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' x;' AS nvarchar(max)), N' ')
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE (t.name LIKE N'%TIPO%USU%' OR t.name LIKE N'%TIPOUSU%' OR t.name LIKE N'%TIUS%' OR t.name LIKE N'%TIPO%AFIL%'
        OR t.name LIKE N'%NIVEL%' OR t.name LIKE N'%RANGO%' OR t.name = N'TIPO_DOCUMENTO')
   AND t.name NOT LIKE N'INTER[_]%'
   AND (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) BETWEEN 1 AND 40
   AND NOT EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id
                    AND (c.name LIKE '%CLAV%' OR c.name LIKE '%PASS%' OR c.name LIKE '%TOKEN%' OR c.name LIKE '%SECR%'));
IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;
SELECT N'D-9 (d)' AS bloque, tabla, fila FROM #d9 ORDER BY tabla;

-- (e) código de las plantillas de consulta («Código Plantilla: HIS002» en el papel)
SELECT N'D-9 (e)' AS bloque, p.NU_NUME_PLHI AS plantilla, p.TX_CODI_PLHI AS codigo, p.TX_DESC_PLHI AS nombre,
       p.TX_TIPO_PLHI AS tipo, p.NU_TIAT_PLHI AS tipo_atencion, p.TX_RESOL_PLHI AS resolucion, p.NU_ESTA_PLHI AS estado
  FROM dbo.PLANTILLA_HIST p
 WHERE p.NU_NUME_PLHI IN (870, 844, 838, 858, 907, 899, 843, 860, 849, 862)
 ORDER BY p.NU_NUME_PLHI;

-- (f) EPS del paciente (R_PAC_EPS): ¿una sola activa? (el papel imprime «Administradora»)
SELECT N'D-9 (f)' AS bloque, x.filas_eps AS eps_registradas, COUNT(*) AS pacientes,
       SUM(CASE WHEN x.activas = 1 THEN 1 ELSE 0 END) AS con_una_activa_s
  FROM (SELECT c.pac, COUNT(r.CD_NIT_EPS_RPE) AS filas_eps, SUM(CASE WHEN r.TX_ACTI_RPE = 'S' THEN 1 ELSE 0 END) AS activas
          FROM (SELECT DISTINCT pac FROM #c WHERE piloto = 1) c
          LEFT JOIN dbo.R_PAC_EPS r ON r.NU_HIST_PAC_RPE = c.pac
         GROUP BY c.pac) x
 GROUP BY x.filas_eps
 ORDER BY x.filas_eps;

SELECT N'D-9 (g)' AS bloque, v.columna, v.valor, COUNT(*) AS filas
  FROM (SELECT DISTINCT pac FROM #c WHERE piloto = 1) c
  JOIN dbo.R_PAC_EPS r ON r.NU_HIST_PAC_RPE = c.pac
 CROSS APPLY (VALUES (N'TX_ACTI_RPE', CAST(r.TX_ACTI_RPE AS nvarchar(10))), (N'NU_ESTA_RPE', CAST(r.NU_ESTA_RPE AS nvarchar(10))),
                     (N'CD_CODI_REG_RPE', CAST(r.CD_CODI_REG_RPE AS nvarchar(10))), (N'NU_AFIL_RPE', CAST(r.NU_AFIL_RPE AS nvarchar(10)))) v (columna, valor)
 GROUP BY v.columna, v.valor
 ORDER BY v.columna, COUNT(*) DESC;
GO

-- =============================================================================
-- D-10 · Interpretación de exámenes (Interpretación.rpt): ¿en qué tabla vive?
--
-- En urgencias el médico interpreta el resultado el mismo día («P ORINA
-- NORMAL»); en consulta externa basta la orden. Queda para una fase posterior:
-- aquí solo se ubica la tabla (catálogo).
-- =============================================================================
SELECT N'D-10 (a)' AS bloque, t.name AS tabla,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS filas,
       STRING_AGG(CAST(c.name AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.column_id) AS columnas
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
 WHERE t.name LIKE N'%INTERP%' OR t.name LIKE N'%RESUL%' OR t.name LIKE N'%LECTU%'
    OR EXISTS (SELECT 1 FROM sys.columns k WHERE k.object_id = t.object_id AND k.name LIKE N'%INTERP%')
 GROUP BY t.name, t.object_id
 ORDER BY filas DESC;

SELECT N'D-10 (b)' AS bloque, OBJECT_NAME(fk.parent_object_id) AS tabla_hija,
       COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS columna_hija,
       OBJECT_NAME(fk.referenced_object_id) AS apunta_a,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = fk.parent_object_id AND p.index_id IN (0, 1)) AS filas
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
 WHERE OBJECT_NAME(fk.referenced_object_id) IN (N'HIST_PROC', N'HIST_ORDEN')
 ORDER BY filas DESC;
GO

-- =============================================================================
-- D-11 · Documentos por consulta: cuántos PDF saldrían
--
-- Un documento por orden (la fórmula del día y cada posfechada son órdenes
-- con su número), por remisión, incapacidad e interconsulta. El resumen de la
-- atención es uno más por consulta (no se cuenta aquí). Las indicaciones se
-- cuentan aparte: D-7 dice si van.
-- =============================================================================
IF OBJECT_ID('tempdb..#m') IS NULL OR OBJECT_ID('tempdb..#p') IS NULL OR OBJECT_ID('tempdb..#r') IS NULL OR OBJECT_ID('tempdb..#i') IS NULL
BEGIN RAISERROR(N'Corre todo el script de una vez (D-0 a D-7 dejan las tablas que usa D-11).', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#dpc') IS NOT NULL DROP TABLE #dpc;
SELECT a.alcance, a.id,
       ISNULL(mf.del_dia, 0) AS formulas_del_dia,
       ISNULL(mf.posf, 0)    AS formulas_posfechadas,
       ISNULL(pe.n, 0)       AS ordenes_de_examenes,
       ISNULL(rr.n, 0)       AS remisiones,
       ISNULL(ic.n, 0)       AS incapacidades,
       ISNULL(oc.n, 0)       AS interconsultas,
       ISNULL(ii.n, 0)       AS indicaciones
  INTO #dpc
  FROM #alc a
  LEFT JOIN (SELECT alcance, id, SUM(CASE WHEN posf = 0 THEN 1 ELSE 0 END) AS del_dia, SUM(CASE WHEN posf = 1 THEN 1 ELSE 0 END) AS posf
               FROM (SELECT DISTINCT alcance, id, orden, posf FROM #m) d GROUP BY alcance, id) mf ON mf.id = a.id AND mf.alcance = a.alcance
  LEFT JOIN (SELECT alcance, id, COUNT(DISTINCT orden) AS n FROM #p GROUP BY alcance, id) pe ON pe.id = a.id AND pe.alcance = a.alcance
  LEFT JOIN (SELECT alcance, id, COUNT(*) AS n FROM #r GROUP BY alcance, id) rr ON rr.id = a.id AND rr.alcance = a.alcance
  LEFT JOIN (SELECT x.NU_NUME_HICL_HINC AS id, COUNT(*) AS n FROM dbo.HIST_INCA x
              WHERE x.NU_NUME_HICL_HINC IN (SELECT id FROM #alc) GROUP BY x.NU_NUME_HICL_HINC) ic ON ic.id = a.id
  LEFT JOIN (SELECT x.NU_NUME_HICL_HOTA AS id, COUNT(*) AS n FROM dbo.HIST_ORTIAT x
              WHERE x.NU_NUME_HICL_HOTA IN (SELECT id FROM #alc) GROUP BY x.NU_NUME_HICL_HOTA) oc ON oc.id = a.id
  LEFT JOIN (SELECT alcance, id, COUNT(*) AS n FROM #i GROUP BY alcance, id) ii ON ii.id = a.id AND ii.alcance = a.alcance
 WHERE a.alcance NOT LIKE N'3%';

-- (a) promedios por consulta
SELECT N'D-11 (a)' AS bloque, alcance, COUNT(*) AS consultas,
       CAST(100.0 * SUM(CASE WHEN formulas_del_dia + formulas_posfechadas > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_formula,
       CAST(AVG(formulas_del_dia * 1.0)     AS decimal(5, 2)) AS formulas_del_dia_por_consulta,
       CAST(AVG(formulas_posfechadas * 1.0) AS decimal(5, 2)) AS formulas_posfechadas_por_consulta,
       CAST(100.0 * SUM(CASE WHEN ordenes_de_examenes > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_examenes,
       CAST(AVG(ordenes_de_examenes * 1.0)  AS decimal(5, 2)) AS ordenes_de_examenes_por_consulta,
       CAST(100.0 * SUM(CASE WHEN remisiones > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_remision,
       CAST(100.0 * SUM(CASE WHEN incapacidades > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_incapacidad,
       CAST(100.0 * SUM(CASE WHEN interconsultas > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_interconsulta,
       CAST(100.0 * SUM(CASE WHEN indicaciones > 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_con_indicaciones,
       CAST(AVG((formulas_del_dia + formulas_posfechadas + ordenes_de_examenes + remisiones + incapacidades + interconsultas) * 1.0) AS decimal(5, 2)) AS documentos_por_consulta
  FROM #dpc
 GROUP BY alcance
 ORDER BY alcance;

-- (b) reparto: cuántas consultas dejan 0, 1, 2… documentos (sin el resumen ni las indicaciones)
SELECT N'D-11 (b)' AS bloque, alcance,
       CASE WHEN n >= 10 THEN N'10 o más' ELSE CAST(n AS nvarchar(5)) END AS documentos,
       COUNT(*) AS consultas
  FROM (SELECT alcance, formulas_del_dia + formulas_posfechadas + ordenes_de_examenes + remisiones + incapacidades + interconsultas AS n FROM #dpc) x
 GROUP BY alcance, CASE WHEN n >= 10 THEN N'10 o más' ELSE CAST(n AS nvarchar(5)) END, CASE WHEN n >= 10 THEN 10 ELSE n END
 ORDER BY alcance, CASE WHEN n >= 10 THEN 10 ELSE n END;
GO

SET NOEXEC OFF;
GO

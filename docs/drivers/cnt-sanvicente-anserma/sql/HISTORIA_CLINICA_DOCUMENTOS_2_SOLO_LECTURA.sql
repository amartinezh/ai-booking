/* =============================================================================
   HISTORIA CLÍNICA → DOCUMENTOS · SEGUNDA PARTE (RONDA 6)
   SOLO LECTURA · Base: ESEHSVP · Solo conteos y catálogos
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md §3.9. Mapeo: MAPEO_HIS.md §2.9, «Ronda 5».

   Cierra lo que dejó abierto la ronda 5 (HISTORIA_CLINICA_DOCUMENTOS_SOLO_LECTURA):
     E-1  Impresiones: la historia se imprime en el 96 % de las consultas y la
          remisión en todas las que tienen, pero la fórmula y los exámenes en el
          3 %. ¿Por qué causa, quién (¿el médico en la consulta?) y cuándo?
          ¿Qué número guarda el registro (el de la orden que sale en el papel)?
     E-2  Firma: está en USUARIOS.IM_FIRMA_USUA. ¿Cómo se une con MEDICOS, qué
          médicos del piloto la tienen, cuánto pesa y en qué formato está?
     E-3  Encabezado: EPS, código del convenio y tipo de usuario salen del
          convenio de la atención (CONVENIOS), no de R_PAC_EPS.
     E-4  Remisión: catálogos de prioridad, motivo y destino; cuántas son al
          mismo hospital y a qué especialidad.

   CÓMO CORRERLO: SSMS, ventana NUEVA, el mismo usuario de las rondas anteriores
   (no agenia_sync). El script entra solo a ESEHSVP. F5 con todo (menos de un
   minuto). Un mensaje por bloque.

   QUÉ HACE Y QUÉ NO HACE
     · Solo lee; escribe en tablas temporales (#). El SQL dinámico solo arma
       SELECT sobre el catálogo o sobre tablas pequeñas.
     · No sale ningún paciente ni ninguna imagen: de la firma, solo cuántas hay,
       cuánto pesan y su formato (los primeros bytes dicen si es BMP, JPEG o PNG).
     · Los catálogos se muestran solo si tienen 60 filas o menos y ninguna
       columna de clave, token o secreto.
   ============================================================================= */

USE ESEHSVP;
GO

SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

IF DB_NAME() <> N'ESEHSVP' OR OBJECT_ID(N'dbo.HISTORIACLINICA') IS NULL
BEGIN
    DECLARE @por_que nvarchar(500) =
        CASE WHEN DB_NAME() <> N'ESEHSVP'
             THEN N'La ventana está en la base «' + DB_NAME() + N'», no en ESEHSVP. Elige ESEHSVP y vuelve a correr.'
             ELSE N'El usuario «' + SUSER_SNAME() + N'» no puede ver dbo.HISTORIACLINICA. Conéctate con el usuario de las rondas anteriores.'
        END + N' No se ejecutó nada.';
    RAISERROR(N'%s', 16, 1, @por_que);
    SET NOEXEC ON;
END;
GO

-- =============================================================================
-- E-0 · Las consultas de los últimos 30 días (igual que la ronda 5)
-- =============================================================================
DECLARE @desde date = DATEADD(day, -30, CAST(GETDATE() AS date));
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
SELECT h.NU_NUME_HICL AS id, h.FE_FECH_HICL AS fecha, h.NU_HIST_PAC_HICL AS pac, h.CD_MED_REAL_HICL AS med,
       h.NU_NUME_CONE_HICL AS cone,
       CASE WHEN h.TX_CODSER_HICL IN ('S39141', 'S39141-1') THEN 1 ELSE 0 END AS piloto
  INTO #c
  FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
 WHERE h.NU_NUME_HICL >= @id_desde
   AND h.FE_FECH_HICL >= @desde AND h.FE_FECH_HICL < @hasta
   AND h.TX_TIPO_HICL = 'CON'
   AND ISNULL(h.NU_NUME_REG_HICL, 0) = 0
   AND ISNULL(h.TX_CODSER_HICL, '') <> 'S39145'
OPTION (MAXDOP 1, RECOMPILE);
CREATE UNIQUE CLUSTERED INDEX ix_c ON #c (id);

IF OBJECT_ID('tempdb..#alc') IS NOT NULL DROP TABLE #alc;
CREATE TABLE #alc (alcance nvarchar(40) COLLATE DATABASE_DEFAULT NOT NULL, id int NOT NULL);
INSERT #alc SELECT N'1 Piloto (S39141 + S39141-1)', id FROM #c WHERE piloto = 1;
INSERT #alc SELECT N'2 Consulta externa sin urgencias', id FROM #c;
CREATE CLUSTERED INDEX ix_alc ON #alc (id, alcance);

SELECT N'E-0' AS bloque, @desde AS desde, DATEADD(day, -1, @hasta) AS hasta,
       CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO: avísame' END AS frontera_confiable,
       (SELECT COUNT(*) FROM #c WHERE piloto = 1) AS consultas_piloto, (SELECT COUNT(*) FROM #c) AS consultas_externas_sin_urgencias;
GO

-- =============================================================================
-- E-1 · Impresiones: causa, quién, cuándo y qué número guarda
-- =============================================================================
IF OBJECT_ID('tempdb..#alc') IS NULL BEGIN RAISERROR(N'Corre primero E-0 en esta misma ventana.', 16, 1); RETURN; END;

-- (a) catálogo de causas de impresión
IF OBJECT_ID('tempdb..#cat') IS NOT NULL DROP TABLE #cat;
CREATE TABLE #cat (tabla sysname, fila nvarchar(max) COLLATE DATABASE_DEFAULT NULL);
IF OBJECT_ID(N'dbo.CAUSA_IMPRESION') IS NOT NULL
    INSERT #cat SELECT TOP (100) N'CAUSA_IMPRESION', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM dbo.CAUSA_IMPRESION x;
SELECT N'E-1 (a)' AS bloque, tabla, fila FROM #cat;

-- Cada renglón impreso de las consultas de la ventana, con lo que hay que saber de él
IF OBJECT_ID('tempdb..#imp') IS NOT NULL DROP TABLE #imp;
SELECT a.alcance, c.id, d.NU_NUME_IMDE AS numero,
       CAST(LTRIM(RTRIM(d.TX_TIPO_IMDE)) AS nvarchar(10)) COLLATE DATABASE_DEFAULT AS tipo,
       i.NU_AUTO_HIMP AS impresion, i.NU_AUTO_CAIM_HIMP AS causa, i.FE_FECH_HIMP AS impresa,
       DATEDIFF(minute, c.fecha, i.FE_FECH_HIMP) AS minutos_despues,
       CASE WHEN i.NU_NUME_CONE_HIMP = c.cone THEN 1 ELSE 0 END AS misma_conexion,
       CASE WHEN CAST(i.FE_FECH_HIMP AS date) = CAST(c.fecha AS date) THEN 1 ELSE 0 END AS mismo_dia,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(i.TX_OBSER_HIMP, '')))) > 0 THEN 1 ELSE 0 END AS con_observacion,
       CASE WHEN LEN(LTRIM(RTRIM(ISNULL(i.TX_NOMPER_HIMP, '')))) > 0 THEN 1 ELSE 0 END AS con_nombre_de_quien_recibe,
       CASE WHEN d.NU_NUME_IMDE = c.id THEN 1 ELSE 0 END AS es_nu_nume_hicl,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o WHERE o.NU_NUME_HICL_HORD = c.id AND o.NU_AUTO_HORD = d.NU_NUME_IMDE)  THEN 1 ELSE 0 END AS es_nu_auto_hord,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o WHERE o.NU_NUME_HICL_HORD = c.id AND o.NU_CLAVE_HORD = d.NU_NUME_IMDE) THEN 1 ELSE 0 END AS es_nu_clave_hord,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_REMI r  WHERE r.NU_NUME_HICL_HREM = c.id AND r.NU_NUME_HREM = d.NU_NUME_IMDE)  THEN 1 ELSE 0 END AS es_nu_nume_hrem,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_INDI x  WHERE x.NU_NUME_HICL_HIND = c.id AND x.NU_NUME_HIND = d.NU_NUME_IMDE)  THEN 1 ELSE 0 END AS es_nu_nume_hind,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_INCA x  WHERE x.NU_NUME_HICL_HINC = c.id AND x.NU_NUME_HINC = d.NU_NUME_IMDE)  THEN 1 ELSE 0 END AS es_nu_nume_hinc
  INTO #imp
  FROM #alc a
  JOIN #c c ON c.id = a.id
  JOIN dbo.HIST_IMPRESION_DETA d ON d.NU_NUME_HICL_IMDE = a.id
  JOIN dbo.HIST_IMPRESION i      ON i.NU_AUTO_HIMP = d.NU_AUTO_HIMP_IMDE
OPTION (MAXDOP 1);

-- (b) causa por tipo de papel
SELECT N'E-1 (b)' AS bloque, alcance, tipo, causa, COUNT(*) AS renglones, COUNT(DISTINCT id) AS consultas
  FROM #imp
 GROUP BY alcance, tipo, causa
HAVING COUNT(*) >= 5
 ORDER BY alcance, tipo, COUNT(*) DESC;

-- (c) quién y cuándo: ¿la misma sesión que escribió la historia (el médico)? ¿cuántos minutos después?
SELECT DISTINCT N'E-1 (c)' AS bloque, alcance, tipo,
       COUNT(*) OVER (PARTITION BY alcance, tipo) AS renglones,
       CAST(100.0 * SUM(misma_conexion) OVER (PARTITION BY alcance, tipo) / COUNT(*) OVER (PARTITION BY alcance, tipo) AS decimal(5, 1)) AS pct_misma_sesion_que_la_historia,
       CAST(100.0 * SUM(mismo_dia) OVER (PARTITION BY alcance, tipo) / COUNT(*) OVER (PARTITION BY alcance, tipo) AS decimal(5, 1)) AS pct_mismo_dia,
       CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutos_despues) OVER (PARTITION BY alcance, tipo) AS int) AS minutos_p50,
       CAST(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY minutos_despues) OVER (PARTITION BY alcance, tipo) AS int) AS minutos_p90,
       CAST(100.0 * SUM(con_observacion) OVER (PARTITION BY alcance, tipo) / COUNT(*) OVER (PARTITION BY alcance, tipo) AS decimal(5, 1)) AS pct_con_observacion,
       CAST(100.0 * SUM(con_nombre_de_quien_recibe) OVER (PARTITION BY alcance, tipo) / COUNT(*) OVER (PARTITION BY alcance, tipo) AS decimal(5, 1)) AS pct_con_quien_recibe
  FROM #imp
 ORDER BY alcance, renglones DESC;

-- (d) ¿cuántas veces se imprime el mismo papel? (reimpresiones)
SELECT N'E-1 (d)' AS bloque, alcance, tipo, COUNT(*) AS papeles, SUM(veces) AS impresiones,
       SUM(CASE WHEN veces = 1 THEN 1 ELSE 0 END) AS una_vez, SUM(CASE WHEN veces = 2 THEN 1 ELSE 0 END) AS dos_veces,
       SUM(CASE WHEN veces >= 3 THEN 1 ELSE 0 END) AS tres_o_mas
  FROM (SELECT alcance, tipo, id, numero, COUNT(*) AS veces FROM #imp GROUP BY alcance, tipo, id, numero) x
 GROUP BY alcance, tipo
 ORDER BY alcance, COUNT(*) DESC;

-- (e) qué número guarda el registro según el tipo (el de la orden, la remisión, la historia…)
SELECT N'E-1 (e)' AS bloque, tipo, COUNT(*) AS renglones,
       CAST(100.0 * SUM(es_nu_nume_hicl)  / COUNT(*) AS decimal(5, 1)) AS pct_es_la_historia,
       CAST(100.0 * SUM(es_nu_auto_hord)  / COUNT(*) AS decimal(5, 1)) AS pct_es_nu_auto_hord,
       CAST(100.0 * SUM(es_nu_clave_hord) / COUNT(*) AS decimal(5, 1)) AS pct_es_nu_clave_hord,
       CAST(100.0 * SUM(es_nu_nume_hrem)  / COUNT(*) AS decimal(5, 1)) AS pct_es_la_remision,
       CAST(100.0 * SUM(es_nu_nume_hind)  / COUNT(*) AS decimal(5, 1)) AS pct_es_la_indicacion,
       CAST(100.0 * SUM(es_nu_nume_hinc)  / COUNT(*) AS decimal(5, 1)) AS pct_es_la_incapacidad
  FROM #imp
 WHERE alcance LIKE N'2%'
 GROUP BY tipo
 ORDER BY COUNT(*) DESC;

-- (f) columnas de CONEXIONES (para saber, más adelante, de quién es cada sesión)
SELECT N'E-1 (f)' AS bloque, t.name AS tabla,
       STRING_AGG(CAST(c.name + N' ' + ty.name AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.column_id) AS columnas
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
 WHERE t.name IN (N'CONEXIONES', N'USUARIOS')
 GROUP BY t.name;
GO

-- =============================================================================
-- E-2 · Firma (USUARIOS.IM_FIRMA_USUA): ¿cómo se une con el médico?
--
-- Se prueba cada columna corta de USUARIOS contra el código y el documento de
-- los médicos que atendieron en la ventana. Con la mejor, cuántos tienen
-- firma, cuánto pesa y en qué formato. Nunca se muestra la imagen.
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero E-0 en esta misma ventana.', 16, 1); RETURN; END;
IF OBJECT_ID(N'dbo.USUARIOS') IS NULL OR COL_LENGTH(N'dbo.USUARIOS', N'IM_FIRMA_USUA') IS NULL
BEGIN SELECT N'E-2' AS bloque, N'No existe USUARIOS.IM_FIRMA_USUA.' AS nota; RETURN; END;

IF OBJECT_ID('tempdb..#meds') IS NOT NULL DROP TABLE #meds;
SELECT m.CD_CODI_MED AS cod_med,
       CAST(LTRIM(RTRIM(m.CD_CODI_MED)) AS nvarchar(60)) COLLATE DATABASE_DEFAULT AS cod,
       CAST(LTRIM(RTRIM(ISNULL(m.NU_DOCU_MED, ''))) AS nvarchar(60)) COLLATE DATABASE_DEFAULT AS doc,
       COUNT(*) AS consultas, MAX(c.piloto) AS en_piloto
  INTO #meds
  FROM #c c
  JOIN dbo.MEDICOS m ON m.CD_CODI_MED = c.med
 GROUP BY m.CD_CODI_MED, m.NU_DOCU_MED;

-- (a) qué columna de USUARIOS guarda el código o el documento del médico
IF OBJECT_ID('tempdb..#union') IS NOT NULL DROP TABLE #union;
CREATE TABLE #union (columna sysname, por nvarchar(10) COLLATE DATABASE_DEFAULT, medicos int);
DECLARE @sql nvarchar(max);
SELECT @sql = STRING_AGG(CAST(
         N'INSERT #union SELECT N''' + c.name + N''', N''codigo'', COUNT(DISTINCT m.cod) FROM #meds m JOIN dbo.USUARIOS u ON LTRIM(RTRIM(CAST(u.'
       + QUOTENAME(c.name) + N' AS nvarchar(60)))) = m.cod; '
       + N'INSERT #union SELECT N''' + c.name + N''', N''documento'', COUNT(DISTINCT m.doc) FROM #meds m JOIN dbo.USUARIOS u ON LTRIM(RTRIM(CAST(u.'
       + QUOTENAME(c.name) + N' AS nvarchar(60)))) = m.doc WHERE m.doc <> N'''';' AS nvarchar(max)), N' ')
  FROM sys.columns c
  JOIN sys.types ty ON ty.user_type_id = c.user_type_id
 WHERE c.object_id = OBJECT_ID(N'dbo.USUARIOS')
   AND (ty.name IN ('int', 'bigint', 'smallint', 'numeric') OR (ty.name IN ('char', 'varchar', 'nchar', 'nvarchar') AND c.max_length BETWEEN 1 AND 60))
   AND c.name NOT LIKE '%CLAV%' AND c.name NOT LIKE '%PASS%' AND c.name NOT LIKE '%PWD%' AND c.name NOT LIKE '%TOKEN%';
IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;
SELECT N'E-2 (a)' AS bloque, columna, por, medicos AS medicos_que_casan, (SELECT COUNT(*) FROM #meds) AS medicos_en_la_ventana
  FROM #union WHERE medicos > 0 ORDER BY medicos DESC;

-- (b) con la mejor unión: cuántos médicos tienen firma, cuánto pesa y en qué formato
DECLARE @col sysname, @por nvarchar(10);
SELECT TOP (1) @col = columna, @por = por FROM #union WHERE medicos > 0 ORDER BY medicos DESC, CASE por WHEN N'codigo' THEN 0 ELSE 1 END;
IF @col IS NULL
    SELECT N'E-2 (b)' AS bloque, N'Ninguna columna de USUARIOS casa con el código ni con el documento del médico: preguntar a TI cómo se unen.' AS nota;
ELSE
BEGIN
    SET @sql = N'
    SELECT N''E-2 (b)'' AS bloque, N''' + @col + N''' AS une_por_columna, N''' + @por + N''' AS con_el,
           COUNT(*) AS medicos, SUM(m.consultas) AS consultas,
           SUM(CASE WHEN f.bytes > 0 THEN 1 ELSE 0 END) AS medicos_con_firma,
           CAST(100.0 * SUM(CASE WHEN f.bytes > 0 THEN m.consultas ELSE 0 END) / NULLIF(SUM(m.consultas), 0) AS decimal(5, 1)) AS pct_consultas_con_firma,
           SUM(CASE WHEN f.bytes > 0 AND m.en_piloto = 1 THEN 1 ELSE 0 END) AS medicos_del_piloto_con_firma,
           SUM(CASE WHEN m.en_piloto = 1 THEN 1 ELSE 0 END) AS medicos_del_piloto,
           AVG(CASE WHEN f.bytes > 0 THEN f.bytes / 1024 END) AS kb_promedio,
           MAX(f.bytes) / 1024 AS kb_maximo,
           SUM(CASE WHEN f.formato = N''BMP'' THEN 1 ELSE 0 END) AS bmp,
           SUM(CASE WHEN f.formato = N''JPEG'' THEN 1 ELSE 0 END) AS jpeg,
           SUM(CASE WHEN f.formato = N''PNG'' THEN 1 ELSE 0 END) AS png,
           SUM(CASE WHEN f.formato = N''GIF'' THEN 1 ELSE 0 END) AS gif,
           SUM(CASE WHEN f.formato = N''otro'' THEN 1 ELSE 0 END) AS otro
      FROM #meds m
     OUTER APPLY (SELECT TOP (1) CAST(DATALENGTH(u.IM_FIRMA_USUA) AS bigint) AS bytes,
                         CASE WHEN DATALENGTH(u.IM_FIRMA_USUA) IS NULL OR DATALENGTH(u.IM_FIRMA_USUA) = 0 THEN NULL
                              WHEN SUBSTRING(u.IM_FIRMA_USUA, 1, 2) = 0x424D THEN N''BMP''
                              WHEN SUBSTRING(u.IM_FIRMA_USUA, 1, 2) = 0xFFD8 THEN N''JPEG''
                              WHEN SUBSTRING(u.IM_FIRMA_USUA, 1, 4) = 0x89504E47 THEN N''PNG''
                              WHEN SUBSTRING(u.IM_FIRMA_USUA, 1, 4) = 0x47494638 THEN N''GIF''
                              ELSE N''otro'' END AS formato
                    FROM dbo.USUARIOS u
                   WHERE LTRIM(RTRIM(CAST(u.' + QUOTENAME(@col) + N' AS nvarchar(60)))) = ' + CASE WHEN @por = N'codigo' THEN N'm.cod' ELSE N'm.doc' END + N'
                   ORDER BY DATALENGTH(u.IM_FIRMA_USUA) DESC) f;';
    EXEC sys.sp_executesql @sql;
END;
GO

-- =============================================================================
-- E-3 · Encabezado desde el convenio de la atención
--
-- R_PAC_EPS no sirve para el encabezado (4 a 36 filas por paciente, varias
-- «activas»). El papel imprime «Administradora», «Convenio» y «Tipo de
-- usuario»: salen del convenio (HIST_TEMLABO → CONVENIOS → EPS, TIPOUSUARIO).
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero E-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#cv') IS NOT NULL DROP TABLE #cv;
SELECT c.id, c.pac, c.piloto, t.conv
  INTO #cv
  FROM #c c
  LEFT JOIN (SELECT x.NU_NUME_HICL_HTLA AS id, MAX(x.NU_NUME_CONV_HTLA) AS conv
               FROM dbo.HIST_TEMLABO x
              WHERE x.NU_NUME_HICL_HTLA IN (SELECT id FROM #c)
              GROUP BY x.NU_NUME_HICL_HTLA) t ON t.id = c.id;

-- (a) ¿el convenio de la atención existe en CONVENIOS?
SELECT N'E-3 (a)' AS bloque, COUNT(*) AS consultas,
       SUM(CASE WHEN cv.conv IS NOT NULL THEN 1 ELSE 0 END) AS con_convenio,
       SUM(CASE WHEN k.NU_NUME_CONV IS NOT NULL THEN 1 ELSE 0 END) AS convenio_encontrado_en_convenios,
       SUM(CASE WHEN e.CD_NIT_EPS IS NOT NULL THEN 1 ELSE 0 END) AS con_eps,
       SUM(CASE WHEN tu.ID_CODI_TIUS IS NOT NULL THEN 1 ELSE 0 END) AS con_tipo_de_usuario
  FROM #cv cv
  LEFT JOIN dbo.CONVENIOS k    ON k.NU_NUME_CONV = cv.conv
  LEFT JOIN dbo.EPS e          ON e.CD_NIT_EPS = k.CD_NIT_EPS_CONV
  LEFT JOIN dbo.TIPOUSUARIO tu ON tu.ID_CODI_TIUS = k.ID_CODI_TIUS_CONV;

-- (b) los convenios del piloto como saldrían en el encabezado
SELECT TOP (25) N'E-3 (b)' AS bloque, k.CD_CODI_CONV AS convenio, e.NO_NOMB_EPS AS administradora,
       k.ID_CODI_TIUS_CONV AS tipo_usuario, tu.DE_DESC_TIUS AS tipo_usuario_texto, COUNT(*) AS consultas
  FROM #cv cv
  LEFT JOIN dbo.CONVENIOS k    ON k.NU_NUME_CONV = cv.conv
  LEFT JOIN dbo.EPS e          ON e.CD_NIT_EPS = k.CD_NIT_EPS_CONV
  LEFT JOIN dbo.TIPOUSUARIO tu ON tu.ID_CODI_TIUS = k.ID_CODI_TIUS_CONV
 WHERE cv.piloto = 1
 GROUP BY k.CD_CODI_CONV, e.NO_NOMB_EPS, k.ID_CODI_TIUS_CONV, tu.DE_DESC_TIUS
HAVING COUNT(*) >= 5
 ORDER BY COUNT(*) DESC;

-- (c) PACIENTES.NU_TIPO_PAC (1 o 2) frente al tipo de usuario del convenio: ¿cotizante y beneficiario?
SELECT N'E-3 (c)' AS bloque, pa.NU_TIPO_PAC AS nu_tipo_pac, tu.DE_DESC_TIUS AS tipo_usuario_del_convenio, COUNT(*) AS consultas
  FROM #cv cv
  JOIN dbo.PACIENTES pa        ON pa.NU_HIST_PAC = cv.pac
  LEFT JOIN dbo.CONVENIOS k    ON k.NU_NUME_CONV = cv.conv
  LEFT JOIN dbo.TIPOUSUARIO tu ON tu.ID_CODI_TIUS = k.ID_CODI_TIUS_CONV
 WHERE cv.piloto = 1
 GROUP BY pa.NU_TIPO_PAC, tu.DE_DESC_TIUS
HAVING COUNT(*) >= 5
 ORDER BY pa.NU_TIPO_PAC, COUNT(*) DESC;
GO

-- =============================================================================
-- E-4 · Remisión: catálogos y destino
-- =============================================================================
IF OBJECT_ID('tempdb..#alc') IS NULL BEGIN RAISERROR(N'Corre primero E-0 en esta misma ventana.', 16, 1); RETURN; END;

-- (a) catálogos que pueden traducir prioridad, motivo, destino o causa (60 filas o menos)
IF OBJECT_ID('tempdb..#cat4') IS NOT NULL DROP TABLE #cat4;
CREATE TABLE #cat4 (tabla sysname, fila nvarchar(max) COLLATE DATABASE_DEFAULT NULL);
DECLARE @sql nvarchar(max);
SELECT @sql = STRING_AGG(CAST(N'INSERT #cat4 SELECT TOP (60) N''' + t.name + N''', (SELECT x.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) FROM '
                              + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' x;' AS nvarchar(max)), N' ')
  FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
 WHERE (t.name LIKE N'%PRIO%' OR t.name LIKE N'%REMI%' OR t.name LIKE N'%MOTIV%' OR t.name LIKE N'%DESTIN%')
   AND t.name NOT IN (N'HIST_REMI', N'CAUSA_IMPRESION') AND t.name NOT LIKE N'INTER[_]%'
   AND (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) BETWEEN 1 AND 60
   AND NOT EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id
                    AND (c.name LIKE '%CLAV%' OR c.name LIKE '%PASS%' OR c.name LIKE '%TOKEN%' OR c.name LIKE '%SECR%'));
IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;
SELECT N'E-4 (a)' AS bloque, tabla, fila FROM #cat4 ORDER BY tabla;

-- (b) ¿al mismo hospital o a otra institución? y a qué especialidad (CUPS de la consulta pedida)
IF OBJECT_ID('tempdb..#rm') IS NOT NULL DROP TABLE #rm;
SELECT a.alcance, r.NU_NUME_HREM AS remi,
       CASE WHEN UPPER(r.DE_REMI_HREM) LIKE '%HSVP%' OR UPPER(r.DE_REMI_HREM) LIKE '%SAN VICENTE%' OR UPPER(r.DE_REMI_HREM) LIKE '%SANVICENTE%'
                 OR UPPER(r.DE_REMI_HREM) LIKE '%SAN  VICENTE%' THEN N'mismo hospital' ELSE N'otra institución o sin dato' END AS destino,
       CAST(LTRIM(RTRIM(r.TX_CUPSPR_HREM)) AS nvarchar(10)) COLLATE DATABASE_DEFAULT AS cups,
       CAST(LTRIM(RTRIM(r.TX_PRIO_HREM)) AS nvarchar(4)) COLLATE DATABASE_DEFAULT AS prio,
       ISNULL(DATALENGTH(r.TX_CASO_HREM), 0) AS l_caso
  INTO #rm
  FROM #alc a
  JOIN dbo.HIST_REMI r ON r.NU_NUME_HICL_HREM = a.id
OPTION (MAXDOP 1);

SELECT N'E-4 (b)' AS bloque, alcance, destino, COUNT(*) AS remisiones,
       CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY alcance) AS decimal(5, 1)) AS pct,
       AVG(l_caso) AS caracteres_caso_promedio
  FROM #rm
 GROUP BY alcance, destino
 ORDER BY alcance, destino;

SELECT TOP (25) N'E-4 (c)' AS bloque, r.destino, r.cups, MAX(sc.TX_DESSER_CUPS) AS consulta_pedida, COUNT(*) AS remisiones
  FROM #rm r
  LEFT JOIN dbo.SERVICIOS_CUPS sc ON LTRIM(RTRIM(sc.TX_CODSER_CUPS)) = r.cups
 WHERE r.alcance LIKE N'2%'
 GROUP BY r.destino, r.cups
HAVING COUNT(*) >= 5
 ORDER BY COUNT(*) DESC;

-- (d) prioridad por destino (los códigos 0-3 se traducen con (a) o con E7 en PRUEBAS)
SELECT N'E-4 (d)' AS bloque, destino, prio AS tx_prio_hrem, COUNT(*) AS remisiones
  FROM #rm
 WHERE alcance LIKE N'2%'
 GROUP BY destino, prio
 ORDER BY destino, COUNT(*) DESC;
GO

SET NOEXEC OFF;
GO

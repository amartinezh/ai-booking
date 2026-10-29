/* =============================================================================
   PLANTILLAS DEL PILOTO: QUÉ CAMPO CAMBIÓ EN JULIO · SOLO LECTURA
   Base: ESEHSVP
   =============================================================================

   M-8 (HISTORIA_CLINICA_MENSAJES_2_SOLO_LECTURA.sql, 2026-10-28) mostró que lo
   que iría al informe en CONTROL CRÓNICOS (plantilla 844) bajó de ~1,3 KB por
   consulta (abril-junio) a ~0,6 KB (agosto-octubre), con el mismo texto total,
   y que CONSULTA EXTERNA (870) no cambió. Ninguna plantilla nueva.

   P-1  Plantilla 844, campo por campo: % de consultas con valor y bytes
        promedio en abril-junio frente a agosto-octubre (julio se deja fuera:
        es el mes del cambio), y si el campo va hoy al informe.
   P-2  Lo mismo para la 870, solo los 25 campos que más cambiaron.

   Solo nombres de campos y tamaños: ningún dato de pacientes. Sin bloqueos,
   un procesador, tablas temporales (#). F5 con todo en una ventana nueva.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- =============================================================================
-- P-0 · Consultas del piloto con plantilla 844 o 870 (abril-junio y agosto-octubre)
-- =============================================================================
DECLARE @desde date = '2026-04-01';
IF OBJECT_ID(N'dbo.HISTORIACLINICA') IS NULL
BEGIN
    RAISERROR(N'No existe dbo.HISTORIACLINICA en esta base. ¿La ventana está en ESEHSVP?', 16, 1);
    RETURN;
END;

DECLARE @hasta date = DATEADD(day, 1, CAST(GETDATE() AS date));
DECLARE @id_min bigint, @id_max bigint;
SELECT @id_min = MIN(NU_NUME_HICL), @id_max = MAX(NU_NUME_HICL) FROM dbo.HISTORIACLINICA;
DECLARE @paso bigint = 50000, @tope_tramos int = 200;
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

IF OBJECT_ID('tempdb..#cp') IS NOT NULL DROP TABLE #cp;
SELECT h.NU_NUME_HICL AS id, h.NU_AUTO_DAPL_HICL AS dapl, r.NU_NUME_PLHI_RPET AS plhi,
       CASE WHEN h.FE_FECH_HICL < '2026-07-01' THEN 'A' ELSE 'B' END AS periodo
  INTO #cp
  FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
  JOIN dbo.DATOS_PLANTILLA dp WITH (NOLOCK) ON dp.NU_AUTO_DAPL = h.NU_AUTO_DAPL_HICL
  JOIN dbo.R_PLAN_ESP_TIAT r WITH (NOLOCK)  ON r.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL
 WHERE h.NU_NUME_HICL >= @id_desde
   AND h.FE_FECH_HICL >= @desde AND h.FE_FECH_HICL < @hasta
   AND (h.FE_FECH_HICL < '2026-07-01' OR h.FE_FECH_HICL >= '2026-08-01')
   AND h.TX_TIPO_HICL = 'CON'
   AND ISNULL(h.NU_NUME_REG_HICL, 0) = 0
   AND h.TX_CODSER_HICL IN ('S39141', 'S39141-1')
   AND r.NU_NUME_PLHI_RPET IN (844, 870)
OPTION (MAXDOP 1, RECOMPILE);

IF OBJECT_ID('tempdb..#n') IS NOT NULL DROP TABLE #n;
SELECT plhi, periodo, COUNT(*) AS n INTO #n FROM #cp GROUP BY plhi, periodo;

-- campos que hoy van al informe (la lista de MAPEO_HIS.md §2.9)
IF OBJECT_ID('tempdb..#campos_resumen') IS NOT NULL DROP TABLE #campos_resumen;
CREATE TABLE #campos_resumen (plantilla int NOT NULL, grupo nvarchar(200) COLLATE DATABASE_DEFAULT NULL,
                              campo nvarchar(200) COLLATE DATABASE_DEFAULT NOT NULL);
INSERT #campos_resumen VALUES
    (870, N'MOTIVO DE CONSULTA', N'MC:'), (870, N'CONDUCTA', N'Anotaciones'), (870, N'EDUCACION.', N'Acerca de:'),
    (844, N'MOTIVO DE CONSULTA', N'-'), (844, N'CONDUCTA', N'Conducta'), (844, N'CONDUCTA', N'Proximo control*'),
    (844, N'EDUCACIÓN', N'Metas de educacion para el proximo control'), (844, N'EDUCACIÓN', N'Dieta hiposódica'),
    (844, N'EDUCACIÓN', N'Dieta hipograsa'), (844, N'EDUCACIÓN', N'Dieta hipoglucida'), (844, N'EDUCACIÓN', N'Aumento del ejercicio'),
    (844, N'EDUCACIÓN', N'Disminución de peso'), (844, N'EDUCACIÓN', N'Disminucion del tabaquismo'), (844, N'ANÁLISIS', N'HTA/DM CONTROLADA');

-- valores de todos los campos (solo si están llenos y cuántos bytes)
IF OBJECT_ID('tempdb..#agg') IS NOT NULL DROP TABLE #agg;
;WITH v AS (
    SELECT cp.plhi, cp.periodo, t.NU_INDI_DPTE AS indi, 'TEXT' AS clase, CAST(DATALENGTH(t.TX_DESC_DPTE) AS bigint) AS b
      FROM #cp cp JOIN dbo.DATOS_PLANTILLA_TEXT t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPTE = cp.dapl
     WHERE LEN(LTRIM(RTRIM(t.TX_DESC_DPTE))) > 0
    UNION ALL
    SELECT cp.plhi, cp.periodo, t.NU_INDI_DPME, 'MEMO', CAST(DATALENGTH(t.TX_DESC_DPME) AS bigint)
      FROM #cp cp JOIN dbo.DATOS_PLANTILLA_MEMO t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPME = cp.dapl
     WHERE DATALENGTH(t.TX_DESC_DPME) > 0
    UNION ALL
    SELECT cp.plhi, cp.periodo, t.NU_INDI_DPNU, 'NUME', 0
      FROM #cp cp JOIN dbo.DATOS_PLANTILLA_NUME t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPNU = cp.dapl
     WHERE ISNULL(t.NU_DESC_DPNU, 0) <> 0
)
SELECT plhi, indi, clase,
       SUM(CASE WHEN periodo = 'A' THEN 1 ELSE 0 END)        AS con_a,
       AVG(CASE WHEN periodo = 'A' THEN 1.0 * b END)         AS bytes_a,
       SUM(CASE WHEN periodo = 'B' THEN 1 ELSE 0 END)        AS con_b,
       AVG(CASE WHEN periodo = 'B' THEN 1.0 * b END)         AS bytes_b
  INTO #agg
  FROM v
 GROUP BY plhi, indi, clase
OPTION (MAXDOP 1);

IF OBJECT_ID('tempdb..#res') IS NOT NULL DROP TABLE #res;
SELECT a.plhi AS plantilla, g.CD_CODI_GRHI AS grupo, co.CD_CODI_COHI AS campo, a.clase,
       CASE WHEN EXISTS (SELECT 1 FROM #campos_resumen k WHERE k.plantilla = a.plhi AND k.grupo = g.CD_CODI_GRHI AND k.campo = co.CD_CODI_COHI)
            THEN N'sí' ELSE N'' END                                                   AS va_al_informe,
       CAST(100.0 * a.con_a / NULLIF(na.n, 0) AS decimal(5, 1))                       AS pct_abr_jun,
       CAST(ISNULL(a.bytes_a, 0) AS decimal(9, 0))                                    AS bytes_abr_jun,
       CAST(100.0 * a.con_b / NULLIF(nb.n, 0) AS decimal(5, 1))                       AS pct_ago_oct,
       CAST(ISNULL(a.bytes_b, 0) AS decimal(9, 0))                                    AS bytes_ago_oct,
       CAST((1.0 * a.con_b / NULLIF(nb.n, 0) * ISNULL(a.bytes_b, 0)
           - 1.0 * a.con_a / NULLIF(na.n, 0) * ISNULL(a.bytes_a, 0)) AS decimal(9, 0)) AS cambio_bytes_por_consulta
  INTO #res
  FROM #agg a
  LEFT JOIN #n na ON na.plhi = a.plhi AND na.periodo = 'A'
  LEFT JOIN #n nb ON nb.plhi = a.plhi AND nb.periodo = 'B'
  LEFT JOIN dbo.R_PLAN_CONC rc WITH (NOLOCK)   ON rc.NU_NUME_PLHI_RPC = a.plhi AND rc.NU_INDI_RPC = a.indi
  LEFT JOIN dbo.CONCEPTO_HIST co WITH (NOLOCK) ON co.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
  LEFT JOIN dbo.GRUPO_HIST g WITH (NOLOCK)     ON g.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC;

SELECT N'P-0' AS bloque, @id_desde AS leer_desde_nu_nume_hicl, CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO: avísame' END AS frontera_confiable,
       (SELECT n FROM #n WHERE plhi = 844 AND periodo = 'A') AS consultas_844_abr_jun, (SELECT n FROM #n WHERE plhi = 844 AND periodo = 'B') AS consultas_844_ago_oct,
       (SELECT n FROM #n WHERE plhi = 870 AND periodo = 'A') AS consultas_870_abr_jun, (SELECT n FROM #n WHERE plhi = 870 AND periodo = 'B') AS consultas_870_ago_oct;
GO

-- =============================================================================
-- P-1 · Control crónicos (844): todos los campos, del que más cambió al que menos
-- =============================================================================
IF OBJECT_ID('tempdb..#res') IS NULL BEGIN RAISERROR(N'Corre primero P-0 en esta misma ventana.', 16, 1); RETURN; END;
SELECT grupo, campo, clase, va_al_informe, pct_abr_jun, bytes_abr_jun, pct_ago_oct, bytes_ago_oct, cambio_bytes_por_consulta
  FROM #res
 WHERE plantilla = 844
 ORDER BY ABS(ISNULL(cambio_bytes_por_consulta, 0)) DESC, ABS(ISNULL(pct_ago_oct, 0) - ISNULL(pct_abr_jun, 0)) DESC;
GO

-- =============================================================================
-- P-2 · Consulta externa (870): los 25 campos que más cambiaron
-- =============================================================================
IF OBJECT_ID('tempdb..#res') IS NULL BEGIN RAISERROR(N'Corre primero P-0 en esta misma ventana.', 16, 1); RETURN; END;
SELECT TOP (25) grupo, campo, clase, va_al_informe, pct_abr_jun, bytes_abr_jun, pct_ago_oct, bytes_ago_oct, cambio_bytes_por_consulta
  FROM #res
 WHERE plantilla = 870
 ORDER BY ABS(ISNULL(cambio_bytes_por_consulta, 0)) DESC, ABS(ISNULL(pct_ago_oct, 0) - ISNULL(pct_abr_jun, 0)) DESC;
GO

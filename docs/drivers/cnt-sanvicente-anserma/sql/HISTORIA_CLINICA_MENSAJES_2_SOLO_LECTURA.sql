/* =============================================================================
   RESUMEN DE LA ATENCIÓN · MENSAJES, SEGUNDA PARTE · SOLO LECTURA
   Base: ESEHSVP
   =============================================================================

   Sigue a HISTORIA_CLINICA_MENSAJES_SOLO_LECTURA.sql (corrido el 2026-10-28).
   Dos preguntas que dejó abiertas:

     M-7  Fórmulas sin el filtro de «unidad de venta». M-3 aplicó los dos
          filtros del RDA del proveedor y las consultas con medicamentos
          externos (AE) cayeron a 2-132 al mes, cuando la ronda 3 contó ~1.780
          en 30 días. El resumen solo debe quitar los anulados: esto mide
          cuántas fórmulas salen así, cuántas consultas tienen solo
          medicamentos externos y cuántos renglones no tienen unidad de venta.
     M-8  Lo que va al informe bajó de ~0,85 KB por consulta (abril-junio) a
          ~0,65 KB (julio-octubre) en el piloto, con el mismo texto total.
          ¿Cambió la plantilla? (a) plantillas del piloto por mes; (b) todas
          las de la consulta externa, con cuánto llevan al informe; (c) los
          campos de las plantillas del piloto que NO están en la lista del
          informe (para decidir si se agregan).

   QUÉ HACE Y QUÉ NO HACE
     · Solo lee; tablas temporales (#) que se borran al cerrar la ventana.
     · Sin bloqueos (READ UNCOMMITTED), un solo procesador (MAXDOP 1).
     · Solo conteos, tamaños y NOMBRES DE CAMPOS: ningún dato de pacientes.
     · Más liviano que la primera parte. F5 con todo, ventana nueva en ESEHSVP.
       Devuélveme cada cuadrícula, un mensaje por bloque.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- =============================================================================
-- M-0 · Las consultas de la ventana (igual que en la primera parte)
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

IF OBJECT_ID('tempdb..#c') IS NOT NULL DROP TABLE #c;
SELECT h.NU_NUME_HICL                                          AS id,
       DATEFROMPARTS(YEAR(h.FE_FECH_HICL), MONTH(h.FE_FECH_HICL), 1) AS mes,
       h.TX_CODSER_HICL                                        AS ser,
       h.NU_AUTO_DAPL_HICL                                     AS dapl,
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
CREATE TABLE #alc (alcance nvarchar(40) NOT NULL, id int NOT NULL);
INSERT #alc SELECT N'1 Piloto (S39141 + S39141-1)', id FROM #c WHERE piloto = 1;
INSERT #alc SELECT N'2 Consulta externa sin urgencias', id FROM #c;
CREATE CLUSTERED INDEX ix_alc ON #alc (id, alcance);

SELECT N'M-0' AS bloque, @desde AS desde, DATEADD(day, -1, @hasta) AS hasta, @id_desde AS leer_desde_nu_nume_hicl,
       CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO: avísame' END AS frontera_confiable,
       (SELECT COUNT(*) FROM #c) AS consultas_externas, (SELECT COUNT(*) FROM #c WHERE piloto = 1) AS consultas_piloto;
GO

-- =============================================================================
-- M-7 · Fórmulas quitando SOLO los anulados, por alcance y mes
--
-- con_formula: al menos un medicamento no anulado (lo que recibiría el paciente).
-- solo_externa_ae: todos sus medicamentos son de dispensador externo.
-- renglones_sin_unidad_de_venta: los que el filtro del RDA habría quitado.
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero M-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#med') IS NOT NULL DROP TABLE #med;
SELECT c.id, o.NU_AUTO_HORD AS orden, o.TX_TIAP_HORD AS tiap,
       CASE WHEN o.FE_POSFECHA IS NOT NULL THEN 1 ELSE 0 END AS posf,
       m.CD_CODI_ARTI_HMED AS art,
       CASE WHEN ISNULL(m.NU_ESTA_HMED, 0) = 0 THEN 1 ELSE 0 END AS anulado,
       CASE WHEN m.NU_AUTO_UNVE_HMED IS NULL THEN 1 ELSE 0 END AS sin_unve
  INTO #med
  FROM #c c
  JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = c.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI  m WITH (NOLOCK) ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
OPTION (MAXDOP 1);

IF OBJECT_ID('tempdb..#fm') IS NOT NULL DROP TABLE #fm;
SELECT id,
       COUNT(*)                                                           AS renglones,
       COUNT(DISTINCT orden)                                              AS ordenes,
       COUNT(DISTINCT CASE WHEN posf = 1 THEN orden END)                  AS ordenes_posf,
       COUNT(DISTINCT art)                                                AS articulos,
       MAX(CASE WHEN tiap = 'AI' THEN 1 ELSE 0 END)                       AS ai,
       MAX(CASE WHEN tiap = 'AE' THEN 1 ELSE 0 END)                       AS ae,
       SUM(sin_unve)                                                      AS sin_unve,
       SUM(CASE WHEN tiap = 'AE' THEN 1 ELSE 0 END)                       AS renglones_ae,
       SUM(CASE WHEN tiap = 'AE' AND sin_unve = 1 THEN 1 ELSE 0 END)      AS ae_sin_unve,
       SUM(CASE WHEN tiap = 'AI' AND sin_unve = 1 THEN 1 ELSE 0 END)      AS ai_sin_unve
  INTO #fm
  FROM #med
 WHERE anulado = 0
 GROUP BY id;

SELECT a.alcance, CONVERT(char(7), c.mes, 120) AS mes,
       COUNT(*)                                                           AS consultas,
       COUNT(f.id)                                                        AS con_formula,
       CAST(100.0 * COUNT(f.id) / COUNT(*) AS decimal(5, 1))              AS pct_con_formula,
       SUM(ISNULL(f.ai, 0))                                               AS con_farmacia_hospital_ai,
       SUM(ISNULL(f.ae, 0))                                               AS con_externa_ae,
       SUM(CASE WHEN f.ae = 1 AND f.ai = 0 THEN 1 ELSE 0 END)             AS solo_externa_ae,
       SUM(ISNULL(f.ordenes, 0))                                          AS ordenes_de_formula,
       SUM(ISNULL(f.ordenes_posf, 0))                                     AS de_ellas_posfechadas,
       SUM(ISNULL(f.renglones, 0))                                        AS renglones_de_medicamento,
       SUM(ISNULL(f.articulos, 0))                                        AS medicamentos_distintos,
       CAST(1.0 * SUM(ISNULL(f.articulos, 0)) / NULLIF(COUNT(f.id), 0) AS decimal(9, 2)) AS medicamentos_por_formula,
       SUM(ISNULL(f.renglones_ae, 0))                                     AS renglones_ae,
       SUM(ISNULL(f.ae_sin_unve, 0))                                      AS renglones_ae_sin_unidad_de_venta,
       SUM(ISNULL(f.ai_sin_unve, 0))                                      AS renglones_ai_sin_unidad_de_venta,
       SUM(ISNULL(an.n, 0))                                               AS renglones_anulados
  FROM #alc a
  JOIN #c c       ON c.id = a.id
  LEFT JOIN #fm f ON f.id = c.id
  LEFT JOIN (SELECT id, COUNT(*) AS n FROM #med WHERE anulado = 1 GROUP BY id) an ON an.id = c.id
 GROUP BY a.alcance, c.mes
 ORDER BY a.alcance, c.mes;
GO

-- =============================================================================
-- M-8 · ¿Qué plantillas usa la consulta y cuánto llevan al informe?
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero M-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#campos_resumen') IS NOT NULL DROP TABLE #campos_resumen;
CREATE TABLE #campos_resumen (plantilla int NOT NULL, grupo nvarchar(200) COLLATE DATABASE_DEFAULT NULL,
                              campo nvarchar(200) COLLATE DATABASE_DEFAULT NOT NULL);
INSERT #campos_resumen VALUES
    (870, N'MOTIVO DE CONSULTA', N'MC:'), (870, N'CONDUCTA', N'Anotaciones'), (870, N'EDUCACION.', N'Acerca de:'),
    (844, N'MOTIVO DE CONSULTA', N'-'), (844, N'CONDUCTA', N'Conducta'), (844, N'CONDUCTA', N'Proximo control*'),
    (844, N'EDUCACIÓN', N'Metas de educacion para el proximo control'), (844, N'EDUCACIÓN', N'Dieta hiposódica'),
    (844, N'EDUCACIÓN', N'Dieta hipograsa'), (844, N'EDUCACIÓN', N'Dieta hipoglucida'), (844, N'EDUCACIÓN', N'Aumento del ejercicio'),
    (844, N'EDUCACIÓN', N'Disminución de peso'), (844, N'EDUCACIÓN', N'Disminucion del tabaquismo'), (844, N'ANÁLISIS', N'HTA/DM CONTROLADA'),
    (858, N'MOTIVO CONSULTA Y ENFERMEDAD ACTUAL', N'Motivo de la Consulta'), (858, N'EXAMEN FISICO GENERAL', N'Análisis y Plan'),
    (899, N'MOTIVO CONSULTA Y ENFERMEDAD ACTUAL', N'Motivo de la Consulta'), (899, N'EXAMEN FISICO GENERAL', N'Análisis y Plan'),
    (907, N'MOTIVO CONSULTA', N'Motivo de la Consulta'), (907, N'RECOMENDACIONES Y OBSERVACIONES', N'Recomendaciones'),
    (907, N'RECOMENDACIONES Y OBSERVACIONES', N'Observaciones'), (907, N'RECOMENDACIONES Y OBSERVACIONES', N'Próximo Control:'),
    (843, NULL, N'Recomendaciones de alimentación'), (843, NULL, N'Recomendaciones de estimulacion'),
    (843, NULL, N'Recomendaciones y Observaciones'), (843, N'Proximo control', N'Hora.'),
    (860, NULL, N'Recomendaciones de alimentación'), (860, NULL, N'Recomendaciones de estimulacion'),
    (860, NULL, N'Recomendaciones y Observaciones'), (860, N'Proximo control', N'Hora.'),
    (849, NULL, N'Recomendaciones/Signos alarma/Plan cuidado'), (862, NULL, N'Recomendaciones/Signos alarma/Plan cuidado');

IF OBJECT_ID('tempdb..#wl') IS NOT NULL DROP TABLE #wl;
SELECT DISTINCT rc.NU_NUME_PLHI_RPC AS plhi, rc.NU_INDI_RPC AS indi
  INTO #wl
  FROM dbo.R_PLAN_CONC rc WITH (NOLOCK)
  JOIN dbo.CONCEPTO_HIST co WITH (NOLOCK) ON co.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
  JOIN dbo.GRUPO_HIST gr WITH (NOLOCK)    ON gr.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC
  JOIN #campos_resumen k ON k.plantilla = rc.NU_NUME_PLHI_RPC AND (k.grupo IS NULL OR k.grupo = gr.CD_CODI_GRHI) AND k.campo = co.CD_CODI_COHI;

IF OBJECT_ID('tempdb..#cp') IS NOT NULL DROP TABLE #cp;
SELECT c.id, c.dapl, c.mes, c.piloto, r.NU_NUME_PLHI_RPET AS plhi
  INTO #cp
  FROM #c c
  JOIN dbo.DATOS_PLANTILLA dp WITH (NOLOCK)     ON dp.NU_AUTO_DAPL = c.dapl
  LEFT JOIN dbo.R_PLAN_ESP_TIAT r WITH (NOLOCK) ON r.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL;

-- bytes de los campos de la lista, por consulta (solo se leen esos campos)
IF OBJECT_ID('tempdb..#inf') IS NOT NULL DROP TABLE #inf;
;WITH v AS (
    SELECT cp.id, CAST(ISNULL(DATALENGTH(t.TX_DESC_DPTE), 0) AS bigint) AS b
      FROM #cp cp JOIN #wl w ON w.plhi = cp.plhi
      JOIN dbo.DATOS_PLANTILLA_TEXT t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPTE = cp.dapl AND t.NU_INDI_DPTE = w.indi
    UNION ALL
    SELECT cp.id, CAST(ISNULL(DATALENGTH(t.TX_DESC_DPME), 0) AS bigint)
      FROM #cp cp JOIN #wl w ON w.plhi = cp.plhi
      JOIN dbo.DATOS_PLANTILLA_MEMO t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPME = cp.dapl AND t.NU_INDI_DPME = w.indi
)
SELECT id, SUM(b) AS b INTO #inf FROM v GROUP BY id
OPTION (MAXDOP 1);

-- (a) piloto: plantillas por mes
SELECT CONVERT(char(7), cp.mes, 120) AS mes, cp.plhi AS plantilla, p.TX_DESC_PLHI AS nombre,
       CASE WHEN cp.plhi IN (SELECT plantilla FROM #campos_resumen) THEN N'sí' ELSE N'NO' END AS en_la_lista,
       COUNT(*)                                                             AS consultas,
       CAST(AVG(ISNULL(i.b, 0) / 1024.0) AS decimal(9, 2))                  AS kb_al_informe,
       SUM(CASE WHEN ISNULL(i.b, 0) = 0 THEN 1 ELSE 0 END)                  AS sin_nada_para_el_informe
  FROM #cp cp
  LEFT JOIN dbo.PLANTILLA_HIST p WITH (NOLOCK) ON p.NU_NUME_PLHI = cp.plhi
  LEFT JOIN #inf i ON i.id = cp.id
 WHERE cp.piloto = 1
 GROUP BY cp.mes, cp.plhi, p.TX_DESC_PLHI
 ORDER BY cp.mes, consultas DESC;

-- (b) consulta externa: todas las plantillas con 30 consultas o más en la ventana
SELECT cp.plhi AS plantilla, p.TX_DESC_PLHI AS nombre,
       CASE WHEN cp.plhi IN (SELECT plantilla FROM #campos_resumen) THEN N'sí' ELSE N'NO' END AS en_la_lista,
       COUNT(*)                                                             AS consultas,
       SUM(cp.piloto)                                                       AS del_piloto,
       CAST(AVG(ISNULL(i.b, 0) / 1024.0) AS decimal(9, 2))                  AS kb_al_informe,
       CAST(100.0 * SUM(CASE WHEN ISNULL(i.b, 0) = 0 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5, 1)) AS pct_sin_nada_para_el_informe
  FROM #cp cp
  LEFT JOIN dbo.PLANTILLA_HIST p WITH (NOLOCK) ON p.NU_NUME_PLHI = cp.plhi
  LEFT JOIN #inf i ON i.id = cp.id
 GROUP BY cp.plhi, p.TX_DESC_PLHI
HAVING COUNT(*) >= 30
 ORDER BY consultas DESC;

-- (c) campos con texto de las plantillas del piloto que NO están en la lista (nombres y tamaños, sin contenido)
IF OBJECT_ID('tempdb..#fuera') IS NOT NULL DROP TABLE #fuera;
SELECT cp.id, cp.plhi, cp.dapl
  INTO #fuera
  FROM #cp cp
 WHERE cp.piloto = 1 AND (cp.plhi IS NULL OR cp.plhi NOT IN (SELECT plantilla FROM #campos_resumen));

;WITH v AS (
    SELECT f.id, f.plhi, t.NU_INDI_DPTE AS indi, DATALENGTH(t.TX_DESC_DPTE) AS b
      FROM #fuera f JOIN dbo.DATOS_PLANTILLA_TEXT t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPTE = f.dapl
     WHERE LEN(LTRIM(RTRIM(t.TX_DESC_DPTE))) > 0
    UNION ALL
    SELECT f.id, f.plhi, t.NU_INDI_DPME, DATALENGTH(t.TX_DESC_DPME)
      FROM #fuera f JOIN dbo.DATOS_PLANTILLA_MEMO t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPME = f.dapl
     WHERE DATALENGTH(t.TX_DESC_DPME) > 0
)
SELECT TOP (60) v.plhi AS plantilla, p.TX_DESC_PLHI AS nombre, g.CD_CODI_GRHI AS grupo, co.CD_CODI_COHI AS campo,
       COUNT(DISTINCT v.id)                                                 AS consultas_con_valor,
       CAST(100.0 * COUNT(DISTINCT v.id) / NULLIF((SELECT COUNT(*) FROM #fuera x WHERE x.plhi = v.plhi), 0) AS decimal(5, 1)) AS pct_de_su_plantilla,
       AVG(v.b)                                                             AS bytes_promedio,
       MAX(v.b)                                                             AS bytes_max
  FROM v
  LEFT JOIN dbo.R_PLAN_CONC rc WITH (NOLOCK)  ON rc.NU_NUME_PLHI_RPC = v.plhi AND rc.NU_INDI_RPC = v.indi
  LEFT JOIN dbo.CONCEPTO_HIST co WITH (NOLOCK) ON co.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
  LEFT JOIN dbo.GRUPO_HIST g WITH (NOLOCK)    ON g.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC
  LEFT JOIN dbo.PLANTILLA_HIST p WITH (NOLOCK) ON p.NU_NUME_PLHI = v.plhi
 GROUP BY v.plhi, p.TX_DESC_PLHI, g.CD_CODI_GRHI, co.CD_CODI_COHI
 ORDER BY consultas_con_valor DESC
OPTION (MAXDOP 1);
GO

/* =============================================================================
   RESUMEN DE LA ATENCIÓN · CUÁNTOS MENSAJES SALDRÍAN AL MES
   ESTRICTAMENTE SOLO LECTURA · Base: ESEHSVP
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md §9. Informe interactivo:
   evidencia/ESTADISTICA_HISTORIA_CLINICA_2026-10-28.html, sección «Noviembre».
   Hoy esa sección proyecta las fórmulas y los exámenes con las tasas de 30 días
   de la ronda 3; con este resultado pasa a cifras medidas mes por mes.

   Cada paciente que pasó por consulta recibiría su informe de la consulta, su
   fórmula (si le formularon) y sus órdenes de exámenes (si le ordenaron). Esta
   consulta mide, mes por mes desde abril y para los dos alcances del plan
   (piloto = S39141 + S39141-1; consulta externa = consulta ambulatoria sin
   urgencias), lo necesario para proyectar noviembre:

     M-1  Consultas, pacientes y días hábiles (consultas por día hábil).
     M-2  Lo que anotó el médico: campos llenos por consulta, KB de texto, KB
          de lo que iría al informe, recomendaciones y diagnósticos.
     M-3  Fórmulas: consultas con fórmula (farmacia del hospital AI / externa
          AE), órdenes de fórmula con sus entregas posfechadas, medicamentos.
     M-4  Exámenes: consultas con exámenes, órdenes y exámenes por tipo; y
          remisiones, incapacidades e interconsultas.
     M-5  A quién llegaría: pacientes con celular (el del acompañante si es
          menor), con correo propio, y consultas con diagnóstico sensible (D7).
     M-6  Consultas por día de la semana y en festivos: ¿hay consulta los
          sábados? Cambia la proyección (noviembre tiene 19 días hábiles).

   QUÉ HACE Y QUÉ NO HACE
     · Solo lee. Copia lo mínimo (llave, fecha, paciente, servicio) a tablas
       temporales (#), que se borran al cerrar la ventana. No ejecuta
       procedimientos del hospital.
     · Lectura sin bloqueos (READ UNCOMMITTED) y un solo procesador (MAXDOP 1).
     · No muestra nombres, documentos ni texto clínico: solo conteos y tamaños.
     · Lee unas 30.000 consultas con sus órdenes y su plantilla: mejor después
       de las 19:00 o un domingo. Si tarda demasiado, @medir_texto = 0 omite
       la parte pesada de M-2 (el texto de la plantilla).

   CÓMO CORRERLO: ventana nueva en ESEHSVP, F5 con todo. Devuélveme cada
   cuadrícula, un mensaje por bloque.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- =============================================================================
-- M-0 · Las consultas de la ventana (OBLIGATORIO, PRIMERO)
-- =============================================================================
DECLARE @desde       date = '2026-04-01';   -- primer mes que se mide
DECLARE @medir_texto bit  = 1;              -- 0 = omite el texto de la plantilla en M-2

DECLARE @obj int = OBJECT_ID(N'dbo.HISTORIACLINICA');
IF @obj IS NULL
BEGIN
    RAISERROR(N'No existe dbo.HISTORIACLINICA en esta base. ¿La ventana está en ESEHSVP?', 16, 1);
    RETURN;
END;
IF (SELECT COUNT(*) FROM sys.columns
     WHERE object_id = @obj
       AND name IN (N'NU_NUME_HICL', N'FE_FECH_HICL', N'NU_HIST_PAC_HICL', N'TX_TIPO_HICL', N'NU_NUME_REG_HICL',
                    N'TX_CODSER_HICL', N'NU_AUTO_DAPL_HICL', N'NU_NUME_LABO_HICL')) <> 8
BEGIN
    RAISERROR(N'HISTORIACLINICA cambió: falta alguna de las columnas confirmadas. Avísame antes de seguir.', 16, 1);
    RETURN;
END;

IF OBJECT_ID('tempdb..#cfg') IS NOT NULL DROP TABLE #cfg;
SELECT @desde AS desde, @medir_texto AS medir_texto INTO #cfg;

DECLARE @hasta date = DATEADD(day, 1, CAST(GETDATE() AS date));

-- Frontera: desde qué NU_NUME_HICL leer (crece con el tiempo; se camina hacia atrás por tramos)
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

-- Festivos de Colombia en 2026 (Ley Emiliani)
IF OBJECT_ID('tempdb..#festivos') IS NOT NULL DROP TABLE #festivos;
CREATE TABLE #festivos (dia date NOT NULL PRIMARY KEY);
INSERT #festivos VALUES ('2026-01-01'), ('2026-01-12'), ('2026-03-23'), ('2026-04-02'), ('2026-04-03'), ('2026-05-01'),
    ('2026-05-18'), ('2026-06-08'), ('2026-06-15'), ('2026-06-29'), ('2026-07-20'), ('2026-08-07'), ('2026-08-17'),
    ('2026-10-12'), ('2026-11-02'), ('2026-11-16'), ('2026-12-08'), ('2026-12-25');

-- Calendario de la ventana: día de la semana (1 = lunes … 7 = domingo) y si es hábil
IF OBJECT_ID('tempdb..#dias') IS NOT NULL DROP TABLE #dias;
;WITH n AS (SELECT TOP (DATEDIFF(day, @desde, @hasta)) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS k
              FROM sys.all_objects a CROSS JOIN sys.all_objects b)
SELECT x.dia, DATEFROMPARTS(YEAR(x.dia), MONTH(x.dia), 1) AS mes, x.dow,
       CASE WHEN f.dia IS NOT NULL THEN 1 ELSE 0 END AS festivo,
       CASE WHEN x.dow <= 5 AND f.dia IS NULL THEN 1 ELSE 0 END AS habil
  INTO #dias
  FROM (SELECT DATEADD(day, k, @desde) AS dia, (DATEDIFF(day, '19000101', DATEADD(day, k, @desde)) % 7) + 1 AS dow FROM n) x
  LEFT JOIN #festivos f ON f.dia = x.dia;

-- Las consultas: CON, ambulatorias (sin registro de ingreso), sin urgencias (S39145). Igual que E-2d.
IF OBJECT_ID('tempdb..#c') IS NOT NULL DROP TABLE #c;
SELECT h.NU_NUME_HICL                                          AS id,
       DATEFROMPARTS(YEAR(h.FE_FECH_HICL), MONTH(h.FE_FECH_HICL), 1) AS mes,
       CAST(h.FE_FECH_HICL AS date)                            AS dia,
       LTRIM(RTRIM(h.NU_HIST_PAC_HICL))                        AS pac,
       h.TX_CODSER_HICL                                        AS ser,
       h.NU_AUTO_DAPL_HICL                                     AS dapl,
       h.NU_NUME_LABO_HICL                                     AS labo,
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

-- Los dos alcances (el piloto es parte de la consulta externa)
IF OBJECT_ID('tempdb..#alc') IS NOT NULL DROP TABLE #alc;
CREATE TABLE #alc (alcance nvarchar(40) NOT NULL, id int NOT NULL);
INSERT #alc SELECT N'1 Piloto (S39141 + S39141-1)', id FROM #c WHERE piloto = 1;
INSERT #alc SELECT N'2 Consulta externa sin urgencias', id FROM #c;
CREATE CLUSTERED INDEX ix_alc ON #alc (id, alcance);

SELECT N'M-0' AS bloque, @desde AS desde, DATEADD(day, -1, @hasta) AS hasta, @id_desde AS leer_desde_nu_nume_hicl,
       @tramos AS tramos_leidos,
       CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO: avísame' END AS frontera_confiable,
       (SELECT COUNT(*) FROM #c) AS consultas_externas, (SELECT COUNT(*) FROM #c WHERE piloto = 1) AS consultas_piloto;
GO

-- =============================================================================
-- M-1 · Consultas, pacientes y días hábiles, por alcance y mes
--
-- «dias_habiles» del mes en curso cuenta solo hasta hoy. «por_dia_habil» es
-- la base de la proyección: noviembre tiene 19 días hábiles (festivos 2 y 16).
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero M-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#hab') IS NOT NULL DROP TABLE #hab;
SELECT mes, SUM(habil) AS habiles INTO #hab FROM #dias GROUP BY mes;

SELECT a.alcance, CONVERT(char(7), c.mes, 120) AS mes,
       COUNT(*)                                                       AS consultas,
       COUNT(DISTINCT c.pac)                                          AS pacientes,
       hb.habiles                                                     AS dias_habiles,
       SUM(d.habil)                                                   AS en_dia_habil,
       SUM(CASE WHEN d.dow = 6 AND d.festivo = 0 THEN 1 ELSE 0 END)   AS en_sabado,
       SUM(CASE WHEN d.dow = 7 OR d.festivo = 1 THEN 1 ELSE 0 END)    AS en_domingo_o_festivo,
       CAST(1.0 * SUM(d.habil) / NULLIF(hb.habiles, 0) AS decimal(9, 1)) AS por_dia_habil
  FROM #alc a
  JOIN #c c     ON c.id = a.id
  JOIN #dias d  ON d.dia = c.dia
  JOIN #hab hb  ON hb.mes = c.mes
 GROUP BY a.alcance, c.mes, hb.habiles
 ORDER BY a.alcance, c.mes;
GO

-- =============================================================================
-- M-2 · Lo que anotó el médico en cada consulta, por alcance y mes
--
-- campos_llenos: campos de la plantilla con algo escrito o marcado.
-- kb_texto: todo el texto que escribió (campos cortos y largos).
-- kb_al_informe: solo los campos que irían al informe (motivo, plan,
-- educación, próximo control…; la lista de MAPEO_HIS.md §2.9, ronda 4).
-- Recomendaciones (HIST_INDI) y diagnósticos (R_LABO_DIAG) van aparte.
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

-- (plantilla, índice) de los campos que van al informe
IF OBJECT_ID('tempdb..#wl') IS NOT NULL DROP TABLE #wl;
SELECT DISTINCT rc.NU_NUME_PLHI_RPC AS plhi, rc.NU_INDI_RPC AS indi
  INTO #wl
  FROM dbo.R_PLAN_CONC rc WITH (NOLOCK)
  JOIN dbo.CONCEPTO_HIST co WITH (NOLOCK) ON co.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
  JOIN dbo.GRUPO_HIST gr WITH (NOLOCK)    ON gr.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC
  JOIN #campos_resumen k ON k.plantilla = rc.NU_NUME_PLHI_RPC AND (k.grupo IS NULL OR k.grupo = gr.CD_CODI_GRHI) AND k.campo = co.CD_CODI_COHI;

-- plantilla de cada consulta
IF OBJECT_ID('tempdb..#cp') IS NOT NULL DROP TABLE #cp;
SELECT c.id, c.dapl, r.NU_NUME_PLHI_RPET AS plhi
  INTO #cp
  FROM #c c
  JOIN dbo.DATOS_PLANTILLA dp WITH (NOLOCK)  ON dp.NU_AUTO_DAPL = c.dapl
  LEFT JOIN dbo.R_PLAN_ESP_TIAT r WITH (NOLOCK) ON r.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL;

IF OBJECT_ID('tempdb..#nota') IS NOT NULL DROP TABLE #nota;
CREATE TABLE #nota (id int PRIMARY KEY, campos int, campos_texto int, bytes_texto bigint, bytes_informe bigint);
IF (SELECT medir_texto FROM #cfg) = 1
BEGIN
    ;WITH v AS (
        SELECT cp.id, cp.plhi, t.NU_INDI_DPTE AS indi,
               CASE WHEN LEN(LTRIM(RTRIM(t.TX_DESC_DPTE))) > 0 THEN 1 ELSE 0 END AS lleno, 1 AS es_texto,
               CAST(ISNULL(DATALENGTH(t.TX_DESC_DPTE), 0) AS bigint) AS b
          FROM #cp cp JOIN dbo.DATOS_PLANTILLA_TEXT t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPTE = cp.dapl
        UNION ALL
        SELECT cp.id, cp.plhi, t.NU_INDI_DPME, CASE WHEN DATALENGTH(t.TX_DESC_DPME) > 0 THEN 1 ELSE 0 END, 1,
               CAST(ISNULL(DATALENGTH(t.TX_DESC_DPME), 0) AS bigint)
          FROM #cp cp JOIN dbo.DATOS_PLANTILLA_MEMO t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPME = cp.dapl
        UNION ALL
        SELECT cp.id, cp.plhi, t.NU_INDI_DPNU, CASE WHEN ISNULL(t.NU_DESC_DPNU, 0) <> 0 THEN 1 ELSE 0 END, 0, 0
          FROM #cp cp JOIN dbo.DATOS_PLANTILLA_NUME t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPNU = cp.dapl
        UNION ALL
        SELECT cp.id, cp.plhi, t.NU_INDI_DPDA, CASE WHEN t.FE_DESC_DPDA IS NOT NULL THEN 1 ELSE 0 END, 0, 0
          FROM #cp cp JOIN dbo.DATOS_PLANTILLA_DATE t WITH (NOLOCK) ON t.NU_AUTO_DAPL_DPDA = cp.dapl
    )
    INSERT #nota (id, campos, campos_texto, bytes_texto, bytes_informe)
    SELECT v.id, SUM(v.lleno), SUM(CASE WHEN v.es_texto = 1 THEN v.lleno ELSE 0 END), SUM(v.b),
           SUM(CASE WHEN w.plhi IS NOT NULL THEN v.b ELSE 0 END)
      FROM v
      LEFT JOIN #wl w ON w.plhi = v.plhi AND w.indi = v.indi
     GROUP BY v.id
    OPTION (MAXDOP 1);
END;

-- recomendaciones y diagnósticos de cada consulta
IF OBJECT_ID('tempdb..#ind') IS NOT NULL DROP TABLE #ind;
SELECT c.id, CAST(SUM(ISNULL(DATALENGTH(i.DE_DESC_HIND), 0)) AS bigint) AS bytes
  INTO #ind
  FROM #c c JOIN dbo.HIST_INDI i WITH (NOLOCK) ON i.NU_NUME_HICL_HIND = c.id
 GROUP BY c.id
OPTION (MAXDOP 1);
IF OBJECT_ID('tempdb..#dx') IS NOT NULL DROP TABLE #dx;
SELECT c.id, COUNT(*) AS dx
  INTO #dx
  FROM #c c JOIN dbo.R_LABO_DIAG d WITH (NOLOCK) ON d.NU_NUME_LABO_RLAD = c.labo
 GROUP BY c.id
OPTION (MAXDOP 1);

SELECT a.alcance, CONVERT(char(7), c.mes, 120) AS mes,
       COUNT(*)                                                                   AS consultas,
       COUNT(cp.id)                                                               AS con_plantilla,
       CAST(AVG(1.0 * n.campos) AS decimal(9, 1))                                 AS campos_llenos_por_consulta,
       CAST(AVG(1.0 * n.campos_texto) AS decimal(9, 1))                           AS campos_de_texto_por_consulta,
       CAST(AVG(n.bytes_texto / 1024.0) AS decimal(9, 2))                         AS kb_texto_por_consulta,
       CAST(AVG(n.bytes_informe / 1024.0) AS decimal(9, 2))                       AS kb_al_informe_por_consulta,
       COUNT(i.id)                                                                AS con_recomendaciones,
       CAST(AVG(i.bytes / 1024.0) AS decimal(9, 2))                               AS kb_recomendaciones_si_hay,
       CAST(1.0 * SUM(ISNULL(x.dx, 0)) / COUNT(*) AS decimal(9, 2))               AS diagnosticos_por_consulta,
       CAST(SUM(ISNULL(n.bytes_texto, 0) + ISNULL(i.bytes, 0)) / 1048576.0 AS decimal(12, 2)) AS mb_texto_del_mes
  FROM #alc a
  JOIN #c c       ON c.id = a.id
  LEFT JOIN #cp cp  ON cp.id = c.id
  LEFT JOIN #nota n ON n.id = c.id
  LEFT JOIN #ind i  ON i.id = c.id
  LEFT JOIN #dx x   ON x.id = c.id
 GROUP BY a.alcance, c.mes
 ORDER BY a.alcance, c.mes;
GO

-- =============================================================================
-- M-3 · Fórmulas por alcance y mes
--
-- Solo los renglones que el resumen mostraría (el filtro del RDA: sin anulados,
-- NU_ESTA_HMED <> 0, y con unidad de venta). «ordenes_de_formula» cuenta cada
-- orden de medicamentos, incluidas las entregas posfechadas; el paciente
-- recibiría una fórmula por consulta con todas sus fechas.
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero M-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#med') IS NOT NULL DROP TABLE #med;
SELECT c.id, o.NU_AUTO_HORD AS orden, o.TX_TIAP_HORD AS tiap,
       CASE WHEN o.FE_POSFECHA IS NOT NULL THEN 1 ELSE 0 END AS posf,
       m.CD_CODI_ARTI_HMED AS art, CAST(ISNULL(DATALENGTH(m.TX_INDDOS_HMED), 0) AS int) AS b_ind
  INTO #med
  FROM #c c
  JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = c.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI  m WITH (NOLOCK) ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
 WHERE ISNULL(m.NU_ESTA_HMED, 0) <> 0
   AND m.NU_AUTO_UNVE_HMED IS NOT NULL
OPTION (MAXDOP 1);

IF OBJECT_ID('tempdb..#fm') IS NOT NULL DROP TABLE #fm;
SELECT id, COUNT(*) AS renglones, COUNT(DISTINCT orden) AS ordenes,
       COUNT(DISTINCT CASE WHEN posf = 1 THEN orden END) AS ordenes_posf,
       COUNT(DISTINCT art) AS articulos,
       MAX(CASE WHEN tiap = 'AI' THEN 1 ELSE 0 END) AS ai, MAX(CASE WHEN tiap = 'AE' THEN 1 ELSE 0 END) AS ae,
       SUM(b_ind) AS b_ind
  INTO #fm
  FROM #med
 GROUP BY id;

SELECT a.alcance, CONVERT(char(7), c.mes, 120) AS mes,
       COUNT(*)                                                         AS consultas,
       COUNT(f.id)                                                      AS con_formula,
       CAST(100.0 * COUNT(f.id) / COUNT(*) AS decimal(5, 1))            AS pct_con_formula,
       SUM(ISNULL(f.ai, 0))                                             AS con_farmacia_hospital_ai,
       SUM(ISNULL(f.ae, 0))                                             AS con_externa_ae,
       SUM(CASE WHEN f.ai = 1 AND f.ae = 1 THEN 1 ELSE 0 END)           AS con_las_dos,
       SUM(ISNULL(f.ordenes, 0))                                        AS ordenes_de_formula,
       SUM(ISNULL(f.ordenes_posf, 0))                                   AS de_ellas_posfechadas,
       SUM(ISNULL(f.renglones, 0))                                      AS renglones_de_medicamento,
       SUM(ISNULL(f.articulos, 0))                                      AS medicamentos_distintos,
       CAST(1.0 * SUM(ISNULL(f.articulos, 0)) / NULLIF(COUNT(f.id), 0) AS decimal(9, 2)) AS medicamentos_por_formula,
       CAST(AVG(f.b_ind / 1024.0) AS decimal(9, 2))                     AS kb_indicaciones_por_formula
  FROM #alc a
  JOIN #c c       ON c.id = a.id
  LEFT JOIN #fm f ON f.id = c.id
 GROUP BY a.alcance, c.mes
 ORDER BY a.alcance, c.mes;
GO

-- =============================================================================
-- M-4 · Exámenes (y lo demás que el médico ordena) por alcance y mes
--
-- Órdenes 1-4 con sus renglones en HIST_PROC: 1 consulta o control,
-- 2 laboratorio, 3 cirugía, 4 procedimientos y ayudas diagnósticas.
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero M-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#exa') IS NOT NULL DROP TABLE #exa;
SELECT c.id, o.NU_AUTO_HORD AS orden, o.NU_TIPO_HORD AS tipo, COUNT(*) AS renglones
  INTO #exa
  FROM #c c
  JOIN dbo.HIST_ORDEN o WITH (NOLOCK) ON o.NU_NUME_HICL_HORD = c.id AND o.NU_TIPO_HORD IN (1, 2, 3, 4)
  JOIN dbo.HIST_PROC  p WITH (NOLOCK) ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
 GROUP BY c.id, o.NU_AUTO_HORD, o.NU_TIPO_HORD
OPTION (MAXDOP 1);

IF OBJECT_ID('tempdb..#fx') IS NOT NULL DROP TABLE #fx;
SELECT id, COUNT(*) AS ordenes, SUM(renglones) AS renglones,
       SUM(CASE WHEN tipo = 2 THEN renglones ELSE 0 END) AS lab,
       SUM(CASE WHEN tipo = 4 THEN renglones ELSE 0 END) AS proc_,
       SUM(CASE WHEN tipo = 1 THEN renglones ELSE 0 END) AS ctrl,
       SUM(CASE WHEN tipo = 3 THEN renglones ELSE 0 END) AS cir
  INTO #fx
  FROM #exa
 GROUP BY id;

-- remisión, incapacidad e interconsulta de cada consulta
IF OBJECT_ID('tempdb..#otros') IS NOT NULL DROP TABLE #otros;
SELECT c.id,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_REMI r WITH (NOLOCK) WHERE r.NU_NUME_HICL_HREM = c.id) THEN 1 ELSE 0 END AS remi,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_INCA i WITH (NOLOCK) WHERE i.NU_NUME_HICL_HINC = c.id) THEN 1 ELSE 0 END AS inca,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORTIAT t WITH (NOLOCK) WHERE t.NU_NUME_HICL_HOTA = c.id) THEN 1 ELSE 0 END AS ota
  INTO #otros
  FROM #c c
OPTION (MAXDOP 1);

SELECT a.alcance, CONVERT(char(7), c.mes, 120) AS mes,
       COUNT(*)                                                          AS consultas,
       COUNT(x.id)                                                       AS con_examenes,
       CAST(100.0 * COUNT(x.id) / COUNT(*) AS decimal(5, 1))             AS pct_con_examenes,
       SUM(ISNULL(x.ordenes, 0))                                         AS ordenes_de_examenes,
       SUM(ISNULL(x.renglones, 0))                                       AS examenes,
       SUM(ISNULL(x.lab, 0))                                             AS laboratorio,
       SUM(ISNULL(x.proc_, 0))                                           AS procedimientos,
       SUM(ISNULL(x.ctrl, 0))                                            AS consultas_o_controles,
       SUM(ISNULL(x.cir, 0))                                             AS cirugias,
       CAST(1.0 * SUM(ISNULL(x.renglones, 0)) / NULLIF(COUNT(x.id), 0) AS decimal(9, 2)) AS examenes_por_consulta_con_examenes,
       SUM(o.remi)                                                       AS con_remision,
       SUM(o.inca)                                                       AS con_incapacidad,
       SUM(o.ota)                                                        AS con_interconsulta
  FROM #alc a
  JOIN #c c        ON c.id = a.id
  JOIN #otros o    ON o.id = c.id
  LEFT JOIN #fx x  ON x.id = c.id
 GROUP BY a.alcance, c.mes
 ORDER BY a.alcance, c.mes;
GO

-- =============================================================================
-- M-5 · A quién llegaría, por alcance (toda la ventana)
--
-- Celular válido = 10 dígitos que empiezan por 3 (sin espacios, guiones ni +57).
-- Menor de edad = menos de 18 años hoy: se usa el celular y el correo del
-- acompañante. Correo propio = tiene «@» y no es uno de los de relleno.
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero M-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#relleno') IS NOT NULL DROP TABLE #relleno;
CREATE TABLE #relleno (correo varchar(100) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY);
INSERT #relleno VALUES ('pacienteshospital@gmail.com'), ('hsvpanserma@hotmail.com'), ('pacientesanserma@gmail.com');

IF OBJECT_ID('tempdb..#pc') IS NOT NULL DROP TABLE #pc;
SELECT x.pac,
       x.menor,
       CASE WHEN x.cel LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' THEN 1 ELSE 0 END AS con_celular,
       CASE WHEN x.mail LIKE '%_@_%._%' AND x.mail NOT LIKE '% %'
             AND NOT EXISTS (SELECT 1 FROM #relleno r WHERE r.correo = x.mail) THEN 1 ELSE 0 END AS con_correo,
       CASE WHEN EXISTS (SELECT 1 FROM #relleno r WHERE r.correo = x.mail) THEN 1 ELSE 0 END AS correo_relleno
  INTO #pc
  FROM (SELECT p.pac,
               CASE WHEN DATEADD(year, 18, pa.FE_NACI_PAC) > GETDATE() THEN 1 ELSE 0 END AS menor,
               REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(CASE WHEN DATEADD(year, 18, pa.FE_NACI_PAC) > GETDATE()
                                                               THEN pa.DE_TELE_ACOM_PAC ELSE pa.DE_TELE_PAC END, ''))), ' ', ''), '-', ''), '+57', '') AS cel,
               LOWER(LTRIM(RTRIM(ISNULL(CASE WHEN DATEADD(year, 18, pa.FE_NACI_PAC) > GETDATE()
                                             THEN pa.TX_EMAIL_ACOM_PAC ELSE pa.DE_EMAIL_PAC END, '')))) AS mail
          FROM (SELECT DISTINCT pac FROM #c) p
          JOIN dbo.PACIENTES pa WITH (NOLOCK) ON pa.NU_HIST_PAC = p.pac) x;

IF OBJECT_ID('tempdb..#sens') IS NOT NULL DROP TABLE #sens;
SELECT DISTINCT c.id
  INTO #sens
  FROM #c c JOIN dbo.R_LABO_DIAG d WITH (NOLOCK) ON d.NU_NUME_LABO_RLAD = c.labo
 WHERE d.CD_CODI_DIAG_RLAD LIKE 'B2[0-4]%' OR d.CD_CODI_DIAG_RLAD LIKE 'Z21%' OR d.CD_CODI_DIAG_RLAD LIKE 'F%'
    OR d.CD_CODI_DIAG_RLAD LIKE 'T74%' OR d.CD_CODI_DIAG_RLAD LIKE 'T76%' OR d.CD_CODI_DIAG_RLAD LIKE 'Y0[5-7]%'
    OR d.CD_CODI_DIAG_RLAD LIKE 'Z044%' OR d.CD_CODI_DIAG_RLAD LIKE 'Z045%' OR d.CD_CODI_DIAG_RLAD LIKE 'O04%'
    OR d.CD_CODI_DIAG_RLAD LIKE 'A5[0-9]%' OR d.CD_CODI_DIAG_RLAD LIKE 'A6[0-4]%';

SELECT s.alcance, s.pacientes, s.menores,
       s.con_celular, CAST(100.0 * s.con_celular / NULLIF(s.pacientes, 0) AS decimal(5, 1)) AS pct_con_celular,
       s.con_correo_propio, CAST(100.0 * s.con_correo_propio / NULLIF(s.pacientes, 0) AS decimal(5, 1)) AS pct_con_correo_propio,
       s.con_correo_de_relleno,
       k.consultas, k.con_dx_sensible, CAST(100.0 * k.con_dx_sensible / NULLIF(k.consultas, 0) AS decimal(5, 1)) AS pct_dx_sensible
  FROM (SELECT a.alcance, COUNT(*) AS pacientes, SUM(pc.menor) AS menores, SUM(pc.con_celular) AS con_celular,
               SUM(pc.con_correo) AS con_correo_propio, SUM(pc.correo_relleno) AS con_correo_de_relleno
          FROM (SELECT DISTINCT a.alcance, c.pac FROM #alc a JOIN #c c ON c.id = a.id) a
          JOIN #pc pc ON pc.pac = a.pac
         GROUP BY a.alcance) s
  JOIN (SELECT a.alcance, COUNT(*) AS consultas, COUNT(z.id) AS con_dx_sensible
          FROM #alc a LEFT JOIN #sens z ON z.id = a.id
         GROUP BY a.alcance) k ON k.alcance = s.alcance
 ORDER BY s.alcance;
GO

-- =============================================================================
-- M-6 · Consultas por día de la semana y en festivos (toda la ventana)
-- =============================================================================
IF OBJECT_ID('tempdb..#c') IS NULL BEGIN RAISERROR(N'Corre primero M-0 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#td') IS NOT NULL DROP TABLE #td;
SELECT dia,
       CASE WHEN festivo = 1 THEN N'8 festivo'
            ELSE CHOOSE(dow, N'1 lunes', N'2 martes', N'3 miércoles', N'4 jueves', N'5 viernes', N'6 sábado', N'7 domingo') END AS tipo
  INTO #td
  FROM #dias;

SELECT a.alcance, t.tipo AS dia,
       COUNT(*)                                                         AS consultas,
       COUNT(DISTINCT c.dia)                                            AS dias_con_consulta,
       n.dias                                                           AS dias_en_la_ventana,
       CAST(1.0 * COUNT(*) / NULLIF(COUNT(DISTINCT c.dia), 0) AS decimal(9, 1)) AS consultas_por_dia_con_consulta
  FROM #alc a
  JOIN #c c   ON c.id = a.id
  JOIN #td t  ON t.dia = c.dia
  JOIN (SELECT tipo, COUNT(*) AS dias FROM #td GROUP BY tipo) n ON n.tipo = t.tipo
 GROUP BY a.alcance, t.tipo, n.dias
 ORDER BY a.alcance, t.tipo;
GO

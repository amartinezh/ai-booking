-- =============================================================================
-- PADRON_DESCUBRIMIENTO_2.sql
-- E.S.E. Hospital San Vicente de Paúl (Anserma, Caldas) — base ESEHSVP
--
-- SEGUNDA RONDA. La primera (PADRON_DESCUBRIMIENTO.sql, corrida el
-- 2026-09-10) ya cerró la pregunta grande: **el padrón no está en el HIS y
-- nadie valida derechos al agendar**. No hay tabla, ni SP, ni job, ni paquete
-- SSIS, ni servidor vinculado, ni reporte; y `R_PAC_EPS` crece 6,8 filas por
-- paciente nuevo, o sea al ritmo de la ventanilla y no de una carga masiva.
--
-- Este archivo NO vuelve a preguntar eso. Sirve a la decisión que sigue: el
-- padrón se carga en AgenIA y AgenIA filtra las solicitudes de cita por
-- WhatsApp usando **solo el documento** como llave. Para que eso funcione hay
-- que estar seguro de tres cosas, y ninguna está medida todavía:
--
--   1. Que `PACIENTES.NU_HIST_PAC` sea de verdad un documento utilizable como
--      llave de join (D.1). La ronda anterior mostró historias como `XX`,
--      `XXXXXX`, `Z4111186` y `YA0146983`: si eso es común, la llave falla.
--   2. Que la hipótesis de la «casilla» de `NU_AFIL_RPE` sea cierta o falsa
--      (D.2), porque de ella depende poder reconciliar la EPS actual — y hay
--      una tabla en la base que puede refutarla de un golpe.
--   3. Qué tan poblado y creíble está lo que el HIS ya sabe del paciente
--      (D.6, D.7), porque si el HIS alcanza, el padrón se reduce a una lista
--      de documentos y todos los problemas de calidad del CSV se evaporan.
--
-- Lo demás son pistas que quedaron abiertas y cuestan un minuto cada una.
--
-- ⚠️ TODO ES DE SOLO LECTURA, salvo la sección D.11, que está COMENTADA y
--    escribe únicamente en AGENIA_SYNC (nuestra propia base, creada el
--    2026-09-07). Ni una línea de este archivo modifica nada del HIS.
--
-- ⚠️ D.5 lee ESEHSVP2025 y D.10 lee ReportServer2019: el usuario `agenia_sync`
--    NO tiene acceso a esas bases. Correr con cuenta de administrador.
--
-- ORDEN DE LECTURA DE LOS RESULTADOS
--   [02]-[05]  D.1  ¿la cédula sirve como llave?     ← decide el diseño
--   [06]-[09]  D.2  casilla vs. tipo de afiliado     ← decide la reconciliación
--   [17]-[20]  D.6/D.7 ¿el HIS ya tiene el contacto? ← decide qué pedirle al CSV
--   el resto      pistas
-- =============================================================================

USE ESEHSVP;
GO

-- Misma razón que en el archivo anterior: producción, en horario de agenda, y
-- varias consultas recorren tablas completas (`R_PAC_EPS` 443.325 filas,
-- `PACIENTES` 78.791). Sin bloqueos compartidos no se frena a quien agenda.
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

-- ⭐ CÓMO SACAR TODO EN UN SOLO TEXTO
--   Ctrl+Shift+F  (menú Consulta → "Resultados en archivo"), luego F5: SSMS
--   pregunta dónde guardar y escribe un .rpt de texto plano, listo para
--   adjuntar. No hay panel que confundir.
--   Si se prefiere el panel: Ctrl+T, y ANTES de copiar hacer clic DENTRO del
--   panel de texto de abajo (si lo copiado empieza en `USE ESEHSVP;` se copió
--   el editor). Herramientas → Opciones → Resultados de consultas → SQL Server
--   → Resultados en texto → "Número máximo de caracteres por columna" = 8192.
--   Para volver a cuadrículas: Ctrl+D.
PRINT N'';
PRINT N'##############################################################';
PRINT N'#  PADRON_DESCUBRIMIENTO_2.sql — Hospital San Vicente de Paul #';
PRINT N'##############################################################';
PRINT N'';
GO

-- =============================================================================
-- D.0 — CONTEXTO
-- El servicio se reinició el 2026-09-09 01:43. Si sigue arriba desde entonces,
-- `sys.dm_db_index_usage_stats` acumula más historia que en la ronda anterior
-- (34 h) y vale la pena volver a mirar quién escribe.
-- =============================================================================

PRINT N'';
PRINT N'===== [01] D.0 · Contexto: version, base y uptime =====';
SELECT  SERVERPROPERTY('ProductVersion')  AS version,
        DB_NAME()                         AS bd_actual,
        i.sqlserver_start_time            AS servidor_arrancado,
        GETDATE()                         AS ahora,
        DATEDIFF(hour, i.sqlserver_start_time, GETDATE()) AS horas_arriba
FROM sys.dm_os_sys_info i;

GO

-- =============================================================================
-- D.1 — ⭐ ¿`NU_HIST_PAC` SIRVE COMO LLAVE? (la consulta que decide el diseño)
--
-- El diseño nuevo es: el padrón entra a AgenIA como lista de documentos, y al
-- agendar se cruza el documento que escribe el paciente por WhatsApp contra
-- (a) el padrón en AgenIA y (b) `PACIENTES` en el HIS, vía el agente espejo.
-- Todo el diseño se apoya en que `NU_HIST_PAC` sea el documento, limpio.
--
-- La ronda anterior sembró la duda: en `R_PAC_EPS` aparecieron historias
-- `Z4111186`, `YA0146983`, `XDF307989`, `XXXXXX` y `XX`. Si eso es marginal,
-- el diseño va. Si es masivo, hace falta una tabla de homologación y el
-- «solo la cédula» se cae.
--
-- Lo que decide: `solo_digitos` cerca de 78.791 ⇒ la llave sirve.
-- =============================================================================

PRINT N'';
PRINT N'===== [02] D.1a · Salud de NU_HIST_PAC: cuantas historias son un documento limpio =====';
SELECT  COUNT(*)                                                           AS pacientes,
        SUM(CASE WHEN p.NU_HIST_PAC NOT LIKE '%[^0-9]%' THEN 1 ELSE 0 END) AS solo_digitos,
        SUM(CASE WHEN p.NU_HIST_PAC LIKE '%[^0-9]%'     THEN 1 ELSE 0 END) AS con_letras_o_signos,
        SUM(CASE WHEN p.NU_HIST_PAC LIKE '0%'           THEN 1 ELSE 0 END) AS con_cero_a_la_izquierda,
        SUM(CASE WHEN p.NU_HIST_PAC <> LTRIM(RTRIM(p.NU_HIST_PAC))
                 THEN 1 ELSE 0 END)                                        AS con_espacios_alrededor,
        SUM(CASE WHEN p.NU_HIST_PAC IS NULL OR LTRIM(RTRIM(p.NU_HIST_PAC)) = ''
                 THEN 1 ELSE 0 END)                                        AS vacias
FROM dbo.PACIENTES p;

-- (D.1b) Longitud de la historia. Una cédula colombiana va de 6 a 10 dígitos y
-- el NUIP de menores llega a 10-11. Longitudes fuera de 6-11 son sospechosas.
PRINT N'';
PRINT N'===== [03] D.1b · Distribucion de longitudes de NU_HIST_PAC =====';
SELECT  LEN(LTRIM(RTRIM(p.NU_HIST_PAC))) AS longitud,
        COUNT(*)                         AS pacientes,
        MIN(p.NU_HIST_PAC)               AS ejemplo_min,
        MAX(p.NU_HIST_PAC)               AS ejemplo_max
FROM dbo.PACIENTES p
GROUP BY LEN(LTRIM(RTRIM(p.NU_HIST_PAC)))
ORDER BY longitud;

-- (D.1c) Las historias que NO son solo dígitos, con su tipo de documento.
-- Si resultan ser todas `MS`/`AS` (menor/adulto sin identificar) el problema
-- se acota solo: esa gente no puede pedir cita por el bot de todas formas.
PRINT N'';
PRINT N'===== [04] D.1c · Las historias que no son solo digitos, por tipo de documento =====';
SELECT TOP 50
        p.NU_HIST_PAC     AS historia,
        p.NU_TIPD_PAC     AS cod_tipo_doc,
        td.TX_NOMB_TDOC   AS sigla,
        p.NU_ESTA_PAC     AS estado,
        p.FE_HIST_PAC     AS apertura
FROM dbo.PACIENTES p
LEFT JOIN dbo.TIPO_DOCUMENTO td ON td.NU_CODIGO_TDOC = p.NU_TIPD_PAC
WHERE p.NU_HIST_PAC LIKE '%[^0-9]%'
ORDER BY p.FE_HIST_PAC DESC;

-- (D.1d) El radio de daño real: ¿esas historias raras piden citas?
-- Si no aparecen en 12 meses de agenda, son historias muertas y el diseño no
-- se entera de que existen.
PRINT N'';
PRINT N'===== [05] D.1d · Radio de dano: citas de 12 meses con historia no numerica =====';
SELECT  COUNT(*)                                                                AS citas_12m,
        SUM(CASE WHEN c.NU_HIST_PAC_CIT LIKE '%[^0-9]%' THEN 1 ELSE 0 END)      AS con_historia_rara,
        COUNT(DISTINCT CASE WHEN c.NU_HIST_PAC_CIT LIKE '%[^0-9]%'
                            THEN c.NU_HIST_PAC_CIT END)                         AS pacientes_distintos_raros,
        CAST(100.0 * SUM(CASE WHEN c.NU_HIST_PAC_CIT LIKE '%[^0-9]%' THEN 1 ELSE 0 END)
             / NULLIF(COUNT(*),0) AS decimal(5,2))                              AS pct
FROM dbo.CITAS_MEDICAS c
WHERE c.FE_FECH_CIT >= DATEADD(month, -12, CAST(GETDATE() AS date));

GO

-- =============================================================================
-- D.2 — ⭐ LA CASILLA: ¿`NU_AFIL_RPE` ES ORDEN DE LLEGADA O TIPO DE AFILIADO?
--
-- Hallazgo de la ronda anterior (P.4c): agrupando por
-- (NU_AFIL_RPE, NU_ESTA_RPE, TX_ACTI_RPE) salen 1,00-1,01 filas por paciente,
-- y las casillas 4/5/6 están reservadas a las tres filas sintéticas que recibe
-- todo paciente (Particulares, FOSYGA, Municipio de Anserma). En los 6
-- pacientes con varias EPS, el orden salió cronológico:
--     casilla 0 → CAFESALUD (hasta 2017)
--     casilla 1 → MEDIMÁS   (2017-2022)
--     casilla 2 → SALUD TOTAL (hoy)
--
-- Si eso es cierto a escala, hay forma de derivar «EPS actual» sin columna de
-- fecha: la casilla más alta con aseguradora real. Serviría para RECONCILIAR
-- (nunca para autorizar: para eso está el padrón).
--
-- D.2c es el CONTROL que puede refutarlo todo: si existe un catálogo de tipo
-- de afiliado con códigos 0-6 (`CUOTA_TIPOAFIL`, `LIQU_TIPOAFIL_*`), entonces
-- `NU_AFIL_RPE` es tipo de afiliado, la teoría de la casilla es falsa, y mejor
-- saberlo antes de construir algo encima.
--
-- El test no necesita el padrón: usa EPS que ya no existen. CAFESALUD fue
-- absorbida por Medimás en 2017; Medimás se liquidó en 2022; CAPRECOM y
-- SALUDCOOP en 2015. Si el orden es cronológico, las muertas deben ocupar
-- casillas BAJAS y las vivas casillas ALTAS.
-- =============================================================================

PRINT N'';
PRINT N'===== [06] D.2a · Casilla promedio de las EPS muertas contra las vivas =====';
SELECT  CASE WHEN r.CD_NIT_EPS_RPE IN ('800140949','901097473','899999026','800250119',
                                       '830074184','830009783','804001273','830006404',
                                       '804002105','817000248','805000427','830096513')
             THEN '1-EPS LIQUIDADA'
             WHEN r.CD_NIT_EPS_RPE IN ('800088702','800130907','900156264','900935126',
                                       '800251440','900226715','830003564','805001157',
                                       '901021565','900298372','837000084','817001773',
                                       '809008362','814000337')
             THEN '2-EPS VIGENTE'
             ELSE '3-otro (sintetica, ARL, aseguradora)' END                AS clase,
        COUNT(*)                                                            AS filas,
        COUNT(DISTINCT r.NU_HIST_PAC_RPE)                                   AS pacientes,
        CAST(AVG(TRY_CAST(r.NU_AFIL_RPE AS float)) AS decimal(4,2))         AS casilla_promedio,
        MIN(TRY_CAST(r.NU_AFIL_RPE AS int))                                 AS casilla_min,
        MAX(TRY_CAST(r.NU_AFIL_RPE AS int))                                 AS casilla_max
FROM dbo.R_PAC_EPS r
WHERE r.NU_ESTA_RPE = 1 AND r.TX_ACTI_RPE = 'S'
GROUP BY CASE WHEN r.CD_NIT_EPS_RPE IN ('800140949','901097473','899999026','800250119',
                                        '830074184','830009783','804001273','830006404',
                                        '804002105','817000248','805000427','830096513')
              THEN '1-EPS LIQUIDADA'
              WHEN r.CD_NIT_EPS_RPE IN ('800088702','800130907','900156264','900935126',
                                        '800251440','900226715','830003564','805001157',
                                        '901021565','900298372','837000084','817001773',
                                        '809008362','814000337')
              THEN '2-EPS VIGENTE'
              ELSE '3-otro (sintetica, ARL, aseguradora)' END
ORDER BY clase;

-- (D.2b) LA PRUEBA. Solo pacientes que tienen A LA VEZ una EPS liquidada y una
-- vigente. ¿En qué proporción la vigente está en casilla más alta?
-- Si pct_viva_mas_alta > 80% sobre miles de pacientes, la hipótesis se sostiene.
-- Si ronda el 50%, es azar y la casilla no dice nada.
PRINT N'';
PRINT N'===== [07] D.2b · LA PRUEBA: en pacientes con EPS muerta y viva, quien ocupa la casilla alta =====';
;WITH clasificada AS (
    SELECT  r.NU_HIST_PAC_RPE                  AS doc,
            TRY_CAST(r.NU_AFIL_RPE AS int)     AS casilla,
            CASE WHEN r.CD_NIT_EPS_RPE IN ('800140949','901097473','899999026','800250119',
                                           '830074184','830009783','804001273','830006404',
                                           '804002105','817000248','805000427','830096513')
                 THEN 'muerta'
                 WHEN r.CD_NIT_EPS_RPE IN ('800088702','800130907','900156264','900935126',
                                           '800251440','900226715','830003564','805001157',
                                           '901021565','900298372','837000084','817001773',
                                           '809008362','814000337')
                 THEN 'viva' END               AS vida
    FROM dbo.R_PAC_EPS r
    WHERE r.NU_ESTA_RPE = 1 AND r.TX_ACTI_RPE = 'S'
), por_paciente AS (
    SELECT  doc,
            MAX(CASE WHEN vida = 'muerta' THEN casilla END) AS casilla_muerta,
            MAX(CASE WHEN vida = 'viva'   THEN casilla END) AS casilla_viva
    FROM clasificada
    WHERE vida IS NOT NULL AND casilla IS NOT NULL
    GROUP BY doc
)
SELECT  COUNT(*)                                                              AS pacientes_con_ambas,
        SUM(CASE WHEN casilla_viva > casilla_muerta THEN 1 ELSE 0 END)        AS viva_en_casilla_mas_alta,
        SUM(CASE WHEN casilla_viva = casilla_muerta THEN 1 ELSE 0 END)        AS empatadas,
        SUM(CASE WHEN casilla_viva < casilla_muerta THEN 1 ELSE 0 END)        AS muerta_en_casilla_mas_alta,
        CAST(100.0 * SUM(CASE WHEN casilla_viva > casilla_muerta THEN 1 ELSE 0 END)
             / NULLIF(COUNT(*),0) AS decimal(5,1))                            AS pct_viva_mas_alta
FROM por_paciente
WHERE casilla_muerta IS NOT NULL AND casilla_viva IS NOT NULL;

-- (D.2c) EL CONTROL. ¿Existe un catálogo de «tipo de afiliado» con códigos
-- 0-6? Si sí, `NU_AFIL_RPE` es eso y la teoría de la casilla se cae.
PRINT N'';
PRINT N'===== [08] D.2c · CONTROL: hay catalogo de tipo de afiliado con codigos 0-6 =====';
SELECT  s.name AS esquema, t.name AS tabla,
        (SELECT SUM(p.rows) FROM sys.partitions p
          WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas,
        STUFF((SELECT ' | ' + c.name FROM sys.columns c
                WHERE c.object_id = t.object_id
                ORDER BY c.column_id FOR XML PATH('')), 1, 3, '')  AS columnas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.name LIKE '%TIPOAFIL%' OR t.name LIKE '%TIPO[_]AFIL%'
   OR t.name LIKE '%AFILIA%'   OR t.name LIKE '%PARENTES%'
ORDER BY filas DESC;

-- (D.2d) Y el cruce que remata: para cada casilla, ¿qué EPS aparecen?
-- Si la casilla 0 se llena de EPS liquidadas y la 2-3 de vigentes, se ve a ojo.
PRINT N'';
PRINT N'===== [09] D.2d · Que EPS ocupa cada casilla (top por casilla) =====';
;WITH conteo AS (
    SELECT  TRY_CAST(r.NU_AFIL_RPE AS int) AS casilla,
            r.CD_NIT_EPS_RPE               AS nit,
            COUNT(DISTINCT r.NU_HIST_PAC_RPE) AS pacientes
    FROM dbo.R_PAC_EPS r
    WHERE r.NU_ESTA_RPE = 1 AND r.TX_ACTI_RPE = 'S'
      AND r.CD_NIT_EPS_RPE NOT IN ('000000000','000000001','890801139') -- las sintéticas
    GROUP BY TRY_CAST(r.NU_AFIL_RPE AS int), r.CD_NIT_EPS_RPE
)
SELECT  c.casilla, c.nit, e.NO_NOMB_EPS AS eps, c.pacientes
FROM conteo c
LEFT JOIN dbo.EPS e ON e.CD_NIT_EPS = c.nit
WHERE c.pacientes >= 500
ORDER BY c.casilla, c.pacientes DESC;

GO

-- =============================================================================
-- D.3 — DECODIFICAR EL RÉGIMEN
-- En P.2b aparecieron los códigos 01, 02, 04, 07, 10, 13, P y F. El convenio
-- que hay que facturar depende del régimen (`mapping.json` se indexa por
-- NIT|RÉGIMEN), así que hay que saber qué es 01 y qué es 07 — dos pacientes de
-- Sura del mismo corte salieron uno con 01 y otro con 07.
-- =============================================================================

PRINT N'';
PRINT N'===== [10] D.3a · Catalogos de regimen que existen en la base =====';
SELECT  s.name AS esquema, t.name AS tabla,
        (SELECT SUM(p.rows) FROM sys.partitions p
          WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas,
        STUFF((SELECT ' | ' + c.name FROM sys.columns c
                WHERE c.object_id = t.object_id
                ORDER BY c.column_id FOR XML PATH('')), 1, 3, '')  AS columnas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.name LIKE '%REGIM%' OR t.name = 'R_REG_EPS' OR t.name LIKE '%REG[_]EPS%'
ORDER BY filas DESC;

-- (D.3b) `R_REG_EPS` completa: 273 filas, cabe entera.
-- Va con `SELECT *` a propósito: no conozco los nombres de sus columnas, y un
-- nombre de columna inválido es error 207 —de COMPILACIÓN—, así que abortaría
-- el lote entero y se llevaría también a [10], que es justo la consulta que
-- me diría cómo se llaman. Con `*` no hay nada que adivinar.
PRINT N'';
PRINT N'===== [11] D.3b · R_REG_EPS completa =====';
SELECT * FROM dbo.R_REG_EPS ORDER BY 1, 2;

GO

-- =============================================================================
-- D.4 — `STG_DEMANDA_PYP`: LA PISTA MÁS PROMETEDORA
-- 85.293 filas, creada el 2026-07-24, prefijo `STG` de *staging*, y un tamaño
-- del orden de la población. Es el objeto con más forma de padrón de toda la
-- base, y los barridos de la ronda anterior no lo vieron porque su nombre no
-- lleva el vocabulario de afiliación.
-- =============================================================================

PRINT N'';
PRINT N'===== [12] D.4a · Estructura de STG_DEMANDA_PYP =====';
SELECT  c.column_id AS orden, c.name AS columna, ty.name AS tipo,
        c.max_length, c.is_nullable
FROM sys.columns c
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.STG_DEMANDA_PYP')
ORDER BY c.column_id;

PRINT N'';
PRINT N'===== [13] D.4b · Volumen y frescura de STG_DEMANDA_PYP =====';
SELECT  COUNT(*) AS filas FROM dbo.STG_DEMANDA_PYP;

PRINT N'';
PRINT N'===== [14] D.4c · Muestra de 5 filas de STG_DEMANDA_PYP =====';
SELECT TOP 5 * FROM dbo.STG_DEMANDA_PYP;

GO

-- =============================================================================
-- D.5 — EL `ALTER` DEL 13-AGO-2026 07:38
-- Ese día, a las 07:38:22, `PACIENTES` aparece con create_date nuevo (o sea:
-- SQL Server la RECREÓ, lo que hace con ciertos ALTER), y a las 07:38:24-25 se
-- alteraron `GRUPOPOBLA_PAC` y `R_PAC_EPS`. Fue tres días después del corte de
-- Salud Total. Casi seguro es una migración del proveedor, pero **el agente
-- espejo escribe en PACIENTES** y hay que saber qué cambió.
--
-- El diff se hace contra ESEHSVP2025, que es la foto anterior.
-- =============================================================================

PRINT N'';
PRINT N'===== [15] D.5a · Columnas que la PACIENTES viva tiene y la de 2025 no (y al reves) =====';
;WITH viva AS (
    SELECT c.name, ty.name AS tipo, c.max_length
    FROM ESEHSVP.sys.columns c
    JOIN ESEHSVP.sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('ESEHSVP.dbo.PACIENTES')
), vieja AS (
    SELECT c.name, ty.name AS tipo, c.max_length
    FROM ESEHSVP2025.sys.columns c
    JOIN ESEHSVP2025.sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('ESEHSVP2025.dbo.PACIENTES')
)
SELECT  COALESCE(v.name, o.name) AS columna,
        CASE WHEN o.name IS NULL THEN '>>> NUEVA en la viva'
             WHEN v.name IS NULL THEN '>>> DESAPARECIO de la viva'
             WHEN v.tipo <> o.tipo OR v.max_length <> o.max_length
                  THEN '>>> CAMBIO DE TIPO'
             ELSE 'igual' END    AS diferencia,
        v.tipo AS tipo_viva, v.max_length AS largo_viva,
        o.tipo AS tipo_2025,     o.max_length AS largo_2025
FROM viva v
FULL OUTER JOIN vieja o ON o.name = v.name
WHERE o.name IS NULL OR v.name IS NULL
   OR v.tipo <> o.tipo OR v.max_length <> o.max_length
ORDER BY columna;

PRINT N'';
PRINT N'===== [16] D.5b · Lo mismo para R_PAC_EPS =====';
;WITH viva AS (
    SELECT c.name, ty.name AS tipo, c.max_length
    FROM ESEHSVP.sys.columns c
    JOIN ESEHSVP.sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('ESEHSVP.dbo.R_PAC_EPS')
), vieja AS (
    SELECT c.name, ty.name AS tipo, c.max_length
    FROM ESEHSVP2025.sys.columns c
    JOIN ESEHSVP2025.sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('ESEHSVP2025.dbo.R_PAC_EPS')
)
SELECT  COALESCE(v.name, o.name) AS columna,
        CASE WHEN o.name IS NULL THEN '>>> NUEVA en la viva'
             WHEN v.name IS NULL THEN '>>> DESAPARECIO de la viva'
             ELSE '>>> CAMBIO DE TIPO' END AS diferencia,
        v.tipo AS tipo_viva, o.tipo AS tipo_2025
FROM viva v
FULL OUTER JOIN vieja o ON o.name = v.name
WHERE o.name IS NULL OR v.name IS NULL
   OR v.tipo <> o.tipo OR v.max_length <> o.max_length
ORDER BY columna;

GO

-- =============================================================================
-- D.6 — ⭐ ¿`DE_EMAIL_PAC` ESTÁ LLENO DE RELLENO?
-- La ronda anterior midió 78.738 de 78.791 pacientes «con correo»: 99,9%. En
-- un hospital rural de Caldas eso no es creíble, y tiene la misma forma que la
-- columna `Telefono` del padrón de Salud Total, llena de `2000000` en el 87%
-- de las filas. Si es relleno, el correo del padrón sí aporta; si es real, el
-- padrón no tiene nada que aportar ahí y el CSV se simplifica una columna más.
-- =============================================================================

PRINT N'';
PRINT N'===== [17] D.6a · Los 20 correos mas repetidos del HIS =====';
SELECT TOP 20
        LOWER(LTRIM(RTRIM(p.DE_EMAIL_PAC))) AS correo,
        COUNT(*)                            AS pacientes
FROM dbo.PACIENTES p
WHERE p.DE_EMAIL_PAC IS NOT NULL AND LTRIM(RTRIM(p.DE_EMAIL_PAC)) <> ''
GROUP BY LOWER(LTRIM(RTRIM(p.DE_EMAIL_PAC)))
ORDER BY pacientes DESC;

PRINT N'';
PRINT N'===== [18] D.6b · Cuantos correos distintos y cuantos con forma valida =====';
SELECT  COUNT(*)                                                     AS con_algo,
        COUNT(DISTINCT LOWER(LTRIM(RTRIM(p.DE_EMAIL_PAC))))          AS distintos,
        SUM(CASE WHEN p.DE_EMAIL_PAC LIKE '%_@_%.__%'
                  AND p.DE_EMAIL_PAC NOT LIKE '% %'
                 THEN 1 ELSE 0 END)                                  AS con_forma_de_correo
FROM dbo.PACIENTES p
WHERE p.DE_EMAIL_PAC IS NOT NULL AND LTRIM(RTRIM(p.DE_EMAIL_PAC)) <> '';

GO

-- =============================================================================
-- D.7 — ⭐ ¿EL TELÉFONO DEL HIS SIRVE?
-- 78.788 con dato pero solo 58.761 con móvil válido (74,6%). En la muestra de
-- 15 personas el HIS tenía móvil para 15 de 15 —incluidas las 8 de Sura donde
-- el padrón no trae ninguno—, y donde ambos tenían dato discreparon en 3 de 5.
-- Hay que ver si los 20.027 «con dato pero sin móvil» son fijos legítimos o
-- relleno, porque de eso depende la regla de precedencia padrón/HIS.
--
-- Nota: para el bot esto importa menos de lo que parece —el número de WhatsApp
-- desde el que escribe el paciente ES el canal—, pero sí importa para
-- recordatorios salientes a quien nunca escribió.
-- =============================================================================

PRINT N'';
PRINT N'===== [19] D.7a · Los 20 telefonos mas repetidos del HIS =====';
SELECT TOP 20
        LTRIM(RTRIM(p.DE_TELE_PAC)) AS telefono,
        LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) AS largo,
        COUNT(*)                    AS pacientes
FROM dbo.PACIENTES p
WHERE p.DE_TELE_PAC IS NOT NULL AND LTRIM(RTRIM(p.DE_TELE_PAC)) <> ''
GROUP BY LTRIM(RTRIM(p.DE_TELE_PAC)), LEN(LTRIM(RTRIM(p.DE_TELE_PAC)))
ORDER BY pacientes DESC;

PRINT N'';
PRINT N'===== [20] D.7b · Forma del telefono: movil, fijo, o basura =====';
SELECT  CASE WHEN t.tel LIKE '3%' AND LEN(t.tel) = 10 AND t.tel NOT LIKE '%[^0-9]%'
                  THEN '1-movil valido (3XXXXXXXXX)'
             WHEN LEN(t.tel) IN (7,8) AND t.tel NOT LIKE '%[^0-9]%'
                  THEN '2-fijo de 7-8 digitos'
             WHEN t.tel LIKE '60%' AND LEN(t.tel) = 10 AND t.tel NOT LIKE '%[^0-9]%'
                  THEN '3-fijo nuevo formato (60X…)'
             WHEN t.tel LIKE '%[^0-9]%'
                  THEN '4-tiene caracteres no numericos'
             ELSE '5-otro largo' END           AS forma,
        COUNT(*)                               AS pacientes,
        MIN(t.tel)                             AS ejemplo
FROM (SELECT LTRIM(RTRIM(DE_TELE_PAC)) AS tel FROM dbo.PACIENTES
      WHERE DE_TELE_PAC IS NOT NULL AND LTRIM(RTRIM(DE_TELE_PAC)) <> '') t
GROUP BY CASE WHEN t.tel LIKE '3%' AND LEN(t.tel) = 10 AND t.tel NOT LIKE '%[^0-9]%'
                   THEN '1-movil valido (3XXXXXXXXX)'
              WHEN LEN(t.tel) IN (7,8) AND t.tel NOT LIKE '%[^0-9]%'
                   THEN '2-fijo de 7-8 digitos'
              WHEN t.tel LIKE '60%' AND LEN(t.tel) = 10 AND t.tel NOT LIKE '%[^0-9]%'
                   THEN '3-fijo nuevo formato (60X…)'
              WHEN t.tel LIKE '%[^0-9]%'
                   THEN '4-tiene caracteres no numericos'
              ELSE '5-otro largo' END
ORDER BY forma;

GO

-- =============================================================================
-- D.8 — EL MÓDULO API/WEB QUE APARECIÓ EL 1-JUL-2026
-- `API_LOGS` (176.280 filas), `WB_CON`, `WB_LIC`, `AUDITORIA_TFP`,
-- `AUDITORIA_FC`, `PERMIUSUA_SGIO`, `LOG_AUDITORIA_SGIO`: el proveedor del HIS
-- montó algo con API hace dos meses. Si expone afiliación o agenda, cambia el
-- diseño entero del espejo — sería una interfaz soportada en vez de escribir
-- tablas directamente.
--
-- Se pide SOLO la estructura, no el contenido: un log de API puede traer
-- payloads con datos de paciente y no hay razón para sacarlos de ahí.
-- =============================================================================

PRINT N'';
PRINT N'===== [21] D.8a · Estructura de API_LOGS, WB_CON y WB_LIC =====';
SELECT  t.name AS tabla, c.column_id AS orden, c.name AS columna,
        ty.name AS tipo, c.max_length
FROM sys.columns c
JOIN sys.tables t  ON t.object_id = c.object_id
JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
WHERE t.name IN ('API_LOGS','WB_CON','WB_LIC','PERMIUSUA_SGIO','LOG_AUDITORIA_SGIO')
ORDER BY t.name, c.column_id;

PRINT N'';
PRINT N'===== [22] D.8b · Volumen de esas tablas =====';
SELECT  s.name AS esquema, t.name AS tabla,
        SUM(p.rows) AS filas, t.create_date AS creada, t.modify_date AS alterada
FROM sys.tables t
JOIN sys.schemas s    ON s.schema_id = t.schema_id
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE t.name IN ('API_LOGS','WB_CON','WB_LIC','PERMIUSUA_SGIO','LOG_AUDITORIA_SGIO',
                 'AUDITORIA_TFP','AUDITORIA_FC','PLANO','REIN1','cale1')
GROUP BY s.name, t.name, t.create_date, t.modify_date
ORDER BY filas DESC;

GO

-- =============================================================================
-- D.9 — `PLANO`: 1.410 filas, creada el 15-AGO-2026
-- «Plano» es como se le dice en Colombia a un archivo plano. Creada cuatro
-- días antes del corte de Sura y dos después del ALTER de PACIENTES. Puede ser
-- cualquier cosa (un plano de RIPS, de nómina), pero el nombre y la fecha
-- piden mirarla.
-- =============================================================================

PRINT N'';
PRINT N'===== [23] D.9a · Estructura de PLANO =====';
SELECT  c.column_id AS orden, c.name AS columna, ty.name AS tipo, c.max_length
FROM sys.columns c
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.PLANO')
ORDER BY c.column_id;

PRINT N'';
PRINT N'===== [24] D.9b · Muestra de 5 filas de PLANO =====';
SELECT TOP 5 * FROM dbo.PLANO;

GO

-- =============================================================================
-- D.10 — EL SQL DE `CENSO NUEVA EPS`
-- De los 140 reportes de SSRS, es el único que hace un censo POR EPS. Su
-- definición (.rdl) lleva dentro el SQL exacto: si alguien en el hospital saca
-- un listado de afiliados de una EPS, ahí está de dónde lo saca.
-- Necesita permisos sobre ReportServer2019.
-- =============================================================================

PRINT N'';
PRINT N'===== [25] D.10 · El SQL que lleva dentro CENSO NUEVA EPS =====';
;WITH rdl AS (
    SELECT  c.Path, c.Name,
            CONVERT(varchar(max), CONVERT(varbinary(max), c.Content)) AS texto
    FROM ReportServer2019.dbo.Catalog c
    WHERE c.Type IN (2,4) AND c.Content IS NOT NULL
      AND (c.Name LIKE '%CENSO%' OR c.Name LIKE '%CONSULTAS CON EPS%'
           OR c.Name LIKE '%REGIMEN%')
)
SELECT  r.Path, r.Name,
        CHARINDEX('<CommandText>', r.texto) AS pos,
        SUBSTRING(r.texto,
                  CHARINDEX('<CommandText>', r.texto),
                  4000)                     AS primer_command_text
FROM rdl r
WHERE CHARINDEX('<CommandText>', r.texto) > 0
ORDER BY r.Name;

GO

-- =============================================================================
-- D.11 — OPCIONAL: MEDIR EL CRUCE REAL PADRÓN ↔ HIS
--
-- Ésta es la única pregunta que NO se puede contestar sin el archivo, y es la
-- que decide si el bot puede dejar de registrar pacientes:
--
--     ¿cuántas personas del padrón NO existen en `PACIENTES`?
--
-- Si son pocas, el diseño «el que no está registrado en el HIS habla con el
-- hospital» funciona y AgenIA nunca crea pacientes. Si son muchas, ese camino
-- manda a demasiada gente al teléfono y hay que reconsiderarlo.
--
-- En la muestra de 15 personas, 15 existían. Pero era una muestra de 15 sobre
-- ~19.500 filas de padrón: no alcanza para decidir.
--
-- ⚠️ ESTA SECCIÓN ESCRIBE. Sólo en `AGENIA_SYNC` —nuestra propia base, creada
--    el 2026-09-07 para este proyecto—, nunca en `ESEHSVP`. Está comentada:
--    descomentar a conciencia.
--
-- CÓMO CARGAR EL ARCHIVO (sin BULK INSERT, que exigiría dejar el CSV en una
-- ruta del servidor Linux):
--   1. Correr el CREATE TABLE de abajo.
--   2. En SSMS: clic derecho sobre la base AGENIA_SYNC → Tareas → Importar
--      datos planos ("Import Flat File"), escoger el CSV, y como tabla destino
--      `dbo.STG_PADRON`. Delimitador `;`.
--   3. Repetir con el segundo CSV (la columna `eps` se llena a mano en el
--      paso 4, porque ninguno de los dos archivos la trae).
--   4. UPDATE dbo.STG_PADRON SET eps = 'Salud Total' WHERE eps IS NULL; (etc.)
--   5. Correr las tres consultas del final.
/*
USE AGENIA_SYNC;
GO

IF OBJECT_ID('dbo.STG_PADRON') IS NOT NULL DROP TABLE dbo.STG_PADRON;
CREATE TABLE dbo.STG_PADRON (
    documento varchar(20) NOT NULL,
    eps       varchar(40) NULL,
    regimen   varchar(40) NULL
);
CREATE INDEX IX_STG_PADRON_doc ON dbo.STG_PADRON (documento);
GO

-- (D.11a) ¿Cuántos del padrón existen en el HIS?
SELECT  s.eps,
        COUNT(*)                                                        AS filas_padron,
        COUNT(DISTINCT s.documento)                                     AS documentos_distintos,
        SUM(CASE WHEN p.NU_HIST_PAC IS NULL THEN 0 ELSE 1 END)          AS existen_en_el_HIS,
        SUM(CASE WHEN p.NU_HIST_PAC IS NULL THEN 1 ELSE 0 END)          AS NO_existen,
        CAST(100.0 * SUM(CASE WHEN p.NU_HIST_PAC IS NULL THEN 1 ELSE 0 END)
             / NULLIF(COUNT(*),0) AS decimal(5,2))                      AS pct_desconocidos
FROM dbo.STG_PADRON s
LEFT JOIN ESEHSVP.dbo.PACIENTES p ON p.NU_HIST_PAC = s.documento
GROUP BY s.eps;

-- (D.11b) De los que existen: ¿el HIS les tiene un móvil usable?
SELECT  s.eps,
        COUNT(*)                                                        AS en_ambos,
        SUM(CASE WHEN p.DE_TELE_PAC LIKE '3%'
                  AND LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
                 THEN 1 ELSE 0 END)                                     AS con_movil_en_el_HIS
FROM dbo.STG_PADRON s
JOIN ESEHSVP.dbo.PACIENTES p ON p.NU_HIST_PAC = s.documento
GROUP BY s.eps;

-- (D.11c) ¿Y la EPS del padrón coincide con alguna fila de R_PAC_EPS?
-- Mide qué tan lejos está el HIS de la verdad del padrón.
SELECT  s.eps,
        COUNT(DISTINCT s.documento)                                     AS documentos,
        COUNT(DISTINCT CASE WHEN r.NU_HIST_PAC_RPE IS NOT NULL
                            THEN s.documento END)                       AS con_esa_eps_en_R_PAC_EPS
FROM dbo.STG_PADRON s
LEFT JOIN ESEHSVP.dbo.R_PAC_EPS r
       ON r.NU_HIST_PAC_RPE = s.documento
      AND r.CD_NIT_EPS_RPE  = CASE s.eps WHEN 'Sura'        THEN '800088702'
                                         WHEN 'Salud Total' THEN '800130907' END
GROUP BY s.eps;

DROP TABLE dbo.STG_PADRON;
GO
*/

PRINT N'';
PRINT N'===== [26] D.11 · Seccion opcional (comentada): cruce padron contra HIS =====';
PRINT N'   Requiere cargar los CSV a AGENIA_SYNC.dbo.STG_PADRON. Ver comentarios.';
GO

PRINT N'';
PRINT N'===== FIN DE LA CORRIDA 2 =====';
GO

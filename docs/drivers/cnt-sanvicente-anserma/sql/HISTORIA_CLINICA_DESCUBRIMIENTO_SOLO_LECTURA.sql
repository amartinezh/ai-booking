/* =============================================================================
   HISTORIA CLÍNICA → RESUMEN DE LA ATENCIÓN AL PACIENTE · RONDA 1
   ESTRICTAMENTE SOLO LECTURA · Base objetivo: ESEHSVP
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md (Fase 0).

   Qué se quiere saber: cuando un médico guarda la historia clínica en el HIS,
   ¿dónde quedan el diagnóstico, los medicamentos, los exámenes ordenados y el
   plan? ¿Cuándo se puede dar por terminada? ¿Cómo se une con la cita? ¿Qué
   contacto tiene el paciente? Hasta hoy solo sabemos que existe
   `HISTORIACLINICA` (columnas con sufijo `_HICL`, entre ellas
   `CD_MED_ASIG_HICL` y `CD_MED_REAL_HICL`) y que el proveedor tiene un
   procedimiento de interoperabilidad (`SP_INTEROPERABILIDAD_IHC_V2`, 80 KB,
   del 1-jul-2026) que arma el resumen de cada atención para la Resolución 866.

   QUÉ HACE Y QUÉ NO HACE
     · Solo SELECT. No hay INSERT, UPDATE, DELETE, ALTER, CREATE de objetos ni
       EXEC de procedimientos del hospital.
     · Los bloques HC-5 a HC-7 copian una MUESTRA a tablas temporales (#) de
       tempdb, que desaparecen solas al cerrar la ventana. No escriben en
       ESEHSVP.
     · No muestra nombres, documentos, teléfonos, correos ni texto clínico:
       solo nombres de tablas y columnas, conteos, largos y códigos. La única
       excepción es el bloque HC-9, que se corre en PRUEBAS y solo con un
       paciente de prueba.
     · Lectura sin bloqueos (READ UNCOMMITTED) y con un solo procesador
       (MAXDOP 1) en las consultas que recorren datos.

   CÓMO CORRERLO
     1. En SSMS, con un usuario administrador, en una ventana nueva.
     2. El bloque HC-0 va PRIMERO y en la misma ventana que los demás: deja en
        #hc las columnas confirmadas y hasta qué historia hay que leer hacia
        atrás para cubrir 90 días. Tarda segundos.
     3. Bloques HC-1 a HC-4: solo leen el catálogo del esquema; segundos.
     4. Bloques HC-5 a HC-7: leen solo las historias de la ventana, por su
        índice. Mejor después de las 19:00 o un domingo, por prudencia.
     5. Se puede correr todo de una vez (F5) desde HC-0 hasta HC-8. HC-9 se
        salta solo mientras no tenga el documento de prueba.
     6. Devuélveme cada cuadrícula de resultados (clic derecho → «Guardar
        resultados como…» CSV, o copiar con encabezados). Del bloque HC-4e,
        haz clic en la celda XML y guarda el texto que se abre como .sql.

   RONDA 1, CORRIDA 1 (2026-10-28): HC-0 confirmó las columnas (ver HC-0) y
   que HISTORIACLINICA no tiene especialidad ni servicio. Este archivo ya
   está ajustado a eso: desde HC-0 hasta HC-8 se corre completo.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- =============================================================================
-- HC-0 · Columnas confirmadas y frontera de lectura (OBLIGATORIO, PRIMERO)
--
-- ✅ Confirmado en ESEHSVP (primera corrida, 2026-10-28):
--      fecha de la historia ....... FE_FECH_HICL
--      paciente ................... NU_HIST_PAC_HICL
--      médico que atendió ......... CD_MED_REAL_HICL
--      médico de la agenda ........ CD_MED_ASIG_HICL
--      llave primaria, índice agrupado e identidad: NU_NUME_HICL
--   NO tiene columna de especialidad ni de servicio: se sacan de la cita del
--   mismo día y del cargo del médico (HC-6).
--
-- Como NU_NUME_HICL es identidad y es el índice agrupado, crece con el tiempo.
-- En vez de recorrer la tabla entera (que viene desde que existe el HIS) para
-- hallar «los últimos 90 días», el bloque camina hacia atrás por tramos de
-- 20.000 historias hasta encontrar un tramo entero anterior a la ventana. Los
-- bloques siguientes leen solo desde ahí (`id_desde_90d`): una fracción
-- pequeña de la tabla, leída por su índice. Tarda segundos.
-- =============================================================================
IF OBJECT_ID('tempdb..#hc') IS NOT NULL DROP TABLE #hc;
CREATE TABLE #hc (orden int NOT NULL, clave varchar(30) NOT NULL PRIMARY KEY, valor nvarchar(1000) NULL);

DECLARE @obj int = OBJECT_ID(N'dbo.HISTORIACLINICA');
IF @obj IS NULL
BEGIN
    RAISERROR(N'No existe dbo.HISTORIACLINICA en esta base. ¿La ventana está en ESEHSVP?', 16, 1);
    RETURN;
END;
IF (SELECT COUNT(*) FROM sys.columns
     WHERE object_id = @obj
       AND name IN (N'NU_NUME_HICL', N'FE_FECH_HICL', N'NU_HIST_PAC_HICL', N'CD_MED_REAL_HICL', N'CD_MED_ASIG_HICL')) <> 5
BEGIN
    RAISERROR(N'HISTORIACLINICA cambió: falta alguna de las columnas confirmadas. Avísame antes de seguir.', 16, 1);
    RETURN;
END;

DECLARE @dias int = 90, @paso bigint = 20000, @tope_tramos int = 100;
DECLARE @desde date = DATEADD(day, -@dias, CAST(GETDATE() AS date));
DECLARE @id_min bigint, @id_max bigint;
SELECT @id_min = MIN(NU_NUME_HICL), @id_max = MAX(NU_NUME_HICL) FROM dbo.HISTORIACLINICA;  -- dos búsquedas en el índice

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
IF @hi < @id_min SET @confiable = 1;  -- llegó al principio de la tabla: la ventana está completa
-- Si el tramo MÁS NUEVO ya está entero fuera de la ventana, o no hay historias
-- recientes o los números no crecen con el tiempo: no se puede confiar.
IF @tramos = 1 AND @en_ventana = 0 SET @confiable = 0;
DECLARE @id_desde bigint = CASE WHEN @lo < @id_min THEN @id_min ELSE @lo END;

DECLARE @filas_total bigint = (SELECT SUM(row_count) FROM sys.dm_db_partition_stats WHERE object_id = @obj AND index_id IN (0, 1));
DECLARE @en_90 int = (SELECT COUNT(*) FROM dbo.HISTORIACLINICA WITH (NOLOCK)
                       WHERE NU_NUME_HICL >= @id_desde AND FE_FECH_HICL >= @desde);
DECLARE @fecha_primera datetime = (SELECT FE_FECH_HICL FROM dbo.HISTORIACLINICA WITH (NOLOCK) WHERE NU_NUME_HICL = @id_min);
DECLARE @fecha_ultima  datetime = (SELECT FE_FECH_HICL FROM dbo.HISTORIACLINICA WITH (NOLOCK) WHERE NU_NUME_HICL = @id_max);

INSERT #hc (orden, clave, valor) VALUES
    (1,  'tabla',               N'HISTORIACLINICA'),
    (2,  'fecha',               N'FE_FECH_HICL'),
    (3,  'paciente',            N'NU_HIST_PAC_HICL'),
    (4,  'medico_real',         N'CD_MED_REAL_HICL'),
    (5,  'medico_asignado',     N'CD_MED_ASIG_HICL'),
    (6,  'llave',               N'NU_NUME_HICL'),
    (7,  'historias_en_total',  CONVERT(nvarchar(30), @filas_total)),
    (8,  'id_min',              CONVERT(nvarchar(30), @id_min)),
    (9,  'id_max',              CONVERT(nvarchar(30), @id_max)),
    (10, 'fecha_de_la_primera', CONVERT(nvarchar(30), @fecha_primera, 120)),
    (11, 'fecha_de_la_ultima',  CONVERT(nvarchar(30), @fecha_ultima, 120)),
    (12, 'id_desde_90d',        CONVERT(nvarchar(30), @id_desde)),
    (13, 'historias_90_dias',   CONVERT(nvarchar(30), @en_90)),
    (14, 'tramos_leidos',       CONVERT(nvarchar(30), @tramos)),
    (15, 'frontera_confiable',  CASE WHEN @confiable = 1 THEN N'SI' ELSE N'NO (avísame antes de seguir: la ventana puede estar incompleta)' END);

SELECT clave AS dato, ISNULL(valor, N'(vacío)') AS valor
  FROM #hc ORDER BY orden;
GO

-- =============================================================================
-- HC-1 · Inventario: tablas cuyo NOMBRE suena a historia clínica, fórmula,
--        órdenes, diagnósticos, incapacidades, remisiones o interoperabilidad
--
-- Solo catálogo. `ultima_escritura` y `escrituras` vienen de las estadísticas
-- de uso, que se reinician con el servicio: sirven para ver cuáles están vivas.
-- =============================================================================
;WITH tam AS (
    SELECT ps.object_id,
           SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.row_count ELSE 0 END) AS filas,
           SUM(ps.used_page_count) * 8                                        AS kb_usados
      FROM sys.dm_db_partition_stats ps
     GROUP BY ps.object_id
), uso AS (
    SELECT u.object_id,
           MAX(u.last_user_update) AS ultima_escritura,
           SUM(u.user_updates)     AS escrituras_desde_el_arranque
      FROM sys.dm_db_index_usage_stats u
     WHERE u.database_id = DB_ID()
     GROUP BY u.object_id
)
SELECT t.name                          AS tabla,
       tam.filas,
       tam.kb_usados,
       t.create_date                   AS creada,
       t.modify_date                   AS esquema_modificado,
       uso.ultima_escritura,
       uso.escrituras_desde_el_arranque
  FROM sys.tables t
  LEFT JOIN tam ON tam.object_id = t.object_id
  LEFT JOIN uso ON uso.object_id = t.object_id
 WHERE t.is_ms_shipped = 0
   AND t.name NOT LIKE N'CITAS%'
   AND (   t.name LIKE N'%HIST%'    OR t.name LIKE N'%HICL%'   OR t.name LIKE N'%HC[_]%'
        OR t.name LIKE N'%[_]HC%'   OR t.name LIKE N'%EVOL%'   OR t.name LIKE N'%FORMU%'
        OR t.name LIKE N'%RECET%'   OR t.name LIKE N'%PRESC%'  OR t.name LIKE N'%MEDICAM%'
        OR t.name LIKE N'%ORDEN%'   OR t.name LIKE N'%ORDM%'   OR t.name LIKE N'%LAB%'
        OR t.name LIKE N'%EXAM%'    OR t.name LIKE N'%DIAG%'   OR t.name LIKE N'%CIE%'
        OR t.name LIKE N'%DX%'      OR t.name LIKE N'%PROCED%' OR t.name LIKE N'%INCAP%'
        OR t.name LIKE N'%REMIS%'   OR t.name LIKE N'%INTERC%' OR t.name LIKE N'%EPICR%'
        OR t.name LIKE N'%NOTA%'    OR t.name LIKE N'%IMAGEN%' OR t.name LIKE N'%PARACL%'
        OR t.name LIKE N'%AYUD%'    OR t.name LIKE N'%SOLIC%'  OR t.name LIKE N'%RESULT%'
        OR t.name LIKE N'%ANTEC%'   OR t.name LIKE N'%SIGNO%'  OR t.name LIKE N'%TRIAG%'
        OR t.name LIKE N'%CONSUL%'  OR t.name LIKE N'%ATENC%'  OR t.name LIKE N'%ARTIC%'
        OR t.name LIKE N'%FOLIO%'   OR t.name LIKE N'%RECOM%'  OR t.name LIKE N'%CONDUC%'
        OR t.name LIKE N'%IHC%'     OR t.name LIKE N'%FHIR%'   OR t.name LIKE N'%INTEROP%'
        OR t.name LIKE N'%RDA%'     OR t.name LIKE N'%API%LOG%')
 ORDER BY tam.filas DESC, t.name;
GO

-- =============================================================================
-- HC-2 · Esquema completo de HISTORIACLINICA
--
-- (a) columnas — mismo formato que esquema-real.tsv, para agregarla allí;
-- (b) índices; (c) tamaño; (d) disparadores; (e) ¿hay Change Tracking o CDC?
-- =============================================================================
DECLARE @obj int = OBJECT_ID(N'dbo.HISTORIACLINICA');

-- (a)
SELECT N'HISTORIACLINICA'                                   AS tabla,
       c.name                                               AS columna,
       ty.name                                              AS tipo,
       CASE WHEN c.max_length = -1 THEN 'max'
            WHEN ty.name IN ('nvarchar', 'nchar') THEN CAST(c.max_length / 2 AS varchar(10))
            WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary') THEN CAST(c.max_length AS varchar(10))
            ELSE 'NULL' END                                 AS ancho,
       CASE WHEN c.is_nullable = 1 THEN 'SI' ELSE 'NO' END  AS acepta_nulos,
       CASE WHEN c.is_identity = 1 THEN 'SI' ELSE '' END    AS identidad,
       CASE WHEN c.is_computed = 1 THEN 'SI' ELSE '' END    AS calculada,
       OBJECT_DEFINITION(c.default_object_id)               AS valor_por_defecto
  FROM sys.columns c
  JOIN sys.types ty ON ty.user_type_id = c.user_type_id
 WHERE c.object_id = @obj
 ORDER BY c.column_id;

-- (b)
SELECT i.name AS indice, i.type_desc AS tipo, i.is_primary_key AS es_llave_primaria, i.is_unique AS es_unico,
       STRING_AGG(CAST(c.name AS nvarchar(max)) + CASE WHEN ic.is_descending_key = 1 THEN N' DESC' ELSE N'' END, N', ')
           WITHIN GROUP (ORDER BY ic.key_ordinal) AS columnas
  FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0
  JOIN sys.columns c        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
 WHERE i.object_id = @obj
 GROUP BY i.name, i.type_desc, i.is_primary_key, i.is_unique
 ORDER BY i.is_primary_key DESC, i.name;

-- (c)
SELECT SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.row_count ELSE 0 END)                    AS filas,
       SUM(ps.reserved_page_count) * 8                                                        AS kb_reservados,
       SUM(ps.used_page_count) * 8                                                            AS kb_usados,
       SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.in_row_used_page_count ELSE 0 END) * 8     AS kb_datos_en_fila,
       SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.lob_used_page_count + ps.row_overflow_used_page_count ELSE 0 END) * 8
                                                                                              AS kb_texto_largo,
       SUM(CASE WHEN ps.index_id > 1 THEN ps.used_page_count ELSE 0 END) * 8                  AS kb_indices
  FROM sys.dm_db_partition_stats ps
 WHERE ps.object_id = @obj;

-- (d)
SELECT t.name AS disparador, t.is_disabled AS desactivado,
       CASE WHEN OBJECTPROPERTY(t.object_id, 'ExecIsInsertTrigger') = 1 THEN 'I' ELSE '' END
     + CASE WHEN OBJECTPROPERTY(t.object_id, 'ExecIsUpdateTrigger') = 1 THEN 'U' ELSE '' END
     + CASE WHEN OBJECTPROPERTY(t.object_id, 'ExecIsDeleteTrigger') = 1 THEN 'D' ELSE '' END AS eventos,
       LEFT(m.definition, 3000) AS definicion_inicio
  FROM sys.triggers t
  LEFT JOIN sys.sql_modules m ON m.object_id = t.object_id
 WHERE t.parent_id = @obj;

-- (e)
SELECT d.name AS base,
       d.is_cdc_enabled AS cdc,
       CASE WHEN ctd.database_id IS NULL THEN 0 ELSE 1 END AS change_tracking_en_la_base,
       CASE WHEN ctt.object_id   IS NULL THEN 0 ELSE 1 END AS change_tracking_en_historiaclinica
  FROM sys.databases d
  LEFT JOIN sys.change_tracking_databases ctd ON ctd.database_id = d.database_id
  LEFT JOIN sys.change_tracking_tables ctt    ON ctt.object_id = @obj
 WHERE d.database_id = DB_ID();
GO

-- =============================================================================
-- HC-3 · ¿Qué tablas cuelgan de HISTORIACLINICA?
--
-- En este HIS la columna que apunta a otra tabla repite su nombre y le agrega
-- el sufijo propio: CITAS_ANULADAS guarda NU_HIST_PAC como NU_HIST_PAC_CIAN.
-- Una fórmula o una orden que apunte a la historia debería llamarse, p. ej.,
-- NU_NUME_HICL_XXXX. Se buscan esas, las que contengan _HICL_ en cualquier
-- parte y las llaves foráneas declaradas (probablemente ninguna).
-- =============================================================================
DECLARE @obj int = OBJECT_ID(N'dbo.HISTORIACLINICA');

IF OBJECT_ID('tempdb..#hijos') IS NOT NULL DROP TABLE #hijos;
CREATE TABLE #hijos (object_id int, tabla sysname, columna_hija sysname, columna_hc sysname NULL, origen varchar(20));

INSERT #hijos (object_id, tabla, columna_hija, columna_hc, origen)
SELECT DISTINCT t.object_id, t.name, ch.name, hc.name, 'nomenclatura'
  FROM sys.columns hc
  JOIN sys.columns ch ON ch.name LIKE hc.name + N'[_]%' AND ch.object_id <> hc.object_id
  JOIN sys.tables t   ON t.object_id = ch.object_id AND t.is_ms_shipped = 0
 WHERE hc.object_id = @obj
   AND hc.name LIKE N'%[_]HICL';

INSERT #hijos (object_id, tabla, columna_hija, columna_hc, origen)
SELECT t.object_id, t.name, c.name, NULL, 'contiene _HICL_'
  FROM sys.columns c
  JOIN sys.tables t ON t.object_id = c.object_id AND t.is_ms_shipped = 0
 WHERE c.object_id <> @obj
   AND c.name LIKE N'%[_]HICL[_]%'
   AND NOT EXISTS (SELECT 1 FROM #hijos h WHERE h.object_id = c.object_id AND h.columna_hija = c.name);

INSERT #hijos (object_id, tabla, columna_hija, columna_hc, origen)
SELECT fk.parent_object_id, OBJECT_NAME(fk.parent_object_id), pc.name, rc.name, 'llave foranea'
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id     AND pc.column_id = fkc.parent_column_id
  JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
 WHERE fk.referenced_object_id = @obj;

-- (a) las relaciones encontradas, con el tamaño de cada tabla
SELECT h.tabla, h.columna_hija, h.columna_hc, h.origen,
       (SELECT SUM(ps.row_count) FROM sys.dm_db_partition_stats ps
         WHERE ps.object_id = h.object_id AND ps.index_id IN (0, 1)) AS filas
  FROM #hijos h
 ORDER BY filas DESC, h.tabla;

-- (b) las llaves foráneas que salen DE historiaclinica (a qué catálogos apunta)
SELECT fk.name AS llave, pc.name AS columna, OBJECT_NAME(fk.referenced_object_id) AS apunta_a, rc.name AS columna_destino
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id     AND pc.column_id = fkc.parent_column_id
  JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
 WHERE fk.parent_object_id = @obj;

-- (c) las columnas de cada tabla hija, para mapearlas
SELECT t.name AS tabla, c.column_id AS n, c.name AS columna, ty.name AS tipo,
       CASE WHEN c.max_length = -1 THEN 'max'
            WHEN ty.name IN ('nvarchar', 'nchar') THEN CAST(c.max_length / 2 AS varchar(10))
            WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary') THEN CAST(c.max_length AS varchar(10))
            ELSE 'NULL' END AS ancho,
       CASE WHEN c.is_nullable = 1 THEN 'SI' ELSE 'NO' END AS acepta_nulos
  FROM sys.tables t
  JOIN sys.columns c ON c.object_id = t.object_id
  JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
 WHERE t.object_id IN (SELECT object_id FROM #hijos)
 ORDER BY t.name, c.column_id;
GO

-- =============================================================================
-- HC-4 · El código del proveedor que ya arma el resumen de la atención
--
-- SP_INTEROPERABILIDAD_IHC_V2 implementa la interoperabilidad de historia
-- clínica (Resolución 866 de 2021): por obligación normativa tiene que juntar
-- diagnósticos, medicamentos, procedimientos y datos del profesional. Leerlo es
-- el atajo para saber qué tablas forman una atención. Y el catálogo de
-- especialidades tiene NU_GENRDA_ESP («genera RDA», el Resumen Digital de
-- Atención): dice para qué especialidades se arma.
-- =============================================================================

-- (a) los procedimientos y vistas relacionados, con sus parámetros y si se ejecutan
SELECT o.name AS objeto, o.type_desc AS tipo, o.create_date AS creado, o.modify_date AS modificado,
       LEN(m.definition) AS largo,
       (SELECT STRING_AGG(CAST(p.name + N' ' + TYPE_NAME(p.user_type_id) AS nvarchar(max)), N', ')
                   WITHIN GROUP (ORDER BY p.parameter_id)
          FROM sys.parameters p WHERE p.object_id = o.object_id) AS parametros,
       s.execution_count AS ejecuciones_desde_que_esta_en_cache,
       s.last_execution_time AS ultima_ejecucion,
       s.cached_time AS en_cache_desde
  FROM sys.objects o
  JOIN sys.sql_modules m ON m.object_id = o.object_id
  LEFT JOIN sys.dm_exec_procedure_stats s ON s.object_id = o.object_id AND s.database_id = DB_ID()
 WHERE o.name LIKE N'%INTEROP%' OR o.name LIKE N'%IHC%'     OR o.name LIKE N'%FHIR%'
    OR o.name LIKE N'%[_]RDA%'  OR o.name LIKE N'RDA%'      OR o.name LIKE N'%HISTORIA%'
    OR o.name LIKE N'%HICL%'    OR o.name LIKE N'%EPICRI%'  OR o.name LIKE N'%FORMULA%'
    OR o.name LIKE N'%RESUMEN%' OR o.name LIKE N'%RECETA%'
 ORDER BY o.modify_date DESC;

-- (b) TODO el código que menciona HISTORIACLINICA (incluye disparadores y vistas)
SELECT o.name AS objeto, o.type_desc AS tipo, o.modify_date AS modificado, LEN(m.definition) AS largo,
       CASE WHEN m.definition LIKE N'%INSERT%HISTORIACLINICA%' OR m.definition LIKE N'%UPDATE%HISTORIACLINICA%'
            THEN 'puede escribir' ELSE 'lee' END AS uso_aparente
  FROM sys.sql_modules m
  JOIN sys.objects o ON o.object_id = m.object_id
 WHERE m.definition LIKE N'%HISTORIACLINICA%'
 ORDER BY o.type_desc, o.name;

-- (c) qué tablas usa cada procedimiento de interoperabilidad, con su tamaño
SELECT OBJECT_NAME(d.referencing_id) AS procedimiento,
       ISNULL(d.referenced_database_name + N'.', N'') + d.referenced_entity_name AS tabla_u_objeto,
       (SELECT SUM(ps.row_count) FROM sys.dm_db_partition_stats ps
         WHERE ps.object_id = OBJECT_ID(N'dbo.' + QUOTENAME(d.referenced_entity_name)) AND ps.index_id IN (0, 1)) AS filas
  FROM sys.sql_expression_dependencies d
 WHERE OBJECT_NAME(d.referencing_id) LIKE N'%INTEROP%'
    OR OBJECT_NAME(d.referencing_id) LIKE N'%IHC%'
    OR OBJECT_NAME(d.referencing_id) LIKE N'%FHIR%'
 GROUP BY OBJECT_NAME(d.referencing_id), d.referenced_database_name, d.referenced_entity_name
 ORDER BY procedimiento, tabla_u_objeto;

-- (d) para qué especialidades se arma el Resumen Digital de Atención (catálogo, sin pacientes)
SELECT NU_GENRDA_ESP AS genera_rda,
       COUNT(*)      AS especialidades,
       STRING_AGG(CAST(CD_CODI_ESP + N' ' + ISNULL(NO_NOMB_ESP, N'') AS nvarchar(max)), N' | ')
           WITHIN GROUP (ORDER BY CD_CODI_ESP) AS cuales
  FROM dbo.ESPECIALIDADES
 GROUP BY NU_GENRDA_ESP
 ORDER BY NU_GENRDA_ESP;

-- (e) el texto COMPLETO de los dos procedimientos: clic en la celda → se abre
--     el código → Archivo → Guardar como .sql → enviármelo
SELECT o.name AS procedimiento,
       (SELECT m.definition AS [processing-instruction(codigo)] FOR XML PATH(''), TYPE) AS codigo_completo
  FROM sys.sql_modules m
  JOIN sys.objects o ON o.object_id = m.object_id
 WHERE o.name IN (N'SP_INTEROPERABILIDAD_IHC_V2', N'SP_INTEROPERABILIDAD_HC_FHIR', N'SP_INTEROPERABILIDAD');
GO

-- =============================================================================
-- HC-5 · Perfil de HISTORIACLINICA en los últimos 60 días (hasta 20.000 filas)
--
-- Por cada columna: cuántas filas traen valor, cuántos valores distintos y,
-- SOLO si es un código (o tiene 30 valores o menos en una muestra grande y no
-- es un nombre, documento, teléfono, correo o dirección), los valores más
-- frecuentes. Ahí debe aparecer la marca de «historia cerrada / firmada» y el
-- tipo de atención (consulta, urgencias, hospitalización…).
-- De las columnas de texto largo solo se mide el largo, nunca el contenido.
-- (c) cruza cada fecha con la principal: si una sale siempre DESPUÉS, es la de
-- cierre, y la diferencia dice cuánto esperar antes de enviar el resumen.
--
-- Copia la muestra a #m (tempdb), que se borra sola. Puede tardar 1-3 min.
-- =============================================================================
IF OBJECT_ID('tempdb..#hc') IS NULL
BEGIN
    RAISERROR(N'Corre primero el bloque HC-0 en esta misma ventana.', 16, 1);
    RETURN;
END;

DECLARE @tabla sysname = (SELECT valor FROM #hc WHERE clave = 'tabla');
DECLARE @fecha sysname = (SELECT valor FROM #hc WHERE clave = 'fecha');
DECLARE @obj   int     = OBJECT_ID(N'dbo.' + QUOTENAME(@tabla));
DECLARE @dias  int     = 60;
DECLARE @tope  int     = 20000;

IF OBJECT_ID('tempdb..#perfil') IS NOT NULL DROP TABLE #perfil;
CREATE TABLE #perfil (
    n int, columna sysname, tipo sysname, ancho varchar(10),
    filas_muestra int NULL, con_valor int NULL, distintos int NULL,
    minimo nvarchar(60) NULL, maximo nvarchar(60) NULL,
    bytes_promedio int NULL, bytes_max int NULL,
    valores_mas_frecuentes nvarchar(max) NULL);
IF OBJECT_ID('tempdb..#fechas') IS NOT NULL DROP TABLE #fechas;
CREATE TABLE #fechas (columna sysname, con_valor int, despues_de_la_principal int, antes_de_la_principal int,
                      minutos_min int NULL, minutos_promedio int NULL, minutos_max int NULL);

-- Solo desde la frontera de HC-0 y de la más nueva hacia atrás: lectura por el índice agrupado.
DECLARE @id_desde bigint = CAST((SELECT valor FROM #hc WHERE clave = 'id_desde_90d') AS bigint);
DECLARE @filtro nvarchar(400) = N' WHERE NU_NUME_HICL >= ' + CAST(@id_desde AS nvarchar(30))
    + N' AND FE_FECH_HICL >= DATEADD(day, -' + CAST(@dias AS nvarchar(10)) + N', CAST(GETDATE() AS date))';
DECLARE @orden nvarchar(200) = N' ORDER BY NU_NUME_HICL DESC';

-- Clasificación de columnas
DECLARE @cols TABLE (column_id int, nombre sysname, tipo sysname, ancho varchar(10), larga bit, codigo bit, personal bit);
INSERT @cols
SELECT c.column_id, c.name, ty.name,
       CASE WHEN c.max_length = -1 THEN 'max'
            WHEN ty.name IN ('nvarchar', 'nchar') THEN CAST(c.max_length / 2 AS varchar(10))
            WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary') THEN CAST(c.max_length AS varchar(10))
            ELSE 'NULL' END,
       CASE WHEN ty.name IN ('text', 'ntext', 'image', 'xml', 'varbinary', 'binary', 'sql_variant',
                             'geography', 'geometry', 'hierarchyid') OR c.max_length = -1 OR c.max_length > 200
            THEN 1 ELSE 0 END,
       CASE WHEN ty.name IN ('bit', 'tinyint', 'smallint') THEN 1
            WHEN ty.name IN ('char', 'varchar') AND c.max_length BETWEEN 1 AND 4 THEN 1
            WHEN ty.name IN ('nchar', 'nvarchar') AND c.max_length BETWEEN 1 AND 8 THEN 1
            ELSE 0 END,
       CASE WHEN c.name LIKE N'%NOMB%' OR c.name LIKE N'%DOCU%' OR c.name LIKE N'%HIST[_]PAC%'
              OR c.name LIKE N'%TELE%' OR c.name LIKE N'%MAIL%' OR c.name LIKE N'%DIRE%'
              OR c.name LIKE N'%CELU%' OR c.name LIKE N'%APEL%' THEN 1 ELSE 0 END
  FROM sys.columns c
  JOIN sys.types ty ON ty.user_type_id = c.user_type_id
 WHERE c.object_id = @obj
   AND ty.name NOT IN ('timestamp', 'rowversion');

DECLARE @cortas nvarchar(max) = (SELECT STRING_AGG(CAST(QUOTENAME(nombre) AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY column_id) FROM @cols WHERE larga = 0);
DECLARE @largas nvarchar(max) = (SELECT STRING_AGG(CAST(QUOTENAME(nombre) AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY column_id) FROM @cols WHERE larga = 1);

-- Un INSERT por columna corta
DECLARE @por_columna nvarchar(max) = (
    SELECT STRING_AGG(CAST(
        N'INSERT #perfil (n, columna, tipo, ancho, filas_muestra, con_valor, distintos, minimo, maximo, bytes_promedio, bytes_max) '
      + N'SELECT ' + CAST(column_id AS nvarchar(10)) + N', N''' + nombre + N''', N''' + tipo + N''', ''' + ancho + N''', @filas, '
      + N'COUNT(' + QUOTENAME(nombre) + N'), '
      + CASE WHEN tipo = 'uniqueidentifier' THEN N'NULL' ELSE N'COUNT(DISTINCT ' + QUOTENAME(nombre) + N')' END + N', '
      + CASE WHEN personal = 1
                  THEN N'NULL, NULL'
             WHEN tipo IN ('date', 'datetime', 'smalldatetime', 'datetime2')
                  THEN N'CONVERT(nvarchar(60), MIN(' + QUOTENAME(nombre) + N'), 120), CONVERT(nvarchar(60), MAX(' + QUOTENAME(nombre) + N'), 120)'
             WHEN tipo = 'bit'
                  THEN N'CONVERT(nvarchar(60), MIN(CAST(' + QUOTENAME(nombre) + N' AS tinyint))), CONVERT(nvarchar(60), MAX(CAST(' + QUOTENAME(nombre) + N' AS tinyint)))'
             WHEN tipo IN ('tinyint', 'smallint', 'int', 'bigint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney')
               OR codigo = 1
                  THEN N'CONVERT(nvarchar(60), MIN(' + QUOTENAME(nombre) + N')), CONVERT(nvarchar(60), MAX(' + QUOTENAME(nombre) + N'))'
             ELSE N'NULL, NULL' END + N', '
      + CASE WHEN tipo IN ('char', 'varchar', 'nchar', 'nvarchar')
                  THEN N'AVG(CAST(DATALENGTH(' + QUOTENAME(nombre) + N') AS bigint)), MAX(DATALENGTH(' + QUOTENAME(nombre) + N'))'
             ELSE N'NULL, NULL' END
      + N' FROM #m;' AS nvarchar(max)), NCHAR(10)) WITHIN GROUP (ORDER BY column_id)
      FROM @cols WHERE larga = 0);

-- Valores más frecuentes: códigos siempre; el resto solo si son pocos, la muestra es grande y no es dato personal
DECLARE @frecuentes nvarchar(max) = (
    SELECT STRING_AGG(CAST(
        N'UPDATE #perfil SET valores_mas_frecuentes = (SELECT STRING_AGG(CAST(CONCAT(ISNULL(x.v, N''(vacío)''), N'' ('', x.n, N'')'') AS nvarchar(max)), N'' · '') WITHIN GROUP (ORDER BY x.n DESC) '
      + N'FROM (SELECT TOP (15) CONVERT(nvarchar(60), ' + CASE WHEN tipo = 'bit' THEN N'CAST(' + QUOTENAME(nombre) + N' AS tinyint)' ELSE QUOTENAME(nombre) END
      + N') AS v, COUNT(*) AS n FROM #m GROUP BY ' + QUOTENAME(nombre) + N' ORDER BY COUNT(*) DESC) x) '
      + N'WHERE columna = N''' + nombre + N''''
      + CASE WHEN codigo = 1 THEN N';' ELSE N' AND distintos <= 30 AND filas_muestra >= 500;' END AS nvarchar(max)), NCHAR(10))
      WITHIN GROUP (ORDER BY column_id)
      FROM @cols WHERE larga = 0 AND personal = 0 AND tipo <> 'uniqueidentifier');

-- Fechas secundarias contra la principal
DECLARE @vs_fecha nvarchar(max) = (
    SELECT STRING_AGG(CAST(
        N'INSERT #fechas SELECT N''' + nombre + N''', COUNT(' + QUOTENAME(nombre) + N'), '
      + N'SUM(CASE WHEN ' + QUOTENAME(nombre) + N' > ' + QUOTENAME(@fecha) + N' THEN 1 ELSE 0 END), '
      + N'SUM(CASE WHEN ' + QUOTENAME(nombre) + N' < ' + QUOTENAME(@fecha) + N' THEN 1 ELSE 0 END), '
      + N'MIN(DATEDIFF(minute, ' + QUOTENAME(@fecha) + N', ' + QUOTENAME(nombre) + N')), '
      + N'AVG(DATEDIFF(minute, ' + QUOTENAME(@fecha) + N', ' + QUOTENAME(nombre) + N')), '
      + N'MAX(DATEDIFF(minute, ' + QUOTENAME(@fecha) + N', ' + QUOTENAME(nombre) + N')) FROM #m;' AS nvarchar(max)), NCHAR(10))
      WITHIN GROUP (ORDER BY column_id)
      FROM @cols WHERE larga = 0 AND tipo IN ('date', 'datetime', 'smalldatetime', 'datetime2') AND nombre <> ISNULL(@fecha, N''));

DECLARE @sql nvarchar(max) =
      N'SELECT TOP (@tope) ' + @cortas + N' INTO #m FROM dbo.' + QUOTENAME(@tabla) + N' WITH (NOLOCK)' + @filtro + @orden + N' OPTION (MAXDOP 1);' + NCHAR(10)
    + N'DECLARE @filas int = (SELECT COUNT(*) FROM #m);' + NCHAR(10)
    + ISNULL(@por_columna, N'') + NCHAR(10)
    + ISNULL(@frecuentes, N'') + NCHAR(10)
    + CASE WHEN @fecha IS NULL THEN N'' ELSE ISNULL(@vs_fecha, N'') END;
EXEC sp_executesql @sql, N'@tope int', @tope = @tope;

-- Columnas largas: solo el largo, en una sola pasada
IF @largas IS NOT NULL
BEGIN
    DECLARE @valores nvarchar(max) = (
        SELECT STRING_AGG(CAST(N'(N''' + nombre + N''', CAST(DATALENGTH(s.' + QUOTENAME(nombre) + N') AS bigint))' AS nvarchar(max)), N', ')
                   WITHIN GROUP (ORDER BY column_id)
          FROM @cols WHERE larga = 1);
    SET @sql =
          N'INSERT #perfil (n, columna, tipo, ancho, filas_muestra, con_valor, bytes_promedio, bytes_max) '
        + N'SELECT c.column_id, v.columna, c.tipo, c.ancho, COUNT(*), SUM(CASE WHEN v.bytes > 0 THEN 1 ELSE 0 END), AVG(ISNULL(v.bytes, 0)), MAX(v.bytes) '
        + N'FROM (SELECT TOP (@tope) ' + @largas + N' FROM dbo.' + QUOTENAME(@tabla) + N' WITH (NOLOCK)' + @filtro + @orden + N') s '
        + N'CROSS APPLY (VALUES ' + @valores + N') v(columna, bytes) '
        + N'JOIN #cols_largas c ON c.nombre = v.columna '
        + N'GROUP BY c.column_id, v.columna, c.tipo, c.ancho OPTION (MAXDOP 1);';
    IF OBJECT_ID('tempdb..#cols_largas') IS NOT NULL DROP TABLE #cols_largas;
    SELECT column_id, nombre, tipo, ancho INTO #cols_largas FROM @cols WHERE larga = 1;
    EXEC sp_executesql @sql, N'@tope int', @tope = @tope;
END;

-- (a) el perfil
SELECT n, columna, tipo, ancho, filas_muestra, con_valor,
       CAST(100.0 * con_valor / NULLIF(filas_muestra, 0) AS decimal(5, 1)) AS pct_con_valor,
       distintos, minimo, maximo, bytes_promedio, bytes_max, valores_mas_frecuentes
  FROM #perfil
 ORDER BY n;

-- (b) las fechas contra la principal (minutos; positivo = después)
SELECT (SELECT valor FROM #hc WHERE clave = 'fecha') AS fecha_principal, f.*
  FROM #fechas f
 ORDER BY f.columna;
GO

-- =============================================================================
-- HC-6 · La historia y la cita (últimos 30 días)
--
-- HISTORIACLINICA no guarda especialidad ni servicio, así que la cita del
-- mismo paciente el mismo día es la que dice qué atención fue. Responde:
--   (a)  cuántas historias tienen cita ese día (y con el mismo médico de
--        agenda), y si FE_FECH_HICL trae hora o solo fecha;
--   (a2) si una atención es una fila o varias;
--   (a3) cuántos minutos después de la hora de la cita se escribe la historia
--        (dice cuánto esperar antes de enviar el resumen);
--   (b)  de las citas ya pasadas, por estado, cuántas dejaron historia (de paso
--        cierra la pregunta I.12 de ESTADO.md: si el 2 es «no asistió», sus
--        citas casi nunca deberían tener historia);
--   (c)  especialidad y (c2) servicio de la cita, y si la especialidad genera RDA;
--   (d)  cargo del médico que atendió, con y sin cita (sin cita = urgencias,
--        hospitalización u otra cosa que no es consulta externa);
--   (e)  a qué hora del día se escriben, con y sin cita.
-- =============================================================================
IF OBJECT_ID('tempdb..#hc') IS NULL
BEGIN
    RAISERROR(N'Corre primero el bloque HC-0 en esta misma ventana.', 16, 1);
    RETURN;
END;

DECLARE @id_desde bigint = CAST((SELECT valor FROM #hc WHERE clave = 'id_desde_90d') AS bigint);
DECLARE @desde date = DATEADD(day, -30, CAST(GETDATE() AS date));
DECLARE @hoy   date = CAST(GETDATE() AS date);

IF OBJECT_ID('tempdb..#h') IS NOT NULL DROP TABLE #h;
SELECT h.NU_NUME_HICL                                       AS id,
       LTRIM(RTRIM(CAST(h.NU_HIST_PAC_HICL AS varchar(30)))) AS pac,
       h.FE_FECH_HICL                                       AS fecha,
       CAST(h.FE_FECH_HICL AS date)                         AS dia,
       CAST(h.CD_MED_ASIG_HICL AS varchar(10))              AS med_asig,
       CAST(h.CD_MED_REAL_HICL AS varchar(10))              AS med_real
  INTO #h
  FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
 WHERE h.NU_NUME_HICL >= @id_desde
   AND h.FE_FECH_HICL >= @desde AND h.FE_FECH_HICL < @hoy
OPTION (MAXDOP 1);

IF OBJECT_ID('tempdb..#c') IS NOT NULL DROP TABLE #c;
SELECT LTRIM(RTRIM(c.NU_HIST_PAC_CIT))                                     AS pac,
       CAST(c.FE_FECH_CIT AS date)                                         AS dia,
       c.CD_CODI_MED_CIT                                                   AS med,
       c.NU_ESTA_CIT                                                       AS estado,
       c.CD_CODI_ESP_CIT                                                   AS esp,
       c.CD_CODI_SER_CIT                                                   AS ser,
       TRY_CONVERT(datetime, REPLACE(LEFT(c.FE_HORA_CIT, 16), '/', '-'), 120) AS hora
  INTO #c
  FROM dbo.CITAS_MEDICAS c WITH (NOLOCK)
 WHERE c.FE_FECH_CIT >= @desde AND c.FE_FECH_CIT < @hoy
OPTION (MAXDOP 1);

-- Para cada historia: ¿hay cita ese día? ¿con el mismo médico de agenda?
IF OBJECT_ID('tempdb..#hx') IS NOT NULL DROP TABLE #hx;
SELECT h.id, h.pac, h.fecha, h.dia, h.med_real,
       CASE WHEN d.pac IS NOT NULL THEN 1 ELSE 0 END AS con_cita,
       CASE WHEN m.pac IS NOT NULL THEN 1 ELSE 0 END AS mismo_medico
  INTO #hx
  FROM #h h
  LEFT JOIN (SELECT DISTINCT pac, dia FROM #c) d      ON d.pac = h.pac AND d.dia = h.dia
  LEFT JOIN (SELECT DISTINCT pac, dia, med FROM #c) m ON m.pac = h.pac AND m.dia = h.dia AND m.med = h.med_asig;

-- (a)
SELECT COUNT(*)                                                                  AS historias_30_dias,
       SUM(con_cita)                                                             AS con_cita_mismo_paciente_mismo_dia,
       SUM(mismo_medico)                                                         AS ademas_mismo_medico_de_agenda,
       CAST(100.0 * SUM(con_cita) / NULLIF(COUNT(*), 0) AS decimal(5, 1))        AS pct_con_cita,
       SUM(CASE WHEN CAST(fecha AS time) <> '00:00:00' THEN 1 ELSE 0 END)        AS fecha_con_hora,
       COUNT(DISTINCT pac)                                                       AS pacientes
  FROM #hx;

-- (a2)
SELECT historias_ese_dia, COUNT(*) AS paciente_dia
  FROM (SELECT pac, dia, COUNT(*) AS historias_ese_dia FROM #h GROUP BY pac, dia) x
 GROUP BY historias_ese_dia
 ORDER BY historias_ese_dia;

-- (a3) minutos entre la hora de la cita (misma persona, día y médico de agenda) y FE_FECH_HICL
;WITH par AS (
    SELECT h.id, DATEDIFF(minute, MIN(c.hora), h.fecha) AS minutos
      FROM #h h
      JOIN #c c ON c.pac = h.pac AND c.dia = h.dia AND c.med = h.med_asig
     WHERE c.hora IS NOT NULL
     GROUP BY h.id, h.fecha
)
SELECT DISTINCT
       COUNT(*) OVER ()                                                        AS historias_con_hora_de_cita,
       MIN(minutos) OVER ()                                                    AS minimo,
       PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY minutos) OVER ()           AS p10,
       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY minutos) OVER ()           AS mediana,
       PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY minutos) OVER ()           AS p90,
       MAX(minutos) OVER ()                                                    AS maximo
  FROM par;

-- (b)
SELECT c.estado,
       COUNT(*)                                                                          AS citas_pasadas_30_dias,
       SUM(CASE WHEN h.pac IS NOT NULL THEN 1 ELSE 0 END)                                AS con_historia_ese_dia,
       CAST(100.0 * SUM(CASE WHEN h.pac IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS decimal(5, 1)) AS pct_con_historia
  FROM #c c
  LEFT JOIN (SELECT DISTINCT pac, dia FROM #h) h ON h.pac = c.pac AND h.dia = c.dia
 GROUP BY c.estado
 ORDER BY c.estado;

-- (c) especialidad de la cita del mismo día
SELECT TOP (30) x.esp AS especialidad, e.NO_NOMB_ESP AS nombre, e.NU_GENRDA_ESP AS genera_rda,
       COUNT(*) AS historias,
       CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5, 1)) AS pct
  FROM (SELECT h.id, MIN(c.esp) AS esp
          FROM #h h JOIN #c c ON c.pac = h.pac AND c.dia = h.dia
         GROUP BY h.id) x
  LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = x.esp
 GROUP BY x.esp, e.NO_NOMB_ESP, e.NU_GENRDA_ESP
 ORDER BY historias DESC;

-- (c2) servicio de la cita del mismo día
SELECT TOP (30) x.ser AS servicio, s.NO_NOMB_SER AS nombre, COUNT(*) AS historias,
       CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5, 1)) AS pct
  FROM (SELECT h.id, MIN(c.ser) AS ser
          FROM #h h JOIN #c c ON c.pac = h.pac AND c.dia = h.dia
         GROUP BY h.id) x
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = x.ser
 GROUP BY x.ser, s.NO_NOMB_SER
 ORDER BY historias DESC;

-- (d) cargo del médico que atendió (el cargo, no el nombre)
SELECT ISNULL(m.DE_CARG_MED, N'(médico sin cargo o no encontrado)') AS cargo,
       COUNT(*)                                     AS historias,
       SUM(hx.con_cita)                             AS con_cita,
       SUM(1 - hx.con_cita)                         AS sin_cita,
       COUNT(DISTINCT hx.med_real)                  AS medicos
  FROM #hx hx
  LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = hx.med_real
 GROUP BY m.DE_CARG_MED
 ORDER BY historias DESC;

-- (e) hora del día en que se escriben
SELECT DATEPART(hour, fecha)  AS hora,
       SUM(con_cita)          AS con_cita,
       SUM(1 - con_cita)      AS sin_cita
  FROM #hx
 GROUP BY DATEPART(hour, fecha)
 ORDER BY hora;
GO

-- =============================================================================
-- HC-7 · ¿A quién se le puede enviar? Contacto de los pacientes con historia en
--        los últimos 90 días (solo conteos)
--
-- `DE_TELE_PAC` es varchar(10): un celular colombiano son 10 dígitos que
-- empiezan por 3. Un correo «aparente» tiene algo@algo.algo sin espacios. Los
-- menores de edad cuentan aparte, porque el resumen iría al acompañante.
-- (b) correos compartidos por 20 pacientes o más: casi seguro relleno
-- («notiene@…»), y se muestran porque no son de nadie.
-- (c) dominios más usados: dicen si hay que cuidar la entrega a Hotmail/Outlook.
-- =============================================================================
IF OBJECT_ID('tempdb..#hc') IS NULL
BEGIN
    RAISERROR(N'Corre primero el bloque HC-0 en esta misma ventana.', 16, 1);
    RETURN;
END;

DECLARE @id_desde bigint = CAST((SELECT valor FROM #hc WHERE clave = 'id_desde_90d') AS bigint);

IF OBJECT_ID('tempdb..#p') IS NOT NULL DROP TABLE #p;
SELECT pa.NU_HIST_PAC,
       LTRIM(RTRIM(ISNULL(pa.DE_TELE_PAC, '')))                AS tel,
       LOWER(LTRIM(RTRIM(ISNULL(pa.DE_EMAIL_PAC, ''))))        AS correo,
       LTRIM(RTRIM(ISNULL(pa.DE_TELE_ACOM_PAC, '')))           AS tel_acom,
       LOWER(LTRIM(RTRIM(ISNULL(pa.TX_EMAIL_ACOM_PAC, ''))))   AS correo_acom,
       CASE WHEN pa.FE_NACI_PAC IS NULL THEN NULL
            ELSE (CONVERT(int, CONVERT(char(8), GETDATE(), 112)) - CONVERT(int, CONVERT(char(8), pa.FE_NACI_PAC, 112))) / 10000
       END                                                     AS edad
  INTO #p
  FROM dbo.PACIENTES pa WITH (NOLOCK)
 WHERE pa.NU_HIST_PAC IN (SELECT h.NU_HIST_PAC_HICL
                            FROM dbo.HISTORIACLINICA h WITH (NOLOCK)
                           WHERE h.NU_NUME_HICL >= @id_desde
                             AND h.FE_FECH_HICL >= DATEADD(day, -90, CAST(GETDATE() AS date)))
OPTION (MAXDOP 1);

-- (a)
SELECT COUNT(*) AS pacientes_con_historia_90_dias,
       SUM(CASE WHEN tel LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' THEN 1 ELSE 0 END)   AS con_celular,
       SUM(CASE WHEN correo LIKE '%_@_%._%' AND correo NOT LIKE '% %' THEN 1 ELSE 0 END)             AS con_correo_aparente,
       SUM(CASE WHEN tel LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
                 AND correo LIKE '%_@_%._%' AND correo NOT LIKE '% %' THEN 1 ELSE 0 END)            AS con_los_dos,
       SUM(CASE WHEN tel NOT LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
                 AND NOT (correo LIKE '%_@_%._%' AND correo NOT LIKE '% %') THEN 1 ELSE 0 END)      AS sin_ninguno,
       SUM(CASE WHEN edad < 18 THEN 1 ELSE 0 END)                                                    AS menores_de_edad,
       SUM(CASE WHEN edad < 18 AND tel_acom LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]%' THEN 1 ELSE 0 END)
                                                                                                    AS menores_con_celular_del_acompanante,
       SUM(CASE WHEN edad < 18 AND correo_acom LIKE '%_@_%._%' AND correo_acom NOT LIKE '% %' THEN 1 ELSE 0 END)
                                                                                                    AS menores_con_correo_del_acompanante
  FROM #p;

-- (b)
SELECT correo AS correo_de_relleno_probable, COUNT(*) AS pacientes
  FROM #p
 WHERE correo LIKE '%_@_%._%'
 GROUP BY correo
HAVING COUNT(*) >= 20
 ORDER BY pacientes DESC;

-- (c)
SELECT TOP (10) SUBSTRING(correo, CHARINDEX('@', correo) + 1, 100) AS dominio, COUNT(*) AS pacientes
  FROM #p
 WHERE correo LIKE '%_@_%._%' AND correo NOT LIKE '% %'
 GROUP BY SUBSTRING(correo, CHARINDEX('@', correo) + 1, 100)
 ORDER BY pacientes DESC;
GO

-- =============================================================================
-- HC-8 · Qué puede leer hoy el usuario del agente (agenia_sync)
--
-- Debe salir SIN permiso sobre HISTORIACLINICA (así se dejó a propósito en
-- AGENIA_SYNC_SETUP.sql). Lo que falte para esta función se pide aparte, por
-- escrito, con la lista exacta de tablas y columnas.
-- =============================================================================
SELECT pr.name AS usuario, pe.class_desc AS ambito,
       ISNULL(OBJECT_NAME(pe.major_id), N'(toda la base)') AS objeto,
       CASE WHEN pe.minor_id > 0 THEN COL_NAME(pe.major_id, pe.minor_id) ELSE N'' END AS columna,
       pe.permission_name AS permiso, pe.state_desc AS estado
  FROM sys.database_permissions pe
  JOIN sys.database_principals pr ON pr.principal_id = pe.grantee_principal_id
 WHERE pr.name = N'agenia_sync'
 ORDER BY objeto, permiso;

SELECT r.name AS rol_de_agenia_sync
  FROM sys.database_role_members m
  JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
  JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
 WHERE u.name = N'agenia_sync';
GO

-- =============================================================================
-- HC-9 · SOLO EN PRUEBAS · Todo lo que dejó una atención de prueba
--
-- Antes: que un médico, en PRUEBAS, le haga una consulta COMPLETA a un paciente
-- de prueba (nada de un paciente real): diagnóstico, dos medicamentos, dos
-- exámenes de laboratorio, una imagen, una incapacidad, una remisión y
-- recomendaciones; y que la cierre/firme como lo hace siempre. Luego se
-- escribe su documento abajo y se corre este bloque.
--
-- Devuelve las filas completas de esa atención en HISTORIACLINICA, en sus
-- tablas hijas (HC-3) y en toda tabla de nombre clínico (HC-1) que tenga una
-- columna de paciente. Con eso se hace el mapeo exacto, campo por campo.
-- =============================================================================
DECLARE @documento_de_prueba varchar(20) = '';      -- ← documento del paciente de PRUEBA
DECLARE @confirmo_paciente_de_prueba bit = 0;       -- ← 1 solo si se corre fuera de PRUEBAS

IF @documento_de_prueba = ''
BEGIN
    RAISERROR(N'HC-9: escribe el documento del paciente de prueba (se omite el bloque).', 10, 1);
    RETURN;
END;
IF DB_NAME() <> N'PRUEBAS' AND @confirmo_paciente_de_prueba = 0
BEGIN
    RAISERROR(N'HC-9 es para PRUEBAS. Fuera de ella, solo con un paciente de prueba y @confirmo_paciente_de_prueba = 1.', 16, 1);
    RETURN;
END;

DECLARE @obj int = OBJECT_ID(N'dbo.HISTORIACLINICA');
DECLARE @paciente sysname = N'NU_HIST_PAC_HICL';  -- confirmado en HC-0

-- (a) la historia
DECLARE @sql nvarchar(max) = N'SELECT N''HISTORIACLINICA'' AS _tabla, * FROM dbo.HISTORIACLINICA WHERE '
    + QUOTENAME(@paciente) + N' = @doc;';
EXEC sp_executesql @sql, N'@doc varchar(20)', @doc = @documento_de_prueba;

-- (b) sus tablas hijas (por la nomenclatura del HIS)
DECLARE @t sysname, @col_hija sysname, @col_hc sysname;
DECLARE hijos CURSOR LOCAL FAST_FORWARD FOR
    SELECT DISTINCT t.name, ch.name, hc.name
      FROM sys.columns hc
      JOIN sys.columns ch ON ch.name LIKE hc.name + N'[_]%' AND ch.object_id <> hc.object_id
      JOIN sys.tables t   ON t.object_id = ch.object_id AND t.is_ms_shipped = 0
     WHERE hc.object_id = @obj AND hc.name LIKE N'%[_]HICL';
OPEN hijos;
FETCH NEXT FROM hijos INTO @t, @col_hija, @col_hc;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'SELECT TOP (200) N''' + @t + N''' AS _tabla, * FROM dbo.' + QUOTENAME(@t)
             + N' WHERE ' + QUOTENAME(@col_hija) + N' IN (SELECT ' + QUOTENAME(@col_hc)
             + N' FROM dbo.HISTORIACLINICA WHERE ' + QUOTENAME(@paciente) + N' = @doc);';
    EXEC sp_executesql @sql, N'@doc varchar(20)', @doc = @documento_de_prueba;
    FETCH NEXT FROM hijos INTO @t, @col_hija, @col_hc;
END;
CLOSE hijos; DEALLOCATE hijos;

-- (c) toda tabla de nombre clínico con columna de paciente
DECLARE @col_pac sysname;
DECLARE clinicas CURSOR LOCAL FAST_FORWARD FOR
    SELECT t.name, MIN(c.name)
      FROM sys.tables t
      JOIN sys.columns c ON c.object_id = t.object_id AND c.name LIKE N'NU[_]HIST[_]PAC%'
     WHERE t.is_ms_shipped = 0
       AND t.name NOT IN (N'HISTORIACLINICA', N'PACIENTES')
       AND t.name NOT LIKE N'CITAS%' AND t.name NOT LIKE N'R[_]PAC%'
       AND (   t.name LIKE N'%HIST%'   OR t.name LIKE N'%EVOL%'   OR t.name LIKE N'%FORMU%'
            OR t.name LIKE N'%RECET%'  OR t.name LIKE N'%PRESC%'  OR t.name LIKE N'%MEDICAM%'
            OR t.name LIKE N'%ORDEN%'  OR t.name LIKE N'%LAB%'    OR t.name LIKE N'%EXAM%'
            OR t.name LIKE N'%DIAG%'   OR t.name LIKE N'%DX%'     OR t.name LIKE N'%PROCED%'
            OR t.name LIKE N'%INCAP%'  OR t.name LIKE N'%REMIS%'  OR t.name LIKE N'%INTERC%'
            OR t.name LIKE N'%EPICR%'  OR t.name LIKE N'%IMAGEN%' OR t.name LIKE N'%PARACL%'
            OR t.name LIKE N'%SOLIC%'  OR t.name LIKE N'%CONSUL%' OR t.name LIKE N'%ATENC%'
            OR t.name LIKE N'%FOLIO%'  OR t.name LIKE N'%RECOM%'  OR t.name LIKE N'%RDA%')
     GROUP BY t.name;
OPEN clinicas;
FETCH NEXT FROM clinicas INTO @t, @col_pac;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'IF EXISTS (SELECT 1 FROM dbo.' + QUOTENAME(@t) + N' WHERE ' + QUOTENAME(@col_pac) + N' = @doc) '
             + N'SELECT TOP (50) N''' + @t + N''' AS _tabla, * FROM dbo.' + QUOTENAME(@t)
             + N' WHERE ' + QUOTENAME(@col_pac) + N' = @doc;';
    EXEC sp_executesql @sql, N'@doc varchar(20)', @doc = @documento_de_prueba;
    FETCH NEXT FROM clinicas INTO @t, @col_pac;
END;
CLOSE clinicas; DEALLOCATE clinicas;
GO

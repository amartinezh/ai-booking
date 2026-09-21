/* =============================================================================
   MEDICIÓN DEL COSTO DE LA CONSULTA EN VIVO AL HIS — ESTRICTAMENTE SOLO LECTURA
   Base objetivo: PRUEBAS (la copia del hospital). NO ESEHSVP.
   =============================================================================

   PARA QUÉ. La consulta en vivo al HIS (rastreo de paciente, Fase 2) está
   IMPLEMENTADA y APAGADA (`HospitalMirrorConfig.lookupEnabled = false`). Su
   criterio de aceptación exige medir antes cuánto le cuesta al hospital
   (PLAN_RASTREO_PACIENTE.md §9; protocolo en CONSULTA_EN_VIVO.md). Este script
   ejecuta LAS MISMAS DOS CONSULTAS que corre el agente, con los mismos tipos de
   parámetro, y deja los números para decidir: se enciende, se acorta la ventana,
   o se deja solo la consulta por cupo.

   GARANTÍAS DE INOCUIDAD — verificables leyendo el archivo:
     · Solo sentencias SELECT (y EXEC sp_executesql de textos SELECT que están
       escritos aquí, literales). Ni un INSERT, UPDATE, DELETE, MERGE, ALTER,
       CREATE ni DROP. Ninguna tabla temporal en disco: solo una variable de
       tabla (@resultado) para poder entregar el resumen en una sola tabla.
     · `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED`: no toma bloqueos
       compartidos, así que no puede frenar a nadie que esté trabajando.
     · Las consultas medidas son COPIA EXACTA de las del agente
       (apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/lookup.ts), con la
       columna de fecha DESNUDA para que el índice del hospital sirva.
     · Guarda de base: si no se está en PRUEBAS, el script se detiene.

   🚫 LO QUE ESTE SCRIPT NO HACE, A PROPÓSITO: `DBCC DROPCLEANBUFFERS`.
      PRUEBAS vive en la MISMA instancia que ESEHSVP (192.168.1.16:1433), y ese
      comando vacía la caché de TODA la instancia: mediría nuestra consulta en
      frío a cambio de volver lenta la aplicación del hospital durante minutos.
      En su lugar se mide dos veces (1ª y 2ª corrida) y se reportan las LECTURAS
      LÓGICAS, que no dependen de la caché y son la cifra que de verdad compara.
      Si el DBA quiere la medición en frío de verdad, lo correcto es dejar
      PRUEBAS offline/online (afecta solo a esa base) — ver el pie del archivo.

   CÓMO EJECUTARLO (SSMS):
     1. PARTE A con el login `agenia_sync` (el del agente): confirma que puede
        leer y correr las dos consultas sin permisos nuevos.
     2. PARTES B a F con el login del DBA (las vistas de catálogo y los DMV
        piden más permisos que el mínimo del agente).
     3. Activar la pestaña Messages y copiarla completa: ahí salen las LECTURAS
        LÓGICAS y el CPU de cada consulta (`SET STATISTICS IO, TIME ON`).
     4. Devolver: (a) las tablas de resultados, (b) el texto de Messages.
        Opcional y muy útil: la PARTE F (plan de ejecución) o el .sqlplan.

   Ejecutar FUERA de la hora pico de asignación de citas.
   ============================================================================= */

USE PRUEBAS;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT OFF;
/* Obligatorias para los métodos XML (.nodes/.value) de las PARTES C y F: en SSMS
   vienen así por defecto, pero en sqlcmd QUOTED_IDENTIFIER llega OFF y esas
   consultas fallan con «Msg 1934 … SET options have incorrect settings». */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* -----------------------------------------------------------------------------
   PARTE A — PERMISOS Y CONTEXTO  (correr con el login agenia_sync)
   Si algo de aquí falla, el agente no podría consultar: es lo primero que hay
   que saber. No se esperan permisos nuevos (ya lee esta tabla).
   -------------------------------------------------------------------------- */
PRINT '=== PARTE A — permisos y contexto ===';

IF DB_NAME() <> 'PRUEBAS'
BEGIN
    /* Detiene el lote entero: no se mide contra el catálogo vivo por accidente. */
    THROW 50000, 'Esta medición va contra PRUEBAS, no contra el catálogo vivo. Corrija el USE.', 1;
END;

SELECT
    servidor         = @@SERVERNAME,
    base             = DB_NAME(),
    login_actual     = SUSER_SNAME(),
    usuario_en_la_bd = USER_NAME(),
    version_sql      = CAST(SERVERPROPERTY('ProductVersion') AS varchar(32)),
    nivel_compat     = (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()),
    fecha_servidor   = SYSDATETIME();

/* ¿Puede leer la tabla? */
SELECT TOP (1) puede_leer_citas_medicas = 1 FROM dbo.CITAS_MEDICAS WITH (NOLOCK);
GO

/* -----------------------------------------------------------------------------
   PARTE B — ¿ES REPRESENTATIVA LA COPIA?  (login del DBA)
   Un número medido sobre una copia de 30.000 filas no dice nada del catálogo de
   1.084.093. Todo por METADATOS: no recorre ninguna tabla.
   -------------------------------------------------------------------------- */
PRINT '';
PRINT '=== PARTE B — volumen de CITAS_MEDICAS en PRUEBAS y en el catálogo vivo ===';

SELECT
    base    = 'PRUEBAS',
    filas   = SUM(p.rows),
    mb      = CAST(SUM(a.total_pages) * 8.0 / 1024 AS decimal(10,1))
FROM sys.partitions p
JOIN sys.allocation_units a ON a.container_id = p.partition_id
WHERE p.object_id = OBJECT_ID('dbo.CITAS_MEDICAS') AND p.index_id IN (0, 1);

/* El catálogo vivo, también por metadatos (NO se lee ni una fila de datos).
   Va por SQL dinámico a propósito: una referencia directa a `ESEHSVP.sys…` se
   resuelve al compilar el lote y, si la base no existe o el login no la alcanza,
   el error NO lo atraparía el TRY/CATCH — abortaría el script. Es informativo. */
BEGIN TRY
    EXEC sp_executesql N'
        SELECT
            base  = ''ESEHSVP (vivo, referencia)'',
            filas = SUM(p.rows),
            mb    = CAST(SUM(a.total_pages) * 8.0 / 1024 AS decimal(10,1))
        FROM ESEHSVP.sys.partitions p
        JOIN ESEHSVP.sys.allocation_units a ON a.container_id = p.partition_id
        WHERE p.object_id = (SELECT object_id FROM ESEHSVP.sys.objects WHERE name = ''CITAS_MEDICAS'')
          AND p.index_id IN (0, 1);';
END TRY
BEGIN CATCH
    PRINT '   (no se pudo leer el volumen de ESEHSVP: ' + ERROR_MESSAGE() + ')';
END CATCH;
GO

/* -----------------------------------------------------------------------------
   PARTE C — LOS ÍNDICES QUE DECIDEN EL COSTO  (login del DBA)
   La pregunta concreta: ¿algún índice que empiece por FE_FECH_CIT INCLUYE
   NU_HIST_PAC_CIT? Si NO, cada fila del rango de fechas cuesta una lectura
   extra (Key Lookup) y la consulta por documento se encarece de golpe.
   -------------------------------------------------------------------------- */
PRINT '';
PRINT '=== PARTE C — índices de CITAS_MEDICAS ===';

SELECT
    indice        = i.name,
    tipo          = i.type_desc,
    es_pk         = i.is_primary_key,
    es_unico      = i.is_unique,
    columnas_clave = STUFF((
        SELECT ', ' + c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE '' END
        FROM sys.index_columns ic
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal
        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, ''),
    columnas_incluidas = ISNULL(STUFF((
        SELECT ', ' + c.name
        FROM sys.index_columns ic
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
        ORDER BY c.name
        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, ''), '(ninguna)')
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.CITAS_MEDICAS') AND i.type > 0
ORDER BY i.is_primary_key DESC, i.name;

/* Tipos reales de las columnas que el agente parametriza.
   Lo esperado: FE_FECH_CIT es `datetime` y el parámetro viaja como varchar(8) —
   la conversión ocurre del lado del PARÁMETRO (datetime tiene mayor precedencia),
   la columna queda desnuda y el índice sirve. Lo que habría que revisar es lo
   contrario: una conversión aplicada a la COLUMNA, que apagaría el índice. */
SELECT
    columna   = c.name,
    tipo      = t.name,
    longitud  = c.max_length,
    acepta_null = c.is_nullable
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.CITAS_MEDICAS')
  AND c.name IN ('CD_CODI_MED_CIT', 'FE_HORA_CIT', 'FE_FECH_CIT', 'NU_HIST_PAC_CIT',
                 'NU_ESTA_CIT', 'CD_CODI_SER_CIT')
ORDER BY c.name;
GO

/* -----------------------------------------------------------------------------
   PARTE D — VALORES REPRESENTATIVOS PARA MEDIR  (login del DBA)
   Se sacan de los datos, no se inventan: un médico y una hora que existan, y
   una historia con varias citas. Estas consultas de descubrimiento NO son las
   que se miden (van acotadas por fecha para no barrer la tabla).
   -------------------------------------------------------------------------- */
PRINT '';
PRINT '=== PARTE D — valores con los que se va a medir ===';

DECLARE @hoy       char(8) = CONVERT(char(8), SYSDATETIME(), 112);
DECLARE @hace30    char(8) = CONVERT(char(8), DATEADD(day, -30, SYSDATETIME()), 112);
DECLARE @hace7     char(8) = CONVERT(char(8), DATEADD(day,  -7, SYSDATETIME()), 112);
DECLARE @mas60     char(8) = CONVERT(char(8), DATEADD(day,  61, SYSDATETIME()), 112); -- borde EXCLUSIVO
DECLARE @mas173    char(8) = CONVERT(char(8), DATEADD(day, 174, SYSDATETIME()), 112); -- ventana máxima (180 d)

/* Un cupo que exista de verdad (el más reciente del último mes). */
DECLARE @med varchar(4), @hora varchar(18);
SELECT TOP (1) @med = CD_CODI_MED_CIT, @hora = FE_HORA_CIT
FROM dbo.CITAS_MEDICAS WITH (NOLOCK)
WHERE FE_FECH_CIT >= @hace30 AND FE_FECH_CIT < @hoy
ORDER BY FE_FECH_CIT DESC, FE_HORA_CIT DESC;

/* Una historia REPRESENTATIVA: con 2 a 6 citas en los últimos 30 días (ni el
   paciente de una sola cita ni el caso extremo de decenas). */
DECLARE @hist varchar(20);
SELECT TOP (1) @hist = NU_HIST_PAC_CIT
FROM dbo.CITAS_MEDICAS WITH (NOLOCK)
WHERE FE_FECH_CIT >= @hace30 AND FE_FECH_CIT < @hoy
  AND NU_HIST_PAC_CIT IS NOT NULL
GROUP BY NU_HIST_PAC_CIT
HAVING COUNT(*) BETWEEN 2 AND 6
ORDER BY NEWID();

/* La variante sin ceros a la izquierda: es el segundo parámetro que manda el
   agente cuando difiere. Se mide siempre con DOS (el `IN` más costoso); si la
   historia elegida no tiene ceros a la izquierda, el segundo es un valor que no
   existe (sufijo 'X') y el resultado no cambia: lo que se mide es el rango. */
DECLARE @hist2 varchar(20) =
    CASE WHEN @hist LIKE '0%' THEN LTRIM(REPLACE(LTRIM(REPLACE(@hist, '0', ' ')), ' ', '0'))
         ELSE @hist + 'X' END;
IF @hist2 = @hist SET @hist2 = @hist + 'X';

/* Una historia que NO existe: es el PEOR CASO y el más frecuente al
   diagnosticar. Con pocas o ninguna cita, el TOP 51 no puede cortar antes y hay
   que recorrer el rango de fechas COMPLETO. Esta es la cifra que decide. */
DECLARE @histInexistente varchar(20) = '999999999999';

SELECT
    medico_de_prueba     = @med,
    hora_de_prueba       = @hora,
    historia_de_prueba   = @hist,
    historia_variante    = @hist2,
    historia_inexistente = @histInexistente,
    ventana_7d           = @hace7 + ' → ' + @hoy,
    ventana_defecto_67d  = @hace7 + ' → ' + @mas60,
    ventana_maxima_180d  = @hace7 + ' → ' + @mas173;

IF @med IS NULL OR @hist IS NULL
    THROW 50001, 'No se encontraron citas en los últimos 30 días en PRUEBAS: la copia está vieja y la medición no sería representativa. Avisar antes de continuar.', 1;

/* -----------------------------------------------------------------------------
   PARTE E — LA MEDICIÓN  (login del DBA; también se puede con agenia_sync)
   Cada consulta se ejecuta DOS veces: la 1ª puede encontrar páginas en disco,
   la 2ª ya en caché. Se usa sp_executesql con los MISMOS tipos de parámetro que
   manda el agente: con variables locales el motor estima distinto y el plan no
   sería el que corre en producción.
   -------------------------------------------------------------------------- */
PRINT '';
PRINT '=== PARTE E — medición (mirar también la pestaña Messages) ===';

DECLARE @resultado TABLE (
    orden        int identity,
    consulta     varchar(40),
    ventana      varchar(24),
    corrida      varchar(10),
    filas        int,
    milisegundos int
);
DECLARE @t datetime2(7), @filas int;

/* --- E.1  POR CUPO (debe ser un Seek por la PK: médico + hora) --------------- */
DECLARE @sqlCupo nvarchar(max) = N'
        SELECT TOP (@tope)
               CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
               CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist
          FROM dbo.CITAS_MEDICAS
         WHERE CD_CODI_MED_CIT = @med AND FE_HORA_CIT = @hora';
DECLARE @parsCupo nvarchar(200) = N'@med varchar(4), @hora varchar(18), @tope int';

SET STATISTICS IO, TIME ON;
PRINT '--- E.1 por cupo, corrida 1 ---';
SET @t = SYSDATETIME();
EXEC sp_executesql @sqlCupo, @parsCupo, @med = @med, @hora = @hora, @tope = 11;
SET @filas = @@ROWCOUNT;
SET STATISTICS IO, TIME OFF;
INSERT @resultado VALUES ('Por cupo', '—', '1a', @filas, DATEDIFF(millisecond, @t, SYSDATETIME()));

SET STATISTICS IO, TIME ON;
PRINT '--- E.1 por cupo, corrida 2 ---';
SET @t = SYSDATETIME();
EXEC sp_executesql @sqlCupo, @parsCupo, @med = @med, @hora = @hora, @tope = 11;
SET @filas = @@ROWCOUNT;
SET STATISTICS IO, TIME OFF;
INSERT @resultado VALUES ('Por cupo', '—', '2a', @filas, DATEDIFF(millisecond, @t, SYSDATETIME()));

/* --- E.2  POR DOCUMENTO, tres ventanas y el peor caso ----------------------- */
DECLARE @sqlDoc nvarchar(max) = N'
        SELECT TOP (@tope)
               CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
               CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist
          FROM dbo.CITAS_MEDICAS
         WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
           AND NU_HIST_PAC_CIT IN (@hist0, @hist1)
         ORDER BY FE_FECH_CIT, FE_HORA_CIT';
DECLARE @parsDoc nvarchar(300) =
    N'@desde varchar(8), @hasta varchar(8), @hist0 varchar(20), @hist1 varchar(20), @tope int';

DECLARE @i int = 1, @etiqueta varchar(24), @desde char(8), @hasta char(8),
        @h0 varchar(20), @h1 varchar(20), @corrida int;

WHILE @i <= 4
BEGIN
    SELECT @etiqueta = CASE @i WHEN 1 THEN '7 d'
                               WHEN 2 THEN '67 d (por defecto)'
                               WHEN 3 THEN '180 d (máxima)'
                               ELSE '180 d SIN citas' END,
           @desde    = @hace7,
           @hasta    = CASE @i WHEN 1 THEN @hoy WHEN 2 THEN @mas60 ELSE @mas173 END,
           @h0       = CASE @i WHEN 4 THEN @histInexistente ELSE @hist END,
           /* En el peor caso los DOS documentos tienen que ser inexistentes: con uno
              real la consulta encuentra citas y el TOP puede cortar antes. */
           @h1       = CASE @i WHEN 4 THEN @histInexistente + '0' ELSE @hist2 END;

    SET @corrida = 1;
    WHILE @corrida <= 2
    BEGIN
        SET STATISTICS IO, TIME ON;
        PRINT '--- E.2 por documento, ' + @etiqueta + ', corrida ' + CAST(@corrida AS varchar(2)) + ' ---';
        SET @t = SYSDATETIME();
        EXEC sp_executesql @sqlDoc, @parsDoc,
             @desde = @desde, @hasta = @hasta, @hist0 = @h0, @hist1 = @h1, @tope = 51;
        SET @filas = @@ROWCOUNT;
        SET STATISTICS IO, TIME OFF;
        INSERT @resultado
        VALUES ('Por documento', @etiqueta, CAST(@corrida AS varchar(2)) + 'a', @filas,
                DATEDIFF(millisecond, @t, SYSDATETIME()));
        SET @corrida += 1;
    END;
    SET @i += 1;
END;

PRINT '';
PRINT '=== RESUMEN (copiar esta tabla) ===';
SELECT consulta, ventana, corrida, filas_devueltas = filas, milisegundos
FROM @resultado ORDER BY orden;
GO

/* -----------------------------------------------------------------------------
   PARTE F — QUÉ PLAN USÓ Y CUÁNTO LEYÓ  (login del DBA; necesita VIEW SERVER STATE)
   ⚠️ Los contadores de estas vistas son ACUMULADOS desde que el plan entró a la
      caché: si `ejecuciones` sale mayor que 10, incluye corridas anteriores (el
      promedio sigue siendo válido). NO se limpian con `DBCC FREEPROCCACHE`: eso
      borraría la caché de planes de TODA la instancia, incluida la aplicación del
      hospital. Las cifras por ejecución exactas están en la pestaña Messages.
   Contesta sin leer el plan gráfico: ¿Seek o Scan sobre FE_FECH_CIT? ¿hay Key
   Lookup? ¿cuántas lecturas lógicas por ejecución? Si el login no tiene permiso
   para los DMV, este bloque falla: con la pestaña Messages de la PARTE E basta.
   -------------------------------------------------------------------------- */
PRINT '';
PRINT '=== PARTE F — plan y lecturas de las consultas medidas ===';

BEGIN TRY
    SELECT
        consulta = CASE WHEN st.text LIKE '%CD_CODI_MED_CIT = @med%' THEN 'Por cupo'
                        WHEN st.text LIKE '%FE_FECH_CIT >= @desde%' THEN 'Por documento'
                        ELSE 'otra' END,
        ejecuciones          = qs.execution_count,
        lecturas_logicas_total = qs.total_logical_reads,
        lecturas_logicas_prom = qs.total_logical_reads / NULLIF(qs.execution_count, 0),
        lecturas_fisicas_prom = qs.total_physical_reads / NULLIF(qs.execution_count, 0),
        cpu_ms_prom          = qs.total_worker_time / NULLIF(qs.execution_count, 0) / 1000,
        elapsed_ms_prom      = qs.total_elapsed_time / NULLIF(qs.execution_count, 0) / 1000,
        elapsed_ms_max       = qs.max_elapsed_time / 1000,
        operadores           = STUFF((
            SELECT DISTINCT ', ' + op.value('@PhysicalOp', 'varchar(60)')
            FROM qp.query_plan.nodes(
                'declare default element namespace "http://schemas.microsoft.com/sqlserver/2004/07/showplan";
                 //RelOp') AS n(op)
            FOR XML PATH(''), TYPE).value('.', 'varchar(max)'), 1, 2, ''),
        texto                = LEFT(st.text, 200)
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
    OUTER APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
    /* SOLO las dos consultas parametrizadas (cada `sp_executesql` tiene su propia
       entrada en la caché). El lote de este script contiene los dos textos como
       literales, así que hay que excluirlo o se reportaría a sí mismo. */
    WHERE st.text LIKE '%SELECT TOP (@tope)%'
      AND st.text NOT LIKE '%sp_executesql%'
      AND st.text NOT LIKE '%@resultado%'
    ORDER BY consulta, lecturas_logicas_prom DESC;
END TRY
BEGIN CATCH
    PRINT '   (sin permiso para los DMV: ' + ERROR_MESSAGE() + ')';
    PRINT '   → basta con la pestaña Messages de la PARTE E.';
END CATCH;
GO

/* -----------------------------------------------------------------------------
   PARTE G — LO QUE LA PRIMERA MEDICIÓN DESTAPÓ  (login del DBA)
   Se agregó DESPUÉS de la primera corrida (2026-09-20), que dejó dos cosas
   pendientes de cuantificar:

   G.1 ¿CUÁNTAS CITAS FUTURAS TIENEN UNA HORA QUE NO SE PUEDE INTERPRETAR?
       `MAPEO_HIS.md` §2.1 ya documentó que parte de `FE_HORA_CIT` no cumple
       'YYYY/MM/DD HH:MM' (se vieron valores como '2026/08/29 1' y '31'), y la
       primera corrida de este script se topó con uno ('2026/09/19 3'). Para la
       consulta en vivo eso importa mucho más que para el resto del espejo: la
       consulta POR CUPO compara la hora con `=`, así que una cita guardada con
       una hora ilegible NO se encuentra, y la pantalla concluiría «el HIS no
       tiene ninguna cita en ese cupo» — un falso negativo, justo el error que la
       pantalla existe para evitar. Este bloque mide el tamaño del problema en la
       ventana que la consulta usa de verdad (las citas FUTURAS).

   G.2 EL PEOR CASO DE COSTO NO ERA EL QUE SE MIDIÓ. La PARTE E supuso que sin
       citas había que recorrer el rango de fechas; los números mostraron que el
       motor busca por `NU_HIST_PAC_CIT` (hay índices propios), así que «sin
       citas» es el caso más BARATO. El verdadero peor caso es un paciente con
       una historia LARGA: el motor lee todas sus citas y descarta por fecha.
   -------------------------------------------------------------------------- */
PRINT '';
PRINT '=== PARTE G — horas ilegibles y el peor caso real ===';

DECLARE @gDesde char(8) = CONVERT(char(8), DATEADD(day,  -7, SYSDATETIME()), 112);
DECLARE @gHasta char(8) = CONVERT(char(8), DATEADD(day, 174, SYSDATETIME()), 112);

/* G.1 — cuántas y de qué forma. Acotado a la ventana de la consulta. */
SELECT
    ventana            = @gDesde + ' → ' + @gHasta,
    citas_en_ventana   = COUNT(*),
    hora_ilegible      = SUM(CASE WHEN FE_HORA_CIT NOT LIKE
                             '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9] [0-9][0-9]:[0-9][0-9]'
                             THEN 1 ELSE 0 END),
    porcentaje         = CAST(100.0 * SUM(CASE WHEN FE_HORA_CIT NOT LIKE
                             '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9] [0-9][0-9]:[0-9][0-9]'
                             THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS decimal(5,2))
FROM dbo.CITAS_MEDICAS WITH (NOLOCK)
WHERE FE_FECH_CIT >= @gDesde AND FE_FECH_CIT < @gHasta;

/* Las formas concretas, por longitud. SIN datos de pacientes: no se devuelve
   NU_HIST_PAC_CIT (es el documento) — solo médico, fecha y la hora cruda. */
SELECT TOP (20)
    longitud  = LEN(FE_HORA_CIT),
    cuantas   = COUNT(*),
    ejemplo_1 = MIN(FE_HORA_CIT),
    ejemplo_2 = MAX(FE_HORA_CIT)
FROM dbo.CITAS_MEDICAS WITH (NOLOCK)
WHERE FE_FECH_CIT >= @gDesde AND FE_FECH_CIT < @gHasta
  AND FE_HORA_CIT NOT LIKE '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9] [0-9][0-9]:[0-9][0-9]'
GROUP BY LEN(FE_HORA_CIT)
ORDER BY cuantas DESC;

/* ¿Se concentran en unos pocos médicos o están repartidas? Si se concentran,
   puede ser una forma de trabajo de un servicio concreto. */
SELECT TOP (10)
    medico            = CD_CODI_MED_CIT,
    citas_ilegibles   = COUNT(*),
    ejemplo_hora      = MIN(FE_HORA_CIT)
FROM dbo.CITAS_MEDICAS WITH (NOLOCK)
WHERE FE_FECH_CIT >= @gDesde AND FE_FECH_CIT < @gHasta
  AND FE_HORA_CIT NOT LIKE '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9] [0-9][0-9]:[0-9][0-9]'
GROUP BY CD_CODI_MED_CIT
ORDER BY citas_ilegibles DESC;

/* G.2 — el paciente con la historia más larga = el peor caso real de costo.
   ⚠️ Es la ÚNICA consulta del script que recorre toda la tabla, y lo hace sobre
   un índice angosto (el de NU_HIST_PAC_CIT), no sobre los datos. Correrla en el
   laboratorio y fuera de hora pico. */
DECLARE @histLargo varchar(20), @citasDelHist int;
SELECT TOP (1) @histLargo = NU_HIST_PAC_CIT, @citasDelHist = COUNT(*)
FROM dbo.CITAS_MEDICAS WITH (NOLOCK)
WHERE NU_HIST_PAC_CIT IS NOT NULL
GROUP BY NU_HIST_PAC_CIT
ORDER BY COUNT(*) DESC;

SELECT
    historia_mas_larga_citas = @citasDelHist,
    nota = 'Es el techo del costo: el motor lee las citas de ese documento y descarta por fecha.';

/* La misma consulta del agente, con ese documento y la ventana máxima. */
DECLARE @sqlG nvarchar(max) = N'
        SELECT TOP (@tope)
               CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
               CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist
          FROM dbo.CITAS_MEDICAS
         WHERE FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta
           AND NU_HIST_PAC_CIT IN (@hist0, @hist1)
         ORDER BY FE_FECH_CIT, FE_HORA_CIT';

SET STATISTICS IO, TIME ON;
PRINT '--- G.2 por documento, 180 d, la historia MÁS LARGA (peor caso real) ---';
EXEC sp_executesql @sqlG,
     N'@desde varchar(8), @hasta varchar(8), @hist0 varchar(20), @hist1 varchar(20), @tope int',
     @desde = @gDesde, @hasta = @gHasta, @hist0 = @histLargo, @hist1 = @histLargo, @tope = 51;
SET STATISTICS IO, TIME OFF;
GO

/* =============================================================================
   CÓMO SE LEE EL RESULTADO (umbrales propuestos, a confirmar con el DBA)

     · Por cupo:                    < 100 ms y unas pocas lecturas lógicas.
                                    Debe ser Clustered Index Seek / Index Seek.
     · Por documento, 67 d:         < 3 s. Es la ventana por defecto.
     · Por documento, 180 d SIN citas: es el PEOR CASO y el que decide. Si aquí
                                    aparecen decenas de miles de lecturas
                                    lógicas o segundos de CPU, la consulta por
                                    documento no debe encenderse tal cual.

   MIRAR LAS LECTURAS LÓGICAS, NO LOS MILISEGUNDOS: con la tabla en caché los
   tiempos salen en pocos ms y engañan; las lecturas lógicas no dependen de la
   caché. Dos señales concretas que hay que buscar en la columna `operadores`:

     · Si aparece un SCAN del índice agrupado (no un Seek) y las lecturas lógicas
       son parecidas en las tres ventanas, el motor está recorriendo la tabla
       COMPLETA y el tamaño de la ventana da igual: acortarla no arreglaría nada.
       (Es lo que pasó en el ensayo local de este script, con una copia pequeña;
       el hospital tiene una tabla 18 veces más grande y puede decidir distinto —
       de ahí que haya que medirlo allá y no suponerlo.)
     · Si aparece `Parallelism`, el plan usa varios núcleos: el CPU que marca
       STATISTICS TIME se reparte entre ellos y en una instancia ocupada como la
       del hospital ese consumo pesa más de lo que sugiere el tiempo transcurrido.

   SEGÚN LO QUE SALGA:
     · Todo dentro de los umbrales → se enciende `lookupEnabled` por clínica
       (ver CONSULTA_EN_VIVO.md, «Encender y apagar»).
     · La de 67 d no cabe → se acorta la ventana por defecto
       (`ventanaPorDocumento`, apps/web/lib/rastreo/consulta-his.ts).
     · Ni la de 7 d cabe → se deja SOLO la consulta por cupo (`incluirPorDocumento`)
       y se le propone al hospital un índice por `NU_HIST_PAC_CIT`.
     · Aparece un Key Lookup o un Scan donde se esperaba un Seek → antes de tocar
       nuestras ventanas, revisar si algún índice necesita INCLUDE
       (`NU_HIST_PAC_CIT`): puede ser una mejora barata para el hospital.

   -----------------------------------------------------------------------------
   OPCIONAL — MEDICIÓN EN FRÍO DE VERDAD, sin afectar al hospital.
   Solo con el visto bueno del DBA y sin nadie usando PRUEBAS. Vacía la caché
   ÚNICAMENTE de esta base (a diferencia de DBCC DROPCLEANBUFFERS, que vaciaría
   la de ESEHSVP y volvería lenta la aplicación del hospital):

       -- USE master;
       -- ALTER DATABASE PRUEBAS SET OFFLINE WITH ROLLBACK IMMEDIATE;
       -- ALTER DATABASE PRUEBAS SET ONLINE;
       -- luego repetir la PARTE E: la corrida «1a» es ahora de verdad en frío.

   FALTA ADEMÁS, y NO se puede medir con SQL (necesita el agente corriendo):
     · Concurrencia: 5 consultas por documento a la vez mientras el hospital
       agenda, comprobando que no se degradan sus inserciones. Se hace abriendo
       5 ventanas de SSMS con la PARTE E, o en la ronda del agente.
     · Cancelación por tiempo agotado: que la consulta desaparezca de
       sys.dm_exec_requests cuando el agente la cancela a los 10 s. Es una
       prueba del agente, no del SQL.
   ============================================================================= */

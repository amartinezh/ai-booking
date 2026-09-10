-- =============================================================================
-- ¿DÓNDE GUARDA EL HIS EL PADRÓN / LA VALIDACIÓN DE DERECHOS?
--
-- Pregunta que responde este archivo: cuando la agendadora agenda una cita en
-- el sistema del hospital, ALGO le dice que ese paciente está activo en esa EPS
-- y con qué régimen —porque de ahí sale el convenio que se factura—. Queremos
-- saber QUÉ es ese algo, y si el padrón que el hospital sube cada mes aterriza
-- en alguna tabla que el agente del VPS pueda leer.
--
-- Por qué hace falta: `R_PAC_EPS` NO sirve para eso, y ya está medido (D.6 de
-- PENDIENTE_CORRER_EN_HOSPITAL.sql): 443.034 filas, 376.865 marcadas vigentes
-- (NU_ESTA_RPE=1, TX_ACTI_RPE='S') sobre 78.654 pacientes = ~4,8 afiliaciones
-- VIGENTES por paciente, y la consulta de "pacientes con una sola afiliación"
-- devolvió CERO filas. Además la tabla no tiene NINGUNA columna de fecha, así
-- que tampoco se puede "quedarse con la más reciente". Es un historial
-- acumulativo, no un estado.
--
-- Y el margen de búsqueda es grande: `dbo` tiene 1.393 tablas y la Fase 0 solo
-- mapeó 14. El padrón puede estar en cualquiera de las otras 1.379.
--
--   · TODO ES 100 % LECTURA sobre las tablas del HIS. Ni un INSERT, ni un
--     UPDATE, ni un DELETE sobre sus datos. La ÚNICA excepción declarada es
--     P.8b, que crea una tabla #temporal en tempdb (no toca el HIS) y está
--     marcada como opcional.
--   · ⚠️ EMPIEZA CON EL `USE ESEHSVP` DE ABAJO. Sin él SSMS corre todo contra
--     `master` y falla con "El nombre de objeto 'dbo.R_PAC_EPS' no es válido"
--     (pasó el 2026-09-10). PRUEBAS sirve para la estructura, pero los conteos
--     y las huellas de carga solo valen en producción.
--   · Las consultas a msdb, ReportServer2019 y las copias anuales van
--     calificadas con el nombre de la base, así que funcionan igual.
--   · Cada sección termina en `GO`. Es deliberado: un error de "objeto no
--     válido" aborta SU LOTE, no el archivo entero. Se puede ejecutar todo de
--     una (F5) y leer los errores al final sin perder los resultados buenos.
--
-- LO QUE PUEDE FALLAR SIN QUE SEA UN DAÑO (todo esto es esperable)
--   · P.3b–P.3e fallan con "objeto no válido" si `R_PAC_CONV` no existe.
--     Correr P.3a primero: si devuelve 0 filas, la tabla no está y se salta
--     el resto de P.3.
--   · P.9 necesita permisos sobre msdb (probablemente TI, no agenia_sync), y
--     `sysssispackages` saldrá vacía: SSIS no corre sobre SQL Server Linux.
--   · P.11 necesita permisos sobre ESEHSVP2024/ESEHSVP2025.
--   · P.12 necesita permisos sobre ReportServer2019.
--   · ⚠️ El login `agenia_sync` NO tiene GRANT sobre `R_PAC_CONV`,
--     ESEHSVP2024/2025 ni ReportServer2019 (verificado 2026-09-10). Estas
--     consultas hay que correrlas con una cuenta administradora. Si P.3
--     resulta que R_PAC_CONV es la tabla de validación, habrá que agregar
--     `GRANT SELECT ON dbo.R_PAC_CONV TO agenia_sync;` al setup.
--   · P.9 (jobs, SSIS) necesita permisos sobre msdb: probablemente lo tenga
--     que correr TI, no el login agenia_sync.
--   · En SSMS: clic derecho sobre la cuadrícula → "Copy with Headers" y pegar
--     el resultado completo debajo de cada consulta. Casi todas devuelven
--     pocas filas a propósito.
--
-- ORDEN DE LECTURA (de lo más decisivo a lo más exploratorio)
--   P.0  Contexto: versión, bases de datos, tamaño de la instancia.
--   P.1  🔑 ¿El carné del padrón de Salud Total ya está dentro del HIS?
--   P.2  🔑 Reconciliación real: 15 personas del padrón contra PACIENTES.
--   P.3  🔑 ¿`R_PAC_CONV` es la tabla que valida al agendar?
--   P.4  Cuántos pacientes tiene cada EPS según el HIS (la magnitud).
--   P.5  Barrido por NOMBRE DE TABLA en las 1.393.
--   P.6  Barrido por NOMBRE DE COLUMNA (más potente que el anterior).
--   P.7  Huellas de carga masiva: qué tabla se escribió último y cuánto pesa.
--   P.8  Código del producto: procedimientos/vistas que mencionen el padrón.
--   P.9  Jobs, SSIS, servidores vinculados: por dónde ENTRA el archivo.
--   P.10 Lo que PACIENTES ya sabe (IPS primaria, nivel, copago, estado).
--   P.11 🔑 ¿Crece `R_PAC_EPS` año contra año? (copias ESEHSVP2024/2025)
--   P.12 SSRS: el catálogo de reportes y el SQL que hay dentro de ellos.
--
-- CONTEXTO DEL SERVIDOR (confirmado el 2026-09-10 con P.0)
--   SQL Server 2017 Standard (14.0.3465.1) sobre **Linux** (Ubuntu 18.04).
--   · 2017 ⇒ STRING_AGG disponible; el archivo usa FOR XML PATH, que también
--     sirve. No hace falta cambiar nada.
--   · Linux ⇒ SSIS casi con seguridad NO está en uso: si P.9b sale vacía, es
--     lo esperado, no un fallo. Y un BULK INSERT tendría que leer una ruta
--     LOCAL del servidor Linux, no un recurso compartido de Windows — lo que
--     hace menos probable que el padrón entre por SQL y más probable que
--     entre por la aplicación cliente.
--   · Bases de la instancia: AGENIA_SYNC (la nuestra, creada 2026-09-07),
--     ESEHSVP (viva, SIMPLE), ESEHSVP2024 / ESEHSVP2025 (copias anuales),
--     ESEHSVPREGALIAS, HSVPInvAnt, Presupuesto20, PRESUPUESTO2026, PRUEBAS,
--     PRUEBAS_ACTIVOS, ReportServer2019 (+TempDB).
--     ⇒ NO existe ninguna base con nombre de padrón/BDUA/afiliados: si el
--       padrón está, está DENTRO de ESEHSVP.
--     ⇒ Hay **SSRS instalado** (ReportServer2019). Nueva vía: P.12.
--   · ⚠️ El servicio se reinició el 2026-09-09 01:43 (fecha de tempdb). Eso
--     VACIÓ `sys.dm_db_index_usage_stats`, así que **P.7b solo ve escrituras
--     de las últimas horas** y no puede mostrar la carga mensual del padrón
--     (los cortes son del 10 y 19 de agosto). Para esta corrida, P.7b no
--     sirve: apoyarse en P.7a (tamaños), P.5, P.6 y P.11.
-- =============================================================================


-- ⚠️⚠️ OBLIGATORIO: sin esto, todo corre contra `master` y falla.
USE ESEHSVP;
GO

-- Lectura sucia a propósito. Esto se corre contra PRODUCCIÓN en horario de
-- agenda, y varias consultas recorren tablas completas (`R_PAC_EPS` tiene
-- 443.034 filas). Con READ UNCOMMITTED no se piden bloqueos compartidos, así
-- que es imposible frenar aunque sea un instante a quien está agendando en el
-- mostrador. La contrapartida —poder leer una fila a medio escribir— no afecta
-- a nada de este archivo: son conteos y búsquedas de estructura, no cifras
-- para facturar. Los SQL de Fase 0 no lo usaban; se agrega aquí porque este
-- archivo escanea mucho más.
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

-- ⭐ CÓMO SACAR TODO EN UN SOLO TEXTO PARA COPIAR Y PEGAR
--   1. En SSMS: Ctrl+T  (menú Consulta → "Resultados en texto"). Con esto TODOS
--      los resultados y los rótulos PRINT caen en un solo panel de texto, en
--      orden, en vez de 39 cuadrículas separadas.
--   2. Antes de correr, ampliar el ancho de columna: Herramientas → Opciones →
--      Resultados de consultas → SQL Server → Resultados en texto →
--      "Número máximo de caracteres por columna" = 8192 (viene en 256 y
--      recortaría la columna `cuales` de P.6 y las rutas de P.12).
--   3. F5, y al terminar: clic en el panel de texto → Ctrl+A → Ctrl+C.
--   4. Para volver a cuadrículas: Ctrl+D.
--
--   Alternativa sin SSMS, deja un archivo listo para adjuntar:
--     sqlcmd -S 192.168.1.16 -U <usuario> -P <clave> -d ESEHSVP ^
--            -i PADRON_DESCUBRIMIENTO.sql -o padron_resultados.txt -W -w 8192 -s "|"
--
-- Cada consulta va precedida de un PRINT con su número y su nombre, así que el
-- texto pegado se puede leer sin adivinar qué resultado es cuál.
PRINT N'';
PRINT N'##############################################################';
PRINT N'#  PADRON_DESCUBRIMIENTO.sql — Hospital San Vicente de Paul   #';
PRINT N'##############################################################';
PRINT N'';
GO

-- =============================================================================
-- P.0 — CONTEXTO DE LA INSTANCIA
-- Para qué: saber qué sintaxis podemos usar (STRING_AGG existe desde 2017) y
-- si el padrón puede estar en OTRA base de datos de la misma instancia.
-- =============================================================================

PRINT N'';
PRINT N'===== [01] P.0 · Version y edicion del servidor =====';
SELECT  @@VERSION                                        AS version_completa,
        SERVERPROPERTY('ProductMajorVersion')            AS version_mayor,
        SERVERPROPERTY('Edition')                        AS edicion,
        DB_NAME()                                        AS bd_actual;

-- Todas las bases de la instancia. Si aparece alguna con nombre tipo
-- BDUA / AFILIADOS / CAPITA / TERCEROS, ese es el primer lugar donde mirar.
PRINT N'';
PRINT N'===== [02] P.0 · Bases de datos de la instancia =====';
SELECT  d.name                                           AS base_de_datos,
        d.state_desc                                     AS estado,
        d.create_date                                    AS creada,
        d.recovery_model_desc                            AS modelo,
        HAS_DBACCESS(d.name)                             AS tengo_acceso
FROM sys.databases d
ORDER BY d.name;

-- Cuántas tablas hay por esquema (confirma las 1.393 de dbo y si hay otros).
PRINT N'';
PRINT N'===== [03] P.0 · Tablas por esquema =====';
SELECT  s.name                                           AS esquema,
        COUNT(*)                                         AS tablas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
GROUP BY s.name
ORDER BY tablas DESC;

GO

-- =============================================================================
-- P.1 — 🔑 ¿EL CARNÉ DEL PADRÓN YA ESTÁ DENTRO DEL HIS?
--
-- La prueba decisiva y más barata de todo el archivo.
--
-- El padrón de Salud Total trae una columna `Contrato_Medicard` que es el
-- documento + un dígito (ej. documento 10000702 → 100007020). `R_PAC_EPS`
-- tiene `CD_CARN_RPE varchar(18)`, que es el número de carné.
--
-- Si esos valores exactos aparecen en CD_CARN_RPE, entonces el padrón (o algo
-- derivado de él) SÍ se está cargando al HIS, y el rastro está en esa tabla.
-- Si no aparece ninguno, el padrón no entra por ahí.
-- =============================================================================

-- (P.1a) Los seis carnés textuales del archivo de Salud Total del 10-ago-2026.
PRINT N'';
PRINT N'===== [04] P.1a · Los seis carnés textuales del archivo de Salud Total del 10-ago-2026 =====';
SELECT  r.NU_HIST_PAC_RPE   AS historia_paciente,
        r.CD_NIT_EPS_RPE    AS nit_eps,
        r.CD_CODI_REG_RPE   AS regimen,
        r.CD_CARN_RPE       AS carne,
        r.NU_AFIL_RPE       AS tipo_afiliado,
        r.NU_ESTA_RPE       AS estado,
        r.TX_ACTI_RPE       AS activo,
        r.CD_POL_RPE        AS poliza
FROM dbo.R_PAC_EPS r
WHERE r.CD_CARN_RPE IN (
        '100007020',    -- doc 10000702
        '10001253900',  -- doc 1000125390
        '100025110',    -- doc 10002511
        '10003080340',  -- doc 1000308034
        '100046070',    -- doc 10004607
        '100186500'     -- doc 10018650
      );

-- (P.1b) Y en general: ¿qué proporción de los carnés del HIS es "documento+0"?
-- Si es alta, es la firma de una carga masiva desde un padrón con ese formato.
PRINT N'';
PRINT N'===== [05] P.1b · Y en general: ¿qué proporción de los carnés del HIS es "documento+0"? =====';
SELECT  COUNT(*)                                                     AS filas_totales,
        SUM(CASE WHEN r.CD_CARN_RPE IS NULL OR r.CD_CARN_RPE = ''
                 THEN 1 ELSE 0 END)                                  AS sin_carne,
        SUM(CASE WHEN r.CD_CARN_RPE = r.NU_HIST_PAC_RPE + '0'
                 THEN 1 ELSE 0 END)                                  AS carne_es_doc_mas_cero,
        SUM(CASE WHEN r.CD_CARN_RPE = r.NU_HIST_PAC_RPE
                 THEN 1 ELSE 0 END)                                  AS carne_igual_a_doc
FROM dbo.R_PAC_EPS r;

-- (P.1c) Muestra de 20 carnés para ver el formato con los propios ojos.
PRINT N'';
PRINT N'===== [06] P.1c · Muestra de 20 carnés para ver el formato con los propios ojos =====';
SELECT TOP 20
        r.NU_HIST_PAC_RPE   AS historia,
        r.CD_NIT_EPS_RPE    AS nit_eps,
        r.CD_CODI_REG_RPE   AS regimen,
        r.CD_CARN_RPE       AS carne,
        r.NU_AFIL_RPE       AS tipo_afiliado,
        r.CD_POL_RPE        AS poliza
FROM dbo.R_PAC_EPS r
WHERE r.CD_CARN_RPE IS NOT NULL AND r.CD_CARN_RPE <> ''
ORDER BY r.NU_HIST_PAC_RPE DESC;

GO

-- =============================================================================
-- P.2 — 🔑 RECONCILIACIÓN REAL: 15 PERSONAS DEL PADRÓN CONTRA `PACIENTES`
--
-- Estas 15 filas salen textualmente de los dos CSV que entregó el hospital
-- (Salud Total 10-08-2026 y Suramericana 19-08-2026). Responde de un golpe
-- cuatro preguntas que hoy son suposiciones:
--
--   1. ¿Existe en el HIS quien está en el padrón? (los que salgan sin
--      historia son afiliados que el HIS no conoce → el bot tendría que
--      crearlos, y el padrón ya trae todo lo que PACIENTES exige NOT NULL)
--   2. ¿Coincide la FECHA DE NACIMIENTO? (el CSV de Salud Total viene en
--      MM/DD/AAAA y el de Sura en DD/MM/AAAA — aquí se ve quién tiene razón)
--   3. ¿Coincide el TIPO DE DOCUMENTO? (esperado: CC=0, TI=1, RC=2. El driver
--      hoy escribe 0 fijo; cuatro de estas filas son Registro Civil)
--   4. ¿Coincide el SEXO? (mapping.json: M=1, F=0)
--
-- El JOIN es solo por documento (dígitos puros): los nombres van como
-- literales de referencia para comparar a ojo, nunca en la condición.
-- =============================================================================

PRINT N'';
PRINT N'===== [07] P.2 · RECONCILIACIÓN REAL: 15 PERSONAS DEL PADRÓN CONTRA `PACIENTES` =====';
SELECT  v.documento,
        v.eps_del_padron,
        v.tipo_doc_padron,
        v.nombre_padron,
        CASE WHEN p.NU_HIST_PAC IS NULL
             THEN 'NO EXISTE EN EL HIS' ELSE 'existe' END             AS en_pacientes,
        p.NO_NOMB_PAC     AS his_primer_nombre,
        p.NO_SGNO_PAC     AS his_segundo_nombre,
        p.DE_PRAP_PAC     AS his_primer_apellido,
        p.DE_SGAP_PAC     AS his_segundo_apellido,
        CAST(p.FE_NACI_PAC AS date)                                   AS his_fecha_nac,
        v.fnac_padron,
        CASE WHEN p.NU_HIST_PAC IS NULL THEN NULL
             WHEN CAST(p.FE_NACI_PAC AS date) = v.fnac_padron THEN 'ok'
             ELSE '>>> DIFIERE' END                                   AS cmp_fecha_nac,
        p.NU_TIPD_PAC     AS his_tipo_doc,
        v.tipo_doc_esperado,
        CASE WHEN p.NU_HIST_PAC IS NULL THEN NULL
             WHEN p.NU_TIPD_PAC = v.tipo_doc_esperado THEN 'ok'
             ELSE '>>> DIFIERE' END                                   AS cmp_tipo_doc,
        p.NU_SEXO_PAC     AS his_sexo,
        v.sexo_esperado,
        CASE WHEN p.NU_HIST_PAC IS NULL THEN NULL
             WHEN p.NU_SEXO_PAC = v.sexo_esperado THEN 'ok'
             ELSE '>>> DIFIERE' END                                   AS cmp_sexo,
        p.DE_TELE_PAC     AS his_telefono,
        v.movil_padron,
        p.DE_DIRE_PAC     AS his_direccion,
        p.NU_IPSPRIMARIA_PAC AS his_ips_primaria,
        p.NU_ESTA_PAC     AS his_estado_paciente,
        p.FE_HIST_PAC     AS his_apertura_historia
FROM (VALUES
    -- documento | EPS | tipo doc (texto del padrón) | tipo esperado | sexo esp. | nombre | fecha nac | móvil
    ('10000702',  'Salud Total','CEDULA DE CIUDADANIA',      0, 1, N'FEDERMAN MARULANDA OSSA',        CAST('1974-01-20' AS date), '3206961849'),
    ('1000125390','Salud Total','CEDULA DE CIUDADANIA',      0, 0, N'YULEY BETANCUR ARICAPA',         CAST('2002-03-11' AS date), '3105226861'),
    ('10002511',  'Salud Total','CEDULA DE CIUDADANIA',      0, 1, N'ARMANDO SANCHEZ LOPERA',         CAST('1977-06-01' AS date), '3023570178'),
    ('1000308034','Salud Total','CEDULA DE CIUDADANIA',      0, 1, N'JONATAN STIVEN QUINTERO GUZMAN', CAST('1999-02-15' AS date), '3043588749'),
    ('10018650',  'Salud Total','CEDULA DE CIUDADANIA',      0, 1, N'CARLOS EDUARDO BENITEZ VILLA',   CAST('1973-09-12' AS date), NULL),
    ('1002593948','Salud Total','CEDULA DE CIUDADANIA',      0, 1, N'EDWIN ADOLFO SANCHEZ CATANO',    CAST('1999-12-22' AS date), NULL),
    ('1002594089','Salud Total','CEDULA DE CIUDADANIA',      0, 0, N'LUISA FERNANDA CARDONA LOPEZ',   CAST('2000-01-08' AS date), '3127053981'),
    ('18461307',  'Sura',       'Cedula de Ciudadania',      0, 1, N'JOSE AQUILEO GONZALEZ VARGAS',   CAST('1961-04-20' AS date), NULL),
    ('3512461',   'Sura',       'Cedula de Ciudadania',      0, 1, N'JESUS ANTONIO RESTREPO SANCHEZ', CAST('1948-11-15' AS date), NULL),
    ('1128282352','Sura',       'Cedula de Ciudadania',      0, 0, N'YULIETH ALEXANDRA TREJOS DIAZ',  CAST('1990-02-19' AS date), NULL),
    ('1036691454','Sura',       'Registro Civil',            2, 0, N'JANNA MELEK TAPASCO MELCHOR',    CAST('2020-11-12' AS date), NULL),
    ('1054927690','Sura',       'Registro Civil',            2, 1, N'AUSTIN SMITH CASTRILLON RODRIGUEZ', CAST('2022-09-08' AS date), NULL),
    ('1054927743','Sura',       'Registro Civil',            2, 1, N'STEVEN RENDON MONCADA',          CAST('2023-04-26' AS date), NULL),
    ('1059713771','Sura',       'Tarjeta de Identificacion', 1, 0, N'DANNA SARAY TAPASCO MELCHOR',    CAST('2017-10-28' AS date), NULL),
    ('1031143075','Sura',       'Tarjeta de Identificacion', 1, 1, N'JUAN FELIPE GRAJALES VARGAS',    CAST('2010-11-26' AS date), NULL)
) AS v (documento, eps_del_padron, tipo_doc_padron, tipo_doc_esperado, sexo_esperado, nombre_padron, fnac_padron, movil_padron)
LEFT JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = v.documento
ORDER BY v.eps_del_padron, v.documento;

-- (P.2b) Para los mismos 15: TODAS sus filas de afiliación en R_PAC_EPS.
-- Aquí se va a ver el fan-out con nombre propio: cuántas EPS "vigentes" tiene
-- cada uno, y si alguna coincide con la EPS que dice el padrón.
PRINT N'';
PRINT N'===== [08] P.2b · Para los mismos 15: TODAS sus filas de afiliación en R_PAC_EPS =====';
SELECT  v.documento,
        v.eps_del_padron,
        r.CD_NIT_EPS_RPE   AS nit_eps_his,
        e.NO_NOMB_EPS      AS eps_his,
        r.CD_CODI_REG_RPE  AS regimen_his,
        r.NU_AFIL_RPE      AS tipo_afiliado,
        r.NU_ESTA_RPE      AS estado,
        r.TX_ACTI_RPE      AS activo,
        r.CD_CARN_RPE      AS carne,
        r.CD_POL_RPE       AS poliza
FROM (VALUES
    ('10000702','Salud Total'),('1000125390','Salud Total'),('10002511','Salud Total'),
    ('1000308034','Salud Total'),('10018650','Salud Total'),('1002593948','Salud Total'),
    ('1002594089','Salud Total'),('18461307','Sura'),('3512461','Sura'),
    ('1128282352','Sura'),('1036691454','Sura'),('1054927690','Sura'),
    ('1054927743','Sura'),('1059713771','Sura'),('1031143075','Sura')
) AS v (documento, eps_del_padron)
JOIN dbo.R_PAC_EPS r ON r.NU_HIST_PAC_RPE = v.documento
LEFT JOIN dbo.EPS e  ON e.CD_NIT_EPS      = r.CD_NIT_EPS_RPE
ORDER BY v.documento, r.CD_NIT_EPS_RPE;

GO

-- =============================================================================
-- P.3 — 🔑 ¿`R_PAC_CONV` ES LA TABLA QUE VALIDA AL AGENDAR?
--
-- Hipótesis fuerte que nadie midió. La cita lleva el convenio en
-- `NU_NUME_CONV_CIT`, y `R_PAC_CONV` = (NU_HIST_PAC_RPC, NU_NUME_CONV_RPC) es
-- una relación paciente↔convenio. Si la aplicación del HIS saca de ahí el
-- desplegable de convenio al agendar, entonces R_PAC_CONV —no R_PAC_EPS— es la
-- lista operativa de "a quién puedo atender y bajo qué acuerdo".
--
-- Lo que decide: si R_PAC_CONV tiene ~1 fila por paciente, es un ESTADO y
-- sirve. Si tiene 5 como R_PAC_EPS, es otro historial y no sirve.
-- =============================================================================

-- (P.3a) ¿Existe la tabla y cómo es? (por si el volcado de Fase 0 la omitió)
PRINT N'';
PRINT N'===== [09] P.3a · ¿Existe la tabla y cómo es? =====';
SELECT  c.name AS columna, ty.name AS tipo, c.max_length, c.is_nullable
FROM sys.columns c
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.R_PAC_CONV')
ORDER BY c.column_id;

-- (P.3b) La medida que decide: filas por paciente.
PRINT N'';
PRINT N'===== [10] P.3b · La medida que decide =====';
SELECT  COUNT(*)                                    AS filas,
        COUNT(DISTINCT NU_HIST_PAC_RPC)             AS pacientes_distintos,
        CAST(COUNT(*) * 1.0
             / NULLIF(COUNT(DISTINCT NU_HIST_PAC_RPC),0) AS decimal(10,2)) AS filas_por_paciente
FROM dbo.R_PAC_CONV;

-- (P.3c) Distribución: cuántos pacientes tienen 1, 2, 3… convenios.
PRINT N'';
PRINT N'===== [11] P.3c · Distribución: cuántos pacientes tienen 1, 2, 3… convenios =====';
SELECT  convenios_por_paciente, COUNT(*) AS pacientes
FROM (
    SELECT NU_HIST_PAC_RPC, COUNT(*) AS convenios_por_paciente
    FROM dbo.R_PAC_CONV
    GROUP BY NU_HIST_PAC_RPC
) x
GROUP BY convenios_por_paciente
ORDER BY convenios_por_paciente;

-- (P.3d) ¿El convenio que lleva la cita está en R_PAC_CONV del paciente?
-- Si el porcentaje de coincidencia es alto, la aplicación valida por ahí.
--
-- Dos decisiones deliberadas en la forma de escribirla:
--   1. NO `SUM(CASE WHEN EXISTS (...))`: SQL Server prohíbe una subconsulta
--      dentro de una función de agregado (error 130, nivel 15). Como es un
--      error de COMPILACIÓN, aborta el lote entero — así se cayó la corrida
--      del 2026-09-10 antes de devolver un solo resultado.
--   2. El CTE lleva DISTINCT: así el LEFT JOIN no puede contar dos veces la
--      misma cita si la pareja (paciente, convenio) está repetida. Es el
--      mismo fan-out que invalidó la consulta G.1 en su momento.
PRINT N'';
PRINT N'===== [12] P.3d · ¿El convenio que lleva la cita está en R_PAC_CONV del paciente? =====';
;WITH conv_paciente AS (
    SELECT DISTINCT NU_HIST_PAC_RPC, NU_NUME_CONV_RPC
    FROM dbo.R_PAC_CONV
), citas AS (
    SELECT c.NU_HIST_PAC_CIT, c.NU_NUME_CONV_CIT
    FROM dbo.CITAS_MEDICAS c
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
)
SELECT  COUNT(*)                                                        AS citas_90d,
        SUM(CASE WHEN cp.NU_HIST_PAC_RPC IS NULL THEN 0 ELSE 1 END)     AS con_convenio_en_R_PAC_CONV,
        CAST(100.0 * SUM(CASE WHEN cp.NU_HIST_PAC_RPC IS NULL THEN 0 ELSE 1 END)
             / NULLIF(COUNT(*),0) AS decimal(5,1))                      AS pct_coincidencia
FROM citas ci
LEFT JOIN conv_paciente cp
       ON cp.NU_HIST_PAC_RPC  = ci.NU_HIST_PAC_CIT
      AND cp.NU_NUME_CONV_RPC = ci.NU_NUME_CONV_CIT;

-- (P.3e) Convenios más frecuentes en R_PAC_CONV, con nombre.
PRINT N'';
PRINT N'===== [13] P.3e · Convenios más frecuentes en R_PAC_CONV, con nombre =====';
SELECT TOP 20
        rc.NU_NUME_CONV_RPC AS convenio,
        cv.CD_CODI_CONV     AS nombre_convenio,
        cv.CD_NIT_EPS_CONV  AS nit_eps,
        cv.NU_VIGE_CONV     AS vigente,
        COUNT(*)            AS pacientes
FROM dbo.R_PAC_CONV rc
LEFT JOIN dbo.CONVENIOS cv ON cv.NU_NUME_CONV = rc.NU_NUME_CONV_RPC
GROUP BY rc.NU_NUME_CONV_RPC, cv.CD_CODI_CONV, cv.CD_NIT_EPS_CONV, cv.NU_VIGE_CONV
ORDER BY pacientes DESC;

GO

-- =============================================================================
-- P.4 — LA MAGNITUD: ¿CUÁNTOS PACIENTES TIENE CADA EPS SEGÚN EL HIS?
--
-- Para comparar contra el tamaño real del padrón. Si el HIS dice que Sura
-- tiene 70.000 de los 78.654 pacientes "activos", queda demostrado en una
-- sola cifra que la marca de vigencia no discrimina.
-- =============================================================================

-- (P.4a) Confirmar primero los NIT exactos tal como los guarda el hospital.
PRINT N'';
PRINT N'===== [14] P.4a · Confirmar primero los NIT exactos tal como los guarda el hospital =====';
SELECT  CD_NIT_EPS, NO_NOMB_EPS, CD_CODI_EPS, NU_ACTIVO_EPS, TX_NITALT_EPS
FROM dbo.EPS
WHERE NO_NOMB_EPS LIKE '%SURA%'
   OR NO_NOMB_EPS LIKE '%TOTAL%'
   OR NO_NOMB_EPS LIKE '%NUEVA%'
   OR CD_NIT_EPS LIKE '8000887%'
   OR CD_NIT_EPS LIKE '8001309%'
   OR CD_NIT_EPS LIKE '9001562%';

-- (P.4b) Pacientes distintos por EPS, con y sin el filtro de vigencia.
PRINT N'';
PRINT N'===== [15] P.4b · Pacientes distintos por EPS, con y sin el filtro de vigencia =====';
SELECT  r.CD_NIT_EPS_RPE                        AS nit_eps,
        e.NO_NOMB_EPS                           AS eps,
        COUNT(*)                                AS filas,
        COUNT(DISTINCT r.NU_HIST_PAC_RPE)       AS pacientes_distintos,
        COUNT(DISTINCT CASE WHEN r.NU_ESTA_RPE = 1 AND r.TX_ACTI_RPE = 'S'
                            THEN r.NU_HIST_PAC_RPE END) AS pacientes_vigentes
FROM dbo.R_PAC_EPS r
LEFT JOIN dbo.EPS e ON e.CD_NIT_EPS = r.CD_NIT_EPS_RPE
GROUP BY r.CD_NIT_EPS_RPE, e.NO_NOMB_EPS
ORDER BY pacientes_distintos DESC;

-- (P.4c) ¿Qué significan NU_AFIL_RPE y CD_POL_RPE? Último cabo suelto dentro
-- de R_PAC_EPS: si alguna combinación deja UNA sola fila por paciente, la
-- tabla se rescata. Si no, queda cerrada definitivamente.
PRINT N'';
PRINT N'===== [16] P.4c · ¿Qué significan NU_AFIL_RPE y CD_POL_RPE? =====';
SELECT  r.NU_AFIL_RPE, r.NU_ESTA_RPE, r.TX_ACTI_RPE,
        COUNT(*)                          AS filas,
        COUNT(DISTINCT r.NU_HIST_PAC_RPE) AS pacientes,
        CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT r.NU_HIST_PAC_RPE),0) AS decimal(10,2)) AS filas_por_paciente
FROM dbo.R_PAC_EPS r
GROUP BY r.NU_AFIL_RPE, r.NU_ESTA_RPE, r.TX_ACTI_RPE
ORDER BY filas DESC;

-- (P.4d) ¿CD_POL_RPE tiene forma de periodo/corte (2026-09, 202609, sep-26)?
PRINT N'';
PRINT N'===== [17] P.4d · ¿CD_POL_RPE tiene forma de periodo/corte =====';
SELECT TOP 30 r.CD_POL_RPE AS poliza, COUNT(*) AS filas
FROM dbo.R_PAC_EPS r
WHERE r.CD_POL_RPE IS NOT NULL AND r.CD_POL_RPE <> ''
GROUP BY r.CD_POL_RPE
ORDER BY filas DESC;

GO

-- =============================================================================
-- P.5 — BARRIDO POR NOMBRE DE TABLA (las 1.393 de dbo)
-- Vocabulario típico de un padrón en Colombia: BDUA, ADRES, FOSYGA, capitados,
-- afiliados, derechos, población, SISBEN, novedades, traslados, movilidad.
-- =============================================================================

PRINT N'';
PRINT N'===== [18] P.5 · BARRIDO POR NOMBRE DE TABLA =====';
SELECT  s.name                                          AS esquema,
        t.name                                          AS tabla,
        (SELECT SUM(p.rows) FROM sys.partitions p
          WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas,
        t.create_date                                   AS creada,
        t.modify_date                                   AS ultima_alteracion_estructura
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.name LIKE '%PADR%'    OR t.name LIKE '%BDUA%'    OR t.name LIKE '%ADRES%'
   OR t.name LIKE '%AFIL%'    OR t.name LIKE '%CAPIT%'   OR t.name LIKE '%DERECH%'
   OR t.name LIKE '%POBLA%'   OR t.name LIKE '%CARN%'    OR t.name LIKE '%MAESTR%'
   OR t.name LIKE '%SISBEN%'  OR t.name LIKE '%FOSYGA%'  OR t.name LIKE '%MOVILID%'
   OR t.name LIKE '%NOVEDAD%' OR t.name LIKE '%TRASLAD%' OR t.name LIKE '%USUARIO%'
   OR t.name LIKE '%LISTAD%'  OR t.name LIKE '%VALIDA%'  OR t.name LIKE '%COTIZ%'
   OR t.name LIKE '%BENEFIC%' OR t.name LIKE '%CONTRAT%' OR t.name LIKE '%[_]EPS%'
   OR t.name LIKE '%EPS[_]%'    OR t.name LIKE '%IMPORT%'  OR t.name LIKE '%CARGA%'
   OR t.name LIKE '%TEMP%'    OR t.name LIKE '%TMP%'
ORDER BY filas DESC;

GO

-- =============================================================================
-- P.6 — BARRIDO POR NOMBRE DE COLUMNA  ⭐ el más potente
--
-- Más fiable que el nombre de la tabla: una tabla de padrón tiene VARIAS
-- columnas del vocabulario de afiliación a la vez (NIT + régimen + carné +
-- periodo + tipo de afiliado). Filtramos por tablas con 3 o más coincidencias
-- para que el ruido no ahogue la señal.
-- =============================================================================

PRINT N'';
PRINT N'===== [19] P.6 · BARRIDO POR NOMBRE DE COLUMNA el más potente =====';
;WITH cand AS (
    SELECT  t.object_id, s.name AS esquema, t.name AS tabla, c.name AS columna
    FROM sys.columns c
    JOIN sys.tables  t ON t.object_id  = c.object_id
    JOIN sys.schemas s ON s.schema_id  = t.schema_id
    WHERE c.name LIKE '%CARN%'   OR c.name LIKE '%AFIL%'   OR c.name LIKE '%REGIM%'
       OR c.name LIKE '%NIT%'    OR c.name LIKE '%IPS%'    OR c.name LIKE '%PERIOD%'
       OR c.name LIKE '%CORTE%'  OR c.name LIKE '%VIGEN%'  OR c.name LIKE '%COTIZ%'
       OR c.name LIKE '%BENEF%'  OR c.name LIKE '%CAPIT%'  OR c.name LIKE '%PADRON%'
       OR c.name LIKE '%BDUA%'   OR c.name LIKE '%SISBEN%' OR c.name LIKE '%NIVEL%'
       OR c.name LIKE '%DERECH%' OR c.name LIKE '%NOVED%'  OR c.name LIKE '%TRASLAD%'
       OR c.name LIKE '%PARENT%' OR c.name LIKE '%SUBSID%' OR c.name LIKE '%CONTRIB%'
)
SELECT  c.esquema,
        c.tabla,
        COUNT(*)                                                        AS columnas_sospechosas,
        (SELECT SUM(p.rows) FROM sys.partitions p
          WHERE p.object_id = c.object_id AND p.index_id IN (0,1))       AS filas,
        STUFF((SELECT ' | ' + c2.columna FROM cand c2
                WHERE c2.object_id = c.object_id
                ORDER BY c2.columna FOR XML PATH('')), 1, 3, '')         AS cuales
FROM cand c
GROUP BY c.esquema, c.tabla, c.object_id
HAVING COUNT(*) >= 3
ORDER BY columnas_sospechosas DESC, filas DESC;

-- (P.6b) Variante: tablas que tengan A LA VEZ algo de documento y algo de EPS.
-- Es la forma mínima de un padrón: una persona y su aseguradora.
PRINT N'';
PRINT N'===== [20] P.6b · Variante: tablas que tengan A LA VEZ algo de documento y algo de EPS =====';
SELECT  s.name AS esquema, t.name AS tabla,
        (SELECT SUM(p.rows) FROM sys.partitions p
          WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id
                AND (c.name LIKE '%DOCU%' OR c.name LIKE '%IDENT%' OR c.name LIKE '%CEDUL%'))
  AND EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id
                AND (c.name LIKE '%EPS%'  OR c.name LIKE '%NIT%'   OR c.name LIKE '%ASEGUR%'))
  AND t.name NOT IN ('PACIENTES','R_PAC_EPS','CITAS_MEDICAS','CITAS_ANULADAS')
ORDER BY filas DESC;

GO

-- =============================================================================
-- P.7 — HUELLAS DE UNA CARGA MASIVA MENSUAL
--
-- Una carga de padrón deja dos rastros: la tabla es GRANDE y se ESCRIBIÓ
-- recientemente de golpe. Si el hospital sube el padrón cada mes, la tabla
-- destino debería aparecer en las dos listas.
--
-- ⚠️ `sys.dm_db_index_usage_stats` se vacía al reiniciar el servicio: si el
-- SQL Server se reinició hace poco, la lista dirá poco. Anotar el uptime.
-- =============================================================================

PRINT N'';
PRINT N'===== [21] P.7 · HUELLAS DE UNA CARGA MASIVA MENSUAL =====';
SELECT sqlserver_start_time AS servidor_arrancado, GETDATE() AS ahora
FROM sys.dm_os_sys_info;

-- (P.7a) Las 40 tablas más grandes. Un padrón municipal de dos EPS debería
-- estar en el orden de 10.000-60.000 filas.
PRINT N'';
PRINT N'===== [22] P.7a · Las 40 tablas más grandes =====';
SELECT TOP 40
        s.name AS esquema, t.name AS tabla,
        SUM(p.rows) AS filas,
        t.create_date AS creada
FROM sys.tables t
JOIN sys.schemas s   ON s.schema_id = t.schema_id
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
GROUP BY s.name, t.name, t.create_date
ORDER BY filas DESC;

-- (P.7b) Las 40 tablas escritas más recientemente.
PRINT N'';
PRINT N'===== [23] P.7b · Las 40 tablas escritas más recientemente =====';
SELECT TOP 40
        OBJECT_SCHEMA_NAME(u.object_id) AS esquema,
        OBJECT_NAME(u.object_id)        AS tabla,
        MAX(u.last_user_update)         AS ultima_escritura,
        SUM(u.user_updates)             AS escrituras_desde_el_arranque
FROM sys.dm_db_index_usage_stats u
WHERE u.database_id = DB_ID()
  AND u.last_user_update IS NOT NULL
GROUP BY u.object_id
ORDER BY ultima_escritura DESC;

-- (P.7c) Tablas creadas en el último año: una carga nueva suele traer tabla
-- nueva (PADRON_2026, TMP_AFILIADOS…).
PRINT N'';
PRINT N'===== [24] P.7c · Tablas creadas en el último año =====';
SELECT s.name AS esquema, t.name AS tabla, t.create_date, t.modify_date,
       (SELECT SUM(p.rows) FROM sys.partitions p
         WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.create_date >= DATEADD(year, -1, GETDATE())
ORDER BY t.create_date DESC;

GO

-- =============================================================================
-- P.8 — CÓDIGO DEL PRODUCTO: ¿QUIÉN MENCIONA EL PADRÓN?
--
-- Procedimientos, vistas, funciones y triggers cuyo TEXTO hable de padrón,
-- afiliación o carga masiva. Si existe un SP tipo `sp_CargarPadron`, ahí está
-- escrito exactamente cómo entra el archivo y a qué tabla.
-- =============================================================================

PRINT N'';
PRINT N'===== [25] P.8 · CÓDIGO DEL PRODUCTO: ¿QUIÉN MENCIONA EL PADRÓN? =====';
SELECT  o.type_desc                  AS tipo,
        s.name                       AS esquema,
        o.name                       AS objeto,
        o.modify_date                AS modificado,
        LEN(m.definition)            AS largo_definicion
FROM sys.sql_modules m
JOIN sys.objects  o ON o.object_id  = m.object_id
JOIN sys.schemas  s ON s.schema_id  = o.schema_id
WHERE m.definition LIKE '%PADRON%'   OR m.definition LIKE '%PADRÓN%'
   OR m.definition LIKE '%BDUA%'     OR m.definition LIKE '%ADRES%'
   OR m.definition LIKE '%AFILIAD%'  OR m.definition LIKE '%CAPITA%'
   OR m.definition LIKE '%R_PAC_EPS%' OR m.definition LIKE '%R_PAC_CONV%'
   OR m.definition LIKE '%BULK INSERT%' OR m.definition LIKE '%OPENROWSET%'
   OR m.definition LIKE '%OPENDATASOURCE%'
ORDER BY o.type_desc, o.name;

-- (P.8b) OPCIONAL — barrido de las OTRAS bases de datos de la instancia.
-- ⚠️ ÚNICA excepción a "solo lectura": crea una tabla #temporal en tempdb.
-- No escribe NADA en ninguna base del HIS. Si prefieren evitarlo, correr la
-- consulta P.5 manualmente dentro de cada base que salga en P.0.
/*
IF OBJECT_ID('tempdb..#hit') IS NOT NULL DROP TABLE #hit;
CREATE TABLE #hit (bd sysname, esquema sysname, tabla sysname, filas bigint);

DECLARE @bd sysname, @sql nvarchar(max);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM sys.databases
    WHERE state = 0 AND database_id > 4 AND HAS_DBACCESS(name) = 1;
OPEN cur;
FETCH NEXT FROM cur INTO @bd;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'
        INSERT INTO #hit (bd, esquema, tabla, filas)
        SELECT ' + QUOTENAME(@bd, '''') + N', s.name, t.name,
               (SELECT SUM(p.rows) FROM ' + QUOTENAME(@bd) + N'.sys.partitions p
                 WHERE p.object_id = t.object_id AND p.index_id IN (0,1))
        FROM ' + QUOTENAME(@bd) + N'.sys.tables t
        JOIN ' + QUOTENAME(@bd) + N'.sys.schemas s ON s.schema_id = t.schema_id
        WHERE t.name LIKE ''%PADR%''  OR t.name LIKE ''%BDUA%''   OR t.name LIKE ''%AFIL%''
           OR t.name LIKE ''%CAPIT%'' OR t.name LIKE ''%DERECH%'' OR t.name LIKE ''%POBLA%''
           OR t.name LIKE ''%CARN%''  OR t.name LIKE ''%MAESTR%'' OR t.name LIKE ''%SISBEN%''
           OR t.name LIKE ''%ADRES%'' OR t.name LIKE ''%FOSYGA%'' OR t.name LIKE ''%NOVEDAD%''';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM cur INTO @bd;
END
CLOSE cur; DEALLOCATE cur;

SELECT * FROM #hit ORDER BY filas DESC;
DROP TABLE #hit;
*/

GO

-- =============================================================================
-- P.9 — ¿POR DÓNDE ENTRA EL ARCHIVO? (jobs, SSIS, servidores vinculados)
--
-- ⚠️ Requiere permisos sobre msdb — probablemente lo tenga que correr TI.
-- La Fase 0 vio que los jobs eran solo de mantenimiento, pero no revisó los
-- COMANDOS de cada paso buscando una carga de padrón.
-- =============================================================================

-- (P.9a) Todos los jobs con sus pasos y el comando (recortado).
PRINT N'';
PRINT N'===== [26] P.9a · Todos los jobs con sus pasos y el comando =====';
SELECT  j.name                       AS job,
        j.enabled                    AS habilitado,
        js.step_id                   AS paso,
        js.step_name                 AS nombre_paso,
        js.subsystem                 AS subsistema,
        js.database_name             AS bd,
        LEFT(js.command, 400)        AS comando
FROM msdb.dbo.sysjobs j
JOIN msdb.dbo.sysjobsteps js ON js.job_id = j.job_id
ORDER BY j.name, js.step_id;

-- (P.9b) Paquetes SSIS/DTS almacenados en el servidor (una carga de padrón
-- clásicamente es un paquete, no un SP).
PRINT N'';
PRINT N'===== [27] P.9b · Paquetes SSIS/DTS almacenados en el servidor =====';
SELECT  p.name AS paquete, p.description, p.createdate, p.folderid
FROM msdb.dbo.sysssispackages p
ORDER BY p.createdate DESC;

-- (P.9c) Servidores vinculados: el padrón podría venir de otra instancia.
PRINT N'';
PRINT N'===== [28] P.9c · Servidores vinculados =====';
SELECT s.name AS servidor_vinculado, s.product, s.provider, s.data_source
FROM sys.servers s
WHERE s.server_id <> 0;

GO

-- =============================================================================
-- P.10 — LO QUE `PACIENTES` YA SABE
--
-- Antes de traer nada de fuera: ¿qué tan poblados están los campos que el
-- padrón traería? Decide si el padrón es un aporte real o una redundancia.
-- El teléfono es el más importante: es el canal del bot.
-- =============================================================================

PRINT N'';
PRINT N'===== [29] P.10 · LO QUE `PACIENTES` YA SABE =====';
SELECT  COUNT(*)                                                          AS pacientes,
        SUM(CASE WHEN DE_TELE_PAC IS NULL OR LTRIM(RTRIM(DE_TELE_PAC)) = ''
                 THEN 0 ELSE 1 END)                                       AS con_telefono,
        SUM(CASE WHEN DE_TELE_PAC LIKE '3%' AND LEN(LTRIM(RTRIM(DE_TELE_PAC))) = 10
                 THEN 1 ELSE 0 END)                                       AS con_movil_valido,
        SUM(CASE WHEN DE_EMAIL_PAC IS NULL OR LTRIM(RTRIM(DE_EMAIL_PAC)) = ''
                 THEN 0 ELSE 1 END)                                       AS con_email,
        SUM(CASE WHEN DE_DIRE_PAC IS NULL OR LTRIM(RTRIM(DE_DIRE_PAC)) = ''
                 THEN 0 ELSE 1 END)                                       AS con_direccion,
        SUM(CASE WHEN NU_IPSPRIMARIA_PAC IS NULL OR LTRIM(RTRIM(NU_IPSPRIMARIA_PAC)) = ''
                 THEN 0 ELSE 1 END)                                       AS con_ips_primaria
FROM dbo.PACIENTES;

-- (P.10b) ¿Qué valores tiene la IPS primaria? Si el padrón la alimenta,
-- debería salir el código del hospital dominando.
PRINT N'';
PRINT N'===== [30] P.10b · ¿Qué valores tiene la IPS primaria? =====';
SELECT TOP 20 NU_IPSPRIMARIA_PAC AS ips_primaria, COUNT(*) AS pacientes
FROM dbo.PACIENTES
GROUP BY NU_IPSPRIMARIA_PAC
ORDER BY pacientes DESC;

-- (P.10c) Estado, nivel y copago: candidatos a espejo de EstadoServicio,
-- RangoSalarial y ExentoCp/ExentoCm del padrón.
PRINT N'';
PRINT N'===== [31] P.10c · Estado, nivel y copago =====';
SELECT NU_ESTA_PAC AS estado_paciente, NU_NIVE_PAC AS nivel, TX_COPO_PAC AS copago,
       COUNT(*) AS pacientes
FROM dbo.PACIENTES
GROUP BY NU_ESTA_PAC, NU_NIVE_PAC, TX_COPO_PAC
ORDER BY pacientes DESC;

-- (P.10d) Tipos de documento realmente usados. El padrón de Sura trae
-- Registro Civil y Tarjeta de Identidad; aquí se ve si el HIS los usa.
PRINT N'';
PRINT N'===== [32] P.10d · Tipos de documento realmente usados =====';
SELECT p.NU_TIPD_PAC AS codigo, td.TX_NOMB_TDOC AS sigla, td.TX_DESC_TDOC AS descripcion,
       COUNT(*) AS pacientes
FROM dbo.PACIENTES p
LEFT JOIN dbo.TIPO_DOCUMENTO td ON td.NU_CODIGO_TDOC = p.NU_TIPD_PAC
GROUP BY p.NU_TIPD_PAC, td.TX_NOMB_TDOC, td.TX_DESC_TDOC
ORDER BY pacientes DESC;


GO

-- =============================================================================
-- P.11 — 🔑 ¿CRECE `R_PAC_EPS` AÑO CONTRA AÑO?
--
-- La instancia guarda copias anuales completas: ESEHSVP2024, ESEHSVP2025 y la
-- viva ESEHSVP. Comparar el mismo conteo en las tres mide, sin ambigüedad, si
-- algo carga afiliaciones de forma periódica.
--
-- Lo que decide:
--   · Si las filas crecen mucho más rápido que los pacientes (ej. +30.000
--     filas y +2.000 pacientes por año) ⇒ hay una carga masiva recurrente que
--     INSERTA sin actualizar. Ese es el padrón, y explica las 4,8 filas por
--     paciente.
--   · Si crecen a la par y despacio ⇒ las afiliaciones se registran a mano en
--     ventanilla, el padrón no entra al HIS, y toca el camino del archivo.
-- =============================================================================

PRINT N'';
PRINT N'===== [33] P.11 · ¿CRECE `R_PAC_EPS` AÑO CONTRA AÑO? =====';
SELECT 'ESEHSVP2024' AS base, COUNT(*) AS filas_afiliacion,
       COUNT(DISTINCT NU_HIST_PAC_RPE) AS pacientes_distintos
FROM ESEHSVP2024.dbo.R_PAC_EPS
UNION ALL
SELECT 'ESEHSVP2025', COUNT(*), COUNT(DISTINCT NU_HIST_PAC_RPE)
FROM ESEHSVP2025.dbo.R_PAC_EPS
UNION ALL
SELECT 'ESEHSVP (viva)', COUNT(*), COUNT(DISTINCT NU_HIST_PAC_RPE)
FROM ESEHSVP.dbo.R_PAC_EPS
ORDER BY base;

-- (P.11b) Lo mismo para PACIENTES: separa "creció el padrón" de "creció el
-- hospital". Si PACIENTES casi no crece pero R_PAC_EPS sí, es carga masiva.
PRINT N'';
PRINT N'===== [34] P.11b · Lo mismo para PACIENTES =====';
SELECT 'ESEHSVP2024' AS base, COUNT(*) AS pacientes FROM ESEHSVP2024.dbo.PACIENTES
UNION ALL SELECT 'ESEHSVP2025', COUNT(*) FROM ESEHSVP2025.dbo.PACIENTES
UNION ALL SELECT 'ESEHSVP (viva)', COUNT(*) FROM ESEHSVP.dbo.PACIENTES
ORDER BY base;

-- (P.11c) ¿Y aparecen en las copias anuales tablas que la viva no tiene (o al
-- revés)? Una tabla de carga temporal puede haber quedado en una sola copia.
PRINT N'';
PRINT N'===== [35] P.11c · ¿Y aparecen en las copias anuales tablas que la viva no tiene =====';
;WITH todas AS (
              SELECT name FROM ESEHSVP.sys.tables
    UNION     SELECT name FROM ESEHSVP2025.sys.tables
    UNION     SELECT name FROM ESEHSVP2024.sys.tables
)
SELECT  t.name AS tabla,
        CASE WHEN EXISTS (SELECT 1 FROM ESEHSVP.sys.tables     x WHERE x.name = t.name) THEN 'sí' ELSE '' END AS en_ESEHSVP,
        CASE WHEN EXISTS (SELECT 1 FROM ESEHSVP2025.sys.tables x WHERE x.name = t.name) THEN 'sí' ELSE '' END AS en_2025,
        CASE WHEN EXISTS (SELECT 1 FROM ESEHSVP2024.sys.tables x WHERE x.name = t.name) THEN 'sí' ELSE '' END AS en_2024
FROM todas t
WHERE NOT (    EXISTS (SELECT 1 FROM ESEHSVP.sys.tables     x WHERE x.name = t.name)
           AND EXISTS (SELECT 1 FROM ESEHSVP2025.sys.tables x WHERE x.name = t.name)
           AND EXISTS (SELECT 1 FROM ESEHSVP2024.sys.tables x WHERE x.name = t.name))
ORDER BY t.name;

GO

-- =============================================================================
-- P.12 — SSRS: EL CATÁLOGO DE REPORTES Y EL SQL QUE LLEVAN DENTRO
--
-- Hay Reporting Services instalado (`ReportServer2019`). Vale mucho la pena:
-- si alguien en el hospital saca un listado de afiliados, de capitados o de
-- verificación de derechos, ese reporte existe aquí — y su definición (.rdl)
-- **contiene el SQL con el nombre exacto de la tabla que consulta**.
--
-- Es la vía más directa que queda para saber de dónde saca el hospital la
-- verdad sobre quién está activo en cada EPS.
-- =============================================================================

-- (P.12a) Reportes y orígenes de datos publicados, por nombre.
--   Type: 1=Carpeta 2=Reporte 3=Recurso 4=ReporteVinculado 5=OrigenDatos 8=Dataset
PRINT N'';
PRINT N'===== [36] P.12a · Reportes y orígenes de datos publicados, por nombre =====';
SELECT  c.Path, c.Name, c.Type, c.CreationDate, c.ModifiedDate
FROM ReportServer2019.dbo.Catalog c
WHERE c.Name LIKE '%padr%'   OR c.Name LIKE '%afili%'  OR c.Name LIKE '%capit%'
   OR c.Name LIKE '%derech%' OR c.Name LIKE '%bdua%'   OR c.Name LIKE '%eps%'
   OR c.Name LIKE '%carn%'   OR c.Name LIKE '%usuari%' OR c.Name LIKE '%pobla%'
   OR c.Path LIKE '%padr%'   OR c.Path LIKE '%afili%'
ORDER BY c.ModifiedDate DESC;

-- (P.12b) Inventario completo de reportes, por si el nombre no delata nada.
PRINT N'';
PRINT N'===== [37] P.12b · Inventario completo de reportes, por si el nombre no delata nada =====';
SELECT c.Path, c.Name, c.Type, c.ModifiedDate
FROM ReportServer2019.dbo.Catalog c
WHERE c.Type IN (2,4)
ORDER BY c.ModifiedDate DESC;

-- (P.12c) ⭐ Buscar DENTRO de la definición de cada reporte. Aquí sale el
-- nombre de la tabla que el hospital consulta de verdad.
-- Nota: si el texto sale ilegible (caracteres separados), cambiar
-- `varchar(max)` por `nvarchar(max)` en las dos apariciones.
PRINT N'';
PRINT N'===== [38] P.12c · Buscar DENTRO de la definición de cada reporte =====';
;WITH rdl AS (
    SELECT  c.Path, c.Name,
            CONVERT(varchar(max), CONVERT(varbinary(max), c.Content)) AS texto
    FROM ReportServer2019.dbo.Catalog c
    WHERE c.Type IN (2,4) AND c.Content IS NOT NULL
)
SELECT  r.Path, r.Name,
        CASE WHEN r.texto LIKE '%R_PAC_EPS%'  THEN 'sí' ELSE '' END AS usa_R_PAC_EPS,
        CASE WHEN r.texto LIKE '%R_PAC_CONV%' THEN 'sí' ELSE '' END AS usa_R_PAC_CONV,
        CASE WHEN r.texto LIKE '%PADRON%'     THEN 'sí' ELSE '' END AS dice_padron,
        CASE WHEN r.texto LIKE '%AFILIAD%'    THEN 'sí' ELSE '' END AS dice_afiliado,
        CASE WHEN r.texto LIKE '%CAPITA%'     THEN 'sí' ELSE '' END AS dice_capita,
        CASE WHEN r.texto LIKE '%CARN%'       THEN 'sí' ELSE '' END AS dice_carne
FROM rdl r
WHERE r.texto LIKE '%R_PAC_EPS%'  OR r.texto LIKE '%R_PAC_CONV%'
   OR r.texto LIKE '%PADRON%'     OR r.texto LIKE '%AFILIAD%'
   OR r.texto LIKE '%CAPITA%'     OR r.texto LIKE '%CARN%'
ORDER BY r.Path, r.Name;

-- (P.12d) Cadenas de conexión de los orígenes de datos: si algún reporte
-- apunta a otra base o a otro servidor, el padrón puede vivir allá.
PRINT N'';
PRINT N'===== [39] P.12d · Cadenas de conexión de los orígenes de datos =====';
SELECT  c.Path, c.Name, d.Extension, d.ConnectionString
FROM ReportServer2019.dbo.DataSource d
JOIN ReportServer2019.dbo.Catalog c ON c.ItemID = d.ItemID
ORDER BY c.Path, c.Name;

GO

PRINT N'';
PRINT N'===== FIN DE LA CORRIDA =====';
GO

-- =============================================================================
-- FASE 0 — DESCUBRIMIENTO DEL HIS (100% SOLO LECTURA — no modifica nada)
-- Ejecutar en SSMS conectado a la BD PRUEBAS (bloque 13 también en ESEHSVP2025
-- para volúmenes reales). Compartir el resultado de CADA bloque con el equipo.
-- Numeración alineada con docs/MAPEO_HIS.md §5.
-- =============================================================================
USE PRUEBAS;
GO

-- (0) Identidad del servidor, reloj y collation ------------------------------
SELECT @@SERVERNAME                    AS servidor,
       SERVERPROPERTY('Collation')     AS collation_srv,
       SYSDATETIME()                   AS hora_local,
       SYSDATETIMEOFFSET()             AS hora_con_offset;

-- (1) PK e identity de las tablas núcleo  ← BLOQUEANTE #1 --------------------
-- Sin PK en CITAS_MEDICAS no hay Change Tracking ni UPDATEs/idempotencia seguros.
SELECT t.name AS tabla, i.name AS indice_pk, c.name AS columna, ic.key_ordinal
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c        ON c.object_id  = ic.object_id AND c.column_id = ic.column_id
JOIN sys.tables t         ON t.object_id  = i.object_id
WHERE i.is_primary_key = 1
  AND t.name IN ('CITAS_MEDICAS','MEDICOS','PACIENTES','SERVICIOS',
                 'CITAS_TELEMEDICINA','TURNOS_MEDICOS')
ORDER BY t.name, ic.key_ordinal;

SELECT OBJECT_NAME(object_id) AS tabla, name AS columna_identity, seed_value, increment_value
FROM sys.identity_columns
WHERE OBJECT_NAME(object_id) IN ('CITAS_MEDICAS','MEDICOS','PACIENTES','SERVICIOS');

-- También índices únicos no-PK (identidad alternativa del registro):
SELECT t.name AS tabla, i.name AS indice_unico, c.name AS columna, ic.key_ordinal
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c        ON c.object_id  = ic.object_id AND c.column_id = ic.column_id
JOIN sys.tables t         ON t.object_id  = i.object_id
WHERE i.is_unique = 1 AND i.is_primary_key = 0 AND t.name = 'CITAS_MEDICAS'
ORDER BY i.name, ic.key_ordinal;

-- (2) Triggers del HIS sobre las tablas núcleo  ← BLOQUEANTE #8 --------------
SELECT OBJECT_NAME(parent_id) AS tabla, name AS trigger_name, is_disabled, is_instead_of_trigger
FROM sys.triggers
WHERE parent_id IN (OBJECT_ID('dbo.CITAS_MEDICAS'), OBJECT_ID('dbo.PACIENTES'),
                    OBJECT_ID('dbo.MEDICOS'),       OBJECT_ID('dbo.SERVICIOS'));

-- (3) ¿El HIS usa procedimientos almacenados para citas?  ← BLOQUEANTE #8 ----
-- Si existen SPs oficiales de agendamiento, el agente los usará en vez de INSERTs crudos.
SELECT o.type_desc, s.name + '.' + o.name AS objeto, o.modify_date
FROM sys.sql_modules m
JOIN sys.objects o  ON o.object_id = m.object_id
JOIN sys.schemas s  ON s.schema_id = o.schema_id
WHERE m.definition LIKE '%CITAS_MEDICAS%'
ORDER BY o.type_desc, objeto;

-- (4) Catálogo de estados NU_ESTA_CIT (+ tipo y modalidad)  ← BLOQUEANTE #3 --
SELECT NU_ESTA_CIT, COUNT(*) AS total, MIN(FE_FECH_CIT) AS desde, MAX(FE_FECH_CIT) AS hasta
FROM dbo.CITAS_MEDICAS GROUP BY NU_ESTA_CIT ORDER BY NU_ESTA_CIT;

SELECT NU_TIPO_CIT, COUNT(*) AS total FROM dbo.CITAS_MEDICAS GROUP BY NU_TIPO_CIT ORDER BY NU_TIPO_CIT;
SELECT NU_MOD_CIT,  COUNT(*) AS total FROM dbo.CITAS_MEDICAS GROUP BY NU_MOD_CIT  ORDER BY NU_MOD_CIT;

-- COMPLEMENTO MANUAL (imprescindible): en PRUEBAS, desde LA APLICACIÓN del HIS,
-- crear una cita, cancelarla, marcarla cumplida/incumplida, y tras cada acción
-- volver a consultar esa fila para anotar qué valor toma NU_ESTA_CIT:
-- SELECT * FROM dbo.CITAS_MEDICAS WHERE NU_HIST_PAC_CIT = '<historia_de_prueba>' ORDER BY FE_ELAB_CIT DESC;

-- (5) Formato real de FE_HORA_CIT / FE_FECH_CIT  ← BLOQUEANTE #2 -------------
SELECT TOP 30 FE_FECH_CIT, FE_HORA_CIT, NU_DURA_CIT, NU_DIA_CIT, NU_ESTA_CIT, FE_ELAB_CIT
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= DATEADD(DAY,-30,GETDATE())
ORDER BY FE_ELAB_CIT DESC;

-- ¿Cuántos formatos distintos de hora conviven? (longitudes distintas = formatos distintos)
SELECT LEN(FE_HORA_CIT) AS longitud, COUNT(*) AS total, MIN(FE_HORA_CIT) AS ejemplo
FROM dbo.CITAS_MEDICAS GROUP BY LEN(FE_HORA_CIT) ORDER BY longitud;

-- (6) Hipótesis "CITAS_MEDICAS también es la agenda" ← BLOQUEANTE #4 ---------
-- Si hay filas futuras con paciente NULL, son cupos libres pre-generados.
SELECT CASE WHEN NU_HIST_PAC_CIT IS NULL THEN 'SIN_PACIENTE_(cupo_libre?)' ELSE 'CON_PACIENTE' END AS tipo,
       NU_ESTA_CIT, COUNT(*) AS total
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= GETDATE()
GROUP BY CASE WHEN NU_HIST_PAC_CIT IS NULL THEN 'SIN_PACIENTE_(cupo_libre?)' ELSE 'CON_PACIENTE' END,
         NU_ESTA_CIT
ORDER BY tipo, NU_ESTA_CIT;

-- Muestra de posibles cupos libres futuros:
SELECT TOP 20 CD_CODI_MED_CIT, FE_FECH_CIT, FE_HORA_CIT, NU_DURA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= GETDATE() AND NU_HIST_PAC_CIT IS NULL
ORDER BY FE_FECH_CIT, FE_HORA_CIT;

-- (7) Estructura de la plantilla de agenda ← BLOQUEANTE #4 -------------------
SELECT COLUMN_NAME, DATA_TYPE,
       ISNULL(CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR),'N/A') AS longitud, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TURNOS_MEDICOS' AND TABLE_SCHEMA = 'dbo'
ORDER BY ORDINAL_POSITION;

SELECT TOP 20 * FROM dbo.TURNOS_MEDICOS ORDER BY 1 DESC;

-- Otras tablas candidatas de agenda:
SELECT name FROM sys.tables
WHERE name LIKE '%AGEND%' OR name LIKE '%TURNO%' OR name LIKE '%HORAR%' OR name LIKE '%CUPO%'
ORDER BY name;

-- (8) Regla de la historia: ¿NU_HIST_PAC = NU_DOCU_PAC?  ← BLOQUEANTE #5 -----
SELECT SUM(CASE WHEN NU_HIST_PAC =  NU_DOCU_PAC THEN 1 ELSE 0 END) AS iguales,
       SUM(CASE WHEN NU_HIST_PAC <> NU_DOCU_PAC THEN 1 ELSE 0 END) AS distintos,
       COUNT(*) AS total
FROM dbo.PACIENTES;

SELECT TOP 10 NU_TIPD_PAC, NU_DOCU_PAC, NU_HIST_PAC
FROM dbo.PACIENTES WHERE NU_HIST_PAC <> NU_DOCU_PAC;

-- (9) Defaults reales de columnas NOT NULL de PACIENTES  ← BLOQUEANTE #5 -----
-- ¿Qué escribe el HIS en donación/voluntad anticipada al crear un paciente normal?
SELECT TOP 20 NU_DOCU_PAC, FE_HIST_PAC, FE_FECH_DONA_PAC, FE_FECH_VOLU_PAC, NU_EXTR_PAC
FROM dbo.PACIENTES ORDER BY FE_HIST_PAC DESC;

-- Defaults declarados en el esquema:
SELECT OBJECT_NAME(dc.parent_object_id) AS tabla, c.name AS columna, dc.definition AS default_declarado
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id IN (OBJECT_ID('dbo.PACIENTES'), OBJECT_ID('dbo.CITAS_MEDICAS'))
ORDER BY tabla, columna;

-- Catálogo de tipos de documento (para homologación estática):
SELECT * FROM dbo.TIPO_DOCUMENTO;

-- (10) Convenios / EPS de la cita  ← BLOQUEANTE #6 ---------------------------
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE,
       ISNULL(CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR),'N/A') AS longitud, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('R_PAC_EPS','R_PAC_CONV') AND TABLE_SCHEMA = 'dbo'
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT name FROM sys.tables
WHERE name LIKE '%CONV%' OR name LIKE '%EPS%' OR name LIKE '%CONTRAT%' OR name LIKE '%ASEGURA%'
ORDER BY name;

-- ¿Las citas reales llevan convenio?
SELECT TOP 30 NU_NUME_CONV_CIT, COUNT(*) AS total
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= DATEADD(DAY,-90,GETDATE())
GROUP BY NU_NUME_CONV_CIT ORDER BY total DESC;

-- (11) Módulo web del HIS  ← BLOQUEANTE #8 -----------------------------------
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE,
       ISNULL(CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR),'N/A') AS longitud, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('HOM_SERV_WEB','LOGIN_WEB') AND TABLE_SCHEMA = 'dbo'
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT NU_CODIGO_HSWE_CIT, COUNT(*) AS total
FROM dbo.CITAS_MEDICAS GROUP BY NU_CODIGO_HSWE_CIT ORDER BY NU_CODIGO_HSWE_CIT;

-- (12) Servicios agendables: significado de ID_CITA_SER  ← BLOQUEANTE #7 -----
SELECT ID_CITA_SER, COUNT(*) AS total FROM dbo.SERVICIOS GROUP BY ID_CITA_SER ORDER BY ID_CITA_SER;

-- ¿Qué valores de ID_CITA_SER tienen los servicios que SÍ aparecen en citas reales?
SELECT s.ID_CITA_SER, COUNT(*) AS citas_90d
FROM dbo.CITAS_MEDICAS c
JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
WHERE c.FE_FECH_CIT >= DATEADD(DAY,-90,GETDATE())
GROUP BY s.ID_CITA_SER ORDER BY citas_90d DESC;

-- (13) Volumen — CORRER EN ESEHSVP (catálogo VIVO)  ← BLOQUEANTE #9 ----------
-- USE ESEHSVP;
SELECT COUNT(*) AS citas_ultimos_90d
FROM dbo.CITAS_MEDICAS WHERE FE_FECH_CIT >= DATEADD(DAY,-90,GETDATE());

SELECT CONVERT(date, FE_FECH_CIT) AS dia, COUNT(*) AS citas
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= DATEADD(DAY,-14,GETDATE())
GROUP BY CONVERT(date, FE_FECH_CIT) ORDER BY dia;

-- =============================================================================
-- SEGUNDA RONDA (2026-08-23) — cierra los bloqueantes que quedaron abiertos
-- tras la primera corrida. Sigue siendo 100% SOLO LECTURA (excepto el 17,
-- que se hace DESDE LA APLICACIÓN del HIS, no por SQL).
-- =============================================================================

-- (14) Muestra COMPLETA de citas recientes (todas las columnas)  ← BLOQUEANTE #11
-- Objetivo: ver qué escribe la app en ESP/CONS/LUAT/CONV/TIPO/SOLI... al crear
-- una cita real, para replicar el INSERT campo a campo.
SELECT TOP 15 *
FROM dbo.CITAS_MEDICAS
WHERE FE_ELAB_CIT >= DATEADD(DAY,-30,GETDATE())
ORDER BY FE_ELAB_CIT DESC;

-- (15) Turnos VIGENTES  ← BLOQUEANTE #4 (la muestra anterior salió de 2020 por el ORDER BY)
SELECT TOP 30 * FROM dbo.TURNOS_MEDICOS ORDER BY FE_FECH_TUME DESC, CD_MED_TUME;

SELECT MIN(FE_FECH_TUME) AS turno_mas_antiguo_futuro, MAX(FE_FECH_TUME) AS turno_mas_lejano,
       COUNT(*) AS turnos_futuros, COUNT(DISTINCT CD_MED_TUME) AS medicos_con_turnos
FROM dbo.TURNOS_MEDICOS WHERE FE_FECH_TUME >= GETDATE();

-- Significado de ID_DISP_TUME y NU_TIPO_TUME:
SELECT ID_DISP_TUME, NU_TIPO_TUME, COUNT(*) AS total
FROM dbo.TURNOS_MEDICOS WHERE FE_FECH_TUME >= DATEADD(DAY,-365,GETDATE())
GROUP BY ID_DISP_TUME, NU_TIPO_TUME ORDER BY total DESC;

-- Roles de las tablas hermanas:
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TURNOS_MEDICOS_COSTOS' ORDER BY ORDINAL_POSITION;

-- (16) Convenios: estructura, nombres y regla de asignación  ← BLOQUEANTE #6
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE,
       ISNULL(CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR),'N/A') AS longitud, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('CONVENIOS','EPS') AND TABLE_SCHEMA = 'dbo'
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Nombres de los convenios que concentran las citas (475, 467, 283, 473, 489...):
SELECT TOP 30 * FROM dbo.CONVENIOS;

-- ¿El convenio de la cita coincide con el convenio vigente del paciente (R_PAC_CONV)?
SELECT CASE WHEN rpc.NU_NUME_CONV_RPC IS NULL THEN 'PACIENTE_SIN_R_PAC_CONV'
            WHEN rpc.NU_NUME_CONV_RPC = c.NU_NUME_CONV_CIT THEN 'COINCIDE'
            ELSE 'DIFIERE' END AS regla,
       COUNT(*) AS total
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.R_PAC_CONV rpc ON rpc.NU_HIST_PAC_RPC = c.NU_HIST_PAC_CIT
WHERE c.FE_ELAB_CIT >= DATEADD(DAY,-30,GETDATE())
GROUP BY CASE WHEN rpc.NU_NUME_CONV_RPC IS NULL THEN 'PACIENTE_SIN_R_PAC_CONV'
              WHEN rpc.NU_NUME_CONV_RPC = c.NU_NUME_CONV_CIT THEN 'COINCIDE'
              ELSE 'DIFIERE' END
ORDER BY total DESC;

-- (17) PRUEBA MANUAL DEL CICLO DE VIDA  ← BLOQUEANTE #3 — LA CRÍTICA ---------
-- En PRUEBAS, DESDE LA APLICACIÓN del HIS (no por SQL):
--   a) crear una cita a un paciente de prueba      → correr la query de abajo
--   b) CANCELARLA desde la aplicación              → correr la query otra vez
--   c) si la app lo permite, reagendar ese cupo    → correr la query otra vez
--   d) marcar una cita pasada como cumplida        → correr la query otra vez
-- Comparar los resultados: ¿la fila cambió NU_ESTA_CIT en sitio? ¿apareció una
-- fila nueva y la vieja quedó como historial? ¿o la fila DESAPARECIÓ (DELETE)?
DECLARE @doc VARCHAR(20) = '<documento_paciente_prueba>';
SELECT NU_ESTA_CIT, CD_CODI_MED_CIT, FE_HORA_CIT, FE_FECH_CIT, FE_ELAB_CIT,
       CD_CODI_SER_CIT, NU_NUME_CONV_CIT, NU_NUME_MOVI_CIT, NU_TIPO_CIT, DE_DESC_CIT
FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT = @doc
ORDER BY FE_ELAB_CIT DESC;

-- =============================================================================
-- TERCERA RONDA (2026-08-23) — identificar el CATÁLOGO VIVO
-- La corrida en "producción" mostró una BD sin citas elaboradas en ≥30 días
-- (bloque 14 vacío, 818 citas/90d, 1 médico con turnos futuros), mientras
-- PRUEBAS tenía datos vivos. Hipótesis: los sufijos de año son ARCHIVOS de
-- corte anual y el catálogo vivo es ESEHSVP (sin sufijo).
-- =============================================================================

-- (18) ¿Cuál BD recibe las citas HOY?  ← BLOQUEANTE #12 (CRÍTICO) ------------
-- Si alguna BD no tiene la tabla, comentar su bloque UNION y reintentar.
SELECT 'ESEHSVP' AS bd, COUNT(*) AS citas_total, MAX(FE_ELAB_CIT) AS ultima_elaboracion,
       SUM(CASE WHEN FE_ELAB_CIT >= DATEADD(DAY,-7,GETDATE()) THEN 1 ELSE 0 END) AS elaboradas_7d
FROM ESEHSVP.dbo.CITAS_MEDICAS
UNION ALL
SELECT 'ESEHSVP2024', COUNT(*), MAX(FE_ELAB_CIT),
       SUM(CASE WHEN FE_ELAB_CIT >= DATEADD(DAY,-7,GETDATE()) THEN 1 ELSE 0 END)
FROM ESEHSVP2024.dbo.CITAS_MEDICAS
UNION ALL
SELECT 'ESEHSVP2025', COUNT(*), MAX(FE_ELAB_CIT),
       SUM(CASE WHEN FE_ELAB_CIT >= DATEADD(DAY,-7,GETDATE()) THEN 1 ELSE 0 END)
FROM ESEHSVP2025.dbo.CITAS_MEDICAS
UNION ALL
SELECT 'PRUEBAS', COUNT(*), MAX(FE_ELAB_CIT),
       SUM(CASE WHEN FE_ELAB_CIT >= DATEADD(DAY,-7,GETDATE()) THEN 1 ELSE 0 END)
FROM PRUEBAS.dbo.CITAS_MEDICAS;

-- La BD con `ultima_elaboracion` de HOY/ayer y `elaboradas_7d` > 0 es la VIVA.
-- Una vez identificada: repetir en ELLA los bloques 13, 14, 15 y 16.

-- (19) Convenios que concentran las citas (correr en el catálogo VIVO) --------
SELECT c.NU_NUME_CONV, c.CD_CODI_CONV, c.CD_NIT_EPS_CONV, e.NO_NOMB_EPS,
       c.FE_INIC_CONV, c.FE_FINA_CONV, c.NU_VIGE_CONV, e.NU_ACTIVO_EPS
FROM dbo.CONVENIOS c
LEFT JOIN dbo.EPS e ON e.CD_NIT_EPS = c.CD_NIT_EPS_CONV
WHERE c.NU_NUME_CONV IN (475, 467, 283, 473, 489, 476, 538, 535, 518, 97, 96, 26)
ORDER BY c.NU_NUME_CONV;

-- Convenios VIGENTES hoy (candidatos para citas nuevas):
SELECT c.NU_NUME_CONV, c.CD_CODI_CONV, e.NO_NOMB_EPS, c.FE_INIC_CONV, c.FE_FINA_CONV
FROM dbo.CONVENIOS c
LEFT JOIN dbo.EPS e ON e.CD_NIT_EPS = c.CD_NIT_EPS_CONV
WHERE GETDATE() BETWEEN c.FE_INIC_CONV AND c.FE_FINA_CONV
ORDER BY c.NU_NUME_CONV;

-- =============================================================================
-- QUINTA RONDA — últimos cabos sueltos (solo lectura, correr en ESEHSVP)
-- =============================================================================

-- (20a) ¿Hay jobs programados (SQL Agent) que toquen las tablas del flujo?
-- (limpiezas nocturnas, archivados, recalculos — podrían interferir con el sync)
SELECT j.name AS job, j.enabled, s.step_name, LEFT(s.command, 300) AS comando
FROM msdb.dbo.sysjobs j
JOIN msdb.dbo.sysjobsteps s ON s.job_id = j.job_id
WHERE s.command LIKE '%CITAS_MEDICAS%' OR s.command LIKE '%TURNOS_MEDICOS%'
   OR s.command LIKE '%PACIENTES%'     OR s.command LIKE '%ESEHSVP%';

-- (20b) Origen del consecutivo NU_NUME_CONE_CIT: ¿tabla de consecutivos/conexiones?
SELECT name FROM sys.tables
WHERE name LIKE '%CONSE%' OR name LIKE '%CONEX%' OR name LIKE '%PARAMETRO%'
ORDER BY name;
-- Si aparece una tabla tipo CONEXIONES/CONSECUTIVOS: SELECT TOP 5 * de ella y compartir.

-- (20c) Fuente de la especialidad de la cita: estructura y muestra de R_MEDI_ESPE
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'R_MEDI_ESPE' ORDER BY ORDINAL_POSITION;
SELECT TOP 20 * FROM dbo.R_MEDI_ESPE;

-- (20d) Mapa consultorio / centro de costos / lugar de atención
SELECT name FROM sys.tables
WHERE name LIKE '%CONSULTORIO%' OR name LIKE '%LUGAR%' OR name LIKE '%CECO%' OR name LIKE '%CENTRO%'
ORDER BY name;
SELECT * FROM dbo.LUGAR_ATENCION;

-- (20e) Turnos tipo 1: ¿qué son? (muestra para comparar contra tipo 0)
SELECT TOP 10 * FROM dbo.TURNOS_MEDICOS
WHERE NU_TIPO_TUME = 1 AND FE_FECH_TUME >= GETDATE() ORDER BY FE_FECH_TUME;

-- (20f) Catálogo TIPOSERVICIO completo (faltaba el valor 1)
SELECT * FROM dbo.TIPOSERVICIO;

-- =============================================================================
-- SEXTA RONDA — fuentes contextuales del INSERT (bloqueante #13; solo lectura,
-- correr en ESEHSVP). Última milla antes de poder armar el INSERT sin inventar.
-- =============================================================================

-- (21a) Consecutivo de sesión NU_NUME_CONE_CIT: muestras de las candidatas
-- (si algún ORDER BY falla por el nombre de columna, quitarlo y reenviar igual)
SELECT TOP 5 * FROM dbo.CONEXION;
SELECT TOP 5 * FROM dbo.CONEXIONES;
SELECT TOP 5 * FROM dbo.CONSECUTIVOS;

-- (21b) Especialidad por servicio (fuente probable de CD_CODI_ESP_CIT)
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'R_ESP_SER' ORDER BY ORDINAL_POSITION;
SELECT TOP 20 * FROM dbo.R_ESP_SER;

-- (21c) Consultorios y su sede/centro de costos (fuente de CONS/CECO/LUAT)
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'CONSULTORIOS' ORDER BY ORDINAL_POSITION;
SELECT TOP 20 * FROM dbo.CONSULTORIOS;

-- (21d) Verificación cruzada: ¿la especialidad de la cita = la del servicio?
SELECT TOP 30 c.CD_CODI_SER_CIT, c.CD_CODI_ESP_CIT AS esp_en_cita, r.CD_CODI_ESP_RES AS esp_del_servicio
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.R_ESP_SER r ON r.CD_CODI_SER_RES = c.CD_CODI_SER_CIT
WHERE c.FE_ELAB_CIT >= DATEADD(DAY,-7,GETDATE())
ORDER BY c.FE_ELAB_CIT DESC;
-- (si la columna de especialidad en R_ESP_SER tiene otro nombre, ajustarla según
-- el resultado del bloque 21b y reenviar)

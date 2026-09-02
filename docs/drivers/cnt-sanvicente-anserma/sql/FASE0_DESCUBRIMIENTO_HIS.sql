-- =============================================================================
-- FASE 0 — DESCUBRIMIENTO DEL HIS (100% SOLO LECTURA — no modifica nada)
-- Ejecutar en SSMS conectado a la BD PRUEBAS (bloque 13 también en ESEHSVP2025
-- para volúmenes reales). Compartir el resultado de CADA bloque con el equipo.
-- Numeración alineada con docs/drivers/cnt-sanvicente-anserma/MAPEO_HIS.md §5.
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
-- ✅ Esquema YA CONFIRMADO 2026-08-28 vía SSMS Object Explorer (no hace falta
-- rendir esta parte): CD_CODI_CONS varchar(8) PK, DE_DESC_CONS varchar(30),
-- DE_UBIC_CONS varchar(40), NU_ACTIVO_CONS bit NOT NULL (con DEFAULT). Falta
-- el contenido real — correr igual para tener el catálogo completo:
SELECT TOP 20 * FROM dbo.CONSULTORIOS;

-- (21d) Verificación cruzada: ¿la especialidad de la cita = la del servicio?
SELECT TOP 30 c.CD_CODI_SER_CIT, c.CD_CODI_ESP_CIT AS esp_en_cita, r.CD_CODI_ESP_RES AS esp_del_servicio
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.R_ESP_SER r ON r.CD_CODI_SER_RES = c.CD_CODI_SER_CIT
WHERE c.FE_ELAB_CIT >= DATEADD(DAY,-7,GETDATE())
ORDER BY c.FE_ELAB_CIT DESC;
-- (si la columna de especialidad en R_ESP_SER tiene otro nombre, ajustarla según
-- el resultado del bloque 21b y reenviar)

-- =============================================================================
-- SÉPTIMA RONDA (2026-08-23) — CITAS_ANULADAS
-- La prueba manual del hospital (bloque 17) reveló que cancelar una cita hace
-- DELETE en CITAS_MEDICAS + INSERT de auditoría en esta tabla, antes desconocida.
-- Cierra el bloqueante #15 (última pieza no crítica del ciclo de vida).
-- =============================================================================

-- (22a) Esquema completo de CITAS_ANULADAS
SELECT COLUMN_NAME, DATA_TYPE,
       ISNULL(CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR),'N/A') AS longitud, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'CITAS_ANULADAS' AND TABLE_SCHEMA = 'dbo'
ORDER BY ORDINAL_POSITION;

-- (22b) Muestra reciente (para ver formato real de Motivo/Observaciones y fechas)
SELECT TOP 20 * FROM dbo.CITAS_ANULADAS ORDER BY FE_ELAB_CIAN DESC;
-- (si el nombre de la columna de fecha de elaboración es distinto, quitar el
-- ORDER BY y reenviar el resultado igual)

-- (22c) Catálogo de motivos de cancelación (para que el agente use uno propio
-- reconocible cuando AgenIA cancela una cita reflejada en el HIS)
SELECT name FROM sys.tables WHERE name LIKE '%MOTIVO%' ORDER BY name;
-- Si aparece una tabla de motivos: SELECT * de ella y compartir.
-- Si el motivo es texto libre sin catálogo, compartir los valores distintos usados:
-- SELECT DISTINCT <columna_motivo> FROM dbo.CITAS_ANULADAS;   -- (ajustar nombre de columna)

-- (22d) PK/índices de CITAS_ANULADAS (para el diseño del correlacionador de eventos)
SELECT i.name AS indice, c.name AS columna, ic.key_ordinal, i.is_primary_key
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c        ON c.object_id  = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID('dbo.CITAS_ANULADAS')
ORDER BY i.is_primary_key DESC, ic.key_ordinal;

-- =============================================================================
-- OCTAVA RONDA (2026-08-23) — cierre de CITAS_ANULADAS + trazabilidad de origen.
-- Esquema de CITAS_ANULADAS ya confirmado (24 columnas, sin PK/FK/triggers).
-- Falta: contenido de MOTIVOANUL, una muestra fila-a-fila válida (la anterior
-- vino incompleta), y de dónde sale "Asignada Por" del comprobante impreso.
-- =============================================================================

-- (23a) Catálogo de motivos de anulación — el que importa es MOTIVOANUL
-- (las otras tablas MOTIVO_* vistas en el bloque 22c son de otros procesos:
-- glosas, ajustes de cuenta, triage, remisión, recibo, no autorización)
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'MOTIVOANUL' ORDER BY ORDINAL_POSITION;

SELECT * FROM dbo.MOTIVOANUL;

-- (23b) Muestra fila-a-fila de CITAS_ANULADAS (corregida: ORDER BY explícito
-- por la columna real de fecha de elaboración, ya confirmada)
SELECT TOP 20
    CD_CODI_MED_CIAN, CD_CODI_SER_CIAN, NU_HIST_PAC_CIAN, FE_HORA_CIAN,
    FE_ELAB_CIAN, FE_FECH_CIAN, CD_CODI_MOTI_CIAN, TX_OBSE_CIAN,
    NU_CONE_ANUL_CIAN, NU_NUME_CONV_CIAN
FROM dbo.CITAS_ANULADAS
ORDER BY FE_ELAB_CIAN DESC;

-- Distribución real de motivos usados (para saber cuáles son los más comunes
-- y elegir/crear el motivo que usará el agente cuando AgenIA cancela):
SELECT CD_CODI_MOTI_CIAN, COUNT(*) AS total
FROM dbo.CITAS_ANULADAS
GROUP BY CD_CODI_MOTI_CIAN
ORDER BY total DESC;

-- (23c) Trazabilidad de origen: buscar la columna "Asignada Por" del comprobante
-- Candidatas por nombre en CITAS_MEDICAS y CITAS_ANULADAS:
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('CITAS_MEDICAS','CITAS_ANULADAS')
  AND (COLUMN_NAME LIKE '%USUA%' OR COLUMN_NAME LIKE '%ASIG%' OR COLUMN_NAME LIKE '%OPER%'
       OR COLUMN_NAME LIKE '%LOGIN%' OR COLUMN_NAME LIKE '%CREADOR%')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- Si no aparece nada ahí, el dato puede vivir en una tabla de auditoría aparte
-- o en el log de aplicación (no en la BD) — candidatas genéricas de auditoría:
SELECT name FROM sys.tables
WHERE name LIKE '%AUDIT%' OR name LIKE '%LOG%' OR name LIKE '%USUARIO%'
ORDER BY name;
-- Si se identifica la tabla/columna correcta, compartir su estructura y una
-- muestra para la cita de prueba (médico 76, paciente 9696544, 2026-08-27).

-- =============================================================================
-- NOVENA RONDA (2026-08-23) — cierre de "Asignada Por" (bloqueante #17).
-- La búsqueda directa por nombre de columna en CITAS_MEDICAS/CITAS_ANULADAS dio
-- vacío. El dato probablemente vive en una tabla de auditoría genérica correlada
-- por transacción/timestamp, no como columna propia de la cita. Candidatos
-- hallados en el bloque 23c: AUDITORIA_COT, HIST_AUDIT, LOG_AUDITORIA_SGIO,
-- C_USUARIO/USUARIO. Requisito de negocio confirmado: el hospital quiere poder
-- distinguir a simple vista las citas creadas por WhatsApp/AgenIA.
-- =============================================================================

-- (24a) Estructura de los candidatos más prometedores
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('AUDITORIA_COT','HIST_AUDIT','LOG_AUDITORIA_SGIO','USUARIO','C_USUARIO')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- (24b) Buscar en HIST_AUDIT/AUDITORIA_COT algo correlacionable con la cita de
-- prueba por tabla+fecha (médico 76, paciente 9696544, creada 2026-08-27 14:25)
SELECT TOP 20 * FROM dbo.HIST_AUDIT
WHERE 1=1
  -- ajustar el nombre de columna de fecha según el resultado de 24a, ej.:
  -- AND FECHA >= '2026-08-27 14:00' AND FECHA <= '2026-08-27 14:30'
ORDER BY 1 DESC;

SELECT TOP 20 * FROM dbo.AUDITORIA_COT
WHERE 1=1
ORDER BY 1 DESC;

-- (24c) Usuarios del sistema — el texto "ADMINISTRADOR" del comprobante podría
-- ser simplemente el nombre de un usuario en este catálogo, y "Asignada Por"
-- vendría de la sesión activa al grabar (no de una columna en CITAS_MEDICAS)
SELECT TOP 20 * FROM dbo.USUARIO WHERE 1=1;
-- Buscar específicamente si existe un usuario tipo "ADMINISTRADOR":
-- SELECT * FROM dbo.USUARIO WHERE <columna_nombre> LIKE '%ADMIN%';   -- ajustar columna

-- (24d) Si NINGUNO de los anteriores da resultado: probablemente "Asignada Por"
-- es una etiqueta generada en la CAPA DE APLICACIÓN (a partir del usuario logueado
-- en el momento, sin persistirse en una tabla dedicada) — en ese caso, la única
-- vía real de marcar el origen "WhatsApp/AgenIA" es que el hospital cree en su
-- app un usuario/login propio para nuestro agente (ej. "AGENIA" o "WHATSAPP"),
-- y que ese usuario sea el que quede registrado como "Asignada Por" al insertar
-- la cita — a confirmar directamente con el proveedor CNT o con TI del hospital,
-- ya no es indagable por SQL de solo lectura.

-- =============================================================================
-- DÉCIMA RONDA (2026-08-28) — validar a escala "el consultorio de la cita se
-- copia del turno del médico ese día" (hoy solo confirmada por 1 caso manual +
-- 1 muestra puntual, MAPEO_HIS.md §2.1/§2.1bis). Motivador: un comprobante
-- impreso mostró "51-CONSULTORIO APS-01" — el CÓDIGO real probablemente es
-- '51' y "CONSULTORIO APS-01" es solo la etiqueta (DE_DESC_CONS) — a confirmar
-- también con (25b). Correr en ESEHSVP (o PRUEBAS si no hay acceso aún).
-- =============================================================================

-- (25a) ¿La cita SIEMPRE coincide con el consultorio del turno que la cubre?
SELECT resultado, COUNT(*) AS total FROM (
    SELECT CASE
        WHEN c.CD_CODI_CONS_CIT = t.CD_CODI_CONS_TUME THEN 'COINCIDE'
        WHEN t.NU_NUME_TUME IS NULL THEN 'SIN_TURNO_QUE_CUBRA'
        ELSE 'DIFIERE'
        END AS resultado
    FROM dbo.CITAS_MEDICAS c
    LEFT JOIN dbo.TURNOS_MEDICOS t
        ON t.CD_MED_TUME = c.CD_CODI_MED_CIT
        AND t.FE_FECH_TUME = c.FE_FECH_CIT
        AND CAST(RIGHT(c.FE_HORA_CIT,5) AS TIME)
            BETWEEN CAST(t.FE_HOIN_TUME AS TIME) AND CAST(t.FE_HOFI_TUME AS TIME)
    WHERE c.FE_ELAB_CIT >= DATEADD(DAY,-30,GETDATE())
      AND c.NU_ESTA_CIT = 0
) x
GROUP BY resultado
ORDER BY total DESC;
-- Lectura: si 'DIFIERE' + 'SIN_TURNO_QUE_CUBRA' es <5% del total, la hipótesis
-- queda confirmada como regla de escritura del driver (createAppointment lee
-- TURNOS_MEDICOS en el momento, no necesita tabla propia). Si es alto, revisar
-- casos DIFIERE fila a fila con la consulta de detalle de abajo.

-- (25b) Detalle fila a fila de los casos que no coinciden (para entender por qué)
SELECT TOP 30
    c.CD_CODI_MED_CIT, c.FE_HORA_CIT,
    c.CD_CODI_CONS_CIT AS consultorio_en_cita,
    t.CD_CODI_CONS_TUME AS consultorio_en_turno
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.TURNOS_MEDICOS t
    ON t.CD_MED_TUME = c.CD_CODI_MED_CIT
    AND t.FE_FECH_TUME = c.FE_FECH_CIT
    AND CAST(RIGHT(c.FE_HORA_CIT,5) AS TIME)
        BETWEEN CAST(t.FE_HOIN_TUME AS TIME) AND CAST(t.FE_HOFI_TUME AS TIME)
WHERE c.FE_ELAB_CIT >= DATEADD(DAY,-30,GETDATE())
  AND c.NU_ESTA_CIT = 0
  AND (t.NU_NUME_TUME IS NULL OR c.CD_CODI_CONS_CIT <> t.CD_CODI_CONS_TUME)
ORDER BY c.FE_ELAB_CIT DESC;

-- (25c) Catálogo completo de consultorios — para confirmar si '51' existe
-- y corresponde a "CONSULTORIO APS-01" (corrige o confirma la hipótesis del
-- comprobante impreso; ver nota arriba)
SELECT * FROM dbo.CONSULTORIOS ORDER BY CD_CODI_CONS;

-- =============================================================================
-- SEXTA RONDA — NU_SEXO_PAC: qué número es cuál  ← BLOQUEANTE previo al primer
-- INSERT real (ver la advertencia en mapping.ts, AnsermaMapping.sexo)
--
-- Hoy el driver escribe M→0 / F→1 por decisión PROVISIONAL, sin confirmar
-- contra la base del hospital. Escribirlo al revés deja el sexo equivocado en
-- la historia clínica de una persona — no es un campo que se pueda adivinar.
--
-- CORRER EN ESEHSVP (catálogo vivo). Es 100% lectura, no modifica nada.
-- =============================================================================
USE ESEHSVP;
GO

-- (26a) Ancla directa: el paciente del piloto guiado por el hospital.
-- CC 9696544 = ROMERO RENDON CARLOS ARTURO — masculino, sin ambigüedad
-- (confirmado en evidencia/PRUEBA_CICLO_VIDA_CNT_2026-08-23.md, bloque 17).
-- El valor que salga aquí para NU_SEXO_PAC ES el código de "masculino".
SELECT NU_HIST_PAC, NU_DOCU_PAC, NO_NOMB_PAC, NU_SEXO_PAC, FE_NACI_PAC
FROM dbo.PACIENTES
WHERE NU_HIST_PAC = '9696544';

-- (26b) Todos los valores que existe realmente en la columna, y cuántos.
-- NU_SEXO_PAC es tinyint NOT NULL con DEFAULT 0 (MAPEO_HIS.md §2.3, bloque 9):
-- si aparece un tercer valor además de 0/1, no es "M/F" — hay que investigar
-- qué es antes de asumir binario.
SELECT NU_SEXO_PAC, COUNT(*) AS pacientes
FROM dbo.PACIENTES
GROUP BY NU_SEXO_PAC
ORDER BY NU_SEXO_PAC;

-- (26c) Validación estadística por nombre, para no depender de una sola fila.
-- NO_NOMB_PAC no tiene el nombre partido (a diferencia de MEDICOS —
-- TX_PRNOM_MED/TX_SGNOM_MED/...; ver ESTADO.md pendiente #9), así que se busca
-- como palabra completa dentro del campo. Nombres de género inequívoco en
-- español/colombiano, alta frecuencia, sin variantes ambiguas.
SELECT
    NU_SEXO_PAC,
    SUM(CASE WHEN genero_por_nombre = 'M' THEN 1 ELSE 0 END) AS nombres_masculinos,
    SUM(CASE WHEN genero_por_nombre = 'F' THEN 1 ELSE 0 END) AS nombres_femeninos
FROM (
    SELECT
        NU_SEXO_PAC,
        CASE
            WHEN ' ' + NO_NOMB_PAC + ' ' LIKE '% CARLOS %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% JOSE %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% JUAN %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% LUIS %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% JORGE %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% ANDRES %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% MIGUEL %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% FERNANDO %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% RICARDO %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% ALBERTO %'
                THEN 'M'
            WHEN ' ' + NO_NOMB_PAC + ' ' LIKE '% MARIA %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% LUZ %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% ANA %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% CLAUDIA %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% SANDRA %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% MARTHA %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% GLORIA %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% PATRICIA %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% ADRIANA %'
              OR ' ' + NO_NOMB_PAC + ' ' LIKE '% YOLANDA %'
                THEN 'F'
            ELSE NULL
        END AS genero_por_nombre
    FROM dbo.PACIENTES
) x
WHERE genero_por_nombre IS NOT NULL
GROUP BY NU_SEXO_PAC
ORDER BY NU_SEXO_PAC;
-- Lectura: si NU_SEXO_PAC=0 concentra casi todos los "nombres_masculinos" (y
-- pocos femeninos) y NU_SEXO_PAC=1 al revés, confirma 0=M/1=F — que es lo que
-- el driver ya asume. Si sale al revés, hay que invertir `AnsermaMapping.sexo`
-- ANTES de escribir la primera cita real. Un cruce mixto (ni 0 ni 1 domina
-- claramente en ningún lado) significa que el campo no es un booleano de sexo
-- como se está asumiendo, y hay que avisar antes de seguir.

-- (26d) Muestra fila a fila para revisar a ojo, con el nombre completo.
SELECT TOP 30 NU_HIST_PAC, NO_NOMB_PAC, NU_SEXO_PAC
FROM dbo.PACIENTES
WHERE NO_NOMB_PAC LIKE '% CARLOS %' OR NO_NOMB_PAC LIKE '% MARIA %'
ORDER BY NU_HIST_PAC;

-- =============================================================================
-- RESULTADO (2026-09-01, corrida contra ESEHSVP):
--   (26a) CC 9696544 = "CARLOS" (un solo nombre, no el completo del
--         comprobante impreso — ver nota abajo) → NU_SEXO_PAC = 1.
--   (26c) NU_SEXO_PAC=0: 307 nombres masculinos / 11.287 femeninos.
--         NU_SEXO_PAC=1: 10.740 masculinos / 291 femeninos.
--   (26d) "HIJO DE ..." → 1, "HIJA/HJA DE ..." → 0.
--
--   ⇒ CONFIRMADO: NU_SEXO_PAC = 1 → Masculino, 0 → Femenino. La tabla
--     provisional del driver (M:0, F:1) estaba INVERTIDA — corregida en
--     mapping.ts. Ver docs/drivers/cnt-sanvicente-anserma/ESTADO.md.
--
--   Efecto colateral (no bloqueante): NO_NOMB_PAC para el paciente ancla es
--   "CARLOS", no "ROMERO RENDON CARLOS ARTURO". PACIENTES no tiene columnas
--   de nombre partido en INFORMATION_SCHEMA (a diferencia de MEDICOS) — sigue
--   como pendiente #9 en ESTADO.md, todavía sin bloque de descubrimiento propio.
-- =============================================================================

-- =============================================================================
-- SÉPTIMA RONDA — de dónde sale el nombre completo del paciente
-- (pendiente #9 de ESTADO.md). El comprobante impreso del piloto (bloque 17)
-- mostró "ROMERO RENDON CARLOS ARTURO", pero PACIENTES.NO_NOMB_PAC para ese
-- mismo paciente (CC 9696544) vale literalmente "CARLOS" (bloque 26a). Dos
-- hipótesis a distinguir: (a) NO_NOMB_PAC SÍ es el nombre completo y esta fila
-- es una captura vieja/incompleta (historia abierta en 2009); (b) NO_NOMB_PAC
-- es solo "primer nombre" por diseño y el resto vive en otra parte que no
-- hemos encontrado (columna oculta a INFORMATION_SCHEMA por permisos — es
-- justo lo que pasó con CONSULTORIOS en la ronda anterior, bloque 25c — o una
-- tabla satélite, o el comprobante lo arma la app desde otra fuente).
--
-- CORRER EN ESEHSVP. 100% lectura.
-- =============================================================================
USE ESEHSVP;
GO

-- (27a) Reconfirmar el esquema de PACIENTES con sys.columns, NO con
-- INFORMATION_SCHEMA — que fue justo lo que se saltó una columna real en
-- CONSULTORIOS por un tema de permisos de metadatos (bloque 25c). Si aquí
-- aparece algo que el 27a original no mostró (ej. algo con "APEL" en el
-- nombre), ahí está la respuesta.
SELECT c.name AS columna, ty.name AS tipo, c.max_length, c.is_nullable
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
WHERE t.name = 'PACIENTES'
ORDER BY c.column_id;

-- (27b) ¿Cuántas palabras tiene NO_NOMB_PAC en la práctica? Si "CARLOS" (una
-- sola palabra) es la EXCEPCIÓN y la mayoría de pacientes tiene 3-4 palabras
-- (nombre completo), confirma la hipótesis (a): esta fila es una captura vieja
-- incompleta, no la norma. Si "una sola palabra" es común, apunta a (b).
SELECT
    LEN(NO_NOMB_PAC) - LEN(REPLACE(NO_NOMB_PAC, ' ', '')) + 1 AS num_palabras,
    COUNT(*) AS pacientes
FROM dbo.PACIENTES
WHERE NO_NOMB_PAC IS NOT NULL AND LTRIM(RTRIM(NO_NOMB_PAC)) <> ''
GROUP BY LEN(NO_NOMB_PAC) - LEN(REPLACE(NO_NOMB_PAC, ' ', '')) + 1
ORDER BY num_palabras;

-- (27c) Buscar, en TODOS los procedimientos y vistas del servidor, cualquiera
-- que combine PACIENTES con algo relacionado a nombre/apellido — así se
-- encontraron los candidatos de "Asignada Por" en el bloque 24. Si el
-- comprobante arma "ROMERO RENDON CARLOS ARTURO" desde una fuente que no es
-- PACIENTES.NO_NOMB_PAC solo, un objeto de este tipo lo revela.
SELECT o.type_desc, s.name + '.' + o.name AS objeto, o.modify_date
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE m.definition LIKE '%PACIENTES%'
  AND (m.definition LIKE '%APEL%' OR m.definition LIKE '%NOMB%')
ORDER BY o.type_desc, objeto;

-- (27d) ¿Existe una tabla satélite de PACIENTES, con FK hacia ella, que pueda
-- guardar apellidos por separado? El mismo patrón que reveló CITAS_ANULADAS
-- como satélite de CITAS_MEDICAS.
SELECT
    fk.name AS foreign_key,
    OBJECT_NAME(fk.parent_object_id) AS tabla_que_referencia,
    OBJECT_NAME(fk.referenced_object_id) AS tabla_referenciada
FROM sys.foreign_keys fk
WHERE OBJECT_NAME(fk.referenced_object_id) = 'PACIENTES'
   OR OBJECT_NAME(fk.parent_object_id) = 'PACIENTES';

-- Complemento: cualquier tabla del servidor cuyo NOMBRE sugiera que guarda
-- apellidos o datos extendidos de paciente (por si no hay FK declarada —
-- ya se vio que este HIS no usa FKs/triggers de forma consistente).
SELECT name AS tabla FROM sys.tables
WHERE name LIKE '%PAC%' AND name <> 'PACIENTES'
ORDER BY name;

-- (27e) Historial de cambios sobre ESTE paciente en las tablas de auditoría ya
-- localizadas en el bloque 24 (AUDITORIA_COT, HIST_AUDIT, LOG_AUDITORIA_SGIO)
-- — por si NO_NOMB_PAC tuvo un valor más completo antes y se recortó, o por si
-- estas tablas tienen su propio campo de nombre con más detalle. Ajustar la
-- columna del WHERE según lo que devuelva 24a para cada tabla (documento o
-- historia del paciente, "9696544").
SELECT TOP 20 * FROM dbo.HIST_AUDIT
WHERE 1=1
  -- AND <columna_documento_o_historia> = '9696544'
ORDER BY 1 DESC;

SELECT TOP 20 * FROM dbo.AUDITORIA_COT
WHERE 1=1
  -- AND <columna_documento_o_historia> = '9696544'
ORDER BY 1 DESC;

-- (27f) Muestra amplia para ver el patrón general fuera de este único
-- paciente: 20 casos de "una sola palabra" y 20 de "nombre largo", elegidos al
-- azar por antigüedad de la historia — si el patrón de una sola palabra
-- concentra en historias MUY viejas, refuerza que es dato legado, no diseño.
SELECT TOP 20 NU_HIST_PAC, NO_NOMB_PAC, FE_HIST_PAC
FROM dbo.PACIENTES
WHERE NO_NOMB_PAC NOT LIKE '% %'
ORDER BY FE_HIST_PAC ASC;

SELECT TOP 20 NU_HIST_PAC, NO_NOMB_PAC, FE_HIST_PAC
FROM dbo.PACIENTES
WHERE NO_NOMB_PAC LIKE '% % % %'
ORDER BY FE_HIST_PAC DESC;

-- =============================================================================
-- RESULTADO DEL BLOQUE 27 (2026-09-01, ESEHSVP):
--
--   (27a) PACIENTES tiene 62 COLUMNAS, no las 13 que teníamos documentadas.
--         El nombre va PARTIDO EN CUATRO, igual que en MEDICOS:
--           NO_NOMB_PAC varchar(20) NOT NULL  primer nombre
--           NO_SGNO_PAC varchar(20)           segundo nombre
--           DE_PRAP_PAC varchar(30)           primer apellido
--           DE_SGAP_PAC varchar(30)           segundo apellido
--         ⇒ hipótesis (b) confirmada. Cierra el pendiente #9 de ESTADO.md.
--
--   (27b) 76.268 pacientes con UNA sola palabra en NO_NOMB_PAC (98,3%), 898
--         con dos, 1.390 con tres, 188 con cuatro, 3 con cinco. Las de varias
--         palabras son recién nacidos sin nombre propio ("HIJO 3 DE YURANI").
--
--   (27c) 30 objetos combinan PACIENTES con nombre/apellido — todos de
--         facturación, RIPS y reportes normativos. Ninguno de agendamiento:
--         coherente con lo ya sabido (la app escribe DML directo). Aparecen
--         SP_INTEROPERABILIDAD, SP_INTEROPERABILIDAD_HC_FHIR y
--         SP_INTEROPERABILIDAD_IHC_V2 — el hospital YA tiene procedimientos de
--         interoperabilidad, incluido FHIR. No hace falta para el espejo, pero
--         merece una mirada si algún día se plantea otra vía de integración.
--
--   (27d) Ninguna tabla satélite de apellidos: están en PACIENTES. Se
--         confirman como satélites conocidos R_PAC_EPS, CITAS_TELEMEDICINA,
--         HISTORIACLINICA, LOGIN_WEB, ANTECEDENTES, DIAGNOSTICOS, ORDENES.
--
--   (27e) HIST_AUDIT NO es auditoría de cambios de datos: son notas de
--         auditoría CLÍNICA sobre historias ("NO REALIZA ARGUMENTACION
--         DIAGNOSTICA..."). Fuera del alcance del espejo.
--         🔎 PISTA PARA EL BLOQUE 21a: su columna NU_NUME_CONE_HAUD trae
--         valores del MISMO rango que NU_NUME_CONE_CIT (1.283.567–1.287.914).
--         Es el consecutivo de sesión que seguimos buscando, y aquí aparece
--         junto a una fecha exacta — sirve para correlacionarlo.
--
--   ⇒ DEFECTO ENCONTRADO Y CORREGIDO: el driver escribía el nombre completo
--     en NO_NOMB_PAC (varchar 20). El mock lo declaraba varchar(60) y lo
--     dejaba pasar; en el hospital habría fallado con el error 8152 para casi
--     cualquier paciente. Ver partirNombre() en mapping.ts.
-- =============================================================================

-- =============================================================================
-- OCTAVA RONDA — volcado del esquema REAL de las tablas que toca el driver.
--
-- Motivo: `PACIENTES` parecía documentada y no lo estaba. Solo teníamos su
-- lista de NOT NULL, el mock se construyó con eso, y la diferencia escondió un
-- defecto que habría roto producción (bloque 27). El resto de tablas están en
-- la misma situación o mejor, pero "documentado" no es lo mismo que
-- "verificado contra el esquema vivo", y no sabemos cuáles son cuáles.
--
-- CORRER EN ESEHSVP. 100% lectura. Copiar el resultado COMPLETO (en SSMS:
-- clic derecho sobre la cuadrícula → "Copy with Headers") y pegarlo aquí en
-- el chat, igual que con los bloques 26 y 27 — de ahí sale el contraste
-- contra el mock local y el resto de la documentación.
-- =============================================================================
USE ESEHSVP;
GO

SELECT
    t.name                                        AS tabla,
    c.name                                        AS columna,
    ty.name                                       AS tipo,
    CASE WHEN ty.name LIKE '%char%' THEN c.max_length ELSE NULL END AS ancho,
    CASE WHEN c.is_nullable = 1 THEN 'SI' ELSE 'NO' END AS acepta_nulos
FROM sys.columns c
JOIN sys.tables t  ON t.object_id = c.object_id
JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
WHERE t.name IN (
    -- Donde el driver ESCRIBE: un ancho mal aquí es un error 8152 en cara del
    -- paciente. Máxima prioridad.
    'CITAS_MEDICAS', 'CITAS_ANULADAS', 'PACIENTES',
    -- Donde LEE: un ancho mal no rompe, pero una columna que no existe sí.
    'TURNOS_MEDICOS', 'MEDICOS', 'SERVICIOS', 'CONSULTORIOS',
    'CONVENIOS', 'EPS', 'R_PAC_EPS', 'MOTIVOANUL', 'TIPO_DOCUMENTO'
)
ORDER BY t.name, c.column_id;

-- =============================================================================
-- BLOQUE 29 — ¿Cuánto le cuesta al hospital que el agente lea su agenda?
--
-- POR QUÉ ESTE BLOQUE
-- El agente hace polling diferencial: cada vuelta lee la ventana de vigilancia
-- COMPLETA de CITAS_MEDICAS (90 días, ~28.000 filas) y la compara contra la
-- foto anterior. Hoy ese bucle corre cada 5 segundos ⇒ unas 17.000 lecturas
-- diarias sobre la base VIVA del hospital. Antes de encender esto en
-- producción hay que saber si es una consulta barata o un escaneo completo de
-- una tabla de años.
--
-- Y HAY UNA SEGUNDA PREGUNTA, MÁS IMPORTANTE QUE LA PRIMERA
-- El driver filtra hoy así:
--     WHERE CONVERT(varchar(10), FE_FECH_CIT, 23) BETWEEN @desde AND @hasta
-- Envolver la columna en una función la vuelve NO SARGABLE: SQL Server no
-- puede usar un índice sobre FE_FECH_CIT aunque exista, y se ve obligado a
-- evaluar la conversión fila por fila. Es decir: puede que la respuesta a
-- "¿hay índice?" sea SÍ y aun así no sirva de nada.
--
-- Esa forma se adoptó para arreglar un defecto real (comparar una columna de
-- fecha local contra un instante UTC desplazaba la ventana hasta un día
-- entero, y las citas que salían de ella se reportaban como canceladas). Pero
-- el mismo arreglo se puede escribir manteniendo la columna desnuda y pasando
-- el borde como literal de fecha, que es sargable. Por eso aquí se miden LAS
-- DOS FORMAS con la misma ventana: la respuesta decide si hay que cambiar la
-- consulta, pedir un índice, bajar la frecuencia, o las tres cosas.
--
-- ⚠️ TODO ESTE BLOQUE ES DE SOLO LECTURA. No crea índices ni cambia nada.
-- ⚠️ NO ejecutar DBCC DROPCLEANBUFFERS / FREEPROCCACHE para "medir en frío":
--    vaciaría la caché de TODO el servidor y se lo haría notar a los usuarios.
--    Basta con correr cada consulta dos veces y quedarse con la segunda.
-- =============================================================================
USE ESEHSVP;
GO

-- (29a) TODOS los índices de las dos tablas que el agente relee sin parar, con
-- sus columnas clave en orden. Un índice sobre FE_FECH_CIT solo sirve si la
-- fecha es la PRIMERA columna de la clave (o la primera tras columnas fijadas
-- por igualdad, que aquí no hay).
SELECT
    t.name                                   AS tabla,
    i.name                                   AS indice,
    i.type_desc                              AS tipo,
    CASE WHEN i.is_primary_key = 1 THEN 'PK'
         WHEN i.is_unique      = 1 THEN 'UNICO'
         ELSE '' END                         AS clase,
    ic.key_ordinal                           AS orden,
    c.name                                   AS columna,
    CASE WHEN ic.is_included_column = 1 THEN 'INCLUIDA' ELSE 'CLAVE' END AS rol
FROM sys.indexes i
JOIN sys.tables t          ON t.object_id  = i.object_id
JOIN sys.index_columns ic  ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c         ON c.object_id  = ic.object_id AND c.column_id = ic.column_id
WHERE t.name IN ('CITAS_MEDICAS', 'TURNOS_MEDICOS')
ORDER BY t.name, i.name, ic.is_included_column, ic.key_ordinal;

-- (29b) Tamaño real: cuántas filas y cuántos MB tiene que recorrer si escanea.
-- La tabla acumula años (92.464 anulaciones históricas ⇒ el orden de magnitud
-- de CITAS_MEDICAS es de cientos de miles de filas).
SELECT
    OBJECT_NAME(ps.object_id)                        AS tabla,
    SUM(CASE WHEN ps.index_id IN (0,1) THEN ps.row_count ELSE 0 END) AS filas,
    CAST(SUM(ps.used_page_count) * 8.0 / 1024 AS decimal(10,1))      AS mb
FROM sys.dm_db_partition_stats ps
WHERE OBJECT_NAME(ps.object_id) IN ('CITAS_MEDICAS', 'TURNOS_MEDICOS')
GROUP BY OBJECT_NAME(ps.object_id);

-- (29c) y (29d): las dos formas, con la MISMA ventana.
--
-- ⚠️ CORREGIDO (2026-09-02): la primera versión devolvía las ~28.000 filas de
-- la ventana a la grilla, y eran imposibles de copiar — 5.200 líneas en el
-- portapapeles. Pero las filas nunca fueron el objetivo: lo que se mide es el
-- COSTO. Ahora el resultado se vuelca en variables, así que SQL Server lee
-- exactamente las mismas filas y hace exactamente el mismo trabajo, pero no
-- devuelve nada a la pantalla. Lo único que sale es la pestaña "Messages",
-- que es justo lo que hay que reportar.
--
-- 👉 Antes de correr: activar "Include Actual Execution Plan" (Ctrl+M). En el
--    plan hay que mirar si sobre CITAS_MEDICAS aparece "Index Seek" o "Scan".
-- 👉 Correr el lote DOS VECES y reportar los números de la SEGUNDA (la primera
--    paga la lectura de disco y ensucia la comparación).
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
GO

DECLARE @desde23  varchar(10) = CONVERT(varchar(10), GETDATE(), 23);              -- 'YYYY-MM-DD'
DECLARE @hasta23  varchar(10) = CONVERT(varchar(10), DATEADD(day, 90, GETDATE()), 23);
DECLARE @desde112 varchar(8)  = CONVERT(varchar(8),  GETDATE(), 112);             -- 'YYYYMMDD'
DECLARE @hasta112 varchar(8)  = CONVERT(varchar(8),  DATEADD(day, 91, GETDATE()), 112);

-- Sumideros: absorben las columnas para que no viajen a la grilla. El motor
-- lee las mismas filas y toca las mismas páginas — el costo es idéntico.
DECLARE @med varchar(4), @hora varchar(18), @est tinyint, @ser varchar(12),
        @hist varchar(20), @dura int, @desc varchar(600), @fecha varchar(10);

PRINT '--- (29c) FORMA ANTERIOR: CONVERT sobre la columna (no sargable) ---';
SELECT @med = CD_CODI_MED_CIT, @hora = FE_HORA_CIT, @est = NU_ESTA_CIT,
       @ser = CD_CODI_SER_CIT, @hist = NU_HIST_PAC_CIT,
       @dura = NU_DURA_CIT, @desc = DE_DESC_CIT,
       @fecha = CONVERT(varchar(10), FE_FECH_CIT, 23)
  FROM dbo.CITAS_MEDICAS
 WHERE CONVERT(varchar(10), FE_FECH_CIT, 23) BETWEEN @desde23 AND @hasta23;

PRINT '--- (29d) FORMA NUEVA: rango sobre la columna desnuda (sargable) ---';
-- Mismo resultado y misma inmunidad a la zona horaria (el borde viaja como
-- literal 'YYYYMMDD', que SQL Server lee igual bajo cualquier DATEFORMAT),
-- pero sin envolver la columna, para que el índice pueda usarse. El borde
-- superior es EXCLUSIVO: por eso son 91 días y no 90.
--
-- ✔ Equivalencia verificada dos veces contra el mock local sembrando los
--   bordes (ayer, hoy, +89, +90, +91): las dos formas devuelven EXACTAMENTE
--   el mismo conjunto. Lo que falta medir no es si dan lo mismo, sino cuánto
--   cuesta cada una.
--
-- 🔧 Esta forma YA ESTÁ DESPLEGADA en el driver (2026-09-02), porque el
--    bloque 29a mostró que el hospital tiene un índice con FE_FECH_CIT de
--    primera columna y la forma anterior no lo podía usar. Esta medición
--    ahora sirve para CONFIRMAR la mejora, no para decidirla.
SELECT @med = CD_CODI_MED_CIT, @hora = FE_HORA_CIT, @est = NU_ESTA_CIT,
       @ser = CD_CODI_SER_CIT, @hist = NU_HIST_PAC_CIT,
       @dura = NU_DURA_CIT, @desc = DE_DESC_CIT,
       @fecha = CONVERT(varchar(10), FE_FECH_CIT, 23)
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= @desde112 AND FE_FECH_CIT < @hasta112;
GO

SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;
GO

-- 👉 De la pestaña "Messages", para CADA una de las dos, hacen falta dos
--    líneas: la de "Table 'CITAS_MEDICAS'. Scan count N, logical reads N..."
--    y la de "SQL Server Execution Times: ... elapsed time = N ms". Del plan,
--    solo si fue Seek o Scan. Son cuatro datos en total, no una tabla.

-- (29e) ¿Existe de verdad más de una cita vigente para el mismo médico+hora?
-- La PK es (médico, hora, ESTADO), así que el esquema lo permite: el desenlace
-- de atención libera la tupla (médico, hora, 0) y esa hora se puede volver a
-- agendar. El driver ya está blindado para ese caso (elige la fila viva y deja
-- un aviso en el log), pero saber si pasa a diario o nunca dice si ese aviso
-- va a sonar todo el tiempo.
SELECT COUNT(*) AS claves_con_mas_de_una_fila
FROM (
    SELECT CD_CODI_MED_CIT, FE_HORA_CIT
    FROM dbo.CITAS_MEDICAS
    GROUP BY CD_CODI_MED_CIT, FE_HORA_CIT
    HAVING COUNT(*) > 1
) x;

-- Y si hay, ver diez ejemplos con sus estados:
SELECT TOP 10 a.CD_CODI_MED_CIT, a.FE_HORA_CIT, a.NU_ESTA_CIT, a.NU_HIST_PAC_CIT
FROM dbo.CITAS_MEDICAS a
JOIN (
    SELECT CD_CODI_MED_CIT, FE_HORA_CIT
    FROM dbo.CITAS_MEDICAS
    GROUP BY CD_CODI_MED_CIT, FE_HORA_CIT
    HAVING COUNT(*) > 1
) d ON d.CD_CODI_MED_CIT = a.CD_CODI_MED_CIT AND d.FE_HORA_CIT = a.FE_HORA_CIT
ORDER BY a.CD_CODI_MED_CIT, a.FE_HORA_CIT, a.NU_ESTA_CIT;

-- (29f) ¿NU_NUME_MOVI_CIT llega a ser NULL en filas reales?
-- Importa porque su columna hermana NU_NUME_MOVI_CIAN es NOT NULL, y la
-- cancelación copia la una en la otra: una sola fila con NULL ahí haría fallar
-- la cancelación de esa cita desde WhatsApp. El mapeo dice que en la práctica
-- vale 0, esto lo confirma o lo desmiente.
SELECT COUNT(*) AS filas, SUM(CASE WHEN NU_NUME_MOVI_CIT IS NULL THEN 1 ELSE 0 END) AS con_null
FROM dbo.CITAS_MEDICAS;

-- =============================================================================
-- RESULTADO DEL BLOQUE 29 (2026-09-02, ESEHSVP):
--
--   (29a) 🔑 EL HOSPITAL SÍ TIENE EL ÍNDICE QUE HACÍA FALTA. Dos, de hecho,
--         con FE_FECH_CIT como PRIMERA columna de la clave:
--           · CITAS_MEDICASFE_FECH_CIT            → (FE_FECH_CIT)
--           · IDX_ESEHSVP_CITAS_MEDICAS31931_31930 → (FE_FECH_CIT, NU_ESTA_CIT)
--             + INCLUDE (CD_CODI_SER_CIT, FE_ELAB_CIT, NU_NUME_MOVI_CIT)
--         TURNOS_MEDICOS tiene el equivalente: TURNOS_MEDICOSFE_FECH_TUME.
--         PK confirmada de nuevo: PKCITAS_MEDICAS CLUSTERED
--         (CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT).
--
--   (29b) CITAS_MEDICAS  1.084.093 filas   855,2 MB
--         TURNOS_MEDICOS   119.480 filas    15,0 MB
--         Un orden de magnitud por encima de lo que se estimaba (~28.000).
--
--   (29c)/(29d) SIN MEDIR todavía: la consulta devolvía las ~28.000 filas de
--         la ventana y no se podían copiar. Corregido arriba — ahora vuelca a
--         variables y solo sale la pestaña "Messages".
--
--         Pero la decisión ya no dependía de la medición: con un índice cuya
--         primera columna es FE_FECH_CIT, envolverla en CONVERT lo inutiliza.
--         ⇒ Las 4 consultas del driver se pasaron a la forma sargable
--           (2026-09-02). La medición queda como confirmación.
--
--         Matiz que la medición sí resolverá: la ventana son ~28.000 de
--         1.084.093 filas = 2,6% de la tabla, justo en el punto donde el
--         optimizador a veces prefiere escanear igual, porque el SELECT pide
--         columnas que el índice no cubre (NU_HIST_PAC_CIT, NU_DURA_CIT,
--         DE_DESC_CIT) y tendría que hacer 28.000 búsquedas adicionales.
--
--   (29e) SOLO 2 claves (médico+hora) duplicadas en 1.084.093 filas, ambas de
--         2014 — y son PACIENTES DISTINTOS a la misma hora del mismo médico
--         (estados 1 y 2, historias diferentes):
--           09  2014/08/13 11:40  estado 1 → hist 43490245
--           09  2014/08/13 11:40  estado 2 → hist 1089098369
--         El blindaje del driver era correcto, pero el fenómeno es rarísimo:
--         el aviso del log no va a sonar en la práctica.
--
--   (29f) NU_NUME_MOVI_CIT nulo en EXACTAMENTE 1 fila de 1.084.093. Basta una
--         para romper la cancelación de esa cita (NU_NUME_MOVI_CIAN es NOT
--         NULL y se copia de ahí) ⇒ el COALESCE queda justificado. PENDIENTE.
-- =============================================================================

-- =============================================================================
-- BLOQUE 30 — El insumo de la homologación (MirrorEntityMap)
--
-- POR QUÉ ESTE BLOQUE
-- `MirrorEntityMap` es la tabla de equivalencias entre los médicos/servicios de
-- AgenIA y los códigos del hospital. HOY NO EXISTE QUIEN LA ESCRIBA: cinco
-- piezas del motor la leen y ninguna la produce. Sin esas filas no se generan
-- cupos, no sale ninguna cita hacia el HIS, no entra ninguna, y —lo más
-- traicionero— con el espejo encendido el chatbot deja de ofrecer citas a TODO
-- el mundo, sin un solo error en el log.
--
-- Esto no se puede resolver desde el servidor: la API no alcanza el HIS por
-- diseño (plan §4.1), solo el agente lo ve. La herramienta que vamos a
-- construir hará que el agente lea este catálogo y proponga los emparejamientos
-- por CÉDULA. Antes de escribirla hace falta saber si esa clave sirve.
--
-- 🔐 SOBRE DATOS PERSONALES
-- Las cédulas de los médicos son datos personales (Ley 1581). Para decidir el
-- diseño solo hace falta saber si están COMPLETAS y si son ÚNICAS — no sus
-- valores. Por eso las consultas devuelven indicadores, no números de
-- documento. El emparejamiento real lo hará el agente contra la base, sin que
-- nadie copie cédulas a un chat ni a un repositorio.
--
-- ⚠️ SOLO LECTURA. No modifica nada.
-- =============================================================================
USE ESEHSVP;
GO

-- (30a) Los médicos que IMPORTAN no son todos los de MEDICOS.
--
-- Solo un médico con turnos a futuro puede generar cupos: los demás son
-- historia. Fase 0 contó 27 con turnos hasta ago-2027, pero la tabla entera
-- tiene muchas más filas. Esto separa las dos poblaciones — es el tamaño real
-- del trabajo de homologación.
SELECT
    COUNT(*)                                                        AS medicos_en_la_tabla,
    SUM(CASE WHEN t.med IS NOT NULL THEN 1 ELSE 0 END)              AS con_turnos_futuros
FROM dbo.MEDICOS m
LEFT JOIN (
    SELECT DISTINCT CD_MED_TUME AS med
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
) t ON t.med = m.CD_CODI_MED;

-- Y el listado de esos médicos con lo que hace falta para homologar.
-- SIN la cédula: solo si la tiene y de qué largo, que es lo que decide si la
-- clave sirve. El nombre y el cargo sí van — son la etiqueta legible que
-- `MirrorEntityMap.externalLabel` guarda para poder diagnosticar sin abrir la
-- base del hospital.
SELECT
    m.CD_CODI_MED                                                   AS codigo,
    m.NO_NOMB_MED                                                   AS nombre,
    m.DE_CARG_MED                                                   AS cargo,
    m.NU_ESTA_MED                                                   AS estado,
    m.CD_CODI_LUA_MED                                               AS sede,
    CASE WHEN NULLIF(LTRIM(RTRIM(m.NU_DOCU_MED)), '') IS NULL
         THEN 'NO' ELSE 'SI' END                                    AS tiene_cedula,
    LEN(LTRIM(RTRIM(ISNULL(m.NU_DOCU_MED, ''))))                    AS largo_cedula,
    CASE WHEN NULLIF(LTRIM(RTRIM(m.TX_EMAIL_MED)), '') IS NULL
         THEN 'NO' ELSE 'SI' END                                    AS tiene_email,
    CASE WHEN NULLIF(LTRIM(RTRIM(m.DE_REGI_MED)), '') IS NULL
         THEN 'NO' ELSE 'SI' END                                    AS tiene_registro_medico
FROM dbo.MEDICOS m
JOIN (
    SELECT DISTINCT CD_MED_TUME AS med
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
) t ON t.med = m.CD_CODI_MED
ORDER BY m.CD_CODI_MED;

-- (30b) ¿Sirve la cédula como clave de emparejamiento?
--
-- `NU_DOCU_MED` es NULLABLE. Cada médico sin cédula, o con una cédula repetida,
-- es un emparejamiento que habrá que hacer a mano mirando el nombre — y el
-- nombre no es clave: "JUAN PEREZ" puede haber dos.
SELECT
    COUNT(*)                                                        AS medicos_con_turnos,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(m.NU_DOCU_MED)), '') IS NULL
             THEN 1 ELSE 0 END)                                     AS sin_cedula,
    COUNT(DISTINCT NULLIF(LTRIM(RTRIM(m.NU_DOCU_MED)), ''))         AS cedulas_distintas
FROM dbo.MEDICOS m
JOIN (
    SELECT DISTINCT CD_MED_TUME AS med
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
) t ON t.med = m.CD_CODI_MED;

-- Cédulas repetidas entre DOS médicos distintos (mismo profesional dado de alta
-- dos veces, o error de digitación). Si sale algo, el emparejamiento automático
-- tiene que negarse a resolver esos casos en vez de elegir uno.
SELECT LTRIM(RTRIM(NU_DOCU_MED)) AS cedula_repetida, COUNT(*) AS veces
FROM dbo.MEDICOS
WHERE NULLIF(LTRIM(RTRIM(NU_DOCU_MED)), '') IS NOT NULL
GROUP BY LTRIM(RTRIM(NU_DOCU_MED))
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- (30c) ¿Qué significa NU_ESTA_MED?
--
-- MAPEO_HIS.md §2.2 lo anota como "estado — VERIFICAR 1=activo": sigue siendo
-- una hipótesis. Si nos equivocamos, importamos médicos retirados o excluimos
-- activos. Se verifica igual que se verificó NU_SEXO_PAC: por cruce
-- estadístico contra un hecho independiente — tener turnos a futuro. Un médico
-- con agenda hasta 2027 está activo, diga lo que diga la columna.
SELECT
    m.NU_ESTA_MED                                                   AS estado,
    COUNT(*)                                                        AS medicos,
    SUM(CASE WHEN t.med IS NOT NULL THEN 1 ELSE 0 END)              AS con_turnos_futuros
FROM dbo.MEDICOS m
LEFT JOIN (
    SELECT DISTINCT CD_MED_TUME AS med
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
) t ON t.med = m.CD_CODI_MED
GROUP BY m.NU_ESTA_MED
ORDER BY m.NU_ESTA_MED;

-- (30d) ¿Sirve TX_EMAIL_MED para crear usuarios en AgenIA?
--
-- Importa porque `DoctorProfile` exige un `User`, y `User` exige email ÚNICO.
-- Si los correos faltan o se repiten, importar médicos automáticamente obliga a
-- inventar credenciales — una superficie de seguridad que preferimos no abrir.
SELECT
    COUNT(*)                                                        AS medicos_con_turnos,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(m.TX_EMAIL_MED)), '') IS NULL
             THEN 1 ELSE 0 END)                                     AS sin_email,
    COUNT(DISTINCT NULLIF(LTRIM(RTRIM(m.TX_EMAIL_MED)), ''))        AS emails_distintos
FROM dbo.MEDICOS m
JOIN (
    SELECT DISTINCT CD_MED_TUME AS med
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
) t ON t.med = m.CD_CODI_MED;

-- (30e) De los 1.280 servicios agendables, ¿cuáles se usan de verdad?
--
-- Nadie va a homologar 1.280 servicios a mano, y AgenIA tiene tres. La pregunta
-- real no es "¿cuáles existen?" sino "¿cuáles mueven las citas?". Esto convierte
-- un catálogo inmanejable en la lista corta que hay que discutir con la
-- agendadora para decidir qué ofrece el chatbot.
SELECT TOP 40
    c.CD_CODI_SER_CIT                                               AS codigo_servicio,
    s.NO_NOMB_SER                                                   AS nombre_servicio,
    COUNT(*)                                                        AS citas_90d,
    COUNT(DISTINCT c.CD_CODI_MED_CIT)                               AS medicos_que_lo_prestan
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  DATEADD(day,   1, CAST(GETDATE() AS date))
GROUP BY c.CD_CODI_SER_CIT, s.NO_NOMB_SER
ORDER BY COUNT(*) DESC;

-- (30f) ¿Un médico atiende MÁS DE UN servicio?
--
-- Pregunta abierta desde la Fase 2 (ESTADO.md): `TURNOS_MEDICOS` no lleva
-- servicio, así que el servicio del cupo sale hoy de `DoctorProfile.serviceId`
-- — UNO por médico. Si un médico atiende dos servicios en el mismo turno, esa
-- regla es insuficiente y hace falta una más fina. Esto lo mide en vez de
-- suponerlo.
SELECT
    c.CD_CODI_MED_CIT                                               AS medico,
    COUNT(DISTINCT c.CD_CODI_SER_CIT)                               AS servicios_distintos,
    COUNT(*)                                                        AS citas_90d
FROM dbo.CITAS_MEDICAS c
WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  DATEADD(day,   1, CAST(GETDATE() AS date))
GROUP BY c.CD_CODI_MED_CIT
HAVING COUNT(DISTINCT c.CD_CODI_SER_CIT) > 1
ORDER BY COUNT(DISTINCT c.CD_CODI_SER_CIT) DESC;

-- =============================================================================
-- RESULTADO DEL BLOQUE 30 (2026-09-02, ESEHSVP):
--
--   (30a) 588 médicos en la tabla, 30 CON TURNOS FUTUROS (no 27 — la cifra que
--         arrastraba ESTADO.md estaba desactualizada). Filtrar por turnos
--         futuros era imprescindible: el 95% de la tabla es historia.
--
--         ⚠️ HALLAZGO: OCHO de esos 30 NO SON PERSONAS, son agendas de rol —
--         "MEDICO ATENCION HTA" (76, 77, 077), "MEDICO ATENCION RIAS" (80-1),
--         "ENFERMERA CYD HSVP" (91-1), "ENFERMERA SALUD REPRODUCTIVA" (91-2),
--         "MEDICO DISPONIBLE HSVP 01/02" (MDD1, MDD2). Y el catálogo incluye
--         enfermeras, higienistas orales, auxiliares de odontología,
--         nutricionista y psicólogas: `DoctorProfile` va a contener gente que
--         no es médica. CD_CODI_LUA_MED (sede) está NULL en los 30.
--
--   (30b) 30 médicos, 0 sin cédula, pero solo 29 CÉDULAS DISTINTAS. Las
--         repetidas delatan a las agendas funcionales:
--           77123456789 → 3 veces (11 dígitos, marcador de posición)
--           123456      → 2 veces (evidentemente falsa)
--           1053844965, 24393263, 33990162 → 2 veces c/u
--         TODOS los largo_cedula = 11 son agendas funcionales, y ninguna tiene
--         registro médico. ⇒ La cédula empareja bien a las personas reales y
--         falla justo donde el emparejamiento automático no tenía sentido.
--
--   (30c) ✅ NU_ESTA_MED = 1 ES ACTIVO. Confirmado, separación perfecta:
--           estado 0 → 359 médicos,  0 con turnos futuros
--           estado 1 → 229 médicos, 30 con turnos futuros
--         Cierra una hipótesis abierta desde el bloque 2. Ojo: 229 están
--         activos y solo 30 tienen agenda ⇒ el filtro operativo sigue siendo
--         "tiene turnos futuros", no el estado.
--
--   (30d) 30 médicos, 10 SIN email, 20 emails distintos (los 20 presentes son
--         únicos, sin colisiones). Los que faltan son casi todos las agendas
--         funcionales.
--
--   (30e) Concentración brutal: los 4 primeros servicios son el 41% de todas
--         las citas, y los 40 primeros el 76% (~21.194 de 27.877 en 90 días).
--           S39141    Consulta ambulatoria de medicina general   5.565  (26 méd.)
--           S39141-1  Consulta control hipertensos                3.635  (23)
--           SCITOD    Cita odontológica                           1.084  (5)
--           S39141-2  Consulta lectura de exámenes                1.020  (23)
--         Ningún laboratorio aparece en el top 40: todo lo que se agenda hoy
--         son consultas.
--
--   (30f) 🔴 `DoctorProfile.serviceId` ES INSUFICIENTE, y no por excepción.
--         47 médicos prestan MÁS DE UN servicio:
--           77 → 11 servicios    OD07 → 9    OD01 → 9    OD02 → 9    OD05 → 8
--         La nota de Fase 2 lo trataba como caso raro; es la norma. Hoy los
--         cupos heredan el ÚNICO servicio del médico, así que AgenIA solo
--         puede ofrecer uno de los que cada médico presta y los demás son
--         invisibles — y si se reserva, CD_CODI_SER_CIT va con el servicio
--         equivocado, que además determina el convenio de facturación.
--         Pista para resolverlo: TURNOS_MEDICOS.CD_CODI_ESP_TUME (especialidad
--         del turno) existe y no se usa, y R_ESP_SER relaciona
--         especialidad↔servicio. Camino: turno → especialidad → servicios.
--         ⇒ Material del bloque 31.
--
-- QUÉ SE DECIDE CON ESTO
--   · (30a) da el TAMAÑO real del trabajo: cuántas equivalencias hay que crear.
--   · (30b) decide si el emparejamiento automático por cédula es viable. Con
--     cédulas completas y únicas, la herramienta propone los 27 sola y solo
--     hace falta revisar la lista. Con huecos, cada hueco es trabajo manual.
--   · (30c) cierra una hipótesis que lleva abierta desde el bloque 2 y que
--     decide a quién se importa.
--   · (30d) decide si los médicos que faltan en AgenIA se pueden crear
--     automáticamente o hay que darlos de alta por la pantalla que ya existe.
--   · (30e) es el insumo de la conversación con la agendadora sobre qué ofrece
--     el chatbot — la misma en la que hay que validar la tabla de convenios.
--   · (30f) confirma o refuta que `DoctorProfile.serviceId` (un servicio por
--     médico) baste para generar los cupos.
-- =============================================================================

-- =============================================================================
-- BLOQUE 31 — ¿De qué servicio es un cupo?
--
-- POR QUÉ ESTE BLOQUE
-- El bloque 30f destapó que 47 médicos prestan MÁS DE UN servicio — uno de
-- ellos once. Y AgenIA le pone a cada cupo el ÚNICO servicio del médico
-- (`DoctorProfile.serviceId`), porque `TURNOS_MEDICOS` no lleva servicio.
-- Consecuencia hoy: de los once servicios que ese médico presta, el chatbot
-- solo puede ofrecer uno; los otros diez son invisibles. Y si el paciente
-- reserva, `CD_CODI_SER_CIT` viaja con el servicio equivocado — que además es
-- el que determina el convenio de facturación.
--
-- La pregunta no es "¿cuántos servicios presta el médico?" (ya se sabe) sino
-- **"¿un mismo bloque de turno mezcla servicios, o cada turno es de uno solo?"**
-- De ahí salen dos diseños muy distintos:
--   · Si cada turno es de UN servicio ⇒ el cupo hereda el servicio del turno.
--     Basta con saber cuál, y `CD_CODI_ESP_TUME` es el candidato.
--   · Si un turno MEZCLA servicios ⇒ el cupo es "médico + hora" y el servicio
--     lo elige el paciente al reservar. Eso obliga a repensar cómo AgenIA
--     modela la disponibilidad, no solo a homologar mejor.
--
-- De paso cierra el bloque 21b/21d, aplazado desde hace tiempo: de dónde sale
-- `CD_CODI_ESP_CIT`, que el driver hoy resuelve con una tabla del mappingJson
-- escrita a mano.
--
-- ⚠️ SOLO LECTURA.
-- =============================================================================
USE ESEHSVP;
GO

-- (31a) ¿Existe R_ESP_SER? No salió en el volcado del bloque 28 porque no
-- estaba en su lista — así que ni siquiera sabemos si existe. Esto lo
-- descubre junto con cualquier otra tabla de especialidades.
SELECT name AS tabla
FROM sys.tables
WHERE name LIKE '%ESP%'
ORDER BY name;

-- Y sus columnas, solo de las que existan (así el lote no revienta si falta
-- alguna). Se consultan las tres candidatas de una vez.
SELECT t.name AS tabla, c.name AS columna, ty.name AS tipo,
       CASE WHEN ty.name LIKE '%char%' THEN c.max_length ELSE NULL END AS ancho,
       CASE WHEN c.is_nullable = 1 THEN 'SI' ELSE 'NO' END AS acepta_nulos
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name IN ('R_ESP_SER', 'R_MEDI_ESPE', 'ESPECIALIDADES', 'ESPECIALIDAD')
ORDER BY t.name, c.column_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- (31b) 🔑 LA PREGUNTA DECISIVA: ¿un turno mezcla servicios?
--
-- Cada cita se asocia a SU bloque de turno — mismo médico, misma fecha, y la
-- hora dentro del rango del bloque (un médico puede tener turno de mañana y
-- de tarde el mismo día, y contarlos juntos falsearía el resultado).
--
-- La salida es una sola tabla pequeña: cuántos turnos tuvieron 1 servicio,
-- cuántos 2, cuántos 3...
-- ═══════════════════════════════════════════════════════════════════════════
SELECT servicios_en_el_turno, COUNT(*) AS turnos
FROM (
    SELECT t.NU_NUME_TUME,
           COUNT(DISTINCT c.CD_CODI_SER_CIT) AS servicios_en_el_turno
    FROM dbo.TURNOS_MEDICOS t
    JOIN dbo.CITAS_MEDICAS c
      ON  c.CD_CODI_MED_CIT = t.CD_MED_TUME
      AND CAST(c.FE_FECH_CIT AS date) = CAST(t.FE_FECH_TUME AS date)
      -- La hora de la cita, dentro del rango del bloque. FE_HORA_CIT es
      -- 'YYYY/MM/DD HH:MM', así que la hora son 5 caracteres desde el 12.
      AND SUBSTRING(c.FE_HORA_CIT, 12, 5) >= CONVERT(varchar(5), t.FE_HOIN_TUME, 108)
      AND SUBSTRING(c.FE_HORA_CIT, 12, 5) <  CONVERT(varchar(5), t.FE_HOFI_TUME, 108)
    WHERE t.FE_FECH_TUME >= DATEADD(day, -90, CAST(GETDATE() AS date))
      AND t.FE_FECH_TUME <  DATEADD(day,   1, CAST(GETDATE() AS date))
    GROUP BY t.NU_NUME_TUME
) x
GROUP BY servicios_en_el_turno
ORDER BY servicios_en_el_turno;

-- Diez ejemplos de turnos que SÍ mezclan, para ver de qué se trata: ¿son
-- servicios parecidos (control y primera vez del mismo tipo) o cosas
-- distintas (odontología y medicina general en el mismo bloque)?
SELECT TOP 10 * FROM (
    SELECT t.NU_NUME_TUME AS turno, t.CD_MED_TUME AS medico,
           CONVERT(varchar(10), t.FE_FECH_TUME, 23) AS fecha,
           CONVERT(varchar(5), t.FE_HOIN_TUME, 108) AS hora_ini,
           CONVERT(varchar(5), t.FE_HOFI_TUME, 108) AS hora_fin,
           t.CD_CODI_ESP_TUME AS esp_del_turno,
           COUNT(DISTINCT c.CD_CODI_SER_CIT) AS servicios,
           COUNT(*) AS citas
    FROM dbo.TURNOS_MEDICOS t
    JOIN dbo.CITAS_MEDICAS c
      ON  c.CD_CODI_MED_CIT = t.CD_MED_TUME
      AND CAST(c.FE_FECH_CIT AS date) = CAST(t.FE_FECH_TUME AS date)
      AND SUBSTRING(c.FE_HORA_CIT, 12, 5) >= CONVERT(varchar(5), t.FE_HOIN_TUME, 108)
      AND SUBSTRING(c.FE_HORA_CIT, 12, 5) <  CONVERT(varchar(5), t.FE_HOFI_TUME, 108)
    WHERE t.FE_FECH_TUME >= DATEADD(day, -90, CAST(GETDATE() AS date))
      AND t.FE_FECH_TUME <  DATEADD(day,   1, CAST(GETDATE() AS date))
    GROUP BY t.NU_NUME_TUME, t.CD_MED_TUME, t.FE_FECH_TUME,
             t.FE_HOIN_TUME, t.FE_HOFI_TUME, t.CD_CODI_ESP_TUME
    HAVING COUNT(DISTINCT c.CD_CODI_SER_CIT) > 1
) y
ORDER BY servicios DESC, citas DESC;

-- Y qué servicios concretos conviven en un mismo turno (los 15 pares más
-- frecuentes). Es lo que dice si "mezclar" significa variantes del mismo acto
-- o especialidades distintas de verdad.
SELECT TOP 15
       t.CD_CODI_ESP_TUME AS esp_del_turno,
       c.CD_CODI_SER_CIT  AS servicio,
       s.NO_NOMB_SER      AS nombre_servicio,
       COUNT(*)           AS citas
FROM dbo.TURNOS_MEDICOS t
JOIN dbo.CITAS_MEDICAS c
  ON  c.CD_CODI_MED_CIT = t.CD_MED_TUME
  AND CAST(c.FE_FECH_CIT AS date) = CAST(t.FE_FECH_TUME AS date)
  AND SUBSTRING(c.FE_HORA_CIT, 12, 5) >= CONVERT(varchar(5), t.FE_HOIN_TUME, 108)
  AND SUBSTRING(c.FE_HORA_CIT, 12, 5) <  CONVERT(varchar(5), t.FE_HOFI_TUME, 108)
LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
WHERE t.FE_FECH_TUME >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND t.FE_FECH_TUME <  DATEADD(day,   1, CAST(GETDATE() AS date))
GROUP BY t.CD_CODI_ESP_TUME, c.CD_CODI_SER_CIT, s.NO_NOMB_SER
ORDER BY COUNT(*) DESC;

-- (31c) ¿Está poblada CD_CODI_ESP_TUME en los turnos que importan?
-- Si viene vacía, deja de ser candidata a decidir el servicio del cupo.
SELECT
    COUNT(*)                                                          AS turnos_futuros,
    SUM(CASE WHEN NULLIF(LTRIM(RTRIM(CD_CODI_ESP_TUME)), '') IS NULL
             THEN 1 ELSE 0 END)                                       AS sin_especialidad,
    COUNT(DISTINCT NULLIF(LTRIM(RTRIM(CD_CODI_ESP_TUME)), ''))        AS especialidades_distintas
FROM dbo.TURNOS_MEDICOS
WHERE FE_FECH_TUME >= CAST(GETDATE() AS date);

-- (31d) Cierra el bloque 21b: ¿de dónde sale CD_CODI_ESP_CIT?
--
-- El driver la resuelve hoy con `especialidadPorServicio` del mappingJson,
-- escrita a mano a partir de una muestra pequeña. Si cada servicio usa SIEMPRE
-- la misma especialidad, esa tabla se puede generar de los datos en vez de
-- adivinarla. Si un servicio usa varias, la regla es más fina y hay que verla.
SELECT TOP 40
       c.CD_CODI_SER_CIT                        AS servicio,
       s.NO_NOMB_SER                            AS nombre_servicio,
       COUNT(DISTINCT c.CD_CODI_ESP_CIT)        AS especialidades_distintas,
       MIN(c.CD_CODI_ESP_CIT)                   AS esp_min,
       MAX(c.CD_CODI_ESP_CIT)                   AS esp_max,
       COUNT(*)                                 AS citas_90d
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  DATEADD(day,   1, CAST(GETDATE() AS date))
GROUP BY c.CD_CODI_SER_CIT, s.NO_NOMB_SER
ORDER BY COUNT(*) DESC;

-- (31e) ¿Y coincide la especialidad del TURNO con la de la CITA?
-- Si coinciden casi siempre, el turno basta para decidirla y no hace falta
-- ninguna tabla de homologación.
SELECT
    CASE WHEN t.CD_CODI_ESP_TUME = c.CD_CODI_ESP_CIT THEN 'COINCIDE'
         WHEN t.CD_CODI_ESP_TUME IS NULL             THEN 'turno sin especialidad'
         WHEN c.CD_CODI_ESP_CIT  IS NULL             THEN 'cita sin especialidad'
         ELSE 'DIFIEREN' END                        AS resultado,
    COUNT(*)                                        AS citas
FROM dbo.TURNOS_MEDICOS t
JOIN dbo.CITAS_MEDICAS c
  ON  c.CD_CODI_MED_CIT = t.CD_MED_TUME
  AND CAST(c.FE_FECH_CIT AS date) = CAST(t.FE_FECH_TUME AS date)
  AND SUBSTRING(c.FE_HORA_CIT, 12, 5) >= CONVERT(varchar(5), t.FE_HOIN_TUME, 108)
  AND SUBSTRING(c.FE_HORA_CIT, 12, 5) <  CONVERT(varchar(5), t.FE_HOFI_TUME, 108)
WHERE t.FE_FECH_TUME >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND t.FE_FECH_TUME <  DATEADD(day,   1, CAST(GETDATE() AS date))
GROUP BY CASE WHEN t.CD_CODI_ESP_TUME = c.CD_CODI_ESP_CIT THEN 'COINCIDE'
              WHEN t.CD_CODI_ESP_TUME IS NULL             THEN 'turno sin especialidad'
              WHEN c.CD_CODI_ESP_CIT  IS NULL             THEN 'cita sin especialidad'
              ELSE 'DIFIEREN' END
ORDER BY COUNT(*) DESC;
GO

-- (31f) Si R_ESP_SER existe, ¿reproduce la relación especialidad↔servicio que
-- muestran los datos? Va en su propio lote y protegido, porque si la tabla no
-- existe una referencia directa haría fallar todo el bloque.
IF OBJECT_ID('dbo.R_ESP_SER') IS NOT NULL
    EXEC sp_executesql N'SELECT TOP 50 * FROM dbo.R_ESP_SER ORDER BY 1, 2;';
ELSE
    PRINT 'dbo.R_ESP_SER NO EXISTE — la especialidad no sale de ahí.';
GO

-- (31g) `NU_TIPO_TUME`: el driver descarta todo lo que no sea 0. Confirmar que
-- sigue siendo cierto a futuro, ahora que sabemos que hay 119.480 turnos.
-- `NU_TIPO_TUME` es tinyint (0..255): el -1 que marca los nulos hay que
-- convertirlo a int antes, o desborda el tipo.
SELECT ISNULL(CAST(NU_TIPO_TUME AS int), -1) AS tipo,
       COUNT(*)                              AS turnos,
       SUM(CASE WHEN FE_FECH_TUME >= CAST(GETDATE() AS date) THEN 1 ELSE 0 END) AS futuros
FROM dbo.TURNOS_MEDICOS
GROUP BY ISNULL(CAST(NU_TIPO_TUME AS int), -1)
ORDER BY 1;

-- =============================================================================
-- RESULTADO DEL BLOQUE 31 (pendiente de ejecución):
--
--   (31a) tablas de especialidad que existen:
--   (31b) distribución de servicios por turno:
--   (31c) CD_CODI_ESP_TUME poblada:            distintas:
--   (31d) ¿cada servicio usa una sola especialidad?
--   (31e) turno vs cita — coinciden:
--   (31f) R_ESP_SER existe:
--   (31g) tipos de turno a futuro:
--
-- QUÉ SE DECIDE CON ESTO
--   · Si (31b) dice que casi todos los turnos son de UN servicio ⇒ el cupo
--     hereda el servicio del turno y basta con homologar servicio↔turno. Es el
--     escenario bueno: `DoctorProfile.serviceId` se reemplaza por algo que sale
--     del propio HIS y no hay que tocar el modelo de AgenIA.
--   · Si (31b) dice que los turnos MEZCLAN ⇒ el cupo es "médico + hora" y el
--     servicio lo elige el paciente. Eso cambia el modelo de disponibilidad de
--     AgenIA (hoy `ScheduleSlot.serviceId` es obligatorio) y es una decisión
--     de producto, no solo de espejo.
--   · (31d) decide si `especialidadPorServicio` del mappingJson se puede
--     GENERAR de los datos en vez de mantenerse a mano — hoy es una tabla
--     escrita a partir de una muestra de dos servicios.
--   · (31e)+(31f) dicen cuál es la fuente de verdad de la especialidad: el
--     turno, el servicio, o una tabla de relación.
-- =============================================================================

-- =============================================================================
-- BLOQUE 32 — La regla de la especialidad: servicio ∩ médico
--
-- POR QUÉ ESTE BLOQUE
-- El bloque 31d mostró que 36 de los 40 servicios principales usan SIEMPRE la
-- misma especialidad, y que los 4 que no tienen una explicación: el mismo
-- "Examen clínico de primera vez" (S36101) sale como 461 cuando lo hace la
-- odontóloga y como 572 cuando lo hace la higienista. La especialidad no la
-- decide el servicio: la decide QUIÉN atiende.
--
-- Y 31a/31f confirmaron las dos piezas que faltaban:
--   · R_ESP_SER  (CD_CODI_SER_RES → CD_CODI_ESP_RES): desde qué especialidades
--     se puede prestar un servicio. Es N:M — el servicio '09' apunta a cuatro.
--   · R_MEDI_ESPE (CD_CODI_MED_RMP → CD_CODI_ESP_RMP): las del médico.
--
-- HIPÓTESIS A PROBAR:
--     especialidad de la cita = R_ESP_SER(servicio) ∩ R_MEDI_ESPE(médico)
--
-- Si la intersección da EXACTAMENTE UNA y coincide con la CD_CODI_ESP_CIT real,
-- `especialidadPorServicio` deja de ser una tabla escrita a mano en el
-- mappingJson —hoy hecha a partir de una muestra de dos servicios— y pasa a ser
-- una regla que el driver resuelve contra el propio HIS. Cierra el bloque 21b.
--
-- ⚠️ SOLO LECTURA.
-- =============================================================================
USE ESEHSVP;
GO

-- (32a) 🚧 PRIMERO LO QUE PUEDE TUMBAR TODO: ¿R_ESP_SER cubre los servicios
-- que de verdad se agendan?
--
-- La muestra del bloque 31f devolvió códigos como '04', '05', '25' — que no se
-- parecen a los que usan las citas ('S39141', 'SCITOD'). Puede que fuera solo
-- efecto del ORDER BY (los numéricos ordenan primero), o puede que R_ESP_SER
-- viva en otra familia de códigos. Si no cubre los servicios reales, la regla
-- no sirve y no hay nada más que mirar en este bloque.
SELECT
    COUNT(*)                                                         AS servicios_con_citas_90d,
    SUM(CASE WHEN r.CD_CODI_SER_RES IS NULL THEN 1 ELSE 0 END)       AS sin_fila_en_R_ESP_SER
FROM (
    SELECT DISTINCT c.CD_CODI_SER_CIT AS servicio
    FROM dbo.CITAS_MEDICAS c
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
      AND c.FE_FECH_CIT <  DATEADD(day,   1, CAST(GETDATE() AS date))
) s
LEFT JOIN (SELECT DISTINCT CD_CODI_SER_RES FROM dbo.R_ESP_SER) r
       ON r.CD_CODI_SER_RES = s.servicio;

-- (32b) Lo mismo por el lado del médico: ¿R_MEDI_ESPE cubre a los 30 que
-- tienen turnos futuros? Un médico sin especialidades declaradas rompe la
-- intersección igual que un servicio sin filas.
SELECT
    COUNT(*)                                                         AS medicos_con_turnos,
    SUM(CASE WHEN r.CD_CODI_MED_RMP IS NULL THEN 1 ELSE 0 END)       AS sin_fila_en_R_MEDI_ESPE
FROM (
    SELECT DISTINCT CD_MED_TUME AS medico
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
) m
LEFT JOIN (SELECT DISTINCT CD_CODI_MED_RMP FROM dbo.R_MEDI_ESPE) r
       ON r.CD_CODI_MED_RMP = m.medico;

-- ═══════════════════════════════════════════════════════════════════════════
-- (32c) 🔑 LA PRUEBA: ¿la intersección predice la especialidad real?
--
-- Se contrasta contra las citas de verdad de los últimos 90 días. Una sola
-- tabla pequeña con el veredicto.
-- ═══════════════════════════════════════════════════════════════════════════
WITH interseccion AS (
    SELECT rs.CD_CODI_SER_RES              AS servicio,
           rm.CD_CODI_MED_RMP              AS medico,
           COUNT(*)                        AS cuantas,
           MIN(rs.CD_CODI_ESP_RES)         AS unica
    FROM dbo.R_ESP_SER rs
    JOIN dbo.R_MEDI_ESPE rm
      ON rm.CD_CODI_ESP_RMP = rs.CD_CODI_ESP_RES
    GROUP BY rs.CD_CODI_SER_RES, rm.CD_CODI_MED_RMP
)
SELECT
    CASE
        WHEN i.servicio IS NULL              THEN '4. sin interseccion (no se puede decidir)'
        WHEN i.cuantas > 1                   THEN '3. ambigua (la interseccion deja varias)'
        WHEN i.unica = c.CD_CODI_ESP_CIT     THEN '1. ACIERTA (una sola, y es la correcta)'
        ELSE                                      '2. FALLA (una sola, pero es otra)'
    END                                      AS veredicto,
    COUNT(*)                                 AS citas
FROM dbo.CITAS_MEDICAS c
LEFT JOIN interseccion i
       ON i.servicio = c.CD_CODI_SER_CIT
      AND i.medico   = c.CD_CODI_MED_CIT
WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  DATEADD(day,   1, CAST(GETDATE() AS date))
GROUP BY
    CASE
        WHEN i.servicio IS NULL              THEN '4. sin interseccion (no se puede decidir)'
        WHEN i.cuantas > 1                   THEN '3. ambigua (la interseccion deja varias)'
        WHEN i.unica = c.CD_CODI_ESP_CIT     THEN '1. ACIERTA (una sola, y es la correcta)'
        ELSE                                      '2. FALLA (una sola, pero es otra)'
    END
ORDER BY 1;

-- (32d) Y el detalle de los CUATRO servicios que el bloque 31d dejó ambiguos.
-- Para cada uno, por médico: qué dice la intersección y qué se escribió de
-- verdad. Es donde se ve si la regla los resuelve o no.
WITH interseccion AS (
    SELECT rs.CD_CODI_SER_RES AS servicio, rm.CD_CODI_MED_RMP AS medico,
           COUNT(*) AS cuantas, MIN(rs.CD_CODI_ESP_RES) AS unica
    FROM dbo.R_ESP_SER rs
    JOIN dbo.R_MEDI_ESPE rm ON rm.CD_CODI_ESP_RMP = rs.CD_CODI_ESP_RES
    GROUP BY rs.CD_CODI_SER_RES, rm.CD_CODI_MED_RMP
)
SELECT c.CD_CODI_SER_CIT           AS servicio,
       c.CD_CODI_MED_CIT           AS medico,
       c.CD_CODI_ESP_CIT           AS esp_real,
       i.cuantas                   AS esp_que_deja_la_interseccion,
       i.unica                     AS esp_que_predice,
       COUNT(*)                    AS citas
FROM dbo.CITAS_MEDICAS c
LEFT JOIN interseccion i
       ON i.servicio = c.CD_CODI_SER_CIT AND i.medico = c.CD_CODI_MED_CIT
WHERE c.CD_CODI_SER_CIT IN ('S36101', 'S35104', 'I890301AG', 'S35102')
  AND c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  DATEADD(day,   1, CAST(GETDATE() AS date))
GROUP BY c.CD_CODI_SER_CIT, c.CD_CODI_MED_CIT, c.CD_CODI_ESP_CIT, i.cuantas, i.unica
ORDER BY c.CD_CODI_SER_CIT, COUNT(*) DESC;

-- (32e) El catálogo legible de especialidades. Hace falta para poner nombre a
-- los códigos ('000', '461', '572'…) en el mappingJson y en el panel — hoy son
-- números sueltos que nadie puede interpretar sin abrir la base del hospital.
SELECT CD_CODI_ESP AS codigo, NO_NOMB_ESP AS nombre, TX_ACTI_ESP AS activa
FROM dbo.ESPECIALIDADES
WHERE CD_CODI_ESP IN (
    SELECT DISTINCT CD_CODI_ESP_CIT
    FROM dbo.CITAS_MEDICAS
    WHERE FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
      AND FE_FECH_CIT <  DATEADD(day,   1, CAST(GETDATE() AS date))
)
ORDER BY CD_CODI_ESP;

-- =============================================================================
-- RESULTADO DEL BLOQUE 32 (2026-09-02, ESEHSVP):
--
--   (32a) 53 servicios con citas en 90d, 0 SIN fila en R_ESP_SER. Cobertura
--         total: el temor de que R_ESP_SER viviera en otra familia de códigos
--         era infundado, lo del bloque 31f fue solo efecto del ORDER BY.
--   (32b) 25 médicos con turnos, 0 SIN fila en R_MEDI_ESPE. Cobertura total.
--         ⚠️ Eran 30 en el bloque 30a, corrido un día antes: el conjunto de
--         "médicos con turnos futuros" SE MUEVE día a día. La herramienta de
--         homologación no puede tomarlo como una lista fija.
--
--   (32c) VEREDICTO DE LA REGLA (21.362 citas):
--           ACIERTA (una sola, y es la correcta) ... 13.227   61,9%
--           ambigua (la intersección deja varias)    8.135   38,1%
--           FALLA .................................       0
--           sin intersección ......................       0
--
--         🔑 La regla NUNCA se equivoca, pero deja indeciso el 38%. Es SEGURA
--         pero INCOMPLETA: sirve para validar, no para decidir.
--
--   (32d) ❌ MI HIPÓTESIS ERA FALSA. Yo sostenía que "la especialidad la
--         decide quién atiende": que S36101 salía 461 con la odontóloga y 572
--         con la higienista. Los datos dicen que no —
--           S36101: 461 en 826 de 827 citas. La única con 572 es UNA cita de
--                   OD02, y HO03 (higienista oral) también usa 461.
--         El servicio manda, no el médico. La intersección deja dos porque
--         R_ESP_SER lista lo POSIBLE, no lo que se usa.
--
--         Los otros tres confirman el mismo patrón, y todos tienen el mismo
--         culpable — el código 000:
--           I890301AG → deja {000, 328, ...}; real 328 en 453 de 455
--           S35102    → deja {000, 590};      real 590 en 387 de 388
--           S35104    → deja {000, 590};      real 590 en 577 de 580
--         `000` (MEDICINA GENERAL) es un COMODÍN: casi todos los médicos la
--         tienen declarada y casi todos los servicios la admiten, así que
--         infla toda intersección y casi nunca es la respuesta correcta
--         cuando hay alternativa. Desempatar por MIN() la elegiría — y
--         fallaría en tres de los cuatro.
--
--   (32e) CATÁLOGO. Revela una estructura de PARES normal ↔ PyDT (promoción y
--         detección temprana) que explica las ambigüedades:
--           000 MEDICINA GENERAL   ↔ 328 MEDICINA GENERAL PYDT
--           461 ODONTOLOGIA        ↔ 572 ODONTOLOGIA PYDT
--           590 PSICOLOGIA         ↔ 591 PSICOLOGIA PYDT
--           060 ENFERMERIA PYDT, 200 DERMATOLOGIA, 341 GINECOLOGIA Y
--           OBSTETRICIA, 345 PSIQUIATRIA, 387 MEDICINA INTERNA,
--           451 NUTRICION Y DIETETICA, 550 PEDIATRIA
--         ⚠️ `TX_ACTI_ESP = 0` en las TRECE, incluidas las que se usan a
--         diario ⇒ ese flag no sirve para filtrar, nadie lo mantiene.
--         (Detalle de datos sucios: '000' es "MEDICINA  GENERAL", con dos
--         espacios.)
--
-- ✅ CONCLUSIÓN — de dónde sale CD_CODI_ESP_CIT (cierra el bloque 21b):
--
--   La fuente es el SERVICIO, tomada de los datos reales (la moda por
--   servicio del bloque 31d: 36 de 40 servicios son inequívocos en la
--   práctica). La intersección R_ESP_SER ∩ R_MEDI_ESPE queda como
--   VALIDACIÓN — nunca contradijo la realidad en 21.362 citas — pero no como
--   fuente, porque en el 38% de los casos no decide.
--
--   Dicho de otro modo: R_ESP_SER dice lo que es POSIBLE; los datos dicen lo
--   que se HACE. `especialidadPorServicio` se genera de lo segundo y se
--   comprueba contra lo primero.
--
-- QUÉ SE HIZO CON ESTO
--   · `especialidadPorServicio` se GENERA de la moda empírica por servicio,
--     no se mantiene a mano. La intersección se usa para verificar que el
--     valor generado sea uno de los posibles.
--   · `especialidadPorDefecto` sigue siendo '000' (medicina general) para el
--     servicio que no se conozca — es el comodín, y como último recurso es
--     razonable; lo que no se puede es dejar que gane un desempate.
--   · No usar `TX_ACTI_ESP` para filtrar especialidades: está en 0 para todas.
-- =============================================================================

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
-- 👉 En SSMS, antes de correr esto: activar "Include Actual Execution Plan"
--    (Ctrl+M). Lo que hay que mirar en el plan es si aparece "Index Seek" o
--    "Index/Table Scan" sobre CITAS_MEDICAS.
-- 👉 Correr el lote DOS VECES y reportar los números de la segunda (la primera
--    paga el costo de leer de disco y ensucia la comparación).
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
GO

DECLARE @desde23  varchar(10) = CONVERT(varchar(10), GETDATE(), 23);              -- 'YYYY-MM-DD'
DECLARE @hasta23  varchar(10) = CONVERT(varchar(10), DATEADD(day, 90, GETDATE()), 23);
DECLARE @desde112 varchar(8)  = CONVERT(varchar(8),  GETDATE(), 112);             -- 'YYYYMMDD'
DECLARE @hasta112 varchar(8)  = CONVERT(varchar(8),  DATEADD(day, 91, GETDATE()), 112);

PRINT '--- (29c) FORMA ACTUAL del driver: CONVERT sobre la columna (no sargable) ---';
SELECT CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
       CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist,
       NU_DURA_CIT dura, DE_DESC_CIT descripcion,
       CONVERT(varchar(10), FE_FECH_CIT, 23) fecha
  FROM dbo.CITAS_MEDICAS
 WHERE CONVERT(varchar(10), FE_FECH_CIT, 23) BETWEEN @desde23 AND @hasta23;

PRINT '--- (29d) FORMA CANDIDATA: rango sobre la columna desnuda (sargable) ---';
-- Mismo resultado, misma inmunidad a la zona horaria (el borde viaja como
-- literal 'YYYYMMDD', que SQL Server lee igual bajo cualquier DATEFORMAT),
-- pero dejando la columna sin envolver para que un índice pueda usarse.
-- El borde superior es EXCLUSIVO, por eso son 91 días y no 90.
--
-- ✔ Equivalencia ya verificada contra el mock local sembrando los bordes
--   (ayer, hoy, +89, +90, +91): las dos formas devuelven EXACTAMENTE el mismo
--   conjunto — incluyen hoy y el día +90, excluyen ayer y el día +91. Lo que
--   falta medir aquí no es si dan lo mismo, sino cuánto cuesta cada una.
SELECT CD_CODI_MED_CIT med, FE_HORA_CIT hora, NU_ESTA_CIT estado,
       CD_CODI_SER_CIT servicio, NU_HIST_PAC_CIT hist,
       NU_DURA_CIT dura, DE_DESC_CIT descripcion,
       CONVERT(varchar(10), FE_FECH_CIT, 23) fecha
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= @desde112 AND FE_FECH_CIT < @hasta112;
GO

SET STATISTICS IO OFF;
SET STATISTICS TIME OFF;
GO

-- 👉 De la salida de la pestaña "Messages" hacen falta, para CADA una de las
--    dos: la línea "Table 'CITAS_MEDICAS'. Scan count N, logical reads N..." y
--    la línea "SQL Server Execution Times: ... elapsed time = N ms". Y del
--    plan, si fue Seek o Scan.

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
-- RESULTADO DEL BLOQUE 29 (pendiente de ejecución):
--
--   (29a) índices de CITAS_MEDICAS / TURNOS_MEDICOS:
--   (29b) filas y MB:
--   (29c) forma actual  → Seek/Scan:        logical reads:        elapsed:
--   (29d) forma candidata → Seek/Scan:      logical reads:        elapsed:
--   (29e) claves duplicadas (médico+hora):
--   (29f) NU_NUME_MOVI_CIT nulos:
--
-- QUÉ SE DECIDE CON ESTO
--   · Si (29d) hace Seek y (29c) hace Scan ⇒ cambiar las 4 consultas del
--     driver a la forma sargable. Es un cambio de código, sin pedirle nada al
--     hospital.
--   · Si las DOS hacen Scan ⇒ no hay índice útil por fecha: o se pide uno
--     (cambio en su base, hay que negociarlo), o se baja la frecuencia del
--     bucle de entrada, que hoy comparte el intervalo de 5s del long-poll de
--     salida sin ninguna razón para ello.
--   · Si (29c) ya es barata (pocas lecturas, pocos ms) ⇒ no hay nada que
--     hacer y el polling cada 5s es sostenible. Esa también es una respuesta.
-- =============================================================================

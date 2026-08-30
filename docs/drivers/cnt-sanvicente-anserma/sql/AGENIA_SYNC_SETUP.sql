-- =============================================================================
-- CREACIÓN DE LA INFRAESTRUCTURA AGENIA EN EL SERVIDOR DEL HOSPITAL
-- (ejecutar CON APROBACIÓN DE TI, con un login administrador, UNA sola vez)
--
-- Qué hace:            1) BD propia AGENIA_SYNC  2) login mínimo agenia_sync
--                      3) tablas de estado del agente  4) permisos mínimos en
--                      la BD del HIS  5) (opcional) Change Tracking
-- Qué NO hace:         no crea, altera ni borra NINGÚN objeto del HIS.
--
-- Orden de ejecución:  primero contra PRUEBAS. Tras validar el piloto, repetir
--                      SOLO las secciones 4 y 5 contra ESEHSVP (el catálogo
--                      VIVO confirmado; ESEHSVP2024/2025 son archivos anuales
--                      — NO hay rollover de catálogo).
--
-- ⚠️ ANTES DE PRODUCCIÓN: backup completo de la BD del HIS.
-- ⚠️ La sección 5 (Change Tracking) requiere que cada tabla tenga PRIMARY KEY
--    (verificar con FASE0_DESCUBRIMIENTO_HIS.sql, bloque 1) y visto bueno de TI.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) BASE DE DATOS PROPIA (única huella nuestra en el servidor)
-- -----------------------------------------------------------------------------
IF DB_ID('AGENIA_SYNC') IS NULL
    CREATE DATABASE AGENIA_SYNC;
GO

-- -----------------------------------------------------------------------------
-- 2) LOGIN DEDICADO DE MÍNIMO PRIVILEGIO
--    ⚠️ REEMPLAZAR el password por uno fuerte generado; guardarlo SOLO en el
--    gestor de secretos del agente (config DPAPI). El agente NUNCA usa 'ADMIN'.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'agenia_sync')
    CREATE LOGIN agenia_sync
    WITH PASSWORD = '<<REEMPLAZAR_PASSWORD_FUERTE>>',
         CHECK_POLICY = ON,
         DEFAULT_DATABASE = AGENIA_SYNC;
GO

-- -----------------------------------------------------------------------------
-- 3) TABLAS DE ESTADO DEL AGENTE (en AGENIA_SYNC; agenia_sync es dueño aquí)
-- -----------------------------------------------------------------------------
USE AGENIA_SYNC;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'agenia_sync')
    CREATE USER agenia_sync FOR LOGIN agenia_sync;
ALTER ROLE db_owner ADD MEMBER agenia_sync;
GO

-- Cola local durable: eventos bajados de la nube (PUSH) y detectados en el HIS
-- (PULL) sobreviven aquí a cortes de internet. Nada se pierde por caídas.
CREATE TABLE dbo.LocalQueue (
    seq         BIGINT IDENTITY(1,1) PRIMARY KEY,
    event_id    UNIQUEIDENTIFIER NOT NULL,
    direction   CHAR(4)      NOT NULL,             -- 'PUSH' nube→HIS | 'PULL' HIS→nube
    entity_type VARCHAR(20)  NOT NULL,             -- SLOT | DOCTOR | APPOINTMENT | PATIENT
    entity_id   VARCHAR(64)  NOT NULL,
    op          VARCHAR(10)  NOT NULL,             -- INSERT | UPDATE | DELETE
    payload     NVARCHAR(MAX) NOT NULL,            -- JSON canónico del evento (fechas UTC)
    status      VARCHAR(12)  NOT NULL DEFAULT 'PENDING',  -- PENDING|APPLIED|SENT|DEAD
    attempts    INT          NOT NULL DEFAULT 0,
    last_error  NVARCHAR(2000) NULL,
    created_at  DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    done_at     DATETIME2    NULL,
    CONSTRAINT UQ_LocalQueue_event UNIQUE (event_id)
);
CREATE INDEX IX_LocalQueue_pending ON dbo.LocalQueue (status, seq);
GO

-- Homologación de identidades: UUID de AgenIA ↔ clave del HIS.
CREATE TABLE dbo.MirrorMap (
    entity_type VARCHAR(20) NOT NULL,
    agenia_id   VARCHAR(64) NOT NULL,              -- UUID en Postgres
    his_key     VARCHAR(64) NOT NULL,              -- CD_CODI_MED / NU_HIST_PAC / PK de CITAS_MEDICAS...
    created_at  DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_MirrorMap PRIMARY KEY (entity_type, agenia_id),
    CONSTRAINT UQ_MirrorMap_his UNIQUE (entity_type, his_key)
);
GO

-- Idempotencia: un evento aplicado dos veces no hace nada la segunda vez.
CREATE TABLE dbo.AppliedEvents (
    event_id   UNIQUEIDENTIFIER PRIMARY KEY,
    applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Fotos hash para el polling diferencial (detección de cambios sin tocar el HIS).
CREATE TABLE dbo.[Snapshot] (
    entity_type VARCHAR(20) NOT NULL,
    his_key     VARCHAR(64) NOT NULL,
    row_hash    BINARY(32)  NOT NULL,              -- SHA-256 de las columnas relevantes
    seen_at     DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Snapshot PRIMARY KEY (entity_type, his_key)
);
GO

-- Auditoría append-only de TODA operación del agente (retención ≥ 1 año).
CREATE TABLE dbo.SyncAuditLog (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    at          DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),
    direction   CHAR(4)     NOT NULL,
    entity_type VARCHAR(20) NULL,
    his_key     VARCHAR(64) NULL,
    agenia_id   VARCHAR(64) NULL,
    op          VARCHAR(10) NULL,
    outcome     VARCHAR(12) NOT NULL,              -- OK | RETRY | DEAD | CONFLICT | SKIPPED
    error       NVARCHAR(2000) NULL,
    duration_ms INT NULL,
    event_id    UNIQUEIDENTIFIER NULL
);
CREATE INDEX IX_SyncAuditLog_at ON dbo.SyncAuditLog (at);
GO

-- Estado del agente: cursores, versión de mapeo, catálogo HIS vigente...
CREATE TABLE dbo.AgentState (
    k          VARCHAR(50)  PRIMARY KEY,
    v          NVARCHAR(400) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- -----------------------------------------------------------------------------
-- 4) PERMISOS MÍNIMOS EN LA BD DEL HIS  (primero PRUEBAS; luego ESEHSVP2025)
--    Lectura: tablas del flujo de citas y sus catálogos de homologación.
--    Escritura: SOLO en CITAS_MEDICAS/CITAS_ANULADAS/PACIENTES, con el DELETE
--    puntual sobre CITAS_MEDICAS que exige la cancelación (mecanismo real
--    confirmado por la prueba manual del hospital — ver MAPEO_HIS.md §2.1bis).
--    SIN ALTER, SIN permisos de BD, sin acceso a nada fuera de este alcance.
-- -----------------------------------------------------------------------------
USE PRUEBAS;   -- ⚠️ producción: USE ESEHSVP; (catálogo VIVO confirmado en Fase 0 — los sufijos de año son archivos)
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'agenia_sync')
    CREATE USER agenia_sync FOR LOGIN agenia_sync;
GO
-- Lectura
GRANT SELECT ON dbo.CITAS_MEDICAS   TO agenia_sync;
GRANT SELECT ON dbo.CITAS_ANULADAS  TO agenia_sync;  -- correlacionar cancelaciones del HIS (§2.1bis)
GRANT SELECT ON dbo.MEDICOS         TO agenia_sync;
GRANT SELECT ON dbo.PACIENTES       TO agenia_sync;
GRANT SELECT ON dbo.SERVICIOS       TO agenia_sync;
GRANT SELECT ON dbo.TIPO_DOCUMENTO  TO agenia_sync;
GRANT SELECT ON dbo.MUNICIPIOS      TO agenia_sync;
GRANT SELECT ON dbo.R_PAC_EPS       TO agenia_sync;
GRANT SELECT ON dbo.TURNOS_MEDICOS  TO agenia_sync;
GRANT SELECT ON dbo.MOTIVOANUL      TO agenia_sync;  -- validar código de motivo al cancelar
GRANT SELECT ON dbo.CONVENIOS       TO agenia_sync;  -- resolver convenio (EPS+régimen+PyP, §2.3)
GRANT SELECT ON dbo.EPS             TO agenia_sync;
GRANT SELECT ON dbo.CONSULTORIOS    TO agenia_sync;  -- última milla del INSERT (esquema confirmado; regla de asignación aún por validar a escala, bloque 25)
GRANT SELECT ON dbo.R_ESP_SER       TO agenia_sync;  -- candidato de especialidad por servicio (bloque 21)
-- Escritura (mínima — ver MAPEO_HIS.md §2.1bis: alta = INSERT en CITAS_MEDICAS;
-- cancelación = DELETE de CITAS_MEDICAS + INSERT en CITAS_ANULADAS, confirmado
-- por la prueba manual del hospital. Deliberadamente SIN UPDATE en CITAS_MEDICAS
-- más allá de lo necesario, SIN ALTER, SIN permisos de BD.)
GRANT INSERT, UPDATE ON dbo.CITAS_MEDICAS  TO agenia_sync;  -- alta + reflejar asistencia (updateAttendance)
GRANT DELETE         ON dbo.CITAS_MEDICAS  TO agenia_sync;  -- cancelación (mecanismo confirmado en Fase 0)
GRANT INSERT         ON dbo.CITAS_ANULADAS TO agenia_sync;  -- registrar motivo/observaciones al cancelar
GRANT INSERT, UPDATE ON dbo.PACIENTES      TO agenia_sync;  -- alta mínima de paciente nuevo (§3.3)
GO

-- -----------------------------------------------------------------------------
-- 5) (OPCIONAL, RECOMENDADO) CHANGE TRACKING — detección de cambios nativa
--    Requisitos: PK en cada tabla (bloque 1 del descubrimiento) + OK de TI.
--    No modifica el esquema de las tablas ni usa triggers; overhead mínimo.
--    Si TI no lo aprueba, el agente opera por polling diferencial (Snapshot).
-- -----------------------------------------------------------------------------
-- ALTER DATABASE PRUEBAS   -- (producción: ESEHSVP)
--     SET CHANGE_TRACKING = ON (CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);
-- GO
-- ALTER TABLE dbo.CITAS_MEDICAS ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);
-- ALTER TABLE dbo.PACIENTES     ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);
-- ALTER TABLE dbo.MEDICOS       ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);
-- GO
-- GRANT VIEW CHANGE TRACKING ON dbo.CITAS_MEDICAS TO agenia_sync;
-- GRANT VIEW CHANGE TRACKING ON dbo.PACIENTES     TO agenia_sync;
-- GRANT VIEW CHANGE TRACKING ON dbo.MEDICOS       TO agenia_sync;
-- GO

-- -----------------------------------------------------------------------------
-- 6) VERIFICACIÓN (ejecutar como administrador; simula al agente)
-- -----------------------------------------------------------------------------
EXECUTE AS LOGIN = 'agenia_sync';
SELECT TOP 1 CD_CODI_MED_CIT, FE_FECH_CIT FROM PRUEBAS.dbo.CITAS_MEDICAS;   -- debe funcionar
SELECT COUNT(*) FROM AGENIA_SYNC.dbo.LocalQueue;                            -- debe funcionar
-- DELETE sobre CITAS_MEDICAS SÍ debe funcionar (es la cancelación, ver arriba) —
-- probarlo dentro de una transacción con ROLLBACK, nunca contra una fila real:
-- BEGIN TRAN;
--   DELETE FROM PRUEBAS.dbo.CITAS_MEDICAS WHERE 1 = 0;  -- predicado falso: no borra nada, solo valida el permiso
-- ROLLBACK;
-- Lo siguiente DEBE FALLAR (permiso denegado) — confirma el mínimo privilegio
-- fuera del alcance de citas:
-- SELECT TOP 1 * FROM PRUEBAS.dbo.HISTORIACLINICA;
-- DELETE FROM PRUEBAS.dbo.PACIENTES WHERE 1 = 0;  -- nunca se otorgó DELETE sobre pacientes
-- ALTER TABLE PRUEBAS.dbo.CITAS_MEDICAS ADD test_col INT;  -- ni ALTER de ningún tipo
REVERT;
GO

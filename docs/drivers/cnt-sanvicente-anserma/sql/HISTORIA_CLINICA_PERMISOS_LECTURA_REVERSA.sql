-- =============================================================================
-- REVERSA de HISTORIA_CLINICA_PERMISOS_LECTURA_ESEHSVP.sql · base ESEHSVP
--
-- Quita los permisos de lectura POR COLUMNA que tiene agenia_sync sobre las 28
-- tablas del resumen de la atención. No toca las tablas que agenia_sync lee
-- completas por las citas (MEDICOS, PACIENTES, SERVICIOS, TIPO_DOCUMENTO, CONVENIOS, EPS): las citas siguen funcionando.
-- Con esto, el agente deja de poder leer la historia clínica.
--
-- TI, en SSMS, conectado a ESEHSVP con un usuario administrador. Muestra lo que
-- va a quitar antes de quitarlo.
-- =============================================================================
USE ESEHSVP;
GO
SET NOCOUNT ON;
-- Un solo bloque: la comprobación y lo que se quita van juntos.
IF DB_NAME() <> N'ESEHSVP' OR DATABASE_PRINCIPAL_ID(N'agenia_sync') IS NULL
BEGIN
    RAISERROR(N'No está en ESEHSVP o no existe agenia_sync. No se cambió nada.', 16, 1);
    RETURN;
END
DECLARE @quitar TABLE (tabla sysname, sentencia nvarchar(max));
INSERT @quitar (tabla, sentencia)
SELECT o.name,
       N'REVOKE SELECT (' + STRING_AGG(CAST(QUOTENAME(c.name) AS nvarchar(max)), N', ')
       + N') ON dbo.' + QUOTENAME(o.name) + N' FROM agenia_sync;'
  FROM sys.database_permissions p
  JOIN sys.objects o ON o.object_id = p.major_id
  JOIN sys.columns c ON c.object_id = p.major_id AND c.column_id = p.minor_id
 WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'agenia_sync')
   AND p.permission_name = N'SELECT' AND p.state IN ('G', 'W') AND p.minor_id > 0
   AND SCHEMA_NAME(o.schema_id) = N'dbo'
   AND o.name IN (N'HISTORIACLINICA', N'HIST_ORDEN', N'HIST_MEDI', N'HIST_PROC', N'HIST_INDI', N'HIST_INCA', N'HIST_REMI', N'HIST_ORTIAT', N'R_LABO_DIAG', N'LABORATORIO', N'DATOS_PLANTILLA', N'DATOS_PLANTILLA_TEXT', N'DATOS_PLANTILLA_MEMO', N'DATOS_PLANTILLA_NUME', N'DATOS_PLANTILLA_DATE', N'R_PLAN_ESP_TIAT', N'R_PLAN_CONC', N'CONCEPTO_HIST', N'GRUPO_HIST', N'PLANTILLA_HIST', N'DIAGNOSTICO', N'TIPODIAGNOSTICO', N'ESPECIALIDADES', N'PAC_CONFIG_HIS', N'ARTICULO', N'HIST_TEMLABO', N'TIPOUSUARIO', N'ENTIDAD')
   -- Por si TI le dio después la tabla completa: entonces no se toca esa tabla.
   AND NOT EXISTS (SELECT 1 FROM sys.database_permissions t
                    WHERE t.grantee_principal_id = p.grantee_principal_id AND t.major_id = p.major_id
                      AND t.minor_id = 0 AND t.permission_name = N'SELECT' AND t.state IN ('G', 'W'))
 GROUP BY o.name;

SELECT tabla, sentencia AS [se va a ejecutar] FROM @quitar ORDER BY tabla;

DECLARE @sql nvarchar(max) = (SELECT STRING_AGG(sentencia, NCHAR(10)) FROM @quitar);
DECLARE @tablas int = (SELECT COUNT(*) FROM @quitar);
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;
COMMIT TRANSACTION;
PRINT N'Reversa aplicada: ' + CAST(@tablas AS nvarchar(10)) + N' tabla(s).';
GO

-- =============================================================================
-- PERMISOS DE LECTURA DEL RESUMEN DE LA ATENCIÓN · base ESEHSVP
-- (docs/PLAN_RESUMEN_ATENCION.md §8.1, bloque P-7, y §8.10)
--
-- QUÉ HACE: le da al usuario agenia_sync permiso de SOLO LECTURA (SELECT),
-- columna por columna, sobre las 173 columnas de 34 tablas que lee el agente
-- para armar el resumen de la atención.
--   · 6 de esas tablas ya las lee completas por las citas (MEDICOS, PACIENTES, SERVICIOS, TIPO_DOCUMENTO, CONVENIOS, EPS):
--     no se tocan; solo se comprueba que sigan así.
--   · Las otras 28 reciben un GRANT por columna (145 columnas).
--
-- QUÉ NO HACE: no escribe, no borra ni cambia datos ni tablas; no da permiso sobre
-- tablas completas ni para ejecutar procedimientos; no toca INTER_RES1888 ni
-- USUARIOS (contraseñas); no quita ningún permiso que agenia_sync ya tenga: las
-- citas siguen funcionando igual.
--
-- QUIÉN Y DÓNDE: TI, en SQL Server Management Studio, conectado al servidor del
-- HIS con un usuario administrador (sysadmin o db_owner de ESEHSVP). Se abre este
-- archivo y se ejecuta completo (F5). Se puede correr dos veces: un GRANT repetido
-- no cambia nada.
--
-- PARTES:
--   1) Comprobaciones. Si algo no cuadra, se detiene con un mensaje y NO cambia nada.
--   2) Los permisos, en el mismo bloque y en una sola transacción: o quedan todos
--      o ninguno.
--   3) Prueba como agenia_sync, sin leer datos (TOP (0)): debe decir «OK» en las
--      34 tablas, y que NO puede leer la historia completa ni INTER_RES1888.
-- Para deshacerlo: HISTORIA_CLINICA_PERMISOS_LECTURA_REVERSA.sql.
-- =============================================================================
USE ESEHSVP;
GO
SET NOCOUNT ON;
GO

-- -----------------------------------------------------------------------------
-- 1) y 2) Comprobaciones y permisos, en UN SOLO bloque: si algo no compila, no se
--         ejecuta nada; si una comprobación falla, se detiene antes de los
--         permisos; si un permiso falla, se deshacen todos.
-- -----------------------------------------------------------------------------
IF OBJECT_ID(N'tempdb..#cols') IS NOT NULL DROP TABLE #cols;
CREATE TABLE #cols (tabla sysname NOT NULL, columna sysname NOT NULL);
INSERT #cols (tabla, columna) VALUES
    (N'HISTORIACLINICA', N'NU_NUME_HICL'), (N'HISTORIACLINICA', N'FE_FECH_HICL'),
    (N'HISTORIACLINICA', N'NU_HIST_PAC_HICL'), (N'HISTORIACLINICA', N'CD_MED_REAL_HICL'),
    (N'HISTORIACLINICA', N'TX_TIPO_HICL'), (N'HISTORIACLINICA', N'NU_ESTA_HICL'),
    (N'HISTORIACLINICA', N'TX_CODSER_HICL'), (N'HISTORIACLINICA', N'NU_AUTO_DAPL_HICL'),
    (N'HISTORIACLINICA', N'NU_NUME_LABO_HICL'), (N'HISTORIACLINICA', N'NU_NUME_REG_HICL'),
    (N'HISTORIACLINICA', N'NU_NUME_PADR_HICL'),
    (N'HIST_ORDEN', N'NU_AUTO_HORD'), (N'HIST_ORDEN', N'NU_NUME_HICL_HORD'),
    (N'HIST_ORDEN', N'NU_TIPO_HORD'), (N'HIST_ORDEN', N'TX_TIAP_HORD'), (N'HIST_ORDEN', N'FE_FECH_HORD'),
    (N'HIST_ORDEN', N'FE_POSFECHA'), (N'HIST_ORDEN', N'NU_ORDEN_FECHAPOS'), (N'HIST_ORDEN', N'TX_VIGE_HORD'),
    (N'HIST_MEDI', N'NU_AUTO_HORD_HMED'), (N'HIST_MEDI', N'NU_NUME_HMED'),
    (N'HIST_MEDI', N'CD_CODI_ARTI_HMED'), (N'HIST_MEDI', N'NO_NOMB_ARTI_HMED'),
    (N'HIST_MEDI', N'TX_FOFA_HMED'), (N'HIST_MEDI', N'TX_VIAD_HMED'), (N'HIST_MEDI', N'NU_CANT_HMED'),
    (N'HIST_MEDI', N'TX_DURA_HMED'), (N'HIST_MEDI', N'TX_INDDOS_HMED'), (N'HIST_MEDI', N'NU_CTFREC_HMED'),
    (N'HIST_MEDI', N'TX_CDFREC_HMED'), (N'HIST_MEDI', N'NU_ESTA_HMED'), (N'HIST_MEDI', N'NU_AUTO_UNVE_HMED'),
    (N'HIST_MEDI', N'DE_UNME_HMED'), (N'HIST_MEDI', N'DE_CTRA_HMED'),
    (N'HIST_PROC', N'NU_AUTO_HORD_HPRO'), (N'HIST_PROC', N'NU_NUME_HPRO'),
    (N'HIST_PROC', N'CD_CODI_SER_HPRO'), (N'HIST_PROC', N'NU_CANT_HPRO'), (N'HIST_PROC', N'DE_INDI_HPRO'),
    (N'HIST_PROC', N'NU_ESTA_HPRO'),
    (N'HIST_INDI', N'NU_NUME_HICL_HIND'), (N'HIST_INDI', N'DE_DESC_HIND'), (N'HIST_INDI', N'NU_NUME_HIND'),
    (N'HIST_INCA', N'NU_NUME_HICL_HINC'), (N'HIST_INCA', N'NU_DIAS_HINC'), (N'HIST_INCA', N'FE_INIC_HINC'),
    (N'HIST_INCA', N'NU_NUME_HINC'), (N'HIST_INCA', N'NU_PROR_HINC'), (N'HIST_INCA', N'TX_TIPO_HINC'),
    (N'HIST_INCA', N'TX_ORIG_INCA_HINC'), (N'HIST_INCA', N'CD_CODI_CAEX_HINC'),
    (N'HIST_INCA', N'TX_MODA_SALU_HINC'), (N'HIST_INCA', N'TX_GRUP_SERV_HINC'),
    (N'HIST_INCA', N'TX_INCA_RETR_HINC'), (N'HIST_INCA', N'DE_DESC_HINC'),
    (N'HIST_REMI', N'NU_NUME_HICL_HREM'), (N'HIST_REMI', N'TX_SERV_HREM'), (N'HIST_REMI', N'TX_PRIO_HREM'),
    (N'HIST_REMI', N'DE_REMI_HREM'), (N'HIST_REMI', N'NU_NUME_HREM'), (N'HIST_REMI', N'FE_FECHA_HREM'),
    (N'HIST_REMI', N'NU_INST_HREM'), (N'HIST_REMI', N'DE_DESC_HREM'), (N'HIST_REMI', N'NU_MTVREM_HREM'),
    (N'HIST_REMI', N'NU_SRVREM_HREM'), (N'HIST_REMI', N'TX_SRVREM_HREM'), (N'HIST_REMI', N'TX_TIPTRA_HREM'),
    (N'HIST_REMI', N'TX_DESPER_HREM'), (N'HIST_REMI', N'TX_MOTATE_HREM'), (N'HIST_REMI', N'TX_GRUSER_HREM'),
    (N'HIST_REMI', N'TX_MODTEC_HREM'), (N'HIST_REMI', N'TX_CODSER_HREM'), (N'HIST_REMI', N'TX_CUPSPR_HREM'),
    (N'HIST_REMI', N'NU_CANTPR_HREM'), (N'HIST_REMI', N'TX_REHA_HREM'), (N'HIST_REMI', N'TX_REAC_HREM'),
    (N'HIST_REMI', N'TX_DATACO_HREM'), (N'HIST_REMI', N'TX_TIPREG_HREM'),
    (N'HIST_REMI', N'CD_CODI_REG_HREM'), (N'HIST_REMI', N'TX_NOMREG_HREM'), (N'HIST_REMI', N'TX_FICHA_HREM'),
    (N'HIST_REMI', N'TX_ADMIN_HREM'), (N'HIST_REMI', N'TX_CASO_HREM'),
    (N'HIST_ORTIAT', N'NU_NUME_HICL_HOTA'), (N'HIST_ORTIAT', N'CD_CODI_ESP_HOTA'),
    (N'HIST_ORTIAT', N'NU_NUME_HOTA'), (N'HIST_ORTIAT', N'ME_OBSER_HOTA'), (N'HIST_ORTIAT', N'NU_TIPO_HOTA'),
    (N'R_LABO_DIAG', N'NU_NUME_LABO_RLAD'), (N'R_LABO_DIAG', N'CD_CODI_DIAG_RLAD'),
    (N'R_LABO_DIAG', N'ID_TIPO_DIAG_RLAD'), (N'R_LABO_DIAG', N'ID_TIPO_RLAD'),
    (N'LABORATORIO', N'NU_NUME_LABO'), (N'LABORATORIO', N'CD_CODI_ESP_LABO'),
    (N'LABORATORIO', N'NU_EDAD_LABO'),
    (N'DATOS_PLANTILLA', N'NU_AUTO_DAPL'), (N'DATOS_PLANTILLA', N'NU_NUME_RPET_DAPL'),
    (N'DATOS_PLANTILLA_TEXT', N'NU_AUTO_DAPL_DPTE'), (N'DATOS_PLANTILLA_TEXT', N'NU_INDI_DPTE'),
    (N'DATOS_PLANTILLA_TEXT', N'TX_DESC_DPTE'),
    (N'DATOS_PLANTILLA_MEMO', N'NU_AUTO_DAPL_DPME'), (N'DATOS_PLANTILLA_MEMO', N'NU_INDI_DPME'),
    (N'DATOS_PLANTILLA_MEMO', N'TX_DESC_DPME'),
    (N'DATOS_PLANTILLA_NUME', N'NU_AUTO_DAPL_DPNU'), (N'DATOS_PLANTILLA_NUME', N'NU_INDI_DPNU'),
    (N'DATOS_PLANTILLA_NUME', N'NU_DESC_DPNU'),
    (N'DATOS_PLANTILLA_DATE', N'NU_AUTO_DAPL_DPDA'), (N'DATOS_PLANTILLA_DATE', N'NU_INDI_DPDA'),
    (N'DATOS_PLANTILLA_DATE', N'FE_DESC_DPDA'),
    (N'R_PLAN_ESP_TIAT', N'NU_NUME_RPET'), (N'R_PLAN_ESP_TIAT', N'NU_NUME_PLHI_RPET'),
    (N'R_PLAN_CONC', N'NU_NUME_PLHI_RPC'), (N'R_PLAN_CONC', N'NU_INDI_RPC'),
    (N'R_PLAN_CONC', N'NU_NUME_COHI_RPC'), (N'R_PLAN_CONC', N'NU_NUME_GRHI_RPC'),
    (N'CONCEPTO_HIST', N'NU_NUME_COHI'), (N'CONCEPTO_HIST', N'CD_CODI_COHI'),
    (N'GRUPO_HIST', N'NU_NUME_GRHI'), (N'GRUPO_HIST', N'CD_CODI_GRHI'),
    (N'PLANTILLA_HIST', N'NU_NUME_PLHI'), (N'PLANTILLA_HIST', N'TX_DESC_PLHI'),
    (N'PLANTILLA_HIST', N'TX_CODI_PLHI'),
    (N'DIAGNOSTICO', N'CD_CODI_DIAG'), (N'DIAGNOSTICO', N'DE_DESC_DIAG'),
    (N'TIPODIAGNOSTICO', N'ID_CODI_TIDI'), (N'TIPODIAGNOSTICO', N'DE_DESC_TIDI'),
    (N'ESPECIALIDADES', N'CD_CODI_ESP'), (N'ESPECIALIDADES', N'NO_NOMB_ESP'),
    (N'SERVICIOS', N'CD_CODI_SER'), (N'SERVICIOS', N'NO_NOMB_SER'),
    (N'MEDICOS', N'CD_CODI_MED'), (N'MEDICOS', N'NO_NOMB_MED'), (N'MEDICOS', N'DE_REGI_MED'),
    (N'MEDICOS', N'NU_DOCU_MED'),
    (N'PAC_CONFIG_HIS', N'TX_CODI_CONF_HIS'), (N'PAC_CONFIG_HIS', N'TX_DESC_CONF_HIS'),
    (N'PAC_CONFIG_HIS', N'NU_TIPO_CONF_HIS'),
    (N'PACIENTES', N'NU_HIST_PAC'), (N'PACIENTES', N'DE_TELE_PAC'), (N'PACIENTES', N'DE_EMAIL_PAC'),
    (N'PACIENTES', N'FE_NACI_PAC'), (N'PACIENTES', N'DE_TELE_ACOM_PAC'),
    (N'PACIENTES', N'TX_EMAIL_ACOM_PAC'), (N'PACIENTES', N'NU_DOCU_PAC'), (N'PACIENTES', N'NU_TIPD_PAC'),
    (N'PACIENTES', N'NO_NOMB_PAC'), (N'PACIENTES', N'NO_SGNO_PAC'), (N'PACIENTES', N'DE_PRAP_PAC'),
    (N'PACIENTES', N'DE_SGAP_PAC'), (N'PACIENTES', N'NU_TIPO_PAC'), (N'PACIENTES', N'NU_NIVE_PAC'),
    (N'ARTICULO', N'CD_CODI_ARTI'), (N'ARTICULO', N'NU_CODCUM_ARTI'), (N'ARTICULO', N'TX_INVIMA_ARTI'),
    (N'HIST_TEMLABO', N'NU_NUME_HICL_HTLA'), (N'HIST_TEMLABO', N'NU_NUME_CONV_HTLA'),
    (N'TIPO_DOCUMENTO', N'NU_CODIGO_TDOC'), (N'TIPO_DOCUMENTO', N'TX_NOMB_TDOC'),
    (N'CONVENIOS', N'NU_NUME_CONV'), (N'CONVENIOS', N'CD_CODI_CONV'), (N'CONVENIOS', N'CD_NIT_EPS_CONV'),
    (N'CONVENIOS', N'ID_CODI_TIUS_CONV'),
    (N'TIPOUSUARIO', N'ID_CODI_TIUS'), (N'TIPOUSUARIO', N'DE_DESC_TIUS'),
    (N'EPS', N'CD_NIT_EPS'), (N'EPS', N'NO_NOMB_EPS'),
    (N'ENTIDAD', N'NO_NOMB_ENTI'), (N'ENTIDAD', N'CD_NIT_ENTI'), (N'ENTIDAD', N'DE_DIRE_ENTI'),
    (N'ENTIDAD', N'DE_TELE_ENTI'), (N'ENTIDAD', N'CD_CODI_DPTO_ENTI'), (N'ENTIDAD', N'CD_CODI_MUNI_ENTI'),
    (N'ENTIDAD', N'IM_LOGO_ENTI');

DECLARE @problema nvarchar(4000) = NULL;
DECLARE @agenia int = DATABASE_PRINCIPAL_ID(N'agenia_sync');

IF DB_NAME() <> N'ESEHSVP'
    SET @problema = N'Esta ventana está en la base «' + DB_NAME() + N'», no en ESEHSVP.';
ELSE IF @agenia IS NULL
    SET @problema = N'No existe el usuario agenia_sync en ESEHSVP.';
ELSE IF IS_SRVROLEMEMBER(N'sysadmin') <> 1 AND IS_MEMBER(N'db_owner') <> 1
    SET @problema = N'El usuario «' + SUSER_SNAME() + N'» no es administrador de ESEHSVP (sysadmin o db_owner).';
ELSE IF EXISTS (SELECT 1 FROM #cols WHERE COL_LENGTH(N'dbo.' + tabla, columna) IS NULL)
    SELECT @problema = N'Estas columnas no existen en ESEHSVP: '
                     + STRING_AGG(CAST(tabla + N'.' + columna AS nvarchar(max)), N', ')
                     + N'. Avísenle a AgenIA antes de seguir.'
      FROM #cols WHERE COL_LENGTH(N'dbo.' + tabla, columna) IS NULL;
ELSE IF EXISTS (SELECT 1
                  FROM sys.database_permissions p
                  JOIN #cols c ON p.major_id = OBJECT_ID(N'dbo.' + c.tabla)
                 WHERE p.grantee_principal_id = @agenia AND p.permission_name = N'SELECT' AND p.state = 'D')
    SET @problema = N'agenia_sync tiene un DENY de lectura sobre alguna de estas tablas. '
                  + N'Avísenle a AgenIA antes de seguir: no se quita sin revisarlo.';
ELSE IF EXISTS (SELECT 1
                  FROM (VALUES (N'MEDICOS'), (N'PACIENTES'), (N'SERVICIOS'), (N'TIPO_DOCUMENTO'), (N'CONVENIOS'), (N'EPS')) y(tabla)
                 WHERE NOT EXISTS (SELECT 1 FROM sys.database_permissions p
                                    WHERE p.grantee_principal_id = @agenia AND p.permission_name = N'SELECT'
                                      AND p.state IN ('G', 'W') AND p.minor_id = 0
                                      AND p.major_id = OBJECT_ID(N'dbo.' + y.tabla)))
    SET @problema = N'agenia_sync ya no lee completa alguna de las tablas de las citas '
                  + N'(MEDICOS, PACIENTES, SERVICIOS, TIPO_DOCUMENTO, CONVENIOS, EPS). Avísenle a AgenIA antes de seguir.';

IF @problema IS NOT NULL
BEGIN
    RAISERROR(N'%s No se cambió nada.', 16, 1, @problema);
    SET NOEXEC ON;   -- lo que sigue en el archivo tampoco se ejecuta
    RETURN;
END
PRINT N'1) Comprobaciones: todo en orden.';

-- Los permisos: SOLO LECTURA, por columna, en una transacción.
BEGIN TRY
BEGIN TRANSACTION;

GRANT SELECT (NU_NUME_HICL, FE_FECH_HICL, NU_HIST_PAC_HICL, CD_MED_REAL_HICL, TX_TIPO_HICL, NU_ESTA_HICL,
              TX_CODSER_HICL, NU_AUTO_DAPL_HICL, NU_NUME_LABO_HICL, NU_NUME_REG_HICL, NU_NUME_PADR_HICL)
    ON dbo.HISTORIACLINICA TO agenia_sync;
GRANT SELECT (NU_AUTO_HORD, NU_NUME_HICL_HORD, NU_TIPO_HORD, TX_TIAP_HORD, FE_FECH_HORD, FE_POSFECHA,
              NU_ORDEN_FECHAPOS, TX_VIGE_HORD)
    ON dbo.HIST_ORDEN TO agenia_sync;
GRANT SELECT (NU_AUTO_HORD_HMED, NU_NUME_HMED, CD_CODI_ARTI_HMED, NO_NOMB_ARTI_HMED, TX_FOFA_HMED,
              TX_VIAD_HMED, NU_CANT_HMED, TX_DURA_HMED, TX_INDDOS_HMED, NU_CTFREC_HMED, TX_CDFREC_HMED,
              NU_ESTA_HMED, NU_AUTO_UNVE_HMED, DE_UNME_HMED, DE_CTRA_HMED)
    ON dbo.HIST_MEDI TO agenia_sync;
GRANT SELECT (NU_AUTO_HORD_HPRO, NU_NUME_HPRO, CD_CODI_SER_HPRO, NU_CANT_HPRO, DE_INDI_HPRO, NU_ESTA_HPRO)
    ON dbo.HIST_PROC TO agenia_sync;
GRANT SELECT (NU_NUME_HICL_HIND, DE_DESC_HIND, NU_NUME_HIND)
    ON dbo.HIST_INDI TO agenia_sync;
GRANT SELECT (NU_NUME_HICL_HINC, NU_DIAS_HINC, FE_INIC_HINC, NU_NUME_HINC, NU_PROR_HINC, TX_TIPO_HINC,
              TX_ORIG_INCA_HINC, CD_CODI_CAEX_HINC, TX_MODA_SALU_HINC, TX_GRUP_SERV_HINC, TX_INCA_RETR_HINC,
              DE_DESC_HINC)
    ON dbo.HIST_INCA TO agenia_sync;
GRANT SELECT (NU_NUME_HICL_HREM, TX_SERV_HREM, TX_PRIO_HREM, DE_REMI_HREM, NU_NUME_HREM, FE_FECHA_HREM,
              NU_INST_HREM, DE_DESC_HREM, NU_MTVREM_HREM, NU_SRVREM_HREM, TX_SRVREM_HREM, TX_TIPTRA_HREM,
              TX_DESPER_HREM, TX_MOTATE_HREM, TX_GRUSER_HREM, TX_MODTEC_HREM, TX_CODSER_HREM, TX_CUPSPR_HREM,
              NU_CANTPR_HREM, TX_REHA_HREM, TX_REAC_HREM, TX_DATACO_HREM, TX_TIPREG_HREM, CD_CODI_REG_HREM,
              TX_NOMREG_HREM, TX_FICHA_HREM, TX_ADMIN_HREM, TX_CASO_HREM)
    ON dbo.HIST_REMI TO agenia_sync;
GRANT SELECT (NU_NUME_HICL_HOTA, CD_CODI_ESP_HOTA, NU_NUME_HOTA, ME_OBSER_HOTA, NU_TIPO_HOTA)
    ON dbo.HIST_ORTIAT TO agenia_sync;
GRANT SELECT (NU_NUME_LABO_RLAD, CD_CODI_DIAG_RLAD, ID_TIPO_DIAG_RLAD, ID_TIPO_RLAD)
    ON dbo.R_LABO_DIAG TO agenia_sync;
GRANT SELECT (NU_NUME_LABO, CD_CODI_ESP_LABO, NU_EDAD_LABO)
    ON dbo.LABORATORIO TO agenia_sync;
GRANT SELECT (NU_AUTO_DAPL, NU_NUME_RPET_DAPL)
    ON dbo.DATOS_PLANTILLA TO agenia_sync;
GRANT SELECT (NU_AUTO_DAPL_DPTE, NU_INDI_DPTE, TX_DESC_DPTE)
    ON dbo.DATOS_PLANTILLA_TEXT TO agenia_sync;
GRANT SELECT (NU_AUTO_DAPL_DPME, NU_INDI_DPME, TX_DESC_DPME)
    ON dbo.DATOS_PLANTILLA_MEMO TO agenia_sync;
GRANT SELECT (NU_AUTO_DAPL_DPNU, NU_INDI_DPNU, NU_DESC_DPNU)
    ON dbo.DATOS_PLANTILLA_NUME TO agenia_sync;
GRANT SELECT (NU_AUTO_DAPL_DPDA, NU_INDI_DPDA, FE_DESC_DPDA)
    ON dbo.DATOS_PLANTILLA_DATE TO agenia_sync;
GRANT SELECT (NU_NUME_RPET, NU_NUME_PLHI_RPET)
    ON dbo.R_PLAN_ESP_TIAT TO agenia_sync;
GRANT SELECT (NU_NUME_PLHI_RPC, NU_INDI_RPC, NU_NUME_COHI_RPC, NU_NUME_GRHI_RPC)
    ON dbo.R_PLAN_CONC TO agenia_sync;
GRANT SELECT (NU_NUME_COHI, CD_CODI_COHI)
    ON dbo.CONCEPTO_HIST TO agenia_sync;
GRANT SELECT (NU_NUME_GRHI, CD_CODI_GRHI)
    ON dbo.GRUPO_HIST TO agenia_sync;
GRANT SELECT (NU_NUME_PLHI, TX_DESC_PLHI, TX_CODI_PLHI)
    ON dbo.PLANTILLA_HIST TO agenia_sync;
GRANT SELECT (CD_CODI_DIAG, DE_DESC_DIAG)
    ON dbo.DIAGNOSTICO TO agenia_sync;
GRANT SELECT (ID_CODI_TIDI, DE_DESC_TIDI)
    ON dbo.TIPODIAGNOSTICO TO agenia_sync;
GRANT SELECT (CD_CODI_ESP, NO_NOMB_ESP)
    ON dbo.ESPECIALIDADES TO agenia_sync;
GRANT SELECT (TX_CODI_CONF_HIS, TX_DESC_CONF_HIS, NU_TIPO_CONF_HIS)
    ON dbo.PAC_CONFIG_HIS TO agenia_sync;
GRANT SELECT (CD_CODI_ARTI, NU_CODCUM_ARTI, TX_INVIMA_ARTI)
    ON dbo.ARTICULO TO agenia_sync;
GRANT SELECT (NU_NUME_HICL_HTLA, NU_NUME_CONV_HTLA)
    ON dbo.HIST_TEMLABO TO agenia_sync;
GRANT SELECT (ID_CODI_TIUS, DE_DESC_TIUS)
    ON dbo.TIPOUSUARIO TO agenia_sync;
GRANT SELECT (NO_NOMB_ENTI, CD_NIT_ENTI, DE_DIRE_ENTI, DE_TELE_ENTI, CD_CODI_DPTO_ENTI, CD_CODI_MUNI_ENTI,
              IM_LOGO_ENTI)
    ON dbo.ENTIDAD TO agenia_sync;

COMMIT TRANSACTION;
PRINT N'2) Permisos aplicados.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SET @problema = ERROR_MESSAGE();
    RAISERROR(N'No se aplicó ningún permiso: %s', 16, 1, @problema);
    SET NOEXEC ON;
END CATCH;
GO

-- -----------------------------------------------------------------------------
-- 3) Prueba como agenia_sync (no lee datos: TOP (0))
-- -----------------------------------------------------------------------------
DECLARE @pruebas TABLE (orden int IDENTITY, tabla sysname, consulta nvarchar(max), esperado nvarchar(20), resultado nvarchar(400));

-- Debe poder: las columnas de cada tabla.
INSERT @pruebas (tabla, consulta, esperado)
SELECT tabla,
       N'DECLARE @n int; SELECT @n = COUNT(*) FROM (SELECT TOP (0) '
       + STRING_AGG(CAST(QUOTENAME(columna) AS nvarchar(max)), N', ')
       + N' FROM dbo.' + QUOTENAME(tabla) + N') x;',
       N'PUEDE'
  FROM #cols
 GROUP BY tabla;

-- No debe poder: la historia completa ni las credenciales del Ministerio.
INSERT @pruebas (tabla, consulta, esperado) VALUES
    (N'HISTORIACLINICA (tabla completa)', N'DECLARE @n int; SELECT @n = COUNT(*) FROM (SELECT TOP (0) * FROM dbo.HISTORIACLINICA) x;', N'NO PUEDE');
IF OBJECT_ID(N'dbo.INTER_RES1888') IS NOT NULL
    INSERT @pruebas (tabla, consulta, esperado) VALUES
        (N'INTER_RES1888', N'DECLARE @n int; SELECT @n = COUNT(*) FROM (SELECT TOP (0) * FROM dbo.INTER_RES1888) x;', N'NO PUEDE');

DECLARE @i int = 1, @max int = (SELECT MAX(orden) FROM @pruebas), @sql nvarchar(max), @esperado nvarchar(20);
EXECUTE AS USER = N'agenia_sync';
WHILE @i <= @max
BEGIN
    SELECT @sql = consulta, @esperado = esperado FROM @pruebas WHERE orden = @i;
    BEGIN TRY
        EXEC sys.sp_executesql @sql;
        UPDATE @pruebas SET resultado = CASE WHEN @esperado = N'PUEDE' THEN N'OK'
                                             ELSE N'⚠ REVISAR: agenia_sync lee la tabla completa' END
         WHERE orden = @i;
    END TRY
    BEGIN CATCH
        UPDATE @pruebas SET resultado = CASE WHEN @esperado = N'NO PUEDE' THEN N'OK (no tiene acceso)'
                                             ELSE N'⚠ FALLA: ' + ERROR_MESSAGE() END
         WHERE orden = @i;
    END CATCH;
    SET @i += 1;
END
REVERT;

SELECT tabla, esperado AS [agenia_sync], resultado FROM @pruebas ORDER BY CASE WHEN resultado LIKE N'OK%' THEN 1 ELSE 0 END, orden;
SELECT CASE WHEN COUNT(*) = SUM(CASE WHEN resultado LIKE N'OK%' THEN 1 ELSE 0 END)
            THEN N'✓ Listo: ' + CAST(COUNT(*) AS nvarchar(10)) + N' de ' + CAST(COUNT(*) AS nvarchar(10)) + N' pruebas en OK. Envíenle a AgenIA una captura de este resultado.'
            ELSE N'⚠ ' + CAST(COUNT(*) - SUM(CASE WHEN resultado LIKE N'OK%' THEN 1 ELSE 0 END) AS nvarchar(10))
                 + N' prueba(s) no dieron OK: envíenle a AgenIA una captura de la tabla de arriba.' END AS resumen
  FROM @pruebas;
GO
SET NOEXEC OFF;
GO

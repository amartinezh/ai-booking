-- =============================================================================
-- Esquema + datos de siembra del MOCK LOCAL del HIS del Hospital San Vicente
-- de Paul de Anserma (driver cnt-sanvicente-anserma). NO es el HIS real —
-- es una reconstrucción best-effort a partir de lo confirmado en
-- docs/drivers/cnt-sanvicente-anserma/MAPEO_HIS.md, para poder desarrollar y
-- probar el driver contra algo con la misma forma antes de tocar `PRUEBAS`
-- real o la VM. Corre dentro de la BD `PRUEBAS` de este contenedor Docker
-- (mismo nombre que la BD de pruebas real, a propósito: así
-- AGENIA_SYNC_SETUP.sql corre sin modificar ni una línea).
--
-- ⚠️ Fidelidad: CITAS_MEDICAS, CITAS_ANULADAS, MEDICOS, PACIENTES, SERVICIOS,
-- TURNOS_MEDICOS, MOTIVOANUL, CONVENIOS, EPS, TIPO_DOCUMENTO y R_PAC_EPS
-- reflejan columnas/tipos/PKs CONFIRMADOS en el mapeo. CONSULTORIOS,
-- R_ESP_SER y MUNICIPIOS son PLACEHOLDERS mínimos (su esquema real aún no se
-- descubrió — bloque 21, MAPEO_HIS.md §0) — solo alcanzan para que los GRANT
-- de AGENIA_SYNC_SETUP.sql tengan un objeto real sobre el cual aplicarse.
-- =============================================================================

IF DB_ID('PRUEBAS') IS NOT NULL
BEGIN
    ALTER DATABASE PRUEBAS SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE PRUEBAS;
END
GO
CREATE DATABASE PRUEBAS;
GO

USE PRUEBAS;
GO

-- -----------------------------------------------------------------------------
-- Catálogos base
-- -----------------------------------------------------------------------------
CREATE TABLE dbo.TIPO_DOCUMENTO (
    CD_CODI_TIDO tinyint       NOT NULL PRIMARY KEY,
    DE_DESC_TIDO varchar(60)   NOT NULL
);
GO
INSERT INTO dbo.TIPO_DOCUMENTO (CD_CODI_TIDO, DE_DESC_TIDO) VALUES
(0,'CC'),(1,'TI'),(2,'RC'),(3,'CE'),(4,'PA'),(5,'AS'),(6,'MS'),(7,'CN'),
(8,'CD'),(9,'SC'),(10,'PR'),(11,'PE'),(12,'DE'),(13,'SI'),(14,'PT');
GO

CREATE TABLE dbo.MUNICIPIOS ( -- placeholder, esquema real no confirmado
    CD_CODI_MUNI varchar(6)   NOT NULL PRIMARY KEY,
    NO_NOMB_MUNI varchar(100) NULL
);
GO
INSERT INTO dbo.MUNICIPIOS VALUES ('17042','ANSERMA'),('17001','MANIZALES');
GO

CREATE TABLE dbo.EPS (
    CD_NIT_EPS   varchar(20)  NOT NULL PRIMARY KEY,
    NO_NOMB_EPS  varchar(150) NULL,
    CD_CODI_EPS  varchar(10)  NULL,
    NU_ACTIVO_EPS tinyint     NULL DEFAULT 1
);
GO
INSERT INTO dbo.EPS (CD_NIT_EPS, NO_NOMB_EPS, CD_CODI_EPS, NU_ACTIVO_EPS) VALUES
('800088702','NUEVA EPS S.A.','NEPS',1),
('900156264','SURA EPS','SURA',1);
GO

CREATE TABLE dbo.CONVENIOS (
    NU_NUME_CONV    int          NOT NULL PRIMARY KEY,
    CD_CODI_CONV    varchar(30)  NULL,
    CD_NIT_EPS_CONV varchar(20)  NULL REFERENCES dbo.EPS(CD_NIT_EPS),
    FE_INIC_CONV    datetime     NULL,
    FE_FINA_CONV    datetime     NULL,
    NU_VIGE_CONV    tinyint      NULL DEFAULT 1
);
GO
INSERT INTO dbo.CONVENIOS (NU_NUME_CONV, CD_CODI_CONV, CD_NIT_EPS_CONV, FE_INIC_CONV, FE_FINA_CONV, NU_VIGE_CONV) VALUES
(283,'NUEVASUBSID','800088702','2009-01-01','2026-12-31',1),
(489,'PYPSUBS','800088702','2009-01-01','2026-12-31',1),
(467,'SUBS','900156264','2009-01-01','2026-12-31',1),
(473,'CONTRIBUTIVO','900156264','2009-01-01','2026-12-31',1);
GO

CREATE TABLE dbo.MOTIVOANUL (
    CD_CODI_MOTI varchar(2)   NOT NULL PRIMARY KEY,
    DE_DESC_MOTI varchar(100) NOT NULL
);
GO
INSERT INTO dbo.MOTIVOANUL (CD_CODI_MOTI, DE_DESC_MOTI) VALUES
('05','PACIENTE LLAMA A CANCELAR'),
('06','DOBLE CONSULTA'),
('01','ERROR DE CAJERO'),
('NA','NO ASISTIO'),
('WB','CANCELADO WEB'),
('09','EDAD NO CORRESPONDE'),
('10','ERROR EN CONVENIOS');
GO

-- Esquema CONFIRMADO 2026-08-28 (captura de SSMS Object Explorer, no solo
-- INFORMATION_SCHEMA): PK CD_CODI_CONS, DF en NU_ACTIVO_CONS.
CREATE TABLE dbo.CONSULTORIOS (
    CD_CODI_CONS   varchar(8)  NOT NULL PRIMARY KEY,
    DE_DESC_CONS   varchar(30) NULL,
    DE_UBIC_CONS   varchar(40) NULL,
    NU_ACTIVO_CONS bit         NOT NULL DEFAULT 1
);
GO
-- '40' confirmado como código real (médico 91-1, MAPEO_HIS.md §2.1). '51'
-- es HIPÓTESIS CORREGIDA para el médico 76: el comprobante impreso de la
-- prueba manual muestra "51-CONSULTORIO APS-01" — probablemente CD_CODI_CONS
-- del médico 76 sea '51' y "CONSULTORIO APS-01"/"APS-01" solo la etiqueta
-- (DE_DESC_CONS), no el código. Pendiente confirmar con el bloque 25 de
-- FASE0_DESCUBRIMIENTO_HIS.sql contra la BD real — ver ESTADO.md pendiente #3.
INSERT INTO dbo.CONSULTORIOS (CD_CODI_CONS, DE_DESC_CONS, DE_UBIC_CONS) VALUES
('40','CONSULTORIO 40','SEDE PRINCIPAL'),
('51','CONSULTORIO APS-01','SEDE PRINCIPAL - APS');
GO

-- -----------------------------------------------------------------------------
-- Médicos, servicios, pacientes
-- -----------------------------------------------------------------------------
CREATE TABLE dbo.MEDICOS (
    CD_CODI_MED      varchar(4)   NOT NULL PRIMARY KEY,
    NU_DOCU_MED      varchar(20)  NULL,
    NO_NOMB_MED      varchar(200) NULL,
    TX_PRNOM_MED     varchar(60)  NULL,
    TX_SGNOM_MED     varchar(60)  NULL,
    TX_PRAPEL_MED    varchar(60)  NULL,
    TX_SGAPEL_MED    varchar(60)  NULL,
    NU_TIPD_MED      varchar(2)   NULL,
    DE_CARG_MED      varchar(100) NULL,
    NU_ESTA_MED      tinyint      NULL DEFAULT 1,
    NU_MAXC_MED      int          NULL,
    DE_REGI_MED      varchar(30)  NULL,
    TX_EMAIL_MED     varchar(120) NULL,
    CD_CODI_LUA_MED  varchar(2)   NULL,
    NU_AUTMEDCTRL_MED bit         NOT NULL DEFAULT 0
);
GO
INSERT INTO dbo.MEDICOS (CD_CODI_MED, NU_DOCU_MED, NO_NOMB_MED, TX_PRNOM_MED, TX_PRAPEL_MED, DE_CARG_MED, NU_ESTA_MED, DE_REGI_MED, CD_CODI_LUA_MED) VALUES
('76','15900123','MEDICO ATENCION HTA','MEDICO','ATENCION HTA','MEDICO GENERAL',1,'RM-0076','01'),
('91-1','15900456','JUAN PEREZ GOMEZ','JUAN','PEREZ','MEDICO GENERAL',1,'RM-0091','01'),
('OD05','15900789','ANA GOMEZ RUIZ','ANA','GOMEZ','ODONTOLOGA',1,'RM-0105','01');
GO

CREATE TABLE dbo.SERVICIOS (
    CD_CODI_SER     varchar(12)  NOT NULL PRIMARY KEY,
    NO_NOMB_SER     varchar(200) NOT NULL,
    CD_CODI_GRUF_SER varchar(10) NOT NULL,
    NU_MOD_SER      tinyint      NOT NULL DEFAULT 0,
    NU_UNED_SER     int          NOT NULL DEFAULT 0,
    ID_CITA_SER     varchar(1)   NULL,
    ID_GCIT_SER     varchar(3)   NULL,
    NU_EDIN_SER     int          NULL,
    NU_EDFI_SER     int          NULL,
    TX_TICO_SER     varchar(2)   NULL,
    CD_CODI_TISE_SER varchar(2)  NULL
);
GO
INSERT INTO dbo.SERVICIOS (CD_CODI_SER, NO_NOMB_SER, CD_CODI_GRUF_SER, ID_CITA_SER, TX_TICO_SER) VALUES
('S39141-1','CONSULTA MEDICINA GENERAL','01','1','CO'),
('SCITOD','CONSULTA ODONTOLOGIA','01','1','CO'),
('I890301AG','ATENCION PYP HTA','02','1','CO');
GO

CREATE TABLE dbo.PACIENTES (
    NU_HIST_PAC       varchar(20) NOT NULL PRIMARY KEY,
    NU_DOCU_PAC       varchar(20) NOT NULL,
    NU_TIPD_PAC       tinyint     NOT NULL DEFAULT 0,
    NO_NOMB_PAC       varchar(60) NOT NULL,
    FE_NACI_PAC       datetime    NOT NULL,
    NU_SEXO_PAC       tinyint     NOT NULL DEFAULT 0,
    FE_HIST_PAC       datetime    NOT NULL,
    NU_EXTR_PAC       bit         NOT NULL DEFAULT 0,
    FE_FECH_DONA_PAC  datetime    NOT NULL DEFAULT '1900-01-01',
    FE_FECH_VOLU_PAC  datetime    NOT NULL DEFAULT '1900-01-01',
    NU_ESTA_PAC       tinyint     NULL DEFAULT 1,
    NU_ESCI_PAC       tinyint     NULL DEFAULT 0,
    NU_NIVE_PAC       tinyint     NULL DEFAULT 0
);
GO
INSERT INTO dbo.PACIENTES (NU_HIST_PAC, NU_DOCU_PAC, NU_TIPD_PAC, NO_NOMB_PAC, FE_NACI_PAC, NU_SEXO_PAC, FE_HIST_PAC) VALUES
('9696544','9696544',0,'PACIENTE DE PRUEBA UNO','1980-05-12',0,'2020-01-10'),
('1035445566','1035445566',0,'PACIENTE DE PRUEBA DOS','1995-11-03',1,'2021-03-22');
GO

CREATE TABLE dbo.R_PAC_EPS (
    NU_HIST_PAC_RPE varchar(20) NOT NULL,
    CD_NIT_EPS_RPE  varchar(20) NOT NULL,
    CD_CODI_REG_RPE varchar(2)  NULL,
    CD_CARN_RPE     varchar(30) NULL,
    NU_AFIL_RPE     varchar(30) NULL,
    NU_ESTA_RPE     tinyint     NULL DEFAULT 1,
    TX_ACTI_RPE     varchar(1)  NULL,
    CD_POL_RPE      varchar(30) NULL,
    CONSTRAINT PK_R_PAC_EPS PRIMARY KEY (NU_HIST_PAC_RPE, CD_NIT_EPS_RPE)
);
GO
INSERT INTO dbo.R_PAC_EPS (NU_HIST_PAC_RPE, CD_NIT_EPS_RPE, CD_CODI_REG_RPE, NU_ESTA_RPE) VALUES
('9696544','800088702','S',1),
('1035445566','900156264','C',1);
GO

CREATE TABLE dbo.R_ESP_SER ( -- placeholder, esquema real no confirmado (bloque 21)
    CD_CODI_SER_RES varchar(12) NOT NULL,
    CD_CODI_ESP_RES varchar(3)  NOT NULL,
    CONSTRAINT PK_R_ESP_SER PRIMARY KEY (CD_CODI_SER_RES, CD_CODI_ESP_RES)
);
GO
INSERT INTO dbo.R_ESP_SER VALUES ('S39141-1','000'),('SCITOD','461'),('I890301AG','000');
GO

-- -----------------------------------------------------------------------------
-- Turnos y citas
-- -----------------------------------------------------------------------------
CREATE TABLE dbo.TURNOS_MEDICOS (
    NU_NUME_TUME    int      IDENTITY(1,1) PRIMARY KEY,
    CD_MED_TUME     varchar(4)  NOT NULL REFERENCES dbo.MEDICOS(CD_CODI_MED),
    FE_FECH_TUME    datetime NOT NULL,
    FE_HOIN_TUME    datetime NOT NULL,
    FE_HOFI_TUME    datetime NOT NULL,
    ID_DISP_TUME    varchar(1)  NULL DEFAULT '1',
    CD_CODI_CONS_TUME varchar(8) NULL,
    NU_TIPO_TUME    tinyint  NULL DEFAULT 0,
    CD_CODI_ESP_TUME varchar(3) NULL
);
GO
INSERT INTO dbo.TURNOS_MEDICOS (CD_MED_TUME, FE_FECH_TUME, FE_HOIN_TUME, FE_HOFI_TUME, ID_DISP_TUME, CD_CODI_CONS_TUME, NU_TIPO_TUME) VALUES
('76', DATEADD(day,3,CAST(GETDATE() AS date)), '1900-01-01 07:00','1900-01-01 12:00','1','51',0),
('91-1', DATEADD(day,3,CAST(GETDATE() AS date)), '1900-01-01 07:00','1900-01-01 12:00','1','40',0),
('OD05', DATEADD(day,4,CAST(GETDATE() AS date)), '1900-01-01 14:00','1900-01-01 18:00','1','40',0);
GO

CREATE TABLE dbo.CITAS_MEDICAS (
    CD_CODI_MED_CIT   varchar(4)   NOT NULL,
    FE_HORA_CIT       varchar(18)  NOT NULL,
    NU_ESTA_CIT       tinyint      NOT NULL,
    CD_CODI_SER_CIT   varchar(12)  NULL,
    NU_HIST_PAC_CIT   varchar(20)  NULL,
    NU_DURA_CIT       int          NULL,
    FE_ELAB_CIT       datetime     NULL,
    FE_FECH_CIT       datetime     NULL,
    NU_DIA_CIT        tinyint      NULL,
    NU_NUME_MOVI_CIT  int          NULL,
    NU_PRIM_CIT       tinyint      NULL,
    NU_NUME_CONE_CIT  int          NULL,
    NU_CONE_CALL_CIT  int          NULL,
    CD_CODI_ESP_CIT   varchar(3)   NULL,
    CD_CODI_CONS_CIT  varchar(8)   NULL,
    NU_NUME_CONV_CIT  int          NULL,
    NU_TIPO_CIT       tinyint      NULL,
    DE_DESC_CIT       varchar(600) NULL,
    NU_AUTO_AGRU_CIT  int          NULL,
    TX_PEND_AGRU_CIT  varchar(1)   NULL,
    CD_CODI_EST_CIT   varchar(3)   NULL,
    CD_CODI_CAMP_CIT  varchar(3)   NULL,
    CD_CODI_CECO_CIT  varchar(11)  NULL,
    CD_CODI_LUAT_CIT  varchar(2)   NULL,
    FE_SOLI_CIT       datetime     NULL,
    NU_CODIGO_HSWE_CIT tinyint     NULL,
    NU_MOD_CIT        tinyint      NULL,
    CONSTRAINT PK_CITAS_MEDICAS PRIMARY KEY (CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT)
);
GO

-- CITAS_ANULADAS: SIN PK/FK/índices únicos a propósito (así es en el HIS real
-- — log de auditoría puro, ver MAPEO_HIS.md §2.5).
CREATE TABLE dbo.CITAS_ANULADAS (
    CD_CODI_MED_CIAN   varchar(4)   NULL,
    FE_HORA_CIAN       varchar(18)  NULL,
    NU_ESTA_CIAN       tinyint      NULL,
    CD_CODI_SER_CIAN   varchar(12)  NULL,
    NU_HIST_PAC_CIAN   varchar(20)  NULL,
    NU_DURA_CIAN       int          NULL,
    FE_ELAB_CIAN       datetime     NULL,
    FE_FECH_CIAN       datetime     NULL,
    NU_DIA_CIAN        tinyint      NULL,
    NU_NUME_MOVI_CIAN  int          NULL,
    NU_PRIM_CIAN       tinyint      NULL,
    NU_NUME_CONE_CIAN  int          NULL,
    NU_CONE_CALL_CIAN  int          NULL,
    CD_CODI_ESP_CIAN   varchar(3)   NULL,
    CD_CODI_CONS_CIAN  varchar(8)   NULL,
    NU_NUME_CONV_CIAN  int          NULL,
    NU_TIPO_CIAN       tinyint      NULL,
    DE_DESC_CIAN       varchar(600) NULL,
    CD_CODI_CECO_CIAN  varchar(11)  NULL,
    CD_CODI_LUAT_CIAN  varchar(2)   NULL,
    FE_SOLI_CIAN       datetime     NULL,
    CD_CODI_MOTI_CIAN  varchar(2)   NULL,
    TX_OBSE_CIAN       varchar(255) NULL,
    NU_CONE_ANUL_CIAN  int          NULL
);
GO

-- Un par de citas vigentes de muestra, coherentes con los turnos de arriba.
INSERT INTO dbo.CITAS_MEDICAS (CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT, NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT, NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_NUME_CONE_CIT, NU_CONE_CALL_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT, NU_NUME_CONV_CIT, NU_TIPO_CIT, DE_DESC_CIT, FE_SOLI_CIT)
SELECT '76', FORMAT(DATEADD(day,3,GETDATE()),'yyyy/MM/dd')+' 07:00', 0, 'S39141-1', '9696544', 20, GETDATE(), DATEADD(day,3,CAST(GETDATE() AS date)), 0, 0, 0, 1286024, 0, '000', '51', 283, 0, '', GETDATE();
GO

PRINT 'Esquema + siembra de PRUEBAS (mock local) completos.';
GO

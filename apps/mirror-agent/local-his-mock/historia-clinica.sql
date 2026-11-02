-- =============================================================================
-- Historia clínica del MOCK LOCAL del HIS, para el resumen de la atención
-- (docs/PLAN_RESUMEN_ATENCION.md). La corre setup.ts DESPUÉS de
-- schema-and-seed.sql y de AGENIA_SYNC_SETUP.sql, en la misma BD `PRUEBAS`.
--
-- ⚠️ Fidelidad: columnas y tipos de las tablas reales, vistos con las consultas
-- de solo lectura de historia clínica (rondas 1 a 6,
-- docs/drivers/cnt-sanvicente-anserma/sql/HISTORIA_CLINICA_*). Solo están las
-- columnas que usa el resumen y algunas vecinas: las tablas reales tienen más.
-- esquema-real.tsv no las cubre (es el volcado de las tablas de citas) y no se
-- toca, así que scripts/verificar-esquema-mock.mjs las lista como «sin
-- verificar». Si una columna de aquí se aparta del HIS, que sea a propósito y
-- esté escrito.
--
-- Permisos: AGENIA_SYNC_SETUP.sql deja a agenia_sync SIN acceso a la historia,
-- a propósito. Después de este archivo, setup.ts le da, columna por columna,
-- exactamente lo que pide el bloque P-7 de
-- HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql (el texto que se le pedirá a TI):
-- si el agente lee una columna que P-7 no pide, aquí falla igual que fallaría
-- en el hospital.
--
-- Las fechas son la hora de Colombia (el HIS guarda la hora local; el
-- contenedor corre en UTC). Todos los pacientes llevan «PRUEBA» en el primer
-- apellido.
-- =============================================================================

USE PRUEBAS;
GO

-- -----------------------------------------------------------------------------
-- Lo que falta en las tablas de citas
-- -----------------------------------------------------------------------------
-- Tipo de usuario del convenio (encabezado de los documentos). Real (ronda 5);
-- CONVENIOS no está en esquema-real.tsv a propósito (85 columnas de facturación).
ALTER TABLE dbo.CONVENIOS ADD ID_CODI_TIUS_CONV varchar(2) NULL;
GO
UPDATE dbo.CONVENIOS SET ID_CODI_TIUS_CONV = CASE WHEN CD_CODI_CONV = 'CONTRIBUTIVO' THEN '1' ELSE '2' END;
INSERT INTO dbo.SERVICIOS (CD_CODI_SER, NO_NOMB_SER, CD_CODI_GRUF_SER, ID_CITA_SER, TX_TICO_SER) VALUES
('S39141','CONSULTA DE PRIMERA VEZ POR MEDICINA GENERAL','01','1','CO'),
('S39145','CONSULTA DE URGENCIAS','01','0','CO'),
('S19304','CUADRO HEMATICO O HEMOGRAMA HEMATOCRITO Y LEUCOGRAMA','03','0','LA'),
('S19775','PARCIAL DE ORINA INCLUIDO SEDIMENTO','03','0','LA');
INSERT INTO dbo.ESPECIALIDADES (CD_CODI_ESP, NO_NOMB_ESP, TX_ACTI_ESP) VALUES ('015','MEDICINA INTERNA','S');
GO

-- -----------------------------------------------------------------------------
-- Catálogos de la historia
-- -----------------------------------------------------------------------------
CREATE TABLE dbo.TIPOUSUARIO (ID_CODI_TIUS varchar(2), DE_DESC_TIUS varchar(100), CD_GRUP_TIUS varchar(2), NU_TIPO_RIPS_TIUS int);
CREATE TABLE dbo.DIAGNOSTICO (CD_CODI_DIAG varchar(4) NOT NULL PRIMARY KEY, DE_DESC_DIAG varchar(255));
CREATE TABLE dbo.TIPODIAGNOSTICO (ID_CODI_TIDI varchar(1) NOT NULL PRIMARY KEY, DE_DESC_TIDI varchar(60));
CREATE TABLE dbo.ARTICULO (CD_CODI_ARTI varchar(16) NOT NULL PRIMARY KEY, NO_NOMB_ARTI varchar(200), NU_CODCUM_ARTI varchar(18),
  TX_INVIMA_ARTI varchar(50), NU_AUTO_UNVE_ARTI int);
-- Unidades de la frecuencia del medicamento (NU_TIPO_CONF_HIS = 37).
CREATE TABLE dbo.PAC_CONFIG_HIS (TX_CODI_CONF_HIS varchar(10), TX_DESC_CONF_HIS varchar(100), NU_TIPO_CONF_HIS int);
-- Encabezado del hospital (P-7 lo pide para los documentos; el agente no lo lee hoy).
CREATE TABLE dbo.ENTIDAD (CD_NIT_ENTI varchar(11), NO_NOMB_ENTI varchar(100), DE_DIRE_ENTI varchar(80), DE_TELE_ENTI varchar(30),
  CD_CODI_DPTO_ENTI varchar(2), CD_CODI_MUNI_ENTI varchar(3), IM_LOGO_ENTI image);
GO

-- Plantillas: plantilla → especialidad/tipo de atención → campos (concepto + grupo).
CREATE TABLE dbo.PLANTILLA_HIST (NU_TIAT_PLHI tinyint, NU_NUME_PLHI int NOT NULL PRIMARY KEY, NU_HEIGHT_PLHI int, NU_ESTA_PLHI tinyint,
  TX_CODI_PLHI varchar(10), TX_TIPO_PLHI varchar(1), TX_DESC_PLHI varchar(100), NU_COEX_PLHI tinyint, TX_RESOL_PLHI varchar(9),
  NU_WIDTH_PLHI int, NU_VACUNA_PLHI bit);
CREATE TABLE dbo.R_PLAN_ESP_TIAT (NU_NUME_RPET int NOT NULL PRIMARY KEY, NU_NUME_PLHI_RPET int, CD_CODI_ESP_RPET varchar(3),
  NU_TIAT_RPET tinyint, NU_ESTA_RPET tinyint);
CREATE TABLE dbo.CONCEPTO_HIST (NU_NUME_COHI int NOT NULL PRIMARY KEY, CD_CODI_COHI varchar(200));
CREATE TABLE dbo.GRUPO_HIST (NU_NUME_GRHI int NOT NULL PRIMARY KEY, CD_CODI_GRHI varchar(200));
CREATE TABLE dbo.R_PLAN_CONC (NU_NUME_PLHI_RPC int, NU_INDI_RPC int, NU_NUME_COHI_RPC int, NU_NUME_GRHI_RPC int);
CREATE TABLE dbo.DATOS_PLANTILLA (NU_AUTO_DAPL int NOT NULL PRIMARY KEY, NU_NUME_RPET_DAPL int);
CREATE TABLE dbo.DATOS_PLANTILLA_TEXT (NU_AUTO_DAPL_DPTE int, NU_INDI_DPTE int, TX_DESC_DPTE varchar(255));
CREATE TABLE dbo.DATOS_PLANTILLA_MEMO (NU_AUTO_DAPL_DPME int, NU_INDI_DPME int, TX_DESC_DPME text);
CREATE TABLE dbo.DATOS_PLANTILLA_NUME (NU_AUTO_DAPL_DPNU int, NU_INDI_DPNU int, NU_DESC_DPNU float);
CREATE TABLE dbo.DATOS_PLANTILLA_DATE (NU_AUTO_DAPL_DPDA int, NU_INDI_DPDA int, FE_DESC_DPDA datetime);
GO

-- -----------------------------------------------------------------------------
-- La historia y lo que se ordena en ella
-- -----------------------------------------------------------------------------
-- TX_TIPO_HICL 'CON' = consulta; NU_NUME_REG_HICL <> 0 = viene de un ingreso (urgencias).
CREATE TABLE dbo.HISTORIACLINICA (NU_NUME_LABO_HICL int NOT NULL, NU_NUME_HICL int IDENTITY(170000, 1) NOT NULL PRIMARY KEY,
  FE_FECH_HICL datetime NOT NULL, CD_MED_ASIG_HICL varchar(4), CD_MED_REAL_HICL varchar(4), NU_ESTA_HICL tinyint NOT NULL,
  NU_AUTO_DAPL_HICL int, TX_TIPO_HICL varchar(3) NOT NULL, NU_NUME_PADR_HICL int, NU_HIST_PAC_HICL varchar(20),
  NU_NUME_REG_HICL int, NU_NUME_CONE_HICL int, NU_CLAVEHIST_HICL int, NU_CLAVEEVOL_HICL int, TX_ASISTE_HICL varchar(2),
  TX_CODSER_HICL varchar(12));
CREATE INDEX IX_HISTORIACLINICA_FECHA ON dbo.HISTORIACLINICA (FE_FECH_HICL);
CREATE TABLE dbo.LABORATORIO (NU_NUME_LABO int NOT NULL PRIMARY KEY, CD_CODI_ESP_LABO varchar(3), CD_CODI_SER_LABO varchar(12), NU_EDAD_LABO tinyint);
CREATE TABLE dbo.R_LABO_DIAG (NU_NUME_LABO_RLAD int, CD_CODI_DIAG_RLAD varchar(4), ID_TIPO_DIAG_RLAD varchar(1), ID_TIPO_RLAD varchar(1));
CREATE TABLE dbo.HIST_TEMLABO (NU_NUME_HICL_HTLA int, NU_DIIN_HTLA smallint, ID_CODI_TIDI_HTLA varchar(1), NU_NUME_CONV_HTLA int,
  ID_CODI_CAEX_HTLA varchar(2), NU_AUTO_HTLA int IDENTITY(1, 1));
-- NU_TIPO_HORD: 1-4 exámenes y procedimientos, 5 fórmula. TX_TIAP_HORD: AI = del hospital, AE = externa.
CREATE TABLE dbo.HIST_ORDEN (NU_NUME_HICL_HORD int, NU_AUTO_HORD int IDENTITY(123500, 1) NOT NULL PRIMARY KEY, NU_TIPO_HORD tinyint,
  ME_MATESP_HORD text, ME_OBSERV_HORD text, TX_TIAP_HORD varchar(2), NU_CLAVE_HICL_HORD int, NU_CLAVE_HEVO_HORD int,
  NU_CLAVE_HORD int, FE_FECH_HORD datetime, TX_VIGE_HORD varchar(50), FE_POSFECHA datetime, NU_ORDEN_FECHAPOS int);
-- NU_ESTA_HMED 0 = anulado. TX_INDDOS_HMED: la indicación tal como la escribió el médico.
CREATE TABLE dbo.HIST_MEDI (NU_AUTO_HORD_HMED int, NU_NUME_HMED int, CD_CODI_ARTI_HMED varchar(16), NO_NOMB_ARTI_HMED varchar(60),
  DE_UNME_HMED varchar(30), DE_CTRA_HMED varchar(30), DE_DOSIS_HMED text, NU_CANT_HMED int, NU_ESTA_HMED tinyint,
  NU_NUME_FORM_HMED int, NU_AUTO_UNVE_HMED int, TX_FOFA_HMED varchar(70), TX_VIAD_HMED varchar(50), TX_DURA_HMED varchar(50),
  TX_SISPRO_HMED varchar(50), NU_CTFREC_HMED int, TX_CDFREC_HMED varchar(10), TX_INDESP_HMED varchar(10), TX_INDDOS_HMED varchar(1000));
CREATE TABLE dbo.HIST_PROC (NU_AUTO_HORD_HPRO int, NU_NUME_HPRO int, CD_CODI_SER_HPRO varchar(12), NU_CANT_HPRO float,
  DE_INDI_HPRO text, NU_ESTA_HPRO tinyint, NU_NUME_HICL_HPRO int, TX_SISPRO_HPRO varchar(50));
CREATE TABLE dbo.HIST_REMI (DE_DESC_HREM text, NU_NUME_HREM int IDENTITY(263800, 1), NU_NUME_HICL_HREM int, TX_REHA_HREM varchar(100),
  TX_FICHA_HREM varchar(18), TX_NOMREG_HREM varchar(40), TX_SISBEN_HREM varchar(2), TX_TIPTRA_HREM varchar(4), NU_INST_HREM tinyint,
  TX_TIPREG_HREM varchar(2), TX_ADMIN_HREM varchar(60), CD_CODI_REG_HREM varchar(2), TX_DATACO_HREM varchar(255),
  TX_REAC_HREM varchar(255), DE_REMI_HREM varchar(255), TX_SERV_HREM varchar(255), TX_PRIO_HREM varchar(1), TX_CASO_HREM text,
  NU_SRVREM_HREM tinyint, NU_MTVREM_HREM int, TX_SRVREM_HREM varchar(20), FE_FECHA_HREM datetime, TX_MOTATE_HREM varchar(4),
  TX_DESPER_HREM varchar(4), TX_MODTEC_HREM varchar(4), TX_GRUSER_HREM varchar(4), TX_CODSER_HREM varchar(10),
  TX_CUPSPR_HREM varchar(10), NU_CANTPR_HREM int);
CREATE TABLE dbo.HIST_ORTIAT (NU_NUME_HICL_HOTA int, NU_NUME_HOTA int IDENTITY(1, 1), NU_VIA_HOTA tinyint, NU_TIPO_HOTA tinyint,
  ME_OBSER_HOTA text, NU_HICL_ORD_HOTA int, NU_ESTADO_HOTA tinyint, CD_CODI_ESP_HOTA varchar(3));
CREATE TABLE dbo.HIST_INCA (DE_DESC_HINC text, NU_NUME_HINC int IDENTITY(1, 1), CD_CODI_CAEX_HINC varchar(2), NU_NUME_HICL_HINC int,
  NU_DIAS_HINC int, FE_INIC_HINC datetime, NU_PROR_HINC tinyint, TX_TIPO_HINC varchar(6), TX_MODA_SALU_HINC varchar(6),
  TX_ORIG_INCA_HINC varchar(6), TX_INCA_RETR_HINC varchar(6), TX_GRUP_SERV_HINC varchar(6));
CREATE TABLE dbo.HIST_INDI (DE_DESC_HIND text, NU_NUME_HIND int IDENTITY(23900, 1), NU_NUME_HICL_HIND int);
GO

-- -----------------------------------------------------------------------------
-- Siembra de catálogos
-- -----------------------------------------------------------------------------
SET NOCOUNT ON;
INSERT dbo.TIPOUSUARIO VALUES ('1', 'CONTRIBUTIVO', '0', 1), ('2', 'SUBSIDIADO', '1', 1);
INSERT dbo.DIAGNOSTICO VALUES
  ('I10X', 'HIPERTENSION ESENCIAL (PRIMARIA)'),
  ('E790', 'HIPERURICEMIA SIN SIGNOS DE ARTRITIS INFLAMATORIA Y ENFERMEDAD TOFACEA'),
  ('J00X', 'RINOFARINGITIS AGUDA (RESFRIADO COMUN)'),
  ('R104', 'OTROS DOLORES ABDOMINALES Y LOS NO ESPECIFICADOS'),
  ('F412', 'TRASTORNO MIXTO DE ANSIEDAD Y DEPRESION');
INSERT dbo.TIPODIAGNOSTICO VALUES ('1', 'IMPRESION DIAGNOSTICA'), ('2', 'CONFIRMADO NUEVO'), ('3', 'CONFIRMADO REPETIDO');
INSERT dbo.ARTICULO VALUES
  ('A001', 'LOSARTAN 50 MG TABLETA', '19937128-01', 'M-002520', 10),
  ('A002', 'ACETAMINOFEN 500 MG TABLETA', '19902461-03', 'M-010101', 10),
  ('A003', 'HIDROCLOROTIAZIDA 25 MG TABLETA', NULL, NULL, NULL);
INSERT dbo.PAC_CONFIG_HIS VALUES ('1', 'Minutos', 37), ('2', 'Horas', 37), ('3', 'Día', 37);
INSERT dbo.ENTIDAD VALUES ('800000000', 'HOSPITAL DE PRUEBA', 'CALLE 1 # 1-1', '6060000000', '17', '042', NULL);

-- 870 CONSULTA EXTERNA y 844 CONTROL CRÓNICOS, con los campos que sube el agente
-- (CAMPOS_PLANTILLA_POR_DEFECTO de @agenia/shared) y otros que NO debe subir
-- («Enfermedad actual», «Peso»).
INSERT dbo.PLANTILLA_HIST (NU_TIAT_PLHI, NU_NUME_PLHI, TX_CODI_PLHI, TX_TIPO_PLHI, TX_DESC_PLHI, TX_RESOL_PLHI, NU_ESTA_PLHI) VALUES
  (1, 870, 'HIS070', 'C', 'CONSULTA EXTERNA', '', 1),
  (1, 844, 'HIS044', 'C', 'CONTROL CRONICOS', '', 1);
INSERT dbo.R_PLAN_ESP_TIAT VALUES (1, 870, '000', 1, 1), (2, 844, '000', 1, 1);
INSERT dbo.CONCEPTO_HIST VALUES (1, 'MC:'), (2, 'Anotaciones'), (3, 'Acerca de:'), (4, 'Conducta'), (5, 'Proximo control*'),
  (6, 'Enfermedad actual'), (7, 'Peso');
INSERT dbo.GRUPO_HIST VALUES (1, 'MOTIVO DE CONSULTA'), (2, 'CONDUCTA'), (3, 'EDUCACION.'), (4, 'ENFERMEDAD ACTUAL'), (5, 'EXAMEN FISICO');
INSERT dbo.R_PLAN_CONC VALUES
  (870, 1, 1, 1), (870, 2, 6, 4), (870, 3, 7, 5), (870, 4, 2, 2), (870, 5, 3, 3),
  (844, 1, 1, 1), (844, 2, 4, 2), (844, 3, 5, 2);

-- Pacientes de prueba: adulto con celular y correo, menor con acudiente y
-- crónico con un correo de relleno del hospital (no se le debe enviar correo).
INSERT INTO dbo.PACIENTES (NU_HIST_PAC, NU_DOCU_PAC, NU_TIPD_PAC, NO_NOMB_PAC, NO_SGNO_PAC, DE_PRAP_PAC, DE_SGAP_PAC,
                           FE_NACI_PAC, NU_SEXO_PAC, FE_HIST_PAC, DE_TELE_PAC, DE_EMAIL_PAC, DE_TELE_ACOM_PAC, TX_EMAIL_ACOM_PAC) VALUES
('900000001', '900000001', 0, 'ADULTO', NULL, 'PRUEBA UNO', 'SISTEMAS', '1980-03-22', 1, '2020-01-10', '3001110001', 'prueba.uno@hospital.test', NULL, NULL),
('900000002', '900000002', 1, 'MENOR', NULL, 'PRUEBA DOS', 'SISTEMAS', '2016-01-01', 0, '2020-01-10', NULL, NULL, '3001110002', 'acudiente.prueba@hospital.test'),
('900000003', '900000003', 0, 'CRONICO', NULL, 'PRUEBA TRES', 'SISTEMAS', '1955-07-07', 1, '2020-01-10', '3001110003', 'pacienteshospital@gmail.com', NULL, NULL);
GO

-- -----------------------------------------------------------------------------
-- Seis historias de hoy. El agente debe tomar E1, E2 y E3; nunca E4 (viene de
-- urgencias), E5 (no es consulta) ni E6 mientras no se cumpla la calma.
-- -----------------------------------------------------------------------------
SET NOCOUNT ON;
DECLARE @ahora datetime = DATEADD(hour, -5, SYSUTCDATETIME());  -- hora de Colombia
DECLARE @h int, @o int, @serie int;

-- E1 · adulto, medicina general (870): todo lo que puede llevar un resumen.
INSERT dbo.LABORATORIO VALUES (600001, '000', 'S39141', 46);
INSERT dbo.DATOS_PLANTILLA VALUES (950001, 1);
INSERT dbo.HISTORIACLINICA (NU_NUME_LABO_HICL, FE_FECH_HICL, CD_MED_ASIG_HICL, CD_MED_REAL_HICL, NU_ESTA_HICL, NU_AUTO_DAPL_HICL,
                            TX_TIPO_HICL, NU_HIST_PAC_HICL, NU_NUME_REG_HICL, TX_CODSER_HICL)
VALUES (600001, DATEADD(minute, -90, @ahora), '76', '76', 1, 950001, 'CON', '900000001', 0, 'S39141');
SET @h = SCOPE_IDENTITY();
INSERT dbo.R_LABO_DIAG VALUES (600001, 'E790', '1', '1'), (600001, 'I10X', '3', '2');
INSERT dbo.HIST_TEMLABO (NU_NUME_HICL_HTLA, NU_NUME_CONV_HTLA, ID_CODI_CAEX_HTLA) VALUES (@h, 283, '13');
INSERT dbo.DATOS_PLANTILLA_TEXT VALUES (950001, 1, 'CONTROL DE PRESION Y RESULTADOS');
INSERT dbo.DATOS_PLANTILLA_MEMO VALUES (950001, 2, 'TEXTO CLINICO QUE NO DEBE SUBIR AL RESUMEN');
INSERT dbo.DATOS_PLANTILLA_NUME VALUES (950001, 3, 72.5);
INSERT dbo.DATOS_PLANTILLA_MEMO VALUES (950001, 4, 'SE INDICA FORMULA MEDICA Y ACIDO URICO EN SANGRE. SS VALORACION POR MEDICINA INTERNA.');
INSERT dbo.DATOS_PLANTILLA_TEXT VALUES (950001, 5, 'DIETA BAJA EN SAL');
-- Fórmula del hospital: uno con la indicación del médico, uno solo con la
-- frecuencia del HIS (la que el driver ya manda como «cada 8 Horas») y uno anulado.
INSERT dbo.HIST_ORDEN (NU_NUME_HICL_HORD, NU_TIPO_HORD, TX_TIAP_HORD, FE_FECH_HORD, TX_VIGE_HORD, NU_CLAVE_HORD)
VALUES (@h, 5, 'AI', DATEADD(minute, -88, @ahora), 'Vigente por 30 Dias', 77001);
SET @serie = SCOPE_IDENTITY();
INSERT dbo.HIST_MEDI (NU_AUTO_HORD_HMED, NU_NUME_HMED, CD_CODI_ARTI_HMED, NO_NOMB_ARTI_HMED, DE_UNME_HMED, DE_CTRA_HMED, DE_DOSIS_HMED,
                      NU_CANT_HMED, NU_ESTA_HMED, NU_AUTO_UNVE_HMED, TX_FOFA_HMED, TX_VIAD_HMED, TX_DURA_HMED, NU_CTFREC_HMED,
                      TX_CDFREC_HMED, TX_INDDOS_HMED) VALUES
  (@serie, 1, 'A001', 'LOSARTAN 50 MG TABLETA', 'TABLETA', '50 mg', '1 mg cada 12 Horas', 60, 1, 10, 'TABLETA', 'ORAL', '30', 12, '2', '1 TAB VO CADA 12 HORAS'),
  (@serie, 2, 'A002', 'ACETAMINOFEN 500 MG TABLETA', 'TABLETA', '500 mg', '1 mg cada 8 Horas', 20, 1, 10, 'TABLETA', 'ORAL', '5', 8, '2', NULL),
  (@serie, 3, 'A003', 'HIDROCLOROTIAZIDA 25 MG TABLETA', 'TABLETA', '25 mg', '1 mg cada 24 Horas', 30, 0, NULL, 'TABLETA', 'ORAL', '30', 24, '2', 'ANULADO: NO DEBE SALIR');
-- La misma fórmula posfechada (segundo mes).
INSERT dbo.HIST_ORDEN (NU_NUME_HICL_HORD, NU_TIPO_HORD, TX_TIAP_HORD, FE_FECH_HORD, TX_VIGE_HORD, FE_POSFECHA, NU_ORDEN_FECHAPOS, NU_CLAVE_HORD)
VALUES (@h, 5, 'AI', DATEADD(minute, -88, @ahora), 'Vigente por 30 Dias', DATEADD(day, 30, @ahora), @serie, 77002);
SET @o = SCOPE_IDENTITY();
INSERT dbo.HIST_MEDI (NU_AUTO_HORD_HMED, NU_NUME_HMED, CD_CODI_ARTI_HMED, NO_NOMB_ARTI_HMED, DE_UNME_HMED, DE_CTRA_HMED, NU_CANT_HMED,
                      NU_ESTA_HMED, NU_AUTO_UNVE_HMED, TX_FOFA_HMED, TX_VIAD_HMED, TX_DURA_HMED, NU_CTFREC_HMED, TX_CDFREC_HMED, TX_INDDOS_HMED)
VALUES (@o, 1, 'A001', 'LOSARTAN 50 MG TABLETA', 'TABLETA', '50 mg', 60, 1, 10, 'TABLETA', 'ORAL', '30', 12, '2', '1 TAB VO CADA 12 HORAS');
-- Exámenes de laboratorio.
INSERT dbo.HIST_ORDEN (NU_NUME_HICL_HORD, NU_TIPO_HORD, FE_FECH_HORD, NU_CLAVE_HORD) VALUES (@h, 2, DATEADD(minute, -87, @ahora), 77003);
SET @o = SCOPE_IDENTITY();
INSERT dbo.HIST_PROC (NU_AUTO_HORD_HPRO, NU_NUME_HPRO, CD_CODI_SER_HPRO, NU_CANT_HPRO, DE_INDI_HPRO, NU_ESTA_HPRO, NU_NUME_HICL_HPRO) VALUES
  (@o, 1, 'S19304', 1, NULL, 1, @h),
  (@o, 2, 'S19775', 1, 'EN AYUNAS', 1, @h);
INSERT dbo.HIST_REMI (DE_DESC_HREM, NU_NUME_HICL_HREM, DE_REMI_HREM, TX_SERV_HREM, TX_PRIO_HREM, TX_CASO_HREM, NU_MTVREM_HREM,
                      FE_FECHA_HREM, TX_CUPSPR_HREM, NU_CANTPR_HREM, NU_INST_HREM)
VALUES ('SS VALORACION POR MEDICINA INTERNA', @h, 'HOSPITAL DE PRUEBA', 'MEDICINA INTERNA', '3',
        'Caso clínico de prueba: el agente solo mide su largo, nunca lo sube.', 2, DATEADD(minute, -86, @ahora), '890266', 1, 1);
INSERT dbo.HIST_INCA (DE_DESC_HINC, NU_NUME_HICL_HINC, NU_DIAS_HINC, FE_INIC_HINC, NU_PROR_HINC, TX_TIPO_HINC, TX_ORIG_INCA_HINC)
VALUES ('REPOSO', @h, 3, CAST(@ahora AS date), 0, '01', '1');
INSERT dbo.HIST_ORTIAT (NU_NUME_HICL_HOTA, NU_VIA_HOTA, NU_TIPO_HOTA, ME_OBSER_HOTA, NU_ESTADO_HOTA, CD_CODI_ESP_HOTA)
VALUES (@h, 1, 1, 'VALORACION POR CIFRAS TENSIONALES ALTAS', 0, '015');
INSERT dbo.HIST_INDI (DE_DESC_HIND, NU_NUME_HICL_HIND) VALUES ('TOMAR ABUNDANTE LIQUIDO Y CONSULTAR POR SIGNOS DE ALARMA', @h);

-- E2 · menor de edad (los avisos van al acudiente), medicina general (870).
INSERT dbo.LABORATORIO VALUES (600002, '000', 'S39141', 10);
INSERT dbo.DATOS_PLANTILLA VALUES (950002, 1);
INSERT dbo.HISTORIACLINICA (NU_NUME_LABO_HICL, FE_FECH_HICL, CD_MED_ASIG_HICL, CD_MED_REAL_HICL, NU_ESTA_HICL, NU_AUTO_DAPL_HICL,
                            TX_TIPO_HICL, NU_HIST_PAC_HICL, NU_NUME_REG_HICL, TX_CODSER_HICL)
VALUES (600002, DATEADD(minute, -80, @ahora), '91-1', '91-1', 1, 950002, 'CON', '900000002', 0, 'S39141');
SET @h = SCOPE_IDENTITY();
INSERT dbo.R_LABO_DIAG VALUES (600002, 'J00X', '1', '1');
INSERT dbo.HIST_TEMLABO (NU_NUME_HICL_HTLA, NU_NUME_CONV_HTLA) VALUES (@h, 467);
INSERT dbo.DATOS_PLANTILLA_TEXT VALUES (950002, 1, 'TOS Y FIEBRE DE DOS DIAS');
INSERT dbo.HIST_ORDEN (NU_NUME_HICL_HORD, NU_TIPO_HORD, TX_TIAP_HORD, FE_FECH_HORD, TX_VIGE_HORD, NU_CLAVE_HORD)
VALUES (@h, 5, 'AI', DATEADD(minute, -78, @ahora), 'Vigente por 30 Dias', 77010);
SET @o = SCOPE_IDENTITY();
INSERT dbo.HIST_MEDI (NU_AUTO_HORD_HMED, NU_NUME_HMED, CD_CODI_ARTI_HMED, NO_NOMB_ARTI_HMED, DE_UNME_HMED, DE_CTRA_HMED, NU_CANT_HMED,
                      NU_ESTA_HMED, NU_AUTO_UNVE_HMED, TX_FOFA_HMED, TX_VIAD_HMED, TX_DURA_HMED, NU_CTFREC_HMED, TX_CDFREC_HMED, TX_INDDOS_HMED)
VALUES (@o, 1, 'A002', 'ACETAMINOFEN 500 MG TABLETA', 'TABLETA', '500 mg', 10, 1, 10, 'TABLETA', 'ORAL', '3', 8, '2', 'MEDIA TABLETA CADA 8 HORAS SI HAY FIEBRE');
INSERT dbo.HIST_INDI (DE_DESC_HIND, NU_NUME_HICL_HIND) VALUES ('LAVADOS NASALES Y LIQUIDOS', @h);

-- E3 · control de crónicos (844), con un diagnóstico de los que excluye el envío (F).
INSERT dbo.LABORATORIO VALUES (600003, '000', 'S39141', 71);
INSERT dbo.DATOS_PLANTILLA VALUES (950003, 2);
INSERT dbo.HISTORIACLINICA (NU_NUME_LABO_HICL, FE_FECH_HICL, CD_MED_ASIG_HICL, CD_MED_REAL_HICL, NU_ESTA_HICL, NU_AUTO_DAPL_HICL,
                            TX_TIPO_HICL, NU_HIST_PAC_HICL, NU_NUME_REG_HICL, TX_CODSER_HICL)
VALUES (600003, DATEADD(minute, -70, @ahora), '76', '76', 1, 950003, 'CON', '900000003', 0, 'S39141');
SET @h = SCOPE_IDENTITY();
INSERT dbo.R_LABO_DIAG VALUES (600003, 'I10X', '3', '1'), (600003, 'F412', '1', '2');
INSERT dbo.HIST_TEMLABO (NU_NUME_HICL_HTLA, NU_NUME_CONV_HTLA) VALUES (@h, 489);
INSERT dbo.DATOS_PLANTILLA_MEMO VALUES (950003, 2, 'CONTINUAR TRATAMIENTO. CONTROL EN TRES MESES.');
INSERT dbo.DATOS_PLANTILLA_DATE VALUES (950003, 3, DATEADD(day, 90, CAST(@ahora AS date)));

-- E4 · consulta que viene de urgencias (NU_NUME_REG_HICL <> 0): no es del piloto.
INSERT dbo.LABORATORIO VALUES (600004, '000', 'S39145', 46);
INSERT dbo.HISTORIACLINICA (NU_NUME_LABO_HICL, FE_FECH_HICL, CD_MED_REAL_HICL, NU_ESTA_HICL, TX_TIPO_HICL, NU_HIST_PAC_HICL, NU_NUME_REG_HICL, TX_CODSER_HICL)
VALUES (600004, DATEADD(minute, -60, @ahora), '91-1', 1, 'CON', '900000001', 3330, 'S39145');
SET @h = SCOPE_IDENTITY();
INSERT dbo.R_LABO_DIAG VALUES (600004, 'R104', '1', '1');
INSERT dbo.HIST_INDI (DE_DESC_HIND, NU_NUME_HICL_HIND) VALUES ('OBSERVACION', @h);

-- E5 · evolución (no es una consulta).
INSERT dbo.HISTORIACLINICA (NU_NUME_LABO_HICL, FE_FECH_HICL, CD_MED_REAL_HICL, NU_ESTA_HICL, TX_TIPO_HICL, NU_HIST_PAC_HICL, NU_NUME_REG_HICL, TX_CODSER_HICL)
VALUES (600001, DATEADD(minute, -50, @ahora), '76', 1, 'EVO', '900000001', 0, 'S39141');

-- E6 · consulta recién guardada: el médico todavía puede estar corrigiéndola.
INSERT dbo.LABORATORIO VALUES (600006, '000', 'S39141', 46);
INSERT dbo.HISTORIACLINICA (NU_NUME_LABO_HICL, FE_FECH_HICL, CD_MED_REAL_HICL, NU_ESTA_HICL, TX_TIPO_HICL, NU_HIST_PAC_HICL, NU_NUME_REG_HICL, TX_CODSER_HICL)
VALUES (600006, DATEADD(minute, -1, @ahora), '76', 0, 'CON', '900000001', 0, 'S39141');
SET @h = SCOPE_IDENTITY();
INSERT dbo.R_LABO_DIAG VALUES (600006, 'I10X', '3', '1');
GO

PRINT 'Historia clínica del mock local: tablas y seis historias de prueba (E1-E6).';
GO

/* =============================================================================
   PRUEBA H6 — PARTE A: ESCRIBIR UNA CITA COMO EL AGENTE — SOLO EN PRUEBAS
   =============================================================================

   Se ejecuta COMPLETO (F5), sin editar nada. Si la base no es PRUEBAS, no hace
   nada. Si ya hay una cita de esta prueba, tampoco: primero correr la PARTE B.

   Qué hace:
     1. Crea (si no existen) dos pacientes SINTÉTICOS de prueba:
          9990000090  PRUEBA H6 AGENTE      → recibe la cita "del agente"
          9990000091  PRUEBA H6 VENTANILLA  → para intentar agendar en la app
        Documentos de la serie 999000000xx, la misma de PRUEBAS_E2E: no son
        personas reales.
     2. Elige sola el PRIMER hueco libre de MDD2 (≥ 40 min) a partir de mañana,
        según CITAS_DISPONIBLES.
     3. Escribe en CITAS_MEDICAS una cita de 20 min al inicio de ese hueco,
        EXACTAMENTE con las columnas y valores que usa el agente.
     4. Muestra CITAS_DISPONIBLES de ese día (se espera que NO cambie).
     5. Muestra las instrucciones de qué revisar en la aplicación.

   Después: revisar en la aplicación del HIS (ver el último resultado) y correr
   la PARTE B, que muestra cómo quedó todo y borra lo que creó esta prueba.
   ============================================================================= */

USE PRUEBAS;
GO
IF DB_NAME() <> 'PRUEBAS'
BEGIN
    RAISERROR('No es PRUEBAS: la prueba se detiene sin hacer nada.', 16, 1);
    SET NOEXEC ON;   -- nada de lo que sigue se ejecuta en esta sesión
END
GO
IF EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS WHERE DE_DESC_CIT = 'PRUEBA H6 AGENIA - BORRAR')
BEGIN
    RAISERROR('Ya hay una cita de esta prueba: correr primero la PARTE B.', 16, 1);
    SET NOEXEC ON;
END
GO

SET XACT_ABORT ON;
SET NOCOUNT ON;

-- 1) Pacientes sintéticos (mismo formato que PRUEBAS_E2E_1_PREPARAR.sql).
IF NOT EXISTS (SELECT 1 FROM dbo.PACIENTES WHERE NU_HIST_PAC = '9990000090')
    INSERT INTO dbo.PACIENTES (NU_HIST_PAC, NU_DOCU_PAC, NU_TIPD_PAC, NO_NOMB_PAC, NO_SGNO_PAC,
                               DE_PRAP_PAC, DE_SGAP_PAC, DE_TELE_PAC, FE_NACI_PAC, NU_SEXO_PAC,
                               FE_HIST_PAC, NU_EXTR_PAC)
    VALUES ('9990000090', '9990000090', 0, 'PRUEBA', 'H6', 'AGENTE', NULL, NULL, '19850314', 0, GETDATE(), 0);
IF NOT EXISTS (SELECT 1 FROM dbo.PACIENTES WHERE NU_HIST_PAC = '9990000091')
    INSERT INTO dbo.PACIENTES (NU_HIST_PAC, NU_DOCU_PAC, NU_TIPD_PAC, NO_NOMB_PAC, NO_SGNO_PAC,
                               DE_PRAP_PAC, DE_SGAP_PAC, DE_TELE_PAC, FE_NACI_PAC, NU_SEXO_PAC,
                               FE_HIST_PAC, NU_EXTR_PAC)
    VALUES ('9990000091', '9990000091', 0, 'PRUEBA', 'H6', 'VENTANILLA', NULL, NULL, '19900701', 1, GETDATE(), 0);

-- 2) El primer hueco libre de MDD2 desde mañana.
DECLARE @turno int, @fecha datetime, @ini datetime, @cons varchar(8);
SELECT TOP 1 @turno = d.NU_TUME_CIDI, @fecha = d.FE_FECH_CIDI, @ini = d.FE_HOIN_CIDI,
             @cons = t.CD_CODI_CONS_TUME
  FROM dbo.CITAS_DISPONIBLES d
  JOIN dbo.TURNOS_MEDICOS t ON t.NU_NUME_TUME = d.NU_TUME_CIDI
 WHERE d.CD_MED_CIDI = 'MDD2'
   AND d.FE_FECH_CIDI > CAST(GETDATE() AS date)
   AND d.NU_DURA_CIDI >= 40
 ORDER BY d.FE_FECH_CIDI, d.FE_HOIN_CIDI;

IF @turno IS NULL
BEGIN
    RAISERROR('MDD2 no tiene huecos de 40 min a futuro en PRUEBAS: avisar a AgenIA.', 16, 1);
    RETURN;
END

-- Formatos idénticos a los del agente:
--   FE_HORA_CIT  'YYYY/MM/DD HH:MM'     FE_FECH_CIT 'YYYYMMDD'
--   FE_SOLI_CIT  'YYYY-MM-DDTHH:MM:00'  (ISO: igual con cualquier idioma del login)
DECLARE @hhmm varchar(5)  = CONVERT(varchar(5), @ini, 108);
DECLARE @hora varchar(18) = CONVERT(varchar(10), @fecha, 111) + ' ' + @hhmm;
DECLARE @dia  varchar(8)  = CONVERT(varchar(8), @fecha, 112);
DECLARE @soli varchar(19) = CONVERT(varchar(10), @fecha, 23) + 'T' + @hhmm + ':00';

-- 3) La cita "del agente": mismas columnas y valores que crearCita (driver
--    cnt-sanvicente-anserma): estado 0, medicina general S39141, 20 min,
--    especialidad '000', convenio particular 26, centro de costos '007',
--    lugar de atención '01'. Solo cambia la marca de DE_DESC_CIT, para poder
--    encontrarla y borrarla.
INSERT INTO dbo.CITAS_MEDICAS (
  CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT,
  NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
  NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_CONE_CALL_CIT,
  NU_TIPO_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT, NU_NUME_CONV_CIT,
  DE_DESC_CIT, CD_CODI_CECO_CIT, CD_CODI_LUAT_CIT, FE_SOLI_CIT
) VALUES (
  'MDD2', @hora, 0, 'S39141',
  '9990000090', 20, GETDATE(), @dia,
  0, 0, 0, 0,
  0, '000', @cons, 26,
  'PRUEBA H6 AGENIA - BORRAR', '007', '01', @soli
);

-- 4) CITAS_DISPONIBLES de ese día, DESPUÉS de la cita (se espera: sin cambios).
SELECT 'HUECOS DESPUÉS DE LA CITA DEL AGENTE' AS que,
       CONVERT(varchar(5), FE_HOIN_CIDI, 108) AS desde,
       CONVERT(varchar(5), FE_HOFI_CIDI, 108) AS hasta, NU_DURA_CIDI AS minutos, NU_TUME_CIDI AS turno
  FROM dbo.CITAS_DISPONIBLES
 WHERE CD_MED_CIDI = 'MDD2' AND FE_FECH_CIDI = @fecha
 ORDER BY FE_HOIN_CIDI;

-- 5) Qué revisar en la aplicación del HIS (conectada a PRUEBAS).
SELECT 'cita de prueba escrita' AS resultado,
       'MDD2 (MEDICO DISPONIBLE HSVP 02)' AS medico,
       CONVERT(varchar(10), @fecha, 23) AS fecha,
       @hhmm + ' a ' + CONVERT(varchar(5), DATEADD(minute, 20, @ini), 108) AS cita_del_agente,
       'a) ¿La pantalla muestra libre ' + @hhmm + '?  ' +
       'b) Asignar a 9990000091 a las ' + CONVERT(varchar(5), DATEADD(minute, 10, @ini), 108) + ': ¿lo deja?  ' +
       'c) Asignar a 9990000091 a las ' + @hhmm + ': ¿lo deja o da error?  ' +
       'd) Cerrar y reabrir la pantalla: ¿cambia algo?' AS revisar_en_la_aplicacion;
GO
SET NOEXEC OFF;
GO

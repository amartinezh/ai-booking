/* =============================================================================
   PRUEBAS E2E — 2. PASOS QUE SE CORREN DURANTE LA PRUEBA
   Base objetivo: PRUEBAS.   ⚠️ Cada paso ESCRIBE. Correr UNO a la vez.
   =============================================================================

   Son las acciones «del hospital» que un escenario necesita en un momento
   preciso (PRUEBAS_E2E.md dice cuándo). NO se corren de corrido: se selecciona
   el bloque del paso en SSMS y se ejecuta solo ese.

     A — el hospital cancela una cita que AgenIA ya tenía        (escenario 4)
     B — el hospital toma el cupo antes de que llegue la reserva (escenario 15)
     C — una cita de AgenIA desaparece del HIS sin cancelación   (escenario 16)
     D — el hospital agenda para un documento ambiguo            (escenario 22)
     E — el hospital agenda para el gemelo del teléfono          (escenario 21)

   El ORDEN importa en D y en E, y por eso son pasos y no parte de PREPARAR: D
   necesita que los dos perfiles ya existan en AgenIA, y E que el paciente 1 ya se
   haya quedado con el número. Si se corren antes, los dos escenarios se pierden sin
   dar error: AgenIA simplemente da de alta al paciente.

   🔒 BLINDAJE: cada paso SOLO puede tocar citas de los documentos sintéticos
   (9990000001 … 9990000022). Todas las condiciones de los UPDATE/DELETE/INSERT
   llevan el documento: aunque se escriba mal un médico o una hora, no hay forma
   de que alcance la cita de un paciente real. Y cada paso comprueba que afectó
   exactamente UNA fila; si no, deshace y dice por qué.
   ============================================================================= */

USE PRUEBAS;
GO

/* =============================================================================
   PASO A — Escenario 4: el HOSPITAL cancela una cita que ya estaba en AgenIA
   Cuándo: DESPUÉS de comprobar que el cupo del escenario 4 dejó de ofrecerse por
   WhatsApp (el agente ya tomó el alta). Si se corre antes, el agente nunca ve la
   cita y no hay cancelación que detectar.
   Qué hace: lo MISMO que el driver y que la aplicación del hospital — copia la cita
   a CITAS_ANULADAS con un motivo y la borra de CITAS_MEDICAS.
   ============================================================================= */
SET XACT_ABORT ON;
IF DB_NAME() <> 'PRUEBAS' THROW 50000, 'Solo en PRUEBAS.', 1;

DECLARE @docA varchar(20) = '9990000004';
-- El motivo: se prefiere uno que hable de que el PACIENTE canceló, porque es lo que
-- este paso simula. Con `TOP (1) ORDER BY código` salía el primero del catálogo —en
-- el mock, «ERROR DE CAJERO»— y esa fila se queda para siempre en CITAS_ANULADAS,
-- que es la bitácora del hospital: ensuciarla con un motivo falso es gratuito.
DECLARE @motivoA varchar(2) = (
    SELECT TOP (1) CD_CODI_MOTI FROM dbo.MOTIVOANUL
     ORDER BY CASE WHEN DE_DESC_MOTI LIKE '%PACIENTE%' THEN 0 ELSE 1 END, CD_CODI_MOTI);

BEGIN TRANSACTION;

INSERT INTO dbo.CITAS_ANULADAS (
    CD_CODI_MED_CIAN, FE_HORA_CIAN, CD_CODI_SER_CIAN,
    NU_HIST_PAC_CIAN, NU_DURA_CIAN, FE_ELAB_CIAN, FE_FECH_CIAN,
    NU_DIA_CIAN, NU_NUME_MOVI_CIAN, NU_PRIM_CIAN, NU_NUME_CONE_CIAN,
    NU_CONE_CALL_CIAN, CD_CODI_ESP_CIAN, CD_CODI_CONS_CIAN,
    NU_NUME_CONV_CIAN, NU_TIPO_CIAN, DE_DESC_CIAN, NU_AUTO_AGRU_CIAN,
    CD_CODI_EST_CIAN, CD_CODI_CAMP_CIAN, NU_CODIGO_HSWE_CIAN,
    CD_CODI_MOTI_CIAN, TX_OBSE_CIAN
)
SELECT
    CD_CODI_MED_CIT, FE_HORA_CIT, CD_CODI_SER_CIT,
    NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
    NU_DIA_CIT, COALESCE(NU_NUME_MOVI_CIT, 0), NU_PRIM_CIT, NU_NUME_CONE_CIT,
    NU_CONE_CALL_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT,
    NU_NUME_CONV_CIT, NU_TIPO_CIT, DE_DESC_CIT, NU_AUTO_AGRU_CIT,
    CD_CODI_EST_CIT, CD_CODI_CAMP_CIT, NU_CODIGO_HSWE_CIT,
    @motivoA, 'PRUEBA E2E AGENIA · escenario 4 · cancelada en el HIS'
FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT = @docA AND NU_ESTA_CIT = 0
  AND DE_DESC_CIT LIKE 'PRUEBA E2E AGENIA%';

IF @@ROWCOUNT <> 1
BEGIN
    ROLLBACK TRANSACTION;
    THROW 50001, 'Paso A: no está la cita vigente del escenario 4 (¿ya se canceló, o falta correr PREPARAR?).', 1;
END;

DELETE FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT = @docA AND NU_ESTA_CIT = 0
  AND DE_DESC_CIT LIKE 'PRUEBA E2E AGENIA%';

COMMIT TRANSACTION;
PRINT 'PASO A listo: la cita del escenario 4 se canceló en el HIS (motivo ' + @motivoA + ').';
GO

/* =============================================================================
   PASO B — Escenario 15: el HOSPITAL toma el cupo antes de que llegue la reserva
   Cuándo: con el AGENTE DETENIDO, justo DESPUÉS de reservar por WhatsApp como el
   paciente 9990000015. Se pone aquí el médico y la hora EXACTOS que el bot
   confirmó (la hora como la guarda el HIS: 'YYYY/MM/DD HH:MM').
   Qué hace: agenda ese mismo cupo a nombre de otro paciente sintético
   (9990000019), como si lo hubieran dado en ventanilla. Al arrancar el agente, su
   envío choca con la clave primaria del HIS: «ese cupo ya está ocupado».
   ============================================================================= */
SET XACT_ABORT ON;
IF DB_NAME() <> 'PRUEBAS' THROW 50000, 'Solo en PRUEBAS.', 1;

DECLARE @medB  varchar(4)  = '';   -- ← el médico del cupo que confirmó el bot
DECLARE @horaB varchar(18) = '';   -- ← 'YYYY/MM/DD HH:MM' del cupo que confirmó el bot

IF @medB = '' OR @horaB = ''
    THROW 50002, 'Paso B: llene @medB y @horaB con el cupo que el bot confirmó al paciente 9990000015.', 1;
IF @horaB NOT LIKE '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9] [0-9][0-9]:[0-9][0-9]'
    THROW 50003, 'Paso B: @horaB debe tener la forma YYYY/MM/DD HH:MM.', 1;
IF EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS WHERE CD_CODI_MED_CIT = @medB AND FE_HORA_CIT = @horaB AND NU_ESTA_CIT = 0)
    THROW 50004, 'Paso B: ese cupo YA está ocupado en el HIS. ¿El agente estaba corriendo y la reserva ya llegó? Detenerlo y repetir el escenario con otro cupo.', 1;

-- Servicio, convenio, etc. copiados de una cita real del mismo médico, como en PREPARAR.
INSERT INTO dbo.CITAS_MEDICAS (
    CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT,
    NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
    NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_CONE_CALL_CIT,
    NU_TIPO_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT, NU_NUME_CONV_CIT,
    DE_DESC_CIT, CD_CODI_CECO_CIT, CD_CODI_LUAT_CIT, FE_SOLI_CIT
)
SELECT TOP (1)
    @medB, @horaB, 0, r.CD_CODI_SER_CIT,
    '9990000019', r.NU_DURA_CIT, GETDATE(),
    CONVERT(date, REPLACE(LEFT(@horaB, 10), '/', ''), 112),
    0, 0, 0, 0,
    0, r.CD_CODI_ESP_CIT, r.CD_CODI_CONS_CIT, r.NU_NUME_CONV_CIT,
    'PRUEBA E2E AGENIA · escenario 15 · el hospital tomó el cupo', r.CD_CODI_CECO_CIT, r.CD_CODI_LUAT_CIT,
    -- Fecha y hora por separado: 'YYYYMMDD' (estilo 112) y 'HH:MM' se leen igual con
    -- cualquier idioma del login; una cadena combinada no está garantizada.
    CAST(CONVERT(date, REPLACE(LEFT(@horaB, 10), '/', ''), 112) AS datetime) + CAST(RIGHT(@horaB, 5) AS datetime)
FROM dbo.CITAS_MEDICAS r
WHERE r.CD_CODI_MED_CIT = @medB
ORDER BY r.FE_FECH_CIT DESC;

IF @@ROWCOUNT <> 1
    THROW 50005, 'Paso B: ese médico no tiene ninguna cita de la cual copiar servicio y convenio.', 1;
PRINT 'PASO B listo: el cupo ' + @medB + ' ' + @horaB + ' quedó a nombre de 9990000019. Ahora arranque el agente.';
GO

/* =============================================================================
   PASO C — Escenario 16: una cita de AgenIA DESAPARECE del HIS sin cancelación
   Cuándo: cuando la reserva por WhatsApp del paciente 9990000016 YA llegó al HIS
   (en el panel del espejo no queda nada pendiente).
   Qué hace: borra la fila SIN pasar por CITAS_ANULADAS, que es lo que no debería
   pasar nunca y es justo lo que la reconciliación existe para detectar.
   Solo toca la fila que escribió AgenIA ('ASIGNADA POR WHATSAPP') para ese
   documento sintético.
   ============================================================================= */
SET XACT_ABORT ON;
IF DB_NAME() <> 'PRUEBAS' THROW 50000, 'Solo en PRUEBAS.', 1;

BEGIN TRANSACTION;

DELETE FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT = '9990000016'
  AND NU_ESTA_CIT = 0
  AND DE_DESC_CIT = 'ASIGNADA POR WHATSAPP';

-- Se comprueba ANTES de confirmar: si hubiera dos (el paciente reservó dos veces),
-- no se borra ninguna.
IF @@ROWCOUNT <> 1
BEGIN
    ROLLBACK TRANSACTION;
    THROW 50006, 'Paso C: no hay exactamente UNA cita vigente de AgenIA para 9990000016 (¿ya llegó la reserva al HIS, o reservó dos veces?). No se borró nada.', 1;
END;

COMMIT TRANSACTION;
PRINT 'PASO C listo: la cita del escenario 16 ya no está en el HIS. Reinicie el agente: la reconciliación corre a los 2 minutos.';
GO

/* =============================================================================
   PASO D — Escenario 22: el hospital agenda para un DOCUMENTO AMBIGUO
   Cuándo: DESPUÉS de crear a mano en AgenIA los dos perfiles del mismo documento
   (`9990000022` y `0009990000022`). Si se corre antes, AgenIA encuentra un solo
   candidato —o ninguno— y simplemente da de alta al paciente: no hay ambigüedad
   que detectar y el escenario se pierde.
   Qué hace: agenda una cita «del hospital» para ese documento en el primer cupo
   libre del turno. AgenIA tiene que OCUPAR el cupo, NO crear la cita, y abrir en la
   bandeja «Cita del hospital con un documento ambiguo» (regla D3: no elige, porque
   fusionar a dos personas no se deshace).
   ============================================================================= */
SET XACT_ABORT ON;
IF DB_NAME() <> 'PRUEBAS' THROW 50000, 'Solo en PRUEBAS.', 1;

DECLARE @docD varchar(20) = '9990000022';
DECLARE @medD varchar(4)  = '';   -- ← el médico homologado (el mismo de PREPARAR)
DECLARE @diaD char(10)    = '';   -- ← el día de prueba, 'YYYY/MM/DD'

IF @medD = '' OR @diaD = ''
    THROW 50010, 'Paso D: llene @medD (el médico homologado) y @diaD (el día de prueba, YYYY/MM/DD).', 1;
IF @diaD NOT LIKE '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]'
    THROW 50011, 'Paso D: @diaD debe tener la forma YYYY/MM/DD.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.PACIENTES WHERE NU_HIST_PAC = @docD)
    THROW 50012, 'Paso D: no existe el paciente 9990000022. ¿Corrió PRUEBAS_E2E_1_PREPARAR?', 1;
IF EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS WHERE NU_HIST_PAC_CIT = @docD)
    THROW 50013, 'Paso D: ese paciente ya tiene una cita: el paso ya se corrió.', 1;

DECLARE @fechaD date = CONVERT(date, REPLACE(@diaD, '/', ''), 112);
DECLARE @tIniD time, @tFinD time;
SELECT TOP (1) @tIniD = CAST(FE_HOIN_TUME AS time), @tFinD = CAST(FE_HOFI_TUME AS time)
  FROM dbo.TURNOS_MEDICOS
 WHERE CD_MED_TUME = @medD AND CAST(FE_FECH_TUME AS date) = @fechaD
 ORDER BY FE_HOFI_TUME DESC;
IF @tIniD IS NULL
    THROW 50014, 'Paso D: ese médico no tiene turno ese día.', 1;

-- Servicio, convenio y demás, copiados de una cita REAL del mismo médico (como PREPARAR).
DECLARE @serD varchar(12), @espD varchar(3), @consD varchar(8), @convD int,
        @cecoD varchar(11), @luatD varchar(2), @duraD int;
SELECT TOP (1) @serD = CD_CODI_SER_CIT, @espD = CD_CODI_ESP_CIT, @consD = CD_CODI_CONS_CIT,
       @convD = NU_NUME_CONV_CIT, @cecoD = CD_CODI_CECO_CIT, @luatD = CD_CODI_LUAT_CIT,
       @duraD = NU_DURA_CIT
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT = @medD
   AND (DE_DESC_CIT IS NULL OR DE_DESC_CIT NOT LIKE 'PRUEBA E2E AGENIA%')
 ORDER BY FE_FECH_CIT DESC;
IF @serD IS NULL
    THROW 50015, 'Paso D: ese médico no tiene ninguna cita de la cual copiar servicio y convenio.', 1;
SET @duraD = COALESCE(NULLIF(@duraD, 0), 20);

-- El PRIMER cupo libre del turno: PREPARAR se quedó con los cuatro ÚLTIMOS, así que
-- entrando por el principio no se pisan.
DECLARE @horaD varchar(18) = NULL, @inicioD datetime = NULL;
;WITH nD AS (
    SELECT TOP (200) i = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 FROM sys.all_objects
), candD AS (
    SELECT inicio = DATEADD(minute, nD.i * @duraD, CAST(@fechaD AS datetime) + CAST(@tIniD AS datetime))
    FROM nD
    WHERE DATEADD(minute, (nD.i + 1) * @duraD, CAST(@tIniD AS datetime)) <= CAST(@tFinD AS datetime)
)
SELECT TOP (1) @horaD = @diaD + ' ' + CONVERT(char(5), c.inicio, 108), @inicioD = c.inicio
  FROM candD c
 WHERE NOT EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS x
                   WHERE x.CD_CODI_MED_CIT = @medD
                     AND x.FE_HORA_CIT = @diaD + ' ' + CONVERT(char(5), c.inicio, 108))
 ORDER BY c.inicio;
IF @horaD IS NULL
    THROW 50016, 'Paso D: no queda ningún cupo libre en el turno de ese médico ese día.', 1;

INSERT INTO dbo.CITAS_MEDICAS (
    CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT,
    NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
    NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_CONE_CALL_CIT,
    NU_TIPO_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT, NU_NUME_CONV_CIT,
    DE_DESC_CIT, CD_CODI_CECO_CIT, CD_CODI_LUAT_CIT, FE_SOLI_CIT
)
VALUES (
    @medD, @horaD, 0, @serD,
    @docD, @duraD, GETDATE(), @fechaD,
    0, 0, 0, 0,
    0, @espD, @consD, @convD,
    'PRUEBA E2E AGENIA · escenario 22 · documento ambiguo', @cecoD, @luatD, @inicioD
);

IF @@ROWCOUNT <> 1
    THROW 50017, 'Paso D: no se escribió la cita.', 1;
PRINT 'PASO D listo: cupo ' + @medD + ' ' + @horaD + ' a nombre de 9990000022. '
    + 'En la próxima vuelta del agente: el cupo se ocupa, NO se crea la cita, y la bandeja '
    + 'abre «Cita del hospital con un documento ambiguo».';
GO

/* =============================================================================
   PASO E — Escenario 21: el hospital agenda para el GEMELO DEL TELÉFONO
   Cuándo: DESPUÉS de comprobar que el paciente 9990000001 ya existe en AgenIA CON
   el móvil del probador (escenario 1). Ese orden es el escenario: el primero que
   llega se queda con el número.
   Qué hace: agenda una cita «del hospital» para el 9990000021, cuya ficha tiene el
   MISMO móvil. AgenIA tiene que crear al paciente **sin teléfono** (regla D4) y NO
   mandarle ningún recordatorio — el número es de otro documento, y asignarlo dejaría
   a una persona ver o cancelar la cita de otra.
   ============================================================================= */
SET XACT_ABORT ON;
IF DB_NAME() <> 'PRUEBAS' THROW 50000, 'Solo en PRUEBAS.', 1;

DECLARE @docE varchar(20) = '9990000021';
DECLARE @medE varchar(4)  = '';   -- ← el médico homologado
DECLARE @diaE char(10)    = '';   -- ← el día de prueba, 'YYYY/MM/DD'

IF @medE = '' OR @diaE = ''
    THROW 50020, 'Paso E: llene @medE (el médico homologado) y @diaE (el día de prueba, YYYY/MM/DD).', 1;
IF @diaE NOT LIKE '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]'
    THROW 50021, 'Paso E: @diaE debe tener la forma YYYY/MM/DD.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.PACIENTES WHERE NU_HIST_PAC = @docE AND DE_TELE_PAC IS NOT NULL)
    THROW 50022, 'Paso E: el paciente 9990000021 no existe o no tiene teléfono. ¿Corrió PREPARAR con @TEL_PRUEBA?', 1;
IF EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS WHERE NU_HIST_PAC_CIT = @docE)
    THROW 50023, 'Paso E: ese paciente ya tiene una cita: el paso ya se corrió.', 1;

DECLARE @fechaE date = CONVERT(date, REPLACE(@diaE, '/', ''), 112);
DECLARE @tIniE time, @tFinE time;
SELECT TOP (1) @tIniE = CAST(FE_HOIN_TUME AS time), @tFinE = CAST(FE_HOFI_TUME AS time)
  FROM dbo.TURNOS_MEDICOS
 WHERE CD_MED_TUME = @medE AND CAST(FE_FECH_TUME AS date) = @fechaE
 ORDER BY FE_HOFI_TUME DESC;
IF @tIniE IS NULL
    THROW 50024, 'Paso E: ese médico no tiene turno ese día.', 1;

DECLARE @serE varchar(12), @espE varchar(3), @consE varchar(8), @convE int,
        @cecoE varchar(11), @luatE varchar(2), @duraE int;
SELECT TOP (1) @serE = CD_CODI_SER_CIT, @espE = CD_CODI_ESP_CIT, @consE = CD_CODI_CONS_CIT,
       @convE = NU_NUME_CONV_CIT, @cecoE = CD_CODI_CECO_CIT, @luatE = CD_CODI_LUAT_CIT,
       @duraE = NU_DURA_CIT
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT = @medE
   AND (DE_DESC_CIT IS NULL OR DE_DESC_CIT NOT LIKE 'PRUEBA E2E AGENIA%')
 ORDER BY FE_FECH_CIT DESC;
IF @serE IS NULL
    THROW 50025, 'Paso E: ese médico no tiene ninguna cita de la cual copiar servicio y convenio.', 1;
SET @duraE = COALESCE(NULLIF(@duraE, 0), 20);

DECLARE @horaE varchar(18) = NULL, @inicioE datetime = NULL;
;WITH nE AS (
    SELECT TOP (200) i = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 FROM sys.all_objects
), candE AS (
    SELECT inicio = DATEADD(minute, nE.i * @duraE, CAST(@fechaE AS datetime) + CAST(@tIniE AS datetime))
    FROM nE
    WHERE DATEADD(minute, (nE.i + 1) * @duraE, CAST(@tIniE AS datetime)) <= CAST(@tFinE AS datetime)
)
SELECT TOP (1) @horaE = @diaE + ' ' + CONVERT(char(5), c.inicio, 108), @inicioE = c.inicio
  FROM candE c
 WHERE NOT EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS x
                   WHERE x.CD_CODI_MED_CIT = @medE
                     AND x.FE_HORA_CIT = @diaE + ' ' + CONVERT(char(5), c.inicio, 108))
 ORDER BY c.inicio;
IF @horaE IS NULL
    THROW 50026, 'Paso E: no queda ningún cupo libre en el turno de ese médico ese día.', 1;

INSERT INTO dbo.CITAS_MEDICAS (
    CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT,
    NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
    NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_CONE_CALL_CIT,
    NU_TIPO_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT, NU_NUME_CONV_CIT,
    DE_DESC_CIT, CD_CODI_CECO_CIT, CD_CODI_LUAT_CIT, FE_SOLI_CIT
)
VALUES (
    @medE, @horaE, 0, @serE,
    @docE, @duraE, GETDATE(), @fechaE,
    0, 0, 0, 0,
    0, @espE, @consE, @convE,
    'PRUEBA E2E AGENIA · escenario 21 · teléfono de otro paciente', @cecoE, @luatE, @inicioE
);

IF @@ROWCOUNT <> 1
    THROW 50027, 'Paso E: no se escribió la cita.', 1;
PRINT 'PASO E listo: cupo ' + @medE + ' ' + @horaE + ' a nombre de 9990000021, que comparte el móvil con el 9990000001. '
    + 'Esperado: el paciente se crea SIN teléfono y NO le llega ningún recordatorio al probador por esta cita.';
GO

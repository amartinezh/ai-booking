/* =============================================================================
   PRUEBAS E2E — 2. PASOS QUE SE CORREN DURANTE LA PRUEBA
   Base objetivo: PRUEBAS.   ⚠️ Cada paso ESCRIBE. Correr UNO a la vez.
   =============================================================================

   Son las acciones «del hospital» que un escenario necesita en un momento
   preciso (PRUEBAS_E2E.md dice cuándo). NO se corren de corrido: se selecciona
   el bloque del paso en SSMS y se ejecuta solo ese.

   🔒 BLINDAJE: cada paso SOLO puede tocar citas de los documentos sintéticos
   (9990000001 … 9990000020). Todas las condiciones de los UPDATE/DELETE/INSERT
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
DECLARE @motivoA varchar(2) = (SELECT TOP (1) CD_CODI_MOTI FROM dbo.MOTIVOANUL ORDER BY CD_CODI_MOTI);

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

/* =============================================================================
   ¿SE PUEDEN TRATAR MDD1 / MDD2 COMO MÉDICOS NORMALES?
   Base objetivo: ESEHSVP (catálogo VIVO) — ESTRICTAMENTE SOLO LECTURA
   =============================================================================

   LA PREGUNTA
   El hospital reasigna internamente esos "médicos disponibles" a médicos
   reales antes de la cita. La duda no es si se pueden homologar —se puede, y
   ya está probado— sino QUÉ HACE EL HOSPITAL EN LA TABLA cuando reasigna.

   POR QUÉ IMPORTA (verificado en el código del agente, index.ts:501 y 606)
   El detector de cambios del agente compara instantáneas con la clave
   `CD_CODI_MED_CIT|FE_HORA_CIT`. El médico ES PARTE DE LA CLAVE. Por tanto:

     · Si el hospital cambia CD_CODI_MED_CIT de una cita existente, la clave
       vieja DESAPARECE de la foto y el agente lo reporta como CANCELACIÓN,
       aunque la cita del paciente siga perfectamente viva bajo otro médico.
     · Y la clave nueva APARECE. Si el médico nuevo no está homologado, el
       evento de alta falla; si la fila conserva DE_DESC_CIT = 'ASIGNADA POR
       WHATSAPP', el anti-eco (index.ts:569) la descarta y no se reporta nada.

     En los dos casos AgenIA se queda solo con la cancelación: marca la cita
     como CANCELLED, LIBERA EL CUPO y lo vuelve a ofrecer por WhatsApp. El
     paciente conserva su cita en el hospital pero la pierde en el bot, y esa
     hora se puede revender.

   (Comprobado: esa cancelación NO dispara ningún aviso automático al paciente
    — no hay mensaje falso de "su cita fue cancelada". El fallo es silencioso.)

   SI EL HOSPITAL NO TOCA CD_CODI_MED_CIT —si la cita se queda en MDD1/MDD2 y
   la reasignación es solo organizativa, en papel o en otro sistema— entonces
   NO HAY PROBLEMA NINGUNO y el escenario funciona tal cual.

   Estas consultas deciden cuál de los dos mundos es el real.

   INOCUIDAD: solo SELECT, READ UNCOMMITTED (no bloquea a nadie), todo acotado
   por fecha. Mismas garantías que DIAGNOSTICO_PRODUCCION_SOLO_LECTURA.sql.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
GO

SELECT DB_NAME() AS base_de_datos, GETDATE() AS momento;
GO


-- =============================================================================
-- A) LA PRUEBA DECISIVA — ¿las citas de MDD1/MDD2 llegan a atenderse BAJO ESE
--    MISMO CÓDIGO?
--
-- NU_ESTA_CIT: 0 = asignada · 1 = cumplida · 2 = incumplida
--
-- LECTURA DEL RESULTADO:
--   · Si aparecen MUCHAS filas en estado 1 y 2 → la cita vivió y se atendió
--     bajo MDD1/MDD2. El hospital NO reescribe el médico. ✅ ESCENARIO VIABLE.
--   · Si casi todo es estado 0 y apenas hay 1/2 en fechas ya pasadas → las
--     citas se mueven o se borran antes de atenderse. ❌ HAY QUE RESOLVERLO.
-- =============================================================================
SELECT CD_CODI_MED_CIT AS medico,
       NU_ESTA_CIT     AS estado,
       COUNT(*)        AS citas,
       MIN(CONVERT(varchar(10), FE_FECH_CIT, 23)) AS desde,
       MAX(CONVERT(varchar(10), FE_FECH_CIT, 23)) AS hasta
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT IN ('MDD1', 'MDD2', 'MD08')
   AND FE_FECH_CIT >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112)
   AND FE_FECH_CIT <  CONVERT(varchar(8), GETDATE(), 112)
 GROUP BY CD_CODI_MED_CIT, NU_ESTA_CIT
 ORDER BY medico, estado;
GO


-- =============================================================================
-- B) ¿SE ANULAN MUCHAS CITAS DE ESOS CÓDIGOS, Y POR QUÉ MOTIVO?
--
-- Un volumen alto con un motivo administrativo (no "paciente llama a
-- cancelar") sería la huella de una reasignación hecha como borrar+recrear.
-- =============================================================================
SELECT a.CD_CODI_MED_CIAN  AS medico,
       a.CD_CODI_MOTI_CIAN AS motivo,
       mo.DE_DESC_MOTI     AS descripcion,
       COUNT(*)            AS n
  FROM dbo.CITAS_ANULADAS a
  LEFT JOIN dbo.MOTIVOANUL mo ON mo.CD_CODI_MOTI = a.CD_CODI_MOTI_CIAN
 WHERE a.CD_CODI_MED_CIAN IN ('MDD1', 'MDD2', 'MD08')
   AND a.FE_FECH_CIAN >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112)
   AND a.FE_FECH_CIAN <  CONVERT(varchar(8), GETDATE(), 112)
 GROUP BY a.CD_CODI_MED_CIAN, a.CD_CODI_MOTI_CIAN, mo.DE_DESC_MOTI
 ORDER BY n DESC;
GO


-- =============================================================================
-- C) EL RASTRO DIRECTO DE UNA REASIGNACIÓN
--
-- Busca el patrón exacto: a un paciente se le anuló la cita con MDD1/MDD2 y
-- ese MISMO paciente tiene una cita viva a la MISMA HORA con OTRO médico.
-- Eso es una reasignación, no una cancelación.
--
-- Esperado si el escenario es seguro: 0 filas.
-- =============================================================================
SELECT TOP 100
       a.NU_HIST_PAC_CIAN  AS cedula,
       a.CD_CODI_MED_CIAN  AS medico_original,
       c.CD_CODI_MED_CIT   AS medico_nuevo,
       a.FE_HORA_CIAN      AS hora,
       a.CD_CODI_MOTI_CIAN AS motivo_anulacion,
       a.TX_OBSE_CIAN      AS observacion
  FROM dbo.CITAS_ANULADAS a
  JOIN dbo.CITAS_MEDICAS  c
    ON  c.NU_HIST_PAC_CIT  = a.NU_HIST_PAC_CIAN
    AND c.FE_HORA_CIT      = a.FE_HORA_CIAN
    AND c.CD_CODI_MED_CIT <> a.CD_CODI_MED_CIAN
 WHERE a.CD_CODI_MED_CIAN IN ('MDD1', 'MDD2', 'MD08')
   AND a.FE_FECH_CIAN >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112);
GO

-- Variante más amplia: mismo paciente, MISMO DÍA, otro médico (por si la
-- reasignación también cambia la hora).
SELECT TOP 100
       a.NU_HIST_PAC_CIAN AS cedula,
       a.CD_CODI_MED_CIAN AS medico_original,
       a.FE_HORA_CIAN     AS hora_original,
       c.CD_CODI_MED_CIT  AS medico_nuevo,
       c.FE_HORA_CIT      AS hora_nueva
  FROM dbo.CITAS_ANULADAS a
  JOIN dbo.CITAS_MEDICAS  c
    ON  c.NU_HIST_PAC_CIT  = a.NU_HIST_PAC_CIAN
    AND c.FE_FECH_CIT      = a.FE_FECH_CIAN
    AND c.CD_CODI_MED_CIT <> a.CD_CODI_MED_CIAN
 WHERE a.CD_CODI_MED_CIAN IN ('MDD1', 'MDD2', 'MD08')
   AND a.FE_FECH_CIAN >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112);
GO


-- =============================================================================
-- D) DIMENSIONAR EL POZO — ritmo semanal histórico de MDD1/MDD2
--
-- Cuántas citas absorben de verdad por semana. Es la cifra que dice cuántos
-- cupos hay que publicar para WhatsApp sin quedarse corto ni bloquear agenda.
-- =============================================================================
SELECT CD_CODI_MED_CIT AS medico,
       DATEPART(ISO_WEEK, FE_FECH_CIT) AS semana_iso,
       MIN(CONVERT(varchar(10), FE_FECH_CIT, 23)) AS desde,
       COUNT(*) AS citas
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT IN ('MDD1', 'MDD2')
   AND FE_FECH_CIT >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112)
   AND FE_FECH_CIT <  CONVERT(varchar(8), GETDATE(), 112)
 GROUP BY CD_CODI_MED_CIT, DATEPART(ISO_WEEK, FE_FECH_CIT)
 ORDER BY medico, semana_iso;
GO


-- =============================================================================
-- E) HORIZONTE DE RESERVA — con cuánta antelación se agenda en el pozo
--
-- FE_ELAB_CIT = cuándo se creó la cita · FE_FECH_CIT = cuándo es.
-- Dice si los pacientes reservan para dentro de días o de semanas, y por tanto
-- cuánta agenda futura hay que tener publicada en todo momento.
-- =============================================================================
SELECT CD_CODI_MED_CIT AS medico,
       CASE
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 0  THEN '0 mismo dia'
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 2  THEN '1-2 dias'
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 7  THEN '3-7 dias'
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 15 THEN '8-15 dias'
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 30 THEN '16-30 dias'
         ELSE 'mas de 30 dias'
       END AS antelacion,
       COUNT(*) AS citas
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT IN ('MDD1', 'MDD2')
   AND FE_FECH_CIT >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112)
   AND FE_FECH_CIT <  CONVERT(varchar(8), GETDATE(), 112)
   AND FE_ELAB_CIT IS NOT NULL
 GROUP BY CD_CODI_MED_CIT,
       CASE
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 0  THEN '0 mismo dia'
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 2  THEN '1-2 dias'
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 7  THEN '3-7 dias'
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 15 THEN '8-15 dias'
         WHEN DATEDIFF(DAY, FE_ELAB_CIT, FE_FECH_CIT) <= 30 THEN '16-30 dias'
         ELSE 'mas de 30 dias'
       END
 ORDER BY medico, citas DESC;
GO


-- =============================================================================
-- F) LOS DOS CONVENIOS DEL PILOTO — volumen real en el pozo MDD1/MDD2
--
-- Para confirmar que el piloto con dos convenios tiene masa crítica en los
-- médicos que efectivamente se van a vender por WhatsApp.
-- =============================================================================
SELECT NU_NUME_CONV_CIT AS convenio,
       COUNT(*)         AS citas_90d_en_MDD
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT IN ('MDD1', 'MDD2')
   AND FE_FECH_CIT >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112)
   AND FE_FECH_CIT <  CONVERT(varchar(8), GETDATE(), 112)
 GROUP BY NU_NUME_CONV_CIT
 ORDER BY citas_90d_en_MDD DESC;
GO

/* =============================================================================
   CRUCE CITA A CITA: AGENIA ↔ HIS — 29 Y 30 DE OCTUBRE DE 2026
   Médicos: RU70 (SANTIAGO CARDENAS GUEVARA), RU66 (ANDREA OSORIO GONZALEZ),
            RU68 (MICHILLE TATIANA ZAPATA PARRADO)
   Base objetivo: ESEHSVP — SOLO LECTURA (solo SELECT; no cambia nada)
   =============================================================================

   Para qué: el hospital quitó horas (y el turno del viernes del Dr. Cárdenas)
   después de que pacientes ya habían agendado por WhatsApp. Este script dice,
   para cada cita de esos médicos esos dos días:

     · si está en el HIS, en AgenIA o en los dos;
     · si el médico tiene turno ese día y si la hora cae dentro del turno;
     · qué hacer (columna «veredicto»).

   La lista de AgenIA va escrita abajo (bloque `agenia`), tomada de producción
   el 2026-10-29 a las 10:40 a. m. Sin nombres de pacientes: `ref` son los 4
   últimos caracteres del id de la cita en AgenIA y `doc4` los 4 últimos
   dígitos del documento (para ver si en el HIS es el mismo paciente).

   ESPERADO (según AgenIA):
     · RU70 30-oct 06:30  → NUNCA LLEGÓ AL HIS (el HIS la rechazó: sin turno).
     · RU70 30-oct 12:00 y 13:00, RU66 30-oct 12:10 y 12:30 → están en los dos,
       pero en horas que el hospital quitó de la agenda.

   Bloques:
     1. El cruce, con el veredicto.                    ← el importante
     2. Resumen por médico y día.
     3. Los turnos de esos médicos del 28 al 31 de octubre (todos, también los
        no disponibles), para ver qué cambió.
     4. Las citas de esos médicos esos días que el HIS anuló (CITAS_ANULADAS).

   Pegar el resultado de los bloques 1 a 4 (o una foto) en el chat.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

/* ── 1. El cruce ─────────────────────────────────────────────────────────────── */
WITH agenia (med, fecha, hora, ref, estado, origen, doc4, alta_his) AS (
  SELECT * FROM (VALUES
    ('RU66', '2026-10-30', '10:30', 'd933', 'SCHEDULED', 'MIRROR', '9234', '-'),
    ('RU66', '2026-10-30', '10:50', '7b34', 'SCHEDULED', 'MIRROR', '5830', '-'),
    ('RU66', '2026-10-30', '11:10', '75a8', 'SCHEDULED', 'MIRROR', '6727', '-'),
    ('RU66', '2026-10-30', '12:10', '4b51', 'SCHEDULED', 'WHATSAPP', '8329', 'entregada'),
    ('RU66', '2026-10-30', '12:30', '44f7', 'SCHEDULED', 'WHATSAPP', '6956', 'entregada'),
    ('RU66', '2026-10-30', '13:30', 'fd51', 'SCHEDULED', 'MIRROR', '4349', '-'),
    ('RU66', '2026-10-30', '14:30', '2b0d', 'SCHEDULED', 'MIRROR', '7055', '-'),
    ('RU66', '2026-10-30', '14:50', 'b768', 'SCHEDULED', 'MIRROR', '1801', '-'),
    ('RU66', '2026-10-30', '15:10', 'a600', 'SCHEDULED', 'MIRROR', '2639', '-'),
    ('RU66', '2026-10-30', '15:30', 'f1ed', 'SCHEDULED', 'MIRROR', '8081', '-'),
    ('RU66', '2026-10-30', '15:50', 'd792', 'SCHEDULED', 'MIRROR', '2292', '-'),
    ('RU66', '2026-10-30', '16:30', '6c1c', 'SCHEDULED', 'MIRROR', '6471', '-'),
    ('RU66', '2026-10-30', '16:50', '9ad9', 'SCHEDULED', 'MIRROR', '3126', '-'),
    ('RU66', '2026-10-30', '17:05', 'e2d8', 'SCHEDULED', 'MIRROR', '9619', '-'),
    ('RU68', '2026-10-29', '10:30', '4e0d', 'SCHEDULED', 'MIRROR', '9136', '-'),
    ('RU68', '2026-10-29', '10:50', '3a1c', 'SCHEDULED', 'MIRROR', '5634', '-'),
    ('RU68', '2026-10-29', '11:10', '7a44', 'SCHEDULED', 'MIRROR', '7839', '-'),
    ('RU68', '2026-10-29', '11:30', '3ff0', 'SCHEDULED', 'MIRROR', '1086', '-'),
    ('RU68', '2026-10-29', '11:50', '1f21', 'SCHEDULED', 'MIRROR', '2033', '-'),
    ('RU68', '2026-10-29', '12:10', '620f', 'SCHEDULED', 'MIRROR', '5733', '-'),
    ('RU68', '2026-10-29', '12:30', '5674', 'SCHEDULED', 'MIRROR', '8235', '-'),
    ('RU68', '2026-10-29', '12:50', '9415', 'SCHEDULED', 'MIRROR', '7588', '-'),
    ('RU68', '2026-10-29', '13:10', '2a68', 'SCHEDULED', 'MIRROR', '3705', '-'),
    ('RU68', '2026-10-29', '13:30', '6a27', 'SCHEDULED', 'MIRROR', '8098', '-'),
    ('RU68', '2026-10-29', '14:30', '0367', 'SCHEDULED', 'WHATSAPP', '3022', 'entregada'),
    ('RU68', '2026-10-29', '14:50', '7513', 'SCHEDULED', 'MIRROR', '5679', '-'),
    ('RU68', '2026-10-29', '15:10', 'fca1', 'CANCELLED', 'WHATSAPP', '4963', 'entregada'),
    ('RU68', '2026-10-29', '15:10', '3f31', 'SCHEDULED', 'MIRROR', '4271', '-'),
    ('RU68', '2026-10-29', '15:30', '2e99', 'SCHEDULED', 'WHATSAPP', '3768', 'entregada'),
    ('RU68', '2026-10-29', '15:50', '6248', 'SCHEDULED', 'WHATSAPP', '0384', 'entregada'),
    ('RU68', '2026-10-29', '16:15', 'de40', 'SCHEDULED', 'MIRROR', '7802', '-'),
    ('RU68', '2026-10-29', '16:30', 'bbe0', 'CANCELLED', 'MIRROR', '8122', '-'),
    ('RU68', '2026-10-29', '16:30', '06f2', 'SCHEDULED', 'WHATSAPP', '5852', 'entregada'),
    ('RU68', '2026-10-29', '16:50', '0175', 'SCHEDULED', 'MIRROR', '0555', '-'),
    ('RU68', '2026-10-29', '17:10', '2fb5', 'SCHEDULED', 'MIRROR', '7152', '-'),
    ('RU68', '2026-10-29', '17:30', 'b244', 'SCHEDULED', 'WHATSAPP', '4662', 'entregada'),
    ('RU68', '2026-10-29', '17:50', '8771', 'SCHEDULED', 'WHATSAPP', '2436', 'entregada'),
    ('RU68', '2026-10-29', '18:10', '01f1', 'SCHEDULED', 'WHATSAPP', '6279', 'entregada'),
    ('RU70', '2026-10-30', '06:30', '3967', 'SCHEDULED', 'WHATSAPP', '6450', 'rendida'),
    ('RU70', '2026-10-30', '10:00', '61e7', 'SCHEDULED', 'MIRROR', '4394', '-'),
    ('RU70', '2026-10-30', '10:20', '9e5c', 'SCHEDULED', 'MIRROR', '2279', '-'),
    ('RU70', '2026-10-30', '12:00', 'd51f', 'SCHEDULED', 'WHATSAPP', '7479', 'entregada'),
    ('RU70', '2026-10-30', '12:20', 'de40', 'SCHEDULED', 'MIRROR', '1594', '-'),
    ('RU70', '2026-10-30', '12:40', 'fde2', 'SCHEDULED', 'MIRROR', '5157', '-'),
    ('RU70', '2026-10-30', '13:00', '0c45', 'SCHEDULED', 'WHATSAPP', '2382', 'entregada')
  ) v (med, fecha, hora, ref, estado, origen, doc4, alta_his)
),
agenia_viva AS (SELECT * FROM agenia WHERE estado <> 'CANCELLED'),
his AS (
  SELECT RTRIM(c.CD_CODI_MED_CIT) AS med,
         CONVERT(varchar(10), c.FE_FECH_CIT, 23) AS fecha,
         -- FE_HORA_CIT es texto 'YYYY/MM/DD HH:MM' (a veces sin el cero: '7:10').
         CONVERT(varchar(5), TRY_CONVERT(time(0), LTRIM(RTRIM(SUBSTRING(c.FE_HORA_CIT, 11, 10)))), 108) AS hora,
         c.FE_HORA_CIT AS hora_texto,
         c.NU_ESTA_CIT AS estado_his,
         RTRIM(c.CD_CODI_SER_CIT) AS servicio,
         RIGHT(RTRIM(c.NU_HIST_PAC_CIT), 4) AS doc4,
         c.FE_ELAB_CIT AS elaborada
    FROM dbo.CITAS_MEDICAS c
   WHERE c.FE_FECH_CIT >= '20261029' AND c.FE_FECH_CIT < '20261031'
     AND c.CD_CODI_MED_CIT IN ('RU70', 'RU66', 'RU68')
),
cruce AS (
  SELECT COALESCE(a.med, h.med) AS med,
         COALESCE(a.fecha, h.fecha) AS fecha,
         COALESCE(a.hora, h.hora) AS hora,
         CASE WHEN h.med IS NULL THEN 'NO' ELSE 'SI' END AS en_his,
         CASE WHEN a.med IS NULL THEN 'NO' ELSE 'SI' END AS en_agenia,
         a.origen, a.ref, a.alta_his,
         a.doc4 AS doc4_agenia, h.doc4 AS doc4_his,
         h.estado_his, h.servicio, h.hora_texto, h.elaborada
    FROM agenia_viva a
    FULL OUTER JOIN his h
      ON h.med = a.med AND h.fecha = a.fecha AND h.hora = a.hora
)
SELECT x.med, x.fecha, x.hora, x.en_his, x.en_agenia, x.origen, x.ref,
       x.doc4_agenia, x.doc4_his, x.estado_his, x.servicio,
       CASE WHEN t.dia = 1 THEN 'SI' ELSE 'NO' END AS turno_ese_dia,
       CASE WHEN t.hora = 1 THEN 'SI' ELSE 'NO' END AS hora_en_el_turno,
       CASE
         WHEN x.en_his = 'SI' AND x.en_agenia = 'SI' AND x.doc4_agenia <> x.doc4_his
           THEN 'OJO: en el HIS esa hora es de OTRO paciente'
         WHEN x.en_his = 'SI' AND x.en_agenia = 'SI' AND t.dia = 0
           THEN 'ANULAR EN EL HIS: el médico no tiene turno ese día'
         WHEN x.en_his = 'SI' AND x.en_agenia = 'SI' AND t.hora = 0
           THEN 'ANULAR O MOVER EN EL HIS: la hora quedó fuera del turno'
         WHEN x.en_his = 'SI' AND x.en_agenia = 'SI'
           THEN 'OK: está en los dos y el médico atiende a esa hora'
         WHEN x.en_agenia = 'SI' AND anu.hay = 1
           THEN 'EL HIS LA ANULÓ Y AGENIA NO SE ENTERÓ: avisar a soporte'
         WHEN x.en_agenia = 'SI'
           THEN 'NUNCA LLEGÓ AL HIS: anular en AgenIA y avisar al paciente'
         WHEN cancelada_en_agenia.hay = 1
           THEN 'ANULADA EN AGENIA PERO VIVA EN EL HIS: avisar a soporte'
         ELSE 'SOLO EN EL HIS: normal si es un servicio que AgenIA no maneja (ver «servicio»); si no, avisar a soporte'
       END AS veredicto,
       x.hora_texto, x.elaborada
  FROM cruce x
  OUTER APPLY (
    SELECT MAX(1) AS dia,
           MAX(CASE WHEN x.hora >= CONVERT(varchar(5), tm.FE_HOIN_TUME, 108)
                     AND x.hora <  CONVERT(varchar(5), tm.FE_HOFI_TUME, 108) THEN 1 ELSE 0 END) AS hora
      FROM dbo.TURNOS_MEDICOS tm
     WHERE tm.CD_MED_TUME = x.med
       AND CAST(tm.FE_FECH_TUME AS date) = CAST(x.fecha AS date)
       AND tm.ID_DISP_TUME = '1'
  ) t0
  CROSS APPLY (SELECT ISNULL(t0.dia, 0) AS dia, ISNULL(t0.hora, 0) AS hora) t
  OUTER APPLY (
    SELECT TOP 1 1 AS hay
      FROM dbo.CITAS_ANULADAS ca
     WHERE ca.CD_CODI_MED_CIAN = x.med
       AND CONVERT(varchar(5), TRY_CONVERT(time(0), LTRIM(RTRIM(SUBSTRING(ca.FE_HORA_CIAN, 11, 10)))), 108) = x.hora
       AND LEFT(ca.FE_HORA_CIAN, 10) = REPLACE(x.fecha, '-', '/')
  ) anu
  OUTER APPLY (
    SELECT TOP 1 1 AS hay FROM agenia c
     WHERE c.estado = 'CANCELLED' AND c.med = x.med AND c.fecha = x.fecha AND c.hora = x.hora
  ) cancelada_en_agenia
 ORDER BY CASE WHEN x.en_his = 'SI' AND x.en_agenia = 'SI' AND t.hora = 1 THEN 1 ELSE 0 END,
          x.med, x.fecha, x.hora;
GO

/* ── 2. Resumen por médico y día (mismo cruce, contado) ─────────────────────────
   Si el bloque 1 se ve largo, este dice de un vistazo cuántas hay de cada lado. */
WITH agenia (med, fecha, hora, estado) AS (
  SELECT med, fecha, hora, estado FROM (VALUES
    ('RU66', '2026-10-30', '10:30', 'd933', 'SCHEDULED', 'MIRROR', '9234', '-'),
    ('RU66', '2026-10-30', '10:50', '7b34', 'SCHEDULED', 'MIRROR', '5830', '-'),
    ('RU66', '2026-10-30', '11:10', '75a8', 'SCHEDULED', 'MIRROR', '6727', '-'),
    ('RU66', '2026-10-30', '12:10', '4b51', 'SCHEDULED', 'WHATSAPP', '8329', 'entregada'),
    ('RU66', '2026-10-30', '12:30', '44f7', 'SCHEDULED', 'WHATSAPP', '6956', 'entregada'),
    ('RU66', '2026-10-30', '13:30', 'fd51', 'SCHEDULED', 'MIRROR', '4349', '-'),
    ('RU66', '2026-10-30', '14:30', '2b0d', 'SCHEDULED', 'MIRROR', '7055', '-'),
    ('RU66', '2026-10-30', '14:50', 'b768', 'SCHEDULED', 'MIRROR', '1801', '-'),
    ('RU66', '2026-10-30', '15:10', 'a600', 'SCHEDULED', 'MIRROR', '2639', '-'),
    ('RU66', '2026-10-30', '15:30', 'f1ed', 'SCHEDULED', 'MIRROR', '8081', '-'),
    ('RU66', '2026-10-30', '15:50', 'd792', 'SCHEDULED', 'MIRROR', '2292', '-'),
    ('RU66', '2026-10-30', '16:30', '6c1c', 'SCHEDULED', 'MIRROR', '6471', '-'),
    ('RU66', '2026-10-30', '16:50', '9ad9', 'SCHEDULED', 'MIRROR', '3126', '-'),
    ('RU66', '2026-10-30', '17:05', 'e2d8', 'SCHEDULED', 'MIRROR', '9619', '-'),
    ('RU68', '2026-10-29', '10:30', '4e0d', 'SCHEDULED', 'MIRROR', '9136', '-'),
    ('RU68', '2026-10-29', '10:50', '3a1c', 'SCHEDULED', 'MIRROR', '5634', '-'),
    ('RU68', '2026-10-29', '11:10', '7a44', 'SCHEDULED', 'MIRROR', '7839', '-'),
    ('RU68', '2026-10-29', '11:30', '3ff0', 'SCHEDULED', 'MIRROR', '1086', '-'),
    ('RU68', '2026-10-29', '11:50', '1f21', 'SCHEDULED', 'MIRROR', '2033', '-'),
    ('RU68', '2026-10-29', '12:10', '620f', 'SCHEDULED', 'MIRROR', '5733', '-'),
    ('RU68', '2026-10-29', '12:30', '5674', 'SCHEDULED', 'MIRROR', '8235', '-'),
    ('RU68', '2026-10-29', '12:50', '9415', 'SCHEDULED', 'MIRROR', '7588', '-'),
    ('RU68', '2026-10-29', '13:10', '2a68', 'SCHEDULED', 'MIRROR', '3705', '-'),
    ('RU68', '2026-10-29', '13:30', '6a27', 'SCHEDULED', 'MIRROR', '8098', '-'),
    ('RU68', '2026-10-29', '14:30', '0367', 'SCHEDULED', 'WHATSAPP', '3022', 'entregada'),
    ('RU68', '2026-10-29', '14:50', '7513', 'SCHEDULED', 'MIRROR', '5679', '-'),
    ('RU68', '2026-10-29', '15:10', 'fca1', 'CANCELLED', 'WHATSAPP', '4963', 'entregada'),
    ('RU68', '2026-10-29', '15:10', '3f31', 'SCHEDULED', 'MIRROR', '4271', '-'),
    ('RU68', '2026-10-29', '15:30', '2e99', 'SCHEDULED', 'WHATSAPP', '3768', 'entregada'),
    ('RU68', '2026-10-29', '15:50', '6248', 'SCHEDULED', 'WHATSAPP', '0384', 'entregada'),
    ('RU68', '2026-10-29', '16:15', 'de40', 'SCHEDULED', 'MIRROR', '7802', '-'),
    ('RU68', '2026-10-29', '16:30', 'bbe0', 'CANCELLED', 'MIRROR', '8122', '-'),
    ('RU68', '2026-10-29', '16:30', '06f2', 'SCHEDULED', 'WHATSAPP', '5852', 'entregada'),
    ('RU68', '2026-10-29', '16:50', '0175', 'SCHEDULED', 'MIRROR', '0555', '-'),
    ('RU68', '2026-10-29', '17:10', '2fb5', 'SCHEDULED', 'MIRROR', '7152', '-'),
    ('RU68', '2026-10-29', '17:30', 'b244', 'SCHEDULED', 'WHATSAPP', '4662', 'entregada'),
    ('RU68', '2026-10-29', '17:50', '8771', 'SCHEDULED', 'WHATSAPP', '2436', 'entregada'),
    ('RU68', '2026-10-29', '18:10', '01f1', 'SCHEDULED', 'WHATSAPP', '6279', 'entregada'),
    ('RU70', '2026-10-30', '06:30', '3967', 'SCHEDULED', 'WHATSAPP', '6450', 'rendida'),
    ('RU70', '2026-10-30', '10:00', '61e7', 'SCHEDULED', 'MIRROR', '4394', '-'),
    ('RU70', '2026-10-30', '10:20', '9e5c', 'SCHEDULED', 'MIRROR', '2279', '-'),
    ('RU70', '2026-10-30', '12:00', 'd51f', 'SCHEDULED', 'WHATSAPP', '7479', 'entregada'),
    ('RU70', '2026-10-30', '12:20', 'de40', 'SCHEDULED', 'MIRROR', '1594', '-'),
    ('RU70', '2026-10-30', '12:40', 'fde2', 'SCHEDULED', 'MIRROR', '5157', '-'),
    ('RU70', '2026-10-30', '13:00', '0c45', 'SCHEDULED', 'WHATSAPP', '2382', 'entregada')
  ) v (med, fecha, hora, ref, estado, origen, doc4, alta_his)
),
his AS (
  SELECT RTRIM(c.CD_CODI_MED_CIT) AS med,
         CONVERT(varchar(10), c.FE_FECH_CIT, 23) AS fecha,
         CONVERT(varchar(5), TRY_CONVERT(time(0), LTRIM(RTRIM(SUBSTRING(c.FE_HORA_CIT, 11, 10)))), 108) AS hora
    FROM dbo.CITAS_MEDICAS c
   WHERE c.FE_FECH_CIT >= '20261029' AND c.FE_FECH_CIT < '20261031'
     AND c.CD_CODI_MED_CIT IN ('RU70', 'RU66', 'RU68')
)
SELECT COALESCE(a.med, h.med) AS med, COALESCE(a.fecha, h.fecha) AS fecha,
       SUM(CASE WHEN a.med IS NOT NULL AND h.med IS NOT NULL THEN 1 ELSE 0 END) AS en_los_dos,
       SUM(CASE WHEN a.med IS NOT NULL AND h.med IS NULL THEN 1 ELSE 0 END) AS solo_en_agenia,
       SUM(CASE WHEN a.med IS NULL AND h.med IS NOT NULL THEN 1 ELSE 0 END) AS solo_en_his
  FROM (SELECT * FROM agenia WHERE estado <> 'CANCELLED') a
  FULL OUTER JOIN his h ON h.med = a.med AND h.fecha = a.fecha AND h.hora = a.hora
 GROUP BY COALESCE(a.med, h.med), COALESCE(a.fecha, h.fecha)
 ORDER BY 1, 2;
GO

/* ── 3. Los turnos de esos médicos del 28 al 31 de octubre ───────────────────────
   Todos, también los no disponibles (ID_DISP_TUME <> '1'): así se ve si el
   hospital borró el turno o lo marcó como no disponible. */
SELECT RTRIM(CD_MED_TUME) AS med,
       CONVERT(varchar(10), FE_FECH_TUME, 23) AS fecha,
       CONVERT(varchar(5), FE_HOIN_TUME, 108) AS desde,
       CONVERT(varchar(5), FE_HOFI_TUME, 108) AS hasta,
       ID_DISP_TUME AS disponible, NU_TIPO_TUME AS tipo,
       CD_CODI_CONS_TUME AS consultorio, NU_NUME_TUME AS turno
  FROM dbo.TURNOS_MEDICOS
 WHERE CD_MED_TUME IN ('RU70', 'RU66', 'RU68')
   AND FE_FECH_TUME >= '20261028' AND FE_FECH_TUME < '20261101'
 ORDER BY med, fecha, desde;
GO

/* ── 4. Lo que el HIS anuló de esos médicos esos días ────────────────────────────
   Motivo 'WB' = lo anuló AgenIA (pedido del paciente por WhatsApp). */
SELECT RTRIM(CD_CODI_MED_CIAN) AS med, FE_HORA_CIAN AS hora, CD_CODI_SER_CIAN AS servicio,
       RIGHT(RTRIM(NU_HIST_PAC_CIAN), 4) AS doc4, CD_CODI_MOTI_CIAN AS motivo,
       TX_OBSE_CIAN AS observacion, FE_ELAB_CIAN AS anulada
  FROM dbo.CITAS_ANULADAS
 WHERE CD_CODI_MED_CIAN IN ('RU70', 'RU66', 'RU68')
   AND FE_HORA_CIAN >= '2026/10/29' AND FE_HORA_CIAN < '2026/10/31'
 ORDER BY med, hora;
GO

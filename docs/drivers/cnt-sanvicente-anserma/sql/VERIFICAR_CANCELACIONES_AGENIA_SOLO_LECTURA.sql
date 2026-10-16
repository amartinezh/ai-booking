/* =============================================================================
   ¿QUEDARON BIEN CANCELADAS EN EL HIS LAS CITAS QUE CANCELÓ AGENIA?
   Base objetivo: ESEHSVP — SOLO LECTURA (solo SELECT; no cambia nada)
   =============================================================================

   Las dos primeras cancelaciones que AgenIA escribió en el hospital, ambas
   pedidas por el paciente por WhatsApp:

     1. 2026-10-15 15:38 — NU02 (KAREN LORENA CUELLAR HUACA), cita del
        2026-10-16 15:20, «CONSULTA DE PRIMERA VEZ POR NUTRICIÓN Y DIETÉTICA».
        Respuesta al recordatorio: «No puedo asistir, ella se encuentra
        hospitalizada».
     2. 2026-10-16 05:12 — RU67 (DANIELA CARDENAS CASTRILLON), cita del
        2026-10-16 06:30, medicina general.

   Cancelar, para el agente, es: copiar la cita a CITAS_ANULADAS con motivo
   'WB' y observación «Cancelada por el paciente vía WhatsApp», y borrarla de
   CITAS_MEDICAS — en una sola transacción y solo si el documento del paciente
   coincide.

   ESPERADO:
     · Parte 1 (CITAS_MEDICAS): 0 filas en estado 0 para esos dos cupos (si
       aparece una fila es de OTRO paciente agendado después en ese cupo: mirar
       NU_HIST_PAC_CIT).
     · Parte 2 (CITAS_ANULADAS): 1 fila por cita, con CD_CODI_MOTI_CIAN = 'WB'.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

/* ── 1. Lo que hoy tiene la agenda viva en esos cupos ───────────────────────── */
SELECT CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT,
       NU_HIST_PAC_CIT, DE_DESC_CIT, FE_ELAB_CIT
  FROM dbo.CITAS_MEDICAS
 WHERE (CD_CODI_MED_CIT = 'NU02' AND FE_HORA_CIT = '2026/10/16 15:20')
    OR (CD_CODI_MED_CIT = 'RU67' AND FE_HORA_CIT = '2026/10/16 06:30');
GO

/* ── 2. La constancia de la anulación ───────────────────────────────────────── */
SELECT CD_CODI_MED_CIAN, FE_HORA_CIAN, CD_CODI_SER_CIAN, NU_HIST_PAC_CIAN,
       CD_CODI_MOTI_CIAN, TX_OBSE_CIAN, FE_ELAB_CIAN
  FROM dbo.CITAS_ANULADAS
 WHERE (CD_CODI_MED_CIAN = 'NU02' AND FE_HORA_CIAN = '2026/10/16 15:20')
    OR (CD_CODI_MED_CIAN = 'RU67' AND FE_HORA_CIAN = '2026/10/16 06:30');
GO

/* ── 3. Todo lo que AgenIA ha anulado (motivo WB), por si hubiera más ────────── */
SELECT CD_CODI_MED_CIAN, FE_HORA_CIAN, CD_CODI_SER_CIAN, TX_OBSE_CIAN, FE_ELAB_CIAN
  FROM dbo.CITAS_ANULADAS
 WHERE CD_CODI_MOTI_CIAN = 'WB'
 ORDER BY FE_HORA_CIAN;
GO

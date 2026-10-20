/* =============================================================================
   ANTES DE ENCENDER «AGENDAR»: ¿LO QUE ESCRIBIRÁ EL AGENTE CUADRA CON ESEHSVP?
   Base objetivo: ESEHSVP — SOLO LECTURA (solo SELECT; no cambia nada)
   =============================================================================

   PARA QUÉ (2026-10-21)
   El 2026-10-22 se enciende el agendamiento por WhatsApp/Telegram y no se puede
   crear una cita de prueba en el hospital. Esto compara, sin escribir nada, lo
   que el agente pondrá en cada cita nueva de medicina general (S39141) con lo
   que el propio hospital pone en las suyas. Correrlo junto con
   `PERMISOS_ESCRITURA_AGENTE_SOLO_LECTURA.sql` (partes A y B), que confirma
   que el usuario del agente puede hacer INSERT en CITAS_MEDICAS y PACIENTES.

   LO QUE ESCRIBE EL AGENTE (mappingJson de producción, 2026-10-21)
     CD_CODI_ESP_CIT  = '000'           CD_CODI_CECO_CIT = '007'
     CD_CODI_LUAT_CIT = '01'            NU_TIPO_CIT, NU_PRIM_CIT, NU_CONE_CALL_CIT,
     NU_DIA_CIT, NU_NUME_MOVI_CIT = 0   DE_DESC_CIT = 'ASIGNADA POR WHATSAPP'
     NU_NUME_CONV_CIT según EPS y régimen:
        Sura (800088702)        contributivo 473 · subsidiado 467
        Salud Total (800130907) contributivo 476 · subsidiado 475
        sin EPS (particular)    26
     CD_CODI_CONS_CIT = el consultorio del turno del médico ese día.

   ESPERADO
     · Parte 1: en la columna «valor» de cada campo, el de arriba debe ser el más
       frecuente (o al menos aparecer). Si el hospital usa otro, avisar antes de
       encender: la cita se crearía igual, pero quedaría distinta a las suyas.
     · Parte 2: los 5 convenios existen y están vigentes hoy.
     · Parte 3: los médicos de medicina general tienen turno el 22 y el 23.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

/* ── 1. Cómo llena el hospital sus citas de medicina general (últimos 30 días) ── */
SELECT 'CD_CODI_ESP_CIT' AS campo, CAST(CD_CODI_ESP_CIT AS varchar(20)) AS valor, COUNT(*) AS citas
  FROM dbo.CITAS_MEDICAS WHERE LTRIM(RTRIM(CD_CODI_SER_CIT)) = 'S39141' AND FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
 GROUP BY CD_CODI_ESP_CIT
UNION ALL
SELECT 'CD_CODI_CECO_CIT', CAST(CD_CODI_CECO_CIT AS varchar(20)), COUNT(*)
  FROM dbo.CITAS_MEDICAS WHERE LTRIM(RTRIM(CD_CODI_SER_CIT)) = 'S39141' AND FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
 GROUP BY CD_CODI_CECO_CIT
UNION ALL
SELECT 'CD_CODI_LUAT_CIT', CAST(CD_CODI_LUAT_CIT AS varchar(20)), COUNT(*)
  FROM dbo.CITAS_MEDICAS WHERE LTRIM(RTRIM(CD_CODI_SER_CIT)) = 'S39141' AND FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
 GROUP BY CD_CODI_LUAT_CIT
UNION ALL
SELECT 'NU_TIPO_CIT', CAST(NU_TIPO_CIT AS varchar(20)), COUNT(*)
  FROM dbo.CITAS_MEDICAS WHERE LTRIM(RTRIM(CD_CODI_SER_CIT)) = 'S39141' AND FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
 GROUP BY NU_TIPO_CIT
UNION ALL
SELECT 'NU_PRIM_CIT', CAST(NU_PRIM_CIT AS varchar(20)), COUNT(*)
  FROM dbo.CITAS_MEDICAS WHERE LTRIM(RTRIM(CD_CODI_SER_CIT)) = 'S39141' AND FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
 GROUP BY NU_PRIM_CIT
UNION ALL
SELECT 'NU_CONE_CALL_CIT', CAST(NU_CONE_CALL_CIT AS varchar(20)), COUNT(*)
  FROM dbo.CITAS_MEDICAS WHERE LTRIM(RTRIM(CD_CODI_SER_CIT)) = 'S39141' AND FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
 GROUP BY NU_CONE_CALL_CIT
UNION ALL
SELECT 'NU_NUME_CONV_CIT', CAST(NU_NUME_CONV_CIT AS varchar(20)), COUNT(*)
  FROM dbo.CITAS_MEDICAS WHERE LTRIM(RTRIM(CD_CODI_SER_CIT)) = 'S39141' AND FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
 GROUP BY NU_NUME_CONV_CIT
ORDER BY campo, citas DESC;
GO

/* ── 2. Los convenios que usará el agente: ¿existen y están vigentes hoy? ─────── */
SELECT NU_NUME_CONV, CD_NIT_EPS_CONV, FE_INIC_CONV, FE_FINA_CONV,
       vigente = CASE WHEN (FE_INIC_CONV IS NULL OR FE_INIC_CONV <= GETDATE())
                       AND (FE_FINA_CONV IS NULL OR FE_FINA_CONV >= GETDATE()) THEN 'sí' ELSE 'NO' END
  FROM dbo.CONVENIOS
 WHERE NU_NUME_CONV IN (26, 467, 473, 475, 476)
 ORDER BY NU_NUME_CONV;
GO

/* ── 3. Turnos de los médicos de medicina general el 22 y el 23 ──────────────── */
SELECT LTRIM(RTRIM(CD_MED_TUME)) AS medico, CAST(FE_FECH_TUME AS date) AS dia, COUNT(*) AS turnos
  FROM dbo.TURNOS_MEDICOS
 WHERE LTRIM(RTRIM(CD_MED_TUME)) IN ('RU70','RU62','MDD2','RU71','MD08','RU66','149','AP04','RU69','RU67')
   AND FE_FECH_TUME >= '20261022' AND FE_FECH_TUME < '20261024'
 GROUP BY LTRIM(RTRIM(CD_MED_TUME)), CAST(FE_FECH_TUME AS date)
 ORDER BY dia, medico;
GO

/* ── 4. PARA MAÑANA, después de la primera reserva: las citas que creó AgenIA ──
   Van marcadas en DE_DESC_CIT («ASIGNADA POR WHATSAPP» / «… POR TELEGRAM»).
   Cada una debe verse OCUPADA en la Agenda de CNT, con su consultorio y convenio. */
SELECT CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT, NU_HIST_PAC_CIT,
       NU_NUME_CONV_CIT, CD_CODI_CONS_CIT, CD_CODI_ESP_CIT, NU_DURA_CIT, DE_DESC_CIT, FE_ELAB_CIT
  FROM dbo.CITAS_MEDICAS
 WHERE DE_DESC_CIT LIKE 'ASIGNADA POR%'
   AND FE_ELAB_CIT >= CAST(GETDATE() AS date)
 ORDER BY FE_ELAB_CIT;
GO

/* ── 5. Citas con FE_HORA_CIT en un formato que el agente no lee ──────────────
   El agente solo entiende 'YYYY/MM/DD HH:MM' (con espacios alrededor). Una cita
   con otro formato no llega a AgenIA, no le cierra el cupo y la revisión de cruce
   la salta: AgenIA podría ofrecer esa misma hora. La reconciliación del
   2026-10-21 omitió 93 así en los próximos 90 días.
   ESPERADO: ninguna de medicina general (S39141) de un médico en «WhatsApp ON».
   Si las hay, avisar antes de encender «Agendar» con la hora cruda que aparece. */
SELECT LTRIM(RTRIM(CD_CODI_MED_CIT)) AS medico,
       '[' + CAST(FE_HORA_CIT AS varchar(40)) + ']' AS hora_cruda,
       CAST(FE_FECH_CIT AS date) AS dia,
       LTRIM(RTRIM(CD_CODI_SER_CIT)) AS servicio,
       NU_ESTA_CIT, FE_ELAB_CIT
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= CAST(GETDATE() AS date)
   AND FE_FECH_CIT < DATEADD(day, 91, CAST(GETDATE() AS date))
   AND LTRIM(RTRIM(CAST(FE_HORA_CIT AS varchar(40))))
       NOT LIKE '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9] [0-9][0-9]:[0-9][0-9]'
 ORDER BY CASE WHEN LTRIM(RTRIM(CD_CODI_SER_CIT)) = 'S39141' THEN 0 ELSE 1 END, dia, medico;
GO

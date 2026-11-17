/* =============================================================================
   CITAS DE AGENIA QUE RECEPCIÓN VE COMO «PARTICULAR» O SIN SU CONVENIO
   Base objetivo: ESEHSVP — SOLO LECTURA (solo SELECT; no cambia nada)
   =============================================================================

   Contexto (2026-11-17). Una encuesta del chat dice: «la semana pasada pedí una
   cita por este medio, y se demoraron mucho para activar la cita en recepción.
   Aparecía registrada como particular». En AgenIA esa cita (9-nov, agendada por
   WhatsApp el 5-nov) salió con Salud Total contributivo, o sea con el convenio
   476 y no con el 26 de particulares.

   La aplicación del hospital saca la EPS del paciente de R_PAC_EPS y el
   desplegable de convenios de R_PAC_CONV (97,5 % de las citas usan un convenio
   de esa lista; ESTADO.md, «R_PAC_CONV es el desplegable»). AgenIA no escribe
   ninguna de las dos: escribe el convenio en la cita. Si el convenio de la cita
   no está en la lista del paciente, recepción no lo encuentra al admitir.

   Primera corrida (2026-11-17, sin documento en la PARTE A):
     · Por la regla de «historia abierta en los mismos dos minutos que su primera
       cita de AgenIA», AgenIA no ha creado ningún paciente; las 372 citas de
       AgenIA son de pacientes que ya existían. Esa regla no ve el caso en que la
       primera cita de AgenIA la rechazó el hospital y la siguiente entró minutos
       después (el paciente se crea antes de revisar el turno): por eso la PARTE B
       ahora pregunta a AUDITOR quién abrió cada historia.
     · 11 de esas 372 citas llevan un convenio que no está en la lista del
       paciente, y 4 salieron con el 26 (particulares).

   Segunda corrida (2026-11-17, con esta versión, sin documento en la PARTE A):
     · B1: 0 altas de AgenIA en AUDITOR desde el 1-oct. B2: las dos historias
       abiertas desde entonces tienen hora 00:00:00, la que escribe la aplicación
       del hospital (AgenIA escribe la hora exacta): AgenIA no creó pacientes.
     · B4: la cita de la encuesta salió con 476 (STCONTRIB), coincide con su
       afiliación (Salud Total, código 07 = cotizante), sigue con 476 y quedó
       en estado 1 (atendida), pero el 476 no está entre los 113 convenios de su
       lista. De las 11 fuera de lista, 9 son contributivo (473 Sura, 476 Salud
       Total). Las 4 particulares son de personas con Sura o Nueva EPS en el
       hospital, y 3 quedaron en estado 2 (no asistió).

   Qué se quiere saber:
     A. El caso de la encuesta: cómo quedó la ficha, su afiliación y convenios,
        con qué convenio quedó la cita y quién la tocó.
     B. El alcance: si AgenIA ha creado pacientes, y el detalle de las citas de
        AgenIA cuyo convenio no está en la lista del paciente o que salieron
        como particulares.

   Cómo se corre: en SSMS, con una cuenta que pueda leer R_PAC_CONV (agenia_sync
   no tiene ese permiso). Para la PARTE A, escriba el documento del caso en
   @documento (no se guarda en el repositorio). Pegue en el chat el resultado de
   cada bloque.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

DECLARE @documento varchar(20) = '';   -- ← el documento del caso de la encuesta

/* ── PARTE A — el caso de la encuesta ─────────────────────────────────────── */

-- A1. La ficha: tipo de documento, teléfono, dirección y cuándo se abrió.
SELECT p.NU_HIST_PAC, p.NU_TIPD_PAC, td.TX_NOMB_TDOC AS tipo_doc,
       p.NO_NOMB_PAC, p.DE_PRAP_PAC, p.FE_NACI_PAC, p.NU_SEXO_PAC,
       p.DE_TELE_PAC, p.DE_DIRE_PAC, p.CD_CODI_MUNI_PAC, p.FE_HIST_PAC
  FROM dbo.PACIENTES p
  LEFT JOIN dbo.TIPO_DOCUMENTO td ON td.NU_CODIGO_TDOC = p.NU_TIPD_PAC
 WHERE p.NU_HIST_PAC = @documento;

-- A2. Su afiliación, con el nombre de la EPS. Puede haber varias filas: el HIS
--     acumula afiliaciones viejas (ESTADO.md, «R_PAC_EPS no sirve para validar»).
SELECT r.CD_NIT_EPS_RPE, e.NO_NOMB_EPS, r.CD_CODI_REG_RPE, r.NU_AFIL_RPE,
       r.NU_ESTA_RPE, r.TX_ACTI_RPE, r.CD_CARN_RPE
  FROM dbo.R_PAC_EPS r
  LEFT JOIN dbo.EPS e ON e.CD_NIT_EPS = r.CD_NIT_EPS_RPE
 WHERE r.NU_HIST_PAC_RPE = @documento;

-- A3. Sus convenios (el desplegable de la aplicación al admitir). ¿Está el 476?
SELECT r.NU_NUME_CONV_RPC, c.CD_CODI_CONV
  FROM dbo.R_PAC_CONV r
  LEFT JOIN dbo.CONVENIOS c ON c.NU_NUME_CONV = r.NU_NUME_CONV_RPC
 WHERE r.NU_HIST_PAC_RPC = @documento
 ORDER BY r.NU_NUME_CONV_RPC;

-- A4. Sus citas y su convenio (476 = Salud Total contributivo; 26 = particulares).
--     Si la del 9-nov dice 476, AgenIA la mandó bien; si dice 26, alguien la cambió.
SELECT cm.FE_HORA_CIT, cm.NU_ESTA_CIT, cm.NU_NUME_CONV_CIT, c.CD_CODI_CONV,
       cm.DE_DESC_CIT, cm.FE_ELAB_CIT
  FROM dbo.CITAS_MEDICAS cm
  LEFT JOIN dbo.CONVENIOS c ON c.NU_NUME_CONV = cm.NU_NUME_CONV_CIT
 WHERE cm.NU_HIST_PAC_CIT = @documento
 ORDER BY cm.FE_HORA_CIT;

-- A5. Quién tocó esa historia desde el 4-nov. La aplicación no audita R_PAC_EPS,
--     así que la afiliación puede no aparecer aquí aunque recepción la haya escrito.
SELECT AudFech, AudUser, AudTabla, AudTrans, AudVerExe,
       LEFT(CAST(AudDesc AS varchar(max)), 200) AS AudDesc
  FROM dbo.AUDITOR
 WHERE AudFech >= '20261104'
   AND @documento <> ''
   AND CAST(AudDesc AS varchar(max)) LIKE '%' + @documento + '%'
 ORDER BY AudFech;

/* ── PARTE B — el alcance ─────────────────────────────────────────────────── */

-- B1. ¿AgenIA ha creado pacientes? Cada alta de AgenIA deja en AUDITOR
--     «AgenIA — alta de paciente: documento=…» con el usuario AGENIA (el permiso
--     para auditar está concedido en ESEHSVP desde octubre).
SELECT altas_de_agenia = COUNT(*), primera = MIN(AudFech), ultima = MAX(AudFech)
  FROM dbo.AUDITOR
 WHERE AudFech >= '20261001'
   AND AudUser = 'AGENIA'
   AND AudTabla = 'PACIENTES';

-- B2. Pacientes con citas de AgenIA cuya historia se abrió desde el 1-oct, y
--     quién la abrió (la escritura de PACIENTES más cercana en AUDITOR, ±2 min;
--     mire AudDesc para confirmar que es la de ese paciente).
WITH agenia AS (
    SELECT DISTINCT cm.NU_HIST_PAC_CIT AS hist
      FROM dbo.CITAS_MEDICAS cm
     WHERE RTRIM(cm.DE_DESC_CIT) IN ('ASIGNADA POR WHATSAPP', 'ASIGNADA POR TELEGRAM')
)
SELECT p.NU_HIST_PAC AS documento, td.TX_NOMB_TDOC AS tipo_doc,
       DATEDIFF(year, p.FE_NACI_PAC, GETDATE()) AS edad_aprox,
       p.FE_HIST_PAC AS historia_abierta,
       au.AudUser AS abrio, LEFT(CAST(au.AudDesc AS varchar(max)), 120) AS AudDesc,
       tiene_afiliacion = CASE WHEN EXISTS (SELECT 1 FROM dbo.R_PAC_EPS r
                               WHERE r.NU_HIST_PAC_RPE = p.NU_HIST_PAC) THEN 'SI' ELSE 'NO' END,
       tiene_convenios  = CASE WHEN EXISTS (SELECT 1 FROM dbo.R_PAC_CONV r
                               WHERE r.NU_HIST_PAC_RPC = p.NU_HIST_PAC) THEN 'SI' ELSE 'NO' END,
       tiene_telefono   = CASE WHEN NULLIF(LTRIM(RTRIM(p.DE_TELE_PAC)), '') IS NULL
                               THEN 'NO' ELSE 'SI' END
  FROM dbo.PACIENTES p
  JOIN agenia a ON a.hist = p.NU_HIST_PAC
  LEFT JOIN dbo.TIPO_DOCUMENTO td ON td.NU_CODIGO_TDOC = p.NU_TIPD_PAC
  OUTER APPLY (
      SELECT TOP 1 x.AudUser, x.AudDesc
        FROM dbo.AUDITOR x
       WHERE x.AudTabla = 'PACIENTES'
         AND x.AudFech BETWEEN DATEADD(minute, -2, p.FE_HIST_PAC)
                           AND DATEADD(minute, 2, p.FE_HIST_PAC)
       ORDER BY ABS(DATEDIFF(second, x.AudFech, p.FE_HIST_PAC))
  ) au
 WHERE p.FE_HIST_PAC >= '20261001'
 ORDER BY p.FE_HIST_PAC DESC;

-- B3. Citas de AgenIA cuyo convenio NO está en la lista de convenios del
--     paciente (las que recepción no encuentra en el desplegable al admitir), y
--     las que salieron como particulares. Resumen.
--     (Las marcas con EXISTS se calculan antes de sumar: SQL Server no deja
--     agregar una expresión que contiene una subconsulta, error 130.)
WITH marcadas AS (
    SELECT fuera      = CASE WHEN EXISTS (SELECT 1 FROM dbo.R_PAC_CONV r
                                WHERE r.NU_HIST_PAC_RPC = cm.NU_HIST_PAC_CIT
                                  AND r.NU_NUME_CONV_RPC = cm.NU_NUME_CONV_CIT) THEN 0 ELSE 1 END,
           particular = CASE WHEN cm.NU_NUME_CONV_CIT = 26 THEN 1 ELSE 0 END
      FROM dbo.CITAS_MEDICAS cm
     WHERE RTRIM(cm.DE_DESC_CIT) IN ('ASIGNADA POR WHATSAPP', 'ASIGNADA POR TELEGRAM')
)
SELECT citas                   = COUNT(*),
       convenio_fuera_de_lista = SUM(fuera),
       con_convenio_particular = SUM(particular)
  FROM marcadas;

-- B4. El detalle de esas citas, de la más reciente a la más antigua: el convenio
--     de la cita, cuántos convenios tiene el paciente en su lista y sus
--     afiliaciones marcadas como vigentes (EPS/régimen).
SELECT cm.NU_HIST_PAC_CIT AS documento, cm.FE_HORA_CIT AS cita, cm.NU_ESTA_CIT AS estado,
       cm.NU_NUME_CONV_CIT AS conv, c.CD_CODI_CONV AS convenio_de_la_cita,
       cm.FE_ELAB_CIT AS escrita,
       convenios_en_su_lista = (SELECT COUNT(*) FROM dbo.R_PAC_CONV r
                                 WHERE r.NU_HIST_PAC_RPC = cm.NU_HIST_PAC_CIT),
       afiliaciones_vigentes = STUFF((
           SELECT ', ' + RTRIM(ISNULL(e.NO_NOMB_EPS, r.CD_NIT_EPS_RPE)) + ' / ' + RTRIM(r.CD_CODI_REG_RPE)
             FROM dbo.R_PAC_EPS r
             LEFT JOIN dbo.EPS e ON e.CD_NIT_EPS = r.CD_NIT_EPS_RPE
            WHERE r.NU_HIST_PAC_RPE = cm.NU_HIST_PAC_CIT
              AND r.NU_ESTA_RPE = 1 AND r.TX_ACTI_RPE = 'S'
              FOR XML PATH(''), TYPE).value('.', 'varchar(max)'), 1, 2, ''),
       p.FE_HIST_PAC AS historia_abierta
  FROM dbo.CITAS_MEDICAS cm
  JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = cm.NU_HIST_PAC_CIT
  LEFT JOIN dbo.CONVENIOS c ON c.NU_NUME_CONV = cm.NU_NUME_CONV_CIT
 WHERE RTRIM(cm.DE_DESC_CIT) IN ('ASIGNADA POR WHATSAPP', 'ASIGNADA POR TELEGRAM')
   AND (cm.NU_NUME_CONV_CIT = 26
        OR NOT EXISTS (SELECT 1 FROM dbo.R_PAC_CONV r
                        WHERE r.NU_HIST_PAC_RPC = cm.NU_HIST_PAC_CIT
                          AND r.NU_NUME_CONV_RPC = cm.NU_NUME_CONV_CIT))
 ORDER BY cm.FE_ELAB_CIT DESC;

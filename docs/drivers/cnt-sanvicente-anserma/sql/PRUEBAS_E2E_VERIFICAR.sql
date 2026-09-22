/* =============================================================================
   PRUEBAS E2E — VERIFICAR EN EL HIS QUÉ QUEDÓ REGISTRADO
   Base objetivo: PRUEBAS.   ✅ ESTRICTAMENTE SOLO LECTURA — no escribe nada.
   =============================================================================

   PARA QUÉ. Los escenarios de `PRUEBAS_E2E.md` dicen en prosa qué debería quedar en
   el hospital («en el HIS aparece la cita con DE_DESC_CIT = ASIGNADA POR WHATSAPP»).
   Este guion lo enseña, para no tener que escribir consultas a mano en medio de la
   prueba. Se puede correr CUANTAS VECES SE QUIERA y en cualquier momento: no escribe.

   Las cinco partes responden cinco preguntas distintas:

     1 — ¿Qué pacientes sintéticos hay, y quién los creó?
     2 — ¿Qué citas hay ahora mismo, y quién las escribió?
     3 — Las que escribió AgenIA, CAMPO A CAMPO: ¿con el convenio correcto? Es la
         parte que decide la facturación, y la única forma de saber si una cita
         «quedó registrada» de verdad y no solo presente.
     4 — ¿Qué se canceló, y con qué motivo?
     5 — El cuadro de mando: por escenario, lo que se espera contra lo que hay.

   ⚠️ La PARTE 5 se lee AL FINAL de la campaña (después de las fases 3 a 8 de
   `PRUEBAS_E2E.md`, antes de limpiar). A media prueba va a marcar REVISAR en los
   escenarios que todavía no se han hecho, y eso no es un fallo. Las partes 1 a 4
   sirven en cualquier momento.

   CÓMO SE USA. Correr primero el PREÁMBULO (crea dos tablas temporales) y luego las
   partes, juntas o de una en una. Cada parte es un lote independiente a propósito:
   si en este hospital alguna tabla de catálogo tuviera otro nombre de columna, falla
   esa parte sola y las demás siguen dando información.
   ============================================================================= */

USE PRUEBAS;
GO
SET NOCOUNT ON;
GO

/* ── PREÁMBULO — los documentos sintéticos y la marca de AgenIA ───────────────
   En tablas TEMPORALES (#) y no en variables (@) para que sobrevivan a los GO y
   cada parte se pueda correr suelta. */
IF OBJECT_ID('tempdb..#docs') IS NOT NULL DROP TABLE #docs;
CREATE TABLE #docs (n int PRIMARY KEY, doc varchar(20), doc_his varchar(20));
INSERT #docs (n, doc, doc_his)
SELECT n, d, CASE WHEN n = 8 THEN '0' + d ELSE d END
FROM (SELECT n, doc = '99900000' + RIGHT('0' + CAST(n AS varchar(2)), 2)
      FROM (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),
                   (11),(12),(13),(14),(15),(16),(17),(18),(19),(20),
                   (21),(22)) v(n)) x(n, d);

-- La marca con la que se distingue quién escribió cada cita. 'ASIGNADA POR WHATSAPP'
-- es la de AgenIA (igualdad EXACTA: así la reconoce el propio agente); el resto de
-- las citas de prueba las escribieron los guiones, imitando al hospital.
IF OBJECT_ID('tempdb..#ctx') IS NOT NULL DROP TABLE #ctx;
CREATE TABLE #ctx (marca_agenia varchar(30), marca_guion varchar(30));
INSERT #ctx VALUES ('ASIGNADA POR WHATSAPP', 'PRUEBA E2E AGENIA%');
GO

/* =============================================================================
   PARTE 1 — los pacientes sintéticos: ¿están, y quién los creó?
   El 12 NO lo escribe PREPARAR: si aparece, lo creó el driver al reservar por
   WhatsApp, que es justo lo que ese escenario prueba. El teléfono se muestra
   enmascarado para poder pegar el resultado sin pasear un número.
   ============================================================================= */
PRINT '=== PARTE 1 — pacientes sintéticos en PACIENTES ===';

SELECT escenario   = d.n,
       documento   = d.doc_his,
       existe      = CASE WHEN p.NU_HIST_PAC IS NULL THEN 'NO' ELSE 'sí' END,
       nombre      = LTRIM(RTRIM(ISNULL(p.NO_NOMB_PAC, '') + ' ' + ISNULL(p.NO_SGNO_PAC, '')
                     + ' ' + ISNULL(p.DE_PRAP_PAC, '') + ' ' + ISNULL(p.DE_SGAP_PAC, ''))),
       telefono    = CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(p.DE_TELE_PAC, ''))), '') IS NULL
                            THEN '(sin teléfono)'
                          WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
                            THEN STUFF(LTRIM(RTRIM(p.DE_TELE_PAC)), 4, 3, '***')
                          ELSE '(' + LTRIM(RTRIM(p.DE_TELE_PAC)) + ')' END,
       nacimiento  = CONVERT(varchar(10), p.FE_NACI_PAC, 23),
       sexo        = CASE p.NU_SEXO_PAC WHEN 1 THEN 'M' WHEN 0 THEN 'F' ELSE '?' END,
       lo_creo     = CASE WHEN p.NU_HIST_PAC IS NULL THEN '—'
                          WHEN d.n = 12 THEN 'el DRIVER (escenario 12)'
                          ELSE 'PREPARAR' END
  FROM #docs d
  LEFT JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = d.doc_his
 ORDER BY d.n;
GO

/* =============================================================================
   PARTE 2 — las citas que hay AHORA, y quién las escribió
   ============================================================================= */
PRINT '';
PRINT '=== PARTE 2 — citas de los documentos sintéticos ===';

SELECT escenario = d.n,
       documento = c.NU_HIST_PAC_CIT,
       medico    = c.CD_CODI_MED_CIT,
       hora      = c.FE_HORA_CIT,
       estado    = CASE c.NU_ESTA_CIT WHEN 0 THEN '0 vigente'
                                      WHEN 1 THEN '1 atendida'
                                      WHEN 2 THEN '2 inasistencia'
                                      ELSE CAST(c.NU_ESTA_CIT AS varchar(3)) END,
       la_escribio = CASE WHEN c.DE_DESC_CIT = x.marca_agenia THEN '>>> AGENIA (WhatsApp)'
                          WHEN c.DE_DESC_CIT LIKE x.marca_guion THEN 'un guion (imita al hospital)'
                          ELSE 'OTRO — revisar' END,
       elaborada = CONVERT(varchar(19), c.FE_ELAB_CIT, 120),
       descripcion = c.DE_DESC_CIT
  FROM dbo.CITAS_MEDICAS c
  JOIN #docs d ON d.doc_his = c.NU_HIST_PAC_CIT
 CROSS JOIN #ctx x
 ORDER BY d.n, c.FE_FECH_CIT, c.FE_HORA_CIT;
GO

/* =============================================================================
   PARTE 3 — las citas de AGENIA, campo a campo
   Es la verificación que de verdad importa: que la cita esté NO basta, tiene que
   estar BIEN. El convenio sale de la EPS + el régimen + si el servicio es de PyP
   (MAPEO_HIS.md §2.3), y es el campo que determina a quién se le factura: si sale
   el equivocado, la cita existe y la factura se glosa.
   Compare cada fila con la referencia de abajo, que son citas REALES recientes de
   los mismos médicos. La tabla de convenios homologada vive en `mapping.json`.
   ============================================================================= */
PRINT '';
PRINT '=== PARTE 3 — lo que AgenIA escribió, campo a campo ===';

SELECT documento   = c.NU_HIST_PAC_CIT,
       medico      = c.CD_CODI_MED_CIT,
       nombre_med  = LTRIM(RTRIM(ISNULL(m.NO_NOMB_MED, '') + ' ' + ISNULL(m.TX_PRAPEL_MED, ''))),
       hora        = c.FE_HORA_CIT,
       servicio    = c.CD_CODI_SER_CIT,
       nombre_ser  = s.NO_NOMB_SER,
       especialidad = c.CD_CODI_ESP_CIT,
       convenio    = c.NU_NUME_CONV_CIT,
       consultorio = c.CD_CODI_CONS_CIT,
       centro_costo = c.CD_CODI_CECO_CIT,
       lugar       = c.CD_CODI_LUAT_CIT,
       duracion    = c.NU_DURA_CIT,
       primera_vez = c.NU_PRIM_CIT,
       elaborada   = CONVERT(varchar(19), c.FE_ELAB_CIT, 120),
       solicitada  = CONVERT(varchar(19), c.FE_SOLI_CIT, 120)
  FROM dbo.CITAS_MEDICAS c
  JOIN #docs d ON d.doc_his = c.NU_HIST_PAC_CIT
 CROSS JOIN #ctx x
  LEFT JOIN dbo.MEDICOS   m ON m.CD_CODI_MED = c.CD_CODI_MED_CIT
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
 WHERE c.DE_DESC_CIT = x.marca_agenia
 ORDER BY c.FE_FECH_CIT, c.FE_HORA_CIT;
GO

-- Referencia, al lado: citas REALES recientes de los mismos médicos. Si algún campo
-- de arriba no cuadra con esto, ahí está el problema.
PRINT '';
PRINT '--- Referencia: citas reales recientes de los mismos médicos ---';
SELECT medico = r.CD_CODI_MED_CIT, servicio = r.CD_CODI_SER_CIT, especialidad = r.CD_CODI_ESP_CIT,
       convenio = r.NU_NUME_CONV_CIT, consultorio = r.CD_CODI_CONS_CIT,
       centro_costo = r.CD_CODI_CECO_CIT, lugar = r.CD_CODI_LUAT_CIT, duracion = r.NU_DURA_CIT,
       hora = r.FE_HORA_CIT
  FROM dbo.CITAS_MEDICAS r
 CROSS JOIN #ctx x
 WHERE r.CD_CODI_MED_CIT IN (SELECT DISTINCT c.CD_CODI_MED_CIT
                               FROM dbo.CITAS_MEDICAS c
                               JOIN #docs d ON d.doc_his = c.NU_HIST_PAC_CIT
                              WHERE c.DE_DESC_CIT = (SELECT marca_agenia FROM #ctx))
   AND (r.DE_DESC_CIT IS NULL
        OR (r.DE_DESC_CIT NOT LIKE x.marca_guion AND r.DE_DESC_CIT <> x.marca_agenia))
   AND r.FE_FECH_CIT >= DATEADD(day, -60, CAST(GETDATE() AS date))
 ORDER BY r.CD_CODI_MED_CIT, r.FE_FECH_CIT DESC;
GO

/* =============================================================================
   PARTE 3b — el convenio, con su nombre del catálogo (OPCIONAL)
   Aparte porque depende de `CONVENIOS`, que es una tabla de facturación: si en este
   hospital tuviera otro nombre de columna, falla esta parte sola.
   ============================================================================= */
PRINT '';
PRINT '=== PARTE 3b — el nombre del convenio (opcional) ===';
IF COL_LENGTH('dbo.CONVENIOS', 'NU_NUME_CONV') IS NULL
    PRINT '   (se omite: dbo.CONVENIOS no tiene la columna NU_NUME_CONV en esta base)';
ELSE
    SELECT documento = c.NU_HIST_PAC_CIT,
           hora      = c.FE_HORA_CIT,
           convenio  = c.NU_NUME_CONV_CIT,
           nombre_convenio = cv.CD_CODI_CONV
      FROM dbo.CITAS_MEDICAS c
      JOIN #docs d ON d.doc_his = c.NU_HIST_PAC_CIT
      LEFT JOIN dbo.CONVENIOS cv ON cv.NU_NUME_CONV = c.NU_NUME_CONV_CIT
     WHERE c.DE_DESC_CIT = (SELECT marca_agenia FROM #ctx)
     ORDER BY c.FE_HORA_CIT;
GO

/* =============================================================================
   PARTE 4 — las cancelaciones, con su motivo
   El hospital cancela con DELETE + INSERT en CITAS_ANULADAS. Aquí se ve quién
   canceló qué y con qué motivo del catálogo del hospital.
   ============================================================================= */
PRINT '';
PRINT '=== PARTE 4 — cancelaciones (CITAS_ANULADAS) ===';

SELECT escenario = d.n,
       documento = a.NU_HIST_PAC_CIAN,
       medico    = a.CD_CODI_MED_CIAN,
       hora      = a.FE_HORA_CIAN,
       motivo    = a.CD_CODI_MOTI_CIAN,
       que_motivo = mo.DE_DESC_MOTI,
       la_cancelo = CASE WHEN a.DE_DESC_CIAN = x.marca_agenia THEN '>>> AGENIA (el paciente por WhatsApp)'
                         WHEN a.DE_DESC_CIAN LIKE x.marca_guion THEN 'un guion (imita al hospital)'
                         ELSE 'OTRO — revisar' END,
       observacion = a.TX_OBSE_CIAN,
       anulada_el  = CONVERT(varchar(19), a.FE_ELAB_CIAN, 120)
  FROM dbo.CITAS_ANULADAS a
  JOIN #docs d ON d.doc_his = a.NU_HIST_PAC_CIAN
 CROSS JOIN #ctx x
  LEFT JOIN dbo.MOTIVOANUL mo ON mo.CD_CODI_MOTI = a.CD_CODI_MOTI_CIAN
 ORDER BY d.n, a.FE_ELAB_CIAN;
GO

/* =============================================================================
   PARTE 5 — CUADRO DE MANDO (leer AL FINAL de la campaña)
   Lo que cada escenario tiene que haber dejado en el HIS, contra lo que hay.
   ============================================================================= */
PRINT '';
PRINT '=== PARTE 5 — cuadro de mando: esperado contra real ===';

DECLARE @esp TABLE (n int PRIMARY KEY, his int, agenia int, anul int, nota varchar(200));
INSERT @esp (n, his, agenia, anul, nota) VALUES
 (1,  2, 0, 0, 'dos citas del hospital (la del día de prueba y la del recordatorio). AgenIA NO escribe ninguna: eso es el anti-eco'),
 (2,  1, 0, 0, 'la cita del médico sin homologar sigue ahí, intacta'),
 (3,  1, 0, 0, 'la cita con la hora ilegible sigue ahí, sin tocar'),
 (4,  0, 0, 1, 'el PASO A la canceló: sale de CITAS_MEDICAS y entra en CITAS_ANULADAS'),
 (5, 60, 0, 0, 'las 60 citas pasadas atendidas'),
 (6,  1, 0, 0, 'cita atendida (estado 1)'),
 (7,  1, 0, 0, 'cita con inasistencia (estado 2)'),
 (8,  1, 0, 0, 'la cita está a nombre de 09990000008, con el cero a la izquierda'),
 (9,  0, 0, 0, 'el 9 nunca tuvo cita: su cupo lo ocupa el 19'),
 (10, 0, 0, 0, 'abandonó la conversación: el hospital no debe tener NADA suyo'),
 (11, 1, 0, 0, 'la cita a 200 días sigue ahí'),
 (12, 0, 1, 0, 'el driver creó al paciente Y la cita (ver la PARTE 1: debe existir en PACIENTES)'),
 (13, 0, 1, 0, 'el camino feliz: una cita de AgenIA, y UNA sola fila en PACIENTES'),
 (14, 0, 1, 0, 'la reserva llegó al arrancar el agente'),
 (15, 0, 0, 0, 'la reserva chocó con el cupo que tomó el hospital: NUNCA entró. Su cupo está a nombre del 19'),
 (16, 0, 0, 0, 'el PASO C la borró SIN pasar por CITAS_ANULADAS: cero y cero es el escenario'),
 (17, 0, 0, 1, 'el paciente canceló por WhatsApp: el driver la anuló con motivo'),
 (18, 0, 0, 0, 'lista de espera: no deja rastro en el HIS. 1 en «de_agenia» si el probador aceptó la oferta del 17'),
 (19, 2, 0, 0, 'la del cupo 9/19 y la que el PASO B puso a su nombre'),
 (20, 0, 0, 0, 'el padrón lo rechazó: el bot no agendó nada'),
 (21, 1, 0, 0, 'la cita del PASO E (el gemelo del teléfono)'),
 (22, 1, 0, 0, 'la cita del PASO D: el cupo se ocupó en AgenIA pero la cita es del hospital');

;WITH hay AS (
    SELECT d.n,
           his    = SUM(CASE WHEN c.DE_DESC_CIT LIKE x.marca_guion THEN 1 ELSE 0 END),
           agenia = SUM(CASE WHEN c.DE_DESC_CIT = x.marca_agenia THEN 1 ELSE 0 END),
           -- Una cita de un documento sintético que no la escribió ni un guion ni
           -- AgenIA. Tiene que ser 0: si no, alguien más metió mano.
           otras  = SUM(CASE WHEN c.NU_HIST_PAC_CIT IS NOT NULL
                              AND (c.DE_DESC_CIT IS NULL
                                   OR (c.DE_DESC_CIT <> x.marca_agenia
                                       AND c.DE_DESC_CIT NOT LIKE x.marca_guion))
                             THEN 1 ELSE 0 END)
      FROM #docs d
     CROSS JOIN #ctx x
      LEFT JOIN dbo.CITAS_MEDICAS c ON c.NU_HIST_PAC_CIT = d.doc_his
     GROUP BY d.n
), anuladas AS (
    SELECT d.n, anul = COUNT(a.NU_HIST_PAC_CIAN)
      FROM #docs d
      LEFT JOIN dbo.CITAS_ANULADAS a ON a.NU_HIST_PAC_CIAN = d.doc_his
     GROUP BY d.n
)
SELECT escenario = e.n,
       veredicto = CASE WHEN h.his = e.his AND h.agenia = e.agenia AND an.anul = e.anul
                        THEN 'OK' ELSE '>>> REVISAR' END,
       del_hospital = CAST(h.his AS varchar(3)) + ' de ' + CAST(e.his AS varchar(3)),
       de_agenia    = CAST(h.agenia AS varchar(3)) + ' de ' + CAST(e.agenia AS varchar(3)),
       canceladas   = CAST(an.anul AS varchar(3)) + ' de ' + CAST(e.anul AS varchar(3)),
       ajenas       = h.otras,
       que_deberia_haber = e.nota
  FROM @esp e
  JOIN hay h       ON h.n  = e.n
  JOIN anuladas an ON an.n = e.n
 ORDER BY e.n;

PRINT '';
PRINT '   «ajenas» tiene que ser 0 en todas las filas: una cita de un documento sintético';
PRINT '   que no la escribió ni un guion ni AgenIA no debería existir.';
PRINT '   A media campaña, un REVISAR solo dice que ese escenario aún no se ha hecho.';
GO

-- Las temporales se quedan mientras dure la sesión de SSMS, para poder volver a
-- correr cualquier parte. Se van al cerrarla; o a mano:
-- DROP TABLE #docs; DROP TABLE #ctx;

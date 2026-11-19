/* =============================================================================
   ¿SE PUEDE SABER QUIÉN ES DEL CAMPO CON LA «ZONA» DE LA FICHA DEL PACIENTE?
   Base objetivo: ESEHSVP — SOLO LECTURA (solo SELECT; no cambia nada)
   =============================================================================

   Contexto (2026-11-19). El hospital quiere abrir los sábados al asistente, con
   el 50 % de la agenda de ese día y solo para personas del campo. Hoy los
   sábados están bloqueados para el asistente («Los sábados están dedicados a las
   personas del campo», Días sin citas, 22-oct). La idea es reconocer a la persona
   del campo por el campo «Zona» de la ficha del paciente (pestaña «Datos
   Complementarios»: URBANO / RURAL).

   Lo que ya se sabe del lado de AgenIA:
     · PACIENTES tiene CD_CODI_ZORE_PAC varchar(1) (zona de residencia) y
       CD_CODI_BAR_PAC varchar(3) (barrio). Esquema confirmado columna por columna
       contra ESEHSVP el 2026-09-01. Nadie ha medido cómo están llenas.
     · agenia_sync ya puede leer PACIENTES; no puede leer BARRIO.
     · AgenIA no escribe la zona: un paciente que crea AgenIA queda sin zona
       (desde el 1-oct AgenIA no ha creado ninguno).

   Qué se quiere saber:
     0. Si hay otras columnas o tablas de zona, y las columnas de BARRIO.
     A. Que la «Zona» del formulario es CD_CODI_ZORE_PAC (con un paciente conocido).
     B. Qué valores tiene y qué tan llena está, en todos y en los que vienen a cita.
     C. LA PRUEBA DE FONDO: si los sábados son para el campo, los pacientes del
        sábado deberían ser casi todos «rurales». Si no, o el campo no es fiable
        o los sábados no se reparten por zona.
     D. Cuántos de los que agendan por el chat son rurales.
     E. Si la zona del paciente coincide con la de su barrio.
     F. Si el catálogo de barrios tiene veredas (zona rural).
     G. Si recepción llena la zona en las historias nuevas.

   Cómo se corre: en SSMS, con una cuenta del hospital que pueda leer BARRIO
   (agenia_sync no tiene ese permiso). Cada bloque va en su propio lote (GO): si
   uno falla, los demás corren igual. Para la PARTE A escriba en @documento el
   documento de un paciente cuya ficha conozca (no se guarda en el repositorio).
   Pegue en el chat el resultado de cada bloque, y los mensajes de error si los
   hay. Fechas de las citas: FE_FECH_CIT, o la fecha de FE_HORA_CIT
   ('YYYY/MM/DD HH:MM') si falta. Se excluye el estado 3 (anulada), como el
   informe oficial del HIS. Sábado = DATEDIFF(day, '19000106', fecha) % 7 = 0
   (el 6 de enero de 1900 fue sábado; no depende de DATEFIRST ni del idioma).

   2026-11-19, 2.ª versión: la 1.ª usaba columnas de BARRIO con nombres
   adivinados (CD_CODI_MUN, CD_CODI_DPT) que no existen (Msg 207), y con eso
   fallaba todo el lote. Ahora BARRIO se cruza solo por CD_CODI_BAR, el bloque 0
   lista sus columnas reales y cada bloque va aparte.

   Resultado de la 2.ª versión (2026-11-19, ESEHSVP):
     · La zona está llena en el 99,9 % de los 79.250 pacientes (U 64,9 %,
       R 35,0 %, 71 vacías) y en el 100 % de los 15.856 con cita en 12 meses
       (U 54,3 %, R 45,7 %). Recepción la llena en todas las historias nuevas.
     · Coincide con la zona del barrio en el 97,1 % de los pacientes de Anserma
       que tienen barrio (el catálogo trae 60 veredas con R y 39 barrios con U).
     · Sábados (6 meses): 76,6 % de las citas son de pacientes rurales, contra
       37,2 % de lunes a viernes; cada sábado entre 65 y 85 %. El hospital no los
       reserva solo para el campo, pero los inclina claramente.
     · De los 367 pacientes que han agendado por el chat, 24 % son rurales.
     · Faltó la PARTE A (sin documento) y el catálogo ZONARESIDENCIA (bloque 0a,
       agregado después). En la columna zona_barrio de E, «(» era «(sin barrio)»
       recortado por ISNULL; ya corregido.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

/* ── 0. Columnas y tablas de zona, y las columnas reales de BARRIO ────────── */
SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH
  FROM INFORMATION_SCHEMA.COLUMNS c
 WHERE c.COLUMN_NAME LIKE '%ZORE%' OR c.COLUMN_NAME LIKE '%ZONA%'
    OR c.TABLE_NAME LIKE '%ZONA%'  OR c.TABLE_NAME LIKE '%VEREDA%'
    OR c.TABLE_NAME = 'BARRIO'
 ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;

-- 0a. El catálogo del desplegable «Zona» de la ficha (qué letra es RURAL).
SELECT * FROM dbo.ZONARESIDENCIA;

-- 0b. ¿El código de barrio se repite? (si sí, el cruce por código no basta)
SELECT codigos = COUNT(DISTINCT CD_CODI_BAR), filas = COUNT(*),
       codigos_repetidos = COUNT(*) - COUNT(DISTINCT CD_CODI_BAR)
  FROM dbo.BARRIO;
GO

/* ── A. La «Zona» del formulario es CD_CODI_ZORE_PAC ──────────────────────── */
DECLARE @documento varchar(20) = '';   -- ← un paciente cuya ficha conozca

SELECT p.NU_HIST_PAC AS documento,
       zona = p.CD_CODI_ZORE_PAC,
       barrio_codigo = p.CD_CODI_BAR_PAC,
       barrio = b.DE_DESC_BAR, zona_del_barrio = b.TX_ZORE_BAR,
       barrios_con_ese_codigo = b.repetidos,
       dpto = p.CD_CODI_DPTO_PAC, muni = p.CD_CODI_MUNI_PAC
  FROM dbo.PACIENTES p
  OUTER APPLY (
      SELECT DE_DESC_BAR = MIN(x.DE_DESC_BAR), TX_ZORE_BAR = MIN(x.TX_ZORE_BAR),
             repetidos = COUNT(*)
        FROM dbo.BARRIO x
       WHERE x.CD_CODI_BAR = p.CD_CODI_BAR_PAC
  ) b
 WHERE p.NU_HIST_PAC = @documento;
GO

/* ── B. Valores y qué tan llena está ──────────────────────────────────────── */
-- B1. Todos los pacientes.
SELECT zona = CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
                   ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END,
       pacientes = COUNT(*),
       pct = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5,1))
  FROM dbo.PACIENTES p
 GROUP BY CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
               ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END
 ORDER BY pacientes DESC;
GO

-- B2. Los que tuvieron cita en los últimos 12 meses (los que de verdad vienen).
WITH citas AS (
    SELECT cm.NU_HIST_PAC_CIT AS hist,
           dia = COALESCE(CAST(cm.FE_FECH_CIT AS date),
                          TRY_CONVERT(date, LEFT(LTRIM(cm.FE_HORA_CIT), 10), 111))
      FROM dbo.CITAS_MEDICAS cm
     WHERE cm.NU_ESTA_CIT <> 3
), activos AS (
    SELECT DISTINCT hist FROM citas
     WHERE dia >= DATEADD(month, -12, CAST(GETDATE() AS date))
)
SELECT zona = CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
                   ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END,
       pacientes = COUNT(*),
       pct = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5,1))
  FROM activos a
  JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = a.hist
 GROUP BY CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
               ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END
 ORDER BY pacientes DESC;
GO

/* ── C. LA PRUEBA DE FONDO: sábados contra lunes a viernes, por zona ──────── */
-- C1. Últimos 6 meses, citas no anuladas, ya pasadas.
WITH citas AS (
    SELECT cm.NU_HIST_PAC_CIT AS hist,
           dia = COALESCE(CAST(cm.FE_FECH_CIT AS date),
                          TRY_CONVERT(date, LEFT(LTRIM(cm.FE_HORA_CIT), 10), 111))
      FROM dbo.CITAS_MEDICAS cm
     WHERE cm.NU_ESTA_CIT <> 3
), marcadas AS (
    SELECT tipo_dia = CASE DATEDIFF(day, '19000106', c.dia) % 7
                        WHEN 0 THEN 'Sábado' WHEN 1 THEN 'Domingo' ELSE 'Lunes a viernes' END,
           zona = CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
                       ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END,
           c.hist
      FROM citas c
      JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = c.hist
     WHERE c.dia >= DATEADD(month, -6, CAST(GETDATE() AS date))
       AND c.dia <  CAST(GETDATE() AS date)
)
SELECT tipo_dia, zona, citas = COUNT(*), pacientes = COUNT(DISTINCT hist),
       pct_del_tipo_de_dia = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY tipo_dia) AS decimal(5,1))
  FROM marcadas
 GROUP BY tipo_dia, zona
 ORDER BY tipo_dia, citas DESC;
GO

-- C2. Los sábados de los últimos 3 meses, uno por uno: cuántas citas de cada zona.
WITH citas AS (
    SELECT cm.NU_HIST_PAC_CIT AS hist,
           dia = COALESCE(CAST(cm.FE_FECH_CIT AS date),
                          TRY_CONVERT(date, LEFT(LTRIM(cm.FE_HORA_CIT), 10), 111))
      FROM dbo.CITAS_MEDICAS cm
     WHERE cm.NU_ESTA_CIT <> 3
)
SELECT c.dia,
       citas   = COUNT(*),
       rural   = SUM(CASE WHEN UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) = 'R' THEN 1 ELSE 0 END),
       urbana  = SUM(CASE WHEN UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) = 'U' THEN 1 ELSE 0 END),
       vacia   = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN 1 ELSE 0 END),
       otra    = SUM(CASE WHEN UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) NOT IN ('R', 'U') THEN 1 ELSE 0 END)
  FROM citas c
  JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = c.hist
 WHERE DATEDIFF(day, '19000106', c.dia) % 7 = 0
   AND c.dia >= DATEADD(month, -3, CAST(GETDATE() AS date))
 GROUP BY c.dia
 ORDER BY c.dia;
GO

/* ── D. Los que agendan por el chat, por zona ─────────────────────────────── */
WITH chat AS (
    SELECT DISTINCT cm.NU_HIST_PAC_CIT AS hist
      FROM dbo.CITAS_MEDICAS cm
     WHERE RTRIM(cm.DE_DESC_CIT) IN ('ASIGNADA POR WHATSAPP', 'ASIGNADA POR TELEGRAM')
)
SELECT zona = CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
                   ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END,
       pacientes = COUNT(*),
       pct = CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5,1))
  FROM chat c
  JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = c.hist
 GROUP BY CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
               ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END
 ORDER BY pacientes DESC;
GO

/* ── E. ¿La zona del paciente coincide con la de su barrio? (Anserma) ─────── */
-- El municipio se toma de la ficha del paciente (Caldas 17, Anserma 042).
SELECT zona_paciente = CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
                            ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END,
       zona_barrio   = ISNULL(CAST(UPPER(LTRIM(RTRIM(b.TX_ZORE_BAR))) AS varchar(20)), '(sin barrio)'),
       pacientes     = COUNT(*)
  FROM dbo.PACIENTES p
  OUTER APPLY (
      SELECT TX_ZORE_BAR = MIN(x.TX_ZORE_BAR)
        FROM dbo.BARRIO x
       WHERE x.CD_CODI_BAR = p.CD_CODI_BAR_PAC
  ) b
 WHERE p.CD_CODI_DPTO_PAC = '17' AND p.CD_CODI_MUNI_PAC = '042'
 GROUP BY CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN '(vacía)'
               ELSE UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) END,
          ISNULL(CAST(UPPER(LTRIM(RTRIM(b.TX_ZORE_BAR))) AS varchar(20)), '(sin barrio)')
 ORDER BY pacientes DESC;
GO

/* ── F. El catálogo de barrios: ¿hay veredas (zona rural)? ────────────────── */
SELECT zona_barrio = ISNULL(UPPER(LTRIM(RTRIM(TX_ZORE_BAR))), '(vacía)'), barrios = COUNT(*)
  FROM dbo.BARRIO
 GROUP BY ISNULL(UPPER(LTRIM(RTRIM(TX_ZORE_BAR))), '(vacía)');

-- Los que no son urbanos, con todas sus columnas (así se ve el municipio).
SELECT TOP 60 *
  FROM dbo.BARRIO
 WHERE UPPER(LTRIM(RTRIM(ISNULL(TX_ZORE_BAR, '')))) <> 'U'
 ORDER BY DE_DESC_BAR;
GO

/* ── G. ¿Recepción llena la zona en las historias nuevas? (por mes) ───────── */
SELECT mes = CONVERT(char(7), p.FE_HIST_PAC, 126),
       historias_nuevas = COUNT(*),
       con_zona = SUM(CASE WHEN NULLIF(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC)), '') IS NULL THEN 0 ELSE 1 END),
       rural    = SUM(CASE WHEN UPPER(LTRIM(RTRIM(p.CD_CODI_ZORE_PAC))) = 'R' THEN 1 ELSE 0 END)
  FROM dbo.PACIENTES p
 WHERE p.FE_HIST_PAC >= DATEADD(month, -12, GETDATE())
 GROUP BY CONVERT(char(7), p.FE_HIST_PAC, 126)
 ORDER BY mes;
GO

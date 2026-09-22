/* =============================================================================
   PRUEBAS DE PUNTA A PUNTA (E2E) ANTES DE PRODUCCIÓN — 1. PREPARAR EL HIS
   Base objetivo: PRUEBAS.   ⚠️ Este guion SÍ ESCRIBE (PACIENTES y CITAS_MEDICAS).
   =============================================================================

   QUÉ ES. Deja en el HIS el estado de partida de los escenarios de
   `PRUEBAS_E2E.md`: 21 pacientes SINTÉTICOS y las citas «agendadas por el
   hospital» que los escenarios necesitan. Lo que se prueba desde AgenIA
   (WhatsApp, panel) lo explica ese documento, escenario por escenario.

   📱 ESTE GUION PIDE UN TELÉFONO DE VERDAD. El alta en caliente
   (`PLAN_ALTA_EN_CALIENTE.md`) crea el paciente en AgenIA con el teléfono que
   encuentra en la ficha del HIS, y le manda el recordatorio. Sin un móvil real en
   `DE_TELE_PAC` no se puede probar ni el recordatorio (escenario 1b) ni la regla
   del teléfono que ya es de otro (escenario 21), que son dos de los cuatro
   criterios de aceptación de ese plan. Por eso `@TEL_PRUEBA` es obligatorio y
   tiene que ser **el móvil del probador**: a ese número LLEGARÁN WhatsApps.
   Se escribe en DOS fichas a propósito (la 1 y la 21) — eso es el escenario 21.

   GARANTÍAS — verificables leyendo el archivo:
     · SOLO documentos sintéticos: 9990000001 … 9990000022 (y 09990000008, la
       variante con cero a la izquierda del escenario 8). Diez dígitos que empiezan
       por 999 no son un rango de cédulas colombianas en uso. Si alguno ya existe
       en PACIENTES, el guion se detiene sin escribir nada.
     · Toda cita de prueba lleva en DE_DESC_CIT la marca 'PRUEBA E2E AGENIA · …'.
       NO es la marca de AgenIA ('ASIGNADA POR WHATSAPP'): estas citas simulan
       citas agendadas por el HOSPITAL, y el agente reconoce las suyas por
       igualdad exacta con aquella.
     · Una sola transacción (XACT_ABORT): o queda todo, o no queda nada.
     · Se niega a correr dos veces: si ya hay datos de prueba, pide limpiar
       primero (PRUEBAS_E2E_3_LIMPIAR.sql).
     · Las filas imitan EXACTAMENTE lo que escribe el driver en producción: las
       mismas columnas, y servicio, especialidad, convenio, centro de costos y
       lugar de atención copiados de una cita REAL del mismo médico.
     · No toca la auditoría del hospital (AUDITOR) ni ninguna otra tabla.

   🚨 ANTES DE CORRERLO: mira la PARTE 0. Dice a qué base está conectado AHORA
   el agente de AgenIA. Si es PRUEBAS, esta base es la que ve el sistema en
   producción, y las citas de prueba del día de prueba OCUPAN cupos reales que el
   bot deja de ofrecer mientras duren (se liberan con el guion de limpieza).

   CÓMO SE USA
     1. Correr la PARTE 0 sola y leerla.
     2. Llenar los parámetros de la PARTE 1 (con la ayuda de la consulta de
        apoyo que viene justo debajo de ellos) y poner @CONFIRMO = 1.
     3. Correr todo. Al final sale la tabla de escenarios con lo que quedó.
   ============================================================================= */

USE PRUEBAS;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;          -- cualquier error deshace la transacción entera
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* -----------------------------------------------------------------------------
   PARTE 0 — ¿A QUÉ BASE ESTÁ CONECTADO EL AGENTE AHORA?  (solo lectura)
   Cada sesión de SQL Server dice en qué base está. El agente entra con
   `agenia_sync`: su base es el catálogo que AgenIA usa en producción.
   -------------------------------------------------------------------------- */
PRINT '=== PARTE 0 — a qué base está conectado el agente de AgenIA ===';

SELECT
    login            = s.login_name,
    base_del_agente  = DB_NAME(s.database_id),
    equipo           = s.host_name,
    programa         = s.program_name,
    ultimo_pedido    = s.last_request_start_time
FROM sys.dm_exec_sessions s
WHERE s.login_name = 'agenia_sync'
ORDER BY s.last_request_start_time DESC;

IF EXISTS (SELECT 1 FROM sys.dm_exec_sessions WHERE login_name = 'agenia_sync' AND DB_NAME(database_id) = 'PRUEBAS')
    PRINT '   ATENCION: el agente está conectado a PRUEBAS: esta base es la que AgenIA usa en producción. '
        + 'Las citas de prueba del día de prueba ocuparán cupos que el bot dejará de ofrecer hasta la limpieza.';
ELSE IF EXISTS (SELECT 1 FROM sys.dm_exec_sessions WHERE login_name = 'agenia_sync')
    PRINT '   El agente está conectado a OTRA base (ver arriba). Lo que se prepare aquí NO lo ve AgenIA en '
        + 'producción: la prueba necesita un AgenIA de pruebas apuntando a PRUEBAS.';
ELSE
    PRINT '   No hay ninguna sesión de agenia_sync ahora mismo (¿el agente está detenido?). '
        + 'Repetir con el agente corriendo para saber a qué base apunta.';
GO

/* -----------------------------------------------------------------------------
   CONSULTA DE APOYO — para elegir los parámetros (solo lectura)
   Médicos con turno en los próximos 30 días y cuántas citas tienen. El
   homologado se elige en el panel: Espejo → Homologación (los 17 de 36).
   -------------------------------------------------------------------------- */
PRINT '';
PRINT '=== Apoyo — médicos con turno en los próximos 30 días ===';
SELECT TOP (40)
    medico      = t.CD_MED_TUME,
    nombre      = m.NO_NOMB_MED,
    dia         = CONVERT(char(10), t.FE_FECH_TUME, 111),
    desde       = CONVERT(char(5), t.FE_HOIN_TUME, 108),
    hasta       = CONVERT(char(5), t.FE_HOFI_TUME, 108),
    consultorio = t.CD_CODI_CONS_TUME
FROM dbo.TURNOS_MEDICOS t
LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = t.CD_MED_TUME
WHERE t.FE_FECH_TUME >= CAST(GETDATE() AS date)
  AND t.FE_FECH_TUME <  DATEADD(day, 30, CAST(GETDATE() AS date))
ORDER BY t.FE_FECH_TUME, t.CD_MED_TUME;
GO

/* -----------------------------------------------------------------------------
   PARTE 1 — PARÁMETROS (llenar) y PARTE 2 — ESCRITURA
   Un solo lote a propósito: las variables no sobreviven a un GO.
   -------------------------------------------------------------------------- */
DECLARE @CONFIRMO          bit        = 0;    -- 1 = sí, escribir. Con 0 solo valida.
DECLARE @MED_HOMOLOGADO    varchar(4) = '';   -- homologado en AgenIA, CON turno el día de prueba
DECLARE @MED_SIN_HOMOLOGAR varchar(4) = '';   -- existe en el HIS y NO está homologado en AgenIA
DECLARE @DIAS              int        = 10;   -- día de prueba = hoy + @DIAS (dentro de lo que el bot ofrece)
-- 📱 El móvil DEL PROBADOR, 10 dígitos empezando por 3. Va en la ficha de los
-- pacientes 1 y 21: a ese número le llegan el recordatorio y los mensajes del bot.
DECLARE @TEL_PRUEBA        varchar(10) = '';
-- Día de la cita del recordatorio (escenario 1b). 1 = mañana. El cron manda el
-- recordatorio 24 HORAS HÁBILES antes (`REMINDER_BUSINESS_HOURS_BEFORE`) y corre
-- cada 15 min, así que con la cita mañana el recordatorio sale dentro de la sesión
-- de prueba. Con el día de prueba (hoy + 10) no saldría hasta dentro de una semana.
DECLARE @DIAS_RECORDATORIO int        = 1;

PRINT '';
PRINT '=== PARTE 2 — preparar los escenarios ===';

-- ── Guardas ─────────────────────────────────────────────────────────────────
IF DB_NAME() <> 'PRUEBAS'
    THROW 50000, 'Este guion escribe en PRUEBAS y solo en PRUEBAS. Corrija el USE.', 1;

IF @MED_HOMOLOGADO = '' OR @MED_SIN_HOMOLOGAR = ''
    THROW 50001, 'Faltan parámetros: @MED_HOMOLOGADO y @MED_SIN_HOMOLOGAR (ver la consulta de apoyo).', 1;

IF @MED_HOMOLOGADO = @MED_SIN_HOMOLOGAR
    THROW 50002, '@MED_HOMOLOGADO y @MED_SIN_HOMOLOGAR tienen que ser médicos distintos.', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.MEDICOS WHERE CD_CODI_MED = @MED_HOMOLOGADO)
    THROW 50003, '@MED_HOMOLOGADO no existe en MEDICOS.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.MEDICOS WHERE CD_CODI_MED = @MED_SIN_HOMOLOGAR)
    THROW 50004, '@MED_SIN_HOMOLOGAR no existe en MEDICOS.', 1;

-- 📱 El teléfono del probador. Mismo criterio que `normalizePhoneToE164Co`: un móvil
-- colombiano son 10 dígitos que empiezan por 3. Cualquier otra cosa la descarta AgenIA
-- y el paciente quedaría creado sin teléfono, así que la prueba no probaría nada.
IF @TEL_PRUEBA = ''
    THROW 50011, 'Falta @TEL_PRUEBA: el móvil del probador. Sin él no se pueden probar el recordatorio de una cita del hospital (1b) ni el teléfono compartido (21). Ver la cabecera.', 1;
IF @TEL_PRUEBA NOT LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    THROW 50012, '@TEL_PRUEBA tiene que ser un móvil de 10 dígitos que empiece por 3 (sin +57, sin espacios): es lo único que AgenIA acepta como destinatario.', 1;

-- Si ese número ya es de un paciente REAL del hospital, la regla D4 del alta en
-- caliente vería un dueño previo y el escenario 21 daría un resultado engañoso —
-- además de que el recordatorio de ese paciente real podría acabar aquí.
IF EXISTS (SELECT 1 FROM dbo.PACIENTES
            WHERE REPLACE(REPLACE(ISNULL(DE_TELE_PAC, ''), ' ', ''), '-', '') = @TEL_PRUEBA)
    THROW 50013, '@TEL_PRUEBA ya está en la ficha de un paciente del hospital. Use otro móvil del probador.', 1;

-- ── Los documentos sintéticos ───────────────────────────────────────────────
DECLARE @docs TABLE (n int PRIMARY KEY, doc varchar(20), doc_his varchar(20));
INSERT @docs (n, doc, doc_his)
SELECT n, d, CASE WHEN n = 8 THEN '0' + d ELSE d END
FROM (SELECT n, doc = '99900000' + RIGHT('0' + CAST(n AS varchar(2)), 2)
      FROM (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),
                   (11),(12),(13),(14),(15),(16),(17),(18),(19),(20),
                   -- 21: el gemelo del teléfono (D4). 22: el documento ambiguo (D3).
                   (21),(22)) v(n)) x(n, d);

-- ¿Ya hay datos de prueba, o —imposible pero se comprueba— un paciente real con esos números?
IF EXISTS (SELECT 1 FROM dbo.PACIENTES p JOIN @docs d ON p.NU_HIST_PAC IN (d.doc, d.doc_his))
   OR EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS WHERE DE_DESC_CIT LIKE 'PRUEBA E2E AGENIA%')
    THROW 50005, 'Ya hay pacientes o citas de prueba en PRUEBAS. Corra primero PRUEBAS_E2E_3_LIMPIAR.sql.', 1;

-- ── Fechas ──────────────────────────────────────────────────────────────────
DECLARE @hoy  date = CAST(GETDATE() AS date);
DECLARE @dia  date = DATEADD(day, @DIAS, @hoy);       -- el día de prueba
DECLARE @dia2 date = DATEADD(day, @DIAS + 1, @hoy);   -- solo para el escenario 3 (ver abajo)
DECLARE @txtDia  char(10) = CONVERT(char(10), @dia, 111);    -- 'YYYY/MM/DD'
DECLARE @txtDia2 char(10) = CONVERT(char(10), @dia2, 111);

-- ── Turno del médico homologado el día de prueba ────────────────────────────
DECLARE @tIni time, @tFin time, @consultorio varchar(8);
SELECT TOP (1)
    @tIni = CAST(FE_HOIN_TUME AS time),
    @tFin = CAST(FE_HOFI_TUME AS time),
    @consultorio = CD_CODI_CONS_TUME
FROM dbo.TURNOS_MEDICOS
WHERE CD_MED_TUME = @MED_HOMOLOGADO AND CAST(FE_FECH_TUME AS date) = @dia
ORDER BY FE_HOFI_TUME DESC;
IF @tIni IS NULL
    THROW 50006, '@MED_HOMOLOGADO no tiene turno ese día. Elija otro @DIAS u otro médico (consulta de apoyo).', 1;

-- ── Valores de referencia: copiados de una cita REAL de cada médico ─────────
-- Si el médico sin homologar no tiene citas recientes, se usa la referencia del
-- homologado para servicio/convenio (lo que importa es su CÓDIGO de médico).
DECLARE @ref TABLE (med varchar(4) PRIMARY KEY, ser varchar(12), esp varchar(3), cons varchar(8),
                    conv int, ceco varchar(11), luat varchar(2), dura int);
INSERT @ref
SELECT m.med, c.CD_CODI_SER_CIT, c.CD_CODI_ESP_CIT, c.CD_CODI_CONS_CIT, c.NU_NUME_CONV_CIT,
       c.CD_CODI_CECO_CIT, c.CD_CODI_LUAT_CIT, c.NU_DURA_CIT
FROM (VALUES (@MED_HOMOLOGADO), (@MED_SIN_HOMOLOGAR)) m(med)
CROSS APPLY (SELECT TOP (1) * FROM dbo.CITAS_MEDICAS c
             WHERE c.CD_CODI_MED_CIT = m.med AND c.FE_FECH_CIT >= DATEADD(day, -365, @hoy)
               AND (c.DE_DESC_CIT IS NULL OR c.DE_DESC_CIT NOT LIKE 'PRUEBA E2E AGENIA%')
             ORDER BY c.FE_FECH_CIT DESC) c;

IF NOT EXISTS (SELECT 1 FROM @ref WHERE med = @MED_HOMOLOGADO)
    THROW 50007, '@MED_HOMOLOGADO no tiene ninguna cita en el último año de la cual copiar servicio y convenio.', 1;
IF NOT EXISTS (SELECT 1 FROM @ref WHERE med = @MED_SIN_HOMOLOGAR)
    INSERT @ref SELECT @MED_SIN_HOMOLOGAR, ser, esp, cons, conv, ceco, luat, dura FROM @ref WHERE med = @MED_HOMOLOGADO;

DECLARE @dura int = (SELECT NULLIF(dura, 0) FROM @ref WHERE med = @MED_HOMOLOGADO);
SET @dura = COALESCE(@dura, 20);

-- ── Cuatro cupos LIBRES y alineados dentro del turno (los últimos del día) ──
DECLARE @cupos TABLE (orden int IDENTITY, hora varchar(18), inicio datetime);
;WITH n AS (
    SELECT TOP (200) i = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 FROM sys.all_objects
), candidatos AS (
    SELECT inicio = DATEADD(minute, n.i * @dura, CAST(@dia AS datetime) + CAST(@tIni AS datetime))
    FROM n
    WHERE DATEADD(minute, (n.i + 1) * @dura, CAST(@tIni AS datetime)) <= CAST(@tFin AS datetime)
)
INSERT @cupos (hora, inicio)
SELECT TOP (4)
    @txtDia + ' ' + CONVERT(char(5), c.inicio, 108), c.inicio
FROM candidatos c
WHERE NOT EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS x
                  WHERE x.CD_CODI_MED_CIT = @MED_HOMOLOGADO
                    AND x.FE_HORA_CIT = @txtDia + ' ' + CONVERT(char(5), c.inicio, 108))
ORDER BY c.inicio DESC;
IF (SELECT COUNT(*) FROM @cupos) < 4
    THROW 50008, 'El turno de @MED_HOMOLOGADO ese día no tiene 4 cupos libres. Elija otro @DIAS.', 1;

DECLARE @S1 varchar(18) = (SELECT hora FROM @cupos WHERE orden = 1);   -- escenario 1
DECLARE @S2 varchar(18) = (SELECT hora FROM @cupos WHERE orden = 2);   -- escenario 4
DECLARE @S3 varchar(18) = (SELECT hora FROM @cupos WHERE orden = 3);   -- escenarios 9 y 19
DECLARE @S4 varchar(18) = (SELECT hora FROM @cupos WHERE orden = 4);   -- escenario 8
-- Los instantes, en variables: SQL Server NO admite subconsultas dentro de un
-- VALUES de varias filas (Msg 1046), y el error es de compilación — tumbaría el
-- lote entero antes de llegar a ninguna guarda.
DECLARE @I1 datetime = (SELECT inicio FROM @cupos WHERE orden = 1);
DECLARE @I2 datetime = (SELECT inicio FROM @cupos WHERE orden = 2);
DECLARE @I3 datetime = (SELECT inicio FROM @cupos WHERE orden = 3);
DECLARE @I4 datetime = (SELECT inicio FROM @cupos WHERE orden = 4);

-- ── El plan: TODAS las citas a escribir, para validarlas antes de tocar nada ──
DECLARE @plan TABLE (esc int, doc varchar(20), med varchar(4), hora varchar(18), fecha date,
                     inicio datetime, estado tinyint, nota varchar(120));

INSERT @plan VALUES
 -- 1: cita del hospital, médico homologado, paciente que AgenIA no conoce
 (1,  '9990000001', @MED_HOMOLOGADO,    @S1, @dia, @I1, 0, 'cita del HIS en un cupo que AgenIA ofrece'),
 -- 2: cita del hospital con un médico que AgenIA NO espeja (hora fuera de turno: no bloquea nada)
 (2,  '9990000002', @MED_SIN_HOMOLOGAR, @txtDia + ' 05:10', @dia, CAST(@dia AS datetime) + CAST('05:10' AS datetime), 0, 'médico sin homologar'),
 -- 3: hora ILEGIBLE (sin minutos, sin cero). Va en @dia2 y NO en @dia: la comprobación de
 --    horas ilegibles es por médico y DÍA, y en @dia contaminaría a los escenarios que
 --    necesitan ver un cupo vacío como vacío (el 16).
 (3,  '9990000003', @MED_HOMOLOGADO,    @txtDia2 + ' 3', @dia2, CAST(@dia2 AS datetime) + CAST('03:00' AS datetime), 0, 'hora guardada en formato ilegible'),
 -- 4: cita del hospital que se CANCELARÁ en el HIS durante la prueba (PRUEBAS_E2E_2_PASOS.sql, paso A)
 (4,  '9990000004', @MED_HOMOLOGADO,    @S2, @dia, @I2, 0, 'se cancelará en el HIS (paso A)'),
 -- 6: cita pasada ATENDIDA, dentro de la ventana de la consulta en vivo
 (6,  '9990000006', @MED_HOMOLOGADO,    CONVERT(char(10), DATEADD(day, -3, @hoy), 111) + ' 05:40', DATEADD(day, -3, @hoy),
      CAST(DATEADD(day, -3, @hoy) AS datetime) + CAST('05:40' AS datetime), 1, 'atendida'),
 -- 7: cita pasada con INASISTENCIA
 (7,  '9990000007', @MED_HOMOLOGADO,    CONVERT(char(10), DATEADD(day, -2, @hoy), 111) + ' 05:40', DATEADD(day, -2, @hoy),
      CAST(DATEADD(day, -2, @hoy) AS datetime) + CAST('05:40' AS datetime), 2, 'inasistencia'),
 -- 8: la cita está a nombre del MISMO documento con un cero a la izquierda
 (8,  '09990000008', @MED_HOMOLOGADO,   @S4, @dia, @I4, 0, 'mismo documento con cero a la izquierda'),
 -- 11: cita más allá de la ventana máxima de la consulta en vivo (180 días)
 (11, '9990000011', @MED_HOMOLOGADO,    CONVERT(char(10), DATEADD(day, 200, @hoy), 111) + ' 05:50', DATEADD(day, 200, @hoy),
      CAST(DATEADD(day, 200, @hoy) AS datetime) + CAST('05:50' AS datetime), 0, 'fuera de la ventana de 180 días'),
 -- 19: la OTRA persona que ocupa el cupo que reclama el escenario 9
 (19, '9990000019', @MED_HOMOLOGADO,    @S3, @dia, @I3, 0, 'ocupa el cupo que reclama el paciente 9');

-- 5: HISTORIA LARGA — 60 citas pasadas atendidas, una por semana hacia atrás desde
--    hace 14 días (fuera de la ventana: no se muestran, pero el motor las recorre).
;WITH k AS (SELECT TOP (60) i = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 FROM sys.all_objects)
INSERT @plan
SELECT 5, '9990000005', @MED_HOMOLOGADO,
       CONVERT(char(10), DATEADD(day, -14 - 7 * k.i, @hoy), 111) + ' 05:30',
       DATEADD(day, -14 - 7 * k.i, @hoy),
       CAST(DATEADD(day, -14 - 7 * k.i, @hoy) AS datetime) + CAST('05:30' AS datetime),
       1, 'historia larga'
FROM k;

-- ── 1b: la cita CERCANA, la del recordatorio ─────────────────────────────────
-- El cron manda el recordatorio 24 horas HÁBILES antes de la cita, así que la del
-- día de prueba (hoy + @DIAS) no sirve: no saldría durante la sesión. Esta va
-- mañana (o el día que diga @DIAS_RECORDATORIO), en el primer cupo libre del turno.
-- Es el criterio de aceptación de la Fase 4 del alta en caliente: un paciente que
-- nunca escribió al bot recibe el recordatorio de una cita que agendó el hospital.
DECLARE @diaR    date     = DATEADD(day, @DIAS_RECORDATORIO, @hoy);
DECLARE @txtDiaR char(10) = CONVERT(char(10), @diaR, 111);
DECLARE @tIniR time, @tFinR time;
SELECT TOP (1) @tIniR = CAST(FE_HOIN_TUME AS time), @tFinR = CAST(FE_HOFI_TUME AS time)
FROM dbo.TURNOS_MEDICOS
WHERE CD_MED_TUME = @MED_HOMOLOGADO AND CAST(FE_FECH_TUME AS date) = @diaR
ORDER BY FE_HOFI_TUME DESC;

DECLARE @horaR varchar(18) = NULL, @inicioR datetime = NULL;
IF @tIniR IS NOT NULL
BEGIN
    ;WITH nR AS (
        SELECT TOP (200) i = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 FROM sys.all_objects
    ), candR AS (
        SELECT inicio = DATEADD(minute, nR.i * @dura, CAST(@diaR AS datetime) + CAST(@tIniR AS datetime))
        FROM nR
        WHERE DATEADD(minute, (nR.i + 1) * @dura, CAST(@tIniR AS datetime)) <= CAST(@tFinR AS datetime)
    )
    SELECT TOP (1) @horaR = @txtDiaR + ' ' + CONVERT(char(5), c.inicio, 108), @inicioR = c.inicio
    FROM candR c
    WHERE NOT EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS x
                      WHERE x.CD_CODI_MED_CIT = @MED_HOMOLOGADO
                        AND x.FE_HORA_CIT = @txtDiaR + ' ' + CONVERT(char(5), c.inicio, 108))
    ORDER BY c.inicio DESC;
END;

IF @horaR IS NOT NULL
    INSERT @plan (esc, doc, med, hora, fecha, inicio, estado, nota)
    VALUES (1, '9990000001', @MED_HOMOLOGADO, @horaR, @diaR, @inicioR, 0,
            'cita cercana: la del recordatorio (1b)');
ELSE
    PRINT '   AVISO: @MED_HOMOLOGADO no tiene turno con cupo libre el ' + @txtDiaR
        + '. El escenario 1b (recordatorio de una cita del hospital) NO queda preparado: '
        + 'pruebe otro @DIAS_RECORDATORIO. Todo lo demás sí se prepara.';

-- ¿Choca alguna con una cita real? (PK: médico + hora + estado)
IF EXISTS (SELECT 1 FROM @plan p JOIN dbo.CITAS_MEDICAS c
           ON c.CD_CODI_MED_CIT = p.med AND c.FE_HORA_CIT = p.hora AND c.NU_ESTA_CIT = p.estado)
BEGIN
    SELECT choca_con_una_cita_real = p.esc, p.med, p.hora, p.estado
    FROM @plan p JOIN dbo.CITAS_MEDICAS c
      ON c.CD_CODI_MED_CIT = p.med AND c.FE_HORA_CIT = p.hora AND c.NU_ESTA_CIT = p.estado;
    THROW 50009, 'Alguna cita de prueba choca con una cita existente (ver arriba). Elija otro @DIAS.', 1;
END;

-- ── Vista previa (siempre) ──────────────────────────────────────────────────
SELECT vista_previa = 'lo que se escribiría', escenario = esc, documento = doc, medico = med,
       hora, estado, nota
FROM @plan WHERE esc <> 5
UNION ALL
SELECT 'lo que se escribiría', 5, '9990000005', @MED_HOMOLOGADO,
       CAST(COUNT(*) AS varchar(4)) + ' citas pasadas', 1, 'historia larga'
FROM @plan WHERE esc = 5
ORDER BY escenario;

IF @CONFIRMO <> 1
BEGIN
    PRINT '';
    PRINT '   Validación completa y NADA escrito (@CONFIRMO = 0). Revise la vista previa y la';
    PRINT '   PARTE 0; para escribir, ponga @CONFIRMO = 1 y vuelva a correr.';
    RETURN;
END;

-- ══════════════════════════════════════════════════════════════════════════
-- ESCRITURA — una sola transacción
-- ══════════════════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

-- Los pacientes: todos MENOS el 12, que a propósito NO existe en el HIS (el
-- driver tiene que darlo de alta él, desde la reserva por WhatsApp). Variedad
-- real: tildes, ñ, nombres compuestos, un solo apellido, un menor, un mayor.
-- NO_NOMB_PAC es SOLO el primer nombre, varchar(20) (MAPEO_HIS.md).
-- Fechas como 'YYYYMMDD' a propósito: es el único formato que SQL Server lee igual
-- con cualquier idioma del login; en español (DATEFORMAT dmy) '1985-03-14' se lee
-- como año-DÍA-mes y revienta. El driver usa este mismo formato (fechaLiteralSql).
-- El TELÉFONO va solo en dos fichas: la del 1 (alta en caliente con recordatorio) y
-- la del 21 (el mismo número, que la regla D4 tiene que rechazar). Los demás se quedan
-- sin teléfono a propósito: así el alta los crea igual pero no le escribe a nadie.
INSERT INTO dbo.PACIENTES (
    NU_HIST_PAC, NU_DOCU_PAC, NU_TIPD_PAC,
    NO_NOMB_PAC, NO_SGNO_PAC, DE_PRAP_PAC, DE_SGAP_PAC,
    DE_TELE_PAC, FE_NACI_PAC, NU_SEXO_PAC, FE_HIST_PAC, NU_EXTR_PAC
)
SELECT d.doc_his, d.doc_his, 0, v.n1, v.n2, v.a1, v.a2, v.tel, v.naci, v.sexo, GETDATE(), 0
FROM @docs d
JOIN (VALUES
    (1,  'PRUEBA',   'UNO',      'ÁLVAREZ',   'PEÑA',      @TEL_PRUEBA, '19850314', 0),
    (2,  'PRUEBA',   NULL,       'DOS',       NULL,        NULL,        '19900701', 1),
    (3,  'PRUEBA',   'TRES',     'MUÑOZ',     'ÑÁÑEZ',     NULL,        '19721130', 0),
    (4,  'PRUEBA',   'CUATRO',   'OSPINA',    'RÍOS',      NULL,        '20010109', 1),
    (5,  'PRUEBA',   'CINCO',    'HISTORIA',  'LARGA',     NULL,        '19480522', 0),   -- adulta mayor
    (6,  'PRUEBA',   'SEIS',     'ATENDIDA',  NULL,        NULL,        '19950917', 1),
    (7,  'PRUEBA',   'SIETE',    'NO',        'ASISTIÓ',   NULL,        '19990228', 0),
    (8,  'PRUEBA',   'OCHO',     'CERO',      'IZQUIERDA', NULL,        '19801212', 1),
    (9,  'PRUEBA',   'NUEVE',    'RECLAMA',   'CUPO',      NULL,        '19930606', 0),
    (10, 'PRUEBA',   'DIEZ',     'SIN',       'CITAS',     NULL,        '19700404', 1),
    (11, 'PRUEBA',   'ONCE',     'MUY',       'LEJANA',    NULL,        '19880808', 0),
    (13, 'PRUEBA',   'TRECE',    'WHATSAPP',  NULL,        NULL,        '19911010', 1),
    (14, 'PRUEBA',   'CATORCE',  'AGENTE',    'CAÍDO',     NULL,        '19870115', 0),
    (15, 'PRUEBA',   'QUINCE',   'CUPO',      'CHOCA',     NULL,        '19790303', 1),
    (16, 'PRUEBA',   'DIECISÉIS','CITA',      'PERDIDA',   NULL,        '19830909', 0),
    (17, 'PRUEBA',   'DIECISIETE','CANCELA',  'WHATSAPP',  NULL,        '19961224', 1),
    (18, 'PRUEBA',   'DIECIOCHO','LISTA',     'ESPERA',    NULL,        '20120505', 0),   -- menor de edad
    (19, 'PRUEBA',   'DIECINUEVE','OTRA',     'PERSONA',   NULL,        '19750707', 1),
    (20, 'PRUEBA',   'VEINTE',   'SIN',       'PADRÓN',    NULL,        '19940214', 0),
    -- Mismo móvil que el 1: al darlo de alta, AgenIA NO puede asignárselo (D4).
    (21, 'PRUEBA',   'VEINTIUNO','TELÉFONO',  'COMPARTIDO',@TEL_PRUEBA, '19821111', 1),
    -- El de la identidad ambigua (D3): en AgenIA se le crean a mano DOS perfiles.
    (22, 'PRUEBA',   'VEINTIDÓS','DOCUMENTO', 'AMBIGUO',   NULL,        '19900202', 0)
) v(n, n1, n2, a1, a2, tel, naci, sexo) ON v.n = d.n;

-- Las citas, con las MISMAS columnas que escribe el driver en producción.
INSERT INTO dbo.CITAS_MEDICAS (
    CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT, CD_CODI_SER_CIT,
    NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
    NU_DIA_CIT, NU_NUME_MOVI_CIT, NU_PRIM_CIT, NU_CONE_CALL_CIT,
    NU_TIPO_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT, NU_NUME_CONV_CIT,
    DE_DESC_CIT, CD_CODI_CECO_CIT, CD_CODI_LUAT_CIT, FE_SOLI_CIT
)
SELECT
    p.med, p.hora, p.estado, r.ser,
    p.doc, COALESCE(NULLIF(r.dura, 0), @dura), GETDATE(), p.fecha,
    0, 0, 0, 0,
    0, r.esp,
    CASE WHEN p.med = @MED_HOMOLOGADO AND p.fecha = @dia THEN @consultorio ELSE r.cons END,
    r.conv,
    'PRUEBA E2E AGENIA · escenario ' + CAST(p.esc AS varchar(2)) + ' · ' + p.nota,
    r.ceco, r.luat, p.inicio
FROM @plan p
JOIN @ref r ON r.med = p.med;

DECLARE @escritas int = @@ROWCOUNT;
IF @escritas <> (SELECT COUNT(*) FROM @plan)
    THROW 50010, 'No se escribieron todas las citas del plan: se deshace todo.', 1;

COMMIT TRANSACTION;

PRINT '';
-- PRINT no admite subconsultas (Msg 1046): el recuento va primero a una variable.
DECLARE @pacientesEscritos int = (SELECT COUNT(*) FROM dbo.PACIENTES p JOIN @docs d ON p.NU_HIST_PAC = d.doc_his);
PRINT '   LISTO: ' + CAST(@pacientesEscritos AS varchar(4))
    + ' pacientes y ' + CAST(@escritas AS varchar(4)) + ' citas de prueba.';

-- ── Qué quedó, y qué sigue (ver PRUEBAS_E2E.md) ─────────────────────────────
SELECT
    escenario = d.n,
    documento_agenia = d.doc,
    en_el_his = CASE
        WHEN d.n = 12 THEN 'NO existe (lo crea el driver al reservar por WhatsApp)'
        WHEN d.n = 5  THEN 'paciente + 60 citas pasadas atendidas'
        WHEN d.n = 21 THEN 'paciente CON el mismo móvil del 1 — su cita la crea el PASO E'
        WHEN d.n = 22 THEN 'solo el paciente — su cita la crea el PASO D, después de los dos perfiles'
        WHEN c.FE_HORA_CIT IS NOT NULL THEN 'paciente + cita ' + c.CD_CODI_MED_CIT + ' ' + c.FE_HORA_CIT
             + ' (estado ' + CAST(c.NU_ESTA_CIT AS varchar(1)) + ')'
        ELSE 'solo el paciente'
    END,
    padron_agenia = CASE WHEN d.n = 20 THEN 'NO (a propósito)'
                         WHEN d.n IN (17, 18) THEN 'sí, EPS B'
                         ELSE 'sí, EPS A' END
FROM @docs d
OUTER APPLY (SELECT TOP (1) x.CD_CODI_MED_CIT, x.FE_HORA_CIT, x.NU_ESTA_CIT
             FROM dbo.CITAS_MEDICAS x
             WHERE x.NU_HIST_PAC_CIT = d.doc_his AND x.DE_DESC_CIT LIKE 'PRUEBA E2E AGENIA%'
             ORDER BY x.FE_FECH_CIT DESC) c
ORDER BY d.n;

SELECT dato = 'día de prueba', valor = @txtDia
UNION ALL SELECT 'médico homologado', @MED_HOMOLOGADO
UNION ALL SELECT 'médico sin homologar', @MED_SIN_HOMOLOGAR
UNION ALL SELECT 'cupo escenario 1', @S1
UNION ALL SELECT 'cupo escenario 4 (se cancelará)', @S2
UNION ALL SELECT 'cupo escenarios 9 / 19', @S3
UNION ALL SELECT 'cupo escenario 8', @S4
UNION ALL SELECT 'día del escenario 3 (hora ilegible)', @txtDia2
UNION ALL SELECT 'cupo escenario 1b (recordatorio)', COALESCE(@horaR, 'NO PREPARADO: sin turno libre ese día')
UNION ALL SELECT 'móvil del probador (fichas 1 y 21)', @TEL_PRUEBA;
GO

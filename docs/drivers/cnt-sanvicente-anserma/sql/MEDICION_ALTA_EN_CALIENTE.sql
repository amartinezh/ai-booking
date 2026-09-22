/* =============================================================================
   MEDICIÓN — la consulta que el alta en caliente añade al agente
   Base objetivo: PRUEBAS (o ESEHSVP si el agente ya lee de ahí).  SOLO LECTURA.
   =============================================================================

   Qué mide. Con el alta en caliente (docs/PLAN_ALTA_EN_CALIENTE.md), cada vuelta
   del agente que encuentre citas NUEVAS pide además los datos de esos pacientes:

       SELECT NU_HIST_PAC, NO_NOMB_PAC, …, DE_TELE_PAC, FE_NACI_PAC, NU_SEXO_PAC
         FROM dbo.PACIENTES
        WHERE NU_HIST_PAC IN (…)      -- los documentos de las citas nuevas

   Es una lectura por CLAVE PRIMARIA, en lotes de 200, y solo cuando hay altas:
   una vuelta sin citas nuevas no la hace. Lo que hay que confirmar es justamente
   eso: que sea un acceso por índice y no un recorrido de PACIENTES.

   Cómo se corre: con SQLCMD Mode apagado, en SSMS, una parte a la vez. Anote las
   lecturas lógicas y el tiempo de la PARTE B en la tabla de abajo.
   ============================================================================= */

SET NOCOUNT ON;

/* ── PARTE A — tamaño de la tabla y su clave ──────────────────────────────── */
SELECT filas = SUM(p.rows)
  FROM sys.partitions p
 WHERE p.object_id = OBJECT_ID('dbo.PACIENTES') AND p.index_id IN (0, 1);

SELECT indice = i.name, tipo = i.type_desc, columna = c.name, orden = ic.key_ordinal
  FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id
 WHERE i.object_id = OBJECT_ID('dbo.PACIENTES') AND ic.key_ordinal > 0
 ORDER BY i.index_id, ic.key_ordinal;

/* ── PARTE B — el costo real, con documentos que existen ──────────────────── */
-- Diez documentos reales de citas recientes: el peor caso normal de una vuelta
-- (lo habitual es ninguno o uno o dos).
DECLARE @docs TABLE (hist varchar(20) PRIMARY KEY);
INSERT @docs (hist)
SELECT DISTINCT TOP (10) c.NU_HIST_PAC_CIT
  FROM dbo.CITAS_MEDICAS c
 WHERE c.FE_FECH_CIT >= CAST(GETDATE() AS date)
   AND c.NU_HIST_PAC_CIT IS NOT NULL;

SET STATISTICS IO ON;
SET STATISTICS TIME ON;

SELECT p.NU_HIST_PAC, p.NO_NOMB_PAC, p.NO_SGNO_PAC, p.DE_PRAP_PAC, p.DE_SGAP_PAC,
       p.DE_TELE_PAC, CONVERT(varchar(10), p.FE_NACI_PAC, 23) naci, p.NU_SEXO_PAC
  FROM dbo.PACIENTES p
 WHERE p.NU_HIST_PAC IN (SELECT hist FROM @docs);

SET STATISTICS TIME OFF;
SET STATISTICS IO OFF;

/* ── PARTE C — cuántos pacientes NUEVOS aparecen al día ───────────────────────
   Da la frecuencia real con la que se pagará esta consulta y cuántos pacientes
   crearía AgenIA. Documentos distintos en citas elaboradas en los últimos 7 días. */
SELECT dia = CAST(c.FE_ELAB_CIT AS date),
       citas_nuevas = COUNT(*),
       pacientes_distintos = COUNT(DISTINCT c.NU_HIST_PAC_CIT)
  FROM dbo.CITAS_MEDICAS c
 WHERE c.FE_ELAB_CIT >= DATEADD(day, -7, CAST(GETDATE() AS date))
 GROUP BY CAST(c.FE_ELAB_CIT AS date)
 ORDER BY dia;

/* ── PARTE D — cobertura del teléfono ─────────────────────────────────────────
   Cuántos de esos pacientes tienen un celular utilizable. Es el techo de a
   cuántos se les podrá mandar recordatorio (D1/D2 del plan). */
SELECT total = COUNT(*),
       con_celular = SUM(CASE WHEN p.DE_TELE_PAC LIKE '3%' AND LEN(REPLACE(p.DE_TELE_PAC, ' ', '')) = 10 THEN 1 ELSE 0 END),
       sin_telefono = SUM(CASE WHEN p.DE_TELE_PAC IS NULL OR LTRIM(RTRIM(p.DE_TELE_PAC)) = '' THEN 1 ELSE 0 END)
  FROM dbo.PACIENTES p
 WHERE p.NU_HIST_PAC IN (
        SELECT DISTINCT c.NU_HIST_PAC_CIT
          FROM dbo.CITAS_MEDICAS c
         WHERE c.FE_ELAB_CIT >= DATEADD(day, -7, CAST(GETDATE() AS date)));

/* =============================================================================
   MEDIDO EL 2026-09-21 EN PRUEBAS (PARTE B)                          ✅ PASA
   ---------------------------------------------------------------------------
   Lecturas lógicas de PACIENTES : 30 por 10 documentos (3 por documento)
                                   + 2 de la tabla de variables @docs
   Lecturas físicas              : 11 (caché frío; desaparecen en la 2.ª corrida)
   Tiempo de CPU / transcurrido  : 1 ms / 3 ms
   ¿Acceso por índice (seek)?    : sí — PKPACIENTES CLUSTERED (NU_HIST_PAC)
   Tamaño de la tabla            : 78.874 filas

   Las 3 páginas por documento son la ALTURA del árbol (raíz + intermedia +
   hoja): es un seek por clave primaria, no un recorrido. Un lote completo de
   200 documentos serían ~600 lecturas lógicas, y una vuelta normal trae 1-10
   altas ⇒ 3-30 lecturas. Órdenes de magnitud por debajo de la consulta de
   citas de 90 días que el agente ya hace en cada vuelta.

   ⇒ Fase 1 aprobada. No hace falta la opción D1-b (pedir los datos a demanda).

   Criterio: si son lecturas por clave primaria y el tiempo es de milisegundos,
   la Fase 1 pasa. Si fuera un recorrido de la tabla, NO desplegar el alta en
   caliente y pasar a pedir los datos a demanda (opción D1-b del plan).
   ---------------------------------------------------------------------------
   ⚠️ LAS PARTES C Y D DE ESA CORRIDA NO SIRVEN: hay que repetirlas en la base
   que el agente vaya a leer de verdad.

   C dio 97 citas en 7 días (14/día) contra las 7.403 en 30 días (≈246/día) que
   están medidas en ESTADO.md §1336, y con una forma imposible: martes 2,
   miércoles 0, jueves 88, viernes 7, y sábado, domingo y el LUNES ENTERO en
   cero (la consulta corrió a las 21:09 de ese lunes). PRUEBAS no está
   recibiendo el agendamiento real; el lote del jueves (88 citas / 67
   pacientes) no es un día de trabajo. Tampoco es nuestro: PRUEBAS_E2E_1
   escribe 70 citas para 10 documentos, y las 18 citas restantes no podrían
   cubrir 57 pacientes distintos.

   D heredó el mismo sesgo: 66 de 75 pacientes sin teléfono (88 %) porque a los
   pacientes cargados en lote nadie les puso DE_TELE_PAC. En la MISMA tabla ya
   está medido el llenado real: 58.754 de 78.874 con móvil válido = 74,6 %
   (ESTADO.md §3194), y la PARTE B —que eligió pacientes por cita FUTURA— dio
   10 de 10 con celular. La cifra a usar para dimensionar el recordatorio es
   74,6 %, no 11 %.
   ============================================================================= */
GO

/* =============================================================================
   SEGUNDA VUELTA — PARTES E a H: lo que la primera corrida no pudo medir
   =============================================================================

   Por qué. Las partes C y D eligieron a los pacientes por `FE_ELAB_CIT` de los
   últimos 7 días, y en esta copia esa ventana solo contiene un lote cargado a
   mano: el resultado no describe al hospital. Estas cuatro partes arreglan las
   tres preguntas que quedaron abiertas:

     E — ¿hasta cuándo se alimentó esta base? (¿está congelada, o es que
         `FE_ELAB_CIT` viene vacía en muchas filas? Son dos cosas distintas.)
     F — el ritmo real de altas por día, 60 días, marcando nuestras filas de prueba.
     G — la cobertura de teléfono en la población que SÍ importa: los pacientes
         con cita FUTURA, que son los que el alta en caliente va a crear y a los
         que se les va a mandar recordatorio.
     H — la exposición a D4: móviles que el HIS tiene repetidos en más de una
         historia. Cada uno es un recordatorio que, por diseño, no se manda.

   ⚠️ COSTO. `FE_ELAB_CIT` NO TIENE ÍNDICE — los dos índices de `CITAS_MEDICAS`
   son por `FE_FECH_CIT` (ESTADO.md §775). Así que **E y F recorren la tabla
   entera: 1.084.093 filas / 855 MB, una pasada cada una.** Corra cada una UNA
   vez, y si apunta a la base viva, fuera del horario de atención. G y H sí usan
   índice (G entra por `FE_FECH_CIT`, H solo lee `PACIENTES`, 78.874 filas).

   SOLO LECTURA sobre las tablas del hospital. Lo único que se escribe es una
   tabla de variables en memoria (PARTE H), como ya hacía la PARTE B.

   Cómo se corre: SSMS con SQLCMD Mode apagado, una parte a la vez, anotando el
   resultado en el bloque que cada una tiene al final.
   ============================================================================= */

USE PRUEBAS;      -- ← la copia. Para la base VIVA: comente esta línea y use la de abajo.
-- USE ESEHSVP;
GO

SET NOCOUNT ON;
GO

/* ── PARTE E — ¿hasta cuándo se alimentó esta base? ───────────────────────────
   Una sola pasada por la tabla que responde las dos hipótesis a la vez: si
   `ultima_elaborada` se quedó en una fecha vieja, la copia está congelada; si
   `sin_fecha_de_elaborada` es una porción grande, entonces el problema es que
   la columna viene vacía y no se puede medir el ritmo por ahí. */
DECLARE @hoy char(8) = CONVERT(char(8), GETDATE(), 112);

SELECT filas                  = COUNT_BIG(*),
       primera_elaborada      = MIN(c.FE_ELAB_CIT),
       ultima_elaborada       = MAX(c.FE_ELAB_CIT),
       sin_fecha_de_elaborada = SUM(CASE WHEN c.FE_ELAB_CIT IS NULL THEN 1 ELSE 0 END),
       -- ⚠️ MEDIDO: esto NO sirve como señal de frescura. Dio 2027-09-11 10:00, el
       -- mismo valor que `ultima_cita_agendada` ⇒ `FE_SOLI_CIT` guarda el INSTANTE
       -- DE LA CITA, no la fecha de la solicitud (es lo que escribe el propio
       -- PRUEBAS_E2E_1: FE_SOLI_CIT = inicio de la cita). Se deja por completitud.
       ultima_solicitada      = MAX(c.FE_SOLI_CIT),
       -- De paso, el tamaño del libro futuro: son las citas que el espejo tendría
       -- que traer a AgenIA cuando se encienda el alta en caliente.
       citas_desde_hoy        = SUM(CASE WHEN c.FE_FECH_CIT >= @hoy THEN 1 ELSE 0 END),
       ultima_cita_agendada   = MAX(c.FE_FECH_CIT)
  FROM dbo.CITAS_MEDICAS c WITH (NOLOCK);
GO

/* MEDIDO EL 2026-09-21 EN PRUEBAS (PARTE E)
   filas                 : 1.087.077   (eran 1.084.093 el 2026-09-02)
   primera elaborada     : 2009-03-05 17:15   ⇒ 17 años de historia
   última elaborada      : 2026-09-18 06:19:44.707
   filas sin FE_ELAB_CIT : 0           ⇒ la columna SIEMPRE viene llena: la
                                         hipótesis de «no se puede medir el
                                         ritmo por ahí» queda descartada
   citas desde hoy       : 5.881       ⇒ el libro futuro a espejar
   última cita agendada  : 2027-09-11  ⇒ se agenda hasta ~12 meses adelante

   ⇒ LA COPIA ESTÁ CONGELADA. No es la columna: es el feed. */

/* ── PARTE F — el ritmo real de altas, día por día, 60 días ───────────────────
   Lo mismo que la PARTE C pero con tres arreglos: 60 días en vez de 7 (para ver
   dónde se corta la serie), el día de la semana al lado (un domingo en cero es
   normal; un lunes en cero, no) y una columna que separa NUESTRAS filas de
   prueba, que se reconocen por la descripción que escribe PRUEBAS_E2E_1. */
DECLARE @hace60 char(8) = CONVERT(char(8), DATEADD(day, -60, GETDATE()), 112);

SELECT dia                 = CAST(c.FE_ELAB_CIT AS date),
       dia_semana          = DATENAME(weekday, CAST(c.FE_ELAB_CIT AS date)),
       citas               = COUNT_BIG(*),
       pacientes_distintos = COUNT(DISTINCT c.NU_HIST_PAC_CIT),
       de_prueba_agenia    = SUM(CASE WHEN c.DE_DESC_CIT LIKE 'PRUEBA E2E AGENIA%' THEN 1 ELSE 0 END)
  FROM dbo.CITAS_MEDICAS c WITH (NOLOCK)
 WHERE c.FE_ELAB_CIT >= @hace60
 GROUP BY CAST(c.FE_ELAB_CIT AS date)
 ORDER BY dia;
GO

/* MEDIDO EL 2026-09-21 EN PRUEBAS (PARTE F)
   Serie sana del 2026-07-23 al 2026-09-11: 44 días con dato, 12.652 citas,
   11.034 pacientes distintos.

   248 citas por día NATURAL  ⇒ 7.442 al mes. Reproduce la medición del
                                2026-09-03 (7.403 en 30 días): esa cifra queda
                                RATIFICADA con otra ventana y otro método.
   razón pacientes / citas    : 0,872  ⇒ 334 citas dan ~292 documentos distintos
   de_prueba_agenia           : 0 en TODOS los días ⇒ nuestras filas E2E no están
                                en esta base; el lote del jueves 17 es del hospital

   ⚠️ EL CORTE REAL ES EL VIERNES 2026-09-11, no el 18: el sábado 12 (que debería
   traer ~285) está en CERO y el 13, 14 y 16 no existen. Lo del 15 (2 citas), 17
   (88) y 18 (7) son restos. Al 2026-09-21 la copia tiene 10 días de atraso.

   ⚠️ PATRÓN NUEVO, SIN EXPLICAR — los lunes son un séptimo de un día normal:
       lunes    46 citas/día  (6 lunes: 30 a 58)
       martes  356            miércoles 382     jueves 366
       viernes 285            sábado    285     domingo 8 (un solo domingo)
   El SÁBADO es día hábil pleno: el espejo y los recordatorios tienen que
   funcionar el sábado. El lunes hay que explicarlo antes de creerlo (PARTE I.2).
   Días laborales caídos que también hay que mirar: viernes 08-07 (52 citas),
   viernes 08-14 (234) y el lunes 08-17, festivo de la Asunción, que no existe. */

/* ── PARTE G — cobertura de teléfono en los pacientes con cita FUTURA ─────────
   Esta es la población del alta en caliente y del recordatorio. Entra por
   `FE_FECH_CIT >= hoy` (indexado y sargable, sin envolver la columna en una
   función: el mismo criterio que usa el driver) y descarta nuestras filas de
   prueba, que se cargaron sin teléfono a propósito.

   La clasificación del teléfono REPLICA `normalizePhoneToE164Co`
   (packages/shared/src/avisos-csv.ts): se quitan espacios, guiones, paréntesis
   y puntos; se acepta un `57` delante de 10 dígitos; y solo vale un móvil de
   exactamente 3 + 9 dígitos. Todo lo demás es un teléfono que AgenIA NO va a
   guardar — y hace bien: mandarle un WhatsApp a un fijo no le llega a nadie. */
DECLARE @hoy  char(8) = CONVERT(char(8), GETDATE(), 112);
DECLARE @tope char(8) = CONVERT(char(8), DATEADD(day, 90, GETDATE()), 112);

;WITH doc AS (
    SELECT DISTINCT hist = c.NU_HIST_PAC_CIT
      FROM dbo.CITAS_MEDICAS c WITH (NOLOCK)
     WHERE c.FE_FECH_CIT >= @hoy
       AND c.FE_FECH_CIT <  @tope
       AND c.NU_HIST_PAC_CIT IS NOT NULL
       AND (c.DE_DESC_CIT IS NULL OR c.DE_DESC_CIT NOT LIKE 'PRUEBA E2E AGENIA%')
), lim AS (
    SELECT d.hist,
           ficha  = p.NU_HIST_PAC,
           limpio = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      LTRIM(RTRIM(ISNULL(p.DE_TELE_PAC, ''))),
                      ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')
      FROM doc d
      LEFT JOIN dbo.PACIENTES p WITH (NOLOCK) ON p.NU_HIST_PAC = d.hist
), num AS (
    SELECT hist, ficha,
           n = CASE WHEN LEN(limpio) = 12 AND limpio LIKE '57%'
                    THEN SUBSTRING(limpio, 3, 10)
                    ELSE limpio END
      FROM lim
)
SELECT pacientes    = COUNT(*),
       -- Sin ficha en PACIENTES: la cita existe pero el paciente no. Si aparecen,
       -- son altas que se crearían sin nombre ⇒ NO_CREAR / SIN_NOMBRE.
       sin_ficha    = SUM(CASE WHEN ficha IS NULL THEN 1 ELSE 0 END),
       movil_valido = SUM(CASE WHEN n LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' THEN 1 ELSE 0 END),
       vacio        = SUM(CASE WHEN n = '' THEN 1 ELSE 0 END),
       un_cero      = SUM(CASE WHEN n = '0' THEN 1 ELSE 0 END),
       fijo_7_u_8   = SUM(CASE WHEN LEN(n) IN (7, 8) AND n NOT LIKE '%[^0-9]%' THEN 1 ELSE 0 END),
       fijo_60x     = SUM(CASE WHEN LEN(n) = 10 AND n LIKE '60[0-9]%' THEN 1 ELSE 0 END),
       otra_basura  = SUM(CASE WHEN n <> '' AND n <> '0'
                                AND n NOT LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
                                AND NOT (LEN(n) IN (7, 8) AND n NOT LIKE '%[^0-9]%')
                                AND NOT (LEN(n) = 10 AND n LIKE '60[0-9]%')
                           THEN 1 ELSE 0 END)
  FROM num;
GO

/* MEDIDO EL 2026-09-21 EN PRUEBAS (PARTE G)                          ✅ MUY BIEN
   pacientes con cita futura : 4.352   (para 5.881 citas ⇒ 1,35 citas por paciente)
   sin ficha en PACIENTES    : 0       ⇒ NINGUNA alta se quedaría sin nombre
   con móvil válido          : 4.235 = 97,3 %   ⇒ el TECHO del recordatorio
   la basura, marginal       : 65 vacíos, 21 con «0», 18 fijos de 7-8, 2 en 60X,
                               11 otra basura = 117 (2,7 %)

   El 74,6 % de toda la tabla (ESTADO.md §3194) subestimaba: incluye 17 años de
   historias muertas. Quien agenda HOY sí tiene el teléfono capturado. Y la
   PARTE D, con su 11 %, estaba midiendo un lote cargado a mano. */

/* ── PARTE H — móviles repetidos entre historias (exposición a D4) ────────────
   D4 dice que un teléfono que ya es de OTRO documento no se asigna: el bot
   identifica a quien escribe por su número, y compartirlo dejaría a una persona
   ver o cancelar la cita de otra. Se pierde un recordatorio, no se filtra una
   cita — pero conviene saber CUÁNTOS se pierden antes de prometer cobertura.
   Se mide en el HIS porque es el indicador adelantado: de dos historias con el
   mismo móvil, la primera que llegue se lo queda y la segunda cae en
   ES_DE_OTRO_PACIENTE. */
-- Anchos holgados a propósito: `DE_TELE_PAC` es varchar(10) en la base viva pero
-- varchar(50) en las copias de 2025 (ESTADO.md §3211), y un ancho corto aquí
-- tumbaría el INSERT con «datos truncados» en vez de medir.
DECLARE @tel TABLE (hist varchar(30) PRIMARY KEY, n varchar(60));

INSERT @tel (hist, n)
SELECT p.NU_HIST_PAC,
       CASE WHEN LEN(l.limpio) = 12 AND l.limpio LIKE '57%'
            THEN SUBSTRING(l.limpio, 3, 10)
            ELSE l.limpio END
  FROM dbo.PACIENTES p WITH (NOLOCK)
 CROSS APPLY (SELECT limpio = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                       LTRIM(RTRIM(ISNULL(p.DE_TELE_PAC, ''))),
                       ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) l;

;WITH g AS (
    SELECT n, historias = COUNT(*)
      FROM @tel
     WHERE n LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
     GROUP BY n
)
SELECT moviles_validos_distintos = COUNT(*),
       compartidos               = SUM(CASE WHEN historias > 1 THEN 1 ELSE 0 END),
       historias_en_conflicto    = SUM(CASE WHEN historias > 1 THEN historias ELSE 0 END),
       maximo_por_movil          = MAX(historias)
  FROM g;

-- Los peores casos, con el número enmascarado (para pegar el resultado sin
-- pasear datos de contacto). Quite el STUFF si el hospital va a corregir fichas.
;WITH g AS (
    SELECT n, historias = COUNT(*)
      FROM @tel
     WHERE n LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
     GROUP BY n
)
SELECT TOP (10) movil = STUFF(n, 4, 3, '***'), historias
  FROM g
 WHERE historias > 1
 ORDER BY historias DESC, n;
GO

/* MEDIDO EL 2026-09-21 EN PRUEBAS (PARTE H)                        🔴 HALLAZGO
   móviles válidos distintos : 42.886
   compartidos (>1 historia) : 9.866  = 23 % de los números distintos
   historias en conflicto    : 25.748 (2,61 historias por número compartido)
   máximo por móvil          : 37     (dos números con 37 historias cada uno;
                                       el top 10 va de 18 a 37)

   Cuadra con lo ya medido: 33.020 con móvil propio + 25.748 compartido = 58.768
   historias con móvil válido, contra las 58.754 de ESTADO.md §3194 (la diferencia
   de 14 es que aquí se acepta además el «57» delante).

   ⇒ EL 43,8 % DE LOS PACIENTES CON MÓVIL LO COMPARTE con otra historia.

   🔴 Y 37 historias en un número NO es una familia: es un conmutador, el celular
   de una auxiliar, el de una institución, o un número por defecto que alguien
   teclea. D4 protege a partir del SEGUNDO, pero **el primero que llegue se queda
   con el número**: AgenIA crearía un paciente cuyo WhatsApp es la línea de un
   tercero, le mandaría ahí el recordatorio, y quien escriba desde ese número
   quedaría identificado como ese paciente y podría ver o cancelar su cita. Es
   justo el daño que D4 evita, entrando por la puerta del primer caso.

   Acción propuesta (pendiente de decidir): un teléfono que el HIS tenga en MÁS
   DE UNA historia no se asigna a nadie — un motivo nuevo en `decidirTelefono`,
   del estilo `COMPARTIDO_EN_EL_HIS`. El agente ya consulta PACIENTES por lote en
   cada vuelta con altas; puede traer de paso el conteo por teléfono (PACIENTES
   son 78.874 filas y no hay índice por DE_TELE_PAC ⇒ recorrido de tabla pequeña,
   milisegundos). Cuánto cuesta la regla en la población que agenda: PARTE I.1.

   Lo que NO se puede medir aquí: cuántos de estos documentos YA existen en
   AgenIA (eso vive en Postgres, `PatientProfile`), que es lo que decide cuántas
   altas son nuevas de verdad y cuántas se reutilizan. */

/* =============================================================================
   PARTE I — las dos preguntas que abrieron E-H
   ============================================================================= */

/* ── I.1 — ¿cuánto cuesta la regla del teléfono compartido? ────────────────────
   La PARTE H midió TODA la tabla, 17 años incluidos. Lo que importa es la
   población que agenda, y hay que separar dos casos que no son iguales:

     · `movil_en_varias_historias` — el número está repetido en el HIS aunque la
       otra historia no agende nunca. Es lo que bloquearía la regla propuesta.
     · `choque_entre_los_que_agendan` — dos personas que AMBAS tienen cita futura
       comparten el número. Estos chocan en AgenIA de todos modos, con regla o
       sin ella: hoy el primero se lo queda y el segundo cae en
       ES_DE_OTRO_PACIENTE.

   La diferencia entre las dos columnas es el precio exacto de la regla: cuántos
   recordatorios se dejarían de mandar a cambio de no mandarle el de nadie a un
   tercero. Barata: dos recorridos de PACIENTES (78.874 filas) y uno del índice
   de FE_FECH_CIT. */
DECLARE @hoy  char(8) = CONVERT(char(8), GETDATE(), 112);
DECLARE @tope char(8) = CONVERT(char(8), DATEADD(day, 90, GETDATE()), 112);

DECLARE @tel TABLE (hist varchar(30) PRIMARY KEY, n varchar(60));
INSERT @tel (hist, n)
SELECT p.NU_HIST_PAC,
       CASE WHEN LEN(l.limpio) = 12 AND l.limpio LIKE '57%'
            THEN SUBSTRING(l.limpio, 3, 10)
            ELSE l.limpio END
  FROM dbo.PACIENTES p WITH (NOLOCK)
 CROSS APPLY (SELECT limpio = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                       LTRIM(RTRIM(ISNULL(p.DE_TELE_PAC, ''))),
                       ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')) l;

DECLARE @fut TABLE (hist varchar(30) PRIMARY KEY);
INSERT @fut (hist)
SELECT DISTINCT c.NU_HIST_PAC_CIT
  FROM dbo.CITAS_MEDICAS c WITH (NOLOCK)
 WHERE c.FE_FECH_CIT >= @hoy
   AND c.FE_FECH_CIT <  @tope
   AND c.NU_HIST_PAC_CIT IS NOT NULL
   AND (c.DE_DESC_CIT IS NULL OR c.DE_DESC_CIT NOT LIKE 'PRUEBA E2E AGENIA%');

;WITH v AS (
    SELECT t.hist, t.n
      FROM @tel t
     WHERE t.n LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
), tot AS (
    SELECT n, historias = COUNT(*) FROM v GROUP BY n
), agenda AS (
    SELECT v.hist, v.n FROM v JOIN @fut f ON f.hist = v.hist
), agendan AS (
    SELECT n, cuantos = COUNT(*) FROM agenda GROUP BY n
)
SELECT agendan_con_movil           = (SELECT COUNT(*) FROM agenda),
       movil_en_varias_historias   = (SELECT COUNT(*) FROM agenda a
                                        JOIN tot t ON t.n = a.n
                                       WHERE t.historias > 1),
       choque_entre_los_que_agendan= (SELECT ISNULL(SUM(x.cuantos), 0) FROM agendan x WHERE x.cuantos > 1),
       numeros_en_choque           = (SELECT COUNT(*) FROM agendan x WHERE x.cuantos > 1),
       peor_caso                   = (SELECT MAX(x.cuantos) FROM agendan x);
GO

/* ANOTE (PARTE I.1)
   agendan con móvil            : ____________  (la PARTE G dio 4.235)
   móvil en varias historias    : ____________  ⇒ a quiénes bloquearía la regla
   choque entre los que agendan : ____________  ⇒ ya chocan hoy, con regla o sin ella
   peor caso                    : ____________
   Precio de la regla = (móvil en varias historias) − (choque entre los que agendan). */

/* ── I.2 — el patrón de los lunes: ¿comportamiento real o artefacto? ───────────
   46 citas un lunes contra 356 un martes es un séptimo, y antes de meter eso en
   ninguna proyección hay que saber qué es. El discriminador es la hora:

     · repartidas a lo largo de la jornada ⇒ el hospital DE VERDAD agenda poco el
       lunes, y entonces la bandeja del agendador estará casi vacía ese día;
     · apiladas en una sola hora ⇒ es un proceso por lotes, y el número de citas
       «elaboradas» un lunes no significa lo que parece.

   Se comparan el lunes 2026-09-07 (45 citas) y el martes 2026-09-08 (361), los
   últimos de la serie sana. Literales en 'YYYYMMDD': es el único formato que
   SQL Server lee igual con cualquier idioma del login (CLAUDE.md / MAPEO_HIS §2.1).
   ⚠️ Recorre la tabla otra vez (FE_ELAB_CIT no tiene índice): una sola corrida. */
SELECT dia   = CAST(c.FE_ELAB_CIT AS date),
       hora  = DATEPART(hour, c.FE_ELAB_CIT),
       citas = COUNT_BIG(*)
  FROM dbo.CITAS_MEDICAS c WITH (NOLOCK)
 WHERE c.FE_ELAB_CIT >= '20260907'
   AND c.FE_ELAB_CIT <  '20260909'
 GROUP BY CAST(c.FE_ELAB_CIT AS date), DATEPART(hour, c.FE_ELAB_CIT)
 ORDER BY dia, hora;
GO

/* ANOTE (PARTE I.2)
   lunes  — horas con citas : ____________  ¿reparto o pico?
   martes — horas con citas : ____________
   Conclusión               : ____________ */

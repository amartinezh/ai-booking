-- =============================================================================
-- LO ÚNICO QUE FALTA CORRER EN EL SERVIDOR DEL HOSPITAL
--
-- Todo lo demás de la Fase 0 está cerrado. Esto es el residuo, ordenado por
-- lo que decide: primero lo que BLOQUEA el go-live, después lo que confirma
-- decisiones ya tomadas.
--
--   · TODO ES 100 % LECTURA. Ni un INSERT, ni un UPDATE, ni un DELETE.
--   · Correr en ESEHSVP (el catálogo vivo). Si no hay acceso, PRUEBAS sirve
--     para B y C, pero NO para A: la pregunta de A es sobre datos reales de
--     90 días y la copia de pruebas no los tiene completos.
--   · En SSMS: clic derecho sobre la cuadrícula → "Copy with Headers" y pegar
--     el resultado completo. Cada consulta devuelve pocas filas a propósito.
--   · ✅ NINGÚN BLOQUEANTE DE GO-LIVE PENDIENTE. La sección H se corrió el
--     2026-09-04 y cerró el último: el traslado de citas del MEDICO HTA al
--     médico real NO existe como práctica (1 caso en 90 días, y hacia la otra
--     agenda virtual, sobre 80 anulaciones). 76 y 077 entran como médicos
--     normales. Ver el resultado dentro de la sección H y ESTADO.md.
--   · ⏳ PENDIENTE DE CORRER: la sección **I** — qué significa NU_ESTA_CIT = 2.
--     No bloquea el go-live, pero mientras no se conteste hay un 14,6 % de la
--     agenda histórica cuyo desenlace no llega nunca a AgenIA, y
--     `updateAttendance()` (AgenIA→HIS) sigue sin poder implementarse porque
--     no se sabe qué valor escribir para un «no asistió».
--     I.8 absorbe la curiosidad del motivo 05 de MOTIVOANUL que estaba aquí.
--   · D.7 se cerró SIN correr: decisión de producto, Fomag queda fuera de
--     alcance. Volver a correr G.4 y G.6 cada vez que se encienda un médico
--     nuevo, y D.4/G.7 en diciembre (los convenios vencen el 31-dic-2026).
--
-- CONTENIDO
--   A. ✅ CORRIDA — y la respuesta es la mala: el 72,5 % de los turnos
--      MEZCLA servicios. Ver el resultado dentro de la sección.
--   B. ✅ CORRIDA (ya con la corrección de FE_HORA_CIT): 3 + 2 + 2 + 74
--      filas. Falta pegar el CONTENIDO de esas filas.
--   C. ✅ CORRIDA Y CERRADA — la forma sargable gasta 28 ms de CPU contra
--      511 ms de la vieja. El espejo le cuesta al HIS 0,09 % de un núcleo.
--   D. ✅ CORRIDA Y CERRADA — confirmada 18/18 contra el catálogo REGIMEN.
--   E. ✅ CORRIDA — CERO médicos «verdes». 14 amarillos, 15 rojos.
--   F. ✅ CORRIDA — el detalle por médico. Reclasificó el semáforo: con
--      umbral de ruido son 4 verdes, 20 amarillos y solo 6 rojos.
--   G.1 ⚠️ CORRIDA, NO CONCLUYENTE — la escribí uniendo por R_PAC_EPS, que es
--      un historial y multiplica cada cita. Ninguna cuota es fiable.
--   G.2 ✅ CORRIDA — SUR ⟹ Sura siempre (367/367), pero Sura NO ⟹ SUR: el
--      60 % de las citas de Sura van con ESP. Y destapó el bloqueante: los
--      especialistas facturan a convenios de EVENTO que AgenIA no tiene.
--   G.3 ✅ CORRIDA — CONFIRMADO: la 1ª cita del paciente lleva 8902xx en el
--      91,6-99,7 % de los casos; las siguientes, en el 11-45 %.
--   G.4 ✅ CORRIDA — las 45 especialidades que había son correctas al 100 %,
--      pero faltaban NUEVE servicios más (los de curso de vida del 80-1), sin
--      especialidad Y sin marcar como PyP. Y R_ESP_SER discrepa en 22 de 54:
--      no sirve como fuente. Volver a correrla al encender cada médico.
--   G.5 ✅ CORRIDA — cápita vs evento confirmado, con los NIT. Salud Total es
--      un TERCIO del hospital (10.137 citas/90d) y no estaba en AgenIA.
--      Nueva EPS no tiene convenio de evento. Abre una duda sobre el 473.
--   G.6 ✅ CORRIDA — 32 servicios cápita (<0,6 %) y 16 evento (>90 %). Sin
--      zona gris. Corrigió dos cosas: NUTRICIÓN sí es evento (el medico NU02
--      NO estaba a salvo), y el «MIXTO» de 890284ESP no es ambiguo.
--   I. ⏳ PENDIENTE — ¿qué es NU_ESTA_CIT = 2? Ocho consultas de solo lectura;
--      la última (I.7) genera diez citas concretas para que el hospital las
--      mire en su pantalla, que es la única prueba definitiva.
--   G.7 ✅ CORRIDA — los cuatro convenios de Salud Total vigentes hasta el
--      31-dic-2026 (renovación a 4 meses). El NIT de Fomag es en realidad
--      una FIDUCIARIA que administra varios contratos del Estado, y su
--      padrón está 100 % bajo un código de régimen (15) que NO es ni
--      SUBSIDIADO ni CONTRIBUTIVO. Abrió D.7, que deja de ser opcional.
--
-- El detalle de POR QUÉ se pregunta cada cosa está en
-- FASE0_DESCUBRIMIENTO_HIS.sql (bloques 31, 25, 29 y 16/19). Este archivo es
-- solo el extracto ejecutable, para no hacer leer 1.700 líneas a quien tiene
-- el acceso.
-- =============================================================================
USE ESEHSVP;
GO

-- =============================================================================
-- A. 🚨 BLOQUEANTE — ¿un turno del médico mezcla servicios? (bloque 31b)
--
-- Es la única pregunta abierta que puede hacer que AgenIA facture mal.
--
-- Hoy AgenIA le pone a cada cupo el ÚNICO servicio del médico, porque
-- TURNOS_MEDICOS no lleva servicio. Pero 47 médicos prestan más de uno (uno
-- de ellos, once). Si un mismo bloque de turno mezcla servicios, el cupo que
-- el paciente reserva viaja con CD_CODI_SER_CIT equivocado — y ese campo
-- determina el convenio de facturación.
--
-- CÓMO SE LEE EL RESULTADO
--   · Si casi todos los turnos salen con servicios_en_el_turno = 1
--     ⇒ el cupo hereda el servicio del turno. Se arregla en el driver, sin
--       tocar el modelo de AgenIA. Camino corto.
--   · Si una parte apreciable sale con 2 o más
--     ⇒ el cupo es "médico + hora" y el servicio lo elige el paciente al
--       reservar. Eso cambia el modelo de disponibilidad de AgenIA
--       (ScheduleSlot.serviceId es obligatorio hoy) y es decisión de
--       producto, no solo del espejo. Camino largo.
--
-- ═══ RESULTADO (2026-09-02, ESEHSVP) — ES EL CAMINO LARGO ═══════════════════
--
--   servicios_en_el_turno   turnos      %      acumulado
--            1               512      27,5 %     27,5 %
--            2               669      36,0 %     63,5 %
--            3               394      21,2 %     84,7 %
--            4               136       7,3 %     92,0 %
--            5                88       4,7 %     96,7 %
--            6                50       2,7 %     99,4 %
--            7                11       0,6 %    100,0 %
--                          ─────
--                           1.860 turnos
--
--   ⇒ El 72,5 % de los turnos MEZCLA servicios. Solo 512 son de uno solo.
--
--   Y la segunda consulta cierra la puerta de atrás: `CD_CODI_ESP_TUME` está
--   en NULL en los 1.223 turnos futuros (con_especialidad = 0). El turno no
--   trae servicio NI especialidad. No hay ninguna fuente de "servicio" a
--   nivel de turno — ni la que se esperaba como plan B.
--
--   Los servicios que conviven confirman que no son variantes del mismo acto:
--     S39141    Consulta ambulatoria de medicina general      5.484
--     S39141-1  Consulta ambulatoria control hipertensos      3.669
--     SCITOD    CITA ODONTOLOGICA                             1.077
--     S39141-2  Consulta Ambulatoria Lectura de examenes      1.014
--     890201-CI Citas de PyDT                                   923   ← PyP
--     997301-1  CITA SALUD ORAL DOBLE                           907   ← PyP
--     I890305PL CONTROL ENFERMERIA PLANIFICACION FAMILIAR       540   ← PyP
--     I890301AG CONSULTA MEDICA DE CONTROL A LA GESTANTE        406   ← PyP
--
--   Que en un mismo turno convivan servicios PyP y no-PyP es lo que convierte
--   esto en un problema de FACTURACIÓN y no solo de catalogación: el convenio
--   depende de si el servicio es de PyP (489 PYPSUBS vs 283 NUEVASUBSID para
--   Nueva EPS subsidiado).
--
--   CONSECUENCIA. Hoy `mirror-availability.service.ts` le pone a cada cupo el
--   `DoctorProfile.serviceId` — el único servicio configurado del médico. Eso
--   produce dos cosas:
--     · Sub-oferta: de los N servicios que presta el médico, el chatbot solo
--       puede ofrecer uno. No es incorrecto, es incompleto.
--     · Código de servicio equivocado en el HIS: si el paciente pide una cosa
--       y el médico tiene configurada otra, `CD_CODI_SER_CIT` viaja mal. Y si
--       la diferencia cruza la frontera PyP/no-PyP, el convenio también.
--
--   El propio código ya lo anticipaba en un comentario: «el turno es del
--   médico, y el servicio se elige al agendar». Se resolvió por el camino
--   corto porque `ScheduleSlot.serviceId` es obligatorio. Los datos dicen que
--   el camino corto no alcanza.
--
--   QUÉ HACER: ver la sección E (puerta del piloto) para desbloquear ya, y
--   ESTADO.md para el cambio de modelo que exige el go-live completo.
-- =============================================================================

SELECT servicios_en_el_turno, COUNT(*) AS turnos
FROM (
    SELECT t.NU_NUME_TUME,
           COUNT(DISTINCT c.CD_CODI_SER_CIT) AS servicios_en_el_turno
    FROM dbo.TURNOS_MEDICOS t
    JOIN dbo.CITAS_MEDICAS c
      ON  c.CD_CODI_MED_CIT = t.CD_MED_TUME
      AND CAST(c.FE_FECH_CIT AS date) = CAST(t.FE_FECH_TUME AS date)
      -- La hora de la cita, dentro del rango del bloque: un médico puede
      -- tener turno de mañana y de tarde el mismo día, y contarlos juntos
      -- falsearía el resultado. FE_HORA_CIT es 'YYYY/MM/DD HH:MM'.
      AND SUBSTRING(c.FE_HORA_CIT, 12, 5) >= CONVERT(varchar(5), t.FE_HOIN_TUME, 108)
      AND SUBSTRING(c.FE_HORA_CIT, 12, 5) <  CONVERT(varchar(5), t.FE_HOFI_TUME, 108)
    WHERE t.FE_FECH_TUME >= DATEADD(day, -90, CAST(GETDATE() AS date))
      AND t.FE_FECH_TUME <  DATEADD(day,   1, CAST(GETDATE() AS date))
    GROUP BY t.NU_NUME_TUME
) x
GROUP BY servicios_en_el_turno
ORDER BY servicios_en_el_turno;

-- Y, si hay turnos que mezclan, de qué se trata: ¿variantes del mismo acto
-- (control y primera vez) o especialidades distintas de verdad?
SELECT TOP 15
       t.CD_CODI_ESP_TUME AS esp_del_turno,
       c.CD_CODI_SER_CIT  AS servicio,
       s.NO_NOMB_SER      AS nombre_servicio,
       COUNT(*)           AS citas
FROM dbo.TURNOS_MEDICOS t
JOIN dbo.CITAS_MEDICAS c
  ON  c.CD_CODI_MED_CIT = t.CD_MED_TUME
  AND CAST(c.FE_FECH_CIT AS date) = CAST(t.FE_FECH_TUME AS date)
  AND SUBSTRING(c.FE_HORA_CIT, 12, 5) >= CONVERT(varchar(5), t.FE_HOIN_TUME, 108)
  AND SUBSTRING(c.FE_HORA_CIT, 12, 5) <  CONVERT(varchar(5), t.FE_HOFI_TUME, 108)
LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
WHERE t.FE_FECH_TUME >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND t.FE_FECH_TUME <  DATEADD(day,   1, CAST(GETDATE() AS date))
GROUP BY t.CD_CODI_ESP_TUME, c.CD_CODI_SER_CIT, s.NO_NOMB_SER
ORDER BY citas DESC;

-- ¿Está poblada CD_CODI_ESP_TUME? Si lo está, el turno ya trae su
-- especialidad y sería la fuente natural del servicio del cupo.
SELECT COUNT(*) AS turnos_futuros,
       COUNT(CD_CODI_ESP_TUME) AS con_especialidad,
       COUNT(DISTINCT CD_CODI_ESP_TUME) AS especialidades_distintas
FROM dbo.TURNOS_MEDICOS
WHERE FE_FECH_TUME >= CAST(GETDATE() AS date);


-- =============================================================================
-- B. CONFIRMACIONES — no bloquean, pero cierran hipótesis vivas
-- =============================================================================

-- ── B.1 El consultorio de la cita, ¿sale siempre del turno? (bloque 25a)
--
-- Es la regla que el driver YA aplica al escribir (lee TURNOS_MEDICOS en el
-- momento). Está confirmada por un caso manual y una muestra puntual; falta
-- verla a escala. Si 'DIFIERE' + 'SIN_TURNO_QUE_CUBRA' queda por debajo del
-- 5 %, la regla es correcta y no hay nada que cambiar.
--
-- ⚠️ CORREGIDA (2026-09-02). La primera versión reventaba con
--    «Mens. 241 — Error al convertir una cadena de caracteres en fecha y/u
--    hora», y al hacerlo se llevaba por delante el resto del lote (B.2 nunca
--    llegó a correr). Tres defectos, los tres documentados desde el bloque 5
--    y que la consulta ignoraba:
--
--      1. `FE_HORA_CIT` tiene DATA LEGADA SUCIA: longitudes 12/13, incluso
--         una fila con '2026/08/29 1' y otra con '31'. `CAST(... AS TIME)`
--         sobre eso lanza. MAPEO_HIS.md ya lo decía: «lector tolerante,
--         escritor estricto». Se pasa a TRY_CAST, que devuelve NULL en vez
--         de reventar — y esas filas caen solas en SIN_TURNO_QUE_CUBRA,
--         que es exactamente donde deben estar.
--      2. `RIGHT(FE_HORA_CIT, 5)` asume 16 caracteres. Con una fila corta
--         devuelve basura. Se usa `SUBSTRING(..., 12, 5)`, la misma forma
--         que la sección A.
--      3. `t.FE_FECH_TUME = c.FE_FECH_CIT` compara datetimes completos. Si
--         alguno trae hora, no empareja nunca. Se compara por fecha, igual
--         que en A.
--
--    También se separan las consultas con GO: un fallo en una ya no impide
--    que corran las demás.
SELECT resultado, COUNT(*) AS total FROM (
    SELECT CASE
        WHEN c.CD_CODI_CONS_CIT = t.CD_CODI_CONS_TUME THEN 'COINCIDE'
        WHEN t.NU_NUME_TUME IS NULL THEN 'SIN_TURNO_QUE_CUBRA'
        ELSE 'DIFIERE'
        END AS resultado
    FROM dbo.CITAS_MEDICAS c
    LEFT JOIN dbo.TURNOS_MEDICOS t
        ON  t.CD_MED_TUME = c.CD_CODI_MED_CIT
        AND CAST(t.FE_FECH_TUME AS date) = CAST(c.FE_FECH_CIT AS date)
        AND TRY_CAST(SUBSTRING(c.FE_HORA_CIT, 12, 5) AS TIME)
              >= CAST(t.FE_HOIN_TUME AS TIME)
        AND TRY_CAST(SUBSTRING(c.FE_HORA_CIT, 12, 5) AS TIME)
              <  CAST(t.FE_HOFI_TUME AS TIME)
    WHERE c.FE_ELAB_CIT >= DATEADD(DAY,-30,GETDATE())
      AND c.NU_ESTA_CIT = 0
) x
GROUP BY resultado
ORDER BY total DESC;
GO

-- Cuánta de esa data sucia hay, para saber si el SIN_TURNO_QUE_CUBRA de
-- arriba es "el médico no atendía" o "la hora es ilegible".
SELECT CASE WHEN TRY_CAST(SUBSTRING(FE_HORA_CIT, 12, 5) AS TIME) IS NULL
            THEN 'HORA ILEGIBLE' ELSE 'hora válida' END AS estado,
       COUNT(*) AS citas
FROM dbo.CITAS_MEDICAS
WHERE FE_ELAB_CIT >= DATEADD(DAY,-30,GETDATE())
GROUP BY CASE WHEN TRY_CAST(SUBSTRING(FE_HORA_CIT, 12, 5) AS TIME) IS NULL
              THEN 'HORA ILEGIBLE' ELSE 'hora válida' END;
GO

-- ── B.2 El consecutivo de sesión NU_NUME_CONE_CIT (bloque 21a)
--
-- CONTEXTO: ya se comprobó contra el esquema real que la columna ADMITE
-- NULOS, así que el INSERT del driver —que no la escribe— no puede fallar por
-- esto. La pregunta que queda es de FIDELIDAD, no de corrección: si los
-- informes del hospital agrupan por sesión, las citas de WhatsApp quedarían
-- fuera de esa agrupación.
--
-- La pista del bloque 27e: HIST_AUDIT.NU_NUME_CONE_HAUD trae valores del
-- mismo rango. Esto mira si de verdad son la misma secuencia.
SELECT 'CITAS_MEDICAS' AS origen,
       MIN(NU_NUME_CONE_CIT) AS minimo, MAX(NU_NUME_CONE_CIT) AS maximo,
       COUNT(DISTINCT NU_NUME_CONE_CIT) AS distintos,
       SUM(CASE WHEN NU_NUME_CONE_CIT IS NULL THEN 1 ELSE 0 END) AS nulos
FROM dbo.CITAS_MEDICAS
WHERE FE_ELAB_CIT >= DATEADD(DAY,-30,GETDATE())
UNION ALL
SELECT 'HIST_AUDIT',
       MIN(NU_NUME_CONE_HAUD), MAX(NU_NUME_CONE_HAUD),
       COUNT(DISTINCT NU_NUME_CONE_HAUD),
       SUM(CASE WHEN NU_NUME_CONE_HAUD IS NULL THEN 1 ELSE 0 END)
FROM dbo.HIST_AUDIT;
GO

-- ¿Cuántas citas comparte un mismo consecutivo? Si son varias, es una sesión
-- de trabajo (una agendadora atendiendo en tanda) y no un id por cita.
SELECT citas_por_consecutivo, COUNT(*) AS consecutivos FROM (
    SELECT NU_NUME_CONE_CIT, COUNT(*) AS citas_por_consecutivo
    FROM dbo.CITAS_MEDICAS
    WHERE FE_ELAB_CIT >= DATEADD(DAY,-30,GETDATE())
      AND NU_NUME_CONE_CIT IS NOT NULL
    GROUP BY NU_NUME_CONE_CIT
) x
GROUP BY citas_por_consecutivo
ORDER BY citas_por_consecutivo;
GO

-- ¿Existe una tabla de consecutivos que la aplicación incremente?
SELECT name AS tabla FROM sys.tables
WHERE name LIKE '%CONSECUTIV%' OR name LIKE '%CONEXION%' OR name LIKE '%SESION%'
ORDER BY name;


-- =============================================================================
-- C. MEDICIÓN DE COSTO — ✅ CORRIDA Y CERRADA EL 2026-09-03.
--
-- RESULTADO (pestaña Messages, 371 filas en la ventana):
--
--                              exámenes   lecturas lógicas   CPU      transcurrido
--   (29c) sargable — HOY            1          16.655        28 ms       28 ms
--   (29d) con CONVERT — ANTES      21          23.131       511 ms       29 ms
--
-- Lo que importa no es el tiempo de reloj (idéntico, 28 vs 29 ms) sino el CPU:
-- **18 veces menos**. La forma vieja tardaba lo mismo porque SQL Server la
-- paralelizaba —21 exámenes son los hilos del plan paralelo— y para eso quemaba
-- medio segundo de CPU del servidor del hospital en cada vuelta. El agente
-- corre este ciclo cada 30 s (`inboundIntervalMs`): son 1,7 % de un núcleo con
-- la forma vieja frente a 0,09 % con la actual, permanentemente y sin que nadie
-- lo note hasta que el hospital tiene un día cargado.
--
-- Las 16.655 lecturas lógicas (~130 MB) salieron TODAS de la caché — 0 lecturas
-- físicas — así que no hay E/S de disco añadida. El coste real del espejo sobre
-- el HIS es despreciable, y la decisión del 2026-09-02 queda confirmada con
-- números en vez de con un argumento.
--
-- ── Contexto original ────────────────────────────────────────────────────────
-- La decisión ya se tomó: las cuatro consultas del driver se pasaron a la
-- forma sargable el 2026-09-02, porque el hospital SÍ tiene un índice cuya
-- primera columna es FE_FECH_CIT y envolverla en CONVERT lo inutilizaba.
-- Esto es la confirmación, y responde el matiz que quedaba: la ventana son
-- ~28.000 de 1.084.093 filas (2,6 %), justo donde el optimizador a veces
-- prefiere escanear igual porque el SELECT pide columnas que el índice no
-- cubre.
--
-- Vuelca a variables para que NO salgan las 28.000 filas: el resultado está
-- en la pestaña "Messages", no en la cuadrícula. Copiar ESA pestaña.
-- =============================================================================
SET STATISTICS IO, TIME ON;
GO

DECLARE @med varchar(4), @hora varchar(18), @hist varchar(20), @dura int;

PRINT '--- (29c) FORMA SARGABLE (la que usa el driver hoy) ---';
SELECT @med = CD_CODI_MED_CIT, @hora = FE_HORA_CIT,
       @hist = NU_HIST_PAC_CIT, @dura = NU_DURA_CIT
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= CAST(GETDATE() AS date)
  AND FE_FECH_CIT <  DATEADD(day, 90, CAST(GETDATE() AS date));

PRINT '--- (29d) FORMA VIEJA, NO sargable (para comparar) ---';
SELECT @med = CD_CODI_MED_CIT, @hora = FE_HORA_CIT,
       @hist = NU_HIST_PAC_CIT, @dura = NU_DURA_CIT
FROM dbo.CITAS_MEDICAS
WHERE CONVERT(varchar(10), FE_FECH_CIT, 23)
      BETWEEN CONVERT(varchar(10), GETDATE(), 23)
          AND CONVERT(varchar(10), DATEADD(day, 90, GETDATE()), 23);
GO

SET STATISTICS IO, TIME OFF;
GO


-- =============================================================================
-- D. CONVENIOS — ✅ CORRIDA Y CERRADA EL 2026-09-02.
--
-- QUÉ ENCONTRÓ
--
--   1. 🚨 LOS NIT ESTABAN CRUZADOS. La tabla EPS del hospital dice
--      800088702 = EPS SURAMERICANA y 900156264 = NUEVA EPS, que son los NIT
--      públicos correctos. AgenIA los tenía al revés en su tabla `Eps`, y
--      `mapping.json` repetía el mismo cruce: los dos errores se cancelaban y
--      el convenio salía bien por accidente. Corregidos LOS DOS a la vez.
--
--   2. El convenio dominante de cada combinación, en 90 días de citas reales:
--
--        Sura      SUBSIDIADO   normal → 467 SUBS          84,5% de 7.770
--        Sura      SUBSIDIADO   PyP    → 467 SUBS          94,3% de 2.566
--        Sura      CONTRIBUTIVO normal → 473 CONTRIBUTIVO  84,8% de 3.675
--        Sura      CONTRIBUTIVO PyP    → 473 CONTRIBUTIVO  88,0% de   615
--        Nueva EPS SUBSIDIADO   normal → 283 NUEVASUBSID   89,6% de 3.920
--        Nueva EPS SUBSIDIADO   PyP    → 489 PYPSUBS       94,4% de 2.001
--        Nueva EPS CONTRIBUTIVO normal → 473 CONTRIBUTIVO  73,4% de 2.406
--        Nueva EPS CONTRIBUTIVO PyP    → 473 CONTRIBUTIVO  65,6% de   390
--
--      Dos consecuencias que la tabla vieja no tenía:
--        · Nueva EPS CONTRIBUTIVO iba al 283, que es NUEVASUBSID — un
--          contrato SUBSIDIADO. Corregido a 473.
--        · El PyP dependía solo de la EPS (`${nit}|PYP`), así que se aplicaba
--          también al contributivo. Ahora la clave lleva el régimen
--          (`${nit}|${REGIMEN}|PYP`) y solo Nueva EPS subsidiado la tiene.
--          Sura no tiene convenio propio de PyP: usa el de su régimen.
--
--   3. Los códigos de régimen del hospital (D.1) son más finos que
--      subsidiado/contributivo: 01 y 02 se comportan como SUBSIDIADO; 07, 08,
--      09, 10, 11 y 12 como CONTRIBUTIVO. No afecta al driver —AgenIA le
--      pregunta el régimen al paciente y usa su propio vocabulario— pero hace
--      falta para leer estas tablas.
--
--   4. ✅ EL FAN-OUT NO CAMBIA LA CONCLUSIÓN — y se puede demostrar.
--
--      `R_PAC_EPS` es un historial many-to-many, así que la cita de un
--      paciente con varias afiliaciones se cuenta una vez por afiliación. Eso
--      ensucia la cola de cada bucket (aparecen 476 Salud Total, 97 Sura
--      eventos) y explica que Nueva EPS contributivo salga al 73 % y no al
--      85-94 % del resto.
--
--      Pero el fan-out solo puede INFLAR un conteo, nunca esconderlo: si el
--      hospital facturara a un convenio X, X aparecería al menos tantas veces
--      como citas reales tenga. Sumando D.2 por convenio se obtiene una COTA
--      SUPERIOR del uso real:
--
--          467 SUBS ............. ≤ 9.377      476 STCONTRIB ....... ≤   472
--          473 CONTRIBUTIVO ..... ≤ 6.285      475 STOTALSUBS ...... ≤   459
--          283 NUEVASUBSID ...... ≤ 3.796      ...
--          489 PYPSUBS .......... ≤ 2.284      290 NUEVAEPSCONT .... ≤     2
--
--      Nueva EPS contributivo arrastra ~3.550 filas de cita en la consulta.
--      Esas citas se facturaron a ALGO, y el único convenio de contributivo
--      con volumen suficiente es el 473. El 290 `NUEVAEPSCONT` —el candidato
--      "correcto" por nombre— tiene una cota superior de DOS citas en 90
--      días: el hospital no lo usa. Queda descartado sin necesidad de
--      deduplicar.
--
--      (Comprobación adicional: la consulta D.5 —quedarse con los pacientes
--      de UNA sola afiliación— devolvió CERO filas. No hay ninguno: todo
--      paciente acumula varias. Coherente con D.1, donde los códigos 'P'
--      (125.403) y 'F' (78.729) superan al número de pacientes (78.654), así
--      que cada uno tiene al menos esas dos filas. Por eso la vía de
--      deduplicar por "afiliación única" no existe aquí, y el argumento de la
--      cota superior es el que resuelve.)
--
--   5. ✅ CONFIRMADO CONTRA EL CATÁLOGO OFICIAL (D.7, 2026-09-02).
--
--      `REGIMEN` existe y se une a `TIPO_REGIMEN_RESOL4505` por
--      `TX_CODI_RTT_REG`, que es el tipo de régimen de la Resolución 4505:
--
--          01 SUB NIVEL 1 ...... tipo 2 SUBSIDIADO
--          02 SUB NIVEL 2 ...... tipo 2 SUBSIDIADO
--          14 SUB NIVEL 0 ...... tipo 2 SUBSIDIADO
--          07 COTIZANTE R1 ..... tipo 1 CONTRIBUTIVO
--          08 COTIZANTE R2 ..... tipo 1 CONTRIBUTIVO
--          09 COTIZANTE R3 ..... tipo 1 CONTRIBUTIVO
--          10 BENEFICIARIO R1 .. tipo 1 CONTRIBUTIVO
--          11 BENEFICIARIO R2 .. tipo 1 CONTRIBUTIVO
--          12 BENEFICIARIO R3 .. tipo 1 CONTRIBUTIVO
--          18 CONTRIB DESPLAZ .. tipo 1 CONTRIBUTIVO
--
--      Cruzando ESE catálogo con el convenio dominante observado en D.2, las
--      DIECIOCHO combinaciones (eps × régimen) concuerdan: todo régimen de
--      tipo SUBSIDIADO lleva a 467/283/489 y todo régimen de tipo
--      CONTRIBUTIVO lleva a 473. 18 de 18, cero excepciones.
--
--      Ya no es una lectura de los nombres de los convenios: es el catálogo
--      oficial del hospital confirmando la tabla de forma independiente.
--
--      (De paso: 'P' = OTRO y 'F' = FOSYGA, los dos códigos más frecuentes de
--      D.1, son tipos 5 NO ASEGURADO y 3 EXCEPCIÓN. No aparecen en las citas
--      de estas dos EPS porque no son afiliaciones de EPS.)
--
--   6. `NU_ESTA_RPE` / `TX_ACTI_RPE`: la combinación (1,'S') domina con
--      376.865 filas de 443.034. Pero son ~4,8 por paciente, así que ni
--      filtrando por "afiliación vigente" se llega a una sola. La vía de
--      deduplicar queda descartada por partida doble.
--
-- Las consultas siguen aquí para poder repetirlas cuando cambien los
-- convenios (todos vencen el 31-dic y el HIS los extiende).
-- =============================================================================

-- (D.1) Códigos de régimen que usa el hospital (no los conocemos aún).
SELECT CD_CODI_REG_RPE AS regimen, COUNT(*) AS afiliaciones
FROM dbo.R_PAC_EPS
GROUP BY CD_CODI_REG_RPE
ORDER BY afiliaciones DESC;

-- (D.2) 🔑 LA TABLA DE VERDAD: qué convenio usan REALMENTE las citas de cada
-- combinación EPS + régimen, en 90 días. Si una combinación concentra sus
-- citas en un solo convenio, esa es la respuesta y no hay nada que discutir.
SELECT  r.CD_NIT_EPS_RPE            AS nit_eps,
        e.NO_NOMB_EPS               AS eps,
        r.CD_CODI_REG_RPE           AS regimen,
        c.NU_NUME_CONV_CIT          AS convenio,
        cv.CD_CODI_CONV             AS nombre_convenio,
        COUNT(*)                    AS citas
FROM dbo.CITAS_MEDICAS c
JOIN dbo.R_PAC_EPS r  ON r.NU_HIST_PAC_RPE = c.NU_HIST_PAC_CIT
LEFT JOIN dbo.EPS e   ON e.CD_NIT_EPS      = r.CD_NIT_EPS_RPE
LEFT JOIN dbo.CONVENIOS cv ON cv.NU_NUME_CONV = c.NU_NUME_CONV_CIT
WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
  -- Las dos EPS que el chatbot ofrece hoy. Quitar el filtro para ver todas.
  AND r.CD_NIT_EPS_RPE IN ('800088702', '900156264')
GROUP BY r.CD_NIT_EPS_RPE, e.NO_NOMB_EPS, r.CD_CODI_REG_RPE,
         c.NU_NUME_CONV_CIT, cv.CD_CODI_CONV
ORDER BY nit_eps, regimen, citas DESC;

-- (D.3) Lo mismo, separando los servicios de PyP — que usan convenio propio.
-- La lista es `serviciosPyp` de mapping.json (derivada del catálogo del
-- bloque 32e: los servicios cuya especialidad es de la familia PyDT).
SELECT  r.CD_NIT_EPS_RPE   AS nit_eps,
        r.CD_CODI_REG_RPE  AS regimen,
        CASE WHEN c.CD_CODI_SER_CIT IN (
               '890201-CI','I890301AG','890201AD','890201PI','I890201AG',
               'I890201PL1','I890301G','I890301RN','890201AV',
               '990203','997301-1','SSAO','890208Ges','I890305PL'
             ) THEN 'PYP' ELSE 'NORMAL' END AS tipo_servicio,
        c.NU_NUME_CONV_CIT AS convenio,
        cv.CD_CODI_CONV    AS nombre_convenio,
        COUNT(*)           AS citas
FROM dbo.CITAS_MEDICAS c
JOIN dbo.R_PAC_EPS r ON r.NU_HIST_PAC_RPE = c.NU_HIST_PAC_CIT
LEFT JOIN dbo.CONVENIOS cv ON cv.NU_NUME_CONV = c.NU_NUME_CONV_CIT
WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
  AND r.CD_NIT_EPS_RPE IN ('800088702', '900156264')
GROUP BY r.CD_NIT_EPS_RPE, r.CD_CODI_REG_RPE,
         CASE WHEN c.CD_CODI_SER_CIT IN (
               '890201-CI','I890301AG','890201AD','890201PI','I890201AG',
               'I890201PL1','I890301G','I890301RN','890201AV',
               '990203','997301-1','SSAO','890208Ges','I890305PL'
             ) THEN 'PYP' ELSE 'NORMAL' END,
         c.NU_NUME_CONV_CIT, cv.CD_CODI_CONV
ORDER BY nit_eps, regimen, tipo_servicio, citas DESC;

-- (D.4) ¿Los cinco convenios que el driver usa siguen vigentes? Todos vencen
-- 31-dic y el HIS los extiende: si alguno caducó, las citas nuevas se
-- facturarían a un contrato muerto.
SELECT c.NU_NUME_CONV, c.CD_CODI_CONV, e.NO_NOMB_EPS,
       c.FE_INIC_CONV, c.FE_FINA_CONV, c.NU_VIGE_CONV,
       CASE WHEN GETDATE() BETWEEN c.FE_INIC_CONV AND c.FE_FINA_CONV
            THEN 'VIGENTE' ELSE '⚠️ NO VIGENTE' END AS estado_hoy
FROM dbo.CONVENIOS c
LEFT JOIN dbo.EPS e ON e.CD_NIT_EPS = c.CD_NIT_EPS_CONV
WHERE c.NU_NUME_CONV IN (26, 283, 467, 473, 489)
ORDER BY c.NU_NUME_CONV;


-- ── D.7 ⛔ CERRADA SIN CORRER — decisión de producto: Fomag queda fuera (2026-09-03)
--
-- Nació como verificación de cierre (confirmar 01/02/14 = SUBSIDIADO,
-- 07-12/18 = CONTRIBUTIVO) y G.7 la volvió urgente al encontrar que el
-- padrón de Fomag/La Previsora (NIT 830053105) está 100 % bajo un código de
-- régimen (`15`) ajeno a esos dos. Antes de correrla se decidió que
-- **AgenIA no va a soportar Fomag** — es el 2,4 % del volumen y la
-- estructura que destapó G.7 (una fiduciaria, no una EPS; un régimen de
-- excepción que el chatbot no sabe preguntar) no justifica el trabajo.
--
-- Con esa decisión, decodificar el código 15 no desbloquea nada: no hay
-- ningún camino en el que el resultado cambie una línea de código o de
-- mappingJson. Se deja SIN CORRER a propósito.
--
-- Si algún día se revierte la decisión de no soportar Fomag, esta consulta
-- sigue siendo el primer paso — no se borra, se reabre.
--
-- SELECT * FROM dbo.REGIMEN;
-- SELECT * FROM dbo.TIPO_REGIMEN_RESOL4505;

-- Y qué marca la afiliación vigente, para futuras consultas sobre R_PAC_EPS.
SELECT NU_ESTA_RPE, TX_ACTI_RPE, COUNT(*) AS filas
FROM dbo.R_PAC_EPS
GROUP BY NU_ESTA_RPE, TX_ACTI_RPE
ORDER BY filas DESC;


-- =============================================================================
-- E. 🚦 LA PUERTA DEL PILOTO — ¿qué médicos son seguros HOY?
--
-- La sección A dejó claro que el modelo de AgenIA («un cupo tiene UN
-- servicio») no representa a este hospital: el 72,5 % de los turnos mezcla.
-- Arreglarlo de raíz es un cambio de modelo de datos (ver ESTADO.md).
--
-- Pero el piloto se activa MÉDICO POR MÉDICO (`DoctorProfile
-- .whatsappBookingEnabled`), y no todos los médicos tienen el problema. Esta
-- consulta clasifica a los que tienen turnos futuros en tres semáforos, para
-- poder arrancar con los que ya son correctos en vez de esperar al cambio de
-- modelo.
--
--   🟢 VERDE   — presta UN solo servicio. Lo que AgenIA escriba es exacto.
--                Activable hoy, sin reservas.
--   🟡 AMARILLO— presta varios servicios, pero TODOS comparten especialidad y
--                todos están del mismo lado de la frontera PyP. El convenio y
--                la especialidad salen bien; solo el código de servicio puede
--                ser impreciso (afecta los informes del hospital, no la
--                factura). Activable con el hospital avisado.
--   🔴 ROJO    — mezcla especialidades o cruza la frontera PyP. Aquí el
--                convenio PUEDE salir mal. NO activar hasta el cambio de
--                modelo.
--
-- ⚠️ SOLO LECTURA.
-- =============================================================================
-- ⚠️ CORREGIDA (2026-09-03). La primera versión reventaba con «Mens. 130 —
--    No es posible usar una función de agregado con una expresión que
--    contiene un agregado o una subconsulta», cuatro veces. La causa era
--    `SUM(CASE WHEN servicio IN (SELECT s FROM pyp) THEN 1 ELSE 0 END)`: SQL
--    Server no admite una SUBCONSULTA dentro del argumento de un agregado.
--    La marca de PyP se resuelve ahora con un LEFT JOIN a la lista, y el
--    agregado suma una columna normal. Validada contra un SQL Server real
--    (el mock local) antes de mandarla.

WITH pyp AS (
    -- Misma lista que `serviciosPyp` de mapping.json (familia PyDT, bloque 32e).
    SELECT s FROM (VALUES
        ('890201-CI'),('I890301AG'),('890201AD'),('890201PI'),('I890201AG'),
        ('I890201PL1'),('I890301G'),('I890301RN'),('890201AV'),
        ('990203'),('997301-1'),('SSAO'),('890208Ges'),('I890305PL')
    ) v(s)
),
con_turnos AS (
    SELECT DISTINCT CD_MED_TUME AS medico
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
),
citas AS (
    -- La marca de PyP se resuelve AQUÍ, por JOIN. Meterla como subconsulta
    -- dentro del SUM de abajo es lo que disparaba el error 130.
    SELECT  c.CD_CODI_MED_CIT AS medico,
            c.CD_CODI_SER_CIT AS servicio,
            c.CD_CODI_ESP_CIT AS especialidad,
            CASE WHEN p.s IS NULL THEN 0 ELSE 1 END AS es_pyp
    FROM dbo.CITAS_MEDICAS c
    JOIN con_turnos t ON t.medico = c.CD_CODI_MED_CIT
    LEFT JOIN pyp p   ON p.s = c.CD_CODI_SER_CIT
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
),
actividad AS (
    SELECT  medico,
            COUNT(DISTINCT servicio)     AS servicios,
            COUNT(DISTINCT especialidad) AS especialidades,
            SUM(es_pyp)                  AS citas_pyp,
            SUM(1 - es_pyp)              AS citas_normales,
            COUNT(*)                     AS citas
    FROM citas
    GROUP BY medico
)
SELECT  a.medico,
        m.NO_NOMB_MED       AS nombre,
        a.servicios,
        a.especialidades,
        a.citas_pyp,
        a.citas_normales,
        a.citas,
        CASE
          WHEN a.servicios = 1 THEN 'VERDE'
          WHEN a.especialidades = 1
               AND (a.citas_pyp = 0 OR a.citas_normales = 0) THEN 'AMARILLO'
          ELSE 'ROJO'
        END AS semaforo
FROM actividad a
LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = a.medico
ORDER BY semaforo, a.citas DESC;
GO

-- Resumen de una línea: cuántos médicos hay en cada semáforo.
WITH pyp AS (
    SELECT s FROM (VALUES
        ('890201-CI'),('I890301AG'),('890201AD'),('890201PI'),('I890201AG'),
        ('I890201PL1'),('I890301G'),('I890301RN'),('890201AV'),
        ('990203'),('997301-1'),('SSAO'),('890208Ges'),('I890305PL')
    ) v(s)
),
con_turnos AS (
    SELECT DISTINCT CD_MED_TUME AS medico
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
),
citas AS (
    SELECT  c.CD_CODI_MED_CIT AS medico,
            c.CD_CODI_SER_CIT AS servicio,
            c.CD_CODI_ESP_CIT AS especialidad,
            CASE WHEN p.s IS NULL THEN 0 ELSE 1 END AS es_pyp
    FROM dbo.CITAS_MEDICAS c
    JOIN con_turnos t ON t.medico = c.CD_CODI_MED_CIT
    LEFT JOIN pyp p   ON p.s = c.CD_CODI_SER_CIT
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
),
actividad AS (
    SELECT  medico,
            COUNT(DISTINCT servicio)     AS servicios,
            COUNT(DISTINCT especialidad) AS especialidades,
            SUM(es_pyp)                  AS citas_pyp,
            SUM(1 - es_pyp)              AS citas_normales
    FROM citas
    GROUP BY medico
),
clasificado AS (
    SELECT CASE
             WHEN servicios = 1 THEN 'VERDE'
             WHEN especialidades = 1
                  AND (citas_pyp = 0 OR citas_normales = 0) THEN 'AMARILLO'
             ELSE 'ROJO'
           END AS semaforo
    FROM actividad
)
SELECT semaforo, COUNT(*) AS medicos
FROM clasificado
GROUP BY semaforo
ORDER BY semaforo;
GO

-- =============================================================================
-- F. 📋 EL MATERIAL PARA PREGUNTARLE AL HOSPITAL
--
-- La sección E dice CUÁNTOS médicos tienen el problema. Esta dice, para cada
-- uno, EXACTAMENTE qué servicios presta y en qué proporción — que es lo que
-- hay que poner delante de la agendadora para que pueda responder.
--
-- Sin esto, la pregunta al hospital es abstracta («¿qué servicio le ponemos a
-- las citas de WhatsApp?»). Con esto es concreta: «el doctor X hace estos
-- tres, en esta proporción; ¿cuál corresponde cuando el paciente agenda por
-- WhatsApp?».
--
-- La salida se pega tal cual en PREGUNTAS_AL_HOSPITAL.md, que es el documento
-- que va a la reunión.
--
-- ⚠️ SOLO LECTURA. Validada contra un SQL Server real antes de mandarla.
-- =============================================================================
WITH pyp AS (
    SELECT s FROM (VALUES
        ('890201-CI'),('I890301AG'),('890201AD'),('890201PI'),('I890201AG'),
        ('I890201PL1'),('I890301G'),('I890301RN'),('890201AV'),
        ('990203'),('997301-1'),('SSAO'),('890208Ges'),('I890305PL')
    ) v(s)
),
con_turnos AS (
    SELECT DISTINCT CD_MED_TUME AS medico
    FROM dbo.TURNOS_MEDICOS
    WHERE FE_FECH_TUME >= CAST(GETDATE() AS date)
),
detalle AS (
    SELECT  c.CD_CODI_MED_CIT AS medico,
            c.CD_CODI_SER_CIT AS servicio,
            COUNT(*)          AS citas
    FROM dbo.CITAS_MEDICAS c
    JOIN con_turnos t ON t.medico = c.CD_CODI_MED_CIT
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
    GROUP BY c.CD_CODI_MED_CIT, c.CD_CODI_SER_CIT
)
SELECT  d.medico,
        m.NO_NOMB_MED AS nombre_medico,
        d.servicio,
        s.NO_NOMB_SER AS nombre_servicio,
        CASE WHEN p.s IS NULL THEN '' ELSE 'PyP' END AS tipo,
        d.citas,
        CAST(100.0 * d.citas
             / SUM(d.citas) OVER (PARTITION BY d.medico) AS decimal(5,1)) AS pct
FROM detalle d
LEFT JOIN dbo.MEDICOS   m ON m.CD_CODI_MED = d.medico
LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = d.servicio
LEFT JOIN pyp p           ON p.s = d.servicio
ORDER BY d.medico, d.citas DESC;
GO

-- =============================================================================
-- G.1 🔍 ¿EL SUFIJO ESP/SUR DEPENDE DE LA EPS DEL PACIENTE? — ⚠️ CORRIDA, NO CONCLUYENTE (2026-09-03)
--
-- Salió del resultado de F. Dos especialistas usan pares de servicios con la
-- MISMA descripción y distinto sufijo:
--
--   ES01 (internista)  890266ESP / 890266SUR   y  890366ESP / 890366SUR
--                      ESP 853 (87 %)  ·  SUR 131 (13 %)
--   ES03 (ginecología) 890250ESP / 890250SUR   y  890350ESP / 890350SUR
--                      ESP  78 (43 %)  ·  SUR 102 (57 %)
--
-- La hipótesis obvia es que `SUR` = Sura, es decir: **el código de servicio
-- depende de la EPS del paciente**. Si se confirma, es una regla que AgenIA
-- puede aplicar SOLA — conoce la EPS en el momento de agendar — y desaparece
-- toda la ambigüedad de los especialistas sin preguntarle nada a nadie.
--
-- Si NO se confirma, hay que preguntarle a la agendadora qué distingue los
-- dos códigos, porque no se puede adivinar.
--
-- ⚠️ SOLO LECTURA. Ojo: R_PAC_EPS es many-to-many, así que un paciente con
--    varias afiliaciones aparece varias veces (fan-out). Lo que importa aquí
--    no es el número exacto sino si un sufijo se CONCENTRA en una EPS.
-- =============================================================================
WITH pares AS (
    SELECT c.CD_CODI_SER_CIT AS servicio,
           LEFT(c.CD_CODI_SER_CIT, LEN(c.CD_CODI_SER_CIT) - 3) AS raiz,
           RIGHT(c.CD_CODI_SER_CIT, 3) AS sufijo,
           c.NU_HIST_PAC_CIT AS hist
    FROM dbo.CITAS_MEDICAS c
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
      AND (c.CD_CODI_SER_CIT LIKE '%ESP' OR c.CD_CODI_SER_CIT LIKE '%SUR')
)
SELECT  p.raiz,
        p.sufijo,
        e.NO_NOMB_EPS AS eps_del_paciente,
        COUNT(*)      AS citas
FROM pares p
JOIN dbo.R_PAC_EPS r ON r.NU_HIST_PAC_RPE = p.hist
LEFT JOIN dbo.EPS e  ON e.CD_NIT_EPS = r.CD_NIT_EPS_RPE
GROUP BY p.raiz, p.sufijo, e.NO_NOMB_EPS
ORDER BY p.raiz, p.sufijo, citas DESC;
GO


-- ── RESULTADO DE G.1 (2026-09-03) — la consulta no puede decidir ─────────────
--
-- Cuota de "EPS SURAMERICANA S.A" en cada bucket:
--
--   raíz      ESP        SUR      especialidad
--   890242    0,5 %     16,1 %    dermatología
--   890250    1,0 %     15,3 %    ginecología
--   890342    0,0 %     15,5 %    dermatología (control)
--   890350    0,0 %     15,7 %    ginecología (control)
--   890266    8,9 %     17,8 %    medicina interna
--   890366    9,5 %     16,4 %    medicina interna
--
-- El sufijo SUR está clarísimamente ENRIQUECIDO en Sura —15-18 % en los seis
-- buckets, contra 0-1 % en el ESP de dermatología y ginecología— pero eso NO
-- demuestra la hipótesis, y el defecto es de la consulta, no de los datos:
--
--   `R_PAC_EPS` es un HISTORIAL many-to-many y admite VARIAS filas por
--   (paciente, EPS) —afiliaciones en distintos periodos, distintos carnés—.
--   Cada cita se multiplica por el número de filas del paciente, así que
--   ninguna cuota de este resultado es una proporción de CITAS. Se sabe que
--   hay duplicados porque en el par de medicina interna salen 186 filas de
--   Sura en un bucket que la sección F midió en 131 citas: más filas de una
--   sola EPS que citas hay. Con un solo renglón por afiliación eso es
--   imposible.
--
-- Yo dejé escrito el aviso del fan-out en la cabecera y aun así la mandé con
-- ese JOIN. Era evitable: la cita YA lleva su propio convenio en
-- `NU_NUME_CONV_CIT`, y de ahí se llega a la EPS sin tocar `R_PAC_EPS`.
-- Eso es G.2, y esa sí decide.
--
-- Lo que G.1 sí dejó, y vale más que la pregunta original: los códigos van en
-- PAREJAS 8902xx / 8903xx (890242/890342, 890250/890350, 890266/890366,
-- 890283/890383, 890284/890384), que es la estructura CUPS nacional —
-- 8902xx = consulta de PRIMERA VEZ, 8903xx = consulta de CONTROL. El propio
-- mapping.json ya lo tenía sin saberlo: 890206 y 890306 apuntan los dos a
-- NUTRICION. Eso convierte el patrón que asomó en F en una regla verificable,
-- y G.3 la comprueba contra los datos del hospital.


-- =============================================================================
-- G.2 ✅ CORRIDA Y CERRADA EL 2026-09-03 — y destapó un bloqueante nuevo
--
-- Misma pregunta que G.1 (¿el sufijo depende del pagador?) pero leyendo el
-- convenio que la cita YA tiene grabado en `NU_NUME_CONV_CIT` y resolviendo la
-- EPS por `CONVENIOS.CD_NIT_EPS_CONV`. Una fila por cita, cero multiplicación.
--
-- CÓMO SE LEE:
--   · Si en el bucket SUR un convenio de Sura se lleva >80 % → CONFIRMADO: el
--     sufijo es el pagador, AgenIA lo resuelve sola y no hay nada que preguntar.
--   · Si sale repartido → el sufijo significa otra cosa y hay que preguntarle
--     a la agendadora qué distingue 890266ESP de 890266SUR.
--
-- ⚠️ SOLO LECTURA. Sintaxis validada contra un SQL Server real.
-- =============================================================================
WITH pares AS (
    SELECT LEFT(c.CD_CODI_SER_CIT, LEN(c.CD_CODI_SER_CIT) - 3) AS raiz,
           RIGHT(c.CD_CODI_SER_CIT, 3)                         AS sufijo,
           c.NU_NUME_CONV_CIT                                  AS convenio
    FROM dbo.CITAS_MEDICAS c
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
      AND (c.CD_CODI_SER_CIT LIKE '%ESP' OR c.CD_CODI_SER_CIT LIKE '%SUR')
)
SELECT  p.raiz,
        p.sufijo,
        p.convenio,
        cv.CD_CODI_CONV      AS nombre_convenio,
        e.NO_NOMB_EPS        AS eps_del_convenio,
        COUNT(*)             AS citas,
        CAST(100.0 * COUNT(*)
             / SUM(COUNT(*)) OVER (PARTITION BY p.raiz, p.sufijo)
             AS decimal(5,1)) AS pct_del_sufijo
FROM pares p
LEFT JOIN dbo.CONVENIOS cv ON cv.NU_NUME_CONV = p.convenio
LEFT JOIN dbo.EPS e        ON e.CD_NIT_EPS    = cv.CD_NIT_EPS_CONV
GROUP BY p.raiz, p.sufijo, p.convenio, cv.CD_CODI_CONV, e.NO_NOMB_EPS
HAVING COUNT(*) >= 3
ORDER BY p.raiz, p.sufijo, citas DESC;
GO


-- ── RESULTADO DE G.2 (2026-09-03) — 1.589 citas de especialista en 90 días ──
--
-- LA PREGUNTA ORIGINAL: SÍ, PERO SOLO EN UNA DIRECCIÓN.
--
--   bucket SUR (367 citas):  100,0 % Sura.  CERO excepciones.
--   bucket ESP (1.222):      51,2 % Salud Total · 45,8 % Sura ·
--                            1,5 % Fomag · 0,6 % Nueva EPS · 0,4 % particular
--
-- Es decir: `SUR` ⟹ Sura, siempre, sin una sola contradicción en 367 citas.
-- Pero **Sura NO ⟹ SUR**: 560 de las 927 citas de Sura (el 60 %) van con ESP.
-- AgenIA no puede deducir el sufijo de la EPS: saber que el paciente es de
-- Sura no dice si toca ESP o SUR. La pregunta a la agendadora sigue viva,
-- pero ahora es concreta — y hay un default seguro: ESP se usa con TODAS las
-- aseguradoras, Sura incluida, así que escribir ESP nunca es «la aseguradora
-- equivocada».
--
-- 🚨 Y ESTO, QUE NO SE PREGUNTABA Y PESA MÁS:
--
-- Los convenios que aparecen NO son los que AgenIA tiene homologados.
--
--   especialistas           atención primaria (lo que dice mapping.json hoy)
--   ─────────────────────   ────────────────────────────────────────────────
--   535 EVENSURASUB    605   467 SUBS            ← Sura subsidiado
--    97 EVENSURACON    318   473 CONTRIBUTIVO    ← Sura contributivo
--   538 EVENTOSTOTALSU 500   (no existe)         ← Salud Total subsidiado
--    96 EVENTOSTOTALCO 126   (no existe)         ← Salud Total contributivo
--
-- El prefijo lo dice: EVEN(TOS) = facturación por evento. La atención primaria
-- va por cápita (467, 283, 489) y el especialista por evento. La regla de
-- convenio de AgenIA —EPS + régimen + PyP— **le falta un cuarto eje**.
--
-- Para Sura subsidiado con un especialista, el hospital usa 535 en 605 citas y
-- 467 en 4. Si AgenIA enciende un especialista hoy, factura al contrato
-- equivocado en el 99 % de los casos.
--
-- Además: **Salud Total es el 39,4 % del volumen de especialistas y AgenIA no
-- sabe que existe** — su tabla `Eps` solo tiene Nueva EPS, Sura y Particular.
--
-- Nada de esto toca al piloto de los 4 médicos verdes (76, 077, 91-1, 91-2):
-- son primaria y PyP, y sus convenios están medidos y verificados en D.
-- Lo que bloquea es encender especialistas. G.5 saca la tabla completa.

-- =============================================================================
-- G.3 ✅ CORRIDA Y CERRADA EL 2026-09-03 — CONFIRMADO
--
-- La estructura CUPS dice que sí, pero conviene no creerle a un estándar
-- cuando se puede mirar el dato. La prueba: para cada paciente y cada familia
-- de servicio, ¿qué código lleva su PRIMERA cita frente a las siguientes?
--
-- Si la hipótesis es cierta:
--   · fila "1-primera del paciente"  → pct_8902x ALTO   (cerca de 100)
--   · fila "2-posterior"             → pct_8902x BAJO
--
-- Si las dos filas se parecen, el dígito significa otra cosa y la pregunta
-- «¿primera vez o control?» del chatbot no sirve para elegir el código.
--
-- Notas de lectura:
--   · La ventana es de 3 AÑOS (no 90 días): hace falta historia para saber si
--     una cita es la primera. Aun así, un paciente cuya primera visita real
--     fue hace 5 años entra como "primera" siendo un control — ese sesgo
--     ENSUCIA la fila de arriba, nunca la limpia. Si el resultado sale nítido
--     a pesar de él, es de fiar.
--   · Excluye los servicios con prefijo `I` (I890301AG, I890201PL1…): son los
--     de PyP y siguen otra convención.
--
-- ⚠️ SOLO LECTURA. Sintaxis validada contra un SQL Server real.
-- =============================================================================
WITH fam AS (
    SELECT  c.NU_HIST_PAC_CIT                                   AS hist,
            c.FE_FECH_CIT                                       AS fecha,
            c.CD_CODI_SER_CIT                                   AS servicio,
            -- Quita el 6º carácter (el 2/3) para juntar las dos mitades del par.
            STUFF(SUBSTRING(c.CD_CODI_SER_CIT, 1, 6), 4, 1, '') AS familia,
            SUBSTRING(c.CD_CODI_SER_CIT, 4, 1)                  AS digito
    FROM dbo.CITAS_MEDICAS c
    WHERE c.FE_FECH_CIT >= DATEADD(year, -3, CAST(GETDATE() AS date))
      AND (c.CD_CODI_SER_CIT LIKE '8902%' OR c.CD_CODI_SER_CIT LIKE '8903%')
),
con_par AS (
    SELECT familia
    FROM fam
    GROUP BY familia
    HAVING COUNT(DISTINCT digito) = 2   -- solo familias que usan las DOS mitades
),
ordenadas AS (
    SELECT f.*,
           ROW_NUMBER() OVER (PARTITION BY f.hist, f.familia
                              ORDER BY f.fecha, f.servicio) AS orden
    FROM fam f
    JOIN con_par p ON p.familia = f.familia
)
SELECT  o.familia,
        CASE o.orden WHEN 1 THEN '1-primera del paciente'
                     ELSE      '2-posterior' END               AS momento,
        SUM(CASE WHEN o.digito = '2' THEN 1 ELSE 0 END)        AS cod_8902x,
        SUM(CASE WHEN o.digito = '3' THEN 1 ELSE 0 END)        AS cod_8903x,
        CAST(100.0 * SUM(CASE WHEN o.digito = '2' THEN 1 ELSE 0 END)
             / COUNT(*) AS decimal(5,1))                       AS pct_8902x
FROM ordenadas o
GROUP BY o.familia,
         CASE o.orden WHEN 1 THEN '1-primera del paciente' ELSE '2-posterior' END
HAVING COUNT(*) >= 20
ORDER BY o.familia, momento;
GO


-- ── RESULTADO DE G.3 (2026-09-03) — CONFIRMADO, y con margen de sobra ───────
--
--   familia            especialidad        1ª cita del      citas
--                                          paciente         posteriores
--                                          (% con 8902xx)   (% con 8902xx)
--   89006  890206/890306  nutrición             99,0 %          44,9 %
--   89042  890242/890342  dermatología          99,7 %          14,5 %
--   89050  890250/890350  ginecología           97,9 %          16,3 %
--   89066  890266/890366  medicina interna      97,1 %          11,3 %
--   89083  890283/890383  pediatría             91,6 %          42,4 %
--   89084  890284/890384  psiquiatría           98,5 %          22,2 %
--
-- La primera cita de un paciente lleva 8902xx entre el 91,6 % y el 99,7 % de
-- las veces. Las siguientes caen al 11-45 %. Seis familias de seis.
--
-- Y el sesgo de la ventana JUEGA A FAVOR: un paciente cuya primera visita real
-- fue hace más de 3 años entra como «primera» llevando un código de control,
-- lo que ENSUCIA la fila de arriba. Aun así sale por encima del 91 %. El
-- resultado real es todavía más limpio que este.
--
-- Que las citas posteriores conserven un 11-45 % de 8902xx no contradice nada:
-- «primera vez» se vuelve a abrir con un episodio nuevo. Que pediatría (42,4 %)
-- y nutrición (44,9 %) sean las más altas encaja — un niño estrena motivo de
-- consulta a menudo. Y confirma que la respuesta no se puede deducir del
-- historial: **hay que preguntársela al paciente**, que es justo lo que hace
-- la pregunta «¿primera vez o control?».

-- =============================================================================
-- G.4 ✅ CORRIDA Y CERRADA EL 2026-09-03 — y había NUEVE huecos más
--
-- `especialidadPorServicio` se generó en el bloque 31d filtrando a médicos CON
-- TURNOS FUTUROS, y ese filtro dejó fuera cinco servicios con citas reales
-- (890242ESP, 890342ESP/SUR, 890350ESP/SUR). Se añadieron el 2026-09-03
-- deduciéndolos del par CUPS —890342* es el control de 890242*, luego comparte
-- especialidad— pero una deducción no es un dato. Esto lo comprueba.
--
-- A diferencia del 31d, esta consulta NO filtra por turnos: recorre TODOS los
-- servicios con citas en 90 días. Si mañana alguien enciende un médico nuevo,
-- correrla otra vez dice inmediatamente si falta homologar algo.
--
-- CÓMO SE LEE:
--   · `pct` cerca de 100 y `esp_distintas_observadas` = 1 → inequívoco.
--   · `esp_distintas_observadas` > 1 → ese servicio se factura con varias
--     especialidades; mirar `pct` para ver si es ruido o es real.
--   · `esp_catalogo` es lo que dice `R_ESP_SER` (el catálogo). Si NO coincide
--     con `esp_observada`, manda lo observado: es lo que el hospital hace de
--     verdad, no lo que su catálogo dice que debería hacer.
--   · Cualquier servicio de esta lista que NO esté en `especialidadPorServicio`
--     es un hueco. Desde el 2026-09-03 el agente ya no lo rellena a ciegas:
--     lanza `MappingIncompletoError` y la cita falla a la vista de todos.
--
-- ⚠️ SOLO LECTURA. Sintaxis validada contra un SQL Server real.
-- =============================================================================
WITH observado AS (
    SELECT  c.CD_CODI_SER_CIT AS servicio,
            c.CD_CODI_ESP_CIT AS especialidad,
            COUNT(*)          AS citas
    FROM dbo.CITAS_MEDICAS c
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
    GROUP BY c.CD_CODI_SER_CIT, c.CD_CODI_ESP_CIT
),
ranking AS (
    SELECT  o.*,
            SUM(o.citas) OVER (PARTITION BY o.servicio)                        AS total,
            ROW_NUMBER() OVER (PARTITION BY o.servicio ORDER BY o.citas DESC)  AS puesto,
            COUNT(*)     OVER (PARTITION BY o.servicio)                        AS distintas
    FROM observado o
),
catalogo AS (
    SELECT  rs.CD_CODI_SER_RES      AS servicio,
            MIN(rs.CD_CODI_ESP_RES) AS esp_catalogo,
            COUNT(*)                AS esp_en_catalogo
    FROM dbo.R_ESP_SER rs
    GROUP BY rs.CD_CODI_SER_RES
)
SELECT  r.servicio,
        s.NO_NOMB_SER                                   AS nombre_servicio,
        r.especialidad                                  AS esp_observada,
        e.NO_NOMB_ESP                                   AS nombre_especialidad,
        CAST(100.0 * r.citas / r.total AS decimal(5,1)) AS pct,
        r.total                                         AS citas_90d,
        r.distintas                                     AS esp_distintas_observadas,
        c.esp_catalogo,
        c.esp_en_catalogo
FROM ranking r
LEFT JOIN dbo.SERVICIOS      s ON s.CD_CODI_SER = r.servicio
LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = r.especialidad
LEFT JOIN catalogo           c ON c.servicio    = r.servicio
WHERE r.puesto = 1
ORDER BY r.servicio;
GO


-- ── RESULTADO DE G.4 (2026-09-03) — 54 servicios con citas en 90 días ──────
--
-- 1. LAS 45 ESPECIALIDADES QUE YA HABÍA: correctas al 100 %. Cero
--    discrepancias entre lo mapeado y lo observado.
--
-- 2. LAS CINCO DEDUCIDAS DEL PAR CUPS: confirmadas, y los propios NOMBRES del
--    hospital las validan mejor que cualquier estadística —
--      890242ESP  «CONSULTA DE PRIMERA VEZ POR ESPECIALISTA EN DERMATOLOGÍA»
--      890342ESP  «CONSULTA DE CONTROL O DE SEGUIMIENTO POR ESPECIALISTA EN
--                  DERMATOLOGIA»
--      890206     «CONSULTA DE PRIMERA VEZ POR NUTRICIÓN Y DIETÉTICA»
--      890306     «CONSULTA DE CONTROL POR NUTRICIÓN Y DIETÉTICA»
--    La hipótesis de G.3 no era una hipótesis: está escrita en el catálogo.
--
-- 3. 🚨 NUEVE SERVICIOS MÁS QUE FALTABAN, con el mismo defecto por partida
--    doble — sin especialidad Y sin marcar como PyP:
--
--      890201AA   adolescente, médico        328    22 citas
--      890201AJ   joven, médico              328    34
--      890201CP   preconcepcional            328    12
--      890201INF  infancia, médico           328    34
--      890205AA   adolescente, enfermería    060    28
--      890205PI   primera infancia, enf.     060     3
--      890205-LM  lactancia materna, enf.    060     2
--      890205CAM  tamizaje de mama, enf.     060     1
--      I890305AG  control gestante, enf.     060     1
--                                                  ─────
--                                                   137 citas/90d
--
--    Son los servicios de CURSO DE VIDA del médico 80-1 (RIAS), uno de los
--    seis rojos de la sección E. Sus especialidades son de la familia PyDT
--    (328, 060) ⇒ son de PyP ⇒ facturaban al convenio general. Ya están
--    mapeados y marcados; `serviciosPyp` pasa de 14 a 23.
--
-- 4. `R_ESP_SER` NO SIRVE COMO FUENTE: discrepa de lo observado en 22 de 54.
--    Dice 461 para 990203 y las citas usan 572; dice 571 para 997301-1 y usan
--    572; dice 000 para S35102 y usan 590. La especialidad se deriva de las
--    CITAS, no del catálogo. Queda desmentida la hipótesis del bloque 21b.
--
-- ⚠️ VOLVER A CORRERLA cada vez que se encienda un médico nuevo. Es la única
--    consulta que ve los servicios que AgenIA todavía no conoce.

-- =============================================================================
-- G.5 ✅ CORRIDA Y CERRADA EL 2026-09-03 — Salud Total es un tercio del hospital
--
-- G.2 encontró que la regla de convenio de AgenIA está incompleta. Hoy dice
-- «EPS + régimen (+ PyP) → convenio», y con eso acierta en atención primaria
-- porque así se midió en la sección D. Pero los especialistas facturan a
-- contratos DISTINTOS de la misma EPS y el mismo régimen:
--
--   Sura subsidiado + primaria      → 467 SUBS
--   Sura subsidiado + especialista  → 535 EVENSURASUB   ← el que falta
--
-- «EVEN» es EVENTOS: primaria por cápita, especialista por evento. Falta un
-- cuarto eje en la regla, y falta Salud Total entera —el 39 % del volumen de
-- especialistas— que AgenIA ni siquiera tiene en su tabla `Eps`.
--
-- Esta consulta saca la tabla ENTERA de una vez: qué convenio usa cada EPS,
-- en cada régimen, para cada tipo de servicio. Con eso se rellena el
-- `mappingJson` sin deducir nada.
--
-- CÓMO SE LEE:
--   · `nit_eps` es lo que hay que dar de alta en la tabla `Eps` de AgenIA.
--     Ojo con Salud Total: hoy no existe.
--   · `vigente` (NU_VIGE_CONV): si un convenio con volumen sale NO vigente,
--     preguntar antes de homologarlo — puede ser un contrato que acaba de
--     terminar.
--   · `tipo_servicio` separa PyP / especialista / primaria. Si una EPS usa el
--     MISMO convenio para especialista y primaria, para esa EPS no hay cuarto
--     eje y basta la regla actual.
--   · `servicios_distintos` alto en «especialista» = ese contrato cubre toda
--     la cartera de especialidades, no un servicio suelto.
--
-- ⚠️ SOLO LECTURA. Sintaxis validada contra un SQL Server real.
-- =============================================================================
WITH pyp AS (
    SELECT s FROM (VALUES
        ('890201-CI'),('I890301AG'),('890201AD'),('890201PI'),('I890201AG'),
        ('I890201PL1'),('I890301G'),('I890301RN'),('890201AV'),
        ('990203'),('997301-1'),('SSAO'),('890208Ges'),('I890305PL')
    ) v(s)
),
citas AS (
    SELECT  c.NU_NUME_CONV_CIT AS convenio,
            c.CD_CODI_SER_CIT  AS servicio,
            CASE WHEN p.s IS NOT NULL                    THEN 'PyP'
                 WHEN c.CD_CODI_SER_CIT LIKE '8902%'
                   OR c.CD_CODI_SER_CIT LIKE '8903%'     THEN 'especialista'
                 ELSE 'primaria' END AS tipo_servicio
    FROM dbo.CITAS_MEDICAS c
    LEFT JOIN pyp p ON p.s = c.CD_CODI_SER_CIT
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
)
SELECT  ct.convenio,
        cv.CD_CODI_CONV        AS nombre_convenio,
        cv.CD_NIT_EPS_CONV     AS nit_eps,
        e.NO_NOMB_EPS          AS eps,
        cv.NU_VIGE_CONV        AS vigente,
        ct.tipo_servicio,
        COUNT(*)                       AS citas,
        COUNT(DISTINCT ct.servicio)    AS servicios_distintos
FROM citas ct
LEFT JOIN dbo.CONVENIOS cv ON cv.NU_NUME_CONV = ct.convenio
LEFT JOIN dbo.EPS e        ON e.CD_NIT_EPS    = cv.CD_NIT_EPS_CONV
GROUP BY ct.convenio, cv.CD_CODI_CONV, cv.CD_NIT_EPS_CONV, e.NO_NOMB_EPS,
         cv.NU_VIGE_CONV, ct.tipo_servicio
HAVING COUNT(*) >= 5
ORDER BY e.NO_NOMB_EPS, ct.tipo_servicio, citas DESC;
GO

-- ── RESULTADO DE G.5 (2026-09-03) — la tabla completa ──────────────────────
--
-- LA ESTRUCTURA CONFIRMADA: cápita para primaria y PyP, EVENTO para el
-- especialista. Y con el NIT de cada EPS, que es lo que hacía falta.
--
--   EPS (NIT)                      primaria/PyP        especialista
--   ────────────────────────────   ─────────────────   ────────────────────
--   Sura        800088702  SUB     467 SUBS   5.604    535 EVENSURASUB  706
--                          CON     473 CONTRIB 2.513    97 EVENSURACON  391
--   Salud Total 800130907  SUB     475 STOTALSUBS 5.267 538 EVENTOSTOTALSU 703
--                          CON     476 STCONTRIB   929  96 EVENTOSTOTALCO 171
--   Nueva EPS   900156264  SUB     283 NUEVASUBSID 3.302  (no tiene)
--                          CON     (no aparece)            (no tiene)
--   Fomag       830053105          518 MAGISTERIOFOMAG 418 / 529 PYPFOMAG
--   Particular  000000000          26 PARTICULARES
--
-- 🚨 SALUD TOTAL ES UN TERCIO DEL HOSPITAL, no «el 39 % de los especialistas»
-- como se leyó en G.2: 10.137 citas en 90 días contra 11.933 de Sura y 5.457
-- de Nueva EPS. Y AgenIA no la tenía ni en su tabla `Eps`. Ya está homologada
-- (NIT 800130907, cuatro convenios). **Falta darla de alta como `Eps` en
-- AgenIA para que el chatbot pueda ofrecerla** — hoy solo ofrece Nueva EPS,
-- Sura y Particular, así que un paciente de Salud Total no puede ni empezar.
--
-- ⚠️ NUEVA EPS NO TIENE CONVENIO DE EVENTO. Sus 34 citas de especialista se
-- reparten entre 489 PYPSUBS (27) y 283 NUEVASUBSID (7) — un convenio de PyP
-- para una consulta de especialista es raro y 34 citas no deciden nada. NO se
-- homologa: `resolveConvenio` lanza, que es lo correcto mientras no se sepa.
--
-- ⚠️ Y UNA DUDA QUE G.5 ABRE SOBRE LA SECCIÓN D: el convenio 473 CONTRIBUTIVO
-- está registrado en el catálogo bajo el NIT de **Sura**, y Nueva EPS no
-- aparece con NINGÚN convenio contributivo en 90 días. `mapping.json` dice
-- `900156264|CONTRIBUTIVO = 473` porque así lo midió D — pero D usó
-- `R_PAC_EPS`, la misma tabla cuyo fan-out invalidó G.1. Dos lecturas:
--   (a) 473 es un contrato contributivo genérico usado por varias EPS. Lo
--       apoya que se llame solo «CONTRIBUTIVO» y no «SURACONTRIB».
--   (b) La conclusión de D está contaminada.
-- En contra de (b): si Nueva EPS contributivo facturara a un contrato propio,
-- ese contrato tendría volumen, y el único candidato (290 NUEVAEPSCONT) tiene
-- DOS citas en 90 días. En contra de (a): Salud Total NO usa el 473, tiene su
-- propio 476. Se deja como está y **se pregunta** — pregunta 1-bis.
--
-- Nota metodológica: la clasificación `especialista` de esta consulta mete
-- también nutrición (890206/890306), que es 8902xx/8903xx pero puede no
-- facturarse por evento. Por eso hace falta G.6.


-- =============================================================================
-- G.6 ✅ CORRIDA Y CERRADA EL 2026-09-03 — sin zona gris, y con dos correcciones
--
-- G.5 confirmó que existen dos modalidades pero las agrupó por «tipo de
-- servicio» usando un patrón (`8902%`/`8903%`), y ese patrón mete en el mismo
-- saco a los especialistas y a nutrición. Si nutrición factura por cápita y
-- AgenIA la trata como evento —o al revés— vuelve el mismo error silencioso.
--
-- Esto lo resuelve sin patrones ni hipótesis: para CADA servicio, qué
-- proporción de sus citas fue a un convenio cuyo nombre empieza por `EVEN`.
-- Una fila por servicio, y la columna `modalidad` ya trae la conclusión.
--
-- CÓMO SE LEE:
--   · `EVENTO`  → va en `serviciosEvento` del mappingJson.
--   · `capita`  → NO va (usa el convenio del régimen).
--   · `?? MIXTO — preguntar` → ese servicio se factura de las dos formas.
--     Preguntar a facturación qué lo decide; hasta entonces AgenIA no debe
--     ofrecerlo, porque no hay respuesta correcta que se pueda deducir.
--
-- Con esto la tabla de convenios queda cerrada del todo.
--
-- ⚠️ SOLO LECTURA. Sintaxis validada contra un SQL Server real.
-- =============================================================================
WITH clasificadas AS (
    SELECT  c.CD_CODI_SER_CIT AS servicio,
            CASE WHEN cv.CD_CODI_CONV LIKE 'EVEN%' THEN 1 ELSE 0 END AS es_evento
    FROM dbo.CITAS_MEDICAS c
    LEFT JOIN dbo.CONVENIOS cv ON cv.NU_NUME_CONV = c.NU_NUME_CONV_CIT
    WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
      AND cv.CD_CODI_CONV IS NOT NULL
)
SELECT  cl.servicio,
        s.NO_NOMB_SER                                       AS nombre_servicio,
        COUNT(*)                                            AS citas,
        SUM(cl.es_evento)                                   AS por_evento,
        COUNT(*) - SUM(cl.es_evento)                        AS por_capita,
        CAST(100.0 * SUM(cl.es_evento) / COUNT(*)
             AS decimal(5,1))                               AS pct_evento,
        CASE WHEN 100.0 * SUM(cl.es_evento) / COUNT(*) >= 80 THEN 'EVENTO'
             WHEN 100.0 * SUM(cl.es_evento) / COUNT(*) <= 20 THEN 'capita'
             ELSE '?? MIXTO — preguntar' END                AS modalidad
FROM clasificadas cl
LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = cl.servicio
GROUP BY cl.servicio, s.NO_NOMB_SER
HAVING COUNT(*) >= 5
ORDER BY modalidad, citas DESC;
GO

-- ── RESULTADO DE G.6 (2026-09-03) — la tabla de convenios queda cerrada ─────
--
-- 48 servicios con 5 o más citas. El corte es LIMPIO, no hay zona gris:
--
--   32 servicios por CÁPITA   — todos por debajo del 0,6 % de evento
--   16 servicios por EVENTO   — todos por encima del 90 %
--    1 servicio «MIXTO»       — 890284ESP, 72,9 % (ver abajo: no es ambiguo)
--
-- 🚨 CORRECCIÓN 1 — NUTRICIÓN SE FACTURA POR EVENTO. Y no estaba en la lista.
--
--     890206  CONSULTA DE PRIMERA VEZ POR NUTRICIÓN   370 citas   97,0 %
--     890306  CONSULTA DE CONTROL POR NUTRICIÓN        57         98,2 %
--
--   El patrón `8902%`/`8903%` de G.5 los metía en el mismo saco que a los
--   especialistas y por eso no se podían distinguir: era exactamente el
--   motivo de escribir G.6. Con la tabla anterior, una cita de nutrición de
--   Sura subsidiado se habría facturado al 467 (cápita) en vez de al 535.
--
--   Consecuencia sobre la sección E: **el médico NU02 estaba clasificado como
--   amarillo, «la factura sale bien». NO lo estaba.** Ya está corregido en el
--   mapeo, pero conviene decirlo en la reunión.
--
-- 🚨 CORRECCIÓN 2 — EL «MIXTO» NO ES UNA AMBIGÜEDAD, ES UN AGREGADO ENGAÑOSO.
--
--   890284ESP (psiquiatría primera vez) sale al 72,9 %. Pero su 27 % de cápita
--   son EXACTAMENTE los pagadores que no tienen contrato de evento:
--
--     283 NUEVASUBSID   Nueva EPS                       7 citas
--     232 PERSOCIAL     personal del propio hospital    6
--     467 SUBS          Sura — que SÍ lo tiene          4   ← anomalía real
--
--   Es decir: **la modalidad no es una propiedad del SERVICIO, sino del par
--   (servicio, EPS)**. El mismo acto médico se factura por evento a quien
--   tiene contrato de evento y por cápita a quien no. Su hermano 890384ESP
--   sale al 100 % simplemente porque a él no fue ningún paciente de los
--   pagadores sin contrato.
--
--   El modelo de AgenIA ya lo refleja sin cambios: la clave es
--   `nit|REGIMEN|EVENTO`, así que Sura y Salud Total van al convenio de
--   evento y Nueva EPS —que no tiene— hace fallar la cita en vez de facturar
--   a ciegas.
--
-- ✅ Y LA CONFIRMACIÓN QUE IMPORTA PARA EL PILOTO: los cuatro médicos verdes
--   usan solo servicios de cápita, medidos con volumen de sobra —
--
--     S39141-1   control hipertensos (76, 077)   7.014 citas   0,0 % evento
--     890201-CI  PyDT (91-1)                     2.531         0,0 %
--     I890305PL  planificación familiar (91-2)   1.114         0,0 %
--
--   El piloto no toca facturación por evento por ningún lado.


-- =============================================================================
-- G.7 ✅ CORRIDA Y CERRADA EL 2026-09-03 — con una duda nueva sobre el régimen
--
-- G.5 encontró que Salud Total es un TERCIO del hospital (33,9 % de la
-- atención primaria) y que Fomag es un 2,4 % adicional, y que ninguna de las
-- dos existe como `Eps` en AgenIA. Esta consulta trae lo que falta para
-- crearlas: ficha de la EPS, vigencia real de sus convenios (no solo el
-- nombre) y el tamaño de su padrón, para dimensionar el CSV de alta.
--
-- CÓMO SE LEE:
--   · Bloque 1 (ficha): si `activa = 0`, avisar antes de dar de alta — puede
--     ser una EPS que dejó de operar y las citas recientes son solo cola.
--   · Bloque 2 (convenios): si `vigente = 0` o `fin` ya pasó, ese convenio no
--     sirve para citas NUEVAS aunque tenga volumen histórico en 90 días.
--   · Bloque 3 (padrón): el número de pacientes distintos por régimen es una
--     cota SUPERIOR razonable del tamaño del CSV que hay que pedir —el padrón
--     real puede ser menor si algunos ya no están afiliados.
--
-- ⚠️ SOLO LECTURA. Sintaxis validada contra un SQL Server real.
-- =============================================================================
SELECT  e.CD_NIT_EPS      AS nit,
        e.NO_NOMB_EPS     AS nombre,
        e.CD_CODI_EPS     AS codigo_corto,
        e.NU_ACTIVO_EPS   AS activa,
        e.NO_DPTO_EPS     AS depto,
        e.NO_MUNI_EPS     AS municipio,
        e.DE_TELE_EPS     AS telefono,
        e.NU_REQPOL_EPS   AS requiere_poliza
FROM dbo.EPS e
WHERE e.CD_NIT_EPS IN ('800130907','830053105');
GO

SELECT  cv.NU_NUME_CONV     AS convenio,
        cv.CD_CODI_CONV     AS nombre_convenio,
        cv.CD_NIT_EPS_CONV  AS nit_eps,
        cv.NU_VIGE_CONV     AS vigente,
        CONVERT(varchar(10), cv.FE_INIC_CONV, 23) AS inicio,
        CONVERT(varchar(10), cv.FE_FINA_CONV, 23) AS fin
FROM dbo.CONVENIOS cv
WHERE cv.CD_NIT_EPS_CONV IN ('800130907','830053105')
ORDER BY cv.CD_NIT_EPS_CONV, cv.NU_NUME_CONV;
GO

SELECT  r.CD_NIT_EPS_RPE                 AS nit_eps,
        r.CD_CODI_REG_RPE                 AS regimen,
        COUNT(DISTINCT r.NU_HIST_PAC_RPE) AS pacientes_distintos
FROM dbo.R_PAC_EPS r
WHERE r.CD_NIT_EPS_RPE IN ('800130907','830053105')
  AND r.NU_ESTA_RPE = 1
GROUP BY r.CD_NIT_EPS_RPE, r.CD_CODI_REG_RPE
ORDER BY r.CD_NIT_EPS_RPE, r.CD_CODI_REG_RPE;
GO

-- ── RESULTADO DE G.7 (2026-09-03) ───────────────────────────────────────────
--
-- 1. AMBAS EPS ESTÁN ACTIVAS. Salud Total en Manizales/Caldas — vecina de
--    Anserma. Pero el NIT 830053105 **NO es «Fomag»**: es
--    «FIDEICOMISOS PATRIMONIOS AUTONOMOS FIDUCIARIA LA PREVISORA», en Bogotá.
--    Sus convenios NO vigentes incluyen INPEC (307, 326) y otros contratos —
--    es la fiduciaria que administra VARIOS fondos del Estado (magisterio,
--    presos, etc.), y solo DOS de sus convenios activos son de magisterio
--    (518 MAGISTERIOFOMAG, 529 PYPFOMAG). Importa para cómo se le muestra al
--    paciente: preguntarle su EPS y que responda «La Previsora» no dice si es
--    magisterio o cualquier otro programa que administre esa fiduciaria.
--
-- 2. LOS CUATRO CONVENIOS DE SALUD TOTAL SIGUEN VIGENTES — y los de Fomag
--    también — pero LOS CUATRO VENCEN EL 31-DIC-2026, igual que los 5 que ya
--    usa el driver (D.4 lo confirmó para esos). Faltan ~4 meses desde hoy.
--    🚨 Poner una alerta operativa: si el hospital renueva con un NÚMERO DE
--    CONVENIO distinto (ya pasó antes: 261 PYPSALUDTOTAL y 481 STPYPSUBS
--    vencieron el 2025-12-31 y NO se renovaron con el mismo número — el PyP
--    de Salud Total simplemente dejó de tener convenio propio), el mapeo
--    quedaría apuntando a un convenio muerto sin que nada lo avise hasta que
--    una cita falle. Repetir D.4/G.7 en diciembre.
--
-- 3. CONFIRMA EL DISEÑO DEL REPLIEGUE DE PyP. Salud Total SÍ tuvo convenios
--    propios de PyP (261, 481) y los dos vencieron a fin de 2025 sin
--    reemplazo — hoy su PyP se factura al convenio general (475/476), que es
--    EXACTAMENTE lo que hace el mappingJson. No es una suposición: es lo que
--    el propio hospital decidió al no renovarlos.
--
-- 4. 🚨 EL PADRÓN DE FOMAG ABRE UNA PREGUNTA ESTRUCTURAL. Salud Total reparte
--    limpio entre los dos regímenes conocidos:
--
--       SUBSIDIADO (01+02+14):    10.633 pacientes  (82,4 %)
--       CONTRIBUTIVO (07-12):      2.267 pacientes  (17,6 %)
--       TOTAL:                    12.900
--
--    Pero Fomag/La Previsora tiene **1.046 pacientes y los 1.046 están bajo
--    el código de régimen `15`**, que no es ninguno de los confirmados en
--    D.6 (01/02/14 subsidiado; 07-12/18 contributivo). Cero excepciones: no
--    hay ni un paciente de Fomag en régimen subsidiado o contributivo
--    corriente. Eso encaja con lo que es el magisterio en Colombia: un
--    RÉGIMEN DE EXCEPCIÓN, no una EPS del régimen general — y explica por
--    qué la fiduciaria administra sus contratos por fuera de las categorías
--    de siempre.
--
--    ⛔ DECISIÓN DE PRODUCTO (2026-09-03): este hallazgo, sumado al volumen
--    (2,4 %), es lo que llevó a decidir que AgenIA NO va a soportar Fomag.
--    D.7 (decodificar el 15) queda cerrada sin correr — no hay resultado
--    posible que cambie esa decisión.


-- =============================================================================
-- H. ✅ CORRIDA Y CERRADA EL 2026-09-04 — NO hay traslado. Era el último
--    bloqueante y salió limpio.
--
--    RESULTADO
--      H.1  UNA sola cita trasladada en 90 días: 76 → 077, motivo 05. Y el
--           destino es la OTRA agenda virtual, no un médico real. La
--           hipótesis habría dejado cientos de filas.
--      H.2  80 anulaciones en total (077: 49, 76: 31; el motivo 05 se lleva
--           67). Así que el traslado es el 1,25 % de ellas. Y 80 sobre
--           ~9.400 citas es una tasa de anulación del 0,85 %, DIEZ VECES por
--           debajo del 8-9 % histórico del hospital: estas agendas son de lo
--           más estable que tiene.
--      H.3  1.213 citas de S39141-1 con médicos reales. NO es huella de
--           traslado: es lo que describió el hospital —la cita cercana se
--           agenda directo con el médico ya programado, la lejana va a la
--           agenda virtual—. Dos caminos que conviven.
--
--    Y la puerta de atrás (traslado silencioso, sin pasar por
--    CITAS_ANULADAS) queda cerrada por el propio HIS: no hay triggers ni SPs
--    de agendamiento (Fase 0), así que tendría que hacerlo una persona a mano
--    sobre ~5.800 citas cada 90 días. No es una rutina plausible.
--
--    DECISIÓN: 76 y 077 entran como médicos normales. AgenIA no hace nada
--    especial con ellos; quién atiende es gestión del hospital.
--
-- ── El planteamiento original ────────────────────────────────────────────────
-- H. ¿las citas del MEDICO HTA se pasan luego al médico real?
--    (abierto el 2026-09-04 por la respuesta del hospital)
--
-- DE DÓNDE SALE. Se le preguntó al hospital qué son los médicos 76 y 077, y la
-- respuesta no fue ninguna de las dos que se ofrecían:
--
--   «los codigos 76 y 077 se refiere a medico hta y medico hta2 fueron creados
--    en el sistema para poder hacer agendamiento futuro. ya que los medicos
--    reales los programan por semanas y los hipertensos puede ser hasta 3
--    meses y mas.»
--
-- O sea: NO son médicos. Son AGENDAS VIRTUALES para poder vender cupos más
-- allá del horizonte en que hay médicos reales programados. Eso resuelve la
-- pregunta del código de servicio (S39141-1 control hipertensos es correcto)
-- y abre una peor.
--
-- POR QUÉ PUEDE ROMPER EL ESPEJO. Si al programar la semana real el hospital
-- MUEVE esas citas al médico que de verdad atiende, en el HIS eso no puede ser
-- un UPDATE inocuo: `CD_CODI_MED_CIT` es la PRIMERA COLUMNA DE LA CLAVE
-- PRIMARIA de CITAS_MEDICAS. Cambiar de médico es, por fuerza, quitar una fila
-- y poner otra. Y `detectChanges` indexa la foto por `${médico}|${hora}`: la
-- clave vieja desaparece.
--
--   ⇒ El agente lo lee como CANCELACIÓN. AgenIA le escribe al paciente
--     «su cita fue cancelada», la marca CANCELLED y LIBERA EL CUPO —
--     que entonces se puede vender dos veces.
--
-- Y no es un caso raro: los médicos 76 y 077 son ~9.400 citas cada 90 días, el
-- grueso del volumen del arranque. Si el traslado es la operación normal del
-- hospital, cada cita de hipertenso agendada por WhatsApp acabaría con un
-- mensaje de cancelación falso.
--
-- CÓMO SE LEE EL RESULTADO
--   · Si (H.1) devuelve MUCHAS anulaciones de 76/077 que reaparecen bajo otro
--     médico a la misma hora y con la misma historia ⇒ EL TRASLADO EXISTE y es
--     BLOQUEANTE: hay que enseñarle al correlacionador a distinguir "movida"
--     de "cancelada" antes de encender estos dos médicos.
--   · Si devuelve CERO o casi cero ⇒ la cita se queda en el MEDICO HTA hasta
--     que el paciente es atendido, y no hay nada que arreglar. En ese caso
--     solo queda la pregunta cosmética de qué nombre ve el paciente.
--
-- ⚠️ SOLO LECTURA. Correr en ESEHSVP (el catálogo vivo).
-- =============================================================================

-- ── H.1 ¿Reaparece la cita anulada de 76/077 bajo otro médico?
--
-- Cruza cada anulación de esos dos códigos con las citas VIVAS del mismo
-- paciente a la misma fecha y hora, con OTRO médico. Si el hospital traslada,
-- eso es exactamente la huella que deja.
SELECT  a.CD_CODI_MED_CIAN            AS medico_virtual,
        a.CD_CODI_MOTI_CIAN           AS motivo_anulacion,
        c.CD_CODI_MED_CIT             AS medico_real,
        COUNT(*)                      AS citas_trasladadas
FROM dbo.CITAS_ANULADAS a
JOIN dbo.CITAS_MEDICAS c
  ON  c.NU_HIST_PAC_CIT = a.NU_HIST_PAC_CIAN
  AND c.FE_HORA_CIT     = a.FE_HORA_CIAN      -- misma fecha Y misma hora
  AND c.CD_CODI_MED_CIT <> a.CD_CODI_MED_CIAN -- pero OTRO médico
WHERE a.CD_CODI_MED_CIAN IN ('76', '077')
  AND a.FE_ELAB_CIAN >= DATEADD(day, -90, CAST(GETDATE() AS date))
GROUP BY a.CD_CODI_MED_CIAN, a.CD_CODI_MOTI_CIAN, c.CD_CODI_MED_CIT
ORDER BY citas_trasladadas DESC;
GO

-- ── H.2 El denominador: ¿cuántas anulaciones tienen en total esos dos?
--
-- Sin esto, H.1 no se puede leer. 50 traslados sobre 60 anulaciones es "así
-- funciona el hospital"; 50 sobre 5.000 es ruido.
SELECT  CD_CODI_MED_CIAN   AS medico_virtual,
        CD_CODI_MOTI_CIAN  AS motivo,
        COUNT(*)           AS anulaciones
FROM dbo.CITAS_ANULADAS
WHERE CD_CODI_MED_CIAN IN ('76', '077')
  AND FE_ELAB_CIAN >= DATEADD(day, -90, CAST(GETDATE() AS date))
GROUP BY CD_CODI_MED_CIAN, CD_CODI_MOTI_CIAN
ORDER BY anulaciones DESC;
GO

-- ── H.3 ¿Y el traslado ocurre sin pasar por CITAS_ANULADAS?
--
-- El hospital podría mover la cita con un DELETE seco (sin archivar) o con un
-- UPDATE de la PK. Las dos formas son invisibles para H.1 pero IGUAL de
-- destructivas para el espejo: la clave vieja desaparece de la misma manera.
--
-- Esta consulta lo mira por el otro lado: citas VIVAS de hipertensos con un
-- médico real, cuya hora cae en un turno que originalmente no era suyo. No es
-- concluyente por sí sola, pero si sale alta refuerza la hipótesis del
-- traslado aunque H.1 salga en cero.
SELECT TOP 20
       c.CD_CODI_MED_CIT   AS medico_real,
       c.CD_CODI_SER_CIT   AS servicio,
       COUNT(*)            AS citas
FROM dbo.CITAS_MEDICAS c
WHERE c.CD_CODI_SER_CIT = 'S39141-1'          -- control hipertensos
  AND c.CD_CODI_MED_CIT NOT IN ('76', '077')  -- pero NO en la agenda virtual
  AND c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
GROUP BY c.CD_CODI_MED_CIT, c.CD_CODI_SER_CIT
ORDER BY citas DESC;
GO

-- =============================================================================
-- I. ✅ CERRADA — NU_ESTA_CIT = 2 es INCUMPLIDA (no asistió)
--
-- Tres corridas: I.1-I.4 (06-sep), I.7-I.9 e I.15 (07-sep).
-- **El driver ya lo implementa:** `desenlaceDeAtencion(2) === 'NO_SHOW'`.
--
-- ═══ I.15 CERRÓ LA ÚLTIMA DUDA (2026-09-07) ═══
--
-- La sospecha era que el estado 2 fuera flujo de trabajo («este médico cierra
-- así») en vez de un desenlace del paciente. Queda descartado:
--
--        medicos_con_citas_cerradas ... 52
--        mezclan_1_y_2 ................ 48
--        solo_estado_1 ................. 4
--        solo_estado_2 ................. 0   ← NINGUNO
--
--   · 48 de 52 médicos usan LOS DOS estados. Ninguno cierra solo en 2.
--   · Los porcentajes forman un continuo suave del 1,70 % (MDD1) al 31,48 %
--     (PS08), SIN los grupos en 0 % y 100 % que delatarían una costumbre.
--   · El zoom al 2026-09-05 lo remata: 13 de 17 médicos tuvieron ambos
--     estados ESE MISMO DÍA. Y explica el espejismo de I.7 — RU69 cerró 21/21
--     en estado 1 ese día, que con su tasa habitual del 7,6 % ocurre una de
--     cada cinco veces; PS06 tuvo 7 de 15 (46 %) contra su 31 % habitual. El
--     `TOP 5` pescó justo esos dos.
--
-- 🎯 Y EL GRADIENTE POR SERVICIO ES LO QUE LO VUELVE IRREFUTABLE:
--
--        Enfermería 1ª infancia / infancia ....... 43-49 %
--        Adolescente / joven / adulto (PyDT) ..... 29-39 %
--        Psicología .............................. 27-33 %
--        Odontología ............................. 16-23 %
--        Medicina general ......................... 8-13 %
--        Especialistas (internista, derma, gine) .. 3-11 %
--        Control prenatal / recién nacido ......... 2-7 %
--
--   Es EXACTAMENTE el orden de adherencia esperada del paciente: lo
--   preventivo y sin síntomas arriba, lo que costó meses conseguir abajo.
--   Ningún artefacto administrativo ordena los servicios por lo que el
--   paciente siente. Esto no lo produce una costumbre de digitación.
--
--   (De paso: explica por qué PS06 y PS08 encabezaban la lista de médicos —
--    son psicólogos, no «los que cierran raro».)
--
-- ═══ LAS CINCO PATAS, JUNTAS ═══
--   1. El informe oficial del HIS filtra `NU_ESTA_CIT <> 3` ⇒ el catálogo del
--      fabricante es 0=asignada, 1=cumplida, 2=incumplida, 3=anulada.
--   2. Cero filas futuras en estado 2; su frontera es siempre «ayer».
--   3. El motivo `NA` de CITAS_ANULADAS se usa 4 veces al año contra ~16.800
--      del estado 2: no hay otro sitio donde viva el no-show.
--   4. 48/52 médicos mezclan; ninguno cierra solo en 2 ⇒ decisión por cita.
--   5. El gradiente clínico por servicio.
--
-- ═══ I.10 CORRIDA (2026-09-07): apoya, pero NO era la prueba ═══
--
-- ⚠️ Anuncié `MULTA_TEMP` como «la firma definitiva». No lo fue: **la tabla
--    está VACÍA** — ni el `TOP 20` ni el `GROUP BY NU_ESTA_CIT` devolvieron
--    una sola fila. Es evidencia ESTRUCTURAL, no empírica.
--
--    (El sufijo `_TEMP` explica el vacío: es un buffer de proceso, como
--     `TEMPO_ESTA` y `TEMP_CAMB_ESTADO`, que también salieron vacías en I.9.
--     Se llena, se procesa y se vacía. O el hospital no cobra multas.)
--
-- 🔎 Pero su ESTRUCTURA sí dice algo, y apunta al mismo sitio:
--
--        NU_NUME_MULT      int       ← número de multa
--        VL_VALO_MULT      float     ← VALOR EN DINERO
--        NU_ESTA_MULT      tinyint   ← estado de la multa
--        FE_HORA_CIT_MULT  varchar   ← la hora de LA CITA
--        FE_FECH_CIT       datetime  ← la fecha de LA CITA
--        NU_ESTA_CIT       tinyint   ← EL ESTADO DE LA CITA
--        NU_HIST_PAC       varchar   ← el paciente
--        PACIENTE          varchar
--        NO_NOMB_EPS       varchar
--        USUARIOANUL / USUARIOINAC   ← quién anuló / inactivó la multa
--
--    Una tabla de MULTAS que copia dentro de sí el estado de una cita solo
--    tiene sentido si **ese estado es lo que justifica el cobro**. Y la multa
--    que un hospital colombiano le cobra a un paciente por una cita es la de
--    inasistencia. Encaja con `2 = incumplida` y con nada más.
--
--    Es una SEXTA pata, más débil que las cinco anteriores porque es de
--    diseño y no de datos. No cambia la conclusión ni la refuta.
--
-- ═══ I.7 SIGUE SIN CONTESTAR ═══
--   Se volvió a correr y devolvió lo mismo (era determinista). **Esto no es
--   la respuesta**: la consulta solo GENERA la lista. Falta que una persona
--   del hospital abra una de esas cinco citas en estado 2 —por ejemplo la de
--   PS06 del 2026-09-05 a las 14:30, historia 1054924377— y diga qué etiqueta
--   le muestra su pantalla. Cuesta un minuto y es la única prueba directa.
--
-- ═══ 🆕 HALLAZGO COLATERAL: EXISTE UN ESQUEMA `ADMIN` ═══
--   `MULTA_TEMP` salió por duplicado: `dbo.MULTA_TEMP` y `ADMIN.MULTA_TEMP`
--   (casi idénticas; la de `dbo` tiene `CD_CODI_CONV` de más). **En toda la
--   Fase 0 nunca había aparecido un esquema distinto de `dbo`.**
--
--   El agente no corre peligro: prefija `dbo.` en las nueve referencias que
--   hace (verificado), y la prueba de fuego confirmó que la cita escrita en
--   `dbo.CITAS_MEDICAS` salió en la pantalla del hospital. Pero conviene
--   cerrar qué más vive ahí antes de producción → **I.16**.
--
-- ═══ LO QUE QUEDA (nada de esto bloquea) ═══
--   · **I.7** — la confirmación humana. La más limpia y la más barata.
--   · **I.16** — qué hay en el esquema `ADMIN` (nuevo).
--   · I.11-I.14 — complementarias.
--   Si algo contradijera la conclusión, revertir es una línea en `mapping.ts`.
--
-- =============================================================================

-- =============================================================================
-- I. 🔍 ¿QUÉ ES NU_ESTA_CIT = 2?  — I.1-I.4 (06-sep) e I.7-I.9 (07-sep)
--
-- ═══ SEGUNDA CORRIDA (2026-09-07): I.7, I.8 e I.9 ═══
--
-- 🎯 I.8 ES LA QUE MÁS PESA, y no era la que iba a pesar. El catálogo
--    `MOTIVOANUL` y su uso en 365 días:
--
--        05  PACIENTE LLAMA A CANCELAR ... 7.087   (85,4 % de las anulaciones)
--        01  ERROR DE CAJERO ............... 567
--        06  DOBLE CONSULTA ................ 485
--        09  EDAD NO CORRESPONDE ............ 86
--        WB  CANCELADO WEB ................. 16
--        ...
--        NA  NO ASISTIO ..................... 4   ← CUATRO. EN UN AÑO.
--        (total ≈ 8.301 anulaciones/año)
--
--    · **El motivo 05 es "PACIENTE LLAMA A CANCELAR"**, no "no asistió". Eso
--      cierra el pendiente 0b, que llevaba abierto desde agosto.
--    · **`NA` = "NO ASISTIO" se usa 4 veces al año.** El estado 2 recibe
--      ~16.800 filas al año (644 cada 14 días, medido en I.1). Son cuatro mil
--      doscientas veces más. Si el no-show del hospital viviera en
--      `CITAS_ANULADAS`, este hospital tendría CUATRO inasistencias anuales.
--      No hay otro sitio donde pueda estar: **está en el estado 2.**
--    · Ojo al leer el catálogo: la mitad de los motivos son de FACTURACIÓN
--      ("NO POS", "COPAGO NO COBRADO", "EXAMEN SIN RESULTADOS", "DEVOLUCION
--      DINERO"). `MOTIVOANUL` es un catálogo COMPARTIDO entre anular una cita
--      y anular un cargo — no todos sus códigos aplican a una cita.
--    · `WB` (CANCELADO WEB) es el motivo que escribe nuestro driver
--      (`mapping.json`). Existe y ya tiene 16 usos reales: elección validada.
--
-- ❌ I.9 CERRÓ LAS TRES VÍAS, todas en falso. No hay catálogo de estados en
--    la base — el significado de NU_ESTA_CIT vive solo en el código de la
--    aplicación cliente, que no está en SQL Server:
--
--    · `dbo.ESTADO` → columnas `TX_NOMB_ESTA` + `NU_AUTO_ESTA`, y **VACÍA**.
--      Además el `NU_AUTO_` delata un autonumérico, y `NU_ESTA_CIT` es un
--      tinyint de dominio fijo (0-3). No es el catálogo aunque se llame así.
--    · `TEMP_CAMB_ESTADO` → **VACÍA**, y sus columnas son de FARMACIA
--      (`NUM_ORDER_MED`, `DOSIS`, `ARTICULO`, `DESPACHO`, `UVENTA`). El
--      nombre engañaba.
--    · `TEMPO_ESTA` → facturación de **ESTAncia hospitalaria**, no de
--      "estado" (`CD_CODI_SER`, `VALOR_TEMP`, `NU_NUME_CONV`, `NO_NOMB_EPS`).
--
--    🔎 Lección sobre I.2: su `LIKE '%ESTA%'` capturaba «ESTAncia» y por eso
--    devolvió once tablas de las que nueve eran ruido. La búsqueda por nombre
--    no sirve en este HIS.
--
-- ⚠️ I.7 NO ESTÁ CONTESTADA — solo se generó la lista. La prueba es que
--    alguien del hospital ABRA esas diez citas en su pantalla y diga qué
--    estado muestran. Eso sigue pendiente. Lo que sí dicen los datos:
--
--        estado 1 → RU69 (YULIETH RIOS) ×5, servicios S39141 / -1 / -2
--        estado 2 → RU62 (DIEGO RODRIGUEZ) ×1 y PS06 (M. GALEANO) ×4,
--                   servicios S39141, S35102 / -1, S35104
--
--    · **Las diez son del MISMO DÍA (2026-09-05)** y el servicio `S39141`
--      aparece en AMBOS estados. Luego el 2 no es «así se cierra tal día» ni
--      «así se cierra tal servicio». Es una decisión POR CITA. Eso descarta
--      dos alternativas de golpe.
--    · 🚨 **Pero abre una tercera que hay que descartar:** en la muestra el
--      estado 1 es todo de un médico y el 2 de otros dos. Puede ser un
--      artefacto (el `TOP 5 ORDER BY FE_FECH_CIT` no desempata entre citas
--      del mismo día, así que devuelve lo que el índice tenga a mano), pero
--      si NO lo fuera —si unos médicos cerraran todo como 1 y otros como 2—
--      entonces el 2 sería flujo de trabajo, no inasistencia, y no se podría
--      usar. **Lo decide I.15.**
--
-- ═══ DÓNDE QUEDA LA PREGUNTA ═══
--   Hipótesis `2` = INCUMPLIDA: más fuerte que ayer (I.8 elimina el único
--   sitio alternativo donde podía vivir el no-show). Falta cerrar I.15 (que
--   no sea un patrón por médico) y una confirmación humana: I.7 o I.10.
--   **I.10 (`MULTA_TEMP`) sigue sin correr y es la más prometedora de todas.**
--
-- =============================================================================

-- =============================================================================
-- I. 🔍 ¿QUÉ ES NU_ESTA_CIT = 2?  — I.1-I.4 CORRIDAS EL 2026-09-06
--
-- ✅ RESPUESTA CASI CERRADA: **2 = INCUMPLIDA (no asistió)**. Inferencia muy
--    fuerte, no prueba. La cierra I.7 (que el hospital lo lea en su pantalla)
--    o I.9 (si `dbo.ESTADO` resulta ser el catálogo).
--
-- 🔑 EL HALLAZGO: I.3 encontró UN solo objeto que menciona NU_ESTA_CIT, el
--    informe oficial `PA_PLANO_0256` (Resolución 256 del MinSalud), y su
--    filtro dice:
--
--        WHERE NU_PRIM_CIT = 1 AND ... AND NU_ESTA_CIT <> 3 AND ...
--
--    **`<> 3`.** La aplicación conoce un estado 3 que en ESEHSVP no existe
--    (I.1 solo devuelve 0, 1 y 2). Eso revela el catálogo del FABRICANTE, que
--    es de cuatro valores, y en el ciclo de vida estándar de una cita en
--    Colombia solo hay una lectura posible:
--
--        0 = ASIGNADA    1 = CUMPLIDA    2 = INCUMPLIDA    3 = ANULADA
--
--    · El 3 no aparece porque ESTE hospital anula BORRANDO la fila y
--      archivándola en CITAS_ANULADAS (prueba manual del 2026-08-23). El
--      producto soporta las dos formas; el hospital usa una.
--    · El informe excluye solo el 3 — o sea, cuenta el 2 como cita asignada.
--      Correcto para un indicador de oportunidad: la cita se asignó, el
--      paciente no fue.
--
-- 📊 Y los números de I.1 encajan con eso, con dos confirmaciones nuevas:
--
--        estado  filas     %      fecha_min    fecha_max    futuras
--        0       34.826    3,21   2024-06-14   2027-09-04   6.841
--        1       891.859   82,16  2009-04-30   2026-10-02   1
--        2       158.799   14,63  2009-03-05   2026-09-05   0
--
--    · **futuras = 0 para el estado 2**, como se predijo. Un «no asistió» no
--      se puede marcar antes de la fecha.
--    · **Su fecha máxima es AYER** (2026-09-05; la consulta se corrió el 06).
--      En la corrida del 2026-08-23 el tope era el 2026-08-15, también ~una
--      semana atrás. La frontera AVANZA con el calendario: no es un valor
--      legado ni una migración, es un proceso vivo que corre a diario.
--    · El ritmo cuadra: en esos 14 días entraron +4.274 al estado 1 y +644 al
--      2 — un 13,1 %, casi idéntico al 14,63 % histórico.
--    · Los dos estados llegan hasta 2009: el 2 no es una novedad reciente.
--
-- ⚠️ I.5 ESTÁ MAL PLANTEADA, no la uses como está. Decía que si las citas en
--    estado 2 tienen convenio como las de estado 1, alguien las atendió. Es
--    falso: `NU_NUME_CONV_CIT` se escribe al CREAR la cita (lo hace la app, y
--    lo hace también nuestro driver en su INSERT), no al facturarla. Va a dar
--    ~100 % en los dos estados y no distingue nada. El sustituto correcto es
--    I.12.
--
-- 🆕 DOS HALLAZGOS QUE NO SE BUSCABAN, en I.1:
--
--    1. **27.985 citas en estado 0 con fecha PASADA** (34.826 − 6.841 futuras),
--       desde 2024-06-14. Son ocho de cada diez filas del estado 0. El cierre
--       0→1/2 NO se aplica siempre. Consecuencia directa para el agente: que
--       una cita no haya cambiado de estado NO significa que se atendió.
--       Detalle en I.13.
--    2. **Una cita FUTURA en estado 1.** Parece anecdótico y no lo es: la PK
--       es (médico, hora, ESTADO), así que una fila en estado 1 o 2 NO impide
--       insertar otra en estado 0 a la misma hora. Con `availabilityMode=OFF`
--       —que es como arranca el piloto— la agenda de AgenIA no sale de
--       TURNOS_MEDICOS, y el detector de colisión por violación de PK no
--       saltaría. Se mide en I.14.
--
-- 📋 PENDIENTES DE CORRER: I.7 (la definitiva), y la ronda I.9-I.14 de abajo.
-- =============================================================================

-- =============================================================================
-- I. 🔍 ¿QUÉ ES NU_ESTA_CIT = 2?  — enunciado original
--
-- Lo que YA está confirmado y no hay que volver a preguntar:
--
--   · NU_ESTA_CIT es la PARTE 3 de la PK de CITAS_MEDICAS
--     (CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT). El estado integra la clave.
--   · 0 = VIGENTE / agendada. Todas las citas futuras están aquí. Confirmado.
--   · 1 = ATENDIDA. Confirmado: las históricas en 1 siguen siendo filas únicas
--     de CITAS_MEDICAS y NUNCA aparecen en CITAS_ANULADAS. La transición 0→1
--     es un UPDATE EN SITIO.
--   · CANCELAR NO ES UN ESTADO: es DELETE de CITAS_MEDICAS + INSERT en
--     CITAS_ANULADAS (prueba manual del 2026-08-23, §2.1bis del MAPEO).
--   · 2 = ❓ NADIE HA CONFIRMADO QUÉ ES. Es lo único que falta.
--
-- ⚠️ CORRIGE UNA CREENCIA QUE ESTABA ESCRITA EN EL CÓDIGO. El estado 2 se creía
-- «raro» porque solo salieron 3 casos en las muestras del paciente de prueba.
-- El bloque 4 sobre el catálogo VIVO dice otra cosa:
--
--     estado 0 →      34.552 filas  (hasta 2027-08-28, hay futuras)
--     estado 1 →     887.585 filas  (hasta 2026-10-02)
--     estado 2 →     158.155 filas  (hasta 2026-08-15, CERO futuras)
--
-- 158.155 de 1.080.292 es el 14,6 % de la agenda histórica del hospital. No es
-- una curiosidad: es uno de cada siete pacientes.
--
-- POR QUÉ IMPORTA AHORA
--   1. HIS→AgenIA: hoy `desenlaceDeAtencion()` devuelve null para el 2, así que
--      el desenlace de ese 14,6 % NUNCA llega a AgenIA. En el journal sale como
--      «un desenlace sin significado confirmado. No se reporta.»
--   2. AgenIA→HIS: `updateAttendance()` está sin implementar precisamente
--      porque no se sabe qué valor escribir para un NO_SHOW. Esto lo destraba.
--
-- LA HIPÓTESIS MÁS FUERTE, y qué la haría caer
--   2 = NO ASISTIÓ, marcado DESPUÉS de la fecha. Encaja con «cero futuras» y
--   con que el 14,6 % es una tasa de inasistencia creíble en consulta externa.
--   El motivo `NA` de CITAS_ANULADAS (285 casos) NO la contradice: 285 contra
--   158.155 son dos órdenes de magnitud distintos, así que `NA` sería el
--   «avisó que no venía» y el 2 el «no se presentó y nadie lo canceló».
--   La caída de la hipótesis sería I.5: si las citas en 2 tienen convenio de
--   facturación igual que las de 1, alguien las atendió y 2 significa otra cosa.
--
-- CÓMO CORRER ESTO
--   · 100 % LECTURA. Ni un INSERT, ni un UPDATE, ni un DELETE.
--   · En ESEHSVP (catálogo vivo). En PRUEBAS los resultados no valen: no tiene
--     el histórico completo y el 2 vive todo en el pasado.
--   · I.1 a I.6 se contestan solas con SQL. I.7 NO: produce la lista de filas
--     concretas para que alguien del hospital las abra en la pantalla del HIS
--     y diga qué etiqueta les muestra. Esa es la única prueba definitiva —
--     ninguna consulta puede leer un nombre que la base no guarda.
-- =============================================================================
USE ESEHSVP;
GO

-- ── I.1 El censo actualizado por estado ──────────────────────────────────────
-- Repite el bloque 4 con dos columnas nuevas que son las que deciden: cuántas
-- filas del estado son FUTURAS, y cuánto tiempo pasa entre la fecha de la cita
-- y el momento en que se elaboró el registro.
--
-- QUÉ CONFIRMARÍA LA HIPÓTESIS: futuras = 0 para el estado 2, y que su fecha
-- máxima siga sin alcanzar a hoy (un «no asistió» solo se puede marcar después).
SELECT NU_ESTA_CIT                                        AS estado,
       COUNT(*)                                           AS filas,
       CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5,2)) AS pct,
       MIN(FE_FECH_CIT)                                   AS fecha_min,
       MAX(FE_FECH_CIT)                                   AS fecha_max,
       SUM(CASE WHEN FE_FECH_CIT > GETDATE() THEN 1 ELSE 0 END) AS futuras
FROM dbo.CITAS_MEDICAS
GROUP BY NU_ESTA_CIT
ORDER BY NU_ESTA_CIT;
GO

-- ── I.2 ¿La base guarda en algún sitio el NOMBRE de los estados? ─────────────
-- Si existe un catálogo, esto se acaba aquí y no hace falta nada más. Se busca
-- por nombre de tabla y por nombre de columna, porque el HIS no es consistente
-- (MOTIVOANUL no se llama MOTIVOS_ANULACION).
SELECT s.name AS esquema, t.name AS tabla,
       (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS columnas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.name LIKE '%ESTA%' OR t.name LIKE '%ESTADO%'
ORDER BY t.name;

-- Columnas que se parezcan al estado de una cita, en CUALQUIER tabla: a veces
-- el catálogo existe con otro nombre y se delata por su columna.
SELECT t.name AS tabla, c.name AS columna, ty.name AS tipo, c.max_length
FROM sys.columns c
JOIN sys.tables t  ON t.object_id = c.object_id
JOIN sys.types ty  ON ty.user_type_id = c.user_type_id
WHERE c.name LIKE '%ESTA%CIT%' OR c.name LIKE '%DESC%ESTA%'
ORDER BY t.name, c.name;
GO

-- ── I.3 🔑 LA CONSULTA MÁS PROMETEDORA: qué dice el código del propio HIS ────
-- Los informes del hospital tienen que separar «atendidas» de lo que no lo es,
-- y para eso filtran por NU_ESTA_CIT. Un `WHERE NU_ESTA_CIT = 1` dentro de un
-- SP llamado ..._ATENDIDAS, o un CASE que traduzca el número a texto, contesta
-- la pregunta sin molestar a nadie.
--
-- Ya se sabe que NO hay SPs de agendamiento (no hay triggers ni lógica oculta);
-- estos son de lectura/informes, que es justo donde vive la semántica.
SELECT o.type_desc, o.name AS objeto, m.definition
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%NU_ESTA_CIT%'
ORDER BY o.type_desc, o.name;
GO

-- ── I.4 ¿Cuándo se marca el 2, respecto a la fecha de la cita? ───────────────
-- FE_ELAB_CIT es cuándo se CREÓ el registro, no cuándo cambió de estado (no hay
-- columna de modificación). Pero sirve igual: si las filas en estado 2 se
-- crearon ANTES de su propia fecha de cita, entonces nacieron como citas
-- normales y el 2 llegó después — o sea, es un desenlace, no un tipo de cita.
--
-- Si en cambio muchas se crearon el mismo día o después, el 2 sería otra cosa
-- (una cita registrada a posteriori, un traslado, un ajuste administrativo).
SELECT NU_ESTA_CIT                                     AS estado,
       COUNT(*)                                        AS filas,
       SUM(CASE WHEN FE_ELAB_CIT <  CAST(FE_FECH_CIT AS date) THEN 1 ELSE 0 END) AS elaborada_antes,
       SUM(CASE WHEN CAST(FE_ELAB_CIT AS date) = CAST(FE_FECH_CIT AS date) THEN 1 ELSE 0 END) AS mismo_dia,
       SUM(CASE WHEN FE_ELAB_CIT >  DATEADD(day, 1, CAST(FE_FECH_CIT AS date)) THEN 1 ELSE 0 END) AS elaborada_despues,
       AVG(CAST(DATEDIFF(day, FE_ELAB_CIT, FE_FECH_CIT) AS float))               AS dias_media_antelacion
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= DATEADD(day, -365, CAST(GETDATE() AS date))
  AND FE_FECH_CIT <  CAST(GETDATE() AS date)   -- solo pasado: el 0 no compite
  AND FE_ELAB_CIT IS NOT NULL
GROUP BY NU_ESTA_CIT
ORDER BY NU_ESTA_CIT;
GO

-- ── I.5 🎯 LA QUE PUEDE TUMBAR LA HIPÓTESIS: ¿se facturaron? ─────────────────
-- Una cita atendida se factura a un convenio (NU_NUME_CONV_CIT). Una a la que
-- el paciente no se presentó, normalmente no.
--
-- CÓMO SE LEE:
--   · Si el estado 2 tiene MUCHOS menos convenios que el 1  → 2 = no atendida.
--     La hipótesis se sostiene y se puede implementar NO_SHOW → 2.
--   · Si el estado 2 tiene convenio igual que el 1          → alguien la
--     atendió. 2 significa OTRA cosa (¿otra sede? ¿reprogramada? ¿facturada
--     aparte?) y NO se puede usar para NO_SHOW. En ese caso, I.7 manda.
--
-- CD_CODI_EST_CIT es la otra columna de «estado» de la tabla (varchar(3),
-- propósito nunca confirmado). Si se mueve junto con NU_ESTA_CIT, el par
-- cuenta la historia completa.
SELECT NU_ESTA_CIT                                              AS estado,
       COUNT(*)                                                 AS filas,
       SUM(CASE WHEN NU_NUME_CONV_CIT IS NOT NULL THEN 1 ELSE 0 END) AS con_convenio,
       CAST(100.0 * SUM(CASE WHEN NU_NUME_CONV_CIT IS NOT NULL THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0) AS decimal(5,2))              AS pct_con_convenio,
       COUNT(DISTINCT NU_NUME_CONV_CIT)                         AS convenios_distintos,
       SUM(CASE WHEN NU_HIST_PAC_CIT IS NULL THEN 1 ELSE 0 END) AS sin_paciente,
       COUNT(DISTINCT CD_CODI_EST_CIT)                          AS valores_cd_codi_est
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= DATEADD(day, -365, CAST(GETDATE() AS date))
  AND FE_FECH_CIT <  CAST(GETDATE() AS date)
GROUP BY NU_ESTA_CIT
ORDER BY NU_ESTA_CIT;

-- El cruce de las dos columnas de estado, por si CD_CODI_EST_CIT desambigua.
SELECT NU_ESTA_CIT AS estado, CD_CODI_EST_CIT AS estado_admin, COUNT(*) AS filas
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= DATEADD(day, -365, CAST(GETDATE() AS date))
  AND FE_FECH_CIT <  CAST(GETDATE() AS date)
GROUP BY NU_ESTA_CIT, CD_CODI_EST_CIT
ORDER BY estado, filas DESC;
GO

-- ── I.6 ¿1 y 2 son alternativas del mismo cupo, o pueden convivir? ───────────
-- La PK permite que (médico, hora) tenga una fila en 1 y otra en 2 a la vez.
-- Si eso NO pasa nunca, son desenlaces excluyentes del mismo cupo — que es lo
-- que se espera de «atendida» vs «no asistió».
--
-- (El driver ya sobrevive a este caso: prefiere la fila en estado 0. Esto es
--  para saber si ocurre de verdad o solo en teoría.)
SELECT COUNT(*) AS cupos_con_estado_1_y_2
FROM (
    SELECT CD_CODI_MED_CIT, FE_HORA_CIT
    FROM dbo.CITAS_MEDICAS
    WHERE NU_ESTA_CIT IN (1, 2)
      AND FE_FECH_CIT >= DATEADD(day, -365, CAST(GETDATE() AS date))
    GROUP BY CD_CODI_MED_CIT, FE_HORA_CIT
    HAVING COUNT(DISTINCT NU_ESTA_CIT) > 1
) x;

-- La proporción 1 vs 2 por mes. Una tasa estable en torno al 10-20 % es la
-- firma de la inasistencia; picos o saltos bruscos apuntan a un uso
-- administrativo (una migración, un cambio de proceso).
SELECT DATEFROMPARTS(YEAR(FE_FECH_CIT), MONTH(FE_FECH_CIT), 1) AS mes,
       SUM(CASE WHEN NU_ESTA_CIT = 1 THEN 1 ELSE 0 END) AS estado_1,
       SUM(CASE WHEN NU_ESTA_CIT = 2 THEN 1 ELSE 0 END) AS estado_2,
       CAST(100.0 * SUM(CASE WHEN NU_ESTA_CIT = 2 THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0) AS decimal(5,2))      AS pct_estado_2
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT >= DATEADD(month, -12, CAST(GETDATE() AS date))
  AND FE_FECH_CIT <  CAST(GETDATE() AS date)
  AND NU_ESTA_CIT IN (1, 2)
GROUP BY DATEFROMPARTS(YEAR(FE_FECH_CIT), MONTH(FE_FECH_CIT), 1)
ORDER BY mes;
GO

-- ── I.7 📋 LA PRUEBA DEFINITIVA — para pedirle al hospital ───────────────────
-- Ninguna consulta puede devolver una etiqueta que la base no guarda. Esto
-- genera diez citas REALES y recientes, cinco en estado 1 y cinco en estado 2,
-- del mismo médico siempre que se pueda.
--
-- QUÉ PEDIR, literalmente:
--   «¿Pueden abrir estas diez citas en la pantalla de agenda del HIS y
--    decirnos qué estado muestra cada una? Son solo consultas, no hay que
--    modificar nada.»
--
-- Si las cinco de estado 2 salen como «No asistió» / «Incumplida», cerrado.
SELECT TOP 5
       'estado 1' AS grupo, c.CD_CODI_MED_CIT AS medico, m.NO_NOMB_MED AS nombre_medico,
       c.FE_FECH_CIT AS fecha, c.FE_HORA_CIT AS hora,
       c.NU_HIST_PAC_CIT AS historia, c.CD_CODI_SER_CIT AS servicio,
       c.NU_ESTA_CIT AS estado_en_bd
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = c.CD_CODI_MED_CIT
WHERE c.NU_ESTA_CIT = 1
  AND c.FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  CAST(GETDATE() AS date)
  AND c.NU_HIST_PAC_CIT IS NOT NULL
ORDER BY c.FE_FECH_CIT DESC;

SELECT TOP 5
       'estado 2' AS grupo, c.CD_CODI_MED_CIT AS medico, m.NO_NOMB_MED AS nombre_medico,
       c.FE_FECH_CIT AS fecha, c.FE_HORA_CIT AS hora,
       c.NU_HIST_PAC_CIT AS historia, c.CD_CODI_SER_CIT AS servicio,
       c.NU_ESTA_CIT AS estado_en_bd
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = c.CD_CODI_MED_CIT
WHERE c.NU_ESTA_CIT = 2
  AND c.FE_FECH_CIT >= DATEADD(day, -30, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  CAST(GETDATE() AS date)
  AND c.NU_HIST_PAC_CIT IS NOT NULL
ORDER BY c.FE_FECH_CIT DESC;
GO

-- ── I.8 La curiosidad barata que ya estaba anotada arriba ────────────────────
-- Qué es el motivo '05', que domina las anulaciones. Si resulta ser «no
-- asistió», entonces el no-show se registra de DOS formas distintas y hay que
-- saberlo antes de contar nada.
SELECT CD_CODI_MOTI AS codigo, DE_DESC_MOTI AS descripcion
FROM dbo.MOTIVOANUL
ORDER BY CD_CODI_MOTI;

SELECT a.CD_CODI_MOTI_CIAN AS motivo, mo.DE_DESC_MOTI AS descripcion, COUNT(*) AS anulaciones
FROM dbo.CITAS_ANULADAS a
LEFT JOIN dbo.MOTIVOANUL mo ON mo.CD_CODI_MOTI = a.CD_CODI_MOTI_CIAN
WHERE a.FE_FECH_CIAN >= DATEADD(day, -365, CAST(GETDATE() AS date))
GROUP BY a.CD_CODI_MOTI_CIAN, mo.DE_DESC_MOTI
ORDER BY anulaciones DESC;
GO

-- =============================================================================
-- I.9 - I.14  SEGUNDA RONDA — cerrar el 2 y medir lo que destapó I.1
--
-- Todo sigue siendo 100 % LECTURA, contra ESEHSVP.
-- =============================================================================
USE ESEHSVP;
GO

-- ── I.9 🎯 Las tres tablas que I.2 dejó sobre la mesa ────────────────────────
-- I.2 buscaba un catálogo de estados y devolvió once tablas. Tres tienen la
-- forma correcta y NO se miraron:
--
--   · dbo.ESTADO          → 2 columnas. Es EXACTAMENTE la forma de un catálogo
--                           código+descripción, igual que MOTIVOANUL. Puede
--                           ser el catálogo de estados de cita... o «estado
--                           civil», o «estado/departamento». Se ve en un
--                           segundo y si acierta, cierra la pregunta entera.
--   · dbo.TEMP_CAMB_ESTADO → 17 columnas. El nombre dice «cambio de estado».
--                           Si registra transiciones de cita, dice quién
--                           marcó el 2 y cuándo.
--   · dbo.TEMPO_ESTA      → 14 columnas.
SELECT 'ESTADO' AS tabla, * FROM dbo.ESTADO;

SELECT TOP 20 'TEMP_CAMB_ESTADO' AS tabla, * FROM dbo.TEMP_CAMB_ESTADO;

SELECT TOP 20 'TEMPO_ESTA' AS tabla, * FROM dbo.TEMPO_ESTA;
GO

-- ── I.10 🔍 MULTA_TEMP: la otra tabla con una columna NU_ESTA_CIT ────────────
-- I.2 encontró `NU_ESTA_CIT` en dos tablas: CITAS_MEDICAS y **MULTA_TEMP**.
-- Que una tabla de MULTAS lleve el estado de la cita es una pista fuerte: en
-- Colombia la multa por inasistencia es una figura real. Si las multas se
-- generan sobre citas en estado 2, la pregunta está contestada.
--
-- (Nota: I.2 devolvió MULTA_TEMP dos veces. La consulta no seleccionaba el
--  esquema, así que probablemente son dos tablas homónimas en esquemas
--  distintos. Esta lo aclara.)
SELECT s.name AS esquema, t.name AS tabla, c.name AS columna, ty.name AS tipo
FROM sys.columns c
JOIN sys.tables t   ON t.object_id = c.object_id
JOIN sys.schemas s  ON s.schema_id = t.schema_id
JOIN sys.types ty   ON ty.user_type_id = c.user_type_id
WHERE t.name = 'MULTA_TEMP'
ORDER BY s.name, c.column_id;

SELECT TOP 20 * FROM dbo.MULTA_TEMP;

-- ¿Qué estados llevan las filas de MULTA_TEMP? Si son casi todas 2, cerrado.
SELECT NU_ESTA_CIT AS estado, COUNT(*) AS multas
FROM dbo.MULTA_TEMP
GROUP BY NU_ESTA_CIT
ORDER BY multas DESC;
GO

-- ── I.11 ¿El estado 3 existe en algún sitio? ─────────────────────────────────
-- La app filtra `NU_ESTA_CIT <> 3` pero en ESEHSVP no hay ni una fila con ese
-- valor. Dos lecturas: (a) el 3 es de otra instalación del mismo producto y
-- aquí no se usa, (b) se usó alguna vez y ya no. Esto lo separa: mira si el
-- catálogo de años anteriores (ESEHSVP2024/2025, que son ARCHIVOS, no rotación)
-- tiene filas en 3.
--
-- ⚠️ Si estas bases no existen o agenia_sync no las alcanza, la consulta falla:
--    no pasa nada, es información extra. Saltarla y seguir.
SELECT '2024' AS archivo, NU_ESTA_CIT AS estado, COUNT(*) AS filas
FROM ESEHSVP2024.dbo.CITAS_MEDICAS GROUP BY NU_ESTA_CIT
UNION ALL
SELECT '2025', NU_ESTA_CIT, COUNT(*)
FROM ESEHSVP2025.dbo.CITAS_MEDICAS GROUP BY NU_ESTA_CIT
ORDER BY archivo, estado;
GO

-- ── I.12 ✅ EL SUSTITUTO DE I.5: ¿quedó rastro clínico de la atención? ───────
-- I.5 no sirve (el convenio se escribe al CREAR la cita, no al facturarla).
-- El discriminador bueno es otro: una cita ATENDIDA deja rastro en alguna
-- tabla clínica o de facturación; una a la que el paciente no fue, no.
--
-- Primero hay que saber QUÉ tabla apunta a una cita. Esto lista las columnas
-- que se llaman como las de CITAS_MEDICAS fuera de ella: son las candidatas a
-- ser el enlace (consulta, evolución, RIPS, factura).
SELECT s.name AS esquema, t.name AS tabla, c.name AS columna,
       (SELECT SUM(p.rows) FROM sys.partitions p
         WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas_aprox
FROM sys.columns c
JOIN sys.tables t  ON t.object_id = c.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.name NOT IN ('CITAS_MEDICAS', 'CITAS_ANULADAS')
  AND (c.name IN ('CD_CODI_MED_CIT', 'FE_HORA_CIT', 'NU_HIST_PAC_CIT')
       OR c.name LIKE '%_CIT')
ORDER BY t.name, c.name;

-- Y las tablas de RIPS, que es donde por ley tiene que quedar la consulta
-- efectivamente prestada. Si existe una tabla AC/consultas, el cruce contra
-- CITAS_MEDICAS por (historia, fecha) separa atendidas de no atendidas mejor
-- que ninguna otra cosa.
SELECT s.name AS esquema, t.name AS tabla,
       (SELECT SUM(p.rows) FROM sys.partitions p
         WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas_aprox
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.name LIKE '%RIPS%' OR t.name LIKE '%CONSULTA%' OR t.name LIKE '%EVOLUC%'
ORDER BY t.name;
GO

-- ── I.13 🆕 Las 27.985 citas pasadas que siguen en estado 0 ──────────────────
-- Ocho de cada diez filas del estado 0 tienen fecha pasada, desde 2024-06-14.
-- El cierre 0→1/2 no se aplica siempre, y eso cambia una conclusión del
-- driver: la AUSENCIA de transición no significa que la cita se atendiera.
--
-- ¿Es un servicio concreto? ¿Un médico? ¿Un periodo? La respuesta decide si
-- hay que tratarlas de forma especial en la reconciliación.
SELECT TOP 30
       c.CD_CODI_SER_CIT            AS servicio,
       s.NO_NOMB_SER                AS nombre_servicio,
       COUNT(*)                     AS citas_abiertas,
       MIN(c.FE_FECH_CIT)           AS mas_antigua,
       MAX(c.FE_FECH_CIT)           AS mas_reciente,
       COUNT(DISTINCT c.CD_CODI_MED_CIT) AS medicos
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
WHERE c.NU_ESTA_CIT = 0
  AND c.FE_FECH_CIT < CAST(GETDATE() AS date)
GROUP BY c.CD_CODI_SER_CIT, s.NO_NOMB_SER
ORDER BY citas_abiertas DESC;

-- Por mes: ¿es deuda vieja que dejó de crecer, o sigue pasando hoy?
SELECT DATEFROMPARTS(YEAR(FE_FECH_CIT), MONTH(FE_FECH_CIT), 1) AS mes,
       COUNT(*) AS citas_pasadas_sin_cerrar
FROM dbo.CITAS_MEDICAS
WHERE NU_ESTA_CIT = 0
  AND FE_FECH_CIT < CAST(GETDATE() AS date)
GROUP BY DATEFROMPARTS(YEAR(FE_FECH_CIT), MONTH(FE_FECH_CIT), 1)
ORDER BY mes;
GO

-- ── I.14 🚨 Riesgo de doble reserva que el detector de colisión NO ve ────────
-- La PK es (médico, hora, ESTADO). Una fila en estado 1 o 2 NO impide insertar
-- otra en estado 0 a la misma hora: el INSERT del agente tendría éxito y en la
-- agenda del hospital aparecerían dos pacientes en el mismo cupo, SIN error.
--
-- Con `availabilityMode = ON` no puede pasar (fetchAvailability marca como
-- ocupado cualquier cupo con una fila, sea cual sea su estado). Pero el piloto
-- arranca en OFF, y ahí la agenda de AgenIA es la suya: puede ofrecer una hora
-- que el HIS ya tiene cerrada.
--
-- Esto mide la exposición real. Si sale 0 o casi, es un riesgo teórico y basta
-- con dejarlo anotado. Si sale alto, hay que filtrar por estado antes de
-- encender a alguien en OFF.
SELECT COUNT(*) AS cupos_futuros_cerrados_sin_proteccion_de_pk
FROM dbo.CITAS_MEDICAS
WHERE NU_ESTA_CIT IN (1, 2)
  AND FE_FECH_CIT >= CAST(GETDATE() AS date);

-- El detalle, para poder mirarlos uno a uno si aparecen.
SELECT TOP 20 CD_CODI_MED_CIT AS medico, FE_FECH_CIT AS fecha,
       FE_HORA_CIT AS hora, NU_ESTA_CIT AS estado,
       CD_CODI_SER_CIT AS servicio, NU_HIST_PAC_CIT AS historia
FROM dbo.CITAS_MEDICAS
WHERE NU_ESTA_CIT IN (1, 2)
  AND FE_FECH_CIT >= CAST(GETDATE() AS date)
ORDER BY FE_FECH_CIT;
GO

-- =============================================================================
-- I.15  🚨 LA QUE DECIDE: ¿el estado 2 es POR CITA o POR MÉDICO?
--
-- I.7 devolvió las cinco citas en estado 1 de un solo médico (RU69) y las
-- cinco en estado 2 de otros dos (RU62, PS06). Casi seguro es un artefacto:
-- el `TOP 5 ORDER BY FE_FECH_CIT` no desempata entre citas del mismo día y
-- devuelve lo que el índice tenga a mano. Pero «casi seguro» no basta aquí.
--
-- POR QUÉ IMPORTA TANTO
--   Si cada médico tiene MEZCLA de 1 y 2 → el estado depende de lo que pasó
--   con ESE paciente. Es un desenlace. La hipótesis «2 = no asistió» se
--   sostiene y se puede implementar.
--
--   Si los médicos se PARTEN EN DOS GRUPOS —unos casi todo 1, otros casi todo
--   2— entonces el 2 no dice nada del paciente: dice cómo cierra la agenda
--   ese servicio o esa persona. Sería flujo de trabajo, y usarlo para marcar
--   NO_SHOW le colgaría a pacientes una inasistencia que no ocurrió.
--
-- CÓMO SE LEE
--   Mira la columna `pct_estado_2` en la lista de médicos:
--     · La mayoría entre ~5 % y ~30 %  → DESENLACE. Hipótesis confirmada.
--     · Muchos en 0 % y muchos en ~100 % → FLUJO DE TRABAJO. Hipótesis MUERTA,
--       y `desenlaceDeAtencion()` se queda como está para siempre.
-- =============================================================================
USE ESEHSVP;
GO

-- Resumen primero: ¿cuántos médicos mezclan los dos estados?
SELECT COUNT(*)                                                   AS medicos_con_citas_cerradas,
       SUM(CASE WHEN e1 > 0 AND e2 > 0 THEN 1 ELSE 0 END)         AS mezclan_1_y_2,
       SUM(CASE WHEN e2 = 0 THEN 1 ELSE 0 END)                    AS solo_estado_1,
       SUM(CASE WHEN e1 = 0 THEN 1 ELSE 0 END)                    AS solo_estado_2
FROM (
    SELECT CD_CODI_MED_CIT,
           SUM(CASE WHEN NU_ESTA_CIT = 1 THEN 1 ELSE 0 END) AS e1,
           SUM(CASE WHEN NU_ESTA_CIT = 2 THEN 1 ELSE 0 END) AS e2
    FROM dbo.CITAS_MEDICAS
    WHERE NU_ESTA_CIT IN (1, 2)
      AND FE_FECH_CIT >= DATEADD(day, -180, CAST(GETDATE() AS date))
      AND FE_FECH_CIT <  CAST(GETDATE() AS date)
    GROUP BY CD_CODI_MED_CIT
) x;

-- Y el detalle por médico: la forma de esta columna es la respuesta.
SELECT c.CD_CODI_MED_CIT                                    AS medico,
       m.NO_NOMB_MED                                        AS nombre,
       COUNT(*)                                             AS citas_cerradas,
       SUM(CASE WHEN c.NU_ESTA_CIT = 1 THEN 1 ELSE 0 END)   AS estado_1,
       SUM(CASE WHEN c.NU_ESTA_CIT = 2 THEN 1 ELSE 0 END)   AS estado_2,
       CAST(100.0 * SUM(CASE WHEN c.NU_ESTA_CIT = 2 THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0) AS decimal(5,2))          AS pct_estado_2
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = c.CD_CODI_MED_CIT
WHERE c.NU_ESTA_CIT IN (1, 2)
  AND c.FE_FECH_CIT >= DATEADD(day, -180, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  CAST(GETDATE() AS date)
GROUP BY c.CD_CODI_MED_CIT, m.NO_NOMB_MED
HAVING COUNT(*) >= 30          -- sin volumen el porcentaje no dice nada
ORDER BY pct_estado_2 DESC;
GO

-- Lo mismo por servicio, por si el patrón vive ahí y no en el médico.
SELECT c.CD_CODI_SER_CIT                                    AS servicio,
       s.NO_NOMB_SER                                        AS nombre,
       COUNT(*)                                             AS citas_cerradas,
       CAST(100.0 * SUM(CASE WHEN c.NU_ESTA_CIT = 2 THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0) AS decimal(5,2))          AS pct_estado_2
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
WHERE c.NU_ESTA_CIT IN (1, 2)
  AND c.FE_FECH_CIT >= DATEADD(day, -180, CAST(GETDATE() AS date))
  AND c.FE_FECH_CIT <  CAST(GETDATE() AS date)
GROUP BY c.CD_CODI_SER_CIT, s.NO_NOMB_SER
HAVING COUNT(*) >= 30
ORDER BY pct_estado_2 DESC;
GO

-- Zoom al día que salió en I.7 (2026-09-05): los dos estados conviviendo en
-- la misma jornada, médico a médico. Si RU69 tiene también citas en estado 2
-- ese día, el patrón de la muestra queda desmentido en el acto.
SELECT CD_CODI_MED_CIT                                    AS medico,
       SUM(CASE WHEN NU_ESTA_CIT = 1 THEN 1 ELSE 0 END)   AS estado_1,
       SUM(CASE WHEN NU_ESTA_CIT = 2 THEN 1 ELSE 0 END)   AS estado_2,
       SUM(CASE WHEN NU_ESTA_CIT = 0 THEN 1 ELSE 0 END)   AS sin_cerrar
FROM dbo.CITAS_MEDICAS
WHERE FE_FECH_CIT = '20260905'
GROUP BY CD_CODI_MED_CIT
ORDER BY medico;
GO

-- =============================================================================
-- I.16  🆕 EL ESQUEMA `ADMIN` — hallazgo colateral de I.10
--
-- I.10 devolvió `MULTA_TEMP` DOS veces: una en `dbo` y otra en un esquema
-- **`ADMIN`** que no aparece en ninguna parte de la Fase 0. Toda la
-- documentación, todo el mapeo y las nueve consultas del driver asumen `dbo`.
--
-- El agente NO está en riesgo —se verificó que prefija `dbo.` en las nueve
-- referencias, incluido el DELETE— y la prueba de fuego confirmó que la cita
-- que escribimos en `dbo.CITAS_MEDICAS` salió en la pantalla del hospital. O
-- sea: `dbo` es el bueno para citas.
--
-- Pero hay dos cosas que conviene saber antes de producción:
--   · ¿Qué más vive en `ADMIN`? Si hubiera un `ADMIN.CITAS_MEDICAS` con datos,
--     cualquiera que escriba una consulta sin prefijo (una migración, un
--     informe, el siguiente que toque esto) puede acertar en la tabla
--     equivocada sin que nada falle.
--   · ¿Cuál es el `default_schema` del login `agenia_sync`? Si fuera `ADMIN`,
--     una sola consulta sin prefijo bastaría para leer basura en silencio.
--
-- 100 % LECTURA.
-- =============================================================================
USE ESEHSVP;
GO

-- ¿Qué esquemas tienen tablas, y cuántas?
SELECT s.name AS esquema, COUNT(*) AS tablas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
GROUP BY s.name
ORDER BY tablas DESC;

-- Todo lo que vive fuera de `dbo`, con su volumen. Lo que importa es si
-- alguna de las tablas del espejo (CITAS_MEDICAS, TURNOS_MEDICOS, MEDICOS,
-- PACIENTES, SERVICIOS, CITAS_ANULADAS) aparece aquí CON FILAS.
SELECT s.name AS esquema, t.name AS tabla,
       (SELECT SUM(p.rows) FROM sys.partitions p
         WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS filas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name <> 'dbo'
ORDER BY filas DESC, t.name;

-- Y el esquema por defecto del login del agente. Debe decir `dbo`.
SELECT name AS usuario, default_schema_name AS esquema_por_defecto, type_desc
FROM sys.database_principals
WHERE name IN ('agenia_sync', 'dbo', 'ADMIN')
ORDER BY name;
GO

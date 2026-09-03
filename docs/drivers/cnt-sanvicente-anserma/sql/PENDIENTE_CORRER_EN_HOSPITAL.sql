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
--   · Pendiente de correr: G.4 y G.5.
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
--   G.4 🧷 PENDIENTE — la red de seguridad: la especialidad de TODOS los
--      servicios con citas, sin filtrar por turnos. Cierra el hueco que dejó
--      el 31d y sirve para volver a correrla cada vez que se encienda un
--      médico nuevo.
--   G.5 🚨 PENDIENTE — la tabla de convenios COMPLETA (EPS × régimen × tipo
--      de servicio). Es lo que hace falta para poder encender especialistas.
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


-- ── D.7 (opcional) Decodificar los códigos de régimen ───────────────────────
--
-- D.6 encontró que SÍ existe un catálogo: `REGIMEN` y `TIPO_REGIMEN_RESOL4505`.
-- Leerlo confirma la lectura de los códigos (01/02 = subsidiado, 07-12 =
-- contributivo) y de paso explica qué son 'P' (125.403 afiliaciones) y 'F'
-- (78.729), los dos más frecuentes, que no aparecen en las citas de estas dos
-- EPS.
--
-- NO bloquea nada: la tabla de convenios del driver se sostiene por los
-- nombres de los propios convenios. Esto es para dejar de inferir.
SELECT * FROM dbo.REGIMEN;
SELECT * FROM dbo.TIPO_REGIMEN_RESOL4505;

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
-- G.4 🧷 LA RED DE SEGURIDAD — ¿queda algún servicio sin especialidad?
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


-- =============================================================================
-- G.5 🚨 LA TABLA DE CONVENIOS COMPLETA — el bloqueante que destapó G.2
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

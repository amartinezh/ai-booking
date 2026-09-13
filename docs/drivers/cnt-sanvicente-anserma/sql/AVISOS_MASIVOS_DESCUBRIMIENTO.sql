-- =============================================================================
-- SECCIÓN J — ¿SE PUEDE AVISAR POR WHATSAPP A LOS PACIENTES DE UN ESPECIALISTA?
--
-- ✅ CORRIDA CONTRA `ESEHSVP` EL 2026-09-13. Resultado y decisión completos en
-- PLAN_AVISOS_MASIVOS.md §3.4/§3.5 — resumen: 92,0 % de cobertura de celular
-- sobre los pacientes con cita de especialista a futuro (75 pacientes, 69 con
-- celular válido), por encima del umbral del 80 % acordado en §3.2. La Fase 2
-- del plan queda aprobada por datos; solo falta la autorización de habeas data
-- del hospital (§9.1). Hallazgo colateral: solo dos médicos (ES01 Medicina
-- Interna, NU02 Nutrición) tienen hoy masa crítica de citas futuras — el resto
-- de especialidades muestra 0-2, consistente con el patrón de "días
-- especiales" del requisito 4. Este archivo se conserva tal cual para volver a
-- correrlo si la cobertura necesita remedirse más adelante (ej. al encender
-- otra especialidad, o pasado un tiempo).
--
-- Para: docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §3.
--
-- LA PREGUNTA QUE CONTESTA
-- El plan propone que, cuando un especialista no pueda venir, alguien del
-- hospital seleccione a sus pacientes de ese día y les mande un WhatsApp
-- avisando la cancelación. Para mandar un WhatsApp hace falta un celular, y el
-- único sitio donde puede estar es `PACIENTES.DE_TELE_PAC` — una columna
-- `varchar(10)` NULLABLE que NUNCA se ha medido. `CITAS_MEDICAS` no tiene
-- ninguna columna de contacto (comprobado contra `esquema-real.tsv`).
--
-- Sin estos números no se sabe si la función sirve para 9 de cada 10 pacientes
-- o para 2, y esa diferencia cambia el diseño entero (ver el umbral acordado
-- en §3.2 del plan, escrito ANTES de ver el resultado a propósito).
--
--   · TODO ES 100 % LECTURA. Ni un INSERT, ni un UPDATE, ni un DELETE.
--   · Correr en ESEHSVP (el catálogo vivo). PRUEBAS no sirve: la pregunta es
--     sobre la calidad del dato REAL de los pacientes.
--   · En SSMS: clic derecho sobre la cuadrícula → "Copy with Headers" y pegar
--     el resultado completo.
--   · Cada consulta devuelve pocas filas a propósito. NINGUNA devuelve un
--     teléfono ni un nombre: todas son conteos y porcentajes. No hace falta
--     sacar un solo dato personal del hospital para tomar esta decisión.
--
-- CONTENIDO
--   J.0  Los servicios de especialista (de dónde sale la lista)
--   J.1  🚨 LA PREGUNTA GRANDE — cobertura de celular a futuro
--   J.2  Desglose por médico — ¿hay especialistas sin ningún teléfono?
--   J.3  Forma del dato — celular, fijo, o basura
--   J.4  Frescura — ¿el teléfono se actualiza, o es de la apertura de historia?
--   J.5  Respaldo — el teléfono del acompañante
--   J.6  Tamaño de un lote — ¿a cuánta gente se le escribiría de una vez?
-- =============================================================================


-- =============================================================================
-- J.0 — LOS SERVICIOS DE ESPECIALISTA
--
-- No se inventa la lista: son los 18 servicios que `mapping.json → serviciosEvento`
-- ya tiene, derivados por la sección G.6 midiendo qué proporción de las citas de
-- cada servicio fue a un convenio EVEN* (32 servicios cápita, todos por debajo del
-- 0,6 %; 16 de evento, todos por encima del 90 %; sin zona gris).
--
-- Esta consulta solo confirma que siguen vivos y cuánto mueven. Si aparece un
-- servicio de especialista con volumen alto que NO esté en la lista, hay que
-- añadirlo al mapping ANTES de construir nada.
-- =============================================================================

USE ESEHSVP;
GO

SELECT c.CD_CODI_SER_CIT                     AS servicio,
       s.NO_NOMB_SER                         AS nombre_servicio,
       COUNT(*)                              AS citas_90d,
       COUNT(DISTINCT c.CD_CODI_MED_CIT)     AS medicos_distintos,
       SUM(CASE WHEN c.FE_FECH_CIT >= CAST(GETDATE() AS date)
                THEN 1 ELSE 0 END)           AS citas_a_futuro
  FROM dbo.CITAS_MEDICAS c
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
 WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
   AND c.CD_CODI_SER_CIT IN (
         '890242ESP','890242SUR','890342ESP','890342SUR',
         '890250ESP','890250SUR','890350ESP','890350SUR',
         '890266ESP','890266SUR','890366ESP','890366SUR',
         '890283ESP','890383ESP','890284ESP','890384ESP',
         '890206','890306')
 GROUP BY c.CD_CODI_SER_CIT, s.NO_NOMB_SER
 ORDER BY citas_90d DESC;


-- =============================================================================
-- J.1 — 🚨 LA PREGUNTA GRANDE
--
-- De los pacientes que HOY tienen una cita de especialista por delante, ¿a
-- cuántos se les podría escribir?
--
-- "Celular válido" = 10 dígitos que empiezan por 3. Es la numeración móvil
-- colombiana y encaja exacta en el `varchar(10)` de la columna: un fijo de 7-8
-- dígitos, o cualquier cosa con guiones o espacios, NO sirve para WhatsApp.
--
-- El umbral de decisión está acordado en §3.2 del plan:
--   ≥ 80 %  → se construye la fuente espejo (el agente trae la lista)
--   50-80 % → se construye igual, pero la pantalla dice siempre a cuántos NO
--             alcanza, y esos se exportan para llamarlos por teléfono
--   < 50 %  → la hoja electrónica es la única vía
-- =============================================================================
WITH citas_futuras AS (
    SELECT DISTINCT c.NU_HIST_PAC_CIT AS hist
      FROM dbo.CITAS_MEDICAS c
     WHERE c.FE_FECH_CIT >= CAST(GETDATE() AS date)
       AND c.NU_ESTA_CIT = 0                      -- vigentes; 1/2 ya tuvieron desenlace
       AND c.NU_HIST_PAC_CIT IS NOT NULL
       AND c.CD_CODI_SER_CIT IN (
             '890242ESP','890242SUR','890342ESP','890342SUR',
             '890250ESP','890250SUR','890350ESP','890350SUR',
             '890266ESP','890266SUR','890366ESP','890366SUR',
             '890283ESP','890383ESP','890284ESP','890384ESP',
             '890206','890306')
)
SELECT COUNT(*)                                                   AS pacientes_con_cita_futura,
       SUM(CASE WHEN p.NU_HIST_PAC IS NULL THEN 1 ELSE 0 END)     AS sin_ficha_en_PACIENTES,
       SUM(CASE WHEN LTRIM(RTRIM(ISNULL(p.DE_TELE_PAC,''))) = ''
                THEN 1 ELSE 0 END)                                AS sin_telefono,
       SUM(CASE WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
                 AND LEFT(LTRIM(p.DE_TELE_PAC),1) = '3'
                 AND LTRIM(RTRIM(p.DE_TELE_PAC)) NOT LIKE '%[^0-9]%'
                THEN 1 ELSE 0 END)                                AS con_celular_valido,
       CAST(100.0 * SUM(CASE WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
                              AND LEFT(LTRIM(p.DE_TELE_PAC),1) = '3'
                              AND LTRIM(RTRIM(p.DE_TELE_PAC)) NOT LIKE '%[^0-9]%'
                             THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*),0) AS decimal(5,1))                 AS pct_celular_valido
  FROM citas_futuras cf
  LEFT JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = cf.hist;


-- =============================================================================
-- J.2 — DESGLOSE POR MÉDICO
--
-- El promedio de J.1 puede esconder el caso que importa: un especialista
-- concreto cuyos pacientes casi ninguno tiene celular. La función se usa POR
-- MÉDICO —"el dermatólogo no viene el jueves"—, así que la cobertura hay que
-- mirarla por médico, no en global.
--
-- Un médico con cobertura baja aquí es un médico para el que la hoja electrónica
-- es obligatoria, aunque el promedio general dé bien.
-- =============================================================================
SELECT c.CD_CODI_MED_CIT                                          AS medico,
       m.NO_NOMB_MED                                              AS nombre_medico,
       COUNT(*)                                                   AS citas_futuras,
       SUM(CASE WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
                 AND LEFT(LTRIM(p.DE_TELE_PAC),1) = '3'
                 AND LTRIM(RTRIM(p.DE_TELE_PAC)) NOT LIKE '%[^0-9]%'
                THEN 1 ELSE 0 END)                                AS con_celular,
       CAST(100.0 * SUM(CASE WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
                              AND LEFT(LTRIM(p.DE_TELE_PAC),1) = '3'
                              AND LTRIM(RTRIM(p.DE_TELE_PAC)) NOT LIKE '%[^0-9]%'
                             THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*),0) AS decimal(5,1))                 AS pct
  FROM dbo.CITAS_MEDICAS c
  LEFT JOIN dbo.PACIENTES p ON p.NU_HIST_PAC = c.NU_HIST_PAC_CIT
  LEFT JOIN dbo.MEDICOS   m ON m.CD_CODI_MED = c.CD_CODI_MED_CIT
 WHERE c.FE_FECH_CIT >= CAST(GETDATE() AS date)
   AND c.NU_ESTA_CIT = 0
   AND c.CD_CODI_SER_CIT IN (
         '890242ESP','890242SUR','890342ESP','890342SUR',
         '890250ESP','890250SUR','890350ESP','890350SUR',
         '890266ESP','890266SUR','890366ESP','890366SUR',
         '890283ESP','890383ESP','890284ESP','890384ESP',
         '890206','890306')
 GROUP BY c.CD_CODI_MED_CIT, m.NO_NOMB_MED
HAVING COUNT(*) >= 5
 ORDER BY citas_futuras DESC;


-- =============================================================================
-- J.3 — LA FORMA DEL DATO
--
-- Antes de confiar en el porcentaje de J.1 hay que ver de qué está hecha la
-- columna. Un `varchar(10)` acepta cualquier cosa, y la experiencia de este
-- descubrimiento dice que las columnas libres de este HIS acumulan de todo
-- (ver `NO_NOMB_PAC` y sus "HIJO 3 DE YURANI").
--
-- Si aparece mucho 'fijo_7_8' la conclusión NO es "no sirve": es que el hospital
-- registró el teléfono de la casa, que era lo correcto cuando se abrió esa
-- historia. Lo que no se puede es mandarle un WhatsApp.
-- =============================================================================
SELECT CASE
         WHEN p.DE_TELE_PAC IS NULL
              OR LTRIM(RTRIM(p.DE_TELE_PAC)) = ''            THEN '1-vacio'
         WHEN LTRIM(RTRIM(p.DE_TELE_PAC)) LIKE '%[^0-9]%'    THEN '2-con_caracteres_raros'
         WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
              AND LEFT(LTRIM(p.DE_TELE_PAC),1) = '3'         THEN '3-celular_valido'
         WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10          THEN '4-diez_digitos_no_movil'
         WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) IN (7,8)      THEN '5-fijo_7_8'
         ELSE '6-otra_longitud'
       END                                                    AS forma,
       COUNT(*)                                               AS pacientes,
       CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5,1)) AS pct
  FROM dbo.PACIENTES p
 GROUP BY CASE
         WHEN p.DE_TELE_PAC IS NULL
              OR LTRIM(RTRIM(p.DE_TELE_PAC)) = ''            THEN '1-vacio'
         WHEN LTRIM(RTRIM(p.DE_TELE_PAC)) LIKE '%[^0-9]%'    THEN '2-con_caracteres_raros'
         WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
              AND LEFT(LTRIM(p.DE_TELE_PAC),1) = '3'         THEN '3-celular_valido'
         WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10          THEN '4-diez_digitos_no_movil'
         WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) IN (7,8)      THEN '5-fijo_7_8'
         ELSE '6-otra_longitud'
       END
 ORDER BY forma;


-- =============================================================================
-- J.4 — FRESCURA: ¿el teléfono se mantiene, o quedó de cuando se abrió la historia?
--
-- Esta es la pregunta que más duele equivocar, porque un teléfono viejo NO
-- falla: entrega el mensaje a otra persona. Y un mensaje que dice "su cita de
-- dermatología del jueves fue cancelada" entregado a un desconocido es una fuga
-- de dato de salud, no un error de envío.
--
-- `PACIENTES` no tiene fecha de última modificación, así que se mide indirecto:
-- se corta la población por antigüedad de la historia (`FE_HIST_PAC`) y se mira
-- si la cobertura de celular sube en los pacientes recientes.
--
-- CÓMO LEERLO
--   · Cobertura PAREJA entre cortes  → el hospital mantiene el dato al agendar.
--     Buena señal.
--   · Cobertura que CAE en los cortes viejos → el dato se captura una vez, al
--     abrir la historia, y nadie lo vuelve a tocar. Entonces el celular de un
--     paciente de 2015 es de 2015, y la fuente espejo necesita —como mínimo—
--     que la pantalla marque esas filas como "dato antiguo".
-- =============================================================================
SELECT CASE
         WHEN p.FE_HIST_PAC >= DATEADD(year, -1, GETDATE())  THEN 'a-historia < 1 año'
         WHEN p.FE_HIST_PAC >= DATEADD(year, -3, GETDATE())  THEN 'b-1 a 3 años'
         WHEN p.FE_HIST_PAC >= DATEADD(year, -7, GETDATE())  THEN 'c-3 a 7 años'
         ELSE                                                     'd-más de 7 años'
       END                                                    AS antiguedad_historia,
       COUNT(*)                                               AS pacientes,
       CAST(100.0 * SUM(CASE WHEN LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
                              AND LEFT(LTRIM(p.DE_TELE_PAC),1) = '3'
                              AND LTRIM(RTRIM(p.DE_TELE_PAC)) NOT LIKE '%[^0-9]%'
                             THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*),0) AS decimal(5,1))             AS pct_celular
  FROM dbo.PACIENTES p
 WHERE EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS c
                WHERE c.NU_HIST_PAC_CIT = p.NU_HIST_PAC
                  AND c.FE_FECH_CIT >= DATEADD(day, -365, CAST(GETDATE() AS date)))
 GROUP BY CASE
         WHEN p.FE_HIST_PAC >= DATEADD(year, -1, GETDATE())  THEN 'a-historia < 1 año'
         WHEN p.FE_HIST_PAC >= DATEADD(year, -3, GETDATE())  THEN 'b-1 a 3 años'
         WHEN p.FE_HIST_PAC >= DATEADD(year, -7, GETDATE())  THEN 'c-3 a 7 años'
         ELSE                                                     'd-más de 7 años'
       END
 ORDER BY antiguedad_historia;


-- =============================================================================
-- J.5 — EL RESPALDO: teléfono del acompañante
--
-- `DE_TELE_ACOM_PAC` es `varchar(15)` y suele llenarse en pediatría y adulto
-- mayor, justo donde el paciente no tiene celular propio. Si aporta un 10-15 %
-- adicional, vale la pena contemplarlo como segunda opción EXPLÍCITA en la
-- pantalla — nunca en silencio: escribirle al acompañante sin decir que se le
-- está escribiendo al acompañante es otra fuga.
--
-- Solo sobre quienes NO tienen celular propio válido: lo que se mide es cuánto
-- RESCATA, no cuánto existe.
-- =============================================================================
WITH sin_celular AS (
    SELECT p.NU_HIST_PAC, p.DE_TELE_ACOM_PAC
      FROM dbo.PACIENTES p
     WHERE EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS c
                    WHERE c.NU_HIST_PAC_CIT = p.NU_HIST_PAC
                      AND c.FE_FECH_CIT >= CAST(GETDATE() AS date)
                      AND c.NU_ESTA_CIT = 0)
       AND NOT (LEN(LTRIM(RTRIM(p.DE_TELE_PAC))) = 10
                AND LEFT(LTRIM(p.DE_TELE_PAC),1) = '3'
                AND LTRIM(RTRIM(p.DE_TELE_PAC)) NOT LIKE '%[^0-9]%')
)
SELECT COUNT(*)                                                   AS sin_celular_propio,
       SUM(CASE WHEN LEN(LTRIM(RTRIM(DE_TELE_ACOM_PAC))) = 10
                 AND LEFT(LTRIM(DE_TELE_ACOM_PAC),1) = '3'
                 AND LTRIM(RTRIM(DE_TELE_ACOM_PAC)) NOT LIKE '%[^0-9]%'
                THEN 1 ELSE 0 END)                                AS rescatados_por_acompanante,
       CAST(100.0 * SUM(CASE WHEN LEN(LTRIM(RTRIM(DE_TELE_ACOM_PAC))) = 10
                              AND LEFT(LTRIM(DE_TELE_ACOM_PAC),1) = '3'
                              AND LTRIM(RTRIM(DE_TELE_ACOM_PAC)) NOT LIKE '%[^0-9]%'
                             THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*),0) AS decimal(5,1))                 AS pct_rescate
  FROM sin_celular;


-- =============================================================================
-- J.6 — TAMAÑO DE UN LOTE REAL
--
-- Dimensiona la función: si un día de especialista son 12 pacientes, esto es un
-- botón tranquilo. Si son 90, hay que pensar en el ritmo de envío y en el tope
-- por lote (`maxDestinatariosPorLote`), porque Meta castiga la calidad de un
-- número que dispara plantillas en ráfaga.
--
-- Un "día de especialista" = un par (médico, fecha) con citas de esos servicios.
-- =============================================================================
SELECT TOP 20
       c.CD_CODI_MED_CIT                          AS medico,
       CONVERT(varchar(10), c.FE_FECH_CIT, 23)    AS fecha,
       COUNT(*)                                   AS pacientes_ese_dia
  FROM dbo.CITAS_MEDICAS c
 WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
   AND c.CD_CODI_SER_CIT IN (
         '890242ESP','890242SUR','890342ESP','890342SUR',
         '890250ESP','890250SUR','890350ESP','890350SUR',
         '890266ESP','890266SUR','890366ESP','890366SUR',
         '890283ESP','890383ESP','890284ESP','890384ESP',
         '890206','890306')
 GROUP BY c.CD_CODI_MED_CIT, CONVERT(varchar(10), c.FE_FECH_CIT, 23)
 ORDER BY pacientes_ese_dia DESC;

-- Y el percentil práctico: la distribución completa, no solo la cola.
SELECT COUNT(*)                                   AS dias_de_especialista_90d,
       AVG(x.pacientes)                           AS promedio_pacientes_dia,
       MAX(x.pacientes)                           AS maximo_pacientes_dia
  FROM (
    SELECT COUNT(*) AS pacientes
      FROM dbo.CITAS_MEDICAS c
     WHERE c.FE_FECH_CIT >= DATEADD(day, -90, CAST(GETDATE() AS date))
       AND c.CD_CODI_SER_CIT IN (
             '890242ESP','890242SUR','890342ESP','890342SUR',
             '890250ESP','890250SUR','890350ESP','890350SUR',
             '890266ESP','890266SUR','890366ESP','890366SUR',
             '890283ESP','890383ESP','890284ESP','890384ESP',
             '890206','890306')
     GROUP BY c.CD_CODI_MED_CIT, CONVERT(varchar(10), c.FE_FECH_CIT, 23)
  ) x;

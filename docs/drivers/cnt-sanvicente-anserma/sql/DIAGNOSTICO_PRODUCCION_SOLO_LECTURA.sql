/* =============================================================================
   DIAGNÓSTICO DE ALISTAMIENTO PARA PRODUCCIÓN — ESTRICTAMENTE SOLO LECTURA
   Base objetivo: ESEHSVP (el catálogo VIVO del hospital)
   =============================================================================

   ⚠️ ESTE ES EL ÚNICO ARCHIVO DEL PROYECTO QUE APUNTA A LA BASE VIVA.
      Todo lo demás va contra PRUEBAS. Aquí se apunta a ESEHSVP a propósito:
      la pregunta es "¿qué pasaría si abrimos HOY con los datos reales?", y
      PRUEBAS es una copia periódica que no la responde.

   GARANTÍAS DE INOCUIDAD — verificables leyendo el archivo:
     · Solo hay sentencias SELECT. Ni un INSERT, UPDATE, DELETE, MERGE, ALTER,
       CREATE ni DROP. Ni tablas temporales.
     · `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED` en la primera línea:
       las consultas NO toman bloqueos compartidos, así que no pueden frenar ni
       bloquear a nadie que esté trabajando en la aplicación del hospital.
       El precio es una lectura sucia (podría contar una fila a medio escribir):
       irrelevante para un diagnóstico de volúmenes, y es el precio correcto a
       cambio de no tocar a un usuario real.
     · Todas las consultas van acotadas por fecha y dejan la columna de fecha
       SIN envolver en funciones, para que el índice del hospital se pueda usar
       y no haya barridos de la tabla completa (CITAS_MEDICAS supera el millón
       de filas).

   Ejecutar preferiblemente fuera de la hora pico de asignación de citas.
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
GO

-- =============================================================================
-- 0) IDENTIDAD — confirmar contra qué se está ejecutando antes de seguir.
-- =============================================================================
SELECT DB_NAME() AS base_de_datos, @@SERVERNAME AS servidor, GETDATE() AS momento;
GO


-- =============================================================================
-- 1) LA CONSULTA PRINCIPAL — agenda futura real por médico, y cuánto queda libre
--
-- Replica exactamente el cálculo del driver (`fetchAvailability`):
--   · Turnos vigentes = NU_TIPO_TUME 0 e ID_DISP_TUME '1'.
--   · Los cupos salen de dividir el bloque del turno entre 20 minutos
--     (`duracionMinutos` del mapping; no hay excepciones por médico ni por
--     servicio configuradas, así que el 20 aplica a todos).
--   · Ocupado = existe fila en CITAS_MEDICAS para ese médico en la ventana.
--
-- La columna `homologado_agenia` marca los 17 médicos que AgenIA sabe traducir
-- al HIS. Un médico con agenda pero sin homologar es agenda que el bot NO
-- puede vender.
-- =============================================================================
;WITH turnos AS (
    SELECT CD_MED_TUME AS med,
           COUNT(*)    AS bloques,
           MIN(CONVERT(varchar(10), FE_FECH_TUME, 23)) AS primer_dia,
           MAX(CONVERT(varchar(10), FE_FECH_TUME, 23)) AS ultimo_dia,
           -- Solo la parte de HORA: las dos columnas son datetime y su parte de
           -- fecha no tiene por qué coincidir; restarlas enteras daría basura.
           --
           -- La división entre 20 va DENTRO del SUM, no fuera: cada bloque
           -- rinde floor(minutos/20) cupos por separado. Dividir el total
           -- regalaría cupos inexistentes juntando los restos de varios
           -- bloques (tres turnos de 50 minutos son 3 x 2 = 6 cupos, no 7).
           SUM(DATEDIFF(MINUTE,
                        CONVERT(varchar(8), FE_HOIN_TUME, 108),
                        CONVERT(varchar(8), FE_HOFI_TUME, 108)) / 20) AS cupos
      FROM dbo.TURNOS_MEDICOS
     WHERE FE_FECH_TUME >= CONVERT(varchar(8), GETDATE(), 112)
       AND FE_FECH_TUME <  CONVERT(varchar(8), DATEADD(DAY, 90, GETDATE()), 112)
       AND ISNULL(NU_TIPO_TUME, 0) = 0
       AND ISNULL(ID_DISP_TUME, '1') = '1'
     GROUP BY CD_MED_TUME
),
ocupadas AS (
    SELECT CD_CODI_MED_CIT AS med, COUNT(*) AS citas
      FROM dbo.CITAS_MEDICAS
     WHERE FE_FECH_CIT >= CONVERT(varchar(8), GETDATE(), 112)
       AND FE_FECH_CIT <  CONVERT(varchar(8), DATEADD(DAY, 90, GETDATE()), 112)
     GROUP BY CD_CODI_MED_CIT
)
SELECT t.med                                   AS medico_his,
       m.NO_NOMB_MED                           AS nombre,
       CASE WHEN t.med IN ('76','91-1','91-2','ACO2','HO02','HO03','HO04','MD08',
                           'MDD1','MDD2','NU02','OD02','OD05','OD07','PS06',
                           'PS08','R001')
            THEN 'SI' ELSE 'NO' END            AS homologado_agenia,
       t.bloques,
       t.primer_dia,
       t.ultimo_dia,
       t.cupos                                 AS cupos_teoricos,
       ISNULL(o.citas, 0)                      AS ya_ocupados,
       t.cupos - ISNULL(o.citas, 0)            AS cupos_libres
  FROM turnos t
  LEFT JOIN ocupadas o     ON o.med = t.med
  LEFT JOIN dbo.MEDICOS m  ON m.CD_CODI_MED = t.med
 ORDER BY cupos_libres DESC;
GO


-- =============================================================================
-- 2) RESUMEN EJECUTIVO — el número que decide el paso a producción
--
-- Cuántos cupos libres tendría HOY el bot si abriéramos, contando SOLO los
-- médicos que AgenIA sabe homologar, y a 30 / 60 / 90 días.
-- =============================================================================
;WITH homologados AS (
    SELECT med FROM (VALUES
        ('76'),('91-1'),('91-2'),('ACO2'),('HO02'),('HO03'),('HO04'),('MD08'),
        ('MDD1'),('MDD2'),('NU02'),('OD02'),('OD05'),('OD07'),('PS06'),
        ('PS08'),('R001')
    ) v(med)
),
turnos AS (
    -- Agregado por (médico, día) A PROPÓSITO: un médico puede tener dos bloques
    -- el mismo día (mañana y tarde). Sin este GROUP BY, el JOIN contra `citas`
    -- —que ya viene agregado por día— repetiría las citas de ese día una vez
    -- por bloque y los "ocupados" saldrían inflados.
    SELECT CD_MED_TUME AS med,
           CONVERT(varchar(10), FE_FECH_TUME, 23) AS dia,
           SUM(DATEDIFF(MINUTE,
                        CONVERT(varchar(8), FE_HOIN_TUME, 108),
                        CONVERT(varchar(8), FE_HOFI_TUME, 108)) / 20) AS cupos
      FROM dbo.TURNOS_MEDICOS
     WHERE FE_FECH_TUME >= CONVERT(varchar(8), GETDATE(), 112)
       AND FE_FECH_TUME <  CONVERT(varchar(8), DATEADD(DAY, 90, GETDATE()), 112)
       AND ISNULL(NU_TIPO_TUME, 0) = 0
       AND ISNULL(ID_DISP_TUME, '1') = '1'
     GROUP BY CD_MED_TUME, CONVERT(varchar(10), FE_FECH_TUME, 23)
),
citas AS (
    SELECT CD_CODI_MED_CIT AS med,
           CONVERT(varchar(10), FE_FECH_CIT, 23) AS dia,
           COUNT(*) AS n
      FROM dbo.CITAS_MEDICAS
     WHERE FE_FECH_CIT >= CONVERT(varchar(8), GETDATE(), 112)
       AND FE_FECH_CIT <  CONVERT(varchar(8), DATEADD(DAY, 90, GETDATE()), 112)
     GROUP BY CD_CODI_MED_CIT, CONVERT(varchar(10), FE_FECH_CIT, 23)
)
SELECT
    CASE WHEN h.med IS NULL THEN 'SIN homologar (el bot NO puede venderlo)'
         ELSE 'Homologado (vendible por WhatsApp)' END        AS grupo,
    SUM(CASE WHEN t.dia < CONVERT(varchar(10), DATEADD(DAY,30,GETDATE()), 23)
             THEN t.cupos ELSE 0 END)                          AS cupos_30d,
    SUM(CASE WHEN t.dia < CONVERT(varchar(10), DATEADD(DAY,30,GETDATE()), 23)
             THEN ISNULL(c.n,0) ELSE 0 END)                    AS ocupados_30d,
    SUM(t.cupos)                                               AS cupos_90d,
    SUM(ISNULL(c.n, 0))                                        AS ocupados_90d,
    SUM(t.cupos) - SUM(ISNULL(c.n, 0))                         AS libres_90d
  FROM turnos t
  LEFT JOIN citas c       ON c.med = t.med AND c.dia = t.dia
  LEFT JOIN homologados h ON h.med = t.med
 GROUP BY CASE WHEN h.med IS NULL THEN 'SIN homologar (el bot NO puede venderlo)'
               ELSE 'Homologado (vendible por WhatsApp)' END;
GO


-- =============================================================================
-- 3) LOS "CAMINOS" REALES — qué servicio atiende de verdad cada médico
--
-- TURNOS_MEDICOS no lleva el servicio: se deduce de las citas ya atendidas.
-- Esto es lo que permite decir "el camino de odontología tiene N cupos".
-- Mira los 90 días PASADOS (lo ya ocurrido), no la agenda futura.
-- =============================================================================
SELECT c.CD_CODI_MED_CIT      AS medico,
       m.NO_NOMB_MED          AS nombre_medico,
       c.CD_CODI_SER_CIT      AS servicio,
       s.NO_NOMB_SER          AS nombre_servicio,
       COUNT(*)               AS citas_ultimos_90d
  FROM dbo.CITAS_MEDICAS c
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = c.CD_CODI_SER_CIT
  LEFT JOIN dbo.MEDICOS   m ON m.CD_CODI_MED = c.CD_CODI_MED_CIT
 WHERE c.FE_FECH_CIT >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112)
   AND c.FE_FECH_CIT <  CONVERT(varchar(8), GETDATE(), 112)
 GROUP BY c.CD_CODI_MED_CIT, m.NO_NOMB_MED, c.CD_CODI_SER_CIT, s.NO_NOMB_SER
HAVING COUNT(*) >= 5
 ORDER BY citas_ultimos_90d DESC;
GO


-- =============================================================================
-- 4) AGENDA FUTURA POR ESPECIALIDAD — dónde está realmente el inventario
--
-- ⚠️ RESULTADO DEL 2026-09-18: esta consulta NO sirve en este hospital.
--    `CD_CODI_ESP_TUME` viene NULL en los 27 médicos con agenda futura: la
--    columna no se alimenta. Devuelve una sola fila con el total (8.667 cupos).
--    La especialidad hay que deducirla de las citas ya prestadas — que es lo
--    que hace la consulta 3 y lo que ya hace el driver. Se conserva aquí como
--    evidencia de que esa vía está cerrada.
--
--    (El `ISNULL` va envuelto en CAST a propósito: `CD_CODI_ESP_TUME` es
--     varchar(3), así que sin el CAST el literal de reemplazo se truncaba a
--     '(si' y el resultado era ilegible.)
-- =============================================================================
;WITH turnos AS (
    SELECT ISNULL(CAST(CD_CODI_ESP_TUME AS varchar(20)), '(sin especialidad)') AS esp,
           COUNT(DISTINCT CD_MED_TUME) AS medicos,
           SUM(DATEDIFF(MINUTE,
                        CONVERT(varchar(8), FE_HOIN_TUME, 108),
                        CONVERT(varchar(8), FE_HOFI_TUME, 108)) / 20) AS cupos_90d
      FROM dbo.TURNOS_MEDICOS
     WHERE FE_FECH_TUME >= CONVERT(varchar(8), GETDATE(), 112)
       AND FE_FECH_TUME <  CONVERT(varchar(8), DATEADD(DAY, 90, GETDATE()), 112)
       AND ISNULL(NU_TIPO_TUME, 0) = 0
       AND ISNULL(ID_DISP_TUME, '1') = '1'
     GROUP BY ISNULL(CAST(CD_CODI_ESP_TUME AS varchar(20)), '(sin especialidad)')
)
SELECT t.esp AS especialidad, e.NO_NOMB_ESP AS nombre, t.medicos, t.cupos_90d
  FROM turnos t
  LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = t.esp
 ORDER BY t.cupos_90d DESC;
GO


-- =============================================================================
-- 5) DEMANDA REAL POR CONVENIO — valida el mapeo de EPS y dimensiona el volumen
--
-- Esperado según el correo del hospital del 2026-09-04:
--   467 Sura subsidiado · 473 Sura contributivo · 535 Sura evento
--   475 Salud Total subsidiado · 476 contributivo · 538 evento
--   283 / 489 Nueva EPS subsidiado · 26 Particular
-- =============================================================================
SELECT TOP 25
       NU_NUME_CONV_CIT AS convenio,
       COUNT(*)         AS citas_ultimos_90d
  FROM dbo.CITAS_MEDICAS
 WHERE FE_FECH_CIT >= CONVERT(varchar(8), DATEADD(DAY, -90, GETDATE()), 112)
   AND FE_FECH_CIT <  CONVERT(varchar(8), GETDATE(), 112)
 GROUP BY NU_NUME_CONV_CIT
 ORDER BY citas_ultimos_90d DESC;
GO


-- =============================================================================
-- 6) CARGA DE CANCELACIONES QUE RECIBIRÍA EL BOT
--
-- Dimensiona el otro lado del flujo: cuántas cancelaciones mueve el hospital.
-- Se mide por la fecha de la CITA (FE_FECH_CIAN), no por la de anulación:
-- CITAS_ANULADAS no guarda cuándo se anuló (ver bloque C del SQL de
-- certificación).
-- =============================================================================
SELECT
    (SELECT COUNT(*) FROM dbo.CITAS_MEDICAS
      WHERE FE_FECH_CIT  >= CONVERT(varchar(8), DATEADD(DAY,-90,GETDATE()), 112)
        AND FE_FECH_CIT  <  CONVERT(varchar(8), GETDATE(), 112))            AS citas_90d,
    (SELECT COUNT(*) FROM dbo.CITAS_ANULADAS
      WHERE FE_FECH_CIAN >= CONVERT(varchar(8), DATEADD(DAY,-90,GETDATE()), 112)
        AND FE_FECH_CIAN <  CONVERT(varchar(8), GETDATE(), 112))            AS anuladas_90d;
GO

-- Desglose por motivo de anulación, para ver si 'WB' (Cancelado Web) ya se usa.
SELECT a.CD_CODI_MOTI_CIAN AS motivo,
       mo.DE_DESC_MOTI     AS descripcion,
       COUNT(*)            AS n
  FROM dbo.CITAS_ANULADAS a
  LEFT JOIN dbo.MOTIVOANUL mo ON mo.CD_CODI_MOTI = a.CD_CODI_MOTI_CIAN
 WHERE a.FE_FECH_CIAN >= CONVERT(varchar(8), DATEADD(DAY,-90,GETDATE()), 112)
   AND a.FE_FECH_CIAN <  CONVERT(varchar(8), GETDATE(), 112)
 GROUP BY a.CD_CODI_MOTI_CIAN, mo.DE_DESC_MOTI
 ORDER BY n DESC;
GO

-- =============================================================================
-- CERTIFICACIÓN — validación en el HIS de lo que llegó desde WhatsApp
--
-- Acompaña a PLAN_CERTIFICACION_PRUEBAS.md. TODO ES SOLO LECTURA salvo donde
-- se marca explícitamente lo contrario (no hay ningún UPDATE/DELETE aquí).
--
--   · Correr SIEMPRE contra PRUEBAS. La sección 0.1 es obligatoria y va
--     primero en cada sesión — no se salta ni la segunda vez.
--   · En SSMS: clic derecho → "Copy with Headers" y pegar en la bitácora de
--     evidencia (docs/drivers/cnt-sanvicente-anserma/evidencia/).
--   · Reemplazar los marcadores <...> antes de correr cada bloque.
-- =============================================================================

-- =============================================================================
-- 0.1 🚨 OBLIGATORIO — confirmar base antes de CUALQUIER otra cosa
-- =============================================================================
SELECT DB_NAME() AS base_actual;
-- Debe decir PRUEBAS.
-- Si dice ESEHSVP: DETENERSE. No correr ni una línea más de este archivo.
GO


-- =============================================================================
-- 0.2 Selección de médico(s) para certificar (Fase 0 del plan, §1.1)
--
-- Adaptado de PENDIENTE_CORRER_EN_HOSPITAL.sql sección E — mismo criterio de
-- semáforo, corrido aquí contra PRUEBAS en vez de ESEHSVP. Copiar el/los
-- 🟢 VERDE con turnos futuros a PLAN_CERTIFICACION_PRUEBAS.md §1.1.
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
            SUM(1 - es_pyp)              AS citas_normales,
            COUNT(*)                     AS citas
    FROM citas
    GROUP BY medico
)
SELECT  a.medico,
        m.NO_NOMB_MED AS nombre,
        (SELECT COUNT(*) FROM dbo.TURNOS_MEDICOS t2
          WHERE t2.CD_MED_TUME = a.medico AND t2.FE_FECH_TUME >= CAST(GETDATE() AS date)) AS turnos_futuros,
        a.servicios, a.especialidades, a.citas_pyp, a.citas_normales, a.citas,
        CASE
          WHEN a.servicios = 1 THEN 'VERDE'
          WHEN a.especialidades = 1 AND (a.citas_pyp = 0 OR a.citas_normales = 0) THEN 'AMARILLO'
          ELSE 'ROJO'
        END AS semaforo
FROM actividad a
LEFT JOIN dbo.MEDICOS m ON m.CD_CODI_MED = a.medico
ORDER BY semaforo, turnos_futuros DESC;
GO


-- =============================================================================
-- BLOQUE A — Agendamiento feliz
--
-- Reemplazar <cedulas> por las de la sesión (informe de padrones §3.1-3.4) y
-- <inicio-sesion>/<fin-sesion> por la ventana horaria en la que se corrió el
-- bloque. La búsqueda es por NU_HIST_PAC_CIT (= cédula, confirmado en
-- MAPEO_HIS.md §3.3: la historia clínica de este hospital ES el documento).
-- =============================================================================
SELECT
    CD_CODI_MED_CIT   AS medico,
    FE_HORA_CIT       AS hora_cita,
    NU_HIST_PAC_CIT   AS cedula,
    NU_ESTA_CIT       AS estado,       -- debe ser 0 (asignada) para un alta reciente
    NU_NUME_CONV_CIT  AS convenio,
    CD_CODI_SER_CIT   AS servicio,
    FE_ELAB_CIT       AS elaborada_el, -- debe caer dentro de la ventana de la sesión
    DE_DESC_CIT       AS origen
FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT IN (<cedulas-del-bloque-A>)
  AND FE_ELAB_CIT >= '<inicio-sesion>' AND FE_ELAB_CIT < '<fin-sesion>'
ORDER BY FE_ELAB_CIT;
GO

-- Cruce con el catálogo de convenios, para confirmar que el que se escribió
-- es el que le corresponde a esa EPS+régimen (tabla de PENDIENTE_CORRER_EN_HOSPITAL.sql D.2).
SELECT c.NU_HIST_PAC_CIT AS cedula, c.NU_NUME_CONV_CIT AS convenio,
       cv.CD_CODI_CONV AS nombre_convenio
FROM dbo.CITAS_MEDICAS c
LEFT JOIN dbo.CONVENIOS cv ON cv.NU_NUME_CONV = c.NU_NUME_CONV_CIT
WHERE c.NU_HIST_PAC_CIT IN (<cedulas-del-bloque-A>)
  AND c.FE_ELAB_CIT >= '<inicio-sesion>' AND c.FE_ELAB_CIT < '<fin-sesion>';
GO

-- Pacientes NUEVOS (casos A4/A5): confirmar alta en PACIENTES con sexo correcto.
-- NU_SEXO_PAC: 1 = Masculino, 0 = Femenino (confirmado ESTADO.md 2026-09-01).
SELECT NU_HIST_PAC AS cedula, NO_NOMB_PAC AS nombre, NU_SEXO_PAC AS sexo, FE_NACI_PAC AS nacimiento
FROM dbo.PACIENTES
WHERE NU_HIST_PAC IN ('<cedula-A4-masculino>', '<cedula-A5-femenino>');
GO


-- =============================================================================
-- BLOQUE B — Padrón: NADA debe llegar al HIS para las cédulas NO enroladas
--
-- Este es un chequeo de AUSENCIA: la consulta debe devolver CERO filas.
-- Si devuelve alguna, el gate de padrón falló silenciosamente — es el
-- hallazgo más grave que puede salir de esta campaña.
-- =============================================================================
SELECT * FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT IN ('900000001', '900000002')
  AND FE_ELAB_CIT >= '<inicio-sesion>' AND FE_ELAB_CIT < '<fin-sesion>';
-- Esperado: 0 filas.
GO


-- =============================================================================
-- BLOQUE C — Cancelación
--
-- CITAS_ANULADAS no tiene PK ni índice único (ESTADO.md): se correlaciona por
-- (médico, hora, historia). Para la certificación ya conocemos la cédula y la
-- hora de la cita, así que esa pareja identifica la fila sin ambigüedad.
--
-- 🚨 NO FILTRAR POR FE_ELAB_CIAN COMO SI FUERA "CUÁNDO SE CANCELÓ".
-- No lo es. `copiarAAnuladas` (driver, index.ts) copia FE_ELAB_CIAN desde
-- FE_ELAB_CIT, y FE_ELAB_CIT se escribe con GETDATE() en el ALTA de la cita:
-- es la fecha en que la cita se CREÓ, y sobrevive intacta a la anulación.
-- CITAS_ANULADAS no guarda en ninguna columna el instante de la cancelación
-- — el propio driver lo documenta al explicar por qué detecta cambios por
-- instantánea diferencial y no por cursor de fechas.
--
-- Una ventana "las últimas N horas" sobre FE_ELAB_CIAN por tanto pregunta
-- "¿qué citas CREADAS en las últimas N horas fueron anuladas?", no "¿qué se
-- anuló en las últimas N horas?". En la certificación del 2026-09-18 eso
-- devolvió 0 filas para 9 cancelaciones perfectamente aplicadas: las citas se
-- habían creado la noche anterior, fuera de la ventana. Se perdió medio día
-- persiguiendo un fallo que no existía.
-- =============================================================================
-- 1) La cita YA NO debe estar viva en CITAS_MEDICAS
SELECT * FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT IN (<cedulas-del-bloque-C>)
  AND FE_HORA_CIT = '<hora-de-la-cita-cancelada>';
-- Esperado: 0 filas (la cancelación es un DELETE, no un cambio de estado).
GO

-- 2) Debe existir su archivo en CITAS_ANULADAS, motivo WB (Cancelado Web —
--    confirmado en ESTADO.md que es el motivo que escribe nuestro driver).
SELECT
    CD_CODI_MED_CIAN  AS medico,
    FE_HORA_CIAN      AS hora_cita,
    NU_HIST_PAC_CIAN  AS cedula,
    CD_CODI_MOTI_CIAN AS motivo,       -- debe ser 'WB'
    TX_OBSE_CIAN      AS observaciones,
    FE_ELAB_CIAN      AS creada_el     -- ojo: fecha de CREACIÓN, no de anulación
FROM dbo.CITAS_ANULADAS
WHERE NU_HIST_PAC_CIAN IN (<cedulas-del-bloque-C>)
ORDER BY FE_HORA_CIAN;
-- Esperado: una fila por cada cancelación del bloque C, con motivo 'WB'.
-- Si hiciera falta acotar, acótese por la HORA DE LA CITA (FE_HORA_CIAN), que
-- sí es un dato conocido y estable, nunca por FE_ELAB_CIAN.
GO

-- Caso C4 (varias citas, cancelar solo una): confirmar que las OTRAS citas del
-- mismo paciente siguen vivas.
SELECT * FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT = '<cedula-C4>' AND NU_ESTA_CIT = 0;
-- Esperado: las citas NO canceladas de ese paciente, ninguna de más ni de menos.
GO


-- =============================================================================
-- BLOQUE D — Reprogramación
--
-- El caso crítico es D3: si el alta del cupo nuevo falla, la cita ORIGINAL
-- debe seguir viva (ESTADO.md, "Reagendar ya no puede dejar al paciente sin
-- ninguna cita"). Verificar que hay EXACTAMENTE una fila viva por paciente,
-- nunca cero.
-- =============================================================================
SELECT NU_HIST_PAC_CIT AS cedula, COUNT(*) AS citas_vivas
FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT IN (<cedulas-del-bloque-D>) AND NU_ESTA_CIT = 0
GROUP BY NU_HIST_PAC_CIT;
-- Esperado: 1 por cada cédula (nunca 0). Si D3 se ejecutó (alta forzada a
-- fallar), la fila que aparece debe ser la ORIGINAL (hora vieja), no la nueva.
GO


-- =============================================================================
-- BLOQUE F — Guardarraíles: CERO escritura, sin excepción
--
-- Buscar por la ventana horaria exacta de cada mensaje de este bloque (no hay
-- cédula fija — algunos de estos turnos ni siquiera llegan a pedirla). Si
-- CUALQUIERA de estas consultas devuelve una fila, es un guardarraíl roto.
-- =============================================================================
SELECT * FROM dbo.CITAS_MEDICAS
WHERE FE_ELAB_CIT >= '<hora-mensaje-F1>' AND FE_ELAB_CIT < '<hora-mensaje-F1 + 2 min>';
-- Repetir para F2, F3, F4 con sus propias ventanas. Esperado siempre: 0 filas.
GO


-- =============================================================================
-- BLOQUE G — Concurrencia (dos "SÍ" al mismo cupo)
--
-- La PK real es (CD_CODI_MED_CIT, FE_HORA_CIT, NU_ESTA_CIT) — confirmado en
-- la 2ª ronda de descubrimiento. Si el índice único de AgenIA hizo su trabajo,
-- el HIS solo debe recibir UNA escritura para ese médico+hora.
-- =============================================================================
SELECT CD_CODI_MED_CIT, FE_HORA_CIT, NU_HIST_PAC_CIT, COUNT(*) OVER () AS filas_totales
FROM dbo.CITAS_MEDICAS
WHERE CD_CODI_MED_CIT = '<medico-cupo-disputado>' AND FE_HORA_CIT = '<hora-cupo-disputado>';
-- Esperado: exactamente 1 fila.
GO


-- =============================================================================
-- RESUMEN — cuenta total de la sesión, para pegar en el checklist §7 del plan
-- =============================================================================
SELECT
    (SELECT COUNT(*) FROM dbo.CITAS_MEDICAS
      WHERE FE_ELAB_CIT >= '<inicio-sesion>' AND FE_ELAB_CIT < '<fin-sesion>')  AS citas_creadas,
    -- Las anuladas NO se pueden contar por ventana temporal (ver bloque C):
    -- se cuentan por la marca de origen que el driver dejó en la cita, que sí
    -- viaja a CITAS_ANULADAS en DE_DESC_CIAN.
    (SELECT COUNT(*) FROM dbo.CITAS_ANULADAS
      WHERE CD_CODI_MOTI_CIAN = 'WB'
        AND DE_DESC_CIAN LIKE '%<marca-origen-del-mapping>%')                    AS citas_canceladas;
GO

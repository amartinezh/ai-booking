/* =============================================================================
   ¿QUIÉN MANTIENE CITAS_DISPONIBLES? — ESTRICTAMENTE SOLO LECTURA
   Base objetivo: ESEHSVP
   =============================================================================

   Decisión H6 de docs/PLAN_AGENDA_HUECOS.md. AgenIA NO va a tocar
   `CITAS_DISPONIBLES` (decisión del 2026-10-06): cuando el bot agende, el agente
   solo escribe la cita en `CITAS_MEDICAS` (+ su auditoría). La pregunta es si el
   HIS recalcula los huecos SOLO al aparecer esa cita:

     · Si hay un TRIGGER sobre CITAS_MEDICAS que mantiene CITAS_DISPONIBLES →
       el hueco se cierra solo, venga la cita de donde venga. Riesgo resuelto.
     · Si lo hace la APLICACIÓN del hospital (o un procedimiento que solo ella
       llama) → una cita escrita por el agente deja el hueco "libre" en la
       pantalla de ventanilla, y se puede agendar encima 5 o 10 min después.

   Esta consulta solo lee el CATÁLOGO del esquema (definiciones de triggers y
   procedimientos). No lee datos de pacientes ni escribe nada. Para ver las
   definiciones hace falta el permiso VIEW DEFINITION (lo tiene un usuario
   administrador en SSMS).
   ============================================================================= */

USE ESEHSVP;
GO
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
GO

-- =============================================================================
-- 1) Triggers sobre las tablas de agenda: ¿existen? ¿están activos? ¿qué hacen?
--    Lo importante: un trigger de CITAS_MEDICAS cuya definición mencione
--    CITAS_DISPONIBLES.
-- =============================================================================
SELECT OBJECT_NAME(t.parent_id) AS tabla,
       t.name                   AS trigger_nombre,
       t.is_disabled            AS desactivado,
       CASE WHEN m.definition LIKE '%CITAS_DISPONIBLES%' THEN 'SI' ELSE 'no' END
                                AS toca_citas_disponibles,
       LEFT(m.definition, 3000) AS definicion_inicio
  FROM sys.triggers t
  LEFT JOIN sys.sql_modules m ON m.object_id = t.object_id
 WHERE t.parent_id IN (OBJECT_ID('dbo.CITAS_MEDICAS'),
                       OBJECT_ID('dbo.CITAS_DISPONIBLES'),
                       OBJECT_ID('dbo.TURNOS_MEDICOS'),
                       OBJECT_ID('dbo.CITAS_ANULADAS'))
 ORDER BY tabla, trigger_nombre;
GO

-- =============================================================================
-- 2) Todo objeto programable (procedimiento, función, vista, trigger) que
--    ESCRIBE o LEE CITAS_DISPONIBLES. Si aparece un procedimiento tipo
--    "asignar cita" que inserta en CITAS_MEDICAS y recalcula los huecos, ese es
--    el camino "como la ventanilla".
-- =============================================================================
SELECT o.type_desc AS tipo,
       SCHEMA_NAME(o.schema_id) + '.' + o.name AS objeto,
       CASE WHEN m.definition LIKE '%INSERT%CITAS_DISPONIBLES%'
              OR m.definition LIKE '%DELETE%CITAS_DISPONIBLES%'
              OR m.definition LIKE '%UPDATE%CITAS_DISPONIBLES%' THEN 'escribe'
            ELSE 'lee' END AS uso_aparente,
       CASE WHEN m.definition LIKE '%CITAS_MEDICAS%' THEN 'SI' ELSE 'no' END
                                AS tambien_toca_citas_medicas,
       o.modify_date AS ultima_modificacion
  FROM sys.sql_modules m
  JOIN sys.objects o ON o.object_id = m.object_id
 WHERE m.definition LIKE '%CITAS_DISPONIBLES%'
 ORDER BY uso_aparente DESC, tipo, objeto;
GO

-- =============================================================================
-- 3) Dependencias declaradas (complementa al bloque 2: atrapa referencias que
--    el LIKE no ve, p. ej. con corchetes o alias).
-- =============================================================================
SELECT OBJECT_SCHEMA_NAME(d.referencing_id) + '.' + OBJECT_NAME(d.referencing_id) AS objeto,
       o.type_desc AS tipo
  FROM sys.sql_expression_dependencies d
  JOIN sys.objects o ON o.object_id = d.referencing_id
 WHERE d.referenced_id = OBJECT_ID('dbo.CITAS_DISPONIBLES')
 ORDER BY objeto;
GO

-- =============================================================================
-- 4) ¿Quién más inserta en CITAS_MEDICAS? (procedimientos/triggers) — para
--    saber si la "segunda aplicación" que ESTADO.md registró escribe por un
--    camino que no recalcula los huecos (explicaría OD05 el 2026-10-06).
-- =============================================================================
SELECT o.type_desc AS tipo,
       SCHEMA_NAME(o.schema_id) + '.' + o.name AS objeto,
       CASE WHEN m.definition LIKE '%CITAS_DISPONIBLES%' THEN 'SI' ELSE 'no' END
                                AS recalcula_huecos,
       o.modify_date AS ultima_modificacion
  FROM sys.sql_modules m
  JOIN sys.objects o ON o.object_id = m.object_id
 WHERE m.definition LIKE '%INSERT%INTO%CITAS_MEDICAS%'
 ORDER BY recalcula_huecos, tipo, objeto;
GO

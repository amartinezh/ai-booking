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
   ANOTE AQUÍ (PARTE B)
   ---------------------------------------------------------------------------
   Lecturas lógicas de PACIENTES : ______
   Tiempo de CPU / transcurrido  : ______ ms / ______ ms
   ¿Acceso por índice (seek)?    : ______   (mire el plan de ejecución)

   Criterio: si son lecturas por clave primaria y el tiempo es de milisegundos,
   la Fase 1 pasa. Si fuera un recorrido de la tabla, NO desplegar el alta en
   caliente y pasar a pedir los datos a demanda (opción D1-b del plan).
   ============================================================================= */

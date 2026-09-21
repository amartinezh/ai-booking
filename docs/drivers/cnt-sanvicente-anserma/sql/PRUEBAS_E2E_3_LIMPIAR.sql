/* =============================================================================
   PRUEBAS E2E — 3. LIMPIAR EL HIS
   Base objetivo: PRUEBAS.   ⚠️ BORRA (solo datos de los documentos sintéticos).
   =============================================================================

   Deja PRUEBAS como estaba antes de PRUEBAS_E2E_1_PREPARAR.sql. Borra, SOLO para
   los documentos sintéticos (9990000001 … 9990000020 y 09990000008):
     · sus citas en CITAS_MEDICAS — las que se prepararon Y las que AgenIA escribió
       al reservar por WhatsApp durante la prueba;
     · sus copias en CITAS_ANULADAS;
     · sus filas en PACIENTES (incluida la que el driver creó para el escenario 12).

   NO toca la auditoría del hospital (AUDITOR): es una bitácora que solo crece.
   Las altas que hizo AgenIA quedan registradas ahí como «AGENIA», y está bien.

   🚨 ORDEN IMPORTANTE. Antes de correr esto, CANCELAR EN AGENIA (desde el panel)
   las citas de prueba que sigan vigentes allá. Si se borran aquí primero, AgenIA
   las sigue teniendo y la próxima reconciliación las reporta como «el hospital NO
   las tiene»: abriría excepciones en la bandeja y avisaría al agendador por algo
   que no pasó. La vista previa de abajo lista las que AgenIA aún tiene vigentes.

   Con @CONFIRMO = 0 (por defecto) solo muestra lo que borraría.
   ============================================================================= */

USE PRUEBAS;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

DECLARE @CONFIRMO bit = 0;    -- 1 = sí, borrar

IF DB_NAME() <> 'PRUEBAS'
    THROW 50000, 'Este guion borra en PRUEBAS y solo en PRUEBAS. Corrija el USE.', 1;

DECLARE @docs TABLE (doc varchar(20) PRIMARY KEY);
INSERT @docs (doc)
SELECT '99900000' + RIGHT('0' + CAST(n AS varchar(2)), 2)
FROM (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),
             (11),(12),(13),(14),(15),(16),(17),(18),(19),(20)) v(n)
UNION ALL SELECT '09990000008';

-- ── Vista previa ────────────────────────────────────────────────────────────
PRINT '=== Lo que se borraría ===';
SELECT tabla = 'CITAS_MEDICAS',  filas = COUNT(*) FROM dbo.CITAS_MEDICAS  WHERE NU_HIST_PAC_CIT  IN (SELECT doc FROM @docs)
UNION ALL
SELECT 'CITAS_ANULADAS',         COUNT(*)         FROM dbo.CITAS_ANULADAS WHERE NU_HIST_PAC_CIAN IN (SELECT doc FROM @docs)
UNION ALL
SELECT 'PACIENTES',              COUNT(*)         FROM dbo.PACIENTES      WHERE NU_HIST_PAC      IN (SELECT doc FROM @docs);

-- Las que AgenIA escribió y siguen vigentes y a futuro: cancelarlas ANTES en AgenIA.
IF EXISTS (SELECT 1 FROM dbo.CITAS_MEDICAS
           WHERE NU_HIST_PAC_CIT IN (SELECT doc FROM @docs)
             AND DE_DESC_CIT = 'ASIGNADA POR WHATSAPP'
             AND NU_ESTA_CIT = 0 AND FE_FECH_CIT >= CAST(GETDATE() AS date))
BEGIN
    PRINT '';
    PRINT '   ATENCION: estas citas las escribió AgenIA y siguen vigentes. Cancélelas primero';
    PRINT '   desde el panel de AgenIA; si se borran solo aquí, la reconciliación las reportará';
    PRINT '   como una deriva y la bandeja avisará al agendador.';
    SELECT documento = NU_HIST_PAC_CIT, medico = CD_CODI_MED_CIT, hora = FE_HORA_CIT
    FROM dbo.CITAS_MEDICAS
    WHERE NU_HIST_PAC_CIT IN (SELECT doc FROM @docs)
      AND DE_DESC_CIT = 'ASIGNADA POR WHATSAPP'
      AND NU_ESTA_CIT = 0 AND FE_FECH_CIT >= CAST(GETDATE() AS date)
    ORDER BY FE_FECH_CIT, FE_HORA_CIT;
END;

IF @CONFIRMO <> 1
BEGIN
    PRINT '';
    PRINT '   Nada borrado (@CONFIRMO = 0). Para borrar, ponga @CONFIRMO = 1 y vuelva a correr.';
    RETURN;
END;

-- ── Borrado, en una transacción ─────────────────────────────────────────────
BEGIN TRANSACTION;

DELETE FROM dbo.CITAS_MEDICAS  WHERE NU_HIST_PAC_CIT  IN (SELECT doc FROM @docs);
DECLARE @citas int = @@ROWCOUNT;

DELETE FROM dbo.CITAS_ANULADAS WHERE NU_HIST_PAC_CIAN IN (SELECT doc FROM @docs);
DECLARE @anuladas int = @@ROWCOUNT;

-- Al final: el HIS no deja borrar un paciente que todavía tiene citas.
DELETE FROM dbo.PACIENTES      WHERE NU_HIST_PAC      IN (SELECT doc FROM @docs);
DECLARE @pacientes int = @@ROWCOUNT;

COMMIT TRANSACTION;

PRINT '';
PRINT '   LIMPIO: ' + CAST(@citas AS varchar(6)) + ' citas, '
    + CAST(@anuladas AS varchar(6)) + ' anulaciones y '
    + CAST(@pacientes AS varchar(6)) + ' pacientes de prueba borrados.';

-- Comprobación final: no debe quedar nada.
SELECT quedan_citas     = (SELECT COUNT(*) FROM dbo.CITAS_MEDICAS  WHERE NU_HIST_PAC_CIT  IN (SELECT doc FROM @docs)),
       quedan_anuladas  = (SELECT COUNT(*) FROM dbo.CITAS_ANULADAS WHERE NU_HIST_PAC_CIAN IN (SELECT doc FROM @docs)),
       quedan_pacientes = (SELECT COUNT(*) FROM dbo.PACIENTES      WHERE NU_HIST_PAC      IN (SELECT doc FROM @docs));
GO

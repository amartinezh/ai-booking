/* =============================================================================
   PRUEBA H6 — PARTE B: VER CÓMO QUEDÓ Y LIMPIAR — SOLO EN PRUEBAS
   =============================================================================

   Correr COMPLETO (F5) DESPUÉS de revisar la aplicación del HIS (parte A).

     1. Muestra los huecos (CITAS_DISPONIBLES) y las citas (CITAS_MEDICAS) de
        MDD2 ese día: así se ve si la aplicación recalculó los huecos al abrir
        la pantalla o al asignar, y qué cita quedó a qué hora.
     2. Borra la cita "del agente" (por su marca).
     3. Las citas que se hayan asignado desde la ventanilla a 9990000091 NO se
        borran aquí: anularlas DESDE LA APLICACIÓN (así se prueba también su
        camino normal). Este script dice si quedó alguna.
     4. Borra los dos pacientes sintéticos, solo si ya no tienen citas.

   Enviar a AgenIA el resultado 1 y las respuestas a, b, c y d de la parte A.
   ============================================================================= */

USE PRUEBAS;
GO
IF DB_NAME() <> 'PRUEBAS'
BEGIN
    RAISERROR('No es PRUEBAS: no se hace nada.', 16, 1);
    SET NOEXEC ON;
END
GO

SET NOCOUNT ON;
DECLARE @fecha datetime = (SELECT TOP 1 FE_FECH_CIT FROM dbo.CITAS_MEDICAS
                            WHERE DE_DESC_CIT = 'PRUEBA H6 AGENIA - BORRAR');

-- 1) Cómo quedó el día de MDD2 (huecos y citas, en orden).
SELECT 'LIBRE' AS que,
       CONVERT(varchar(5), FE_HOIN_CIDI, 108) AS desde,
       CONVERT(varchar(5), FE_HOFI_CIDI, 108) AS hasta,
       NU_DURA_CIDI AS minutos, NULL AS paciente, NULL AS descripcion
  FROM dbo.CITAS_DISPONIBLES
 WHERE CD_MED_CIDI = 'MDD2' AND FE_FECH_CIDI = @fecha
UNION ALL
SELECT 'CITA', RIGHT(FE_HORA_CIT, 5), NULL, NU_DURA_CIT,
       CASE WHEN NU_HIST_PAC_CIT LIKE '99900000%' THEN NU_HIST_PAC_CIT ELSE '(otro paciente)' END,
       LEFT(DE_DESC_CIT, 40)
  FROM dbo.CITAS_MEDICAS
 WHERE CD_CODI_MED_CIT = 'MDD2' AND FE_FECH_CIT = @fecha
 ORDER BY desde, que;

-- 2) Borrar la cita "del agente".
DELETE FROM dbo.CITAS_MEDICAS
 WHERE DE_DESC_CIT = 'PRUEBA H6 AGENIA - BORRAR' AND CD_CODI_MED_CIT = 'MDD2';
DECLARE @borradas int = @@ROWCOUNT;

-- 3) ¿Quedó alguna cita de la ventanilla a los pacientes sintéticos?
DECLARE @pendientes int = (SELECT COUNT(*) FROM dbo.CITAS_MEDICAS
                            WHERE NU_HIST_PAC_CIT IN ('9990000090', '9990000091'));

-- 4) Pacientes sintéticos: solo si ya no tienen citas.
DECLARE @pacientes int = 0;
IF @pendientes = 0
BEGIN
    BEGIN TRY
        DELETE FROM dbo.PACIENTES WHERE NU_HIST_PAC IN ('9990000090', '9990000091');
        SET @pacientes = @@ROWCOUNT;
    END TRY
    BEGIN CATCH
        -- Si la aplicación guardó la anulación en CITAS_ANULADAS, el HIS puede no
        -- dejar borrar al paciente. No afecta: son documentos sintéticos.
        SET @pacientes = -1;
    END CATCH
END

SELECT @borradas AS cita_del_agente_borrada,
       @pendientes AS citas_de_ventanilla_por_anular_desde_la_app,
       CASE @pacientes WHEN -1 THEN 'no se pudieron borrar (tienen historia de anulación; no afecta)'
                       ELSE CAST(@pacientes AS varchar(10)) END AS pacientes_sinteticos_borrados,
       CASE WHEN @pendientes > 0
            THEN 'Anular desde la aplicación las citas de 9990000090/91 y volver a correr esta parte B.'
            ELSE 'Limpio.' END AS estado;
GO
SET NOEXEC OFF;
GO

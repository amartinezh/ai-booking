/* =============================================================================
   HISTORIA CLÍNICA → ¿EL DOCUMENTO DE AGENIA DICE LO MISMO QUE EL PAPEL?
   SOLO LECTURA · Base: PRUEBAS (en cualquier otra base se detiene sin leer nada)
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md §3.9. Mapeo: MAPEO_HIS.md §2.9.
   Es independiente: no necesita el script grande de PRUEBAS.

   Las rondas 5 y 6 ya resolvieron casi todo leyendo ESEHSVP. Quedan cuatro
   cosas que solo se ven poniendo el papel impreso al lado de la base:
     Q-2  qué número sale en «Orden Nº» de la fórmula y de la orden de exámenes;
     Q-3  qué significa cada código de prioridad de la remisión (0, 1, 2, 3);
     Q-4  de qué columna sale cada renglón de la dosis («Dosis y Frecuencia»,
          «Periodo Duración Tratamiento», «Instrucciones de dosificación»,
          «Indicaciones a juicio del Prescriptor»);
     Q-5  cómo es la incapacidad (qué guarda y qué imprime).
   Además, Q-6 arma cada documento con las etiquetas del papel, para revisarlo
   renglón por renglón.

   ─────────────────────────────────────────────────────────────────────────────
   PASO 1 · En la APLICACIÓN del HIS conectada a PRUEBAS (lo hace un médico)
   ─────────────────────────────────────────────────────────────────────────────
   Un paciente de PRUEBA (primer apellido con «PRUEBA»). Una consulta de
   medicina general (S39141, plantilla «CONSULTA EXTERNA»). En cada campo se
   escribe una MARCA: un texto que no puede salir de otro lado, para saber al
   leer la base de qué columna viene cada renglón del papel.

     a) Medicamento de la farmacia del hospital, por 90 días (para que salgan
        las entregas posfechadas), con dosis estructurada «1 cada 12 horas».
        · En las instrucciones o indicación del médico:  MARCA-INDICACION
        · En la observación de la orden, si la pantalla la tiene:  MARCA-OBSERVACION
        · En «indicaciones a juicio del prescriptor», si la tiene:  MARCA-PRESCRIPTOR
     b) Un medicamento externo (de los que la farmacia no tiene), con su
        indicación:  MARCA-EXTERNO
     c) Un laboratorio con la indicación:  MARCA-LABORATORIO
     d) CUATRO remisiones, una con cada prioridad de la lista. En la
        observación de cada una, escribir la prioridad que se eligió, tal cual
        sale en la lista: p. ej.  MARCA-PRIORIDAD Prioritaria Urgente
     e) Una incapacidad de 3 días con la observación:  MARCA-INCAPACIDAD
   Guardar. Si se puede, usar un usuario médico de prueba SIN firma real: la
   firma sale impresa en todos los PDF.

   ─────────────────────────────────────────────────────────────────────────────
   PASO 2 · Imprimir a PDF (impresora PDF como predeterminada)
   ─────────────────────────────────────────────────────────────────────────────
   Módulo Consultas → el paciente → doble clic en cada orden → impresora:
   la fórmula del día y UNA posfechada, la orden de laboratorio, cada una de
   las cuatro remisiones, la incapacidad y la historia. Guardar los PDF.
   Si el médico de prueba tiene una firma real, taparla antes de enviarlos.

   ─────────────────────────────────────────────────────────────────────────────
   PASO 3 · Este script, en SSMS, ventana NUEVA conectada a PRUEBAS
   ─────────────────────────────────────────────────────────────────────────────
     1. En Q-0, escribir el documento del paciente de prueba (y la fecha si no
        es hoy).
     2. F5 con todo.
     3. Mandar los resultados, un mensaje por bloque, y los PDF. Q-6 es largo:
        si no cabe, guardarlo como CSV (clic derecho → Guardar resultados como).
   Aquí SÍ sale texto clínico, pero solo del paciente de PRUEBA.

   QUÉ HACE Y QUÉ NO HACE
     · Solo lee. Escribe únicamente en tablas temporales (#). No ejecuta
       procedimientos del HIS. Rechaza a cualquier paciente cuyo primer
       apellido no contenga «PRUEBA».
     · De la firma solo dice si existe y cuánto pesa; nunca muestra la imagen.
   ============================================================================= */

USE PRUEBAS;
GO

SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

IF DB_NAME() <> N'PRUEBAS' OR OBJECT_ID(N'dbo.HISTORIACLINICA') IS NULL
BEGIN
    DECLARE @por_que nvarchar(500) =
        CASE WHEN DB_NAME() <> N'PRUEBAS'
             THEN N'Estas pruebas solo corren en PRUEBAS y la ventana está en «' + DB_NAME() + N'». Elige PRUEBAS y vuelve a correr.'
             ELSE N'El usuario «' + SUSER_SNAME() + N'» no puede ver dbo.HISTORIACLINICA en PRUEBAS.'
        END + N' No se ejecutó nada.';
    RAISERROR(N'%s', 16, 1, @por_que);
    SET NOEXEC ON;
END;
GO

-- =============================================================================
-- Q-0 · Configuración (OBLIGATORIO)
-- =============================================================================
-- (1) Documento(s) del paciente de PRUEBA ← EDITAR
IF OBJECT_ID('tempdb..#pruebas') IS NOT NULL DROP TABLE #pruebas;
CREATE TABLE #pruebas (documento varchar(20) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY, valido bit NULL, motivo nvarchar(200) NULL);
INSERT #pruebas (documento) VALUES
    ('');                         -- p. ej. ('900000001')

-- (2) Desde cuándo buscar sus atenciones ← EDITAR si no fueron hoy
IF OBJECT_ID('tempdb..#cfg') IS NOT NULL DROP TABLE #cfg;
CREATE TABLE #cfg (desde datetime NOT NULL);
INSERT #cfg VALUES (CAST(CAST(GETDATE() AS date) AS datetime));   -- p. ej. ('2026-11-04')

UPDATE p
   SET valido = CASE WHEN pa.NU_HIST_PAC IS NOT NULL AND UPPER(ISNULL(pa.DE_PRAP_PAC, '')) LIKE '%PRUEBA%' THEN 1 ELSE 0 END,
       motivo = CASE WHEN p.documento = '' THEN N'documento vacío: escríbelo en Q-0'
                     WHEN pa.NU_HIST_PAC IS NULL THEN N'no existe en PACIENTES de PRUEBAS'
                     WHEN UPPER(ISNULL(pa.DE_PRAP_PAC, '')) LIKE '%PRUEBA%' THEN N'paciente de prueba'
                     ELSE N'RECHAZADO: su primer apellido no contiene PRUEBA (¿paciente real?)' END
  FROM #pruebas p
  LEFT JOIN dbo.PACIENTES pa ON pa.NU_HIST_PAC = p.documento;

SELECT N'Q-0' AS bloque, documento, CASE WHEN valido = 1 THEN N'SI' ELSE N'NO' END AS se_usa, motivo FROM #pruebas;
IF NOT EXISTS (SELECT 1 FROM #pruebas WHERE valido = 1)
    RAISERROR(N'Q-0: ningún paciente de prueba válido. Los demás bloques no devolverán nada.', 10, 1);
GO

-- =============================================================================
-- Q-1 · Las historias del paciente de prueba
-- =============================================================================
IF OBJECT_ID('tempdb..#pruebas') IS NULL BEGIN RAISERROR(N'Corre primero Q-0 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @desde datetime = (SELECT desde FROM #cfg);

IF OBJECT_ID('tempdb..#hcp') IS NOT NULL DROP TABLE #hcp;
SELECT h.NU_NUME_HICL AS id, LTRIM(RTRIM(h.NU_HIST_PAC_HICL)) AS pac, h.FE_FECH_HICL AS fecha, h.TX_TIPO_HICL AS tipo,
       h.TX_CODSER_HICL AS ser, h.NU_NUME_LABO_HICL AS labo, h.NU_NUME_REG_HICL AS reg, h.CD_MED_REAL_HICL AS med,
       h.NU_NUME_CONE_HICL AS cone, r.NU_NUME_PLHI_RPET AS plhi
  INTO #hcp
  FROM dbo.HISTORIACLINICA h
  LEFT JOIN dbo.DATOS_PLANTILLA dp ON dp.NU_AUTO_DAPL = h.NU_AUTO_DAPL_HICL
  LEFT JOIN dbo.R_PLAN_ESP_TIAT r  ON r.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL
 WHERE h.NU_HIST_PAC_HICL IN (SELECT documento FROM #pruebas WHERE valido = 1)
   AND h.FE_FECH_HICL >= @desde;

SELECT N'Q-1' AS bloque, h.id AS historia, h.fecha AS guardada, h.tipo, h.ser AS servicio, p.TX_DESC_PLHI AS plantilla,
       m.NO_NOMB_MED AS medico,
       CASE WHEN f.bytes > 0 THEN CONCAT(N'sí (', f.bytes / 1024, N' KB)') ELSE N'no' END AS medico_con_firma_en_usuarios
  FROM #hcp h
  LEFT JOIN dbo.PLANTILLA_HIST p ON p.NU_NUME_PLHI = h.plhi
  LEFT JOIN dbo.MEDICOS m        ON m.CD_CODI_MED = h.med
 OUTER APPLY (SELECT TOP (1) CAST(DATALENGTH(u.IM_FIRMA_USUA) AS bigint) AS bytes
                FROM dbo.USUARIOS u
               WHERE LTRIM(RTRIM(u.NU_DOCU_USUA)) = LTRIM(RTRIM(m.NU_DOCU_MED))
               ORDER BY DATALENGTH(u.IM_FIRMA_USUA) DESC) f
 ORDER BY h.fecha;
GO

-- =============================================================================
-- Q-2 · «Orden Nº»: todos los números candidatos de cada orden
--
-- Buscar en el PDF el «Orden Nº» de la fórmula (del día y posfechada) y de la
-- orden de laboratorio, y decir en cuál de estas columnas aparece.
-- =============================================================================
IF OBJECT_ID('tempdb..#hcp') IS NULL BEGIN RAISERROR(N'Corre primero Q-0 y Q-1 en esta misma ventana.', 16, 1); RETURN; END;

SELECT N'Q-2 (a)' AS bloque, h.id AS historia,
       CASE o.NU_TIPO_HORD WHEN 5 THEN N'Fórmula' WHEN 2 THEN N'Laboratorio' WHEN 4 THEN N'Procedimiento'
                           WHEN 1 THEN N'Consulta o control' WHEN 3 THEN N'Cirugía' ELSE N'Otro' END AS orden_de,
       o.TX_TIAP_HORD AS ai_o_ae, CONVERT(char(10), o.FE_POSFECHA, 23) AS posfechada_desde,
       o.NU_AUTO_HORD AS nu_auto_hord, o.NU_CLAVE_HORD AS nu_clave_hord, o.NU_CLAVE_HICL_HORD AS nu_clave_hicl_hord,
       o.NU_CLAVE_HEVO_HORD AS nu_clave_hevo_hord, o.NU_ORDEN_FECHAPOS AS nu_orden_fechapos,
       (SELECT STRING_AGG(CAST(CONCAT(m.NU_NUME_HMED, N'/', m.NU_NUME_FORM_HMED, N'/', m.NU_CLAVEHMED_HMED) AS nvarchar(max)), N'; ')
          FROM dbo.HIST_MEDI m WHERE m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD) AS medi_nume_form_clave,
       (SELECT STRING_AGG(CAST(CONCAT(p.NU_NUME_HPRO, N'/', p.NU_CLAVEHPRO_HPRO) AS nvarchar(max)), N'; ')
          FROM dbo.HIST_PROC p WHERE p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD) AS proc_nume_clave
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id
 ORDER BY h.id, o.NU_TIPO_HORD, o.NU_AUTO_HORD;

-- (b) lo que guardó el registro de impresiones cuando se imprimió en el PASO 2
SELECT N'Q-2 (b)' AS bloque, d.NU_NUME_HICL_IMDE AS historia, LTRIM(RTRIM(d.TX_TIPO_IMDE)) AS tipo_papel,
       d.NU_NUME_IMDE AS numero_registrado, i.FE_FECH_HIMP AS impreso, DATEDIFF(minute, h.fecha, i.FE_FECH_HIMP) AS minutos_despues,
       CASE WHEN i.NU_NUME_CONE_HIMP = h.cone THEN N'sí' ELSE N'no' END AS misma_sesion_que_la_historia,
       CASE WHEN d.NU_NUME_IMDE = h.id THEN N'la historia'
            WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o WHERE o.NU_NUME_HICL_HORD = h.id AND o.NU_AUTO_HORD = d.NU_NUME_IMDE) THEN N'NU_AUTO_HORD'
            WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o WHERE o.NU_NUME_HICL_HORD = h.id AND o.NU_CLAVE_HORD = d.NU_NUME_IMDE) THEN N'NU_CLAVE_HORD'
            WHEN EXISTS (SELECT 1 FROM dbo.HIST_ORDEN o JOIN dbo.HIST_MEDI m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
                          WHERE o.NU_NUME_HICL_HORD = h.id AND m.NU_NUME_FORM_HMED = d.NU_NUME_IMDE) THEN N'NU_NUME_FORM_HMED'
            WHEN EXISTS (SELECT 1 FROM dbo.HIST_REMI r WHERE r.NU_NUME_HICL_HREM = h.id AND r.NU_NUME_HREM = d.NU_NUME_IMDE) THEN N'NU_NUME_HREM'
            WHEN EXISTS (SELECT 1 FROM dbo.HIST_INCA x WHERE x.NU_NUME_HICL_HINC = h.id AND x.NU_NUME_HINC = d.NU_NUME_IMDE) THEN N'NU_NUME_HINC'
            WHEN EXISTS (SELECT 1 FROM dbo.HIST_INDI x WHERE x.NU_NUME_HICL_HIND = h.id AND x.NU_NUME_HIND = d.NU_NUME_IMDE) THEN N'NU_NUME_HIND'
            ELSE N'(ninguna de las conocidas)' END AS es_el_numero_de
  FROM #hcp h
  JOIN dbo.HIST_IMPRESION_DETA d ON d.NU_NUME_HICL_IMDE = h.id
  JOIN dbo.HIST_IMPRESION i      ON i.NU_AUTO_HIMP = d.NU_AUTO_HIMP_IMDE
 ORDER BY i.FE_FECH_HIMP, d.NU_AUTO_IMDE;
GO

-- =============================================================================
-- Q-3 · Prioridad de la remisión: código frente a lo que se eligió
--
-- La observación de cada remisión dice qué prioridad se eligió en la lista
-- (PASO 1 d). Así queda el catálogo 0-3, que no está en la base.
-- =============================================================================
IF OBJECT_ID('tempdb..#hcp') IS NULL BEGIN RAISERROR(N'Corre primero Q-0 y Q-1 en esta misma ventana.', 16, 1); RETURN; END;

SELECT N'Q-3' AS bloque, h.id AS historia, r.NU_NUME_HREM AS remision, LTRIM(RTRIM(r.TX_PRIO_HREM)) AS codigo_prioridad,
       LEFT(CAST(r.DE_DESC_HREM AS varchar(max)), 200) AS observacion_con_la_prioridad_elegida,
       r.TX_SERV_HREM AS servicio_pedido, r.TX_CUPSPR_HREM AS cups, r.DE_REMI_HREM AS remite_a, r.NU_MTVREM_HREM AS motivo,
       r.TX_DESPER_HREM AS tx_desper, r.NU_INST_HREM AS institucion, r.FE_FECHA_HREM AS fecha
  FROM #hcp h
  JOIN dbo.HIST_REMI r ON r.NU_NUME_HICL_HREM = h.id
 ORDER BY r.NU_NUME_HREM;
GO

-- =============================================================================
-- Q-4 · La dosis: cada columna de cada medicamento, y dónde quedó cada MARCA
--
-- Comparar con el PDF de la fórmula: ¿qué columna sale en «Dosis y Frecuencia
-- de Administración», en «Periodo Duración Tratamiento», en «Instrucciones de
-- dosificación» y en «Indicaciones a juicio del Prescriptor»?
-- =============================================================================
IF OBJECT_ID('tempdb..#hcp') IS NULL BEGIN RAISERROR(N'Corre primero Q-0 y Q-1 en esta misma ventana.', 16, 1); RETURN; END;

SELECT N'Q-4 (a)' AS bloque, h.id AS historia, o.NU_AUTO_HORD AS orden, o.TX_TIAP_HORD AS ai_o_ae,
       CONVERT(char(10), o.FE_POSFECHA, 23) AS posfechada_desde, m.NU_NUME_HMED AS renglon, m.NO_NOMB_ARTI_HMED AS medicamento,
       LEFT(CAST(m.DE_DOSIS_HMED AS varchar(max)), 300) AS de_dosis_hmed,
       m.TX_INDDOS_HMED AS tx_inddos_hmed,
       m.TX_INDESP_HMED AS tx_indesp_hmed,
       LEFT(CAST(o.ME_OBSERV_HORD AS varchar(max)), 300) AS me_observ_hord,
       LEFT(CAST(o.ME_MATESP_HORD AS varchar(max)), 300) AS me_matesp_hord,
       m.TX_DURA_HMED AS tx_dura_hmed,
       CONCAT(m.NU_CTDSIS_HMED, N' ', u.TX_NOMB_CONF_MED, N' (', m.TX_UMDSIS_HMED, N')') AS dosis_estructurada,
       CONCAT(N'cada ', m.NU_CTFREC_HMED, N' ', f.TX_DESC_CONF_HIS, N' (', m.TX_CDFREC_HMED, N')') AS frecuencia_estructurada,
       m.TX_VIAD_HMED AS via, m.TX_FOFA_HMED AS forma, m.DE_CTRA_HMED AS concentracion, m.DE_UNME_HMED AS medida,
       m.NU_CANT_HMED AS cantidad, o.TX_VIGE_HORD AS vigencia, m.NU_ESTA_HMED AS estado
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI  m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
  LEFT JOIN dbo.INV_CONFIG_MED u ON u.TX_CODI_CONF_MED = m.TX_UMDSIS_HMED AND u.NU_TIPO_CONF_MED = 1
  LEFT JOIN dbo.PAC_CONFIG_HIS f ON f.TX_CODI_CONF_HIS = m.TX_CDFREC_HMED AND f.NU_TIPO_CONF_HIS = 37
 ORDER BY h.id, o.NU_AUTO_HORD, m.NU_NUME_HMED;

-- (b) en qué columna quedó cada MARCA escrita en la aplicación
SELECT N'Q-4 (b)' AS bloque, x.columna, x.donde, x.valor
  FROM (SELECT N'HIST_MEDI.DE_DOSIS_HMED' AS columna, CONCAT(N'orden ', o.NU_AUTO_HORD, N', renglón ', m.NU_NUME_HMED) AS donde,
               LEFT(CAST(m.DE_DOSIS_HMED AS varchar(max)), 300) AS valor
          FROM #hcp h JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id JOIN dbo.HIST_MEDI m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
        UNION ALL
        SELECT N'HIST_MEDI.TX_INDDOS_HMED', CONCAT(N'orden ', o.NU_AUTO_HORD, N', renglón ', m.NU_NUME_HMED), m.TX_INDDOS_HMED
          FROM #hcp h JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id JOIN dbo.HIST_MEDI m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
        UNION ALL
        SELECT N'HIST_MEDI.TX_INDESP_HMED', CONCAT(N'orden ', o.NU_AUTO_HORD, N', renglón ', m.NU_NUME_HMED), m.TX_INDESP_HMED
          FROM #hcp h JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id JOIN dbo.HIST_MEDI m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
        UNION ALL
        SELECT N'HIST_ORDEN.ME_OBSERV_HORD', CONCAT(N'orden ', o.NU_AUTO_HORD), LEFT(CAST(o.ME_OBSERV_HORD AS varchar(max)), 300)
          FROM #hcp h JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id
        UNION ALL
        SELECT N'HIST_ORDEN.ME_MATESP_HORD', CONCAT(N'orden ', o.NU_AUTO_HORD), LEFT(CAST(o.ME_MATESP_HORD AS varchar(max)), 300)
          FROM #hcp h JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id
        UNION ALL
        SELECT N'HIST_PROC.DE_INDI_HPRO', CONCAT(N'orden ', o.NU_AUTO_HORD, N', renglón ', p.NU_NUME_HPRO), LEFT(CAST(p.DE_INDI_HPRO AS varchar(max)), 300)
          FROM #hcp h JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id JOIN dbo.HIST_PROC p ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
        UNION ALL
        SELECT N'HIST_REMI.DE_DESC_HREM', CONCAT(N'remisión ', r.NU_NUME_HREM), LEFT(CAST(r.DE_DESC_HREM AS varchar(max)), 300)
          FROM #hcp h JOIN dbo.HIST_REMI r ON r.NU_NUME_HICL_HREM = h.id
        UNION ALL
        SELECT N'HIST_INCA.DE_DESC_HINC', CONCAT(N'incapacidad ', i.NU_NUME_HINC), LEFT(CAST(i.DE_DESC_HINC AS varchar(max)), 300)
          FROM #hcp h JOIN dbo.HIST_INCA i ON i.NU_NUME_HICL_HINC = h.id
        UNION ALL
        SELECT N'HIST_INDI.DE_DESC_HIND', CONCAT(N'indicación ', i.NU_NUME_HIND), LEFT(CAST(i.DE_DESC_HIND AS varchar(max)), 300)
          FROM #hcp h JOIN dbo.HIST_INDI i ON i.NU_NUME_HICL_HIND = h.id) x
 WHERE UPPER(x.valor) LIKE N'%MARCA-%'
 ORDER BY x.columna, x.donde;
GO

-- =============================================================================
-- Q-5 · La incapacidad: todo lo que guarda (comparar con su PDF)
-- =============================================================================
IF OBJECT_ID('tempdb..#hcp') IS NULL BEGIN RAISERROR(N'Corre primero Q-0 y Q-1 en esta misma ventana.', 16, 1); RETURN; END;

SELECT N'Q-5' AS bloque, h.id AS historia, i.NU_NUME_HINC AS numero, CONVERT(char(10), i.FE_INIC_HINC, 23) AS desde,
       i.NU_DIAS_HINC AS dias, CONVERT(char(10), DATEADD(day, i.NU_DIAS_HINC - 1, i.FE_INIC_HINC), 23) AS hasta_calculado,
       i.NU_PROR_HINC AS prorroga, i.TX_TIPO_HINC AS tipo, i.TX_ORIG_INCA_HINC AS origen, i.CD_CODI_CAEX_HINC AS causa_externa,
       i.TX_MODA_SALU_HINC AS modalidad, i.TX_GRUP_SERV_HINC AS grupo_servicio, i.TX_INCA_RETR_HINC AS retroactiva,
       LEFT(CAST(i.DE_DESC_HINC AS varchar(max)), 300) AS observacion,
       CONVERT(char(10), i.FE_PROB_PART_HINC, 23) AS fecha_probable_parto, i.TX_EMBA_MULT_HINC AS embarazo_multiple,
       i.NU_NACI_VIVO_HINC AS nacidos_vivos, i.NU_EDAD_GEST_HINC AS edad_gestacional, i.TX_CERT_VIVO_HINC AS certificado_nacido_vivo
  FROM #hcp h
  JOIN dbo.HIST_INCA i ON i.NU_NUME_HICL_HINC = h.id
 ORDER BY i.NU_NUME_HINC;
GO

-- =============================================================================
-- Q-6 · Cada documento con las etiquetas del papel (revisarlo renglón por renglón)
--
-- «seguro»: «visto» = ya cuadró en los reportes o en las rondas 5 y 6;
-- «confirmar» = lo confirma este papel (anotar la columna correcta si no).
-- =============================================================================
IF DB_NAME() <> N'PRUEBAS' OR OBJECT_ID('tempdb..#hcp') IS NULL
BEGIN RAISERROR(N'Corre primero Q-0 y Q-1 en esta misma ventana.', 16, 1); RETURN; END;

IF OBJECT_ID('tempdb..#doc') IS NOT NULL DROP TABLE #doc;
CREATE TABLE #doc (historia int, documento nvarchar(60) COLLATE DATABASE_DEFAULT, numero nvarchar(40) COLLATE DATABASE_DEFAULT,
                   orden_campo int, etiqueta nvarchar(80) COLLATE DATABASE_DEFAULT, valor nvarchar(max) COLLATE DATABASE_DEFAULT,
                   sale_de nvarchar(160) COLLATE DATABASE_DEFAULT, seguro nvarchar(10) COLLATE DATABASE_DEFAULT);

-- Diagnóstico principal de cada historia (lo imprimen la fórmula, las órdenes y la remisión)
IF OBJECT_ID('tempdb..#dxp') IS NOT NULL DROP TABLE #dxp;
SELECT h.id, x.cie10, x.diagnostico, x.tipo
  INTO #dxp
  FROM #hcp h
 OUTER APPLY (SELECT TOP (1) d.CD_CODI_DIAG_RLAD AS cie10, dg.DE_DESC_DIAG AS diagnostico, td.DE_DESC_TIDI AS tipo
                FROM dbo.R_LABO_DIAG d
                LEFT JOIN dbo.DIAGNOSTICO dg     ON dg.CD_CODI_DIAG = d.CD_CODI_DIAG_RLAD
                LEFT JOIN dbo.TIPODIAGNOSTICO td ON td.ID_CODI_TIDI = d.ID_TIPO_DIAG_RLAD
               WHERE d.NU_NUME_LABO_RLAD = h.labo
               ORDER BY d.ID_TIPO_RLAD) x;

-- (0) encabezado común («Registro de Calidad») y pie del médico
INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'0 Encabezado y pie de todos', N'', v.k, v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  LEFT JOIN dbo.PACIENTES pa      ON pa.NU_HIST_PAC = h.pac
  LEFT JOIN dbo.TIPO_DOCUMENTO td ON td.NU_CODIGO_TDOC = pa.NU_TIPD_PAC
  LEFT JOIN dbo.LABORATORIO l     ON l.NU_NUME_LABO = h.labo
  LEFT JOIN dbo.ESPECIALIDADES e  ON e.CD_CODI_ESP = l.CD_CODI_ESP_LABO
  LEFT JOIN dbo.MEDICOS m         ON m.CD_CODI_MED = h.med
  LEFT JOIN dbo.PLANTILLA_HIST pl ON pl.NU_NUME_PLHI = h.plhi
  LEFT JOIN #dxp dx               ON dx.id = h.id
 OUTER APPLY (SELECT MAX(t.NU_NUME_CONV_HTLA) AS convenio FROM dbo.HIST_TEMLABO t WHERE t.NU_NUME_HICL_HTLA = h.id) cv
  LEFT JOIN dbo.CONVENIOS k       ON k.NU_NUME_CONV = cv.convenio
  LEFT JOIN dbo.EPS ep            ON ep.CD_NIT_EPS = k.CD_NIT_EPS_CONV
  LEFT JOIN dbo.TIPOUSUARIO tu    ON tu.ID_CODI_TIUS = k.ID_CODI_TIUS_CONV
 OUTER APPLY (SELECT TOP (1) x.NO_NOMB_ENTI, x.CD_NIT_ENTI, x.DE_DIRE_ENTI, x.DE_TELE_ENTI FROM dbo.ENTIDAD x) en
 CROSS APPLY (VALUES
       (0,  N'Hospital (encabezado)',           CONCAT(en.NO_NOMB_ENTI, N' · Nit. ', en.CD_NIT_ENTI, N' · Dir. ', en.DE_DIRE_ENTI, N' · Tel. ', en.DE_TELE_ENTI),
                                                                                                N'ENTIDAD (el logo: ENTIDAD.IM_LOGO_ENTI)', N'visto'),
       (1,  N'Código Plantilla',                CAST(pl.TX_CODI_PLHI AS nvarchar(max)),        N'PLANTILLA_HIST.TX_CODI_PLHI', N'visto'),
       (2,  N'Fecha Historia',                  CONVERT(nvarchar(16), h.fecha, 120),           N'HISTORIACLINICA.FE_FECH_HICL', N'visto'),
       (3,  N'Documento y Nombre del Paciente', CONCAT(td.TX_NOMB_TDOC, N' ', pa.NU_DOCU_PAC, N' ', pa.NO_NOMB_PAC, N' ', pa.NO_SGNO_PAC,
                                                       N' ', pa.DE_PRAP_PAC, N' ', pa.DE_SGAP_PAC), N'PACIENTES + TIPO_DOCUMENTO', N'visto'),
       (4,  N'Edad',                            CAST(l.NU_EDAD_LABO AS nvarchar(max)),          N'LABORATORIO.NU_EDAD_LABO', N'confirmar'),
       (5,  N'Administradora',                  CAST(ep.NO_NOMB_EPS AS nvarchar(max)),          N'HIST_TEMLABO → CONVENIOS.CD_NIT_EPS_CONV → EPS', N'confirmar'),
       (6,  N'Convenio',                        CONCAT(k.CD_CODI_CONV, N' (NU_NUME_CONV ', cv.convenio, N')'), N'HIST_TEMLABO.NU_NUME_CONV_HTLA → CONVENIOS.CD_CODI_CONV', N'confirmar'),
       (7,  N'Tipo de Usuario',                 CONCAT(tu.DE_DESC_TIUS, N' · PACIENTES.NU_TIPO_PAC = ', pa.NU_TIPO_PAC),
                                                                                                N'CONVENIOS.ID_CODI_TIUS_CONV → TIPOUSUARIO (y PACIENTES.NU_TIPO_PAC)', N'confirmar'),
       (8,  N'No Historia',                     CAST(h.pac AS nvarchar(max)),                   N'HISTORIACLINICA.NU_HIST_PAC_HICL', N'visto'),
       (9,  N'Cons. Historia',                  CAST(h.id AS nvarchar(max)),                    N'HISTORIACLINICA.NU_NUME_HICL', N'visto'),
       (10, N'Registro de Admisión',            CAST(h.reg AS nvarchar(max)),                   N'HISTORIACLINICA.NU_NUME_REG_HICL', N'visto'),
       (11, N'Atención (servicio)',             CAST(h.ser AS nvarchar(max)),                   N'HISTORIACLINICA.TX_CODSER_HICL', N'confirmar'),
       (12, N'DX Principal',                    CONCAT(dx.cie10, N' ', dx.diagnostico),         N'R_LABO_DIAG → DIAGNOSTICO', N'visto'),
       (13, N'Tipo de DX Principal',            CAST(dx.tipo AS nvarchar(max)),                 N'R_LABO_DIAG → TIPODIAGNOSTICO', N'visto'),
       (14, N'DR. (médico)',                    CAST(m.NO_NOMB_MED AS nvarchar(max)),           N'MEDICOS.NO_NOMB_MED', N'visto'),
       (15, N'CC',                              CAST(m.NU_DOCU_MED AS nvarchar(max)),           N'MEDICOS.NU_DOCU_MED', N'confirmar'),
       (16, N'Especialidad',                    CAST(e.NO_NOMB_ESP AS nvarchar(max)),           N'LABORATORIO.CD_CODI_ESP_LABO → ESPECIALIDADES', N'confirmar'),
       (17, N'Registro',                        CAST(m.DE_REGI_MED AS nvarchar(max)),           N'MEDICOS.DE_REGI_MED', N'visto'),
       (18, N'Firma',                           N'(imagen)',                                    N'USUARIOS.IM_FIRMA_USUA, por USUARIOS.NU_DOCU_USUA = MEDICOS.NU_DOCU_MED (ronda 6)', N'visto')
     ) v (k, etiqueta, valor, sale_de, seguro);

-- (1) fórmula: una hoja por orden (la del día y cada posfechada tienen su número)
INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'1 Fórmula (infOrdenMedHC.rpt)', CONCAT(N'Orden ', o.NU_AUTO_HORD), v.k, v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5
 CROSS APPLY (VALUES
       (1, N'Orden Nº',                       CAST(o.NU_AUTO_HORD AS nvarchar(max)),            N'HIST_ORDEN.NU_AUTO_HORD (¿o NU_CLAVE_HORD?)', N'confirmar'),
       (2, N'(otro número de la orden)',      CAST(o.NU_CLAVE_HORD AS nvarchar(max)),           N'HIST_ORDEN.NU_CLAVE_HORD', N'confirmar'),
       (3, N'Fecha de la orden',              CONVERT(nvarchar(16), o.FE_FECH_HORD, 120),       N'HIST_ORDEN.FE_FECH_HORD', N'confirmar'),
       (4, N'Reclamar desde (posfechada)',    CONVERT(nvarchar(10), o.FE_POSFECHA, 23),         N'HIST_ORDEN.FE_POSFECHA', N'confirmar'),
       (5, N'Vigencia de la Orden',           CAST(o.TX_VIGE_HORD AS nvarchar(max)),            N'HIST_ORDEN.TX_VIGE_HORD', N'confirmar'),
       (6, N'Farmacia AI/AE (no se imprime)', CAST(o.TX_TIAP_HORD AS nvarchar(max)),            N'HIST_ORDEN.TX_TIAP_HORD', N'visto'),
       (7, N'Observación de la orden',        LEFT(CAST(o.ME_OBSERV_HORD AS varchar(max)), 1000), N'HIST_ORDEN.ME_OBSERV_HORD (¿«Indicaciones a juicio del Prescriptor»?)', N'confirmar')
     ) v (k, etiqueta, valor, sale_de, seguro);

INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'1 Fórmula (infOrdenMedHC.rpt)', CONCAT(N'Orden ', o.NU_AUTO_HORD),
       100 * DENSE_RANK() OVER (PARTITION BY o.NU_AUTO_HORD ORDER BY m.NU_NUME_HMED, m.CD_CODI_ARTI_HMED) + v.k,
       v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o     ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI m      ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
  LEFT JOIN dbo.ARTICULO ar ON ar.CD_CODI_ARTI = m.CD_CODI_ARTI_HMED
 CROSS APPLY (VALUES
       (1,  N'Código',                                CAST(m.CD_CODI_ARTI_HMED AS nvarchar(max)), N'HIST_MEDI.CD_CODI_ARTI_HMED', N'visto'),
       (2,  N'Medicamento',                           CAST(m.NO_NOMB_ARTI_HMED AS nvarchar(max)), N'HIST_MEDI.NO_NOMB_ARTI_HMED', N'visto'),
       (3,  N'Código CUM',                            CAST(ar.NU_CODCUM_ARTI AS nvarchar(max)),   N'ARTICULO.NU_CODCUM_ARTI', N'confirmar'),
       (4,  N'Código CUM (otra fuente)',              CAST(m.TX_SISPRO_HMED AS nvarchar(max)),    N'HIST_MEDI.TX_SISPRO_HMED', N'confirmar'),
       (5,  N'Invima',                                CAST(ar.TX_INVIMA_ARTI AS nvarchar(max)),   N'ARTICULO.TX_INVIMA_ARTI', N'confirmar'),
       (6,  N'Medida',                                CAST(m.DE_UNME_HMED AS nvarchar(max)),      N'HIST_MEDI.DE_UNME_HMED', N'visto'),
       (7,  N'Concentración',                         CAST(m.DE_CTRA_HMED AS nvarchar(max)),      N'HIST_MEDI.DE_CTRA_HMED', N'visto'),
       (8,  N'Vía Administración',                    CAST(m.TX_VIAD_HMED AS nvarchar(max)),      N'HIST_MEDI.TX_VIAD_HMED', N'visto'),
       (9,  N'Cantidad',                              CAST(m.NU_CANT_HMED AS nvarchar(max)),      N'HIST_MEDI.NU_CANT_HMED (AgenIA la escribe también en letras, en español)', N'visto'),
       (10, N'Forma Farmacéutica',                    CAST(m.TX_FOFA_HMED AS nvarchar(max)),      N'HIST_MEDI.TX_FOFA_HMED', N'visto'),
       (11, N'Dosis y Frecuencia de Administración',  LEFT(CAST(m.DE_DOSIS_HMED AS varchar(max)), 500), N'HIST_MEDI.DE_DOSIS_HMED (el texto que arma el HIS; D19)', N'confirmar'),
       (12, N'Periodo Duración Tratamiento',          CAST(m.TX_DURA_HMED AS nvarchar(max)),      N'HIST_MEDI.TX_DURA_HMED (días)', N'confirmar'),
       (13, N'Instrucciones de dosificación',         CAST(m.TX_INDDOS_HMED AS nvarchar(max)),    N'HIST_MEDI.TX_INDDOS_HMED (la indicación del médico)', N'confirmar'),
       (14, N'Indicaciones a juicio del Prescriptor', CAST(m.TX_INDESP_HMED AS nvarchar(max)),    N'HIST_MEDI.TX_INDESP_HMED (¿o la observación de la orden?)', N'confirmar'),
       (15, N'Estado (no se imprime)',                CAST(m.NU_ESTA_HMED AS nvarchar(max)),      N'HIST_MEDI.NU_ESTA_HMED: 1 formulado, 2 entregado, 0 anulado', N'visto')
     ) v (k, etiqueta, valor, sale_de, seguro);

-- (2) orden de ayudas diagnósticas (tipos 1 a 4)
INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'2 Orden de ayudas diagnósticas (infOrdenADh.rpt)', CONCAT(N'Orden ', o.NU_AUTO_HORD), v.k, v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD IN (1, 2, 3, 4)
 CROSS APPLY (VALUES
       (1, N'Orden Nº',                      CAST(o.NU_AUTO_HORD AS nvarchar(max)),            N'HIST_ORDEN.NU_AUTO_HORD (¿o NU_CLAVE_HORD?)', N'confirmar'),
       (2, N'(otro número de la orden)',     CAST(o.NU_CLAVE_HORD AS nvarchar(max)),           N'HIST_ORDEN.NU_CLAVE_HORD', N'confirmar'),
       (3, N'Tipo de orden (no se imprime)', CASE o.NU_TIPO_HORD WHEN 1 THEN N'1 Consulta o control' WHEN 2 THEN N'2 Laboratorio'
                                                                 WHEN 3 THEN N'3 Cirugía' ELSE N'4 Procedimiento o ayuda diagnóstica' END,
                                                                                               N'HIST_ORDEN.NU_TIPO_HORD', N'visto'),
       (4, N'Fecha de la orden',             CONVERT(nvarchar(16), o.FE_FECH_HORD, 120),       N'HIST_ORDEN.FE_FECH_HORD', N'confirmar'),
       (5, N'Vigencia',                      CAST(o.TX_VIGE_HORD AS nvarchar(max)),            N'HIST_ORDEN.TX_VIGE_HORD (el papel de ejemplo no la trae)', N'confirmar'),
       (6, N'Observación de la orden',       LEFT(CAST(o.ME_OBSERV_HORD AS varchar(max)), 1000), N'HIST_ORDEN.ME_OBSERV_HORD', N'confirmar')
     ) v (k, etiqueta, valor, sale_de, seguro);

INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'2 Orden de ayudas diagnósticas (infOrdenADh.rpt)', CONCAT(N'Orden ', o.NU_AUTO_HORD),
       100 * DENSE_RANK() OVER (PARTITION BY o.NU_AUTO_HORD ORDER BY p.NU_NUME_HPRO, p.CD_CODI_SER_HPRO) + v.k,
       v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o     ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD IN (1, 2, 3, 4)
  JOIN dbo.HIST_PROC p      ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = p.CD_CODI_SER_HPRO
 CROSS APPLY (VALUES
       (1, N'Procedimiento',              CONCAT(p.CD_CODI_SER_HPRO, N' - ', s.NO_NOMB_SER),      N'HIST_PROC.CD_CODI_SER_HPRO → SERVICIOS.NO_NOMB_SER', N'visto'),
       (2, N'Código CUPS (no se imprime)', CAST(p.TX_SISPRO_HPRO AS nvarchar(max)),               N'HIST_PROC.TX_SISPRO_HPRO', N'confirmar'),
       (3, N'Cantidad',                   CAST(p.NU_CANT_HPRO AS nvarchar(max)),                  N'HIST_PROC.NU_CANT_HPRO', N'visto'),
       (4, N'Indicaciones',               LEFT(CAST(p.DE_INDI_HPRO AS varchar(max)), 1000),       N'HIST_PROC.DE_INDI_HPRO', N'visto')
     ) v (k, etiqueta, valor, sale_de, seguro);

-- (3) remisión: HIST_REMI guarda una foto de casi todo el papel (etiquetas de infRemiPac.rpt)
INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'3 Remisión (infRemiPac.rpt)', CONCAT(N'Remisión ', r.NU_NUME_HREM), v.k, v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  JOIN dbo.HIST_REMI r ON r.NU_NUME_HICL_HREM = h.id
 CROSS APPLY (VALUES
       (1,  N'Remisión Nº',                   CAST(r.NU_NUME_HREM AS nvarchar(max)),            N'HIST_REMI.NU_NUME_HREM', N'visto'),
       (2,  N'FECHA SOLICITUD',               CONVERT(nvarchar(16), r.FE_FECHA_HREM, 120),      N'HIST_REMI.FE_FECHA_HREM', N'confirmar'),
       (3,  N'A: (institución)',              CAST(r.NU_INST_HREM AS nvarchar(max)),            N'HIST_REMI.NU_INST_HREM (código)', N'confirmar'),
       (4,  N'Remite a',                      CAST(r.DE_REMI_HREM AS nvarchar(max)),            N'HIST_REMI.DE_REMI_HREM', N'visto'),
       (5,  N'SERVICIOS SOLICITADOS',         CAST(r.TX_SERV_HREM AS nvarchar(max)),            N'HIST_REMI.TX_SERV_HREM', N'confirmar'),
       (6,  N'OBSERVACIONES (Indicaciones)',  LEFT(CAST(r.DE_DESC_HREM AS varchar(max)), 2000), N'HIST_REMI.DE_DESC_HREM', N'confirmar'),
       (7,  N'PRIORIDAD DE LA REMISIÓN',      CAST(r.TX_PRIO_HREM AS nvarchar(max)),            N'HIST_REMI.TX_PRIO_HREM (código)', N'confirmar'),
       (8,  N'MOTIVO DE REMISIÓN',            CAST(r.NU_MTVREM_HREM AS nvarchar(max)),          N'HIST_REMI.NU_MTVREM_HREM (código)', N'confirmar'),
       (9,  N'SERVICIO QUE REMITE',           CONCAT(r.NU_SRVREM_HREM, N' / ', r.TX_SRVREM_HREM), N'HIST_REMI.NU_SRVREM_HREM / TX_SRVREM_HREM', N'confirmar'),
       (10, N'SERVICIO AL QUE REMITE',        CONCAT(r.TX_TIPTRA_HREM, N' / ', r.TX_DESPER_HREM), N'HIST_REMI.TX_TIPTRA_HREM / TX_DESPER_HREM', N'confirmar'),
       (11, N'EVENTO',                        CAST(r.TX_MOTATE_HREM AS nvarchar(max)),          N'HIST_REMI.TX_MOTATE_HREM', N'confirmar'),
       (12, N'Grupo Servicio',                CAST(r.TX_GRUSER_HREM AS nvarchar(max)),          N'HIST_REMI.TX_GRUSER_HREM', N'confirmar'),
       (13, N'Modalidad de la tecnología',    CAST(r.TX_MODTEC_HREM AS nvarchar(max)),          N'HIST_REMI.TX_MODTEC_HREM', N'confirmar'),
       (14, N'Código del servicio',           CAST(r.TX_CODSER_HREM AS nvarchar(max)),          N'HIST_REMI.TX_CODSER_HREM', N'confirmar'),
       (15, N'CUPS solicitado × cantidad',    CONCAT(r.TX_CUPSPR_HREM, N' × ', r.NU_CANTPR_HREM), N'HIST_REMI.TX_CUPSPR_HREM, NU_CANTPR_HREM', N'confirmar'),
       (16, N'Residencia Habitual',           CAST(r.TX_REHA_HREM AS nvarchar(max)),            N'HIST_REMI.TX_REHA_HREM', N'confirmar'),
       (17, N'Residencia Actual',             CAST(r.TX_REAC_HREM AS nvarchar(max)),            N'HIST_REMI.TX_REAC_HREM', N'confirmar'),
       (18, N'Responsable del Paciente',      CAST(r.TX_DATACO_HREM AS nvarchar(max)),          N'HIST_REMI.TX_DATACO_HREM', N'confirmar'),
       (19, N'Régimen',                       CONCAT(r.TX_TIPREG_HREM, N' / ', r.CD_CODI_REG_HREM, N' / ', r.TX_NOMREG_HREM),
                                                                                               N'HIST_REMI.TX_TIPREG_HREM / CD_CODI_REG_HREM / TX_NOMREG_HREM', N'confirmar'),
       (20, N'Número de Ficha Sisben',        CAST(r.TX_FICHA_HREM AS nvarchar(max)),           N'HIST_REMI.TX_FICHA_HREM', N'confirmar'),
       (21, N'Nivel de Pobreza',              CAST(r.TX_SISBEN_HREM AS nvarchar(max)),          N'HIST_REMI.TX_SISBEN_HREM', N'confirmar'),
       (22, N'Nombre EPS/ARS/CAJA',           CAST(r.TX_ADMIN_HREM AS nvarchar(max)),           N'HIST_REMI.TX_ADMIN_HREM', N'confirmar'),
       (23, N'Caso clínico: caracteres',      CAST(DATALENGTH(r.TX_CASO_HREM) AS nvarchar(max)), N'HIST_REMI.TX_CASO_HREM', N'confirmar'),
       (24, N'DESCRIPCION DEL CASO CLINICO',  LEFT(CAST(r.TX_CASO_HREM AS varchar(max)), 4000), N'HIST_REMI.TX_CASO_HREM (primeros 4.000 caracteres)', N'confirmar')
     ) v (k, etiqueta, valor, sale_de, seguro);

-- (4) incapacidad
INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'4 Incapacidad', CONCAT(N'Incapacidad ', i.NU_NUME_HINC), v.k, v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  JOIN dbo.HIST_INCA i ON i.NU_NUME_HICL_HINC = h.id
 CROSS APPLY (VALUES
       (1,  N'Número',                        CAST(i.NU_NUME_HINC AS nvarchar(max)),            N'HIST_INCA.NU_NUME_HINC', N'confirmar'),
       (2,  N'Desde',                         CONVERT(nvarchar(10), i.FE_INIC_HINC, 23),        N'HIST_INCA.FE_INIC_HINC', N'confirmar'),
       (3,  N'Días',                          CAST(i.NU_DIAS_HINC AS nvarchar(max)),            N'HIST_INCA.NU_DIAS_HINC', N'confirmar'),
       (4,  N'Hasta (calculado)',             CONVERT(nvarchar(10), DATEADD(day, i.NU_DIAS_HINC - 1, i.FE_INIC_HINC), 23), N'FE_INIC_HINC + días − 1', N'confirmar'),
       (5,  N'Prórroga',                      CAST(i.NU_PROR_HINC AS nvarchar(max)),            N'HIST_INCA.NU_PROR_HINC', N'confirmar'),
       (6,  N'Tipo',                          CAST(i.TX_TIPO_HINC AS nvarchar(max)),            N'HIST_INCA.TX_TIPO_HINC', N'confirmar'),
       (7,  N'Origen',                        CAST(i.TX_ORIG_INCA_HINC AS nvarchar(max)),       N'HIST_INCA.TX_ORIG_INCA_HINC', N'confirmar'),
       (8,  N'Causa externa',                 CAST(i.CD_CODI_CAEX_HINC AS nvarchar(max)),       N'HIST_INCA.CD_CODI_CAEX_HINC', N'confirmar'),
       (9,  N'Modalidad / grupo de servicio', CONCAT(i.TX_MODA_SALU_HINC, N' / ', i.TX_GRUP_SERV_HINC), N'HIST_INCA.TX_MODA_SALU_HINC / TX_GRUP_SERV_HINC', N'confirmar'),
       (10, N'Retroactiva',                   CAST(i.TX_INCA_RETR_HINC AS nvarchar(max)),       N'HIST_INCA.TX_INCA_RETR_HINC', N'confirmar'),
       (11, N'Observación',                   LEFT(CAST(i.DE_DESC_HINC AS varchar(max)), 1000), N'HIST_INCA.DE_DESC_HINC', N'confirmar')
     ) v (k, etiqueta, valor, sale_de, seguro);

-- (5) interconsulta e (6) indicaciones
INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'5 Interconsulta', CONCAT(N'Interconsulta ', o.NU_NUME_HOTA), v.k, v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  JOIN dbo.HIST_ORTIAT o ON o.NU_NUME_HICL_HOTA = h.id
  LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = o.CD_CODI_ESP_HOTA
 CROSS APPLY (VALUES
       (1, N'Número',                   CAST(o.NU_NUME_HOTA AS nvarchar(max)),               N'HIST_ORTIAT.NU_NUME_HOTA', N'confirmar'),
       (2, N'Especialidad',             CONCAT(o.CD_CODI_ESP_HOTA, N' ', e.NO_NOMB_ESP),      N'HIST_ORTIAT.CD_CODI_ESP_HOTA → ESPECIALIDADES', N'confirmar'),
       (3, N'Tipo / vía / estado',      CONCAT(o.NU_TIPO_HOTA, N' / ', o.NU_VIA_HOTA, N' / ', o.NU_ESTADO_HOTA), N'HIST_ORTIAT.NU_TIPO_HOTA / NU_VIA_HOTA / NU_ESTADO_HOTA', N'confirmar'),
       (4, N'Observación',              LEFT(CAST(o.ME_OBSER_HOTA AS varchar(max)), 1000),    N'HIST_ORTIAT.ME_OBSER_HOTA', N'confirmar'),
       (5, N'Historia que la atendió',  CAST(o.NU_HICL_ORD_HOTA AS nvarchar(max)),            N'HIST_ORTIAT.NU_HICL_ORD_HOTA', N'confirmar')
     ) v (k, etiqueta, valor, sale_de, seguro);

INSERT #doc (historia, documento, numero, orden_campo, etiqueta, valor, sale_de, seguro)
SELECT h.id, N'6 Indicaciones de manejo', CONCAT(N'Indicaciones ', i.NU_NUME_HIND), v.k, v.etiqueta, v.valor, v.sale_de, v.seguro
  FROM #hcp h
  JOIN dbo.HIST_INDI i ON i.NU_NUME_HICL_HIND = h.id
 CROSS APPLY (VALUES
       (1, N'Orden Nº',     CAST(i.NU_NUME_HIND AS nvarchar(max)),               N'HIST_INDI.NU_NUME_HIND', N'visto'),
       (2, N'Indicaciones', LEFT(CAST(i.DE_DESC_HIND AS varchar(max)), 2000),    N'HIST_INDI.DE_DESC_HIND', N'visto')
     ) v (k, etiqueta, valor, sale_de, seguro);

SELECT N'Q-6' AS bloque, historia, documento, numero, etiqueta, valor, sale_de, seguro
  FROM #doc
 ORDER BY historia, documento, numero, orden_campo;
GO

SET NOEXEC OFF;
GO

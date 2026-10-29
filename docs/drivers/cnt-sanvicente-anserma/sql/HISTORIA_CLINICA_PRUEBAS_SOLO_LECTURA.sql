/* =============================================================================
   HISTORIA CLÍNICA → RESUMEN DE LA ATENCIÓN · PRUEBAS EN «PRUEBAS»
   SOLO LECTURA · Base: PRUEBAS (en cualquier otra base el script se detiene)
   =============================================================================

   Plan: docs/PLAN_RESUMEN_ATENCION.md (cierra la Fase 0). Mapeo: MAPEO_HIS.md §2.9.

   Para qué: con atenciones de prueba que un médico hace en la aplicación del
   HIS, comprobar que el resumen que armaría AgenIA dice exactamente lo que el
   médico escribió, y medir lo que todavía es hipótesis:
     · que la historia se guarda una vez y las órdenes llegan minutos después
       (regla «2 horas después de guardada», D9);
     · qué pasa cuando el médico corrige una historia o anula un medicamento
       (D10: ¿cambia el resumen? ¿lo registra la auditoría del HIS?);
     · qué cambia cuando farmacia entrega un medicamento (NU_ESTA_HMED = 2);
     · que las reglas de alcance, exclusión y destinatario (D1, D5, D6, D7,
       D17) deciden bien en cada caso;
     · cuánto le cuesta al HIS la consulta del agente;
     · la lista exacta de columnas que TI tendría que permitirle a agenia_sync.

   ─────────────────────────────────────────────────────────────────────────────
   PROTOCOLO (lo hace el hospital en la aplicación, conectada a PRUEBAS)
   ─────────────────────────────────────────────────────────────────────────────
   Pacientes de PRUEBA, nunca reales: el PRIMER APELLIDO debe contener
   «PRUEBA» (el script no lee a ningún otro). Se necesitan tres:
     · Adulto 1 con un celular y un correo del equipo de sistemas;
     · Adulto 2 con el correo de relleno «pacienteshospital@gmail.com»;
     · un menor (tarjeta de identidad) con acompañante que tenga celular.
   Anotar en una hoja la HORA EXACTA de cada paso (inicio, guardado, cada
   orden, cada corrección). Se compara con lo que registra la base.

   E1  Adulto 1 · medicina general (servicio S39141, plantilla «CONSULTA
       EXTERNA»), completa:
         · motivo de consulta; diagnóstico principal y uno relacionado;
         · plan en «CONDUCTA → Anotaciones»; recomendaciones (indicaciones);
         · medicamentos: dos de la farmacia del hospital (uno por 90 días, para
           que salgan las entregas posfechadas) y uno externo; en el externo
           escribir una indicación DISTINTA de la dosis estructurada (p. ej.
           «tomar 1 y media al almuerzo» con dosis «1 cada 24 horas»);
         · dos laboratorios, un procedimiento (p. ej. electrocardiograma), una
           remisión y una incapacidad de 3 días.
       Guardar. 10 minutos después, agregar UN examen más a esa historia.
   E2  Adulto 1 · control de hipertensos (S39141-1, plantilla «CONTROL
       CRÓNICOS»): conducta, próximo control, metas de educación, marcar
       «Dieta hiposódica» y «Aumento del ejercicio», fórmula de 90 días.
   E3  Corrección de E1. Correr TODO el script (F5) y guardar el resultado de
       P-4. Luego, en la aplicación, corregir el plan de E1 como lo permita el
       HIS (editar o nota aclaratoria) y anular uno de sus medicamentos.
       Correr TODO el script otra vez y comparar P-4.
   E4  Farmacia de PRUEBAS: entregar uno de los medicamentos de la farmacia
       del hospital de E1. Correr el script y mirar P-2 (c), P-3 y P-4.
   E5  Adulto 2 · tres atenciones que NO deben enviarse:
         (a) consulta de urgencias (S39145);
         (b) consulta de psicología;
         (c) medicina general con diagnóstico F41.2 (u otro de salud mental).
   E6  Menor · consulta de medicina general.
   E7  Imprimir desde el HIS la fórmula y las órdenes de E1 (el papel que
       recibe el paciente) para compararlas con P-2.

   ─────────────────────────────────────────────────────────────────────────────
   CÓMO CORRERLO
   ─────────────────────────────────────────────────────────────────────────────
     1. SSMS, ventana NUEVA conectada a PRUEBAS. En P-0, escribir los
        documentos de los pacientes de prueba (y la fecha si no es hoy).
     2. F5 con todo. Los bloques usan las tablas # que dejan P-0 y P-1.
     3. P-6 deja su resultado en la pestaña «Mensajes» de SSMS: copiarla.
     4. Devolver un mensaje por bloque (el chat corta en ~50.000 caracteres).
        Aquí SÍ sale texto clínico, pero solo de los pacientes de PRUEBA.

   QUÉ HACE Y QUÉ NO HACE
     · Solo lee la base. Escribe únicamente en tablas temporales (#), que se
       borran al cerrar la ventana. No ejecuta procedimientos del HIS.
     · P-7 ARMA el texto de los permisos para que TI lo revise. No lo ejecuta.
     · Las tablas # con texto usan COLLATE DATABASE_DEFAULT: si tempdb tiene otra
       intercalación que PRUEBAS, los cruces no fallan.
   ============================================================================= */

SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 10000;
GO

-- =============================================================================
-- P-0 · Configuración (OBLIGATORIO, PRIMERO)
-- =============================================================================
IF DB_NAME() <> N'PRUEBAS'
BEGIN
    RAISERROR(N'Estas pruebas solo corren en PRUEBAS. Cambia la base de la ventana (USE PRUEBAS) y vuelve a correr. No se ejecutó nada.', 16, 1);
    SET NOEXEC ON;   -- detiene el resto del script (lo apaga la última línea)
END;
GO

-- (1) Documentos de los pacientes de PRUEBA ← EDITAR (en este HIS, historia = documento)
IF OBJECT_ID('tempdb..#pruebas') IS NOT NULL DROP TABLE #pruebas;
CREATE TABLE #pruebas (documento varchar(20) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY, valido bit NULL, motivo nvarchar(200) NULL);
INSERT #pruebas (documento) VALUES
    ('');                         -- p. ej. ('900000001'), ('900000002'), ('900000003')

-- (2) Desde cuándo buscar las atenciones de prueba ← EDITAR si no fueron hoy
IF OBJECT_ID('tempdb..#cfg') IS NOT NULL DROP TABLE #cfg;
CREATE TABLE #cfg (desde datetime NOT NULL);
INSERT #cfg VALUES (CAST(CAST(GETDATE() AS date) AS datetime));   -- p. ej. ('2026-11-04')

-- (3) Alcance del envío (D1): servicios que reciben resumen. Piloto = medicina general + hipertensos
IF OBJECT_ID('tempdb..#alcance') IS NOT NULL DROP TABLE #alcance;
CREATE TABLE #alcance (servicio varchar(12) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY);
INSERT #alcance VALUES ('S39141'), ('S39141-1');

-- (4) Correos de relleno del hospital (D17): nunca se les envía
IF OBJECT_ID('tempdb..#relleno') IS NOT NULL DROP TABLE #relleno;
CREATE TABLE #relleno (correo varchar(100) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY);
INSERT #relleno VALUES ('pacienteshospital@gmail.com'), ('hsvpanserma@hotmail.com'), ('pacientesanserma@gmail.com');

-- (5) Campos de la plantilla que van al resumen (D2), con los nombres exactos de
--     ESEHSVP (ronda 4, R4-5). plantilla = NU_NUME_PLHI; grupo NULL = cualquiera.
IF OBJECT_ID('tempdb..#campos_resumen') IS NOT NULL DROP TABLE #campos_resumen;
CREATE TABLE #campos_resumen (plantilla int NOT NULL, grupo nvarchar(200) COLLATE DATABASE_DEFAULT NULL,
                              campo nvarchar(200) COLLATE DATABASE_DEFAULT NOT NULL, seccion nvarchar(60) NOT NULL);
INSERT #campos_resumen VALUES
    -- 870 CONSULTA EXTERNA (medicina general)
    (870, N'MOTIVO DE CONSULTA',                 N'MC:',                                         N'Motivo'),
    (870, N'CONDUCTA',                           N'Anotaciones',                                 N'Plan'),
    (870, N'EDUCACION.',                         N'Acerca de:',                                  N'Educación'),
    -- 844 CONTROL CRÓNICOS (hipertensos y diabéticos)
    (844, N'MOTIVO DE CONSULTA',                 N'-',                                           N'Motivo'),
    (844, N'CONDUCTA',                           N'Conducta',                                    N'Plan'),
    (844, N'CONDUCTA',                           N'Proximo control*',                            N'Próximo control'),
    (844, N'EDUCACIÓN',                          N'Metas de educacion para el proximo control',  N'Metas'),
    (844, N'EDUCACIÓN',                          N'Dieta hiposódica',                            N'Educación (casilla)'),
    (844, N'EDUCACIÓN',                          N'Dieta hipograsa',                             N'Educación (casilla)'),
    (844, N'EDUCACIÓN',                          N'Dieta hipoglucida',                           N'Educación (casilla)'),
    (844, N'EDUCACIÓN',                          N'Aumento del ejercicio',                       N'Educación (casilla)'),
    (844, N'EDUCACIÓN',                          N'Disminución de peso',                         N'Educación (casilla)'),
    (844, N'EDUCACIÓN',                          N'Disminucion del tabaquismo',                  N'Educación (casilla)'),
    (844, N'ANÁLISIS',                           N'HTA/DM CONTROLADA',                           N'¿Controlada?'),
    -- 858 Medicina interna y 899 Ginecología
    (858, N'MOTIVO CONSULTA Y ENFERMEDAD ACTUAL', N'Motivo de la Consulta',                      N'Motivo'),
    (858, N'EXAMEN FISICO GENERAL',              N'Análisis y Plan',                             N'Plan'),
    (899, N'MOTIVO CONSULTA Y ENFERMEDAD ACTUAL', N'Motivo de la Consulta',                      N'Motivo'),
    (899, N'EXAMEN FISICO GENERAL',              N'Análisis y Plan',                             N'Plan'),
    -- 907 Nutrición
    (907, N'MOTIVO CONSULTA',                    N'Motivo de la Consulta',                       N'Motivo'),
    (907, N'RECOMENDACIONES Y OBSERVACIONES',    N'Recomendaciones',                             N'Recomendaciones'),
    (907, N'RECOMENDACIONES Y OBSERVACIONES',    N'Observaciones',                               N'Recomendaciones'),
    (907, N'RECOMENDACIONES Y OBSERVACIONES',    N'Próximo Control:',                            N'Próximo control'),
    -- 843 y 860 Primera infancia / infancia
    (843, NULL,                                  N'Recomendaciones de alimentación',             N'Recomendaciones'),
    (843, NULL,                                  N'Recomendaciones de estimulacion',             N'Recomendaciones'),
    (843, NULL,                                  N'Recomendaciones y Observaciones',             N'Recomendaciones'),
    (843, N'Proximo control',                    N'Hora.',                                       N'Próximo control'),
    (860, NULL,                                  N'Recomendaciones de alimentación',             N'Recomendaciones'),
    (860, NULL,                                  N'Recomendaciones de estimulacion',             N'Recomendaciones'),
    (860, NULL,                                  N'Recomendaciones y Observaciones',             N'Recomendaciones'),
    (860, N'Proximo control',                    N'Hora.',                                       N'Próximo control'),
    -- 849 y 862 PyDT adultez / vejez
    (849, NULL,                                  N'Recomendaciones/Signos alarma/Plan cuidado',  N'Recomendaciones'),
    (862, NULL,                                  N'Recomendaciones/Signos alarma/Plan cuidado',  N'Recomendaciones');

-- (6) Validar que cada documento es de un paciente de PRUEBA (escribe solo en #pruebas)
UPDATE p
   SET valido = CASE WHEN pa.NU_HIST_PAC IS NOT NULL AND UPPER(ISNULL(pa.DE_PRAP_PAC, '')) LIKE '%PRUEBA%' THEN 1 ELSE 0 END,
       motivo = CASE WHEN p.documento = '' THEN N'documento vacío: escríbelo en P-0'
                     WHEN pa.NU_HIST_PAC IS NULL THEN N'no existe en PACIENTES de PRUEBAS'
                     WHEN UPPER(ISNULL(pa.DE_PRAP_PAC, '')) LIKE '%PRUEBA%' THEN N'paciente de prueba'
                     ELSE N'RECHAZADO: su primer apellido no contiene PRUEBA (¿paciente real?)' END
  FROM #pruebas p
  LEFT JOIN dbo.PACIENTES pa ON pa.NU_HIST_PAC = p.documento;

SELECT N'P-0' AS bloque, p.documento, CASE WHEN p.valido = 1 THEN N'SI' ELSE N'NO' END AS se_usa, p.motivo,
       CASE WHEN p.valido = 1 THEN (CONVERT(int, CONVERT(char(8), GETDATE(), 112)) - CONVERT(int, CONVERT(char(8), pa.FE_NACI_PAC, 112))) / 10000 END AS edad
  FROM #pruebas p
  LEFT JOIN dbo.PACIENTES pa ON pa.NU_HIST_PAC = p.documento;
IF NOT EXISTS (SELECT 1 FROM #pruebas WHERE valido = 1)
    RAISERROR(N'P-0: ningún paciente de prueba válido. P-1 a P-5 no devolverán nada.', 10, 1);
GO

-- =============================================================================
-- P-1 · Las historias de los pacientes de prueba
--
-- Deja #hcp (las historias) y #valores (los campos de su plantilla) para los
-- bloques siguientes. «padre» lleno = evolución o corrección de otra historia.
-- =============================================================================
IF DB_NAME() <> N'PRUEBAS' OR OBJECT_ID('tempdb..#pruebas') IS NULL
BEGIN RAISERROR(N'Corre primero P-0 en esta misma ventana, conectada a PRUEBAS.', 16, 1); RETURN; END;
DECLARE @desde datetime = (SELECT desde FROM #cfg);

IF OBJECT_ID('tempdb..#hcp') IS NOT NULL DROP TABLE #hcp;
SELECT h.NU_NUME_HICL AS id, LTRIM(RTRIM(h.NU_HIST_PAC_HICL)) AS pac, h.FE_FECH_HICL AS fecha,
       h.TX_TIPO_HICL AS tipo, h.NU_ESTA_HICL AS estado, h.TX_CODSER_HICL AS ser,
       h.NU_AUTO_DAPL_HICL AS dapl, h.NU_NUME_LABO_HICL AS labo, h.NU_NUME_REG_HICL AS reg,
       h.NU_NUME_PADR_HICL AS padre, h.CD_MED_REAL_HICL AS med,
       CASE WHEN ISNULL(h.NU_NUME_REG_HICL, 0) = 0 THEN 1 ELSE 0 END AS amb,
       r.NU_NUME_PLHI_RPET AS plhi
  INTO #hcp
  FROM dbo.HISTORIACLINICA h
  LEFT JOIN dbo.DATOS_PLANTILLA dp ON dp.NU_AUTO_DAPL = h.NU_AUTO_DAPL_HICL
  LEFT JOIN dbo.R_PLAN_ESP_TIAT r  ON r.NU_NUME_RPET = dp.NU_NUME_RPET_DAPL
 WHERE h.NU_HIST_PAC_HICL IN (SELECT documento FROM #pruebas WHERE valido = 1)
   AND h.FE_FECH_HICL >= @desde;

IF OBJECT_ID('tempdb..#valores') IS NOT NULL DROP TABLE #valores;
CREATE TABLE #valores (id int, plhi int, indi int, clase varchar(5), valor nvarchar(max));
INSERT #valores SELECT h.id, h.plhi, t.NU_INDI_DPTE, 'TEXT', CAST(t.TX_DESC_DPTE AS nvarchar(max))
                  FROM #hcp h JOIN dbo.DATOS_PLANTILLA_TEXT t ON t.NU_AUTO_DAPL_DPTE = h.dapl;
INSERT #valores SELECT h.id, h.plhi, t.NU_INDI_DPME, 'MEMO', CAST(CAST(t.TX_DESC_DPME AS varchar(max)) AS nvarchar(max))
                  FROM #hcp h JOIN dbo.DATOS_PLANTILLA_MEMO t ON t.NU_AUTO_DAPL_DPME = h.dapl;
INSERT #valores SELECT h.id, h.plhi, t.NU_INDI_DPNU, 'NUME', CAST(t.NU_DESC_DPNU AS nvarchar(40))
                  FROM #hcp h JOIN dbo.DATOS_PLANTILLA_NUME t ON t.NU_AUTO_DAPL_DPNU = h.dapl;
INSERT #valores SELECT h.id, h.plhi, t.NU_INDI_DPDA, 'DATE', CONVERT(nvarchar(30), t.FE_DESC_DPDA, 120)
                  FROM #hcp h JOIN dbo.DATOS_PLANTILLA_DATE t ON t.NU_AUTO_DAPL_DPDA = h.dapl;

SELECT h.id AS historia, h.pac AS paciente, h.fecha AS guardada, h.tipo, h.estado, h.ser AS servicio,
       s.NO_NOMB_SER AS nombre_servicio, e.NO_NOMB_ESP AS especialidad, h.plhi AS plantilla, p.TX_DESC_PLHI AS nombre_plantilla,
       m.NO_NOMB_MED AS medico, m.DE_REGI_MED AS registro_medico,
       CASE WHEN h.amb = 1 THEN N'ambulatoria' ELSE N'con registro de ingreso' END AS ambito,
       h.padre AS historia_padre,
       (SELECT COUNT(*) FROM #valores v WHERE v.id = h.id) AS campos_con_valor
  FROM #hcp h
  LEFT JOIN dbo.SERVICIOS s      ON s.CD_CODI_SER = h.ser
  LEFT JOIN dbo.LABORATORIO l    ON l.NU_NUME_LABO = h.labo
  LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = l.CD_CODI_ESP_LABO
  LEFT JOIN dbo.PLANTILLA_HIST p ON p.NU_NUME_PLHI = h.plhi
  LEFT JOIN dbo.MEDICOS m        ON m.CD_CODI_MED = h.med
 ORDER BY h.fecha;
GO

-- =============================================================================
-- P-2 · El resumen tal como lo armaría AgenIA (prototipo de la consulta del agente)
--
-- (a) diagnósticos; (b) medicamentos, uno por artículo, con sus entregas;
-- (c) los renglones crudos de la fórmula (anulados, entregados, sin unidad de venta);
-- (d) exámenes y procedimientos; (e) recomendaciones; (f) incapacidad,
-- remisión e interconsulta; (g) campos de la plantilla, marcando cuáles irían.
-- Comparar con la pantalla del HIS y con el papel impreso (E7).
-- =============================================================================
IF DB_NAME() <> N'PRUEBAS' OR OBJECT_ID('tempdb..#hcp') IS NULL
BEGIN RAISERROR(N'Corre primero P-0 y P-1 en esta misma ventana.', 16, 1); RETURN; END;

-- (a)
SELECT h.id AS historia, d.CD_CODI_DIAG_RLAD AS cie10, dg.DE_DESC_DIAG AS diagnostico,
       td.DE_DESC_TIDI AS tipo_diagnostico, d.ID_TIPO_RLAD AS principal_o_relacionado,
       CASE WHEN d.CD_CODI_DIAG_RLAD LIKE 'B2[0-4]%' OR d.CD_CODI_DIAG_RLAD LIKE 'Z21%' OR d.CD_CODI_DIAG_RLAD LIKE 'F%'
              OR d.CD_CODI_DIAG_RLAD LIKE 'T74%' OR d.CD_CODI_DIAG_RLAD LIKE 'T76%' OR d.CD_CODI_DIAG_RLAD LIKE 'Y0[5-7]%'
              OR d.CD_CODI_DIAG_RLAD LIKE 'Z044%' OR d.CD_CODI_DIAG_RLAD LIKE 'Z045%' OR d.CD_CODI_DIAG_RLAD LIKE 'O04%'
              OR d.CD_CODI_DIAG_RLAD LIKE 'A5[0-9]%' OR d.CD_CODI_DIAG_RLAD LIKE 'A6[0-4]%' THEN N'SENSIBLE (D7)' ELSE N'' END AS sensible
  FROM #hcp h
  JOIN dbo.R_LABO_DIAG d           ON d.NU_NUME_LABO_RLAD = h.labo
  LEFT JOIN dbo.DIAGNOSTICO dg     ON dg.CD_CODI_DIAG = d.CD_CODI_DIAG_RLAD
  LEFT JOIN dbo.TIPODIAGNOSTICO td ON td.ID_CODI_TIDI = d.ID_TIPO_DIAG_RLAD
 ORDER BY h.id, d.ID_TIPO_RLAD;

-- (b) un renglón por medicamento: lo que vería el paciente
SELECT h.id AS historia,
       m.CD_CODI_ARTI_HMED                                        AS articulo,
       MAX(m.NO_NOMB_ARTI_HMED)                                   AS medicamento,
       MAX(m.TX_FOFA_HMED)                                        AS forma,
       MAX(m.TX_VIAD_HMED)                                        AS via,
       MAX(o.TX_TIAP_HORD)                                        AS ai_o_ae,
       COUNT(DISTINCT o.TX_TIAP_HORD)                             AS tipos_distintos,
       SUM(m.NU_CANT_HMED)                                        AS cantidad_total,
       MAX(m.TX_DURA_HMED)                                        AS duracion_dias,
       MAX(m.TX_INDDOS_HMED)                                      AS indicacion_del_medico,
       COUNT(DISTINCT m.TX_INDDOS_HMED)                           AS indicaciones_distintas,
       MAX(CONCAT(N'cada ', m.NU_CTFREC_HMED, N' ', f.TX_DESC_CONF_HIS)) AS frecuencia_estructurada,
       STRING_AGG(CAST(CONVERT(char(10), ISNULL(o.FE_POSFECHA, h.fecha), 23) AS nvarchar(max)), N', ')
           WITHIN GROUP (ORDER BY ISNULL(o.FE_POSFECHA, h.fecha)) AS entregas_desde,
       COUNT(*)                                                   AS renglones
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI  m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
  LEFT JOIN dbo.PAC_CONFIG_HIS f ON f.TX_CODI_CONF_HIS = m.TX_CDFREC_HMED AND f.NU_TIPO_CONF_HIS = 37
 WHERE ISNULL(m.NU_ESTA_HMED, 0) <> 0          -- solo se quitan los anulados; los externos (AE) sin unidad de venta SÍ van
 GROUP BY h.id, m.CD_CODI_ARTI_HMED
 ORDER BY h.id, medicamento;

-- (c) renglones crudos de la fórmula, sin filtros
SELECT h.id AS historia, o.NU_AUTO_HORD AS orden, o.TX_TIAP_HORD AS ai_o_ae, o.FE_FECH_HORD AS orden_escrita,
       o.FE_POSFECHA AS posfecha, o.NU_ORDEN_FECHAPOS AS serie, m.NU_NUME_HMED AS renglon, m.NO_NOMB_ARTI_HMED AS medicamento,
       m.NU_CANT_HMED AS cantidad, m.NU_ESTA_HMED AS estado, m.NU_NUME_FORM_HMED AS formula_farmacia,
       m.NU_AUTO_UNVE_HMED AS unidad_venta,
       CASE WHEN ISNULL(m.NU_ESTA_HMED, 0) = 0 THEN N'no va: anulado'
            WHEN m.NU_AUTO_UNVE_HMED IS NULL THEN N'va (el RDA lo quitaría: sin unidad de venta)' ELSE N'va' END AS en_el_resumen,
       LEFT(CAST(m.DE_DOSIS_HMED AS varchar(max)), 120) AS dosis_que_arma_el_his,
       m.TX_INDDOS_HMED AS indicacion_del_medico, m.NU_CTDSIS_HMED AS dosis_cant, m.TX_UMDSIS_HMED AS dosis_unidad,
       m.NU_CTFREC_HMED AS cada, m.TX_CDFREC_HMED AS unidad_frecuencia, m.TX_DURA_HMED AS duracion
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5
  JOIN dbo.HIST_MEDI  m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
 ORDER BY h.id, o.NU_AUTO_HORD, m.NU_NUME_HMED;

-- (d)
SELECT h.id AS historia, o.NU_AUTO_HORD AS orden, o.NU_TIPO_HORD AS tipo_orden,
       CASE o.NU_TIPO_HORD WHEN 1 THEN N'Consulta o control' WHEN 2 THEN N'Laboratorio' WHEN 3 THEN N'Cirugía'
                           WHEN 4 THEN N'Procedimiento o ayuda diagnóstica' ELSE N'Otro' END AS clase,
       p.CD_CODI_SER_HPRO AS codigo, s.NO_NOMB_SER AS examen, p.NU_CANT_HPRO AS cantidad,
       LEFT(CAST(p.DE_INDI_HPRO AS varchar(max)), 300) AS indicacion, p.NU_ESTA_HPRO AS estado,
       o.FE_FECH_HORD AS orden_escrita, DATEDIFF(minute, h.fecha, o.FE_FECH_HORD) AS minutos_despues_de_guardar,
       o.FE_POSFECHA AS posfecha, LEFT(CAST(o.ME_OBSERV_HORD AS varchar(max)), 300) AS observacion_de_la_orden
  FROM #hcp h
  JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD IN (1, 2, 3, 4)
  JOIN dbo.HIST_PROC  p ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
  LEFT JOIN dbo.SERVICIOS s ON s.CD_CODI_SER = p.CD_CODI_SER_HPRO
 ORDER BY h.id, o.NU_TIPO_HORD, examen;

-- (e)
SELECT h.id AS historia, LEFT(CAST(i.DE_DESC_HIND AS varchar(max)), 2000) AS recomendaciones
  FROM #hcp h
  JOIN dbo.HIST_INDI i ON i.NU_NUME_HICL_HIND = h.id
 ORDER BY h.id;

-- (f)
SELECT h.id AS historia, N'Incapacidad' AS que,
       CONCAT(i.NU_DIAS_HINC, N' días desde ', CONVERT(char(10), i.FE_INIC_HINC, 23)) AS detalle,
       CAST(i.TX_TIPO_HINC AS nvarchar(255)) AS tipo, LEFT(CAST(i.DE_DESC_HINC AS varchar(max)), 300) AS texto
  FROM #hcp h JOIN dbo.HIST_INCA i ON i.NU_NUME_HICL_HINC = h.id
UNION ALL
SELECT h.id, N'Remisión', CONCAT(r.TX_SERV_HREM, N' · prioridad ', r.TX_PRIO_HREM, N' · ', CONVERT(char(10), r.FE_FECHA_HREM, 23)),
       CAST(r.DE_REMI_HREM AS nvarchar(255)), LEFT(CAST(r.DE_DESC_HREM AS varchar(max)), 300)
  FROM #hcp h JOIN dbo.HIST_REMI r ON r.NU_NUME_HICL_HREM = h.id
UNION ALL
SELECT h.id, N'Interconsulta', CONCAT(e.NO_NOMB_ESP, N' · estado ', o.NU_ESTADO_HOTA), CAST(o.NU_TIPO_HOTA AS nvarchar(255)),
       LEFT(CAST(o.ME_OBSER_HOTA AS varchar(max)), 300)
  FROM #hcp h JOIN dbo.HIST_ORTIAT o ON o.NU_NUME_HICL_HOTA = h.id
  LEFT JOIN dbo.ESPECIALIDADES e ON e.CD_CODI_ESP = o.CD_CODI_ESP_HOTA
 ORDER BY historia, que;

-- (g) todos los campos de la plantilla con valor; «va_al_resumen_como» según #campos_resumen
SELECT v.id AS historia, v.plhi AS plantilla, p.TX_DESC_PLHI AS nombre_plantilla, g.CD_CODI_GRHI AS grupo,
       c.CD_CODI_COHI AS campo, v.clase, ISNULL(cr.seccion, N'') AS va_al_resumen_como,
       LEFT(v.valor, 1500) AS valor
  FROM #valores v
  LEFT JOIN dbo.R_PLAN_CONC rc   ON rc.NU_NUME_PLHI_RPC = v.plhi AND rc.NU_INDI_RPC = v.indi
  LEFT JOIN dbo.CONCEPTO_HIST c  ON c.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
  LEFT JOIN dbo.GRUPO_HIST g     ON g.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC
  LEFT JOIN dbo.PLANTILLA_HIST p ON p.NU_NUME_PLHI = v.plhi
  OUTER APPLY (SELECT TOP (1) k.seccion FROM #campos_resumen k
                WHERE k.plantilla = v.plhi AND (k.grupo IS NULL OR k.grupo = g.CD_CODI_GRHI) AND k.campo = c.CD_CODI_COHI) cr
 ORDER BY v.id, CASE WHEN cr.seccion IS NULL THEN 1 ELSE 0 END, v.indi;
GO

-- =============================================================================
-- P-3 · Tiempos y auditoría: ¿la historia se guarda una vez y las órdenes llegan después?
--
-- (a) por historia: cuándo se guardó y cuándo se escribió cada orden;
-- (b) qué tablas registró la auditoría del HIS para los pacientes de prueba,
--     por operación (1 = inserción, 2 = cambio, 3 = borrado);
-- (c) el detalle, en orden de hora. Comparar con la hoja de horas.
-- La auditoría guarda la sentencia completa: se busca el documento del
-- paciente o el número de cualquiera de sus historias.
-- =============================================================================
IF DB_NAME() <> N'PRUEBAS' OR OBJECT_ID('tempdb..#hcp') IS NULL
BEGIN RAISERROR(N'Corre primero P-0 y P-1 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @desde datetime = (SELECT desde FROM #cfg);

-- (a)
SELECT h.id AS historia, h.tipo, h.fecha AS guardada,
       COUNT(o.NU_AUTO_HORD) AS ordenes,
       MIN(o.FE_FECH_HORD) AS primera_orden, MAX(o.FE_FECH_HORD) AS ultima_orden,
       DATEDIFF(minute, h.fecha, MIN(o.FE_FECH_HORD)) AS min_a_la_primera,
       DATEDIFF(minute, h.fecha, MAX(o.FE_FECH_HORD)) AS min_a_la_ultima,
       DATEADD(hour, 2, h.fecha) AS lista_para_enviar_desde
  FROM #hcp h
  LEFT JOIN dbo.HIST_ORDEN o ON o.NU_NUME_HICL_HORD = h.id
 GROUP BY h.id, h.tipo, h.fecha
 ORDER BY h.fecha;

IF OBJECT_ID(N'dbo.AUDITOR') IS NULL
BEGIN
    SELECT N'P-3 (b, c): no existe dbo.AUDITOR.' AS aviso;
    RETURN;
END;

IF OBJECT_ID('tempdb..#aud') IS NOT NULL DROP TABLE #aud;
SELECT a.AudFech, a.AudTabla, a.AudTrans, a.AudUser, a.AudVerExe, CAST(a.AudDesc AS varchar(max)) AS AudDesc
  INTO #aud
  FROM dbo.AUDITOR a
 WHERE a.AudFech >= @desde
   AND (EXISTS (SELECT 1 FROM #pruebas p WHERE p.valido = 1 AND CAST(a.AudDesc AS varchar(max)) LIKE '%' + p.documento + '%')
        OR EXISTS (SELECT 1 FROM #hcp h WHERE CAST(a.AudDesc AS varchar(max)) LIKE '%' + CAST(h.id AS varchar(12)) + '%'))
OPTION (MAXDOP 1);

-- (b)
SELECT AudTabla AS tabla,
       CASE AudTrans WHEN '1' THEN N'1 inserción' WHEN '2' THEN N'2 cambio' WHEN '3' THEN N'3 borrado' ELSE AudTrans END AS operacion,
       COUNT(*) AS filas, MIN(AudFech) AS primera, MAX(AudFech) AS ultima
  FROM #aud
 GROUP BY AudTabla, AudTrans
 ORDER BY MIN(AudFech);

-- (c)
SELECT AudFech AS hora, AudTabla AS tabla, AudTrans AS operacion, AudUser AS usuario, AudVerExe AS version,
       LEFT(AudDesc, 400) AS descripcion
  FROM #aud
 ORDER BY AudFech;
GO

-- =============================================================================
-- P-4 · Huella del resumen (correr el script completo ANTES y DESPUÉS de E3)
--
-- Un SHA-256 de todo lo que iría en el resumen de cada historia: medicamentos,
-- exámenes, recomendaciones, remisión, incapacidad y los campos de la
-- plantilla que van al resumen. Si cambia entre las dos corridas, la
-- corrección cambia lo que vería el paciente y el enlace debe decir
-- «actualizado el …» (D10). Si no cambia, la corrección no toca el resumen.
-- «huella_de_estados» mira solo los estados (entrega de farmacia, toma del
-- examen): tras E4 debe cambiar ella y NO la del resumen.
-- =============================================================================
IF DB_NAME() <> N'PRUEBAS' OR OBJECT_ID('tempdb..#valores') IS NULL
BEGIN RAISERROR(N'Corre primero P-0 y P-1 en esta misma ventana.', 16, 1); RETURN; END;

SELECT h.id AS historia, h.fecha AS guardada, GETDATE() AS medida_a_las,
       (SELECT COUNT(*) FROM dbo.HIST_ORDEN o JOIN dbo.HIST_MEDI m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
         WHERE o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5) AS renglones_medicamento,
       (SELECT COUNT(*) FROM dbo.HIST_ORDEN o JOIN dbo.HIST_PROC p ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
         WHERE o.NU_NUME_HICL_HORD = h.id) AS renglones_examen,
       CONVERT(varchar(64), HASHBYTES('SHA2_256', CONCAT(
           (SELECT STRING_AGG(CAST(CONCAT(m.NU_NUME_HMED, N'|', m.CD_CODI_ARTI_HMED, N'|', m.NU_CANT_HMED, N'|', m.TX_INDDOS_HMED, N'|',
                                          CASE WHEN ISNULL(m.NU_ESTA_HMED, 0) = 0 THEN N'oculto' ELSE N'visible' END,
                                          N'|', m.TX_DURA_HMED, N'|', o.FE_POSFECHA) AS nvarchar(max)), N';')
                       WITHIN GROUP (ORDER BY m.NU_NUME_HMED)
              FROM dbo.HIST_ORDEN o JOIN dbo.HIST_MEDI m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
             WHERE o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5),
           N'#',
           (SELECT STRING_AGG(CAST(CONCAT(p.NU_NUME_HPRO, N'|', p.CD_CODI_SER_HPRO, N'|', p.NU_CANT_HPRO,
                                          N'|', CAST(p.DE_INDI_HPRO AS varchar(max))) AS nvarchar(max)), N';')
                       WITHIN GROUP (ORDER BY p.NU_NUME_HPRO)
              FROM dbo.HIST_ORDEN o JOIN dbo.HIST_PROC p ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
             WHERE o.NU_NUME_HICL_HORD = h.id),
           N'#',
           (SELECT STRING_AGG(CAST(CAST(i.DE_DESC_HIND AS varchar(max)) AS nvarchar(max)), N';') FROM dbo.HIST_INDI i WHERE i.NU_NUME_HICL_HIND = h.id),
           N'#',
           (SELECT STRING_AGG(CAST(CONCAT(r.TX_SERV_HREM, N'|', r.TX_PRIO_HREM, N'|', r.DE_REMI_HREM) AS nvarchar(max)), N';') FROM dbo.HIST_REMI r WHERE r.NU_NUME_HICL_HREM = h.id),
           N'#',
           (SELECT STRING_AGG(CAST(CONCAT(i.NU_DIAS_HINC, N'|', i.FE_INIC_HINC) AS nvarchar(max)), N';') FROM dbo.HIST_INCA i WHERE i.NU_NUME_HICL_HINC = h.id),
           N'#',
           (SELECT STRING_AGG(CAST(CONCAT(v.indi, N'|', v.valor) AS nvarchar(max)), N';') WITHIN GROUP (ORDER BY v.indi)
              FROM #valores v
              JOIN dbo.R_PLAN_CONC rc  ON rc.NU_NUME_PLHI_RPC = v.plhi AND rc.NU_INDI_RPC = v.indi
              JOIN dbo.CONCEPTO_HIST c ON c.NU_NUME_COHI = rc.NU_NUME_COHI_RPC
              JOIN dbo.GRUPO_HIST g    ON g.NU_NUME_GRHI = rc.NU_NUME_GRHI_RPC
             WHERE v.id = h.id
               AND EXISTS (SELECT 1 FROM #campos_resumen k
                            WHERE k.plantilla = v.plhi AND (k.grupo IS NULL OR k.grupo = g.CD_CODI_GRHI) AND k.campo = c.CD_CODI_COHI))
       )), 2) AS huella_del_resumen,
       CONVERT(varchar(64), HASHBYTES('SHA2_256', CONCAT(
           (SELECT STRING_AGG(CAST(CONCAT(m.NU_NUME_HMED, N'|', m.NU_ESTA_HMED, N'|', m.NU_NUME_FORM_HMED) AS nvarchar(max)), N';')
                       WITHIN GROUP (ORDER BY m.NU_NUME_HMED)
              FROM dbo.HIST_ORDEN o JOIN dbo.HIST_MEDI m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
             WHERE o.NU_NUME_HICL_HORD = h.id AND o.NU_TIPO_HORD = 5),
           N'#',
           (SELECT STRING_AGG(CAST(CONCAT(p.NU_NUME_HPRO, N'|', p.NU_ESTA_HPRO) AS nvarchar(max)), N';')
                       WITHIN GROUP (ORDER BY p.NU_NUME_HPRO)
              FROM dbo.HIST_ORDEN o JOIN dbo.HIST_PROC p ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
             WHERE o.NU_NUME_HICL_HORD = h.id)
       )), 2) AS huella_de_estados   -- cambia con la entrega de farmacia o la toma del examen; el paciente no lo ve
  FROM #hcp h
 ORDER BY h.fecha;
GO

-- =============================================================================
-- P-5 · ¿Se enviaría? Las reglas del plan aplicadas a cada historia de prueba
--
-- D1 alcance (#alcance), D10 correcciones, D7 diagnóstico sensible, D5/D6
-- destinatario (celular del paciente o, si es menor, del acompañante), D17
-- correo propio (no de relleno), D9 hora (2 h después de guardada, 7:00-20:00).
-- Esperado: E1, E2 y E6 → «Sí»; E5 (a), (b) y (c) → «No», cada una con su
-- motivo; una nota aclaratoria de E3 → «No: corrección».
-- =============================================================================
IF DB_NAME() <> N'PRUEBAS' OR OBJECT_ID('tempdb..#hcp') IS NULL
BEGIN RAISERROR(N'Corre primero P-0 y P-1 en esta misma ventana.', 16, 1); RETURN; END;

;WITH dx AS (
    SELECT h.id,
           MAX(CASE WHEN d.CD_CODI_DIAG_RLAD LIKE 'B2[0-4]%' OR d.CD_CODI_DIAG_RLAD LIKE 'Z21%' OR d.CD_CODI_DIAG_RLAD LIKE 'F%'
                      OR d.CD_CODI_DIAG_RLAD LIKE 'T74%' OR d.CD_CODI_DIAG_RLAD LIKE 'T76%' OR d.CD_CODI_DIAG_RLAD LIKE 'Y0[5-7]%'
                      OR d.CD_CODI_DIAG_RLAD LIKE 'Z044%' OR d.CD_CODI_DIAG_RLAD LIKE 'Z045%' OR d.CD_CODI_DIAG_RLAD LIKE 'O04%'
                      OR d.CD_CODI_DIAG_RLAD LIKE 'A5[0-9]%' OR d.CD_CODI_DIAG_RLAD LIKE 'A6[0-4]%' THEN 1 ELSE 0 END) AS sensible
      FROM #hcp h LEFT JOIN dbo.R_LABO_DIAG d ON d.NU_NUME_LABO_RLAD = h.labo
     GROUP BY h.id
), pac AS (
    SELECT pa.NU_HIST_PAC AS pac,
           LTRIM(RTRIM(ISNULL(pa.DE_TELE_PAC, '')))              AS tel,
           LOWER(LTRIM(RTRIM(ISNULL(pa.DE_EMAIL_PAC, ''))))      AS correo,
           LTRIM(RTRIM(ISNULL(pa.DE_TELE_ACOM_PAC, '')))         AS tel_acom,
           LOWER(LTRIM(RTRIM(ISNULL(pa.TX_EMAIL_ACOM_PAC, '')))) AS correo_acom,
           (CONVERT(int, CONVERT(char(8), GETDATE(), 112)) - CONVERT(int, CONVERT(char(8), pa.FE_NACI_PAC, 112))) / 10000 AS edad
      FROM dbo.PACIENTES pa
     WHERE pa.NU_HIST_PAC IN (SELECT documento FROM #pruebas WHERE valido = 1)
), x AS (
    SELECT h.id, h.fecha, h.tipo, h.ser, h.amb, h.padre, ISNULL(dx.sensible, 0) AS sensible, p.edad,
           CASE WHEN p.edad < 18 THEN p.tel_acom ELSE p.tel END            AS cel,
           CASE WHEN p.edad < 18 THEN p.correo_acom ELSE p.correo END      AS mail,
           CASE WHEN p.edad < 18 THEN N'acompañante' ELSE N'paciente' END  AS a_quien,
           DATEADD(hour, 2, h.fecha)                                        AS listo
      FROM #hcp h
      LEFT JOIN dx    ON dx.id = h.id
      LEFT JOIN pac p ON p.pac = h.pac
)
SELECT x.id AS historia, x.tipo, x.ser AS servicio, x.edad,
       CASE WHEN x.tipo <> 'CON'                    THEN N'No: no es una consulta (' + x.tipo + N')'
            WHEN x.amb = 0                          THEN N'No: tiene registro de ingreso (urgencias u hospitalización)'
            WHEN NOT EXISTS (SELECT 1 FROM #alcance a WHERE a.servicio = x.ser)
                                                    THEN N'No: el servicio ' + ISNULL(x.ser, N'(vacío)') + N' no está en el alcance'
            WHEN x.padre IS NOT NULL                THEN N'No: corrige o sigue a la historia ' + CAST(x.padre AS nvarchar(12)) + N' (D10: actualiza su enlace)'
            WHEN x.sensible = 1                     THEN N'No: diagnóstico sensible'
            WHEN x.cel NOT LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]%'
                                                    THEN N'No: sin celular válido del ' + x.a_quien
            ELSE N'Sí' END                                                   AS se_enviaria,
       x.a_quien,
       CASE WHEN x.cel LIKE '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]%' THEN N'******' + SUBSTRING(x.cel, 7, 4) ELSE N'' END AS whatsapp,
       CASE WHEN EXISTS (SELECT 1 FROM #relleno r WHERE r.correo = x.mail) THEN N'no: correo de relleno'
            WHEN x.mail LIKE '%_@_%._%' AND x.mail NOT LIKE '% %'       THEN N'sí (propio)'
            ELSE N'no: sin correo' END                                       AS correo,
       x.fecha AS guardada,
       CASE WHEN DATEPART(hour, x.listo) < 7   THEN DATEADD(hour, 7,  CAST(CAST(x.listo AS date) AS datetime))
            WHEN DATEPART(hour, x.listo) >= 20 THEN DATEADD(hour, 31, CAST(CAST(x.listo AS date) AS datetime))
            ELSE x.listo END                                                 AS se_enviaria_a_las
  FROM x
 ORDER BY x.fecha;
GO

-- =============================================================================
-- P-6 · Costo de la consulta del agente (mira la pestaña «Mensajes»)
--
-- (a) la vuelta del agente: «historias nuevas del alcance desde la última
--     leída, guardadas hace más de 2 horas» (cursor por NU_NUME_HICL);
-- (b) el resumen completo de UNA historia de prueba.
-- Lo que importa: «lecturas lógicas» de cada tabla y «tiempo transcurrido».
-- Los resultados van a tablas # para no llenar la cuadrícula.
-- =============================================================================
IF DB_NAME() <> N'PRUEBAS' OR OBJECT_ID('tempdb..#hcp') IS NULL
BEGIN RAISERROR(N'Corre primero P-0 y P-1 en esta misma ventana.', 16, 1); RETURN; END;
DECLARE @ultimo int = (SELECT MAX(NU_NUME_HICL) FROM dbo.HISTORIACLINICA) - 3000;   -- ~1 día de historias en ESEHSVP
DECLARE @una int = (SELECT TOP (1) h.id FROM #hcp h WHERE h.tipo = 'CON'          -- la consulta con más órdenes (E1)
                     ORDER BY (SELECT COUNT(*) FROM dbo.HIST_ORDEN o WHERE o.NU_NUME_HICL_HORD = h.id) DESC, h.id);

IF OBJECT_ID('tempdb..#p6a') IS NOT NULL DROP TABLE #p6a;
IF OBJECT_ID('tempdb..#p6b') IS NOT NULL DROP TABLE #p6b;
IF OBJECT_ID('tempdb..#p6c') IS NOT NULL DROP TABLE #p6c;
IF OBJECT_ID('tempdb..#p6d') IS NOT NULL DROP TABLE #p6d;
IF OBJECT_ID('tempdb..#p6e') IS NOT NULL DROP TABLE #p6e;

SET STATISTICS IO ON;
SET STATISTICS TIME ON;

PRINT N'── P-6 (a) vuelta del agente ──';
SELECT h.NU_NUME_HICL, h.FE_FECH_HICL, h.TX_CODSER_HICL
  INTO #p6a
  FROM dbo.HISTORIACLINICA h
 WHERE h.NU_NUME_HICL > @ultimo
   AND h.FE_FECH_HICL <= DATEADD(hour, -2, GETDATE())
   AND h.TX_TIPO_HICL = 'CON'
   AND ISNULL(h.NU_NUME_REG_HICL, 0) = 0
   AND h.TX_CODSER_HICL IN (SELECT servicio FROM #alcance);

PRINT N'── P-6 (b) resumen de una historia ──';
SELECT m.CD_CODI_ARTI_HMED, m.NO_NOMB_ARTI_HMED, m.NU_CANT_HMED, m.TX_INDDOS_HMED, o.FE_POSFECHA
  INTO #p6b
  FROM dbo.HIST_ORDEN o JOIN dbo.HIST_MEDI m ON m.NU_AUTO_HORD_HMED = o.NU_AUTO_HORD
 WHERE o.NU_NUME_HICL_HORD = @una AND o.NU_TIPO_HORD = 5;
SELECT p.CD_CODI_SER_HPRO, p.NU_CANT_HPRO
  INTO #p6c
  FROM dbo.HIST_ORDEN o JOIN dbo.HIST_PROC p ON p.NU_AUTO_HORD_HPRO = o.NU_AUTO_HORD
 WHERE o.NU_NUME_HICL_HORD = @una;
SELECT d.CD_CODI_DIAG_RLAD
  INTO #p6d
  FROM dbo.HISTORIACLINICA h JOIN dbo.R_LABO_DIAG d ON d.NU_NUME_LABO_RLAD = h.NU_NUME_LABO_HICL
 WHERE h.NU_NUME_HICL = @una;
SELECT t.NU_INDI_DPME, CAST(t.TX_DESC_DPME AS varchar(max)) AS texto
  INTO #p6e
  FROM dbo.HISTORIACLINICA h JOIN dbo.DATOS_PLANTILLA_MEMO t ON t.NU_AUTO_DAPL_DPME = h.NU_AUTO_DAPL_HICL
 WHERE h.NU_NUME_HICL = @una;

SET STATISTICS TIME OFF;
SET STATISTICS IO OFF;

SELECT N'P-6' AS bloque, (SELECT COUNT(*) FROM #p6a) AS historias_en_la_vuelta, @una AS historia_medida,
       (SELECT COUNT(*) FROM #p6b) AS renglones_medicamento, (SELECT COUNT(*) FROM #p6c) AS renglones_examen,
       (SELECT COUNT(*) FROM #p6d) AS diagnosticos, (SELECT COUNT(*) FROM #p6e) AS textos_largos;
GO

-- =============================================================================
-- P-7 · Los permisos que habría que pedirle a TI (solo se ARMA el texto)
--
-- Lista cada tabla y columna que usa el prototipo (P-1 a P-6), comprueba que
-- existe, dice qué permiso tiene hoy agenia_sync EN PRUEBAS (en ESEHSVP ya se
-- vio en R3-8: ninguno sobre la historia) y arma la línea GRANT por columna
-- para que TI la revise. NADA de esto se ejecuta aquí.
-- INTER_RES1888 (credenciales del Ministerio) queda fuera a propósito.
-- =============================================================================
IF OBJECT_ID('tempdb..#cols') IS NOT NULL DROP TABLE #cols;
CREATE TABLE #cols (tabla sysname, columna sysname);
INSERT #cols VALUES
    ('HISTORIACLINICA', 'NU_NUME_HICL'), ('HISTORIACLINICA', 'FE_FECH_HICL'), ('HISTORIACLINICA', 'NU_HIST_PAC_HICL'),
    ('HISTORIACLINICA', 'CD_MED_REAL_HICL'), ('HISTORIACLINICA', 'TX_TIPO_HICL'), ('HISTORIACLINICA', 'NU_ESTA_HICL'),
    ('HISTORIACLINICA', 'TX_CODSER_HICL'), ('HISTORIACLINICA', 'NU_AUTO_DAPL_HICL'), ('HISTORIACLINICA', 'NU_NUME_LABO_HICL'),
    ('HISTORIACLINICA', 'NU_NUME_REG_HICL'), ('HISTORIACLINICA', 'NU_NUME_PADR_HICL'),
    ('HIST_ORDEN', 'NU_AUTO_HORD'), ('HIST_ORDEN', 'NU_NUME_HICL_HORD'), ('HIST_ORDEN', 'NU_TIPO_HORD'), ('HIST_ORDEN', 'TX_TIAP_HORD'),
    ('HIST_ORDEN', 'FE_FECH_HORD'), ('HIST_ORDEN', 'FE_POSFECHA'), ('HIST_ORDEN', 'NU_ORDEN_FECHAPOS'),
    ('HIST_MEDI', 'NU_AUTO_HORD_HMED'), ('HIST_MEDI', 'NU_NUME_HMED'), ('HIST_MEDI', 'CD_CODI_ARTI_HMED'), ('HIST_MEDI', 'NO_NOMB_ARTI_HMED'),
    ('HIST_MEDI', 'TX_FOFA_HMED'), ('HIST_MEDI', 'TX_VIAD_HMED'), ('HIST_MEDI', 'NU_CANT_HMED'), ('HIST_MEDI', 'TX_DURA_HMED'),
    ('HIST_MEDI', 'TX_INDDOS_HMED'), ('HIST_MEDI', 'NU_CTFREC_HMED'), ('HIST_MEDI', 'TX_CDFREC_HMED'), ('HIST_MEDI', 'NU_ESTA_HMED'),
    ('HIST_MEDI', 'NU_AUTO_UNVE_HMED'),
    ('HIST_PROC', 'NU_AUTO_HORD_HPRO'), ('HIST_PROC', 'NU_NUME_HPRO'), ('HIST_PROC', 'CD_CODI_SER_HPRO'), ('HIST_PROC', 'NU_CANT_HPRO'),
    ('HIST_PROC', 'DE_INDI_HPRO'), ('HIST_PROC', 'NU_ESTA_HPRO'),
    ('HIST_INDI', 'NU_NUME_HICL_HIND'), ('HIST_INDI', 'DE_DESC_HIND'),
    ('HIST_INCA', 'NU_NUME_HICL_HINC'), ('HIST_INCA', 'NU_DIAS_HINC'), ('HIST_INCA', 'FE_INIC_HINC'),
    ('HIST_REMI', 'NU_NUME_HICL_HREM'), ('HIST_REMI', 'TX_SERV_HREM'), ('HIST_REMI', 'TX_PRIO_HREM'), ('HIST_REMI', 'DE_REMI_HREM'),
    ('HIST_ORTIAT', 'NU_NUME_HICL_HOTA'), ('HIST_ORTIAT', 'CD_CODI_ESP_HOTA'),
    ('R_LABO_DIAG', 'NU_NUME_LABO_RLAD'), ('R_LABO_DIAG', 'CD_CODI_DIAG_RLAD'), ('R_LABO_DIAG', 'ID_TIPO_DIAG_RLAD'), ('R_LABO_DIAG', 'ID_TIPO_RLAD'),
    ('LABORATORIO', 'NU_NUME_LABO'), ('LABORATORIO', 'CD_CODI_ESP_LABO'),
    ('DATOS_PLANTILLA', 'NU_AUTO_DAPL'), ('DATOS_PLANTILLA', 'NU_NUME_RPET_DAPL'),
    ('DATOS_PLANTILLA_TEXT', 'NU_AUTO_DAPL_DPTE'), ('DATOS_PLANTILLA_TEXT', 'NU_INDI_DPTE'), ('DATOS_PLANTILLA_TEXT', 'TX_DESC_DPTE'),
    ('DATOS_PLANTILLA_MEMO', 'NU_AUTO_DAPL_DPME'), ('DATOS_PLANTILLA_MEMO', 'NU_INDI_DPME'), ('DATOS_PLANTILLA_MEMO', 'TX_DESC_DPME'),
    ('DATOS_PLANTILLA_NUME', 'NU_AUTO_DAPL_DPNU'), ('DATOS_PLANTILLA_NUME', 'NU_INDI_DPNU'), ('DATOS_PLANTILLA_NUME', 'NU_DESC_DPNU'),
    ('R_PLAN_ESP_TIAT', 'NU_NUME_RPET'), ('R_PLAN_ESP_TIAT', 'NU_NUME_PLHI_RPET'),
    ('R_PLAN_CONC', 'NU_NUME_PLHI_RPC'), ('R_PLAN_CONC', 'NU_INDI_RPC'), ('R_PLAN_CONC', 'NU_NUME_COHI_RPC'), ('R_PLAN_CONC', 'NU_NUME_GRHI_RPC'),
    ('CONCEPTO_HIST', 'NU_NUME_COHI'), ('CONCEPTO_HIST', 'CD_CODI_COHI'),
    ('GRUPO_HIST', 'NU_NUME_GRHI'), ('GRUPO_HIST', 'CD_CODI_GRHI'),
    ('PLANTILLA_HIST', 'NU_NUME_PLHI'), ('PLANTILLA_HIST', 'TX_DESC_PLHI'),
    ('DIAGNOSTICO', 'CD_CODI_DIAG'), ('DIAGNOSTICO', 'DE_DESC_DIAG'),
    ('TIPODIAGNOSTICO', 'ID_CODI_TIDI'), ('TIPODIAGNOSTICO', 'DE_DESC_TIDI'),
    ('ESPECIALIDADES', 'CD_CODI_ESP'), ('ESPECIALIDADES', 'NO_NOMB_ESP'),
    ('SERVICIOS', 'CD_CODI_SER'), ('SERVICIOS', 'NO_NOMB_SER'),
    ('MEDICOS', 'CD_CODI_MED'), ('MEDICOS', 'NO_NOMB_MED'), ('MEDICOS', 'DE_REGI_MED'),
    ('PAC_CONFIG_HIS', 'TX_CODI_CONF_HIS'), ('PAC_CONFIG_HIS', 'TX_DESC_CONF_HIS'), ('PAC_CONFIG_HIS', 'NU_TIPO_CONF_HIS'),
    ('PACIENTES', 'NU_HIST_PAC'), ('PACIENTES', 'DE_TELE_PAC'), ('PACIENTES', 'DE_EMAIL_PAC'), ('PACIENTES', 'FE_NACI_PAC'),
    ('PACIENTES', 'DE_TELE_ACOM_PAC'), ('PACIENTES', 'TX_EMAIL_ACOM_PAC');

-- Qué puede hacer hoy agenia_sync con cada tabla: 'D' = prohibido (DENY), 'T' = lee toda la tabla,
-- 'C' = lee algunas columnas, NULL = nada.
IF OBJECT_ID('tempdb..#estado') IS NOT NULL DROP TABLE #estado;
SELECT t.tabla,
       (SELECT TOP (1) CASE WHEN pe.state_desc = 'DENY' THEN 'D' WHEN pe.minor_id = 0 THEN 'T' ELSE 'C' END
          FROM sys.database_permissions pe
          JOIN sys.database_principals pr ON pr.principal_id = pe.grantee_principal_id
         WHERE pr.name = N'agenia_sync' AND pe.permission_name = 'SELECT'
           AND pe.major_id = OBJECT_ID(N'dbo.' + t.tabla) AND pe.minor_id = 0
         ORDER BY CASE pe.state_desc WHEN 'DENY' THEN 0 ELSE 1 END) AS tabla_completa,
       (SELECT COUNT(*)
          FROM sys.database_permissions pe
          JOIN sys.database_principals pr ON pr.principal_id = pe.grantee_principal_id
         WHERE pr.name = N'agenia_sync' AND pe.permission_name = 'SELECT' AND pe.state_desc LIKE 'GRANT%'
           AND pe.major_id = OBJECT_ID(N'dbo.' + t.tabla) AND pe.minor_id > 0) AS columnas_con_permiso
  INTO #estado
  FROM (SELECT DISTINCT tabla FROM #cols) t;

-- (a) ¿existen? ¿qué puede hacer hoy agenia_sync con cada tabla?
SELECT c.tabla,
       COUNT(*) AS columnas_que_usa,
       SUM(CASE WHEN COL_LENGTH(N'dbo.' + c.tabla, c.columna) IS NULL THEN 1 ELSE 0 END) AS columnas_que_no_existen,
       CASE MAX(e.tabla_completa) WHEN 'D' THEN N'PROHIBIDO a propósito (DENY): hay que pedirlo'
                                  WHEN 'T' THEN N'ya lee toda la tabla'
                                  ELSE CASE WHEN MAX(e.columnas_con_permiso) > 0 THEN N'lee algunas columnas: completar'
                                            ELSE N'hay que pedirlo' END END AS agenia_sync_hoy
  FROM #cols c
  JOIN #estado e ON e.tabla = c.tabla
 GROUP BY c.tabla
 ORDER BY agenia_sync_hoy, c.tabla;

-- (b) el texto para TI: revisarlo y, si se aprueba, correrlo en ESEHSVP con un usuario administrador.
--     Solo las tablas que agenia_sync no lee completas. Si hay un DENY sobre la tabla, va primero
--     su REVOKE: con «common criteria compliance» activo, el DENY de la tabla gana a un GRANT por columna.
SELECT x.permiso_propuesto
  FROM (SELECT c.tabla, 1 AS orden, N'REVOKE SELECT ON dbo.' + c.tabla + N' FROM agenia_sync;   -- quita el DENY de la tabla' AS permiso_propuesto
          FROM #cols c JOIN #estado e ON e.tabla = c.tabla
         WHERE e.tabla_completa = 'D'
         GROUP BY c.tabla
        UNION ALL
        SELECT c.tabla, 2, N'GRANT SELECT (' + STRING_AGG(CAST(c.columna AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.columna)
                           + N') ON dbo.' + c.tabla + N' TO agenia_sync;'
          FROM #cols c JOIN #estado e ON e.tabla = c.tabla
         WHERE COL_LENGTH(N'dbo.' + c.tabla, c.columna) IS NOT NULL
           AND ISNULL(e.tabla_completa, '') <> 'T'
         GROUP BY c.tabla) x
 ORDER BY x.tabla, x.orden;

-- (c) columnas de la lista que no existen en esta base (si sale alguna, avísame)
SELECT c.tabla, c.columna FROM #cols c WHERE COL_LENGTH(N'dbo.' + c.tabla, c.columna) IS NULL;
GO

SET NOEXEC OFF;
GO

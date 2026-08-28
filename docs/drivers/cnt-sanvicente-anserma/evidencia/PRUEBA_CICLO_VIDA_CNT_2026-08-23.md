# Evidencia: prueba de ciclo de vida de cita en la aplicación del HIS

> Transcripción de la evidencia compartida por el hospital el 2026-08-23 (capturas de pantalla de la aplicación del HIS + resultados de la consulta SQL enviada en `docs/CORREO_PRUEBA_HIS.md`). Ejecutada por el propio hospital contra la BD `PRUEBAS`. El archivo original (capturas de pantalla) no está versionado en el repo; este documento resume su contenido para referencia y trazabilidad. Interpretación completa en `docs/MAPEO_HIS.md` §2.1bis.

## Pasos ejecutados por el hospital

1. **Creación de turno:** médico código `76` ("MEDICO ATENCION HTA"), 2026-08-31, 07:00–12:00, `CONSULTORIO APS-01`. Confirmado visible en la agenda del médico con slots cada 20 minutos desde 07:00.
2. **Asignación de cita:** paciente CC `9696544` ROMERO RENDON CARLOS ARTURO (afiliado NUEVA EPS S.A, convenio en pantalla: `NUEVASUBSID`), especialidad Medicina General, doble clic sobre el slot de 07:00 del 31/08/2026.
3. **Comprobante generado por la app** (formato que puede servir de referencia para el texto del mensaje de confirmación al paciente):
   ```
   ESE HOSPITAL SAN VICENTE DE PAUL DE A
   CITA MEDICA
   EPS: NUEVA EPS S.A
   Convenio: NUEVASUBSID
   Fecha elaboración: 27/08/2026
   Historia N°: CC 9696544
   Paciente: ROMERO RENDON CARLOS ARTURO
   Fecha/hora solicita paciente le sea asignada la cita: AGOSTO 31/2026 07:00:00 AM
   Fecha/hora de Cita: AGOSTO 31/2026 07:00:00 AM
   Consulta: Consulta ambulatoria de medicina general
   Medico: MEDICO ATENCION HTA
   Especialidad: MEDICINA GENERAL
   Consultorio: 51-CONSULTORIO APS-01
   Asignada Por: ADMINISTRADOR
   Observaciones: ASISTIR 20 MINUTOS ANTES DE SU CITA PARA REALIZAR LOS TRAMITES PERTINENTES
   ```
4. **Consulta de verificación (la enviada por correo) — PASO 1, tras crear la cita:**
   ```sql
   USE PRUEBAS;
   SELECT NU_ESTA_CIT AS estado, CD_CODI_MED_CIT AS medico, FE_HORA_CIT AS fecha_hora,
          FE_ELAB_CIT AS creada, CD_CODI_SER_CIT AS servicio,
          NU_NUME_CONV_CIT AS convenio, NU_NUME_CONE_CIT AS consecutivo
   FROM dbo.CITAS_MEDICAS
   WHERE NU_HIST_PAC_CIT = '9696544'
   ORDER BY FE_ELAB_CIT DESC;
   ```
   Primera fila (la cita recién creada):
   ```
   estado=0  medico=76  fecha_hora=2026/08/31 07:00  creada=2026-08-27 14:25:00.000
   servicio=S39141  convenio=283  consecutivo=1286024
   ```
   Seguida de ~90 filas de historial del mismo paciente (2009–2025), casi todas `estado=1`, con tres excepciones en `estado=2` y una en `estado=0` (cita de 2025/06/20, ya vencida, nunca tocada).

5. **Anulación:** en la agenda del médico, clic sobre el ícono de estado (X azul) en el slot de 07:00 → menú desplegado → "Anular". Formulario "Anulacion de la Cita":
   - Motivo (desplegable): `CANCELADO WEB`
   - Observaciones: `paciente no apto para consulta`
   - Guardar (ícono de disco).

   Confirmación del hospital: *"Al dar click sobre anulado elimina la cita y queda el turno despejado"* y *"El sistema guarda bitácora en la tabla citas_anuladas"*.

6. **PASO 2, tras cancelar** — misma consulta reejecutada: la fila de `estado=0, consecutivo=1286024` **ya no aparece**. El resto del historial permanece idéntico.

7. **Verificación en `CITAS_ANULADAS`** (consulta propia del hospital, columnas con sufijo `_CIAN`): la fila cancelada aparece ahí —
   ```
   CD_CODI_MED_CIAN=76  CD_CODI_SER_CIAN=S39141  NU_HIST_PAC_CIAN=9696544
   NU_DURA_CIAN=20  FE_ELAB_CIAN=2026-08-27 14:2...  FE_FECH_CIAN=2026-08-31 00:0...
   ```
   junto con años de historial de cancelaciones previas del mismo paciente (2010–2023).

## Pasos NO ejecutados (fuera del alcance de esta prueba)

- Reagendamiento del mismo cupo (paso c de la solicitud original).
- Marcar una cita pasada como "cumplida" explícitamente desde la app (paso d) — el estado `1`/`2` de las citas históricas se observó solo por consulta, no se generó en vivo durante esta prueba.

Ver `docs/MAPEO_HIS.md` §2.1bis para la interpretación completa y las conclusiones de diseño derivadas.

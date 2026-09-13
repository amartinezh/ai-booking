# Mock — avisos masivos por WhatsApp

Datos **ficticios generados a mano**, no información real de pacientes. Sirven
para probar el flujo de carga de la Fase 1 (`/dashboard/espejo/avisos` → validar
→ cargar) mientras se construye la pantalla, y como fixture de regresión
después — mismo criterio que `docs/drivers/cnt-sanvicente-anserma/padron/`.

- `avisos_mock_es01_internista.csv` — 14 filas.
- `avisos_mock_es01_internista.xlsx` — **las mismas 14 filas**, para probar la
  carga directa desde Excel (no solo CSV). Generado desde el CSV con el mismo
  paquete `xlsx` (SheetJS) que ya usa `PadronUploader.tsx`, y verificado en
  round-trip (`XLSX.read` → `sheet_to_csv` reproduce el CSV original,
  tildes incluidas) — ver PLAN_AVISOS_MASIVOS.md §3.3.

## Por qué este escenario

No es un caso inventado: es una muestra del **único día futuro real** que
encontró la sección J del descubrimiento SQL (`sql/AVISOS_MASIVOS_DESCUBRIMIENTO.sql`,
J.6) — **jueves 24 de septiembre de 2026, Dr. ES01 (Medicina Interna)**, que
en esa corrida tenía 39 pacientes agendados ese día. Este mock usa 14 para que
sea manejable a mano en pruebas manuales; el formato y el escenario (un
médico, un día, cada 20 minutos — `duracionMinutos` de `mapping.json`) son
reales.

## Formato

```
documento,nombre,telefono,fecha_hora_cita
```

- `documento` y `telefono` y `fecha_hora_cita` — **obligatorias**.
- `nombre` — opcional (si falta, el mensaje usa "Paciente", igual que
  `AppointmentReminderCronService.buildMessage`).
- No hay columna de médico/servicio: se eligen **en la pantalla**, una vez por
  lote — no se leen de una columna (mismo criterio que la EPS en el padrón).

## Las dos filas a propósito inválidas

Igual que los mocks del padrón ejercitan el camino de datos incompletos, este
archivo trae **dos filas que el validador debe rechazar**, para probar que el
botón "2. Cargar información" se mantiene deshabilitado hasta que el reporte
da `ok` y que los errores se listan con su número de línea:

| Línea | Documento | Teléfono | Por qué falla |
|---|---|---|---|
| 12 | `1029384756` | `8871234` | Teléfono fijo de 7 dígitos — no es celular, no sirve para WhatsApp. |
| 13 | *(vacío)* | `3167788990` | `documento` es obligatorio. |

Las otras 12 filas son válidas y deben pasar limpio.

## Cuándo reemplazarlo

Cuando el hospital dé el primer caso real (un especialista que de verdad no
pueda asistir), ese lote se hace con datos reales desde la pantalla — no con
este archivo. Este mock se conserva como fixture de regresión del flujo de
carga.

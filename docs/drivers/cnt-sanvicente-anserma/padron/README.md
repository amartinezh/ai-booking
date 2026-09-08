# Padrones mock — Salud Total y Sura

Estos dos CSV son **datos ficticios generados aleatoriamente**, no información real
de pacientes. Sirven para probar el flujo de importación del padrón
(`/dashboard/padron` → `validatePadronCsvAction` / `importPadronCsvAction`) mientras
el hospital termina de gestionar y entregar el padrón real.

- `padron_mock_salud_total.csv` — 60 filas, `eps = Salud Total`.
- `padron_mock_sura.csv` — 60 filas, `eps = Sura`.

## Formato

Encabezado exacto de `PADRON_CSV_HEADERS` en `packages/shared/src/padron-csv.ts`:

```
cedula,nombre_completo,eps,telefono,email,fecha_nacimiento,genero,direccion
```

Ambos archivos fueron validados contra `validatePadronCsv` (el mismo validador que
usa la pantalla de importación) antes de commitear: `ok: true`, 60/60 filas válidas,
0 errores. Los nombres de EPS coinciden exactamente con el catálogo del piloto
(`packages/database/scripts/provision-eps-piloto.ts`: `Salud Total`, `Sura`).

Cédulas y teléfonos son numéricamente válidos pero **no corresponden a personas
reales**. Los campos opcionales (`telefono`, `email`, `fecha_nacimiento`, `genero`,
`direccion`) vienen parcialmente vacíos a propósito (~10-40 % según columna) para
ejercitar también el camino de datos incompletos, tal como llegará el padrón real.

## Cuándo reemplazarlos

Cuando el hospital entregue el padrón real de Salud Total y Sura (ver
`PREGUNTAS_AL_HOSPITAL.md` / `ESTADO.md`), estos archivos dejan de ser necesarios
para pruebas de carga con datos reales. Se pueden mantener igual como fixture de
regresión para el flujo de importación, o borrarse si ya no aportan.

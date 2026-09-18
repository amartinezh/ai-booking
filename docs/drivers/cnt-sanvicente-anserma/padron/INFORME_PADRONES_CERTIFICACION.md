# Informe de padrones para la certificación

> Qué datos de padrón existen HOY en el entorno `PRUEBAS` de AgenIA, y qué
> cédulas usa el [plan de certificación](../PLAN_CERTIFICACION_PRUEBAS.md) para
> cada caso. Generado el 2026-09-17 contra la base de producción de AgenIA
> (que aloja el entorno de pruebas de este piloto — ver nota de alcance abajo).

## 1. Qué padrón hay cargado

Los mock (`padron_mock_salud_total.csv`, `padron_mock_sura.csv`, 60 filas
ficticias cada uno, ver `README.md` de esta carpeta) **ya fueron
reemplazados**. El padrón cargado hoy es el **real, entregado por el
hospital**:

| Archivo | EPS | Importado | Filas totales | Válidas |
|---|---|---|---|---|
| `Base de Datos Suramericana 19-08-2026.xlsx` | Sura | 2026-09-15 20:54 | 10.207 | 10.205 |
| `Base de Datos Salud total 10-08-2026.xlsx` | Salud Total | 2026-09-15 19:50 | 9.157 | 9.153 |

Total: **19.358 pacientes enrolados** activos entre las dos EPS. Ninguna fila
trae género ni régimen (`EpsEnrolledPatient.gender`/`.regime` vienen `NULL`
para el 100% de las importadas) — el archivo del hospital no incluye esos
campos. No afecta a la certificación: el chatbot le pregunta sexo/régimen al
paciente directamente cuando hace falta (alta de paciente nuevo), no los lee
del padrón. El padrón solo decide **si esa cédula puede agendar con esa EPS**.

## 2. Nota de alcance — de dónde salen estos números

Estas cifras se leyeron de la base de datos que usa el servidor `agenia`
(servidor único de este piloto en esta etapa: no hay todavía un Postgres
"pruebas" separado del que sirve el dashboard/chatbot — el aislamiento
`PRUEBAS` vs. producción real está del lado del **HIS del hospital**, no del
lado de AgenIA). Ver §0 del plan de certificación para la regla de oro:
lo que importa verificar es que el **HIS** de destino sea `PRUEBAS`, no
`ESEHSVP` — el padrón en sí es el mismo dato real independientemente de eso.

## 3. Cédulas de muestra para la campaña

Elegidas al azar de cada padrón el 2026-09-17. Se listan solo cédulas — sin
nombre, teléfono ni email — porque es lo único que el flujo de WhatsApp
necesita para ejercitar el gate de padrón.

### 3.1 Enroladas — Sura (para casos A2, A6, B3, C2, D1, D2, G1)

```
1054927633
1054920114
1058079605
1054921878
75035798
```

### 3.2 Enroladas — Salud Total (para casos A3, A7, B4)

```
1058080981
4346295
1058079747
1058080945
1058080658
```

### 3.3 NO enroladas — para el gate negativo (casos B1, B2, B5)

Confirmado por consulta directa: **no existen** en `EpsEnrolledPatient` de
ninguna de las dos EPS.

```
900000001   (usar contra Sura en B1, y contra Particular en B5)
900000002   (usar contra Salud Total en B2)
```

### 3.4 Paciente nuevo (casos A4, A5) — Particular, no requiere padrón

No hace falta que la cédula exista en ningún lado: el flujo de "paciente
nuevo" se dispara precisamente porque `PatientProfile` no la tiene. Usar
cualquier número de cédula colombiano válido que no se haya usado antes en
esta campaña — p. ej. dos consecutivos fuera de los rangos de arriba
(`900000010` masculino, `900000011` femenino).

## 4. Antes de usar una cédula: verificar que está "limpia"

Una cédula que ya tiene una cita vigente en AgenIA puede confundir el
resultado de un caso nuevo. Verificar contra Postgres antes de cada sesión:

```sql
SELECT p.cedula, a.status, s."startTime"
FROM "PatientProfile" p
LEFT JOIN "Appointment" a ON a."patientId" = p.id AND a.status <> 'CANCELLED'
LEFT JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
WHERE p.cedula IN ('1054927633','1054920114','1058079605','1054921878','75035798',
                   '1058080981','4346295','1058079747','1058080945','1058080658');
```

Si alguna sale con una cita vigente de una campaña anterior, sustituirla por
otra fila al azar del mismo padrón (§3.1/§3.2) — hay 10.205 y 9.153 para
elegir.

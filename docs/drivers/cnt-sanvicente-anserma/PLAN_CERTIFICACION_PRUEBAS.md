# Plan de certificación — WhatsApp → HIS, contra `PRUEBAS`

> Objetivo: antes del cutover a producción, demostrar con evidencia — no con fe —
> que una cita hecha por WhatsApp (agendada, cancelada, reprogramada) llega
> correctamente al HIS del hospital, para las dos EPS del piloto (Sura, Salud
> Total) y para Particular. Este documento es la campaña de certificación; el
> mapa general de qué se prueba y dónde ya existe en
> [`../../PLAN_PRUEBAS_CITAS.md`](../../PLAN_PRUEBAS_CITAS.md) — este plan **no
> lo repite**, ejecuta en vivo su columna "S" (E2E de sistema) con volumen y
> disciplina de certificación, contra el entorno real desplegado (`agenia` +
> agente en `vps-citas` + HIS del hospital), no contra el stack local.

> Origen: investigación del 2026-09-17 (por qué no había cupos para Salud Total
> / Sura) que confirmó que el espejo agenda↔HIS funciona correctamente pero el
> HIS no tenía agenda futura publicada para el único médico activo. Antes de
> certificar hace falta un médico con agenda real — ver Fase 0.

## 0. Regla no negociable: `PRUEBAS`, nunca `ESEHSVP`

Todo lo de este documento corre contra la base de copia del hospital. `ESEHSVP`
es el catálogo **vivo** — una escritura ahí es una cita real de un paciente
real. Dos verificaciones obligatorias, **antes de cada sesión de prueba**, no
solo la primera vez:

1. **Lado HIS (quien tenga SSMS).** Primera línea de CUALQUIER script, sin
   excepción — está repetida en `sql/CERTIFICACION_VALIDACION_HIS.sql`:
   ```sql
   SELECT DB_NAME() AS base_actual;
   -- Debe decir PRUEBAS. Si dice ESEHSVP, CERRAR LA SESIÓN sin ejecutar nada más.
   ```
2. **Lado AgenIA.** Confirmar que el `driverConfig` de `HospitalMirrorConfig`
   apunta al PRUEBAS del hospital y no a `ESEHSVP` (se lee cifrado; pedir
   confirmación a quien administró el agente en `vps-citas`, no asumir). El
   agente conecta a un único HIS a la vez — no hay interruptor de "modo
   prueba" que cambie de base sin redeploy del agente, así que esto se
   confirma una vez por sesión de certificación, no por caso de prueba.

Si alguna vez hay duda, **detener la campaña** hasta confirmar. Un DELETE mal
dirigido en `CITAS_MEDICAS` de `ESEHSVP` es la cita de un paciente real.

## 1. Fase 0 — prerrequisitos (antes de escribir un solo mensaje)

### 1.1 Elegir médico(s) con agenda real en `PRUEBAS`

Hallazgo del 2026-09-17: el único médico con `whatsappBookingEnabled=true`
(Sebastián Alvear Imbachi) tiene **cero cupos futuros** — su agenda en el HIS
no se ha publicado más allá del 16/sep. No se puede certificar un flujo de
agendamiento sin cupos reales que ofrecer.

Antes de arrancar, correr contra `PRUEBAS` (no `ESEHSVP`) la consulta de
"semáforo" de `sql/PENDIENTE_CORRER_EN_HOSPITAL.sql` sección E (adaptada, sin
`USE ESEHSVP`) para encontrar médicos:

- 🟢 **VERDE** (un solo servicio — el convenio y el código de servicio que
  escribe AgenIA son exactos), y
- con **turnos futuros reales** (`TURNOS_MEDICOS.FE_FECH_TUME >= hoy`).

La consulta ya está copiada, adaptada a `PRUEBAS`, en
`sql/CERTIFICACION_VALIDACION_HIS.sql` §0.2.

Con el resultado, en AgenIA (Postgres, servidor `agenia`):

```sql
-- Activa el/los médico(s) elegidos para el piloto de certificación.
-- Ejecutar solo tras confirmar semáforo VERDE + turnos futuros en PRUEBAS.
UPDATE "DoctorProfile" SET "whatsappBookingEnabled" = true
WHERE id IN ('<id-medico-1>', '<id-medico-2>');
```

No lo ejecuto yo sin que se confirme el resultado del semáforo — es una
decisión de negocio (qué médico se expone), no técnica.

### 1.2 Confirmar el canal de pruebas

- Número de WhatsApp de pruebas y organización correcta (la del hospital,
  entorno PRUEBAS — no crear conversaciones desde el número que algún día será
  el de producción real si es el mismo, para no mezclar histórico).
- Confirmar que `ACTIVE_TTS_PROVIDER`/ElevenLabs (ver conversación previa) no
  interfiere: no es necesario para este plan, pero si se prueban los casos de
  **voz** (§4, bloque V), confirmar que el audio saliente funciona antes de
  depender de él para interpretar resultados.

### 1.3 Padrones — ya resuelto

Los padrones reales del hospital (no los mock) ya están importados en
`PRUEBAS`. Detalle completo, con las cédulas de muestra que usa este plan, en
[`padron/INFORME_PADRONES_CERTIFICACION.md`](padron/INFORME_PADRONES_CERTIFICACION.md).

## 2. Diseño de la campaña ("mes simulado")

No se espera un mes de reloj: se **comprime** un mes de actividad realista en
una campaña corta, con la misma mezcla que ve el hospital de verdad (ver
`ESTADO.md`: ~235 citas/día hábil, ~8-9% tasa de cancelación, reprogramaciones
menos frecuentes que cancelaciones, lista de espera solo cuando no hay cupos).

Para una certificación no hace falta el volumen absoluto (eso ya lo midió
`ESTADO.md` sección C: el espejo cuesta 0,09% de un núcleo), hace falta
**cobertura de escenarios con evidencia por caso**. Volumen sugerido:

| Categoría | Casos | Nota |
|---|---|---|
| Agendamiento feliz (por EPS × canal) | 9 | 3 EPS (Particular/Salud Total/Sura) × 3 canales (letra, nombre, voz) |
| Paciente nuevo vs. conocido | 4 | 2 nuevos (M/F, para `NU_SEXO_PAC`) + 2 conocidos |
| Padrón: cédula NO enrolada | 2 | Salud Total y Sura, cédula fuera del padrón — debe bloquear |
| Cancelación | 6 | Una por EPS, con motivo distinto donde aplique |
| Reprogramación | 4 | Con cupos disponibles y sin cupos (→ ofrece cancelar) |
| Lista de espera | 2 | Sin cupos → SÍ y NO a anotarse |
| Guardarraíles (no deben llegar al HIS) | 4 | Emergencia, insulto, fuera de contexto, FAQ que no debe agendar |
| Concurrencia / colisión de cupo | 2 | Dos "SÍ" casi simultáneos al mismo cupo (§8.1 huecos conocidos de `PLAN_PRUEBAS_CITAS.md`, ítem 1 — aquí SÍ se ejecuta manualmente) |
| Resiliencia observada (no forzada) | — | Si durante la campaña el agente se reinicia o el HIS tiene un hipo real, documentar el caso — es evidencia gratis, no hace falta simularla (`game-day-espejo.sh` ya cubre el caso forzado en local) |
| **Total mínimo** | **~33** | Ampliable; cada caso adicional suma evidencia, no la resta |

Repartir en 3-5 sesiones (no todo en una tarde): certificar también implica ver
que la reconciliación diaria (corre a las 03:08, hora del agente) recoge lo de
la sesión anterior sin `DERIVA` inesperada.

## 3. Matriz de casos de prueba

Formato de cada fila al ejecutar: `ID | mensaje(s) enviados | hora | resultado
en WhatsApp | resultado en Postgres (query §6) | resultado en HIS (query §7) |
OK/FALLA`. Plantilla de bitácora en `evidencia/` (mismo patrón que
`PRUEBA_CICLO_VIDA_CNT_2026-08-23.md`).

### Bloque A — Agendamiento, camino feliz (referencia `PLAN_PRUEBAS_CITAS.md` §3.3, §3.9-3.10)

| ID | Escenario | Canal | EPS | Cédula (ver informe de padrones) |
|---|---|---|---|---|
| A1 | Saludo→servicio (letra)→EPS (letra)→cupo→cédula→confirmar | texto | Particular | conocida |
| A2 | Igual, escribiendo el nombre del servicio/EPS | texto | Sura | enrolada Sura |
| A3 | Igual, por **audio** en cada paso | voz | Salud Total | enrolada Salud Total |
| A4 | Paciente **nuevo**, sexo masculino | texto | Particular | nueva, no en BD |
| A5 | Paciente **nuevo**, sexo femenino | texto | Particular | nueva, no en BD |
| A6 | Preferencia de fecha ("mañana", "el lunes") | texto | Sura | conocida |
| A7 | Selección por audio de una sola letra ("A") | voz | Salud Total | conocida |
| A8 | Sin cupos disponibles → ofrece lista de espera | texto | el que esté agotado | conocida |
| A9 | Consentimiento Ley 1581 presente en el resumen | texto | cualquiera | conocida |

### Bloque B — Padrón (gate de EPS)

| ID | Escenario | Resultado esperado |
|---|---|---|
| B1 | Cédula NO enrolada intenta agendar con Sura | Bloqueado, enlace de solicitud, NO llega al HIS |
| B2 | Cédula NO enrolada intenta agendar con Salud Total | Igual |
| B3 | Cédula enrolada real, Sura | Continúa sin fricción |
| B4 | Cédula enrolada real, Salud Total | Continúa sin fricción |
| B5 | Particular con la misma cédula de B1/B2 | Continúa — Particular NO consulta padrón |

### Bloque C — Cancelación (`PLAN_PRUEBAS_CITAS.md` §3.4, §6.4)

| ID | Escenario | Verificar en HIS |
|---|---|---|
| C1 | Cancelar cita de A1 (Particular) | `DELETE` de `CITAS_MEDICAS` + `INSERT` en `CITAS_ANULADAS`, motivo `WB` |
| C2 | Cancelar cita de A2 (Sura) | Igual |
| C3 | Cédula sin citas → ofrece reintentar con otra | No debe tocar el HIS |
| C4 | Varias citas del mismo paciente → menú de selección | Cancela SOLO la elegida |
| C5 | Cancelar y volver a agendar el MISMO cupo liberado | Debe permitirlo (índice único parcial) |
| C6 | "cancelar" a mitad de un agendamiento en curso | Pide confirmación antes de abortar; si dice NO, el agendamiento sigue vivo |

### Bloque D — Reprogramación (`PLAN_PRUEBAS_CITAS.md` §3.4)

| ID | Escenario | Verificar en HIS |
|---|---|---|
| D1 | Cédula → cita → nuevo cupo → confirmar | Cupo viejo `DELETE`+`CITAS_ANULADAS`, nuevo cupo `INSERT` |
| D2 | Reprogramar sin cupos disponibles → ofrece cancelar | — |
| D3 | Reprogramar y el alta falla (forzar: apagar el médico destino a mitad del flujo si es posible) | La cita ORIGINAL debe seguir viva — ver hallazgo `ESTADO.md` "Reagendar ya no puede dejar al paciente sin ninguna cita" |
| D4 | Reprogramación por audio | — |

### Bloque E — Lista de espera

| ID | Escenario |
|---|---|
| E1 | Sin cupos → SÍ a anotarse → confirmar que aparece en `WaitlistEntry` |
| E2 | Sin cupos → NO a anotarse → cierre cordial, nada que verificar en el HIS |

### Bloque F — Guardarraíles (NO deben llegar al HIS bajo ninguna circunstancia)

| ID | Escenario | Verificación crítica |
|---|---|---|
| F1 | Texto que sugiere emergencia médica | Deriva a 123/urgencias; **cero** filas nuevas en `CITAS_MEDICAS` atribuibles a este turno |
| F2 | Insulto | Cierre cortés; igual, cero escritura |
| F3 | Fuera de contexto repetido → `MAX_RETRIES` | Igual |
| F4 | Pregunta de FAQ que menciona disponibilidad ("¿tienen cupos hoy?") | Debe responder desde la KB, NO inventar ni agendar |

### Bloque G — Concurrencia (hueco conocido #1 de `PLAN_PRUEBAS_CITAS.md` §4)

| ID | Escenario | Cómo | Resultado esperado |
|---|---|---|---|
| G1 | Dos "SÍ" casi simultáneos al mismo cupo (dos conversaciones/números distintos, mismo cupo) | Enviar ambos mensajes de confirmación con <2s de diferencia | Uno reserva, el otro recibe `SLOT_TAKEN`; el HIS tiene **una sola** fila para ese médico+hora |

### Bloque V — Voz (repaso dirigido, tras el fix de `extractOptionLetter` del 17/sep)

| ID | Escenario |
|---|---|
| V1 | "la opción A" / "la letra B" / "el número A" — variantes con relleno encadenado |
| V2 | Selección por día/hora dicho por voz ("la de mañana a las 3"), sin decir la letra |
| V3 | Cédula dictada con muletillas ("mi cédula es... uno cero ocho ocho...") |
| V4 | SÍ/NO por voz en una confirmación |

## 4. Mecánica de ejecución

- Cada caso se ejecuta como **conversación real por WhatsApp** contra el número
  de pruebas — no hay atajo por API: es justo lo que hay que certificar.
  `scripts/e2e-espejo.mjs` existe pero apunta al stack **local**
  (`docker exec agenia_db`, HIS mock en `localhost:1433`); no sirve tal cual
  contra el servidor `agenia` + HIS real del hospital sin adaptarlo (cambiar
  `API_URL`, el `pg()` para que hable por SSH/túnel, y el `his()` para que no
  intente alcanzar el HIS directo — el HIS no es alcanzable desde la nube por
  diseño, así que la verificación del lado HIS de cualquier automatización
  tendría que pasar igual por alguien con SSMS). Para esta campaña, manual por
  WhatsApp es más simple y es exactamente lo que se va a certificar.
- Anotar la hora exacta de cada mensaje (para ubicarlo luego en
  `InteractionLog` y en `CITAS_MEDICAS.FE_ELAB_CIT`).
- Un caso, una cédula por defecto — no reusar la misma cédula para dos casos
  que se puedan pisar (p. ej. A1 y C1 SÍ comparten cédula a propósito, porque
  C1 cancela lo que A1 creó).

## 5. Validación — lado AgenIA (Postgres, servidor `agenia`)

Consultas de referencia (adaptar el rango de fecha/hora a la sesión):

```sql
-- Todo lo agendado/cancelado en la ventana de la sesión de hoy
SELECT a.id, a.status, s."startTime", p."fullName", p.cedula, a."createdAt", a."cancelledAt"
FROM "Appointment" a
JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
JOIN "PatientProfile" p ON p.id = a."patientId"
WHERE a."createdAt" >= '<inicio-sesion>'
ORDER BY a."createdAt";

-- Que cada cita haya salido hacia el HIS (SyncOutbox entregado, sin dead-letter)
SELECT seq, "entityType", op, attempts, "deadLettered", ("deliveredAt" IS NOT NULL) AS entregado
FROM "SyncOutbox"
WHERE "createdAt" >= '<inicio-sesion>'
ORDER BY seq DESC;

-- La caja negra de cada turno de WhatsApp (para reconstruir qué pasó)
SELECT "createdAt", status, "failureReason", "userMessage", "botReply"
FROM "InteractionLog"
WHERE "whatsappId" = '<numero-de-prueba>' AND "createdAt" >= '<inicio-sesion>'
ORDER BY "createdAt";
```

## 6. Validación — lado HIS (SQL Server, `PRUEBAS`)

Ver [`sql/CERTIFICACION_VALIDACION_HIS.sql`](sql/CERTIFICACION_VALIDACION_HIS.sql)
— empieza con el chequeo de base obligatorio del §0 de este documento, y trae
una consulta por bloque (A-G) de la matriz de arriba.

## 7. Criterios de certificación (checklist de cierre)

No se certifica hasta que TODO lo siguiente sea cierto:

- [ ] Todos los casos del Bloque A (agendamiento feliz) tienen su fila exacta
      en `CITAS_MEDICAS` de `PRUEBAS`: mismo médico, misma hora
      (`FE_HORA_CIT`), `NU_ESTA_CIT=0`, `NU_NUME_CONV_CIT` coherente con la
      EPS+régimen (tabla de convenios de `PENDIENTE_CORRER_EN_HOSPITAL.sql` D.2).
- [ ] Bloque B: las dos cédulas NO enroladas **nunca** generaron una fila en
      `CITAS_MEDICAS` — verificar por ausencia, no solo confiar en la
      respuesta de WhatsApp.
- [ ] Bloque C: cada cancelación tiene su `DELETE`+`INSERT` en
      `CITAS_ANULADAS` con `CD_CODI_MOTI_CIAN = 'WB'`.
- [ ] Bloque D: ninguna reprogramación dejó al paciente sin cita (revisar
      `CITAS_ANULADAS` vs. `CITAS_MEDICAS` para cada caso — debe haber
      exactamente una fila viva).
- [ ] Bloque F: cero filas en `CITAS_MEDICAS` atribuibles a los guardarraíles
      (buscar por rango horario de esos mensajes; no debe aparecer nada).
- [ ] Bloque G: exactamente una fila para el cupo disputado, nunca dos ni cero.
- [ ] `SyncOutbox` de la sesión: 0 `deadLettered`. Si hay alguno, el caso NO
      pasa aunque el HIS haya quedado bien por otra vía.
- [ ] La reconciliación del día siguiente (03:08, ver
      [`ESTADO.md`](ESTADO.md) / hallazgos del 2026-09-17) no reporta `DERIVA`
      nueva atribuible a la sesión (el `DERIVA` histórico ya conocido —
      2267 citas del HIS que AgenIA desconoce, hallazgo previo— es un pendiente
      aparte, no bloquea esta certificación, pero anótese si crece).

## 8. Riesgos y límites conocidos (honesto, no se esconde nada)

1. **Mezcla de servicios por turno.** `PENDIENTE_CORRER_EN_HOSPITAL.sql`
   sección A: 72,5% de los turnos del hospital mezclan servicios; el modelo
   actual de AgenIA (`ScheduleSlot.serviceId` único) puede escribir un
   `CD_CODI_SER_CIT` impreciso en médicos "amarillos/rojos". Certificar con
   médico(s) **VERDE** (§1.1) evita este riesgo, no lo resuelve de fondo.
2. **`NU_ESTA_CIT=2` (no asistió) no se escribe de vuelta.** Decisión tomada
   (`ESTADO.md`), no es parte de esta certificación.
3. **Reconciliación nunca ha dicho "OK".** Hallazgo del 2026-09-17, en
   investigación aparte — no bloquea esta certificación pero se monitorea
   durante la campaña (checklist §7).
4. **Concurrencia real (Bloque G).** Es la primera vez que se prueba con dos
   conversaciones humanas de verdad en simultáneo — antes solo estaba probada
   con dobles en unitarios.
5. **`e2e-espejo.mjs` y `game-day-espejo.sh` no corren contra este entorno.**
   Están limitados al stack local con HIS mockeado; complementan esta
   campaña, no la sustituyen.

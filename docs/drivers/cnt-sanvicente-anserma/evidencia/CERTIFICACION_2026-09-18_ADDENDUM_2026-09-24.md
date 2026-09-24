# Addendum a la certificación del 2026-09-18 — cierre operativo (2026-09-24)

> Complementa `CERTIFICACION_2026-09-18.md`, sección "Cierre operativo
> pendiente". No repite lo ya certificado ahí (canal AgenIA↔HIS, hallazgos
> 1-12): este addendum documenta que los tres puntos de cierre que quedaron
> pendientes el 18-sep se ejecutaron el 24-sep, con una corrección al alcance
> de médicos porque la agenda real del HIS cambió en esos seis días.
>
> **Base de datos objetivo: `PRUEBAS`.** Reverificado por el hospital en SSMS
> (`sys.dm_exec_sessions`, `login_name = 'agenia_sync'`) inmediatamente antes
> de la limpieza masiva de datos de este addendum. `ESEHSVP` no se tocó.

## Dictamen

Los tres puntos de "Cierre operativo pendiente" del informe del 18-sep quedan
**cerrados**:

| # | Punto pendiente el 18-sep | Estado al 24-sep |
|---|---|---|
| 1 | Revertir `META_REQUIRE_SIGNATURE=false` en producción | ✅ Ya estaba en `true` — verificado en `/opt/agenia/.env.production` |
| 2 | Dejar habilitados solo los médicos de medicina general con agenda | ✅ Hecho — alcance corregido (ver más abajo, el trío exacto cambió) |
| 3 | Limpiar los datos sintéticos de la campaña en `PRUEBAS` | ✅ Hecho — y el volumen real encontrado fue mayor al documentado el 18-sep |

**Estado resultante: base de datos de AgenIA sin un solo paciente, cita o
entrada de lista de espera de prueba; exactamente 3 médicos expuestos por
WhatsApp, los tres de "Consulta ambulatoria de medicina general" con cupos
reales; padrones de Sura y Salud Total reverificados. Queda lista para el
inicio de pruebas humanas.**

## 1. Limpieza de datos de prueba — mayor alcance del documentado

El informe del 18-sep estimaba "104 citas, 318 inscripciones a lista de
espera y ~300 perfiles sintéticos «Paciente DePrueba»" pendientes de
limpiar. Al ejecutar la limpieza el 24-sep se encontró que el volumen real
era mayor: junto a los 319 pacientes con el patrón de nombre `...DePrueba`
(104 de sus citas coinciden con la cifra del informe original) había **202
pacientes adicionales**, con nombres realistas (no el patrón `DePrueba`) y
**238 citas más** sobre ellos — de una campaña de pruebas posterior (alta en
caliente de citas nacidas en el HIS, ver memoria `alta-en-caliente-citas-his`),
no capturada en el informe del 18-sep. 192 de esos 202 pacientes se crearon
en el mismo minuto (2026-09-23 12:18), confirmando que son sintéticos y no
personas reales — no hay, a la fecha de este addendum, ningún paciente real
en el sistema: las pruebas humanas todavía no han empezado.

**Borrado el 2026-09-24, en una sola transacción:**

| Entidad | Cantidad borrada | Verificación posterior |
|---|---:|---|
| `PatientProfile` | 521 | `count = 0` |
| `Appointment` | 342 (225 vigentes + 117 ya canceladas) | `count = 0` |
| `WaitlistEntry` | 318 (en cascada al borrar el paciente) | `count = 0` |
| `ScheduleSlot` reabiertos | 225 (los que las citas vigentes tenían ocupados) | — |

El borrado de `Appointment` disparó el trigger de sincronización saliente
para cada fila (`trg_sync_outbox_appointment`), encolando el evento de
cancelación/borrado hacia el HIS en `PRUEBAS` para cada cita que seguía
vigente. Cola verificada inmediatamente después: 367 eventos pendientes,
drenados por el agente en sus vueltas normales de sondeo — sin intervención
manual necesaria.

## 2. Alcance de médicos — el trío certificado el 18-sep ya no aplica tal cual

El cierre operativo del 18-sep fijaba el objetivo en tres médicos: `MDD1`,
`MDD2` y `MD08` (Sebastián Alvear Imbachi). La **regla** detrás de esa lista
—"solo medicina general, y con agenda real"— sigue siendo la misma; lo que
cambió es su resultado, porque la agenda real del HIS se movió en los seis
días intermedios:

| Médico | Cupos futuros al 24-sep | En el objetivo del 18-sep | Estado al 24-sep |
|---|---:|---|---|
| `MDD2` (Médico Disponible HSVP 02) | 73 | ✅ sí | ✅ activo |
| `MDD1` (Médico Disponible HSVP 01) | 31 | ✅ sí | ✅ activo |
| `MD08` (Sebastián Alvear Imbachi) | **0** | ✅ sí | ❌ apagado — sin un solo cupo publicado |
| Fabio Martínez Castaño (medicina general, homologado después del 18-sep) | 19 | — (no homologado aún) | ✅ activo |
| Los otros 14 médicos (odontología, psicología, programas HTA/CyD/planificación, Víctor Quintero, Karen Cuéllar) | — | ❌ (excluidos también el 18-sep, salvo alguno habilitado temporalmente durante la campaña) | ❌ apagados |

Aplicar la misma regla del 18-sep sobre los datos de hoy da un trío distinto:
**`MDD1`, `MDD2` y Fabio Martínez Castaño**. Sebastián queda fuera no por
decisión de alcance sino porque su agenda se agotó sin que el HIS publicara
turnos nuevos — si vuelve a tener cupos, aplica la misma regla y se
reactiva.

`MedicalService.isActive` se verificó sin necesidad de corrección: seguía
con un único servicio activo, "Consulta ambulatoria de medicina general",
igual que se dejó configurado antes del 18-sep.

## 3. Verificaciones adicionales de canal, hechas el mismo día

- **Número de WhatsApp real, no el de prueba de Meta**: confirmado por
  coincidencia exacta de `phoneNumberId` (`1113957638472655`) y
  `businessAccountId` (`961518793438220`) entre `WhatsappAccountConfig` de
  AgenIA y el número de producción en Meta (+57 323 9277710), con tarjeta de
  crédito y App en modo **Activo** desde el 2026-08-30 (confirmado en la
  bandeja de alertas de Meta, no en desarrollo).
- **Cuatro plantillas de Meta registradas** en `WhatsappTemplate` que
  faltaban desde su aprobación: `recordatorio_masivo`
  (`APPOINTMENT_REMINDER_MASS`), `aviso_cancelacion_masiva`
  (`APPOINTMENT_CANCELLED_MASS`), `confirmacion_cita_hospital`
  (`HIS_APPOINTMENT_CONFIRMATION`, no existía fila), `aviso_agendador_sync`
  (`SYNC_EXCEPTION_ALERT`) — las cuatro en `es_CO`, activas.
- **Número del agendador configurado**: `agendadorWhatsapp` en
  `HospitalMirrorConfig` (número de prueba del equipo mientras se opera
  contra `PRUEBAS`; pendiente reemplazar por el número real de la persona
  del hospital cuando se defina, antes de producción sobre `ESEHSVP`).
- **Padrones reverificados el mismo día** (mismos archivos que el 18-sep):
  Salud Total 9.153 afiliados activos, Sura 10.205 — cifras idénticas a las
  de la certificación original, confirmando que el padrón no se degradó en
  el intervalo.

## Pendiente para cuando se decida pasar de `PRUEBAS` a `ESEHSVP`

Ninguno de los puntos de este addendum toca esa decisión. Sigue vigente lo
que ya advertía la certificación original: las cifras de capacidad e
inventario medidas contra `PRUEBAS` **no son representativas** de
producción (hallazgo 2-bis) — antes de abrir el canal contra `ESEHSVP` hace
falta remedir contra el catálogo vivo, no reutilizar las cifras de este
addendum ni las del 18-sep.

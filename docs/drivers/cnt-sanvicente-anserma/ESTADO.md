# Estado del driver — CNT / Hospital San Vicente de Paul de Anserma

> Seguimiento de Fase 0 (descubrimiento) para este driver específico: preguntas respondidas por el hospital, hallazgos y pendientes. La arquitectura genérica del motor de espejo (aplicable a este y a futuros drivers) vive en `../../PLAN_ESPEJO_HOSPITAL.md`. El mapeo técnico del esquema del HIS vive en `MAPEO_HIS.md`.

## ✅ Respondidas por el hospital

| # | Pregunta | Respuesta |
|---|---|---|
| 2 | Edición SQL Server | **Standard 64-bit**, 14.0.3465.1 (RTM-CU31-GDR), **sobre Linux Ubuntu 18.04.6 LTS**. CT/CDC/Agent disponibles. |
| 4 | Backup / ambiente de pruebas | Sí: backup por comando antes de cualquier intervención + **existe la BD `PRUEBAS`** (copia) — todo el desarrollo va contra ella. |
| 5 | Autorización BD + login | Sí, TI receptivo. Pasos completos en `sql/AGENIA_SYNC_SETUP.sql`. CT queda propuesto (sección 5 del script, comentada) pendiente del OK de TI. |
| 7 | Reglas de agenda | Ambos sistemas siguen agendando; **el HIS gana todo conflicto** (política de este driver — ver nota de generalización en el plan §6). |
| 8 | Identificación de pacientes | FK confirmada: solo pacientes existentes en `PACIENTES` pueden tener cita. Homologación por tipo+documento; alta bidireccional con validación previa (ver `MAPEO_HIS.md` §3.3 — el chatbot deberá capturar nacimiento y sexo para pacientes nuevos). |
| 9 | Catálogos | Estructuras de `SERVICIOS`, `MEDICOS`, `PACIENTES`, `CITAS_MEDICAS` y su grafo de FKs relevadas (ver `MAPEO_HIS.md` §2). Homologación: solo el subconjunto agendable. |
| 10 | Volumen | 27 médicos ⇒ escala pequeña. El polling diferencial basta con holgura; Change Tracking pasa a opcional. ~235 citas/día hábil (ver bloque 13). |
| 11 | Ventanas de mantenimiento | **Los domingos.** Todo despliegue/activación/corte a producción se programa en domingo. |
| 12 | Marco legal | **Existe contrato** de tratamiento de datos con el hospital (Ley 1581) — referenciarlo en el runbook y en la autorización de `AGENIA_SYNC`. |

## ✅ Resueltas en la 2ª ronda del descubrimiento

- **PK de `CITAS_MEDICAS`:** compuesta = (`CD_CODI_MED_CIT`, `FE_HORA_CIT`, `NU_ESTA_CIT`) — el estado integra la clave; CT viable; violación de PK = detector natural de colisión de cupo.
- **Formato de `FE_HORA_CIT`:** `'YYYY/MM/DD HH:MM'` (16 chars, **barras**); data legada sucia ⇒ lector tolerante, escritor estricto.
- **Modelo de agenda:** hipótesis del doble rol **refutada** — los cupos libres NO existen como filas; disponibilidad = `TURNOS_MEDICOS` (bloques de turno) − citas ocupadas ⇒ slots derivados.
- **Vía de escritura:** sin triggers, sin SPs de agendamiento, módulo web sin uso ⇒ **DML directo** replicando el patrón de la app.
- **Pacientes:** historia = documento (100% de 78.654); defaults confirmados; catálogo `TIPO_DOCUMENTO` completo.
- **Servicios agendables:** `ID_CITA_SER='1'` (1.280 servicios; 100% de las citas de 90 días).
- **Volumen:** ~250–300 citas/día hábil; reservas hasta 12 meses adelante ⇒ ventana de sincronización **+13 meses**.

## ✅ Resueltas en la 4ª ronda (catálogo vivo)

- **Catálogo vivo = `ESEHSVP`** (última elaboración 2026-08-22, 1.652 citas/7d); `ESEHSVP2024/2025` son archivos anuales; `PRUEBAS` = copia periódica ⇒ **no existe rollover anual** (a diferencia de lo que el nombre por año sugería inicialmente).
- **Plantilla del INSERT de cita campo a campo** (`MAPEO_HIS.md` §2.1): constantes, NULLs, `DE_DESC=''`, consultorio copiado del turno del día, `FE_SOLI` ≈ hora de la cita.
- **Regla de convenios:** EPS (NIT) + régimen + PyP → convenio vigente; `R_PAC_CONV` descartada; tabla de 12 convenios homologada, números estables entre años.
- **Turnos vivos:** 1.120 turnos futuros de 27 médicos hasta ago-2027; `ID_DISP='1'` = activo.
- **Volumen vivo:** 27.877 citas/90d, ≈235/día.

## ✅ Bloqueante crítico #3 RESUELTO — prueba manual ejecutada por el hospital

El hospital creó y canceló una cita real desde su aplicación (contra `PRUEBAS`) y compartió capturas + resultados SQL. **Mecanismo del ciclo de vida confirmado sin ambigüedad** (detalle en `MAPEO_HIS.md` §2.1bis):

- Alta = INSERT en `CITAS_MEDICAS` (`estado=0`).
- Desenlace de atención (0→1/2) = **UPDATE en sitio**.
- **Cancelación = DELETE de `CITAS_MEDICAS` + INSERT de auditoría en `CITAS_ANULADAS`** (tabla nueva, antes desconocida — mismas columnas con sufijo `_CIAN`, más `Motivo` y `Observaciones`).
- Bonus: la regla de convenios quedó **validada de forma cruzada e independiente** (convenio 283=NUEVASUBSID coincidió exactamente entre la pantalla de la app y nuestra homologación previa).
- Detalle operativo: una cita vigente con fecha ya pasada puede quedar así indefinidamente (el estado no caduca solo) — no es señal de fallo del sync.

## ✅ Esquema de `CITAS_ANULADAS` + catálogo `MOTIVOANUL` resueltos

24 columnas confirmadas — mismos campos que `CITAS_MEDICAS` (sufijo `_CIAN`) más `CD_CODI_MOTI_CIAN` (código de motivo → catálogo `dbo.MOTIVOANUL`, 23 motivos, ver `MAPEO_HIS.md` §2.1bis), `TX_OBSE_CIAN` (observaciones libres) y `NU_CONE_ANUL_CIAN` (consecutivo de **sesión** del operador — NO es único por fila). **Hallazgo clave:** la tabla **no tiene PK, ni índices únicos, ni FKs** — es un log de auditoría puro. El correlacionador del agente (DELETE de `CITAS_MEDICAS` ↔ INSERT en `CITAS_ANULADAS`) debe usar la tupla `(médico, hora, historia)` + cercanía temporal de `FE_ELAB_CIAN`, no una clave declarada. Volumen: 92.464 anulaciones históricas (~8-9% de tasa de cancelación).

## ✅ Respuestas de negocio recibidas

| Pregunta | Respuesta del hospital | Incorporado en |
|---|---|---|
| Escalación de conflictos | WhatsApp + email al agendador, configurable on/off; el rol `BOOKING_AGENT` debe ver la alerta al iniciar sesión en AgenIA | Motor genérico — `HospitalMirrorConfig` + `MirrorConflictAlert` (ver plan §4.1) |
| Alcance del piloto / carga inicial | Todo completo desde el día uno (27 médicos, servicios, turnos) — la activación del piloto se hace después, médico por médico | Motor genérico — §4.4 del plan, `DoctorProfile.whatsappBookingEnabled` |
| Precarga de pacientes (78.654) | **NO** — solo agenda se precarga; pacientes se crean bajo demanda como hoy (minimización de PHI, Habeas Data) | Motor genérico — §4.3 del plan |
| Contrato de tratamiento de datos | Confirmado: cubre esta necesidad | Sin acción pendiente |
| Autorización de TI / creación de `AGENIA_SYNC` | ✅ **Aprobada** (2026-08-28) | `sql/AGENIA_SYNC_SETUP.sql` — permisos corregidos con los hallazgos de Fase 0 (DELETE de cancelación, `CITAS_ANULADAS`, catálogos de convenio/motivo), listo para ejecutar |
| VM Ubuntu dedicada para el agente | ✅ **Aprobada** (2026-08-28) — TI la activa en los próximos días | `apps/mirror-agent/deploy/README.md` — checklist de despliegue ya preparado |
| "Asignada Por" como marcador de origen | Confirmado que sí lo quieren usar para identificar citas de WhatsApp | Sigue abierto — falta encontrar dónde vive el dato (bloque 24) |

## 🚧 En curso (2026-08-28)

- **`AGENIA_SYNC` — listo para ejecutar.** El script (`sql/AGENIA_SYNC_SETUP.sql`) se corrigió tras la aprobación: le faltaban permisos que Fase 0 solo confirmó después de escribirlo por primera vez — `DELETE` sobre `CITAS_MEDICAS` (cancelación) e `INSERT` sobre `CITAS_ANULADAS` (registrar motivo), más `SELECT` sobre `CITAS_ANULADAS`/`MOTIVOANUL`/`CONVENIOS`/`EPS`/`CONSULTORIOS`/`R_ESP_SER`. Sección 5 (Change Tracking) se recomienda **omitir**: con 27 médicos y ~235 citas/día el polling diferencial basta sin necesidad de ese permiso adicional. Contraseña fuerte ya generada para `agenia_sync` (entregada aparte, no vive en el repo) — falta que alguien con acceso SSMS corra el script contra `PRUEBAS`.
- **VM Ubuntu — en espera de activación por TI.** Mientras tanto se dejaron listos: el `.service` de systemd, la plantilla de `.env`, y el checklist de despliegue completo en `apps/mirror-agent/deploy/README.md`, para no perder tiempo el día que la VM esté disponible.
- **`HospitalMirrorConfig` creado en el Postgres de desarrollo** (ítem 8 de pendientes, resuelto) — decisión tomada: se trabaja primero contra el entorno de pruebas de AgenIA + `PRUEBAS` del hospital, todo el flujo funcionando de punta a punta, antes de tocar producción. Fila creada con `enabled=false` (se activa manualmente tras la primera verificación de conectividad del §5 del README de despliegue) y `driverConfig` **cifrado** (no en texto plano) — se detectó al crear esta fila que el plan (§9 Seguridad) ya prometía cifrar credenciales hacia el HIS con el patrón existente de `CryptoService`, pero el guard nunca lo hacía. Se cerró esa brecha: `MirrorAgentGuard` ahora descifra `driverConfig` al resolver la config (con compatibilidad hacia atrás si algún día llega como objeto plano), y se agregó `packages/database/scripts/provision-mirror-config.ts` como herramienta reutilizable para crear esta fila en futuros drivers/hospitales. 335 tests de `api` en verde tras el cambio.
- **Mock local del HIS en Docker — funcionando de punta a punta (2026-08-28).** Se agregó `apps/mirror-agent/local-his-mock/` (servicio `mirror-his-mock` en `docker-compose.yml`, SQL Server 2022 real bajo emulación amd64 — Azure SQL Edge se descartó: revienta con SIGABRT al arrancar en este host arm64, imagen sin mantenimiento). Reconstruye el esquema confirmado de `MAPEO_HIS.md` dentro de una BD llamada `PRUEBAS`, y corre el `AGENIA_SYNC_SETUP.sql` **real, sin modificar una sola línea** — lo que de paso ya validó que el script corre limpio. Prueba de punta a punta confirmada: agente local → API local → `driverConfig` descifrado → conexión SQL real al mock → `handshake OK`. Cutover a la VM/hospital real: `MIRROR_HIS_TARGET=hospital` en `provision-mirror-config.ts`, cero cambios de código (ver `apps/mirror-agent/local-his-mock/README.md`).
- **Gap detectado (no bloqueante) durante esta prueba:** `HisDriver.healthCheck()` existe y funciona, pero nada en `apps/mirror-agent/src/core/engine.ts` ni `src/index.ts` lo invoca todavía — hoy solo se puede probar manualmente. Debería colgarse del ciclo de heartbeat junto con el "modo seguro" (circuit breaker) que el plan (§9) menciona pero aún no implementa. Se deja anotado para cuando se diseñe esa pieza (Fase 3/4), no se improvisa aquí.

## 🆕 `ConsultingRoom` en AgenIA (2026-08-28)

Se agregó `ConsultingRoom` al schema genérico de AgenIA (`packages/database/prisma/schema.prisma`) — catálogo de consultorios por tenant, **opcional e informativo**, relacionado a `DoctorProfile.consultingRoomId`. Nace de esta necesidad pero es un concepto genérico del motor (cualquier clínica lo puede usar, tenga o no espejo con un HIS). **No decide** en qué consultorio queda una cita concreta al escribir al HIS — eso lo sigue resolviendo el driver en tiempo real contra `TURNOS_MEDICOS` (ver `MAPEO_HIS.md` §2.5bis). `db push` corrido contra el Postgres de desarrollo, `@agenia/database` reconstruido, 335 tests de `api` en verde.

## ✅ `NU_SEXO_PAC` confirmado (2026-09-01)

Corrida contra el catálogo vivo (`ESEHSVP`, bloque 26 de
`FASE0_DESCUBRIMIENTO_HIS.sql`): **`1 = Masculino`, `0 = Femenino`**. La tabla
provisional en `mapping.ts` estaba **invertida** (`M:0, F:1`) — nunca llegó a
escribirse contra un paciente real, solo contra el mock local. Corregido en el
driver, en los tests y en el `mappingJson` de desarrollo. Verificado de punta a
punta: alta de un paciente masculino nuevo por WhatsApp → `NU_SEXO_PAC=1` en la
fila real de `PACIENTES`.

Tres evidencias independientes, todas consistentes: el paciente del piloto
guiado por el hospital (CC 9696544 → 1), un cruce estadístico por nombre sobre
la tabla completa (>97% de consistencia en ambos sentidos), y el patrón de
recién nacidos sin nombre propio ("HIJO DE..." → 1, "HIJA DE..." → 0).

Efecto colateral: la misma consulta reveló que `NO_NOMB_PAC` puede no ser el
nombre completo del paciente (ver pendiente #9 abajo) — no bloqueaba nada, pero
conviene cerrarlo antes de escribir contra pacientes reales.

## ✅ Fase 5 implementada (2026-09-01)

Blindaje y operación, las cinco piezas que pedía el plan §11:

- **Panel del espejo** (`Dashboard → Espejo con el HIS`). Cuatro semáforos que
  responden lo que de verdad se pregunta quien opera esto: si el agente está
  vivo *y alcanza el HIS* (son cosas distintas), si hay citas que no llegaron,
  si la agenda coincide, y si los dos sistemas cuadran. Incluye el botón que la
  capa 4 del plan prometía y no existía: **devolver a la cola un evento que se
  rindió**. Antes, un dead-letter solo se veía por `psql` y se reintentaba con
  un UPDATE a mano.
- **`lastHisReachable` se guarda**, no solo se loguea: la única forma de
  enterarse de que el agente latía sin poder escribir era estar mirando el log
  del servidor en ese instante.
- **Reconciliación** diaria corriendo desde el agente (ver Fase 2).
- **Runbook** (`RUNBOOK.md`): qué hacer cuando algo va mal, ordenado por lo que
  se ve primero. Rotación de token y credenciales, reproceso de dead-letter,
  desastre total, apagado de emergencia.
- **Game-day** (`scripts/game-day-espejo.sh`): seis escenarios de desastre
  contra la VM simulada, con aserciones. Superado — 21 comprobaciones, 0 fallos:
  proceso muerto, VM reiniciada, HIS incomunicado, internet caído, dead-letter
  reprocesado y jornada cancelada con cita dentro. En los seis vuelve solo y no
  se pierde ninguna cita.

## ✅ Fase 2 implementada (2026-09-01)

`fetchAvailability()` dejó de ser un stub: el driver lee `TURNOS_MEDICOS`
(esquema confirmado en el bloque 7), divide cada bloque en cupos con la misma
cuenta que hace la aplicación del hospital, marca los que ya están vendidos
cruzando con `CITAS_MEDICAS`, y el agente los sube día por día. Con
`availabilityMode = ON`, **la agenda de AgenIA es la del hospital**: hasta
ahora los cupos se creaban a mano y se podía vender por WhatsApp una hora en
la que el médico no atiende.

Incluye modo sombra (`SHADOW`: calcula y reporta sin escribir) y carga inicial
(`--seed-inicial`). Verificado de punta a punta contra la VM simulada: importar
la rejilla, cancelar una jornada en el HIS y ver desaparecer sus cupos, y —lo
importante— que un cupo con cita viva NUNCA se borra: se reporta como conflicto.

No dependía del bloque 21: ese bloque cierra la última milla del **INSERT**
(especialidad, consecutivo de sesión, consultorio), no la LECTURA de turnos.

Queda para cuando el hospital confirme: `TURNOS_MEDICOS` no lleva servicio, así
que el servicio del cupo sale de `DoctorProfile.serviceId`. Un médico que
atienda dos servicios en el mismo turno necesitará una regla más fina.

## ✅ La ventana de detección ya no cancela citas vivas (2026-09-01)

El defecto más grave que ha tenido el espejo, y no daba error: `detectChanges`
filtraba la ventana de vigilancia con `FE_FECH_CIT >= new Date()`, y `mssql`
serializa un `Date` en UTC. Comprobado contra el SQL Server del mock:

```
new Date() a las 20:13 de Bogotá  ->  llega al servidor como 2026-09-02 01:13
```

Es decir, **a partir de las 19:00 locales el borde de la ventana ya estaba en la
fecha de mañana**, y toda la agenda del día siguiente salía de la foto de golpe.
El diff no distingue "la cancelaron" de "salió de la ventana" —las dos se ven
igual, una clave que ya no está— así que emitía `CANCEL` para cada una:

- ~235 pacientes por noche perdían su cita en AgenIA (`status = CANCELLED`),
- su cupo volvía a ofrecerse por WhatsApp,
- y la segunda cita reventaba en el HIS por violación de PK → dead-letter.

La reconciliación diaria vuelve a cerrar el cupo, pero **no restaura la cita**:
solo la reporta como `missingInHis`. Al paciente no se le avisa de nada.

Por el otro borde, el mismo filtro dejaba el día en curso SIEMPRE fuera: una
cita que el hospital cancelaba hoy para hoy no se detectaba nunca.

**Arreglo, en dos partes:**

1. La ventana se consulta en **fechas locales** (`CONVERT(varchar(10), …, 23)
   BETWEEN`), que es el idioma de esa columna — el mismo remedio que ya usaba
   `fetchAvailability`, donde el desfase se había descubierto antes y no se
   llevó a las otras dos consultas.
2. La foto **guarda qué fechas cubrió**, y el diff solo compara la
   intersección de las dos ventanas. Lo que entra o sale por el borde no es un
   cambio: es la ventana moviéndose.

El cursor cambia de forma (`{ventana, filas}`, y cada fila lleva su fecha). Un
`state.json` de la versión anterior se acepta tal cual, pero en esa única
vuelta **no cancela nada**: sin saber qué fechas cubría no se puede afirmar que
algo desapareció, y equivocarse ahí es cancelarle la cita a un paciente. Las
altas sí se siguen reportando — ocupan cupos, nunca los liberan. Verificado en
la VM simulada: el agente migró solo, sin emitir una sola cancelación.

Seis pruebas nuevas cubren los bordes (239 en total). Ninguna de las que había
podía fallar: todas miraban el SQL y el defecto estaba en el reloj.

**El mismo desfase en `snapshotAppointments` (la foto que usa la
reconciliación) también se cerró (2026-09-01).** No cancelaba nada —esa
función es de solo lectura— pero falseaba el reporte: una cita real cerca del
borde podía faltar en la foto y la reconciliación la marcaba como "el hospital
no la tiene" sin ser cierto, o repararla en falso (cerrar un cupo que sí tenía
cita). Mismo remedio: la consulta se hace por fecha local
(`CONVERT(varchar(10), FE_FECH_CIT, 23) BETWEEN`) y el resultado se recorta a
la ventana UTC exacta que pidió el llamador — la consulta por día completo
trae un superconjunto, y el contrato del método es la ventana precisa.
Verificado contra el mock: la foto ya trae la cita de hoy y la de mañana
corriendo cerca de la medianoche de Bogotá, el momento exacto en que antes se
perdían. 240 tests en total.

## ✅ Cancelar ya no arrastra citas de otro paciente (2026-09-01)

La PK de `CITAS_MEDICAS` es `(médico, hora, ESTADO)` — el estado integra la
clave a propósito (confirmado en la 2ª ronda de descubrimiento). El desenlace
de atención (0→1/2) es un UPDATE en sitio que **libera** la tupla
`(médico, hora, 0)`, y nada en el esquema impide que esa hora se vuelva a
agendar después. El resultado, real y no hipotético: dos filas vigentes para
el mismo médico+hora, una ya atendida y una nueva.

`copiarAAnuladas()` no lo sabía: filtraba solo por `(médico, hora)`, tanto en
el `SELECT` que archiva en `CITAS_ANULADAS` como en el `DELETE`. Cancelar la
cita **nueva** (estado 0) copiaba y borraba **también** la ya atendida —un
paciente atendido desaparecía de la historia clínica del hospital por la
cancelación de otro. Reproducido contra el SQL Server del mock: dos filas
insertadas con la misma hora y estados 0/1, un `DELETE` sin el filtro se
llevó las dos.

**Arreglo:** `AND NU_ESTA_CIT = 0` en las dos consultas — cancelar solo puede
tocar la fila viva, que es la única sobre la que el motor actúa.

**El mismo hallazgo alcanzaba a `detectChanges`:** la foto que alimenta la
detección de cambios indexaba por `${médico}|${hora}` sin más, así que ante
dos filas reales para la misma clave, la última que devolviera SQL Server
ganaba en silencio — sin ningún criterio, solo el orden de la consulta.

**No se corrigió añadiendo el estado a la clave.** Se probó primero esa vía
y rompe algo peor: si la clave fuera `${médico}|${hora}|${estado}`, una
atención normal (una sola cita, 0→1) se vería como que la fila `estado=0`
desapareció y otra con `estado=1` apareció — es decir, **CANCEL + INSERT en
vez de ATTENDANCE**. Cada cita atendida se cancelaría sola en AgenIA, un
defecto nuevo y peor que el que se estaba cerrando. La clave sigue siendo
`${médico}|${hora}`.

En su lugar, cuando la consulta trae más de una fila para la misma clave, se
elige de forma determinista la fila **viva** (`estado = 0`) — es la única
sobre la que el motor puede actuar (cancelar, reagendar); la atendida ya es
historia cerrada y no vuelve a cambiar — y se deja constancia con
`console.warn` en el log del agente, visible en `journalctl`. Sin colisión
(el caso normal, con diferencia el más frecuente) el comportamiento no
cambia un bit.

Cinco pruebas nuevas cubren esto, incluyendo el contrapunto obligado: que
una atención normal (una sola fila, sin colisión) se siga reportando como
`ATTENDANCE` y no como `CANCEL`+`INSERT`. 245 tests en total.

## ✅ `FE_FECH_CIT` ya se escribe a medianoche (2026-09-01)

El hospital guarda `FE_FECH_CIT` como fecha a medianoche (`MAPEO_HIS.md` §2.1).
El driver mandaba `new Date(\`${feFecha}T00:00:00\`)` como `sql.DateTime`, y ahí
se juntan dos cosas: un `Date` de JS es un INSTANTE, no una fecha, y `mssql` lo
serializa en UTC. Medido contra el SQL Server del mock, para una cita del
2026-09-15:

| Zona del proceso | Antes | Ahora |
|---|---|---|
| `America/Bogota` (la VM) | `2026-09-15 05:00:00` | `2026-09-15 00:00:00` |
| `UTC` | `2026-09-15 00:00:00` | `2026-09-15 00:00:00` |
| `Europe/Madrid` | **`2026-09-14 22:00:00`** | `2026-09-15 00:00:00` |
| `Asia/Tokyo` | **`2026-09-14 15:00:00`** | `2026-09-15 00:00:00` |

En la VM el daño era "solo" cinco horas pegadas a la fecha correcta: nuestras
citas quedaban con un componente horario que ninguna fila del hospital tiene, y
cualquier consulta de su aplicación que compare la fecha por igualdad exacta
—patrón habitual en este estilo de código legado— dejaba de encontrarlas. La
cita existía en la tabla y podía no aparecer en su pantalla de agenda del día.

Pero el defecto de fondo es peor que el síntoma: **el valor dependía de la zona
del PROCESO**. El mismo código escribía una cosa en la VM y otra en un
contenedor sin `TZ`, y desde cualquier zona al este de UTC escribía el DÍA
ANTERIOR. Un dato del hospital no puede depender de dónde corra el agente.

**Arreglo:** se saca el `Date` del camino. `fechaLiteralSql()` convierte la
fecha local a un literal `'YYYYMMDD'` que viaja como `VarChar` — un texto no
tiene zona ni instante, así que no hay nada que convertir. Se usa `YYYYMMDD` y
no `YYYY-MM-DD` porque para `datetime` es el único formato que SQL Server
interpreta igual bajo cualquier `DATEFORMAT` o idioma de sesión, y es el que
usó el hospital en su propia prueba.

Se corrigieron los dos sitios que mandaban fechas así: el INSERT de
`CITAS_MEDICAS` y la búsqueda de turno en `turnoDelDia()`. En el segundo el
`CAST(... AS date)` disimulaba el desfase mientras el agente corriera al oeste
de UTC; desde una zona al este, la comparación caía en el día anterior y el
médico "no tenía turno" — la cita se rechazaba entera.

Verificado de punta a punta con el driver real contra el mock en cuatro zonas
horarias: las cuatro escriben `2026-09-15 00:00:00.000`. Cinco pruebas nuevas,
250 en total.

## ✅ Reagendar ya no puede dejar al paciente sin ninguna cita (2026-09-01)

`rescheduleAppointment()` hacía `commit` de la anulación y **después**, fuera
de la transacción, llamaba a `createAppointment()`. Si el alta fallaba —el
médico no tiene turno el día nuevo, o el hospital acaba de vender ese cupo y
salta la colisión de PK— la cita vieja ya estaba borrada y la nueva nunca se
escribía. El paciente se quedaba sin NADA, mientras AgenIA daba el
reagendamiento por hecho y le mostraba la cita nueva. El comentario del método
decía "en una transacción" y no lo era.

Reproducido con el driver real contra el SQL Server del mock — reagendar a un
día en el que el médico no atiende:

| | Antes | Ahora |
|---|---|---|
| Citas vigentes del paciente | **0** | 1 (la original, intacta) |
| Filas en `CITAS_ANULADAS` | 1 (huérfana) | 0 |
| Resultado devuelto | fallo | fallo, con "la cita anterior sigue en pie" |

**Arreglo:** el alta se puede ejecutar ahora dentro de una transacción ajena.
Se extrajo `crearCita(ejecutor, evt)` del cuerpo de `createAppointment()`, y
tanto ella como `ensurePaciente()` y `turnoDelDia()` reciben un `Ejecutor`
—el pool o una transacción abierta; `mssql` expone el mismo `.request()` en
los dos, así que no hubo que duplicar ni una consulta—. `rescheduleAppointment`
abre UNA transacción, anula y crea dentro de ella, y **hace rollback si el alta
no sale**. Un alta suelta sigue usando el pool y se comporta igual que siempre.

Tres pruebas nuevas, y las tres **verificadas contra el código anterior**: las
tres fallan sin el arreglo. Ninguna de las que ya existían lo detectaba porque
todas miran el camino feliz. La tercera comprueba lo que de verdad distingue
el arreglo del defecto —que el `commit` ocurre DESPUÉS del alta, no antes—;
para eso el doble de conexión ahora registra cuántas escrituras llevaba hechas
al confirmar. 253 tests en total, game-day 19/19.

## ✅ La asistencia entrante ya no se pierde en silencio (2026-09-01)

Nunca se aplicó ni una. Tres capas, cada una suficiente por sí sola para
romperlo:

1. **El evento llegaba sin identidad.** El driver reporta la cita por médico y
   hora —no conoce los ids de AgenIA, no puede—, así que
   `agenIAAppointmentId` venía siempre vacío y `applyAttendanceUpdate` lanzaba.
   La cancelación entrante ya resolvía esto por el cupo desde hacía tiempo; la
   asistencia hace ahora lo mismo.
2. **El evento llegaba en el idioma equivocado.** Se enviaba
   `String(fila.e)` — el código crudo del HIS, `'1'` — contra
   `Appointment.attendanceStatus`, que es un enum de Prisma
   (`PENDING | ATTENDED | NO_SHOW`). Aunque hubiera llegado con id, el UPDATE
   habría reventado igual. Ahora se traduce en la frontera del driver
   (`desenlaceDeAtencion()`), igual que las horas se convierten ahí.
3. **Y el fallo era invisible.** `applyBatch` atrapaba la excepción, dejaba una
   fila `ERROR` en `SyncAudit` y devolvía **200** con
   `applied+skipped+conflicts`: no había dónde reportar un fallo. El agente lo
   leía como una vuelta limpia y avanzaba el cursor.

Efecto acumulado: ~235 eventos al día descartados, y
`Appointment.attendanceStatus` en `PENDING` para siempre — nadie sabía quién
había asistido.

**Lo que NO se adivina:** el estado `2` existe y nadie ha confirmado qué lo
dispara (MAPEO_HIS.md §2.1). Se devuelve `null` y no se reporta el evento, con
un aviso en el log. Escribirle mal la asistencia a un paciente es peor que no
escribirla.

**Y un hallazgo que cambia el mapa:** el "no asistió" del hospital **no es un
estado distinto**. Es un DELETE de `CITAS_MEDICAS` + archivo en
`CITAS_ANULADAS` con motivo `NA` (285 casos históricos, MAPEO_HIS.md §2.2). Al
agente le llega como una CANCELACIÓN, no como un desenlace. Así que hoy un
paciente que no se presentó queda en AgenIA como `CANCELLED`, no como
`NO_SHOW`. Distinguirlos exige leer `CD_CODI_MOTI_CIAN` de la fila archivada,
que el driver todavía no hace — **pendiente nuevo, anotado abajo**.

**Sobre la visibilidad:** `ChangesResult` gana `errors`, el servidor lo cuenta
y el agente lo dice en el log. No hace el evento reintentable —el cursor es una
FOTO, no una marca de tiempo, así que "volver a pedir el evento 7" no existe y
la entrada es por diseño *a lo sumo una vez*, con la reconciliación diaria como
red— pero sí lo hace VISIBLE, que es la diferencia entre un problema y un
problema que nadie sabe que tiene.

Once pruebas nuevas entre driver y servidor. 943 en total (545 API, 258
agente, 140 shared), game-day 19/19.

## ✅ Las consultas ya usan el índice del hospital (2026-09-02)

El bloque 29 devolvió dos cosas que cambian la escala del problema:

- **`CITAS_MEDICAS` tiene 1.084.093 filas y 855 MB.** Se venía estimando en
  ~28.000 — un orden de magnitud menos.
- **El hospital YA TIENE el índice que hacía falta:** dos, con `FE_FECH_CIT`
  como primera columna de la clave (`CITAS_MEDICASFE_FECH_CIT` y
  `IDX_ESEHSVP_CITAS_MEDICAS31931_31930`). `TURNOS_MEDICOS` tiene el suyo.

Y el driver no los podía usar. Al corregir el desfase de zona horaria se
adoptó `WHERE CONVERT(varchar(10), FE_FECH_CIT, 23) BETWEEN @a AND @b`, que es
correcto pero **no es sargable**: envolver la columna en una función le impide
al motor usar cualquier índice sobre ella. Eran cuatro consultas, y una de
ellas la que el bucle de entrada repetía cada 5 segundos contra la base viva
del hospital.

**Arreglo, en dos partes:**

1. **Las cuatro consultas pasan a `COL >= @desde AND COL < @hasta`**, con los
   bordes como literales `'YYYYMMDD'` (`fechaLiteralSql` /
   `diaSiguienteLiteralSql`). La columna queda desnuda y el índice sirve, sin
   perder la inmunidad a la zona horaria — un literal de texto no tiene zona.
   El borde superior pasa a ser EXCLUSIVO, de ahí el helper del día siguiente.
   Equivalencia verificada contra el mock sembrando los bordes (ayer, hoy,
   +89, +90, +91): las dos formas devuelven el mismo conjunto exacto.

2. **El bucle de entrada tiene su propio intervalo** (`MIRROR_INBOUND_INTERVAL_MS`,
   30s por defecto) en vez de heredar los 5s del long-poll de salida. Compartirlo
   no tenía ninguna razón: el de salida es un long-poll que no cuesta nada
   porque el servidor retiene la llamada; el de entrada relee la ventana entera
   de la base del hospital. Aunque el seek fuera perfecto, 28.000 filas cada 5
   segundos son 484 millones de filas al día por su LAN. Lo que protege de la
   sobreventa en ese intervalo no es esta lectura sino la PK del HIS, que
   rechaza la segunda cita en el mismo cupo al escribirla.

Nueve pruebas nuevas (incluidos los saltos de mes, año y bisiesto del borde
superior, donde esto se rompería en silencio). 264 en el agente, game-day 19/19.

**Queda pendiente medir** (29c/29d): la primera versión del bloque devolvía las
28.000 filas a la grilla y era imposible copiarlas. Ya está corregido —vuelca a
variables, así que hace el mismo trabajo y solo sale la pestaña "Messages"—.
La medición ahora confirma la mejora en vez de decidirla. Hay un matiz que sí
resolverá: la ventana es el 2,6% de la tabla, justo donde el optimizador a
veces escanea igual porque el `SELECT` pide tres columnas que el índice no
cubre.

## ✅ De dónde sale la especialidad de la cita (2026-09-02, bloque 32)

Cierra el bloque 21b, abierto desde agosto. Y corrige una hipótesis mía.

**Lo que yo sostenía:** que la especialidad la decide quién atiende — que
`S36101` (examen clínico de primera vez) salía `461` con la odontóloga y `572`
con la higienista. **Los datos dicen que no.** Ese servicio usa `461` en 826 de
827 citas, y `HO03`, que es higienista oral, también usa `461`. La única fila
con `572` es una cita suelta. **El servicio manda, no el médico.**

**El veredicto de la regla** `R_ESP_SER(servicio) ∩ R_MEDI_ESPE(médico)`, sobre
21.362 citas reales:

| | citas | |
|---|---:|---|
| Acierta (una sola, y es la correcta) | 13.227 | 61,9% |
| Ambigua (la intersección deja varias) | 8.135 | 38,1% |
| **Falla** | **0** | — |
| **Sin intersección** | **0** | — |

La cobertura es total (53 servicios y 25 médicos, ninguno sin fila), y la regla
**nunca se equivoca** — pero deja indeciso el 38%. Es segura e incompleta:
sirve para **validar**, no para decidir.

**Por qué queda ambigua:** el código `000` (MEDICINA GENERAL) es un comodín.
Casi todos los médicos lo tienen declarado y casi todos los servicios lo
admiten, así que infla toda intersección y casi nunca es la respuesta correcta
cuando hay alternativa. Desempatar por `MIN()` lo elegiría, y fallaría en tres
de los cuatro casos conocidos (`I890301AG` → 328, `S35102` → 590, `S35104` →
590; el real nunca es `000`).

**La conclusión:** la fuente es el **servicio**, tomada de la moda empírica
(bloque 31d: 36 de 40 servicios son inequívocos en la práctica). La
intersección queda como comprobación de que el valor generado sea uno de los
posibles. R_ESP_SER dice lo que es POSIBLE; los datos dicen lo que se HACE.
`especialidadPorServicio` se genera de lo segundo y se verifica contra lo
primero.

**Dos detalles operativos que salieron de paso:**

- `TX_ACTI_ESP = 0` en las trece especialidades, incluidas las que se usan a
  diario ⇒ **no sirve para filtrar**, nadie mantiene ese flag.
- El conjunto de "médicos con turnos futuros" **se mueve día a día**: eran 30 en
  el bloque 30a y 25 un día después. La herramienta de homologación no puede
  tratarlo como una lista fija.

El catálogo tiene además una estructura de pares normal ↔ PyDT que conviene
conocer: `000`/`328` (medicina general), `461`/`572` (odontología),
`590`/`591` (psicología).

## ✅ El `mappingJson` deja de ser huérfano — y traía dos valores mal (2026-09-02)

Al ir a aplicar la especialidad recién descubierta apareció el mismo patrón que
con `MirrorEntityMap`: **nadie escribía el `mappingJson`**. Vive en
`HospitalMirrorConfig` (en la base y no en el código a propósito: validarlo con
el hospital debe ser configuración, no despliegue), pero vivía SOLO ahí, metido
a mano con un UPDATE. Sin original revisable nadie podía ver qué decía, por qué,
ni desde cuándo. Y escondía dos errores:

- **`I890301AG` con especialidad `000`** cuando las citas reales usan `328` en
  453 de 455 (bloque 31d). Cada control a la gestante agendado por WhatsApp
  habría ido con la especialidad equivocada.
- **`serviciosPyp` con UN servicio de los catorce** de la familia PyDT. Los
  otros trece se habrían facturado al **convenio general en vez del de PyP** —
  `resolveConvenio()` decide justo con esa lista.

**Arreglo:** `docs/drivers/cnt-sanvicente-anserma/mapping.json` es ahora el
original versionado, con la procedencia de cada bloque anotada dentro, y
`packages/database/scripts/aplicar-mapping.ts` lo aplica. El script **no se
limita a copiar**: comprueba coherencia antes de escribir —que toda
especialidad usada exista en el catálogo, y que `serviciosPyp` y la familia
PyDT coincidan **en los dos sentidos**—. Probado rompiendo el archivo a
propósito: caza exactamente los dos defectos que había en producción.

Aplicado: de 3 a **40** servicios con especialidad, de 1 a **14** de PyP.
El agente lo recogió en el handshake; game-day 19/19.

Sigue pendiente **validar los convenios con la agendadora**: es el único bloque
del archivo que sigue siendo una hipótesis, y está marcado como tal ahí dentro.

## 🎯 Decisión tomada: el cupo lleva el servicio dominante del médico (opción C)

El bloque 31b había dejado claro que **el 72% de los turnos mezcla servicios** y
que nada en el HIS dice de qué servicio es un cupo. De las tres opciones se
elige **C**: AgenIA ofrece, de cada médico, **un** servicio —el dominante, por
volumen de citas— y el resto se sigue agendando por ventanilla.

Es lo que el código ya hace; lo que cambia es que pasa a ser una **decisión
explícita** en vez de un accidente: la herramienta de homologación elegirá ese
servicio a propósito, con el dato de volumen, y lo dejará visible.

**Por qué es seguro:** la ocupación del cupo ya es agnóstica al servicio
(`resolverCupo()` empareja por médico + hora, y la rejilla se indexa por
`doctorId|startTime`). Si el hospital vende esa hora para cualquier otro
servicio, AgenIA marca el cupo ocupado igual. **No hay riesgo de sobreventa**;
lo único limitado es lo que AgenIA puede *ofrecer*.

**Destino:** la opción B —`ScheduleSlot.serviceId` opcional y el servicio
elegido al reservar— sigue siendo el modelo correcto, pero es cambio de
esquema + búsqueda de cupos del chatbot + validación médico↔servicio. Queda
para cuando el piloto lo justifique.

## ✅ La homologación ya tiene quien la escriba (2026-09-02)

`MirrorEntityMap` era el último bloqueante para encender: cinco piezas del
motor la leen y ninguna la producía. Ahora hay un camino completo.

**El problema de fondo no era una herramienta que faltara, era un hueco de
arquitectura.** La API no alcanza el HIS por diseño (plan §4.1), así que no
podía leer el catálogo del hospital ni proponer nada. Y el contrato `HisDriver`
tenía nueve métodos y **ninguno listaba un catálogo**.

**Las tres piezas nuevas:**

1. **`fetchCatalog(kind)` en el contrato.** Cada driver decide qué entra. El de
   Anserma no sube "todo lo que hay" —588 médicos y 1.280 servicios— sino los
   que tienen turnos futuros (~30) y los servicios con citas en 90 días (~53).
   El filtro NO es `NU_ESTA_MED`: 229 están "activos" y solo 30 agendan.
2. **`POST /mirror/catalog`.** El catálogo viaja como la agenda. Se guarda en
   **`MirrorCatalogEntry`, tabla aparte**: un médico sin emparejar no es una
   homologación a medias, es un candidato esperando que alguien lo mire. Con el
   `agenIAId` vacío rompería las dos restricciones únicas de `MirrorEntityMap`
   y confundiría "no lo hemos mirado" con "no tiene equivalente". Lo que el HIS
   deja de reportar **no se borra**: el conjunto se mueve día a día.
3. **`scripts/homologar.ts`.** Propone, y solo escribe con `--aplicar`.

**Las decisiones, implementadas:**

- **Emparejamiento por cédula**, y **se niega a adivinar** cuando la cédula se
  repite — que es justo lo que pasa con las agendas funcionales del hospital
  (`77123456789`, `123456`). Esas van a revisión manual, que es donde deben ir.
- **Los médicos que faltan se crean**, con email de marcador (`medicoN@…`) y una
  **contraseña aleatoria de 32 bytes que nadie conoce**: no pueden entrar hasta
  que un administrador la restablezca. Una contraseña por defecto conocida sería
  una puerta abierta en treinta cuentas.
- **`whatsappBookingEnabled = false` explícito.** El schema tiene
  `@default(true)`: sin ponerlo, cada médico homologado quedaría vendible al
  instante, lo contrario del piloto gradual que pidió el hospital.
- **Servicio dominante** por médico (opción C), tomado del volumen real de 90
  días que el driver calcula y manda en el catálogo. Elegido a propósito y
  visible, no a dedo.
- **Nunca se borra una equivalencia.**

**Probado de punta a punta contra la VM y el mock**, no solo en unitarias: el
agente leyó 5 médicos y 2 servicios del HIS, los subió, y la CLI clasificó
2 ya homologados / 1 a crear / **2 a revisar por cédula compartida**. Aplicado:
el médico nuevo quedó con `whatsappBookingEnabled=false`, su servicio dominante
asignado y una contraseña de 64 caracteres hex.

**Lo que sigue faltando para encender:** correr esto contra el hospital de
verdad, y que alguien mire la lista antes del `--aplicar`.

## 📍 Última milla del INSERT — estado real (2026-09-02)

Los tres campos que se arrastraban como "pendientes del bloque 21" ya no están
en el mismo sitio. Contrastados contra `esquema-real.tsv` (el volcado del
bloque 28) y contra el resultado del bloque 32:

| Campo | Estado | Qué falta |
|---|---|---|
| `CD_CODI_ESP_CIT` (especialidad) | ✅ **Cerrado** por el bloque 32 | Nada. `especialidadPorServicio` se genera de la moda empírica por servicio (36 de 40 inequívocos) y se verifica contra `R_ESP_SER ∩ R_MEDI_ESPE`: 0 contradicciones en 21.362 citas. |
| `CD_CODI_CONS_CIT` (consultorio) | ✅ **Resuelto estructuralmente** | No es una constante: sale de `turnoDelDia()` → `CD_CODI_CONS_TUME`. Falta solo validar la regla **a escala** (bloque 25a). No bloquea: si el turno no existe, el driver rechaza la cita en vez de inventar consultorio. |
| `NU_NUME_CONE_CIT` (consecutivo de sesión) | ⚠️ **No es bloqueante** | La columna **admite nulos** en el esquema real, así que el INSERT —que no la escribe— no puede fallar por esto. Lo que queda es *fidelidad*: si los informes del hospital agrupan por sesión, las citas de WhatsApp quedan fuera de esa agrupación. Pregunta B.2 del archivo de pendientes. |

**Comprobación estructural adicional (2026-09-02).** El INSERT de
`CITAS_MEDICAS` cubre las **tres** únicas columnas NOT NULL de la tabla (las
de la PK); todas las demás admiten nulos. No hay una omisión capaz de romper
el alta en el hospital.

### ✅ Defecto encontrado y corregido: la cancelación de una fila entre un millón

`copiarAAnuladas()` copiaba `NU_NUME_MOVI_CIT` tal cual, y esa columna
**admite nulos en `CITAS_MEDICAS` y NO los admite en `CITAS_ANULADAS`**. En el
catálogo vivo hay exactamente **una** fila así en 1.084.093 (bloque 29f).
Bastaba esa una: cancelarla revienta con el error 515, la transacción se va
atrás entera, y el paciente ya recibió "cancelada" por WhatsApp mientras el
hospital conserva la cita — el fallo más caro que puede tener el espejo.

Se comprobó además, columna a columna contra `esquema-real.tsv`, que es la
**única** del copiado con esa asimetría. Reproducido contra el SQL Server del
mock (que hereda la misma nulabilidad): copia vieja → error 515; con
`COALESCE(NU_NUME_MOVI_CIT, 0)` → archiva con `movi=0`. El 0 es el mismo valor
que este driver escribe al crear, así que no inventa un consecutivo ajeno.
Dos pruebas nuevas en `create-appointment.spec.ts`.

### 🚨 Convenios — los NIT estaban cruzados (2026-09-02)

La sección D del archivo de pendientes se corrió y encontró más de lo que
buscaba.

**El hallazgo.** La tabla `EPS` del hospital dice `800088702` = EPS
SURAMERICANA y `900156264` = NUEVA EPS, que son los NIT públicos correctos.
**AgenIA los tenía al revés** en su tabla `Eps`, y `mapping.json` repetía el
mismo cruce. Los dos errores se cancelaban: el convenio salía bien por
accidente. Nadie lo habría visto hasta que alguien "arreglara" uno solo — y en
ese momento la facturación se voltea en silencio, sin un error, sin un log.

**Lo que además estaba mal, y sí facturaba mal hoy.** Con los NIT ya
descruzados, dos de las ocho combinaciones no coincidían con lo que hace el
hospital:

| Combinación | Antes | Ahora | Cuota real (90 días) |
|---|---|---|---|
| Nueva EPS · contributivo · normal | 283 NUEVASUBSID | **473 CONTRIBUTIVO** | 73,4 % de 2.406 |
| Nueva EPS · contributivo · PyP | 489 PYPSUBS | **473 CONTRIBUTIVO** | 65,6 % de 390 |

Las dos mandaban a un paciente **contributivo** a un contrato **subsidiado**.
La segunda venía de que la clave de PyP era `${nit}|PYP`, sin régimen: se
aplicaba a cualquier régimen de esa EPS. Ahora es `${nit}|${REGIMEN}|PYP`, y
solo Nueva EPS subsidiado la tiene — Sura no tiene convenio propio de PyP, usa
el de su régimen (467 en el 94,3 % de 2.566 citas).

**Verificado en vivo.** Cita real por WhatsApp de una paciente de Nueva EPS
contributivo → fila en `CITAS_MEDICAS` con `NU_NUME_CONV_CIT = 473`. Antes
habría escrito 283.

**El candado.** `mapping.spec.ts` ahora carga el `mapping.json` **real** (el
que se aplica a `HospitalMirrorConfig.mappingJson`) y fija las ocho
combinaciones **por nombre de EPS**, no por NIT. Un test escrito sobre NITs no
habría notado nada: ni el cruce, ni el arreglo. Doce pruebas nuevas.

✅ **Y el fan-out no cambia la conclusión.** `R_PAC_EPS` es un historial
many-to-many, así que la cita de un paciente con varias afiliaciones se cuenta
una vez por afiliación — por eso Nueva EPS contributivo sale al 73 % y no al
85-94 % del resto. La vía obvia de deduplicar (quedarse con los pacientes de
una sola afiliación) **no existe aquí**: esa consulta devolvió cero filas,
porque todo paciente acumula varias.

Pero no hace falta. El fan-out solo puede **inflar** un conteo, nunca
esconderlo, así que sumar por convenio da una **cota superior** del uso real.
Nueva EPS contributivo arrastra ~3.550 filas de cita; esas citas se
facturaron a algo, y el único convenio de contributivo con volumen es el 473
(cota ≤ 6.285). El 290 `NUEVAEPSCONT` —el candidato "correcto" por nombre—
tiene una cota superior de **dos** citas en 90 días: el hospital no lo usa.
Queda descartado sin deduplicar nada.

Los códigos de régimen tampoco son una suposición: el 01 lleva a 467 `SUBS`,
283 `NUEVASUBSID` y 489 `PYPSUBS` — tres nombres independientes que dicen
"subsidiado" — y el 07 a 473 `CONTRIBUTIVO`. Leer el catálogo `REGIMEN`
(consulta **D.7**, que sí existe) confirmaría la lectura, pero la tabla no
depende de ello.

> **Al desplegar en producción:** son DOS cambios que van juntos —
> `UPDATE "Eps" SET nit=…` (intercambio en tres pasos, la llave
> `(organizationId, nit)` es única) y `aplicar-mapping.ts`. Aplicar uno solo
> voltea la facturación.

### 🚨 El turno NO define el servicio — el modelo de cupo hay que cambiarlo (2026-09-02)

La sección A del archivo de pendientes se corrió y la respuesta es la mala.

| servicios en el turno | turnos | % |
|---|---|---|
| 1 | 512 | 27,5 % |
| 2 | 669 | 36,0 % |
| 3 | 394 | 21,2 % |
| 4 | 136 | 7,3 % |
| 5 | 88 | 4,7 % |
| 6 | 50 | 2,7 % |
| 7 | 11 | 0,6 % |

**El 72,5 % de los turnos mezcla servicios.** Y la puerta de atrás también
está cerrada: `CD_CODI_ESP_TUME` está en NULL en los **1.223 turnos futuros**.
El turno no trae servicio ni especialidad — no existe ninguna fuente de
"servicio" a nivel de turno.

**Por qué importa.** Entre los servicios que conviven hay unos de PyP y otros
no (`890201-CI` Citas de PyDT, `997301-1` Salud oral doble, `I890305PL`
planificación familiar, `I890301AG` control gestante). El convenio depende de
si el servicio es de PyP, así que esto no es catalogación: es facturación.

**Qué hace AgenIA hoy.** `mirror-availability.service.ts` le pone a cada cupo
el `DoctorProfile.serviceId` — el único servicio configurado del médico. De
ahí salen dos cosas:

- **Sub-oferta.** De los N servicios que presta el médico, el chatbot solo
  puede ofrecer uno. Incompleto, no incorrecto.
- **Código de servicio equivocado en el HIS.** Si el paciente pide una cosa y
  el médico tiene configurada otra, `CD_CODI_SER_CIT` viaja mal — y si la
  diferencia cruza la frontera PyP, el convenio también.

El propio código ya lo anticipaba: *«el turno es del médico, y el servicio se
elige al agendar»*. Se resolvió por el camino corto porque
`ScheduleSlot.serviceId` es obligatorio. Los datos dicen que no alcanza.

#### El cambio de modelo que exige el go-live completo

El servicio deja de ser una propiedad del CUPO y pasa a serlo de la CITA. El
chatbot ya pregunta el servicio ANTES de mostrar cupos, así que el dato existe
en el momento correcto — solo no se está guardando donde toca.

1. `ScheduleSlot.serviceId` → opcional (el cupo pasa a ser "médico + hora").
2. `Appointment.serviceId` → nuevo, obligatorio.
3. `DoctorProfile.serviceId` (uno) → relación N:M médico↔servicios. La fuente
   la da el propio HIS: `R_MEDI_ESPE ⋈ R_ESP_SER` (bloque 32: cobertura total,
   0 médicos y 0 servicios sin fila), refinada con lo que cada médico hace de
   verdad en 90 días.
4. `getAvailableSlots()` filtra por *médicos que prestan ese servicio*, no por
   `slot.serviceId`.
5. `bookAppointment()` recibe y persiste el `serviceId` elegido.
6. La hidratación del outbox resuelve `serviceExternalKey` desde
   `Appointment.serviceId` en vez de `ScheduleSlot.serviceId`.
7. Migración de las citas existentes: heredan el servicio de su cupo.

Es decisión de producto además de técnica — cambia qué significa un cupo en
todo el sistema, no solo en el espejo.

#### Mientras tanto: la puerta del piloto (sección E)

El piloto se activa médico por médico (`DoctorProfile.whatsappBookingEnabled`),
y no todos los médicos tienen el problema. La sección E los clasifica en tres
semáforos:

- 🟢 **VERDE** — presta un solo servicio. Lo que AgenIA escriba es exacto.
- 🟡 **AMARILLO** — varios servicios, pero todos de la misma especialidad y
  todos del mismo lado de la frontera PyP. Convenio y especialidad salen bien;
  solo el código de servicio puede ser impreciso.
- 🔴 **ROJO** — mezcla especialidades o cruza PyP. El convenio puede salir mal.

**Resultado (2026-09-03).** El semáforo binario de E dio 0 verdes / 14
amarillos / 15 rojos, pero era demasiado severo: clasificaba en rojo a un
médico por **una sola cita** de PyP entre cientos. El detalle de la consulta F
permitió reclasificar con un umbral de ruido (minoría < 2 %):

| | Médicos | Situación |
|---|---|---|
| 🟢 | **4** | Un servicio concentra ≥ 95 % (76, 077, 91-1, 91-2). ~9.400 citas/90 días |
| 🟡 | **20** | Misma familia, el PyP es ruido. La **factura sale bien** |
| 🔴 | **6** | Mezcla PyP real: 77, 80-1, OD02, OD05, OD07, PS06 |

Solo **6 de 30** pueden facturar mal. En los tres odontólogos el culpable es el
mismo: `990203` EDUCACIÓN INDIVIDUAL POR ODONTOLOGÍA es PyP y pesa un cuarto de
sus citas.

**Y F reveló la estructura que la pregunta abstracta escondía:** casi todas las
familias se parten en **primera vez / control** (internista 45/55, ginecología
68/32, pediatría 38/63, nutrición 87/13, psicología 74/26). Eso convierte una
decisión de configuración en una pregunta que el chatbot le puede hacer al
paciente —«¿es su primera vez o es un control?»—, que es natural y la resuelve
sola. Es la propuesta del bloque 2 de `PREGUNTAS_AL_HOSPITAL.md`.

Además aparecieron pares `ESP`/`SUR` con la misma descripción en los dos
especialistas (ES01, ES03). Si `SUR` = Sura, el código depende de la EPS y
AgenIA lo resuelve sin preguntar nada: la consulta **G** lo comprueba.

El piloto realista son los 4 verdes de inmediato y los 20 amarillos en cuanto
el hospital apruebe la pregunta de primera vez / control.

### 🚨 El lector del HIS no era tolerante — y el 5,7 % de las citas lo habría tumbado (2026-09-03)

La consulta que añadí para medir la data sucia dio un número que no esperaba:
**419 de 7.403 citas elaboradas en 30 días (5,7 %) tienen un `FE_HORA_CIT` que
no se puede interpretar** — longitudes 12/13, `'2026/08/29 1'`, `'31'`.

`MAPEO_HIS.md` §2.1 lo exige desde el bloque 5: *«el lector del agente debe ser
tolerante; el escritor, estricto»*. El escritor lo era. **El lector no.**
`feHoraCitAIso` lanzaba, y se llamaba sin protección en los dos únicos sitios
donde el agente LEE el HIS:

| Sitio | Qué se caía |
|---|---|
| `detectChanges` (vía `eventoDeCita`) | La vuelta ENTERA de detección HIS → AgenIA. Una fila sucia y el hospital deja de espejarse. |
| `snapshotAppointments` | La reconciliación diaria completa — la última red contra la deriva silenciosa (capa 5 del plan). |

Bastaba **una** de esas 419 dentro de la ventana de 90 días. No se había visto
porque el mock local tiene datos limpios: el mismo punto ciego que escondió el
`NO_NOMB_PAC varchar(20)` y las cuatro columnas inexistentes de
`CITAS_ANULADAS`.

**Arreglo.** `feHoraCitAIsoOrNull()` — variante tolerante que devuelve `null`.
Los dos lectores la usan, omiten la fila y **llevan la cuenta**, con un aviso
por vuelta. El escritor sigue con la versión estricta: poner en la agenda del
hospital una hora que su aplicación no sabe leer sí es inaceptable.

#### Y un segundo defecto que salió al escribir la prueba

El regex `^\d{4}/\d{2}/\d{2} \d{2}:\d{2}$` comprueba la **forma**, no el
**rango**, y `Date.UTC` desborda en silencio:

| Entrada | Se convertía en |
|---|---|
| `2026/08/29 99:99` | 2 de septiembre |
| `2026/13/45 10:00` | **14 de febrero de 2027** |
| `2026/02/30 10:00` | 2 de marzo |

Sobre la fecha de una cita eso no es un error de formato: es reportar un cambio
en un día que no es, o mover la cita de un paciente durante la reconciliación
— sin un solo mensaje de error. Se añadió comprobación de ida y vuelta: si al
reconstruir la fecha no salen los mismos componentes, se rechaza. El 29 de
febrero de un año bisiesto sigue siendo válido.

**23 pruebas nuevas.** El agente pasa de 336 a 357.

### 📋 El cuestionario para el hospital (2026-09-03)

Todo lo que queda abierto que NO se puede resolver leyendo la base está
consolidado en **`PREGUNTAS_AL_HOSPITAL.md`** — seis decisiones, escritas para
que las responda la agendadora sin traducir nada técnico.

La regla al redactarlo: **nada de preguntas abiertas.** Cada una llega con lo
que ya medimos sobre sus propios datos y con opciones marcables, de modo que
responder sea confirmar o corregir, nunca reconstruir de memoria. La pregunta 1
(qué servicio lleva una cita de WhatsApp) va acompañada de la consulta **F**,
que produce el detalle por médico —qué servicios presta y en qué proporción—
para que la conversación sea sobre casos concretos y no sobre el problema en
abstracto.

| # | Quién responde | Qué desbloquea |
|---|---|---|
| 1 | Agendadora | 🔴 El piloto. Por médico: servicio fijo, preguntarle al paciente, o no activar |
| 2 | Agendadora | El consecutivo de sesión: ¿algún informe agrupa por él? |
| 3 | Agendadora / facturación | Confirmar la tabla de convenios que dedujimos |
| 4 | Coordinación | Alcance del arranque: qué médicos, cuántas citas/día |
| 5 | Agendadora / TI | El origen del 5,7 % de citas con hora ilegible |
| 6 | TI | Ventana de domingo, VM, `AGENIA_SYNC`, medición de carga |

El documento cierra con la lista de lo que **ya** está resuelto y verificado,
para que la reunión no empiece explicando de cero.

### 📄 Qué falta correr en el hospital

Todo lo que queda por descubrir está consolidado en
`sql/PENDIENTE_CORRER_EN_HOSPITAL.sql` — 100 % lectura. La sección D ya se
corrió y quedó cerrada; la **A** también (obliga a cambiar el modelo de cupo),
y la **B** y la **E** igual. Queda por correr la **F** —el detalle por médico
que alimenta la reunión— y la pestaña *Messages* de **C**.

## ⏳ Pendientes de este driver

0. **Bloque 29 — corrido, falta solo la medición de 29c/29d.** (`sql/FASE0_DESCUBRIMIENTO_HIS.sql`)
   — ¿cuánto le cuesta al hospital que el agente relea su agenda cada 5
   segundos? Mide índices y tamaño de `CITAS_MEDICAS`/`TURNOS_MEDICOS`, y
   compara las DOS formas de la consulta: la actual (que envuelve la columna
   en `CONVERT` y por tanto **no es sargable** — ningún índice la puede
   servir) contra una candidata equivalente que deja la columna desnuda. La
   equivalencia ya está verificada contra el mock en los bordes; falta el
   costo real. De ahí sale si el arreglo es cambiar código nuestro, pedirle un
   índice al hospital, o bajar la frecuencia del bucle de entrada — que hoy
   comparte el intervalo de 5s del long-poll de salida sin motivo. De paso
   resuelve dos preguntas de una línea: si existen de verdad claves
   (médico+hora) duplicadas, y si `NU_NUME_MOVI_CIT` llega a ser NULL.

0c. **Bloque 31 preparado, pendiente de correr — ¿de qué servicio es un cupo?**
   Lo abre el hallazgo 30f: 47 médicos prestan más de un servicio (uno, once), y
   AgenIA le pone a cada cupo el ÚNICO servicio del médico porque
   `TURNOS_MEDICOS` no lleva servicio. Hoy eso significa que de los once que
   presta ese médico el chatbot solo puede ofrecer uno, y que si el paciente
   reserva, `CD_CODI_SER_CIT` viaja con el servicio equivocado — el mismo que
   determina el convenio de facturación.

   La pregunta decisiva del bloque no es cuántos servicios presta el médico
   (ya se sabe) sino **si un mismo bloque de turno mezcla servicios**. Cada
   cita se asocia a SU turno por médico, fecha y hora dentro del rango, para
   no confundir el turno de la mañana con el de la tarde. Dos desenlaces muy
   distintos: si cada turno es de un servicio, el cupo lo hereda y no hay que
   tocar el modelo de AgenIA; si los turnos mezclan, el cupo es "médico+hora"
   y el servicio lo elige el paciente — y eso cambia el modelo de
   disponibilidad (`ScheduleSlot.serviceId` es obligatorio hoy), que ya es
   decisión de producto y no solo de espejo.

   De paso cierra el bloque 21b, aplazado hace tiempo: de dónde sale
   `CD_CODI_ESP_CIT`. El driver la resuelve con `especialidadPorServicio` del
   mappingJson, escrita a mano a partir de una muestra de dos servicios; si
   cada servicio usa siempre la misma especialidad, esa tabla se puede generar
   de los datos. También descubre si `R_ESP_SER` existe siquiera — no salió en
   el volcado del bloque 28 porque no estaba en su lista.

0a. **Bloque 30 preparado, pendiente de correr** — el insumo de la
   homologación. `MirrorEntityMap` es la tabla de equivalencias entre los
   médicos/servicios de AgenIA y los códigos del hospital, y **hoy no existe
   quien la escriba**: cinco piezas del motor la leen, ninguna la produce (las
   6 filas del entorno de desarrollo se metieron a mano). Sin ella no se
   generan cupos, no sale ni entra ninguna cita, y —lo más traicionero— con el
   espejo encendido `buildDoctorFilter()` devuelve `id: { in: [] }` y **el
   chatbot deja de ofrecer citas a todo el mundo, sin un solo error en el
   log**.

   El bloque mide lo que decide el diseño de la herramienta: cuántos médicos
   hay que homologar de verdad (solo los que tienen turnos futuros, no toda la
   tabla `MEDICOS`), si la **cédula** sirve como clave de emparejamiento
   automático (`NU_DOCU_MED` es nullable), qué significa `NU_ESTA_MED` —una
   hipótesis abierta desde el bloque 2, verificada aquí por cruce contra los
   turnos futuros, la misma técnica que cerró `NU_SEXO_PAC`—, si
   `TX_EMAIL_MED` permite crear los `User` que `DoctorProfile` exige, cuáles de
   los 1.280 servicios agendables mueven de verdad las citas, y si algún médico
   atiende más de un servicio (lo que dejaría corto a `DoctorProfile.serviceId`
   para generar cupos).

   🔐 Las consultas devuelven **indicadores, no cédulas**: para decidir el
   diseño basta saber si están completas y si son únicas. El emparejamiento
   real lo hará el agente contra la base, sin que nadie copie datos personales
   a un chat ni al repositorio.

0b. **Distinguir "no asistió" de "canceló" en la entrada.** El no-show del
   hospital llega como una cancelación (DELETE + `CITAS_ANULADAS` con motivo
   `NA`), así que AgenIA lo guarda como `CANCELLED` en vez de `NO_SHOW`. El
   driver ya escribe `CD_CODI_MOTI_CIAN` al cancelar, pero no lo LEE al
   detectar una cancelación entrante — habría que correlacionar la fila que
   desaparece con la recién archivada (mismo médico+hora+historia,
   `FE_ELAB_CIAN` reciente, como describe MAPEO_HIS.md §2.2) y mapear `NA` →
   `NO_SHOW`. No es urgente: la cita queda cerrada de todos modos y el cupo
   liberado correctamente; lo que se pierde es la estadística de inasistencia.

1. **Encontrar la fuente de "Asignada Por"** (bloque 24) — búsqueda directa por nombre de columna dio vacío; candidatos: `AUDITORIA_COT`, `HIST_AUDIT`, `LOG_AUDITORIA_SGIO`, `USUARIO`. Si no aparece en ninguna tabla, la alternativa es pedir al hospital un usuario/login propio de la aplicación (`AGENIA`/`WHATSAPP`) para que quede registrado como origen al insertar.
2. **Decidir el código de motivo de cancelación del agente:** reutilizar `WB` (CANCELADO WEB, ya existe, 90 usos históricos) o pedir uno dedicado (ej. `WA`) — mismo espíritu que "Asignada Por", para que el hospital distinga sus reportes.
3. **Fuentes contextuales del INSERT (bloque 21):** consecutivo de sesión (`CONEXION*`/`CONSECUTIVOS`), especialidad (¿`R_ESP_SER`?), consultorio/centro de costos/sede (`CONSULTORIOS`). Última milla del INSERT. **Consultorio: esquema de `CONSULTORIOS` ya CONFIRMADO** (2026-08-28, captura SSMS — ver `MAPEO_HIS.md` §2.5bis); falta validar a escala la regla "consultorio = turno del médico ese día" (bloque 25 de `FASE0_DESCUBRIMIENTO_HIS.sql`, ya preparado) y confirmar si el código real del consultorio del médico 76 es `'51'` (hipótesis corregida a partir de un comprobante impreso: "51-CONSULTORIO APS-01").
4. **Validar la tabla de decisión de convenios con la agendadora** del hospital.
5. **Proveedor del HIS:** pista fuerte = **CNT Sistemas de Información** (jobs/backups `copia_cnt`, `…_cnt.bak` — bloque 20a); confirmar con TI, junto con soporte vigente.
6. **Alcance de `CITAS_TELEMEDICINA`** (¿entra al espejo?). Su probable tabla hermana `CITAS_TELEMEDICINA_ANULADAS` (por confirmar) seguiría el mismo patrón recién descubierto.
7. *(Ya no bloqueante, opcional)* Reagendamiento no probado explícitamente — hipótesis: cancelación + nueva alta, a confirmar con una prueba corta adicional si el hospital tiene disponibilidad.
8. ~~Generar el token del agente y la fila `HospitalMirrorConfig`~~ ✅ hecho en el entorno de desarrollo/pruebas (ver sección "En curso" arriba) — falta activarla (`enabled=true`) el día que se valide conectividad real con la VM.
9. ~~**Nombre partido del paciente**~~ ✅ **RESUELTO (2026-09-01, bloque 27a).** `PACIENTES` tiene 62 columnas —no las 13 documentadas— y el nombre va partido en cuatro, igual que `MEDICOS`: `NO_NOMB_PAC` varchar(20) NOT NULL (primer nombre), `NO_SGNO_PAC` varchar(20), `DE_PRAP_PAC` varchar(30), `DE_SGAP_PAC` varchar(30). El 98,3% de los pacientes tiene una sola palabra en `NO_NOMB_PAC` (bloque 27b), confirmando que es "primer nombre" por diseño. **Destapó un defecto que rompía producción:** el driver escribía el nombre completo en esa columna de 20 caracteres, y el mock local la declaraba de 60, así que nunca falló en pruebas — en el hospital habría reventado el INSERT (error 8152) para casi cualquier paciente. Corregido con `partirNombre()` y con el esquema real replicado en el mock. **La ambigüedad se cerró preguntando** (2026-09-01): el chatbot pide *nombres* y *apellidos* en dos turnos, `PatientProfile` guarda los dos por separado y la frontera viaja hasta el driver. "JUAN CARLOS PEREZ" —que la heurística habría partido como `JUAN | CARLOS | PEREZ`, con el apellido equivocado— ahora llega correcto: `JUAN | CARLOS` de nombres y `PEREZ` de apellido. La heurística (`partirNombre`) queda solo para los pacientes anteriores al cambio y los que no entran por WhatsApp. La lista de espera sigue pidiendo el nombre completo de una vez: no llega al HIS, así que no necesita la frontera ni le cuesta un turno al paciente.

10. *(Verificados ya:* jobs del servidor no interfieren ✔; turnos tipo 1 no existen a futuro ✔; `TIPOSERVICIO` completo — el valor 1 no existe ✔.*)*

## Dependencia técnica pendiente de verificar (Fase 1, motor genérico)

¿Ya existe infraestructura de envío de email transaccional en `apps/api`, o hay que añadirla para las alertas de conflicto? El stack actual es WhatsApp-céntrico — a confirmar antes de implementar el canal de email de `MirrorConflictAlert` (esto aplica al motor genérico, no solo a este driver, pero se detectó al diseñar la alerta que pidió este hospital).

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

0d. **Bloque 32 preparado, pendiente de correr — la regla de la especialidad.**
   El bloque 31 dejó `CD_CODI_ESP_CIT` a medio cerrar: 36 de los 40 servicios
   principales usan siempre la misma especialidad, pero cuatro usan dos. Y
   tienen explicación: el mismo "Examen clínico de primera vez" (`S36101`) sale
   como 461 cuando lo hace la odontóloga y como 572 cuando lo hace la
   higienista. **La especialidad no la decide el servicio: la decide quién
   atiende.**

   El 31a confirmó las dos piezas que faltaban — `R_ESP_SER` (desde qué
   especialidades se presta un servicio, N:M) y `R_MEDI_ESPE` (las del médico)
   — así que la hipótesis a probar es:

       especialidad = R_ESP_SER(servicio) ∩ R_MEDI_ESPE(médico)

   El bloque la contrasta contra las citas reales de 90 días. Si acierta,
   `especialidadPorServicio` deja de ser una tabla escrita a mano en el
   mappingJson (hoy hecha desde una muestra de dos servicios) y pasa a ser una
   regla que el driver resuelve contra el propio HIS. Cierra el bloque 21b.

   Empieza por lo que puede tumbarlo todo: si `R_ESP_SER` no cubre los
   servicios que de verdad se agendan, no hay regla. La muestra del 31f
   devolvió códigos ('04', '05', '25') que no se parecen a los de las citas —
   puede ser solo efecto del ORDER BY, o puede que vivan en otra familia.

   ✔ La lógica ya está probada contra el mock con el caso ambiguo real
   sembrado: `S36101` × `OD05` → la intersección deja una sola especialidad
   (461) y coincide con la cita.

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

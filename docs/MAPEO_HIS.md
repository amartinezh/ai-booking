# Mapeo del HIS del Hospital — Fase 0 (Descubrimiento)

> **Fuente:** inspección en vivo vía SSMS sobre `192.168.1.16`, BD `ESEHSVP2025`, 2026-08-23.
> **Complementa:** `docs/PLAN_ESPEJO_HOSPITAL.md`. Scripts asociados: `docs/sql/FASE0_DESCUBRIMIENTO_HIS.sql` y `docs/sql/AGENIA_SYNC_SETUP.sql`.
> Las interpretaciones marcadas **(hipótesis)** deben confirmarse con las queries del script de descubrimiento antes de escribir una sola fila productiva.

---

## 0. Bitácora del descubrimiento (cómo llegamos a cada conclusión)

Todas las rondas se corrieron el 2026-08-23 con `docs/sql/FASE0_DESCUBRIMIENTO_HIS.sql`; los números de bloque de esta tabla son los del script.

| Ronda | BD consultada | Bloques | Qué produjo |
|---|---|---|---|
| 1 | `PRUEBAS` | 0–13 | PK compuesta de citas; formato de `FE_HORA_CIT`; estados 0/1/2; **refutación** del doble rol (no hay cupos materializados); historia = documento; defaults de pacientes; `ID_CITA_SER='1'` = agendable; sin triggers/SPs/módulo web ⇒ vía DML directo. |
| 2 | BD creída "producción" (resultó ser el **archivo** `ESEHSVP2025`) | 0, 13–16 | Bloque 14 vacío, 818 citas/90d, 1 médico con turnos ⇒ **alerta**: esa BD no recibía citas hace meses → nace la pregunta del catálogo vivo (se crea el bloque 18). |
| 3 | `ESEHSVP` | 13–16, 18–19 | **Catálogo vivo confirmado = `ESEHSVP`** (los sufijos de año son archivos anuales; no hay rollover); plantilla del INSERT campo a campo; regla de convenios (EPS+régimen+PyP); turnos vivos de 27 médicos. |
| 4 | `ESEHSVP` | 20 | Jobs del servidor: solo backups/mantenimiento, **ninguno toca citas** ✔; pista del proveedor (`cnt`); tablas candidatas del consecutivo de sesión (`CONEXION*`, `CONSECUTIVOS`); `R_MEDI_ESPE` (especialidades por médico); catálogo de sedes (`LUGAR_ATENCION`); cero turnos futuros tipo 1 ✔; `TIPOSERVICIO` completo (el valor 1 no existe) ✔. |
| Pendiente | `PRUEBAS` (app) / `ESEHSVP` | **17 (manual)** + 21 | Ciclo de vida de la cita desde la aplicación (LA crítica — correo enviado, `docs/CORREO_PRUEBA_HIS.md`) + fuentes exactas de `CONE/ESP/CONS/CECO/LUAT`. |

## 1. Entorno confirmado

| Ítem | Valor | Implicación |
|---|---|---|
| Motor | SQL Server 2017 **Standard** (64-bit), 14.0.3465.1, RTM-CU31-GDR | Change Tracking ✅, CDC ✅, SQL Server Agent ✅ — todas las opciones de detección de cambios están disponibles. |
| Sistema operativo | **Linux — Ubuntu 18.04.6 LTS** (¡no Windows!) | El agente espejo NO corre en el host de la BD por defecto: corre en la estación Windows (192.168.1.25) como servicio WinSW, o como servicio systemd en el host Ubuntu si TI lo permite y tiene salida a internet. Ubuntu 18.04 está **fuera de soporte estándar desde abril 2023** → informar a TI (riesgo de seguridad; no es nuestro alcance tocarlo). |
| Servidor / reloj | `sql2017-pro2-dp`, collation `Modern_Spanish_CI_AS`, reloj UTC-05:00 (America/Bogota) — bloque 0 ✅ | Coincide con la regla de fechas del repo: protocolo en UTC, conversión en frontera con `America/Bogota`. Collation CI: comparaciones de texto sin distinción de mayúsculas. |
| BD de trabajo | **`PRUEBAS`** (copia del HIS) para todo el desarrollo/validación | Todo INSERT/UPDATE de prueba va contra `PRUEBAS`. Backup previo a cualquier intervención en producción. |
| ✅ **Catálogo VIVO = `ESEHSVP`** (confirmado por bloque 18, 4ª corrida) | `ESEHSVP`: 1.081.879 citas, última elaboración **2026-08-22 13:07**, 1.652 elaboradas en 7 días. `ESEHSVP2024`: corte 2025-01-15, 0 recientes. `ESEHSVP2025`: corte 2026-01-20, 0 recientes. `PRUEBAS`: copia de `ESEHSVP` del 2026-08-15. | Las BD con sufijo de año son **archivos de corte anual** ⇒ **NO existe rollover**: el agente apunta siempre a `ESEHSVP`. `PRUEBAS` se refresca copiando `ESEHSVP` cuando haga falta re-validar. La alerta de frescura del catálogo queda igualmente en el diseño (defensa permanente). |
| Prueba de inserción | INSERT en `dbo.CITAS_MEDICAS` con 7 columnas pasó constraints y FKs (transacción con ROLLBACK) | La estructura mínima es viable. ⚠️ Aquel test usó `'2026-08-23 10:30'` (guiones); el formato real de la app es con **barras** `'YYYY/MM/DD HH:MM'` (§2.1). Pendiente la prueba de fuego: que la cita insertada **se vea y sea usable en la aplicación del HIS** (validar en `PRUEBAS`). |
| Jobs del servidor (bloque 20a) | Solo mantenimiento: backup **diario** y mensual de `ESEHSVP` a `/media/copias/…_cnt.bak`, shrink de logs (con flip temporal a RECOVERY SIMPLE — rompe la cadena de log; nota cortés para TI), y un SP contable (`PA_REVISA_SALDOS`). SQL Agent activo ✔ | **Ningún job toca `CITAS_MEDICAS`/`TURNOS_MEDICOS`/`PACIENTES`** ⇒ nada interfiere con el sync. El backup diario es la vía natural para **refrescar `PRUEBAS`** (restaurar el `.bak` del día). |
| 🧩 Proveedor del HIS (pista fuerte) | Los jobs y archivos de backup se llaman `copia_cnt` / `…_cnt.bak` | Hipótesis: el HIS es de **CNT Sistemas de Información** (proveedor colombiano frecuente en ESEs). Confirmar con TI — respondería el pendiente "proveedor del HIS". |

## 2. Tablas núcleo descubiertas

### 2.1 `dbo.CITAS_MEDICAS` — tabla central de citas

FKs confirmadas:
- `CD_CODI_MED_CIT` → `MEDICOS.CD_CODI_MED`
- `NU_HIST_PAC_CIT` → `PACIENTES.NU_HIST_PAC`
- `CD_CODI_SER_CIT` → `SERVICIOS.CD_CODI_SER`

**PK confirmada (2026-08-23): `PKCITAS_MEDICAS` = (`CD_CODI_MED_CIT`, `FE_HORA_CIT`, `NU_ESTA_CIT`)** — compuesta, con la hora como varchar y **el estado dentro de la clave**. Implicaciones:

1. ✅ **Formato confirmado (bloque 5):** `FE_HORA_CIT` = fecha+hora completa con **barras**: `'YYYY/MM/DD HH:MM'` (16 chars, 24h, cero a la izquierda; ej. `'2026/10/17 09:20'`). Convive data legada sucia (longitudes 12/13, incluso `'31'` — e incluso una fila de 2026 con `'2026/08/29 1'`): el **lector** del agente debe ser tolerante; el **escritor**, estricto al formato de 16 chars. El INSERT de prueba con guiones pasó constraints pero NO es el formato de la app — jamás escribir con guiones. |
2. Con el estado en la PK pueden **coexistir varias filas del mismo médico+hora con estados distintos** (p. ej. una cancelada y una reasignada del mismo cupo). La "cita vigente" de un cupo = la fila cuyo estado esté en el conjunto activo.
3. Cambiar el estado cambia la clave: o el HIS hace UPDATE de la columna de PK en sitio, o **inserta una fila nueva por transición**. Cuál de las dos es ahora **LA pregunta crítica** (prueba manual del bloque 4): define cómo interpretamos los eventos HIS→AgenIA y el diseño de `MirrorMap`.
4. Change Tracking es viable (hay PK) ✅ — nota: un UPDATE sobre columna de PK aparece en CT como DELETE+INSERT.
5. Identidad estable para `MirrorMap`: **clave de cupo** = `CD_CODI_MED_CIT + '|' + FE_HORA_CIT` (estable), con el estado seguido aparte; la cita de AgenIA se enlaza al *cupo*, no a una fila física.
6. Bonus de concurrencia: si el agente intenta insertar una fila (médico, hora, estado-activo) que ya existe, la violación de PK es la señal natural de **colisión de cupo** — el análogo exacto de nuestro `SLOT_TAKEN_OR_INVALID` / P2002, se mapea a conflicto (gana el hospital).

| Columna | Tipo | Nulos | Interpretación |
|---|---|---|---|
| `CD_CODI_MED_CIT` | varchar(4) | NO | Médico (FK). **Parte 1 de la PK.** |
| `FE_HORA_CIT` | varchar(18) | NO | **Parte 2 de la PK** ⇒ fecha+hora completa como texto (única por médico). Formato exacto por confirmar (bloqueante #2); el test usó `'2026-08-23 10:30'` y pasó, pero manda el formato que la UI del HIS escribe/lee, byte a byte. |
| `NU_ESTA_CIT` | tinyint | NO | **Estado de la cita — Parte 3 de la PK** (¡el estado integra la clave! ver implicaciones arriba). Catálogo de valores por descubrir (bloqueante #3). |
| `CD_CODI_SER_CIT` | varchar(12) | SÍ | Servicio (FK). **Nullable.** |
| `NU_HIST_PAC_CIT` | varchar(20) | SÍ | Paciente (FK). **Nullable** — ver hipótesis clave abajo. |
| `NU_DURA_CIT` | int | SÍ | Duración en minutos **(hipótesis)**. |
| `FE_ELAB_CIT` | datetime | SÍ | Timestamp de creación del registro **(hipótesis)**. |
| `FE_FECH_CIT` | datetime | SÍ | Fecha de la cita (el test usó formato `'YYYYMMDD'`). |
| `NU_DIA_CIT` | tinyint | SÍ | Día de la semana **(hipótesis)**. |
| `NU_NUME_MOVI_CIT` | int | SÍ | Consecutivo/movimiento. **Descartado como PK** (la PK es compuesta); su análogo `NU_NUME_MOVI_CITE` sí integra la PK de `CITAS_TELEMEDICINA`. |
| `NU_PRIM_CIT` | tinyint | SÍ | ¿Primera vez? **(hipótesis)**. |
| `NU_NUME_CONE_CIT`, `NU_CONE_CALL_CIT` | int | SÍ | ¿Consecutivos de conexión / call center? **(hipótesis)**. |
| `CD_CODI_ESP_CIT` | varchar(3) | SÍ | Especialidad. |
| `CD_CODI_CONS_CIT` | varchar(8) | SÍ | ¿Consultorio? **(hipótesis)**. |
| `NU_NUME_CONV_CIT` | int | SÍ | **Convenio/contrato (facturación EPS)** — importante para que la cita facture (bloqueante #6). |
| `NU_TIPO_CIT` | tinyint | SÍ | Tipo de cita. |
| `DE_DESC_CIT` | varchar(600) | SÍ | Descripción/observaciones. |
| `NU_AUTO_AGRU_CIT`, `TX_PEND_AGRU_CIT` | int / varchar(1) | SÍ | ¿Autorización / agrupación? **(hipótesis)**. |
| `CD_CODI_EST_CIT`, `CD_CODI_CAMP_CIT` | varchar(3) | SÍ | ¿Estado admin? / campaña. |
| `CD_CODI_CECO_CIT` | varchar(11) | SÍ | Centro de costos. |
| `CD_CODI_LUAT_CIT` | varchar(2) | SÍ | Lugar de atención (FK probable a `LUGAR_ATENCION`). |
| `FE_SOLI_CIT` | datetime | SÍ | Fecha de solicitud. |
| `NU_CODIGO_HSWE_CIT` | tinyint | SÍ | Vínculo con módulo web del HIS (`HOM_SERV_WEB`) **(hipótesis)** — ver §2.6. |
| `NU_MOD_CIT` | tinyint | SÍ | ¿Modalidad (presencial/tele)? **(hipótesis)**. |

> **🔑 Hipótesis del doble rol: ❌ REFUTADA (bloque 6, 2026-08-23).** No existe NINGUNA fila futura con paciente NULL (5.716 futuras con paciente en estado 0, 2 en estado 1, cero sin paciente). `CITAS_MEDICAS` solo guarda **citas asignadas** (y su historial). La disponibilidad la calcula la aplicación del HIS dinámicamente: **bloques de turno en `TURNOS_MEDICOS` menos citas ya ocupadas**. Consecuencia de arquitectura: los cupos libres NO se espejan como filas al HIS — los `ScheduleSlot` de AgenIA para la organización espejada se **derivan** importando `TURNOS_MEDICOS` y restando `CITAS_MEDICAS` ocupadas (ver §6, decisión de agenda).

#### Resultados 2ª ronda (2026-08-23) — hechos duros de `CITAS_MEDICAS`

- **Sin columnas identity, sin índices únicos adicionales, SIN TRIGGERS** en las 4 tablas núcleo, y los únicos SPs que mencionan `CITAS_MEDICAS` son de lectura/reportes (`PA_PLANO_0256` de 2020, `SP_CONSULTAR_ORDEN_SERVICIO`). ⇒ **La app escribe DML directo desde el cliente**; no hay lógica oculta que un INSERT nuestro deje de disparar, y no existe SP oficial de agendamiento que podamos reutilizar. Vía definitiva: DML directo replicando el patrón de la app.
- **Estados observados** (bloque 4): `0` = 34.552 filas con fechas hasta 2027-08-28 (**vigente/agendada** — todas las citas futuras están aquí), `1` = 887.585 hasta 2026-10-02 (**cumplida/atendida**, hipótesis), `2` = 158.155 hasta 2026-08-15 y **cero futuras** (**incumplida o cancelada**, hipótesis). Que no exista ninguna cita futura en estado 2 sugiere dos lecturas posibles: (a) `2` = incumplida/no-show (solo se marca después de la fecha) y **la cancelación BORRA la fila**, o (b) las canceladas futuras se reasignan/limpian. **La prueba manual (bloque 17) decide** — y si cancelar = DELETE, la detección HIS→AgenIA debe vigilar desapariciones (el snapshot diferencial ya lo cubre; CT también captura deletes).
- `NU_TIPO_CIT`: 96% valor `0`; `NU_MOD_CIT`: 98% `NULL` ⇒ escribimos `0`/`NULL` como la app.
- **Volumen real** (bloque 13, catálogo vivo): 27.877 citas en la ventana de 90 días y **1.652 elaboradas en los últimos 7 días ≈ 235 citas/día**, con reservas hasta **12 meses adelante** (agosto 2027) ⇒ la ventana de sincronización/reconciliación debe ser **+13 meses**, no +90 días. Volumen trivial para polling.

#### Plantilla del INSERT confirmada (4ª corrida, catálogo vivo `ESEHSVP`, bloque 14)

Lo que escribe la app al crear una cita (muestra de 15 citas reales del 2026-08-22):

| Columna | Valor que escribe la app |
|---|---|
| `CD_CODI_MED_CIT` | código del médico (`76`, `91-1`, `ACO2`, `OD05`…) |
| `CD_CODI_SER_CIT` | código del servicio (`S39141-1`, `SCITOD`, `890201-CI`…) |
| `NU_HIST_PAC_CIT` | historia (= documento) |
| `NU_DURA_CIT` | 20 / 30 / 40 (minutos) |
| `FE_ELAB_CIT` | timestamp de creación (precisión de minuto) |
| `FE_FECH_CIT` | fecha de la cita a medianoche |
| `FE_HORA_CIT` | `'YYYY/MM/DD HH:MM'` |
| `NU_ESTA_CIT` | `0` (vigente) |
| `NU_DIA_CIT`, `NU_NUME_MOVI_CIT`, `NU_PRIM_CIT`, `NU_CONE_CALL_CIT`, `NU_TIPO_CIT` | `0` (constantes en la práctica) |
| `NU_NUME_CONE_CIT` | consecutivo de sesión/conexión (~1.285.8xx; se repite entre citas de la misma sesión). Fuente probable: tablas `CONEXION`/`CONEXIONES`/`CONSECUTIVOS` halladas en bloque 20b — muestras en bloque 21a. Plan B: validar en la prueba de fuego si la app acepta un valor propio del agente. |
| `CD_CODI_ESP_CIT` | especialidad (`572`, `328`, `461`, `000`…). `R_MEDI_ESPE` confirma médico↔especialidades N:M (bloque 20c), pero en la muestra la especialidad **correlaciona con el servicio** (todas las citas de `S39141-1` → `000`, `SCITOD` → `461`) ⇒ fuente probable: `R_ESP_SER` del servicio — verificación cruzada en bloque 21b/21d. |
| `CD_CODI_CONS_CIT` | consultorio — **copiado del turno del día** (verificado: cita del médico `91-1` → consultorio `40` = su `CD_CODI_CONS_TUME`) |
| `NU_NUME_CONV_CIT` | convenio (ver regla en §2.3) |
| `DE_DESC_CIT` | `''` (cadena vacía, no NULL) |
| `CD_CODI_CECO_CIT` | centro de costos (`007`, `001`, `004` — correlaciona con lugar de atención) |
| `CD_CODI_LUAT_CIT` | lugar de atención = **sede** (catálogo completo en bloque 20d: `01` = ESE Hospital San Vicente [principal], `02` San Pedro, `03` La Rica, `04` Bellavista, `05` Marapra, `06` Chapata, `07` Conchari, `08` Unidad Extramural). Relación con consultorio/centro de costos → bloque 21c. |
| `FE_SOLI_CIT` | fecha/hora solicitada (≈ la de la cita) |
| Resto (`NU_AUTO_AGRU`, `TX_PEND_AGRU`, `CD_CODI_EST`, `CD_CODI_CAMP`, `NU_CODIGO_HSWE`, `NU_MOD`) | `NULL` |

### 2.2 `dbo.MEDICOS`

PK: `CD_CODI_MED` varchar(4) (códigos observados: `001`, `0010`, `001V` — alfanuméricos). NOT NULL: solo `CD_CODI_MED` y `NU_AUTMEDCTRL_MED` (bit).

Columnas relevantes: `NU_DOCU_MED` (cédula — **clave de homologación** con `DoctorProfile.cedula`), `NO_NOMB_MED` (nombre completo) + `TX_PRNOM/TX_SGNOM/TX_PRAPEL/TX_SGAPEL_MED` (nombre partido), `NU_TIPD_MED` (tipo doc), `DE_CARG_MED` (cargo: "MEDICO GENERAL", "BACTERIOLOGA"…), `NU_ESTA_MED` (estado — verificar 1=activo), `NU_MAXC_MED` (¿máx. citas? **(hipótesis)**), `DE_REGI_MED` (registro médico), `TX_EMAIL_MED`, `CD_CODI_LUA_MED` (FK `LUGAR_ATENCION`). Relacionadas: `R_MEDI_ESPE` (especialidades), `TURNOS_MEDICOS` (turnos — ver §2.5).

### 2.3 `dbo.PACIENTES`

PK: `NU_HIST_PAC` varchar(20). ✅ **Regla confirmada (bloque 8): historia = documento en el 100% de los 78.654 pacientes.** Al crear un paciente nuevo: `NU_HIST_PAC = NU_DOCU_PAC`.

**Columnas NOT NULL (obligatorias al crear un paciente):** `NU_DOCU_PAC`, `NU_HIST_PAC`, `NU_TIPD_PAC` (FK `TIPO_DOCUMENTO`), `NO_NOMB_PAC` (primer nombre), `FE_NACI_PAC` (fecha nacimiento), `NU_SEXO_PAC`, `FE_HIST_PAC` (fecha apertura historia), `NU_EXTR_PAC` (bit), `FE_FECH_DONA_PAC`, `FE_FECH_VOLU_PAC`.

✅ **Defaults confirmados (bloque 9):** el esquema declara DEFAULT `(0)` para `FE_FECH_DONA_PAC`/`FE_FECH_VOLU_PAC` (⇒ `1900-01-01`; la app escribe `2024-01-01` últimamente — ambas formas conviven), `NU_SEXO_PAC=0`, `NU_TIPD_PAC=0`, `NU_ESTA_PAC=1`, `NU_EXTR_PAC=0`, `NU_ESCI_PAC=0`, `NU_NIVE_PAC=0`. **Alta mínima viable:** documento, tipo doc, nombres/apellidos, nacimiento, sexo, `FE_HIST_PAC = hoy` — el resto por default.

✅ **Catálogo `TIPO_DOCUMENTO` completo (homologación estática cerrada):** `0=CC, 1=TI, 2=RC, 3=CE, 4=PA, 5=AS, 6=MS, 7=CN, 8=CD, 9=SC, 10=PR (Pasaporte ONU), 11=PE, 12=DE, 13=SI, 14=PT`.

FKs de contexto: `TIPO_DOCUMENTO`, `MUNICIPIOS` (residencia y nacimiento), `OCUPACION`, `ZONARESIDENCIA`, `LUGAR_ATENCION`, `GRUPOESPECIAL`, `GRUPOETNICO_PAC`, `GRUPOPOBLA_PAC`.

**Afiliación (estructuras confirmadas, bloque 10):** `R_PAC_EPS` = (`NU_HIST_PAC_RPE`, `CD_NIT_EPS_RPE` — la EPS se referencia por **NIT**, `CD_CODI_REG_RPE` régimen, `CD_CARN_RPE`, `NU_AFIL_RPE`, `NU_ESTA_RPE`, `TX_ACTI_RPE`, `CD_POL_RPE`); `R_PAC_CONV` = (`NU_HIST_PAC_RPC`, `NU_NUME_CONV_RPC` int). Las citas reales usan `NU_NUME_CONV_CIT` **masivamente** (convenios 475, 467, 283… concentran el volumen) ⇒ el convenio es parte del INSERT de cita. ✅ **Estructuras de `CONVENIOS` y `EPS` confirmadas (3ª corrida):** `CONVENIOS` (≈80 columnas, casi todo facturación) — claves útiles: `NU_NUME_CONV` (PK int, el que va en la cita), `CD_CODI_CONV` (código/nombre corto), `CD_NIT_EPS_CONV` (vínculo a `EPS` por **NIT**), `FE_INIC_CONV`/`FE_FINA_CONV` (vigencia), `NU_VIGE_CONV` (flag vigente). `EPS`: PK `CD_NIT_EPS`, `NO_NOMB_EPS`, `CD_CODI_EPS`, `NU_ACTIVO_EPS`.

✅ **Regla de convenios descifrada (4ª corrida, bloques 16 y 19):**
- `R_PAC_CONV` queda **DESCARTADA** como fuente: es un historial many-to-many (el join contra citas recientes da 98,5% "difiere" por fan-out de filas históricas).
- La regla operativa observada: convenio de la cita = **EPS del paciente (NIT en `R_PAC_EPS`) + régimen (subsidiado/contributivo, `CD_CODI_REG_RPE`) + tipo de servicio (PyP usa convenio propio)** → convenio VIGENTE en `CONVENIOS`. Ej. de la muestra: servicio PyP `I890301AG` → convenio 489 `PYPSUBS`; servicios normales → 467/475 según EPS y régimen.
- **Tabla de homologación (los 12 que concentran las citas, todos vigentes hasta 2026-12-31):** 26 PARTICULARES · 96 EVENTOSTOTALCO / 538 EVENTOSTOTALSU (Salud Total eventos C/S) · 97 EVENSURACON / 535 EVENSURASUB (Sura eventos C/S) · 283 NUEVASUBSID (Nueva EPS subsidiado) · 467 SUBS / 473 CONTRIBUTIVO (Sura) · 475 STOTALSUBS / 476 STCONTRIB (Salud Total) · 489 PYPSUBS (Nueva EPS PyP) · 518 MAGISTERIOFOMAG.
- Los números de convenio son **estables entre años**: el HIS extiende `FE_FINA_CONV` (convenios de 2009 siguen vigentes con la misma PK); todos vencen 31-dic ⇒ la reconciliación debe alertar si un convenio homologado deja de estar vigente en enero.
- **Validar la tabla de decisión con la agendadora del hospital** en Fase 2 (única pendiente de este tema).

> **Regla confirmada por FK:** solo pacientes existentes en `PACIENTES` pueden tener cita. El flujo WhatsApp con paciente nuevo debe: 1) validar existencia en ambos sistemas por tipo+documento, 2) crearlo donde falte, 3) homologar en `MirrorMap`. Como `FE_NACI_PAC` y `NU_SEXO_PAC` son NOT NULL, **el chatbot debe capturar fecha de nacimiento y sexo** cuando el paciente no exista en el HIS (o definirse un default aprobado por el hospital — decisión pendiente).

### 2.4 `dbo.SERVICIOS`

PK: `CD_CODI_SER` varchar(12). NOT NULL: `CD_CODI_SER`, `NO_NOMB_SER`, `CD_CODI_GRUF_SER` (grupo facturación), `NU_MOD_SER`, `NU_UNED_SER`.

Relevantes para agenda: ✅ **`ID_CITA_SER='1'` confirmado como marca de "servicio agendable" (bloque 12): el 100% de las citas de los últimos 90 días (26.290) usan servicios con `ID_CITA_SER='1'`** — 1.280 servicios agendables de ~9.800 del catálogo; ese es el filtro de homologación. Además: `ID_GCIT_SER` (¿grupo de cita?), `NU_EDIN_SER`/`NU_EDFI_SER` (edad mínima/máxima — el HIS valida rangos de edad por servicio), `TX_TICO_SER` (`CO`=consulta / `EV`=evolución **(hipótesis)**), `CD_CODI_TISE_SER` (FK `TIPOSERVICIO`). El catálogo mezcla laboratorio, procedimientos, consultas y conceptos de facturación: **solo se homologa el subconjunto agendable** contra `MedicalService` de AgenIA.

✅ Catálogo `TIPOSERVICIO` **completo** (bloque 20f): `2=TRASLADOS`, `3=ESTANCIAS`, `4=HONORARIOS`, `5=DERECHOS DE SALA`, `6=ADMINISTRATIVO` — **el valor `1` no existe** en la tabla. Conclusión: `TIPOSERVICIO` es clasificación de facturación y NO participa del filtro de agendables; el filtro es únicamente `ID_CITA_SER='1'`.

### 2.5 Tablas satélite de agenda (pendientes de esquema)

- **`TURNOS_MEDICOS`** — ✅ **estructura confirmada (bloque 7): ES la fuente de disponibilidad del HIS.** Columnas: `CD_MED_TUME` (médico), `FE_FECH_TUME` (fecha del turno), `FE_HOIN_TUME`/`FE_HOFI_TUME` (hora inicio/fin como datetime sobre base `1900-01-01`, ej. 07:00–12:00 y 14:00–18:00), `ID_DISP_TUME` varchar(1) (¿disponible?), `CD_CODI_CONS_TUME` (consultorio), `NU_NUME_TUME` (PK, consecutivo), `NU_TIPO_TUME`, `CD_CODI_ESP_TUME` (especialidad). Modelo: **bloques de turno por médico/fecha/consultorio**; la app calcula los cupos = bloques ÷ duración − citas ocupadas. ✅ **Confirmado en el catálogo vivo (4ª corrida):** **1.120 turnos futuros de 27 médicos**, hasta 2027-08-31. ⚠️ Son **27** médicos con turnos, no los "15" reportados — confirmar con el hospital cuáles agendan por WhatsApp. Bloques típicos 07:00–12:00 y 14:00–15:30; consultorio estable por médico (ej. `91-1` → consultorio `40`) que **se copia a la cita**. `ID_DISP_TUME`: `'1'` = disponible/activo (99%), `'0'` = excepcional; `NU_TIPO_TUME`: ✅ **cero turnos futuros con tipo `1`** (bloque 20e) ⇒ solo el tipo `0` importa para el sync; el `1` es histórico/irrelevante. `TURNOS_MEDICOS_COSTOS` = bitácora de ediciones (usuario/fechas/centro de costos — hipótesis); no participa del sync. Otra hermana: `CX_HORARIO_SALA` (salas de cirugía, fuera de alcance).
- `PYP_AGENDA_GRUP` — agenda grupal de PyP (FK a médico y servicio).
- `CITAS_TELEMEDICINA` — espejo estructural de `CITAS_MEDICAS` para telemedicina. **PK confirmada:** (`FE_HORA_CITE`, `NU_HIST_PAC_CITE`, `CD_CODI_MED_CITE`, `CD_CODI_SER_CITE`, `NU_NUME_MOVI_CITE`) — el **paciente integra la PK** ⇒ aquí no existen filas de cupo libre: modelo distinto al de `CITAS_MEDICAS`. **Definir si entra al alcance.**

### 2.6 Módulo web del propio HIS

Existen `HOM_SERV_WEB`, `LOGIN_WEB` y la columna `NU_CODIGO_HSWE_CIT` en la cita. ❌ **Descartado como vía (bloque 11): el módulo web está SIN USO** — `NU_CODIGO_HSWE_CIT` es NULL en las 1.080.292 citas. Sumado a que no hay triggers ni SPs de escritura (2ª ronda §2.1), la conclusión es definitiva: **la vía de integración es DML directo replicando el patrón de la aplicación**, validado contra `PRUEBAS`.

## 3. Mapeo preliminar AgenIA ↔ HIS

### 3.1 Cita (AgenIA `Appointment` + `ScheduleSlot` → HIS `CITAS_MEDICAS`)

| AgenIA | HIS | Nota |
|---|---|---|
| `scheduleSlot.doctorId` → `MirrorMap` | `CD_CODI_MED_CIT` | Vía código HIS del médico. |
| `scheduleSlot.startTime` (UTC) | `FE_FECH_CIT` + `FE_HORA_CIT` | Convertir a America/Bogota en la frontera; `FE_HORA_CIT` estricto `'YYYY/MM/DD HH:MM'` (confirmado, con barras). |
| `endTime − startTime` (min) | `NU_DURA_CIT` | Si la hipótesis de duración se confirma. |
| `serviceId` → `MirrorMap` | `CD_CODI_SER_CIT` | Solo servicios homologados. |
| `patientId` → `MirrorMap` | `NU_HIST_PAC_CIT` | Paciente debe existir (crear si falta). |
| `status` (SCHEDULED/CANCELLED/COMPLETED) | `NU_ESTA_CIT` | Candidatos observados: `0`=vigente/agendada, `1`=cumplida (hipótesis), `2`=incumplida o cancelada (hipótesis; cero futuras en 2 ⇒ cancelar podría ser DELETE). Cierre con la prueba manual (bloque 17). |
| `reason` | `DE_DESC_CIT` (600) | Truncar con elipsis si excede. |
| `createdAt` | `FE_ELAB_CIT` / `FE_SOLI_CIT` | Según semántica confirmada. |
| `epsId` | `NU_NUME_CONV_CIT` (+ `R_PAC_EPS`) | Tras bloqueante #6. |
| — | `CD_CODI_ESP_CIT`, `CD_CODI_CONS_CIT`, `CD_CODI_LUAT_CIT`, `NU_TIPO_CIT`, `NU_MOD_CIT` | Valores por defecto que use el HIS (se copian de citas reales de `PRUEBAS`). |

Identidad del registro en `MirrorMap`: **clave de cupo estable** `CD_CODI_MED_CIT + '|' + FE_HORA_CIT` (la PK real incluye además `NU_ESTA_CIT`, que muta con el ciclo de vida — ver implicaciones de la PK en §2.1).

### 3.2 Médico (`DoctorProfile` ↔ `MEDICOS`)

Homologación por **cédula** (`cedula` ↔ `NU_DOCU_MED`); `fullName` ↔ `NO_NOMB_MED` (+ campos partidos al escribir); `isActive` ↔ `NU_ESTA_MED`; `medicalLicense` ↔ `DE_REGI_MED`; clave `MirrorMap`: `CD_CODI_MED`.

> **Recomendación (pendiente de aprobación):** dado que "el hospital gana" y que `CD_CODI_MED` es un código corto asignado por el HIS, el **maestro de médicos debe ser el HIS**: altas/ediciones fluyen HIS → AgenIA automáticamente; un médico creado primero en AgenIA queda en estado "pendiente de homologar" hasta que exista su código HIS (no inventamos códigos de 4 caracteres en su numeración).

### 3.3 Paciente (`PatientProfile` ↔ `PACIENTES`)

Homologación por tipo+número de documento (`NU_TIPD_PAC`+`NU_DOCU_PAC`); clave `MirrorMap`: `NU_HIST_PAC`. Alta desde WhatsApp requiere los NOT NULL de §2.3 (capturar nacimiento y sexo en el flujo del chatbot cuando el paciente no exista en el HIS) + homologación de `TIPO_DOCUMENTO` (catálogo pequeño, mapeo estático).

### 3.4 Servicio (`MedicalService` ↔ `SERVICIOS`) y EPS

Mapeo estático curado a mano en Fase 0 (solo servicios agendables), versionado en `HospitalMirrorConfig.mappingJson`. EPS ↔ convenios: tras bloqueante #6.

## 4. Reglas de negocio confirmadas (decisiones del hospital)

1. **Ambos sistemas siguen agendando.** El espejo es bidireccional permanente.
2. **El hospital gana todo conflicto.** Si el HIS crea/modifica/cancela una cita, esa versión prevalece y AgenIA se ajusta; los pacientes consultan las novedades por WhatsApp. En doble ocupación del mismo cupo, la cita del HIS queda y la de AgenIA pasa a conflicto → waitlist + notificación al staff + mensaje WhatsApp al paciente afectado.
3. **`PRUEBAS` primero.** Ningún experimento contra `ESEHSVP2025`; backup previo a cualquier intervención en producción.
4. **TI del hospital es receptivo** y autoriza crear BD propia y login dedicado — pasos en `docs/sql/AGENIA_SYNC_SETUP.sql`.
5. **Escala pequeña confirmada:** 15 médicos, 26.290 citas en 90 días ≈ **250–300 citas/día hábil** (bloque 13). Consecuencia de diseño: el **polling diferencial es sobradamente suficiente** (Change Tracking pasa a opcional) y la reconciliación compara la ventana completa en segundos. ⚠️ Hay reservas hasta **12 meses adelante** (agosto 2027) ⇒ la ventana de sincronización/reconciliación es **+13 meses**, no +90 días.
6. **Ventana de mantenimiento: los domingos.** Todo despliegue, activación de fase, corte a producción y game-day se programa en domingo; la reconciliación pesada nocturna evita el horario de agenda activa.
7. **Marco legal cubierto: existe contrato** de tratamiento de datos con el hospital (Ley 1581). Referenciarlo en el runbook y en la autorización formal de creación de `AGENIA_SYNC`.

## 5. Incógnitas bloqueantes (resolver con `FASE0_DESCUBRIMIENTO_HIS.sql`)

| # | Incógnita | Por qué bloquea | Query |
|---|---|---|---|
| 1 | ✅ **Resuelto (2026-08-23):** PK compuesta = (`CD_CODI_MED_CIT`, `FE_HORA_CIT`, `NU_ESTA_CIT`) — CT ya es viable. **Bloqueante derivado:** ¿un cambio de estado es UPDATE en sitio o fila nueva por transición? | Define la interpretación de eventos HIS→AgenIA y el diseño de `MirrorMap` | Prueba manual del bloque 4 + bloque 6; faltan además los result sets 2 y 3 del bloque 1 (identity e índices únicos) |
| 2 | ✅ **Resuelto:** `FE_HORA_CIT` = `'YYYY/MM/DD HH:MM'` (16 chars, barras); data legada sucia ⇒ lector tolerante, escritor estricto | — | Bloque 5 ✔ |
| 3 | ⚠️ **Parcial:** estados observados `0`=vigente, `1`=cumplida (hip.), `2`=incumplida/cancelada (hip.; cero futuras en 2 ⇒ cancelar podría ser DELETE) | Mapa de estados del ciclo de vida y detección de cancelaciones | **Prueba manual — bloque 17 (LA crítica)** |
| 4 | ✅ **Resuelto (hipótesis doble rol REFUTADA):** los cupos NO se materializan; disponibilidad = `TURNOS_MEDICOS` − citas ocupadas. Vivo: 1.120 turnos futuros de **27 médicos** hasta ago-2027 | Redefine el espejo de slots: derivado, no fila a fila. ⚠️ 27 ≠ "15 médicos": confirmar cuáles agendan por WhatsApp | Bloque 15 ✔ |
| 5 | ✅ **Resuelto:** historia = documento (100%); defaults de `PACIENTES` confirmados; catálogo `TIPO_DOCUMENTO` completo | Alta de pacientes desde WhatsApp viable | Bloques 8–9 ✔ |
| 6 | ✅ **Resuelto:** regla = EPS (NIT) + régimen + PyP → convenio vigente; `R_PAC_CONV` descartada; tabla de 12 convenios homologada (§2.3) | Falta solo validar la tabla de decisión con la agendadora (Fase 2) | Bloques 16 y 19 ✔ |
| 7 | ✅ **Resuelto:** `ID_CITA_SER='1'` marca los 1.280 servicios agendables (100% de las citas de 90d) | Filtro de homologación | Bloque 12 ✔ |
| 8 | ✅ **Resuelto:** sin triggers, sin SPs de escritura, módulo web sin uso ⇒ **vía = DML directo** replicando el patrón de la app | Ninguna lógica oculta; nada oficial reutilizable | Bloques 2–3, 11 ✔ |
| 9 | ✅ **Resuelto (vivo):** 27.877 citas/90d; 1.652 elaboradas/7d ≈ 235/día; reservas hasta 12 meses ⇒ ventana **+13 meses** | Dimensiona polling y reconciliación | Bloque 13 ✔ |
| 10 | ¿`CITAS_TELEMEDICINA` entra al alcance? | Alcance de Fase 3/4 | Decisión de negocio |
| 11 | ✅ **Resuelto:** plantilla del INSERT campo a campo documentada (§2.1) | Replicar el patrón exacto del INSERT | Bloque 14 ✔ |
| 13 | ⚠️ **Fuentes contextuales del INSERT** (última milla): `NU_NUME_CONE_CIT` (tablas `CONEXION*`/`CONSECUTIVOS` halladas), `CD_CODI_ESP_CIT` (probable `R_ESP_SER` del servicio), `CD_CODI_CONS/CECO/LUAT` (tabla `CONSULTORIOS` + sedes) | Completa el INSERT sin valores inventados | **Bloque 21** (muestras y verificación cruzada) |
| 14 | ✅ **Verificado (bloque 20a):** ningún job de SQL Agent toca las tablas del flujo — solo backups de `ESEHSVP` y shrink de logs | Nada interfiere con el sync; el `.bak` diario sirve para refrescar `PRUEBAS` | Bloque 20a ✔ |
| 12 | ✅ **Resuelto: el catálogo VIVO es `ESEHSVP`** (última elaboración 2026-08-22, 1.652 citas/7d); `ESEHSVP2024/2025` = archivos de corte anual; `PRUEBAS` = copia del 15-ago | No hay rollover anual; el agente apunta siempre a `ESEHSVP`; alerta de frescura permanente | Bloque 18 ✔ |

**Prueba de fuego final de Fase 0** (tras resolver 1–8): insertar/actualizar una cita en `PRUEBAS` vía SQL con el patrón completo y **verificar en la aplicación del HIS** que se ve, se puede atender y factura como una cita normal. Un funcionario del hospital valida.

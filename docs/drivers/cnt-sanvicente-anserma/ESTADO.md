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

## ✅ `NU_ESTA_CIT = 2` = INCUMPLIDA — CERRADO E IMPLEMENTADO (2026-09-07)

Tres corridas contra `ESEHSVP`: I.1-I.4 el 06-sep, I.7-I.9 e I.15 el 07-sep.
**`2` = no asistió.** El driver ya lo traduce:
`desenlaceDeAtencion(2) === 'NO_SHOW'`, con sus pruebas.

Con esto, el desenlace del **14,6 % de las citas del hospital** —uno de cada
siete pacientes— empieza a llegar a AgenIA. Antes se descartaba en silencio con
un aviso en el journal.

### 🚨 I.15 mató la última alternativa

La sospecha que abrió I.7 era que el estado 2 fuera flujo de trabajo («este
médico cierra así») en vez de un desenlace del paciente:

| | |
|---|---|
| Médicos con citas cerradas | 52 |
| **Mezclan estados 1 y 2** | **48** |
| Solo estado 1 | 4 |
| **Solo estado 2** | **0** |

Ninguno cierra solo en `2`, y los porcentajes forman un **continuo suave** del
1,70 % (MDD1) al 31,48 % (PS08) — sin los grupos en 0 % y 100 % que delatarían
una costumbre de digitación. El zoom al 2026-09-05 lo remata: **13 de 17
médicos tuvieron ambos estados ese mismo día**.

Y explica el espejismo de I.7: RU69 cerró 21/21 en estado 1 ese día, que con su
tasa habitual del 7,6 % pasa una de cada cinco veces; PS06 tuvo 7 de 15 (46 %)
contra su 31 % habitual. El `TOP 5` pescó justo esos dos.

### 🎯 El gradiente por servicio es lo que lo vuelve irrefutable

| Familia de servicio | Tasa de estado 2 |
|---|---|
| Enfermería 1ª infancia / infancia | 43-49 % |
| Adolescente / joven / adulto (PyDT) | 29-39 % |
| Psicología | 27-33 % |
| Odontología | 16-23 % |
| Medicina general | 8-13 % |
| Especialistas (internista, dermatología, ginecología) | 3-11 % |
| Control prenatal / recién nacido | 2-7 % |

Es **exactamente el orden de adherencia esperada del paciente**: lo preventivo
y sin síntomas arriba, lo que costó meses conseguir abajo. Ningún artefacto
administrativo ordena los servicios por lo que el paciente siente.

De paso explica por qué PS06 y PS08 encabezaban la lista de médicos: son
psicólogos, no «los que cierran raro».

### Las cinco patas, juntas

1. El informe oficial del HIS filtra `NU_ESTA_CIT <> 3` ⇒ catálogo del
   fabricante: 0 = asignada, 1 = cumplida, **2 = incumplida**, 3 = anulada.
2. Cero filas futuras en estado 2; su frontera es siempre «ayer».
3. El motivo `NA` de `CITAS_ANULADAS` se usa **4 veces al año** contra ~16.800
   del estado 2: no hay otro sitio donde viva el no-show.
4. 48/52 médicos mezclan; ninguno cierra solo en 2 ⇒ decisión por cita.
5. El gradiente clínico por servicio.

### I.10 (`MULTA_TEMP`): apoya, pero no era la prueba

La anuncié como «la firma definitiva» y **no lo fue: la tabla está vacía** —
ni el `TOP 20` ni el `GROUP BY` devolvieron una fila. El sufijo `_TEMP` lo
explica: es un buffer de proceso, igual que `TEMPO_ESTA` y `TEMP_CAMB_ESTADO`,
que también salieron vacías en I.9.

Su **estructura** sí apunta al mismo sitio:

| Columna | |
|---|---|
| `VL_VALO_MULT` | el valor en dinero de la multa |
| `FE_FECH_CIT` + `FE_HORA_CIT_MULT` | la fecha y hora de **la cita** |
| **`NU_ESTA_CIT`** | **el estado de esa cita** |
| `NU_HIST_PAC`, `PACIENTE`, `NO_NOMB_EPS` | a quién se le cobra |

Una tabla de multas que copia dentro de sí el estado de una cita solo tiene
sentido si **ese estado es lo que justifica el cobro** — y la multa que un
hospital colombiano le cobra a un paciente por una cita es la de inasistencia.
Es una **sexta pata, más débil** que las cinco anteriores porque es de diseño y
no de datos. No cambia la conclusión ni la refuta.

### I.7 sigue sin contestar

Se volvió a correr y devolvió lo mismo (es determinista). **La consulta solo
genera la lista**; falta que una persona del hospital abra una de esas cinco
citas en estado 2 —por ejemplo la de PS06 del 2026-09-05 a las 14:30, historia
`1054924377`— y diga qué etiqueta le muestra su pantalla. Un minuto, y es la
única prueba directa que queda.

### 🆕 Hallazgo colateral: existe un esquema `ADMIN`

`MULTA_TEMP` salió por duplicado: `dbo.MULTA_TEMP` y `ADMIN.MULTA_TEMP` (casi
idénticas; la de `dbo` tiene `CD_CODI_CONV` de más). **En toda la Fase 0 nunca
había aparecido un esquema distinto de `dbo`** — el mapeo entero lo asume.

El agente no corre peligro, y lo verifiqué en vez de suponerlo: prefija `dbo.`
en las **nueve** referencias que hace (incluido el `DELETE` de la cancelación),
y la prueba de fuego ya confirmó que la cita escrita en `dbo.CITAS_MEDICAS`
apareció en la pantalla del hospital.

Pero queda una duda que conviene cerrar antes de producción: si existiera un
`ADMIN.CITAS_MEDICAS` con datos, cualquiera que escriba una consulta sin
prefijo —una migración, un informe, el siguiente que toque esto— acertaría en
la tabla equivocada sin que nada fallara. **I.16** lo mira, junto con el
`default_schema` del login `agenia_sync`.

*(Detalle menor: `USUARIOANUL` / `USUARIOINAC` confirman que el producto sí
guarda usuario en algunas tablas, con convención `USUARIO<ACCIÓN>`. No cierra
el pendiente de «¿quién creó la cita?», pero dice dónde buscar.)*

### I.16: el esquema `ADMIN` no toca la agenda (riesgo cerrado)

Tiene **7 tablas contra las 1.393 de `dbo`**, y ninguna es del espejo — no
existe `ADMIN.CITAS_MEDICAS` ni nada parecido. Son de inventario, farmacia y
reportes temporales:

| Tabla | Filas |
|---|---|
| `ADMIN.IN_ROTAREPORTE` | 4.407 |
| `ADMIN.MULTA_TEMP` | **38** |
| `ADMIN.DESPA_TEMP` | 11 |
| `ADMIN.MES_TEMP` | 1 |
| `IN_KARDGRUP_TEMP`, `IN_SALDOREPORTE`, `TIPOAFIL_LIQEST_TMP` | 0 |

El riesgo que abrió I.10 queda descartado **con datos**, no con suposiciones.

### 🎯 Y destapó que I.10 miró la tabla equivocada

`ADMIN.MULTA_TEMP` tiene **38 filas**; `dbo.MULTA_TEMP` tiene cero. I.10
consultó la de `dbo` —la vacía— cuando su propia consulta de estructura ya
había devuelto las dos. Descuido mío.

Esas 38 multas reales, cada una con el `NU_ESTA_CIT` de la cita que la originó,
son la última evidencia empírica al alcance sin molestar a nadie. Si casi todas
son estado `2`, la pregunta se cierra del todo. **I.17** las lee.

### 🚨 Pendiente de despliegue: `agenia_sync` no existe en `ESEHSVP`

De rebote, la consulta de principals devolvió solo `dbo` y `ADMIN`. El usuario
`agenia_sync` está documentado como el del agente (`agent.env.example`,
`CONECTIVIDAD.md`) pero **se creó contra `PRUEBAS`, no contra el catálogo
vivo**.

No cambia una línea de código, y es trivial de resolver — pero si nadie lo pide
antes del cutover, **el go-live falla en el primer intento con un error de
login**. Lo que hay que pedirle a TI:

- usuario `agenia_sync` mapeado en `ESEHSVP`
- `default_schema = dbo` (el driver prefija `dbo.` igualmente, pero así nada
  depende de ello)
- los permisos mínimos ya acordados en `CONECTIVIDAD.md`

### 🎯 I.17: 38 de 38. La séptima pata, y es prueba directa

| estado de la cita | multas | valor medio |
|---|---|---|
| **2** | **38 (100 %)** | $2.000 |
| 0 o 1 | 0 | — |

**Cero excepciones.** No hay ni una sola multa fuera del estado 2. Si el `2`
no fuera inasistencia, sería una coincidencia de 38 sobre 38. Es la primera
pata que es prueba directa en vez de correlación: la tabla que registra el
**cobro por no asistir** apunta, sin excepción, al estado 2.

Contexto honesto: las 38 son de 2009-04-30 a 2009-07-21 — un tramo de tres
meses, hace diecisiete años. `MULTA_TEMP` no se ha vuelto a usar desde
entonces; es un mecanismo abandonado, no vigente. Eso no le resta fuerza a la
prueba —dice qué significaba el estado 2 cuando alguien necesitó tratarlo
como inasistencia con dinero de por medio—, pero si se habla con el hospital,
no ofrecer reactivar cobros: esa conversación es de ellos, no del espejo.

Y un detalle honesto más, del cruce contra `CITAS_MEDICAS` de hoy:

| | |
|---|---|
| Siguen en estado 2 | 24 |
| **Hoy en estado 1** (corregidas después) | **11** |
| Sin match (formato de historia distinto) | 3 |

Que 11 de 38 hayan pasado de 2 a 1 no contradice nada: confirma que el HIS
permite **corregir** el estado de una cita después de cerrada — coherente con
que `USUARIOANUL` exista en la tabla. Para el driver esto ya está cubierto por
diseño: compara fotos, así que una corrección 2→1 vuelve a emitir el evento
con el desenlace correcto. No hace falta tocar código.

### ✅ Sección I: cerrada del todo

Siete patas independientes, la última de ellas prueba directa. Nada queda
pendiente para la pregunta original. Si alguna vez se cruza con el hospital,
vale la pena pedir la confirmación de una cita (I.7) — no porque haga falta,
sino porque cuesta un minuto y no sobra el "sí" de un humano en un cambio que
toca producción. I.11-I.14 quedan abiertas pero son complementarias.

### 🚨 404 en `/api/mirror/handshake` tras el redeploy — causa raíz en `install-vps.sh` (2026-09-07)

Al probar el servidor recién actualizado (`curl -X POST
https://app.hsvpanserma.agenia.co/api/mirror/handshake`) salió **404**, cuando
debía salir **401** (el `MirrorAgentGuard` rechaza por falta de token, pero
solo si la petición llega a NestJS).

**No era el Caddyfile.** El archivo en disco tenía el bloque `/api/mirror*`
desde que se generó, correcto carácter por carácter. El problema era que
**Caddy nunca lo leyó**:

```
arrancado: 2026-08-19T18:49:45Z    ← el contenedor, hace tres semanas
archivo:   2026-09-07T13:40:43     ← el Caddyfile, recién regenerado
```

`docker compose up -d` no recrea un contenedor solo porque un archivo
bind-mounteado cambió en disco — el `Caddyfile` es `:ro` montado, no parte de
la imagen. `install-vps.sh` regenera el archivo en cada corrida (§09) pero no
tenía ningún paso que le avisara a Caddy. Es exactamente el escenario que ya
advertía `docs/INSTALACION_VPS.md`: *"Caddy lee su configuración solo al
arrancar"* — el instalador no seguía su propia advertencia.

**Arreglo aplicado en caliente:** `agenia restart caddy` (como root; con
`agenia` normal pide `sudo` y no hay TTY por SSH no interactivo). Confirmado:
`404` → `401`.

**Arreglo de raíz:** se añadió a `deploy/install-vps.sh`, justo después de
`up -d` en el paso 12/14, un `caddy reload --config /etc/caddy/Caddyfile
--adapter caddyfile` con reintentos (por si el socket admin de Caddy no está
listo justo tras arrancar). Es sin downtime y no hace daño en una instalación
nueva (recarga la misma config que ya cargó). Verificado contra el servidor
real: el comando exacto que quedó en el script se probó ahí, y el sitio siguió
sano después (`401` en el handshake, `200` en el panel).

## ✅ `agenia_sync` en `ESEHSVP` — RESUELTO (2026-09-07)

La sección **4-ESEHSVP** de `AGENIA_SYNC_SETUP.sql` se corrió contra el
catálogo vivo. Verificación propia del script, confirmada por captura de
SSMS:

```
usuario       esquema
agenia_sync   dbo
```

Una fila, esquema `dbo`, tal como se esperaba. **Ya no hay ningún bloqueante
de despliegue pendiente en este documento** — el agente puede conectarse a
`ESEHSVP` con el usuario y los permisos correctos.

Si algo contradijera esto, **revertir es una línea** en `mapping.ts`. El riesgo
de haberlo implementado ya es acotado: `NO_SHOW` en AgenIA es informativo
(estadística y una etiqueta «❌ Ausente» en el panel), no bloquea al paciente ni
dispara ninguna acción automática.

### 🎯 Lo que más pesa: `NA` se usa CUATRO veces al año (I.8, 2026-09-07)

El catálogo `MOTIVOANUL` y su uso real en 365 días:

| Motivo | Descripción | Anulaciones |
|---|---|---|
| `05` | **PACIENTE LLAMA A CANCELAR** | 7.087 (85,4 %) |
| `01` | ERROR DE CAJERO | 567 |
| `06` | DOBLE CONSULTA | 485 |
| `WB` | CANCELADO WEB | 16 |
| **`NA`** | **NO ASISTIO** | **4** |

El estado `2` recibe **~16.800 filas al año**. `NA` recibe **4**. Son cuatro mil
doscientas veces más. **Si el no-show del hospital viviera en
`CITAS_ANULADAS`, este hospital tendría cuatro inasistencias anuales.** No hay
otro sitio donde pueda estar: está en el estado `2`.

Esto invierte una conclusión que llevaba desde agosto en `MAPEO_HIS.md`, y que
fue la que aparcó la pregunta: decía que el no-show pasaba por
`CITAS_ANULADAS`/`NA` y que por eso el estado `2` importaba poco. Era
exactamente al revés.

Dos cosas más que cerró I.8:

- **`05` = "PACIENTE LLAMA A CANCELAR"** — cierra el pendiente 0b. Y es un dato
  de negocio: 7.000 pacientes al año llaman por teléfono a cancelar, que es
  justo el volumen que el chatbot absorbe.
- **`WB` (CANCELADO WEB) existe y tiene 16 usos reales.** Es el motivo que
  escribe nuestro driver (`mapping.json`): elección validada contra la base.
- `MOTIVOANUL` es un catálogo **compartido** con la anulación de cargos de
  facturación ("NO POS", "COPAGO NO COBRADO", "DEVOLUCION DINERO"): no todos
  sus códigos aplican a una cita.

### ❌ I.9: las tres vías del catálogo, cerradas en falso

No existe un catálogo de estados en la base. El significado de `NU_ESTA_CIT`
vive solo en el código de la aplicación cliente, que no está en SQL Server.

| Tabla | Qué resultó ser |
|---|---|
| `dbo.ESTADO` | **Vacía.** Y sus columnas (`TX_NOMB_ESTA`, `NU_AUTO_ESTA`) delatan un autonumérico; `NU_ESTA_CIT` es un tinyint de dominio fijo |
| `TEMP_CAMB_ESTADO` | **Vacía**, y es de FARMACIA (`NUM_ORDER_MED`, `DOSIS`, `ARTICULO`, `DESPACHO`) |
| `TEMPO_ESTA` | Facturación de **ESTAncia hospitalaria**. "ESTA" no era "estado" |

Lección para la próxima ronda: el `LIKE '%ESTA%'` de I.2 capturaba «ESTAncia» y
por eso devolvió once tablas de las que nueve eran ruido. En este HIS la
búsqueda por nombre de tabla no sirve.

### ⚠️ I.7 todavía no está contestada — y abrió una duda

Solo se generó la lista; falta que alguien del hospital abra esas diez citas en
su pantalla. Lo que sí dicen los datos:

- **Las diez son del mismo día (2026-09-05)** y el servicio `S39141` aparece en
  ambos estados ⇒ el `2` **no** es «así se cierra tal día» ni «así se cierra
  tal servicio». Es una decisión por cita. Dos alternativas descartadas.
- 🚨 **Pero en la muestra el estado 1 es todo de un médico (RU69) y el 2 de
  otros dos (RU62, PS06).** Casi seguro es un artefacto —el `TOP 5 ORDER BY
  FE_FECH_CIT` no desempata entre citas del mismo día— pero si no lo fuera, el
  `2` sería flujo de trabajo y no inasistencia, y marcar `NO_SHOW` con él le
  colgaría a pacientes una falta que no cometieron. **Lo decide I.15**, que ya
  está escrita: si cada médico mezcla 1 y 2, es desenlace; si se parten en dos
  grupos, la hipótesis muere.

### La evidencia que lo decide: el informe del propio HIS

I.3 buscó `NU_ESTA_CIT` dentro del código de la base y encontró **un solo
objeto**: `PA_PLANO_0256`, el plano de la Resolución 256 del MinSalud. Su
filtro es:

```sql
WHERE NU_PRIM_CIT = 1 AND ... AND NU_ESTA_CIT <> 3 AND ...
```

**`<> 3`.** La aplicación conoce un estado `3` que en esta base **no existe**
(I.1 solo devuelve 0, 1 y 2). Eso deja ver el catálogo del *fabricante*, que es
de cuatro valores, y en el ciclo de vida de una cita en Colombia solo cabe una
lectura:

| Valor | Significado | En ESEHSVP |
|---|---|---|
| `0` | Asignada | 34.826 (3,2 %) |
| `1` | Cumplida | 891.859 (82,2 %) |
| `2` | **Incumplida — no asistió** | 158.799 (14,6 %) |
| `3` | Anulada | **cero** |

El `3` no aparece porque este hospital anula **borrando** la fila hacia
`CITAS_ANULADAS` (prueba manual del 2026-08-23) en vez de cambiar el estado. El
producto soporta las dos formas; el hospital usa una. Y que el informe excluya
*solo* el 3 es coherente: para un indicador de oportunidad, una cita incumplida
sigue siendo una cita que se asignó.

### Lo que confirman los números

| estado | filas | % | fecha_min | fecha_max | futuras |
|---|---|---|---|---|---|
| 0 | 34.826 | 3,21 | 2024-06-14 | 2027-09-04 | 6.841 |
| 1 | 891.859 | 82,16 | 2009-04-30 | 2026-10-02 | 1 |
| 2 | 158.799 | 14,63 | 2009-03-05 | **2026-09-05** | **0** |

- **Cero futuras en estado 2**, como se predijo: un "no asistió" no se puede
  marcar antes de la fecha.
- **Su fecha máxima es ayer.** En la corrida del 2026-08-23 el tope era
  2026-08-15, también ~una semana atrás. La frontera **avanza con el
  calendario**: es un proceso vivo y diario, no un valor legado.
- El ritmo cuadra: en esos 14 días entraron +4.274 al estado 1 y +644 al 2, un
  13,1 % contra el 14,63 % histórico.
- Los dos estados llegan hasta 2009: el `2` no es una novedad.

Y una pista lateral de I.2: existe una tabla **`MULTA_TEMP` con una columna
`NU_ESTA_CIT`**. Una multa ligada al estado de la cita encaja con la
inasistencia y con nada más. Se mira en I.10.

### Un error propio, corregido

**I.5 estaba mal planteada.** Decía que si las citas en estado 2 tienen convenio
como las de estado 1, alguien las atendió. Es falso: `NU_NUME_CONV_CIT` se
escribe al **crear** la cita —lo hace la app y lo hace nuestro propio driver en
su INSERT—, no al facturarla. Dará ~100 % en ambos estados y no distingue nada.
El sustituto correcto es **I.12**: buscar el rastro clínico (RIPS, consulta)
que sí separa atendida de no atendida.

### Dos hallazgos que no se buscaban

1. **27.985 citas con fecha pasada siguen en estado `0`** (34.826 − 6.841
   futuras), desde 2024-06-14: ocho de cada diez filas del estado 0. El cierre
   0→1/2 **no se aplica siempre**. Consecuencia directa: *"no cambió de estado"
   no significa "se atendió"*, así que no vale el atajo de tratar el `0` pasado
   como cumplido. Se caracteriza en I.13.
2. **Una cita futura en estado `1`.** Parece anecdótico y no lo es: la PK es
   (médico, hora, **estado**), así que una fila en estado 1 o 2 **no impide**
   insertar otra en estado 0 a la misma hora — el INSERT del agente tendría
   éxito y el hospital vería dos pacientes en un cupo, sin ningún error. Con
   `availabilityMode = ON` no puede pasar (`fetchAvailability` marca ocupado
   cualquier cupo con una fila, sea cual sea su estado — verificado). Pero el
   piloto arranca en **OFF**, donde la agenda de AgenIA es la suya. Exposición
   real hoy: una fila. Se mide en I.14.

### Qué falta y qué se hace con ello

| # | Qué | Por qué importa |
|---|---|---|
| **I.15** | ¿El estado 2 es por cita o por médico? | 🚨 **La que puede matar la hipótesis.** Escrita, sin correr |
| **I.10** | `MULTA_TEMP` — la tabla de multas que lleva una columna `NU_ESTA_CIT` | La más prometedora de las que quedan: una multa ligada al estado de la cita solo encaja con la inasistencia |
| **I.7** | Que el hospital lea diez citas en su pantalla | La única prueba definitiva: ninguna consulta devuelve una etiqueta que la base no guarda |
| I.11-I.14 | Estado 3 en los archivos anuales, rastro clínico, las 28k sin cerrar, riesgo de doble reserva | Complementarias |

`dbo.ESTADO` ya no está en la lista: I.9 la cerró (vacía, y no es de citas).

Mientras tanto **el código no cambia**: `desenlaceDeAtencion()` sigue
devolviendo `null` para el `2`. Escribirle a un paciente que no fue a una cita a
la que sí fue es peor que no escribir nada, y con la sección I confirmada esto
es una línea. La decisión de si AgenIA además *escribe* la asistencia hacia el
HIS (`updateAttendance`) sigue siendo aparte, y sigue en contra: la marca el
hospital en su aplicación y el agente ya la lee.

---

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

##### El desajuste, en una frase

**El hospital tiene un modelo de agenda y AgenIA tiene otro, y no son
compatibles.** Para el hospital un turno es *«el doctor Pérez está el martes de
8 a 12»* y lo que se haga en cada hueco se decide al agendar. Para AgenIA un
cupo es *«el doctor Pérez, el martes a las 8:20, para ODONTOLOGÍA»* — el
servicio va pegado al hueco desde que se crea.

Mientras un médico presta un solo servicio los dos modelos coinciden y nadie
nota nada. **47 médicos prestan más de uno**, y ahí se rompe.

##### Qué hace hoy AgenIA, exactamente

`mirror-availability.service.ts:103` construye cada cupo así:

```ts
const serviceId = doctorId ? servicioDe.get(doctorId) : null;
if (!doctorId || !serviceId) { /* se descarta el cupo */ }
```

`servicioDe` es un `Map` de médico → **su único** `DoctorProfile.serviceId`. O
sea: el turno del hospital se convierte en N cupos y a los N se les estampa el
mismo servicio, el que alguien configuró en la ficha del médico. El HIS no
mandó esa información — la inventa AgenIA.

##### Los tres daños, en orden de gravedad

**1. Factura equivocada.** Es el que convierte esto en un bloqueante. Los
servicios que conviven en un turno cruzan la frontera de PyP:

```
S39141    Consulta ambulatoria de medicina general      5.484
S39141-1  Consulta ambulatoria control hipertensos      3.669
SCITOD    CITA ODONTOLOGICA                             1.077
S39141-2  Consulta Ambulatoria Lectura de examenes      1.014
890201-CI Citas de PyDT                                   923   ← PyP
997301-1  CITA SALUD ORAL DOBLE                           907   ← PyP
I890305PL CONTROL ENFERMERIA PLANIFICACION FAMILIAR       540   ← PyP
I890301AG CONSULTA MEDICA DE CONTROL A LA GESTANTE        406   ← PyP
```

Si el paciente pide una cosa y la ficha del médico dice otra, `CD_CODI_SER_CIT`
viaja mal. Y como el convenio se deriva del servicio (PyP → 489 PYPSUBS; normal
→ 283 NUEVASUBSID, para Nueva EPS subsidiado), la cita se factura a un contrato
que no cubre ese acto. Eso es una **glosa**: la EPS rechaza el cobro, el
hospital pierde el dinero, y nadie se entera hasta la conciliación mensual.

Con lo que añadió G.6, el daño es aún mayor de lo que parecía: la frontera no
es solo PyP sino también **cápita vs evento**, y ahí un error cambia de
contrato igual.

**2. Sub-oferta.** De los N servicios que presta el médico, el chatbot solo
puede ofrecer uno. Un médico que hace once queda reducido a uno. Esto no es
incorrecto —lo que se agenda se agenda bien— pero desperdicia agenda.

**3. Cupos descartados.** La línea de arriba tira el cupo si el médico no tiene
`serviceId`. Un médico recién importado del HIS no lo tiene, así que su agenda
sencillamente no existe para el chatbot hasta que alguien se lo ponga a mano.

##### Por qué no hay atajo

El plan B natural era leer el servicio del turno. **No existe:**

- `TURNOS_MEDICOS` no tiene columna de servicio.
- `CD_CODI_ESP_TUME` (especialidad del turno) está **NULL en los 1.223 turnos
  futuros**. Cero excepciones.
- El 72,5 % de los turnos mezcla servicios, hasta **siete** en uno.

No es que el dato esté sucio: es que **no se captura**. El hospital tampoco lo
sabe hasta que el paciente llega. El propio código de AgenIA ya lo anticipaba
en un comentario —*«el turno es del médico, y el servicio se elige al
agendar»*— y se resolvió por el camino corto porque `ScheduleSlot.serviceId`
es `String` obligatorio en el schema.

##### El cambio

El servicio deja de ser propiedad del **cupo** y pasa a serlo de la **cita**.
El dato ya existe en el momento correcto: el chatbot pregunta el servicio en
`AWAITING_SPECIALTY`, **antes** de mostrar cupos. Solo no se está guardando
donde toca.

| # | Qué | Dónde | Riesgo |
|---|---|---|---|
| 1 | `ScheduleSlot.serviceId` → opcional | schema + migración | bajo |
| 2 | `Appointment.serviceId` → nuevo, obligatorio | schema + migración | bajo |
| 3 | `DoctorProfile.serviceId` → N:M médico↔servicios | schema + migración | **medio** |
| 4 | `getAvailableSlots()` filtra por *médico que presta ese servicio* | `appointments.service.ts` | **alto** |
| 5 | `bookAppointment()` recibe y persiste el `serviceId` elegido | `appointments.service.ts` | medio |
| 6 | La hidratación del outbox lee `Appointment.serviceId` | `mirror-dispatch.service.ts:354` | medio |
| 7 | Migración: las citas existentes heredan el servicio de su cupo | script | bajo |

De dónde sale la relación N:M del punto 3: **del propio HIS**.
`R_MEDI_ESPE ⋈ R_ESP_SER` da médico → especialidades → servicios, con cobertura
total (bloque 32: 0 médicos y 0 servicios sin fila). Se refina con lo que cada
médico hace de verdad en 90 días — que es la consulta **F**, ya corrida.

⚠️ Con el matiz de G.4: **`R_ESP_SER` discrepa de lo observado en 22 de 54
servicios**, así que el catálogo sirve para el esqueleto de la relación, pero
quien manda es lo observado.

##### Lo que el punto 4 hace difícil, y por qué el flujo nuevo lo arregla

Hoy `getAvailableSlots()` filtra `slot.serviceId = X` — un índice, una
comparación. Después tendrá que resolver *«qué médicos prestan X»* y filtrar
por ahí, lo que cambia el plan de consulta del camino más caliente del chatbot.

Y hay un problema de orden: para filtrar cupos por servicio hay que **saber el
servicio antes que el médico**, y el par CUPS `8902xx`/`8903xx` no se puede
resolver hasta saber si es primera vez o control — que es una pregunta que solo
tiene sentido **después** de elegir el profesional.

El flujo decidido el 2026-09-03 rompe ese nudo: *especialidad → médico →
primera vez/control*. Se filtra por **especialidad** (barato, poca cardinalidad)
y el `serviceId` exacto se resuelve **al final**, cuando ya se conocen las dos
piezas y el par CUPS es determinista.

##### El orden en el que hay que hacerlo

1. **Antes:** que el hospital cierre la pregunta 1 (Bloque 2, «¿primera vez o
   control?»). Sin esa respuesta el punto 5 no sabe qué persistir.
2. Puntos 1-3 y 7 juntos, en una migración. Sin cambio de comportamiento.
3. Punto 6: el outbox lee de la cita, con repliegue al cupo mientras convivan.
4. Puntos 4-5 y los estados nuevos del FSM. Aquí sí cambia lo que ve el
   paciente, y aquí es donde hay que probar en serio.

##### Mientras tanto no está roto

El piloto de los cuatro verdes **no sufre nada de esto**: sus médicos prestan un
solo servicio con ≥95 % de concentración, así que el modelo viejo acierta. Es
literalmente por eso que la sección E existe — es la puerta que deja pasar solo
a los médicos para los que «el servicio del cupo» sigue siendo verdad.

Y con lo medido después, el piloto está **más** confirmado: G.6 verifica que
`S39141-1`, `890201-CI` e `I890305PL` van por cápita con 0,0 % de evento sobre
10.659 citas. No hay ninguna arista suelta en esos cuatro médicos.

Es decisión de producto además de técnica — cambia qué significa un cupo en
todo el sistema, no solo en el espejo.

#### ✅ Decisión de producto tomada: el flujo pregunta médico y luego momento (2026-09-03)

El flujo de agendamiento queda así:

```
AWAITING_SPECIALTY
   ↓
¿tiene médico de preferencia?  (sí / no)          ← NUEVO
   ↓ sí: nombre libre → se resuelve y se confirma
   ↓ no, o nombre no resuelto: lista de médicos habilitados
   ↓
¿primera vez o control?                            ← NUEVO
   ↓
AWAITING_DATE → ... → AWAITING_CONFIRMATION
```

**Qué de esto ya existe y no hay que inventar:**

| Pieza | Estado |
|---|---|
| Activación gradual médico por médico | ✅ `DoctorProfile.whatsappBookingEnabled`, ya aplicada en `getAvailableSlots()` y `bookAppointment()` ([appointments.service.ts:169](../../../apps/api/src/appointments/appointments.service.ts#L169)) y en la reprogramación ([chatbot.service.ts:7026](../../../apps/api/src/chatbot/chatbot.service.ts#L7026)) |
| Los médicos del HIS entran apagados | ✅ `homologar.ts` los crea con `whatsappBookingEnabled: false` |
| Nombre libre → médico | ✅ `resolvePreferredDoctorId()` ([chatbot.service.ts:1891](../../../apps/api/src/chatbot/chatbot.service.ts#L1891)): normaliza acentos, quita «Dr./Dra.», y **solo devuelve un id si la coincidencia es única** — nunca asigna un médico equivocado |
| El servicio se guarda en la cita | ❌ el cambio de modelo de arriba |
| Estados del FSM | ❌ faltan cuatro: preferencia sí/no, nombre, selección de lista, primera vez / control |

Lo relevante: **el resolvedor de nombres ya está escrito y probado**, se usa
hoy para la lista de espera («quiero que me llamen si se libera algo con el
doctor Pérez»). Para el flujo de agendamiento le falta un solo filtro —
`whatsappBookingEnabled: true` en sus dos consultas— para no ofrecer médicos
apagados.

**Por qué este flujo mejora el cambio de modelo en vez de complicarlo:** el
punto 4 («`getAvailableSlots()` filtra por médicos que prestan ese servicio»)
era la parte incómoda, porque obligaba a resolver el servicio antes de saber el
médico. Con el orden médico → momento, el servicio se resuelve **al final**,
cuando ya se conocen las dos cosas, que es cuando el par CUPS
`8902xx`/`8903xx` es determinista.

**Pendiente de confirmar con el hospital** (pregunta 1 del cuestionario): si
los médicos **76** y **077** de HTA son del programa o son generales que además
lo llevan. Si son comodines, el código no lo decide el médico sino si el
paciente está en el programa, y eso es una pregunta más en el flujo.

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
consolidado en **`PREGUNTAS_AL_HOSPITAL.md`** — siete decisiones, escritas para
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
| 1-bis | Facturación | 🔴 Especialistas: convenio de evento vs cápita, y el alta de Salud Total |
| 2 | Agendadora | El consecutivo de sesión: ¿algún informe agrupa por él? |
| 3 | Agendadora / facturación | Confirmar la tabla de convenios que dedujimos |
| 4 | Coordinación | Alcance del arranque: qué médicos, cuántas citas/día |
| 5 | Agendadora / TI | El origen del 5,7 % de citas con hora ilegible |
| 6 | TI | Ventana de domingo, VM, `AGENIA_SYNC`, medición de carga |

El documento cierra con la lista de lo que **ya** está resuelto y verificado,
para que la reunión no empiece explicando de cero.

### ✅ El coste del espejo sobre el HIS, medido (2026-09-03, sección C)

La forma sargable frente a la que había antes, sobre la consulta caliente del
ciclo de entrada:

| | exámenes | lecturas lógicas | CPU | transcurrido |
|---|---|---|---|---|
| (29c) sargable — hoy | 1 | 16.655 | **28 ms** | 28 ms |
| (29d) con `CONVERT` — antes | 21 | 23.131 | **511 ms** | 29 ms |

Lo interesante es que el **tiempo de reloj es el mismo** (28 vs 29 ms) y el CPU
es **18 veces menor**. La forma vieja tardaba lo mismo porque SQL Server la
paralelizaba —los 21 exámenes son los hilos del plan— y para eso quemaba medio
segundo de CPU del servidor del hospital en cada vuelta. A un ciclo cada 30 s
(`inboundIntervalMs`) eso es 1,7 % de un núcleo permanentemente, contra 0,09 %
ahora. Cero lecturas físicas: las 16.655 páginas (~130 MB) salen de caché, así
que el espejo no añade E/S de disco.

La decisión del 2026-09-02 queda confirmada con números, y el argumento para
TI en la pregunta 6 deja de ser una promesa: **el agente le cuesta al HIS menos
de una milésima de núcleo.**

### 🚨 G.2 respondió su pregunta Y destapó un bloqueante que no se buscaba (2026-09-03)

**Lo que se preguntaba — respondido, pero solo en una dirección.** Sobre 1.589
citas de especialista en 90 días, leyendo el convenio de la propia cita:

| bucket | citas | composición |
|---|---|---|
| **SUR** | 367 | **100,0 % Sura. Cero excepciones.** |
| **ESP** | 1.222 | 51,2 % Salud Total · 45,8 % Sura · 1,5 % Fomag · 0,6 % Nueva EPS · 0,4 % particular |

`SUR` ⟹ Sura, siempre. Pero **Sura ⇏ `SUR`**: 560 de las 927 citas de Sura —el
60 %— van con `ESP`. **AgenIA no puede deducir el sufijo de la EPS.** La
pregunta a la agendadora sigue viva, pero ahora es concreta y tiene un default
seguro: `ESP` se usa con todas las aseguradoras, Sura incluida, así que
escribirlo nunca es «la aseguradora equivocada».

**Y lo que nadie preguntaba, que pesa más.** Los convenios que aparecen no son
los que AgenIA tiene homologados:

| | especialista | atención primaria (lo que dice el mapping) |
|---|---|---|
| Sura subsidiado | **535** EVENSURASUB · 605 citas | 467 SUBS |
| Sura contributivo | **97** EVENSURACON · 318 | 473 CONTRIBUTIVO |
| Salud Total subsidiado | **538** EVENTOSTOTALSU · 500 | *(no existe)* |
| Salud Total contributivo | **96** EVENTOSTOTALCO · 126 | *(no existe)* |

El prefijo de los propios convenios lo dice: `EVEN`/`EVENTOS`. **La atención
primaria va por cápita y el especialista por evento**, y la regla de convenio
de AgenIA —EPS + régimen + PyP— no tenía ese eje. Para Sura subsidiado con un
especialista el hospital usa el 535 en 605 citas y el 467 en 4: encender un
especialista hoy facturaría al contrato equivocado en el 99 % de los casos, y
en silencio, porque el 467 es un convenio perfectamente válido de la EPS
correcta.

Además, **Salud Total es el 39,4 % del volumen de especialistas y AgenIA no
sabe que existe** — su tabla `Eps` solo tiene Nueva EPS, Sura y Particular.

**Nada de esto toca al piloto de los cuatro verdes** (76, 077, 91-1, 91-2): son
primaria y PyP, y sus convenios están medidos y verificados en la sección D. Lo
que bloquea es encender especialistas.

#### Lo que se hizo con eso

1. **Cuarto eje en `resolveConvenio`**: `serviciosEvento` + claves
   `nit|REGIMEN|EVENTO`. A diferencia de PyP, **sin repliegue** — si falta la
   clave, lanza. El repliegue de PyP es correcto porque el hospital lo hace así
   (medido en D); replegarse aquí sería justo el error que el eje existe para
   impedir.
2. **Los 16 servicios de especialista** quedan listados, y las dos claves de
   Sura medidas (535 y 97). Salud Total, Fomag y Nueva EPS **no** se
   inventaron: los saca **G.5**.
3. `aplicar-mapping.ts` rechaza un servicio que esté a la vez en PyP y en
   evento, o una clave `|EVENTO` sin su cápita, y **avisa** de qué
   combinaciones se quedan sin convenio de evento.

El efecto neto es que un especialista sin medir **no se puede encender por
accidente**: la cita falla con un mensaje que nombra la clave que falta.

### ✅ G.3 confirmó el par primera vez / control (2026-09-03)

| familia | especialidad | 1ª cita del paciente | citas posteriores |
|---|---|---|---|
| 890206/890306 | nutrición | **99,0 %** con `8902xx` | 44,9 % |
| 890242/890342 | dermatología | **99,7 %** | 14,5 % |
| 890250/890350 | ginecología | **97,9 %** | 16,3 % |
| 890266/890366 | medicina interna | **97,1 %** | 11,3 % |
| 890283/890383 | pediatría | **91,6 %** | 42,4 % |
| 890284/890384 | psiquiatría | **98,5 %** | 22,2 % |

Seis familias de seis. Y el sesgo de la ventana de 3 años juega **a favor**: un
paciente cuya primera visita real fue antes entra como «primera» llevando un
código de control, lo que ensucia la columna de la izquierda. Aun así sale por
encima del 91 %.

Que las citas posteriores conserven un 11-45 % de `8902xx` no contradice nada
—«primera vez» se reabre con un episodio nuevo— y de hecho **refuerza la
decisión de preguntárselo al paciente**: no se puede deducir del historial. Que
pediatría y nutrición sean las más altas encaja con que un niño estrena motivo
de consulta a menudo.

### 🚨 G.4 encontró NUEVE huecos más — y `R_ESP_SER` no sirve (2026-09-03)

54 servicios con citas en 90 días.

**Lo bueno:** las 45 especialidades que ya había son **correctas al 100 %**,
las cinco deducidas del par CUPS incluidas. Y los propios nombres del hospital
las validan mejor que cualquier estadística:

```
890242ESP  CONSULTA DE PRIMERA VEZ POR ESPECIALISTA EN DERMATOLOGÍA
890342ESP  CONSULTA DE CONTROL O DE SEGUIMIENTO POR ESPECIALISTA EN DERMATOLOGIA
890206     CONSULTA DE PRIMERA VEZ POR NUTRICIÓN Y DIETÉTICA
890306     CONSULTA DE CONTROL POR NUTRICIÓN Y DIETÉTICA
```

La hipótesis de G.3 no era una hipótesis: está escrita en el catálogo.

**Lo malo:** nueve servicios más con el defecto **por partida doble** — sin
especialidad *y* sin marcar como PyP:

| servicio | | esp | citas/90d |
|---|---|---|---|
| `890201AA` | adolescente, médico | 328 | 22 |
| `890201AJ` | joven, médico | 328 | 34 |
| `890201CP` | preconcepcional | 328 | 12 |
| `890201INF` | infancia, médico | 328 | 34 |
| `890205AA` | adolescente, enfermería | 060 | 28 |
| `890205PI` | primera infancia, enf. | 060 | 3 |
| `890205-LM` | lactancia materna, enf. | 060 | 2 |
| `890205CAM` | tamizaje de mama, enf. | 060 | 1 |
| `I890305AG` | control gestante, enf. | 060 | 1 |

Son los servicios de **curso de vida del médico 80-1 (RIAS)**, uno de los seis
rojos. Sus especialidades son de la familia PyDT ⇒ son de PyP ⇒ facturaban al
convenio general. Ya están mapeados; `serviciosPyp` pasa de 14 a **23**.

La invariante nueva —*toda especialidad de la familia PyDT está marcada como
PyP*— es la que los habría cazado, y se comprobó que falla al quitar uno.

**Y un desmentido:** `R_ESP_SER` discrepa de lo observado en **22 de 54**
servicios (dice 461 para `990203` y las citas usan 572; dice 571 para
`997301-1` y usan 572; dice 000 para `S35102` y usan 590). La especialidad se
deriva de las **citas reales**, no del catálogo. Cae la hipótesis del bloque 21b.

### 🚨 G.5: Salud Total es un tercio del hospital y AgenIA no la tenía (2026-09-03)

| EPS (NIT) | | primaria / PyP | especialista |
|---|---|---|---|
| **Sura** 800088702 | SUB | `467` SUBS · 5.604 | `535` EVENSURASUB · 706 |
| | CON | `473` CONTRIBUTIVO · 2.513 | `97` EVENSURACON · 391 |
| **Salud Total** 800130907 | SUB | `475` STOTALSUBS · 5.267 | `538` EVENTOSTOTALSU · 703 |
| | CON | `476` STCONTRIB · 929 | `96` EVENTOSTOTALCO · 171 |
| **Nueva EPS** 900156264 | SUB | `283` NUEVASUBSID · 3.302 | *(no tiene)* |
| | CON | *(no aparece)* | *(no tiene)* |
| Fomag 830053105 | | `518` · 418 / `529` PYPFOMAG | |

La estructura cápita/evento queda confirmada. Pero el titular es otro: **Salud
Total son 10.137 citas en 90 días** —contra 11.933 de Sura y 5.457 de Nueva
EPS— y no era «el 39 % de los especialistas» como se leyó en G.2, sino **un
tercio del hospital entero**. Ya está homologada con sus cuatro convenios.

⚠️ **Falta darla de alta como `Eps` en AgenIA.** Hoy el chatbot ofrece Nueva
EPS, Sura y Particular: un paciente de Salud Total no puede ni empezar. Y
necesita su padrón. `aplicar-mapping.ts` ahora cruza las dos tablas y lo avisa
por su NIT.

**Nueva EPS no tiene convenio de evento.** Sus 34 citas de especialista se
reparten entre `489` PYPSUBS (27) y `283` (7) — un convenio de PyP para una
consulta de especialista es raro y 34 citas no deciden nada. No se homologa:
`resolveConvenio` lanza.

#### ⚠️ Y una duda que G.5 abre sobre la sección D

El convenio `473` CONTRIBUTIVO está registrado en el catálogo del hospital bajo
el NIT de **Sura**, y Nueva EPS no aparece con **ningún** convenio contributivo
en 90 días. `mapping.json` dice `900156264|CONTRIBUTIVO = 473` porque así lo
midió D — pero **D usó `R_PAC_EPS`, la misma tabla cuyo fan-out invalidó G.1**.

- *(a)* `473` es un contrato contributivo genérico usado por varias EPS. Lo
  apoya que se llame solo «CONTRIBUTIVO» y no «SURACONTRIB».
- *(b)* La conclusión de D está contaminada.

En contra de (b): si Nueva EPS contributivo facturara a un contrato propio, ese
contrato tendría volumen, y el único candidato (`290` NUEVAEPSCONT) tiene **dos**
citas en 90 días. En contra de (a): Salud Total **no** usa el 473 — tiene su
propio `476`.

Se deja como está y **se pregunta**. Es la pregunta 1-bis del cuestionario.

### ⚠️ La sección G.1 se corrió y no concluyó — el defecto era de la consulta

G preguntaba si el sufijo `ESP`/`SUR` depende de la EPS del paciente. La cuota
de Sura salió así:

| raíz | ESP | SUR | |
|---|---|---|---|
| 890242 | 0,5 % | 16,1 % | dermatología |
| 890250 | 1,0 % | 15,3 % | ginecología |
| 890342 | 0,0 % | 15,5 % | dermatología, control |
| 890350 | 0,0 % | 15,7 % | ginecología, control |
| 890266 | 8,9 % | 17,8 % | medicina interna |
| 890366 | 9,5 % | 16,4 % | medicina interna |

El enriquecimiento es evidente, pero **no demuestra nada**, y la culpa es de
cómo escribí la consulta: uní por `R_PAC_EPS`, que es un historial
many-to-many y admite varias filas por (paciente, EPS). Ninguna de esas cuotas
es una proporción de citas. Se sabe que hay duplicados porque en medicina
interna salen 186 filas de Sura en un bucket que la sección F midió en **131
citas**: más filas de una sola EPS que citas hay en el bucket. Dejé el aviso
del fan-out escrito en la cabecera de la propia consulta y la mandé igual.

**G.2** lo arregla sin ambigüedad: la cita ya lleva su convenio en
`NU_NUME_CONV_CIT`, y de ahí se llega a la EPS por `CONVENIOS.CD_NIT_EPS_CONV`.
Una fila por cita, cero multiplicación.

### 🔑 Lo que G sí destapó: los códigos son pares CUPS primera vez / control

Mirando las raíces juntas aparece la estructura:

```
890242 / 890342   dermatología
890250 / 890350   ginecología
890266 / 890366   medicina interna
890283 / 890383   pediatría
890284 / 890384   psiquiatría
890206 / 890306   nutrición      ← ya estaban las dos en mapping.json
```

Es la **CUPS nacional**: `8902xx` = consulta de primera vez, `8903xx` =
consulta de control o seguimiento. El `mappingJson` ya lo llevaba dentro sin
que nadie lo hubiera nombrado — `890206` y `890306` apuntan los dos a
NUTRICION Y DIETETICA.

Esto asciende el patrón que asomó en la sección F de "corazonada sobre los
porcentajes" a **regla con nombre y estándar detrás**, y hace que la pregunta
del chatbot «¿primera vez o control?» elija un dígito documentado en vez de
adivinar entre dos códigos parecidos. **G.3** la comprueba contra los datos del
hospital: para cada paciente y familia, si la PRIMERA cita lleva `8902xx` y las
siguientes `8903xx`, está confirmado.

### ✅ La especialidad ya no se adivina — y los cinco huecos están tapados (2026-09-03)

`resolveEspecialidad` era la única función de mapeo que **fallaba en silencio**.
`mapConvenio` y `mapSexo` lanzan `MappingIncompletoError` ante un hueco; esta
devolvía `especialidadPorDefecto` (`'000'` MEDICINA GENERAL) y la cita entraba
al HIS mal etiquetada sin que saltara nada. Una consulta de dermatología
facturada como medicina general no da error, no deja rastro, y se descubre
cuando la EPS glosa.

Tres cambios que van juntos:

1. `especialidadPorDefecto` pasa a **opcional** y Anserma **no la declara**. Un
   servicio sin homologar lanza, con un mensaje que dice qué servicio falta y
   dónde se arregla.
2. Los **cinco servicios** que faltaban están mapeados (`890242ESP`,
   `890342ESP/SUR`, `890350ESP/SUR`). No se adivinó la especialidad: ni el
   dígito 2/3 del par CUPS ni el sufijo ESP/SUR la cambian —se ve en los pares
   ya mapeados—, así que `890342*` es dermatología (200) y `890350*` ginecología
   (341). **G.4** lo confirma contra los datos.
3. `aplicar-mapping.ts` valida el par CUPS y el hermano ESP/SUR **antes de
   escribir** en `HospitalMirrorConfig`, y avisa si alguien vuelve a declarar
   un default.

⚠️ **Los tres son un solo despliegue.** Quitar el default del `mappingJson` sin
el cambio de código es *peor* que dejarlo: se comprobó en el entorno local y el
agente viejo escribió la cita con `CD_CODI_ESP_CIT` **vacío**, que ni siquiera
es un valor plausible. El orden es: desplegar el agente, y después
`aplicar-mapping.ts`.

#### Verificado de punta a punta contra el SQL Server

| | |
|---|---|
| Servicio homologado | ✅ la cita llega: `S39141-1`, especialidad `000`, convenio `283`, `ASIGNADA POR WHATSAPP` |
| Servicio **sin** homologar | ✅ la cita **NO llega**. El log dice: *«El servicio "890999ZZ" no tiene especialidad homologada (CD_CODI_ESP_CIT). Añádelo a especialidadPorServicio…»* |
| Reintentos | ✅ backoff exponencial; a los 5 fallos entra en **modo seguro** y deja de escribir |
| Reconciliación | ✅ marca la deriva: «2 cita(s) que el hospital NO tiene» |
| Al arreglar el mapeo | ✅ **se cura sola**: el evento encolado se aplica sin replay manual |
| Cancelación | ✅ la fila desaparece de `CITAS_MEDICAS` y queda en `CITAS_ANULADAS` con motivo `WB` |

#### La red que faltaba en los tests

Fijar servicio por servicio no habría servido: el hueco eran cinco códigos que
**nadie había escrito**, y un test que enumera lo que hay no echa en falta lo
que no está. Las invariantes nuevas sí, y se comprobó que fallan reinyectando
el defecto original:

- primera vez y control comparten especialidad (par CUPS);
- el sufijo ESP/SUR tampoco la cambia;
- **un CUPS sin su pareja tiene que estar declarado**, no ser un olvido (los
  cinco singletones legítimos de PyDT están listados con su razón);
- todo servicio de PyP tiene especialidad — es el que decide el convenio;
- ninguna especialidad apunta a un código fuera del catálogo;
- `especialidadPorDefecto` no se declara.

### ✅ El resolvedor de médico ya no ofrece médicos apagados (2026-09-03)

`resolvePreferredDoctorId` filtraba por `isActive` pero no por
`whatsappBookingEnabled`. Son cosas distintas: la primera es «este médico
trabaja aquí», la segunda «está encendido para WhatsApp». En un espejo de
hospital la segunda arranca en `false` para **todos** —`homologar.ts` importa
los 27 médicos del HIS apagados y el piloto los enciende uno a uno—, así que el
resolvedor devolvía tan tranquilo un médico al que AgenIA no puede agendar. Hoy
eso mete al paciente en una lista de espera de un cupo que nunca se le va a
ofrecer; con el flujo nuevo sería peor, porque el médico se elige por nombre.

### ⚠️ Cinco servicios con volumen real no tenían especialidad mapeada — ✅ RESUELTO

`especialidadPorServicio` se generó en el bloque 31d filtrando a médicos **con
turnos futuros**. G sacó a la luz cinco servicios con citas reales en los
últimos 90 días que quedaron fuera:

```
890242ESP   890342ESP   890342SUR   890350ESP   890350SUR
```

No rompía nada todavía —esos médicos no tienen turnos, así que AgenIA no los
ofrecía— pero `especialidadPorDefecto` era `"000"` MEDICINA GENERAL, de modo
que en cuanto alguno se habilitase —y **890350 es justo la mitad "control" de
ginecología, lo primero que hace falta cuando el chatbot pregunte «primera vez
o control»**— la cita habría entrado al HIS con la especialidad equivocada, en
silencio.

Las cinco están mapeadas y el default ya no existe. Ver arriba.

### 📄 Qué falta correr en el hospital

Todo lo que queda por descubrir está consolidado en
`sql/PENDIENTE_CORRER_EN_HOSPITAL.sql` — 100 % lectura. Cerradas: **A** (obliga
a cambiar el modelo de cupo), **B**, **C**, **D**, **E** y **F**. La **G.1** se
corrió pero no concluyó. **G.2** a **G.6** están todas corridas y cerradas.

✅ **No queda nada por correr en el hospital.**

Dos son de mantenimiento y hay que **repetirlas cada vez que se encienda un
médico nuevo** — son las únicas que ven lo que AgenIA todavía no conoce:

- **G.4** — ¿algún servicio suyo se quedó sin especialidad?
- **G.6** — ¿alguno se factura por evento y no está en la lista?

### 🚨 G.6 cerró la tabla, y corrigió dos cosas (2026-09-03)

48 servicios con 5 o más citas. **El corte es limpio, sin zona gris:** 32 por
cápita (todos < 0,6 % de evento) y 16 por evento (todos > 90 %).

**Corrección 1 — nutrición se factura por EVENTO, y no estaba en la lista.**

| | | citas | % evento |
|---|---|---|---|
| `890206` | CONSULTA DE PRIMERA VEZ POR NUTRICIÓN | 370 | **97,0 %** |
| `890306` | CONSULTA DE CONTROL POR NUTRICIÓN | 57 | **98,2 %** |

El patrón `8902%`/`8903%` de G.5 los metía en el mismo saco que a los
especialistas — era exactamente el motivo de escribir G.6. Con la tabla
anterior, una cita de nutrición de Sura subsidiado se habría facturado al `467`
de cápita en vez de al `535`.

⚠️ **Consecuencia sobre la sección E: el médico NU02 estaba clasificado como
amarillo, «la factura sale bien». No lo estaba.** Ya está corregido en el
mapeo, pero hay que decirlo en la reunión.

**Corrección 2 — el «MIXTO» no era una ambigüedad, era un agregado engañoso.**

`890284ESP` (psiquiatría primera vez) salió al 72,9 %. Su 27 % de cápita son
*exactamente* los pagadores sin contrato de evento:

```
283 NUEVASUBSID   Nueva EPS                       7 citas
232 PERSOCIAL     personal del propio hospital    6
467 SUBS          Sura — que SÍ lo tiene          4   ← anomalía real
```

Es decir: **la modalidad no es propiedad del servicio, sino del par (servicio,
EPS)**. El mismo acto se factura por evento a quien tiene contrato de evento y
por cápita a quien no. Su hermano `890384ESP` sale al 100 % solo porque a él no
fue ningún paciente de los pagadores sin contrato.

El modelo de AgenIA ya lo refleja sin tocar nada: la clave es
`nit|RÉGIMEN|EVENTO`, así que Sura y Salud Total van al convenio de evento y
Nueva EPS —que no tiene— hace **fallar** la cita en vez de facturar a ciegas.

**Y la confirmación que importa para el piloto:** los cuatro verdes usan solo
servicios de cápita, con volumen de sobra —`S39141-1` 7.014 citas al 0,0 %,
`890201-CI` 2.531 al 0,0 %, `I890305PL` 1.114 al 0,0 %. **El piloto no toca
facturación por evento por ningún lado.**

## ⏳ Pendientes de este driver

0. ✅ **Bloque 29 — CERRADO (2026-09-03).** (`sql/FASE0_DESCUBRIMIENTO_HIS.sql`,
   sección C de `sql/PENDIENTE_CORRER_EN_HOSPITAL.sql`)
   La medición 29c/29d confirmó el arreglo: la forma sargable gasta **28 ms de
   CPU** contra **511 ms** de la que envolvía la columna en `CONVERT`
   (16.655 vs 23.131 lecturas lógicas, 0 físicas en ambas). El tiempo de reloj
   era idéntico —28 vs 29 ms— porque SQL Server paralelizaba la mala; el coste
   estaba escondido en el CPU, no en la espera. A un ciclo cada 30 s el espejo
   le cuesta al HIS **0,09 % de un núcleo**. No hace falta pedirle ningún
   índice al hospital ni bajar la frecuencia del bucle. Las dos preguntas
   colaterales también quedaron respondidas: sí existen claves (médico+hora)
   duplicadas —la PK incluye el estado— y `NU_NUME_MOVI_CIT` llega a ser NULL
   en 1 fila de 1.084.093, que es el defecto que se corrigió con `COALESCE`.

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

---

# 🎯 ALCANCE REDUCIDO: SOLO MEDICINA GENERAL (2026-09-03)

El hospital decide arrancar **únicamente con Medicina General de consulta
externa** por WhatsApp. Los demás servicios los siguen manejando con su propio
software. Sin especialistas.

Esto no es un recorte cosmético: **desactiva el bloqueante principal.**

## 1. La sección A deja de bloquear — y está demostrado

La sección A bloqueaba porque el 72,5 % de los turnos mezcla servicios y AgenIA
le estampa a cada cupo el único servicio de la ficha del médico. **Pero el daño
nunca fue la mezcla en sí: era que la mezcla cruzaba la frontera de PyP** (y,
tras G.6, también la de cápita/evento). Un servicio mal elegido cambiaba el
convenio y producía una glosa.

Dentro de medicina general **no hay ninguna frontera que cruzar**:

| servicio | especialidad | ¿PyP? | ¿evento? | citas/90d |
|---|---|---|---|---|
| `S39141` consulta ambulatoria de medicina general | 000 | no | no | 5.637 |
| `S39141-1` control hipertensos | 000 | no | no | 7.014 |
| `S39141-2` lectura de exámenes | 000 | no | no | 1.022 |

Y el convenio que sale es **idéntico** para los tres, en toda combinación:

| EPS | régimen | `S39141` | `S39141-1` | `S39141-2` |
|---|---|---|---|---|
| Sura | SUBSIDIADO | 467 | 467 | 467 |
| Sura | CONTRIBUTIVO | 473 | 473 | 473 |
| Nueva EPS | SUBSIDIADO | 283 | 283 | 283 |
| Nueva EPS | CONTRIBUTIVO | 473 | 473 | 473 |
| Salud Total | SUBSIDIADO | 475 | 475 | 475 |
| Salud Total | CONTRIBUTIVO | 476 | 476 | 476 |

**Equivocarse entre los tres no cuesta un peso.** Lo que queda es sub-oferta —
elegir el código menos preciso— y eso es un defecto de catalogación, no de
facturación. El cambio de modelo sigue siendo necesario para crecer, pero **ya
no bloquea el arranque**.

⚠️ El argumento depende de que **solo se enciendan médicos de medicina
general**. Los médicos 77 (gestante HTA, 36 % PyP) y 80-1 (RIAS, curso de vida)
tocan PyP de verdad y **no pueden entrar**. Su especialidad ni siquiera es la
misma: `328 MEDICINA GENERAL PYDT` no es `000 MEDICINA GENERAL`.

## 2. Lo que el recorte deja fuera, y ya no hay que resolver para arrancar

| | por qué deja de aplicar |
|---|---|
| El cambio de modelo (sección A) | no hay frontera que cruzar dentro de medicina general |
| «¿primera vez o control?» | los `S39141*` no son un par CUPS `8902xx`/`8903xx` — la pregunta no tiene sentido aquí |
| El sufijo `ESP`/`SUR` | son códigos de especialista |
| Los convenios de evento (535, 97, 538, 96) | medicina general es 100 % cápita, medido: 0,0 % de evento en 13.673 citas |
| Nutrición factura por evento | fuera de alcance |
| 4 de los 6 médicos rojos | fuera de alcance (quedan 77 y 80-1, que se excluyen) |
| Los 9 servicios de curso de vida | son PyDT, no medicina general |

Nada de ese trabajo se tira: los guardarraíles siguen puestos y son
precisamente lo que impide que alguien encienda un especialista por accidente
—`resolveConvenio` lanza si falta el convenio de evento—. Pero **ninguno está
en el camino crítico del arranque**.

## 3. Lo que SÍ falta, en orden

### ✅ G.7: Salud Total confirmada, y una fiduciaria detrás de «Fomag»

Corrida contra el hospital. Tres hallazgos.

**1. El NIT de «Fomag» no es Fomag — es la fiduciaria que lo administra.**
`830053105` es «FIDEICOMISOS PATRIMONIOS AUTONOMOS FIDUCIARIA LA PREVISORA»,
en Bogotá. Entre sus convenios NO vigentes hay INPEC (prisiones) y otros — es
la fiduciaria que administra varios contratos del Estado, y solo dos de sus
convenios activos son de magisterio (`518` MAGISTERIOFOMAG, `529` PYPFOMAG).
Importa para el chatbot: si un paciente escribe «La Previsora» eso no dice si
es magisterio o cualquier otro programa de esa fiduciaria.

**2. Los cuatro convenios de Salud Total vencen el 31-dic-2026 — igual que los
cinco que ya usa el driver (confirmado en D.4).** Faltan ~4 meses. Y hay una
prueba de que la renovación NO es automática con el mismo número: Salud Total
tuvo convenios propios de PyP (`261` PYPSALUDTOTAL, `481` STPYPSUBS) que
vencieron el 2025-12-31 y **no se renovaron** — hoy su PyP se factura al
convenio general, que es exactamente lo que hace el mappingJson. Confirma que
el repliegue de PyP no es una suposición: es lo que el hospital decidió al no
renovarlos. Pero también es la prueba de que hay que **repetir esta consulta
en diciembre**, porque un convenio puede desaparecer sin aviso.

**3. 🚨 El padrón de Fomag abre una pregunta estructural sobre el régimen.**
Salud Total reparte limpio entre los dos regímenes que AgenIA conoce:

| régimen | pacientes | % |
|---|---|---|
| SUBSIDIADO (01+02+14) | 10.633 | 82,4 % |
| CONTRIBUTIVO (07-12) | 2.267 | 17,6 % |

Pero **los 1.046 pacientes de Fomag/La Previsora están, los 1.046, bajo el
código de régimen `15`** — que no es ninguno de los confirmados en D.6
(01/02/14 subsidiado; 07-12/18 contributivo). Cero excepciones.

Encaja con lo que es el magisterio en Colombia: un **régimen de excepción**, no
una EPS del régimen general. Si es así, la pregunta «¿subsidiado o
contributivo?» del chatbot (`parseRegimen` en `packages/shared`, que solo
conoce esos dos valores) **no tiene respuesta correcta** para un paciente de
Fomag. Como esa NIT solo tiene dos convenios activos —uno normal, uno de
PyP—, la solución más simple sería que el chatbot **no pregunte régimen** para
esta EPS: basta con saber si el servicio es de PyP.

⚠️ **No se homologó Fomag todavía.** Falta correr **D.7** (`SELECT * FROM
dbo.REGIMEN`), que confirma qué es el código 15 — ya estaba escrita, marcada
como opcional, y este hallazgo la vuelve necesaria. No es un bloqueante para
Salud Total ni para el arranque de medicina general: Fomag es el 2,4 % del
volumen y puede esperar.

### ✅ 1. Salud Total — CONFIRMADA para el arranque (2026-09-04)

> El hospital pidió arrancar con **Salud Total y Sura**. Nueva EPS queda
> fuera del primer corte, lo que baja la cobertura del arranque al 78,4 %.
> Falta darla de alta (`provision-eps-piloto.ts`) y su padrón.

Sobre 18.304 citas de atención primaria en 90 días:

| EPS | citas | % | ¿en AgenIA? |
|---|---|---|---|
| Sura | 8.126 | 44,4 % | ✅ |
| **Salud Total** | **6.196** | **33,9 %** | ❌ |
| Nueva EPS | 3.525 | 19,3 % | ✅ |
| Fomag | 432 | 2,4 % | ❌ |
| Particular | 13 | 0,1 % | ✅ |
| Otras (Reg. Aseg. N3, Axa) | 12 | 0,1 % | ❌ |

**Cobertura hoy: 63,7 %.** Dando de alta solo Salud Total: **97,6 %**.

Ya tenemos su NIT (800130907) y sus convenios (`475` STOTALSUBS, `476`
STCONTRIB) homologados. Falta crearla como fila `Eps` y cargar su padrón.

Es la única decisión que cambia de verdad el valor del arranque: sin ella, uno
de cada tres pacientes que escriba recibe «no tenemos convenio con esa EPS».

### 🔴 2. El padrón — hoy está vacío y bloquea a todos

`rejectIfNotEnrolledInEps` exige que la cédula esté en `EpsEnrolledPatient`
para **cualquier** EPS que no sea Particular. Sin padrón cargado, **nadie
puede agendar**: el bot responde «su documento aún no figura dado de alta».

Hace falta el CSV de altas de cada EPS que entre. No es desarrollo, es un
archivo.

### ✅ 3. Qué código lleva la cita de WhatsApp — RESPONDIDA (2026-09-04)

> La pregunta de los médicos 76/077 la contestó el hospital: son **agendas
> virtuales**, no médicos, y `S39141-1` es su código correcto. Pero la
> respuesta abrió un bloqueante nuevo sobre el traslado de esas citas al
> médico real — ver «RESPUESTA DEL HOSPITAL» más abajo, punto 2.

Ahora es una pregunta pequeña y con respuesta casi escrita:

- Los **11 médicos de medicina general** (AP04, AP08, MD08, MD09, MDD1, MDD2,
  R001, RU64, RU66, RU67, RU69) → `S39141` consulta ambulatoria de medicina
  general.
- Los **2 del programa de HTA** (76, 077) → `S39141-1` control hipertensos en
  el 98,4 % y 95,2 % de sus citas. **Sigue viva la pregunta de si son médicos
  del programa o comodines** — es la única del cuestionario que queda en pie
  para este alcance.
- `S39141-2` lectura de exámenes: no se ofrece por WhatsApp. Es el cierre de un
  proceso que empieza en consulta, no una cita que un paciente pida en frío.

### ✅ 4. La duda del convenio 473 — RESUELTA, Y ESTABA MAL (2026-09-04)

> El hospital confirmó que el 473 es de **Sura contributivo** y que Nueva EPS
> contributivo no tiene convenio. La clave se eliminó del `mapping.json`.
> El detalle, y el agujero del chequeo que lo dejó pasar, más abajo en
> «RESPUESTA DEL HOSPITAL», punto 3.

Con especialistas fuera, esta pasa de curiosidad a asunto en producción: los
pacientes **contributivos de Nueva EPS** que agenden medicina general se
facturarán al `473`, un convenio registrado bajo el NIT de **Sura**. Si está
mal, está mal desde el primer día. Es la pregunta 1-bis del cuestionario y se
corrige con una línea de configuración.

### ⛔ 5. Fomag — DECISIÓN: no lo soporta AgenIA (2026-09-03)

Se decidió que **AgenIA no dará soporte a Fomag/magisterio**. No es un
aplazamiento — a diferencia de las residuales (0,1 %, que sí podrían
homologarse más adelante sin más que un CSV — esta EPS queda **fuera del
alcance del producto**, sin fecha.

No hay nada que deshacer en el código: Fomag nunca llegó a homologarse.
`mapping.json` no tiene ninguna clave `830053105|*`, y `Eps` de AgenIA no
tiene esa fila. **D.7** (decodificar el régimen `15`) queda cerrada por esta
decisión: no hace falta correr una consulta para una EPS que no se va a
soportar.

Queda documentado por qué se llegó a investigar tanto: G.7 encontró que el
NIT `830053105` es en realidad una fiduciaria (La Previsora, no una EPS
tradicional) que administra varios contratos del Estado, y que su padrón
completo cae en un código de régimen ajeno a SUBSIDIADO/CONTRIBUTIVO — un
régimen de excepción, coherente con lo que es el magisterio en Colombia. Esa
complejidad estructural, sumada a ser solo el 2,4 % del volumen, es
justamente lo que hace razonable la decisión de no soportarlo: el esfuerzo de
construir una tercera rama de régimen en el chatbot no se justifica para ese
volumen.

⚠️ **Si en el futuro se revierte esta decisión**, no partir del trabajo de
G.7 sin releer el hallazgo del régimen de excepción — sigue siendo cierto que
`parseRegimen` (en `packages/shared`) solo conoce SUBSIDIADO/CONTRIBUTIVO, y
que un paciente de Fomag no tiene una respuesta correcta a esa pregunta.

---

# 📨 RESPUESTA DEL HOSPITAL (2026-09-04) — tres respuestas, una corrección y un bloqueante nuevo

El hospital contestó el cuestionario. Lo resumido: **la tabla de convenios que
habíamos deducido de sus datos era correcta en seis de siete combinaciones**, la
séptima estaba mal y la habíamos marcado como duda, y una respuesta que parecía
trámite abrió el único bloqueante que hoy queda en pie.

## 1. El alcance del arranque: Salud Total y Sura. Nueva EPS no entra.

> «para iniciar con SaludTotal y eps Suramericana»

Cambia la cuenta de cobertura que traía el documento. Sobre las 18.304 citas de
atención primaria en 90 días:

| EPS | citas | % | ¿en el arranque? |
|---|---|---|---|
| Sura | 8.126 | 44,4 % | ✅ |
| **Salud Total** | **6.196** | **33,9 %** | ✅ (hay que darla de alta) |
| Nueva EPS | 3.525 | 19,3 % | ❌ no en el primer corte |
| Fomag | 432 | 2,4 % | ❌ fuera de alcance (decisión de producto) |
| Particular | 13 | 0,1 % | ✅ |

**Cobertura del arranque: 78,4 %**, no el 97,6 % que se proyectaba cuando se
daba por hecho que Nueva EPS seguía dentro. Sigue siendo mucho mejor que el
63,7 % de hoy, y sube a 97,6 % el día que Nueva EPS entre.

**Lo que esto obligó a arreglar, y no era obvio.** Nueva EPS se apaga con
`Eps.isActive = false`. Pero los mensajes del chatbot para una EPS que no está
en la lista decían *«no tenemos convenio con esa EPS»* — y eso es **falso**: el
hospital tiene convenio vigente con Nueva EPS y le factura miles de citas al
trimestre. `isActive` significa «agendable por WhatsApp hoy», no «hay
contrato», y el mensaje confundía las dos cosas. A un afiliado de Nueva EPS se
le habría dicho que su EPS no tiene convenio con el hospital: información falsa,
inventada por AgenIA, que lo manda a buscar atención a otra parte. Reescritos
los seis mensajes (pools FORMAL e INFORMAL) para hablar del CANAL y no del
convenio. De paso se quitaron los ejemplos quemados —*«Ej: Sura, Sanitas, Nueva
EPS, Compensar»*—: nombrarle al paciente justo la EPS que está apagada es
invitarlo a escribir lo único que no se le puede agendar.

## 2. Los médicos 76 y 077 no son médicos — y eso abre un bloqueante

> «los codigos 76 y 077 se refiere a medico hta y medico hta2 fueron creados en
> el sistema para poder hacer agendamiento futuro. ya que los medicos reales los
> programan por semanas y los hipertensos puede ser hasta 3 meses y mas.»

La respuesta no es ninguna de las dos opciones que se ofrecían (¿médicos del
programa o comodines?). Son **agendas virtuales**: existen para poder vender
cupos más allá del horizonte en que hay médicos reales programados, porque el
hospital programa por semanas y un hipertenso se agenda a tres meses.

**Lo que sí resuelve:** el código de servicio. `S39141-1` control hipertensos es
el correcto para esos dos, y son cápita pura — la parte de facturación queda
cerrada.

**Lo que abre, y es serio.** Si al programar la semana real el hospital MUEVE
esas citas al médico que de verdad atiende, en el HIS eso no puede ser un UPDATE
inocuo: `CD_CODI_MED_CIT` es la primera columna de la PK de `CITAS_MEDICAS`.
Cambiar de médico es quitar una fila y poner otra. Y `detectChanges` indexa la
foto por `${médico}|${hora}`, así que la clave vieja desaparece:

- el agente lo lee como **CANCELACIÓN**,
- AgenIA le escribe al paciente **«su cita fue cancelada»**,
- y **libera el cupo**, que se puede vender por segunda vez.

No es un caso de borde: 76 y 077 son ~9.400 citas cada 90 días, el grueso del
volumen del arranque. Si el traslado es la operación normal, cada hipertenso
agendado por WhatsApp acaba recibiendo un aviso de cancelación falso.

**No se adivina: se mide.** Se añadió la **sección H** a
`sql/PENDIENTE_CORRER_EN_HOSPITAL.sql`, que busca la huella del traslado
(anulaciones de 76/077 cuya misma historia y misma hora reaparecen bajo otro
médico), su denominador, y la vía alternativa por si el hospital mueve la cita
sin archivarla. Es la única consulta que hoy bloquea el arranque.

## 3. Convenios: seis aciertos y el error que la medición no podía ver

> «el convenio 473 no pertenece a Nueva Eps, Pertenece a Eps Suramericana
> Contributivo. y el 467 eps suramericana Subsidiado. nueva eps subsidiado
> morbilidad es el 283 y nueva eps subsidiado para promocion y prevencion es
> 489. salud total subsidiado es 475 y salud total contributivo es 476.»

| Combinación | AgenIA decía | Hospital dice | |
|---|---|---|---|
| Sura · subsidiado | 467 | 467 | ✅ |
| Sura · contributivo | 473 | 473 | ✅ |
| Nueva EPS · subsidiado morbilidad | 283 | 283 | ✅ |
| Nueva EPS · subsidiado PyP | 489 | 489 | ✅ |
| Salud Total · subsidiado | 475 | 475 | ✅ |
| Salud Total · contributivo | 476 | 476 | ✅ |
| **Nueva EPS · contributivo** | **473** | **no existe** | ❌ |

**Seis de siete exactas.** Toda la cadena —deducir el convenio del volumen real
de citas, cruzarlo con el catálogo `REGIMEN`, descruzar los NIT— resultó
correcta donde tenía datos limpios.

**La séptima confirma la sospecha que ya estaba escrita.** `mapping.json`
llevaba desde el 2026-09-03 una nota `_convenios_pendiente_473` con las dos
lecturas posibles: *(a)* el 473 es un genérico de contributivo, o *(b)* la
medición está contaminada por el fan-out de `R_PAC_EPS`. Gana **(b)**. El 473 es
de Sura y solo de Sura.

Vale la pena mirar por qué falló justo esa: era **la combinación de cuota más
baja de las ocho** (73,4 % y 65,6 %, contra 84-94 % del resto) y **la única cuyo
convenio estaba registrado bajo el NIT de otra EPS**. Las dos señales estaban en
los datos y se documentaron como duda en vez de como hallazgo. La lección no es
«no deducir»: es que una cuota que baja de golpe respecto de sus hermanas es el
síntoma del fan-out, no ruido de fondo.

**Qué se cambió.** Se eliminó la clave `900156264|CONTRIBUTIVO` de
`mapping.json`. Sin ella `resolveConvenio` **lanza**, que es lo correcto: no hay
convenio conocido al que facturar, y adivinar es mandar un contributivo de Nueva
EPS a un contrato de Sura. Las claves de Nueva EPS subsidiado (283 / 489) se
conservan — el hospital las confirmó y sirven el día que entre.

### Y el agujero por el que se había colado

El chequeo de `aplicar-mapping.ts` cruzaba **NIT contra NIT**, así que el hueco
de `900156264|CONTRIBUTIVO` le pasaba por delante sin verlo: el NIT de Nueva EPS
*sí* estaba en el mapeo, por su clave de subsidiado.

Eso no es un detalle de un script. El convenio se resuelve **en el agente, al
escribir en el HIS** — es decir, DESPUÉS de haberle dicho al paciente que su
cita quedó. Cuando falta, la cita no se escribe: muere en dead-letter y el
paciente se presenta al hospital con una cita que allí no existe.

Ahora el cruce se hace **por EPS activa × régimen**, y es un **error que aborta
el script**, no un aviso. Y el mismo criterio se aplica antes de encender nada:
`provision-eps-piloto.ts` (nuevo) se niega a activar una EPS a la que le falte
el convenio de alguno de los dos regímenes.

## 4. Autorización para correr el script en PRUEBAS: concedida

> «En pruebas puedes correr el scrip no hay problema. si necesitas copia
> reciente me avisas para restaurarla.»

Desbloquea el paso previo al corte. **Conviene pedir la copia reciente antes de
correrlo**: los convenios de Salud Total y los catálogos cambiaron desde la
última copia, y validar contra datos viejos es validar otra cosa.

Sigue pendiente lo de producción, que es lo que fija la fecha: correr
`AGENIA_SYNC_SETUP.sql` contra `ESEHSVP` y confirmar el domingo del corte.

## 5. Lo que sigue abierto del punto 1

El hospital dijo «ya le averiguo a facturación y le vuelvo a escribir» y luego
contestó el alcance. **No llegó el padrón de Salud Total**, que es un archivo,
no una decisión — y sin él ni un solo paciente de Salud Total puede agendar,
por más que la EPS esté dada de alta.

---

---

# ✅ SECCIÓN H CORRIDA — el bloqueante se cierra (2026-09-04)

El traslado de citas del MEDICO HTA al médico real **no existe como práctica**.
Los tres resultados dicen lo mismo.

## H.1 — un caso. Y ni siquiera es el que se temía.

| medico_virtual | motivo | medico_real | citas |
|---|---|---|---|
| 76 | 05 | 077 | 1 |

**Una** cita en 90 días, y el destino es `077` — la OTRA agenda virtual, no un
médico de verdad. La hipótesis que abría el bloqueante —«al programar la semana
mueven las citas al médico que atiende»— habría dejado cientos de filas aquí.
Dejó una, y de agenda a agenda.

## H.2 — el denominador dice que estas agendas casi no se tocan

| | motivo 05 | 06 | 01 | 11 | total |
|---|---:|---:|---:|---:|---:|
| 077 | 37 | 7 | 4 | 1 | 49 |
| 76 | 30 | — | 1 | — | 31 |
| | | | | | **80** |

Dos lecturas, las dos tranquilizadoras:

- **1 traslado sobre 80 anulaciones = 1,25 %.** No es un patrón, es un caso
  suelto.
- **80 anulaciones sobre ~9.400 citas es una tasa del 0,85 %**, contra el
  **8-9 % histórico del hospital** (92.464 anulaciones, dato de la 4ª ronda).
  Estas agendas se cancelan **diez veces menos** que la media. Son de lo más
  estable que tiene el hospital, justo lo contrario de lo que haría falta para
  que el traslado masivo fuera cierto.

## H.3 — no prueba traslado: prueba que hay dos caminos

1.213 citas de `S39141-1` con médicos reales (MDD2 280, 77 232, MD08 192, RU65
85…). Eso **no** es la huella de un traslado — es exactamente lo que describió
el hospital: **la cita cercana se agenda directo con el médico ya programado; la
lejana va a la agenda virtual.** Dos caminos que conviven, no uno que se
convierte en el otro.

## Y el argumento que cierra la puerta de atrás

H.1 solo ve traslados que pasen por `CITAS_ANULADAS`. Quedaba la vía silenciosa
(un DELETE sin archivar, o un UPDATE de la PK), que H.3 no puede descartar sola.
Pero sí la descarta el propio HIS: **no hay triggers ni procedimientos
almacenados de agendamiento** (Fase 0, 2ª ronda). Un traslado silencioso tendría
que hacerlo una persona, a mano, sobre ~5.800 citas cada 90 días — unas 65 al
día. No es plausible como rutina, y nada en el sistema lo automatiza.

## 🎯 Decisión: 76 y 077 entran como médicos normales

Es la propuesta que se puso sobre la mesa y los datos la respaldan. **AgenIA no
hace nada especial con ellos:** si el hospital crea turnos ahí, el espejo los ve,
genera cupos y agenda contra ese código. Quién atiende de verdad es gestión del
hospital, igual que hoy con su propia agendadora.

Es también la opción de menos código: es lo que el motor ya hacía. Y la de menos
riesgo — cualquier tratamiento especial habría sido lógica nueva sobre el camino
crítico del arranque, para un caso que resultó no existir.

**Lo que sí hubo que arreglar es lo que ve el paciente.** Los cuatro perfiles del
arranque son agendas funcionales, no personas:

| código | nombre en el HIS | lo que leía el paciente |
|---|---|---|
| 76 | MEDICO ATENCIÓN HTA | `Dr(a). MEDICO ATENCIÓN HTA` |
| 077 | MEDICO ATENCIÓN HTA 2 | `Dr(a). MEDICO ATENCIÓN HTA 2` |
| 91-1 | ENFERMERA CyD HSVP | `Dr(a). ENFERMERA CyD HSVP` |
| 91-2 | ENFERMERA SALUD REPRODUCTIVA | `Dr(a). ENFERMERA SALUD REPRODUCTIVA` |

No era un caso de borde: **los cuatro médicos del arranque son agendas**, así que
eso es lo que habría leído casi todo el paciente del piloto.

El honorífico estaba quemado en **doce sitios** (ocho plantillas de los dos pools
y cuatro listados del chatbot). Ahora lo decide `doctorLabel()` en un solo lugar
y las plantillas reciben el nombre ya formateado:

- `DoctorProfile.isFunctionalAgenda` (nuevo) marca el perfil que no es persona.
- `docs/drivers/cnt-sanvicente-anserma/agendas-funcionales.json` declara los
  cuatro y el nombre que verá el paciente. `homologar.ts` lo aplica al crear o
  enlazar, y lo enseña en la lista de revisión. El nombre del HIS no se pierde:
  queda en `MirrorEntityMap.externalLabel`.
- Una prueba recorre `chatbot.constants.ts` entero y falla si alguien vuelve a
  escribir el honorífico a mano en una plantilla — verificada inyectando la
  regresión.

El paciente pasa a leer **«Programa de Hipertensión»**, **«Consulta de
Crecimiento y Desarrollo»** y **«Consulta de Planificación Familiar»**. Si el
hospital prefiere otros nombres, se cambian en ese JSON y se vuelve a correr
`homologar.ts` — no es despliegue.

## El riesgo residual, dicho con su número

Queda **~1 cita cada 90 días** que sí se mueve (el caso de H.1). Cuando pase, el
paciente recibirá un aviso de cancelación que no le corresponde. Se asume: es un
caso cada tres meses contra el coste de construir lógica de correlación
«movida vs cancelada» para un patrón que no existe. Si la reconciliación diaria
empieza a reportarlo más a menudo, se revisa — el panel del espejo ya lo enseña.

## Lo que conviene preguntar de paso, sin que bloquee

**Qué es el motivo `05`.** Se lleva 67 de las 80 anulaciones. Si resultara ser
«no asistió», encajaría con pacientes citados a tres meses que se olvidan — y
además confirmaría el pendiente 0b (hoy AgenIA los guarda como `CANCELLED` y no
como `NO_SHOW`). Es un `SELECT * FROM dbo.MOTIVOANUL`.


# 📊 ESTADO PARA EL PRIMER CORTE A PRODUCCIÓN (2026-09-04)

## Lo que falta, y solo esto

| | qué | quién | ¿bloquea? |
|---|---|---|---|
| 1 | ~~Correr la sección H~~ | ~~TI~~ | ✅ **Cerrado** — no hay traslado (1 caso en 90 días) |
| 2 | **Padrón de Salud Total y de Sura** (CSV de afiliados) | Hospital | 🔴 **Sí** — sin él no agenda nadie |
| 3 | **Dar de alta Salud Total** y apagar Nueva EPS | Nosotros — `provision-eps-piloto.ts` | 🔴 Sí, pero es una corrida |
| 4 | **`AGENIA_SYNC_SETUP.sql` en producción** (`ESEHSVP`) | TI | 🔴 Sí |
| 5 | **Homologar contra el hospital real** (`homologar.ts`) y que alguien mire la lista antes del `--aplicar` | Nosotros + hospital | 🔴 Sí |
| 6 | **VM del agente activa** | TI | 🔴 Sí |
| 7 | **Domingo del corte confirmado** | TI | 🟠 Fija la fecha |
| 8 | **Plantillas de WhatsApp verificadas contra la WABA real** | Nosotros | 🟠 Sí para el envío proactivo |

## Lo que ya está y no hay que volver a tocar

| | |
|---|---|
| Motor de espejo punta a punta | ✅ WhatsApp → API → Postgres → outbox → agente → `CITAS_MEDICAS` |
| Cancelación y reprogramación | ✅ con constancia en `CITAS_ANULADAS`; reagendar nunca deja al paciente sin cita |
| Tabla de convenios | ✅ **confirmada por el hospital**, 6/7 exactas y la séptima corregida |
| El 473 no puede volver a cruzarse | ✅ test que fija el hueco y comprueba que el 473 es solo de Sura |
| Una EPS activa sin convenio no arranca | ✅ `aplicar-mapping.ts` aborta; `provision-eps-piloto.ts` se niega |
| Código de servicio de medicina general | ✅ `S39141*`, cápita pura, mismo convenio en las tres variantes |
| Especialidad `CD_CODI_ESP_CIT` | ✅ 0 contradicciones en 21.362 citas |
| Encendido médico por médico | ✅ `whatsappBookingEnabled`, apagados de fábrica |
| Resistencia a caídas | ✅ game-day 21/21 |
| Coste sobre el HIS | ✅ 0,09 % de un núcleo, medido |
| Fechas en zona de Bogotá | ✅ 0 violaciones |
| Lint de `apps/api` | ✅ **0 problemas** (eran 594 de la familia `no-unsafe-*`; se cerraron con tipos reales, sin desactivar una sola regla) |
| Pruebas | ✅ 1.591 API · 264 agente · 188 shared |

## Riesgos residuales — no bloquean, pero se saben

- **`apps/web` no tiene ni una prueba automatizada.** El panel del staff se
  verifica a mano.
- **No hay prueba de carga ni de concurrencia real** sobre el mismo cupo. El
  índice único parcial `uq_appointment_cupo_vigente` y la PK del HIS lo cubren
  por construcción, pero no está ejercitado bajo carrera.
- **Los convenios vencen el 31-dic-2026**, los nueve. Ya pasó una vez que uno no
  se renovara con el mismo número (261, 481 de Salud Total). Repetir D.4/G.7 en
  diciembre.
- **~1 cita cada 90 días sí se traslada de agenda** (el caso único de H.1). Ese
  paciente recibirá un aviso de cancelación que no le corresponde. Asumido a
  propósito; el panel del espejo lo enseña si empieza a repetirse.
- **Nueva EPS contributivo sigue sin convenio conocido.** No molesta mientras
  Nueva EPS esté apagada; hay que resolverlo ANTES de encenderla.

## Cuánto falta, en una cifra

**≈ 92 % listo para el primer corte.**

Subió del 85 % porque la sección H cerró el único punto que podía convertirse en
trabajo de desarrollo, y salió limpio: no hay traslado de citas, así que 76 y
077 entran como médicos normales y el grueso del volumen del arranque está
disponible desde el día uno.

**Lo que queda no es código.** Dos archivos CSV, una corrida de script, un
`AGENIA_SYNC_SETUP.sql`, una VM y una fecha. De las siete tareas vivas, **cinco
no dependen de nosotros**.

El camino crítico ya no es técnico: es el **padrón**. Sin él no agenda nadie, por
más que todo lo demás esté encendido.


---

# 🪪 EL PADRÓN LLEGÓ — Y ABRIÓ UNA INVESTIGACIÓN (2026-09-10)

La sección anterior cerraba diciendo que el camino crítico era el padrón y que
«lo que queda no es código». Llegó el padrón. **Y sí hay código que hacer**:
tres defectos silenciosos del importador que solo se ven con el archivo real
delante.

## 1. Qué llegó

El hospital entregó los dos padrones, primero como **PDF** y luego como CSV:

| Archivo | Filas medidas | Columnas | Delimitador |
|---|---|---|---|
| `Salud total 10-08-2026.csv` | 143 | **31** | `;` |
| `Suramericana 19-08-2026.csv` | 71 | **17** | `;` |

Los dos son claramente **muestras** de archivos mayores. El de Salud Total se
declara a sí mismo: `MesPeriodo=9`, `AñoPeriodo=2026`, `FechaGeneracion=08/10/2026`
⇒ es el padrón del periodo **septiembre 2026, generado el 10-ago**. El de Sura
**no trae ninguna columna de periodo**: su fecha de corte solo existe en el
nombre del archivo.

> ⚠️ **Los PDF mienten. No volver a analizar un padrón desde un PDF.** El primer
> análisis se hizo sobre los PDF y produjo tres conclusiones falsas: que Sura no
> traía el documento del afiliado (el PDF había recortado sus dos primeras
> columnas), que los nombres y direcciones venían truncados, y que la columna
> `Telefono` traía móviles cortados a 7 dígitos. Ninguna era cierta.

## 2. 🚨 Los tres defectos silenciosos del importador

Medido corriendo `validatePadronCsv` —el validador de verdad— contra los
archivos. Tal como llegan, los dos fallan en el encabezado (`eps` falta en
ambos; `cedula` además en Sura, porque `NUMERO DE IDENTIFICACION` no es un
alias). Pero **lo grave es lo que pasa si alguien agrega la columna `eps` a
mano para que «pase»**:

```
SALUD TOTAL + columna eps →  143 filas · 36 válidas (25 %) · 130 errores
                              77×  fecha_nacimiento inválida
                              53×  teléfono inválido
```

Y las 36 que pasan entran **mal, sin un solo error**:

| # | Defecto | Medición |
|---|---|---|
| 1 | **El alias `nombre` se come la columna equivocada.** `HEADER_ALIASES.nombre_completo` incluye `'nombre'`, y el archivo tiene una columna `Nombre` que son **solo los nombres de pila**. | Los 143 pacientes se importan **sin apellidos**. `fullName = "YULEY"` en vez de `YULEY BETANCUR ARICAPA`. |
| 2 | **Las fechas vienen en MM/DD/AAAA y `normalizeDate` asume DD/MM/AAAA.** | De 143 fechas de nacimiento: **77 (54 %) rechazadas**, **60 (42 %) pasan con día y mes INVERTIDOS**, y solo **6 (4 %)** quedan correctas —por coincidencia, porque día = mes. |
| 3 | **El alias `telefono` gana sobre `telefonomovil`.** `Telefono` casa con el alias; `telefonomovil` no casa con ninguno. | La columna `Telefono` es **87 % relleno** (`2000000` ×69, `0` ×48, `2000` ×4, `2999999` ×3). Y `2000000` tiene 7 dígitos ⇒ **pasa la validación**. Mientras `telefonomovil` está impecable: **131 de 143 llenos (92 %) y los 131 bien formados**. |

Y el remate: **Sura viene en DD/MM/AAAA**, o sea la convención opuesta. Dos EPS,
dos formatos, el mismo pipeline. Adivinar el formato no es aceptable.

### El contenido está bien: es el mapeo

Transformando los archivos al formato canónico (nombre = `Nombre + Apellido1 +
Apellido2`, teléfono = `telefonomovil`, fecha leída como MM/DD):

```
st_mapeado.csv    → ok=true  143 filas  143 válidas  0 errores
sura_mapeado.csv  → ok=true   71 filas   71 válidas  0 errores
```

**No hay nada que pedirle al hospital para arrancar con Salud Total.** El
trabajo pendiente es nuestro.

## 3. Lo que los archivos aportan que el HIS no tiene

| Dato | Salud Total | Sura | Por qué importa |
|---|---|---|---|
| **Régimen** | ✅ 82 % SUBS / 18 % CONTRIB | ✅ 51 / 49 % | Resuelve el convenio (475/476 · 467/473) **sin preguntárselo al paciente**. Hoy el bot lo pregunta con `parseRegimen`. La distribución de Salud Total coincide con la medida sobre el HIS (82,4 / 17,6 %) ⇒ el archivo es consistente |
| **Tipo de documento** | solo CC | ✅ CC 59 · TI 8 · **RC 4** | El driver escribe `NU_TIPD_PAC = 0` fijo. **El 17 % del padrón de Sura son menores con RC/TI** y entrarían al HIS tipificados como cédula — campo obligatorio de RIPS |
| **Móvil** | ✅ 92 %, 131/131 bien formados | ❌ no existe la columna | Es el canal del bot |
| **Nombre partido en 3** | ✅ | ✅ | El HIS lo guarda en 4 columnas; hoy `partirNombre()` adivina |

**Asimetría a preguntar:** el corte de Salud Total **no tiene un solo menor de
edad** (143/143 cédulas, y el parentesco más joven es «HIJO DE 18 A 25 AÑOS»),
mientras Sura trae 17 % de menores, el más pequeño de 3 años. O el archivo de
Salud Total viene filtrado a adultos, o nos mandaron un solo bloque.

**Y una columna que NO hay que ingerir:** `ProgramasEspeciales` (97 % de las
filas, 36 códigos, hasta 5 por celda) trae `ONC1 CÁNCER CONFIRMADO`,
`SMVA IDEACIÓN Y/O CONDUCTA SUICIDA`, `PF4 PLANIFICACIÓN IVE ALTO RIESGO`,
`VIMU VIOLENCIA FÍSICA`, `SPA2 CONSUMO DE SUSTANCIAS`, `04.7 IRC 5 CON
HEMODIÁLISIS`, `PA01 PAPSIVI`, `MET4 Indígena`, `MET3 Gitano`. **20 filas
(14 %) traen al menos uno.** Datos sensibles en el sentido pleno de la Ley 1581
—salud, salud mental, salud reproductiva, violencia, condición de víctima y
pertenencia étnica— y ninguno hace falta para autorizar un agendamiento.

## 4. 🔴 Estar en el padrón ≠ poder ser atendido

Hallazgo de negocio, no técnico. El padrón lista a los **capitados** a esta IPS.
Pero `mapping.json` tiene, para las dos EPS y los dos regímenes, **convenios de
EVENTO** (`535`/`97` Sura, `538`/`96` Salud Total), que existen precisamente
para atender a quien **no** está capitado. Y el propio archivo de Sura confirma
la distinción: su segunda tabla es la de **no capitados**, con una columna
`CAUSAL DE NO CAPITA`.

Hoy `rejectIfNotEnrolledInEps` bloquea a cualquiera que no esté en el padrón
⇒ **bloquearía exactamente a la población para la que existen esos cuatro
convenios vigentes.**

Pregunta para el hospital: **¿el padrón autoriza, o solo enruta el convenio?**
Si es lo segundo, el padrón deja de ser un portero y pasa a ser un enrutador.

**Recomendación independiente de la respuesta: arrancar la puerta en modo
observación.** Registrar durante 2-3 semanas a quién *habría* bloqueado, y solo
entonces activar el bloqueo. Es mucho mejor descubrir una cobertura insuficiente
en un log que en la cara de un paciente.

## 5. ¿Y si leemos el padrón del HIS en vez de un CSV?

Se evaluó el planteamiento de que el hospital siga subiendo el padrón como
siempre y que el agente del VPS lo detecte y replique. **La intención operativa
es correcta** —el hospital no aprende nada nuevo, nadie edita el archivo (que
es justo lo que produce la corrupción del §2), la base legal ya está cubierta y
el agente ya hace polling— pero **la fuente propuesta no contiene el dato**:

- `R_PAC_EPS` tiene **376.865 filas marcadas vigentes** `(NU_ESTA_RPE=1, TX_ACTI_RPE='S')` sobre 78.654 pacientes ⇒ **≈4,8 afiliaciones VIGENTES por paciente**, y la consulta de «pacientes con una sola afiliación» devolvió **cero filas** (D.6).
- Y **no tiene ninguna columna de fecha**: sin timestamp no se puede ni quedarse con la más reciente.

Si replicáramos de ahí, el padrón de Sura incluiría gente de Salud Total y
Nueva EPS (la puerta deja de filtrar) y **el régimen saldría de la fila
equivocada ⇒ convenio equivocado ⇒ glosa**. Es peor que no tener padrón.

Dos pérdidas adicionales: el **móvil** (el HIS depende de `DE_TELE_PAC
varchar(10)`, cuyo llenado no hemos medido) y los **afiliados nuevos**
(`R_PAC_EPS` apunta a `PACIENTES`: solo existe quien ya tiene historia clínica).

⇒ La meta se logra apuntando el agente **al archivo**, no a la base: que vigile
la carpeta/buzón donde el hospital ya lo deja, o que el padrón aterrice en una
tabla de staging **dentro de `AGENIA_SYNC`** (nuestra propia base, ya creada y
autorizada, sin tocar una columna del esquema del hospital).

## 6. Contexto del servidor (medido el 2026-09-10)

**SQL Server 2017 Standard (14.0.3465.1) sobre Linux (Ubuntu 18.04.6).**

| Hallazgo | Consecuencia |
|---|---|
| **15 bases en la instancia**: `AGENIA_SYNC`, `ESEHSVP` (viva, SIMPLE), `ESEHSVP2024`, `ESEHSVP2025`, `ESEHSVPREGALIAS`, `HSVPInvAnt`, `Presupuesto20`, `PRESUPUESTO2026`, `PRUEBAS`, `PRUEBAS_ACTIVOS`, `ReportServer2019` (+TempDB) y las de sistema | **Ninguna se llama padrón/BDUA/afiliados** ⇒ si el padrón está, está **dentro de `ESEHSVP`** |
| **Hay SSRS** (`ReportServer2019`) | Vía nueva y directa: la definición `.rdl` de cada reporte **contiene el SQL con el nombre de la tabla que consulta**. Si alguien saca un listado de capitados, ahí está |
| **Copias anuales completas** (`ESEHSVP2024`, `ESEHSVP2025`) | Experimento natural: comparar `COUNT(*)` de `R_PAC_EPS` en las tres mide si algo carga afiliaciones periódicamente |
| **Linux** | SSIS casi con seguridad no está en uso; y un `BULK INSERT` tendría que leer una ruta **local del Linux**, no un compartido de Windows ⇒ menos probable que el padrón entre por SQL |
| **El servicio se reinició el 2026-09-09 01:43** (fecha de `tempdb`) | Vació `sys.dm_db_index_usage_stats` ⇒ la vía de «qué tabla se escribió último» está **ciega** para la carga de agosto |

## 7. ✅ `AGENIA_SYNC_SETUP.sql` CORRIÓ EN PRODUCCIÓN — pendiente cerrado

`AGENIA_SYNC` existe desde el **2026-09-07**, y los permisos se verificaron uno
por uno el 2026-09-10: **21 permisos, coincidencia exacta con el script**.

- `CONNECT`
- **14 `SELECT`**: `CITAS_ANULADAS`, `CITAS_MEDICAS`, `CONSULTORIOS`, `CONVENIOS`, `EPS`, `MEDICOS`, `MOTIVOANUL`, `MUNICIPIOS`, `PACIENTES`, `R_ESP_SER`, `R_PAC_EPS`, `SERVICIOS`, `TIPO_DOCUMENTO`, `TURNOS_MEDICOS`
- Escrituras: `INSERT` en `CITAS_ANULADAS`; `INSERT`/`UPDATE`/`DELETE` en `CITAS_MEDICAS`; `INSERT`/`UPDATE` en `PACIENTES`

⚠️ **Lo que el login NO tiene**, y hace falta si la investigación lo confirma:
`R_PAC_CONV`, `ESEHSVP2024`/`ESEHSVP2025` y `ReportServer2019`. La
investigación se corre con cuenta administradora; si `R_PAC_CONV` resulta ser
la tabla de validación, hay que agregar
`GRANT SELECT ON dbo.R_PAC_CONV TO agenia_sync;` al setup.

## 8. `sql/PADRON_DESCUBRIMIENTO.sql` — la investigación abierta

Archivo nuevo, 13 secciones, 100 % lectura sobre las tablas del HIS. El marco:
**`dbo` tiene 1.393 tablas y la Fase 0 mapeó 14** — el padrón puede estar en
cualquiera de las otras 1.379.

Las tres que deciden la arquitectura:

| Sección | Qué decide |
|---|---|
| **P.1** ¿el carné del padrón (`Contrato_Medicard` = documento+dígito) está en `R_PAC_EPS.CD_CARN_RPE`? | Si aparece, el padrón **sí** se carga al HIS y explica el fan-out |
| **P.2** 15 personas de los CSV contra `PACIENTES` | Existencia, fecha de nacimiento, tipo de documento, sexo y teléfono, comparados uno a uno |
| **P.3** ¿`R_PAC_CONV` tiene ~1 fila por paciente? | Si sí, **es un estado y la lectura desde el HIS se vuelve viable**. Si tiene ~5 como `R_PAC_EPS`, queda descartada |

Más: P.11 (crecimiento año contra año en las copias anuales) y P.12 (catálogo
SSRS y búsqueda de texto dentro de las definiciones de reportes).

### Dos errores de la primera corrida, y qué enseñaron

1. **Faltaba `USE ESEHSVP`.** Todo corrió contra `master` → `Mens. 208: El
   nombre de objeto 'dbo.R_PAC_EPS' no es válido`. Corregido: el archivo
   arranca con `USE ESEHSVP; GO`.
2. **`SUM(CASE WHEN EXISTS (subconsulta) ...)` no es válido en SQL Server** →
   `Mens. 130, Nivel 15: No es posible usar una función de agregado con una
   expresión que contiene un agregado o una subconsulta`. Reescrita P.3d con un
   CTE `DISTINCT` + `LEFT JOIN`: una sola pasada y sin riesgo de fan-out.
3. **La lección que vale para los tres archivos SQL:** el error 130 es de
   **compilación** (nivel 15), así que —sin `GO` entre consultas— **abortó el
   lote completo y no devolvió un solo resultado**, ni de las secciones que
   estaban bien. Ahora cada sección termina en `GO`: un fallo se lleva su
   sección, no el archivo.

## 9. Lo que esto cambia del estado general

La sección anterior decía «lo que queda no es código». **Ya no es cierto.**
Aparecieron tres defectos del importador (§2) que corrompen datos en silencio,
y una decisión de arquitectura pendiente: la plantilla de 8 columnas no existe
en la vida real, y hace falta un **perfil de lectura por EPS** —formato de
fecha declarado, mapa de encabezados, columna del documento, homologación del
tipo de documento contra el catálogo del HIS (`0=CC, 1=TI, 2=RC`)— igual que el
driver del espejo lee el HIS nativo.

Ninguno bloquea la investigación en curso, y ninguno necesita al hospital.

---

# 🔎 LA INVESTIGACIÓN CERRÓ: NO HAY PADRÓN EN EL HIS (2026-09-10)

`PADRON_DESCUBRIMIENTO.sql` corrió completo en producción contra `ESEHSVP`, con
cuenta de administrador y salida a archivo (`Ctrl+Shift+F`). 39 consultas, cero
errores. Lo que sigue son los resultados medidos, no hipótesis.

## 1. La respuesta, en una frase

**El padrón nunca entró al HIS, y el hospital no valida derechos al agendar
porque no tiene con qué.** Quien está en el mostrador escoge un convenio de una
lista de ~42 y el padrón —si se consulta— se consulta con los ojos, en el
Excel, fuera del sistema.

Eso deja sin base la premisa con la que empezó todo esto («se supone que ellos
suben esos padrones tal como están»): **no los suben a ninguna parte.**

## 2. La prueba aritmética (P.11 + P.11b) — la definitiva

|                        | 2024    | 2025    | viva    | Δ 24→25 | Δ 25→viva |
|------------------------|---------|---------|---------|---------|-----------|
| `R_PAC_EPS` filas      | 420.420 | 433.837 | 443.325 | +13.417 | +9.488    |
| `R_PAC_EPS` pacientes  |  75.042 |  77.279 |  78.665 |  +2.237 | +1.386    |
| `PACIENTES`            |  75.164 |  77.405 |  78.791 |  +2.241 | +1.386    |

Pacientes nuevos y afiliaciones nuevas crecen **acopladas**: 6,0 y 6,8 filas
por paciente nuevo — que es exactamente cuántas filas recibe un paciente al
abrirle historia (esqueleto Particulares + FOSYGA + Municipio, más 1-3 EPS).

El HIS dice que Salud Total tiene 12.399 afiliados «vigentes» y Sura 12.065:
**24.464**. Una carga única, jamás repetida, de solo esas dos EPS metería
**2,6 veces todo el crecimiento anual de la tabla**. Mensual serían ~294.000
filas/año contra 9.488 observadas: **factor 31**.

`R_PAC_EPS` crece al ritmo de la ventanilla. Nada se carga en bloque. Nunca.

## 3. Las otras tres pruebas

- **P.1 — el carné no está.** 0 de los 6 carnés de Salud Total; y en las 443.325
  filas, `carne_es_doc_mas_cero = 0`. El formato `Contrato_Medicard` no ha
  tocado esta base jamás. (`carne_igual_a_doc` = 7.354; 186.437 sin carné.)
- **P.4d — no hay periodo.** `CD_POL_RPE`: **0 filas con valor**. No hay dónde
  anotar un corte, así que la tabla no registra cortes.
- **P.5/P.6/P.8/P.9/P.11c/P.12 — no hay maquinaria.** Ni tabla de padrón, ni SP
  cargador (los 8 de P.8 son facturación/RIPS), ni job (los 6 son backups y
  `PA_REVISA_SALDOS`), ni paquete SSIS (los 8 son del Data Collector del
  sistema), **ni un solo servidor vinculado**, ni reporte de afiliados entre los
  140 de SSRS. Y tampoco existió y se borró: ninguna tabla con forma de padrón
  aparece en las copias de 2024 ni 2025.

## 4. `R_PAC_EPS` no sirve para validar: los muertos tienen nombre

| EPS         | pacientes | «vigentes» | estado real                    |
|-------------|-----------|------------|--------------------------------|
| CAFESALUD   |    23.239 | **18.121** | absorbida por Medimás en 2017  |
| MEDIMÁS     |    19.663 | **15.519** | liquidada en 2022              |
| CAPRECOM    |    12.191 |  **8.315** | liquidada por decreto en 2015  |
| SALUDCOOP   |       506 |        392 | liquidada en 2015              |
| SALUD TOTAL |    12.806 |     12.399 | viva                           |
| SURA        |    12.364 |     12.065 | viva                           |

**18.121 personas están «vigentes» en una EPS que dejó de existir hace nueve
años.** `NU_ESTA_RPE = 1 AND TX_ACTI_RPE = 'S'` es decoración. Las nueve EPS
reales más grandes suman **121.388 afiliados vigentes sobre 78.791 pacientes**.

NIT confirmados (P.4a): **Sura `800088702`**, **Salud Total `800130907`**.

## 5. `R_PAC_CONV` es el desplegable, no el filtro

La hipótesis se confirmó mecánicamente y murió como herramienta:

- **97,5%** (P.3d): de 28.169 citas en 90 días, 27.475 llevan un convenio que sí
  está en el `R_PAC_CONV` del paciente. La aplicación del HIS **sí** saca de ahí
  la lista al agendar.
- **42,16 convenios por paciente** (P.3b), hasta 161. Solo 561 de 78.247
  pacientes tienen uno solo.
- El tope de la lista son contratos municipales vencidos: `RES032`
  (`vigente=0`, 72.121 pacientes), `PIC01` 65.270, `CONVPAI` 63.142,
  `SALUDPUB0032013` 59.747, `CONTAPS012D2015`, `CONVENIO0032017`…

Cada contrato anual del municipio se vinculó en bloque a toda la población. La
tabla responde «¿se le puede facturar esto alguna vez?» y contesta sí a casi
todo. Tiene **dos columnas**: `NU_HIST_PAC_RPC varchar(20)` y
`NU_NUME_CONV_RPC int`. Sin fecha, sin estado.

**→ NO pedir `GRANT SELECT ON dbo.R_PAC_CONV`.** Ya sabemos que no la
necesitamos. Un permiso menos en producción. (Los 21 permisos verificados el
2026-09-10 quedan como están.)

## 6. `NU_AFIL_RPE` no es «tipo de afiliado»: es un índice de casilla

Hallazgo inesperado de P.4c. Agrupando por `(afil, estado, activo)`, las filas
por paciente son **1,00–1,01** en todos los grupos grandes:

```
afil 6 · 1 · S → 78.657 / 78.657 = 1,00   (Municipio de Anserma)
afil 5 · 1 · S → 78.109 / 78.109 = 1,00   (FOSYGA)
afil 4 · 1 · S → 73.557 / 73.557 = 1,00   (Atención a particulares)
afil 0 · 1 · S → 73.750 / 73.342 = 1,01
afil 1 · 1 · S → 37.082 / 37.065 = 1,00
afil 2 · 1 · S → 26.064 / 26.063 = 1,00
afil 3 · 1 · S →  9.735 /  9.735 = 1,00
```

Las casillas 4/5/6 están **reservadas** para las tres filas sintéticas que
recibe todo paciente. Las 0–3 guardan aseguradoras reales, y en P.2b el orden
es cronológico:

```
1000125390:  0 → CAFESALUD (hasta 2017)   1 → MEDIMÁS (2017-2022)
             2 → SALUD TOTAL  ← lo que dice el padrón
1002594089:  0 → CAFESALUD  1 → MEDIMÁS  2 → MAPFRE  3 → SALUD TOTAL
```

Se cumple en 5 de 6 pacientes multi-EPS. **La casilla más alta con aseguradora
real parece ser la afiliación más reciente** — una forma de derivar «EPS
actual» sin columna de fecha, que habíamos declarado imposible. Es hipótesis a
una consulta de confirmarse, y sirve para **reconciliar, nunca para autorizar**.

⚠️ Si `mapping.json` o el driver interpretan `NU_AFIL_RPE` como
cotizante/beneficiario, están equivocados.

En los 15 casos de P.2b, la EPS que dice el padrón **siempre** está presente con
`activo='S'`: la tabla contiene la verdad, pero no puede aislarla.

## 7. El HIS le dio la razón a la lectura MM/DD de Salud Total

14 de 15 fechas de nacimiento coinciden exactas. Las tres ambiguas confirman el
formato:

| documento          | archivo      | HIS            | lectura        |
|--------------------|--------------|----------------|----------------|
| 1000125390 YULEY   | `03/11/2002` | **2002-03-11** | MM/DD ✅       |
| 10002511 ARMANDO   | `06/01/1977` | **1977-06-01** | MM/DD ✅       |
| 1002594089 LUISA   | `01/08/2000` | **2000-01-08** | MM/DD ✅       |
| 10018650 CARLOS    | `09/12/1973` | **1973-12-09** | ✗ discrepa     |

El archivo **no puede** ser DD/MM: `12/22/1999` (EDWIN) no tiene mes 22. Salud
Total es MM/DD, confirmado contra fuente independiente, y **el defecto del
importador que invierte día y mes queda probado, no inferido**.

El caso de CARLOS no es formato: es una fecha transpuesta en uno de los dos
sistemas. Con 1 de 7, pide **informe de reconciliación**, no regla nueva.

Aparecieron desacuerdos de nombre que el JOIN por documento tapaba: padrón
`BETANCUR` / HIS `BETANCOURT`; padrón `TAPASCO MELCHOR` / HIS `TAPASCO GAÑAN`
(dos hermanas, segundo apellido distinto).

**Tipo de documento y sexo: 15/15 correctos**, incluidos `RC=2` y `TI=1`.

## 8. Lo que `PACIENTES` sí tiene, y lo que miente

P.10, sobre 78.791 pacientes:

- **Teléfono: 78.788 con dato, pero 58.761 con móvil válido (74,6%).** No es el
  desierto que supusimos. En la muestra de 15 el HIS tenía móvil para **15 de
  15**, incluidas las 8 de Sura donde el padrón no trae ninguno. Donde ambos
  tienen dato discrepan en 3 de 5 (YULEY: HIS `12198523` inservible vs padrón
  `3105226861` → gana el padrón; ARMANDO: dos móviles válidos distintos).
  **El padrón complementa, no funda: hace falta regla de precedencia explícita.**
- **`DE_EMAIL_PAC` lleno en 78.738 (99,9%) NO es creíble** en un hospital rural
  de Caldas. Misma forma que la columna `Telefono` del padrón llena de
  `2000000`. **Verificar antes de creerle.**
- **`NU_TIPD_PAC` fijo en 0 en el driver está mal, confirmado:** CC 58.850 ·
  TI 10.981 · RC 5.374 · MS 2.688 · CE 418 · PE 177 · PT 138 · AS 111 · CN 48 ·
  CD 6. **19.941 pacientes (25,3%) no son cédula.**
- **Tres columnas muertas:** `NU_IPSPRIMARIA_PAC` 148 de 78.791 (y los valores
  son fechas y celulares); `NU_NIVE_PAC` = 0 para todos; y **`TX_COPO_PAC` no es
  copago** — es un código de localidad (`177080` en 70.598 pacientes = 89,6%,
  más basura como `cra 5` y `17001|`). Confirma dejar `ExentoCp`/`ExentoCm`/
  `RangoSalarial` fuera de AgenIA: no hay contraparte donde reconciliar.

## 9. Un tamaño que puede reventar el importador

Medido sobre los archivos entregados: Salud Total pesa **366 bytes/fila**. Si el
corte real son los 12.399 afiliados que dice el HIS, el CSV llega a **~4,54 MB —
el 76% de `MAX_CSV_CHARS = 6.000.000`** en
`apps/web/app/dashboard/padron/actions.ts`.

Y levanta una pregunta nueva para el hospital: **¿los archivos entregados (143 y
71 filas) eran muestras o el corte completo?** Contra 12.399 y 12.065, son el 1%.

## 10. Rastros de agosto: identificar antes de escribir en `PACIENTES`

**2026-08-13 07:38** — tres días después del corte de Salud Total:

```
07:38:22  PACIENTES        ← create_date: la tabla fue RECREADA
07:38:24  GRUPOPOBLA_PAC   ← modify_date
07:38:25  R_PAC_EPS        ← modify_date
```

Recrear una tabla de 78.791 filas es lo que hace SQL Server con ciertos `ALTER`.
Casi con seguridad es migración del proveedor, pero **el agente escribe en
`PACIENTES`** y hay que saber qué cambió. Hay un segundo lote el **2026-08-03
18:14–18:16** (`R_REG_EPS`, `CUOTA_TIPOAFIL`, `GRUPO_POBLA`, `FREC_SER_POBLA`,
`ANTRIESGO`…).

## 11. Pistas abiertas

| objeto | por qué |
|--------|---------|
| **`STG_DEMANDA_PYP`** — 85.293 filas, creada 24-jul-2026 | `STG` = staging y el tamaño es poblacional. El objeto con más forma de padrón de la base. Los barridos no lo vieron porque su nombre no lleva el vocabulario. |
| **`R_REG_EPS`** — 273 filas | Decodifica los regímenes `01/02/04/07/10/13/P/F` de P.2b. Necesario para enrutar convenios. |
| **`API_LOGS`** — 176.280 filas, creada 1-jul-2026, con `WB_CON`/`WB_LIC` | El proveedor montó un módulo API/web hace dos meses. Si expone afiliación, cambia el diseño. |
| **`PLANO`** — 1.410 filas, creada 15-ago-2026 | «Plano» = archivo plano. Cuatro días antes del corte de Sura. |
| **`CENSO NUEVA EPS`** (SSRS, `/08-Salud publica/`) | El único reporte de censo por EPS. Ver qué lee. |
| `LIQU_TIPOAFIL_COND` (940), `LIQU_TIPOAFIL_SERV` (842), `CUOTA_TIPOAFIL` (401) | Reglas de copago por tipo de afiliado. |

**Convención que conviene saber:** el prefijo **`_01`** es cómo este hospital
vuelca un Excel a la base (`_01MEDICAMENTOS` tiene columnas `30_NOVEDAD`,
`REGIMEN`, `TIPO AFILIACION PACIENTE`; también `_01CUPS`, `_01TARIFAS_UVB`,
`_01TRAZACXC`). Aparecen, se usan y se borran: P.11c los muestra solo en la
copia de 2025. Es el patrón que usarían si algún día cargaran el padrón.

## 12. Contexto de la corrida

SQL Server 2017 Standard 14.0.3465.1 en Linux (Ubuntu 18.04.6). **16 bases**
(entra `ReportServer2019TempDB`), `HAS_DBACCESS = 1` en todas. **1.394 tablas en
`dbo` + 7 en `ADMIN`.** Servicio arrancado **2026-09-09 01:43**, corrida a las
12:00 del 2026-09-10 → **34 h de uptime**, así que P.7b solo ve un día y medio;
en esa ventana **ni `R_PAC_EPS` ni `R_PAC_CONV` aparecen entre las 40 tablas más
escritas**. Los backups van a `/media/copias/{diario,mensual}/`. Las dos
cadenas de conexión de SSRS están cifradas y **no hay servidores vinculados**:
todo vive en esta instancia.

## 13. Lo que esto decide

**El plan «el agente lee el padrón del HIS» está muerto.** El CSV es la única
fuente de verdad, y AgenIA pasa a ser **el primer lugar del hospital donde los
derechos se validan de verdad**. Es argumento de venta y es riesgo: mantiene en
pie la recomendación de arrancar `rejectIfNotEnrolledInEps` en **modo
observación** 2-3 semanas, porque hoy nadie filtra y el cambio se va a notar.

Sigue abierta la pregunta no-SQL que decide la arquitectura de ingesta:
**¿dónde pone el hospital el archivo del padrón hoy?** (carpeta / correo) — y
ahora con una segunda: **¿lo que entregaron era muestra o corte completo?**

---

# 📐 EL PADRÓN VIVE EN AGENIA: DISEÑO MÍNIMO (2026-09-10)

Decisión tomada tras cerrar la investigación: **el padrón se carga en AgenIA y
AgenIA filtra las solicitudes de cita por WhatsApp usando el documento como
única llave.** El HIS no se toca para esto. Lo que sigue es el diseño y lo que
ya está corregido en código.

## 1. Los tamaños reales, y por qué el importador fallaba

Los archivos que analizamos (143 y 71 filas) eran un asomo. Los reales:

| archivo                              |   peso | filas estimadas | columnas |
|--------------------------------------|--------|-----------------|----------|
| Base de Datos Salud total 10-08-2026 | 3,3 MB | **~9.100**      | 31       |
| Base de Datos Suramericana 19-08-2026| 1,9 MB | **~10.500**     | 17       |

(363,5 y 181,7 bytes por fila medidos sobre las muestras.)

**El problema NO era el tamaño del archivo.** Los topes de entrada sobran:
3,3 MB es el 55% de `MAX_CSV_CHARS` y ~9.100 filas el 45% de `MAX_DATA_ROWS`.
El problema era el camino de escritura, y fallaba de tres formas:

1. **`createMany` con todas las filas de golpe.** Postgres usa un int16 para el
   número de parámetros del protocolo extendido: **32.767 es techo del
   protocolo**. A 13 columnas por fila, el padrón real pedía **~118.000
   parámetros**. No es «falla si el archivo es grande»: falla **siempre** por
   encima de ~2.500 filas, con `too many bind variables in prepared statement`.
2. **Los `update` uno por uno dentro de una sola transacción.** En una recarga
   mensual casi todas las filas son actualizaciones: ~10.500 ida-y-vueltas
   dentro de un mismo `BEGIN`.
3. **El `IN (...)` de la búsqueda previa** con 10.500 cédulas de un tirón.

### ✅ Corregido en `apps/web/app/dashboard/padron/actions.ts`

Un solo `INSERT ... ON CONFLICT ("organizationId","cedula") DO UPDATE` por lote
de 1.000 filas (13.000 parámetros, mitad del techo), y los ~11 lotes **dentro
de una única transacción** con `timeout` de 120 s: se conserva la atomicidad y
desaparece el techo. La búsqueda previa va troceada de 5.000. `createdAt` queda
fuera del `DO UPDATE`, así que quien reaparece en el corte siguiente conserva
la fecha en que entró. `npx tsc --noEmit` limpio.

Detalle que cuesta una tarde si se pasa por alto: **cada parámetro va con cast
explícito** (`::text`, `::timestamp(3)`). En un `VALUES` multi-fila, si el
primer valor de una columna es `NULL` —teléfono vacío en la fila 1— Postgres no
puede inferir el tipo y responde `could not determine data type of parameter`.

## 2. El padrón se reduce a tres campos

Tres fuentes, cada una con su oficio:

| fuente | qué responde | por qué es la única que puede |
|--------|--------------|-------------------------------|
| **Padrón (CSV de la EPS)** | ¿tiene derecho hoy, en qué EPS, en qué régimen? | nadie más lo sabe: no está en el HIS |
| **HIS (vía agente espejo)** | ¿quién es? nombres/apellidos separados, tipo de documento real, fecha de nacimiento, sexo, dirección | es el dato del hospital y es el que va a llevar la cita |
| **WhatsApp** | ¿por dónde le hablo? | el número entrante **es** el canal; no hay que buscarlo |

⇒ Del padrón sólo hace falta **documento + EPS + régimen**. De 31 y 17 columnas,
**2 de cada archivo** (la EPS se escoge en pantalla, ver §4).

Y eso disuelve, sin escribir una línea de validación, los defectos medidos:

| problema medido | qué pasa con el diseño nuevo |
|-----------------|------------------------------|
| 77 fechas rechazadas + 60 invertidas de 143 | **no se pide fecha de nacimiento** |
| `Nombre` sin apellidos en 143 de 143 | **no se pide el nombre** |
| `Telefono` con 87% de relleno (`2000000`, `0`) | **no se pide teléfono** |
| 41% de correos que son de terceros | **no se pide correo** |
| `ProgramasEspeciales`: 14% de filas con códigos sensibles (ONC1, SMVA, PF4, VIMU, SPA2) — **~1.260 filas en el archivo real** | **no entra**: se elimina toda la exposición de Ley 1581 |

El último no es una simplificación técnica, es **reducción de riesgo legal**: no
se custodia lo que no se necesita.

Confirmación de que el diseño calza con lo que ya existe: los dos porteros
(`chatbot.service.ts:1685` y `apps/web/lib/eps-enrollment.ts`) hacen
`findFirst` con `select: { id: true }`. **Nunca leen `fullName`, `phone` ni
`dateOfBirth`.** La tabla ya se usa como conjunto de pertenencia y nada más.

## 3. El bot no registra pacientes

Hay que separar dos «registros» que se venían confundiendo:

- **Registro en AgenIA** (`PatientProfile` + BSUID de WhatsApp): no se puede
  eliminar —sostiene la conversación y el consentimiento— pero puede ser
  implícito y mínimo: número de WhatsApp + documento. Sin formulario.
- **Creación del paciente en el HIS** (`INSERT INTO PACIENTES`): **se elimina.**

Tres beneficios concretos:

1. Mata el radio de daño del `NU_TIPD_PAC = 0` fijo del driver. Sabemos que
   **19.941 pacientes (25,3%) no son cédula**: TI 10.981, RC 5.374, MS 2.688,
   CE 418, PE 177, PT 138, AS 111, CN 48, CD 6.
2. **Es la razón técnica por la que el padrón baja a tres campos**: la fecha de
   nacimiento, el sexo y la dirección sólo se pedían para satisfacer los NOT
   NULL de `PACIENTES` al crear.
3. Permite quitar el `INSERT ON dbo.PACIENTES` de `agenia_sync` (el `UPDATE` se
   decide aparte: sirve para refrescar el teléfono).

**El portón queda como una intersección de tres condiciones:**

```
1. ¿el documento está en un corte activo de una EPS de arranque?   → AgenIA
2. ¿el documento existe en PACIENTES?                              → agente espejo
3. ¿hay agenda?                                                    → como hoy
```

⚠️ **Una intersección es más estricta que cualquiera de sus partes.** Quien
falle 1 o 2 se va al teléfono. En la muestra de 15 personas del padrón, 15
existían en el HIS (historias abiertas entre 2009 y 2026-07-15), pero 15 sobre
~19.600 filas no alcanza para decidir: **eso es lo que mide D.11 de
`PADRON_DESCUBRIMIENTO_2.sql`.**

⚠️ **El mensaje de rechazo debe ser uno solo para las dos causas.** Decirle «no
lo encuentro en el listado de su EPS» ya revela algo sobre su afiliación a
quien tenga el teléfono en la mano. Un texto neutro —«no puedo agendarle en
línea, comuníquese con el hospital al ___»— y la causa real al log interno.

Hoy `MSGS.epsNoAfiliado` manda a `/solicitud-alta/{organizationId}`: **ese
enlace de auto-registro es justo el flujo que sale.**

## 4. Cómo simplificar la carga (5 cambios, por valor)

1. **La EPS se escoge en la pantalla, no en el archivo.** Elimina el defecto #1
   de ambos archivos —ninguno trae columna `eps`; el de Sura tampoco trae
   `cedula` reconocible— y hace imposible mezclar EPS por error. Un archivo de
   Salud Total sólo puede traer afiliados de Salud Total.
2. **El corte es una entidad y REEMPLAZA.** Hoy el importador **nunca desactiva
   a nadie**: quien salió del padrón en septiembre sigue activo para siempre.
   La semántica correcta es: upsert con `importId` nuevo, y después un solo
   `UPDATE ... SET isActive = false WHERE epsId = <esa> AND importId <> <nuevo>`.
   Un `UPDATE` masivo, sin recorrer filas, y el `importId` deja trazabilidad
   («¿por qué rechazaron a Juan el 12 de octubre?» → de qué corte viene).
   ⚠️ **Necesita una respuesta del hospital: ¿el archivo es siempre el padrón
   completo, o a veces un parcial?** Si es parcial, desactivar a los ausentes
   saca a gente con derecho. Mientras no se sepa, la pantalla debe confirmar
   mostrando la cifra: «este corte desactivará 412 personas: ¿confirma?». Una
   cifra rara delata un archivo parcial antes de hacer daño.
3. **Sólo un campo obligatorio: el documento.** `REQUIRED_HEADERS` pasa de
   `['cedula','nombre_completo','eps']` a `['cedula']`. Sólo ese cambio sube las
   143 filas de Salud Total de **36 válidas a 143**.
4. **Normalizar el documento con LA MISMA función al cargar y al consultar.**
   Hoy divergen: el importador hace `replace(/[.\s]/g,'')` y los porteros
   `replace(/\D/g,'')`. Son compatibles para `1.234.567`, pero **ninguno quita
   ceros a la izquierda**: si el padrón trae `0012345` y el paciente escribe
   `12345`, se rechaza a alguien con derecho. Una sola función compartida.
5. **Reporte de reconciliación después de cada carga**, no un modal de «listo»:
   cuántos del corte no existen en el HIS, en cuántos discrepa la fecha de
   nacimiento, cuántos aparecen en el HIS con otra EPS. Ahí salen los casos como
   CARLOS BENITEZ (fecha transpuesta) y JANNA TAPASCO (`MELCHOR` en el padrón,
   `GAÑAN` en el HIS), y es lo que le da al hospital razones para confiar.

## 5. Migración mínima de esquema

```
EpsEnrolledPatient
  + regime        String?   -- SUBSIDIADO | CONTRIBUTIVO; enruta el convenio
  + importId      String?   -- de qué corte viene
  + tipoDocumento String?   -- informativo, para reconciliar
    fullName      String → String?    (deja de ser obligatorio)

+ PadronImport (id, organizationId, epsId, periodo, fechaCorte, fileHash,
                totalRows, created, updated, deactivated, createdByUserId, createdAt)
```

**Fuera, y ahora con mejor razón que antes:** `ProgramasEspeciales`,
`Contrato_Medicard`, `Alianza`, `AntiguedadSemanas`, `RangoSalarial`,
`ExentoCp`/`ExentoCm`, `Barrio`, la columna fija `Telefono`. Para los tres de
copago/nivel ya no es sólo que no los necesitemos: **no hay dónde
reconciliarlos** — `TX_COPO_PAC` no es copago (es un código de localidad,
`177080` en el 89,6%) y `NU_NIVE_PAC` es 0 para los 78.791.

`PadronSourceProfile` (perfil de lectura por EPS) **ya no hace falta**: sin
fechas, sin nombres y sin teléfonos, lo único que varía entre archivos es qué
columna trae el documento y el delimitador. Cabe en la misma pantalla de carga.

## 6. Preguntas abiertas para el hospital

1. **¿Los archivos entregados eran muestras o el corte completo?** 143 y 71
   filas contra 3,3 MB y 1,9 MB de archivo real: lo que analizamos fue el 1%.
2. **¿El padrón que envían las EPS es siempre completo, o a veces parcial?**
   Decide si el corte puede desactivar a los ausentes (§4.2).
3. **¿Dónde pone el hospital el archivo hoy?** (carpeta / correo) — decide si el
   agente vigila un directorio o si se carga a mano por la pantalla.
4. ¿El padrón autoriza o sólo enruta el convenio? (existen convenios por EVENTO
   para ambas EPS y ambos regímenes, y el archivo de Sura trae «CAUSAL DE NO
   CAPITA»).
5. ¿Qué significa `ESTADO SUSPENSION ACTUAL = 1`? En las 71 filas vistas es
   siempre `0`, así que no sabemos qué hacer con un 1. Por ahora: registrar, no
   filtrar.

---

# 🔬 SEGUNDA RONDA: LA LLAVE SIRVE, Y APARECIÓ UN DEFECTO DE DISEÑO (2026-09-10)

`PADRON_DESCUBRIMIENTO_2.sql` corrió completo (35 h de uptime, 12:49). 26
consultas, cero errores. Resultados medidos.

## 1. ✅ La llave sirve: `NU_HIST_PAC` es utilizable

| | |
|---|---|
| pacientes | 78.791 |
| **sólo dígitos** | **76.698 (97,34%)** |
| con letras o signos | 2.093 (2,66%) |
| con cero a la izquierda | 135 |
| con espacios alrededor | **0** |
| vacías | **0** |

Y el radio de daño de esas 2.093 es **casi nulo**: de **87.669 citas en 12
meses, sólo 5 son de historia no numérica, de 3 pacientes distintos (0,01%)**.
Son registros muertos: existen en la tabla y no usan la agenda.

**El diseño «solo el documento» se sostiene.**

### Pero hay que conocer las convenciones de la casa

La distribución de longitudes (D.1b) muestra cuatro familias de basura y una de
ellas es una convención deliberada:

- **Documento + sufijo con guion**: 1.315 pacientes de longitud 12 y 167 de 13
  (`1000189976-2`, `100235838-8-7`). En D.1c son casi todos `MS` (menor sin
  identificar): **es el documento de la madre más un consecutivo por
  recién nacido** — `22779293-4` y `22779293-5` son dos hermanos.
- **Códigos que acuña el hospital**: `17042A0021`, `17042A0009`, `17042S0002`
  — **17042 es el código DANE de Anserma** + `A`/`S` + consecutivo.
- **Ceros**: existen historias `01`, `000`, `0000`, `00001`, `000000`,
  `0000001`, `0000000001`, `00000000012`.
- **Literales**: `XX`, `XXXXXX`, `PIC`, `urive`, `INDOCUMENTADO`,
  `aw155981`, `13430385h`.

⇒ Estas personas **no pueden estar en un padrón** (no tienen documento), así
que el portón las rechaza por construcción y se atienden en ventanilla. Es
coherente. Pero fija dos reglas para la normalización (§5).

## 2. ✅ La hipótesis de la casilla queda confirmada, por dos vías

**D.2b, la prueba:** de **19.007 pacientes** que tienen a la vez una EPS
liquidada y una vigente, la vigente ocupa casilla más alta en **15.854 →
83,4%** (2.976 al contrario, 177 empatados).

**D.2d, la progresión histórica leída en las casillas:**

| casilla | quién domina | pacientes | vigencia real |
|---|---|---|---|
| 0 | **CAFESALUD** | 15.336 | murió en 2017 |
| 0 | **CAPRECOM** | 7.939 | murió en 2015, **y no aparece en ninguna otra casilla** |
| 1 | **MEDIMÁS** | 9.016 (su pico) | 2017-2022 |
| 2-3 | FONDO, SALUD TOTAL, SURA | — | vivas |

CAPRECOM sólo existe en la casilla 0. CAFESALUD la domina y decae (15.336 → 2.927).
MEDIMÁS pica en la 1 (3.525 → **9.016** → 2.673). Es la historia del
aseguramiento colombiano ordenada por número de casilla.

`NU_AFIL_RPE` es un **índice de casilla por orden de llegada**, y **la casilla
más alta con aseguradora real es la afiliación más reciente** — con 83,4% de
acierto. Sirve para **reconciliar**, nunca para autorizar.

⚠️ **Único cabo suelto:** D.2c encontró `PARENTESCO` con **7 filas**, y
`NU_AFIL_RPE` toma **7 valores (0-6)**. Coincidencia de cardinalidad que hay que
descartar. El argumento en contra es fuerte: las casillas 4/5/6 están
**reservadas** a las tres filas sintéticas (Particulares/FOSYGA/Municipio) con
ratio 1,00 sobre los 78.657 pacientes, y eso el parentesco no lo explica. Pero
son 7 filas: se resuelven con un `SELECT *`.

Los otros catálogos de D.2c **no son** de tipo de afiliado: `CUOTA_TIPOAFIL`
(401) se indexa por `(CD_CODI_REG_CUTA, CD_NIT_EPS_CUTA)` — es copago por
régimen y EPS, no por afiliado.

## 3. ⚠️ Me equivoqué de tabla: el catálogo de régimen es `REGIMEN`, no `R_REG_EPS`

`R_REG_EPS` (273 filas) resultó ser `(régimen, NIT) → VL_MAXI / VL_MAXF /
VL_MAXA`: **topes de facturación**, no nombres. El catálogo es **`REGIMEN` (22
filas)**: `CD_CODI_REG | NO_NOMB_REG | ID_CODI_TIUS_REG | TX_CODI_RTT_REG`.

Aun así `R_REG_EPS` dejó algo valioso — **qué códigos de régimen tiene
configurado cada EPS de arranque**:

| EPS | códigos configurados |
|---|---|
| SURA `800088702` | 01, 02, 07, 08, 09, 10, 11, 12, 14 |
| SALUD TOTAL `800130907` | 01, 02, 07, 08, 09, 10, 11, 12, 14, 18 |
| Municipio Anserma `890801139` | 04, 05, 06, 16 |
| FOSYGA `000000001` | F |
| Particulares `000000000` | P |

**El padrón trae dos valores (SUBSIDIADO/CONTRIBUTIVO) y el HIS tiene diez
códigos por EPS.** No hay mapa 1:1, y en P.2b de la ronda anterior se vieron
pacientes de Sura del mismo corte con 01, 07 y 10. **Falta la homologación, y
sin ella el convenio puede salir mal → glosa.**

Y D.10 dejó la cadena, sacada del SQL de un reporte de SSRS
(`Produccion por servicio … Regimen` usa `TIPOUSUARIO.DE_DESC_TIUS AS Regimen`):

```
R_PAC_EPS.CD_CODI_REG_RPE → REGIMEN.CD_CODI_REG
                          → REGIMEN.ID_CODI_TIUS_REG → TIPOUSUARIO.DE_DESC_TIUS
```

## 4. 🔴 El correo del HIS es relleno: 98,6% es un solo valor

| correo | pacientes |
|---|---|
| **`pacienteshospital@gmail.com`** | **77.649** |
| `hsvpanserma@hotmail.com` | 299 |
| `pacientehospital@gmail.com` | 206 |
| `pacientesanserma@gmail.com` | 92 |
| `pacietnehospital@gmail.com` | 35 |
| … y una docena de variantes con errores de tipeo | |
| `pacientehospital@gmailcom` (sin punto) | 4 |
| `pacientehospital@gmail*com` | 3 |

**78.738 pacientes «con correo», sólo 287 valores distintos.** El campo no
tiene un solo correo de paciente utilizable.

Y esto es **la lección más importante de toda la ronda**, porque no es sobre el
correo: `DE_EMAIL_PAC` es un campo obligatorio que el personal llena con un
valor fijo para poder avanzar en la pantalla. **Todo campo obligatorio que le
pongamos al hospital se va a convertir en una mentira.** Es evidencia empírica,
de su propia base, a favor de pedir **un solo campo obligatorio**.

## 5. El teléfono: el padrón gana, y el HIS encogió la columna

| forma | pacientes | % |
|---|---|---|
| **móvil válido `3XXXXXXXXX`** | **58.754** | 74,6% |
| fijo de 7-8 dígitos | 5.244 | 6,7% |
| fijo nuevo formato `60X…` | 56 | 0,1% |
| con caracteres no numéricos | 33 | — |
| **otro largo** (basura) | **14.701** | 18,7% |

Los más repetidos: **`0` en 13.002 pacientes (16,5%)**, `8536399` ×101,
`6109` ×37, `1` ×28, `123456789` ×18.

Contra el padrón: `telefonomovil` en **131 de 143 (92%)**, todos bien formados.
**El padrón gana 17 puntos, y para los 13.002 con `0` es la única fuente.**

### 🔴 Y el hallazgo del `ALTER` del 13-ago-2026

D.5a devolvió **una sola diferencia** entre la `PACIENTES` viva y la de 2025:

```
DE_TELE_PAC:  varchar(10) en la viva  ←  varchar(50) en 2025
```

**Encogieron la columna del teléfono de 50 a 10 caracteres.** Eso explica por
qué SQL Server recreó la tabla (reducir un varchar obliga a reescribirla), y
plantea la pregunta de si la migración **truncó** teléfonos que venían en
formato doble (`3001234567 / 8536399` cabía en 50).

Consecuencia para el agente espejo: **cero margen**. Un móvil colombiano son
exactamente 10 dígitos; `+573001234567` (13) o `300 123 4567` (12) hacen fallar
o truncar el UPDATE. **El driver debe normalizar a 10 dígitos exactos antes de
escribir en `DE_TELE_PAC`.**

D.5b: **`R_PAC_EPS` no cambió nada** (0 filas de diferencia). Una preocupación
menos.

## 6. `STG_DEMANDA_PYP` no es el padrón — es algo más interesante

16 columnas: `DOCUMENTO, TIPO_DOCUMENTO, PACIENTE, FECHA_NACIMIENTO, SEXO,
DIRECCION_PACIENTE, TELEFONO_PACIENTE, DEPARTAMENTO, MUNICIPIO,
CODIGO_ACTIVIDAD, ACTIVIDAD_PYP, CODIGO_SERVICIO, SERVICIO, FECHA_SERVICIO,
ESTADO_ACTIVIDAD, FECHA_CARGA_STG`. 85.293 filas.

**`FECHA_CARGA_STG = 2026-09-10 02:30:02.517` en las 5 filas de muestra: se
cargó a las 2:30 de la madrugada del día de la corrida.** Y en la ronda
anterior vimos que **los únicos 6 jobs de SQL Server son backups y
`PA_REVISA_SALDOS`**.

Tres consecuencias:

1. **Hay un tercero escribiendo en producción de madrugada, y no es un job de
   SQL Server.** Nuestro agente también escribe ahí. Hay que saber qué es, a
   qué hora corre y si toca `PACIENTES` o `CITAS_MEDICAS`.
2. **El molde ya existe**: convención `STG_` + columna `FECHA_CARGA_STG`. Es
   exactamente la forma que tomaría una carga de padrón, y hay precedente en
   la casa (también `triage_diario_staging`, 2026-07-10).
3. **Es insumo de producto, no sólo diagnóstico**: 85.293 filas con documento,
   teléfono, actividad de PyP y estado (`REALIZADO`). Si AgenIA hace demanda
   inducida por WhatsApp («le corresponde su citología»), este es el insumo.

`TIPO_DOCUMENTO` viene como texto (`CC`) mientras `PACIENTES.NU_TIPD_PAC` es
numérico (`0`): otra homologación que ya existe dentro de la casa.

## 7. La API del proveedor: `API_LOGS` es un mapa, no un basurero

```
NU_AUTOIN_LOG bigint | TX_SERVICE_LOG varchar(255) | FE_FECHA_LOG datetime
NU_TIME_LOG float    | NU_STATUS_LOG int           | TX_ERROR_LOG varchar(max)
```

**No guarda payloads**: nombre del servicio, duración, status y error.
**176.280 llamadas desde el 1-jul-2026** ≈ 2.500 al día. `TX_SERVICE_LOG`
contiene los nombres de los endpoints.

**Si existe un servicio de citas o de afiliación, el espejo debería usarlo en
vez de escribir tablas directamente.** Es la consulta de mayor valor que queda
pendiente y es un `GROUP BY`.

Además: `WB_LIC` (23 filas) es el inventario de **módulos licenciados**;
`PERMIUSUA_SGIO` (4 filas) tiene permisos `ACTUALIZACION_CITA`,
`CAMBIO_FECHA_RP`, `MODIFICACION_RP` **y una columna `CLAVE varchar(100)**` —
sistema de permisos añadido el 2026-07-30 que toca justo lo que el agente hace.

## 8. Cerrado: `PLANO` y los reportes de censo

- **`PLANO`** (1.410 filas): `COD_ENT = 1704200608` (DANE Anserma + código de
  habilitación), `COD_CUM`, `VAL_MIN/VAL_MAX/VALOR/CANT`, `TIPO_O = CM/VN`.
  Es el **plano de precios de medicamentos (SISMED)**. Nada que ver. Cerrado.
- **`CENSO NUEVA EPS`** y **`CENSO DIARIO`** arrancan con
  `CREATE TABLE #INGRESOS(NUMERO_REGISTRO, NIT_IPS, CODIGO_HABILITACIÓN,
  TIPO_IDENTIFICACIÓN, …)`: es el **censo de ingresos que el hospital LE MANDA
  a la EPS**. Dirección contraria al padrón. Cerrado: ningún reporte lee un
  padrón.

## 9. 🔴 EL DEFECTO DE DISEÑO: la llave única impide estar en dos EPS

`EpsEnrolledPatient` tiene `@@unique([organizationId, cedula])`, pero los dos
porteros consultan por `(organizationId, epsId, cedula, isActive)`.

**Una persona no puede existir en dos padrones a la vez.** Y durante un
traslado entre EPS sí aparece en los dos cortes del mismo mes. Qué pasa:

```
corte Salud Total (A):  Juan → { epsId: ST,   importId: A, activo }
corte Sura        (B):  ON CONFLICT (org, cedula) → { epsId: SURA, importId: B }
                        ...la baja de Sura filtra por epsId=SURA → Juan sobrevive
corte Salud Total (C):  → { epsId: ST, importId: C }   ...y vuelve a voltearse
```

**La EPS de Juan cambia con cada carga, y quien cargue de último decide si Juan
puede agendar.** Con la semántica de reemplazo (§10) el ping-pong es peor.

**Corrección: la llave debe ser `@@unique([organizationId, epsId, cedula])`.**
Dos filas, cada una gobernada por el corte de su propia EPS, y el portón
encuentra la correcta. Es una migración y hay que hacerla antes del piloto.

## 10. Semántica de carga, con la respuesta del hospital

> **El hospital confirmó:** el padrón que envían las EPS es **siempre
> completo**, pero **puede llegar parcial por algún error**. Debe poderse
> cargar cuantas veces sea necesario, actualizando la información por completo.

⇒ **Reemplazo por EPS, idempotente**, todo en una transacción:

```sql
-- 1. upsert de todas las filas del archivo (importId nuevo, isActive = true)
-- 2. UPDATE EpsEnrolledPatient
--       SET isActive = false, deactivatedByImportId = <nuevo>
--     WHERE epsId = <esa EPS> AND importId <> <nuevo> AND isActive = true
```

Propiedades que salen gratis: **recargar el mismo archivo no cambia nada** (más
allá de `updatedAt`); quien fue desactivado y reaparece **se reactiva solo** en
el paso 1; y `importId` deja el rastro para responder «¿por qué rechazaron a
Juan el 12 de octubre?».

⚠️ Y como el hospital **avisó que los parciales pasan**, la baja necesita
baranda —no un bloqueo—: **si un corte va a desactivar más del 10% del padrón
activo de esa EPS, exigir confirmación explícita mostrando la cifra.** Un
número raro delata el parcial antes de hacer daño. La confirmación queda
registrada en el log del corte.

## 11. Confirmado: la EPS se escoge en pantalla — con una guarda

Está bien y es lo correcto (ninguno de los dos archivos trae columna `eps`).
Pero pasa a ser **un dato que teclea un humano**, y equivocarse cuesta ~9.100
personas con la EPS errada → convenio errado → glosa.

**Guarda barata:** desde el segundo corte de una EPS, el solapamiento de
documentos con el corte anterior debe rondar el 95%. Si baja del 70%, avisar. Y
si los documentos del archivo se parecen más al padrón activo de **otra** EPS,
decirlo: «estos documentos coinciden 94% con el padrón de Salud Total, ¿seguro
que es Sura?».

## 12. Un solo campo obligatorio: el documento

Respaldado por §4: el hospital ya demostró qué le hace a un campo obligatorio
que no puede llenar.

| campo | régimen | por qué |
|---|---|---|
| `documento` | **obligatorio** | es la llave y lo único que no se puede suplir |
| `regimen` | opcional (muy deseado) | enruta el convenio; si falta, cae a la heurística de la casilla (§2) |
| `movil` | opcional (valioso) | 92% en el padrón vs 74,6% en el HIS, y 13.002 pacientes tienen `0` |
| todo lo demás | **fuera** | nombres, fecha, sexo, dirección → los tiene el HIS, mejor |
| `ProgramasEspeciales` | **prohibido** | ~1.260 filas con códigos sensibles en el archivo real |

`REQUIRED_HEADERS` pasa de `['cedula','nombre_completo','eps']` a `['cedula']`.

## 13. Normalización del documento: una función, dos pasadas

Reglas que salen de los datos medidos:

1. **Quitar espacios y puntos**: `1.234.567` → `1234567`.
2. **NO fusionar el sufijo con guion.** `1115634392-1` es un recién nacido
   distinto de su madre `1115634392` (1.482 pacientes con esta forma). Jamás
   descartar el sufijo.
3. **Rechazar los comodines**: todo-ceros (`0`, `0000`, `00000001`), `XX`,
   `XXXXXX`, `INDOCUMENTADO`. El `^\d{4,15}$` actual ya rechaza los literales
   pero **acepta `0000`**: hay que añadir la regla de todo-ceros.
4. **Ceros a la izquierda: dos pasadas.** No quitarlos en la normalización
   —fusionaría `0012345` con `12345`— pero sí permitir un **segundo intento sin
   ceros a la izquierda cuando la búsqueda exacta falla**. Excel se come los
   ceros iniciales de las celdas numéricas, así que el padrón puede traer
   `12345` donde el HIS tiene `0012345` (135 casos como tope).

Hoy divergen: el importador hace `replace(/[.\s]/g,'')` y los porteros
`replace(/\D/g,'')`. **Una sola función exportada desde `@agenia/shared`,
usada en los tres sitios** (importador, portón del chatbot, portón del staff).

## 14. Preguntas que quedan para el 100%

1. **Homologación del régimen** — bloqueante para facturar. Dos consultas:
   `SELECT * FROM dbo.REGIMEN` y el join a `TIPOUSUARIO`.
2. **El cruce padrón↔HIS (D.11)** — ¿cuántos del padrón no existen en
   `PACIENTES`? Decide si el «hable con el hospital» manda 50 o 3.000 personas
   al teléfono. Requiere cargar los CSV a `AGENIA_SYNC`.
3. **¿Quién carga `STG_DEMANDA_PYP` a las 2:30 AM?** Hay un tercero escribiendo
   en producción y nuestro agente comparte esa base.
4. **`SELECT TX_SERVICE_LOG, COUNT(*) FROM API_LOGS GROUP BY 1`** — si hay
   endpoint de citas o afiliación, el espejo cambia de estrategia.
5. **`SELECT * FROM dbo.PARENTESCO`** (7 filas) — cierra el único cabo suelto
   de la hipótesis de la casilla.
6. **¿La migración del 13-ago truncó teléfonos?** `varchar(50)` → `varchar(10)`.
7. **Cadencia y responsable de la carga.** Si nadie carga el corte del mes, el
   padrón envejece y el bot rechaza a gente con derecho — **es el fallo
   silencioso más probable del sistema**. Requiere alerta por antigüedad del
   último corte por EPS.
8. **Menores: ¿puede la madre agendar por su WhatsApp para el hijo?** El padrón
   de Sura trae 17% de menores (RC y TI, el menor de 3 años). Hoy el bot asume
   una persona por número. Es un flujo real de pediatría y no está definido.
9. **Texto del mensaje de rechazo**, aprobado por el hospital, con teléfono y
   horario. Uno solo para las dos causas (no está en el padrón / no existe en
   el HIS), para no revelar la afiliación de nadie.
10. **Modo observación** 2-3 semanas antes de bloquear de verdad.

---

# 🗝️ LA HOMOLOGACIÓN DEL RÉGIMEN, RESUELTA (2026-09-10)

Cuatro consultas cerraron tres pendientes. Y la primera resultó ser el hallazgo
más útil de todo el día.

## 1. ✅ `REGIMEN` (22 filas): el código no es el régimen — es régimen + tipo de afiliado + nivel, fundidos

```
CD_CODI_REG  NO_NOMB_REG           TX_CODI_RTT_REG  NU_CON_LIST_REG
01  SUB NIVEL 1                        2   4
02  SUB NIVEL 2                        2   4
03  SUB NIVEL 3                        2   4
14  SUB NIVEL 0                        2   4
17  SUB DESPLAZADO                     2   4
04  VINCULADO NIVEL 1                  3   5
05  VINCULADO NIVEL 2                  3   5
06  VINCULADO NIVEL 3                  3   5
16  VIN DESPLAZADO                     3   5
07  COTIZANTE RANGO 1                  1   1
08  COTIZANTE RANGO 2                  1   1
09  COTIZANTE RANGO 3                  1   1
18  CONTRIB DESPLAZADO                 1   1
19  CONTRIBUTIVO CERO                  1   1
10  BENEFICIARIO RANGO 1               1   2
11  BENEFICIARIO RANGO 2               1   2
12  BENEFICIARIO RANGO 3               1   2
13  SOAT                               5  10
15  REG ESPECIAL                       5   6
20  ARL                                C   9
F   FOSYGA                             3   5
P   OTRO                               5   5
```

**`TX_CODI_RTT_REG` es el eje que necesitamos** (es el tipo de usuario de RIPS):

| RTT | códigos | significa | valor para `mapping.json` |
|---|---|---|---|
| **1** | 07,08,09,10,11,12,18,19 | **CONTRIBUTIVO** (cotizante o beneficiario, cualquier rango) | `CONTRIBUTIVO` |
| **2** | 01,02,03,14,17 | **SUBSIDIADO** (cualquier nivel) | `SUBSIDIADO` |
| 3 | 04,05,06,16,F | vinculado / FOSYGA | no aplica (municipio) |
| 5 | 13,15,P | SOAT, especial, otro | Particular |
| C | 20 | ARL | no aplica |

### La homologación es una función de una línea

`mapping.json` indexa los convenios por `NIT|SUBSIDIADO|CONTRIBUTIVO[|EVENTO|PYP]`
— **sólo dos valores de régimen**:

```
800130907|SUBSIDIADO → 475     800130907|SUBSIDIADO|EVENTO → 538
800130907|CONTRIBUTIVO → 476   800130907|CONTRIBUTIVO|EVENTO → 96
800088702|SUBSIDIADO → 467     800088702|SUBSIDIADO|EVENTO → 535
800088702|CONTRIBUTIVO → 473   800088702|CONTRIBUTIVO|EVENTO → 97
```

⇒ `TX_CODI_RTT_REG = '1'` → CONTRIBUTIVO; `= '2'` → SUBSIDIADO. **Nada más.**

### Y esto CONFIRMA el diseño de tres campos

El código detallado (07 vs 08 vs 09) sólo cambia el **copago**:
`CUOTA_TIPOAFIL` se indexa por `(CD_CODI_REG_CUTA, CD_NIT_EPS_CUTA)` con valores
de consulta, procedimiento, ayudas dx, elementos y paraquirúrgicos. Y **el copago
lo liquida el HIS al facturar, con el código que el paciente ya tiene en
`R_PAC_EPS`.** Nuestro agente no escribe ese código: escribe un **convenio**.

⇒ **El padrón NO necesita traer `RangoSalarial` ni el nivel de SISBÉN.** Quedan
fuera, como estaban, y ahora con la razón demostrada en vez de supuesta.

### Validación cruzada: los 15 pacientes de P.2b cuadran sin una excepción

| paciente | EPS | código HIS | nombre del código | → |
|---|---|---|---|---|
| 1000125390 | Salud Total | 01 | SUB NIVEL 1 | SUBSIDIADO |
| 10002511 | Salud Total | 01 | SUB NIVEL 1 | SUBSIDIADO |
| 1002593948 | Salud Total | 07 | COTIZANTE RANGO 1 | CONTRIBUTIVO |
| 10018650 | Cafesalud | 02 | SUB NIVEL 2 | SUBSIDIADO |
| 1128282352 | Sura | 07 | COTIZANTE RANGO 1 | CONTRIBUTIVO |
| 3512461 | Sura | 10 | BENEFICIARIO RANGO 1 | CONTRIBUTIVO |
| 1054927743 | Nueva EPS | 10 | BENEFICIARIO RANGO 1 | CONTRIBUTIVO |
| todos | Municipio Anserma | 04 | **VINCULADO NIVEL 1** | población pobre no asegurada |
| todos | FOSYGA | F | FOSYGA | — |
| todos | Particulares | P | OTRO | Particular |

El `04` que llevan los 78.657 pacientes en la fila del Municipio es
**VINCULADO NIVEL 1**: el respaldo municipal para cuando nadie más responde.
Encaja con que sea universal.

## 2. ✅ `PARENTESCO` cierra el cabo suelto de la casilla

```
01 PADRE   02 MADRE   03 ESPOSO (A)   04 HIJO (A)
05 ABUELO (A)   06 OTROS   07 HERMANO (A)
```

**Los códigos son 01-07. `NU_AFIL_RPE` va de 0 a 6. Los rangos no coinciden.**

Y el argumento semántico remata: si fuera parentesco, los 78.657 pacientes
tendrían «OTROS» en su fila del Municipio, 78.109 «ABUELO(A)» en la de FOSYGA y
73.557 «HIJO(A)» en la de Particulares. Absurdo.

⇒ **`NU_AFIL_RPE` es índice de casilla por orden de llegada. Confirmado y
cerrado.** La coincidencia de cardinalidad (7 y 7) era eso: coincidencia — y ni
siquiera los rangos calzaban.

## 3. 🔴 `API_LOGS`: la pista muere, pero deja una alarma para el hospital

```
TX_SERVICE_LOG          llamadas   con error   %
Consultar paciente        88.147     58.201    66,0%
Consultar profesional     88.133      1.442     1,6%
2026-07-09 17:15  →  2026-09-10 09:24  (63 días)
```

**Sólo dos servicios, y ninguno de agenda ni de afiliación.**

⇒ **La API del proveedor no nos sirve. El espejo sigue escribiendo tablas.
Pista cerrada, decisión tomada.**

Pero quedan dos cosas que decirle al hospital:

1. **58.201 fallos en 63 días ≈ 924 al día**, y el servicio hermano —que se
   llama en pareja, 88.147 contra 88.133, 14 de diferencia— falla el 1,6%. La
   misma pantalla llama a los dos y uno funciona y el otro no.
2. Puede no ser una avería: si «Consultar paciente» devuelve no-2xx cuando el
   documento no existe todavía, el 66% es simplemente «paciente nuevo» usado
   como flujo. **`TX_ERROR_LOG` lo dice.** Pedirlo **agrupado por mensaje
   distinto**, nunca filas crudas: esa columna puede traer datos del paciente.

Y si resultara ser un servicio **externo** de verificación de derechos
(ADRES/BDUA), sería la fuente de verdad que buscamos toda la investigación —
funcionando una de cada tres veces. Vale los dos minutos de averiguarlo.

## 4. ✅ `WB_LIC` cerrado

23 filas, seis columnas, todas hexadecimal de longitud variable (60-130
caracteres). No son hashes —la longitud varía con el contenido—: es cifrado del
proveedor sobre la tabla de licenciamiento de módulos. **No es nuestro asunto y
no hay que intentar descifrarla.** Cerrado.

---

# ✅ DECISIONES DEL HOSPITAL / PRODUCTO (2026-09-10)

## D-1. Cadencia: la carga es manual, del ORG_ADMIN del tenant

Ya funciona así (`requireOrgAdmin` en las server actions). **Consecuencia
obligatoria, no opcional:** si la carga depende de que una persona se acuerde,
se va a olvidar, y **el fallo es silencioso** — el padrón viejo sigue
respondiendo: admite a quien ya se fue y rechaza al que acaba de afiliarse.

Diseño mínimo:
- Alerta en el **dashboard principal** (no escondida en la pantalla del padrón)
  cuando el corte más reciente de una EPS activa pase de N días (30 por
  defecto, configurable).
- **No relajar el portón automáticamente** por padrón viejo: sería una puerta
  abierta silenciosa, que es peor que un rechazo visible.
- Sí **sellar cada rechazo con la antigüedad del padrón que lo causó**. Cuando
  el hospital reclame «rechazaron a alguien con derecho», el log responde: «el
  padrón de Sura tenía 75 días».

## D-2. Menores: no se evalúa. Cualquier documento válido agenda

Decisión tomada: se pide el documento y se intenta agendar. Sin vínculo
titular/beneficiario. Simplifica mucho y es lo correcto para el piloto.

Queda registrada la trazabilidad que sí tenemos: cada cita guarda el documento
del paciente **y** el número de WhatsApp desde el que se pidió.

⚠️ Una salvedad con mitigación concreta, y seguimos: agendar de más cuesta una
silla vacía, pero **cancelar la cita de un tercero** —si el bot permite
consultar o cancelar por documento— sí es daño real. Recomendación:
**dar de alta sin más, pero para consultar o cancelar exigir que el WhatsApp
coincida con el que agendó** (o con el teléfono del padrón/HIS). Mantiene la
simplicidad del alta y cierra el abuso obvio.

## D-3. Mensaje de rechazo: configurable desde el panel del tenant

Un solo texto para las dos causas (no está en el padrón / no existe en el HIS),
para no revelar la afiliación de nadie.

Estado actual a corregir: `MSGS.epsNoAfiliado` vive **dos veces** en
`apps/api/src/chatbot/chatbot.constants.ts` (líneas 235 y 946 — variantes de
tono por `CommunicationStyle`), y **ambas mandan al enlace
`/solicitud-alta/{organizationId}`**, que es justo el auto-registro que sale.

Diseño:
- Campo nuevo en `Organization`, junto a los que ya existen (`supportPhone`,
  `timezone`, `knowledgeBase`): `padronRejectionMessage String? @db.Text`.
- **`supportPhone` ya existe** — el texto puede usarlo con un marcador simple,
  o el admin escribe el teléfono a mano. Preferible el marcador: un teléfono
  duplicado se desincroniza.
- Si el campo está vacío → cae al texto por defecto (que conserva las dos
  variantes de tono). **Nunca enviar un mensaje vacío.**
- Conservar del mensaje actual lo que está bien: **la oferta de agendar como
  Particular**. Es una salida legítima y hoy la ofrece.
- El portón del staff (`apps/web/lib/eps-enrollment.ts`) **sí puede seguir
  mostrando la causa real**: quien lo lee es personal del hospital.

## D-4. El cruce padrón↔HIS deja de ser una medición y pasa a ser el reporte

La pregunta era: **¿cuántas personas del padrón no existen en `PACIENTES`?**
Importa porque el portón nuevo es una intersección y **a esa gente el bot la
manda al teléfono**. Si son 200 de 9.100, son 200 llamadas al mes y el piloto
va. Si son 3.000, un tercio de la gente termina llamando y el piloto fracasa
por algo que se podía prever.

**Y la respuesta buena es la que ya pidió el negocio:** el reporte de
reconciliación tras cada carga **es exactamente esta medición, hecha
funcionalidad.** En vez de medirlo a mano una vez, se mide solo cada mes y
queda registrado.

⚠️ Restricción de arquitectura que hay que respetar: **la web no alcanza al
HIS.** El padrón se carga en la web (VPS/cloud) y `PACIENTES` sólo es
alcanzable desde el agente espejo, dentro de la red del hospital. Así que la
reconciliación **no puede ser sincrónica** dentro de la carga:

```
1. El admin carga el CSV        → corte queda IMPORTADO
2. Se encola trabajo de reconciliación
3. El agente espejo lo recoge, consulta el HIS por lotes, devuelve el resultado
4. El corte pasa a RECONCILIADO y el reporte se completa
```

El front debe mostrar el corte como **«importado · reconciliación pendiente»** y
completarse después. Es un estado más en `PadronImport`, no un rediseño.

**Para dimensionar antes de construir** sigue sirviendo la vía manual (D.11 del
SQL): cargar los documentos a `AGENIA_SYNC.dbo.STG_PADRON` con el asistente de
SSMS y hacer `LEFT JOIN ESEHSVP.dbo.PACIENTES`. Una tarde, y sabemos si el
diseño es viable antes de escribir el front.

## D-5. Por qué importa quién carga `STG_DEMANDA_PYP` a las 2:30 AM

No es curiosidad. Son cuatro riesgos concretos:

1. **Nuestro agente no es el único que escribe en `ESEHSVP`.** Si ese proceso
   toca `PACIENTES` o `CITAS_MEDICAS` a la misma hora que sincronizamos, hay
   carrera. Y si hace `DELETE`/`TRUNCATE` masivos, puede pisar trabajo nuestro.
2. **Ventana de mantenimiento**: hay que saber a qué hora NO sincronizar.
3. **Puede ser el canal del padrón.** Si ya existe un proceso que carga staging
   desde fuera cada noche, ése es el camino por el que podría llegar el padrón
   sin que nadie lo suba a mano — y resolvería D-1 de raíz.
4. **No hay ningún job de SQL Server que lo haga** (los 6 son backups y
   `PA_REVISA_SALDOS`). Así que es un script externo o el módulo nuevo del
   proveedor, escribiendo en producción sin registro en el servidor.

Cómo averiguarlo, en orden de esfuerzo:

```sql
-- (a) ¿Es diario, semanal, o fue una sola vez? ¿Y borra y recarga?
SELECT CAST(FECHA_CARGA_STG AS date) AS dia, COUNT(*) AS filas,
       MIN(FECHA_CARGA_STG) AS primera, MAX(FECHA_CARGA_STG) AS ultima
FROM dbo.STG_DEMANDA_PYP GROUP BY CAST(FECHA_CARGA_STG AS date) ORDER BY dia DESC;

-- (b) Rango de FECHA_SERVICIO: dice qué ventana de tiempo arma el proceso
SELECT MIN(FECHA_SERVICIO), MAX(FECHA_SERVICIO), COUNT(DISTINCT DOCUMENTO)
FROM dbo.STG_DEMANDA_PYP;

-- (c) Las 29 filas de LOG_AUDITORIA_SGIO traen QUERY_EJECUTADA
SELECT * FROM dbo.LOG_AUDITORIA_SGIO ORDER BY FECHA_ACCION DESC;

-- (d) AUDITOR (977.622 filas) es la auditoría del HIS: ver su estructura
SELECT c.name, ty.name AS tipo FROM sys.columns c
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.AUDITOR') ORDER BY c.column_id;
```

Y en paralelo, la vía corta: **preguntarle a TI del hospital.** Si la respuesta
es «lo montó el proveedor para la demanda inducida de PyP», con eso basta.

---

# 🐍 HAY UNA SEGUNDA APLICACIÓN ESCRIBIENDO EN `ESEHSVP` (2026-09-10)

Las dos consultas de D-5 contestaron la pregunta de las 2:30 AM y destaparon
algo más importante.

## 1. `STG_DEMANDA_PYP`: borra y recarga, atómica, 02:30

```
dia         filas    primera                  ultima
2026-09-10  85.293   2026-09-10 02:30:02.517  2026-09-10 02:30:02.517
```

**Un solo día, un solo timestamp, idéntico al milisegundo en las 85.293 filas.**
Tres lecturas:

1. **La carga es atómica.** El mismo milisegundo en todas las filas significa
   que el valor se capturó UNA vez en una variable, no con un
   `DEFAULT GETDATE()` por fila. Es un `INSERT … SELECT` o un `executemany`
   con parámetro.
2. **Borra y recarga completa.** La tabla existe desde el 2026-07-24 y sólo
   tiene datos del 2026-09-10: no acumula. El proceso hace
   `TRUNCATE`/`DELETE` + `INSERT` de 85.293 filas.
3. **No se puede saber si corre a diario** con un solo punto de datos, pero que
   la única corrida visible sea justo la de hoy —48 días después de crearse la
   tabla— apunta a que **corre seguido y siempre reemplaza**.

### Lo que esto fija para nuestro agente

- **Ventana de mantenimiento: no sincronizar entre 02:15 y 03:00.** Una
  operación de 85.293 filas dentro de `ESEHSVP` genera E/S y bloqueos, y
  necesita LEER de `PACIENTES` y de las tablas de 4505/facturación para armar
  la demanda de PyP.
- **`STG_DEMANDA_PYP` no guarda historia.** Si la queremos como insumo de
  demanda inducida por WhatsApp, hay que leerla el mismo día o copiarla.
  `FECHA_CARGA_STG` sirve de sello de frescura.

## 2. 🔴 `LOG_AUDITORIA_SGIO`: la aplicación es Python + pyodbc

La columna `QUERY_EJECUTADA` delata la tecnología entera:

```
{CALL SP_CONSULTAR_ORDEN_SERVICIO (?, ?, ?)} | Params: ('1054922923',
    datetime.date(2026, 8, 1), datetime.date(2026, 8, 31))
```

- `{CALL sp (?, ?, ?)}` es **sintaxis de escape ODBC** para llamar un
  procedimiento almacenado.
- `datetime.date(2026, 8, 1)` es el **`repr()` de Python**, dentro de una tupla
  de Python.

⇒ **Es una aplicación en Python con pyodbc.** No es el HIS original, que por la
nomenclatura de columnas (`NU_`, `TX_`, `CD_`, `DE_`, `FE_`, `VL_`) es una app
de escritorio de otra época.

### Y todo lo demás encaja: es una app web estrenada el 2026-07-30

| evidencia | qué dice |
|---|---|
| `PERMIUSUA_SGIO` y `LOG_AUDITORIA_SGIO` creadas **2026-07-30 15:55** | |
| primer `INGRESO_SISTEMA` **2026-07-30 15:57:55** | dos minutos después: es el estreno |
| pantallas: `Pantalla Login`, `Sidebar`, `Parametrización Permisos`, `Liberar Cargos con Cita` | login + sidebar = **aplicación web** |
| `WB_CON` / `WB_LIC` creadas 2026-07-01 | **WB = web**; `WB_LIC` es su licenciamiento |
| `API_LOGS`, primer registro 2026-07-09 | `Consultar paciente` / `Consultar profesional` los llama esta app |
| `ID_IDEN_USUA=` hasta el 2026-08-05 → `ID_USUA=` desde el 2026-08-13 | **la app se actualizó** en esa ventana |

Y los permisos de `PERMIUSUA_SGIO` son su menú: `MODULO_ADMIN`,
**`ACTUALIZACION_CITA`**, `DESADMISIONAR_LAB`, `GESTION_NC`, **`RESOLUCION_202`**,
**`CAMBIO_FECHA_RP`**, `INFORMES`, `MODIFICACION_RP`.

### Qué es, casi con seguridad

**`RESOLUCION_202`** es la Resolución 202 de 2021 — el reporte de actividades de
Protección Específica y Detección Temprana. Y **`STG_DEMANDA_PYP` es demanda
inducida de PyP.** El HIS maneja nativamente la 4505 (`RESOL4505_CONCEPTO`,
`ACT_PAC_RES4505_MES`, `RES4505_ITEMVAL_MES`… todas entre las más escritas), que
es la resolución **anterior**.

⇒ Alguien montó en julio de 2026 una **app web en Python para la Resolución 202
y PyP**, más un puñado de herramientas operativas que el HIS no hace o hace mal
(notas crédito, desadmisionar laboratorio, registro presupuestal). Y
`STG_DEMANDA_PYP` es su tabla de staging nocturna.

La carga de las 2:30 **no aparece en `LOG_AUDITORIA_SGIO`** (su último registro
es del 2026-08-31), así que el cargador es un proceso programado del mismo
equipo, sin auditoría, no la app interactiva.

## 3. 🔴 Lo que sí es un riesgo para el espejo

**Existe una segunda aplicación con permiso explícito de `ACTUALIZACION_CITA` y
`CAMBIO_FECHA_RP` sobre la misma base donde el agente escribe citas.**

Es exactamente lo que rompe un espejo: si esa app cambia la fecha de una cita
que ya reflejamos en AgenIA, o la toca entre nuestra lectura y nuestra
escritura, hay divergencia **silenciosa** — nadie se enterará hasta que un
paciente llegue el día equivocado.

Lo que la modera hoy: **29 eventos en 32 días**, 4-5 usuarios (`administrador`,
`GGALLO`, `YGUAPACHA`, y se mencionan `DRESTREPOG` y
`GLORIA FERNANDA GALLO GIRALDO`), y **nada desde el 2026-08-31** — hace 10 días.
Está prácticamente sin usar.

Lo que NO sabemos, y hay que saber: **`LOG_AUDITORIA_SGIO` no registra ni una
sola escritura.** Sus acciones son `INGRESO_SISTEMA`, `CIERRE_SESION`,
`ACTUALIZAR_PERMISOS` y `CONSULTA_REALIZADA`. O nadie ha actualizado una cita
todavía, **o la app no audita sus escrituras** — y en ese caso este log no
sirve para vigilarla.

## 4. Dos observaciones menores

- **Faltan los `ID_LOG` 17 a 20**, entre el 2026-08-13 13:46 y las 15:36. Lo más
  probable y benigno: `INSERT` fallidos que consumieron identidades (SQL Server
  no las devuelve). No hay señal de borrado deliberado.
- ⚠️ **`QUERY_EJECUTADA` guarda documentos de paciente en claro**: `'1054922923'`,
  `'24392768'`, `'11351646614'`. Es una tabla de auditoría con datos
  identificables en texto libre, a nivel de depuración, en producción. No es
  nuestro sistema y no es nuestra decisión — pero es **el patrón exacto que
  decidimos evitar** en `PadronImportRow` al prohibir guardar la fila cruda de
  un aceptado. Sirve de contraste para sostener esa decisión.

## 5. Consultas que cierran el asunto

```sql
-- (a) ⭐ Los objetos nuevos del proveedor/app desde junio: revelan qué hace
SELECT o.name, o.type_desc, o.create_date, o.modify_date, LEN(m.definition) AS largo
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE o.create_date >= '2026-06-01' OR o.modify_date >= '2026-06-01'
ORDER BY o.modify_date DESC;
-- Si aparece un SP de actualizar/mover citas, el segundo escritor queda confirmado.

-- (b) ¿Hay más objetos de esa app?
SELECT name, create_date FROM sys.tables WHERE name LIKE '%SGIO%' ORDER BY create_date;

-- (c) Quién puede tocar citas desde esa app. SIN la columna CLAVE, a propósito.
SELECT ID_USUA, TIPO_USUARIO, MODULO_ADMIN, ACTUALIZACION_CITA,
       CAMBIO_FECHA_RP, MODIFICACION_RP, RESOLUCION_202, INFORMES
FROM dbo.PERMIUSUA_SGIO;

-- (d) AUDITOR (977.622 filas) es la auditoría del HIS nativo: ver si registra
--     usuario + tabla + acción. Si lo hace, ahí está el rastro de TODA escritura.
SELECT c.column_id, c.name, ty.name AS tipo, c.max_length
FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.AUDITOR') ORDER BY c.column_id;
```

## 6. Y una pregunta para el hospital que ya no es técnica

**¿Quién hizo esa aplicación y quién la mantiene?** Porque a partir del piloto
van a ser **dos sistemas externos escribiendo en `CITAS_MEDICAS`**: esa app y
nuestro agente. Hace falta saber a quién llamar cuando una cita aparezca
distinta en los dos lados, y avisarles que existimos.

---

# 🧭 EL SEGUNDO ESCRITOR SE DESINFLA, Y APARECEN DOS COSAS NUEVAS (2026-09-10)

## 1. ⚠️ Corrección: el riesgo del «segundo escritor sobre `CITAS_MEDICAS`» era exagerado

En la sección anterior advertí que existía una aplicación con permiso de
`ACTUALIZACION_CITA` escribiendo en la misma tabla que nuestro agente. Los datos
lo bajan mucho de nivel. Tres razones:

**No existe ningún procedimiento de actualizar o mover citas.** El inventario
completo de objetos nuevos desde junio no tiene nada parecido. Los únicos que
corresponden a la app SGIO son de lectura o de otra cosa:

| objeto | tipo | creado | qué es |
|---|---|---|---|
| `SP_CONSULTAR_ORDEN_SERVICIO` | SP, 1.872 ch | 2026-07-10 | **consulta**: (documento, desde, hasta) |
| `DESADMISION_LABORATORIO` | SP, 1.498 ch | 2026-07-31 | el permiso `DESADMISIONAR_LAB` |
| `V_USUARIOS_TODOS_MODULOS` | vista, 2.749 ch | 2026-08-13 13:37 | alimenta la pantalla de permisos — el log muestra `ACTUALIZAR_PERMISOS` a las 13:45 del mismo día |

**Y ningún usuario real tiene el permiso:**

```
ID_USUA        TIPO  ADMIN  ACTUALIZACION_CITA  CAMBIO_FECHA_RP  MODIFICACION_RP  RES_202  INFORMES
ADMINISTRADOR   1      1            1                  1                1            1        1
DRESTREPOG      0      0            0                  0                1            0        0
GGALLO          0      0            0                  0                1            0        0
YGUAPACHA       0      0            0                  0                1            0        0
```

`ADMINISTRADOR` lo tiene todo en 1 porque es el superusuario: no es evidencia de
uso. **Los tres humanos reales sólo tienen `MODIFICACION_RP`** — registro
presupuestal. Y encaja con la pantalla que aparece en el log («Liberar Cargos
con Cita», que es facturación) y con `SP_CONSULTAR_ORDEN_SERVICIO`, que es de
lectura.

⇒ **`ACTUALIZACION_CITA` es un permiso declarado sin funcionalidad detrás y sin
usuarios.** Sigue valiendo avisar que existimos, pero no es un bloqueante.

## 2. El 1-jul-2026 18:43-18:47 fue una actualización mayor del producto

Todo este bloque cayó en cuatro minutos, y es del **proveedor del HIS**:

```
18:43:16  VW_FACTURAS_CREDITO              vista,   9.726 ch
18:44:15  SP_INTEROPERABILIDAD_IHC_V2      SP,     80.354 ch   ⭐
18:44:26  TR_AUDITORIA_FC                  TRIGGER, 3.310 ch   🔴
18:44:26  TR_AUDITORIA_TFP                 TRIGGER, 2.562 ch   🔴
18:44:32  QRY_FACTURACION_ELECTRONICA      SP,    131.669 ch
18:44:32  PA_CUSTOMTAGSS_NCRE              SP,     19.788 ch
18:47:51  PA_FACTURACION_ELECTRONICA_NCRE  SP,    116.702 ch
```

Más las tablas que la ronda 1 fechó el mismo minuto: `ARTICULO_IUM`,
`SERVICIOS_CUPS`, `PRINCIPIOSMED_DCI`, `MEDICAMENTOS_DCI`, `HOMO_CIE10_CIE11`,
`API_LOGS`, `WB_CON`, `WB_LIC`, `AUDITORIA_FC`, `AUDITORIA_TFP`.

**Es facturación electrónica + interoperabilidad de historia clínica + API.**

### Dos correcciones a lo que dije antes

- **`API_LOGS` es del proveedor, no de la app Python.** Se creó a las
  18:44:26 dentro de este bloque. `Consultar paciente` / `Consultar profesional`
  son llamadas del **producto** a servicios externos, probablemente de
  facturación electrónica o de interoperabilidad.
- **La app SGIO es muy probablemente un módulo web del mismo proveedor**, no un
  tercero: `WB_LIC` es una tabla de **licenciamiento cifrado por módulos**, del
  1-jul, y las tablas `*_SGIO` llegaron el 30-jul. Es la secuencia de un
  despliegue de producto: infraestructura primero, módulo después. **Cambia a
  quién hay que avisar: al proveedor, que ya es interlocutor conocido.**

### Y una pista que vale la pena: `SP_INTEROPERABILIDAD_IHC_V2`

80.354 caracteres, del 1-jul-2026. La ronda 1 había visto
`SP_INTEROPERABILIDAD` (22.894 ch, de 2023). **IHC = Interoperabilidad de
Historia Clínica** (Resolución 866 de 2021). Un SP de 80 KB que implementa la
IHC del MinSalud tiene, casi por obligación normativa, estructuras normalizadas
de paciente y de afiliación. Vale leerlo.

## 3. 🔴 Hay dos triggers nuevos y no sabemos sobre qué tablas están

`TR_AUDITORIA_FC` y `TR_AUDITORIA_TFP`, activos desde el 1-jul-2026, alimentando
`AUDITORIA_FC` (19.086 filas) y `AUDITORIA_TFP` (14.634 filas).

**Es una omisión nuestra que hay que cerrar ya:** nunca medimos qué triggers hay
sobre las tablas que el agente escribe. Si hay uno sobre `CITAS_MEDICAS`,
`CITAS_ANULADAS` o `PACIENTES`, **cada INSERT/UPDATE nuestro ejecuta código del
proveedor dentro de nuestra transacción** — con su latencia, sus bloqueos y sus
posibles fallos.

Por el nombre, `FC` = Facturas de Crédito (existe `VW_FACTURAS_CREDITO`) y
probablemente no nos toca. Pero eso es una suposición, y ya nos ha costado.

## 4. 🔴 El proveedor despliega en producción en horario laboral, sin aviso

```
VWFORM_CompraArti     2026-09-10 12:17:51   ← 32 minutos antes de nuestra corrida
VWFORM_ArtEntCompr    2026-09-10 12:17:39
VWREP_InfCompraArticulo 2026-09-08 17:44
VWFORM_CuenXSerie / ActSerCompr / CompraActi   2026-08-25 14:24 (los tres, mismo segundo)
VWREP_InfCompraActivo 2026-08-13 09:15
```

**Mientras investigábamos, el proveedor estaba creando objetos nuevos en
producción.** Tres despliegues en cuatro semanas, todos en horario de oficina.

⇒ **El esquema del HIS cambia sin aviso, y nuestro agente depende del esquema.**
Esto justifica `apps/api/src/mirror/mirror-schema-check.service.ts` y obliga a
verificar que cubra **todas** las tablas y columnas que el driver usa, no una
muestra. Es la defensa que ya tenemos; hay que confirmar que está completa.

## 5. ✅ `AUDITOR` es la respuesta definitiva a «quién escribe»

```
1  AudFech            datetime         cuándo
2  AudUser            varchar(60)      QUIÉN
3  AudTabla           varchar(100)     EN QUÉ TABLA
4  AudTrans           varchar(1)       I / U / D
5  AudDesc            text             qué
6  NU_NUME_CONE_AUDI  int              conexión
7  AudVerExe          varchar(50)      ⭐ VERSIÓN DEL EJECUTABLE
8  AudFecExe          datetime         fecha del ejecutable
```

977.622 filas, y en la ronda 1 fue **la tabla más escrita de todas: 90.120
escrituras en 34 horas.** Está viva y registra todo.

**`AudVerExe` es lo que la hace valiosa: identifica qué aplicación hizo cada
escritura.** Con eso se cierra la pregunta del segundo escritor con evidencia en
vez de inferencia:

```sql
SELECT AudTabla, AudTrans, AudUser, AudVerExe,
       COUNT(*) AS veces, MIN(AudFech) AS primera, MAX(AudFech) AS ultima
FROM dbo.AUDITOR
WHERE AudTabla IN ('CITAS_MEDICAS','CITAS_ANULADAS','PACIENTES','R_PAC_EPS')
  AND AudFech >= DATEADD(month, -3, GETDATE())
GROUP BY AudTabla, AudTrans, AudUser, AudVerExe
ORDER BY veces DESC;
```

### Y una decisión de diseño que esto abre

`AUDITOR` se llena vía `PA_Ins_AUDITOR` (SP de 2008, modificado el 2026-03-17).
**Si la app nativa lo llama explícitamente y no hay trigger, nuestro agente NO
quedará auditado** — el hospital no verá en su propia auditoría lo que hizo el
bot.

Eso es exactamente lo contrario de lo que le da tranquilidad a un hospital.
Opciones:

- **(a)** Si hay un trigger sobre `CITAS_MEDICAS` que alimenta `AUDITOR`,
  nuestras escrituras quedan auditadas **gratis**. Hay que comprobarlo.
- **(b)** Si no lo hay: pedir `GRANT EXECUTE ON dbo.PA_Ins_AUDITOR` (o `INSERT
  ON dbo.AUDITOR`) y que el driver registre sus propias escrituras con un
  `AudUser`/`AudVerExe` propio, reconocible. Un permiso más, y a cambio el
  hospital audita el bot con sus herramientas de siempre.
- **(c)** No hacerlo, y apoyarnos sólo en nuestra trazabilidad
  (`InteractionLog`, `SyncOutbox`) — que existe, pero vive en nuestro lado.

Recomendación: **(a) si se puede, (b) si el hospital lo pide.** La decisión
depende de la consulta de triggers.

## 6. Las dos consultas que quedan

```sql
-- ⭐ (1) LA QUE FALTA: triggers sobre las tablas que el agente escribe
SELECT  OBJECT_SCHEMA_NAME(t.parent_id) AS esquema,
        OBJECT_NAME(t.parent_id)        AS tabla_padre,
        t.name                          AS trigger_name,
        t.is_disabled,
        t.create_date, t.modify_date,
        LEN(m.definition)               AS largo,
        CASE WHEN m.definition LIKE '%AUDITOR%' THEN 'sí' ELSE '' END AS toca_AUDITOR
FROM sys.triggers t
LEFT JOIN sys.sql_modules m ON m.object_id = t.object_id
WHERE t.parent_class = 1
ORDER BY tabla_padre, t.name;

-- (2) Quién escribe de verdad en nuestras tablas (ver §5)
```

## 7. Cambia a quién hay que avisar

Ya no es «un tercero desconocido»: es **el proveedor del HIS**. Y hay dos cosas
que decirle, ninguna urgente pero ambas necesarias antes del piloto:

1. **Existimos y vamos a escribir en `CITAS_MEDICAS`, `CITAS_ANULADAS` y
   `PACIENTES`** con el usuario `agenia_sync`. Que lo sepan y que nos avisen
   cuando cambien esas tablas.
2. **`Consultar paciente` falla el 66% de las veces** (58.201 de 88.147 en 63
   días ≈ 924 al día) mientras su servicio hermano falla el 1,6%. Puede ser un
   404 legítimo usado como flujo, o puede estar roto. Ellos lo sabrán en un
   minuto.

---

# 🎯 `AUDITOR` CIERRA EL CÍRCULO (2026-09-10)

## 1. ✅ Ningún trigger toca nuestras tablas

**Toda la base de 1.394 tablas tiene sólo cuatro triggers:**

| tabla padre | trigger | creado | toca `AUDITOR` |
|---|---|---|---|
| `FACTURA_ELECTRONICA` | `TR_AUDITORIA_FC` | 2026-07-01 | sí |
| `TM_FACTURA_PLANO` | `TR_AUDITORIA_TFP` | 2026-07-01 | sí |
| `IN_KARDEX` | `TR_IN_KARDEX` | 2024-10-08 | — |
| `IN_KARDEXLOTE` | `TR_IN_KARDEXLOTE` | 2025-10-22 | — |

**Ninguno está sobre `CITAS_MEDICAS`, `CITAS_ANULADAS` ni `PACIENTES`.**

⇒ **Riesgo cerrado:** nuestras escrituras no disparan código del proveedor. Sin
latencia extra, sin bloqueos ajenos, sin fallos ajenos dentro de nuestra
transacción.

⇒ **Y decide la otra pregunta: `AUDITOR` NO se alimenta por trigger.** Los
977.622 registros los escribe la aplicación explícitamente, vía
`PA_Ins_AUDITOR`. **Así que el agente NO va a quedar auditado por sí solo.** La
opción (a) del turno anterior queda descartada.

## 2. ✅ No hay segundo escritor: todo es la app de escritorio 20.4.0

`AudTrans`: **1 = INSERT · 2 = UPDATE · 3 = DELETE**.

**Todos los registros de los últimos 3 meses tienen `AudVerExe = 20.4.0`. Todos,
sin una sola excepción.** Ni una versión distinta, ni un valor vacío.

⇒ La app SGIO en Python **no ha escrito** en `CITAS_MEDICAS` ni en `PACIENTES`.
Junto con lo ya sabido —no existe SP de actualizar citas, y ningún usuario real
tiene `ACTUALIZACION_CITA`— el asunto queda cerrado: **el único escritor de
citas y pacientes es la app de escritorio del HIS, versión 20.4.0.**

⚠️ Con un límite honesto: `AUDITOR` lo llama **la aplicación**, no un trigger.
Un cliente que no llame a `PA_Ins_AUDITOR` sería invisible aquí. La prueba de
esto está en el punto 5.

## 3. ⭐ El volumen real de la operación (2026-06-10 → 2026-09-10, 92 días)

| tabla | INSERT | UPDATE | DELETE |
|---|---|---|---|
| `CITAS_MEDICAS` | **≈ 24.395** | **≈ 12.514** | 0 |
| `PACIENTES` | **≈ 551** | ≈ 3.858 | **1** |

### Y de aquí salen cuatro cifras que valen para el producto

**(a) 265 citas creadas al día calendario** (≈370 por día hábil). Y las últimas
escrituras del volcado son de **14:31-14:32 del 2026-09-10**, minutos antes de
la consulta: es un sistema vivo, con gente agendando en ese momento.

**(b) 🎯 El 70% de las citas las crean TRES personas:**

```
ANAMGARCIA   6.721        │  los tres juntos: 17.046 de 24.395 = 69,9%
AMUÑOZ       5.179        │  con AGRISALES (1.511) y JROJAS (1.498)
RMEJIA       5.146        │  → 20.055 = 82,2% entre cinco personas
```

**Ése es el caso de negocio de AgenIA, medido en la base del cliente.** Si el
bot toma incluso el 30% de la demanda, son ~80 citas diarias que esas tres
personas dejan de teclear.

**(c) El 51% de las citas se MODIFICA después de creada** (12.514 updates sobre
24.395 inserts). No basta con detectar citas nuevas: **una de cada dos cambia**,
y el espejo tiene que verlo. Dimensiona la reconciliación que ya existe.

**(d) ≈180 pacientes nuevos al mes** (551 en 3 meses). Es una **cota superior
para D.11**: si el hospital abre 180 historias nuevas al mes, ya tiene 78.791
pacientes registrados, y el padrón trae ~19.600 personas de una población que el
hospital atiende masivamente, entonces **el solapamiento padrón↔HIS tiene que
ser muy alto** y la gente que el bot mandaría al teléfono son decenas al mes, no
miles. No sustituye la medición de D.11, pero **da confianza al diseño de
«el que no está en el HIS habla con el hospital».**

## 4. 🔴 No hay ventana nocturna: se escribe 24/7

Hay escrituras a las 23:47, 00:03, 00:09, 01:32, 02:07, 03:26, 04:43, 05:35,
06:41, 20:01, 20:33, 21:29. Y usuarios que lo explican: **`PORTEROS`** (56
updates de `PACIENTES`, a las 23:47 y a las 06:41), **`ROTANTE1`**,
`JCARDENAS`. **Urgencias trabaja de noche y admite pacientes de madrugada.**

Combinado con la carga de `STG_DEMANDA_PYP` a las 02:30: **no existe una ventana
limpia.** Hay que diseñar el espejo para **concurrencia, no para ventanas** — lo
cual ya hace, pero conviene dejar de buscar una hora tranquila porque no hay.

## 5. 🔴 La auditoría NO es completa: `R_PAC_EPS` no aparece

**Cero escrituras auditadas de `R_PAC_EPS` en 3 meses.** Pero P.11 midió que la
tabla creció +9.488 filas entre 2025 y la viva, y sabemos que cada paciente
nuevo recibe ~6 filas: 551 pacientes × 6 ≈ 3.300 filas por trimestre.

⇒ **`R_PAC_EPS` sí se escribe, pero la aplicación no la audita.** Eso confirma
que `AUDITOR` cubre unas tablas y no otras, y por tanto la conclusión del punto
2 vale **para las tablas auditadas**.

Y de paso **refuerza la conclusión de la investigación del padrón**: las
afiliaciones sólo cambian cuando se abre una historia nueva. Nadie las mantiene.
Los 443.325 registros son sedimento.

⚠️ **`CITAS_ANULADAS` tampoco aparece: cero registros en 3 meses.** Y el agente
tiene `INSERT` concedido sobre ella. Dos explicaciones posibles y hay que saber
cuál: o la app no audita esa tabla, o **las citas no se anulan ahí sino con un
UPDATE de estado en `CITAS_MEDICAS`** (que explicaría parte de los 12.514
updates). **Es una pregunta abierta que toca directamente al driver.**

## 6. ✅ Decisión: el agente debe auditar en `AUDITOR`

Como **no hay trigger**, la recomendación del turno anterior se resuelve en la
opción (b), y con más fuerza de la que pensaba:

**Pedir `GRANT EXECUTE ON dbo.PA_Ins_AUDITOR` y que el driver registre sus
escrituras con `AudUser = 'AGENIA'` y su propio `AudVerExe`.**

Tres razones, en orden de peso:

1. **El hospital ve el bot con sus herramientas de siempre.** Si algo sale mal,
   el rastro está donde ellos lo buscan, no en un log nuestro que no saben
   consultar.
2. **Da la comparativa que vende el producto**: «AGENIA creó 340 citas este mes;
   ANAMGARCIA 2.200». Con el mismo `AudUser`/`AudVerExe` que ya usan.
3. Cuesta **un permiso** y ya sabemos que el SP existe y es pequeño
   (`PA_Ins_AUDITOR`, 1.035 caracteres, modificado el 2026-03-17).

Consulta que falta para implementarlo:

```sql
SELECT m.definition FROM sys.sql_modules m
WHERE m.object_id = OBJECT_ID('dbo.PA_Ins_AUDITOR');   -- 1.035 ch, cabe entero

-- Y de paso, cómo se anulan las citas de verdad (§5):
SELECT COUNT(*) AS filas, MIN(FE_FECH_CANU) AS primera, MAX(FE_FECH_CANU) AS ultima
FROM dbo.CITAS_ANULADAS;                                -- ajustar el nombre de la fecha
SELECT AudTabla, AudTrans, COUNT(*) AS veces
FROM dbo.AUDITOR
WHERE AudTabla LIKE '%CITA%' AND AudFech >= DATEADD(month, -3, GETDATE())
GROUP BY AudTabla, AudTrans ORDER BY veces DESC;
```

## 7. Detalle sucio, para cuando importe

**`JCARDENAS ` tiene un espacio al final** en `AudUser varchar(60)`. Si algún día
filtramos auditoría por usuario, `LTRIM(RTRIM(...))` obligatorio.

---

# 🎯 `AUDITOR` RESUELVE EL PENDIENTE #17 (2026-09-10)

## 1. `PA_Ins_AUDITOR` es un INSERT puro — trivialmente llamable

```sql
CREATE PROCEDURE PA_Ins_AUDITOR
  @AudFech datetime = NULL, @AudUser varchar(60) = NULL,
  @AudTabla varchar(100) = NULL, @AudTrans varchar(1) = NULL,
  @AudDesc text = NULL, @NU_NUME_CONE_AUDI int = NULL,
  @AudVerExe varchar(50) = NULL, @AudFecExe datetime = NULL
AS BEGIN
  SET NOCOUNT ON;
  INSERT INTO AUDITOR (...) VALUES (...);
END
```

Ocho parámetros, **todos con default `NULL`**, `SET NOCOUNT ON`, cero
validación, cero lógica. SP de 2011 (comentario: Juan Alejandro García Sotelo,
tarea 7783), 1.035 caracteres.

**Permiso a pedir: `GRANT EXECUTE ON dbo.PA_Ins_AUDITOR TO agenia_sync` — NO
`INSERT ON dbo.AUDITOR`.** Por cadena de propiedad (mismo esquema, mismo
propietario) el `EXECUTE` basta, y es un permiso **mucho más estrecho**: sólo
puede insertar auditoría, no escribir la tabla a voluntad. Y `SET NOCOUNT ON`
garantiza que no interfiere con nuestros rowcounts.

## 2. 🎯 Esto cierra el pendiente #17 de `MAPEO_HIS.md`

El hospital pidió explícitamente el **2026-08-23** marcar las citas de WhatsApp
para que el staff las distinga. El comprobante impreso decía
`Asignada Por: ADMINISTRADOR`, pero **no existe ninguna columna de usuario en
`CITAS_MEDICAS`** (se buscó `USUA/ASIG/OPER/LOGIN/CREADOR`: vacío). Llevaba tres
semanas abierto.

`AUDITOR` estaba en la lista de candidatos de ese documento **y quedó de
segundo** — los «más prometedores» eran `AUDITORIA_COT`, `HIST_AUDIT`,
`LOG_AUDITORIA_SGIO`, `C_USUARIO`. **Era `AUDITOR`.**

**Y no es sólo el diagnóstico, es la solución:** si el driver llama
`PA_Ins_AUDITOR` con **`AudUser = 'AGENIA'`**, el comprobante del hospital
diría **«Asignada Por: AGENIA»**. Sin tocar el HIS, sin columna nueva, usando su
propio mecanismo. Detalle en `MAPEO_HIS.md` §2.6.

⚠️ **Hipótesis fuerte, no hecho.** El comprobante de la prueba decía
`ADMINISTRADOR` y `AUDITOR` tiene 8 INSERT de `ADMINISTRADOR`… pero del
**2026-08-02 12:20-12:50, no del 23-ago**. Las fechas no casan. La consulta de
correlación que lo confirma —y que de paso da el formato de `AudDesc`, necesario
para escribir nuestros registros igual que los suyos— está en `MAPEO_HIS.md`
§2.6.

## 3. ✅ `CITAS_ANULADAS`: la pregunta ya estaba contestada, y por nosotros

- `CITAS_ANULADAS`: **92.886 filas** = 8,55% de las 1.086.474 de `CITAS_MEDICAS`.
- **Cero registros en `AUDITOR`** en 3 meses, y **ni un solo `AudTrans = 3`**
  para `CITAS_MEDICAS`.

⇒ **La auditoría del HIS no registra las cancelaciones en absoluto.** Y no es un
defecto: `CITAS_ANULADAS` **es** el log de cancelaciones.

**Y esto ya estaba resuelto en `MAPEO_HIS.md` §2.1bis desde el 2026-08-23, con
una prueba que ejecutó el hospital**: cancelar = DELETE de `CITAS_MEDICAS` +
INSERT en `CITAS_ANULADAS`, columnas con sufijo `_CIAN`, 24 columnas, sin PK ni
índices, con `CD_CODI_MOTI_CIAN` y `TX_OBSE_CIAN`.

⚠️ **Nota de método:** planteé esa pregunta como si estuviera abierta, y la
consulta de verificación falló por adivinar el sufijo `_CANU` cuando nuestro
propio documento dice `_CIAN` desde hace tres semanas. **Antes de adivinar un
nombre de columna del HIS: buscarlo en `MAPEO_HIS.md`.** Anotado allí también.

## 4. Corrección de una cifra publicada

Los UPDATE de `CITAS_MEDICAS` en 3 meses son **12.516**, no 12.514 — el conteo
del servidor contra mi suma a mano de la lista larga. El ratio
update/insert queda en **51,3%** (12.516 / 24.395). Los INSERT sí eran 24.395
exactos.

## 5. Criterio de auditoría para el driver

Registrar en `AUDITOR` **sólo lo que la app nativa registra**: INSERT y UPDATE de
`CITAS_MEDICAS` y `PACIENTES`. Así las cifras del bot son comparables con las de
`ANAMGARCIA` y compañía, que es lo que hace útil el reporte
(«AGENIA creó 340 citas este mes; ANAMGARCIA 2.200»).

Las cancelaciones del agente quedan donde quedan las del hospital: en
`CITAS_ANULADAS`, con su motivo. Ya existe además el código `WB`
(CANCELADO WEB) en `MOTIVOANUL` para distinguirlas — y sigue abierta la
pregunta al hospital de si prefieren un código nuevo dedicado.

Y en `@AudDesc`: el número de cita y el documento —que es lo que el hospital
necesita para rastrear y que ya está en `CITAS_MEDICAS`— y **nada más**. Ni
mensajes de WhatsApp ni payloads. Es el mismo criterio con el que rechazamos
guardar la fila cruda del padrón, y el contraejemplo está en la misma base:
`LOG_AUDITORIA_SGIO.QUERY_EJECUTADA` guarda documentos de paciente en texto
libre de depuración.

---

# ⭐ `AudDesc` TRAE EL `INSERT` LITERAL DEL HIS — Y DESTAPA UN DEFECTO DEL DRIVER (2026-09-10)

`AUDITOR.AudDesc` no guarda una descripción: **guarda el `INSERT` completo con
sus valores.** Detalle columna por columna en `MAPEO_HIS.md` §2.8. Resumen:

## ✅ Pendiente #17 resuelto y triple confirmación del trabajo previo

1. **Cada cita tiene su registro de `AUDITOR` en el mismo minuto, con usuario.**
   `RCASTAÑO`, `AMUÑOZ`, `ANAMGARCIA`, `RMEJIA`, `JROJAS`, `MQUINTERO`… El
   «Asignada Por» que el hospital pidió el 2026-08-23 sale de `AudUser`.
2. **`FE_HORA_CIT` coincide exacto** con lo que produce `formatFeHoraCit()`:
   `YYYY/MM/DD HH:mm`. El trabajo previo acertó.
3. **`DE_DESC_CIT` va vacío (`^^`) en las 30 citas de la muestra.** La marca de
   origen anti-eco es segura —el hospital nunca escribe ahí— **y ya es el
   marcador visible que pidieron.**
4. **Los convenios en vivo son exactamente los de `mapping.json`:** 535, 467,
   473, 475, 538, 283. Validación del mapa contra la operación real.

## 🔴 Defecto del driver: `FE_SOLI_CIT` lleva la fecha equivocada

El hospital escribe ahí **la fecha y hora SOLICITADA de la cita**:

| `FE_HORA_CIT` (asignada) | `FE_SOLI_CIT` (solicitada) |
|---|---|
| `2026/09/12 09:20` | `12/09/2026 09:20` |
| `2027/03/10 09:00` | `10/03/2027 09:00` |
| `2026/09/11 12:30` | `11/09/2026 **13:20**` ← pidió 13:20, le dieron 12:30 |

Coinciden en 29 de 30 y difieren en una — o sea: **`FE_SOLI_CIT` es la hora que
pidió el paciente, `FE_HORA_CIT` la que se le asignó.**

**El driver escribe `GETDATE()`** (`apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts`
~939), es decir la fecha de creación. Nuestras citas quedarían con
`FE_SOLI_CIT` = hoy donde el hospital pone la fecha de la cita.

**Rompe silenciosamente los reportes de oportunidad** — y el hospital tiene tres
(`Res 1552`, `Res 256`, `Oportunidad Citas`). Es un cambio de una línea:
`FE_SOLI_CIT` debe llevar la hora solicitada (la que escogió el paciente en el
bot), o en su defecto el mismo valor que `FE_HORA_CIT`, que es lo que hace el
hospital en 29 de 30 casos.

## ⚠️ Divergencia menor: `NU_NUME_CONE_CIT`

El hospital la llena con el **consecutivo de conexión de la sesión** —no es
único por cita: `1290136` aparece en 12 citas seguidas de `ANAMGARCIA`— y el
`INSERT` del driver **omite la columna** (20 contra 21). Funciona, así que
acepta el default; conviene confirmar que sea nullable o con default y no que
hoy funcione por casualidad.

## 📊 Y un dato del ritmo real

**30 citas entre las 14:11 y las 14:39: casi una por minuto.** Confirma el pico
de la tarde y las ~370 citas por día hábil.

## ⚠️ Nota de método: mi consulta de correlación tenía un defecto

El `OUTER APPLY` emparejaba por proximidad temporal. Con ~1 cita por minuto,
**varias citas del mismo minuto se emparejan con el mismo registro de
`AUDITOR`**: en la primera fila la cita es del documento `24388882` y el
`AudDesc` habla de `4570199`.

La conclusión sobre `AudUser` se sostiene (hay auditoría por cita, con usuario),
pero **el emparejamiento fila-a-fila de ese volcado es engañoso** y no debe
citarse como prueba de correlación 1:1. La correlación exacta no necesita el
tiempo: `AudDesc` trae los valores, así que se empareja por `NU_HIST_PAC_CIT` +
`FE_HORA_CIT` extraídos del texto.

## Lo que queda por hacer, en orden

1. **Arreglar `FE_SOLI_CIT`** en el driver (una línea + prueba).
2. Verificar el tipo de `FE_FECH_CIT` (`datetime` vs `varchar`) para saber si el
   formato ISO del driver divergiere del `DD/MM/YYYY` del hospital.
3. Verificar que `I890305PL` esté en `especialidadPorServicio` de
   `mapping.json`.
4. Pedir `GRANT EXECUTE ON dbo.PA_Ins_AUDITOR` y escribir la auditoría con
   `AudUser = 'AGENIA'` — con el formato de `AudDesc` ya conocido.
5. La cola del padrón: migración (llave `(org, epsId, cedula)`, `regimen`,
   `importId`, `PadronImport`/`PadronImportRow`), normalización compartida en
   `@agenia/shared`, y el front del log de cargas.

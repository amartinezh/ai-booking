# Plan — Avisos masivos por WhatsApp (driver CNT / Hospital San Vicente de Paúl, Anserma)

> **Estado:** **Fase 1 y Fase 2 implementadas** (§10) — esquema, parser
> CSV/Excel, fuente espejo bajo demanda (protocolo, driver, lazo del agente,
> pantalla), envío, teléfono del acompañante como respaldo explícito (§3.4/J.5)
> y menú, con 2497 tests nuevos/existentes en verde (shared 234 · api 1664 ·
> mirror-agent 455 · web 144). Falta trabajo humano, no código: aprobar la
> plantilla en Meta y encender la Llave 3 desde la pantalla.
> **Fecha:** 2026-09-13.
> **Alcance:** función EXCLUSIVA de este driver y de este tenant. Ver §1.

---

## 0. Qué es y —sobre todo— qué NO es

**Es:** una pantalla nueva en el administrador del hospital para que una persona
escoja, de una lista, a los pacientes que tienen cita con un especialista en unas
fechas, y les mande **un mensaje de WhatsApp** avisando que la sesión se canceló
(o recordándoles la cita). Escenario real y único que lo motiva: *el especialista
no puede venir el día que estaba programado*.

**NO es** —y esto tiene que quedar escrito en el código, en la pantalla y en el
acta de entrega, porque la confusión es cara:

| No es | Por qué importa |
|---|---|
| Un detector de cancelaciones | Nada en el sistema se entera solo. Un humano decide y un humano aprieta el botón. |
| Una cancelación | El mensaje es **pasivo**: informa. La cita sigue viva en el HIS y en AgenIA. Quien de verdad la cancele es el hospital, por su proceso de siempre. Ver §8, ya resuelto: la cita sigue viva en el HIS, pero AgenIA no vuelve a molestar al paciente con un recordatorio de la misma cita. |
| Una campaña de marketing | Es un aviso de servicio (categoría *utility* de Meta). Nunca promocional. |
| Parte del motor de espejo | Se apoya en su canal, pero vive aparte y no puede alterar una sola fila de las que el espejo mueve. Ver §4. |
| Una forma de agendar especialistas por WhatsApp | **Orden vigente del hospital (confirmado 2026-09-13): por ahora solo los médicos GENERALES se agendan por WhatsApp — ningún especialista, ningún servicio de especialista.** Esta función no toca esa regla ni la rodea: solo manda un mensaje de texto. No crea cupos, no reserva, no modifica `MedicalService` ni el catálogo bookeable. Si una cita de especialista llega a AgenIA por el espejo, es **informativa** — ver §8, donde esta regla es la que obligó a decidir (a). |

---

## 1. Aislamiento — las tres llaves (requisitos 5 y 6)

La opción **no existe** salvo que las tres se cumplan a la vez, comprobadas en el
servidor en cada carga y en cada envío (nunca en el cliente):

1. `session.role` es **`ORG_ADMIN` o `BOOKING_AGENT`** (confirmado — ver §1.3
   para la diferencia entre operar la función y configurarla) y
   `session.organizationId` presente.
2. El tenant tiene `HospitalMirrorConfig` con **`enabled = true`** y
   **`driverKey = 'cnt-sanvicente-anserma'`**.
3. La bandera propia de la función está encendida en la configuración del driver
   (§1.2).

Si falta cualquiera: no aparece el menú, no aparece la tarjeta de acceso rápido,
la ruta responde `redirect('/dashboard')` y la server action devuelve
`{ success: false }` sin mirar nada más. La regla 2 es la que garantiza el
requisito 6: **ningún otro tenant, con espejo o sin él, la ve**; y si mañana entra
un segundo hospital con otro driver, tampoco.

### 1.1 Dónde vive el código

Todo bajo prefijos nuevos, para que un `git log` responda "¿qué tocó esto?" de un
vistazo:

```
apps/web/app/dashboard/espejo/avisos/    ← pantalla (nueva, completa)
apps/web/app/actions/avisos.ts           ← server actions (nuevo)
apps/web/lib/spreadsheet-upload.ts       ← xlsxToCsv/sniff/progress, EXTRAÍDO
                                            de PadronUploader.tsx (§3.3.2)
apps/api/src/mass-notice/               ← módulo Nest (nuevo, aislado)
packages/shared/src/avisos-csv.ts        ← parser del CSV (nuevo, puro y testeado)
apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/roster.ts  ← Fase 2 (nuevo)
docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md      ← este archivo
docs/drivers/cnt-sanvicente-anserma/sql/AVISOS_MASIVOS_DESCUBRIMIENTO.sql
docs/drivers/cnt-sanvicente-anserma/avisos/                     ← mock CSV + XLSX (§3.3.5)
```

Archivos EXISTENTES que hay que tocar — son ocho, y los ocho con cambios
aditivos de una a pocas líneas. No hay más:

| Archivo | Cambio | Riesgo |
|---|---|---|
| `apps/web/lib/menus.ts` | Un `MenuItem` nuevo (`AVISOS`), insertado igual que `ESPEJO`, tras una opción `conAvisos` nueva en `opts` (que ya tiene default `{}`: los demás llamadores no se enteran). A diferencia de `ESPEJO` —que solo se inserta si `role === 'ORG_ADMIN'`—, `AVISOS` se inserta en **`ADMIN_MENUS` y en `AGENT_MENUS`** (§1.3: la pantalla es de los dos roles). | Nulo. Cubierto por `menus.spec.ts`. |
| `apps/web/app/dashboard/layout.tsx` | El `count()` de `hospitalMirrorConfig` pasa a `findUnique` con `select { driverKey, enabled, avisosMasivos }`, y se pasa `conAvisos` a `getMenusForRole`. | Bajo. Misma consulta, una fila. |
| `apps/web/app/dashboard/page.tsx` | Lo mismo, para el `QuickAccessGrid`. | Bajo. |
| `apps/api/src/app.module.ts` | Un `import` de `MassNoticeModule`. | Nulo. |
| `packages/database/prisma/schema.prisma` | Dos modelos nuevos, una columna nueva nullable, un valor nuevo de enum. Todo aditivo. | Bajo — ver §4.4. |
| `apps/web/app/dashboard/padron/PadronUploader.tsx` | Se **extraen** (no se modifican) `xlsxToCsv`, `sniffBinarySignature` y `readFileWithProgress` a `apps/web/lib/spreadsheet-upload.ts` (§3.3.2), y `PadronUploader.tsx` pasa a importarlas de ahí en vez de definirlas localmente. | Bajo — refactor mecánico. El componente no tenía spec propio; `spreadsheet-upload.spec.ts` (nuevo) es la primera cobertura real de esta lógica, y `apps/web build` + typecheck confirman que el padrón sigue compilando igual. |
| `apps/web/app/actions/whatsapp-templates.types.ts` | Una entrada nueva (`APPOINTMENT_CANCELLED_MASS`) en el `type` y en `TEMPLATE_CONTRACTS`. El formulario de Configuración → WhatsApp la deriva con `Object.keys(TEMPLATE_CONTRACTS)`, así que aparece sola — cero cambios en el componente del formulario. | Nulo. Sin esta fila, `ORG_ADMIN` no tendría dónde registrar el nombre/idioma aprobado de la plantilla — bloquearía todo envío en silencio. |
| `apps/api/src/interaction-log/interaction-log.service.ts` | Un valor nuevo en `InteractionStatus` (`MASS_NOTICE_SENT`) y un método nuevo (`logMassNoticeSent`), mismo patrón que `logReminderSent`. Nada existente cambia de forma. | Nulo. `interaction-log.service.spec.ts` sigue en verde tal cual. |

### 1.2 La configuración, y por qué NO va dentro de `driverConfig`

La tentación es meter la bandera en `HospitalMirrorConfig.driverConfig`, que ya es
`Json?` y no costaría migración. **No hacerlo.** Ese campo guarda las credenciales
del HIS (lo dice `mirror-agent.guard.ts:68`) y lo lee el guard en *cada* petición
del agente. Un formulario del dashboard que haga read-modify-write ahí puede, en un
mal día, dejar al hospital sin token del HIS. Un campo de pantalla no comparte fila
con un secreto.

Propuesta: **una columna nueva, nullable**, en `HospitalMirrorConfig`:

```prisma
  /// ⚠️ EXCLUSIVO del driver cnt-sanvicente-anserma (ver
  /// docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md).
  /// null = la función no existe para este tenant, que es el caso de todos
  /// menos uno. Json y no columnas sueltas por el mismo criterio que
  /// `mappingJson`: afinar un tope no debe costar un despliegue.
  avisosMasivos Json?
```

Forma del payload:

```jsonc
{
  "enabled": true,
  "fuente": "CSV",              // "CSV" (Fase 1) | "ESPEJO" (Fase 2)
  "maxDestinatariosPorLote": 300,
  "ventanaDiasMax": 30,          // no se puede pedir una lista de más de N días
  "ritmoMensajesPorMinuto": 30,
  "retencionDiasDatosPersonales": 30,   // §9.3
  "medicosHabilitados": []       // vacío = todos los del catálogo; lista = solo esos
}
```

`null` o `enabled: false` ⇒ la tercera llave está cerrada. **El panel que edita
esto solo se renderiza si se cumplen las llaves 1 y 2** — literalmente el requisito
"solo aparece esa configuración si el driver está activo". Va como una sección
nueva al final de `/dashboard/espejo` o como una ruta propia. **Confirmado:**
`/dashboard/espejo/avisos` — cero ediciones en la pantalla que hoy vigila el
espejo en producción.

### 1.3 Quién puede operar la función y quién puede configurarla

El requisito confirma que la pantalla es para **ambos roles**: `ORG_ADMIN` y
`BOOKING_AGENT`. Pero "usar la función" tiene dos niveles distintos, y no es lo
mismo prenderla que apretar el botón de envío una vez que ya está prendida:

| Acción | `ORG_ADMIN` | `BOOKING_AGENT` |
|---|---|---|
| Armar la lista, seleccionar pacientes, revisar y **enviar** el aviso | ✅ | ✅ |
| Ver el historial de lotes enviados | ✅ | ✅ |
| Prender/apagar `avisosMasivos.enabled`, tocar `ventanaDiasMax`, `ritmoMensajesPorMinuto`, etc. (§1.2) | ✅ | ❌ |

Es el mismo criterio que ya usa el resto del panel: quien opera el chatbot día a
día (`BOOKING_AGENT`, como en `AppointmentReminderController.sendManualReminder`,
que ya acepta ese rol) puede disparar una acción de envío, pero encender una
función nueva o mover sus topes de ritmo es una decisión de configuración, y esas
en todo el dashboard son de `ORG_ADMIN` (WhatsApp, plantillas, integraciones — ver
`/dashboard/configuracion`). Asunción explícita, no confirmada por el requisito:
si se prefiere que `BOOKING_AGENT` también configure, es un cambio de una
condición en el guard del server action de configuración, no de arquitectura.

---

## 2. Requisito 3 — ¿puede el agente traer las citas del especialista?

**Respuesta corta: sí, y la parte de transporte es la más barata de todo el plan.
Lo que no está resuelto es otra cosa, y es el teléfono.**

### 2.1 Lo que YA existe y se reutiliza tal cual

- El driver ya consulta `dbo.CITAS_MEDICAS` por rango de fechas, en forma
  *sargable* (`FE_FECH_CIT >= @desde AND < @hasta`, medida en 28 ms de CPU —
  sección C del SQL de descubrimiento). Lo hace dos veces al día ya:
  `detectChanges()` y `snapshotAppointments()`.
- Ya sabe convertir `FE_HORA_CIT` (hora local, formato propio del HIS) a UTC:
  `feHoraCitAIsoOrNull()`. Ese conocimiento es del driver y no puede salir de ahí.
- Ya sube información al servidor por un canal autenticado y probado
  (`POST /mirror/catalog`, `POST /mirror/reconcile`), con token de agente, sin
  abrir un solo puerto entrante en el hospital.
- Ya sabe **qué médicos son especialistas**: `serviciosEvento` en `mapping.json`
  son exactamente los servicios de especialista (890242ESP, 890342SUR, …), y
  `MirrorCatalogEntry` ya trae la etiqueta legible de cada médico con turnos
  futuros.

Añadir el envío de la lista de citas de un médico en unas fechas es: **un método
nuevo en el driver + un endpoint nuevo en `/mirror/*` + un lazo nuevo en el bucle
del agente.** Ni una credencial nueva, ni un puerto nuevo, ni un cambio en un flujo
existente.

### 2.2 Lo que NO existe, y es el verdadero trabajo

**a) Hoy esas citas no llegan a AgenIA como citas, y no deben empezar a llegar.**
Cuando el HIS reporta una cita de un paciente que AgenIA no conoce,
`mirror-apply.service.ts:218-232` marca el cupo como ocupado y **no crea nada más**
(el alta en caliente está explícitamente aplazada a "Fase 2+"). Es la decisión
correcta y **este plan no la cambia**: materializar las citas de ventanilla como
`Appointment` de AgenIA movería disponibilidad, dispararía el cron de
recordatorios sobre pacientes que nunca hablaron con el bot, y ensuciaría
analíticas y reconciliación. Eso es justo lo que el requisito 5 prohíbe. La lista
de avisos vive en **tablas propias** (§4) y es de solo lectura respecto del resto.

**b) El protocolo no transporta datos de contacto, y por buenas razones.**
`HisAppointmentSnapshot` lleva hoy tres campos: `doctorExternalKey`,
`startTimeIso`, `patientDocument`. Nada más. Ni nombre, ni teléfono. El único dato
personal que hoy sube el agente es la **cédula del médico** en el catálogo, y el
comentario del código se molesta en aclarar: *"viaja solo la de los profesionales
que el hospital agenda, nunca la de un paciente"*.

Para mandar un WhatsApp hace falta un teléfono, y ese teléfono solo puede salir de
`dbo.PACIENTES.DE_TELE_PAC`. Eso es **datos personales de salud de gente que nunca
habló con AgenIA**, saliendo del hospital hacia la nube. No es una decisión de
ingeniería: es una decisión del hospital, por escrito, con el mismo método con que
cerraron lo de los convenios (§ correo del 2026-09-04 en `MAPEO_HIS.md`). Y hay que
minimizarla: por eso el diseño es **bajo demanda** (§5), no una réplica continua.

**c) `CITAS_MEDICAS` no tiene teléfono.** Comprobado contra `esquema-real.tsv`: sus
27 columnas no incluyen ninguna de contacto. Hay que unir con `PACIENTES` por
`NU_HIST_PAC_CIT = NU_HIST_PAC` (regla confirmada al 100 % en 78.654 pacientes:
historia = documento).

### 2.3 Conclusión del requisito 3

Sí, es posible, y el plan lo contempla como **Fase 2**. Se construye **después**
de la Fase 1 (CSV) — no porque falte algo por resolver (§3 y §9.1 ya están
cerrados), sino porque la Fase 1 es el entregable más rápido y la Fase 2 se monta
sobre la misma pantalla, motor de envío y auditoría, solo cambiando de dónde sale
la lista.

---

## 3. Requisito 4 — ¿hay certeza del 100 %? La sección J ya corrió (2026-09-13)

**La sección J se corrió contra `ESEHSVP` el 2026-09-13.** Resultado completo en
§3.4. Adelanto de la conclusión: **cobertura de teléfono 92,0 %**, muy por encima
del umbral del 80 % fijado en §3.2 — la Fase 2 (fuente espejo) queda **aprobada
en cuanto a datos**. La autorización de habeas data del hospital (§9.1) también
se resolvió — el director del hospital, que es quien autoriza el tratamiento del
dato, dio el aval. **La Fase 2 no tiene ningún bloqueante pendiente.**

### 3.1 Qué estaba confirmado y qué no, antes de correr J

| Hecho | Estado (antes de J) | Fuente |
|---|---|---|
| Las citas de especialista están en `CITAS_MEDICAS` y se identifican por servicio | ✅ Confirmado | `mapping.json → serviciosEvento`, sección G.6 (32 cápita vs 16 evento, sin zona gris) |
| Historia = documento en el 100 % de los pacientes | ✅ Confirmado | bloque 8, 78.654 filas |
| `PACIENTES` tiene `DE_TELE_PAC varchar(10)` **nullable** y `DE_TELE_ACOM_PAC varchar(15)` | ✅ Existe la columna | `esquema-real.tsv` |
| Qué porcentaje de esos pacientes tiene teléfono | ❌ nunca se midió → ✅ **92,0 %** (§3.4, J.1) | sección J, 2026-09-13 |
| Cuántos de esos teléfonos son celular (10 dígitos, empieza por 3) y no fijo | ❌ nunca se midió → ✅ resuelto (§3.4, J.1/J.3) | sección J, 2026-09-13 |
| Qué tan viejo es el dato (¿se actualiza al agendar, o es de la apertura de la historia?) | ❌ nunca se midió → ✅ resuelto, buena noticia (§3.4, J.4) | sección J, 2026-09-13 |
| Si el hospital autoriza que ese teléfono salga hacia la nube | ❌ no preguntado → ✅ **avalado por el director del hospital** | §9.1 |

### 3.2 El umbral de decisión — acordado ANTES de ver el resultado

Para no racionalizar el número que salga:

- **≥ 80 % de celulares válidos** entre los pacientes con cita de especialista a
  futuro ⇒ la Fase 2 (fuente espejo) vale la pena; el CSV queda como respaldo.
- **50 %–80 %** ⇒ se construye la Fase 2 **igual**, pero la pantalla muestra
  siempre "N de M pacientes de esta agenda no tienen celular registrado — a esos
  hay que llamarlos", y se exporta esa lista para el teléfono fijo del hospital.
  Una función que avisa a la mitad y calla sobre la otra mitad es peor que una que
  dice a quién no alcanzó.
- **< 50 %** ⇒ la fuente espejo no se construye. El CSV es la única vía, y el dato
  bueno lo pone quien lo tiene: la secretaría, que llama para confirmar.

### 3.3 La hoja electrónica: Fase 1, no plan B — CSV o Excel, y se puede repetir

El CSV/Excel **no es el plan B: es la Fase 1**, pase lo que pase con el SQL. Razón: la
pantalla, la selección, el motor de envío, la auditoría y las barandas son
idénticos en los dos casos (y también en la Fase 2 — ver §3.3.4); lo único que
cambia es de dónde sale la lista. Construyendo esto primero, el hospital tiene la
función utilizable en semanas sin depender de una respuesta que no controlamos, y
la Fase 2 se vuelve un cambio de *fuente*, no un rediseño.

#### 3.3.1 Formato — más simple que el original de este plan

Formato (mismo criterio minimalista que el padrón — ver `padron-csv.ts`):

```csv
documento,nombre,telefono,fecha_hora_cita
1037456123,Luz Elena Restrepo Gómez,3114567890,2026-09-24 07:00
```

Respecto a la versión anterior de este plan, se le quitó la columna
`servicio`: sobraba, porque **el médico y el motivo se eligen en la
pantalla**, no se leen de una columna — exactamente como la EPS en el padrón,
y por la misma razón: así es imposible mezclar pacientes de dos médicos por un
valor mal escrito. Tenerla en el archivo Y en la pantalla habría sido dos
fuentes de verdad para el mismo dato.

- `documento`, `telefono` y `fecha_hora_cita` son **obligatorias** — estos son
  los "datos mínimos" que hay que validar antes de habilitar la carga: sin
  documento no hay a quién identificar, sin teléfono no hay a quién
  escribirle, sin fecha no hay con qué cita comparar (es la llave que decide
  si "ya se le había avisado antes" — ver §3.3.3).
- `nombre` es opcional; si falta, el mensaje usa *"Paciente"*, igual que
  `AppointmentReminderCronService.buildMessage()` ya hace hoy.
- Validación en `packages/shared/src/avisos-csv.ts`: pura, testeada, sin acceso a
  base — reutiliza `esDocumentoValido`/`normalizeDocumento` de `documento.ts`
  para el documento, igual que `padron-csv.ts`. Normaliza el teléfono a E.164
  colombiano (`3XXXXXXXXX` → `+573XXXXXXXXX`) y **rechaza** fijos y
  longitudes raras con el número de línea.

#### 3.3.2 CSV o Excel directo — reutilizando lo que ya existe, no inventando nada

**`PadronUploader.tsx` ya resuelve exactamente este problema** para el padrón, y
se reutiliza tal cual en vez de construir un camino nuevo:

1. El input de archivo acepta `.csv` **y** `.xlsx` (`ALLOWED_EXTENSIONS`).
2. Si es Excel, `xlsxToCsv()` lo convierte a texto CSV **en el navegador**, con
   el paquete `xlsx` (SheetJS, ya es dependencia de `apps/web` — no hay que
   instalar nada nuevo): `XLSX.read(buffer) → sheet_to_csv()` de la primera
   hoja con datos.
3. A partir de ahí, **un solo camino**: el mismo texto CSV, validado por el
   mismo parser, sea cual sea el formato de origen. El servidor nunca sabe si
   el archivo llegó como `.csv` o como `.xlsx` — ni falta que le hace.
4. `sniffBinarySignature()` revisa los bytes crudos antes de decodificar nada,
   para no confundir un `.xls` viejo (no soportado) o un PDF renombrado con un
   `.xlsx` real.

Se extraen `xlsxToCsv`, `sniffBinarySignature` y `readFileWithProgress` de
`PadronUploader.tsx` a un helper compartido (`apps/web/lib/spreadsheet-upload.ts`)
para que el nuevo uploader de avisos los reutilice en vez de copiar ~80 líneas.
Es el único cambio que toca un archivo existente en esta sección, y es
extraer una función, no modificar su comportamiento.

#### 3.3.3 Validar → Cargar — el botón no se habilita solo

Mismo patrón de dos pasos que ya usa `/dashboard/padron`, con la misma
disciplina (nunca confiar en el paso anterior: el servidor revalida siempre):

```
canValidate = archivo cargado && no está ocupado
canCargar   = report.ok && archivo sin cambios desde que se validó
              && no está ocupado && report.validRows.length > 0
```

- **"1. Validar archivo"** — siempre disponible en cuanto hay un archivo
  elegido. Corre `avisos-csv.ts` contra el texto (CSV nativo o el que salió de
  `xlsxToCsv`) y muestra: filas válidas, filas rechazadas con su número de
  línea y motivo, y **cuántas de las válidas ya recibieron un aviso antes**
  para esa misma cita (el detalle de esa comprobación es §6.1 — se calcula ya
  en este paso, no hasta después de cargar).
- **"2. Cargar información"** — deshabilitado con un tooltip *"Primero valide
  el archivo sin errores"* hasta que el reporte da `ok`. Al presionarlo, puebla
  `MassNoticeRecipient` del lote — recién ahí se toca la base de datos.
- **Cambiar el archivo invalida el reporte** — hay que volver a validar. Mismo
  candado que el padrón, por la misma razón: no hay forma de que se cargue un
  archivo distinto al que se validó.

#### 3.3.4 Repoblar — se ejecuta cuantas veces haga falta, por cualquiera de las dos fuentes

Ni el CSV/Excel ni la fuente espejo (Fase 2) son de un solo uso. Mientras el
lote siga en `BORRADOR` (nada enviado todavía), **"Cargar información" se
puede correr otra vez**: un archivo corregido, una fecha que se sumó a último
momento, o —en Fase 2— pedirle de nuevo al agente la lista porque se agendó
una cita más. Cada corrida **reemplaza por completo** el conjunto de
candidatos del lote (mismo criterio idempotente que ya usa el padrón: "cada
carga reemplaza, no acumula"), conservando únicamente las filas que ya
tuvieran un envío real (`outcome != 'PENDIENTE'`) si el lote ya empezó a
enviar — aunque en la práctica eso no debería pasar: repoblar se bloquea en
cuanto el lote deja `BORRADOR`.

Las dos fuentes convergen en **una sola función interna** de "poblar lote"
(`applyRosterToBatch(batchId, rows)`), que recibe filas ya normalizadas —
venga la lista de `avisos-csv.ts` (CSV/Excel) o de `HisNoticeCandidate[]`
(espejo, Fase 2). Es la pieza que hace cierto que "cualquiera de las dos
opciones puebla la información" de la misma manera, con las mismas reglas de
deduplicación y de "ya se le había avisado antes".

#### 3.3.5 Mock para probar los dos formatos

`docs/drivers/cnt-sanvicente-anserma/avisos/`:

- `avisos_mock_es01_internista.csv` — 14 filas.
- `avisos_mock_es01_internista.xlsx` — las mismas 14 filas, generadas desde el
  CSV con el mismo paquete `xlsx` que usará el uploader, y verificadas en
  round-trip (`XLSX.read` → `sheet_to_csv` reproduce el original, tildes
  incluidas) — para probar la carga directa desde Excel sin pasar por CSV a
  mano.
- Escenario real, no inventado: **jueves 24-sep-2026, Dr. ES01 (Medicina
  Interna)** — el único día futuro que encontró J.6 (§3.4), con 39 pacientes
  en la corrida real; este mock usa 14 para que sea manejable a mano.
- Trae **dos filas a propósito inválidas** (un teléfono fijo de 7 dígitos, un
  documento vacío) para poder probar que "2. Cargar información" se queda
  apagado hasta que el reporte da `ok`. Detalle completo en el `README.md` de
  esa carpeta.

### 3.4 Resultado de la sección J (corrida el 2026-09-13 contra `ESEHSVP`)

#### J.1 — La pregunta grande: **92,0 %**

| pacientes con cita futura | sin ficha en `PACIENTES` | sin teléfono | con celular válido | % |
|---|---|---|---|---|
| 75 | 0 | 0 | 69 | **92,0 %** |

**Decisión, aplicando el umbral acordado en §3.2 antes de ver el número:** 92,0 %
está por encima del 80 % → **la Fase 2 (fuente espejo) vale la pena.** No hace
falta la rama intermedia del 50-80 %. El CSV (Fase 1) queda como respaldo y como
la única vía para el 8 % restante y para cualquier especialidad que todavía no
tenga masa crítica (ver J.2).

⚠️ Nota de método: la cobertura general de TODOS los pacientes del hospital es
74,6 % (J.3) — bastante más baja que el 92 %. La diferencia confirma que medir
sobre "todos los pacientes" habría sido la pregunta equivocada: la población que
importa (la que hoy tiene una cita de especialista por delante) tiene mejor dato
que el promedio, probablemente porque el teléfono se recaptura al agendar.

#### J.2 — Desglose por médico: la cobertura es alta, pero la agenda está concentrada en dos

| médico | especialidad | citas futuras | con celular | % |
|---|---|---|---|---|
| ES01 — Carlos Andrés Serna Granada | Medicina Interna | 56 | 50 | 89,3 % |
| NU02 — Karen Lorena Cuéllar Huaca | Nutrición y Dietética | 17 | 17 | 100,0 % |

**Hallazgo que no estaba anticipado en el plan:** de las 75 citas futuras de
especialista (J.1), **73 son de estos dos médicos** (el filtro
`HAVING COUNT(*) >= 5` descarta al resto — quedan 2 citas repartidas en médicos
por debajo del umbral). Dermatología, Ginecología, Pediatría y Psiquiatría — que
en J.0 mueven volumen real en 90 días (hasta 91 citas) — hoy tienen **0 a 2 citas
a futuro cada una**.

Esto **no es un problema de dato**: es exactamente el patrón que el requisito 4
preguntaba si existía — especialistas que atienden en **días especiales**, con la
agenda cerrada entre una visita y la siguiente. La propia sección J.6 lo confirma
de forma independiente: los días de mayor volumen de ES01 en los últimos 90 días
— 18-jun, 19-jun, 25-jun, 26-jun, 02-jul, 09-jul, 10-jul, 16-jul, 17-jul, 23-jul,
24-jul, 30-jul, 06-ago, 20-ago, 27-ago, 03-sep, 11-sep, 24-sep — caen **el 100 %
de las veces en jueves o viernes**. Y `ES03`, que en J.6 aparece con días de
hasta 50 pacientes en el pasado (09-jul, 06-ago, ambos también jueves), no tiene
ninguna cita a futuro hoy: su ventana de visita se cerró y todavía no se ha
vuelto a abrir. Dos médicos con el mismo patrón —bloques de días fijos, luego
silencio— es evidencia consistente, no un caso aislado.

**Implicación práctica para la Fase 2 y su prueba piloto:** hoy solo Internista y
Nutrición tienen agenda para ensayar la función de punta a punta. La pantalla
tiene que mostrar "0 candidatos" para una especialidad entre sus días especiales
como un **estado vacío normal**, nunca como un error — y el primer ensayo real
(§11) debe hacerse contra ES01 o NU02, que son los que hoy tienen a quién
avisarle.

*(Esto no equivale a una prueba estadística de periodicidad — solo a la
observación directa de los datos disponibles. Si se quiere confirmar formalmente
el ciclo exacto de cada especialista —cada cuántas semanas, qué días fijos—, hace
falta una consulta dedicada de periodicidad; no bloquea nada de lo decidido
aquí y no se ha escrito todavía.)*

#### J.3 — La forma del dato, y un hallazgo colateral sin resolver

| forma | pacientes | % |
|---|---|---|
| vacío | 3 | 0,0 % |
| con caracteres raros | 33 | 0,0 % |
| **celular válido** | 58.781 | **74,6 %** |
| diez dígitos, no móvil | 310 | 0,4 % |
| fijo (7-8 dígitos) | 5.243 | 6,7 % |
| **otra longitud** | **14.441** | **18,3 %** |

El renglón "otra longitud" es más grande de lo esperado — 14.441 pacientes
(18,3 % del total) con un número que no es vacío, no tiene caracteres raros, y no
mide 7, 8 ni 10 dígitos. No se investigó de qué está hecho (9 dígitos por un dato
mal digitado, 11+ por un indicativo pegado, algo distinto). **No bloquea nada de
lo decidido en este plan** — la población relevante (J.1) ya midió 92 % limpio —
pero queda como pendiente de curiosidad para otro día, con el mismo criterio del
resto del descubrimiento: no se investiga lo que no decide nada todavía.

#### J.4 — Frescura: mejor noticia de lo que el plan temía

| antigüedad de la historia | pacientes | % celular válido |
|---|---|---|
| menos de 1 año | 727 | 98,1 % |
| 1 a 3 años | 1.203 | 98,4 % |
| 3 a 7 años | 1.616 | 97,8 % |
| más de 7 años | 12.213 | 95,7 % |

Medido sobre pacientes con alguna cita en los últimos 365 días (§ nota de método
del SQL: `PACIENTES` no tiene fecha de última modificación, así que esta es la
forma indirecta de medirlo). La cobertura se mantiene entre 95,7 % y 98,4 % sin
importar qué tan vieja sea la historia — el riesgo que más preocupaba (§9 de la
versión anterior de este plan: "un teléfono viejo no falla, entrega el mensaje a
otra persona") es más bajo de lo temido: el hospital sí parece refrescar el
teléfono cuando el paciente vuelve, incluso en historias de hace más de 7 años.
Y por construcción, todo paciente con una cita futura (la población de J.1) tiene
actividad reciente por definición — así que esta buena señal aplica de lleno.

#### J.5 — El respaldo del acompañante: rescata 4 de cada 10

| sin celular propio (con alguna cita futura) | rescatados por teléfono del acompañante | % |
|---|---|---|
| 78 | 32 | **41,0 %** |

Población más amplia que J.1 (cualquier cita futura, no solo de especialista).
Confirma que vale la pena construir el rescate por `DE_TELE_ACOM_PAC` en la
Fase 2, **siempre como opción explícita y etiquetada en pantalla** ("se le
escribirá al acompañante registrado") — nunca en silencio, tal como ya
contemplaba el comentario original de la consulta J.5.

#### J.6 — Tamaño de lote: cómodo

El máximo histórico en 90 días es 52 pacientes en un solo día (ES01, pasado); el
promedio es 23. De las 20 fechas del top, **solo el 24-sep-2026 es una cita
futura real** (39 pacientes) — el resto ya ocurrió y solo sirve para dimensionar.
Un lote de 39-52 personas a 30 mensajes/minuto tarda 1-2 minutos: el
`maxDestinatariosPorLote: 300` por defecto tiene margen de sobra y el ritmo no es
un cuello de botella.

### 3.5 Lo que cambia en el plan a partir de este resultado

- **Fase 2 pasa de "condicional" a "aprobada por datos, pendiente solo de lo
  legal".** Ver §10.
- El primer ensayo en real (§11) se hace contra **ES01 (Medicina Interna)**, que
  es hoy el médico con más agenda futura y mejor cobertura medible.
- La pantalla de Fase 2 necesita un estado vacío explícito ("este especialista no
  tiene citas en el rango pedido — puede que su próxima visita aún no esté
  agendada") en vez de tratar 0 candidatos como error.
- Se añade el teléfono del acompañante como fuente secundaria explícita en el
  diseño de pantalla (§6), no solo como idea en el comentario del SQL.
- El bucket "otra longitud" de J.3 queda anotado como curiosidad abierta, sin
  tarea asociada.

---

## 4. Modelo de datos (todo aditivo)

> ⚠️ **Esto NO es una plataforma general de notificaciones masivas.** Los nombres
> `MassNoticeBatch`/`MassNoticeRecipient` son genéricos porque un nombre en
> español ("AvisoAnserma") habría sido peor código, no porque el diseño se
> piense reutilizable. La única razón por la que esta función no se filtra a
> otro tenant es la llave 2 de §1 (`driverKey` + `organizationId`) — pero eso
> protege el ACCESO, no diseña la REUTILIZACIÓN. Cuando entre el próximo
> hospital con otro driver, esta función **no se hereda activando un flag**:
> ese hospital tendrá su propio HIS, su propia calidad de dato (la sección J de
> §3.4 es evidencia de que el número correcto no se adivina, se mide), su
> propio marco legal y puede que ni siquiera el mismo concepto de "especialista
> visitante". Eso exige su propio descubrimiento SQL, su propia decisión de
> umbral y, muy probablemente, su propio ajuste de pantalla — no una copia de
> esta tabla con otro `organizationId`. Si ese día llega, este documento es el
> punto de partida para escribir el plan de ESE driver, no el plan en sí.

### 4.1 `MassNoticeBatch` — el lote

Un lote = "lo que se decidió mandar de una vez". Existe por tres razones concretas:
hay que poder **revisar a quién se le va a escribir antes** de apretar el botón,
**demostrar a quién se le escribió después**, y sobrevivir a que la fuente sea
asíncrona (el agente contesta en su siguiente vuelta, no al instante).

```prisma
model MassNoticeBatch {
  id             String @id @default(uuid())
  organizationId String
  organization   Organization @relation(...)

  /// 'CANCELACION' | 'RECORDATORIO' — String y no enum: el vocabulario de una
  /// función de un solo driver no merece una migración por cada variante.
  kind   String
  /// 'CSV' | 'ESPEJO' | 'AGENIA' — de dónde salió la lista. Se audita porque
  /// la confianza en el teléfono no es la misma en los tres casos.
  source String
  /// 'BORRADOR' | 'ENVIANDO' | 'ENVIADO' | 'CANCELADO'
  status String @default("BORRADOR")

  doctorExternalKey String?
  doctorLabel       String?
  serviceLabel      String?
  dateFrom          DateTime
  dateTo            DateTime

  /// El texto exacto (o plantilla + parámetros) que se usó. Sin esto, dentro de
  /// seis meses nadie puede decir qué se le dijo al paciente.
  messageTemplate String? @db.Text
  messagePreview  String? @db.Text

  /// Nota libre que el operador escribe UNA vez por lote ("El Dr. Serna vuelve
  /// el jueves 24") y viaja como {{5}} de la plantilla aprobada (§7.1). Vive
  /// en el lote y no en cada destinatario: es un mensaje "uno por uno" en el
  /// envío, pero la redacción se decide una sola vez para todo el lote, no
  /// destinatario por destinatario — igual que el médico y el motivo.
  /// null/"" ⇒ el envío usa la frase por defecto de la plantilla.
  notaAdicional String? @db.Text

  candidates Int @default(0)
  selected   Int @default(0)
  sent       Int @default(0)
  failed     Int @default(0)
  skipped    Int @default(0)

  createdByUserId String
  createdBy       User @relation(...)
  createdAt DateTime @default(now())
  sentAt    DateTime?
  /// Fecha en que se purgaron nombre y teléfono de los destinatarios (§9.3).
  purgedAt  DateTime?

  recipients MassNoticeRecipient[]
  @@index([organizationId, createdAt])
}
```

### 4.2 `MassNoticeRecipient` — una fila por persona

```prisma
model MassNoticeRecipient {
  id      String @id @default(uuid())
  batchId String
  batch   MassNoticeBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  /// Denormalizado del lote a propósito: sin esto, "¿a este documento ya se le
  /// avisó de esta cita en OTRO lote?" (§6.1) obliga a un join contra
  /// MassNoticeBatch en la consulta más caliente de la pantalla. Se escribe
  /// una vez al crear la fila y nunca cambia.
  organizationId String

  patientDocument String
  /// Nullable porque se PURGAN a los N días (§9.3): la traza de "a este
  /// documento se le escribió tal día" sobrevive; el dato de contacto no.
  patientName String?
  phoneE164   String?

  appointmentAtUtc   DateTime
  doctorExternalKey  String?
  serviceExternalKey String?

  /// Cuando el paciente SÍ existe en AgenIA, se prefiere su BSUID al teléfono:
  /// es el identificador estable de Meta y el teléfono puede haber caducado de
  /// su caché de 30 días. Ver PatientProfile.bsuid.
  agenIAPatientId String?

  /// Snapshot tomado AL POBLAR el lote (§3.3.3/§6.1): ¿ya existía un envío
  /// ENVIADO para este mismo (patientDocument, appointmentAtUtc) en OTRO
  /// lote? Es una fotografía, no una fuente viva — si se repobla (§3.3.4) se
  /// recalcula. Determina el default de `selected` (ver abajo) y el badge
  /// "Enviado antes" de la pantalla.
  previousSentAt      DateTime?
  previousSentBatchId String?

  /// Por defecto `true`, EXCEPTO cuando `previousSentAt` no es null: a un
  /// paciente ya avisado no se le vuelve a marcar solo — el operador tiene
  /// que decidirlo a propósito, viendo el badge.
  selected Boolean @default(true)
  /// 'PENDIENTE' | 'ENVIADO' | 'FALLIDO' | 'OMITIDO'
  outcome  String  @default("PENDIENTE")
  error    String?
  sentAt   DateTime?
  usedTemplate String?

  /// Idempotencia: reapretar el botón no vuelve a escribirle a nadie que ya
  /// recibió el mensaje EN ESTE lote — solo reintenta PENDIENTE y FALLIDO.
  @@unique([batchId, patientDocument, appointmentAtUtc])
  @@index([batchId, outcome])
  /// Cubre la consulta de §6.1: "¿algún envío ENVIADO previo para
  /// (organización, documento, hora de cita)?" — la que llena
  /// `previousSentAt` al poblar un lote nuevo.
  @@index([organizationId, patientDocument, appointmentAtUtc])
}
```

### 4.3 Valor nuevo de enum

```prisma
enum WhatsappTemplateKind {
  APPOINTMENT_REMINDER
  WAITLIST_SLOT_OFFER
  APPOINTMENT_CANCELLED_MASS   // ← nuevo
}
```

Aditivo. `@@unique([organizationId, kind])` sigue valiendo: una plantilla de
cancelación por clínica.

### 4.4 Las dos comprobaciones de seguridad del esquema

1. **Ninguna tabla nueva lleva trigger de outbox.** `fn_sync_outbox()` se instala
   por tabla desde `prisma/sql/`; si no se añade, no se añade. **No se añade.**
   Un destinatario de un aviso no es un evento que el HIS deba conocer.
2. **Ninguna relación nueva cuelga de `Appointment` ni de `ScheduleSlot`.** El
   vínculo con la cita de AgenIA, cuando existe, es por `agenIAPatientId` +
   `appointmentAtUtc`, no por FK. Así es imposible que un `onDelete` o un
   `include` de este módulo altere algo del espejo.

---

## 5. Protocolo nuevo agente ↔ nube (Fase 2)

**Bajo demanda, no réplica continua.** Los teléfonos solo viajan cuando hay una
cancelación real que comunicar. Una copia permanente de los contactos de la agenda
del hospital en la nube sería más cómoda de programar y mucho peor de defender.

```
1. El admin pide "citas del Dr. X entre el 25 y el 26"
   → se crea MassNoticeBatch(status=BORRADOR) y una NoticeRosterRequest pendiente.

2. El agente, en un lazo nuevo cada 30 s:
   GET /mirror/notice-requests   → [{ requestId, doctorExternalKey, fromIso, toIso }]

3. El driver ejecuta la consulta (CITAS_MEDICAS ⋈ PACIENTES), canonicaliza la
   hora a UTC y responde:
   POST /mirror/notice-roster    → { requestId, candidates: HisNoticeCandidate[] }

4. El servidor pasa `candidates: HisNoticeCandidate[]` por la MISMA función que
   usa el CSV/Excel (`applyRosterToBatch`, §3.3.4) — calcula `previousSentAt`
   (§6.1) y escribe los `MassNoticeRecipient` del lote. La pantalla, que hace
   polling, muestra la lista.
```

El paso 1 se puede repetir **cuantas veces haga falta** (§3.3.4): el botón
"Traer del hospital" no es de un solo uso — cada click crea una petición nueva
y `applyRosterToBatch` reemplaza el conjunto de candidatos del lote, igual que
recargar el CSV.

```ts
// packages/shared/src/mirror-protocol.ts — añadidos, nada modificado
export interface HisNoticeCandidate {
  doctorExternalKey: string;
  serviceExternalKey?: string;
  /** UTC. La conversión desde la hora local del HIS la hace el driver. */
  startTimeIso: string;
  patientDocument: string;
  patientFullName?: string;
  /** DE_TELE_PAC tal como está en el HIS. Se normaliza en el servidor. */
  patientPhone?: string;
}
```

Latencia esperada: **≤ 30 s** (un lazo propio, no el de disponibilidad de 15 min).
Barandas del endpoint:

- Ventana máxima `ventanaDiasMax` (default 30 días). Una petición más ancha se
  rechaza: nadie cancela un año de agenda.
- Un solo médico por petición.
- Tope de `maxDestinatariosPorLote` filas; si se pasa, se responde truncado **y se
  dice en la pantalla** — nunca se recorta en silencio.
- Si `avisosMasivos.enabled` es falso o `fuente !== 'ESPEJO'`, el endpoint
  responde 403 aunque el token del agente sea válido. La tercera llave se comprueba
  también aquí.

---

## 6. La pantalla (requisito 2)

`/dashboard/espejo/avisos` — accesible para `ORG_ADMIN` y `BOOKING_AGENT`
(§1.3). Tres pasos — y un enlace a "Configuración" visible **solo para
`ORG_ADMIN`**, que es el único que puede tocar `avisosMasivos.enabled` y sus
topes (§1.2). Antes de los tres pasos, una frase fija en la cabecera que fija
la expectativa correcta: *"Este aviso se envía persona por persona, no es una
campaña masiva — úselo para el puñado de pacientes de un día de agenda."*
(Los números reales lo confirman: J.6 midió un promedio de 23 pacientes por
día de especialista y un máximo de 52 en 90 días — ver §3.4.)

**Paso 1 · Armar la lista**
- Fuente: *Subir hoja electrónica* (Fase 1, CSV o Excel — §3.3) o *Traer del
  hospital* (Fase 2, solo si `fuente: "ESPEJO"`).
- Si es hoja electrónica: elegir archivo → **"1. Validar archivo"** (reporte de
  filas válidas/rechazadas, con las ya avisadas antes marcadas — §6.1) →
  **"2. Cargar información"**, deshabilitado hasta que el reporte da `ok`
  (§3.3.3). Se puede repetir cuantas veces haga falta mientras el lote siga en
  borrador (§3.3.4): un archivo corregido reemplaza al anterior.
- Filtros (cuando la fuente es *Traer del hospital*): **médico especialista**
  (de `MirrorCatalogEntry`, los que tienen turnos a futuro) y **rango de fechas
  de la cita**. El botón de traer también se puede repetir (§3.3.4).
- Estado vacío explícito para *Traer del hospital*: "Este especialista no tiene
  citas en el rango pedido — puede que su próxima visita aún no esté agendada"
  (hallazgo de §3.4/J.2), nunca tratado como error.
- El resultado: tabla con documento, nombre, fecha y hora de la cita, teléfono
  enmascarado (`•••• 1234`) y —columna nueva— **"Aviso previo"**. Nada de
  teléfonos completos en pantalla: no hacen falta para decidir y su sitio no es
  una captura de pantalla en un grupo de WhatsApp.

### 6.1 "Aviso previo" — si ya se le escribió antes, y cuándo

Como el lote se puede repoblar y como pueden existir lotes anteriores para el
mismo médico, **cada fila muestra si ese documento, para esa misma fecha y hora
de cita, ya recibió un aviso `ENVIADO` en cualquier otro lote** — consulta por
`(organizationId, patientDocument, appointmentAtUtc)` sobre `MassNoticeRecipient`
(§4.2), capturada en `previousSentAt`/`previousSentBatchId` al poblar:

- Sin aviso previo → fila normal, **seleccionada por defecto**.
- Con aviso previo → badge *"Enviado el 13 sep, 10:32"*, **NO seleccionada por
  defecto** (el operador tiene que decidir a propósito si de verdad quiere
  volver a escribirle — reenviar es legítimo, ej. si el primer intento no
  entregó, pero nunca por descuido).

**Paso 2 · Escoger y revisar**
- Casilla por fila + "seleccionar todos los visibles" (respeta el default de
  §6.1: no selecciona de golpe a los que ya tienen aviso previo).
- **Los que no tienen celular válido salen listados aparte**, con su propio
  contador y un botón de exportar a CSV, para que alguien los llame. No se cuelan
  entre los "enviados".
- **Nota adicional (opcional)** — un campo de texto libre, una vez por lote:
  *"¿Quiere agregar algo a la redacción? (opcional)"*, con contador de
  caracteres (máx. ~150: tiene que caber como una frase dentro de la
  plantilla — ver §7.1). Se guarda en `MassNoticeBatch.notaAdicional`.
- Vista previa del mensaje **exactamente como le llegará** — se recalcula en
  vivo con cada cambio de selección o de la nota adicional; nunca un texto
  fijo pegado en la pantalla. Si la nota queda vacía, la vista previa muestra
  la frase por defecto de la plantilla, para que no haya sorpresas entre lo
  que se ve y lo que Meta manda.

**Paso 3 · Enviar**
- Confirmación explícita del estilo de la del padrón: *"Vas a escribirle a **14
  pacientes** del Dr. Serna para la cita del 24 de septiembre. Esto no se puede
  deshacer: WhatsApp no borra mensajes entregados. Escribe el número 14 para
  confirmar."*
- Durante el envío: barra de progreso y contadores en vivo (enviados / fallidos /
  omitidos) — uno por uno, no en lote (§7.4).
- Al terminar: resumen y **el lote queda en el historial** con quién lo mandó,
  cuándo, a cuántos y con qué texto (nota adicional incluida). El historial es
  tan importante como el envío.

**Fechas:** todo el render usa `formatAppointmentLong` / `formatAppointmentCompact`
desde `@/lib/date`, nunca `toLocale*` (CLAUDE.md). Sin eso, un aviso de cancelación
saldría con la hora cinco horas adelantada — el peor sitio posible para ese error.

---

## 7. El envío

### 7.1 Plantilla, no texto libre

Estos pacientes no escribieron en las últimas 24 h: el 100 % de los envíos cae
**fuera de la ventana de servicio**, donde Meta solo acepta plantilla aprobada. Se
reutiliza `WhatsappTemplateService.sendTemplate()` tal cual, con el `kind` nuevo.

Contrato de variables — **cinco, no cuatro** (el ajuste respecto a la versión
anterior de este plan está en §7.2): se documenta en `whatsapp-templates.types.ts`
igual que el recordatorio, para que la clínica la apruebe bien a la primera):

```
{{1}} nombre del paciente   {{2}} especialidad / servicio
{{3}} médico                {{4}} fecha y hora de la cita
{{5}} nota adicional — la escribe el operador por lote (§6, Paso 2), o la
      frase por defecto si la deja vacía (§7.2)
```

Texto sugerido para aprobar en Meta (categoría **UTILITY**, nunca MARKETING):

> Hola {{1}}. Le escribimos del Hospital San Vicente de Paúl de Anserma.
> Lamentamos informarle que su cita de {{2}} con {{3}}, programada para el {{4}},
> **fue cancelada** por una novedad del especialista. {{5}} Nos comunicaremos con
> usted para reprogramarla, o puede escribirnos por este mismo medio.

Si la plantilla no está registrada, el envío **no se intenta**: se devuelve
`template-not-configured` y la pantalla lo dice con todas las letras, igual que ya
hace el cron de recordatorios. Nada de degradar a texto libre: fallaría en silencio
paciente por paciente.

### 7.2 La nota adicional — el límite real de "poner algo en la redacción"

El requisito pide que el operador pueda agregar algo a lo que se envía. Una
plantilla aprobada de Meta **no admite edición libre del cuerpo** — solo de
sus variables — así que "poner algo en la redacción" se resuelve con la
variable `{{5}}`, no reabriendo el texto aprobado:

- El operador escribe una frase corta en el Paso 2 (§6) — ej. *"El Dr. Serna
  estará de nuevo el jueves 24."* — y esa frase reemplaza `{{5}}` tal cual,
  para **todo el lote**.
- Si la deja vacía, `{{5}}` se llena con la frase por defecto: *"Le ofrecemos
  disculpas por el inconveniente."* — la plantilla **nunca** recibe una
  variable vacía (algunos flujos de Meta la rechazan, y aunque no la
  rechazara, una oración cortada a la mitad se ve mal).
- Límite de ~150 caracteres, forzado en la pantalla: tiene que seguir leyéndose
  como una frase dentro del mensaje, no un segundo mensaje pegado.
- **Lo que NO cambia:** el resto del cuerpo (saludo, motivo de la cancelación,
  cierre) es fijo, exactamente como Meta lo aprobó. Eso es lo que hace que el
  envío sea legal y confiable — la libertad está en `{{5}}`, no en el resto.

### 7.3 Destinatario

`buildWhatsappRecipient()` ya resuelve las dos formas. Prioridad:

1. `PatientProfile.bsuid` si el paciente existe en AgenIA — es el identificador
   estable de Meta.
2. `phoneE164` normalizado desde el HIS o el CSV.

### 7.4 Ritmo, errores e idempotencia — uno por uno, no una campaña

El requisito lo dice explícitamente y los números lo confirman (J.6, §3.4): esto
**no es un envío masivo estilo campaña**, es un mensaje personalizado que se
manda persona por persona, en volúmenes bajos (promedio 23, máximo medido 52 en
90 días). El diseño ya era así; queda dicho para que nadie lo lea como un
broadcast:

- Secuencial, **un `POST` a Meta por destinatario**, con pausa entre mensajes
  según `ritmoMensajesPorMinuto` (default 30) — no hay cola ni encolador
  aparte, un `for` con `await` y una pausa basta para el volumen real.
  Además de por rendimiento, la pausa **protege la calidad del número**: una
  ráfaga de plantillas a gente que nunca escribió es lo que Meta penaliza.
- `try/catch` por destinatario: uno malo no puede parar el lote. Mismo patrón que
  `AppointmentReminderCronService.runOnce()`.
- El resultado se escribe **por fila, en el momento**, no al final: si el proceso
  muere a la mitad, se sabe exactamente dónde se quedó y reanudar no le escribe dos
  veces a nadie.
- Auditoría doble, como todo lo demás del sistema: `InteractionLog` por mensaje
  (caja negra) y `SystemLog.event({ action: 'MASS_NOTICE_SENT' })` por lote.

---

## 8. Decidido: opción (a) — marcar `reminderSentAt` al enviar el aviso

Requisito 1, textual: *"no es que el sistema detectará que se cancelaron... es un
mensaje pasivo"*. De acuerdo, y el plan lo respeta. Pero hay que decir en voz alta
lo que eso implica, porque le llega al paciente:

**Al paciente se le dice "su cita fue cancelada", y su cita sigue existiendo** —
en el HIS, y en AgenIA si era una cita de AgenIA. Consecuencias reales:

1. **El cupo sigue ocupado.** Nadie más puede tomar esa hora, aunque el médico no
   venga.
2. **El cron de recordatorios le va a escribir.** Si la cita es de AgenIA
   (`Appointment` con `reminderSentAt = null`), en unas horas
   `AppointmentReminderCronService` le manda *"Le recordamos su cita de X con Y"*.
   **El mismo paciente recibe una cancelación y después un recordatorio de la misma
   cita.** Esto no es hipotético: es lo que hace el código hoy.
3. La reconciliación seguirá viendo las dos citas como vigentes y sanas —
   correctamente, porque lo están.

### 8.1 Por qué esto no es un caso raro — un hallazgo en el código existente

El requisito confirmó la política del hospital: **por ahora solo los médicos
GENERALES se agendan por WhatsApp; ningún especialista** — y que una cita de
especialista que llegue a AgenIA debe ser **informativa**. Esa es exactamente la
garantía que hay que sostener. Pero revisando `mirror-apply.service.ts` para
este plan (sin tocarlo — requisito 5) apareció algo que vale la pena dejar
escrito:

`applyAppointmentCreate()` **no distingue especialidad**. Cuando el HIS reporta
una cita para un paciente que **ya existe en AgenIA** (`agenIAPatientId`
resuelto — típicamente porque ese mismo paciente ya usó el chatbot para un
médico general), la función llama a `appointmentsService.bookAppointment(...)`
y **crea un `Appointment` real** (`origin: 'MIRROR'`, `status: SCHEDULED`), sea
la cita de un médico general o de un especialista. El filtro por especialidad
que la política del hospital da por hecho **vive en la configuración del
catálogo bookeable, no en el espejo** — el espejo refleja lo que el HIS reporta
para cualquier médico homologado.

Efecto práctico: **una cita de especialista SÍ puede convertirse hoy en un
`Appointment` real y elegible para el cron de recordatorios**, cada vez que el
paciente ya sea conocido en AgenIA — que en un hospital con la misma población
yendo a médico general y a especialista no es un caso raro. Esto **no es una
regresión de este plan ni algo que este plan vaya a corregir** (tocar
`mirror-apply.service.ts` está fuera de alcance por el requisito 5); es contexto
que explica por qué la opción (a) no es un "nice to have":

| Opción | Qué implica | Decisión |
|---|---|---|
| **(a)** Al enviar el aviso, poner `reminderSentAt = now()` en las citas de AgenIA del lote | Toca un campo existente, pero **para lo que ese campo existe**: "no le mandes el recordatorio". Una línea, reversible, sin efecto en disponibilidad ni en el HIS. Es el mecanismo concreto que hace cierto, en la práctica, que la cita "es informativa" — sin tocar `mirror-apply.service.ts`. | ✅ **Decidida.** |
| **(b)** No hacer nada | Cero código, pero dado el hallazgo de §8.1, la contradicción no es un caso extremo: ocurre cada vez que el paciente de especialista ya es conocido en AgenIA. | ❌ Descartada. |
| **(c)** Cancelar de verdad en AgenIA y en el HIS | Deja de ser "pasivo": libera cupos, escribe en `CITAS_ANULADAS`, dispara el outbox. Es una función distinta y mucho más grande, y contradice el requisito 1 ("no es que el sistema detectará/cancelará"). | ❌ Fuera de alcance de esta entrega. |

La opción (a) **no** aplica a las citas nativas del HIS que llegan por CSV o por
la fuente espejo de solo-lectura de la Fase 2 (`MassNoticeRecipient`): esas no
son `Appointment` y el cron no las mira. Solo aplica al caso de §8.1 — un
paciente de especialista que YA tiene una cita real en AgenIA porque el espejo
la creó al homologarlo. El lote, al armarse, busca esa coincidencia (mismo
paciente, mismo médico, misma hora) y si existe, marca `reminderSentAt` al
enviar.

---

## 9. Barandas legales y de plataforma

### 9.1 Habeas data (Ley 1581) — ✅ resuelto: aval del director del hospital

Escribirle por WhatsApp a alguien que nunca le dio su número a AgenIA necesita base
legal. La hay —es información de la prestación del servicio, no publicidad— pero el
**responsable del dato es el hospital** y AgenIA es encargado. Se consultó y **el
director del hospital, que es quien autoriza el tratamiento del dato, dio el
aval** para que `DE_TELE_PAC` salga hacia la nube con la finalidad acotada de este
plan ("avisar novedades de citas de especialista").

Con esto la Fase 2 **ya no tiene ningún bloqueante**. Queda un pendiente
administrativo, no técnico y no bloqueante — dejar constancia por escrito
(correo o memorando del director) con la finalidad y el plazo de retención
(§9.3), mismo método con el que se cerraron los convenios (correo del hospital,
2026-09-04) y que va en `PREGUNTAS_AL_HOSPITAL.md`. Recomendado antes de que la
Fase 2 salga a producción, para tener el respaldo escrito si algún día se
audita — pero no impide empezar a construir.

Lo que este aval **no** cambia: el mensaje sigue debiendo identificarse como del
hospital y ofrecer una salida, y la purga de retención de §9.3 sigue aplicando
igual.

### 9.2 Calidad del número en Meta

Una ráfaga de plantillas a números que nunca escribieron al negocio es el camino
más corto a que bajen la calificación de calidad de la línea —o la bloqueen—, y con
ella se cae **el chatbot entero del hospital**, no solo esta función. Por eso:
categoría UTILITY, ritmo limitado, tope por lote, y un aviso en pantalla la primera
vez que se use.

### 9.3 Retención

`retencionDiasDatosPersonales` (default 30). Pasado el plazo, una tarea pone a
`null` `patientName` y `phoneE164` de los destinatarios y marca `purgedAt`. **La
traza no se borra**: queda que a tal documento se le escribió tal día con tal
plantilla. Mismo criterio que `PadronImportRow`, que guarda la cédula y el
resultado pero jamás la fila cruda.

---

## 10. Fases

### Fase 0 — Confirmar (fuera de código) · ✅ completa
1. ✅ **Sección J corrida el 2026-09-13** — resultado y decisión en §3.4/§3.5.
   Cobertura 92,0 %, por encima del umbral del 80 %.
2. ✅ **Habeas data resuelto** — aval del director del hospital (§9.1). Queda un
   pendiente administrativo no bloqueante: dejarlo por escrito antes de salir a
   producción.
3. ✅ §8 decidido: opción (a).
4. ⏳ La clínica somete la plantilla `APPOINTMENT_CANCELLED_MASS` a Meta — tarda,
   y sin ella no sale un solo mensaje. **Es lo único que queda de la Fase 0, y
   lo único con reloj: arrancarlo ya.**

### Fase 1 — CSV/Excel + envío + auditoría · ✅ implementada (2026-09-13)

| Pieza | Archivo | Estado |
|---|---|---|
| Esquema (§4) | `packages/database/prisma/schema.prisma` + migración `20260913120000_avisos_masivos_foundations` | ✅ Validado contra el esquema real generado por `prisma migrate diff` |
| Parser/validador | `packages/shared/src/avisos-csv.ts` | ✅ 15 tests, valida el mock real fila a fila |
| Excel compartido | `apps/web/lib/spreadsheet-upload.ts` (extraído de `PadronUploader.tsx`, §3.3.2) | ✅ 6 tests nuevos — antes sin cobertura |
| Envío (API) | `apps/api/src/mass-notice/` (`mass-notice.service.ts` + `.controller.ts` + `.module.ts`) | ✅ 14 tests — Llave 2/3, §7.1 (5 variables), §7.2 (nota adicional), §8 (supresión de recordatorio) |
| CRUD (web) | `apps/web/app/actions/avisos.ts` | ✅ 24 tests — las tres llaves, repoblación, aviso previo |
| Pantalla | `apps/web/app/dashboard/espejo/avisos/` (`page.tsx` + `components/AvisosClient.tsx` + `RecipientsTable.tsx` + `BatchHistory.tsx`) | ✅ Validar→Cargar, selección con badge "Aviso previo", nota adicional con vista previa en vivo, confirmación escribiendo el número, historial |
| Menú | `apps/web/lib/menus.ts` + `mirror-flags.ts` (nuevo) + `layout.tsx`/`page.tsx`/`QuickAccessGrid.tsx` | ✅ 6 tests nuevos — aparece en `ADMIN_MENUS` y `AGENT_MENUS`, nunca sin las tres llaves |
| Plantilla en catálogo | `apps/web/app/actions/whatsapp-templates.types.ts` — `APPOINTMENT_CANCELLED_MASS` añadido a `TEMPLATE_CONTRACTS` | ✅ Ya seleccionable desde Configuración → WhatsApp |
| Mock CSV + XLSX | `docs/drivers/cnt-sanvicente-anserma/avisos/` | ✅ Generados y verificados en round-trip (§3.3.5) |

**Regresión completa en verde:** `pnpm --filter @agenia/shared test` (234/234) ·
`pnpm --filter api exec jest` (1625/1625) · `pnpm --filter web exec jest`
(128/128) · `pnpm --filter web build` · `pnpm --filter api build` ·
`pnpm --filter web lint` (0 errores) · `node scripts/check-date-rule.mjs` (0
violaciones) · `prisma validate` + `prisma format` sin cambios.

**Lo único que falta para que el hospital lo use de verdad — ninguno es
código:**
1. Someter la plantilla `APPOINTMENT_CANCELLED_MASS` a aprobación de Meta
   (§7.1 tiene el texto sugerido) — sin esto, `findTemplate` nunca encuentra
   nada y `sendBatch` siempre responde "no hay plantilla aprobada".
2. Un `ORG_ADMIN` real tiene que entrar a `/dashboard/espejo/avisos` →
   Configuración → marcar "Habilitar" (Llave 3) — por diseño, nace apagado
   en todos los tenants.
3. Ensayo con un solo destinatario real antes del primer lote de verdad
   (§11) — el código lo permite, pero nadie debe estrenarlo sobre pacientes
   reales sin probarlo primero.

**Deliberadamente fuera de esta entrega** (no bloquean lo anterior, quedan
para cuando se necesiten): descargar la plantilla del CSV desde la pantalla,
exportar a CSV los "sin celular", y la purga de retención de §9.3 (Fase 3).

### Fase 2 — Fuente espejo · ✅ implementada (2026-09-13)

Cobertura de datos aprobada con margen (92,0 % contra el umbral del 80 %, §3.2) y
habeas data avalado por el director del hospital (§9.1).

| Pieza | Archivo | Estado |
|---|---|---|
| Esquema (§4) | `packages/database/prisma/schema.prisma` + migraciones `20260913150000_notice_roster_requests`, `20260913160000_notice_roster_truncated`, `20260913170000_notice_companion_phone` | ✅ `NoticeRosterRequest` (con `truncated`) + `MassNoticeRecipient.phoneIsCompanion`, validadas contra `prisma migrate diff` |
| Protocolo (§5) | `packages/shared/src/mirror-protocol.ts` — `HisNoticeCandidate` (con `companionPhone`), `NoticeRequestDto`, `NoticeRosterInput`, `NoticeRosterResult` (con `truncated`) | ✅ Tipos compartidos agente↔API, nada modificado del protocolo existente |
| Driver | `apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts` — `fetchNoticeRoster()` (join `CITAS_MEDICAS ⋈ PACIENTES`, bordes SQL sargables + filtro fino por instante) | ✅ 11 tests (`notice-roster.spec.ts`) — incluye `DE_TELE_ACOM_PAC` (J.5) |
| Capacidad opt-in | `apps/mirror-agent/src/core/driver.interface.ts` — `NoticeRosterCapableDriver` + `isNoticeRosterCapable()` (type guard estructural, nunca `implements`) | ✅ El contrato `HisDriver` genérico queda intacto — ver §0 |
| Lazo del agente | `apps/mirror-agent/src/core/engine.ts` (`syncNoticeRequests()`) + `mirror-api-client.ts` + `config.ts` (`MIRROR_NOTICE_INTERVAL_MS`, 30 s por defecto) + `index.ts` (`bucleAvisos`) | ✅ Bajo demanda, nunca réplica continua (§5) |
| Endpoints agente↔nube | `apps/api/src/mirror/mirror-notice.service.ts` + `mirror.controller.ts` — `GET /mirror/notice-requests`, `POST /mirror/notice-roster` (`MirrorAgentGuard`) | ✅ 26 tests (`mirror-notice.service.spec.ts`) — Llave 2/3, idempotencia por `requestId`, truncamiento nunca en silencio, respaldo del acompañante |
| Endpoints pantalla↔API | `apps/api/src/mass-notice/mass-notice.controller.ts` — `POST /mass-notice/:batchId/notice-request`, `GET /mass-notice/notice-request/:requestId` (`RolesGuard`, JWT de staff) | ✅ Cubiertos en `mass-notice.controller.spec.ts` |
| CRUD (web) | `apps/web/app/actions/avisos.ts` — `getDoctorCatalogAction`, `requestNoticeRosterAction` (crea o repuebla lote existente, §3.3.4), `getNoticeRequestStatusAction` (con `truncated`), `getBatchAction` (con `phoneIsCompanion`) | ✅ 40 tests (`avisos.spec.ts`) |
| Pantalla | `apps/web/app/dashboard/espejo/avisos/components/AvisosClient.tsx` | ✅ Selector médico + rango de fechas · polling cada 3 s (timeout 90 s) · repoblar sin salir del lote · estado vacío explícito (J.2) · aviso de truncamiento · badge "del acompañante" en `RecipientsTable.tsx` (J.5, nunca en silencio) · selector de fuente CSV/ESPEJO en Configuración |

**Regresión completa en verde:** `pnpm --filter @agenia/shared exec jest`
(234/234) · `pnpm --filter api exec jest` (1664/1664) · `pnpm --filter
mirror-agent exec jest` (455/455) · `pnpm --filter web exec jest` (144/144) ·
`pnpm --filter web build` · `pnpm --filter api build` · `pnpm --filter
mirror-agent build` · `pnpm --filter web lint` / `pnpm --filter api lint` (0
errores) · `node scripts/check-date-rule.mjs` (0 violaciones) · `npx tsc
--noEmit` (web, 0 errores).

**No verificado en este entorno:** sin Docker disponible en este sandbox, no
hubo una prueba de extremo a extremo contra una base de datos real ni una
sesión de navegador real (mismo límite que Fase 1). La cobertura de arriba es
enteramente por typecheck + suites automatizadas + build; falta el primer
ensayo manual real antes de producción (§11).

**Deliberadamente fuera de esta entrega:** `medicosHabilitados` (filtro de
médicos permitidos en `avisosMasivos`, declarado en el tipo pero sin
aplicarse), `ventanaDiasMax` configurable desde la pantalla (el default de 30
días se aplica del lado del servidor, §5) — ninguno bloquea el uso real,
quedan para Fase 3 si hacen falta.

### Fase 3 — Pulido
Purga de retención · exportar los "sin celular" · recordatorio masivo (mismo motor,
otro `kind`) · métrica de entrega.

---

## 11. Pruebas

- **Unitarias (shared):** `avisos-csv.spec.ts` — teléfono fijo se rechaza, celular
  se normaliza a `+57…`, duplicados, encabezados raros, BOM, documento vacío. Sin
  base de datos. Se valida contra el mock real
  (`docs/drivers/cnt-sanvicente-anserma/avisos/avisos_mock_es01_internista.csv`):
  12 filas `ok`, 2 rechazadas con su línea y motivo — mismo criterio que el
  padrón ("los mocks se commitean ya validados contra el validador real").
- **Manual, con el mock:** subir el `.csv` y por separado el `.xlsx` de la misma
  carpeta a la pantalla real — deben dar el MISMO reporte (12 válidas, 2
  rechazadas), probando que `xlsxToCsv` no altera los datos (tildes incluidas).
- **Unitarias (API):** el servicio de envío con `WhatsappTemplateService` en mock —
  que un fallo no pare el lote; que reapretar no reenvíe a los `ENVIADO`; que sin
  plantilla no se intente nada; que `{{5}}` nunca viaje vacío (cae a la frase por
  defecto — §7.2).
- **Repoblación:** cargar el mock, desmarcar una fila, volver a cargar el mismo
  archivo → la fila reaparece marcada (repoblar resetea la selección, es la
  semántica esperada). Cargar un archivo con una fila ya `ENVIADO` en otro lote
  → aparece con `previousSentAt` y `selected = false` (§6.1).
- **Aislamiento (el test que más importa):** un tenant sin espejo, uno con espejo de
  otro `driverKey`, y uno con el driver bueno pero `avisosMasivos.enabled = false`
  → los tres reciben 403/redirect en **todas** las rutas y actions nuevas.
- **`menus.spec.ts`:** la opción no aparece sin las tres llaves, y aparece con ellas
  — y ninguna de las opciones que ya había cambió de sitio.
- **Regresión (requisito 5):** `pnpm --filter api test` y `pnpm --filter web build`
  en verde, y `pnpm --filter <app> lint` para la regla de fechas.
- **Ensayo en real:** primer lote contra **un solo destinatario** (un teléfono del
  hospital), con el médico y la fecha reales. Nunca estrenar esto sobre 47 personas.
  Hacerlo contra **ES01 (Medicina Interna)** — hoy el único médico con agenda
  futura amplia y cobertura medida (§3.4, J.2); NU02 sirve de segundo caso por
  ser el otro con masa crítica. Cualquier otra especialidad mostrará "0
  candidatos" hasta que su próxima ventana de días especiales se abra.

---

## 12. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Se manda a quien no era (médico o fecha mal elegidos) | Alto e **irreversible**: WhatsApp no borra | Vista previa + confirmación escribiendo el número + ensayo con un destinatario |
| El teléfono del HIS está viejo | El aviso llega a otra persona | Sección J mide la cobertura; la pantalla muestra siempre "N sin celular"; el CSV permite el dato bueno |
| Meta baja la calidad de la línea | **Se cae el chatbot completo del hospital** | UTILITY + ritmo + tope + aviso en pantalla |
| Cancelación seguida de recordatorio | El paciente no entiende nada y pierde confianza | §8, opción (a) — decidida, y necesaria por el hallazgo de §8.1 (no un edge case) |
| Alguien cree que el sistema canceló la cita | El cupo no se libera y nadie lo nota | Texto explícito en la pantalla y en el resumen del lote |
| Se le reescribe sin querer a alguien ya avisado (repoblar, o un lote nuevo para la misma cita) | Paciente confundido/molesto por un doble mensaje | §6.1: badge "Aviso previo" + `selected = false` por defecto para esas filas |
| La nota adicional del operador rompe la plantilla aprobada (muy larga, o vacía llega a Meta) | Meta rechaza el envío completo del lote | Límite de caracteres forzado en pantalla + frase por defecto cuando queda vacía (§7.2) |
| El módulo nuevo toca algo del espejo | Se rompe lo que funciona | Tablas propias, sin FK al espejo, sin trigger de outbox, seis archivos existentes tocados con cambios de una línea (uno es una extracción mecánica) |

---

## 13. Decisiones — todas resueltas

1. ~~**§8** — ¿opción (a), (b) o (c)?~~ ✅ **Resuelto — opción (a).** Reforzado por
   la política confirmada del hospital (solo médicos generales se agendan por
   WhatsApp) y por el hallazgo de §8.1: `mirror-apply.service.ts` no exime a los
   especialistas, así que (a) no es cautela de sobra, es lo que hace cierto que
   la cita "es informativa".
2. ~~¿La pantalla la usa solo `ORG_ADMIN`, o también `BOOKING_AGENT`?~~
   ✅ **Resuelto — los dos.** Ver §1.3 para la diferencia entre operar (los dos
   roles) y configurar (solo `ORG_ADMIN`, asumido).
3. ~~¿El panel de configuración va dentro de `/dashboard/espejo` o como
   `/dashboard/espejo/avisos`?~~ ✅ **Resuelto — `/dashboard/espejo/avisos`.**
4. ~~¿Corres la sección J?~~ ✅ Resuelto — corrida el 2026-09-13, resultado en
   §3.4. Cobertura 92,0 %, Fase 2 aprobada por datos.
5. ~~¿Quién en el hospital autoriza el tratamiento del dato?~~ ✅ **Resuelto —
   el director del hospital, avalado (§9.1).** Único pendiente asociado, no
   bloqueante: dejar el aval por escrito antes de que la Fase 2 salga a
   producción.

**No queda ninguna decisión abierta.** Lo único con reloj es someter la
plantilla `APPOINTMENT_CANCELLED_MASS` a Meta (§10, Fase 0) — el resto es
trabajo de construcción, no de decisión.

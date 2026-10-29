# Resumen de la atención al paciente por WhatsApp y correo

**Estado:** propuesta del 2026-10-28. Nada construido. Fase 0 (descubrimiento en el HIS) lista para correr.
**Primer hospital:** San Vicente de Paúl de Anserma (driver `cnt-sanvicente-anserma`).

## 1. Qué se pide

Cuando un médico termina la historia clínica en el HIS del hospital (CNT), el paciente recibe por **WhatsApp** y por **correo electrónico** un resumen completo de su atención:

- el resumen de la atención (motivo, diagnóstico, plan y recomendaciones del médico);
- la lista de **medicamentos** formulados (nombre, dosis, frecuencia, duración, cantidad);
- la lista de **exámenes** y procedimientos ordenados (laboratorio, imágenes, otros);
- y, si los hay, incapacidad, remisiones o interconsultas y la cita de control.

## 2. Cómo está hoy

### 2.1 Lo que ya sabemos del HIS

| Hecho | Fuente | Qué implica |
|---|---|---|
| La historia vive en `HISTORIACLINICA` (columnas con sufijo `_HICL`). El médico que de verdad atendió está en `CD_MED_REAL_HICL`; el código de agenda, en `CD_MED_ASIG_HICL`. | `MAPEO_HIS.md` §4.8 (respuesta del hospital, 2026-09-18) | Es la tabla de partida. |
| ✅ **HC-0 (2026-10-28):** fecha `FE_FECH_HICL`, paciente `NU_HIST_PAC_HICL`; llave primaria, índice agrupado e identidad `NU_NUME_HICL`. | `MAPEO_HIS.md` §2.9 | Cada atención tiene un número único y creciente: es la llave del resumen y el cursor del agente. |
| ✅ **HC-1 a HC-4 (2026-10-28):** `HISTORIACLINICA` es solo la **cabecera** (~100 bytes, sin texto; trae tipo `TX_TIPO_HICL`, estado `NU_ESTA_HICL` y servicio `TX_CODSER_HICL`). El contenido está en tablas con **llave foránea declarada**: órdenes (`HIST_ORDEN` → `HIST_PROC`, `HIST_MEDI`), indicaciones (`HIST_INDI`), incapacidad (`HIST_INCA`), remisión (`HIST_REMI`), diagnósticos (`R_LABO_DIAG`) y el texto del médico en plantillas (`DATOS_PLANTILLA` → `_TEXT`, `_MEMO`). | `MAPEO_HIS.md` §2.9 | Todo lo que pide el resumen existe y está estructurado. Hay que unir ~8 tablas. |
| ✅ **El HIS ya genera el RDA en vivo:** `SP_INTEROPERABILIDAD_IHC_V2` corrió 249 veces en 2 horas el 28-oct. Lee diagnósticos, medicamentos (DCI, CUM), procedimientos, incapacidad, alergias y antecedentes, no el texto de la plantilla. | HC-4a, HC-4c | Su código es el mapa de los datos estructurados; el de 2023 (`SP_INTEROPERABILIDAD`), el del texto. Refuerza D16: no ejecutarlo, leer las tablas. |
| ✅ **47.927 historias en 90 días (~16.000 al mes)**, el doble de las citas. | HC-0 | La tabla mezcla consulta externa con urgencias, hospitalización y otras: el volumen a enviar es un subconjunto. |
| ✅ **Ronda 2:** de 16.342 historias en 30 días, 6.585 son consultas (`TX_TIPO_HICL = 'CON'`) y **~5.500 son ambulatorias** (sin registro de ingreso); el resto son notas de enfermería, evoluciones y procedimientos. En una consulta: medicamentos 56 %, exámenes 43 %, indicaciones 39 %, remisión 19 %, incapacidad 1,8 %, diagnóstico ~100 %. | `MAPEO_HIS.md` §2.9 | **~5.500 resúmenes al mes** como techo. Medicamentos = órdenes de tipo 5 (`HIST_MEDI`, con dosis, frecuencia, vía y duración en columnas); exámenes = tipos 1-4 (`HIST_PROC`). Todo enlace está indexado. |
| ✅ **~6 % de las consultas tiene un diagnóstico sensible** (casi todo salud mental, F00-F99). | R2-2 (f) | La lista de D7 deja fuera unas 330 consultas al mes. |
| 🔴 `INTER_RES1888` guarda en texto plano el secreto y el token de la conexión con el Ministerio. | R2-1 | Nunca se le da permiso a AgenIA sobre ella; avisarle al hospital. |
| ✅ **Ronda 3: no hay marca de «historia cerrada».** El HIS guarda la historia una sola vez, al terminar (mediana: 13 min después de la hora de la cita). Las órdenes llegan después: p99 25 min, máximo 116 min. `NU_ESTA_HICL` no es el cierre: coincide con «tiene exámenes ordenados». | `MAPEO_HIS.md` §2.9 | Se envía **2 horas después de guardada** (§3.1). |
| 🔴 **El correo del HIS no sirve:** el 97 % de los pacientes tiene el correo de relleno del hospital (`pacienteshospital@gmail.com`); solo ~1,4 % tiene uno propio. Celular: 95 %. | R3-7 | **WhatsApp es el canal principal.** El correo exige conseguir el dato por otra vía (D17). |
| ✅ **Medicamentos `AI` y `AE`: los dos son fórmula para la casa**, de 90 días, entregada por meses con **órdenes posfechadas** (56 % de los renglones `AI`). ❓ `AI` = farmacia del hospital, `AE` = dispensador externo. | R3-3 | El resumen dice cada medicamento una vez, dónde reclamarlo y desde qué fecha cada entrega. |
| ⚠️ La consulta de urgencias (`S39145`, ~1.100 al mes) también llega sin registro de ingreso. | R3-1 | D1 se filtra por servicio, no solo por «sin registro»: sin urgencias quedan **~4.400 consultas al mes**. |
| 🔴 **Ronda 4: la dosis estructurada contradice a veces lo que escribió el médico** (ivermectina: «1 cada 24 h» frente a «4 TAB EN AYUNAS, REPETIR EN 15 DÍAS»; el texto que arma el HIS dice «1 mg» para una cápsula de 20 mg). La indicación del médico (`TX_INDDOS_HMED`) viene en el 89 %. | `MAPEO_HIS.md` §2.9 | El resumen muestra **la indicación del médico tal cual** (§3.2); nunca arma instrucciones con los códigos. |
| ✅ **Series posfechadas:** la entrega de hoy más una cada 30 días (+30, +60, +90…); el mismo medicamento aparece hasta 3 veces en la consulta. `NU_ESTA_HICL` = 1 ⇔ tiene exámenes (2.208 de 2.208). Catálogos de la fórmula: `PAC_CONFIG_HIS` tipo 37 (frecuencia), `INV_CONFIG_MED` tipo 1 (unidad de dosis). | R4-1, R4-4, R4-6 | Un renglón por medicamento con sus fechas de entrega. |
| ⚠️ **Signos vitales sucios** en la plantilla (talla en m y cm mezcladas, IMC de 51.840, temperatura de 360). | R4-5 | No van en la primera versión (salvo, quizá, la presión arterial). |
| ✅ **Estadística (E-1 a E-6):** 15.051 historias al mes (abril → septiembre +21 %), 5.394 pacientes; 3,58 KB por historia con todo su contenido (consulta 6,28 KB), **54 MB al mes**. La fila de `HISTORIACLINICA` sola pesa 0,05 KB. Piloto: 2.814 consultas al mes; sin urgencias: 4.290. | E-1 a E-6, §9 | El volumen y el peso son pequeños para el HIS y para AgenIA; lo que manda es el cuidado clínico, no la capacidad. |
| El usuario del agente, `agenia_sync`, tiene **prohibido a propósito** leer `HISTORIACLINICA` («debe fallar» en la verificación del script de permisos). | `sql/AGENIA_SYNC_SETUP.sql` §6 | Esta función cambia el alcance de datos acordado con el hospital: hay que pedir permisos nuevos, por escrito y columna por columna. |
| El proveedor instaló el 1-jul-2026 `SP_INTEROPERABILIDAD_IHC_V2` (80 KB): interoperabilidad de historia clínica, Resolución 866 de 2021. Hay además `SP_INTEROPERABILIDAD_HC_FHIR` y `SP_INTEROPERABILIDAD`. | `ESTADO.md`, «El segundo escritor se desinfla» §2 | Ese código ya junta lo que forma una atención (diagnósticos, medicamentos, procedimientos, profesional). Leerlo es el atajo para el mapeo. |
| `ESPECIALIDADES.NU_GENRDA_ESP` («genera RDA»): el HIS marca por especialidad si arma el **Resumen Digital de Atención**. | `esquema-real.tsv` | El hospital ya produce, para algunas especialidades, un resumen normalizado de cada atención. |
| `PACIENTES` trae `DE_TELE_PAC` (varchar 10), `DE_EMAIL_PAC` (varchar 100) y los del acompañante (`DE_TELE_ACOM_PAC`, `TX_EMAIL_ACOM_PAC`). | `esquema-real.tsv` | Hay de dónde sacar el correo. Su calidad no se ha medido. |
| SQL Server 2017 Standard; base viva `ESEHSVP`; ~250-300 citas por día hábil. | `MAPEO_HIS.md` | Orden de magnitud: unas **5.000-7.000 atenciones al mes** si cada cita deja una historia. La cifra real sale de la Fase 0. |
| El proveedor cambia el esquema en producción, en horario laboral y sin avisar. | `ESTADO.md` §4 | Las columnas nuevas que lea el agente tienen que entrar al chequeo de esquema (`mirror-schema-check.service.ts`). |

### 2.2 Lo que ya tiene AgenIA y se reutiliza

- **Agente espejo con capacidades opcionales** (`apps/mirror-agent/src/core/driver.interface.ts`): avisos masivos, consulta en vivo e importación de citas son interfaces *opt-in* que un driver implementa si puede. Esta función es una más; un segundo hospital no queda obligado a tenerla.
- **Aviso al paciente por un hecho del hospital** (`apps/api/src/mirror/aviso-cambio-hospital.service.ts`): ya decide WhatsApp con texto dentro de 24 h, plantilla fuera de la ventana, Telegram si el paciente usa Telegram, y nunca a un número marcado como de otra persona.
- **Página pública con enlace personal**: la encuesta (`apps/web/app/encuesta/[tokenId]`) llega por enlace y valida su token. Como es una página del panel que habla con la API por la red interna, no necesita ruta nueva en el Caddy (que es lista blanca solo para `/api/*`).
- **Cifrado de campos clínicos** (`apps/api/src/common/crypto/`, extensión de Prisma) y **retención automática** (`RetentionService`).
- **Plantillas de WhatsApp por clínica** (`WhatsappTemplateKind`, `TEMPLATE_CONTRACTS` en `@agenia/shared`, formulario de Configuración → WhatsApp).
- **Baja de mensajes** (`PatientProfile.remindersOptOut`, frases fijas sin IA).

### 2.3 Lo que falta

- **No hay envío de correo** en todo el sistema (no hay librería ni proveedor; `MirrorConflictAlert.emailSentAt` existe pero nunca se llena; el rastreo decidió «solo WhatsApp» en §12 #13).
- **No hay generador de PDF** en ninguna app.
- `WhatsappTemplateService` solo envía variables del cuerpo; **no envía botones con enlace**.
- `ClinicalRecord` es la historia **propia** de AgenIA (con firma y notas). La del hospital **no** se guarda ahí: sería una segunda historia legal de la misma atención.

### 2.4 Lo que no sabemos (lo responde la Fase 0)

1. El resto de columnas de `HISTORIACLINICA` (las cinco principales ya se confirmaron) y las tablas de diagnósticos, fórmula, órdenes, incapacidades y remisiones.
2. Cuándo una historia está **terminada** (¿hay marca de cerrada o firmada? ¿cuánto pasa entre abrirla y cerrarla?).
3. Si una atención es una fila o varias.
4. Cómo se une con la cita (`CITAS_MEDICAS`).
5. Qué tipos de atención mezcla la tabla (consulta externa, urgencias, hospitalización, odontología).
6. Cuántos pacientes tienen celular y correo utilizables, cuántos son menores y cuántos correos son relleno.
7. Cuántas historias se hacen por mes y cuánto pesan.

## 3. El diseño

### La idea en una línea

El agente del hospital detecta las historias **terminadas**, arma el resumen con datos del HIS y lo sube **cifrado** a AgenIA. AgenIA le avisa al paciente por WhatsApp y por correo **sin poner datos clínicos en el mensaje**: el WhatsApp trae un botón a una página personal y el correo trae, además, el PDF protegido con su número de documento.

```
HIS (ESEHSVP)                 Agente (VM del hospital)              AgenIA (nube)                       Paciente
─────────────                 ────────────────────────              ─────────────                       ────────
HISTORIACLINICA ─┐            cada 5 min: historias cerradas
fórmula, órdenes ├─ SELECT ─▶ desde el último cursor  ── HTTPS ──▶  guarda cifrado (30 días)
diagnósticos ────┘            arma el resumen (JSON)                decide: ¿se envía? ¿a quién?
PACIENTES (contacto)                                                 ├─ WhatsApp: plantilla + botón ──▶  abre el enlace,
                                                                     │                                   confirma su fecha de
                                                                     └─ Correo: aviso + PDF con clave ─▶ nacimiento, ve y
                                                                        y el mismo enlace                descarga el PDF
```

### 3.1 Cuándo se considera terminada una historia

El HIS **no tiene marca de cierre** (ronda 3): guarda la historia una sola vez, cuando el médico termina, y en los minutos siguientes escribe las órdenes (mediana 2 min, p99 25 min, máximo visto 116 min). Por eso la regla es **«2 horas después de guardada»** (`FE_FECH_HICL` + 2 h): a esa hora ya están las órdenes, los medicamentos, las indicaciones y la remisión. Una orden que llegue después de enviado el resumen aparece en el enlace, que siempre muestra lo vigente.

Si el médico la corrige después (nota aclaratoria), el enlace muestra siempre la **última versión** con «actualizado el …». En la primera versión no se reenvía el aviso (D10).

### 3.2 Qué lleva el resumen

| Sección | Contenido | Fuente probable |
|---|---|---|
| Encabezado | Hospital, fecha y hora, servicio, especialidad, médico que atendió (nombre y registro) | `HISTORIACLINICA` (`FE_FECH_HICL`, `TX_CODSER_HICL` → `SERVICIOS`), `LABORATORIO.CD_CODI_ESP_LABO` → `ESPECIALIDADES`, `MEDICOS` (`CD_MED_REAL_HICL`: `NO_NOMB_MED`, `DE_REGI_MED`) |
| Resumen de la atención | Motivo de consulta, diagnósticos en palabras (el código CIE-10 al lado), plan o conducta tal como los escribió el médico | Texto: `DATOS_PLANTILLA_TEXT` / `_MEMO` por campo de la plantilla, con una **lista de campos por plantilla** que configura el hospital (`MAPEO_HIS.md` §2.9, tabla de R4-5). Piloto: 870 «Consulta externa» → motivo («MC:») y plan («CONDUCTA → Anotaciones»); 844 «Control crónicos» → conducta, próximo control, metas de educación y las casillas de educación (dieta, ejercicio…) en palabras. Diagnósticos: `R_LABO_DIAG` (`CD_CODI_DIAG_RLAD`, `ID_TIPO_DIAG_RLAD`) → `DIAGNOSTICO.DE_DESC_DIAG`, `TIPODIAGNOSTICO` (no el texto «Dx. Principal» de la plantilla) |
| Recomendaciones | Indicaciones al paciente | `HIST_INDI.DE_DESC_HIND` (y el campo de plan de la plantilla) |
| Medicamentos | Nombre, forma, vía, cantidad, duración en días y **la indicación tal como la escribió el médico** («1 TAB VO EN LA NOCHE»); si no hay indicación (11 %), la dosis y la frecuencia estructuradas traducidas con sus catálogos. **Dónde reclamarlo** (farmacia del hospital o dispensador externo, si se confirma `AI`/`AE`) y **las fechas de las entregas posfechadas** (hoy, +30, +60…). Cada medicamento una sola vez. Se quitan solo los anulados (`NU_ESTA_HMED = 0`). 🔴 **No** se copia el otro filtro del RDA (renglones sin `NU_AUTO_UNVE_HMED`, unidad de venta): deja fuera casi todos los medicamentos externos `AE`, que el paciente igual tiene que reclamar (M-3, 2026-10-28: pasan de ~1.780 consultas con `AE` en 30 días a 2-132 al mes) | `HIST_ORDEN` (`NU_TIPO_HORD = 5`, `TX_TIAP_HORD`, `FE_POSFECHA`, `NU_ORDEN_FECHAPOS`) → `HIST_MEDI`: `NO_NOMB_ARTI_HMED`, `CD_CODI_ARTI_HMED` (para no repetir), `TX_FOFA_HMED`, `TX_VIAD_HMED`, `NU_CANT_HMED`, `TX_DURA_HMED` (días), **`TX_INDDOS_HMED`**; de respaldo, solo la frecuencia `NU_CTFREC_HMED`+`TX_CDFREC_HMED` (→ `PAC_CONFIG_HIS` tipo 37: minutos, horas, día, semanas, mes, año, según respuesta), si el comité la aprueba. **Nunca** `DE_DOSIS_HMED` ni `NU_CTDSIS_HMED`+`TX_UMDSIS_HMED`: la unidad se queda en mg (`168`) y sale «1 mg» por «1 cápsula» |
| Exámenes y procedimientos | Laboratorios (tipo 2), otros procedimientos y ayudas diagnósticas (tipo 4), consulta de control o con especialista (tipo 1), cirugía (tipo 3): nombre, cantidad, indicación | `HIST_ORDEN` (`NU_TIPO_HORD` 1-4) → `HIST_PROC` (`CD_CODI_SER_HPRO` → `SERVICIOS`, `NU_CANT_HPRO`, `DE_INDI_HPRO`) |
| Próximo control y educación | «Próximo control», metas de educación, dietas y ejercicio indicados (control de crónicos) | Campos de la plantilla 844 (R3-5, R4-5) |
| Otros | Incapacidad (días, desde, tipo), remisión (a qué servicio, prioridad), interconsulta | `HIST_INCA`, `HIST_REMI`, `HIST_ORTIAT` (`CD_CODI_ESP_HOTA`) |
| Pie | «Este resumen es informativo y no reemplaza la fórmula ni la orden oficiales para reclamar medicamentos o autorizar exámenes» (texto que valida el hospital) y cómo comunicarse | Configuración |

**Nunca va:** anamnesis detallada, examen físico, antecedentes, revisión por sistemas ni notas internas del médico (salvo que el hospital decida otra cosa en D2).

**Sin IA:** el contenido sale tal como está en el HIS, ordenado por una plantilla fija. Resumir o «explicar en palabras sencillas» con IA puede cambiar una dosis o un diagnóstico y además enviaría la historia a un tercero. Queda fuera de este plan.

### 3.3 Cómo llega por WhatsApp

- Una plantilla de categoría **Utilidad** (nuevo `WhatsappTemplateKind`: `ATTENTION_SUMMARY_READY`), aprobada por Meta en la cuenta del hospital, con un texto fijo sin datos clínicos y un **botón con enlace**:
  > *Hola {{1}}, el Hospital San Vicente de Paúl le comparte el resumen de su atención del {{2}}: diagnóstico, medicamentos y exámenes ordenados. Por su seguridad, para verlo le pediremos su fecha de nacimiento.* — [Ver mi resumen]
- Dentro de la ventana de 24 h (el paciente le escribió al asistente hace poco) el mismo texto sale como mensaje libre con el enlace.
- Si el paciente habla con el asistente por **Telegram**, va por Telegram (gratis).
- **Por qué no se manda el resumen dentro del WhatsApp:** una plantilla no admite listas largas (las variables no llevan saltos de línea y el cuerpo tiene tope), y el texto quedaría en los servidores de Meta y en cualquier celular que reciba el mensaje por equivocación. Con el enlace, un número equivocado solo recibe «tiene un resumen».

### 3.4 Cómo llega por correo

- ⚠️ **De dónde sale el correo.** El del HIS casi nunca sirve: el 97 % de los pacientes tiene el correo de relleno del hospital (ronda 3). Se usa solo un correo que no esté en la lista de relleno configurada, o uno que el paciente dé por el asistente («¿quiere recibirlo también por correo?»), con su autorización (D17). En la práctica, al arrancar el correo llega a pocos pacientes y el canal principal es WhatsApp.
- Asunto y cuerpo sin datos clínicos («Resumen de su atención del 28 de octubre»), el mismo enlace y el **PDF adjunto cifrado con contraseña = su número de documento** (como los extractos bancarios en Colombia; el correo dice cuál es la clave sin escribirla).
- Remitente con SPF, DKIM y DMARC configurados, para que Gmail y Hotmail no lo manden a spam.
- Se registran rebotes: un correo que rebota se marca y no se vuelve a usar.

### 3.5 La página del resumen

- Enlace único por atención (`/resumen/<token>`, 128 bits aleatorios), válido **30 días**.
- Pide la **fecha de nacimiento** completa. Cinco intentos fallidos bloquean el enlace una hora y queda anotado.
- Muestra el resumen y el botón «Descargar PDF» (el PDF se genera al momento; no se guarda).
- Cada apertura queda en una bitácora (cuándo, desde qué IP, si verificó): la ley exige saber quién accedió a una historia.
- Pensada para celular, letra grande, sin tecnicismos en la interfaz.

### 3.6 A quién se le envía

| Caso | WhatsApp | Correo |
|---|---|---|
| El paciente ya le escribió al asistente | Al WhatsApp (o Telegram) que AgenIA tiene de él | El que dio por el asistente; si no, `DE_EMAIL_PAC` solo si no es de relleno |
| Paciente que nunca escribió | Al celular del HIS (`DE_TELE_PAC`, lo tiene el 95 %) **si** empieza por 3, tiene 10 dígitos y AgenIA no lo tiene asociado a otro documento (misma regla D4 del alta en caliente) | `DE_EMAIL_PAC` solo si no es de relleno (~1,4 %) |
| Menor de edad (18,5 %) | Al celular del acompañante (lo tiene el 90 %) o al WhatsApp que agendó (D6) | `TX_EMAIL_ACOM_PAC` solo si no es de relleno |
| Correo de relleno (`pacienteshospital@gmail.com`, `hsvpanserma@hotmail.com`, `pacientesanserma@gmail.com`, o cualquiera compartido por muchos pacientes) | — | No se envía; la lista es configurable |
| Se dio de baja («no quiero resúmenes») | No | No |
| Sin ningún contacto utilizable | No se envía; queda contado en el panel | — |

### 3.7 Lo que nunca se envía

Atenciones con temas sensibles, por diagnóstico CIE-10 o por especialidad: ni el aviso ni el resumen. Lista inicial propuesta, que valida el comité de historias clínicas del hospital (D7): VIH (B20-B24, Z21), salud mental (F00-F99), violencia y abuso (T74, T76, Y05-Y07, Z04.4, Z04.5), interrupción del embarazo (O04), infecciones de transmisión sexual (A50-A64) y las especialidades de psicología y psiquiatría. La lista vive en la configuración de la clínica, no en el código.

### 3.8 Horario

Entre 7:00 y 20:00 (hora de Bogotá). Lo que se cierre de noche sale a las 7:00.

## 4. Qué hay que construir

### 4.1 En el hospital (lo hace TI del hospital)

- `GRANT SELECT` **por columna** a `agenia_sync`, solo las columnas que usa el resumen (§3.2). Tablas, tras la ronda 2: `HISTORIACLINICA`, `HIST_ORDEN`, `HIST_MEDI`, `HIST_PROC`, `HIST_INDI`, `HIST_INCA`, `HIST_REMI`, `HIST_ORTIAT`, `LABORATORIO` (solo `NU_NUME_LABO`, `CD_CODI_ESP_LABO`), `R_LABO_DIAG`, `DATOS_PLANTILLA`, `DATOS_PLANTILLA_TEXT`, `DATOS_PLANTILLA_MEMO`, `R_PLAN_ESP_TIAT`, `R_PLAN_CONC`, y los catálogos `CONCEPTO_HIST`, `GRUPO_HIST`, `DIAGNOSTICO`, `TIPODIAGNOSTICO`, `ESPECIALIDADES`, `SERVICIOS` (ya lo tiene), `MEDICOS` (nombre y registro), más las columnas de contacto de `PACIENTES`. El texto de la plantilla no se puede limitar por columna a ciertos campos: la consulta del agente filtra por concepto y solo sube los del resumen. **Nunca** `INTER_RES1888` (credenciales del Ministerio) ni `EXECUTE` sobre los procedimientos del proveedor (D16).
- Nada se escribe en el HIS.

### 4.2 Agente (`apps/mirror-agent`)

- Capacidad opcional nueva en `driver.interface.ts`, con su guarda de tipo, como las otras tres:
  ```ts
  interface AttentionSummaryCapableDriver {
    detectFinishedAttentions(since: DriverCursor): Promise<{ keys: HisAttentionKey[]; nextCursor: DriverCursor }>;
    fetchAttentionSummaries(keys: HisAttentionKey[]): Promise<AttentionSummaryDto[]>;
  }
  ```
- En el driver CNT: las consultas (parametrizadas, con tope de filas y `READ UNCOMMITTED`) con el mapeo de la Fase 0. Cursor = el último `NU_NUME_HICL` leído (identidad e índice agrupado, confirmado en HC-0): cada vuelta es una búsqueda por el índice. Una historia abierta que todavía no está cerrada se vuelve a mirar en la vuelta siguiente hasta que se cierre (o caduque).
- Envío por lotes a un endpoint nuevo `POST /mirror/attention-summaries`, con reintento e idempotencia (la llave es hospital + clave de la atención).
- Va en el mismo ciclo y con el mismo cortacircuitos del espejo; si falla, no frena las citas.

### 4.3 Contrato compartido (`packages/shared`)

- `AttentionSummaryDto`: atención, médico, diagnósticos, medicamentos, exámenes, incapacidad, remisiones, recomendaciones. Validado con el mismo esquema en el agente y en la API.
- Entrada en `TEMPLATE_CONTRACTS` para la plantilla nueva (nombre del paciente y fecha; el botón lleva el token).

### 4.4 Base de datos (una migración, aditiva)

| Modelo | Para qué |
|---|---|
| `AttentionSummary` | Una por atención: clínica, paciente (si se identifica), clave del HIS (única por clínica), contenido **cifrado**, huella del contenido, fecha de la atención, estado (`RECIBIDO`, `EXCLUIDO`, `ENVIADO`, `SIN_CONTACTO`, `CADUCADO`), vence, se purga |
| `AttentionSummaryDelivery` | Un envío por canal: canal, destino enmascarado, plantilla o texto, estado, motivo si no salió, id de Meta o del proveedor de correo, rebote |
| `AttentionSummaryAccess` | Cada apertura del enlace: cuándo, IP, verificó sí/no |
| `PatientProfile.summariesOptOut` | Baja de los resúmenes, aparte de la de recordatorios |
| `HospitalMirrorConfig.resumenAtencion` (Json) | Interruptor, especialidades o médicos del piloto, exclusiones, tiempo de calma, horario, texto del pie |
| `WhatsappTemplateKind.ATTENTION_SUMMARY_READY` | La plantilla nueva |

### 4.5 API (`apps/api/src/attention-summary/`)

- Recibir el lote del agente, guardar cifrado, aplicar exclusiones y baja, resolver destinatarios, programar el envío respetando el horario.
- `WhatsappTemplateService`: soportar el componente `button` de tipo URL con su parámetro.
- Módulo nuevo `mail/`: transporte por API del proveedor elegido (D12), plantilla de correo, adjunto, webhook de rebotes.
- Generador de PDF con contraseña (por ejemplo `pdfkit`, que cifra con AES), al momento, sin guardar el archivo.
- Endpoints para la página pública: validar token, verificar fecha de nacimiento con límite de intentos, devolver el resumen descifrado y el PDF.
- `RetentionService`: purga del contenido a los 30 días; los metadatos se quedan 365 días, como la bitácora del rastreo.
- Nunca se escribe el contenido clínico en los registros (logs).

### 4.6 Web (`apps/web`)

- Página pública `/resumen/[token]` (patrón de la encuesta).
- Panel, Conexión con el hospital → «Resumen de la atención» (ORG_ADMIN): interruptor, piloto, exclusiones, horario, pie, y el estado de la plantilla y del correo.
- Seguimiento de envíos (ORG_ADMIN y BOOKING_AGENT): por atención, si salió, por dónde, si lo abrió o por qué no salió; **nunca el contenido**. «Reenviar» a pedido del paciente, tras verificar su identidad en ventanilla.

### 4.7 Servidor y operación

- Variables del proveedor de correo; registros DNS (SPF, DKIM, DMARC) del dominio remitente.
- Sin cambios en el Caddy si la página habla con la API por la red interna; si el proveedor de correo avisa rebotes por webhook, esa ruta sí necesita su `handle` en el Caddy real (ver memoria del servidor).
- `mirror-schema-check.service.ts`: agregar todas las columnas nuevas que lea el agente.
- Orden de despliegue: migración → API → agente → web.

### 4.8 Documentación

- `docs/conocimiento/AGENIA.md`: tema nuevo en la Parte 1 (con el mismo título que la opción del menú), sección en la Parte 2 (y decidir si la lee el asistente de soporte, `PARTE2_PARA_EL_ASISTENTE`), bitácora y fecha.
- `MAPEO_HIS.md`: sección nueva con el mapeo de la historia clínica; `esquema-real.tsv`: las tablas nuevas.
- `RUNBOOK.md` del driver: qué hacer si no salen resúmenes, si rebotan los correos o si el hospital pide apagarlo.

## 5. Seguridad, privacidad y marco legal

- **Datos sensibles.** La historia clínica es dato sensible (Ley 1581 de 2012) y reservada (Resolución 1995 de 1999). El hospital es el responsable y AgenIA el encargado. **El contrato de tratamiento de datos vigente se firmó para citas**: hay que ampliarlo a historia clínica antes de leer una sola fila real.
- **Aprobación del hospital.** El comité de historias clínicas aprueba qué secciones van, la lista de exclusiones y el texto del pie; el área jurídica decide si basta la baja (opt-out) o se necesita autorización previa (D8).
- **Mínimo necesario.** Solo las columnas del resumen; el contenido se guarda cifrado 30 días y se borra; ni el WhatsApp ni el cuerpo del correo llevan datos clínicos; nada pasa por una IA.
- **Acceso.** Enlace imposible de adivinar, verificación con fecha de nacimiento, límite de intentos, bitácora de cada apertura, PDF con clave.
- **Error de destinatario.** Es el riesgo principal (celular desactualizado, compartido o de un familiar). El diseño hace que ese error revele solo «tiene un resumen».
- **Interoperabilidad oficial.** Esto no reemplaza el envío del RDA al Ministerio (Resolución 866 de 2021) que hace el HIS; es un servicio al paciente.

## 6. Pruebas

- Unitarias del mapeo del driver contra filas reales anonimizadas de la prueba en PRUEBAS (`HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql`, §8.1): su P-2 es el prototipo de la consulta del agente y su P-5, el de las reglas de envío; el código debe dar lo mismo.
- Mock del HIS (`apps/mirror-agent/local-his-mock`) con las tablas nuevas; `scripts/verificar-esquema-mock.mjs` contra `esquema-real.tsv`.
- API: exclusiones, baja, destinatarios (incluido el teléfono de otro documento), horario, idempotencia, cifrado, purga, límite de intentos, que el contenido no aparezca en logs.
- Postgres real (Docker) para la migración, con cero deriva.
- Envío real a teléfonos y correos del equipo antes del piloto: plantilla aprobada, botón, PDF que abre con la clave, llegada a Gmail y Outlook.
- **Revisión clínica:** el hospital compara 20 resúmenes contra la pantalla del HIS, campo por campo, antes de enviarle uno a un paciente.

## 7. Decisiones por aprobar

| # | Decisión | Recomendación |
|---|---|---|
| D1 | ¿Qué atenciones? | Una **lista de servicios** que configura el hospital, dentro de la consulta ambulatoria (`TX_TIPO_HICL = 'CON'` sin registro de ingreso). La lista es necesaria porque la consulta de urgencias (`S39145`) también llega sin registro. **Piloto: medicina general y control de hipertensos** (`S39141`, `S39141-1`: 2.937 al mes; 68 % y 99 % con medicamentos). Después: lectura de exámenes (`EVC` `890201-LE`), medicina interna, pediatría, nutrición, dermatología, ginecología y PyDT. Nunca: urgencias, hospitalización, enfermería, odontología, psicología, psiquiatría. |
| D2 | ¿Qué secciones? | Las de §3.2: motivo, diagnósticos, plan, recomendaciones, medicamentos, exámenes, incapacidad, remisiones, próximo control y educación. Sin enfermedad actual, análisis, examen físico, antecedentes ni signos vitales (están sucios). Los campos de texto, por plantilla, según la tabla de R4-5 en `MAPEO_HIS.md` §2.9. El «plan» es lo que el médico escribió para la historia, no para el paciente: el comité lo revisa en los 20 casos de la Fase 1 antes de aprobarlo. |
| D3 | ¿El contenido viaja en el mensaje o detrás de un enlace? | WhatsApp: aviso + botón al enlace. Correo: aviso + enlace + PDF con clave. |
| D4 | ¿Cómo se verifica en el enlace? | Fecha de nacimiento completa, 5 intentos, bloqueo de 1 hora. |
| D5 | ¿Al celular del HIS de quien nunca escribió al asistente? | Sí, si es celular y no está asociado a otro documento en AgenIA. |
| D6 | ¿Menores de edad? | Al contacto del acompañante o al WhatsApp que agendó; si el hospital duda, fuera del piloto. |
| D7 | ¿Exclusiones sensibles? | La lista de §3.7, configurable; la valida el comité. Con datos reales deja fuera ~6 % de las consultas, casi todas de salud mental: el comité puede preferir excluir los servicios de psicología y psiquiatría y no todo código F (el F41.2, ansiedad y depresión mixta, sale en consultas de medicina general). |
| D8 | ¿Baja o autorización previa? | Lo decide jurídica del hospital. Técnicamente se soportan las dos; propuesta: baja inmediata por WhatsApp y en ventanilla. |
| D9 | ¿Cuándo se envía? | 2 horas después de guardada la historia (no hay marca de cierre; la última orden observada llegó a los 116 min), entre 7:00 y 20:00. |
| D10 | ¿Correcciones posteriores? | El enlace muestra la última versión; no se reenvía el aviso. |
| D11 | ¿Cuánto se guarda en la nube? | Contenido cifrado 30 días; metadatos 365 días. |
| D12 | ¿Proveedor y remitente del correo? | Un proveedor con API (Amazon SES, Brevo o Resend) y un subdominio con DKIM; remitente «Hospital San Vicente de Paúl» o, si el hospital administra su DNS, su propio dominio. |
| D13 | ¿IA para explicar el resumen? | No en esta versión. |
| D14 | ¿Quién ve los envíos en el panel? | ORG_ADMIN y BOOKING_AGENT, sin contenido; el médico no. |
| D15 | ¿Quién paga los mensajes de WhatsApp (plantilla Utilidad, cobro por mensaje)? | Decisión comercial; el número de envíos sale de la Fase 0. |
| D17 | ¿Cómo se consiguen los correos, si el del HIS es de relleno en el 97 % de los casos? | Que el asistente pregunte, con autorización, «¿quiere recibir sus resúmenes también por correo?» (al agendar y con el primer resumen); y pedirle al hospital que en admisión deje vacío el correo en vez de poner el de relleno. Mientras tanto, el correo sale solo a quien tenga uno propio. |
| D18 | ¿Qué le dice el resumen sobre dónde reclamar cada medicamento? | Depende de confirmar `AI`/`AE` con la farmacia del hospital. Si es interna/externa: «Farmacia del hospital» o «Dispensador de su EPS», con las fechas de cada entrega posfechada. |
| D19 | ¿Cómo se muestra la dosis? | La indicación escrita por el médico, tal cual (89 % de los renglones). Nunca la cantidad ni la unidad por dosis estructuradas: la unidad se queda en «mg» (código `168`) cuando el médico quiso decir «1 tableta». Tampoco el texto que arma el HIS. Si no hay indicación (11 %): nombre, cantidad total, duración y «tómelo como se lo explicaron en la consulta»; la frecuencia estructurada («cada 24 horas», catálogo `PAC_CONFIG_HIS` 37) solo si el comité la aprueba, porque también puede contradecir al médico. |
| D16 | ¿Leer las tablas o ejecutar `SP_INTEROPERABILIDAD_IHC_V2`? | **Leer las tablas** replicando su lógica. El procedimiento puede registrar o transmitir al Ministerio al ejecutarse, y pedir `EXECUTE` sobre código del proveedor es un permiso más amplio. |

## 8. Fases

| Fase | Qué | Termina cuando |
|---|---|---|
| **0. Descubrimiento** | Correr `sql/HISTORIA_CLINICA_DESCUBRIMIENTO_SOLO_LECTURA.sql` y `sql/HISTORIA_CLINICA_ESTADISTICA_SOLO_LECTURA.sql`; leer el código de `SP_INTEROPERABILIDAD_IHC_V2`; prueba manual en PRUEBAS con `sql/HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql` (protocolo E1-E7 y bloques P-0 a P-7). Rondas 2 a 4 si hace falta. | Mapeo completo en `MAPEO_HIS.md`, cifras reales de volumen y contacto, D1-D16 aprobadas, contrato ampliado, comité de HC de acuerdo, permisos concedidos. |
| **1. Lectura en sombra** | Capacidad del agente, endpoint, guardado cifrado. No se envía nada. | El hospital revisa 20 resúmenes contra el HIS sin errores; la consulta del agente pesa poco en el HIS (medida). |
| **2. Página y PDF** | `/resumen/[token]`, verificación, PDF con clave. Solo el equipo genera enlaces de prueba. | Pruebas en celulares reales. |
| **3. Correo** | Proveedor, DNS, plantilla de correo, rebotes. | Correos de prueba en Gmail y Outlook que no caen en spam. |
| **4. WhatsApp** | Plantilla aprobada por Meta, botón con enlace, Telegram, baja. | Envíos de prueba al equipo. |
| **5. Piloto** | Medicina general (o un médico), 2 semanas, horario hábil. | Entregados, abiertos, bajas, quejas y errores medidos; el hospital decide ampliar. |
| **6. Ampliación** | Más especialidades, con la lista de exclusiones; AGENIA.md, runbook. | — |

### 8.1 Fase 0 en detalle: qué responde cada bloque

**`HISTORIA_CLINICA_DESCUBRIMIENTO_SOLO_LECTURA.sql`** (ronda 1; solo lectura, probado contra un SQL Server de prueba con el nivel de compatibilidad de 2017):

| Bloque | Qué responde | Decide |
|---|---|---|
| HC-0 | ✅ Corrido el 2026-10-28 (§2.1). Ahora verifica esas columnas y calcula desde qué `NU_NUME_HICL` leer para cubrir 90 días, para que los demás bloques no recorran la tabla entera | Todo lo demás |
| HC-1 | Inventario de tablas con nombre clínico (fórmula, órdenes, diagnósticos, CIE, incapacidades…), con filas y última escritura | Dónde buscar |
| HC-2 | Esquema completo de `HISTORIACLINICA`, índices, tamaño, disparadores, Change Tracking | Cursor del agente; costo de leerla |
| HC-3 | Qué tablas cuelgan de la historia (por nomenclatura y llaves foráneas) y sus columnas | Mapeo de medicamentos y exámenes |
| HC-4 | El código de interoperabilidad del proveedor, sus parámetros, si se ejecuta, qué tablas usa y para qué especialidades se arma el RDA | El atajo del mapeo; D16 |
| HC-5 | Perfil de 60 días: valores de los códigos (estado, firma, tipo de atención), largo de los textos, y qué fecha es la de cierre y cuánto tarda | §3.1 (cuándo enviar); D1 |
| HC-6 | Cómo se une la historia con la cita; si una atención es una fila o varias; cuántos minutos después de la hora de la cita se escribe; especialidad y servicio de la cita; cargo del médico y hora del día, con y sin cita (separa la consulta externa de lo demás); y de paso, cuántas citas en estado 2 dejan historia (cierra I.12 de `ESTADO.md`) | Enlace con `Appointment`; D1; D9; «estado 2 = no asistió» |
| HC-7 | De los pacientes con historia en 90 días: con celular, con correo, menores, correos de relleno, dominios | D5, D6, D12; cuántos recibirían |
| HC-8 | Qué puede leer hoy `agenia_sync` | La solicitud de permisos |
| HC-9 | **Solo en PRUEBAS**, con un paciente de prueba: todas las filas que dejó una atención completa | El mapeo exacto, campo por campo |

**`HISTORIA_CLINICA_RONDA2_SOLO_LECTURA.sql`** (tras la ronda 1): esquema e índices de las tablas de contenido; qué es cada tipo de historia, cuál es el estado «cerrada», qué trae cada tipo, qué tipo de orden son los medicamentos; diagnósticos y cuántas atenciones tienen uno sensible (D7); el código que crea y cierra la historia; los conceptos de plantilla que son motivo, plan y recomendaciones; y el segundo nivel de la atención de prueba (PRUEBAS).

**`HISTORIA_CLINICA_RONDA3_SOLO_LECTURA.sql`** (tras la ronda 2): qué significa el estado de la historia, cuándo se guarda respecto a la cita y si las órdenes llegan después (decide la espera de §3.1), qué son las órdenes `AI`/`AE` y cómo se ve una fórmula real sin paciente, qué son las órdenes 1-4, qué campos de la plantilla de consulta se llenan (motivo, enfermedad actual, plan…), la lista de servicios para D1, el contacto de los pacientes de consulta ambulatoria y fragmentos del código de interoperabilidad.

**`HISTORIA_CLINICA_RONDA4_SOLO_LECTURA.sql`** (corta, tras la ronda 3; ✅ corrida el 2026-10-28): confirma que el estado 1 es «tiene exámenes», traduce los códigos de la fórmula (unidad de dosis, frecuencia, vía), muestra cómo se lee la dosis en 8 renglones sin paciente, mide las series posfechadas, lista los campos útiles de todas las plantillas de consulta y trae los fragmentos del código de interoperabilidad que se cortaron en R3-9. **R4-7** (agregado después) lee los dos catálogos de la fórmula que nombra el código del proveedor.

**`HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql`** (solo en `PRUEBAS`; en cualquier otra base se detiene sin leer nada; solo lee pacientes cuyo primer apellido contiene «PRUEBA»). Trae el protocolo que hace el hospital en la aplicación (E1 consulta externa completa con un examen agregado 10 minutos después; E2 control de hipertensos; E3 corrección y anulación de un medicamento; E4 entrega en farmacia; E5 urgencias, psicología y un F41.2, que no deben enviarse; E6 un menor; E7 el papel impreso) y siete bloques:

| Bloque | Qué comprueba | Decide |
|---|---|---|
| P-0 | Configuración: documentos de prueba (rechaza a cualquier paciente real), fecha, alcance, correos de relleno y la lista de campos de plantilla que van al resumen, con los nombres exactos de R4-5 | — |
| P-1 | Las historias de los pacientes de prueba, con plantilla, médico, ámbito e «historia padre» | Cómo aparece una corrección (D10) |
| P-2 | **El resumen tal como lo armaría el agente**: diagnósticos con marca de sensible, medicamentos agrupados por artículo con sus entregas, renglones crudos (cuáles quita el filtro del RDA), exámenes con minutos después de guardar, recomendaciones, incapacidad, remisión, interconsulta y los campos de plantilla marcados | El mapeo campo por campo; D2, D18, D19 |
| P-3 | Tiempos de las órdenes y lo que registró la auditoría del HIS (por documento o número de historia) | D9; si la corrección y la entrega dejan rastro |
| P-4 | Dos huellas SHA-256 por historia: la del resumen (lo que ve el paciente) y la de estados (farmacia, toma de examen). Se corre antes y después de E3 y E4 | D10: cuándo el enlace dice «actualizado» |
| P-5 | **¿Se enviaría?** Las reglas aplicadas a cada historia: alcance, corrección, diagnóstico sensible, celular del paciente o del acompañante, correo propio o de relleno, hora de envío | D1, D5, D6, D7, D9, D17 |
| P-6 | Lecturas y tiempo de la vuelta del agente y del resumen de una historia (`SET STATISTICS IO, TIME`) | Carga en el HIS |
| P-7 | Columnas que usa el prototipo, si existen, qué lee hoy `agenia_sync` y el texto `GRANT SELECT (columnas)` por tabla para TI (no lo ejecuta; `INTER_RES1888` fuera) | La solicitud de permisos |

Probado el 2026-10-28 contra un SQL Server de prueba (compatibilidad 2017) con el esquema real y los escenarios E1-E6 simulados: el paciente real se rechaza; el medicamento anulado y el que no tiene unidad de venta no salen; el losartán de 90 días sale una vez con tres fechas; urgencias, psicología, F41.2, la nota de enfermería y la corrección dan «No» con su motivo; las de la noche pasan a las 7:00; tras la entrega en farmacia cambia solo la huella de estados y tras la corrección cambia la del resumen.

**`HISTORIA_CLINICA_MENSAJES_SOLO_LECTURA.sql`** (en `ESEHSVP`; solo conteos y tamaños): mide mes por mes desde abril, para el piloto y para la consulta externa sin urgencias, lo que hace falta para contar los mensajes de un mes: M-1 consultas, pacientes y consultas por día hábil; M-2 lo que anotó el médico (campos llenos, KB de texto, KB que irían al informe, recomendaciones, diagnósticos); M-3 fórmulas (consultas con fórmula, farmacia del hospital o externa, órdenes con entregas posfechadas, medicamentos); M-4 exámenes por tipo, remisiones, incapacidades e interconsultas; M-5 pacientes con celular y con correo propio, y diagnósticos sensibles; M-6 consultas por día de la semana y en festivos. Probado el 2026-10-28 en un SQL Server de prueba con intercalación `Modern_Spanish_CI_AS` en la base y otra en el servidor (las tablas # con texto usan `COLLATE DATABASE_DEFAULT`; el script de PRUEBAS se corrigió igual: sin eso, sus cruces fallaban con el error 468). ✅ Corrido el 2026-10-28: el informe muestra sus cifras (sección «Noviembre»). Hallazgos: no hay consulta los lunes y el sábado se atiende a los campesinos; el piloto tiene 77 campos llenos y 4,2 KB de texto por consulta, de los que ~0,75 KB irían al informe; 66 % con fórmula y 62 % con exámenes (~4,7 por consulta, casi todos de laboratorio); 94,7 % con celular, 3,1 % con correo propio, 5,6 % sensibles. 🔴 El filtro de unidad de venta del RDA deja fuera los medicamentos externos `AE` (§3.2). Julio: aparece la indicación del médico en los medicamentos y baja lo que va al informe (¿plantilla nueva?).

**`HISTORIA_CLINICA_MENSAJES_2_SOLO_LECTURA.sql`** ✅ corrido el 2026-10-28. M-7: sin el filtro de unidad de venta, el 79 % de las consultas del piloto tiene fórmula (66 % con él); el 53 % lleva medicamentos externos `AE` y el 19 % de las fórmulas son solo externas; del 87 al 100 % de los renglones `AE` no tiene unidad de venta; casi ningún renglón está anulado (`NU_ESTA_HMED = 0`: 0-1 al mes), así que el HIS parece borrar en vez de anular (lo confirma E3 en PRUEBAS). M-8: el piloto solo usa las plantillas 870 y 844, sin plantilla nueva; la baja de julio de lo que va al informe es de la 844 (1,3 → 0,6 KB). En la consulta externa sin urgencias, el 18 % de las consultas usa plantillas sin campos en la lista (odontología, planificación familiar, dermatología, pediatría…): D2 tiene que elegir sus campos antes de ampliar.

**`HISTORIA_CLINICA_PLANTILLA_844_SOLO_LECTURA.sql`** (sin correr; probado): compara campo por campo las plantillas 844 y 870 entre abril-junio y agosto-octubre, para saber qué campo de la 844 cambió en julio.

**Estado de la Fase 0 (2026-10-28):** el mapeo técnico está completo, catálogos incluidos (`MAPEO_HIS.md` §2.9; R4-7 corrido), y la estadística también (§9; informe en `docs/drivers/cnt-sanvicente-anserma/evidencia/ESTADISTICA_HISTORIA_CLINICA_2026-10-28.html`). Faltan: la prueba manual en PRUEBAS (`HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql`), las respuestas del hospital (`AI`/`AE` y dónde se reclaman las entregas, el correo de relleno, las credenciales de `INTER_RES1888`) y las decisiones D1-D19.

**`HISTORIA_CLINICA_ESTADISTICA_SOLO_LECTURA.sql`**: historias por mes de los últimos 6 meses (más el mes en curso), cuántas de ellas con cita ese día (la consulta externa, que es lo que se enviaría), pacientes, médicos y promedio por día; tamaño de la tabla; KB estimados (E-2) y exactos byte a byte (E-3) por mes, con cuánto de eso es texto largo; las mismas cifras para las tablas hijas `NU_NUME_HICL_xxxx` (E-4); el reparto por cargo del médico (E-2b) y por especialidad de la cita, indicando cuáles generan RDA (E-2c). Lee desde una frontera de `NU_NUME_HICL`; con `@recorrido_completo = 1` da lo mismo recorriendo toda la tabla (verificado en el HIS falso). Como la cabecera pesa ~0,1 KB, **E-5** pesa la atención completa (cabecera + órdenes + medicamentos + procedimientos + indicaciones + texto de plantilla + diagnósticos) sobre las historias de 7 días, por tipo, y **E-6** da los KB de cada mes con ese peso; una tabla de más de 2 millones de filas sin índice por su enlace se omite y lo dice.

## 9. Volumen y costo

Estadística corrida en `ESEHSVP` el 2026-10-28 (E-1 a E-6). Promedios de abril a septiembre de 2026; octubre va hasta el 27. Informe interactivo: `docs/drivers/cnt-sanvicente-anserma/evidencia/ESTADISTICA_HISTORIA_CLINICA_2026-10-28.html`.

| Dato | Fuente | Valor |
|---|---|---|
| Historias por mes (todas) | E-2 | **15.051** (13.700 en abril → 16.543 en septiembre, +21 %): consultas 6.307, notas de enfermería 4.407, evoluciones 2.369, procedimientos 1.791 |
| Consultas por mes | E-2d | 6.307; ambulatorias 5.309; **sin urgencias 4.290**; **piloto `S39141` + `S39141-1`: 2.814** (2.622 a 3.189) |
| Pacientes distintos por mes | E-2 | 5.394 |
| Pacientes con celular / con correo propio | R3-7 | 95 % / ~1,4 % (el 97 % tiene el correo de relleno del hospital) |
| Menores de edad / con celular del acompañante | R3-7 | 18,5 % / 90 % de ellos |
| Consultas que se excluirían por diagnóstico sensible | R2-2 (f) | ~6 % (~330 al mes) |
| KB de la cabecera | E-1, E-3 | 0,05 KB de datos por historia (0,1 KB con la página) + 1,7 KB de índices; la tabla ocupa 3,9 GB, casi todo índices |
| KB de una atención completa en el HIS | E-5, E-6 | **3,58 KB por historia** (consulta 6,28 KB; nota de enfermería 1,15 KB); casi la mitad es texto largo de plantilla. **54 MB al mes**, ~650 MB al año |
| Resúmenes al mes | E-2d × reglas | Piloto ~2.800; sin urgencias ~4.300; menos ~6 % sensibles y ~5 % sin celular |
| Resumen guardado en AgenIA | estimado | 3-10 KB por atención en JSON cifrado: piloto 8-28 MB al mes, que con la retención de 30 días (D11) es todo lo que hay guardado a la vez |
| PDF adjunto | estimado | 40-120 KB por correo |
| Mensajes de WhatsApp por mes | E-2d × % con celular | Piloto ~2.500, sin urgencias ~3.800, × tarifa vigente de Meta para plantillas de Utilidad en Colombia |
| **Noviembre (proyección)** | `HISTORIA_CLINICA_MENSAJES_SOLO_LECTURA.sql` y `_2` (medido), informe | Consulta martes a sábado (los lunes no se atiende; el sábado es de los campesinos, ~16 % de las consultas). Piloto: 132 consultas por día de martes a viernes y 107 los sábados → **~2.650 consultas** en noviembre (16 días de martes a viernes + 4 sábados): 2.501 informes, **1.987 fórmulas** (79 %, con los externos `AE`; 4,1 medicamentos cada una) y 1.554 órdenes de exámenes (62 %). Un mensaje por documento: **~5.720 WhatsApp** (211 MB con PDF de 45/35/30 KB; ~6 MB con enlace) y ~190 correos (3,1 % con correo propio). Consulta externa sin urgencias: ~4.060 consultas, ~7.670 WhatsApp |
| Lectura del agente en el HIS | E-5 | Una consulta completa pesa 6,28 KB: ~18 MB al mes en el piloto, ~27 MB sin urgencias (menos, porque el agente lee solo las columnas del resumen). La carga real (lecturas lógicas) la mide P-6 en PRUEBAS |

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Destinatario equivocado | Sin datos clínicos en el mensaje; verificación; teléfono de otro documento no se usa |
| Error de contenido (dosis, diagnóstico) | Sin IA; copia fiel del HIS; revisión clínica de 20 casos; el pie aclara que no reemplaza la fórmula oficial |
| El proveedor cambia el esquema sin aviso | Chequeo de esquema con todas las columnas leídas; si falla, el resumen se detiene y avisa (no envía algo incompleto) |
| Carga en el HIS | Cursor incremental, tope de filas, lectura sin bloqueos, fuera de la ventana de 02:15-03:00 |
| Correos en spam | DKIM/SPF/DMARC, dominio con reputación, rebotes |
| El correo del HIS es de relleno (97 %) | Lista configurable de correos de relleno; correo solo propio o dado por el asistente (D17) |
| Un medicamento repetido (series posfechadas, o el mismo con tres nombres: «ROSUVASTATINA 40 MG», «ROSUVASTATINA TAB 40 MG»…) | Agrupar por código de artículo (`CD_CODI_ARTI_HMED`) y mostrar las fechas de entrega juntas |
| Una dosis mal dicha (la estructura del HIS contradice la indicación del médico) | Mostrar la indicación del médico tal cual; nunca el texto generado por el HIS (D19) |
| El plan del médico no está escrito para el paciente (abreviaturas, términos técnicos, notas para colegas) | Revisión del comité en la Fase 1; un pequeño glosario al pie (VO = por la boca, TAB = tableta…); sin IA |
| Historia enviada antes de terminarla | Solo cerradas + tiempo de calma |
| Alcance legal | Contrato ampliado y aprobación del comité antes de leer datos reales |
| Costo de WhatsApp | Se conoce con la Fase 0 antes de encender; el correo y Telegram no cuestan por mensaje |

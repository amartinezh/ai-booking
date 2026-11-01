# Resumen de la atención al paciente por WhatsApp y correo

**Estado:** propuesta del 2026-10-28. Fase 0 (descubrimiento en el HIS) casi completa. 2026-11-01: el hospital documentó los reportes que imprime el HIS. Los documentos llegan en PDF e imagen, para imprimir (§3.9), y sus decisiones son D20-D25. Ese mismo día se corrieron las rondas 5 y 6 (documentos), y el usuario aprobó D3, D11, D13, D16 y D23. Se puede empezar el desarrollo (§8.2). **Fase 1 (lectura en sombra) implementada el 2026-11-01 (commit 3584864), y ese mismo día la revisión contra el HIS y la medición de la carga (§8.3, commit 2c2ffbd). Fase 2 (documentos en PDF e imagen y página del paciente) implementada el mismo día, sin commit (§8.4). Nada desplegado.** Todo nace apagado; no se le envía nada a ningún paciente.
**Primer hospital:** San Vicente de Paúl de Anserma (driver `cnt-sanvicente-anserma`).

## 1. Qué se pide

Cuando un médico termina la historia clínica en el HIS del hospital (CNT), el paciente recibe por **WhatsApp** y por **correo electrónico** un resumen completo de su atención:

- el resumen de la atención (motivo, diagnóstico, plan y recomendaciones del médico);
- la lista de **medicamentos** formulados (nombre, dosis, frecuencia, duración, cantidad);
- la lista de **exámenes** y procedimientos ordenados (laboratorio, imágenes, otros);
- y, si los hay, incapacidad, remisiones o interconsultas y la cita de control.

**Formato (2026-11-01):** cada documento llega en **PDF y en imagen**, con un formato que permite imprimirlo. Son los que el HIS imprime hoy para el paciente, con los mismos campos: fórmula, orden de exámenes, remisión e incapacidad. Se suma el resumen de la atención, que el HIS no imprime (§3.9).

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
| ✅ **Reportes del HIS (documentación del hospital, 2026-10-30):** fórmula (`infOrdenMedHC.rpt`), orden de ayudas diagnósticas (`infOrdenADh.rpt`), remisión (`infRemiPac.rpt`), interpretación, indicaciones e historia. Todos llevan el mismo encabezado («Registro de Calidad») y la firma del médico como imagen. | `MAPEO_HIS.md` §2.9, «Reportes del HIS» | Casi todos sus campos ya están en columnas conocidas: se pueden reproducir (§3.9). Faltan la firma, los datos del hospital, la vigencia y qué columna imprime cada dosis (ronda 5 y P-8). |
| 🔴 Las casillas de «CONDUCTA» de la plantilla dicen «Medicamentos: NO, Laboratorio: NO, Remisiones: NO» en una consulta que formuló, pidió laboratorio y remitió. | Remisión de ejemplo | Lo que va al paciente sale de las órdenes, nunca de esas casillas. |
| 🔴 La fórmula impresa trae, probablemente, el texto de dosis que arma el HIS (`DE_DOSIS_HMED`, el de «1 mg» por «1 cápsula») y la cantidad en letras en inglés («1 (ONE)»). | Fórmula de ejemplo, R4-3 | Si E7 lo confirma, el papel de hoy ya trae el error: avisarle al hospital. AgenIA no lo copia (D19). |
| Las indicaciones (`HIST_INDI`) son órdenes a enfermería en urgencias y hospitalización. | Indicaciones de ejemplo | No van al paciente sin antes medir qué son en consulta externa (D-7). |
| La remisión guarda en `HIST_REMI` una foto de todo lo que imprime, incluida la «descripción del caso clínico», que copia la historia de la consulta (varias páginas). | Remisión de ejemplo | Enviarla completa es enviar la historia (D24). |
| ✅ **Ronda 5 (2026-11-01):** el encabezado sale de `ENTIDAD`, con su logo en `ENTIDAD.IM_LOGO_ENTI`. La firma está en `USUARIOS.IM_FIRMA_USUA` (288 de 650 usuarios, ~393 KB cada una). El CUM y el Invima salen de `ARTICULO`, pero el 88 % de los externos `AE` no está ahí. Toda fórmula dice «Vigente por 72 Horas», también las posfechadas. El código de examen ya es el CUPS. La EPS y el tipo de usuario salen del convenio de la atención. | `MAPEO_HIS.md` §2.9, «Ronda 5» | Los documentos se pueden armar campo por campo. Solo falta cómo se une la firma con el médico (ronda 6). |
| 🔴 **Lo que se imprime hoy (registro de impresiones, piloto, 30 días):** la historia en el 96 % de las consultas y la remisión en todas las que la tienen, pero **la fórmula solo en el 3 % y las órdenes de exámenes en el 2 %**. | D-1 | La farmacia y el laboratorio del hospital trabajan con la orden en el sistema. Para el paciente, la fórmula y las órdenes en el celular son **nuevas**: hoy casi nunca se lleva ese papel. Falta saber para quién es la historia impresa y cómo reclama los externos (ronda 6 y hospital). |
| 🎯 **~89 % de las remisiones son al mismo hospital** («HSVP ANSERMA», «HSVPA»…), con el CUPS de la consulta pedida estructurado (medicina interna, nutrición, oftalmología…). | D-6 | D24: sin el caso clínico en la gran mayoría. Además, fuera de este plan: el asistente podría ofrecer agendar esa cita. |
| ✅ En consulta externa, las indicaciones (`HIST_INDI`) **son para el paciente**: «control en 3 meses con resultados», valoración por salud oral, vacuna de la influenza, terapias. En urgencias son para enfermería. | D-7 | Van al resumen como «Indicaciones del médico» (§3.2). |
| ✅ **Ronda 6 (2026-11-01):** el médico imprime **la historia y la remisión al terminar la consulta** (misma sesión, 3-4 minutos después). La fórmula y las órdenes de exámenes **no se le entregan al paciente en la consulta**: alguien más las reimprime días después en el 2-3 % de los casos. | `MAPEO_HIS.md` §2.9, «Ronda 6» | Recibir la fórmula y las órdenes en el celular es nuevo para el paciente. Hay que saber para quién es la historia impresa (D2) y cómo reclama hoy los externos (D21). |
| ✅ Firma: `USUARIOS.IM_FIRMA_USUA`, unida por documento con `MEDICOS` (35 de 35). La tienen los 19 médicos del piloto, pero en BMP sin comprimir (~1 MB, hasta 9,6 MB). `USUARIOS` también guarda contraseñas (`PS_PASS_USUA`). | E-2 | D22. Si se usa la imagen, el permiso se limita a dos columnas. |
| ✅ Encabezado: el 100 % de las consultas tiene convenio (`CONVENIOS.CD_CODI_CONV`: «SUBS», «STOTALSUBS»…), EPS y tipo de usuario («Subsidiado», «Contributivo cotizante»). ~76 % del piloto es del régimen subsidiado. | E-3 | Encabezado completo. Lenguaje sencillo e imágenes importan. |
| 🎯 **99 % de las remisiones son al mismo hospital**, a más de 20 especialidades (medicina interna, nutrición, oftalmología, pediatría, ortopedia…). 🔴 ~8,5 % son a psiquiatría, psicología o psiquiatría pediátrica. | E-4 | D24: la remisión va sin el caso clínico. D7: excluir las remisiones a salud mental. |

### 2.2 Lo que ya tiene AgenIA y se reutiliza

- **Agente espejo con capacidades opcionales** (`apps/mirror-agent/src/core/driver.interface.ts`): avisos masivos, consulta en vivo e importación de citas son interfaces *opt-in* que un driver implementa si puede. Esta función es una más; un segundo hospital no queda obligado a tenerla.
- **Aviso al paciente por un hecho del hospital** (`apps/api/src/mirror/aviso-cambio-hospital.service.ts`): ya decide WhatsApp con texto dentro de 24 h, plantilla fuera de la ventana, Telegram si el paciente usa Telegram, y nunca a un número marcado como de otra persona.
- **Página pública con enlace personal**: la encuesta (`apps/web/app/encuesta/[tokenId]`) llega por enlace y valida su token. Como es una página del panel que habla con la API por la red interna, no necesita ruta nueva en el Caddy (que es lista blanca solo para `/api/*`).
- **Cifrado de campos clínicos** (`apps/api/src/common/crypto/`, extensión de Prisma) y **retención automática** (`RetentionService`).
- **Plantillas de WhatsApp por clínica** (`WhatsappTemplateKind`, `TEMPLATE_CONTRACTS` en `@agenia/shared`, formulario de Configuración → WhatsApp).
- **Baja de mensajes** (`PatientProfile.remindersOptOut`, frases fijas sin IA).

### 2.3 Lo que falta

- **No hay envío de correo** en todo el sistema (no hay librería ni proveedor; `MirrorConflictAlert.emailSentAt` existe pero nunca se llena; el rastreo decidió «solo WhatsApp» en §12 #13).
- **No hay generador de PDF ni de imágenes** en ninguna app.
- El asistente ya **sube archivos a Meta y los envía**, pero solo audio (modo voz: `uploadToWhatsApp` y `sendWhatsAppAudioMessage` en `apps/api/src/chatbot/chatbot.service.ts`). Falta el mismo camino para documentos (PDF) e imágenes.
- El bot solo lee mensajes de texto y de audio. El toque en un botón de respuesta rápida de una plantilla llega como mensaje `button` (`button.text`, `button.payload`) y hoy se ignora.
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

El agente del hospital detecta las historias **terminadas**, arma el resumen y los documentos con datos del HIS y los sube **cifrados** a AgenIA. AgenIA le avisa al paciente por WhatsApp **sin datos clínicos en el aviso**. Cuando el paciente toca «Recibir mis documentos», le llegan al chat en **PDF y en imagen**; si su número no está verificado, antes confirma su fecha de nacimiento. El correo trae un solo PDF protegido con su número de documento, y el enlace sirve para volver a verlos o descargarlos (revisado el 2026-11-01: D3, D23).

```
HIS (ESEHSVP)                 Agente (VM del hospital)              AgenIA (nube)                        Paciente
─────────────                 ────────────────────────              ─────────────                        ────────
HISTORIACLINICA ─┐            cada 5 min: historias de hace 2 h
órdenes, fórmula ├─ SELECT ─▶ desde el último cursor  ── HTTPS ──▶  guarda cifrado (30 días)
remisión, dx ────┘            arma resumen y documentos (JSON)      decide: ¿se envía? ¿a quién?
PACIENTES (contacto)                                                 ├─ WhatsApp: aviso + botón ───────▶ toca «Recibir mis
                                                                     │  «Recibir mis documentos»         documentos» (y da su
                                                                     │  └─ ventana de 24 h abierta: ───▶ fecha de nacimiento
                                                                     │     PDF + imagen de cada uno      si hace falta)
                                                                     └─ Correo: aviso + PDF con clave ─▶ abre el PDF
                                                                        y el enlace                      o el enlace
```

### 3.1 Cuándo se considera terminada una historia

El HIS **no tiene marca de cierre** (ronda 3): guarda la historia una sola vez, cuando el médico termina, y en los minutos siguientes escribe las órdenes (mediana 2 min, p99 25 min, máximo visto 116 min). Por eso la regla es **«2 horas después de guardada»** (`FE_FECH_HICL` + 2 h): a esa hora ya están las órdenes, los medicamentos, las indicaciones y la remisión. Una orden que llegue después de enviado el resumen aparece en el enlace, que siempre muestra lo vigente.

Si el médico la corrige después (nota aclaratoria), el enlace muestra siempre la **última versión** con «actualizado el …». En la primera versión no se reenvía el aviso (D10).

### 3.2 Qué lleva el resumen

| Sección | Contenido | Fuente probable |
|---|---|---|
| Encabezado | Hospital, fecha y hora, servicio, especialidad, médico que atendió (nombre y registro) | `HISTORIACLINICA` (`FE_FECH_HICL`, `TX_CODSER_HICL` → `SERVICIOS`), `LABORATORIO.CD_CODI_ESP_LABO` → `ESPECIALIDADES`, `MEDICOS` (`CD_MED_REAL_HICL`: `NO_NOMB_MED`, `DE_REGI_MED`) |
| Resumen de la atención | Motivo de consulta, diagnósticos en palabras (el código CIE-10 al lado), plan o conducta tal como los escribió el médico | Texto: `DATOS_PLANTILLA_TEXT` / `_MEMO` por campo de la plantilla, con una **lista de campos por plantilla** que configura el hospital (`MAPEO_HIS.md` §2.9, tabla de R4-5). Piloto: 870 «Consulta externa» → motivo («MC:») y plan («CONDUCTA → Anotaciones»); 844 «Control crónicos» → conducta, próximo control, metas de educación y las casillas de educación (dieta, ejercicio…) en palabras. Diagnósticos: `R_LABO_DIAG` (`CD_CODI_DIAG_RLAD`, `ID_TIPO_DIAG_RLAD`) → `DIAGNOSTICO.DE_DESC_DIAG`, `TIPODIAGNOSTICO` (no el texto «Dx. Principal» de la plantilla) |
| Recomendaciones e indicaciones del médico | Lo que el paciente debe hacer: control, valoraciones pedidas, vacunas, terapias | El campo de plan de la plantilla y ✅ `HIST_INDI.DE_DESC_HIND`. En consulta externa es para el paciente (D-7: 23 % de las consultas del piloto, ~100 caracteres; «CONTROL EN 3 MESES CON RESULTADOS»). En urgencias y hospitalización son órdenes a enfermería, pero esas atenciones no se envían (D1). Nunca las casillas de «CONDUCTA» ni «Recomendaciones y Signos de alarma: SÍ/NO», que no dicen lo que pasó (§2.1) |
| Medicamentos | Nombre, forma, vía, cantidad, duración en días y **la indicación tal como la escribió el médico** («1 TAB VO EN LA NOCHE»); si no hay indicación (11 %), la dosis y la frecuencia estructuradas traducidas con sus catálogos. **Dónde reclamarlo** (farmacia del hospital o dispensador externo, si se confirma `AI`/`AE`) y **las fechas de las entregas posfechadas** (hoy, +30, +60…). Cada medicamento una sola vez. Se quitan solo los anulados (`NU_ESTA_HMED = 0`). 🔴 **No** se copia el otro filtro del RDA (renglones sin `NU_AUTO_UNVE_HMED`, unidad de venta): deja fuera casi todos los medicamentos externos `AE`, que el paciente igual tiene que reclamar (M-3, 2026-10-28: pasan de ~1.780 consultas con `AE` en 30 días a 2-132 al mes) | `HIST_ORDEN` (`NU_TIPO_HORD = 5`, `TX_TIAP_HORD`, `FE_POSFECHA`, `NU_ORDEN_FECHAPOS`) → `HIST_MEDI`: `NO_NOMB_ARTI_HMED`, `CD_CODI_ARTI_HMED` (para no repetir), `TX_FOFA_HMED`, `TX_VIAD_HMED`, `NU_CANT_HMED`, `TX_DURA_HMED` (días), **`TX_INDDOS_HMED`**; de respaldo, solo la frecuencia `NU_CTFREC_HMED`+`TX_CDFREC_HMED` (→ `PAC_CONFIG_HIS` tipo 37: minutos, horas, día, semanas, mes, año, según respuesta), si el comité la aprueba. **Nunca** `DE_DOSIS_HMED` ni `NU_CTDSIS_HMED`+`TX_UMDSIS_HMED`: la unidad se queda en mg (`168`) y sale «1 mg» por «1 cápsula» |
| Exámenes y procedimientos | Laboratorios (tipo 2), otros procedimientos y ayudas diagnósticas (tipo 4), consulta de control o con especialista (tipo 1), cirugía (tipo 3): nombre, cantidad, indicación | `HIST_ORDEN` (`NU_TIPO_HORD` 1-4) → `HIST_PROC` (`CD_CODI_SER_HPRO` → `SERVICIOS`, `NU_CANT_HPRO`, `DE_INDI_HPRO`) |
| Próximo control y educación | «Próximo control», metas de educación, dietas y ejercicio indicados (control de crónicos) | Campos de la plantilla 844 (R3-5, R4-5) |
| Otros | Incapacidad (días, desde, tipo), remisión (a qué servicio, prioridad), interconsulta. En el resumen, una línea por cada uno; el documento completo va aparte (§3.9) | `HIST_INCA`, `HIST_REMI`, `HIST_ORTIAT` (`CD_CODI_ESP_HOTA`) |
| Pie | «Este resumen es informativo. Para reclamar medicamentos o hacerse los exámenes use la fórmula y las órdenes que vienen con él» (texto que valida el hospital; depende de D21) y cómo comunicarse | Configuración |

**Nunca va:** anamnesis detallada, examen físico, antecedentes, revisión por sistemas ni notas internas del médico (salvo que el hospital decida otra cosa en D2).

**Sin IA:** el contenido sale tal como está en el HIS, ordenado por una plantilla fija. Resumir o «explicar en palabras sencillas» con IA puede cambiar una dosis o un diagnóstico y además enviaría la historia a un tercero. Queda fuera de este plan.

### 3.3 Cómo llega por WhatsApp

Revisado el 2026-11-01: los documentos llegan al chat en PDF y en imagen (D3, D23). La primera versión mandaba solo un botón con enlace.

1. **El aviso.** Es una plantilla de categoría **Utilidad** (nuevo `WhatsappTemplateKind`: `ATTENTION_SUMMARY_READY`), aprobada por Meta en la cuenta del hospital. Su texto es fijo, sin datos clínicos, y trae un **botón de respuesta rápida**:
   > *Hola {{1}}, el Hospital San Vicente de Paúl tiene listos los documentos de su consulta del {{2}}: resumen, fórmula y órdenes. Toque el botón para recibirlos aquí.* — [Recibir mis documentos]
2. **Al tocar el botón** se abre la ventana de 24 horas.
   - Si el número está **verificado** (el paciente ya se identificó con el asistente desde ese número), los documentos salen enseguida.
   - Si no lo está (el número viene del HIS y el paciente nunca escribió), el asistente pide primero la **fecha de nacimiento**, con 5 intentos como el enlace (D4).
3. **Cada documento llega dos veces**:
   - como **PDF** (mensaje de documento), con un nombre claro, p. ej. «Formula_28-oct_hoja-1-de-3.pdf»;
   - como **imagen** de cada hoja, para verla sin abrir nada o mostrarla en la farmacia.
   Al final va el enlace a la página (§3.5), para descargarlos otra vez.
4. **Por qué así:**
   - **Costo.** Con los precios de Meta vigentes desde julio de 2025, se paga la plantilla que abre la conversación; los mensajes dentro de la ventana de 24 h no se cobran. Queda **un mensaje pagado por consulta** (~2.500 al mes en el piloto), no uno por documento (~5.700, §9). La tarifa se confirma antes de encender.
   - **Destinatario equivocado.** El aviso solo dice «tiene documentos». Nada clínico sale sin el toque y, si el número no está verificado, sin la fecha de nacimiento.
   - **Sin enlace que abrir.** Lo que el paciente necesita llega al chat, listo para imprimir o reenviar a quien le reclama los medicamentos.
5. **Si no toca el botón** en 24 horas, no se insiste. Puede pedirlos después escribiéndole «mis documentos» al asistente, mientras duren los 30 días de D11.
6. **Dentro de una ventana ya abierta** (el paciente escribió hace poco), el aviso sale como mensaje libre con el mismo botón.
7. Si el paciente usa el asistente por **Telegram**, va por Telegram (§3.10).
8. Todo esto pasa solo si los interruptores lo permiten: general, WhatsApp y el del servicio de la consulta (§3.11).

**Lo que esto cambia:** los documentos quedan en el celular del paciente y pasan por la nube de Meta (la API de WhatsApp en la nube). El contrato con el hospital tiene que cubrirlo (§5).

### 3.4 Cómo llega por correo

- ⚠️ **De dónde sale el correo.** El del HIS casi nunca sirve: el 97 % de los pacientes tiene el correo de relleno del hospital (ronda 3). Se usa solo un correo que no esté en la lista de relleno configurada, o uno que el paciente dé por el asistente («¿quiere recibirlo también por correo?»), con su autorización (D17). En la práctica, al arrancar el correo llega a pocos pacientes y el canal principal es WhatsApp.
- Asunto y cuerpo sin datos clínicos («Resumen de su atención del 28 de octubre»), el mismo enlace y **un solo PDF adjunto con todos los documentos** (cada uno desde una hoja nueva), **cifrado con contraseña = su número de documento** (como los extractos bancarios en Colombia; el correo dice cuál es la clave sin escribirla). Sin imágenes: el correo se lee en computador o se imprime.
- Remitente con SPF, DKIM y DMARC configurados, para que Gmail y Hotmail no lo manden a spam.
- Se registran rebotes: un correo que rebota se marca y no se vuelve a usar.

### 3.5 La página del resumen

- Enlace único por atención (`/resumen/<token>`, 128 bits aleatorios), válido **30 días**.
- Pide la **fecha de nacimiento** completa. Cinco intentos fallidos bloquean el enlace una hora y queda anotado.
- Muestra el resumen y la lista de documentos, cada uno con «Descargar PDF» y «Ver imagen», más «Descargar todo». Los archivos se generan al momento; no se guardan.
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

### 3.9 Los documentos: PDF e imagen, para imprimir

Base: los reportes que documentó el hospital el 2026-10-30. El mapeo de cada campo a su columna está en `MAPEO_HIS.md` §2.9, «Reportes del HIS».

**Principio.** Los documentos llevan **el formato que el HIS ya usa**: los mismos campos, en el mismo orden y con las mismas etiquetas, para que la farmacia, el laboratorio y la EPS los reconozcan. A eso se suma el resumen de la atención. Lo que se cambia a propósito está en la última tabla. Rondas 5 y 6: al terminar la consulta, el médico imprime la historia y la remisión. La fórmula y las órdenes de exámenes no se imprimen en la consulta: solo se reimprimen días después en el 2-3 % de los casos. Tenerlas en el celular es **nuevo** para el paciente.

| Documento | Lo imprime hoy el HIS con (piloto, 30 días) | Uno por | Qué lleva |
|---|---|---|---|
| **Resumen de la atención** | — (nuevo) | Consulta | §3.2: motivo, diagnósticos, plan, indicaciones del médico, y una línea por medicamento, examen, remisión, incapacidad e interconsulta |
| **Fórmula médica** | `infOrdenMedHC.rpt` (en el 3 % de las consultas con fórmula) | **Orden**: la del día y cada posfechada son hojas aparte, cada una con su número y su «reclamar desde». ~2,4 órdenes por consulta, 2,9 medicamentos cada una (máximo 15) | Por medicamento: código, nombre, CUM e Invima (si está en el catálogo: casi nunca en los externos), medida, concentración, vía, cantidad en número y letras, forma farmacéutica, dosis y frecuencia (D19), duración, instrucciones; «Cantidad entregada: ____» para farmacia; diagnóstico principal; **«Vigente por 72 Horas»** |
| **Orden de exámenes** | `infOrdenADh.rpt` (2 %) | Orden: laboratorio (4,4 exámenes cada una) o procedimiento | Por examen: código (ya es el CUPS) y nombre, cantidad, indicaciones (ayuno…); diagnóstico principal |
| **Remisión** | `infRemiPac.rpt` (~100 % de las remisiones; la imprime el médico al terminar) | Remisión (31 % de las consultas; 99 % al mismo hospital) | A dónde, servicio pedido (CUPS), motivo, prioridad, diagnóstico, observaciones, afiliación. Sin la descripción del caso clínico si es interna (D24): una hoja |
| **Incapacidad** | por conocer (E7) | Incapacidad (1,7 %) | Días, desde, hasta, tipo, origen |

La interconsulta casi no existe en consulta externa (0,6 %): va como una línea del resumen, sin documento propio.

**No van:**
- las indicaciones de urgencias y hospitalización (son órdenes a enfermería);
- la interpretación de exámenes (en consulta externa el resultado se lee en la cita de control: fase posterior, cuando se ubique su tabla en D-10);
- la historia clínica completa (el paciente la pide en ventanilla; D2).

Las casillas de «CONDUCTA» no deciden nada: los documentos salen de las órdenes que existen.

**Formato.**
- **Hoja carta** (21,6 × 27,9 cm), márgenes de 1,5 cm, **en blanco y negro**, para que salga bien en cualquier impresora y en fotocopia. Letra de 10 puntos como mínimo: el HIS usa ~7 y en el celular no se lee.
- **Encabezado:** logo, nombre, NIT, dirección y teléfono del hospital. Salen de `ENTIDAD` (D-3), logo incluido (`IM_LOGO_ENTI`), y se copian una vez a la configuración de la clínica en AgenIA. Debajo, el título del documento y el «Registro de Calidad» como en el papel: fecha, documento y nombre, EPS, convenio y tipo de usuario (del convenio de la atención, D-9), número de historia y número de orden.
- **Pie:**
  - el médico (nombre, documento, especialidad, registro) y su firma (D22);
  - «Hoja N de M»;
  - «Generado por el Hospital San Vicente de Paúl para el paciente el …», en vez de «Usuario: ADMINISTRADOR»;
  - un **código QR de verificación** (D21).
- **PDF:** texto real, que se puede buscar y copiar (30-60 KB por documento).
- **Imagen:** una por hoja, JPEG o PNG a 150-200 ppp (~1.700 × 2.200 px; el peso se mide en la Fase 2). Sirve para verla en el celular o mostrarla en el mostrador. Sale **del mismo PDF**: nunca dicen cosas distintas.
- **Un solo motor genera los dos.** Opciones: HTML → PDF y PNG con Chromium sin pantalla, o PDF con `pdfkit` y luego pasado a imagen. Se decide en la Fase 2; hoy no hay ninguno en el repositorio.
- **Se generan al momento y no se guardan.** Lo que se guarda es el contenido cifrado (D11).

**Lo que dice distinto del papel, a propósito:**

| En el papel del HIS | En el documento de AgenIA | Por qué |
|---|---|---|
| «Dosis y Frecuencia»: el texto que arma el HIS («1 mg cada 24 Horas» para una cápsula de 20 mg) | La indicación del médico tal cual («1 TAB VO EN LA NOCHE»); si no hay, D19 | El texto armado contradice al médico (R4-3) |
| Cantidad en letras en inglés («1 (ONE)») | En español («1 (uno)») | La fórmula pide la cantidad en número y letras, en español |
| Letra de ~7 puntos | 10 puntos o más | Se lee en el celular |
| «Usuario: ADMINISTRADOR · Fecha impresión» | «Generado para el paciente el …» + QR | Quién lo generó y cómo verificarlo |
| «Indicaciones a juicio del Prescriptor» en blanco casi siempre (la observación de la orden viene vacía en el 99,7 %) | Se omite si está vacía | Menos ruido en una hoja que se lee en el celular |

**Oportunidad (fuera de este plan).** El 99 % de las remisiones es al mismo hospital: ~1.150 al mes en el piloto, a más de 20 especialidades. La consulta pedida viene con su CUPS (medicina interna 890266, nutrición 890206, oftalmología 890276…). El asistente podría ofrecer agendar esa cita con la remisión en la mano. Antes hay que saber cómo la agenda hoy el paciente y si necesita autorización de la EPS.

### 3.10 Cómo llega por Telegram

Pedido del usuario (2026-11-01): Telegram es un canal de envío con su propio interruptor (§3.11).

- **A quién.** Telegram no deja que un bot le escriba primero a un número de teléfono: solo puede escribirle a quien ya abrió el chat con él. Por eso llega a los pacientes que **ya usan el asistente por Telegram** (`PatientProfile.telegramChatId`) y no lo bloquearon (`telegramBlockedAt` vacío). A los demás, por WhatsApp o correo.
- **Cómo.**
  - Aviso sin datos clínicos con un botón «Recibir mis documentos» (botón en línea de Telegram).
  - Al tocarlo llegan los documentos: cada uno en PDF (`sendDocument`) y las imágenes de las hojas juntas (`sendMediaGroup`, hasta 10 por grupo).
  - No hay plantilla que aprobar, ni ventana de 24 horas, ni costo por mensaje.
- **Verificación.** El chat de Telegram ya quedó unido al paciente cuando se identificó en el asistente, así que cuenta como número verificado (D23): no se pide la fecha de nacimiento.
- **Si tiene Telegram y WhatsApp** (D26): va por Telegram, que es gratis, y no se duplica. Si Telegram falla (bloqueó el bot, o el envío no sale), cae a WhatsApp, como ya hace el asistente con los avisos (T4 del plan de Telegram).
- **Lo que ya hay y lo que falta en el código:**
  - el cliente de Telegram (`apps/api/src/telegram/telegram-api.client.ts`) ya manda botones en línea y responde a su toque (lo usa el asistente de soporte con `callback_query`);
  - falta enviar archivos (no hay `sendDocument`, `sendPhoto` ni `sendMediaGroup`);
  - falta que el bot de pacientes lea el toque del botón.
- **Cuántos lo usarían:** pocos al principio; se mide en el piloto con el seguimiento de envíos por canal.

### 3.11 Interruptores: todo se prende y se apaga, y nace apagado

Pedido del usuario (2026-11-01). Mismo criterio que los interruptores del asistente (`bookingEnabled`, `cancelEnabled`, `rescheduleEnabled`):
- se leen **en cada envío**, así que surten efecto sin reiniciar nada;
- un envío ya programado se vuelve a revisar justo antes de salir: si lo apagaron, no sale.

| Nivel | Interruptor | Qué hace apagado | Al desplegar |
|---|---|---|---|
| 0 | **La función existe** (`HospitalMirrorConfig.resumenAtencion` no es `null`) | No aparece en el panel: es el caso de toda clínica sin el driver CNT | `null` |
| 1 | **Leer del hospital** | El agente no consulta la historia clínica (cero carga en el HIS) y la API rechaza cualquier lote que llegue. Encendido sin «Enviar» = **lectura en sombra** (Fase 1) | Apagado |
| 1 | **Enviar a pacientes** (general) | No sale nada por ningún canal. Es el freno de emergencia | Apagado |
| 2 | **Por canal: WhatsApp · Telegram · correo** | Ese canal no envía, aunque el servicio lo tenga encendido | Los tres apagados |
| 3 | **Por servicio del HIS y por canal** | Matriz: cada servicio de la consulta (`TX_CODSER_HICL`) tiene un interruptor por canal. Ejemplo: medicina general `S39141` con WhatsApp y Telegram encendidos y correo apagado; urgencias `S39145` con todo apagado. Un servicio que no está en la lista no envía (lista blanca) | Ningún servicio encendido |
| — | **Modo prueba** | Mientras tenga números o chats en la lista, solo se les envía a ellos (el equipo), aunque todo lo demás esté encendido | — |

**Regla de envío.** Un documento sale por un canal solo si se cumplen todas estas condiciones:
1. «Enviar» está encendido;
2. el canal está encendido;
3. el servicio de la consulta tiene ese canal encendido;
4. la atención no cae en las exclusiones (D7, que mandan sobre cualquier interruptor);
5. el paciente no se dio de baja;
6. tiene contacto en ese canal;
7. es horario (§3.8);
8. si el modo prueba está activo, el destino está en su lista.

Si una condición falla, el seguimiento dice cuál.

**Quién y cómo.**
- Los cambia el ORG_ADMIN (y el SUPER_ADMIN) en Conexión con el hospital → «Resumen de la atención».
- La matriz muestra los servicios del HIS que tuvieron consultas en los últimos 30 días, con su nombre.
- Cada cambio queda en la Actividad de usuarios: quién, qué interruptor, de qué a qué.

**El agente.** Hoy recibe sus interruptores (`pushEnabled`, `pullEnabled`) en el saludo inicial (`HandshakeResult`). «Leer del hospital» va por el mismo camino, pero se relee en cada vuelta para que apagarlo frene la lectura sin reiniciar el agente. La API rechaza los lotes con el interruptor apagado: es el segundo freno.

**Al desplegar** (decisión del usuario): la migración deja la función en `null`. Al habilitarla para el hospital, nace con todo apagado. Nada se lee ni se envía hasta que alguien lo prende a mano, a diferencia del límite de citas, que nació encendido.

## 4. Qué hay que construir

### 4.1 En el hospital (lo hace TI del hospital)

- `GRANT SELECT` **por columna** a `agenia_sync`, solo las columnas que usa el resumen (§3.2). Tablas, tras la ronda 2: `HISTORIACLINICA`, `HIST_ORDEN`, `HIST_MEDI`, `HIST_PROC`, `HIST_INDI`, `HIST_INCA`, `HIST_REMI`, `HIST_ORTIAT`, `LABORATORIO` (solo `NU_NUME_LABO`, `CD_CODI_ESP_LABO`), `R_LABO_DIAG`, `DATOS_PLANTILLA`, `DATOS_PLANTILLA_TEXT`, `DATOS_PLANTILLA_MEMO`, `R_PLAN_ESP_TIAT`, `R_PLAN_CONC`, y los catálogos `CONCEPTO_HIST`, `GRUPO_HIST`, `DIAGNOSTICO`, `TIPODIAGNOSTICO`, `ESPECIALIDADES`, `SERVICIOS` (ya lo tiene), `MEDICOS` (nombre y registro), más las columnas de contacto de `PACIENTES`. El texto de la plantilla no se puede limitar por columna a ciertos campos: la consulta del agente filtra por concepto y solo sube los del resumen. **Nunca** `INTER_RES1888` (credenciales del Ministerio) ni `EXECUTE` sobre los procedimientos del proveedor (D16).
- **Para los documentos (§3.9), además:**
  - `ARTICULO` (código, CUM, Invima), `HIST_TEMLABO` (convenio), `CONVENIOS` (código, EPS, tipo de usuario), `TIPOUSUARIO`, `TIPO_DOCUMENTO`, `EPS` y `ENTIDAD` (nombre, NIT, dirección, teléfono, logo). `R_PAC_EPS` no hace falta: no sirve para el encabezado (ronda 5);
  - más columnas de `HIST_ORDEN` (vigencia, observación), `HIST_MEDI` (medida, concentración), `HIST_PROC` (CUPS), `HIST_INCA`, `HIST_ORTIAT`, `LABORATORIO` (edad), `MEDICOS` (documento), `PLANTILLA_HIST` (código) y `PACIENTES` (nombre y tipo de usuario);
  - las de `HIST_REMI`, según D24;
  - si D22 elige la imagen de la firma: `USUARIOS`, **solo** `NU_DOCU_USUA` e `IM_FIRMA_USUA` (la tabla guarda contraseñas en `PS_PASS_USUA`).
  P-7 del script de PRUEBAS arma el texto exacto, columna por columna.
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

- `AttentionSummaryDto`: atención, médico, diagnósticos, medicamentos, exámenes, incapacidad, remisiones, recomendaciones y, **por documento** (§3.9), los campos de su encabezado y de cada renglón, con el número de orden y la fecha desde la que se reclama. Validado con el mismo esquema en el agente y en la API.
- Entrada en `TEMPLATE_CONTRACTS` para la plantilla nueva (nombre del paciente y fecha; el botón lleva el token).

### 4.4 Base de datos (una migración, aditiva)

| Modelo | Para qué |
|---|---|
| `AttentionSummary` | Una por atención: clínica, paciente (si se identifica), clave del HIS (única por clínica), contenido **cifrado**, huella del contenido, fecha de la atención, estado (`RECIBIDO`, `EXCLUIDO`, `ENVIADO`, `SIN_CONTACTO`, `CADUCADO`), vence, se purga |
| `AttentionSummaryDelivery` | Un envío por canal (`WHATSAPP`, `TELEGRAM`, `EMAIL`): destino enmascarado, plantilla o texto, estado, motivo si no salió (incluido «interruptor apagado: canal / servicio / general / modo prueba»), id de Meta, de Telegram o del proveedor de correo, rebote |
| `AttentionSummaryAccess` | Cada apertura del enlace: cuándo, IP, verificó sí/no |
| `PatientProfile.summariesOptOut` | Baja de los resúmenes, aparte de la de recordatorios |
| `HospitalMirrorConfig.resumenAtencion` (Json, `null` por defecto) | Los interruptores de §3.11 (leer, enviar, por canal, por servicio × canal, modo prueba con su lista), exclusiones, tiempo de calma, horario, documentos que van (D20), texto del pie. Json, como `avisosMasivos`: afinar un valor no cuesta un despliegue. Su forma se valida con un esquema de `@agenia/shared`, y todo booleano que falte se lee como **apagado** |
| `WhatsappTemplateKind.ATTENTION_SUMMARY_READY` | La plantilla nueva |

### 4.5 API (`apps/api/src/attention-summary/`)

- Recibir el lote del agente (solo con «Leer del hospital» encendido), guardar cifrado, aplicar exclusiones y baja, resolver destinatarios, programar el envío respetando el horario.
- **Interruptores (§3.11):** una sola función decide si un documento puede salir por un canal (general, canal, servicio × canal, modo prueba). La usan el programador y el envío, que la vuelve a llamar justo antes de mandar. Pruebas de cada combinación.
- **Telegram (§3.10):** `sendDocument` y `sendMediaGroup` en `telegram-api.client.ts`, el aviso con botón en línea y la lectura del toque en el bot de pacientes. Si falla, cae a WhatsApp.
- Plantilla con **botón de respuesta rápida** (es fijo: no lleva parámetro al enviarla). El bot tiene que leer el mensaje `button` que llega al tocarlo (`button.payload`); hoy solo lee texto y audio.
- Flujo en el chat: botón → si el número no está verificado, fecha de nacimiento (5 intentos) → envío de cada documento. También «mis documentos» escrito por el paciente.
- **Envío de PDF e imágenes por WhatsApp**: el mismo camino que ya sube y envía el audio del modo voz (`uploadToWhatsApp`), con `type: 'document'` (nombre de archivo) y `type: 'image'`; cada envío se registra en el libro de mensajes como los demás.
- Módulo nuevo `mail/`: transporte por API del proveedor elegido (D12), plantilla de correo, adjunto, webhook de rebotes.
- **Generador de documentos** (§3.9): una plantilla por documento → PDF (con contraseña para el correo) e imagen de cada hoja, con el mismo motor, al momento, sin guardar el archivo. Cantidad en letras en español. QR de verificación si se aprueba D21.
- Si se aprueba D21: endpoint público de verificación (código del QR → qué documento es, de quién en forma enmascarada, fecha, si sigue vigente y, para la fórmula, si farmacia ya lo entregó, con `NU_ESTA_HMED = 2`).
- Endpoints para la página pública: validar token, verificar fecha de nacimiento con límite de intentos, devolver el resumen descifrado y el PDF.
- `RetentionService`: purga del contenido a los 30 días; los metadatos se quedan 365 días, como la bitácora del rastreo.
- Nunca se escribe el contenido clínico en los registros (logs).

### 4.6 Web (`apps/web`)

- Página pública `/resumen/[token]` (patrón de la encuesta), con la lista de documentos.
- Si se aprueba D21: página pública `/verificar/[codigo]` para la farmacia o el laboratorio que escanea el QR.
- Panel, Conexión con el hospital → «Resumen de la atención» (ORG_ADMIN):
  - los interruptores de §3.11: leer, enviar, uno por canal, y la **matriz de servicios por canal** con los servicios que tuvieron consultas en 30 días;
  - el modo prueba con su lista de números y chats;
  - exclusiones, horario, pie, y el estado de la plantilla de WhatsApp, del bot de Telegram y del correo.
  - Cada cambio queda en la Actividad de usuarios.
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
- **Fórmula y órdenes impresas desde un PDF.** La fórmula tiene requisitos propios: datos y firma de quien prescribe, cantidad en número y letras, vigencia (Decreto 780 de 2016, que recoge el 2200 de 2005, y Resolución 1403 de 2007). El químico farmacéutico y jurídica del hospital deciden, con los dispensadores de las EPS, si una copia impresa por el paciente sirve para reclamar (D21). Lo mismo para la remisión ante la EPS.
- **Firma.** Poner la imagen de la firma manuscrita en miles de PDF al mes hace trivial copiarla. La alternativa es una firma electrónica (Ley 527 de 1999, Decreto 2364 de 2012): «Firmado electrónicamente por …» más el QR de verificación (D22).
- **Contenido clínico por WhatsApp (D23).** Los documentos pasan por la nube de Meta y quedan en el celular del paciente. El contrato ampliado tiene que nombrar a Meta como encargado de ese contenido, y el comité aprobarlo. Nada clínico sale sin el toque del paciente y, si el número no está verificado, sin la fecha de nacimiento.

## 6. Pruebas

- Unitarias del mapeo del driver contra filas reales anonimizadas de la prueba en PRUEBAS (`HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql`, §8.1): su P-2 es el prototipo de la consulta del agente y su P-5, el de las reglas de envío; el código debe dar lo mismo.
- Mock del HIS (`apps/mirror-agent/local-his-mock`) con las tablas nuevas; `scripts/verificar-esquema-mock.mjs` contra `esquema-real.tsv`.
- API: exclusiones, baja, destinatarios (incluido el teléfono de otro documento), horario, idempotencia, cifrado, purga, límite de intentos, que el contenido no aparezca en logs.
- **Interruptores:**
  - con la configuración por defecto (`null`, o un objeto sin booleanos) no se lee ni se envía nada;
  - cada combinación de general, canal, servicio y modo prueba da el resultado de §3.11;
  - apagar con envíos en cola los frena;
  - la API rechaza un lote con «Leer» apagado;
  - el agente deja de leer en la vuelta siguiente.
- **Telegram:** solo a chats unidos al paciente y no bloqueados; cae a WhatsApp si falla; no se duplica.
- Postgres real (Docker) para la migración, con cero deriva.
- Envío real a teléfonos y correos del equipo antes del piloto: plantilla aprobada, botón, PDF que abre con la clave, llegada a Gmail y Outlook.
- **Revisión clínica:** el hospital compara 20 resúmenes contra la pantalla del HIS, campo por campo, antes de enviarle uno a un paciente.
- **Documentos contra el papel:** los PDF que imprime el HIS en E7 frente a los de AgenIA para las mismas atenciones de PRUEBAS, campo por campo (P-8 dice de dónde sale cada uno).
- **Lectura e impresión:** la imagen se lee en celulares de gama baja (Android y iPhone); el PDF y la imagen se imprimen bien en carta, también desde el WhatsApp del celular.
- **Aceptación:** antes del piloto, la farmacia del hospital, un dispensador externo y el laboratorio reciben una fórmula y una orden impresas desde el PDF (si se aprueba D21).

## 7. Decisiones por aprobar

| # | Decisión | Recomendación |
|---|---|---|
| D1 | ¿Qué atenciones? | **Ahora es la matriz de servicios por canal de §3.11**, que se prende y apaga desde el panel. Lo de abajo es lo recomendado para encender. Una **lista de servicios** que configura el hospital, dentro de la consulta ambulatoria (`TX_TIPO_HICL = 'CON'` sin registro de ingreso). La lista es necesaria porque la consulta de urgencias (`S39145`) también llega sin registro. **Piloto: medicina general y control de hipertensos** (`S39141`, `S39141-1`: 2.937 al mes; 68 % y 99 % con medicamentos). Después: lectura de exámenes (`EVC` `890201-LE`), medicina interna, pediatría, nutrición, dermatología, ginecología y PyDT. Nunca: urgencias, hospitalización, enfermería, odontología, psicología, psiquiatría. |
| D2 | ¿Qué secciones? | Las de §3.2: motivo, diagnósticos, plan, recomendaciones, medicamentos, exámenes, incapacidad, remisiones, próximo control y educación. Sin enfermedad actual, análisis, examen físico, antecedentes ni signos vitales (están sucios). Los campos de texto, por plantilla, según la tabla de R4-5 en `MAPEO_HIS.md` §2.9. El «plan» es lo que el médico escribió para la historia, no para el paciente: el comité lo revisa en los 20 casos de la Fase 1 antes de aprobarlo. |
| D3 | ¿El contenido viaja en el mensaje o detrás de un enlace? | ✅ **Aprobada por el usuario el 2026-11-01.** **Revisada el 2026-11-01.** WhatsApp: aviso sin datos clínicos con un botón de respuesta rápida. Al tocarlo, y tras la fecha de nacimiento si el número no está verificado, llegan los documentos en PDF e imagen dentro de la ventana de 24 h (§3.3, D23). El enlace queda de respaldo. Correo: aviso + enlace + un PDF con clave. (Antes: WhatsApp solo con enlace.) |
| D4 | ¿Cómo se verifica en el enlace? | Fecha de nacimiento completa, 5 intentos, bloqueo de 1 hora. |
| D5 | ¿Al celular del HIS de quien nunca escribió al asistente? | Sí, si es celular y no está asociado a otro documento en AgenIA. |
| D6 | ¿Menores de edad? | Al contacto del acompañante o al WhatsApp que agendó; si el hospital duda, fuera del piloto. |
| D7 | ¿Exclusiones sensibles? | La lista de §3.7, configurable; la valida el comité. Con datos reales deja fuera ~6 % de las consultas, casi todas de salud mental: el comité puede preferir excluir los servicios de psicología y psiquiatría y no todo código F (el F41.2, ansiedad y depresión mixta, sale en consultas de medicina general). **Ronda 6:** ~8,5 % de las remisiones son a psiquiatría, psicología o psiquiatría pediátrica (CUPS 890284, 890208, 890285), aunque el diagnóstico de la consulta no sea F. Esas remisiones, y su línea en el resumen, también van a la lista. Queda por decidir si se excluye la consulta entera o solo la remisión. |
| D8 | ¿Baja o autorización previa? | Lo decide jurídica del hospital. Técnicamente se soportan las dos; propuesta: baja inmediata por WhatsApp y en ventanilla. |
| D9 | ¿Cuándo se envía? | 2 horas después de guardada la historia (no hay marca de cierre; la última orden observada llegó a los 116 min), entre 7:00 y 20:00. |
| D10 | ¿Correcciones posteriores? | El enlace muestra la última versión; no se reenvía el aviso. |
| D11 | ¿Cuánto se guarda en la nube? | ✅ **Aprobada por el usuario el 2026-11-01.** Contenido cifrado 30 días; metadatos 365 días. |
| D12 | ¿Proveedor y remitente del correo? | Un proveedor con API (Amazon SES, Brevo o Resend) y un subdominio con DKIM; remitente «Hospital San Vicente de Paúl» o, si el hospital administra su DNS, su propio dominio. |
| D13 | ¿IA para explicar el resumen? | ✅ **Aprobada por el usuario el 2026-11-01.** No en esta versión: el contenido sale tal como está en el HIS. |
| D14 | ¿Quién ve los envíos en el panel? | ORG_ADMIN y BOOKING_AGENT, sin contenido; el médico no. |
| D15 | ¿Quién paga los mensajes de WhatsApp (plantilla Utilidad, cobro por mensaje)? | Decisión comercial; el número de envíos sale de la Fase 0. |
| D17 | ¿Cómo se consiguen los correos, si el del HIS es de relleno en el 97 % de los casos? | Que el asistente pregunte, con autorización, «¿quiere recibir sus resúmenes también por correo?» (al agendar y con el primer resumen); y pedirle al hospital que en admisión deje vacío el correo en vez de poner el de relleno. Mientras tanto, el correo sale solo a quien tenga uno propio. |
| D18 | ¿Qué le dice el resumen sobre dónde reclamar cada medicamento? | Depende de confirmar `AI`/`AE` con la farmacia del hospital. Si es interna/externa: «Farmacia del hospital» o «Dispensador de su EPS», con las fechas de cada entrega posfechada. |
| D19 | ¿Cómo se muestra la dosis? | La indicación escrita por el médico, tal cual (89 % de los renglones). Nunca la cantidad ni la unidad por dosis estructuradas: la unidad se queda en «mg» (código `168`) cuando el médico quiso decir «1 tableta». Tampoco el texto que arma el HIS. Si no hay indicación (11 %): nombre, cantidad total, duración y «tómelo como se lo explicaron en la consulta»; la frecuencia estructurada («cada 24 horas», catálogo `PAC_CONFIG_HIS` 37) solo si el comité la aprueba, porque también puede contradecir al médico. |
| D16 | ¿Leer las tablas o ejecutar `SP_INTEROPERABILIDAD_IHC_V2`? | ✅ **Aprobada por el usuario el 2026-11-01.** **Leer las tablas** replicando su lógica. El procedimiento puede registrar o transmitir al Ministerio al ejecutarse, y pedir `EXECUTE` sobre código del proveedor es un permiso más amplio. |
| D20 | ¿Qué documentos? | Con el formato y los campos del HIS: **fórmula** (una hoja por orden), **orden de exámenes**, **remisión** e **incapacidad**; más el **resumen**. La interconsulta (0,6 % en consulta externa) va solo como una línea del resumen. Nunca: indicaciones de urgencias u hospitalización (son para enfermería), interpretación de exámenes (fase posterior, `HIST_PROCINTER`) ni la historia completa (§3.9). |
| D21 | ¿Copia informativa o documento para reclamar? | **Para reclamar**, con un **QR de verificación**: qué documento es, de quién (enmascarado), fecha, vigencia y, en la fórmula, si farmacia ya la entregó. Para eso el agente vuelve a leer el estado de las órdenes vigentes. Lo aprueban el químico farmacéutico y jurídica del hospital con los dispensadores de las EPS. Mientras no lo aprueben: marca de agua «Copia para el paciente» y el papel sigue siendo el oficial. **Ronda 5:** la fórmula y las órdenes casi nunca se imprimen hoy (3 % y 2 %), porque la farmacia y el laboratorio del hospital trabajan con el sistema. Donde más pesa es en los medicamentos externos (`AE`) y en la remisión: hay que preguntar cómo reclama hoy el paciente un `AE` sin fórmula impresa. |
| D22 | ¿Firma del médico: imagen o firma electrónica? | **Firma electrónica** («Firmado electrónicamente por Dr. …, registro …, el …») más el QR, sin la imagen manuscrita: sacarla de miles de PDF al mes es trivial. Si el hospital exige la imagen: está en `USUARIOS.IM_FIRMA_USUA`, unida por `NU_DOCU_USUA` = `MEDICOS.NU_DOCU_MED`, y la tienen los 19 médicos del piloto (ronda 6). Son BMP de ~1 MB (hasta 9,6 MB): se reducen a PNG y se guardan cifradas en AgenIA, una por médico, leídas con un permiso aparte **solo sobre `NU_DOCU_USUA` e `IM_FIRMA_USUA`**. La tabla guarda contraseñas (`PS_PASS_USUA`). |
| D23 | ¿Cómo llegan los documentos por WhatsApp? | ✅ **Aprobada por el usuario el 2026-11-01.** §3.3: plantilla de Utilidad con botón de respuesta rápida → ventana de 24 h → un PDF por documento y una imagen por hoja. **Un mensaje pagado por consulta**: los de la ventana no se cobran con los precios de Meta vigentes desde julio de 2025. |
| D24 | ¿La remisión va con la «descripción del caso clínico»? | Esa descripción copia la historia (examen físico, antecedentes): 6.100 caracteres de promedio y hasta 28.000, de 2 a 4 hojas más. **Remisión interna** (el mismo hospital: **99 %**, ronda 6): **sin** ella, en una sola hoja, porque el especialista ve la historia en el HIS y al paciente le basta la solicitud. **Remisión externa** (~1 %): completa, como el papel, porque el paciente la lleva; solo por canal verificado y si el comité lo aprueba. «Remite a» es texto libre con variantes («HSVP ANSERMA», «HSVPA», «HOSPITAL SANVICENTE DE PAUL»…): la lista que la marca como interna se configura. |
| D25 | ¿Cómo se entregan las fórmulas posfechadas? | Todas el día de la consulta: una hoja por orden con su «reclamar desde», como el papel (confirmar en E7). **Ronda 5: toda fórmula dice «Vigente por 72 Horas», también las posfechadas.** Si se cuenta desde su fecha, el paciente tiene tres días para reclamar cada entrega. Por eso un recordatorio por WhatsApp el día que se puede reclamar («desde hoy y hasta el 30 de noviembre puede reclamar su losartán») vale más de lo que parecía. Se hace en una fase posterior, después de confirmar con farmacia desde cuándo corren las 72 horas. |
| D26 | ¿Si el paciente tiene Telegram y WhatsApp, por cuál? | Por **Telegram** (gratis, sin plantilla ni ventana), sin duplicar. Si falla, por WhatsApp (§3.10). Cada canal depende además de su interruptor y del del servicio (§3.11). |

## 8. Fases

| Fase | Qué | Termina cuando |
|---|---|---|
| **0. Descubrimiento** | Correr `sql/HISTORIA_CLINICA_DESCUBRIMIENTO_SOLO_LECTURA.sql` y `sql/HISTORIA_CLINICA_ESTADISTICA_SOLO_LECTURA.sql`; leer el código de `SP_INTEROPERABILIDAD_IHC_V2`; prueba manual en PRUEBAS con `sql/HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql` (protocolo E1-E7 y bloques P-0 a P-8). Rondas 2 a 5 si hace falta (la 5, `sql/HISTORIA_CLINICA_DOCUMENTOS_SOLO_LECTURA.sql`, cierra los documentos). | Mapeo completo en `MAPEO_HIS.md`, cifras reales de volumen y contacto, D1-D25 aprobadas, contrato ampliado, comité de HC de acuerdo, permisos concedidos. |
| **1. Lectura en sombra** | Capacidad del agente, endpoint, guardado cifrado, interruptores de §3.11 (todo nace apagado). Se enciende solo «Leer del hospital»: no se envía nada. | El hospital revisa 20 resúmenes contra el HIS sin errores; la consulta del agente pesa poco en el HIS (medida). |
| **2. Documentos y página** | Generador de documentos (§3.9: PDF e imagen con el mismo motor), `/resumen/[token]`, verificación, PDF con clave, QR si D21. Solo el equipo genera enlaces de prueba. | Los documentos de AgenIA coinciden con los PDF de E7; se leen en celulares reales y se imprimen bien; si D21, una farmacia y el laboratorio los aceptan. |
| **3. Correo** | Proveedor, DNS, plantilla de correo, rebotes. | Correos de prueba en Gmail y Outlook que no caen en spam. |
| **4. WhatsApp y Telegram** | Plantilla con botón de respuesta rápida aprobada por Meta, lectura del botón en el bot, verificación en el chat, envío de PDF e imágenes, «mis documentos», baja. Telegram: botón en línea, `sendDocument` y `sendMediaGroup`, caída a WhatsApp. | Envíos de prueba al equipo con el **modo prueba**. |
| **5. Piloto** | Se enciende «Enviar», el canal y la matriz solo para medicina general (`S39141`) o un médico, 2 semanas, horario hábil. | Entregados, abiertos, bajas, quejas y errores medidos; el hospital decide ampliar (encender más servicios en la matriz). |
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

**`HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql`** (solo en `PRUEBAS`; en cualquier otra base se detiene sin leer nada; solo lee pacientes cuyo primer apellido contiene «PRUEBA»). Trae el protocolo que hace el hospital en la aplicación y ocho bloques. El protocolo:
- E1: consulta externa completa, con un examen agregado 10 minutos después;
- E2: control de hipertensos;
- E3: corrección y anulación de un medicamento;
- E4: entrega en farmacia;
- E5: urgencias, psicología y un F41.2, que no deben enviarse;
- E6: un menor;
- E7: cada reporte de E1 impreso a PDF (historia, fórmula del día y una posfechada, orden de laboratorio y de procedimiento, remisión, incapacidad, indicaciones), para compararlo con P-8, y si TI puede, copia de los `.rpt`.

Los bloques:

| Bloque | Qué comprueba | Decide |
|---|---|---|
| P-0 | Configuración: documentos de prueba (rechaza a cualquier paciente real), fecha, alcance, correos de relleno y la lista de campos de plantilla que van al resumen, con los nombres exactos de R4-5 | — |
| P-1 | Las historias de los pacientes de prueba, con plantilla, médico, ámbito e «historia padre» | Cómo aparece una corrección (D10) |
| P-2 | **El resumen tal como lo armaría el agente**: diagnósticos con marca de sensible, medicamentos agrupados por artículo con sus entregas, renglones crudos (cuáles quita el filtro del RDA), exámenes con minutos después de guardar, recomendaciones, incapacidad, remisión, interconsulta y los campos de plantilla marcados | El mapeo campo por campo; D2, D18, D19 |
| P-3 | Tiempos de las órdenes y lo que registró la auditoría del HIS (por documento o número de historia) | D9; si la corrección y la entrega dejan rastro |
| P-4 | Dos huellas SHA-256 por historia: la del resumen (lo que ve el paciente) y la de estados (farmacia, toma de examen). Se corre antes y después de E3 y E4 | D10: cuándo el enlace dice «actualizado» |
| P-5 | **¿Se enviaría?** Las reglas aplicadas a cada historia: alcance, corrección, diagnóstico sensible, celular del paciente o del acompañante, correo propio o de relleno, hora de envío | D1, D5, D6, D7, D9, D17 |
| P-6 | Lecturas y tiempo de la vuelta del agente y del resumen de una historia (`SET STATISTICS IO, TIME`) | Carga en el HIS |
| P-7 | Columnas que usa el prototipo (también las de los documentos), si existen, qué lee hoy `agenia_sync` y el texto `GRANT SELECT (columnas)` por tabla para TI (no lo ejecuta; `INTER_RES1888` fuera) | La solicitud de permisos |
| P-8 | **Los documentos como los imprime el HIS**: encabezado y pie, fórmula por orden y por medicamento, orden de exámenes, remisión (sus 29 columnas rotuladas), incapacidad, interconsulta e indicaciones. Cada renglón trae la etiqueta del papel, el valor, la columna de donde sale y si ya está visto o falta confirmarlo con E7 | §3.9; qué columna imprime «Dosis y frecuencia», la vigencia y el número de orden; D20-D25 |

Probado el 2026-10-28 contra un SQL Server de prueba (compatibilidad 2017) con el esquema real y los escenarios E1-E6 simulados: el paciente real se rechaza; el medicamento anulado y el que no tiene unidad de venta no salen; el losartán de 90 días sale una vez con tres fechas; urgencias, psicología, F41.2, la nota de enfermería y la corrección dan «No» con su motivo; las de la noche pasan a las 7:00; tras la entrega en farmacia cambia solo la huella de estados y tras la corrección cambia la del resumen.

**`HISTORIA_CLINICA_MENSAJES_SOLO_LECTURA.sql`** (en `ESEHSVP`; solo conteos y tamaños): mide mes por mes desde abril, para el piloto y para la consulta externa sin urgencias, lo que hace falta para contar los mensajes de un mes: M-1 consultas, pacientes y consultas por día hábil; M-2 lo que anotó el médico (campos llenos, KB de texto, KB que irían al informe, recomendaciones, diagnósticos); M-3 fórmulas (consultas con fórmula, farmacia del hospital o externa, órdenes con entregas posfechadas, medicamentos); M-4 exámenes por tipo, remisiones, incapacidades e interconsultas; M-5 pacientes con celular y con correo propio, y diagnósticos sensibles; M-6 consultas por día de la semana y en festivos. Probado el 2026-10-28 en un SQL Server de prueba con intercalación `Modern_Spanish_CI_AS` en la base y otra en el servidor (las tablas # con texto usan `COLLATE DATABASE_DEFAULT`; el script de PRUEBAS se corrigió igual: sin eso, sus cruces fallaban con el error 468). ✅ Corrido el 2026-10-28: el informe muestra sus cifras (sección «Noviembre»). Hallazgos: no hay consulta los lunes y el sábado se atiende a los campesinos; el piloto tiene 77 campos llenos y 4,2 KB de texto por consulta, de los que ~0,75 KB irían al informe; 66 % con fórmula y 62 % con exámenes (~4,7 por consulta, casi todos de laboratorio); 94,7 % con celular, 3,1 % con correo propio, 5,6 % sensibles. 🔴 El filtro de unidad de venta del RDA deja fuera los medicamentos externos `AE` (§3.2). Julio: aparece la indicación del médico en los medicamentos y baja lo que va al informe (¿plantilla nueva?).

**`HISTORIA_CLINICA_MENSAJES_2_SOLO_LECTURA.sql`** ✅ corrido el 2026-10-28. M-7: sin el filtro de unidad de venta, el 79 % de las consultas del piloto tiene fórmula (66 % con él); el 53 % lleva medicamentos externos `AE` y el 19 % de las fórmulas son solo externas; del 87 al 100 % de los renglones `AE` no tiene unidad de venta; casi ningún renglón está anulado (`NU_ESTA_HMED = 0`: 0-1 al mes), así que el HIS parece borrar en vez de anular (lo confirma E3 en PRUEBAS). M-8: el piloto solo usa las plantillas 870 y 844, sin plantilla nueva; la baja de julio de lo que va al informe es de la 844 (1,3 → 0,6 KB). En la consulta externa sin urgencias, el 18 % de las consultas usa plantillas sin campos en la lista (odontología, planificación familiar, dermatología, pediatría…): D2 tiene que elegir sus campos antes de ampliar.

**`HISTORIA_CLINICA_PLANTILLA_844_SOLO_LECTURA.sql`** (sin correr; probado): compara campo por campo las plantillas 844 y 870 entre abril-junio y agosto-octubre, para saber qué campo de la 844 cambió en julio.

**`HISTORIA_CLINICA_DOCUMENTOS_SOLO_LECTURA.sql`** (ronda 5, en `ESEHSVP`; ✅ corrido el 2026-11-01; resultados en `MAPEO_HIS.md` §2.9, «Ronda 5»). Cierra lo que los reportes dejan abierto, sobre las consultas de los últimos 30 días. Solo conteos, catálogos y frases repetidas 10 veces o más. Entra solo a `ESEHSVP` y, si la base o el usuario no sirven, se detiene sin leer nada y dice por qué. (La primera vez corrió en otra base: de ahí ese freno.)

| Bloque | Qué responde | Decide |
|---|---|---|
| D-0 | Consultas de 30 días: piloto, consulta externa sin urgencias, urgencias | — |
| D-1 | Si `HIST_IMPRESION` es el registro de impresiones (qué papeles se lleva el paciente) o la «impresión diagnóstica» | D20 |
| D-2 | Dónde está la firma del médico (columnas de imagen o con «FIRM» en el nombre; sin mostrar imágenes) | D22 |
| D-3 | Nombre, NIT, dirección y teléfono del hospital (tablas de 1 a 5 filas; nunca claves ni `INTER_RES1888`) | Encabezado |
| D-4 | Fórmula: % de renglones con CUM, Invima, medida, concentración, vía, duración, dosis del HIS, indicación del médico, `TX_INDESP_HMED`; vigencias; medicamentos por orden | §3.9, D19, D21 |
| D-5 | Exámenes: código propio o CUPS (`TX_SISPRO_HPRO`, `SERVICIOS_CUPS`), indicaciones, renglones por orden | §3.9 |
| D-6 | Remisión: llenado de cada columna, valores de los códigos (prioridad, motivo, servicio, a dónde), cuántas son internas y cuánto mide el caso clínico | D24 |
| D-7 | Indicaciones: palabras de enfermería frente a palabras para el paciente, en piloto, consulta externa y urgencias | §3.2 |
| D-8 | Incapacidad e interconsulta: cuántas, códigos, especialidades | D20 |
| D-9 | Encabezado: convenio, tipo de usuario y su catálogo, EPS activa, edad, código de plantilla | §3.9 |
| D-10 | En qué tabla vive la interpretación de exámenes | Fase posterior |
| D-11 | Documentos por consulta (fórmulas del día y posfechadas, órdenes de exámenes, remisiones, incapacidades, interconsultas) | §9 |

Probado contra un SQL Server de prueba con el esquema real y la intercalación del hospital: no muestra la clave de una tabla de empresa falsa ni nada de `INTER_RES1888`, ni el contenido de la imagen de una firma de prueba. El script de PRUEBAS, con P-8, rechaza al paciente real y no lo muestra en ningún bloque.

**Lo que dejó la ronda 5:**
- encabezado en `ENTIDAD` (con logo);
- firma en `USUARIOS.IM_FIRMA_USUA`;
- `HIST_IMPRESION` es el registro de impresiones;
- CUM e Invima en `ARTICULO` (casi nunca para los externos);
- «Vigente por 72 Horas» en toda fórmula;
- el código de examen ya es el CUPS;
- ~89 % de remisiones internas;
- indicaciones para el paciente en consulta externa;
- interconsulta del 0,6 %;
- 3,6 documentos por consulta del piloto;
- la fórmula y los exámenes casi nunca se imprimen hoy (3 % y 2 %).

P-8 y P-7 del script de PRUEBAS se ajustaron: el encabezado sale del convenio y de `ENTIDAD`, y P-7 ya no pide las columnas que vinieron vacías.

**`HISTORIA_CLINICA_DOCUMENTOS_2_SOLO_LECTURA.sql`** (ronda 6, en `ESEHSVP`; ✅ corrido el 2026-11-01; resultados en `MAPEO_HIS.md` §2.9, «Ronda 6»).
- El médico imprime la historia y la remisión al terminar la consulta; la fórmula y los exámenes los reimprime otra persona días después, en pocos casos.
- La firma se une por documento y la tienen los 19 médicos del piloto, en BMP de ~1 MB.
- El encabezado sale completo del convenio en el 100 %.
- El 99 % de las remisiones es interna; el 8,5 % es a salud mental.
- No hay catálogo de prioridad de la remisión (la traduce la aplicación).

Corta, solo conteos y catálogos:

| Bloque | Qué responde | Decide |
|---|---|---|
| E-1 | Causa de cada impresión (catálogo `CAUSA_IMPRESION`); si la imprime la misma sesión que escribió la historia (el médico) y cuántos minutos después; reimpresiones; qué número guarda el registro según el tipo (la orden, la remisión, la historia) | Para quién es la historia que se imprime en el 96 %; D2, D21 |
| E-2 | Qué columna de `USUARIOS` une la firma con el médico; cuántos médicos del piloto la tienen, cuánto pesa y en qué formato (por los primeros bytes; nunca la imagen) | D22 |
| E-3 | Encabezado desde el convenio: si cada atención encuentra su convenio, su EPS y su tipo de usuario; los convenios del piloto como saldrían en el papel; `NU_TIPO_PAC` frente al tipo de usuario | §3.9 |
| E-4 | Catálogos de prioridad, motivo y destino de la remisión; cuántas son al mismo hospital y a qué consulta (CUPS con su nombre) | D24 |

**Estado de la Fase 0 (2026-11-01):** el mapeo técnico está completo, catálogos incluidos (`MAPEO_HIS.md` §2.9; R4-7 corrido), y la estadística también (§9; informe en `docs/drivers/cnt-sanvicente-anserma/evidencia/ESTADISTICA_HISTORIA_CLINICA_2026-10-28.html`). Los reportes que documentó el hospital están mapeados campo por campo (§2.9, «Reportes del HIS»).

Las rondas 5 y 6 cierran lo que se podía averiguar leyendo `ESEHSVP`. Faltan:
- la comparación con el papel en PRUEBAS, con el script independiente `HISTORIA_CLINICA_COMPARAR_PAPEL_PRUEBAS_SOLO_LECTURA.sql` (abajo). Confirma el número de orden que se imprime, la prioridad de la remisión, la columna de cada dosis y la incapacidad. El protocolo completo E1-E7 del script grande sigue sirviendo para las huellas, las reglas de envío y el costo;
- copia de los `.rpt`;
- las respuestas del hospital (lista en `MAPEO_HIS.md` §2.9, «Pendiente»):
  - para quién es la historia que el médico imprime;
  - cómo reclama hoy el paciente los externos `AE` y los exámenes;
  - cómo agenda la remisión interna;
  - desde cuándo corren las 72 horas de una posfechada;
  - si farmacia y los dispensadores aceptan la fórmula impresa desde un PDF;
  - `AI`/`AE`, el correo de relleno, las credenciales de `INTER_RES1888` y las trazas del Profiler;
- las decisiones D1-D25.

**`HISTORIA_CLINICA_COMPARAR_PAPEL_PRUEBAS_SOLO_LECTURA.sql`** (solo en `PRUEBAS`; independiente del script grande; probado el 2026-11-01). Trae el paso a paso, porque no es solo SQL:
1. Un médico hace en la aplicación del HIS, conectada a PRUEBAS, una consulta de un paciente de prueba. En cada campo escribe una **marca** («MARCA-INDICACION», «MARCA-OBSERVACION», «MARCA-PRESCRIPTOR», «MARCA-LABORATORIO», «MARCA-INCAPACIDAD»), y hace cuatro remisiones, una por cada prioridad de la lista, con la prioridad elegida escrita en la observación.
2. Imprime cada documento a PDF desde el módulo Consultas. Si el médico de prueba tiene firma real, la tapa antes de enviar.
3. Se corre el script en SSMS sobre PRUEBAS.

Los bloques:
- Q-2: todos los números candidatos de cada orden y lo que guardó el registro de impresiones, para ubicar el «Orden Nº» del papel.
- Q-3: el código de prioridad frente a la prioridad escrita, que da el catálogo 0-3.
- Q-4: cada columna de la dosis y en cuál quedó cada marca.
- Q-5: la incapacidad completa.
- Q-6: cada documento con las etiquetas del papel (lo mismo que P-8).

**`HISTORIA_CLINICA_ESTADISTICA_SOLO_LECTURA.sql`**: historias por mes de los últimos 6 meses (más el mes en curso), cuántas de ellas con cita ese día (la consulta externa, que es lo que se enviaría), pacientes, médicos y promedio por día; tamaño de la tabla; KB estimados (E-2) y exactos byte a byte (E-3) por mes, con cuánto de eso es texto largo; las mismas cifras para las tablas hijas `NU_NUME_HICL_xxxx` (E-4); el reparto por cargo del médico (E-2b) y por especialidad de la cita, indicando cuáles generan RDA (E-2c). Lee desde una frontera de `NU_NUME_HICL`; con `@recorrido_completo = 1` da lo mismo recorriendo toda la tabla (verificado en el HIS falso). Como la cabecera pesa ~0,1 KB, **E-5** pesa la atención completa (cabecera + órdenes + medicamentos + procedimientos + indicaciones + texto de plantilla + diagnósticos) sobre las historias de 7 días, por tipo, y **E-6** da los KB de cada mes con ese peso; una tabla de más de 2 millones de filas sin índice por su enlace se omite y lo dice.

### 8.2 ¿Se puede empezar sin tener todas las decisiones? Sí

Como todo nace apagado y casi todo es configuración (§3.11), la mayoría de las decisiones son valores que se cambian en el panel, no código. Solo unas pocas cambian lo que se construye. Las demás frenan pasos concretos: leer datos reales o enviarle a un paciente.

| Grupo | Decisiones | Qué frenan | Cómo se arranca |
|---|---|---|---|
| **Cambian el código** | D3/D23 (WhatsApp con botón y documentos en el chat), D11 (contenido cifrado 30 días en la nube), D13 (sin IA), D16 (leer tablas, no ejecutar el procedimiento del proveedor) | El diseño | ✅ **Aprobadas por el usuario el 2026-11-01**: ya no frenan nada |
| **Cambian una parte, con un valor por defecto seguro** | D21 (QR de verificación), D22 (firma) | La Fase 2 (documentos) | v1 sin QR y con marca de agua «Copia para el paciente»; firma electrónica en texto, sin la imagen (no hace falta permiso sobre `USUARIOS`). El QR y la imagen se agregan si se aprueban |
| **Son configuración: se construyen todas las opciones** | D1 (matriz de servicios), D2/D20 (secciones y documentos), D4, D5, D6, D9, D10, D14, D17, D18, D19, D24, D25, D26 | Nada del desarrollo | Se programan con lo recomendado como valor inicial y se ajustan en el panel |
| **Frenan leer datos reales** (Fase 1 en `ESEHSVP`) | Contrato de datos ampliado a historia clínica; permisos por columna (P-7) | Encender «Leer del hospital» en producción | Mientras tanto se desarrolla y prueba con el HIS falso (`local-his-mock`) y la base `PRUEBAS` |
| **Frenan enviarle a un paciente** (Fase 5) | D7 y D2 (comité de historias clínicas), D8 y D21 (jurídica), D15 (quién paga los WhatsApp), plantilla aprobada por Meta | Encender «Enviar» fuera del modo prueba | Hasta entonces, solo el equipo recibe (modo prueba) |

⇒ Con D3, D11, D13, D16 y D23 aprobadas, se puede empezar ya: Fase 1 (agente, endpoint, guardado e interruptores) contra el HIS falso y PRUEBAS, y Fase 2 (documentos) con los valores por defecto. Lo legal y el comité tienen que llegar antes de encender la lectura en producción y, sobre todo, antes de enviarle a un paciente.

### 8.3 Fase 1: lo construido (2026-11-01)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Reglas compartidas | `packages/shared/src/resumen-atencion.ts` | Tipos del resumen y de los interruptores. Lo que falta cuenta como apagado (`leerConfigResumenAtencion`, `puedeLeerDelHospital`, `puedeEnviarPorCanal` con su motivo). `validarResumenAtencion` revisa cada resumen. `aplicarCambioDeLectura` es lo único que cambia el panel, y nunca enciende «Enviar» ni un canal. |
| Base | migración `20261101120000_resumen_atencion` | `HospitalMirrorConfig.resumenAtencion` (JSON, vacío = apagado) y `resumenAtencionCursor` (solo lo escribe el agente). Tabla `AttentionSummary`: contenido cifrado, hash, versión, estado, borrado a los 30 días. `PatientProfile.summariesOptOut` (la baja, para la Fase 4). Probada contra Postgres sin deriva. |
| API | `apps/api/src/mirror/mirror-attention-summary.service.ts` | `GET /mirror/attention-summaries/state` y `POST /mirror/attention-summaries`. Con la lectura apagada responde 403. Rechaza servicios fuera de la matriz. Guarda cifrado; con el mismo contenido no hace nada y con uno distinto sube la versión. Lo caducado no revive y el cursor solo avanza. Liga al paciente por cédula sin ceros, solo si hay uno. |
| Retención (D11) | `apps/api/src/retention/retention.service.ts` | Borra el contenido a los 30 días (si no salió, `RECIBIDO` → `CADUCADO`) y la fila al año. |
| Agente | `core/engine.ts` `syncAttentionSummaries`, bucle propio cada 5 min | Pregunta si debe leer. Si debe, busca las terminadas con la calma cumplida (120 min), lee en lotes de 50 y sube. La primera vez arranca 6 horas atrás. |
| Driver | `drivers/cnt-sanvicente-anserma/resumen-atencion.ts` | Detecta (CON, ambulatoria, servicio de la matriz, cursor `NU_NUME_HICL`) y lee 10 consultas con etiqueta. Sin `DE_DOSIS_HMED` (D19), sin el texto de `TX_CASO_HREM` (D24) y sin ítems anulados. Los campos de la plantilla se filtran por nombre de concepto. Probado contra un SQL Server de prueba. |
| Panel | `/dashboard/espejo/resumen-atencion` (botón en el Espejo, solo Administrador y driver de Anserma) | «Leer del hospital», los servicios que se leen y la calma. «Enviar» y los canales se ven deshabilitados. Muestra cuánto se ha leído, nunca el contenido. Cada cambio deja `ATTENTION_SUMMARY_CONFIG_CHANGED` en la Actividad de usuarios. |

**Pruebas:** shared, API, agente y web en verde, más la integración de la API contra Postgres y la del driver contra SQL Server.

**Revisión y medición (2026-11-01, después del commit 3584864):**

| Pieza | Dónde | Qué hace |
|---|---|---|
| Base | migración `20261101180000_resumen_atencion_revision` | `AttentionSummary.reviewResult`, `reviewNote`, `reviewedAt`, `reviewedByUserId` y `HospitalMirrorConfig.resumenAtencionMedicion`. Solo columnas que admiten NULL. Sin deriva contra Postgres. |
| Revisión | `GET /attention-summaries/:id` (`AttentionSummaryReviewController`, fuera de `/mirror`) y `revisarResumenAction` | Solo el Administrador y solo de su clínica. La API descifra y anota `ATTENTION_SUMMARY_VIEWED`. «Correcto» o «Con error» (este con nota obligatoria) solo mientras el contenido existe; deja `ATTENTION_SUMMARY_REVIEWED` sin la nota. La purga borra la nota con el contenido. |
| Pantalla | «Revisar contra el HIS» en `/dashboard/espejo/resumen-atencion` | Lista de los últimos 40 (solo datos de control), detalle completo al abrir y contador «N de 20 revisados · correctos · con error». |
| Medición | agente (`medicion` en cada lote, también vacío) → `agregarMedicion`/`resumirMediciones` | Lo que tardan la detección y la lectura en el HIS. Se guarda un día de vueltas, y el panel muestra la mediana y el máximo. |

**Orden de despliegue:** migraciones → API → agente (bundle nuevo en el servidor del hospital) → web. Encender la lectura en producción espera el contrato ampliado y los permisos (P-7), según §8.2.

**La Fase 1 se cierra cuando** el hospital marque 20 resúmenes «Correcto» sin ninguno «Con error» pendiente, y la medición muestre que la consulta pesa poco en el HIS. Las dos cosas se ven en la pantalla, pero exigen encender la lectura en producción (§8.2).

### 8.4 Fase 2: lo construido (2026-11-01)

**Motor (decisión de §3.9).** pdfkit 0.20.2 para el PDF y @napi-rs/canvas 1.0.11 para la imagen, las dos con licencia MIT. Chromium se descartó: pesa demasiado para la imagen Debian de la API. Las dos librerías dibujan la **misma** lista de elementos con posición (el «plano» de cada hoja), con la misma letra (Noto Sans, OFL, incluida en el repositorio), así que el PDF y la imagen no pueden decir cosas distintas. La imagen no sale de rasterizar el PDF, como proponía §3.9: sale del mismo plano, que da el mismo resultado sin otra dependencia.

| Pieza | Dónde | Qué hace |
|---|---|---|
| Reglas compartidas | `packages/shared/src/resumen-documentos.ts` | `documentosDelResumen` (D20: el resumen, una fórmula por orden con las posfechadas aparte (D25), las órdenes de exámenes, las remisiones y las incapacidades), `contenidoDelResumen` (§3.2, cada medicamento una vez con sus entregas), `cantidadEnLetras` en español, `hastaDeIncapacidad`, y `leerConfigDocumentos`/`aplicarCambioDeDocumentos` para el encabezado, el logo y el pie. La marca de agua no se puede quitar desde el panel (D21). |
| Generador | `apps/api/src/attention-summary/documentos/` | `plano.ts` (renglones y saltos de hoja sin partir un medicamento), `plantillas.ts` (encabezado y «Registro» como el papel, el cuerpo de cada documento y el pie con el médico, «Firmado electrónicamente por…» en texto (D22), «Generado para el paciente» y «Hoja N de M»), `render.ts` (PDF y PNG; PDF con clave AES-256 para el correo) y `generador.ts`. Carta, márgenes de 1,5 cm, letra de 10 puntos o más, en blanco y negro. Medido: PDF de 13-17 KB por documento; PNG de 1.700 × 2.200 de 250-580 KB, ~100 ms por hoja. |
| Vista previa del personal | `GET /attention-summaries/:id/documents[/:doc]` | Solo el Administrador. Cada archivo deja `ATTENTION_SUMMARY_DOCUMENT_VIEWED`. En el panel aparecen debajo del resumen abierto, con PDF, imagen por hoja y «Todos en un solo PDF». |
| Encabezado | «Encabezado de los documentos» en el panel | Nombre, NIT, dirección, teléfono, logo (PNG o JPEG de hasta 150 KB) y pie. Se copian una vez de `ENTIDAD`. |
| Enlaces | `AttentionSummaryLink` (migración `20261101200000_resumen_atencion_enlaces`) | Token de 128 bits; en la base solo queda su SHA-256. Vence a los 30 días, sin pasar del borrado del contenido. Fase 2: solo PRUEBA, del Administrador (`ATTENTION_SUMMARY_TEST_LINK_CREATED`). |
| Página del paciente | `/resumen/<token>` y `/public/attention-summaries/*` | Fecha de nacimiento en día, mes y año (D4: 5 intentos y luego una hora de bloqueo). Con ella, un acceso firmado de 30 minutos en una cookie limitada al enlace. Muestra el resumen, cada documento (descargar PDF y ver imagen), «Descargar todos» y «Salir». Sin la fecha en el HIS, manda al hospital. |
| Bitácora | `AttentionSummaryAccess` | Cada apertura, verificación, vista y descarga, con la IP y el navegador, sin contenido. Se borra con el resumen, al año. |

**Pruebas:** reglas, maquetador, generador real (PDF, PNG, clave, marca de agua en cada hoja, nada fuera de la hoja), enlaces (fecha, bloqueo, acceso de otro enlace, acceso vencido o falsificado), acciones y rutas de la web. Además, una prueba de punta a punta con la base Postgres desechable, la API escuchando y la web compilada: enlace, página que pide la fecha, fecha equivocada y correcta, contenido, descargas, bloqueo y bitácora. Sin deriva entre la migración y el esquema.

**Despliegue:** migración → API (instala pdfkit y @napi-rs/canvas; el lockfile ya trae el binario de Linux x64) → web. El agente no cambia. El Caddy tampoco: la página habla con la API por la red interna.

**Falta para cerrar la Fase 2 (§8):**
- comparar los documentos con los PDF del HIS de E7 en PRUEBAS (`sql/HISTORIA_CLINICA_COMPARAR_PAPEL_PRUEBAS_SOLO_LECTURA.sql`);
- leerlos en celulares reales e imprimirlos;
- poner el encabezado real del hospital;
- D21: QR y quitar la marca de agua, si el hospital lo aprueba;
- D22: imagen de la firma, si se exige.

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
| **Con los documentos en el chat (D23)** | D-4, D-6 y D-11 (ronda 5, medido) | **Mensajes pagados:** uno por consulta con contacto, ~2.500 en noviembre en el piloto (antes ~5.720: uno por documento).<br>**Por consulta del piloto (medido):** 79 % con fórmula (1,28 órdenes del día y 1,10 posfechadas), 65 % con exámenes (0,79 órdenes), 31 % con remisión (1,27 cada una), 1,7 % con incapacidad: 3,6 documentos sin contar el resumen.<br>**Dentro de la ventana, sin costo:** un PDF por documento (resumen, fórmula, exámenes, cada remisión, incapacidad), ~2,85 por consulta → **~7.100 PDF en noviembre** (~280 MB con 40 KB cada uno). Y una imagen por hoja, ~4,7 por consulta → **~11.800 imágenes**. Las hojas se calculan con dos supuestos: hasta 6 medicamentos por hoja de fórmula, y la remisión en una hoja (99 % internas, sin caso clínico: D24). El peso de la imagen se mide en la Fase 2: a 250 KB serían ~3 GB al mes |
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
| Costo de WhatsApp | Se conoce con la Fase 0 antes de encender; un mensaje pagado por consulta (D23); el correo y Telegram no cuestan por mensaje |
| Una fórmula imprimible se reclama dos veces (impresa varias veces o en dos farmacias) | QR con el estado de entrega (D21); farmacia anota «Cantidad entregada» como hoy. El papel de hoy también se puede fotocopiar |
| Copia de la firma del médico | Firma electrónica + QR, sin la imagen manuscrita (D22) |
| El documento de AgenIA no dice lo mismo que el papel del HIS | Mismos campos y etiquetas (P-8); comparación con los PDF de E7; revisión de 20 casos |
| Imagen ilegible en el celular | Letra de 10 puntos o más, 150-200 ppp, prueba en celulares de gama baja |
| Documentos clínicos en WhatsApp (Meta) | Contrato ampliado, verificación antes de enviar, nada sin el toque del paciente, baja |
| Las casillas de la plantilla dicen «NO» aunque hubo órdenes | Los documentos y el resumen salen de las órdenes, nunca de esas casillas |

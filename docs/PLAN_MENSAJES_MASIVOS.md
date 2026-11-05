# Plan — Mensajes masivos (comunicados de la clínica por WhatsApp)

> **Estado:** construido el 2026-11-05 (esquema, API, panel, revisiones con y sin IA, envío, seguimiento y bajas), con pruebas en verde. **Falta trabajo humano, no código:** crear y aprobar en Meta las dos plantillas del comunicado de cada clínica y registrarlas en Configuración → WhatsApp (§5), y que cada clínica tenga en su formato de tratamiento de datos la autorización para comunicados por WhatsApp (§9).
> **Alcance:** todas las clínicas; solo el Administrador (`ORG_ADMIN`).
> **Las decisiones** (§10) se tomaron con un valor por defecto razonable para poder construir; cada una dice cómo cambiarla.

---

## 0. Qué es y qué no es

**Es** una opción del menú del Administrador, «📢 Mensajes masivos» (`/dashboard/mensajes-masivos`), para mandar un **comunicado** de la clínica por WhatsApp a muchas personas a la vez: una jornada de vacunación, un cambio de horario o de sede, una campaña de prevención. Los pasos: elegir a quién (una lista importada de cualquier archivo, una lista guardada o los pacientes con WhatsApp), escribir el texto, agregar una imagen si se quiere, revisarlo, probarlo y confirmar.

**No es:**

| No es | Por qué importa |
|---|---|
| Los «Avisos masivos» del hospital de Anserma | Esos avisan a los pacientes con cita de un especialista (`docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md`), son exclusivos de ese driver y no cambian. Estos son generales y no tocan citas. |
| Un mensaje libre | Fuera de las 24 h siguientes al último mensaje de cada persona, WhatsApp solo deja escribir con una plantilla aprobada. El texto viaja como variable de esa plantilla. |
| Una forma de escribirle a cualquiera | Solo a quien autorizó (Ley 1581): la lista guarda la declaración de dónde salen los contactos y quién la hizo; las bajas se respetan siempre. |
| Correo electrónico | El correo de los contactos se guarda para después; hoy no hay servidor de correo configurado. |

## 1. Restricciones que dieron forma al diseño

Verificadas en la documentación de Meta y de proveedores oficiales (noviembre de 2026):

1. **Plantilla obligatoria** fuera de la ventana de 24 h. Una plantilla con **encabezado de imagen** exige la imagen en cada envío y una sin encabezado no la acepta → **dos plantillas** (§5).
2. **La variable no admite saltos de línea, tabulaciones ni más de 4 espacios seguidos** («Param text cannot have new-line/tab characters or more than 4 consecutive spaces»): el error llega con todos los envíos. El texto se escribe en un párrafo; la revisión lo impide y lo arregla (§6).
3. **Cuerpo de hasta 1024 caracteres** con las variables puestas → tope de 800 para el comunicado.
4. **Imagen del encabezado: JPEG o PNG de hasta 5 MB** (WebP es formato de sticker; GIF no). Proporción recomendada 1,91:1 (por ejemplo 1200 × 628): en la conversación el encabezado se ve horizontal y una foto vertical se recorta (§7).
5. **Categoría Marketing**: un comunicado genérico no pasa como Utilidad. Meta cobra cada mensaje de marketing entregado y limita los de marketing por persona (error 131049); quien bloquea los de la empresa da 131050.
6. **Nivel de mensajes y calidad del número**: Meta limita cuántas personas distintas se contactan en 24 h y baja la calidad si muchos bloquean o reportan.
7. **Ley 2300 de 2023** («dejen de fregar»): mensajes de publicidad y cobranza de lunes a viernes de 7:00 a 19:00 y sábados de 8:00 a 15:00, nunca domingos ni festivos. Un comunicado puede leerse como publicidad → se respeta siempre (§8).
8. **Ley 1581 de 2012**: autorización previa, expresa e informada; los datos de salud son sensibles (§9).

## 2. Piezas

```
packages/shared/src/mensajes-masivos-contactos.ts  ← leer contactos de «lo que sea» (puro)
packages/shared/src/mensajes-masivos-texto.ts      ← revisión del texto, vista previa (puro)
packages/shared/src/mensajes-masivos-imagen.ts     ← reglas de la imagen (puro)
packages/shared/src/mensajes-masivos-envio.ts      ← horario Ley 2300, bajas, errores de Meta (puro)
packages/database/prisma/migrations/20261105120000_mensajes_masivos/  ← 5 tablas y 3 valores de enum
apps/api/src/mass-message/                          ← módulo Nest: Meta, IA, envío, bajas
apps/web/app/actions/mensajes-masivos.ts            ← acciones de servidor (Prisma directo + API)
apps/web/app/dashboard/mensajes-masivos/            ← la pantalla, el seguimiento y la ruta de la imagen
apps/web/lib/mensajes-masivos/                      ← permiso, lectura del archivo, imagen en el navegador
```

Cambios a lo existente, todos aditivos: el menú (`packages/shared/src/menus.ts`), dos tipos de plantilla en el contrato compartido, `sendTemplate` acepta `headerImageId`, la conversación con la IA acepta una imagen en un turno (Gemini, ChatGPT y Claude), el asistente llama a la baja de comunicados después de la emergencia, Telegram registra `MASS_MESSAGE` como aviso del sistema y el catálogo de la Actividad de usuarios suma seis acciones.

## 3. Quién y cómo

Solo `ORG_ADMIN` (`lib/mensajes-masivos/acceso.ts`; la API con `@Roles('ORG_ADMIN')`): un comunicado habla por la clínica, cuesta dinero y afecta la calidad del número. El asistente tiene tres pasos —destinatarios, mensaje e imagen, revisar y enviar— y el borrador se guarda solo desde el segundo. Pestañas: Nuevo envío, Envíos (borradores y confirmados), Listas de contactos y Bajas. Arriba, el estado: plantillas aprobadas, IA, horario.

## 4. Contactos: leer «lo que sea»

`analizarArchivoDeContactos` (puro, corre en el navegador para responder al instante; el servidor vuelve a normalizar al guardar):

- **Formatos**: Excel (.xlsx/.xls/.ods, primera hoja con datos), CSV con coma, punto y coma, tabulador o barra (con comillas), vCard (.vcf, toma el celular y no el fijo), y texto libre (una persona por línea: se sacan celular y correo y lo que queda es el nombre). CSV de Excel en Windows (Windows-1252) se detecta y se lee bien.
- **Encabezado**: se reconoce si la primera fila no trae celulares ni correos y se parece a nombres de columna; un preámbulo («Listado de pacientes») se salta.
- **Tipo de columna**: suma el encabezado (sinónimos en español y los de Google Contactos y Outlook) y el contenido (fracción de celulares, fijos, correos, documentos, nombres de varias palabras o de una). El contenido manda si contradice al encabezado con claridad. Una sola columna de celular (las demás, «otro teléfono» de respaldo); dos columnas de una palabra seguidas son nombres y apellidos. Cada columna lleva su confianza y su porqué.
- **IA (opcional)**: si la confianza no es alta, «Pedir ayuda a la IA» manda **solo encabezados y 5 filas con los dígitos de en medio y el usuario del correo tapados** (`muestraParaIa`); la respuesta se valida (`leerMapeoDeIa`) y se puede corregir a mano.
- **Resultado**: celular a E.164 (colombiano de 10 dígitos que empieza por 3, o internacional con +); descarta fijos, inválidos, vacíos y repetidos, y avisa sin descartar de correos inválidos y filas sin nombre. Las columnas «Otro dato» se guardan con su encabezado.
- **Guardar**: nombre único por clínica, descripción y la declaración de autorización (obligatoria, con usuario y fecha). Se enlaza cada contacto con la ficha del paciente que tenga ese celular. También se arma una lista con los pacientes con WhatsApp (todos o de una EPS). Una lista usada en un envío no se borra: es la constancia.

## 5. Plantillas

`MASS_MESSAGE_TEXT` (sin imagen) y `MASS_MESSAGE_IMAGE` (encabezado de imagen), cada una con 2 variables: el primer nombre (o «paciente») y el comunicado. Cuerpo sugerido (`CUERPO_SUGERIDO_COMUNICADO`):

```
Hola {{1}}, tenemos un comunicado para usted:

{{2}}

Si no desea recibir más comunicados, responda NO MÁS COMUNICADOS.
```

La API pregunta a Meta (`/{WABA}/message_templates`, con el id de la cuenta de WhatsApp Business de Configuración) si existe en ese idioma, si está aprobada, su encabezado y su cuerpo. Lo que no casa (no aprobada, encabezado equivocado, otra cantidad de variables) **impide confirmar**, y el cuerpo real es el de la vista previa. Sin el id de la cuenta no se puede comprobar: se avisa y se recomienda la prueba.

## 6. El texto

Dos barreras:

1. **Reglas, al instante** (`revisarTexto`, la misma en el navegador y en la API antes de confirmar). Impiden enviar: saltos de línea o tabulaciones, más de 4 espacios, más de 800 caracteres, espacios por llenar («{nombre}», «[fecha]», «XXX») y groserías. Avisan: más de 500 caracteres, muy corto, informal, abreviaturas de chat, mayúsculas sostenidas (sin contar siglas), signos repetidos o sin cerrar, palabra repetida, tildes y palabras pegadas frecuentes, emojis de más, enlaces acortados o con http, y datos de salud de una persona. Sugieren: espacios antes de un signo, falta de espacio después, empezar en minúscula, falta el punto final, saludo repetido (la plantilla ya saluda). Lo que se puede arreglar solo trae el texto arreglado; «Arreglar lo automático» aplica todo lo seguro.
2. **IA, a pedido** (`MassMessageAiService.revisarTexto`): ortografía, gramática, claridad, tono, inadecuado, privacidad, afirmaciones dudosas y datos que falten, sin cambiar fechas, lugares ni cifras. Solo se ofrece aplicar un cambio si su fragmento está tal cual en el texto, y el texto sugerido se acepta si queda en un párrafo y dentro del largo.

## 7. La imagen

- **En el navegador** (`imagen-navegador.ts`): formato real por los primeros bytes, peso, ancho y alto, transparencia, brillo medio y nitidez (varianza del laplaciano sobre 256 px). `evaluarImagen` (pura) da las observaciones y un puntaje; el recuadro sobre la imagen muestra la zona visible en la conversación.
- **Arreglos**: «Optimizar» (JPEG, fondo blanco, como mucho 1600 px de ancho, calidad bajando hasta quedar por debajo de 1 MB) y «Recortar a 1,91:1» (centrado).
- **Guardado**: en la base (`MassCampaign.imageData`), revisado otra vez por sus bytes (JPEG o PNG, ≤ 5 MB). Se sube a Meta (`/media`) al enviar y su id se renueva pasados 25 días. Se sirve al panel por una ruta propia, solo al administrador de esa clínica.
- **IA, a pedido**: si el texto de la imagen se lee en un celular, errores en ese texto, datos personales (rostros, documentos, historias), contenido inadecuado, coherencia con el mensaje y recomendaciones.

## 8. El envío

1. **Previa** (`GET /mass-messages/envios/:id/previa`): cuántos en la lista, cuántos con baja, cuántos bloquearon a la clínica en Meta (131050 en el libro de mensajes), a cuántos les llega, la plantilla verificada, la calidad y el nivel del número, cuándo sale y cuánto tarda, y lo que impide enviar.
2. **Prueba**: al celular de quien prepara, con el nombre que escriba; no cuenta en el envío.
3. **Confirmar**: casilla de autorización y **escribir la cantidad de personas**; si cambió (alguien pidió la baja), la API lo rechaza con la cantidad nueva. Se toma la foto de destinatarios (`MassCampaignRecipient`, único por envío y celular) y el envío pasa a «En cola». Solo un BORRADOR pasa a la cola (actualización condicionada).
4. **La vuelta** (cada 20 s, `MassMessageSenderService`): solo en el horario de la Ley 2300 en la zona de la clínica. Cada envío activo toma un turno en la base (`lockedUntil`, 90 s) y manda hasta un tercio de su ritmo por minuto, con la pausa que corresponde (60 por minuto por defecto; 30 o 120 a elegir). Antes de cada mensaje revisa si lo pausaron o cancelaron y si la persona pidió la baja. Error de la persona → FALLIDO y sigue. Error de la clínica (plantilla, token, cuenta, imagen, parámetro inválido) → **pausa el envío con el motivo** y la persona sigue en cola: al reanudar le llega una sola vez.
5. **Seguimiento** (§8.4, `/dashboard/mensajes-masivos/<id>`): en cola, enviados, entregados, leídos (del `WhatsappMessageLog` por el id de Meta) y a quiénes no les llegó con el motivo en palabras; lista filtrable de personas. Pausar, reanudar, cancelar lo que falta y reintentar los fallos pasajeros (131049, 130429, 131056, fallas de red).

## 9. Legal y plataforma

- **Ley 1581**: la declaración de autorización es obligatoria al guardar una lista y otra vez al confirmar; quién y cuándo quedan guardados. La IA ve lo mínimo (§4). **Pendiente de cada clínica:** que su formato de tratamiento de datos nombre los comunicados por WhatsApp.
- **Bajas** (`MassMessageOptOut`): «NO MÁS COMUNICADOS», «stop», «no quiero más mensajes» y parecidas (y «activar comunicados» para volver), con frases fijas y sin IA, como la baja de recordatorios. Vale para el número que escribe y, si escribe con el número oculto (BSUID), también para el teléfono de sus fichas. No toca los recordatorios y lo dice. El administrador registra o quita bajas en el panel.
- **Calidad del número**: ritmo moderado por defecto, la calidad y el nivel a la vista antes de confirmar, quienes bloquearon a la clínica quedan fuera.
- **Constancia**: el texto final, la plantilla con su cuerpo aprobado y las reglas que se revisaron quedan en el envío; la Actividad de usuarios guarda listas, pruebas, confirmaciones, controles y bajas del panel.

## 10. Decisiones (tomadas por defecto; cambiar es barato)

| # | Decisión | Por qué | Cómo cambiarla |
|---|---|---|---|
| M1 | Solo `ORG_ADMIN`. | Habla por la clínica, cuesta y afecta el número. | `puedeUsarMensajesMasivos` y `@Roles` del controlador. |
| M2 | Solo WhatsApp; el correo se guarda. | No hay SMTP configurado; Telegram no tiene plantillas. | Un canal nuevo en el envío. |
| M3 | Siempre con plantilla, también dentro de las 24 h. | Un solo mensaje igual para todos y una sola vista previa. | — |
| M4 | Horario de la Ley 2300 siempre, sin excepción configurable. | Un comunicado puede leerse como publicidad. | `HORARIO_COMUNICADOS`. |
| M5 | 60 mensajes por minuto por defecto (30 a 120 en la pantalla). | Cuida la calidad del número. | `LIMITES_ENVIO`. |
| M6 | Máximo 10.000 destinatarios por envío y 20.000 contactos por archivo. | Más que eso no es una clínica; protege la memoria del navegador. | `LIMITES_ENVIO`, `MAX_CONTACTOS_POR_ARCHIVO`. |
| M7 | La imagen va en la base, no en disco ni en un almacenamiento externo. | El contenedor de la API no tiene volumen; el id de Meta vence. | — |
| M8 | La IA solo a pedido (columnas, texto, imagen). | Cuesta tokens; las reglas ya cubren lo grave. | — |
| M9 | Una baja vale para todos los comunicados de la clínica, no por lista. | Es lo que la persona espera. | — |
| M10 | Los envíos y las listas no se purgan solos. | Son la constancia de a quién se le escribió. | Un proceso de retención (§11). |

## 11. Pendiente

- **De cada clínica**: las dos plantillas aprobadas en Meta y registradas; la autorización en su formato de datos.
- **Posibles mejoras**: leer el botón «Detener promociones» de Meta como baja (hoy solo el texto), variables extra por contacto (la sede, la EPS), programar la hora de salida, retención de las listas y los envíos, correo.

## 12. Pruebas

- `packages/shared`: contactos (formatos, encabezados, Google Contactos, vCard, texto libre, descartes, muestra tapada, mapeo de la IA), texto (cada regla y el arreglo automático), imagen (firmas, reglas, recorte), envío (horario con festivos y estimación, frases de baja, errores de Meta) y el menú.
- `apps/api`: el envío completo con una base en memoria (previa, confirmación, foto con bajas, vuelta, horario, imagen, fallos de la persona y de la clínica, baja tardía, pausa en mitad de la tanda, cancelar, reintentar, prueba), la baja por chat, la lectura de Meta y de la IA, la imagen en los tres proveedores y el encabezado de imagen de `sendTemplate`.
- `apps/web`: las acciones (solo el administrador, consentimiento, normalización en el servidor, imagen por sus bytes, confirmación, errores de la API, lista usada, bajas), la lectura de Windows-1252, la vista previa y el editor.

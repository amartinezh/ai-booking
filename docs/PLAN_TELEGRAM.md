# Canal de Telegram

**Estado: FASES 0 a 4 HECHAS (2026-09-28).** Falta la Fase 5 (encender en la clínica de prueba). Fases 0-3 en `bc0e917`, `b018cc7`, `9371eaf`, `6ea8f3e`; Fase 4 sin commit. Decisiones aprobadas. El usuario aprobó T1 … T9 (§5) el 2026-09-28 tal como estaban recomendadas; en T4 se confirmó además la caída a WhatsApp.

## 1. Qué se pide

1. Telegram como **driver aparte**, sin tocar lo que hay.
2. Que se configure **fácil desde el panel**.
3. Que conviva con WhatsApp: el mismo paciente puede escribir por uno y por el otro sin que se crucen.
4. Que el ajuste **no dañe nada** del bot de WhatsApp.
5. Que no falle.

**Lo que NO hace este plan:** no lleva a Telegram los avisos masivos ni las plantillas de Meta (§5, T7), no toca grupos ni canales de Telegram (solo chats privados con el bot) y no reescribe el bot como «multicanal genérico» (§3, por qué no).

## 2. Cómo está hoy (lo que manda el diseño)

El bot entero (`chatbot.service.ts`, 9 136 líneas) es **un solo flujo** que no sabe de canales. Lo único acoplado a WhatsApp son estos puntos:

| Punto | Dónde | Qué hace |
|---|---|---|
| Entrada | [`chatbot.controller.ts`](../apps/api/src/chatbot/chatbot.controller.ts) `POST /chatbot/webhook` | Firma de Meta, dedup por wamid, cola por remitente |
| Quién escribió | [`sender-identity.ts`](../apps/api/src/chatbot/sender-identity.ts) | `senderId` = BSUID ?? teléfono ?? PSID |
| De qué clínica | [`chatbot.service.ts:2697`](../apps/api/src/chatbot/chatbot.service.ts#L2697) `resolveTenant` | `phone_number_id` → `WhatsappAccountConfig`; guarda `origin_org:${senderId}` |
| Enviar texto | [`chatbot.service.ts:579`](../apps/api/src/chatbot/chatbot.service.ts#L579) `sendWhatsAppMessage` | Graph API. **25 llamadas directas + 107 vía `smartReply`**: todo texto sale por aquí |
| Enviar voz | [`chatbot.service.ts:1570`](../apps/api/src/chatbot/chatbot.service.ts#L1570) y `smartReply` ([:1616](../apps/api/src/chatbot/chatbot.service.ts#L1616)) | TTS en OGG → sube a Meta → manda audio |
| Bajar voz | [`chatbot.service.ts:741`](../apps/api/src/chatbot/chatbot.service.ts#L741) `downloadWhatsAppAudio` | media id de Meta → buffer → Gemini |
| Cierre por inactividad | [`chatbot.cron.ts:115`](../apps/api/src/chatbot/chatbot.cron.ts#L115) | Llama a Meta **directo**, sin pasar por `sendWhatsAppMessage` |
| Recordatorio | [`appointment-reminder.cron.ts:262`](../apps/api/src/appointment-reminder/appointment-reminder.cron.ts#L262) | Destino = `bsuid ?? whatsappId`; ventana 24 h o plantilla |
| Confirmación HIS | [`his-confirmation.service.ts:163`](../apps/api/src/appointment-reminder/his-confirmation.service.ts#L163) | Igual que el recordatorio |

Y lo que **ya funciona a favor**:

- **Todas** las claves de sesión en Redis llevan el `senderId` (`chat_state:${org}:${senderId}`, `error_count:…`, `temp_slot_*:…`, `origin_org:${senderId}`, `last_sent:${senderId}`…). Si el `senderId` de Telegram no puede coincidir con ninguno de WhatsApp, las dos conversaciones quedan separadas **sin tocar una sola clave**.
- La lista de espera guarda el `senderId` en `WaitlistEntry.whatsappId` y luego le escribe con `sendWhatsAppMessage` ([:9066](../apps/api/src/chatbot/chatbot.service.ts#L9066)). Si ese envío sabe enrutar, la lista de espera por Telegram funciona sola.
- El paciente se enlaza **por cédula** dentro de la clínica ([:1828](../apps/api/src/chatbot/chatbot.service.ts#L1828)), no por teléfono: quien agenda por WhatsApp y después escribe por Telegram con la misma cédula es **la misma ficha**.
- La cita va al HIS si su origen no es `MIRROR` ([`mirror-dispatch.service.ts:171`](../apps/api/src/mirror/mirror-dispatch.service.ts#L171)): una cita de Telegram llega al hospital sin tocar el espejo.
- El TTS ya sale en OGG ([:1539](../apps/api/src/chatbot/chatbot.service.ts#L1539)), que es lo que Telegram pide para notas de voz; y las notas de voz de Telegram también son OGG/Opus, lo mismo que Gemini ya transcribe de WhatsApp.

## 3. El diseño

### La idea en una línea

**El remitente de Telegram se llama `tg:<chat_id>`.** Ese prefijo es la única marca de canal que necesita el bot: separa sesiones, separa claves de Redis y decide por dónde sale cada mensaje.

Por qué es seguro para WhatsApp: todo identificador de WhatsApp es un teléfono (solo dígitos), un BSUID (`CO.…`) o un PSID (dígitos). **Ninguno empieza por `tg:`**. Cada punto que se toca en el bot queda como:

```ts
if (isTelegramSender(id)) { /* camino nuevo */ return ...; }
// … código de WhatsApp idéntico al de hoy …
```

Para cualquier identificador de WhatsApp la condición es falsa y se ejecuta **exactamente** el código actual. Eso es lo que hace verificable el punto 4: el camino de WhatsApp no cambia, solo gana una puerta de salida antes.

### El recorrido

```
Telegram ──► POST /telegram/webhook/:routeKey        (módulo nuevo apps/api/src/telegram/)
               │ 1. routeKey → TelegramBotConfig → organizationId
               │ 2. header X-Telegram-Bot-Api-Secret-Token == secreto de ESA clínica
               │ 3. solo chat privado, solo texto / voz (lo demás: aviso amable)
               │ 4. dedup por update_id (InboundQueueService.admit, clave "tg:<bot>:<update_id>")
               │ 5. adapta el Update a WhatsappInboundEvent con channel:'telegram'
               ▼
        InboundQueueService.enqueue("tg:<chat_id>", …)      ← la misma cola, misma serialización
               ▼
        ChatbotService.processIncomingMessage(event)        ← el mismo bot
               │ resolveSenderIdentity → senderId "tg:<chat_id>"
               │ resolveTenant → org del evento (ya validada por el controller)
               ▼
        … todo el flujo de hoy (EPS, servicios, alta, padrón, cupos, HIS) …
               ▼
        sendWhatsAppMessage("tg:…")  → TelegramSender.sendText  (sendMessage)
        smartReply en modo voz       → TelegramSender.sendVoice (sendVoice, OGG)
```

### Por qué no otras opciones

- **Un bot de Telegram aparte que copie el flujo**: 9 000 líneas duplicadas; cada arreglo del bot (como los de régimen de esta semana) habría que hacerlo dos veces y tarde o temprano divergen. Es lo que más falla con el tiempo.
- **Refactorizar ya a una interfaz `ChannelAdapter` para todos los envíos**: es lo «bonito», pero obliga a reescribir los 132 sitios de envío de WhatsApp. Justo lo que el punto 4 prohíbe. Queda como posible paso posterior, cuando Telegram esté probado en producción.

## 4. Qué hay que construir

### 4.1 Módulo nuevo `apps/api/src/telegram/` (el «driver»)

| Archivo | Qué hace |
|---|---|
| `telegram.module.ts` | Módulo Nest; se registra en `app.module.ts` detrás de `TELEGRAM_ENABLED` (T9) |
| `telegram-api.client.ts` | `getMe`, `setWebhook`, `deleteWebhook`, `getWebhookInfo`, `sendMessage`, `sendVoice`, `sendChatAction`, `getFile` + descarga. Timeouts, reintento con `retry_after` en 429, nunca lanza al llamador |
| `telegram-config.service.ts` | Credenciales por clínica: token cifrado con el `CryptoService` que ya usa WhatsApp; `forOrg(orgId)` como `WhatsappCredentialsService.forOrg` |
| `telegram-config.controller.ts` | `GET/POST/DELETE /telegram-config`, `POST /telegram-config/test`, `ORG_ADMIN` |
| `telegram.controller.ts` | `POST /telegram/webhook/:routeKey` (§3) |
| `telegram-inbound.adapter.ts` | `Update` → `WhatsappInboundEvent` (función pura, fácil de probar) |
| `telegram-sender.service.ts` | `sendText(senderId, text, ctx)` / `sendVoice(senderId, ogg, ctx)`; resuelve la clínica con el mismo `origin_org:${senderId}` que usa WhatsApp; registra en su libro (T6) |
| `telegram-identity.ts` | `isTelegramSender(id)`, `toTelegramSenderId(chatId)`, `chatIdFromSender(id)` |

### 4.2 Base de datos (migración solo aditiva)

```prisma
model TelegramBotConfig {
  id                     String   @id @default(uuid())
  organizationId         String   @unique
  botId                  String?  @unique   // de getMe: un bot no puede ser de dos clínicas
  botUsername            String?            // "@ClinicaXBot", para mostrar y armar t.me/…
  encryptedBotToken      String?  @db.Text  // AES-256-GCM, igual que el token de Meta
  webhookRouteKey        String   @unique   // aleatorio, va en la URL del webhook
  encryptedWebhookSecret String?  @db.Text  // secret_token que Telegram devuelve en cada POST
  isActive               Boolean  @default(false)
  lastWebhookSetAt       DateTime?
  lastError              String?
  createdAt / updatedAt
}

PatientProfile.telegramChatId String?    + @@unique([organizationId, telegramChatId])
enum AppointmentOrigin { …, TELEGRAM }    // aditivo
```

Nada existente cambia de tipo ni de nombre. `WaitlistEntry.whatsappId` e `InteractionLog.whatsappId` guardan `tg:…` tal cual (son texto libre y el prefijo evita cualquier cruce); renombrarlas sería tocar lo que funciona.

### 4.3 Los puntos que se tocan en el bot (todos con la guarda `isTelegramSender`)

| # | Dónde | Cambio |
|---|---|---|
| 1 | `sender-identity.ts` | Si `event.channel === 'telegram'`: `senderId = tg:<chat_id>`, `phone = null`, `bsuid = null`, `telegramChatId`. Rama nueva **antes** de la de hoy |
| 2 | `resolveTenant` | Si es Telegram: la org viene del evento (el controller ya la validó); **no** marca la ventana de 24 h (Telegram no tiene). El `origin_org` se guarda igual que hoy |
| 3 | `sendWhatsAppMessage` | Primera línea: si es Telegram → `telegramSender.sendText` |
| 4 | `smartReply` (modo voz) | Si es Telegram: TTS → `sendVoice` directo (no hay que «subir» el audio) |
| 5 | `transcribeAudioTurn` | Si es Telegram: bajar el audio con `getFile` en vez de `downloadWhatsAppAudio` |
| 6 | `ensurePatientPersisted` ([:1866](../apps/api/src/chatbot/chatbot.service.ts#L1866)) | Si es Telegram: **no** guardar el `senderId` en `whatsappId` (hoy lo haría: `identity.phone ?? senderId`) y sí en `telegramChatId` (solo si está vacío o cambió, igual que el BSUID) |
| 7 | `handleRecordatorios` ([:3539](../apps/api/src/chatbot/chatbot.service.ts#L3539)) | **Riesgo real encontrado**: hoy quita los no-dígitos del remitente y busca por teléfono. `tg:3001234567` → `3001234567`, que puede ser el celular de **otro** paciente, y se le apagarían sus recordatorios. Para Telegram: buscar solo por `telegramChatId` |
| 8 | Crear la cita ([:6569](../apps/api/src/chatbot/chatbot.service.ts#L6569), [:8308](../apps/api/src/chatbot/chatbot.service.ts#L8308)) | Origen `TELEGRAM` en vez de `WHATSAPP` cuando corresponde |
| 9 | `chatbot.cron.ts:108` | El aviso de cierre por inactividad llama a Meta directo: si la clave es `tg:…`, mandarlo por `telegramSender`. Sin esto, a los de Telegram se les cerraría la sesión en silencio y se intentaría un envío a Meta que falla |
| 10 | Recordatorio y confirmación HIS | Elegir canal según T4; si es Telegram, texto libre (no hay ventana ni plantilla) |

Los mensajes que dicen «WhatsApp» (encuesta, textos de `chatbot.constants.ts`) se revisan: donde el texto nombre el canal, se pasa a neutro o se parametriza. Es texto, no lógica. **Resuelto (2026-09-28): cada canal nombra el suyo.** Cuatro textos al paciente nombraban el canal (`epsInvalida` y `unidoAWaitlist`, en los estilos formal e informal: «no puedo agendar esa EPS por WhatsApp», «esté pendiente de su WhatsApp»). `buildMessages(estilo, canal)`: para WhatsApp devuelve **el mismo objeto de siempre** (el texto no cambió ni en un carácter; no se editó ninguno); para Telegram, una copia en la que los mensajes de `MENSAJES_QUE_NOMBRAN_EL_CANAL` dicen «Telegram». Los seis sitios del bot que arman `MSGS` pasan el canal del remitente. `chatbot.messages.canal.spec.ts` recorre los 96 mensajes de los dos estilos en todas sus variantes y falla si alguno dice «WhatsApp» por Telegram (así un texto nuevo que nombre el canal no se cuela).

### 4.4 Panel (`apps/web/app/dashboard/configuracion`, pestaña Integraciones)

Una tarjeta **«Canal de Telegram»** junto a la de WhatsApp (`TelegramChannelForm.tsx` + `app/actions/telegram-config.ts`). El usuario solo hace esto:

1. Abre @BotFather en Telegram, `/newbot`, copia el token. (La tarjeta trae estos pasos escritos.)
2. Lo pega en el panel y pulsa **Conectar**.

El backend hace todo lo demás, en este orden y **sin activar nada hasta que todo sale bien**:

1. `getMe` → valida el token, obtiene `botId` y `@usuario`; rechaza si ese bot ya es de otra clínica.
2. Genera `routeKey` y `secret_token` aleatorios, cifra y guarda.
3. `setWebhook(url = PUBLIC_API_URL/telegram/webhook/<routeKey>, secret_token, allowed_updates=["message"], drop_pending_updates=true)`.
4. `getWebhookInfo` → confirma que quedó registrado; solo entonces `isActive = true`.

La tarjeta muestra: estado (conectado / con error, con `last_error_message` de `getWebhookInfo`), el enlace `t.me/<usuario>` (con Copiar y Abrir) y su **QR** (`qrcode.react`, generado en el navegador, negro sobre blanco, con «Descargar QR (PNG)» a 1024 px para imprimir en la sede), botón **Verificar conexión** (`POST /telegram-config/verify`: si Telegram sigue apuntando a nosotros, mensajes retenidos y último error) y botón **Desconectar**. *Cambio en la Fase 1:* se descartó «Enviar mensaje de prueba» porque un bot no puede escribirle a nadie que no le haya escrito antes (`deleteWebhook` + `isActive=false`). El token nunca vuelve al navegador (solo «••••1234»).

Además, en lo que ve el personal:
- `lib/whatsapp.ts`: un `tg:…` se muestra como «✈️ Telegram» y **nunca** genera enlace `wa.me` (hoy el prefijo ya hace que `isWhatsappPhoneId` dé falso, así que no se inventa un número; solo falta la etiqueta).
- Agenda y dashboard: insignia «Telegram» para `origin === 'TELEGRAM'` (hoy solo pintan `WHATSAPP`, [`AppointmentModal.tsx:227`](../apps/web/app/dashboard/agendamiento/AppointmentModal.tsx#L227), [`client.tsx:161`](../apps/web/app/dashboard/agendamiento/client.tsx#L161), [`DashboardClient.tsx:217`](../apps/web/app/dashboard/components/DashboardClient.tsx#L217)).
- Ficha del paciente y rastreo: mostrar que tiene Telegram vinculado.
- Envío manual desde el panel (`POST /chatbot/outbound`): pasa por `smartReply`, así que funciona con `tg:…` sin cambios.

## 5. Las decisiones

### T1. ¿Cómo se enruta el webhook a la clínica?
**Aprobado (2026-09-28).**
**Recomendado: una URL por clínica (`/telegram/webhook/<routeKey>`) + `secret_token` por clínica.** Telegram no manda un «phone_number_id»; la URL es lo único que dice de qué bot viene. El `secret_token` va en un header que Telegram firma por nosotros: un POST sin él o con el de otra clínica se rechaza con 401 y no llega al bot. Es el equivalente a la firma de Meta.

### T2. ¿Webhook o polling?
**Aprobado (2026-09-28).**
**Recomendado: webhook.** Ya hay dominio público con TLS (Caddy) y es como funciona WhatsApp. Polling obligaría a un proceso que pregunte por cada bot y no escala con clínicas.

### T3. Mismo paciente por los dos canales, ¿una conversación o dos?
**Aprobado (2026-09-28).**
**Recomendado: dos conversaciones independientes, una sola ficha.** Cada canal tiene su sesión (el prefijo lo garantiza). Se unen en la ficha **por cédula**, como hoy. Si escribe a la vez por los dos, son dos sesiones; lo que no puede pasar —dos citas en el mismo cupo— ya lo impide la base de datos (índice único parcial del cupo), y las reglas de «ya tiene cita» miran la ficha, no el canal. Unir las sesiones en vivo exigiría saber que `tg:123` y `57300…` son la misma persona antes de que dé la cédula: no hay forma honesta de saberlo.

### T4. ¿Por dónde va el recordatorio si el paciente tiene los dos?
**Aprobado (2026-09-28): por el canal por el que agendó.** Cita `TELEGRAM` → Telegram; `WHATSAPP` o `MIRROR` → WhatsApp, exactamente como hoy. Así el recordatorio de WhatsApp de hoy no cambia para nadie que no haya usado Telegram.

**Aprobado (2026-09-28) — con caída a WhatsApp.** Si el canal elegido no está disponible (sin `telegramChatId`, bot de la clínica desconectado o inactivo, o Telegram responde 403 porque el paciente bloqueó al bot) → se envía por WhatsApp con la lógica de hoy (ventana de 24 h o plantilla), si el paciente tiene teléfono o BSUID. Solo quien tiene únicamente Telegram se queda sin recordatorio si Telegram falla, y eso queda registrado y visible en el panel. No afecta a nadie que solo use WhatsApp.

### T5. ¿Se pide el teléfono en Telegram?
**Aprobado (2026-09-28).**
**Recomendado: no, por defecto.** Telegram no entrega el número salvo que el paciente pulse «Compartir contacto». El bot ya pide cédula y datos de alta y con eso basta para agendar y enviar al HIS. Opcional por clínica más adelante: un botón «Compartir mi número» tras confirmar la cita, para tener respaldo por WhatsApp.

### T6. ¿Qué evidencia queda de lo enviado?
**Aprobado (2026-09-28).**
**Recomendado: un libro propio `TelegramMessageLog`** (org, chat, `message_id` que devuelve Telegram, tipo, `kind`, cita, ACCEPTED/FAILED, error). No mezclarlo con `WhatsappMessageLog`: aquel guarda estados de Meta (entregado/leído) que Telegram no reporta y su valor probatorio depende de la firma de Meta. El texto sigue solo en `InteractionLog`, igual que hoy.

### T7. ¿Avisos masivos y plantillas por Telegram?
**Aprobado (2026-09-28).**
**Recomendado: fuera de este plan.** Los avisos masivos salen del padrón del HIS por teléfono; en Telegram no se puede escribir a quien nunca le habló al bot. Se deja para una fase posterior («avisar también a los que tienen Telegram vinculado»).

### T8. ¿Qué se contesta a lo que el bot no entiende (fotos, stickers, grupos, `/start`)?
**Aprobado (2026-09-28).**
**Recomendado:** `/start` = el «Hola» de WhatsApp (saludo y menú). Foto/documento/sticker → un aviso amable («por ahora solo entiendo texto y notas de voz»). Grupos y canales → se ignoran y se registra en log. Mensajes editados → se ignoran (no se reprocesan turnos).

### T9. ¿Cómo se enciende?
**Aprobado (2026-09-28).**
**Recomendado: doble interruptor.** `TELEGRAM_ENABLED` en el entorno (si está apagado, el módulo no registra rutas y el bot se comporta byte a byte como hoy) y `isActive` por clínica. Se enciende primero en una clínica de prueba con un bot de prueba.

## 6. Que no falle

**Que no rompa WhatsApp**
- Todos los cambios del bot van tras la guarda `isTelegramSender`; se prueba con un test que recorre la guarda sobre teléfonos, BSUID (`CO.…`), PSID y cadenas raras y exige `false`.
- Los 120+ tests actuales de la API, más `chatbot.flows.e2e.spec.ts` (2 353 líneas de flujos de WhatsApp), deben pasar **sin editarlos**. Si alguno hay que cambiar, es señal de que se tocó WhatsApp y se revisa.
- Build de la API y del web y `lint` (regla de fechas) antes de subir.

**Que Telegram en sí no falle**
- El webhook **siempre** contesta 200 rápido y procesa en la cola (Telegram reintenta lo que no recibe 200 y bloquea el resto de mensajes de ese bot mientras tanto). Si la cola está saturada se libera el dedup y se devuelve 503 para que Telegram reintente. Esto es **distinto** de WhatsApp, que hoy libera el dedup pero igual responde 200 ([`chatbot.controller.ts`](../apps/api/src/chatbot/chatbot.controller.ts), `dispatch`); no se cambia allí.
- Dedup por `update_id` (Telegram reenvía). Serialización por `tg:<chat_id>` con la misma cola: los mensajes de un paciente se procesan en orden.
- Límites de Telegram: ~1 mensaje/segundo por chat, ~30/s por bot. El cliente respeta `retry_after` en 429 y espacia los envíos en ráfaga (el bot a veces manda 2-3 mensajes seguidos).
- Textos de más de 4 096 caracteres se parten. El formato de WhatsApp (`*negrita*`, `_cursiva_`, `~tachado~`, ```mono```) se traduce al **HTML** de Telegram (nunca Markdown, que rompe con 400 ante un asterisco suelto), escapando antes `& < >`; si Telegram aun así rechaza el HTML, el trozo se reenvía en texto plano sin marcas (Fase 4).
- 403 «bot was blocked by the user» → se registra y se marca en la ficha; el recordatorio cae a WhatsApp (T4).
- Token revocado en BotFather (401) → `isActive=false`, `lastError`, aviso en el panel y en el monitor de servicios.
- Un fallo de Telegram nunca lanza hacia el bot: igual que `sendWhatsAppMessage`, devuelve `null` y se registra.

**Pruebas**
- Unitarias: adaptador `Update → evento`, identidad, controller (secreto inválido, routeKey desconocido, org inactiva, grupo, duplicado), cliente (429, 403, 401, texto largo).
- El bot: un `describe` nuevo que corre flujos clave de `chatbot.flows.e2e.spec.ts` con un remitente `tg:…` (agendar, alta nueva, cancelar, reprogramar, lista de espera, voz) y comprueba que **ningún** envío fue a la Graph API y que la cita queda con origen `TELEGRAM`.
- Convivencia: la misma cédula por WhatsApp y por Telegram → una ficha, dos sesiones, sin mezclar estado; `handleRecordatorios` desde Telegram no toca al paciente cuyo celular coincide con el chat_id.
- Contra BD real (Postgres en Docker, como en los planes anteriores): migración sin deriva y recorrido completo con el HIS en modo prueba.
- Manual: bot de prueba en una clínica de prueba, desde un teléfono real.

## 7. Fases

| Fase | Qué | Se puede subir sola |
|---|---|---|
| 0 ✅ | Migración aditiva `20260928100000_canal_telegram` + `@agenia/shared/telegram-identity` (`isTelegramSender`, `toTelegramSenderId`, `chatIdFromTelegramSender`) con sus tests; `TELEGRAM` en `OrigenCita` del rastreo y su etiqueta en el expediente | Sí: no cambia comportamiento |
| 1 ✅ | Módulo `telegram/`: `TelegramCoreModule` (cliente, config, envío + libro) y `TelegramModule` (webhook + endpoints del panel, solo con `TELEGRAM_ENABLED=true`) | Sí, apagado. **No encender antes de la Fase 2** |
| 2 ✅ | Puntos 1-9 del bot (§4.3; el 10 es la Fase 4) + suite de conversaciones con `tg:` + regresión de WhatsApp | Sí, apagado. Desde aquí el interruptor ya se puede encender en la clínica de prueba |
| 3 ✅ | Panel: tarjeta de configuración, etiquetas, insignias. Rastreo: las ramas `origin === 'WHATSAPP'` de `patient-trace.ts` (líneas ~1031, ~1061, ~1581: confirmación y paso «Conversación») deben reconocer también `TELEGRAM` y leer `TelegramMessageLog` | Sí |
| 4 ✅ | Recordatorio y confirmación HIS por canal (T4, con caída a WhatsApp) + formato de WhatsApp traducido a HTML de Telegram + QR en el panel | Sí |
| 5 | Encendido en clínica de prueba → medir → primera clínica real | — |

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Se escapa un envío a WhatsApp que no pase por las funciones centrales (como pasó con el cron) | Buscar todo uso de `metaGraphUrl` / `buildWhatsappRecipient` fuera de esas funciones y cubrirlo; test que falle si un `tg:` llega a la Graph API |
| El `chat_id` numérico coincide con un teléfono en alguna búsqueda por dígitos | El prefijo `tg:` en todas partes; revisar cada `replace(/\D/g…)` sobre el remitente (hoy hay uno, §4.3 #7) |
| Formato de texto que Telegram rechaza | Texto plano, sin `parse_mode` |
| El paciente bloquea al bot y deja de recibir recordatorios | Caída a WhatsApp (T4) y marca en la ficha |
| Alguien descubre la URL del webhook | Sin el `secret_token` de esa clínica se rechaza |
| Telegram como canal para datos de salud | Los chats con bots **no** tienen cifrado de extremo a extremo (van cifrados hasta los servidores de Telegram). El bot ya evita enviar datos clínicos; conviene que el área legal de cada clínica lo apruebe antes de activarlo |

## 9. Qué hace falta de fuera

- `PUBLIC_API_URL` alcanzable desde internet en HTTPS por el puerto 443, 80, 88 u 8443 (Telegram solo llama a esos).
- Un bot de prueba creado en BotFather.
- Visto bueno de cada clínica sobre usar Telegram (§8, último riesgo).

## 10. Bitácora

**Fase 0 (2026-09-28).** Migración verificada en Postgres 15 desechable sobre una base con pacientes: entra en una transacción, cero deriva (`migrate diff --exit-code` = 0), filas previas intactas, `telegramChatId` único por clínica (el mismo chat en otra clínica sí entra), un `botId` no puede ser de dos clínicas, borrar la clínica borra su bot y su libro. Añadir `TELEGRAM` al enum lo detectó el typecheck del web en dos sitios del rastreo (tipo `OrigenCita` y etiquetas del expediente); se agregó el valor, sin cambiar lógica. Sin regresiones: API 2 120 tests, shared 870, web 928, `nest build` y `tsc` del web en verde, lint sin avisos de fechas.

**Fase 1 (2026-09-28).** Módulo `apps/api/src/telegram/` en dos piezas para que la Fase 2 no cree un ciclo: `TelegramCoreModule` (sin rutas; lo importará el bot) y `TelegramModule` (rutas; importa el bot). Lo único que se tocó fuera del módulo: `ChatbotModule` **exporta** `InboundQueueService` (misma instancia, un solo tope de concurrencia para los dos canales), `AppModule` registra `TelegramModule` solo con el interruptor, y `@agenia/database` exporta los tipos nuevos.

- Cliente: nunca lanza, un reintento ante 429 si la espera es ≤ 10 s, texto plano, partición a 4 096 caracteres cortando en salto de línea o espacio. El token va en la URL, así que ningún error se arma con la URL: un test verifica que no aparece en ningún log.
- Conectar: formato → `getMe` → un bot no puede ser de dos clínicas → se guarda apagado → `setWebhook` → `getWebhookInfo` confirma la URL → recién ahí se activa. Reconectar el mismo bot conserva la ruta y rota el secreto; cambiar de bot desengancha el viejo y renueva la ruta.
- Envío: libro `TelegramMessageLog` en cada envío (ACCEPTED/FAILED), 403 → `telegramBlockedAt` en la ficha de esa clínica, 401 → canal apagado con el motivo.
- Webhook: ruta desconocida y secreto inválido responden igual (401); canal inactivo → 200 sin procesar; dedup por `tg:<routeKey>:<update_id>`; cola llena → libera dedup y 503.

Verificado arrancando la API real (Postgres y Redis desechables): con el interruptor apagado las rutas de Telegram dan 404 y no se mapea ninguna; encendido, los 9 casos del webhook responden como se diseñó, el webhook de WhatsApp sigue igual, la foto disparó el aviso, el Telegram real rechazó el token falso con 401 y el canal se apagó solo, con su fila FAILED en el libro; el token no aparece en el log. Tal como se esperaba, el texto llegó al bot y este lo registró como «remitente no identificado»: enseñarle a reconocerlo es la Fase 2. API: 2 250 tests (130 nuevos), `nest build` y lint en verde.

**Fase 2 (2026-09-28).** El bot atiende Telegram. Los puntos 1-9 de §4.3, cada uno tras `isTelegramSender` / `telegramOriginOf`, con el código de WhatsApp textualmente igual (dentro del `else` o después del `return`; revisado línea borrada por línea borrada). Todo lo que el bot necesita de Telegram entra por una fachada, `TelegramChannelService`, inyectada con `@Optional()`: sin ella los tests de siempre construyen el bot igual y un `tg:` se pierde con log, pero nunca viaja a Meta. Red extra: `WhatsappTemplateService.sendTemplate` corta un `tg:` antes de llamar a Meta.

Tres cosas que aparecieron al hacerlo, las tres corregidas:

1. **🔏 Falsificación de canal.** La idea original era marcar el evento con campos normales (`channel`, `telegram.organizationId`). Pero el webhook de Meta pasa al bot los `messages[]` tal como vienen en el JSON: con `META_REQUIRE_SIGNATURE=false`, un payload inventado podía declararse de Telegram y elegir la clínica. La marca es ahora un `Symbol` (`TELEGRAM_ORIGIN`), que ningún JSON puede fabricar, y el webhook de WhatsApp no se tocó.
2. **Chat único por clínica (error de la Fase 0).** `@@unique([organizationId, telegramChatId])` impedía que una madre agendara para ella y para su hijo desde el mismo Telegram: la segunda ficha no se creaba y la cita no se reservaba. Migración `20260928110000_telegram_chat_no_unico` lo cambia por un índice normal (verificada en Postgres: entra sobre datos, cero deriva, dos fichas con el mismo chat).
3. **Ciclo de `import` que tumbaba la API.** `chatbot.module.ts` importaba el núcleo desde `telegram.module.ts`, que a su vez importa `ChatbotModule`: al cargar, uno quedaba `undefined` y la API **no arrancaba** con `TELEGRAM_ENABLED=true` (apagado no se notaba: `AppModule` ni carga el módulo). Ningún test unitario podía verlo; lo encontró el arranque real. `TelegramCoreModule` vive ahora en su propio archivo y `app.module.imports.spec.ts` recorre el grafo de módulos y falla si algún import queda `undefined` (probado: con el ciclo de vuelta, falla).

Pruebas: `chatbot.telegram.e2e.spec.ts` (17 conversaciones por el bot real: agendar paciente nuevo y existente, madre e hijo con el mismo chat, WhatsApp y Telegram a la vez sin mezclarse, baja de recordatorios que no toca al celular con los mismos dígitos, voz de ida y vuelta, lista de espera, mensaje del panel, clínica inactiva o borrada, canal ausente, payload de Meta que imita Telegram). Las credenciales de WhatsApp del doble están ACTIVAS a propósito, para que una fuga llegara de verdad a `http.post`. Mutación: se quitó cada una de las 8 guardas del bot, una a la vez, y cada mutante hizo fallar la suite. Más: cron de inactividad, identidad, fachada y red de plantillas. **Los 2 250 tests de antes pasan sin editar ninguno** (la suite de flujos de WhatsApp incluida); total API 2 294.

Arranque real (Postgres y Redis desechables, `TELEGRAM_ENABLED=true`): un `/start` por el webhook llegó al bot con la clínica correcta, el bot respondió por Telegram (el Telegram real rechazó el token falso y el canal se apagó solo), auditoría `tg:777 / org-tg / SUCCESS`, cero filas en el libro de Meta, el token no aparece en el log.

**Fase 3 (2026-09-28).** El panel conoce Telegram.

- **Tarjeta «Canal de Telegram»** (Configuración → Integraciones, bajo las plantillas de WhatsApp): tres estados. Con `TELEGRAM_ENABLED` apagado la API responde 404 y la tarjeta lo explica («no está habilitado en este servidor»), no es un error. Encendido y sin bot: los tres pasos de BotFather y un campo para el token. Conectado: @usuario, token •••últimos 4, fecha de conexión (con `@/lib/date`, hora de Bogotá), enlace `t.me` con Copiar/Abrir, **Verificar conexión** y **Desconectar**. Los errores de la API (`BadRequest` anidado por el filtro global) llegan a la clínica tal cual están redactados.
- **Una sola regla de canal, compartida:** `destinoDeContacto` en `@agenia/shared` (T4: el canal de la cita, con caída al otro; Telegram «no disponible» = sin chat o bloqueado). La usa ya el botón «Contactar» de la agenda y la usará el recordatorio en la Fase 4, para que los dos nunca contesten distinto. Para una cita de WhatsApp da el destinatario de siempre (BSUID ?? teléfono).
- **Etiquetas:** un `tg:` se muestra «✈️ Telegram» / «Chat <n>» y nunca genera `wa.me`; la auditoría dice «paciente de Telegram: use el envío manual» en vez de «ocultó su número». Lista de pacientes: insignia de Telegram (y «bloqueado» si aplica); un paciente solo de Telegram ya no sale como «No registrado». Agenda y dashboard: insignia para citas `TELEGRAM`, y «Contactar» también para ellas.
- **Rastreo:** la conversación se busca también bajo `tg:<chat>`; la confirmación de una cita de Telegram sale de `TelegramMessageLog` con su propio vocabulario (Telegram solo dice aceptada o fallida: el texto no inventa «leída» ni habla de Meta); la línea de vida cuenta la conversación del bot en Telegram. El libro de Telegram **solo se consulta si hay citas de Telegram**, así que el rastreo de un paciente de WhatsApp hace exactamente las mismas lecturas que antes (por eso sus 928 tests no se tocaron). El expediente dice «Telegram: vinculado / bloqueó al bot» sin mostrar el chat; el campo ni existe para un paciente de WhatsApp.

Verificado con web real (`next start`) contra la API real (Postgres y Redis desechables, `DATABASE_URL`, URLs de la API y `JWT_SECRET` sobrescritos): los tres estados de la tarjeta se ven como se diseñaron; conectar con token mal formado, falso (el Telegram real lo rechaza) o vacío devuelve el mensaje legible; «Verificar» con el token falso sembrado apagó el canal y la tarjeta pasó a «Desconectado» con el motivo. Tests: web 938 (10 nuevos), shared 893 (23 nuevos), API 2 294; `next build`, lint (solo los 4 avisos de `<img>` de siempre) y builds en verde.

**Fase 4 (2026-09-28).** El recordatorio y la confirmación del hospital, por canal.

- **Recordatorio** (`appointment-reminder.cron.ts`): el destino lo decide `destinoDeContacto` (la misma regla del botón «Contactar»). Cita `TELEGRAM` → Telegram, texto libre (no hay ventana ni plantilla); si Telegram no entrega → **WhatsApp por el camino de siempre** (ventana de 24 h o plantilla), si el paciente lo tiene. Cita de cualquier otro origen → WhatsApp idéntico a antes: el código de ventana/plantilla pasó tal cual a `sendViaWhatsapp`. Un paciente que bloqueó al bot va directo a WhatsApp. Un paciente solo de Telegram con cita del hospital antes se omitía; ahora le llega por Telegram. El envío manual del recordatorio acepta también a un paciente solo de Telegram (para WhatsApp la condición no cambió).
- **Confirmación de cita del HIS**: es `MIRROR`, así que sigue por WhatsApp y solo usa Telegram si el paciente no tiene WhatsApp (texto libre, nunca plantilla); la auditoría lleva `canal: 'TELEGRAM'` solo en ese caso.
- **Auditoría honesta**: un envío fallido a un `tg:` devuelve `telegram-send-failed`, no `meta-api-error`.
- **Formato**: apareció al revisar la confirmación: todos los textos del bot usan `*negrita*` de WhatsApp y por Telegram en texto plano el paciente vería los asteriscos. `telegram-format.ts` los traduce a HTML de Telegram (escape primero; los `_` de una URL no se vuelven cursiva) y el envío reenvía en texto plano si Telegram rechaza el formato. Solo afecta a Telegram.
- **QR** en la tarjeta del panel con `qrcode.react` 4.2.0 (sin dependencias, React 19, ISC).

Pruebas: recordatorio (13 casos: canal de la cita, caída con plantilla y con texto libre, bloqueado, solo Telegram, los tres orígenes de WhatsApp intactos), confirmación HIS (4), formato (15 + 4 en el envío), tarjeta con QR (8). Mutación: se quitó cada pieza nueva (canal Telegram, caída a WhatsApp, Telegram sin ventana, HTML, reenvío en texto plano) y cada mutante hizo fallar la suite. **Los 70 tests de recordatorios y confirmación de antes pasan sin editar**. Totales: API 2 327, shared 893, web 946; builds y lint en verde.

Arranque real (Postgres/Redis desechables, cita `TELEGRAM` de un paciente con los dos canales, recordatorio manual por HTTP): salió por Telegram con `kind APPOINTMENT_REMINDER` y la cita en el libro; el Telegram real rechazó el token falso (401), el canal se apagó solo y **cayó a WhatsApp**, que sin plantilla lo registró como no enviado; `reminderSentAt` quedó vacío (correcto: no salió).

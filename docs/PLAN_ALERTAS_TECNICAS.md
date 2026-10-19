# Alertas técnicas por Telegram

**Estado: FASES 0 A 3 HECHAS (2026-10-19), sin commit.** El usuario aprobó A1 … A13 (§7) tal como estaban recomendadas al pedir la Fase 0. Falta para producción (§12): crear el bot en @BotFather y vincular el grupo, bajar `MONITOR_BG_INTERVAL_MINUTES` a 5 en `.env.production`, desplegar (el vigía se instala solo con `update-vps.sh`) y crear el chequeo externo en UptimeRobot (A9). Sigue la Fase 4 (encender en producción y una semana mirando el ruido). Operación: [ALERTAS_TECNICAS.md](ALERTAS_TECNICAS.md).

- **Fase 0**: migración `20261019100000_alertas_tecnicas` (`TechAlertConfig`, `TechAlert`, `TECH_ALERTS_CONFIG_CHANGED`), índice único parcial `uq_tech_alert_abierta` en `non-prisma-ddl.sql` (verificado por `db:apply-sql`), y la lógica pura en [`packages/shared/src/alertas-tecnicas.ts`](../packages/shared/src/alertas-tecnicas.ts).
- **Fase 1**: módulo [`apps/api/src/tech-alerts/`](../apps/api/src/tech-alerts/) (configuración, `avisar`/`resolver`, despachador, controlador `SUPER_ADMIN`), `getUpdates`/`silent`/`migrate_to_chat_id` en el cliente de Telegram, la regla del bot en las dos direcciones, y la página [`/super-admin/alertas`](../apps/web/app/super-admin/alertas/). Nadie llama a `avisar` todavía: los enganches son la Fase 2.
- **Fase 2**: los chequeos ya avisan y resuelven (§11): centinela del monitor (caída al primer chequeo, latencia alta solo si se repite, recuperación, su propio fallo y su limpieza), `lastHisReachable` en el chequeo del espejo, recordatorios (cron y lote caído), retención, purga de avisos masivos, consultas al HIS, los dos barridos del HIS del bot, vigilante del espejo (por clínica y aviso al agendador que no sale), esquema del espejo, 5xx con firma nueva y ráfagas, excepciones del proceso, Redis, arranque y reinicios en bucle; limpieza de la bitácora a 180 días; centinela a 5 min por defecto.
- **Fase 3**: el vigía del servidor [`deploy/vigia.sh`](../deploy/vigia.sh) (contenedores, reinicios, panel, disco, respaldo; cron cada minuto vía `agenia vigia instalar`, que dejan el instalador y `update-vps.sh`), la configuración que la API le escribe en `/var/lib/agenia/alertas/telegram.env`, su latido en el panel, la ventana de mantenimiento de los despliegues, la versión desplegada en el aviso de arranque, y la guía de operación con el chequeo externo (A9).

## 1. Qué se pide

1. Ante un fallo, **escribir de inmediato** a un Telegram del equipo técnico qué pasó, para que alguien entre a revisar.
2. **Reusar los chequeos que ya existen** (los crones de vigilancia), no inventar otro monitor.
3. Es **solo del super admin**. El administrador de la clínica no lo ve, no lo configura y no recibe nada.
4. Se configura **desde el panel del super admin**.

**Lo que NO hace este plan:** no avisa a las clínicas; no reemplaza la bandeja de excepciones del espejo ni el aviso al agendador por WhatsApp (eso es operación de la clínica, §3.2); no manda datos de pacientes (§3.4); no gasta un solo token de IA: los textos son fijos, armados por código (regla del usuario, ver «Canales en vivo»).

## 2. Cómo está hoy

### 2.1 Los chequeos que ya corren

| Chequeo | Dónde | Frecuencia en producción | Qué vigila | Qué hace hoy ante un fallo |
|---|---|---|---|---|
| **Centinela del monitor** | [`monitor.cron.ts`](../apps/api/src/monitor/monitor.cron.ts) | cada **15 min** (`MONITOR_BG_INTERVAL_MINUTES=15`) | Gemini (`ping`, 0 tokens), Google TTS (omitido si está apagado), Meta (solo la clínica «testigo»), espejo (dead-letter, cola sin avanzar, latido del agente), Telegram (webhook de cada clínica) | Abre/cierra un `ServiceIncident`. Solo se ve si alguien abre `/super-admin/monitor` |
| Vigilante del espejo | [`mirror-watchdog.service.ts`](../apps/api/src/mirror/mirror-watchdog.service.ts) | cada 2 min | Citas que no llegan al HIS, conflictos, deriva | Abre `SyncException` y avisa al **agendador de la clínica** por WhatsApp (plantilla) |
| Esquema del espejo | [`mirror-schema-check.service.ts`](../apps/api/src/mirror/mirror-schema-check.service.ts) | al arrancar | Que existan los triggers del outbox | Solo un `warn` en el log del contenedor |
| Recordatorios | [`appointment-reminder.cron.ts`](../apps/api/src/appointment-reminder/appointment-reminder.cron.ts) | cada 15 min | — | Fallos por cita a `SystemLog`; si el lote entero revienta, **solo al log** |
| Retención, purga de avisos masivos, limpieza del monitor | `retention.service.ts`, `mass-notice.service.ts`, `monitor.cron.ts` | 03:00–03:30 | — | Solo al log (la limpieza del monitor ni siquiera tiene `catch`) |
| Crones del bot y del espejo | `chatbot.cron.ts` (1 min), `chatbot.service.ts` (10 s y 5 s), `mirror-lookup.service.ts` (1 min), `waitlist.service.ts` (5 min) | — | — | Solo al log |
| Errores 5xx | [`global-exception.filter.ts`](../apps/api/src/system-log/global-exception.filter.ts) | cada petición | — | Fila en `SystemLog` (una por firma cada 60 s) |
| Excepciones sueltas del proceso | [`main.ts:15`](../apps/api/src/main.ts#L15) | — | `unhandledRejection`, `uncaughtException` | Solo al log |
| **Servidor** (VPS) | `/etc/cron.d/agenia-backup` | 03:30 | Respaldo diario de la base | Escribe en `/var/log/agenia-backup.log`; nadie lo lee |
| Docker | `docker-compose.deploy.yml` | 10 s | Salud de db, redis, api, web | Reinicia el contenedor (`unless-stopped`) **sin decirle a nadie** |

En el servidor **no hay ningún otro cron ni timer propio** (revisado hoy por SSH, solo lectura): nada vigila el disco, los reinicios de contenedores ni que el respaldo haya salido. La caché de Docker de 51 GB del 2026-10-17 se encontró a mano.

### 2.2 Lo que dicen los datos de producción (medido hoy, solo lectura)

- **5 incidentes en 30 días**: 3 del espejo (2 «sin latido del agente», 1 «la cola no avanza») y 2 de latencia alta, Gemini y Meta, **en el mismo segundo** (12-oct 09:00:05) y que duraron exactamente un ciclo (14,9 min).
- **0 errores y 0 advertencias** en `SystemLog` en 30 días.
- 1 super admin, 1 clínica activa, espejo y Telegram encendidos.

Qué se concluye:

1. **El volumen es bajo**: un canal de Telegram no se va a volver ruido, siempre que no avise de los picos de latencia de un solo chequeo. Los dos del 12-oct fueron eso: un parpadeo de red del VPS, no una caída de Google ni de Meta.
2. **Hoy no se cumple «de inmediato»**: el incidente del 18-oct se abrió diciendo «sin latido del agente **hace 34 min**». Con el centinela cada 15 min, una caída tarda hasta 15 min más el umbral en verse, y después alguien tiene que abrir el panel.
3. **Los fallos de los crones son invisibles**: no escriben en `SystemLog`, solo en el log del contenedor, que nadie mira.

### 2.3 Lo que ya sirve y se reutiliza

- [`TelegramApiClient`](../apps/api/src/telegram/telegram-api.client.ts): **nunca lanza**, **nunca escribe el token en un log** y reintenta una vez ante un 429. Se usa tal cual; solo le faltan `getUpdates` y leer `migrate_to_chat_id` (§3.1).
- `CryptoService` (AES-256-GCM), el mismo que cifra los tokens de Meta y de los bots de las clínicas.
- `RolesGuard` + `@Roles('SUPER_ADMIN')`, y el layout de `/super-admin` que ya redirige a quien no lo es.
- Los puntos exactos donde enganchar: `openIncident` y `closeIncident` del centinela **ya son las transiciones** caído/recuperado. Y como el centinela reconstruye los incidentes abiertos al arrancar, un reinicio no duplica avisos.
- El patrón del aviso al agendador ([`mirror-alert.service.ts`](../apps/api/src/mirror/mirror-alert.service.ts)): un mensaje por vuelta con el resumen, reclamación con compare-and-set para dos réplicas, y una prueba que garantiza que no sale ningún dato del paciente.

### 2.4 Huecos que este plan cierra

1. Detección lenta: 15 min.
2. **Si se cae la API o la base, nada dentro de la API puede avisar.** Y esas son justo las fallas más graves.
3. Los fallos de los crones solo van al log.
4. El chequeo del espejo **no mira `lastHisReachable`**: si el agente late pero no alcanza la base del hospital, solo se nota a los 10 min de cola quieta, y solo si hubo movimiento de citas en ese rato.
5. Servidor sin vigilancia: respaldo, disco y reinicios de contenedores.
6. (Conocido, fuera de este plan) Gemini y Meta se validan solo contra la clínica «testigo».

## 3. El diseño

### La idea en una línea

**Un bot de Telegram propio de la plataforma**, distinto de los bots de las clínicas, configurado en `/super-admin/alertas`, y un servicio `TechAlertService.avisar(evento)` al que llaman los chequeos que ya existen. Todo aviso pasa por una tabla en la base con antirrepetición, y un **vigía en el servidor** cubre lo que la API no puede ver de sí misma.

```
 Fuentes (lo que ya existe)                   Núcleo nuevo (apps/api/src/tech-alerts/)
 ─────────────────────────                    ───────────────────────────────────────
 Centinela abre / cierra incidente ──┐
 Un cron revienta (su catch) ────────┤        TechAlertService.avisar(evento)
 Error 5xx con firma nueva ──────────┼──►       · clave de antirrepetición + gravedad
 Arranque de la API ─────────────────┤          · texto fijo, sin datos de pacientes
 Esquema del espejo incompleto ──────┤                    │
 Aviso al agendador que no sale ─────┘                    ▼
                                              TechAlert (tabla, una fila por problema)
                                                          │ envío inmediato; si falla,
                                                          │ reintento cada minuto
                                                          ▼
                                              TelegramApiClient.sendMessage ──► Grupo «AgenIA · Técnico»
                                                                                    ▲
 Vigía del servidor (cron cada minuto) ─────────────────────────────────────────────┘
   API sin responder, contenedor caído o reiniciándose, disco, respaldo
```

### 3.1 El bot y el grupo

- **Bot nuevo en @BotFather** (ej. `@AgeniaTecnicoBot`). No sirve el bot de una clínica: esos tienen webhook (con webhook, `getUpdates` falla con 409) y en ellos escriben pacientes. Se valida en las dos direcciones: conectar el bot de alertas rechaza un `botId` que ya sea de una clínica, y conectar el bot de una clínica rechaza el de alertas.
- **Destino: un grupo del equipo técnico.** Todos ven lo mismo y cualquiera puede contestar «lo tomo».
- **Vincular el grupo sin teclear el `chat_id` y sin ruta pública nueva:**
  1. El panel muestra un código de un solo uso: `/vincular 4F7K2` (vence en 15 min).
  2. Alguien agrega el bot al grupo y escribe ese comando.
  3. En el panel, «Buscar el grupo» llama a `getUpdates` **una vez, a demanda**, encuentra el mensaje con el código, guarda el `chat_id` y el nombre del grupo, y manda «✅ Este grupo recibirá las alertas técnicas de AgenIA».

  Por qué así: el proxy del servidor es una **lista blanca** de rutas, y un webhook obligaría a abrir una ruta nueva en el Caddyfile y a protegerla. Con `getUpdates` el bot no recibe nada de internet. Solo puede vincular quien ve el código en el panel. Y los comandos le llegan al bot aunque tenga activo el modo privacidad de grupos.
- **Grupo que pasa a supergrupo**: Telegram cambia el `chat_id` y contesta 400 con `migrate_to_chat_id`. Se guarda el nuevo y se reenvía, sin intervención.
- **Token** cifrado con `CryptoService`; el panel muestra solo los últimos 4 caracteres.
- Es **independiente de `TELEGRAM_ENABLED`**, que es el interruptor del canal de pacientes. `TelegramCoreModule`, que trae el cliente, ya se carga siempre porque lo importa el monitor.

### 3.2 Qué avisa

| Código | Fuente | Cuándo | Gravedad | ¿Avisa cuando se resuelve? |
|---|---|---|---|---|
| `SERVICIO_CAIDO` | Centinela, `openIncident` con `DOWN` | Al primer chequeo fallido | 🔴 Crítica | Sí, con la duración |
| `SERVICIO_DEGRADADO` | Centinela, `DEGRADED` | Al primero, salvo latencia alta: esa solo si se repite en **2 chequeos seguidos** (A5) | 🟠 Advertencia | Sí |
| `SERVICIO_EMPEORA` | Centinela: de `DEGRADED` a `DOWN` con el incidente abierto (hoy no se registra) | Al cambio | 🔴 Crítica | — |
| `ESPEJO_SIN_HIS` | Chequeo del espejo, **nuevo**: `lastHisReachable = false` (A11) | Al primero | 🔴 Crítica | Sí |
| `CRON_FALLO` | El `catch` de cada cron (recordatorios, retención, purgas, limpieza del monitor, vigilante por clínica, el propio centinela) | Al primero; crítica si falla 3 veces seguidas | 🟠 → 🔴 | Sí, cuando la siguiente vuelta sale bien |
| `RECORDATORIOS_FALLIDOS` | Resumen del lote de recordatorios | Lote con `failed > 0` y `sent = 0` | 🔴 Crítica | Sí |
| `AVISO_AGENDADOR_NO_SALE` | Vigilante del espejo: `ResultadoAviso` con `SIN_PLANTILLA`, `SIN_DESTINO` o `ENVIO_FALLIDO` | Al primero | 🟠 Advertencia | Sí |
| `ERROR_5XX` | Filtro global: firma nueva de error (A10) | Una vez por firma cada 60 min; crítica si son ≥ 20 en 5 min | 🟠 → 🔴 | No (son eventos sueltos) |
| `API_ARRANCO` | Arranque de la API | Siempre (sirve además como aviso de despliegue); **2 arranques en 10 min = reinicios en bucle** | ℹ️ sin sonido → 🔴 | — |
| `ESQUEMA_ESPEJO` | Chequeo del esquema al arrancar | Faltan triggers con el espejo encendido | 🔴 Crítica | — |
| `REDIS_ERROR` | Evento `error` del cliente de Redis | Al primero | 🔴 Crítica | Sí, al reconectar |
| `PROCESO_EXCEPCION` | `unhandledRejection` / `uncaughtException` | Una vez por firma cada 60 min | 🟠 Advertencia | — |
| Del vigía (§3.6) | Servidor | API sin responder, contenedor caído o con reinicios, disco > 80 % / > 90 %, respaldo del día ausente a las 04:30 | 🔴 / 🟠 | Sí |

**Lo que NO va, a propósito:** las excepciones de la bandeja del espejo (cita no entregada, conflicto). Son operación de la clínica y ya le llegan al agendador. Sí llega su causa técnica (dead-letter, agente sin latido, cola quieta, HIS inalcanzable) por el centinela, y llega si el aviso al agendador **no sale**, que eso sí es una falla técnica. Tampoco van los errores de Meta por destinatario (número sin WhatsApp, etc.): no son fallas del sistema.

### 3.3 Cómo se cuida al equipo del ruido

- **Un mensaje por problema, no por chequeo.** Clave = `fuente:servicio:código` (ej. `monitor:mirror:MIRROR_UNHEALTHY`). Mientras el problema siga abierto, otro fallo igual solo suma `ocurrencias`.
- **La recuperación cierra el problema** y dice cuánto duró.
- **Si sigue abierto, se recuerda** cada 60 min, máximo 3 veces (A7).
- **Agrupar lo simultáneo:** si el mismo chequeo abre varios problemas, van en **un solo mensaje** («2 servicios con latencia alta»). Es el caso del 12-oct.
- **Intermitencia:** si una clave se abre y cierra más de 3 veces en 30 min, sale un solo «⚠️ intermitente» y esa clave se silencia 30 min.
- **Tope general:** máximo 20 mensajes cada 10 min; el resto se junta en un «y 14 alertas más — ver el panel». Queda por debajo del límite de Telegram (~20 mensajes por minuto en un grupo).
- **De noche** (22:00–06:00, hora Colombia) las advertencias llegan sin sonido (`disable_notification`); las críticas siempre suenan (A7).
- **Silenciar desde el panel** por 1 h, 4 h o hasta mañana, para mantenimientos o despliegues planeados. Silenciar no pierde nada: los problemas quedan en la bitácora.

### 3.4 Qué dice un mensaje (y qué nunca dice)

```
🔴 CRÍTICA · Espejo con el HIS
Clínica: E.S.E. Hospital San Vicente de Paúl (Anserma)
Qué pasa: sin latido del agente hace 7 min.
Desde: 19-oct 10:38 (hora Colombia)
Detectado por: centinela del monitor
Ver: https://app.hsvpanserma.agenia.co/super-admin/monitor
```

```
✅ RESUELTO · Espejo con el HIS
Estuvo caído 6 min (10:38 → 10:44).
```

Reglas:

- **Ningún dato de pacientes**: ni nombres, ni documento, ni teléfono, ni BSUID, ni nada de la cita. El mensaje dice **qué** pasa, **dónde** (el nombre de la clínica no es un dato personal), **cuándo** y el **enlace**; el detalle queda detrás del inicio de sesión. Por qué: Telegram está fuera de nuestra infraestructura, los mensajes de bots no van cifrados de extremo a extremo, y son datos de salud (Ley 1581 de 2012). Antes de enviar, un sanitizador enmascara toda secuencia de 6 o más dígitos y todo correo, y una prueba lo garantiza (como `parametrosPlantillaAviso` en el aviso al agendador). De un 5xx van solo el código, el método, la ruta con los ids reemplazados por `:id` y la clase de la excepción; **nunca** el mensaje del error ni el cuerpo de la petición.
- **Fechas** con los helpers de `@agenia/shared` en `America/Bogota` (CLAUDE.md).
- **Texto plano**, sin `parse_mode`: un carácter mal escapado haría fallar el envío con 400, y una alerta no puede fallar por formato.
- Los textos los arma el código. Cero IA.

### 3.5 Que el aviso llegue

- **Tabla `TechAlert`**, una fila por problema (§4.1). Cada aviso se intenta enviar **en el momento**; si Telegram o la red fallan, queda pendiente y un cron de cada minuto lo reintenta. Para dos réplicas: se reclama con compare-and-set, y un índice único parcial garantiza un solo problema abierto por clave.
- **Si la base está caída** no se puede escribir la fila. Para ese caso la configuración vive también **en memoria** (se carga al arrancar y en cada guardado), y `avisar()` envía directo, con una antirrepetición pequeña en memoria. Es justo el caso más grave, y no puede depender de la base.
- **Recursión:** si el propio envío falla, se escribe en el log y nada más. Nunca se avisa del fallo de un aviso por la misma vía.
- **Retención:** los problemas resueltos se borran a los 180 días, en la limpieza diaria del monitor.

### 3.6 El vigía del servidor (lo que la API no ve de sí misma)

- `deploy/vigia.sh`, ejecutado cada minuto por `/etc/cron.d/agenia-vigia` como root. Lo instalan `install-vps.sh` y `update-vps.sh`, igual que el cron del respaldo.
- Revisa: estado de salud y **número de reinicios** de `agenia_api`, `agenia_web`, `agenia_db`, `agenia_redis` y `agenia_proxy` (`docker inspect`); que el panel responda por su URL pública, lo que prueba la cadena completa proxy → web; el disco; y que exista el respaldo del día después de las 04:30.
- Un mensaje por problema y otro al recuperarse. Guarda su estado en `/var/lib/agenia/alertas/vigia.state`.
- **¿De dónde saca el token?** Del panel: cada vez que se guarda la configuración, la API escribe `/var/lib/agenia/alertas/telegram.env` (root, 600: token, `chat_id`, encendido o no) en un volumen montado. Va **fuera de `/opt/agenia`** porque el despliegue hace `rsync --delete` sobre esa carpeta y lo borraría (A8).
- Límite: si se cae **el VPS entero** (Contabo, la red), nada que corra en él puede avisar. Para eso hace falta un chequeo desde fuera (A9).

### 3.7 Frecuencia del centinela

- Pasar de 15 a **5 min** (A4). Costo: Gemini `ping` (ficha del modelo, 0 tokens), Meta una lectura del número (288 al día, muy por debajo del límite), Telegram `getWebhookInfo` por clínica, y el espejo solo consulta la base. Con el latido a 5 min de umbral, un agente caído se ve en 10 min como mucho, contra 20 hoy.
- Lo más urgente **no depende de la frecuencia**: un 5xx, un cron que revienta, Redis caído o un bucle de reinicios se avisan **por evento, en segundos**.

### 3.8 El panel del super admin

Página nueva **`/super-admin/alertas`** («🚨 Alertas técnicas») en el menú de `super-admin/layout.tsx`. La página revisa el rol igual que la del monitor, y la API va bajo `@Roles('SUPER_ADMIN')` en `/tech-alerts`. Esa ruta no está en la lista blanca del proxy, así que solo la alcanza el panel por la red interna: no hay que tocar el Caddyfile.

1. **Conexión**: pegar el token → `getMe` → «@AgeniaTecnicoBot ✓». Vincular el grupo (código + «Buscar el grupo»). Estado: último envío correcto y último error. Desconectar.
2. **Encendido** general y **Silenciar** 1 h / 4 h / hasta mañana.
3. **Qué avisar**: interruptores por categoría (servicios externos, espejo, crones, errores 5xx, arranques, servidor).
4. **Antirruido**: cada cuánto recordar y cuántas veces; horario nocturno sin sonido.
5. **Enviar mensaje de prueba.**
6. **Bitácora**: los últimos 50 problemas, con su estado (abierto o resuelto) y su envío (enviado, pendiente o falló, y por qué).

Cada cambio de configuración queda en `GlobalAuditLog` (acción nueva). El administrador de la clínica no tiene ninguna ruta ni pantalla de esto: el layout lo saca de `/super-admin`, la API le responde 403, y la tarjeta de Telegram de su clínica no cambia.

## 4. Qué hay que construir

### 4.1 Base de datos (una migración)

- **`TechAlertConfig`**: una sola fila (`id = 'global'`). Campos: `encryptedBotToken`, `botId`, `botUsername`, `chatId`, `chatTitle`, `linkCode` + `linkCodeExpiresAt`, `enabled`, `mutedUntil`, `categories` (Json), `reminderMinutes`, `maxReminders`, el horario nocturno en tres columnas (`quietHoursEnabled`, `quietFromHour`, `quietToHour`: más fácil de validar que un Json), `dailySummaryEnabled` + `lastDailySummaryAt` (A13), `panelBaseUrl`, `lastOkAt`, `lastError`, `lastErrorAt`, `updatedByUserId`, `updatedByEmail`, `updatedAt`.
- **`TechAlert`**: `id`, `key`, `category`, `severity`, `status` (`ABIERTA` / `RESUELTA`), `title`, `detail` (ya sanitizado), `organizationId?`, `serviceIncidentId?`, `occurrences`, `firstSeenAt`, `lastSeenAt`, `resolvedAt`, `notifiedAt`, `recoveryNotifiedAt`, `remindersSent`, `lastReminderAt`, `sendAttempts`, `lastSendError`, `claimedAt`.
- **Índice único parcial** `(key) WHERE status = 'ABIERTA'` en `non-prisma-ddl.sql`, junto a los demás índices que Prisma no maneja.
- `GlobalAuditAction` += `TECH_ALERTS_CONFIG_CHANGED`.

### 4.2 API: módulo nuevo `apps/api/src/tech-alerts/`

| Archivo | Qué hace |
|---|---|
| `tech-alerts.module.ts` | En **su propio archivo** y sin importar módulos de negocio (solo `TelegramCoreModule`; Prisma y Crypto son globales): lo importan el monitor, el espejo, los recordatorios y el log del sistema, y un ciclo de `import` tumbaría el arranque (lección de la Fase 2 de Telegram) |
| `tech-alert-config.service.ts` | Conectar (`getMe` + choque con bots de clínicas + `deleteWebhook`), vincular grupo (`getUpdates`), probar, desconectar, caché en memoria, escribir el archivo del vigía |
| `tech-alert.service.ts` | `avisar(evento)` y `resolver(clave)`: antirrepetición, gravedad, sanitizado, guardado y envío; camino directo si la base está caída |
| `tech-alert.dispatcher.ts` | Cron de cada minuto: reintentos, recordatorios, agrupado, tope general |
| `tech-alert.format.ts` | Funciones puras: textos, sanitizador, horario nocturno. Con su prueba de «cero datos de pacientes» |
| `tech-alert.controller.ts` | `SUPER_ADMIN`: `GET/PUT /tech-alerts/config`, `POST connect`, `POST link/start`, `POST link/find`, `POST test`, `POST mute`, `DELETE connect`, `GET /tech-alerts` |
| `telegram-api.client.ts` (se toca) | + `getUpdates`, + devolver `migrate_to_chat_id` en el error |
| `telegram-config.service.ts` (se toca) | `connect` de una clínica rechaza el bot de alertas |

### 4.3 Dónde se engancha

| Archivo | Cambio |
|---|---|
| `monitor/monitor.cron.ts` | `openIncident` → `avisar`; `closeIncident` → `resolver`; cambio `DEGRADED`→`DOWN` → `avisar`; latencia alta solo con 2 seguidos; el `catch` de `runHealthChecks` y la limpieza diaria → `CRON_FALLO` |
| `monitor/monitor.checkers.ts` | `checkMirror` considera `lastHisReachable = false` (con `lastHisDetail`) como `DOWN` |
| `.env.production` | `MONITOR_BG_INTERVAL_MINUTES=5` |
| `appointment-reminder/appointment-reminder.cron.ts` | `catch` de `runOnce` y lote con todo fallido |
| `retention/retention.service.ts`, `mass-notice/mass-notice.service.ts` | `catch` de sus crones |
| `mirror/mirror-watchdog.service.ts` | `catch` por clínica y general; `resumen.aviso` con motivo de falla → `AVISO_AGENDADOR_NO_SALE` |
| `mirror/mirror-schema-check.service.ts` | Triggers faltantes → `ESQUEMA_ESPEJO` |
| `system-log/global-exception.filter.ts` + `main.ts` | Cuando `shouldPersist` da sí (firma nueva) → `ERROR_5XX`. El filtro se crea con `new` en `main.ts`: recibe también el servicio de alertas. Los manejadores de `unhandledRejection` / `uncaughtException` → `PROCESO_EXCEPCION` |
| `redis/redis.service.ts` | Evento `error` → `REDIS_ERROR`; `ready` → `resolver` |
| `tech-alerts` (arranque) | `onApplicationBootstrap` → `API_ARRANCO` (con el commit, si el despliegue lo deja en una variable: hay que confirmarlo en `update-vps.sh`) |

En los crones del bot que corren cada 5 y 10 s solo se engancha el `catch` general: la antirrepetición por clave evita que un fallo en bucle mande un mensaje cada 5 s.

### 4.4 Web

- `app/super-admin/alertas/page.tsx` + `AlertasClient.tsx`; `app/actions/tech-alerts.ts` con el patrón de `actions/monitor.ts` (reenvía la cookie, `INTERNAL_API_URL`).
- `app/super-admin/layout.tsx`: entrada nueva en el menú.
- Opcional: en `/super-admin/monitor`, una etiqueta «Alertas a Telegram: activas / apagadas» que lleve a la configuración.

### 4.5 Servidor

- `deploy/vigia.sh` + `/etc/cron.d/agenia-vigia`, instalados por `install-vps.sh` y `update-vps.sh` (idempotente), con `--prueba` para mandar un mensaje sin simular una caída.
- `docker-compose.deploy.yml`: volumen `/var/lib/agenia/alertas:/app/alertas` en `api`.
- Documentos: `docs/ALERTAS_TECNICAS.md` (operación: crear el bot, vincular, silenciar, qué significa cada aviso) y actualizar `MONITOR_SERVICIOS.md`.

## 5. Seguridad

- **Solo super admin**, en tres capas: guard de la API, layout y página. Una prueba comprueba que `ORG_ADMIN` recibe 403.
- **Token**: cifrado en la base y nunca en un log (regla del cliente). El archivo del vigía es root 600, el mismo trato que ya tiene `.env.production`.
- **El bot solo envía.** No procesa comandos, salvo buscar el código de vinculación cuando alguien pulsa el botón. Si alguien lo agrega a otro grupo no recibe nada: solo se envía al `chat_id` vinculado.
- **El grupo es el control de acceso**: quien está en él ve nombres de clínicas e información técnica. Grupo privado, sin enlace de invitación público.
- El bot de alertas **nunca debe tener webhook** (`getUpdates` dejaría de funcionar): `connect` hace `deleteWebhook` primero.

## 6. Pruebas

- **Puras**: sanitizador (ningún dígito largo ni correo sale, fechas en Bogotá), antirrepetición, recordatorios, intermitencia, tope general, horario nocturno.
- **Servicios**: `getMe` rechazado; choque con el bot de una clínica; código vencido; `migrate_to_chat_id`; base caída → envío directo; envío fallido → queda pendiente y se reintenta.
- **Centinela**: abre → un aviso; reinicio con el incidente abierto → **ningún** aviso nuevo; recuperación → un «resuelto»; latencia alta en un solo chequeo → nada.
- **Las pruebas actuales pasan sin editarlas**, salvo inyectar la dependencia nueva.
- **Arranque real de la API** con el módulo conectado, y `app.module.imports.spec.ts` al día (lección de la Fase 2 de Telegram).
- `pnpm --filter api lint` y `pnpm --filter web lint` por la regla de fechas.
- **Punta a punta**: crear el bot, vincular un grupo de prueba, «Enviar prueba», forzar fallos en local (apagar Redis, detener el agente simulado), `vigia.sh --prueba` en el servidor.

## 7. Decisiones por aprobar

| # | Decisión | Recomendación |
|---|---|---|
| **A1** | Bot propio de la plataforma, no el de una clínica | Sí |
| **A2** | Destino: un solo grupo del equipo técnico (varios destinos, más adelante si hace falta) | Un grupo |
| **A3** | Vincular el grupo con código + `getUpdates` a demanda, en vez de escribir el `chat_id` a mano o abrir un webhook | Código |
| **A4** | Centinela de 15 a 5 min | 5 min |
| **A5** | Latencia alta solo si se repite en 2 chequeos seguidos; una caída avisa al primero | Sí |
| **A6** | Todas las categorías nacen encendidas; los arranques, sin sonido | Sí |
| **A7** | Recordar cada 60 min, máximo 3; de 22:00 a 06:00 las advertencias sin sonido y las críticas siempre con sonido | Sí |
| **A8** | El vigía del servidor lee la configuración que el panel escribe en `/var/lib/agenia/alertas`. La alternativa es un token aparte en `.env.production`, que no se configura desde el panel | Archivo escrito por la API |
| **A9** | Chequeo desde fuera del VPS (UptimeRobot o Healthchecks.io gratis, con su integración de Telegram) para «se cayó el servidor entero». Sin código | Sí, en la Fase 3 |
| **A10** | 5xx: avisar cada firma nueva (una vez cada 60 min) con solo ruta y clase de la excepción, nunca el mensaje | Sí |
| **A11** | El chequeo del espejo también mira `lastHisReachable` (agente vivo sin alcanzar el HIS) | Sí |
| **A12** | Las excepciones de la bandeja del espejo NO van al Telegram técnico; sí va que el aviso al agendador no salga | Sí |
| **A13** | **Resumen diario a las 07:00** («Sin novedades» o «ayer: 2 incidentes, 0 abiertos»). Es la única forma de saber que el silencio significa «todo bien» y no «el bot dejó de enviar» (token revocado, bot expulsado del grupo) | Sí |

## 8. Fases

| Fase | Qué | Termina cuando |
|---|---|---|
| **0** ✅ | Migración + funciones puras (textos, sanitizador, antirruido) con pruebas | Pruebas verdes. **Hecha el 2026-10-19**: 99 pruebas nuevas; migración con cero deriva contra Postgres 15 real; el índice parcial rechaza una segunda alerta abierta con la misma clave |
| **1** ✅ (falta el bot real) | Núcleo de la API (config, conexión, vinculación, prueba, envío, tabla, despachador) + página `/super-admin/alertas` | «Enviar prueba» llega al grupo. **Hecha el 2026-10-19** salvo ese paso (§10): 58 + 14 pruebas de la API, 15 de la web; contra Postgres real (7 escenarios, réplicas incluidas); API y web arrancadas de verdad |
| **2** ✅ | Enganches: centinela (abrir, cerrar, empeorar, latencia confirmada, `lastHisReachable`), crones, 5xx, arranque, proceso, esquema del espejo, aviso al agendador, Redis; centinela a 5 min | Un fallo forzado en local llega en segundos y su recuperación también. **Hecha el 2026-10-19** (§11): verificada con la API real contra Postgres, Redis apagado y encendido, 5xx reales y el espejo sin latido |
| **3** ✅ | Vigía del servidor + archivo de configuración + instalación en install/update + chequeo externo (A9) | `vigia.sh --prueba` llega; un contenedor detenido en local avisa. **Hecha el 2026-10-19** (§12): 61 pruebas del vigía (y 3 mutaciones detectadas), y una vuelta real con Docker y curl de verdad contra un Telegram falso local |
| **4** | Encender en producción: crear el bot, el grupo, vincular; una semana mirando el ruido y ajustando umbrales | Una semana sin avisos falsos |

## 9. Riesgos

| Riesgo | Cómo se cubre |
|---|---|
| Ruido que hace que el grupo se silencie | Latencia confirmada, agrupado, intermitencia, tope general, recordatorios con límite. El volumen medido es bajo (§2.2) |
| **Silencio falso**: el bot deja de enviar y nadie se entera | Resumen diario (A13); `lastError` visible en el panel y un aviso en el layout del super admin si el último envío falló |
| Ciclo de módulos que tumba el arranque | Módulo en su propio archivo, sin módulos de negocio; arranque real en la Fase 2 |
| Datos de pacientes en Telegram | Sanitizador + prueba; del 5xx nunca va el mensaje; el detalle queda detrás del inicio de sesión |
| La base caída impide avisar | Configuración en memoria y envío directo (§3.5) |
| La API caída impide avisar | Vigía del servidor (§3.6) |
| El VPS entero caído | Chequeo externo (A9) |

## 10. Bitácora de la Fase 1 (2026-10-19)

### Decisiones de detalle tomadas al construir

- **Vincular el grupo lo enciende** y cuenta como el resumen del día: el grupo recibe la bienvenida y el primer resumen llega al día siguiente a las 07:00, no un minuto después.
- **Desconectar olvida bot y grupo** (a diferencia del bot de una clínica, que conserva el token) y antes se despide del grupo, para que nadie lea el silencio como «todo bien».
- **Solo un grupo o supergrupo**: un código escrito en un chat privado no vincula y el panel lo explica.
- **El comando que muestra el panel es `/vincular@Bot CÓDIGO`**: con el modo privacidad de grupos, Telegram le entrega al bot los comandos dirigidos a él; el lector acepta también `/vincular CÓDIGO`.
- **Lo que no se envía se registra igual**: sin bot, apagado, con la categoría apagada o en silencio. Lo que siga ABIERTO al encender o al terminar el silencio se avisa entonces; un evento suelto que no salió en su hora (60 min) ya no se manda.
- **El «resuelto» suena como sonó el problema** (una crítica resuelta suena; una advertencia de noche, no). El resumen diario y los arranques llegan sin sonido.
- **Agrupar**: `avisar` espera 3 s antes de despachar, para que lo de la misma vuelta de un chequeo salga en un solo mensaje.
- **Tope**: si en una vuelta hay más mensajes que cupo, sale un solo «🔕 Y N alertas más» y esas filas quedan marcadas `suprimida: TOPE` (ni recordatorio ni «resuelto»). Sin cupo ni para eso, todo espera a la vuelta siguiente.

### Cómo se verificó

- Pruebas: 58 de configuración, servicio y despachador contra una base falsa que respeta el índice parcial; 14 de controlador (8), cliente de Telegram (5) y la regla del bot del lado de las clínicas (1); 15 de la página; 104 de la lógica pura.
- Contra Postgres 15 real (Docker, base `*_verif`, prueba temporal que se borró): conectar/vincular con token cifrado de verdad y auditoría con el enum nuevo; aviso, recordatorio y resuelto; **6 `avisar` simultáneos desde dos conexiones → una fila con 6 ocurrencias** (el índice parcial de verdad); dos despachadores con conexiones distintas → cada aviso una sola vez; la intermitencia leyendo el `meta` JSON; la reclamación del resumen diario y su devolución si falla.
- Arranque real de la API compilada (sin `apps/api/.env`): `TechAlertsModule` carga y `/tech-alerts` queda registrada. Por HTTP con tokens firmados: las 10 rutas dan 403 a un `ORG_ADMIN` y sin token; los errores y los límites salen como en las pruebas.
- `next build` y `next start` contra esa API: el `SUPER_ADMIN` ve la página con la bitácora (detalle sanitizado); el `ORG_ADMIN` va a `/dashboard` y sin sesión a `/login`.

### Pendiente para cerrar la Fase 1: el bot real

No se puede probar sin un token de @BotFather. En el entorno donde se pruebe (local o producción tras desplegar):

1. @BotFather → `/newbot` → nombre «AgenIA Técnico», usuario terminado en `bot`. Copiar el token.
2. `/super-admin/alertas` → pegar el token → «Conectar bot».
3. Crear (o usar) el grupo privado del equipo, agregar el bot, «Generar código de vinculación», escribir en el grupo el comando que muestra el panel y pulsar «Buscar el grupo». El grupo recibe la bienvenida.
4. «Enviar mensaje de prueba». Si llega, la Fase 1 queda cerrada.

Para desplegar: la migración entra con `db:deploy` (incluye `db:apply-sql`, que crea y verifica el índice parcial). La ruta `/api/tech-alerts` **no** debe abrirse en el Caddy: el panel la alcanza por la red interna.

## 11. Bitácora de la Fase 2 (2026-10-19)

### Dónde quedó cada enganche

| Fuente | Clave | Cómo |
|---|---|---|
| Centinela del monitor ([`monitor.cron.ts`](../apps/api/src/monitor/monitor.cron.ts)) | `servicio:<key>` | `avisar` en CADA chequeo caído (idempotente: el problema abierto solo suma ocurrencias), salvo latencia alta en el primer chequeo; `resolver` al volver a UP. Su `catch` → `cron:centinela`; la limpieza diaria (antes sin `catch`) → `cron:limpieza-monitor` |
| Chequeo del espejo ([`monitor.checkers.ts`](../apps/api/src/monitor/monitor.checkers.ts)) | — | `DOWN` si el agente late pero `lastHisReachable = false` (solo con el latido al día) |
| Recordatorios | `cron:recordatorios`, `cron:recordatorios:lote` | `ejecutarLote()`: el cron que revienta, y el lote sin ningún envío y ≥ 3 fallos (`loteDeRecordatoriosCaido`) |
| Retención, purga de avisos masivos, consultas al HIS, barridos del HIS del bot | `cron:<nombre>` | `cronFallo` / `cronBien` |
| Vigilante del espejo | `cron:vigilante-espejo[:<org>]`, `espejo:aviso-agendador:<org>` | Por clínica y general; el aviso al agendador que no sale (sin plantilla, sin destino, Meta lo rechazó o reventó). «Nada que avisar» y «apagado» lo resuelven; «otra réplica» no toca nada |
| Esquema del espejo | `espejo:esquema` | Evento al arrancar si faltan los triggers con el espejo encendido |
| Filtro de errores + `main.ts` | `5xx:<código>:<método>:<ruta>:<clase>`, `5xx:rafaga`, `proceso:<origen>:<clase>` | La firma nueva de 5xx (la misma que guarda SystemLog, nunca el mensaje); ≥ 20 en 5 min = ráfaga crítica (una vez por minuto); `unhandledRejection` / `uncaughtException` |
| Redis | `servicio:redis` | Un aviso por caída aunque ioredis emita `error` en cada reintento; el `ready` lo resuelve |
| Arranque | `api:arranque`, `api:reinicios` | Evento sin sonido con proceso, host y `AGENIA_VERSION` (si el despliegue la deja; hoy no lo hace: Fase 3); dos arranques en 10 min = bucle |

Todos los servicios reciben `TechAlertService` con `@Optional()`: las pruebas existentes pasan sin tocarlas y, sin el módulo, nada cambia.

### Lo que enseñó la prueba real (y se corrigió)

- **Un cron de cada 10 s con Redis caído sumó 73 fallos en 13 minutos** y, con la regla de «crítico a la tercera», se habría vuelto crítico a los 20 segundos: un «empeoró» casi inmediato para la misma caída de Redis. Ahora un cron sube a crítico con **3 fallos y 10 minutos fallando** (`cronMinutosParaCritica`). Uno diario sigue subiendo al tercer día.
- **El filtro tapaba `127.0.0.1` y el hostname** (en este Mac, `192.168.40.2`): ahora respeta las **IPv4 privadas y de loopback** con su puerto. Las públicas siguen tapadas (podrían ser de una persona) y un documento con puntos nunca empieza así.
- **El evento repetido guarda el detalle más reciente**: un arranque dentro de la misma hora muestra el proceso nuevo, no el del primero.

### Cómo se verificó

- API 3270 pruebas, shared 1085; lint y tipos limpios. Las pruebas de siempre pasan sin editarlas, salvo la que fijaba el intervalo por defecto en 15 (ahora 5, A4).
- **Arranque real de la API** contra Postgres 15 (Docker), con una clínica cuyo agente llevaba 30 min sin latir, Redis APAGADO y el monitor encendido:
  - al arrancar: `API_ARRANCO` con la versión, `REDIS_ERROR` crítico, y `SERVICIO_CAIDO` del espejo («Sin heartbeat del agente hace 30 min»), Gemini y Meta (la clínica de prueba no tiene credenciales: correcto);
  - segundo arranque a los 13 min: no hubo «reinicios en bucle» (la ventana es de 10): correcto;
  - **al encender Redis, `REDIS_ERROR` y `cron:confirmaciones-his` se resolvieron solos en el mismo segundo**;
  - **3 errores 500 reales** (`/monitor/incidents?from=no-es-fecha&search=1088123456`) → UN evento `5xx:500:GET:/monitor/incidents:PrismaClientValidationError`, sin la consulta ni la cédula;
  - el agente al día pero sin alcanzar el HIS → el problema del espejo siguió abierto con el motivo nuevo («no alcanza la base del hospital»).

### Pendiente en producción

- **`MONITOR_BG_INTERVAL_MINUTES=15` está escrito en `/opt/agenia/.env.production`** y gana sobre el nuevo valor por defecto: hay que cambiarlo a 5 (`agenia env` o editar el archivo) y recrear el contenedor `api`. El instalador ya escribe 5 en servidores nuevos.
- Al desplegar, la migración y el índice entran con `db:deploy`. Sin el bot conectado, los problemas se registran en la bitácora y no se envía nada.

## 12. Bitácora de la Fase 3 (2026-10-19)

### Qué quedó

| Pieza | Dónde |
|---|---|
| El vigía | [`deploy/vigia.sh`](../deploy/vigia.sh): contenedores (detenido, no existe, `unhealthy`, reinicio por Docker), el panel por su dirección a través del proxy (`curl --resolve` a 127.0.0.1), disco (80 / 90 %, se resuelve bajo 75 %), respaldo de hoy desde las 04:30. Un archivo de estado por problema en `vigia.d/`; mismo antirruido que la API (confirmación en dos vueltas para contenedores y panel, «empeoró», recordatorios de lo crítico, «resuelto» con la duración, sin sonido de noche, silencio, categoría «Servidor») |
| Sus pruebas | [`deploy/vigia.test.sh`](../deploy/vigia.test.sh): 61 casos con `docker`/`curl`/`df` falsos y el reloj controlado; compatibles con bash 3.2 (macOS) y bash 5 |
| La configuración del vigía | La API la escribe en `TECH_ALERTS_VIGIA_FILE` (`/app/alertas/telegram.env` → host `/var/lib/agenia/alertas/`) al arrancar y en cada cambio, a un temporal que se renombra (atómico), 600; [`tech-alert-vigia.ts`](../apps/api/src/tech-alerts/tech-alert-vigia.ts) valida cada valor. El vigía la LEE con `sed`, nunca la ejecuta |
| ¿Corre el vigía? | Deja su latido en `vigia.latido`; la API lo lee y el panel dice «activo» o «no corre desde…» (paso 3) |
| Instalación | `agenia vigia instalar` (cron `/etc/cron.d/agenia-vigia`, logrotate, carpeta 700): lo llaman `install-vps.sh` y cada `update-vps.sh`. `agenia vigia prueba|estado`. El desinstalador lo borra todo, token incluido |
| Despliegues | `update-vps.sh` abre `agenia mantenimiento 20` antes del build y lo cierra al final (vence solo si algo falla a medias) |
| Versión | `update-vps.sh` calcula `<commit>[+cambios]@<fecha>` en tu computador (el servidor no tiene `.git`) y la pasa como argumento de build: queda EN la imagen (`AGENIA_VERSION`) y la dice el aviso de arranque. Con git en el servidor, `agenia build` usa su commit |
| Chequeo externo (A9) | Sin código: UptimeRobot sobre `/login` con su integración de Telegram al mismo grupo ([ALERTAS_TECNICAS.md §5](ALERTAS_TECNICAS.md)) |

### Decisiones de detalle

- **El token no va en la línea de comandos de `curl`** (`ps` la muestra a cualquier usuario del host): va por la entrada estándar (`curl -K -`). Hay una prueba que lo verifica.
- **El chequeo del panel se hace en el propio servidor** (`--resolve` a 127.0.0.1): prueba proxy → web sin depender del DNS ni de la red de afuera; lo de afuera lo cubre el chequeo externo.
- **Lo que una vuelta no mira no se da por resuelto**: en mantenimiento (contenedores y panel) y antes de las 04:30 (el respaldo de ayer).
- **Un contenedor recreado por un despliegue** vuelve a `RestartCount` 0: no cuenta como reinicio.
- **Carpeta montada, no archivo**: la API renombra un temporal; un bind-mount de archivo suelto dejaría al host con el inodo viejo (la lección del Caddyfile).

### Cómo se verificó

- `deploy/vigia.test.sh`: 61 pruebas en verde **en macOS (bash 3.2, date de BSD) y en `ubuntu:24.04` (bash 5, date de GNU, flock)**. En Ubuntu fallaron 5 al principio: la imagen mínima no trae `tzdata` y `TZ=America/Bogota` caía en silencio a UTC (horas corridas 5 h, el respaldo mirado a deshora). Ahora, sin la zona instalada, el vigía usa el desfase fijo de Colombia (`<-05>5`, sin horario de verano). El servidor real sí tiene `tzdata`, pero el vigía ya no depende de eso.
- Tres defectos introducidos a propósito (avisar sin confirmar, umbral de baja del disco, resolver lo no mirado en mantenimiento) los detectan las pruebas; el archivo quedó restaurado idéntico.
- **Vuelta real** en local con `docker` y `curl` de verdad: un contenedor `redis` real detenido a mitad y un Telegram y un panel falsos en 127.0.0.1. El 502 del panel y el contenedor detenido se avisaron en la segunda vuelta; Telegram recibió `POST /bot<token>/sendMessage` con chat, texto, `disable_notification` y `link_preview_options` como espera la Bot API.
- API 3277 pruebas (las del archivo del vigía y el latido, con escritura real a disco y permisos 600), web 1187; lint y tipos limpios; `docker compose config` con y sin versión.

### Pendiente para producción

1. Crear el bot en @BotFather, conectarlo y vincular el grupo (§10).
2. `MONITOR_BG_INTERVAL_MINUTES=5` en `/opt/agenia/.env.production` ANTES de desplegar (el despliegue recrea la API y lo toma; `agenia restart api` no relee el `.env`) (§11).
3. Desplegar con `./update.sh`: migra, instala el vigía y deja la versión. Después, `agenia vigia prueba` en el servidor.
4. UptimeRobot (A9).

El paso a paso completo, con la creación del bot y del grupo de Telegram: [ALERTAS_TECNICAS.md §1](ALERTAS_TECNICAS.md).

## 13. Fase 4: la primera semana en producción

_(Por llenar: fecha de encendido y, por cada aviso, si era real, si llegó a tiempo y si sobró.)_

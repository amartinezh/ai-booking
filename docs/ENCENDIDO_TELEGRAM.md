# Encender Telegram en la clínica de prueba (Fase 5)

Runbook de la Fase 5 de [`PLAN_TELEGRAM.md`](PLAN_TELEGRAM.md). El código de las fases 0-4 ya está hecho; esto es **encenderlo** con un bot de prueba, probarlo desde un teléfono real y dejarlo vigilado.

La regla de todo el documento: **WhatsApp no se toca**. Cada paso dice cómo comprobar que sigue igual, y el apagado (§8) devuelve el sistema al estado de hoy en un minuto.

## 0. Qué hace falta

- [ ] Acceso SSH al VPS (la llave dedicada del instalador) y el comando `agenia` en el servidor.
- [ ] Una cuenta `ORG_ADMIN` de la **clínica de prueba** en el panel.
- [ ] Un teléfono con **Telegram** y otro (o el mismo) con **WhatsApp**, que no sean de pacientes reales.
- [ ] Una cédula de prueba que no exista en la clínica (y, si la clínica tiene espejo con un HIS, que el HIS la acepte o que el espejo esté en modo prueba).

## 1. Antes de desplegar

- [ ] Todo el trabajo de Telegram está commiteado (fases 0-4, textos por canal, BSUID no único, recordatorio manual, botón del dashboard). `git status` limpio.
- [ ] En local, todo en verde:
  ```bash
  pnpm --filter api test && pnpm --filter api build
  (cd packages/shared && npx jest)
  (cd apps/web && npx jest && npx next build)
  ```
- [ ] Respaldo de la base en el servidor: `agenia backup` (queda en `/var/backups/agenia`).

## 2. Desplegar, con Telegram todavía APAGADO

Desde tu computador:

```bash
bash deploy/update-vps.sh --host <ip-del-vps>
```

Eso sincroniza el código, reconstruye `api` y `web`, aplica las migraciones y corre `agenia verify`. Entran tres migraciones:

| Migración | Qué hace | Riesgo |
|---|---|---|
| `20260928100000_canal_telegram` | Tablas `TelegramBotConfig` y `TelegramMessageLog`, dos columnas nulas en la ficha, origen de cita `TELEGRAM` | Solo añade |
| `20260928110000_telegram_chat_no_unico` | El chat de Telegram deja de ser único por ficha | Solo relaja |
| `20260928120000_bsuid_no_unico` | El BSUID deja de ser único por ficha (madre e hijo con la misma cuenta) | Solo relaja |

Crean índices sobre `PatientProfile`: bloquean escrituras un instante (la tabla es pequeña).

- [ ] `agenia verify` termina sin errores.
- [ ] **WhatsApp igual que siempre**: desde el teléfono de WhatsApp, escríbele «Hola» a la línea de la clínica de prueba y avanza hasta el menú de servicios. Debe comportarse exactamente como antes.
- [ ] Con el interruptor apagado, Telegram no existe:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$PUBLIC_API_URL/telegram/webhook/x"
  # → 404
  ```

## 3. Encender el interruptor

En el servidor:

- [ ] Editar `.env.production` (en la raíz del stack) y agregar:
  ```
  TELEGRAM_ENABLED=true
  ```
- [ ] Ver cuál es la URL pública de la API: `agenia env | grep PUBLIC_API_URL`. Telegram solo llama a HTTPS. En una instalación de **un solo dominio** es `https://<dominio>/api` (ej. `https://app.hsvpanserma.agenia.co/api`); con dos dominios, `https://api.<dominio>`.
- [ ] **Publicar el webhook en el proxy.** Caddy funciona como lista blanca: de la API solo deja pasar a internet lo que tiene un bloque `handle`, y lo demás responde 404. Los servidores instalados antes de Telegram **no tienen** el bloque del webhook. Sin él, el panel conecta el bot sin problema (va por la red interna), pero Telegram recibe **404** y retiene los mensajes. Así falló el primer encendido (2026-09-28).
  - En `/opt/agenia/deploy/Caddyfile`, antes del bloque `handle /api/mirror*` (un solo dominio):
    ```
    	handle /api/telegram/webhook/* {
    		uri strip_prefix /api
    		reverse_proxy api:3000
    	}
    ```
    Con dos dominios, dentro del sitio de la API y sin prefijo: `handle /telegram/webhook/* { reverse_proxy api:3000 }`. Solo el webhook: `/telegram-config` NO se publica.
  - Validar y recargar, sin cortar el servicio (si el archivo tuviera un error, Caddy sigue con la configuración anterior):
    ```bash
    sudo cp /opt/agenia/deploy/Caddyfile /opt/agenia/deploy/Caddyfile.bak
    docker exec agenia_proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    docker exec agenia_proxy caddy reload   --config /etc/caddy/Caddyfile --adapter caddyfile
    ```
  - `update-vps.sh` no toca el Caddyfile del servidor; las instalaciones nuevas ya traen el bloque (`deploy/install-vps.sh`).
- [ ] Aplicar el cambio **recreando** el contenedor. `agenia restart api` NO relee `.env.production`:
  ```bash
  agenia up api
  ```
- [ ] Las rutas de Telegram aparecen al arrancar:
  ```bash
  agenia logs api | grep "Mapped {/telegram"
  # → 5 rutas: /telegram/webhook/:routeKey y 4 de /telegram-config
  ```
- [ ] Un POST sin secreto **llega a la API** y se rechaza (401). Un 404 aquí es el proxy sin el bloque de arriba:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$PUBLIC_API_URL/telegram/webhook/x"
  # → 401
  ```
- [ ] `agenia verify` lo comprueba solo cuando `TELEGRAM_ENABLED=true`: webhook publicado (401) y configuración NO publicada (404).
- [ ] **WhatsApp igual que siempre** (repetir el «Hola» del paso 2).

## 4. Crear el bot de prueba

En Telegram, con cualquier cuenta (idealmente una de la clínica, no personal):

- [ ] Abrir **@BotFather** → `/newbot`.
- [ ] Nombre visible: el que verán los pacientes (ej. «Clínica de Prueba AgenIA»).
- [ ] Usuario: debe terminar en `bot` (ej. `ClinicaPruebaAgenIABot`).
- [ ] Guardar el **token** que responde BotFather. Es una contraseña: no pegarlo en chats ni correos.
- [ ] Recomendado: `/setjoingroups` → *Disable* (el bot ignora los grupos de todos modos, T8) y `/setuserpic` con el logo de la clínica.

## 5. Conectarlo desde el panel

- [ ] Entrar como `ORG_ADMIN` de la clínica de prueba → **Configuración → Integraciones → Canal de Telegram**.
- [ ] Pegar el token → **Conectar bot de Telegram**.
- [ ] La tarjeta muestra **Conectado**, el `@usuario`, el enlace `t.me/…` y el **QR**.
- [ ] **Verificar conexión** → «Webhook: apunta a AgenIA», **sin mensajes retenidos y sin «Último error»**. Ojo: «apunta a AgenIA» solo compara la URL registrada; si además aparece «Wrong response from the webhook: 404», es el proxy (§3).
- [ ] Si falla, el mensaje de la tarjeta dice por qué (token mal copiado, Telegram caído, URL sin HTTPS). Nada queda encendido a medias.

## 6. Pruebas desde el teléfono

Con el teléfono de Telegram. Marcar cada una; si alguna falla, parar y revisar §7 antes de seguir.

**Conversación**
- [ ] **Entrada por QR**: escanear el QR de la tarjeta → abre el chat → *Iniciar* → el bot saluda y muestra el menú de servicios.
- [ ] **Agendar como paciente nuevo** (cédula de prueba), de punta a punta hasta el **SÍ**. La confirmación se ve con **negritas**, sin asteriscos sueltos.
- [ ] **Panel**: la cita aparece con la insignia «✈️ Bot Telegram», y el paciente en la lista con «✈️ Telegram».
- [ ] Si la clínica tiene espejo: la cita llega al HIS igual que una de WhatsApp.
- [ ] **Nota de voz** en un paso de menú (ej. decir el servicio): el bot la entiende y responde.
- [ ] **Foto o sticker**: responde «por ahora solo entiendo mensajes de texto y notas de voz».
- [ ] **Editar** un mensaje ya enviado: el bot no reprocesa nada.
- [ ] **Cancelar** y **reprogramar** esa cita por Telegram.
- [ ] **EPS que no existe** (ej. «Coomeva» si no está): el texto dice «por **Telegram**», nunca «por WhatsApp».
- [ ] **Lista de espera** (si hay un servicio sin cupos): el bot dice «esté pendiente de su **Telegram**».
- [ ] **Inactividad**: dejar una conversación a medias más de 5 minutos → llega por Telegram el aviso de cierre.

**Los dos canales a la vez**
- [ ] Empezar una conversación por WhatsApp y otra por Telegram al mismo tiempo, intercalando mensajes: cada una avanza por su lado, sin mezclarse.
- [ ] Agendar por WhatsApp con la **misma cédula** del paso anterior: es **una sola ficha** con los dos canales (lista de pacientes: 💬 y ✈️).

**Salidas desde el panel**
- [ ] **Dashboard**: el botón de la cita de Telegram dice «Recordar por **Telegram**» → el recordatorio llega por Telegram.
- [ ] **Agenda → Contactar** en la cita de Telegram → el mensaje llega por Telegram.
- [ ] **Bloquear al bot** en Telegram → «Recordar» otra vez → el recordatorio llega por **WhatsApp** (si está fuera de las 24 h, la clínica necesita la plantilla aprobada; para la prueba basta con escribirle antes a la línea de WhatsApp). La ficha muestra «✈️ Telegram (bloqueado)» y el botón pasa a decir «Recordar por WhatsApp».
- [ ] **Desbloquear** y escribir al bot → la marca de bloqueo desaparece.
- [ ] **Rastreo** del paciente: el expediente dice «Telegram: Vinculado» y la confirmación «se envió… y Telegram la aceptó».

## 7. Qué vigilar (primeras 48 h)

En el servidor:

```bash
# Nada de esto debería repetirse:
agenia logs api | grep -E "Webhook de Telegram rechazado|Token de Telegram revocado|Backpressure|SIN remitente"
# Envíos fallidos por Telegram:
agenia logs api | grep "Error enviando .* por Telegram"
```

```sql
-- agenia psql
-- Envíos de Telegram del último día, por estado y tipo
SELECT status, kind, count(*) FROM "TelegramMessageLog"
WHERE "createdAt" > now() - interval '1 day' GROUP BY 1, 2 ORDER BY 1, 2;

-- WhatsApp NO debe cambiar: conversaciones por día y canal
SELECT date_trunc('day', "createdAt") AS dia,
       CASE WHEN "whatsappId" LIKE 'tg:%' THEN 'telegram' ELSE 'whatsapp' END AS canal,
       count(*)
FROM "InteractionLog" WHERE "createdAt" > now() - interval '3 days'
GROUP BY 1, 2 ORDER BY 1, 2;
```

- [ ] `SIN remitente` en cero (si aparece con eventos de Telegram, el bot no está reconociendo el canal).
- [ ] El volumen y los fallos de WhatsApp, iguales a los días anteriores.
- [ ] En la tarjeta del panel, **Verificar conexión** sigue en «apunta a AgenIA».

## 8. Si algo sale mal

De menor a mayor. Ninguno toca WhatsApp ni necesita revertir migraciones (solo añadieron o relajaron).

1. **Solo esta clínica**: panel → Canal de Telegram → **Desconectar**. Telegram deja de llamar y el bot deja de contestar ahí.
2. **Todo Telegram**: en `.env.production`, `TELEGRAM_ENABLED=false` → `agenia up api`. Las rutas de Telegram desaparecen (404) y la API vuelve a comportarse como antes del encendido.
3. **Si WhatsApp se viera afectado** (no debería: sus tests pasan sin haberse editado): apagar Telegram (paso 2), y si persiste, volver a desplegar el commit anterior al trabajo de Telegram con `deploy/update-vps.sh` y restaurar desde `agenia backup` solo si hubo daño de datos.

## 9. Antes de la primera clínica real

- [ ] Todas las casillas de §6 marcadas, y una semana de §7 sin sorpresas.
- [ ] **Visto bueno de la clínica** sobre usar Telegram: los chats con bots no tienen cifrado de extremo a extremo (van cifrados hasta los servidores de Telegram). El bot ya evita mandar datos clínicos.
- [ ] La clínica crea **su propio bot** en BotFather (un bot no puede ser de dos clínicas) y lo conecta desde su panel.
- [ ] Imprimir el QR (botón **Descargar QR**) para recepción y carteleras; poner el enlace `t.me/…` en la web o en el recordatorio.

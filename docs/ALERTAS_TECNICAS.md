# 🚨 Alertas técnicas por Telegram — operación

Cuando algo falla, el sistema le escribe al instante a un **grupo de Telegram del equipo técnico**: qué pasó, en qué clínica y desde cuándo. Solo el **SUPER_ADMIN** lo configura, en `/super-admin/alertas`; ningún administrador de clínica lo ve. Diseño y decisiones: [PLAN_ALERTAS_TECNICAS.md](PLAN_ALERTAS_TECNICAS.md).

Los mensajes **nunca llevan datos de pacientes** (ni nombres, ni documentos, ni teléfonos): el detalle queda detrás del inicio de sesión. Tampoco gastan IA: los textos los arma el código.

## 1. Paso a producción (una vez)

Servidor de referencia: `89.117.61.28` (hsvpanserma), llave `~/.ssh/agenia_89_117_61_28_ed25519`. Abreviatura usada abajo:

```bash
vps() { ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 "$@"; }
```

(Una función y no una variable: en zsh, la terminal por defecto de macOS, `vps '…'` con `VPS='ssh …'` no funciona.)

Estado del servidor antes de empezar (revisado el 2026-10-19, solo lectura): bash 5, `flock`, `curl`, cron activo, zona `America/Bogota` instalada, disco al 26 %, salida a `api.telegram.org` OK, `/api/tech-alerts` cae en el `respond 404` del Caddy (no es pública: el panel la alcanza por la red interna). No hay nada de las alertas desplegado todavía.

El orden importa: **primero el servidor (pasos 1 a 4), después Telegram (5 a 8)**. La página `/super-admin/alertas` no existe hasta desplegar.

### Paso 1 · Respaldo antes de tocar nada

```bash
vps 'agenia backup'
```

Debe terminar en `✔ Backup: /var/backups/agenia/agenia-AAAAMMDD-HHMMSS.sql.gz (… M)`. La migración solo AGREGA dos tablas, un valor de enum y un índice; el respaldo es por costumbre, no porque se espere un problema.

### Paso 2 · El monitor cada 5 minutos (antes de desplegar)

`.env.production` tiene `MONITOR_BG_INTERVAL_MINUTES=15` escrito, y lo escrito gana sobre el nuevo valor por defecto (5). Se cambia ANTES de desplegar porque el despliegue recrea la API y así toma el valor nuevo de una vez. (`agenia restart api` NO sirve: `docker compose restart` no vuelve a leer el `.env`; fuera de un despliegue se usa `agenia up --force-recreate api`.)

```bash
vps 'cp -a /opt/agenia/.env.production /var/backups/agenia/env.production.$(date +%Y%m%d-%H%M%S) \
  && sed -i "s/^MONITOR_BG_INTERVAL_MINUTES=.*/MONITOR_BG_INTERVAL_MINUTES=5/" /opt/agenia/.env.production \
  && grep ^MONITOR_BG_INTERVAL_MINUTES /opt/agenia/.env.production'
```

Debe imprimir `MONITOR_BG_INTERVAL_MINUTES=5`. La copia queda en `/var/backups/agenia` (nunca en `/opt/agenia`: el despliegue hace `rsync --delete` ahí). El `rsync` del despliegue no toca `.env.production`.

### Paso 3 · Desplegar

Desde la raíz del repo, en tu computador:

```bash
./update.sh
```

Lo que debe verse, en orden:

| Salida | Qué es |
|---|---|
| `Versión: d47d918@2026-…` | El commit que irá en el aviso de arranque (con `+cambios` si hay algo sin commit) |
| `✔ Código sincronizado` | rsync |
| `Mantenimiento por 20 min…` | El vigía no mirará contenedores mientras se recrean |
| `Reconstruido: api web` | Build e imagen nueva |
| Migraciones con `20261019100000_alertas_tecnicas` y `verificado: … 4 indice(s)` | Las tablas y el índice único parcial `uq_tech_alert_abierta` |
| `agenia verify` en verde | Lo de siempre |
| `Vigía instalado: cada minuto…` y `! Todavía no hay configuración…` | Lo segundo es lo esperado: el bot se conecta en el paso 7 |
| `Fin del mantenimiento…` | Ventana cerrada |

Si el despliegue se corta a medias, la ventana de mantenimiento vence sola a los 20 min; se puede volver a correr `./update.sh` sin riesgo.

### Paso 4 · Verificar el despliegue (solo lectura)

```bash
vps 'docker exec agenia_api printenv AGENIA_VERSION
  agenia logs api 2>/dev/null | grep -E "Monitor de fondo registrado" | tail -1
  docker exec agenia_db psql -U agenia -d antigravity -Atc "SELECT to_regclass('"'"'public.\"TechAlert\"'"'"'), to_regclass('"'"'public.\"TechAlertConfig\"'"'"'), (SELECT count(*) FROM pg_indexes WHERE indexname = '"'"'uq_tech_alert_abierta'"'"')"
  cat /etc/cron.d/agenia-vigia; date +%s; cat /var/lib/agenia/alertas/vigia.latido'
```

| Debe salir | Si no |
|---|---|
| La versión del paso 3 | Se construyó sin `AGENIA_VERSION`: el aviso de arranque dirá «sin registrar» (no bloquea) |
| `… cada 5 min (cron: */5 * * * *)` | Repetir el paso 2 y `agenia up --force-recreate api` |
| `"TechAlert"|"TechAlertConfig"|1` | `agenia migrate` y revisar su salida |
| El cron del vigía, y un latido de hace menos de 1 min | `agenia vigia instalar` |

En el panel, `https://app.hsvpanserma.agenia.co/super-admin/alertas` debe abrir con «Sin configurar» arriba y, en el paso 3, «Vigía del servidor activo».

### Paso 5 · Crear el bot (Telegram, 2 minutos)

1. En Telegram, busque **@BotFather**: es el que tiene la **marca azul de verificado**. Ábralo y toque **Iniciar**.
2. Envíele `/newbot`.
3. Le pide el **nombre** que verá el grupo: `AgenIA Técnico`.
4. Le pide el **usuario**: debe terminar en `bot`, ser único y tener solo letras, números o `_` (ej. `AgeniaTecnicoBot`, `agenia_alertas_bot`). Si está tomado, pruebe otro.
5. BotFather responde con el **token** (`123456789:AA…`, después de «Use this token to access the HTTP API»). Cópielo.

Cuidados:
- El token **es una contraseña**: no lo pegue en chats ni lo deje en capturas. Si se filtra: `/revoke` en BotFather → token nuevo → «Renovar token» en el panel.
- No cambie la privacidad del bot (`/setprivacy`) ni le ponga webhook: como viene, funciona.
- `/setjoingroups` debe seguir en **Enable** (así viene): si no, no se puede agregar a un grupo.

### Paso 6 · Crear el grupo del equipo (Telegram)

Agregue **el bot y a las personas del equipo técnico** al crearlo (Telegram pide al menos un miembro; el bot sirve como el primero).

- **Android:** toque el **lápiz ✏️** (abajo a la derecha) → **Nuevo grupo** → busque y marque a los miembros: escriba el usuario del bot (`AgeniaTecnicoBot`) y a cada persona → toque la **flecha →** → escriba el nombre `AgenIA · Técnico` → toque **✓**.
- **iPhone:** pestaña **Chats** → ícono de **redactar** (arriba a la derecha) → **Nuevo grupo** → marque al bot y a las personas → **Siguiente** → nombre `AgenIA · Técnico` → **Crear**.
- **Computador** (Telegram Desktop o web.telegram.org): menú **☰** (arriba a la izquierda) → **Nuevo grupo** → nombre → **Siguiente** → marque al bot y a las personas → **Crear**.

Si olvidó el bot: abra el grupo → toque el **nombre del grupo** → **Añadir miembros** → busque el usuario del bot.

Ajustes del grupo:
- **Privado** (así viene): no le ponga enlace público ni usuario. Quien esté en el grupo ve nombres de clínicas e información técnica. Si comparte un enlace de invitación, revóquelo después (nombre del grupo → Enlaces de invitación).
- Que **todos puedan enviar mensajes** (así viene). Si un administrador lo restringe, haga **administrador** al bot: necesita poder escribir.
- Cada persona deja las **notificaciones del grupo activadas** (las advertencias de noche ya llegan sin sonido; las críticas deben sonar). Conviene fijar el grupo arriba.
- Si el grupo pasa a supergrupo (más de 200 personas, o al cambiar ciertos ajustes), Telegram le cambia el id: la API lo sigue sola.

### Paso 7 · Conectar el bot y vincular el grupo (panel)

En `https://app.hsvpanserma.agenia.co/super-admin/alertas`, con un usuario SUPER_ADMIN:

1. **Paso 1 de la página — El bot:** pegue el token → **Conectar bot**. Debe aparecer `✔ @AgeniaTecnicoBot · token •••xxxx`.
2. **Paso 2 — El grupo:** **Generar código de vinculación**. La página muestra el comando exacto, por ejemplo `/vincular@AgeniaTecnicoBot 4F7K2Q`, y la hora en que vence (15 min).
3. Toque **Copiar**, péguelo **en el grupo** (no en el chat privado con el bot) y envíelo.
4. Vuelva a la página → **Buscar el grupo**. El grupo recibe «✅ Este grupo recibirá las alertas técnicas de AgenIA» y la franja de arriba pasa a verde: «Activas en «AgenIA · Técnico»».

Si dice «Todavía no llega el código»: confirme que lo escribió en el grupo, completo y con `@AgeniaTecnicoBot`, y vuelva a buscar. «Llegó por un chat privado»: escríbalo en el grupo. Si venció, genere otro.

Al vincular puede llegar enseguida un aviso de algo que **ya estaba fallando**: es real, no un error de la conexión. El primer resumen diario llega al día siguiente a las 07:00.

### Paso 8 · Probar los dos caminos

1. En la página, paso 3: **Enviar mensaje de prueba** → llega «✅ Mensaje de prueba de AgenIA» (con sonido).
2. En el servidor, el vigía (el camino que avisa con la API caída):

   ```bash
   vps 'ls -l /var/lib/agenia/alertas/telegram.env; agenia vigia prueba; agenia vigia estado'
   ```

   Debe mostrar `-rw------- … root … telegram.env` (lo escribió la API al vincular), `Mensaje de prueba enviado.` (y en el grupo «✅ Prueba del vigía del servidor») y `Sin problemas abiertos.`

### Paso 9 · Ajustes

Los valores de por defecto son los aprobados (A6/A7/A13) y sirven tal cual: todas las categorías encendidas; recordar cada 60 min, máximo 3; de 22:00 a 06:00 las advertencias sin sonido; resumen diario a las 07:00; URL del panel vacía (usa `https://app.hsvpanserma.agenia.co`). Cada cambio queda en la auditoría global.

### Paso 10 · Chequeo externo (A9)

Para el caso «se cayó el servidor entero»: §5 de esta guía (UptimeRobot, gratis, sin código, al mismo grupo).

### Paso 11 · La primera semana (Fase 4)

- Lea cada aviso: ¿era real?, ¿llegó a tiempo?, ¿sobró? Anótelo en el §13 del plan.
- Cada mañana debe llegar el resumen de las 07:00. **El día que no llegue, el canal está roto** (franja roja en el panel con el motivo).
- Revise la **Bitácora** del panel: «Sin enviar» es lo que no salió por silencio o categoría apagada; «Falló: …» es un problema del canal.
- Si algo hace ruido, el ajuste va en el código (umbrales de `UMBRALES_ALERTAS` en `@agenia/shared`), no apagando la categoría entera.

### Si hay que apagarlo o volver atrás

| Qué | Cómo |
|---|---|
| Que no salga nada (API y vigía) | Panel → **Apagar alertas**. Todo se sigue registrando |
| Un rato (mantenimiento) | Panel → **Silenciar**; o `vps 'agenia mantenimiento 30'` (solo el vigía, contenedores y panel) |
| Solo el vigía | Panel → desmarcar la categoría **Servidor**. (Borrar `/etc/cron.d/agenia-vigia` dura hasta el próximo despliegue, que lo reinstala) |
| Los avisos de los casos de Soporte | Panel → desmarcar la categoría **Casos de soporte**. Los casos se abren igual y la Mesa de Ayuda dice que no se avisaron (docs/PLAN_BOT_SOPORTE.md §15) |
| Desconectar el bot | Panel → **Desconectar** (se despide del grupo y borra el token, también del archivo del vigía) |
| Volver al código anterior | Desplegar `45caa5f`. Las tablas nuevas quedan y no estorban: la migración solo agregó |

Quien esté en el grupo ve los nombres de las clínicas y la información técnica: manténgalo privado, sin enlace de invitación público.

## 2. Qué avisa y qué hacer

| Encabezado | Qué pasa | Primer paso |
|---|---|---|
| 🔴 Servicio caído · Espejo con el HIS | El agente del hospital no late, no alcanza la base del HIS, o hay eventos rendidos | `/super-admin/monitor`; en el hospital, `checkHealthAgente.sh` |
| 🔴/🟠 Servicio caído/degradado · Gemini, Meta, TTS, Telegram | La integración no responde (o tarda: solo si se repite en dos chequeos) | `/super-admin/monitor` → «Iniciar» en vivo |
| 🔴 Redis no responde | El bot pierde las sesiones de los pacientes | `agenia ps`, `agenia logs redis` |
| 🟠→🔴 Una tarea programada falló | Un cron revienta (crítico tras 3 fallos y 10 min) | `agenia logs api` y el nombre del cron en el mensaje |
| 🔴 Los recordatorios no están saliendo | Un lote sin ningún envío y ≥ 3 fallos | Plantilla de Meta y token de WhatsApp de la clínica |
| 🟠 El aviso al agendador no sale | Sin plantilla aprobada, sin número de agendador o Meta lo rechaza | Configuración del espejo de la clínica |
| 🟠/🔴 Error del servidor | Un 5xx nuevo (ruta y clase de la excepción); 🔴 si son ≥ 20 en 5 min | `/super-admin/logs` |
| 🔴 Falta el DDL del espejo | Al arrancar, faltan los triggers del outbox | `pnpm --filter @agenia/database db:apply-sql` |
| ℹ️ La API arrancó | Cada arranque, con la versión desplegada (sin sonido) | — |
| 🔴 La API se está reiniciando en bucle | Dos arranques en 10 min | `agenia logs api` |
| 🔴/🟠 … · Servidor | Lo ve el **vigía** (§4): contenedor caído o reiniciado, panel sin responder, disco, respaldo | `agenia ps`, `df -h`, `agenia backup` |

Cada problema llega **una vez**; si empeora llega «(empeoró)»; si sigue abierto se recuerda cada 60 min (hasta 3 veces); al resolverse llega «✅ RESUELTO» con lo que duró. Lo que se abre a la vez llega junto. A las **07:00** llega el resumen del día anterior: **si un día no llega, el problema es el canal** (bot expulsado, token revocado), no que todo esté bien.

## 3. Silenciar

- **Desde el panel:** «Silenciar» 1 h, 4 h o hasta mañana a las 7. Los problemas se registran igual; lo que siga abierto al terminar el silencio se avisa entonces.
- **De noche** (22:00–06:00, configurable) las advertencias llegan sin sonido; las críticas suenan siempre.
- **Despliegues:** `update-vps.sh` abre una ventana de mantenimiento de 20 min para el vigía y la cierra al terminar. A mano: `agenia mantenimiento 30` / `agenia mantenimiento fin`.

## 4. El vigía del servidor

[`deploy/vigia.sh`](../deploy/vigia.sh) corre cada minuto en el host (`/etc/cron.d/agenia-vigia`), **sin depender de la API**: es lo que avisa cuando la API, la base o el proxy se caen.

| Mira | Avisa |
|---|---|
| `agenia_api`, `agenia_web`, `agenia_db`, `agenia_redis`, `agenia_proxy` | 🔴 detenido, no existe o `unhealthy` (confirmado en dos vueltas); 🟠 si Docker lo reinició solo |
| El panel por su dirección, a través del proxy (en el propio servidor) | 🔴 HTTP ≥ 500 o sin respuesta (dos vueltas) |
| El disco | 🟠 desde 80 %, 🔴 desde 90 % (se resuelve bajo 75 %) |
| El respaldo de hoy, desde las 04:30 | 🔴 si no hay un `agenia-AAAAMMDD-*.sql.gz` válido |

- **Configuración:** la escribe la API en `/var/lib/agenia/alertas/telegram.env` (root, 600) cada vez que se guarda el panel. **No editar:** se reescribe. Lleva el token en claro, con el mismo trato que `.env.production`.
- **Comandos:** `agenia vigia instalar` (lo deja el instalador y cada `update-vps.sh`), `agenia vigia prueba`, `agenia vigia estado` (problemas abiertos).
- **Log:** `/var/log/agenia-vigia.log` (solo cambios de estado y errores de envío; rota semanal).
- **¿Corre?** El panel lo dice en el paso 3 («Vigía del servidor activo» o «no corre desde…»): el vigía deja la hora de su última vuelta en `/var/lib/agenia/alertas/vigia.latido`.
- **Pruebas:** `bash deploy/vigia.test.sh` (61 casos, con `docker`/`curl`/`df` falsos; corre en macOS y en Ubuntu).

## 5. Si se cae el servidor entero: chequeo externo (A9)

Nada que corra en el VPS puede avisar si el VPS entero se cae (Contabo, la red). Para eso, un chequeo **desde fuera**, sin código:

1. Cree una cuenta gratuita en [UptimeRobot](https://uptimerobot.com).
2. «Add New Monitor» → tipo **HTTP(s)**, URL `https://app.hsvpanserma.agenia.co/login`, intervalo 5 min.
3. «Alert Contacts» → **Telegram**: siga sus pasos para agregar su bot al MISMO grupo del equipo.
4. Pruebe con «Pause/Resume» o apagando el proxy en una ventana de mantenimiento.

## 6. Si no llegan los avisos

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El panel dice «Las alertas NO están saliendo … ya no puede escribir en el grupo» | Sacaron el bot del grupo (403) | Agregar el bot de nuevo y «Vincular otro grupo» |
| «Telegram rechazó el token» | Se revocó en @BotFather | Pegar el token nuevo en «Renovar token» |
| El grupo pasó a supergrupo | Telegram cambia el id | Nada: la API sigue al grupo nuevo sola |
| No llega el resumen de las 7 | El canal está roto, o el resumen está apagado | Revisar la franja de arriba del panel y el último error |
| El vigía no avisa | No corre, o la categoría «Servidor» está apagada | Panel → paso 3; `agenia vigia estado`; `tail /var/log/agenia-vigia.log` |
| La bitácora dice «Sin enviar» | Apagado, en silencio o con la categoría apagada | Es a propósito: quedó registrado |

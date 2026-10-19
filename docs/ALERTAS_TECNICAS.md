# 🚨 Alertas técnicas por Telegram — operación

Cuando algo falla, el sistema le escribe al instante a un **grupo de Telegram del equipo técnico**: qué pasó, en qué clínica y desde cuándo. Solo el **SUPER_ADMIN** lo configura, en `/super-admin/alertas`; ningún administrador de clínica lo ve. Diseño y decisiones: [PLAN_ALERTAS_TECNICAS.md](PLAN_ALERTAS_TECNICAS.md).

Los mensajes **nunca llevan datos de pacientes** (ni nombres, ni documentos, ni teléfonos): el detalle queda detrás del inicio de sesión. Tampoco gastan IA: los textos los arma el código.

## 1. Ponerlo en marcha (una vez)

1. **El bot.** En Telegram, abra [@BotFather](https://t.me/BotFather) → `/newbot` → nombre «AgenIA Técnico», usuario terminado en `bot`. Pegue el token en `/super-admin/alertas` → «Conectar bot». Tiene que ser un bot **propio para las alertas**: el de una clínica se rechaza (en ese escriben pacientes).
2. **El grupo.** Cree un grupo **privado** del equipo y agregue el bot. En el panel, «Generar código de vinculación», escriba en el grupo el comando que muestra el panel (`/vincular@AgeniaTecnicoBot ABC123`, vence en 15 min) y pulse «Buscar el grupo». El grupo recibe la bienvenida y las alertas quedan encendidas.
3. **Probar.** «Enviar mensaje de prueba» en el panel, y en el servidor `agenia vigia prueba` (el vigía avisa por el mismo bot aunque la API esté caída).
4. **Producción:** `MONITOR_BG_INTERVAL_MINUTES=5` en `/opt/agenia/.env.production` (el valor escrito gana sobre el de por defecto) y `agenia restart api`.

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

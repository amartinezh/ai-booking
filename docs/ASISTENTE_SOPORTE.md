# 🛟 Asistente de soporte por Telegram — operación

Un bot de Telegram propio de la plataforma que atiende al **personal de las clínicas**: responde con el manual (`docs/conocimiento/AGENIA.md`) y la IA de la clínica de quien pregunta, abre casos en Soporte con el «sí» de la persona y le avisa cuando los toman y cuando quedan resueltos. Lo configura el **SUPER_ADMIN** en `/super-admin/soporte-bot`. Diseño, decisiones y bitácoras: [PLAN_BOT_SOPORTE.md](PLAN_BOT_SOPORTE.md).

Tiene **tres interruptores**, de afuera hacia adentro:

| Interruptor | Dónde | Apagado |
|---|---|---|
| `SUPPORT_BOT_ENABLED=true` | `.env.production` de la API | No existe ninguna ruta del asistente ni la tarjeta de Soporte. Los avisos de los casos al grupo siguen funcionando (son de las alertas técnicas). |
| **Encender / Apagar** | `/super-admin/soporte-bot` | El bot no responde y la tarjeta no aparece. |
| **Piloto** | `/super-admin/soporte-bot` | Encendido (así nace): solo las personas de la lista ven la tarjeta y conversan. «Abrir a todo el personal» lo apaga. |

## 1. Paso a producción (una vez)

Servidor: `89.117.61.28` (hsvpanserma), llave `~/.ssh/agenia_89_117_61_28_ed25519`.

```bash
vps() { ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 "$@"; }
```

**Estado del servidor revisado el 2026-10-20, solo lectura:**

- Versión desplegada: `d47d918`, seis commits atrás del asistente.
- Las alertas técnicas están conectadas, con su grupo y encendidas: el aviso al grupo de los casos tiene canal.
- No hay `SUPPORT_BOT_ENABLED` y el Caddy no tiene la ruta del webhook.
- La IA del hospital es Gemini.
- El personal: 1 administrador, 1 agente de reservas y 30 médicos.

**Qué cambia al desplegar, aunque el asistente siga apagado:**

- El Centro de ayuda se arma con `AGENIA.md` (se ve igual).
- Cada caso nuevo de Soporte, también los del panel, llega al grupo de las alertas técnicas (categoría «Casos de soporte»). Los que ya existen no se anuncian.
- La Mesa de Ayuda muestra el número de cada caso.

El orden importa: **primero el servidor (pasos 1 a 6), después el examen y Telegram (7 a 10)**.

### Paso 1 · Respaldo

```bash
vps 'agenia backup'
```

Debe terminar en `✔ Backup: /var/backups/agenia/agenia-AAAAMMDD-HHMMSS.sql.gz`. Las tres migraciones del asistente solo agregan tablas, columnas y valores.

### Paso 2 · `SUPPORT_BOT_ENABLED=true` (antes de desplegar)

Va antes porque el despliegue recrea la API y así la toma de una vez (`agenia restart api` no vuelve a leer el `.env`).

```bash
vps 'cp -a /opt/agenia/.env.production /var/backups/agenia/env.production.$(date +%Y%m%d-%H%M%S) \
  && (grep -q "^SUPPORT_BOT_ENABLED=" /opt/agenia/.env.production \
      && sed -i "s/^SUPPORT_BOT_ENABLED=.*/SUPPORT_BOT_ENABLED=true/" /opt/agenia/.env.production \
      || echo "SUPPORT_BOT_ENABLED=true" >> /opt/agenia/.env.production) \
  && grep ^SUPPORT_BOT_ENABLED /opt/agenia/.env.production'
```

Debe imprimir `SUPPORT_BOT_ENABLED=true`. Los códigos se firman con `ENCRYPTION_KEY`, que ya existe; `SUPPORT_BOT_CODE_KEY` es opcional.

### Paso 3 · Desplegar

Desde la raíz del repo, en tu computador:

```bash
./update.sh
```

| Salida | Qué es |
|---|---|
| `Versión: …` | El commit desplegado |
| Migraciones `20261019200000_asistente_soporte`, `20261019210000_asistente_soporte_respuestas` y `20261020100000_asistente_soporte_piloto` | Las tablas del asistente, el número, el canal y la prioridad de los casos, y el piloto |
| `verificado: … 6 indice(s)` | Incluye `uq_support_bot_abierta_usuario` y `uq_support_bot_abierta_telegram`: una conversación abierta por persona y por cuenta |
| `agenia verify` en verde | Lo de siempre |

### Paso 4 · Verificar el despliegue (solo lectura)

```bash
vps 'docker exec agenia_api printenv AGENIA_VERSION SUPPORT_BOT_ENABLED
  docker exec agenia_db psql -U agenia -d antigravity -Atc "SELECT to_regclass('"'"'public.\"SupportBotConfig\"'"'"'), (SELECT count(*) FROM pg_indexes WHERE indexname LIKE '"'"'uq_support_bot_abierta_%'"'"')"
  docker exec agenia_api sh -c "ls -l /app/docs/conocimiento/AGENIA.md"
  docker exec agenia_api node -e "fetch(\"http://127.0.0.1:3000/support-bot/webhook/x\",{method:\"POST\"}).then(r=>console.log(\"webhook interno:\",r.status))"'
```

| Debe salir | Si no |
|---|---|
| La versión y `true` | Repetir el paso 2 y `agenia up --force-recreate api` |
| `"SupportBotConfig"\|2` | `agenia migrate` y revisar su salida |
| El archivo `AGENIA.md` | Sin manual, el asistente responde con el buscador. Revisar `.dockerignore` |
| `webhook interno: 401` | `404` = la API no tomó `SUPPORT_BOT_ENABLED` |

En el panel, `https://app.hsvpanserma.agenia.co/super-admin/soporte-bot` debe abrir con «Bot de Telegram» sin conectar.

### Paso 5 · La ruta del webhook en el Caddy

El Caddy de este servidor es una **lista blanca**: toda ruta `/api/*` que no esté escrita responde 404, y Telegram no le podría entregar los mensajes al asistente. Se edita con el procedimiento de siempre: subir y comprobar primero, respaldo, `cat >` (mismo inodo), `validate` y solo entonces `reload`, sin corte.

1. Bajar el archivo real y agregarle el bloque **antes** del `handle /api/* {` final (el que responde 404):

   ```bash
   vps 'cat /opt/agenia/deploy/Caddyfile' > Caddyfile.prod
   ```

   El bloque, con tabuladores como el resto del archivo:

   ```
   	# ── Webhook del asistente de soporte (docs/ASISTENTE_SOPORTE.md) ──────
   	# Solo el webhook: /support-bot/me y /support-bot/admin los usa el panel por
   	# la red interna y NO se publican. Lo protege su secret_token (401 sin él).
   	handle /api/support-bot/webhook/* {
   		uri strip_prefix /api
   		reverse_proxy api:3000
   	}
   ```

2. Comprobar en tu computador: `grep -c 'handle /api/support-bot/webhook/\*' Caddyfile.prod` debe dar `1`, y `shasum -a 256 Caddyfile.prod` da el checksum que se compara abajo.

3. Subir, comprobar y aplicar:

   ```bash
   scp -i ~/.ssh/agenia_89_117_61_28_ed25519 Caddyfile.prod root@89.117.61.28:/tmp/Caddyfile.nuevo
   vps 'set -e; N=/tmp/Caddyfile.nuevo; F=/opt/agenia/deploy/Caddyfile
     [ -s "$N" ]; sha256sum "$N"
     B=/var/backups/agenia/Caddyfile.$(date +%Y%m%d-%H%M%S)-antes-soporte; cp -a "$F" "$B"
     cat "$N" > "$F"
     if docker exec agenia_proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
       docker exec agenia_proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && echo "Caddy recargado"
     else cat "$B" > "$F"; echo "NO valida: restaurado"; exit 1; fi'
   ```

   El checksum debe ser el del paso 2. Debe terminar en `Caddy recargado`.

4. Desde tu computador: `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.hsvpanserma.agenia.co/api/support-bot/webhook/x` debe dar **401** (antes del cambio daba 404). Un 401 quiere decir que llegó a la API y que la API rechazó la ruta falsa: es lo correcto.

### Paso 6 · El examen del asistente con la IA del hospital

Antes de que lo use una persona, el asistente presenta el examen (60 preguntas por rol: cómo se hace algo, errores, cosas de otro rol, fallas, lo que el manual no cubre, temas ajenos y seguridad) con **la misma IA que usará**: la del hospital, sin que nadie copie la clave. **Gasta tokens del hospital**: 60 respuestas con unos 30.000 tokens de entrada cada una, casi todos de la caché a partir de la segunda.

```bash
vps 'ORG=$(docker exec agenia_db psql -U agenia -d antigravity -Atc "SELECT id FROM \"Organization\" WHERE name LIKE '"'"'Hospital San Vicente%'"'"'")
  docker exec -e EXAMEN_CLINICA=$ORG -e EXAMEN_SALIDA=/tmp/examen-soporte.json agenia_api \
    node apps/api/dist/support-bot/examen/examen.cli.js; echo "salida: $?"'
```

| Para aprobar | Si no aprueba |
|---|---|
| `APROBADO`: al menos 90 % de temas correctos, cero respuestas ilegibles y cero violaciones | Leer los casos marcados `✗`. Si el manual no lo explica, completar `AGENIA.md`; si la IA no sigue una regla, ajustar las instrucciones (`soporte-bot-prompt.ts`); si tampoco la sigue con las instrucciones (le pasó a Gemini con el Markdown), resolverla en el código que lee la respuesta (`leerRespuestaIA`). Desplegar y repetir. El examen cambia de una corrida a otra. No se abre el piloto sin aprobar. |

El reporte completo queda en el contenedor: `vps 'docker exec agenia_api cat /tmp/examen-soporte.json' > examen-soporte.json`.

### Paso 7 · Crear el bot (Telegram, 2 minutos)

1. En Telegram, abra **@BotFather** (el de la **marca azul de verificado**) → **Iniciar**.
2. Envíe `/newbot`.
3. **Nombre** que verá el personal: `AgenIA Soporte`.
4. **Usuario**: termina en `bot`, único (ej. `AgeniaSoporteBot`, `hsvp_soporte_bot`).
5. Copie el **token** (`123456789:AA…`).
6. Opcional: `/setdescription` → elija el bot → `Asistente de soporte de AgenIA para el personal de las clínicas. Para conversar, escribe el código que te da el panel en Soporte.` Es lo que se ve antes de tocar «Iniciar».

Cuidados:
- Debe ser un bot **nuevo**, solo para el asistente: el panel rechaza el de las alertas y el de una clínica.
- El token **es una contraseña**. Si se filtra: `/revoke` en BotFather → token nuevo → «Renovar token» en el panel.
- No le ponga webhook a mano: lo pone el panel al conectarlo, con su secreto.

### Paso 8 · Conectar, armar el piloto y encender (panel)

En `https://app.hsvpanserma.agenia.co/super-admin/soporte-bot`, con un usuario SUPER_ADMIN:

1. **Bot de Telegram**: pegue el token → **Conectar bot**. Debe decir `Conectado: @…` y «Telegram entrega los mensajes a AgenIA».
2. **Piloto**: escriba los correos de las personas del piloto (§2), uno por línea → **Guardar el piloto**. Solo se aceptan usuarios del personal de una clínica activa; si uno no lo es, la página dice cuál.
3. **Encender**.

Desde este momento, las personas del piloto ven en Soporte la tarjeta «Asistente de soporte en Telegram». Nadie más nota nada.

### Paso 9 · Probar de punta a punta

1. **Modo prueba (super admin):** en «Probar el asistente», elija el hospital → **Generar código de prueba** → escríbalo en el bot. Pregunte algo del manual («¿cómo abro cupos?») y cuente una falla («no salen los recordatorios»): debe armar el caso y, con el «sí», responder «Modo prueba: aquí abriría el caso…» (no se registra).
2. **Con una persona del piloto:**
   - Desde su usuario, en Soporte → **Generar código** → conversa.
   - Abre un caso real que diga «Prueba del asistente, ignorar». El grupo del equipo técnico recibe «🛟 Caso nuevo #…».
   - En la Mesa de Ayuda: **Iniciar atención** → a la persona le llega «👀 …». **Marcar solucionado** → le llega «✅ … ¿Quedó bien?».
3. **Monitor de Servicios:** «Asistente de soporte (Telegram)» en verde.
4. **Cómo va** (abajo en la misma página): aparece la conversación y el caso.

### Paso 10 · Avisarle al piloto

Un mensaje corto a cada persona del piloto (por el canal de siempre):

> Estamos probando un asistente de AgenIA por Telegram para resolver dudas del panel y reportar fallas. En AgenIA › Soporte vas a ver «Asistente de soporte en Telegram»: pulsa «Generar código», escríbelo en el bot y pregúntale lo que necesites como se lo preguntarías a una persona. Si algo falla, te ayuda a abrir el caso y te avisa cuando lo resuelvan. Cuéntanos qué tal te va: lo que no entienda o no sepa nos sirve para mejorarlo.

## 2. El piloto (una semana)

**Quiénes:** de 3 a 5 personas que usen el panel a diario y digan lo que piensan. En el hospital hay 1 administrador, 1 agente de reservas y 30 médicos: el administrador, la agente y 1 a 3 médicos.

**Cada día, unos 15 minutos** (en `/super-admin/soporte-bot`):

1. **Cómo va** (7 días): conversaciones, «Me sirvió» contra «No, abrir un caso», respuestas sin IA, tiempo de respuesta. Las respuestas sin IA deberían ser pocas; si no, mirar las alertas de la categoría «Asistente de soporte».
2. **Lo que el manual no cubrió:** cada pregunta es un hueco de `AGENIA.md`. Completarlo (es el mismo archivo del Centro de ayuda, con su regla de commit) y desplegar: el asistente lo lee sin reiniciar.
3. **Conversaciones**, con los filtros «No le sirvió» y «El manual no cubrió algo». Leer también algunas que salieron bien: ¿la respuesta era cierta?, ¿clara?, ¿el tono? Lo que la IA hace mal se corrige en sus instrucciones (`packages/shared/src/soporte-bot-prompt.ts`) y se repite el examen (§1 paso 6).
4. **Casos** que llegaron por Telegram (Mesa de Ayuda, «Por Telegram»): ¿el título y el detalle bastaban para atenderlo?, ¿la prioridad era la correcta?
5. Anotar lo visto en la bitácora del piloto (`PLAN_BOT_SOPORTE.md` §17).

**Para abrirlo a todo el personal**, al cabo de la semana:

- Ninguna respuesta peligrosa o falsa sin corregir (manual o instrucciones ajustados y el examen aprobado de nuevo).
- «Me sirvió» más que «No, abrir un caso», y lo que el manual no cubrió ya está en el manual.
- Ninguna alerta del asistente abierta.
- Las personas del piloto lo recomiendan.

Entonces: **Abrir a todo el personal** (pide confirmación) y un aviso para todos con el mismo texto del paso 10. Si algo sale mal después, **Volver al piloto** deja otra vez solo a la lista, sin borrar nada.

## 3. Operación diaria

- **Cómo va** y **Lo que el manual no cubrió**: una vez por semana, como en el piloto pero más corto.
- **Alertas técnicas**, categoría «Asistente de soporte»: webhook caído (lo ve el monitor), la IA de una clínica falla 3 veces en 15 minutos (se resuelve sola con la primera respuesta con IA), una clínica llegó a su tope diario de IA y 20 códigos equivocados en 10 minutos (alguien probando códigos al azar).
- **Casos de Soporte en el grupo**, categoría «Casos de soporte»: cada caso nuevo, el reabierto y el que lleva 2 horas del horario del equipo sin que nadie lo tome.
- Las conversaciones se borran solas a los 180 días; leer una queda en la bitácora del sistema.

## 4. Si hay que apagarlo o volver atrás

| Qué | Cómo |
|---|---|
| Que el bot deje de atender ya | Panel → **Apagar**. La tarjeta desaparece; los casos y las conversaciones quedan |
| Que solo lo use el piloto otra vez | Panel → **Volver al piloto** |
| Cambiar de bot | Panel → **Desconectar** y conectar el nuevo (el viejo deja de recibir mensajes) |
| Quitarlo del servidor | `SUPPORT_BOT_ENABLED=false` en `.env.production` y `vps 'agenia up --force-recreate api'`. La ruta del Caddy puede quedarse: la API responde 404 |
| Que los casos no lleguen al grupo | `/super-admin/alertas` → desmarcar **Casos de soporte** |
| Volver al código anterior | Desplegar el commit anterior. Las migraciones solo agregaron: las tablas y columnas nuevas no estorban |

## 5. Si algo no sale bien

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| A una persona no le aparece la tarjeta | Asistente apagado, la persona no está en el piloto, o es paciente | Panel: encendido y lista del piloto |
| El bot no responde nada | Telegram no llega a la API: falta la ruta en el Caddy, o el webhook se perdió | Monitor («Asistente de soporte» en rojo); `curl` del paso 5; en el panel, «Renovar token» vuelve a poner el webhook |
| «Ese código no es válido o ya venció» | Código viejo, usado o de otra generación | Generar otro; tras 5 equivocados, la cuenta espera 1 hora |
| «El asistente de soporte está en piloto» al generar el código | La persona no está en el piloto | Agregarla, o abrirlo a todos |
| Responde «Ahora mismo no puedo pensar la respuesta con calma…» | Sin IA: la clínica no tiene IA, falló, o llegó a su tope del día | Alertas de la categoría; Configuración › Integración de IA de la clínica; el tope en el panel |
| Un caso no llegó al grupo | Alertas apagadas, categoría «Casos de soporte» apagada, silencio o Telegram falló | La Mesa de Ayuda dice el motivo debajo del caso; se reintenta durante 24 h |
| A la persona no le llegan los avisos de su caso | Apagó los avisos, nunca conversó con el asistente, salió del piloto o bloqueó el bot | La tarjeta de Soporte dice a dónde llegan; desbloquear el bot en Telegram |
| El examen no aprueba | El manual no cubre algo o la IA no sigue una regla | §1 paso 6 |

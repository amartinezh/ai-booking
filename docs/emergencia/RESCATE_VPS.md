# 🚨 Rescate de AgenIA en un VPS nuevo, con todos sus datos

> **Qué es.** El procedimiento para levantar AgenIA completo (panel, API, base de datos, Redis, proxy con sus certificados, landing `agenia.co`, vigía, respaldos y endurecimiento) en un VPS **recién entregado**, a partir de una copia hecha con `./respaldo.sh`. Está escrito para que **una IA con acceso a este repositorio y a una terminal lo ejecute de principio a fin** sabiendo solo la IP del servidor nuevo, y para que una persona pueda seguirlo y auditarlo.
>
> **Cuándo se usa.** El servidor de producción (`89.117.61.28`, Contabo `vmi3288892`) se perdió, quedó inservible o se va a reemplazar por otro. Si solo hay que actualizar el código en el servidor que ya funciona, esto **no** aplica: se usa `./update.sh`.
>
> **Fuentes.** Todo lo de aquí está probado en este repositorio y en el servidor real: `deploy/install-vps.sh`, `deploy/agenia.sh`, `docker-compose.deploy.yml`, `docs/INSTALACION_VPS.md`, `docs/SEGURIDAD.md`, `docs/ALERTAS_TECNICAS.md`, `docs/drivers/cnt-sanvicente-anserma/` y la bitácora de `docs/conocimiento/AGENIA.md`. Estado del servidor tomado el **2026-11-17** (solo lectura).

---

## 0. Cómo usar esta guía

### 0.1 La orden para la IA

La persona abre una sesión de la IA en la raíz de este repositorio y escribe:

> Hay que rescatar AgenIA en un VPS nuevo. **IP: `<IP>`**. El servidor viejo `89.117.61.28` **está caído** *(o: sigue respondiendo)*. Sigue `docs/emergencia/RESCATE_VPS.md` al pie de la letra con la copia `respaldos/ultimo`. Detente en cada ⛔ y pregúntame.

Nada más. Todo lo demás sale de este archivo, del repositorio y de la copia.

### 0.2 Reglas estrictas (la IA las cumple siempre; ninguna se negocia)

| # | Regla | Por qué |
|---|---|---|
| R1 | **Nunca dos servidores vivos a la vez.** Antes de arrancar la API del servidor nuevo, la API y la web del viejo están detenidas (fase 2) o el viejo no responde. | Los dos mandarían recordatorios, ofertas de la lista de espera y mensajes masivos con el mismo número de WhatsApp: pacientes con mensajes duplicados. Y el agente del hospital trabajaría contra dos bases. |
| R2 | **Nunca levantar la API con datos de producción en un servidor que no va a ser la producción** (pruebas, simulacros, «a ver si funciona»). | La API no tiene interruptor para apagar sus tareas programadas: al arrancar con la base real empieza a escribirles a los pacientes reales. El simulacro seguro está en el anexo C. |
| R3 | **No cambiar ningún secreto durante el rescate** (`ENCRYPTION_KEY`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `SUPERADMIN_PURGE_PASSWORD`). Se usan los de la copia. | La `ENCRYPTION_KEY` descifra las credenciales de WhatsApp, Telegram y la IA guardadas en la base: con otra quedan ilegibles para siempre. La clave de Postgres la fija el volumen la primera vez que arranca. |
| R4 | **Los secretos no se imprimen, no se pegan en el chat, no se suben a git ni a ningún servicio.** Para comprobar un `.env` se listan las **claves**, nunca los valores. | `.env.production` y la copia son datos sensibles (Ley 1581: datos de salud). |
| R5 | **Ninguna copia, respaldo ni temporal bajo `/opt/agenia`** en el servidor: van a `/var/backups/agenia` (root, 700). | Cada despliegue hace `rsync --delete` sobre `/opt/agenia`: así se perdió un respaldo el 2026-10-04. |
| R6 | **Cada fase termina con su verificación ✅. Si una verificación falla, la IA se detiene**, explica qué vio y busca en el catálogo (§6) antes de improvisar. Nunca «se salta» una fase que falló. | Un error a medias (base sin disparadores, Caddy con la configuración vieja) no avisa: aparece días después. |
| R7 | **Los ⛔ son puntos de parada**: la IA no sigue sin la respuesta de la persona. | Son decisiones o acciones que solo ella puede hacer (DNS, apagar el viejo, contactar al hospital). |
| R8 | **Cada llamada a la terminal es un shell nuevo**: las variables no sobreviven. Todo comando empieza con `source respaldos/rescate/entorno.sh` (fase 0). | Lección del 2026-09-28: un `export` de un comando anterior ya no existía y un script tomó la base equivocada. |
| R9 | En la terminal de la persona (zsh en macOS), los atajos son **funciones**, no variables con un comando adentro. | En zsh `$VPS 'cmd'` con `VPS='ssh …'` no funciona: zsh no parte la variable en palabras. |
| R10 | Las comprobaciones con `grep` dentro de un `|` usan `>/dev/null`, **no** `grep -q`. | Con `set -o pipefail`, `grep -q` corta la lectura y el comando de la izquierda muere por `SIGPIPE`: la comprobación falla aunque el texto esté. |
| R11 | Nada destructivo contra `89.117.61.28` salvo lo que dice la fase 2, y nada destructivo en el servidor nuevo fuera de lo escrito aquí. La fase 8 trae una guarda: solo borra la base si está **vacía**. | Si la IP está mal escrita, la guarda evita borrar una base con datos. |
| R12 | Lo que la IA no pueda hacer por permisos (por ejemplo, un modo automático que bloquea borrados masivos en producción), lo hace la persona desde su terminal con el comando exacto que la IA le da. | Pasó en el corte del 2026-10-04. |
| R13 | Al final, la IA entrega el **informe** del anexo E. | La persona debe saber qué quedó, qué falta y qué se perdió (la brecha de datos, §5 fase 18). |

### 0.3 Convenciones

- 🧑 lo hace la persona · 🤖 lo hace la IA · ⛔ parada obligatoria · ✅ verificación · 🔁 se puede repetir sin daño.
- «Laptop» es el computador con este repositorio. «Servidor nuevo» es `<IP>`.
- Los comandos de la laptop se corren **en la raíz del repo**. Los del servidor van por `vps '…'` o por `vps 'bash -s' <<'EOF' … EOF` (el texto entre `EOF` corre en el servidor, en bash).
- Duración esperada: 60–120 minutos, de los cuales 10–25 son la compilación de las imágenes.

---

## 1. Antes de que pase algo (en tiempos de paz)

Esto no es parte del rescate, pero decide si el rescate es posible y cuántos datos se pierden.

1. **Copia diaria a la laptop**: `./respaldo.sh` (≈ 30 s, ≈ 23 MB). Lo que pase entre la última copia y la caída **se pierde** en AgenIA (fase 18). Con Docker encendido, la copia queda además **probada** (se restaura en un Postgres desechable y se guardan los conteos en `CONTEOS.tsv`); sin Docker, correr después `./respaldo.sh --verificar respaldos/ultimo`.
2. **Una segunda copia fuera de la laptop**, cifrada: `./respaldo.sh --cifrar` deja `respaldos/<fecha>.tar.gz.enc`; ese archivo (y su `.sha256`) se puede llevar a un disco externo. La frase va al gestor de contraseñas: **sin la frase la copia no se abre**.
3. **TTL bajo en el DNS** (Hostinger, zona `agenia.co`): `300` segundos en los registros A de `app.hsvpanserma`, `estadisticas.hsvpanserma`, `@` y `www`. Con el TTL por defecto el cambio de IP puede tardar horas en llegar a todos.
4. Tener a mano: acceso al panel de **Contabo** (pedir/reinstalar VPS, consola VNC), al **DNS de Hostinger**, el contacto de **TI del hospital** (reiniciar el agente) y este repositorio clonado (GitHub).
5. Cada mes: `./respaldo.sh --verificar respaldos/ultimo` con Docker encendido.

---

## 2. Lo que la persona debe tener o hacer 🧑

| # | Qué | Detalle |
|---|---|---|
| 1 | **Un VPS nuevo** | Ubuntu **24.04 LTS** (lo que corre hoy; también sirve Debian 12). Mínimo 2 vCPU, 4 GB RAM y 30 GB; lo de hoy: 6 vCPU, 11 GB RAM, 96 GB. amd64 o arm64. |
| 2 | **Acceso root por llave para la IA** | Ver fase 3. La IA no puede escribir contraseñas interactivas: o se pone la llave pública al pedir/reinstalar el VPS en Contabo, o la persona corre **una vez** `ssh-copy-id` y escribe la contraseña de root. |
| 3 | **La copia** | `respaldos/ultimo` en la laptop (o la copia cifrada y su frase). Si la laptop se perdió: clonar el repo en otra máquina y traer la copia del disco externo a `respaldos/`. **Sin copia** no hay datos: anexo A. |
| 4 | **El DNS** (fase 14) | Cambiar 4 registros A en Hostinger a la IP nueva (si la IP cambió). |
| 5 | **TI del hospital** (fase 15, solo si hace falta) | Reiniciar el agente del espejo en su máquina (`192.168.1.175`): `sudo systemctl restart agenia-mirror-agent`. |

---

## 3. Mapa de lo que se va a reconstruir

### 3.1 Piezas

```
Internet ──► :80/:443 (UFW: solo 22, 80, 443/tcp y 443/udp)
             │
             ▼
   agenia_proxy  caddy:2-alpine   /opt/agenia/deploy/Caddyfile (bind-mount de ARCHIVO, lista blanca)
     ├─ app.hsvpanserma.agenia.co ── /api/chatbot/webhook*  ──► api:3000  (Meta, firma obligatoria)
     │                              /api/telegram/webhook/* ──► api:3000  (pacientes, secret_token)
     │                              /api/support-bot/webhook/* ► api:3000 (asistente del personal)
     │                              /api/mirror*            ──► api:3000  (agente del hospital, token)
     │                              /api/padron/*           ──► web:3000  (carga del padrón, Route Handlers)
     │                              /api/* resto            ──► 404
     │                              todo lo demás           ──► web:3000  (panel Next.js)
     ├─ estadisticas.hsvpanserma.agenia.co ── solo /estadisticas/<org> y /_next/static ► web:3000
     ├─ agenia.co ── landing estática desde /data/landing (volumen agenia_caddy_data)
     └─ www.agenia.co ── redirige a agenia.co
   agenia_web    agenia-web:latest   Next.js 16, Node 22, uid 1000, cap_drop ALL
   agenia_api    agenia-api:latest   NestJS 11, Node 22, uid 1000, cap_drop ALL, tareas programadas
   agenia_db     postgres:15-alpine  solo 127.0.0.1:49317 (túnel SSH); base «antigravity», rol «agenia»
   agenia_redis  redis:7-alpine      sin puertos; AOF + RDB
   (migrator)    agenia-api:latest   efímero: migraciones y DDL
```

El **agente del hospital** (`agenia-mirror-agent`) **no** vive en el VPS: corre en una máquina de la red del hospital (`192.168.1.175`) y solo abre conexiones **salientes** HTTPS a `https://app.hsvpanserma.agenia.co/api` con su token. No hay que tocarlo si el dominio no cambia.

### 3.2 Rutas y archivos en el servidor

| Ruta | Qué es | Origen en el rescate |
|---|---|---|
| `/opt/agenia` | Código (llega por rsync, **sin `.git`**) | Fase 4, desde la laptop |
| `/opt/agenia/.env.production` | Todos los secretos y la configuración (root, 600) | Copia (fases 5 y 7) |
| `/opt/agenia/deploy/Caddyfile` | El proxy **real** (con estadísticas, landing y padrón) | Copia (fase 11) |
| `/opt/agenia/deploy/install.conf` | Respuestas del instalador (modo, dominio, correo) | Copia (fase 5) |
| `/opt/agenia/deploy/secrets/` | JSON de Google TTS (hoy vacío), uid 1000 | Copia (fase 5) |
| `/var/lib/agenia/alertas/` | Configuración del vigía (`telegram.env`) y su estado, uid 1000 | Copia (fase 12) |
| `/var/backups/agenia/` | Respaldos del servidor (root, 700): `agenia-*.sql.gz` diario 03:30, 14 días | Lo crea el instalador |
| `/etc/cron.d/agenia-backup` · `agenia-vigia` · `agenia-landing-pulso` | Respaldo diario, vigía cada minuto, pulso de la landing 06:00 | Instalador y `landing/deploy/desplegar.sh` |
| `/etc/logrotate.d/agenia-vigia` | Rotación del log del vigía | Instalador |
| `/etc/ssh/sshd_config.d/00-agenia-hardening.conf` | SSH solo con llave | Copia (fase 16) |
| `/etc/fail2ban/jail.local` | fail2ban para SSH | Copia (fase 16) |
| `/usr/local/bin/agenia` | Enlace a `/opt/agenia/deploy/agenia.sh` | Instalador |
| Volúmenes `agenia_postgres_data` · `agenia_redis_data` · `agenia_caddy_data` · `agenia_caddy_config` | Base, Redis, certificados + landing, configuración de Caddy | Los crea compose; se llenan en fases 8, 10 y 11 |

### 3.3 Lo que depende del dominio (no cambia si el dominio sigue igual)

| Quién | Apunta a | Si cambia la IP | Si cambia el dominio |
|---|---|---|---|
| Meta (webhook de WhatsApp) | `https://app.hsvpanserma.agenia.co/api/chatbot/webhook` | Nada | Anexo B |
| Telegram (pacientes y asistente de soporte) | `…/api/telegram/webhook/<clave>` y `…/api/support-bot/webhook/<clave>` | Nada | Anexo B |
| Agente del hospital | `MIRROR_API_URL=https://app.hsvpanserma.agenia.co/api` | Nada (sale por 443 a cualquier IP) | Anexo B |
| Bot de alertas técnicas | Solo **sale** hacia `api.telegram.org` | Nada | Nada |
| Personal del hospital | `https://app.hsvpanserma.agenia.co/login` | Nada | Avisarles |

---

## 4. La copia de seguridad

### 4.1 Qué trae (`respaldos/<AAAAMMDD-HHMMSS>/`)

| Archivo | Contenido |
|---|---|
| `db.dump` | La base completa: `pg_dump -Fc` (instantánea consistente, restaurable en paralelo) |
| `roles.sql` | Roles de Postgres (`pg_dumpall --roles-only`; hoy solo `agenia`) |
| `bd.env` | `POSTGRES_USER` y `POSTGRES_DB` (sin clave). **Hoy la base se llama `antigravity`**: nunca se renombró en producción |
| `redis.rdb` | Foto de Redis (sesiones del asistente, colas, pendientes: estado de corta vida) |
| `config.tar.gz` | Con las rutas del servidor: `opt/agenia/.env.production`, `opt/agenia/deploy/{Caddyfile,install.conf,secrets/}`, `var/lib/agenia/alertas/`, `etc/ssh/sshd_config.d/`, `etc/fail2ban/jail.local`, `etc/cron.d/agenia-*`, `etc/logrotate.d/agenia-*`, `root/.ssh/authorized_keys`, `home/agenia/.ssh/authorized_keys` |
| `caddy-data.tar.gz` | Volumen `agenia_caddy_data`: certificados TLS de los 4 dominios, cuentas ACME y la landing (`landing/`) |
| `MANIFIESTO.txt` | Versión desplegada (`AGENIA_VERSION=<commit>@<fecha>`), contenedores, imágenes, tamaño de la base, tablas, disparadores, funciones, extensiones, roles, número de migraciones y la última, claves del `.env.production`, sitios del Caddyfile, cortafuegos |
| `CONTEOS.tsv` | Filas por tabla, disparadores y funciones de la copia **ya restaurada** (solo si la copia se probó) |
| `conteos.sql` | La consulta que produce `CONTEOS.tsv` |
| `SHA256SUMS` | Huellas de todo lo anterior |

### 4.2 Si la copia está cifrada

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in respaldos/<fecha>.tar.gz.enc | tar -xzf - -C respaldos/
# pide la frase; deja respaldos/<fecha>/ en claro. Luego: ln -sfn <fecha> respaldos/ultimo
```

(Sin terminal interactiva: `AGENIA_RESPALDO_FRASE='…' openssl enc -d … -pass env:AGENIA_RESPALDO_FRASE …`. La frase la da la persona; la IA no la escribe en ningún archivo.)

---

## 5. Procedimiento

### Fase 0 · Entorno de trabajo en la laptop 🤖

```bash
NUEVA_IP='203.0.113.10'          # ← la IP que dio la persona
mkdir -p respaldos/rescate && chmod 700 respaldos/rescate
COPIA_REAL="$(cd respaldos/ultimo && pwd -P)"
cat > respaldos/rescate/entorno.sh <<EOF
# Atajos del rescate (docs/emergencia/RESCATE_VPS.md). Se carga al inicio de CADA comando.
NUEVA_IP='$NUEVA_IP'
VIEJA_IP='89.117.61.28'
DOMINIO='app.hsvpanserma.agenia.co'
CORREO_ACME='agendamientoia.app@gmail.com'
COPIA='$COPIA_REAL'
LLAVE="\$HOME/.ssh/agenia_\${NUEVA_IP//./_}_ed25519"
LLAVE_VIEJA="\$HOME/.ssh/agenia_\${VIEJA_IP//./_}_ed25519"
SSHO=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=20 -o StrictHostKeyChecking=accept-new)
vps()   { ssh -i "\$LLAVE" "\${SSHO[@]}" "root@\$NUEVA_IP" "\$@"; }
vieja() { ssh -i "\$LLAVE_VIEJA" "\${SSHO[@]}" "root@\$VIEJA_IP" "\$@"; }
EOF
source respaldos/rescate/entorno.sh && echo "IP=$NUEVA_IP COPIA=$COPIA LLAVE=$LLAVE"
```

✅ Imprime la IP, la ruta absoluta de la copia y la llave. `respaldos/` está fuera de git (`.gitignore`), de las imágenes (`.dockerignore`) y del rsync al servidor.

Si `respaldos/ultimo` apunta a un `.tar.gz.enc`, primero §4.2.

### Fase 1 · Comprobar la copia y elegir el código 🤖

```bash
source respaldos/rescate/entorno.sh
./respaldo.sh --verificar "$COPIA"          # huellas + restauración de prueba si Docker está encendido
grep -E '^(Fecha|AGENIA_VERSION)|^(POSTGRES_|tablas|disparadores|funciones|migraciones|última migración)' "$COPIA/MANIFIESTO.txt"
ls packages/database/prisma/migrations | sort | tail -1
git status --short | head; git log -1 --format='%h %cd %s' --date=iso
```

✅ Debe cumplirse todo:

1. «Huellas SHA-256 correctas». Si además salió «Copia sana», la restauración ya se probó. Si dice que Docker no está corriendo, se sigue (las huellas bastan) y se anota en el informe.
2. **El código que se va a desplegar no es más viejo que la copia**: el nombre de la última carpeta de `packages/database/prisma/migrations` debe ser **igual o posterior** a `última migración` del manifiesto. Lo normal es desplegar `main` al día. Si `AGENIA_VERSION` es un commit sin `+cambios`, ese commit (o uno posterior) es seguro; con `+cambios` se desplegó código sin commit: usar `main` y anotarlo.
3. `git status` limpio, o con cambios que la persona sabe que van.

⛔ Si la carpeta de migraciones del repo es **anterior** a la de la copia: parar. El código no conoce tablas que la base sí tiene.

### Fase 2 · El servidor viejo 🤖 ⛔

**Si el viejo no responde** (`vieja true` falla): anotar «servidor viejo caído» y pasar a la fase 3. ⛔ Preguntar a la persona si lo puede apagar desde el panel de Contabo; si vuelve a encenderse solo más tarde, rompería R1. Pedir que lo detenga o lo cancele.

**Si el viejo responde** (migración planificada o falla parcial): ⛔ confirmar con la persona que **se apaga ahora** (desde aquí el sistema queda fuera de servicio hasta la fase 14). Luego, en este orden:

```bash
source respaldos/rescate/entorno.sh
# 1. Que el vigía no alarme al grupo técnico y no vuelva a mirar este servidor
vieja 'agenia mantenimiento 240 && mv /etc/cron.d/agenia-vigia /var/backups/agenia/agenia-vigia.cron.apagado'
# 2. Detener API y web (ya no se escribe nada ni se manda ningún mensaje) y que no vuelvan al reiniciar
vieja 'cd /opt/agenia && docker compose --env-file .env.production -f docker-compose.deploy.yml stop api web && docker update --restart=no agenia_api agenia_web'
# 3. La copia más fresca posible: con la API quieta, NO se pierde nada
./respaldo.sh --host "$VIEJA_IP"
# 4. El resto, y que nada vuelva solo
vieja 'cd /opt/agenia && docker compose --env-file .env.production -f docker-compose.deploy.yml stop caddy redis postgres && docker update --restart=no agenia_proxy agenia_redis agenia_db'
```

Después del paso 3, volver a la fase 0 para que `COPIA` apunte a **esta** copia nueva (`respaldos/ultimo`), y repetir la fase 1.

✅ `vieja 'docker ps --format "{{.Names}} {{.Status}}"'` no muestra ningún `agenia_*` en `Up`. La copia nueva existe y «Huellas SHA-256 correctas».

### Fase 3 · Acceso y diagnóstico del VPS nuevo 🤖 (🧑 si no hay llave)

```bash
source respaldos/rescate/entorno.sh
ls -l "$LLAVE" "$LLAVE.pub" 2>/dev/null || ssh-keygen -t ed25519 -N '' -C "agenia-rescate" -f "$LLAVE"
vps true && echo "ACCESO OK"
```

Si `vps true` falla con `Permission denied`: ⛔ la persona pone la llave **una vez** (escribe la contraseña de root que le dio Contabo):

```bash
ssh-copy-id -i ~/.ssh/agenia_<IP_con_guiones_bajos>_ed25519.pub root@<IP>
```

(o la pega en el panel de Contabo al reinstalar el VPS). Si sale `REMOTE HOST IDENTIFICATION HAS CHANGED`: ⛔ solo si la persona confirma que **ese VPS se reinstaló** (misma IP, sistema nuevo), `ssh-keygen -R <IP>` y repetir. Si no lo confirma, puede ser un ataque: parar.

Diagnóstico (solo lectura):

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
. /etc/os-release; echo "SO: $PRETTY_NAME ($VERSION_CODENAME) $(dpkg --print-architecture)"
echo "CPU: $(nproc) · RAM: $(free -h | awk 'NR==2 {print $2}') · libre en /: $(df -h / | awk 'NR==2 {print $4}')"
echo "Zona: $(timedatectl show -p Timezone --value 2>/dev/null)"
echo "Puertos 80/443 ocupados por:"; ss -ltnp '( sport = :80 or sport = :443 )' | tail -n +2
command -v docker >/dev/null && docker ps -a --format '{{.Names}} {{.Status}}' | head
[ -e /opt/agenia ] && echo "⚠️ YA EXISTE /opt/agenia" || echo "sin /opt/agenia"
getent hosts deb.debian.org archive.ubuntu.com | head -1 || echo "⚠️ sin DNS"
EOF
```

✅ Ubuntu 22.04/24.04 o Debian 11/12/13; ≥ 2 vCPU, ≥ 4 GB RAM (con menos de 8 GB el instalador crea 4 GB de swap), ≥ 30 GB libres; nada en 80/443; resuelve nombres.

⛔ Parar si: ya existe `/opt/agenia` o hay contenedores `agenia_*` (¿es el servidor correcto?), otra distribución, o algo ocupa 80/443 (`systemctl disable --now nginx apache2`, solo con permiso).

### Fase 4 · Subir el código y la copia 🤖 🔁

```bash
source respaldos/rescate/entorno.sh
vps 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq rsync >/dev/null && install -d -m 755 /opt/agenia && install -d -m 700 /var/backups/agenia /var/backups/agenia/rescate'
# El código: mismas exclusiones que deploy/update-vps.sh (nunca secretos, notas locales ni copias)
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude dist --exclude .turbo --exclude coverage \
  --exclude '*.log' --exclude .DS_Store --exclude .git \
  --include .env.example --exclude .env --exclude '.env.*' \
  --exclude deploy/secrets --exclude deploy/install.conf --exclude deploy/Caddyfile \
  --exclude .claude --exclude reports --exclude research_notes --exclude '/homologar-plan-*.txt' --exclude tunnel.sh \
  --exclude /respaldos --exclude /respaldo.sh \
  -e "ssh -i $LLAVE -o BatchMode=yes" ./ "root@$NUEVA_IP:/opt/agenia/"
# La copia, fuera de /opt/agenia (R5)
rsync -a -e "ssh -i $LLAVE -o BatchMode=yes" "$COPIA/" "root@$NUEVA_IP:/var/backups/agenia/rescate/"
vps 'cd /var/backups/agenia/rescate && chmod 600 ./* && sha256sum -c SHA256SUMS'
vps 'ls /opt/agenia/docker-compose.deploy.yml /opt/agenia/deploy/install-vps.sh && test ! -e /opt/agenia/respaldos && test ! -e /opt/agenia/.git && echo CODIGO-OK'
```

✅ Todas las líneas de `sha256sum -c` en `OK` y `CODIGO-OK`.

### Fase 5 · Configuración ANTES de instalar 🤖 🔁

El `.env.production` de la copia va **antes** del instalador: así el instalador conserva los secretos, el volumen de Postgres nace con **la misma clave** y la base con **el mismo nombre** (`antigravity`). Si se instalara primero, Postgres quedaría con una clave y un nombre nuevos (catálogo §6, «password authentication failed» y «database does not exist»).

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
R=/var/backups/agenia/rescate
rm -rf "$R/config"; mkdir -m 700 "$R/config"
tar -xzpf "$R/config.tar.gz" -C "$R/config"
C="$R/config/opt/agenia"
install -m 600 -o root -g root "$C/.env.production" /opt/agenia/.env.production
install -d -m 755 /opt/agenia/deploy
install -m 600 -o root -g root "$C/deploy/install.conf" /opt/agenia/deploy/install.conf
install -d -m 700 /opt/agenia/deploy/secrets
cp -a "$C/deploy/secrets/." /opt/agenia/deploy/secrets/
chown -R 1000:1000 /opt/agenia/deploy/secrets
grep -E '^(POSTGRES_USER|POSTGRES_DB|PUBLIC_WEB_URL|PUBLIC_API_URL)=' /opt/agenia/.env.production
grep -E '^ENCRYPTION_KEY=[0-9a-fA-F]{64}$' /opt/agenia/.env.production >/dev/null && echo "ENCRYPTION_KEY: 64 hex, presente"
EOF
```

✅ `POSTGRES_USER=agenia`, `POSTGRES_DB=antigravity` (o lo que diga `bd.env`), `PUBLIC_WEB_URL=https://app.hsvpanserma.agenia.co`, `PUBLIC_API_URL=https://app.hsvpanserma.agenia.co/api` y «ENCRYPTION_KEY: 64 hex, presente». Solo se imprimen esas claves: R4.

### Fase 6 · Instalar 🤖 (10–25 min)

`deploy/install-vps.sh` hace, sin preguntar (`-y`): paquetes base, zona `America/Bogota`, swap si hace falta, Docker oficial, Caddyfile, imágenes, Postgres + Redis, esquema (`db push` + sellado del historial + DDL propio), arranque, UFW, comando `agenia`, cron del respaldo y del vigía, y una verificación. Detecta el `.env.production` de la fase 5 («Configuración previa detectada: se conservan secretos y dominios»).

Se lanza en segundo plano en el servidor: la compilación es larga y una sesión SSH cortada no debe matarla.

```bash
source respaldos/rescate/entorno.sh
vps "cd /opt/agenia && nohup bash deploy/install-vps.sh -y --dir /opt/agenia --single-domain '$DOMINIO' --email '$CORREO_ACME' --skip-dns-check > /var/log/agenia-rescate-install.log 2>&1 < /dev/null & echo lanzado"
```

Cada 1–2 minutos (sin bloquear la terminal):

```bash
source respaldos/rescate/entorno.sh
vps 'tail -n 8 /var/log/agenia-rescate-install.log; grep -E "Instalación (completada|abortada)" /var/log/agenia-rescate-install.log || echo "…sigue"'
```

✅ Termina con «Instalación completada». En la verificación final **es esperado** que fallen solo las comprobaciones públicas («Panel … → HTTP 000», «Webhook … → HTTP 000» u otro código del servidor viejo) porque el DNS aún no apunta aquí; **todo lo demás en verde**: los 5 contenedores, Redis PONG, PostgreSQL, «Esquema aplicado (N tablas)», API en 3000, web → API, Postgres y Redis no expuestos.

Si dice «Instalación abortada»: leer el error (`vps 'tail -n 60 /var/log/agenia-install.log'`), buscarlo en §6, corregir y relanzar el mismo comando (🔁: el instalador es idempotente).

### Fase 7 · El `.env.production` exacto 🤖

El instalador **reescribe** `.env.production` desde su plantilla: conserva los secretos, pero **pierde** las claves que se agregaron a mano después (hoy `TELEGRAM_ENABLED` y `SUPPORT_BOT_ENABLED`) y pisa valores ajustados. Se vuelve a poner el de la copia, idéntico:

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
R=/var/backups/agenia/rescate
G="/var/backups/agenia/env.production.generado-$(date +%Y%m%d-%H%M%S)"
cp -a /opt/agenia/.env.production "$G"
install -m 600 -o root -g root "$R/config/opt/agenia/.env.production" /opt/agenia/.env.production
echo "Claves que el instalador había perdido:"
comm -13 <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*' "$G" | sort -u) <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*' /opt/agenia/.env.production | sort -u)
cmp "$R/config/opt/agenia/.env.production" /opt/agenia/.env.production && echo "ENV-IDENTICO"
EOF
```

✅ `ENV-IDENTICO`. Los contenedores lo toman al **recrearlos** en la fase 13 (`agenia restart` no relee el `.env`).

### Fase 8 · Restaurar la base 🤖

La base que dejó el instalador está vacía (solo el esquema). Se borra y se crea limpia, y se restaura la copia en ella; así no hay choques entre el esquema del instalador y el de la copia.

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
R=/var/backups/agenia/rescate
dc() { docker compose --env-file /opt/agenia/.env.production -f /opt/agenia/docker-compose.deploy.yml "$@"; }
. "$R/bd.env"                                    # POSTGRES_USER y POSTGRES_DB de la copia
agenia mantenimiento 120
dc stop api web
# ⛔ Guarda (R11): solo se borra una base SIN organizaciones (la vacía del instalador).
ORGS=$(docker exec agenia_db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -XtAc 'SELECT count(*) FROM "Organization"')
[ "$ORGS" = 0 ] || { echo "⛔ Esta base YA tiene $ORGS organización(es): no se borra. ¿Es el servidor correcto?"; exit 1; }
EN_CONTENEDOR=$(docker exec agenia_db sh -c 'echo "$POSTGRES_USER $POSTGRES_DB"')
[ "$EN_CONTENEDOR" = "$POSTGRES_USER $POSTGRES_DB" ] || { echo "⛔ Contenedor: '$EN_CONTENEDOR'; copia: '$POSTGRES_USER $POSTGRES_DB'. Revisar la fase 5."; exit 1; }
docker exec agenia_db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -Xq \
  -c "DROP DATABASE \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""
docker cp "$R/db.dump" agenia_db:/tmp/db.dump
time docker exec agenia_db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error --no-owner -j 4 /tmp/db.dump
docker exec agenia_db rm -f /tmp/db.dump
echo "BASE-RESTAURADA"
EOF
```

✅ `BASE-RESTAURADA` sin errores de `pg_restore` (tarda menos de un minuto con ~300 MB).

Roles: el manifiesto lista los roles (`rol | …`). Hoy solo existe `agenia`, que ya lo crea la imagen. Si aparece otro (por ejemplo, el rol sin superusuario de `docs/SEGURIDAD.md` §3.4), **antes** del `pg_restore`: `docker exec -i agenia_db psql -U agenia -d postgres < /var/backups/agenia/rescate/roles.sql` (el error «role "agenia" already exists» es esperado).

### Fase 9 · Comprobar la base y migrar 🤖

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
R=/var/backups/agenia/rescate
. "$R/bd.env"
TAB=$(printf '\t')
docker exec -i agenia_db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -XqtA -F "$TAB" \
  < "$R/conteos.sql" > "$R/conteos-restaurados.tsv"
if [ -f "$R/CONTEOS.tsv" ]; then
  diff "$R/CONTEOS.tsv" "$R/conteos-restaurados.tsv" && echo "CONTEOS-IDENTICOS"
else
  echo "La copia no trae CONTEOS.tsv (no se probó con Docker). Comparar con el manifiesto:"
  grep -E '^(tablas|disparadores|funciones|migraciones aplicadas) ' "$R/MANIFIESTO.txt"
  echo "restaurado: $(grep -vc '^#' "$R/conteos-restaurados.tsv") tablas"; grep '^#' "$R/conteos-restaurados.tsv"
  grep -E "^(Organization|User|Appointment|_prisma_migrations)$TAB" "$R/conteos-restaurados.tsv"
fi
# Migraciones pendientes (si el código es más nuevo que la copia) + el DDL propio (disparadores)
agenia migrate
agenia migrate-status 2>&1 | tail -3
# Los disparadores, DESPUÉS de migrar: al menos los del manifiesto
docker exec -i agenia_db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -XqtA -F "$TAB" < "$R/conteos.sql" | grep '^#'
grep -E '^(disparadores|funciones) ' "$R/MANIFIESTO.txt"
EOF
```

✅ `CONTEOS-IDENTICOS` (o, sin `CONTEOS.tsv`: mismas tablas, disparadores y funciones que el manifiesto, y `Organization`, `User`, `Appointment` con filas). `agenia migrate` termina en «Migraciones al día» y `migrate-status` en «Database schema is up to date!»; si el código es más nuevo que la copia, aquí se aplican sus migraciones pendientes (es lo esperado). Al final, `#disparadores` y `#funciones` **iguales o mayores** que en el manifiesto (hoy 5 y 39): sin los disparadores el espejo con el hospital deja de capturar cambios **sin avisar** (§6.2).

### Fase 10 · Redis (solo si la copia es fresca) 🤖

- Copia tomada en la **fase 2** (servidor viejo con la API ya detenida): **restaurar** Redis, para no perder conversaciones a medias ni pendientes.
- Copia de horas o días atrás: **no** restaurar. Redis arranca vacío; lo permanente está en PostgreSQL. Las conversaciones en curso empiezan de nuevo.

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
R=/var/backups/agenia/rescate
[ -s "$R/redis.rdb" ] || { echo "La copia no trae redis.rdb: se omite."; exit 0; }
dc() { docker compose --env-file /opt/agenia/.env.production -f /opt/agenia/docker-compose.deploy.yml "$@"; }
dc stop redis
VOL=$(docker volume inspect -f '{{.Mountpoint}}' agenia_redis_data)
case "$VOL" in /var/lib/docker/volumes/agenia_redis_data/_data) ;; *) echo "⛔ ruta inesperada: $VOL"; exit 1 ;; esac
rm -rf "$VOL/appendonlydir" "$VOL/dump.rdb"
install -m 600 "$R/redis.rdb" "$VOL/dump.rdb"
# Redis con AOF encendido NO lee dump.rdb al arrancar: se carga con AOF apagado y se
# enciende en caliente (CONFIG SET), que reescribe el AOF desde la memoria.
docker run -d --rm --name agenia-redis-carga -v agenia_redis_data:/data redis:7-alpine redis-server --appendonly no >/dev/null
for i in $(seq 1 30); do docker exec agenia-redis-carga redis-cli ping 2>/dev/null | grep PONG >/dev/null && break; sleep 1; done
echo "claves cargadas: $(docker exec agenia-redis-carga redis-cli DBSIZE)"
docker exec agenia-redis-carga redis-cli CONFIG SET appendonly yes
for i in $(seq 1 60); do
  P=$(docker exec agenia-redis-carga redis-cli INFO persistence)
  echo "$P" | grep '^aof_rewrite_in_progress:0' >/dev/null && echo "$P" | grep '^aof_rewrite_scheduled:0' >/dev/null && break
  sleep 1
done
docker exec agenia-redis-carga redis-cli INFO persistence | grep -E '^(aof_enabled|aof_last_bgrewrite_status)'
docker stop agenia-redis-carga >/dev/null
dc up -d redis
sleep 5; docker exec agenia_redis redis-cli DBSIZE
EOF
```

✅ `aof_enabled:1`, `aof_last_bgrewrite_status:ok` y el `DBSIZE` final igual a «claves cargadas» (si `.env.production` trae `REDIS_PASSWORD`, los `redis-cli` de `agenia_redis` llevan `-a "$REDIS_PASSWORD" --no-auth-warning`).

### Fase 11 · Caddy: certificados, landing y el Caddyfile real 🤖

El instalador generó un Caddyfile de plantilla; el real (copia) trae además el sitio de estadísticas, la landing y sus ajustes. Con los certificados de la copia, el HTTPS funciona **en cuanto el DNS apunte aquí**, sin esperar a Let's Encrypt.

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
R=/var/backups/agenia/rescate
NUEVO="$R/config/opt/agenia/deploy/Caddyfile"
dc() { docker compose --env-file /opt/agenia/.env.production -f /opt/agenia/docker-compose.deploy.yml "$@"; }
[ -s "$NUEVO" ] || { echo "⛔ El Caddyfile de la copia está vacío"; exit 1; }
# 1. Validar ANTES de tocar nada, con la misma imagen que lo sirve
docker run --rm -v "$NUEVO:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
# 2. Certificados y landing, con Caddy detenido
dc stop caddy
VOL=$(docker volume inspect -f '{{.Mountpoint}}' agenia_caddy_data)
case "$VOL" in /var/lib/docker/volumes/agenia_caddy_data/_data) ;; *) echo "⛔ ruta inesperada: $VOL"; exit 1 ;; esac
tar -xzpf "$R/caddy-data.tar.gz" -C "$VOL"
# 3. El Caddyfile real SIN cambiar el inodo (el contenedor monta el archivo suelto: cp o mv no se verían)
cp -a /opt/agenia/deploy/Caddyfile "/var/backups/agenia/Caddyfile.generado-$(date +%Y%m%d-%H%M%S)"
cat "$NUEVO" > /opt/agenia/deploy/Caddyfile
cmp "$NUEVO" /opt/agenia/deploy/Caddyfile
dc up -d caddy
sleep 3
docker exec agenia_proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
ls "$VOL/caddy/certificates/"*/
EOF
for h in "$DOMINIO" estadisticas.hsvpanserma.agenia.co agenia.co www.agenia.co; do
  printf '%-38s ' "$h"
  echo | openssl s_client -connect "$NUEVA_IP:443" -servername "$h" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || echo "SIN CERTIFICADO"
done
```

✅ `caddy validate` dice «Valid configuration»; aparecen las 4 carpetas de certificados; cada dominio muestra `notAfter=` con fecha futura.

Si un certificado está **vencido o por vencer** (la copia es vieja), no pasa nada: Caddy lo renueva solo cuando el DNS apunte aquí. Si `caddy validate` falla, **no** se toca el Caddyfile: se lee el error y se corrige la copia del archivo (§6).

### Fase 12 · Vigía, cron y landing 🤖

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
R=/var/backups/agenia/rescate/config
install -d -m 700 -o 1000 -g 1000 /var/lib/agenia/alertas
cp -a "$R/var/lib/agenia/alertas/." /var/lib/agenia/alertas/
rm -f /var/lib/agenia/alertas/vigia.lock
chown -R 1000:1000 /var/lib/agenia/alertas
ls -l /etc/cron.d/agenia-backup /etc/cron.d/agenia-vigia
EOF
bash landing/deploy/desplegar.sh --host "root@$NUEVA_IP" --ssh-key "$LLAVE"
```

✅ Existen los dos cron; `desplegar.sh` termina en «Listo.» y deja `/etc/cron.d/agenia-landing-pulso` (6:00 a. m. de Colombia). `/var/lib/agenia/alertas` es del **uid 1000** (la API corre como `node`, uid 1000: con otro dueño escribe `EACCES` y el vigía queda sin configuración).

### Fase 13 · Arrancar y verificar ANTES del DNS 🤖

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
agenia up --force-recreate api web          # recrea: toma el .env.production de la fase 7
for s in agenia_api agenia_web; do
  for i in $(seq 1 90); do
    st=$(docker inspect -f '{{.State.Health.Status}}' "$s" 2>/dev/null || echo starting)
    [ "$st" = healthy ] && break; sleep 2
  done; echo "$s: $st"
done
docker logs agenia_api --since 3m 2>&1 | grep -iE "redis|decrypt|unsupported state|error" | tail -15 || true
docker exec agenia_api id -u
agenia superadmin listar
EOF
```

✅ `agenia_api: healthy`, `agenia_web: healthy`, un «Conectado a Redis», **ningún** error de descifrado (`bad decrypt`, `Unsupported state or unable to authenticate data`: sería una `ENCRYPTION_KEY` que no es la de la base → R3, volver a la fase 7), `id -u` = `1000`, y `superadmin listar` muestra los super administradores de siempre (vienen en la base).

Ahora la cadena completa desde la laptop, **forzando** la IP nueva (el DNS todavía apunta al viejo):

```bash
source respaldos/rescate/entorno.sh
# c <host> <ruta> [argumentos extra de curl]  — `shift 2` + "$@": funciona igual en zsh y bash
c() { local h="$1" p="$2"; shift 2
      printf '%-62s %s\n' "$h$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 --resolve "$h:443:$NUEVA_IP" "$@" "https://$h$p")"; }
c "$DOMINIO" /login
c "$DOMINIO" '/api/chatbot/webhook?hub.mode=subscribe&hub.verify_token=agenia-verify-probe&hub.challenge=1'
c "$DOMINIO" /api/telegram/webhook/agenia-verify-probe -X POST -H 'Content-Type: application/json' -d '{}'
c "$DOMINIO" /api/support-bot/webhook/agenia-verify-probe -X POST -H 'Content-Type: application/json' -d '{}'
c "$DOMINIO" /api/mirror/handshake -X POST
c "$DOMINIO" /api/padron/validate -X POST
c "$DOMINIO" /api/system-logs/recent-errors
c estadisticas.hsvpanserma.agenia.co /
c agenia.co /
c www.agenia.co /
```

✅ Debe dar exactamente (medido en producción el 2026-11-17):

| Ruta | Código | Qué prueba |
|---|---|---|
| `/login` | **200** | Proxy → panel → base |
| `/api/chatbot/webhook?…token falso` | **403** | Proxy → API → Postgres (busca el token y lo rechaza). 200 sería grave: aceptó un token falso |
| `POST /api/telegram/webhook/…` | **401** | Webhook de pacientes publicado; exige `secret_token` |
| `POST /api/support-bot/webhook/…` | **401** | Webhook del asistente del personal publicado |
| `POST /api/mirror/handshake` | **401** | Ruta del agente del hospital publicada; exige token |
| `POST /api/padron/validate` | **400** | Llega al panel (404 = falta el bloque `/api/padron/*` en el Caddyfile) |
| `/api/system-logs/recent-errors` | **404** | El resto de la API **no** sale a internet (401/403/200 sería una fuga) |
| `estadisticas…/` | **302** | Redirige a la página de la clínica |
| `agenia.co/` | **200** | Landing |
| `www.agenia.co/` | **301** | Redirige a `agenia.co` |

🧑 Opcional pero recomendado: la persona entra al panel con la IP forzada (`/etc/hosts` en su laptop: `<IP> app.hsvpanserma.agenia.co`, y lo quita después) y ve la Visión General con las citas de siempre.

### Fase 14 · DNS 🧑 ⛔ y verificación pública 🤖

Si la IP **no** cambió (se reinstaló el mismo VPS), saltar a la verificación.

⛔ La persona cambia en **Hostinger** (zona `agenia.co`) estos registros **A** a `<IP>`:

| Nombre | Sirve |
|---|---|
| `app.hsvpanserma` | Panel, API, webhooks, agente del hospital |
| `estadisticas.hsvpanserma` | Estadísticas para compartir |
| `@` (`agenia.co`) | Landing |
| `www` | Redirección de la landing |

La IA espera la propagación (cada 1–2 min):

```bash
source respaldos/rescate/entorno.sh
for h in "$DOMINIO" estadisticas.hsvpanserma.agenia.co agenia.co www.agenia.co; do
  printf '%-38s 1.1.1.1=%s  8.8.8.8=%s\n' "$h" "$(dig +short A "$h" @1.1.1.1 | tail -1)" "$(dig +short A "$h" @8.8.8.8 | tail -1)"
done
```

Cuando los 4 den `<IP>` en ambos:

```bash
source respaldos/rescate/entorno.sh
vps 'agenia verify'
```

✅ «Todo correcto.» (panel, webhook 403, Telegram 401, configuración de Telegram no expuesta, API interna 404, Postgres y Redis no expuestos). Si un certificado no estaba en la copia o estaba vencido, Caddy lo pide ahora (puede tardar 1–2 min; `vps 'docker logs agenia_proxy --since 5m 2>&1 | tail -20'`; si no lo intenta, `vps 'docker exec agenia_proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force'`).

### Fase 15 · Servicios externos 🤖 (🧑 TI si hace falta)

**Agente del hospital** y **WhatsApp**. Con el DNS nuevo, el agente reconecta solo (sus reintentos son de segundos a minutos). Para WhatsApp no se cambia nada (el webhook es por dominio): la persona escribe «hola» al número del hospital y debe recibir respuesta. Luego:

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
docker exec -i agenia_db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -XqtA -F " | "' <<'SQL'
SELECT 'ahora (Bogotá)', to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI');
SELECT 'latido del agente', to_char(("lastHeartbeatAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') FROM "HospitalMirrorConfig";
SELECT 'mensajes de WhatsApp, últimos 15 min', count(*) FROM "WhatsappMessageLog" WHERE "createdAt" > (now() AT TIME ZONE 'UTC') - interval '15 minutes';
SQL
EOF
```

✅ El latido es de hace menos de 5 minutos y hay mensajes recientes de WhatsApp. Si a los **15 minutos** del cambio de DNS el latido sigue viejo: ⛔ la persona le pide a TI del hospital `sudo systemctl restart agenia-mirror-agent` en `192.168.1.175` (fuerza además una reconciliación a los 2 minutos). Nunca pedir que borren `/opt/agenia-mirror-agent/data/state.json`.

Meta y Telegram reintentan por un tiempo lo que no pudieron entregar durante la caída; algunos mensajes viejos pueden llegar de golpe.

**Telegram** (pacientes y asistente de soporte): en `/super-admin/monitor` los dos en verde (el monitor corre cada 5 min). **Alertas técnicas**: `vps 'agenia vigia prueba'` → llega el mensaje de prueba al grupo del equipo técnico; `vps 'agenia vigia estado'`.

**Monitor de servicios**: `/super-admin/monitor` sin incidentes nuevos tras 10 minutos.

### Fase 16 · Endurecer el servidor 🤖

Mantener abierta una sesión SSH que ya funcione mientras se cambia SSH; probar una conexión **nueva** antes de cerrar nada.

```bash
source respaldos/rescate/entorno.sh
vps 'bash -s' <<'EOF'
set -euo pipefail
R=/var/backups/agenia/rescate/config
# SSH solo con llave. En sshd GANA EL PRIMER valor leído: el archivo va con 00- para
# adelantarse al 50-cloud-init.conf de la imagen (que puede decir PasswordAuthentication yes).
install -m 644 "$R/etc/ssh/sshd_config.d/00-agenia-hardening.conf" /etc/ssh/sshd_config.d/00-agenia-hardening.conf
sshd -t && systemctl reload ssh
sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
# fail2ban con la configuración de la copia + la IP desde la que se administra ahora
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq fail2ban >/dev/null
install -m 644 "$R/etc/fail2ban/jail.local" /etc/fail2ban/jail.local
MI_IP="${SSH_CLIENT%% *}"          # la IP pública de la laptop, tal como la ve el servidor
awk -v ip="$MI_IP" '/^ignoreip/ { for (i = 3; i <= NF; i++) if ($i == ip) f = 1 } END { exit !f }' /etc/fail2ban/jail.local \
  || sed -i "s|^ignoreip = .*|& $MI_IP|" /etc/fail2ban/jail.local
systemctl enable --now fail2ban >/dev/null 2>&1; fail2ban-client reload >/dev/null
fail2ban-client status sshd | head -4
grep '^ignoreip' /etc/fail2ban/jail.local
# Usuario administrador (no root) con las llaves de siempre
id agenia >/dev/null 2>&1 || useradd -m -s /bin/bash agenia
usermod -aG sudo,docker agenia
install -d -m 700 -o agenia -g agenia /home/agenia/.ssh
[ -f "$R/home/agenia/.ssh/authorized_keys" ] && install -m 600 -o agenia -g agenia "$R/home/agenia/.ssh/authorized_keys" /home/agenia/.ssh/authorized_keys
id agenia
EOF
vps true && echo "SSH-SIGUE-OK"
```

✅ `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin without-password` (equivale a `prohibit-password`), fail2ban con la cárcel `sshd` activa, y `SSH-SIGUE-OK` con una conexión nueva.

Recomendado además (pendientes de `docs/SEGURIDAD.md` §3.1–§3.2, seguros en un servidor nuevo; ⛔ preguntar antes):

```bash
vps 'bash -s' <<'EOF'
set -euo pipefail
printf '%s\n' '# Auditoría 2026-11-07' 'X11Forwarding no' 'MaxAuthTries 3' 'LoginGraceTime 30' 'ClientAliveInterval 300' 'ClientAliveCountMax 2' \
  >> /etc/ssh/sshd_config.d/00-agenia-hardening.conf
sshd -t && systemctl reload ssh
. /etc/os-release
printf 'Unattended-Upgrade::Allowed-Origins { "Docker:%s"; };\n' "$VERSION_CODENAME" > /etc/apt/apt.conf.d/51agenia-docker
EOF
```

`AllowTcpForwarding` se deja en `yes`: el túnel a la base (`tunnel.sh`) lo usa.

### Fase 17 · Respaldos del servidor nuevo 🤖

```bash
source respaldos/rescate/entorno.sh
vps 'agenia backup && cat /etc/cron.d/agenia-backup'
./respaldo.sh --host "$NUEVA_IP"
```

✅ `✔ Backup: /var/backups/agenia/agenia-….sql.gz (~20 M)`, el cron de las 03:30 existe, y la laptop tiene su primera copia del servidor nuevo. Cuando todo esté estable, borrar la carpeta de trabajo del servidor: `vps 'rm -rf /var/backups/agenia/rescate'` (lleva la base y los secretos en claro; R5 dice dónde puede estar, no que se quede para siempre).

### Fase 18 · Cerrar: repositorio, brecha de datos e informe 🤖

**Si la IP cambió**, actualizar el repositorio para que todo apunte al servidor nuevo (y renombrar nada más: la llave ya tiene el nombre que esperan los scripts, `~/.ssh/agenia_<ip>_ed25519`):

```bash
grep -rln '89\.117\.61\.28' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=respaldos .
```

Cambiar la IP en: `update.sh`, `tunnel.sh`, `install.sh`, `landing/deploy/desplegar.sh` (`HOST` y `LLAVE`), `respaldo.sh` (`HOST`), y en los documentos de operación que la nombran (`docs/ALERTAS_TECNICAS.md`, `docs/ASISTENTE_SOPORTE.md`, `docs/INSTALACION_VPS.md` §16, `docs/drivers/cnt-sanvicente-anserma/*.md` y sus `.sh`). Los archivos de evidencia con fecha (`checkHealth-2026….txt`, `evidencia/`) se dejan como están. Si se usa el despliegue por GitHub Actions, el secreto `SERVER_HOST` del repositorio. Luego `./update.sh` debe funcionar contra el servidor nuevo (🔁 es la prueba final del ciclo normal).

Commit con la base de conocimiento al día (regla de `CLAUDE.md`): `docs/conocimiento/AGENIA.md` Parte 2 §12 (dónde corre la clínica) y una línea en la bitácora con la fecha del rescate.

**Brecha de datos.** Si se usó una copia anterior a la caída (servidor viejo muerto), lo ocurrido entre la `Fecha` del manifiesto y la caída **no está** en AgenIA:

- Citas agendadas, canceladas o movidas **por el chat** en esa ventana: si llegaron al hospital, están en el HIS pero no en AgenIA (sin recordatorio ni conversación).
- Citas que el hospital creó en esa ventana: el agente ya las había enviado (su `state.json` las da por vistas) y no las reenvía solo. La reconciliación diaria del agente las cuenta como «DERIVA … N que AgenIA desconoce» en su registro, pero no las repara.
- Mensajes de los pacientes en esa ventana, encuestas, cambios de configuración, cargas del padrón.

⛔ La IA lo reporta con la ventana exacta (`Fecha` del manifiesto → hora de la caída) y la persona decide con el hospital (por ejemplo, pedir el listado de citas del HIS de esos días). Si el servidor viejo se pudo detener en la fase 2, **no hay brecha**.

**El servidor viejo.** No se borra ni se cancela hasta que el nuevo lleve **7 días** estable y con copias verificadas. Después: ⛔ la persona lo cancela en Contabo (sus discos tienen datos de pacientes: pedir el borrado).

**Informe**: anexo E.

---

## 6. Problemas conocidos y su solución

Cada fila salió de un incidente real de este sistema. Antes de improvisar, buscar el síntoma aquí.

### 6.1 Instalación, Docker y compilación

| Síntoma | Causa | Solución |
|---|---|---|
| `Killed` o el build muere sin mensaje | Memoria insuficiente al compilar Next.js | Swap de 4 GB (el instalador la crea si hay menos de ~8 GB; con `--no-swap` no). `free -h` |
| El build falla descargando fuentes | `next/font/google` necesita salida a internet en el build | Comprobar DNS y salida HTTPS del servidor; reintentar |
| `Cannot find module '@agenia/shared'` | Se usó `apps/web/Dockerfile` | Construir siempre con `docker-compose.deploy.yml` (`deploy/Dockerfile.web` compila `database` y `shared` antes) |
| `agenia migrate` dice que no encuentra la imagen | `agenia-api:latest` no existe todavía | `agenia build` y repetir |
| La imagen arranca con módulos nativos inválidos | `node_modules` de macOS dentro de la imagen | Lo evita `.dockerignore`; nunca copiar `node_modules` al servidor (el rsync los excluye) |
| Disco lleno tras varios despliegues | Caché de compilación de Docker: 65 GB el 2026-09-25, 51 GB en un día el 2026-10-17 | `docker builder prune -f --max-used-space 10gb` (Docker ≥ 27; si no, `--filter until=72h`). `update-vps.sh` ya lo hace. La primera limpieza grande tarda más de 10 min y la sesión SSH parece colgada: correrla en segundo plano y no imprimir la lista (solo `tail -n 1`) |
| Contenedor `api` nunca pasa a `healthy` | Healthcheck HTTP contra `GET /`, que da 404 a propósito | Ya es TCP; reconstruir si la imagen es vieja |
| `EACCES` en `/app/alertas` o en `deploy/secrets` | Desde la auditoría del 2026-11-07 la API y la web corren como `node` (uid 1000) | `chown -R 1000:1000 /var/lib/agenia/alertas /opt/agenia/deploy/secrets` y `agenia up -d` |
| Next avisa `EACCES` leyendo `apps/web/.env` | Un `.env` viejo dentro de la imagen | `.dockerignore` excluye todo `.env` desde el 2026-11-08; el instalador todavía escribe `apps/web/.env` y `packages/database/.env` (inofensivos, `docs/SEGURIDAD.md` §3.6) |
| `docker compose` avisa de un volumen «not created by Docker Compose» | Se creó a mano un volumen `agenia_*` | Inofensivo; este procedimiento no crea volúmenes a mano |

### 6.2 Base de datos y Prisma

| Síntoma | Causa | Solución |
|---|---|---|
| `relation "Organization" does not exist` / P3018 al migrar una base vacía | El historial de migraciones **no** construye una base vacía (el modelo multi-tenant nació con `db push`) | Nunca `prisma migrate deploy` sobre una base vacía: `agenia migrate` hace `db push` + sellado + DDL. En el rescate la base llega por `pg_restore` con su historial |
| El espejo con el hospital deja de capturar cambios, sin ningún error | Faltan los disparadores de `packages/database/prisma/sql/non-prisma-ddl.sql` (ni `db push` ni el sellado los crean) | `agenia migrate` los aplica siempre (`db:apply-sql`, idempotente). Comprobar que los disparadores del manifiesto siguen (fase 9) |
| `password authentication failed for user "agenia"` | El volumen de Postgres nació con otra clave: la imagen la fija **solo** la primera vez | Poner el `.env.production` de la copia **antes** de instalar (fase 5). Si ya pasó y la base está vacía: `docker exec agenia_db psql -U agenia -d postgres -c "ALTER USER agenia PASSWORD '<la del .env>'"` desde dentro del contenedor (conexión local sin clave) |
| `database "agenia" does not exist` | La base de producción se llama **`antigravity`** (se renombró en desarrollo, no en el servidor) | Leer `bd.env` / `MANIFIESTO.txt`; nunca suponer el nombre |
| Fechas 5 horas corridas en SQL | Las columnas `DateTime` de Prisma son `timestamp` sin zona **en UTC** | Para columnas: `(col AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota'`; para la hora actual: `now() AT TIME ZONE 'America/Bogota'` (aplicarle la fórmula de columnas a `now()` suma 5 h) |
| `pg_restore` en paralelo se queja de posiciones | El dump se escribió a un tubo | `respaldo.sh` escribe el dump a un archivo dentro del contenedor: no pasa con sus copias |
| En la laptop, una herramienta tocó la base equivocada | `localhost:5432` es la base de desarrollo y `localhost:15432` es el **túnel a producción** (`tunnel.sh`) | Nunca apuntar pruebas a esos puertos. `respaldo.sh` prueba en un contenedor sin red ni puertos |

### 6.3 Caddy, dominios y certificados

| Síntoma | Causa | Solución |
|---|---|---|
| Una ruta pública nueva da **404 desde fuera**, el panel funciona y la API no registra nada | El Caddyfile es una **lista blanca**: la ruta no tiene su `handle` | Agregar el bloque (con `uri strip_prefix /api` para la API; sin él para rutas del panel como `/api/padron/*`) antes del `handle /api/*` que responde 404. Pasó con Telegram el 2026-09-28 y con el agente el 2026-09-07 |
| Carga del padrón con 404 o 500 | Faltaba `handle /api/padron/*` → `web:3000` (son Route Handlers del panel) | El instalador lo trae desde el 2026-11-17; el Caddyfile real de la copia también |
| Se editó el Caddyfile y Caddy sigue con el viejo | (a) Caddy no relee solo: falta `caddy reload`; (b) se usó `cp`/`mv` y el archivo tiene **otro inodo**: el contenedor monta el archivo suelto y sigue viendo el viejo | Escribir con `cat nuevo > Caddyfile`, `caddy validate` y luego `caddy reload` (sin corte). El instalador recarga solo al final |
| El Caddyfile quedó vacío un instante | Se corrió el script antes de subir el archivo nuevo | Primero subir el archivo y comprobar `[ -s nuevo ]` y su suma; luego respaldo, `cat >`, `validate` y solo entonces `reload` |
| `agenia_proxy` reiniciándose en bucle, sitio caído sin mensaje | Caddyfile mal formado | `docker logs agenia_proxy`; validar siempre con `caddy validate` antes |
| 502 en la API | Caddy apunta a `api:3001` (el `Caddyfile` de la raíz del repo es de otra instalación) | La imagen escucha en **3000**. Nunca razonar con el Caddyfile de la raíz del repo: el real es `/opt/agenia/deploy/Caddyfile` |
| Un dominio nuevo sin certificado tras cambiar el DNS | Caddy no reintentó todavía | `docker exec agenia_proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force` |
| HTTPS falla con el DNS bien | Puerto 80 ocupado o cerrado (Let's Encrypt valida por HTTP) | `ss -ltnp '( sport = :80 )'`, `ufw status` (deben estar 80 y 443/tcp y 443/udp) |
| HSTS rompe subdominios de `agenia.co` en otros servidores | `includeSubDomains` en el dominio raíz | El bloque de `agenia.co` va **sin** `includeSubDomains` (los de `app.` y `estadisticas.` sí lo llevan) |
| `landing/deploy/desplegar.sh` borró certificados | — (no pasa) | Su `rsync --delete` solo actúa dentro de `…/_data/landing` y lo comprueba: los certificados están en la raíz del volumen |

### 6.4 Configuración y secretos

| Síntoma | Causa | Solución |
|---|---|---|
| Bucle infinito de inicio de sesión | `JWT_SECRET` distinto entre web y API | Los dos leen el mismo `.env.production`; no tocarlo |
| `Invalid key length` / `bad decrypt` / credenciales de WhatsApp o IA «inválidas» | `ENCRYPTION_KEY` con comillas, de otro largo, o **distinta** de la que cifró la base | La de la copia, 64 hex, sin comillas. Si se perdió la `ENCRYPTION_KEY`: las credenciales guardadas no se recuperan; hay que volver a cargar en el panel el token de Meta, el App Secret, la llave de la IA y los tokens de Telegram |
| El cambio en `.env.production` no tiene efecto | `agenia restart` (`docker compose restart`) **no** relee el `.env` | `agenia up --force-recreate api web` |
| Tras instalar faltan Telegram o el asistente de soporte | El instalador reescribe `.env.production` desde su plantilla y pierde `TELEGRAM_ENABLED` / `SUPPORT_BOT_ENABLED` | Fase 7: el `.env.production` de la copia, idéntico |
| El chatbot olvida la conversación | Falta `REDIS_URL` (el código no lee `REDIS_HOST`/`REDIS_PORT`) | El compose la fija; con `REDIS_PASSWORD` en el `.env`, Redis la exige y la URL la lleva |
| Valores «de fábrica» pisan ajustes (p. ej. `MONITOR_BG_INTERVAL_MINUTES`) | Lo escrito en `.env.production` gana sobre el valor por defecto del código | Revisar el `.env` de la copia antes de cambiar defaults |

### 6.5 Despliegue y operación

| Síntoma | Causa | Solución |
|---|---|---|
| Desapareció un respaldo hecho en `/opt/agenia/backups` | `./update.sh` hace `rsync --delete` en `/opt/agenia` | Respaldos **siempre** en `/var/backups/agenia` |
| `agenia update` dice que no hay git | El código llega por rsync sin `.git` (el remote lleva token) | Actualizar desde la laptop con `./update.sh` |
| El vigía avisa «contenedor detenido» en cada despliegue | Los contenedores se recrean | `agenia mantenimiento <min>` antes y `agenia mantenimiento fin` después (`update-vps.sh` lo hace) |
| `sudo agenia …` pedido / `Permission denied` leyendo `.env.production` | Es 600 de root | Correr `agenia` como root (o `sudo agenia`) |
| Atajo `VPS='ssh …'; $VPS 'cmd'` falla en la terminal de la persona | zsh no parte variables | Funciones: `vps() { ssh … "$@"; }` |
| Un borrado masivo en producción se bloquea en la IA | El modo automático lo impide aunque la persona autorice | Lo corre la persona desde su terminal con el comando exacto |
| Los scripts de diagnóstico de la IA desaparecieron | El directorio temporal de la sesión se borra | Lo que haga falta guardar va al repo o a `respaldos/rescate/` |

### 6.6 SSH y seguridad del servidor

| Síntoma | Causa | Solución |
|---|---|---|
| El SSH sigue aceptando contraseña aunque se apagó | En `sshd_config.d` **gana el primer valor leído**; `50-cloud-init.conf` (con `PasswordAuthentication yes`) se leía antes que `99-agenia.conf` | El archivo propio va con prefijo `00-`. Comprobar siempre con `sshd -T`, no leyendo el archivo |
| fail2ban no banea a nadie | Su filtro trae `sshd.service`; en Ubuntu la unidad es `ssh.service` | `journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd`, `backend = systemd` (ya en el `jail.local` de la copia) |
| La persona quedó bloqueada por fail2ban | Su IP cambió o falló varias veces | Consola VNC de Contabo → `fail2ban-client set sshd unbanip <IP>`; agregar la IP a `ignoreip` |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | El VPS se reinstaló con la misma IP (o un ataque) | Solo si la persona confirma la reinstalación: `ssh-keygen -R <IP>` |
| Postgres o Redis visibles desde fuera | Alguien cambió `ports` en el compose | Postgres solo en `127.0.0.1:49317`, Redis sin puertos. `agenia verify` lo comprueba |

### 6.7 Agente del hospital, WhatsApp y Telegram

| Síntoma | Causa | Solución |
|---|---|---|
| El agente no conecta (404 en el handshake, nada en los registros) | Falta `handle /api/mirror*` en el Caddyfile, o Caddy no recargó | Fase 11; `POST /api/mirror/handshake` debe dar 401, no 404 |
| El agente da 401 para siempre | Un comentario `#` al final de una línea de su `agent.env` quedó dentro del token, o la base restaurada no es la que tiene el hash de su token | `agent.env` sin comentarios al final de línea; con la base de la copia el token sigue valiendo. Base nueva (anexo A): token nuevo con `provision-mirror-config.ts` y TI lo cambia |
| Tras desplegar API y agente juntos, el barrido de arranque del agente falla | El agente arrancó mientras la API se reiniciaba | Primero la API; reiniciar el agente con la API arriba |
| Al agente «le falta» lo ocurrido mientras estuvo caído | Se borró su `state.json` | Nunca borrarlo como «limpieza» |
| Webhook de Meta responde 403 a mensajes reales | Falta el App Secret de la clínica o `META_REQUIRE_SIGNATURE` | Con la base de la copia el App Secret sigue (cifrado con la misma `ENCRYPTION_KEY`) |
| Meta no entrega al webhook | Meta exige HTTPS válido | Certificado vigente (fase 11/14) |
| Telegram retiene mensajes de los pacientes | `/api/telegram/webhook/*` sin `handle` (Telegram recibe 404) | `POST …/api/telegram/webhook/x` debe dar 401 |
| Latencias altas de Gemini y Meta a la vez | Red de salida del VPS, no AgenIA | Esperar o revisar la red del proveedor |

---

## 7. Anexos

### A. Sin copia de seguridad (instalación vacía)

Solo si no hay ninguna copia. Se pierde todo: pacientes, citas, configuración, credenciales.

1. `bash deploy/remote-install.sh --host <IP> --single-domain app.hsvpanserma.agenia.co --email agendamientoia.app@gmail.com` (🧑 interactivo: pide la contraseña de root y la del usuario administrador). Genera secretos nuevos.
2. `ssh -t -i ~/.ssh/agenia_<ip>_ed25519 root@<IP> 'agenia superadmin crear superadmin@agenia.co'` (la clave sale una sola vez).
3. Agregar a mano al `/opt/agenia/deploy/Caddyfile` los bloques de estadísticas y landing (`docs/INSTALACION_VPS.md` §16, `landing/deploy/Caddyfile.ejemplo`) y `bash landing/deploy/desplegar.sh --host root@<IP> --ssh-key …`.
4. `TELEGRAM_ENABLED=true` y `SUPPORT_BOT_ENABLED=true` en `.env.production` y `agenia up --force-recreate api web`.
5. En el panel: crear la clínica, su administrador, IA, WhatsApp (token, phone number id, verify token, App Secret), Telegram, plantillas, médicos, servicios, EPS, padrón (`docs/INSTALACION_VPS.md` §11).
6. Espejo: `provision-mirror-config.ts` emite un token nuevo; TI lo pone en `/etc/agenia-mirror-agent/agent.env` y reinicia el agente (`apps/mirror-agent/deploy/INSTALACION_AGENTE_VPS.md` §2.3 y §7.3). La agenda se reconstruye con el barrido; las citas previas no se traen solas.
7. Alertas técnicas: conectar de nuevo el bot y el grupo en `/super-admin/alertas`.

### B. Si cambia el dominio

Además del rescate normal: en `.env.production`, `PUBLIC_WEB_URL`, `PUBLIC_API_URL` y `API_URL`; en el Caddyfile, el nombre del sitio y el `redir /login` de la landing; `deploy/install.conf`; registrar el nuevo webhook en Meta (`https://<dominio>/api/chatbot/webhook`); volver a conectar los bots de Telegram desde el panel (registran su webhook con `PUBLIC_API_URL`); TI cambia `MIRROR_API_URL` en el `agent.env` del agente y lo reinicia; avisar al personal la dirección nueva. `agenia up --force-recreate api web` tras el `.env`.

### C. Simulacro seguro

Lo que **sí** se puede practicar sin riesgo para los pacientes:

1. `./respaldo.sh --verificar respaldos/ultimo` con Docker encendido: restaura la copia en un Postgres sin red y compara los conteos. Es la prueba de que la copia sirve.
2. Fases 3 a 6 en un VPS de prueba **sin** la fase 5 (sin el `.env.production` real): instalación vacía.
3. Fases 3 a 9 en un VPS de prueba **sin arrancar nunca la API ni la web** (`dc stop api web` en cuanto termine el instalador, y no pasar a la fase 13), y destruir el VPS al terminar.

Lo que **nunca**: arrancar la API con la base real fuera del servidor de producción (R2), ni apuntar el DNS de producción a un servidor de prueba.

### D. Referencia rápida de `agenia` (en el servidor, como root)

| Comando | Para qué |
|---|---|
| `agenia status` / `agenia verify` | Estado y batería de comprobaciones |
| `agenia logs api -f` | Registros |
| `agenia up --force-recreate api web` | Recrear (relee `.env.production`) |
| `agenia build api web` | Reconstruir y levantar |
| `agenia migrate` / `agenia migrate-status` | Migraciones + DDL propio |
| `agenia backup` / `agenia restore <archivo.sql.gz>` | Respaldo del servidor / restaurar uno de esos (destructivo, pide `RESTAURAR`) |
| `agenia psql` / `agenia redis` | Consolas |
| `agenia superadmin listar\|crear\|restablecer\|quitar\|revisar-claves` | Super administradores |
| `agenia vigia instalar\|prueba\|estado` · `agenia mantenimiento <min>\|fin` | Vigía del servidor |
| `agenia env` | Variables con los secretos enmascarados |
| `agenia stop-all` / `agenia start-all` | Apagado y encendido ordenados |

En la laptop: `./update.sh` (desplegar), `./respaldo.sh` (copia), `./tunnel.sh` (base de producción en `localhost:15432`), `bash landing/deploy/desplegar.sh` (landing).

### E. Informe final (la IA lo entrega así)

```
RESCATE DE AGENIA — <fecha y hora de Bogotá>
Servidor nuevo: <IP> (<SO>, <CPU>/<RAM>/<disco>)   Servidor viejo: <apagado en fase 2 | caído>
Copia usada: <carpeta> — fecha <Fecha del manifiesto> — restauración probada: <sí/no>
Código desplegado: <commit>   Última migración: <nombre>
Fases: 0 ✅ 1 ✅ … 18 ✅  (las omitidas, con su motivo: p. ej. «10 omitida: copia de 9 h»)
Comprobaciones: conteos <idénticos | comparados con el manifiesto>, agenia verify <Todo correcto>,
  códigos de la fase 13 <todos como la tabla>, latido del agente <hh:mm>, WhatsApp <probado>, vigía <prueba recibida>
Brecha de datos: <ninguna | de <fecha copia> a <hora caída>: qué revisar>
Pendiente para la persona: <DNS, TI, cancelar el viejo en 7 días, commit de la IP nueva…>
Cambios fuera de lo escrito en esta guía: <ninguno | cuáles y por qué>
```

### F. Lista de control

- [ ] 0 Entorno · [ ] 1 Copia verificada y código ≥ copia · [ ] 2 Viejo detenido (o caído y confirmado)
- [ ] 3 Acceso y diagnóstico · [ ] 4 Código y copia subidos (huellas OK) · [ ] 5 `.env.production` antes de instalar
- [ ] 6 Instalación completada · [ ] 7 `.env` idéntico · [ ] 8 Base restaurada · [ ] 9 Conteos y migraciones
- [ ] 10 Redis (o razón para omitirlo) · [ ] 11 Certificados, landing y Caddyfile real · [ ] 12 Vigía y cron
- [ ] 13 API y web sanas, códigos de la tabla · [ ] 14 DNS y `agenia verify` en verde
- [ ] 15 Agente, WhatsApp, Telegram, alertas · [ ] 16 SSH, fail2ban, usuario `agenia` · [ ] 17 Respaldos
- [ ] 18 Repo con la IP nueva, brecha reportada, informe entregado

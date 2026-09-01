# 🚀 Instalación en un VPS (Debian / Ubuntu) — paso a paso manual

Guía para dejar el sistema **completo y funcional** en un servidor recién
entregado. Hay tres caminos y todos terminan en el mismo sitio:

| Camino | Comando | Cuándo |
|---|---|---|
| **Remoto** *(recomendado)* | `bash deploy/remote-install.sh` **en tu computador** | Servidor nuevo. Pide IP y contraseña de root, crea el usuario administrador, copia el código e instala todo por SSH. |
| Automático | `sudo bash deploy/install-vps.sh` **en el servidor** | Ya estás dentro del VPS con el código copiado. |
| Manual | Las secciones §2 a §9 de esta guía | Quieres entender o controlar cada paso. |

Los scripts ejecutan exactamente lo que está escrito aquí abajo. Si usas uno de
los dos primeros, salta a la [§10 Verificación](#10-verificación) y la
[§11 Puesta en marcha](#11-puesta-en-marcha-en-el-panel).

### Instalación remota en una línea

```bash
# Desde tu computador, en la raíz del repo:
bash deploy/remote-install.sh --check --host <IP>      # diagnostica sin tocar nada
bash deploy/remote-install.sh                          # instala de verdad
```

Te pedirá: IP del VPS, contraseña de root, nombre y contraseña del usuario
administrador que va a crear, dominio y correo para Let's Encrypt. A partir de
la primera conexión usa una llave SSH dedicada y no vuelve a necesitar la
contraseña de root.

---

## 0. Qué vamos a montar

Cinco contenedores en una red privada de Docker. Solo Caddy toca Internet:

```
        Internet
           │  :80 / :443
    ┌──────▼───────────────────────────────────────────┐
    │  caddy   (agenia_proxy)  TLS automático          │
    │    app.tudominio.com  ─────►  web:3000           │
    │    api.tudominio.com  ─────►  api:3000           │
    └──────┬───────────────────────────┬───────────────┘
           │                           │
    ┌──────▼────────┐          ┌───────▼───────────────┐
    │ web           │  server  │ api                   │
    │ Next.js 16    ├─actions─►│ NestJS 11             │
    │ agenia_web    │          │ agenia_api            │
    └──────┬────────┘          └───┬───────────────┬───┘
           │                       │               │
           └───────────┬───────────┘               │
                ┌──────▼───────┐          ┌────────▼─────┐
                │ postgres 15  │          │ redis 7      │
                │ agenia_db    │          │ agenia_redis │
                │ 127.0.0.1    │          │ sin puertos  │
                └──────────────┘          └──────────────┘
```

- **web** y **api** hablan entre sí por el nombre de servicio de Docker
  (`http://api:3000`), nunca por Internet.
- **postgres** solo publica en `127.0.0.1:49317` (para administrarlo por túnel
  SSH). **redis** no publica ningún puerto.
- Caddy pide y renueva los certificados de Let's Encrypt sin intervención.

> ⚠️ **El único compose de producción es
> [`docker-compose.deploy.yml`](../docker-compose.deploy.yml).**
> `docker-compose.prod.yml` fue **eliminado del repo**: tenía cuatro
> incompatibilidades que impedían un arranque limpio en un servidor nuevo, entre
> ellas la contraseña de Postgres escrita en el YAML. Quedan explicadas en la
> [§13](#13-por-qué-se-eliminó-docker-composeprodyml).

---

## 1. Lo que necesitas tener a mano

| # | Dato | Ejemplo | ¿Obligatorio? |
|---|------|---------|---------------|
| 1 | IP pública del VPS y acceso root/sudo por SSH | `203.0.113.10` | Sí |
| 2 | Dominio del sistema | `clinica.com` | Sí para HTTPS |
| 3 | Registro **DNS tipo A** apuntando a la IP del VPS | — | Sí, **antes** de instalar |
| 4 | Correo para avisos de Let's Encrypt | cualquier correo válido, sirve tu Gmail | Sí para HTTPS |
| 5 | Contraseña de root del VPS | — | Solo para la instalación remota |
| 6 | Nombre y contraseña del usuario administrador a crear | `agenia` | Solo para la instalación remota |
| 7 | JSON de *service account* de Google Cloud (TTS de voz) | `google-credentials.json` | No (se añade después) |
| 8 | Credenciales de WhatsApp Business de Meta | token, phone number id, App Secret | No (se cargan en el panel) |
| 9 | API key del LLM (Gemini / OpenAI / Claude) | — | No (se carga en el panel) |

Los ítems 8 y 9 **no van en el servidor**: se cargan cifrados desde el panel,
por organización. Solo hacen falta cuando conectes el chatbot.

### Un dominio o dos

| Modo | DNS necesario | Panel | API / webhook |
|---|---|---|---|
| **Un dominio** *(recomendado)* | 1 registro A | `https://clinica.com` | `https://clinica.com/api` |
| Dos dominios | 2 registros A | `https://app.clinica.com` | `https://api.clinica.com` |
| Sin dominio | ninguno | `http://IP` | `http://IP/api` — ⚠️ Meta exige HTTPS |

Con un solo dominio, Caddy enruta `/api/*` a la API quitando ese prefijo y todo
lo demás al panel. Es menos DNS que mantener y un solo certificado. La web no
tiene ninguna ruta propia bajo `/api`, así que no hay conflicto posible.

**Requisitos mínimos de la máquina:** 2 vCPU, 4 GB RAM, 15 GB libres,
Debian 11/12/13 o Ubuntu 20.04/22.04/24.04.
*Tu VPS (6 vCPU, 11 GB RAM, 94 GB libres, Ubuntu 24.04) va sobrado.*

---

## 2. Preparar el sistema

Conéctate por SSH como root y actualiza:

```bash
apt-get update && apt-get upgrade -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git jq openssl ufw rsync tzdata \
  iproute2 dnsutils cron
```

Zona horaria del servidor. **Importante:** los contenedores corren en UTC por
defecto y las fechas que ve el paciente saldrían 5 horas adelantadas
(ver [CLAUDE.md](../CLAUDE.md)):

```bash
timedatectl set-timezone America/Bogota
timedatectl                      # verifica: Time zone: America/Bogota (-05)
```

**Swap** — solo si el servidor tiene menos de 8 GB de RAM. Compilar Next.js
consume bastante memoria:

```bash
free -h                          # ¿Swap = 0B y RAM < 8Gi?
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Comprueba que **nada más ocupa los puertos 80 y 443** (si tienes nginx o apache
instalados, Caddy no podrá arrancar ni emitir certificados):

```bash
ss -ltnp '( sport = :80 or sport = :443 )'
systemctl disable --now nginx apache2 2>/dev/null || true
```

---

## 3. Instalar Docker

Desde el repositorio oficial (el paquete `docker.io` de Debian trae versiones
viejas sin el plugin `compose`):

```bash
install -m 0755 -d /etc/apt/keyrings
. /etc/os-release          # define $ID (debian|ubuntu) y $VERSION_CODENAME
curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io \
                   docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
```

**Verifica:**

```bash
docker --version           # Docker version 27.x o superior
docker compose version     # Docker Compose version v2.x
docker run --rm hello-world
```

---

## 4. Firewall

Abre SSH **antes** de activar UFW o te quedas fuera del servidor:

```bash
ufw allow 22/tcp           # o el puerto de SSH que uses
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp          # HTTP/3
ufw --force enable
ufw status verbose
```

PostgreSQL y Redis **no** necesitan reglas: no se publican hacia fuera.

---

## 5. DNS

Crea dos registros **A** en tu proveedor de dominio apuntando a la IP del VPS:

| Tipo | Nombre | Valor |
|------|--------|-------|
| A | `app` (o el que uses para el panel) | IP pública del VPS |
| A | `api` | IP pública del VPS |

Verifica desde el propio servidor **antes** de continuar. Si el DNS no está
propagado, Let's Encrypt rechazará la emisión del certificado:

```bash
curl -s https://api.ipify.org; echo          # IP real del servidor
dig +short A app.tudominio.com
dig +short A api.tudominio.com               # las tres deben coincidir
```

---

## 6. Traer el código

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/tu-org/tu-repo.git agenia
cd /opt/agenia
```

> 🔐 Si la URL del remote lleva un token embebido (`https://ghp_xxx@github.com/…`),
> queda en texto plano en `.git/config`. Después de clonar:
> ```bash
> chmod 700 /opt/agenia/.git
> ```
> y considera usar una **deploy key** SSH de solo lectura en su lugar.

Verifica que el checkout trae los archivos de despliegue:

```bash
ls docker-compose.deploy.yml deploy/Dockerfile.api deploy/Dockerfile.web deploy/agenia.sh
```

---

## 7. Configuración: secretos y `.env.production`

Genera los secretos (cópialos, los vas a pegar en el archivo):

```bash
openssl rand -hex 32     # JWT_SECRET
openssl rand -hex 32     # ENCRYPTION_KEY  ← exactamente 64 hex, sin comillas
openssl rand -hex 16     # POSTGRES_PASSWORD
openssl rand -hex 16     # SUPERADMIN_PURGE_PASSWORD
```

Crea `/opt/agenia/.env.production`. **Sin comillas en ningún valor** — Docker
los pasa tal cual y unas comillas literales rompen, por ejemplo, la longitud de
`ENCRYPTION_KEY`:

```bash
cat > /opt/agenia/.env.production <<'EOF'
NODE_ENV=production
TZ=America/Bogota
PORT=3000

# ── PostgreSQL ──
POSTGRES_USER=agenia
POSTGRES_PASSWORD=<pega-aquí>
POSTGRES_DB=agenia
DB_HOST_PORT=49317
DATABASE_URL=postgresql://agenia:<pega-aquí>@postgres:5432/agenia?schema=public

# ── Redis ──
# redis.service.ts lee EXCLUSIVAMENTE REDIS_URL. REDIS_HOST/REDIS_PORT se ignoran.
REDIS_URL=redis://redis:6379

# ── Secretos ──
JWT_SECRET=<pega-aquí>
ENCRYPTION_KEY=<pega-aquí-64-hex>
SUPERADMIN_PURGE_PASSWORD=<pega-aquí>

# ── URLs públicas ──
PUBLIC_WEB_URL=https://app.tudominio.com
PUBLIC_API_URL=https://api.tudominio.com
API_URL=https://api.tudominio.com
INTERNAL_API_URL=http://api:3000
NEXT_PUBLIC_API_URL=http://api:3000
PRIVACY_POLICY_URL=https://tu-sitio/proteccion-datos-personales

# ── Voz / TTS ──
ACTIVE_TTS_PROVIDER=GOOGLE
SHOW_TEXT_IN_AUDIO_MODE=false
VOICE_SLOTS_SPOKEN_COUNT=3

# ── WhatsApp (Meta) ──
META_REQUIRE_SIGNATURE=true

# ── Recordatorios ──
REMINDER_BUSINESS_HOURS_BEFORE=24
REMINDER_CRON_MINUTES=15

# ── Chatbot / colas ──
CHATBOT_INACTIVITY_TIMEOUT_MINUTES=5
INBOUND_MAX_CONCURRENCY=20
INBOUND_MAX_QUEUE=500
INBOUND_DEDUP_TTL_SECONDS=21600
LLM_FAILOVER_ENABLED=true
LLM_MAX_RETRIES=5

# ── Monitor de servicios ──
MONITOR_ENABLED=true
MONITOR_BG_INTERVAL_MINUTES=15
MONITOR_LIVE_INTERVAL_SECONDS=5
MONITOR_DEFAULT_TIMEOUT_MS=5000
MONITOR_DEGRADED_THRESHOLD_MS=3000
MONITOR_RETENTION_DAYS=365
EOF
chmod 600 /opt/agenia/.env.production
```

Tres claves que suelen dar problemas:

| Variable | Por qué importa |
|----------|-----------------|
| `JWT_SECRET` | Debe ser **el mismo** en web y api. La web firma la cookie de sesión y la API valida ese token. Distintos ⇒ bucle infinito de login. |
| `ENCRYPTION_KEY` | 64 hex exactos. Cifra en la BD las credenciales de WhatsApp y de los LLM. **Si la cambias después, esas credenciales quedan ilegibles.** Respáldala. |
| `REDIS_URL` | El código no lee `REDIS_HOST`/`REDIS_PORT`. Sin `REDIS_URL` la API intenta `redis://localhost:6379` dentro de su propio contenedor y el estado de sesión del chatbot nunca funciona. |

### 7.1 Variables de tiempo de compilación

`next build` importa `lib/prisma.ts`, que instancia `PrismaClient` al cargar el
módulo: `DATABASE_URL` tiene que existir **durante el build**, dentro de la
imagen. No se conecta a la base (todas las páginas con datos son
`force-dynamic`), pero la variable debe estar:

```bash
cat > /opt/agenia/apps/web/.env <<'EOF'
DATABASE_URL=postgresql://agenia:<pega-aquí>@postgres:5432/agenia?schema=public
JWT_SECRET=<el-mismo-de-arriba>
API_URL=https://api.tudominio.com
INTERNAL_API_URL=http://api:3000
NEXT_PUBLIC_API_URL=http://api:3000
EOF

cat > /opt/agenia/packages/database/.env <<'EOF'
DATABASE_URL=postgresql://agenia:<pega-aquí>@postgres:5432/agenia?schema=public
EOF

chmod 600 /opt/agenia/apps/web/.env /opt/agenia/packages/database/.env
```

### 7.2 Credenciales de Google Cloud (opcional, para la voz)

```bash
mkdir -p /opt/agenia/deploy/secrets && chmod 700 /opt/agenia/deploy/secrets
# sube el JSON con scp y déjalo aquí:
#   /opt/agenia/deploy/secrets/google-credentials.json
chmod 600 /opt/agenia/deploy/secrets/google-credentials.json
```

Y añade a `.env.production`:

```
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-credentials.json
```

(`deploy/secrets` se monta como `/app/secrets` dentro del contenedor de la API.)

---

## 8. Proxy inverso: `deploy/Caddyfile`

```bash
cat > /opt/agenia/deploy/Caddyfile <<'EOF'
{
	email soporte@tudominio.com
}

app.tudominio.com {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	# ── Superficie pública de la API ────────────────────────────────────
	# Solo el webhook de Meta se publica. El resto de la API lo consume el
	# panel por la red interna de Docker, así que no tiene por qué estar
	# expuesto: se pasa de ~19 controladores accesibles a 1 ruta.
	handle /api/chatbot/webhook* {
		uri strip_prefix /api
		reverse_proxy api:3000
	}

	# 404 (no 403) para no confirmar qué endpoints hay detrás.
	handle /api/* {
		respond "Not Found" 404
	}

	handle {
		reverse_proxy web:3000
	}
}
EOF
```

> ⚠️ **Caddy lee su configuración solo al arrancar.** Si editas el Caddyfile
> con el sistema en marcha: `agenia restart caddy`.

### Qué se publica y qué no

| Ruta | Pública | Quién la usa |
|---|---|---|
| `/` y todo el panel | ✅ | Navegadores del personal |
| `/api/chatbot/webhook` | ✅ | Meta (WhatsApp Cloud API) |
| El resto de `/api/*` | ❌ 404 | El panel, por `http://api:3000` (red interna) |
| PostgreSQL, Redis | ❌ | Solo red interna |

Para publicar otra ruta (por ejemplo, si abres el API FHIR a terceros), añade su
bloque `handle` con el mismo patrón y `agenia restart caddy`.

> ⚠️ **`api:3000`, no `api:3001`.** El `Caddyfile` de la raíz del repo apunta a
> 3001, pero la imagen fija `ENV PORT=3000` y `main.ts` escucha en
> `process.env.PORT`. Con 3001 el dominio de la API devuelve 502.

Valida la definición del stack antes de construir:

```bash
cd /opt/agenia
docker compose --env-file .env.production -f docker-compose.deploy.yml config >/dev/null && echo OK
```

---

## 9. Construir, migrar y arrancar

### 9.1 Construir las imágenes (5–15 min la primera vez)

```bash
cd /opt/agenia
docker compose --env-file .env.production -f docker-compose.deploy.yml build --pull
```

Esto ejecuta dentro de cada imagen: `pnpm install` → `prisma generate` →
`build` de `@agenia/database` → `@agenia/shared` → la app.

> El orden importa: `@agenia/database` y `@agenia/shared` publican `dist/`, que
> está en `.gitignore`. Compilarlos **antes** que la app es justo lo que le
> falta a `apps/web/Dockerfile` y por lo que fallaba desde un clon limpio con
> `Cannot find module '@agenia/shared'`.

### 9.2 Levantar la base de datos y crear el esquema

```bash
docker compose --env-file .env.production -f docker-compose.deploy.yml up -d postgres redis
docker compose --env-file .env.production -f docker-compose.deploy.yml ps   # esperar 'healthy'
```

> ⚠️ **`prisma migrate deploy` NO puede construir una base vacía en este repo.**
> El historial de migraciones está incompleto: el modelo multi-tenant
> (`Organization` y todo lo que cuelga de él) se creó en su día con
> `prisma db push` y nunca se capturó como migración. Las 19 migraciones solo
> crean 9 de las 29 tablas, y la migración `20260517045511_add_ai_provider_config`
> aborta con `relation "Organization" does not exist`.
>
> Comprobado sobre una base vacía: `migrate deploy` falla y deja 14 tablas.

El procedimiento correcto es el **baselining** documentado por Prisma: crear el
esquema completo desde `schema.prisma` y luego sellar el historial para que las
actualizaciones futuras sí sean incrementales.

```bash
DC="docker compose --env-file .env.production -f docker-compose.deploy.yml"

# 1. Esquema completo desde schema.prisma
$DC run --rm migrator prisma db push \
     --schema=packages/database/prisma/schema.prisma --skip-generate

# 2. Sellar las 19 migraciones como ya aplicadas
$DC run --rm --entrypoint sh migrator -c '
  for d in packages/database/prisma/migrations/*/; do
    prisma migrate resolve --applied "$(basename "$d")" \
      --schema=packages/database/prisma/schema.prisma
  done'
```

Resultado esperado: **30 tablas** y `migrate status` diciendo
`Database schema is up to date!`. A partir de ahí, cada despliegue nuevo solo
necesita `agenia migrate`, que aplica lo pendiente de forma incremental.

`agenia migrate` (y el instalador) hacen esto solos: detectan si la base está
vacía, si tiene esquema sin historial, o si ya está sellada, y eligen el camino.

`migrator` es un contenedor efímero que comparte imagen con `api`. Existe como
servicio aparte porque `api` tiene `container_name` fijo y un *one-off* de
compose sobre un servicio con nombre fijo puede chocar con el que ya corre.

No hace falta *seed*: el `seed.ts` del repo es un backfill de datos antiguos,
no un inicializador.

### 9.3 Arrancar el resto

```bash
docker compose --env-file .env.production -f docker-compose.deploy.yml up -d
docker compose --env-file .env.production -f docker-compose.deploy.yml ps
```

Los cuatro servicios deben quedar `running` y `healthy`.

### 9.4 Instalar el comando de operación

```bash
ln -sf /opt/agenia/deploy/agenia.sh /usr/local/bin/agenia
chmod +x /opt/agenia/deploy/agenia.sh
agenia --help
```

A partir de aquí, `agenia up` reemplaza a la línea larga de `docker compose`.

---

## 10. Verificación

Todo de una vez:

```bash
agenia verify
```

O una por una, para saber exactamente qué falla:

```bash
# 1. Contenedores arriba y sanos
docker ps --format 'table {{.Names}}\t{{.Status}}'

# 2. Base de datos con el esquema aplicado (deben ser >20 tablas)
agenia psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

# 3. Redis responde
agenia redis ping                      # PONG

# 4. La API responde dentro de la red
docker exec agenia_api node -e "fetch('http://127.0.0.1:3000/').then(r=>console.log(r.status))"

# 5. La web alcanza la API por el nombre de servicio
docker exec agenia_web node -e "fetch('http://api:3000/').then(r=>console.log(r.status))"

# 6. HTTPS público (puede tardar ~30 s en emitirse el certificado)
curl -I https://app.tudominio.com
curl -I https://api.tudominio.com

# 7. El webhook de Meta rechaza tokens desconocidos (403 = correcto).
#    Este 403 recorre la cadena entera: proxy → API → consulta a PostgreSQL.
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://app.tudominio.com/api/chatbot/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1"

# 8. El resto de la API NO debe ser alcanzable (404 = lo corta Caddy)
for r in system-logs/recent-errors analytics appointments monitor/config; do
  printf '%s → %s\n' "$r" "$(curl -s -o /dev/null -w '%{http_code}' https://app.tudominio.com/api/$r)"
done

# 9. PostgreSQL y Redis NO están expuestos
ss -ltnp | grep -E ':(5432|6379)'      # solo 127.0.0.1:49317, o nada
```

Si `curl` a los dominios falla, mira el log del proxy:

```bash
agenia logs caddy | tail -40
```

---

## 11. Puesta en marcha en el panel

1. **Primer ingreso.** Abre `https://app.tudominio.com/login`. El primer intento
   de login crea automáticamente el Super Admin si no existe ninguno:

   | Usuario | Contraseña |
   |---|---|
   | `superadmin@sanvicente.com` | `admin123` |

   > 🔴 **Cambia esa contraseña de inmediato.** Está escrita en el código
   > (`apps/web/app/actions/auth.ts`) y es pública.

2. **Crea la organización** (la clínica) desde *Super Admin → Organizations*, y
   asígnale su administrador.

3. **Configura el proveedor de IA** de la clínica (Gemini / ChatGPT / Claude) en
   *Configuración → Integraciones*. La API key se guarda cifrada con
   `ENCRYPTION_KEY`.

4. **Conecta WhatsApp Business**: token, *phone number id*, *verify token* y
   **App Secret** de Meta.

5. **Registra el webhook en Meta** (App → WhatsApp → Configuration):

   | Campo | Valor |
   |---|---|
   | Callback URL | `https://api.tudominio.com/chatbot/webhook` |
   | Verify token | el que definiste en el panel |

   Meta exige HTTPS válido; por eso el dominio de la API no es opcional.

   > Si el webhook devuelve 403 al recibir mensajes, es que aún no cargaste el
   > App Secret. Solución correcta: cargarlo. Solución temporal de migración:
   > `META_REQUIRE_SIGNATURE=false` en `.env.production` + `agenia restart api`,
   > y volver a `true` en cuanto lo tengas.

6. **Voz (opcional):** si subiste el JSON de Google, revisa
   *Super Admin → Monitor* para ver Google TTS en verde.

---

## 12. Operación diaria

### Encender, apagar y limpiar

| Necesidad | Comando |
|---|---|
| Apagar todo sin perder datos | `sudo bash deploy/stop-all.sh` |
| Volver a encender todo | `sudo bash deploy/start-all.sh` |
| Ver qué se apagaría, sin hacerlo | `sudo bash deploy/stop-all.sh --dry-run` |
| Borrar la instalación y empezar de cero | `sudo bash deploy/uninstall-vps.sh` |
| Ver qué se borraría, sin hacerlo | `sudo bash deploy/uninstall-vps.sh --dry-run` |

`stop-all.sh` descubre los servicios estén como estén levantados (compose
actual, compose antiguo `antigravity_*` o contenedores sueltos) y los detiene de
fuera hacia dentro — proxy, panel, API, Redis y por último PostgreSQL, al que
le da 60 s para cerrar su checkpoint. Usa `stop`, no `down`: no se borra nada.

`start-all.sh` los levanta por capas y espera a que cada una responda de verdad
antes de seguir con la siguiente; termina ejecutando la verificación completa.

`uninstall-vps.sh` borra contenedores, volúmenes, imágenes, configuración
generada, cron y el comando `agenia`. Ofrece respaldar la base antes. Opciones
útiles: `--keep-data` (conserva la base), `--keep-build-cache` (la reinstalación
tarda minutos en vez de una hora), `--purge-legacy` (borra también los restos
`antigravity_*` del despliegue anterior), `--all`, `--purge-docker`.

### Cómo se actualiza el sistema

El instalador remoto copia el código por **rsync excluyendo `.git`** — a
propósito: el remote del repositorio lleva un token embebido y no tiene por qué
viajar al servidor. La consecuencia es que en el VPS no hay repositorio git, así
que `agenia update` (que hace `git pull`) no aplica. Se actualiza desde tu
computador, con el mismo comando de la instalación:

```bash
bash deploy/remote-install.sh \
  --host <IP> --single-domain <dominio> --email <correo>
```

Resincroniza el código, reconstruye las imágenes, aplica migraciones pendientes
y verifica. Es idempotente: no regenera secretos ni toca los datos.

Si solo quieres reconstruir con el código que ya está en el servidor:
`agenia build`. Y si algún día clonas el repo con git en el VPS, `agenia update`
vuelve a funcionar tal cual.

### Comandos del día a día

```bash
agenia status              # estado + salud + recursos
agenia logs api -f         # seguir logs de un servicio
agenia restart api         # reiniciar un servicio
agenia update              # git pull + build + migrate + up + verify
agenia backup              # volcado comprimido de PostgreSQL
agenia restore <archivo>   # restaurar (destructivo, pide confirmación)
agenia env                 # variables efectivas, secretos enmascarados
```

**Backup automático.** El instalador deja este cron; si vas manual, créalo:

```bash
mkdir -p /var/backups/agenia
printf '30 3 * * * root /usr/local/bin/agenia backup >> /var/log/agenia-backup.log 2>&1\n' \
  > /etc/cron.d/agenia-backup
```

Retiene 14 días en `/var/backups/agenia`. **Cópialos fuera del servidor**: un
backup que vive en la misma máquina que la base no es un backup.

**Administrar la base desde tu equipo** (sin exponer el puerto):

```bash
ssh -L 5432:127.0.0.1:49317 root@IP_DEL_VPS
# y conectas tu cliente a localhost:5432
```

**Actualizar el sistema operativo:**

```bash
apt-get update && apt-get upgrade -y && reboot   # los contenedores vuelven solos
```

---

## 13. Por qué se eliminó `docker-compose.prod.yml`

Ese archivo ya no existe en el repo. Tenía cuatro cosas que impedían un arranque
limpio en un servidor nuevo, todas resueltas en
[`docker-compose.deploy.yml`](../docker-compose.deploy.yml):

| # | Problema en `prod` | Efecto | Solución |
|---|---|---|---|
| 1 | Inyecta `REDIS_HOST`/`REDIS_PORT` | `redis.service.ts` solo lee `REDIS_URL` → la API busca Redis en su propio contenedor y el estado de sesión del chatbot no funciona | `REDIS_URL=redis://redis:6379` |
| 2 | `Caddyfile` apunta a `api:3001` | La imagen escucha en 3000 → 502 en el dominio de la API | Caddy → `api:3000` |
| 3 | Dominio fijo `agendamiento-ia.com` | Certificado imposible con otro dominio | `deploy/Caddyfile` generado con los tuyos |
| 4 | Contraseña de Postgres fija dentro del YAML | Credencial pública en git | Secretos en `.env.production` (chmod 600, fuera de git y fuera de la imagen) |

Mientras existió, `.github/workflows/deploy.yml` desplegaba con él en cada push a
`main` — es decir, producción arrancaba con la contraseña que estaba en git. El
workflow ahora usa `docker-compose.deploy.yml` con `--env-file .env.production`.

Y dos correcciones en los Dockerfiles ([`deploy/Dockerfile.web`](../deploy/Dockerfile.web),
[`deploy/Dockerfile.api`](../deploy/Dockerfile.api)):

- **web** ahora compila `@agenia/database` y `@agenia/shared` antes de
  `next build`. Sin eso, un clon limpio falla: sus `dist/` están en
  `.gitignore` y el Dockerfile original asumía que ya venían en el contexto.
- Se fija **pnpm 9.0.0** (el `packageManager` del repo) y se instala con
  `--no-frozen-lockfile`, para que un lockfile ligeramente desfasado no
  reviente el build.

Además, el nuevo [`.dockerignore`](../.dockerignore) evita que `COPY . .` meta
en la imagen los `node_modules` de macOS del equipo de desarrollo y el
directorio `.git` completo (que en este repo incluye un token en la URL del
remote).

### Lo que apareció al probar el despliegue completo

Todo esto se detectó levantando el sistema de verdad, no leyendo el código:

| # | Hallazgo | Consecuencia si no se corrige | Estado |
|---|---|---|---|
| 1 | El historial de Prisma no puede construir una base vacía (falta la creación de `Organization`) | La instalación muere a mitad con 14 de 30 tablas | Resuelto: `db push` + baseline automático (§9.2) |
| 2 | `GET /` en la API devuelve 404 — `AppController` no está registrado en `app.module.ts` | Un healthcheck HTTP nunca pasa: el contenedor queda `unhealthy` para siempre | Resuelto: el healthcheck comprueba el socket TCP |
| 3 | El `GlobalExceptionFilter` persiste **cada 404** en la tabla `SystemLog` | Un sondeo cada 30 s llena la base de errores falsos; cualquier bot que escanee la API hace lo mismo | Resuelto en el código: solo se persisten los 5xx, con antirrepetición |
| 4 | Un `Caddyfile` mal formado deja al proxy en bucle de reinicio silencioso | El sitio queda caído sin mensaje claro | Resuelto: el instalador valida el Caddyfile con `caddy validate` antes de arrancar |

### Qué se escribe ahora en `SystemLog`

[`global-exception.filter.ts`](../apps/api/src/system-log/global-exception.filter.ts)
persistía **toda** excepción, incluidos los 404. Ahora:

- **5xx** → se persiste (es una avería real del servidor).
- **4xx** → **no** se persiste. Es un error del cliente: ruta inexistente,
  token de webhook que no cuadra, rol sin permiso. Sigue yendo al stdout del
  contenedor, que Docker ya rota, así que no se pierde nada para diagnosticar.
- **Antirrepetición**: aun siendo 5xx, solo se guarda una fila por combinación
  estado+método+ruta+mensaje cada 60 s. Un fallo en bucle (BD caída, cron que
  revienta cada minuto) ya no puede escribir miles de filas idénticas.
- Para depurar un problema puntual de cliente: `SYSTEMLOG_PERSIST_MIN_STATUS=400`
  en `.env.production` + `agenia restart api`, y devolverlo a 500 al terminar.

Medido sobre el sistema en marcha: 80 peticiones con error 4xx → **0 filas**
nuevas; 30 peticiones idénticas con el umbral bajado a 400 → **1 fila**.

---

## 14. Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `curl https://dominio` no responde | DNS sin propagar o puerto 80 ocupado | `dig +short A dominio`; `agenia logs caddy` |
| El navegador entra en bucle de login | `JWT_SECRET` distinto entre web y api, o cookie sin HTTPS | Debe ser el mismo valor; `agenia env \| grep JWT` |
| `Cannot find module '@agenia/shared'` en el build | Se está usando `apps/web/Dockerfile` en vez de `deploy/Dockerfile.web` | Construir con `docker-compose.deploy.yml` |
| Dominio de la API en 502 | Caddy apuntando a `api:3001` | Corregir a `api:3000` y `agenia restart caddy` |
| `Invalid key length` al arrancar la API | `ENCRYPTION_KEY` con comillas o longitud distinta de 64 hex | Regenerar con `openssl rand -hex 32`, sin comillas |
| El chatbot olvida la conversación | Falta `REDIS_URL` | Añadirla y `agenia restart api` |
| Webhook de Meta responde 403 | Falta el App Secret de la clínica | Cargarlo en el panel (ver §11.5) |
| Fechas con 5 horas de más | Falta `TZ=America/Bogota` | Ya viene en el compose; verificar con `docker exec agenia_api date` |
| `migrate deploy` falla | La base no está lista o `DATABASE_URL` apunta a `localhost` | Debe apuntar a `postgres:5432`; `agenia logs postgres` |
| Build sin memoria (`killed`) | RAM insuficiente | Crear swap (§2) y reintentar |
| El build falla descargando fuentes | `layout.tsx` usa `next/font/google`: el build necesita salida a Internet | Verificar DNS/salida HTTPS del servidor y reintentar |
| `agenia migrate` dice que no encuentra la imagen | Aún no se construyó `agenia-api:latest` | `agenia build` y reintentar |
| `relation "Organization" does not exist` al migrar | Se lanzó `migrate deploy` sobre una base vacía | Usar `agenia migrate`, que hace `db push` + baseline (§9.2) |
| El contenedor de la API nunca pasa a `healthy` | Healthcheck HTTP contra `GET /`, que devuelve 404 | Ya resuelto: el healthcheck es TCP. Reconstruir la imagen si viene de una versión anterior |
| `agenia_proxy` reiniciándose sin parar | `Caddyfile` mal formado (bloques `{ }` en una sola línea) | `docker logs agenia_proxy`; validar con `caddy validate` |
| El panel responde pero la API da 000 | Caddy caído; el resto sigue vivo | `agenia logs caddy` |

Log completo de la instalación automatizada: `/var/log/agenia-install.log`.

---

## 15. Nota de seguridad

Antes de poner esto frente a pacientes reales:

1. **Cambia la contraseña del Super Admin por defecto** (§11.1).
2. **Rota cualquier token de GitHub embebido en la URL del remote.** Un token
   en `git remote -v` queda en texto plano en el servidor y en cualquier copia
   del repositorio.
3. **Respalda `ENCRYPTION_KEY`** fuera del servidor. Sin ella, las credenciales
   de WhatsApp y de los LLM guardadas en la base son irrecuperables.
4. **Saca los backups del servidor** periódicamente.
5. Mantén `META_REQUIRE_SIGNATURE=true` en operación normal.

---

## 16. Anexo: el despliegue de Hospital San Vicente

Datos verificados el 2026-08-19:

| Dato | Valor |
|---|---|
| VPS | Contabo, Ubuntu 24.04, 6 vCPU, 11 GB RAM, 94 GB libres |
| IP | `89.117.61.28` |
| DNS existente | `hsvpanserma.agenia.co` → `89.117.61.28` ✔ |
| DNS **inexistente** | `app.hsvpanserma.agenia.co`, `api.hsvpanserma.agenia.co` ✘ (no hay comodín) |

El despliegue va en **modo un dominio** sobre `app.hsvpanserma.agenia.co`:

```bash
# Desde tu computador, en la raíz del repo
bash deploy/remote-install.sh \
  --host 89.117.61.28 \
  --single-domain app.hsvpanserma.agenia.co \
  --email tu-correo@gmail.com
```

Queda:

| | |
|---|---|
| Panel | `https://app.hsvpanserma.agenia.co` |
| Login | `https://app.hsvpanserma.agenia.co/login` |
| Webhook de Meta | `https://app.hsvpanserma.agenia.co/api/chatbot/webhook` |

**Antes de ejecutar**, confirma que el DNS ya propagó:

```bash
dig +short A app.hsvpanserma.agenia.co    # debe devolver 89.117.61.28
```

Si sale vacío, espera: Let's Encrypt no emitirá el certificado y el sitio
quedará sin HTTPS. El instalador lo comprueba y avisa antes de tocar nada.

### Por qué un dominio y no dos

- La API **no tiene CORS** habilitado: con dos hostnames el navegador nunca
  podría llamarla, habría que añadir y mantener una lista blanca.
- **Ningún componente de navegador llama a la API**: las llamadas salen del
  servidor Next hacia `http://api:3000` por la red interna de Docker.
- La superficie pública real de la API son **dos rutas** (`GET`/`POST` del
  webhook). El audio TTS se sube a los servidores de Meta, no se sirve desde
  aquí.
- Es reversible: añadir `api.hsvpanserma.agenia.co` después son un registro
  DNS, cuatro líneas de Caddyfile y repegar la URL en Meta.

Cambiaría la recomendación si se abre el API FHIR (`fhir/v4`) a terceros: ahí
un hostname dedicado desde el día uno evita migrar URLs de las que dependan
integraciones externas.

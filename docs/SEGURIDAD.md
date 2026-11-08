# Seguridad — auditoría del 2026-11-07 y runbook

> **Qué es.** El resultado de la primera auditoría de seguridad completa de AgenIA (código, dependencias, contenedores y el servidor de producción del Hospital San Vicente de Paúl), lo que se corrigió en el código ese mismo día, lo que queda por hacer **en el servidor** (cada paso con su comando, para correrlo con una ventana de mantenimiento y confirmación) y cómo repetir la revisión. La Parte 2 §9 de `docs/conocimiento/AGENIA.md` resume lo vigente; este archivo es el detalle.
>
> **Resumen.** No se encontró ninguna puerta abierta: solo salen a internet los puertos 22, 80 y 443; el SSH es solo con llaves y fail2ban bloquea unas 500 direcciones al día; la API publica solo una lista blanca de rutas y todas las que salen a internet exigen firma (Meta), `secret_token` (Telegram) o token (agente del hospital); las sesiones son JWT de 8 h validadas contra la base; las claves van con bcrypt; los secretos están fuera del repositorio; hay respaldo diario de la base. Lo grave era **invisible desde fuera**: Next.js con 5 vulnerabilidades críticas de ejecución remota, 6 críticas y 68 altas en total en las dependencias, Node 20 sin soporte desde abril de 2026 y los contenedores corriendo como root. Todo eso quedó corregido en el código; falta desplegarlo y hacer los pasos del servidor.

---

## 1. Alcance y método

- **Servidor** (VPS `89.117.61.28`, Ubuntu 24.04, por SSH, solo lectura): sistema y parches, puertos, cortafuegos, SSH, fail2ban, usuarios y sudo, permisos de archivos sensibles, Docker (imágenes, usuario de los procesos, capacidades, logs), Postgres (roles, `pg_hba`), Redis (contraseña, comandos), Caddy (TLS, cabeceras, lista blanca), respaldos, cron.
- **Aplicación**: autenticación y sesiones, autorización por rol y por clínica, webhooks, rutas públicas, inyección SQL (`$queryRaw`), cabeceras HTTP, exposición de errores, datos personales en los registros, claves por defecto, secretos en el repositorio, dependencias (`pnpm audit --prod`).
- **Pruebas desde fuera**: cabeceras HTTPS, versiones de TLS, redirección HTTP→HTTPS, lista blanca de `/api`.

## 2. Hallazgos y estado

| # | Hallazgo | Riesgo | Estado |
|---|---|---|---|
| 1 | **Next.js 16.1.6** con 5 vulnerabilidades críticas (ejecución remota de código por el optimizador de imágenes y `use cache`, entre otras) y una docena de altas (evasión del middleware, SSRF, DoS). | Crítico | **Corregido en código**: `next@16.4.5`. |
| 2 | **Dependencias**: 6 críticas, 68 altas, 68 moderadas y 10 bajas (`axios`, `express`/`proxy-addr`, `multer`, `body-parser`, `lodash`, `protobufjs`, `grpc-js`, `nodemailer`, `qs`, `path-to-regexp`, `sharp`, `postcss`, `zod`, `msal-node`…). | Crítico | **Corregido en código**: `pnpm audit --prod` pasa de 152 avisos a **2** (los de `xlsx`, #3). Directas: `axios@1.21`, NestJS `11.2.8`, `express@5.3`, `nodemailer@10.4`, `@google-cloud/text-to-speech@7`, `zod@4`, `mssql@12`; transitivas con `pnpm.overrides` en `package.json`. |
| 3 | `xlsx@0.18.5` (SheetJS) con contaminación de prototipo y ReDoS; no hay versión corregida en npm (SheetJS publica en su propio CDN). | Alto (nominal) | **Aceptado**: solo lee, en el navegador del administrador, el Excel que él mismo elige (padrón y Mensajes masivos); nunca un archivo de terceros ni en el servidor. Se revisará si SheetJS vuelve a npm. |
| 4 | **Node 20** en las imágenes de la API y la web: sin parches de seguridad desde el 30 de abril de 2026. | Alto | **Corregido en código**: `node:22-bookworm-slim` en los cuatro Dockerfiles; `agenia build` ahora hace `docker build --pull` para traer la imagen base al día en cada despliegue. |
| 5 | **Contenedores como root**: los procesos de la API y la web corrían como `root` dentro del contenedor, sin `no-new-privileges` ni recorte de capacidades. | Alto | **Corregido en código**: `USER node` en los Dockerfiles de producción; `security_opt: no-new-privileges` en los seis servicios y `cap_drop: ALL` en API, web y migrador. `update-vps.sh` deja `/var/lib/agenia/alertas` y `deploy/secrets` del uid 1000 antes de construir. |
| 6 | **Clave por defecto `temporal123`** en `apps/web/app/actions/usuarios.ts` (`createBookingAgent`). | Alto | **Corregido**: el archivo no lo usaba ninguna pantalla; se eliminó. Las pantallas vigentes exigen `validarClaveAsignada`. |
| 7 | **Rociado de claves**: el tope de ingresos fallidos contaba por correo+IP (5 en 15 min); una misma IP podía probar una clave en cientos de correos sin tope. | Medio | **Corregido**: tope adicional por IP sola, 20 fallidos en 15 min con cualquier correo (`INTENTOS_INGRESO.MAX_POR_IP`), con su constancia `LOGIN_BLOCKED` (`alcance: IP`). |
| 8 | **Cabeceras**: el panel no mandaba `X-Frame-Options` ni `Permissions-Policy`, y anunciaba `x-powered-by: Next.js`. | Medio | **Corregido**: `next.config.ts` (`poweredByHeader: false`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Permissions-Policy`, `X-DNS-Prefetch-Control`). HSTS, `nosniff` y `Referrer-Policy` ya los ponía Caddy. |
| 9 | **Datos personales en los registros** de la API: el cron de recordatorios escribía la cédula completa y el asistente el celular del remitente. | Medio (Ley 1581) | **Corregido**: van enmascarados (`•••3456`). |
| 10 | **Redis sin contraseña** (solo alcanzable por la red interna de Docker). | Medio-bajo | **Preparado en código**: con `REDIS_PASSWORD` en `.env.production`, Redis exige la contraseña y la API la usa; sin la variable, nada cambia. Falta ponerla (§3.3). |
| 11 | **`KEYS` en Redis** (39.000 llamadas): bloquea a Redis mientras recorre todas las claves. | Bajo (disponibilidad) | **Corregido**: `RedisService.scanKeys` (SCAN por tandas) en los 22 sitios. |
| 12 | **Notas locales en el servidor**: `rsync` copiaba a `/opt/agenia` las carpetas `.claude`, `reports`, `research_notes` y archivos de trabajo, legibles por el usuario `agenia`. | Bajo | **Corregido**: excluidos en `deploy/update-vps.sh` y `.dockerignore`. |
| 13 | **64 paquetes del sistema por actualizar**, entre ellos el kernel (6.8.0-149) y Docker (29.9.3). `unattended-upgrades` solo instala los de seguridad de Ubuntu; Docker viene de otro repositorio y el kernel exige reinicio. | Medio | **Pendiente en el servidor** (§3.1). |
| 14 | **SSH**: `X11Forwarding yes`, `MaxAuthTries 6`, `LoginGraceTime 120`, sin `ClientAliveInterval`. El resto (solo llaves, sin contraseña, root solo con llave) está bien. | Bajo | **Pendiente en el servidor** (§3.2). |
| 15 | **Postgres**: la aplicación se conecta como el único rol, que es superusuario. | Bajo-medio | **Pendiente** (§3.4): un rol sin superusuario para la aplicación. |
| 16 | **Respaldos solo en el mismo disco** (`/var/backups/agenia`, 14 días, 17 archivos, 254 MB). Si el servidor se pierde, se pierden. | Medio | **Pendiente** (§3.5): copia cifrada fuera del servidor. |
| 17 | `fail2ban` tiene en `ignoreip` solo una de las dos IP desde las que entra el administrador (`186.87.28.46`; también entra desde `181.79.57.172`). | Bajo | **Pendiente** (§3.2). |
| 18 | El filtro global de errores de la API devuelve el `message` del error al cliente también en los 500. | Bajo | **Aceptado**: solo lo reciben clientes autenticados (panel, agente) o Meta, que no lo lee; las rutas públicas están en lista blanca. Se cambiará si la API se publica más. |
| 19 | Next.js avisa que la convención `middleware.ts` pasará a `proxy.ts`. | Informativo | Pendiente (sin efecto hoy). |

### Lo que se revisó y está bien

Puertos (22, 80, 443; Postgres solo en `127.0.0.1:49317`; Redis sin puerto publicado); UFW con denegación por defecto; SSH solo llaves (34.861 intentos fallidos, 2.224 bloqueos acumulados, 56 IP bloqueadas al momento); `.env.production` `600` de root; secretos fuera de git (`.gitignore`, revisión de patrones de tokens); `JWT_SECRET` y `ENCRYPTION_KEY` de 64 caracteres; cookie `httpOnly`, `secure`, `sameSite=lax`, 8 h, validada contra la base en cada petición (web y API); bcrypt para claves; política de claves (10+ caracteres, letras y números, sin las de fábrica); firma de Meta obligatoria (`META_REQUIRE_SIGNATURE=true`, App Secret de la clínica configurado, comparación en tiempo constante); `secret_token` de Telegram; token del agente como SHA-256 con comparación en tiempo constante; `$queryRaw` solo con `Prisma.sql` parametrizado (el `$executeRawUnsafe` que hay es `SET LOCAL` con una constante); autorización por rol y por clínica en cada acción y guard; TLS 1.3 (1.0 y 1.1 rechazados), certificado Let's Encrypt vigente hasta el 16 de enero de 2027, HSTS un año; lista blanca de `/api` funcionando (`/api/organizations` → 404); respaldo diario con `pg_dump` y 14 días de retención; logs de Docker con rotación; Caddy sin `Server`.

## 3. Pasos pendientes en el servidor (con confirmación, en ventana de mantenimiento)

Todos como `root` por SSH. Ninguno lo hace solo el despliegue; ninguno está hecho al escribir esto.

### 3.1 Parches del sistema y reinicio (≈ 3 minutos sin servicio)

```sh
apt-get update && apt-get upgrade -y          # kernel 6.8.0-149, docker-ce 29.9.3 y 60 más
docker compose -f /opt/agenia/docker-compose.deploy.yml --env-file /opt/agenia/.env.production ps   # todo "healthy" antes
reboot                                         # el kernel nuevo exige reinicio; los contenedores vuelven solos (restart: unless-stopped)
```

Después: `agenia ps` (o `docker ps`) con los cinco contenedores `healthy`, `uname -r` = 6.8.0-149 y un mensaje de prueba al asistente. El agente del hospital reintenta solo lo que no pudo entregar durante el reinicio.

Para que Docker se actualice solo en adelante, agregar su origen a `unattended-upgrades`:

```sh
cat > /etc/apt/apt.conf.d/51agenia-docker <<'EOF'
Unattended-Upgrade::Allowed-Origins { "Docker:noble"; };
EOF
```

### 3.2 SSH y fail2ban

```sh
cp /etc/ssh/sshd_config.d/00-agenia-hardening.conf /var/backups/agenia/00-agenia-hardening.conf.$(date +%Y%m%d)
cat >> /etc/ssh/sshd_config.d/00-agenia-hardening.conf <<'EOF'
# Auditoría 2026-11-07
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
sshd -t && systemctl reload ssh      # si sshd -t falla, NO recargar: restaurar el respaldo
```

`AllowTcpForwarding` se deja en `yes`: el túnel a la base (`15432`) lo usa.

En `/etc/fail2ban/jail.local`, agregar la segunda IP del administrador a `ignoreip` y `fail2ban-client reload`. Si una IP del equipo queda bloqueada: consola VNC de Contabo y `fail2ban-client set sshd unbanip <IP>`.

### 3.3 Contraseña de Redis

```sh
P=$(openssl rand -hex 24)
printf 'REDIS_PASSWORD=%s\n' "$P" >> /opt/agenia/.env.production
cd /opt/agenia && docker compose --env-file .env.production -f docker-compose.deploy.yml up -d redis api
docker logs agenia_api --since 2m | grep -i redis     # «Conectado a Redis exitosamente»
```

Hace falta el `docker-compose.deploy.yml` de este commit ya desplegado (lee `REDIS_PASSWORD`).

### 3.4 Rol de Postgres sin superusuario (más adelante)

Crear `agenia_app` con `LOGIN` y los permisos sobre el esquema `public` (`GRANT ALL ON ALL TABLES/SEQUENCES` y `ALTER DEFAULT PRIVILEGES`), cambiar `DATABASE_URL` en `.env.production` y dejar el rol actual solo para migraciones (`migrator`). Exige probar las migraciones con el rol nuevo antes (los disparadores de `non-prisma-ddl.sql` necesitan que el dueño de las tablas sea coherente).

### 3.5 Respaldo fuera del servidor

Con `rclone` a un almacenamiento cifrado (Backblaze B2, S3 o similar): un cron después del respaldo (`3:45`) que copie `/var/backups/agenia/agenia-*.sql.gz` con `rclone copy --max-age 2d`, y una prueba de restauración trimestral en el Postgres de pruebas. Sin esto, perder el disco del VPS es perder la historia.

## 4. Desplegar estos cambios

**Verificado antes de desplegar (2026-11-07, equipo local):** tipos de la API, la web y el agente; pruebas en verde (API 4.775, web 1.792, shared 2.175, agente 681); `nest build` y `next build`; la imagen de la API construida con `deploy/Dockerfile.api` arranca como `uid=1000(node)` con Node 22.23.4, escribe en `/app/alertas` y trae `dist/main.js`; la imagen de la web, igual (ver la bitácora del commit si cambió algo después).

1. Commit (con la base de conocimiento al día) y CI en verde. El despliegue del 2026-11-05 15:49 lleva `efb81f5`; `563c717` (arreglos del 6 de noviembre) y este commit salen juntos.
2. `./update.sh`: sincroniza, deja los bind mounts del uid 1000, construye con `--pull` (Node 22) y recrea.
3. Comprobar: `docker exec agenia_api id` → `uid=1000(node)`; `docker exec agenia_api node -v` → v22; los cinco contenedores `healthy`; `curl -sI https://app.hsvpanserma.agenia.co/login | grep -iE "x-frame|permissions|x-powered"` (deben salir las dos primeras y no la tercera); un mensaje al asistente; la vigía sigue leyendo `/var/lib/agenia/alertas/vigia.latido`.
4. Si la API no arranca por permisos de `/app/alertas`: `chown -R 1000:1000 /var/lib/agenia/alertas` y `agenia up`.

El agente del hospital (`apps/mirror-agent`) se empaqueta aparte (`docs/drivers/cnt-sanvicente-anserma/COMPILAR_Y_ACTUALIZAR.md`): `mssql@12` y `msal-node@7` piden Node 20 o más en la máquina del hospital; comprobar `node -v` allí antes de actualizarlo.

## 5. Cómo repetir la auditoría

- Dependencias: `pnpm audit --prod` (debe quedar solo `xlsx`). Para un paquete: `pnpm why <paquete> --filter api|web`.
- Cabeceras y TLS desde fuera: `curl -sI https://app.hsvpanserma.agenia.co/login`, `openssl s_client -tls1_1 -connect app.hsvpanserma.agenia.co:443` (debe fallar).
- Servidor: `ss -tulnp`, `ufw status verbose`, `fail2ban-client status sshd`, `sshd -T | grep -iE "passwordauth|permitroot|x11"`, `apt list --upgradable`, `docker inspect -f '{{.Config.User}} {{.HostConfig.SecurityOpt}} {{.HostConfig.CapDrop}}' agenia_api`.
- Secretos en el repositorio: `git grep -nE "EAA[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN .* PRIVATE KEY"`.
- Lo que la API escribe en los registros: `docker logs agenia_api --since 24h | grep -E "[0-9]{10}"` no debe traer celulares ni cédulas.

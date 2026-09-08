# Instalación del agente espejo en un VPS Ubuntu — paso a paso

De un Ubuntu recién entregado a un agente corriendo, conectado al **SQL Server
del hospital** y a la **nube de AgenIA**. No supone conocimiento previo del
proyecto: cada paso dice qué se hace, qué se escribe y cómo comprobar que salió
bien antes de pasar al siguiente.

> Esto **reemplaza** a `deploy/README.md` como guía de instalación (aquel tiene
> tres errores que hacen fallar el primer intento; ver §13). Para *operar* el
> agente ya instalado, la referencia sigue siendo
> `docs/drivers/cnt-sanvicente-anserma/RUNBOOK.md`.

---

## 0. Qué es esto, en dos frases

El agente es **un proceso Node** que corre dentro de la red del hospital. Habla
T-SQL con el SQL Server del HIS (`192.168.1.16:1433`, dentro de la LAN) y HTTPS
saliente con la nube de AgenIA. **La nube nunca abre una conexión hacia el
hospital**: no hay que abrir ningún puerto entrante, ni VPN, ni IP pública.

```
   LAN del hospital 192.168.1.0/24                    Internet
 ┌────────────────────────────────────┐
 │  SQL Server HIS  192.168.1.16:1433 │
 │            ▲                       │
 │            │ T-SQL (interno)       │
 │  VPS  192.168.1.175  ──────────────┼──► HTTPS 443 ──► app.hsvpanserma.agenia.co
 │  systemd: agenia-mirror-agent      │     (única salida)      (Caddy → API → Postgres)
 │  ✗ sin puertos entrantes           │
 └────────────────────────────────────┘
```

**Dónde se hace cada cosa.** Hay tres máquinas y confundirlas es el error más
común:

| Símbolo | Máquina | Qué se hace ahí |
|---|---|---|
| 💻 | **Tu portátil** (el repo) | Compilar el bundle, provisionar en la base de la nube, generar el token |
| ☁️ | **VPS de la nube** (Contabo `89.117.61.28`) | Caddy + API + Postgres. Solo se toca en §2 |
| 🏥 | **VPS del hospital** (`192.168.1.175`) | Donde vive el agente. Todo lo demás |

> 🚨 **El símbolo 💻 dice DESDE DÓNDE se ejecuta el comando, no A QUÉ BASE
> apunta.** Es la confusión más fácil de cometer de todo el documento, y
> además la más silenciosa: **no siempre da error**.
>
> Cada script de `packages/database/scripts/*.ts` (los de §2.3, §2.4, §10, y
> cualquier `UPDATE "HospitalMirrorConfig"` de §2.6/§11) habla con Postgres
> por `DATABASE_URL`. Sin nada más, carga `apps/api/.env` de tu portátil —
> que apunta a **tu Postgres LOCAL de desarrollo**, no a la nube. Si le pasas
> el `organizationId` del hospital REAL a un comando que está mirando tu base
> local, esa organización simplemente no existe ahí. Algunos scripts lo dicen
> claro (`No existe ninguna Organization con id ...`); otros no tienen forma
> de saber que preguntaste por la base equivocada y contestan algo que
> **suena razonable pero es mentira** — por ejemplo `homologar.ts` respondiendo
> *"No hay catálogo todavía"* cuando el catálogo real lleva rato esperando en
> la nube, en la base que no consultaste.
>
> **Para hablarle a la base de PRODUCCIÓN desde tu portátil**, Postgres no
> tiene puerto público (mismo principio de "solo salida" que el agente) —
> se llega por un túnel SSH sobre el mismo acceso que ya tienes al VPS de la
> nube:
>
> ```bash
> ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 -f -N -L 15432:127.0.0.1:49317 root@89.117.61.28
> ```
>
> (`49317` es el puerto de este VPS — `DB_HOST_PORT` en `/opt/agenia/.env.production`
> si alguna vez cambia. La llave y el puerto se generaron al correr
> `deploy/remote-install.sh`.)
>
> Y en CADA comando 💻 que toque la base, antepón `DATABASE_URL` apuntando al
> túnel — la contraseña vive en `/opt/agenia/.env.production` (`POSTGRES_PASSWORD`),
> **nunca la pegues en un archivo del repo**:
>
> ```bash
> DATABASE_URL="postgresql://agenia:<POSTGRES_PASSWORD>@127.0.0.1:15432/antigravity?schema=public" \
>   pnpm --filter @agenia/database exec tsx scripts/<el-script>.ts <organizationId> [flags]
> ```
>
> Cierra el túnel cuando termines (`kill` al PID de `ssh`, o simplemente cierra
> la terminal si no usaste `-f`). Los pasos 💻 de aquí en adelante llevan un
> recordatorio corto de un renglón — este es el único lugar donde se explica
> el porqué completo.

---

## 1. Datos que tienes que tener a mano ANTES de empezar

Sin estos cinco no se puede terminar la instalación. Consíguelos primero.

| # | Dato | De dónde sale |
|---|---|---|
| 1 | Usuario y clave SSH del VPS del hospital | TI del hospital. Hoy: `data@192.168.1.175`, con `sudo` completo |
| 2 | Contraseña del login `agenia_sync` del SQL Server | La eligió quien corrió `sql/AGENIA_SYNC_SETUP.sql` contra el HIS. **Si no se ha corrido, se corre ahora** (§2.1) |
| 3 | URL pública de la API | `https://app.hsvpanserma.agenia.co/api` |
| 4 | `organizationId` de la clínica en Postgres | Se lista solo en §2.3 si no lo sabes |
| 5 | Acceso a la base Postgres de la nube | Para correr los scripts de `packages/database` |

> 🔐 La contraseña de `agenia_sync` **no se escribe en el VPS del hospital**. Va
> cifrada en la base de la nube (§2.3) y el agente la recibe en cada arranque
> por el handshake. En el VPS solo queda el token del agente.

---

## 2. Preparar la nube (💻 + ☁️) — antes de tocar el hospital

Si esto no está listo, el agente arrancará y fallará con `401` o `404` sin decir
por qué.

### 2.1 Crear el usuario del HIS en el SQL Server del hospital

Una sola vez, con un login administrador del SQL Server y **visto bueno de TI**.
Se ejecuta `docs/drivers/cnt-sanvicente-anserma/sql/AGENIA_SYNC_SETUP.sql`.

> 🚨 **Hay DOS bases, y el script tiene que correr en las dos por separado.**
> `PRUEBAS` es la de ensayo; **`ESEHSVP` es el catálogo VIVO**, el que se usa en
> producción. La sección 4 del script (permisos) trae `USE PRUEBAS;` a
> propósito — **no la edites**. Para producción corre además la sección
> **4-ESEHSVP**, justo debajo: es la misma, ya apuntando a `ESEHSVP`.
>
> ✅ **Ya se corrió** contra el catálogo vivo del hospital y quedó confirmado
> el 2026-09-07 (captura de SSMS: `agenia_sync` / esquema `dbo`, una fila). Si
> vuelves a montar este agente en otro hospital, este es el paso que hay que
> repetir — la sección 4-ESEHSVP es idempotente, segura de correr sin saber si
> ya se corrió antes.

Antes de ejecutarlo, edita la línea del password:

```sql
CREATE LOGIN agenia_sync
WITH PASSWORD = '<<REEMPLAZAR_PASSWORD_FUERTE>>',   -- ← pon uno fuerte y GUÁRDALO
```

Ese es el dato #2 de la tabla de arriba. **No crea, altera ni borra ningún
objeto del HIS**: crea una base propia (`AGENIA_SYNC`) y da permisos mínimos de
lectura/escritura sobre las tablas que el driver necesita.

### 2.2 Comprobar que el proxy de la nube publica `/api/mirror/*`

💻 Desde cualquier máquina con internet:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://app.hsvpanserma.agenia.co/api/mirror/handshake
```

| Respuesta | Significado |
|---|---|
| **`401`** | ✅ Correcto. La ruta llega a la API y el guard rechaza el token vacío |
| `404` | ❌ Caddy está bloqueando la ruta. **Párate aquí** y arréglalo (abajo) |

Si dio `404`: ☁️ entra al VPS de la nube y añade este bloque en
`/opt/agenia/deploy/Caddyfile`, **antes** del `handle /api/*` que responde 404:

```caddy
handle /api/mirror* {
	uri strip_prefix /api
	reverse_proxy api:3000
}
```

Luego `agenia restart caddy` y repite el `curl` hasta ver `401`.

### 2.3 Crear la configuración del espejo y generar el token

💻 En tu portátil, en la raíz del repo — **con `DATABASE_URL` al túnel de
producción** (ver el aviso de arriba: sin eso, esto escribe en tu base local
y el hospital nunca ve nada). Este comando cifra las credenciales del
SQL Server dentro de la base de la nube y **imprime el token del agente una
sola vez**:

```bash
MIRROR_HIS_TARGET=hospital \
AGENIA_SYNC_PASSWORD='<la contraseña del dato #2>' \
  pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts <organizationId>
```

> ¿No sabes el `organizationId`? Corre el mismo comando sin él: lista las
> organizaciones disponibles y sale sin escribir nada.

Salida esperada:

```
HospitalMirrorConfig <uuid> listo para org "..." (...).
enabled=false — activarlo manualmente tras la primera verificación de conectividad.

Token del agente (se muestra UNA sola vez, no queda en ningún lado más — pegar en agent.env):
mirror_<organizationId>_<64 caracteres hex>
```

📋 **Copia ese token ahora.** No se puede recuperar; si se pierde, hay que
volver a correr este comando (lo cual invalida el anterior).

`MIRROR_HIS_TARGET=hospital` es lo que apunta el `driverConfig` a
`192.168.1.16:1433` / base `PRUEBAS`. Sin esa variable apuntaría a `localhost`.

> 🚨 **Un segundo gotcha propio de este script, más traicionero que el de
> `DATABASE_URL`.** Este comando cifra `driverConfig` con `ENCRYPTION_KEY` —
> que TAMBIÉN carga de `apps/api/.env` por defecto si no la fuerzas. Si
> apuntaste `DATABASE_URL` a producción pero dejaste que `ENCRYPTION_KEY` se
> colara de tu `.env` local, el `UPDATE`/`INSERT` en Postgres sale bien (nadie
> valida la clave al escribir), pero cuando el agente haga handshake la API
> **no puede descifrarlo con SU propia clave** — falla con `500` y el mensaje
> exacto `unsupported state or unable to authenticate data`, que no menciona
> "clave" por ningún lado. Pasó una vez en este despliegue.
>
> Fuerza también `ENCRYPTION_KEY` a la real de producción (está en
> `/opt/agenia/.env.production`, **nunca la copies a un archivo del repo**):
>
> ```bash
> DATABASE_URL="postgresql://agenia:<POSTGRES_PASSWORD>@127.0.0.1:15432/antigravity?schema=public" \
> ENCRYPTION_KEY="<la de /opt/agenia/.env.production>" \
> MIRROR_HIS_TARGET=hospital \
> AGENIA_SYNC_PASSWORD='<la contraseña del dato #2>' \
>   pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts <organizationId>
> ```
>
> Si ya lo corriste sin esto y ves el `500` de arriba en el journal del
> agente: vuelve a correr el comando bien, y **copia el token nuevo** — se
> regenera cada vez y el anterior queda invalidado.

### 2.4 Cargar la tabla de valores (`mappingJson`)

💻 Con `DATABASE_URL` al túnel de producción (ver el aviso del principio).
Sin esto el driver no sabe qué convenio ni qué especialidad escribir, y toda
cita muere con un error de mapeo:

```bash
# Primero en seco, para ver el diff:
DATABASE_URL="postgresql://agenia:<POSTGRES_PASSWORD>@127.0.0.1:15432/antigravity?schema=public" \
  pnpm --filter @agenia/database exec tsx scripts/aplicar-mapping.ts <organizationId> --dry-run
# Si el diff se ve bien:
DATABASE_URL="postgresql://agenia:<POSTGRES_PASSWORD>@127.0.0.1:15432/antigravity?schema=public" \
  pnpm --filter @agenia/database exec tsx scripts/aplicar-mapping.ts <organizationId>
```

### 2.5 Comprobar que los triggers del outbox existen

Si faltan, AgenIA nunca encola nada para el hospital y el espejo queda **muerto
en silencio**. Es un fallo real que ya ocurrió (2026-08-31).

```bash
pnpm --filter @agenia/database db:apply-sql
```

Es idempotente: si ya estaban, no hace nada.

### 2.6 Encender el espejo

Mientras `enabled = false`, el guard devuelve `401` a **todo** y el trigger de
Postgres no encola nada. Enciéndelo ahora.

Este es SQL puro, no un script de Node — no hace falta el túnel si ya tienes
una sesión en el VPS de la nube: corre directo contra el contenedor de
Postgres (☁️, con `root` u otro usuario con acceso a Docker):

```bash
ssh root@89.117.61.28 '
  cd /opt/agenia
  docker compose --env-file .env.production -f docker-compose.deploy.yml \
    exec -T postgres psql -U agenia -d antigravity -c "
      UPDATE \"HospitalMirrorConfig\" SET enabled = true
      WHERE \"organizationId\" = '"'"'<organizationId>'"'"';
    "
'
```

> `availabilityMode` se queda en `OFF` a propósito. La agenda se enciende
> después, en §11, y no antes.

---

## 3. Compilar el agente (💻 en tu portátil)

Lo que se copia al hospital es **un solo archivo JavaScript**, no un árbol de
`node_modules`:

```bash
cd <raíz del repo>
pnpm install
pnpm --filter @agenia/shared build
pnpm --filter @agenia/mirror-agent bundle
ls -lh apps/mirror-agent/dist/agent.bundle.js    # ~3,3 MB
```

Verificación rápida de que el bundle no está roto — debe fallar con ese mensaje
exacto y nada más:

```bash
node apps/mirror-agent/dist/agent.bundle.js
# → [mirror-agent] error fatal en el arranque: Error: MIRROR_API_URL no está configurado.
```

---

## 4. Entrar al VPS del hospital y comprobar la red (🏥)

```bash
ssh data@192.168.1.175
```

Las dos conexiones que el agente necesita, comprobadas **desde el propio VPS**:

```bash
# a) ¿Alcanza el SQL Server del HIS?
nc -zv 192.168.1.16 1433

# b) ¿Sale a internet hacia la API?
curl -sI https://app.hsvpanserma.agenia.co | head -1
```

| | Esperado | Si falla |
|---|---|---|
| a) | `succeeded!` / `Connection to 192.168.1.16 1433 port [tcp/*] succeeded!` | Es red del hospital o el SQL Server está caído. **Es de TI, no tuyo.** No sigas |
| b) | `HTTP/2 200` | El perímetro no deja salir por 443. Pide la regla a TI (`CONECTIVIDAD.md` §7.1) |

Y una tercera comprobación que evita un fallo muy difícil de diagnosticar —
¿el hospital intercepta TLS?

```bash
curl -sv https://app.hsvpanserma.agenia.co 2>&1 | grep -i issuer
```

| Resultado | Acción |
|---|---|
| `issuer: ... O=Let's Encrypt ...` | ✅ Nada que hacer. Sigue |
| Cualquier otra CA (nombre del hospital, un fabricante de proxy) | Hay inspección TLS. Node **no usa** el almacén del sistema: tendrás que añadir `NODE_EXTRA_CA_CERTS` en §7 |

---

## 5. Instalar Node (🏥)

El agente necesita **Node 22 o superior**. Node 20 llegó a fin de vida en abril
de 2026 y no se instala un runtime sin parches junto al HIS de un hospital.

Mira primero qué trae Ubuntu — es la vía preferida (parches por `apt`, sin
repositorios de terceros que justificarle a TI):

```bash
apt-cache policy nodejs
```

```bash
# a) Si el "Candidato" es 22.x o superior (Ubuntu 26.04 trae 22.22.1):
sudo apt update && sudo apt install -y nodejs

# b) Solo si Ubuntu se queda corto — tarball oficial:
VER=v22.20.0
curl -fsSLO https://nodejs.org/dist/$VER/node-$VER-linux-x64.tar.xz
sudo tar -xJf node-$VER-linux-x64.tar.xz -C /usr/local --strip-components=1 \
  --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
```

**Comprueba la versión y, sobre todo, que el comando se llame `node`:**

```bash
node -v                       # debe decir v22.x o superior

# Si esto no imprime nada, el paquete dejó el binario como `nodejs`.
# La unidad systemd busca `node` por PATH y moriría con `status=203/EXEC`,
# un error que no menciona a Node por ningún lado. Se cierra con un enlace:
command -v node || sudo ln -s "$(command -v nodejs)" /usr/bin/node
command -v node               # ahora sí debe imprimir una ruta
```

> ⚠️ No es un detalle menor y ya mordió una vez. El paquete de Debian/Ubuntu
> puede instalar el binario como `/usr/bin/nodejs`, y el tarball lo deja en
> `/usr/local/bin/node`. La unidad arranca con `/usr/bin/env node`, que resuelve
> por PATH y cubre las dos rutas — el único hueco que le queda es que exista
> `nodejs` y no `node`, que es justo lo que cierra la línea de arriba.

`npm` no hace falta y es correcto que no esté: el agente es un bundle único.

---

## 6. Crear el usuario y los directorios (🏥)

El agente **nunca corre como root** ni como `data`. Corre como un usuario de
sistema sin shell y sin login:

```bash
sudo useradd --system --home /opt/agenia-mirror-agent --shell /usr/sbin/nologin mirroragent

sudo mkdir -p /opt/agenia-mirror-agent/dist /opt/agenia-mirror-agent/data /etc/agenia-mirror-agent
sudo chown -R mirroragent:mirroragent /opt/agenia-mirror-agent
sudo chmod 700 /etc/agenia-mirror-agent
```

| Directorio | Para qué |
|---|---|
| `/opt/agenia-mirror-agent/dist` | El bundle |
| `/opt/agenia-mirror-agent/data` | `state.json` — **el único directorio que systemd deja escribir** |
| `/etc/agenia-mirror-agent` | El `agent.env` con el token |

---

## 7. Copiar el bundle y escribir la configuración

### 7.1 Copiar el bundle (💻 desde tu portátil)

```bash
scp apps/mirror-agent/dist/agent.bundle.js data@192.168.1.175:/tmp/
```

> 🚨 **Esto solo funciona si tu portátil está en la LAN del hospital.**
> `192.168.1.175` es una IP privada con **cero entrada** desde internet a
> propósito (§0) — el `scp` de arriba falla ("no route to host" / timeout)
> desde cualquier lado que no sea la propia red del hospital. Si tu único
> acceso es AnyDesk a una estación Windows que sí ve el VPS (el caso de
> Anserma, ver `CONECTIVIDAD.md` §4), el archivo tiene que dar el mismo salto
> que ya das para el SSH:
>
> 1. En la sesión de AnyDesk, usa su panel de transferencia de archivos
>    (icono de archivos en la barra de la sesión) para copiar
>    `agent.bundle.js` al escritorio de la estación Windows.
> 2. Desde esa misma Windows (PowerShell trae `scp` integrado desde
>    Windows 10 1809+), continúa el salto por la LAN:
>    ```powershell
>    scp .\agent.bundle.js data@192.168.1.175:/tmp/
>    ```
>
> Es el mismo patrón de dos saltos de siempre (AnyDesk → Windows → VPS),
> solo que esta vez carga un archivo en vez de abrir una terminal.

### 7.2 Instalarlo (🏥 en el VPS)

```bash
sudo install -o mirroragent -g mirroragent -m 0755 \
  /tmp/agent.bundle.js /opt/agenia-mirror-agent/dist/index.js
rm /tmp/agent.bundle.js
```

### 7.3 Escribir `agent.env` (🏥)

Sustituye `<TOKEN>` por el token de §2.3 y pega el bloque entero:

```bash
sudo tee /etc/agenia-mirror-agent/agent.env > /dev/null <<'ENV'
MIRROR_API_URL=https://app.hsvpanserma.agenia.co/api
MIRROR_AGENT_TOKEN=<TOKEN>
MIRROR_DRIVER_KEY=cnt-sanvicente-anserma
MIRROR_DRIVER_VERSION=0.1.0-fase1
ENV

sudo chown mirroragent:mirroragent /etc/agenia-mirror-agent/agent.env
sudo chmod 600 /etc/agenia-mirror-agent/agent.env
sudo nano /etc/agenia-mirror-agent/agent.env    # pega aquí el token real
```

> 🚨 **No pongas comentarios `#` al final de una línea.** systemd solo ignora
> las líneas que *empiezan* por `#`: un `MIRROR_AGENT_TOKEN=mirror_... # el token`
> guarda el comentario **dentro** del token y produce un `401` permanente sin
> ninguna pista. Por eso este bloque no lleva ni uno.
>
> El archivo `agent.env.example` de este directorio **sí los lleva**: sirve como
> referencia de qué variables existen, no para copiarlo tal cual.

Solo hacen falta esas cuatro variables: todos los intervalos tienen valores por
defecto sensatos en `src/config.ts`. Los datos del SQL Server **no van aquí** —
llegan cifrados en el handshake.

Si en §4 detectaste inspección TLS, añade además:

```
NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/<la-ca-del-hospital>.crt
```

Comprueba que quedó bien:

```bash
sudo ls -l /etc/agenia-mirror-agent/agent.env   # -rw------- mirroragent mirroragent
sudo cat /etc/agenia-mirror-agent/agent.env     # 4 líneas, sin '#' al final de ninguna
```

---

## 8. Instalar el servicio systemd (🏥)

La unidad ya viene escrita en el repo. Arranca con `ExecStart=/usr/bin/env
node`, que resuelve la ruta por PATH y sirve igual con el Node del paquete
(`/usr/bin/node`) que con el del tarball (`/usr/local/bin/node`) — por eso §5
solo tenía que garantizar que `node` exista.

**Copiarla renombrando.** El archivo del repo se llama `mirror-agent.service`,
pero la unidad tiene que quedar instalada como **`agenia-mirror-agent.service`**:
es el nombre que usan el runbook, el panel y todos los comandos de aquí en
adelante. Si la copias con su nombre de origen, el `enable` falla con *"Unit
agenia-mirror-agent.service not found"*.

```bash
# 💻 Desde tu portátil:
scp apps/mirror-agent/deploy/mirror-agent.service data@192.168.1.175:/tmp/
```

> Mismo aviso que §7.1: si `192.168.1.175` no es accesible desde tu red, este
> archivo (unas pocas líneas de texto) es fácil de pegar directo por la
> terminal de AnyDesk/SSH en vez de transferirlo — copia el contenido de
> `apps/mirror-agent/deploy/mirror-agent.service` y en el VPS:
> `cat > /tmp/mirror-agent.service <<'EOF'` ... pega ... `EOF`.

```bash
# 🏥 En el VPS — el destino NO se llama igual que el origen:
sudo install -m 0644 /tmp/mirror-agent.service \
  /etc/systemd/system/agenia-mirror-agent.service
rm /tmp/mirror-agent.service

sudo systemctl daemon-reload
sudo systemctl enable --now agenia-mirror-agent
```

Qué hace esa unidad, en corto: corre como `mirroragent` (nunca root), lee
`/etc/agenia-mirror-agent/agent.env`, reinicia sola a los 5 s si el proceso
muere, arranca sola cuando se reinicia la máquina, escribe al journal, y se
endurece con `ProtectSystem=strict` + `NoNewPrivileges` dejando **un solo
directorio escribible**: `/opt/agenia-mirror-agent/data`.

---

## 9. Verificar que funciona (🏥)

```bash
systemctl status agenia-mirror-agent
journalctl -u agenia-mirror-agent -n 50 --no-pager
```

**Lo que tienes que ver en los primeros segundos:**

```
[mirror-agent] arrancando con driver "cnt-sanvicente-anserma"...
[mirror-agent] handshake OK, entrando al loop de sync.
```

Ese `handshake OK` es la prueba de las dos conexiones a la vez: salió a
internet, la API aceptó el token, y recibió las credenciales del SQL Server.

**A los ~15 segundos**, el catálogo (prueba de que el SQL Server responde):

```
[mirror-agent] catálogo DOCTOR: 30 del hospital, 0 homologado(s), 30 SIN homologar.
[mirror-agent] catálogo SERVICE: ...
```

**A los ~2 minutos**, la primera reconciliación:

```
[mirror-agent] reconciliación OK: N cita(s), sin diferencias.
```

### Si algo no cuadra

| Síntoma en el journal / status | Causa | Arreglo |
|---|---|---|
| `status=203/EXEC` | No hay un comando llamado `node` en el PATH | §5: `sudo ln -s "$(command -v nodejs)" /usr/bin/node` y reinicia el servicio |
| `MIRROR_API_URL no está configurado` | systemd no leyó el env | Ruta o permisos de `/etc/agenia-mirror-agent/agent.env` |
| `Mirror API respondió 401` | Token mal pegado, con un `#` detrás, o `enabled = false` | §7.3 y §2.6 |
| `Mirror API respondió 404` | Caddy no publica `/api/mirror/*` | §2.2 |
| `Mirror API no respondió en 20s` | El VPS no sale por 443 | §4b |
| `Failed to connect to 192.168.1.16:1433` | Red o credenciales del HIS | `nc -zv 192.168.1.16 1433`. Si responde, es la contraseña: rehaz §2.3 |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Inspección TLS | `NODE_EXTRA_CA_CERTS` en §7.3 |
| `active (running)` pero el journal está mudo | Perdió internet a media conexión | El agente corta a los 20 s y lo dice; si no dice nada, revisa la red |

### Comprobación desde el lado de la nube

☁️ En Postgres, el latido debe subir cada minuto y `lastHisReachable` estar en
`true` (mismo patrón sin túnel que §2.6):

```bash
ssh root@89.117.61.28 '
  cd /opt/agenia
  docker compose --env-file .env.production -f docker-compose.deploy.yml \
    exec -T postgres psql -U agenia -d antigravity -tAc "
      SELECT \"lastHeartbeatAt\", \"lastHisReachable\", \"lastHisDetail\"
      FROM \"HospitalMirrorConfig\" WHERE \"organizationId\" = '"'"'<organizationId>'"'"';
    "
'
```

O en el panel: **Dashboard → Espejo con el HIS**, cuatro semáforos en verde.

---

## 10. Homologar el catálogo — sin esto no se espeja NADA (💻)

El agente ya subió los médicos y servicios del hospital como *candidatos*. Falta
decir qué médico del hospital es cuál de AgenIA. **Hasta que esto no esté hecho,
no se genera un solo cupo y ninguna cita sale ni entra** — y, peor, con el
espejo encendido el chatbot deja de ofrecer citas a todo el mundo sin un solo
error en el log.

💻 Con `DATABASE_URL` al túnel de producción (ver el aviso del principio) —
**este es el script donde el hueco duele más**: sin el túnel, no da error,
dice *"No hay catálogo todavía"*, que suena a "espera un poco" en vez de
"estás mirando la base equivocada".

```bash
# Sin --aplicar solo muestra el plan y sale. Guárdalo en un archivo para
# revisar la lista completa sin que la terminal la recorte:
DATABASE_URL="postgresql://agenia:<POSTGRES_PASSWORD>@127.0.0.1:15432/antigravity?schema=public" \
  pnpm --filter @agenia/database exec tsx scripts/homologar.ts <organizationId> \
  | tee /tmp/homologacion-plan.txt
less /tmp/homologacion-plan.txt

# Cuando la lista se vea bien:
DATABASE_URL="postgresql://agenia:<POSTGRES_PASSWORD>@127.0.0.1:15432/antigravity?schema=public" \
  pnpm --filter @agenia/database exec tsx scripts/homologar.ts <organizationId> --aplicar
```

Los médicos que AgenIA no tenía se crean con `whatsappBookingEnabled = false`:
nadie se vuelve vendible por accidente. Se encienden uno a uno desde el panel.

Y las aseguradoras del piloto (mismo `DATABASE_URL`):

```bash
DATABASE_URL="postgresql://agenia:<POSTGRES_PASSWORD>@127.0.0.1:15432/antigravity?schema=public" \
  pnpm --filter @agenia/database exec tsx scripts/provision-eps-piloto.ts <organizationId>
DATABASE_URL="postgresql://agenia:<POSTGRES_PASSWORD>@127.0.0.1:15432/antigravity?schema=public" \
  pnpm --filter @agenia/database exec tsx scripts/provision-eps-piloto.ts <organizationId> --aplicar
```

---

## 11. La agenda del hospital: OFF → SHADOW → ON

Que AgenIA venda **la agenda real del hospital** es una decisión aparte, y se
toma después de una semana de comparación. Tres estados:

| Modo | Qué hace |
|---|---|
| `OFF` (inicial) | No se toca `ScheduleSlot`. La agenda de AgenIA sigue siendo la suya |
| `SHADOW` | Calcula la rejilla del HIS y **reporta** las diferencias sin escribir nada |
| `ON` | La agenda de AgenIA **es** la del hospital |

SQL puro contra el contenedor de Postgres — mismo patrón que §2.6, sin túnel:

```bash
# Paso 1: al menos una semana en sombra. Cada pasada queda en SyncAudit (op='AVAILABILITY').
ssh root@89.117.61.28 '
  cd /opt/agenia
  docker compose --env-file .env.production -f docker-compose.deploy.yml \
    exec -T postgres psql -U agenia -d antigravity -c "
      UPDATE \"HospitalMirrorConfig\" SET \"availabilityMode\" = '"'"'SHADOW'"'"'
      WHERE \"organizationId\" = '"'"'<organizationId>'"'"';
    "
'

# Paso 2: cuando el hospital confirme que coincide con su pantalla de agenda,
# el mismo comando cambiando 'SHADOW' por 'ON'.
```

**Paso 3 — carga inicial** (🏥), para no esperar a que el bucle recorra 400 días
a su ritmo:

```bash
sudo systemctl stop agenia-mirror-agent

sudo -u mirroragent bash -c 'set -a; . /etc/agenia-mirror-agent/agent.env; set +a; \
  cd /opt/agenia-mirror-agent && exec node dist/index.js --seed-inicial'

sudo systemctl start agenia-mirror-agent
```

> 💡 No uses la forma `env $(cat agent.env | xargs)` que aparece en
> `deploy/README.md` y en el `RUNBOOK.md`: falla con
> `env: #: No such file or directory` en cuanto el archivo tiene un comentario.

---

## 12. El día a día

```bash
systemctl status agenia-mirror-agent            # ¿vivo?
journalctl -u agenia-mirror-agent -f            # ver en directo
journalctl -u agenia-mirror-agent -n 200 --no-pager
sudo systemctl restart agenia-mirror-agent      # fuerza una reconciliación a los 2 min
```

**Actualizar el agente:** repite §3 y §7.1–7.2 y reinicia. `data/state.json`
sobrevive y el agente no vuelve a empezar de cero.

**Apagar el espejo sin tocar la VM** (☁️, reversible, no borra nada — mismo
patrón que §2.6):

```bash
ssh root@89.117.61.28 '
  cd /opt/agenia
  docker compose --env-file .env.production -f docker-compose.deploy.yml \
    exec -T postgres psql -U agenia -d antigravity -c "
      UPDATE \"HospitalMirrorConfig\" SET enabled = false
      WHERE \"organizationId\" = '"'"'<organizationId>'"'"';
    "
'
```

⚠️ **Nunca borres `/opt/agenia-mirror-agent/data/state.json` como "limpieza".**
Ese archivo es una *foto* del HIS, no una marca de tiempo: sin él, al arrancar
el agente toma una foto nueva que ya incluye lo ocurrido mientras estuvo caído,
y **no lo reporta jamás**. Una cita agendada en ventanilla durante un reinicio
se quedaría fuera de AgenIA y ese cupo se seguiría vendiendo por WhatsApp. La
reconciliación diaria lo detecta, pero tarda.

Para todo lo demás —dead-letters, discrepancias, rotación de credenciales,
desastre total— la referencia es
`docs/drivers/cnt-sanvicente-anserma/RUNBOOK.md`.

---

## 13. Relación con los otros documentos

| Documento | Para qué |
|---|---|
| **Este** | Instalar de cero. Es el que se sigue el día del despliegue |
| `deploy/README.md` | El checklist original, más breve, con el contexto de la Fase 0 y los pendientes del driver |
| `RUNBOOK.md` | **Operar** lo ya instalado: dead-letters, discrepancias, rotar credenciales, desastre total |
| `CONECTIVIDAD.md` | Por qué la arquitectura es de salida únicamente, y la evidencia de red medida en el hospital |
| `local-vm/README.md` | Ensayar este mismo despliegue contra una VM simulada, antes de estar frente a TI |

Tres erratas que hacían fallar el primer intento **ya están corregidas en
origen**, no solo esquivadas aquí — así que `deploy/README.md` y
`local-vm/provision.sh` vuelven a estar de acuerdo con este documento:

| # | Qué estaba mal | Dónde se corrigió |
|---|---|---|
| 1 | La unidad se instalaba como `mirror-agent.service` y luego se hacía `enable agenia-mirror-agent` → *Unit not found* | `deploy/README.md` §4 |
| 2 | `ExecStart=/usr/bin/node` quemado → `status=203/EXEC` si Node estaba en otra ruta | `deploy/mirror-agent.service` (ahora `/usr/bin/env node`) |
| 3 | `env $(cat agent.env \| xargs)` → `env: #: No such file or directory` | `deploy/README.md` y `RUNBOOK.md` |

Y `agent.env.example` ya no lleva comentarios al final de línea, que entraban
dentro del valor (§7.3).

---

## 14. Lo que hay que esperar, y no es un fallo

- **Eventos `SLOT` y `DOCTOR` omitidos.** Aparecen en el log como
  `evento(s) omitidos (tipo no espejado por este driver)`. Es por diseño; no
  cuentan como error ni van a dead-letter.
- **Dead-letters por actualización de asistencia.** `updateAttendance()` está
  pendiente de Fase 3 y **lanza excepción**. Cualquier edición de una cita en
  AgenIA que no sea una cancelación ni un cambio de hora acaba ahí tras 10
  intentos, y pone el semáforo del panel en rojo. Ninguna cita se pierde
  (siguen en la cola, se pueden reprocesar), pero conviene saberlo antes de
  verlo. Ver `ESTADO.md`.
- **Vas a ver muchas inasistencias, y es correcto.** El hospital tiene ~14,6 %
  de citas incumplidas (`NU_ESTA_CIT = 2`), confirmado contra su base el
  2026-09-07. El agente las sube como `NO_SHOW` y en el panel salen como
  «❌ Ausente». No es un fallo del espejo: es la tasa real, y varía mucho por
  servicio — psicología y los programas de promoción y detección temprana
  rondan el 30-45 %, los especialistas el 3-11 %.
- **`un desenlace sin significado confirmado. No se reporta.`** Si aparece esta
  línea en el journal, sí conviene mirarla: significa que el HIS usó un valor
  de estado que el driver no conoce (el catálogo del fabricante es 0/1/2/3 y
  el `3` no se usa en este hospital). No rompe nada —el agente calla en vez de
  inventar— pero es señal de que algo cambió en el HIS. Ver `ESTADO.md`.

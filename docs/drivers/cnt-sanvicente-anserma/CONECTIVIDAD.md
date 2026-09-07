# Conectividad — VPS del hospital ↔ nube AgenIA

Propuesta arquitectónica para el servidor que el Hospital San Vicente de Paúl
(Anserma) acaba de entregar. Complementa `deploy/README.md` del agente
(`apps/mirror-agent/deploy/`), que asume la conectividad ya resuelta: este
documento es cómo se resuelve.

Fecha del diagnóstico: **2026-09-04**. **Validado el mismo día desde la LAN
(§1.1) y desde el propio VPS (§1.2): los tres supuestos confirmados, cero
bloqueantes del lado del hospital.** El único pendiente es nuestro — el Caddy
del VPS de Contabo (§5).

---

## 0. El escenario entregado

| Dato | Valor |
|---|---|
| SO | Ubuntu Server 26, actualizado |
| IP | `192.168.1.175` |
| Usuario | `data`, con SSH habilitado |
| Alcance | LAN del hospital. **Sale a internet por 443** ✔ confirmado (§1.1) |
| SQL Server del HIS | `192.168.1.16:1433`, BD `PRUEBAS` |
| Nube AgenIA | Contabo `89.117.61.28` — `app.hsvpanserma.agenia.co` |
| Acceso disponible hoy | AnyDesk a una estación Windows que sí ve el SQL Server |

Lo primero que salta: **`192.168.1.175` y `192.168.1.16` están en la misma
`/24`**. El servidor nuevo nació al lado del HIS. Eso es exactamente donde tiene
que estar y elimina el problema difícil (enrutar entre dos redes) antes de
empezar.

---

## 1. Diagnóstico de red: qué se probó y qué prueba realmente

Se ejecutó desde la máquina de desarrollo, fuera de la red del hospital:

```
$ ping -c 3 192.168.1.175
3 packets transmitted, 0 packets received, 100.0% packet loss

$ nc -z -G 3 -v 192.168.1.175 22      → Operation timed out
$ nc -z -G 3 -v 192.168.1.175 1433    → Operation timed out

$ route -n get 192.168.1.175
  destination: default          ← no hay ruta específica; cae en la default
      gateway: 192.168.40.1

$ traceroute 192.168.1.175
  1  192.168.40.1        ← mi router
  2  10.247.192.1        ← CGNAT del ISP
  3  10.163.246.41
  4  10.163.246.42       ← se pierde en la red del operador

Máquina de origen: 192.168.40.4/24, IP pública 186.87.28.46
```

**El 100 % de pérdida no dice nada sobre el estado del VPS.** Dice otra cosa, y
conviene ser preciso porque cambia la solución:

`192.168.0.0/16` es espacio privado por RFC 1918. Ningún router de internet lo
enruta — se descarta por definición. El `traceroute` lo muestra literalmente:
los paquetes salieron por mi ruta por defecto hacia el ISP y murieron en su
CGNAT, porque mi máquina está en `192.168.40.0/24` y `192.168.1.175` ni siquiera
existe en su tabla de rutas.

La consecuencia importante: **esto no es un firewall que TI pueda abrir.** No
hay regla, ni puerto, ni permiso que haga alcanzable una IP privada desde
internet. Cualquier propuesta que empiece por "que nos den acceso a
`192.168.1.175`" es un camino cerrado. La dirección tiene que cambiar de sentido.

*(Lo que el diagnóstico deja sin responder — si el VPS está encendido, si el
firewall del hospital deja salir 443 — se resuelve en §4, desde dentro de su red.)*

---

## 1.1 Resultado de la validación desde la LAN (2026-09-04)

Ejecutado en la estación Windows por AnyDesk (`192.168.1.25`, gateway
`192.168.1.1` — misma `/24` que el VPS y el HIS).

| Prueba | Resultado | Lectura |
|---|---|---|
| `ping 192.168.1.175` | 0 % pérdida, `TTL=64`, `<1ms` | **VPS vivo.** TTL sin decrementar ⇒ mismo segmento L2, sin router de por medio; 64 es el default de Linux, coherente con Ubuntu |
| `192.168.1.175:22` | `TcpTestSucceeded : True` | **SSH accesible** desde la LAN |
| `192.168.1.16:1433` | `TcpTestSucceeded : True` | El HIS responde donde creíamos |
| `app.hsvpanserma.agenia.co:443` | `True`, `RemoteAddress 89.117.61.28` | **Hay salida a internet.** DNS resuelve a nuestro VPS |
| `netsh winhttp show proxy` | `Acceso directo (sin servidor proxy)` | Sin proxy corporativo configurado |
| `curl.exe -sI https://…` | `HTTP/1.1 200 OK` + `Via: 1.1 Caddy` | La cadena TLS llegó **intacta hasta nuestro Caddy** |

**No hace falta pedirle nada a TI.** La regla de firewall de §7.1 ya está
concedida de hecho: el perímetro deja salir 443. Y como `curl` devolvió 200 sin
`-k`, el certificado validó contra el almacén de Windows — con `winhttp` en
acceso directo, la interceptación TLS es improbable.

*(La salvedad que quedaba —que todo se midió desde una estación Windows y no
desde el propio VPS— se cerró el mismo día. Ver §1.2.)*

---

## 1.2 Confirmado desde el propio VPS (2026-09-04)

Sesión SSH real contra `data@192.168.1.175`. Esto es lo que convierte la
evidencia de §1.1 en prueba.

| Prueba | Resultado | Cierra |
|---|---|---|
| `nc -zv 192.168.1.16 1433` | `succeeded!` | **El VPS alcanza el HIS.** No hay VLAN de por medio |
| `curl -sI https://app.hsvpanserma.agenia.co` | `HTTP/2 200` | **El VPS sale a internet** por su cuenta |
| `curl -sv … \| grep issuer` | `issuer: C=US; O=Let's Encrypt; CN=YE2` | **No hay interceptación TLS** |
| `subjectAltName` | `matches cert's "app.hsvpanserma.agenia.co"` | El certificado es el nuestro, sin sustituir |

**El `issuer` es la línea que importa.** Un proxy con inspección TLS habría
puesto ahí el nombre de la CA del hospital; puso Let's Encrypt. Y lo dijo
**`curl` sobre Linux**, validando contra el almacén del sistema de un Ubuntu
recién instalado que no tiene ninguna CA corporativa añadida. Dos señales de
refuerzo: negoció **HTTP/2** (un interceptor casi siempre degrada a HTTP/1.1) y
el `subjectAltName` coincide.

⇒ **`NODE_EXTRA_CA_CERTS` no hace falta.** El riesgo que más preocupaba queda
descartado con prueba, no con inferencia.

### Inventario de la máquina

| Dato | Valor | Contra lo pedido |
|---|---|---|
| SO | Ubuntu **26.04.1 LTS** (`resolute`), kernel 7.0.0-31 | Se pidió 22.04/24.04 — ver §6 |
| Hostname | `vps-citas` | — |
| Interfaz | `ens18` (virtio ⇒ es una VM, probablemente Proxmox) | Permite snapshot antes de tocar nada |
| RAM | 7,2 GiB (4 % en uso) + 4 GiB swap | Se pidieron 4 GB ✔ holgado |
| Disco | 196 GB, 5 % usado, **179 GB libres** | Se pidieron 30 GB ✔ holgado |
| `sudo -l` para `data` | `(ALL : ALL) ALL` | ✔ sudo completo |
| Node | **no instalado** | Partimos de cero — §6 |

> 🔎 **Un detalle que conviene registrar:** el banner de login dice
> `Last login: Fri Sep 4 15:52:40 2026 from 192.168.1.16`. Alguien entró a este
> VPS **desde el propio servidor del HIS**. Lo más probable es que sea TI del
> hospital, que lo aprovisionó desde ahí. No es un problema, pero significa que
> el VPS no es exclusivamente nuestro: conviene saber quién más tiene llave
> antes de dejar credenciales de `agenia_sync` en `/etc/agenia-mirror-agent/`.

---

## 2. La pregunta está al revés

> *"¿Cómo AgenIA se conecta desde la web hacia ese VPS interno?"*

**No se conecta. Nunca.** Y no es una limitación que se sufre: es la decisión de
arquitectura que ya tomó el proyecto en `PLAN_ESPEJO_HOSPITAL.md` §4.1, donde se
evaluaron cuatro opciones y ganó la D — *agente local con conexiones únicamente
salientes HTTPS 443*. El runbook del driver lo dice en una línea:

> El diseño es de salida únicamente: la nube nunca abre una conexión hacia el
> hospital. Si alguien pide "abrir un puerto para AgenIA", la respuesta es que
> no hace falta.

El VPS `192.168.1.175` no es un servidor al que se le hablan peticiones. Es un
**cliente** que sale a buscarlas. Cada 5 segundos pregunta *"¿hay algo para
mí?"*, y cuando el HIS cambia, empuja el cambio hacia arriba.

Esto no es un rodeo. Es estrictamente mejor:

| | Abrir el VPS a internet | Agente saliente (elegido) |
|---|---|---|
| Puertos entrantes en el hospital | Al menos uno | **Cero** |
| Si cambia la IP pública del hospital | Se rompe | Indiferente |
| NAT / CGNAT del operador | Hay que atravesarlo | Irrelevante, es tráfico saliente |
| Superficie de ataque en la LAN clínica | Un servicio expuesto junto al HIS | Ninguna |
| Aprobación de TI | Comité, excepción, justificación | La misma regla que ya tiene cualquier PC |

El último punto es el que decide en la práctica. Pedirle a un hospital que
publique un host de la misma subred que su HIS es una conversación que puede
tardar meses y terminar en no. Pedirle que un servidor pueda navegar a un
dominio por HTTPS es lo que ya hacen todos sus equipos.

---

## 3. Topología propuesta

```
  LAN del hospital — 192.168.1.0/24                    Internet
 ┌──────────────────────────────────────────┐
 │                                          │
 │  ┌────────────────────────┐              │
 │  │ SQL Server del HIS     │              │
 │  │ 192.168.1.16:1433      │              │
 │  │ BD: PRUEBAS → ESEHSVP  │              │
 │  └───────────▲────────────┘              │
 │              │ T-SQL 1433                │
 │              │ (dentro de la LAN,        │
 │              │  usuario agenia_sync,     │
 │              │  mínimo privilegio)       │
 │  ┌───────────┴────────────┐              │
 │  │ VPS  192.168.1.175     │              │
 │  │ Ubuntu Server 26       │              │
 │  │ systemd:               │              │
 │  │  agenia-mirror-agent   │──────────────┼───► HTTPS 443 SALIENTE ───┐
 │  │ usuario: mirroragent   │              │     (única salida)        │
 │  └────────────────────────┘              │                           │
 │                                          │                           │
 │  ✗ sin puertos entrantes                 │                           ▼
 │  ✗ sin VPN productiva                    │        ┌──────────────────────────────┐
 │  ✗ sin IP pública                        │        │ Nube AgenIA — 89.117.61.28   │
 └──────────────────────────────────────────┘        │ app.hsvpanserma.agenia.co    │
                                                     │                              │
                                                     │  Caddy ──► api (NestJS)      │
                                                     │            /api/mirror/*     │
                                                     │              │               │
                                                     │            Postgres          │
                                                     │      SyncOutbox / SyncInbox  │
                                                     └──────────────────────────────┘
```

### Las tres conversaciones

| # | Origen → Destino | Puerto | Sentido |
|---|---|---|---|
| 1 | `192.168.1.175` → `192.168.1.16` | 1433/TCP | Interno a la LAN. Nunca sale del hospital. |
| 2 | `192.168.1.175` → `app.hsvpanserma.agenia.co` | 443/TCP | **Saliente**. Único cruce del perímetro. |
| 3 | Nube → hospital | — | **No existe.** |

### Endpoints que consume el agente

Todos bajo `https://app.hsvpanserma.agenia.co/api/mirror/*`, autenticados con
`Authorization: Bearer <MIRROR_AGENT_TOKEN>`:

| Ruta | Para qué |
|---|---|
| `POST /mirror/handshake` | Al arrancar: se identifica y recibe su `driverConfig` |
| `GET /mirror/events` | Cada 5 s: baja lo que AgenIA agendó por WhatsApp |
| `POST /mirror/ack` | Confirma lo aplicado en el HIS |
| `POST /mirror/changes` | Sube lo que cambió en el HIS (ventanilla, cancelaciones) |
| `POST /mirror/heartbeat` | Cada 60 s: latido para el panel |
| `POST /mirror/reconcile` | Diario: foto completa contra la agenda de AgenIA |
| `POST /mirror/availability` | Turnos médicos → cupos |
| `POST /mirror/catalog` | Catálogos (médicos, servicios, EPS) |

Son ocho rutas, un solo host, un solo puerto. `GET /mirror/events` responde de
inmediato (el servidor no mantiene la conexión abierta), así que **no hay
conexiones largas que un proxy corporativo pueda cortar** — una preocupación
razonable que en este diseño no aplica.

---

## 4. Los tres supuestos que hay que validar

Toda la propuesta descansa en tres cosas que todavía no están comprobadas. Las
tres se validan desde dentro de la red del hospital, y hoy tenemos AnyDesk a una
estación Windows que ya ve el SQL Server. Con eso alcanza.

### 4.1 En la estación Windows (AnyDesk) — PowerShell

```powershell
# ── Contexto: ¿esta estación está en la misma /24 que el VPS y el HIS?
ipconfig | Select-String "IPv4|Puerta|Gateway"

# ── A. ¿El VPS existe y responde?
ping 192.168.1.175
Test-NetConnection 192.168.1.175 -Port 22        # SSH: debe dar TcpTestSucceeded True

# ── B. ¿El HIS sigue donde creemos?
Test-NetConnection 192.168.1.16 -Port 1433

# ── C. LA PREGUNTA CRÍTICA: ¿esta red deja salir HTTPS hacia la nube AgenIA?
Test-NetConnection app.hsvpanserma.agenia.co -Port 443
curl.exe -sI https://app.hsvpanserma.agenia.co | Select-Object -First 1

# ── D. ¿Hay proxy corporativo o interceptación TLS? (ver §7.2)
netsh winhttp show proxy
curl.exe -vI https://app.hsvpanserma.agenia.co 2>&1 | Select-String "issuer|subject|proxy"
```

**Cómo leer el resultado de C y D:**

| Resultado | Significado | Qué sigue |
|---|---|---|
| `TcpTestSucceeded: True` y `HTTP/2 200` | Salida limpia | Camino despejado, seguir a §9 |
| Conecta, pero el `issuer` **no** es Let's Encrypt | Proxy con interceptación TLS | Hace falta `NODE_EXTRA_CA_CERTS` (§7.2) |
| `TcpTestSucceeded: False` | El firewall bloquea la salida | Pedir la regla de §7.1 — es el único permiso necesario |

> El resultado de **D** hay que mirarlo aunque C salga en verde. La
> interceptación TLS es habitual en redes hospitalarias y **no** rompe el
> navegador de la estación Windows (Windows confía en la CA corporativa), pero
> **sí** rompe al agente: Node trae su propio almacén de certificados compilado
> y no mira el del sistema. El síntoma sería
> `UNABLE_TO_VERIFY_LEAF_SIGNATURE` y ya nos costó descubrirlo una vez en la VM
> simulada.

### 4.2 Ya dentro del VPS

Si **A** salió bien, desde la misma estación Windows:

```powershell
ssh data@192.168.1.175
```

Y allí, las tres preguntas que deciden todo:

```bash
# ¿Dónde está parado?
ip -4 addr show; ip route

# ¿Alcanza el HIS? (el motivo por el que existe este servidor)
nc -zv 192.168.1.16 1433

# ¿Sale a la nube? (el otro motivo)
curl -sI https://app.hsvpanserma.agenia.co | head -1
curl -sv https://app.hsvpanserma.agenia.co 2>&1 | grep -E "issuer|subject"

# Contexto para el instalador
lsb_release -a; sudo -l; free -h; df -h /; nproc
```

> Que la estación Windows alcance el SQL Server **no garantiza** que el VPS
> también. Muchos hospitales segmentan por VLAN y el HIS solo acepta rangos
> concretos. `nc -zv 192.168.1.16 1433` desde el VPS es la única prueba que
> vale, y es la primera que hay que correr.

### 4.3 Si el VPS no responde al ping desde la Windows

Entonces el problema es local del hospital y hay tres causas por orden de
probabilidad: el servidor está apagado, `ufw` viene activo por defecto bloqueando
todo lo entrante (Ubuntu Server 26 recién instalado), o está en otra VLAN. Se
resuelve en consola física o por AnyDesk contra el propio VPS, no desde afuera.

---

## 5. Bloqueante: el proxy devolvía 404 en `/api/mirror/*` — RESUELTO

Revisando `deploy/install-vps.sh:641-651`, el Caddyfile que genera el
instalador publica **una sola ruta** de la API y responde 404 a todo lo demás:

```caddy
handle /api/chatbot/webhook* {
    uri strip_prefix /api
    reverse_proxy api:3000
}

# 404 (no 403) para no confirmar qué endpoints hay detrás.
handle /api/* {
    respond "Not Found" 404
}
```

Fue una decisión deliberada y buena — pasa de ~19 controladores expuestos a uno.
Pero se tomó **antes** de que existiera el agente espejo, y hoy `/api/mirror/*`
cae en ese `handle /api/*`. Tal como está instalado el VPS de producción,
**el agente fallaría el handshake con un 404** y el mensaje no diría por qué.

Es el tipo de fallo que cuesta una tarde frente a TI del hospital.

**Corregido el 2026-09-04** en `deploy/install-vps.sh`, en las **tres** variantes
que genera el instalador (`single`, `http` y dos dominios — se había pasado por
alto que eran tres). El bloque añadido:

```caddy
# ── Agente espejo del hospital (mirror-agent) ───────────────────────
# Sale de la LAN del hospital por HTTPS; es la única vía por la que
# entra y sale el espejo del HIS. Protegido por MirrorAgentGuard
# (Bearer token por organización), no por el proxy.
handle /api/mirror* {
    uri strip_prefix /api
    reverse_proxy api:3000
}
```

Va **antes** del `handle /api/*` que responde 404 y después del bloque del
webhook (en la variante de dos dominios es `handle /mirror*`, sin el prefijo
`/api`, porque ya cuelga de `DOMAIN_API`). Luego `agenia restart caddy` — Caddy
solo lee su configuración al arrancar.

### Verificado, no solo escrito

Los tres Caddyfiles generados pasan `caddy validate`, y el enrutamiento se probó
levantando Caddy real contra backends de prueba:

| Petición | Resultado | Lo que recibe la API |
|---|---|---|
| `POST /api/mirror/handshake` | `200` | `/mirror/handshake` |
| `GET /api/mirror/events` | `200` | `/mirror/events` |
| `POST /api/mirror/ack` | `200` | `/mirror/ack` |
| `GET /api/chatbot/webhook` | `200` | `/chatbot/webhook` |
| `GET /api/patients` | `404` | — lo corta Caddy |
| `GET /api/organizations` | `404` | — lo corta Caddy |
| `GET /` y `/dashboard` | `200` | → panel Next.js |

El `uri strip_prefix /api` reescribe la ruta a lo que espera
`@Controller('mirror')`, y el muro de 404 sigue intacto para todo lo demás.

**Falta un paso:** esto arregla el *instalador*. El VPS de producción ya
desplegado tiene el Caddyfile viejo — hay que aplicarle el bloque a mano en
`/opt/agenia/deploy/Caddyfile` y reiniciar Caddy.

Con eso, en el `.env` del agente:

```
MIRROR_API_URL=https://app.hsvpanserma.agenia.co/api
```

Sin barra final. El cliente la normaliza igual
(`mirror-api-client.ts:80`), pero conviene no depender de eso.

**Verificación desde cualquier máquina, antes de tocar el hospital** — debe dar
`401`, no `404`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://app.hsvpanserma.agenia.co/api/mirror/handshake

# 404 → Caddy sigue bloqueando: falta el bloque de arriba
# 401 → la ruta llega a la API y el guard rechaza el token vacío. Correcto.
```

Ese `401` es la señal de que el camino completo funciona: internet → Caddy →
NestJS → guard.

---

## 6. Ubuntu Server 26 y la versión de Node — RESUELTO

`apps/mirror-agent/deploy/README.md` §1 instala **Node 20**, y las specs que se
le pidieron al hospital (`CORREO_PRUEBA_HIS.md`) decían Ubuntu 22.04/24.04. Nos
entregaron 26. Dos consecuencias:

1. **Node 20 entró en fin de vida en abril de 2026.** Instalar hoy un runtime sin
   parches de seguridad, en la misma subred que el HIS de un hospital, es
   exactamente lo que no queremos defender ante su comité de TI.
2. El repositorio de NodeSource para `setup_20.x` puede no tener paquetes
   compilados para el nombre en clave de 26.04.

**Recomendación: Node 22 LTS**, que es lo que ya usa el CI
(`.github/workflows/ci.yml:51`). Mismo runtime en build y en producción, sin
sorpresas. El bundle de esbuild apunta a `--target=node20`, que es sintaxis de
salida: corre sin cambios sobre 22 o 24.

```bash
# Sustituye a §1 del deploy/README.md del agente
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v22.x
```

**Confirmado en la máquina (§1.2):** Ubuntu **26.04.1 LTS**, codename
`resolute`, y `node` no está instalado. Partimos de cero, así que la vía se
elige ahora y no se hereda nada.

`resolute` es un codename nuevo, y NodeSource tarda en publicar para las
releases recientes. Antes de correr su script conviene mirar qué ofrece el
propio Ubuntu:

```bash
apt-cache policy nodejs
```

| Si Ubuntu 26.04 trae… | Hacer |
|---|---|
| Node **≥ 22** | `sudo apt install -y nodejs` — **preferido**. Paquete de distribución, parches por `apt`, y un repo de terceros menos que justificarle a TI del hospital |
| Node < 22, o NodeSource sin `resolute` | Tarball oficial de nodejs.org en `/usr/local` — versión fija, sin depender de repos |

```bash
# Plan B: tarball oficial, si el paquete de Ubuntu se queda corto
VER=v22.20.0
curl -fsSLO https://nodejs.org/dist/$VER/node-$VER-linux-x64.tar.xz
sudo tar -xJf node-$VER-linux-x64.tar.xz -C /usr/local --strip-components=1 \
  --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
node -v
```

### ✅ Resuelto por la vía buena (2026-09-04)

Ubuntu 26.04 trae **Node 22.22.1** en `resolute/universe`:

```
Candidato: 22.22.1+dfsg+~cs22.19.15-1ubuntu1
```

Instalado con `sudo apt install -y nodejs`. No hizo falta NodeSource ni el
tarball: es paquete de distribución, con parches por `apt` y **sin ningún repo
de terceros que justificarle a TI del hospital**. El plan B queda documentado
arriba por si el siguiente cliente llega con una distro más pobre.

**`npm` no se instaló, y es correcto.** El agente se despliega como un bundle
único de esbuild (`dist/agent.bundle.js`) construido en nuestra máquina: en la
VM solo hace falta el *runtime*. Instalar `npm` ahí sería superficie extra sin
ninguna función.

### ⚠️ Una trampa que dejó abierta esta vía

`apps/mirror-agent/deploy/mirror-agent.service` tiene la ruta del intérprete
quemada:

```ini
ExecStart=/usr/bin/node /opt/agenia-mirror-agent/dist/index.js
```

El paquete de Debian/Ubuntu instala el binario como **`/usr/bin/nodejs`**, y
durante la instalación se vio `update-alternatives` registrando precisamente esa
ruta. Si `/usr/bin/node` no existe, la unidad no arranca y systemd reporta
`status=203/EXEC` — un error que no menciona a Node por ninguna parte.

Verificar **antes** de instalar el servicio:

```bash
command -v node; command -v nodejs; ls -l /usr/bin/node /usr/bin/nodejs
```

| Resultado | Acción |
|---|---|
| `/usr/bin/node` existe | Nada. La unidad funciona tal cual |
| Solo existe `/usr/bin/nodejs` | `sudo ln -s /usr/bin/nodejs /usr/bin/node`, **o** cambiar el `ExecStart` a `/usr/bin/env node …` (systemd lo acepta: `/usr/bin/env` es ruta absoluta) |

✅ **Corregido el 2026-09-04** en `apps/mirror-agent/deploy/README.md`: §1 instala
Node 22, la nota de specs advierte que entregaron Ubuntu 26, y §0 apunta a este
documento.

### Sobre el usuario `data`

`data` es la cuenta administrativa: la que usa SSH y `sudo` durante la
instalación. **El agente no corre con ella.** El runbook crea un usuario de
sistema `mirroragent` sin shell (`/usr/sbin/nologin`), dueño de
`/opt/agenia-mirror-agent`, y la unidad systemd lo endurece con
`ProtectSystem=strict`, `NoNewPrivileges` y un único directorio escribible
(`data/`, donde vive el cursor de sincronización). Eso se mantiene igual.

---

## 7. Lo que hay que pedirle a TI del hospital

### 7.1 Una regla de firewall. Una.

| Campo | Valor |
|---|---|
| Origen | `192.168.1.175` (VPS AgenIA) |
| Destino | `app.hsvpanserma.agenia.co` → `89.117.61.28` |
| Puerto | `443/TCP` |
| Sentido | **Saliente** |
| Entrantes | **Ninguno.** No se solicita ningún puerto entrante, NAT, ni IP pública. |

Y confirmar que `192.168.1.175` alcanza `192.168.1.16:1433` dentro de la LAN
(§4.2) — si hay VLANs de por medio, esto puede necesitar una regla interna.

Conviene decirlo explícitamente en la solicitud: **no se pide exponer nada.** Es
la diferencia entre un trámite de media hora y un comité.

### 7.2 Dos preguntas

1. **¿Hay proxy corporativo o inspección TLS a la salida?** Si la respuesta es
   sí, necesitamos el archivo `.crt` de su CA. Se instala en el sistema **y**
   además se declara en el `.env` del agente, porque Node ignora el almacén del
   sistema:

   ```
   NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/<ca-del-hospital>.crt
   ```

   Si además el proxy es explícito (no transparente), hay que añadir
   `HTTPS_PROXY` al `EnvironmentFile` de la unidad systemd.

2. **¿`192.168.1.175` es fija o reserva DHCP?** Al agente le da igual: no
   depende de su propia IP para nada, porque solo abre conexiones salientes —
   una propiedad agradable de este diseño. Pero si se mueve, **nuestro acceso
   por SSH se rompe**. Pedir reserva por MAC.

---

## 8. Acceso operativo: el otro problema, y por qué se separa

Resuelto el canal de datos, queda una necesidad distinta: **nosotros** entrando
al VPS para desplegar, mirar el `journalctl` y diagnosticar. Hoy eso depende de
AnyDesk sobre una estación Windows compartida, que no escala y no deja rastro.

`PLAN_ESPEJO_HOSPITAL.md` §9 ya fija la regla: *"herramientas tipo Tailscale
para soporte técnico remoto nuestro, **siempre separado del canal de datos
productivo**"*. Es decir — Tailscale sí, pero para el operador, jamás como
transporte del espejo. Si un día Tailscale se cae, el hospital sigue
sincronizando; solo perdemos comodidad.

| Opción | Veredicto |
|---|---|
| **AnyDesk sobre la Windows** (hoy) | Suficiente para instalar y validar. No escala, no audita, depende de que alguien deje la estación encendida. |
| **Tailscale / WireGuard en el VPS** ✅ | Recomendado apenas TI lo autorice. También saliente (UDP 41641 con fallback a 443/TCP), sin puertos entrantes. SSH directo desde nuestra máquina. |
| **Port forwarding hacia el 22** | ❌ Descartado. Publicar SSH de un host vecino al HIS es justo lo que la arquitectura evita. |

Orden práctico: **instalar con AnyDesk, y en la misma sesión dejar Tailscale
puesto** para no volver a depender de que haya alguien del otro lado.

```bash
# En el VPS, durante la instalación
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname=hsvp-anserma-mirror --accept-routes=false
```

`--accept-routes=false` es deliberado: el VPS se une a nuestra red de soporte
pero **no** expone la LAN del hospital hacia ella. La malla sirve para entrar al
servidor, no para alcanzar el HIS.

---

## 9. Orden de ejecución

| # | Paso | Dónde | Estado |
|---|---|---|---|
| 1 | Correr §4.1 (A, B, C, D) | Windows por AnyDesk | ✅ **hecho** — §1.1 |
| 2 | Publicar `/api/mirror*` en el instalador | repo | ✅ **hecho** — 3 variantes, validadas |
| 3 | Node 22 en el runbook del agente | repo | ✅ **hecho** |
| 4 | Aplicar el bloque de Caddy al VPS **ya desplegado** + `agenia restart caddy` | VPS Contabo | ⏳ **siguiente** |
| 5 | Verificar que el handshake da **401** y no 404 | cualquier máquina | ⏳ tras el 4 |
| 6 | SSH al VPS del hospital y correr §4.2 | `data@192.168.1.175` | ✅ **hecho** — §1.2, todo verde |
| 7 | Elegir vía de Node (§6), instalar + usuario `mirroragent` + directorios | VPS hospital | ⏳ **siguiente** |
| 7.5 | **Provisionar el `HospitalMirrorConfig`** y anotar el token (se imprime UNA vez) | nuestra máquina | ⏳ requisito del 8 |
| 8 | Bundle, `.env` (0600), unidad systemd, `enable --now` | VPS hospital | — |
| 9 | Verificación de `deploy/README.md` §5: handshake, `healthCheck`, latido, panel en verde | ambos lados | — |
| 10 | Tailscale para soporte | VPS hospital | — |

**Ya no hay nada que esperar de TI del hospital, ni ninguna incógnita de red.**
La regla de salida que §7.1 iba a solicitar resultó estar concedida (§1.1), y el
propio VPS confirmó que alcanza el HIS y sale a internet con TLS limpio (§1.2).

Queda una sola cosa nuestra antes de instalar el agente: el paso 4, el Caddy del
VPS de Contabo. Es independiente del hospital y se puede hacer ahora.

### El paso 7.5: de dónde sale el token del agente

`MIRROR_AGENT_TOKEN` no se inventa — lo emite el script de aprovisionamiento, que
crea la fila `HospitalMirrorConfig`, cifra el `driverConfig` con AES-256-GCM y
**muestra el token una única vez** (en la base solo queda su hash SHA-256):

```bash
AGENIA_SYNC_PASSWORD='<la de AGENIA_SYNC_SETUP.sql>' \
MIRROR_HIS_TARGET=hospital \
ORGANIZATION_ID='<uuid de la org>' \
  pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts
```

`MIRROR_HIS_TARGET=hospital` es lo que apunta el `driverConfig` a
`192.168.1.16:1433 / PRUEBAS / agenia_sync` en vez del mock local. Sin
`ORGANIZATION_ID` el script lista las organizaciones disponibles y sale, que es
la forma cómoda de averiguar el uuid.

**Requisito previo:** tener la contraseña de `agenia_sync`, es decir, haber
corrido `AGENIA_SYNC_SETUP.sql` contra la BD del hospital.

Lo que **no** cambia: el driver ya está implementado y probado punta a punta
contra la VM simulada (`apps/mirror-agent/local-vm/`). Nada de esto toca código
del agente — es configuración de red, proxy y despliegue.

---

## 10. Riesgos

Recalibrados tras la validación de §1.1 y las correcciones de §5 y §6.

| Riesgo | Probabilidad | Impacto | Estado |
|---|---|---|---|
| ~~El VPS no alcanza `192.168.1.16:1433`~~ | — | — | ✅ **descartado** — `nc` succeeded desde el VPS (§1.2) |
| ~~Node ignora una CA corporativa~~ | — | — | ✅ **descartado** — `issuer: O=Let's Encrypt` desde el propio VPS (§1.2) |
| Olvidar el Caddy del VPS **ya desplegado** | Media | Bloqueante total | 🔴 **abierto — el único bloqueante que queda.** El instalador ya está corregido; el VPS vivo no. Paso 4 de §9 |
| AnyDesk como única vía de acceso | Alta | Cada intervención depende de terceros | 🟠 **abierto** — Tailscale en la misma sesión (§8) |
| El HIS (`192.168.1.16`) tiene SSH hacia el VPS | Confirmada | El VPS no es solo nuestro | 🟡 **nuevo** — visto en el banner de login (§1.2). Saber quién más tiene llave antes de dejar credenciales en `/etc/agenia-mirror-agent/` |
| ~~NodeSource sin paquete para `resolute`~~ | — | — | ✅ **evitado** — Ubuntu 26.04 trae Node 22.22.1 en `universe` (§6) |
| La unidad systemd apunta a `/usr/bin/node` y el paquete instala `/usr/bin/nodejs` | Media | El servicio no arranca: `status=203/EXEC`, sin mencionar Node | 🟠 **abierto** — un `command -v node` antes de instalar el servicio (§6) |
| La IP del VPS se mueve por DHCP | Baja | Perdemos SSH; el espejo **sigue** | 🟡 pedir reserva por MAC (§7.2) |
| ~~El firewall no deja salir 443~~ | — | — | ✅ **descartado** — §1.1 |
| ~~Caddy devuelve 404 en `/mirror/*`~~ | — | — | ✅ **cerrado** — §5 |
| ~~Node 20 en fin de vida~~ | — | — | ✅ **cerrado** — §6 |

---

## Resumen en cuatro frases

`192.168.1.175` no será alcanzable desde internet, y no hace falta que lo sea:
es una IP privada y ningún permiso cambia eso. El VPS no recibe conexiones — las
abre, siempre salientes por HTTPS 443, que es la arquitectura que el proyecto ya
eligió y el driver ya implementa. La validación confirmó los tres supuestos, primero
desde la LAN y después desde el propio VPS: alcanza el HIS, sale a internet, y el
certificado que ve es el nuestro emitido por Let's Encrypt — sin proxy que
intercepte. **No hay nada que pedirle a TI del hospital.** Los dos bloqueantes
eran nuestros y están cerrados en el repo. Queda **una sola cosa** antes de
instalar el agente: aplicar el bloque de Caddy al VPS de Contabo que ya está
desplegado, porque el instalador corregido no toca lo que ya corre.

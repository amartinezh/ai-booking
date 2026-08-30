#!/usr/bin/env bash
# =============================================================================
# scripts/down.sh — Detecta y baja todo el stack local de AgenIA.
#
# Estrategia en tres capas (de la más precisa a la más amplia):
#
#   1. Manifiesto  .local/run/manifest.tsv que escribe up.sh: pids exactos y
#      contenedores exactos que se levantaron en esta máquina.
#   2. Autodescubrimiento: procesos de node/pnpm cuyo cwd cuelga de ESTE repo
#      (nest --watch, next dev/next-server, mirror-agent, ngrok del túnel) y
#      servicios de docker-compose.yml que estén corriendo. Cubre el caso de
#      un manifiesto perdido, procesos huérfanos o arrancados a mano.
#   3. Puertos (solo con --all): cualquier proceso escuchando en 3000/3001/etc,
#      lo haya levantado up.sh o no.
#
# A cada proceso se le baja el árbol completo (pnpm → nest/next → node): matar
# solo el padre deja huérfanos que siguen ocupando el puerto. SIGTERM primero,
# SIGKILL si no muere en $GRACE segundos.
#
# Uso:  ./scripts/down.sh [opciones]      ./scripts/down.sh --help
# =============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_ROOT/.local/run"
MANIFEST="$RUN_DIR/manifest.tsv"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
NGROK_PORT="${NGROK_PORT:-4040}"
GRACE="${GRACE:-10}"

# --- flags -------------------------------------------------------------------
FORCE=0          # SIGKILL directo, sin periodo de gracia
KEEP_DOCKER=0    # no tocar contenedores
DOCKER_ONLY=0    # solo contenedores
REMOVE=0         # docker compose down (elimina contenedores)
VOLUMES=0        # docker compose down -v (BORRA DATOS)
ALL=0            # barrer también por puerto, sin exigir que lo levantara up.sh
REGISTERED_ONLY=0 # solo lo del manifiesto: ni autodescubrimiento ni barrido de puertos
DRY_RUN=0
ASSUME_YES=0

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

step() { printf '\n%s▸ %s%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
act()  { # describe una acción respetando --dry-run
  if [ "$DRY_RUN" -eq 1 ]; then printf '  %s[dry-run]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; return 1; fi
  return 0
}

usage() {
  cat <<'EOF'
down.sh — detecta y detiene todo lo que ./scripts/up.sh dejó corriendo en local.

Uso: ./scripts/down.sh [opciones]

Por defecto: mata API, WEB, mirror-agent y el túnel ngrok registrados (con todo
su árbol de procesos) y DETIENE los contenedores de docker-compose.yml sin
borrarlos — los datos de postgres/redis se conservan y el próximo up.sh es rápido.

Opciones:
  --registered-only
                  Baja SOLO lo anotado en el manifiesto: sin autodescubrimiento
                  ni barrido de puertos. Útil cuando en la misma máquina corren
                  otras instancias del repo que no quieres tocar.
  --all           Además de lo registrado, mata cualquier proceso que escuche en
                  los puertos del stack (3000/3001/4040) aunque up.sh no lo haya
                  levantado. Úsalo cuando quedaron huérfanos de una sesión vieja.
  --force         SIGKILL directo, sin esperar el cierre ordenado.
  --keep-docker   No toca los contenedores (solo baja los procesos de node).
  --docker-only   Solo baja los contenedores (deja API/WEB corriendo).
  --rm            Además de detener, elimina los contenedores (docker rm).
                  Los volúmenes (datos) se conservan.
  --volumes       Elimina contenedores Y VOLÚMENES (los resuelve por inspect,
                  no por nombre de proyecto). ⚠️  BORRA la base de datos local.
                  Lista lo que va a borrar y pide confirmación escrita.
  --dry-run       Muestra qué se haría, sin matar ni detener nada.
  -y, --yes       No pregunta en las acciones destructivas.
  -h, --help      Esta ayuda.

Variables: API_PORT (3001), WEB_PORT (3000), NGROK_PORT (4040), GRACE (10s).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --all)             ALL=1 ;;
    --registered-only) REGISTERED_ONLY=1 ;;
    --force)       FORCE=1 ;;
    --keep-docker) KEEP_DOCKER=1 ;;
    --docker-only) DOCKER_ONLY=1 ;;
    --rm)          REMOVE=1 ;;
    --volumes|-v)  REMOVE=1; VOLUMES=1 ;;
    --dry-run)     DRY_RUN=1 ;;
    -y|--yes)      ASSUME_YES=1 ;;
    -h|--help)     usage; exit 0 ;;
    *)             err "Opción desconocida: $1"; echo; usage; exit 2 ;;
  esac
  shift
done

have() { command -v "$1" >/dev/null 2>&1; }
port_pids() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u; }

proc_cwd() {
  local pid="$1"
  if [ -r "/proc/$pid/cwd" ]; then
    readlink "/proc/$pid/cwd" 2>/dev/null
  elif have lsof; then
    lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
  fi
}

proc_cmd() { ps -o command= -p "$1" 2>/dev/null | head -1; }

# `ps` devuelve rutas absolutas larguísimas (nvm, node_modules) que al truncar
# no dicen nada. Deja el binario en basename y el repo como './'.
short_cmd() {
  proc_cmd "$1" | sed -e "s|$REPO_ROOT/|./|g" -e 's|^/[^ ]*/||' | cut -c1-88
}

# --- docker: se opera por NOMBRE DE CONTENEDOR, no por proyecto de compose ----
# docker-compose.yml fija `container_name:`. Este repo se llamó `antigravity`
# antes que `agen-ia`, así que hay contenedores vivos bajo el proyecto viejo:
# `docker compose stop` (proyecto `agen-ia`) no los vería. `docker stop <nombre>`
# sí, sin importar bajo qué proyecto se crearon.
COMPOSE_CONFIG_CACHE=""
compose_config() {
  if [ -z "$COMPOSE_CONFIG_CACHE" ]; then
    COMPOSE_CONFIG_CACHE="$(docker compose -f "$COMPOSE_FILE" config 2>/dev/null)"
  fi
  printf '%s\n' "$COMPOSE_CONFIG_CACHE"
}

compose_services() {
  compose_config | awk '
    /^[a-zA-Z]/                     { insvc = ($1 == "services:"); next }
    insvc && /^  [a-zA-Z0-9_.-]+:$/ { s = $1; sub(/:$/, "", s); print s }
  '
}

container_name_for() {
  compose_config | awk -v svc="$1" '
    /^[a-zA-Z]/                     { insvc = ($1 == "services:"); next }
    insvc && /^  [a-zA-Z0-9_.-]+:$/ { cur = $1; sub(/:$/, "", cur) }
    insvc && cur == svc && $1 == "container_name:" { print $2; exit }
  '
}

container_state() { docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null; }

container_volumes() {
  docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' "$1" 2>/dev/null
}

# ¿El proceso pertenece a este repo? Evita matar el `next dev` de otro proyecto.
belongs_to_repo() {
  local pid="$1" cwd cmd
  cwd="$(proc_cwd "$pid")"
  case "$cwd" in "$REPO_ROOT"|"$REPO_ROOT"/*) return 0 ;; esac
  cmd="$(proc_cmd "$pid")"
  case "$cmd" in *"$REPO_ROOT"*) return 0 ;; esac
  return 1
}

KILLED_COUNT=0
KILLED_PIDS=""

collect_tree() { # imprime pid + descendientes, hijos antes que padres
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do collect_tree "$child"; done
  echo "$pid"
}

stop_pid() { # stop_pid <pid> <etiqueta>
  local pid="$1" label="$2" tree p alive

  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  case " $KILLED_PIDS " in *" $pid "*) return 1 ;; esac

  tree="$(collect_tree "$pid")"
  local n; n="$(echo "$tree" | grep -c '[0-9]')"
  info "$label — pid $pid, $n proc(s): $(short_cmd "$pid")"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  %s[dry-run]%s kill -TERM del árbol de %s\n' "$C_YELLOW" "$C_RESET" "$pid"
    KILLED_PIDS="$KILLED_PIDS $pid $tree"   # evita reportarlo dos veces
    KILLED_COUNT=$((KILLED_COUNT + 1))
    return 0
  fi

  if [ "$FORCE" -eq 1 ]; then
    for p in $tree; do kill -KILL "$p" 2>/dev/null; done
  else
    for p in $tree; do kill -TERM "$p" 2>/dev/null; done
    local i=0
    while [ "$i" -lt "$GRACE" ]; do
      alive=0
      for p in $tree; do kill -0 "$p" 2>/dev/null && alive=1; done
      [ "$alive" -eq 0 ] && break
      sleep 1; i=$((i + 1))
    done
    alive=0
    for p in $tree; do
      if kill -0 "$p" 2>/dev/null; then kill -KILL "$p" 2>/dev/null; alive=1; fi
    done
    [ "$alive" -eq 1 ] && warn "  no cerró en ${GRACE}s → SIGKILL."
  fi

  KILLED_PIDS="$KILLED_PIDS $pid"
  KILLED_COUNT=$((KILLED_COUNT + 1))
  ok "$label detenido."
  return 0
}

printf '%s╔══════════════════════════════════════════════════════════════════╗%s\n' "$C_BOLD" "$C_RESET"
printf '%s║  AgenIA · down.sh — deteniendo el stack local                    ║%s\n' "$C_BOLD" "$C_RESET"
printf '%s╚══════════════════════════════════════════════════════════════════╝%s\n' "$C_BOLD" "$C_RESET"
[ "$DRY_RUN" -eq 1 ] && printf '\n  %s(dry-run: no se detendrá nada)%s\n' "$C_YELLOW" "$C_RESET"

cd "$REPO_ROOT"

DOCKER_CONTAINERS=""

# =============================================================================
# 1. Procesos registrados en el manifiesto
# =============================================================================
if [ "$DOCKER_ONLY" -eq 0 ]; then
  step "Servicios registrados por up.sh"

  if [ -f "$MANIFEST" ]; then
    while IFS=$'\t' read -r kind name ref port log; do
      case "$kind" in '#'*|'') continue ;; esac
      if [ "$kind" = "docker" ]; then
        DOCKER_CONTAINERS="$DOCKER_CONTAINERS $ref"
        continue
      fi
      [ "$kind" = "proc" ] || continue
      if kill -0 "$ref" 2>/dev/null; then
        stop_pid "$ref" "$name"
      else
        info "$name — pid $ref ya no existe (registro obsoleto)."
      fi
      [ "$DRY_RUN" -eq 0 ] && rm -f "$RUN_DIR/$name.pid"
    done < "$MANIFEST"
    [ "$KILLED_COUNT" -eq 0 ] && info "Ningún proceso del manifiesto seguía vivo."
  else
    warn "No hay ${MANIFEST#$REPO_ROOT/} — se pasa directo al autodescubrimiento."
  fi

  # También los .pid sueltos que hubieran quedado sin entrada en el manifiesto.
  for pidfile in "$RUN_DIR"/*.pid; do
    [ -e "$pidfile" ] || continue
    pid="$(cat "$pidfile" 2>/dev/null)"
    name="$(basename "$pidfile" .pid)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      stop_pid "$pid" "$name (pidfile huérfano)"
    fi
    [ "$DRY_RUN" -eq 0 ] && rm -f "$pidfile"
  done

  # ===========================================================================
  # 2. Autodescubrimiento: procesos de este repo que sobrevivieron
  # ===========================================================================
  step "Autodescubrimiento de procesos del repo"

  if [ "$REGISTERED_ONLY" -eq 1 ]; then
    info "Omitido (--registered-only)."
  else

  FOUND_ANY=0
  for pattern in \
    "nest start" \
    "pnpm --filter api" \
    "next dev" \
    "next-server" \
    "pnpm --filter web" \
    "mirror-agent" \
    "local-his-mock" \
    "ngrok http"
  do
    for pid in $(pgrep -f "$pattern" 2>/dev/null); do
      [ "$pid" = "$$" ] && continue
      case " $KILLED_PIDS " in *" $pid "*) continue ;; esac
      kill -0 "$pid" 2>/dev/null || continue
      # ngrok no corre dentro del repo: se acepta solo si tuneliza nuestros puertos.
      if [ "$pattern" = "ngrok http" ]; then
        case "$(proc_cmd "$pid")" in
          *"ngrok http $API_PORT"*|*"ngrok http $WEB_PORT"*) : ;;
          *) continue ;;
        esac
      elif ! belongs_to_repo "$pid"; then
        continue
      fi
      # Si es hijo de algo que ya vamos a matar, el árbol lo cubre.
      ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
      case " $KILLED_PIDS " in *" $ppid "*) continue ;; esac
      FOUND_ANY=1
      stop_pid "$pid" "huérfano [$pattern]"
    done
  done
  [ "$FOUND_ANY" -eq 0 ] && ok "Sin procesos huérfanos de este repo."
  fi

  # ===========================================================================
  # 3. Barrido por puerto (--all)
  # ===========================================================================
  step "Puertos del stack"

  if [ "$REGISTERED_ONLY" -eq 1 ]; then
    info "Barrido omitido (--registered-only)."
  else
  for entry in "API:$API_PORT" "WEB:$WEB_PORT" "ngrok:$NGROK_PORT"; do
    label="${entry%%:*}"; port="${entry##*:}"
    pids="$(port_pids "$port")"
    if [ -z "$pids" ]; then
      ok "$port ($label) libre."
      continue
    fi
    for pid in $pids; do
      if [ "$ALL" -eq 1 ]; then
        stop_pid "$pid" "$label puerto $port (--all)"
      elif belongs_to_repo "$pid"; then
        stop_pid "$pid" "$label puerto $port"
      else
        warn "$port ($label) sigue ocupado por el pid $pid, ajeno a este repo:"
        printf '      %s%s%s\n' "$C_DIM" "$(short_cmd "$pid")" "$C_RESET"
        info "  Si igual quieres matarlo: ./scripts/down.sh --all"
      fi
    done
  done
  fi
fi

# =============================================================================
# 4. Contenedores Docker
# =============================================================================
if [ "$KEEP_DOCKER" -eq 1 ]; then
  step "Docker"
  info "Omitido (--keep-docker). Los contenedores siguen arriba."
elif ! have docker || ! docker info >/dev/null 2>&1; then
  step "Docker"
  warn "El daemon de Docker no responde — no hay contenedores que bajar."
else
  step "Contenedores Docker"

  # Candidatos = contenedores anotados en el manifiesto + los container_name de
  # todos los servicios de docker-compose.yml. Se filtran a los que estén vivos.
  CANDIDATES="$DOCKER_CONTAINERS"
  for svc in $(compose_services); do
    cname="$(container_name_for "$svc")"
    [ -n "$cname" ] || cname="$svc"
    case " $CANDIDATES " in *" $cname "*) ;; *) CANDIDATES="$CANDIDATES $cname" ;; esac
  done

  TARGETS=""
  for cname in $CANDIDATES; do
    case "$(container_state "$cname")" in
      running|restarting|paused) TARGETS="$TARGETS $cname" ;;
      "") ;;  # no existe
      *)  # existe detenido: solo interesa si además hay que eliminarlo
          [ "$REMOVE" -eq 1 ] && TARGETS="$TARGETS $cname" ;;
    esac
  done

  if [ -z "$TARGETS" ]; then
    ok "No hay contenedores del proyecto que bajar."
  else
    for cname in $TARGETS; do
      info "$cname — $(container_state "$cname")"
    done

    if [ "$VOLUMES" -eq 1 ]; then
      VOLS=""
      for cname in $TARGETS; do
        for v in $(container_volumes "$cname"); do
          case " $VOLS " in *" $v "*) ;; *) VOLS="$VOLS $v" ;; esac
        done
      done
      warn "--volumes ELIMINARÁ estos volúmenes y todo su contenido:"
      for v in $VOLS; do printf '      %s\n' "$v"; done
      warn "Se pierde la base de datos local (usuarios, citas, configuración de orgs)."
      if [ "$ASSUME_YES" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
        if [ -t 0 ]; then
          printf '  Escribe %sBORRAR%s para confirmar: ' "$C_BOLD" "$C_RESET"
          read -r answer
          [ "$answer" = "BORRAR" ] || { err "Confirmación no recibida — se conservan los volúmenes."; VOLUMES=0; }
        else
          err "Sesión no interactiva sin --yes — se conservan los volúmenes."
          VOLUMES=0
        fi
      fi
    fi

    if act "docker stop$TARGETS"; then
      # shellcheck disable=SC2086
      if docker stop $TARGETS >/dev/null 2>&1; then
        ok "Contenedores detenidos:$TARGETS"
      else
        err "Alguno no se pudo detener; revisa: docker ps"
      fi
    fi

    if [ "$REMOVE" -eq 1 ] && act "docker rm$TARGETS"; then
      # shellcheck disable=SC2086
      docker rm $TARGETS >/dev/null 2>&1 && ok "Contenedores eliminados (--rm)."
    fi

    if [ "$VOLUMES" -eq 1 ] && act "docker volume rm$VOLS"; then
      for v in $VOLS; do
        docker volume rm "$v" >/dev/null 2>&1 && ok "Volumen eliminado: $v" \
          || warn "No se pudo eliminar el volumen $v (¿en uso por otro contenedor?)"
      done
    fi
  fi
fi

# =============================================================================
# 5. Limpieza del estado y verificación final
# =============================================================================
if [ "$DRY_RUN" -eq 0 ] && [ "$DOCKER_ONLY" -eq 0 ] && [ -f "$MANIFEST" ]; then
  mv "$MANIFEST" "$RUN_DIR/manifest.last.tsv" 2>/dev/null
fi

step "Verificación"

LEFTOVER=0

# Solo se verifica lo que esta corrida se propuso bajar: quejarse de un puerto
# que --registered-only o --docker-only dejaron a propósito sería ruido (y un
# exit 1 falso).
CHECK_PORTS=1
[ "$DRY_RUN" -eq 1 ]        && { CHECK_PORTS=0; info "Omitida en dry-run (no se detuvo nada)."; }
[ "$DOCKER_ONLY" -eq 1 ]    && { CHECK_PORTS=0; info "Puertos no verificados (--docker-only)."; }
[ "$REGISTERED_ONLY" -eq 1 ] && { CHECK_PORTS=0; info "Puertos no verificados (--registered-only)."; }

for entry in "API:$API_PORT" "WEB:$WEB_PORT"; do
  [ "$CHECK_PORTS" -eq 0 ] && break
  label="${entry%%:*}"; port="${entry##*:}"
  if [ -n "$(port_pids "$port")" ]; then
    LEFTOVER=1
    err "$label sigue escuchando en $port (pid $(port_pids "$port" | tr '\n' ' '))."
  fi
done

if have docker && docker info >/dev/null 2>&1 && [ "$KEEP_DOCKER" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  STILL=""
  for svc in $(compose_services); do
    cname="$(container_name_for "$svc")"; [ -n "$cname" ] || cname="$svc"
    [ "$(container_state "$cname")" = "running" ] && STILL="$STILL $cname"
  done
  if [ -n "$STILL" ]; then
    LEFTOVER=1
    err "Contenedores aún corriendo:$STILL"
  fi
fi

echo
if [ "$DRY_RUN" -eq 1 ]; then
  printf '  %sDry-run terminado.%s Vuelve a correrlo sin --dry-run para ejecutar.\n\n' "$C_YELLOW" "$C_RESET"
elif [ "$LEFTOVER" -eq 0 ]; then
  printf '%s  Stack abajo.%s %s procesos detenidos. Logs conservados en %s\n\n' \
    "$C_GREEN$C_BOLD" "$C_RESET" "$KILLED_COUNT" "${RUN_DIR#$REPO_ROOT/}"
else
  printf '%s  Quedaron restos.%s Reintenta con: ./scripts/down.sh --all --force\n\n' "$C_YELLOW$C_BOLD" "$C_RESET"
  exit 1
fi

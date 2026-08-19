#!/usr/bin/env bash
# =============================================================================
#  AgenIA — desinstalación / limpieza para volver a empezar de cero
# =============================================================================
#
#  Borra la instalación para poder repetirla desde el principio. Por defecto
#  elimina TODO lo del sistema (contenedores, base de datos, imágenes,
#  certificados, configuración generada y secretos) pero deja intactos el
#  código fuente y el propio Docker.
#
#  ⚠️  DESTRUCTIVO: se pierden pacientes, citas e historias clínicas.
#      Ofrece hacer un respaldo antes.
#
#  USO
#    sudo bash deploy/uninstall-vps.sh                 # limpieza estándar
#    sudo bash deploy/uninstall-vps.sh --keep-data     # conserva la base de datos
#    sudo bash deploy/uninstall-vps.sh --all           # + código + respaldos
#    sudo bash deploy/uninstall-vps.sh --purge-legacy  # + stack antiguo antigravity_*
#    sudo bash deploy/uninstall-vps.sh --purge-docker  # + desinstala Docker
#    sudo bash deploy/uninstall-vps.sh --dry-run       # solo enseña qué borraría
# =============================================================================
set -Eeuo pipefail

if [[ -t 1 ]]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; B=$'\033[1;34m'
  C=$'\033[0;36m'; D=$'\033[2m'; BOLD=$'\033[1m'; N=$'\033[0m'
else R=''; G=''; Y=''; B=''; C=''; D=''; BOLD=''; N=''; fi
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
info() { printf '  %s·%s %s\n' "$C" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail() { printf '  %s✘%s %s\n' "$R" "$N" "$*" >&2; }
head1(){ printf '\n%s── %s%s\n' "$B" "$*" "$N"; }
die()  { fail "$*"; exit 1; }

KEEP_DATA=0; PURGE_CODE=0; PURGE_BACKUPS=0; PURGE_DOCKER=0
KEEP_CACHE=0; PURGE_LEGACY=0; DRY=0; FORCE=0; BACKUP_FIRST=""
ROOT_PRECHECK="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-data)       KEEP_DATA=1 ;;
    --keep-build-cache) KEEP_CACHE=1 ;;
    --purge-code)    PURGE_CODE=1 ;;
    --purge-backups) PURGE_BACKUPS=1 ;;
    --purge-legacy)  PURGE_LEGACY=1 ;;
    --purge-docker)  PURGE_DOCKER=1 ;;
    --all)           PURGE_CODE=1; PURGE_BACKUPS=1; PURGE_LEGACY=1 ;;
    --backup-first)  BACKUP_FIRST=1 ;;
    --no-backup)     BACKUP_FIRST=0 ;;
    --dry-run)       DRY=1 ;;
    --force)         FORCE=1 ;;
    -h|--help)       sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
  shift
done

# root solo hace falta para lo que vive fuera del directorio de la aplicación.
if [[ $EUID -ne 0 ]]; then
  NEEDS_ROOT=0
  for f in /usr/local/bin/agenia /etc/cron.d/agenia-backup /var/log/agenia-install.log; do
    [[ -e "$f" ]] && NEEDS_ROOT=1
  done
  [[ $PURGE_DOCKER -eq 1 || $PURGE_BACKUPS -eq 1 ]] && NEEDS_ROOT=1
  [[ -d "$ROOT_PRECHECK" && ! -w "$ROOT_PRECHECK" ]] && NEEDS_ROOT=1
  if [[ $NEEDS_ROOT -eq 1 ]]; then
    die "Hay elementos del sistema que borrar. Ejecuta: sudo bash $0 $*"
  fi
fi

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.deploy.yml"
ENV_FILE="$ROOT/.env.production"
BACKUP_DIR="/var/backups/agenia"

printf '%s%s AgenIA — desinstalación %s\n' "$R" "$BOLD" "$N"

# ── Inventario ──────────────────────────────────────────────────────────────
head1 "Qué hay instalado ahora"
HAS_DOCKER=0; command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && HAS_DOCKER=1

# Se distingue lo que crearon ESTOS scripts (agenia_*) de lo que dejó el
# despliegue anterior (antigravity_*, de docker-compose.prod.yml y del compose
# de desarrollo). Borrar de oficio lo que uno no creó es una forma tonta de
# destruir datos ajenos, así que lo heredado solo se toca con --purge-legacy.
CONTAINERS=(); VOLUMES=(); IMAGES=(); LEG_CONTAINERS=(); LEG_VOLUMES=()
if [[ $HAS_DOCKER -eq 1 ]]; then
  while read -r c; do [[ -n "$c" ]] && CONTAINERS+=("$c"); done < <(
    { docker ps -aq --filter "label=com.docker.compose.project=agenia" 2>/dev/null
      docker ps -aq --filter "name=^/agenia_" 2>/dev/null; } | sort -u)
  while read -r v; do [[ -n "$v" ]] && VOLUMES+=("$v"); done < <(
    docker volume ls -q --filter "name=agenia_" 2>/dev/null | sort -u)
  while read -r i; do [[ -n "$i" ]] && IMAGES+=("$i"); done < <(
    { docker images -q agenia-api 2>/dev/null
      docker images -q agenia-web 2>/dev/null; } | sort -u)
  while read -r c; do [[ -n "$c" ]] && LEG_CONTAINERS+=("$c"); done < <(
    docker ps -aq --filter "name=^/antigravity_" 2>/dev/null | sort -u)
  while read -r v; do [[ -n "$v" ]] && LEG_VOLUMES+=("$v"); done < <(
    docker volume ls -q --filter "name=antigravity" 2>/dev/null | sort -u)
fi

printf '  %-34s %s\n' "Contenedores del sistema:" "${#CONTAINERS[@]}"
printf '  %-34s %s\n' "Volúmenes de datos:" "${#VOLUMES[@]}"
for v in "${VOLUMES[@]:-}"; do [[ -n "$v" ]] && printf '      %s\n' "$v"; done
printf '  %-34s %s\n' "Imágenes construidas:" "${#IMAGES[@]}"
printf '  %-34s %s\n' "Configuración y secretos:" "$( [[ -f $ENV_FILE ]] && echo 'sí' || echo 'no' )"
printf '  %-34s %s\n' "Comando /usr/local/bin/agenia:" "$( [[ -e /usr/local/bin/agenia ]] && echo 'sí' || echo 'no' )"
printf '  %-34s %s\n' "Cron de respaldo:" "$( [[ -f /etc/cron.d/agenia-backup ]] && echo 'sí' || echo 'no' )"
printf '  %-34s %s\n' "Respaldos en $BACKUP_DIR:" "$( [[ -d $BACKUP_DIR ]] && ls -1 "$BACKUP_DIR" 2>/dev/null | wc -l | tr -d ' ' || echo 0 )"
printf '  %-34s %s\n' "Código en $ROOT:" "$( [[ -d $ROOT ]] && du -sh "$ROOT" 2>/dev/null | cut -f1 || echo '-' )"
if [[ ${#LEG_CONTAINERS[@]} -gt 0 || ${#LEG_VOLUMES[@]} -gt 0 ]]; then
  echo
  printf '  %s\n' "${Y}Restos del despliegue anterior (antigravity_*):${N} ${#LEG_CONTAINERS[@]} contenedor(es), ${#LEG_VOLUMES[@]} volumen(es)"
  for v in "${LEG_VOLUMES[@]:-}"; do [[ -n "$v" ]] && printf '      %s\n' "$v"; done
  [[ $PURGE_LEGACY -eq 0 ]] && printf '  %s\n' "  ${D}No se tocan. Para borrarlos también: --purge-legacy${N}"
fi

# ── Plan ────────────────────────────────────────────────────────────────────
head1 "Qué se va a borrar"
echo "  ${R}✗${N} Contenedores del sistema (agenia_*)"
[[ $PURGE_LEGACY -eq 1 ]] && echo "  ${R}✗${N} Restos del despliegue anterior (antigravity_*)"
if [[ $KEEP_DATA -eq 1 ]]; then
  echo "  ${G}✓${N} Volúmenes de datos ${BOLD}SE CONSERVAN${N} (base de datos y certificados)"
else
  echo "  ${R}✗${N} ${BOLD}Volúmenes de datos: base de datos, Redis y certificados TLS${N}"
fi
echo "  ${R}✗${N} Imágenes agenia-api y agenia-web"
echo "  ${R}✗${N} .env.production, deploy/Caddyfile, deploy/install.conf, deploy/secrets"
echo "  ${R}✗${N} /usr/local/bin/agenia, /etc/cron.d/agenia-backup, logs de instalación"
[[ $PURGE_BACKUPS -eq 1 ]] && echo "  ${R}✗${N} Respaldos en $BACKUP_DIR" || echo "  ${G}✓${N} Respaldos en $BACKUP_DIR se conservan"
[[ $PURGE_CODE -eq 1 ]]    && echo "  ${R}✗${N} Código fuente en $ROOT" || echo "  ${G}✓${N} Código fuente se conserva"
[[ $PURGE_DOCKER -eq 1 ]]  && echo "  ${R}✗${N} Docker Engine (desinstalación de paquetes)"
echo "  ${G}✓${N} Usuarios del sistema, reglas de firewall y SSH: no se tocan"

if [[ $DRY -eq 1 ]]; then
  warn "--dry-run: no se borró nada."
  exit 0
fi

# ── Confirmación ────────────────────────────────────────────────────────────
if [[ $FORCE -eq 0 ]]; then
  echo
  if [[ $KEEP_DATA -eq 0 && ${#VOLUMES[@]} -gt 0 ]]; then
    printf '  %s%sSe perderán pacientes, citas e historias clínicas de forma irreversible.%s\n' "$R" "$BOLD" "$N"
  fi
  read -r -p "  Escribe BORRAR para continuar: " a
  [[ "$a" == "BORRAR" ]] || { echo "  Cancelado."; exit 1; }
fi

# ── Respaldo previo ─────────────────────────────────────────────────────────
if [[ $KEEP_DATA -eq 0 && $HAS_DOCKER -eq 1 && ${#VOLUMES[@]} -gt 0 ]]; then
  if [[ -z "$BACKUP_FIRST" && $FORCE -eq 0 ]]; then
    read -r -p "  ¿Guardar un respaldo de la base antes de borrar? [S/n]: " a
    [[ -z "$a" || "$a" =~ ^[SsYy] ]] && BACKUP_FIRST=1 || BACKUP_FIRST=0
  fi
  if [[ "${BACKUP_FIRST:-0}" == "1" ]]; then
    head1 "Respaldo previo"
    if docker ps --format '{{.Names}}' | grep -q '^agenia_db$'; then
      mkdir -p "$BACKUP_DIR"
      f="$BACKUP_DIR/pre-uninstall-$(date +%Y%m%d-%H%M%S).sql.gz"
      # shellcheck disable=SC1090
      [[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }
      if docker exec -i agenia_db pg_dump -U "${POSTGRES_USER:-agenia}" -d "${POSTGRES_DB:-antigravity}" \
           --clean --if-exists 2>/dev/null | gzip -9 > "$f" && [[ -s "$f" ]]; then
        ok "Respaldo guardado: $f ($(du -h "$f" | cut -f1))"
        PURGE_BACKUPS=0   # no tendría sentido borrar el respaldo recién hecho
      else
        rm -f "$f"; warn "No se pudo respaldar (¿la base estaba apagada?). Se continúa."
      fi
    else
      warn "El contenedor de la base no está corriendo: no hay nada que respaldar."
    fi
  fi
fi

# ── Borrado ─────────────────────────────────────────────────────────────────
head1 "Eliminando"

if [[ $HAS_DOCKER -eq 1 ]]; then
  if [[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]; then
    if [[ $KEEP_DATA -eq 1 ]]; then
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
    else
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
    fi
    ok "Stack detenido y contenedores eliminados"
  fi
  if [[ $PURGE_LEGACY -eq 1 ]]; then
    for c in "${LEG_CONTAINERS[@]:-}"; do [[ -n "$c" ]] && docker rm -f "$c" >/dev/null 2>&1 || true; done
    [[ $KEEP_DATA -eq 0 ]] && for v in "${LEG_VOLUMES[@]:-}"; do
      [[ -n "$v" ]] && docker volume rm -f "$v" >/dev/null 2>&1 && ok "Volumen antiguo borrado: $v" || true
    done
    [[ ${#LEG_CONTAINERS[@]} -gt 0 ]] && ok "Restos del despliegue anterior eliminados"
  fi

  # Restos que compose no conozca (contenedores sueltos con nombre agenia_*).
  for c in "${CONTAINERS[@]:-}"; do
    [[ -n "$c" ]] || continue
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
  [[ ${#CONTAINERS[@]} -gt 0 ]] && ok "Contenedores residuales eliminados"

  if [[ $KEEP_DATA -eq 0 ]]; then
    for v in "${VOLUMES[@]:-}"; do
      [[ -n "$v" ]] || continue
      docker volume rm -f "$v" >/dev/null 2>&1 && ok "Volumen borrado: $v" || warn "No se pudo borrar el volumen $v"
    done
  else
    ok "Volúmenes conservados (${#VOLUMES[@]})"
  fi

  img_gone=0
  for i in "${IMAGES[@]:-}"; do
    [[ -n "$i" ]] || continue
    docker rmi -f "$i" >/dev/null 2>&1 && img_gone=$((img_gone+1)) || true
  done
  [[ $img_gone -gt 0 ]] && ok "Imágenes de la aplicación eliminadas ($img_gone)"

  docker network rm agenia_default >/dev/null 2>&1 && ok "Red agenia_default eliminada" || true
  # La caché de build puede ocupar varios GB tras varias reconstrucciones.
  # Conservarla hace que reinstalar tarde minutos en vez de una hora.
  if [[ $KEEP_CACHE -eq 1 ]]; then
    info "Caché de construcción conservada (la reinstalación será mucho más rápida)"
  else
    freed="$(docker builder prune -af 2>/dev/null | tail -1 || true)"
    [[ -n "$freed" ]] && ok "Caché de construcción liberada ${D}(${freed})${N}"
  fi
fi

rm -f "$ENV_FILE" "$ROOT/deploy/Caddyfile" "$ROOT/deploy/install.conf" 2>/dev/null || true
rm -rf "$ROOT/deploy/secrets" 2>/dev/null || true
rm -f "$ROOT/apps/web/.env" "$ROOT/packages/database/.env" 2>/dev/null || true
ok "Configuración y secretos generados eliminados"

rm -f /usr/local/bin/agenia /etc/cron.d/agenia-backup 2>/dev/null || true
rm -f /var/log/agenia-install.log /var/log/agenia-backup.log 2>/dev/null || true
ok "Comando, cron y logs eliminados"

if [[ $PURGE_BACKUPS -eq 1 ]]; then
  rm -rf "$BACKUP_DIR" 2>/dev/null || true
  ok "Respaldos eliminados"
fi

if [[ $PURGE_DOCKER -eq 1 ]]; then
  head1 "Desinstalando Docker"
  systemctl disable --now docker.socket docker >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null 2>&1 || true
  rm -rf /var/lib/docker /var/lib/containerd /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.asc
  ok "Docker desinstalado y sus datos borrados"
fi

if [[ $PURGE_CODE -eq 1 ]]; then
  # Se borra el contenido, no el propio directorio: el script se está
  # ejecutando desde dentro y borrar su raíz durante la ejecución es frágil.
  find "$ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
  ok "Código fuente eliminado de $ROOT"
fi

# ── Comprobación ────────────────────────────────────────────────────────────
head1 "Comprobación final"
rest_c=0; rest_v=0
if [[ $HAS_DOCKER -eq 1 && $PURGE_DOCKER -eq 0 ]]; then
  rest_c="$(docker ps -aq --filter "name=^/agenia_" 2>/dev/null | wc -l | tr -d ' ')"
  if [[ $PURGE_LEGACY -eq 1 ]]; then
    rest_c=$(( rest_c + $(docker ps -aq --filter "name=^/antigravity_" 2>/dev/null | wc -l | tr -d ' ') ))
  fi
  rest_v="$(docker volume ls -q --filter "name=agenia" 2>/dev/null | wc -l | tr -d ' ')"
fi
[[ "$rest_c" == "0" ]] && ok "No quedan contenedores del sistema" || fail "Quedan $rest_c contenedores"
if [[ $KEEP_DATA -eq 1 ]]; then
  ok "Volúmenes conservados a propósito: $rest_v"
else
  [[ "$rest_v" == "0" ]] && ok "No quedan volúmenes de datos" || fail "Quedan $rest_v volúmenes"
fi
[[ -f "$ENV_FILE" ]] && fail "Sigue existiendo $ENV_FILE" || ok "Sin configuración residual"
if [[ $HAS_DOCKER -eq 1 && $PURGE_DOCKER -eq 0 ]]; then
  rest_i="$({ docker images -q agenia-api 2>/dev/null; docker images -q agenia-web 2>/dev/null; } | wc -l | tr -d ' ')"
  [[ "$rest_i" == "0" ]] && ok "No quedan imágenes de la aplicación" || fail "Quedan $rest_i imágenes"
fi

cat <<EOF

${G}${BOLD}  Limpieza completada.${N}

  ${BOLD}Para instalar de nuevo desde cero:${N}
$( [[ $PURGE_CODE -eq 1 ]] \
   && echo "    Desde tu computador:  bash deploy/remote-install.sh" \
   || echo "    En el servidor:       sudo bash $ROOT/deploy/install-vps.sh" )
EOF

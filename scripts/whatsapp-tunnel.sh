#!/usr/bin/env bash
# Levanta (o reutiliza) un túnel ngrok hacia la API local para probar el
# webhook de WhatsApp con un número de prueba de Meta. Copia la URL del
# webhook al portapapeles y muestra el Verify Token a pegar en Meta.
#
# Uso: ./scripts/whatsapp-tunnel.sh [puerto de la API, default 3001]
set -euo pipefail

PORT="${1:-3001}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DIR="$REPO_ROOT/.local"
TOKEN_FILE="$LOCAL_DIR/whatsapp-verify-token"
NGROK_LOG="$LOCAL_DIR/ngrok.log"
NGROK_API="http://127.0.0.1:4040/api/tunnels"

mkdir -p "$LOCAL_DIR"

# ---------------------------------------------------------------------------
# 1) Verify Token — estable entre corridas (Meta no lo pide de nuevo si no
#    cambia; lo que sí cambia cada vez es la URL de ngrok). Se genera una
#    sola vez y se reutiliza.
# ---------------------------------------------------------------------------
if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 24 > "$TOKEN_FILE"
fi
VERIFY_TOKEN="$(cat "$TOKEN_FILE")"

# ---------------------------------------------------------------------------
# 2) ngrok — reutiliza un túnel ya activo hacia este puerto si existe
#    (el plan gratis solo permite una sesión de agente simultánea).
# ---------------------------------------------------------------------------
existing_url="$(curl -s "$NGROK_API" 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for t in data.get('tunnels', []):
    if t.get('proto') == 'https' and str($PORT) in t.get('config', {}).get('addr', ''):
        print(t['public_url'])
        break
" 2>/dev/null || true)"

if [ -n "$existing_url" ]; then
  echo "ngrok ya estaba corriendo hacia el puerto $PORT — reutilizando túnel."
  PUBLIC_URL="$existing_url"
else
  echo "Levantando ngrok hacia el puerto $PORT..."
  nohup ngrok http "$PORT" --log=stdout > "$NGROK_LOG" 2>&1 &
  disown

  PUBLIC_URL=""
  for _ in $(seq 1 20); do
    PUBLIC_URL="$(curl -s "$NGROK_API" 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for t in data.get('tunnels', []):
    if t.get('proto') == 'https':
        print(t['public_url'])
        break
" 2>/dev/null || true)"
    [ -n "$PUBLIC_URL" ] && break
    sleep 1
  done

  if [ -z "$PUBLIC_URL" ]; then
    echo "No se pudo obtener la URL de ngrok — revisa $NGROK_LOG" >&2
    exit 1
  fi
fi

WEBHOOK_URL="${PUBLIC_URL}/chatbot/webhook"

# ---------------------------------------------------------------------------
# 3) Copiar al portapapeles y mostrar
# ---------------------------------------------------------------------------
if command -v pbcopy > /dev/null; then
  printf '%s' "$WEBHOOK_URL" | pbcopy
  copied="(copiada al portapapeles)"
else
  copied="(pbcopy no disponible — cópiala manualmente)"
fi

echo ""
echo "=================================================================="
echo " Pega esto en Meta → tu App → WhatsApp → Configuration → Webhook"
echo "=================================================================="
echo "Callback URL:   $WEBHOOK_URL   $copied"
echo "Verify Token:   $VERIFY_TOKEN"
echo ""
echo "El mismo Verify Token también va en AgenIA:"
echo "  http://localhost:3000/dashboard/configuracion → Canal de WhatsApp"
echo "  (pégalo en el campo 'Verify Token' al guardar el canal)"
echo ""
echo "Nota: la URL cambia cada vez que ngrok se reinicia; el Verify Token"
echo "queda fijo en $TOKEN_FILE — no hace falta regenerarlo."
echo "=================================================================="

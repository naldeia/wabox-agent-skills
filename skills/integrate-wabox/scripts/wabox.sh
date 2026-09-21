#!/usr/bin/env bash
# Mini CLI da API pública do Wabox (curl + jq opcional).
#
#   export WABOX_INSTANCE_ID=… WABOX_TOKEN=…   [WABOX_API_URL=https://api.wabox.me] [WABOX_API_KEY=wbx_key_…]
#   WABOX_API_KEY: só se o workspace exige API key nas rotas de instância (permissão instances:operate).
#   Legado: sem WABOX_API_KEY, WABOX_CLIENT_TOKEN vai no header Client-Token (alias z-api; aceita a mesma key).
#   wabox.sh GET  status
#   wabox.sh GET  'queue?page=1&page_size=20'
#   wabox.sh POST send-text '{"phone":"5511988887777","message":"oi"}'
#   wabox.sh PUT  webhooks '{"received_url":"https://…"}'
#   wabox.sh DELETE queue
#   wabox.sh GET  qr-code/image > qr.png
#
# Saída: corpo da resposta em stdout (PNG preservado); status HTTP em stderr. Exit 1 se HTTP >= 400.
set -euo pipefail

method="${1:-}"; path="${2:-}"; body="${3:-}"
if [[ -z "$method" || -z "$path" ]]; then
  sed -n '2,14p' "$0" >&2; exit 2
fi
: "${WABOX_INSTANCE_ID:?defina WABOX_INSTANCE_ID}" "${WABOX_TOKEN:?defina WABOX_TOKEN}"
base="${WABOX_API_URL:-https://api.wabox.me}/instances/${WABOX_INSTANCE_ID}/token/${WABOX_TOKEN}"

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT
args=(-sS --connect-timeout 10 --max-time 30 -X "$method" -o "$response_file" -w '%{http_code}')
if [[ "$path" == "qr-code/image" || "$path" == "/qr-code/image" ]]; then
  args+=(-H 'Accept: image/png')
else
  args+=(-H 'Accept: application/json')
fi
if [[ -n "${WABOX_API_KEY:-}" ]]; then
  args+=(-H "Authorization: Bearer ${WABOX_API_KEY}")
elif [[ -n "${WABOX_CLIENT_TOKEN:-}" ]]; then
  args+=(-H "Client-Token: ${WABOX_CLIENT_TOKEN}")
fi
[[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data "$body")

code="$(curl "${args[@]}" "${base}/${path#/}")"
echo "HTTP $code" >&2
if command -v jq >/dev/null 2>&1 && jq -e 'type == "object" or type == "array"' "$response_file" >/dev/null 2>&1; then
  jq . "$response_file"
else
  cat "$response_file"
fi
[[ "$code" -lt 400 ]]

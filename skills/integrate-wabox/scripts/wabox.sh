#!/usr/bin/env bash
# Mini CLI da API pública do Wabox (curl + jq opcional).
#
#   export WABOX_INSTANCE_ID=… WABOX_TOKEN=…   [WABOX_API_URL=https://api.wabox.me] [WABOX_CLIENT_TOKEN=…]
#   wabox.sh GET  status
#   wabox.sh GET  'queue?page=1&page_size=20'
#   wabox.sh POST send-text '{"phone":"5511988887777","message":"oi"}'
#   wabox.sh PUT  webhooks '{"received_url":"https://…"}'
#   wabox.sh DELETE queue
#   wabox.sh GET  qr-code/image > qr.png
#
# Saída: corpo da resposta (JSON) em stdout; status HTTP em stderr. Exit 1 se HTTP >= 400.
set -euo pipefail

method="${1:-}"; path="${2:-}"; body="${3:-}"
if [[ -z "$method" || -z "$path" ]]; then
  sed -n '2,12p' "$0" >&2; exit 2
fi
: "${WABOX_INSTANCE_ID:?defina WABOX_INSTANCE_ID}" "${WABOX_TOKEN:?defina WABOX_TOKEN}"
base="${WABOX_API_URL:-https://api.wabox.me}/instances/${WABOX_INSTANCE_ID}/token/${WABOX_TOKEN}"

args=(-sS -X "$method" -w '\n%{http_code}' -H 'Accept: application/json')
[[ -n "${WABOX_CLIENT_TOKEN:-}" ]] && args+=(-H "Client-Token: ${WABOX_CLIENT_TOKEN}")
[[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data "$body")

out="$(curl "${args[@]}" "${base}/${path#/}")"
code="${out##*$'\n'}"; resp="${out%$'\n'*}"
echo "HTTP $code" >&2
if command -v jq >/dev/null 2>&1 && [[ "$resp" == \{* || "$resp" == \[* ]]; then
  printf '%s' "$resp" | jq .
else
  printf '%s\n' "$resp"
fi
[[ "$code" -lt 400 ]]

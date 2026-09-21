# Erros, retry e limites

Formato: `{ "error": { "code": "…", "message": "…", "details"? } }`. `code` é estável; `message` não.

## HTTP × código

| HTTP | `code` | Causa / o que fazer |
| --- | --- | --- |
| 400 | `invalid_request` | Body inválido; `details.issues[{ path, message }]`. Comum: `phone` com `+`/espaços, `message` vazio, base64 com prefixo errado, `delay_typing` > 15 |
| 400 | `invite_link_invalid` | Link de convite de grupo inválido |
| 401 | `unauthorized` / `instance_not_found` | Sem credenciais na URL / instância ou token errados (não diz qual) |
| 401 | `client_token_required` | Header `Client-Token` ausente ou inválido |
| 402 | `subscription_required` | Trial vencido ou assinatura inativa — só em envios |
| 403 | `ip_not_allowed` | IP fora da allowlist do workspace |
| 403 | `workspace_suspended` / `group_suspended` | Workspace suspenso pelo Wabox (fale com o suporte) / grupo suspenso pelo WhatsApp |
| 404 | `chat_not_found`, `group_not_found`, `newsletter_not_found`, `product_not_found`, `label_not_found`, `order_not_found`, `message_not_found` | |
| 409 | `instance_not_connected` | Ação imediata (read, presence, contatos, grupos…) com instância fora. Consulte `GET /status` |
| 409 | `instance_starting` | Repita em alguns segundos |
| 409 | `instance_already_connected` | Pediu QR/pairing code com a instância já conectada |
| 429 | `queue_full` | 1.000 mensagens na fila. Espere esvaziar ou use outra instância |
| 409 | `queue_disabled_while_disconnected` | `disable_enqueue_when_disconnected` ligado e instância fora |
| 415 / 422 | mídia | Tipo não aceito / conteúdo inválido |
| 429 | `rate_limited` | Espere `Retry-After` (s). Headers `X-RateLimit-Limit/Remaining` em toda resposta |
| 400 | `invalid_phone` | `phone` fora dos formatos aceitos |
| 502 | `action_failed` / `send_failed` | O aparelho falhou ao executar a ação (ex.: primeiro `GET /labels` após restart). Repita |
| 503 | `engine_unavailable` / `history_not_configured` | Nó do engine fora do ar (repita com backoff) / histórico não habilitado no ambiente |
| 5xx | — | Backoff exponencial até ~5 tentativas; em envios, confira `GET /queue` antes de repetir |

## Política de retry

| Situação | Repetir? |
| --- | --- |
| `429` | Sim, após `Retry-After` |
| `5xx`, timeout, conexão recusada | Sim, com backoff (1, 2, 4, 8, 16 s). **Envios**: confira `GET /queue` / `delivery` antes, para não duplicar |
| `409 instance_starting` | Sim, em segundos |
| `409 instance_not_connected` / `queue_full` | Depois, quando `GET /status` = `connected` / fila esvaziar |
| `400`, `401`, `402`, `403`, `404` | Não — o resultado será o mesmo |

## `error_code` no webhook `delivery`

| `error_code` | O que fazer |
| --- | --- |
| `phone_not_on_whatsapp` | Número sem WhatsApp. Confira antes com `GET /phone-exists/{phone}` |
| `media_download_failed` | URL não pública/lenta. Use URL pública ou base64 |
| `media_invalid` | Acima de 16 MB (mídia) / 100 MB (documento) ou formato não aceito (sticker precisa ser WebP sem ffmpeg) |
| `message_not_found` | Referência (reply/forward/edit/vote) fora do cache do engine. Reenvie sem a referência se for opcional |
| `send_timeout` | Aparelho não confirmou. A mensagem **pode** ter saído — espere `message_status` antes de reenviar |
| `shadow_ban` | WhatsApp aceita mas não entrega. **Pare os envios** e deixe o número descansar |
| `not_allowed` | Contato bloqueou, grupo só para admins, etc. |
| `instance_not_connected` | Caiu entre a fila e o envio; a mensagem volta à fila salvo config |
| `queue_expired` | Passou de `queue_max_age_hours` (padrão 12 h) na fila sem envio. Reenviar é seguro |

## Limites

- Rate limit: 60 req/s por instância, rajada 120.
- Fila: 1.000 mensagens por instância; intervalo anti-ban 1–3 s (config `delay_message_min_ms/max_ms`); 1 mídia por vez por instância.
- Mídia: 16 MB (imagem/áudio/vídeo/sticker), 100 MB (documento); body 64 MB.
- Webhooks: timeout 10 s, 1 entrega + 5 reenvios em ~7 h; URL de mídia recebida expira em 24 h.
- `phone-exists-batch`: até 50 números.

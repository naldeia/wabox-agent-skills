# Erros, retry e limites

Formato: `{ "error": { "code": "…", "message": "…", "details"? } }`. `code` é estável; `message` não.

## HTTP × código

| HTTP | `code` | Causa / o que fazer |
| --- | --- | --- |
| 400 | `invalid_request` | Body inválido; `details.issues[{ path, message }]`. Comum: `phone` com `+`/espaços, `message` vazio, base64 com prefixo errado, `delay_typing` > 15 |
| 400 | `invite_link_invalid` | Link de convite de grupo inválido |
| 401 | `unauthorized` / `instance_not_found` | Sem credenciais na URL / instância ou token errados (não diz qual) |
| 401 | `api_key_required` | API key do workspace ausente ou inválida (revogada, de outro workspace). Rotas de instância: só quando o workspace liga "Exigir API key nas rotas de instância" — `Authorization: Bearer wbx_key_…` ou a mesma key no header `Client-Token`. Account API: sempre, e só `Authorization: Bearer`. Antes de 2026-09-21: `client_token_required` / `account_token_required` |
| 403 | `insufficient_scope` | Key válida sem a permissão da rota; `details.required_scope` diz qual (`instances:operate` nas rotas de instância; `instances:read`/`instances:write`/`webhooks:read`/`webhooks:write` na Account API). Edite as permissões da key em Segurança › API keys |
| 402 | `subscription_required` | Trial/plano vencido: envios na API da instância; todas as rotas na Account API |
| 403 / 409 | `plan_required` / `instance_limit_reached` | Só na Account API (`/account/*`): conta em trial / todos os slots do plano em uso |
| 403 | `ip_not_allowed` | IP fora da allowlist do workspace |
| 403 | `workspace_suspended` / `group_suspended` | Workspace suspenso pelo Wabox (fale com o suporte) / grupo suspenso pelo WhatsApp |
| 404 | `chat_not_found`, `group_not_found`, `newsletter_not_found`, `product_not_found`, `label_not_found`, `order_not_found`, `message_not_found` | |
| 409 | `instance_not_connected` | Ação imediata (read, presence, contatos, grupos…) com instância fora. Consulte `GET /status` |
| 409 | `instance_starting` | Repita em alguns segundos |
| 409 | `instance_already_connected` | A operação exige sessão não conectada; `GET /qr-code` JSON usa `value: null` quando conectada |
| 429 | `queue_full` | Fila de instância desconectada chegou a 1.000 mensagens. Espere esvaziar; não troque o canal/número de envio silenciosamente |
| 409 | `queue_disabled_while_disconnected` | `disable_enqueue_when_disconnected` ligado e instância fora |
| 415 / 422 | mídia | Tipo não aceito / conteúdo inválido |
| 429 | `rate_limited` | Espere `Retry-After` (s). Headers `X-RateLimit-Limit/Remaining` em toda resposta |
| 400 | `invalid_phone` | `phone` fora dos formatos aceitos |
| 502 | `action_failed` / `send_failed` | O aparelho falhou ao executar. Leituras podem ser repetidas; escritas precisam de reconciliação antes de repetir |
| 503 | `engine_unavailable` / `history_not_configured` | Nó do engine fora do ar (repita com backoff) / histórico não habilitado no ambiente |
| 5xx | — | Leituras: backoff com limite. Envios/criação/ações podem já ter ocorrido; não repetir automaticamente |

## Política de retry

| Situação | Repetir? |
| --- | --- |
| `429 rate_limited` | Sim, após `Retry-After`, quando o erro confirma rejeição pela API |
| `5xx`, timeout, falha de rede em leitura | Sim, com backoff limitado (ex.: 1, 2, 4, 8, 16 s) |
| `5xx`, timeout, falha de rede em envio/criação/ação | Não automaticamente: resultado pode ser desconhecido. Reconcilie primeiro; ausência na fila não prova falha de envio |
| `409 instance_starting` | Sim, em segundos |
| `409 instance_not_connected` / `queue_full` | Depois, quando `GET /status` = `connected` / fila esvaziar |
| `400`, `401`, `402`, `403`, `404` | Não — o resultado será o mesmo até corrigir a causa (credencial, permissão da key, plano, allowlist) |

Não há `Idempotency-Key` para envio ou criação de instância. Persista uma operação local antes da chamada e serialize tentativas da mesma operação. Sem a resposta, pode faltar o `wabox_id`/`message_id`; mensagens parecidas por telefone/texto/horário não são prova suficiente de correlação. Mantenha resultado inconclusivo para revisão em vez de arriscar duplicação. Mesmo com resposta `queued`, acompanhe `delivery` para saber o resultado final.

## `error_code` no webhook `delivery`

| `error_code` | O que fazer |
| --- | --- |
| `phone_not_on_whatsapp` | Número sem WhatsApp. Confira antes com `GET /phone-exists/{phone}` |
| `media_download_failed` | URL não pública/lenta. Use URL pública ou base64 |
| `media_invalid` | Acima de 16 MB (mídia) / 100 MB (documento) ou formato não aceito (sticker precisa ser WebP sem ffmpeg) |
| `message_not_found` | Encaminhamento/edição de legenda fora do cache, ou voto sem o segredo da enquete original. Não transforme automaticamente uma edição/reação em nova mensagem; ofereça alternativa conforme a ação |
| `send_timeout` | Aparelho não confirmou. A mensagem **pode** ter saído — espere `message_status` antes de reenviar |
| `shadow_ban` | WhatsApp aceita mas não entrega. **Pare os envios** e deixe o número descansar |
| `not_allowed` | Contato bloqueou, grupo só para admins, etc. |
| `instance_not_connected` | Caiu entre a fila e o envio; a mensagem volta à fila salvo config |
| `queue_expired` | Passou de `queue_max_age_hours` (padrão 12 h) na fila sem envio. Reenviar é seguro |

## Limites

- Rate limit: 60 req/s por instância, rajada 120.
- Fila offline: limite de 1.000 mensagens; a implementação aplica essa verificação quando a instância está desconectada. Intervalo anti-ban padrão 1–3 s (config `delay_message_min_ms/max_ms`); 1 mídia por vez por instância.
- Mídia: 16 MB (imagem/áudio/vídeo/sticker), 100 MB (documento); body 64 MB. Base64 cresce ~33%: use URL para documentos grandes e mantenha-a válida durante a espera na fila.
- Webhooks: timeout 10 s, 1 entrega + 5 reenvios em ~7 h; URL de mídia recebida expira em 24 h.
- `phone-exists-batch`: até 50 números.

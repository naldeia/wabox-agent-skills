---
name: wabox-partner
description: Integra a Partner API do Wabox para criar e administrar instâncias de WhatsApp por API em nome dos próprios clientes (integradores como o Kinbox) — header Partner-Token, rotas /partner/instances, instâncias sem trial/402, guardar id/token/secret por cliente, QR e operação pela API pública. Use quando o usuário falar em "criar canal de WhatsApp via Wabox", "Partner API", "Partner-Token", "integrar o Wabox no Kinbox" ou provisionar instâncias automaticamente.
---

# Partner API do Wabox

Para quem embute o Wabox num produto: cada cliente final ganha uma **instância** (um número) criada por API no workspace Partner do integrador. O Wabox não cobra nem aplica trial nessas instâncias (`subscription_status: "partner"`); a cobrança é do integrador.

```
Base:   https://api.wabox.me/partner
Header: Partner-Token: pt_<48 hex>      (Segurança › Partner API no painel; mostrado uma vez)
Erros:  { "error": { "code", "message" } }   — partner_token_required, ip_not_allowed, instance_not_found, invalid_request, rate_limited
```

Depois de criada, a instância é operada pela **API pública normal** (`/instances/{id}/token/{token}/*`, webhooks, etc.) — use a skill `integrate-wabox` para essa parte.

## Rotas

| Rota | Body / resposta |
| --- | --- |
| `POST /partner/instances` | `{ name*, webhooks?, settings? }` → instância completa com `id`, `token`, `api_url`, `webhooks.secret`, `subscription_status: "partner"`. Já inicia a sessão (status `qr` em segundos) |
| `GET /partner/instances?status&q&page&page_size` | `{ data[], page, page_size, total }`; `status` = `connected`\|`disconnected`; `q` busca nome/id/número; itens trazem `token` |
| `GET /partner/instances/{id}` | instância |
| `PUT /partner/instances/{id}` | parcial: `{ name?, webhooks?, settings? }` (mesmos campos de `PUT /webhooks` e `PUT /settings` da API pública) |
| `POST /partner/instances/{id}/rotate-token` | `{ token }` novo; o antigo para na hora |
| `DELETE /partner/instances/{id}` | 204; desconecta o aparelho no celular, para a sessão, descarta a fila |
| `GET /partner/webhooks` · `PUT /partner/webhooks` | webhooks do workspace (mesmos campos de `webhooks`, sem `use_workspace_webhooks`) + `secret`, `configured`, `used_by_instances`. Instância criada sem `webhooks` herda URLs, filtros e **este `secret`**; o `secret` nasce no primeiro `PUT` |
| `POST /partner/webhooks/secret` | `{ secret }` novo do workspace |

`webhooks`: `received_url, delivery_url, message_status_url, connected_url, disconnected_url, chat_presence_url, single_url_enabled, single_url` (uma URL para tudo), `use_workspace_webhooks` (herdar do workspace; definir uma URL desliga), `notify_sent_by_me, ignore_groups, ignore_private, ignore_text|image|video|audio|document, ignore_*_callback`. `settings`: `auto_read_message, auto_read_status, call_reject_auto, call_reject_message, disable_enqueue_when_disconnected, queue_max_age_hours, delay_message_min_ms, delay_message_max_ms, history_enabled, proxy_url`.

## Modelo de dados no produto do integrador

Por cliente/canal guarde: `wabox_instance_id`, `wabox_token`, `wabox_status` (do último `connected`/`disconnected`), `wabox_phone`. Segredo de assinatura: um só (`GET /partner/webhooks`) se as instâncias herdam os webhooks do workspace — recomendado —, senão `wabox_webhook_secret` por instância. Nunca exponha `token`/`secret`/`Partner-Token` ao front-end.

## Fluxo recomendado

1. **Webhooks uma vez**: `PUT /partner/webhooks` com os `*_url` do seu backend (ou `single_url_enabled` + `single_url`), `notify_sent_by_me: true` (espelha o que o cliente digita no celular); guarde o `secret` da resposta. Depois **criar** ao ativar o canal: `POST /partner/instances` só com `name` único (ex.: `"<cliente_id> – <nome>"`) e `settings.call_reject_auto` conforme o produto — a instância herda os webhooks. Passe `webhooks` no `POST` só para um cliente com destino diferente.
2. **Idempotência**: antes de criar, `GET /partner/instances?q=<cliente_id>`; se já existe, reutilize. Criação sem resposta (timeout) → listar antes de tentar de novo.
3. **Pareamento**: mostre `GET {api_url}/qr-code` (data URL, rotaciona ~20 s) ou `/qr-code/image`; alternativa `GET {api_url}/phone-code/{phone}`. Considere conectado quando chegar o webhook `connected` (não faça polling agressivo; se precisar, `GET /status` a cada 10 s).
4. **Webhooks**: um endpoint por tipo (ou um só, roteando por `type`/`X-Wabox-Event`); verifique `X-Wabox-Signature` sobre o corpo cru com o `secret` do workspace (ou o da instância, se ela tem `webhooks` próprios) → identifique o cliente por `X-Wabox-Instance-Id` (ou `instance_id` do corpo) → responda 200 → processe. Deduplique por `event_id`.
5. **Desconexões**: `disconnected{reason: "logged_out"}` → marcar canal como "reconectar" e oferecer o QR de novo; `reason: "banned"` → canal inutilizável, precisa de número novo; `network` → ignore, reconecta sozinho.
6. **Cancelamento**: `DELETE /partner/instances/{id}` e apague as credenciais locais.
7. **Rotação**: se suspeitar de vazamento do token de uma instância, `POST …/rotate-token` e atualize o registro do cliente. Do `Partner-Token`: gere outro no painel e troque no segredo do backend.

## Armadilhas

- Instâncias Partner nunca dão `402`, mas todo o resto vale: `409 instance_not_connected` em ações imediatas, fila de 1.000, rate limit por instância, IP allowlist do workspace (se preenchida, inclua os IPs de saída do backend).
- `GET /partner/instances` lista todas do workspace (paginado). Para milhares de canais, filtre por `q` em vez de paginar tudo a cada sync.
- O `token` da instância aparece na lista e nos detalhes de propósito (o integrador é o dono). Trate a resposta como segredo.
- Configure `PUT /partner/webhooks` **antes** de criar a primeira instância: sem URL nenhuma (nem do workspace, nem da instância) o `connected` inicial e as primeiras mensagens se perdem — webhooks não entregues não são recuperáveis.
- Uma instância com `webhooks` próprios tem `secret` próprio; não tente validar a assinatura dela com o `secret` do workspace.
- Migrando canais que hoje rodam em Baileys: a sessão **não** é portável — todo cliente pareia de novo (QR ou pairing code). Veja `../integrate-wabox/references/migrating-from-baileys.md`.

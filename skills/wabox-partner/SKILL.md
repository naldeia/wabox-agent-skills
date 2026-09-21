---
name: wabox-partner
description: Integra a Account API do Wabox para criar, atualizar e excluir instâncias de WhatsApp por API em nome dos próprios clientes (integradores como o Kinbox e qualquer conta com plano) — header Account-Token, rotas /account/instances, slots do plano (409 instance_limit_reached), guardar id/token/secret por cliente, QR e operação pela API pública. Use quando o usuário falar em "criar canal de WhatsApp via Wabox", "criar instância por API", "Account API", "Account-Token", "slots", "integrar o Wabox no Kinbox" ou provisionar instâncias automaticamente (a antiga "Partner API"/"Partner-Token" virou isto).
---

# Account API do Wabox

Para quem embute o Wabox num produto (ou provisiona canais por script): cada cliente final ganha uma **instância** (um número) criada por API no workspace do integrador.

**O plano é por slots, não por instância.** A conta compra N slots (canais) na mensalidade e pode criar, atualizar e excluir instâncias à vontade enquanto tiver no máximo N ao mesmo tempo. Toda instância existente ocupa um slot (conectada ou não, criada no painel ou pela API); excluir libera o slot na hora. Não existe assinatura/cancelamento por instância.

- **Conta em trial não usa a Account API** (`403 plan_required`): o trial cria a instância pelo painel.
- **Conta Partner** (contrato próprio, ex.: Kinbox): mesma API, sem limite de slots e sem cobrança no Wabox (`instance_slots: null`, `subscription_status: "partner"`).

```
Base:   https://api.wabox.me/account
Header: Account-Token: act_<48 hex>      (Segurança › Account API no painel; mostrado uma vez)
Erros:  { "error": { "code", "message" } }   — account_token_required (401), plan_required (403, trial),
        subscription_required (402, plano vencido), instance_limit_reached (409, slots cheios; details.instance_slots / instances_used),
        ip_not_allowed, instance_not_found, invalid_request, rate_limited
```

Depois de criada, a instância é operada pela **API pública normal** (`/instances/{id}/token/{token}/*`, webhooks, etc.) — use a skill `integrate-wabox` para essa parte.

## Rotas

| Rota | Body / resposta |
| --- | --- |
| `GET /account/plan` | `{ subscription_status, due_at, instance_slots, instances_used, instances_available }` (`instance_slots`/`instances_available` = `null` em conta Partner) |
| `POST /account/instances` | `{ name*, webhooks?, settings? }` → instância completa com `id`, `token`, `api_url`, `webhooks.secret`. Ocupa um slot (`409 instance_limit_reached` se não há) e já inicia a sessão (status `qr` em segundos) |
| `GET /account/instances?status&q&page&page_size` | `{ data[], page, page_size, total }`; `status` = `connected`\|`disconnected`; `q` busca nome/id/número; itens trazem `token` |
| `GET /account/instances/{id}` | instância |
| `PUT /account/instances/{id}` | parcial: `{ name?, webhooks?, settings? }` (mesmos campos de `PUT /webhooks` e `PUT /settings` da API pública) |
| `POST /account/instances/{id}/rotate-token` | `{ token }` novo; o antigo para na hora |
| `DELETE /account/instances/{id}` | 204; desconecta o aparelho no celular, para a sessão, descarta a fila e **libera o slot** |
| `GET /account/webhooks` · `PUT /account/webhooks` | webhooks do workspace (mesmos campos de `webhooks`, sem `use_workspace_webhooks`) + `secret`, `configured`, `used_by_instances`. Instância criada sem `webhooks` herda URLs, filtros e **este `secret`**; o `secret` nasce no primeiro `PUT` |
| `POST /account/webhooks/secret` | `{ secret }` novo do workspace |

`webhooks`: `received_url, delivery_url, message_status_url, connected_url, disconnected_url, chat_presence_url, single_url_enabled, single_url` (uma URL para tudo), `use_workspace_webhooks` (herdar do workspace; definir uma URL desliga), `notify_sent_by_me, ignore_groups, ignore_private, ignore_text|image|video|audio|document, ignore_*_callback`. `settings`: `auto_read_message, auto_read_status, call_reject_auto, call_reject_message, disable_enqueue_when_disconnected, queue_max_age_hours, delay_message_min_ms, delay_message_max_ms, history_enabled, proxy_url`.

## Modelo de dados no produto do integrador

Por cliente/canal guarde: `wabox_instance_id`, `wabox_token`, `wabox_status` (do último `connected`/`disconnected`), `wabox_phone`. Segredo de assinatura: um só (`GET /account/webhooks`) se as instâncias herdam os webhooks do workspace — recomendado —, senão `wabox_webhook_secret` por instância. Nunca exponha `token`/`secret`/`Account-Token` ao front-end.

## Fluxo recomendado

1. **Webhooks uma vez**: `PUT /account/webhooks` com os `*_url` do seu backend (ou `single_url_enabled` + `single_url`), `notify_sent_by_me: true` (espelha o que o cliente digita no celular); guarde o `secret` da resposta. Depois **criar** ao ativar o canal: `POST /account/instances` só com `name` único (ex.: `"<cliente_id> – <nome>"`) e `settings.call_reject_auto` conforme o produto — a instância herda os webhooks. Passe `webhooks` no `POST` só para um cliente com destino diferente.
2. **Slots**: `409 instance_limit_reached` não é erro transitório — não faça retry. Mostre "limite do plano atingido" no produto e ofereça aumentar o plano ou excluir um canal sem uso; `GET /account/plan` antes de criar evita a tentativa. **Idempotência**: antes de criar, `GET /account/instances?q=<cliente_id>`; se já existe, reutilize. Criação sem resposta (timeout) → listar antes de tentar de novo.
3. **Pareamento**: mostre `GET {api_url}/qr-code` (data URL, rotaciona ~20 s) ou `/qr-code/image`; alternativa `GET {api_url}/phone-code/{phone}`. Considere conectado quando chegar o webhook `connected` (não faça polling agressivo; se precisar, `GET /status` a cada 10 s).
4. **Webhooks**: um endpoint por tipo (ou um só, roteando por `type`/`X-Wabox-Event`); verifique `X-Wabox-Signature` sobre o corpo cru com o `secret` do workspace (ou o da instância, se ela tem `webhooks` próprios) → identifique o cliente por `X-Wabox-Instance-Id` (ou `instance_id` do corpo) → responda 200 → processe. Deduplique por `event_id`.
5. **Desconexões**: `disconnected{reason: "logged_out"}` → marcar canal como "reconectar" e oferecer o QR de novo; `reason: "banned"` → canal inutilizável, precisa de número novo; `network` → ignore, reconecta sozinho.
6. **Cancelamento**: `DELETE /account/instances/{id}` e apague as credenciais locais. Faça sempre: instância parada continua ocupando slot.
7. **Rotação**: se suspeitar de vazamento do token de uma instância, `POST …/rotate-token` e atualize o registro do cliente. Do `Account-Token`: gere outro no painel e troque no segredo do backend.

## Armadilhas

- A assinatura é da conta: `subscription_status`/`due_at` vêm iguais em todas as instâncias, e plano vencido dá `402` nos envios de todas (conta Partner nunca dá `402`). Todo o resto vale: `409 instance_not_connected` em ações imediatas, fila de 1.000, rate limit por instância, IP allowlist do workspace (se preenchida, inclua os IPs de saída do backend).
- `GET /account/instances` lista todas do workspace (paginado). Para milhares de canais, filtre por `q` em vez de paginar tudo a cada sync.
- O `token` da instância aparece na lista e nos detalhes de propósito (o integrador é o dono). Trate a resposta como segredo.
- Configure `PUT /account/webhooks` **antes** de criar a primeira instância: sem URL nenhuma (nem do workspace, nem da instância) o `connected` inicial e as primeiras mensagens se perdem — webhooks não entregues não são recuperáveis.
- Uma instância com `webhooks` próprios tem `secret` próprio; não tente validar a assinatura dela com o `secret` do workspace.
- Migrando canais que hoje rodam em Baileys: a sessão **não** é portável — todo cliente pareia de novo (QR ou pairing code). Veja `../integrate-wabox/references/migrating-from-baileys.md`.

---
name: wabox-partner
description: Integra a Account API do Wabox para criar, atualizar e excluir instâncias de WhatsApp por API em nome dos próprios clientes (integradores como o Kinbox e qualquer conta com plano) — header Account-Token, rotas /account/instances, slots do plano (409 instance_limit_reached), guardar id/token/secret por cliente, QR e operação pela API pública. Use quando o usuário falar em "criar canal de WhatsApp via Wabox", "criar instância por API", "Account API", "Account-Token", "slots", "integrar o Wabox no Kinbox" ou provisionar instâncias automaticamente (a antiga "Partner API"/"Partner-Token" virou isto).
---

# Account API do Wabox

Para quem embute o Wabox num produto (ou provisiona canais por script): cada **canal/número** ganha uma instância criada por API no workspace do integrador. Um cliente final pode ter vários canais. Instale também `integrate-wabox` (referências e scripts compartilhados); `troubleshoot-wabox` auxilia o diagnóstico.

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

**SDK publicado:** `@wabox/sdk@0.1.0` não exporta `createWaboxAccount`; seu `createWaboxPartner` aponta para rotas antigas. Até instalar uma versão com suporte à Account API, use HTTP com `Account-Token`, conforme [../integrate-wabox/references/sdk-compatibility.md](../integrate-wabox/references/sdk-compatibility.md). Nunca adapte apenas o nome do header mantendo `/partner/*`.

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

Por canal guarde: `tenant_id`, `channel_id`, provedor ativo, `wabox_instance_id` (único), `wabox_token`, `wabox_status`, horário do último estado e `wabox_phone`. Segredo de assinatura: um só (`GET /account/webhooks`) se as instâncias herdam os webhooks do workspace, senão `wabox_webhook_secret` por instância. `webhooks.secret` nos detalhes da instância é o segredo **próprio**, mesmo quando ela herda; consulte `use_workspace_webhooks` para escolher o efetivo. Guarde tokens protegidos no backend e autorize operações pelo vínculo tenant/canal. Nunca exponha `token`/`secret`/`Account-Token`/`api_url` ao front-end; o backend retorna apenas QR/status para a UI autorizada.

## Fluxo recomendado

1. **Webhooks uma vez**: `PUT /account/webhooks` com os `*_url` do seu backend (ou `single_url_enabled` + `single_url`), `notify_sent_by_me: true` (espelha o que o cliente digita no celular); guarde o `secret` da resposta. Depois **criar** ao ativar o canal: `POST /account/instances` com nome determinístico por canal (ex.: `"kinbox:<tenant_id>:<channel_id>"`) e `settings.call_reject_auto` conforme o produto — a instância herda os webhooks. Passe `webhooks` no `POST` só para um canal com destino diferente.
2. **Slots e criação**: `409 instance_limit_reached` exige liberar/aumentar slots; `GET /account/plan` é informativo, não reserva vaga. **Não há chave de idempotência nem unicidade de nome na API.** Serialize o provisionamento por `(tenant_id, channel_id)` com lock/restrição local. Use um nome determinístico que inclua os dois IDs (até 80 caracteres) e persista o mapeamento retornado. Em timeout/`5xx`, busque por `q` (busca parcial e paginada) e compare o nome completo; não reutilize a primeira instância do cliente, que pode ser de outro canal. Múltiplos resultados ou criação ainda inconclusiva exigem reconciliação antes de outro POST.
3. **Pareamento**: mostre `GET {api_url}/qr-code` (data URL, rotaciona ~20 s) ou `/qr-code/image`; alternativa `GET {api_url}/phone-code/{phone}`. Considere conectado quando chegar o webhook `connected` (não faça polling agressivo; se precisar, `GET /status` a cada 10 s).
4. **Webhooks**: verifique HMAC sobre o corpo cru com o segredo efetivo → valide envelope → encontre tenant/canal pelo `instance_id` do **corpo assinado** → grave em inbox durável com chave `(instance_id, event_id)` → responda `200` → processe. Headers de roteamento não entram na assinatura; rejeite divergências com o corpo. Com segredo por instância, use o ID não verificado apenas para buscar o segredo, nunca para autorizar. Retorne `5xx` se a persistência falhar. Tolere repetição e chegada fora de ordem; reconcilie status por `GET /status` quando necessário.
5. **Desconexões**: `logged_out` → marcar "reconectar" e oferecer QR; `banned` → suspender envios e encaminhar ao suporte, sem loop de reconexão; `network` → refletir desconexão temporária na UI e aguardar a reconexão do Wabox.
6. **Cancelamento definitivo**: pare novos envios, reconcilie a fila e execute `DELETE /account/instances/{id}`. Só remova credenciais após confirmar exclusão (ou ausência da instância); preserve o vínculo histórico para mensagens e webhooks tardios. Não exclua ao receber mera desconexão: a exclusão descarta sessão/fila e libera slot.
7. **Rotação**: se suspeitar de vazamento do token de uma instância, `POST …/rotate-token` e atualize o registro do cliente. Do `Account-Token`: gere outro no painel e troque no segredo do backend.

## Armadilhas

- A assinatura é da conta: plano vencido dá `402` nos envios e em **toda a Account API** (Partner não exige pagamento, mas continua sujeito a suspensão/allowlist). A API da instância tem rate limit por instância; a Account API tem 60 req/s, rajada 120, compartilhados pelo workspace. `Client-Token` só se aplica à API da instância. Inclua os IPs de saída do backend na allowlist, se ativada.
- `GET /account/instances` lista todas do workspace (paginado). Para milhares de canais, filtre por `q` em vez de paginar tudo a cada sync.
- O `token` da instância aparece na lista e nos detalhes de propósito (o integrador é o dono). Trate a resposta como segredo.
- Configure `PUT /account/webhooks` **antes** de criar a primeira instância: sem URL nenhuma (nem do workspace, nem da instância) o `connected` inicial e as primeiras mensagens se perdem — webhooks não entregues não são recuperáveis.
- Uma instância com `webhooks` próprios tem `secret` próprio; não tente validar a assinatura dela com o `secret` do workspace.
- Migrando canais que hoje rodam em Baileys: a sessão **não** é portável — todo cliente pareia de novo (QR ou pairing code). Veja `../integrate-wabox/references/migrating-from-baileys.md`.

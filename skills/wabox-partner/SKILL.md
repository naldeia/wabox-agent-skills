---
name: wabox-partner
description: Integra a Account API do Wabox para criar, atualizar e excluir instâncias de WhatsApp por API em nome dos próprios clientes (integradores como o Kinbox e qualquer conta com plano) — API key do workspace com permissões/scopes (Authorization: Bearer wbx_key_…), rotas /account/instances, slots do plano (409 instance_limit_reached), erros 401 api_key_required / 403 insufficient_scope, guardar id/token/secret por cliente, QR e operação pela API pública. Use quando o usuário falar em "criar canal de WhatsApp via Wabox", "criar instância por API", "Account API", "API key", "scopes", "Account-Token", "slots", "integrar o Wabox no Kinbox" ou provisionar instâncias automaticamente (a antiga "Partner API"/"Partner-Token" virou a Account API; o header Account-Token foi substituído por API keys).
---

# Account API do Wabox

Para quem embute o Wabox num produto (ou provisiona canais por script): cada **canal/número** ganha uma instância criada por API no workspace do integrador. Um cliente final pode ter vários canais. Instale também `integrate-wabox` (referências e scripts compartilhados); `troubleshoot-wabox` auxilia o diagnóstico.

**O plano é por slots, não por instância.** A conta compra N slots (canais) na mensalidade e pode criar, atualizar e excluir instâncias à vontade enquanto tiver no máximo N ao mesmo tempo. Toda instância existente ocupa um slot (conectada ou não, criada no painel ou pela API); excluir libera o slot na hora. Não existe assinatura/cancelamento por instância.

- **Conta em trial não usa a Account API** (`403 plan_required`): o trial cria a instância pelo painel.
- **Conta Partner** (contrato próprio, ex.: Kinbox): mesma API, sem limite de slots e sem cobrança no Wabox (`instance_slots: null`, `subscription_status: "partner"`).

```
Base:   https://api.wabox.me/account
Header: Authorization: Bearer wbx_key_<48 hex>   (API key do workspace; Segurança › API keys no painel; mostrada uma vez)
Erros:  { "error": { "code", "message", "details"? } }   — api_key_required (401, key ausente/inválida/de outro workspace),
        insufficient_scope (403, key sem a permissão da rota; details.required_scope), plan_required (403, trial),
        subscription_required (402, plano vencido), instance_limit_reached (409, slots cheios; details.instance_slots / instances_used),
        ip_not_allowed, workspace_suspended, instance_not_found, invalid_request, rate_limited
```

Depois de criada, a instância é operada pela **API pública normal** (`/instances/{id}/token/{token}/*`, webhooks, etc.) — use a skill `integrate-wabox` para essa parte.

**SDK publicado:** confira a versão instalada. O cliente atual é `createWaboxAccount({ apiKey })` (variável sugerida: `WABOX_API_KEY`). `@wabox/sdk@0.1.0` só tem `createWaboxPartner` (rotas antigas) e `@wabox/sdk@0.1.1` tem `createWaboxAccount({ accountToken })`, que envia o header antigo e recebe `401 api_key_required`. Até instalar uma versão cuja opção seja `apiKey`, use HTTP com `Authorization: Bearer`, conforme [../integrate-wabox/references/sdk-compatibility.md](../integrate-wabox/references/sdk-compatibility.md). Nunca adapte apenas o nome do header mantendo `/partner/*`.

## Credencial: API key com permissões

Owner/admin cria a key em **Segurança › API keys**, com **nome** e **permissões (scopes)**. O workspace pode ter várias keys; o valor bruto aparece **uma vez** na criação (depois a lista mostra só uma dica como `wbx_key_3f9a…c2e1`, as permissões e o último uso). A Account API aceita **somente** `Authorization: Bearer` — o header `Client-Token` é um alias válido apenas nas rotas de instância.

| Scope | Rotas |
| --- | --- |
| `instances:read` | `GET /account/instances`, `GET /account/instances/{id}`, `GET /account/plan` |
| `instances:write` | `POST /account/instances`, `PUT /account/instances/{id}`, `POST /account/instances/{id}/rotate-token`, `DELETE /account/instances/{id}` |
| `webhooks:read` | `GET /account/webhooks` |
| `webhooks:write` | `PUT /account/webhooks`, `POST /account/webhooks/secret` |
| `instances:operate` | não é da Account API: torna a key válida nas rotas `/instances/{id}/token/{token}/*` quando o workspace liga "Exigir API key nas rotas de instância" |

**Peça o mínimo.** Provisionamento: `instances:read` + `instances:write`. Acrescente `webhooks:read`/`webhooks:write` só se a integração gerencia os webhooks do workspace por API (passo 1 do fluxo abaixo; quem configura pelo painel precisa no máximo de `webhooks:read` para ler o `secret`). `instances:operate` só se o workspace exige API key nas rotas de instância — de preferência em uma key separada, usada pelo serviço que envia mensagens. `403 insufficient_scope` informa a permissão que falta em `error.details.required_scope`; ela pode ser adicionada à key existente no painel, sem criar outra.

**Legado (antes de 2026-09-21):** a credencial era o header `Account-Token: act_…` (erro `401 account_token_required`). Valores `act_…` **não funcionam mais** e não foram migrados: crie uma API key com as permissões necessárias e troque header e segredo no backend.

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

`webhooks`: `received_url, delivery_url, message_status_url, instance_status_url, chat_presence_url, single_url_enabled, single_url` (uma URL para tudo; workspace novo já nasce com `single_url_enabled: true`, basta enviar `single_url` em `PUT /account/webhooks`), `use_workspace_webhooks` (herdar do workspace; definir uma URL desliga), `notify_sent_by_me, ignore_groups, ignore_private, ignore_text|image|video|audio|document, ignore_*_callback`. `settings`: `auto_read_message, auto_read_status, call_reject_auto, call_reject_message, disable_enqueue_when_disconnected, queue_max_age_hours, delay_message_min_ms, delay_message_max_ms, history_enabled, proxy_url`.

## Modelo de dados no produto do integrador

Por canal guarde: `tenant_id`, `channel_id`, provedor ativo, `wabox_instance_id` (único), `wabox_token`, `wabox_status`, horário do último estado e `wabox_phone`. Segredo de assinatura: um só (`GET /account/webhooks`) se as instâncias herdam os webhooks do workspace, senão `wabox_webhook_secret` por instância. `webhooks.secret` nos detalhes da instância é o segredo **próprio**, mesmo quando ela herda; consulte `use_workspace_webhooks` para escolher o efetivo. Guarde tokens protegidos no backend e autorize operações pelo vínculo tenant/canal. Nunca exponha `token`/`secret`/API key/`api_url` ao front-end; o backend retorna apenas QR/status para a UI autorizada.

## Fluxo recomendado

1. **Webhooks uma vez** (key com `webhooks:write`; ou configure pelo painel): `PUT /account/webhooks` com os `*_url` do seu backend (ou `single_url_enabled` + `single_url`), `notify_sent_by_me: true` (espelha o que o cliente digita no celular); guarde o `secret` da resposta. Depois **criar** ao ativar o canal: `POST /account/instances` com nome determinístico por canal (ex.: `"kinbox:<tenant_id>:<channel_id>"`) e `settings.call_reject_auto` conforme o produto — a instância herda os webhooks. Passe `webhooks` no `POST` só para um canal com destino diferente.
2. **Slots e criação**: `409 instance_limit_reached` exige liberar/aumentar slots; `GET /account/plan` é informativo, não reserva vaga. **Não há chave de idempotência nem unicidade de nome na API.** Serialize o provisionamento por `(tenant_id, channel_id)` com lock/restrição local. Use um nome determinístico que inclua os dois IDs (até 80 caracteres) e persista o mapeamento retornado. Em timeout/`5xx`, busque por `q` (busca parcial e paginada) e compare o nome completo; não reutilize a primeira instância do cliente, que pode ser de outro canal. Múltiplos resultados ou criação ainda inconclusiva exigem reconciliação antes de outro POST.
3. **Pareamento**: mostre `GET {api_url}/qr-code` (data URL, rotaciona ~20 s) ou `/qr-code/image`; alternativa `GET {api_url}/phone-code/{phone}`. Acompanhe pelo webhook `instance_status` (`qr` = aguardando leitura, `logged_out` = mostrar o QR de novo; o código do QR não vem no evento) e considere conectado quando ele chegar com `status: "connected"` (traz `phone`) (não faça polling agressivo; se precisar, `GET /status` a cada 10 s).
4. **Webhooks**: verifique HMAC sobre o corpo cru com o segredo efetivo → valide envelope → encontre tenant/canal pelo `instance_id` do **corpo assinado** → grave em inbox durável com chave `(instance_id, event_id)` → responda `200` → processe. Headers de roteamento não entram na assinatura; rejeite divergências com o corpo. Com segredo por instância, use o ID não verificado apenas para buscar o segredo, nunca para autorizar. Retorne `5xx` se a persistência falhar. Tolere repetição e chegada fora de ordem; reconcilie status por `GET /status` quando necessário.
5. **Desconexões**: `logged_out` → marcar "reconectar" e oferecer QR; `banned` → suspender envios e encaminhar ao suporte, sem loop de reconexão; `network` → refletir desconexão temporária na UI e aguardar a reconexão do Wabox.
6. **Cancelamento definitivo**: pare novos envios, reconcilie a fila e execute `DELETE /account/instances/{id}`. Só remova credenciais após confirmar exclusão (ou ausência da instância); preserve o vínculo histórico para mensagens e webhooks tardios. Não exclua ao receber mera desconexão: a exclusão descarta sessão/fila e libera slot.
7. **Rotação**: se suspeitar de vazamento do token de uma instância, `POST …/rotate-token` e atualize o registro do cliente. Da API key, sem downtime: crie uma key nova com as mesmas permissões, publique o backend com ela e só então revogue a antiga — revogar é imediato e não afeta as outras keys.

## Armadilhas

- A assinatura é da conta: plano vencido dá `402` nos envios e em **toda a Account API** (Partner não exige pagamento, mas continua sujeito a suspensão/allowlist). A API da instância tem rate limit por instância; a Account API tem 60 req/s, rajada 120, compartilhados pelo workspace. Se o workspace liga "Exigir API key nas rotas de instância", a operação das instâncias também precisa de uma key com `instances:operate` (detalhes na skill `integrate-wabox`); as permissões `instances:read`/`write` não bastam lá e o inverso também vale. Inclua os IPs de saída do backend na allowlist, se ativada.
- `GET /account/instances` lista todas do workspace (paginado). Para milhares de canais, filtre por `q` em vez de paginar tudo a cada sync.
- O `token` da instância aparece na lista e nos detalhes de propósito (o integrador é o dono). Trate a resposta como segredo.
- Configure `PUT /account/webhooks` **antes** de criar a primeira instância: sem URL nenhuma (nem do workspace, nem da instância) o `instance_status` inicial e as primeiras mensagens se perdem — webhooks não entregues não são recuperáveis.
- Uma instância com `webhooks` próprios tem `secret` próprio; não tente validar a assinatura dela com o `secret` do workspace.
- Migrando canais que hoje rodam em Baileys: a sessão **não** é portável — todo cliente pareia de novo (QR ou pairing code). Veja `../integrate-wabox/references/migrating-from-baileys.md`.

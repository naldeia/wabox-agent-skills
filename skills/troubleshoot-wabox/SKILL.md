---
name: troubleshoot-wabox
description: Diagnostica problemas com a API de WhatsApp do Wabox: mensagem "não chegou", webhook que não dispara, instância que cai ou pede QR de novo, erros 401/402/403/409/429 (api_key_required, insufficient_scope, antigos client_token_required/account_token_required), error_code no delivery (phone_not_on_whatsapp, message_not_found, send_timeout, shadow_ban), suspeita de banimento, histórico de mensagens vazio (GET /chats/{phone}/messages). Use quando o usuário relatar que algo do Wabox parou de funcionar ou pedir para investigar logs/entregas.
---

# Diagnosticar o Wabox

Comece pelos fatos, nesta ordem: status da instância, resposta HTTP da chamada, webhook `delivery`, recibos `message_status` e logs de webhook no painel. Instale também `integrate-wabox` e use `../integrate-wabox/scripts/wabox.sh` para consultar (`WABOX_INSTANCE_ID`/`WABOX_TOKEN`, mais `WABOX_API_KEY` se o workspace exige API key). Diagnóstico começa por leituras; restart, reenvio, troca de webhook e exclusão alteram a operação e devem estar no escopo autorizado. Não redirecione webhooks de clientes reais para um sink de teste.

## 1. A instância está conectada?

Rode `wabox.sh GET status` e leia o `status`:

| `status` | Significado | Ação |
| --- | --- | --- |
| `connected` | ok | siga para o passo 2 |
| `qr` / `logged_out` | aparelho removido no celular ou nunca pareado | novo QR (`GET /qr-code`) ou `GET /phone-code/{phone}` |
| `disconnected` / `connecting` | queda de rede ou outra sessão web assumiu; reconecta sozinha | espere; se persistir > 2 min, `POST /restart` |
| `disconnected` nunca pareada (`instance_status` com `disconnect_reason: qr_timeout`) | o QR ficou ~13 min sem leitura e o pareamento parou (não é bug) | `GET /qr-code` recomeça o pareamento com QR novo |
| `starting` | sessão carregando | espere segundos |
| `banned` | bloqueio reportado pelo WhatsApp | suspenda envios e investigue com suporte; não presuma bloqueio permanente nem entre em loop de restart |

É uma conexão linked device. Não use `smartphone_connected: false` isoladamente para concluir que o celular está sem internet: no fallback sem resposta do engine esse campo reflete o último status da instância.

## 2. "Enviei e não chegou"

1. A chamada `POST /send-*` respondeu `200 { wabox_id, status: "queued" }`? Se não, veja o erro HTTP (tabela em `../integrate-wabox/references/errors.md`).
2. A mensagem ainda está na fila? Confira com `wabox.sh GET 'queue?page_size=50'`. Se estiver, a instância está desconectada ou a fila é longa (1–3 s entre mensagens; 1.000 msgs ≈ 30–50 min).
3. Chegou `delivery` com o mesmo `wabox_id`?
   - Sem `error_code`, a mensagem saiu do aparelho. Se o contato não recebeu, olhe `message_status`. Sem nenhum `RECEIVED`, o contato está sem internet, bloqueou o número ou há shadow ban.
   - Com `phone_not_on_whatsapp`, confira `GET /phone-exists/{phone}` (nono dígito, DDI).
   - `message_not_found` indica encaminhamento/edição de legenda fora do cache, ou voto sem o segredo da enquete original. Não reenvie como mensagem nova automaticamente; confira a ação solicitada.
   - `media_download_failed` e `media_invalid` indicam URL não pública, lenta, ou acima de 16 MB/100 MB. Teste a URL com `curl -I` e use base64.
   - `send_timeout` indica que o aparelho não confirmou, e a mensagem pode ter saído. Não reenvie às cegas; olhe `message_status`.
   - `queue_expired` indica que a mensagem esperou mais que `queue_max_age_hours` (padrão 12 h) na fila, quase sempre porque a instância ficou desconectada. Nada saiu, e reenviar é seguro. Se acontece muito, o problema é a conexão (seção 1), não o envio.
   - Em `shadow_ban`, pare os envios e veja a seção 5.
   - `not_allowed` indica que o contato bloqueou, o grupo é só para admins ou falta permissão no canal.
4. Sem nenhum `delivery`, o webhook não está configurado ou não chega (seção 3), ou a mensagem ainda está na fila.

## 3. "Webhook não chega"

1. Rode `wabox.sh GET webhooks`. Se `use_workspace_webhooks: true`, consulte `GET /account/webhooks` ou o painel para ver URLs/filtros/segredo efetivos; o GET da instância mostra os próprios. `single_url_enabled` usa a URL única. `received`, `delivery` e `message_status` são eventos distintos. Filtros podem descartar eventos e mensagens próprias exigem `notify_sent_by_me`.
2. O endpoint responde `2xx` em < 10 s? Falhas são reentregues em `10s, 1m, 10m, 1h, 6h` e depois descartadas. Painel › instância › Logs de webhook mostra status HTTP, duração e erro de cada tentativa, com reenvio manual.
3. Está respondendo `401` porque a assinatura falha? Confira corpo cru, segredo efetivo (workspace × instância), rotação e relógio (> 5 min). Capture corpo/header originais no receptor de teste: o log do painel pode truncar o payload e não traz a assinatura original, então não serve como fixture HMAC completa. Mantenha o segredo anterior durante toda a janela de retry (~7 h 11 min + margem).
4. Para isolar o seu servidor: suba `../integrate-wabox/scripts/webhook-sink.ts` num túnel e aponte a instância para ele. Se chega no sink e não no seu servidor, o problema é seu endpoint (firewall, HTTPS inválido, redirect, body parser).
5. Um `event_id` repetido é uma reentrega, porque o seu endpoint demorou ou falhou antes. Deduplique.

## 4. Erros HTTP recorrentes

| Sintoma | Causa provável |
| --- | --- |
| `401 instance_not_found` | token rotacionado no painel, ou `instance_id`/`token` trocados na URL |
| `401 api_key_required` (rotas de instância) | workspace ligou "Exigir API key nas rotas de instância" e a chamada não traz uma key válida: header ausente, key revogada, digitada errado ou de outro workspace. Envie `Authorization: Bearer wbx_key_…` (ou a mesma key no header `Client-Token`, alias z-api) |
| `401 api_key_required` (Account API) | `/account/*` sempre exige key, e só em `Authorization: Bearer` (`Client-Token` não vale aqui). Integração ainda mandando `Account-Token: act_…`? Esses valores deixaram de funcionar. Crie uma API key com as permissões necessárias |
| `403 insufficient_scope` | a key é válida, mas não tem a permissão da rota. Leia `error.details.required_scope` (`instances:operate` nas rotas de instância; `instances:read`/`instances:write`/`webhooks:read`/`webhooks:write` na Account API) e edite as permissões da key em Segurança › API keys. Não precisa criar outra |
| `403 ip_not_allowed` | allowlist de IPs do workspace não inclui o IP de saída (NAT, cloud com IP dinâmico) |
| `402 subscription_required` | plano venceu: envios da API da instância e todas as rotas da Account API são bloqueados |
| `409 instance_limit_reached` (Account API) | todos os slots do plano estão em uso. Exclua uma instância ou aumente o plano; `GET /account/plan` mostra o uso |
| `403 plan_required` (Account API) | conta em trial. Criar instância por API exige plano |
| `409 instance_not_connected` | ação imediata (contatos, grupos, read, presence) com instância fora |
| `429 queue_full` | 1.000 msgs na fila |
| `429 rate_limited` | > 60 req/s por instância (polling agressivo de `/status` ou `/qr-code` conta) |
| `502 action_failed` | aparelho falhou ao executar; leituras podem repetir, escritas exigem reconciliação |

### 401/403 de credencial: como isolar

1. Qual credencial falhou? `instance_not_found` aponta para `instance_id`/`token` da URL; `api_key_required` e `insufficient_scope` apontam para a API key do workspace (`wbx_key_` + 48 hex). O token da URL não mudou e continua sendo a credencial base das rotas de instância.
2. `api_key_required` numa rota de instância só aparece com a exigência ligada. Confira em Segurança › API keys se a key ainda existe (a lista mostra a dica `wbx_key_3f9a…c2e1`, as permissões e o último uso, que ajuda a saber se a key que o backend usa é a que você imagina). Teste com `WABOX_API_KEY=… wabox.sh GET status`.
3. Em `insufficient_scope`, acrescente a permissão de `details.required_scope` à key existente. A mudança vale na hora, sem redeploy.
4. Parou logo após uma rotação? Revogar é imediato. Para rotacionar sem downtime, crie a key nova, publique e só então revogue a antiga.
5. No MCP (`/mcp`) com o token da instância em `Authorization: Bearer`, a API key vai no header `Client-Token`, porque o `Authorization` já está ocupado. Conexões por OAuth ficam isentas da exigência de key e da allowlist de IPs.
6. Códigos legados, de antes de 2026-09-21: `401 client_token_required` e `401 account_token_required` viraram `api_key_required`. Client-Tokens daquela época foram migrados para a key "Client-Token (migrado)" (`instances:operate`) e continuam válidos no header `Client-Token`; `Account-Token` não foi migrado.

## 5. Suspeita de banimento / entrega ruim

Sinais: `delivery.error_code = shadow_ban`; muitas mensagens com `delivery` ok e sem `RECEIVED`; queda brusca de respostas; `instance_status{status: banned}`.

Ações: parar campanhas, deixar o número descansar dias, aumentar `delay_message_min_ms/max_ms` (`PUT /settings`, ex. 2000–6000), ligar `delay_typing`, só enviar para quem respondeu/opt-in, conferir números com `phone-exists-batch`, variar o texto, evitar links encurtados. Número novo: aquecer por dias antes de volume. Campanha fria em volume é caso para a API oficial, não para linked device.

## 6. Histórico de mensagens vazio ou incompleto

`GET /chats/{phone}/messages` traz só as mensagens recentes que o celular envia ao parear, até 50 por conversa. Não é o histórico completo e não recebe mensagens novas, que chegam só por webhook.

| Sintoma | Causa provável |
| --- | --- |
| `enabled: false` e `messages: []` | `settings.history_enabled` está desligado (`GET /settings`). Religar não traz nada de volta; só um novo pareamento reenvia o histórico |
| `enabled: true`, `messages: []`, `synced_at: null` | O celular não incluiu essa conversa no sync (sem atividade recente) ou o sync ainda está chegando. Confira o `phone` (mesmo formato de `GET /chats`: dígitos, `<id>-group`, `<lid>@lid`) |
| Algumas conversas vazias logo após parear | O celular envia em lotes durante alguns minutos e não há webhook de fim. Leia de novo depois |
| Tudo sumiu | Houve logout (pelo painel, pela API ou pelo celular) ou exclusão da instância, e o Wabox apagou o histórico. Só volta pareando de novo |
| Mensagens recentes não aparecem | Comportamento esperado. Depois do pareamento, o tráfego vem só por webhook |
| Mídia sem arquivo (`download_error: "media not downloaded (history sync)"`) | Comportamento esperado. O sync guarda só os metadados da mídia |
| `503 history_not_configured` | O histórico não está habilitado neste servidor. O problema é do lado do Wabox; encaminhe ao suporte |

## 7. Recursos best effort quebraram após atualização do WhatsApp

Botões/lista/carrossel, catálogo/business e etiquetas usam formatos internos do WhatsApp Web. Se pararam de funcionar de repente: (1) rode a aba Testes da instância no painel (envia cada tipo para um número seu e acompanha `delivery`/recibos); (2) confira o changelog em developer.wabox.me/resources/changelog; (3) use o fallback em texto enquanto isso. Botões nunca renderizam no WhatsApp Web/Desktop. Isso não é bug.

## 8. O que mandar para o suporte

`instance_id`, rota chamada, `wabox_id`/`message_id` da resposta, status HTTP e `error.code` (e `error.details`), `event_id` do webhook e horário (UTC). Nunca envie o `token` nem a API key, só a dica exibida no painel (`wbx_key_3f9a…c2e1`).

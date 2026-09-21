---
name: troubleshoot-wabox
description: Diagnostica problemas com a API de WhatsApp do Wabox — mensagem "não chegou", webhook que não dispara, instância que cai ou pede QR de novo, erros 401/402/409/429, error_code no delivery (phone_not_on_whatsapp, message_not_found, send_timeout, shadow_ban), suspeita de banimento. Use quando o usuário relatar que algo do Wabox parou de funcionar ou pedir para investigar logs/entregas.
---

# Diagnosticar o Wabox

Comece sempre pelos fatos, na ordem: **status da instância → resposta HTTP da chamada → webhook `delivery` → recibos `message_status` → logs de webhook no painel**. Use `../integrate-wabox/scripts/wabox.sh` para consultar (`WABOX_INSTANCE_ID`/`WABOX_TOKEN`).

## 1. A instância está conectada?

`wabox.sh GET status` → `status`:

| `status` | Significado | Ação |
| --- | --- | --- |
| `connected` | ok | siga para o passo 2 |
| `qr` / `logged_out` | aparelho removido no celular ou nunca pareado | novo QR (`GET /qr-code`) ou `GET /phone-code/{phone}` |
| `disconnected` / `connecting` | queda de rede ou outra sessão web assumiu; reconecta sozinha | espere; se persistir > 2 min, `POST /restart` |
| `starting` | sessão carregando | espere segundos |
| `banned` | número banido pelo WhatsApp | não volta; trocar de número, ler anti-ban |

Celular precisa existir e abrir o WhatsApp de tempos em tempos (é linked device). `smartphone_connected: false` por muito tempo = celular sem internet.

## 2. "Enviei e não chegou"

1. A chamada `POST /send-*` respondeu `200 { wabox_id, status: "queued" }`? Se não, veja o erro HTTP (tabela em `../integrate-wabox/references/errors.md`).
2. A mensagem ainda está na fila? `wabox.sh GET 'queue?page_size=50'` → se sim, instância desconectada ou fila longa (1–3 s entre mensagens; 1.000 msgs ≈ 30–50 min).
3. Chegou `delivery` com o mesmo `wabox_id`?
   - **sem `error_code`** → saiu do aparelho. Se o contato não recebeu, olhe `message_status`: parado em `SENT` sem `RECEIVED` = contato sem internet, bloqueou o número, ou shadow ban.
   - `phone_not_on_whatsapp` → confira `GET /phone-exists/{phone}` (nono dígito, DDI).
   - `message_not_found` → a referência (reply/forward/edit/vote) saiu do cache do engine (restart ou > ~4.000 msgs). Reenvie sem a referência.
   - `media_download_failed` / `media_invalid` → URL não pública, lenta, ou acima de 16 MB/100 MB; teste a URL com `curl -I`; use base64.
   - `send_timeout` → aparelho não confirmou; pode ter saído. Não reenvie às cegas; olhe `message_status`.
   - `queue_expired` → esperou mais que `queue_max_age_hours` (padrão 12 h) na fila, quase sempre porque a instância ficou desconectada; nada saiu, reenviar é seguro. Se acontece muito, o problema é a conexão (seção 2), não o envio.
   - `shadow_ban` → **pare os envios**. Ver seção 5.
   - `not_allowed` → contato bloqueou, grupo só para admins, sem permissão no canal.
4. Sem `delivery` nenhum → o webhook não está configurado/chegando (seção 3) ou a mensagem ainda está na fila.

## 3. "Webhook não chega"

1. `wabox.sh GET webhooks` → a URL do tipo certo está preenchida? `received` ≠ `delivery` ≠ `message_status`. Filtros `ignore_*` podem estar descartando (grupos, tipos de mídia); `received` **não** inclui as próprias mensagens sem `notify_sent_by_me`.
2. O endpoint responde `2xx` em < 10 s? Falhas são reentregues em `10s, 1m, 10m, 1h, 6h` e depois descartadas. Painel › instância › **Logs de webhook** mostra status HTTP, duração e erro de cada tentativa, com reenvio manual.
3. Está respondendo `401` porque a verificação de assinatura falha? Causas: corpo re-serializado em vez do cru; segredo de outra instância; segredo rotacionado (entregas antigas usam o anterior); relógio do servidor fora (> 5 min). Teste com `../integrate-wabox/scripts/verify-signature.ts` passando o corpo e header exatos do log.
4. Para isolar o seu servidor: suba `../integrate-wabox/scripts/webhook-sink.ts` num túnel e aponte a instância para ele. Se chega no sink e não no seu servidor, o problema é seu endpoint (firewall, HTTPS inválido, redirect, body parser).
5. `event_id` repetido = reentrega (o seu endpoint demorou ou falhou antes); deduplique.

## 4. Erros HTTP recorrentes

| Sintoma | Causa provável |
| --- | --- |
| `401 instance_not_found` | token rotacionado no painel, ou `instance_id`/`token` trocados na URL |
| `401 client_token_required` | workspace ativou Client-Token e a integração não envia o header |
| `403 ip_not_allowed` | allowlist de IPs do workspace não inclui o IP de saída (NAT, cloud com IP dinâmico) |
| `402 subscription_required` | trial venceu; só envios são bloqueados |
| `409 instance_not_connected` | ação imediata (contatos, grupos, read, presence) com instância fora |
| `429 queue_full` | 1.000 msgs na fila |
| `429 rate_limited` | > 60 req/s por instância (polling agressivo de `/status` ou `/qr-code` conta) |
| `502 action_failed` | aparelho falhou ao executar; comum no primeiro `GET /labels` após restart. Repita |

## 5. Suspeita de banimento / entrega ruim

Sinais: `delivery.error_code = shadow_ban`; muitas mensagens paradas em `SENT`; queda brusca de respostas; `disconnected{reason: banned}`.

Ações: parar campanhas, deixar o número descansar dias, aumentar `delay_message_min_ms/max_ms` (`PUT /settings`, ex. 2000–6000), ligar `delay_typing`, só enviar para quem respondeu/opt-in, conferir números com `phone-exists-batch`, variar o texto, evitar links encurtados. Número novo: aquecer por dias antes de volume. Campanha fria em volume é caso para a API oficial, não para linked device.

## 6. Recursos best effort quebraram após atualização do WhatsApp

Botões/lista/carrossel, catálogo/business e etiquetas usam formatos internos do WhatsApp Web. Se pararam de funcionar de repente: (1) rode a aba **Testes** da instância no painel (envia cada tipo para um número seu e acompanha `delivery`/recibos); (2) confira o changelog em developer.wabox.me/resources/changelog; (3) use o fallback em texto enquanto isso. Botões nunca renderizam no WhatsApp Web/Desktop — isso não é bug.

## 7. O que mandar para o suporte

`instance_id`, rota chamada, `wabox_id`/`message_id` da resposta, status HTTP + `error.code`, `event_id` do webhook e horário (UTC). Nunca o `token`.

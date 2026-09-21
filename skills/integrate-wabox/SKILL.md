---
name: integrate-wabox
description: Integra a API de WhatsApp do Wabox (api.wabox.me) em qualquer código — conectar um número por QR/pairing, enviar texto/mídia/interativos, receber webhooks (received, delivery, message_status, connected, disconnected), verificar a assinatura HMAC, tratar fila, erros e rate limit. Use quando o usuário pedir para "enviar WhatsApp pelo Wabox", "receber mensagens do Wabox", "criar canal de WhatsApp com Wabox", migrar do z-api ou de Baileys/whatsapp-web.js, ou sempre que aparecer uma URL /instances/{id}/token/{token}.
---

# Integrar o Wabox

API REST não-oficial de WhatsApp (linked device). Uma **instância** = um número. Tudo é `snake_case`, datas ISO-8601 UTC, erros `{ "error": { "code", "message" } }`.

```
BASE = https://api.wabox.me/instances/{instance_id}/token/{token}
```

Docs completas: https://developer.wabox.me (`/llms.txt` para índice, `/llms-full.txt` para tudo). Visão geral do produto para agentes: https://wabox.me/llms.txt. OpenAPI: https://api.wabox.me/openapi.json.

**Projeto em TypeScript/JavaScript?** Use o SDK oficial em vez de um cliente à mão: `npm install @wabox/sdk` → `createWabox({ instanceId, token })` (rotas relativas: `wabox.POST("/send-text", { body })`, retorno `{ data, error }` tipado) e `constructWebhookEvent({ body, headers, secret })` para verificar a assinatura e tipar o evento. Docs: https://developer.wabox.me/integrations/sdk-typescript.

**Confirme a versão instalada antes de copiar exemplos.** O npm `@wabox/sdk@0.1.0` ainda usa a antiga Partner API no cliente de provisionamento, embora `createWabox` e os helpers de webhook estejam disponíveis. Para Account API/campos novos, siga [references/sdk-compatibility.md](references/sdk-compatibility.md): use HTTP conforme o OpenAPI atual enquanto a versão publicada não incluir esses recursos. Não importe `createWaboxAccount` só porque existe no código-fonte/docs.

## Fluxo padrão de integração

1. **Credenciais**: `instance_id` e `token` vêm do painel ou da Account API (skill `wabox-partner`). Para um número, use variáveis de ambiente; em um SaaS, guarde as credenciais protegidas por canal e o vínculo com o tenant. `Client-Token` também é obrigatório na API da instância se ativado no workspace (`clientToken` no SDK). Nunca exponha tokens no front-end nem em logs (a URL contém o token — mascare).
2. **Conectar**: `GET /status` → se `status: "qr"`, mostre `GET /qr-code` (`value` = data URL PNG, rotaciona a cada ~20 s) ou `GET /phone-code/{phone}` (código de pareamento). Prefira o webhook `connected` a fazer polling; se precisar, consulte a cada 10 s.
3. **Webhooks**: configure antes de parear. `PUT /webhooks` com `received_url`, `delivery_url`, `message_status_url`, `connected_url`, `disconnected_url`, `chat_presence_url` — ou `{ "single_url_enabled": true, "single_url": "https://..." }`. Definir uma URL na instância desliga `use_workspace_webhooks`. Com configuração própria, use o `secret` de `GET /webhooks`; com herança, use o de `GET /account/webhooks` (o GET da instância mostra os campos próprios, não os efetivos). **Verifique `X-Wabox-Signature` sobre o corpo cru** e roteie pelo `type` e `instance_id` do corpo verificado.
4. **Enviar**: `POST /send-text { phone, message }`. Resposta imediata `{ id, message_id, wabox_id, status: "queued" }`; o resultado real chega no webhook `delivery` (mesmo `wabox_id`/`message_id`).
5. **Receber**: valide a assinatura → grave o evento em inbox/fila durável com deduplicação por `(instance_id, event_id)` → responda `200` → processe em worker. Se não conseguiu persistir, retorne `5xx` para permitir reentrega. Há mensagens com bloco de conteúdo (`text`, `image`, …), notificações e placeholders sem esse bloco. Não dependa da ordem de chegada dos eventos.

Veja `references/endpoints.md` (rotas e bodies), `references/webhooks.md` (payloads), `references/errors.md` (códigos e política de retry), `references/migrating-from-baileys.md` (de/para Baileys → Wabox).

## Regras que evitam bugs comuns

- `phone` só dígitos com DDI (`5511988887777`). Também aceita `<id>-group`, `<id>@newsletter`, `<id>@lid`. Sem `+`, espaços ou traços.
- **Envio não é idempotente.** Timeout/rede/`5xx` podem deixar o resultado desconhecido. Não repita automaticamente: reconcilie pela fila e pelos webhooks. Ausência em `GET /queue` não prova que não enviou, e sem os IDs da resposta pode não haver correlação inequívoca. Guarde uma operação local antes da chamada e `wabox_id` assim que chegar; encaminhe casos inconclusivos para revisão.
- `delivery` = saiu do aparelho. "Chegou" = `message_status` `RECEIVED`; "leu" = `READ`.
- Instância desconectada: a fila **segura** as mensagens (máx. 1.000) e drena ao reconectar; o que espera mais que `queue_max_age_hours` (padrão 12 h, 1–168) é descartado com `delivery` `error_code: queue_expired` (reenviar é seguro). Para conteúdo sensível a tempo (códigos OTP), use validade curta, confira `GET /status` antes ou ligue `disable_enqueue_when_disconnected` e trate `409`.
- Encaminhar e editar legenda dependem do cache recente do engine (~4.000 msgs, some no restart) → `message_not_found`. Votar exige o segredo da enquete original conhecido pelo engine. Citação fora do cache é best effort; editar texto e reagir não têm a mesma exigência de cache. Informe autoria/participante nas ações que aceitam esses campos e homologue mensagens antigas e grupos.
- Mídia recebida: `url` assinada expira em **24 h**. Copie para o seu storage.
- Histórico: o Wabox **não** guarda mensagens. A única exceção é `GET /chats/{phone}/messages`: até 50 mensagens recentes por conversa vindas do sync do pareamento (sem mídia, não acompanha o tráfego ao vivo; `settings.history_enabled`). Quem persiste a conversa é o seu sistema, a partir dos webhooks.
- Mídia enviada: `image`/`audio`/`video`/`document` aceitam URL pública **ou** base64 (`data:mime;base64,…`). Limites 16 MB (mídia) / 100 MB (documento), mas body HTTP de 64 MB: documentos grandes precisam de URL, pois base64 aumenta o tamanho. A URL deve continuar acessível até o envio efetivo na fila. `send-audio` sai como voice note por padrão (`ptt: false` = arquivo de áudio).
- Botões/lista/carrossel são **best effort**: renderizam no celular, **não** no WhatsApp Web/Desktop. Tenha fallback em texto.
- Rate limit por instância: 60 req/s (rajada 120) → `429` + `Retry-After`. O gargalo real é o intervalo anti-ban da fila (1–3 s entre mensagens).
- Grupos: em `received`, `phone` é o grupo e `participant_phone` quem escreveu. Guarde `chat_lid`/`sender_lid` junto com `phone` (WhatsApp está migrando para LID).
- Na API da instância, `402 subscription_required` bloqueia envios; leitura, status e webhooks continuam. Na **Account API**, plano vencido bloqueia todas as rotas. A assinatura é do workspace, por slots.

## Scripts

- `scripts/wabox.sh GET status` · `scripts/wabox.sh POST send-text '{"phone":"55…","message":"oi"}'` — curl com `WABOX_INSTANCE_ID`/`WABOX_TOKEN` do ambiente (`WABOX_API_URL` para outro host).
- `scripts/webhook-sink.ts` — servidor local (`bun`/`node`) que recebe entregas, verifica assinatura e lista em `GET /events`. Exponha com ngrok/cloudflared e aponte `PUT /webhooks` para ele.
- `scripts/verify-signature.{ts,go,php}` — implementações de referência da verificação HMAC para copiar no projeto do usuário (em TS, prefira `@wabox/sdk/webhooks`).

## Ao escrever código para o usuário

- Em TS/JS: `@wabox/sdk` (ESM, Node ≥ 20 ou Bun; confirme compatibilidade com o runtime do projeto). Em outras linguagens, cliente HTTP com `BASE` + keep-alive e timeout explícito. Retry de leituras com backoff; para escritas, siga `references/errors.md` e nunca aplique retry genérico de rede/`5xx`.
- Um handler por tipo, **corpo cru** para HMAC e inbox durável antes do `200`. O SDK verifica assinatura/JSON/tipo do evento, mas não valida todo o schema em runtime nem vincula headers ao corpo: valide campos usados e rejeite divergências de `instance_id`, `event_id` ou `type` nos headers.
- Modelo local: guarde por operação `{ seu_id, canal_id, instance_id, wabox_id, message_id, phone, status }`. `wabox_id` identifica o envio/ação; edição, reação, exclusão e pin devolvem o `message_id` da mensagem alvo. Não confunda ação com nova mensagem. Recibos podem chegar antes da resposta HTTP; reconcilie sem regredir `READ` para `SENT`.
- Não invente campos: consulte `references/` ou o OpenAPI. Se um recurso não estiver lá, ele provavelmente não existe (chamadas, listas de transmissão, histórico completo de mensagens, instância "mobile").
- Migrando de Baileys/whatsapp-web.js (socket próprio) para o Wabox: leia `references/migrating-from-baileys.md` antes de mexer no código.

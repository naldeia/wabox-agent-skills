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

## Fluxo padrão de integração

1. **Credenciais**: `instance_id` e `token` vêm do painel (Dados da instância › Credenciais). Guarde em variáveis de ambiente (`WABOX_INSTANCE_ID`, `WABOX_TOKEN`, `WABOX_WEBHOOK_SECRET`). Nunca no front-end nem em logs (a URL contém o token — mascare).
2. **Conectar**: `GET /status` → se `status: "qr"`, mostre `GET /qr-code` (`value` = data URL PNG, rotaciona a cada ~20 s) ou `GET /phone-code/{phone}` (código de pareamento). Prefira o webhook `connected` a fazer polling; se precisar, consulte a cada 10 s.
3. **Webhooks**: `PUT /webhooks` com `received_url`, `delivery_url`, `message_status_url`, `connected_url`, `disconnected_url` — ou, para um endpoint só, `{ "single_url_enabled": true, "single_url": "https://..." }` (roteie pelo `type`/header `X-Wabox-Event`). Definir uma URL na instância desliga `use_workspace_webhooks` (herança da configuração do workspace). Guarde o `secret` (`whsec_…`) de `GET /webhooks` e **verifique `X-Wabox-Signature` em toda entrega** (`scripts/verify-signature.*`).
4. **Enviar**: `POST /send-text { phone, message }`. Resposta imediata `{ id, message_id, wabox_id, status: "queued" }`; o resultado real chega no webhook `delivery` (mesmo `wabox_id`/`message_id`).
5. **Receber**: responda `200` rápido e processe depois. Exatamente um bloco de conteúdo vem preenchido (`text`, `image`, `audio`, …); teste presença do campo, não um campo "tipo". Deduplique por `event_id`.

Veja `references/endpoints.md` (rotas e bodies), `references/webhooks.md` (payloads), `references/errors.md` (códigos e política de retry), `references/migrating-from-baileys.md` (de/para Baileys → Wabox).

## Regras que evitam bugs comuns

- `phone` só dígitos com DDI (`5511988887777`). Também aceita `<id>-group`, `<id>@newsletter`, `<id>@lid`. Sem `+`, espaços ou traços.
- **Envio não é idempotente.** Se a chamada falhou por rede sem resposta, confira `GET /queue` (ou espere o `delivery`) antes de reenviar. Guarde `wabox_id` assim que a resposta chegar.
- `delivery` = saiu do aparelho. "Chegou" = `message_status` `RECEIVED`; "leu" = `READ`.
- Instância desconectada: a fila **segura** as mensagens (máx. 1.000) e drena ao reconectar; o que espera mais que `queue_max_age_hours` (padrão 12 h, 1–168) é descartado com `delivery` `error_code: queue_expired` (reenviar é seguro). Para conteúdo sensível a tempo (códigos OTP), use validade curta, confira `GET /status` antes ou ligue `disable_enqueue_when_disconnected` e trate `409`.
- Responder/encaminhar/editar/votar só funciona para mensagens que o engine viu recentemente (cache ~4.000 msgs, some no restart) → `message_not_found`. Se a citação for opcional, reenvie sem `reply_to_message_id`.
- Mídia recebida: `url` assinada expira em **24 h**. Copie para o seu storage.
- Histórico: o Wabox **não** guarda mensagens. A única exceção é `GET /chats/{phone}/messages`: até 50 mensagens recentes por conversa vindas do sync do pareamento (sem mídia, não acompanha o tráfego ao vivo; `settings.history_enabled`). Quem persiste a conversa é o seu sistema, a partir dos webhooks.
- Mídia enviada: `image`/`audio`/`video`/`document` aceitam URL pública **ou** base64 (`data:mime;base64,…`). Limites 16 MB (mídia) / 100 MB (documento). `send-audio` sai como voice note por padrão (`ptt: false` = arquivo de áudio).
- Botões/lista/carrossel são **best effort**: renderizam no celular, **não** no WhatsApp Web/Desktop. Tenha fallback em texto.
- Rate limit por instância: 60 req/s (rajada 120) → `429` + `Retry-After`. O gargalo real é o intervalo anti-ban da fila (1–3 s entre mensagens).
- Grupos: em `received`, `phone` é o grupo e `participant_phone` quem escreveu. Guarde `chat_lid`/`sender_lid` junto com `phone` (WhatsApp está migrando para LID).
- `402 subscription_required` só em endpoints de envio (trial ou plano da conta vencido — a assinatura é da conta, por slots, igual para todas as instâncias). Leitura, status e webhooks continuam.

## Scripts

- `scripts/wabox.sh GET status` · `scripts/wabox.sh POST send-text '{"phone":"55…","message":"oi"}'` — curl com `WABOX_INSTANCE_ID`/`WABOX_TOKEN` do ambiente (`WABOX_API_URL` para outro host).
- `scripts/webhook-sink.ts` — servidor local (`bun`/`node`) que recebe entregas, verifica assinatura e lista em `GET /events`. Exponha com ngrok/cloudflared e aponte `PUT /webhooks` para ele.
- `scripts/verify-signature.{ts,go,php}` — implementações de referência da verificação HMAC para copiar no projeto do usuário (em TS, prefira `@wabox/sdk/webhooks`).

## Ao escrever código para o usuário

- Em TS/JS: `@wabox/sdk` (cliente + webhooks). Em outras linguagens, um cliente HTTP fino com `BASE` + keep-alive; timeout 30 s; retry com backoff só em `429`/`5xx`/rede, nunca em `4xx`.
- Um handler de webhook por tipo, lendo o **corpo cru** antes do parser JSON para verificar a assinatura; `event_id` como chave de idempotência; processamento assíncrono após responder `200`.
- Modelo local: guarde por mensagem enviada `{ seu_id, wabox_id, message_id, phone, status }` e atualize com `delivery` e `message_status`.
- Não invente campos: consulte `references/` ou o OpenAPI. Se um recurso não estiver lá, ele provavelmente não existe (chamadas, listas de transmissão, histórico completo de mensagens, instância "mobile").
- Migrando de Baileys/whatsapp-web.js (socket próprio) para o Wabox: leia `references/migrating-from-baileys.md` antes de mexer no código.

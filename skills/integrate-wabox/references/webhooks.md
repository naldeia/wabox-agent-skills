# Webhooks

`POST` JSON na URL configurada por tipo. Headers: `Content-Type: application/json`, `User-Agent: Wabox-Webhook/1.0`, `X-Wabox-Event`, `X-Wabox-Event-Id`, `X-Wabox-Instance-Id`, `X-Wabox-Signature: t=<unix>,v1=<hex>`.

**Assinatura**: `v1 = HMAC-SHA256(secret, "<t>.<corpo cru>")`. Compare em tempo constante; rejeite `|now - t| > 300 s`. Em TS/JS: `constructWebhookEvent({ body, headers, secret })` de `@wabox/sdk/webhooks` faz isso e devolve o evento tipado. O segredo (`whsec_…`) é por instância (`GET /webhooks`). Após `POST /webhooks/secret`, entregas já enfileiradas ainda usam o segredo antigo — aceite os dois por algumas horas.

**Entrega**: `2xx` = ok, timeout 10 s, 1 entrega + 5 reenvios (`10s, 1m, 10m, 1h, 6h`), ordem preservada por instância, depois descarta (fica no log do painel). Entregas podem repetir → deduplique por `event_id` (ULID).

Envelope comum: `{ type, event_id, instance_id, momment (epoch ms), … }`.

## `received`

```json
{
  "type": "received", "event_id": "01J…", "instance_id": "uuid", "momment": 1786968300000,
  "message_id": "3EB0…", "phone": "5511988887777",
  "chat_lid": "9876…@lid", "sender_lid": "9876…@lid",
  "from_me": false, "from_api": false, "is_group": false, "is_newsletter": false,
  "is_edit": false, "forwarded": false, "broadcast": false, "waiting_message": false,
  "status": "RECEIVED", "chat_name": "Maria", "sender_name": "Maria",
  "participant_phone": "…", "participant_lid": "…",      // só em grupos
  "reference_message_id": "…",                          // se é resposta a outra
  "text": { "message": "Olá!" }                         // exatamente UM bloco de conteúdo
}
```

Blocos de conteúdo (um por evento):

| Bloco | Campos |
| --- | --- |
| `text` | `message`, e com prévia de link: `title`, `description`, `url`, `thumbnail_url` |
| `image` / `video` / `audio` / `document` / `sticker` | `mime_type`, `url` (assinada, **24 h**), `thumbnail_url`, `caption`, `width`, `height`, `file_size`, `sha256`, `view_once`; `video.seconds/is_gif`, `audio.ptt/seconds`, `document.file_name/title/page_count`, `sticker.animated`; se falhou o download: sem `url` + `download_error` |
| `location` | `latitude`, `longitude`, `name`, `address`, `url` |
| `contact` / `contacts[]` | `display_name`, `vcard`, `phones[]` |
| `reaction` | `value` (vazio = removida), `time`, `reaction_by`, `referenced_message { message_id, from_me, phone }` |
| `poll` / `poll_vote` | `question`, `options[{name}]`, `poll_max_options` / `poll_message_id`, `options[]` |
| `buttons_response` / `list_response` | `button_id`, `message` / `selected_row_id`, `title`, `message` (+ `reference_message_id` = a mensagem interativa) |
| `buttons` / `list` | interativos **recebidos** de outras contas |
| `event` / `event_response` | `name`, `description`, `start_at`, `end_at`, `location`, `canceled` / `event_message_id`, `response` (going…), `extra_guests` |
| `product` / `order` | snapshot do card / pedido (`order_id`, `token`, `item_count`, `status`, `total`) → `GET /business/orders/{id}?token=` |
| `newsletter_invite` | `newsletter_id`, `name`, `caption` |
| `notification` + `notification_parameters[]` | eventos de chat sem conteúdo: `REVOKE`, `GROUP_CREATE`, `GROUP_CHANGE_SUBJECT|DESCRIPTION|ICON`, `GROUP_PARTICIPANT_ADD|REMOVE|PROMOTE|DEMOTE|LEAVE|INVITE`, `MEMBERSHIP_APPROVAL_REQUEST`, `CALL_RECEIVED|MISSED|MISSED_VOICE|MISSED_VIDEO`, `E2E_ENCRYPTED`, `CIPHERTEXT`, `PROFILE_NAME_UPDATED`, `PROFILE_PICTURE_UPDATED` |
| `unsupported` | `{ wa_type }` |

Outros campos de `received`: `sender_photo`, `message_expiration_seconds` + `expires_at` (mensagens temporárias).

Notas: `waiting_message: true` é placeholder (o definitivo vem depois com o mesmo `message_id`). `from_me` só chega com `notify_sent_by_me` ligado (`from_api` distingue API × celular). Em grupo, responder no grupo = `phone` do grupo; no privado = `participant_phone`.

## `delivery`

```json
{ "type": "delivery", "event_id": "…", "instance_id": "…", "momment": 1786968420000,
  "wabox_id": "wbx_…", "message_id": "3EB0…", "phone": "5511988887777",
  "error": "phone is not on WhatsApp", "error_code": "phone_not_on_whatsapp" }   // error* só em falha
```

Só para envios pela API. Significa "saiu do aparelho" (ou desistiu), não "chegou".

## `message_status`

```json
{ "type": "message_status", "ids": ["3EB0…"], "phone": "5511988887777",
  "status": "PENDING|SENT|RECEIVED|READ|READ_BY_ME|PLAYED", "momment": …, "is_group": false, "phone_device": "…" }
```

## `connected` / `disconnected`

```json
{ "type": "connected", "phone": "5511999998888", "connected": true, … }
{ "type": "disconnected", "disconnected": true, "error": "…", "reason": "network|stream_replaced|logged_out|banned|stopped|engine_shutdown|unknown", … }
```

`logged_out` = precisa de novo QR. `banned` = número não volta. `network` / `engine_shutdown` / `unknown` = reconecta sozinho. `stream_replaced` = outra sessão assumiu a mesma credencial (reconecta; se repetir, há dois processos usando o mesmo número). `stopped` = instância parada pela API/painel ou assinatura vencida (`POST /restart` ou regularizar). Não dispare `POST /restart` automático em `network`/`stream_replaced`.

## `chat_presence`

`{ "type": "chat_presence", "phone": "…", "status": "AVAILABLE|UNAVAILABLE|COMPOSING|PAUSED|RECORDING", "last_seen": … }`

## Filtros (em `PUT /webhooks`)

`ignore_groups`, `ignore_private`, `ignore_text|image|video|audio|document`, `notify_sent_by_me`. Prefira filtrar aqui a descartar no seu lado.

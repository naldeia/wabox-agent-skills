# Webhooks

`POST` JSON na URL configurada por tipo. Headers: `Content-Type: application/json`, `User-Agent: Wabox-Webhook/1.0`, `X-Wabox-Event`, `X-Wabox-Event-Id`, `X-Wabox-Instance-Id`, `X-Wabox-Signature: t=<unix>,v1=<hex>`.

**Assinatura**: `v1 = HMAC-SHA256(secret, "<t>.<corpo cru>")`. Compare em tempo constante; rejeite `|now - t| > 300 s`. Em TS/JS: `constructWebhookEvent({ body, headers, secret })` de `@wabox/sdk/webhooks` faz isso e devolve o evento tipado. Com `use_workspace_webhooks: true`, o segredo efetivo vem de `GET /account/webhooks`; com configuração própria, de `GET /webhooks`. O GET da instância não resolve a herança. Na rotação, entregas já enfileiradas usam o segredo anterior; mantenha-o durante a janela de retries (~7 h 11 min, mais margem para atraso na fila). O timestamp da assinatura é renovado a cada tentativa; não confunda com `momment`.

**Entrega**: `2xx` = ok, timeout 10 s, 1 entrega + 5 reenvios (`10s, 1m, 10m, 1h, 6h`), depois falha definitiva (logs no painel). **Não há garantia de ordem**: entregas concorrentes e retries podem se ultrapassar. Valide → persista em inbox/fila durável com unicidade `(instance_id, event_id)` → responda `200` rapidamente → processe em worker. Se a persistência falhar, responda `5xx`. Eventos duplicados já persistidos recebem `200`; o worker precisa de retry próprio para não perder o evento após o ACK.

**Roteamento seguro**: use `instance_id`, `type` e `event_id` do corpo verificado. Os headers correspondentes não são cobertos pelo HMAC; compare-os ao corpo e rejeite divergências. Em um workspace com vários clientes, resolva o tenant pelo mapeamento local da instância. `constructWebhookEvent` valida assinatura, JSON e tipo conhecido, não todos os campos em runtime; valide os campos necessários antes de persistir/processar.

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
  "participant_phone": "5511888888888", "participant_lid": "1234@lid",
  "reference_message_id": "3EB1…",
  "text": { "message": "Olá!" }
}
```

Campos opcionais de grupo (`participant_*`) e citação (`reference_message_id`) só aparecem quando aplicáveis. Mensagens normalmente têm um bloco de conteúdo; notificações e placeholders podem não ter nenhum. Não exija `text`/mídia em todo evento.

Blocos de conteúdo:

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

Notas: `waiting_message: true` é placeholder (o definitivo vem depois com o mesmo `message_id`, outro evento). Edições também reutilizam o ID: deduplicar toda mensagem por `message_id` descartaria atualizações legítimas. Faça upsert por instância/chat/mensagem e aplique eventos de edição, revogação e reação. `from_me` só chega com `notify_sent_by_me` ligado (`from_api` distingue API × celular): correlacione o eco da API com o envio existente, sem criar outra mensagem ou disparar automação de entrada. Em grupo, responder no grupo = `phone` do grupo; no privado = `participant_phone`.

## `delivery`

```json
{ "type": "delivery", "event_id": "…", "instance_id": "…", "momment": 1786968420000,
  "wabox_id": "wbx_…", "message_id": "3EB0…", "phone": "5511988887777",
  "error": "phone is not on WhatsApp", "error_code": "phone_not_on_whatsapp" }
```

Só para envios pela API. Significa envio concluído (ou falhou), não entrega ao destinatário. `error`/`error_code` só em falha; `message_id` é opcional. Correlacione a operação por `wabox_id`, inclusive para ações sobre uma mensagem existente.

## `message_status`

```json
{ "type": "message_status", "event_id": "01J…", "instance_id": "uuid",
  "ids": ["3EB0…"], "phone": "5511988887777", "status": "READ",
  "momment": 1786968420000, "is_group": false, "phone_device": 0 }
```

Estados: `PENDING`, `SENT`, `RECEIVED`, `READ`, `READ_BY_ME`, `PLAYED`. Processe cada ID de `ids[]`; `phone_device` é número. `READ_BY_ME` indica leitura pelo próprio número, não pelo destinatário. Em grupos pode haver `participant_phone`: preserve recibos por participante. Recibos podem chegar antes do `delivery` ou da resposta HTTP; guarde-os para reconciliação e não regrida um estado confirmado por causa de um evento atrasado.

## `instance_status`

```text
{ "type": "instance_status", "status": "starting|qr|connecting|connected|disconnected|logged_out|banned|stopped", "previous_status": "…", "phone": "5511999998888", "disconnect_reason": "network|stream_replaced|logged_out|banned|stopped|engine_shutdown|unknown", "reason": "…", … }
```

O único webhook de conexão (substituiu `connected`/`disconnected`; `connected_url`/`disconnected_url` não existem mais): um evento por mudança de status, o mesmo `status` de `GET /status`. `previous_status`, `phone` (só em `connected`), `disconnect_reason` (só quando a mudança veio de uma queda) e `reason` (texto livre, só para log) são opcionais. `qr` = aguardando leitura: comece a mostrar `GET /qr-code` — **o código nunca vem no webhook** e não há um evento por QR gerado. `connected` = libere o canal. `logged_out` = precisa de novo QR. `banned` = suspenda envios e investigue com suporte; o evento não garante se o bloqueio é permanente. `disconnected` = queda temporária (`network`, `stream_replaced`, `engine_shutdown`, `unknown`): o Wabox cuida da reconexão; `stream_replaced` repetido = outra sessão assumiu a credencial, investigue. `stopped` = instância parada: confira `GET /status` e retome conforme a operação desejada. Não dispare `POST /restart` automático a cada queda. Use `momment` e reconciliação de status para que eventos antigos não derrubem um canal já reconectado. Configure com `instance_status_url` (ou a URL única) e silencie com `ignore_instance_status_callback`.

## `chat_presence`

`{ "type": "chat_presence", "phone": "…", "status": "AVAILABLE|UNAVAILABLE|COMPOSING|PAUSED|RECORDING", "last_seen": … }`

## Filtros (em `PUT /webhooks`)

`ignore_groups`, `ignore_private`, `ignore_text|image|video|audio|document`, `notify_sent_by_me`. Prefira filtrar aqui a descartar no seu lado.

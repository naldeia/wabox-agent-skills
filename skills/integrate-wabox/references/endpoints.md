# Endpoints mais usados (API pública)

Prefixo: `https://api.wabox.me/instances/{instance_id}/token/{token}`. Header opcional `Client-Token` (obrigatório se ativado no workspace). `*` = obrigatório. Campos comuns de envio (todos opcionais): `reply_to_message_id`, `mentioned[]`, `mention_all`, `delay_message` (s), `delay_typing` (s, máx. 15).

## Instância

| Rota | Body / retorno |
| --- | --- |
| `GET /status` | `{ connected, smartphone_connected, status, phone, error }` — `status`: created/starting/qr/connecting/connected/disconnected/logged_out/banned/stopped |
| `GET /qr-code` · `GET /qr-code/image` | `{ value: "data:image/png;base64,…", expires_at, connected }` · PNG |
| `GET /phone-code/{phone}` | `{ value: "ABCD-EFGH" }` (pareamento sem câmera) |
| `GET /me` · `GET /device` | dados do número / do aparelho |
| `POST /restart` · `POST /disconnect` | reinicia a sessão / desloga (novo QR) |
| `PUT /name` | `{ value* }` |
| `GET /webhooks` · `PUT /webhooks` · `PUT /webhooks/{type}` | `{ received_url, delivery_url, message_status_url, connected_url, disconnected_url, chat_presence_url, single_url_enabled, single_url, notify_sent_by_me, ignore_groups, ignore_private, ignore_text, ignore_image, ignore_video, ignore_audio, ignore_document, ignore_*_callback, use_workspace_webhooks }`; `single_url_enabled: true` manda tudo para `single_url`; `use_workspace_webhooks: true` (padrão em instância nova) herda URLs/filtros do workspace — definir uma URL desliga; `GET` inclui `secret` |
| `POST /webhooks/secret` | rotaciona o segredo HMAC e devolve o novo |
| `GET /settings` · `PUT /settings` | `{ auto_read_message, auto_read_status, call_reject_auto, call_reject_message, disable_enqueue_when_disconnected, queue_max_age_hours, delay_message_min_ms, delay_message_max_ms, history_enabled, proxy_url }` |

## Envio (`POST`, todos respondem `{ id, message_id, wabox_id, status: "queued" }`)

| Rota | Body |
| --- | --- |
| `/send-text` | `{ phone*, message*, edit_message_id? }` |
| `/send-image` · `/send-video` | `{ phone*, image*|video*, caption?, view_once?, edit_message_id?, mime_type?, file_name? }` — URL ou base64 |
| `/send-audio` | `{ phone*, audio*, ptt? (padrão `true` = voice note), waveform?, view_once? }` |
| `/send-document` | `{ phone*, document*, extension? (ou `/send-document/{ext}`), caption?, file_name? }` |
| `/send-sticker` · `/send-gif` · `/send-ptv` | `{ phone*, sticker*|gif*|ptv* }` |
| `/send-location` | `{ phone*, latitude*, longitude*, name?, address?, url? }` |
| `/send-contact` · `/send-contacts` | `{ phone*, contact_name*, contact_phone*, contact_description?, vcard? }` · `{ phone*, contacts*[] }` |
| `/send-link` | `{ phone*, message*, url*, title?, description?, image? }` |
| `/send-poll` · `/send-poll-vote` | `{ phone*, question*, options*[], poll_max_options? }` · `{ phone*, poll_message_id*, options*[] }` |
| `/send-reaction` · `/remove-reaction` | `{ phone*, message_id*, reaction* }` |
| `/forward-message` | `{ phone*, message_id*, from_phone? }` |
| `/pin-message` | `{ phone*, message_id*, pin_duration? }` |
| `/read-message` | `{ phone*, message_id? | message_ids?[] }` (imediato, exige conectado) |
| `/send-presence` | `{ phone?, status*: COMPOSING|RECORDING|PAUSED|AVAILABLE|UNAVAILABLE }` (imediato) |
| `DELETE /messages` | `{ phone*, message_id*, owner? }` (revogar) |
| `/send-button-list` | `{ phone*, message*, title?, footer?, image?, buttons*[{ id, label, type: reply|url|call|copy, url?, phone?, copy_code? }] }` — best effort |
| `/send-option-list` | `{ phone*, message*, button_label*, title?, footer?, sections[{ title, rows[{ id, title, description }] }] | options[] }` — best effort |
| `/send-carousel` · `/send-button-otp` · `/send-button-pix` · `/send-event` · `/send-text-status` · `/send-image-status` | ver OpenAPI (best effort / status) |

## Fila

`GET /queue?page&page_size` → `{ data[{ wabox_id, message_id, phone, type, … }], page, page_size, total }` · `DELETE /queue` · `DELETE /queue/{wabox_id}`

## Contatos e chats

| Rota | Nota |
| --- | --- |
| `GET /phone-exists/{phone}` · `POST /phone-exists-batch { phones*[] }` (≤ 50) | confira antes de enviar; devolve o número canônico e `lid` |
| `GET /contacts?q&page&page_size` · `GET /contacts/{phone}` · `GET /contacts/{phone}/picture?preview` | ao vivo do aparelho, nada persistido |
| `POST /contacts/{phone}/block|unblock` · `GET /contacts/blocked` | |
| `GET /chats?q&archived&page&page_size` · `GET /chats/{phone}` | só metadados; `404 chat_not_found` se o engine ainda não viu a conversa |
| `GET /chats/{phone}/messages` | `{ phone, enabled, synced_at, messages[] }` — até 50 mensagens recentes do sync do pareamento, formato do `received` sem envelope, mídia só metadados (`download_error`), vazio (nunca 404) se não sincronizou; **não** acompanha mensagens ao vivo; não exige conectado; `settings.history_enabled: false` desliga e apaga |
| `POST /chats/{phone}/{archive|unarchive|mute|unmute|pin|unpin|read|unread|delete}` · `PUT /chats/{phone}/expiration { value* }` | |
| `PUT /profile/name|about { value* }` · `PUT /profile/picture { value*, mime_type? }` · `DELETE /profile/picture` | |

## Grupos

| Rota | Body |
| --- | --- |
| `POST /groups` | `{ name*, participants*[], description?, announce?, locked?, join_approval_required?, member_add_mode?, ephemeral_seconds? }` → `{ id: "…-group" }` |
| `GET /groups?include_participants` · `GET /groups/{id}` · `PUT /groups/{id}` | update aceita os mesmos campos + `picture`/`remove_picture` |
| `POST /groups/{id}/participants` | `{ action*: add|remove|promote|demote|approve|reject, phones*[] }` — resultado por telefone (quem bloqueia adição recebe convite) |
| `GET /groups/{id}/invite-link` · `POST /groups/{id}/invite-link/revoke` · `GET /groups/invite-info?invite=` · `POST /groups/join { invite* }` · `POST /groups/{id}/leave` · `GET /groups/{id}/requests` | |

Comunidades (`/communities/*`), canais (`/newsletters/*`; publicar = `send-*` com `phone: <id>@newsletter`), privacidade (`/privacy/*`), business/catálogo (`/business/*`) e etiquetas (`/labels/*`): ver OpenAPI.

## Paginação

`?page=1&page_size=50` → `{ data, page, page_size, total }`.

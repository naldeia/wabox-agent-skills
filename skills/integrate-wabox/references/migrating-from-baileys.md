# Migrando de Baileys para o Wabox

Para quem hoje mantém um socket Baileys (ou whatsapp-web.js) por número dentro do próprio backend e vai trocar por chamadas REST + webhooks. A mudança de arquitetura: **some o processo com socket/estado de auth**; entra um cliente HTTP (envio) e um endpoint HTTP (recebimento). Integrador com muitos números: crie as instâncias pela Partner API (skill `wabox-partner`).

## O que não migra

- **Sessão.** O auth state do Baileys (`creds`/`keys`, `useMultiFileAuthState`) não é portável. Todo número pareia de novo no Wabox (`GET /qr-code` ou `GET /phone-code/{phone}`) e vira um **novo** aparelho conectado. Encerre a sessão antiga com `sock.logout()` (libera a vaga de linked device — máx. 4 — e evita dois clientes no mesmo número). Planeje a migração por canal, com uma tela de "reconectar", não um corte geral.
- **Histórico.** Não há `messaging-history.set`. O que existe: `GET /chats/{phone}/messages` com até 50 mensagens recentes por conversa do sync do pareamento, sem mídia. O histórico já salvo no seu banco continua sendo a fonte.
- **Store em memória** (`makeInMemoryStore`, `getMessage`). Não existe equivalente; o Wabox não persiste mensagens. Responder/editar/reagir a mensagem antiga (anterior ao pareamento ou fora do cache de ~4.000 msgs do engine) dá `message_not_found` — envie sem a citação como fallback.

## Identificadores

| Baileys | Wabox |
| --- | --- |
| `5511988887777@s.whatsapp.net` | `phone: "5511988887777"` |
| `120363…@g.us` | `120363…-group` (webhooks e respostas); `@g.us` é aceito como entrada |
| `…@lid` · `…@newsletter` · `status@broadcast` | iguais |
| `key.id` | `message_id` — é o mesmo id do WhatsApp, então ids já gravados no seu banco continuam batendo com `message_status`/`reference_message_id` |
| `key.fromMe` · `key.participant` · `pushName` | `from_me` · `participant_phone`/`participant_lid` · `sender_name` |
| `messageTimestamp` (s) | `momment` (epoch **ms**) |

Converta os JIDs guardados uma vez (função `jidToPhone`) em vez de espalhar `replace` pelo código. Guarde `chat_lid`/`sender_lid` junto com `phone`.

## Eventos → webhooks

| Baileys | Wabox |
| --- | --- |
| `connection.update { qr }` | `GET /qr-code` (data URL PNG pronta; rotaciona ~20 s) · `requestPairingCode` → `GET /phone-code/{phone}` |
| `connection.update { connection: "open" }` | webhook `connected` |
| `connection.update { connection: "close", lastDisconnect }` | webhook `disconnected` com `reason`: `logged_out` (= `DisconnectReason.loggedOut`, novo QR), `banned`, `stream_replaced` (= `connectionReplaced`), `network`/`engine_shutdown`/`unknown` (reconecta sozinho — **apague a sua lógica de reconexão**) |
| `creds.update` | nada — o Wabox guarda a sessão |
| `messages.upsert` (type `notify`) | webhook `received`. Mensagens do próprio número (`fromMe`) só com `notify_sent_by_me: true`; `from_api` separa o que saiu pela API do que foi digitado no celular |
| `message.conversation` / `extendedTextMessage` | `text.message` |
| `imageMessage`/`videoMessage`/`audioMessage`/`documentMessage`/`stickerMessage` + `downloadMediaMessage()` | bloco `image`/`video`/`audio`/`document`/`sticker` já com `url` assinada (expira em 24 h — copie para o seu storage). Sem descriptografia do seu lado |
| `contextInfo.stanzaId` (citação) | `reference_message_id` |
| `protocolMessage` REVOKE | `notification: "REVOKE"` · edição → `is_edit: true` com o mesmo `message_id` |
| `reactionMessage` · `pollUpdateMessage` | blocos `reaction` · `poll_vote` (voto já descriptografado) |
| Placeholder "aguardando mensagem" / retry de decrypt | `waiting_message: true`, depois o definitivo com o mesmo `message_id` |
| `messages.update` (`status`) / `message-receipt.update` | webhook `message_status` (`SENT`/`RECEIVED`/`READ`/`PLAYED`, `ids[]`) |
| `presence.update` | webhook `chat_presence` |
| `groups.update` / `group-participants.update` | `received` com `notification: GROUP_*` + `notification_parameters` |
| `call` | `notification: CALL_*`; rejeição automática em `settings.call_reject_auto` |
| `messaging-history.set` | `GET /chats/{phone}/messages` (parcial, ver acima) |

## Chamadas → rotas

| Baileys | Wabox |
| --- | --- |
| `sock.sendMessage(jid, { text }, { quoted })` | `POST /send-text { phone, message, reply_to_message_id }` |
| `{ image|video|audio|document: { url } | Buffer, caption, ptt, fileName }` | `POST /send-image|video|audio|document` com URL pública ou base64 (`send-audio` já sai como voice note Opus/OGG por padrão — `ptt: false` para arquivo de áudio; a conversão é do Wabox, dispense o seu ffmpeg) |
| `{ react }` · `{ delete: key }` · `{ edit: key }` · `{ forward }` | `/send-reaction` · `DELETE /messages` · `edit_message_id` no `send-text` · `/forward-message` |
| `{ location }` · `{ contacts }` · `{ poll }` | `/send-location` · `/send-contact(s)` · `/send-poll` |
| `sock.readMessages(keys)` | `POST /read-message` (ou `settings.auto_read_message`) |
| `sock.sendPresenceUpdate("composing", jid)` | `POST /send-presence`, ou só `delay_typing` no envio |
| `sock.onWhatsApp(n)` | `GET /phone-exists/{phone}` · lote de 50 em `/phone-exists-batch` |
| `sock.profilePictureUrl(jid)` | `GET /contacts/{phone}/picture` |
| `sock.groupMetadata` · `groupCreate` · `groupParticipantsUpdate` · `groupInviteCode` | `GET /groups/{id}` · `POST /groups` · `POST /groups/{id}/participants` · `GET /groups/{id}/invite-link` |
| `sock.updateBlockStatus` · `chatModify` | `/contacts/{phone}/block|unblock` · `/chats/{phone}/{archive|mute|pin|read|delete…}` |
| `sock.logout()` | `POST /disconnect` (Partner: `DELETE /partner/instances/{id}` ao cancelar o canal) |

## Diferenças de comportamento que quebram código portado

- **Envio é assíncrono.** `sendMessage` devolvia a mensagem enviada; `POST /send-*` devolve `{ message_id, wabox_id, status: "queued" }` e o resultado vem no webhook `delivery` (erro em `error_code`). Grave a mensagem como "na fila" com o `message_id` da resposta e atualize pelos webhooks. O `message_id` já é o definitivo — dá para correlacionar `message_status` mesmo que chegue antes do seu `UPDATE`.
- **Fila com intervalo anti-ban** (1–3 s entre mensagens por instância, configurável). Não implemente throttle próprio por cima; não espere envio instantâneo em rajadas.
- **Instância desconectada enfileira** (até 1.000 msgs / `queue_max_age_hours`) em vez de lançar erro. Se o produto precisa falhar na hora, `disable_enqueue_when_disconnected: true` e trate `409`.
- **Envio não é idempotente**: em timeout de rede, confira `GET /queue`/`delivery` antes de repetir.
- **Webhooks repetem e são assinados**: deduplique por `event_id`, verifique `X-Wabox-Signature` sobre o corpo cru, responda `200` antes de processar. As entregas de uma instância saem uma por vez, na ordem dos eventos.
- **Sem acesso ao proto cru.** Tipos não mapeados chegam como `unsupported { wa_type }`. Se o código atual lê campos do `WAMessage` fora da tabela acima, confira o schema `WebhookReceived` no OpenAPI antes de assumir que existe.

## Roteiro sugerido

1. Criar uma implementação "wabox" atrás da mesma interface de canal que hoje embrulha o Baileys (enviar, status de conexão, QR, handlers de entrada), com flag por canal.
2. Endpoint de webhook único (`single_url`) → verificar assinatura → achar o canal por `X-Wabox-Instance-Id` → normalizar para o mesmo modelo interno que o `messages.upsert` alimentava.
3. Migrar canal a canal: criar instância → `logout` do Baileys → parear → virar a flag. Manter o Baileys só para quem ainda não pareou; remover quando zerar.

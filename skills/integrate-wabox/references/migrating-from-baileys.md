# Migrando de Baileys para o Wabox

Para quem hoje mantém um socket Baileys (ou whatsapp-web.js) por número dentro do próprio backend e vai trocar por chamadas REST + webhooks. A mudança de arquitetura: **some o processo com socket/estado de auth**; entra um cliente HTTP (envio) e um endpoint HTTP (recebimento). Integrador com muitos números: crie as instâncias pela Account API (skill `wabox-partner`).

## O que não migra

- **Sessão.** O auth state do Baileys (`creds`/`keys`, `useMultiFileAuthState`) não é importado pelo Wabox. Todo número pareia de novo (`GET /qr-code` ou `GET /phone-code/{phone}`) e vira um novo aparelho conectado. Planeje por canal, com tela de "reconectar" e janela de troca. Pare envios/consumo do provedor anterior para não ter dois produtores ativos. `sock.logout()` revoga a sessão antiga: só faça no ponto de corte planejado, pois rollback depois exige novo pareamento do Baileys.
- **Histórico.** Não há `messaging-history.set`. O que existe: `GET /chats/{phone}/messages` com até 50 mensagens recentes por conversa do sync do pareamento, sem mídia. O histórico já salvo no seu banco continua sendo a fonte.
- **Store em memória** (`makeInMemoryStore`, `getMessage`). Não há store completo consultável; preserve mensagens/mídias no Kinbox. O cache do engine (~4.000 msgs) se perde no restart e afeta encaminhamento/edição de legenda; votos exigem o segredo da enquete original. Citação fora do cache é best effort; edição de texto/reação não têm o mesmo requisito. Teste mensagens anteriores ao pareamento, incluindo autoria/participante em grupos.

## Identificadores

| Baileys | Wabox |
| --- | --- |
| `5511988887777@s.whatsapp.net` | `phone: "5511988887777"` |
| `120363…@g.us` | `120363…-group` (webhooks e respostas); `@g.us` é aceito como entrada |
| `…@lid` · `…@newsletter` · `status@broadcast` | iguais |
| `key.id` | `message_id` é o ID do WhatsApp; preserve IDs antigos para referências locais, sem presumir que o novo aparelho receberá recibos/histórico retroativos |
| `key.fromMe` · `key.participant` · `pushName` | `from_me` · `participant_phone`/`participant_lid` · `sender_name` |
| `messageTimestamp` (s) | `momment` (epoch **ms**) |

Converta os JIDs guardados uma vez (função `jidToPhone`) em vez de espalhar `replace` pelo código. Guarde `chat_lid`/`sender_lid` junto com `phone`.

## Eventos → webhooks

| Baileys | Wabox |
| --- | --- |
| `connection.update { qr }` | `GET /qr-code` (data URL PNG pronta; rotaciona ~20 s) · `requestPairingCode` → `GET /phone-code/{phone}` |
| `connection.update { connection: "open" }` | webhook `instance_status` com `status: "connected"` (traz `phone`) |
| `connection.update { connection: "close", lastDisconnect }` | webhook `instance_status` com `disconnect_reason`: `logged_out` (= `DisconnectReason.loggedOut`, novo QR), `banned`, `stream_replaced` (= `connectionReplaced`), `network`/`engine_shutdown`/`unknown` (reconecta sozinho — **apague a sua lógica de reconexão**) |
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
| `{ image|video|audio|document: { url } | Buffer, caption, ptt, fileName }` | `POST /send-image|video|audio|document` com URL pública ou base64 (`send-audio` usa `ptt: true` por padrão; conversões dependem do ffmpeg no engine — homologue os formatos antes de retirar a conversão local) |
| `{ react }` · `{ delete: key }` · `{ edit: key }` · `{ forward }` | `/send-reaction` · `DELETE /messages` · `edit_message_id` no `send-text` · `/forward-message` |
| `{ location }` · `{ contacts }` · `{ poll }` | `/send-location` · `/send-contact(s)` · `/send-poll` |
| `sock.readMessages(keys)` | `POST /read-message` (ou `settings.auto_read_message`) |
| `sock.sendPresenceUpdate("composing", jid)` | `POST /send-presence`, ou só `delay_typing` no envio |
| `sock.onWhatsApp(n)` | `GET /phone-exists/{phone}` · lote de 50 em `/phone-exists-batch` |
| `sock.profilePictureUrl(jid)` | `GET /contacts/{phone}/picture` |
| `sock.groupMetadata` · `groupCreate` · `groupParticipantsUpdate` · `groupInviteCode` | `GET /groups/{id}` · `POST /groups` · `POST /groups/{id}/participants` · `GET /groups/{id}/invite-link` |
| `sock.updateBlockStatus` · `chatModify` | `/contacts/{phone}/block|unblock` · `/chats/{phone}/{archive|mute|pin|read|delete…}` |
| `sock.logout()` | `POST /disconnect` (Account API: `DELETE /account/instances/{id}` ao cancelar o canal, o que libera o slot) |

## Diferenças de comportamento que quebram código portado

- **Envio é assíncrono.** `POST /send-*` devolve `{ message_id, wabox_id, status: "queued" }`; o resultado vem em `delivery` (falha em `error`/`error_code`). `wabox_id` identifica a operação. Envios novos retornam o ID definitivo da mensagem; edição/reação/revogação/pin retornam o ID alvo. Guarde recibos que chegarem antes da resposta HTTP para conciliar depois. Nunca marque entregue/lida apenas pelo `200` do envio ou por `delivery`.
- **Fila com intervalo anti-ban** (1–3 s entre mensagens por instância, configurável). Revise o throttle de transporte para evitar atraso duplicado, preservando limites de negócio/campanha do Kinbox. Não espere envio instantâneo em rajadas.
- **Instância desconectada enfileira** (até 1.000 msgs / `queue_max_age_hours`) em vez de lançar erro. Se o produto precisa falhar na hora, `disable_enqueue_when_disconnected: true` e trate `409`.
- **Envio não é idempotente**: em timeout/rede/`5xx`, reconcilie antes de repetir. Ausência em `GET /queue` não prova que a mensagem não saiu. Sem IDs confiáveis, mantenha a operação como resultado desconhecido para revisão.
- **Webhooks repetem, podem chegar fora de ordem e são assinados**: valide o corpo cru, deduplique por `(instance_id, event_id)`, grave duravelmente antes do `200` e processe em worker. Não regrida `READ` ao receber `SENT` atrasado. `READ_BY_ME` é leitura local; em grupos preserve recibos por participante.
- **Evento não é mensagem**: edição/placeholder definitivo usam o mesmo `message_id` com outro `event_id`. Faça upsert/atualização, sem descartar a mudança como duplicada. Com `notify_sent_by_me: true`, concilie `from_api: true` com o envio existente; mensagens `from_me: true` não devem disparar automações de entrada.
- **Sem acesso ao proto cru.** Tipos não mapeados chegam como `unsupported { wa_type }`. Se o código atual lê campos do `WAMessage` fora da tabela acima, confira o schema `WebhookReceived` no OpenAPI antes de assumir que existe.

## Roteiro para Kinbox / SaaS com vários clientes

1. **Inventário no repositório de destino.** Localize o adaptador Baileys, criação/remoção de canais, auth state, QR, filas, tipos de mensagem, recibos, grupos, automações e persistência de mídia. Monte um de/para dos recursos realmente usados. Marque lacunas/best effort antes de implementar; não presuma paridade só pela existência de uma rota. A arquitetura interna do Kinbox deve ser descoberta no código dele.
2. **Adaptador e dados.** Implemente Wabox na interface de canal existente, com provedor selecionável por canal durante a transição. Persista `(tenant_id, channel_id) → instance_id/token`, status/horário, número e modo de segredo. Um cliente pode ter vários números. Crie restrições únicas e serialize provisionamento por canal, conforme `wabox-partner`. O backend faz a ponte de QR/status para o front-end; URLs com token nunca vão para o navegador.
3. **Recebimento.** Configure webhooks antes do pareamento. Corpo cru → HMAC com segredo efetivo → envelope válido → tenant/canal pelo `instance_id` assinado → inbox durável → `200` → normalizador para os modelos atuais. Headers são apenas auxiliares e devem bater com o corpo. Recupere eventos que chegarem durante o provisionamento sem vinculá-los a outro cliente.
4. **Saída e reconciliação.** Grave a intenção de envio antes da chamada; salve `wabox_id` e `message_id` da resposta. Concilie `delivery`, recibos e eco `received` sem duplicar mensagens nem disparar automações sobre o próprio envio. Baixe mídia recebida antes da expiração de 24 h. Preserve o histórico atual; o sync parcial não é um backfill garantido.
5. **Piloto e troca.** Homologue um canal de teste. Em cada migração, pause novos envios do provedor antigo, drene/reconcilie os pendentes e controle o consumo de entrada. Crie e vincule a instância, pareie, confirme o número/status e valide ida e volta antes de liberar Wabox como único provedor ativo. Planeje o ponto de logout do Baileys e a recuperação de mensagens durante a janela. Não prometa rollback transparente após revogar a sessão antiga.
6. **Desativação final.** Quando todos os canais estiverem migrados e homologados, retire Baileys, workers de reconexão, listeners, dependências e armazenamento de auth state sem apagar histórico de conversas. A flag é transitória; o objetivo final é Wabox como único provedor dessa integração linked device.

## Critérios de homologação

- Dois tenants, incluindo um com dois canais, sem vazamento de credenciais/eventos entre eles; dois pedidos concorrentes de criação não geram instâncias duplicadas.
- QR inicial/expirado/`value: null`, pareamento, desconexão temporária, logout, reconexão e exclusão definitiva.
- Texto, imagem, áudio PTT, documento, resposta/citação, edição, reação, revogação e grupos conforme o uso real; IDs PN/LID conciliados sem duplicar contatos.
- HMAC válido/inválido, segredo herdado/próprio, header divergente, evento duplicado e recibo fora de ordem ou anterior à resposta HTTP.
- Persistência indisponível retorna `5xx`; worker que falha após o ACK retoma o evento salvo. Eco da API e envio pelo celular não criam mensagens duplicadas nem loops.
- `429`, fila offline/expiração, falha de mídia, timeout de envio e criação com resultado desconhecido, sem retry cego.
- Histórico/mídias existentes preservados; nova mídia copiada antes de expirar; piloto e plano de troca/rollback documentados antes de migrar clientes.

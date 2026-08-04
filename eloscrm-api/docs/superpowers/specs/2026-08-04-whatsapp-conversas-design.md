# Conversas de WhatsApp no CRM — Spec de Design + Plano

> Fase 2 da integração. A fase 1 entregou o ciclo de vida da instância
> ([spec](./2026-08-03-whatsapp-uazapi-design.md)); esta entrega a **conversa**: ingerir mensagens,
> atender pelo CRM e transformar quem chega em lead dentro do funil.

Estado de referência: commit `a605441` (`main`), árvore limpa.
Escopo confirmado: **bidirecional** — o corretor conversa pelo CRM, não só lê.

---

## 1. Isto não é "mais uma tela"

A fase 1 aceitou três restrições de propósito, todas justificadas por "o evento `connection` chega
dezenas de vezes por dia": processamento **inline** no webhook, **sem fila** e **sem rate limit**. O
próprio spec registrou que "quando entrar `messages`, a fila volta à mesa".

Ela voltou. `messages` é tráfego contínuo, com anexo, ordem, duplicata e latência. Uma mensagem
recebida dispara download de mídia e upload ao R2 — trabalho de segundos dentro de um caminho que
hoje responde em milissegundos. Manter inline significa a uazapi estourando timeout e acumulando
retentativa em `/webhook/errors`.

---

## 2. O que a investigação encontrou

Tudo aqui é observação de tráfego real (uazapiGO v2.1.1), não leitura de spec. O envelope de
`messages` **não está documentado** — foi capturado via `UAZAPI_DEBUG_LOG` e `/webhook/errors`.

### 2.1 O envelope de `messages` é diferente do de `connection`

```jsonc
{
  "BaseUrl": "https://….uazapi.com",
  "EventType": "messages",
  "token": "…",
  "owner": "554391834229",
  "instanceName": "matra",
  "chatSource": "updated",
  "chat":    { /* 62 campos */ },
  "message": { /* 30 campos */ }
}
```

`connection` entrega o payload em `instance`; `messages` entrega em **`chat` + `message`, no topo**.
O `connectionDataOf` atual lê `body.instance` e não serve — a fase 2 precisa do seu próprio extrator.

### 2.2 `sender` é LID, não telefone — a armadilha central

```jsonc
"sender":     "226070083190831@lid",            // identificador opaco: NÃO é telefone
"sender_pn":  "554391834229@s.whatsapp.net",    // o telefone resolvido
"chatid":     "554391834229@s.whatsapp.net",
"chat.phone": "554391834229"                    // já normalizado, só dígitos
```

O WhatsApp migrou para **LID** (identificador que não revela o número). Casar lead por `sender`
nunca funcionaria. A fonte para matching é `chat.phone` (só dígitos, pronto) com `sender_pn` de
reserva. Guardar o LID mesmo assim: é o que identifica a pessoa de forma estável se ela trocar de
número.

### 2.3 Campos de `message` que importam

| Campo | Valor observado | Uso |
|---|---|---|
| `id` | `554391834229:3EB0DD074A9960E7A604B4` | `owner:messageid` — chave natural, única por instância |
| `messageid` | `3EB0DD074A9960E7A604B4` | id do provedor |
| `chatid` | `554391834229@s.whatsapp.net` | agrupa a conversa |
| `fromMe` | `true` | direção |
| `type` | `text` | tipo simplificado — use este |
| `messageType` | `ExtendedTextMessage` | tipo bruto do WhatsApp; guardar, não ramificar |
| `mediaType` | `""` | preenchido só em mídia |
| `messageTimestamp` | `1785817572632` | **milissegundos**, não segundos |
| `content` | `{ text, contextInfo }` | objeto, não string |
| `wasSentByApi` | `true` | distingue envio nosso de envio pelo celular |
| `quoted`, `reaction`, `vote`, `edited` | `""` | resposta, reação, enquete, edição |

### 2.4 A uazapi tem um CRM embutido — vamos ignorá-lo

`chat` traz `lead_name`, `lead_status`, `lead_tags`, `lead_kanbanOrder`, `lead_isTicketOpen`,
`lead_assignedAttendant_id` e `lead_field01…20`. É um mini-CRM do provedor.

**Não usar como fonte de verdade.** Nosso `Client`/`Deal`/`Stage` é o modelo do produto; espelhar
estado em dois lugares cria divergência sem dono. Ler `chat.lead_name` só como *sugestão* de nome ao
criar lead — nunca escrever de volta.

### 2.5 Os sete tipos observados, e as armadilhas de cada um

Capturados em tráfego real: texto, imagem, áudio de voz, documento, gif e figurinha (todos
`fromMe: false`), mais o texto enviado pela API.

| `messageType` | `type` | `mediaType` | `content` | `mimetype` | Particular |
|---|---|---|---|---|---|
| `Conversation` | text | `''` | **string** | — | texto simples |
| `ExtendedTextMessage` | text | `''` | objeto | — | texto com contexto/link |
| `ImageMessage` | media | `image` | objeto | `image/jpeg` | `width`, `height`, `caption`, thumb |
| `AudioMessage` | media | `ptt` | objeto | `audio/ogg; codecs=opus` | `seconds`, `waveform`, **sem thumb** |
| `DocumentMessage` | media | `document` | objeto | `application/pdf` | `fileName`, `pageCount`, thumb |
| `VideoMessage` | media | **`gif`** | objeto | **`video/mp4`** | `gifPlayback: true`, `seconds`, thumb |
| `StickerMessage` | media | `sticker` | objeto | `image/webp` | `isAnimated`, `isAvatar`, **sem thumb** |

**As cinco armadilhas:**

1. **`content` é `string` no texto simples** e objeto em todo o resto. Ler `content.text` direto
   estoura em `Conversation` — que é justamente o tipo mais comum.
2. **GIF é vídeo.** `messageType: VideoMessage`, `mimetype: video/mp4`. Só `mediaType: 'gif'` e
   `gifPlayback: true` distinguem — e a UI precisa saber, porque gif toca em laço e sem controles.
3. **Áudio de voz é `ptt`, não `audio`.** Merece a UI de nota de voz (onda + duração), não um player
   de arquivo.
4. **Figurinha e áudio não têm `JPEGThumbnail`.** O estágio 3 da §3.5 não cobre esses dois: áudio
   mostra duração e `waveform`; figurinha mostra um marcador até o arquivo chegar.
5. **Tamanho não segue a intuição:** a figurinha tem 233 KB — mais de 10× a foto JPEG (18 KB). Um
   teto de tamanho baixo demais recusaria figurinha, que é conteúdo trivial de conversa.

Além disso: `message.text` já traz a legenda (duplicando `content.caption`), o que evita mais uma
ramificação por tipo.

**O que nenhum tipo traz: `fileURL`.** O `content.URL` aponta para `mmg.whatsapp.net/….enc` —
arquivo cifrado que exige `mediaKey` para decifrar, inútil num `<img src>`. A URL exibível só nasce
do `/message/download`.

**O que todos trazem (menos os dois da armadilha 4): `JPEGThumbnail`** em base64, de 700 a 4368
chars. Preview instantâneo, sem requisição nenhuma — e os metadados (nome, tamanho, duração,
dimensões, páginas) vêm junto, então a bolha nasce completa.

### 2.6 `messages_update` — o ✓✓, e o bug que ele revelou

```jsonc
{
  "EventType": "messages_update",
  "type": "ReadReceipt",          // subtipo
  "state": "Delivered",           // ou "Read" — é o status que interessa
  "token": "…", "owner": "…", "instanceName": "…",
  "event": {                      // ⚠️ OBJETO, não string
    "MessageIDs": ["ACDBFDADC9802B7379B245CBBAA0A170", "…"],
    "Chat": "554398414904@s.whatsapp.net",
    "Sender": "…", "sender_pn": "…", "sender_lid": "…@lid",
    "IsFromMe": "False",          // ⚠️ string, não booleano
    "IsGroup": "False",
    "Timestamp": "1785820620",    // ⚠️ SEGUNDOS — messageTimestamp era ms
    "Type": "Delivered"
  }
}
```

**Este evento derrubou a API por horas com `422`, em silêncio.** O `webhookBodySchema` tipava
`event` como `string` — porque nas outras formas de envelope `event` era sinônimo de `EventType`.
Aqui é o payload. O Zod rejeitava, o errorHandler devolvia 422, e o único sintoma ficava em
`/webhook/errors` da uazapi: 10 entregas falhadas que ninguém veria sem procurar.

É a profecia do próprio plano se cumprindo — "rejeitar o corpo derrubaria todos os eventos em
silêncio" — só que contra o nosso schema, não contra uma mudança do provedor. Corrigido: `event`
aceita string **ou** objeto, e `eventNameOf` só usa `event`/`type` como nome quando são string.

**Três armadilhas para a fase de status:**

1. **`MessageIDs` é array** — um evento atualiza N mensagens (observados 1, 3, 11 e 12). O update é
   em lote, não por mensagem.
2. **`IsFromMe` é a string `"False"`**, não booleano. `if (event.IsFromMe)` é sempre verdadeiro.
3. **`Timestamp` está em segundos**, enquanto `messageTimestamp` de `messages` está em
   milissegundos. Mesmo provedor, mesma conversa, unidades diferentes.

Os ids em `MessageIDs` são o `messageid` puro, **sem** o prefixo `owner:` do `message.id` — a
reconciliação com `WhatsappMessage` tem que usar `providerMessageId`, não `providerId`.

**`wasSentByApi` no exclude não suprime este evento** — ele chega normalmente. Confirmado em
tráfego real: o filtro fica, e o ✓✓ funciona mesmo assim.

### 2.7 Mídia expira em 2 dias

Da spec de `/message/download`: *"mantemos as mídias no nosso storage por 2 dias. Após 2 dias, elas
são removidas na limpeza automática e o link retornado deixa de ficar disponível."*

Consequência dura: **se não baixarmos na ingestão, o áudio que o lead mandou some.** É a única parte
deste sistema onde a falha é irreversível — todo o resto se recupera com um sync.

### 2.8 Telefone: o nono dígito quebra o matching

| Origem | Formato | Exemplo |
|---|---|---|
| `Client.phone` (18/18 registros) | máscara, 11 dígitos nacionais | `(43) 99812-4470` |
| `chat.phone` (WhatsApp) | dígitos, **10** nacionais | `554391834229` |

O CRM guarda com o nono dígito; o JID veio sem. São a mesma pessoa e **não casam** por comparação
direta. Pior: `Client.phone` é `z.string().optional()` sem normalização e **sem índice**.

---

## 3. Decisões de arquitetura

**3.1 — Redis + BullMQ, com duas filas.**
O webhook valida, enfileira e responde `200` em milissegundos. O trabalho pesado — persistir,
baixar mídia, subir ao R2 — roda no worker.

```
fila `whatsapp-message`   payload cru do webhook → Conversation + WhatsappMessage
                          → se tem mídia, enfileira na fila abaixo
fila `whatsapp-media`     /message/download → URL temporária → baixa → R2 → mediaKey
```

Duas filas e não uma: mídia é lenta e pode falhar sem que a mensagem falhe junto. Separar deixa a
mensagem aparecer na tela na hora, com a mídia chegando depois (§7).

Retry, backoff exponencial e concorrência vêm do BullMQ (`attempts: 3`, `backoff exponential`), no
mesmo padrão do `matra-notification-manager` (`packages/api/src/lib/queue.ts`) — `createQueue` /
`createWorker` que devolvem `null` sem `REDIS_URL`.

**Sem `REDIS_URL` o processamento é inline**, na mesma função. É o que mantém dev, teste e CI
rodando sem subir Redis, e o que torna os testes determinísticos (sem corrida com worker). Em
produção o Redis é obrigatório: o boot loga aviso quando falta, porque inline devolve o problema que
esta fase existe para resolver.

**Rede de segurança:** perder um job no Redis perde a mensagem. Por isso existe
`POST /conversations/:id/sync`, que relê o histórico por `/message/find` e reconcilia por
`providerId` (§3.2). Sem isso, um Redis efêmero significaria buraco silencioso na conversa.

**3.2 — Chave de idempotência é `message.id` (`owner:messageid`).**
Webhook repete — a captura desta investigação foi feita justamente sobre uma entrega que falhou e
ficou pendente. `@@unique([instanceId, providerMessageId])` faz a segunda entrega virar no-op.

**3.3 — Telefone normalizado em coluna própria, com índice.**
`Client.phoneKey` = `DDD + últimos 8 dígitos` (ex.: `4391834229` → `43` + `91834229`). É a chave que
sobrevive ao nono dígito nos dois sentidos.

Colisão conhecida: fixo `(43) 3324-1234` e celular `(43) 93324-1234` geram a mesma chave. Raro (o CRM
guarda celular, e WhatsApp em fixo é incomum), mas **não auto-vincula quando o match é ambíguo** —
mais de um `Client` com a mesma `phoneKey` vira decisão do corretor na tela.

A normalização entra no **service**, não só no backfill: `clients.schema.ts` aceita string crua hoje,
então sem isso o próximo lead cadastrado à mão volta a não casar.

**3.4 — Conversa existe sem lead.**
`Conversation.clientId` é opcional. É o caso de uso central do pedido: alguém desconhecido manda
mensagem, o corretor lê e **então** decide criar o lead. Amarrar conversa a lead obrigaria a criar
lead para todo número que escreve — inclusive engano e spam.

**3.5 — Mídia no R2, com a URL temporária da uazapi cobrindo o intervalo.**
O destino final é o R2 privado (§2.7 — em 2 dias o link da uazapi morre). Mas o corretor não pode
esperar o upload para ver a foto que acabou de chegar.

Então a mensagem tem **três estágios de exibição**, em ordem de precedência:

1. `mediaKey` no R2 → **presigned URL** de curta duração. É o caminho definitivo.
2. Ainda na fila → `mediaTempUrl` da uazapi, enquanto não expirou.
3. Nada disso ainda → **`JPEGThumbnail`** (§2.5), que chegou junto do webhook e não custa
   requisição nenhuma. Some assim que (1) ou (2) existir. Em `ptt` e `sticker` não há thumb: o
   primeiro mostra duração e onda, o segundo um marcador.

O estágio 3 é o que faz a bolha nunca aparecer vazia: a miniatura está no banco no mesmo instante em
que a mensagem aparece, antes de qualquer chamada à uazapi.

Quem resolve isso é o backend, num único ponto (§7.2); o front recebe uma URL pronta e não conhece a
diferença. Assim que o upload conclui, a mensagem é atualizada com a `mediaKey` e a URL temporária é
descartada.

**3.6 — Atualização da tela por polling, não WebSocket.**
O projeto não tem realtime e introduzi-lo é uma fase inteira. Polling curto (3–5s) na conversa
aberta, mais longo na lista. Suficiente para atendimento humano; registrar como débito.

---

## 4. Modelo de dados

```prisma
enum WhatsappDirection { inbound outbound }

/// Espelha `mediaType` da uazapi (§2.5), não `type`, porque é `mediaType` que distingue gif de
/// vídeo e nota de voz de áudio — e as duas distinções mudam como a UI renderiza.
enum WhatsappMessageType {
  text image video gif audio ptt document sticker
  location contact reaction poll system unsupported
}

enum WhatsappMessageStatus { pending sent delivered read failed }

/// Ciclo da mídia: a mensagem existe antes do arquivo estar no R2 (§3.5).
enum WhatsappMediaStatus { none pending ready failed }

model Conversation {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  instanceId     String
  instance       UazapiInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  chatid    String            // 554391834229@s.whatsapp.net
  phone     String?           // dígitos, como a uazapi manda
  phoneKey  String?           // DDD + últimos 8 — casa com Client.phoneKey
  lid       String?           // identificador opaco; sobrevive a troca de número
  isGroup   Boolean @default(false)

  waName      String?         // nome do perfil no WhatsApp
  contactName String?         // nome na agenda do dono
  photoUrl    String?

  // opcional de propósito: conversa chega antes de existir lead (§3.4)
  clientId String?
  client   Client? @relation(fields: [clientId], references: [id], onDelete: SetNull)

  lastMessageAt   DateTime?
  lastMessageText String?
  unreadCount     Int      @default(0)
  archivedAt      DateTime?

  messages WhatsappMessage[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([instanceId, chatid])
  @@index([organizationId, lastMessageAt])
  @@index([organizationId, phoneKey])
}

model WhatsappMessage {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  // `message.id` da uazapi (owner:messageid) — chave de idempotência (§3.2)
  providerId        String
  providerMessageId String?

  direction WhatsappDirection
  type      WhatsappMessageType
  rawType   String?            // messageType bruto: ExtendedTextMessage etc.
  status    WhatsappMessageStatus @default(sent)

  text        String?
  quotedId    String?
  reactionTo  String?
  sentByApi   Boolean @default(false)
  senderLid   String?
  senderName  String?

  mediaStatus   WhatsappMediaStatus @default(none)
  // destino final: chave no R2 privado. Preenchida quando o upload conclui.
  mediaKey      String?
  // metadados vêm do `content` do webhook, antes de qualquer download (§2.5)
  mediaMime     String?
  mediaSize     Int?      // content.fileLength — permite recusar arquivo grande sem baixar
  mediaFilename String?   // content.fileName (documento)
  mediaDuration Int?      // content.seconds (áudio/vídeo)
  mediaWidth    Int?
  mediaHeight   Int?      // dimensões evitam o layout pular quando a imagem carrega
  // content.JPEGThumbnail: base64 que já chega no webhook e cobre o intervalo até o arquivo
  // existir (estágio 3 da §3.5). Ausente em ptt e sticker — ver armadilha 4 da §2.5.
  mediaThumb    String?
  mediaWaveform String?   // ptt: desenha a onda sem baixar o áudio
  // ponte enquanto o upload não terminou (§3.5). A uazapi expira em ~2 dias — guardar a validade
  // evita entregar ao front uma URL que já morreu.
  mediaTempUrl       String?
  mediaTempExpiresAt DateTime?
  mediaError    String?

  // quem enviou pelo CRM; null em mensagem recebida ou enviada pelo celular
  sentById String?
  sentBy   User?  @relation(fields: [sentById], references: [id], onDelete: SetNull)

  sentAt    DateTime           // de messageTimestamp (ms!)
  createdAt DateTime @default(now())

  @@unique([conversationId, providerId])
  @@index([conversationId, sentAt])
  @@index([organizationId, sentAt])
}
```

Em `Client`: `phoneKey String?` + `@@index([organizationId, phoneKey])` + relação
`conversations Conversation[]`.

---

## 5. Ingestão

### 5.1 Caminho do evento

```
POST /webhooks/uazapi/:instanceId/:secret
  1. autentica (já existe)
  2. EventType === "messages" → enqueue("whatsapp-message", payload) → 200
  3. "connection" segue no caminho atual (síncrono, é barato)

worker `whatsapp-message`
  4. resolve/cria Conversation por (instanceId, chatid)
  5. upsert de WhatsappMessage por (conversationId, providerId)   ← idempotente
  6. atualiza lastMessageAt / lastMessageText / unreadCount
  7. casa Client por phoneKey (§6)
  8. tem mídia? mediaStatus = pending  →  enqueue("whatsapp-media", messageId)

worker `whatsapp-media`
  9. /message/download → fileURL + mimetype
 10. grava mediaTempUrl + mediaTempExpiresAt   ← a tela já mostra a mídia daqui
 11. baixa e sobe para o R2 privado
 12. mediaKey + mediaStatus = ready, limpa mediaTempUrl
```

O passo 10 é o que torna a espera invisível: a mensagem aparece com a mídia servida pela URL
temporária antes mesmo de o upload começar.

### 5.2 A fila

`src/lib/queue.ts` no padrão do `matra-notification-manager`: `createQueue` / `createWorker`
devolvendo `null` sem `REDIS_URL`, `attempts: 3` e backoff exponencial.

`enqueue(name, data)` é o ponto único: com Redis, adiciona o job; **sem Redis, chama o processador
direto**. É o que mantém teste e CI sem infra e torna a suíte determinística — nada de esperar
worker em teste.

Job que esgota as tentativas fica em `failed` no BullMQ. Como isso é observável só pelo Redis, a
reconciliação por `/message/find` (§3.1) é a saída de verdade para buraco na conversa.

### 5.3 Infra nova

| Onde | O quê |
|---|---|
| `src/env.ts` | `REDIS_URL` opcional (mesma linha das envs de uazapi) |
| `docker-compose.yml` (raiz) | serviço `redis:7-alpine`, junto do Postgres |
| `.github/workflows/ci.yml` | **não** precisa: sem `REDIS_URL` a suíte roda inline |
| produção | Redis obrigatório; sem ele o boot avisa e o webhook processa inline |
| deps | `bullmq` (a referência usa `^5.77.3`) |

---

## 6. Telefone e vínculo com o lead

A chave é **DDD + os últimos 8 dígitos**. São os 8 finais que o nono dígito não altera:

```
"(43) 99183-4229"   → 43991834229 (11)  → DDD "43" + "91834229" → "4391834229"
"554391834229"      →   4391834229 (10) → DDD "43" + "91834229" → "4391834229"  ✅ mesmo lead
"(43) 99812-4470"   → 43998124470 (11)  → DDD "43" + "98124470" → "4398124470"
```

Regra: tira não-dígitos → remove `55` inicial quando o resto tem 10 ou 11 → DDD (2) + últimos 8.

**Migração:** coluna nova, índice, backfill dos registros existentes (18 em dev), e escrita
normalizada no `clients.service` — criar **e** atualizar.

**Vínculo:** na ingestão, buscar `Client` por `(organizationId, phoneKey)`.

| Resultado | Ação |
|---|---|
| 1 lead | vincula automaticamente |
| 0 leads | conversa fica sem lead; a tela oferece **Criar lead** |
| 2+ leads | **não** vincula; a tela pede para o corretor escolher (§3.3) |

---

## 7. Mídia

Endpoint **novo na lib**: `messages.download({ id, return_link: true })` — hoje `messages.ts` só tem
`find`. Resposta: `{ fileURL, mimetype, base64Data?, transcription? }`.

### 7.1 Fluxo

```
ingestão (fila whatsapp-message)
  → grava mediaMime/mediaSize/mediaFilename/mediaDuration/mediaWidth/mediaHeight/mediaThumb
  → mediaStatus = pending
  ← A BOLHA JÁ APARECE: miniatura, nome do arquivo, tamanho e duração, sem nenhuma chamada externa
  ↓ worker whatsapp-media
POST /message/download { id, return_link: true }
  → fileURL válida ~2 dias
  → mediaTempUrl + mediaTempExpiresAt       ← A PARTIR DAQUI a tela já mostra a mídia
  ↓
baixa a fileURL e sobe ao R2 privado
  org/<orgId>/whatsapp/<conversationId>/<messageId>.<ext>
  → mediaKey + mediaMime + mediaSize, mediaStatus = ready, mediaTempUrl = null
```

Falha esgotadas as tentativas: `mediaStatus = failed` + `mediaError`. A mensagem continua na
conversa, marcada como mídia indisponível — **nunca sumir com a mensagem por causa do anexo**.

Sem retry indefinido: passados os 2 dias não há o que buscar (§2.7). O limite de tamanho (sugestão:
20 MB) é aplicado **antes de baixar**, com o `content.fileLength` que já veio no webhook — arquivo
acima do teto vira `failed` com motivo, e a bolha ainda mostra nome, tamanho e miniatura.

### 7.2 A URL que o front recebe

Um único resolvedor no backend decide, por mensagem:

| Condição | O que devolve |
|---|---|
| `mediaStatus = ready` | **presigned URL** do R2, curta (~10 min), como `Attachment` já faz |
| `mediaStatus = pending` e `mediaTempExpiresAt` no futuro | `mediaTempUrl` da uazapi |
| resto | `null` + motivo — a UI cai no `mediaThumb`, que sempre esteve lá |

O front nunca sabe de onde veio — pede a URL e exibe. Como a presigned expira, a URL **não** é
cacheada na resposta de listagem por muito tempo: ou vem junto da mensagem com TTL curto, ou por
`GET /messages/:id/media` no momento de exibir. Preferir a segunda para vídeo e documento; embutir
para imagem, que aparece imediatamente na thread.

> **Confirmado em 2026-08-04** com image, ptt e document reais (§2.5): não há `fileURL` no
> webhook, e o `content.URL` aponta para o `.enc` cifrado do CDN da Meta. A URL exibível **só nasce
> do `/message/download`** — o fluxo acima está certo. O consolo é o `JPEGThumbnail`, que cobre o
> intervalo melhor do que uma URL cobriria.

---

## 8. Envio

`POST /v1/whatsapp/conversations/:id/messages` → `send.text` / `send.media`.

Grava a mensagem local com `status: pending` **antes** de chamar a uazapi, e atualiza para `sent` ou
`failed` no retorno — assim a mensagem não some da tela se a chamada demorar.

**O erro de capping precisa de tratamento próprio.** A fase 1 construiu a aba Diagnóstico porque o
WhatsApp limita conversas novas; um inbox que deixa iniciar conversa vai bater nisso em volume.
Quando `error_source === "whatsapp_server"`, a UI não mostra "falha ao enviar" — mostra que o
WhatsApp bloqueou e aponta para o Diagnóstico. O `provider_code: 463` e `message_ptbr` já vêm
normalizados no `UazapiErrorPayload`.

Envio pelo celular também aparece: chega por webhook com `fromMe: true` e `wasSentByApi: false`.

---

## 9. API

| Método | Rota | Papel |
|---|---|---|
| `GET` | `/v1/whatsapp/conversations` | lista (busca, não lidas, arquivadas) |
| `GET` | `/v1/whatsapp/conversations/:id` | detalhe + lead vinculado |
| `GET` | `/v1/whatsapp/conversations/:id/messages` | paginado por cursor, mais recentes primeiro |
| `POST` | `/v1/whatsapp/conversations/:id/messages` | envia texto ou mídia |
| `POST` | `/v1/whatsapp/conversations/:id/read` | zera não lidas (+ `/chat/read` na uazapi) |
| `POST` | `/v1/whatsapp/conversations/:id/link-client` | vincula a lead existente |
| `POST` | `/v1/whatsapp/conversations/:id/create-client` | cria lead a partir da conversa |
| `POST` | `/v1/whatsapp/conversations/:id/archive` | arquiva |
| `POST` | `/v1/whatsapp/conversations/:id/sync` | relê o histórico por `/message/find` e reconcilia (§3.1) |
| `GET` | `/v1/whatsapp/messages/:id/media` | URL de exibição, resolvida como na §7.2 |

Todas com `authGuard` + `orgGuard`. **Leitura e envio são de qualquer membro** — conversar é o
trabalho do corretor, diferente de gerenciar a instância (que é de gestor).

Isolamento: conversa é resolvida por `(id, organizationId)`, nunca só por id.

---

## 10. Web

```
app/(app)/conversas/page.tsx          # inbox: lista + painel da conversa
app/(app)/conversas/_components/
├── conversation-list.tsx             # busca, não lidas, arquivadas
├── message-thread.tsx                # bolhas, agrupadas por dia
├── message-composer.tsx              # texto + anexo
├── media-bubble.tsx                  # imagem/áudio/documento
├── lead-panel.tsx                    # lateral: lead vinculado ou ações
├── create-lead-dialog.tsx            # cria lead já com nome/telefone da conversa
└── add-to-pipeline-dialog.tsx        # cria negócio: pipeline + estágio + valor
```

`components/ui/` já tem `message.tsx`, `bubble.tsx` e `message-scroller.tsx` do shadcn — usar, não
reinventar.

Item **Conversas** na sidebar (ícone `MessageSquare`, distinto do `MessageCircle` do WhatsApp), com
contador de não lidas.

Na ficha do lead (`clients/[id]`), **aba Conversa** nova entre as 7 existentes, mostrando a thread
vinculada — é onde o corretor já está quando pensa no lead.

### 10.1 As ações de CRM que o pedido cita

O painel lateral da conversa é onde a conversa vira CRM:

| Situação | Ação oferecida |
|---|---|
| sem lead | **Criar lead** (nome de `chat.wa_name`/`lead_name`, telefone já preenchido, origem `WHATSAPP`) |
| sem lead, telefone ambíguo | **Escolher lead** entre os que casam |
| com lead, sem negócio | **Adicionar ao funil** — escolhe pipeline e estágio, cria `Deal` |
| com lead | atalhos: registrar atividade, comentário, nutrir, abrir a ficha |

`ClientSource.WHATSAPP` **já existe** no enum — nenhuma mudança necessária.

---

## 11. Testes

Mesma linha da fase 1: Postgres real, uazapi mockada (`vi.mock`).

1. Webhook `messages` enfileira e responde 200 (sem Redis na suíte, o processador roda inline).
2. Processamento cria conversa e mensagem a partir do envelope real da §2.1.
3. **Idempotência**: mesmo `message.id` duas vezes → uma mensagem só.
4. `phoneKey` casa `(43) 99183-4229` com `554391834229`.
5. Dois leads com a mesma `phoneKey` → conversa fica **sem** vínculo.
6. `sender` em LID não é usado como telefone.
7. `messageTimestamp` em ms vira `sentAt` correto (não 1970).
7b. Os sete tipos da §2.5 são ingeridos sem erro — em especial `Conversation`, cujo `content` é
    **string**, e `gif`, que chega como `VideoMessage`.
8. Mídia: metadados e `mediaThumb` gravados na ingestão, sem chamar a uazapi; download mockado →
   `mediaTempUrl`; upload → `mediaKey` + `ready`; falha → `failed` com a mensagem preservada.
8b. Resolvedor da §7.2: `ready` → presigned; `pending` com temp válida → temp; temp expirada → nulo.
8c. `fileLength` acima do teto → `failed` **sem** chamar `/message/download`.
9. Envio grava `pending` antes e `sent` depois; erro `whatsapp_server` → código próprio.
10. Isolamento entre organizações em cada rota.
11. `create-client` cria com `source: WHATSAPP` e vincula.
12. Evento com `EventType` desconhecido não enfileira nada e responde 200.
13. Sem `REDIS_URL`, `enqueue` processa inline — é o modo da própria suíte.

---

## 12. Fases

Cada uma fecha com `lint` + `typecheck` + `test` verdes.

### Fase 0 — investigação ✅ concluída

- [x] Envelope de `messages` capturado em tráfego real (§2.1)
- [x] `sender` é LID, matching vai por `chat.phone` (§2.2)
- [x] Sete tipos de mensagem mapeados, com as cinco armadilhas (§2.5)
- [x] `messages_update` capturado; bug do `422` corrigido (§2.6)
- [x] `wasSentByApi` confirmado: fica no exclude, não suprime o status (§2.6)
- [x] `WEBHOOK_EVENTS` assina `connection`, `messages`, `messages_update`

### Fase 1 — telefone ✅ concluída

- [x] `src/lib/phone.ts` com `phoneKey()` (DDD + últimos 8 dígitos)
- [x] `Client.phoneKey` + `@@index([organizationId, phoneKey])`
- [x] Normalização na escrita — **create e update**
- [x] `findClientsByPhoneKey` no repo, para a fase 2 usar
- [x] Backfill (`scripts/backfill-phone-key.ts`), idempotente e com dry-run
- [x] Testes: nono dígito, máscara, DDD preservado, colisão fixo/celular, telefone vazio

*Independente do resto: pode ir para produção sozinha.*

**Divergência do planejado:** a derivação ficou no **repo**, não no service. `createClient` e
`updateClientById` são os dois únicos pontos que escrevem `phone`; deixar na camada de cima abriria
espaço para um caminho novo gravar telefone sem chave — e o sintoma seria o lead não casar com a
conversa, em silêncio.

**Deploy:** exige `prisma db push` **e** rodar o backfill com `--apply`. Sem o backfill, todo lead
já existente fica com chave nula e nunca casa.

### Fase 2 — ingestão ✅ concluída

- [x] `bullmq` + `ioredis` + `REDIS_URL` + `src/lib/queue.ts` (com `enqueue` inline sem Redis)
- [x] `redis:7-alpine` no `docker-compose.yml` da raiz
- [x] Models `Conversation` e `WhatsappMessage`
- [x] Extrator do envelope `messages` (`message-envelope.ts`), separado do `connectionDataOf`
- [x] Fila `whatsapp-message`: conversa, mensagem, idempotência por `providerId`
- [x] Metadados de mídia e `JPEGThumbnail` já gravados aqui (o download fica para a fase 3)
- [x] Matching com `Client` por `phoneKey`, sem auto-vincular quando ambíguo
- [x] 11 testes com os payloads reais capturados (texto, imagem, gif, ptt)

**Notas de implementação:**

- `msgpackr-extract` (build nativo que vem com o `bullmq`) foi marcado `false` em
  `pnpm-workspace.yaml`: serve só para acelerar serialização, e o `msgpackr` cai no caminho em JS.
  Nenhum script de terceiro roda na instalação.
- `ioredis` precisou ser declarado explicitamente — o `bullmq` não o traz sozinho.
- O upsert da conversa **não** toca em `clientId`: o vínculo é decisão do corretor e não pode ser
  desfeito por um evento chegando.

### Fase 3 — mídia ✅ concluída

- [x] `messages.download` na lib
- [x] Metadados e `JPEGThumbnail` gravados já na ingestão (feito na fase 2)
- [x] Fila `whatsapp-media`: URL temporária → R2 → `mediaKey`
- [x] Resolvedor de URL da §7.2, com os três estágios
- [x] Teto de 25 MB aplicado **antes** do download, pelo `fileLength` do webhook
- [x] 10 testes, incluindo upload real no R2 e leitura do conteúdo de volta

**Notas de implementação:**

- O download é endereçado por `providerMessageId` (o id puro), não pelo `providerId` — este último
  carrega o prefixo `owner:` do id interno da uazapi. **A confirmar contra a API real na fase 8**;
  os testes travam o comportamento, mas o formato aceito pelo endpoint não foi observado.
- `mediaTempUrl` recebe validade de **36 h**, menor que as ~48 h do provedor: entregar ao front um
  link que já morreu é pior do que dizer que a mídia ainda não está pronta.
- Falha de download marca `mediaStatus = failed` e **preserva a mensagem** — o texto e a legenda
  continuam na conversa.
- Extensão sai do `fileName` quando existe, senão do mimetype; `audio/ogg; codecs=opus` precisa
  perder o parâmetro antes do lookup.

### Fase 4 — status (`messages_update`) ✅ concluída

- [x] Reconciliação em lote por `providerMessageId` (`MessageIDs` é array)
- [x] `WhatsappMessage.status` refletindo `Delivered`/`Read`
- [x] Status **nunca regride** — recibo atrasado não desfaz leitura
- [x] Recibo de leitura em mensagem recebida zera o `unreadCount`
- [x] 9 testes com o payload real, incluindo isolamento entre organizações

**Decisão: `IsFromMe` e `Timestamp` não entram na lógica.**
`IsFromMe` chega como a **string** `"False"` e sua semântica exata — quem emitiu o recibo — não foi
confirmada em tráfego. `Timestamp` vem em segundos, ao contrário do `messageTimestamp`. Como os
`MessageIDs` já dizem exatamente quais mensagens mudaram, não é preciso inferir nada dos dois: o
efeito no não lido é derivado da **direção das mensagens efetivamente atualizadas**, que é dado
nosso e não interpretação do payload.

Processado **fora da fila**: é um `updateMany` por lote de ids, sem chamada externa.

### Fase 5 — leitura no web ✅ concluída

**API de leitura** (não estava no checklist e era pré-requisito):

- [x] `GET /conversations` com busca, não lidas e arquivadas
- [x] `GET /conversations/:id` e `/:id/messages` (paginado para trás)
- [x] `POST /:id/read`, `/:id/archive`, `/:id/unarchive`
- [x] `GET /conversations/messages/:id/media` para renovar a presigned
- [x] 13 testes, incluindo que `mediaKey` e `mediaTempUrl` **nunca** saem crus

**Web:**

- [x] Inbox: lista com busca e filtros + thread com separador de dia
- [x] Bolhas por tipo: `gif` em laço mudo, `ptt` com duração, documento com nome e tamanho
- [x] `mediaThumb` desfocado enquanto o arquivo não chega
- [x] ✓ / ✓✓ / ✓✓ azul conforme o status, só nas mensagens que saem daqui
- [x] Item **Conversas** na sidebar
- [ ] Painel do lead e aba na ficha do cliente → movido para a fase 7, junto das ações de CRM

**Notas:**

- A URL da mídia é embutida na listagem em vez de pedida por bolha: assinar é computação local,
  sem I/O, então uma requisição a menos por mensagem sai mais barato. O endpoint dedicado fica para
  renovar quando a presigned expira.
- O separador de dia é derivado no `useMemo`, comparando com o item anterior — acumular estado
  durante o render é erro de lint (`react-hooks/immutability`) e de correção.

### Fase 6 — envio de texto ✅ concluída

- [x] `POST /conversations/:id/messages` com `send.text`
- [x] Mensagem gravada como `pending` **antes** da chamada, `sent`/`failed` depois
- [x] Erro de capping com código próprio (`422 WHATSAPP_BLOCKED`) e `providerCode`
- [x] Composer com Enter para enviar, Shift+Enter para quebrar linha
- [x] Bloqueio do WhatsApp vira alerta explicativo com link para o Diagnóstico, não um toast
- [x] 6 testes de envio, incluindo instância desconectada e isolamento entre organizações

**Envio de mídia ficou de fora** e vira item próprio. Não é só ligar `send.media`: o arquivo do
corretor precisa chegar até a uazapi, e as duas saídas têm custo — base64 no corpo (pesado) ou subir
ao R2 e passar uma presigned de curta duração para o provedor baixar. A segunda parece melhor e
reaproveita o storage, mas é trabalho de uma fase, não de um parágrafo. Texto cobre o atendimento.

**Sem otimismo local no front.** A mensagem só aparece depois que o servidor confirma — porque o
envio pode ser recusado pelo próprio WhatsApp, e mostrar uma bolha que depois some é pior do que
esperar. O `pending` no banco existe para o caso oposto: o provedor demorar e a mensagem já estar
registrada.

### Fase 7 — ações de CRM ✅ concluída

- [x] Criar lead a partir da conversa (`source: WHATSAPP`, telefone com máscara, auditoria)
- [x] Escolher lead quando o telefone é ambíguo (`GET /:id/candidates`)
- [x] Vincular e desvincular lead, com verificação de organização
- [x] Adicionar ao funil (pipeline + estágio), reusando `POST /v1/deals`
- [x] Aba **Conversa** na ficha do lead, reusando thread e composer do inbox
- [x] Filtro `?clientId=` na listagem — é como a ficha acha a conversa
- [x] 7 testes novos (26 no arquivo de conversas)

**Um dialog para os dois caminhos.** Criar e escolher respondem à mesma pergunta — *de quem é esta
conversa* — e separá-los levaria o corretor a criar um segundo lead com um número que já existe.
Quando há candidatos, escolher aparece **antes** de criar.

**Bug corrigido de tabela ao lado:** `formatPhone` decidia a máscara pelo primeiro dígito
(`startsWith("9") ? 5 : 4`), o que erra em número de 8 dígitos começando com 9 — `9111-2222` virava
`91112-222`. É justamente o formato que o WhatsApp entrega quando o número não tem o nono dígito,
então a tela de conversas exibiria telefone errado com frequência. Agora o número completo manda no
corte e a heurística do "9" vale só durante a digitação.

### Fase 8 — validação real e docs

- [ ] Conversa de ponta a ponta com número de verdade
- [ ] Formatos novos observados registrados aqui e no `CLAUDE.md`

---

## 13. Riscos

| Risco | Mitigação |
|---|---|
| **Mídia perdida** — 2 dias e sumiu | baixar assim que a mensagem chega; `failed` explícito na UI, sem fingir que existe |
| **Redis fora do ar** | webhook responde 200 e processa inline (degradado, mas não perde); boot avisa quando falta `REDIS_URL` em produção |
| **Job perdido no Redis** = buraco na conversa | `POST /conversations/:id/sync` relê por `/message/find` e reconcilia por `providerId` |
| **Presigned expirada na tela** | TTL curto de propósito; a URL é resolvida no momento de exibir, não cacheada na listagem (§7.2) |
| **Volume** — inbox de imobiliária movimentada | `removeOnComplete`/`removeOnFail` do BullMQ contêm o Redis; a mídia no R2 é que precisa de política de retenção |
| **Nono dígito com colisão fixo/celular** | não auto-vincular quando ambíguo (§3.3) |
| **Envelope muda** | o receptor tolerante da fase 1 continua valendo; `log.warn` no desconhecido |
| **LGPD** | conversa inteira é dado pessoal: mídia em bucket privado, presigned curto, e uma decisão de retenção antes de produção |
| **Capping do WhatsApp** | erro dedicado na UI (§8), não "falha ao enviar" |
| **`db push` manual em produção** | quatro models novos; o `CLAUDE.md` já alerta que esquecer só quebra em runtime |

---

## 14. Fora de escopo

Grupos (o modelo aceita `isGroup`, mas a UI não trata), enquetes/botões/carrossel, chamadas,
newsletters, resposta automática/chatbot, e os campos `lead_*` da uazapi (§2.4).

---

> Criado em 2026-08-04 01:29 (-03) · Última modificação: 2026-08-04 09:27 (-03)

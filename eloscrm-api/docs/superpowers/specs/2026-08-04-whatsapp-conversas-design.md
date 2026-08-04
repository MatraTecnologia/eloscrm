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

### 2.6 Mídia expira em 2 dias

Da spec de `/message/download`: *"mantemos as mídias no nosso storage por 2 dias. Após 2 dias, elas
são removidas na limpeza automática e o link retornado deixa de ficar disponível."*

Consequência dura: **se não baixarmos na ingestão, o áudio que o lead mandou some.** É a única parte
deste sistema onde a falha é irreversível — todo o resto se recupera com um sync.

### 2.7 Telefone: o nono dígito quebra o matching

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
O destino final é o R2 privado (§2.6 — em 2 dias o link da uazapi morre). Mas o corretor não pode
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

Sem retry indefinido: passados os 2 dias não há o que buscar (§2.6). O limite de tamanho (sugestão:
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

**Fase 1 — telefone.** `phoneKey` em `Client`, índice, normalização no service, backfill. Sem isso
nada casa. *Independente do resto: pode ir para produção sozinha.*

**Fase 2 — ingestão.** `bullmq` + `REDIS_URL` + `src/lib/queue.ts`, Redis no `docker-compose`, models,
`messages` no webhook registrado, fila `whatsapp-message`, matching. Sem UI: verificável por teste e
pelo banco.

**Fase 3 — mídia.** `messages.download` na lib, fila `whatsapp-media`, cópia para o R2 e o
resolvedor de URL. O formato já está observado (§2.5) — não há captura pendente.

**Fase 4 — leitura no web.** Inbox, thread, painel do lead, aba na ficha. Já entrega valor sem envio.

**Fase 5 — envio.** Composer, `send.text`/`send.media`, status, tratamento de capping.

**Fase 6 — ações de CRM.** Criar lead, escolher lead, adicionar ao funil.

**Fase 7 — validação real e docs.** Conversa de ponta a ponta com número de verdade; registrar
formatos novos observados (mídia, áudio, resposta, reação) aqui e no `CLAUDE.md`.

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

> Criado em 2026-08-04 01:29 (-03) · Última modificação: 2026-08-04 02:12 (-03)

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

### 2.5 Mídia expira em 2 dias

Da spec de `/message/download`: *"mantemos as mídias no nosso storage por 2 dias. Após 2 dias, elas
são removidas na limpeza automática e o link retornado deixa de ficar disponível."*

Consequência dura: **se não baixarmos na ingestão, o áudio que o lead mandou some.** É a única parte
deste sistema onde a falha é irreversível — todo o resto se recupera com um sync.

### 2.6 Telefone: o nono dígito quebra o matching

| Origem | Formato | Exemplo |
|---|---|---|
| `Client.phone` (18/18 registros) | máscara, 11 dígitos nacionais | `(43) 99812-4470` |
| `chat.phone` (WhatsApp) | dígitos, **10** nacionais | `554391834229` |

O CRM guarda com o nono dígito; o JID veio sem. São a mesma pessoa e **não casam** por comparação
direta. Pior: `Client.phone` é `z.string().optional()` sem normalização e **sem índice**.

---

## 3. Decisões de arquitetura

**3.1 — Ingestão em dois tempos: `WhatsappInboxEvent` + worker.**
O webhook valida, grava o evento cru e responde `200` em milissegundos. Um worker no mesmo processo
consome pendentes. Sem Redis (infra nova em dev e produção), durável a restart (o evento está no
banco, não em memória) e a uazapi nunca espera por download de mídia.

O custo assumido: ordem e retry são nossos. Ordenação por `messageTimestamp`, não por chegada;
retry com contador e backoff simples na própria linha.

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

**3.5 — Mídia baixada na ingestão e guardada no R2 privado.**
Por causa da §2.5. Reaproveita `src/lib/storage.ts` e o padrão de `Attachment` (bucket privado +
presigned URL); nada de URL pública.

**3.6 — Atualização da tela por polling, não WebSocket.**
O projeto não tem realtime e introduzi-lo é uma fase inteira. Polling curto (3–5s) na conversa
aberta, mais longo na lista. Suficiente para atendimento humano; registrar como débito.

---

## 4. Modelo de dados

```prisma
enum WhatsappDirection { inbound outbound }

enum WhatsappMessageType {           // `message.type` da uazapi, normalizado
  text image video audio document sticker location contact
  reaction poll system unsupported
}

enum WhatsappMessageStatus { pending sent delivered read failed }

enum InboxEventStatus { pending processing done failed }

/// Evento cru do webhook. O handler grava e responde; o worker processa.
model WhatsappInboxEvent {
  id         String   @id @default(cuid())
  instanceId String
  instance   UazapiInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  eventType  String
  payload    Json
  status     InboxEventStatus @default(pending)
  attempts   Int      @default(0)
  lastError  String?
  receivedAt DateTime @default(now())
  processedAt DateTime?

  @@index([status, receivedAt])
}

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

  // mídia copiada para o R2 privado (§3.5); null enquanto não baixou ou se falhou
  mediaKey      String?
  mediaMime     String?
  mediaSize     Int?
  mediaFilename String?
  mediaFailed   Boolean @default(false)

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
  2. EventType === "messages" → grava WhatsappInboxEvent(pending) e responde 200
  3. "connection" segue no caminho atual (síncrono, é barato)

worker (setInterval no processo, lock por UPDATE ... RETURNING)
  4. pega N pendentes por receivedAt
  5. resolve/cria Conversation por (instanceId, chatid)
  6. upsert de WhatsappMessage por (conversationId, providerId)  ← idempotente
  7. se tem mídia: /message/download → upload R2 → grava mediaKey
  8. atualiza lastMessageAt / lastMessageText / unreadCount
  9. tenta casar Client por phoneKey (§6)
```

### 5.2 O worker

`setInterval` de ~2s no processo da API, com lock otimista
(`UPDATE ... SET status='processing' WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`) —
seguro se um dia rodar mais de uma instância da API.

Falha: `attempts++`, `lastError`, volta a `pending` até 5 tentativas; depois `failed` e fica visível
numa tela de diagnóstico. **Nunca descartar em silêncio** — foi o que a fase 1 ensinou.

Em teste o worker **não** sobe sozinho: a suíte chama a função de processamento direto, senão os
testes viram corrida.

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
`find`.

```
mensagem com mediaType → POST /message/download
  → fileURL (válida por 2 dias)
  → baixa e sobe para o R2 privado: org/<orgId>/whatsapp/<conversationId>/<messageId>.<ext>
  → grava mediaKey/mediaMime/mediaSize
falhou → mediaFailed = true, mensagem aparece como "mídia indisponível"
```

Sem retry infinito: depois de 2 dias não há o que buscar. Limite de tamanho (sugestão: 20 MB) para
um vídeo não estourar a memória do processo.

Leitura na UI por **presigned URL** de curta duração, como `Attachment` já faz.

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
| `GET` | `/v1/whatsapp/messages/:id/media` | presigned URL da mídia |

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

1. Webhook `messages` grava `InboxEvent` e responde 200 sem tocar em `Conversation`.
2. Worker processa: cria conversa e mensagem.
3. **Idempotência**: mesmo `message.id` duas vezes → uma mensagem só.
4. `phoneKey` casa `(43) 99183-4229` com `554391834229`.
5. Dois leads com a mesma `phoneKey` → conversa fica **sem** vínculo.
6. `sender` em LID não é usado como telefone.
7. `messageTimestamp` em ms vira `sentAt` correto (não 1970).
8. Mídia: download mockado → `mediaKey` gravado; falha → `mediaFailed`.
9. Envio grava `pending` antes e `sent` depois; erro `whatsapp_server` → código próprio.
10. Isolamento entre organizações em cada rota.
11. `create-client` cria com `source: WHATSAPP` e vincula.
12. Evento com `EventType` desconhecido não cria `InboxEvent`.

---

## 12. Fases

Cada uma fecha com `lint` + `typecheck` + `test` verdes.

**Fase 1 — telefone.** `phoneKey` em `Client`, índice, normalização no service, backfill. Sem isso
nada casa. *Independente do resto: pode ir para produção sozinha.*

**Fase 2 — ingestão.** Models, `messages` no webhook registrado, `InboxEvent`, worker, matching.
Sem UI: verificável por teste e pelo banco.

**Fase 3 — mídia.** `messages.download` na lib, cópia para o R2, presigned URL.

**Fase 4 — leitura no web.** Inbox, thread, painel do lead, aba na ficha. Já entrega valor sem envio.

**Fase 5 — envio.** Composer, `send.text`/`send.media`, status, tratamento de capping.

**Fase 6 — ações de CRM.** Criar lead, escolher lead, adicionar ao funil.

**Fase 7 — validação real e docs.** Conversa de ponta a ponta com número de verdade; registrar
formatos novos observados (mídia, áudio, resposta, reação) aqui e no `CLAUDE.md`.

---

## 13. Riscos

| Risco | Mitigação |
|---|---|
| **Mídia perdida** — 2 dias e sumiu | baixar na ingestão; `mediaFailed` explícito na UI, sem fingir que existe |
| **Worker parado** = conversa congelada sem aviso | contador de `pending`/`failed` exposto e alerta na tela quando a fila cresce |
| **Volume** — inbox de imobiliária movimentada | `InboxEvent` cresce rápido; definir expurgo dos `done` (sugestão: 30 dias) |
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

> Criado em 2026-08-04 01:29 (-03) · Última modificação: 2026-08-04 01:29 (-03)

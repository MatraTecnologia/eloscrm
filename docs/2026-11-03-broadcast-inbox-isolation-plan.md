# Plano: disparos sem reordenar a central de conversas

Pedido do cliente: o disparo em massa não pode alterar a ordem cronológica da central; os contatos que estão recebendo disparo ficam numa área própria ("Disparos em andamento").

## Escopo atual (2026-11-03): disparo pela API oficial

O disparo de verdade vai sair pela campanha oficial (`whatsapp-campaigns`), não pela uazapi.
Produção não tem nenhuma campanha ainda (`OfficialCampaign` = 0) e só 1 `Broadcast` de teste.

No caminho oficial, a ordem da central só é escrita em três pontos:

- `outbound.repo.ts:54-57`: cria a conversa do contato novo, que sobe pelo fallback `createdAt` da
  central (`inbox.repo.ts:15`);
- `outbound.repo.ts:119`: o `accept` grava `lastMessageAt: new Date()`;
- `ingest.repo.ts:56`: o eco/histórico de uma mensagem já conhecida. O envio oficial grava
  `sentByApi: true` (`outbound.repo.ts:62`), então a guarda do passo 4 cobre esse caso.

### Decisões fechadas

1. **Janela da aba:** o contato aparece em "Disparos em andamento" enquanto a campanha está em
   `running|paused|needs_review` **ou** até 24h depois do envio para ele (`MAX(m."sentAt")`). Não
   precisa de `finishedAt`, que `OfficialCampaign` não tem.
2. **Retroativo:** não. A regra vale daqui para frente. Em produção, nenhuma conversa está sem
   `lastMessageAt` (conferido em 2026-11-03: 778 uazapi e 2248 oficiais, todas preenchidas).
3. **Contato que só recebeu disparo:** sai de "Atendimentos ativos" e de "Não lidos". Aparece na aba
   de disparos, na busca (`q`) e na ficha do lead (`clientId`). Quando o lead responde, entra no topo.
   Isso substitui o passo 5 original, que mandava a conversa para o fim (epoch).
4. **Disparo pela uazapi desativado** (`UAZAPI_BROADCASTS_ENABLED`, default `false`). Os passos 1, 2
   e 4b e a fonte uazapi da aba saem do escopo até ele voltar.

### Implementado

- `whatsapp-outbound/outbound.repo.ts` (`accept`): só atualiza `lastMessageAt`/`lastMessageText`
  quando o envio não tem `campaignRecipientId`.
- `whatsapp-official/ingest.repo.ts`: eco/histórico de mensagem `sentByApi` não avança a ordem.
  Eco que chega **antes** do `accept` ainda não casa pelo `providerMessageId`; por isso, mensagem de
  saída nova numa conversa com envio de campanha em voo (`pending|preparing|sending|uncertain`)
  também não avança.
- `whatsapp-inbox/inbox.repo.ts` (`listGroups`):
  - a ordem do grupo é `MAX(lastMessageAt)`, que ignora nulo, então uma conversa nova do mesmo lead
    não puxa o grupo pelo `createdAt`; `createdAt` fica só de reserva para grupo sem nenhuma mensagem;
  - em `all`/`unread`, sem `q` e sem `clientId`, sai o grupo cujas conversas são todas "só
    campanha" (sem `lastMessageAt` e com mensagem de `OfficialSendCommand` de campanha). Conversa
    aberta por envio manual pendente ou falho continua listada, como antes;
  - `filter=broadcasts` com a CTE `dispatched` (`OfficialSendCommand` → `OfficialCampaignRecipient`
    → `OfficialCampaign` → `WhatsappMessage`, todos com `organizationId` da sessão, mensagem
    `failed` fora; o corte de 24h vai como parâmetro, não `now()`, para não depender do fuso da
    sessão do Postgres).
- `inbox.schema.ts`: `broadcasts` no enum. `inbox.service.ts`: cada item devolve `listedAt`.
- Web, `components/whatsapp-official/unified-inbox.tsx`: o filtro vai para a URL
  (`?filter=broadcasts`), ganha a opção "Disparos em andamento" e, nessa aba, cada linha mostra o
  horário do envio e "Disparo enviado, ainda sem resposta" quando não há prévia.
  `lib/messaging-types.ts`: `InboxGroup.listedAt`. As mutações de campanha já invalidam
  `["whatsapp-inbox"]` (`lib/queries/whatsapp-campaigns.ts:19`), e a lista faz polling a cada 5 s.
- Testes: `eloscrm-api/test/whatsapp-campaign-inbox.test.ts`.

Revisão independente do diff (2026-11-03) apontou as duas correções acima e dois erros no teste
novo (lista exata numa org compartilhada; campanha só vira `done` num `claim` posterior), já
corrigidos. Débitos conhecidos, fora do escopo: a CTE `dispatched` parte de todos os
`OfficialSendCommand` da org (90 dias de retenção); se a aba ficar lenta com campanhas grandes,
partir de `OfficialCampaign` ativa/recente com índice `(organizationId, status, updatedAt)`.

Deploy: sem `db push`, sem env nova obrigatória. A API sobe antes da web, porque a web nova manda
`filter=broadcasts`, que a API antiga recusa com 422.

O conteúdo abaixo é a análise original. Onde ele divergir desta seção, vale esta seção.

## 1. Revisão das afirmações das propostas

**Confirmadas no código**

- **A central ordena assim:** `COALESCE(c."lastMessageAt", c."createdAt") AS at` (`eloscrm-api/src/modules/whatsapp-inbox/inbox.repo.ts:15`), depois `MAX(at)` por grupo (`:22`) e `ORDER BY at DESC, id DESC` com keyset `(at, id) < cursor` (`:28-29`). Uazapi e oficial entram juntos (`:20`).
- **A central padrão é a `UnifiedInbox`.** A lista legada só aparece com `view=legacy` ou `?c=` (`eloscrm-web/app/(app)/conversas/page.tsx:171-172`).
- **O disparo uazapi grava a ordem:** o worker chama `sendText` (`broadcasts.service.ts:260`), e `sendText` grava `lastMessageAt: updated.sentAt, lastMessageText` sem olhar a origem (`whatsapp/conversations.service.ts:461-464`). Só há dois chamadores: o worker e a rota manual (`routes/v1/whatsapp/conversations/index.ts:54`).
- **A campanha oficial também grava:** o `accept` faz `lastMessageAt: new Date()` (`whatsapp-outbound/outbound.repo.ts:119`). O `saved` (`:108`) já traz `campaignRecipientId`. A conversa nasce no `upsert` sem `lastMessageAt` e com `update: {}` (`:54-57`).
- **Só existem quatro criadores de `Conversation`:** `conversations.repo.ts:31` (chamado só por `broadcasts.service.ts:237`), `outbound.repo.ts:54`, `ingest.repo.ts:14`, mais o próprio upsert. A ingestão sempre preenche `lastMessageAt` quando ele é nulo (`ingest.repo.ts:56`).
- **A ingestão uazapi de entrada não faz nada:** `processMessageEvent` devolve `{ skipped: true }` (`whatsapp/ingest.service.ts:12`). O webhook só assina `["connection", "messages_update"]` (`whatsapp.service.ts:42`) e usa `excludeMessages: ["wasSentByApi"]` (`:193`).
- **`ingest.repo.ts:56` avança a prévia** sempre que `!conversation.lastMessageAt || message.sentAt >= conversation.lastMessageAt`, inclusive em eco ou histórico de uma mensagem que já existe (`existing`, `:22`). O create da ingestão não grava `sentByApi`, cujo default é `false` (`schema.prisma:1038`).
- **O canal oficial existe e está ativo:** a fila de campanha chama `createSend` e `executeSend` (`whatsapp-campaigns/dispatch.service.ts:22-23`).

**Erradas ou incompletas**

1. **Status ativos da campanha oficial.** As três propostas usam `running|paused`. Mas `pause()` grava `"needs_review"` (`whatsapp-campaigns/campaigns.repo.ts:55`), e é ele que o worker chama quando um template falha (`dispatch.service.ts:25`). Os estados existentes são `draft`, `running`, `paused`, `needs_review`, `done` e `canceled` (`campaigns.repo.ts:38,46,55,86`). Na aba, "em andamento" deve ser `running|paused|needs_review`.
2. **Posição do parâmetro novo de `sendText`.** A proposta 1 fala em "4º parâmetro", mas a função já tem 4 (`orgId, conversationId, data, actor`, `conversations.service.ts:414-419`). O novo é o 5º. A proposta 3 acerta num ponto que vale manter: o parâmetro é interno e não pode entrar em `SendMessageInput`, que é schema do cliente.
3. **`touchConversation` e `refreshPreview` como risco ativo.** `refreshPreview` (`status.service.ts:201-216`) só roda por `messages_update` de deleção. Pode devolver à conversa o horário de um disparo, mas é raro e não justifica a coluna `isOutreach` da proposta 3.
4. **Eco Coexistence do envio uazapi no canal oficial.** As três propostas tratam como hipótese, com razão: nada no código prova que ele acontece. Por isso virou o passo 0, uma verificação, e não código.
5. **A UX da aba ficaria vazia.** Na proposta 1, a conversa criada pelo disparo fica com `lastMessageAt` e `lastMessageText` nulos, e a linha não mostra horário (`unified-inbox.tsx:30` só renderiza com `item.lastMessageAt`). Ajuste: a listagem devolve o `at` da linha (passo A7).

## 2. Contexto e causa raiz

Na central unificada, um grupo sobe quando qualquer conversa dele ganha `lastMessageAt` ou é criada (o reserva é `createdAt`, `inbox.repo.ts:15,22`). O disparo faz as duas coisas:

- **Uazapi:** reaproveita a conversa por `phoneKey` ou cria uma (`broadcasts.service.ts:231-247`), e o `sendText` grava `lastMessageAt` (`conversations.service.ts:461-464`).
- **Oficial:** cria a conversa (`outbound.repo.ts:54-57`, sobe pelo `createdAt`) e o `accept` grava `lastMessageAt` (`:119`).
- **Eco ou histórico:** reentregas da mensagem que o CRM enviou também podem avançar a ordem (`ingest.repo.ts:56`).

## 3. Decisão de design

Base: **"`lastMessageAt` passa a significar a última mensagem de atendimento".** Envio em massa não conta. Resposta do lead e envio manual contam. A aba nova é um filtro calculado a partir dos vínculos que já existem: `BroadcastRecipient.messageId` (`schema.prisma:479`) e `OfficialSendCommand.messageId` + `campaignRecipientId` (`schema.prisma:1132,1149`). Não há coluna nova nem `db push`.

Alternativas descartadas:

- **`activityAt` separado do `lastMessageAt` (proposta 2):** exige `db push`, backfill pesado e um UPDATE de congelamento para um ganho que o MVP já entrega.
- **`outreachAt`, `outreachText` e `isOutreach` com janela de 7 dias, contagens e toast (proposta 3):** é escopo de produto que o cliente não pediu. Também quebra a regra de `clientId` de `conversations.repo.ts:13-15`.
- **Tirar quem recebeu disparo de "Atendimentos ativos":** o pedido é preservar a posição, não esconder um lead que já está em atendimento.
- **Casar o eco uazapi com o disparo por texto e horário:** é heurística frágil, e só vale entrar se o passo 0 confirmar que o eco existe.

## 4. Modelo de dados

Sem mudança de schema.

- **Vínculo uazapi:** `Broadcast(organizationId, status RUNNING|PAUSED)` → `BroadcastRecipient.messageId` → `WhatsappMessage.conversationId`.
  - `BroadcastRecipient` não tem `organizationId` (`schema.prisma:458-484`), então o tenant vem obrigatoriamente do JOIN com `Broadcast`.
- **Vínculo oficial:** `OfficialCampaign.status in (running, paused, needs_review)` → `OfficialCampaignRecipient` → `OfficialSendCommand.campaignRecipientId` + `messageId` → `WhatsappMessage`.
- **Índices que a consulta usa:** o prefixo `broadcastId` de `@@unique([broadcastId, dealId])` (`:483`), `@@unique([campaignRecipientId, organizationId])` (`:1151`) e as PKs. Índice novo só se um EXPLAIN em dados reais pedir.

## 5. Passos

**Correção de 2026-11-03: o número é o mesmo na uazapi e no oficial (Coexistence)**

Com o mesmo número nos dois canais, o eco deixa de ser hipótese. O lead responde pela Cloud API, e
o envio feito pela uazapi (aparelho companheiro) volta como `smb_message_echoes` →
`ingestMessage(..., "business_app")` (`webhook-processing.service.ts:35-36`). Ali ele é uma mensagem
**nova**, sem `sentByApi`, porque o `wamid` não é o `messageid` da uazapi. A conversa sobe em
`ingest.repo.ts:56`, e é a conversa oficial, onde o lead realmente responde. A guarda do passo 4
não cobre esse caso. Por isso entra o passo 4b, e o passo 0 passa a só medir o volume.

4b. Em `ingest.repo.ts`, quando `origin === "business_app"` e a mensagem não existe ainda, procurar
um `BroadcastRecipient` com `Broadcast.organizationId = connection.organizationId`, status
`PROCESSING|SENT|UNKNOWN` (o eco pode chegar antes do `settle`), `phoneKey(number)` igual ao
`phoneKey` do `wa_id`, `text` idêntico e `startedAt` até 10 min antes do `sentAt` do eco. Com
correspondência, a mensagem é gravada normalmente (é histórico real), mas `lastMessageAt` e
`lastMessageText` não avançam. O texto já é renderizado por destinatário, então telefone + texto
idêntico + janela basta como chave → verificar: teste B9 (eco correspondente não sobe; eco de
mensagem digitada no celular sobe; eco com texto diferente sobe).

A aba "Disparos" precisa apontar para a conversa **oficial** do lead, porque é lá que a resposta
chega. O JOIN da seção 4 ganha uma terceira fonte: conversa com `connectionId` cuja `phone` tem a
mesma `phoneKey` do `BroadcastRecipient.number` de um disparo ativo.

**Passo 0 (antes de codar)**

0. Confirmar se o envio uazapi gera eco `business_app` na conversa oficial. A consulta é só leitura, feita pelo usuário (o `.env` da API aponta para produção): procurar `WhatsappMessage` com `origin='business_app'` e o mesmo `text` de um `BroadcastRecipient` com `SENT`, até 5 min depois do `sentAt` → verificar: zero linhas mantém o escopo. Se aparecerem linhas, entra o tratamento de eco como item separado.

**API (`eloscrm-api`)**

1. Em `src/modules/whatsapp/conversations.service.ts:414`, `sendText` ganha o 5º parâmetro interno `options: { preserveInboxOrder?: boolean } = {}`. Ele fica fora de `SendMessageInput`, então a rota nunca o repassa. Com a opção ligada, o `conversation.update` de `:461-464` é pulado; mensagem, status `sent` e auditoria seguem iguais → verificar: `pnpm typecheck`; a rota manual (`index.ts:54`) continua com a assinatura antiga.
2. Em `src/modules/broadcasts/broadcasts.service.ts:260`, passar `{ preserveInboxOrder: true }` → verificar: teste B1.
3. Em `src/modules/whatsapp-outbound/outbound.repo.ts:119`, executar o `conversation.updateMany` só quando `!saved.campaignRecipientId` → verificar: teste B3.
4. Em `src/modules/whatsapp-official/ingest.repo.ts:56`, acrescentar `!existing?.sentByApi` à condição que avança `lastMessageAt` e `lastMessageText`. `unreadCount` e a janela de 24h ficam como estão (`:55,57-58`) → verificar: teste B4. O teste de webhook continua passando.
5. Em `src/modules/whatsapp-inbox/inbox.repo.ts:15`, trocar `c."createdAt"` por `TIMESTAMP 'epoch'`, para que conversa sem mensagem de atendimento vá para o fim. É o mesmo efeito do `nulls: "last"` da legada (`conversations.service.ts:146`) → verificar: teste B5; o cursor `z.iso.datetime()` (`inbox.schema.ts:6`) aceita `1970-01-01T00:00:00.000Z`.
6. Em `src/modules/whatsapp-inbox/inbox.schema.ts:4`, adicionar `"broadcasts"` ao enum. Em `inbox.repo.ts:9-30`, quando `filter === "broadcasts"`, criar a CTE `dispatched("conversationId", at)`: `UNION ALL` das duas fontes da seção 4, com `MAX(m."sentAt")` por conversa e `organizationId = ${orgId}` em `Broadcast`, `OfficialSendCommand` e `OfficialCampaign`. Em `entries`, fazer `JOIN dispatched d` e usar `d.at AS at`. O `HAVING BOOL_OR("archivedAt" IS NULL)` fica → verificar: testes B6, B7 e B8.
7. Em `src/modules/whatsapp-inbox/inbox.service.ts:41`, o item da lista ganha `listedAt: row.at.getTime() > 0 ? row.at : null`. Na aba nova, esse é o horário do disparo; nas outras, é igual ao `lastMessageAt` do grupo → verificar: teste B6 confere `listedAt`.

**Web (`eloscrm-web`)**, ler antes o guia em `node_modules/next/dist/docs/` (conforme `eloscrm-web/AGENTS.md`)

1. Em `components/whatsapp-official/unified-inbox.tsx:18`, trocar `useState("all")` por `useQueryState("filter", { defaultValue: "all" })`, como o `thread` (`:15`) → verificar: `/conversas?filter=broadcasts` abre direto na aba.
2. Em `unified-inbox.tsx:25`, adicionar `<option value="broadcasts">Disparos em andamento</option>` → verificar: screenshot da central com o filtro.
3. Em `unified-inbox.tsx:29-30`, o vazio passa a ser condicional ("Nenhum disparo em andamento."), e o horário vem de `item.listedAt ?? item.lastMessageAt`. Em `lib/messaging-types.ts:9-11`, `InboxGroup.listedAt?: string | null` → verificar: `pnpm typecheck`.
4. Em `lib/queries/broadcasts.ts:52-57`, `invalidate` também invalida `["whatsapp-inbox"]` → verificar: pausar ou cancelar um disparo reflete na aba sem esperar o polling.
5. Opcional: link "Ver na central" para `/conversas?filter=broadcasts` em `app/(app)/deals/broadcast-progress.tsx` e `components/whatsapp-official/campaign-progress.tsx` → verificar: `pnpm lint && pnpm typecheck && pnpm build`.

## 6. Regras: quem sobe a conversa

| Evento | `lastMessageAt` / posição em "Atendimentos ativos" | Aba Disparos |
|---|---|---|
| Envio do disparo uazapi ou campanha oficial | não muda; conversa nova vai para o fim (epoch) | aparece enquanto o disparo estiver ativo |
| Eco ou histórico da mensagem que o CRM enviou (`sentByApi`) | não muda (passo A4) | — |
| Lead responde pela Cloud API (`cloud_api`, `webhook-processing.service.ts:32`) | sobe; `unreadCount + 1`, janela de 24h, automação (`ingest.repo.ts:55-58,65`) | continua enquanto o disparo estiver ativo |
| Lead responde pela uazapi | não entra no CRM; lacuna anterior, sem mudança (`ingest.service.ts:12`) | — |
| Envio manual do corretor (rota `sendText`, `uazapi-manual.repo.ts:16`, `accept` sem campanha) | sobe | — |
| Corretor digita no app do celular (eco `business_app` novo, sem `sentByApi`) | sobe | — |
| Disparo termina (`DONE`, `CANCELED`, `done`, `canceled`) | — | sai sozinho, porque o filtro olha o status |

Na campanha oficial, disparo e resposta ficam na mesma conversa (`connectionId` + `messagingContactId`). No disparo uazapi, a conversa criada não tem `clientId` (`conversations.repo.ts:13-15`), então a resposta aparece no grupo oficial do lead em "Atendimentos ativos" e a conversa uazapi do disparo continua como grupo separado na aba.

## 7. Deploy

- **Sem `db push`, sem env nova e sem backfill obrigatório.**
- **Ordem:** a API sobe primeiro. A web nova contra a API antiga recebe 422 em `filter=broadcasts` (o enum é `strictObject`).
- **Retrocompatibilidade:** linhas antigas são lidas como estão. Um `lastMessageAt` que disparos antigos já contaminaram continua valendo até a próxima mensagem de atendimento.
- **Rollback:** reverter a imagem restaura o comportamento anterior. Nenhum dado gravado no período fica incompatível, porque a mudança só deixa de escrever.
- **Backfill retroativo** (recalcular `lastMessageAt` sem as mensagens de disparo): só se o cliente pedir, em script separado e em lotes.

## 8. Testes

Em `eloscrm-api`, Postgres real, com uazapi e Graph mockadas:

- **B1.** `sendText` real com `preserveInboxOrder` mantém `lastMessageAt` e `lastMessageText` e cria a mensagem `sent`. A rota manual continua atualizando os dois campos (estende `whatsapp-conversations.test.ts:413-418`).
- **B2.** Os grupos A (mais recente) e B (mais antigo) recebem um disparo para B. `GET /v1/whatsapp/inbox` devolve `[A, B]` e afirma a ordem, o que hoje não é testado (`whatsapp-inbox.test.ts:111-122`).
- **B3.** `accept` com `campaignRecipientId` não altera `lastMessageAt`; sem `campaignRecipientId`, altera.
- **B4.** `ingestMessage(..., "business_app")` com `providerMessageId` de uma mensagem `sentByApi` não altera `lastMessageAt`. Um inbound `cloud_api` numa conversa criada por campanha preenche `lastMessageAt`, soma `unreadCount` e põe o grupo em primeiro em `all`.
- **B5.** Conversa criada pelo disparo uazapi fica depois de todo grupo com mensagem em `all`.
- **B6.** `filter=broadcasts` lista o grupo de um broadcast `RUNNING` e de uma campanha `running` ou `needs_review`, com `listedAt` igual ao `sentAt` do disparo. Não lista `DONE` nem `CANCELED`. A paginação por cursor não repete itens.
- **B7.** Isolamento de tenant: o broadcast ativo da org B não aparece na org A.
- **B8.** Conversa arquivada que recebe disparo continua em `archived` e fica fora da aba.
- **Execução:** `pnpm lint && pnpm typecheck && pnpm test` na API; `pnpm lint && pnpm typecheck && pnpm build` na web, mais screenshot de `/conversas?filter=broadcasts`.

## 9. Riscos

- **Eco Coexistence do envio uazapi**, se o passo 0 confirmar: a mensagem entra como `business_app` nova, sem `sentByApi`, e sobe a conversa oficial (`ingest.repo.ts:56`). A guarda do passo A4 não cobre esse caso.
- **Eco oficial antes do `accept`:** o `accept` apaga o eco (`outbound.repo.ts:113-116`), mas a ordem já tinha avançado. A chance é baixa: a Meta não emite eco para envio feito pela própria API.
- **Prévia na legada:** a lista legada calcula a prévia pela última mensagem (`conversations.service.ts:94-103`) e vai mostrar o texto do disparo na posição antiga. Na unificada, a prévia continua sendo a última mensagem de atendimento.
- **`refreshPreview`** numa deleção pode devolver à conversa o horário do disparo (`status.service.ts:212`). É raro e fica fora do MVP.
- **Filtro "sem retorno"** (`broadcasts/reply-filter.ts:30-45`): continua tratando a bolha do disparo como última mensagem. É comportamento anterior.
- **Envio oficial manual que falha** numa conversa nova: ela passa a ir para o fim em vez do topo. É aceitável, porque não houve atendimento.

## 10. Perguntas que dependem do cliente

1. **Duração na aba:** "Disparos em andamento" vale só enquanto o disparo está ativo, ou o contato fica mais um tempo (por exemplo, 24h depois de concluir) para acompanhar as respostas?
2. **Canal de resposta:** a imobiliária recebe as respostas pela API oficial (Cloud API)? Se usa só uazapi, a resposta ao disparo nunca entra no CRM (`ingest.service.ts:12`), e isso é uma demanda separada.
3. **Ordem atual:** corrigir retroativamente as conversas que disparos antigos já empurraram, ou valer só daqui para frente?
4. **Contato só com disparo:** quem recebeu disparo e nunca respondeu fica no fim de "Atendimentos ativos" (proposta atual) ou sai dessa aba e aparece só em Disparos e na busca?
> Criado em 2026-11-03 16:22 (-03) · Última modificação: 2026-11-03 20:27 (-03)

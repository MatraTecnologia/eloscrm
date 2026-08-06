# Auditoria completa — trilha de todas as ações, tela de consulta e retenção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** toda ação de escrita do sistema — domínio, integração, membros e sessão — passa a gravar um
evento de auditoria **autossuficiente** (que continua legível depois de o dado ser apagado); gestores
ganham uma tela `/auditoria` com filtros, detalhe do diff e export; e um job diário apaga eventos além do
prazo de retenção para a tabela não crescer sem limite.

**Architecture:** a tabela `AuditEvent` que já existe é **ampliada** (não substituída) com colunas de
snapshot — `entityLabel`, `context`, `snapshot`, `organizationName`, `actorEmail` — e de origem —
`source`, `ip`, `userAgent`, `requestId`. O ponto único de escrita continua sendo `recordAudit()` em
`src/lib/audit.ts`, chamado de dentro dos services, com o ator/origem chegando pelo parâmetro `actor`
que já é explícito hoje. A leitura ganha uma rota de busca paginada por cursor (`GET /v1/audit-events`
sem `entityId`), restrita a gestor. A retenção é uma função pura (`purgeOlderThan`) exercida por um job
BullMQ diário e por um script CLI — sem Redis não há scheduler, e o script cobre dev/CI/produção sem
fila.

**Tech Stack:** Fastify 5, Prisma 7 (`prisma-client` rust-free, client em `src/generated/prisma`), Zod 4,
BullMQ 6, Better Auth 1.6 (+ organization plugin), Vitest 4 contra Postgres real, Next 16 + React 19 +
TanStack Query + shadcn/ui no web.

Referências: `eloscrm-api/CLAUDE.md`, `eloscrm-web/CLAUDE.md`,
[`plans/2026-07-29-leads-360-a-auditoria.md`](2026-07-29-leads-360-a-auditoria.md) (origem do
`AuditEvent`), [`../../../docs/2026-08-04-debitos-whatsapp.md`](../../../../docs/2026-08-04-debitos-whatsapp.md)
(retenção/LGPD adiada — este plano fecha a parte da auditoria).

---

## 1. Estado atual

Levantado no código, não de memória:

| Peça | Onde | Situação |
|---|---|---|
| Tabela | `prisma/schema.prisma:339` `model AuditEvent` | `entityType`/`entityId` sem FK, `actorId`/`actorName` snapshot, `changes Json`, 1 índice |
| Enums | `schema.prisma:163` | `AuditEntity` = 4 valores (`CLIENT`, `DEAL`, `PROPERTY`, `ACTIVITY`); `AuditAction` = 5 (`CREATED`, `UPDATED`, `DELETED`, `STAGE_CHANGED`, `OWNER_CHANGED`) |
| Escrita | `src/lib/audit.ts` (`recordAudit`, `diffFields`) | Único ponto de escrita; suprime `UPDATED` sem mudança |
| Cobertura | grep `recordAudit` | **5 services**: `clients`, `deals`, `activities`, `properties`, `clients/nurture` |
| Leitura | `GET /v1/audit-events?entityType&entityId` | Devolve **array cru**, `take` fixo, sem cursor nem filtro |
| Timeline | `src/modules/timeline/` | Funde auditoria + atividade + comentário + anexo, só para `CLIENT`/`DEAL` |
| Web | `components/app/audit-feed.tsx`, `lib/queries/audit.ts`, `lib/labels.ts:155-231` | Aba "Histórico" por entidade; `AUDIT_ACTION_LABELS` e `ENTITY_NOUNS` são `Record<enum, string>` **completos** |
| Fila | `src/lib/queue.ts` (BullMQ 6) | `enqueue` roda inline sem `REDIS_URL`; **não existe nada agendado hoje** |
| Log paralelo | `UazapiInstanceLog` (`schema.prisma:626`) | Diagnóstico técnico da uazapi, com `payload`; **cascateia da instância** (some junto com ela) |

**Lacunas em relação ao pedido:**

1. 9 módulos não gravam nada: `pipelines` (+stages), `comments`, `attachments`, `lead-automation`,
   `whatsapp` (instância), `whatsapp/conversations`, `whatsapp/message-actions`, membros/organização,
   sessão (login).
2. O evento não é autossuficiente: guarda `entityId` cru. Apagado o lead, a tela mostra
   `cly3k…` e nem o tipo tem rótulo — o front hoje resolve nome por id em `use-entity-names.ts`,
   que só acha quem **ainda existe**.
3. Não há tela de consulta global — só o feed por entidade.
4. Não há retenção: a tabela cresce para sempre.

## 2. Requisitos do pedido → o que atende

| Pedido | Onde neste plano |
|---|---|
| "tela de auditoria completa do app" | Fase 3 (API de busca) + Fase 4 (`/auditoria` com filtros, detalhe e export) |
| "rastreamento em todas as funções do sistema" | Fase 1 (7 tasks) + **matriz de cobertura** da §4, que é o contrato do que precisa emitir evento |
| "cron de limpeza… para não inflar infinitamente" | Fase 2 (`AUDIT_RETENTION_DAYS`, `purgeOlderThan`, job diário, `pnpm audit:purge`) |
| "dados de auditoria independentes, sem ligação com os dados" | D2: colunas de snapshot (`entityLabel`, `context`, `snapshot`) + ausência de FK para a entidade (já é assim hoje) |
| "assim que o dado for apagado não perder os dados" | D2 + D6 (ordem de escrita: `DELETED` **antes** do delete) + teste explícito de "apaga o lead, o evento continua legível" (Task 4, Step 5) |
| "salvo no próprio schema o item, tipo, etc do que foi mexido" | `entityType` + `entityId` + `entityLabel` + `context` + `snapshot` na própria linha |

---

## 3. Decisões de design

### D1 — Ampliar `AuditEvent`, não criar tabela nova

Um `AuditLog` novo obrigaria migrar as linhas existentes, manter dois leitores (feed antigo + tela nova)
e mexer em `timeline.repo.ts`. Renomear o model é pior ainda: sem migrations, `prisma db push` trata
rename como **drop + create** e perde os dados. Então: mesma tabela, colunas novas, todas opcionais.

### D2 — Autossuficiência é colunas de snapshot, não remoção de FK

O evento **já** não tem FK para a entidade (`entityType`/`entityId` soltos) — apagar um lead nunca
apagou o histórico dele. O que falta é o evento continuar **legível** depois:

| Coluna nova | Para quê | Exemplo |
|---|---|---|
| `entityLabel String?` | o nome que o item tinha no momento do fato | `"Ana Paula Ribeiro"`, `"Apto 302 — Gleba Palhano"` |
| `context Json?` | a que o item pertencia, desnormalizado | `{ "clientName": "Ana Paula", "pipelineName": "Vendas", "stageName": "Proposta" }` |
| `snapshot Json?` | estado no momento do fato, **allowlist por entidade** (ver D9) | `{ "source": "WHATSAPP", "temperature": "HOT", "phoneMasked": "(43) 9****-**77" }` |
| `organizationName String?` | desnormalização do nome da imobiliária, para a busca e o CSV não precisarem de join | `"Imobiliária Matra"` |
| `actorEmail String?` | identifica o ator mesmo depois de ele sair | `"corretor@imobiliaria.com"` |
| `source AuditSource` | quem originou: pessoa, automação, webhook, sistema | `USER` |
| `ip`, `userAgent`, `requestId` | origem técnica e correlação entre eventos da mesma request | — |

**A relação com `Organization` fica em `Cascade`, e isso é o comportamento pedido.** Decisão do dono do
produto (2026-08-06): **excluir a imobiliária apaga tudo que é dela** — arquivos no R2, mensagens,
conversas, negócios e a auditoria. A independência que o pedido exige é em relação ao **dado de
domínio** (apagar um lead não pode apagar o histórico dele), não em relação ao tenant. Isso também é o
que mantém a purga funcionando: linha órfã ficaria invisível a toda query com `organizationId`.

Só que o cascade do Postgres **não alcança tudo**. Duas coisas ficam para trás hoje e são fechadas na
**Task 19**:

1. **Objetos no R2** — `Attachment.key` e `WhatsappMessage.mediaKey` apontam para o bucket privado. A
   linha some, o arquivo continua pago e acessível por chave.
2. **A instância na uazapi** — `UazapiInstance` cascateia no banco, mas a instância remota continua de pé
   no provedor, conectada ao WhatsApp do cliente. `whatsapp.service.remove:211-223` já faz a exclusão
   remota; o caminho de exclusão da org não passa por lá.

**Consequência a não confundir:** `organizationName` **não** sobrevive à exclusão da imobiliária — nada
na tabela sobrevive. Ele é desnormalização de conveniência (busca e CSV sem join), e por isso **não**
pode ser cacheado por processo: a Task 9 audita `afterUpdateOrganization`, ou seja, renomear a
imobiliária é caso real e um cache ficaria velho.

**Não guardo `actorRole`.** Seria uma query em `member` por evento (N+1 no caminho de escrita) para
informação que `actorEmail` + a tela de membros já dão.

### D3 — Enums ampliados (e o custo disso no web)

`AuditEntity` vai de 4 para 16 valores; `AuditAction`, de 5 para 32. Alternativa considerada: trocar por
`String` livre. Rejeitada — a tela filtra por ação, e string livre garante divergência de grafia
(`"deleted"` vs `"DELETED"`) e filtro que não casa.

Três consequências que **precisam** ser tratadas na mesma fase:

1. `eloscrm-web/lib/labels.ts` declara `AUDIT_ACTION_LABELS: Record<AuditAction, string>` e
   `ENTITY_NOUNS: Record<AuditEntity, string>`. Verificado: são `Record` **completos** — cada valor novo
   é erro de `tsc` no web até ganhar rótulo. `ENTITY_NOUNS` é consumido por `audit-feed.tsx`,
   `attachments-panel.tsx`, `comment-feed.tsx` e `unified-timeline.tsx`, sempre na frase
   "deste {noun}" — os substantivos novos têm que ser masculinos e caber nessa frase.
2. `attachments.schema.ts:19,27` e `comments.schema.ts:6,16` validam `entityType` com
   `z.enum(AuditEntity)`. Ampliar o enum faz esses endpoints **aceitarem** `entityType: "PIPELINE"`, e
   `attachments.repo.ts:50-56` termina num `else` que assume `ACTIVITY` — falha fechado (404), mas por
   acidente. Task 3 fecha isso com um subconjunto explícito.
3. Cada valor novo de enum exige `prisma db push` **manual em produção** antes do deploy (§9). Já
   aconteceu com o schema de nutrição: a API sobe e só as rotas que tocam a coluna nova dão 500.

Enums propostos (nomes finais):

```prisma
enum AuditEntity {
  CLIENT  DEAL  PROPERTY  ACTIVITY
  PIPELINE  STAGE
  COMMENT  ATTACHMENT
  CONVERSATION  WHATSAPP_MESSAGE  WHATSAPP_INSTANCE
  LEAD_AUTOMATION
  MEMBER  INVITATION  ORGANIZATION  SESSION
}

enum AuditAction {
  CREATED  UPDATED  DELETED
  STAGE_CHANGED  OWNER_CHANGED  TRANSFERRED  REORDERED
  NURTURED  REACTIVATED
  ARCHIVED  UNARCHIVED  LINKED  UNLINKED
  UPLOADED  DOWNLOADED
  MESSAGE_SENT  MESSAGE_DELETED
  CONNECTED  DISCONNECTED  RESET  SYNCED  WEBHOOK_RECONCILED  TEST_MESSAGE_SENT
  SIGNED_IN  SIGNED_OUT
  MEMBER_ADDED  MEMBER_REMOVED  ROLE_CHANGED  INVITED  INVITE_REVOKED
  EXPORTED  PURGED
}

enum AuditSource { USER  AUTOMATION  WEBHOOK  SYSTEM }
```

`AuditSource` espelha o precedente de `UazapiInstanceLogSource` (`manual|webhook|sync|system`), em
maiúsculas porque é o padrão dos enums de domínio.

### D4 — O ator carrega a origem; nada de AsyncLocalStorage

O projeto já decidiu que **ator é parâmetro explícito** (`actor` é o último argumento das funções de
escrita). Para levar `ip`/`userAgent`/`requestId` até `recordAudit`, a opção mais barata é ampliar o que
`actorOf(request)` já monta:

```ts
export type Actor = {
  id: string;
  name: string;
  email?: string;
  // origem da ação; ausentes em automação, worker e webhook
  ip?: string;
  userAgent?: string;
  requestId?: string;
  source?: AuditSource;
};
```

Um único lugar muda (`src/lib/actor.ts`), e os consumidores que só usam `id`/`name` (`comments`,
`attachments`) continuam iguais. Considerei `AsyncLocalStorage` com hook global: evitaria tocar as
assinaturas das funções que hoje não recebem ator (pipelines, stages, `attachments.confirm`), mas
adiciona contexto implícito que se perde em worker BullMQ e no webhook — exatamente onde a origem
importa mais. Rejeitada.

`AUTOMATION_ACTOR` ganha `source: AUTOMATION`; o webhook usa um `WEBHOOK_ACTOR` novo
(`{ id: "", name: "WhatsApp", source: WEBHOOK }`); o cron usa `SYSTEM_ACTOR`.

### D5 — Escrever é obrigatório: falha de auditoria aborta a operação

`recordAudit` é `await`ado e propaga erro hoje. Mantenho. Auditoria que "pode falhar em silêncio" é
auditoria que não serve para nada em disputa — e o único cenário realista de falha é o banco fora,
quando a operação já ia falhar de todo jeito. O que muda: as duas ações de **alto volume** que passam a
ser auditadas (`MESSAGE_SENT`, `DOWNLOADED`) escrevem depois do efeito e, se a escrita do evento falhar,
o erro sobe — comportamento idêntico ao resto.

### D6 — Ordem de escrita (regra que já vale, agora com dependência nova)

- `CREATED`/`UPDATED`: **depois** da escrita (precisa do id e do estado final).
- `DELETED`: **antes** do delete. Duplo motivo: (a) falha ao gravar o evento não deixa o dado sumir sem
  rastro; (b) `entityLabel`/`snapshot` só podem ser lidos **enquanto a linha existe**. É o que faz o
  requisito "não perder os dados" funcionar.

### D7 — O que **não** é auditado (decisão, não esquecimento)

"Todas as funções" precisa parar onde o log deixaria de ser trilha e viraria um segundo banco de
mensagens. Ficam fora, com motivo:

1. **Ingestão de mensagem recebida** (`ingest.service.processMessageEvent`) — a própria
   `WhatsappMessage` é o registro, e o webhook reentrega (a captura real teve 10 tentativas do mesmo
   evento). Auditar aqui duplicaria a tabela de mensagens em volume.
2. **`markRead`** — um evento por abertura de conversa; ruído puro.
3. **Download de mídia pelo worker** (`processMediaJob`) e `refreshPreview` — efeito de sistema, sem
   decisão humana.
4. **`applyStatusUpdate` / `applyPin` / `applyDeletion`** (ecos de `messages_update`) — são o provedor
   confirmando o que já foi auditado no lado de quem pediu.
5. **Reações** (`react`/`applyReaction`) — alto volume, valor de auditoria nulo; a reação já está na
   thread.
6. **`pin`/`favorite` de mensagem** — marca de organização do dia a dia, não decisão de negócio.
7. **Leituras em geral** (`list`, `getById`, dashboard, agenda) — exceto `DOWNLOADED` de anexo, que é
   saída de documento da imobiliária e por isso entra. A assimetria com o item 8 é deliberada e
   verificada: `attachments-panel.tsx:132` chama `downloadUrl` **no clique**, um evento por download de
   verdade — não uma vez por render do painel, que é o que a tornaria ruído.
8. **`GET /whatsapp/conversations/messages/:id/media`** (renovação de presigned) — é a mesma bolha
   sendo re-exibida, não um acesso novo.

Isso também é o que responde a parte da auditoria em
`docs/2026-08-04-debitos-whatsapp.md` (retenção/LGPD): a trilha cobre as ações de gestão e envio, e a
retenção passa a existir; o débito de retenção **das mensagens em si** continua aberto.

### D8 — Retenção: env global, purga em lotes, cron opcional

- `AUDIT_RETENTION_DAYS` (default **365**, mínimo 30, máximo 3650). Um número só, global. Retenção por
  organização exigiria coluna na org, tela de configuração e um purge por tenant — complexidade sem
  pedido.
- `purgeOlderThan(cutoff, batchSize = 5_000)` é **função pura de I/O**: seleciona ids, apaga em lotes,
  devolve o total. Testável sem Redis, que é como o resto da suíte funciona.
- Lotes porque um `DELETE` de milhões de linhas numa tabela indexada trava escrita concorrente.
- Cron: `queue.upsertJobScheduler("audit-retention", { pattern: "0 20 3 * * *", tz: "America/Sao_Paulo" })`
  — 03:20, fora do horário comercial da imobiliária. **Sem `REDIS_URL` não existe scheduler**
  (`createWorker` devolve `null`), então dev/teste/CI não purgam nada: para esses casos e para produção
  sem fila existe `pnpm audit:purge`, que roda a mesma função.
- A purga registra o que fez: um evento `ORGANIZATION/PURGED` por organização afetada
  (`source: SYSTEM`, `changes: { removed: { from: n, to: 0 } }`). Auto-limitado, porque esses eventos
  também caem na retenção seguinte.

### D9 — `snapshot` e LGPD

`snapshot` guarda cópia de campos de um registro que talvez tenha sido apagado a pedido do titular. É a
mesma armadilha que o `CLAUDE.md` sinaliza para `UAZAPI_DEBUG_LOG`. Regras:

- **Allowlist por entidade**, definida em `src/lib/audit-snapshot.ts` — nunca `{...entity}`.
- **Telefone e e-mail entram mascarados** (`(43) 9****-**77`, `an***@gmail.com`); nome e título entram
  inteiros, porque são o que dá sentido ao evento (é o `entityLabel`).
- **Sem conteúdo de conversa**: `snapshot` de `WHATSAPP_MESSAGE` guarda tipo, direção e horário — nunca
  `text` nem `mediaKey`.
- `AUDIT_RETENTION_DAYS` é o limite temporal desse dado, e é por isso que a Fase 2 não é opcional.

### D10 — Quem pode ler

| Consulta | Quem |
|---|---|
| Histórico de **uma** entidade (`entityId` presente) — feed que já existe | qualquer membro |
| **Busca global** (`/auditoria`, sem `entityId`) | gestor (`owner`/`admin`) |
| Export CSV | gestor, e o export **se audita** (`EXPORTED`) |

O gate não pode ir no arquivo de rota inteiro: `authGuard`+`orgGuard` continuam por arquivo, e a
verificação de gestor fica **no service**, por `isOrgManager` — mesmo padrão de
`lead-automation.service.ts:12` e `whatsapp.service.ts:42`. Rota com gate global quebraria a aba
Histórico do corretor.

### D11 — A rota de leitura muda de forma (breaking)

`GET /v1/audit-events` passa a devolver `{ items, nextCursor }` em vez de array cru, porque a tela nova
precisa de paginação. `lib/queries/audit.ts` no web muda junto, na mesma fase. Não vale manter duas
rotas para a mesma coisa.

### D12 — `UazapiInstanceLog` continua existindo

Não é redundância: ele guarda `payload` bruto da uazapi para diagnóstico e cascateia da instância. A
auditoria central registra a **ação de gestão** (`CONNECTED`, `RESET`, `DELETED`…) e sobrevive à exclusão
da instância. Os dois lados são escritos no mesmo service, um a seguir do outro.

---

## 4. Matriz de cobertura

Contrato do que precisa emitir evento. Coluna "hoje" = o que existe antes deste plano.

### Domínio

| Service / função | `entityType` | `action` | Hoje | Task |
|---|---|---|---|---|
| `clients.create` | CLIENT | CREATED | ✅ | 4 |
| `clients.update` | CLIENT | UPDATED | ✅ | 4 |
| `clients.remove` | CLIENT | DELETED | ✅ | 4 |
| `nurture.nurture` | CLIENT | **NURTURED** | ⚠️ grava `UPDATED` | 4 |
| `nurture.reactivate` | CLIENT | **REACTIVATED** | ⚠️ grava `UPDATED` | 4 |
| `deals.create` | DEAL | CREATED | ✅ | 4 |
| `deals.update` | DEAL | UPDATED / STAGE_CHANGED / OWNER_CHANGED | ✅ | 4 |
| `deals.bulkTransfer` | DEAL | **TRANSFERRED** (1 evento por negócio) | ⚠️ grava `UPDATED` | 4 |
| `deals.remove` | DEAL | DELETED | ✅ | 4 |
| `properties.create/update/remove` | PROPERTY | CREATED/UPDATED/DELETED | ✅ | 4 |
| `activities.create/update/remove` | ACTIVITY | CREATED/UPDATED/DELETED | ✅ | 4 |
| `pipelines.create` | PIPELINE | CREATED | ❌ | 5 |
| `pipelines.update` | PIPELINE | UPDATED | ❌ | 5 |
| `pipelines.remove` | PIPELINE | DELETED | ❌ | 5 |
| `pipelines.addStage` | STAGE | CREATED | ❌ | 5 |
| `pipelines.updateStage` | STAGE | UPDATED | ❌ | 5 |
| `pipelines.removeStage` | STAGE | DELETED | ❌ | 5 |
| `pipelines.reorderStages` | PIPELINE | **REORDERED** | ❌ | 5 |
| `comments.create/update/remove` | COMMENT | CREATED/UPDATED/DELETED | ❌ | 6 |
| `attachments.confirm` | ATTACHMENT | **UPLOADED** | ❌ | 6 |
| `attachments.downloadUrl` | ATTACHMENT | **DOWNLOADED** | ❌ | 6 |
| `attachments.remove` | ATTACHMENT | DELETED | ❌ | 6 |
| `attachments.purgeForEntities` | — | — (é efeito do delete do pai, já auditado) | ❌ | — |
| `lead-automation.update` | LEAD_AUTOMATION | UPDATED | ❌ | 6 |
| `lead-automation.applyToConversation` | CLIENT / DEAL | CREATED (`source: AUTOMATION`) | ⚠️ parcial via `clients.create` | 6 |

### WhatsApp

| Service / função | `entityType` | `action` | Task |
|---|---|---|---|
| `whatsapp.create` | WHATSAPP_INSTANCE | CREATED | 7 |
| `whatsapp.rename` | WHATSAPP_INSTANCE | UPDATED | 7 |
| `whatsapp.remove` | WHATSAPP_INSTANCE | DELETED | 7 |
| `whatsapp.connect` | WHATSAPP_INSTANCE | CONNECTED | 7 |
| `whatsapp.disconnect` | WHATSAPP_INSTANCE | DISCONNECTED | 7 |
| `whatsapp.reset` | WHATSAPP_INSTANCE | RESET | 7 |
| `whatsapp.sync` | WHATSAPP_INSTANCE | SYNCED | 7 |
| `whatsapp.reconcileWebhook` | WHATSAPP_INSTANCE | WEBHOOK_RECONCILED | 7 |
| `whatsapp.testSend` | WHATSAPP_INSTANCE | TEST_MESSAGE_SENT (destino sim, texto **não**) | 7 |
| `conversations.sendText` | WHATSAPP_MESSAGE | MESSAGE_SENT (sem `text` no snapshot) | 8 |
| `message-actions.remove` | WHATSAPP_MESSAGE | MESSAGE_DELETED | 8 |
| `conversations.archive(true/false)` | CONVERSATION | ARCHIVED / UNARCHIVED | 8 |
| `conversations.linkClient` / `createClientFrom` | CONVERSATION | LINKED | 8 |
| `conversations.unlinkClient` | CONVERSATION | UNLINKED | 8 |
| `conversations.remove` | CONVERSATION | DELETED (snapshot com contagem de mensagens) | 8 |

### Identidade e organização

| Origem | `entityType` | `action` | Como | Task |
|---|---|---|---|---|
| login (sessão criada) | SESSION | SIGNED_IN | `databaseHooks.session.create.after` | 9 |
| logout | SESSION | SIGNED_OUT | `databaseHooks.session.delete`/hook de endpoint | 9 |
| org criada | ORGANIZATION | CREATED | `organizationHooks.afterCreateOrganization` | 9 |
| org atualizada | ORGANIZATION | UPDATED | `organizationHooks.afterUpdateOrganization` | 9 |
| membro entrou | MEMBER | MEMBER_ADDED | `organizationHooks.afterAddMember` | 9 |
| membro saiu | MEMBER | MEMBER_REMOVED | `organizationHooks.afterRemoveMember` | 9 |
| papel alterado | MEMBER | ROLE_CHANGED | `organizationHooks.afterUpdateMemberRole` | 9 |
| convite enviado | INVITATION | INVITED | `organizationHooks.afterCreateInvitation` | 9 |
| convite cancelado | INVITATION | INVITE_REVOKED | hook correspondente | 9 |
| org **excluída** | — | — (não se audita: o evento morreria no mesmo cascade; o rastro vai para o log da aplicação) | `beforeDeleteOrganization` | 19 |

### Sistema

| Origem | `entityType` | `action` | Task |
|---|---|---|---|
| purga da retenção | ORGANIZATION | PURGED (`source: SYSTEM`) | 11 |
| export CSV | ORGANIZATION | EXPORTED | 17 |

---

## 5. Global Constraints

- **`actor` é sempre o último parâmetro** das funções de escrita; tipo em `src/lib/actor.ts`. Função que
  hoje não recebe (pipelines, stages, `attachments.confirm`) passa a receber, e a rota passa
  `actorOf(request)`.
- **Nenhuma query sem `organizationId`** — vale para `AuditEvent` como para o resto.
- **Guards por arquivo de rota**: `authGuard` + `orgGuard` no topo. Gate de gestor **no service**, via
  `isOrgManager`.
- **Import do Prisma** sempre relativo (`../../generated/prisma/client.js`); `@prisma/client` é proibido
  por lint.
- **Sem `console.log`** fora de `prisma/` e `scripts/`.
- **`const` arrow functions**; UI em pt-BR, identificadores em inglês; sem emoji em UI (ícones Lucide).
- **Sem migrations**: `pnpm db:push` **e** `pnpm db:push:test` a cada mudança de schema.
- **Erros** pelo envelope `{ error: { code, message, details? } }` via `httpError`/`notFound`/`forbidden`.
- **Ordem de escrita** conforme D6.
- **Verificação por task**: `pnpm lint && pnpm typecheck && pnpm test` na API; `pnpm lint && pnpm typecheck`
  no web. Colar a saída, não afirmar sem ela.
- **Commits em português, imperativo** ("adiciona", "corrige"), arquivos nomeados um a um (`git add` sem
  `-A`/`.`).

---

## FASE 0 — Fundação (schema, helpers, blindagem do enum)

### Task 1: Schema — colunas de snapshot, enums ampliados, índices

**Files:**
- Modify: `eloscrm-api/prisma/schema.prisma` (`model AuditEvent`, `enum AuditEntity`, `enum AuditAction`, novo `enum AuditSource`)
- Test: `eloscrm-api/test/audit-model.test.ts` (existe; estender)

**Interfaces:**
- Consumes: nada.
- Produces: `prisma.auditEvent` com `entityLabel`, `context`, `snapshot`, `organizationName`,
  `actorEmail`, `source`, `ip`, `userAgent`, `requestId`; enums `AuditEntity` (16), `AuditAction` (32),
  `AuditSource` (4) exportados de `src/generated/prisma/client.js`.

- [ ] **Step 1: Ampliar os enums**

Em `prisma/schema.prisma`, substituir `enum AuditEntity` e `enum AuditAction` pelos valores da D3 (um por
linha, ordem da D3) e acrescentar `enum AuditSource { USER AUTOMATION WEBHOOK SYSTEM }`.

- [ ] **Step 2: Ampliar o model**

```prisma
model AuditEvent {
  id               String       @id @default(cuid())
  organizationId   String
  organization     Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  // snapshot: responde "de qual imobiliária era" sem depender da linha da org
  organizationName String?

  entityType  AuditEntity
  entityId    String
  /// Nome que o item tinha no momento do fato. É o que mantém o evento legível depois de o dado ser
  /// apagado — sem isto a tela mostra cuid, porque não há mais o que resolver por id.
  entityLabel String?

  action AuditAction
  source AuditSource @default(USER)

  // snapshot: o histórico mostra o nome que a pessoa tinha na hora e sobrevive a ela sair da org
  actorId    String?
  actorName  String?
  actorEmail String?

  // { campo: { from, to } }, só o que mudou
  changes Json?
  /// A que o item pertencia, desnormalizado (lead, funil, estágio, conversa). Serve para a tela dizer
  /// "no funil Vendas" sem join com uma linha que pode não existir mais.
  context Json?
  /// Estado no momento do fato, por allowlist de campos (src/lib/audit-snapshot.ts). Telefone e e-mail
  /// entram mascarados, e conteúdo de conversa não entra — ver D9 do plano de auditoria.
  snapshot Json?

  ip        String?
  userAgent String?
  /// request.id do Fastify: agrupa os eventos nascidos da mesma chamada (ex.: bulk-transfer)
  requestId String?

  createdAt DateTime @default(now())

  @@index([organizationId, entityType, entityId, createdAt])
  @@index([organizationId, createdAt])
  @@index([organizationId, actorId, createdAt])
  // a purga varre por data sem filtro de org
  @@index([createdAt])
}
```

- [ ] **Step 3: Aplicar e gerar**

```bash
cd eloscrm-api && pnpm db:generate && pnpm db:push && pnpm db:push:test
```
Expected: os três sem erro e **sem** pedir `--accept-data-loss` (tudo aditivo). Se pedir: parar e revisar.

- [ ] **Step 4: Teste do modelo**

Em `test/audit-model.test.ts`, acrescentar um caso que grava um evento com todas as colunas novas e lê de
volta: `entityLabel`, `context`, `snapshot`, `source: "SYSTEM"`, `ip`, `requestId`.

Run: `pnpm vitest run test/audit-model.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add eloscrm-api/prisma/schema.prisma eloscrm-api/test/audit-model.test.ts
git commit -m "feat: auditoria guarda rótulo, contexto e origem do que foi mexido"
```

---

### Task 2: `lib/audit.ts` e `lib/actor.ts` — helper de escrita e ator com origem

**Files:**
- Modify: `eloscrm-api/src/lib/audit.ts`
- Modify: `eloscrm-api/src/lib/actor.ts`
- Create: `eloscrm-api/src/lib/audit-snapshot.ts`
- Test: `eloscrm-api/test/audit-lib.test.ts` (estender)

**Interfaces:**
- Consumes: Task 1.
- Produces: `recordAudit(input)` aceitando `entityLabel`/`context`/`snapshot`/`source`; `actorOf(request)`
  devolvendo `ip`/`userAgent`/`requestId`/`email`; `AUTOMATION_ACTOR`, `WEBHOOK_ACTOR`, `SYSTEM_ACTOR`;
  `snapshotOf(entityType, row)` com allowlist; `maskPhone`/`maskEmail`.

- [ ] **Step 1: Ampliar `Actor`**

```ts
export type Actor = {
  id: string;
  name: string;
  email?: string;
  // origem da ação; ausentes fora do ciclo de request (worker, cron, webhook)
  ip?: string;
  userAgent?: string;
  requestId?: string;
  source?: AuditSource;
};

export const actorOf = (request: FastifyRequest): Actor => ({
  id: request.user!.id,
  name: request.user!.name,
  email: request.user!.email,
  ip: request.ip,
  userAgent: request.headers["user-agent"],
  requestId: request.id,
  source: AuditSource.USER,
});

export const AUTOMATION_ACTOR: Actor = { id: "", name: "Automação", source: AuditSource.AUTOMATION };
export const WEBHOOK_ACTOR: Actor = { id: "", name: "WhatsApp", source: AuditSource.WEBHOOK };
export const SYSTEM_ACTOR: Actor = { id: "", name: "Sistema", source: AuditSource.SYSTEM };
```

> `request.user` vem do `authGuard`; `request.id` é o id de request do Fastify (já existe, não precisa de
> `requestIdHeader`).

- [ ] **Step 2: Allowlist de snapshot**

`src/lib/audit-snapshot.ts`:

```ts
/**
 * O que de cada entidade pode ser copiado para o evento. Nunca espalhar a linha inteira: `snapshot`
 * sobrevive ao delete, então tudo que entra aqui é dado que continua existindo depois de o titular
 * pedir exclusão — ver D9 do plano de auditoria.
 */
const FIELDS: Partial<Record<AuditEntity, readonly string[]>> = {
  CLIENT: ["source", "status", "temperature", "interestType"],
  DEAL: ["value", "stageId", "ownerId", "isOpen"],
  PROPERTY: ["kind", "city", "price"],
  ACTIVITY: ["type", "dueAt", "doneAt"],
  // sem `text`, sem `mediaKey`: conteúdo de conversa não é dado de auditoria
  WHATSAPP_MESSAGE: ["direction", "type", "sentAt"],
  CONVERSATION: ["phoneMasked", "isGroup", "messageCount"],
  ATTACHMENT: ["filename", "contentType", "size"],
};

export const maskPhone = (phone?: string | null) => …;   // (43) 9****-**77
export const maskEmail = (email?: string | null) => …;   // an***@gmail.com
export const snapshotOf = (entityType: AuditEntity, row: Record<string, unknown>) => …;
export const labelOf = (entityType: AuditEntity, row: Record<string, unknown>) => …; // name ?? title ?? …
```

- [ ] **Step 3: Ampliar `recordAudit`**

Campos novos no input, todos opcionais; `source` cai em `input.actor.source ?? USER`; a supressão de
`changes` vazio **continua valendo só quando `changes` foi passado** (senão `ARCHIVED` e afins, que não
têm diff, nunca gravariam).

`organizationName` vem de um `findUnique` em `organization` **sem cache** — renomear a imobiliária é caso
real e auditado (Task 9), e um `Map` por processo entregaria nome velho. Se essa query aparecer em perfil
de latência, a saída é passá-la de quem já carregou a org, não cachear.

- [ ] **Step 4: Testes**

Em `test/audit-lib.test.ts`: `maskPhone`/`maskEmail` (incluindo nulo e formato curto), `snapshotOf`
ignorando campo fora da allowlist, `recordAudit` gravando `source` do ator, e o caso de `changes: {}`
com `action: ARCHIVED` **gravando** o evento.

Run: `pnpm vitest run test/audit-lib.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add eloscrm-api/src/lib/audit.ts eloscrm-api/src/lib/actor.ts eloscrm-api/src/lib/audit-snapshot.ts eloscrm-api/test/audit-lib.test.ts
git commit -m "feat: helper de auditoria grava rótulo, snapshot e origem da ação"
```

---

### Task 3: Blindar os consumidores de `AuditEntity` (anexos, comentários, web)

Sem esta task, o enum ampliado deixa `POST /v1/attachments/upload-url` aceitar
`entityType: "WHATSAPP_INSTANCE"` e o web para de compilar.

**Files:**
- Create: `eloscrm-api/src/modules/attachments/attachable.ts` (ou constante em `audit-snapshot.ts`)
- Modify: `eloscrm-api/src/modules/attachments/attachments.schema.ts`, `attachments.repo.ts:50-56`
- Modify: `eloscrm-api/src/modules/comments/comments.schema.ts`
- Modify: `eloscrm-web/lib/types.ts`, `eloscrm-web/lib/labels.ts`
- Test: `eloscrm-api/test/attachments.test.ts`, `test/comments.test.ts` (estender)

**Interfaces:**
- Consumes: Task 1.
- Produces: `ATTACHABLE_ENTITIES` / `COMMENTABLE_ENTITIES` (`CLIENT|DEAL|PROPERTY|ACTIVITY`);
  `entityExistsInOrg` exaustivo; `AuditEntity`/`AuditAction`/`AuditSource` espelhados no web com todos os
  rótulos.

- [ ] **Step 1: Subconjunto para anexo e comentário**

```ts
export const ATTACHABLE_ENTITIES = [
  AuditEntity.CLIENT, AuditEntity.DEAL, AuditEntity.PROPERTY, AuditEntity.ACTIVITY,
] as const;
```

Nos schemas: `entityType: z.enum(ATTACHABLE_ENTITIES)`. Mesmo para comentários.

- [ ] **Step 2: `entityExistsInOrg` exaustivo**

Trocar o `else` que assume `ACTIVITY` por `switch` com `default: return false` — hoje um tipo novo cairia
em `activity.findFirst` por acidente.

- [ ] **Step 3: Espelhar os enums no web**

`eloscrm-web/lib/types.ts`: ampliar `AuditEntity` e `AuditAction`, acrescentar `AuditSource` e os campos
novos em `AuditEvent` (`entityLabel`, `context`, `snapshot`, `source`, `ip`, `userAgent`, `requestId`,
`organizationName`, `actorEmail`).

- [ ] **Step 4: Rótulos em pt-BR**

`eloscrm-web/lib/labels.ts`:
- `AUDIT_ACTION_LABELS`: verbo na 3ª pessoa para cada uma das 32 ações ("criou", "arquivou",
  "conectou o WhatsApp", "enviou mensagem", "removeu do funil"…).
- `ENTITY_NOUNS`: substantivo **masculino** para os 16 tipos, porque a frase é "deste {noun}"
  (`PIPELINE: "funil"`, `STAGE: "estágio"`, `CONVERSATION: "atendimento"`, `MEMBER: "membro"`,
  `SESSION: "acesso"`, `ORGANIZATION: "cadastro da imobiliária"`…).
- Novos: `AUDIT_ENTITY_LABELS` (rótulo com maiúscula para a coluna "Tipo" da tela) e
  `AUDIT_SOURCE_LABELS` (`USER: "Pessoa"`, `AUTOMATION: "Automação"`, `WEBHOOK: "WhatsApp"`,
  `SYSTEM: "Sistema"`).

- [ ] **Step 5: Verificar os dois lados**

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm vitest run test/attachments.test.ts test/comments.test.ts
cd ../eloscrm-web && pnpm lint && pnpm typecheck
```
Expected: PASS nos dois. O typecheck do web é o que prova que nenhum valor de enum ficou sem rótulo.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/modules/attachments eloscrm-api/src/modules/comments eloscrm-api/test/attachments.test.ts eloscrm-api/test/comments.test.ts eloscrm-web/lib/types.ts eloscrm-web/lib/labels.ts
git commit -m "refactor: restringe anexo e comentário às entidades anexáveis e rotula os tipos novos"
```

---

## FASE 1 — Instrumentação

Padrão de todas as tasks desta fase:

```ts
await recordAudit({
  orgId,
  entityType: AuditEntity.PIPELINE,
  entityId: pipeline.id,
  entityLabel: pipeline.name,          // snapshot: o nome que tinha na hora
  action: AuditAction.CREATED,
  actor,
  context: { stageCount: stages.length },
  snapshot: snapshotOf(AuditEntity.PIPELINE, pipeline),
});
```

### Task 4: Reforçar o que já existe (clients, deals, properties, activities, nurture)

**Files:**
- Modify: `src/modules/clients/clients.service.ts`, `clients/nurture.service.ts`,
  `deals/deals.service.ts`, `properties/properties.service.ts`, `activities/activities.service.ts`
- Test (**editar expectativas existentes, não só acrescentar**): `test/clients-nurture.test.ts:71,272,643`
  (esperam `action: "UPDATED"` na nutrição e passam a esperar `NURTURED`/`REACTIVATED`),
  `test/clients-audit.test.ts:54`, `test/deals.test.ts:253,307` (bulk-transfer — hoje não assere ação
  nenhuma, ganha o assert de `TRANSFERRED`), `test/deals-audit.test.ts`,
  `test/properties-activities-audit.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: todos os eventos existentes com `entityLabel`/`snapshot`/`context`; `NURTURED`,
  `REACTIVATED` e `TRANSFERRED` no lugar de `UPDATED` genérico.

- [ ] **Step 1: `entityLabel` em todos os `recordAudit` atuais** — `client.name`, `deal.title`,
      `property.title`, `activity.description` (truncada em 120 caracteres).
- [ ] **Step 2: `context` onde há pai** — `DEAL` leva `{ clientName, pipelineName, stageName }`;
      `ACTIVITY` leva `{ clientName, dealTitle }`.
- [ ] **Step 3: Ações específicas** — `nurture.nurture` → `NURTURED`, `nurture.reactivate` →
      `REACTIVATED`, `deals.bulkTransfer` → `TRANSFERRED` (um evento por negócio, todos com o mesmo
      `requestId`, o que é o que permite a tela agrupar). **Trocar a ação quebra assert existente**: antes
      de escrever, `grep -n '"UPDATED"' test/clients-nurture.test.ts` e ajustar os três casos — o teste
      falhando aqui é a mudança pretendida, não regressão.
- [ ] **Step 4: `DELETED` lê o rótulo antes do delete** — em `clients.remove`, `deals.remove`,
      `properties.remove`, `activities.remove`, montar `entityLabel`/`snapshot` a partir do
      `getById` que já roda no começo da função. Nada de ler depois.
- [ ] **Step 5: Teste do requisito central** — em `test/clients-audit.test.ts`:

```ts
it("o evento de exclusão sobrevive ao lead e continua legível", async () => {
  // cria, apaga, e então confere que o evento traz nome e tipo sem depender da linha do cliente
  expect(await prisma.client.findUnique({ where: { id } })).toBeNull();
  const evento = await prisma.auditEvent.findFirstOrThrow({
    where: { entityType: "CLIENT", entityId: id, action: "DELETED" },
  });
  expect(evento.entityLabel).toBe("Cliente Que Foi Apagado");
  expect(evento.actorName).toBeTruthy();
});
```

- [ ] **Step 6: Verificar** — `pnpm vitest run test/clients-audit.test.ts test/deals-audit.test.ts test/properties-activities-audit.test.ts test/clients-nurture.test.ts`
- [ ] **Step 7: Commit** — `git commit -m "feat: eventos de auditoria do domínio guardam rótulo e contexto"`

---

### Task 5: `pipelines` e `stages`

**Files:**
- Modify: `src/modules/pipelines/pipelines.service.ts`, `src/routes/v1/pipelines/index.ts`,
  `src/routes/v1/stages/index.ts`
- Test: `test/pipelines.test.ts` (estender)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: 7 funções com `actor` como último parâmetro e evento correspondente (matriz §4).

- [ ] **Step 1: `actor` nas assinaturas** — `create`, `update`, `remove`, `addStage`, `updateStage`,
      `removeStage`, `reorderStages`. `ensureDefaultPipeline` **não** recebe: roda no sign-up, e o evento
      dela é a criação da organização (Task 9).
- [ ] **Step 2: `actorOf(request)` nas duas rotas.**
- [ ] **Step 3: Eventos** — `STAGE` leva `context: { pipelineName }`; `reorderStages` grava
      `changes: { order: { from: [...nomes], to: [...nomes] } }` (nomes, não ids — o evento tem que ser
      legível depois de o estágio ser apagado).
- [ ] **Step 4: `removeStage`/`remove` leem rótulo antes do delete.**
- [ ] **Step 5: Testes** — um por ação, mais o de isolamento por org.
- [ ] **Step 6: Commit** — `git commit -m "feat: audita criação, alteração e remoção de funis e estágios"`

---

### Task 6: `comments`, `attachments`, `lead-automation`

**Files:**
- Modify: `src/modules/comments/comments.service.ts`,
  `src/modules/attachments/attachments.service.ts`, `src/routes/v1/attachments/index.ts`,
  `src/modules/lead-automation/lead-automation.service.ts`,
  `src/modules/lead-automation/apply.service.ts`
- Test: `test/comments.test.ts`, `test/attachments.test.ts`, `test/lead-automation.test.ts`,
  `test/lead-automation-ingest.test.ts` (estender)

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: eventos de comentário (CRUD), anexo (`UPLOADED`/`DOWNLOADED`/`DELETED`) e automação
  (`UPDATED` da configuração + `CREATED` com `source: AUTOMATION` no lead/negócio criado por ela).

- [ ] **Step 1: comentários** — `entityLabel` é o alvo (`"lead Ana Paula"`), `context` guarda
      `{ targetType, targetLabel }`; o corpo do comentário **não** entra no snapshot (é texto livre de
      pessoas, e o comentário em si já é o registro).
- [ ] **Step 2: anexos** — `confirm` → `UPLOADED` com `snapshot: { filename, contentType, size }`;
      `downloadUrl` → `DOWNLOADED`; `remove` → `DELETED` (rótulo antes de apagar). `confirm` passa a
      receber `actor` e a rota passa `actorOf(request)`.
- [ ] **Step 3: automação** — `lead-automation.update` grava `changes` da configuração;
      `apply.service.applyToConversation` passa `AUTOMATION_ACTOR` (que já usa) e o evento sai com
      `source: AUTOMATION`.
- [ ] **Step 4: Testes** — incluindo um que confirma `source: "AUTOMATION"` no lead criado pela
      automação (é o que a tela usa para separar "ninguém clicou").
- [ ] **Step 5: Commit** — `git commit -m "feat: audita comentários, anexos e automação de leads"`

---

### Task 7: Instância de WhatsApp

**Files:**
- Modify: `src/modules/whatsapp/whatsapp.service.ts`
- Test: `test/whatsapp.test.ts` (estender)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: 9 ações da matriz §4, cada uma ao lado do `UazapiInstanceLog` que já é gravado (D12).

> **Sem mudança de assinatura nesta task.** Verificado: `create`, `rename`, `remove`, `connect`,
> `disconnect`, `reset`, `sync`, `reconcileWebhook` e `testSend` **já** recebem `actor` (todas começam com
> `requireManager(orgId, actor)`), e as rotas já passam `actorOf(request)`. É só acrescentar o
> `recordAudit`.

- [ ] **Step 1:** um `recordAudit` por função de gestão, `entityLabel = instance.name`,
      `context: { ownerJid: maskPhone(instance.ownerJid) }`.
- [ ] **Step 2: `testSend`** grava o destino mascarado e o id da mensagem, **nunca o texto** — mesma
      regra que o `UazapiInstanceLog` já segue.
- [ ] **Step 3: `remove`** lê o rótulo antes do delete; o evento sobrevive à instância (que leva o
      `UazapiInstanceLog` em cascade).
- [ ] **Step 4: Testes** — as 9 ações, e um caso que apaga a instância e confere que os eventos
      continuam lá.
- [ ] **Step 5: Commit** — `git commit -m "feat: audita a gestão da conexão de WhatsApp"`

---

### Task 8: Conversas e mensagens

**Files:**
- Modify: `src/modules/whatsapp/conversations.service.ts`,
  `src/modules/whatsapp/message-actions.service.ts`,
  `src/routes/v1/whatsapp/conversations/index.ts`
- Test: `test/whatsapp-conversations.test.ts`, `test/whatsapp-message-actions.test.ts` (estender)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `MESSAGE_SENT`, `MESSAGE_DELETED`, `ARCHIVED`/`UNARCHIVED`, `LINKED`/`UNLINKED`, `DELETED`
  de conversa. **Nada** do que está na lista de exclusão (D7).

- [ ] **Step 1: `actor` nas assinaturas** — diferente da Task 7, **nenhuma** destas recebe ator hoje:
      `conversations.archive(orgId, id, archived)`, `conversations.linkClient(orgId, id, clientId)`,
      `conversations.unlinkClient(orgId, id)`, `conversations.remove(orgId, id)` e
      `message-actions.remove(orgId, conversationId, messageId)`. Acrescentar `actor` como último
      parâmetro e passar `actorOf(request)` nas seis rotas correspondentes de
      `routes/v1/whatsapp/conversations/index.ts`: `POST /:id/archive`, `POST /:id/unarchive`,
      `POST /:id/link-client`, `POST /:id/unlink-client`, `DELETE /:id` e
      `DELETE /:id/messages/:messageId`. `sendText` e `createClientFrom` já recebem.
      Verificado: **o único chamador de cada uma é a própria rota** (`grep -rn "actions.remove|service.archive" src/`
      só acha `routes/v1/whatsapp/conversations/index.ts`) — nenhum caminho de webhook, worker ou
      automação chama essas funções, então não há call site precisando de `WEBHOOK_ACTOR`/
      `AUTOMATION_ACTOR`. O eco de deleção do provedor passa por `status.service.applyDeletion`, que está
      na lista de exclusão da D7.
- [ ] **Step 2: rótulo da conversa** — `entityLabel` = `client?.name ?? contactName ?? waName ??
      maskPhone(phone)`; a mesma precedência que o header da tela usa, para o log falar a língua do
      corretor.
- [ ] **Step 3: `sendText`** grava `MESSAGE_SENT` depois do envio confirmado, com
      `snapshot: { direction, type, sentAt }` e **sem** `text` (D9). Falha de envio não gera evento — o
      que houve foi tentativa, e a bolha `failed` já registra.
- [ ] **Step 4: `remove` da conversa** grava `DELETED` **antes** do delete, com
      `snapshot: { messageCount, mediaCount, firstMessageAt, lastMessageAt }` — é o que resta como prova
      de que existiu um atendimento, e o motivo pelo qual a contagem é lida antes.
- [ ] **Step 5: vínculo de lead** — `LINKED` guarda `context: { clientName }`; `UNLINKED` guarda o nome
      de quem foi desvinculado (senão o evento não diz de quem se soltou).
- [ ] **Step 6: confirmar as exclusões** — teste que faz `markRead` + ingestão de mensagem recebida e
      assere **zero** eventos novos. É o guarda contra alguém "completar a cobertura" depois e inundar a
      tabela.
- [ ] **Step 7: Commit** — `git commit -m "feat: audita atendimento, envio e exclusão em conversas"`

---

### Task 9: Identidade — sessão, organização, membros e convites

**Files:**
- Modify: `eloscrm-api/src/lib/auth.ts` (`databaseHooks`, `organizationHooks`)
- Create: `eloscrm-api/src/modules/audit/identity.audit.ts` (adaptador entre os hooks e `recordAudit`)
- Test: `eloscrm-api/test/audit-identity.test.ts` (novo)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `SESSION/SIGNED_IN`, `SESSION/SIGNED_OUT`, `ORGANIZATION/CREATED|UPDATED`,
  `MEMBER/MEMBER_ADDED|MEMBER_REMOVED|ROLE_CHANGED`, `INVITATION/INVITED|INVITE_REVOKED`.

**Contexto verificado:** o Better Auth 1.6 expõe `organizationHooks` no plugin `organization` com
`afterCreateOrganization`, `afterUpdateOrganization`, `afterAddMember`, `afterRemoveMember`,
`afterUpdateMemberRole`, `afterCreateInvitation` (a doc oficial lista todos), e `databaseHooks.session`
já é usado neste projeto (`auth.ts:126-138`, que resolve a org ativa no `create.before`).

- [ ] **Step 1: adaptador** — `identity.audit.ts` recebe os objetos do hook e monta o `recordAudit`, com
      ator = o próprio usuário do hook (`{ id, name, email }`, `source: USER`). Hook não tem `request`,
      então `ip`/`userAgent` ficam nulos — registrar isso como limitação no comentário.
- [ ] **Step 2: login/logout** — `databaseHooks.session.create.after` → `SIGNED_IN` na org ativa
      resolvida no `before`. **Sem org ativa não há evento** (`organizationId` é obrigatório): usuário
      sem organização nenhuma não gera linha, e isso é aceitável — não há tenant a que atribuir.
- [ ] **Step 3: organização e membros** — os cinco hooks da matriz §4, com `entityLabel` = nome da org /
      nome do membro e `context: { role }` / `{ from: papelAntigo, to: papelNovo }`.
- [ ] **Step 4: hook não pode derrubar o login** — `afterX` que lança quebra a autenticação (a doc
      documenta `unable_to_create_user` como efeito de erro em hook). **Exceção deliberada à D5**: neste
      arquivo o `recordAudit` vai dentro de `try/catch` com `request.log.error`, porque o custo de perder
      um evento de login é menor que o de trancar a porta. Comentar o porquê no código.
- [ ] **Step 5: Testes** — `signUpWithOrg` gera `ORGANIZATION/CREATED` + `MEMBER/MEMBER_ADDED`;
      `signIn` gera `SIGNED_IN`; e um caso que confirma que uma falha simulada de auditoria **não**
      impede o login.
- [ ] **Step 6: Commit** — `git commit -m "feat: audita acesso, organização, membros e convites"`

---

### Task 10: Matriz de cobertura viva (guarda de regressão)

**Files:**
- Create: `eloscrm-api/test/audit-coverage.test.ts`

**Interfaces:**
- Consumes: Tasks 4-9.
- Produces: teste que percorre a matriz da §4 exercitando cada rota mutante e assere que **algum** evento
  nasceu com o par `(entityType, action)` esperado.

- [ ] **Step 1:** tabela em código espelhando a §4 — `{ label, run: async () => …, expect: { entityType, action } }`.
- [ ] **Step 2:** `it.each` sobre a tabela; cada caso conta os eventos antes e depois. **Um único
      `beforeAll` com um `signUpWithOrg`** compartilhado por todos os casos: o bcrypt do sign-up custa
      segundos e um por caso estoura o `testTimeout` de 15s do `vitest.config.ts`.
- [ ] **Step 3:** lista de exclusão da D7 no mesmo arquivo, como casos que esperam **zero** eventos.
- [ ] **Step 4:** Rodar a suíte inteira (`pnpm test`) — este arquivo é o mais lento; se passar de ~30s,
      quebrar em dois por domínio.
- [ ] **Step 5: Commit** — `git commit -m "test: matriz de cobertura da auditoria"`

> **Deliberadamente não é um scanner de código-fonte.** Grep por `recordAudit` em `*.service.ts` passa com
> chamada em ramo morto e falha com indireção por helper — o que vale é o evento chegando no banco.

---

## FASE 2 — Retenção e cron

### Task 11: Purga por retenção (função pura + script CLI)

**Files:**
- Modify: `eloscrm-api/src/env.ts`, `.env.example`, `.env.test.example`, `.github/workflows/ci.yml`
- Create: `eloscrm-api/src/modules/audit/retention.service.ts`
- Create: `eloscrm-api/scripts/purge-audit.ts`
- Modify: `eloscrm-api/package.json` (script `audit:purge`)
- Test: `eloscrm-api/test/audit-retention.test.ts` (novo)

**Interfaces:**
- Consumes: Task 1.
- Produces: `AUDIT_RETENTION_DAYS`; `purgeOlderThan(cutoff, batchSize?) → { removed, byOrg }`;
  `runRetention() → total`; `pnpm audit:purge [--days N] [--dry-run]`.

- [ ] **Step 1: env**

```ts
// Quanto tempo o log de auditoria fica. A tabela cresce a cada ação e nada mais a poda: sem isto ela
// só aumenta. 365 dias cobre o ciclo de uma negociação imobiliária com folga.
AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
```

Acrescentar em `.env.example` e `.env.test.example` (no de teste, `AUDIT_RETENTION_DAYS=365`; o teste
passa o cutoff explicitamente e não depende do valor).

- [ ] **Step 2: purga em lotes**

```ts
/**
 * Apaga eventos anteriores ao corte, em lotes.
 *
 * Em lotes porque um DELETE de milhões de linhas numa tabela com quatro índices segura escrita
 * concorrente pelo tempo da transação — e a auditoria é escrita em todo request. O retorno por
 * organização é o que alimenta o evento PURGED (a purga também se audita).
 */
export const purgeOlderThan = async (cutoff: Date, batchSize = 5_000) => {
  const byOrg = new Map<string, number>();
  let removed = 0;
  for (;;) {
    const lote = await prisma.auditEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, organizationId: true },
      take: batchSize,
    });
    if (lote.length === 0) break;
    await prisma.auditEvent.deleteMany({ where: { id: { in: lote.map((e) => e.id) } } });
    for (const e of lote) byOrg.set(e.organizationId, (byOrg.get(e.organizationId) ?? 0) + 1);
    removed += lote.length;
    if (lote.length < batchSize) break;
  }
  return { removed, byOrg };
};
```

- [ ] **Step 3: `runRetention`** — calcula `cutoff = agora - AUDIT_RETENTION_DAYS`, chama
      `purgeOlderThan`, e para cada org afetada grava `ORGANIZATION/PURGED` com `SYSTEM_ACTOR` e
      `changes: { removed: { from: n, to: 0 } }`. Devolve o total.
- [ ] **Step 4: script CLI** — `scripts/purge-audit.ts` com `--days` (sobrepõe a env), `--dry-run`
      (conta sem apagar) e `console.log` do resultado (permitido em `scripts/` pelo oxlint).
- [ ] **Step 5: Testes** (sem Redis, como o resto da suíte):
  - insere 3 eventos antigos e 2 recentes → `purgeOlderThan` remove 3 e devolve `byOrg` correto;
  - `batchSize: 2` com 5 antigos → remove todos (prova o laço);
  - `runRetention` grava um `PURGED` por org;
  - evento de outra org não interfere na contagem.
- [ ] **Step 6: Verificar** — `pnpm vitest run test/audit-retention.test.ts`
- [ ] **Step 7: Commit**

```bash
git add eloscrm-api/src/env.ts eloscrm-api/src/modules/audit/retention.service.ts eloscrm-api/scripts/purge-audit.ts eloscrm-api/package.json eloscrm-api/.env.example eloscrm-api/.env.test.example eloscrm-api/test/audit-retention.test.ts .github/workflows/ci.yml
git commit -m "feat: purga de auditoria por retenção, em lotes"
```

---

### Task 12: Agendamento diário (BullMQ)

**Files:**
- Modify: `eloscrm-api/src/lib/queue.ts`
- Modify: `eloscrm-api/src/modules/audit/retention.service.ts` (worker + scheduler)
- Modify: `eloscrm-api/src/server.ts`
- Test: `eloscrm-api/test/audit-retention.test.ts` (estender)

**Interfaces:**
- Consumes: Task 11.
- Produces: `scheduleCron(name, id, pattern, tz)` em `lib/queue.ts`; fila `audit-retention` com job diário
  às 03:20 (America/Sao_Paulo); no-op sem `REDIS_URL`.

- [ ] **Step 1: `scheduleCron` em `lib/queue.ts`**

```ts
/**
 * Agenda um job recorrente. Sem REDIS_URL devolve null e nada é agendado — dev, teste e CI não ganham
 * pré-requisito de infra, e a purga fica por conta de `pnpm audit:purge`. `upsertJobScheduler` é
 * idempotente: subir duas instâncias da API não cria dois agendamentos.
 */
export const scheduleCron = async (name: string, id: string, pattern: string, tz?: string) => {
  const queue = getQueue(name);
  if (!queue) return null;
  return queue.upsertJobScheduler(id, { pattern, ...(tz ? { tz } : {}) }, { name: id, data: {} });
};
```

- [ ] **Step 2: worker + agendamento** em `retention.service.ts`:

```ts
export const AUDIT_RETENTION_QUEUE = "audit-retention";
createWorker(AUDIT_RETENTION_QUEUE, async () => { await runRetention(); }, 1);
export const scheduleAuditRetention = () =>
  scheduleCron(AUDIT_RETENTION_QUEUE, "daily", "0 20 3 * * *", "America/Sao_Paulo");
```

- [ ] **Step 3: chamar no boot** — em `src/server.ts` (**não** em `app.ts`): os testes usam `buildApp()`
      e não devem falar com Redis nem agendar nada.

```ts
const start = async () => {
  const app = await buildApp();
  await scheduleAuditRetention();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
};
```

- [ ] **Step 4: Teste** — `queueEnabled()` é `false` no ambiente de teste, então o caso a cobrir é
      `scheduleAuditRetention()` resolvendo `null` sem lançar. O processamento em si já é coberto pelos
      testes de `runRetention`.
- [ ] **Step 5: Verificar** — `pnpm test` (suíte inteira, para garantir que nada passou a exigir Redis).
- [ ] **Step 6: Commit** — `git commit -m "feat: agenda a purga de auditoria uma vez por dia"`

> **Operação:** em produção sem `REDIS_URL` a purga **não roda**. Nesse cenário, agendar
> `pnpm -C eloscrm-api audit:purge` no cron do host — está na §9.

---

## FASE 3 — API de consulta

### Task 13: Busca paginada, filtros e autorização

**Files:**
- Modify: `eloscrm-api/src/modules/audit/audit.schema.ts`, `audit.repo.ts`, `audit.service.ts`
- Modify: `eloscrm-api/src/routes/v1/audit-events/index.ts`
- Test: `eloscrm-api/test/audit-search.test.ts` (novo), `test/audit-events.test.ts` (ajustar ao envelope)

**Interfaces:**
- Consumes: Fases 0-1.
- Produces: `GET /v1/audit-events` com `{ items, nextCursor }`; filtros `entityType[]`, `entityId`,
  `action[]`, `actorId`, `source`, `q`, `from`, `to`, `cursor`, `limit`; gate de gestor quando não há
  `entityId`.

- [ ] **Step 1: schema de filtros**

```ts
export const listAuditQuerySchema = z.object({
  // repetível na query string (?entityType=CLIENT&entityType=DEAL) — a tela filtra por vários
  entityType: z.union([z.enum(AuditEntity), z.array(z.enum(AuditEntity))]).optional(),
  entityId: z.string().min(1).optional(),
  action: z.union([z.enum(AuditAction), z.array(z.enum(AuditAction))]).optional(),
  actorId: z.string().min(1).optional(),
  source: z.enum(AuditSource).optional(),
  // agrupa os eventos nascidos da mesma chamada (bulk-transfer); é o que o detalhe usa em "ver as N
  // ações desta mesma operação" (Task 16, Step 5)
  requestId: z.string().min(1).optional(),
  // casa em entityLabel, actorName e entityId — é o que o gestor tem na mão
  q: z.string().trim().min(1).max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
```

- [ ] **Step 2: repo com cursor** — `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`, `take: limit`,
      `skip: 1` + `cursor: { id }` quando houver, `nextCursor` só quando o lote encheu. Mesmo padrão de
      `conversations.list`.
- [ ] **Step 3: autorização no service** (D10)

```ts
export const list = async (orgId: string, filters: ListAuditQuery, actor: Actor) => {
  // busca global expõe a ação de todos os corretores; o histórico de UMA entidade é do dia a dia
  if (!filters.entityId && !(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só gestores podem consultar a auditoria da imobiliária");
  }
  return repo.listEvents(orgId, filters);
};
```

- [ ] **Step 4: rota de atores** — `GET /v1/audit-events/actors` (gestor) com
      `groupBy(["actorId", "actorName"])` para alimentar o filtro; **antes** de qualquer rota curinga, pelo
      mesmo motivo do `/counts` em conversas.
- [ ] **Step 5: Testes**
  - 401 sem sessão; 403 para `member` na busca global; 200 para `member` com `entityId`;
  - filtro por período, por ação, por tipo múltiplo, por ator, e `q` casando `entityLabel`;
  - paginação: 3 páginas de 2 em 6 eventos, sem repetir nem pular;
  - isolamento: evento de outra org nunca aparece.
- [ ] **Step 6: Ajustar todos os consumidores da rota** ao envelope `{ items }` (breaking, D11). Não é só
      `test/audit-events.test.ts`: `test/deals.test.ts:207,279` também consulta
      `GET /v1/audit-events?entityType=DEAL&entityId=…` e lê o array direto. Conferir com
      `grep -rn "audit-events" test/` antes de rodar a suíte.
- [ ] **Step 7: Verificar** — `pnpm lint && pnpm typecheck && pnpm test`
- [ ] **Step 8: Commit** — `git commit -m "feat: busca de auditoria com filtros, cursor e gate de gestor"`

---

## FASE 4 — Tela `/auditoria`

### Task 14: Camada de dados no web

**Files:**
- Modify: `eloscrm-web/lib/queries/audit.ts`
- Create: `eloscrm-web/app/(app)/auditoria/use-audit-filters.ts`
- Modify: `eloscrm-web/lib/types.ts` (`AuditSearchResult`)

**Interfaces:**
- Consumes: Task 13.
- Produces: `useAuditSearch(filters)` (`useInfiniteQuery`), `useAuditActors()`, `useAuditEvents` ajustado
  ao envelope; filtros na URL via `nuqs` (padrão já usado em `conversas`).

- [ ] **Step 1: `useAuditEvents`** passa a ler `data.items` — o `AuditFeed` continua funcionando igual.
- [ ] **Step 2: `useAuditSearch`** — `useInfiniteQuery` com `getNextPageParam: (last) => last.nextCursor`,
      `queryKey` com `org?.id` **e** os filtros, `enabled: !!org?.id`.
- [ ] **Step 3: `use-audit-filters.ts`** — estado dos filtros em `useQueryStates` do nuqs (período,
      tipos, ações, ator, origem, busca com debounce de 300ms). URL compartilhável é o que faz um gestor
      mandar "olha esse filtro" para outro.
- [ ] **Step 4: Verificar** — `pnpm typecheck` no web.
- [ ] **Step 5: Commit** — `git commit -m "feat: hooks de busca da auditoria no web"`

---

### Task 15: Página, filtros e lista

**Files:**
- Create: `eloscrm-web/app/(app)/auditoria/page.tsx`
- Create: `eloscrm-web/app/(app)/auditoria/audit-filters.tsx`
- Create: `eloscrm-web/app/(app)/auditoria/audit-list.tsx`
- Create: `eloscrm-web/app/(app)/auditoria/audit-row.tsx`
- Modify: `eloscrm-web/components/app/app-sidebar.tsx`

**Interfaces:**
- Consumes: Task 14.
- Produces: `/auditoria` funcional com filtros, rolagem infinita e item de menu visível só para gestor.

- [ ] **Step 1: gate de gestor no cliente** — `useMembers()` + `useSession()` para achar o papel, como
      `comment-feed.tsx:25` já faz. Não sendo gestor: `Empty` com "Acesso restrito — só gestores
      consultam a auditoria". O gate real é a API (Task 13); este é cortesia de UI.
- [ ] **Step 2: item na sidebar** — `{ title: "Auditoria", href: "/auditoria", icon: ScrollText }`,
      renderizado condicionalmente ao papel. Ícone Lucide, nunca emoji.
- [ ] **Step 3: filtros** (`audit-filters.tsx`) — presets de período (Hoje / 7 / 30 / 90 dias /
      Personalizado), multi-select de tipo e de ação (`Popover` + `Command`), select de ator (atores da
      API + "Automação"/"Sistema"), busca. Em tela estreita, os filtros viram um `Sheet` — a tabela
      compete por largura.
- [ ] **Step 4: lista** — tabela no desktop (Quando / Quem / Ação / Item / Resumo) e cards no mobile.
      Linha inteira clicável abre o detalhe. Botão "Carregar mais" + `IntersectionObserver`.
- [ ] **Step 5: frase do evento** — `audit-row.tsx` monta
      `"{actorName} {AUDIT_ACTION_LABELS[action]} o {ENTITY_NOUNS[entityType]} {entityLabel}"`, com
      fallback `entityId` truncado quando `entityLabel` é nulo (eventos anteriores ao backfill).
      **Não** usa `useEntityNames`: a tela precisa funcionar para item apagado, que é o ponto.
- [ ] **Step 6: estados** — skeleton no primeiro carregamento; `Empty` "Nenhuma ação no período" quando o
      filtro não acha nada; erro com botão de tentar de novo.
- [ ] **Step 7: QA visual** — `pnpm dev` nos dois projetos e screenshot em mobile/desktop
      (plugin `visual-qa`), conferindo erros de console.
- [ ] **Step 8: Commit** — `git commit -m "feat: tela de auditoria da imobiliária"`

---

### Task 16: Detalhe do evento

**Files:**
- Create: `eloscrm-web/app/(app)/auditoria/audit-detail-sheet.tsx`
- Modify: `eloscrm-web/app/(app)/auditoria/audit-list.tsx`

**Interfaces:**
- Consumes: Task 15.
- Produces: `Sheet` lateral com diff completo, contexto, snapshot, origem técnica e atalho para o item.

- [ ] **Step 1: diff** — tabela `Campo | Antes | Depois` usando `FIELD_LABELS` e `formatAuditValue`
      (que já traduz enum, moeda e data).
- [ ] **Step 2: contexto e snapshot** — lista de pares chave/valor com rótulos; chave desconhecida
      aparece como está (o log é de eventos antigos também, e engolir campo é pior que mostrar cru).
- [ ] **Step 3: origem** — `AUDIT_SOURCE_LABELS[source]`, `actorEmail`, IP, navegador (parse simples do
      user agent) e `requestId` com botão de copiar.
- [ ] **Step 4: "abrir item"** — link para `/clients/:id`, `/deals`, `/properties/:id` conforme o tipo,
      **só** quando o item ainda existe. Item apagado mostra "Este registro foi excluído" — é o cenário
      que o pedido pede para não perder.
- [ ] **Step 5: eventos irmãos** — quando há `requestId`, botão "ver as N ações desta mesma operação"
      (filtra por `requestId`; exige aceitar `requestId` no schema da Task 13 — incluir lá).
- [ ] **Step 6: Verificar** — `pnpm lint && pnpm typecheck` no web + screenshot do sheet.
- [ ] **Step 7: Commit** — `git commit -m "feat: detalhe do evento de auditoria com diff e origem"`

---

## FASE 5 — Fechamento

### Task 17: Export CSV (e auditar o export)

**Files:**
- Modify: `eloscrm-api/src/modules/audit/audit.service.ts`, `audit.repo.ts`,
  `src/routes/v1/audit-events/index.ts`
- Modify: `eloscrm-web/app/(app)/auditoria/audit-filters.tsx`
- Test: `eloscrm-api/test/audit-search.test.ts` (estender)

**Interfaces:**
- Consumes: Tasks 13-15.
- Produces: `GET /v1/audit-events/export` (gestor) devolvendo `text/csv` com os mesmos filtros;
  evento `ORGANIZATION/EXPORTED` com `context: { filters, rows }`.

- [ ] **Step 1: rota** com `reply.header("content-disposition", 'attachment; filename="auditoria.csv"')`,
      teto de **50.000 linhas** (acima disso, 409 pedindo filtro mais estreito — sem paginar CSV).
- [ ] **Step 2: colunas** — data ISO, ator, e-mail, origem, tipo, item, id, ação, resumo do diff. Escape
      de `;` e `"` conferido em teste com valor que contém ambos.
- [ ] **Step 3: auditar o export** — quem exporta a trilha da equipe entra na trilha.
- [ ] **Step 4: botão no web** — download direto via `window.open` da URL com os filtros atuais.
- [ ] **Step 5: Commit** — `git commit -m "feat: exporta a auditoria filtrada em CSV"`

---

### Task 18: Backfill de `entityLabel` nos eventos antigos

**Files:**
- Create: `eloscrm-api/scripts/backfill-audit-labels.ts`
- Modify: `eloscrm-api/package.json`

**Interfaces:**
- Consumes: Fase 0.
- Produces: `pnpm audit:backfill-labels` preenchendo `entityLabel` onde a entidade **ainda existe**.

- [ ] **Step 1:** varrer eventos com `entityLabel: null`, agrupar por `entityType`, resolver nome em lote
      (`client.findMany({ where: { id: { in } } })`) e atualizar.
- [ ] **Step 2:** o que não resolve fica nulo — a entidade já foi apagada e o nome não existe em lugar
      nenhum. A tela cai no `entityId` truncado (Task 15, Step 5). Registrar o total não resolvido no
      output.
- [ ] **Step 3:** `--dry-run` e log de contagem por tipo.
- [ ] **Step 4: Commit** — `git commit -m "chore: backfill de rótulo nos eventos de auditoria antigos"`

---

### Task 19: Excluir a imobiliária apaga tudo que é dela

Decisão do dono do produto (D2): excluir a organização leva arquivos, mensagens, conversas e auditoria.
O cascade do Postgres já cobre as **13 tabelas** de domínio (`Organization` tem 13 relações com
`onDelete: Cascade`, incluindo `auditEvents`, `attachments`, `conversations` e `whatsappMessages`) — esta
task fecha o que ele não alcança: objetos no R2 e a instância remota na uazapi.

**Files:**
- Create: `eloscrm-api/src/modules/audit/organization-purge.service.ts`
- Modify: `eloscrm-api/src/lib/auth.ts` (`organizationHooks.beforeDeleteOrganization`)
- Modify: `eloscrm-api/src/modules/whatsapp/whatsapp.service.ts` (extrair a exclusão remota)
- Test: `eloscrm-api/test/organization-purge.test.ts` (novo)

**Interfaces:**
- Consumes: Tasks 1-2 (`SYSTEM_ACTOR`), `deleteFiles`/`R2_PRIVATE_BUCKET` de `src/lib/storage.js`.
- Produces: `purgeOrganizationAssets(orgId)` — apaga os objetos do R2 e a instância remota **antes** de o
  Better Auth apagar a org; hook registrado.

**Contexto verificado:** o plugin `organization` expõe `beforeDeleteOrganization(data, ctx)` e
`afterDeleteOrganization` (doc oficial), e hoje o projeto **não** configura nenhum dos dois nem
`disableOrganizationDeletion` — ou seja, o endpoint de exclusão está aberto para o `owner` por default,
e o web ainda não tem tela para ele (`grep -rn "organization.delete" eloscrm-web` → nada). A purga
precisa existir **antes** de essa tela existir.

- [ ] **Step 1: Extrair a exclusão remota da instância**

`whatsapp.service.remove` faz duas coisas: valida gestor e apaga na uazapi + no banco. Extrair o miolo
para `deleteRemoteInstance(instance)` (sem `requireManager` — quem exclui a org é `owner` por definição
do Better Auth) e chamar dos dois lugares. `isInstanceGone` continua sendo tratado como sucesso.

- [ ] **Step 2: `purgeOrganizationAssets(orgId)`**

```ts
/**
 * O que o cascade do Postgres não alcança quando a imobiliária é excluída.
 *
 * Ordem: primeiro o que é externo (R2 e uazapi), depois o Better Auth apaga a org e o banco cascateia.
 * Invertido, as chaves dos objetos e o token da instância já teriam sumido — e o arquivo continuaria
 * pago no bucket, com a instância ainda conectada ao WhatsApp do cliente.
 */
export const purgeOrganizationAssets = async (orgId: string) => {
  const [anexos, midias] = await Promise.all([
    prisma.attachment.findMany({ where: { organizationId: orgId }, select: { key: true } }),
    prisma.whatsappMessage.findMany({
      where: { organizationId: orgId, mediaKey: { not: null } },
      select: { mediaKey: true },
    }),
  ]);
  const keys = [
    ...anexos.map((a) => a.key),
    ...midias.flatMap((m) => (m.mediaKey ? [m.mediaKey] : [])),
  ];
  // deleteFiles já lida com lote de 1000 e com lista vazia
  const falhas = await deleteFiles(R2_PRIVATE_BUCKET, keys);

  const instance = await prisma.uazapiInstance.findUnique({ where: { organizationId: orgId } });
  if (instance) await deleteRemoteInstance(instance);

  return { objects: keys.length, failedObjects: falhas, instanceRemoved: !!instance };
};
```

- [ ] **Step 3: Registrar o hook**

```ts
organizationHooks: {
  beforeDeleteOrganization: async ({ organization }) => {
    // antes do delete de propósito: depois dele não há mais chave de objeto nem token de instância
    await purgeOrganizationAssets(organization.id);
  },
},
```

- [ ] **Step 4: O que fazer quando a purga falha**

Falha do R2 **não** pode impedir a exclusão da imobiliária (o titular pediu para sair; travar isso é pior
do que deixar objeto órfão), mas também não pode passar em silêncio: `try/catch` com
`logger.error({ orgId, err }, "purga de assets da organização falhou")` e as chaves que sobraram no log,
que é o que permite um expurgo manual depois. Exceção à D5 pelo mesmo motivo da Task 9, Step 4 — e o
motivo vai comentado no código.

- [ ] **Step 5: Rastro da exclusão**

Não gravar `AuditEvent` da exclusão da própria org: ele seria apagado no mesmo cascade, segundos depois.
O rastro é uma linha de `logger.warn` com `orgId`, nome, contagem de objetos apagados e o ator — e essa é
a razão pela qual esta linha da matriz §4 fica vazia de propósito.

- [ ] **Step 6: Testes**

- cria org com anexo (`READY`, `key` real no SeaweedFS local) e mensagem com `mediaKey`, chama
  `purgeOrganizationAssets` e confere que `headFile` de cada chave passa a falhar;
- org sem anexo nenhum: não chama o R2 e não lança;
- org com instância: `deleteRemoteInstance` é chamado (uazapi mockada, como em `whatsapp.test.ts`);
- **cascade completo**: `prisma.organization.delete` e então contar `auditEvent`, `attachment`,
  `conversation`, `whatsappMessage`, `client`, `deal` da org → **zero em todas**. É o teste que prova a
  decisão da D2.

- [ ] **Step 7: Verificar** — `pnpm vitest run test/organization-purge.test.ts && pnpm test`
- [ ] **Step 8: Commit**

```bash
git add eloscrm-api/src/modules/audit/organization-purge.service.ts eloscrm-api/src/lib/auth.ts eloscrm-api/src/modules/whatsapp/whatsapp.service.ts eloscrm-api/test/organization-purge.test.ts
git commit -m "feat: excluir a imobiliária apaga arquivos do R2 e a instância remota"
```

> **Débito que esta task deixa explícito:** o `beforeDeleteOrganization` cobre a exclusão pela API. Quem
> apagar a org **direto no banco** (`DELETE FROM organization`) continua deixando objeto órfão no R2 — o
> Postgres não sabe do bucket. Se isso virar rotina de operação, o caminho é um script
> `scripts/purge-org.ts` que chame a mesma função antes do delete.

---

### Task 20: Documentação

**Files:**
- Modify: `eloscrm-api/CLAUDE.md`, `eloscrm-web/CLAUDE.md`, `CLAUDE.md` (raiz)
- Modify: `docs/2026-08-04-debitos-whatsapp.md`

**Interfaces:**
- Consumes: todas.
- Produces: as regras deste plano onde quem for mexer depois vai ler.

- [ ] **Step 1: `eloscrm-api/CLAUDE.md`** — seção "Auditoria": `recordAudit` é o único ponto de escrita;
      `DELETED` grava antes do delete; a lista de exclusão da D7 com o motivo (senão alguém "completa" a
      cobertura e infla a tabela); `AUDIT_RETENTION_DAYS` e o fato de a purga não rodar sem Redis;
      allowlist de `snapshot` e a nota de LGPD; gate de gestor no service, não na rota.
- [ ] **Step 2: `eloscrm-web/CLAUDE.md`** — `AUDIT_ACTION_LABELS`/`ENTITY_NOUNS` são `Record` completos:
      valor novo de enum na API **quebra o typecheck do web** até ganhar rótulo (é proteção, não
      obstáculo); a tela de auditoria não usa `useEntityNames` de propósito.
- [ ] **Step 3: `CLAUDE.md` da raiz** — na seção de deploy, `AuditEvent` na lista do que exige
      `prisma db push` manual.
- [ ] **Step 4: débitos do WhatsApp** — anotar que a retenção **da auditoria** foi resolvida aqui e que a
      das mensagens continua aberta.
- [ ] **Step 5:** atualizar a linha de datas dos arquivos tocados (`TZ=America/Sao_Paulo date "+%Y-%m-%d %H:%M (-03)"`).
- [ ] **Step 6: Commit** — `git commit -m "docs: registra as regras da auditoria e da retenção"`

---

### Task 21: Verificação final e deploy

- [ ] **Step 1: API** — `cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm test`
      Expected: 0 erro de lint, "No errors found" no tsc, **todos** os testes passando. Piso medido em
      2026-08-06, já com a exclusão de conversa: 49 arquivos / 397 testes. Este plano acrescenta ~60
      casos.
- [ ] **Step 2: Web** — `cd eloscrm-web && pnpm lint && pnpm typecheck && pnpm build`
- [ ] **Step 3: Fumaça manual** — subir `./scripts/dev.sh`, criar/alterar/apagar um lead, apagar uma
      conversa, e conferir na tela `/auditoria`: os eventos aparecem, o do item apagado continua legível,
      o filtro por ator funciona e o CSV baixa.
- [ ] **Step 4: Purga** — `pnpm -C eloscrm-api audit:purge --days 0 --dry-run` no banco de **dev** e
      conferir a contagem. **Nunca** com `--days 0` sem `--dry-run` fora de dev.
- [ ] **Step 5: Deploy** — §9 abaixo, na ordem.

---

## 6. Riscos e mitigação

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| `db push` de produção esquecido | média (já aconteceu) | rotas novas em 500 | §9 é passo obrigatório antes da imagem; Task 20 Step 3 põe na doc de deploy |
| Enum novo sem rótulo no web | alta se as fases forem separadas | `pnpm build` do web quebra | Task 3 na **mesma fase** do schema; o typecheck é o detector |
| Volume da tabela | média | consulta lenta, disco | 4 índices (Task 1) + retenção (Fase 2) + lista de exclusão (D7) |
| Purga apagando demais | baixa | perda de trilha | `min(30)` na env, `--dry-run` no script, teste do laço em lotes |
| Purga não rodando (sem Redis) | **alta em produção** | tabela cresce igual | §9 exige checar `REDIS_URL` **ou** cron do host |
| `snapshot` retendo dado pessoal além do necessário | média | exposição LGPD | allowlist + máscara (D9) + retenção como teto |
| Hook do Better Auth derrubando login | baixa | ninguém entra | `try/catch` exclusivo da Task 9, Step 4, com o porquê comentado |
| Escrita de auditoria dobrando latência | baixa | p95 pior | 1 insert por ação, `organizationName` resolvido por evento; medir no Step 3 da Task 21 |
| Rota de leitura mudando de forma | certa | `AuditFeed` quebra | Task 14 Step 1 na mesma fase; teste ajustado (Task 13 Step 6) |
| Org apagada direto no banco, sem passar pela API | média (rotina de suporte) | objeto órfão pago no R2 e instância viva na uazapi | Task 19 registra o débito e indica `scripts/purge-org.ts` se virar rotina |

## 7. Ordem de execução e paralelismo

```
Fase 0 (Tasks 1→2→3)         sequencial, bloqueia tudo
   ├── Fase 1 (Tasks 4..9)   independentes entre si; podem ir em paralelo
   │      └── Task 10        depois de 4..9
   ├── Fase 2 (11→12)        independente da Fase 1
   └── Fase 3 (13)           independente da Fase 1
          └── Fase 4 (14→15→16)
                 └── Fase 5 (17, 18, 19, 20, 21)
```

Task 10 (matriz viva) tem que ser a **última** da Fase 1 — ela é o fecho de cobertura.

## 8. O que este plano não faz

1. **Não versiona o estado completo das entidades** (event sourcing). `snapshot` é allowlist para o
   evento ser legível, não para reconstruir o registro.
2. **Não audita leitura de tela** (quem abriu qual lead). Volume alto e valor baixo; a exceção é
   `DOWNLOADED` de anexo.
3. **Não faz retenção por organização** nem tela de configuração dela (D8).
4. **Não sobrevive à exclusão da organização** — e isso é intencional (D2): excluir a imobiliária apaga
   tudo que é dela, arquivos e auditoria incluídos. A Task 19 garante que a parte que o Postgres não
   alcança (R2 e instância na uazapi) vá junto.
5. **Não substitui `UazapiInstanceLog`** (D12).
6. **Não resolve a retenção das mensagens de WhatsApp** — segue aberta em
   `docs/2026-08-04-debitos-whatsapp.md`.

## 9. Deploy

Nesta ordem, e o passo 1 é manual:

```bash
# 1. schema novo no banco de produção — SEM isto a API sobe e só as rotas novas dão 500
DATABASE_URL="postgres://…produção…" pnpm -C eloscrm-api exec prisma db push
```

Se pedir `--accept-data-loss`, **parar**: significa drift, e nada neste plano é destrutivo.

```bash
# 2. envs novas no ambiente da API
AUDIT_RETENTION_DAYS=365
# 3. conferir REDIS_URL: com ela, a purga é agendada no boot; sem ela, agendar no cron do host:
#    20 3 * * *  cd /app && pnpm -C eloscrm-api audit:purge
```

4. Subir a imagem da API, depois o web (o web depende do envelope novo da rota de auditoria).
5. Primeira purga em produção: rodar `audit:purge --dry-run` antes, conferir a contagem, e só então
   deixar o job agendado assumir.

## 10. Verificação final (copiar a saída, não afirmar sem ela)

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm test
cd ../eloscrm-web && pnpm lint && pnpm typecheck && pnpm build
```

Além dos comandos, três coisas só o teste manual mostra:

- [ ] Apagar um lead e conferir na tela que o evento continua dizendo **nome, tipo e quem apagou**.
- [ ] Filtrar por "Automação" e ver o lead criado pela automação do WhatsApp.
- [ ] `audit:purge --dry-run` devolvendo contagem coerente com o volume do banco.

> Criado em 2026-08-06 10:58 (-03) · Última modificação: 2026-08-06 11:34 (-03)

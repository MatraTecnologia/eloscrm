# Nutrição de Leads — Plano B (Web)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar cara de produto ao estado de nutrição que a API já entrega — a tela `/nurturing`, os dois
diálogos de transição, as três entradas, e as superfícies existentes que o Plano A quebrou de propósito.

**Architecture:** Tudo client component com TanStack Query, no padrão do resto do app. O único lugar
que conhece a regra de negócio é `components/app/nurture-dialog.tsx`; as três entradas (mover,
adicionar, linkar) reusam esse mesmo diálogo. A lógica de bucket da tela é uma função pura em
`app/(app)/nurturing/buckets.ts`, separada do render.

**Tech Stack:** Next.js 16 (App Router), React 19, TanStack Query, shadcn/ui sobre Base UI, date-fns.

Spec: `docs/superpowers/specs/2026-07-30-nutricao-de-leads-design.md` (§4 é o desenho da tela; §8 são
os débitos que o Plano A deixou e que **este plano tem que respeitar**).
Plano A (API), já mergeado em `main`: `docs/superpowers/plans/2026-07-30-nutricao-a-api.md`.
Base: commit `fb7b6f5`.

## Global Constraints

- **Este projeto não tem testes.** A verificação por tarefa é `pnpm typecheck`, `pnpm lint` e
  `pnpm build` (de dentro de `eloscrm-web/`) **mais QA visual** pela tool MCP `screenshot`, lendo os
  erros de console e as requests ≥400 (`capture_console: true`). Um `tsc` verde não prova que a tela
  renderiza — vários passos abaixo pedem screenshot com URL e o que conferir.
- **O dev server já está de pé** (API 3333, web 3000), iniciado pelo controller. **Não** suba nem
  derrube servidor; não rode `./scripts/dev.sh` nem `pnpm dev`.
- **`eloscrm-web/AGENTS.md` é regra do projeto:** "This is NOT the Next.js you know — read the
  relevant guide in `node_modules/next/dist/docs/` before writing any code." Leia o guia pertinente em
  `eloscrm-web/node_modules/next/dist/docs/01-app/` antes de escrever código de Next.
- `const` arrow functions; nunca `function` declaration.
- Sem `console.log` em código entregue.
- **Nunca emoji na UI** — ícones Lucide, `stroke=currentColor`.
- UI em pt-BR; identificadores em inglês. Nenhum enum cru pode aparecer na tela — tudo passa por
  `lib/labels.ts`. Commits em português, imperativo.
- **Query key sempre embute `org?.id`** e usa `enabled: !!org?.id` — é o que troca o cache quando o
  usuário muda de imobiliária.
- **`lib/types.ts` espelha o Prisma à mão.** Não existe pacote compartilhado.
- Comentar só o "porquê" não-trivial. Nada de comentário, docstring ou type annotation em código não
  modificado.
- **Arquivos focados e pequenos.** Componente local mora junto da rota; sobe para `components/app/`
  só quando é usado por mais de uma rota.
- Débitos do Plano A que este plano tem que contornar (spec §8):
  - **`note` recusa string vazia** (`z.string().min(1)`). O textarea vazio precisa virar `undefined`
    no payload — **não** `null`, porque `nurtureSchema` tem `.optional()` sem `.nullable()`.
  - **A data vai no fim do dia local.** `<Input type="date">` devolve `"2026-12-31"`; converter com
    `endOfDay(parse(value, "yyyy-MM-dd", new Date())).toISOString()`, exatamente como
    `app/(app)/agenda/page.tsx` já faz. Meia-noite UTC faria "retomar hoje" nascer atrasado.

---

## Contrato da API (já no ar, `main` @ `fb7b6f5`)

```
GET  /v1/clients?status=ACTIVE|NURTURING|ALL&overdue=true   // default ACTIVE
GET  /v1/clients/:id                                         // sem filtro de status
PATCH /v1/clients/:id  { nurtureUntil?, nurtureReason?, nurtureNote? }   // reagenda; ignora status
POST /v1/clients/:id/nurture
     { reason, note?, until?, deals?: [{ dealId, action: "KEEP"|"CLOSE_LOST", lostStageId? }] }
POST /v1/clients/:id/reactivate  { reopenDealIds?: string[] }
GET  /v1/agenda?from&to   →  AgendaItem[]  (kind ACTIVITY | NURTURE)
GET  /v1/dashboard/stats  →  kpis ganha nurturing e nurtureDue
```

Erros que a UI precisa tratar: 409 `ALREADY_NURTURING` / `NOT_NURTURING`; 422 `DEALS_NOT_COVERED`,
`DEAL_NOT_OPEN`, `DUPLICATE_DEAL`, `INVALID_LOST_STAGE`, `DEAL_NOT_LOST`, `NO_OPEN_STAGE`.
O interceptor do axios já rejeita com o `error` desembrulhado (`{ code, message }`).

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `lib/types.ts` | `ClientStatus`, `NurtureReason`, campos do `Client`, `AgendaItem`, KPIs | Modificar |
| `lib/labels.ts` | rótulos dos dois enums + `formatAuditValue` | Modificar |
| `lib/queries/clients.ts` | `status`/`overdue` no filtro, `useNurtureClient`, `useReactivateClient` | Modificar |
| `lib/queries/deals.ts` | `isLost` no `EnrichedDeal` | Modificar |
| `lib/queries/agenda.ts` | tipo do retorno | Modificar |
| `app/(app)/agenda/page.tsx` | renderiza os dois `kind` | Modificar |
| `app/(app)/dashboard/recent-activities-card.tsx` | idem | Modificar |
| `app/(app)/deals/kanban-board.tsx`, `deal-form.tsx`, `deal-detail-dialog.tsx` | `status: "ALL"` | Modificar |
| `components/app/use-entity-names.ts`, `activity-dialog.tsx` | `status: "ALL"` | Modificar |
| `components/app/nurture-dialog.tsx` | **a** regra: motivo, data, destino dos negócios | **Criar** |
| `components/app/reactivate-dialog.tsx` | reativação + reabertura de negócios | **Criar** |
| `app/(app)/nurturing/buckets.ts` | função pura de bucket por data | **Criar** |
| `app/(app)/nurturing/page.tsx` | tela: chips, tabela, ações | **Criar** |
| `app/(app)/nurturing/reschedule-popover.tsx` | reagendar in-place | **Criar** |
| `app/(app)/nurturing/link-client-dialog.tsx` | "trazer lead existente" | **Criar** |
| `components/app/app-sidebar.tsx` | item "Nutrição" | Modificar |
| `app/(app)/clients/page.tsx` | filtro por status + badge + ação na linha | Modificar |
| `app/(app)/clients/[id]/nurture-banner.tsx` | estado do lead no perfil | **Criar** |
| `app/(app)/clients/[id]/page.tsx` | monta o banner | Modificar |
| `app/(app)/dashboard/page.tsx` | card "Em nutrição" | Modificar |

---

## Task 1: Fundação — tipos, rótulos e hooks

**Files:**
- Modify: `eloscrm-web/lib/types.ts`
- Modify: `eloscrm-web/lib/labels.ts`
- Modify: `eloscrm-web/lib/queries/clients.ts`
- Modify: `eloscrm-web/lib/queries/deals.ts`
- Modify: `eloscrm-web/lib/queries/agenda.ts`

**Interfaces:**
- Consumes: nada.
- Produces (as tarefas seguintes dependem destes nomes exatos):
  - `ClientStatus = "ACTIVE" | "NURTURING"`,
    `NurtureReason = "SEM_ORCAMENTO" | "ADIADO" | "SEM_RESPOSTA" | "COMPROU_COM_OUTRO" | "SO_PESQUISANDO" | "OUTRO"`
  - `Client` ganha `status`, `nurtureReason`, `nurtureNote`, `nurtureUntil`, `nurturedAt`
  - `AgendaItem` (união discriminada) e `NurturePayload`
  - `clientStatusLabels`, `nurtureReasonLabels`
  - `ClientFilters` ganha `status?: ClientStatus | "ALL"` e `overdue?: boolean`
  - `NurtureInput`, `ReactivateInput`, `DealDecision`
  - `useNurtureClient()`, `useReactivateClient()`
  - `EnrichedDeal` ganha `isLost: boolean`

- [ ] **Step 1: Espelhar os tipos da API**

Em `lib/types.ts`, junto dos outros enums do topo:

```ts
export type ClientStatus = "ACTIVE" | "NURTURING";
export type NurtureReason =
  | "SEM_ORCAMENTO"
  | "ADIADO"
  | "SEM_RESPOSTA"
  | "COMPROU_COM_OUTRO"
  | "SO_PESQUISANDO"
  | "OUTRO";
```

No `type Client`, depois de `budgetMax`:

```ts
  status: ClientStatus;
  nurtureReason: NurtureReason | null;
  nurtureNote: string | null;
  nurtureUntil: string | null;
  nurturedAt: string | null;
```

No `type DashboardStats`, dentro de `kpis`, depois de `openValue: number`:

```ts
    nurturing: number;
    nurtureDue: number;
```

E, ao fim do arquivo, o item da agenda:

```ts
// /v1/agenda passou a ter duas fontes e devolve uma união discriminada, no mesmo formato do
// TimelineItem. `at` é o dueAt da atividade ou o nurtureUntil do lead a retomar.
export type NurturePayload = {
  clientId: string;
  clientName: string;
  phone: string | null;
  reason: NurtureReason | null;
  note: string | null;
};

export type AgendaItem =
  | { kind: "ACTIVITY"; id: string; at: string; payload: Activity }
  | { kind: "NURTURE"; id: string; at: string; payload: NurturePayload };
```

- [ ] **Step 2: Rótulos em pt-BR**

Em `lib/labels.ts`, junto dos outros mapas de rótulo:

```ts
export const clientStatusLabels: Record<ClientStatus, string> = {
  ACTIVE: "Ativo",
  NURTURING: "Em nutrição",
};

export const nurtureReasonLabels: Record<NurtureReason, string> = {
  SEM_ORCAMENTO: "Orçamento não fecha",
  ADIADO: "Vai comprar mais para frente",
  SEM_RESPOSTA: "Sem resposta",
  COMPROU_COM_OUTRO: "Comprou com outro",
  SO_PESQUISANDO: "Só pesquisando",
  OUTRO: "Outro motivo",
};
```

Acrescente `ClientStatus` e `NurtureReason` ao import de tipos do topo do arquivo.

Em `FIELD_LABELS`, quatro entradas novas:

```ts
  status: "Status",
  nurtureReason: "Motivo da nutrição",
  nurtureNote: "Detalhe da nutrição",
  nurtureUntil: "Retomar em",
```

Atenção: `FIELD_LABELS` **já tem** uma chave `status: "Status"` (usada pelo imóvel). Não duplique a
chave — confira o arquivo e reaproveite a que existe.

E em `formatAuditValue`, duas ramificações novas, logo antes do `if (field === "value")`:

```ts
  if (field === "status") return clientStatusLabels[value as ClientStatus] ?? String(value);
  if (field === "nurtureReason") return nurtureReasonLabels[value as NurtureReason] ?? String(value);
```

Sem isso o histórico mostra `NURTURING` e `SEM_ORCAMENTO` crus na tela — que é exatamente o problema
que a função existe para resolver.

- [ ] **Step 3: Filtros e mutations de nutrição**

Em `lib/queries/clients.ts`:

```ts
export type ClientFilters = {
  source?: ClientSource;
  q?: string;
  temperature?: LeadTemperature;
  tag?: string;
  // "ALL" não é um ClientStatus: é o valor que a API aceita para não filtrar nada
  status?: ClientStatus | "ALL";
  overdue?: boolean;
};
```

`ClientInput` ganha os três campos reagendáveis (o `PATCH` aceita, e a UI reagenda por ele):

```ts
  nurtureReason?: NurtureReason | null;
  nurtureNote?: string | null;
  nurtureUntil?: string | null;
```

E, ao fim do arquivo, as duas transições. Elas invalidam mais keys que o `useUpdateClient` porque
mexem em negócio e em agenda também:

```ts
export type DealDecision = { dealId: string; action: "KEEP" | "CLOSE_LOST"; lostStageId?: string };
export type NurtureInput = {
  reason: NurtureReason;
  note?: string;
  until?: string;
  deals?: DealDecision[];
};
export type ReactivateInput = { reopenDealIds?: string[] };

// nutrir/reativar move negócio, muda a listagem, entra na agenda e no painel: invalidar só
// ["clients"] deixaria o kanban e a agenda mostrando o estado anterior
const invalidateNurtureViews = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["clients"] });
  qc.invalidateQueries({ queryKey: ["deals"] });
  qc.invalidateQueries({ queryKey: ["agenda"] });
  qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  qc.invalidateQueries({ queryKey: ["audit-events"] });
  qc.invalidateQueries({ queryKey: ["timeline"] });
};

export const useNurtureClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: NurtureInput }) => {
      const { data } = await api.post<Client>(`/clients/${id}/nurture`, input);
      return data;
    },
    onSuccess: () => invalidateNurtureViews(qc),
  });
};

export const useReactivateClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ReactivateInput }) => {
      const { data } = await api.post<Client>(`/clients/${id}/reactivate`, input);
      return data;
    },
    onSuccess: () => invalidateNurtureViews(qc),
  });
};
```

`useUpdateClient` também precisa invalidar `["agenda"]` agora — reagendar a retomada muda o que a
agenda mostra. Acrescente a linha ao `onSuccess` dele.

- [ ] **Step 4: `isLost` no `EnrichedDeal`**

Em `lib/queries/deals.ts`, o `EnrichedDeal` ganha o campo e o `map` o preenche. O diálogo de
reativação precisa distinguir "perdido" de "ganho", e hoje só existe `isOpen`:

```ts
export type EnrichedDeal = Deal & {
  stageName: string;
  stageColor: string | null;
  isOpen: boolean;
  isLost: boolean;
};
```

```ts
      isOpen: stage ? !stage.isWon && !stage.isLost : false,
      isLost: stage?.isLost ?? false,
```

- [ ] **Step 5: Tipo do retorno da agenda**

Em `lib/queries/agenda.ts`, trocar o import de `Activity` por `AgendaItem` e o genérico:

```ts
      const { data } = await api.get<AgendaItem[]>("/agenda", { params: range });
```

- [ ] **Step 6: Verificar**

De dentro de `eloscrm-web/`, em comandos separados:

```bash
pnpm typecheck
pnpm lint
```

Esperado: `typecheck` **falha** — e a falha é a informação útil desta tarefa. `agenda/page.tsx`,
`recent-activities-card.tsx` e tudo que lê `activity.dueAt` no item da agenda param de compilar,
porque o contrato mudou. Anote no relatório **a lista exata dos erros**: é o escopo da Task 2.

Não conserte nada aqui. Não rode `pnpm build` (vai falhar pelo mesmo motivo).

- [ ] **Step 7: Commit**

```bash
git add eloscrm-web/lib/types.ts eloscrm-web/lib/labels.ts eloscrm-web/lib/queries/clients.ts eloscrm-web/lib/queries/deals.ts eloscrm-web/lib/queries/agenda.ts
git commit -m "feat: espelha o estado de nutrição nos tipos e hooks do web"
```

---

## Task 2: Consertar o que o Plano A quebrou

**Files:**
- Modify: `eloscrm-web/app/(app)/agenda/page.tsx`
- Modify: `eloscrm-web/app/(app)/dashboard/recent-activities-card.tsx`
- Modify: `eloscrm-web/app/(app)/deals/kanban-board.tsx`
- Modify: `eloscrm-web/app/(app)/deals/deal-form.tsx`
- Modify: `eloscrm-web/app/(app)/deals/deal-detail-dialog.tsx`
- Modify: `eloscrm-web/components/app/use-entity-names.ts`
- Modify: `eloscrm-web/components/app/activity-dialog.tsx`

**Interfaces:**
- Consumes: `AgendaItem`, `NurturePayload`, `ClientFilters.status` (Task 1).
- Produces: nada de novo — restaura comportamento.

Duas regressões diferentes, ambas causadas de propósito pela API e nomeadas na spec §4.5/§7:

1. **`GET /clients` agora filtra.** Cinco chamadas de `useClients()` sem argumento existem para
   *resolver nome* ou *oferecer o lead num combobox* — todas precisam do lead nutrido. Sem
   `status: "ALL"`, o card do kanban de um negócio `KEEP`ado perde o nome do cliente e a auditoria
   volta a mostrar cuid cru.
2. **A agenda mudou de formato.** As duas telas que a consomem filtram por `activity.dueAt`, campo
   que não existe mais no topo do item: hoje elas ficariam **em branco, sem erro nenhum**.

- [ ] **Step 1: `status: "ALL"` nos cinco consumidores**

Trocar `useClients()` por `useClients({ status: "ALL" })` em:

- `app/(app)/deals/kanban-board.tsx` — mapa de nomes do card
- `app/(app)/deals/deal-form.tsx` — combobox de cliente do formulário de negócio
- `app/(app)/deals/deal-detail-dialog.tsx` — resolve o cliente do negócio aberto
- `components/app/use-entity-names.ts` — tradução de cuid no histórico e na timeline
- `components/app/activity-dialog.tsx` — combobox de vínculo da atividade

O quinto merece justificativa, porque é o único discutível: o corretor precisa poder registrar
"liguei, ainda não é hora" num lead nutrido **sem** reativá-lo. Escondê-lo do combobox tornaria isso
impossível. Ponha essa razão em um comentário de uma linha no `activity-dialog.tsx`, e só nele.

- [ ] **Step 2: Agenda renderizando os dois `kind`**

Em `app/(app)/agenda/page.tsx`:

- `groupByDay` passa a agrupar `AgendaItem[]` por `item.at` (que nunca é nulo), em vez de filtrar por
  `activity.dueAt`:

```ts
const groupByDay = (items: AgendaItem[]) =>
  items.reduce<Record<string, AgendaItem[]>>((acc, item) => {
    const day = format(parseISO(item.at), DATE_FORMAT);
    acc[day] = acc[day] ?? [];
    acc[day].push(item);
    return acc;
  }, {});
```

- A linha da lista passa a ramificar por `item.kind`. Mantenha **toda** a linha de atividade como
  está hoje (checkbox, hora, ícone, badge de tipo, descrição, link do cliente, badge "Atrasada",
  editar e excluir) — ela agora lê de `item.payload` em vez de `activity`. O `key` vira
  `` `${item.kind}-${item.id}` ``.
- A linha de nutrição é nova e mais simples: ícone `Snowflake`, hora, badge `Nutrição`, o nome do lead
  como `Link` para `/clients/${payload.clientId}`, o rótulo do motivo (`nurtureReasonLabels`), e uma
  badge "Atrasada" pela mesma regra de `now`. Sem checkbox (não é tarefa que se conclui) e sem os
  botões de editar/excluir atividade. A ação certa é um botão "Retomar contato" — mas ele depende do
  diálogo da Task 4, então **nesta tarefa a linha não tem ação**; a Task 6 a acrescenta.
- `toggleDone`, `handleDelete` e os dois diálogos continuam existindo, só passam a receber
  `item.payload` no ramo `ACTIVITY`.
- O texto do vazio vira "Nenhum compromisso no período." (agora não são só atividades).

- [ ] **Step 3: Card de atividades recentes**

Em `app/(app)/dashboard/recent-activities-card.tsx`, o `upcoming` deixa de filtrar por `dueAt` e passa
a ordenar por `item.at`:

```ts
  const upcoming = (items ?? []).slice().sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5);
```

(`at` vem em ISO 8601 UTC da API, então comparação lexicográfica ordena igual à cronológica e evita
construir cinco `Date` por render.)

Cada linha ramifica por `kind`: a de atividade fica como está (ícone, descrição, tipo + distância); a
de nutrição usa `Snowflake`, o nome do lead como texto principal e "Retomar · {distância}" embaixo.
O título do card vira "Próximos compromissos" e o vazio, "Nada agendado."

- [ ] **Step 4: Verificar que compila**

De dentro de `eloscrm-web/`, em comandos separados:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Esperado: os três limpos. Se `typecheck` ainda apontar algum consumidor da agenda que a Task 1 não
listou, conserte-o aqui — é a mesma regressão.

- [ ] **Step 5: QA visual — as duas telas que estavam quebradas**

O dev server já está rodando. Use a tool MCP `screenshot` com `capture_console: true`:

1. `http://localhost:3000/agenda` — tem que listar compromissos **e** pelo menos uma linha de
   nutrição (o controller deixou um lead nutrido no banco de dev). Console sem erro, nenhuma request ≥400.
2. `http://localhost:3000/dashboard` — o card de próximos compromissos preenchido, não vazio.
3. `http://localhost:3000/deals` — **o ponto central desta tarefa**: os cards do kanban têm que
   mostrar o nome do cliente. Se algum card mostrar vazio ou um cuid, o `status: "ALL"` não pegou.

Cole no relatório o que viu em cada uma, e os erros de console se houver.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-web/app/\(app\)/agenda/page.tsx eloscrm-web/app/\(app\)/dashboard/recent-activities-card.tsx eloscrm-web/app/\(app\)/deals/kanban-board.tsx eloscrm-web/app/\(app\)/deals/deal-form.tsx eloscrm-web/app/\(app\)/deals/deal-detail-dialog.tsx eloscrm-web/components/app/use-entity-names.ts eloscrm-web/components/app/activity-dialog.tsx
git commit -m "fix: acompanha os contratos novos de clientes e agenda"
```

---

## Task 3: Diálogo de nutrição

**Files:**
- Create: `eloscrm-web/components/app/nurture-dialog.tsx`

**Interfaces:**
- Consumes: `useNurtureClient`, `NurtureInput`, `DealDecision`, `nurtureReasonLabels` (Task 1);
  `useOrgDeals` (`EnrichedDeal` com `isOpen`), `usePipelines`.
- Produces:
  ```ts
  export const NurtureDialog = ({ client, trigger, open, onOpenChange, onDone }: {
    client: Pick<Client, "id" | "name">;
    trigger?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onDone?: () => void;
  }) => …
  ```
  Serve tanto no modo `trigger` (a partir de um botão) quanto controlado (`open`/`onOpenChange`) — o
  fluxo "adicionar" da Task 5 abre o diálogo por código, sem botão. `Dialog` do Base UI aceita
  `open`/`onOpenChange` e desmonta o conteúdo ao fechar (`DialogPortal.keepMounted` é `false` por
  padrão), então **não** é preciso `key=` para resetar o formulário.

Este é o único arquivo que conhece a regra. As três entradas da Task 5 e as ações das Tasks 6 apenas
o abrem.

- [ ] **Step 1: Estado e dados**

```tsx
const REASONS: NurtureReason[] = [
  "ADIADO", "SEM_ORCAMENTO", "SEM_RESPOSTA", "COMPROU_COM_OUTRO", "SO_PESQUISANDO", "OUTRO",
];

// atalhos do "quando retomar": cobrem quase todo caso real e evitam abrir o date picker
const PRESETS = [
  { label: "30 dias", days: 30 },
  { label: "60 dias", days: 60 },
  { label: "90 dias", days: 90 },
  { label: "6 meses", days: 180 },
];
```

Estado local: `reason` (default `"ADIADO"`), `note`, `until` (string `yyyy-MM-dd`, default vazio =
sem data), e `decisions: Record<string, { action: "KEEP" | "CLOSE_LOST"; lostStageId?: string }>`
indexado por `dealId`.

Os negócios abertos do lead:

```tsx
const { deals } = useOrgDeals();
const { data: pipelines } = usePipelines();
const openDeals = deals.filter((deal) => deal.clientId === client.id && deal.isOpen);
```

E, por negócio, os estágios de perda **do pipeline dele**:

```tsx
const lostStagesOf = (pipelineId: string) =>
  (pipelines ?? []).find((p) => p.id === pipelineId)?.stages.filter((s) => s.isLost) ?? [];
```

- [ ] **Step 2: O formulário**

Quatro blocos, na ordem da spec §4.3:

1. **Motivo** — `Select` com `REASONS` e `nurtureReasonLabels`, no padrão dos outros diálogos do app.
2. **Detalhe** — `Textarea` opcional, `rows={3}`, placeholder "O que o lead disse? (opcional)".
3. **Retomar em** — os quatro `PRESETS` como `Button variant="outline" size="sm"` que setam
   `until = format(addDays(new Date(), preset.days), "yyyy-MM-dd")`, mais um botão "Sem data" que
   limpa, mais `<Input type="date" value={until} onChange={…} />`. O preset ativo fica
   `variant="secondary"`.
4. **Negócios abertos** — só renderiza se `openDeals.length > 0`. Para cada negócio: o título, o
   valor (`formatCurrency`) e o estágio atual, mais dois `Button` de escolha (`Manter no funil` /
   `Fechar como perdido`) e, quando `CLOSE_LOST` estiver escolhido, um `Select` com
   `lostStagesOf(deal.pipelineId)`.

Regras que o render precisa obedecer:

- **Todo negócio aberto começa com uma decisão explícita**: inicialize o estado com
  `action: "KEEP"` para cada um. A API recusa a lista incompleta com 422 `DEALS_NOT_COVERED`, e um
  default implícito no servidor seria pior do que a escolha visível.
- Ao escolher `CLOSE_LOST`, pré-selecione o primeiro estágio de perda do pipeline daquele negócio.
- Pipeline **sem** estágio de perda: desabilite o botão `Fechar como perdido` e mostre, em
  `text-xs text-muted-foreground`, "Este funil não tem estágio de perda". A API recusaria com 422
  `INVALID_LOST_STAGE`; melhor não deixar o usuário chegar lá.

- [ ] **Step 3: Submeter**

```tsx
const submit = async () => {
  const input: NurtureInput = {
    reason,
    // a API recusa string vazia (`min(1)`); o campo em branco tem que sumir do payload
    note: note.trim() || undefined,
    until: until ? endOfDay(parse(until, "yyyy-MM-dd", new Date())).toISOString() : undefined,
    deals: openDeals.map((deal) => ({ dealId: deal.id, ...decisions[deal.id] })),
  };
  try {
    await nurture.mutateAsync({ id: client.id, input });
    toast.success("Lead enviado para nutrição");
    onOpenChange?.(false);
    onDone?.();
  } catch {
    toast.error("Não foi possível enviar para nutrição");
  }
};
```

`endOfDay` e `parse` vêm de `date-fns` — a data tem que ir no fim do dia local, senão "retomar hoje"
nasce atrasado (Global Constraints).

O botão de confirmar fica `disabled` enquanto `nurture.isPending`, com o texto "Enviando…".

- [ ] **Step 4: Verificar que compila**

```bash
pnpm typecheck
pnpm lint
```

Esperado: limpos. O componente ainda não é montado por ninguém — o QA visual dele acontece na Task 5,
quando a tela existir.

- [ ] **Step 5: Commit**

```bash
git add eloscrm-web/components/app/nurture-dialog.tsx
git commit -m "feat: adiciona o diálogo de envio para nutrição"
```

---

## Task 4: Diálogo de reativação

**Files:**
- Create: `eloscrm-web/components/app/reactivate-dialog.tsx`

**Interfaces:**
- Consumes: `useReactivateClient`, `ReactivateInput` (Task 1); `useOrgDeals` (`EnrichedDeal` com
  `isLost`, da Task 1 Step 4).
- Produces:
  ```ts
  export const ReactivateDialog = ({ client, trigger, open, onOpenChange, onDone }: {
    client: Pick<Client, "id" | "name">;
    trigger?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onDone?: () => void;
  }) => …
  ```
  Mesma assinatura do `NurtureDialog`, de propósito: as telas tratam os dois do mesmo jeito.

- [ ] **Step 1: Estado e dados**

```tsx
const { deals } = useOrgDeals();
const lostDeals = deals.filter((deal) => deal.clientId === client.id && deal.isLost);
const [reopenIds, setReopenIds] = useState<string[]>([]);
```

**Nenhum negócio marcado por padrão** — reabrir negócio é decisão consciente, não default (spec §4.4).

- [ ] **Step 2: O conteúdo**

- Um parágrafo curto: "{client.name} volta para a lista de leads ativos."
- Se `lostDeals.length > 0`, a lista com um `Checkbox` por negócio: título, `formatCurrency(value)`,
  e o `lostReason` em `text-xs text-muted-foreground` quando houver (é o texto que a nutrição gravou;
  ver o lado a lado ajuda a decidir). Acima da lista, um rótulo:
  "Reabrir algum negócio? Ele volta para o primeiro estágio aberto do funil."
- Se não houver negócio perdido, não renderize a seção.

- [ ] **Step 3: Submeter**

```tsx
const submit = async () => {
  const input: ReactivateInput = reopenIds.length ? { reopenDealIds: reopenIds } : {};
  try {
    await reactivate.mutateAsync({ id: client.id, input });
    toast.success("Lead reativado");
    onOpenChange?.(false);
    onDone?.();
  } catch {
    toast.error("Não foi possível reativar o lead");
  }
};
```

- [ ] **Step 4: Verificar que compila**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add eloscrm-web/components/app/reactivate-dialog.tsx
git commit -m "feat: adiciona o diálogo de reativação do lead"
```

---

## Task 5: A tela `/nurturing`

**Files:**
- Create: `eloscrm-web/app/(app)/nurturing/buckets.ts`
- Create: `eloscrm-web/app/(app)/nurturing/reschedule-popover.tsx`
- Create: `eloscrm-web/app/(app)/nurturing/link-client-dialog.tsx`
- Create: `eloscrm-web/app/(app)/nurturing/page.tsx`
- Modify: `eloscrm-web/components/app/app-sidebar.tsx`

**Interfaces:**
- Consumes: `useClients` com `status` (Task 1), `NurtureDialog` (Task 3), `ReactivateDialog` (Task 4),
  `useUpdateClient` (reagendar), `useMembers`.
- Produces: rota `/nurturing`; `bucketOf(client, now)` e `BUCKETS`.

- [ ] **Step 1: A lógica de bucket, isolada e pura**

`app/(app)/nurturing/buckets.ts`:

```ts
import { endOfMonth, endOfWeek, isBefore } from "date-fns";
import type { Client } from "@/lib/types";

export type BucketKey = "OVERDUE" | "WEEK" | "MONTH" | "LATER" | "UNDATED" | "ALL";

export const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: "OVERDUE", label: "Atrasados" },
  { key: "WEEK", label: "Esta semana" },
  { key: "MONTH", label: "Este mês" },
  { key: "LATER", label: "Depois" },
  { key: "UNDATED", label: "Sem data" },
  { key: "ALL", label: "Todos" },
];

// avaliados nesta ordem e mutuamente exclusivos: um lead vencido cai em Atrasados e em mais lugar
// nenhum, mesmo que a data seja desta semana
export const bucketOf = (client: Client, now: Date): Exclude<BucketKey, "ALL"> => {
  if (!client.nurtureUntil) return "UNDATED";
  const until = new Date(client.nurtureUntil);
  if (isBefore(until, now)) return "OVERDUE";
  // weekStartsOn 1: a semana do CRM começa na segunda, como no resto do app
  if (isBefore(until, endOfWeek(now, { weekStartsOn: 1 }))) return "WEEK";
  if (isBefore(until, endOfMonth(now))) return "MONTH";
  return "LATER";
};
```

- [ ] **Step 2: Reagendar in-place**

`app/(app)/nurturing/reschedule-popover.tsx` — `Popover` com um `<Input type="date">` e um botão
Salvar, que chama `useUpdateClient` com
`{ nurtureUntil: endOfDay(parse(value, "yyyy-MM-dd", new Date())).toISOString() }`, mais um botão
"Sem data" que manda `{ nurtureUntil: null }`. Toast de sucesso e de erro, como no resto do app.

Props: `{ client: Client; trigger: ReactNode }`.

- [ ] **Step 3: Trazer lead existente**

`app/(app)/nurturing/link-client-dialog.tsx` — um `Dialog` com `<Input>` de busca e a lista dos leads
**ativos** (`useClients({ status: "ACTIVE", q })`), filtrada pelo texto digitado. Clicar num lead
fecha este diálogo e abre o `NurtureDialog` controlado para ele.

Guarde o lead escolhido em estado (`selected`) e renderize
`<NurtureDialog client={selected} open onOpenChange={…} onDone={…} />` quando houver um. É por isso
que o `NurtureDialog` aceita modo controlado.

- [ ] **Step 4: A página**

`app/(app)/nurturing/page.tsx`, seguindo a estrutura de `app/(app)/clients/page.tsx` (cabeçalho com
título + descrição + ações, aviso de "selecione uma imobiliária", `Table` dentro de `rounded-lg border`,
`Skeleton` no loading):

- `const { data: clients, isLoading } = useClients({ status: "NURTURING" })`
- `const [now] = useState(() => new Date())` — congelado na montagem, como a agenda já faz, senão o
  bucket muda entre renders.
- `const [bucket, setBucket] = useState<BucketKey>("OVERDUE")`
- Chips: um `Button` por entrada de `BUCKETS`, `variant={bucket === key ? "secondary" : "ghost"}`,
  `size="sm"`, com a contagem daquele bucket ao lado em `text-muted-foreground`. O chip "Todos" conta
  tudo.
- Colunas da tabela: **Lead** (`ClientAvatar` + nome, `Link` para `/clients/[id]`) · **Motivo**
  (`nurtureReasonLabels[reason]`, com o `nurtureNote` embaixo em `text-xs text-muted-foreground`
  quando houver) · **Parado há** (`formatDistanceToNow(parseISO(nurturedAt))`, ou `—`) ·
  **Retomar em** (`format(parseISO(nurtureUntil), "dd/MM/yyyy")`, ou "Sem data"; vencido ganha
  `Badge` "Atrasado" `border-destructive/20 bg-destructive/10 text-destructive`) · **Responsável**
  (nome do membro por `ownerId`, ou `—`) · **Ações**.
- Ações por linha, no padrão `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` que a
  tabela de clientes já usa: WhatsApp e telefone (só quando `client.phone`, iguais aos do
  `LeadHeader`), `ReschedulePopover`, e `ReactivateDialog` com o botão "Retomar contato".
- Duas ações no cabeçalho: **Novo lead em nutrição** (abre o `ClientDialog` de criação; no sucesso,
  abre o `NurtureDialog` controlado para o lead recém-criado) e **Trazer lead existente**
  (`LinkClientDialog`).
- Vazio: `Empty` com ícone `Snowflake`, título "Nenhum lead em nutrição" e uma descrição que explique
  o que a tela é para quem chegou nela pela primeira vez.

**Sobre o "Novo lead em nutrição":** `app/(app)/clients/client-dialog.tsx` hoje só recebe
`{ client?, trigger }` e não avisa ninguém do que criou. Acrescente a ele uma prop opcional:

```ts
export const ClientDialog = ({ client, trigger, onCreated }: {
  client?: Client
  trigger: React.ReactNode
  onCreated?: (created: Client) => void
})
```

`create.mutateAsync` já devolve o `Client`; chame `onCreated?.(created)` depois do sucesso, só no
ramo de criação. É aditivo e não altera nenhum dos usos existentes. **Esse arquivo usa aspas simples
e não usa ponto e vírgula**, ao contrário do resto do projeto — mantenha o estilo local dele, não o
reformate.

Adicione o `app/(app)/clients/client-dialog.tsx` ao `git add` do Step 8.

- [ ] **Step 5: Item na sidebar**

Em `components/app/app-sidebar.tsx`, importe `Snowflake` do lucide e acrescente ao array `items`,
entre Negociações e Agenda:

```ts
  { title: "Nutrição", href: "/nurturing", icon: Snowflake },
```

- [ ] **Step 6: Verificar que compila**

```bash
pnpm typecheck
pnpm lint
pnpm build
```

- [ ] **Step 7: QA visual da tela**

Com a tool MCP `screenshot`, `capture_console: true`:

1. `http://localhost:3000/nurturing` — a tela com o lead que o controller deixou nutrido, chip
   "Atrasados" selecionado por padrão, contagens nos chips, colunas preenchidas (motivo, parado há,
   retomar em). Console limpo.
2. A mesma URL com `actions` clicando no chip **Todos** — a lista tem que continuar preenchida.
3. A mesma URL com `actions` clicando em **Trazer lead existente** — o diálogo abre com a busca e a
   lista de leads ativos.
4. `viewports: ["mobile", "desktop"]` na primeira — a tabela não pode estourar a largura da página
   (se estourar, envolva a `Table` num `overflow-x-auto`).

Cole no relatório o que viu e os erros de console, se houver.

- [ ] **Step 8: Commit**

```bash
git add eloscrm-web/app/\(app\)/nurturing eloscrm-web/components/app/app-sidebar.tsx
git commit -m "feat: cria a tela de nutrição de leads"
```

---

## Task 6: As superfícies existentes

**Files:**
- Modify: `eloscrm-web/app/(app)/clients/page.tsx`
- Create: `eloscrm-web/app/(app)/clients/[id]/nurture-banner.tsx`
- Modify: `eloscrm-web/app/(app)/clients/[id]/page.tsx`
- Modify: `eloscrm-web/app/(app)/dashboard/page.tsx`
- Modify: `eloscrm-web/app/(app)/agenda/page.tsx`

**Interfaces:**
- Consumes: tudo das tarefas anteriores.
- Produces: nada que outra tarefa consuma — é a última.

- [ ] **Step 1: `/clients` — filtro, badge e ação**

Em `app/(app)/clients/page.tsx`:

- Estado `const [status, setStatus] = useState<ClientStatus | "ALL">("ACTIVE")` e três chips
  (**Ativos** · **Em nutrição** · **Todos**) ao lado do campo de busca, no mesmo estilo dos chips da
  tela de nutrição.
- `useClients({ status, ...(q ? { q } : {}) })`.
- A coluna **Status** hoje mostra `Ativo` / `Sem negócio` a partir de `hasOpen`. Quando
  `client.status === "NURTURING"`, ela passa a mostrar uma badge própria — `Em nutrição`, com
  `Snowflake` de 3.5, em cor neutra (`variant="outline"` + `text-muted-foreground`) — em vez daquelas
  duas. O estado do lead manda; o do negócio é detalhe.
- Nas ações da linha, antes do editar: `NurtureDialog` (quando `ACTIVE`) ou `ReactivateDialog`
  (quando `NURTURING`), com `Button variant="ghost" size="icon-sm"`, ícone `Snowflake` ou
  `Sun`/`RotateCcw`, e `aria-label` dizendo o que faz ("Enviar {nome} para nutrição" / "Reativar {nome}").

- [ ] **Step 2: Banner no perfil do lead**

`app/(app)/clients/[id]/nurture-banner.tsx` — renderiza `null` quando `client.status !== "NURTURING"`.
Quando em nutrição, um bloco `rounded-lg border bg-muted/40 p-4` com:

- ícone `Snowflake` e o título "Em nutrição"
- o motivo (`nurtureReasonLabels`) e o `nurtureNote` quando houver
- "Parado há {formatDistanceToNow(parseISO(nurturedAt))}" e "Retomar em {data}" (ou "sem data
  definida"), com destaque de vencido pela mesma regra da tela
- dois botões: `ReschedulePopover` ("Reagendar") e `ReactivateDialog` ("Retomar contato")

Props: `{ client: Client }`. Montar em `app/(app)/clients/[id]/page.tsx` logo abaixo do `LeadHeader`.

- [ ] **Step 3: Card no dashboard**

Em `app/(app)/dashboard/page.tsx`, a grade de KPIs passa de 4 para 5 cards. Troque
`lg:grid-cols-4` por `lg:grid-cols-5` e acrescente:

```tsx
        <StatCard
          label="Em nutrição"
          value={stats?.kpis.nurturing}
          icon={Snowflake}
          color="var(--chart-5)"
          isLoading={loading}
        />
```

Envolva o card num `Link href="/nurturing"` (o `StatCard` não tem prop de link; use
`<Link className="contents">` para não alterar o layout da grade).

O "a retomar" **não** vai no `label` — o `label` já tem `truncate` e a frase seria cortada. Em vez
disso, `app/(app)/dashboard/stat-card.tsx` ganha uma prop opcional:

```tsx
export const StatCard = ({ label, value, icon: Icon, color, isLoading, hint }: {
  …
  hint?: string;
}) => …
```

renderizada logo abaixo do valor, e só quando existir:

```tsx
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
```

No card novo: `hint={stats?.kpis.nurtureDue ? `${stats.kpis.nurtureDue} a retomar` : undefined}`.
Aditivo — os outros quatro cards não passam `hint` e continuam idênticos.

Acrescente o `app/(app)/dashboard/stat-card.tsx` ao `git add` do Step 7.

- [ ] **Step 4: Ação na linha de nutrição da agenda**

A Task 2 deixou a linha `NURTURE` da agenda sem ação. Agora acrescente o `ReactivateDialog` com o
botão "Retomar contato", no mesmo bloco `ml-auto` das ações da linha de atividade.

O `ReactivateDialog` precisa de `{ id, name }`; o `payload` da agenda tem `clientId` e `clientName`.

- [ ] **Step 5: Verificar que compila**

```bash
pnpm typecheck
pnpm lint
pnpm build
```

- [ ] **Step 6: QA visual das quatro superfícies**

Com a tool MCP `screenshot`, `capture_console: true`:

1. `http://localhost:3000/clients` — os três chips; em **Ativos**, o lead nutrido **não** aparece; em
   **Em nutrição**, aparece com a badge própria.
2. `http://localhost:3000/clients/<id do lead nutrido>` — o banner com motivo, "parado há" e
   "retomar em", e os dois botões. (O controller informa o id no despacho.)
3. `http://localhost:3000/dashboard` — cinco cards na grade, "Em nutrição" com número, sem quebra de
   layout no `viewports: ["mobile", "desktop"]`.
4. `http://localhost:3000/agenda` — a linha de nutrição agora com o botão de retomar.

Cole no relatório o que viu em cada uma.

- [ ] **Step 7: Commit**

```bash
git add eloscrm-web/app/\(app\)/clients eloscrm-web/app/\(app\)/dashboard/page.tsx eloscrm-web/app/\(app\)/agenda/page.tsx
git commit -m "feat: expõe o estado de nutrição nas telas existentes"
```

---

## Cobertura da spec

| Requisito da spec | Tarefa |
|---|---|
| §4.1 tela `/nurturing`, chips mutuamente exclusivos, colunas | 5 |
| §4.1 ações por linha — Retomar contato e Reagendar na Task 5; **Editar motivo escapou do plano** e entrou na onda de correções da revisão final | 5 + correção |
| §4.2 as três entradas (mover / adicionar / linkar) | 5 (adicionar, linkar) e 6 (mover) |
| §4.3 diálogo de nutrição, presets de data, destino dos negócios | 3 |
| §4.4 diálogo de reativação, nada marcado por padrão | 4 |
| §4.5 sidebar | 5 |
| §4.5 `/clients` (chip + badge), `/clients/[id]` (banner), `/dashboard` (card) | 6 |
| §4.5 `/agenda` renderiza os dois `kind` com ação de retomar | 2 (render) e 6 (ação) |
| §4.5 `labels.ts` e `types.ts` | 1 |
| §4.5 os cinco consumidores de `useClients()` sem filtro | 2 |
| §7 as duas telas que filtram por `activity.dueAt` | 2 |
| §8 `note` recusa `""`; data no fim do dia local | 3 (e 5, no reagendar) |

## Fora de escopo

Continua valendo o §7 da spec: ações em massa, reengajamento automático por imóvel compatível,
disparo de e-mail/WhatsApp e estado `DESCARTADO`. Os débitos técnicos do §8 que são da API
(`$transaction`, `PATCH` aceitando campos de nutrição em lead ativo, `.max(50)` em `deals`) não são
deste plano.

> Criado em 2026-07-30 17:31 (-03) · Última modificação: 2026-07-30 17:31 (-03)

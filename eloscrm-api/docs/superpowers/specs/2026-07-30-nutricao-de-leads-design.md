# Nutrição de Leads — Spec de Design

> Estado de workflow para o lead que **não está interessado agora, mas volta**: sai da lista de
> trabalho, guarda o motivo, agenda a retomada e reaparece na Agenda na data certa.

Estado de referência: commit `fe24b28` (`main`), árvore limpa.

---

## 1. O problema

Hoje o lead que disse "agora não" só tem três destinos, e nenhum serve:

| Destino atual | Por que não serve |
|---|---|
| Continuar na lista de `/clients` | Polui a lista de trabalho para sempre. Em seis meses o corretor não distingue quem é lead vivo de quem é lead adormecido. |
| Virar `temperature = FRIO` | Temperatura é **intensidade de interesse**, não estado de workflow: não tem data de retorno, não tem motivo estruturado, não tira ninguém de lista nenhuma e não muda métrica alguma. |
| Ser excluído | Perde histórico, negócios, comentários e anexos. Um lead que compra daqui a dois anos é o ativo mais barato que a imobiliária tem. |

E o buraco maior: **não existe mecanismo de retomada**. O lead adormecido depende da memória do
corretor. É exatamente o dado que um CRM deveria estar guardando.

### Temperatura e nutrição são eixos ortogonais

Vale explicitar porque a confusão é natural: um lead pode estar `QUENTE` **e** em nutrição — quem
comprou com o concorrente na semana passada tem interesse altíssimo e retomada em dois anos. Um lead
pode estar `FRIO` e ativo — está em atendimento, só não engajou ainda. Os dois campos convivem; nenhum
substitui o outro.

---

## 2. Modelo de dados

O estado mora no **`Client`**, não no `Stage`. O caso mais comum de "agora não" acontece antes de
existir negócio — logo depois do primeiro contato — e uma flag no estágio não teria onde guardá-lo.

```prisma
enum ClientStatus {
  ACTIVE
  NURTURING
}

enum NurtureReason {
  SEM_ORCAMENTO      // o valor não fecha
  ADIADO             // vai comprar, mas mais para frente
  SEM_RESPOSTA       // sumiu
  COMPROU_COM_OUTRO
  SO_PESQUISANDO
  OUTRO
}

model Client {
  // … campos atuais
  status        ClientStatus   @default(ACTIVE)
  nurtureReason NurtureReason?
  nurtureNote   String?        // detalhe livre do motivo
  nurtureUntil  DateTime?      // quando retomar; null = sem data definida
  nurturedAt    DateTime?      // quando entrou em nutrição

  @@index([organizationId, status, nurtureUntil])
}
```

**Decisões:**

- **`nurtureUntil` é opcional.** "Sem data definida" é um estado real — o corretor nem sempre sabe
  quando voltar. Forçar uma data produziria datas inventadas, que é pior que nenhuma.
- **`nurturedAt` é coluna, não derivado do `AuditEvent`.** A tela precisa de "parado há 3 meses" em
  toda linha da listagem; ir ao audit log para cada linha seria uma query por lead.
- **"Vencido" é derivado na leitura** (`nurtureUntil <= now`), nunca materializado. O projeto não tem
  scheduler em lugar nenhum e não vai ganhar um por causa disto: derivar custa zero infra e nunca
  fica desatualizado.
- **A data é gravada no fim do dia escolhido**, no fuso do usuário (23:59:59.999 em -03), e não à
  meia-noite. Com meia-noite UTC, um lead marcado "retomar hoje" apareceria como atrasado às 21h do
  dia anterior em Brasília. Quem monta o `Date` é o web, no date picker; a API só recebe `DateTime`.
- **Enum de dois valores, não boolean.** Casa com `LeadTemperature`/`PropertyStatus`, aparece legível
  no histórico via `formatAuditValue`, e abre espaço para um `DESCARTADO` futuro sem migração de tipo.

---

## 3. API

### 3.1 Duas rotas novas

Nutrir e reativar são **transações com efeito colateral em negócios**. Não cabem num `PATCH` de
campos soltos.

```
POST /v1/clients/:id/nurture
{
  reason: NurtureReason,
  note?: string,
  until?: string (date),          // ausente = sem data definida
  deals?: [{ dealId, action: "KEEP" | "CLOSE_LOST", lostStageId? }]   // default []
}
→ 200 Client
```

- `nurturedAt` é carimbado no servidor (`new Date()`), nunca aceito do cliente.
- `deals` precisa cobrir **todos** os negócios abertos do lead; negócio aberto faltando na lista →
  422. Isso força a UI a mostrar a consequência em vez de decidir escondido. Lead sem negócio aberto
  omite o campo.
- `CLOSE_LOST` exige `lostStageId` de um estágio `isLost` **do pipeline daquele negócio** → senão 422.
  O fechamento passa por `deals.service.update`, então grava `STAGE_CHANGED` no audit normalmente.
- `lostReason` do negócio fechado = `nurtureNote` quando houver, senão o rótulo pt-BR do `reason`.
  Isso obriga um mapa `NURTURE_REASON_LABELS` **na API** (`modules/clients/`), não só no web — a API
  já escreve pt-BR em mensagem de erro, então não é precedente novo, mas é código que precisa existir
  dos dois lados e não pode ser esquecido.
- Lead já `NURTURING` → 409. Reagendar é `PATCH`, não é nutrir de novo.

```
POST /v1/clients/:id/reactivate
{ reopenDealIds?: string[] }
→ 200 Client
```

- Zera os quatro campos e volta `status = ACTIVE`.
- Cada id em `reopenDealIds` precisa ser um negócio perdido **daquele lead** → senão 422. O negócio
  volta ao primeiro estágio aberto do pipeline dele (`!isWon && !isLost`, menor `position`) com
  `lostReason: null`, também via `deals.service.update`.
- Pipeline sem estágio aberto → 422 naquele negócio.
- Lead já `ACTIVE` → 409.

### 3.2 Invariante de estado

`PATCH /v1/clients/:id` aceita **reagendar** (`nurtureUntil`, `nurtureReason`, `nurtureNote`) mas
**recusa `status`** e `nurturedAt` (campo não existe no schema Zod; Zod 4 em modo strip descarta, e o
serviço nunca os repassa). Consequência: não existe caminho que mude o estado sem passar pela regra
dos negócios. É a única invariante de segurança do módulo e vale um teste dedicado.

### 3.3 Mudança de comportamento em rota existente

**`GET /v1/clients` sem filtro passa a devolver só `status = ACTIVE`.**

É esse o valor da funcionalidade — tirar o lead adormecido da lista de trabalho. É também uma quebra
de contrato numa rota que já está em uso, então está nomeada aqui em vez de descoberta na
implementação. A query ganha:

- `status=ACTIVE | NURTURING | ALL` (default `ACTIVE`)
- `overdue=true` — só os vencidos (`status=NURTURING AND nurtureUntil <= now`); ignorado quando
  `status=ACTIVE`

`GET /v1/clients/:id` **não** filtra por status: o link direto para um lead nutrido tem que funcionar.

### 3.4 Agenda passa a ter duas fontes

`GET /v1/agenda` hoje devolve `Activity[]`. Passa a devolver uma lista discriminada, no mesmo idioma
que o módulo `timeline` já usa neste projeto:

```ts
type AgendaItem =
  | { kind: "ACTIVITY"; id: string; at: string; payload: Activity & { client, deal } }
  | { kind: "NURTURE";  id: string; at: string; payload: { clientId, clientName, phone, reason, note } }
```

`at` é `dueAt` para atividade e `nurtureUntil` para nutrição; a ordenação por `at` é feita no serviço
após o merge, como o `timeline.service` já faz. O `from`/`to` filtra as duas fontes.

Alternativa descartada: criar uma `Activity` espelho a cada nutrição. Daria agenda e timeline de
graça, mas duplicaria a data em dois lugares — editar num e não no outro dessincroniza, e filtrar
"vencidos" viraria join.

### 3.5 Dashboard

- `totalClients` passa a contar **só ativos** — senão o KPI de leads cresce para sempre com gente que
  não está sendo trabalhada.
- `bySource` (o donut de origem) também passa a contar só ativos. O teste atual já grava a invariante
  `soma(bySource) === totalClients`; contar bases diferentes nos dois quebraria o painel de forma
  silenciosa.
- KPI novo: `nurturing` (total em nutrição) e `nurtureDue` (a retomar / vencidos).
- `openDeals`, `openValue` e `funnel` **ficam como estão**. Se o corretor escolheu explicitamente
  manter o negócio no funil ao nutrir o lead, o negócio conta mesmo — o dashboard não pode contradizer
  a escolha que a própria UI ofereceu. Quem quer o funil limpo fecha os negócios no diálogo.

### 3.6 Auditoria

Nenhuma `AuditAction` nova. `nurture` e `reactivate` gravam `UPDATED` com o `changes` produzido pelo
`diffFields` sobre os quatro campos — que é exatamente o que a infraestrutura atual já faz para
qualquer coluna nova do `Client`. O fechamento/reabertura dos negócios audita sozinho, via
`deals.service`.

---

## 4. Web

### 4.1 Tela `/nurturing` — "Nutrição"

**Tabela com chips de filtro, não kanban.** Dropar um card numa coluna "Este mês" obrigaria a inventar
uma data arbitrária para o lead; a data de retomada é um dado real que o corretor escolhe, não um
efeito colateral de arrastar.

Chips, com contagem, **Atrasados** selecionado por padrão:

| Chip | Regra |
|---|---|
| Atrasados | `nurtureUntil <= hoje` |
| Esta semana | `nurtureUntil` dentro da semana corrente |
| Este mês | `nurtureUntil` dentro do mês corrente |
| Depois | `nurtureUntil` além do mês corrente |
| Sem data | `nurtureUntil = null` |
| Todos | — |

Os chips são **mutuamente exclusivos e avaliados nessa ordem**: um lead vencido cai em Atrasados e em
mais lugar nenhum, mesmo que a data seja desta semana. Semana começa na segunda (`date-fns` + `ptBR`),
como no resto do app.

Colunas: lead (avatar + nome, link para `/clients/[id]`) · motivo + detalhe · parado há · retomar em
(com destaque para vencido) · responsável · contato rápido (WhatsApp/telefone, o mesmo padrão do
`LeadHeader`).

Ações por linha: **Retomar contato** (abre o diálogo de reativação) · **Reagendar** (popover de data)
· **Editar motivo**.

### 4.2 As três entradas

Correspondem ao "adicionar / mover / linkar" do pedido:

- **Mover** — botão "Enviar para nutrição" no `LeadHeader` do lead e ação na linha de `/clients`.
- **Adicionar** — "Novo lead em nutrição" na tela de Nutrição: reusa o `ClientDialog` de criação e,
  no sucesso, encadeia o diálogo de nutrição com o lead recém-criado.
- **Linkar** — "Trazer lead existente": combobox de busca sobre os leads ativos, que abre o mesmo
  diálogo de nutrição.

Uma entrada nova de UI, dois reusos. O diálogo de nutrição é o único lugar que sabe a regra.

### 4.3 Diálogo de nutrição

1. **Motivo** — select de `NurtureReason`
2. **Detalhe** — textarea opcional
3. **Retomar em** — chips rápidos (30 / 60 / 90 dias / 6 meses / sem data) + date picker
4. **Negócios abertos** — só aparece se houver. Cada negócio com `Fechar como perdido` (select de
   estágio de perda do pipeline dele, pré-selecionado no primeiro `isLost`) ou `Manter no funil`.
   Pipeline sem estágio de perda desabilita a opção e explica, em vez de deixar o usuário submeter
   algo que a API vai recusar.

### 4.4 Diálogo de reativação

Confirmação + lista dos negócios **perdidos** do lead com checkbox para reabrir. Cada um reabre no
primeiro estágio aberto do pipeline dele. Nenhum marcado por padrão: reabrir negócio é decisão
consciente, não default.

### 4.5 Superfícies existentes que mudam

- **Sidebar** — item "Nutrição" (ícone `Snowflake`), entre Negociações e Agenda.
- **`/clients`** — chip de filtro "Em nutrição" (a listagem default agora os esconde) e badge própria
  na coluna Status.
- **`/clients/[id]`** — banner quando `status = NURTURING`: motivo, desde quando, retomada, e os
  botões Reativar / Reagendar.
- **`/agenda`** — renderiza os dois `kind`, o de nutrição com ícone e ação "Retomar contato".
- **`/dashboard`** — card "Em nutrição" com total e quantos a retomar, linkando para `/nurturing`.
- **`lib/labels.ts`** — `clientStatusLabels`, `nurtureReasonLabels`, entradas em `FIELD_LABELS` e
  branches em `formatAuditValue` para `status` e `nurtureReason`. Sem isso o histórico mostra
  `SEM_ORCAMENTO` cru na tela, como já aconteceria com qualquer enum novo.
- **`lib/types.ts`** — os enums e os quatro campos espelhados à mão, como manda o contrato entre os
  dois projetos.
- **Os cinco consumidores de `useClients()` sem filtro** — `app/(app)/deals/kanban-board.tsx`,
  `components/app/use-entity-names.ts`, `app/(app)/deals/deal-form.tsx`,
  `app/(app)/deals/deal-detail-dialog.tsx` e `components/app/activity-dialog.tsx` passam a pedir
  `status=ALL`: o default `ACTIVE` da Task 3 os esconderia, e o lead nutrido com negócio mantido no
  funil (o caminho `KEEP` da §3.5) precisa continuar resolvendo nome e continuar selecionável nesses
  lugares.

---

## 5. Testes

Mesma disciplina do resto da API: Postgres real, app inteiro de pé, sem mock.

`test/clients-nurture.test.ts`

- nutrir com data e sem data; `nurturedAt` carimbado pelo servidor
- listagem default exclui `NURTURING`; `status=NURTURING` traz; `status=ALL` traz os dois
- `overdue=true` traz só os vencidos, e não traz os sem data
- `PATCH /clients/:id` **não** muda `status` (a invariante)
- `PATCH` reagenda `nurtureUntil` e o histórico registra
- nutrir com `action=CLOSE_LOST` move o negócio para o estágio de perda e grava `lostReason`
- nutrir omitindo um negócio aberto → 422
- `CLOSE_LOST` com `lostStageId` de outro pipeline → 422
- nutrir lead já nutrido → 409
- reativar limpa os quatro campos e reabre só os negócios marcados
- reativar com `dealId` de outro lead → 422
- cross-tenant: nutrir/reativar lead de outra org → 404
- `GET /clients/:id` de lead nutrido continua 200

Ajustes nos arquivos existentes: `agenda` (item `NURTURE` dentro do range, e fora dele) e `dashboard`
(`totalClients` só ativos, KPIs novos).

---

## 6. Divisão em planos

Dois planos sequenciais, pela mesma linha que separa os dois projetos do repo:

- **A — API**: schema, `nurture`/`reactivate`, filtros de `GET /clients`, agenda com duas fontes,
  dashboard, e toda a suíte de testes. Entregável verificável sozinho (`pnpm test`).
- **B — Web**: tela `/nurturing`, os dois diálogos, as três entradas e as cinco superfícies
  existentes que mudam. Depende inteiramente de A.

---

## 7. Fora de escopo (nomeado, não esquecido)

- **Ações em massa** (reagendar/reativar vários de uma vez) — só vale a pena quando a base de nutrição
  passar de algumas dezenas
- **Reengajamento automático** quando entra imóvel compatível com `interestType`/`budget` do lead — é
  um subsistema de matching, não um campo
- **Disparo de e-mail/WhatsApp** na data de retomada — exige provedor, template e fila
- **Estado `DESCARTADO`** definitivo, separado de nutrição — o enum já comporta, mas nada no fluxo
  atual pede
- **Cadência de nutrição** (sequência de toques ao longo do tempo, ao estilo de automação de
  marketing) — outro produto
- **Débito entre planos**: a agenda mudou de contrato (dois `kind`, nem toda atividade tem `dueAt`) e
  `app/(app)/agenda/page.tsx` e `app/(app)/dashboard/recent-activities-card.tsx` ainda filtram só por
  `activity.dueAt` — ficam em branco, sem erro, até o Plano B acompanhar.

---

## 8. Débitos conhecidos do Plano A

Achados da revisão final que não bloqueiam o merge, registrados para não virarem descoberta futura:

- **Sem `$transaction` nas escritas múltiplas.** `nurture` faz N `deals.update` + `updateNurtureState`
  + audit fora de transação; `reactivate` idem. A validação-antes-de-escrever cobre o caso realista
  (entrada inválida); uma falha de infra no meio deixaria negócios fechados com o lead ainda `ACTIVE`.
  Envolver chamadas de service em `$transaction` seria refatoração maior que o ganho.
- **`PATCH` grava campos de nutrição em lead `ACTIVE`.** O dado é inerte — agenda, listagem e painel
  filtram por `status = NURTURING` primeiro, e as duas transições sobrescrevem os quatro campos. Mas
  `GET /clients` devolve o objeto inteiro, então a UI poderia renderizar "retomar em" num lead ativo.
- **`overdue` é ignorado em silêncio com `status=ALL`**, não só em `ACTIVE`. É leitura defensável da
  §3.3, mas não devolve erro nem aviso.
- **`listClientsQuerySchema` fixa `["ACTIVE","NURTURING","ALL"]` na mão** em vez de derivar de
  `ClientStatus`, ao contrário de `source`/`temperature`. Quando o `DESCARTADO` da §2 chegar, será
  gravável e não consultável.
- **`note: z.string().min(1)`** recusa `""` com 422 — o textarea vazio do diálogo do Plano B tem que
  ser omitido do payload, não enviado vazio.
- **`deals` tem `.max(50)`**: um lead com mais de 50 negócios abertos torna `DEALS_NOT_COVERED`
  insatisfazível e não pode ser nutrido pela API.

> Criado em 2026-07-30 15:51 (-03) · Última modificação: 2026-07-30 17:20 (-03)

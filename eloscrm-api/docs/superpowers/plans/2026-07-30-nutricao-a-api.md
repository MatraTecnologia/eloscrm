# Nutrição de Leads — Plano A (API)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao `Client` um estado de workflow "em nutrição" com motivo, data de retomada e regra
explícita para os negócios abertos, mais os filtros, a agenda e os KPIs que esse estado exige.

**Architecture:** Quatro colunas novas no `Client` (`status`, `nurtureReason`, `nurtureNote`,
`nurtureUntil`, `nurturedAt`) e duas rotas de transição (`POST /v1/clients/:id/nurture` e
`/reactivate`) num módulo próprio, `src/modules/clients/nurture.service.ts`. O `PATCH` de cliente
continua existindo para reagendar, mas **não** muda `status` — assim não há caminho que pule a regra
dos negócios. "Vencido" é sempre derivado na leitura (`nurtureUntil <= now`); não existe scheduler.

**Tech Stack:** Fastify 5, Prisma 7 rust-free (client em `src/generated/prisma`, import relativo),
Zod 4, Vitest 4 contra Postgres real.

Spec: `docs/superpowers/specs/2026-07-30-nutricao-de-leads-design.md`.
Base: commit `f66c6ca` em `main`.

## Global Constraints

- **`const` arrow functions.** Nunca `function` declaration.
- **Sem `console.log`** em código entregue (`no-console` é regra do oxlint).
- **Nunca importar `@prisma/client`** em código autoral — só `../../generated/prisma/client.js`
  (import relativo, com sufixo `.js`, porque o projeto é NodeNext).
- **Camadas:** rota faz `schema.parse()` e chama o service; service recebe `orgId` como primeiro
  argumento e lança `notFound()`/`httpError()` de `lib/http-error.js`; **só o repo toca o `prisma`**,
  e toda query filtra `organizationId`. Exceção já existente no projeto: services que precisam de
  query cross-entidade usam `prisma` direto (ver `clients.service.remove`) — seguir esse precedente
  quando o dado não pertence ao repo do módulo.
- **Guards por arquivo de rota.** `app.addHook("preHandler", authGuard)` + `orgGuard`. Rota nova sem
  os dois fica aberta.
- **Envelope de erro** `{ error: { code, message, details? } }` — produzido pelo
  `plugins/error-handler.ts`. `ZodError` vira 422 `VALIDATION` automaticamente; erro de regra usa
  `httpError(status, "CODE", "mensagem em pt-BR")`.
- **Strings em pt-BR, identificadores em inglês.** Commits em português, imperativo.
- **Comentar só o "porquê" não-trivial.** Nada de docstring nem type annotation em código não tocado.
- **Testes usam Postgres real**, sem mock, com `makeApp()` + `signUpWithOrg()`. Cada arquivo cria a
  própria organização e usa um `stamp` único; **não** adicionar `deleteMany` em `afterAll` — a
  limpeza é global (`test/global-setup.ts`).
- **Verificação por tarefa:** `pnpm lint && pnpm typecheck && pnpm test <arquivo>` e conferir a saída
  real antes de commitar.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `prisma/schema.prisma` | `ClientStatus`, `NurtureReason`, 5 colunas no `Client`, índice | Modificar |
| `src/modules/clients/clients.schema.ts` | `status`/`overdue` na query; nurture fields no `PATCH` | Modificar |
| `src/modules/clients/clients.repo.ts` | filtros na listagem; `updateNurtureState` | Modificar |
| `src/modules/clients/nurture.schema.ts` | corpo de `nurture`/`reactivate` | **Criar** |
| `src/modules/clients/nurture.service.ts` | as duas transições + `NURTURE_REASON_LABELS` | **Criar** |
| `src/routes/v1/clients/index.ts` | as duas rotas novas | Modificar |
| `src/modules/agenda/agenda.repo.ts` | segunda fonte (`listNurtureDue`) | Modificar |
| `src/modules/agenda/agenda.service.ts` | merge das duas fontes em `AgendaItem[]` | Modificar |
| `src/modules/dashboard/dashboard.repo.ts` | contagens só de ativos + duas novas | Modificar |
| `src/modules/dashboard/dashboard.service.ts` | KPIs `nurturing`/`nurtureDue` | Modificar |
| `test/nurture-model.test.ts` | defaults e nulabilidade das colunas | **Criar** |
| `test/clients-nurture.test.ts` | filtros, invariante do PATCH, nurture/reactivate | **Criar** |
| `test/agenda.test.ts` | ajustar ao formato novo + item `NURTURE` | Modificar |
| `test/dashboard.test.ts` | ajustar `totalClients` + KPIs novos | Modificar |

`nurture.service.ts` fica separado de `clients.service.ts` de propósito: são transições com efeito em
outro módulo (negócios), e enfiá-las no service de CRUD tornaria o arquivo o dobro do tamanho com
duas responsabilidades diferentes.

---

## Task 1: Schema — enums e colunas de nutrição

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `test/nurture-model.test.ts` (criar)

**Interfaces:**
- Consumes: nada.
- Produces: enums `ClientStatus { ACTIVE, NURTURING }` e
  `NurtureReason { SEM_ORCAMENTO, ADIADO, SEM_RESPOSTA, COMPROU_COM_OUTRO, SO_PESQUISANDO, OUTRO }`
  em `src/generated/prisma/client.js`; campos `Client.status` (não-nulo, default `ACTIVE`),
  `Client.nurtureReason`, `Client.nurtureNote`, `Client.nurtureUntil`, `Client.nurturedAt`
  (todos nuláveis).

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/nurture-model.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ClientStatus, NurtureReason } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `nurture-m-${stamp}@eloscrm.test`, `nurture-m-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("modelo de nutrição", () => {
  it("nasce ACTIVE com os campos de nutrição vazios", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, name: "Lead recém-criado" },
    });

    expect(client.status).toBe(ClientStatus.ACTIVE);
    expect(client.nurtureReason).toBeNull();
    expect(client.nurtureNote).toBeNull();
    expect(client.nurtureUntil).toBeNull();
    expect(client.nurturedAt).toBeNull();
  });

  it("aceita o estado de nutrição completo e volta a zerar", async () => {
    const until = new Date("2026-12-31T23:59:59.999Z");
    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        name: "Lead em nutrição",
        status: ClientStatus.NURTURING,
        nurtureReason: NurtureReason.SEM_ORCAMENTO,
        nurtureNote: "Quer esperar a taxa cair",
        nurtureUntil: until,
        nurturedAt: new Date(),
      },
    });

    expect(client.status).toBe(ClientStatus.NURTURING);
    expect(client.nurtureReason).toBe(NurtureReason.SEM_ORCAMENTO);
    expect(client.nurtureUntil?.toISOString()).toBe(until.toISOString());

    const back = await prisma.client.update({
      where: { id: client.id },
      data: {
        status: ClientStatus.ACTIVE,
        nurtureReason: null,
        nurtureNote: null,
        nurtureUntil: null,
        nurturedAt: null,
      },
    });

    expect(back.status).toBe(ClientStatus.ACTIVE);
    expect(back.nurtureReason).toBeNull();
  });

  // nutrição e temperatura são eixos ortogonais: quem comprou com o concorrente ontem tem interesse
  // altíssimo e retomada em dois anos. Um campo não pode estar substituindo o outro.
  it("convive com temperature sem conflito", async () => {
    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        name: "Lead quente adormecido",
        temperature: "QUENTE",
        status: ClientStatus.NURTURING,
        nurtureReason: NurtureReason.COMPROU_COM_OUTRO,
      },
    });

    expect(client.temperature).toBe("QUENTE");
    expect(client.status).toBe(ClientStatus.NURTURING);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd eloscrm-api && pnpm vitest run test/nurture-model.test.ts
```

Esperado: FAIL na compilação — `ClientStatus` e `NurtureReason` não existem em
`src/generated/prisma/client.js`.

- [ ] **Step 3: Adicionar os enums ao schema**

Em `prisma/schema.prisma`, logo depois do bloco `enum LeadTemperature { … }`:

```prisma
enum ClientStatus {
  ACTIVE
  NURTURING
}

enum NurtureReason {
  SEM_ORCAMENTO
  ADIADO
  SEM_RESPOSTA
  COMPROU_COM_OUTRO
  SO_PESQUISANDO
  OUTRO
}
```

- [ ] **Step 4: Adicionar as colunas ao `Client`**

No `model Client`, logo depois de `budgetMax Decimal?` e antes de `deals Deal[]`:

```prisma
  // estado de workflow, ortogonal a `temperature`: sai da lista de trabalho e volta na data marcada
  status        ClientStatus   @default(ACTIVE)
  nurtureReason NurtureReason?
  nurtureNote   String?
  // null = sem data definida, que é um estado real: o corretor nem sempre sabe quando voltar
  nurtureUntil  DateTime?
  nurturedAt    DateTime?
```

E, junto do `@@index([organizationId])` já existente do `Client`, adicionar:

```prisma
  @@index([organizationId, status, nurtureUntil])
```

- [ ] **Step 5: Gerar o client e aplicar nos dois bancos**

```bash
cd eloscrm-api && pnpm db:generate && pnpm db:push && pnpm db:push:test
```

Esperado: `db:generate` termina com "Generated Prisma Client"; os dois `db:push` terminam com
"Your database is now in sync with your Prisma schema".

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
cd eloscrm-api && pnpm vitest run test/nurture-model.test.ts
```

Esperado: PASS, 3 testes.

- [ ] **Step 7: Commit**

```bash
git add eloscrm-api/prisma/schema.prisma eloscrm-api/test/nurture-model.test.ts
git commit -m "feat: adiciona estado de nutrição ao lead no schema"
```

---

## Task 2: `PATCH /clients/:id` reagenda, mas não muda status

**Files:**
- Modify: `eloscrm-api/src/modules/clients/clients.schema.ts`
- Test: `eloscrm-api/test/clients-nurture.test.ts` (criar)

**Interfaces:**
- Consumes: enums da Task 1.
- Produces: `updateClientSchema` aceita `nurtureReason`, `nurtureNote`, `nurtureUntil` (todos
  `.nullable().optional()`) e **descarta** `status`/`nurturedAt`. `UpdateClientInput` ganha esses
  três campos, `nurtureUntil` tipado como `Date`.

Zod 4 em modo *strip* (o default) descarta chave desconhecida em silêncio — é exatamente o
comportamento desejado: o `PATCH` ignora `status` e o lead continua no estado em que estava. Não é
preciso 422; o teste grava a invariante.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/clients-nurture.test.ts` com o cabeçalho abaixo (as próximas tarefas acrescentam blocos
`describe` neste mesmo arquivo):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ClientStatus, NurtureReason } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";

const createClient = async (name: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name },
  });
  return res.json() as { id: string; name: string };
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `nurture-${stamp}@eloscrm.test`, `nurture-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("PATCH de cliente e o estado de nutrição", () => {
  it("reagenda a retomada e registra no histórico", async () => {
    const client = await createClient("Lead a reagendar");
    await prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2026-09-01T23:59:59.999Z") },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: {
        nurtureUntil: "2026-11-30T23:59:59.999Z",
        nurtureReason: "ADIADO",
        nurtureNote: "Vai vender o apartamento antes",
      },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.nurtureUntil).toBe("2026-11-30T23:59:59.999Z");
    expect(updated.nurtureReason).toBe(NurtureReason.ADIADO);
    expect(updated.status).toBe(ClientStatus.NURTURING);

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: client.id, action: "UPDATED" },
    });
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0].changes as object)).toContain("nurtureUntil");
  });

  // a invariante do módulo: se o PATCH pudesse mexer no status, existiria um caminho que muda o
  // estado do lead sem passar pela regra dos negócios abertos
  it("ignora status no PATCH", async () => {
    const client = await createClient("Lead que tentaria burlar");
    await prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.NURTURING, nurturedAt: new Date() },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { status: "ACTIVE", nurturedAt: null, name: "Nome novo" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Nome novo");
    expect(res.json().status).toBe(ClientStatus.NURTURING);
    expect(res.json().nurturedAt).not.toBeNull();
  });

  it("limpa o motivo com null", async () => {
    const client = await createClient("Lead com motivo a limpar");
    await prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.NURTURING, nurtureReason: NurtureReason.OUTRO, nurtureNote: "x" },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { nurtureReason: null, nurtureNote: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nurtureReason).toBeNull();
    expect(res.json().nurtureNote).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts
```

Esperado: FAIL no primeiro teste — `nurtureUntil` volta `undefined` porque o schema atual descarta o
campo.

- [ ] **Step 3: Estender o `updateClientSchema`**

Em `src/modules/clients/clients.schema.ts`, trocar o import e o bloco do update:

```ts
import { ClientSource, LeadTemperature, NurtureReason } from "../../generated/prisma/client.js";
```

```ts
export const updateClientSchema = createClientSchema.partial().extend({
  // undefined é "campo não enviado no PATCH"; null é "limpar o campo" e o diffFields já conta como mudança
  description: z.string().nullable().optional(),
  interestType: z.string().nullable().optional(),
  budgetMin: z.number().nonnegative().nullable().optional(),
  budgetMax: z.number().nonnegative().nullable().optional(),
  // reagendar a retomada é PATCH; entrar e sair da nutrição é POST /nurture e /reactivate. `status`
  // e `nurturedAt` ficam fora de propósito — o Zod descarta em silêncio e não existe caminho que
  // mude o estado do lead sem passar pela regra dos negócios abertos.
  nurtureReason: z.enum(NurtureReason).nullable().optional(),
  nurtureNote: z.string().nullable().optional(),
  nurtureUntil: z.coerce.date().nullable().optional(),
});
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts
```

Esperado: PASS, 3 testes.

- [ ] **Step 5: Lint e typecheck**

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck
```

Esperado: sem erro nos dois.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/modules/clients/clients.schema.ts eloscrm-api/test/clients-nurture.test.ts
git commit -m "feat: permite reagendar a nutrição pelo PATCH de cliente"
```

---

## Task 3: `GET /clients` esconde os nutridos por padrão

**Files:**
- Modify: `eloscrm-api/src/modules/clients/clients.schema.ts`
- Modify: `eloscrm-api/src/modules/clients/clients.repo.ts`
- Test: `eloscrm-api/test/clients-nurture.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: enums da Task 1.
- Produces: `listClientsQuerySchema` ganha `status: "ACTIVE" | "NURTURING" | "ALL"` (default
  `"ACTIVE"`) e `overdue: boolean | undefined`. `ListClientsQuery` reflete os dois.

**Atenção — quebra de contrato deliberada:** depois desta tarefa, `GET /v1/clients` sem query devolve
só ativos. É o valor central da funcionalidade (tirar o adormecido da lista de trabalho) e está
nomeado na spec §3.3. Nenhum teste existente de `clients` quebra, porque nenhum deles nutre um lead.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `test/clients-nurture.test.ts`:

```ts
describe("listagem de clientes por status", () => {
  let ativo = { id: "", name: "" };
  let nutridoVencido = { id: "", name: "" };
  let nutridoFuturo = { id: "", name: "" };
  let nutridoSemData = { id: "", name: "" };

  beforeAll(async () => {
    ativo = await createClient(`Ativo ${stamp}`);
    nutridoVencido = await createClient(`Vencido ${stamp}`);
    nutridoFuturo = await createClient(`Futuro ${stamp}`);
    nutridoSemData = await createClient(`Sem data ${stamp}`);

    await prisma.client.update({
      where: { id: nutridoVencido.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2020-01-01T00:00:00.000Z") },
    });
    await prisma.client.update({
      where: { id: nutridoFuturo.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2099-01-01T00:00:00.000Z") },
    });
    await prisma.client.update({
      where: { id: nutridoSemData.id },
      data: { status: ClientStatus.NURTURING },
    });
  });

  const list = async (query: string) => {
    const res = await app.inject({ method: "GET", url: `/v1/clients${query}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { id: string }[]).map((c) => c.id);
  };

  it("sem filtro devolve só os ativos", async () => {
    const ids = await list("");
    expect(ids).toContain(ativo.id);
    expect(ids).not.toContain(nutridoVencido.id);
    expect(ids).not.toContain(nutridoFuturo.id);
    expect(ids).not.toContain(nutridoSemData.id);
  });

  it("status=NURTURING devolve só os nutridos", async () => {
    const ids = await list("?status=NURTURING");
    expect(ids).not.toContain(ativo.id);
    expect(ids).toContain(nutridoVencido.id);
    expect(ids).toContain(nutridoFuturo.id);
    expect(ids).toContain(nutridoSemData.id);
  });

  it("status=ALL devolve os dois", async () => {
    const ids = await list("?status=ALL");
    expect(ids).toContain(ativo.id);
    expect(ids).toContain(nutridoFuturo.id);
  });

  it("overdue=true traz só os vencidos, e não os sem data", async () => {
    const ids = await list("?status=NURTURING&overdue=true");
    expect(ids).toContain(nutridoVencido.id);
    expect(ids).not.toContain(nutridoFuturo.id);
    expect(ids).not.toContain(nutridoSemData.id);
  });

  // "false" é string com valor booleano true em JS; z.coerce.boolean() aqui devolveria todo mundo
  // como vencido. O parse é explícito por causa disso.
  it("overdue=false não filtra nada", async () => {
    const ids = await list("?status=NURTURING&overdue=false");
    expect(ids).toContain(nutridoFuturo.id);
    expect(ids).toContain(nutridoSemData.id);
  });

  it("busca por nome continua funcionando junto do status", async () => {
    const ids = await list(`?status=NURTURING&q=Vencido ${stamp}`);
    expect(ids).toEqual([nutridoVencido.id]);
  });

  it("GET /clients/:id de lead nutrido continua 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${nutridoFuturo.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(ClientStatus.NURTURING);
  });
});
```

Acrescentar `beforeAll` ao import do vitest no topo do arquivo se ainda não estiver lá (está — o
cabeçalho da Task 2 já importa).

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts -t "sem filtro devolve só os ativos"
```

Esperado: FAIL — a lista atual devolve todos, então `toContain(nutridoVencido.id)` não é falso.

- [ ] **Step 3: Estender a query schema**

Em `src/modules/clients/clients.schema.ts`:

```ts
export const listClientsQuerySchema = z.object({
  source: z.enum(ClientSource).optional(),
  ownerId: z.string().optional(),
  q: z.string().optional(),
  temperature: z.enum(LeadTemperature).optional(),
  tag: z.string().optional(),
  // default ACTIVE: a listagem é a lista de trabalho e o lead em nutrição não pertence a ela
  status: z.enum(["ACTIVE", "NURTURING", "ALL"]).default("ACTIVE"),
  // z.coerce.boolean() leria a string "false" como true — todo mundo viraria vencido
  overdue: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
```

- [ ] **Step 4: Aplicar os filtros no repo**

Em `src/modules/clients/clients.repo.ts`, dentro de `listClients`, depois da linha
`const where: Prisma.ClientWhereInput = { organizationId: orgId };`:

```ts
  if (filters.status !== "ALL") where.status = filters.status;
  // vencido só faz sentido dentro da nutrição: em ACTIVE/ALL o campo é nulo e o filtro esvaziaria a lista
  if (filters.overdue && filters.status === "NURTURING") where.nurtureUntil = { lte: new Date() };
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts
```

Esperado: PASS, 10 testes.

- [ ] **Step 6: Rodar a suíte inteira — a mudança é de contrato**

```bash
cd eloscrm-api && pnpm test
```

Esperado: todos passando. Se algum teste de `clients`, `dashboard` ou `seed-org` quebrar, é porque
dependia da listagem trazer tudo; corrigir passando `?status=ALL` nele.

- [ ] **Step 7: Commit**

```bash
git add eloscrm-api/src/modules/clients/clients.schema.ts eloscrm-api/src/modules/clients/clients.repo.ts eloscrm-api/test/clients-nurture.test.ts
git commit -m "feat: filtra clientes por status de nutrição na listagem"
```

---

## Task 4: `POST /clients/:id/nurture` — lead sem negócio aberto

**Files:**
- Create: `eloscrm-api/src/modules/clients/nurture.schema.ts`
- Create: `eloscrm-api/src/modules/clients/nurture.service.ts`
- Modify: `eloscrm-api/src/modules/clients/clients.repo.ts`
- Modify: `eloscrm-api/src/routes/v1/clients/index.ts`
- Test: `eloscrm-api/test/clients-nurture.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `ClientStatus`/`NurtureReason` (Task 1); `clients.service.getById(orgId, id)`;
  `recordAudit`/`diffFields` de `lib/audit.js`; `httpError`/`notFound` de `lib/http-error.js`.
- Produces:
  - `nurtureSchema` / `NurtureInput` — `{ reason: NurtureReason; note?: string; until?: Date; deals?: { dealId: string; action: "KEEP" | "CLOSE_LOST"; lostStageId?: string }[] }`
  - `NURTURE_REASON_LABELS: Record<NurtureReason, string>`
  - `nurture(orgId: string, id: string, data: NurtureInput, actor: Actor): Promise<Client>`
  - `clients.repo.updateNurtureState(id, data: NurtureState)` onde
    `NurtureState = { status: ClientStatus; nurtureReason: NurtureReason | null; nurtureNote: string | null; nurtureUntil: Date | null; nurturedAt: Date | null }`

A validação dos negócios entra na Task 5. Aqui o caminho é o lead sem negócio aberto, que é o caso
mais comum e o que define a forma da transição.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `test/clients-nurture.test.ts`:

```ts
describe("POST /clients/:id/nurture", () => {
  it("bloqueia sem sessão (401)", async () => {
    const client = await createClient("Lead sem sessão");
    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      payload: { reason: "ADIADO" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("nutre com data e carimba nurturedAt no servidor", async () => {
    const client = await createClient("Lead a nutrir com data");
    const antes = Date.now();

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "SEM_ORCAMENTO",
        note: "Espera a taxa cair",
        until: "2026-12-31T23:59:59.999Z",
        // nurturedAt é do servidor: mandar aqui não pode ter efeito nenhum
        nurturedAt: "1999-01-01T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe(ClientStatus.NURTURING);
    expect(updated.nurtureReason).toBe(NurtureReason.SEM_ORCAMENTO);
    expect(updated.nurtureNote).toBe("Espera a taxa cair");
    expect(updated.nurtureUntil).toBe("2026-12-31T23:59:59.999Z");
    expect(new Date(updated.nurturedAt).getTime()).toBeGreaterThanOrEqual(antes);
  });

  it("nutre sem data (sem data definida é estado válido)", async () => {
    const client = await createClient("Lead a nutrir sem data");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "SEM_RESPOSTA" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nurtureUntil).toBeNull();
    expect(res.json().nurtureNote).toBeNull();
  });

  it("registra a transição no histórico", async () => {
    const client = await createClient("Lead auditado ao nutrir");
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "SO_PESQUISANDO" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: client.id, action: "UPDATED" },
    });
    expect(events).toHaveLength(1);
    const changes = events[0].changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.status).toEqual({ from: "ACTIVE", to: "NURTURING" });
    expect(changes.nurtureReason.to).toBe("SO_PESQUISANDO");
  });

  it("recusa nutrir um lead já nutrido (409)", async () => {
    const client = await createClient("Lead nutrido duas vezes");
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ALREADY_NURTURING");
  });

  it("recusa motivo inválido (422)", async () => {
    const client = await createClient("Lead com motivo inválido");
    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "PORQUE_SIM" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("não nutre lead de outra organização (404)", async () => {
    const { cookie: cookieB } = await signUpWithOrg(
      app,
      `nurture-b-${stamp}@eloscrm.test`,
      `nurture-b-${stamp}`,
    );
    const client = await createClient("Lead da org A");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie: cookieB },
      payload: { reason: "ADIADO" },
    });

    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts -t "nutre com data"
```

Esperado: FAIL com 404 — a rota não existe.

- [ ] **Step 3: Criar `nurture.schema.ts`**

```ts
import * as z from "zod";
import { NurtureReason } from "../../generated/prisma/client.js";

// `deals` é a decisão explícita sobre cada negócio aberto do lead. Omitido = lead sem negócio aberto;
// a validação de cobertura fica no service, que é quem sabe quais negócios existem.
const dealDecisionSchema = z.object({
  dealId: z.string().min(1),
  action: z.enum(["KEEP", "CLOSE_LOST"]),
  lostStageId: z.string().min(1).optional(),
});

export const nurtureSchema = z.object({
  reason: z.enum(NurtureReason),
  note: z.string().min(1).optional(),
  until: z.coerce.date().optional(),
  deals: z.array(dealDecisionSchema).max(50).optional(),
});

export const reactivateSchema = z.object({
  reopenDealIds: z.array(z.string().min(1)).max(50).optional(),
});

export type NurtureInput = z.infer<typeof nurtureSchema>;
export type ReactivateInput = z.infer<typeof reactivateSchema>;
export type DealDecision = z.infer<typeof dealDecisionSchema>;
```

- [ ] **Step 4: Adicionar `updateNurtureState` ao repo**

Ao fim de `src/modules/clients/clients.repo.ts`:

```ts
// os campos de nutrição não passam pelo UpdateClientInput de propósito (o PATCH não pode mexer em
// `status`), então a escrita do estado tem a própria porta no repo
export type NurtureState = {
  status: ClientStatus;
  nurtureReason: NurtureReason | null;
  nurtureNote: string | null;
  nurtureUntil: Date | null;
  nurturedAt: Date | null;
};

export const updateNurtureState = (id: string, data: NurtureState) =>
  prisma.client.update({ where: { id }, data });
```

E no import do topo do arquivo:

```ts
import type { ClientStatus, NurtureReason, Prisma } from "../../generated/prisma/client.js";
```

- [ ] **Step 5: Criar `nurture.service.ts`**

```ts
import { AuditAction, AuditEntity, ClientStatus, NurtureReason } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { httpError } from "../../lib/http-error.js";
import * as repo from "./clients.repo.js";
import { getById } from "./clients.service.js";
import type { NurtureInput } from "./nurture.schema.js";

// o lostReason do negócio fechado vai para o banco e para a tela; sem este mapa gravaria SEM_ORCAMENTO cru
export const NURTURE_REASON_LABELS: Record<NurtureReason, string> = {
  SEM_ORCAMENTO: "Orçamento não fecha",
  ADIADO: "Vai comprar mais para frente",
  SEM_RESPOSTA: "Sem resposta",
  COMPROU_COM_OUTRO: "Comprou com outro",
  SO_PESQUISANDO: "Só pesquisando",
  OUTRO: "Outro motivo",
};

export const nurture = async (orgId: string, id: string, data: NurtureInput, actor: Actor) => {
  const client = await getById(orgId, id);
  if (client.status === ClientStatus.NURTURING) {
    throw httpError(409, "ALREADY_NURTURING", "Este lead já está em nutrição");
  }

  const state = {
    status: ClientStatus.NURTURING,
    nurtureReason: data.reason,
    nurtureNote: data.note ?? null,
    nurtureUntil: data.until ?? null,
    // carimbo do servidor: "parado há quanto tempo" não pode ser escolhido por quem chama
    nurturedAt: new Date(),
  };

  const updated = await repo.updateNurtureState(id, state);
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(client, state),
  });
  return updated;
};
```

- [ ] **Step 6: Registrar a rota**

Em `src/routes/v1/clients/index.ts`, adicionar aos imports:

```ts
import { nurtureSchema } from "../../../modules/clients/nurture.schema.js";
import * as nurtureService from "../../../modules/clients/nurture.service.js";
```

E, depois do `app.patch("/:id", …)`:

```ts
  app.post("/:id/nurture", async (request) => {
    const { id } = request.params as { id: string };
    const data = nurtureSchema.parse(request.body);
    return nurtureService.nurture(request.orgId!, id, data, actorOf(request));
  });
```

- [ ] **Step 7: Rodar e confirmar que passa**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts
```

Esperado: PASS, 17 testes.

- [ ] **Step 8: Lint e typecheck**

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck
```

- [ ] **Step 9: Commit**

```bash
git add eloscrm-api/src/modules/clients/nurture.schema.ts eloscrm-api/src/modules/clients/nurture.service.ts eloscrm-api/src/modules/clients/clients.repo.ts eloscrm-api/src/routes/v1/clients/index.ts eloscrm-api/test/clients-nurture.test.ts
git commit -m "feat: adiciona a transição de nutrição do lead"
```

---

## Task 5: Nutrir decidindo o destino dos negócios abertos

**Files:**
- Modify: `eloscrm-api/src/modules/clients/nurture.service.ts`
- Test: `eloscrm-api/test/clients-nurture.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `deals.service.update(orgId, id, data, actor)` (já grava `STAGE_CHANGED` sozinho);
  `NURTURE_REASON_LABELS` da Task 4.
- Produces: `nurture` passa a validar tudo **antes** de escrever qualquer coisa e a fechar os
  negócios marcados. Códigos de erro novos: `DEALS_NOT_COVERED`, `DEAL_NOT_OPEN`,
  `INVALID_LOST_STAGE` — todos 422.

A ordem importa: validar todos os negócios primeiro, só então mutar. Se a validação do terceiro
negócio falhasse depois de fechar os dois primeiros, o lead ficaria meio nutrido, com dois negócios
perdidos e nenhuma forma de desfazer.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `test/clients-nurture.test.ts`. Primeiro, no `beforeAll` do topo do arquivo,
guardar o pipeline da org (adicionar as variáveis `pipelineId`, `openStageId`, `lostStageId` junto das
outras declarações no topo):

```ts
let pipelineId = "";
let openStageId = "";
let lostStageId = "";
```

e ao fim do `beforeAll` principal:

```ts
  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const pipeline = pipelines.json()[0] as {
    id: string;
    stages: { id: string; isWon: boolean; isLost: boolean; position: number }[];
  };
  pipelineId = pipeline.id;
  openStageId = pipeline.stages.find((s) => !s.isWon && !s.isLost)!.id;
  lostStageId = pipeline.stages.find((s) => s.isLost)!.id;
```

Depois, o `describe` novo:

```ts
describe("nutrir com negócios abertos", () => {
  const createDeal = async (clientId: string, title: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId, title, pipelineId, stageId: openStageId },
    });
    return res.json() as { id: string };
  };

  it("fecha como perdido e herda a nota como motivo", async () => {
    const client = await createClient("Lead com negócio a fechar");
    const deal = await createDeal(client.id, "Apartamento centro");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "SEM_ORCAMENTO",
        note: "Não fecha em nada abaixo de 600k",
        deals: [{ dealId: deal.id, action: "CLOSE_LOST", lostStageId }],
      },
    });

    expect(res.statusCode).toBe(200);
    const closed = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(closed.stageId).toBe(lostStageId);
    expect(closed.lostReason).toBe("Não fecha em nada abaixo de 600k");

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "DEAL", entityId: deal.id, action: "STAGE_CHANGED" },
    });
    expect(events).toHaveLength(1);
  });

  it("sem nota, o motivo do negócio vem do rótulo do reason", async () => {
    const client = await createClient("Lead sem nota");
    const deal = await createDeal(client.id, "Casa bairro alto");

    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "COMPROU_COM_OUTRO",
        deals: [{ dealId: deal.id, action: "CLOSE_LOST", lostStageId }],
      },
    });

    const closed = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(closed.lostReason).toBe("Comprou com outro");
  });

  it("KEEP deixa o negócio onde está", async () => {
    const client = await createClient("Lead com negócio mantido");
    const deal = await createDeal(client.id, "Sala comercial");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", deals: [{ dealId: deal.id, action: "KEEP" }] },
    });

    expect(res.statusCode).toBe(200);
    const kept = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(kept.stageId).toBe(openStageId);
    expect(kept.lostReason).toBeNull();
  });

  // a UI tem que mostrar a consequência; deixar passar em silêncio esconderia o efeito colateral
  it("recusa quando um negócio aberto ficou de fora (422)", async () => {
    const client = await createClient("Lead com negócio esquecido");
    const deal = await createDeal(client.id, "Terreno beira-rio");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEALS_NOT_COVERED");

    const untouched = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(untouched.status).toBe(ClientStatus.ACTIVE);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId).toBe(openStageId);
  });

  it("recusa decisão sobre negócio que não é do lead (422)", async () => {
    const client = await createClient("Lead alvo");
    const outro = await createClient("Lead vizinho");
    const dealDoOutro = await createDeal(outro.id, "Negócio do vizinho");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", deals: [{ dealId: dealDoOutro.id, action: "KEEP" }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEAL_NOT_OPEN");
  });

  it("recusa CLOSE_LOST sem lostStageId (422)", async () => {
    const client = await createClient("Lead sem estágio de perda");
    const deal = await createDeal(client.id, "Cobertura");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", deals: [{ dealId: deal.id, action: "CLOSE_LOST" }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_LOST_STAGE");
  });

  it("recusa lostStageId que não é estágio de perda (422)", async () => {
    const client = await createClient("Lead com estágio errado");
    const deal = await createDeal(client.id, "Kitnet");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        deals: [{ dealId: deal.id, action: "CLOSE_LOST", lostStageId: openStageId }],
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_LOST_STAGE");
  });

  it("negócio já perdido não precisa de decisão", async () => {
    const client = await createClient("Lead com negócio já perdido");
    const deal = await createDeal(client.id, "Negócio antigo");
    await app.inject({
      method: "PATCH",
      url: `/v1/deals/${deal.id}`,
      headers: { cookie },
      payload: { stageId: lostStageId },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts -t "recusa quando um negócio aberto ficou de fora"
```

Esperado: FAIL — hoje devolve 200 e nutre sem olhar para os negócios.

- [ ] **Step 3: Implementar a validação e o fechamento**

Reescrever `src/modules/clients/nurture.service.ts` na íntegra:

```ts
import { AuditAction, AuditEntity, ClientStatus, NurtureReason } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { httpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import * as deals from "../deals/deals.service.js";
import * as repo from "./clients.repo.js";
import { getById } from "./clients.service.js";
import type { NurtureInput } from "./nurture.schema.js";

// o lostReason do negócio fechado vai para o banco e para a tela; sem este mapa gravaria SEM_ORCAMENTO cru
export const NURTURE_REASON_LABELS: Record<NurtureReason, string> = {
  SEM_ORCAMENTO: "Orçamento não fecha",
  ADIADO: "Vai comprar mais para frente",
  SEM_RESPOSTA: "Sem resposta",
  COMPROU_COM_OUTRO: "Comprou com outro",
  SO_PESQUISANDO: "Só pesquisando",
  OUTRO: "Outro motivo",
};

const invalid = (code: string, message: string) => httpError(422, code, message);

const openDealsOf = (orgId: string, clientId: string) =>
  prisma.deal.findMany({
    where: { organizationId: orgId, clientId, stage: { isWon: false, isLost: false } },
    select: { id: true, pipelineId: true },
  });

export const nurture = async (orgId: string, id: string, data: NurtureInput, actor: Actor) => {
  const client = await getById(orgId, id);
  if (client.status === ClientStatus.NURTURING) {
    throw httpError(409, "ALREADY_NURTURING", "Este lead já está em nutrição");
  }

  const open = await openDealsOf(orgId, id);
  const decisions = data.deals ?? [];
  const byDealId = new Map(decisions.map((decision) => [decision.dealId, decision]));

  // validar tudo antes de escrever: falhar no meio deixaria o lead meio nutrido e negócios fechados
  // sem volta
  const uncovered = open.filter((deal) => !byDealId.has(deal.id));
  if (uncovered.length > 0) {
    throw invalid("DEALS_NOT_COVERED", "Decida o que fazer com os negócios abertos deste lead");
  }

  const openById = new Map(open.map((deal) => [deal.id, deal]));
  const toClose: { dealId: string; lostStageId: string }[] = [];
  for (const decision of decisions) {
    const deal = openById.get(decision.dealId);
    if (!deal) throw invalid("DEAL_NOT_OPEN", "Negócio não está aberto para este lead");
    if (decision.action !== "CLOSE_LOST") continue;
    if (!decision.lostStageId) throw invalid("INVALID_LOST_STAGE", "Escolha o estágio de perda");
    const stage = await prisma.stage.findFirst({
      where: {
        id: decision.lostStageId,
        organizationId: orgId,
        pipelineId: deal.pipelineId,
        isLost: true,
      },
      select: { id: true },
    });
    if (!stage) throw invalid("INVALID_LOST_STAGE", "Estágio de perda inválido para este negócio");
    toClose.push({ dealId: decision.dealId, lostStageId: decision.lostStageId });
  }

  const lostReason = data.note ?? NURTURE_REASON_LABELS[data.reason];
  for (const { dealId, lostStageId } of toClose) {
    // via deals.service: grava STAGE_CHANGED no histórico do negócio como qualquer outro movimento
    await deals.update(orgId, dealId, { stageId: lostStageId, lostReason }, actor);
  }

  const state = {
    status: ClientStatus.NURTURING,
    nurtureReason: data.reason,
    nurtureNote: data.note ?? null,
    nurtureUntil: data.until ?? null,
    // carimbo do servidor: "parado há quanto tempo" não pode ser escolhido por quem chama
    nurturedAt: new Date(),
  };

  const updated = await repo.updateNurtureState(id, state);
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(client, state),
  });
  return updated;
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts
```

Esperado: PASS, 25 testes.

- [ ] **Step 5: Lint e typecheck**

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/modules/clients/nurture.service.ts eloscrm-api/test/clients-nurture.test.ts
git commit -m "feat: decide o destino dos negócios abertos ao nutrir o lead"
```

---

## Task 6: `POST /clients/:id/reactivate`

**Files:**
- Modify: `eloscrm-api/src/modules/clients/nurture.service.ts`
- Modify: `eloscrm-api/src/routes/v1/clients/index.ts`
- Test: `eloscrm-api/test/clients-nurture.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `reactivateSchema`/`ReactivateInput` (Task 4); `deals.service.update`; e os helpers já
  criados na Task 5 dentro do próprio `nurture.service.ts` — `invalid(code, message)` (422) e os
  imports de `prisma`, `deals`, `repo`, `getById`, `httpError`, `recordAudit`, `diffFields`.
- Produces: `reactivate(orgId: string, id: string, data: ReactivateInput, actor: Actor): Promise<Client>`.
  Códigos novos: 409 `NOT_NURTURING`; 422 `DEAL_NOT_LOST` e `NO_OPEN_STAGE`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `test/clients-nurture.test.ts`:

```ts
describe("POST /clients/:id/reactivate", () => {
  const nutrirComNegocio = async (name: string, title: string) => {
    const client = await createClient(name);
    const dealRes = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title, pipelineId, stageId: openStageId },
    });
    const deal = dealRes.json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        until: "2026-12-31T23:59:59.999Z",
        deals: [{ dealId: deal.id, action: "CLOSE_LOST", lostStageId }],
      },
    });
    return { client, deal };
  };

  it("limpa os quatro campos e volta para ACTIVE", async () => {
    const { client } = await nutrirComNegocio("Lead a reativar", "Negócio a reabrir");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe(ClientStatus.ACTIVE);
    expect(updated.nurtureReason).toBeNull();
    expect(updated.nurtureNote).toBeNull();
    expect(updated.nurtureUntil).toBeNull();
    expect(updated.nurturedAt).toBeNull();
  });

  it("não reabre negócio nenhum por padrão", async () => {
    const { client, deal } = await nutrirComNegocio("Lead sem reabrir", "Negócio que fica perdido");

    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: {},
    });

    const still = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(still.stageId).toBe(lostStageId);
  });

  it("reabre o negócio marcado no primeiro estágio aberto e limpa o motivo da perda", async () => {
    const { client, deal } = await nutrirComNegocio("Lead com reabertura", "Negócio reaberto");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: { reopenDealIds: [deal.id] },
    });

    expect(res.statusCode).toBe(200);
    const reopened = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(reopened.stageId).toBe(openStageId);
    expect(reopened.lostReason).toBeNull();

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "DEAL", entityId: deal.id, action: "STAGE_CHANGED" },
    });
    // um ao fechar na nutrição, outro ao reabrir
    expect(events).toHaveLength(2);
  });

  it("registra a reativação no histórico do lead", async () => {
    const { client } = await nutrirComNegocio("Lead auditado ao reativar", "Negócio qualquer");

    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: {},
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: client.id, action: "UPDATED" },
      orderBy: { createdAt: "asc" },
    });
    const last = events[events.length - 1].changes as Record<string, { from: unknown; to: unknown }>;
    expect(last.status).toEqual({ from: "NURTURING", to: "ACTIVE" });
  });

  it("recusa reativar lead que não está em nutrição (409)", async () => {
    const client = await createClient("Lead já ativo");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NOT_NURTURING");
  });

  it("recusa reabrir negócio que não está perdido (422)", async () => {
    const client = await createClient("Lead com negócio aberto reaberto");
    const dealRes = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title: "Negócio mantido", pipelineId, stageId: openStageId },
    });
    const deal = dealRes.json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", deals: [{ dealId: deal.id, action: "KEEP" }] },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: { reopenDealIds: [deal.id] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEAL_NOT_LOST");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).status).toBe(
      ClientStatus.NURTURING,
    );
  });

  it("recusa reabrir negócio de outro lead (422)", async () => {
    const { client } = await nutrirComNegocio("Lead alvo da reativação", "Negócio próprio");
    const { deal: dealAlheio } = await nutrirComNegocio("Lead vizinho nutrido", "Negócio alheio");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: { reopenDealIds: [dealAlheio.id] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEAL_NOT_LOST");
  });

  it("não reativa lead de outra organização (404)", async () => {
    const { cookie: cookieC } = await signUpWithOrg(
      app,
      `nurture-c-${stamp}@eloscrm.test`,
      `nurture-c-${stamp}`,
    );
    const { client } = await nutrirComNegocio("Lead protegido", "Negócio protegido");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie: cookieC },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts -t "limpa os quatro campos"
```

Esperado: FAIL com 404 — a rota não existe.

- [ ] **Step 3: Implementar `reactivate`**

Acrescentar ao fim de `src/modules/clients/nurture.service.ts` (e incluir `ReactivateInput` no import
de tipos vindo de `./nurture.schema.js`):

```ts
export const reactivate = async (
  orgId: string,
  id: string,
  data: ReactivateInput,
  actor: Actor,
) => {
  const client = await getById(orgId, id);
  if (client.status !== ClientStatus.NURTURING) {
    throw httpError(409, "NOT_NURTURING", "Este lead não está em nutrição");
  }

  const reopenIds = data.reopenDealIds ?? [];
  // mesma ordem da nutrição: validar tudo antes de mexer em qualquer negócio
  const targets: { dealId: string; stageId: string }[] = [];
  for (const dealId of reopenIds) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, organizationId: orgId, clientId: id, stage: { isLost: true } },
      select: { id: true, pipelineId: true },
    });
    if (!deal) throw invalid("DEAL_NOT_LOST", "Só um negócio perdido deste lead pode ser reaberto");
    const stage = await prisma.stage.findFirst({
      where: { organizationId: orgId, pipelineId: deal.pipelineId, isWon: false, isLost: false },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (!stage) throw invalid("NO_OPEN_STAGE", "O pipeline deste negócio não tem estágio aberto");
    targets.push({ dealId, stageId: stage.id });
  }

  for (const { dealId, stageId } of targets) {
    await deals.update(orgId, dealId, { stageId, lostReason: null }, actor);
  }

  const state = {
    status: ClientStatus.ACTIVE,
    nurtureReason: null,
    nurtureNote: null,
    nurtureUntil: null,
    nurturedAt: null,
  };

  const updated = await repo.updateNurtureState(id, state);
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(client, state),
  });
  return updated;
};
```

- [ ] **Step 4: Registrar a rota**

Em `src/routes/v1/clients/index.ts`, trocar o import do schema por:

```ts
import { nurtureSchema, reactivateSchema } from "../../../modules/clients/nurture.schema.js";
```

E, depois do `app.post("/:id/nurture", …)`:

```ts
  app.post("/:id/reactivate", async (request) => {
    const { id } = request.params as { id: string };
    const data = reactivateSchema.parse(request.body ?? {});
    return nurtureService.reactivate(request.orgId!, id, data, actorOf(request));
  });
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd eloscrm-api && pnpm vitest run test/clients-nurture.test.ts
```

Esperado: PASS, 33 testes.

- [ ] **Step 6: Lint e typecheck**

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add eloscrm-api/src/modules/clients/nurture.service.ts eloscrm-api/src/routes/v1/clients/index.ts eloscrm-api/test/clients-nurture.test.ts
git commit -m "feat: reativa o lead em nutrição e reabre os negócios escolhidos"
```

---

## Task 7: Agenda com duas fontes

**Files:**
- Modify: `eloscrm-api/src/modules/agenda/agenda.repo.ts`
- Modify: `eloscrm-api/src/modules/agenda/agenda.service.ts`
- Test: `eloscrm-api/test/agenda.test.ts` (ajustar os existentes + acrescentar)

**Interfaces:**
- Consumes: `ClientStatus` (Task 1).
- Produces: `GET /v1/agenda` devolve `AgendaItem[]`, ordenado por `at` **crescente**:

```ts
type AgendaItem =
  | { kind: "ACTIVITY"; id: string; at: Date; payload: Activity & { client, deal } }
  | { kind: "NURTURE"; id: string; at: Date;
      payload: { clientId, clientName, phone, reason, note } };
```

**Quebra de contrato deliberada.** `test/agenda.test.ts` hoje lê `found.client` direto no item; passa
a ser `found.payload.client`. O `id` continua no topo do item, então os `map((a) => a.id)` dos testes
existentes seguem válidos.

- [ ] **Step 1: Ajustar os testes existentes de agenda**

Em `test/agenda.test.ts`, no teste "traz o cliente vinculado junto de cada atividade", trocar as duas
últimas linhas:

```ts
    const found = agenda.json().find((a: { id: string }) => a.id === activity.id);
    expect(found.kind).toBe("ACTIVITY");
    expect(found.payload.client).toEqual({ id: client.id, name: "Cliente da Agenda" });
    expect(found.payload.deal).toBeNull();
```

- [ ] **Step 2: Acrescentar o teste da segunda fonte**

Ao fim do `describe("agenda", …)` de `test/agenda.test.ts`:

```ts
  it("traz o lead a retomar dentro do range, com kind próprio", async () => {
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead a retomar", phone: "+5543999140409" },
    });
    const client = clientRes.json();

    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        note: "Volta depois da obra",
        until: "2026-11-20T23:59:59.999Z",
      },
    });

    const dentro = await app.inject({
      method: "GET",
      url: "/v1/agenda?from=2026-11-01T00:00:00.000Z&to=2026-11-30T23:59:59.000Z",
      headers: { cookie },
    });
    const item = dentro.json().find((i: { id: string }) => i.id === client.id);
    expect(item.kind).toBe("NURTURE");
    expect(item.payload.clientName).toBe("Lead a retomar");
    expect(item.payload.reason).toBe("ADIADO");
    expect(item.payload.note).toBe("Volta depois da obra");
    expect(item.at).toBe("2026-11-20T23:59:59.999Z");

    const fora = await app.inject({
      method: "GET",
      url: "/v1/agenda?from=2026-12-01T00:00:00.000Z&to=2026-12-31T23:59:59.000Z",
      headers: { cookie },
    });
    expect(fora.json().some((i: { id: string }) => i.id === client.id)).toBe(false);
  });

  it("não traz lead nutrido sem data de retomada", async () => {
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead sem data na agenda" },
    });
    const client = clientRes.json();
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "SEM_RESPOSTA" },
    });

    const res = await app.inject({ method: "GET", url: "/v1/agenda", headers: { cookie } });
    expect(res.json().some((i: { id: string }) => i.id === client.id)).toBe(false);
  });

  it("ordena as duas fontes juntas por data crescente", async () => {
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead da ordenação" },
    });
    const client = clientRes.json();
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", until: "2027-03-15T12:00:00.000Z" },
    });
    const activity = await createActivity(
      { cookie },
      "Ligação antes da retomada",
      new Date("2027-03-10T12:00:00.000Z").toISOString(),
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/agenda?from=2027-03-01T00:00:00.000Z&to=2027-03-31T23:59:59.000Z",
      headers: { cookie },
    });
    const ids = res.json().map((i: { id: string }) => i.id);
    expect(ids.indexOf(activity.id)).toBeLessThan(ids.indexOf(client.id));
  });
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
cd eloscrm-api && pnpm vitest run test/agenda.test.ts
```

Esperado: FAIL — `found.kind` é `undefined` e o item `NURTURE` não existe.

- [ ] **Step 4: Adicionar a segunda fonte ao repo**

Em `src/modules/agenda/agenda.repo.ts`, acrescentar ao fim (e trocar o import do topo por
`import { ClientStatus, type Prisma } from "../../generated/prisma/client.js";`):

```ts
export const listNurtureDue = (orgId: string, filters: ListAgendaQuery) => {
  const nurtureUntil: Prisma.DateTimeNullableFilter = { not: null };
  if (filters.from) nurtureUntil.gte = filters.from;
  if (filters.to) nurtureUntil.lte = filters.to;

  return prisma.client.findMany({
    where: { organizationId: orgId, status: ClientStatus.NURTURING, nurtureUntil },
    orderBy: { nurtureUntil: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      nurtureUntil: true,
      nurtureReason: true,
      nurtureNote: true,
    },
  });
};
```

- [ ] **Step 5: Fazer o merge no service**

Substituir `src/modules/agenda/agenda.service.ts` inteiro:

```ts
import * as repo from "./agenda.repo.js";
import type { ListAgendaQuery } from "./agenda.schema.js";

// mesma forma discriminada da timeline: a agenda passou a ter duas fontes (compromisso e lead a
// retomar) e o cliente precisa saber qual é qual sem adivinhar pelo formato do payload
type AgendaItem = {
  kind: "ACTIVITY" | "NURTURE";
  id: string;
  at: Date;
  payload: unknown;
};

export const list = async (orgId: string, filters: ListAgendaQuery) => {
  const [activities, nurtureDue] = await Promise.all([
    repo.listAgenda(orgId, filters),
    repo.listNurtureDue(orgId, filters),
  ]);

  const items: AgendaItem[] = [
    ...activities.map((activity) => ({
      kind: "ACTIVITY" as const,
      id: activity.id,
      at: activity.dueAt!,
      payload: activity,
    })),
    ...nurtureDue.map((client) => ({
      kind: "NURTURE" as const,
      id: client.id,
      at: client.nurtureUntil!,
      payload: {
        clientId: client.id,
        clientName: client.name,
        phone: client.phone,
        reason: client.nurtureReason,
        note: client.nurtureNote,
      },
    })),
  ];

  // crescente: a agenda olha para frente, ao contrário da timeline
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
};
```

- [ ] **Step 6: Rodar e confirmar que passa**

```bash
cd eloscrm-api && pnpm vitest run test/agenda.test.ts
```

Esperado: PASS, 7 testes.

- [ ] **Step 7: Lint, typecheck e suíte inteira**

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm test
```

Esperado: tudo passando.

- [ ] **Step 8: Commit**

```bash
git add eloscrm-api/src/modules/agenda/agenda.repo.ts eloscrm-api/src/modules/agenda/agenda.service.ts eloscrm-api/test/agenda.test.ts
git commit -m "feat: inclui os leads a retomar na agenda"
```

---

## Task 8: Dashboard conta só a base ativa

**Files:**
- Modify: `eloscrm-api/src/modules/dashboard/dashboard.repo.ts`
- Modify: `eloscrm-api/src/modules/dashboard/dashboard.service.ts`
- Test: `eloscrm-api/test/dashboard.test.ts`

**Interfaces:**
- Consumes: `ClientStatus` (Task 1); rota de nutrição (Task 4).
- Produces: `GET /v1/dashboard/stats` → `kpis` ganha `nurturing: number` e `nurtureDue: number`;
  `totalClients` e `bySource` passam a contar só `ACTIVE`.

`openDeals`/`openValue`/`funnel` **ficam como estão**. Se o corretor escolheu manter o negócio no
funil ao nutrir o lead, o negócio conta mesmo — o painel não pode contradizer a escolha que a própria
API ofereceu.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim do `describe` de `test/dashboard.test.ts`:

```ts
  it("tira o lead nutrido do total e o conta nos KPIs de nutrição", async () => {
    const { cookie: cookieN } = await signUpWithOrg(
      app,
      `dash-n-${stamp}@eloscrm.test`,
      `dash-n-${stamp}`,
    );
    await createClient({ cookie: cookieN }, "Ativo do painel", "SITE");
    const vencido = await createClient({ cookie: cookieN }, "Vencido do painel", "SITE");
    const futuro = await createClient({ cookie: cookieN }, "Futuro do painel", "INSTAGRAM");

    await app.inject({
      method: "POST",
      url: `/v1/clients/${vencido.id}/nurture`,
      headers: { cookie: cookieN },
      payload: { reason: "ADIADO", until: "2020-01-01T00:00:00.000Z" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/clients/${futuro.id}/nurture`,
      headers: { cookie: cookieN },
      payload: { reason: "ADIADO", until: "2099-01-01T00:00:00.000Z" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/dashboard/stats",
      headers: { cookie: cookieN },
    });
    const stats = res.json();

    expect(stats.kpis.totalClients).toBe(1);
    expect(stats.kpis.nurturing).toBe(2);
    expect(stats.kpis.nurtureDue).toBe(1);
    // bySource acompanha totalClients: contar bases diferentes quebraria o painel em silêncio
    expect(stats.bySource.SITE).toBe(1);
    expect(stats.bySource.INSTAGRAM).toBe(0);
    const sourceSum = (Object.values(stats.bySource) as number[]).reduce((a, b) => a + b, 0);
    expect(sourceSum).toBe(stats.kpis.totalClients);
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd eloscrm-api && pnpm vitest run test/dashboard.test.ts -t "tira o lead nutrido do total"
```

Esperado: FAIL — `totalClients` é 3 e `kpis.nurturing` é `undefined`.

- [ ] **Step 3: Filtrar as contagens no repo**

Em `src/modules/dashboard/dashboard.repo.ts`, adicionar o import e trocar as duas funções de cliente:

```ts
import { ClientStatus } from "../../generated/prisma/client.js";
```

```ts
// o painel mede a base que está sendo trabalhada; o lead em nutrição tem KPI próprio
export const countClients = (orgId: string) =>
  prisma.client.count({ where: { organizationId: orgId, status: ClientStatus.ACTIVE } });

export const countNurturing = (orgId: string) =>
  prisma.client.count({ where: { organizationId: orgId, status: ClientStatus.NURTURING } });

export const countNurtureDue = (orgId: string) =>
  prisma.client.count({
    where: {
      organizationId: orgId,
      status: ClientStatus.NURTURING,
      nurtureUntil: { lte: new Date() },
    },
  });
```

E em `clientSourceCounts`, trocar o `where`:

```ts
    where: { organizationId: orgId, status: ClientStatus.ACTIVE },
```

- [ ] **Step 4: Expor os KPIs no service**

Em `src/modules/dashboard/dashboard.service.ts`, trocar o `Promise.all` e o retorno:

```ts
  const [totalClients, totalDeals, stageAggregates, stages, sourceCounts, nurturing, nurtureDue] =
    await Promise.all([
      repo.countClients(orgId),
      repo.countDeals(orgId),
      repo.dealStageAggregates(orgId),
      repo.orgStagesWithPipeline(orgId),
      repo.clientSourceCounts(orgId),
      repo.countNurturing(orgId),
      repo.countNurtureDue(orgId),
    ]);
```

```ts
    kpis: { totalClients, totalDeals, openDeals, wonDeals, openValue, nurturing, nurtureDue },
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd eloscrm-api && pnpm vitest run test/dashboard.test.ts
```

Esperado: PASS. Se o teste antigo "agrega kpis, funil e origem coerentes" quebrar, é porque aquela
organização nutriu algum lead — ela não nutre, então deve continuar verde.

- [ ] **Step 6: Verificação final do plano A**

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm test
```

Esperado: `pnpm test` com todos os arquivos passando. Conferir a saída real, não presumir.

- [ ] **Step 7: Commit**

```bash
git add eloscrm-api/src/modules/dashboard/dashboard.repo.ts eloscrm-api/src/modules/dashboard/dashboard.service.ts eloscrm-api/test/dashboard.test.ts
git commit -m "feat: separa base ativa e base em nutrição no painel"
```

---

## Cobertura da spec

| Requisito da spec | Tarefa |
|---|---|
| §2 enums, colunas, índice, `nurtureUntil` opcional | 1 |
| §2 "vencido" derivado na leitura | 3, 8 |
| §3.1 `POST /nurture`, `nurturedAt` no servidor, 409 | 4 |
| §3.1 cobertura dos negócios abertos, `CLOSE_LOST`, `lostReason` | 5 |
| §3.1 `POST /reactivate`, reabertura, 409/422 | 6 |
| §3.2 invariante do `PATCH` | 2 |
| §3.3 default `ACTIVE`, `status`, `overdue`, `GET /:id` sem filtro | 3 |
| §3.4 agenda com duas fontes | 7 |
| §3.5 dashboard | 8 |
| §3.6 auditoria sem `AuditAction` nova | 4, 5, 6 |

O Plano B (web) fica para depois de A verde: tela `/nurturing`, os dois diálogos, as três entradas e
as cinco superfícies existentes que mudam.

> Criado em 2026-07-30 16:12 (-03) · Última modificação: 2026-07-30 16:12 (-03)

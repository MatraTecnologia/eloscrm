# Leads 360 — Plano B: cadastro do lead e comentários

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** O lead deixa de ser um contato raso — ganha descrição, tags, temperatura, tipo de interesse e
faixa de orçamento — e a equipe passa a conversar sobre ele por comentários com autor e data, em vez de
sobrescrever um campo único de observações.

**Architecture:** Os campos novos entram direto em `Client` e viajam pelo `create`/`update` que já
existem — a auditoria do plano A registra as mudanças sozinha, sem código novo. Comentário é model
próprio com o mesmo par `entityType`/`entityId` do `AuditEvent`, autor gravado como snapshot, e regra de
autoria no service: quem escreveu edita; quem escreveu ou quem manda na imobiliária apaga.

**Tech Stack:** Fastify 5, Prisma 7 (`prisma-client` rust-free, client em `src/generated/prisma`), Zod 4,
Vitest 4 contra Postgres real, Next 16 + TanStack Query + shadcn/ui no web.

Spec: [`specs/2026-07-29-leads-360-design.md`](../specs/2026-07-29-leads-360-design.md).
Plano A (já em produção, `main` em `8db4fa5`):
[`plans/2026-07-29-leads-360-a-auditoria.md`](./2026-07-29-leads-360-a-auditoria.md).

## Global Constraints

- **`actor` é o último parâmetro** das funções de escrita dos services: `type Actor = { id: string; name:
  string }` de `src/lib/actor.ts`, obtido nas rotas com `actorOf(request)`.
- **Ordem de escrita da auditoria:** `CREATED`/`UPDATED` gravados depois da escrita no banco; `DELETED`
  antes do delete.
- **Nenhuma query de domínio sem `organizationId`.**
- **Guards por arquivo de rota**: todo arquivo novo em `src/routes/v1/` começa com
  `app.addHook("preHandler", authGuard)` + `app.addHook("preHandler", orgGuard)`. Rota sem os hooks fica
  aberta.
- **Import do Prisma**: sempre `../../generated/prisma/client.js` (caminho relativo). `@prisma/client` é
  proibido por lint.
- **Sem `console.log`** fora de `prisma/` e `scripts/`. **`const` arrow functions**, nunca `function`.
- **Nunca enum cru nem emoji na UI** — rótulo em `lib/labels.ts` e ícone Lucide.
- **Sem migrations**: `pnpm db:push` e `pnpm db:push:test`, sempre os dois.
- **Erros** pelo envelope `{ error: { code, message, details? } }` via `httpError`/`notFound`.
- **Estilo misto no web:** parte dos arquivos está com aspas simples e sem ponto e vírgula (ex.
  `client-dialog.tsx`), parte com aspas duplas e ponto e vírgula. Não há Prettier no projeto — siga o
  estilo do arquivo que você está editando, não o do vizinho.
- **Commits em português, no imperativo** ("adiciona", "corrige").

## Decisões desta fase

- **`notes` continua existindo.** Vira o recado curto; `description` é o texto do perfil. Renomear
  obrigaria migração de dados sem ganho.
- **Sem parser de markdown.** `description` é texto multi-linha com quebras preservadas
  (`whitespace-pre-line`), como `notes` já é hoje. Adotar markdown de verdade é decisão separada — não
  invente um parser nem instale lib nesta fase.
- **Comentário não é auditado.** Ele já carrega autor, data e `editedAt`; registrar em `AuditEvent` seria
  ruído. `AuditEntity` não ganha valor novo.
- **`interestType` e `budget` do lead têm precedência sobre os do negócio** no cabeçalho: o campo do lead
  é a intenção declarada, o negócio é uma oportunidade concreta. Sem campo no lead, cai no
  comportamento atual (dados do negócio).

---

### Task 1: Campos do lead e model `Comment` no schema

**Files:**
- Modify: `eloscrm-api/prisma/schema.prisma`
- Test: `eloscrm-api/test/leads-b-model.test.ts`

**Interfaces:**
- Consumes: `AuditEntity` (plano A), `prisma.client`.
- Produces: campos `description`, `tags`, `temperature`, `interestType`, `budgetMin`, `budgetMax` em
  `Client`; enum `LeadTemperature` (`FRIO|MORNO|QUENTE`); model `Comment` acessível por
  `prisma.comment`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/leads-b-model.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditEntity, LeadTemperature } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `leads-b-${stamp}@eloscrm.test`, `leads-b-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("modelo do lead ampliado", () => {
  it("persiste descrição, tags, temperatura, interesse e faixa de orçamento", async () => {
    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        name: "Lead Completo",
        description: "Casal com dois filhos.\nQuer escola perto.",
        tags: ["financiamento", "urgente"],
        temperature: LeadTemperature.QUENTE,
        interestType: "Apartamento",
        budgetMin: 400000,
        budgetMax: 650000,
      },
    });

    expect(client.tags).toEqual(["financiamento", "urgente"]);
    expect(client.temperature).toBe(LeadTemperature.QUENTE);
    expect(client.description).toContain("escola perto");
    expect(String(client.budgetMin)).toBe("400000");
  });

  it("usa MORNO como temperatura padrão e tags vazias", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, name: "Lead Padrão" },
    });
    expect(client.temperature).toBe(LeadTemperature.MORNO);
    expect(client.tags).toEqual([]);
  });
});

describe("modelo Comment", () => {
  it("grava comentário com autor em snapshot e filtra por entidade", async () => {
    await prisma.comment.create({
      data: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: "lead-1",
        authorId: "user-1",
        authorName: "Corretora Ana",
        body: "Cliente pediu para ligar depois das 18h.",
      },
    });

    const found = await prisma.comment.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: "lead-1" },
    });

    expect(found).toHaveLength(1);
    expect(found[0].authorName).toBe("Corretora Ana");
    expect(found[0].editedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/leads-b-model.test.ts`
Expected: FAIL — `LeadTemperature` não é exportado / `prisma.comment` não existe.

- [ ] **Step 3: Adicionar o enum e os campos ao schema**

Em `prisma/schema.prisma`, junto dos outros enums de domínio:

```prisma
enum LeadTemperature {
  FRIO
  MORNO
  QUENTE
}
```

No model `Client`, depois de `notes`:

```prisma
  // notes segue sendo o recado curto; description é o texto do perfil do lead
  description  String?
  tags         String[]
  temperature  LeadTemperature @default(MORNO)
  interestType String?
  budgetMin    Decimal?
  budgetMax    Decimal?
```

- [ ] **Step 4: Adicionar o model `Comment`**

Depois de `AuditEvent`:

```prisma
model Comment {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  // mesmo par do AuditEvent, e pelo mesmo motivo: sem FK, o comentário não força uma coluna por tipo
  entityType     AuditEntity
  entityId       String
  // snapshot: o mural mostra quem era a pessoa na hora, e sobrevive a ela sair da imobiliária
  authorId       String
  authorName     String
  body           String
  editedAt       DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId, entityType, entityId, createdAt])
}
```

Adicionar o campo inverso em `Organization`, junto de `auditEvents AuditEvent[]`:

```prisma
  comments Comment[]
```

- [ ] **Step 5: Gerar client e aplicar nos dois bancos**

Run: `cd eloscrm-api && pnpm db:generate && pnpm db:push && pnpm db:push:test`
Expected: `Your database is now in sync with your Prisma schema.` nas duas.

- [ ] **Step 6: Rodar o teste**

Run: `cd eloscrm-api && pnpm vitest run test/leads-b-model.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 7: Commit**

```bash
git add eloscrm-api/prisma/schema.prisma eloscrm-api/test/leads-b-model.test.ts
git commit -m "feat: amplia o cadastro do lead e adiciona o modelo de comentários"
```

---

### Task 2: Campos novos no contrato de clientes

O `create`/`update` já auditam pelo plano A — os campos novos entram no `changes` sozinhos assim que o
schema Zod os aceitar. O teste prova as duas coisas de uma vez.

**Files:**
- Modify: `eloscrm-api/src/modules/clients/clients.schema.ts`
- Test: `eloscrm-api/test/clients-fields.test.ts`

**Interfaces:**
- Consumes: `createClientSchema`, `updateClientSchema`, `listClientsQuerySchema`.
- Produces: `CreateClientInput`/`UpdateClientInput` com `description`, `tags`, `temperature`,
  `interestType`, `budgetMin`, `budgetMax`; filtro `temperature` e `tag` em `listClientsQuerySchema`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/clients-fields.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `cli-f-${stamp}@eloscrm.test`, `cli-f-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("campos do perfil do lead", () => {
  it("cria com os campos novos e devolve os valores", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: {
        name: "Helena Ruiz",
        description: "Indicada pela Fernanda.\nProcura casa térrea.",
        tags: ["indicacao", "casa-terrea"],
        temperature: "QUENTE",
        interestType: "Casa",
        budgetMin: 500000,
        budgetMax: 800000,
      },
    });

    expect(res.statusCode).toBe(201);
    const client = res.json();
    expect(client.tags).toEqual(["indicacao", "casa-terrea"]);
    expect(client.temperature).toBe("QUENTE");
    expect(client.interestType).toBe("Casa");
  });

  it("rejeita temperatura fora do enum (422)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Inválido", temperature: "MORNINHO" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("audita a mudança dos campos novos", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead Esquenta", temperature: "FRIO" },
    });
    const client = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { temperature: "QUENTE", tags: ["retomada"] },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: client.id },
      orderBy: { createdAt: "asc" },
    });

    expect(events).toHaveLength(2);
    expect(events[1].changes).toEqual({
      temperature: { from: "FRIO", to: "QUENTE" },
      tags: { from: [], to: ["retomada"] },
    });
  });

  it("filtra por temperatura e por tag", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Filtro Quente", temperature: "QUENTE", tags: ["vip"] },
    });

    const byTemp = await app.inject({
      method: "GET",
      url: "/v1/clients?temperature=QUENTE",
      headers: { cookie },
    });
    expect(byTemp.statusCode).toBe(200);
    expect(byTemp.json().every((c: { temperature: string }) => c.temperature === "QUENTE")).toBe(true);

    const byTag = await app.inject({ method: "GET", url: "/v1/clients?tag=vip", headers: { cookie } });
    expect(byTag.statusCode).toBe(200);
    expect(byTag.json().some((c: { name: string }) => c.name === "Filtro Quente")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/clients-fields.test.ts`
Expected: FAIL — o Zod ignora os campos desconhecidos e `client.tags` volta `undefined`.

- [ ] **Step 3: Ampliar o schema Zod**

`src/modules/clients/clients.schema.ts` inteiro:

```ts
import * as z from "zod";
import { ClientSource, LeadTemperature } from "../../generated/prisma/client.js";

export const createClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.enum(ClientSource).optional(),
  notes: z.string().optional(),
  ownerId: z.string().optional(),
  description: z.string().optional(),
  // trim + descarte de vazias evita tag fantasma vinda de vírgula solta no formulário
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
  temperature: z.enum(LeadTemperature).optional(),
  interestType: z.string().optional(),
  budgetMin: z.number().nonnegative().optional(),
  budgetMax: z.number().nonnegative().optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const listClientsQuerySchema = z.object({
  source: z.enum(ClientSource).optional(),
  ownerId: z.string().optional(),
  q: z.string().optional(),
  temperature: z.enum(LeadTemperature).optional(),
  tag: z.string().optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
```

- [ ] **Step 4: Aplicar os filtros novos no repo**

Em `src/modules/clients/clients.repo.ts`, dentro de `listClients`, logo depois do filtro de `ownerId`:

```ts
  if (filters.temperature) where.temperature = filters.temperature;
  // `has` casa a tag exata dentro do array — `contains` faria match parcial e traria "vip-ouro" em "vip"
  if (filters.tag) where.tags = { has: filters.tag };
```

- [ ] **Step 5: Rodar os testes de clientes**

Run: `cd eloscrm-api && pnpm vitest run test/clients-fields.test.ts test/clients.test.ts test/clients-audit.test.ts`
Expected: PASS nos três.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/modules/clients eloscrm-api/test/clients-fields.test.ts
git commit -m "feat: aceita os campos de perfil do lead no contrato de clientes"
```

---

### Task 3: Módulo de comentários

**Files:**
- Create: `eloscrm-api/src/modules/comments/comments.schema.ts`
- Create: `eloscrm-api/src/modules/comments/comments.repo.ts`
- Create: `eloscrm-api/src/modules/comments/comments.service.ts`
- Create: `eloscrm-api/src/routes/v1/comments/index.ts`
- Test: `eloscrm-api/test/comments.test.ts`

**Interfaces:**
- Consumes: `Actor`, `actorOf`, `prisma.comment`, `AuditEntity`.
- Produces:
  - `GET /v1/comments?entityType=<AuditEntity>&entityId=<id>` → array, mais recente primeiro
  - `POST /v1/comments` `{ entityType, entityId, body }` → 201
  - `PATCH /v1/comments/:id` `{ body }` → 200, grava `editedAt` (só o autor)
  - `DELETE /v1/comments/:id` → 204 (autor, ou `owner`/`admin` da organização)

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/comments.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { asCookie, signUpWithOrg, signUp } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let cookieOutro = "";
let cookieOrgB = "";
let clientId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `com-a-${stamp}@eloscrm.test`, `com-a-${stamp}`));
  ({ cookie: cookieOrgB } = await signUpWithOrg(app, `com-b-${stamp}@eloscrm.test`, `com-b-${stamp}`));

  // segundo membro da MESMA organização, para provar a regra de autoria
  cookieOutro = await signUp(app, `com-c-${stamp}@eloscrm.test`);
  const outro = await prisma.user.findFirst({ where: { email: `com-c-${stamp}@eloscrm.test` } });
  await prisma.member.create({ data: { organizationId: orgId, userId: outro!.id, role: "member" } });
  // set-active pelo endpoint, não por UPDATE na tabela: o cookieCache guarda a sessão por 60s no
  // cookie, e mexer só no banco deixaria o guard lendo activeOrganizationId nulo do cache
  const ativou = await app.inject({
    method: "POST",
    url: "/api/auth/organization/set-active",
    headers: { cookie: cookieOutro },
    payload: { organizationId: orgId },
  });
  cookieOutro = ativou.headers["set-cookie"] ? asCookie(ativou.headers["set-cookie"]) : cookieOutro;

  const created = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Lead comentado" },
  });
  clientId = created.json().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const post = (c: string, body: string) =>
  app.inject({
    method: "POST",
    url: "/v1/comments",
    headers: { cookie: c },
    payload: { entityType: "CLIENT", entityId: clientId, body },
  });

describe("comentários", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/comments?entityType=CLIENT&entityId=x" });
    expect(res.statusCode).toBe(401);
  });

  it("recusa corpo vazio (422)", async () => {
    const res = await post(cookie, "   ");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("cria e lista com autor e data, mais recente primeiro", async () => {
    await post(cookie, "Primeiro contato feito.");
    await post(cookie, "Cliente pediu retorno na quinta.");

    const res = await app.inject({
      method: "GET",
      url: `/v1/comments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const comments = res.json();
    expect(comments[0].body).toBe("Cliente pediu retorno na quinta.");
    expect(comments[0].authorName).toBe("Corretor Teste");
    expect(comments[0].editedAt).toBeNull();
  });

  it("só o autor edita, e a edição marca editedAt", async () => {
    const created = await post(cookie, "Texto original");
    const id = created.json().id;

    const alheio = await app.inject({
      method: "PATCH",
      url: `/v1/comments/${id}`,
      headers: { cookie: cookieOutro },
      payload: { body: "Editado por outro" },
    });
    expect(alheio.statusCode).toBe(403);
    expect(alheio.json().error.code).toBe("FORBIDDEN");

    const proprio = await app.inject({
      method: "PATCH",
      url: `/v1/comments/${id}`,
      headers: { cookie },
      payload: { body: "Texto corrigido" },
    });
    expect(proprio.statusCode).toBe(200);
    expect(proprio.json().body).toBe("Texto corrigido");
    expect(proprio.json().editedAt).not.toBeNull();
  });

  it("dono da imobiliária apaga comentário de outro membro", async () => {
    const doOutro = await post(cookieOutro, "Comentário do colega");
    const id = doOutro.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/comments/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it("membro comum não apaga comentário alheio", async () => {
    const meu = await post(cookie, "Comentário do dono");
    const id = meu.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/comments/${id}`,
      headers: { cookie: cookieOutro },
    });
    expect(res.statusCode).toBe(403);
  });

  it("não vaza comentário de outra organização", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/comments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie: cookieOrgB },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/comments.test.ts`
Expected: FAIL — 404 `Route GET:/v1/comments not found`.

- [ ] **Step 3: Criar o schema**

`src/modules/comments/comments.schema.ts`:

```ts
import * as z from "zod";
import { AuditEntity } from "../../generated/prisma/client.js";

// trim antes do min: um corpo só de espaços é comentário vazio, não comentário de um caractere
export const createCommentSchema = z.object({
  entityType: z.enum(AuditEntity),
  entityId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
});

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const listCommentsQuerySchema = z.object({
  entityType: z.enum(AuditEntity),
  entityId: z.string().min(1),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
```

- [ ] **Step 4: Criar o repo**

`src/modules/comments/comments.repo.ts`:

```ts
import { prisma } from "../../lib/prisma.js";
import type { CreateCommentInput, ListCommentsQuery } from "./comments.schema.js";

export const listComments = (orgId: string, filters: ListCommentsQuery) =>
  prisma.comment.findMany({
    where: { organizationId: orgId, entityType: filters.entityType, entityId: filters.entityId },
    orderBy: { createdAt: "desc" },
  });

export const findComment = (orgId: string, id: string) =>
  prisma.comment.findFirst({ where: { id, organizationId: orgId } });

export const createComment = (
  orgId: string,
  data: CreateCommentInput,
  author: { id: string; name: string },
) =>
  prisma.comment.create({
    data: { ...data, organizationId: orgId, authorId: author.id, authorName: author.name },
  });

export const updateCommentById = (id: string, body: string) =>
  prisma.comment.update({ where: { id }, data: { body, editedAt: new Date() } });

export const deleteCommentById = (id: string) => prisma.comment.delete({ where: { id } });

export const findMemberRole = async (orgId: string, userId: string) => {
  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, userId },
    select: { role: true },
  });
  return member?.role ?? null;
};
```

- [ ] **Step 5: Criar o service com a regra de autoria**

`src/modules/comments/comments.service.ts`:

```ts
import type { Actor } from "../../lib/actor.js";
import { httpError, notFound } from "../../lib/http-error.js";
import * as repo from "./comments.repo.js";
import type { CreateCommentInput, ListCommentsQuery } from "./comments.schema.js";

const MANAGER_ROLES = ["owner", "admin"];

const forbidden = (message: string) => httpError(403, "FORBIDDEN", message);

export const list = (orgId: string, filters: ListCommentsQuery) => repo.listComments(orgId, filters);

const getOwn = async (orgId: string, id: string) => {
  const comment = await repo.findComment(orgId, id);
  if (!comment) throw notFound("Comentário não encontrado");
  return comment;
};

export const create = (orgId: string, data: CreateCommentInput, actor: Actor) =>
  repo.createComment(orgId, data, actor);

export const update = async (orgId: string, id: string, body: string, actor: Actor) => {
  const comment = await getOwn(orgId, id);
  // editar é sempre do autor: gestor apaga o que não presta, mas não reescreve fala de ninguém
  if (comment.authorId !== actor.id) throw forbidden("Só o autor pode editar o comentário");
  return repo.updateCommentById(id, body);
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  const comment = await getOwn(orgId, id);
  if (comment.authorId !== actor.id) {
    const role = await repo.findMemberRole(orgId, actor.id);
    if (!role || !MANAGER_ROLES.includes(role)) {
      throw forbidden("Só o autor ou um gestor pode remover o comentário");
    }
  }
  await repo.deleteCommentById(id);
};
```

- [ ] **Step 6: Criar a rota**

`src/routes/v1/comments/index.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { actorOf } from "../../../lib/actor.js";
import {
  createCommentSchema,
  listCommentsQuerySchema,
  updateCommentSchema,
} from "../../../modules/comments/comments.schema.js";
import * as service from "../../../modules/comments/comments.service.js";

const commentsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listCommentsQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/", async (request, reply) => {
    const data = createCommentSchema.parse(request.body);
    const comment = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(comment);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const { body } = updateCommentSchema.parse(request.body);
    return service.update(request.orgId!, id, body, actorOf(request));
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id, actorOf(request));
    return reply.status(204).send();
  });
};

export default commentsRoutes;
```

- [ ] **Step 7: Rodar o teste e a suíte**

Run: `cd eloscrm-api && pnpm vitest run test/comments.test.ts && pnpm typecheck && pnpm test`
Expected: PASS — 7 testes novos, suíte inteira verde.

- [ ] **Step 8: Commit**

```bash
git add eloscrm-api/src/modules/comments eloscrm-api/src/routes/v1/comments eloscrm-api/test/comments.test.ts
git commit -m "feat: adiciona comentários por entidade com regra de autoria"
```

---

### Task 4: Tipos e queries no web

**Files:**
- Modify: `eloscrm-web/lib/types.ts`
- Modify: `eloscrm-web/lib/queries/clients.ts`
- Create: `eloscrm-web/lib/queries/comments.ts`
- Modify: `eloscrm-web/lib/labels.ts`

**Interfaces:**
- Consumes: os endpoints das tasks 2 e 3.
- Produces: tipo `Client` ampliado, `LeadTemperature`, `Comment`; `ClientInput` com os campos novos;
  `useComments(entityType, entityId)`, `useCreateComment()`, `useUpdateComment()`,
  `useDeleteComment()`; `leadTemperatureLabels`.

- [ ] **Step 1: Ampliar os tipos**

Em `eloscrm-web/lib/types.ts`, adicionar o enum e os campos ao tipo `Client`:

```ts
export type LeadTemperature = "FRIO" | "MORNO" | "QUENTE";
```

```ts
export type Client = {
  id: string;
  organizationId: string;
  ownerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: ClientSource;
  notes: string | null;
  description: string | null;
  tags: string[];
  temperature: LeadTemperature;
  interestType: string | null;
  // Decimal serializado como string, igual a Deal.value
  budgetMin: string | null;
  budgetMax: string | null;
  createdAt: string;
  updatedAt: string;
};
```

E, ao fim do arquivo, o comentário:

```ts
export type Comment = {
  id: string;
  organizationId: string;
  entityType: AuditEntity;
  entityId: string;
  authorId: string;
  authorName: string;
  body: string;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 2: Adicionar o rótulo da temperatura**

Em `eloscrm-web/lib/labels.ts`, junto dos outros rótulos:

```ts
export const leadTemperatureLabels: Record<LeadTemperature, string> = {
  FRIO: "Frio",
  MORNO: "Morno",
  QUENTE: "Quente",
};
```

Importar `LeadTemperature` no `import type` do topo do arquivo, e completar `FIELD_LABELS` com os campos
novos, para o histórico não mostrar nome de coluna:

```ts
  tags: "Tags",
  temperature: "Temperatura",
  interestType: "Tipo de interesse",
  budgetMin: "Orçamento mínimo",
  budgetMax: "Orçamento máximo",
```

- [ ] **Step 3: Ampliar `ClientInput` e os filtros**

Em `eloscrm-web/lib/queries/clients.ts`:

```ts
export type ClientFilters = { source?: ClientSource; q?: string; temperature?: LeadTemperature; tag?: string };
export type ClientInput = {
  name: string;
  email?: string;
  phone?: string;
  source?: ClientSource;
  notes?: string;
  description?: string;
  tags?: string[];
  temperature?: LeadTemperature;
  interestType?: string;
  budgetMin?: number;
  budgetMax?: number;
};
```

Ajustar o `import type` do arquivo para trazer `LeadTemperature`.

- [ ] **Step 4: Criar `lib/queries/comments.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { AuditEntity, Comment } from "@/lib/types";

export const useComments = (entityType: AuditEntity, entityId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["comments", org?.id, entityType, entityId],
    queryFn: async () => {
      const { data } = await api.get<Comment[]>("/comments", { params: { entityType, entityId } });
      return data;
    },
    enabled: !!org?.id && !!entityId,
  });
};

export const useCreateComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entityType: AuditEntity; entityId: string; body: string }) => {
      const { data } = await api.post<Comment>("/comments", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments"] }),
  });
};

export const useUpdateComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const { data } = await api.patch<Comment>(`/comments/${id}`, { body });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments"] }),
  });
};

export const useDeleteComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/comments/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments"] }),
  });
};
```

- [ ] **Step 5: Verificar**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint`
Expected: sem erro. Se o `typecheck` acusar uso de `Client` em algum componente que ainda não conhece os
campos novos, isso é esperado só se algum lugar construir um `Client` à mão — nesse caso, corrija ali.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-web/lib/types.ts eloscrm-web/lib/labels.ts eloscrm-web/lib/queries/clients.ts eloscrm-web/lib/queries/comments.ts
git commit -m "feat: consulta comentários e o perfil ampliado do lead no web"
```

---

### Task 5: Campos novos no formulário do cliente

**Files:**
- Modify: `eloscrm-web/app/(app)/clients/client-dialog.tsx`
- Create: `eloscrm-web/app/(app)/clients/tags-input.tsx`

**Interfaces:**
- Consumes: `ClientInput` ampliado, `leadTemperatureLabels`, `formatCurrencyInput`,
  `parseCurrencyInput`, `currencyToInput` (já existem em `lib/labels.ts`).
- Produces: componente `TagsInput({ value, onChange })`.

> **Estilo:** `client-dialog.tsx` usa aspas simples e não usa ponto e vírgula. Mantenha o estilo do
> arquivo. O componente novo segue o mesmo, por ficar ao lado dele.

- [ ] **Step 1: Criar o campo de tags**

`eloscrm-web/app/(app)/clients/tags-input.tsx`:

```tsx
'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

export const TagsInput = ({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) => {
  const [draft, setDraft] = useState('')

  const add = () => {
    const tag = draft.trim()
    // duplicada não é erro do usuário, é só ruído: ignora em silêncio e limpa o campo
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  return (
    <div className="space-y-2">
      <Input
        id="tags"
        placeholder="Digite e pressione Enter"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          // Enter dentro de um dialog submeteria o formulário; aqui ele só fecha a tag
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(tag => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                aria-label={`Remover ${tag}`}
                onClick={() => onChange(value.filter(t => t !== tag))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Adicionar o estado dos campos novos no dialog**

Em `client-dialog.tsx`, junto dos outros `useState`:

```tsx
  const [description, setDescription] = useState(client?.description ?? '')
  const [tags, setTags] = useState<string[]>(client?.tags ?? [])
  const [temperature, setTemperature] = useState<LeadTemperature>(
    client?.temperature ?? 'MORNO',
  )
  const [interestType, setInterestType] = useState(client?.interestType ?? '')
  const [budgetMin, setBudgetMin] = useState(currencyToInput(client?.budgetMin))
  const [budgetMax, setBudgetMax] = useState(currencyToInput(client?.budgetMax))
```

E no `onOpenChange`, dentro do `if (next)`, para o dialog não trazer rascunho antigo ao reabrir:

```tsx
      setDescription(client?.description ?? '')
      setTags(client?.tags ?? [])
      setTemperature(client?.temperature ?? 'MORNO')
      setInterestType(client?.interestType ?? '')
      setBudgetMin(currencyToInput(client?.budgetMin))
      setBudgetMax(currencyToInput(client?.budgetMax))
```

Ajustar os imports do arquivo: `LeadTemperature` em `@/lib/types`, e `currencyToInput`,
`formatCurrencyInput`, `parseCurrencyInput`, `leadTemperatureLabels` em `@/lib/labels`.

- [ ] **Step 3: Incluir os campos no payload do submit**

No objeto `input` do `submit`:

```tsx
      description: description.trim() || undefined,
      tags,
      temperature,
      interestType: interestType.trim() || undefined,
      budgetMin: parseCurrencyInput(budgetMin),
      budgetMax: parseCurrencyInput(budgetMax),
```

- [ ] **Step 4: Adicionar os campos ao formulário**

Depois do bloco de Origem e antes do de Observações:

```tsx
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Temperatura</Label>
              <Select
                value={temperature}
                onValueChange={v => setTemperature(v as LeadTemperature)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: LeadTemperature) => leadTemperatureLabels[v]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(leadTemperatureLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interestType">Tipo de interesse</Label>
              <Input
                id="interestType"
                placeholder="Apartamento, Casa, Terreno…"
                value={interestType}
                onChange={e => setInterestType(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="budgetMin">Orçamento mínimo</Label>
              <Input
                id="budgetMin"
                inputMode="numeric"
                placeholder="0,00"
                value={budgetMin}
                onChange={e => setBudgetMin(formatCurrencyInput(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="budgetMax">Orçamento máximo</Label>
              <Input
                id="budgetMax"
                inputMode="numeric"
                placeholder="0,00"
                value={budgetMax}
                onChange={e => setBudgetMax(formatCurrencyInput(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tags">Tags</Label>
            <TagsInput value={tags} onChange={setTags} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              rows={4}
              placeholder="Perfil do lead: composição familiar, momento de compra, restrições…"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
```

Importar `TagsInput` de `./tags-input`.

- [ ] **Step 5: Verificar**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint && pnpm build`
Expected: os três limpos.

- [ ] **Step 6: Conferir na tela**

Com API e web no ar (`./scripts/dev.sh`): abrir um lead, clicar no lápis, preencher temperatura, tipo de
interesse, orçamento, duas tags e a descrição, salvar, reabrir o diálogo.
Expected: os valores voltam preenchidos; as tags aparecem como chips e o X remove.

- [ ] **Step 7: Commit**

```bash
git add "eloscrm-web/app/(app)/clients/client-dialog.tsx" "eloscrm-web/app/(app)/clients/tags-input.tsx"
git commit -m "feat: edita o perfil ampliado do lead no formulário"
```

---

### Task 6: Perfil e mural na tela do lead

**Files:**
- Create: `eloscrm-web/app/(app)/clients/[id]/comment-feed.tsx`
- Modify: `eloscrm-web/app/(app)/clients/[id]/lead-header.tsx`
- Modify: `eloscrm-web/app/(app)/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `useComments`, `useCreateComment`, `useUpdateComment`, `useDeleteComment` (Task 4),
  `leadTemperatureLabels`, `formatCurrency`, `useSession` de `@/lib/auth-client`.
- Produces: componente `CommentFeed({ entityType, entityId })`.

- [ ] **Step 1: Criar o mural de comentários**

`eloscrm-web/app/(app)/clients/[id]/comment-feed.tsx`:

```tsx
"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from "@/lib/queries/comments";
import type { AuditEntity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const CommentFeed = ({ entityType, entityId }: { entityType: AuditEntity; entityId: string }) => {
  const { data: session } = useSession();
  const { data: comments, isLoading } = useComments(entityType, entityId);
  const create = useCreateComment();
  const update = useUpdateComment();
  const remove = useDeleteComment();

  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await create.mutateAsync({ entityType, entityId, body });
      setDraft("");
    } catch {
      toast.error("Não foi possível publicar o comentário");
    }
  };

  const saveEdit = async (id: string) => {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await update.mutateAsync({ id, body });
      setEditingId(null);
    } catch {
      toast.error("Não foi possível salvar a edição");
    }
  };

  const del = async (id: string) => {
    try {
      await remove.mutateAsync(id);
    } catch {
      // a API recusa quem não é autor nem gestor; a mensagem explica em vez de sumir com o botão
      toast.error("Você não pode remover este comentário");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          rows={3}
          placeholder="Escreva um comentário para a equipe…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={create.isPending || !draft.trim()}>
            {create.isPending ? "Publicando…" : "Comentar"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !comments?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare />
            </EmptyMedia>
            <EmptyTitle>Nenhum comentário</EmptyTitle>
            <EmptyDescription>Registre aqui o que a equipe precisa saber sobre este lead.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{comment.authorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(comment.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    {comment.editedAt ? " · editado" : ""}
                  </p>
                </div>
                {comment.authorId === session?.user.id && editingId !== comment.id && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar comentário"
                      onClick={() => {
                        setEditingId(comment.id);
                        setEditDraft(comment.body);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover comentário"
                      onClick={() => del(comment.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {editingId === comment.id ? (
                <div className="mt-2 space-y-2">
                  <Textarea rows={3} value={editDraft} onChange={(e) => setEditDraft(e.target.value)} />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      Cancelar
                    </Button>
                    <Button size="sm" onClick={() => saveEdit(comment.id)} disabled={update.isPending}>
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                // whitespace-pre-line: o corpo vem de textarea e pode ter quebras de linha
                <p className="mt-2 text-sm whitespace-pre-line">{comment.body}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Mostrar temperatura e tags no cabeçalho**

Em `lead-header.tsx`, importar o rótulo e o util de moeda:

```tsx
import { clientSourceLabels, formatCurrency, formatPhone, leadTemperatureLabels, phoneNationalDigits } from "@/lib/labels";
```

Ao lado do badge de estágio, dentro do mesmo `div` de `flex-wrap`:

```tsx
            <Badge variant="secondary">{leadTemperatureLabels[client.temperature]}</Badge>
```

E, na linha de interesse/orçamento, dar precedência ao que está declarado no lead:

```tsx
  // o campo do lead é a intenção declarada; o do negócio é uma oportunidade concreta
  const interestLabel = client.interestType ?? interest;
  const budgetLabel = client.budgetMin
    ? `${formatCurrency(client.budgetMin)}${client.budgetMax ? ` a ${formatCurrency(client.budgetMax)}` : ""}`
    : budget;
```

Trocar os dois usos no JSX (`{interest}` → `{interestLabel}`, `{budget}` → `{budgetLabel}`).

Depois do parágrafo de interesse/orçamento, as tags:

```tsx
          {client.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {client.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
```

- [ ] **Step 3: Mostrar a descrição e ligar a aba de comentários**

Em `page.tsx`, importar `CommentFeed` de `./comment-feed`.

No card "Observações" da aba Resumo, mostrar a descrição acima das observações:

```tsx
                <CardContent className="space-y-3">
                  {client.description && (
                    <p className="text-sm whitespace-pre-line">{client.description}</p>
                  )}
                  {/* whitespace-pre-line: observações vêm de textarea e podem ter quebras de linha */}
                  <p className="text-sm whitespace-pre-line text-muted-foreground">
                    {client.notes || "Sem observações registradas."}
                  </p>
                </CardContent>
```

Acrescentar o gatilho da aba, depois de "Arquivos":

```tsx
          <TabsTrigger value="comentarios" className="data-active:text-primary after:bg-primary">
            Comentários
          </TabsTrigger>
```

E o conteúdo, antes do `TabsContent` de histórico:

```tsx
        <TabsContent value="comentarios" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Comentários</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentFeed entityType="CLIENT" entityId={client.id} />
            </CardContent>
          </Card>
        </TabsContent>
```

- [ ] **Step 4: Verificar**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint && pnpm build`
Expected: os três limpos.

- [ ] **Step 5: Conferir na tela**

Com API e web no ar: abrir um lead com temperatura e tags preenchidas na Task 5.
Expected: badge de temperatura e chips de tag no cabeçalho; descrição no card de observações; na aba
**Comentários**, publicar um comentário, vê-lo aparecer com seu nome e a data, editar (aparece "·
editado") e remover. Comentário de outra pessoa não mostra os botões de editar/remover.

- [ ] **Step 6: Commit**

```bash
git add "eloscrm-web/app/(app)/clients/[id]/comment-feed.tsx" "eloscrm-web/app/(app)/clients/[id]/lead-header.tsx" "eloscrm-web/app/(app)/clients/[id]/page.tsx"
git commit -m "feat: exibe o perfil do lead e o mural de comentários"
```

---

### Task 7: Seed com os campos novos

Sem isto o app volta a parecer vazio nos campos que acabaram de nascer, e a UI da fase fica sem prova
visual com dados realistas.

**Files:**
- Modify: `eloscrm-api/prisma/seed-data.ts`
- Modify: `eloscrm-api/prisma/seed.ts`

**Interfaces:**
- Consumes: `prisma.client`, `prisma.comment`, `LeadTemperature`, `AuditEntity`.
- Produces: leads com descrição, tags, temperatura, interesse e orçamento; alguns comentários.

- [ ] **Step 1: Enriquecer os dados dos clientes**

Em `prisma/seed-data.ts`, importar `LeadTemperature` junto dos outros enums e acrescentar os campos aos
quatro primeiros clientes da lista (os demais ficam sem, para a tela mostrar os dois casos):

```ts
  {
    name: "Carlos Silva",
    email: "carlos.silva@email.com",
    phone: "(43) 99812-4470",
    source: ClientSource.SITE,
    notes: "Procura 3 quartos na Gleba Palhano, financiamento pela Caixa aprovado.",
    description:
      "Casal com dois filhos em idade escolar.\nQuer ficar perto do colégio na Gleba Palhano e não abre mão de duas vagas.",
    tags: ["financiamento", "gleba-palhano"],
    temperature: LeadTemperature.QUENTE,
    interestType: "Apartamento",
    budgetMin: 800000,
    budgetMax: 900000,
  },
```

Faça o mesmo para "Mariana Costa" (`MORNO`, tags `["primeiro-imovel"]`, `Apartamento`, 380000–450000),
"Lucas Almeida" (`QUENTE`, tags `["condominio-fechado", "indicacao"]`, `Casa`, 1100000–1300000) e
"Juliana Tavares" (`FRIO`, tags `["locacao"]`, `Studio`, 1800–2400).

- [ ] **Step 2: Adicionar comentários ao seed**

Ainda em `seed-data.ts`, ao fim do arquivo:

```ts
/** `client` casa pelo nome, igual aos deals; o autor é resolvido no seed. */
export const comments = [
  {
    client: "Carlos Silva",
    body: "Proposta enviada ontem. Ele pediu 48h para conversar com a esposa.",
    daysAgo: 2,
  },
  {
    client: "Carlos Silva",
    body: "Confirmou que segue interessado; quer negociar a segunda vaga.",
    daysAgo: 1,
  },
  {
    client: "Lucas Almeida",
    body: "Visitou o Aurora e gostou. Preocupado com o valor do condomínio.",
    daysAgo: 3,
  },
  {
    client: "Juliana Tavares",
    body: "Desistiu da compra por ora. Passei as opções de locação no Centro.",
    daysAgo: 10,
  },
];
```

- [ ] **Step 3: Gravar os comentários no seed**

Em `prisma/seed.ts`, importar `comments` de `./seed-data.js` e `AuditEntity` de
`../src/generated/prisma/client.js`; incluir `prisma.comment.deleteMany({ where: { organizationId } })`
no início de `wipeOrgData`; e, depois do laço de atividades:

```ts
  // sem membro na org (banco zerado), não há autor para assinar o comentário
  if (ownerId) {
    const author = await prisma.member.findFirst({
      where: { organizationId: org.id, userId: ownerId },
      select: { user: { select: { name: true } } },
    });
    for (const comment of comments) {
      await prisma.comment.create({
        data: {
          organizationId: org.id,
          entityType: AuditEntity.CLIENT,
          entityId: clientIds.get(comment.client)!,
          authorId: ownerId,
          authorName: author?.user.name ?? "Equipe",
          body: comment.body,
          createdAt: daysAgo(comment.daysAgo),
        },
      });
    }
  }
```

E acrescentar a contagem ao `console.log` final:

```ts
      `${activities.length} atividades, ${comments.length} comentários`,
```

- [ ] **Step 4: Rodar o seed duas vezes**

Run: `cd eloscrm-api && pnpm db:seed && pnpm db:seed`
Expected: as duas execuções terminam com a linha de contagem; a segunda prova que a limpeza cobre os
comentários (sem duplicar e sem erro de FK).

- [ ] **Step 5: Verificar**

Run: `cd eloscrm-api && pnpm typecheck && pnpm lint && pnpm test`
Expected: os três limpos.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/prisma/seed-data.ts eloscrm-api/prisma/seed.ts
git commit -m "feat: popula o perfil do lead e comentários no seed"
```

---

## Fechamento do plano B

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm test
cd ../eloscrm-web && pnpm lint && pnpm typecheck && pnpm build
```

Depois disso o plano C (anexos privados no R2 e timeline unificada) tem as quatro fontes que precisa
fundir — atividade, auditoria, comentário e anexo — e pode consumir o `src/lib/storage.ts` que já existe.

## Fora de escopo (nomeado, não esquecido)

- **Menções e notificações** em comentários — menção sem notificação é enfeite, e notificação é outro
  subsistema.
- **Markdown de verdade** em `description` e no corpo do comentário.
- **Campos customizados por organização** ao estilo Kommo.
- **Filtro por tag/temperatura na tela de clientes** — a API já aceita (`?temperature=`, `?tag=`), a UI
  de filtro fica para quando a lista pedir.
- **Retenção de PII no histórico** — pendência herdada do plano A: excluir um lead não apaga os dados
  pessoais gravados no `changes` do `AuditEvent`. Vale para `Comment` também.

> Criado em 2026-07-29 14:39 (-03) · Última modificação: 2026-07-29 14:39 (-03)

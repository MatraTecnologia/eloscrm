# Leads 360 — Plano A: contexto de request e auditoria

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Toda escrita no domínio passa a registrar quem fez, o quê e quando, e a tela do lead ganha uma
aba **Histórico** com o responsável resolvido pelo nome.

**Architecture:** Uma tabela `AuditEvent` com `entityType`/`entityId` (sem FK), escrita por um helper único
(`src/lib/audit.ts`) chamado de dentro dos services. O ator chega até lá como último parâmetro explícito
das funções de escrita — mesmo estilo do `orgId` que já é explícito hoje. O nome do ator é gravado como
snapshot, então o histórico não depende de join nem sobrevive de forma errada quando o membro sai.

**Tech Stack:** Fastify 5, Prisma 7 (`prisma-client` rust-free, client em `src/generated/prisma`), Zod 4,
Vitest 4 contra Postgres real, Next 16 + TanStack Query no web.

Spec: [`specs/2026-07-29-leads-360-design.md`](../specs/2026-07-29-leads-360-design.md).

## Global Constraints

- **`actor` é sempre o último parâmetro** das funções de escrita dos services. Tipo:
  `type Actor = { id: string; name: string }` de `src/lib/actor.ts`.
- **Nenhuma query de domínio sem `organizationId`.** Vale para `AuditEvent` como para o resto.
- **Guards por arquivo de rota**: todo arquivo novo em `src/routes/v1/` começa com
  `app.addHook("preHandler", authGuard)` + `app.addHook("preHandler", orgGuard)`. Rota sem os hooks fica
  aberta.
- **Import do Prisma**: sempre `../../generated/prisma/client.js` (caminho relativo). `@prisma/client` é
  proibido por lint (`no-restricted-imports`).
- **Sem `console.log`** fora de `prisma/` e `scripts/` (regra `no-console` do oxlint).
- **`const` arrow functions**, nunca `function`. Strings de UI em pt-BR, identificadores em inglês.
- **Sem migrations**: `pnpm db:push` no banco de dev e `pnpm db:push:test` no de teste, sempre os dois.
- **Erros** pelo envelope `{ error: { code, message, details? } }` via `httpError`/`notFound` de
  `src/lib/http-error.ts`.
- **Ordem de escrita**: `CREATED`/`UPDATED` são gravados **depois** da escrita no banco (precisam do id e
  do estado final); `DELETED` é gravado **antes** do delete, senão uma falha ao gravar o evento apaga a
  entidade sem deixar rastro. O evento não tem FK para a entidade, então gravar antes é seguro.
- **Commits em português, no imperativo** ("adiciona", "corrige").

---

### Task 0: Destravar a suíte (envs R2 obrigatórias)

`src/env.ts` já exige as quatro envs de R2. O `.env.test` local **já foi corrigido** e a suíte volta a
passar (57 testes), mas os arquivos versionados continuam sem elas: quem clonar o repo, e o CI, quebram
no boot com `❌ Invalid environment variables` antes do primeiro assert.

**Files:**
- Modify: `eloscrm-api/.env.test.example`
- Modify: `eloscrm-api/.env.example`
- Modify: `.github/workflows/ci.yml:30-34` (bloco `env:` do job `api`)

**Interfaces:**
- Consumes: nada.
- Produces: suíte executável em clone novo e no CI. Valores de teste são fake — o presign do AWS SDK é
  assinatura local e não precisa de credencial válida; nada no plano A toca a rede.

- [ ] **Step 1: Confirmar o estado**

Run: `cd eloscrm-api && grep -c R2_ .env.test .env.test.example .env.example`
Expected: `4` no primeiro, `0` nos outros dois — é isso que esta task fecha.

- [ ] **Step 2: Adicionar as envs no `.env.test.example`**

```bash
# Storage: os testes do plano A não tocam a rede — presign é assinatura local.
R2_ENDPOINT=http://localhost:8333
R2_ACCESS_KEY_ID=test
R2_SECRET_ACCESS_KEY=test
R2_PRIVATE_BUCKET_NAME=eloscrm-test
```

E ao fim de `.env.example` (valores do SeaweedFS local; em produção, os do R2):

```bash
R2_ENDPOINT=http://localhost:8333
R2_ACCESS_KEY_ID=seaweedadmin
R2_SECRET_ACCESS_KEY=seaweedadmin
R2_PRIVATE_BUCKET_NAME=eloscrm-private
```

- [ ] **Step 3: Adicionar as mesmas envs no job `api` do CI**

Em `.github/workflows/ci.yml`, no bloco `env:` do job `api`, junto de `DATABASE_URL`/`BETTER_AUTH_SECRET`:

```yaml
      R2_ENDPOINT: http://localhost:8333
      R2_ACCESS_KEY_ID: test
      R2_SECRET_ACCESS_KEY: test
      R2_PRIVATE_BUCKET_NAME: eloscrm-test
```

- [ ] **Step 4: Rodar a suíte e verificar**

Run: `cd eloscrm-api && pnpm test`
Expected: PASS — 14 arquivos, 57 testes.

- [ ] **Step 5: Commit**

```bash
git add eloscrm-api/.env.test.example eloscrm-api/.env.example .github/workflows/ci.yml
git commit -m "fix: declara as envs de storage no ambiente de teste"
```

> `.env.test` e `.env` são gitignored — só os `.example` e o CI entram no commit.

---

### Task 1: Modelo `AuditEvent`

**Files:**
- Modify: `eloscrm-api/prisma/schema.prisma`
- Test: `eloscrm-api/test/audit-model.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `prisma.auditEvent`, enums `AuditEntity` (`CLIENT|DEAL|PROPERTY|ACTIVITY`) e `AuditAction`
  (`CREATED|UPDATED|DELETED|STAGE_CHANGED|OWNER_CHANGED`) exportados de
  `src/generated/prisma/client.js`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/audit-model.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `audit-model-${stamp}@eloscrm.test`, `audit-model-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("modelo AuditEvent", () => {
  it("grava evento com changes em JSON e filtra por entidade", async () => {
    await prisma.auditEvent.create({
      data: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: "cliente-1",
        action: AuditAction.UPDATED,
        actorId: "user-1",
        actorName: "Corretor Teste",
        changes: { name: { from: "Antes", to: "Depois" } },
      },
    });

    const found = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: "cliente-1" },
    });

    expect(found).toHaveLength(1);
    expect(found[0].actorName).toBe("Corretor Teste");
    expect(found[0].changes).toEqual({ name: { from: "Antes", to: "Depois" } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/audit-model.test.ts`
Expected: FAIL — `prisma.auditEvent` não existe / `AuditEntity` não é exportado.

- [ ] **Step 3: Adicionar os enums e o model ao schema**

Em `prisma/schema.prisma`, junto dos outros enums de domínio:

```prisma
enum AuditEntity {
  CLIENT
  DEAL
  PROPERTY
  ACTIVITY
}

enum AuditAction {
  CREATED
  UPDATED
  DELETED
  STAGE_CHANGED
  OWNER_CHANGED
}
```

E o model, depois de `Activity`:

```prisma
model AuditEvent {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  entityType     AuditEntity
  entityId       String
  action         AuditAction
  // snapshot: o histórico mostra o nome que a pessoa tinha na hora do fato e sobrevive a ela sair da org
  actorId        String?
  actorName      String?
  // { campo: { from, to } }, só o que mudou
  changes        Json?
  createdAt      DateTime     @default(now())

  @@index([organizationId, entityType, entityId, createdAt])
}
```

Adicionar o campo inverso em `Organization`, junto de `activities Activity[]`:

```prisma
  auditEvents AuditEvent[]
```

- [ ] **Step 4: Gerar client e aplicar nos dois bancos**

Run: `cd eloscrm-api && pnpm db:generate && pnpm db:push && pnpm db:push:test`
Expected: `Your database is now in sync with your Prisma schema.` nas duas.

- [ ] **Step 5: Rodar o teste**

Run: `cd eloscrm-api && pnpm vitest run test/audit-model.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/prisma/schema.prisma eloscrm-api/test/audit-model.test.ts
git commit -m "feat: adiciona o modelo de eventos de auditoria"
```

---

### Task 2: `Actor` e o helper de auditoria

**Files:**
- Create: `eloscrm-api/src/lib/actor.ts`
- Create: `eloscrm-api/src/lib/audit.ts`
- Test: `eloscrm-api/test/audit-lib.test.ts`

**Interfaces:**
- Consumes: `prisma.auditEvent`, `AuditEntity`, `AuditAction` (Task 1).
- Produces:
  - `type Actor = { id: string; name: string }` e `actorOf(request: FastifyRequest): Actor`
  - `type Changes = Record<string, { from: unknown; to: unknown }>`
  - `diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>): Changes`
  - `recordAudit(input: { orgId: string; entityType: AuditEntity; entityId: string; action: AuditAction;
    actor: Actor; changes?: Changes }): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/audit-lib.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { diffFields, recordAudit } from "../src/lib/audit.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `audit-lib-${stamp}@eloscrm.test`, `audit-lib-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("diffFields", () => {
  it("ignora campo ausente e campo igual", () => {
    const changes = diffFields({ name: "Ana", phone: "43999" }, { name: "Ana" });
    expect(changes).toEqual({});
  });

  it("registra de/para do que mudou", () => {
    const changes = diffFields({ name: "Ana", phone: "43999" }, { name: "Ana Paula", phone: null });
    expect(changes).toEqual({
      name: { from: "Ana", to: "Ana Paula" },
      phone: { from: "43999", to: null },
    });
  });

  it("compara Decimal do banco com number do payload sem falso positivo", () => {
    // Prisma.Decimal e o number do Zod precisam normalizar para a mesma forma
    const decimal = { toString: () => "500000" };
    expect(diffFields({ value: decimal }, { value: 500000 })).toEqual({});
    expect(diffFields({ value: decimal }, { value: 600000 })).toEqual({
      value: { from: "500000", to: "600000" },
    });
  });

  it("normaliza data para ISO e trata undefined como ausência", () => {
    const changes = diffFields(
      { dueAt: new Date("2026-01-01T12:00:00.000Z"), type: "CALL" },
      { dueAt: new Date("2026-02-02T12:00:00.000Z"), type: undefined },
    );
    expect(changes).toEqual({
      dueAt: { from: "2026-01-01T12:00:00.000Z", to: "2026-02-02T12:00:00.000Z" },
    });
  });
});

describe("recordAudit", () => {
  it("grava o evento com o ator", async () => {
    await recordAudit({
      orgId,
      entityType: AuditEntity.CLIENT,
      entityId: "cliente-audit-lib",
      action: AuditAction.CREATED,
      actor: { id: "user-9", name: "Corretora Ana" },
    });

    const [event] = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityId: "cliente-audit-lib" },
    });
    expect(event.action).toBe(AuditAction.CREATED);
    expect(event.actorName).toBe("Corretora Ana");
    expect(event.changes).toBeNull();
  });

  it("não grava evento de update sem mudança nenhuma", async () => {
    await recordAudit({
      orgId,
      entityType: AuditEntity.CLIENT,
      entityId: "cliente-sem-mudanca",
      action: AuditAction.UPDATED,
      actor: { id: "user-9", name: "Corretora Ana" },
      changes: {},
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityId: "cliente-sem-mudanca" },
    });
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/audit-lib.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/audit.js'`.

- [ ] **Step 3: Implementar `src/lib/actor.ts`**

```ts
import type { FastifyRequest } from "fastify";

export type Actor = { id: string; name: string };

// request.user é populado pelo authGuard; chamar isto em rota sem o guard é erro de programação
export const actorOf = (request: FastifyRequest): Actor => ({
  id: request.user!.id,
  name: request.user!.name,
});
```

- [ ] **Step 4: Implementar `src/lib/audit.ts`**

```ts
import type { AuditAction, AuditEntity } from "../generated/prisma/client.js";
import { prisma } from "./prisma.js";
import type { Actor } from "./actor.js";

export type Changes = Record<string, { from: unknown; to: unknown }>;

// O changes vai para uma coluna Json e precisa comparar os dois lados na mesma forma. Number e Decimal
// caem os dois em string: `value` chega do Zod como number e do Prisma como Decimal, e sem isso um
// PATCH que não mudou nada apareceria como 500000 -> "500000".
const normalize = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return String(value);
  return value;
};

export const diffFields = <T extends Record<string, unknown>>(before: T, after: Partial<T>): Changes => {
  const changes: Changes = {};
  for (const [field, rawNext] of Object.entries(after)) {
    // undefined é "campo não enviado no PATCH"; null é "limpar o campo" e conta como mudança
    if (rawNext === undefined) continue;
    const from = normalize(before[field]);
    const to = normalize(rawNext);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[field] = { from, to };
  }
  return changes;
};

export const recordAudit = async (input: {
  orgId: string;
  entityType: AuditEntity;
  entityId: string;
  action: AuditAction;
  actor: Actor;
  changes?: Changes;
}): Promise<void> => {
  // PATCH que não mudou nada não vira linha no histórico — senão a timeline enche de ruído
  if (input.changes && Object.keys(input.changes).length === 0) return;
  await prisma.auditEvent.create({
    data: {
      organizationId: input.orgId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actor.id,
      actorName: input.actor.name,
      changes: input.changes ?? undefined,
    },
  });
};
```

- [ ] **Step 5: Rodar o teste**

Run: `cd eloscrm-api && pnpm vitest run test/audit-lib.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/lib/actor.ts eloscrm-api/src/lib/audit.ts eloscrm-api/test/audit-lib.test.ts
git commit -m "feat: adiciona o ator de request e o helper de auditoria"
```

---

### Task 3: Auditoria em clientes (e o `actor` chegando nos services)

**Files:**
- Modify: `eloscrm-api/src/modules/clients/clients.service.ts`
- Modify: `eloscrm-api/src/routes/v1/clients/index.ts:20-41`
- Test: `eloscrm-api/test/clients-audit.test.ts`

**Interfaces:**
- Consumes: `Actor`, `actorOf`, `diffFields`, `recordAudit` (Task 2).
- Produces: assinaturas novas —
  `create(orgId: string, data: CreateClientInput, actor: Actor)`,
  `update(orgId: string, id: string, data: UpdateClientInput, actor: Actor)`,
  `remove(orgId: string, id: string, actor: Actor)`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/clients-audit.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";

const eventsOf = (entityId: string) =>
  prisma.auditEvent.findMany({
    where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId },
    orderBy: { createdAt: "asc" },
  });

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `cli-audit-${stamp}@eloscrm.test`, `cli-audit-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("auditoria de clientes", () => {
  it("registra criação, alteração e remoção com o autor da sessão", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Mariana Costa", source: "SITE" },
    });
    const client = created.json();

    const afterCreate = await eventsOf(client.id);
    expect(afterCreate).toHaveLength(1);
    expect(afterCreate[0].action).toBe(AuditAction.CREATED);
    // o helper de sessão faz sign-up com name "Corretor Teste"
    expect(afterCreate[0].actorName).toBe("Corretor Teste");

    await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { name: "Mariana Costa Silva", phone: "43999998888" },
    });

    const afterUpdate = await eventsOf(client.id);
    expect(afterUpdate).toHaveLength(2);
    expect(afterUpdate[1].action).toBe(AuditAction.UPDATED);
    expect(afterUpdate[1].changes).toEqual({
      name: { from: "Mariana Costa", to: "Mariana Costa Silva" },
      phone: { from: null, to: "43999998888" },
    });

    await app.inject({ method: "DELETE", url: `/v1/clients/${client.id}`, headers: { cookie } });

    const afterDelete = await eventsOf(client.id);
    expect(afterDelete).toHaveLength(3);
    expect(afterDelete[2].action).toBe(AuditAction.DELETED);
  });

  it("não registra evento quando o PATCH não muda nada", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Sem Mudança" },
    });
    const client = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { name: "Sem Mudança" },
    });

    const events = await eventsOf(client.id);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe(AuditAction.CREATED);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/clients-audit.test.ts`
Expected: FAIL — `expected [] to have a length of 1`.

- [ ] **Step 3: Auditar o service de clientes**

`src/modules/clients/clients.service.ts` inteiro:

```ts
import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/http-error.js";
import * as repo from "./clients.repo.js";
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from "./clients.schema.js";

export const list = (orgId: string, filters: ListClientsQuery) => repo.listClients(orgId, filters);

export const getById = async (orgId: string, id: string) => {
  const client = await repo.findClient(orgId, id);
  if (!client) throw notFound("Cliente não encontrado");
  return client;
};

export const create = async (orgId: string, data: CreateClientInput, actor: Actor) => {
  const client = await repo.createClient(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: client.id,
    action: AuditAction.CREATED,
    actor,
  });
  return client;
};

export const update = async (orgId: string, id: string, data: UpdateClientInput, actor: Actor) => {
  const before = await getById(orgId, id);
  const updated = await repo.updateClientById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  await getById(orgId, id);
  // o evento vem antes do delete: se gravar depois e a escrita falhar, o cliente some sem deixar rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    action: AuditAction.DELETED,
    actor,
  });
  await repo.deleteClientById(id);
};
```

- [ ] **Step 4: Passar o ator nas rotas**

Em `src/routes/v1/clients/index.ts`, importar `actorOf` e repassar:

```ts
import { actorOf } from "../../../lib/actor.js";
```

```ts
  app.post("/", async (request, reply) => {
    const data = createClientSchema.parse(request.body);
    const client = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(client);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updateClientSchema.parse(request.body);
    return service.update(request.orgId!, id, data, actorOf(request));
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id, actorOf(request));
    return reply.status(204).send();
  });
```

- [ ] **Step 5: Rodar os testes de clientes**

Run: `cd eloscrm-api && pnpm vitest run test/clients-audit.test.ts test/clients.test.ts`
Expected: PASS nos dois arquivos.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/modules/clients/clients.service.ts eloscrm-api/src/routes/v1/clients/index.ts eloscrm-api/test/clients-audit.test.ts
git commit -m "feat: audita as escritas de clientes"
```

---

### Task 4: Auditoria em negociações (com estágio e responsável nomeados)

Mudança de estágio é o evento mais consultado de um CRM, e `stageId` não diz nada para quem lê. O service
resolve os nomes antes de gravar.

**Files:**
- Modify: `eloscrm-api/src/modules/deals/deals.service.ts`
- Modify: `eloscrm-api/src/routes/v1/deals/index.ts`
- Test: `eloscrm-api/test/deals-audit.test.ts`

**Interfaces:**
- Consumes: `Actor`, `diffFields`, `recordAudit`, `actorOf`.
- Produces: `create(orgId, data: CreateDealInput, actor: Actor)`,
  `update(orgId, id, data: UpdateDealInput, actor: Actor)`, `remove(orgId, id, actor: Actor)`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/deals-audit.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let clientId = "";
let pipelineId = "";
let stages: { id: string; name: string }[] = [];

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `deal-audit-${stamp}@eloscrm.test`, `deal-audit-${stamp}`));

  const client = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Cliente do Funil" },
  });
  clientId = client.json().id;

  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const [pipeline] = pipelines.json();
  pipelineId = pipeline.id;
  stages = pipeline.stages;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("auditoria de negociações", () => {
  it("registra a mudança de estágio com os nomes de origem e destino", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: {
        clientId,
        pipelineId,
        stageId: stages[0].id,
        title: "Negociação auditada",
        value: 500000,
      },
    });
    const deal = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/deals/${deal.id}`,
      headers: { cookie },
      payload: { stageId: stages[1].id },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.DEAL, entityId: deal.id },
      orderBy: { createdAt: "asc" },
    });

    expect(events.map((e) => e.action)).toEqual([AuditAction.CREATED, AuditAction.STAGE_CHANGED]);
    expect(events[1].changes).toEqual({
      stage: { from: stages[0].name, to: stages[1].name },
    });
  });

  it("marca troca de responsável como OWNER_CHANGED", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId, pipelineId, stageId: stages[0].id, title: "Troca de dono" },
    });
    const deal = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/deals/${deal.id}`,
      headers: { cookie },
      payload: { ownerId: "outro-corretor" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.DEAL, entityId: deal.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events[1].action).toBe(AuditAction.OWNER_CHANGED);
    expect(events[1].changes).toEqual({ ownerId: { from: null, to: "outro-corretor" } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/deals-audit.test.ts`
Expected: FAIL — array de ações vazio.

- [ ] **Step 3: Auditar o service de negociações**

Em `src/modules/deals/deals.service.ts`, acrescentar os imports e substituir `create`, `update` e `remove`:

```ts
import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
```

```ts
// stageId no histórico não diz nada a quem lê; o nome do estágio é o que interessa
const stageNames = async (fromId: string, toId: string) => {
  const stages = await prisma.stage.findMany({
    where: { id: { in: [fromId, toId] } },
    select: { id: true, name: true },
  });
  const byId = new Map(stages.map((stage) => [stage.id, stage.name]));
  return { from: byId.get(fromId) ?? null, to: byId.get(toId) ?? null };
};

export const create = async (orgId: string, data: CreateDealInput, actor: Actor) => {
  await ensureRelationsInOrg(orgId, data);
  await assertStageInOrgPipeline(orgId, data.pipelineId, data.stageId);
  const deal = await repo.createDeal(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: deal.id,
    action: AuditAction.CREATED,
    actor,
  });
  return deal;
};

export const update = async (orgId: string, id: string, data: UpdateDealInput, actor: Actor) => {
  const deal = await getById(orgId, id);
  await ensureRelationsInOrg(orgId, data);
  // mover um negócio é sempre dentro do mesmo pipeline: pipelineId do update é ignorado
  const { pipelineId: _pipelineId, ...rest } = data;
  if (rest.stageId) await assertStageInOrgPipeline(orgId, deal.pipelineId, rest.stageId);

  const updated = await repo.updateDealById(id, rest);
  const changes = diffFields(deal, rest);

  if (changes.stageId) {
    // um PATCH pode mudar estágio e dono juntos; o movimento no funil é o que a timeline destaca
    const names = await stageNames(deal.stageId, rest.stageId!);
    delete changes.stageId;
    await recordAudit({
      orgId,
      entityType: AuditEntity.DEAL,
      entityId: id,
      action: AuditAction.STAGE_CHANGED,
      actor,
      changes: { stage: names, ...changes },
    });
    return updated;
  }

  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: id,
    action: changes.ownerId ? AuditAction.OWNER_CHANGED : AuditAction.UPDATED,
    actor,
    changes,
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  await getById(orgId, id);
  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: id,
    action: AuditAction.DELETED,
    actor,
  });
  await repo.deleteDealById(id);
};
```

- [ ] **Step 4: Passar o ator nas rotas de negociações**

Em `src/routes/v1/deals/index.ts`, adicionar o import e trocar as três chamadas:

```ts
import { actorOf } from "../../../lib/actor.js";
```

```ts
    const deal = await service.create(request.orgId!, data, actorOf(request));
```
```ts
    return service.update(request.orgId!, id, data, actorOf(request));
```
```ts
    await service.remove(request.orgId!, id, actorOf(request));
```

- [ ] **Step 5: Rodar os testes de negociações**

Run: `cd eloscrm-api && pnpm vitest run test/deals-audit.test.ts test/deals.test.ts`
Expected: PASS nos dois.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/modules/deals/deals.service.ts eloscrm-api/src/routes/v1/deals/index.ts eloscrm-api/test/deals-audit.test.ts
git commit -m "feat: audita as escritas de negociações"
```

---

### Task 5: Auditoria em imóveis e atividades

**Files:**
- Modify: `eloscrm-api/src/modules/properties/properties.service.ts`
- Modify: `eloscrm-api/src/routes/v1/properties/index.ts`
- Modify: `eloscrm-api/src/modules/activities/activities.service.ts`
- Modify: `eloscrm-api/src/routes/v1/activities/index.ts`
- Test: `eloscrm-api/test/properties-activities-audit.test.ts`

**Interfaces:**
- Consumes: `Actor`, `diffFields`, `recordAudit`, `actorOf`.
- Produces: `create/update/remove` de properties e activities com `actor: Actor` como último parâmetro.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/properties-activities-audit.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `pa-audit-${stamp}@eloscrm.test`, `pa-audit-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("auditoria de imóveis e atividades", () => {
  it("audita imóvel do cadastro à mudança de status", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/properties",
      headers: { cookie },
      payload: { title: "Casa auditada", status: "DISPONIVEL" },
    });
    const property = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/properties/${property.id}`,
      headers: { cookie },
      payload: { status: "RESERVADO" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.PROPERTY, entityId: property.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([AuditAction.CREATED, AuditAction.UPDATED]);
    expect(events[1].changes).toEqual({ status: { from: "DISPONIVEL", to: "RESERVADO" } });
  });

  it("audita atividade concluída", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/activities",
      headers: { cookie },
      payload: { type: "CALL", description: "Ligar para o cliente" },
    });
    const activity = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/activities/${activity.id}`,
      headers: { cookie },
      payload: { doneAt: "2026-07-29T12:00:00.000Z" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.ACTIVITY, entityId: activity.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([AuditAction.CREATED, AuditAction.UPDATED]);
    expect(events[1].changes).toEqual({
      doneAt: { from: null, to: "2026-07-29T12:00:00.000Z" },
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/properties-activities-audit.test.ts`
Expected: FAIL — arrays de ação vazios.

- [ ] **Step 3: Auditar `properties.service.ts`**

```ts
import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
```

```ts
export const create = async (orgId: string, data: CreatePropertyInput, actor: Actor) => {
  const property = await repo.createProperty(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.PROPERTY,
    entityId: property.id,
    action: AuditAction.CREATED,
    actor,
  });
  return property;
};

export const update = async (orgId: string, id: string, data: UpdatePropertyInput, actor: Actor) => {
  const before = await getById(orgId, id);
  const updated = await repo.updatePropertyById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.PROPERTY,
    entityId: id,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  await getById(orgId, id);
  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.PROPERTY,
    entityId: id,
    action: AuditAction.DELETED,
    actor,
  });
  await repo.deletePropertyById(id);
};
```

- [ ] **Step 4: Auditar `activities.service.ts`**

Mesmos imports; `create`, `update` e `remove` seguindo o formato acima, com
`entityType: AuditEntity.ACTIVITY` e mantendo as chamadas de `assertTenantRefs` que já existem:

```ts
export const create = async (orgId: string, data: CreateActivityInput, actor: Actor) => {
  await assertTenantRefs(orgId, data);
  const activity = await repo.createActivity(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.ACTIVITY,
    entityId: activity.id,
    action: AuditAction.CREATED,
    actor,
  });
  return activity;
};

export const update = async (orgId: string, id: string, data: UpdateActivityInput, actor: Actor) => {
  const before = await getById(orgId, id);
  await assertTenantRefs(orgId, data);
  const updated = await repo.updateActivityById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.ACTIVITY,
    entityId: id,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  // getById antes do delete: o repo apaga só por id, e sem esta checagem o delete cruzaria tenants
  await getById(orgId, id);
  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.ACTIVITY,
    entityId: id,
    action: AuditAction.DELETED,
    actor,
  });
  await repo.deleteActivityById(id);
};
```

- [ ] **Step 5: Passar o ator nas duas rotas**

Em `src/routes/v1/properties/index.ts` **e** em `src/routes/v1/activities/index.ts`, adicionar o import e
trocar as três chamadas em cada arquivo:

```ts
import { actorOf } from "../../../lib/actor.js";
```

Em properties:

```ts
    const property = await service.create(request.orgId!, data, actorOf(request));
```
```ts
    return service.update(request.orgId!, id, data, actorOf(request));
```
```ts
    await service.remove(request.orgId!, id, actorOf(request));
```

Em activities:

```ts
    const activity = await service.create(request.orgId!, data, actorOf(request));
```
```ts
    return service.update(request.orgId!, id, data, actorOf(request));
```
```ts
    await service.remove(request.orgId!, id, actorOf(request));
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `cd eloscrm-api && pnpm typecheck && pnpm test`
Expected: PASS — nenhum service ficou com chamada sem `actor`.

- [ ] **Step 7: Commit**

```bash
git add eloscrm-api/src/modules/properties eloscrm-api/src/modules/activities eloscrm-api/src/routes/v1/properties eloscrm-api/src/routes/v1/activities eloscrm-api/test/properties-activities-audit.test.ts
git commit -m "feat: audita as escritas de imóveis e atividades"
```

---

### Task 6: `GET /v1/audit-events`

**Files:**
- Create: `eloscrm-api/src/modules/audit/audit.schema.ts`
- Create: `eloscrm-api/src/modules/audit/audit.repo.ts`
- Create: `eloscrm-api/src/modules/audit/audit.service.ts`
- Create: `eloscrm-api/src/routes/v1/audit-events/index.ts`
- Test: `eloscrm-api/test/audit-events.test.ts`

**Interfaces:**
- Consumes: `prisma.auditEvent`, `AuditEntity`.
- Produces: `GET /v1/audit-events?entityType=<AuditEntity>&entityId=<id>&limit=<1..100>` → array de
  `{ id, entityType, entityId, action, actorId, actorName, changes, createdAt }`, mais recente primeiro.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/audit-events.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";
let clientId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `ev-a-${stamp}@eloscrm.test`, `ev-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `ev-b-${stamp}@eloscrm.test`, `ev-b-${stamp}`));

  const created = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Cliente com histórico" },
  });
  clientId = created.json().id;
  await app.inject({
    method: "PATCH",
    url: `/v1/clients/${clientId}`,
    headers: { cookie },
    payload: { phone: "43988887777" },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/audit-events", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit-events?entityType=CLIENT&entityId=x" });
    expect(res.statusCode).toBe(401);
  });

  it("valida entityType fora do enum (422)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit-events?entityType=BANANA&entityId=x",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("lista o histórico da entidade, mais recente primeiro", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit-events?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const events = res.json();
    expect(events.map((e: { action: string }) => e.action)).toEqual(["UPDATED", "CREATED"]);
    expect(events[0].changes).toEqual({ phone: { from: null, to: "43988887777" } });
  });

  it("não vaza histórico de outra organização", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit-events?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/audit-events.test.ts`
Expected: FAIL — 404 `Route GET:/v1/audit-events not found`.

- [ ] **Step 3: Criar schema, repo e service**

`src/modules/audit/audit.schema.ts`:

```ts
import * as z from "zod";
import { AuditEntity } from "../../generated/prisma/client.js";

export const listAuditQuerySchema = z.object({
  entityType: z.enum(AuditEntity),
  entityId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
```

`src/modules/audit/audit.repo.ts`:

```ts
import { prisma } from "../../lib/prisma.js";
import type { ListAuditQuery } from "./audit.schema.js";

export const listEvents = (orgId: string, filters: ListAuditQuery) =>
  prisma.auditEvent.findMany({
    where: { organizationId: orgId, entityType: filters.entityType, entityId: filters.entityId },
    orderBy: { createdAt: "desc" },
    take: filters.limit,
  });
```

`src/modules/audit/audit.service.ts`:

```ts
import * as repo from "./audit.repo.js";
import type { ListAuditQuery } from "./audit.schema.js";

export const list = (orgId: string, filters: ListAuditQuery) => repo.listEvents(orgId, filters);
```

- [ ] **Step 4: Criar a rota**

`src/routes/v1/audit-events/index.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { listAuditQuerySchema } from "../../../modules/audit/audit.schema.js";
import * as service from "../../../modules/audit/audit.service.js";

const auditEventsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listAuditQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });
};

export default auditEventsRoutes;
```

- [ ] **Step 5: Rodar o teste**

Run: `cd eloscrm-api && pnpm vitest run test/audit-events.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/modules/audit eloscrm-api/src/routes/v1/audit-events eloscrm-api/test/audit-events.test.ts
git commit -m "feat: expõe o histórico de auditoria por entidade"
```

---

### Task 7: `GET /v1/members`

Sem isto o card "Responsável" continua mostrando `—`: `ownerId` é um id solto e não há de onde tirar nome.

**Files:**
- Create: `eloscrm-api/src/modules/members/members.repo.ts`
- Create: `eloscrm-api/src/modules/members/members.service.ts`
- Create: `eloscrm-api/src/routes/v1/members/index.ts`
- Test: `eloscrm-api/test/members.test.ts`

**Interfaces:**
- Consumes: `prisma.member`.
- Produces: `GET /v1/members` → `[{ userId, name, email, role }]`, do mais antigo para o mais novo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/members.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
const email = `members-${stamp}@eloscrm.test`;

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, email, `members-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/members", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/members" });
    expect(res.statusCode).toBe(401);
  });

  it("lista quem é da organização ativa com nome, e-mail e papel", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/members", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const members = res.json();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ email, name: "Corretor Teste", role: "owner" });
    expect(members[0].userId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/members.test.ts`
Expected: FAIL — 404 `Route GET:/v1/members not found`.

- [ ] **Step 3: Criar repo e service**

`src/modules/members/members.repo.ts`:

```ts
import { prisma } from "../../lib/prisma.js";

export const listMembers = (orgId: string) =>
  prisma.member.findMany({
    where: { organizationId: orgId },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
```

`src/modules/members/members.service.ts`:

```ts
import * as repo from "./members.repo.js";

// achata o join: o front quer userId direto para casar com ownerId, não um objeto aninhado
export const list = async (orgId: string) => {
  const members = await repo.listMembers(orgId);
  return members.map((member) => ({
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
  }));
};
```

- [ ] **Step 4: Criar a rota**

`src/routes/v1/members/index.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import * as service from "../../../modules/members/members.service.js";

const membersRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => service.list(request.orgId!));
};

export default membersRoutes;
```

- [ ] **Step 5: Rodar o teste**

Run: `cd eloscrm-api && pnpm vitest run test/members.test.ts`
Expected: PASS — 2 testes.

- [ ] **Step 6: Commit**

```bash
git add eloscrm-api/src/modules/members eloscrm-api/src/routes/v1/members eloscrm-api/test/members.test.ts
git commit -m "feat: expõe o diretório de membros da organização"
```

---

### Task 8: Tipos e queries no web

**Files:**
- Modify: `eloscrm-web/lib/types.ts`
- Create: `eloscrm-web/lib/queries/audit.ts`
- Create: `eloscrm-web/lib/queries/members.ts`

**Interfaces:**
- Consumes: `GET /v1/audit-events`, `GET /v1/members`.
- Produces: `useAuditEvents(entityType, entityId)`, `useMembers()`, tipos `AuditEvent`, `AuditAction`,
  `AuditEntity`, `Member`.

- [ ] **Step 1: Declarar os tipos**

Acrescentar ao fim de `eloscrm-web/lib/types.ts`:

```ts
export type AuditEntity = "CLIENT" | "DEAL" | "PROPERTY" | "ACTIVITY";
export type AuditAction = "CREATED" | "UPDATED" | "DELETED" | "STAGE_CHANGED" | "OWNER_CHANGED";

export type AuditEvent = {
  id: string;
  entityType: AuditEntity;
  entityId: string;
  action: AuditAction;
  actorId: string | null;
  actorName: string | null;
  // { campo: { from, to } } — só os campos que mudaram
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
};

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
};
```

- [ ] **Step 2: Criar `lib/queries/audit.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { AuditEntity, AuditEvent } from "@/lib/types";

export const useAuditEvents = (entityType: AuditEntity, entityId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["audit-events", org?.id, entityType, entityId],
    queryFn: async () => {
      const { data } = await api.get<AuditEvent[]>("/audit-events", { params: { entityType, entityId } });
      return data;
    },
    enabled: !!org?.id && !!entityId,
  });
};
```

- [ ] **Step 3: Criar `lib/queries/members.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Member } from "@/lib/types";

export const useMembers = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["members", org?.id],
    queryFn: async () => {
      const { data } = await api.get<Member[]>("/members");
      return data;
    },
    enabled: !!org?.id,
  });
};
```

- [ ] **Step 4: Verificar**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint`
Expected: sem saída de erro nos dois.

- [ ] **Step 5: Commit**

```bash
git add eloscrm-web/lib/types.ts eloscrm-web/lib/queries/audit.ts eloscrm-web/lib/queries/members.ts
git commit -m "feat: consulta histórico e membros no web"
```

---

### Task 9: Aba Histórico e responsável de verdade na tela do lead

**Files:**
- Create: `eloscrm-web/app/(app)/clients/[id]/audit-feed.tsx`
- Modify: `eloscrm-web/lib/labels.ts`
- Modify: `eloscrm-web/app/(app)/clients/[id]/page.tsx:95-112` (lista de abas) e `:158-168` (card do responsável)

**Interfaces:**
- Consumes: `useAuditEvents`, `useMembers` (Task 8), tipos `AuditEvent`/`Member`.
- Produces: componente `AuditFeed({ entityType, entityId })`.

- [ ] **Step 1: Adicionar os rótulos em pt-BR**

Acrescentar a `eloscrm-web/lib/labels.ts`:

```ts
import type { AuditAction } from "@/lib/types";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATED: "criou",
  UPDATED: "alterou",
  DELETED: "removeu",
  STAGE_CHANGED: "moveu de estágio",
  OWNER_CHANGED: "trocou o responsável",
};

// nome do campo do banco não pode vazar para a tela
export const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  email: "E-mail",
  phone: "Telefone",
  source: "Origem",
  notes: "Observações",
  ownerId: "Responsável",
  stage: "Estágio",
  status: "Status",
  title: "Título",
  value: "Valor",
  dueAt: "Vencimento",
  doneAt: "Conclusão",
  lostReason: "Motivo da perda",
  description: "Descrição",
};
```

- [ ] **Step 2: Criar o componente `audit-feed.tsx`**

```tsx
"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { History } from "lucide-react";
import { useAuditEvents } from "@/lib/queries/audit";
import { AUDIT_ACTION_LABELS, FIELD_LABELS } from "@/lib/labels";
import type { AuditEntity } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

// null/undefined viram travessão; o resto é texto puro — o valor vem de uma coluna Json sem forma fixa
const showValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

export const AuditFeed = ({ entityType, entityId }: { entityType: AuditEntity; entityId: string }) => {
  const { data: events, isLoading } = useAuditEvents(entityType, entityId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!events?.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>Sem histórico</EmptyTitle>
          <EmptyDescription>As alterações feitas neste lead vão aparecer aqui.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 border-b pb-3 last:border-0">
          <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <History className="size-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm">
              <span className="font-medium">{event.actorName ?? "Alguém"}</span>{" "}
              {AUDIT_ACTION_LABELS[event.action]}
            </p>
            {event.changes ? (
              <ul className="space-y-0.5">
                {Object.entries(event.changes).map(([field, change]) => (
                  <li key={field} className="text-xs text-muted-foreground">
                    {FIELD_LABELS[field] ?? field}: {showValue(change.from)} → {showValue(change.to)}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {format(parseISO(event.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
};
```

- [ ] **Step 3: Ligar a aba e o responsável na página do lead**

Em `app/(app)/clients/[id]/page.tsx`, importar:

```tsx
import { AuditFeed } from "./audit-feed";
import { useMembers } from "@/lib/queries/members";
```

Dentro do componente, junto das outras queries — **acima dos early returns** de `page.tsx:69-80`. Hook
declarado depois de um `return` condicional quebra a ordem de hooks do React no primeiro carregamento:

```tsx
  const { data: members } = useMembers();
  const owner = members?.find((member) => member.userId === client?.ownerId) ?? null;
```

Substituir o conteúdo do card "Responsável" (hoje um `—` fixo):

```tsx
                  <p className="text-sm">{owner?.name ?? "Sem responsável"}</p>
```

Acrescentar o gatilho depois da aba "arquivos":

```tsx
          <TabsTrigger value="historico" className="data-active:text-primary after:bg-primary">
            Histórico
          </TabsTrigger>
```

E o conteúdo, depois do `TabsContent` de arquivos:

```tsx
        <TabsContent value="historico" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de alterações</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditFeed entityType="CLIENT" entityId={client.id} />
            </CardContent>
          </Card>
        </TabsContent>
```

- [ ] **Step 4: Verificar build e lint**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint && pnpm build`
Expected: os três sem erro.

- [ ] **Step 5: Conferir na tela**

Com API e web no ar (`./scripts/dev.sh`): abrir um lead, editar o telefone pelo diálogo, abrir a aba
**Histórico**.
Expected: uma linha `<seu nome> alterou · Telefone: — → <novo valor>` com data e hora, e o card
"Responsável" mostrando um nome quando o lead tiver `ownerId` (o seed preenche).

- [ ] **Step 6: Commit**

```bash
git add "eloscrm-web/app/(app)/clients/[id]/audit-feed.tsx" "eloscrm-web/app/(app)/clients/[id]/page.tsx" eloscrm-web/lib/labels.ts
git commit -m "feat: adiciona a aba de histórico e o responsável na tela do lead"
```

---

## Fechamento do plano A

Verificação final, com os dois projetos:

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm test
cd ../eloscrm-web && pnpm lint && pnpm typecheck && pnpm build
```

Depois disso, o plano B (descrição, tags, temperatura, orçamento e comentários) já pode ser escrito em
cima de `actor`/`recordAudit`, e o C (anexos no R2 e timeline unificada) em cima do
`src/lib/storage.ts` que já existe.

> Criado em 2026-07-29 10:52 (-03) · Última modificação: 2026-07-29 10:52 (-03)

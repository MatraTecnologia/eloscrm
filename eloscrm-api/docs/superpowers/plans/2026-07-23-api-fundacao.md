# Plano 1 — Fundação da API (elosCRM) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir a API Fastify com Postgres/Prisma 7 rust-free, Better Auth (organization plugin) e enforcement de multi-tenancy row-level, deixando login, troca de organização e isolamento de dados funcionando e verificados.

**Architecture:** Serviço Node/TypeScript standalone em `eloscrm-api`, seguindo o **Padrão A** do `~/.claude/STANDARDS.md`. Fastify v5 monta o handler catch-all do Better Auth em `/api/auth/*`. Prisma 7 rust-free (client gerado em `src/generated/prisma`, driver adapter `@prisma/adapter-pg`, `db push` sem migrations) é o ORM e o adapter de persistência do Better Auth. Dois guards em cadeia (`authGuard` → `orgGuard`) decoram o request com `session`, `user` e `orgId`; toda query de domínio filtra por `orgId`. Este plano entrega a fundação — os módulos REST vêm no Plano 2.

**Tech Stack:** Node 22+ (ambiente: v24.18.0), TypeScript, pnpm 11.9.0, Fastify v5, @fastify/cors, Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), Better Auth (+ organization plugin), T3 Env (`@t3-oss/env-core`) + Zod, Vitest, tsx.

## Global Constraints

Estas regras vêm do `~/.claude/STANDARDS.md` (Padrão A) e do `CLAUDE.md` deste projeto. Valem para todas as tasks.

- Package manager **pnpm**, versão exata `pnpm@11.9.0` em `packageManager` — nunca `pnpm@latest`.
- **Prisma 7 rust-free:** generator `prisma-client`, client em `src/generated/prisma`, importado por caminho **relativo** — **NUNCA** `@prisma/client`. Driver adapter `@prisma/adapter-pg` obrigatório na instanciação.
- **Sem migrations** — usar `prisma db push`. Não criar `prisma/migrations/`.
- `DATABASE_URL` configurado em **`prisma.config.ts`**, não via `env()` no `schema.prisma`.
- **T3 Env + Zod** em **`src/env.ts`** (`createEnv` de `@t3-oss/env-core`) — nunca `process.env` cru fora desse arquivo.
- Rotas de domínio com registro manual em `src/routes/` (relevante a partir do Plano 2).
- **Multi-tenancy por sessão** (`activeOrganizationId` do Better Auth) — divergência deliberada do STANDARDS, documentada no `CLAUDE.md`. **Não** usar header `X-Workspace-Id`.
- `const` arrow functions; sem `console.log` em código entregue; comentar só o "porquê" não-trivial.
- Strings/UI em pt-BR; identificadores (variáveis, funções, rotas) em inglês.
- Commits em português, imperativo ("adiciona", "corrige"). Nunca `--no-verify`.
- Testes **pragmáticos** (STANDARDS: "não exigir TDD estrito") — cobrir lógica de negócio, casos de borda e regressões. Antes de declarar pronto, rodar `pnpm typecheck` e `pnpm test` e confirmar a saída real.
- `.env*` nunca commitado, exceto `.env.example` (sem segredos).
- Segredos deste ambiente (a **rotacionar** após estabilizar — foram expostos em chat):
  - `DATABASE_URL=postgres://postgres:tkalkoljutiu9lo5pz0o@easypanel4.matratecnologia.com:4498/eloscrm?sslmode=disable`
  - `BETTER_AUTH_SECRET=Pt9rDOMG7JlVaFE6QpUF53VF1oDlcdjY`
- Roles do organization plugin: `owner`, `admin`, `member`.
- Enums de domínio:
  - `ClientSource`: `SITE | INSTAGRAM | INDICACAO | WHATSAPP | OUTROS`
  - `DealStage`: `NOVO_LEAD | CONTATO | QUALIFICADO | VISITA | PROPOSTA | FECHADO | PERDIDO`
  - `ActivityType`: `CALL | VISIT | PROPOSAL | NOTE`
  - `PropertyStatus`: `DISPONIVEL | RESERVADO | VENDIDO | INATIVO`

---

## File Structure

```
eloscrm-api/
  package.json            scripts, deps, packageManager
  tsconfig.json           TS strict, module NodeNext
  prisma.config.ts        schema path + datasource url (Prisma 7)
  .env                    (não commitado)
  .env.example            template commitado
  vitest.config.ts        config de testes
  prisma/
    schema.prisma         generator prisma-client + models + enums
    seed.ts               imobiliária demo
  src/
    env.ts                T3 Env + Zod (única leitura de process.env)
    generated/prisma/     client gerado (git-ignored)
    lib/
      prisma.ts           PrismaClient + PrismaPg adapter
      auth.ts             betterAuth (prismaAdapter + organization)
    plugins/
      error-handler.ts    envelope { error: { code, message, details? } }
      cors.ts             @fastify/cors com credentials
      auth-handler.ts     catch-all /api/auth/*
      auth-guard.ts       preHandler → request.session / request.user
      org-guard.ts        preHandler → request.orgId
    routes/               (Plano 2 — rotas de domínio)
    app.ts                buildApp() sem listen
    server.ts             listen
  test/
    setup.ts              dotenv
    helpers/app.ts
    env.test.ts  health.test.ts  auth-flow.test.ts
    org-guard.test.ts  tenant-isolation.test.ts
```

---

### Task 1: Migrar o bootstrap para o Padrão A (T3 Env)

**Contexto:** o commit `e720d3c` criou o bootstrap com Zod puro em `src/lib/env.ts`, antes de descobrirmos que o `STANDARDS.md` exige T3 Env em `src/env.ts`. Esta task corrige isso e ajusta os scripts para `db push`.

**Files:**
- Create: `eloscrm-api/src/env.ts`
- Delete: `eloscrm-api/src/lib/env.ts`
- Modify: `eloscrm-api/package.json` (deps + scripts)
- Modify: `eloscrm-api/test/env.test.ts`
- Modify: `eloscrm-api/.env.example`
- Modify: `eloscrm-api/.gitignore`

**Interfaces:**
- Produces: `env` de `src/env.ts` — `{ DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, WEB_ORIGIN, PORT }`, todas server-side, validadas por Zod via `createEnv`.

- [ ] **Step 1: Instalar T3 Env e remover o env antigo**

```bash
pnpm add @t3-oss/env-core
```

Deletar `src/lib/env.ts` (será substituído por `src/env.ts`).

- [ ] **Step 2: Criar `src/env.ts` com T3 Env**

```typescript
import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(10),
    BETTER_AUTH_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    PORT: z.coerce.number().default(3333),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 3: Atualizar `package.json` — scripts do Padrão A**

Substituir o bloco `scripts` por:
```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/server.js",
  "test": "vitest run",
  "typecheck": "tsc --noEmit",
  "db:generate": "prisma generate",
  "db:push": "prisma db push",
  "db:seed": "tsx prisma/seed.ts",
  "auth:generate": "pnpm dlx @better-auth/cli generate --output prisma/schema.prisma"
}
```

Não deve existir script `db:migrate` — o Padrão A não usa migrations.

- [ ] **Step 4: Ignorar o client gerado**

Adicionar ao `.gitignore`:
```
src/generated
```

- [ ] **Step 5: Documentar o bootstrap do `.env`**

Adicionar no topo do `.env.example`:
```
# Copie para .env e preencha antes de rodar `pnpm dev` ou `pnpm test`:
#   cp .env.example .env
```

Isso resolve um achado da revisão anterior: sem `.env`, `pnpm test` falha com ZodError obscuro num clone limpo.

- [ ] **Step 6: Atualizar `test/env.test.ts` para o novo caminho**

```typescript
import { describe, it, expect } from "vitest";

describe("env", () => {
  it("carrega e valida variáveis obrigatórias", async () => {
    const { env } = await import("../src/env.js");
    expect(env.DATABASE_URL).toBeTruthy();
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThan(10);
    expect(env.PORT).toBe(3333);
  });
});
```

- [ ] **Step 7: Verificar**

Run: `pnpm typecheck; pnpm test`
Expected: typecheck exit 0; teste de env passando. Confirmar que nenhum arquivo além de `src/env.ts` lê `process.env`.

- [ ] **Step 8: Commit**

```bash
git add src/env.ts package.json test/env.test.ts .env.example .gitignore
git rm src/lib/env.ts
git commit -m "refatora env para T3 Env conforme Padrão A"
```

---

### Task 2: Prisma 7 rust-free + Better Auth + schema

**Files:**
- Create: `eloscrm-api/prisma.config.ts`
- Create: `eloscrm-api/prisma/schema.prisma`
- Create: `eloscrm-api/src/lib/prisma.ts`
- Create: `eloscrm-api/src/lib/auth.ts`

**Interfaces:**
- Produces: `prisma` (PrismaClient com adapter PrismaPg) de `src/lib/prisma.ts`.
- Produces: `auth` (Better Auth, com `auth.handler` e `auth.api.getSession`) de `src/lib/auth.ts`.
- Produces: models `Organization`, `Member`, `Client`, `Deal`, `Activity`, `Property` + enums.

- [ ] **Step 1: Instalar Prisma 7 e o driver adapter**

```bash
pnpm add @prisma/adapter-pg better-auth
pnpm add -D prisma
```

Nota: **não** instalar `@prisma/client` — no Padrão A o client vem do output gerado.

- [ ] **Step 2: Criar `prisma/schema.prisma` base**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

A `url` não vai aqui — vem do `prisma.config.ts`.

- [ ] **Step 3: Criar `prisma.config.ts`**

```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

type Env = {
  DATABASE_URL: string;
};

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env<Env>("DATABASE_URL"),
  },
});
```

O `import "dotenv/config"` é necessário: o Prisma 7 não carrega `.env` automaticamente quando há `prisma.config.ts`.

- [ ] **Step 4: Gerar o client base (OBRIGATÓRIO antes do CLI do Better Auth)**

Run: `pnpm db:generate`
Expected: "Generated Prisma Client" em `src/generated/prisma`.

Por que este passo existe: `src/lib/auth.ts` importa `src/lib/prisma.ts`, que instancia o client no topo do módulo. O `@better-auth/cli generate` do Step 7 importa `auth.ts` e falharia se o client ainda não existisse.

- [ ] **Step 5: Criar `src/lib/prisma.ts`**

```typescript
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../env.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
```

- [ ] **Step 6: Criar `src/lib/auth.ts`**

```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { prisma } from "./prisma.js";
import { env } from "../env.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.WEB_ORIGIN, "http://localhost"],
  emailAndPassword: { enabled: true },
  plugins: [organization()],
});
```

`"http://localhost"` em `trustedOrigins` é necessário para os testes via `app.inject`.

- [ ] **Step 7: Gerar os models do Better Auth**

Run: `pnpm auth:generate`
Expected: adiciona `User`, `Session`, `Account`, `Verification`, `Organization`, `Member`, `Invitation` ao `schema.prisma`.

Verificar depois: `model Session` deve conter `activeOrganizationId String?`. Se faltar, o organization plugin não foi detectado — revisar o Step 6.

- [ ] **Step 8: Adicionar enums e models de domínio ao `schema.prisma`**

```prisma
enum ClientSource { SITE INSTAGRAM INDICACAO WHATSAPP OUTROS }
enum DealStage { NOVO_LEAD CONTATO QUALIFICADO VISITA PROPOSTA FECHADO PERDIDO }
enum ActivityType { CALL VISIT PROPOSAL NOTE }
enum PropertyStatus { DISPONIVEL RESERVADO VENDIDO INATIVO }

model Client {
  id             String        @id @default(cuid())
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  ownerId        String?
  name           String
  email          String?
  phone          String?
  source         ClientSource  @default(OUTROS)
  notes          String?
  deals          Deal[]
  activities     Activity[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@index([organizationId])
}

model Property {
  id             String         @id @default(cuid())
  organizationId String
  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  title          String
  type           String?
  address        String?
  price          Decimal?
  bedrooms       Int?
  area           Float?
  status         PropertyStatus @default(DISPONIVEL)
  photos         String[]
  deals          Deal[]
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  @@index([organizationId])
}

model Deal {
  id             String        @id @default(cuid())
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  clientId       String
  client         Client        @relation(fields: [clientId], references: [id], onDelete: Cascade)
  propertyId     String?
  property       Property?     @relation(fields: [propertyId], references: [id], onDelete: SetNull)
  ownerId        String?
  title          String
  value          Decimal?
  stage          DealStage     @default(NOVO_LEAD)
  lostReason     String?
  activities     Activity[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@index([organizationId, stage])
}

model Activity {
  id             String        @id @default(cuid())
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  clientId       String?
  client         Client?       @relation(fields: [clientId], references: [id], onDelete: Cascade)
  dealId         String?
  deal           Deal?         @relation(fields: [dealId], references: [id], onDelete: Cascade)
  type           ActivityType
  description    String
  dueAt          DateTime?
  doneAt         DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@index([organizationId])
  @@index([organizationId, dueAt])
}
```

Adicionar ao `model Organization` (gerado no Step 7) as relações inversas: `clients Client[]`, `properties Property[]`, `deals Deal[]`, `activities Activity[]`.

- [ ] **Step 9: Aplicar o schema no banco (db push, sem migrations)**

Run: `pnpm db:push`
Expected: "Your database is now in sync with your Prisma schema." Não deve criar `prisma/migrations/`.

- [ ] **Step 10: Regenerar o client e verificar**

Run: `pnpm db:generate; pnpm typecheck`
Expected: client com `prisma.client`, `prisma.deal`, `prisma.activity`, `prisma.property`; typecheck exit 0.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma.config.ts src/lib/prisma.ts src/lib/auth.ts package.json
git commit -m "adiciona prisma 7 rust-free e better auth com organization plugin"
```

---

### Task 3: App Fastify + CORS + error-handler + auth handler + health

**Files:**
- Create: `eloscrm-api/src/plugins/error-handler.ts`
- Create: `eloscrm-api/src/plugins/cors.ts`
- Create: `eloscrm-api/src/plugins/auth-handler.ts`
- Create: `eloscrm-api/src/app.ts`
- Create: `eloscrm-api/src/server.ts`
- Create: `eloscrm-api/test/helpers/app.ts`
- Test: `eloscrm-api/test/health.test.ts`

**Interfaces:**
- Consumes: `auth` de `src/lib/auth.ts`; `env` de `src/env.ts`.
- Produces: `buildApp(): Promise<FastifyInstance>` de `src/app.ts` (sem `listen`).
- Produces: `GET /health` → `{ status: "ok" }`; catch-all `/api/auth/*`.

- [ ] **Step 1: Instalar dependências**

```bash
pnpm add fastify @fastify/cors fastify-plugin
```

- [ ] **Step 2: Criar `src/plugins/error-handler.ts`**

```typescript
import fp from "fastify-plugin";
import { ZodError } from "zod";

export const errorHandler = fp(async (app) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: { code: "VALIDATION", message: "Dados inválidos", details: error.issues },
      });
    }
    const status = error.statusCode ?? 500;
    return reply.status(status).send({
      error: { code: error.code ?? "INTERNAL", message: error.message },
    });
  });
});
```

- [ ] **Step 3: Criar `src/plugins/cors.ts`**

```typescript
import fp from "fastify-plugin";
import cors from "@fastify/cors";
import { env } from "../env.js";

export const corsPlugin = fp(async (app) => {
  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
});
```

- [ ] **Step 4: Criar `src/plugins/auth-handler.ts`**

```typescript
import fp from "fastify-plugin";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

export const authHandler = fp(async (app) => {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });
});
```

- [ ] **Step 5: Criar `src/app.ts`**

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { errorHandler } from "./plugins/error-handler.js";
import { corsPlugin } from "./plugins/cors.js";
import { authHandler } from "./plugins/auth-handler.js";

export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: true });
  await app.register(errorHandler);
  await app.register(corsPlugin);
  await app.register(authHandler);
  app.get("/health", async () => ({ status: "ok" }));
  return app;
};
```

- [ ] **Step 6: Criar `src/server.ts`**

```typescript
import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./env.js";

const start = async () => {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
};

start();
```

O `import "dotenv/config"` vem **primeiro**: `env.ts` valida no import e falharia sem as variáveis carregadas.

- [ ] **Step 7: Criar `test/helpers/app.ts`**

```typescript
import { buildApp } from "../../src/app.js";

export const makeApp = async () => {
  const app = await buildApp();
  await app.ready();
  return app;
};
```

- [ ] **Step 8: Criar `test/health.test.ts`**

```typescript
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe("health", () => {
  it("GET /health responde ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 9: Verificar**

Run: `pnpm typecheck; pnpm test`
Expected: typecheck exit 0; health passando.

Smoke test: `pnpm dev` e em outro terminal `curl http://localhost:3333/health` → `{"status":"ok"}`. Parar o servidor depois.

- [ ] **Step 10: Commit**

```bash
git add src/app.ts src/server.ts src/plugins test/helpers test/health.test.ts package.json
git commit -m "adiciona app fastify com cors, tratamento de erros e handler de auth"
```

---

### Task 4: authGuard — injeta session/user (401)

**Files:**
- Create: `eloscrm-api/src/plugins/auth-guard.ts`
- Modify: `eloscrm-api/src/app.ts`
- Test: `eloscrm-api/test/auth-flow.test.ts`

**Interfaces:**
- Consumes: `auth.api.getSession`; `prisma` (limpeza no teste).
- Produces: `authGuard` — `preHandler` que popula `request.session`/`request.user`, com `401` se não houver sessão. Estende `FastifyRequest` com `session` e `user`.

- [ ] **Step 1: Criar `src/plugins/auth-guard.ts`**

```typescript
import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

declare module "fastify" {
  interface FastifyRequest {
    session: NonNullable<AuthSession>["session"] | null;
    user: NonNullable<AuthSession>["user"] | null;
  }
}

export const authGuardPlugin = fp(async (app) => {
  app.decorateRequest("session", null);
  app.decorateRequest("user", null);
});

export const authGuard = async (request: FastifyRequest, reply: FastifyReply) => {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!result) {
    return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Não autenticado" } });
  }
  request.session = result.session;
  request.user = result.user;
};
```

- [ ] **Step 2: Registrar no `src/app.ts`**

Após `await app.register(authHandler);`:
```typescript
await app.register(authGuardPlugin);

app.get("/v1/me", { preHandler: authGuard }, async (request) => ({
  userId: request.user?.id,
  email: request.user?.email,
}));
```

Importar `authGuardPlugin` e `authGuard` de `./plugins/auth-guard.js`.

- [ ] **Step 3: Criar `test/auth-flow.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const email = `corretor-${stamp}@eloscrm.test`;

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await app.close();
  await prisma.$disconnect();
});

describe("auth flow", () => {
  it("bloqueia /v1/me sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("cria conta e retorna sessão em /v1/me", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email, password: "senha123456", name: "Corretor Teste" },
    });
    expect([200, 201]).toContain(signup.statusCode);
    const cookie = signup.headers["set-cookie"];
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: Array.isArray(cookie) ? cookie.join("; ") : String(cookie) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(email);
  });
});
```

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck; pnpm vitest run test/auth-flow.test.ts`
Expected: ambos os casos passando. Se o signup falhar por origin, conferir `trustedOrigins` em `src/lib/auth.ts` (deve incluir `"http://localhost"`).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/auth-guard.ts src/app.ts test/auth-flow.test.ts
git commit -m "adiciona authGuard com sessão e usuário no request"
```

---

### Task 5: orgGuard + testes de enforcement e isolamento

**Files:**
- Create: `eloscrm-api/src/plugins/org-guard.ts`
- Modify: `eloscrm-api/src/app.ts`
- Test: `eloscrm-api/test/org-guard.test.ts`
- Test: `eloscrm-api/test/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `request.session` (do `authGuard`), campo `activeOrganizationId`.
- Produces: `orgGuard` — `preHandler` encadeado após `authGuard`, popula `request.orgId`, com `403` (`NO_ACTIVE_ORG`) se não houver org ativa.

- [ ] **Step 1: Criar `src/plugins/org-guard.ts`**

```typescript
import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    orgId: string | null;
  }
}

export const orgGuardPlugin = fp(async (app) => {
  app.decorateRequest("orgId", null);
});

export const orgGuard = async (request: FastifyRequest, reply: FastifyReply) => {
  const activeOrgId = request.session?.activeOrganizationId ?? null;
  if (!activeOrgId) {
    return reply.status(403).send({
      error: { code: "NO_ACTIVE_ORG", message: "Nenhuma imobiliária ativa na sessão" },
    });
  }
  request.orgId = activeOrgId;
};
```

- [ ] **Step 2: Registrar no `src/app.ts`**

Após `await app.register(authGuardPlugin);`:
```typescript
await app.register(orgGuardPlugin);

app.get("/v1/org-scope", { preHandler: [authGuard, orgGuard] }, async (request) => ({
  orgId: request.orgId,
}));
```

- [ ] **Step 3: Criar `test/org-guard.test.ts` — o enforcement de verdade**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const email = `owner-${stamp}@eloscrm.test`;
let cookie = "";
let orgId = "";

const asCookie = (raw: string | string[] | undefined) =>
  Array.isArray(raw) ? raw.join("; ") : String(raw);

beforeAll(async () => {
  app = await makeApp();
  const signup = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: "senha123456", name: "Owner Guard" },
  });
  cookie = asCookie(signup.headers["set-cookie"]);
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: `guard-${stamp}` } });
  await prisma.user.deleteMany({ where: { email } });
  await app.close();
  await prisma.$disconnect();
});

describe("orgGuard", () => {
  it("responde 403 quando a sessão não tem organização ativa", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/org-scope", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NO_ACTIVE_ORG");
  });

  it("expõe o orgId após criar e ativar uma organização", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/auth/organization/create",
      headers: { cookie },
      payload: { name: "Imob Guard", slug: `guard-${stamp}` },
    });
    expect([200, 201]).toContain(created.statusCode);
    orgId = created.json().id ?? created.json().organization?.id;

    const activated = await app.inject({
      method: "POST",
      url: "/api/auth/organization/set-active",
      headers: { cookie },
      payload: { organizationId: orgId },
    });
    expect(activated.statusCode).toBe(200);
    const activeCookie = activated.headers["set-cookie"]
      ? asCookie(activated.headers["set-cookie"])
      : cookie;

    const res = await app.inject({
      method: "GET",
      url: "/v1/org-scope",
      headers: { cookie: activeCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().orgId).toBe(orgId);
  });
});
```

- [ ] **Step 4: Criar `test/tenant-isolation.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma.js";

describe("isolamento de tenant (row-level)", () => {
  const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA = "", orgB = "", clientA = "", clientB = "";

  beforeAll(async () => {
    const a = await prisma.organization.create({ data: { name: "Imob A", slug: `imob-a-${stamp}` } });
    const b = await prisma.organization.create({ data: { name: "Imob B", slug: `imob-b-${stamp}` } });
    orgA = a.id; orgB = b.id;
    const ca = await prisma.client.create({ data: { organizationId: orgA, name: "Lead A" } });
    const cb = await prisma.client.create({ data: { organizationId: orgB, name: "Lead B" } });
    clientA = ca.id; clientB = cb.id;
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.$disconnect();
  });

  it("query filtrada por orgA não retorna clientes de orgB", async () => {
    const rows = await prisma.client.findMany({ where: { organizationId: orgA } });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(clientA);
    expect(ids).not.toContain(clientB);
  });

  it("buscar clientB dentro do escopo de orgA retorna null", async () => {
    const found = await prisma.client.findFirst({ where: { id: clientB, organizationId: orgA } });
    expect(found).toBeNull();
  });
});
```

Atenção ao escopo deste teste: ele exercita o `where` do Prisma, não o enforcement da aplicação. Quem cobre o enforcement é o `org-guard.test.ts` do Step 3.

- [ ] **Step 5: Verificar a suíte inteira**

Run: `pnpm typecheck; pnpm test`
Expected: todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/org-guard.ts src/app.ts test/org-guard.test.ts test/tenant-isolation.test.ts
git commit -m "adiciona orgGuard com escopo por organização ativa e testes de isolamento"
```

---

### Task 6: Seed de dados demo

**Files:**
- Create: `eloscrm-api/prisma/seed.ts`

**Interfaces:**
- Consumes: `prisma` de `src/lib/prisma.ts`; enums do client gerado.
- Produces: imobiliária demo com clientes, deals espalhados por stage e atividades.

- [ ] **Step 1: Criar `prisma/seed.ts`**

```typescript
import "dotenv/config";
import { DealStage, ClientSource, ActivityType } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";

const clientsData = [
  { name: "Carlos Silva", source: ClientSource.SITE, stage: DealStage.NOVO_LEAD },
  { name: "Mariana Costa", source: ClientSource.INSTAGRAM, stage: DealStage.CONTATO },
  { name: "Lucas Almeida", source: ClientSource.INDICACAO, stage: DealStage.QUALIFICADO },
  { name: "Ana Pereira", source: ClientSource.WHATSAPP, stage: DealStage.VISITA },
];

const run = async () => {
  const org = await prisma.organization.upsert({
    where: { slug: "imob-demo" },
    update: {},
    create: { name: "Imobiliária Demo", slug: "imob-demo" },
  });

  for (const c of clientsData) {
    const client = await prisma.client.create({
      data: { organizationId: org.id, name: c.name, source: c.source },
    });
    await prisma.deal.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        title: `Negociação — ${c.name}`,
        stage: c.stage,
        value: 250000,
      },
    });
    await prisma.activity.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        type: ActivityType.CALL,
        description: `Primeiro contato com ${c.name}`,
        dueAt: new Date(),
      },
    });
  }
};

run().finally(() => prisma.$disconnect());
```

Se o caminho de import dos enums não resolver, conferir o arquivo real gerado em `src/generated/prisma/` e ajustar (o generator `prisma-client` pode expor `client.ts` ou `index.ts` conforme a versão).

- [ ] **Step 2: Rodar o seed**

Run: `pnpm db:seed`
Expected: cria a org demo + 4 clientes, 4 deals, 4 atividades sem erro.

O seed é idempotente na organização (`upsert` por slug) mas cria clientes/deals novos a cada execução — rodar uma vez.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "adiciona seed com imobiliária demo"
```

---

## Self-Review

**Spec coverage:**
- Padrão A (pnpm, Prisma 7 rust-free, db push, prisma.config.ts, T3 Env) → Tasks 1–2.
- Arquitetura dois-apps / stack API → Tasks 2–3.
- Multi-tenancy por sessão + RBAC + organization plugin → Tasks 2, 4, 5.
- Enforcement de tenant (`orgGuard`: 403 sem org ativa, `orgId` correto) → Task 5, Step 3.
- Sanidade do filtro row-level → Task 5, Step 4 (**não** cobre enforcement da aplicação).
- Modelo de dados + enums + decisões (agenda como view, fotos `String[]`, `propertyId` opcional) → Task 2.
- Envelope de erro único → Task 3.
- Seed → Task 6.
- Endpoints de domínio, camada web → **fora deste plano** (Planos 2–4).

**Lacuna conhecida, coberta no Plano 2:** nenhum teste aqui prova que um *recurso REST* de org A é invisível para sessão de org B — não existem rotas de domínio ainda. O Plano 2 deve abrir com um teste de rota cross-org (sessão de A pedindo `/v1/clients/:id` de B → 404) antes de implementar os módulos.

**Ordem de geração (armadilha):** `db:generate` (Task 2, Step 4) precede obrigatoriamente `auth:generate` (Step 7), porque o CLI do Better Auth importa `auth.ts` → `prisma.ts`, que instancia o client no topo do módulo.

**Carregamento de `.env`:** `prisma.config.ts`, `src/server.ts`, `prisma/seed.ts` e `test/setup.ts` importam `dotenv/config` — `src/env.ts` valida no import e falha sem as variáveis. Único ponto que lê `process.env` é `src/env.ts`.

**Nota de fronteira para o Plano 3 (Web):** o `eloscrm-web/AGENTS.md` exige ler `node_modules/next/dist/docs/` antes de escrever código Next — este build do Next 16 tem breaking changes que o Context7 não reflete.

---

> Criado em 2026-07-23 16:50 (-03) · Última modificação: 2026-07-23 17:01 (-03)

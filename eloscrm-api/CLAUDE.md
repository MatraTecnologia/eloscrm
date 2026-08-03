# eloscrm-api

API do **elosCRM** — CRM multi-tenant para imobiliárias. Núcleo do produto: funil de vendas (leads → negociação).

Consome: `eloscrm-web` (Next.js App Router). Os dois vivem no mesmo repo git, mas são projetos
independentes — sem `package.json` na raiz, sem workspace/turbo ligando um ao outro; cada um instala
e roda por conta própria. Visão geral dos dois: `../CLAUDE.md`.

## Padrão

Este projeto segue o **Padrão A** do `~/.claude/STANDARDS.md`:

- **pnpm** (`pnpm@11.9.0`), Node 22+ (ambiente atual: v24.18.0)
- **Prisma 7 rust-free** — generator `prisma-client`, client em `src/generated/prisma`
  (import relativo, **nunca** `@prisma/client`), driver adapter `@prisma/adapter-pg`
- **Sem migrations** — `prisma db push`
- `DATABASE_URL` em `prisma.config.ts`
- **T3 Env + Zod** em `src/env.ts` — nunca `process.env` cru
- Rotas com registro manual em `src/routes/`
- `@prisma/client` fica em `dependencies` (não é resíduo): o client gerado do Prisma 7 rust-free
  importa `@prisma/client/runtime/*` internamente, e sob o node_modules estrito do pnpm o pacote
  precisa estar declarado no projeto para resolver. A regra "nunca `@prisma/client`" vale para
  imports em código autoral — esses continuam só via `src/generated/prisma` (import relativo).

## Divergência deliberada do STANDARDS

**Multi-tenancy é por sessão, não por header.**

O STANDARDS descreve multi-tenant por header (`X-Enterprise-Id` / `X-Workspace-Id`). Aqui o tenant
vem do `activeOrganizationId` da sessão do Better Auth (organization plugin), decidido explicitamente
no design do MVP.

**Por quê:** o cliente não escolhe o próprio tenant — elimina a necessidade de validar header contra
membership a cada request e reduz a superfície de vazamento entre imobiliárias. O organization plugin
do Better Auth já modela `User ↔ Member ↔ Organization` e persiste a org ativa na sessão.

## Arquitetura

- **Tenant** = `Organization` (uma imobiliária). Usuário pertence a N organizations e alterna a ativa.
- **Roles:** `owner` (dono), `admin` (gestor), `member` (corretor).
- **Isolamento row-level:** toda tabela de domínio carrega `organizationId`; nenhuma query de domínio
  roda sem filtro por org.
- **Cadeia de guards:** `authGuard` (sessão válida → `request.user`/`request.session`) →
  `orgGuard` (org ativa → `request.orgId`). Os guards são aplicados **por arquivo de rota**
  (`app.addHook("preHandler", …)` ou `{ preHandler: [authGuard, orgGuard] }`), nunca globalmente:
  rota nova que esquecer os hooks fica **aberta**. Só os plugins de decorator
  (`authGuardPlugin`/`orgGuardPlugin`) são registrados em `src/app.ts`, e eles apenas declaram
  `request.session`/`request.user`/`request.orgId`. Padrão a copiar: `src/routes/v1/deals/index.ts`.
- **Erros:** envelope único `{ error: { code, message, details? } }`.

## Comandos

```bash
pnpm dev                                  # tsx watch src/server.ts
pnpm test                                 # vitest run
pnpm test test/deals.test.ts              # arquivo único
pnpm vitest run test/deals.test.ts -t "…" # teste único por nome
pnpm lint                                 # oxlint
pnpm typecheck                            # tsc --noEmit
pnpm build                                # tsc
pnpm db:push                              # aplica o schema no banco de dev (sem migrations)
pnpm db:push:test                         # o mesmo no banco de teste (.env.test)
pnpm db:generate                          # prisma generate (client em src/generated, gitignored)
pnpm db:seed                              # tsx prisma/seed.ts
pnpm auth:generate                        # regera os models do Better Auth no schema.prisma
```

**Pré-requisitos (clone novo).** `./scripts/setup.sh` na raiz do repo faz tudo; manualmente:

- `pnpm install && pnpm db:generate` — `src/generated/` não é versionado e todo o código importa dele.
- `cp .env.example .env` + `pnpm db:push` — dev aponta para o Postgres local (`docker compose up -d`
  na raiz, ou qualquer Postgres na 5432).
- `cp .env.test.example .env.test` + `pnpm db:push:test` — **banco separado**, exclusivo dos testes.
  Não há mocks nem banco em memória: os testes sobem o app inteiro (`test/helpers/app.ts`) e fazem
  sign-up de verdade em `/api/auth/*` via `app.inject`. Com `requireEmailVerification` ligado o
  sign-up não devolve sessão: `test/helpers/session.ts` marca `emailVerified` no banco e faz o
  sign-in em seguida. Teste novo deve usar esse helper, nunca ler o cookie da resposta do sign-up.

**Isolamento dos testes.** `test/global-setup.ts` trunca todas as tabelas uma vez antes da run;
`test/setup.ts` carrega `.env.test` com `override: true` em cada worker. Os arquivos rodam em
paralelo e cada um cria a própria organização — por isso não há cleanup em `afterAll`, e não faz
sentido reintroduzir correntes de `deleteMany`. Timeouts em 15s por causa do bcrypt do sign-up.

**Lint.** É **oxlint**, não ESLint (`typescript-eslint` ainda não suporta o TypeScript 7 do projeto).
`.oxlintrc.json` liga a categoria `correctness` e transforma em regra duas convenções que antes só
existiam neste documento: `no-console` (liberado em `prisma/` e `scripts/`, que são CLI) e
`no-restricted-imports` de `@prisma/client`.

**Verificação antes de declarar pronto:** rodar `pnpm typecheck` e `pnpm test` e conferir a saída real.

## Convenções

- `const` arrow functions; sem `console.log` em código entregue
- Comentar só o "porquê" não-trivial
- Strings/UI em pt-BR; identificadores (variáveis, funções, rotas) em inglês
- Commits em português, imperativo ("adiciona", "corrige")
- Arquivos focados e pequenos, uma responsabilidade cada

## Docs

- Spec do MVP: `docs/superpowers/specs/2026-07-23-eloscrm-mvp-design.md`
- Plano da fundação: `docs/superpowers/plans/2026-07-23-api-fundacao.md`

> Criado em 2026-07-23 17:01 (-03) · Última modificação: 2026-08-03 18:05 (-03)

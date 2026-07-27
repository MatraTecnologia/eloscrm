# eloscrm-api

API do **elosCRM** — CRM multi-tenant para imobiliárias. Núcleo do produto: funil de vendas (leads → negociação).

Consome: `eloscrm-web` (Next.js App Router). Repositórios independentes, não é workspace único.

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
  `orgGuard` (org ativa → `request.orgId`).
- **Erros:** envelope único `{ error: { code, message, details? } }`.

## Comandos

```bash
pnpm dev            # tsx watch src/server.ts
pnpm test           # vitest run
pnpm typecheck      # tsc --noEmit
pnpm build          # tsc
pnpm db:push        # prisma db push (sem migrations)
pnpm db:generate    # prisma generate
pnpm db:seed        # tsx prisma/seed.ts
```

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

> Criado em 2026-07-23 17:01 (-03) · Última modificação: 2026-07-23 17:58 (-03)

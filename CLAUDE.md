# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# elosCRM

CRM multi-tenant para imobiliárias. Núcleo do produto: funil de vendas (leads → negociação).

## Layout do repositório

Um único repo git com **dois projetos independentes** — não há `package.json` na raiz, nem turbo/workspace ligando os dois. Cada projeto instala e roda por conta própria:

- `eloscrm-api/` — Fastify 5 + Prisma 7 + Better Auth. Ver `eloscrm-api/CLAUDE.md` para padrões, multi-tenancy e convenções (não duplicadas aqui).
- `eloscrm-web/` — Next.js 16 (App Router) + React 19 + TanStack Query + shadcn/ui.

pnpm é o gerenciador pretendido (a API pinna `pnpm@11.9.0`, ambos têm `pnpm-workspace.yaml`). `eloscrm-web` ainda versiona um `package-lock.json` além do `pnpm-lock.yaml` — resquício do `create-next-app`; conferir com o usuário antes de mexer.

`eloscrm-web/CLAUDE.md` é só `@AGENTS.md`, cujo conteúdo é uma regra importante: **esta versão do Next tem breaking changes em relação ao conhecimento de treino — ler o guia relevante em `eloscrm-web/node_modules/next/dist/docs/` antes de escrever código de Next.**

## Comandos

### eloscrm-api

```bash
pnpm dev                                  # tsx watch src/server.ts (porta 3333)
pnpm test                                 # vitest run
pnpm test test/deals.test.ts              # arquivo único
pnpm vitest run test/deals.test.ts -t "…" # teste único por nome
pnpm typecheck                            # tsc --noEmit
pnpm build                                # tsc -> dist/
pnpm db:push                              # prisma db push (sem migrations)
pnpm db:generate                          # gera o client em src/generated/prisma (gitignored)
pnpm db:seed                              # tsx prisma/seed.ts
pnpm auth:generate                        # regera os models do Better Auth no schema.prisma
```

Clone novo: `pnpm install && pnpm db:generate` antes de qualquer `typecheck`/`test` — `src/generated/` não é versionado e todo o código importa dele.

### eloscrm-web

```bash
pnpm dev     # next dev (porta 3000)
pnpm build   # next build
pnpm lint    # eslint
```

Não existe script de `typecheck` no web — a verificação de tipos vem do `pnpm build` (ou `npx tsc --noEmit`). O web também não tem `.env.example`: sem `NEXT_PUBLIC_API_URL`, `lib/api.ts` e `lib/auth-client.ts` caem no default `http://localhost:3333`.

## Testes dependem de Postgres real

Não há mocks nem banco em memória. `test/setup.ts` é apenas `import "dotenv/config"`, e os testes sobem o app inteiro (`test/helpers/app.ts` → `buildApp()`) fazendo sign-up de verdade via `app.inject` em `/api/auth/*` (`test/helpers/session.ts`).

- É obrigatório ter `.env` preenchido (`cp .env.example .env`) com `DATABASE_URL` apontando para um Postgres acessível.
- `vitest.config.ts` sobe `testTimeout`/`hookTimeout` para 30s porque o bcrypt do sign-up roda em processo e o Postgres é remoto.
- O mesmo config faz `server.deps.inline` de `@fastify/autoload`: sob NodeNext, os imports com sufixo `.js` das rotas não resolvem para os `.ts` no Vitest sem isso.

## Contrato entre os dois projetos

- **Auth é servida pelo Fastify**, não pelo Next: `authHandler` monta o Better Auth em `/api/auth/*` na API. O web fala com ela via `lib/auth-client.ts` (`baseURL = NEXT_PUBLIC_API_URL`, default `http://localhost:3333`).
- **Domínio fica em `/v1/*`**: `lib/api.ts` cria o axios com `baseURL = ${API_URL}/v1` — ou seja, as rotas de auth ficam *fora* desse client, propositalmente.
- **Sessão por cookie**: `withCredentials: true` no axios e `credentials: "include"` no auth client, contra um CORS pinado em `WEB_ORIGIN` com `credentials: true`. Origem errada = cookie não viaja.
- **Tenant vem da sessão**: `activeOrganizationId` → `request.orgId` na API. No web, todo query key embute `org?.id` e usa `enabled: !!org?.id` (`useActiveOrganization`) — trocar de organização invalida o cache naturalmente.
- **Envelope de erro `{ error: { code, message, details? } }`**: o interceptor do axios rejeita já com o `error` desembrulhado, e em 401 redireciona para `/login`.
- **Tipos duplicados à mão**: `eloscrm-web/lib/types.ts` espelha os models/enums do Prisma. Não há pacote compartilhado — mudança de schema exige editar os dois lados.

## Caminho de uma request na API

`src/routes/v1/<x>/index.ts` → `src/modules/<x>/<x>.service.ts` → `src/modules/<x>/<x>.repo.ts`

- **Route**: faz `schema.parse()` (Zod) do body/query e chama o service. O prefixo da rota vem do **caminho da pasta** (`@fastify/autoload`), e cada arquivo registra em `app.get("/")`.
- **Service**: recebe `orgId` como primeiro argumento, valida relações cross-entidade dentro da org e lança `notFound()`/`httpError()` de `lib/http-error.ts`.
- **Repo**: única camada que toca o `prisma`. Toda query de domínio filtra por `organizationId`.

Dois pontos sensíveis à segurança:

- `authGuard` e `orgGuard` são adicionados **por arquivo de rota** (`app.addHook("preHandler", …)` ou `{ preHandler: [...] }`), não globalmente. Rota nova sem os hooks fica **desprotegida** — copiar o padrão de `src/routes/v1/deals/index.ts`.
- Só o `authGuardPlugin`/`orgGuardPlugin` (decorators) são globais em `src/app.ts`; eles apenas declaram `request.session`/`request.user`/`request.orgId`.

Módulos existentes: `clients`, `deals`, `pipelines` (+ `stages`), `properties`, `activities`, `agenda`, `dashboard`.

## Estrutura do web

- `lib/queries/<recurso>.ts` — um arquivo por recurso com os hooks de TanStack Query (`useDeals`, `useCreateDeal`, …). Mutations invalidam por prefixo de key; `useUpdateDeal` faz optimistic update no move entre estágios do kanban.
- `app/(app)/<rota>/` — página + componentes locais colocados juntos (dialogs, cards, hooks específicos). `app/(app)/layout.tsx` é client component e faz o gate de sessão + sidebar.
- `app/(auth)/login/` — fora do gate.
- `components/ui/` — shadcn (style `base-vega`, base color `neutral`, ícones Lucide); `components/app/` — shell da aplicação (sidebar, org switcher, user menu).
- `lib/providers.tsx` — QueryClient (`staleTime` 30s, `retry` 1, sem refetch on focus), Sonner e devtools.

## Docs

- Spec do MVP: `eloscrm-api/docs/superpowers/specs/2026-07-23-eloscrm-mvp-design.md`
- Plano da fundação: `eloscrm-api/docs/superpowers/plans/2026-07-23-api-fundacao.md`

> Criado em 2026-07-27 10:13 (-03) · Última modificação: 2026-07-27 10:13 (-03)

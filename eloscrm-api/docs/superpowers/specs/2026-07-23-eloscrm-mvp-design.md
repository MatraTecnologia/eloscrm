# elosCRM — MVP · Spec Técnico

> CRM multi-tenant para imobiliárias. Núcleo: **funil de vendas** (leads → negociação).
> Modelo de tenancy estilo Slack-workspace (usuário pertence a N imobiliárias).

## 1. Objetivo e escopo

**Coração do produto:** funil de vendas. Captar leads, movê-los pelo funil Kanban, registrar atividades. Imóvel é dado de apoio.

**Escopo da v1 (tudo incluído, com Imóveis/Agenda/Dashboard em versão enxuta):**

- Clientes/Leads
- Negociações (funil Kanban arrastável)
- Atividades / Timeline
- Dashboard (KPIs + gráficos)
- Imóveis (cadastro de apoio)
- Agenda (view das atividades com data)

**Fora do MVP (YAGNI, versões futuras):** upload real de arquivos, contratos/locação, relatórios avançados/exportação, integrações externas (portais, WhatsApp API), billing/planos, super-admin de plataforma, notificações push/e-mail transacional além do convite.

## 2. Identidade visual

- **Paleta:** `#2563EB` primária · `#0F172A` secundária/dark · `#7C3AED` destaque · `#10B981` sucesso · `#64748B` neutro · `#F8FAFC` fundo
- **Tipografia:** Poppins (Regular / Medium / SemiBold / Bold)
- **Slogan:** "Conectando oportunidades"
- **Assets:** `eloscrm-web/public/` (logo-oficial.svg, logo-white.svg, logo-bicolor.svg, icone.png)
- **Base de UI:** shadcn/ui tematizado com a paleta acima; Poppins como fonte global.

## 3. Arquitetura

Dois apps separados (já refletido no disco):

```
eloscrm-web  (Next 16 / React 19 / Tailwind 4 / shadcn / TanStack Query / Axios)
     │  HTTP (withCredentials)
     ▼
eloscrm-api  (Fastify / Zod / Better Auth + organization plugin / Prisma)
     │
     ▼
Postgres (EasyPanel)
```

### Stack consolidada

| Camada | Tecnologias |
|---|---|
| **Web** | Next 16, React 19, Tailwind 4, shadcn/ui, TanStack Query, Axios |
| **API** | Fastify 5, Prisma 7 rust-free (`prisma-client` + `@prisma/adapter-pg`), Better Auth (+ organization plugin), T3 Env + Zod |
| **DB** | Postgres (EasyPanel) — schema via `db push`, sem migrations |

> **Padrão A do `~/.claude/STANDARDS.md`.** Este projeto segue o Padrão A: pnpm, Prisma 7 rust-free com client em `src/generated/prisma` (import relativo, nunca `@prisma/client`), `db push` sem migrations, `DATABASE_URL` em `prisma.config.ts`, T3 Env em `src/env.ts`, rotas com registro manual em `src/routes/`.
>
> **Divergência deliberada:** o STANDARDS descreve multi-tenant por header (`X-Workspace-Id`); aqui o tenant vem do `activeOrganizationId` da sessão — decisão explícita, registrada no `CLAUDE.md` do `eloscrm-api`.

> ⚠️ O `AGENTS.md` da web avisa que **este Next.js (16) tem breaking changes** vs. versões conhecidas. Consultar `eloscrm-web/node_modules/next/dist/docs/` antes de escrever código Next. Idem para Tailwind 4 (config CSS-first, sem `tailwind.config.js` clássico).

## 4. Multi-tenancy & Autenticação

- **Tenant = `Organization`** (uma imobiliária). Usuário pertence a N organizations via `Member`; a sessão carrega a **active organization**. Troca de contexto por seletor no header.
- **RBAC (roles do Better Auth org plugin):** `owner` (dono), `admin` (gestor), `member` (corretor). Convites por e-mail via plugin.
- **Isolamento de dados: row-level.** Toda tabela de negócio carrega `organizationId`. Nenhuma query de domínio roda sem filtro por org.
- **Better Auth vive na API.** Web consome via `better-auth/react`.
- **Sessão:** cookie httpOnly cross-subdomain (cookie em `.eloscrm.com`, servindo `app.` e `api.`). Dev: `localhost:3000` (web) ↔ `localhost:3333` (api) com CORS + `credentials`.
- **Enforcement na API:** cadeia `authGuard` → `orgGuard` (resolve active org → injeta `orgId` no request) → handler. Camada de repositório **sempre** aplica `where: { organizationId: orgId }`.

## 5. Modelo de dados (Prisma)

Tabelas do Better Auth: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`.

Domínio CRM (todas com `organizationId`, `createdAt`, `updatedAt`):

| Entidade | Campos principais |
|---|---|
| **Client** | nome, email, telefone, `source` (enum), `ownerId` (corretor→user), notas |
| **Property** | título, tipo, endereço, preço, quartos, área, `status`, `photos String[]` |
| **Deal** | título, `clientId`, `propertyId?`, valor, `stage` (enum), `ownerId`, `lostReason?` |
| **Activity** | `dealId?` / `clientId?`, `type` (enum), descrição, `dueAt?`, `doneAt?` |

**Decisões fechadas:**
- Agenda **não é tabela** — é uma view das `Activity` que têm `dueAt`.
- Fotos de imóvel = `String[]` de URLs (sem upload real no MVP).
- `Deal.propertyId` **opcional** (lead sem imóvel definido).

**Enums:**
- `ClientSource`: `SITE | INSTAGRAM | INDICACAO | WHATSAPP | OUTROS`
- `DealStage`: `NOVO_LEAD | CONTATO | QUALIFICADO | VISITA | PROPOSTA | FECHADO | PERDIDO`
- `ActivityType`: `CALL | VISIT | PROPOSAL | NOTE`
- `PropertyStatus`: `DISPONIVEL | RESERVADO | VENDIDO | INATIVO`

## 6. API REST

- Prefixo versionado `/v1`. Validação I/O com Zod.
- Envelope de erro único: `{ error: { code, message, details? } }`.
- Toda rota de domínio: `authGuard` → `orgGuard` → handler.

| Recurso | Rotas |
|---|---|
| Auth | `/api/auth/*` (Better Auth: signup, login, logout, session, org, invite) |
| Clients | `GET/POST /v1/clients` (filtros: source, ownerId, q) · `GET/PATCH/DELETE /v1/clients/:id` |
| Deals | `GET/POST /v1/deals` (filtros: stage, ownerId) · `PATCH/DELETE /v1/deals/:id` (PATCH move de stage) |
| Activities | `GET/POST /v1/activities` (filtros: clientId\|dealId, type) · `PATCH /v1/activities/:id` (done, reagendar) |
| Properties | `GET/POST /v1/properties` · `GET/PATCH/DELETE /v1/properties/:id` |
| Dashboard | `GET /v1/dashboard/stats` (KPIs + funil + por origem) |
| Agenda | `GET /v1/agenda?from&to` (activities com dueAt no range) |

## 7. Camada de dados no front

- `_lib/api.ts` — instância Axios: `baseURL`, `withCredentials: true`, interceptor de resposta (401 → redireciona login; normaliza envelope de erro).
- **TanStack Query** — hooks por recurso (`useClients`, `useDeals`, `useUpdateDeal`, …). Query keys namespaceadas por org: `['deals', orgId, filters]` — troca de tenant invalida cache.
- **Kanban** com **optimistic update** no move de stage (rollback em falha).

## 8. Estrutura de pastas

```
eloscrm-api/src/
  modules/{clients,deals,activities,properties,dashboard}/
    *.routes.ts  *.service.ts  *.repo.ts  *.schema.ts   (arquivos focados por feature)
  lib/        prisma.ts  auth.ts  env.ts
  plugins/    auth-guard.ts  org-guard.ts  error-handler.ts  cors.ts
  prisma/     schema.prisma  seed.ts

eloscrm-web/app/
  (app)/  dashboard/  clients/  deals/  properties/  agenda/  settings/
  _components/  ui/ (shadcn)  domain/
  _lib/  api.ts  queries/ (hooks TanStack)
```

## 9. Tratamento de erros

- **API:** plugin `error-handler` central. Zod inválido → `422`; não autenticado → `401`; org/role sem permissão → `403`; ausente → `404`; interno → `500`. Sempre no envelope único.
- **Web:** interceptor Axios normaliza; feedback via toasts shadcn (`sonner`). `401` → redireciona login e limpa cache do Query.

## 10. Testes (pragmático)

- **API (Vitest):** services e repos dos módulos; **teste crítico de isolamento de tenant** (garantir que org A nunca lê dados de org B). Banco de teste dedicado.
- **Web:** testes leves de hooks de Query e do fluxo de move do Kanban (optimistic + rollback).
- Não perseguir cobertura ampla no MVP — focar no que quebra silenciosamente (tenant leak, move de stage).

## 11. Ambiente & Segredos

- `.env` na API: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_ORIGIN` (CORS). Nunca commitado (`.env*` já no `.gitignore`).
- **Rotacionar** `BETTER_AUTH_SECRET` e a senha do Postgres — foram expostos em chat durante o brainstorm.
- Prod: habilitar `sslmode=require` no Postgres (atualmente `disable`, ok só em dev).
- **Seed:** uma imobiliária demo + leads/deals/atividades de exemplo, pra o dashboard não nascer vazio.

## 12. Sequência de build sugerida

1. `git init` no monorepo raiz `C:\Dev\eloscrm` (hoje só a web é repo).
2. API: bootstrap Fastify + Prisma + schema + Better Auth (org plugin) + guards.
3. Migração inicial + seed.
4. Módulos da API: clients → deals → activities → properties → dashboard/agenda.
5. Web: setup shadcn + tema elosCRM + Poppins + Axios/Query + auth (login, seletor de org).
6. Telas: layout/sidebar → Clientes → Negociações (Kanban) → Timeline → Dashboard → Imóveis → Agenda.

---

> Criado em 2026-07-23 16:40 (-03) · Última modificação: 2026-07-23 16:40 (-03)

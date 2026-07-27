@AGENTS.md

# eloscrm-web

Front do **elosCRM** — CRM multi-tenant para imobiliárias. Next.js 16 (App Router) + React 19 +
TanStack Query + shadcn/ui.

Consome a API `eloscrm-api` (Fastify), que vive no mesmo repo git mas é um projeto independente —
sem workspace ligando os dois. Visão geral: `../CLAUDE.md`. Padrões e arquitetura da API:
`../eloscrm-api/CLAUDE.md`.

## Comandos

```bash
pnpm dev     # next dev (porta 3000)
pnpm build   # next build — também é a checagem de tipos
pnpm lint    # eslint (flat config, core-web-vitals + typescript)
```

Não há script de `typecheck`: usar `pnpm build` ou `npx tsc --noEmit`. Não há testes.

Não há `.env.example`. A única env é `NEXT_PUBLIC_API_URL`; sem ela, `lib/api.ts` e
`lib/auth-client.ts` caem no default `http://localhost:3333` (a API precisa estar de pé).

## Comunicação com a API

Dois clients, propositalmente separados:

- `lib/api.ts` — axios com `baseURL = ${API_URL}/v1` e `withCredentials: true`. Só domínio.
  O interceptor desembrulha o envelope `{ error: { code, message } }` da API (o `catch` recebe já o
  `error`, não o response) e, em 401 fora de `/login`, redireciona para `/login`.
- `lib/auth-client.ts` — Better Auth (`better-auth/react` + `organizationClient`) apontando para a
  **raiz** da API, porque as rotas de auth ficam em `/api/auth/*`, fora do `/v1`. Exporta
  `signIn`/`signOut`/`useSession`/`organization`/`useListOrganizations`/`useActiveOrganization`.

Sessão é por cookie: o CORS da API é pinado em `WEB_ORIGIN` com `credentials: true` — rodar o front
em outra origem quebra o login silenciosamente (cookie não viaja).

## Multi-tenant no cliente

O tenant vem do `activeOrganizationId` da sessão, não de header. Consequência prática em todo hook
de dado:

```ts
const { data: org } = useActiveOrganization();
useQuery({ queryKey: ["deals", org?.id, pipelineId], enabled: !!org?.id, … });
```

O `org?.id` na query key é obrigatório — é o que faz o cache trocar sozinho quando o usuário muda de
imobiliária no `OrgSwitcher` (`authClient.organization.setActive`). Hook novo que esquecer isso
mostra dados da org anterior.

## Estrutura

- `lib/queries/<recurso>.ts` — um arquivo por recurso (`clients`, `deals`, `pipelines`,
  `properties`, `agenda`, `dashboard`) com os hooks de TanStack Query. Mutations invalidam por
  prefixo de key (`["deals"]`). `useUpdateDeal` faz optimistic update do move entre estágios do
  kanban (snapshot → rollback no `onError`).
- `app/(app)/<rota>/` — página + componentes locais colocados juntos (dialogs, cards, hooks
  específicos como `use-org-deals.ts`). Componente só sobe para `components/` quando é usado por
  mais de uma rota.
- `app/(app)/layout.tsx` — client component: gate de sessão (`useSession` → `router.replace("/login")`)
  + `SidebarProvider`. `app/(auth)/login/` fica fora do gate.
- `components/app/` — shell (`app-sidebar`, `org-switcher`, `user-menu`).
- `components/ui/` — shadcn, style `base-vega`, base color `neutral`, ícones Lucide. Adicionar via
  CLI do shadcn; não editar à mão sem motivo.
- `lib/types.ts` — models e enums da API espelhados **à mão**. Não há pacote compartilhado: mudança
  no `schema.prisma` exige editar aqui também.
- `lib/labels.ts` — tradução dos enums para pt-BR (`clientSourceLabels`, etc.) e `formatCurrency`.
  Nenhum enum cru deve aparecer na UI.

## Convenções

- `const` arrow functions; `"use client"` só onde precisa (hooks/estado) — a maior parte das páginas
  é client por causa do TanStack Query.
- UI em pt-BR; identificadores em inglês.
- **Nunca emoji na UI** — ícones Lucide.
- Cores de gráfico: usar `CHART_COLORS` de `app/(app)/dashboard/chart-colors.ts`, cuja ordem foi
  escolhida para não deixar adjacentes o par com pior separação para daltonismo.
- Kanban usa HTML5 drag-and-drop nativo (`draggable`), sem lib de DnD.

> Criado em 2026-07-27 10:22 (-03) · Última modificação: 2026-07-27 10:22 (-03)

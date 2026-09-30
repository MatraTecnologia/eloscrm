# AGENTS.md

Este arquivo orienta os agentes que trabalham neste repositório.

# elosCRM

CRM multi-tenant para imobiliárias. Núcleo do produto: funil de vendas (leads → negociação).

## Layout do repositório

Um único repo git com **dois projetos independentes** — não há `package.json` na raiz, nem turbo/workspace ligando os dois. Cada projeto instala e roda por conta própria:

- `eloscrm-api/` — Fastify 5 + Prisma 7 + Better Auth. Ver `eloscrm-api/AGENTS.md` para padrões, multi-tenancy e convenções (não duplicadas aqui).
- `eloscrm-web/` — Next.js 16 (App Router) + React 19 + TanStack Query + shadcn/ui.

pnpm em ambos (`pnpm@11.25.0` nos dois), Node 24+.

Na raiz ficam a documentação e as ferramentas de ambiente: `docker-compose.yml` (Postgres e Redis do projeto), `scripts/setup.sh`, `scripts/dev.sh` e `.github/workflows/ci.yml`. O código da aplicação fica nos dois projetos.

`eloscrm-web/AGENTS.md` contém as instruções do frontend, incluindo uma regra importante: **esta versão do Next tem breaking changes em relação ao conhecimento de treino — ler o guia relevante em `eloscrm-web/node_modules/next/dist/docs/` antes de escrever código de Next.**

## Setup e comandos

Com o Postgres disponível e os bancos `eloscrm_dev` e `eloscrm_test` criados, rode `./scripts/setup.sh`: copia os `.env` dos exemplos, gera `BETTER_AUTH_SECRET`, instala deps nos dois projetos, gera o client do Prisma e aplica o schema nos bancos de dev e de teste. O script não sobe serviços nem cria os bancos.

`./scripts/dev.sh` sobe API (3333) e web (3000) juntos; Ctrl-C derruba os dois (o script usa `set -m` para matar a árvore, senão o node fica órfão segurando a porta).

`docker compose up -d` na raiz sobe `eloscrm-postgres` na 5432 (cria `eloscrm_dev` e `eloscrm_test` na primeira inicialização do volume) e `eloscrm-redis` na 6379. Quem já tem os serviços nessas portas pode reutilizá-los; no Postgres, crie os dois bancos. Para subir só o banco, use `docker compose up -d postgres`.

O compose não inclui S3. Uploads e testes de storage exigem um serviço S3 compatível configurado pelas envs `R2_*` da API. Os exemplos usam SeaweedFS local na 8333; o bucket privado de dev é `eloscrm-private`. A suíte cria o bucket de teste no serviço configurado em `.env.test`.

### eloscrm-api

```bash
pnpm dev                                  # tsx watch src/server.ts (porta 3333)
pnpm test                                 # vitest run
pnpm test test/deals.test.ts              # arquivo único
pnpm vitest run test/deals.test.ts -t "…" # teste único por nome
pnpm lint                                 # oxlint
pnpm typecheck                            # tsc --noEmit
pnpm build                                # tsc -> dist/
pnpm db:push                              # aplica o schema no banco de dev (sem migrations)
pnpm db:push:test                         # o mesmo no banco de teste (.env.test)
pnpm db:generate                          # gera o client em src/generated/prisma (gitignored)
pnpm db:seed                              # tsx prisma/seed.ts
pnpm auth:generate                        # regera os models do Better Auth no schema.prisma
```

Clone novo sem `setup.sh`: `pnpm install && pnpm db:generate` antes de qualquer `typecheck`/`test` — `src/generated/` não é versionado e todo o código importa dele.

O lint é **oxlint**, não ESLint: `typescript-eslint` ainda não suporta o TypeScript 7 que o projeto usa. Config em `.oxlintrc.json`, com as duas regras que existiam só como convenção escrita — `no-console` e `no-restricted-imports` de `@prisma/client`.

### eloscrm-web

```bash
pnpm dev        # next dev (porta 3000)
pnpm build      # next build
pnpm lint       # eslint
pnpm typecheck  # tsc --noEmit
```

Única env: `NEXT_PUBLIC_API_URL` (ver `.env.example`); sem ela, `lib/api.ts` e `lib/auth-client.ts` caem no default `http://localhost:3333`.

## Testes dependem de Postgres real

O Postgres é real, sem mocks nem banco em memória; uazapi e Graph API são mockadas. Os testes sobem o app inteiro (`test/helpers/app.ts` → `buildApp()`) e fazem sign-up de verdade via `app.inject` em `/api/auth/*` (`test/helpers/session.ts`). Como `requireEmailVerification` está ligado, o sign-up não abre sessão: o helper marca `emailVerified` no banco e só então faz o sign-in — nenhum teste deve voltar a ler o cookie direto da resposta do sign-up.

- **Banco separado do de dev.** `test/setup.ts` carrega `.env.test` com `override: true`, então o `DATABASE_URL` de teste vence qualquer coisa já presente no ambiente. Nunca apontar esse arquivo para o banco de dev ou para um remoto.
- **Limpeza é global, não por arquivo.** `test/global-setup.ts` trunca todas as tabelas uma vez antes da run. Os arquivos rodam em paralelo e cada um cria a própria organização, então não há cleanup em `afterAll` — não reintroduza correntes de `deleteMany`.
- `vitest.config.ts` mantém `testTimeout`/`hookTimeout` em 15s: os fluxos de auth e banco real precisam de margem no runner de CI. O Better Auth usa scrypt para as senhas; o projeto não configura um algoritmo próprio.
- O mesmo config faz `server.deps.inline` de `@fastify/autoload`: sob NodeNext, os imports com sufixo `.js` das rotas não resolvem para os `.ts` no Vitest sem isso.
- O logger do Fastify fica desligado quando `NODE_ENV=test` (`src/app.ts`), senão o log de request por teste soterra a saída do Vitest.

## CI

`.github/workflows/ci.yml`, em push para `main` e em todo PR. Job `api`: Postgres 17 e MinIO local para os testes de storage, `db:generate` → `db:push` → `lint` → `typecheck` → `test` → `build`, com as envs no próprio job (sem `.env` no runner — o `dotenv` do `test/setup.ts` simplesmente não encontra arquivo e o ambiente prevalece). Job `web`: `lint` → `typecheck` → `build`.

Os dois jobs passam `package_json_file` ao `pnpm/action-setup`: `defaults.run.working-directory` só afeta steps `run`, e sem apontar o arquivo a action procura o `packageManager` no `package.json` da raiz — que não existe aqui.

## Deploy: aplicar o schema é passo manual

**Todo deploy que leva schema novo exige `prisma db push` no banco de produção, à mão, antes de subir a imagem.** Não há migrations (é o Padrão A) e nada no pipeline aplica schema: o `Dockerfile` roda `db:generate` com um `DATABASE_URL` de fachada (que não conecta) e o runner só executa `node dist/src/server.js`.

A auditoria de 2026-08-06 é um exemplo: `AuditEvent` ganhou colunas e os enums `AuditEntity`/`AuditAction` ganharam valores (mais `AuditSource`), e sem o push as rotas de auditoria e toda escrita instrumentada respondem 500. Junto do deploy vão duas envs novas — `AUDIT_RETENTION_DAYS` (365) e, se houver, `REDIS_URL` para o job diário de purga; sem Redis, agendar `pnpm -C eloscrm-api audit:purge` no cron do host.

Esquecer isso não dá erro de boot — a API sobe normal e só as rotas que tocam as colunas novas respondem **500**. Já aconteceu: o schema de nutrição (`ClientStatus`, `NurtureReason`, `client.nurtureUntil`…) chegou em produção sem ser aplicado e derrubou `/v1/dashboard/stats` e `/v1/agenda`, que filtram por `status`.

⚠️ **Na ingestão de mensagem o sintoma é pior que 500: é silêncio.** Com `REDIS_URL` — o caso de
produção — o webhook só enfileira e responde `200` na hora; a escrita acontece no worker, depois. Se
a coluna não existir, o job falha com `P2022` nas três tentativas do BullMQ e **a mensagem some**:
nada na tela, nada de 5xx para a uazapi reentregar, e o corretor só descobre quando o cliente
pergunta por que não responderam. Verificado em 2026-08-10, derrubando a coluna de propósito no dev.
Por isso o `db push` vem **antes** de subir a imagem nova, nunca depois.

```bash
DATABASE_URL="postgres://…produção…" pnpm -C eloscrm-api exec prisma db push
```

Se o `db push` pedir `--accept-data-loss`, **pare**: significa drift entre o schema e o banco, e a mudança não é puramente aditiva.

### A coluna `account.issuer` é a exceção: `db push` não dá conta

O better-auth 1.7 exige `issuer` em `account`, com índice único `(issuer, accountId)`. Como a coluna
é obrigatória e a tabela em produção tem linhas, o `db push` recusa (*"Added the required column
`issuer` ... it is not possible to execute this step"*) e o `--force-reset` que ele sugere apagaria o
banco. A ordem abaixo foi ensaiada num banco com dados no formato 1.6 e é a única que sobrevive ao
deploy contínuo — enquanto a coluna é nula, a imagem 1.6 continua rodando:

```sql
-- 1. antes de subir a imagem nova, com o 1.6 ainda no ar
ALTER TABLE account ADD COLUMN issuer text;
UPDATE account SET issuer = 'local:credential' WHERE "providerId" = 'credential';
-- 2. as duas têm de voltar vazias/zero
SELECT COUNT(*) FROM account WHERE issuer IS NULL;
SELECT issuer, "accountId", COUNT(*) FROM account GROUP BY 1,2 HAVING COUNT(*) > 1;
-- 3. só então
ALTER TABLE account ALTER COLUMN issuer SET NOT NULL;
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON account (issuer, "accountId");
-- 4. rede de rollback: sem isto, um `NOT NULL` fecha a porta para a imagem 1.6, que insere conta
-- nova sem mencionar a coluna e leva NullConstraintViolation no primeiro cadastro. O `db push`
-- ignora este default (continua respondendo "already in sync"); remova quando a janela fechar.
ALTER TABLE account ALTER COLUMN issuer SET DEFAULT 'local:credential';
```

`local:credential` vale porque todas as contas aqui são de e-mail e senha — não há provedor social.
Se um dia houver, o namespace passa a ser `local:oauth:<providerId>` e a conta é outra conversa.
Depois disso, `prisma db push` responde "already in sync" e não altera nada.

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

Módulos existentes em `src/modules/`: `activities`, `agenda`, `attachments`, `audit`, `broadcasts`, `clients`, `comments`, `dashboard`, `deals`, `lead-automation`, `members`, `meta`, `organization`, `pipelines` (inclui os estágios), `properties`, `tags`, `timeline` e `whatsapp`.

O `whatsapp` foge do formato em dois pontos, ambos deliberados e documentados em
`eloscrm-api/AGENTS.md`: fala com a uazapi por `src/lib/uazapi/` (não só com o Prisma), e registra
**uma rota fora de `/v1` e sem guards** — `/webhooks/uazapi/:instanceId/:secret`, receptor de eventos
do provedor, autenticado por segredo na URL; o hash do token no corpo é conferido quando o campo está presente.

## Estrutura do web

- `lib/queries/<recurso>.ts` — um arquivo por recurso com os hooks de TanStack Query (`useDeals`, `useCreateDeal`, …). Mutations invalidam por prefixo de key; `useUpdateDeal` faz optimistic update no move entre estágios do kanban.
- `app/(app)/<rota>/` — página + componentes locais colocados juntos (dialogs, cards, hooks específicos). `app/(app)/layout.tsx` é client component e faz o gate de sessão + sidebar.
- `app/(auth)/login/` — fora do gate.
- `components/ui/` — shadcn (style `base-vega`, base color `neutral`, ícones Lucide); `components/app/` — shell da aplicação (sidebar, org switcher, user menu).
- `lib/providers.tsx` — QueryClient (`staleTime` 30s, `retry` 1, sem refetch on focus), Sonner e devtools.

## Docs

Specs, planos e registros de sessão preservam decisões e evidências históricas. Para a arquitetura e
os comandos atuais, use os `AGENTS.md` da raiz, da API e do web, conferindo o código antes de mudar
contratos ou executar procedimentos antigos.

- Spec histórica do MVP: `eloscrm-api/docs/superpowers/specs/2026-07-23-eloscrm-mvp-design.md`
- Plano histórico da fundação: `eloscrm-api/docs/superpowers/plans/2026-07-23-api-fundacao.md`

> Criado em 2026-07-27 10:13 (-03) · Última modificação: 2026-09-30 14:44 (-03)

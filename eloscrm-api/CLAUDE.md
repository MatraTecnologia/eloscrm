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

## Integração WhatsApp (uazapi)

Cliente HTTP em `src/lib/uazapi/` (tem `CLAUDE.md` próprio), módulo em `src/modules/whatsapp/`,
design em `docs/superpowers/specs/2026-08-03-whatsapp-uazapi-design.md`.

**Uma instância por organização.** `UazapiInstance.organizationId` é `@unique` e nenhuma rota tem
`:id` — todas são `/v1/whatsapp/instance` e resolvem por `request.orgId`. Não recoloque id na URL:
é o que hoje torna impossível apontar para a instância de outra imobiliária.

**A rota `/webhooks/uazapi/:instanceId/:secret` não tem `authGuard` de propósito.** Quem chama é o
servidor da uazapi, sem cookie. A autenticação é o **segredo de 32 bytes na URL**, comparado em tempo
constante em `whatsapp.webhook.service.ts`; o hash do token no corpo é defesa em profundidade e só é
conferido quando o campo vem. Rota nova ali dentro precisa chamar `authenticate` também. Ainda **não
há rate limit** — o projeto não tem `@fastify/rate-limit`.

**Envelope do webhook (confirmado no tráfego real da v2.1.1, 2026-08-03):**

```jsonc
{ "BaseUrl": "…", "EventType": "connection", "token": "…", "instanceName": "matra",
  "owner": "554391834229",                    // no TOPO, fora de `instance`; número puro, SEM @s.whatsapp.net
  "instance": { "name": "matra", "status": "connected" } }
```

⚠️ **`owner` fica fora de `instance`.** `applyInstanceSnapshot` lê `data.owner`, e `data` é
`body.instance` — sem trazer o campo do topo (é o que `connectionDataOf` faz), `ownerJid` nunca seria
preenchido por webhook e a tela mostraria "Número ainda não identificado" numa instância conectada.

**O webhook manda pouco; o resto só vem por sync.** `instance` traz apenas `name` + `status` (mais
`qrcode` em `connecting`, e `lastDisconnect`/`lastDisconnectReason` em `disconnected`).
`profileName`, `profilePicUrl`, `isBusiness` e `plataform` **não chegam por webhook** — só por
`GET /instance/status`. Por isso o web tem `useAutoSyncProfile`: ao ver `connected` sem
`profileName`, dispara um sync, **uma vez por instância** (trava em `useRef` — conta sem nome de
perfil existe, e sem a trava cada refetch dispararia outra chamada). Se mexer nisso, mantenha a
trava.

**O `webhookBodySchema` continua tolerante de propósito**: aceita `EventType`/`event`/`type`, não
exige campo nenhum e confere o hash do token só quando ele vem. A spec da uazapi **não** documenta o
corpo entregue (`paths/webhooks-e-sse/webhook.yaml` só cobre a configuração), então o formato acima é
observação, não contrato. Apertar o schema devolveria o pior modo de falha possível — todo evento
recusado em silêncio, com o sintoma só aparecendo em `/webhook/errors` da uazapi. Envelope
irreconhecível vira `request.log.warn`.

**Trilha bruta para diagnóstico: `UAZAPI_DEBUG_LOG`.** Aponte para um arquivo (ex:
`logs/uazapi.jsonl`) e a API passa a gravar, em JSONL, tudo que sai para a uazapi, tudo que volta e
o **corpo cru de cada webhook** — este último antes do `parse` e antes de autenticar, que é
justamente quando o corpo interessa. Vazio = no-op; `logs/` está no `.gitignore`.

Os *valores* de `token`/`admintoken`/`apikey`/`webhookSecret` saem redigidos como
`<redigido len=N>`, e a URL de webhook perde o último segmento — mas **as chaves permanecem**, que é
o que revela o formato do envelope. Não relaxe essa redação para "ver o token": ele está cifrado no
banco exatamente para não existir em claro em lugar nenhum.

Headers seguem **allowlist de valor** (`safeHeaders`), não blocklist: só `host`, `accept`,
`content-type`, `content-length` e `user-agent` saem com valor; o resto vira `<omitido>` com o nome
preservado. Blocklist de header sempre esquece um (`authorization`, `cookie`, `x-api-key`,
`proxy-authorization`…) e o custo do esquecimento é credencial em claro no disco. Se a uazapi passar
a mandar um header próprio, o **nome** aparece — que é o suficiente para notar e investigar.

⚠️ **O corpo gravado contém dado pessoal**: telefone (`owner`, no formato `55…@s.whatsapp.net`),
nome de perfil, nome de contato. Isso é deliberado — é o dado que responde "qual é o formato do
envelope" — mas significa que o arquivo é **dado pessoal sob LGPD**: não o suba para issue, chat,
gist ou anexo de ticket, e apague quando terminar a investigação. Em produção, ligue só pelo tempo
da apuração.

É ferramenta de investigação, não o logger da aplicação: ligue enquanto apura, desligue depois.

**`UazapiInstanceLog.payload` não sai pela API.** Ele guarda resposta bruta da uazapi para
diagnóstico e pode conter URL de webhook (que termina no `webhookSecret`) ou campo novo que ninguém
revisou. `repo.listLogs` usa `select` explícito sem ele — não troque por um `findMany` cru.

**Em dev o webhook não chega.** `PUBLIC_API_URL` cai em `BETTER_AUTH_URL`, que é `localhost:3333`, e
a uazapi não alcança a sua máquina. Sem um túnel (`cloudflared tunnel --url http://localhost:3333`)
apontado em `PUBLIC_API_URL`, o estado da conexão só muda pelo botão **Sincronizar** da tela.

**As envs são opcionais de propósito** (`UAZAPI_BASE_URL`, `UAZAPI_ADMIN_TOKEN`,
`UAZAPI_TOKEN_ENCRYPTION_KEY`, `PUBLIC_API_URL`), como o `RESEND_API_KEY`: sem elas a API sobe e só
as rotas de WhatsApp respondem `503 INTEGRATION_NOT_CONFIGURED`. `GET /v1/whatsapp/instance` funciona
mesmo assim — lê só o estado local.

**`POST /instance/test-send` é a única rota que faz o número enviar mensagem.** Gestor apenas,
recusa com `409 INSTANCE_NOT_CONNECTED` se a instância não estiver conectada, e o log
(`test_message_sent`) guarda o número de destino e o id da mensagem — **não o texto**, que é conteúdo
de conversa e não tem valor de auditoria. Se um dia virar envio em massa, isso deixa de ser uma rota
de diagnóstico e precisa de fila e limite.

**Perder a `UAZAPI_TOKEN_ENCRYPTION_KEY` inutiliza todos os tokens salvos** (AES-256-GCM em
`src/lib/crypto.ts`). Ela pertence ao cofre de produção, junto com `BETTER_AUTH_SECRET`.

**Os testes mockam a uazapi** (`vi.mock` em `test/whatsapp.test.ts`) — exceção deliberada, e só ela:
a regra "sem mocks" deste documento é sobre o Postgres, não sobre serviço externo de terceiro.

## Erro 5xx com código próprio

`httpError()` marca `expose: true`, e o `errorHandler` só mascara 5xx **sem** essa marca. É o que
permite a integração devolver `502 UAZAPI_ERROR` / `503 UAZAPI_CAPACITY` / `504 UAZAPI_UNAVAILABLE`
com mensagem em pt-BR, enquanto um erro que vazou continua virando `{ code: "INTERNAL" }`. Nunca
construa um 5xx exposto com `new Error` + `statusCode` na mão — use `httpError`.

## Docs

- Spec do MVP: `docs/superpowers/specs/2026-07-23-eloscrm-mvp-design.md`
- Plano da fundação: `docs/superpowers/plans/2026-07-23-api-fundacao.md`
- WhatsApp/uazapi: `docs/superpowers/specs/2026-08-03-whatsapp-uazapi-design.md`

> Criado em 2026-07-23 17:01 (-03) · Última modificação: 2026-08-04 00:36 (-03)

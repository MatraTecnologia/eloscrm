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
pnpm audit:purge [--days N] [--dry-run]   # purga da auditoria por retenção (sem Redis, é a rotina)
pnpm audit:backfill-labels [--dry-run]    # rótulo nos eventos gravados antes da coluna existir
pnpm backfill:lead-names [--apply]        # leads e cards que ficaram chamados pelo telefone
pnpm backfill:message-kinds [--apply]     # contato e localização ingeridos antes do parser
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

**Automação de leads: grupo fica de fora, e o nome do lead tem uma janela.** Conversa em grupo é
ingerida e aparece na tela de conversas, mas `applyToConversation` sai antes de criar qualquer coisa:
o `chat.phone` de um grupo não é o telefone de ninguém (em produção veio o número da própria
instância, o que gerou dois leads apontando para a corretora) e o `wa_name` é o nome do grupo. Sem
esse guard, seis grupos viraram lead — cinco com card no funil, incluindo o de alertas da empresa.

Quando quem escreve primeiro é a corretora, o chat ainda não existe do lado do provedor e o envelope
vem sem nome: o lead nasce chamado pelo próprio telefone — 28 dos 29 casos apurados em produção em
2026-08-10. O nome só chega quando o cliente responde, e `renameIfAutoNamed` o aplica **enquanto o
nome ainda for exatamente o telefone formatado**; nome digitado por gente nunca é sobrescrito.
⚠️ **Nunca use `message.senderName` como sugestão de nome**: em mensagem `fromMe` ele é o perfil da
instância, e os 2431 envios observados traziam um único valor — o nome da imobiliária. Cair nele
batizaria todo lead de primeiro contato com o nome da própria empresa.

Renomear o lead também renomeia os cards cujo título ainda é o `autoDealTitle` do nome antigo
(`clients.service.ts`, um evento de auditoria por card). O kanban mostra o **título** em destaque e o
nome do lead só na linha de baixo — sem isso, salvar o nome não mudava nada na tela, que foi
exatamente a queixa que abriu essa investigação. Para o que já está gravado:
`pnpm backfill:lead-names` (dry-run por padrão; também lista os leads-grupo, sem apagar nenhum).

**A imobiliária resolve sozinha pela tela `/clients/nomes`** (`GET`/`POST /v1/clients/name-fixes`, no
mesmo arquivo de rota dos clientes, para herdar os guards). `listAutoNamed` devolve **todos** os
leads chamados pelo telefone, não só os que têm sugestão: metade dos casos é de conversa em que
ninguém respondeu, e essas precisam de alguém digitando. `applyFixes` passa por `clients.update` um a
um, de propósito — é o que grava a auditoria com quem clicou (`USER`, não `AUTOMATION`) e leva o nome
para os cards; e confere o dono de **todos** os ids antes da primeira escrita, senão um id de outra
imobiliária no meio do lote aplicaria metade antes de estourar. O predicado do lead auto-nomeado e a
precedência da sugestão vivem em `src/lib/lead-name.ts`, compartilhados pelos três caminhos que
renomeiam (ingestão, tela e backfill) — se cada um decidisse por conta, o mesmo lead seria corrigível
num lugar e intocável no outro.

**`mediaType` preenchido não quer dizer arquivo baixável.** Contato compartilhado chega com
`mediaType: vcard` (um) ou `contact_array` (vários) e `type: "media"` — sem tratar, virava
`unsupported`, entrava na fila de download e voltava com *"Mídia indisponível: Message does not
contain downloadable media"* escrito na bolha do corretor, com o vCard resumido logo abaixo. Por isso
`DOWNLOADABLE` em `message-envelope.ts` é **allowlist**: tipo novo do provedor passa a não baixar por
padrão, porque o erro de não tentar é invisível e o de tentar aparece na tela de quem atende.

Localização é o mesmo caso e o mesmo remédio: `mediaType: location`, mapa estático em
`content.JPEGThumbnail` (que já entrava por `mediaThumb`) e as coordenadas em `parseLocation` →
coluna `location`. Coordenada `(0, 0)` é descartada — é o que sobra quando o campo não veio, e fica
no meio do Atlântico. O backfill dessas só recupera o **tipo**: as coordenadas nunca foram gravadas,
e o `text` vem vazio, então a bolha antiga mostra o mapa sem virar link.

Enquete é o terceiro caso do mesmo formato: o tipo já era reconhecido (`type: "poll"`), mas as
opções se perdiam e a bolha mostrava só a pergunta. `parsePoll` busca o bloco por **prefixo**
(`pollCreationMessage…`) porque o sufixo é versão de protocolo — uma `V4` amanhã continua
funcionando —, com `convertOptions` (opções separadas por `|`) como reserva. `selectableOptionsCount`
1 é escolha única; 0 é "pode marcar várias".

**O voto (`PollUpdateMessage`) atualiza a enquete, como a reação atualiza a bolha** — não vira linha
na conversa. Ingerido como mensagem ele produzia uma bolha órfã por voto e, sem texto nem mídia,
ainda caía no cartão genérico de "Arquivo". `applyVote` (`votes.service.ts`) acha a enquete pelo
`content.pollCreationMessageKey.ID` (ou pelo `quoted`) e **substitui** o voto da mesma pessoa.
Substituir é o certo porque cada mudança manda o estado completo: marcar a segunda opção de uma
enquete múltipla chega como `"Opção 1, Opção 2"`, não só a nova. Desmarcar tudo chega como
`vote: ""` e **remove** o voto, como o emoji vazio desfaz uma reação.

Três armadilhas, todas confirmadas no tráfego de 2026-08-10:

- **O gatilho é a `pollCreationMessageKey`, não o texto do voto.** Exigir texto fazia o "desmarcar"
  (`vote: ""`) cair no fluxo normal e virar bolha na conversa. E não pode ser o `quoted` sozinho:
  resposta de texto citando a enquete também o traz, e viraria voto.
- **`pollCreationMessageKey` começa com o mesmo prefixo do bloco de criação** —
  `parsePoll` a exclui explicitamente, senão um voto passaria por enquete nova.
- **As opções vêm juntas, separadas por vírgula, e nome de opção também pode ter vírgula.**
  `resolveChoices` desempata pela lista da própria enquete: tenta o texto inteiro como uma opção,
  depois divide e fica com o que casa. O voto vem decifrado em `message.vote`; o `content.vote` é o
  payload cifrado e não precisa ser aberto.

O vCard é lido na **ingestão** (`parseContacts`) e guardado já traduzido na coluna `contacts`
(`[{ name, phones[], business }]`). Guardar o parse, e não o cartão cru, mantém fora do banco o
`X-WA-BIZ-DESCRIPTION` — texto de propaganda com emoji e quebras de linha que ninguém exibe. Para o
que já entrou errado: `pnpm backfill:message-kinds` reconstrói a partir do `text` (é o `rawType`
que identifica as linhas) e limpa o `mediaError`; o telefone sai com o nono dígito, diferente do
`waid` que a ingestão nova grava — os dois discam para a mesma pessoa.

**Envio de mídia: a chave vem do cliente, e é por isso que ela é conferida.** O arquivo sobe direto
do navegador para o R2 (`POST /:id/media/upload-url` → PUT → `POST /:id/messages/media`), então
entre um passo e outro a chave passa pelo cliente. `sendMedia` recusa qualquer uma que não comece com
`org/<orgId>/whatsapp/<conversationId>/` — sem isso um envio apontaria para o anexo de outro lead, ou
de outra imobiliária, e a uazapi entregaria esse arquivo no WhatsApp de quem pediu. O `HEAD` no
bucket repete tamanho e content-type porque **o tipo não entra na assinatura do presign** (mesma
razão do `confirm` dos anexos), e o `docName` só acompanha documento — nos outros tipos o WhatsApp o
exibe como legenda. A mensagem nasce `mediaStatus: ready`: o arquivo já é nosso e não passa pela fila
de download. Em dev o ciclo não fecha, igual ao webhook — a uazapi não alcança o SeaweedFS local.

**Falha de envio tem dois formatos, e só um é `result.success: false`.** A chamada ao provedor
também **lança** — token que não descriptografa, DNS que não resolve. `sendOrMarkFailed` cobre os
dois com `try/catch`, e o `try` é obrigatório: quem estoura primeiro é o `instanceClient`, ao
descriptografar o token, **antes** de existir promise — um `.catch()` encadeado não veria a exceção e
a bolha ficava `pending` para sempre, que na tela se lê como "ainda indo" em vez de "não foi".

**Os testes mockam a uazapi** (`vi.mock` em `test/whatsapp.test.ts`) — exceção deliberada, e só ela:
a regra "sem mocks" deste documento é sobre o Postgres, não sobre serviço externo de terceiro.

## Auditoria

Toda escrita do domínio, da integração e da identidade grava um `AuditEvent`. Plano completo com as
decisões: `docs/superpowers/plans/2026-08-06-auditoria-completa.md`.

- **`recordAudit` de `src/lib/audit.ts` é o único ponto de escrita.** O ator chega como último
  parâmetro (`Actor`), e é ele que carrega a origem: `actorOf(request)` preenche `ip`, `userAgent`,
  `requestId` e `source: USER`; `AUTOMATION_ACTOR`/`WEBHOOK_ACTOR`/`SYSTEM_ACTOR` cobrem o que ninguém
  clicou.
- **O evento tem de ser legível depois de o dado ser apagado.** Por isso `entityLabel` (nome no
  momento do fato), `context` (lead/funil/estágio por nome, não id) e `snapshot`. Consequência
  prática: **`DELETED` grava antes do delete** — depois não há mais de onde tirar rótulo nem snapshot.
- **`snapshot` só aceita a allowlist de `src/lib/audit-snapshot.ts`**, com telefone e e-mail
  mascarados e **sem** conteúdo de conversa. Isso sobrevive à exclusão pedida pelo titular, e quem
  limita no tempo é `AUDIT_RETENTION_DAYS`. Nunca espalhe a entidade (`{ ...client }`).
- **A lista do que NÃO é auditado é decisão, não esquecimento** (D7 do plano): ingestão de mensagem
  recebida, `markRead`, download de mídia pelo worker, ecos de `messages_update`, reações,
  `pin`/`favorite` e leituras em geral. Auditar o webhook duplicaria a tabela de mensagens — ele
  reentrega, e a captura real da uazapi teve dez tentativas do mesmo evento. `test/audit-coverage.test.ts`
  assere zero eventos nesses caminhos.
- **`test/audit-coverage.test.ts` também varre o `src`** e falha se alguma ação do enum nunca é
  emitida. Foi assim que `INVITE_REVOKED` apareceu como lacuna. Ação nova no enum precisa de emissor.
- **Leitura:** `GET /v1/audit-events` devolve `{ items, nextCursor }`. Com `entityId` é o histórico de
  um item e vale para qualquer membro; **sem** `entityId` é a busca da imobiliária e exige gestor. A
  checagem é `isOrgManager` **no service** — guard de papel no arquivo de rota fecharia a aba
  Histórico do corretor junto. `/actors` e `/export` são de gestor, e exportar se audita.
- **Retenção:** `AUDIT_RETENTION_DAYS` (365 por padrão, mínimo 30) e `purgeOlderThan` em lotes de 5
  mil — um `DELETE` gigante numa tabela com quatro índices segura escrita, e auditoria é escrita em
  todo request. Com `REDIS_URL` o job é agendado no boot (03:20, America/Sao_Paulo); **sem Redis não
  há agendamento**, e a rotina é `pnpm audit:purge` (aceita `--days` e `--dry-run`). A purga se
  audita: um `ORGANIZATION/PURGED` por organização afetada.
- **Auditoria de identidade engole a própria falha de propósito** (`safeRecord` em
  `src/modules/audit/identity.audit.ts`): erro em hook do Better Auth trancaria o login. Mas conta e
  emite `process.emitWarning`, e o número sai em `GET /health` (`auditFailures`) — sem isso, trilha
  quebrada por schema desatualizado seria idêntica a um dia sem logins.
- **Excluir a organização apaga tudo que é dela**, log inclusive: as 13 relações de `Organization` são
  `onDelete: Cascade`. O que o Postgres não alcança está em
  `src/modules/audit/organization-purge.service.ts`, chamado pelo `beforeDeleteOrganization` — objetos
  do R2 (anexos e mídias) e a instância remota na uazapi. Roda **antes** do delete, porque depois não
  há mais chave nem token. Quem apagar a org direto no banco continua deixando objeto órfão no bucket.
- **Eventos antigos sem rótulo:** `pnpm audit:backfill-labels` (com `--dry-run`) preenche o que ainda
  existe; item já apagado fica sem nome, porque ele não está em lugar nenhum.

## Erro 5xx com código próprio

`httpError()` marca `expose: true`, e o `errorHandler` só mascara 5xx **sem** essa marca. É o que
permite a integração devolver `502 UAZAPI_ERROR` / `503 UAZAPI_CAPACITY` / `504 UAZAPI_UNAVAILABLE`
com mensagem em pt-BR, enquanto um erro que vazou continua virando `{ code: "INTERNAL" }`. Nunca
construa um 5xx exposto com `new Error` + `statusCode` na mão — use `httpError`.

## Docs

- Spec do MVP: `docs/superpowers/specs/2026-07-23-eloscrm-mvp-design.md`
- Plano da fundação: `docs/superpowers/plans/2026-07-23-api-fundacao.md`
- WhatsApp/uazapi, instância: `docs/superpowers/specs/2026-08-03-whatsapp-uazapi-design.md`
- WhatsApp, conversas: `docs/superpowers/specs/2026-08-04-whatsapp-conversas-design.md` — a §2 é o
  que a spec do provedor **não** documenta (envelope dos webhooks, os sete tipos de mensagem,
  `messages_update`, reply e deleção). Não confie em memória sobre esses formatos: releia antes de
  mexer em ingestão.
- Automação de leads: `docs/superpowers/specs/2026-08-04-automacao-de-leads-design.md`
- **Débitos em aberto do WhatsApp: `../docs/2026-08-04-debitos-whatsapp.md`** — retenção/LGPD, rate
  limit no webhook, rotação do `webhookSecret`. São decisões adiadas com o motivo registrado, não
  bugs; leia antes de propor qualquer um deles como "melhoria óbvia". O envio de mídia saiu da lista
  em 2026-08-10, com o caminho escolhido registrado lá.

> Criado em 2026-07-23 17:01 (-03) · Última modificação: 2026-08-10 22:05 (-03)

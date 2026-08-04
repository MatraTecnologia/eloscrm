# Integração WhatsApp (uazapi) — Spec de Design + Plano

> Cada imobiliária conecta **um** número de WhatsApp. Esta fase entrega apenas o
> **ciclo de vida da instância**: criar, conectar (QR/paircode), acompanhar estado, reconciliar e
> remover. Sincronização de mensagens → lead fica para a fase seguinte.

Estado de referência: commit `95682b6` (`main`), com `eloscrm-api/src/lib/uazapi/` untracked.
Spec da uazapi: `docs/uazapi/` (OpenAPI 3.1, uazapiGO v2.1.1).
Referência de implementação: `matra-notification-manager` (`packages/api/src/routes/instances`,
`apps/dashboard/features/uazapi-instances`).

---

## 1. Diagnóstico da lib `src/lib/uazapi/`

A pasta foi copiada do `matra-notification-manager` e **não compila neste projeto**. `pnpm typecheck`
falha com 18 erros. Nada aqui é opinião de estilo — são bloqueios reais.

### 1.1 Bloqueios (a lib não roda hoje)

| # | Problema | Evidência | Correção |
|---|---|---|---|
| B1 | `axios` não está em `dependencies` | 10× `TS2307: Cannot find module 'axios'` | `pnpm add axios` (decisão confirmada) |
| B2 | `error instanceof AxiosError` não estreita sem os tipos | 7× `TS18046: 'error' is of type 'unknown'` em `client.ts:72-119` | resolvido por B1 |
| B3 | Alias `@/` não existe neste tsconfig | `tsconfig.json` não tem `compilerOptions.paths`; `index.ts:1` importa `@/env.js`, `snapshot.ts:5` importa `@/generated/prisma/client.js` | trocar por caminhos relativos (`../../env.js`, `../../generated/prisma/client.js`) |
| B4 | `env.UAZAPI_BASE_URL` / `env.UAZAPI_ADMIN_TOKEN` não existem | `src/env.ts` não declara nenhuma das duas; `index.ts:54-59` lê ambas | adicionar em `src/env.ts` (§4) |
| B5 | `snapshot.ts` importa models Prisma inexistentes | `UazapiInstanceStatus`, `UazapiInstanceLogEvent`, `Prisma.UazapiInstanceUpdateInput` — nenhum está em `prisma/schema.prisma` | criar os models (§3) |

### 1.2 Divergências da spec v2.1.1 (compila, mas está errado em runtime)

| # | Problema | Onde | Impacto |
|---|---|---|---|
| D1 | `InstanceStatus` não tem `'hibernated'` | `types.ts:1` — mas `docs/uazapi/schemas/instance.yaml` declara `disconnected \| connecting \| connected \| hibernated` | tipo mente; o `(string & {})` em `UazapiInstance.status` salva o cast, mas o enum exportado engana quem consome |
| D2 | `parseStatus` não mapeia `hibernated` | `snapshot.ts:7-16` — `STATUS_MAP` só tem 3 chaves | **bug silencioso**: instância hibernada → `parseStatus` devolve `null` → `applyInstanceSnapshot` não escreve `status` → o estado local **congela no anterior** e a UI mostra "conectado" para um número que não está mais atendendo |
| D3 | `UpdateProxyParams` não tem `rotate_now`; `UpdateProxyResponse` não tem `rotated` | `types.ts:408-419` — v2.1.1 adicionou ambos (e o `409` quando não há proxy alternativo) | fora do escopo desta fase; anotar |
| D4 | `proxy_fallback` mudou de `internal_proxy` → `internal` na v2.1.1 | `types.ts:401` tipa como `string`, então não trava | sem impacto agora; anotar |
| D5 | `CLAUDE.md` da lib aponta para `docs/integrations/uazapi/` | caminho real é `docs/uazapi/` | doc quebrada em 2 lugares |

### 1.3 Lacunas de endpoint (v2.1.1) — fora do escopo, registradas

`/instance/admin_restart`, `/instance/admin_token_rotate` (rotação do token da instância — vale a pena
quando houver rotina de segurança), `/instance/presence`, `/instance/privacy`, `/sse`, `/quickreply/*`.
Nenhuma é necessária para esta fase.

### 1.4 O que está certo e fica como está

- `Result<T>` + `normalizeError` — não lança em erro HTTP, captura `error_source`/`provider_code`/
  `message_ptbr`, distingue `network`/`timeout`. É exatamente o que a camada de service precisa.
- Imutabilidade de `withInstance`/`withAdminToken` — seguro para multi-tenant concorrente.
- `requestWithHeaders` para `webhook.errors` (header `x-webhook-error-capture-started-at`).
- Os 13 módulos ficam (decisão confirmada). `send`, `messages`, `contacts` entram na fase de leads;
  `proxy`, `groups` seguem sem consumidor. **Dead code deliberado, não esquecimento** — anotar no
  `CLAUDE.md` da lib.

### 1.5 Estilo

A lib usa aspas simples e sem ponto-e-vírgula; o resto da API usa aspas duplas com ponto-e-vírgula.
Não há Prettier no projeto e o oxlint não tem regra de formatação — **não vou reformatar**. Código
novo (`modules/whatsapp/`, rotas) segue o estilo da API; a lib segue o dela. Fica anotado no
`CLAUDE.md` da lib para ninguém "corrigir" e gerar diff de 1500 linhas.

---

## 2. Decisões de arquitetura

**2.1 — Uma instância por organização, sem `:id` na rota.**
`UazapiInstance.organizationId` é `@unique`. Toda rota é `/v1/whatsapp/instance` (singular) e resolve
a instância por `request.orgId`. Isso elimina a classe inteira de bug "IDOR por id de instância": não
existe id na URL para adulterar.

**2.2 — Webhook por instância, não global.**
Cada instância registra na uazapi uma URL própria:

```
POST {PUBLIC_API_URL}/webhooks/uazapi/{instanceId}/{webhookSecret}
```

`webhookSecret` é gerado por instância (`randomBytes(32).toString('base64url')`), guardado no banco e
comparado com `timingSafeEqual`. Vantagem sobre o webhook global do `matra-notification-manager`:
segredo revogável por imobiliária, e a rota já sabe de quem é o evento antes de tocar no banco.

Defesa em profundidade: **quando** o corpo traz `token`, comparamos `hashToken(body.token)` com o
`tokenHash` armazenado — URL certa + token errado = `401`. A conferência é condicional de propósito;
ver §5.1 sobre o envelope.

**2.3 — Processamento inline, sem fila.**
O `matra-notification-manager` enfileira em BullMQ; o elosCRM não tem Redis nem BullMQ, e adicionar
essa infra para gravar uma linha de status seria desproporcional. O handler grava direto e responde
`{ received: true }`. Só o evento `connection` é assinado — volume é de dezenas por dia, não milhares.
Quando entrar `messages` (fase de leads), a fila volta à mesa.

**2.4 — Nome dos models: `UazapiInstance`, não `WhatsappInstance`.**
`snapshot.ts` já importa `UazapiInstanceStatus` / `UazapiInstanceLogEvent` /
`Prisma.UazapiInstanceUpdateInput`. Manter os nomes deixa `snapshot.ts` reutilizável verbatim (só a
correção de B3). O custo é acoplar o nome do model ao provedor — aceito: os campos já são
provider-specific (`adminField01`, `plataform` com o typo da uazapi, `paircode`). As **rotas** e a
**UI** falam "WhatsApp"; só o schema fala "uazapi".

**2.5 — Token da instância criptografado em repouso.**
AES-256-GCM (`src/lib/crypto.ts`), chave hex de 32 bytes em `UAZAPI_TOKEN_ENCRYPTION_KEY`. Formato
persistido: `base64url(iv).base64url(tag).base64url(ciphertext)`. Guardamos também `tokenLast4`
(exibição) e `tokenHash` sha256 (`@unique`, lookup e verificação do webhook). O token em claro
**nunca** sai da API — nem em resposta, nem em log, nem no `payload` dos logs.

**2.6 — Servidor e admintoken são globais, por env.**
`UAZAPI_BASE_URL` e `UAZAPI_ADMIN_TOKEN` valem para a aplicação inteira; a imobiliária não escolhe
servidor. Só o token **da instância** é por tenant, no banco.

**2.7 — Integração opcional, como o Resend.**
As três envs são `.optional()`. Sem elas, dev/teste/CI sobem normalmente e as rotas de WhatsApp
respondem `503 INTEGRATION_NOT_CONFIGURED`. Nenhum passo de setup novo vira pré-requisito de `pnpm test`.

**2.8 — Escrita é de gestor; leitura é de qualquer membro.**
`isOrgManager` (`src/lib/org-roles.ts`, `owner|admin`) guarda toda mutação. Corretor (`member`) só lê
o estado — precisa saber se o WhatsApp da imobiliária está no ar, não pode desconectá-lo.

---

## 3. Modelo de dados

```prisma
enum UazapiInstanceStatus {
  disconnected
  connecting
  connected
  hibernated          // v2.1.1 — sessão pausada, credenciais preservadas
}

enum UazapiInstanceLogEvent {
  created
  connect_requested
  qr_generated
  paircode_generated
  connected
  disconnected
  status_changed
  reset
  synced
  name_updated
  webhook_configured
  remote_deleted
  deleted
  error
}

enum UazapiInstanceLogSource {
  manual              // ação de um usuário na tela
  webhook             // evento entregue pela uazapi
  sync                // reconciliação sob demanda
  system              // detecção automática (ex: instância sumiu do provedor)
}

model UazapiInstance {
  id String @id @default(cuid())

  // 1 por imobiliária — a unicidade é a regra de negócio, imposta no banco
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  remoteId String @unique     // id da instância no uazapi
  name     String

  tokenEnc      String        // AES-256-GCM
  tokenLast4    String?
  tokenHash     String  @unique
  webhookSecret String  @unique

  status       UazapiInstanceStatus @default(disconnected)
  lastStatusAt DateTime?
  qrcode       String?              // base64 volátil; zerado ao conectar
  paircode     String?

  profileName   String?
  profilePicUrl String?
  isBusiness    Boolean?
  plataform     String?             // typo é da uazapi, preservado
  ownerJid      String?
  systemName    String?

  lastDisconnectAt     DateTime?
  lastDisconnectReason String?
  remoteDeletedAt      DateTime?    // instância sumiu do uazapi

  logs UazapiInstanceLog[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("uazapiInstance")
}

model UazapiInstanceLog {
  id String @id @default(cuid())

  instanceId String
  instance   UazapiInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  event  UazapiInstanceLogEvent
  source UazapiInstanceLogSource

  previousStatus UazapiInstanceStatus?
  newStatus      UazapiInstanceStatus?

  actorUserId String?
  actor       User?   @relation(fields: [actorUserId], references: [id], onDelete: SetNull)

  message String?
  payload Json?

  createdAt DateTime @default(now())

  @@index([instanceId, createdAt])
  @@map("uazapiInstanceLog")
}
```

Relações a acrescentar do outro lado: `Organization.uazapiInstance UazapiInstance?` e
`User.uazapiInstanceLogs UazapiInstanceLog[]`.

`UazapiInstanceLog` **não** entra no `AuditEvent` existente: `AuditEntity` é um enum fechado de
entidades de domínio (`CLIENT`/`DEAL`/`PROPERTY`/`ACTIVITY`) e o log de instância guarda
`previousStatus`/`newStatus`/`payload` que o `AuditEvent` não modela. São trilhas diferentes.

**Sanitização do `payload`.** A resposta da uazapi em `connect`/`status` traz `instance.token` em
claro. O log **precisa** remover essa chave antes de gravar — `omitSecrets(payload)` no repo, não no
call site (uma chamada esquecida vaza o token no banco em texto puro).

---

## 4. Envs novas (`src/env.ts` + `.env.example`)

```ts
// uazapi (WhatsApp). Opcionais de propósito, no mesmo espírito do RESEND_API_KEY:
// sem elas a API sobe e as rotas de WhatsApp respondem 503.
UAZAPI_BASE_URL: z.string().url().optional(),
UAZAPI_ADMIN_TOKEN: z.string().trim().min(1).optional(),
// openssl rand -hex 32
UAZAPI_TOKEN_ENCRYPTION_KEY: z.string().trim().regex(/^[0-9a-f]{64}$/).optional(),
// URL pública desta API, usada para montar a URL do webhook entregue à uazapi.
// Em dev exige túnel (cloudflared/ngrok); sem isso a uazapi não alcança o localhost.
PUBLIC_API_URL: z.string().url().optional(),
```

`PUBLIC_API_URL` cai em `BETTER_AUTH_URL` quando ausente. **Isso só funciona em produção**, onde o
`BETTER_AUTH_URL` já é público — em dev o default é `http://localhost:3333` e a uazapi não entrega
nada. É a pegadinha número um desta integração e vai no `CLAUDE.md`: em dev, sem túnel, o status só
atualiza via botão **Sincronizar**.

---

### 5.1 O envelope do webhook — confirmado no tráfego real

> **Resolvido em 2026-08-03.** Capturado via `UAZAPI_DEBUG_LOG` com a integração no ar
> (`user-agent: uazapiGO-Webhook/1.0`, uazapiGO v2.1.1, entrega por túnel). O restante desta seção
> registra por que o receptor foi construído tolerante — o raciocínio segue valendo, e a tolerância
> fica.

```jsonc
{
  "BaseUrl": "https://….uazapi.com",
  "EventType": "connection",          // confirmado: é este o nome, não `event` nem `type`
  "token": "…",                        // presente em 5/5 eventos observados
  "instanceName": "…",
  "owner": "55…@s.whatsapp.net",      // ⚠️ no TOPO do envelope, fora de `instance`
  "instance": { "name": "…", "status": "…", "qrcode": "…" }
}
```

Duas consequências práticas:

1. **A forma do `matra-notification-manager` estava certa** (`EventType`/`token`/`instance` objeto).
   As outras duas fontes (`webhook_event.yaml`, SSE) não descrevem este endpoint.
2. **`owner` fora de `instance` era um bug silencioso.** `applyInstanceSnapshot` procura
   `data.owner`, e `data` é `body.instance` — que não tem esse campo. `ownerJid` nunca seria
   preenchido por webhook, só pelo botão Sincronizar, e a tela mostraria "Número ainda não
   identificado" numa instância conectada. `connectionDataOf` agora traz `owner` do topo para
   dentro, com precedência para o de dentro caso um dia passe a existir. Nenhuma leitura da spec
   apontaria isso — só o tráfego real.

Como `token` vem sempre, a conferência do hash (defesa em profundidade) está de fato ativa em
produção.

### 5.2 Por que o receptor continua tolerante

**A spec da uazapi não documenta o corpo entregue.** `paths/webhooks-e-sse/webhook.yaml` (282 linhas)
descreve só a *configuração* do webhook: não há bloco `callbacks` nem exemplo de payload recebido. As
três fontes que existem discordam entre si:

| Fonte | Envelope | Ressalva |
|---|---|---|
| `matra-notification-manager` (`routes/webhooks/index.ts:19`) | `EventType`, `token`, `instance` (objeto) | Ali o webhook era **global** — uma URL para todas as instâncias, então `token` era o único jeito de saber a origem. Nosso caso é por instância |
| `docs/uazapi/schemas/webhook_event.yaml` | `event`, `instance` (id, string), `data` (objeto) | O enum de `event` (`message, status, presence, group, connection`) não bate com o enum aceito na configuração do webhook — a spec discorda de si mesma, provável resíduo antigo |
| `paths/webhooks-e-sse/sse.yaml` | `type`, `data` | Mesmos eventos, transporte diferente |

O `types.gen.ts` do `matra-notification-manager` também declara `EventType`/`token`, mas é gerado do
OpenAPI da própria API deles — é circular, não evidência independente.

Consequência de errar o palpite: `parse` estoura → `422` → **todo** evento `connection` rejeitado →
a conexão nunca atualiza sozinha e a feature degrada para o botão Sincronizar, sem sintoma visível
do nosso lado. Testes não pegariam: eles postam o formato que nós assumimos.

Por isso o receptor é deliberadamente tolerante:

- `webhookBodySchema` aceita `EventType` **ou** `event` **ou** `type`, e `instance` como objeto ou
  string; **nenhum campo é obrigatório**.
- `token` é opcional; o hash só é conferido quando vem. O segredo de 32 bytes na URL é a
  autenticação — exigir o token transformaria um reforço em ponto único de falha.
- O payload da conexão é lido de `instance` (objeto) ou de `data`.
- Envelope sem evento reconhecível → `request.log.warn` + `200`. O aviso aparece no **nosso** log,
  não só no dashboard de erros da uazapi.

**Como capturar o corpo real** (foi assim que a §5.1 foi resolvida). Aponte `UAZAPI_DEBUG_LOG` para
um arquivo (ex: `logs/uazapi.jsonl`) e a API grava, em JSONL, o corpo cru de cada webhook — antes do
`parse` e antes de autenticar, para que um envelope recusado também apareça — mais tudo que sai para
a uazapi e tudo que volta (`UazapiClientConfig.onTrace`). Valores de token/segredo saem redigidos e
headers seguem allowlist de valor; as **chaves** ficam, que é exatamente o que responde a pergunta.
Vazio = desligado, e `logs/` está no `.gitignore`.

**Apertar o `webhookBodySchema` agora seria troca ruim.** O formato está confirmado para a v2.1.1,
mas exigir `EventType` e `token` devolve o modo de falha que a §5.2 descreve: uma mudança do
provedor derrubaria todo evento em silêncio, e o ganho seria nenhum — o schema tolerante já aplica o
envelope real corretamente. A tolerância custa três campos opcionais; a rigidez custa a integração.

## 5. `src/lib/crypto.ts` (novo)

Porte direto do `matra-notification-manager` (é código correto e testável):

```ts
encryptToken(plaintext: string): string      // aes-256-gcm, iv 12B, tag 16B
decryptToken(payload: string): string        // valida formato e tamanhos de iv/tag
hashToken(token: string): string             // sha256 hex
last4(token: string): string
```

Lança quando `UAZAPI_TOKEN_ENCRYPTION_KEY` está ausente — o service traduz para `503`.

---

## 6. API — rotas e módulo

### 6.1 Estrutura de arquivos

```
src/lib/crypto.ts                              # novo
src/modules/whatsapp/
├── whatsapp.schema.ts                         # zod de body/query
├── whatsapp.repo.ts                           # única camada que toca prisma
├── whatsapp.service.ts                        # ciclo de vida da instância
├── whatsapp.webhook.service.ts                # processamento do evento recebido
├── whatsapp.gateway.ts                        # resolve token -> UazapiClient; traduz Err -> HttpError
└── whatsapp.serialize.ts                      # remove tokenEnc/tokenHash/webhookSecret
src/routes/v1/whatsapp/index.ts                # rotas autenticadas (autoload -> /v1/whatsapp)
src/routes/webhooks/uazapi/index.ts            # receptor, SEM guards (autoload -> /webhooks/uazapi)
```

### 6.2 Rotas autenticadas — `/v1/whatsapp`

`app.addHook("preHandler", authGuard)` + `orgGuard`, no padrão de `src/routes/v1/deals/index.ts`.
Mutação chama `isOrgManager(orgId, userId)` → `403 FORBIDDEN`.

| Método | Rota | Papel | Efeito |
|---|---|---|---|
| `GET` | `/instance` | membro | Estado local serializado, ou `null` se a imobiliária não conectou |
| `POST` | `/instance` | gestor | `admin.createInstance` → cifra o token → cria local → registra o webhook. `409` se já existe |
| `PATCH` | `/instance` | gestor | Renomeia (remoto + local) |
| `DELETE` | `/instance` | gestor | `instance.delete()` remoto (tolerando "já sumiu") + apaga local |
| `POST` | `/instance/connect` | gestor | `instance.connect` → persiste `qrcode`/`paircode`/`status` |
| `POST` | `/instance/disconnect` | gestor | Encerra sessão, zera qr/paircode |
| `POST` | `/instance/reset` | gestor | `instance.reset` |
| `POST` | `/instance/sync` | gestor | `instance.status` → `applyInstanceSnapshot` → persiste + log `synced` |
| `GET` | `/instance/wa-limits` | gestor | `instance.waMessagesLimits` (capping/timelock), passthrough |
| `GET` | `/instance/webhook` | gestor | `webhook.get()` da uazapi, com a **URL mascarada** (§6.4) |
| `POST` | `/instance/webhook/reconcile` | gestor | Reaplica o webhook nosso (`webhook.upsert`) |
| `GET` | `/instance/webhook/errors` | gestor | `webhook.errors()` — falhas de entrega + `captureStartedAt` |
| `GET` | `/instance/logs` | gestor | Timeline local, `?limit&cursor` |

Respostas de erro no envelope padrão `{ error: { code, message, details? } }`.

**Códigos que o front trata:**

| Código | HTTP | Quando |
|---|---|---|
| `INTEGRATION_NOT_CONFIGURED` | 503 | falta env de uazapi |
| `INSTANCE_ALREADY_EXISTS` | 409 | `POST /instance` com instância já criada |
| `INSTANCE_NOT_FOUND` | 404 | qualquer rota de instância sem instância local |
| `INSTANCE_REMOTE_DELETED` | 409 | `remoteDeletedAt` preenchido — só `DELETE` funciona |
| `UAZAPI_UNAVAILABLE` | 504 | `error_source` `network` ou `timeout` |
| `UAZAPI_CAPACITY` | 503 | `503` da uazapi no `connect`; repassa `Retry-After` em `details` |
| `UAZAPI_ERROR` | 502 | demais falhas, com `message_ptbr` quando houver |
| `INSTANCE_TOKEN_CORRUPTED` | 500 | `decryptToken` falhou (chave trocada) |

**Detecção de instância órfã.** `isInstanceGoneError` (401, ou mensagem com `invalid token` /
`instance not found`) → marca `remoteDeletedAt`, escreve log `remote_deleted`, devolve
`409 INSTANCE_REMOTE_DELETED`. A partir daí a UI oferece só "Remover e recomeçar".

### 6.3 Criação — sequência

```
POST /v1/whatsapp/instance
 1. isOrgManager                                  -> 403
 2. repo.findByOrg                                -> 409 se existe
 3. envs presentes                                -> 503 se não
 4. uazapi().admin.createInstance({
      name: `${org.slug ?? org.id}`,
      adminField01: orgId,                        // rastreio no painel da uazapi
      adminField02: "eloscrm",
    })                                            -> token + remoteId
 5. webhookSecret = randomBytes(32).base64url
 6. prisma.create({ tokenEnc, tokenLast4, tokenHash, webhookSecret, ... })
 7. uazapi().withInstance(token).webhook.upsert({
      url: `${publicApiUrl}/webhooks/uazapi/${instance.id}/${webhookSecret}`,
      enabled: true,
      events: ["connection"],
      excludeMessages: ["wasSentByApi"],
      addUrlEvents: false,
    })
 8. log created (+ webhook_configured)
```

**Passo 7 falhando não desfaz o passo 6.** A instância existe no uazapi e o token é o único jeito de
alcançá-la — apagar o registro local vazaria uma instância órfã no provedor, que continua contando no
limite do servidor. Em vez disso: grava log `error`, devolve `201` com um campo `webhookConfigured:
false`, e a UI mostra o aviso "Webhook não registrado" com o botão **Reconciliar**. Falha recuperável
> rollback destrutivo.

### 6.4 Mascaramento da URL do webhook

`GET /instance/webhook` devolve o que a uazapi tem registrado, e essa URL **contém o segredo**.
Substituir o último segmento por `••••` antes de responder. O gestor não precisa do valor: o botão
Reconciliar reaplica a URL correta a partir do banco.

### 6.5 Receptor — `/webhooks/uazapi/:instanceId/:secret`

Rota **fora de `/v1`** e **sem `authGuard`/`orgGuard`** — é chamada máquina-a-máquina. O `CLAUDE.md`
diz que rota sem guards fica desprotegida; aqui é intencional e a autenticação é o par
`(secret na URL, hash do token no corpo)`. Vai um comentário no arquivo dizendo isso, senão a próxima
revisão de segurança marca como bug.

```
1. params: { instanceId: cuid, secret: string }
2. body (zod loose, todos os campos opcionais — ver §5.1)
3. instância = findUnique(instanceId)          ausente -> 401 (não 404: não enumerar ids)
4. timingSafeEqual(secret, instance.webhookSecret)     divergiu -> 401
5. body.token presente e hash divergiu                 -> 401   (ausente: segue)
6. evento != "connection" (ou irreconhecível)          -> 200 { received: true }, sem gravar
7. connection:
   - lastDisconnectReason contém "instance deletion"  -> remoteDeletedAt + log remote_deleted
   - senão  applyInstanceSnapshot(data, receivedAt)
             + log eventForTransition(previous, next)
   - $transaction([update, log])
8. 200 { received: true }
```

Sempre `200` para evento desconhecido: erro faz a uazapi acumular retentativa em
`/webhook/errors` sem motivo.

**Sem rate limit.** O projeto não tem `@fastify/rate-limit` e não vou introduzi-lo nesta fase. Com um
secret de 32 bytes por instância a superfície é pequena, mas fica registrado como débito no
`CLAUDE.md` — a rota é pública por definição.

---

## 7. Correções na lib (§1 aplicadas)

1. `pnpm add axios` — resolve B1/B2.
2. `index.ts` e `snapshot.ts`: `@/…` → caminhos relativos (B3).
3. `types.ts:1` — `InstanceStatus` ganha `'hibernated'` (D1).
4. `snapshot.ts` — `STATUS_MAP` ganha `hibernated`; `eventForTransition` trata `hibernated` como
   `status_changed` (D2).
5. `types.ts` — `UpdateProxyParams.rotate_now?: boolean`, `UpdateProxyResponse.rotated?: boolean` (D3).
6. `CLAUDE.md` da lib — corrigir `docs/integrations/uazapi/` → `docs/uazapi/`; registrar que os
   módulos sem consumidor são deliberados; registrar a divergência de estilo (§1.5).
7. `docs/uazapi/CLAUDE.md` — remover o aviso "ainda não tem consumidor no elosCRM" e apontar para
   `eloscrm-api/src/lib/uazapi/`.

---

## 8. Web — `/integracoes/whatsapp`

### 8.1 Arquivos

```
app/(app)/integracoes/whatsapp/page.tsx
app/(app)/integracoes/whatsapp/_components/
├── connect-card.tsx           # empty state + criar instância
├── qr-panel.tsx               # QR base64 / paircode + expiração
├── status-header.tsx          # badge, perfil, número, ações
├── webhook-tab.tsx            # estado do webhook + reconciliar
├── diagnostics-tab.tsx        # wa-limits (capping/timelock)
├── logs-tab.tsx               # timeline local
└── danger-zone.tsx            # desconectar / resetar / remover
lib/queries/whatsapp.ts
lib/types.ts                   # + UazapiInstance, status, log
components/app/app-sidebar.tsx # + item "WhatsApp" (ícone MessageCircle, Lucide)
```

### 8.2 Estados da tela

| Estado | O que aparece |
|---|---|
| sem instância | Card explicando + botão **Conectar WhatsApp** (só gestor) |
| `disconnected` | Botão **Gerar QR Code** |
| `connecting` + `qrcode` | QR renderizado, contador de expiração, botão **Gerar novo** |
| `connecting` sem qr | Spinner "Conectando…" |
| `connected` | Perfil (foto, nome, número), badge verde, abas completas |
| `hibernated` | Badge âmbar "Sessão pausada" + botão **Reconectar** |
| `remoteDeletedAt` | Banner vermelho "Instância removida no provedor" + só **Remover** |
| `503` da API | Card "Integração não configurada neste ambiente" |

`member` vê tudo em modo leitura; botões de mutação não são renderizados.

### 8.3 Polling

`refetchInterval` dinâmico no `useWhatsappInstance`: **3s** quando `status ∈ {connecting}` ou há
`qrcode`; **30s** quando `connected`; `false` quando não há instância. Sem WebSocket — o elosCRM não
tem realtime, e o QR é o único momento em que segundos importam.

Mutations invalidam `["whatsapp", org?.id]`; `useActiveOrganization` já embute o `org.id` na key,
então trocar de imobiliária limpa o cache naturalmente.

### 8.4 QR Code

A uazapi devolve `qrcode` como data URI base64 (`data:image/png;base64,…`). Renderiza direto em
`<img src={qrcode}>` — sem biblioteca de QR. `next/image` fica de fora (data URI + `unoptimized`
não paga o custo).

---

## 9. Testes — `test/whatsapp.test.ts`

O banco continua real (Postgres de teste, `buildApp()`, sign-up de verdade via
`test/helpers/session.ts`). A **uazapi é mockada** com `vi.mock("../src/lib/uazapi/index.js")` —
é serviço externo de terceiro, não há alternativa sã; fica documentado como exceção deliberada à
regra "sem mocks" do `CLAUDE.md` (que trata de banco).

Casos:

1. `GET /v1/whatsapp/instance` sem sessão → `401`; sem org ativa → `403`.
2. `POST /instance` como `member` → `403`.
3. `POST /instance` cria; segunda chamada → `409 INSTANCE_ALREADY_EXISTS`.
4. Resposta de `GET /instance` **não contém** `tokenEnc`, `tokenHash`, `webhookSecret`; contém `tokenLast4`.
5. Org B não enxerga a instância da org A (cada arquivo cria a própria org — o padrão da suíte).
6. Webhook: secret errado → `401`; `instanceId` inexistente → `401`; `body.token` de outra instância → `401`.
7. Webhook `connection` com `status: "connected"` → status persistido, `qrcode`/`paircode` zerados,
   log `connected` com `source: webhook`.
8. Webhook `connection` com `status: "hibernated"` → persiste `hibernated` (regressão de D2).
9. Webhook `lastDisconnectReason: "instance deletion"` → `remoteDeletedAt` + log `remote_deleted`.
10. Evento não assinado (`messages`) → `200` sem escrita no banco.
11. `crypto.ts`: `decryptToken(encryptToken(x)) === x`; payload adulterado lança.
12. Envs ausentes → `503 INTEGRATION_NOT_CONFIGURED`.

---

## 10. Plano de execução

Cada fase termina com `pnpm lint && pnpm typecheck && pnpm test` verdes.

**Fase 1 — destravar a lib.** `pnpm add axios`; corrigir `@/` (B3); adicionar as 4 envs (B4) +
`.env.example`; aplicar D1/D2/D3; corrigir os dois `CLAUDE.md`.
*Saída:* `pnpm typecheck` passa com a lib presente (`snapshot.ts` ainda quebrado até a fase 2).

**Fase 2 — dados e cripto.** Models e enums no `schema.prisma` + relações em `Organization`/`User`;
`pnpm db:generate` + `db:push` + `db:push:test`; `src/lib/crypto.ts`; teste de round-trip.
*Saída:* `snapshot.ts` compila; caso 11 verde.

**Fase 3 — API.** Módulo `whatsapp` completo, rotas `/v1/whatsapp`, receptor `/webhooks/uazapi`,
`omitSecrets` e mascaramento da URL. Testes 1-10 e 12.
*Saída:* fluxo completo exercitável por `app.inject`.

**Fase 4 — Web.** Tipos, `lib/queries/whatsapp.ts`, página, componentes, item de sidebar.
*Saída:* `pnpm lint && pnpm typecheck && pnpm build` no web.

**Fase 5 — validação real e docs.** Túnel apontando `PUBLIC_API_URL`, criar instância contra a uazapi
de verdade, ler o QR com um aparelho, confirmar que o webhook chega e o status muda sozinho.
Atualizar `CLAUDE.md` raiz e o da API (módulo novo, envs, pegadinha do `PUBLIC_API_URL`, débito de
rate limit, exceção do mock).

---

## 11. Riscos

| Risco | Mitigação |
|---|---|
| **`prisma db push` manual em produção** — o `CLAUDE.md` raiz registra que já derrubou `/v1/dashboard/stats` uma vez | rodar o push **antes** de subir a imagem; se pedir `--accept-data-loss`, parar |
| **Webhook não chega em dev** — `PUBLIC_API_URL` cai em `localhost` | documentado; botão Sincronizar cobre o fluxo de dev sem túnel |
| **Chave de cripto perdida/trocada** | todos os tokens viram lixo → `INSTANCE_TOKEN_CORRUPTED`; a saída é remover e recriar a instância. A chave entra no cofre de produção junto com `BETTER_AUTH_SECRET` |
| **Rotação do secret do webhook** | não implementada nesta fase; o caminho é remover + recriar. `admin_token_rotate` (§1.3) resolveria melhor no futuro |
| **`503` + `Retry-After` no connect** | mapeado para `UAZAPI_CAPACITY` com o `Retry-After` em `details`; a UI mostra "tente em N segundos" em vez de erro genérico |
| **Instância deletada direto no painel da uazapi** | `isInstanceGoneError` + evento `instance deletion` marcam `remoteDeletedAt`; a UI degrada para "remover e recomeçar" |

---

## 12. Fora de escopo (fase seguinte)

Sincronização mensagem → lead: assinar `messages`, mapear `chatid`/`sender` para `Client`, criar
`Client` a partir de conversa nova (`ClientSource.WHATSAPP` já existe no enum), timeline de conversa,
envio pelo CRM (`send.text`/`send.media` já estão na lib), campanhas, `proxy`, `groups`.

---

---

## 13. Estado da execução

Fases 1 a 4 **implementadas e verdes** (`lint` + `typecheck` + `test` na API, `lint` + `typecheck` +
`build` no web). Suíte da API em 36 arquivos / 205 testes, sendo 20 novos em `test/whatsapp.test.ts`
e 6 em `test/crypto.test.ts`.

Divergências do que este spec previa, todas deliberadas:

- **Models sem `@@map`.** O spec copiou `@@map("uazapiInstance")` da referência, mas neste schema só
  os models do Better Auth usam `@@map`; os de domínio não. Seguimos o padrão do repo.
- **`httpError` ganhou `expose` e `details`.** Não estava previsto: o `errorHandler` mascarava *todo*
  5xx como `{ code: "INTERNAL" }`, o que engoliria `UAZAPI_ERROR`/`UAZAPI_CAPACITY`/
  `UAZAPI_UNAVAILABLE`. Sem essa mudança os códigos da §6.2 não chegariam ao front.
- **`eventForTransition` não precisou mudar** para `hibernated`: o fallback já devolve
  `status_changed`, que é o evento correto.

**Fase 5 é a que fecha o contrato do webhook — não é formalidade.** Falta o teste de ponta a ponta
contra a uazapi real (criar instância, ler o QR num aparelho, confirmar que o evento chega e muda o
estado sozinho). Exige `UAZAPI_ADMIN_TOKEN` e um túnel em `PUBLIC_API_URL`; nenhum dos dois está no
`.env` de dev.

O ponto que só ela resolve é o da §5.1: **o formato do corpo entregue pela uazapi nunca foi
observado**. O receptor foi feito tolerante justamente para não quebrar em silêncio enquanto isso
não acontece, mas tolerância não é confirmação. Ao rodar a fase 5, capturar um corpo real (o
`log.warn` do receptor já imprime as chaves quando o envelope não é reconhecido) e registrar o
formato aqui e no `CLAUDE.md` da API.

O que **foi** verificado sem essas credenciais: a tela renderizada no navegador nos estados "sem
instância" e "conectado" (header, telefone formatado a partir do JID, abas, histórico com labels em
pt-BR), a degradação em `503` quando a integração não está configurada, e os três envelopes
candidatos aceitos pelo receptor (testes em `test/whatsapp.test.ts`).

> Criado em 2026-08-03 21:33 (-03) · Última modificação: 2026-08-03 23:03 (-03)

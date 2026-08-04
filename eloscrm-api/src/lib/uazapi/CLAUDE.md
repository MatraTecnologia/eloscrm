# lib/uazapi

Cliente HTTP modular para a **uazapiGO** (WhatsApp API, v2.1.1). Spec OpenAPI de referência em [`docs/uazapi/`](../../../../../docs/uazapi/) (na raiz do repo, fora dos dois projetos).

**Consumidor:** `src/modules/whatsapp/` — ciclo de vida da instância por imobiliária. Design em
[`docs/superpowers/specs/2026-08-03-whatsapp-uazapi-design.md`](../../../docs/superpowers/specs/2026-08-03-whatsapp-uazapi-design.md).

## Estrutura

```
uazapi/
├── index.ts       # Builder createUazapiClient + singleton uazapi() + barrel exports
├── client.ts      # Axios HTTP factory, auth headers, normalização de erro, request helpers
├── types.ts       # Tipos manuais (sincronizados à mão com docs/.../schemas/*.yaml)
├── admin.ts       # /instance/create, /instance/all, /globalwebhook* (admintoken)
├── instance.ts    # /instance/connect, /status, /reset, /disconnect, /wa_messages_limits (token)
├── webhook.ts     # /webhook (get/upsert/delete), /webhook/errors (token)
├── send.ts        # /send/text, /send/media, /message/presence (token)
├── messages.ts    # /message/find (token)
├── proxy.ts       # /proxy-managed/cities, /instance/proxy (GET/POST) (token)
├── contacts.ts    # /chat/check, /chat/details, /contacts, /contacts/list (token)
└── groups.ts      # /group/info, /group/list (GET/POST) (token)
```

> **Tipos são manuais.** `types.ts` espelha `docs/uazapi/schemas/*.yaml` sem geração automática. Ao mexer na spec, atualize aqui também (ou introduza `openapi-typescript`).

## Duas coisas que parecem descuido e não são

**Metade dos módulos não tem consumidor.** Só `admin`, `instance` e `webhook` são usados hoje. `send`, `messages`, `contacts`, `groups` e `proxy` foram importados junto e ficam esperando a fase de sincronização de leads — decisão registrada no spec de design, não sobra de copy-paste. Não podar.

**O estilo diverge do resto da API.** Esta pasta usa aspas simples e sem ponto-e-vírgula; o resto de `src/` usa aspas duplas com ponto-e-vírgula. Não há Prettier no projeto e o oxlint não tem regra de formatação, então reformatar geraria um diff de ~1500 linhas sem ganho. Código novo **fora** desta pasta segue o estilo da API.

## Autenticação

Dois headers, escolhidos por endpoint:

| Header | Quando | Origem |
|--------|--------|--------|
| `token` | endpoints regulares (instância) | `config.token` ou `options.token` |
| `admintoken` | endpoints administrativos | `config.adminToken`, `options.adminToken` ou `env.UAZAPI_ADMIN_TOKEN` |

O `buildAuthHeaders` em `client.ts` injeta automaticamente — não passe `Authorization` manualmente.

## Uso

### Singleton (config via env)

```typescript
import { uazapi } from '@/lib/uazapi/index.js'

// Operações administrativas globais (usa UAZAPI_ADMIN_TOKEN do env)
const result = await uazapi().admin.listInstances()
if (!result.success) return reply.badGateway(result.error.error)
const instances = result.data

// Escopo por instância (override do token via withInstance)
const sendResult = await uazapi().withInstance(instanceToken).send.text({
  number: '5511999999999',
  text: 'Olá!',
})
```

Requer `UAZAPI_BASE_URL` (obrigatória para `uazapi()`); `UAZAPI_ADMIN_TOKEN` é opcional (necessária só para endpoints `admintoken`).

### Config explícita (multi-tenant)

```typescript
import { createUazapiClient } from '@/lib/uazapi/index.js'

const client = createUazapiClient({
  baseURL: tenant.uazapiBaseUrl,
  adminToken: tenant.uazapiAdminToken,
})

await client.withInstance(tenant.uazapiInstanceToken).webhook.upsert({
  url: 'https://meu-app.com/webhook',
  events: ['messages', 'connection'],
})
```

### Override por chamada

```typescript
await uazapi().send.text(
  { number, text },
  { token: instanceToken, signal: abortController.signal },
)
```

`RequestOptions` aceita `token`, `adminToken`, `signal`, `headers` — todos sobrescrevem a config do cliente apenas para aquela chamada.

### Trace opcional (`onTrace`)

`UazapiClientConfig.onTrace` recebe cada requisição e cada resposta/erro (`direction`, `method`, `path`, `status`, `body`). Serve para diagnóstico externo — a lib não conhece arquivo, env nem redação de segredo; quem passa o callback decide o que fazer. Ausente, nenhum interceptor é registrado. Consumidor atual: `src/modules/whatsapp/whatsapp.gateway.ts`, que liga em `src/lib/debug-log.ts`.

```typescript
createUazapiClient({ baseURL, token, onTrace: entry => myLogger(entry) })
```

## `hibernated` é o quarto estado, não um detalhe

`InstanceStatus` tem **quatro** valores: `disconnected | connecting | connected | hibernated`. O último entrou na v2.1.1 (sessão pausada com credenciais preservadas) e precisa existir em três lugares ao mesmo tempo — `types.ts`, o `STATUS_MAP` de `snapshot.ts` e o enum `UazapiInstanceStatus` do Prisma. Se faltar em qualquer um deles, `parseStatus` devolve `null`, `applyInstanceSnapshot` não escreve `status` e **o estado local congela no anterior**: a tela segue mostrando "conectado" para um número que parou de atender. Já aconteceu na importação inicial desta lib.

## Padrão `Result<T>`

Toda chamada retorna `Promise<Result<T>> = Ok<T> | Err`. Nunca lança em erro HTTP — apenas em má configuração (token ausente, baseURL vazia).

```typescript
const r = await uazapi().instance.status({ token })
if (!r.success) {
  request.log.error({ err: r.error }, 'uazapi falhou')
  return reply.badGateway(r.error.message_ptbr ?? r.error.error)
}
return r.data
```

### `UazapiErrorPayload`

| Campo | Quando aparece |
|-------|----------------|
| `status` | HTTP status (0 se erro de rede/timeout/desconhecido) |
| `error` | mensagem principal (de `body.error`, `body.message` ou `error.message`) |
| `error_source` | `'whatsapp_server'` \| `'api'` \| `'network'` \| `'timeout'` \| `'unknown'` |
| `error_key`, `provider*`, `message_ptbr`, `diagnostics_endpoint` | quando a uazapi devolve diagnóstico estruturado (ex: bloqueios do WhatsApp) |
| `details.new_chat_message_capping`, `details.reachout_timelock` | diagnóstico de capping/timelock do WhatsApp |
| `raw` | body original (ou `{ code }` para erros de transporte) |

Use `error_source === 'whatsapp_server'` para distinguir bloqueios reais do WhatsApp de falhas de rede/API.

## Imutabilidade da config

`withInstance` e `withAdminToken` retornam **novos** `UazapiClient` com a config sobrescrita — o cliente original permanece intacto. Use livremente em fluxos concorrentes.

```typescript
const base = uazapi()
const a = base.withInstance(tokenA)
const b = base.withInstance(tokenB)
// a e b são clientes independentes; base segue sem token de instância
```

## APIs disponíveis

### `admin` (requer `admintoken`)

| Método | Endpoint | Uso |
|--------|----------|-----|
| `createInstance(params)` | `POST /instance/create` | Cria nova instância |
| `listInstances()` | `GET /instance/all` | Lista todas as instâncias |
| `updateAdminFields(params)` | `POST /instance/updateAdminFields` | Atualiza `adminField01/02` (metadados internos) |
| `getGlobalWebhook()` | `GET /globalwebhook` | Lê webhook global |
| `upsertGlobalWebhook(params)` | `POST /globalwebhook` | Cria/atualiza webhook global |
| `globalWebhookErrors()` | `GET /globalwebhook/errors` | Erros recentes + `captureStartedAt` (vem do header `x-webhook-error-capture-started-at`) |

### `instance` (requer `token`)

| Método | Endpoint | Uso |
|--------|----------|-----|
| `connect(params?)` | `POST /instance/connect` | Inicia conexão; retorna QR code / paircode |
| `disconnect()` | `POST /instance/disconnect` | Encerra sessão |
| `reset()` | `POST /instance/reset` | Força reset (limpa fila, reinicia) |
| `status()` | `GET /instance/status` | Estado atual (`connected`, `jid`, `loggedIn`) |
| `waMessagesLimits()` | `GET /instance/wa_messages_limits` | Diagnóstico de capping/timelock |
| `updateName(params)` | `POST /instance/updateInstanceName` | Renomeia instância |
| `delete()` | `DELETE /instance` | Remove instância |

### `webhook` (requer `token`)

| Método | Endpoint | Uso |
|--------|----------|-----|
| `get()` | `GET /webhook` | Lista webhooks da instância |
| `upsert(params)` | `POST /webhook` | Cria/atualiza webhook |
| `delete(id)` | `POST /webhook` (`{ action: 'delete', id }`) | Remove webhook |
| `errors()` | `GET /webhook/errors` | Falhas de entrega + `captureStartedAt` |

### `send` (requer `token`)

| Método | Endpoint | Uso |
|--------|----------|-----|
| `text(params)` | `POST /send/text` | Texto + link preview opcional |
| `media(params)` | `POST /send/media` | Imagem, vídeo, áudio, documento, sticker, ptt, ptv |
| `presence(params)` | `POST /message/presence` | Composing / recording / paused |

Todos suportam `CommonSendOptions` (delay, readchat, readmessages, replyid, viewOnce, mentions, forward, track_source, track_id, async). Ver convenções em `docs/uazapi/CLAUDE.md`.

### `messages` (requer `token`)

| Método | Endpoint | Uso |
|--------|----------|-----|
| `find(params?)` | `POST /message/find` | Busca paginada com filtros por `id`, `chatid`, `track_*`, `limit`, `offset` |

Útil para verificar status de envios `async: true` (filtrar por `status: 'Failed'`).

### `proxy` (requer `token`)

| Método | Endpoint | Uso |
|--------|----------|-----|
| `listCities(params?)` | `GET /proxy-managed/cities` | Lista cidades disponíveis para o proxy gerenciado (`country` default `br`; filtros `state`, `search`). Catálogo com cache interno de 24h |
| `get()` | `GET /instance/proxy` | Lê config atual: `mode` (intenção persistida) vs `effective_mode` (transporte em runtime), `fallback.active`, `validation_error` |
| `update(params)` | `POST /instance/proxy` | Define `mode: 'custom' \| 'internal' \| 'none'`. `'custom'` exige `proxy_url`; `'none'` exige `confirm_no_proxy: true`. Retorno `200` significa **persistido**, não validado em uso — confirme via `get()` depois |

URLs aceitas em `proxy_url` e `proxy_fallback` (quando URL): `http://`, `https://`, `socks5://`, `socks5h://`. **`socks://` genérico não é aceito.**

### `contacts` (requer `token`)

| Método | Endpoint | Uso |
|--------|----------|-----|
| `check(params)` | `POST /chat/check` | Verifica em lote se números/IDs de grupo estão no WhatsApp; retorna `jid`, `isInWhatsapp`, `verifiedName`, `groupName` |
| `details(params)` | `POST /chat/details` | Detalhes completos do chat/contato (60+ campos do modelo Chat). Use `preview: true` para imagem otimizada (campo `imagePreview` em vez de `image`) |
| `list(query?)` | `GET /contacts` | Lista completa de contatos. `contactScope`: `'address_book'` (padrão), `'outside_address_book'`, `'all'` |
| `listPaginated(params?)` | `POST /contacts/list` | Versão paginada (`limit` padrão 100, máx 1000; `offset`). Retorna `{ contacts, pagination, totalDeviceContacts }` |

> `ChatDetailsResponse` modela apenas os campos mais comuns dos exemplos da spec. Se precisar de campos não tipados, estenda a interface em `types.ts` em vez de fazer cast.

### `groups` (requer `token`)

| Método | Endpoint | Uso |
|--------|----------|-----|
| `info(params)` | `POST /group/info` | Detalhes completos do grupo (obrigatório `groupjid`). Opcionais: `force` (ignora cache), `getInviteLink`, `getRequestsParticipants` |
| `list(query?)` | `GET /group/list` | Lista todos os grupos. `force` (atualiza cache), `noparticipants` (omite participantes) |
| `listPaginated(params?)` | `POST /group/list` | Versão paginada com `search` (filtro por nome/JID), `limit` (padrão 50, máx 1000), `offset`, `force`, `noParticipants` |

> Os campos do `UazapiGroup`/`UazapiGroupParticipant` usam **PascalCase** (`JID`, `Name`, `IsAdmin`, ...) — é o formato retornado pela uazapi. Diferente do resto da API. O `groupjid` em `GetGroupInfoParams` é **lowercase** (assim a uazapi exige).

## Adicionando novo endpoint

1. Adicione (ou edite) os tipos em `types.ts` — replica do `schemas/*.yaml` correspondente.
2. Adicione o método na API certa (`admin`/`instance`/`webhook`/`send`/`messages`) ou crie uma nova área `createXxxApi`.
3. Se for uma nova área, registre em `index.ts` (interface `UazapiClient`, builder `build`, barrel).
4. Use `request<TResponse, TBody>` para resposta-apenas, ou `requestWithHeaders` quando precisar de headers (caso raro — só `webhook.errors` e `admin.globalWebhookErrors` hoje).
5. Não invente abstrações por endpoint — mantenha o padrão `request(...)` direto.

## Convenções

- **Sem `function` declarations.** Tudo `const` arrow.
- **Sem try/catch nos consumidores.** Use o `Result<T>`. Erros já estão normalizados em `UazapiErrorPayload`.
- **Sem comentários.** Os nomes dos métodos espelham as tags da uazapi.
- **ESM:** todos os imports com `.js`.
- **Não exporte instâncias Axios.** Use apenas o `UazapiClient` (`uazapi()` / `createUazapiClient`).

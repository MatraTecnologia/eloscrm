# Better Auth — Playbook de Produção

Guia portável para replicar em outros projetos. Extraído de uma investigação real: um app em produção entrava em **loop de recarregamento** e a única saída era limpar os dados do site. A causa eram dois bugs empilhados, ambos com raiz em defaults do Better Auth que não são óbvios.

Cada item traz **o quê**, **por quê**, **o código**, e **como verificar de verdade**. O histórico específico daquele caso está em [`auth-hardening-plan.md`](./auth-hardening-plan.md); aqui só o que se reaproveita.

**Stack de referência:** Next.js (App Router) + API separada (Fastify) + Better Auth 1.6 + Prisma/PostgreSQL + Redis como `secondaryStorage`, com o front proxiando `/api/auth/*` para a API via rewrite (cookies same-origin).

---

## 0. TL;DR — checklist

| # | Item | Custo de deploy |
|---|---|---|
| 1 | Middleware nunca redireciona **para fora** de rota pública | nenhum |
| 2 | `getServerSession` distingue `error` de `unauthenticated` | nenhum |
| 3 | Rota de recuperação faz sign-out **e** expira cookies | nenhum |
| 4 | `session.storeSessionInDatabase: true` | ⚠️ **desloga todos** |
| 5 | `verification.storeInDatabase: true` | nenhum |
| 6 | `session.cookieCache` com `maxAge` curto | nenhum |
| 7 | Origins vindas **só** do env | nenhum |
| 8 | `rateLimit.storage` com fallback | nenhum |
| 9 | `@better-auth/redis-storage` com `keyPrefix` | nenhum¹ |

> ¹ **Só é sem custo se o #4 e o #5 vierem antes.** Ver §10.

---

## 1. A invariante central: quem decide auth precisa concordar

O bug mais caro não estava em nenhuma linha isolada — estava em **três camadas decidindo autenticação com informações diferentes**:

| Camada | Decide com base em |
|---|---|
| Middleware / `proxy.ts` | **Presença** do cookie |
| Layout protegido | **Validação real** (`get-session`) |
| Layout de auth | **Validação real** (`get-session`) |

Quando o cookie **existe mas a sessão é inválida**, as camadas discordam e o ciclo fecha:

```
/dashboard → middleware: cookie existe → passa
           → layout: sessão inválida → /api/clear-session
/api/clear-session → /sign-in
/sign-in   → middleware: cookie presente → /dashboard   ← ARESTA QUE FECHA O LOOP
```

Enquanto qualquer cookie sobreviver, `/sign-in` **nunca renderiza** — e o usuário não consegue nem logar para sair do estado. Limpar os dados do site remove o cookie manualmente, que é o que quebra o ciclo.

A doc do Better Auth é explícita:

> "Proxy (Middleware) is not intended for slow data fetching. While Proxy can be helpful for optimistic checks such as permission-based redirects, it should not be used as a full session management or authorization control."
> — [`/docs/guides/workos-migration-guide`](https://better-auth.com/docs/guides/workos-migration-guide#protecting-resources)

### A regra

> **A camada otimista pode redirecionar tráfego que *parece* deslogado **para** o login. Nunca pode redirecionar **para fora** de uma rota pública.**

Quem decide quem vê `/sign-in` é o layout que valida de fato. Assim, mesmo que o cookie **nunca** seja limpo, `/sign-in` renderiza, o usuário loga, e o ciclo não fecha. É a restrição mais forte do playbook — implemente esta primeiro.

---

## 2. Middleware otimista (Next.js)

```ts
// proxy.ts (Next 16) / middleware.ts (Next ≤15)
import { type NextRequest, NextResponse } from 'next/server'

const publicPaths = [
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/two-factor',
  '/verify-email',
  '/api/auth',
  // Rotas de recuperação — nunca podem ser barradas, são a saída de uma sessão ruim
  '/api/clear-session',
  '/not-authorized',
]

const isPublicPath = (pathname: string) =>
  publicPaths.some(path => pathname === path || pathname.startsWith(`${path}/`))

/**
 * A checagem de cookie aqui é OTIMISTA — presença não prova validade.
 * Esta camada só pode redirecionar tráfego aparentemente deslogado PARA o login.
 * Nunca pode redirecionar PARA FORA de uma rota pública: um cookie stale-but-present
 * brigaria com o redirect do layout para sempre.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const sessionCookie =
    request.cookies.get('better-auth.session_token') ??
    request.cookies.get('__Secure-better-auth.session_token')
  const isAuthed = !!sessionCookie?.value

  if (!isAuthed) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  return NextResponse.next()
}
```

**Anti-padrão — foi exatamente isto que causou o loop:**

```ts
// ❌ NUNCA
if (isAuthed && pathname === '/sign-in') {
  return NextResponse.redirect(new URL('/dashboard', request.url))
}
```

> **Nota:** o nome do cookie tem o prefixo `__Secure-` quando `advanced.useSecureCookies` está ligado (default em produção). Cheque **os dois**.

---

## 3. `error` ≠ `unauthenticated`

O segundo bug: a função que buscava a sessão fazia isto —

```ts
// ❌ ANTES
try { /* ... */ } catch { return null }
```

Qualquer falha (API fora do ar, timeout, 500, DNS, **rate limit**) virava `null`. O layout lia `null` como "deslogado" e mandava para a rota que **destrói a sessão**. Ou seja: um blip transitório de rede deslogava um usuário válido — e, somado ao §1, jogava ele direto no loop.

```ts
// lib/auth-server.ts
import { headers } from 'next/headers'

interface ServerSessionUser {
  id: string
  name: string
  email: string
  role: string
  image?: string | null
}

/**
 * `error` precisa ficar distinto de `unauthenticated`: tratar falha de API como
 * "deslogado" destrói uma sessão válida e prende o usuário num loop de redirect.
 */
export type SessionResult =
  | { status: 'authenticated'; user: ServerSessionUser }
  | { status: 'unauthenticated' }
  | { status: 'error' }

const SESSION_TIMEOUT_MS = 5000

export const getServerSession = async (): Promise<SessionResult> => {
  const headersList = await headers()
  const cookie = headersList.get('cookie')

  if (!cookie) return { status: 'unauthenticated' }

  let res: Response

  try {
    res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/get-session`, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    })
  } catch {
    return { status: 'error' }
  }

  if (res.status === 401) return { status: 'unauthenticated' }
  if (!res.ok) return { status: 'error' }

  try {
    const data = await res.json()
    if (!data?.user) return { status: 'unauthenticated' }
    return { status: 'authenticated', user: data.user as ServerSessionUser }
  } catch {
    return { status: 'error' }
  }
}
```

**Consumo nos layouts:**

```tsx
// app/(protected)/layout.tsx
const result = await getServerSession()

// API fora do ar não é usuário deslogado — limpar aqui destruiria sessão válida.
if (result.status === 'error') return <SessionUnavailable />
if (result.status === 'unauthenticated') redirect('/api/clear-session')
if (result.user.role === 'user') redirect('/not-authorized')
```

```tsx
// app/(auth)/layout.tsx
const result = await getServerSession()

// Só sessão confirmada redireciona. Em `error`, falha aberto e renderiza o form:
// a rota é pública e tudo atrás dela é validado no backend.
if (result.status === 'authenticated') {
  redirect(result.user.role === 'user' ? '/not-authorized' : '/dashboard')
}
```

> **Não esqueça o `AbortSignal.timeout`.** Sem ele, uma API pendurada trava o render da página indefinidamente.

---

## 4. Rota de recuperação idempotente

```ts
// app/api/clear-session/route.ts
import { NextResponse } from 'next/server'

const SIGN_OUT_TIMEOUT_MS = 5000

/** Nomes-base em que o Better Auth pode guardar sessão, sem o prefixo. */
const sessionCookieNames = [
  'better-auth.session_token',
  'better-auth.session_data', // criado pelo cookieCache (§7)
]

/**
 * Revoga a sessão no servidor (best effort) E expira os cookies localmente.
 *
 * Os dois passos são necessários: o sign-out só limpa cookies enquanto a sessão
 * ainda é válida, e o caso que esta rota existe para resolver é justamente um
 * cookie cuja sessão já morreu — ali, a expiração local é a única coisa que funciona.
 */
export const GET = async (request: Request) => {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const baseUrl = host ? `${proto}://${host}` : process.env.NEXT_PUBLIC_BASE_URL!

  const response = NextResponse.redirect(
    new URL('/sign-in?session_expired=1', baseUrl),
  )

  const cookie = request.headers.get('cookie')

  if (cookie) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
    }).catch(() => null)
  }

  const isSecure = proto === 'https'

  // Precisa espelhar os atributos que o Better Auth seta, senão o browser mantém
  // o cookie: a deleção casa por nome + path + domain (host-only aqui).
  const expireOptions = {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    sameSite: 'lax' as const,
  }

  for (const name of sessionCookieNames) {
    response.cookies.set(name, '', { ...expireOptions, secure: isSecure })
    if (isSecure) {
      response.cookies.set(`__Secure-${name}`, '', { ...expireOptions, secure: true })
    }
  }

  return response
}
```

**Armadilhas:**

- **Só sign-out não basta.** Com sessão já inválida, o Better Auth responde 401 e **não** manda `Set-Cookie` de limpeza — exatamente o caso que a rota existe para tratar.
- **Só limpeza local também não basta.** Se a sessão for válida, ela continua viva no servidor.
- **Confira os atributos.** Deleção de cookie casa por **nome + path + domain**. Se o seu setup usa `crossSubDomainCookies`, o cookie tem `Domain` — e você precisa setar o mesmo `domain` ao expirar.
- **Se adotar o `cookieCache` (§7)**, inclua `session_data` na lista **antes**, senão a recuperação passa a deixar lixo.

> **Nota de segurança:** sendo `GET`, esta rota é vulnerável a logout-CSRF (um `<img src="/api/clear-session">` desloga o usuário). Severidade baixa (é só logout), mas se incomodar, use `POST` + form action.

---

## 5. ⚠️ `secondaryStorage` guarda **três** coisas, não uma

**O default mais perigoso do Better Auth**, e a raiz do bug original.

> "`secondaryStorage`: Secondary storage configuration used to store **session data**, **verification records**, and **rate limit data**."
> — [`/docs/reference/options`](https://better-auth.com/docs/reference/options)

> "By default, Better Auth already stores sessions in the database, however if you provide a secondary storage, Better Auth will store sessions in the secondary storage **instead of** the database."
> — [`/docs/concepts/session-management`](https://better-auth.com/docs/concepts/session-management#storing-sessions-in-the-database)

**Traduzindo:** no momento em que você configura `secondaryStorage` (Redis), suas sessões param de ir para o banco. Elas passam a existir **só no Redis**. Um restart, um flush, ou uma eviction por `maxmemory-policy` (muitos deploys usam `allkeys-lru` por default) invalida **todas as sessões de uma vez**, enquanto os cookies continuam nos browsers.

Isso produz exatamente o estado "cookie válido + sessão inválida" do §1 — e explica o sintoma **intermitente** ("às vezes"), porque depende do ciclo de vida do Redis.

E não são só as sessões: **verification records** também. Ou seja, links de verificação de email, links de reset de senha e códigos OTP em voo evaporam junto.

```ts
export const auth = betterAuth({
  session: {
    // Sem isto, o secondaryStorage faz as sessões viverem SÓ no Redis.
    storeSessionInDatabase: true,
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  verification: {
    // Mesmo motivo — sem isto, verification records vão só pro Redis.
    storeInDatabase: true,
  },
  secondaryStorage: /* ... */,
})
```

### Como diagnosticar em 10 segundos

```sql
-- Com um usuário logado AGORA (cookie de sessão válido no browser):
SELECT count(*) FROM session;
```

**Retornou 0?** Suas sessões estão só no Redis. É prova, não indício — uma sessão ativa **obrigatoriamente** teria linha.

Para verification o mesmo teste **não** vale: os registros são efêmeros (expiram em ~1h, são consumidos no uso), então 0 é igualmente consistente com "nenhum em voo". A prova ali é disparar um reset de senha real e conferir se a linha aparece:

```sql
SELECT identifier, "createdAt", "expiresAt"
FROM verification ORDER BY "createdAt" DESC LIMIT 3;
-- → reset-password:mlPXuIAmffVYW… | criada: 17:18:51 | expira: 18:18:51
```

---

## 6. Redis não pode despejar chaves

Complementar ao §5, **em infra**:

```
maxmemory-policy noeviction
```

Mais persistência (AOF). Depois do §5 isso vira **defesa em profundidade** — o Redis deixa de ser fonte da verdade de qualquer coisa de auth — mas ainda protege rate limit e o que mais compartilhar aquele Redis.

---

## 7. `cookieCache` — ganho real, custo real

```ts
session: {
  cookieCache: { enabled: true, maxAge: 60 },
}
```

**Ganho:** corta chamadas de `get-session`. Importa mais do que parece se o seu `getServerSession` bate na URL **pública** da API — aí cada hard load é um round-trip externo saindo e voltando pelo proxy reverso.

**Custo:** atrasa a propagação de **revogação e mudança de role** em até `maxAge`, porque a checagem de acesso do layout lê o cache. Um admin rebaixado mantém acesso pela janela; uma sessão revogada na tela de "Sessões" segue válida no outro device pelo mesmo período.

**Recomendação:** `maxAge: 60` em vez dos `5 * 60` da doc — mantém quase todo o ganho com 1/5 da janela. Escape hatch: `disableCookieCache: true` na chamada.

**Calibre a expectativa:** no App Router, o layout **não** re-executa em soft navigation entre páginas irmãs (o Next preserva o layout). O ganho é em **hard load**, não em "toda navegação".

**Efeitos colaterais:**
- Cria o cookie `better-auth.session_data` (`__Secure-` em prod) → inclua no §4.
- Esse cookie **não é pequeno** (~1.4 KB medido, com 2 `additionalFields`) e vai em **toda** request para o domínio. Abate parte do ganho, e cresce a cada `additionalFields` novo.

---

## 8. Origins: o env como fonte única

```ts
// lib/cors.ts
import { env } from '@/env.js'

/**
 * TRUSTED_ORIGINS (obrigatório, validado no boot) é a fonte única dos hosts
 * confiáveis — não hardcodar host aqui.
 */
const isDev = env.NODE_ENV !== 'production'
const localhostPattern = /^https?:\/\/localhost(:\d{1,5})?$/

export const origins: (string | RegExp)[] = isDev ? [localhostPattern] : []
export const trustedOrigins: string[] = isDev ? ['http://localhost:*'] : []

export const isAllowedOrigin = (origin: string): boolean =>
  origins.some(p => (typeof p === 'string' ? p === origin : p.test(origin))) ||
  env.TRUSTED_ORIGINS.includes(origin)
```

```ts
// env.ts — obrigatório, para o boot falhar alto se faltar
TRUSTED_ORIGINS: z.string().trim().transform(s => s.split(',').map(o => o.trim())),
```

**Por quê.** A versão anterior tinha host hardcoded **e** um wildcard `*.<painel>`:

```ts
// ❌ ANTES
const domainPattern = (d: string) =>
  new RegExp(`^https?:\\/\\/(www\\.)?(([a-z0-9-]+\\.)*)?${d.replace(/\./g, '\\.')}$`)

export const trustedOrigins = ['https://*.meu-painel.host', 'https://meu-painel.host']
```

Dois problemas: o regex aceitava **`http://`** em produção e **qualquer subdomínio irmão**; e o host hardcoded **driftou** do host real depois de uma migração — ficou meses errado sem quebrar nada, porque o env cobria.

> **Aviso de tempo perdido:** esse drift é um **imã de falso positivo**. Quando o login falhou durante os testes, o host errado no código foi a suspeita imediata e óbvia. Não era a causa — o env já listava o host correto e o Better Auth faz `[...trustedOrigins, ...env.TRUSTED_ORIGINS]`; além disso, com tudo same-origin via rewrite, CORS nem participa do login. A causa real era rate limit acumulado. **Corrija o drift, mas não assuma que ele é a causa de nada.**

---

## 9. `rateLimit.storage` precisa de fallback

```ts
rateLimit: {
  enabled: true,
  window: 60,
  max: 100,
  // 'secondary-storage' só existe se houver Redis; sem o fallback, aponta
  // para um storage undefined.
  storage: redis ? 'secondary-storage' : 'memory',
  customRules: {
    '/get-session': false,        // chamado em todo render — nunca limitar
    '/sign-in/email': { window: 30, max: 5 },
    '/sign-up/email': { window: 60, max: 3 },
    '/request-password-reset': { window: 60, max: 3 },
    '/two-factor/verify-totp': { window: 30, max: 5 },
    // ...
  },
}
```

> **`'/get-session': false` é obrigatório** se o layout chama `get-session` a cada render — senão você limita seus próprios usuários.

> **Rate limit em loop é traiçoeiro.** Quando um bug de auth faz o app tentar logar repetidamente, o limite de `/sign-in/email` (5/30s) estoura e o login passa a falhar *de verdade* — mascarando o bug original com um sintoma secundário que some sozinho. Foi o que aconteceu aqui e custou uma rodada inteira de diagnóstico errado.

---

## 10. `@better-auth/redis-storage` + `keyPrefix`

```bash
pnpm add @better-auth/redis-storage ioredis
```

```ts
import { redisStorage } from '@better-auth/redis-storage'

// keyPrefix isola as chaves de auth de outros usuários do mesmo Redis
// (filas, cache da aplicação, etc).
secondaryStorage: redis
  ? redisStorage({ client: redis, keyPrefix: 'better-auth:' })
  : undefined,
```

Substitui a implementação manual (que é o exemplo "Manual Implementation" da doc). O ganho principal é o **`keyPrefix`** — a versão manual escreve **sem prefixo nenhum**, o que é um problema quando o Redis é compartilhado com filas ou cache. Também traz manutenção e suporte a cluster/sentinel.

**Versões precisam casar.** O peer dep é `@better-auth/core: ^1.6.23` — pode exigir bump da lib. Suba `better-auth` **e todos os `@better-auth/*`** juntos, **no servidor e no client**.

### ⚠️ Ordem importa

O `keyPrefix` **renomeia as chaves**, tornando as antigas inalcançáveis.

- **Se sessões ainda vivem no Redis** (§5 não aplicado) → **logout em massa**.
- **Se §5 já está em produção** → seguro: sobra só rate limit no Redis, com TTL curto.

**Faça o §5 primeiro.** As chaves antigas ficam órfãs até o TTL expirar; inofensivo.

---

## 11. Ordem de deploy e portões de logout em massa

```
1. §2  middleware otimista        ─┐
2. §3  SessionResult discriminado  ├─ um deploy, sem custo. QUEBRA O LOOP.
3. §4  rota de recuperação        ─┘
        ↓ confirmar em produção antes de seguir
4. §5  storeSessionInDatabase      ── ⚠️ DESLOGA TODOS
   +   verification.storeInDatabase
   +   rotação de BETTER_AUTH_SECRET (se houver) ── também desloga: junte
        ↓
5. §7  cookieCache      ─┐
6. §8  origins           ├─ sem custo, qualquer ordem
7. §9  rateLimit storage │
8. §10 redis-storage    ─┘  (depende do §5)
```

**O portão que importa:** `storeSessionInDatabase` invalida todas as sessões Redis-only no deploy. Se os §2–§4 **não** estiverem em produção antes, esse logout em massa cai no fluxo quebrado e joga **todos os usuários ativos no loop de uma vez**.

**Agrupe tudo que desloga** num único deploy: `storeSessionInDatabase` + rotação de secret. Paga-se o custo uma vez.

---

## 12. Como verificar de verdade

Testes que **discriminam** — cada um destes pegou algo real:

### Loop, sem depender do banco

Suba um stub HTTP na porta da API respondendo **401** em `/api/auth/get-session`. Reproduz "cookie presente + sessão inválida" com fidelidade e sem infra:

```js
createServer((req, res) => {
  if (req.url.startsWith('/api/auth/get-session')) {
    res.writeHead(401, { 'content-type': 'application/json' })
    return res.end('{"message":"Unauthorized"}')
  }
  res.writeHead(404); res.end()
}).listen(3333)
```

```bash
# /sign-in com cookie stale → DEVE renderizar (200), não redirecionar
curl -s -o /dev/null -D - -H "Cookie: better-auth.session_token=stale" \
  http://localhost:3000/sign-in | grep -iE "^HTTP/|^location:"

# Cadeia de recuperação → 1 hop, jar limpo, form renderiza
J=$(mktemp); printf "localhost\tFALSE\t/\tFALSE\t0\tbetter-auth.session_token\tstale\n" > "$J"
curl -s -L -b "$J" -c "$J" -o /dev/null \
  -w "hops=%{num_redirects} final=%{url_effective}\n" \
  http://localhost:3000/api/clear-session
grep -c session_token "$J"   # → 0
```

### `error` não desloga

Com sessão **válida**, derrube a API e acesse uma rota protegida. **Esperado:** estado de erro, **nenhum `Set-Cookie`**, sessão preservada. É o comportamento que o §3 existe para criar — e o que regride em silêncio se nada o fixar.

### Origins

```bash
# Preflight CORS na API. Legítima → tem ACAO. Forjada → NÃO tem.
curl -s -o /dev/null -D - -X OPTIONS "$API/api/auth/sign-in/email" \
  -H "Origin: https://evil.<seu-painel>.host" \
  -H "Access-Control-Request-Method: POST" | grep -i "access-control-allow-origin"
# (vazio) → negada ✅
```

### Durabilidade

```sql
SELECT count(*) FROM session;      -- logado → ≥ 1 (era 0 antes do §5)
SELECT count(*) FROM verification; -- após reset de senha real → ≥ 1
```

### `cookieCache`

DevTools → Application → Cookies → `__Secure-better-auth.session_data` presente ao lado do `session_token`.

---

## 13. Sinais falsos — onde eu perdi tempo

Estas quatro custaram caro. Se você replicar o playbook, replique também os avisos.

**1. Status code em rota com layout assíncrono não significa nada.**
`/dashboard` responde **200 mesmo quando redireciona**: o Next manda o shell (`loading.tsx`) e entrega o redirect **dentro do stream RSC**. `curl -L` não segue. Para conferir, procure o destino no corpo:
```bash
curl -s ... /dashboard | grep -o "clear-session"
```
Quase me levou a "o redirect não está acontecendo" quando estava.

**2. `POST /sign-in/email` com `Origin` forjada não testa origem.**
Esperei 403 e levei **401 nos dois casos** (legítima e forjada). O curl não tem `Sec-Fetch-Site`, então a checagem de CSRF do Better Auth nem dispara. O teste não discriminava nada e teria produzido um "funciona" vazio. **O teste certo é o preflight de CORS** — é isso que o `isAllowedOrigin` controla.

**3. `verification` vazia não prova nada.**
Diferente de `session` (onde uma sessão ativa **obrigatoriamente** tem linha), verification records são efêmeros. 0 é igualmente consistente com "nenhum em voo". Prove disparando um reset real.

**4. Contar matches num output que você não leu.**
Afirmei "lint limpo" duas vezes baseado num `grep -c` que retornava zero — o comando estava **quebrado** (faltava config de eslint) e eu contava zero matches numa mensagem de erro. Ausência de match ≠ ausência de problema. **Leia a saída.**

---

## 14. Defaults do Better Auth que mordem

| Opção | Default | Por que importa |
|---|---|---|
| `session.storeSessionInDatabase` | `false` | Com `secondaryStorage`, sessões vão **só** pra lá |
| `verification.storeInDatabase` | `false` | Idem para verification records |
| `session.cookieCache.enabled` | `false` | Sem ele, `get-session` a cada hard load |
| `rateLimit.storage` | `"memory"` | Não persiste entre réplicas/restarts |
| `rateLimit.enabled` | `true` em prod, `false` em dev | Bugs de rate limit **só aparecem em produção** |
| `advanced.useSecureCookies` | `NODE_ENV === 'production'` | Muda o **nome** do cookie (`__Secure-`) |
| `session.expiresIn` | 7 dias | |
| `session.freshAge` | 1 dia | Endpoints sensíveis exigem sessão "fresca" |

---

## 15. Referências

- [Session Management](https://better-auth.com/docs/concepts/session-management) — `storeSessionInDatabase`, `cookieCache`, secondary storage
- [Options Reference](https://better-auth.com/docs/reference/options) — `secondaryStorage`, `verification`, `rateLimit`
- [Secondary Storage](https://better-auth.com/docs/concepts/database#secondary-storage)
- MCP `better-auth` (`search_docs` / `get_doc`) — mais confiável que memória de treino; a doc muda

---

> Criado em 2026-07-14 11:32 (-03) · Última modificação: 2026-07-14 11:32 (-03)

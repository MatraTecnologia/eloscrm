# Correções: colisão do seed e botão de remover comentário

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Fechar os dois defeitos que sobraram do Leads 360 — `pnpm db:seed` que quebra na segunda
execução em banco sem membros, e o gestor que não consegue remover comentário alheio pela tela apesar de
a API permitir.

**Architecture:** Dois bugs independentes, um em cada projeto, sem dependência entre si. No seed, a criação
da organização de demonstração passa a ser idempotente. No web, o mural de comentários deixa de decidir a
visibilidade do botão só pela autoria e passa a considerar também o papel de quem está olhando — usando o
diretório de membros que já existe desde a fase A.

**Tech Stack:** Prisma 7 + Vitest 4 contra Postgres real (API), Next 16 + TanStack Query + shadcn/ui (web).

Contexto: os dois foram achados pelos reviews finais das fases
[B](./2026-07-29-leads-360-b-cadastro-comentarios.md) e [C](./2026-07-29-leads-360-c-anexos-timeline.md),
e ficaram registrados como follow-up em vez de entrar naquelas branches.

## Global Constraints

- **Nenhuma query de domínio sem `organizationId`** (não se aplica ao seed, que resolve a organização).
- **Import do Prisma** sempre por caminho relativo a `src/generated/prisma`; `@prisma/client` é proibido
  por lint.
- **`console.log` é permitido em `prisma/`** (exceção do oxlint), proibido no resto.
- **`const` arrow functions**, nunca `function`. Identificadores em inglês, strings de UI em pt-BR.
- **Nunca emoji na UI** — ícones Lucide.
- **A autorização de verdade é da API.** O que a UI faz é decidir o que mostrar; não há regra de negócio
  duplicada, e o `catch` do delete continua necessário.
- **Testes contra Postgres real, sem mocks.** Os arquivos rodam em paralelo e cada um cria a própria
  organização — teste novo não pode depender de estado global do banco.
- **Commits em português, no imperativo.**

---

### Task 1: Seed idempotente em banco sem membros

Hoje `resolveOrg` (em `prisma/seed.ts`) faz `prisma.organization.create` com o slug fixo `imob-demo`
quando não encontra organização com membro. Como a organização criada **não** ganha membro, a execução
seguinte também não encontra nenhuma com membro, tenta criar de novo e estoura na constraint de slug
único. Resultado: em banco de dev sem usuários, `pnpm db:seed` funciona uma vez e quebra para sempre
depois.

**Files:**
- Create: `eloscrm-api/prisma/seed-org.ts`
- Modify: `eloscrm-api/prisma/seed.ts`
- Test: `eloscrm-api/test/seed-org.test.ts`

**Interfaces:**
- Consumes: `prisma` de `src/lib/prisma.js`.
- Produces: `ensureDemoOrg(slug?: string)` — devolve a organização de demonstração, criando só se ela
  ainda não existir. Default do slug: `"imob-demo"`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `eloscrm-api/test/seed-org.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { ensureDemoOrg } from "../prisma/seed-org.js";
import { prisma } from "../src/lib/prisma.js";

// slug próprio por execução: os arquivos de teste rodam em paralelo e o slug é único no banco
const slug = `demo-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug } });
  await prisma.$disconnect();
});

describe("ensureDemoOrg", () => {
  it("cria a organização de demonstração na primeira chamada", async () => {
    const org = await ensureDemoOrg(slug);
    expect(org.slug).toBe(slug);
    expect(org.name).toBe("Imobiliária Demo");
  });

  it("devolve a mesma organização na segunda chamada, sem estourar o slug único", async () => {
    const first = await ensureDemoOrg(slug);
    const second = await ensureDemoOrg(slug);
    expect(second.id).toBe(first.id);

    const rows = await prisma.organization.findMany({ where: { slug } });
    expect(rows).toHaveLength(1);
  });
});
```

> Este é o único teste do projeto que limpa o que criou em `afterAll`, e por um motivo específico: ele
> mexe em `organization`, que é a tabela onde todos os outros arquivos criam a própria org. Deixar a
> linha para trás não quebra ninguém, mas suja o banco de teste para inspeção manual.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd eloscrm-api && pnpm vitest run test/seed-org.test.ts`
Expected: FAIL — `Cannot find module '../prisma/seed-org.js'`.

- [ ] **Step 3: Criar o módulo**

`eloscrm-api/prisma/seed-org.ts`:

```ts
import { prisma } from "../src/lib/prisma.js";

/**
 * A organização de demonstração nasce sem membro, então a execução seguinte do seed também não acha
 * organização com membro e cai aqui de novo — com `create` isso estourava na constraint de slug único
 * e o seed quebrava para sempre em banco de dev sem usuários.
 */
export const ensureDemoOrg = (slug = "imob-demo") =>
  prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { name: "Imobiliária Demo", slug },
  });
```

- [ ] **Step 4: Usar o módulo no seed**

Em `prisma/seed.ts`, importar:

```ts
import { ensureDemoOrg } from "./seed-org.js";
```

E trocar o corpo do fallback dentro de `resolveOrg`:

```ts
  const org = await ensureDemoOrg();
  return { org, ownerId: null };
```

O bloco `prisma.organization.create` sai. O resto de `resolveOrg` — a busca pela organização que tem
membro — fica como está.

- [ ] **Step 5: Rodar o teste**

Run: `cd eloscrm-api && pnpm vitest run test/seed-org.test.ts`
Expected: PASS — 2 testes.

- [ ] **Step 6: Provar o bug corrigido no banco de dev, sem destruir o que está lá**

O banco de dev tem uma organização com membro (a "Matra", com a conta do dono do repo e 18 leads de
seed), então `resolveOrg` nem chega no caminho da demo. Para exercitar o caminho corrigido sem mexer
nesses dados, rode a função direto duas vezes com um slug de teste e limpe depois:

```bash
cd eloscrm-api && cat > ./demo-check.tmp.ts <<'EOF'
import "dotenv/config";
import { ensureDemoOrg } from "./prisma/seed-org.js";
import { prisma } from "./src/lib/prisma.js";

const slug = "demo-check-tmp";
const a = await ensureDemoOrg(slug);
const b = await ensureDemoOrg(slug);
console.log("mesma org nas duas chamadas:", a.id === b.id);
await prisma.organization.deleteMany({ where: { slug } });
await prisma.$disconnect();
EOF
node_modules/.bin/tsx ./demo-check.tmp.ts; rm -f ./demo-check.tmp.ts
```

Expected: `mesma org nas duas chamadas: true`.

Depois confirme que o seed continua fazendo o que fazia:

Run: `cd eloscrm-api && pnpm db:seed && pnpm db:seed`
Expected: as duas execuções terminam com a linha de contagem apontando para `"Matra" (matra)` — o caminho
da demo não é usado aqui, e nada do banco de dev é perdido.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `cd eloscrm-api && pnpm typecheck && pnpm lint && pnpm test`
Expected: os três limpos.

- [ ] **Step 8: Commit**

```bash
git add eloscrm-api/prisma/seed-org.ts eloscrm-api/prisma/seed.ts eloscrm-api/test/seed-org.test.ts
git commit -m "fix: torna idempotente a criação da organização de demonstração no seed"
```

---

### Task 2: Gestor remove comentário alheio pela tela

A API permite que quem tem papel `owner` ou `admin` remova comentário de outro membro — há teste cobrindo
isso desde a fase B (`test/comments.test.ts`, "dono da imobiliária apaga comentário de outro membro").
Mas o mural mostra os botões de editar e remover só quando `comment.authorId === session?.user.id`, então
o gestor nunca alcança o botão. A capacidade existe e é invisível.

O ajuste é só de visibilidade: **editar continua exclusivo do autor** (gestor apaga o que não presta, mas
não reescreve fala de ninguém — a API recusa e a UI não deve oferecer), e **remover passa a aparecer
também para gestor**.

**Files:**
- Modify: `eloscrm-web/app/(app)/clients/[id]/comment-feed.tsx`

**Interfaces:**
- Consumes: `useMembers()` de `lib/queries/members.ts` (devolve `{ userId, name, email, role }[]`),
  `useSession()` de `lib/auth-client`.
- Produces: nada novo.

- [ ] **Step 1: Descobrir o papel de quem está olhando**

Em `comment-feed.tsx`, ao lado dos outros hooks no topo do componente:

```tsx
import { useMembers } from "@/lib/queries/members";
```

```tsx
  const { data: members } = useMembers();
  const myRole = members?.find((member) => member.userId === session?.user.id)?.role ?? null;
  // a API deixa gestor remover comentário de qualquer um; editar segue só do autor
  const canManage = myRole === "owner" || myRole === "admin";
```

- [ ] **Step 2: Separar quem vê editar de quem vê remover**

Hoje um único `&&` governa os dois botões. Troque a condição do bloco pelos dois direitos, mantendo o
`editingId !== comment.id` que já existe para esconder os botões durante a edição:

```tsx
                {(comment.authorId === session?.user.id || canManage) && editingId !== comment.id && (
                  <div className="flex shrink-0 gap-1">
                    {comment.authorId === session?.user.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar comentário"
                        onClick={() => {
                          setEditingId(comment.id);
                          setEditDraft(comment.body);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover comentário"
                      disabled={remove.isPending}
                      onClick={() => del(comment.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
```

A função `del` já existe no arquivo (linha 49) com `try/catch` e toast de erro — **mantenha-a e continue
chamando-a**. Trocá-la por um `remove.mutate` inline deixaria `del` órfã e o `pnpm lint` reprovaria por
variável não usada. A única mudança no botão é o `disabled={remove.isPending}`.

O tratamento de erro dela continua necessário mesmo com a visibilidade correta: quem era gestor pode ter
sido rebaixado depois da última leitura de `/v1/members`, e nesse caso a API recusa — é ela que decide.

- [ ] **Step 3: Verificar**

Run: `cd eloscrm-web && pnpm typecheck && pnpm lint && pnpm build`
Expected: os três limpos.

- [ ] **Step 4: Conferir na tela, com dois usuários**

Esta é a única forma de provar o comportamento, porque depende de dois papéis diferentes olhando o mesmo
comentário. **Peça ao coordenador** para conduzir ou autorizar este passo: ele exige criar um membro
temporário na organização que tem dados, e uma limpeza mal feita numa task anterior desta série apagou a
conta do dono do repo. Não invente usuário nem apague nada por conta própria.

O que precisa ser observado:

1. Com o membro comum (`role = member`): num comentário do gestor, **nenhum** botão aparece; no próprio
   comentário, os dois aparecem.
2. Com o gestor (`role = owner`): no comentário do membro comum, aparece **só** o de remover; no próprio,
   os dois.
3. O gestor remove o comentário do outro e a linha sai da lista.

- [ ] **Step 5: Commit**

```bash
git add "eloscrm-web/app/(app)/clients/[id]/comment-feed.tsx"
git commit -m "fix: mostra remover comentário para gestor da imobiliária"
```

---

## Fechamento

```bash
cd eloscrm-api && pnpm lint && pnpm typecheck && pnpm test
cd ../eloscrm-web && pnpm lint && pnpm typecheck && pnpm build
```

## Fora de escopo (nomeado, não esquecido)

- **Papel na sessão.** Descobrir o papel via `/v1/members` custa uma request e fica velho até a próxima
  leitura. O lugar certo seria a sessão (`activeOrganizationRole` do Better Auth), mas isso mexe no
  contrato de auth das três fases e merece decisão própria.
- **Mesma checagem em outras telas.** Nada mais no app hoje esconde ação por papel; quando aparecer o
  segundo caso, `canManage` deve virar um hook (`useCanManage()`) em vez de ser copiado.
- **Faxina de anexo `PENDING`** e **resíduo no bucket de teste** — follow-ups da fase C, sem relação com
  estes dois.

> Criado em 2026-07-29 23:32 (-03) · Última modificação: 2026-07-29 23:32 (-03)

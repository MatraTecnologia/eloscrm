# eloscrm-web

Frontend do elosCRM, CRM multi-tenant para imobiliárias. Usa Next.js 16 (App Router), React 19,
TanStack Query e shadcn/ui, com Inter como fonte global.

A API Fastify em `../eloscrm-api/` é um projeto independente e precisa estar em execução para auth
e dados do CRM. A sessão usa cookies; a origem do web deve corresponder a `WEB_ORIGIN` na API.

## Desenvolvimento local

Pré-requisitos: Node.js 24+, pnpm 11.25.0 e Postgres local com os bancos `eloscrm_dev` e
`eloscrm_test`. O compose da raiz oferece Postgres e Redis. Uploads e testes de storage exigem S3
compatível, configurado pelas envs `R2_*` da API; o compose não inclui esse serviço.

Com os serviços preparados, rode na raiz do repositório:

```bash
./scripts/setup.sh
./scripts/dev.sh
```

O setup copia os exemplos de env, gera o segredo de auth, instala dependências nos dois projetos,
gera o client do Prisma e aplica os schemas de dev e teste. O segundo comando sobe API na porta
3333 e web na 3000. Abra `http://localhost:3000`.

Para preparar só o frontend, rode em `eloscrm-web/`:

```bash
cp .env.example .env
pnpm install
pnpm dev
```

A única env do frontend é `NEXT_PUBLIC_API_URL`: a raiz da API, sem `/v1` nem `/api/auth`.
O valor padrão é `http://localhost:3333`. O client de domínio acrescenta `/v1`; o Better Auth usa
`/api/auth/*` na API.

O cadastro exige confirmação de e-mail. Sem `RESEND_API_KEY`, a API exibe o link no stdout em
desenvolvimento; em produção, o provedor deve estar configurado para enviar os e-mails.

## Comandos

Execute em `eloscrm-web/`:

```bash
pnpm dev        # servidor de desenvolvimento
pnpm lint       # ESLint
pnpm typecheck  # TypeScript sem emitir arquivos
pnpm build      # build de produção
pnpm start      # servidor de produção após o build
```

O frontend não tem suíte de testes. A CI executa lint, typecheck e build.

## Deploy

O Dockerfile usa `eloscrm-web/` como contexto de build e executa o servidor gerado pelo
`output: "standalone"`. Informe `NEXT_PUBLIC_API_URL` como build arg: o valor entra no bundle durante
`pnpm build`, e uma troca de URL exige rebuild.

A API tem imagem e deploy separados. As instruções de aplicação de schema antes do deploy ficam
no [guia da raiz](../AGENTS.md#deploy-aplicar-o-schema-é-passo-manual).

## Referências

- [Visão geral, serviços locais e CI](../AGENTS.md)
- [Arquitetura e convenções do frontend](./AGENTS.md)
- [Arquitetura e convenções da API](../eloscrm-api/AGENTS.md)

> Criado em 2026-09-30 14:32 (-03) · Última modificação: 2026-09-30 14:44 (-03)

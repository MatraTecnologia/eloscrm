# Contexto de build = eloscrm-api/ (no Easypanel: Build Path = /eloscrm-api).
# Prisma 7 rust-free: o query compiler vem em WASM dentro de @prisma/client,
# não há engine nativo — por isso alpine basta, sem openssl/glibc extra.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

# ---- deps: árvore completa (precisa de tsc e do CLI do prisma) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: gera o client do prisma e compila para dist/ ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# src/generated não é versionado e todo o código importa dele.
# prisma.config.ts exige DATABASE_URL só para carregar; `generate` não conecta,
# então um valor de fachada resolve — o real vem do ambiente em runtime.
RUN DATABASE_URL="postgres://build:build@localhost:5432/build" pnpm db:generate \
  && pnpm build

# ---- prod-deps: só runtime ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --no-optional corta ~250MB de peers opcionais que o pnpm arrasta junto do CLI do
# prisma (studio, pglite, esbuild, typescript) e que nada importa em runtime
RUN pnpm install --frozen-lockfile --prod --no-optional

# ---- runner ----
FROM node:22-alpine AS runner
RUN apk add --no-cache tini
ENV NODE_ENV=production
ENV PORT=3333
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY package.json ./
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/server.js"]

# Contexto de build = eloscrm-api/ (no Easypanel: Build Path = /eloscrm-api).
# Prisma 7 rust-free: o query compiler vem em WASM dentro de @prisma/client,
# não há engine nativo — nenhuma imagem precisa de openssl/glibc extra por causa dele.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
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
FROM node:24-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3333
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY package.json ./
USER node
EXPOSE 3333
# a imagem slim não traz wget nem curl; o fetch global do Node 24 resolve sem instalar nada
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/server.js"]

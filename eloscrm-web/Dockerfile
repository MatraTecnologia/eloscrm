# Contexto de build = eloscrm-web/ (no Easypanel: Build Path = /eloscrm-web).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps
# pnpm-workspace.yaml carrega o allowBuilds de sharp/unrs-resolver; sem ele o pnpm 11
# pula os scripts de build desses pacotes e o next/image fica sem o sharp
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* é embutido no bundle do browser durante o next build, não lido em runtime:
# precisa ser build arg. Trocar a URL da API depois exige rebuild, não restart.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runner ----
FROM node:24-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# o server.js do standalone só escuta fora do container com HOSTNAME explícito
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# o standalone não leva public nem .next/static junto — sem estas duas cópias a página
# responde 200 e todo asset dá 404
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# next/image grava os derivados otimizados aqui em runtime
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
EXPOSE 3000
# a imagem slim não traz wget nem curl; o fetch global do Node 24 resolve sem instalar nada
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

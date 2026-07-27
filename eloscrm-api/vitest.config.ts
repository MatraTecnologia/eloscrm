import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["test/setup.ts"],
    // Sign-up do Better Auth roda bcrypt em processo; sob paralelismo de arquivos o custo de CPU
    // e a contenção no Postgres remoto estouram os timeouts default (5s/10s). Folga generosa.
    testTimeout: 30000,
    hookTimeout: 30000,
    // @fastify/autoload importa as rotas via import() nativo; sem inline, o resolver do Node
    // não mapeia o sufixo .js (NodeNext) para os arquivos .ts das rotas sob o Vitest.
    server: { deps: { inline: [/@fastify[\\/]autoload/] } },
  },
});

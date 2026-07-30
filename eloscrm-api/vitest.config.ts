import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // dist/ pode conter os testes compilados de um build anterior; sem excluir, o Vitest coleta os
    // mesmos testes duas vezes e a segunda rodada corre contra JavaScript velho.
    exclude: ["**/node_modules/**", "dist/**"],
    // globalSetup trunca o banco de teste antes da run; setupFiles carrega o .env.test em cada worker.
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    // Sign-up do Better Auth roda bcrypt em processo; com Postgres local a suíte inteira leva poucos
    // segundos, mas o custo de CPU do bcrypt ainda estoura os defaults (5s/10s) em runner de CI.
    testTimeout: 15000,
    hookTimeout: 15000,
    // @fastify/autoload importa as rotas via import() nativo; sem inline, o resolver do Node
    // não mapeia o sufixo .js (NodeNext) para os arquivos .ts das rotas sob o Vitest.
    server: { deps: { inline: [/@fastify[\\/]autoload/] } },
  },
});

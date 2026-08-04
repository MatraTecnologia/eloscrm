import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/**
 * O preflight do navegador é o único ponto da API que a suíte não exercita sozinha: `app.inject`
 * fala direto com o Fastify e nunca faz CORS. Foi assim que um `PUT` novo passou por 346 testes
 * verdes e quebrou na tela — o método não estava na lista de `plugins/cors.ts`.
 */
const preflight = (method: string) =>
  app.inject({
    method: "OPTIONS",
    url: "/v1/lead-automation",
    headers: {
      origin: env.WEB_ORIGIN,
      "access-control-request-method": method,
    },
  });

describe("CORS", () => {
  // todos os verbos que as rotas de fato usam; método novo sem entrada aqui falha no navegador
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])("libera %s para o front", async (method) => {
    const res = await preflight(method);
    expect(res.headers["access-control-allow-methods"]).toContain(method);
  });

  it("responde ao preflight com a origem do front e credenciais", async () => {
    const res = await preflight("PUT");
    expect(res.headers["access-control-allow-origin"]).toBe(env.WEB_ORIGIN);
    // sem isto o cookie de sessão não viaja e o login "não funciona" sem erro visível
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("origem estranha recebe o WEB_ORIGIN de volta, e é o navegador que barra", async () => {
    const estranha = "https://nao-e-o-front.example";
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/lead-automation",
      headers: { origin: estranha, "access-control-request-method": "GET" },
    });

    // com `origin` sendo uma string fixa, o @fastify/cors devolve sempre ela — não ecoa quem pediu.
    // A proteção está aí: o navegador compara o header com a própria origem, não bate, e bloqueia.
    expect(res.headers["access-control-allow-origin"]).toBe(env.WEB_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).not.toBe(estranha);
  });
});

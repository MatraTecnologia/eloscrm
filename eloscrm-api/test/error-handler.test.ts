import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildApp } from "../src/app.js";

// rotas registradas só neste teste, antes do ready(), para exercitar o errorHandler de verdade
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  app.get("/test/zod-error", async () => {
    z.object({ email: z.string().email() }).parse({ email: "invalido" });
  });
  app.get("/test/boom", async () => {
    throw new Error("detalhe secreto do banco");
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("errorHandler", () => {
  it("ZodError vira 422 com envelope de validação", async () => {
    const res = await app.inject({ method: "GET", url: "/test/zod-error" });
    const body = res.json();
    expect(res.statusCode).toBe(422);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.details).toBeDefined();
  });

  it("erro inesperado vira 500 genérico sem vazar detalhe interno", async () => {
    const res = await app.inject({ method: "GET", url: "/test/boom" });
    const body = res.json();
    expect(res.statusCode).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("Erro interno");
    expect(JSON.stringify(body)).not.toContain("detalhe secreto do banco");
  });
});

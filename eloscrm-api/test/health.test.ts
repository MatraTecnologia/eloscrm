import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe("health", () => {
  it("GET /health responde ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    // os contadores existem para os dois caminhos que engolem a própria falha (auditoria de
    // identidade e purga de organização); num app saudável ficam em zero
    expect(res.json()).toEqual({ status: "ok", auditFailures: 0, orgPurgeFailures: 0 });
  });
});

import { describe, it, expect } from "vitest";

describe("env", () => {
  it("carrega e valida variáveis obrigatórias", async () => {
    const { env } = await import("../src/env.js");
    expect(env.DATABASE_URL).toBeTruthy();
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThan(10);
    expect(env.PORT).toBe(3333);
  });
});

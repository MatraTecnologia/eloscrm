import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// roda antes dos imports: o env é lido uma vez, quando o módulo carrega
vi.hoisted(() => { process.env.UAZAPI_BROADCASTS_ENABLED = "false"; });

import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { env } from "../src/env.js";

let app: FastifyInstance;
let cookie = "";
let pipelineId = "";
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const headers = () => ({ cookie, origin: env.WEB_ORIGIN });

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `bc-off-${stamp}@eloscrm.test`, `bc-off-${stamp}`));
  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: headers() });
  pipelineId = (pipelines.json() as { id: string }[])[0].id;
});

afterAll(async () => {
  await app.close();
});

describe("disparo pela uazapi desativado", () => {
  it("recusa criar disparo", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/broadcasts", headers: headers(), payload: { pipelineId, dealIds: ["deal-x"], text: "Olá" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("BROADCAST_DISABLED");
  });

  it("recusa retomar disparo, mas não bloqueia pausar", async () => {
    const resume = await app.inject({ method: "POST", url: "/v1/broadcasts/inexistente/resume", headers: headers(), payload: {} });
    expect(resume.statusCode).toBe(409);
    expect(resume.json().error.code).toBe("BROADCAST_DISABLED");

    const pause = await app.inject({ method: "POST", url: "/v1/broadcasts/inexistente/pause", headers: headers(), payload: {} });
    expect(pause.statusCode).toBe(404);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";

type Stage = { id: string; isWon: boolean; isLost: boolean };
type Pipeline = { id: string; stages: Stage[] };
type ListedClient = { id: string; dealCount?: number; openDealCount?: number };

const defaultPipeline = async (headers: { cookie: string }) => {
  const res = await app.inject({ method: "GET", url: "/v1/pipelines", headers });
  return (res.json() as Pipeline[])[0];
};

const createClient = async (headers: { cookie: string }, name: string) => {
  const res = await app.inject({ method: "POST", url: "/v1/clients", headers, payload: { name } });
  return res.json() as { id: string };
};

const createDeal = async (headers: { cookie: string }, clientId: string, pipelineId: string, stageId: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/deals",
    headers,
    payload: { clientId, pipelineId, stageId, title: "Negócio" },
  });
  expect(res.statusCode).toBe(201);
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `stats-a-${stamp}@eloscrm.test`, `stats-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `stats-b-${stamp}@eloscrm.test`, `stats-b-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/clients?withStats=true", () => {
  it("conta negócios totais e abertos por lead, sem misturar organizações", async () => {
    const pipeline = await defaultPipeline({ cookie });
    const open = pipeline.stages.find((stage) => !stage.isWon && !stage.isLost)!;
    const won = pipeline.stages.find((stage) => stage.isWon)!;
    const withDeals = await createClient({ cookie }, "Com negócios");
    const withoutDeals = await createClient({ cookie }, "Sem negócios");
    await createDeal({ cookie }, withDeals.id, pipeline.id, open.id);
    await createDeal({ cookie }, withDeals.id, pipeline.id, won.id);

    // negócio de outra org não pode vazar para a contagem
    const pipelineB = await defaultPipeline({ cookie: cookieB });
    const clientB = await createClient({ cookie: cookieB }, "Outra org");
    await createDeal({ cookie: cookieB }, clientB.id, pipelineB.id, pipelineB.stages[0].id);

    const res = await app.inject({ method: "GET", url: "/v1/clients?withStats=true", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const list = res.json() as ListedClient[];
    expect(list.find((c) => c.id === withDeals.id)).toMatchObject({ dealCount: 2, openDealCount: 1 });
    expect(list.find((c) => c.id === withoutDeals.id)).toMatchObject({ dealCount: 0, openDealCount: 0 });
    expect(list.some((c) => c.id === clientB.id)).toBe(false);
  });

  it("sem o flag, a listagem não traz as contagens", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/clients", headers: { cookie } });
    const list = res.json() as ListedClient[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.dealCount === undefined)).toBe(true);
  });
});

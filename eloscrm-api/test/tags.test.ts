import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";
let pipelineId = "";
let stageId = "";
let clientId = "";

type Tag = { id: string; name: string; color: string };
type Deal = { id: string; tags: Tag[] };

const createTag = async (headers: { cookie: string }, name: string, color = "#2563EB") => {
  const res = await app.inject({ method: "POST", url: "/v1/tags", headers, payload: { name, color } });
  expect(res.statusCode).toBe(201);
  return res.json() as Tag;
};

const createDeal = (headers: { cookie: string }, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/deals",
    headers,
    payload: { clientId, title: `Negócio ${stamp}`, pipelineId, stageId, ...extra },
  });

const patchDeal = (id: string, payload: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/v1/deals/${id}`, headers: { cookie }, payload });

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `tags-a-${stamp}@eloscrm.test`, `tags-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `tags-b-${stamp}@eloscrm.test`, `tags-b-${stamp}`));

  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const pipeline = (pipelines.json() as { id: string; stages: { id: string }[] }[])[0];
  pipelineId = pipeline.id;
  stageId = pipeline.stages[0].id;

  const client = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: `Lead ${stamp}` },
  });
  clientId = (client.json() as { id: string }).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("tags", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tags" });
    expect(res.statusCode).toBe(401);
  });

  it("recusa cor fora do formato hex (422)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tags",
      headers: { cookie },
      payload: { name: "Quente", color: "vermelho" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("cria, lista em ordem alfabética e normaliza a cor", async () => {
    await createTag({ cookie }, "Zebra");
    const tag = await createTag({ cookie }, "Alfa", "#7C3AED");
    expect(tag.color).toBe("#7c3aed");

    const res = await app.inject({ method: "GET", url: "/v1/tags", headers: { cookie } });
    const names = (res.json() as Tag[]).map((t) => t.name);
    expect(names.indexOf("Alfa")).toBeLessThan(names.indexOf("Zebra"));
  });

  it("recusa nome repetido na mesma imobiliária (409)", async () => {
    await createTag({ cookie }, "Duplicada");
    const res = await app.inject({
      method: "POST",
      url: "/v1/tags",
      headers: { cookie },
      payload: { name: "Duplicada", color: "#10b981" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TAG_NAME_TAKEN");
  });

  it("o mesmo nome vale em outra imobiliária", async () => {
    await createTag({ cookie }, "Compartilhada");
    await createTag({ cookie: cookieB }, "Compartilhada");
  });

  it("não lista nem edita etiqueta de outra imobiliária", async () => {
    const tag = await createTag({ cookie }, "Privada");

    const list = await app.inject({ method: "GET", url: "/v1/tags", headers: { cookie: cookieB } });
    expect((list.json() as Tag[]).some((t) => t.id === tag.id)).toBe(false);

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/tags/${tag.id}`,
      headers: { cookie: cookieB },
      payload: { name: "Roubada" },
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({ method: "DELETE", url: `/v1/tags/${tag.id}`, headers: { cookie: cookieB } });
    expect(del.statusCode).toBe(404);
  });

  it("renomeia e recolore", async () => {
    const tag = await createTag({ cookie }, "Antiga");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/tags/${tag.id}`,
      headers: { cookie },
      payload: { name: "Nova", color: "#F59E0B" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Nova", color: "#f59e0b" });
  });
});

describe("deals com etiquetas", () => {
  it("cria o negócio já etiquetado e devolve as etiquetas na leitura", async () => {
    const a = await createTag({ cookie }, `Deal-A-${stamp}`);
    const b = await createTag({ cookie }, `Deal-B-${stamp}`);

    const created = await createDeal({ cookie }, { tagIds: [a.id, b.id, a.id] });
    expect(created.statusCode).toBe(201);
    const deal = created.json() as Deal;
    expect(deal.tags.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

    const list = await app.inject({
      method: "GET",
      url: `/v1/deals?pipelineId=${pipelineId}`,
      headers: { cookie },
    });
    const found = (list.json() as Deal[]).find((d) => d.id === deal.id);
    expect(found?.tags).toHaveLength(2);
    expect(found?.tags[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      color: expect.any(String),
    });
  });

  it("PATCH com tagIds substitui a lista inteira, [] limpa e omitir não mexe", async () => {
    const a = await createTag({ cookie }, `Patch-A-${stamp}`);
    const b = await createTag({ cookie }, `Patch-B-${stamp}`);
    const deal = (await createDeal({ cookie }, { tagIds: [a.id] })).json() as Deal;

    const swap = await patchDeal(deal.id, { tagIds: [b.id] });
    expect(swap.statusCode).toBe(200);
    expect((swap.json() as Deal).tags.map((t) => t.id)).toEqual([b.id]);

    const clear = await patchDeal(deal.id, { tagIds: [] });
    expect((clear.json() as Deal).tags).toEqual([]);

    await patchDeal(deal.id, { tagIds: [a.id] });
    const untouched = await patchDeal(deal.id, { title: "Só o título" });
    expect((untouched.json() as Deal).tags.map((t) => t.id)).toEqual([a.id]);
  });

  it("recusa etiqueta de outra imobiliária (404)", async () => {
    const mine = await createTag({ cookie }, `Minha-${stamp}`);
    const theirs = await createTag({ cookie: cookieB }, `Deles-${stamp}`);

    const res = await createDeal({ cookie }, { tagIds: [mine.id, theirs.id] });
    expect(res.statusCode).toBe(404);
  });

  it("grava a mudança de etiquetas no histórico pelo nome", async () => {
    const a = await createTag({ cookie }, `Hist-A-${stamp}`);
    const deal = (await createDeal({ cookie })).json() as Deal;
    await patchDeal(deal.id, { tagIds: [a.id] });

    const event = await prisma.auditEvent.findFirst({
      where: { entityType: "DEAL", entityId: deal.id, action: "UPDATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(event?.changes).toMatchObject({ tags: { from: [], to: [`Hist-A-${stamp}`] } });
  });

  it("filtra a listagem por tagId", async () => {
    const tag = await createTag({ cookie }, `Filtro-${stamp}`);
    const marcado = (await createDeal({ cookie }, { tagIds: [tag.id] })).json() as Deal;
    const semTag = (await createDeal({ cookie })).json() as Deal;

    const res = await app.inject({ method: "GET", url: `/v1/deals?tagId=${tag.id}`, headers: { cookie } });
    const ids = (res.json() as Deal[]).map((d) => d.id);
    expect(ids).toContain(marcado.id);
    expect(ids).not.toContain(semTag.id);
  });

  it("apagar a etiqueta só a tira do negócio", async () => {
    const tag = await createTag({ cookie }, `Apagar-${stamp}`);
    const deal = (await createDeal({ cookie }, { tagIds: [tag.id] })).json() as Deal;

    const del = await app.inject({ method: "DELETE", url: `/v1/tags/${tag.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);

    const res = await app.inject({ method: "GET", url: `/v1/deals/${deal.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Deal).tags).toEqual([]);
  });
});

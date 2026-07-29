import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { asCookie, signUpWithOrg, signUp } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let cookieOutro = "";
let cookieOrgB = "";
let clientId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `com-a-${stamp}@eloscrm.test`, `com-a-${stamp}`));
  ({ cookie: cookieOrgB } = await signUpWithOrg(app, `com-b-${stamp}@eloscrm.test`, `com-b-${stamp}`));

  // segundo membro da MESMA organização, para provar a regra de autoria
  cookieOutro = await signUp(app, `com-c-${stamp}@eloscrm.test`);
  const outro = await prisma.user.findFirst({ where: { email: `com-c-${stamp}@eloscrm.test` } });
  await prisma.member.create({ data: { organizationId: orgId, userId: outro!.id, role: "member" } });
  // set-active pelo endpoint, não por UPDATE na tabela: o cookieCache guarda a sessão por 60s no
  // cookie, e mexer só no banco deixaria o guard lendo activeOrganizationId nulo do cache
  const ativou = await app.inject({
    method: "POST",
    url: "/api/auth/organization/set-active",
    headers: { cookie: cookieOutro },
    payload: { organizationId: orgId },
  });
  cookieOutro = ativou.headers["set-cookie"] ? asCookie(ativou.headers["set-cookie"]) : cookieOutro;

  const created = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Lead comentado" },
  });
  clientId = created.json().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const post = (c: string, body: string) =>
  app.inject({
    method: "POST",
    url: "/v1/comments",
    headers: { cookie: c },
    payload: { entityType: "CLIENT", entityId: clientId, body },
  });

describe("comentários", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/comments?entityType=CLIENT&entityId=x" });
    expect(res.statusCode).toBe(401);
  });

  it("recusa corpo vazio (422)", async () => {
    const res = await post(cookie, "   ");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("cria e lista com autor e data, mais recente primeiro", async () => {
    await post(cookie, "Primeiro contato feito.");
    await post(cookie, "Cliente pediu retorno na quinta.");

    const res = await app.inject({
      method: "GET",
      url: `/v1/comments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const comments = res.json();
    expect(comments[0].body).toBe("Cliente pediu retorno na quinta.");
    expect(comments[0].authorName).toBe("Corretor Teste");
    expect(comments[0].editedAt).toBeNull();
  });

  it("só o autor edita, e a edição marca editedAt", async () => {
    const created = await post(cookie, "Texto original");
    const id = created.json().id;

    const alheio = await app.inject({
      method: "PATCH",
      url: `/v1/comments/${id}`,
      headers: { cookie: cookieOutro },
      payload: { body: "Editado por outro" },
    });
    expect(alheio.statusCode).toBe(403);
    expect(alheio.json().error.code).toBe("FORBIDDEN");

    const proprio = await app.inject({
      method: "PATCH",
      url: `/v1/comments/${id}`,
      headers: { cookie },
      payload: { body: "Texto corrigido" },
    });
    expect(proprio.statusCode).toBe(200);
    expect(proprio.json().body).toBe("Texto corrigido");
    expect(proprio.json().editedAt).not.toBeNull();
  });

  it("dono da imobiliária apaga comentário de outro membro", async () => {
    const doOutro = await post(cookieOutro, "Comentário do colega");
    const id = doOutro.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/comments/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it("membro comum não apaga comentário alheio", async () => {
    const meu = await post(cookie, "Comentário do dono");
    const id = meu.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/comments/${id}`,
      headers: { cookie: cookieOutro },
    });
    expect(res.statusCode).toBe(403);
  });

  it("não vaza comentário de outra organização", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/comments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie: cookieOrgB },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("PATCH e DELETE de outra organização dão 404, não 403", async () => {
    const created = await post(cookie, "Comentário só da organização A");
    const id = created.json().id;

    // 404 aqui é deliberado: responder 403 confirmaria pra quem não é da org A que o
    // comentário existe. getOwn filtra por organizationId antes de checar autoria — este
    // teste trava essa ordem contra regressão futura.
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/comments/${id}`,
      headers: { cookie: cookieOrgB },
      payload: { body: "Tentativa de editar de fora" },
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/comments/${id}`,
      headers: { cookie: cookieOrgB },
    });
    expect(del.statusCode).toBe(404);
  });
});

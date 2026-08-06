import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUp, signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let cookieB = "";
let cookieCorretor = "";
let corretorId = "";

const DIA_MS = 24 * 60 * 60 * 1000;

const criarEvento = (data: {
  entityType?: AuditEntity;
  entityId?: string;
  entityLabel?: string | null;
  action?: AuditAction;
  actorId?: string | null;
  actorName?: string;
  source?: "USER" | "AUTOMATION" | "WEBHOOK" | "SYSTEM";
  requestId?: string | null;
  diasAtras?: number;
}) =>
  prisma.auditEvent.create({
    data: {
      organizationId: orgId,
      entityType: data.entityType ?? AuditEntity.CLIENT,
      entityId: data.entityId ?? `item-${Math.random().toString(36).slice(2, 8)}`,
      entityLabel: data.entityLabel ?? "Item de teste",
      action: data.action ?? AuditAction.CREATED,
      actorId: data.actorId ?? null,
      actorName: data.actorName ?? "Corretor Teste",
      source: data.source ?? "USER",
      requestId: data.requestId ?? null,
      createdAt: new Date(Date.now() - (data.diasAtras ?? 0) * DIA_MS),
    },
  });

const buscar = (query: string, c = cookie) =>
  app.inject({ method: "GET", url: `/v1/audit-events${query}`, headers: { cookie: c } });

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `busca-${stamp}@eloscrm.test`, `busca-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `busca-b-${stamp}@eloscrm.test`, `busca-b-${stamp}`));

  // um corretor (role member) na MESMA organização: é ele que prova o gate de gestor
  cookieCorretor = await signUp(app, `corretor-${stamp}@eloscrm.test`);
  const corretor = await prisma.user.findUniqueOrThrow({
    where: { email: `corretor-${stamp}@eloscrm.test` },
  });
  corretorId = corretor.id;
  await prisma.member.create({
    data: { organizationId: orgId, userId: corretorId, role: "member" },
  });
  // pela rota, não pelo banco: o cookie de sessão carrega cache assinado, e alterar a linha direto
  // não muda o que o orgGuard lê
  const ativada = await app.inject({
    method: "POST",
    url: "/api/auth/organization/set-active",
    headers: { cookie: cookieCorretor },
    payload: { organizationId: orgId },
  });
  const setCookie = ativada.headers["set-cookie"];
  if (setCookie) cookieCorretor = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie);

  // limpa o que o sign-up gerou (ORGANIZATION/CREATED, MEMBER_ADDED, SIGNED_IN) para as contagens
  // deste arquivo falarem só dos eventos abaixo
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  const orgB = await prisma.member.findFirstOrThrow({
    where: { user: { email: `busca-b-${stamp}@eloscrm.test` } },
    select: { organizationId: true },
  });
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgB.organizationId } });

  await criarEvento({ entityLabel: "Ana Paula Ribeiro", action: AuditAction.CREATED, actorId: "gestor-1", diasAtras: 0 });
  await criarEvento({ entityLabel: "Ana Paula Ribeiro", action: AuditAction.DELETED, actorId: "gestor-1", diasAtras: 1 });
  await criarEvento({ entityType: AuditEntity.DEAL, entityLabel: "Apto 302", action: AuditAction.TRANSFERRED, actorId: "gestor-1", requestId: "lote-1", diasAtras: 2 });
  await criarEvento({ entityType: AuditEntity.DEAL, entityLabel: "Casa Térrea", action: AuditAction.TRANSFERRED, actorId: "gestor-1", requestId: "lote-1", diasAtras: 2 });
  await criarEvento({ entityType: AuditEntity.CONVERSATION, entityLabel: "Fulano", action: AuditAction.ARCHIVED, actorId: "corretor-9", actorName: "Outro Corretor", diasAtras: 10 });
  await criarEvento({ entityType: AuditEntity.CLIENT, entityLabel: "Lead da Automação", action: AuditAction.CREATED, actorId: null, actorName: "Automação", source: "AUTOMATION", diasAtras: 40 });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/audit-events — busca da imobiliária", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit-events" });
    expect(res.statusCode).toBe(401);
  });

  it("recusa a busca global para corretor (403)", async () => {
    const res = await buscar("", cookieCorretor);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("mas o corretor continua vendo o histórico de um item", async () => {
    const [evento] = await prisma.auditEvent.findMany({ where: { organizationId: orgId }, take: 1 });
    const res = await buscar(`?entityType=CLIENT&entityId=${evento.entityId}`, cookieCorretor);
    expect(res.statusCode).toBe(200);
  });

  it("lista tudo da organização, mais recente primeiro", async () => {
    const res = await buscar("");
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items).toHaveLength(6);
    expect(items[0].entityLabel).toBe("Ana Paula Ribeiro");
    expect(items[0].action).toBe("CREATED");
  });

  it("filtra por tipo e por ação, aceitando vários valores", async () => {
    expect((await buscar("?entityType=DEAL")).json().items).toHaveLength(2);
    expect((await buscar("?entityType=DEAL&entityType=CONVERSATION")).json().items).toHaveLength(3);
    expect((await buscar("?action=CREATED,DELETED")).json().items).toHaveLength(3);
  });

  it("filtra por ator, por origem e por requestId", async () => {
    expect((await buscar("?actorId=corretor-9")).json().items).toHaveLength(1);
    expect((await buscar("?source=AUTOMATION")).json().items).toHaveLength(1);
    // o lote inteiro numa consulta: é o que a tela usa em "ver as ações desta mesma operação"
    expect((await buscar("?requestId=lote-1")).json().items).toHaveLength(2);
  });

  it("filtra por período", async () => {
    const ontem = new Date(Date.now() - 1.5 * DIA_MS).toISOString();
    expect((await buscar(`?from=${ontem}`)).json().items).toHaveLength(2);

    const tresDias = new Date(Date.now() - 3 * DIA_MS).toISOString();
    expect((await buscar(`?from=${tresDias}`)).json().items).toHaveLength(4);
  });

  it("recusa período invertido (422)", async () => {
    const hoje = new Date().toISOString();
    const antigo = new Date(Date.now() - 5 * DIA_MS).toISOString();
    const res = await buscar(`?from=${hoje}&to=${antigo}`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("busca por texto casa rótulo, nome do ator e id exato", async () => {
    expect((await buscar("?q=ana paula")).json().items).toHaveLength(2);
    expect((await buscar("?q=Outro Corretor")).json().items).toHaveLength(1);

    const [evento] = await prisma.auditEvent.findMany({ where: { organizationId: orgId }, take: 1 });
    expect((await buscar(`?q=${evento.entityId}`)).json().items).toHaveLength(1);
  });

  it("pagina por cursor sem repetir nem pular", async () => {
    const vistos: string[] = [];
    let cursor: string | undefined;
    for (let pagina = 0; pagina < 3; pagina += 1) {
      const res = await buscar(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      const body = res.json();
      vistos.push(...body.items.map((item: { id: string }) => item.id));
      cursor = body.nextCursor;
    }
    expect(vistos).toHaveLength(6);
    expect(new Set(vistos).size).toBe(6);

    // a terceira página veio cheia, então ainda devolve cursor: o fim se prova pedindo a seguinte
    const ultima = (await buscar(`?limit=2&cursor=${cursor}`)).json();
    expect(ultima.items).toHaveLength(0);
    expect(ultima.nextCursor).toBeUndefined();
  });

  it("não vaza auditoria de outra imobiliária", async () => {
    expect((await buscar("", cookieB)).json().items).toHaveLength(0);
  });
});

describe("GET /v1/audit-events/actors", () => {
  it("lista os atores do log, do mais ativo para o menos", async () => {
    const res = await buscar("/actors".replace("/actors", "/actors"));
    expect(res.statusCode).toBe(200);
    const atores = res.json() as { actorName: string; events: number }[];
    expect(atores[0]).toMatchObject({ actorName: "Corretor Teste", events: 4 });
    // ator que não é usuário (automação) também aparece: é o que separa "ninguém clicou"
    expect(atores.map((a) => a.actorName)).toContain("Automação");
  });

  it("é de gestor (403 para corretor)", async () => {
    const res = await buscar("/actors", cookieCorretor);
    expect(res.statusCode).toBe(403);
  });

  it("`actors` não é lido como filtro de id", async () => {
    // a rota é registrada antes de qualquer curinga; se invertesse, "actors" viraria parâmetro
    expect((await buscar("/actors")).statusCode).toBe(200);
  });
});

describe("GET /v1/audit-events/export", () => {
  it("devolve CSV com cabeçalho e uma linha por evento", async () => {
    const res = await buscar("/export?entityType=DEAL");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("auditoria.csv");

    const linhas = res.body.trim().split("\n");
    expect(linhas[0]).toBe("data;ator;email;origem;tipo;item;item_id;acao;alteracoes;contexto");
    expect(linhas).toHaveLength(3);
    expect(res.body).toContain("Apto 302");
  });

  it("escapa aspas e ponto e vírgula do rótulo", async () => {
    await criarEvento({ entityLabel: 'Lead "Zé"; do Bar', action: AuditAction.UPDATED });
    const res = await buscar("/export?q=Zé");
    // o valor fica numa coluna só, com as aspas internas dobradas
    expect(res.body).toContain('"Lead ""Zé""; do Bar"');
  });

  it("o export entra na própria trilha", async () => {
    await buscar("/export?entityType=CONVERSATION");
    const evento = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, action: AuditAction.EXPORTED },
      orderBy: { createdAt: "desc" },
    });
    expect(evento.entityType).toBe(AuditEntity.ORGANIZATION);
    expect(evento.context).toMatchObject({ rows: 1 });
  });

  it("é de gestor (403 para corretor)", async () => {
    const res = await buscar("/export", cookieCorretor);
    expect(res.statusCode).toBe(403);
  });
});

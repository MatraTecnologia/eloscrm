import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma.js";

// Cobre só a sanidade do filtro `organizationId` no Prisma (o `where` da query) — não exercita
// o enforcement da aplicação (guards/rotas). Esse enforcement é coberto em test/org-guard.test.ts.
describe("sanidade do filtro organizationId no Prisma", () => {
  const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let orgA = "", orgB = "", clientA = "", clientB = "";

  beforeAll(async () => {
    const a = await prisma.organization.create({ data: { name: "Imob A", slug: `imob-a-${stamp}` } });
    const b = await prisma.organization.create({ data: { name: "Imob B", slug: `imob-b-${stamp}` } });
    orgA = a.id; orgB = b.id;
    const ca = await prisma.client.create({ data: { organizationId: orgA, name: "Lead A" } });
    const cb = await prisma.client.create({ data: { organizationId: orgB, name: "Lead B" } });
    clientA = ca.id; clientB = cb.id;
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.$disconnect();
  });

  it("query filtrada por orgA não retorna clientes de orgB", async () => {
    const rows = await prisma.client.findMany({ where: { organizationId: orgA } });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(clientA);
    expect(ids).not.toContain(clientB);
  });

  it("buscar clientB dentro do escopo de orgA retorna null", async () => {
    const found = await prisma.client.findFirst({ where: { id: clientB, organizationId: orgA } });
    expect(found).toBeNull();
  });
});

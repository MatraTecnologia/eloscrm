import { describe, it, expect, afterAll } from "vitest";
import { ensureDemoOrg } from "../prisma/seed-org.js";
import { prisma } from "../src/lib/prisma.js";

// slug próprio por execução: os arquivos de teste rodam em paralelo e o slug é único no banco
const slug = `demo-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug } });
  await prisma.$disconnect();
});

describe("ensureDemoOrg", () => {
  it("cria a organização de demonstração na primeira chamada", async () => {
    const org = await ensureDemoOrg(slug);
    expect(org.slug).toBe(slug);
    expect(org.name).toBe("Imobiliária Demo");
  });

  it("devolve a mesma organização na segunda chamada, sem estourar o slug único", async () => {
    const first = await ensureDemoOrg(slug);
    const second = await ensureDemoOrg(slug);
    expect(second.id).toBe(first.id);

    const rows = await prisma.organization.findMany({ where: { slug } });
    expect(rows).toHaveLength(1);
  });
});

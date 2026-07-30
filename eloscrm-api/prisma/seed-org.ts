import { prisma } from "../src/lib/prisma.js";

/**
 * A organização de demonstração nasce sem membro, então a execução seguinte do seed também não acha
 * organização com membro e cai aqui de novo — com `create` isso estourava na constraint de slug único
 * e o seed quebrava para sempre em banco de dev sem usuários.
 */
export const ensureDemoOrg = (slug = "imob-demo") =>
  prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { name: "Imobiliária Demo", slug },
  });

import { prisma } from "../../lib/prisma.js";

export const listMembers = (orgId: string) =>
  prisma.member.findMany({
    where: { organizationId: orgId },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

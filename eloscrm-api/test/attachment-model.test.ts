import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AttachmentStatus, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `att-model-${stamp}@eloscrm.test`, `att-model-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("modelo Attachment", () => {
  it("nasce PENDING e guarda quem subiu", async () => {
    const attachment = await prisma.attachment.create({
      data: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: "lead-1",
        key: `org/${orgId}/CLIENT/lead-1/abc-contrato.pdf`,
        filename: "contrato.pdf",
        contentType: "application/pdf",
        size: 1024,
        uploadedById: "user-1",
        uploadedByName: "Corretora Ana",
      },
    });

    expect(attachment.status).toBe(AttachmentStatus.PENDING);
    expect(attachment.uploadedByName).toBe("Corretora Ana");
  });

  it("recusa duas linhas com a mesma chave", async () => {
    const key = `org/${orgId}/CLIENT/lead-2/dup.pdf`;
    const data = {
      organizationId: orgId,
      entityType: AuditEntity.CLIENT,
      entityId: "lead-2",
      key,
      filename: "dup.pdf",
      contentType: "application/pdf",
      size: 10,
      uploadedById: "user-1",
      uploadedByName: "Corretora Ana",
    };
    await prisma.attachment.create({ data });
    await expect(prisma.attachment.create({ data })).rejects.toThrow();
  });
});

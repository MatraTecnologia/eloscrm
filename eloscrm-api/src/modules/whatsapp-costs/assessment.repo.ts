import { prisma } from "../../lib/prisma.js";
import { httpError, notFound } from "../../lib/http-error.js";
import { withConnectionLock } from "../whatsapp-official/identity.repo.js";
import { assessMessage } from "./message-cost.repo.js";
import type { Period } from "./costs.schema.js";

// Reapuração explícita: uma tarifa cadastrada depois não altera silenciosamente o histórico.
export const assessPeriod = async (orgId: string, input: Period) => {
  const channel = await prisma.channelConnection.findFirst({ where: { organizationId: orgId, id: input.connectionId, provider: "cloud_api" } });
  if (!channel) throw notFound("Conexão não encontrada");
  const receipts = await prisma.officialDeliveryReceipt.findMany({ where: { organizationId: orgId, connectionId: channel.id, status: { in: ["delivered", "read"] }, occurredAt: { gte: new Date(input.start), lt: new Date(input.end) } }, select: { externalMessageId: true }, take: 5001 });
  if (receipts.length > 5000) throw httpError(422, "COST_ASSESS_LIMIT", "Reduza o período para reapurar até 5 mil receipts");
  let assessed = 0;
  let unmatched = 0;
  for (const externalMessageId of new Set(receipts.map(receipt => receipt.externalMessageId))) {
    await withConnectionLock(channel, async tx => {
      const message = await tx.whatsappMessage.findFirst({ where: { organizationId: orgId, connectionId: channel.id, providerMessageId: externalMessageId, direction: "outbound" } });
      if (!message) { unmatched++; return; }
      const evidence = await tx.officialDeliveryReceipt.findMany({ where: { organizationId: orgId, connectionId: channel.id, externalMessageId }, orderBy: [{ occurredAt: "asc" }, { receivedAt: "asc" }, { id: "asc" }] });
      await assessMessage(tx, channel, message, evidence, true); assessed++;
    });
  }
  return { assessed, unmatched };
};

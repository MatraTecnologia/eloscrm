import * as z from "zod";
import { Prisma, type ChannelConnection, type WhatsappMessageStatus } from "../../generated/prisma/client.js";
import { objectOf, objectsOf, eventHash } from "./webhook.schema.js";
import { eventDate } from "./message-parser.js";
import { withConnectionLock } from "./identity.repo.js";
import { assessMessage } from "../whatsapp-costs/message-cost.repo.js";

const receiptSchema = z.looseObject({
  id: z.string().min(1).max(256), status: z.enum(["sent", "delivered", "read", "failed"]), timestamp: z.string().regex(/^\d{1,12}$/),
});
const priority: Record<WhatsappMessageStatus, number> = { pending: 0, failed: 1, sent: 1, delivered: 2, read: 3 };

export const reconcileReceipts = async (tx: Prisma.TransactionClient, connection: ChannelConnection, externalMessageId: string) => {
  const where = { organizationId: connection.organizationId, connectionId: connection.id, providerMessageId: externalMessageId, direction: "outbound" as const };
  const message = await tx.whatsappMessage.findFirst({ where });
  if (!message) return;
  const receipts = await tx.officialDeliveryReceipt.findMany({
    where: { organizationId: connection.organizationId, connectionId: connection.id, externalMessageId },
    orderBy: [{ occurredAt: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
  });
  let status = message.status;
  let statusAt = message.officialStatusAt;
  for (const receipt of receipts) {
    if (priority[receipt.status] > priority[status] || (priority[receipt.status] === priority[status] && (!statusAt || receipt.occurredAt >= statusAt))) {
      status = receipt.status;
      statusAt = receipt.occurredAt;
    }
  }
  await tx.whatsappMessage.updateMany({ where, data: { status, officialStatusAt: statusAt } });
  await assessMessage(tx, connection, message, receipts);
};

export const ingestReceipt = async (connection: ChannelConnection, raw: Record<string, unknown>, receivedAt: Date) => {
  const receipt = receiptSchema.parse(raw);
  const occurredAt = eventDate(receipt.timestamp, receivedAt);
  const pricing = raw.pricing === undefined ? undefined : objectOf(raw.pricing) as Prisma.InputJsonObject;
  const conversationData = raw.conversation === undefined ? undefined : objectOf(raw.conversation) as Prisma.InputJsonObject;
  const errorCodes = objectsOf(raw.errors).flatMap(error => typeof error.code === "number" ? [error.code] : []);
  await withConnectionLock(connection, async tx => {
    await tx.officialDeliveryReceipt.createMany({ data: [{
      organizationId: connection.organizationId, connectionId: connection.id, externalMessageId: receipt.id,
      dedupKey: eventHash({ connectionId: connection.id, receipt: raw }), status: receipt.status, occurredAt, receivedAt,
      pricing, conversationData, errorCodes,
    }], skipDuplicates: true });
    await reconcileReceipts(tx, connection, receipt.id);
  });
};

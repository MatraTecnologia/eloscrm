import { prisma } from "../../lib/prisma.js";
import { httpError } from "../../lib/http-error.js";
import { phoneKey } from "../../lib/phone.js";
import type { Prisma, ChannelConnection } from "../../generated/prisma/client.js";
import { withConnectionLock } from "../whatsapp-official/identity.repo.js";

export const importAllowed = async (orgId: string, phone: string | null, db: Prisma.TransactionClient = prisma) => {
  const key = phoneKey(phone);
  if (!key) return false;
  const blocked = await db.communicationPermission.findFirst({ where: { organizationId: orgId, state: "suppressed", OR: [{ phoneKey: key }, { client: { organizationId: orgId, phoneKey: key } }] }, select: { id: true } });
  if (blocked) return false;
  const latest = await db.communicationPermissionRevision.findFirst({ where: { organizationId: orgId, phoneKey: key }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { state: true } });
  return latest?.state !== "suppressed";
};

export const importedIdentity = (connection: ChannelConnection, phone: string, name: string) => withConnectionLock(connection, async tx => {
  const organizationId = connection.organizationId;
  const scope = `business:${connection.businessPortfolioId}`;
  const found = await tx.contactIdentity.findMany({ where: { organizationId, scope, value: phone, kind: { in: ["phone", "wa_id"] } } });
  if (found.some(identity => identity.validUntil || identity.validFrom > new Date()) || new Set(found.map(identity => identity.contactId)).size > 1) throw httpError(422, "IMPORT_IDENTITY_REVIEW", "O telefone importado possui uma identidade que exige revisão");
  const existing = found.find(identity => identity.source === "provider") ?? found.find(identity => identity.source === "campaign_import");
  if (existing) return existing;
  const contact = await tx.messagingContact.create({ data: { organizationId, displayName: name || phone } });
  return tx.contactIdentity.create({ data: { organizationId, contactId: contact.id, connectionId: connection.id, scope, kind: "phone", value: phone, source: "campaign_import", recipientCountry: "BR" } });
});

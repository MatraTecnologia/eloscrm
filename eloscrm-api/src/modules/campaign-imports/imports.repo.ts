import { httpError } from "../../lib/http-error.js";
import type { ChannelConnection } from "../../generated/prisma/client.js";
import { withConnectionLock } from "../whatsapp-official/identity.repo.js";

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

import { httpError } from "../../lib/http-error.js";
import { officialPhoneVariants, toOfficialPhone } from "../../lib/phone.js";
import type { ChannelConnection } from "../../generated/prisma/client.js";
import { withConnectionLock } from "../whatsapp-official/identity.repo.js";

// Identidade de campanha a partir do telefone: serve à lista importada e ao lead do CRM que ainda
// não conversou pelo número oficial. O contato novo nasce sem `clientId` (único): a prévia não pode
// ocupar o vínculo que a conversa real do lead vai precisar. Contato já ligado ao lead é reaproveitado.
export const importedIdentity = (connection: ChannelConnection, phone: string, name: string, clientId?: string) => withConnectionLock(connection, async tx => {
  const organizationId = connection.organizationId;
  const scope = `business:${connection.businessPortfolioId}`;
  const value = toOfficialPhone(phone) ?? phone;
  const found = await tx.contactIdentity.findMany({ where: { organizationId, scope, value: { in: officialPhoneVariants(value) }, kind: { in: ["phone", "wa_id"] } }, orderBy: { id: "asc" } });
  if (found.some(identity => identity.validUntil || identity.validFrom > new Date())) throw httpError(422, "IMPORT_IDENTITY_REVIEW", "O telefone importado possui uma identidade que exige revisão");
  // O mesmo celular pode existir com e sem o nono dígito; a identidade informada pela Meta vence a da campanha.
  const provider = found.filter(identity => identity.source === "provider");
  const candidates = provider.length ? provider : found.filter(identity => identity.source === "campaign_import");
  if (new Set(candidates.map(identity => identity.contactId)).size > 1) throw httpError(422, "IMPORT_IDENTITY_REVIEW", "O telefone importado possui uma identidade que exige revisão");
  const existing = candidates.find(identity => identity.value === value) ?? candidates[0];
  if (existing) return existing;
  const linked = clientId ? await tx.messagingContact.findFirst({ where: { organizationId, clientId } }) : null;
  const contact = linked ?? await tx.messagingContact.create({ data: { organizationId, displayName: name || value } });
  return tx.contactIdentity.create({ data: { organizationId, contactId: contact.id, connectionId: connection.id, scope, kind: "phone", value, source: "campaign_import", recipientCountry: "BR" } });
});

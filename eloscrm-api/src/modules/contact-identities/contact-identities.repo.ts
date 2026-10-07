import { prisma } from "../../lib/prisma.js";
import type { ContactIdentityKind } from "../../generated/prisma/client.js";

type IdentityKey = { kind: ContactIdentityKind; scope: string; value: string };

export const find = (orgId: string, key: IdentityKey) => prisma.contactIdentity.findFirst({
  where: { organizationId: orgId, ...key },
  select: { id: true, contactId: true, validUntil: true },
});

export const findContact = (orgId: string, id: string) => prisma.messagingContact.findFirst({
  where: { organizationId: orgId, id }, select: { id: true, organizationId: true, displayName: true, clientId: true },
});

export const createContact = (orgId: string, connectionId: string, key: IdentityKey, displayName?: string) => prisma.$transaction(async tx => {
  const contact = await tx.messagingContact.create({
    data: { organizationId: orgId, displayName },
    select: { id: true, organizationId: true, displayName: true, clientId: true },
  });
  await tx.contactIdentity.create({
    data: { ...key, organizationId: orgId, contactId: contact.id, connectionId, source: "provider" },
  });
  return contact;
});

export const findClient = (orgId: string, id: string) => prisma.client.findFirst({
  where: { organizationId: orgId, id }, select: { id: true },
});

export const linkClient = async (orgId: string, id: string, clientId: string) => {
  const result = await prisma.messagingContact.updateMany({
    where: { id, organizationId: orgId, OR: [{ clientId: null }, { clientId }] }, data: { clientId },
  });
  return result.count ? findContact(orgId, id) : null;
};

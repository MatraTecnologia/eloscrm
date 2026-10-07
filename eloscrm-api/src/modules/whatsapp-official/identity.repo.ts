import * as z from "zod";
import { Prisma, type ChannelConnection, type ContactIdentityKind } from "../../generated/prisma/client.js";
import { httpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export type Alias = { kind: ContactIdentityKind; value: string };
const aliasSchema = z.strictObject({
  kind: z.enum(["phone", "wa_id", "bsuid", "parent_bsuid"]),
  value: z.string().min(1).max(256).refine(value => !/\s/.test(value)),
});

export const resolveAliases = async (tx: Prisma.TransactionClient, connection: ChannelConnection, aliases: Alias[], displayName?: string, occurredAt?: Date) => {
  if (!connection.businessPortfolioId || !aliases.length) throw httpError(422, "OFFICIAL_IDENTITY_MISSING", "O evento não possui identidade suficiente");
  for (const alias of aliases) {
    aliasSchema.parse(alias);
    if (["phone", "wa_id"].includes(alias.kind) && !/^\d{10,15}$/.test(alias.value)) throw httpError(422, "OFFICIAL_IDENTITY_INVALID", "A identidade de telefone é inválida");
  }
  const orgId = connection.organizationId;
  const scope = `business:${connection.businessPortfolioId}`;
  const existing = await tx.contactIdentity.findMany({ where: { organizationId: orgId, scope, OR: aliases } });
  if (existing.some(alias => alias.validUntil && (!occurredAt || occurredAt >= alias.validUntil))) throw httpError(409, "OFFICIAL_IDENTITY_RETIRED", "A identidade exige revisão");
  const contactIds = [...new Set(existing.map(alias => alias.contactId))];
  if (contactIds.length > 1) throw httpError(409, "OFFICIAL_IDENTITY_CONFLICT", "O evento possui identidades vinculadas a contatos diferentes");
  const contact = contactIds.length
    ? await tx.messagingContact.findFirstOrThrow({ where: { id: contactIds[0], organizationId: orgId } })
    : await tx.messagingContact.create({ data: { organizationId: orgId, displayName } });
  await tx.contactIdentity.createMany({ data: aliases.map(alias => ({
    ...alias, scope, organizationId: orgId, connectionId: connection.id, contactId: contact.id, source: "provider",
  })), skipDuplicates: true });
  // Outra conexão do mesmo portfolio pode disputar o alias; nunca aceita o contato perdedor.
  const saved = await tx.contactIdentity.findMany({ where: { organizationId: orgId, scope, OR: aliases } });
  if (saved.some(alias => alias.contactId !== contact.id)) throw httpError(409, "OFFICIAL_IDENTITY_CONFLICT", "A identidade foi vinculada a outro contato");
  return contact;
};

export const withConnectionLock = <T>(connection: ChannelConnection, operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(async tx => {
    // Aliases são compartilhados entre números do mesmo portfolio dentro da imobiliária.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp:${connection.organizationId}:${connection.businessPortfolioId}`}, 0))::text`;
    return operation(tx);
  }, { timeout: 30_000 });

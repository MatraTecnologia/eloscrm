import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict } from "../../lib/http-error.js";
import type { Period, RateInput, ReportInput } from "./costs.schema.js";

export const connection = (orgId: string, id: string) => prisma.channelConnection.findFirst({ where: { organizationId: orgId, id, provider: "cloud_api" }, select: { id: true, wabaId: true, currency: true, label: true, displayPhoneNumber: true } });
export const membership = (orgId: string, userId: string) => prisma.member.findFirst({ where: { organizationId: orgId, userId }, select: { role: true } });
export const previewIdentity = (orgId: string, id: string) => prisma.contactIdentity.findFirst({ where: { organizationId: orgId, id, source: "provider", validFrom: { lte: new Date() }, validUntil: null }, select: { kind: true, value: true, scope: true, contactId: true, recipientCountry: true } });
export const previewTemplate = (orgId: string, wabaId: string, id: string) => prisma.officialTemplate.findFirst({ where: { organizationId: orgId, wabaId, id, status: "APPROVED" }, select: { category: true } });
export const previewScope = (orgId: string, id: string) => prisma.channelConnection.findFirst({ where: { organizationId: orgId, id, provider: "cloud_api" }, select: { businessPortfolioId: true } });
export const rates = (orgId: string, wabaId: string) => prisma.officialRate.findMany({ where: { organizationId: orgId, wabaId }, orderBy: [{ validFrom: "desc" }, { country: "asc" }, { volumeFrom: "asc" }] });
export const importRates = (orgId: string, wabaId: string, currency: string, inputs: RateInput[], actorId: string) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cost-rate:${orgId}:${wabaId}`}, 0))::text`;
  const saved = [];
  for (const input of inputs) {
    const collisions = await tx.officialRate.findMany({ where: { organizationId: orgId, wabaId, country: input.country, category: input.category, pricingType: input.pricingType, validFrom: { lt: new Date(input.validUntil) }, validUntil: { gt: new Date(input.validFrom) } } });
    if (collisions.some(rate => rate.volumeFrom < (input.volumeUntil ?? Infinity) && input.volumeFrom < (rate.volumeUntil ?? Infinity))) throw conflict("COST_RATE_OVERLAP", "Já existe uma tarifa nesta vigência e faixa de volume; nenhuma linha foi importada");
    const { connectionId: _id, ...values } = input;
    saved.push(await tx.officialRate.create({ data: { ...values, validFrom: new Date(input.validFrom), validUntil: new Date(input.validUntil), unitRate: new Prisma.Decimal(input.unitRate), organizationId: orgId, wabaId, currency, createdById: actorId } }));
  }
  return saved;
});
export const addRate = async (orgId: string, wabaId: string, currency: string, input: RateInput, actorId: string) => (await importRates(orgId, wabaId, currency, [input], actorId))[0]!;
export const messageFilter = (orgId: string, input: ReportInput): Prisma.WhatsappMessageWhereInput => ({
  organizationId: orgId, connectionId: input.connectionId,
  ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  ...(input.contactId ? { conversation: { organizationId: orgId, messagingContactId: input.contactId } } : {}),
  ...(input.campaignId ? { officialCommand: { organizationId: orgId, campaignRecipient: { organizationId: orgId, campaignId: input.campaignId } } } : {}),
});
export const filterResources = async (orgId: string, input: ReportInput) => {
  const [contact, conversation, campaign] = await Promise.all([
    input.contactId ? prisma.messagingContact.findFirst({ where: { organizationId: orgId, id: input.contactId, identities: { some: { organizationId: orgId, connectionId: input.connectionId } } }, select: { id: true } }) : true,
    input.conversationId ? prisma.conversation.findFirst({ where: { organizationId: orgId, id: input.conversationId, connectionId: input.connectionId }, select: { id: true } }) : true,
    input.campaignId ? prisma.officialCampaign.findFirst({ where: { organizationId: orgId, id: input.campaignId, connectionId: input.connectionId }, select: { id: true } }) : true,
  ]);
  return !!contact && !!conversation && !!campaign;
};
export const messages = (orgId: string, input: ReportInput) => prisma.whatsappMessage.findMany({ where: { ...messageFilter(orgId, input), direction: "outbound", sentAt: { gte: new Date(input.start), lt: new Date(input.end) } }, select: { id: true, origin: true, status: true, sentAt: true, conversationId: true, officialCommand: { select: { status: true } } }, take: 20001 });
export const costs = (orgId: string, input: ReportInput) => prisma.messageCost.findMany({ where: { organizationId: orgId, connectionId: input.connectionId, message: messageFilter(orgId, input), deliveredAt: { gte: new Date(input.start), lt: new Date(input.end) } }, orderBy: [{ deliveredAt: "desc" }, { id: "desc" }], take: 20001 });
export const analytics = (orgId: string, wabaId: string, input: Period) => prisma.costAnalyticsSnapshot.findFirst({ where: { organizationId: orgId, wabaId, start: new Date(input.start), end: new Date(input.end) } });
export const saveAnalytics = (orgId: string, wabaId: string, input: Period, startedAt: Date, data: { currency: string | null; status: string; points?: Prisma.InputJsonValue; total?: Prisma.Decimal | null; volume?: number | null; contentHash?: string; safeError: string | null }) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cost-analytics:${orgId}:${wabaId}`}, 0))::text`;
  const where = { organizationId_wabaId_start_end: { organizationId: orgId, wabaId, start: new Date(input.start), end: new Date(input.end) } };
  const previous = await tx.costAnalyticsSnapshot.findUnique({ where });
  if (previous && previous.lastAttemptAt > startedAt) return previous;
  const changed = !!data.contentHash && data.contentHash !== previous?.contentHash;
  const revision = (previous?.revision ?? 0) + Number(changed);
  const values = { ...data, currency: data.points ? data.currency : previous?.currency ?? data.currency, lastAttemptAt: startedAt, revision, ...(data.points ? { syncedAt: new Date() } : {}) };
  const saved = await tx.costAnalyticsSnapshot.upsert({ where, create: { organizationId: orgId, wabaId, start: new Date(input.start), end: new Date(input.end), points: [], ...values }, update: values });
  if (changed) await tx.costAnalyticsRevision.create({ data: { organizationId: orgId, snapshotId: saved.id, revision, data: JSON.parse(JSON.stringify({ points: saved.points, total: saved.total, volume: saved.volume, currency: saved.currency, syncedAt: saved.syncedAt })) as Prisma.InputJsonValue } });
  return saved;
});

export const setRecipientCountry = (orgId: string, identityId: string, country: string) => prisma.contactIdentity.updateMany({ where: { organizationId: orgId, id: identityId, validUntil: null }, data: { recipientCountry: country } });
export const reconciliations = (orgId: string, wabaId: string, input: Period) => prisma.costReconciliation.findMany({ where: { organizationId: orgId, connectionId: input.connectionId, wabaId, start: new Date(input.start), end: new Date(input.end) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
export const saveReconciliation = (data: Prisma.CostReconciliationUncheckedCreateInput) => prisma.costReconciliation.create({ data });

export const scopeOptions = async (orgId: string, connectionId: string) => {
  const [contacts, conversations, campaigns] = await Promise.all([
    prisma.messagingContact.findMany({ where: { organizationId: orgId, identities: { some: { organizationId: orgId, connectionId, source: "provider", validUntil: null } } }, select: { id: true, displayName: true, identities: { where: { organizationId: orgId, connectionId, source: "provider", validUntil: null }, select: { id: true, recipientCountry: true, kind: true } } }, orderBy: { updatedAt: "desc" }, take: 200 }),
    prisma.conversation.findMany({ where: { organizationId: orgId, connectionId }, select: { id: true, contactName: true, waName: true, messagingContact: { select: { displayName: true } } }, orderBy: { updatedAt: "desc" }, take: 200 }),
    prisma.officialCampaign.findMany({ where: { organizationId: orgId, connectionId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return { contacts: contacts.map(contact => ({ id: contact.id, label: contact.displayName ?? "Contato sem nome", identities: contact.identities })), conversations: conversations.map(conversation => ({ id: conversation.id, label: conversation.messagingContact?.displayName ?? conversation.contactName ?? conversation.waName ?? "Atendimento sem nome" })), campaigns: campaigns.map(campaign => ({ id: campaign.id, label: campaign.name })), limit: 200 };
};

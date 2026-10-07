import { Prisma, type ChannelConnection, type OfficialDeliveryReceipt, type WhatsappMessage } from "../../generated/prisma/client.js";
import { eventHash, objectOf } from "../whatsapp-official/webhook.schema.js";

export const assessMessage = async (tx: Prisma.TransactionClient, channel: ChannelConnection, message: WhatsappMessage, receipts: OfficialDeliveryReceipt[], force = false) => {
  if (message.origin !== "cloud_api" || message.direction !== "outbound") return;
  const delivered = receipts.filter(receipt => ["delivered", "read"].includes(receipt.status));
  if (!delivered.length) return;
  const deliveredAt = delivered[0]!.occurredAt;
  const priced = [...receipts].reverse().find(receipt => receipt.pricing !== null);
  const pricing = objectOf(priced?.pricing ?? {});
  const category = typeof pricing.category === "string" ? pricing.category.toUpperCase() : null;
  const pricingType = typeof pricing.type === "string" ? pricing.type.toUpperCase() : null;
  const billable = typeof pricing.billable === "boolean" ? pricing.billable : null;
  const pricingModel = typeof pricing.pricing_model === "string" ? pricing.pricing_model : null;
  const aliases = Array.isArray(message.recipientIdentity) ? message.recipientIdentity : [];
  let explicitCountry: string | null = null;
  let phone = aliases.map(objectOf).find(alias => alias.kind === "phone" || alias.kind === "wa_id")?.value;
  const identityId = Array.isArray(message.recipientIdentity) ? undefined : objectOf(message.recipientIdentity ?? {}).identityId;
  if (typeof identityId === "string") {
    const identity = await tx.contactIdentity.findFirst({ where: { organizationId: channel.organizationId, id: identityId, scope: `business:${channel.businessPortfolioId}`, source: { in: ["provider", "campaign_import"] }, validFrom: { lte: deliveredAt }, OR: [{ validUntil: null }, { validUntil: { gt: deliveredAt } }] }, select: { kind: true, value: true, contactId: true, recipientCountry: true } });
    explicitCountry = identity?.recipientCountry ?? null;
    if (identity && ["phone", "wa_id"].includes(identity.kind)) phone = identity.value;
    // BSUID não é convertido em telefone para atribuir um país.
  }
  const country = explicitCountry ?? (typeof phone === "string" && /^55\d{10,11}$/.test(phone) ? "BR" : null);
  const pricingHash = eventHash({ category, pricingType, billable, pricingModel, country, deliveredAt: deliveredAt.toISOString() });
  const previous = await tx.messageCost.findFirst({ where: { organizationId: channel.organizationId, messageId: message.id } });
  if (previous?.pricingHash === pricingHash && !force) return;
  const currency = previous?.currency ?? channel.currency;
  let state = !priced || billable === null ? "missing_pricing" : pricingModel !== "PMP" ? "unsupported_model" : !currency ? "missing_currency" : "missing_rate";
  let amount: Prisma.Decimal | null = null;
  let rateSnapshot: Prisma.InputJsonValue | undefined;
  if (pricingModel === "PMP" && currency && billable === false && ["FREE_CUSTOMER_SERVICE", "FREE_ENTRY_POINT"].includes(pricingType ?? "")) { amount = new Prisma.Decimal(0); state = "provider_free"; }
  else if (pricingModel === "PMP" && billable === true && currency) {
    if (!country) state = "missing_country";
    else if (category && pricingType && channel.wabaId) {
      const rate = await tx.officialRate.findFirst({ where: { organizationId: channel.organizationId, wabaId: channel.wabaId, country, category, pricingType, currency: currency, volumeFrom: 0, validFrom: { lte: deliveredAt }, validUntil: { gt: deliveredAt } } });
      if (rate) { amount = rate.unitRate; state = "estimated_base"; rateSnapshot = JSON.parse(JSON.stringify({ ...rate, unitRate: rate.unitRate.toFixed() })) as Prisma.InputJsonValue; }
    }
  }
  const values = { connectionId: channel.id, deliveredAt, country, category, pricingType, billable, pricingModel, currency: currency, amount, state, receiptId: priced?.id ?? delivered[0]!.id, pricingHash, rateSnapshot: rateSnapshot ?? Prisma.DbNull };
  if (previous?.pricingHash === pricingHash && previous.state === state && previous.currency === currency && previous.amount?.toFixed() === amount?.toFixed() && eventHash(previous.rateSnapshot) === eventHash(rateSnapshot ?? null)) return;
  const revision = (previous?.revision ?? 0) + 1;
  const cost = await tx.messageCost.upsert({ where: { messageId: message.id }, create: { organizationId: channel.organizationId, messageId: message.id, ...values, revision }, update: { ...values, revision } });
  await tx.messageCostRevision.create({ data: { organizationId: channel.organizationId, costId: cost.id, revision, snapshot: JSON.parse(JSON.stringify({ ...values, rateSnapshot: rateSnapshot ?? null, amount: amount?.toFixed() ?? null })) as Prisma.InputJsonValue } });
};

import { Prisma } from "../../generated/prisma/client.js";
import { CostDecimal } from "./money.js";
import { forbidden, httpError, notFound } from "../../lib/http-error.js";
import * as repo from "./costs.repo.js";
import type { Period, RateInput, SimulationInput, PreviewInput, ReportInput, RateImportInput, ReconciliationInput } from "./costs.schema.js";

export const requireManager = async (orgId: string, userId: string) => {
  const member = await repo.membership(orgId, userId);
  if (!member || !["owner", "admin"].includes(member.role)) throw forbidden("Somente donos e gestores consultam custos");
};
export const getConnection = async (orgId: string, id: string) => {
  const channel = await repo.connection(orgId, id);
  if (!channel?.wabaId) throw notFound("Conexão oficial não encontrada nesta imobiliária");
  return channel;
};
const publicRate = ({ organizationId: _org, createdById: _actor, ...rate }: Awaited<ReturnType<typeof repo.rates>>[number]) => ({ ...rate, unitRate: rate.unitRate.toFixed() });
export const listRates = async (orgId: string, connectionId: string) => { const channel = await getConnection(orgId, connectionId); return (await repo.rates(orgId, channel.wabaId!)).map(publicRate); };
export const addRate = async (orgId: string, input: RateInput, actorId: string) => {
  const channel = await getConnection(orgId, input.connectionId);
  if (!channel.currency) throw httpError(422, "COST_CURRENCY_UNKNOWN", "Sincronize a moeda da WABA antes de cadastrar tarifas");
  if (input.pricingType !== "REGULAR" && !new CostDecimal(input.unitRate).isZero()) throw httpError(422, "COST_FREE_RATE", "Uma condição gratuita exige tarifa zero e elegibilidade explícita na simulação");
  return publicRate(await repo.addRate(orgId, channel.wabaId!, channel.currency, input, actorId));
};
export const simulate = async (orgId: string, input: SimulationInput) => {
  const channel = await getConnection(orgId, input.connectionId);
  const catalog = await repo.rates(orgId, channel.wabaId!);
  const at = new Date(input.at);
  const rows = input.rows.map(row => {
    const rates = catalog.filter(rate => rate.currency === channel.currency && rate.country === row.country && rate.category === row.category && rate.pricingType === row.pricingType && rate.validFrom <= at && rate.validUntil > at);
    let remaining = row.quantity;
    let cursor = row.volumeBefore;
    let amount = new CostDecimal(0);
    const segments: { quantity: number; rate: ReturnType<typeof publicRate> }[] = [];
    while (remaining > 0) {
      const rate = rates.find(rate => rate.volumeFrom <= cursor && (rate.volumeUntil === null || rate.volumeUntil > cursor));
      if (!rate) return { ...row, amount: null, currency: channel.currency, state: "missing_rate", segments: [] };
      const quantity = Math.min(remaining, (rate.volumeUntil ?? Infinity) - cursor);
      segments.push({ quantity, rate: publicRate(rate) });
      amount = amount.plus(new CostDecimal(rate.unitRate.toFixed()).times(quantity)); cursor += quantity; remaining -= quantity;
    }
    return { ...row, amount: amount.toFixed(), currency: channel.currency, state: "estimated", segments };
  });
  return { at: input.at, generatedAt: new Date().toISOString(), connectionId: channel.id, currency: channel.currency, rows, total: rows.every(row => row.amount !== null) ? rows.reduce((total, row) => total.plus(row.amount!), new CostDecimal(0)).toFixed() : null,
    assumptions: ["Entrega de todas as mensagens informadas.", "Volumes anteriores e condições gratuitas são hipóteses declaradas, sem confirmação de elegibilidade ou desconto.", "Tarifa Meta na moeda original. Impostos, intermediários e câmbio não incluídos.", "A simulação não autoriza envio nem altera a janela de atendimento."] };
};
export const preview = async (orgId: string, input: PreviewInput) => {
  const channel = await getConnection(orgId, input.connectionId);
  const [identity, scope] = await Promise.all([repo.previewIdentity(orgId, input.identityId), repo.previewScope(orgId, channel.id)]);
  if (!identity || identity.scope !== `business:${scope?.businessPortfolioId}`) throw notFound("Identidade não encontrada neste número");
  const template = input.type === "template" ? await repo.previewTemplate(orgId, channel.wabaId!, input.templateId!) : null;
  if (input.type === "template" && !template) throw notFound("Template aprovado não encontrado");
  const category = template?.category ?? "SERVICE";
  const country = identity.recipientCountry ?? (["phone", "wa_id"].includes(identity.kind) && /^55\d{10,11}$/.test(identity.value) ? "BR" : null);
  if (!country) return { amount: null, currency: channel.currency, category, state: "missing_country" };
  const result = await simulate(orgId, { connectionId: channel.id, at: new Date().toISOString(), rows: [{ country, category, pricingType: "REGULAR", quantity: 1, volumeBefore: 0 }] });
  return { amount: result.total, currency: result.currency, category, state: result.total === null ? "missing_rate" : "estimated_base" };
};
export const report = async (orgId: string, input: ReportInput) => {
  const channel = await getConnection(orgId, input.connectionId);
  if (!await repo.filterResources(orgId, input)) throw notFound("Recorte não encontrado nesta conexão");
  const [messages, costs, analytics] = await Promise.all([repo.messages(orgId, input), repo.costs(orgId, input), repo.analytics(orgId, channel.wabaId!, input)]);
  if (messages.length > 20000 || costs.length > 20000) throw httpError(422, "COST_PERIOD_LIMIT", "Reduza o período: limite de 20 mil mensagens por consulta");
  const currencies = new Map<string, { amount: InstanceType<typeof CostDecimal>; known: number }>();
  for (const cost of costs) if (cost.amount !== null && cost.currency) { const total = currencies.get(cost.currency) ?? { amount: new CostDecimal(0), known: 0 }; total.amount = total.amount.plus(cost.amount); total.known++; currencies.set(cost.currency, total); }
  const counts = { official: 0, businessApp: 0, history: 0, pending: 0, uncertain: 0, failed: 0 };
  for (const message of messages) {
    if (message.origin === "business_app") counts.businessApp++;
    else if (message.origin === "history") counts.history++;
    else if (message.origin === "cloud_api") { counts.official++; if (message.officialCommand?.status === "uncertain") counts.uncertain++; else if (message.status === "failed") counts.failed++; else if (message.status === "pending") counts.pending++; }
  }
  return { connectionId: channel.id, start: input.start, end: input.end, filters: { contactId: input.contactId ?? null, conversationId: input.conversationId ?? null, campaignId: input.campaignId ?? null }, counts, assessed: costs.length, unresolved: costs.filter(cost => cost.amount === null).length,
    subtotals: [...currencies].map(([currency, total]) => ({ currency, amount: total.amount.toFixed(), known: total.known })),
    items: costs.slice(0, 100).map(({ id, messageId, deliveredAt, category, pricingType, country, currency, amount, state, revision, rateSnapshot }) => ({ id, messageId, deliveredAt, category, pricingType, country, currency, amount: amount?.toFixed() ?? null, state, revision, rateSnapshot })), truncated: costs.length > 100,
    analytics: analytics ? { id: analytics.id, scope: "waba", currency: analytics.currency, status: analytics.status, total: analytics.total?.toFixed() ?? null, volume: analytics.volume, syncedAt: analytics.syncedAt, lastAttemptAt: analytics.lastAttemptAt, safeError: analytics.safeError, revision: analytics.revision, points: analytics.points } : null,
  };
};

export const importRates = async (orgId: string, input: RateImportInput, actorId: string) => {
  const channel = await getConnection(orgId, input.connectionId);
  if (!channel.currency) throw httpError(422, "COST_CURRENCY_UNKNOWN", "Sincronize a moeda da WABA antes de importar tarifas");
  if (input.rows.some(row => row.pricingType !== "REGULAR" && !new CostDecimal(row.unitRate).isZero())) throw httpError(422, "COST_FREE_RATE", "Uma condição gratuita exige tarifa zero");
  return (await repo.importRates(orgId, channel.wabaId!, channel.currency, input.rows.map(row => ({ ...row, connectionId: channel.id })), actorId)).map(publicRate);
};
export const setRecipientCountry = async (orgId: string, input: { connectionId: string; identityId: string; country: string }) => {
  const channel = await getConnection(orgId, input.connectionId);
  const [identity, scope] = await Promise.all([repo.previewIdentity(orgId, input.identityId), repo.previewScope(orgId, channel.id)]);
  if (!identity || identity.scope !== `business:${scope?.businessPortfolioId}`) throw notFound("Identidade não encontrada neste número");
  await repo.setRecipientCountry(orgId, input.identityId, input.country);
  return { identityId: input.identityId, country: input.country, source: "manager_declared" };
};
const publicReconciliation = (row: Awaited<ReturnType<typeof repo.saveReconciliation>>) => ({
  id: row.id, connectionId: row.connectionId, wabaId: row.wabaId, currency: row.currency, start: row.start, end: row.end,
  documentReference: row.documentReference, reportedTotal: row.reportedTotal.toFixed(), declaredFees: row.declaredFees?.toFixed() ?? null, declaredTaxes: row.declaredTaxes?.toFixed() ?? null,
  note: row.note, createdById: row.createdById, createdAt: row.createdAt, snapshot: row.snapshot, evidence: "manager_declared",
});
export const listReconciliations = async (orgId: string, input: Period) => {
  const channel = await getConnection(orgId, input.connectionId);
  return (await repo.reconciliations(orgId, channel.wabaId!, input)).map(publicReconciliation);
};
export const reconcile = async (orgId: string, input: ReconciliationInput, actorId: string) => {
  const channel = await getConnection(orgId, input.connectionId);
  if (!channel.currency) throw httpError(422, "COST_CURRENCY_UNKNOWN", "Sincronize a moeda da WABA antes de registrar a conferência");
  const data = await report(orgId, { connectionId: input.connectionId, start: input.start, end: input.end });
  const extra = new CostDecimal(input.declaredFees ?? "0").plus(input.declaredTaxes ?? "0");
  if (extra.greaterThan(input.reportedTotal)) throw httpError(422, "COST_INVOICE_COMPONENTS", "Taxas e impostos não podem exceder o total declarado");
  const messagingTotal = new CostDecimal(input.reportedTotal).minus(extra);
  const analytics = data.analytics;
  const comparable = analytics?.status === "available" && analytics.currency === channel.currency && analytics.total !== null;
  const snapshot = {
    generatedAt: new Date().toISOString(), evidence: "manager_declared", documentScope: "waba", messagingTotal: messagingTotal.toFixed(),
    counts: data.counts, assessed: data.assessed, unresolved: data.unresolved, localSubtotals: data.subtotals, localScope: "connection",
    analytics, differenceFromMeta: comparable ? messagingTotal.minus(analytics.total!).toFixed() : null,
    differenceFromLocalEstimate: data.subtotals.length === 1 && data.subtotals[0]!.currency === channel.currency ? messagingTotal.minus(data.subtotals[0]!.amount).toFixed() : null,
    limitations: ["Documento e valores declarados pelo gestor, sem verificação automática no provedor.", "O agregado Meta abrange a WABA; o subtotal estimado abrange somente esta conexão.", "Diferenças não são distribuídas entre mensagens, contatos ou campanhas.", "Taxas e impostos ausentes não têm confirmação de valor zero."],
  };
  return publicReconciliation(await repo.saveReconciliation({ organizationId: orgId, connectionId: channel.id, wabaId: channel.wabaId!, currency: channel.currency, start: new Date(input.start), end: new Date(input.end), documentReference: input.documentReference,
    reportedTotal: new Prisma.Decimal(input.reportedTotal), declaredFees: input.declaredFees === undefined ? null : new Prisma.Decimal(input.declaredFees), declaredTaxes: input.declaredTaxes === undefined ? null : new Prisma.Decimal(input.declaredTaxes), note: input.note, createdById: actorId, snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue }));
};

export const scopeOptions = async (orgId: string, connectionId: string) => {
  const channel = await getConnection(orgId, connectionId);
  return repo.scopeOptions(orgId, channel.id);
};

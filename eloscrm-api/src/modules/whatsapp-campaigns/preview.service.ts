import { httpError, notFound } from "../../lib/http-error.js";
import * as deals from "../broadcasts/broadcasts.repo.js";
import { filterReplies } from "./targets.service.js";
import * as outbound from "../whatsapp-outbound/outbound.repo.js";
import { templateSchema } from "../whatsapp-outbound/outbound.schema.js";
import { mediaTypes, readMedia, type MediaMime } from "../whatsapp-outbound/media.service.js";
import { buildTemplate } from "../whatsapp-outbound/template.js";
import { eventHash } from "../whatsapp-official/webhook.schema.js";
import * as permissions from "../communication-permissions/permissions.repo.js";
import { CostDecimal } from "../whatsapp-costs/money.js";
import * as costs from "../whatsapp-costs/costs.repo.js";
import * as repo from "./campaigns.repo.js";
import type { CampaignInput } from "./campaigns.schema.js";
import { phoneKey } from "../../lib/phone.js";
import { resolveParameters } from "./parameters.js";
import { importAllowed, importedIdentity } from "../campaign-imports/imports.repo.js";

export const preview = async (orgId: string, input: CampaignInput) => {
  const [channel, pipeline] = await Promise.all([outbound.connection(orgId, input.connectionId), deals.findPipeline(orgId, input.pipelineId)]);
  if (!channel?.wabaId || !pipeline) throw notFound("Conexão ou funil não encontrado nesta imobiliária");
  if (channel.status !== "connected" || channel.disabledAt || !channel.tokenEnc || (channel.tokenExpiresAt && channel.tokenExpiresAt <= new Date())) throw httpError(422, "CAMPAIGN_CONNECTION", "Conecte o número oficial antes de preparar a campanha");
  const stored = await outbound.template(orgId, channel.wabaId, input.templateId);
  if (!stored) throw notFound("Template não encontrado nesta WABA");
  const definition = templateSchema.parse(stored.definition);
  let headerMedia: { uploadId: string; mime: string; size: number; digest: string; filename: string } | undefined;
  if (input.headerUploadId) {
    const upload = await outbound.upload(orgId, channel.id, input.headerUploadId);
    const format = definition.components.find(component => component.type === "HEADER")?.format?.toLowerCase();
    if (!upload || !(upload.mime in mediaTypes) || mediaTypes[upload.mime as MediaMime] !== format) throw httpError(422, "CAMPAIGN_MEDIA", "O arquivo deve pertencer a este número e corresponder ao cabeçalho aprovado");
    await readMedia(upload);
    headerMedia = { uploadId: upload.id, mime: upload.mime, size: upload.size, digest: upload.digest, filename: upload.filename };
  }
  const build = (parameters: CampaignInput["parameters"]) => {
    const built = buildTemplate({ ...definition, status: stored.status }, { type: "template", identityId: "preview", idempotencyKey: "preview-only", templateId: stored.id, parameters, ...(input.headerUploadId ? { headerUploadId: input.headerUploadId } : {}) });
    const header = definition.components.find(component => component.type === "HEADER")?.text?.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => parameters.header[name]!);
    const footer = definition.components.find(component => component.type === "FOOTER")?.text;
    const urls = (definition.components.find(component => component.type === "BUTTONS")?.buttons ?? []).flatMap((button, index) => button.type === "URL" && button.url ? [button.url.replace("{{1}}", parameters.buttons?.[String(index)] ?? "")] : []);
    return { ...built, preview: [header, built.preview, footer, ...urls].filter(Boolean).join("\n") };
  };
  const built = build(resolveParameters(input).parameters);
  const matched = await filterReplies(orgId, await deals.matchDeals(orgId, pipeline.id, input.filters, { dealIds: input.dealIds, limit: 201 }), input.filters);
  const selected = new Set(input.dealIds);
  const targets = matched.filter(deal => selected.has(deal.id)).sort((a, b) => a.id.localeCompare(b.id));
  const owners = await deals.memberNames(orgId, [...new Set(targets.flatMap(deal => deal.ownerId ? [deal.ownerId] : []))]);
  const catalog = await costs.rates(orgId, channel.wabaId);
  const at = new Date(); const used = new Set<string>(); const destinations = new Set<string>();
  const rows = [];
  for (const imported of input.importedAudience?.recipients ?? []) {
    const phone = imported.phone!;
    let identity: Awaited<ReturnType<typeof importedIdentity>> | null = null;
    let exclusion: string | null = null;
    if (!await importAllowed(orgId, phone)) exclusion = "Comunicação descadastrada para este telefone";
    else if (destinations.has(`import:${phone}`)) exclusion = "Telefone repetido nesta lista";
    else {
      try { identity = await importedIdentity(channel, phone, imported.name); }
      catch { exclusion = "Identidade do telefone exige revisão"; }
    }
    destinations.add(`import:${phone}`);
    const resolved = resolveParameters(input, undefined, undefined, imported.name);
    let text: string | null = null;
    if (resolved.missing) exclusion ??= "Nome ausente ou campo do CRM indisponível na lista importada";
    else { try { text = build(resolved.parameters).preview; } catch { exclusion ??= "Dados personalizados excedem os limites do template"; } }
    const rate = catalog.find(rate => rate.currency === channel.currency && rate.country === "BR" && rate.category === stored.category && rate.pricingType === "REGULAR" && rate.volumeFrom === 0 && rate.validFrom <= at && rate.validUntil > at);
    const cost = { country: "BR", category: stored.category, currency: channel.currency, amount: !exclusion && rate ? rate.unitRate.toFixed() : null, rateId: !exclusion && rate ? rate.id : null, state: exclusion ? "excluded" : !rate ? "missing_rate" : "estimated_base", rate: !exclusion && rate ? { id: rate.id, unitRate: rate.unitRate.toFixed(), country: rate.country, category: rate.category, currency: rate.currency, pricingType: rate.pricingType, sourceUrl: rate.sourceUrl, validFrom: rate.validFrom.toISOString(), validUntil: rate.validUntil.toISOString(), volumeFrom: rate.volumeFrom, volumeUntil: rate.volumeUntil } : null };
    rows.push({ dealId: `import:${phone}`, clientId: "", clientName: imported.name || phone, contactId: identity?.contactId ?? null, identityId: identity?.id ?? null, identityHash: identity ? eventHash({ scope: identity.scope, kind: identity.kind, value: identity.value }) : null, parameters: resolved.parameters, text, exclusion, cost });
  }
  for (const deal of targets) {
    const contact = await repo.contact(orgId, deal.client.id, `business:${channel.businessPortfolioId}`);
    const identity = contact?.identities.find(value => ["wa_id", "bsuid", "parent_bsuid", "phone"].includes(value.kind));
    const destination = identity ? `${identity.scope}:${["phone", "wa_id"].includes(identity.kind) ? "to" : "recipient"}:${identity.value}` : null;
    let exclusion: string | null = null;
    if (!await permissions.allowed(orgId, deal.client.id, identity && ["wa_id", "phone"].includes(identity.kind) ? phoneKey(identity.value) : null)) exclusion = "Permissão ausente ou comunicação descadastrada";
    else if (!identity) exclusion = "Sem identidade oficial vigente neste portfolio";
    else if (used.has(contact!.id) || destinations.has(destination!)) exclusion = "Pessoa já selecionada por outro negócio";
    const resolved = resolveParameters(input, deal, deal.ownerId ? owners.get(deal.ownerId) : undefined);
    let text: string | null = null;
    if (resolved.missing) exclusion ??= "Campo do CRM ausente para personalizar o template";
    else {
      try { text = build(resolved.parameters).preview; }
      catch { exclusion ??= "Dados personalizados excedem os limites do template"; }
    }
    if (!exclusion && contact && destination) { used.add(contact.id); destinations.add(destination); }
    const country = identity?.recipientCountry ?? (identity && ["wa_id", "phone"].includes(identity.kind) && /^55\d{10,11}$/.test(identity.value) ? "BR" : null);
    const rate = catalog.find(rate => rate.currency === channel.currency && rate.country === country && rate.category === stored.category && rate.pricingType === "REGULAR" && rate.volumeFrom === 0 && rate.validFrom <= at && rate.validUntil > at);
    const cost = { country, category: stored.category, currency: channel.currency, amount: !exclusion && rate ? rate.unitRate.toFixed() : null, rateId: !exclusion && rate ? rate.id : null, state: exclusion ? "excluded" : !country ? "missing_country" : !rate ? "missing_rate" : "estimated_base",
      rate: !exclusion && rate ? { id: rate.id, unitRate: rate.unitRate.toFixed(), country: rate.country, category: rate.category, currency: rate.currency, pricingType: rate.pricingType, sourceUrl: rate.sourceUrl, validFrom: rate.validFrom.toISOString(), validUntil: rate.validUntil.toISOString(), volumeFrom: rate.volumeFrom, volumeUntil: rate.volumeUntil } : null };
    rows.push({ dealId: deal.id, clientId: deal.client.id, clientName: deal.client.name, contactId: contact?.id ?? null, identityId: identity?.id ?? null, identityHash: identity ? eventHash({ scope: identity.scope, kind: identity.kind, value: identity.value }) : null, parameters: resolved.parameters, text, exclusion, cost });
  }
  for (const id of input.dealIds) if (!targets.some(deal => deal.id === id)) rows.push({ dealId: id, clientId: "", clientName: "Negócio fora da seleção atual", contactId: null, identityId: null, identityHash: null, parameters: input.parameters, text: null, exclusion: "Negócio indisponível ou fora dos filtros", cost: { country: null, category: stored.category, currency: channel.currency, amount: null, rateId: null, state: "excluded", rate: null } });
  const eligible = rows.filter(row => !row.exclusion);
  const result = { ...(headerMedia ? { headerMedia } : {}), connectionId: channel.id, pipelineId: pipeline.id, template: { id: stored.id, name: stored.name, category: stored.category, language: stored.language, definitionHash: eventHash(definition) }, parameters: input.parameters, text: built.preview, rows, eligible: eligible.length, excluded: rows.length - eligible.length,
    estimate: { currency: channel.currency, amount: eligible.length && eligible.every(row => row.cost.amount !== null) ? eligible.reduce((sum, row) => sum.plus(row.cost.amount!), new CostDecimal(0)).toFixed() : null, unresolved: eligible.filter(row => row.cost.amount === null).length, messagesPerPerson: 1, assumption: "Entrega de uma mensagem por pessoa elegível, pela tarifa base; impostos, câmbio e intermediários não incluídos." } };
  return { ...result, previewHash: eventHash(result), generatedAt: at.toISOString() };
};
export type CampaignPreview = Awaited<ReturnType<typeof preview>>;

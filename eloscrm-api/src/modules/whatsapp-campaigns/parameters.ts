import { httpError } from "../../lib/http-error.js";
import type { MatchedDeal } from "../broadcasts/broadcasts.repo.js";
import type { CampaignInput } from "./campaigns.schema.js";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const resolveParameters = (input: CampaignInput, deal?: MatchedDeal, ownerName?: string, importedName?: string) => {
  const fields = {
    firstName: (deal?.client.name ?? importedName)?.trim().split(/\s+/)[0], fullName: deal?.client.name ?? importedName,
    dealTitle: deal?.title, dealValue: deal?.value != null ? currency.format(Number(deal.value.toString())) : undefined,
    propertyTitle: deal?.property?.title, ownerName,
  };
  const parameters = { ...(input.parameters.buttons ? { buttons: { ...input.parameters.buttons } } : {}), header: { ...input.parameters.header }, body: { ...input.parameters.body } };
  let missing = false;
  for (const part of ["header", "body"] as const) for (const [name, source] of Object.entries(input.parameterSources?.[part] ?? {})) {
    if (Object.hasOwn(parameters[part], name)) throw httpError(422, "CAMPAIGN_PARAMETERS", "Escolha texto fixo ou campo do CRM para cada variável");
    const value = deal || importedName !== undefined ? fields[source]?.trim() : "Prévia";
    if (!value) missing = true;
    parameters[part][name] = value ?? "";
  }
  return { parameters, missing };
};

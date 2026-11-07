import { httpError } from "../../lib/http-error.js";
import type { MatchedDeal } from "../broadcasts/broadcasts.repo.js";
import type { CampaignInput } from "./campaigns.schema.js";
import { isAutoNamed } from "../../lib/lead-name.js";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const resolveParameters = (input: CampaignInput, deal?: MatchedDeal, ownerName?: string, importedName?: string) => {
  // Lead batizado pela automação tem o telefone como nome; no template sairia "Olá (43), …".
  const unnamed = !!deal && isAutoNamed(deal.client);
  const name = unnamed ? undefined : deal?.client.name ?? importedName;
  const fields = {
    firstName: name?.trim().split(/\s+/)[0], fullName: name,
    dealTitle: deal?.title, dealValue: deal?.value != null ? currency.format(Number(deal.value.toString())) : undefined,
    propertyTitle: deal?.property?.title, ownerName,
  };
  const parameters = { ...(input.parameters.buttons ? { buttons: { ...input.parameters.buttons } } : {}), header: { ...input.parameters.header }, body: { ...input.parameters.body } };
  let missing = false; let missingName = false;
  for (const part of ["header", "body"] as const) for (const [name, source] of Object.entries(input.parameterSources?.[part] ?? {})) {
    if (Object.hasOwn(parameters[part], name)) throw httpError(422, "CAMPAIGN_PARAMETERS", "Escolha texto fixo ou campo do CRM para cada variável");
    const value = deal || importedName !== undefined ? fields[source]?.trim() : "Prévia";
    if (!value) { missing = true; if (unnamed && (source === "firstName" || source === "fullName")) missingName = true; }
    parameters[part][name] = value ?? "";
  }
  return { parameters, missing, missingName };
};

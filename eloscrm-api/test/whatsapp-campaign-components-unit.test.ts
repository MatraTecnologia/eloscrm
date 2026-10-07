import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { campaignInputSchema } from "../src/modules/whatsapp-campaigns/campaigns.schema.js";
import { resolveParameters } from "../src/modules/whatsapp-campaigns/parameters.js";

const input = () => campaignInputSchema.parse({ connectionId: "connection-fixture", pipelineId: "pipeline-fixture", dealIds: ["deal-fixture"], templateId: "template-fixture", headerUploadId: randomUUID(), parameters: { header: {}, body: {}, buttons: { "0": "appointment-123" } }, parameterSources: { body: { "1": "firstName" } } });
describe("parâmetros de componentes da campanha", () => {
  it("preserva os botões fixos enquanto resolve campos do CRM sem alterar a origem", () => {
    const parsed = input();
    const before = structuredClone(parsed);
    expect(resolveParameters(parsed)).toEqual({ parameters: { header: {}, body: { "1": "Prévia" }, buttons: { "0": "appointment-123" } }, missing: false });
    expect(parsed).toEqual(before);
  });
  it("recusa URL livre, path traversal, índice inválido e upload sem UUID", () => {
    const parsed = input();
    for (const buttons of [{ "0": "https://foreign.test" }, { "0": "../../private" }, { "10": "value" }, { "0": "%2Fprivate" }]) expect(campaignInputSchema.safeParse({ ...parsed, parameters: { ...parsed.parameters, buttons } }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...parsed, headerUploadId: "foreign-key" }).success).toBe(false);
  });
  it("mantém campanhas antigas sem mídia ou botões com os mesmos parâmetros", () => {
    const parsed = campaignInputSchema.parse({ connectionId: "connection", pipelineId: "pipeline", dealIds: ["deal"], templateId: "template", parameters: { header: {}, body: { "1": "Cliente" } } });
    expect(resolveParameters(parsed).parameters).toEqual({ header: {}, body: { "1": "Cliente" } });
    expect(parsed).not.toHaveProperty("headerUploadId");
  });
});

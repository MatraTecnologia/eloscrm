import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertMediaUrl, isPublicMediaAddress } from "../src/lib/whatsapp-official/media-download.js";
import { buildTemplate } from "../src/modules/whatsapp-outbound/template.js";
import { sendSchema, type TemplateDefinition } from "../src/modules/whatsapp-outbound/outbound.schema.js";

const definition: TemplateDefinition = { id: "123", name: "appointment_notice", language: "pt_BR", category: "UTILITY", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Olá {{1}}" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.com/appointments/{{1}}" }] }] };
const input = () => sendSchema.parse({ type: "template", templateId: "template-fixture", identityId: "identity-fixture", idempotencyKey: randomUUID(), headerUploadId: randomUUID(), parameters: { header: {}, body: { "1": "Cliente fictício" }, buttons: { "0": "appointment-123" } } });

describe("mídia oficial e componentes de templates", () => {
  it("recusa hosts enganosos, redes locais, credencial na URL e downgrade", () => {
    for (const url of ["http://lookaside.fbsbx.com/file", "https://lookaside.fbsbx.com.attacker.test/file", "https://attackerfbcdn.net/file", "https://127.0.0.1/file", "https://user@lookaside.fbsbx.com/file", "https://lookaside.fbsbx.com:8443/file"]) expect(() => assertMediaUrl(url)).toThrow();
    expect(assertMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/").hostname).toBe("lookaside.fbsbx.com");
    expect(assertMediaUrl("https://scontent.example.fbcdn.net/file").hostname).toBe("scontent.example.fbcdn.net");
  });
  it("recusa DNS privado, loopback, metadata, IPv4 mapeado e redes reservadas", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1"]) expect(isPublicMediaAddress(address)).toBe(false);
    expect(isPublicMediaAddress("157.240.1.1")).toBe(true);
    expect(isPublicMediaAddress("2a03:2880::1")).toBe(true);
  });
  it("gera cabeçalho com upload e parâmetros do botão na posição aprovada", () => {
    const parsed = input();
    if (parsed.type !== "template") throw new Error();
    const result = buildTemplate(definition, parsed);
    expect(result.preview).toBe("Olá Cliente fictício");
    expect(result.payload.components).toContainEqual({ type: "header", parameters: [{ type: "image", image: { id: parsed.headerUploadId } }] });
    expect(result.payload.components).toContainEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "appointment-123" }] });
  });
  it("recusa header ausente, parâmetros extras e variáveis de URL fora do contrato", () => {
    const parsed = input();
    if (parsed.type !== "template") throw new Error();
    expect(() => buildTemplate(definition, { ...parsed, headerUploadId: undefined })).toThrow();
    expect(() => buildTemplate(definition, { ...parsed, parameters: { ...parsed.parameters, buttons: { "1": "wrong" } } })).toThrow();
    expect(() => buildTemplate({ ...definition, components: [{ type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.com/{{1}}/extra" }] }] }, parsed)).toThrow();
    expect(() => sendSchema.parse({ ...parsed, parameters: { ...parsed.parameters, buttons: { "0": "../../secret" } } })).toThrow();
  });
  it("mantém templates só texto compatíveis e recusa autenticação", () => {
    const parsed = input();
    if (parsed.type !== "template") throw new Error();
    const textDefinition = { ...definition, components: [{ type: "BODY", text: "Olá {{1}}" }] };
    const textInput = { ...parsed, headerUploadId: undefined, parameters: { header: {}, body: { "1": "Cliente" }, buttons: {} } };
    expect(buildTemplate(textDefinition, textInput).preview).toBe("Olá Cliente");
    expect(() => buildTemplate({ ...textDefinition, category: "AUTHENTICATION" }, textInput)).toThrow();
  });
});

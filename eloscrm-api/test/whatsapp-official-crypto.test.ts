import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import { decryptOfficialToken, encryptOfficialToken } from "../src/lib/whatsapp-official/crypto.js";
import { decryptToken } from "../src/lib/crypto.js";

const context = { organizationId: "org-test", connectionId: "connection-test" };

describe("cifra do WhatsApp oficial", () => {
  it("recupera o segredo somente com o contexto original", () => {
    const token = randomBytes(24).toString("base64url");
    const encrypted = encryptOfficialToken(token, context);
    expect(encrypted).not.toContain(token);
    expect(decryptOfficialToken(encrypted, context)).toBe(token);
    expect(encryptOfficialToken(token, context)).not.toBe(encrypted);
  });

  it("recusa ciphertext copiado para outra imobiliária ou conexão", () => {
    const encrypted = encryptOfficialToken(randomBytes(24).toString("base64url"), context);
    expect(() => decryptOfficialToken(encrypted, { ...context, organizationId: "other-org" })).toThrow();
    expect(() => decryptOfficialToken(encrypted, { ...context, connectionId: "other-connection" })).toThrow();
    expect(() => decryptToken(encrypted)).toThrow();
  });

  it("recusa adulteração e formatos inválidos sem expor o segredo", () => {
    const encrypted = encryptOfficialToken(randomBytes(24).toString("base64url"), context);
    const parts = encrypted.split(".");
    const bytes = Buffer.from(parts[3]!, "base64url");
    bytes[0] ^= 255;
    parts[3] = bytes.toString("base64url");
    for (const payload of [parts.join("."), `${encrypted}.extra`, "v1.a.b.c", "v2.a.b.c"]) {
      expect(() => decryptOfficialToken(payload, context)).toThrow("Não foi possível acessar a credencial");
    }
  });
});

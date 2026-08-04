import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, hashToken, last4, newWebhookSecret } from "../src/lib/crypto.js";

describe("crypto", () => {
  it("faz round-trip do token", () => {
    const token = "123e4567-e89b-12d3-a456-426614174000";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("gera ciphertext diferente a cada chamada (IV aleatório)", () => {
    const token = "mesmo-token";
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  it("rejeita payload adulterado", () => {
    const [iv, tag, ct] = encryptToken("token-original").split(".");
    // troca um byte do ciphertext: a tag do GCM não fecha mais
    const corrupted = Buffer.from(ct!, "base64url");
    corrupted[0] ^= 0xff;
    expect(() => decryptToken(`${iv}.${tag}.${corrupted.toString("base64url")}`)).toThrow();
  });

  it("rejeita formato inválido", () => {
    expect(() => decryptToken("sem-pontos")).toThrow("formato de token cifrado inválido");
    expect(() => decryptToken("aa.bb.cc")).toThrow("iv/tag de tamanho inválido");
  });

  it("hashToken é estável e last4 pega o fim do token", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(last4("token-1234")).toBe("1234");
  });

  it("newWebhookSecret gera segredos distintos e longos", () => {
    const a = newWebhookSecret();
    expect(a).not.toBe(newWebhookSecret());
    // 32 bytes em base64url
    expect(a.length).toBe(43);
  });
});

import { describe, it, expect } from "vitest";
import { phoneKey } from "../src/lib/phone.js";

describe("phoneKey", () => {
  it("casa o formato do CRM com o do WhatsApp apesar do nono dígito", () => {
    // é a razão de existir desta função: os dois são a mesma pessoa
    expect(phoneKey("(43) 99183-4229")).toBe(phoneKey("554391834229"));
    expect(phoneKey("(43) 99183-4229")).toBe("4391834229");
  });

  it("ignora máscara, espaço e o +", () => {
    const alvo = "4398124470";
    for (const entrada of [
      "(43) 99812-4470",
      "43998124470",
      "+55 43 99812-4470",
      "5543998124470",
      " 43 9 9812 4470 ",
    ]) {
      expect(phoneKey(entrada)).toBe(alvo);
    }
  });

  it("preserva o DDD — mesmo número final em DDDs diferentes não colide", () => {
    expect(phoneKey("(11) 99812-4470")).not.toBe(phoneKey("(43) 99812-4470"));
  });

  it("só descarta o 55 quando ele é DDI de um número nacional plausível", () => {
    // 55 como DDD (Rio Grande do Sul) não pode ser comido
    expect(phoneKey("(55) 99999-1234")).toBe("5599991234");
  });

  it("devolve null quando não dá para extrair DDD com segurança", () => {
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey(undefined)).toBeNull();
    expect(phoneKey("")).toBeNull();
    expect(phoneKey("sem número")).toBeNull();
    expect(phoneKey("99812-4470")).toBeNull(); // 8 dígitos, sem DDD
    expect(phoneKey("3324-1234")).toBeNull();
  });

  it("colisão fixo × celular é real e conhecida — por isso o vínculo ambíguo não é automático", () => {
    expect(phoneKey("(43) 3324-1234")).toBe(phoneKey("(43) 93324-1234"));
  });

  it("é estável para número internacional, mesmo sem significado de DDD", () => {
    const us = phoneKey("+1 555 123 4567");
    expect(us).not.toBeNull();
    expect(phoneKey("15551234567")).toBe(us);
  });
});

import { describe, it, expect } from "vitest";
import { formatBytes } from "../src/lib/format.js";

describe("formatBytes", () => {
  it("escreve o tamanho como o usuário lê, com vírgula decimal", () => {
    // o caso que motivou a função: vídeo recusado pelo teto, em bytes crus na tela
    expect(formatBytes(30_808_133)).toBe("29,4 MB");
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
  });

  it("bytes saem inteiros — não existe meio byte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1.023 B");
  });

  it("sobe de unidade na virada exata", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1024 ** 5)).toBe("1 PB");
  });

  it("arredondamento que encosta em 1024 sobe de unidade, em vez de escrever 1024,0 KB", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1 MB");
  });

  it("valor ausente ou inválido vira travessão, não NaN na tela", () => {
    for (const entrada of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(formatBytes(entrada)).toBe("—");
    }
  });

  it("aceita negativo sem inventar unidade", () => {
    expect(formatBytes(-1536)).toBe("-1,5 KB");
  });
});

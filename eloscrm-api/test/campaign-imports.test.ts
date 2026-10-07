import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseImport } from "../src/modules/campaign-imports/imports.service.js";
import { importedAudienceSchema } from "../src/modules/campaign-imports/imports.schema.js";

describe("importação de destinatários sem envio real", () => {
  it("lê os três modelos de download sem perder telefones ou nomes", async () => {
    for (const extension of ["xlsx", "csv", "json"]) {
      const filename = `broadcast-recipients.${extension}`;
      const buffer = await readFile(new URL(`../../eloscrm-web/public/examples/${filename}`, import.meta.url));
      const result = await parseImport(filename, buffer);
      expect(result.valid).toBe(2); expect(result.invalid).toBe(0);
      expect(result.rows[0]).toMatchObject({ name: "Pessoa exemplo", normalizedPhone: "5543999990001" });
    }
  });
  it("mostra linha inválida e telefone repetido sem descartar linhas silenciosamente", async () => {
    const result = await parseImport("contacts.csv", Buffer.from('telefone;nome\r\n"(43) 99999-0001";"Pessoa; exemplo"\r\n5543999990001;Repetida\r\n=1+1;Inválida\r\n'));
    expect(result.valid).toBe(1); expect(result.invalid).toBe(2);
    expect(result.rows[0]?.name).toBe("Pessoa; exemplo");
    expect(result.rows[1]?.error).toContain("repetido"); expect(result.rows[2]?.row).toBe(4);
  });
  it("aceita CSV com vírgulas, aspas escapadas e linhas dentro do nome", async () => {
    const result = await parseImport("contacts.csv", Buffer.from('phone,name\n5543999990001,"Pessoa ""exemplo""\nNome"'));
    expect(result.valid).toBe(1); expect(result.rows[0]?.name).toBe('Pessoa "exemplo"\nNome');
  });
  it("rejeita formato falso, JSON malformado, colunas ambíguas e arquivos excessivos", async () => {
    await expect(parseImport("contacts.xlsx", Buffer.from("not an archive"))).rejects.toMatchObject({ code: "IMPORT_WORKBOOK" });
    await expect(parseImport("contacts.json", Buffer.from('{"phone":"5543999990001"}'))).rejects.toMatchObject({ code: "IMPORT_INVALID" });
    await expect(parseImport("contacts.csv", Buffer.from("phone,telefone\n1,2"))).rejects.toMatchObject({ code: "IMPORT_INVALID" });
    await expect(parseImport("contacts.json", Buffer.alloc(1024 * 1024 + 1))).rejects.toMatchObject({ code: "IMPORT_INVALID" });
    await expect(parseImport("contacts.json", Buffer.from(JSON.stringify(Array.from({ length: 1001 }, () => ({ phone: "5543999990001" })))))).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  });
  it("revalida telefone e limite sem exigir autorização na importação", () => {
    expect(importedAudienceSchema.safeParse({ recipients: [{ phone: "=123", name: "Pessoa" }], consent: { confirmed: true, evidence: "Teste" } }).success).toBe(false);
    expect(importedAudienceSchema.safeParse({ recipients: [{ phone: "5543999990001" }], consent: { confirmed: false, evidence: "Teste" } }).success).toBe(true);
    expect(importedAudienceSchema.safeParse({ recipients: [{ phone: "5543999990001" }] }).success).toBe(true);
    expect(importedAudienceSchema.safeParse({ recipients: Array.from({ length: 201 }, () => ({ phone: "5543999990001" })), consent: { confirmed: true, evidence: "Teste" } }).success).toBe(false);
  });
});

import { readSheet } from "read-excel-file/node";
import { httpError } from "../../lib/http-error.js";
import { normalizePhone } from "./imports.schema.js";
import { validateWorkbook } from "./workbook.js";

const invalid = (message: string) => httpError(422, "IMPORT_INVALID", message);
const headers = (value: unknown) => String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const phoneHeaders = ["phone", "telefone", "numero", "whatsapp", "celular"];
const nameHeaders = ["name", "nome", "contato"];

export const parseCsv = (text: string) => {
  const first = text.split(/\r?\n/, 1)[0]!;
  const separator = first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else if (!cell || quoted) quoted = !quoted;
      else throw invalid("CSV com aspas inválidas");
    } else if (!quoted && (char === separator || char === "\n" || char === "\r")) {
      row.push(cell); cell = "";
      if (char !== separator) { if (char === "\r" && text[index + 1] === "\n") index++; rows.push(row); row = []; }
    } else cell += char;
    if (cell.length > 2000 || row.length > 30 || rows.length > 1001) throw invalid("Use até 1000 linhas, 30 colunas e células de até 2000 caracteres");
  }
  if (quoted) throw invalid("CSV com aspas não fechadas");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

export const parseImport = async (filename: string, buffer: Buffer) => {
  if (!buffer.length || buffer.length > 1024 * 1024) throw invalid("O arquivo deve ter até 1 MiB");
  const extension = filename.toLowerCase().split(".").at(-1);
  let values: { row: number; phone: unknown; name: unknown }[];
  if (extension === "json") {
    let input: unknown;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "")); }
    catch { throw invalid("JSON inválido; use uma lista de objetos com phone e name"); }
    if (!Array.isArray(input) || input.length > 1000) throw invalid("JSON deve ser uma lista com até 1000 destinatários");
    values = input.map((item: unknown, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["phone", "name"].includes(key))) throw invalid(`Item ${index + 1}: use somente phone e name`);
      const value = item as Record<string, unknown>;
      return { row: index + 1, phone: value.phone, name: value.name };
    });
  } else {
    let rows: unknown[][];
    if (extension === "xlsx") {
      validateWorkbook(buffer);
      try { rows = await readSheet(buffer); } catch { throw invalid("Planilha inválida; use o exemplo Excel e salve em .xlsx"); }
    } else if (extension === "csv") {
      try { rows = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "")); }
      catch (error) { if (error instanceof Error && "code" in error) throw error; throw invalid("Salve o CSV com codificação UTF-8"); }
    } else throw invalid("Envie .xlsx, .csv ou .json. Converta arquivos .xls para .xlsx");
    if (rows.length > 1001) throw invalid("Use até 1000 destinatários por arquivo");
    const titles = (rows.shift() ?? []).map(headers);
    const phones = titles.flatMap((title, index) => phoneHeaders.includes(title) ? [index] : []);
    const names = titles.flatMap((title, index) => nameHeaders.includes(title) ? [index] : []);
    if (phones.length !== 1 || names.length > 1) throw invalid("Use uma coluna phone (ou telefone) e, opcionalmente, uma coluna name (ou nome), sem cabeçalhos repetidos");
    values = rows.flatMap((row, index) => row.every(value => value == null || value === "") ? [] : [{ row: index + 2, phone: row[phones[0]!], name: names.length ? row[names[0]!] : "" }]);
  }
  if (!values.length) throw invalid("O arquivo não possui destinatários");
  const seen = new Set<string>();
  const rows = values.map(value => {
    const raw = typeof value.phone === "string" ? value.phone.trim() : typeof value.phone === "number" && Number.isSafeInteger(value.phone) ? String(value.phone) : "";
    const phone = normalizePhone(raw);
    const name = typeof value.name === "string" ? value.name.trim() : value.name == null ? "" : null;
    const error = !phone ? "Telefone inválido: informe DDD e número, com ou sem DDI 55" : name === null || name.length > 120 ? "Nome inválido ou com mais de 120 caracteres" : seen.has(phone) ? "Telefone repetido no arquivo" : null;
    if (!error && phone) seen.add(phone);
    return { row: value.row, phone: raw.slice(0, 40), normalizedPhone: phone, name: name?.slice(0, 120) ?? "", error };
  });
  return { rows, valid: rows.filter(row => !row.error).length, invalid: rows.filter(row => row.error).length, limit: 200 };
};

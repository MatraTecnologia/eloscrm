import { inflateRawSync } from "node:zlib";
import { httpError } from "../../lib/http-error.js";

// Confere o diretório ZIP e os dados descomprimidos antes do parser XML.
export const validateWorkbook = (buffer: Buffer) => {
  const fail = () => { throw httpError(422, "IMPORT_WORKBOOK", "Excel inválido ou excessivo. Use .xlsx com até 1000 destinatários e 30 colunas, sem macros ou fórmulas"); };
  try {
    const maxExpanded = 5 * 1024 * 1024;
    let end = buffer.length - 22;
    while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0 || end + 22 > buffer.length || end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) fail();
    const count = buffer.readUInt16LE(end + 10);
    const directorySize = buffer.readUInt32LE(end + 12);
    const directoryStart = buffer.readUInt32LE(end + 16);
    let offset = directoryStart;
    const directoryEnd = offset + directorySize;
    if (!count || count > 100 || count !== buffer.readUInt16LE(end + 8) || directoryEnd !== end) fail();
    let expanded = 0; let sheet = false;
    const names = new Set<string>();
    for (let index = 0; index < count; index++) {
      if (offset + 46 > directoryEnd || buffer.readUInt32LE(offset) !== 0x02014b50) fail();
      const flags = buffer.readUInt16LE(offset + 8); const method = buffer.readUInt16LE(offset + 10);
      const size = buffer.readUInt32LE(offset + 20); const decodedSize = buffer.readUInt32LE(offset + 24);
      const length = buffer.readUInt16LE(offset + 28); const extra = buffer.readUInt16LE(offset + 30); const comment = buffer.readUInt16LE(offset + 32);
      const local = buffer.readUInt32LE(offset + 42);
      const name = buffer.subarray(offset + 46, offset + 46 + length).toString("utf8");
      if (flags & 1 || ![0, 8].includes(method) || decodedSize > maxExpanded || names.has(name) || /vbaProject|externalLinks/i.test(name) || offset + 46 + length + extra + comment > directoryEnd || local + 30 > end) fail();
      names.add(name);
      if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) fail();
      const localLength = buffer.readUInt16LE(local + 26);
      const start = local + 30 + localLength + buffer.readUInt16LE(local + 28);
      if (buffer.subarray(local + 30, local + 30 + localLength).toString("utf8") !== name || start + size > directoryStart) fail();
      const content = method === 8 ? inflateRawSync(buffer.subarray(start, start + size), { maxOutputLength: maxExpanded }) : buffer.subarray(start, start + size);
      if (content.length !== decodedSize || (expanded += content.length) > maxExpanded) fail();
      if (name.endsWith(".xml")) {
        const xml = content.toString("utf8");
        if (/<!DOCTYPE|<!ENTITY|<f[\s>]/i.test(xml)) fail();
        if (name.startsWith("xl/worksheets/")) {
          sheet = true;
          if ([...xml.matchAll(/<c(?:\s|>)/g)].length > 30030) fail();
          for (const attribute of xml.matchAll(/\b(?:r|ref)\s*=\s*(["'])(.*?)\1/g)) {
            const reference = attribute[2]!.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, code: string) => String.fromCodePoint(code.toLowerCase().startsWith("x") ? Number.parseInt(code.slice(1), 16) : Number(code)));
            if (/^\d+$/.test(reference)) { if (Number(reference) > 1001) fail(); continue; }
            const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(reference);
            if (!match || Number(match[2]) > 1001 || Number(match[4] ?? 0) > 1001 || match[1]!.length > 2 || (match[1]!.length === 2 && match[1]! > "AD") || (match[3] && (match[3].length > 2 || match[3] > "AD"))) fail();
          }
        }
      }
      offset += 46 + length + extra + comment;
    }
    if (!sheet || offset !== directoryEnd) fail();
  } catch { fail(); }
};

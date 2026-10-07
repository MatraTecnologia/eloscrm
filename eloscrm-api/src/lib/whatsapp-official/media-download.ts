import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { OfficialGraphError } from "./graph.js";

export const assertMediaUrl = (value: string) => {
  let url: URL;
  try { url = new URL(value); } catch { throw new OfficialGraphError(null, false); }
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password ||
    !(url.hostname === "lookaside.fbsbx.com" || url.hostname.endsWith(".fbcdn.net"))) throw new OfficialGraphError(null, false);
  return url;
};

export const isPublicMediaAddress = (address: string) => {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a !== undefined && b !== undefined && a > 0 && a < 224 && a !== 10 && a !== 127 &&
      !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && (b === 168 || b === 0 || b === 2)) && !(a === 198 && (b === 18 || b === 19 || b === 51)) && !(a === 203 && b === 0);
  }
  // Apenas unicast global; recusa IPv4 mapeado, loopback, link-local, ULA e redes de documentação.
  return isIP(address) === 6 && /^[23]/i.test(address) && !address.toLowerCase().startsWith("2001:db8:") && !address.toLowerCase().startsWith("2002:");
};

export const downloadOfficialMedia = async (value: string, token: string, maxBytes: number): Promise<Buffer> => {
  const url = assertMediaUrl(value);
  let addresses: { address: string; family: number }[];
  try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); } catch { throw new OfficialGraphError(null, false); }
  if (!addresses.length || addresses.some(entry => !isPublicMediaAddress(entry.address))) throw new OfficialGraphError(null, false);
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    // Fixa o IP validado no socket: uma segunda resolução não pode trocar o destino para uma rede privada.
    const call = request(url, { family: address.family, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, response => {
      const declared = Number(response.headers["content-length"]);
      if (response.statusCode !== 200 || Number.isFinite(declared) && declared > maxBytes) {
        response.destroy(); reject(new OfficialGraphError(null, false)); return;
      }
      // Redirecionamentos são recusados antes de transmitir a credencial para outro destino.
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); reject(new OfficialGraphError(null, false)); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", () => reject(new OfficialGraphError(null, false)));
      response.on("aborted", () => reject(new OfficialGraphError(null, false)));
    });
    call.on("error", () => reject(new OfficialGraphError(null, false)));
    call.end();
  });
};

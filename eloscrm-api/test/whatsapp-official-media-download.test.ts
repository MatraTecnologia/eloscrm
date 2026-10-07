import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: remote.lookup }));
vi.mock("node:https", () => ({ request: remote.request }));
import { downloadOfficialMedia } from "../src/lib/whatsapp-official/media-download.js";

beforeEach(() => { vi.resetAllMocks(); remote.lookup.mockResolvedValue([{ address: "157.240.1.1", family: 4 }]); });
const serve = (chunks: Buffer[], statusCode = 200, headers: Record<string, string> = {}) => {
  remote.request.mockImplementation((_url, _options, callback) => {
    const call = new EventEmitter();
    return Object.assign(call, { end: () => { callback(Object.assign(Readable.from(chunks), { statusCode, headers })); } });
  });
};

describe("download HTTP oficial limitado e sem redirects", () => {
  it("fixa IP validado, mantém TLS hostname e envia Bearer só ao host permitido", async () => {
    const token = randomBytes(24).toString("base64url");
    serve([Buffer.from("fixture")]);
    expect(await downloadOfficialMedia("https://lookaside.fbsbx.com/file", token, 32)).toEqual(Buffer.from("fixture"));
    const [url, options] = remote.request.mock.calls[0]!;
    expect(url.hostname).toBe("lookaside.fbsbx.com");
    expect(options.headers).toEqual({ Authorization: `Bearer ${token}` });
    const callback = vi.fn();
    options.lookup("lookaside.fbsbx.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "157.240.1.1", 4);
    expect(remote.lookup).toHaveBeenCalledTimes(1);
  });
  it("recusa DNS contendo rede privada antes de abrir socket", async () => {
    remote.lookup.mockResolvedValue([{ address: "157.240.1.1", family: 4 }, { address: "169.254.169.254", family: 4 }]);
    await expect(downloadOfficialMedia("https://lookaside.fbsbx.com/file", randomBytes(24).toString("base64url"), 32)).rejects.toThrow();
    expect(remote.request).not.toHaveBeenCalled();
  });
  it("recusa redirect sem consultar segundo destino nem propagar URL", async () => {
    const destination = "http://169.254.169.254/private";
    serve([], 302, { location: destination });
    await expect(downloadOfficialMedia("https://lookaside.fbsbx.com/file", randomBytes(24).toString("base64url"), 32)).rejects.not.toThrow(destination);
    expect(remote.request).toHaveBeenCalledTimes(1);
  });
  it("corta content-length acima do teto e tamanho real excessivo", async () => {
    serve([Buffer.alloc(4)], 200, { "content-length": "100" });
    await expect(downloadOfficialMedia("https://lookaside.fbsbx.com/file", randomBytes(24).toString("base64url"), 4)).rejects.toThrow();
    serve([Buffer.alloc(3), Buffer.alloc(3)]);
    await expect(downloadOfficialMedia("https://lookaside.fbsbx.com/file", randomBytes(24).toString("base64url"), 4)).rejects.toThrow();
  });
});

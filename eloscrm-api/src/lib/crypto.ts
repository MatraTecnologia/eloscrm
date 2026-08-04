import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

const getKey = () => {
  if (!env.UAZAPI_TOKEN_ENCRYPTION_KEY) {
    throw new Error("UAZAPI_TOKEN_ENCRYPTION_KEY não configurada (gere com `openssl rand -hex 32`)");
  }
  return Buffer.from(env.UAZAPI_TOKEN_ENCRYPTION_KEY, "hex");
};

const b64u = (buf: Buffer) => buf.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export const encryptToken = (plaintext: string) => {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${b64u(iv)}.${b64u(cipher.getAuthTag())}.${b64u(ct)}`;
};

export const decryptToken = (payload: string) => {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("formato de token cifrado inválido");
  const iv = fromB64u(ivB64);
  const tag = fromB64u(tagB64);
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) throw new Error("iv/tag de tamanho inválido");
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(fromB64u(ctB64)), decipher.final()]).toString("utf8");
};

export const last4 = (token: string) => token.slice(-4);

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export const newWebhookSecret = () => randomBytes(32).toString("base64url");

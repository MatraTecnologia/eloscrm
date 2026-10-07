import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../env.js";
import { httpError } from "../http-error.js";

type CredentialContext = { organizationId: string; connectionId: string };

const getKey = () => {
  if (!env.META_WHATSAPP_TOKEN_ENCRYPTION_KEY) {
    throw httpError(503, "WHATSAPP_OFFICIAL_NOT_CONFIGURED", "A chave de cifra do WhatsApp oficial não está configurada");
  }
  return Buffer.from(env.META_WHATSAPP_TOKEN_ENCRYPTION_KEY, "hex");
};

const associatedData = (context: CredentialContext) =>
  Buffer.from(JSON.stringify(["whatsapp-official:v1", context.organizationId, context.connectionId]));

export const encryptOfficialToken = (token: string, context: CredentialContext) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  // Vincula o segredo à imobiliária e à conexão, mesmo se o ciphertext for copiado no banco.
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
};

export const decryptOfficialToken = (payload: string, context: CredentialContext) => {
  const key = getKey();
  try {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const iv = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw httpError(503, "WHATSAPP_OFFICIAL_CREDENTIAL_UNAVAILABLE", "Não foi possível acessar a credencial desta conexão do WhatsApp oficial");
  }
};

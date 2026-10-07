import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { env } from "../../env.js";
import { forbidden, httpError } from "../http-error.js";

export const verifyWebhookChallenge = (query: Record<string, unknown>) => {
  const secret = env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!secret) throw httpError(503, "WHATSAPP_OFFICIAL_NOT_CONFIGURED", "O webhook oficial não está configurado");
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (query["hub.mode"] !== "subscribe" || typeof token !== "string" || typeof challenge !== "string" || !/^\d{1,128}$/.test(challenge)) throw forbidden("Desafio de webhook inválido");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(secret), digest(token))) throw forbidden("Verificação do webhook recusada");
  return challenge;
};

export const authenticateOfficialWebhook = (raw: Buffer, signature: unknown) => {
  const secret = env.META_WHATSAPP_APP_SECRET;
  if (!secret) throw httpError(503, "WHATSAPP_OFFICIAL_NOT_CONFIGURED", "O webhook oficial não está configurado");
  if (typeof signature !== "string" || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) throw forbidden("Assinatura do webhook inválida");
  const expected = createHmac("sha256", secret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))) throw forbidden("Assinatura do webhook inválida");
};

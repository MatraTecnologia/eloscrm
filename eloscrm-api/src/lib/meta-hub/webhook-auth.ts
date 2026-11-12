import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../env.js";
import { httpError } from "../http-error.js";

const TOLERANCE_SECONDS = 5 * 60;
const SIGNATURE = /^sha256=[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{1,12}$/;

const unauthorized = () => httpError(401, "HUB_WEBHOOK_SIGNATURE_INVALID", "Assinatura do webhook inválida");
const matches = (secret: string, timestamp: string, raw: Buffer, received: Buffer) => {
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest();
  return timingSafeEqual(expected, received);
};

// x-hub-signature = "sha256=" + hex(HMAC_SHA256(secret, `${x-hub-timestamp}.${corpo cru}`)) (hub:1062).
// Header fora do formato é recusado antes de qualquer HMAC; o anterior só vale durante a rotação.
export const authenticateHubWebhook = (raw: Buffer, timestampHeader: unknown, signatureHeader: unknown, nowSeconds = Math.floor(Date.now() / 1000)) => {
  const secret = env.HUB_WEBHOOK_SECRET;
  if (!secret) throw httpError(503, "HUB_WEBHOOK_NOT_CONFIGURED", "O webhook do Meta Hub não está configurado");
  if (typeof timestampHeader !== "string" || !TIMESTAMP.test(timestampHeader)) throw unauthorized();
  if (typeof signatureHeader !== "string" || !SIGNATURE.test(signatureHeader)) throw unauthorized();
  if (Math.abs(nowSeconds - Number(timestampHeader)) > TOLERANCE_SECONDS) throw unauthorized();
  const received = Buffer.from(signatureHeader.slice(7), "hex");
  const secrets = [secret, env.HUB_WEBHOOK_SECRET_PREVIOUS].filter((value): value is string => Boolean(value));
  // calcula contra todos antes de decidir, para o tempo não revelar qual segredo casou
  const results = secrets.map(value => matches(value, timestampHeader, raw, received));
  if (!results.includes(true)) throw unauthorized();
};

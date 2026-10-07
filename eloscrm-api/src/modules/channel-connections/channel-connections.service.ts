import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict, httpError, notFound } from "../../lib/http-error.js";
import { decryptOfficialToken, encryptOfficialToken } from "../../lib/whatsapp-official/crypto.js";
import * as repo from "./channel-connections.repo.js";
import { verifiedOfficialConnectionSchema, type VerifiedOfficialConnectionInput } from "./channel-connections.schema.js";
import { disableConnection } from "../whatsapp-maintenance/lifecycle.repo.js";
import { AUTOMATION_ACTOR } from "../../lib/actor.js";

export const list = (orgId: string) => repo.list(orgId);

export const get = async (orgId: string, id: string) => {
  const connection = await repo.find(orgId, id);
  if (!connection) throw notFound("Conexão não encontrada nesta imobiliária");
  return connection;
};

// Uso interno após validação remota dos ativos; nenhum endpoint aceita token/IDs do navegador.
export const saveVerifiedOfficialConnection = async (orgId: string, input: VerifiedOfficialConnectionInput) => {
  const { accessToken, ...data } = verifiedOfficialConnectionSchema.parse(input);
  const existing = await repo.findByOfficialNumber(orgId, data.phoneNumberId);
  // A origem das identidades não pode mudar quando o gestor apenas renova a credencial.
  if (existing && (existing.wabaId !== data.wabaId || existing.businessPortfolioId !== data.businessPortfolioId)) {
    throw conflict("WHATSAPP_ASSET_CHANGED", "Os vínculos deste número mudaram; é necessário revisar a conexão");
  }
  const id = existing?.id ?? randomUUID();
  const tokenEnc = encryptOfficialToken(accessToken, { organizationId: orgId, connectionId: id });
  const values = { ...data, tokenEnc, provider: "cloud_api" as const, status: "connected" as const, disabledAt: null };
  try {
    return existing ? await repo.update(orgId, id, values) : await repo.create({ ...values, id, organizationId: orgId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("WHATSAPP_NUMBER_UNAVAILABLE", "Não foi possível cadastrar este número nesta conexão");
    }
    throw error;
  }
};

export const disable = async (orgId: string, id: string) => {
  return (await disableConnection(orgId, id, AUTOMATION_ACTOR)).connection;
};

export const getOfficialCredentials = async (orgId: string, id: string) => {
  const connection = await repo.findCredential(orgId, id);
  if (!connection) throw notFound("Conexão oficial não encontrada nesta imobiliária");
  if (connection.status !== "connected" || !connection.tokenEnc) {
    throw httpError(422, "WHATSAPP_CONNECTION_UNAVAILABLE", "A conexão oficial não está disponível para envio");
  }
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) {
    throw httpError(422, "WHATSAPP_TOKEN_EXPIRED", "A credencial desta conexão expirou; conecte a conta novamente");
  }
  return {
    connectionId: connection.id, phoneNumberId: connection.phoneNumberId,
    wabaId: connection.wabaId, businessPortfolioId: connection.businessPortfolioId,
    accessToken: decryptOfficialToken(connection.tokenEnc, { organizationId: orgId, connectionId: id }),
  };
};

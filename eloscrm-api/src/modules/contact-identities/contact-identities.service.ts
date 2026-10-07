import { Prisma } from "../../generated/prisma/client.js";
import { conflict, httpError, notFound } from "../../lib/http-error.js";
import { get as getConnection } from "../channel-connections/channel-connections.service.js";
import { resolveIdentitySchema, type ResolveIdentityInput } from "./contact-identities.schema.js";
import * as repo from "./contact-identities.repo.js";

export const resolveContactIdentity = async (orgId: string, input: ResolveIdentityInput) => {
  const data = resolveIdentitySchema.parse(input);
  const connection = await getConnection(orgId, data.connectionId);
  const allowedKinds = connection.provider === "cloud_api"
    ? ["phone", "wa_id", "bsuid", "parent_bsuid"]
    : ["phone", "jid", "lid"];
  if (!allowedKinds.includes(data.kind)) throw httpError(422, "WHATSAPP_IDENTITY_INVALID", "Identidade incompatível com esta conexão");
  if (["phone", "wa_id"].includes(data.kind) && !/^\d{10,15}$/.test(data.value)) {
    throw httpError(422, "WHATSAPP_IDENTITY_INVALID", "Informe um telefone completo com DDI e DDD");
  }
  if (connection.provider === "cloud_api" && !connection.businessPortfolioId) {
    throw httpError(422, "WHATSAPP_IDENTITY_SCOPE_MISSING", "A conexão oficial não possui um portfolio validado");
  }
  const scope = connection.provider === "cloud_api" ? `business:${connection.businessPortfolioId}` : `connection:${connection.id}`;
  const key = { kind: data.kind, scope, value: data.value };
  const findExisting = async () => {
    const identity = await repo.find(orgId, key);
    if (!identity) return null;
    if (identity.validUntil && identity.validUntil.getTime() <= Date.now()) throw conflict("WHATSAPP_IDENTITY_RETIRED", "Esta identidade foi substituída e exige revisão");
    return repo.findContact(orgId, identity.contactId);
  };
  const existing = await findExisting();
  if (existing) return existing;
  try {
    return await repo.createContact(orgId, connection.id, key, data.displayName);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // O concorrente venceu; a transação descartou o contato que perderia a corrida.
      const winner = await findExisting();
      if (winner) return winner;
    }
    throw error;
  }
};

export const linkContactToClient = async (orgId: string, contactId: string, clientId: string) => {
  const [contact, client] = await Promise.all([repo.findContact(orgId, contactId), repo.findClient(orgId, clientId)]);
  if (!contact || !client) throw notFound("Contato ou cliente não encontrado nesta imobiliária");
  if (contact.clientId && contact.clientId !== clientId) {
    throw conflict("WHATSAPP_CONTACT_ALREADY_LINKED", "Este contato já está vinculado a outro cliente");
  }
  try {
    const linked = await repo.linkClient(orgId, contactId, clientId);
    if (!linked) throw conflict("WHATSAPP_CONTACT_ALREADY_LINKED", "Este contato foi vinculado a outro cliente; atualize os dados");
    return linked;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("WHATSAPP_CLIENT_ALREADY_LINKED", "Este cliente já possui um contato de atendimento; revise o vínculo");
    }
    throw error;
  }
};

import { notFound } from "../../lib/http-error.js";
import * as repo from "./clients.repo.js";
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from "./clients.schema.js";

export const list = (orgId: string, filters: ListClientsQuery) => repo.listClients(orgId, filters);

export const getById = async (orgId: string, id: string) => {
  const client = await repo.findClient(orgId, id);
  if (!client) throw notFound("Cliente não encontrado");
  return client;
};

export const create = (orgId: string, data: CreateClientInput) => repo.createClient(orgId, data);

export const update = async (orgId: string, id: string, data: UpdateClientInput) => {
  await getById(orgId, id);
  return repo.updateClientById(id, data);
};

export const remove = async (orgId: string, id: string) => {
  await getById(orgId, id);
  await repo.deleteClientById(id);
};

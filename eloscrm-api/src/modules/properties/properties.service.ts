import { notFound } from "../../lib/http-error.js";
import * as repo from "./properties.repo.js";
import type { CreatePropertyInput, ListPropertiesQuery, UpdatePropertyInput } from "./properties.schema.js";

export const list = (orgId: string, filters: ListPropertiesQuery) => repo.listProperties(orgId, filters);

export const getById = async (orgId: string, id: string) => {
  const property = await repo.findProperty(orgId, id);
  if (!property) throw notFound("Imóvel não encontrado");
  return property;
};

export const create = (orgId: string, data: CreatePropertyInput) => repo.createProperty(orgId, data);

export const update = async (orgId: string, id: string, data: UpdatePropertyInput) => {
  await getById(orgId, id);
  return repo.updatePropertyById(id, data);
};

export const remove = async (orgId: string, id: string) => {
  await getById(orgId, id);
  await repo.deletePropertyById(id);
};

import { notFound } from "../../lib/http-error.js";
import { assertStageInOrgPipeline } from "../pipelines/pipelines.service.js";
import * as repo from "./deals.repo.js";
import type { CreateDealInput, ListDealsQuery, UpdateDealInput } from "./deals.schema.js";

export const list = (orgId: string, filters: ListDealsQuery) => repo.listDeals(orgId, filters);

export const getById = async (orgId: string, id: string) => {
  const deal = await repo.findDeal(orgId, id);
  if (!deal) throw notFound("Negócio não encontrado");
  return deal;
};

const ensureRelationsInOrg = async (orgId: string, data: CreateDealInput | UpdateDealInput) => {
  if (data.clientId) {
    const client = await repo.findClientInOrg(orgId, data.clientId);
    if (!client) throw notFound("Cliente não encontrado");
  }
  if (data.propertyId) {
    const property = await repo.findPropertyInOrg(orgId, data.propertyId);
    if (!property) throw notFound("Imóvel não encontrado");
  }
};

export const create = async (orgId: string, data: CreateDealInput) => {
  await ensureRelationsInOrg(orgId, data);
  await assertStageInOrgPipeline(orgId, data.pipelineId, data.stageId);
  return repo.createDeal(orgId, data);
};

export const update = async (orgId: string, id: string, data: UpdateDealInput) => {
  const deal = await getById(orgId, id);
  await ensureRelationsInOrg(orgId, data);
  // mover um negócio é sempre dentro do mesmo pipeline: pipelineId do update é ignorado
  const { pipelineId: _pipelineId, ...rest } = data;
  if (rest.stageId) await assertStageInOrgPipeline(orgId, deal.pipelineId, rest.stageId);
  return repo.updateDealById(id, rest);
};

export const remove = async (orgId: string, id: string) => {
  await getById(orgId, id);
  await repo.deleteDealById(id);
};

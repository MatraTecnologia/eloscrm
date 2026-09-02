import type { IntegrationWithRelations } from "./meta.repo.js";

/** O que sai pela API. Nenhum token, nem o das páginas: só os últimos 4 dígitos do token principal. */
export const serializeIntegration = (integration: IntegrationWithRelations) => ({
  id: integration.id,
  tokenType: integration.tokenType,
  tokenLast4: integration.tokenLast4,
  metaUserName: integration.metaUserName,
  status: integration.status,
  lastError: integration.lastError,
  pipelineId: integration.pipelineId,
  stageId: integration.stageId,
  lastSyncAt: integration.lastSyncAt,
  pages: integration.pages,
  forms: integration.forms.map((form) => ({
    id: form.id,
    formId: form.formId,
    name: form.name,
    remoteStatus: form.remoteStatus,
    enabled: form.enabled,
    pipelineId: form.pipelineId,
    stageId: form.stageId,
    lastLeadAt: form.lastLeadAt,
    leadsCount: form.leadsCount,
    page: form.page,
  })),
  createdAt: integration.createdAt,
  updatedAt: integration.updatedAt,
});

export type SerializedIntegration = ReturnType<typeof serializeIntegration>;

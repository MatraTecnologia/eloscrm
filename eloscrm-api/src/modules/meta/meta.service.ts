import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import * as z from "zod";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { snapshotOf } from "../../lib/audit-snapshot.js";
import { decryptToken, encryptToken, last4 } from "../../lib/crypto.js";
import { forbidden, httpError, notFound } from "../../lib/http-error.js";
import { createMetaGraphClient, MetaGraphError } from "../../lib/meta/index.js";
import { isOrgManager } from "../../lib/org-roles.js";
import { prisma } from "../../lib/prisma.js";
import { metaError, requireIntegrationEnv } from "./meta.gateway.js";
import * as repo from "./meta.repo.js";
import type {
  ConnectMetaInput,
  ListMetaLeadsQuery,
  UpdateMetaFormInput,
  UpdateMetaSettingsInput,
} from "./meta.schema.js";
import { serializeIntegration } from "./meta.serialize.js";
import { syncIntegration } from "./meta.sync.service.js";

const ENTITY_LABEL = "Integração com o Meta";

const requireManager = async (orgId: string, actor: Actor) => {
  if (!(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só o dono ou um gestor da imobiliária pode alterar a integração com o Meta");
  }
};

const requireIntegration = async (orgId: string) => {
  const integration = await repo.findByOrg(orgId);
  if (!integration) throw notFound("Nenhuma conta do Meta conectada nesta imobiliária");
  return integration;
};

/**
 * Valida o destino do lead. Sem conferir a organização, um id chutado apontaria os leads para o
 * funil de outra imobiliária; sem conferir o funil, o estágio de outro funil criaria card órfão.
 * Os dois vêm juntos ou nenhum: metade da configuração é o mesmo que nenhuma, e a tela avisa.
 */
const validateTarget = async (orgId: string, data: { pipelineId: string | null; stageId: string | null }) => {
  if (!data.pipelineId && !data.stageId) return;
  if (!data.pipelineId || !data.stageId) {
    throw httpError(422, "META_TARGET_INCOMPLETE", "Escolha o funil e o estágio, ou nenhum dos dois");
  }
  const stage = await prisma.stage.findFirst({
    where: { id: data.stageId, organizationId: orgId, pipelineId: data.pipelineId },
    select: { id: true },
  });
  if (!stage) throw notFound("Estágio não encontrado neste funil");
};

export const get = async (orgId: string) => {
  const integration = await repo.findByOrg(orgId);
  return integration ? serializeIntegration(integration) : null;
};

/**
 * Busca os formulários de cada página e grava o que mudou. Formulário que já existia mantém a
 * configuração (ligado, destino); formulário que sumiu do Meta é removido daqui — a Graph API não
 * o entregaria mais, e um formulário ligado sem leads possíveis só confunde.
 */
const refreshForms = async (integrationId: string) => {
  const graph = createMetaGraphClient();
  const pages = await prisma.metaPage.findMany({ where: { integrationId } });
  const seen: string[] = [];

  for (const page of pages) {
    const forms = await graph.leadForms(page.pageId, decryptToken(page.tokenEnc)).catch((err) => {
      throw metaError(err, { pageId: page.pageId, name: page.name });
    });
    for (const form of forms) {
      seen.push(form.id);
      await prisma.metaLeadForm.upsert({
        where: { integrationId_formId: { integrationId, formId: form.id } },
        create: {
          integrationId,
          pageId: page.id,
          formId: form.id,
          name: form.name,
          remoteStatus: form.status ?? null,
        },
        update: { name: form.name, remoteStatus: form.status ?? null, pageId: page.id },
      });
    }
  }

  await prisma.metaLeadForm.deleteMany({ where: { integrationId, formId: { notIn: seen } } });
  return seen.length;
};

/**
 * Conecta (ou troca o token de) a conta do Meta.
 *
 * O token é validado contra a Graph API antes de qualquer escrita: `/me` diz quem ele é, e
 * `/me/accounts` entrega as páginas e pode omitir o token próprio ao usar usuário do sistema.
 * Token que não alcança nenhuma página é recusado na hora: sem página não há formulário, e a tela
 * ficaria "conectada" sem nada para ligar.
 */
export const connect = async (orgId: string, data: ConnectMetaInput, actor: Actor) => {
  await requireManager(orgId, actor);
  requireIntegrationEnv();

  const graph = createMetaGraphClient();
  const [me, pages] = await Promise.all([graph.me(data.token), graph.pages(data.token)]).catch(
    (err) => {
      throw metaError(err);
    },
  );
  if (pages.length === 0) {
    throw httpError(
      422,
      "META_NO_PAGES",
      "Este token não tem acesso a nenhuma página do Facebook. Confira as permissões do token.",
    );
  }

  const pageSchema = z.object({ id: z.string().min(1), name: z.string().min(1), access_token: z.string().trim().min(1).nullish() });
  const formSchema = z.array(z.object({ id: z.string().min(1), name: z.string().min(1), status: z.string().optional(), leads_count: z.number().optional() }));
  const deniedPages: { pageId: string; name: string }[] = [];
  const preparedPages = await Promise.all(pages.map(async raw => {
    const parsed = pageSchema.safeParse(raw);
    if (!parsed.success) throw httpError(502, "META_RESPONSE_INVALID", "O Meta retornou dados de página inválidos; tente novamente");
    const page = parsed.data;
    const pageToken = page.access_token ?? (data.tokenType === "system_user" ? data.token : null);
    if (!pageToken) throw httpError(422, "META_PAGE_TOKEN_MISSING", "O Meta não retornou um token para uma das páginas. Confira as permissões ou conecte com um token de usuário do sistema autorizado.");
    // O token do sistema só é salvo para a página após a Graph API confirmar acesso aos formulários.
    const remoteForms = await graph.leadForms(page.id, pageToken).catch(err => {
      if (err instanceof MetaGraphError && (err.graph?.code === 10 || err.graph?.code === 200)) {
        deniedPages.push({ pageId: page.id, name: page.name });
        return null;
      }
      throw metaError(err, { pageId: page.id, name: page.name });
    });
    if (remoteForms === null) return null;
    const forms = formSchema.safeParse(remoteForms);
    if (!forms.success) throw httpError(502, "META_RESPONSE_INVALID", "O Meta retornou dados de formulário inválidos; tente novamente");
    return { pageId: page.id, name: page.name, tokenEnc: encryptToken(pageToken), forms: forms.data };
  }));
  const accessiblePages = preparedPages.filter(page => page !== null);
  const deniedPageNames = deniedPages.map(page => `"${page.name}" (ID ${page.pageId})`).join(", ");
  if (accessiblePages.length === 0) {
    throw httpError(403, "META_PAGE_ACCESS_DENIED", `Nenhuma página permitiu acesso aos formulários. Páginas recusadas: ${deniedPageNames}. Confira os ativos atribuídos, as permissões do token e o Acesso a leads na Meta.`);
  }
  const connectionWarning = deniedPages.length > 0
    ? `Páginas ignoradas por falta de permissão: ${deniedPageNames}. Seus formulários e leads não serão buscados. Após corrigir o acesso na Meta, salve o token novamente para incluí-las.`
    : null;

  const before = await repo.findByOrg(orgId);
  const saved = await repo.saveConnection(orgId, {
    tokenType: data.tokenType, tokenEnc: encryptToken(data.token), tokenLast4: last4(data.token), metaUserId: me.id, metaUserName: me.name, connectionWarning,
  }, accessiblePages);

  await recordAudit({
    orgId,
    entityType: AuditEntity.META_INTEGRATION,
    entityId: saved.id,
    entityLabel: ENTITY_LABEL,
    action: before ? AuditAction.UPDATED : AuditAction.CREATED,
    actor,
    context: { metaUserName: me.name, tokenType: data.tokenType, pages: accessiblePages.length, deniedPages: deniedPages.length },
    snapshot: snapshotOf(AuditEntity.META_INTEGRATION, saved),
  });

  return serializeIntegration((await repo.findByOrg(orgId))!);
};

export const disconnect = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const integration = await requireIntegration(orgId);

  // antes do delete: depois não há mais de onde tirar o snapshot
  await recordAudit({
    orgId,
    entityType: AuditEntity.META_INTEGRATION,
    entityId: integration.id,
    entityLabel: ENTITY_LABEL,
    action: AuditAction.DELETED,
    actor,
    snapshot: snapshotOf(AuditEntity.META_INTEGRATION, integration),
  });
  await prisma.metaIntegration.delete({ where: { id: integration.id } });
};

export const updateSettings = async (orgId: string, data: UpdateMetaSettingsInput, actor: Actor) => {
  await requireManager(orgId, actor);
  const integration = await requireIntegration(orgId);
  await validateTarget(orgId, data);

  await prisma.metaIntegration.update({ where: { id: integration.id }, data });
  await recordAudit({
    orgId,
    entityType: AuditEntity.META_INTEGRATION,
    entityId: integration.id,
    entityLabel: ENTITY_LABEL,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(
      { pipelineId: integration.pipelineId, stageId: integration.stageId },
      { pipelineId: data.pipelineId, stageId: data.stageId },
    ),
  });
  return serializeIntegration((await repo.findByOrg(orgId))!);
};

export const syncForms = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  requireIntegrationEnv();
  const integration = await requireIntegration(orgId);

  const count = await refreshForms(integration.id);
  await recordAudit({
    orgId,
    entityType: AuditEntity.META_INTEGRATION,
    entityId: integration.id,
    entityLabel: ENTITY_LABEL,
    action: AuditAction.SYNCED,
    actor,
    context: { what: "forms", forms: count },
  });
  return serializeIntegration((await repo.findByOrg(orgId))!);
};

/**
 * Liga/desliga um formulário e escolhe o destino dele.
 *
 * Ligar pela primeira vez marca a água em "agora": o cron busca só o que chegar depois. Sem isso,
 * ligar um formulário com meses de campanha despejaria todo o histórico no estágio de entrada.
 */
export const updateForm = async (orgId: string, formId: string, data: UpdateMetaFormInput, actor: Actor) => {
  await requireManager(orgId, actor);
  const integration = await requireIntegration(orgId);
  const form = await repo.findForm(integration.id, formId);
  if (!form) throw notFound("Formulário não encontrado");
  await validateTarget(orgId, data);

  await prisma.metaLeadForm.update({
    where: { id: form.id },
    data: {
      ...data,
      ...(data.enabled && !form.lastLeadAt ? { lastLeadAt: new Date() } : {}),
    },
  });
  await recordAudit({
    orgId,
    entityType: AuditEntity.META_INTEGRATION,
    entityId: integration.id,
    entityLabel: ENTITY_LABEL,
    action: AuditAction.UPDATED,
    actor,
    context: { form: form.name, formId: form.formId },
    changes: diffFields(
      { enabled: form.enabled, pipelineId: form.pipelineId, stageId: form.stageId },
      data,
    ),
  });
  return serializeIntegration((await repo.findByOrg(orgId))!);
};

/** Uma rodada agora, sem esperar o cron — é também o único caminho em dev, onde não há Redis. */
export const syncNow = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  requireIntegrationEnv();
  await requireIntegration(orgId);

  const [syncable] = await repo.listSyncable().then((list) => list.filter((i) => i.organizationId === orgId));
  const ingested = syncable ? await syncIntegration(syncable) : 0;

  const integration = (await repo.findByOrg(orgId))!;
  await recordAudit({
    orgId,
    entityType: AuditEntity.META_INTEGRATION,
    entityId: integration.id,
    entityLabel: ENTITY_LABEL,
    action: AuditAction.SYNCED,
    actor,
    context: { what: "leads", ingested },
  });
  return { ingested, integration: serializeIntegration(integration) };
};

export const listLeads = async (orgId: string, query: ListMetaLeadsQuery) => {
  const leads = await repo.listLeads(orgId, query.limit);
  return leads.map((lead) => ({
    id: lead.id,
    leadgenId: lead.leadgenId,
    createdTime: lead.createdTime,
    receivedAt: lead.receivedAt,
    fieldData: lead.fieldData,
    adName: lead.adName,
    campaignName: lead.campaignName,
    platform: lead.platform,
    clientId: lead.clientId,
    dealId: lead.dealId,
    form: { name: lead.form.name, page: lead.form.page.name },
  }));
};

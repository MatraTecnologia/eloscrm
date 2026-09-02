import { ClientSource, MetaIntegrationStatus } from "../../generated/prisma/client.js";
import { META_ACTOR } from "../../lib/actor.js";
import { decryptToken } from "../../lib/crypto.js";
import { MetaGraphError, createMetaGraphClient, type MetaLeadNode } from "../../lib/meta/index.js";
import { formatBrPhone, phoneKey } from "../../lib/phone.js";
import { prisma } from "../../lib/prisma.js";
import { createWorker, scheduleCron } from "../../lib/queue.js";
import * as clients from "../clients/clients.service.js";
import { resolveOwner } from "../lead-automation/assignment.service.js";
import { createDeal } from "../lead-automation/apply.service.js";
import { extrasToDescription, parseLeadFields } from "./lead-fields.js";
import * as repo from "./meta.repo.js";

export const META_SYNC_QUEUE = "meta-lead-sync";

/** A cada minuto: é a latência que o gestor aceita entre o clique no anúncio e o card no funil. */
const EVERY_MINUTE = "* * * * *";

type SyncableIntegration = Awaited<ReturnType<typeof repo.listSyncable>>[number];
type SyncableForm = SyncableIntegration["forms"][number];
type Target = { pipelineId: string | null; stageId: string | null };

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

/**
 * Registra o lead antes de mexer no CRM. O @unique em `leadgenId` é o que torna a rodada idempotente:
 * duas buscas da mesma janela (retentativa, rodada que atrasou e encavalou na seguinte) disputam
 * esta linha, e só quem a gravou segue para criar lead e card.
 */
const claimLead = async (orgId: string, formDbId: string, node: MetaLeadNode) => {
  try {
    return await prisma.metaLead.create({
      data: {
        organizationId: orgId,
        formId: formDbId,
        leadgenId: node.id,
        createdTime: new Date(node.created_time),
        fieldData: node.field_data ?? [],
        adName: node.ad_name ?? null,
        campaignName: node.campaign_name ?? null,
        platform: node.platform ?? null,
      },
      select: { id: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
};

/**
 * Lead que já existe no CRM não ganha ficha nova. Telefone primeiro, pela mesma chave que casa
 * conversa de WhatsApp com lead; e-mail como segunda chance, porque o formulário do Meta às vezes
 * só pede e-mail. Chave que casa com mais de um lead é ambiguidade que uma pessoa resolve — aqui
 * vale o mesmo que na ingestão do WhatsApp, e o lead nasce novo.
 */
const findExistingClient = async (orgId: string, phone: string | null, email: string | null) => {
  const key = phoneKey(phone);
  if (key) {
    const byPhone = await prisma.client.findMany({
      where: { organizationId: orgId, phoneKey: key },
      select: { id: true, ownerId: true },
      take: 2,
    });
    if (byPhone.length === 1) return byPhone[0]!;
    if (byPhone.length > 1) return null;
  }
  if (!email) return null;
  return prisma.client.findFirst({
    where: { organizationId: orgId, email: { equals: email, mode: "insensitive" } },
    select: { id: true, ownerId: true },
  });
};

const ingestLead = async (orgId: string, form: SyncableForm, node: MetaLeadNode, target: Target) => {
  const claimed = await claimLead(orgId, form.id, node);
  if (!claimed) return false;

  const fields = parseLeadFields(node.field_data);
  const phone = formatBrPhone(fields.phone);
  const existing = await findExistingClient(orgId, phone, fields.email);

  let clientId: string;
  let ownerId: string | null;
  if (existing) {
    clientId = existing.id;
    ownerId = await resolveOwner(orgId, existing.ownerId);
    // lead órfão que voltou por anúncio ganha dono pela roleta, como na ingestão do WhatsApp
    if (ownerId && !existing.ownerId) {
      await prisma.client.update({ where: { id: clientId }, data: { ownerId } });
    }
  } else {
    ownerId = await resolveOwner(orgId, null);
    const client = await clients.create(
      orgId,
      {
        name: fields.name ?? phone ?? fields.email ?? "Lead do Meta",
        email: fields.email ?? undefined,
        phone: phone ?? undefined,
        source: ClientSource.META,
        ownerId: ownerId ?? undefined,
        description: extrasToDescription(fields.extras) ?? undefined,
        notes: [node.campaign_name, node.ad_name].filter(Boolean).join(" · ") || undefined,
        tags: ["meta", form.name].filter(Boolean),
      },
      META_ACTOR,
    );
    clientId = client.id;
  }

  const deal =
    target.pipelineId && target.stageId
      ? await createDeal(orgId, clientId, ownerId, { autoCreateDeal: true, ...target })
      : null;

  await prisma.metaLead.update({
    where: { id: claimed.id },
    data: { clientId, dealId: deal?.id ?? null },
  });
  return true;
};

const targetOf = (integration: SyncableIntegration, form: SyncableForm): Target =>
  form.pipelineId && form.stageId
    ? { pipelineId: form.pipelineId, stageId: form.stageId }
    : { pipelineId: integration.pipelineId, stageId: integration.stageId };

// o filtro da Graph API é em segundos inteiros: recuar um segundo evita perder o lead criado no
// mesmo segundo da marca d'água, e o que voltar repetido morre no @unique
const sinceOf = (form: SyncableForm) =>
  form.lastLeadAt ? new Date(form.lastLeadAt.getTime() - 1000) : null;

const syncForm = async (integration: SyncableIntegration, form: SyncableForm) => {
  const graph = createMetaGraphClient();
  const nodes = await graph.leads(form.formId, decryptToken(form.page.tokenEnc), sinceOf(form));
  nodes.sort((a, b) => a.created_time.localeCompare(b.created_time));

  const target = targetOf(integration, form);
  let ingested = 0;
  let newest = form.lastLeadAt;
  for (const node of nodes) {
    if (await ingestLead(integration.organizationId, form, node, target)) ingested++;
    const created = new Date(node.created_time);
    if (!newest || created > newest) newest = created;
  }

  await prisma.metaLeadForm.update({
    where: { id: form.id },
    data: { lastLeadAt: newest, leadsCount: { increment: ingested } },
  });
  return ingested;
};

/**
 * Uma rodada de uma integração. Token recusado desliga a integração até alguém trocar o token —
 * insistir a cada minuto com token morto só acumula erro. Outra falha fica em `lastError`, visível
 * na tela, e a rodada seguinte tenta de novo.
 */
export const syncIntegration = async (integration: SyncableIntegration) => {
  let ingested = 0;
  let lastError: string | null = null;

  for (const form of integration.forms) {
    try {
      ingested += await syncForm(integration, form);
    } catch (err) {
      if (err instanceof MetaGraphError && err.tokenInvalid) {
        await prisma.metaIntegration.update({
          where: { id: integration.id },
          data: { status: MetaIntegrationStatus.token_invalid, lastError: err.message, lastSyncAt: new Date() },
        });
        return ingested;
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  await prisma.metaIntegration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date(), lastError },
  });
  return ingested;
};

export const syncAll = async () => {
  let ingested = 0;
  for (const integration of await repo.listSyncable()) {
    ingested += await syncIntegration(integration);
  }
  return ingested;
};

createWorker(
  META_SYNC_QUEUE,
  async () => {
    await syncAll();
  },
  1,
);

/** Chamado no boot do servidor. Sem Redis não agenda nada; a rotina é `pnpm meta:sync`. */
export const scheduleMetaLeadSync = () =>
  scheduleCron(META_SYNC_QUEUE, "every-minute", EVERY_MINUTE, "America/Sao_Paulo");

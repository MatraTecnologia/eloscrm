import type { Actor } from "../../lib/actor.js";
import { forbidden, httpError, notFound } from "../../lib/http-error.js";
import { isOrgOwner } from "../../lib/org-roles.js";
import { prisma } from "../../lib/prisma.js";
import { purgeOrganizationAssets } from "../audit/organization-purge.service.js";

const requireOwner = async (orgId: string, actor: Actor) => {
  if (!(await isOrgOwner(orgId, actor.id))) {
    throw forbidden("Só o dono da imobiliária pode excluí-la");
  }
};

const requireOrg = async (orgId: string) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) throw notFound("Imobiliária não encontrada");
  return org;
};

/**
 * Inventário do que a exclusão vai levar.
 *
 * A tela mostra estes números antes de pedir confirmação, então eles são a promessa que o sistema faz
 * ao dono — e é por isso que a lista sai das **13 relações `Cascade`** de `Organization` mais as duas
 * coisas que o cascade não alcança: os objetos no R2 e a instância na uazapi.
 */
export const deletionPreview = async (orgId: string, actor: Actor) => {
  await requireOwner(orgId, actor);
  const org = await requireOrg(orgId);

  const where = { organizationId: orgId };
  const [
    clients,
    deals,
    activities,
    properties,
    pipelines,
    stages,
    comments,
    attachments,
    conversations,
    whatsappMessages,
    members,
    invitations,
    auditEvents,
    leadAutomation,
    instance,
    anexoBytes,
    midiaBytes,
    midiaCount,
  ] = await Promise.all([
    prisma.client.count({ where }),
    prisma.deal.count({ where }),
    prisma.activity.count({ where }),
    prisma.property.count({ where }),
    prisma.pipeline.count({ where }),
    prisma.stage.count({ where }),
    prisma.comment.count({ where }),
    prisma.attachment.count({ where }),
    prisma.conversation.count({ where }),
    prisma.whatsappMessage.count({ where }),
    prisma.member.count({ where }),
    prisma.invitation.count({ where }),
    prisma.auditEvent.count({ where }),
    prisma.leadAutomation.count({ where }),
    prisma.uazapiInstance.findUnique({
      where: { organizationId: orgId },
      select: { name: true, status: true, ownerJid: true },
    }),
    prisma.attachment.aggregate({ where, _sum: { size: true } }),
    prisma.whatsappMessage.aggregate({
      where: { ...where, mediaKey: { not: null } },
      _sum: { mediaSize: true },
    }),
    prisma.whatsappMessage.count({ where: { ...where, mediaKey: { not: null } } }),
  ]);

  return {
    organization: org,
    counts: {
      clients,
      deals,
      activities,
      properties,
      pipelines,
      stages,
      comments,
      attachments,
      conversations,
      whatsappMessages,
      members,
      invitations,
      auditEvents,
      leadAutomation,
    },
    // o que sai do bucket: são objetos pagos, e o dono precisa ver o volume antes de confirmar
    storage: {
      objects: attachments + midiaCount,
      bytes: (anexoBytes._sum.size ?? 0) + (midiaBytes._sum.mediaSize ?? 0),
    },
    // a conexão é apagada no provedor, não só aqui: o número precisa ler o QR Code de novo depois
    whatsapp: instance ? { name: instance.name, status: instance.status, connected: !!instance.ownerJid } : null,
  };
};

/**
 * Exclui a imobiliária e tudo que é dela.
 *
 * Rota própria, e o endpoint de exclusão do Better Auth fica **desligado**
 * (`disableOrganizationDeletion` em `lib/auth.ts`), por dois motivos que o dele não cobre: exigir a
 * confirmação digitada no servidor — sem isso o "digite o slug" da tela é só teatro, porque qualquer
 * chamada direta à API pularia a etapa — e garantir que a purga do R2 e da uazapi aconteça antes do
 * delete, no mesmo caminho.
 */
export const remove = async (orgId: string, confirm: string, actor: Actor) => {
  await requireOwner(orgId, actor);
  const org = await requireOrg(orgId);

  if (confirm.trim() !== org.slug) {
    throw httpError(
      422,
      "CONFIRMATION_MISMATCH",
      "A confirmação não corresponde ao identificador da imobiliária",
      { expected: org.slug },
    );
  }

  // antes do delete: depois dele não há mais chave de objeto nem token de instância para usar
  const purged = await purgeOrganizationAssets(orgId);
  await prisma.organization.delete({ where: { id: orgId } });

  return { organization: org, purged };
};

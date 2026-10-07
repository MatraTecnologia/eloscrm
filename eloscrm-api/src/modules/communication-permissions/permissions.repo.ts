import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../lib/http-error.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const client = (orgId: string, clientId: string, db: Prisma.TransactionClient = prisma) => db.client.findFirst({ where: { organizationId: orgId, id: clientId }, select: { id: true, phoneKey: true, communicationPermission: { select: { state: true, revision: true, phoneKey: true } } } });
export const suppressed = async (orgId: string, clientId: string, recipientPhoneKey?: string | null, db: Prisma.TransactionClient = prisma) => {
  const current = await client(orgId, clientId, db);
  if (!current) return true;
  const keys = [...new Set([current.phoneKey, recipientPhoneKey].filter((key): key is string => Boolean(key)))];
  if (await db.communicationPermission.findFirst({ where: { organizationId: orgId, state: "suppressed", OR: [{ clientId }, { phoneKey: { in: keys } }, { client: { organizationId: orgId, phoneKey: { in: keys } } }] }, select: { id: true } })) return true;
  // Mudar o telefone do cadastro não revoga o descadastro já registrado para o número anterior.
  for (const key of keys) {
    const latest = await db.communicationPermissionRevision.findFirst({ where: { organizationId: orgId, phoneKey: key }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { state: true } });
    if (latest?.state === "suppressed") return true;
  }
  return false;
};
export const allowed = async (orgId: string, clientId: string, recipientPhoneKey?: string | null, db: Prisma.TransactionClient = prisma) => {
  const current = await client(orgId, clientId, db); const permission = current?.communicationPermission;
  return permission?.state === "allowed" && permission.phoneKey === current?.phoneKey && (!recipientPhoneKey || permission.phoneKey === recipientPhoneKey) && !await suppressed(orgId, clientId, recipientPhoneKey, db);
};
export const get = (orgId: string, clientId: string) => prisma.communicationPermission.findFirst({ where: { organizationId: orgId, clientId }, select: { state: true, evidence: true, revision: true, updatedAt: true } });
export const save = (orgId: string, clientId: string, input: { state: string; evidence: string }, actor: Actor) => prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`permissions:${orgId}`}, 0))`;
  const current = await tx.client.findFirst({ where: { organizationId: orgId, id: clientId }, select: { id: true, phoneKey: true } });
  if (!current) throw notFound("Lead não encontrado nesta imobiliária");
  const previous = await tx.communicationPermission.findFirst({ where: { organizationId: orgId, clientId } });
  const revision = (previous?.revision ?? 0) + 1;
  const data = { ...input, phoneKey: current.phoneKey, recordedById: actor.id, revision };
  const saved = await tx.communicationPermission.upsert({ where: { clientId }, create: { organizationId: orgId, clientId, ...data }, update: data });
  await tx.communicationPermissionRevision.create({ data: { organizationId: orgId, permissionId: saved.id, ...data } });
  await recordAudit({ orgId, actor, entityType: "CLIENT", entityId: clientId, action: "UPDATED", context: { permissionId: saved.id, permissionState: input.state, permissionRevision: revision } }, tx);
  return { state: saved.state, evidence: saved.evidence, revision, updatedAt: saved.updatedAt };
});

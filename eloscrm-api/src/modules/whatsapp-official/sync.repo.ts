import { AuditAction, AuditEntity, type ChannelConnection } from "../../generated/prisma/client.js";
import * as z from "zod";
import { recordAudit } from "../../lib/audit.js";
import { WEBHOOK_ACTOR } from "../../lib/actor.js";
import { httpError } from "../../lib/http-error.js";
import { objectOf, stringOf } from "./webhook.schema.js";
import { eventDate } from "./message-parser.js";
import { resolveAliases, withConnectionLock } from "./identity.repo.js";

export const ingestContactSync = async (connection: ChannelConnection, item: Record<string, unknown>) => {
  if (item.type !== "contact" || !["add", "remove"].includes(String(item.action))) throw httpError(422, "OFFICIAL_SYNC_UNSUPPORTED", "Evento de sincronização desconhecido");
  const contact = objectOf(item.contact);
  const phone = stringOf(contact.phone_number);
  if (!phone) throw httpError(422, "OFFICIAL_IDENTITY_MISSING", "O contato não possui identidade suficiente");
  await withConnectionLock(connection, async tx => {
    const resolved = await resolveAliases(tx, connection, [{ kind: "wa_id", value: phone }], stringOf(contact.full_name)?.slice(0, 200));
    // Remover da agenda não apaga histórico, vínculo ou cadastro do CRM.
    if (item.action === "add" && stringOf(contact.full_name)) await tx.messagingContact.updateMany({
      where: { id: resolved.id, organizationId: connection.organizationId }, data: { displayName: stringOf(contact.full_name)!.slice(0, 200) },
    });
  });
};

export const ingestIdentityUpdate = async (connection: ChannelConnection, item: Record<string, unknown>, receivedAt: Date) => {
  const update = objectOf(item.user_id);
  const identityValue = z.string().min(1).max(256).refine(value => !/\s/.test(value));
  const previous = identityValue.parse(update.previous);
  const current = identityValue.parse(update.current);
  if (!previous || !current || previous === current) throw httpError(422, "OFFICIAL_IDENTITY_UPDATE_INVALID", "Atualização de identidade inválida");
  const occurredAt = eventDate(item.timestamp, receivedAt);
  await withConnectionLock(connection, async tx => {
    const scope = `business:${connection.businessPortfolioId}`;
    const oldAlias = await tx.contactIdentity.findFirst({ where: { organizationId: connection.organizationId, scope, kind: "bsuid", value: previous } });
    if (!oldAlias) throw httpError(409, "OFFICIAL_IDENTITY_UPDATE_UNRESOLVED", "A identidade anterior precisa ser revisada");
    const newAlias = await tx.contactIdentity.findFirst({ where: { organizationId: connection.organizationId, scope, kind: "bsuid", value: current } });
    if (newAlias && newAlias.contactId !== oldAlias.contactId) throw httpError(409, "OFFICIAL_IDENTITY_CONFLICT", "A nova identidade pertence a outro contato");
    await tx.contactIdentity.createMany({ data: [{
      organizationId: connection.organizationId, connectionId: connection.id, contactId: oldAlias.contactId,
      kind: "bsuid", scope, value: current, source: "user_id_update", validFrom: occurredAt,
    }], skipDuplicates: true });
    const savedAlias = await tx.contactIdentity.findFirstOrThrow({ where: { organizationId: connection.organizationId, scope, kind: "bsuid", value: current } });
    if (savedAlias.contactId !== oldAlias.contactId) throw httpError(409, "OFFICIAL_IDENTITY_CONFLICT", "A nova identidade pertence a outro contato");
    await tx.contactIdentity.updateMany({ where: { id: oldAlias.id, organizationId: connection.organizationId, validUntil: null }, data: { validUntil: occurredAt } });
    if (item.parent_user_id) {
      const parent = objectOf(item.parent_user_id);
      const parentPrevious = identityValue.parse(parent.previous);
      const parentCurrent = identityValue.parse(parent.current);
      const parentOld = await tx.contactIdentity.findFirst({ where: { organizationId: connection.organizationId, scope, kind: "parent_bsuid", value: parentPrevious } });
      const parentNew = await tx.contactIdentity.findFirst({ where: { organizationId: connection.organizationId, scope, kind: "parent_bsuid", value: parentCurrent } });
      if ((parentOld && parentOld.contactId !== oldAlias.contactId) || (parentNew && parentNew.contactId !== oldAlias.contactId)) throw httpError(409, "OFFICIAL_IDENTITY_CONFLICT", "A identidade parent pertence a outro contato");
      await tx.contactIdentity.createMany({ data: [{
        organizationId: connection.organizationId, connectionId: connection.id, contactId: oldAlias.contactId,
        kind: "parent_bsuid", scope, value: parentCurrent, source: "user_id_update", validFrom: occurredAt,
      }], skipDuplicates: true });
      const savedParent = await tx.contactIdentity.findFirstOrThrow({ where: { organizationId: connection.organizationId, scope, kind: "parent_bsuid", value: parentCurrent } });
      if (savedParent.contactId !== oldAlias.contactId) throw httpError(409, "OFFICIAL_IDENTITY_CONFLICT", "A identidade parent pertence a outro contato");
      if (parentPrevious !== parentCurrent) await tx.contactIdentity.updateMany({ where: { organizationId: connection.organizationId, scope, kind: "parent_bsuid", value: parentPrevious, validUntil: null }, data: { validUntil: occurredAt } });
    }
    if (!oldAlias.validUntil) await recordAudit({
      orgId: connection.organizationId, entityType: AuditEntity.ORGANIZATION, entityId: connection.organizationId,
      action: AuditAction.WEBHOOK_RECONCILED, actor: WEBHOOK_ACTOR,
      context: { connectionId: connection.id, messagingContactId: oldAlias.contactId, operation: "user_id_update" },
    }, tx);
  });
};

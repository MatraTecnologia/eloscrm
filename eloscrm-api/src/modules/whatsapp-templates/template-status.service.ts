import * as z from "zod";
import type { ChannelConnection, OfficialWebhookEvent } from "../../generated/prisma/client.js";
import { conflict } from "../../lib/http-error.js";
import { syncTemplates } from "../whatsapp-outbound/outbound.service.js";
import * as repo from "./templates.repo.js";

const statusSchema = z.looseObject({
  event: z.enum(["APPROVED", "ARCHIVED", "DELETED", "DISABLED", "FLAGGED", "IN_APPEAL", "LIMIT_EXCEEDED", "LOCKED", "PAUSED", "PENDING", "REINSTATED", "PENDING_DELETION", "REJECTED"]),
  message_template_id: z.union([z.string().regex(/^\d{1,40}$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)]),
  message_template_name: z.string().min(1).max(512),
  message_template_language: z.string().min(1).max(32),
  message_template_category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional(),
  reason: z.string().max(256).nullish(),
  rejection_info: z.looseObject({ reason: z.string().max(4096).optional(), recommendation: z.string().max(4096).optional() }).nullish(),
});

export const processTemplateStatus = async (event: OfficialWebhookEvent, connection: Pick<ChannelConnection, "id" | "organizationId">) => {
  const data = statusSchema.parse(event.payload);
  if (!await repo.findExternal(connection.organizationId, event.wabaId, data.message_template_id)) {
    if (data.event === "DELETED") return;
    await syncTemplates(connection.organizationId, connection.id);
  }
  const rejected = data.event === "REJECTED";
  const count = await repo.applyStatus(connection.organizationId, event.wabaId, data.message_template_id, {
    status: data.event === "DELETED" ? "MISSING" : data.event === "REINSTATED" ? "APPROVED" : data.event,
    category: data.message_template_category,
    statusEventAt: event.occurredAt ?? event.receivedAt,
    statusUpdatedAt: event.receivedAt,
    rejectionReason: rejected && data.reason !== "NONE" ? data.reason ?? null : null,
    rejectionDetail: rejected ? data.rejection_info?.reason ?? null : null,
    rejectionRecommendation: rejected ? data.rejection_info?.recommendation ?? null : null,
  });
  if (!count) throw conflict("OFFICIAL_TEMPLATE_NOT_FOUND", "O template do evento não foi encontrado na conta WhatsApp");
};

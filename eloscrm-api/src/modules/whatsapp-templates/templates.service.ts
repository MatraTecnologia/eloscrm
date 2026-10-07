import * as z from "zod";
import { forbidden, httpError, notFound } from "../../lib/http-error.js";
import * as graph from "../../lib/whatsapp-official/graph.js";
import { getOfficialCredentials } from "../channel-connections/channel-connections.service.js";
import * as outbound from "../whatsapp-outbound/outbound.repo.js";
import { createTemplateSchema } from "./templates.schema.js";
import * as repo from "./templates.repo.js";

export const requireManager = async (orgId: string, userId: string) => {
  const member = await repo.membership(orgId, userId);
  if (!member || !["owner", "admin"].includes(member.role)) throw forbidden("Somente gestores podem gerenciar templates");
};
const providerError = (error: unknown): never => {
  if (!(error instanceof graph.OfficialGraphError)) throw error;
  throw httpError(502, "OFFICIAL_TEMPLATE_OPERATION_FAILED", error.uncertain ? "Não foi possível confirmar a operação na Meta. Sincronize os templates antes de tentar novamente." : `A Meta recusou a operação${error.code === null ? "" : ` (código ${error.code})`}. Confira as permissões e os dados do template.`);
};
export const create = async (orgId: string, connectionId: string, userId: string, input: unknown) => {
  await requireManager(orgId, userId);
  const data = createTemplateSchema.parse(input);
  const credentials = await getOfficialCredentials(orgId, connectionId);
  const components: Record<string, unknown>[] = [
    ...(data.header ? [{ type: "HEADER", format: "TEXT", text: data.header }] : []),
    { type: "BODY", text: data.body, ...(data.examples.length ? { example: { body_text: [data.examples] } } : {}) },
    ...(data.footer ? [{ type: "FOOTER", text: data.footer }] : []),
  ];
  let response;
  try { response = z.object({ id: z.string().regex(/^\d+$/), status: z.string().default("PENDING"), category: z.string().optional() }).parse(await graph.createTemplate(credentials.accessToken, credentials.wabaId!, { name: data.name, language: data.language, category: data.category, components })); }
  catch (error) { if (error instanceof z.ZodError) throw httpError(502, "OFFICIAL_TEMPLATE_RESPONSE_INVALID", "A Meta retornou uma resposta inesperada. Sincronize os templates antes de tentar novamente."); return providerError(error); }
  return repo.save(orgId, credentials.wabaId!, { id: response.id, name: data.name, language: data.language, category: response.category ?? data.category, status: response.status, components });
};
export const remove = async (orgId: string, connectionId: string, id: string, userId: string) => {
  await requireManager(orgId, userId);
  const credentials = await getOfficialCredentials(orgId, connectionId);
  const template = await outbound.template(orgId, credentials.wabaId!, id);
  if (!template) throw notFound("Template não encontrado nesta conta WhatsApp");
  try { z.object({ success: z.literal(true) }).parse(await graph.deleteTemplate(credentials.accessToken, credentials.wabaId!, template.externalId, template.name)); }
  catch (error) { if (error instanceof z.ZodError) throw httpError(502, "OFFICIAL_TEMPLATE_RESPONSE_INVALID", "A exclusão não foi confirmada. Sincronize antes de tentar novamente."); return providerError(error); }
  await repo.markDeleted(orgId, credentials.wabaId!, id);
  return { ok: true };
};

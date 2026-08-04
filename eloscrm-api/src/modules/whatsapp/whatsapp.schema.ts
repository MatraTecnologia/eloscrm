import * as z from "zod";

export const createInstanceSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
});

export const renameInstanceSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const connectInstanceSchema = z.object({
  // informar o telefone troca o QR code por um código de pareamento de 8 dígitos
  phone: z
    .string()
    .trim()
    .regex(/^\d{10,15}$/, "informe só os dígitos, com DDI e DDD")
    .optional(),
});

export const listLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

export const webhookParamsSchema = z.object({
  instanceId: z.string().min(1),
  secret: z.string().min(1),
});

/**
 * O envelope entregue pela uazapi **não está na spec**: `paths/webhooks-e-sse/webhook.yaml` só
 * documenta a configuração do webhook, sem `callbacks` nem exemplo do corpo. As três fontes que
 * temos discordam entre si — o consumidor do `matra-notification-manager` lê `EventType`/`token`
 * (mas ali o webhook era global, e o token era o único jeito de saber a instância);
 * `schemas/webhook_event.yaml` declara `event`/`instance`/`data`; o SSE usa `type`/`data`.
 *
 * Como o formato é palpite, o schema aceita os três nomes e **não exige nenhum**: rejeitar o corpo
 * derrubaria todos os eventos em silêncio, e o sintoma só apareceria em `/webhook/errors` da uazapi.
 * A autenticação de verdade é o segredo de 32 bytes na URL; o hash do token é defesa em
 * profundidade e só é conferido quando o campo vem.
 */
export const webhookBodySchema = z.looseObject({
  EventType: z.string().min(1).optional(),
  event: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
  // objeto na forma do matra-notification-manager, string (id) na forma do webhook_event.yaml
  instance: z.union([z.string(), z.looseObject({})]).optional(),
  data: z.looseObject({}).optional(),
});

export const eventNameOf = (body: WebhookBody) => body.EventType ?? body.event ?? body.type ?? null;

/** O payload da conexão vem em `instance` (objeto) ou em `data`, conforme a forma do envelope. */
export const connectionDataOf = (body: WebhookBody): Record<string, unknown> => {
  if (body.instance && typeof body.instance === "object") return body.instance;
  if (body.data) return body.data;
  return {};
};

export type CreateInstanceInput = z.infer<typeof createInstanceSchema>;
export type RenameInstanceInput = z.infer<typeof renameInstanceSchema>;
export type ConnectInstanceInput = z.infer<typeof connectInstanceSchema>;
export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;
export type WebhookBody = z.infer<typeof webhookBodySchema>;

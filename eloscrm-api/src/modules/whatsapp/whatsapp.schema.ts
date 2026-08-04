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

export const testSendSchema = z.object({
  number: z
    .string()
    .trim()
    .regex(/^\d{10,15}$/, "informe só os dígitos, com DDI e DDD"),
  text: z.string().trim().min(1).max(1000),
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
 *
 * ⚠️ Foi exatamente isso que aconteceu: tipar `event` como string derrubou **todo**
 * `messages_update` com 422 durante horas, sem sintoma nenhum do nosso lado. Em `messages_update`,
 * `event` é o **payload** (objeto com `MessageIDs`, `Chat`, `Sender`) e `type` é o **subtipo**
 * (`ReadReceipt`) — não sinônimos de `EventType`, como o resto deste schema supunha. Campo novo
 * aqui entra permissivo; o custo de errar para o lado rígido é perder eventos calado.
 */
export const webhookBodySchema = z.looseObject({
  EventType: z.string().min(1).optional(),
  // string quando é o nome do evento; objeto quando é o payload do messages_update
  event: z.union([z.string(), z.looseObject({})]).optional(),
  type: z.string().min(1).optional(),
  // messages_update: "Delivered" | "Read"
  state: z.string().optional(),
  token: z.string().min(1).optional(),
  // objeto na forma do matra-notification-manager, string (id) na forma do webhook_event.yaml
  instance: z.union([z.string(), z.looseObject({})]).optional(),
  data: z.looseObject({}).optional(),
  // observados no envelope real (v2.1.1): `owner` fica no TOPO, não dentro de `instance`
  owner: z.string().optional(),
  instanceName: z.string().optional(),
  BaseUrl: z.string().optional(),
});

/** `event`/`type` só valem como nome do evento quando são string — ver o aviso acima. */
export const eventNameOf = (body: WebhookBody): string | null => {
  if (body.EventType) return body.EventType;
  if (typeof body.event === "string") return body.event;
  if (typeof body.type === "string") return body.type;
  return null;
};

/**
 * O payload da conexão vem em `instance` (objeto) ou em `data`, conforme a forma do envelope.
 *
 * `owner` (o JID do número conectado) chega no **topo** do envelope, fora de `instance` — observado
 * no tráfego real da v2.1.1. Sem trazê-lo para dentro, `applyInstanceSnapshot` procuraria
 * `instance.owner`, não acharia, e `ownerJid` só seria preenchido pelo botão Sincronizar.
 */
export const connectionDataOf = (body: WebhookBody): Record<string, unknown> => {
  const base =
    body.instance && typeof body.instance === "object" ? body.instance : (body.data ?? {});
  if (base.owner === undefined && body.owner !== undefined) return { ...base, owner: body.owner };
  return base;
};

export type CreateInstanceInput = z.infer<typeof createInstanceSchema>;
export type RenameInstanceInput = z.infer<typeof renameInstanceSchema>;
export type ConnectInstanceInput = z.infer<typeof connectInstanceSchema>;
export type TestSendInput = z.infer<typeof testSendSchema>;
export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;
export type WebhookBody = z.infer<typeof webhookBodySchema>;

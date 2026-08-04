import {
  Prisma,
  type UazapiInstance,
  type UazapiInstanceLogEvent,
  type UazapiInstanceLogSource,
  type UazapiInstanceStatus,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

// A resposta de connect/status traz instance.token em claro. Guardar o payload cru no log gravaria
// o token em texto puro no banco — a limpeza mora aqui, e não em cada call site, justamente porque
// uma chamada esquecida bastaria para vazar.
const SECRET_KEYS = new Set(["token", "admintoken", "apikey", "openai_apikey"]);

export const omitSecrets = (value: unknown): Prisma.InputJsonValue => {
  if (Array.isArray(value)) return value.map(omitSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(key.toLowerCase())) continue;
      out[key] = omitSecrets(v);
    }
    return out;
  }
  return value as Prisma.InputJsonValue;
};

export const findByOrg = (orgId: string) =>
  prisma.uazapiInstance.findUnique({ where: { organizationId: orgId } });

export const findById = (id: string) => prisma.uazapiInstance.findUnique({ where: { id } });

export const create = (data: Prisma.UazapiInstanceUncheckedCreateInput) =>
  prisma.uazapiInstance.create({ data });

export const update = (id: string, data: Prisma.UazapiInstanceUpdateInput) =>
  prisma.uazapiInstance.update({ where: { id }, data });

export const remove = (id: string) => prisma.uazapiInstance.delete({ where: { id } });

export type LogArgs = {
  instanceId: string;
  event: UazapiInstanceLogEvent;
  source: UazapiInstanceLogSource;
  actorUserId?: string | null;
  previousStatus?: UazapiInstanceStatus | null;
  newStatus?: UazapiInstanceStatus | null;
  message?: string | null;
  payload?: unknown;
};

const logData = (args: LogArgs) => ({
  instanceId: args.instanceId,
  event: args.event,
  source: args.source,
  actorUserId: args.actorUserId ?? null,
  previousStatus: args.previousStatus ?? null,
  newStatus: args.newStatus ?? null,
  message: args.message ?? null,
  payload: args.payload === undefined ? Prisma.JsonNull : omitSecrets(args.payload),
});

export const writeLog = (args: LogArgs) => prisma.uazapiInstanceLog.create({ data: logData(args) });

/** Estado e log na mesma transação: um log sem a mudança correspondente é pior que log nenhum. */
export const updateAndLog = async (
  id: string,
  data: Prisma.UazapiInstanceUpdateInput,
  log: LogArgs,
): Promise<UazapiInstance> => {
  const [updated] = await prisma.$transaction([
    prisma.uazapiInstance.update({ where: { id }, data }),
    prisma.uazapiInstanceLog.create({ data: logData(log) }),
  ]);
  return updated;
};

// `select` explícito, não `findMany` cru: `payload` guarda a resposta bruta da uazapi para
// diagnóstico e pode conter URL de webhook (com segredo) ou campo novo que ninguém revisou. O front
// não usa esse campo — quem precisar dele que leia no banco.
export const listLogs = (instanceId: string, limit: number, cursor?: string) =>
  prisma.uazapiInstanceLog.findMany({
    where: { instanceId },
    select: {
      id: true,
      event: true,
      source: true,
      previousStatus: true,
      newStatus: true,
      message: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

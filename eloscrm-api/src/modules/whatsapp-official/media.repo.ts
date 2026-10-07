import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

const scope = (orgId: string, id: string): Prisma.WhatsappMessageWhereInput => ({ organizationId: orgId, id, connectionId: { not: null }, deletedAt: null, conversation: { organizationId: orgId, instanceId: null }, connection: { organizationId: orgId, provider: "cloud_api" } });
export const findMedia = (orgId: string, id: string) => prisma.whatsappMessage.findFirst({ where: scope(orgId, id), select: { id: true, connectionId: true, conversationId: true, officialMediaId: true, mediaMime: true, mediaKey: true, mediaStatus: true, mediaFilename: true } });
export const claimMedia = async (orgId: string, id: string) => {
  const token = randomUUID();
  const now = new Date();
  const result = await prisma.whatsappMessage.updateMany({ where: { ...scope(orgId, id), officialMediaId: { not: null }, mediaStatus: { in: ["pending", "failed"] }, mediaAttempts: { lt: 3 },
    AND: [{ OR: [{ mediaLeaseToken: null }, { mediaLeaseExpiresAt: { lte: now } }] }, { OR: [{ mediaNextAttemptAt: null }, { mediaNextAttemptAt: { lte: now } }] }],
  }, data: { mediaLeaseToken: token, mediaLeaseExpiresAt: new Date(now.getTime() + 120_000), mediaAttempts: { increment: 1 }, mediaStatus: "pending", mediaError: null } });
  return result.count ? token : null;
};
export const finishMedia = (orgId: string, id: string, token: string, media: { key: string; mime: string; size: number }) => prisma.whatsappMessage.updateMany({ where: { ...scope(orgId, id), mediaLeaseToken: token }, data: {
  mediaStatus: "ready", mediaKey: media.key, mediaMime: media.mime, mediaSize: media.size, mediaError: null,
  mediaTempUrl: null, mediaTempExpiresAt: null, mediaLeaseToken: null, mediaLeaseExpiresAt: null, mediaNextAttemptAt: null,
} });
export const failMedia = (orgId: string, id: string, token: string) => prisma.whatsappMessage.updateMany({ where: { ...scope(orgId, id), mediaLeaseToken: token }, data: {
  mediaStatus: "failed", mediaError: "Não foi possível baixar a mídia oficial. Tente novamente ou solicite o reenvio do arquivo.",
  mediaLeaseToken: null, mediaLeaseExpiresAt: null, mediaNextAttemptAt: new Date(Date.now() + 60_000),
} });
export const resetMedia = (orgId: string, id: string) => prisma.whatsappMessage.updateMany({ where: { ...scope(orgId, id), officialMediaId: { not: null }, mediaStatus: "failed", mediaLeaseToken: null, OR: [{ mediaNextAttemptAt: null }, { mediaNextAttemptAt: { lte: new Date() } }] }, data: { mediaStatus: "pending", mediaAttempts: 0, mediaNextAttemptAt: null, mediaError: null } });
// Descoberta global retorna só referências; cada claim e escrita volta ao escopo da imobiliária.
export const pendingMedia = () => prisma.whatsappMessage.findMany({ where: { officialMediaId: { not: null }, connection: { provider: "cloud_api", status: "connected" }, deletedAt: null,
  mediaStatus: { in: ["pending", "failed"] }, mediaAttempts: { lt: 3 }, AND: [{ OR: [{ mediaLeaseToken: null }, { mediaLeaseExpiresAt: { lte: new Date() } }] }, { OR: [{ mediaNextAttemptAt: null }, { mediaNextAttemptAt: { lte: new Date() } }] }],
}, select: { id: true, organizationId: true }, orderBy: { sentAt: "asc" }, take: 100 });

export const expireExhaustedMedia = () => prisma.whatsappMessage.updateMany({ where: { officialMediaId: { not: null }, connection: { provider: "cloud_api" }, mediaStatus: "pending", mediaAttempts: { gte: 3 }, mediaLeaseExpiresAt: { lte: new Date() } }, data: { mediaStatus: "failed", mediaError: "O download foi interrompido. Tente baixar a mídia novamente.", mediaLeaseToken: null, mediaLeaseExpiresAt: null } });

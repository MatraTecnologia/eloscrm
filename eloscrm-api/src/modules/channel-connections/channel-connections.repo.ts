import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const publicConnectionSelect = {
  id: true, organizationId: true, provider: true, status: true, label: true,
  businessPortfolioId: true, wabaId: true, phoneNumberId: true,
  displayPhoneNumber: true, verifiedName: true, currency: true, timezoneId: true,
  isOnBusinessApp: true, uazapiInstanceId: true, tokenExpiresAt: true, disabledAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ChannelConnectionSelect;

export const list = (orgId: string) => prisma.channelConnection.findMany({
  where: { organizationId: orgId }, select: publicConnectionSelect, orderBy: { createdAt: "asc" },
});

export const find = (orgId: string, id: string) => prisma.channelConnection.findFirst({
  where: { organizationId: orgId, id }, select: publicConnectionSelect,
});

export const findByOfficialNumber = (orgId: string, phoneNumberId: string) => prisma.channelConnection.findFirst({
  where: { organizationId: orgId, provider: "cloud_api", phoneNumberId }, select: publicConnectionSelect,
});

export const findCredential = (orgId: string, id: string) => prisma.channelConnection.findFirst({
  where: { organizationId: orgId, id, provider: "cloud_api" },
  select: { id: true, organizationId: true, status: true, tokenEnc: true, tokenExpiresAt: true, phoneNumberId: true, wabaId: true, businessPortfolioId: true },
});

export const create = (data: Prisma.ChannelConnectionUncheckedCreateInput) => prisma.channelConnection.create({ data, select: publicConnectionSelect });

export const update = (orgId: string, id: string, data: Prisma.ChannelConnectionUncheckedUpdateInput) => prisma.channelConnection.update({
  where: { id, organizationId: orgId }, data, select: publicConnectionSelect,
});

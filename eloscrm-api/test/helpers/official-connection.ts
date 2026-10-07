import { randomBytes, randomInt } from "node:crypto";
import { saveVerifiedOfficialConnection } from "../../src/modules/channel-connections/channel-connections.service.js";
import type { VerifiedOfficialConnectionInput } from "../../src/modules/channel-connections/channel-connections.schema.js";

export const createOfficialConnectionFixture = async (orgId: string, overrides: Partial<VerifiedOfficialConnectionInput> = {}) => {
  const accessToken = randomBytes(24).toString("base64url");
  const input: VerifiedOfficialConnectionInput = {
    label: "Conta de teste", accessToken,
    businessPortfolioId: String(randomInt(1, 1_000_000_000)),
    wabaId: String(randomInt(1, 1_000_000_000)),
    phoneNumberId: String(randomInt(1, 1_000_000_000)),
    currency: "BRL", timezoneId: "25", isOnBusinessApp: true,
    ...overrides,
  };
  return { connection: await saveVerifiedOfficialConnection(orgId, input), accessToken: input.accessToken, input };
};

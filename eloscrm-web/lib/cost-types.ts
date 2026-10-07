export type CostRate = { id: string; country: string; category: string; pricingType: string; currency: string; unitRate: string; validFrom: string; validUntil: string; volumeFrom: number; volumeUntil: number | null; sourceUrl: string };
export type CostPeriod = { connectionId: string; start: string; end: string };
export type CostReport = {
  counts: { official: number; businessApp: number; history: number; pending: number; uncertain: number; failed: number };
  assessed: number; unresolved: number; truncated: boolean; subtotals: { currency: string; amount: string; known: number }[];
  items: { id: string; messageId: string; deliveredAt: string; category: string | null; pricingType: string | null; country: string | null; currency: string | null; amount: string | null; state: string; revision: number; rateSnapshot: CostRate | null }[];
  analytics: { scope: "waba"; currency: string | null; status: string; total: string | null; volume: number | null; syncedAt: string | null; lastAttemptAt: string; safeError: string | null; revision: number; points: { start: number; end: number; category: string | null; country: string | null; pricingType: string | null; cost: string | null; volume: number | null; tier: string | null }[] } | null;
};
export type CostScenario = { connectionId: string; at: string; rows: { country: string; category: string; pricingType: string; quantity: number; volumeBefore: number }[] };
export type CostSimulation = { at: string; generatedAt: string; connectionId: string; currency: string | null; total: string | null; assumptions: string[]; rows: (CostScenario["rows"][number] & { amount: string | null; state: string; segments: { quantity: number; rate: CostRate }[] })[] };

export type CostFilters = { contactId?: string; conversationId?: string; campaignId?: string };
export type CostScopes = { contacts: { id: string; label: string; identities: { id: string; recipientCountry: string | null; kind: string }[] }[]; conversations: { id: string; label: string }[]; campaigns: { id: string; label: string }[]; limit: number };
export type CostReconciliation = {
  id: string; connectionId: string; wabaId: string; currency: string; start: string; end: string; documentReference: string; reportedTotal: string; declaredFees: string | null; declaredTaxes: string | null; note: string | null; createdById: string; createdAt: string; evidence: "manager_declared";
  snapshot: { generatedAt: string; evidence: "manager_declared"; documentScope: "waba"; messagingTotal: string; counts: CostReport["counts"]; assessed: number; unresolved: number; localSubtotals: CostReport["subtotals"]; localScope: "connection"; analytics: CostReport["analytics"]; differenceFromMeta: string | null; differenceFromLocalEstimate: string | null; limitations: string[] };
};

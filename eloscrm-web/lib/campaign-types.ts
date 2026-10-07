import type { BroadcastFilters } from "./types";
import type { ImportedAudience } from "./import-types";

export type ParameterSource = "firstName" | "fullName" | "dealTitle" | "dealValue" | "propertyTitle" | "ownerName";
export type CampaignInput = { connectionId: string; pipelineId: string; filters: BroadcastFilters; dealIds: string[]; importedAudience?: ImportedAudience; templateId: string; headerUploadId?: string; parameters: { header: Record<string, string>; body: Record<string, string>; buttons?: Record<string, string> }; parameterSources?: { header: Record<string, ParameterSource>; body: Record<string, ParameterSource> } };
export type CampaignCost = { country: string | null; category: string; currency: string | null; amount: string | null; rateId: string | null; state: string; rate?: { sourceUrl: string; validFrom: string; validUntil: string } | null };
export type CampaignPreview = {
  headerMedia?: { uploadId: string; mime: string; size: number; digest: string; filename: string }; previewHash: string; generatedAt: string; connectionId: string; pipelineId: string; text: string;
  template: { id: string; name: string; language: string; category: string; definitionHash: string };
  rows: { dealId: string; clientId: string; clientName: string; exclusion: string | null; cost: CampaignCost; text?: string | null; parameters?: CampaignInput["parameters"] }[];
  eligible: number; excluded: number;
  estimate: { currency: string | null; amount: string | null; unresolved: number; messagesPerPerson: number; assumption: string };
};
export type CampaignSummary = { id: string; name: string; connectionId: string; status: string; createdAt: string };
export type OfficialCampaign = CampaignSummary & { pipelineId: string; snapshot: CampaignPreview; recipients: { id: string; destination: string | null; clientId: string; clientName: string; dealId: string; status: string; safeError: string | null; errorCode: string | null; errorStage: string | null; attempts: number; startedAt: string | null; completedAt: string | null; commandId: string | null; messageId: string | null; deliveryStatus: string | null; cost: { amount: string | null; currency: string | null; state: string } | null }[] };

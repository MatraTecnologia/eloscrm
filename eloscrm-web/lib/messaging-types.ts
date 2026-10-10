import type { WhatsappMessage, ChannelProvider } from "./types";
export type OfficialSendStatus = "pending" | "preparing" | "sending" | "accepted" | "failed" | "uncertain";
export type InboxChannel = {
  conversationId: string; provider: ChannelProvider; connectionId: string | null; label: string; number: string | null;
  status: string; credentialExpired: boolean; serviceWindowExpiresAt: string | null; phone: string | null; isGroup: boolean;
  uazapiManual: { allowed: boolean; reason: string | null; number: string | null } | null;
  identities: { id: string; kind: "phone" | "wa_id" | "bsuid" | "parent_bsuid" }[];
};
export type InboxGroup = {
  id: string; name: string; clientId: string | null; unreadCount: number; archived: boolean; lastMessageAt: string | null; lastMessageText: string | null; channels: InboxChannel[];
};
export type InboxMessage = WhatsappMessage & {
  conversationId: string; connectionId: string | null; origin: "uazapi" | "cloud_api" | "business_app" | "history";
  uazapiManual: { id: string; status: string; safeError: string | null } | null;
  authorName: string | null; command: { id: string; status: OfficialSendStatus; safeError: string | null } | null;
};
export type OfficialTemplate = {
  id: string; name: string; language: string; category: string; status: string; syncedAt: string;
  statusUpdatedAt?: string | null; rejectionReason?: string | null; rejectionDetail?: string | null; rejectionRecommendation?: string | null;
  definition: { parameter_format?: "NAMED" | "POSITIONAL"; components: { type: string; format?: string; text?: string; buttons?: { type: string; url?: string; text?: string }[] }[] };
};
export type OfficialSendInput = { idempotencyKey: string; identityId: string; quotedMessageId?: string } & (
  { type: "text"; text: string } | { type: "template"; templateId: string; headerUploadId?: string; parameters: { header: Record<string, string>; body: Record<string, string>; buttons?: Record<string, string> } } |
  { type: "media"; uploadId: string; caption?: string }
);
export type OfficialCommand = { id: string; messageId: string; connectionId: string; status: OfficialSendStatus; safeError: string | null; externalMessageId: string | null; message: { status: string } };

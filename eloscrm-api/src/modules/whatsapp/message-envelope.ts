import { WhatsappDirection, WhatsappMessageType } from "../../generated/prisma/client.js";
import { phoneKey } from "../../lib/phone.js";

/**
 * Traduz o envelope de `messages` da uazapi para o que o banco guarda.
 *
 * O formato não está na spec do provedor — tudo aqui vem de tráfego observado, e cada detalhe
 * estranho é uma armadilha real, não excesso de zelo. Ver §2.5 do spec de conversas.
 */

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

const int = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;
};

/** `mediaType` manda; `type` só resolve o que não é mídia. Gif chega como VideoMessage. */
const TYPE_BY_MEDIA: Record<string, WhatsappMessageType> = {
  image: WhatsappMessageType.image,
  video: WhatsappMessageType.video,
  gif: WhatsappMessageType.gif,
  audio: WhatsappMessageType.audio,
  ptt: WhatsappMessageType.ptt,
  document: WhatsappMessageType.document,
  sticker: WhatsappMessageType.sticker,
};

const TYPE_BY_KIND: Record<string, WhatsappMessageType> = {
  text: WhatsappMessageType.text,
  location: WhatsappMessageType.location,
  contact: WhatsappMessageType.contact,
  reaction: WhatsappMessageType.reaction,
  poll: WhatsappMessageType.poll,
};

export const messageTypeOf = (message: Record<string, unknown>): WhatsappMessageType => {
  const media = str(message.mediaType);
  if (media && TYPE_BY_MEDIA[media]) return TYPE_BY_MEDIA[media];
  const kind = str(message.type);
  if (kind && TYPE_BY_KIND[kind]) return TYPE_BY_KIND[kind];
  return WhatsappMessageType.unsupported;
};

export type ParsedConversation = {
  chatid: string;
  phone: string | null;
  phoneKey: string | null;
  lid: string | null;
  isGroup: boolean;
  waName: string | null;
  contactName: string | null;
  photoUrl: string | null;
  suggestedName: string | null;
};

export type ParsedMessage = {
  providerId: string;
  providerMessageId: string | null;
  direction: WhatsappDirection;
  type: WhatsappMessageType;
  rawType: string | null;
  text: string | null;
  quotedId: string | null;
  reactionTo: string | null;
  sentByApi: boolean;
  senderLid: string | null;
  senderName: string | null;
  sentAt: Date;
  hasMedia: boolean;
  mediaMime: string | null;
  mediaSize: number | null;
  mediaFilename: string | null;
  mediaDuration: number | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  mediaThumb: string | null;
  mediaWaveform: string | null;
};

export const parseConversation = (body: Record<string, unknown>): ParsedConversation | null => {
  const chat = asRecord(body.chat);
  const message = asRecord(body.message);

  // chatid pode faltar no chat e vir só na mensagem
  const chatid = str(chat.wa_chatid) ?? str(message.chatid);
  if (!chatid) return null;

  // `chat.phone` já vem só com dígitos; sender_pn é o JID e precisa perder o sufixo
  const phone = str(chat.phone) ?? str(message.sender_pn)?.split("@")[0] ?? null;

  return {
    chatid,
    phone,
    phoneKey: phoneKey(phone),
    // nunca use `sender`: é LID (identificador opaco), não telefone
    lid: str(chat.wa_chatlid) ?? str(message.sender_lid),
    isGroup: chat.wa_isGroup === true || message.isGroup === true,
    waName: str(chat.wa_name),
    contactName: str(chat.wa_contactName),
    photoUrl: str(chat.imagePreview) ?? str(chat.image),
    // sugestão de nome ao criar lead; o CRM embutido da uazapi não é fonte de verdade
    suggestedName: str(chat.lead_name) ?? str(chat.wa_contactName) ?? str(chat.wa_name),
  };
};

export const parseMessage = (body: Record<string, unknown>): ParsedMessage | null => {
  const message = asRecord(body.message);
  const providerId = str(message.id);
  if (!providerId) return null;

  // content é STRING no texto simples (Conversation) e objeto no resto — ler .text direto estoura
  const content = asRecord(message.content);
  const mediaType = str(message.mediaType);

  return {
    providerId,
    providerMessageId: str(message.messageid),
    direction: message.fromMe === true ? WhatsappDirection.outbound : WhatsappDirection.inbound,
    type: messageTypeOf(message),
    rawType: str(message.messageType),
    // `message.text` já traz a legenda da mídia, então não precisa cair no content.caption
    text: str(message.text) ?? (typeof message.content === "string" ? message.content : null),
    quotedId: str(message.quoted),
    reactionTo: str(message.reaction),
    sentByApi: message.wasSentByApi === true,
    senderLid: str(message.sender_lid),
    senderName: str(message.senderName),
    // messageTimestamp vem em MILISSEGUNDOS aqui (o de messages_update vem em segundos)
    sentAt: new Date(int(message.messageTimestamp) ?? Date.now()),
    hasMedia: Boolean(mediaType),
    mediaMime: str(content.mimetype),
    mediaSize: int(content.fileLength),
    mediaFilename: str(content.fileName),
    mediaDuration: int(content.seconds),
    mediaWidth: int(content.width),
    mediaHeight: int(content.height),
    // ausente em ptt e sticker; a UI cai no marcador desses dois
    mediaThumb: str(content.JPEGThumbnail),
    mediaWaveform: str(content.waveform),
  };
};

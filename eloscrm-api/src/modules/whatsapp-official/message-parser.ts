import * as z from "zod";
import { WhatsappMessageType, type WhatsappMessageOrigin } from "../../generated/prisma/client.js";
import { httpError } from "../../lib/http-error.js";
import { objectOf, objectsOf, stringOf } from "./webhook.schema.js";
import type { Alias } from "./identity.repo.js";

const messageSchema = z.looseObject({
  id: z.string().min(1).max(256), timestamp: z.string().regex(/^\d{1,12}$/), type: z.string().min(1).max(100),
});
export const eventDate = (value: unknown, receivedAt: Date) => {
  const seconds = z.coerce.number().int().nonnegative().parse(value);
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime()) || date.getTime() > receivedAt.getTime() + 300_000) throw httpError(422, "OFFICIAL_TIMESTAMP_INVALID", "O timestamp do evento é inválido");
  return date;
};

export const aliasesOf = (item: Record<string, unknown>, direction: "inbound" | "outbound"): Alias[] => {
  const fields: [Alias["kind"], string][] = direction === "inbound"
    ? [["bsuid", "from_user_id"], ["parent_bsuid", "from_parent_user_id"], ["wa_id", "from"]]
    : [["bsuid", "to_user_id"], ["parent_bsuid", "to_parent_user_id"], ["wa_id", "to"]];
  return fields.flatMap(([kind, field]) => stringOf(item[field]) ? [{ kind, value: stringOf(item[field])! }] : []);
};

export const parseOfficialMessage = (raw: Record<string, unknown>, origin: WhatsappMessageOrigin, receivedAt: Date, threadId?: string) => {
  const message = messageSchema.parse(raw);
  const direction = origin === "business_app" || (origin === "history" && (threadId ? stringOf(raw.from) !== threadId : Boolean(raw.to))) ? "outbound" as const : "inbound" as const;
  const aliases = aliasesOf(raw, direction);
  if (origin === "history" && threadId) {
    // O thread identifica o interlocutor mesmo quando o histórico outbound omite `to`.
    const withoutPhone = aliases.filter(alias => alias.kind !== "wa_id");
    aliases.splice(0, aliases.length, ...withoutPhone, { kind: "wa_id", value: threadId });
  }
  const type = message.type === "contacts" ? WhatsappMessageType.contact : Object.values(WhatsappMessageType).includes(message.type as WhatsappMessageType) ? message.type as WhatsappMessageType : WhatsappMessageType.unsupported;
  const content = message[message.type] === undefined || message.type === "contacts" ? {} : objectOf(message[message.type]);
  const context = raw.context === undefined ? {} : objectOf(raw.context);
  const location = message.type === "location" ? z.looseObject({
    latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), name: z.string().optional(), address: z.string().optional(),
  }).parse(content) : undefined;
  const contacts = message.type === "contacts" ? objectsOf(raw.contacts).map(contact => {
    const name = objectOf(contact.name);
    return {
      name: stringOf(name.formatted_name) ?? ([stringOf(name.first_name), stringOf(name.last_name)].filter(Boolean).join(" ") || "Contato"),
      phones: objectsOf(contact.phones).flatMap(phone => stringOf(phone.phone) ? [stringOf(phone.phone)!] : []),
      business: false,
    };
  }) : undefined;
  return {
    id: message.id, direction, type, rawType: message.type, origin, aliases, sentAt: eventDate(message.timestamp, receivedAt),
    text: stringOf(content.body) ?? stringOf(content.caption) ?? null,
    mediaId: ["image", "video", "audio", "document", "sticker"].includes(message.type) ? stringOf(content.id) : undefined,
    mediaMime: stringOf(content.mime_type), mediaFilename: stringOf(content.filename), quotedId: stringOf(context.id),
    location: location ? { lat: location.latitude, lng: location.longitude, name: location.name, address: location.address } : undefined,
    contacts,
    isCustomerMessage: direction === "inbound" && !["system", "reaction", "unsupported"].includes(message.type),
  };
};

export const profileFor = (contacts: Record<string, unknown>[], aliases: Alias[]) => {
  const matched = contacts.find(contact => aliases.some(alias => contact[alias.kind === "bsuid" ? "user_id" : alias.kind === "parent_bsuid" ? "parent_user_id" : "wa_id"] === alias.value));
  if (!matched) return { aliases, displayName: undefined };
  const additional: Alias[] = ([ ["bsuid", "user_id"], ["parent_bsuid", "parent_user_id"], ["wa_id", "wa_id"] ] as const)
    .flatMap(([kind, field]) => stringOf(matched[field]) ? [{ kind, value: stringOf(matched[field])! }] : []);
  const displayName = matched.profile ? stringOf(objectOf(matched.profile).name) : undefined;
  return { aliases: [...aliases, ...additional], displayName: displayName?.slice(0, 200) };
};

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

/** Telefone do provedor chega em formatos diferentes conforme o campo; só os dígitos são estáveis. */
const digits = (value: string | null | undefined) => {
  const onlyDigits = (value ?? "").replace(/\D/g, "");
  return onlyDigits.length > 0 ? onlyDigits : null;
};

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
  // contato compartilhado também chega com `mediaType` (observado em 2026-08-10:
  // `vcard` para um, `contact_array` para vários), mas não é arquivo — ver `DOWNLOADABLE` abaixo
  vcard: WhatsappMessageType.contact,
  contact_array: WhatsappMessageType.contact,
  location: WhatsappMessageType.location,
};

/**
 * Só estes `mediaType` têm arquivo do outro lado.
 *
 * **Allowlist, não blocklist**: `mediaType` preenchido não significa mídia baixável, e foi assim que
 * o contato compartilhado entrou na fila de download e voltou com "Message does not contain
 * downloadable media" escrito na bolha. Tipo novo do provedor passa a não baixar por padrão — o
 * erro de não tentar é invisível; o de tentar aparece para o corretor.
 */
const DOWNLOADABLE = new Set(["image", "video", "gif", "audio", "ptt", "document", "sticker"]);

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

/** Um contato compartilhado, já traduzido do vCard para o que o cartão da bolha mostra. */
export type ParsedContact = {
  name: string;
  /** telefones em dígitos, como vieram no `TEL` do cartão */
  phones: string[];
  /** nome comercial (`X-WA-BIZ-NAME`), quando o contato é uma conta business */
  business: string | null;
};

/**
 * Lê o vCard.
 *
 * Só os quatro campos que o cartão mostra: nome, nome comercial e telefones. O `X-WA-BIZ-DESCRIPTION`
 * fica de fora de propósito — vem com quebras de linha, emoji e o texto de propaganda inteiro da
 * empresa, que não cabe numa bolha e não ajuda ninguém a decidir se liga para o contato.
 */
const parseVcard = (vcard: string, fallbackName: string | null): ParsedContact | null => {
  const linhas = vcard.split(/\r?\n/);
  const valorDe = (prefixo: string) =>
    linhas.find((linha) => linha.toUpperCase().startsWith(prefixo))?.split(":").slice(1).join(":").trim() ?? null;

  const phones = linhas
    .filter((linha) => linha.toUpperCase().startsWith("TEL"))
    .map((linha) => {
      // `TEL;waid=554399854972:+55 43 99985-4972` — o waid é o número sem máscara, e é o melhor
      // dos dois; o valor depois dos dois-pontos vem formatado para leitura humana
      const waid = /waid=(\d+)/i.exec(linha)?.[1];
      return waid ?? linha.split(":").slice(1).join(":").replace(/\D/g, "");
    })
    .filter((phone) => phone.length > 0);

  const name = valorDe("FN") ?? fallbackName;
  if (!name) return null;

  return { name, phones: [...new Set(phones)], business: valorDe("X-WA-BIZ-NAME") };
};

/**
 * Os contatos de uma mensagem de contato compartilhado.
 *
 * O provedor manda um vCard solto em `content.vcard` quando é um só, e `content.contacts[]` quando
 * são vários (`ContactMessage` × `ContactsArrayMessage`, capturados em 2026-08-10). Devolve `null`
 * para qualquer outro tipo, e é isso que a coluna guarda.
 */
export const parseContacts = (message: Record<string, unknown>): ParsedContact[] | null => {
  const content = asRecord(message.content);
  const lista = Array.isArray(content.contacts) ? content.contacts : null;

  const brutos = lista
    ? lista.map((item) => asRecord(item))
    : str(content.vcard)
      ? [content]
      : [];

  const contatos = brutos.flatMap((bruto) => {
    const vcard = str(bruto.vcard);
    if (!vcard) return [];
    const parsed = parseVcard(vcard, str(bruto.displayName));
    return parsed ? [parsed] : [];
  });

  return contatos.length > 0 ? contatos : null;
};

/** Localização compartilhada. `name`/`address` só vêm quando é um lugar, não um ponto no mapa. */
export type ParsedLocation = {
  lat: number;
  lng: number;
  name: string | null;
  address: string | null;
  /** link que o próprio lugar carrega (site, página do estabelecimento) */
  url: string | null;
};

/**
 * Lê a localização de `content`.
 *
 * Dois formatos observados em 2026-08-10, ambos `mediaType: location`: o ponto solto traz só as
 * coordenadas, e o lugar traz também `name`, `address` e às vezes uma `URL`. O mapa estático vem no
 * `JPEGThumbnail` do mesmo `content`, então ele já entra por `mediaThumb` sem tratamento à parte.
 *
 * Coordenada zero-zero é descartada: é o que sobra quando o campo não veio, e (0, 0) fica no meio do
 * Atlântico — melhor não ter localização do que apontar para lá.
 */
export const parseLocation = (message: Record<string, unknown>): ParsedLocation | null => {
  const content = asRecord(message.content);
  const lat = typeof content.degreesLatitude === "number" ? content.degreesLatitude : null;
  const lng = typeof content.degreesLongitude === "number" ? content.degreesLongitude : null;
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;

  return {
    lat,
    lng,
    name: str(content.name),
    address: str(content.address),
    url: str(content.URL),
  };
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
  contacts: ParsedContact[] | null;
  location: ParsedLocation | null;
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

  // `chat.phone` **não** vem normalizado: observado como `+55 43 9841-4904` em 2026-08-04, com
  // máscara e espaços. Guardar assim faz o número virar destino de envio (`/send/text`,
  // `/message/react` recebem `number: conversation.phone`) e quebra a busca por dígitos. O JID do
  // `sender_pn` é a fonte confiável; do `chat.phone` só interessam os dígitos.
  const phone = digits(str(chat.phone)) ?? digits(str(message.sender_pn)?.split("@")[0]) ?? null;

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
    hasMedia: mediaType !== null && DOWNLOADABLE.has(mediaType),
    contacts: parseContacts(message),
    location: parseLocation(message),
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

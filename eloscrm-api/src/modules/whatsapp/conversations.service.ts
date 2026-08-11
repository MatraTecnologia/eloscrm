import { randomUUID } from "node:crypto";
import {
  AuditAction,
  AuditEntity,
  ClientSource,
  UazapiInstanceStatus,
  WhatsappDirection,
  WhatsappMediaStatus,
  WhatsappMessageStatus,
  WhatsappMessageType,
  type Prisma,
  type WhatsappMessage,
  type WhatsappReaction,
} from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { recordAudit } from "../../lib/audit.js";
import { maskPhone, snapshotOf } from "../../lib/audit-snapshot.js";
import { conflict, httpError, notFound } from "../../lib/http-error.js";
import { formatBrPhone, phoneKey } from "../../lib/phone.js";
import { prisma } from "../../lib/prisma.js";
import {
  R2_PRIVATE_BUCKET,
  deleteFiles,
  getDownloadUrl,
  getUploadUrl,
  headFile,
  slugifyFilename,
} from "../../lib/storage.js";
import * as clients from "../clients/clients.service.js";
import { resolveMediaUrl } from "./media.service.js";
import type { Result } from "../../lib/uazapi/types.js";
import { instanceClient, requireIntegration, uazapiError } from "./whatsapp.gateway.js";
import {
  WHATSAPP_MEDIA_TYPES,
  maxBytesFor,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MediaUploadUrlInput,
  type SendMediaInput,
  type SendMessageInput,
  type WhatsappMediaContentType,
} from "./conversations.schema.js";

/**
 * O que a lista precisa saber sobre a última mensagem para escrever a prévia.
 *
 * `lastMessageText` sozinho não dá conta: mídia chega sem texto e a linha virava um travessão. O
 * tipo é o que permite escrever "Mensagem de voz", e a duração e o nome do arquivo são o resto do
 * que o WhatsApp mostra ali.
 */
const lastMessageSelect = {
  id: true,
  direction: true,
  type: true,
  text: true,
  mediaFilename: true,
  mediaDuration: true,
  contacts: true,
  location: true,
  poll: true,
  deletedAt: true,
} satisfies Prisma.WhatsappMessageSelect;

const conversationSelect = {
  id: true,
  chatid: true,
  phone: true,
  isGroup: true,
  waName: true,
  contactName: true,
  photoUrl: true,
  clientId: true,
  lastMessageAt: true,
  lastMessageText: true,
  unreadCount: true,
  archivedAt: true,
  createdAt: true,
  client: { select: { id: true, name: true, phone: true, status: true, temperature: true } },
  // `take` aninhado: o Prisma resolve por window function no próprio banco, então uma conversa de
  // oitenta mensagens não traz oitenta linhas para escolher uma. O desempate por `id` existe porque
  // reentrega do webhook repete o `sentAt` ao milissegundo.
  messages: {
    where: { type: { not: WhatsappMessageType.reaction } },
    orderBy: [{ sentAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: lastMessageSelect,
  },
} satisfies Prisma.ConversationSelect;

type LastMessage = Prisma.WhatsappMessageGetPayload<{ select: typeof lastMessageSelect }>;

/**
 * Troca a lista de uma mensagem só por `lastMessage`, aplicando à prévia a mesma regra da thread:
 * de mensagem apagada não sai conteúdo — nem texto, nem nome de arquivo. O front mostra "Esta
 * mensagem foi apagada" a partir do `deletedAt`, sem nunca ter recebido o que foi escrito.
 */
const withPreview = <T extends { messages: LastMessage[] }>(conversation: T) => {
  const { messages, ...rest } = conversation;
  const last = messages[0];
  return {
    ...rest,
    lastMessage: last
      ? last.deletedAt
        ? { ...last, text: null, mediaFilename: null, contacts: null, location: null, poll: null }
        : last
      : null,
  };
};

type ConversationLabelSource = {
  contactName?: string | null;
  waName?: string | null;
  phone?: string | null;
  client?: { name: string } | null;
};

/**
 * Nome que identifica a conversa num evento de auditoria — mesma precedência que o header da tela
 * usa, para o log falar a língua do corretor em vez de mostrar um chatid.
 */
export const conversationLabel = (conversation: ConversationLabelSource): string | null =>
  conversation.client?.name ?? conversation.contactName ?? conversation.waName ?? maskPhone(conversation.phone);

export const list = async (orgId: string, query: ListConversationsQuery) => {
  const where: Prisma.ConversationWhereInput = {
    organizationId: orgId,
    archivedAt: query.archived ? { not: null } : null,
  };
  if (query.clientId) where.clientId = query.clientId;
  if (query.unread) where.unreadCount = { gt: 0 };
  if (query.q) {
    where.OR = [
      { waName: { contains: query.q, mode: "insensitive" } },
      { contactName: { contains: query.q, mode: "insensitive" } },
      { phone: { contains: query.q } },
      { client: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  const items = await prisma.conversation.findMany({
    where,
    select: conversationSelect,
    // conversa sem mensagem ainda não deveria existir, mas nulo por último evita que ela suma
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: query.limit,
    ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
  });

  return {
    items: items.map(withPreview),
    nextCursor: items.length === query.limit ? items.at(-1)?.id : undefined,
  };
};

/**
 * Contagem por aba da lista.
 *
 * Em rota própria porque a listagem é paginada (`take`), então o número de itens devolvidos nunca
 * responde "quantas existem". "Todas" conta as **não arquivadas** — é o que a aba mostra.
 */
export const counts = async (orgId: string) => {
  const [all, unread, archived] = await Promise.all([
    prisma.conversation.count({ where: { organizationId: orgId, archivedAt: null } }),
    prisma.conversation.count({
      where: { organizationId: orgId, archivedAt: null, unreadCount: { gt: 0 } },
    }),
    prisma.conversation.count({ where: { organizationId: orgId, archivedAt: { not: null } } }),
  ]);
  return { all, unread, archived };
};

export const getById = async (orgId: string, id: string) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId: orgId },
    select: conversationSelect,
  });
  if (!conversation) throw notFound("Conversa não encontrada");
  return withPreview(conversation);
};

/**
 * Prévia da mensagem citada num reply. Sem `mediaUrl`: o bloco de citação mostra a miniatura que já
 * está no banco e o rótulo do tipo, então assinar uma URL por citação seria trabalho jogado fora.
 */
const quotedSelect = {
  id: true,
  providerMessageId: true,
  direction: true,
  type: true,
  text: true,
  senderName: true,
  mediaThumb: true,
  deletedAt: true,
} satisfies Prisma.WhatsappMessageSelect;

type QuotedPreview = Prisma.WhatsappMessageGetPayload<{ select: typeof quotedSelect }>;

/**
 * O conteúdo de uma mensagem apagada não sai daqui.
 *
 * Esconder no front não bastaria: o texto viajaria no JSON e apareceria em qualquer inspetor. A
 * linha continua no banco — a decisão foi preservar o registro da negociação e ocultar na tela,
 * não destruir o dado — mas a API se comporta como se o conteúdo não existisse.
 */
const hideDeleted = <T extends { deletedAt: Date | null }>(message: T) =>
  message.deletedAt
    ? { ...message, text: null, mediaThumb: null, mediaFilename: null, mediaWaveform: null, contacts: null, location: null, poll: null }
    : message;

/**
 * Resolve as citadas do lote de uma vez — uma query, não uma por bolha.
 *
 * `quotedId` guarda o `messageid` puro do provedor (é o que vem em `message.quoted`), e é por
 * `providerMessageId` que a mensagem original é reencontrada. Citada fora do lote carregado ou
 * anterior à integração simplesmente não aparece no mapa: o front distingue pelo `quotedId` que
 * continua na resposta.
 */
const loadQuoted = async (conversationId: string, messages: WhatsappMessage[]) => {
  const ids = [...new Set(messages.flatMap((m) => (m.quotedId ? [m.quotedId] : [])))];
  if (ids.length === 0) return new Map<string, QuotedPreview>();

  const found = await prisma.whatsappMessage.findMany({
    where: { conversationId, providerMessageId: { in: ids } },
    select: quotedSelect,
  });
  return new Map(found.map((m) => [m.providerMessageId!, hideDeleted(m)]));
};

/**
 * A URL da mídia é resolvida aqui e vai junto da mensagem: assinar é computação local, sem I/O,
 * então embutir sai mais barato que o front pedir uma por bolha. O TTL é curto — o front que
 * recarregar a página ganha URL nova.
 */
type MessageWithReactions = WhatsappMessage & { reactions?: WhatsappReaction[] };

const serializeMessage = async (
  message: MessageWithReactions,
  quoted?: Map<string, QuotedPreview>,
) => {
  // apagada nem chega a assinar URL: o arquivo continua no R2, mas ninguém recebe link para ele
  const media = message.deletedAt ? null : await resolveMediaUrl(message);
  const { mediaKey: _key, mediaTempUrl: _tmp, reactions, ...rest } = hideDeleted(message);
  return {
    ...rest,
    mediaUrl: media?.url ?? null,
    mediaSource: media?.source ?? null,
    quoted: (message.quotedId ? quoted?.get(message.quotedId) : null) ?? null,
    // `authorLid` é chave interna e não sai; o que a bolha precisa é o emoji e de quem foi
    reactions: (reactions ?? []).map((r) => ({
      emoji: r.emoji,
      mine: r.authorLid === "me",
      authorName: r.authorName,
    })),
  };
};

export const listMessages = async (orgId: string, id: string, query: ListMessagesQuery) => {
  await getById(orgId, id);

  const messages = await prisma.whatsappMessage.findMany({
    // `type: reaction` é resíduo: reações chegavam como mensagem antes de virarem badge na bolha.
    // Filtrar aqui conserta a thread do que já foi ingerido, sem migração.
    where: { conversationId: id, type: { not: WhatsappMessageType.reaction } },
    include: { reactions: { orderBy: { reactedAt: "asc" } } },
    orderBy: { sentAt: "desc" },
    take: query.limit,
    ...(query.before ? { skip: 1, cursor: { id: query.before } } : {}),
  });

  // o cursor da próxima página é a mensagem mais antiga deste lote — capturado antes de inverter,
  // porque depender da ordem de avaliação com um `reverse()` que muta o array é convite a bug
  const maisAntiga = messages.at(-1)?.id;
  const quoted = await loadQuoted(id, messages);

  return {
    // desc na query para pegar as mais recentes; asc na resposta porque a thread lê de cima
    items: await Promise.all([...messages].reverse().map((m) => serializeMessage(m, quoted))),
    nextBefore: messages.length === query.limit ? maisAntiga : undefined,
  };
};

/**
 * Mensagens fixadas ainda válidas, para a barra do topo.
 *
 * Filtra por `pinnedUntil` porque o provedor **não avisa quando o pin expira**: sem o corte, a
 * barra mostraria para sempre algo que já saiu do fixado no celular. Vem em rota própria e não na
 * thread — a fixada costuma estar centenas de mensagens atrás, fora de qualquer lote carregado.
 */
export const pinned = async (orgId: string, id: string) => {
  await getById(orgId, id);
  const messages = await prisma.whatsappMessage.findMany({
    where: {
      conversationId: id,
      deletedAt: null,
      pinnedUntil: { gt: new Date() },
    },
    include: { reactions: true },
    orderBy: { pinnedAt: "desc" },
    take: 5,
  });
  return Promise.all(messages.map((m) => serializeMessage(m)));
};

export const markRead = async (orgId: string, id: string) => {
  await getById(orgId, id);
  await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  return { ok: true };
};

export const mediaUrl = async (orgId: string, messageId: string, download = false) => {
  const message = await prisma.whatsappMessage.findFirst({
    where: { id: messageId, organizationId: orgId },
  });
  if (!message) throw notFound("Mensagem não encontrada");
  // apagada não devolve arquivo: o objeto continua no R2, mas ninguém recebe link para ele
  if (message.deletedAt) throw notFound("Mídia indisponível");
  const media = await resolveMediaUrl(message, download);
  if (!media) throw notFound("Mídia indisponível");
  return media;
};

/**
 * Envia texto pela conversa.
 *
 * A mensagem é gravada como `pending` **antes** da chamada à uazapi e só então atualizada: se o
 * provedor demorar, ela já está na thread, e não some entre o clique e a resposta. Com
 * `wasSentByApi` no exclude do webhook, o envio não volta como evento — então não há duplicata a
 * conciliar, e o `providerId` definitivo vem da própria resposta do envio.
 */
/** A conversa existe, é desta imobiliária e o número está de pé — o que todo envio exige. */
const conversationForSending = async (orgId: string, conversationId: string) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: orgId },
    include: { instance: true, client: { select: { name: true } } },
  });
  if (!conversation) throw notFound("Conversa não encontrada");
  if (conversation.instance.remoteDeletedAt) {
    throw conflict("INSTANCE_REMOTE_DELETED", "A conexão de WhatsApp não existe mais no servidor");
  }
  if (conversation.instance.status !== UazapiInstanceStatus.connected) {
    throw conflict("INSTANCE_NOT_CONNECTED", "Conecte o WhatsApp antes de enviar mensagens");
  }
  return conversation;
};

/**
 * A citada precisa ser da mesma conversa: para a uazapi o `replyid` é só uma string, então sem esse
 * escopo um id chutado responderia mensagem de outro chat.
 */
const resolveReplyId = async (conversationId: string, replyToId?: string) => {
  if (!replyToId) return undefined;

  const alvo = await prisma.whatsappMessage.findFirst({
    where: { id: replyToId, conversationId },
    select: { providerMessageId: true },
  });
  if (!alvo) throw notFound("Mensagem citada não encontrada");
  // mensagem ainda em `pending` (ou falha de envio) não tem id no provedor e não dá para citar
  if (!alvo.providerMessageId) {
    throw conflict("MESSAGE_NOT_REPLIABLE", "Esta mensagem ainda não pode ser respondida");
  }
  return alvo.providerMessageId;
};

/**
 * Envia e garante que a bolha não fique pendurada em `pending`.
 *
 * A falha do provedor vem em dois formatos e só um deles estava tratado: `result.success: false` é o
 * erro previsto, mas a chamada também **lança** — token que não descriptografa, rede que caiu, DNS
 * que não resolve. Sem este `catch` a mensagem ficava `pending` para sempre, e a tela mostra
 * pendente como "ainda indo", não como "não foi". Apareceu com o token corrompido de propósito num
 * ambiente de teste; em produção, o dia em que a chave de cifra mudar.
 */
const sendOrMarkFailed = async <T>(
  messageId: string,
  enviar: () => Promise<Result<T>>,
): Promise<T> => {
  const falhar = () =>
    prisma.whatsappMessage.update({
      where: { id: messageId },
      data: { status: WhatsappMessageStatus.failed },
    });

  // try/catch, e não `.catch()`: quem lança primeiro é o `instanceClient`, ao descriptografar o
  // token — **antes** de devolver promise nenhuma. Um `.catch()` encadeado não veria essa exceção,
  // e foi exatamente assim que a bolha continuou "pendente" no primeiro teste desta correção.
  let result: Result<T>;
  try {
    result = await enviar();
  } catch (err) {
    await falhar();
    throw err;
  }

  if (!result.success) {
    await falhar();
    throw uazapiError(result.error);
  }
  return result.data;
};

/** Grupo é endereçado pelo chatid (@g.us); conversa individual, pelo número em dígitos. */
const destinationOf = (conversation: { isGroup: boolean; chatid: string; phone: string | null }) =>
  conversation.isGroup ? conversation.chatid : (conversation.phone ?? conversation.chatid);

export const sendText = async (
  orgId: string,
  conversationId: string,
  data: SendMessageInput,
  actor: Actor,
) => {
  const conversation = await conversationForSending(orgId, conversationId);
  const replyid = await resolveReplyId(conversationId, data.replyToId);

  const local = await prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId,
      // placeholder até a uazapi devolver o id real; a unique é por (conversa, providerId)
      providerId: `local:${randomUUID()}`,
      direction: WhatsappDirection.outbound,
      type: WhatsappMessageType.text,
      status: WhatsappMessageStatus.pending,
      text: data.text,
      // mesma forma do que a ingestão grava: o messageid puro do provedor
      quotedId: replyid ?? null,
      sentByApi: true,
      sentById: actor.id,
      sentAt: new Date(),
    },
  });

  const config = requireIntegration();
  // `quotedId` fica mesmo na falha: a bolha marcada como erro já mostra o texto que o corretor
  // escreveu, e a citação é parte da mesma tentativa — limpá-la deixaria a bolha respondendo ao nada
  const enviada = await sendOrMarkFailed(local.id, () =>
    instanceClient(config, conversation.instance.tokenEnc).send.text({
      number: destinationOf(conversation),
      text: data.text,
      ...(replyid ? { replyid } : {}),
    }),
  );

  const updated = await prisma.whatsappMessage.update({
    where: { id: local.id },
    data: {
      providerId: enviada.id ?? local.providerId,
      providerMessageId: enviada.messageid ?? null,
      status: WhatsappMessageStatus.sent,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: updated.sentAt, lastMessageText: updated.text },
  });

  // grava só depois do envio confirmado: uma tentativa que falhou já fica registrada na bolha
  // `failed`, e não gera evento — sem `text` no snapshot, porque conteúdo de conversa não é auditoria
  await recordAudit({
    orgId,
    entityType: AuditEntity.WHATSAPP_MESSAGE,
    entityId: updated.id,
    entityLabel: conversationLabel(conversation),
    action: AuditAction.MESSAGE_SENT,
    actor,
    context: { conversationId },
    snapshot: snapshotOf(AuditEntity.WHATSAPP_MESSAGE, updated),
  });

  return serializeMessage(updated, await loadQuoted(conversationId, [updated]));
};

/**
 * Prefixo da chave no R2 — e a fronteira de segurança do envio de mídia.
 *
 * A chave viaja pelo cliente entre o `upload-url` e o envio, então ela não é confiável: sem conferir
 * o prefixo, um envio poderia apontar para o anexo privado de outro lead — ou de outra imobiliária —
 * e a uazapi entregaria esse arquivo no WhatsApp de quem pediu.
 */
const mediaKeyPrefix = (orgId: string, conversationId: string) =>
  `org/${orgId}/whatsapp/${conversationId}/`;

const UPLOAD_EXPIRES_IN = 300;

/**
 * TTL próprio, e maior que o das URLs que vão para o navegador: quem baixa aqui é o **servidor da
 * uazapi**, depois de a mensagem sair daqui, e um vídeo de dezenas de megabytes não se transfere no
 * minuto que basta para um clique de download. A janela de assinatura estável ainda come metade
 * desse prazo (ver `stableSigningDate`).
 */
const SEND_MEDIA_EXPIRES_IN = 30 * 60;

export const createMediaUploadUrl = async (
  orgId: string,
  conversationId: string,
  data: MediaUploadUrlInput,
) => {
  // a conexão é conferida já aqui: subir o arquivo para só então descobrir que o WhatsApp está
  // desconectado desperdiça o upload inteiro do corretor
  await conversationForSending(orgId, conversationId);

  const key = `${mediaKeyPrefix(orgId, conversationId)}${randomUUID()}-${slugifyFilename(data.filename)}`;
  const uploadUrl = await getUploadUrl(R2_PRIVATE_BUCKET, key, {
    contentLength: data.size,
    contentType: data.contentType,
    expiresIn: UPLOAD_EXPIRES_IN,
  });

  return { uploadUrl, key, expiresIn: UPLOAD_EXPIRES_IN };
};

/** O tipo do nosso enum que corresponde ao que a uazapi vai mandar. */
const LOCAL_TYPE: Record<(typeof WHATSAPP_MEDIA_TYPES)[WhatsappMediaContentType], WhatsappMessageType> = {
  image: WhatsappMessageType.image,
  video: WhatsappMessageType.video,
  audio: WhatsappMessageType.audio,
  document: WhatsappMessageType.document,
};

/**
 * Manda o arquivo que já está no nosso R2.
 *
 * O provedor aceita URL ou base64 e aqui é sempre URL: base64 infla o corpo em um terço e
 * carregaria um vídeo inteiro na memória do processo — o mesmo problema que o download de entrada
 * resolveu com stream. Como o arquivo **nasce** no nosso storage, a mensagem já sai
 * `mediaStatus: ready` e não passa pela fila de download, ao contrário de tudo que chega.
 *
 * Em desenvolvimento isto não completa: o SeaweedFS local não é alcançável pela uazapi, igual ao
 * webhook. Sem túnel, o envio de mídia só se prova em produção.
 */
export const sendMedia = async (
  orgId: string,
  conversationId: string,
  data: SendMediaInput,
  actor: Actor,
) => {
  const conversation = await conversationForSending(orgId, conversationId);

  if (!data.key.startsWith(mediaKeyPrefix(orgId, conversationId))) {
    throw notFound("Arquivo não encontrado");
  }

  // HEAD de verdade, como no `confirm` dos anexos: um PUT que falhou deixaria a uazapi baixando uma
  // URL morta, e o content-type não entra na assinatura do presign — a allowlist só vale aqui,
  // depois de saber o que de fato chegou ao bucket.
  const head = await headFile(R2_PRIVATE_BUCKET, data.key).catch(() => null);
  if (!head) throw httpError(422, "UPLOAD_NOT_FOUND", "O arquivo não chegou ao storage");
  if (head.contentLength > maxBytesFor(data.contentType)) {
    throw httpError(422, "UPLOAD_TOO_LARGE", "O arquivo enviado passa do tamanho permitido");
  }
  if (!head.contentType || head.contentType !== data.contentType) {
    throw httpError(422, "UPLOAD_TYPE_MISMATCH", "O arquivo enviado não é do tipo informado");
  }

  const replyid = await resolveReplyId(conversationId, data.replyToId);
  const tipoRemoto = WHATSAPP_MEDIA_TYPES[data.contentType];

  const local = await prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId,
      providerId: `local:${randomUUID()}`,
      direction: WhatsappDirection.outbound,
      type: LOCAL_TYPE[tipoRemoto],
      status: WhatsappMessageStatus.pending,
      // legenda é o texto da bolha, como na mídia que chega com caption
      text: data.caption ?? null,
      quotedId: replyid ?? null,
      sentByApi: true,
      sentById: actor.id,
      sentAt: new Date(),
      mediaStatus: WhatsappMediaStatus.ready,
      mediaKey: data.key,
      mediaMime: data.contentType,
      mediaFilename: data.filename,
      mediaSize: head.contentLength,
    },
  });

  const config = requireIntegration();
  const file = await getDownloadUrl(R2_PRIVATE_BUCKET, data.key, SEND_MEDIA_EXPIRES_IN);
  // o objeto fica no bucket mesmo se o envio falhar: a bolha de erro mostra o arquivo que o corretor
  // escolheu, e apagá-lo deixaria a mensagem apontando para o nada. A purga da organização o alcança.
  const enviada = await sendOrMarkFailed(local.id, () =>
    instanceClient(config, conversation.instance.tokenEnc).send.media({
      number: destinationOf(conversation),
      type: tipoRemoto,
      file,
      ...(data.caption ? { text: data.caption } : {}),
      // só documento mostra nome no WhatsApp; nos outros o campo vira legenda indesejada
      ...(tipoRemoto === "document" ? { docName: data.filename } : {}),
      mimetype: data.contentType,
      ...(replyid ? { replyid } : {}),
    }),
  );

  const updated = await prisma.whatsappMessage.update({
    where: { id: local.id },
    data: {
      providerId: enviada.id ?? local.providerId,
      providerMessageId: enviada.messageid ?? null,
      status: WhatsappMessageStatus.sent,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: updated.sentAt, lastMessageText: updated.text },
  });

  await recordAudit({
    orgId,
    entityType: AuditEntity.WHATSAPP_MESSAGE,
    entityId: updated.id,
    entityLabel: conversationLabel(conversation),
    action: AuditAction.MESSAGE_SENT,
    actor,
    context: { conversationId },
    snapshot: snapshotOf(AuditEntity.WHATSAPP_MESSAGE, updated),
  });

  return serializeMessage(updated, await loadQuoted(conversationId, [updated]));
};

/**
 * Leads que respondem pelo mesmo telefone da conversa.
 *
 * Normalmente é zero (gente nova) ou um (vinculado sozinho na ingestão). Devolve mais de um quando a
 * chave colide — fixo e celular do mesmo número — e é justamente aí que a tela pede escolha em vez
 * de adivinhar.
 */
export const candidates = async (orgId: string, id: string) => {
  const conversation = await getById(orgId, id);
  if (!conversation.phone) return [];
  const key = phoneKey(conversation.phone);
  if (!key) return [];
  return prisma.client.findMany({
    where: { organizationId: orgId, phoneKey: key },
    select: { id: true, name: true, phone: true, email: true, status: true, temperature: true },
    orderBy: { createdAt: "asc" },
  });
};

/** Cria o lead a partir da conversa e vincula. É o caminho de "quem chegou virou lead". */
export const createClientFrom = async (
  orgId: string,
  id: string,
  data: { name: string },
  actor: Actor,
) => {
  const conversation = await getById(orgId, id);
  if (conversation.clientId) {
    throw conflict("CONVERSATION_ALREADY_LINKED", "Esta conversa já está ligada a um lead");
  }

  const client = await clients.create(
    orgId,
    {
      name: data.name,
      // o CRM guarda telefone com máscara; gravar os dígitos crus destoaria de todos os outros
      phone: formatBrPhone(conversation.phone) ?? undefined,
      source: ClientSource.WHATSAPP,
    },
    actor,
  );

  await prisma.conversation.update({ where: { id }, data: { clientId: client.id } });
  // a criação do lead já gera CLIENT/CREATED (clients.create); aqui é o vínculo entre conversa e lead
  await recordAudit({
    orgId,
    entityType: AuditEntity.CONVERSATION,
    entityId: id,
    entityLabel: conversationLabel(conversation),
    action: AuditAction.LINKED,
    actor,
    context: { clientName: client.name },
  });
  return client;
};

export const linkClient = async (orgId: string, id: string, clientId: string, actor: Actor) => {
  const conversation = await getById(orgId, id);
  // o lead precisa ser da mesma organização — sem isto, um id chutado ligaria conversa a lead alheio
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: orgId } });
  if (!client) throw notFound("Lead não encontrado");

  await prisma.conversation.update({ where: { id }, data: { clientId } });
  await recordAudit({
    orgId,
    entityType: AuditEntity.CONVERSATION,
    entityId: id,
    entityLabel: conversationLabel(conversation),
    action: AuditAction.LINKED,
    actor,
    context: { clientName: client.name },
  });
  return client;
};

export const unlinkClient = async (orgId: string, id: string, actor: Actor) => {
  const conversation = await getById(orgId, id);
  // lido antes de limpar: sem isto o evento de UNLINKED não diz de quem a conversa se soltou
  const clientName = conversation.client?.name ?? null;
  await prisma.conversation.update({ where: { id }, data: { clientId: null } });
  await recordAudit({
    orgId,
    entityType: AuditEntity.CONVERSATION,
    entityId: id,
    entityLabel: conversationLabel(conversation),
    action: AuditAction.UNLINKED,
    actor,
    context: { clientName },
  });
  return { ok: true };
};

export const archive = async (orgId: string, id: string, archived: boolean, actor: Actor) => {
  const conversation = await getById(orgId, id);
  await prisma.conversation.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });
  await recordAudit({
    orgId,
    entityType: AuditEntity.CONVERSATION,
    entityId: id,
    entityLabel: conversationLabel(conversation),
    action: archived ? AuditAction.ARCHIVED : AuditAction.UNARCHIVED,
    actor,
  });
  return { ok: true };
};

/**
 * Apaga a conversa do CRM — mensagens e reações incluídas.
 *
 * **Só daqui.** A uazapi não tem endpoint de apagar chat e nada nesta função fala com o provedor: o
 * histórico continua inteiro no aparelho do lead. E como a conversa é reencontrada por
 * `(instanceId, chatid)`, a próxima mensagem do mesmo contato faz o `upsert` da ingestão criar uma
 * nova, vazia — excluir não é bloquear. Arquivar continua sendo o caminho não destrutivo.
 *
 * A mídia sai do R2 **antes** do delete: depois dele os `mediaKey` não existem mais e o objeto
 * ficaria pago e órfão no bucket, como em `attachments.purgeForEntities`. Sem mídia nenhuma o
 * `deleteFiles` retorna sem chamar o storage. O lead vinculado não é tocado — a relação é dele para
 * a conversa, não o contrário.
 */
export const remove = async (orgId: string, id: string, actor: Actor) => {
  const conversation = await getById(orgId, id);

  const comMidia = await prisma.whatsappMessage.findMany({
    where: { conversationId: id, mediaKey: { not: null } },
    select: { mediaKey: true },
  });
  await deleteFiles(
    R2_PRIVATE_BUCKET,
    comMidia.flatMap((m) => (m.mediaKey ? [m.mediaKey] : [])),
  );

  // contado antes do delete: depois não há mais mensagem nenhuma para contar, e é essa contagem que
  // fica como prova de que existiu um atendimento
  const [messageCount, primeira, ultima] = await Promise.all([
    prisma.whatsappMessage.count({ where: { conversationId: id } }),
    prisma.whatsappMessage.findFirst({
      where: { conversationId: id },
      orderBy: { sentAt: "asc" },
      select: { sentAt: true },
    }),
    prisma.whatsappMessage.findFirst({
      where: { conversationId: id },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
  ]);

  // evento vem antes do delete (D6): falha ao gravar não deixa a conversa sumir sem rastro, e o
  // rótulo/snapshot só podem ser lidos enquanto a linha ainda existe
  await recordAudit({
    orgId,
    entityType: AuditEntity.CONVERSATION,
    entityId: id,
    entityLabel: conversationLabel(conversation),
    action: AuditAction.DELETED,
    actor,
    snapshot: snapshotOf(AuditEntity.CONVERSATION, {
      ...conversation,
      messageCount,
      firstMessageAt: primeira?.sentAt ?? null,
      lastMessageAt: ultima?.sentAt ?? null,
    }),
  });

  await prisma.conversation.delete({ where: { id } });
};

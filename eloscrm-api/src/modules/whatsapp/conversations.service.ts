import { randomUUID } from "node:crypto";
import {
  AuditAction,
  AuditEntity,
  ClientSource,
  UazapiInstanceStatus,
  WhatsappDirection,
  WhatsappMessageStatus,
  WhatsappMessageType,
  type Prisma,
  type WhatsappMessage,
  type WhatsappReaction,
} from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { recordAudit } from "../../lib/audit.js";
import { maskPhone, snapshotOf } from "../../lib/audit-snapshot.js";
import { conflict, notFound } from "../../lib/http-error.js";
import { formatBrPhone, phoneKey } from "../../lib/phone.js";
import { prisma } from "../../lib/prisma.js";
import { R2_PRIVATE_BUCKET, deleteFiles } from "../../lib/storage.js";
import * as clients from "../clients/clients.service.js";
import { resolveMediaUrl } from "./media.service.js";
import { instanceClient, requireIntegration, uazapiError } from "./whatsapp.gateway.js";
import type {
  ListConversationsQuery,
  ListMessagesQuery,
  SendMessageInput,
} from "./conversations.schema.js";

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
} satisfies Prisma.ConversationSelect;

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

  return { items, nextCursor: items.length === query.limit ? items.at(-1)?.id : undefined };
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
  return conversation;
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
    ? { ...message, text: null, mediaThumb: null, mediaFilename: null, mediaWaveform: null }
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
export const sendText = async (
  orgId: string,
  conversationId: string,
  data: SendMessageInput,
  actor: Actor,
) => {
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

  // a citada precisa ser da mesma conversa: para a uazapi o `replyid` é só uma string, então sem
  // esse escopo um id chutado responderia mensagem de outro chat
  let replyid: string | undefined;
  if (data.replyToId) {
    const alvo = await prisma.whatsappMessage.findFirst({
      where: { id: data.replyToId, conversationId },
      select: { providerMessageId: true },
    });
    if (!alvo) throw notFound("Mensagem citada não encontrada");
    // mensagem ainda em `pending` (ou falha de envio) não tem id no provedor e não dá para citar
    if (!alvo.providerMessageId) {
      throw conflict("MESSAGE_NOT_REPLIABLE", "Esta mensagem ainda não pode ser respondida");
    }
    replyid = alvo.providerMessageId;
  }

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
  // grupo é endereçado pelo chatid (@g.us); conversa individual, pelo número em dígitos
  const destino = conversation.isGroup ? conversation.chatid : (conversation.phone ?? conversation.chatid);
  const result = await instanceClient(config, conversation.instance.tokenEnc).send.text({
    number: destino,
    text: data.text,
    ...(replyid ? { replyid } : {}),
  });

  if (!result.success) {
    // `quotedId` fica: a bolha marcada como falha já mostra o texto que o corretor escreveu, e a
    // citação é parte da mesma tentativa. Limpar deixaria a bolha de erro respondendo ao nada.
    await prisma.whatsappMessage.update({
      where: { id: local.id },
      data: { status: WhatsappMessageStatus.failed },
    });
    throw uazapiError(result.error);
  }

  const updated = await prisma.whatsappMessage.update({
    where: { id: local.id },
    data: {
      providerId: result.data.id ?? local.providerId,
      providerMessageId: result.data.messageid ?? null,
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

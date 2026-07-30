import * as repo from "./timeline.repo.js";
import type { TimelineQuery } from "./timeline.schema.js";

type TimelineItem = {
  kind: "ACTIVITY" | "AUDIT" | "COMMENT" | "ATTACHMENT";
  id: string;
  at: Date;
  payload: unknown;
};

export const forClient = async (orgId: string, clientId: string, query: TimelineQuery) => {
  const [activities, events, comments, attachments] = await repo.sources(orgId, clientId, query.limit);

  const items: TimelineItem[] = [
    // atividade usa a data do fato (concluída, ou agendada) e cai no createdAt quando não tem nenhuma
    ...activities.map((a) => ({
      kind: "ACTIVITY" as const,
      id: a.id,
      at: a.doneAt ?? a.dueAt ?? a.createdAt,
      payload: { type: a.type, description: a.description, dueAt: a.dueAt, doneAt: a.doneAt },
    })),
    ...events.map((e) => ({
      kind: "AUDIT" as const,
      id: e.id,
      at: e.createdAt,
      payload: { action: e.action, actorName: e.actorName, changes: e.changes },
    })),
    ...comments.map((c) => ({
      kind: "COMMENT" as const,
      id: c.id,
      at: c.createdAt,
      payload: { body: c.body, authorId: c.authorId, authorName: c.authorName, editedAt: c.editedAt },
    })),
    ...attachments.map((f) => ({
      kind: "ATTACHMENT" as const,
      id: f.id,
      at: f.createdAt,
      payload: {
        filename: f.filename,
        contentType: f.contentType,
        size: f.size,
        uploadedByName: f.uploadedByName,
      },
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, query.limit);
};

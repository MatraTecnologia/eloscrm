import * as repo from "./agenda.repo.js";
import type { ListAgendaQuery } from "./agenda.schema.js";

// mesma forma discriminada da timeline: a agenda passou a ter duas fontes (compromisso e lead a
// retomar) e o cliente precisa saber qual é qual sem adivinhar pelo formato do payload
type AgendaItem = {
  kind: "ACTIVITY" | "NURTURE";
  id: string;
  at: Date;
  payload: unknown;
};

export const list = async (orgId: string, filters: ListAgendaQuery) => {
  const [activities, nurtureDue] = await Promise.all([
    repo.listAgenda(orgId, filters),
    repo.listNurtureDue(orgId, filters),
  ]);

  const items: AgendaItem[] = [
    ...activities.map((activity) => ({
      kind: "ACTIVITY" as const,
      id: activity.id,
      at: activity.dueAt!,
      payload: activity,
    })),
    ...nurtureDue.map((client) => ({
      kind: "NURTURE" as const,
      id: client.id,
      at: client.nurtureUntil!,
      payload: {
        clientId: client.id,
        clientName: client.name,
        phone: client.phone,
        reason: client.nurtureReason,
        note: client.nurtureNote,
      },
    })),
  ];

  // crescente: a agenda olha para frente, ao contrário da timeline
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
};

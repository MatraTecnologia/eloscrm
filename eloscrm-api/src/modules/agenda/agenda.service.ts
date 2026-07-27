import * as repo from "./agenda.repo.js";
import type { ListAgendaQuery } from "./agenda.schema.js";

export const list = (orgId: string, filters: ListAgendaQuery) => repo.listAgenda(orgId, filters);

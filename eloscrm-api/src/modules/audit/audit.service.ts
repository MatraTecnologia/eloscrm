import * as repo from "./audit.repo.js";
import type { ListAuditQuery } from "./audit.schema.js";

export const list = (orgId: string, filters: ListAuditQuery) => repo.listEvents(orgId, filters);

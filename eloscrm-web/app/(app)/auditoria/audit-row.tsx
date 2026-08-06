"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { TableCell, TableRow } from "@/components/ui/table";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, AUDIT_SOURCE_LABELS, ENTITY_NOUNS, FIELD_LABELS } from "@/lib/labels";
import type { AuditAction, AuditEvent } from "@/lib/types";

/** Nome do item no momento do fato; sem ele, o id truncado — evento anterior ao backfill ou sem rótulo. */
export const auditEntityLabel = (event: Pick<AuditEvent, "entityLabel" | "entityId">) =>
  event.entityLabel ?? `${event.entityId.slice(0, 8)}…`;

/**
 * A frase do evento. **Não** resolve nome por id (sem `useEntityNames`): a tela precisa continuar
 * legível quando o item já foi apagado, que é o motivo de existir `entityLabel`/`context`/`snapshot`.
 */
/**
 * Ações cujo verbo já diz tudo. Sem esta lista a frase sai redundante — "Gestora QA entrou no sistema
 * o acesso Gestora QA" —, porque o complemento repetiria o próprio ator.
 */
const SEM_COMPLEMENTO = new Set<AuditAction>([
  "SIGNED_IN",
  "SIGNED_OUT",
  "REORDERED",
  "EXPORTED",
  "PURGED",
]);

export const auditEventPhrase = (event: AuditEvent) => {
  const inicio = `${event.actorName ?? "Alguém"} ${AUDIT_ACTION_LABELS[event.action]}`;
  if (SEM_COMPLEMENTO.has(event.action)) return inicio;
  return `${inicio} o ${ENTITY_NOUNS[event.entityType]} ${auditEntityLabel(event)}`;
};

/** Resumo curto do diff para a coluna/linha "Resumo" — o detalhe (Task 16) mostra o diff completo. */
export const auditChangeSummary = (event: AuditEvent) => {
  const fields = event.changes ? Object.keys(event.changes) : [];
  if (fields.length === 0) return null;
  const labels = fields.map((field) => FIELD_LABELS[field] ?? field);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} e mais ${labels.length - 2}`;
};

const AuditSourceBadge = ({ event }: { event: AuditEvent }) =>
  event.source === "USER" ? null : (
    <Badge variant="secondary" className="align-middle">
      {AUDIT_SOURCE_LABELS[event.source]}
    </Badge>
  );

export const AuditTableRow = ({ event, onSelect }: { event: AuditEvent; onSelect: () => void }) => (
  <TableRow onClick={onSelect} className="cursor-pointer">
    <TableCell className="text-muted-foreground">
      {format(parseISO(event.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
    </TableCell>
    <TableCell>
      <div className="flex items-center gap-2">
        <span className="font-medium">{event.actorName ?? "Alguém"}</span>
        <AuditSourceBadge event={event} />
      </div>
    </TableCell>
    <TableCell>{AUDIT_ACTION_LABELS[event.action]}</TableCell>
    <TableCell>
      <div className="flex flex-col">
        <span>{auditEntityLabel(event)}</span>
        <span className="text-xs text-muted-foreground">{AUDIT_ENTITY_LABELS[event.entityType]}</span>
      </div>
    </TableCell>
    <TableCell className="text-muted-foreground">{auditChangeSummary(event) ?? "—"}</TableCell>
  </TableRow>
);

export const AuditCard = ({ event, onSelect }: { event: AuditEvent; onSelect: () => void }) => (
  <Item variant="outline" className="cursor-pointer" onClick={onSelect}>
    <ItemMedia variant="icon">
      <History />
    </ItemMedia>
    <ItemContent>
      <ItemTitle className="whitespace-normal">{auditEventPhrase(event)}</ItemTitle>
      <ItemDescription className="flex flex-wrap items-center gap-1.5">
        {format(parseISO(event.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
        <AuditSourceBadge event={event} />
      </ItemDescription>
      {auditChangeSummary(event) && (
        <ItemDescription>{auditChangeSummary(event)}</ItemDescription>
      )}
    </ItemContent>
  </Item>
);

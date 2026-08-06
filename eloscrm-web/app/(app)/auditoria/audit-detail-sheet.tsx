"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, ExternalLink, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEntityNames } from "@/components/app/use-entity-names";
import { AUDIT_ENTITY_LABELS, AUDIT_SOURCE_LABELS, FIELD_LABELS, formatAuditValue } from "@/lib/labels";
import { useAuditSearch } from "@/lib/queries/audit";
import type { AuditEntity, AuditEvent } from "@/lib/types";
import { auditEventPhrase } from "./audit-row";

// Só os tipos com uma rota de verdade no app. `DEAL`/`PROPERTY` não têm ficha por id (a tela deles
// é lista + diálogo) — o link vai para a lista, que ainda é melhor do que nenhum caminho de volta.
const ENTITY_ROUTE: Partial<Record<AuditEntity, string>> = {
  CLIENT: "/clients",
  DEAL: "/deals",
  PROPERTY: "/properties",
};

const entityHref = (event: AuditEvent) => {
  const base = ENTITY_ROUTE[event.entityType];
  if (!base) return null;
  return event.entityType === "CLIENT" ? `${base}/${event.entityId}` : base;
};

// Parse simples do user agent: o suficiente para "de onde veio a ação", não um detector completo.
const parseUserAgent = (ua: string | null) => {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Navegador";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} · ${os}` : browser;
};

const KeyValueList = ({ data }: { data: Record<string, unknown> }) => (
  <dl className="space-y-1.5">
    {Object.entries(data).map(([key, value]) => (
      <div key={key} className="flex justify-between gap-4 text-sm">
        <dt className="text-muted-foreground">{FIELD_LABELS[key] ?? key}</dt>
        <dd className="text-right">{formatAuditValue(key, value)}</dd>
      </div>
    ))}
  </dl>
);

type Props = {
  event: AuditEvent | null;
  onOpenChange: (open: boolean) => void;
  onFilterByRequestId: (requestId: string) => void;
};

export const AuditDetailSheet = ({ event, onOpenChange, onFilterByRequestId }: Props) => {
  const resolveName = useEntityNames();
  // Só busca quando há requestId — sem isso a query cairia numa busca sem filtro nenhum.
  const { data: siblings } = useAuditSearch(
    { requestId: event?.requestId ?? undefined, limit: 50 },
    { enabled: !!event?.requestId },
  );

  /**
   * A própria trilha responde se o item ainda existe: se há um DELETED para o par
   * (entityType, entityId), o link levaria a um 404. Não dá para deduzir do evento aberto — um
   * CREATED continua existindo depois de o item ser apagado, que é justamente o caso desta tela.
   */
  const { data: historico } = useAuditSearch(
    {
      entityType: event ? [event.entityType] : undefined,
      entityId: event?.entityId,
      action: ["DELETED"],
      limit: 1,
    },
    { enabled: !!event },
  );
  const foiExcluido = (historico?.pages[0]?.items.length ?? 0) > 0;

  const copyRequestId = async () => {
    if (!event?.requestId) return;
    await navigator.clipboard.writeText(event.requestId);
    toast.success("Id da requisição copiado");
  };

  const href = event ? entityHref(event) : null;
  const changeEntries = event?.changes ? Object.entries(event.changes) : [];
  const firstPage = siblings?.pages[0];
  const siblingCount = firstPage ? firstPage.items.length : 0;
  const siblingTruncated = !!firstPage?.nextCursor;

  return (
    <Sheet open={!!event} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {event && (
          <>
            <SheetHeader>
              <SheetTitle>{AUDIT_ENTITY_LABELS[event.entityType]}</SheetTitle>
              <SheetDescription>{auditEventPhrase(event)}</SheetDescription>
              <p className="text-xs text-muted-foreground">
                {format(parseISO(event.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-4">
              {changeEntries.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">O que mudou</h3>
                  <div className="overflow-hidden rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-medium">Campo</th>
                          <th className="px-3 py-1.5 text-left font-medium">Antes</th>
                          <th className="px-3 py-1.5 text-left font-medium">Depois</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changeEntries.map(([field, change]) => (
                          <tr key={field} className="border-t">
                            <td className="px-3 py-1.5 text-muted-foreground">{FIELD_LABELS[field] ?? field}</td>
                            <td className="px-3 py-1.5">{formatAuditValue(field, change.from, resolveName)}</td>
                            <td className="px-3 py-1.5">{formatAuditValue(field, change.to, resolveName)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {event.context && Object.keys(event.context).length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Contexto</h3>
                  <KeyValueList data={event.context} />
                </section>
              )}

              {event.snapshot && Object.keys(event.snapshot).length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Estado no momento do fato</h3>
                  <KeyValueList data={event.snapshot} />
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Origem</h3>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Origem</dt>
                    <dd>{AUDIT_SOURCE_LABELS[event.source]}</dd>
                  </div>
                  {event.actorEmail && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">E-mail</dt>
                      <dd className="truncate">{event.actorEmail}</dd>
                    </div>
                  )}
                  {event.ip && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">IP</dt>
                      <dd>{event.ip}</dd>
                    </div>
                  )}
                  {parseUserAgent(event.userAgent) && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Dispositivo</dt>
                      <dd>{parseUserAgent(event.userAgent)}</dd>
                    </div>
                  )}
                  {event.requestId && (
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground">Requisição</dt>
                      <dd className="flex items-center gap-1">
                        <span className="truncate font-mono text-xs">{event.requestId}</span>
                        <Button variant="ghost" size="icon-xs" aria-label="Copiar id da requisição" onClick={copyRequestId}>
                          <Copy className="size-3.5" />
                        </Button>
                      </dd>
                    </div>
                  )}
                </dl>
              </section>

              <section className="space-y-2">
                {foiExcluido ? (
                  <p className="text-sm text-muted-foreground">
                    Este registro foi excluído. O que está aqui é o que a auditoria guardou dele.
                  </p>
                ) : href ? (
                  <Button variant="outline" className="w-full" render={<Link href={href} />}>
                    <ExternalLink className="size-4" />
                    Abrir item
                  </Button>
                ) : null}

                {event.requestId && siblingCount > 1 && (
                  <Button
                    variant="ghost"
                    className="w-full"
                    onClick={() => onFilterByRequestId(event.requestId!)}
                  >
                    <Layers className="size-4" />
                    Ver as {siblingCount}
                    {siblingTruncated ? "+" : ""} ações desta mesma operação
                  </Button>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuditSearch, type AuditSearchFilters } from "@/lib/queries/audit";
import type { AuditEvent } from "@/lib/types";
import { AuditDetailSheet } from "./audit-detail-sheet";
import { AuditCard, AuditTableRow } from "./audit-row";

export const AuditList = ({
  filters,
  onFilterByRequestId,
}: {
  filters: AuditSearchFilters;
  onFilterByRequestId: (requestId: string) => void;
}) => {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAuditSearch(filters);
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Rolagem infinita: o botão "Carregar mais" continua como alvo de clique/teclado, e o
  // IntersectionObserver dispara a mesma ação assim que a sentinela entra na viewport.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  const events = data?.pages.flatMap((page) => page.items) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircle />
          </EmptyMedia>
          <EmptyTitle>Não foi possível carregar a auditoria</EmptyTitle>
          <EmptyDescription>Tente novamente em instantes.</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </Empty>
    );
  }

  if (events.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollText />
          </EmptyMedia>
          <EmptyTitle>Nenhuma ação no período</EmptyTitle>
          <EmptyDescription>Ajuste os filtros para ver outras ações.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      {isMobile ? (
        <div className="space-y-2">
          {events.map((event) => (
            <AuditCard key={event.id} event={event} onSelect={() => setSelected(event)} />
          ))}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Quem</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Resumo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <AuditTableRow key={event.id} event={event} onSelect={() => setSelected(event)} />
            ))}
          </TableBody>
        </Table>
      )}

      <div ref={sentinelRef} className="flex justify-center py-4">
        {hasNextPage && (
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </Button>
        )}
      </div>

      <AuditDetailSheet
        event={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onFilterByRequestId={(requestId) => {
          setSelected(null);
          onFilterByRequestId(requestId);
        }}
      />
    </>
  );
};

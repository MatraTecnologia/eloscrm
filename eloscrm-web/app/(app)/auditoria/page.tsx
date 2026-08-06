"use client";

import { Suspense } from "react";
import { ScrollText } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client";
import { useMembers } from "@/lib/queries/members";
import { AuditFilters } from "./audit-filters";
import { AuditList } from "./audit-list";
import { useAuditFilters } from "./use-audit-filters";

const AuditoriaContent = () => {
  const { data: session } = useSession();
  const { data: members, isLoading: loadingMembers } = useMembers();
  const myRole = members?.find((member) => member.userId === session?.user.id)?.role ?? null;
  const isManager = myRole === "owner" || myRole === "admin";

  // O filtro na URL não faz requisição nenhuma sozinho — pode nascer antes do gate resolver, sem
  // disparar a busca de um corretor que não devia sequer tentar (o gate de verdade é a API, mas
  // deixar o hook de busca montado para quem não é gestor seria uma requisição garantida a 403).
  const filtersState = useAuditFilters();

  if (!session || loadingMembers) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isManager) {
    return (
      <Empty className="m-auto">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollText />
          </EmptyMedia>
          <EmptyTitle>Acesso restrito</EmptyTitle>
          <EmptyDescription>Só gestores consultam a auditoria da imobiliária.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Toda ação registrada na imobiliária, com filtros e detalhe.
        </p>
      </div>
      <AuditFilters state={filtersState} />
      <AuditList
        filters={filtersState.searchFilters}
        onFilterByRequestId={(requestId) => void filtersState.setFilters({ requestId })}
      />
    </div>
  );
};

export default function AuditoriaPage() {
  // `useQueryStates` lê o query string via `useSearchParams`, que empurra a árvore para
  // client-side rendering: sem o boundary o build falha (mesmo padrão de conversas/page.tsx).
  return (
    <Suspense fallback={<div className="space-y-4 p-6" />}>
      <AuditoriaContent />
    </Suspense>
  );
}

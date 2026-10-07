"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInboxGroups } from "@/lib/queries/inbox";
import { useActiveOrganization } from "@/lib/auth-client";
import { InboxDetail } from "./inbox-detail";

export const ClientInbox = ({ clientId }: { clientId: string }) => {
  const { data: org } = useActiveOrganization();
  const query = useInboxGroups({ clientId });
  const group = query.data?.pages[0]?.items[0];
  if (query.isLoading) return <Skeleton className="h-96 w-full" />;
  if (query.isError) return <div role="alert">Não foi possível carregar o atendimento.<Button variant="outline" onClick={() => query.refetch()}>Tentar novamente</Button></div>;
  if (!group) return <div className="space-y-3 p-6 text-center"><p>Nenhum atendimento vinculado a este lead.</p><Button variant="outline" nativeButton={false} render={<Link href="/conversas" />}>Ver atendimentos</Button></div>;
  return <div className="flex h-[38rem] min-w-0 flex-col overflow-hidden rounded-lg border"><div className="flex justify-end border-b p-2"><Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/conversas?thread=${encodeURIComponent(group.id)}`} />}>Abrir no inbox</Button></div><InboxDetail key={`${org?.id}:${group.id}`} group={group} onLinked={() => { void query.refetch(); }} /></div>;
};

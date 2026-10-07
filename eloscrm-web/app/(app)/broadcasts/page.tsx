"use client";

import { useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useMembers } from "@/lib/queries/members";
import { usePipelines } from "@/lib/queries/pipelines";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignPanel } from "@/components/whatsapp-official/campaign-panel";
import { UazapiCampaignPanel } from "./uazapi-campaign-panel";

const BroadcastsPage = () => {
  const { data: org } = useActiveOrganization();
  const { data: session } = useSession();
  const members = useMembers();
  const pipelines = usePipelines();
  const [pipelineId, setPipelineId] = useState("");
  const [provider, setProvider] = useState<"cloud_api" | "uazapi">("cloud_api");
  const role = members.data?.find(member => member.userId === session?.user.id)?.role;
  const canManage = role === "owner" || role === "admin";
  const pipeline = pipelines.data?.find(item => item.id === pipelineId) ?? pipelines.data?.[0];
  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><Send className="size-5" />Disparos</h1><p className="mt-1 text-sm text-muted-foreground">Selecione negócios do CRM ou importe uma lista, revise a mensagem e acompanhe cada envio.</p></div>
      <Button variant="outline" nativeButton={false} render={<Link href="/integracoes/whatsapp?tab=templates" />}>Templates e conexões</Button>
    </div>
    {members.isPending || pipelines.isPending ? <Skeleton className="h-64 w-full" /> : members.isError || pipelines.isError ? <div role="alert" className="space-y-2"><p>Não foi possível carregar os dados dos disparos.</p><Button variant="outline" onClick={() => { void members.refetch(); void pipelines.refetch(); }}>Tentar novamente</Button></div> : <>
      <div className="grid gap-4 border-b pb-5 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Funil para organizar o histórico<select aria-label="Funil do disparo" value={pipeline?.id ?? ""} onChange={event => setPipelineId(event.target.value)} className="block h-10 w-full rounded-md border bg-background px-3"><option value="" disabled>Selecione um funil</option>{pipelines.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="space-y-1 text-sm">Enviar por<select aria-label="Provedor do disparo" value={canManage ? provider : "uazapi"} onChange={event => setProvider(event.target.value as "cloud_api" | "uazapi")} className="block h-10 w-full rounded-md border bg-background px-3">{canManage && <option value="cloud_api">WhatsApp oficial · template aprovado</option>}<option value="uazapi">uazapi · mensagem de texto</option></select></label>
      </div>
      {!pipeline ? <p className="text-sm text-muted-foreground">Crie um funil para organizar o histórico dos disparos.</p> : canManage && provider === "cloud_api" ? <CampaignPanel key={`${org?.id}:${pipeline.id}`} pipeline={pipeline} /> : <UazapiCampaignPanel key={`${org?.id}:${pipeline.id}`} pipeline={pipeline} />}
    </>}
  </div>;
};

export default BroadcastsPage;

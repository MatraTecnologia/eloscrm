"use client";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { costLabels, formatCost } from "./cost-format";

export const ComposerCost = ({ connectionId, identityId, type, templateId }: { connectionId: string; identityId: string; type: "text" | "media" | "template"; templateId: string }) => {
  const { data: org } = useActiveOrganization();
  const input = { connectionId, identityId, type, ...(type === "template" ? { templateId } : {}) };
  const query = useQuery({ queryKey: ["whatsapp-costs", org?.id, "preview", input], enabled: !!org?.id && (type !== "template" || !!templateId), queryFn: async () => (await api.post<{ amount: string | null; currency: string | null; state: string }>("/whatsapp/costs/preview", input)).data, staleTime: 60000, retry: false });
  if (query.isError) return <p className="text-xs text-muted-foreground">Estimativa de custo indisponível.</p>;
  if (!query.data) return null;
  return <p className="text-xs text-muted-foreground">Estimativa: {formatCost(query.data.amount, query.data.currency)} · {costLabels[query.data.state] ?? "Indisponível"}{". Cenário regular pela tarifa base; não confirma cobrança nem gratuidade."}</p>;
};

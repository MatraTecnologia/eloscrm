"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMetaLeads } from "@/lib/queries/meta";
import type { MetaLead } from "@/lib/types";

const nameOf = (lead: MetaLead) =>
  lead.fieldData.find((f) => ["full_name", "name", "nome"].includes(f.name.toLowerCase()))?.values[0] ??
  lead.fieldData[0]?.values[0] ??
  "—";

export const LeadsCard = () => {
  const { data: leads, isLoading } = useMetaLeads(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Últimos leads recebidos</CardTitle>
        <CardDescription>O que o Meta entregou e a ficha que cada um virou no CRM.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-32 w-full" />}
        {leads && leads.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhum lead recebido ainda.</p>
        )}
        {leads && leads.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebido</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Formulário</TableHead>
                  <TableHead>Campanha</TableHead>
                  <TableHead>No CRM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="whitespace-nowrap">
                      {format(parseISO(lead.createdTime), "dd/MM HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="font-medium">{nameOf(lead)}</TableCell>
                    <TableCell>
                      <div>{lead.form.name}</div>
                      <div className="text-muted-foreground text-xs">{lead.form.page}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {[lead.campaignName, lead.adName].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell>
                      {lead.clientId ? (
                        <Link href={`/clients/${lead.clientId}`} className="text-primary text-sm underline-offset-4 hover:underline">
                          {lead.dealId ? "Lead + negócio" : "Lead"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

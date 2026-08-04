"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWhatsappLogs } from "@/lib/queries/whatsapp";
import { logEventLabels, logSourceLabels, statusLabels } from "./labels";

export const LogsTab = () => {
  const { data: logs, isLoading } = useWhatsappLogs(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico</CardTitle>
        <CardDescription>Últimos eventos da conexão, do mais recente ao mais antigo.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-40 w-full" />}
        {logs && logs.length === 0 && <p className="text-muted-foreground text-sm">Nada registrado ainda.</p>}
        {logs && logs.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap">
                    {format(parseISO(log.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell>{logEventLabels[log.event] ?? log.event}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{logSourceLabels[log.source] ?? log.source}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {log.message ??
                      (log.newStatus ? `→ ${statusLabels[log.newStatus]}` : "—")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

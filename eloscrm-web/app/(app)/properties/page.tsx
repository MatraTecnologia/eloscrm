"use client";

import { useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDeleteProperty, useProperties } from "@/lib/queries/properties";
import { formatCurrency, propertyStatusLabels } from "@/lib/labels";
import type { PropertyStatus } from "@/lib/types";
import { PropertyDialog } from "./property-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function PropertiesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PropertyStatus | "TODOS">("TODOS");
  const { data: properties, isLoading } = useProperties({
    q: q || undefined,
    status: status === "TODOS" ? undefined : status,
  });
  const remove = useDeleteProperty();

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      toast.success("Imóvel removido");
    } catch {
      toast.error("Não foi possível remover");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Imóveis</h1>
          <p className="text-muted-foreground">Carteira de imóveis da imobiliária.</p>
        </div>
        <PropertyDialog
          trigger={
            <Button>
              <Plus className="size-4" /> Novo imóvel
            </Button>
          }
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por título ou endereço" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as PropertyStatus | "TODOS")}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos os status</SelectItem>
            {Object.entries(propertyStatusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && properties?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nenhum imóvel ainda. Crie o primeiro.
                </TableCell>
              </TableRow>
            )}
            {properties?.map((property) => (
              <TableRow key={property.id}>
                <TableCell className="font-medium">{property.title}</TableCell>
                <TableCell className="text-muted-foreground">{property.address ?? "—"}</TableCell>
                <TableCell>{formatCurrency(property.price)}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{propertyStatusLabels[property.status]}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <PropertyDialog
                      property={property}
                      trigger={
                        <Button variant="ghost" size="icon">
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(property.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

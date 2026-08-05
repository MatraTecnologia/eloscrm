"use client";

import { useState } from "react";
import { Bed, Building2, MapPin, Pencil, Plus, Ruler, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDeleteProperty, useProperties } from "@/lib/queries/properties";
import { useActiveOrganization } from "@/lib/auth-client";
import { formatCurrency, propertyStatusLabels } from "@/lib/labels";
import type { Property, PropertyStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PropertyDialog } from "./property-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const statusStyles: Record<PropertyStatus, string> = {
  DISPONIVEL: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  RESERVADO: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  VENDIDO: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  INATIVO: "bg-slate-500/10 text-slate-700 dark:text-slate-400",
};

const PropertyCard = ({ property, onDelete }: { property: Property; onDelete: (id: string) => void }) => {
  const specs = [
    property.type,
    property.bedrooms != null ? `${property.bedrooms} ${property.bedrooms === 1 ? "quarto" : "quartos"}` : null,
    property.area != null ? `${property.area} m²` : null,
  ].filter(Boolean);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-shadow hover:shadow-md">
      <div className="relative aspect-4/3 w-full shrink-0 overflow-hidden bg-muted">
        {property.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={property.photos[0]} alt={property.title} className="size-full object-cover" />
        ) : (
          <div
            className="flex size-full items-center justify-center bg-linear-to-br from-accent to-highlight/10"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, color-mix(in oklch, var(--primary), transparent 94%) 0, color-mix(in oklch, var(--primary), transparent 94%) 1px, transparent 1px, transparent 12px)",
            }}
          >
            <Building2 className="size-10 text-primary/25" />
          </div>
        )}

        <span
          className={cn(
            "absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur-sm",
            statusStyles[property.status],
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {propertyStatusLabels[property.status]}
        </span>

        <div className="absolute top-3 right-3 flex gap-1 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <PropertyDialog
            property={property}
            trigger={
              <Button variant="secondary" size="icon-sm" className="bg-white/90 shadow-sm backdrop-blur-sm hover:bg-white dark:bg-black/50 dark:hover:bg-black/70">
                <Pencil className="size-3.5" />
                <span className="sr-only">Editar imóvel</span>
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="secondary" size="icon-sm" className="bg-white/90 shadow-sm backdrop-blur-sm hover:bg-white dark:bg-black/50 dark:hover:bg-black/70">
                  <Trash2 className="size-3.5 text-destructive" />
                  <span className="sr-only">Excluir imóvel</span>
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir imóvel</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que deseja excluir &quot;{property.title}&quot;? Essa ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => onDelete(property.id)}>
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {property.price != null ? (
          <div className="text-xl font-semibold text-primary">{formatCurrency(property.price)}</div>
        ) : (
          <div className="text-base font-medium text-muted-foreground">Sob consulta</div>
        )}
        <div className="truncate font-medium">{property.title}</div>
        {property.address && (
          <div className="flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{property.address}</span>
          </div>
        )}
        {specs.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            {property.type && (
              <span className="flex items-center gap-1">
                <Building2 className="size-3.5" /> {property.type}
              </span>
            )}
            {property.bedrooms != null && (
              <span className="flex items-center gap-1">
                <Bed className="size-3.5" /> {property.bedrooms}
              </span>
            )}
            {property.area != null && (
              <span className="flex items-center gap-1">
                <Ruler className="size-3.5" /> {property.area} m²
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default function PropertiesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PropertyStatus | "TODOS">("TODOS");
  const { data: properties, isLoading } = useProperties({
    q: q || undefined,
    status: status === "TODOS" ? undefined : status,
  });
  const { data: org, isPending: loadingOrg } = useActiveOrganization();
  const remove = useDeleteProperty();

  const hasOrg = !!org;
  const hasFilters = q.trim().length > 0 || status !== "TODOS";

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
            <Button disabled={!hasOrg}>
              <Plus className="size-4" /> Novo imóvel
            </Button>
          }
        />
      </div>

      {!loadingOrg && !hasOrg && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>Nenhuma imobiliária ativa</EmptyTitle>
            <EmptyDescription>Selecione ou crie uma imobiliária para ver a carteira de imóveis.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {hasOrg && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar por título ou endereço" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as PropertyStatus | "TODOS")}>
              <SelectTrigger className="w-48">
                <SelectValue>
                  {(v: PropertyStatus | "TODOS") =>
                    v === "TODOS" ? "Todos os status" : propertyStatusLabels[v]
                  }
                </SelectValue>
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
            {!isLoading && properties && properties.length > 0 && (
              <span className="ml-auto text-sm text-muted-foreground">
                {properties.length} {properties.length === 1 ? "imóvel" : "imóveis"}
              </span>
            )}
          </div>

          {isLoading && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                  <Skeleton className="aspect-4/3 w-full rounded-none" />
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-6 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && properties?.length === 0 && !hasFilters && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Building2 />
                </EmptyMedia>
                <EmptyTitle>Nenhum imóvel ainda</EmptyTitle>
                <EmptyDescription>Cadastre o primeiro imóvel para começar a organizar sua carteira.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <PropertyDialog
                  trigger={
                    <Button>
                      <Plus className="size-4" /> Novo imóvel
                    </Button>
                  }
                />
              </EmptyContent>
            </Empty>
          )}

          {!isLoading && properties?.length === 0 && hasFilters && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>Nenhum imóvel encontrado</EmptyTitle>
                <EmptyDescription>Ajuste a busca ou o filtro de status para ver outros imóveis.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {!isLoading && properties && properties.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {properties.map((property) => (
                <PropertyCard key={property.id} property={property} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

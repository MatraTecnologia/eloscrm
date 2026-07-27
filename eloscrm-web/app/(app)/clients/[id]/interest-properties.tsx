import Link from "next/link";
import { Building2 } from "lucide-react";
import { formatCurrency } from "@/lib/labels";
import type { Property } from "@/lib/types";

export const InterestProperties = ({
  properties,
  isFallback,
}: {
  properties: Property[];
  isFallback: boolean;
}) => {
  if (properties.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum imóvel disponível para sugerir ainda.</p>;
  }

  return (
    <div className="space-y-3">
      {isFallback && (
        <p className="text-xs text-muted-foreground">Nenhum imóvel vinculado ao negócio — sugestões da carteira.</p>
      )}
      {properties.map((property) => (
        <div key={property.id} className="flex items-center gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {property.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={property.photos[0]} alt={property.title} className="size-full object-cover" />
            ) : (
              <Building2 className="size-5 text-muted-foreground/50" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{property.title}</p>
            <p className="text-sm text-muted-foreground">{formatCurrency(property.price)}</p>
          </div>
        </div>
      ))}
      <Link href="/properties" className="inline-block text-sm font-medium text-primary hover:underline">
        Ver todos imóveis
      </Link>
    </div>
  );
};
